import type { Match, Player } from './types.ts'

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


export interface ResolvedMainPair extends ResolvedPair {
  waitA?: string
  waitB?: string
}

const VERSUS = /\s*\/\s*|\s+vs\.?\s+|\s+v\s+|\s+[–—−-]\s+/i

function parseTwoNames(token: string): [string, string] | null {
  const parts = token.split(VERSUS).map((part) => part.trim()).filter(Boolean)
  if (parts.length !== 2) return null
  return [parts[0]!, parts[1]!]
}

function qualifyingBetween(matches: Match[], a: string, b: string): Match | null | 'many' {
  const hits = matches.filter(
    (m) =>
      m.stage === 'qualifying' &&
      ((m.slotA === a && m.slotB === b) || (m.slotA === b && m.slotB === a)),
  )
  if (hits.length === 0) return null
  if (hits.length > 1) return 'many'
  return hits[0]!
}

function resolveMainSide(
  players: Player[],
  matches: Match[],
  token: string | null,
): { ok: true; id: string | null; wait?: string } | { ok: false; error: string } {
  const direct = resolveOne(players, token)
  if (direct !== 'bad') return { ok: true, id: direct }
  if (token == null) return { ok: false, error: 'fixed-name' }
  const two = parseTwoNames(token)
  if (!two) return { ok: false, error: 'fixed-name' }
  const left = resolveOne(players, two[0])
  const right = resolveOne(players, two[1])
  if (left === 'bad' || right === 'bad' || !left || !right) return { ok: false, error: 'fixed-name' }
  const match = qualifyingBetween(matches, left, right)
  if (!match || match === 'many') return { ok: false, error: 'fixed-wait' }
  if (match.outcome !== 'pending' && match.winnerId) return { ok: true, id: match.winnerId }
  if (match.outcome === 'pending') return { ok: true, id: null, wait: match.id }
  return { ok: false, error: 'fixed-wait' }
}

/** Resolve paper pairs for a main draw, including "Name / Name" placeholders for unfinished qualifier matches. */
export function resolveMainPaperPairs(
  players: Player[],
  matches: Match[],
  pairs: PaperPair[],
): { ok: true; pairs: ResolvedMainPair[] } | { ok: false; error: string } {
  const resolved: ResolvedMainPair[] = []
  const used = new Set<string>()
  const usedWaits = new Set<string>()
  for (const pair of pairs) {
    const a = resolveMainSide(players, matches, pair.a)
    const b = resolveMainSide(players, matches, pair.b)
    if (!a.ok) return a
    if (!b.ok) return b
    if (!a.id && !a.wait && !b.id && !b.wait) return { ok: false, error: 'fixed-empty' }
    if ((a.id && used.has(a.id)) || (b.id && used.has(b.id))) return { ok: false, error: 'fixed-duplicate' }
    if ((a.wait && usedWaits.has(a.wait)) || (b.wait && usedWaits.has(b.wait))) return { ok: false, error: 'fixed-duplicate' }
    if (a.id) used.add(a.id)
    if (b.id) used.add(b.id)
    if (a.wait) usedWaits.add(a.wait)
    if (b.wait) usedWaits.add(b.wait)
    const row: ResolvedMainPair = { a: a.id, b: b.id }
    if (a.wait) row.waitA = a.wait
    if (b.wait) row.waitB = b.wait
    resolved.push(row)
  }
  return { ok: true, pairs: resolved }
}

export function sameIdList(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const have = new Set(left)
  return have.size === left.length && right.every((id) => have.has(id))
}

export function sameIds(ids: string[], expected: { id: string }[]): boolean {
  if (ids.length !== expected.length) return false
  const have = new Set(ids)
  return have.size === expected.length && expected.every((p) => have.has(p.id))
}
