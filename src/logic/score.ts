import type { SetScore } from './types.ts'

export function isValidSet(a: number, b: number): boolean {
  if (!Number.isInteger(a) || !Number.isInteger(b)) return false
  if (a < 0 || b < 0 || a === b) return false
  const hi = Math.max(a, b)
  const lo = Math.min(a, b)
  if (hi < 11) return false
  if (hi - lo < 2) return false
  if (lo < 10) return hi === 11
  return hi - lo === 2
}

export function setsNeeded(bestOf: 3 | 5): number {
  return bestOf === 5 ? 3 : 2
}

/** Winner side, or null when the sets are not a finished, legal match. */
export function matchWinner(sets: SetScore[], bestOf: 3 | 5): 'A' | 'B' | null {
  const need = setsNeeded(bestOf)
  let a = 0
  let b = 0
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]!
    if (!isValidSet(s.a, s.b)) return null
    if (s.a > s.b) a++
    else b++
    if ((a >= need || b >= need) && i < sets.length - 1) return null
  }
  if (a >= need && a > b) return 'A'
  if (b >= need && b > a) return 'B'
  return null
}

export type ScoreError = 'invalid-set' | 'no-winner' | 'extra-sets' | 'empty'

/**
 * A set-count such as 3:1, from the first player's point of view.
 * The deciding set is last, and every set is a plain 11:5, so the match is a legal score.
 */
export function setsFromCount(a: number, b: number): SetScore[] | null {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a === b) return null
  const winner = a > b ? 'A' : 'B'
  const winCount = Math.max(a, b)
  const loseCount = Math.min(a, b)
  const order: Array<'A' | 'B'> = []
  for (let i = 0; i < loseCount; i++) order.push(winner === 'A' ? 'B' : 'A')
  for (let i = 0; i < winCount; i++) order.push(winner)
  return order.map((side) => (side === 'A' ? { a: 11, b: 5 } : { a: 5, b: 11 }))
}

export function explainSets(sets: SetScore[], bestOf: 3 | 5): ScoreError | null {
  if (sets.length === 0) return 'empty'
  const need = setsNeeded(bestOf)
  let a = 0
  let b = 0
  for (let i = 0; i < sets.length; i++) {
    const s = sets[i]!
    if (!isValidSet(s.a, s.b)) return 'invalid-set'
    if (a >= need || b >= need) return 'extra-sets'
    if (s.a > s.b) a++
    else b++
  }
  if (a >= need || b >= need) return null
  return 'no-winner'
}
