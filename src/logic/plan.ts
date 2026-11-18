import { nextPow2 } from './seeds.ts'
import type { RoundInfo } from './types.ts'

export interface KnockoutPlan {
  bracketSize: number
  byes: number
  rounds: RoundInfo[]
}

/**
 * Knock-out sized to the next power of two. Full rounds while halving stays at or
 * above `advance`; a last partial round (byes to the best remaining seeds) if the
 * target is not a power of two.
 */
export function planKnockout(playerCount: number, advance: number): KnockoutPlan {
  const target = Math.max(0, advance)
  if (playerCount <= target) {
    return { bracketSize: nextPow2(Math.max(playerCount, 2)), byes: 0, rounds: [] }
  }
  const bracketSize = nextPow2(playerCount)
  const rounds: RoundInfo[] = []
  let current = bracketSize
  while (current > target) {
    if (current % 2 === 0 && current / 2 >= target) {
      const pairings = current / 2
      const isFirst = rounds.length === 0
      const byeMatches = isFirst ? bracketSize - playerCount : 0
      rounds.push({
        index: rounds.length,
        matches: pairings - byeMatches,
        byeMatches,
        advancers: current / 2,
      })
      current = current / 2
    } else {
      const eliminate = current - target
      rounds.push({
        index: rounds.length,
        matches: eliminate,
        byeMatches: current - eliminate * 2,
        advancers: target,
      })
      current = target
    }
  }
  return { bracketSize, byes: bracketSize - playerCount, rounds }
}

export function planGroupSizes(count: number, target: 3 | 4 | 5): number[] {
  if (count <= 0) return []
  const cap = target === 5 ? 5 : 4
  if (count <= cap) return [count]
  let best: { sizes: number[]; score: number } | null = null
  for (let groups = 1; groups <= count; groups++) {
    const base = Math.floor(count / groups)
    const rem = count % groups
    if (base < 3 || base > cap) continue
    if (rem !== 0 && base + 1 > cap) continue
    const sizes = Array.from({ length: groups }, (_, i) => (i < rem ? base + 1 : base))
    if (sizes.some((s) => s < 3 || s > cap)) continue
    const score = sizes.reduce((sum, s) => sum + Math.abs(s - target), 0)
    if (!best || score < best.score || (score === best.score && sizes.length < best.sizes.length)) {
      best = { sizes, score }
    }
  }
  if (best) return best.sizes
  const groups = Math.ceil(count / target)
  const base = Math.floor(count / groups)
  const rem = count % groups
  return Array.from({ length: groups }, (_, i) => (i < rem ? base + 1 : base))
}

export interface QualifyingPreview {
  players: number
  direct: number
  inQualifier: number
  qualifiers: number
  intoMain: number
  byesInMain: number
  knockout: KnockoutPlan | null
  qualifyingRounds: number
}

export function previewQualifying(
  playerCount: number,
  mainDrawSize: number,
  directSeeds: number,
  mode: 'knockout' | 'groups',
): QualifyingPreview {
  if (mode === 'groups') {
    const direct = Math.min(Math.max(0, directSeeds), playerCount)
    return {
      players: playerCount,
      direct,
      inQualifier: playerCount - direct,
      qualifiers: 0,
      intoMain: Math.min(mainDrawSize, playerCount),
      byesInMain: Math.max(0, mainDrawSize - playerCount),
      knockout: null,
      qualifyingRounds: playerCount - direct >= 2 ? 1 : 0,
    }
  }
  const directCap = Math.min(Math.max(0, directSeeds), mainDrawSize, playerCount)
  if (playerCount <= mainDrawSize) {
    return {
      players: playerCount,
      direct: playerCount,
      inQualifier: 0,
      qualifiers: 0,
      intoMain: playerCount,
      byesInMain: mainDrawSize - playerCount,
      knockout: null,
      qualifyingRounds: 0,
    }
  }
  const spots = mainDrawSize - directCap
  const inQualifier = playerCount - directCap
  const qualifiers = Math.min(spots, inQualifier)
  const knockout = qualifiers < inQualifier ? planKnockout(inQualifier, qualifiers) : null
  return {
    players: playerCount,
    direct: directCap,
    inQualifier,
    qualifiers,
    intoMain: directCap + qualifiers,
    byesInMain: mainDrawSize - (directCap + qualifiers),
    knockout,
    qualifyingRounds: knockout?.rounds.length ?? 0,
  }
}
