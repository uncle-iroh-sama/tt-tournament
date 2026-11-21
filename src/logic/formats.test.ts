import { describe, expect, it } from 'vitest'
import { tournamentFromJson } from '../storage.ts'
import { classification } from './classify.ts'
import { addPlayer, createTournament, defaultSettings, enterScore, generateMainDraw, generateQualifying, qualifyingRequired, readyMatches } from './engine.ts'
import type { Settings, Tournament } from './types.ts'

function field(settings: Partial<Settings>, count: number): Tournament {
  let t = createTournament({ ...defaultSettings(), ...settings }, 'FORMAT')
  for (let i = 0; i < count; i++) {
    t = addPlayer(t, { id: `p${i + 1}`, name: `Player ${i + 1}`, club: `Club ${i % 7}`, rankingPoints: 3000 - i, rankingPosition: i + 1 })
  }
  return t
}

/** The better-ranked player (lower number) wins every match 3:0. */
function playOut(start: Tournament): Tournament {
  let t = start
  for (let guard = 0; guard < 1000; guard++) {
    const m = readyMatches(t)[0]
    if (!m) break
    const aWins = Number(m.slotA!.slice(1)) < Number(m.slotB!.slice(1))
    const set = aWins ? { a: 11, b: 4 } : { a: 4, b: 11 }
    const res = enterScore(t, m.id, Array.from({ length: m.bestOf === 5 ? 3 : 2 }, () => set))
    if (!res.ok) throw new Error(`${res.error} on ${m.id}`)
    t = res.tournament
  }
  return t
}

function places(t: Tournament): string[] {
  return classification(t).map((row) => {
    if (row.ref.kind === 'place') return `${row.ref.place}`
    if (row.ref.kind === 'band') return `${row.ref.from}-${row.ref.to}`
    return row.ref.kind
  })
}

describe('format setting', () => {
  it('single elimination plays no place matches and shares each round', () => {
    const drawn = generateMainDraw(field({ bracket: 'single', mainDrawSize: 16 }, 16))
    if (!drawn.ok) throw new Error(drawn.error)
    expect(drawn.tournament.matches.filter((m) => m.stage === 'placement')).toEqual([])
    const done = playOut(drawn.tournament)
    expect(places(done)).toEqual(['1', '2', '3-4', '3-4', '5-8', '5-8', '5-8', '5-8', ...Array(8).fill('9-16')])
  })

  it('places matches decide 3rd place in the placement bracket', () => {
    const drawn = generateMainDraw(field({ bracket: 'placement', mainDrawSize: 8 }, 8))
    if (!drawn.ok) throw new Error(drawn.error)
    const done = playOut(drawn.tournament)
    expect(places(done).slice(0, 4)).toEqual(['1', '2', '3', '4'])
  })

  it('a draw of 8 qualifies a larger field and gives byes to a smaller one', () => {
    const big = field({ mainDrawSize: 8, directSeeds: 4 }, 12)
    expect(qualifyingRequired(big)).toBe(true)
    const qual = generateQualifying(big)
    if (!qual.ok) throw new Error(qual.error)
    expect(qual.tournament.directIds).toHaveLength(4)
    expect(qual.tournament.qualifierSlots).toHaveLength(4)

    const small = generateMainDraw(field({ mainDrawSize: 8 }, 6))
    if (!small.ok) throw new Error(small.error)
    const firstRound = small.tournament.matches.filter((m) => m.stage === 'main' && m.round === 0)
    expect(firstRound).toHaveLength(4)
    expect(firstRound.filter((m) => m.outcome === 'bye')).toHaveLength(2)
  })

  it('never seeds the whole draw directly when qualifying is needed', () => {
    const qual = generateQualifying(field({ mainDrawSize: 8, directSeeds: 16 }, 10))
    if (!qual.ok) throw new Error(qual.error)
    expect(qual.tournament.directIds).toHaveLength(7)
    expect(qual.tournament.qualifierSlots).toHaveLength(1)
  })

  it('reads format and bracket from a short file, and maps the old qualifying mode', () => {
    const short = tournamentFromJson(JSON.stringify({ version: 1, settings: { format: 'knockout', bracket: 'single', mainDrawSize: 8 }, players: [] }))!
    expect(short.settings).toMatchObject({ format: 'knockout', bracket: 'single', mainDrawSize: 8, directSeeds: 4 })
    const legacy = tournamentFromJson(JSON.stringify({ version: 1, settings: { qualifyingMode: 'groups' }, players: [] }))!
    expect(legacy.settings).toMatchObject({ format: 'groups', bracket: 'placement', mainDrawSize: 32, directSeeds: 16 })
    expect('qualifyingMode' in legacy.settings).toBe(false)
    const unknown = tournamentFromJson(JSON.stringify({ version: 1, settings: { format: 'swiss', bracket: 'double', mainDrawSize: 12 }, players: [] }))!
    expect(unknown.settings).toMatchObject({ format: 'knockout', bracket: 'placement', mainDrawSize: 32 })
  })
})
