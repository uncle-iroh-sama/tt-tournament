import type { Tournament } from './logic/types.ts'

const KEY = 'tt-tournament-v1'

export function loadTournament(): Tournament | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as Tournament
    if (!data || data.version !== 1 || !Array.isArray(data.players) || !Array.isArray(data.matches)) return null
    return data
  } catch {
    return null
  }
}

export function saveTournament(t: Tournament | null) {
  if (!t) localStorage.removeItem(KEY)
  else localStorage.setItem(KEY, JSON.stringify(t))
}

export function tournamentFromJson(raw: string): Tournament | null {
  try {
    const data = JSON.parse(raw) as Tournament
    if (!data || data.version !== 1 || !Array.isArray(data.players) || !data.settings) return null
    data.matches ??= []
    data.groups ??= []
    data.awards ??= []
    data.audit ??= []
    data.shared ??= []
    data.qualifierSlots ??= []
    data.directIds ??= []
    data.mainSeeds ??= {}
    const points = data.settings.pointsCategory as string
    if (points !== 'senior' && points !== 'junior' && points !== 'kadet' && points !== 'mlodzik' && points !== 'zak' && points !== 'custom') {
      data.settings.pointsCategory = 'custom'
    }
    data.settings.seeding ??= 'fixed'
    data.settings.autoAssign ??= true
    return data
  } catch {
    return null
  }
}
