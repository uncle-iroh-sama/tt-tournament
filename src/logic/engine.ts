import { bracketFromSlots, buildQualifying, groupLeftoverBands, layMainDraw, placeCohort, playsNonQualifiers, qualifyingEntrants } from './build.ts'
import { resolveMainPaperPairs, resolvePaperPairs, sameIdList, sameIds } from './fixed.ts'
import { groupStandings } from './groups.ts'
import { explainCount, explainSets, matchWinner } from './score.ts'
import { cloneMatches, invalidateDownstream, settle } from './propagate.ts'
import { activePlayers, compareRanking } from './ranking.ts'
import { makeDrawCode, rngFrom, shuffle } from './rng.ts'
import type { Match, Outcome, PlaceFlags, Player, SetScore, Settings, Tournament } from './types.ts'

export type Action =
  | { ok: true; tournament: Tournament }
  | { ok: false; error: string; detail?: string }

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
    format: 'knockout',
    bracket: 'placement',
    mainDrawSize: 32,
    directSeeds: 16,
    seeding: 'fixed',
    groupSize: 4,
    advancePerGroup: 2,
    places: defaultPlaces(),
    pointsCategory: 'senior',
    pointsOverride: {},
    autoAssign: true,
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

/** A round robin ends with its table; the other formats finish with a knock-out. */
export function hasKnockout(s: Settings): boolean {
  return s.format !== 'roundRobin'
}

export function qualifyingRequired(t: Tournament): boolean {
  const n = activePlayers(t.players).length
  if (t.settings.format !== 'knockout') return n >= 2
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
  if (t.settings.format !== 'knockout') {
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
  if (t.settings.format === 'groups') {
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

function paperPairs(
  t: Tournament,
): { ok: false; error: string } | { ok: true; pairs: { a: string | null; b: string | null }[] } | null {
  const paper = t.fixedFirstRound
  if (!paper || paper.length === 0) return null
  if (t.settings.format !== 'knockout') return { ok: false, error: 'fixed-groups' }
  return resolvePaperPairs(t.players, paper)
}

export function generateQualifying(t: Tournament): Action {
  if (!qualifyingRequired(t)) return { ok: false, error: 'qualifying-skip' }
  if (hasPlayed(t.matches, () => true)) return { ok: false, error: 'results-exist' }
  const paper = paperPairs(t)
  if (paper && !paper.ok) return paper
  let fixed: { a: string | null; b: string | null }[] | null = null
  if (paper && paper.ok) {
    const { rest } = qualifyingEntrants(t.players, t.settings)
    const ids = paper.pairs.flatMap((p) => [p.a, p.b].filter((id): id is string => !!id))
    if (!sameIds(ids, rest)) return { ok: false, error: 'fixed-field' }
    fixed = paper.pairs
  }
  const built = buildQualifying(t.players, t.settings, now(), fixed)
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


function pendingQualifierMatchIds(t: Tournament): string[] {
  const ids: string[] = []
  for (const slot of t.qualifierSlots) {
    if (slot.playerId || !slot.fromMatchId) continue
    const m = t.matches.find((x) => x.id === slot.fromMatchId)
    if (m && m.outcome === 'pending') ids.push(m.id)
  }
  return ids
}

export function generateMainDraw(t: Tournament, paperOverride?: { a: string; b: string | null }[] | null): Action {
  if (!hasKnockout(t.settings)) return { ok: false, error: 'no-knockout' }
  if (hasPlayed(t.matches, (m) => m.stage === 'main' || m.placementOf === 'main')) return { ok: false, error: 'main-started' }
  const explicit = paperOverride && paperOverride.length > 0 ? paperOverride : null
  let paper:
    | { ok: false; error: string }
    | { ok: true; pairs: { a: string | null; b: string | null; waitA?: string; waitB?: string }[] }
    | null
  if (explicit) {
    if (t.settings.format !== 'knockout') paper = { ok: false, error: 'fixed-groups' }
    else paper = resolveMainPaperPairs(t.players, t.matches, explicit)
  } else {
    paper = !qualifyingRequired(t) ? paperPairs(t) : null
  }
  if (paper && !paper.ok) return paper
  const waitIds = paper && paper.ok
    ? paper.pairs.flatMap((p) => [p.waitA, p.waitB].filter((id): id is string => !!id))
    : []
  if (qualifyingRequired(t) && !qualifyingComplete(t) && waitIds.length === 0) return { ok: false, error: 'qualifying-open' }
  const drawCode = t.drawCode || makeDrawCode()
  const field = mainCandidates(t)
  if (field.length < 2 && waitIds.length === 0) return { ok: false, error: 'too-few' }
  let laid: ReturnType<typeof layMainDraw>
  let waits: (string | null)[] = []
  if (paper && paper.ok) {
    const ids = paper.pairs.flatMap((p) => {
      const found: string[] = []
      if (!p.waitA && p.a) found.push(p.a)
      if (!p.waitB && p.b) found.push(p.b)
      return found
    })
    if (!sameIds(ids, field)) return { ok: false, error: 'fixed-field' }
    if (!sameIdList(waitIds, pendingQualifierMatchIds(t))) return { ok: false, error: 'fixed-field' }
    const slots: (string | null)[] = []
    for (const pair of paper.pairs) {
      slots.push(pair.waitA ? null : pair.a)
      waits.push(pair.waitA ?? null)
      slots.push(pair.waitB ? null : pair.b)
      waits.push(pair.waitB ?? null)
    }
    if (slots.length > t.settings.mainDrawSize) return { ok: false, error: 'fixed-size' }
    while (slots.length < t.settings.mainDrawSize) {
      slots.push(null)
      waits.push(null)
    }
    const built = bracketFromSlots(slots, t.settings, waits.some(Boolean) ? waits : undefined)
    const byeCount = slots.filter((id, i) => !id && !waits[i]).length
    const at = now()
    laid = {
      slots,
      matches: built.matches,
      awards: built.awards,
      seeds: built.seeds,
      audit: [
        ...(byeCount > 0 ? [{ at, code: 'bye' as const, detail: String(byeCount) }] : []),
        { at, code: 'fixed-round' as const, detail: `pairs=${paper.pairs.length}` },
        { at, code: 'main-built' as const, detail: `field=${field.length + waitIds.length};code=${drawCode}` },
      ],
    }
  } else {
    const groupOf = (id: string) => t.groups.find((g) => g.playerIds.includes(id))?.id ?? null
    laid = layMainDraw(field, t.settings, drawCode, groupOf, now())
  }
  const inDraw = new Set(laid.slots.filter((id): id is string => !!id))
  const cut = field.filter((p) => !inDraw.has(p.id)).map((p) => p.id)
  let matches = cloneMatches(t.matches.filter((m) => m.stage !== 'main' && m.placementOf !== 'main' && m.placementOf !== 'group'))
  let awards = t.awards.filter((a) => a.source === 'qualifying').concat(laid.awards)
  let shared: Tournament['shared'] = []
  let place = inDraw.size + waitIds.length + 1
  if (cut.length > 0) {
    const cohort = placeCohort(cut, place, playsNonQualifiers(t.settings), t.settings.placeMatchBestOf, 'group', `cut${place}`)
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
      playsNonQualifiers(t.settings),
      t.settings.placeMatchBestOf,
      place,
    )
    matches = matches.concat(left.matches)
    awards = awards.concat(left.awards)
    shared = shared.concat(left.shared)
  }
  matches = matches.concat(laid.matches)
  if (waitIds.length > 0) {
    for (let i = 0; i < waits.length; i++) {
      const srcId = waits[i]
      if (!srcId) continue
      const src = matches.find((m) => m.id === srcId)
      if (!src) return { ok: false, error: 'fixed-wait' }
      src.winnerTo = { matchId: `m-r0-m${Math.floor(i / 2)}`, slot: i % 2 === 0 ? 'A' : 'B' }
    }
    matches = settle(matches, withdrawnSet(t))
  }
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

function applyResult(
  t: Tournament,
  matchId: string,
  winnerId: string,
  sets: SetScore[],
  outcome: Outcome,
  games: { a: number; b: number } | null = null,
): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  if (match.outcome === 'bye' || match.outcome === 'cancelled') return { ok: false, error: 'locked' }
  if (winnerId !== match.slotA && winnerId !== match.slotB) return { ok: false, error: 'no-winner' }
  let matches = t.matches
  if (match.outcome !== 'pending') matches = invalidateDownstream(matches, match)
  matches = replaceOrigin(matches, matchId, { sets, games, winnerId, outcome, table: null })
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
  return applyResult(t, matchId, winnerId, sets, 'score', null)
}

/** Record a finished match from the set count alone, with no set scores. `a` and `b` are slot A's sets. */
export function enterSetCount(t: Tournament, matchId: string, a: number, b: number): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  const problem = explainCount(a, b, match.bestOf)
  if (problem) return { ok: false, error: problem }
  const winnerId = a > b ? match.slotA : match.slotB
  if (!winnerId) return { ok: false, error: 'no-winner' }
  return applyResult(t, matchId, winnerId, [], 'score', { a, b })
}

function downstreamPlayed(matches: Match[], origin: Match): Match[] {
  const found: Match[] = []
  const seen = new Set<string>()
  const queue = [origin.winnerTo, origin.loserTo].filter((link): link is NonNullable<Match['winnerTo']> => !!link)
  while (queue.length) {
    const link = queue.shift()!
    if (seen.has(link.matchId)) continue
    seen.add(link.matchId)
    const next = matches.find((m) => m.id === link.matchId)
    if (!next) continue
    if (next.outcome === 'score' || next.outcome === 'walkover' || next.outcome === 'retirement') found.push(next)
    if (next.winnerTo) queue.push(next.winnerTo)
    if (next.loserTo) queue.push(next.loserTo)
  }
  return found
}

/** Clear one result or skip. Refuses when a later match has already been played off this one. */
export function clearResult(t: Tournament, matchId: string): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  if (match.outcome !== 'score' && match.outcome !== 'walkover' && match.outcome !== 'retirement' && match.outcome !== 'skipped') {
    return { ok: false, error: 'not-played' }
  }
  const blockers = downstreamPlayed(t.matches, match)
  if (blockers.length > 0) {
    return { ok: false, error: 'downstream', detail: blockers.map((m) => m.id).join(',') }
  }
  let matches = t.matches.map((m) =>
    m.id === matchId ? { ...m, outcome: 'pending' as const, winnerId: null, sets: [], games: null, table: null } : m,
  )
  matches = invalidateDownstream(matches, match)
  matches = settle(matches, withdrawnSet({ ...t, matches }))
  return { ok: true, tournament: { ...t, matches } }
}

/** Marks a place match as not played (NIE). Its players, and those of the place matches after it, share its places. */
export function skipMatch(t: Tournament, matchId: string): Action {
  const match = t.matches.find((m) => m.id === matchId)
  if (!match) return { ok: false, error: 'missing' }
  if (match.label.k !== 'place' || !match.placeBand) return { ok: false, error: 'not-place' }
  if (match.outcome !== 'pending') return { ok: false, error: 'locked' }
  let matches = replaceOrigin(t.matches, matchId, { outcome: 'skipped', winnerId: null, sets: [], games: null, table: null })
  matches = settle(matches, withdrawnSet({ ...t, matches }))
  return { ok: true, tournament: { ...t, matches } }
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

/** The match that just finished gives its table to the next ready match that can use it. */
export function fillFreedTable(t: Tournament, table: number | null): Tournament {
  if (!t.settings.autoAssign || table == null) return t
  for (const m of readyMatches(t)) {
    if (m.table != null) continue
    const res = assignTable(t, m.id, table)
    if (res.ok) return res.tournament
  }
  return t
}

const CLOSE_SETS: Array<[number, number]> = [
  [11, 9], [11, 8], [11, 7], [11, 6], [11, 5],
]
const DEUCE_SETS: Array<[number, number]> = [[12, 10], [13, 11]]

function pickSimSet(rng: () => number): [number, number] {
  const roll = rng()
  if (roll < 0.78) return CLOSE_SETS[Math.floor(rng() * CLOSE_SETS.length)]!
  if (roll < 0.93) return DEUCE_SETS[Math.floor(rng() * DEUCE_SETS.length)]!
  return [11, 3]
}

function upsetChance(gap: number): number {
  if (gap <= 2) return 0.3
  if (gap <= 5) return 0.18
  if (gap <= 10) return 0.1
  return 0.05
}

function strength(t: Tournament, id: string): number {
  const seed = t.mainSeeds[id]
  if (seed != null) return seed
  const p = t.players.find((x) => x.id === id)
  if (p?.rankingPosition != null) return p.rankingPosition
  if (p?.rankingPoints != null) return 1_000_000 - p.rankingPoints
  return 1_000_000
}

/** Plausible set scores. The better seed wins more often, and not every time. */
function simulatedSets(t: Tournament, m: Match): SetScore[] {
  const rng = rngFrom(t.drawCode, `sim:${m.id}`)
  const aStrength = strength(t, m.slotA!)
  const bStrength = strength(t, m.slotB!)
  const aIsBetter = aStrength <= bStrength
  const aWins = rng() < upsetChance(Math.abs(aStrength - bStrength)) ? !aIsBetter : aIsBetter
  const need = m.bestOf === 5 ? 3 : 2
  const roll = rng()
  const losses = need === 3 ? (roll < 0.35 ? 0 : roll < 0.72 ? 1 : 2) : roll < 0.55 ? 0 : 1
  const marks: Array<'W' | 'L'> = []
  for (let i = 0; i < losses; i++) marks.push('L')
  for (let i = 0; i < need - 1; i++) marks.push('W')
  const order = shuffle(marks, rng)
  order.push('W')
  return order.map((mark) => {
    const pair = pickSimSet(rng)
    const highOnA = mark === 'W' ? aWins : !aWins
    return highOnA ? { a: pair[0], b: pair[1] } : { a: pair[1], b: pair[0] }
  })
}

function inSimStage(m: Match, mainStage: boolean): boolean {
  return mainStage ? m.stage === 'main' || m.stage === 'placement' : m.stage === 'qualifying' || m.stage === 'group'
}

/**
 * Plays the stage the referee is in, and stops.
 * Qualifying is drawn and played, then the desk waits for the main draw.
 * After that draw, the main bracket and the place matches are played.
 * Scores are sets, never walkovers.
 */
export function simulateRemaining(start: Tournament): Action {
  let t = start
  const hasQual = t.matches.some((m) => m.stage === 'qualifying' || m.stage === 'group')
  if (t.phase === 'setup' && qualifyingRequired(t) && !hasQual) {
    const built = generateQualifying(t)
    if (!built.ok) return built
    t = built.tournament
  }
  const mainStage = t.phase === 'main'
  for (let i = 0; i < 800; i++) {
    const m = readyMatches(t).find((match) => inSimStage(match, mainStage))
    if (!m?.slotA || !m.slotB) break
    const res = enterScore(t, m.id, simulatedSets(t, m))
    if (!res.ok) return res
    t = res.tournament
  }
  return { ok: true, tournament: t }
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
