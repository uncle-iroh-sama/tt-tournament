import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { qualifyingEntrants } from './logic/build.ts'
import {
  addPlayer,
  clearResult,
  enterScore,
  enterWalkover,
  generateMainDraw,
  generateQualifying,
  qualifyingRequired,
  readyMatches,
  removePlayer,
  updatePlayer,
} from './logic/engine.ts'
import type { PaperPair } from './logic/fixed.ts'
import { findPlayerByName } from './logic/names.ts'
import { makeDrawCode } from './logic/rng.ts'
import { explainSets, setsFromCount } from './logic/score.ts'
import type { Match, Player, SetScore, Tournament } from './logic/types.ts'
import { countFinished } from './logic/classify.ts'
import { isLiveSlug, tournamentFromJson } from './storage.ts'
import { roundHeading } from './ui/format.ts'

class CliError extends Error {}

export interface CliIO {
  root?: string
  stdout?: (text: string) => void
  stderr?: (text: string) => void
}

function livePath(root: string, slug: string): string {
  return join(root, 'public', 'live', `${slug}.json`)
}

function readText(path: string): string {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    throw new CliError(`Cannot read ${path}`)
  }
}

function loadLive(root: string, slug: string): Tournament {
  if (!isLiveSlug(slug)) throw new CliError(`"${slug}" is not a file name. Use lowercase letters, digits and hyphens.`)
  const path = livePath(root, slug)
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    throw new CliError(`No ${path}. Run: npm run tt -- init ${slug} <short.json>`)
  }
  const t = tournamentFromJson(raw)
  if (!t) throw new CliError(`${path} is not a tournament file.`)
  return t
}

function saveLive(root: string, slug: string, t: Tournament) {
  const path = livePath(root, slug)
  const next: Tournament = { ...t, updatedAt: new Date().toISOString() }
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(next, null, 2)}\n`)
  return next
}

function playerName(t: Tournament, id: string | null): string {
  if (!id) return 'bye'
  return t.players.find((p) => p.id === id)?.name ?? id
}

function requireName(players: Player[], query: string): Player {
  const hit = findPlayerByName(players, query)
  if (hit.ok) return hit.player
  if (hit.error === 'ambiguous') {
    throw new CliError(`"${query}" matches more than one player: ${hit.names.join(', ')}. Use the full name.`)
  }
  throw new CliError(`No player matches "${query}".`)
}

function pairText(t: Tournament, m: Match): string {
  return `${playerName(t, m.slotA)} – ${playerName(t, m.slotB)} (${roundHeading(m, 'en')})`
}

function findBetween(t: Tournament, aId: string, bId: string): Match[] {
  return t.matches.filter(
    (m) => (m.slotA === aId && m.slotB === bId) || (m.slotA === bId && m.slotB === aId),
  )
}

function playable(m: Match): boolean {
  return m.outcome === 'pending' && !!m.slotA && !!m.slotB && !m.waitA && !m.waitB
}

function played(m: Match): boolean {
  return m.outcome === 'score' || m.outcome === 'walkover' || m.outcome === 'retirement'
}

function explainEngine(t: Tournament, error: string, detail?: string): string {
  const named = detail
    ? detail.split(',').filter(Boolean).map((id) => {
        const m = t.matches.find((x) => x.id === id)
        return m ? pairText(t, m) : id
      })
    : []
  switch (error) {
    case 'qualifying-open':
      return 'Qualifying is not finished yet.'
    case 'qualifying-skip':
      return 'This field does not need qualifying. Draw the main event instead.'
    case 'fixed-name':
      return 'A name in the pairings is not on the player list.'
    case 'fixed-field':
      return 'The pairs do not cover exactly the players in this round, each once. In qualifying, leave the direct seeds out.'
    case 'fixed-duplicate':
      return 'Someone is listed twice in the pairs.'
    case 'fixed-empty':
      return 'A pair is empty. A bye still needs the player who receives it.'
    case 'fixed-size':
      return 'There are more pairs than this draw can hold.'
    case 'fixed-groups':
      return 'Paper pairs are for a knock-out draw, not for groups.'
    case 'main-started':
      return 'The main draw already has a result, so it cannot be redrawn.'
    case 'results-exist':
      return 'There are already results, so the draw cannot be rebuilt.'
    case 'too-few':
      return 'Not enough players to draw.'
    case 'draw-locked':
      return 'The draw is already made. Player changes are only possible before it.'
    case 'not-played':
      return 'That match has no result to clear.'
    case 'downstream':
      return `Cannot clear it. A later match already depends on it: ${named.join('; ')}.`
    case 'invalid-set':
      return 'A set is not a legal table-tennis set (to 11, won by two).'
    case 'no-winner':
      return 'That score does not finish the match.'
    case 'extra-sets':
      return 'The score has sets after the match was already won.'
    case 'empty':
      return 'The score is empty.'
    default:
      return error
  }
}

function must<T extends { ok: true; tournament: Tournament } | { ok: false; error: string; detail?: string }>(
  t: Tournament,
  res: T,
): Tournament {
  if (!res.ok) throw new CliError(explainEngine(t, res.error, res.detail))
  return res.tournament
}

function readPairs(raw: string, path: string): PaperPair[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new CliError(`${path} is not JSON.`)
  }
  const list = Array.isArray(data)
    ? data
    : data && typeof data === 'object' && Array.isArray((data as { pairs?: unknown }).pairs)
      ? (data as { pairs: unknown[] }).pairs
      : data && typeof data === 'object' && Array.isArray((data as { fixedFirstRound?: unknown }).fixedFirstRound)
        ? (data as { fixedFirstRound: unknown[] }).fixedFirstRound
        : null
  if (!list) throw new CliError(`${path} needs a list of pairs: [{ "a": "Name", "b": "Name or null" }].`)
  const pairs: PaperPair[] = []
  for (const item of list) {
    if (!item || typeof item !== 'object') throw new CliError(`${path} has a pair that is not an object.`)
    const row = item as { a?: unknown; b?: unknown }
    const a = row.a == null ? '' : String(row.a).trim()
    if (!a) throw new CliError(`${path} has a pair with no player.`)
    const b = row.b == null || String(row.b).trim() === '' ? null : String(row.b).trim()
    pairs.push({ a, b })
  }
  return pairs
}

function parseScore(text: string): { kind: 'wo' } | { kind: 'count'; a: number; b: number } | { kind: 'sets'; sets: SetScore[] } {
  const trimmed = text.trim()
  if (/^(wo|w\.o\.|walkover|walkower)$/i.test(trimmed)) return { kind: 'wo' }
  const parts = trimmed.split(/\s+/).filter(Boolean)
  const pairs = parts.map((part) => {
    const m = /^(\d+)\s*[:-]\s*(\d+)$/.exec(part)
    if (!m) return null
    return { a: Number(m[1]), b: Number(m[2]) }
  })
  if (pairs.some((p) => !p)) throw new CliError(`Cannot read the score "${trimmed}". Use 3:1, or 11:7 9:11 11:8, or wo.`)
  const scores = pairs as { a: number; b: number }[]
  if (scores.length === 1) {
    const only = scores[0]!
    if (only.a <= 4 && only.b <= 4) return { kind: 'count', a: only.a, b: only.b }
  }
  return { kind: 'sets', sets: scores }
}

function orient(match: Match, firstId: string, sets: SetScore[]): SetScore[] {
  if (match.slotA === firstId) return sets
  return sets.map((s) => ({ a: s.b, b: s.a }))
}

function setsWon(sets: SetScore[], firstIsA: boolean): string {
  let a = 0
  let b = 0
  for (const s of sets) {
    if (s.a > s.b) a++
    else b++
  }
  return firstIsA ? `${a}:${b}` : `${b}:${a}`
}

function showSets(sets: SetScore[], firstIsA: boolean): string {
  const view = firstIsA ? sets : sets.map((s) => ({ a: s.b, b: s.a }))
  return view.map((s) => `${s.a}:${s.b}`).join(' ')
}

function cmdInit(root: string, slug: string, shortPath: string): string {
  if (!isLiveSlug(slug)) throw new CliError(`"${slug}" is not a file name. Use lowercase letters, digits and hyphens.`)
  if (!shortPath) throw new CliError('Usage: npm run tt -- init <slug> <short.json>')
  const parsed = tournamentFromJson(readText(shortPath))
  if (!parsed) throw new CliError(`${shortPath} is not a tournament file. It needs version 1, settings and players.`)
  const existingPath = livePath(root, slug)
  try {
    const existing = tournamentFromJson(readFileSync(existingPath, 'utf8'))
    if (existing?.matches.some((m) => played(m))) {
      throw new CliError(`${existingPath} already has results. Refusing to replace it.`)
    }
  } catch (err) {
    if (err instanceof CliError) throw err
  }
  let t = parsed
  if (!t.drawCode || t.drawCode === 'IMPORT') t = { ...t, drawCode: makeDrawCode() }
  if (!t.settings.name.trim()) t = { ...t, settings: { ...t.settings, name: slug } }
  if (qualifyingRequired(t)) {
    t = must(t, generateQualifying(t))
    const round = t.matches.filter((m) => m.stage === 'qualifying' && m.round === 0)
    const byes = round.filter((m) => m.outcome === 'bye').length
    const games = round.length - byes
    const direct = t.directIds.length
    saveLive(root, slug, t)
    return `Wrote public/live/${slug}.json\nQualifying drawn: ${games} matches, ${byes} byes, ${direct} direct to the main draw.\n`
  }
  saveLive(root, slug, t)
  return `Wrote public/live/${slug}.json\nNo qualifying for ${t.players.length} players. Draw the main event with: npm run tt -- draw-main ${slug}\n`
}

function cmdResult(root: string, slug: string, aQuery: string, bQuery: string, scoreText: string): string {
  if (!aQuery || !bQuery || !scoreText) throw new CliError('Usage: npm run tt -- result <slug> "<player A>" "<player B>" <3:1 | 11:7 9:11 11:8 | wo>')
  let t = loadLive(root, slug)
  const a = requireName(t.players, aQuery)
  const b = requireName(t.players, bQuery)
  if (a.id === b.id) throw new CliError('Those two names are the same player.')
  const hits = findBetween(t, a.id, b.id)
  const ready = hits.filter(playable)
  if (ready.length > 1) throw new CliError(`${a.name} and ${b.name} have more than one match ready.`)
  if (ready.length === 0) {
    const done = hits.filter(played)
    if (done.length) throw new CliError(`${a.name} – ${b.name} is already scored. Undo it before entering another result.`)
    if (hits.length) throw new CliError(`${a.name} – ${b.name} is on the draw but not playable yet.`)
    throw new CliError(`No match between ${a.name} and ${b.name}.`)
  }
  const match = ready[0]!
  const score = parseScore(scoreText)
  if (score.kind === 'wo') {
    t = must(t, enterWalkover(t, match.id, a.id))
    saveLive(root, slug, t)
    return `Recorded: ${a.name} walkover against ${b.name}.\n`
  }
  let sets = score.kind === 'sets' ? score.sets : setsFromCount(score.a, score.b)
  if (!sets) throw new CliError(`Score ${scoreText} is not a finished match.`)
  const problem = explainSets(sets, match.bestOf)
  if (problem === 'no-winner') {
    throw new CliError(`Score ${scoreText} does not finish a match played to ${match.bestOf === 5 ? 3 : 2} sets.`)
  }
  if (problem) throw new CliError(explainEngine(t, problem))
  const stored = orient(match, a.id, sets)
  t = must(t, enterScore(t, match.id, stored))
  saveLive(root, slug, t)
  const saved = t.matches.find((m) => m.id === match.id)!
  const firstIsA = match.slotA === a.id
  return `Recorded: ${a.name} beat ${b.name} ${setsWon(saved.sets, firstIsA)} (${showSets(saved.sets, firstIsA)}).\n`
}

function cmdUndo(root: string, slug: string, aQuery: string, bQuery: string): string {
  if (!aQuery || !bQuery) throw new CliError('Usage: npm run tt -- undo <slug> "<player A>" "<player B>"')
  let t = loadLive(root, slug)
  const a = requireName(t.players, aQuery)
  const b = requireName(t.players, bQuery)
  const hits = findBetween(t, a.id, b.id).filter(played)
  if (hits.length === 0) throw new CliError(`No result between ${a.name} and ${b.name}.`)
  if (hits.length > 1) throw new CliError(`${a.name} and ${b.name} have more than one result.`)
  t = must(t, clearResult(t, hits[0]!.id))
  saveLive(root, slug, t)
  return `Cleared ${a.name} – ${b.name}.\n`
}

function cmdDrawMain(root: string, slug: string, fixedPath?: string): string {
  if (!slug) throw new CliError('Usage: npm run tt -- draw-main <slug> [--fixed <pairs.json>]')
  let t = loadLive(root, slug)
  let paper: PaperPair[] | null = null
  if (fixedPath) {
    paper = readPairs(readText(fixedPath), fixedPath)
    if (paper.length === 0) throw new CliError(`${fixedPath} has no pairs.`)
  }
  const before = t.matches.length
  t = must(t, generateMainDraw(t, paper))
  saveLive(root, slug, t)
  const added = t.matches.length - before
  const inDraw = t.mainSlots?.filter(Boolean).length ?? 0
  const how = paper ? 'from the paper pairs' : 'from the ranking'
  return `Main draw made ${how}: ${inDraw} players, ${added} matches, code ${t.drawCode}.\n`
}

function cmdStatus(root: string, slug: string): string {
  const t = loadLive(root, slug)
  const stage = t.phase === 'main' ? 'main draw' : t.phase === 'qualifying' ? 'qualifying' : 'not drawn'
  const { done, total } = countFinished(t)
  const lines = [t.settings.name || slug, `${stage} · ${done}/${total} played`]
  if (t.updatedAt) {
    const when = new Date(t.updatedAt)
    if (!Number.isNaN(when.getTime())) {
      lines.push(`updated ${when.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`)
    }
  }
  const onTables = t.matches
    .filter((m) => m.outcome === 'pending' && m.table != null)
    .sort((a, b) => (a.table ?? 0) - (b.table ?? 0))
  lines.push('on tables:')
  if (onTables.length === 0) lines.push('  —')
  for (const m of onTables) lines.push(`  table ${m.table}  ${playerName(t, m.slotA)} – ${playerName(t, m.slotB)}  (${roundHeading(m, 'en')})`)
  const next = readyMatches(t).filter((m) => m.table == null).slice(0, 8)
  lines.push('next:')
  if (next.length === 0) lines.push('  —')
  for (const m of next) lines.push(`  ${playerName(t, m.slotA)} – ${playerName(t, m.slotB)}  (${roundHeading(m, 'en')})`)
  if (t.phase === 'qualifying') {
    const { direct, rest } = qualifyingEntrants(t.players, t.settings)
    lines.push(`qualifying ${rest.length}, direct ${direct.length}`)
  }
  return `${lines.join('\n')}\n`
}

function rankingOf(token: string | undefined): { rankingPoints: number | null; rankingPosition: number | null } {
  if (!token) return { rankingPoints: null, rankingPosition: null }
  if (token.startsWith('#')) {
    const n = Number(token.slice(1))
    if (!Number.isFinite(n)) throw new CliError(`"${token}" is not a ranking place.`)
    return { rankingPoints: null, rankingPosition: n }
  }
  const n = Number(token)
  if (!Number.isFinite(n)) throw new CliError(`"${token}" is not a ranking.`)
  return { rankingPoints: n, rankingPosition: null }
}

function cmdPlayer(root: string, args: string[]): string {
  const [sub, slug, ...rest] = args
  if (!sub || !slug) throw new CliError('Usage: npm run tt -- player add|rename|remove <slug> ...')
  let t = loadLive(root, slug)
  if (t.phase !== 'setup') throw new CliError('The draw is already made. Change players only before the draw (edit the short file and run init again, if no result has been entered).')
  if (sub === 'add') {
    const [name, club, rank] = rest
    if (!name || club == null) throw new CliError('Usage: npm run tt -- player add <slug> "<name>" "<club>" [ranking|#place]')
    const nums = rankingOf(rank)
    t = addPlayer(t, { name, club, ...nums })
    saveLive(root, slug, t)
    return `Added ${name.trim()} (${club.trim()}). ${t.players.length} players.\n`
  }
  if (sub === 'rename') {
    const [from, to] = rest
    if (!from || !to) throw new CliError('Usage: npm run tt -- player rename <slug> "<current name>" "<new name>"')
    const player = requireName(t.players, from)
    t = updatePlayer(t, player.id, { name: to })
    saveLive(root, slug, t)
    return `Renamed ${player.name} → ${to.trim()}.\n`
  }
  if (sub === 'remove') {
    const name = rest[0]
    if (!name) throw new CliError('Usage: npm run tt -- player remove <slug> "<name>"')
    const player = requireName(t.players, name)
    t = must(t, removePlayer(t, player.id))
    saveLive(root, slug, t)
    return `Removed ${player.name}. ${t.players.length} players.\n`
  }
  throw new CliError('Usage: npm run tt -- player add|rename|remove <slug> ...')
}

function help(): string {
  return [
    'Usage:',
    '  npm run tt -- init <slug> <short.json>',
    '  npm run tt -- result <slug> "<A>" "<B>" <3:1 | 11:7 9:11 11:8 | wo>',
    '  npm run tt -- undo <slug> "<A>" "<B>"',
    '  npm run tt -- draw-main <slug> [--fixed <pairs.json>]',
    '  npm run tt -- status <slug>',
    '  npm run tt -- player add <slug> "<name>" "<club>" [ranking]',
    '  npm run tt -- player rename <slug> "<current>" "<new>"',
    '  npm run tt -- player remove <slug> "<name>"',
    '',
  ].join('\n')
}

export function main(argv: string[], io: CliIO = {}): number {
  const root = io.root ?? process.cwd()
  const stdout = io.stdout ?? ((text) => process.stdout.write(text))
  const stderr = io.stderr ?? ((text) => process.stderr.write(text))
  try {
    const [cmd, ...rest] = argv
    if (cmd === 'init') stdout(cmdInit(root, rest[0] ?? '', rest[1] ?? ''))
    else if (cmd === 'result') stdout(cmdResult(root, rest[0] ?? '', rest[1] ?? '', rest[2] ?? '', rest.slice(3).join(' ')))
    else if (cmd === 'undo') stdout(cmdUndo(root, rest[0] ?? '', rest[1] ?? '', rest[2] ?? ''))
    else if (cmd === 'draw-main') {
      const flag = rest.indexOf('--fixed')
      const fixed = flag >= 0 ? rest[flag + 1] : undefined
      const args = flag < 0 ? rest : rest.filter((_, i) => i !== flag && i !== flag + 1)
      if (flag >= 0 && !fixed) throw new CliError('Usage: npm run tt -- draw-main <slug> --fixed <pairs.json>')
      stdout(cmdDrawMain(root, args[0] ?? '', fixed))
    } else if (cmd === 'status') stdout(cmdStatus(root, rest[0] ?? ''))
    else if (cmd === 'player') stdout(cmdPlayer(root, rest))
    else {
      stderr(help())
      return 1
    }
    return 0
  } catch (err) {
    stderr(`${err instanceof Error ? err.message : String(err)}\n`)
    return 1
  }
}

const entry = process.argv[1]
if (entry && realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)))
}
