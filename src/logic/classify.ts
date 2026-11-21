import { groupMatchesDone, rankGroup } from './groups.ts'
import { pointsFor } from './points.ts'
import { compareRanking } from './ranking.ts'
import type { Match, Player, Tournament } from './types.ts'

export interface PlaceRef {
  kind: 'place' | 'band' | 'pending' | 'out'
  place?: number
  from?: number
  to?: number
}

export interface ClassRow {
  playerId: string
  ref: PlaceRef
  points: number | null
}

function loserOf(m: Match): string | null {
  if (!m.winnerId || !m.slotA || !m.slotB) return null
  return m.winnerId === m.slotA ? m.slotB : m.slotA
}

export function classification(t: Tournament): ClassRow[] {
  const exact = new Map<string, number>()
  const bands = new Map<string, { from: number; to: number }>()
  for (const a of t.awards) exact.set(a.playerId, a.place)
  if (t.settings.format === 'roundRobin') roundRobinPlaces(t, exact)
  for (const m of t.matches) {
    if (m.outcome === 'skipped' && m.placeBand) {
      for (const id of [m.slotA, m.slotB]) if (id) bands.set(id, m.placeBand)
    }
    if (m.outcome === 'pending' || m.outcome === 'cancelled') continue
    if (m.winnerId && m.placeWin != null) exact.set(m.winnerId, m.placeWin)
    const loser = loserOf(m)
    if (loser && m.placeLose != null) exact.set(loser, m.placeLose)
    if (loser && m.placeBand && !m.loserTo && m.placeLose == null) {
      bands.set(loser, m.placeBand)
    }
  }
  for (const band of t.shared) {
    for (const id of band.playerIds) {
      if (!exact.has(id)) bands.set(id, { from: band.from, to: band.to })
    }
  }
  const competing = new Set<string>()
  for (const m of t.matches) {
    if (m.outcome !== 'pending') continue
    if (m.slotA && !m.waitA) competing.add(m.slotA)
    if (m.slotB && !m.waitB) competing.add(m.slotB)
  }
  const rows: ClassRow[] = []
  const category = t.settings.pointsCategory
  const override = t.settings.pointsOverride[category]
  for (const p of t.players) {
    if (p.withdrawn) {
      rows.push({ playerId: p.id, ref: { kind: 'out' }, points: null })
      continue
    }
    if (exact.has(p.id)) {
      const place = exact.get(p.id)!
      rows.push({
        playerId: p.id,
        ref: { kind: 'place', place },
        points: pointsFor(category, place, override),
      })
      continue
    }
    const band = bands.get(p.id)
    if (band) {
      rows.push({
        playerId: p.id,
        ref: { kind: 'band', from: band.from, to: band.to },
        points: pointsFor(category, band, override),
      })
      continue
    }
    if (competing.has(p.id) || t.phase !== 'setup') {
      rows.push({ playerId: p.id, ref: { kind: 'pending' }, points: null })
    }
  }
  const rank = (row: ClassRow) => {
    if (row.ref.kind === 'place') return row.ref.place ?? 0
    if (row.ref.kind === 'band') return row.ref.from ?? 0
    if (row.ref.kind === 'pending') return 10000
    return 20000
  }
  const byId = new Map(t.players.map((p) => [p.id, p]))
  rows.sort((a, b) => rank(a) - rank(b) || bandOrder(t, a, b, byId) || a.playerId.localeCompare(b.playerId))
  return rows
}

/** A finished round robin: the table is the classification. */
function roundRobinPlaces(t: Tournament, exact: Map<string, number>) {
  const out = new Set(t.players.filter((p) => p.withdrawn).map((p) => p.id))
  for (const g of t.groups) {
    if (!groupMatchesDone(t.matches, g.id)) continue
    const order = rankGroup(g.playerIds, t.matches.filter((m) => m.groupId === g.id), `${t.drawCode}:${g.id}`)
    order.filter((id) => !out.has(id)).forEach((id, i) => exact.set(id, i + 1))
  }
}

/** Inside one shared band, the better seed (then the better ranking) comes first. */
function bandOrder(t: Tournament, a: ClassRow, b: ClassRow, byId: Map<string, Player>): number {
  if (a.ref.kind !== 'band' || b.ref.kind !== 'band') return 0
  if (a.ref.from !== b.ref.from || a.ref.to !== b.ref.to) return 0
  const sa = t.mainSeeds[a.playerId]
  const sb = t.mainSeeds[b.playerId]
  if (sa != null && sb != null && sa !== sb) return sa - sb
  const pa = byId.get(a.playerId)
  const pb = byId.get(b.playerId)
  if (pa && pb) return compareRanking(pa, pb)
  return 0
}

export function countFinished(t: Tournament): { done: number; total: number } {
  const real = t.matches.filter((m) => m.outcome !== 'bye')
  return {
    total: real.length,
    done: real.filter((m) => m.outcome !== 'pending').length,
  }
}
