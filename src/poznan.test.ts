import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { main } from './cli.ts'
import { classification } from './logic/classify.ts'
import { readyMatches } from './logic/engine.ts'
import fixture from './logic/fixtures/poznan-2026-11-21.json' with { type: 'json' }
import type { Tournament } from './logic/types.ts'
import { tournamentFromJson } from './storage.ts'

const root = mkdtempSync(join(tmpdir(), 'tt-poznan-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function tt(...argv: string[]): string {
  let out = ''
  let err = ''
  const code = main(argv, { root, stdout: (s) => { out += s }, stderr: (s) => { err += s } })
  if (code !== 0) throw new Error(`tt ${argv.join(' ')}: ${err}`)
  return out
}

function load(): Tournament {
  return tournamentFromJson(readFileSync(join(root, 'public', 'live', 'poznan.json'), 'utf8'))!
}

function name(t: Tournament, id: string | null): string {
  return t.players.find((p) => p.id === id)!.name
}

describe('Poznań, 21 Nov 2026, replayed as a feed-in consolation', () => {
  it('reaches the official final classification', () => {
    const short = join(root, 'short.json')
    const pairs = join(root, 'main.json')
    writeFileSync(short, JSON.stringify(fixture.tournament))
    writeFileSync(pairs, JSON.stringify(fixture.mainDraw))
    tt('init', 'poznan', short)

    const results = fixture.results.slice()
    while (results.length > 0) {
      const t = load()
      const at = results.findIndex(([winner, loser]) =>
        readyMatches(t).some((m) => [m.slotA, m.slotB].map((id) => name(t, id)).sort().join() === [winner, loser].sort().join()))
      if (at < 0) {
        expect(t.phase, `stuck before ${results[0]!.join(' ')}`).toBe('qualifying')
        tt('draw-main', 'poznan', '--fixed', pairs)
        continue
      }
      const [winner, loser, score] = results.splice(at, 1)[0]!
      tt('result', 'poznan', winner!, loser!, score!)
    }

    let skipped = 0
    for (let m = readyMatches(load())[0]; m; m = readyMatches(load())[0]) {
      const t = load()
      expect(m.label.k).toBe('place')
      tt('skip', 'poznan', name(t, m.slotA), name(t, m.slotB))
      skipped++
    }
    expect(skipped).toBe(14)

    const t = load()
    expect(t.matches.filter((m) => m.outcome === 'pending')).toEqual([])
    const computed = classification(t).map((row) => ({
      place: row.ref.kind === 'place' ? `${row.ref.place}` : `${row.ref.from}-${row.ref.to}`,
      name: name(t, row.playerId),
      points: row.points,
    }))
    const byPlace = (rows: { place: string; name: string; points: number | null }[]) =>
      rows.map((r) => `${r.place} ${r.name} ${r.points}`).sort()
    expect(byPlace(computed)).toEqual(byPlace(fixture.official))
    expect(computed.slice(0, 8).map((r) => r.name)).toEqual(fixture.official.slice(0, 8).map((r) => r.name))
  })
})
