import type { Player } from './types.ts'

export function normClub(club: string): string {
  return club.trim().toLocaleLowerCase('pl')
}

export function sameClub(a: string, b: string): boolean {
  const x = normClub(a)
  const y = normClub(b)
  return x !== '' && x === y
}

export function sameRank(a: Player, b: Player): boolean {
  return a.rankingPoints === b.rankingPoints && a.rankingPosition === b.rankingPosition
}

/** Higher ranking points first. A lower ranking position breaks a points tie. Name is last. */
export function compareRanking(a: Player, b: Player): number {
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
}

export function sortByRanking(players: Player[]): Player[] {
  return players.slice().sort(compareRanking)
}

export function activePlayers(players: Player[]): Player[] {
  return players.filter((p) => !p.withdrawn)
}
