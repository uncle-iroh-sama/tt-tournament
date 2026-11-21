import { describe, expect, it } from 'vitest'
import { classification } from './classify.ts'
import { addPlayer, createTournament, defaultSettings, enterRetirement, enterScore, enterWalkover, generateMainDraw, generateQualifying } from './engine.ts'
import { groupStandings } from './groups.ts'
import type { SetScore, Tournament } from './types.ts'

function roundRobin(count: number): Tournament {
  let t = createTournament({ ...defaultSettings(), format: 'roundRobin' }, 'RR')
  for (let i = 0; i < count; i++) {
    t = addPlayer(t, { id: `p${i + 1}`, name: `Player ${i + 1}`, club: 'KS', rankingPoints: 100 - i, rankingPosition: i + 1 })
  }
  const built = generateQualifying(t)
  if (!built.ok) throw new Error(built.error)
  return built.tournament
}

const won = (a: number, b: number): SetScore => ({ a, b })

/** Plays a–b with sets written from a's side; a missing match is played 3:0 by the better-ranked player. */
function play(start: Tournament, results: Record<string, SetScore[] | 'wo' | 'ret'>): Tournament {
  let t = start
  for (const m of t.matches) {
    const key = `${m.slotA}-${m.slotB}`
    const flipped = `${m.slotB}-${m.slotA}`
    const given = results[key] ?? results[flipped]
    const res = (() => {
      if (given === 'wo') return enterWalkover(t, m.id, results[key] ? m.slotA! : m.slotB!)
      if (given === 'ret') return enterRetirement(t, m.id, results[key] ? m.slotA! : m.slotB!, [won(11, 5)])
      const better = Number(m.slotA!.slice(1)) < Number(m.slotB!.slice(1))
      const sets = given ? (results[key] ? given : given.map((s) => won(s.b, s.a))) : Array(3).fill(better ? won(11, 3) : won(3, 11))
      return enterScore(t, m.id, sets)
    })()
    if (!res.ok) throw new Error(`${res.error} on ${key}`)
    t = res.tournament
  }
  return t
}

function table(t: Tournament): { id: string; points: number }[] {
  const g = t.groups[0]!
  return groupStandings(g.playerIds, t.matches, `${t.drawCode}:${g.id}`).map((r) => ({ id: r.playerId, points: r.points }))
}

describe('round robin', () => {
  it('schedules everyone against everyone once, one match per player per round', () => {
    for (const n of [3, 4, 5, 6, 7, 10]) {
      const t = roundRobin(n)
      expect(t.groups).toHaveLength(1)
      expect(t.matches).toHaveLength((n * (n - 1)) / 2)
      const pairs = new Set(t.matches.map((m) => [m.slotA, m.slotB].sort().join('-')))
      expect(pairs.size).toBe(t.matches.length)
      const rounds = new Map<number, string[]>()
      for (const m of t.matches) rounds.set(m.round, [...(rounds.get(m.round) ?? []), m.slotA!, m.slotB!])
      for (const ids of rounds.values()) expect(new Set(ids).size).toBe(ids.length)
      expect(rounds.size).toBe(n % 2 === 0 ? n - 1 : n)
    }
  })

  it('has no knock-out and turns the finished table into the classification', () => {
    const t = roundRobin(5)
    expect(generateMainDraw(t)).toEqual({ ok: false, error: 'no-knockout' })
    expect(classification(t).every((r) => r.ref.kind === 'pending')).toBe(true)
    const done = play(t, {})
    expect(classification(done).map((r) => [r.playerId, r.ref.place])).toEqual([['p1', 1], ['p2', 2], ['p3', 3], ['p4', 4], ['p5', 5]])
  })

  it('breaks a three-way tie on head-to-head sets', () => {
    const done = play(roundRobin(4), {
      'p1-p2': [won(11, 3), won(11, 3), won(11, 3)],
      'p2-p3': [won(11, 3), won(11, 3), won(11, 3)],
      'p3-p1': [won(11, 3), won(11, 3), won(3, 11), won(3, 11), won(11, 3)],
    })
    expect(table(done)).toEqual([
      { id: 'p1', points: 5 }, { id: 'p2', points: 5 }, { id: 'p3', points: 5 }, { id: 'p4', points: 3 },
    ])
  })

  it('then on head-to-head points when the sets are level', () => {
    const done = play(roundRobin(4), {
      'p1-p2': [won(1, 11), won(11, 1), won(11, 1), won(11, 1)],
      'p2-p3': [won(9, 11), won(11, 9), won(11, 9), won(11, 9)],
      'p3-p1': [won(9, 11), won(11, 9), won(11, 9), won(11, 9)],
    })
    expect(table(done).map((r) => r.id)).toEqual(['p1', 'p3', 'p2', 'p4'])
  })

  it('gives no match point for a walkover or a retirement loss', () => {
    const done = play(roundRobin(3), { 'p1-p3': 'wo', 'p2-p3': 'ret' })
    expect(table(done)).toEqual([{ id: 'p1', points: 4 }, { id: 'p2', points: 3 }, { id: 'p3', points: 0 }])
  })
})
