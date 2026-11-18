import { bandName, opponentIndex } from './seeds.ts'
import type { AuditEvent } from './types.ts'

function norm(club: string): string {
  return club.trim().toLocaleLowerCase('pl')
}

/**
 * Swap lower seeds so that the first round does not pair the same club,
 * staying inside a seeding band when a legal swap exists.
 */
export function separateFirstRoundClubs(
  slots: (string | null)[],
  seedAtSlot: number[],
  clubOf: (id: string) => string,
  groupOf: (id: string) => string | null,
  audit: AuditEvent[],
  at: string,
): void {
  const n = slots.length
  const clubAt = (i: number) => {
    const id = slots[i]
    return id ? norm(clubOf(id)) : ''
  }
  for (let pass = 0; pass < n; pass++) {
    let changed = false
    for (let i = 0; i < n; i += 2) {
      const j = i + 1
      const ci = clubAt(i)
      const cj = clubAt(j)
      if (!slots[i] || !slots[j] || !ci || ci !== cj) continue
      let move = j
      let stay = i
      if (seedAtSlot[i]! > seedAtSlot[j]!) {
        move = i
        stay = j
      }
      if (seedAtSlot[move]! <= 2 && seedAtSlot[stay]! > seedAtSlot[move]!) {
        /* seed 1 and 2 stay put unless they are the pair, which they are not */
      }
      const stayClub = clubAt(stay)
      const moveId = slots[move]!
      const moveClub = norm(clubOf(moveId))
      const moveGroup = groupOf(moveId)
      let best: number | null = null
      let bestScore = Number.POSITIVE_INFINITY
      for (let k = 0; k < n; k++) {
        if (k === move || k === stay || !slots[k]) continue
        const partner = opponentIndex(k)
        if (partner === move || partner === stay) continue
        const kClub = clubAt(k)
        if (!kClub || kClub === stayClub) continue
        const partnerId = slots[partner]
        const partnerClub = partnerId ? norm(clubOf(partnerId)) : ''
        if (partnerClub && partnerClub === moveClub) continue
        const sameBand = bandName(seedAtSlot[k]!) === bandName(seedAtSlot[move]!) ? 0 : 1
        const protect = seedAtSlot[k]! <= 4 ? 1 : 0
        const dist = Math.abs(seedAtSlot[k]! - seedAtSlot[move]!)
        const kGroup = groupOf(slots[k]!)
        const stayGroup = groupOf(slots[stay]!)
        const groupClash = stayGroup && kGroup && stayGroup === kGroup ? 1 : 0
        const partnerGroup = partnerId ? groupOf(partnerId) : null
        const moveGroupClash = moveGroup && partnerGroup && moveGroup === partnerGroup ? 1 : 0
        const score = sameBand * 1000 + protect * 200 + groupClash * 50 + moveGroupClash * 50 + dist
        if (score < bestScore) {
          bestScore = score
          best = k
        }
      }
      if (best == null) {
        audit.push({ at, code: 'club-unresolved', detail: `${slots[stay]} vs ${moveId}` })
        continue
      }
      const other = slots[best]!
      slots[move] = other
      slots[best] = moveId
      audit.push({ at, code: 'club-swap', detail: `${moveId}<->${other}` })
      changed = true
    }
    if (!changed) break
  }
}
