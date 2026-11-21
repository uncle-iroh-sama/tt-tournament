import { describe, expect, it } from 'vitest'
import { classification } from './classify.ts'
import { addPlayer, createTournament, defaultSettings, enterScore, generateMainDraw, generateQualifying, readyMatches } from './engine.ts'
import { groupStandings } from './groups.ts'
import type { Settings, Tournament } from './types.ts'

function groupStage(settings: Partial<Settings>, count: number, code = 'GROUPS'): Tournament {
  let t = createTournament({ ...defaultSettings(), format: 'groups', directSeeds: 0, ...settings }, code)
  for (let i = 0; i < count; i++) {
    t = addPlayer(t, { id: `p${i + 1}`, name: `Player ${i + 1}`, club: `Club ${i % 5}`, rankingPoints: 3000 - i, rankingPosition: i + 1 })
  }
  const built = generateQualifying(t)
  if (!built.ok) throw new Error(built.error)
  return built.tournament
}

/** Plays every ready match; `upset` lets the worse-ranked player win when it returns true. */
function playOut(start: Tournament, upset: (a: number, b: number) => boolean = () => false): Tournament {
  let t = start
  for (let m = readyMatches(t)[0]; m; m = readyMatches(t)[0]) {
    const a = Number(m.slotA!.slice(1))
    const b = Number(m.slotB!.slice(1))
    const aWins = (a < b) !== upset(a, b)
    const res = enterScore(t, m.id, Array.from({ length: m.bestOf === 5 ? 3 : 2 }, () => (aWins ? { a: 11, b: 4 } : { a: 4, b: 11 })))
    if (!res.ok) throw new Error(`${res.error} on ${m.id}`)
    t = res.tournament
  }
  return t
}

function knockout(settings: Partial<Settings>, count: number, code?: string): Tournament {
  const drawn = generateMainDraw(playOut(groupStage(settings, count, code), (a, b) => (a * 7 + b * 3) % 5 === 0))
  if (!drawn.ok) throw new Error(drawn.error)
  return drawn.tournament
}

/** For each pair from one group, the round in which they could first meet (0 = first round). */
function meetings(t: Tournament): number[] {
  const slots = t.mainSlots!
  const groupOf = (id: string) => t.groups.find((g) => g.playerIds.includes(id))!.id
  const out: number[] = []
  slots.forEach((a, i) => slots.forEach((b, j) => {
    if (a && b && i < j && groupOf(a) === groupOf(b)) out.push(Math.floor(Math.log2(i ^ j)))
  }))
  return out
}

describe('groups then knock-out', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 11, 16])('keeps the two from each of %i groups apart until the final', (groups) => {
    const t = knockout({ groupSize: 4, advancePerGroup: 2 }, groups * 4, `SPLIT${groups}`)
    const size = t.mainSlots!.length
    expect(size).toBe(Math.min(32, 2 ** Math.ceil(Math.log2(groups * 2))))
    expect(t.mainSlots!.filter(Boolean)).toHaveLength(Math.min(size, groups * 2))
    expect(meetings(t)).toEqual(Array(groups).fill(Math.log2(size) - 1))
  })

  it.each([2, 3, 4, 6, 8])('keeps three from each of %i groups in different quarters', (groups) => {
    const t = knockout({ groupSize: 5, advancePerGroup: 3 }, groups * 5, `THREE${groups}`)
    const size = t.mainSlots!.length
    expect(meetings(t)).toHaveLength(groups * 3)
    for (const round of meetings(t)) expect(round).toBeGreaterThanOrEqual(Math.log2(size) - 2)
  })

  it('seeds group winners first, in group order, with the byes against them', () => {
    const t = knockout({ groupSize: 4, advancePerGroup: 2, seeding: 'fixed' }, 20, 'SEEDS')
    expect(t.mainSlots).toHaveLength(16)
    const winners = t.groups.map((g) => groupStandings(g.playerIds, t.matches, `${t.drawCode}:${g.id}`)[0]!.playerId)
    expect(winners.map((id) => t.mainSeeds[id])).toEqual([1, 2, 3, 4, 5])
    const byes = t.matches.filter((m) => m.stage === 'main' && m.round === 0 && m.outcome === 'bye')
    expect(byes.map((m) => t.mainSeeds[(m.slotA ?? m.slotB)!]).sort((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it.each(['single', 'placement', 'consolation'] as const)('plays the knock-out in the %s style', (bracket) => {
    const done = playOut(knockout({ groupSize: 4, advancePerGroup: 2, bracket, mainDrawSize: 8 }, 16, 'STYLE'))
    expect(done.matches.filter((m) => m.outcome === 'pending')).toEqual([])
    expect(done.matches.some((m) => m.label.k === 'cons')).toBe(bracket === 'consolation')
    const rows = classification(done)
    expect(rows.filter((r) => r.ref.kind === 'place' && r.ref.place! <= 2)).toHaveLength(2)
    if (bracket !== 'single') expect(rows.slice(0, 8).map((r) => r.ref)).toEqual(Array.from({ length: 8 }, (_, i) => ({ kind: 'place', place: i + 1 })))
  })
})
