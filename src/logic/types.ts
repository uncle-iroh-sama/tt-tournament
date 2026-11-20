export type Category =
  | 'senior'
  | 'mlodziezowiec'
  | 'junior'
  | 'kadet'
  | 'mlodzik'
  | 'zak'
  | 'skrzat'
  | 'masters'

/** PZTS 18.4 KWGPP columns, plus a blank table for Skrzat and anything else. */
export type PointsCategory = 'senior' | 'junior' | 'kadet' | 'mlodzik' | 'zak' | 'custom'

export type SeedingMode = 'fixed' | 'bands'

export type Stage = 'qualifying' | 'group' | 'main' | 'placement'

export type Outcome = 'pending' | 'score' | 'walkover' | 'retirement' | 'bye' | 'cancelled'

export type QualifyingMode = 'knockout' | 'groups'

export interface Player {
  id: string
  name: string
  club: string
  rankingPoints: number | null
  rankingPosition: number | null
  withdrawn: boolean
}

export interface SetScore {
  a: number
  b: number
}

export interface Link {
  matchId: string
  slot: 'A' | 'B'
}

export interface PlaceBand {
  from: number
  to: number
}

export type MatchLabel =
  | { k: 'qual'; round: number; n: number; draw?: number }
  | { k: 'main'; round: number; rounds: number; n: number }
  | { k: 'place'; place: number; n: number }
  | { k: 'group'; group: string; n: number; kolejka: number }

export interface Match {
  id: string
  stage: Stage
  round: number
  index: number
  groupId?: string
  placementOf?: 'main' | 'qualifying' | 'group'
  label: MatchLabel
  slotA: string | null
  slotB: string | null
  waitA: boolean
  waitB: boolean
  sets: SetScore[]
  winnerId: string | null
  outcome: Outcome
  table: number | null
  bestOf: 3 | 5
  winnerTo?: Link
  loserTo?: Link
  placeWin?: number
  placeLose?: number
  placeBand?: PlaceBand
  qualifies?: boolean
}

export interface Group {
  id: string
  name: string
  playerIds: string[]
}

export interface AuditEvent {
  at: string
  code:
    | 'tie-shuffle'
    | 'band-shuffle'
    | 'club-swap'
    | 'club-unresolved'
    | 'group-swap'
    | 'manual-swap'
    | 'qualifying-built'
    | 'main-built'
    | 'fixed-round'
    | 'bye'
  detail: string
}

export interface PlaceFlags {
  third: boolean
  fiveToEight: boolean
  nineToSixteen: boolean
  seventeenToThirtyTwo: boolean
  nonQualifiers: boolean
}

export interface Settings {
  name: string
  date: string
  venue: string
  category: Category
  tables: number
  bestOf: 3 | 5
  placeMatchBestOf: 3 | 5
  mainDrawSize: 16 | 32 | 64
  directSeeds: number
  qualifyingMode: QualifyingMode
  /** Fixed ranking seeds, or a draw inside each PZTS band. */
  seeding: SeedingMode
  groupSize: 3 | 4 | 5
  advancePerGroup: number
  places: PlaceFlags
  pointsCategory: PointsCategory
  pointsOverride: Partial<Record<PointsCategory, Record<string, number>>>
  /** After a result, put the next ready match on the table that just freed. */
  autoAssign: boolean
}

export interface Award {
  playerId: string
  place: number
  source: 'main' | 'qualifying' | 'group'
}

export interface Tournament {
  version: 1
  id: string
  settings: Settings
  players: Player[]
  phase: 'setup' | 'qualifying' | 'main'
  groups: Group[]
  matches: Match[]
  /** Seed number in the main draw, 1 = best. */
  mainSeeds: Record<string, number>
  /** Player ids in bracket slot order. Null is a bye. */
  mainSlots: (string | null)[] | null
  drawCode: string
  audit: AuditEvent[]
  awards: Award[]
  /** Directly seeded player ids, fixed when the structure is built. */
  directIds: string[]
  /** Qualifier sources. A filled playerId has already advanced; otherwise the winner of fromMatchId does. */
  qualifierSlots: { playerId: string | null; fromMatchId: string | null }[]
  /** Players who share a place band without a further match. */
  shared: { playerIds: string[]; from: number; to: number }[]
  /**
   * First round as drawn on paper. Each side is a player id or the player's name.
   * A null side is a bye. The order is the bracket order: the winners of pair 1 and pair 2 meet.
   * Used for qualifying when the field is larger than the main draw, otherwise for the main draw.
   */
  fixedFirstRound?: { a: string; b: string | null }[] | null
  /** ISO time of the last save. The live board shows it. */
  updatedAt?: string
}

export interface RoundInfo {
  index: number
  matches: number
  byeMatches: number
  advancers: number
}

export interface Standing {
  playerId: string
  points: number
  played: number
  wins: number
  setsWon: number
  setsLost: number
  ballsWon: number
  ballsLost: number
  setRatio: number
  ballRatio: number
  place: number
}
