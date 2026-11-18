import { bracketFromSlots, buildQualifying, groupLeftoverBands, layMainDraw, placeCohort } from './build.ts'
import { groupStandings } from './groups.ts'
import { explainSets, matchWinner } from './score.ts'
import { invalidateDownstream, settle } from './propagate.ts'
import { activePlayers, compareRanking } from './ranking.ts'
import { makeDrawCode } from './rng.ts'
import type { Match, Outcome, PlaceFlags, Player, SetScore, Settings, Tournament } from './types.ts'

export type Action =
  | { ok: true; tournament: Tournament }
  | { ok: false; error: string }

export function defaultPlaces(): PlaceFlags {
  return {
    third: true,
    fiveToEight: true,
    nineToSixteen: false,
    seventeenToThirtyTwo: false,
    nonQualifiers: false,
  }
}

export function defaultSettings(): Settings {
  return {
    name: '',
    date: new Date().toISOString().slice(0, 10),
    venue: '',
    category: 'senior',
    tables: 12,
    bestOf: 5,
    placeMatchBestOf: 3,
    mainDrawSize: 32,
    directSeeds: 16,
    qualifyingMode: 'knockout',
    seeding: 'fixed',
    groupSize: 4,
    advancePerGroup: 2,
    places: defaultPlaces(),
    pointsCategory: 'senior',
    pointsOverride: {},
  }
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
}

export function createTournament(settings: Settings = defaultSettings(), drawCode = makeDrawCode()): Tournament {
  return {
    version: 1,
    id: uid('t'),
    settings,
    players: [],
    phase: 'setup',
    groups: [],
    matches: [],
    mainSeeds: {},
    mainSlots: null,
    drawCode,
    audit: [],
    awards: [],
    directIds: [],
    qualifierSlots: [],
    shared: [],
  }
}

export function qualifyingRequired(t: Tournament): boolean {
  const n = activePlayers(t.players).length
  if (t.settings.qualifyingMode === 'groups') return n >= 2
  return n > t.settings.mainDrawSize
}

function withdrawnSet(t: Tournament): Set<string> {
  return new Set(t.players.filter((p) => p.withdrawn).map((p) => p.id))
}

function now(): string {
  return new Date().toISOString()
}

export function addPlayer(t: Tournament, input: Omit<Player, 'id' | 'withdrawn'> & { id?: string }): Tournament {
  const player: Player = {
    id: input.id ?? uid('p'),
    name: input.name.trim(),
    club: input.club.trim(),
    rankingPoints: input.rankingPoints,
    rankingPosition: input.rankingPosition,
    withdrawn: false,
  }
  return { ...t, players: [...t.players, player] }
}

export function updatePlayer(t: Tournament, id: string, patch: Partial<Omit<Player, 'id'>>): Tournament {
  return {
    ...t,
    players: t.players.map((p) => (p.id === id ? { ...p, ...patch, name: (patch.name ?? p.name).trim(), club: (patch.club ?? p.club).trim() } : p)),
  }
}

export function removePlayer(t: Tournament, id: string): Action {
  if (t.phase !== 'setup') return { ok: false, error: 'draw-locked' }
  return { ok: true, tournament: { ...t, players: t.players.filter((p) => p.id !== id) } }
}

export function qualifyingComplete(t: Tournament): boolean {
  if (!qualifyingRequired(t)) return true
  if (t.phase === 'setup') return false
  if (t.settings.qualifyingMode === 'groups') {
    if (t.groups.length === 0) return true
    return t.groups.every((g) => {
      const list = t.matches.filter((m) => m.groupId === g.id)
      return list.length > 0 && list.every((m) => m.outcome !== 'pending')
    })
  }
  if (t.qualifierSlots.length === 0) return false
  return t.qualifierSlots.every((slot) => {
    if (slot.playerId) return true
    const m = t.matches.find((x) => x.id === slot.fromMatchId)
    return !!m && m.outcome !== 'pending'
  })
}

function slotPlayer(t: Tournament, slot: { playerId: string | null; fromMatchId: string | null }): string | null {
  if (slot.playerId) {
    const p = t.players.find((x) => x.id === slot.playerId)
    return p && !p.withdrawn ? p.id : null
  }
  if (!slot.fromMatchId) return null
  const m = t.matches.find((x) => x.id === slot.fromMatchId)
  if (!m || m.outcome === 'pending' || m.outcome === 'cancelled' || !m.winnerId) return null
  const p = t.players.find((x) => x.id === m.winnerId)
  return p && !p.withdrawn ? p.id : null
}

function mainCandidates(t: Tournament): Player[] {
  const byId = new Map(t.players.map((p) => [p.id, p]))
  const ids = new Set<string>()
  if (!qualifyingRequired(t)) {
    return activePlayers(t.players).sort(compareRanking)
  }
  for (const id of t.directIds) {
    const p = byId.get(id)
    if (p && !p.withdrawn) ids.add(id)
  }
  if (t.settings.qualifyingMode === 'groups') {
    for (const g of t.groups) {
      const rows = groupStandings(
        g.playerIds,
        t.matches.filter((m) => m.groupId === g.id),
        `${t.drawCode}:${g.id}`,
      )
      let taken = 0
      for (const row of rows) {
        const p = byId.get(row.playerId)
        if (!p || p.withdrawn) continue
        if (taken >= t.settings.advancePerGroup) break
        ids.add(p.id)
        taken++
      }
    }
  } else {
    for (const slot of t.qualifierSlots) {
      const id = slotPlayer(t, slot)
      if (id) ids.add(id)
    }
  }
  return [...ids].map((id) => byId.get(id)!).filter((p) => !p.withdrawn)
}

function hasPlayed(matches: Match[], pred: (m: Match) => boolean): boolean {
  return matches.some(
    (m) => pred(m) && (m.outcome === 'score' || m.outcome === 'walkover' || m.outcome === 'retirement'),
  )
}

export function generateQualifying(t: Tournament): Action {
  if (!qualifyingRequired(t)) return { ok: false, error: 'qualifying-skip' }
  if (hasPlayed(t.matches, () => true)) return { ok: false, error: 'results-exist' }
  const built = buildQualifying(t.players, t.settings, now())
  return {
    ok: true,
    tournament: {
      ...t,
      phase: 'qualifying',
      matches: built.matches,
      groups: built.groups,
      awards: built.awards,
      directIds: built.directIds,
      qualifierSlots: built.qualifierSlots,
      shared: [],
      mainSlots: null,
      mainSeeds: {},
      audit: [...t.audit, ...built.audit],
    },
  }
}

export function generateMainDraw(t: Tournament): Action {
  if (qualifyingRequired(t) && !qualifyingComplete(t)) return { ok: false, error: 'qualifying-open' }
  if (hasPlayed(t.matches, (m) => m.stage === 'main' || m.placementOf === 'main')) return { ok: false, error: 'main-started' }
  const drawCode = t.drawCode || makeDrawCode()
  const field = mainCandidates(t)
  if (field.length < 2) return { ok: false, error: 'too-few' }
  const groupOf = (id: string) => t.groups.find((g) => g.playerIds.includes(id))?.id ?? null
  const laid = layMainDraw(field, t.settings, drawCode, groupOf, now())
  const inDraw = new Set(laid.slots.filter((id): id is string => !!id))
  const cut = field.filter((p) => !inDraw.has(p.id)).map((p) => p.id)
  let matches = t.matches.filter((m) => m.stage !== 'main' && m.placementOf !== 'main' && m.placementOf !== 'group')
  let awards = t.awards.filter((a) => a.source === 'qualifying').concat(laid.awards)
  let shared: Tournament['shared'] = []
  let place = inDraw.size + 1
  if (cut.length > 0) {
    const cohort = placeCohort(cut, place, t.settings.places.nonQualifiers, t.settings.placeMatchBestOf, 'group', `cut${place}`)
    matches = matches.concat(cohort.matches)
    awards = awards.concat(cohort.awards)
    shared = shared.concat(cohort.shared)
    place = cohort.next
  }
  if (t.groups.length > 0) {
    const held = new Set<string>([...inDraw, ...cut])
    const left = groupLeftoverBands(
      t.groups,
      (groupId, playerIds) =>
        groupStandings(
          playerIds,
          t.matches.filter((m) => m.groupId === groupId),
          `${drawCode}:${groupId}`,
        ).map((s) => s.playerId),
      held,
      withdrawnSet(t),
      t.settings.advancePerGroup,
      t.settings.places,
      t.settings.placeMatchBestOf,
      place,
    )
    matches = matches.concat(left.matches)
    awards = awards.concat(left.awards)
    shared = shared.concat(left.shared)
  }
  matches = matches.concat(laid.matches)
  return {
    ok: true,
    tournament: {
      ...t,
      phase: 'main',
      drawCode,
      matches,
      awards,
      shared,
      mainSlots: laid.slots,
      mainSeeds: laid.seeds,
      audit: [...t.audit, ...laid.audit],
    },
  }
}

export function undoAll(t: Tournament): Tournament {
  return {
    ...t,
    phase: 'setup',
    matches: [],
    groups: [],
    awards: [],
    directIds: [],
    qualifierSlots: [],
    shared: [],
    mainSlots: null,
    mainSeeds: {},
    audit: [],
  }
}

function replaceOrigin(matches: Match[], id: string, patch: Partial<Match>): Match[] {
  return matches.map((m) => (m.id === id ? { ...m, ...patch } : m))
}

function applyResult(t: Tournament, matchId: string, winnerId: string, sets: SetScore[], outcome: Outcome): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  if (match.outcome === 'bye' || match.outcome === 'cancelled') return { ok: false, error: 'locked' }
  if (winnerId !== match.slotA && winnerId !== match.slotB) return { ok: false, error: 'no-winner' }
  let matches = t.matches
  if (match.outcome !== 'pending') matches = invalidateDownstream(matches, match)
  matches = replaceOrigin(matches, matchId, { sets, winnerId, outcome, table: null })
  matches = settle(matches, withdrawnSet({ ...t, matches }))
  return { ok: true, tournament: { ...t, matches } }
}

export function enterScore(t: Tournament, matchId: string, sets: SetScore[]): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  const problem = explainSets(sets, match.bestOf)
  if (problem) return { ok: false, error: problem }
  const side = matchWinner(sets, match.bestOf)
  const winnerId = side === 'A' ? match.slotA : side === 'B' ? match.slotB : null
  if (!winnerId) return { ok: false, error: 'no-winner' }
  return applyResult(t, matchId, winnerId, sets, 'score')
}

export function enterWalkover(t: Tournament, matchId: string, winnerId: string): Action {
  return applyResult(t, matchId, winnerId, [], 'walkover')
}

export function enterRetirement(t: Tournament, matchId: string, winnerId: string, sets: SetScore[]): Action {
  for (const s of sets) {
    if (explainSets([s], 5) === 'invalid-set') return { ok: false, error: 'invalid-set' }
  }
  if (matchWinner(sets, 5) || matchWinner(sets, 3)) return { ok: false, error: 'already-won' }
  return applyResult(t, matchId, winnerId, sets, 'retirement')
}

export function withdrawPlayer(t: Tournament, id: string): Tournament {
  const players = t.players.map((p) => (p.id === id ? { ...p, withdrawn: true } : p))
  let matches = t.matches.map((m) => {
    if (m.outcome !== 'pending') return m
    const involved = m.slotA === id || m.slotB === id
    if (!involved) return m
    if (m.stage === 'group') return { ...m, outcome: 'cancelled' as const, winnerId: null, table: null, sets: [] }
    if (m.table) return { ...m, table: null }
    return m
  })
  matches = settle(matches, new Set(players.filter((p) => p.withdrawn).map((p) => p.id)))
  return { ...t, players, matches }
}

export function assignTable(t: Tournament, matchId: string, table: number | null): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  if (table == null) {
    return { ok: true, tournament: { ...t, matches: replaceOrigin(t.matches, matchId, { table: null }) } }
  }
  if (match.outcome !== 'pending' || !match.slotA || !match.slotB) return { ok: false, error: 'not-ready' }
  if (table < 1 || table > t.settings.tables) return { ok: false, error: 'bad-table' }
  const busyTable = t.matches.some((m) => m.id !== matchId && m.outcome === 'pending' && m.table === table)
  if (busyTable) return { ok: false, error: 'table-busy' }
  const playerBusy = t.matches.some(
    (m) =>
      m.id !== matchId &&
      m.outcome === 'pending' &&
      m.table != null &&
      (m.slotA === match.slotA || m.slotB === match.slotA || m.slotA === match.slotB || m.slotB === match.slotB),
  )
  if (playerBusy) return { ok: false, error: 'player-busy' }
  return { ok: true, tournament: { ...t, matches: replaceOrigin(t.matches, matchId, { table }) } }
}

export function readyMatches(t: Tournament): Match[] {
  const out = withdrawnSet(t)
  const stageRank = (m: Match) => (m.stage === 'placement' ? 2 : m.stage === 'main' ? 1 : 0)
  return t.matches
    .filter(
      (m) =>
        m.outcome === 'pending' &&
        !!m.slotA &&
        !!m.slotB &&
        !m.waitA &&
        !m.waitB &&
        !out.has(m.slotA) &&
        !out.has(m.slotB),
    )
    .sort((a, b) => stageRank(a) - stageRank(b) || a.round - b.round || a.index - b.index)
}

export function suggestAssignments(t: Tournament): { matchId: string; table: number }[] {
  const used = new Set(
    t.matches.filter((m) => m.outcome === 'pending' && m.table != null).map((m) => m.table as number),
  )
  const busy = new Set<string>()
  for (const m of t.matches) {
    if (m.outcome === 'pending' && m.table != null) {
      if (m.slotA) busy.add(m.slotA)
      if (m.slotB) busy.add(m.slotB)
    }
  }
  const free: number[] = []
  for (let i = 1; i <= t.settings.tables; i++) if (!used.has(i)) free.push(i)
  const plan: { matchId: string; table: number }[] = []
  for (const m of readyMatches(t)) {
    if (m.table != null) continue
    if (free.length === 0) break
    if ((m.slotA && busy.has(m.slotA)) || (m.slotB && busy.has(m.slotB))) continue
    const table = free.shift()!
    plan.push({ matchId: m.id, table })
    busy.add(m.slotA!)
    busy.add(m.slotB!)
  }
  return plan
}

export function applySuggestions(t: Tournament): Tournament {
  let next = t
  for (const s of suggestAssignments(t)) {
    const res = assignTable(next, s.matchId, s.table)
    if (res.ok) next = res.tournament
  }
  return next
}

export function swapMainSlots(t: Tournament, indexA: number, indexB: number): Action {
  if (!t.mainSlots) return { ok: false, error: 'no-draw' }
  if (indexA === indexB) return { ok: true, tournament: t }
  if (indexA < 0 || indexB < 0 || indexA >= t.mainSlots.length || indexB >= t.mainSlots.length) {
    return { ok: false, error: 'bad-slot' }
  }
  if (hasPlayed(t.matches, (m) => m.stage === 'main' || m.placementOf === 'main')) return { ok: false, error: 'main-started' }
  const slots = t.mainSlots.slice()
  const tmp = slots[indexA]!
  slots[indexA] = slots[indexB] ?? null
  slots[indexB] = tmp
  const built = bracketFromSlots(slots, t.settings)
  const matches = t.matches
    .filter((m) => m.stage !== 'main' && m.placementOf !== 'main')
    .concat(built.matches)
  const awards = t.awards.filter((a) => a.source !== 'main').concat(built.awards)
  const aId = slots[indexA] ?? 'bye'
  const bId = slots[indexB] ?? 'bye'
  return {
    ok: true,
    tournament: {
      ...t,
      mainSlots: slots,
      mainSeeds: built.seeds,
      matches,
      awards,
      audit: [...t.audit, { at: now(), code: 'manual-swap', detail: `${bId}<->${aId}` }],
    },
  }
}

export function updateSettings(t: Tournament, settings: Settings): Tournament {
  return { ...t, settings: { ...settings, pointsCategory: settings.pointsCategory } }
}

export function playerById(t: Tournament, id: string | null): Player | null {
  if (!id) return null
  return t.players.find((p) => p.id === id) ?? null
}
