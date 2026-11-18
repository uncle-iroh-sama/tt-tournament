import type { Category } from './types.ts'

/**
 * Senior KW GPP figures copied from the published Pomorski WZTS table
 * (Regulamin PWZTS 2026/27, kolumna KW GPP). WZTS 2025/26 does not attach
 * its own points table. Place 12 is reconstructed so that the published
 * 11/12 band (60) is the average of places 11 and 12. Everything from
 * place 13 down, and every other age category, is a scaled extrapolation
 * and can be edited per tournament.
 */
const SENIOR_EXACT: Record<number, number> = {
  1: 90,
  2: 85,
  3: 81,
  4: 77,
  5: 74,
  6: 72,
  7: 70,
  8: 68,
  9: 65,
  10: 63,
  11: 61,
  12: 59,
  13: 56,
  14: 54,
  15: 52,
  16: 50,
  17: 46,
  18: 45,
  19: 44,
  20: 43,
  21: 42,
  22: 41,
  23: 40,
  24: 39,
  25: 36,
  26: 35,
  27: 34,
  28: 33,
  29: 32,
  30: 31,
  31: 30,
  32: 29,
}

const SENIOR_BAND: Record<string, number> = {
  '3-4': 79,
  '5-6': 73,
  '7-8': 69,
  '5-8': 71,
  '9-10': 64,
  '11-12': 60,
  '9-12': 62,
  '13-16': 53,
  '9-16': 56,
  '17-24': 42,
  '25-32': 32,
  '17-32': 36,
  '33-48': 18,
  '49-64': 10,
  '65-96': 6,
  '97-128': 3,
}

/** First-place KW GPP anchor. Youth rows follow the PWZTS scale; młodzieżowiec and masters are filled in. */
export const CATEGORY_ANCHOR: Record<Category, number> = {
  senior: 90,
  mlodziezowiec: 80,
  junior: 70,
  kadet: 60,
  mlodzik: 50,
  zak: 40,
  skrzat: 30,
  masters: 80,
}

function scale(seniorPoints: number, category: Category): number {
  return Math.max(1, Math.round((seniorPoints * CATEGORY_ANCHOR[category]) / 90))
}

export function defaultExact(category: Category, place: number): number {
  if (place < 1) return 0
  const known = SENIOR_EXACT[place]
  if (known != null) return scale(known, category)
  if (place <= 48) return scale(Math.max(12, 29 - (place - 32)), category)
  if (place <= 64) return scale(Math.max(6, 12 - Math.floor((place - 49) / 2)), category)
  if (place <= 96) return scale(5, category)
  return scale(3, category)
}

export function defaultBand(category: Category, from: number, to: number): number | null {
  const key = `${from}-${to}`
  const known = SENIOR_BAND[key]
  if (known != null) return scale(known, category)
  return null
}

export function pointsFor(
  category: Category,
  place: number | { from: number; to: number },
  override?: Record<string, number>,
): number {
  if (typeof place === 'number') {
    const key = String(place)
    if (override && override[key] != null) return override[key]!
    return defaultExact(category, place)
  }
  if (place.from === place.to) return pointsFor(category, place.from, override)
  const key = `${place.from}-${place.to}`
  if (override && override[key] != null) return override[key]!
  const preset = defaultBand(category, place.from, place.to)
  if (preset != null) return preset
  return Math.round((defaultExact(category, place.from) + defaultExact(category, place.to)) / 2)
}

export const EDITABLE_POINT_KEYS = [
  '1', '2', '3', '4', '5', '6', '7', '8',
  '9', '10', '11', '12', '13', '14', '15', '16',
  '3-4', '5-8', '9-16', '17-32', '33-48', '49-64', '65-96',
] as const
