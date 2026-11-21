import { describe, expect, it } from 'vitest'
import { tournamentFromJson } from '../storage.ts'
import { addPlayer, createTournament, defaultSettings, enterScore, generateMainDraw, generateQualifying, readyMatches } from './engine.ts'
import { foldName } from './fixed.ts'
import type { Player, Settings, Tournament } from './types.ts'

function player(id: string, points: number, name = id): Player {
  return { id, name, club: 'Klub', rankingPoints: points, rankingPosition: null, withdrawn: false }
}

function sized(size: number, extra: Partial<Settings> = {}): Settings {
  return { ...defaultSettings(), ...extra, mainDrawSize: size as Settings['mainDrawSize'] }
}

function field(settings: Settings, names: string[], code = 'PAPER'): Tournament {
  let t = createTournament(settings, code)
  names.forEach((name, i) => {
    t = addPlayer(t, player(`p${i + 1}`, 2000 - i * 10, name))
  })
  return t
}

function sets(aWins: boolean) {
  const win = aWins ? { a: 11, b: 7 } : { a: 7, b: 11 }
  return [win, win, win]
}

describe('foldName', () => {
  it('ignores case and Polish diacritics', () => {
    expect(foldName('Żółć Anna')).toBe(foldName('zolc anna'))
    expect(foldName('  Łukasz  GÓRSKI ')).toBe('lukasz gorski')
  })
})

describe('fixed qualifying pairings', () => {
  const settings: Settings = sized(4, { directSeeds: 0, tables: 4 })

  it('uses the paper pairs, then feeds winners into the next round', () => {
    const names = ['Adam', 'Bartek', 'Celina', 'Darek', 'Ewa', 'Filip', 'Gosia', 'Henryk']
    let t = field(sized(2, { directSeeds: 0, tables: 4 }), names)
    t = {
      ...t,
      fixedFirstRound: [
        { a: 'Adam', b: 'Bartek' },
        { a: 'Celina', b: 'Darek' },
        { a: 'Ewa', b: 'Filip' },
        { a: 'Henryk', b: 'Gosia' },
      ],
    }
    const drawn = generateQualifying(t)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    t = drawn.tournament
    const round0 = t.matches.filter((m) => m.stage === 'qualifying' && m.round === 0).sort((a, b) => a.index - b.index)
    const pair = (m: (typeof round0)[number]) => [m.slotA, m.slotB].map((id) => t.players.find((p) => p.id === id)?.name)
    expect(round0.map(pair)).toEqual([
      ['Adam', 'Bartek'],
      ['Celina', 'Darek'],
      ['Ewa', 'Filip'],
      ['Henryk', 'Gosia'],
    ])
    expect(t.audit.some((e) => e.code === 'fixed-round')).toBe(true)

    for (const m of round0) {
      const res = enterScore(t, m.id, sets(true))
      expect(res.ok).toBe(true)
      if (res.ok) t = res.tournament
    }
    const round1 = t.matches.filter((m) => m.stage === 'qualifying' && m.round === 1 && m.outcome !== 'bye')
    const namesOf = (id: string | null) => t.players.find((p) => p.id === id)?.name
    expect(round1.map((m) => [namesOf(m.slotA), namesOf(m.slotB)])).toEqual([
      ['Adam', 'Celina'],
      ['Ewa', 'Henryk'],
    ])
    for (const m of round1) {
      const res = enterScore(t, m.id, sets(true))
      expect(res.ok).toBe(true)
      if (res.ok) t = res.tournament
    }
    const main = generateMainDraw(t)
    expect(main.ok).toBe(true)
    if (!main.ok) return
    t = main.tournament
    const final = t.matches.find((m) => m.stage === 'main' && m.placeWin === 1)
    expect(final?.slotA && final.slotB).toBeTruthy()
    const played = enterScore(t, final!.id, sets(true))
    expect(played.ok).toBe(true)
    if (!played.ok) return
    expect(played.tournament.matches.find((m) => m.placeWin === 1)?.winnerId).toBe(final!.slotA)
  })

  it('advances a bye without a match', () => {
    let t = field(settings, ['Adam', 'Bartek', 'Celina', 'Darek', 'Ewa', 'Filip'])
    t = {
      ...t,
      fixedFirstRound: [
        { a: 'Adam', b: null },
        { a: 'Bartek', b: 'wolny los' },
        { a: 'Celina', b: 'Darek' },
        { a: 'Ewa', b: 'Filip' },
      ],
    }
    const drawn = generateQualifying(t)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    t = drawn.tournament
    const bye = t.matches.find((m) => m.outcome === 'bye' && m.winnerId === 'p1')
    expect(bye).toBeTruthy()
    expect(t.qualifierSlots.some((s) => s.playerId === 'p1')).toBe(true)
    expect(t.qualifierSlots.some((s) => s.playerId === 'p2')).toBe(true)
    const match = t.matches.find((m) => m.outcome === 'pending' && m.slotA === 'p3')
    expect(match?.slotB).toBe('p4')
    const scored = enterScore(t, match!.id, sets(false))
    expect(scored.ok).toBe(true)
    if (!scored.ok) return
    const slot = scored.tournament.qualifierSlots.find((s) => s.fromMatchId === match!.id)
    expect(slot?.playerId).toBeNull()
    const main = generateMainDraw(scored.tournament)
    expect(main.ok).toBe(false)
    if (main.ok) return
    for (const m of readyMatches(scored.tournament)) {
      const res = enterScore(scored.tournament, m.id, sets(true))
      expect(res.ok).toBe(true)
      if (res.ok) scored.tournament = res.tournament
    }
    const again = generateMainDraw(scored.tournament)
    expect(again.ok).toBe(true)
    if (!again.ok) return
    const ids = again.tournament.mainSlots?.filter((id): id is string => !!id) ?? []
    expect(ids).toContain('p1')
    expect(ids).toContain('p2')
    expect(ids).toContain('p4')
  })

  it('rejects a duplicate, an unknown name, and a list that skips someone', () => {
    let t = field(settings, ['Adam', 'Bartek', 'Celina', 'Darek', 'Ewa', 'Filip'])
    const missing = generateQualifying({ ...t, fixedFirstRound: [{ a: 'Adam', b: 'Bartek' }] })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error).toBe('fixed-field')

    const twice = generateQualifying({
      ...t,
      fixedFirstRound: [
        { a: 'Adam', b: 'Bartek' },
        { a: 'Adam', b: 'Celina' },
        { a: 'Darek', b: null },
        { a: 'Ewa', b: null },
        { a: 'Filip', b: null },
      ],
    })
    expect(twice.ok).toBe(false)
    if (!twice.ok) expect(twice.error).toBe('fixed-duplicate')

    const unknown = generateQualifying({
      ...t,
      fixedFirstRound: [
        { a: 'Adam', b: 'Nieznany' },
        { a: 'Celina', b: 'Darek' },
        { a: 'Ewa', b: 'Filip' },
        { a: 'Bartek', b: null },
      ],
    })
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toBe('fixed-name')
  })

  it('refuses paper pairings when the event is played in groups', () => {
    const t = field(sized(16, { format: 'groups', directSeeds: 0, tables: 4 }), ['Adam', 'Bartek', 'Celina', 'Darek'])
    const res = generateQualifying({ ...t, fixedFirstRound: [{ a: 'Adam', b: 'Bartek' }, { a: 'Celina', b: 'Darek' }] })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('fixed-groups')
  })
})

describe('fixed main-draw pairings', () => {
  it('places byes and plays through to a champion', () => {
    let t = field(sized(8, { directSeeds: 0 }), ['Adam', 'Bartek', 'Celina', 'Darek'])
    t = {
      ...t,
      fixedFirstRound: [
        { a: 'p1', b: 'p2' },
        { a: 'Celina', b: null },
        { a: 'Darek', b: 'bye' },
      ],
    }
    const drawn = generateMainDraw(t)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    t = drawn.tournament
    const first = t.matches.filter((m) => m.stage === 'main' && m.round === 0).sort((a, b) => a.index - b.index)
    expect(first[0]?.slotA).toBe('p1')
    expect(first[0]?.slotB).toBe('p2')
    expect(first[1]?.winnerId).toBe('p3')
    expect(first[1]?.outcome).toBe('bye')
    expect(first[2]?.winnerId).toBe('p4')
    const final = t.matches.find((m) => m.placeWin === 1)
    expect(final).toBeTruthy()
    for (let guard = 0; guard < 20; guard++) {
      const m = readyMatches(t)[0]
      if (!m) break
      const res = enterScore(t, m.id, sets(true))
      expect(res.ok).toBe(true)
      if (res.ok) t = res.tournament
    }
    expect(t.matches.find((m) => m.placeWin === 1)?.winnerId).toBeTruthy()
    expect(readyMatches(t)).toHaveLength(0)
  })

  it('rejects more pairs than the draw can hold', () => {
    let t = field(sized(4, { directSeeds: 0 }), ['Adam', 'Bartek', 'Celina', 'Darek'])
    t = {
      ...t,
      fixedFirstRound: [
        { a: 'Adam', b: 'Bartek' },
        { a: 'Celina', b: null },
        { a: 'Darek', b: null },
      ],
    }
    const res = generateMainDraw(t)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('fixed-size')
  })
})

describe('handwritten tournament file', () => {
  it('reads players, ranking and paper pairings, then draws that first round', () => {
    const raw = JSON.stringify({
      version: 1,
      settings: { name: 'Grand Prix Kalisz', mainDrawSize: 16, directSeeds: 0 },
      players: [
        { name: 'Kowalski Jan', club: 'KU AZS Poznań', ranking: 1500 },
        { name: 'Nowak Piotr', club: 'UKS Joker Śrem', ranking: 1400 },
        { name: 'Żółć Anna', club: 'KS Start Pleszew', ranking: '#3' },
        { name: 'Wójcik Ewa', club: 'MLKS Piast Gostyń', rankingPoints: 900 },
      ],
      fixedFirstRound: [
        { a: 'Kowalski Jan', b: 'Nowak Piotr' },
        { a: 'zolc anna', b: null },
        { a: 'Wójcik Ewa', b: 'bye' },
      ],
    })
    const t = tournamentFromJson(raw)
    expect(t).toBeTruthy()
    if (!t) return
    expect(t.settings.name).toBe('Grand Prix Kalisz')
    expect(t.settings.mainDrawSize).toBe(16)
    expect(t.settings.bestOf).toBe(5)
    expect(t.phase).toBe('setup')
    expect(t.players.map((p) => p.id)).toEqual(['p-1', 'p-2', 'p-3', 'p-4'])
    expect(t.players[0]?.rankingPoints).toBe(1500)
    expect(t.players[2]?.rankingPoints).toBeNull()
    expect(t.players[2]?.rankingPosition).toBe(3)
    expect(t.players[3]?.rankingPoints).toBe(900)
    const drawn = generateMainDraw(t)
    expect(drawn.ok).toBe(true)
    if (!drawn.ok) return
    const first = drawn.tournament.matches.find((m) => m.stage === 'main' && m.round === 0 && m.index === 0)
    expect(first?.slotA).toBe('p-1')
    expect(first?.slotB).toBe('p-2')
    const zolc = drawn.tournament.matches.find((m) => m.winnerId === 'p-3' && m.outcome === 'bye')
    expect(zolc).toBeTruthy()
  })

  it('keeps a full export intact', () => {
    let t = createTournament({ ...defaultSettings(), name: 'Eksport' }, 'EXP01')
    t = addPlayer(t, player('p1', 10, 'Adam'))
    const parsed = tournamentFromJson(JSON.stringify(t))
    expect(parsed?.id).toBe(t.id)
    expect(parsed?.players).toEqual(t.players)
    expect(parsed?.drawCode).toBe('EXP01')
    expect(parsed?.matches).toEqual([])
  })

  it('reads an official final classification and ignores a broken list', () => {
    const ok = tournamentFromJson(JSON.stringify({
      version: 1,
      settings: { name: 'Finał', mainDrawSize: 16, directSeeds: 0 },
      players: [{ name: 'Kowalski Jan', club: 'KU AZS Poznań', ranking: 1500 }],
      finalClassification: [
        { place: '1', name: 'Kowalski Jan', points: 40 },
        { place: '9-10', name: 'Nowak Piotr', points: 27 },
      ],
    }))
    expect(ok?.finalClassification).toEqual([
      { place: '1', name: 'Kowalski Jan', points: 40 },
      { place: '9-10', name: 'Nowak Piotr', points: 27 },
    ])
    const bad = tournamentFromJson(JSON.stringify({
      version: 1,
      settings: { name: 'Finał', mainDrawSize: 16, directSeeds: 0 },
      players: [{ name: 'Kowalski Jan', club: 'KU AZS Poznań', ranking: 1500 }],
      finalClassification: [{ place: '1' }],
    }))
    expect(bad).toBeTruthy()
    expect(bad?.finalClassification).toBeUndefined()
  })
})

describe('fixed main draw with pending qualifier slots', () => {
  it('shows the main draw before qualifying ends, then fills a slot from the result', () => {
    const names = ['SeedOne', 'SeedTwo', 'SeedThree', 'SeedFour', 'QualA', 'QualB', 'QualC', 'QualD', 'ByeE', 'ByeF']
    let t = field(sized(8, { directSeeds: 4, tables: 4 }), names)
    t = {
      ...t,
      fixedFirstRound: [
        { a: 'QualA', b: 'QualB' },
        { a: 'QualC', b: 'QualD' },
        { a: 'ByeE', b: null },
        { a: 'ByeF', b: null },
      ],
    }
    const qual = generateQualifying(t)
    expect(qual.ok).toBe(true)
    if (!qual.ok) return
    t = qual.tournament
    const main = generateMainDraw(t, [
      { a: 'SeedOne', b: 'QualA / QualB' },
      { a: 'ByeE', b: 'SeedFour' },
      { a: 'SeedThree', b: 'ByeF' },
      { a: 'QualC / QualD', b: 'SeedTwo' },
    ])
    expect(main.ok).toBe(true)
    if (!main.ok) return
    t = main.tournament
    expect(t.phase).toBe('main')
    const first = t.matches.filter((m) => m.stage === 'main' && m.round === 0).sort((a, b) => a.index - b.index)
    const nameOf = (id: string | null) => t.players.find((p) => p.id === id)?.name ?? null
    expect(nameOf(first[0]!.slotA)).toBe('SeedOne')
    expect(first[0]!.slotB).toBeNull()
    expect(first[0]!.waitB).toBe(true)
    expect(nameOf(first[1]!.slotA)).toBe('ByeE')
    expect(nameOf(first[1]!.slotB)).toBe('SeedFour')
    expect(first[1]!.waitA || first[1]!.waitB).toBe(false)
    expect(nameOf(first[3]!.slotB)).toBe('SeedTwo')
    expect(first[3]!.waitA).toBe(true)

    const q = t.matches.find((m) => m.stage === 'qualifying' && m.outcome === 'pending' && nameOf(m.slotA) === 'QualA')!
    expect(q.winnerTo).toEqual({ matchId: first[0]!.id, slot: 'B' })
    const scored = enterScore(t, q.id, sets(true))
    expect(scored.ok).toBe(true)
    if (!scored.ok) return
    t = scored.tournament
    const filled = t.matches.find((m) => m.id === first[0]!.id)!
    expect(nameOf(filled.slotB)).toBe('QualA')
    expect(filled.waitB).toBe(false)
    expect(readyMatches(t).some((m) => m.id === filled.id)).toBe(true)
  })

  it('still refuses a main draw without placeholders while qualifying is open', () => {
    const names = ['SeedOne', 'SeedTwo', 'SeedThree', 'SeedFour', 'QualA', 'QualB', 'QualC', 'QualD', 'ByeE', 'ByeF']
    let t = field(sized(8, { directSeeds: 4, tables: 4 }), names)
    t = {
      ...t,
      fixedFirstRound: [
        { a: 'QualA', b: 'QualB' },
        { a: 'QualC', b: 'QualD' },
        { a: 'ByeE', b: null },
        { a: 'ByeF', b: null },
      ],
    }
    const qual = generateQualifying(t)
    expect(qual.ok).toBe(true)
    if (!qual.ok) return
    const res = generateMainDraw(qual.tournament)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toBe('qualifying-open')
  })
})

