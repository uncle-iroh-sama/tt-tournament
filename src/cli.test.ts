import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { main } from './cli.ts'
import { assignTable, readyMatches } from './logic/engine.ts'
import type { Tournament } from './logic/types.ts'
import { tournamentFromJson } from './storage.ts'

function nameAt(i: number): string {
  if (i === 2) return 'Kowalski Adam'
  if (i === 16) return 'Kowalski Jan'
  if (i === 17) return 'Żółć Anna'
  if (i === 18) return 'Nowak Piotr'
  if (i === 19) return 'Wójcik Łukasz'
  return `Zawodnik ${String(i + 1).padStart(2, '0')}`
}

describe('operator CLI', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
    roots.length = 0
  })

  function rootDir(): string {
    const root = mkdtempSync(join(tmpdir(), 'tt-cli-'))
    roots.push(root)
    return root
  }

  function run(root: string, argv: string[]) {
    let out = ''
    let err = ''
    const code = main(argv, {
      root,
      stdout: (text) => {
        out += text
      },
      stderr: (text) => {
        err += text
      },
    })
    return { code, out, err }
  }

  function load(root: string, slug: string): Tournament {
    const t = tournamentFromJson(readFileSync(join(root, 'public', 'live', `${slug}.json`), 'utf8'))
    if (!t) throw new Error('live file did not load')
    return t
  }

  it('runs a 40-player event from paper pairs, a walkover, a set count and an undo', () => {
    const root = rootDir()
    const players = Array.from({ length: 40 }, (_, i) => ({
      name: nameAt(i),
      club: 'KS Test',
      ranking: 4000 - i,
    }))
    const rest = players.slice(16)
    const pairs: { a: string; b: string | null }[] = []
    for (let i = 0; i < 16; i += 2) pairs.push({ a: rest[i]!.name, b: rest[i + 1]!.name })
    for (let i = 16; i < rest.length; i++) pairs.push({ a: rest[i]!.name, b: null })
    const short = join(root, 'short.json')
    writeFileSync(
      short,
      JSON.stringify({
        version: 1,
        settings: {
          name: 'Grand Prix Kalisz',
          date: '2026-11-21',
          mainDrawSize: 32,
          directSeeds: 16,
        },
        players,
        fixedFirstRound: pairs,
      }),
    )

    const init = run(root, ['init', 'kalisz', short])
    expect(init.code, init.err).toBe(0)
    expect(init.out).toContain('8 matches')
    expect(init.out).toContain('8 byes')
    let t = load(root, 'kalisz')
    expect(t.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const first = t.matches.find((m) => m.id === 'q-r0-m0')!
    const jan = t.players.find((p) => p.name === 'Kowalski Jan')!
    const zolc = t.players.find((p) => p.name === 'Żółć Anna')!
    expect(first.slotA).toBe(jan.id)
    expect(first.slotB).toBe(zolc.id)
    expect(first.outcome).toBe('pending')

    const ambiguous = run(root, ['result', 'kalisz', 'Kowalski', 'Zolc', '3:1'])
    expect(ambiguous.code).toBe(1)
    expect(ambiguous.err).toContain('Kowalski Jan')
    expect(ambiguous.err).toContain('Kowalski Adam')

    const status = run(root, ['status', 'kalisz'])
    expect(status.code, status.err).toBe(0)
    expect(status.out).toContain('qualifying ·')
    expect(status.out).toContain('Kowalski Jan')
    expect(status.out).toContain('next:')

    const seated = assignTable(t, first.id, 3)
    expect(seated.ok).toBe(true)
    if (!seated.ok) return
    writeFileSync(join(root, 'public', 'live', 'kalisz.json'), `${JSON.stringify(seated.tournament, null, 2)}\n`)
    const onTable = run(root, ['status', 'kalisz'])
    expect(onTable.out).toContain('table 3  Kowalski Jan – Żółć Anna')

    const counted = run(root, ['result', 'kalisz', 'Jan Kowalski', 'Zolc', '3:1'])
    expect(counted.code, counted.err).toBe(0)
    expect(counted.out).toContain('Kowalski Jan beat Żółć Anna 3:1')
    t = load(root, 'kalisz')
    const scored = t.matches.find((m) => m.id === 'q-r0-m0')!
    expect(scored.winnerId).toBe(jan.id)
    expect(scored.sets).toEqual([
      { a: 5, b: 11 },
      { a: 11, b: 5 },
      { a: 11, b: 5 },
      { a: 11, b: 5 },
    ])

    const again = run(root, ['result', 'kalisz', 'Kowalski Jan', 'Żółć Anna', '3:0'])
    expect(again.code).toBe(1)
    expect(again.err).toContain('already scored')

    const sets = run(root, ['result', 'kalisz', 'Wójcik Łukasz', 'Nowak Piotr', '11:9 11:7 9:11 11:6'])
    expect(sets.code, sets.err).toBe(0)
    expect(sets.out).toContain('Wójcik Łukasz beat Nowak Piotr 3:1 (11:9 11:7 9:11 11:6)')
    t = load(root, 'kalisz')
    const wojcik = t.players.find((p) => p.name === 'Wójcik Łukasz')!
    const bySets = t.matches.find((m) => m.id === 'q-r0-m1')!
    expect(bySets.winnerId).toBe(wojcik.id)
    expect(bySets.sets[0]).toEqual({ a: 9, b: 11 })

    const wo = run(root, ['result', 'kalisz', nameAt(21), nameAt(20), 'wo'])
    expect(wo.code, wo.err).toBe(0)
    expect(wo.out).toContain(`walkover`)
    t = load(root, 'kalisz')
    const walked = t.matches.find((m) => m.id === 'q-r0-m2')!
    expect(walked.outcome).toBe('walkover')
    expect(walked.winnerId).toBe(t.players.find((p) => p.name === nameAt(21))!.id)

    const undone = run(root, ['undo', 'kalisz', 'Jan Kowalski', 'Zolc Anna'])
    expect(undone.code, undone.err).toBe(0)
    t = load(root, 'kalisz')
    expect(t.matches.find((m) => m.id === 'q-r0-m0')!.outcome).toBe('pending')

    for (let guard = 0; guard < 20; guard++) {
      t = load(root, 'kalisz')
      const pending = t.matches.filter(
        (m) => m.stage === 'qualifying' && m.round === 0 && m.outcome === 'pending' && m.slotA && m.slotB,
      )
      if (pending.length === 0) break
      const m = pending[0]!
      const a = t.players.find((p) => p.id === m.slotA)!.name
      const b = t.players.find((p) => p.id === m.slotB)!.name
      const res = run(root, ['result', 'kalisz', a, b, '3:0'])
      expect(res.code, res.err).toBe(0)
    }
    t = load(root, 'kalisz')
    expect(t.matches.filter((m) => m.id.startsWith('q-r0-') && m.outcome === 'pending')).toHaveLength(0)

    const drawn = run(root, ['draw-main', 'kalisz'])
    expect(drawn.code, drawn.err).toBe(0)
    expect(drawn.out).toContain('from the ranking')
    t = load(root, 'kalisz')
    expect(t.phase).toBe('main')
    expect(t.mainSlots?.filter(Boolean)).toHaveLength(32)
    const left = t.matches.find((m) => m.id === 'm-r0-m0')!
    const right = t.matches.find((m) => m.id === 'm-r0-m1')!
    expect(left.winnerTo?.matchId).toBe('m-r1-m0')
    expect(right.winnerTo?.matchId).toBe('m-r1-m0')
    for (const m of [left, right]) {
      const a = t.players.find((p) => p.id === m.slotA)!.name
      const b = t.players.find((p) => p.id === m.slotB)!.name
      const res = run(root, ['result', 'kalisz', a, b, '3:0'])
      expect(res.code, res.err).toBe(0)
    }
    t = load(root, 'kalisz')
    const next = t.matches.find((m) => m.id === 'm-r1-m0')!
    expect(next.slotA && next.slotB).toBeTruthy()
    const fed = run(root, [
      'result',
      'kalisz',
      t.players.find((p) => p.id === next.slotA)!.name,
      t.players.find((p) => p.id === next.slotB)!.name,
      '3:0',
    ])
    expect(fed.code, fed.err).toBe(0)
    const blocked = run(root, [
      'undo',
      'kalisz',
      t.players.find((p) => p.id === left.slotA)!.name,
      t.players.find((p) => p.id === left.slotB)!.name,
    ])
    expect(blocked.code).toBe(1)
    expect(blocked.err).toContain('Cannot clear')
    expect(blocked.err).toContain(t.players.find((p) => p.id === next.slotA)!.name)
    t = load(root, 'kalisz')
    expect(t.matches.find((m) => m.id === 'm-r0-m0')!.outcome).toBe('score')

    const late = run(root, ['player', 'add', 'kalisz', 'Spóźniony Adam', 'KS Test', '100'])
    expect(late.code).toBe(1)
    expect(late.err).toContain('already made')
    const replaced = run(root, ['init', 'kalisz', short])
    expect(replaced.code).toBe(1)
    expect(replaced.err).toContain('already has results')

    const board = run(root, ['status', 'kalisz'])
    expect(board.out).toContain('main draw ·')
    expect(board.out).toContain('next:')
    expect(readyMatches(t).length).toBeGreaterThan(0)
  })

  it('edits the entry before the draw and lays a paper main draw', () => {
    const root = rootDir()
    const short = join(root, 'short.json')
    writeFileSync(
      short,
      JSON.stringify({
        version: 1,
        settings: { name: 'Mały turniej', date: '2026-11-21', mainDrawSize: 16, directSeeds: 8 },
        players: [
          { name: 'Lis Robert', club: 'KS Energetyk Poznań', ranking: 1100 },
          { name: 'Bąk Ewa', club: 'KS Test', ranking: 1000 },
          { name: 'Cieślak Adam', club: 'KS Test', ranking: 900 },
          { name: 'Dudek Maria', club: 'KS Test', ranking: 800 },
        ],
      }),
    )
    expect(run(root, ['init', 'maly', short]).code).toBe(0)
    expect(run(root, ['init', 'maly', short]).out).toContain('Draw the main event')
    const added = run(root, ['player', 'add', 'maly', 'Grabowska Anna', 'KU AZS Poznań', '700'])
    expect(added.code, added.err).toBe(0)
    const renamed = run(root, ['player', 'rename', 'maly', 'Grabowska', 'Grabowska Anna Maria'])
    expect(renamed.code, renamed.err).toBe(0)
    const removed = run(root, ['player', 'remove', 'maly', 'Bak Ewa'])
    expect(removed.code, removed.err).toBe(0)
    let t = load(root, 'maly')
    expect(t.players.map((p) => p.name).sort()).toEqual([
      'Cieślak Adam',
      'Dudek Maria',
      'Grabowska Anna Maria',
      'Lis Robert',
    ])

    const pairs = join(root, 'pary.json')
    writeFileSync(
      pairs,
      JSON.stringify([
        { a: 'Lis Robert', b: 'Cieślak Adam' },
        { a: 'Dudek Maria', b: 'Grabowska Anna Maria' },
      ]),
    )
    const drawn = run(root, ['draw-main', 'maly', '--fixed', pairs])
    expect(drawn.code, drawn.err).toBe(0)
    expect(drawn.out).toContain('paper pairs')
    t = load(root, 'maly')
    const first = t.matches.find((m) => m.id === 'm-r0-m0')!
    expect(t.players.find((p) => p.id === first.slotA)!.name).toBe('Lis Robert')
    expect(t.players.find((p) => p.id === first.slotB)!.name).toBe('Cieślak Adam')
    expect(t.updatedAt).toBeTruthy()
    const locked = run(root, ['player', 'remove', 'maly', 'Lis Robert'])
    expect(locked.code).toBe(1)
    expect(locked.err).toContain('already made')
  })
})
