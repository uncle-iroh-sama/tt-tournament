import { bandName, opponentIndex } from './seeds.ts'
import type { AuditEvent } from './types.ts'

function norm(club: string): string {
  return club.trim().toLocaleLowerCase('pl')
}

/**
 * Swap lower seeds so that the first round does not pair the same club,
 * staying inside a seeding band when a legal swap exists.
 */
const TOP_PAIRS: [number, number][] = [
  [5, 6],
  [7, 8],
  [3, 4],
]

/** Among seeds 1–8, swap a band pair when that puts same-club players in opposite halves. */
export function separateTopSeeds(
  slots: (string | null)[],
  seedAtSlot: number[],
  clubOf: (id: string) => string,
  audit: AuditEvent[],
  at: string,
): void {
  const n = slots.length
  if (n < 8) return
  const slotOf = (seed: number) => seedAtSlot.indexOf(seed)
  const clubAtSeed = (seed: number) => {
    const slot = slotOf(seed)
    const id = slot < 0 ? null : slots[slot]
    return id ? norm(clubOf(id)) : ''
  }
  const half = (slot: number) => (slot < n / 2 ? 0 : 1)
  const clashes = () => {
    let count = 0
    for (let seed = 2; seed <= 8; seed++) {
      const club = clubAtSeed(seed)
      const slot = slotOf(seed)
      if (!club || slot < 0) continue
      for (let better = 1; better < seed; better++) {
        if (clubAtSeed(better) !== club) continue
        const other = slotOf(better)
        if (other >= 0 && half(other) === half(slot)) count++
      }
    }
    return count
  }
  for (let pass = 0; pass < 2; pass++) {
    for (const [a, b] of TOP_PAIRS) {
      const sa = slotOf(a)
      const sb = slotOf(b)
      if (sa < 0 || sb < 0 || !slots[sa] || !slots[sb]) continue
      const before = clashes()
      if (before === 0) return
      const left = slots[sa]!
      const right = slots[sb]!
      slots[sa] = right
      slots[sb] = left
      if (clashes() < before) {
        audit.push({ at, code: 'club-swap', detail: `top ${left}<->${right}` })
      } else {
        slots[sa] = left
        slots[sb] = right
      }
    }
  }
}

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
