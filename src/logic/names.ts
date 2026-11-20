import type { Player } from './types.ts'
import { foldName } from './fixed.ts'

function tokens(name: string): string[] {
  return foldName(name).split(' ').filter(Boolean)
}

function tokenKey(name: string): string {
  return tokens(name).slice().sort().join(' ')
}

export type NameHit =
  | { ok: true; player: Player }
  | { ok: false; error: 'none' | 'ambiguous'; names: string[] }

/**
 * Match a spoken or typed name. Order does not matter, diacritics do not matter,
 * and a single surname is enough when only one player has it.
 */
export function findPlayerByName(players: Player[], query: string): NameHit {
  const pool = players.filter((p) => !p.withdrawn)
  const qTokens = tokens(query)
  if (qTokens.length === 0) return { ok: false, error: 'none', names: [] }
  const qKey = qTokens.slice().sort().join(' ')
  const exact = pool.filter((p) => tokenKey(p.name) === qKey)
  if (exact.length === 1) return { ok: true, player: exact[0]! }
  if (exact.length > 1) return { ok: false, error: 'ambiguous', names: exact.map((p) => p.name) }
  if (qTokens.length === 1) {
    const token = qTokens[0]!
    const hits = pool.filter((p) => tokens(p.name).includes(token))
    if (hits.length === 1) return { ok: true, player: hits[0]! }
    if (hits.length > 1) return { ok: false, error: 'ambiguous', names: hits.map((p) => p.name) }
  }
  return { ok: false, error: 'none', names: [] }
}
