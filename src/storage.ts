import { defaultPlaces, defaultSettings } from './logic/engine.ts'
import type { Category, Player, QualifyingMode, SeedingMode, Settings, Tournament } from './logic/types.ts'

const KEY = 'tt-tournament-v1'

const CATEGORIES: Category[] = ['senior', 'mlodziezowiec', 'junior', 'kadet', 'mlodzik', 'zak', 'skrzat', 'masters']

export function loadTournament(): Tournament | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return tournamentFromJson(raw)
  } catch {
    return null
  }
}

export function saveTournament(t: Tournament | null) {
  if (!t) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, JSON.stringify(t))
}

function finite(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readPlayer(raw: unknown, index: number): Player | null {
  if (!raw || typeof raw !== 'object') return null
  const p = raw as Record<string, unknown>
  const name = String(p.name ?? '').trim()
  if (!name) return null
  let rankingPoints = finite(p.rankingPoints)
  let rankingPosition = finite(p.rankingPosition) ?? finite(p.position)
  if (rankingPoints == null && p.ranking != null) {
    if (typeof p.ranking === 'string' && p.ranking.trim().startsWith('#')) {
      rankingPosition = rankingPosition ?? finite(p.ranking.trim().slice(1))
    } else rankingPoints = finite(p.ranking)
  }
  const id = typeof p.id === 'string' && p.id.trim() ? p.id.trim() : `p-${index + 1}`
  return {
    id,
    name,
    club: String(p.club ?? '').trim(),
    rankingPoints,
    rankingPosition,
    withdrawn: p.withdrawn === true,
  }
}

function readSide(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim()
  return text ? text : null
}

function readPairs(value: unknown): Tournament['fixedFirstRound'] | undefined {
  if (value == null) return null
  if (!Array.isArray(value)) return undefined
  const pairs: { a: string; b: string | null }[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return undefined
    const pair = item as Record<string, unknown>
    const a = readSide(pair.a)
    if (!a) return undefined
    pairs.push({ a, b: readSide(pair.b) })
  }
  return pairs
}

function readSettings(raw: unknown): Settings | null {
  if (!raw || typeof raw !== 'object') return null
  const incoming = raw as Partial<Settings> & { places?: Partial<Settings['places']> }
  const settings: Settings = {
    ...defaultSettings(),
    ...incoming,
    places: { ...defaultPlaces(), ...(incoming.places ?? {}) },
    pointsOverride: incoming.pointsOverride ?? {},
  }
  if (!CATEGORIES.includes(settings.category)) settings.category = 'senior'
  const size = Number(settings.mainDrawSize)
  settings.mainDrawSize = size === 16 || size === 64 ? size : 32
  const direct = Number(settings.directSeeds)
  settings.directSeeds = Number.isFinite(direct) ? Math.max(0, Math.trunc(direct)) : 16
  settings.bestOf = settings.bestOf === 3 ? 3 : 5
  settings.placeMatchBestOf = settings.placeMatchBestOf === 5 ? 5 : 3
  const tables = Number(settings.tables)
  settings.tables = Number.isFinite(tables) && tables >= 1 ? Math.min(64, Math.trunc(tables)) : 12
  const mode: QualifyingMode = settings.qualifyingMode === 'groups' ? 'groups' : 'knockout'
  settings.qualifyingMode = mode
  const seeding: SeedingMode = settings.seeding === 'bands' ? 'bands' : 'fixed'
  settings.seeding = seeding
  const points = settings.pointsCategory as string
  if (points !== 'senior' && points !== 'junior' && points !== 'kadet' && points !== 'mlodzik' && points !== 'zak' && points !== 'custom') {
    settings.pointsCategory = 'custom'
  }
  settings.autoAssign = settings.autoAssign !== false
  settings.name = String(settings.name ?? '').trim()
  settings.date = String(settings.date ?? '')
  settings.venue = String(settings.venue ?? '')
  return settings
}

/** Accepts a full export, or a short file written by hand: players, and optional fixed pairings. */
export function tournamentFromJson(raw: string): Tournament | null {
  try {
    const data = JSON.parse(raw) as Partial<Tournament> & { players?: unknown }
    if (!data || data.version !== 1 || !Array.isArray(data.players)) return null
    const settings = readSettings(data.settings)
    if (!settings) return null
    const players: Player[] = []
    for (let i = 0; i < data.players.length; i++) {
      const player = readPlayer(data.players[i], i)
      if (!player) return null
      players.push(player)
    }
    const fixed = readPairs(data.fixedFirstRound)
    if (fixed === undefined) return null
    const phase = data.phase === 'qualifying' || data.phase === 'main' ? data.phase : 'setup'
    return {
      version: 1,
      id: typeof data.id === 'string' && data.id ? data.id : 't-import',
      settings,
      players,
      phase,
      groups: Array.isArray(data.groups) ? data.groups : [],
      matches: Array.isArray(data.matches) ? data.matches : [],
      mainSeeds: data.mainSeeds && typeof data.mainSeeds === 'object' ? data.mainSeeds : {},
      mainSlots: Array.isArray(data.mainSlots) ? data.mainSlots : null,
      drawCode: typeof data.drawCode === 'string' && data.drawCode ? data.drawCode : 'IMPORT',
      audit: Array.isArray(data.audit) ? data.audit : [],
      awards: Array.isArray(data.awards) ? data.awards : [],
      directIds: Array.isArray(data.directIds) ? data.directIds : [],
      qualifierSlots: Array.isArray(data.qualifierSlots) ? data.qualifierSlots : [],
      shared: Array.isArray(data.shared) ? data.shared : [],
      fixedFirstRound: fixed,
      updatedAt: typeof data.updatedAt === 'string' && data.updatedAt ? data.updatedAt : undefined,
    }
  } catch {
    return null
  }
}

export function isLiveSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62})?$/.test(slug)
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/ł/gi, 'l')
    .toLocaleLowerCase('pl')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return slug || 'turniej'
}

export function liveFileUrl(slug: string): string {
  const base = import.meta.env.BASE_URL || './'
  return `${base}live/${encodeURIComponent(slug)}.json`
}

export async function fetchLive(slug: string): Promise<{ ok: true; tournament: Tournament } | { ok: false; error: 'missing' | 'bad' }> {
  if (!isLiveSlug(slug)) return { ok: false, error: 'missing' }
  try {
    const res = await fetch(`${liveFileUrl(slug)}?t=${Date.now()}`, { cache: 'no-store' })
    if (!res.ok) return { ok: false, error: 'missing' }
    const tournament = tournamentFromJson(await res.text())
    if (!tournament) return { ok: false, error: 'bad' }
    return { ok: true, tournament }
  } catch {
    return { ok: false, error: 'missing' }
  }
}
