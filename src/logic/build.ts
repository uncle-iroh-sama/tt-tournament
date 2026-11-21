import { groupPairings, separateGroupClubs, shuffleTies, snakeGroups } from './groups.ts'
import { tilePlaceBands } from './points.ts'
import { planGroupSizes, planKnockout } from './plan.ts'
import { settle } from './propagate.ts'
import { activePlayers } from './ranking.ts'
import { rngFrom, shuffle } from './rng.ts'
import { bandName, nextPow2, seedOrder } from './seeds.ts'
import { separateFirstRoundClubs, separateTopSeeds } from './separate.ts'
import type {
  AuditEvent,
  Award,
  Group,
  Match,
  MatchLabel,
  PlaceBand,
  Player,
  Settings,
} from './types.ts'

interface Entry {
  playerId: string | null
  fromLoserOf?: string
  fromWinnerOf?: string
}

function stamp(code: AuditEvent['code'], detail: string, at: string): AuditEvent {
  return { at, code, detail }
}

function feedWinner(prev: Match | undefined, match: Match, slot: 'A' | 'B', matchId: string) {
  if (!prev || (prev.outcome === 'bye' && !prev.winnerId)) return
  if (slot === 'A') match.waitA = true
  else match.waitB = true
  prev.winnerTo = { matchId, slot }
  if (prev.outcome === 'bye' && prev.winnerId) {
    if (slot === 'A') {
      match.slotA = prev.winnerId
      match.waitA = false
    } else {
      match.slotB = prev.winnerId
      match.waitB = false
    }
  }
}

function blank(part: Omit<Match, 'sets' | 'winnerId' | 'outcome' | 'table' | 'slotA' | 'slotB' | 'waitA' | 'waitB'> & Partial<Match>): Match {
  return {
    sets: [],
    winnerId: null,
    outcome: 'pending',
    table: null,
    slotA: null,
    slotB: null,
    waitA: false,
    waitB: false,
    ...part,
  }
}

function slotOf(entry: Entry): { player: string | null; wait: boolean } {
  if (entry.playerId) return { player: entry.playerId, wait: false }
  if (entry.fromLoserOf || entry.fromWinnerOf) return { player: null, wait: true }
  return { player: null, wait: false }
}

function linkEntry(entry: Entry, matchId: string, slot: 'A' | 'B', bag: Match[]) {
  const srcId = entry.fromLoserOf ?? entry.fromWinnerOf
  if (!srcId) return
  const src = bag.find((m) => m.id === srcId)
  if (!src) return
  const link = { matchId, slot }
  if (entry.fromLoserOf) src.loserTo = link
  else src.winnerTo = link
}

function awardEntry(entry: Entry, place: number, bag: Match[], awards: Award[], source: Award['source']) {
  if (entry.playerId) {
    awards.push({ playerId: entry.playerId, place, source })
    return
  }
  const srcId = entry.fromLoserOf ?? entry.fromWinnerOf
  const src = srcId ? bag.find((m) => m.id === srcId) : undefined
  if (!src) return
  if (entry.fromLoserOf) src.placeLose = place
  else src.placeWin = place
}

let placeSeq = 0

function buildPlaceOut(
  entries: Entry[],
  placeFrom: number,
  prefix: string,
  bestOf: 3 | 5,
  source: Award['source'],
  bag: Match[],
  awards: Award[],
) {
  const n = entries.length
  if (n <= 0) return
  if (n === 1) {
    awardEntry(entries[0]!, placeFrom, bag, awards, source)
    return
  }
  if (n === 2) {
    const id = `${prefix}-f${placeFrom}`
    const a = slotOf(entries[0]!)
    const b = slotOf(entries[1]!)
    const match = blank({
      id,
      stage: 'placement',
      placementOf: source === 'qualifying' ? 'qualifying' : source === 'group' ? 'group' : 'main',
      round: 0,
      index: placeFrom,
      label: { k: 'place', place: placeFrom, n: 1 },
      bestOf,
      slotA: a.player,
      slotB: b.player,
      waitA: a.wait,
      waitB: b.wait,
      placeWin: placeFrom,
      placeLose: placeFrom + 1,
      placeBand: { from: placeFrom, to: placeFrom + 1 },
    })
    bag.push(match)
    linkEntry(entries[0]!, id, 'A', bag)
    linkEntry(entries[1]!, id, 'B', bag)
    return
  }
  const pairCount = Math.floor(n / 2)
  const odd = n % 2 === 1
  const first: { id: string; a: Entry; b: Entry }[] = []
  for (let i = 0; i < pairCount; i++) {
    placeSeq += 1
    first.push({
      id: `${prefix}-r${placeSeq}`,
      a: entries[i * 2]!,
      b: entries[i * 2 + 1]!,
    })
  }
  for (const fr of first) {
    const a = slotOf(fr.a)
    const b = slotOf(fr.b)
    bag.push(
      blank({
        id: fr.id,
        stage: 'placement',
        placementOf: source === 'qualifying' ? 'qualifying' : source === 'group' ? 'group' : 'main',
        round: 0,
        index: placeFrom,
        label: { k: 'place', place: placeFrom, n: 1 },
        bestOf,
        slotA: a.player,
        slotB: b.player,
        waitA: a.wait,
        waitB: b.wait,
        placeBand: { from: placeFrom, to: placeFrom + n - 1 },
      }),
    )
    linkEntry(fr.a, fr.id, 'A', bag)
    linkEntry(fr.b, fr.id, 'B', bag)
  }
  const winners: Entry[] = first.map((fr) => ({ playerId: null, fromWinnerOf: fr.id }))
  const losers: Entry[] = first.map((fr) => ({ playerId: null, fromLoserOf: fr.id }))
  if (odd) winners.push(entries[n - 1]!)
  buildPlaceOut(winners, placeFrom, `${prefix}w`, bestOf, source, bag, awards)
  buildPlaceOut(losers, placeFrom + winners.length, `${prefix}l`, bestOf, source, bag, awards)
}

function playBand(
  entries: Entry[],
  band: PlaceBand,
  settings: Settings,
  source: Award['source'],
  prefix: string,
  bag: Match[],
  awards: Award[],
  knownLosers?: Match[],
): number {
  const play = playsBand(band, settings, source)
  const bestOf = settings.placeMatchBestOf
  if (entries.length === 1) {
    awardEntry(entries[0]!, band.from, bag, awards, source)
    return band.from + 1
  }
  if (!play) {
    const parts = tilePlaceBands(band.from, entries.length)
    let end = band.from - 1
    if (knownLosers) {
      let at = 0
      for (const part of parts) {
        for (const match of knownLosers.slice(at, at + part.take)) {
          match.placeBand = { from: part.from, to: part.to }
        }
        at += part.take
        end = Math.max(end, part.to)
      }
    } else {
      for (const part of parts) end = Math.max(end, part.to)
    }
    return end + 1
  }
  buildPlaceOut(entries, band.from, prefix, bestOf, source, bag, awards)
  return band.from + entries.length
}

function playsBand(band: PlaceBand, settings: Settings, source: Award['source']): boolean {
  if (source !== 'main') return playsNonQualifiers(settings)
  if (settings.bracket !== 'placement') return settings.bracket === 'consolation'
  const flags = settings.places
  const { from } = band
  if (from <= 4) return flags.third
  if (from <= 8) return flags.fiveToEight
  if (from <= 16) return flags.nineToSixteen
  return flags.seventeenToThirtyTwo
}

/** Place matches for players who never reached the main draw. */
export function playsNonQualifiers(settings: Settings): boolean {
  if (settings.bracket === 'placement') return settings.places.nonQualifiers
  return settings.bracket === 'consolation'
}

interface Tok {
  playerId: string | null
  from?: string
  bestSeed: number
}

function tokSlot(tok: Tok): { player: string | null; wait: boolean } {
  if (tok.playerId) return { player: tok.playerId, wait: false }
  if (tok.from) return { player: null, wait: true }
  return { player: null, wait: false }
}

function pairToks(
  id: string,
  a: Tok,
  b: Tok,
  round: number,
  index: number,
  bestOf: 3 | 5,
  bag: Match[],
  draw?: number,
): Tok {
  const as = tokSlot(a)
  const bs = tokSlot(b)
  const match = blank({
    id,
    stage: 'qualifying',
    round,
    index,
    label: { k: 'qual', round, n: index + 1, draw },
    bestOf,
    slotA: as.player,
    slotB: bs.player,
    waitA: as.wait,
    waitB: bs.wait,
  })
  if (!as.player && !as.wait && bs.player) {
    match.outcome = 'bye'
    match.winnerId = bs.player
  } else if (!bs.player && !bs.wait && as.player) {
    match.outcome = 'bye'
    match.winnerId = as.player
  } else if (!as.player && !as.wait && !bs.player && !bs.wait) {
    match.outcome = 'bye'
  }
  if (a.from) {
    const src = bag.find((m) => m.id === a.from)
    if (src) src.winnerTo = { matchId: id, slot: 'A' }
  }
  if (b.from) {
    const src = bag.find((m) => m.id === b.from)
    if (src) src.winnerTo = { matchId: id, slot: 'B' }
  }
  bag.push(match)
  const bestSeed = Math.min(a.bestSeed, b.bestSeed)
  if (match.outcome === 'bye') return { playerId: match.winnerId, bestSeed }
  return { playerId: null, from: id, bestSeed }
}

export interface QualifyingBuild {
  matches: Match[]
  awards: Award[]
  groups: Group[]
  directIds: string[]
  qualifierSlots: { playerId: string | null; fromMatchId: string | null }[]
  audit: AuditEvent[]
}

export function rankPlayers(players: Player[]): Player[] {
  return activePlayers(players).slice().sort((a, b) => {
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
  })
}

/** Direct seeds, and the players who contest the first round. Qualifying always leaves at least one place. */
export function qualifyingEntrants(players: Player[], settings: Settings): { direct: Player[]; rest: Player[] } {
  const ranked = rankPlayers(players)
  const cap = { knockout: settings.mainDrawSize - 1, groups: ranked.length, roundRobin: 0 }[settings.format]
  const directCount = Math.min(Math.max(0, settings.directSeeds), cap, ranked.length)
  return { direct: ranked.slice(0, directCount), rest: ranked.slice(directCount) }
}

function playDown(start: Tok[], target: number, round0: number, matches: Match[], bestOf: 3 | 5): Tok[] {
  let current = start
  let round = round0
  while (current.length > target) {
    if (current.length % 2 === 0 && current.length / 2 >= target) {
      const next: Tok[] = []
      for (let i = 0; i < current.length; i += 2) {
        const id = `q-r${round}-m${i / 2}`
        next.push(pairToks(id, current[i]!, current[i + 1]!, round, i / 2, bestOf, matches, current.length))
      }
      current = next
      round++
    } else {
      const eliminate = current.length - target
      const playCount = eliminate * 2
      const indexed = current.map((tok, i) => ({ tok, i }))
      indexed.sort((a, b) => a.tok.bestSeed - b.tok.bestSeed || a.i - b.i)
      const byeIdx = new Set(indexed.slice(0, current.length - playCount).map((x) => x.i))
      const playing = current.filter((_, i) => !byeIdx.has(i))
      const next: Tok[] = current.filter((_, i) => byeIdx.has(i))
      for (let i = 0; i < playing.length; i += 2) {
        const id = `q-r${round}-m${i / 2}`
        next.push(pairToks(id, playing[i]!, playing[i + 1]!, round, i / 2, bestOf, matches))
      }
      current = next
      round++
    }
  }
  return current
}

export function buildQualifying(
  players: Player[],
  settings: Settings,
  at: string,
  fixed: { a: string | null; b: string | null }[] | null = null,
): QualifyingBuild {
  const { direct, rest } = qualifyingEntrants(players, settings)
  const audit: AuditEvent[] = []
  const awards: Award[] = []
  if (settings.format !== 'knockout') {
    const built = buildGroupStage(direct, rest, settings, at, audit)
    return {
      matches: settle(built.matches, new Set()),
      awards,
      groups: built.groups,
      directIds: built.directIds,
      qualifierSlots: [],
      audit,
    }
  }
  const spots = settings.mainDrawSize - direct.length
  const target = Math.min(spots, rest.length)
  const matches: Match[] = []
  if (rest.length <= target) {
    return {
      matches,
      awards,
      groups: [],
      directIds: direct.map((p) => p.id),
      qualifierSlots: rest.map((p) => ({ playerId: p.id, fromMatchId: null })),
      audit,
    }
  }
  let current: Tok[]
  if (fixed && fixed.length > 0) {
    const rank = new Map(rest.map((p, i) => [p.id, i + 1]))
    const seedOf = (id: string | null) => (id ? rank.get(id) ?? 5000 : 5000)
    const draw = fixed.length * 2
    const named = draw >= 2 && (draw & (draw - 1)) === 0 ? draw : undefined
    current = fixed.map((pair, i) =>
      pairToks(
        `q-r0-m${i}`,
        { playerId: pair.a, bestSeed: seedOf(pair.a) },
        { playerId: pair.b, bestSeed: seedOf(pair.b) },
        0,
        i,
        settings.bestOf,
        matches,
        named,
      ),
    )
    current = playDown(current, target, 1, matches, settings.bestOf)
    audit.push(stamp('fixed-round', `pairs=${fixed.length}`, at))
  } else {
    const plan = planKnockout(rest.length, target)
    const order = seedOrder(plan.bracketSize)
    current = order.map((seed) => ({
      playerId: seed <= rest.length ? rest[seed - 1]!.id : null,
      bestSeed: seed,
    }))
    current = playDown(current, target, 0, matches, settings.bestOf)
  }
  const qualifierSlots = current.map((tok) => {
    if (tok.from) {
      const src = matches.find((m) => m.id === tok.from)
      if (src) src.qualifies = true
      return { playerId: null, fromMatchId: tok.from }
    }
    return { playerId: tok.playerId, fromMatchId: null }
  })
  const mainCount = direct.length + qualifierSlots.length
  attachQualPlaces(matches, mainCount, settings, awards)
  stampQualRounds(matches)
  audit.push(stamp('qualifying-built', `direct=${direct.length};in=${rest.length};advance=${target}`, at))
  return {
    matches: settle(matches, new Set()),
    awards,
    groups: [],
    directIds: direct.map((p) => p.id),
    qualifierSlots,
    audit,
  }
}

function stampQualRounds(matches: Match[]) {
  let max = -1
  for (const m of matches) if (m.stage === 'qualifying') max = Math.max(max, m.round)
  if (max < 0) return
  const rounds = max + 1
  for (const m of matches) {
    if (m.label.k === 'qual') m.label = { ...m.label, rounds }
  }
}

function attachQualPlaces(matches: Match[], mainCount: number, settings: Settings, awards: Award[]) {
  if (matches.length === 0) return
  const maxRound = Math.max(...matches.map((m) => m.round))
  let next = mainCount + 1
  for (let r = maxRound; r >= 0; r--) {
    const producers = matches.filter((m) => m.stage === 'qualifying' && m.round === r && m.outcome !== 'bye')
    if (producers.length === 0) continue
    const band = { from: next, to: next + producers.length - 1 }
    const entries: Entry[] = producers.map((m) => ({ playerId: null, fromLoserOf: m.id }))
    next = playBand(entries, band, settings, 'qualifying', `nq${band.from}`, matches, awards, producers)
  }
}

function buildGroupStage(
  direct: Player[],
  rest: Player[],
  settings: Settings,
  at: string,
  audit: AuditEvent[],
): { matches: Match[]; directIds: string[]; groups: Group[] } {
  const ids = rest.map((p) => p.id)
  const roundRobin = settings.format === 'roundRobin'
  const groups = roundRobin ? [ids] : snakeGroups(ids, planGroupSizes(ids.length, settings.groupSize).length)
  const clubOf = (id: string) => rest.find((p) => p.id === id)?.club ?? ''
  if (!roundRobin) separateGroupClubs(groups, clubOf, audit, at)
  const matches: Match[] = []
  const groupModels: Group[] = groups.map((ids, gi) => ({
    id: `g${gi + 1}`,
    name: groupName(gi),
    playerIds: ids.slice(),
  }))
  groupModels.forEach((group) => {
    const pairs = groupPairings(group.playerIds.length, roundRobin ? 1 : settings.advancePerGroup)
    pairs.forEach((pair, mi) => {
      const label: MatchLabel = { k: 'group', group: group.name, n: mi + 1, kolejka: pair.kolejka + 1 }
      matches.push(
        blank({
          id: `${group.id}-m${mi}`,
          stage: 'group',
          round: pair.kolejka,
          index: mi,
          groupId: group.id,
          label,
          bestOf: settings.bestOf,
          slotA: group.playerIds[pair.a] ?? null,
          slotB: group.playerIds[pair.b] ?? null,
        }),
      )
    })
  })
  audit.push(stamp('qualifying-built', `groups=${groupModels.length};direct=${direct.length}`, at))
  return { matches, directIds: direct.map((p) => p.id), groups: groupModels }
}

export function groupName(index: number): string {
  let n = index
  let name = ''
  do {
    name = String.fromCharCode(65 + (n % 26)) + name
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return name
}

export function layMainDraw(
  field: Player[],
  settings: Settings,
  drawCode: string,
  at: string,
): { slots: (string | null)[]; matches: Match[]; awards: Award[]; seeds: Record<string, number>; audit: AuditEvent[] } {
  const audit: AuditEvent[] = []
  const tieRng = rngFrom(drawCode, 'ties')
  const ordered = shuffleTies(field, tieRng, audit, at)
  const capped = ordered.slice(0, settings.mainDrawSize)
  const bandRng = rngFrom(drawCode, 'bands')
  const drawSize = settings.mainDrawSize
  const order = seedOrder(drawSize)
  const slots: (string | null)[] = Array(drawSize).fill(null)
  const seedAtSlot = order.slice()
  const slotOfSeed = new Map<number, number>()
  order.forEach((seed, i) => slotOfSeed.set(seed, i))
  const bands = new Map<string, number[]>()
  for (let seed = 1; seed <= drawSize; seed++) {
    const name = bandName(seed)
    const list = bands.get(name) ?? []
    list.push(seed)
    bands.set(name, list)
  }
  for (const [band, seeds] of bands) {
    const playing = seeds.filter((s) => s <= capped.length)
    const ids = playing.map((s) => capped[s - 1]!.id)
    const shuffled = settings.seeding === 'bands' && ids.length > 1 ? shuffle(ids, bandRng) : ids.slice()
    if (ids.length > 1 && shuffled.join(',') !== ids.join(',')) {
      audit.push(stamp('band-shuffle', `${band}:${shuffled.join(',')}`, at))
    }
    playing.forEach((seed, i) => {
      slots[slotOfSeed.get(seed)!] = shuffled[i] ?? null
    })
  }
  const clubOf = (id: string) => field.find((p) => p.id === id)?.club ?? ''
  separateTopSeeds(slots, seedAtSlot, clubOf, audit, at)
  separateFirstRoundClubs(slots, seedAtSlot, clubOf, audit, at)
  const built = bracketFromSlots(slots, settings)
  const byeCount = slots.filter((id) => !id).length
  if (byeCount > 0) audit.push(stamp('bye', String(byeCount), at))
  audit.push(stamp('main-built', `field=${capped.length};code=${drawCode}`, at))
  return { slots, matches: built.matches, awards: built.awards, seeds: built.seeds, audit }
}

/**
 * Knock-out after groups. `field` comes in order: direct seeds, group winners, then each next finishing place.
 * The draw is the smallest that fits, up to the main draw size. Each player takes the open seed position
 * farthest from players of the same group already placed, preferring the better seeding band, then by lot.
 * Group winners therefore take the top seeds, and runners-up land in the other half.
 */
export function layGroupDraw(
  field: Player[],
  groupOf: (id: string) => string | null,
  settings: Settings,
  drawCode: string,
  at: string,
): { slots: (string | null)[]; matches: Match[]; awards: Award[]; seeds: Record<string, number>; audit: AuditEvent[] } {
  const drawSize = Math.min(settings.mainDrawSize, nextPow2(Math.max(2, field.length)))
  const entrants = field.slice(0, drawSize)
  const order = seedOrder(drawSize)
  const slots: (string | null)[] = Array(drawSize).fill(null)
  const rng = rngFrom(drawCode, 'groups')
  const bandStart = (slot: number) => parseInt(bandName(order[slot]!), 10)
  /** 0 when the two slots meet in the first round, 1 in the second, and so on. */
  const meets = (a: number, b: number) => Math.floor(Math.log2(a ^ b))
  for (const p of entrants) {
    const group = groupOf(p.id)
    const mates = group ? slots.flatMap((id, i) => (id && groupOf(id) === group ? [i] : [])) : []
    const open = order.flatMap((seed, slot) => (seed <= entrants.length && !slots[slot] ? [slot] : []))
    const apart = (slot: number) => (mates.length ? Math.min(...mates.map((m) => meets(slot, m))) : Infinity)
    const far = Math.max(...open.map(apart))
    const best = open.filter((slot) => apart(slot) === far)
    const band = Math.min(...best.map(bandStart))
    const choice = best.filter((slot) => bandStart(slot) === band).sort((x, y) => order[x]! - order[y]!)
    const lot = mates.length || settings.seeding === 'bands' ? shuffle(choice, rng) : choice
    slots[lot[0]!] = p.id
  }
  const built = bracketFromSlots(slots, settings)
  const audit: AuditEvent[] = []
  const byeCount = slots.filter((id) => !id).length
  if (byeCount > 0) audit.push(stamp('bye', String(byeCount), at))
  audit.push(stamp('main-built', `field=${entrants.length};groups;code=${drawCode}`, at))
  return { slots, matches: built.matches, awards: built.awards, seeds: built.seeds, audit }
}

function hasSide(m: Match, side: 'A' | 'B'): boolean {
  return side === 'A' ? !!m.slotA || m.waitA : !!m.slotB || m.waitB
}

function loserEntry(m: Match): Entry {
  return hasSide(m, 'A') && hasSide(m, 'B') ? { playerId: null, fromLoserOf: m.id } : { playerId: null }
}

function winnerEntry(m: Match): Entry {
  return hasSide(m, 'A') || hasSide(m, 'B') ? { playerId: null, fromWinnerOf: m.id } : { playerId: null }
}

/** Reversed, then swapped in pairs, alternately: a dropped-in loser lands away from the part of the draw they came from. */
function feedOrder(entries: Entry[], feed: number): Entry[] {
  if (feed % 2 === 0) return entries.slice().reverse()
  return entries.map((_, i) => entries[i ^ 1]!)
}

/**
 * WZTS feed-in consolation. First-round losers pair off. Losers of each later round
 * except the final drop in against the consolation survivors, who then pair off again.
 * The last survivor is 3rd. Each consolation round's losers play out their own band.
 */
function addConsolation(matches: Match[], mainRounds: number, settings: Settings, awards: Award[]) {
  const mainRound = (r: number) => matches.filter((m) => m.stage === 'main' && m.round === r).sort((a, b) => a.index - b.index)
  const rounds: Match[][] = []
  const play = (pairs: [Entry, Entry][]): Entry[] => {
    const round = rounds.length
    const made = pairs.map(([a, b], i) => {
      const id = `c-r${round}-m${i}`
      const sa = slotOf(a)
      const sb = slotOf(b)
      const match = blank({
        id,
        stage: 'placement',
        placementOf: 'main',
        round,
        index: i,
        label: { k: 'cons', round, n: i + 1, to: 0 },
        bestOf: settings.placeMatchBestOf,
        slotA: sa.player,
        slotB: sb.player,
        waitA: sa.wait,
        waitB: sb.wait,
      })
      matches.push(match)
      linkEntry(a, id, 'A', matches)
      linkEntry(b, id, 'B', matches)
      return match
    })
    rounds.push(made)
    return made.map(winnerEntry)
  }
  const pairUp = (entries: Entry[]): [Entry, Entry][] =>
    entries.flatMap((e, i) => (i % 2 === 0 ? [[e, entries[i + 1]!] as [Entry, Entry]] : []))
  if (mainRounds < 2) return
  let alive = play(pairUp(mainRound(0).map(loserEntry)))
  for (let r = 1; r < mainRounds - 1; r++) {
    const dropped = feedOrder(mainRound(r).map(loserEntry), r - 1)
    alive = play(alive.map((e, i) => [e, dropped[i]!]))
    if (alive.length > 1) alive = play(pairUp(alive))
  }
  let worst = mainRound(0).reduce((n, m) => n + (hasSide(m, 'A') ? 1 : 0) + (hasSide(m, 'B') ? 1 : 0), 0)
  for (const made of rounds) {
    const producers = made.filter((m) => hasSide(m, 'A') && hasSide(m, 'B'))
    for (const m of made) m.label = { k: 'cons', round: m.round, n: m.index + 1, to: worst }
    const band = { from: worst - producers.length + 1, to: worst }
    playBand(producers.map(loserEntry), band, settings, 'main', `cp${band.from}`, matches, awards)
    worst = band.from - 1
  }
  const last = rounds[rounds.length - 1]?.[0]
  if (last) last.placeWin = worst
}

export function bracketFromSlots(
  slots: (string | null)[],
  settings: Settings,
  waits?: (string | null)[],
): { matches: Match[]; awards: Award[]; seeds: Record<string, number> } {
  const matches: Match[] = []
  const awards: Award[] = []
  const drawSize = slots.length
  const rounds = Math.round(Math.log2(drawSize))
  const seedAtSlot = seedOrder(drawSize)
  for (let r = 0; r < rounds; r++) {
    const count = drawSize / 2 ** (r + 1)
    for (let i = 0; i < count; i++) {
      const id = `m-r${r}-m${i}`
      const match = blank({
        id,
        stage: 'main',
        round: r,
        index: i,
        label: { k: 'main', round: r, rounds, n: i + 1 },
        bestOf: settings.bestOf,
      })
      if (r === 0) {
        match.slotA = slots[i * 2] ?? null
        match.slotB = slots[i * 2 + 1] ?? null
        match.waitA = Boolean(waits?.[i * 2])
        match.waitB = Boolean(waits?.[i * 2 + 1])
        if (!match.waitA && !match.waitB) {
          if (match.slotA && !match.slotB) {
            match.outcome = 'bye'
            match.winnerId = match.slotA
          } else if (match.slotB && !match.slotA) {
            match.outcome = 'bye'
            match.winnerId = match.slotB
          } else if (!match.slotA && !match.slotB) {
            match.outcome = 'bye'
          }
        }
      } else {
        const prevA = matches.find((m) => m.id === `m-r${r - 1}-m${i * 2}`)
        const prevB = matches.find((m) => m.id === `m-r${r - 1}-m${i * 2 + 1}`)
        feedWinner(prevA, match, 'A', id)
        feedWinner(prevB, match, 'B', id)
      }
      if (r === rounds - 1) {
        match.placeWin = 1
        match.placeLose = 2
      }
      matches.push(match)
    }
  }
  const settled = settle(matches, new Set())
  matches.splice(0, matches.length, ...settled)
  if (settings.bracket === 'consolation') addConsolation(matches, rounds, settings, awards)
  for (let r = 0; r < rounds - 1 && settings.bracket !== 'consolation'; r++) {
    const inRound = matches.filter((m) => m.stage === 'main' && m.round === r)
    const producers = inRound.filter((m) => m.outcome !== 'bye')
    if (producers.length === 0) continue
    const winners = inRound.filter((m) => m.outcome !== 'bye' || !!m.winnerId).length
    const band = { from: winners + 1, to: winners + producers.length }
    const entries = producers.map((m) => ({ playerId: null, fromLoserOf: m.id }))
    playBand(entries, band, settings, 'main', `pm${band.from}`, matches, awards, producers)
  }
  const seeds: Record<string, number> = {}
  slots.forEach((id, i) => {
    if (id) seeds[id] = seedAtSlot[i]!
  })
  return { matches: settle(matches, new Set()), awards, seeds }
}

export function groupLeftoverBands(
  groups: { id: string; playerIds: string[] }[],
  standingsOf: (groupId: string, playerIds: string[]) => string[],
  fieldIds: Set<string>,
  withdrawn: Set<string>,
  advancePerGroup: number,
  play: boolean,
  bestOf: 3 | 5,
  placeStart: number,
): { matches: Match[]; awards: Award[]; shared: { playerIds: string[]; from: number; to: number }[] } {
  const matches: Match[] = []
  const awards: Award[] = []
  const shared: { playerIds: string[]; from: number; to: number }[] = []
  let place = placeStart
  const maxSize = Math.max(0, ...groups.map((g) => g.playerIds.length))
  for (let pos = advancePerGroup; pos < maxSize; pos++) {
    const ids: string[] = []
    for (const g of groups) {
      const order = standingsOf(g.id, g.playerIds).filter((id) => !withdrawn.has(id))
      const id = order[pos]
      if (id && !fieldIds.has(id)) ids.push(id)
    }
    if (ids.length === 0) continue
    if (ids.length === 1) {
      awards.push({ playerId: ids[0]!, place, source: 'group' })
      place += 1
    } else if (play) {
      buildPlaceOut(
        ids.map((playerId) => ({ playerId })),
        place,
        `gg${place}`,
        bestOf,
        'group',
        matches,
        awards,
      )
      place += ids.length
    } else {
      const parts = tilePlaceBands(place, ids.length)
      let at = 0
      let end = place - 1
      for (const part of parts) {
        shared.push({ playerIds: ids.slice(at, at + part.take), from: part.from, to: part.to })
        at += part.take
        end = Math.max(end, part.to)
      }
      place = end + 1
    }
  }
  return { matches: settle(matches, withdrawn), awards, shared }
}

export function placeCohort(
  ids: string[],
  place: number,
  enabled: boolean,
  bestOf: 3 | 5,
  source: Award['source'],
  prefix: string,
): { matches: Match[]; awards: Award[]; shared: { playerIds: string[]; from: number; to: number }[]; next: number } {
  const matches: Match[] = []
  const awards: Award[] = []
  const shared: { playerIds: string[]; from: number; to: number }[] = []
  if (ids.length === 0) return { matches, awards, shared, next: place }
  let next = place + ids.length
  if (ids.length === 1) awards.push({ playerId: ids[0]!, place, source })
  else if (enabled) {
    buildPlaceOut(
      ids.map((playerId) => ({ playerId })),
      place,
      prefix,
      bestOf,
      source,
      matches,
      awards,
    )
  } else {
    const parts = tilePlaceBands(place, ids.length)
    let at = 0
    let end = place - 1
    for (const part of parts) {
      shared.push({ playerIds: ids.slice(at, at + part.take), from: part.from, to: part.to })
      at += part.take
      end = Math.max(end, part.to)
    }
    next = end + 1
  }
  return { matches: settle(matches, new Set()), awards, shared, next }
}
