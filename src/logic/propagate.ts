import type { Link, Match, Outcome } from './types.ts'

function cloneMatch(m: Match): Match {
  return {
    ...m,
    sets: m.sets.map((s) => ({ ...s })),
    winnerTo: m.winnerTo ? { ...m.winnerTo } : undefined,
    loserTo: m.loserTo ? { ...m.loserTo } : undefined,
    placeBand: m.placeBand ? { ...m.placeBand } : undefined,
    label: { ...m.label },
  }
}

export function cloneMatches(matches: Match[]): Match[] {
  return matches.map(cloneMatch)
}

function loserOf(m: Match): string | null {
  if (!m.winnerId || !m.slotA || !m.slotB) return null
  return m.winnerId === m.slotA ? m.slotB : m.slotA
}

/** Drop downstream slots that were fed by this match, and results that depended on them. */
export function invalidateDownstream(matches: Match[], origin: Match): Match[] {
  const list = cloneMatches(matches)
  const walk = (link: Link | undefined) => {
    if (!link) return
    const m = list.find((x) => x.id === link.matchId)
    if (!m) return
    const had = m.outcome !== 'pending'
    if (link.slot === 'A') {
      m.slotA = null
      m.waitA = true
    } else {
      m.slotB = null
      m.waitB = true
    }
    if (!had) return
    const winnerTo = m.winnerTo
    const loserTo = m.loserTo
    m.outcome = 'pending'
    m.winnerId = null
    m.sets = []
    m.table = null
    walk(winnerTo)
    walk(loserTo)
  }
  walk(origin.winnerTo)
  walk(origin.loserTo)
  return list
}

function writeSlot(list: Match[], link: Link, playerId: string): boolean {
  const m = list.find((x) => x.id === link.matchId)
  if (!m || m.outcome === 'cancelled') return false
  if (link.slot === 'A') {
    if (m.slotA === playerId && !m.waitA) return false
    if (m.outcome !== 'pending' && m.slotA && m.slotA !== playerId) return false
    m.slotA = playerId
    m.waitA = false
    return true
  }
  if (m.slotB === playerId && !m.waitB) return false
  if (m.outcome !== 'pending' && m.slotB && m.slotB !== playerId) return false
  m.slotB = playerId
  m.waitB = false
  return true
}

function finish(m: Match, winnerId: string, outcome: Outcome) {
  m.winnerId = winnerId
  m.outcome = outcome
  m.table = null
  if (outcome !== 'score' && outcome !== 'retirement') m.sets = []
}

/** Resolve byes, push winners and losers, and award walkovers to withdrawn players. */
export function settle(matches: Match[], withdrawn: Set<string>): Match[] {
  const list = cloneMatches(matches)
  const limit = list.length * 4 + 8
  for (let guard = 0; guard < limit; guard++) {
    let changed = false
    for (const m of list) {
      if (m.outcome !== 'pending') continue
      const aBye = !m.slotA && !m.waitA
      const bBye = !m.slotB && !m.waitB
      if ((aBye && bBye) || (aBye && m.waitB) || (bBye && m.waitA)) continue
      if (aBye && m.slotB) {
        finish(m, m.slotB, 'bye')
        changed = true
        continue
      }
      if (bBye && m.slotA) {
        finish(m, m.slotA, 'bye')
        changed = true
        continue
      }
      if (!m.slotA || !m.slotB || m.waitA || m.waitB) continue
      const aOut = withdrawn.has(m.slotA)
      const bOut = withdrawn.has(m.slotB)
      if (aOut && bOut) {
        m.outcome = 'cancelled'
        m.winnerId = null
        m.table = null
        changed = true
      } else if (aOut || bOut) {
        finish(m, aOut ? m.slotB : m.slotA, 'walkover')
        changed = true
      }
    }
    for (const m of list) {
      if (m.outcome === 'pending' || m.outcome === 'cancelled' || !m.winnerId) continue
      if (m.winnerTo && writeSlot(list, m.winnerTo, m.winnerId)) changed = true
      const loser = loserOf(m)
      if (loser && m.loserTo && writeSlot(list, m.loserTo, loser)) changed = true
    }
    if (!changed) break
  }
  return list
}
