import type { PointsCategory } from './types.ts'

/**
 * PZTS 2026/27 §18.4, column KWGPP (wojewódzkie rozgrywki indywidualne, gra pojedyncza).
 * Order: senior, junior, kadet, młodzik, żak. Skrzat is not in this table.
 */
const KWGPP: Record<string, [number, number, number, number, number]> = {
  '1': [90, 70, 60, 50, 40],
  '2': [85, 66, 57, 47, 37],
  '3': [81, 62, 54, 44, 35],
  '3-4': [79, 60, 53, 43, 34],
  '4': [77, 59, 52, 42, 33],
  '5': [74, 57, 50, 40, 32],
  '5-6': [73, 56, 49, 39, 31],
  '6': [72, 55, 48, 39, 31],
  '5-8': [71, 54, 47, 38, 30],
  '7': [70, 53, 46, 38, 30],
  '7-8': [69, 52, 45, 37, 29],
  '8': [68, 51, 44, 36, 29],
  '9': [65, 50, 42, 35, 28],
  '9-10': [64, 49, 41, 34, 27],
  '10': [63, 48, 41, 34, 27],
  '9-12': [62, 47, 40, 33, 26],
  '11': [61, 46, 39, 32, 26],
  '11-12': [60, 45, 38, 31, 25],
  '12': [59, 44, 38, 31, 25],
  '9-16': [57, 43, 36, 30, 24],
  '13': [57, 42, 36, 30, 24],
  '13-14': [56, 41, 35, 29, 23],
  '14': [55, 41, 35, 29, 23],
  '13-16': [53, 39, 33, 28, 22],
  '15': [52, 39, 33, 27, 22],
  '15-16': [51, 38, 32, 26, 21],
  '16': [50, 37, 31, 26, 21],
  '17': [48, 35, 30, 25, 20],
  '17-20': [44, 32, 27, 23, 18],
  '21-24': [36, 25, 21, 17, 13],
  '25-28': [27, 18, 15, 12, 9],
  '29-32': [21, 13, 11, 9, 7],
  '33-40': [18, 11, 9, 7, 5],
  '41-48': [16, 9, 8, 5, 4],
  '33-64': [16, 9, 8, 5, 3],
  '49-56': [15, 9, 7, 5, 3],
  '49-64': [14, 8, 7, 4, 2],
  '57-64': [13, 8, 6, 4, 2],
  '65-96': [10, 6, 5, 3, 2],
  '65-128': [7, 4, 3, 2, 1],
  '97-128': [4, 3, 2, 1, 1],
}

const COL: Record<Exclude<PointsCategory, 'custom'>, number> = {
  senior: 0,
  junior: 1,
  kadet: 2,
  mlodzik: 3,
  zak: 4,
}

/** Bands used to tile a round that is not itself one row of the table. Smallest band at a start wins. */
const TILE_BANDS: [number, number][] = [
  [3, 4], [5, 6], [5, 8], [7, 8], [9, 10], [9, 12], [9, 16], [11, 12],
  [13, 14], [13, 16], [15, 16], [17, 20], [21, 24], [25, 28], [29, 32],
  [33, 40], [33, 64], [41, 48], [49, 56], [49, 64], [57, 64],
  [65, 96], [65, 128], [97, 128],
]

export const EDITABLE_POINT_KEYS = Object.keys(KWGPP)

export function isOfficialBand(from: number, to: number): boolean {
  return KWGPP[`${from}-${to}`] != null
}

export function tilePlaceBands(from: number, count: number): { from: number; to: number; take: number }[] {
  if (count <= 0) return []
  const to = from + count - 1
  if (count === 1 || isOfficialBand(from, to)) return [{ from, to, take: count }]
  const out: { from: number; to: number; take: number }[] = []
  let cursor = from
  while (cursor <= to) {
    const options = TILE_BANDS.filter(([start]) => start === cursor).sort((a, b) => a[1] - a[0] - (b[1] - b[0]))
    const smallest = options[0]
    if (!smallest) {
      out.push({ from: cursor, to, take: to - cursor + 1 })
      break
    }
    const size = smallest[1] - smallest[0] + 1
    const remaining = to - cursor + 1
    if (remaining <= size) {
      out.push({ from: smallest[0], to: smallest[1], take: remaining })
      break
    }
    out.push({ from: smallest[0], to: smallest[1], take: size })
    cursor = smallest[1] + 1
  }
  return out
}

export function pointsFor(
  category: PointsCategory,
  place: number | { from: number; to: number },
  override?: Record<string, number>,
): number | null {
  const key = typeof place === 'number' ? String(place) : place.from === place.to ? String(place.from) : `${place.from}-${place.to}`
  if (override && override[key] != null && Number.isFinite(override[key])) return override[key]!
  if (category === 'custom') return null
  const row = KWGPP[key] ?? enclosingRow(typeof place === 'number' ? { from: place, to: place } : place)
  if (!row) return null
  return row[COL[category]] ?? null
}

/** A band the table does not list (33–34, or place 18) scores as the narrowest listed band around it. */
function enclosingRow(band: { from: number; to: number }): (typeof KWGPP)[string] | undefined {
  let best: { size: number; key: string } | null = null
  for (const key of Object.keys(KWGPP)) {
    const [from, to = from] = key.split('-').map(Number) as [number, number?]
    if (from > band.from || to < band.to) continue
    if (!best || to - from < best.size) best = { size: to - from, key }
  }
  return best ? KWGPP[best.key] : undefined
}
