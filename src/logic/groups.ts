import { sameRank } from './ranking.ts'
import { hashString, mulberry32, shuffle } from './rng.ts'
import type { AuditEvent, Match, Player, SetScore, Standing } from './types.ts'

export function snakeGroups(ids: string[], groupCount: number): string[][] {
  const groups: string[][] = Array.from({ length: groupCount }, () => [])
  ids.forEach((id, i) => {
    const row = Math.floor(i / groupCount)
    const col = row % 2 === 0 ? i % groupCount : groupCount - 1 - (i % groupCount)
    groups[col]!.push(id)
  })
  return groups
}

/**
 * PZTS 5.2.1 order. For 4 players and 2 advancers the rounds are 1–3/2–4, 1–2/3–4, 1–4/2–3.
 * One or three advancers use 1–4/2–3, 1–3/2–4, 1–2/3–4. A group of 3 drops every pairing with player 4.
 */
export function groupPairings(size: number, advance = 2): { a: number; b: number; kolejka: number }[] {
  const twoAdvance = advance === 2
  if (size === 4) {
    return twoAdvance
      ? [
          { a: 0, b: 2, kolejka: 0 },
          { a: 1, b: 3, kolejka: 0 },
          { a: 0, b: 1, kolejka: 1 },
          { a: 2, b: 3, kolejka: 1 },
          { a: 0, b: 3, kolejka: 2 },
          { a: 1, b: 2, kolejka: 2 },
        ]
      : [
          { a: 0, b: 3, kolejka: 0 },
          { a: 1, b: 2, kolejka: 0 },
          { a: 0, b: 2, kolejka: 1 },
          { a: 1, b: 3, kolejka: 1 },
          { a: 0, b: 1, kolejka: 2 },
          { a: 2, b: 3, kolejka: 2 },
        ]
  }
  if (size === 3) {
    return twoAdvance
      ? [
          { a: 0, b: 2, kolejka: 0 },
          { a: 0, b: 1, kolejka: 1 },
          { a: 1, b: 2, kolejka: 2 },
        ]
      : [
          { a: 1, b: 2, kolejka: 0 },
          { a: 0, b: 2, kolejka: 1 },
          { a: 0, b: 1, kolejka: 2 },
        ]
  }
  if (size === 5 || size === 6) return sizedPairings(size, twoAdvance ? 'two' : 'one')
  if (size === 2) return [{ a: 0, b: 1, kolejka: 0 }]
  return circlePairings(size)
}

function sizedPairings(size: number, kind: 'two' | 'one'): { a: number; b: number; kolejka: number }[] {
  const rounds = kind === 'two'
    ? [
        [[1, 4], [2, 5], [3, 6]],
        [[1, 6], [2, 4], [3, 5]],
        [[1, 3], [2, 6], [4, 5]],
        [[1, 5], [2, 3], [4, 6]],
        [[1, 2], [3, 4], [5, 6]],
      ]
    : [
        [[1, 6], [2, 5], [3, 4]],
        [[1, 5], [2, 3], [4, 6]],
        [[1, 4], [2, 6], [3, 5]],
        [[1, 3], [2, 4], [5, 6]],
        [[1, 2], [3, 6], [4, 5]],
      ]
  const out: { a: number; b: number; kolejka: number }[] = []
  rounds.forEach((round, kolejka) => {
    for (const [a, b] of round) {
      if (a <= size && b <= size) out.push({ a: a - 1, b: b - 1, kolejka })
    }
  })
  return out
}

function circlePairings(n: number): { a: number; b: number; kolejka: number }[] {
  const m = n % 2 === 0 ? n : n + 1
  let ring = Array.from({ length: m }, (_, i) => i)
  const out: { a: number; b: number; kolejka: number }[] = []
  for (let r = 0; r < m - 1; r++) {
    const half = m / 2
    for (let i = 0; i < half; i++) {
      const a = ring[i]!
      const b = ring[m - 1 - i]!
      if (a < n && b < n) out.push({ a, b, kolejka: r })
    }
    ring = [ring[0]!, ring[m - 1]!, ...ring.slice(1, m - 1)]
  }
  return out
}

export function separateGroupClubs(
  groups: string[][],
  clubOf: (id: string) => string,
  audit: AuditEvent[],
  at: string,
): void {
  const club = (id: string) => clubOf(id).trim().toLocaleLowerCase('pl')
  for (let pass = 0; pass < 8; pass++) {
    let changed = false
    for (let g = 0; g < groups.length; g++) {
      const ids = groups[g]!
      const seen = new Map<string, number>()
      for (let i = 0; i < ids.length; i++) {
        const c = club(ids[i]!)
        if (!c) continue
        if (!seen.has(c)) {
          seen.set(c, i)
          continue
        }
        const moveAt = i
        const moved = ids[moveAt]!
        let dest: { g: number; i: number } | null = null
        for (let h = 0; h < groups.length && !dest; h++) {
          if (h === g) continue
          for (let j = 0; j < groups[h]!.length; j++) {
            const other = groups[h]![j]!
            if (club(other) === c) continue
            if (groups[h]!.some((id) => club(id) === c && id !== other)) continue
            const otherClub = club(other)
            if (otherClub && ids.some((id) => id !== moved && club(id) === otherClub)) continue
            dest = { g: h, i: j }
            break
          }
        }
        if (!dest) {
          audit.push({ at, code: 'club-unresolved', detail: `group ${g + 1}: ${moved}` })
          continue
        }
        const other = groups[dest.g]![dest.i]!
        ids[moveAt] = other
        groups[dest.g]![dest.i] = moved
        audit.push({ at, code: 'group-swap', detail: `${moved} <-> ${other}` })
        changed = true
        break
      }
    }
    if (!changed) break
  }
}

export function shuffleTies(players: Player[], rng: () => number, audit: AuditEvent[], at: string): Player[] {
  const sorted = players.slice().sort((a, b) => {
    const ap = a.rankingPoints
    const bp = b.rankingPoints
    if (ap != null && bp != null && ap !== bp) return bp - ap
    if (ap != null && bp == null) return -1
    if (ap == null && bp != null) return 1
    const ar = a.rankingPosition
    const br = b.rankingPosition
    if (ar != null && br != null && ar !== br) return ar - br
    if (ar != null && br == null) return -1
    if (ar == null && br != null) return 1
    return a.name.localeCompare(b.name, 'pl')
  })
  const out: Player[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i + 1
    while (j < sorted.length && sameRank(sorted[i]!, sorted[j]!)) j++
    const chunk = sorted.slice(i, j)
    if (chunk.length > 1) {
      const shuffled = shuffle(chunk, rng)
      audit.push({
        at,
        code: 'tie-shuffle',
        detail: shuffled.map((p) => p.id).join(','),
      })
      out.push(...shuffled)
    } else {
      out.push(chunk[0]!)
    }
    i = j
  }
  return out
}

interface Stats {
  points: number
  played: number
  wins: number
  sw: number
  sl: number
  bw: number
  bl: number
}

function blankStats(): Stats {
  return { points: 0, played: 0, wins: 0, sw: 0, sl: 0, bw: 0, bl: 0 }
}

function addSets(stats: Stats, sets: SetScore[], side: 'A' | 'B') {
  for (const s of sets) {
    const mine = side === 'A' ? s.a : s.b
    const opp = side === 'A' ? s.b : s.a
    stats.bw += mine
    stats.bl += opp
    if (mine > opp) stats.sw++
    else stats.sl++
  }
}

export function ratio(won: number, lost: number): number {
  if (won === 0 && lost === 0) return 0
  if (lost === 0) return Number.POSITIVE_INFINITY
  return won / lost
}

function accumulate(ids: string[], matches: Match[], onlyAmong: Set<string> | null): Map<string, Stats> {
  const map = new Map<string, Stats>()
  for (const id of ids) map.set(id, blankStats())
  for (const m of matches) {
    if (m.outcome === 'pending' || m.outcome === 'bye' || m.outcome === 'cancelled') continue
    if (!m.slotA || !m.slotB || !m.winnerId) continue
    if (!map.has(m.slotA) || !map.has(m.slotB)) continue
    if (onlyAmong && (!onlyAmong.has(m.slotA) || !onlyAmong.has(m.slotB))) continue
    const a = map.get(m.slotA)!
    const b = map.get(m.slotB)!
    const loserId = m.winnerId === m.slotA ? m.slotB : m.slotA
    if (m.outcome === 'walkover' || (m.outcome === 'retirement' && m.sets.length === 0)) {
      map.get(m.winnerId)!.points += 2
      map.get(m.winnerId)!.wins += 1
      map.get(m.winnerId)!.played += 1
      map.get(loserId)!.played += 1
      continue
    }
    map.get(m.winnerId)!.points += 2
    map.get(m.winnerId)!.wins += 1
    /* ITTF: 1 match point for a loss in a played match, none for an uncompleted one. */
    if (m.outcome !== 'retirement') map.get(loserId)!.points += 1
    a.played++
    b.played++
    if (m.sets.length > 0) {
      addSets(a, m.sets, 'A')
      addSets(b, m.sets, 'B')
    } else if (m.games) {
      a.sw += m.games.a
      a.sl += m.games.b
      b.sw += m.games.b
      b.sl += m.games.a
    }
  }
  return map
}

function tieBreakOrder(ids: string[], matches: Match[], overall: Map<string, Stats>, tieSeed: string): string[] {
  if (ids.length <= 1) return ids
  const among = new Set(ids)
  const mini = accumulate(ids, matches, among)
  const keys = ['points', 'sets', 'balls'] as const
  const split = (list: string[], key: (id: string) => number): string[][] | null => {
    const decorated = list.map((id) => ({ id, v: key(id) }))
    decorated.sort((a, b) => b.v - a.v)
    const buckets: string[][] = []
    for (const row of decorated) {
      const last = buckets[buckets.length - 1]
      if (!last || key(last[0]!) !== row.v) buckets.push([row.id])
      else last.push(row.id)
    }
    return buckets.length > 1 ? buckets : null
  }
  const miniKey = (key: (typeof keys)[number]) => (id: string) => {
    const s = mini.get(id)!
    if (key === 'points') return s.points
    if (key === 'sets') return ratio(s.sw, s.sl)
    return ratio(s.bw, s.bl)
  }
  for (const key of keys) {
    const buckets = split(ids, miniKey(key))
    if (buckets) {
      return buckets.flatMap((b) => (b.length === ids.length ? b : tieBreakOrder(b, matches, overall, tieSeed)))
    }
  }
  const overallKey = (kind: 'sets' | 'balls') => (id: string) => {
    const s = overall.get(id)!
    return kind === 'sets' ? ratio(s.sw, s.sl) : ratio(s.bw, s.bl)
  }
  for (const kind of ['sets', 'balls'] as const) {
    const buckets = split(ids, overallKey(kind))
    if (buckets) {
      return buckets.flatMap((b) => (b.length === ids.length ? b : tieBreakOrder(b, matches, overall, tieSeed)))
    }
  }
  const tied = ids.slice().sort()
  return shuffle(tied, mulberry32(hashString(`${tieSeed}|${tied.join(',')}`)))
}

export function rankGroup(playerIds: string[], matches: Match[], tieSeed: string): string[] {
  const ids = playerIds.slice()
  const overall = accumulate(ids, matches, null)
  const byPoints = new Map<number, string[]>()
  for (const id of ids) {
    const pts = overall.get(id)!.points
    const list = byPoints.get(pts) ?? []
    list.push(id)
    byPoints.set(pts, list)
  }
  const pointsDesc = [...byPoints.keys()].sort((a, b) => b - a)
  const ordered: string[] = []
  for (const pts of pointsDesc) {
    ordered.push(...tieBreakOrder(byPoints.get(pts)!, matches, overall, tieSeed))
  }
  return ordered
}

export function groupStandings(playerIds: string[], matches: Match[], tieSeed: string): Standing[] {
  const order = rankGroup(playerIds, matches, tieSeed)
  const overall = accumulate(playerIds, matches, null)
  return order.map((playerId, index) => {
    const s = overall.get(playerId)!
    return {
      playerId,
      points: s.points,
      played: s.played,
      wins: s.wins,
      setsWon: s.sw,
      setsLost: s.sl,
      ballsWon: s.bw,
      ballsLost: s.bl,
      setRatio: ratio(s.sw, s.sl),
      ballRatio: ratio(s.bw, s.bl),
      place: index + 1,
    }
  })
}

export function groupMatchesDone(matches: Match[], groupId: string): boolean {
  const list = matches.filter((m) => m.groupId === groupId)
  return list.length > 0 && list.every((m) => m.outcome !== 'pending')
}
