/** Seed number sitting in each bracket slot. Pairing is (0,1), (2,3), … so seed 1 meets the last seed. */
export function seedOrder(drawSize: number): number[] {
  if (drawSize < 2 || (drawSize & (drawSize - 1)) !== 0) {
    throw new Error(`draw size must be a power of two, got ${drawSize}`)
  }
  let slots = [1, 2]
  while (slots.length < drawSize) {
    const next: number[] = []
    const sum = slots.length * 2 + 1
    for (const s of slots) {
      next.push(s)
      next.push(sum - s)
    }
    slots = next
  }
  return slots
}

export function nextPow2(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** PZTS seeding bands: 1, 2, 3-4, 5-6, 7-8, 9-12, 13-16, then blocks of eight. */
export function bandName(seed: number): string {
  if (seed <= 1) return '1'
  if (seed === 2) return '2'
  if (seed <= 4) return '3-4'
  if (seed <= 6) return '5-6'
  if (seed <= 8) return '7-8'
  if (seed <= 12) return '9-12'
  if (seed <= 16) return '13-16'
  const start = Math.floor((seed - 1) / 8) * 8 + 1
  return `${start}-${start + 7}`
}

export function opponentIndex(slot: number): number {
  return slot % 2 === 0 ? slot + 1 : slot - 1
}
