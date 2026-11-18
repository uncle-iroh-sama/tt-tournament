import { describe, expect, it } from 'vitest'
import { classification } from './classify.ts'
import { demoTournament } from '../demo.ts'
import {
  enterScore,
  enterWalkover,
  generateMainDraw,
  generateQualifying,
  qualifyingComplete,
  readyMatches,
} from './engine.ts'
import type { SetScore, Tournament } from './types.ts'

const SWEEP: SetScore[] = [
  { a: 11, b: 5 },
  { a: 11, b: 7 },
  { a: 11, b: 4 },
]

function playOut(start: Tournament): Tournament {
  let t = start
  const qual = generateQualifying(t)
  if (!qual.ok) throw new Error(qual.error)
  t = qual.tournament
  for (let guard = 0; guard < 400 && !qualifyingComplete(t); guard++) {
    const ready = readyMatches(t)
    if (ready.length === 0) break
    const m = ready[0]!
    const winner = m.slotA!
    const res = m.index % 5 === 0 ? enterScore(t, m.id, SWEEP) : enterWalkover(t, m.id, winner)
    if (!res.ok) throw new Error(res.error)
    t = res.tournament
  }
  const main = generateMainDraw(t)
  if (!main.ok) throw new Error(main.error)
  t = main.tournament
  for (let guard = 0; guard < 400; guard++) {
    const ready = readyMatches(t)
    if (ready.length === 0) break
    const m = ready[0]!
    const winner = m.slotA!
    const scored = m.placeWin === 1 || m.index % 7 === 0
    const res = scored ? enterScore(t, m.id, m.bestOf === 3 ? SWEEP.slice(0, 2) : SWEEP) : enterWalkover(t, m.id, winner)
    if (!res.ok) throw new Error(`${res.error} ${m.id}`)
    t = res.tournament
  }
  return t
}

describe('demo tournament', () => {
  it('plays 60 players through qualifying and a main-draw champion', () => {
    const t = playOut(demoTournament())
    expect(qualifyingComplete(t)).toBe(true)
    expect(t.phase).toBe('main')
    const pending = t.matches.filter((m) => m.outcome === 'pending' && m.slotA && m.slotB && !m.waitA && !m.waitB)
    expect(pending).toHaveLength(0)
    const rows = classification(t)
    const champion = rows.find((r) => r.ref.kind === 'place' && r.ref.place === 1)
    expect(champion?.points).toBe(90)
    const places = rows.filter((r) => r.ref.kind === 'place').map((r) => r.ref.place)
    expect(new Set(places).size).toBe(places.length)
    expect(rows.some((r) => r.ref.kind === 'place' && r.ref.place === 3)).toBe(true)
    expect(rows.some((r) => r.ref.kind === 'place' && r.ref.place === 5)).toBe(true)
  })
})
