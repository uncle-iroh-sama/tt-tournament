import { describe, expect, it } from 'vitest'
import { demoTournament } from '../demo.ts'
import { countForm, matchTitle, roundHeading, roundName } from '../ui/format.ts'
import { classification } from './classify.ts'
import { groupPairings, groupStandings, snakeGroups } from './groups.ts'
import {
  addPlayer,
  createTournament,
  defaultSettings,
  enterScore,
  enterWalkover,
  fillFreedTable,
  generateMainDraw,
  generateQualifying,
  readyMatches,
  simulateRemaining,
  swapMainSlots,
} from './engine.ts'
import { planKnockout, previewQualifying } from './plan.ts'
import { pointsFor } from './points.ts'
import { isValidSet } from './score.ts'
import { seedOrder } from './seeds.ts'
import { separateFirstRoundClubs, separateTopSeeds } from './separate.ts'
import type { AuditEvent, Match, Player, Settings, Tournament } from './types.ts'

function player(id: string, club: string, points: number, position = points): Player {
  return { id, name: id, club, rankingPoints: points, rankingPosition: position, withdrawn: false }
}

function withPlayers(settings: Settings, players: Player[], code = 'TEST01'): Tournament {
  let t = createTournament(settings, code)
  for (const p of players) t = addPlayer(t, p)
  return t
}

function setsFor(bestOf: 3 | 5, aWins: boolean): { a: number; b: number }[] {
  const win = aWins ? { a: 11, b: 5 } : { a: 5, b: 11 }
  const n = bestOf === 5 ? 3 : 2
  return Array.from({ length: n }, () => ({ ...win }))
}

function playOut(t: Tournament): Tournament {
  for (let guard = 0; guard < 400; guard++) {
    const ready = readyMatches(t)
    if (ready.length === 0) break
    const m = ready[0]!
    const res = enterScore(t, m.id, setsFor(m.bestOf, true))
    if (!res.ok) throw new Error(`${res.error} on ${m.id}`)
    t = res.tournament
  }
  return t
}

describe('bracket seeds and byes', () => {
  it('pairs seed 1 with the last seed', () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
    const slots = seedOrder(32)
    expect(slots[0]).toBe(1)
    expect(slots[1]).toBe(32)
    expect(slots[16]).toBe(2)
    expect(new Set(slots).size).toBe(32)
  })

  it('gives byes to the top seeds', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 16 as const, directSeeds: 16 }
    const players = Array.from({ length: 12 }, (_, i) => player(`p${i + 1}`, `K${i}`, 1000 - i, i + 1))
    const t = withPlayers(settings, players)
    const res = generateMainDraw(t)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const order = seedOrder(16)
    const byeSeeds = res.tournament.mainSlots!
      .map((id, i) => (id ? null : order[i]!))
      .filter((s): s is number => s != null)
    expect(byeSeeds.sort((a, b) => a - b)).toEqual([13, 14, 15, 16])
    const round0 = res.tournament.matches.filter((m) => m.stage === 'main' && m.round === 0 && m.outcome === 'bye')
    expect(round0.length).toBe(4)
  })
})

describe('qualifying plan', () => {
  it('counts two knockout rounds for 60 players into a draw of 32', () => {
    const plan = planKnockout(44, 16)
    expect(plan.bracketSize).toBe(64)
    expect(plan.byes).toBe(20)
    expect(plan.rounds).toEqual([
      { index: 0, matches: 12, byeMatches: 20, advancers: 32 },
      { index: 1, matches: 16, byeMatches: 0, advancers: 16 },
    ])
    const preview = previewQualifying(60, 32, 16, 'knockout')
    expect(preview.direct).toBe(16)
    expect(preview.qualifiers).toBe(16)
    expect(preview.qualifyingRounds).toBe(2)
  })

  it('builds that qualifier and keeps the top seeds out of it', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 32 as const, directSeeds: 16 }
    const players = Array.from({ length: 60 }, (_, i) => player(`p${i + 1}`, i < 8 ? 'AZS' : `K${i % 7}`, 2000 - i, i + 1))
    let t = withPlayers(settings, players, 'GPW60')
    const built = generateQualifying(t)
    expect(built.ok).toBe(true)
    if (!built.ok) return
    t = built.tournament
    const qualPlayers = new Set(
      t.matches.filter((m) => m.stage === 'qualifying').flatMap((m) => [m.slotA, m.slotB].filter((id): id is string => !!id)),
    )
    for (let i = 1; i <= 16; i++) expect(qualPlayers.has(`p${i}`)).toBe(false)
    expect(t.directIds).toEqual(Array.from({ length: 16 }, (_, i) => `p${i + 1}`))
    const real = t.matches.filter((m) => m.stage === 'qualifying' && m.outcome !== 'bye')
    const round1 = real.filter((m) => m.round === 0)
    const round2 = real.filter((m) => m.round === 1)
    expect(round1.length).toBe(12)
    expect(round2.length).toBe(16)
  })
})

describe('draw', () => {
  it('repeats for the same code and records the code', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 16 as const }
    const players = Array.from({ length: 16 }, (_, i) => player(`p${i + 1}`, `K${i % 5}`, 500 - i, i + 1))
    const a = generateMainDraw(withPlayers(settings, players, 'SAME01'))
    const b = generateMainDraw(withPlayers(settings, players, 'SAME01'))
    const c = generateMainDraw(withPlayers(settings, players, 'OTHER1'))
    expect(a.ok && b.ok && c.ok).toBe(true)
    if (!a.ok || !b.ok || !c.ok) return
    expect(a.tournament.mainSlots).toEqual(b.tournament.mainSlots)
    expect(a.tournament.mainSlots).toEqual(c.tournament.mainSlots)
    expect(a.tournament.audit.some((e) => e.code === 'main-built' && e.detail.includes('SAME01'))).toBe(true)
    const order = seedOrder(16)
    expect(a.tournament.mainSlots![order.indexOf(1)]).toBe('p1')
  })

  it('draws inside a band only when that mode is on', () => {
    const players = Array.from({ length: 16 }, (_, i) => player(`p${i + 1}`, `K${i}`, 500 - i, i + 1))
    const fixed = { ...defaultSettings(), mainDrawSize: 16 as const, seeding: 'fixed' as const }
    const bands = { ...fixed, seeding: 'bands' as const }
    const same = generateMainDraw(withPlayers(bands, players, 'SAME01'))
    const again = generateMainDraw(withPlayers(bands, players, 'SAME01'))
    const other = generateMainDraw(withPlayers(bands, players, 'OTHER1'))
    expect(same.ok && again.ok && other.ok).toBe(true)
    if (!same.ok || !again.ok || !other.ok) return
    expect(same.tournament.mainSlots).toEqual(again.tournament.mainSlots)
    expect(same.tournament.mainSlots).not.toEqual(other.tournament.mainSlots)
  })

  it('separates a same-club first-round pair', () => {
    const slots = ['a1', 'a2', 'b1', 'c1', 'd1', 'e1', 'f1', 'g1']
    const seeds = seedOrder(8)
    const clubs: Record<string, string> = { a1: 'AZS', a2: 'AZS', b1: 'B', c1: 'C', d1: 'D', e1: 'E', f1: 'F', g1: 'G' }
    const audit: AuditEvent[] = []
    separateFirstRoundClubs(slots, seeds, (id) => clubs[id] ?? '', () => null, audit, 't')
    for (let i = 0; i < slots.length; i += 2) {
      const x = slots[i]
      const y = slots[i + 1]
      if (x && y) expect(clubs[x]).not.toBe(clubs[y])
    }
    expect(audit.some((e) => e.code === 'club-swap')).toBe(true)
  })

  it('puts same-club seeds 1 and 5 in opposite halves', () => {
    const seeds = seedOrder(8)
    const slots = seeds.map((seed) => `p${seed}`)
    const clubs: Record<string, string> = { p1: 'AZS', p5: 'AZS', p2: 'B', p3: 'C', p4: 'D', p6: 'E', p7: 'F', p8: 'G' }
    const audit: AuditEvent[] = []
    separateTopSeeds(slots, seeds, (id) => clubs[id] ?? '', audit, 't')
    const half = (id: string) => (slots.indexOf(id) < 4 ? 0 : 1)
    expect(half('p1')).not.toBe(half('p5'))
    expect(audit.some((e) => e.code === 'club-swap')).toBe(true)
  })

  it('swaps two main-draw positions and writes an audit line', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 16 as const }
    const players = Array.from({ length: 16 }, (_, i) => player(`p${i + 1}`, 'Klub', 100 - i, i + 1))
    const drawn = generateMainDraw(withPlayers(settings, players))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const before = drawn.tournament.mainSlots!.slice()
    const swapped = swapMainSlots(drawn.tournament, 1, 3)
    expect(swapped.ok).toBe(true)
    if (!swapped.ok) return
    expect(swapped.tournament.mainSlots![1]).toBe(before[3])
    expect(swapped.tournament.mainSlots![3]).toBe(before[1])
    expect(swapped.tournament.audit.some((e) => e.code === 'manual-swap')).toBe(true)
  })
})

describe('groups', () => {
  it('snakes seeds and uses the official order', () => {
    const groups = snakeGroups(['1', '2', '3', '4', '5', '6', '7', '8'], 2)
    expect(groups[0]).toEqual(['1', '4', '5', '8'])
    expect(groups[1]).toEqual(['2', '3', '6', '7'])
    expect(groupPairings(4, 2).map((p) => [p.a, p.b, p.kolejka])).toEqual([
      [0, 2, 0],
      [1, 3, 0],
      [0, 1, 1],
      [2, 3, 1],
      [0, 3, 2],
      [1, 2, 2],
    ])
    expect(groupPairings(4, 1)[0]).toEqual({ a: 0, b: 3, kolejka: 0 })
    expect(groupPairings(3, 2).map((p) => [p.a, p.b])).toEqual([
      [0, 2],
      [0, 1],
      [1, 2],
    ])
  })

  it('breaks ties by head-to-head, then sets, then small points', () => {
    const played = (id: string, a: string, b: string, sets: { a: number; b: number }[], winner: string): Match => ({
      id,
      stage: 'group',
      round: 0,
      index: 0,
      groupId: 'g1',
      label: { k: 'group', group: 'A', n: 1, kolejka: 1 },
      slotA: a,
      slotB: b,
      waitA: false,
      waitB: false,
      sets,
      winnerId: winner,
      outcome: 'score',
      table: null,
      bestOf: 5,
    })
    const three = (winner: 'A' | 'B') =>
      winner === 'A'
        ? [{ a: 11, b: 1 }, { a: 11, b: 1 }, { a: 11, b: 1 }]
        : [{ a: 1, b: 11 }, { a: 1, b: 11 }, { a: 1, b: 11 }]
    const h2h = groupStandings(
      ['a', 'b', 'c', 'd'],
      [
        played('1', 'a', 'b', [{ a: 11, b: 9 }, { a: 9, b: 11 }, { a: 11, b: 9 }, { a: 9, b: 11 }, { a: 11, b: 9 }], 'a'),
        played('2', 'b', 'c', three('A'), 'b'),
        played('3', 'c', 'a', three('A'), 'c'),
        played('4', 'd', 'a', three('A'), 'd'),
        played('5', 'd', 'b', three('A'), 'd'),
        played('6', 'c', 'd', three('A'), 'c'),
      ],
      'seed',
    )
    expect(h2h.filter((s) => s.points === 4).map((s) => s.playerId)).toEqual(['a', 'b'])

    const sets = groupStandings(
      ['a', 'b'],
      [played('1', 'a', 'b', [{ a: 11, b: 9 }, { a: 11, b: 9 }, { a: 11, b: 9 }], 'a')],
      'seed',
    )
    expect(sets.map((s) => s.playerId)).toEqual(['a', 'b'])

    const balls = groupStandings(
      ['a', 'b', 'c'],
      [
        played('1', 'a', 'b', [{ a: 11, b: 1 }, { a: 11, b: 1 }, { a: 11, b: 1 }], 'a'),
        played('2', 'c', 'a', [{ a: 11, b: 9 }, { a: 11, b: 9 }, { a: 11, b: 9 }], 'c'),
        played('3', 'b', 'c', [{ a: 11, b: 9 }, { a: 11, b: 9 }, { a: 11, b: 9 }], 'b'),
      ],
      'seed',
    )
    expect(balls.every((s) => s.points === 3)).toBe(true)
    expect(balls.map((s) => s.playerId)).toEqual(['a', 'c', 'b'])
  })

  it('gives 2 and 0 for a walkover, 2 and 1 for a played loss', () => {
    const base = (id: string, outcome: Match['outcome'], winner: string): Match => ({
      id,
      stage: 'group',
      round: 0,
      index: 0,
      groupId: 'g1',
      label: { k: 'group', group: 'A', n: 1, kolejka: 1 },
      slotA: 'a',
      slotB: 'b',
      waitA: false,
      waitB: false,
      sets: outcome === 'score' ? [{ a: 11, b: 7 }, { a: 11, b: 7 }, { a: 11, b: 7 }] : [],
      winnerId: winner,
      outcome,
      table: null,
      bestOf: 5,
    })
    const wo = groupStandings(['a', 'b'], [base('1', 'walkover', 'a')], 's')
    expect(wo.find((s) => s.playerId === 'a')!.points).toBe(2)
    expect(wo.find((s) => s.playerId === 'b')!.points).toBe(0)
    const playedLoss = groupStandings(['a', 'b'], [base('1', 'score', 'a')], 's')
    expect(playedLoss.find((s) => s.playerId === 'b')!.points).toBe(1)
  })
})

describe('scores, places, points', () => {
  it('accepts sets to 11 win by 2, including deuce', () => {
    expect(isValidSet(11, 9)).toBe(true)
    expect(isValidSet(11, 10)).toBe(false)
    expect(isValidSet(12, 10)).toBe(true)
    expect(isValidSet(15, 13)).toBe(true)
    expect(isValidSet(11, 11)).toBe(false)
    expect(isValidSet(10, 8)).toBe(false)
    expect(isValidSet(13, 11)).toBe(true)
    expect(isValidSet(18, 16)).toBe(true)
    expect(isValidSet(12, 9)).toBe(false)
  })

  it('gives every player a place through the final', () => {
    const settings: Settings = {
      ...defaultSettings(),
      mainDrawSize: 16,
      directSeeds: 16,
      places: { third: true, fiveToEight: true, nineToSixteen: true, seventeenToThirtyTwo: false, nonQualifiers: true },
    }
    const players = Array.from({ length: 8 }, (_, i) => player(`p${i + 1}`, `K${i}`, 80 - i, i + 1))
    const drawn = generateMainDraw(withPlayers(settings, players, 'PLACES'))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const done = playOut(drawn.tournament)
    const rows = classification(done).filter((r) => r.ref.kind === 'place')
    const places = rows.map((r) => r.ref.place).sort((a, b) => a! - b!)
    expect(places).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    const champion = rows.find((r) => r.ref.place === 1)!
    expect(champion.points).toBe(pointsFor('senior', 1))
    expect(done.matches.some((m) => m.label.k === 'main' && m.round === Math.round(Math.log2(16)) - 1 && m.outcome === 'score')).toBe(true)
  })

  it('uses the category points table and a shared band', () => {
    expect(pointsFor('senior', 1)).toBe(90)
    expect(pointsFor('senior', { from: 3, to: 4 })).toBe(79)
    expect(pointsFor('senior', { from: 5, to: 8 })).toBe(71)
    expect(pointsFor('senior', { from: 9, to: 10 })).toBe(64)
    expect(pointsFor('senior', { from: 9, to: 12 })).toBe(62)
    expect(pointsFor('senior', { from: 9, to: 16 })).toBe(57)
    expect(pointsFor('senior', { from: 17, to: 20 })).toBe(44)
    expect(pointsFor('senior', { from: 33, to: 40 })).toBe(18)
    expect(pointsFor('senior', { from: 41, to: 48 })).toBe(16)
    expect(pointsFor('senior', { from: 49, to: 64 })).toBe(14)
    expect(pointsFor('junior', 1)).toBe(70)
    expect(pointsFor('kadet', 1)).toBe(60)
    expect(pointsFor('mlodzik', 1)).toBe(50)
    expect(pointsFor('mlodzik', { from: 9, to: 12 })).toBe(33)
    expect(pointsFor('zak', 1)).toBe(40)
    expect(pointsFor('custom', 1)).toBeNull()
    expect(pointsFor('senior', 18)).toBeNull()
    expect(pointsFor('senior', 1, { '1': 100 })).toBe(100)
  })

  it('bands qualifier losers by the round they lose', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 32 as const, directSeeds: 16 }
    const players = Array.from({ length: 60 }, (_, i) => player(`p${i + 1}`, `K${i % 7}`, 2000 - i, i + 1))
    const built = generateQualifying(withPlayers(settings, players, 'BANDS'))
    expect(built.ok).toBe(true)
    if (!built.ok) return
    const bandOf = (round: number) =>
      built.tournament.matches
        .filter((m) => m.stage === 'qualifying' && m.round === round && m.outcome !== 'bye')
        .map((m) => `${m.placeBand?.from}-${m.placeBand?.to}`)
    expect(bandOf(1).filter((b) => b === '33-40')).toHaveLength(8)
    expect(bandOf(1).filter((b) => b === '41-48')).toHaveLength(8)
    expect(bandOf(0).filter((b) => b === '49-56')).toHaveLength(8)
    expect(bandOf(0).filter((b) => b === '57-64')).toHaveLength(4)
  })

  it('keeps 9–16 as one band and splits 17–32 into the official rows', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 32 as const, directSeeds: 16 }
    const players = Array.from({ length: 32 }, (_, i) => player(`p${i + 1}`, `K${i}`, 900 - i, i + 1))
    const drawn = generateMainDraw(withPlayers(settings, players, 'ROWS'))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const ofRound = (round: number) =>
      drawn.tournament.matches
        .filter((m) => m.stage === 'main' && m.round === round)
        .map((m) => `${m.placeBand?.from}-${m.placeBand?.to}`)
    expect(new Set(ofRound(1))).toEqual(new Set(['9-16']))
    expect(ofRound(0).filter((b) => b === '17-20')).toHaveLength(4)
    expect(ofRound(0).filter((b) => b === '29-32')).toHaveLength(4)
  })
})

describe('group stage into a main draw', () => {
  it('advances the top of each group', () => {
    const settings: Settings = {
      ...defaultSettings(),
      mainDrawSize: 16,
      directSeeds: 0,
      format: 'groups',
      groupSize: 4,
      advancePerGroup: 2,
      places: { third: true, fiveToEight: false, nineToSixteen: false, seventeenToThirtyTwo: false, nonQualifiers: false },
    }
    const players = Array.from({ length: 8 }, (_, i) => player(`p${i + 1}`, `K${i}`, 80 - i, i + 1))
    let t = withPlayers(settings, players, 'GROUPS')
    const q = generateQualifying(t)
    expect(q.ok).toBe(true)
    if (!q.ok) return
    t = playOut(q.tournament)
    const main = generateMainDraw(t)
    expect(main.ok).toBe(true)
    if (!main.ok) return
    const inMain = new Set(main.tournament.mainSlots!.filter((id): id is string => !!id))
    expect(inMain.size).toBe(4)
    const done = playOut(main.tournament)
    const champ = classification(done).find((r) => r.ref.kind === 'place' && r.ref.place === 1)
    expect(champ).toBeTruthy()
  })
})

describe('tables and bands', () => {
  it('moves the next ready match onto a freed table', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 16 as const, tables: 2, autoAssign: true }
    const players = Array.from({ length: 4 }, (_, i) => player(`p${i + 1}`, `K${i}`, 40 - i, i + 1))
    const drawn = generateMainDraw(withPlayers(settings, players, 'TABLE1'))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const first = readyMatches(drawn.tournament)[0]!
    const seated = fillFreedTable({ ...drawn.tournament, settings: { ...drawn.tournament.settings, autoAssign: true } }, null)
    const assigned = enterScore(
      { ...drawn.tournament, matches: drawn.tournament.matches.map((m) => m.id === first.id ? { ...m, table: 1 } : m) },
      first.id,
      setsFor(first.bestOf, true),
    )
    expect(assigned.ok).toBe(true)
    if (!assigned.ok) return
    const next = fillFreedTable(assigned.tournament, 1)
    const onTable = next.matches.find((m) => m.outcome === 'pending' && m.table === 1)
    expect(onTable).toBeTruthy()
    expect(onTable!.id).not.toBe(first.id)
    const off = fillFreedTable({ ...assigned.tournament, settings: { ...assigned.tournament.settings, autoAssign: false } }, 1)
    expect(off.matches.some((m) => m.outcome === 'pending' && m.table === 1)).toBe(false)
    expect(seated.matches.some((m) => m.table === 1)).toBe(false)
  })

  it('orders a shared band by seed, then ranking', () => {
    const players = [
      player('low', 'K', 100, 2),
      player('high', 'K', 200, 1),
      player('mid', 'K', 150, 3),
    ]
    let t = withPlayers(defaultSettings(), players, 'BAND01')
    t = {
      ...t,
      phase: 'main',
      mainSeeds: { high: 4, low: 1, mid: 9 },
      shared: [{ playerIds: ['low', 'high', 'mid'], from: 9, to: 16 }],
    }
    const ids = classification(t).filter((r) => r.ref.kind === 'band').map((r) => r.playerId)
    expect(ids).toEqual(['low', 'high', 'mid'])
  })
})

describe('walkover advances the opponent', () => {
  it('puts the named player through', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 16 as const }
    const players = Array.from({ length: 4 }, (_, i) => player(`p${i + 1}`, 'K', 40 - i, i + 1))
    const drawn = generateMainDraw(withPlayers(settings, players, 'WALK01'))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const m = readyMatches(drawn.tournament)[0]
    expect(m).toBeTruthy()
    const res = enterWalkover(drawn.tournament, m!.id, m!.slotA!)
    expect(res.ok).toBe(true)
    if (!res.ok) return
    const updated = res.tournament.matches.find((x) => x.id === m!.id)!
    expect(updated.outcome).toBe('walkover')
    expect(updated.winnerId).toBe(m!.slotA)
    if (updated.winnerTo) {
      const next = res.tournament.matches.find((x) => x.id === updated.winnerTo!.matchId)!
      const slot = updated.winnerTo.slot === 'A' ? next.slotA : next.slotB
      expect(slot).toBe(m!.slotA)
    }
  })
})

describe('round names', () => {
  it('counts players in the round, so a 32-draw starts at 1/16', () => {
    expect(roundName(64, 'pl')).toBe('1/32')
    expect(roundName(32, 'pl')).toBe('1/16')
    expect(roundName(16, 'pl')).toBe('1/8')
    expect(roundName(8, 'pl')).toBe('Ćwierćfinał')
    expect(roundName(4, 'pl')).toBe('Półfinał')
    expect(roundName(2, 'pl')).toBe('Finał')
    expect(roundName(64, 'en')).toBe('Round of 64')
    expect(roundName(32, 'en')).toBe('Round of 32')
    expect(roundName(16, 'en')).toBe('Round of 16')
    expect(roundName(8, 'en')).toBe('QF')
    expect(roundName(4, 'en')).toBe('SF')
    expect(roundName(2, 'en')).toBe('Final')
  })

  it('uses the Polish cases after a number', () => {
    const word = (n: number) => countForm(n, 'pl', 'mecz', 'mecze', 'meczów')
    expect(word(1)).toBe('mecz')
    expect(word(2)).toBe('mecze')
    expect(word(4)).toBe('mecze')
    expect(word(5)).toBe('meczów')
    expect(word(12)).toBe('meczów')
    expect(word(22)).toBe('mecze')
    expect(word(31)).toBe('mecz')
    expect(word(32)).toBe('mecze')
    expect(countForm(1, 'en', 'match', 'matches', 'matches')).toBe('match')
    expect(countForm(5, 'en', 'match', 'matches', 'matches')).toBe('matches')
  })

  it('labels a 32-player main draw and its qualifier the same way', () => {
    const settings = { ...defaultSettings(), mainDrawSize: 32 as const, directSeeds: 32 }
    const field = Array.from({ length: 32 }, (_, i) => player(`p${i + 1}`, 'K', 2000 - i, i + 1))
    const drawn = generateMainDraw(withPlayers(settings, field, 'NAME32'))
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const first = drawn.tournament.matches.find((m) => m.stage === 'main' && m.round === 0)!
    const last = drawn.tournament.matches.find((m) => m.stage === 'main' && m.placeWin === 1)!
    expect(roundHeading(first, 'pl')).toBe('1/16')
    expect(matchTitle(first, 'en')).toBe('Round of 32')
    expect(roundHeading(last, 'pl')).toBe('Finał')
    expect(matchTitle(last, 'en')).toBe('Final')
    expect(roundHeading(first, 'pl')).not.toBe('1/32')

    const qual = generateQualifying(demoTournament())
    expect(qual.ok).toBe(true)
    if (!qual.ok) return
    const qualMatches = qual.tournament.matches.filter((m) => m.stage === 'qualifying')
    const rounds = Math.max(...qualMatches.map((m) => m.round)) + 1
    const q0 = qualMatches.find((m) => m.round === 0)!
    const q1 = qualMatches.find((m) => m.round === 1)!
    expect(rounds).toBeGreaterThan(1)
    expect(roundHeading(q0, 'pl')).toBe(`Eliminacje, runda 1 z ${rounds}`)
    expect(matchTitle(q0, 'en')).toBe(`Qualifying, round 1 of ${rounds}`)
    expect(roundHeading(q1, 'pl')).toBe(`Eliminacje, runda 2 z ${rounds}`)
    expect(matchTitle(q1, 'en')).toBe(`Qualifying, round 2 of ${rounds}`)
    expect(matchTitle(q0, 'en')).not.toContain('Round of')
  })
})

describe('simulate remaining stays on the current stage', () => {
  it('plays qualifying with set scores, then waits for the main draw', () => {
    const first = simulateRemaining(demoTournament())
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const qual = first.tournament
    expect(qual.phase).not.toBe('main')
    expect(qual.matches.some((m) => m.stage === 'main')).toBe(false)
    const played = qual.matches.filter((m) => m.stage === 'qualifying' && m.outcome !== 'bye')
    expect(played.length).toBeGreaterThan(0)
    expect(played.every((m) => m.outcome === 'score')).toBe(true)
    for (const m of played) {
      expect(m.sets.length).toBeGreaterThanOrEqual(3)
      expect(m.sets.length).toBeLessThanOrEqual(5)
      for (const s of m.sets) expect(isValidSet(s.a, s.b)).toBe(true)
    }
    const again = simulateRemaining(qual)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.tournament.matches.some((m) => m.stage === 'main')).toBe(false)

    let favoured = 0
    let upsets = 0
    for (const m of played) {
      if (!m.slotA || !m.slotB || !m.winnerId) continue
      const pos = (id: string) => qual.players.find((p) => p.id === id)?.rankingPosition ?? 999
      const better = pos(m.slotA) <= pos(m.slotB) ? m.slotA : m.slotB
      if (m.winnerId === better) favoured++
      else upsets++
    }
    expect(favoured).toBeGreaterThan(upsets)
    expect(upsets).toBeGreaterThan(0)

    const drawn = generateMainDraw(qual)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const rest = simulateRemaining(drawn.tournament)
    expect(rest.ok).toBe(true)
    if (!rest.ok) return
    const later = rest.tournament.matches.filter((m) => (m.stage === 'main' || m.stage === 'placement') && m.outcome !== 'bye' && m.outcome !== 'cancelled')
    expect(later.length).toBeGreaterThan(0)
    expect(later.every((m) => m.outcome === 'score')).toBe(true)
    expect(rest.tournament.matches.some((m) => m.outcome === 'walkover')).toBe(false)
    expect(later.some((m) => m.sets.length > (m.bestOf === 5 ? 3 : 2))).toBe(true)
    expect(rest.tournament.matches.some((m) => m.placeWin === 1 && m.winnerId)).toBe(true)

    let close = 0
    let deuce = 0
    let rare = 0
    for (const m of [...played, ...later]) {
      for (const s of m.sets) {
        const hi = Math.max(s.a, s.b)
        const lo = Math.min(s.a, s.b)
        expect(lo).toBeGreaterThanOrEqual(3)
        expect(hi).toBeLessThanOrEqual(13)
        expect(lo === 2 || lo === 4).toBe(false)
        if (hi === 11 && lo >= 5 && lo <= 9) close++
        else if ((hi === 12 && lo === 10) || (hi === 13 && lo === 11)) deuce++
        else if (hi === 11 && lo === 3) rare++
        else throw new Error(`unrealistic set ${hi}:${lo}`)
      }
    }
    expect(close).toBeGreaterThan(deuce)
    expect(close).toBeGreaterThan(rare)
    expect(deuce).toBeGreaterThan(0)
    expect(rare).toBeGreaterThan(0)
  })
})
