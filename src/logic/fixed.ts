import type { Player } from './types.ts'

export interface PaperPair {
  a: string
  b: string | null
}

export interface ResolvedPair {
  a: string | null
  b: string | null
}

const BYE = /^(bye|wolny|wolny los|w\.o\.|wo|—|-)$/i

/** Compare names without case or Polish diacritics, so a handwritten file still matches. */
export function foldName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gi, 'l')
    .toLocaleLowerCase('pl')
    .replace(/\s+/g, ' ')
    .trim()
}

function resolveOne(players: Player[], token: string | null): string | null | 'bad' {
  if (token == null) return null
  const text = token.trim()
  if (!text || BYE.test(text)) return null
  const byId = players.find((p) => !p.withdrawn && p.id === text)
  if (byId) return byId.id
  const exact = players.filter((p) => !p.withdrawn && p.name.trim() === text)
  if (exact.length === 1) return exact[0]!.id
  const key = foldName(text)
  const loose = players.filter((p) => !p.withdrawn && foldName(p.name) === key)
  if (loose.length === 1) return loose[0]!.id
  return 'bad'
}

export function resolvePaperPairs(
  players: Player[],
  pairs: PaperPair[],
): { ok: true; pairs: ResolvedPair[] } | { ok: false; error: string } {
  const resolved: ResolvedPair[] = []
  const used = new Set<string>()
  for (const pair of pairs) {
    const a = resolveOne(players, pair.a)
    const b = resolveOne(players, pair.b)
    if (a === 'bad' || b === 'bad') return { ok: false, error: 'fixed-name' }
    if (!a && !b) return { ok: false, error: 'fixed-empty' }
    if ((a && used.has(a)) || (b && used.has(b))) return { ok: false, error: 'fixed-duplicate' }
    if (a) used.add(a)
    if (b) used.add(b)
    resolved.push({ a, b })
  }
  return { ok: true, pairs: resolved }
}

export function sameIds(ids: string[], expected: { id: string }[]): boolean {
  if (ids.length !== expected.length) return false
  const have = new Set(ids)
  return have.size === expected.length && expected.every((p) => have.has(p.id))
}
