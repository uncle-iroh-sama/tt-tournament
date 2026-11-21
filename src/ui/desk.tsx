import { useEffect, useMemo, useRef, useState } from 'react'
import type { Lang } from '../i18n.ts'
import { translate, type Key } from '../i18n.ts'
import { classification, countFinished } from '../logic/classify.ts'
import {
  addPlayer,
  applySuggestions,
  assignTable,
  defaultDirectSeeds,
  enterRetirement,
  enterScore,
  enterWalkover,
  fillFreedTable,
  generateMainDraw,
  generateQualifying,
  hasKnockout,
  qualifyingComplete,
  qualifyingRequired,
  readyMatches,
  removePlayer,
  simulateRemaining,
  skipMatch,
  suggestAssignments,
  swapMainSlots,
  undoAll,
  updatePlayer,
  updateSettings,
  withdrawPlayer,
} from '../logic/engine.ts'
import { groupPairings, groupStandings } from '../logic/groups.ts'
import { planGroupSizes, previewQualifying } from '../logic/plan.ts'
import { EDITABLE_POINT_KEYS, pointsFor } from '../logic/points.ts'
import { findPlayerByName } from '../logic/names.ts'
import { compareRanking } from '../logic/ranking.ts'
import { setCount } from '../logic/score.ts'
import { nextPow2 } from '../logic/seeds.ts'
import { BRACKETS, DRAW_SIZES, FORMATS } from '../logic/types.ts'
import type { Bracket, Category, DrawSize, Format, Match, PlaceFlags, PointsCategory, Settings, Tournament } from '../logic/types.ts'
import { isDemoTournament, parsePlayerLines } from '../demo.ts'
import { fetchLive, isLiveSlug, slugify } from '../storage.ts'
import { catKey, countForm, findPlayer, matchTitle, placeColumnTitle, pname, ratioText, roundHeading } from './format.ts'
import { ScoreDialog } from './score.tsx'

const CATS: Category[] = ['senior', 'mlodziezowiec', 'junior', 'kadet', 'mlodzik', 'zak', 'skrzat', 'masters']
const POINT_CATS: PointsCategory[] = ['senior', 'junior', 'kadet', 'mlodzik', 'zak', 'custom']

function pointsCategoryFor(category: Category): PointsCategory {
  if (category === 'senior' || category === 'junior' || category === 'kadet' || category === 'mlodzik' || category === 'zak') return category
  return 'custom'
}

function placeText(ref: { kind: string; place?: number; from?: number; to?: number }, dyskw: string): string {
  if (ref.kind === 'place') return String(ref.place)
  if (ref.kind === 'band') return `${ref.from}–${ref.to}`
  if (ref.kind === 'out') return dyskw
  return '…'
}

function officialLabel(place: string): string {
  return place.includes('-') ? place.replace('-', '–') : place
}

function officialRowOf(t: Tournament, name: string) {
  const rows = t.finalClassification
  if (!rows?.length) return undefined
  const hit = findPlayerByName(t.players, name)
  const key = hit.ok ? hit.player.name : name
  return rows.find((row) => {
    const rowHit = findPlayerByName(t.players, row.name)
    return (rowHit.ok ? rowHit.player.name : row.name) === key || row.name === name
  })
}

function demoCanSimulate(t: Tournament): boolean {
  if (!isDemoTournament(t)) return false
  if (t.phase === 'main') return readyMatches(t).some((m) => m.stage === 'main' || m.stage === 'placement')
  if (readyMatches(t).some((m) => m.stage === 'qualifying' || m.stage === 'group')) return true
  return t.phase === 'setup' && qualifyingRequired(t)
}

function matchLine(tr: (k: Key) => string, lang: Lang, key: 'playingNow' | 'playingNext', m: Match, foe: string): string {
  const table = m.table != null ? ` · ${tr('suggest')} ${m.table}` : ''
  return `${tr(key)}: ${matchTitle(m, lang)} · ${tr('versus')} ${foe}${table}`
}

function finishedLine(
  tr: (k: Key) => string,
  row: { ref: { kind: string; place?: number; from?: number; to?: number }; points: number | null },
): string {
  if (row.ref.kind === 'out') return tr('notClassifiedLong')
  const pts = row.points != null ? ` · ${row.points} ${tr('pointsShort')}` : ''
  if (row.ref.kind === 'band') return `${tr('placesWord')} ${row.ref.from}–${row.ref.to}${pts}`
  return `${tr('place')} ${row.ref.place}${pts}`
}

export function Desk({
  tournament: t,
  lang,
  route,
  go,
  setT,
  onError,
  onReplace,
  publishedSlug = null,
  onOpenPublished,
}: {
  tournament: Tournament
  lang: Lang
  route: string
  go: (hash: string) => void
  setT: (t: Tournament) => void
  onError: (code: string) => void
  onReplace: () => void
  publishedSlug?: string | null
  onOpenPublished?: (slug: string) => void
}) {
  const tr = (k: Key) => translate(lang, k)
  const [scoreId, setScoreId] = useState<string | null>(null)
  const [swapFrom, setSwapFrom] = useState<number | null>(null)
  const [roundOn, setRoundOn] = useState(0)
  const [editId, setEditId] = useState<string | null>(null)
  const [paste, setPaste] = useState('')
  const [form, setForm] = useState({ name: '', club: '', points: '', position: '' })
  const [ask, setAsk] = useState<null | { text: string; run: () => void }>(null)

  function act(res: { ok: true; tournament: Tournament } | { ok: false; error: string }) {
    if (!res.ok) onError(res.error)
    else setT(res.tournament)
  }

  function openMatch(id: string) {
    if (laterResult(t, id)) setAsk({ text: tr('correctWarn'), run: () => setScoreId(id) })
    else setScoreId(id)
  }

  const scoreMatch = t.matches.find((m) => m.id === scoreId) ?? null
  if (route.startsWith('#/druk')) {
    return <PrintView t={t} lang={lang} kind={route.replace('#/druk/', '')} />
  }
  if (route.startsWith('#/public')) {
    return <PublicView t={t} lang={lang} />
  }

  return (
    <>
      {route === '#/zawodnicy' && (
        <Players
          t={t} tr={tr} form={form} setForm={setForm} paste={paste} setPaste={setPaste}
          editId={editId} setEditId={setEditId} setT={setT} onError={onError} act={act} ask={setAsk}
        />
      )}
      {route === '#/eliminacje' && <Qualifying t={t} lang={lang} tr={tr} act={act} go={go} openScore={openMatch} />}
      {route === '#/drabinka' && (
        <Bracket
          t={t} lang={lang} tr={tr} roundOn={roundOn} setRoundOn={setRoundOn}
          swapFrom={swapFrom} setSwapFrom={setSwapFrom} act={act} ask={setAsk} openScore={openMatch}
        />
      )}
      {route === '#/mecze' && (
        <Matches t={t} lang={lang} tr={tr} setT={setT} act={act} onError={onError} openScore={setScoreId} ask={setAsk} />
      )}
      {route === '#/klasyfikacja' && <ClassView t={t} tr={tr} setT={setT} />}
      {route === '#/ustawienia' && <SettingsEdit t={t} tr={tr} setT={setT} />}
      {(route === '#/' || route === '') && (
        <Home
          t={t} lang={lang} tr={tr} go={go} setT={setT} act={act} onReplace={onReplace} ask={setAsk}
          publishedSlug={publishedSlug} onOpenPublished={onOpenPublished}
        />
      )}
      {scoreMatch && (
        <ScoreDialog
          tournament={t}
          match={scoreMatch}
          lang={lang}
          onClose={() => setScoreId(null)}
          onScore={(sets) => {
            const table = scoreMatch.table
            const res = enterScore(t, scoreMatch.id, sets)
            if (res.ok) setT(fillFreedTable(res.tournament, table))
            else onError(res.error)
            setScoreId(null)
          }}
          onWalkover={(id) => {
            const table = scoreMatch.table
            const res = enterWalkover(t, scoreMatch.id, id)
            if (res.ok) setT(fillFreedTable(res.tournament, table))
            else onError(res.error)
            setScoreId(null)
          }}
          onRetire={(id, sets) => {
            const table = scoreMatch.table
            const res = enterRetirement(t, scoreMatch.id, id, sets)
            if (res.ok) setT(fillFreedTable(res.tournament, table))
            else onError(res.error)
            setScoreId(null)
          }}
          onSkip={scoreMatch.label.k === 'place' && scoreMatch.placeBand && scoreMatch.outcome === 'pending' ? () => {
            const table = scoreMatch.table
            const res = skipMatch(t, scoreMatch.id)
            if (res.ok) setT(fillFreedTable(res.tournament, table))
            else onError(res.error)
            setScoreId(null)
          } : undefined}
        />
      )}
      {ask && (
        <div className="dialog-back" onMouseDown={() => setAsk(null)}>
          <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
            <p>{ask.text}</p>
            <div className="row">
              <button className="btn" onClick={() => { ask.run(); setAsk(null) }}>{tr('yes')}</button>
              <button className="btn secondary" onClick={() => setAsk(null)}>{tr('no')}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Home({
  t, lang, tr, go, setT, act, onReplace, ask, publishedSlug, onOpenPublished,
}: {
  t: Tournament
  lang: Lang
  tr: (k: Key) => string
  go: (h: string) => void
  setT: (t: Tournament) => void
  act: (r: { ok: true; tournament: Tournament } | { ok: false; error: string }) => void
  onReplace: () => void
  ask: (q: { text: string; run: () => void } | null) => void
  publishedSlug: string | null
  onOpenPublished?: (slug: string) => void
}) {
  const active = t.players.filter((p) => !p.withdrawn)
  const prog = countFinished(t)
  const champion = classification(t).find((r) => r.ref.kind === 'place' && r.ref.place === 1)
  const step = nextStep(t, lang)
  const plan = useMemo(() => describePlan(t, lang), [t, lang])
  const live = t.matches.filter((m) => m.outcome === 'pending' && m.table != null)
  return (
    <>
      <div className="banner">
        <strong>{step.title}</strong>
        <p className="muted">
          {tr(`format_${t.settings.format}`)}
          {hasKnockout(t.settings) && (
            <>
              {' · '}{tr(`bracket_${t.settings.bracket}`)}
              {' · '}<span className="keep">{tr('directSeeds')} {t.settings.directSeeds}</span>
              {' · '}<span className="keep">{tr('drawSize')} {t.settings.mainDrawSize}</span>
            </>
          )}
          {' · '}<span className="keep">{t.settings.bestOf === 5 ? tr('bestOf5') : tr('bestOf3')}</span>
          {hasKnockout(t.settings) && <>{' · '}<span className="keep">{tr('placeBestOf')}: {t.settings.placeMatchBestOf === 3 ? tr('bestOf3') : tr('bestOf5')}</span></>}
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          {step.kind === 'qual' && <button className="btn" data-testid="generate-qualifying" onClick={() => act(generateQualifying(t))}>{tr(hasKnockout(t.settings) ? 'generateQual' : 'generateSchedule')}</button>}
          {step.kind === 'main' && <button className="btn" data-testid="generate-main" onClick={() => act(generateMainDraw(t))}>{tr('generateMain')}</button>}
          {step.kind === 'play' && <button className="btn" onClick={() => go('#/mecze')}>{tr('navMatches')}</button>}
          {step.kind === 'players' && <button className="btn" onClick={() => go('#/zawodnicy')}>{tr('navPlayers')}</button>}
          {step.kind === 'done' && <button className="btn" onClick={() => go('#/klasyfikacja')}>{tr('navClass')}</button>}
          {demoCanSimulate(t) && (
            <button className="btn secondary" data-testid="simulate" onClick={() => act(simulateRemaining(t))}>{tr('simulate')}</button>
          )}
        </div>
      </div>
      <div className="stats">
        <div className="stat"><b>{active.length}</b><span>{tr('players')}</span></div>
        <div className="stat"><b>{t.settings.tables}</b><span>{tr('tables')}</span></div>
        <div className="stat"><b>{prog.done}/{prog.total}</b><span>{tr('progress')}</span></div>
        <div className="stat"><b>{champion ? pname(findPlayer(t, champion.playerId), lang) : '—'}</b><span>{tr('champion')}</span></div>
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <h2>{tr('planTitle')}</h2>
        {plan}
      </div>
      <div className="card">
        <h2>{tr('nowPlaying')}</h2>
        {live.length === 0 && <p className="muted">{tr('noLive')}</p>}
        {live.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
      </div>
      <div className="card no-print">
        <div className="row">
          <button className="btn secondary" onClick={() => download(t)}>{tr('export')}</button>
          <button className="btn secondary" onClick={() => go('#/druk/kartki')}>{tr('printSheets')}</button>
          {hasKnockout(t.settings) && <button className="btn secondary" onClick={() => go('#/druk/drabinka')}>{tr('printBracket')}</button>}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          {t.matches.length > 0 && (
            <button className="btn danger" onClick={() => ask({ text: tr('undoConfirm'), run: () => setT(undoAll(t)) })}>{tr('undo')}</button>
          )}
          <button className="btn danger" onClick={onReplace}>{tr('newTournament')}</button>
        </div>
        <p className="muted">{tr('drawCode')}: <b>{t.drawCode}</b>. {tr('drawCodeHint')}</p>
        {onOpenPublished && <PublishBox t={t} tr={tr} publishedSlug={publishedSlug} onOpen={onOpenPublished} />}
        {t.phase === 'setup' && (
          <label className="field" style={{ maxWidth: 220 }}>
            {tr('drawCode')}
            <input value={t.drawCode} onChange={(e) => setT({ ...t, drawCode: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8) })} />
          </label>
        )}
      </div>
    </>
  )
}

function nextStep(t: Tournament, lang: Lang): { title: string; kind: 'players' | 'qual' | 'main' | 'play' | 'done' } {
  const n = t.players.filter((p) => !p.withdrawn).length
  if (n < 2) return { title: translate(lang, 'nextQual'), kind: 'players' }
  const final = t.matches.find((m) => m.stage === 'main' && m.placeWin === 1 && (m.outcome === 'score' || m.outcome === 'walkover' || m.outcome === 'retirement'))
  if (final) return { title: translate(lang, 'nextDone'), kind: 'done' }
  if (!hasKnockout(t.settings)) {
    if (t.phase === 'setup') return { title: translate(lang, 'nextSchedule'), kind: 'qual' }
    if (!qualifyingComplete(t)) return { title: translate(lang, 'nextPlayTable'), kind: 'play' }
    return { title: translate(lang, 'nextDoneTable'), kind: 'done' }
  }
  if (t.phase === 'main') return { title: translate(lang, 'nextPlay'), kind: 'play' }
  if (!qualifyingRequired(t)) return { title: translate(lang, 'nextMainNow'), kind: 'main' }
  if (t.phase === 'setup') return { title: translate(lang, 'nextDrawQual'), kind: 'qual' }
  if (!qualifyingComplete(t)) return { title: translate(lang, 'nextPlay'), kind: 'play' }
  return { title: translate(lang, 'nextMain'), kind: 'main' }
}

function describePlan(t: Tournament, lang: Lang) {
  const tr = (k: Key) => translate(lang, k)
  const n = t.players.filter((p) => !p.withdrawn).length
  const s = t.settings
  if (s.format === 'knockout' && n <= s.mainDrawSize) {
    const preview = previewQualifying(n, s.mainDrawSize, s.directSeeds, 'knockout')
    return <p>{tr('planNone')} {tr('planMainByes')}: <b>{preview.byesInMain}</b>.</p>
  }
  if (s.format === 'roundRobin') {
    const pairs = groupPairings(n, 1)
    return (
      <div className="stats">
        <div className="stat"><b>{n}</b><span>{tr('players')}</span></div>
        <div className="stat"><b>{pairs.reduce((m, p) => Math.max(m, p.kolejka + 1), 0)}</b><span>{tr('planKolejki')}</span></div>
        <div className="stat"><b>{pairs.length}</b><span>{tr('planGroupMatches')}</span></div>
      </div>
    )
  }
  if (s.format === 'groups') {
    const direct = Math.min(s.directSeeds, n)
    const sizes = planGroupSizes(n - direct, s.groupSize)
    const matches = sizes.reduce((sum, size) => sum + groupPairings(size, s.advancePerGroup).length, 0)
    const kolejki = sizes.reduce((max, size) => Math.max(max, groupPairings(size, s.advancePerGroup).reduce((m, p) => Math.max(m, p.kolejka + 1), 0)), 0)
    const adv = direct + sizes.length * s.advancePerGroup
    return (
      <div className="stats">
        <div className="stat"><b>{sizes.length}</b><span>{tr('planGroups')} ({sizes.join('+')})</span></div>
        <div className="stat"><b>{kolejki}</b><span>{tr('planKolejki')}</span></div>
        <div className="stat"><b>{matches}</b><span>{tr('planGroupMatches')}</span></div>
        <div className="stat"><b>{Math.min(adv, s.mainDrawSize)}</b><span>{tr('planIntoMain')}</span></div>
        <div className="stat"><b>{Math.min(s.mainDrawSize, nextPow2(adv))}</b><span>{tr('drawSize')}</span></div>
        {adv > s.mainDrawSize && <p className="muted">{tr('planCut')}</p>}
      </div>
    )
  }
  const preview = previewQualifying(n, s.mainDrawSize, s.directSeeds, 'knockout')
  const ko = preview.knockout
  return (
    <>
      <div className="stats">
        <div className="stat"><b>{preview.direct}</b><span>{tr('planDirect')}</span></div>
        <div className="stat"><b>{preview.inQualifier}</b><span>{tr('planIn')}</span></div>
        <div className="stat"><b>{ko?.bracketSize ?? '—'}</b><span>{tr('planBracket')}</span></div>
        <div className="stat"><b>{preview.qualifyingRounds}</b><span>{tr('planRounds')}</span></div>
      </div>
      <ul>
        {ko?.rounds.map((r) => (
          <li key={r.index}>
            {tr('roundLine')} {r.index + 1}: {r.matches} {countForm(r.matches, lang, tr('matchOne'), tr('matchFew'), tr('matchMany'))}
            {r.byeMatches ? `, ${r.byeMatches} ${countForm(r.byeMatches, lang, tr('byeOne'), tr('byeFew'), tr('byeMany'))}` : ''}. {countForm(r.advancers, lang, tr('stayOne'), tr('stayFew'), tr('stayMany'))} {r.advancers}.
          </li>
        ))}
      </ul>
    </>
  )
}

function Players({
  t, tr, form, setForm, paste, setPaste, editId, setEditId, setT, onError, act, ask,
}: {
  t: Tournament
  tr: (k: Key) => string
  form: { name: string; club: string; points: string; position: string }
  setForm: (f: { name: string; club: string; points: string; position: string }) => void
  paste: string
  setPaste: (s: string) => void
  editId: string | null
  setEditId: (id: string | null) => void
  setT: (t: Tournament) => void
  onError: (c: string) => void
  act: (r: { ok: true; tournament: Tournament } | { ok: false; error: string }) => void
  ask: (q: { text: string; run: () => void } | null) => void
}) {
  const ranked = t.players.slice().sort(compareRanking)
  function readNums() {
    const points = form.points.trim() === '' ? null : Number(form.points)
    const position = form.position.trim() === '' ? null : Number(form.position)
    return {
      rankingPoints: points != null && Number.isFinite(points) ? points : null,
      rankingPosition: position != null && Number.isFinite(position) ? position : null,
    }
  }
  function submit() {
    if (!form.name.trim()) return
    const nums = readNums()
    if (editId) {
      setT(updatePlayer(t, editId, { name: form.name, club: form.club, ...nums }))
      setEditId(null)
    } else if (t.phase !== 'setup') {
      onError('draw-locked')
      return
    } else {
      setT(addPlayer(t, { name: form.name, club: form.club, ...nums }))
    }
    setForm({ name: '', club: '', points: '', position: '' })
  }
  return (
    <>
      <div className="card">
        <h2>{editId ? tr('edit') : tr('addPlayer')}</h2>
        <div className="grid grid-2">
          <label className="field">{tr('playerName')}<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
          <label className="field">{tr('club')}<input value={form.club} onChange={(e) => setForm({ ...form, club: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
          <label className="field">{tr('points')}<input value={form.points} inputMode="numeric" onChange={(e) => setForm({ ...form, points: e.target.value })} /></label>
          <label className="field">{tr('position')}<input value={form.position} inputMode="numeric" onChange={(e) => setForm({ ...form, position: e.target.value })} /></label>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn" onClick={submit}>{editId ? tr('save') : tr('addPlayer')}</button>
          {editId && <button className="btn secondary" onClick={() => { setEditId(null); setForm({ name: '', club: '', points: '', position: '' }) }}>{tr('cancel')}</button>}
        </div>
      </div>
      <div className="card">
        <h3>{tr('paste')}</h3>
        <p className="muted">{tr('pasteHint')}</p>
        <textarea value={paste} onChange={(e) => setPaste(e.target.value)} />
        <button className="btn" style={{ marginTop: 8 }} onClick={() => {
          if (t.phase !== 'setup') { onError('draw-locked'); return }
          let next = t
          for (const p of parsePlayerLines(paste)) next = addPlayer(next, p)
          setT(next)
          setPaste('')
        }}>{tr('pasteBtn')}</button>
      </div>
      <div className="card">
        <h2>{tr('players')} · {ranked.filter((p) => !p.withdrawn).length}</h2>
        {ranked.length === 0 && <p>{tr('emptyPlayers')}</p>}
        <table className="list">
          <thead>
            <tr><th>#</th><th>{tr('playerName')}</th><th>{tr('club')}</th><th>{tr('points')}</th><th>{tr('position')}</th><th></th></tr>
          </thead>
          <tbody>
            {ranked.map((p, i) => (
              <tr key={p.id} className={p.withdrawn ? 'out' : ''}>
                <td>{i + 1}</td>
                <td className="keep">{p.name}</td>
                <td className="keep">{p.club}</td>
                <td>{p.rankingPoints ?? '—'}</td>
                <td>{p.rankingPosition ?? '—'}</td>
                <td className="keep">
                  <button className="btn secondary small" onClick={() => {
                    setEditId(p.id)
                    setForm({ name: p.name, club: p.club, points: p.rankingPoints?.toString() ?? '', position: p.rankingPosition?.toString() ?? '' })
                  }}>{tr('edit')}</button>{' '}
                  {!p.withdrawn && <button className="btn secondary small" onClick={() => setT(withdrawPlayer(t, p.id))}>{tr('withdraw')}</button>}{' '}
                  <button className="btn danger small" onClick={() => ask({ text: `${p.name}. ${tr('removeConfirm')}`, run: () => act(removePlayer(t, p.id)) })}>{tr('remove')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function byKolejka(matches: Match[]): [number, Match[]][] {
  const out = new Map<number, Match[]>()
  for (const m of matches) {
    const k = m.label.k === 'group' ? m.label.kolejka : m.round + 1
    out.set(k, [...(out.get(k) ?? []), m])
  }
  return [...out].sort((a, b) => a[0] - b[0])
}

function Qualifying({ t, lang, tr, act, go, openScore, quiet = false }: { t: Tournament; lang: Lang; tr: (k: Key) => string; act: DeskAct; go: (h: string) => void; openScore?: (id: string) => void; quiet?: boolean }) {
  const groups = t.groups
  const qual = t.matches.filter((m) => m.stage === 'qualifying')
  const knockout = hasKnockout(t.settings)
  return (
    <>
      <div className="card">
        <h2>{tr(knockout ? 'navQual' : 'navTable')}</h2>
        {describePlan(t, lang)}
        {!quiet && (
          <div className="row" style={{ marginTop: 10 }}>
            {t.phase === 'setup' && qualifyingRequired(t) && <button className="btn" data-testid="generate-qualifying" onClick={() => act(generateQualifying(t))}>{tr(knockout ? 'generateQual' : 'generateSchedule')}</button>}
            {knockout && qualifyingComplete(t) && t.phase !== 'main' && qualifyingRequired(t) && <strong data-testid="qual-done">{tr('nextMain')}</strong>}
            {knockout && qualifyingComplete(t) && t.phase !== 'main' && <button className="btn" data-testid="generate-main" onClick={() => act(generateMainDraw(t))}>{tr('generateMain')}</button>}
            {t.phase === 'main' && <button className="btn secondary" onClick={() => go('#/drabinka')}>{tr('navBracket')}</button>}
          </div>
        )}
      </div>
      {groups.length > 0 && (
        <div className="group-grid">
          {groups.map((g) => {
            const rows = groupStandings(g.playerIds, t.matches.filter((m) => m.groupId === g.id), `${t.drawCode}:${g.id}`)
            return (
              <div className="card" key={g.id}>
                <h3>{tr('group')} {g.name}</h3>
                <table className="list group-table">
                  <thead><tr><th></th><th></th><th>{tr('played')}</th><th>{tr('matchPoints')}</th><th>{tr('setRatio')}</th><th>{tr('ballRatio')}</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const p = findPlayer(t, r.playerId)
                      const advances = knockout && r.place <= t.settings.advancePerGroup && !p?.withdrawn
                      return (
                        <tr key={r.playerId}>
                          <td>{r.place}</td>
                          <td>{pname(p, lang)} {advances && <span className="adv">{tr('advanceMark')}</span>}<span className="muted club-line">{p?.club}</span></td>
                          <td>{r.played}</td>
                          <td>{r.points}</td>
                          <td>{ratioText(r.setsWon, r.setsLost)}</td>
                          <td>{ratioText(r.ballsWon, r.ballsLost)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {byKolejka(t.matches.filter((m) => m.groupId === g.id)).map(([k, list]) => (
                  <div key={k}>
                    <h4 className="kolejka">{tr('kolejka')} {k}</h4>
                    <div className="slip-grid">{list.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} bare />)}</div>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {qual.length > 0 && <BracketColumns t={t} lang={lang} matches={qual} title={tr('qualBracket')} onOpen={quiet ? undefined : openScore} />}
    </>
  )
}

function Bracket({
  t, lang, tr, roundOn, setRoundOn, swapFrom, setSwapFrom, act, ask, openScore,
}: {
  t: Tournament
  lang: Lang
  tr: (k: Key) => string
  roundOn: number
  setRoundOn: (n: number) => void
  swapFrom: number | null
  setSwapFrom: (n: number | null) => void
  act: DeskAct
  ask: (q: { text: string; run: () => void } | null) => void
  openScore: (id: string) => void
}) {
  const main = t.matches.filter((m) => m.stage === 'main')
  const cons = t.matches.filter((m) => m.label.k === 'cons')
  const places = t.matches.filter((m) => m.label.k === 'place' && (m.outcome !== 'pending' || m.slotA != null || m.slotB != null))
  return (
    <>
      <div className="card no-print">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{tr('navBracket')}</h2>
          <span className="muted">{tr('drawCode')}: {t.drawCode}</span>
        </div>
        {t.phase !== 'main' && <button className="btn" data-testid="generate-main" onClick={() => act(generateMainDraw(t))}>{tr('generateMain')}</button>}
        {t.phase === 'main' && (
          <div className="row">
            <button className="btn danger" onClick={() => ask({ text: tr('redoConfirm'), run: () => act(generateMainDraw(t)) })}>{tr('redoMain')}</button>
            <button className={`btn ${swapFrom != null ? '' : 'secondary'}`} onClick={() => setSwapFrom(swapFrom == null ? -1 : null)}>
              {tr('swap')}
            </button>
          </div>
        )}
        {swapFrom != null && <p>{tr('swapHint')} {swapFrom >= 0 ? tr('swapNeed') : ''}</p>}
      </div>
      {main.length === 0 && <div className="card"><p>{tr('bracketEmpty')}</p></div>}
      {(main.length > 0 || places.length > 0) && (
        <div className="sheet-two">
          {places.length > 0 && (
            <div className="consolation">
              <BracketColumns t={t} lang={lang} matches={places} title={tr('placement')} onOpen={openScore} />
            </div>
          )}
          {main.length > 0 && (
            <div className="championship">
              <BracketColumns
                t={t} lang={lang} matches={main} title={tr('main')} roundOn={roundOn} setRoundOn={setRoundOn}
                onOpen={swapFrom == null ? openScore : undefined}
                onSlot={swapFrom == null ? undefined : (index) => {
                  if (swapFrom < 0) setSwapFrom(index)
                  else {
                    act(swapMainSlots(t, swapFrom, index))
                    setSwapFrom(null)
                  }
                }}
                highlight={swapFrom != null && swapFrom >= 0 ? swapFrom : null}
              />
            </div>
          )}
        </div>
      )}
      {cons.length > 0 && <BracketColumns t={t} lang={lang} matches={cons} title={tr('consolation')} onOpen={openScore} />}
      <details className="audit card">
        <summary>{tr('audit')}</summary>
        <ul>
          {t.audit.map((e, i) => <li key={i}><b>{e.code}</b> — {nameAudit(e.detail, t)} <span className="muted">{e.at.slice(11, 19)}</span></li>)}
        </ul>
      </details>
    </>
  )
}

function nameAudit(detail: string, t: Tournament): string {
  return detail.replace(/demo-\d+|p\d+/g, (id) => t.players.find((p) => p.id === id)?.name ?? id)
}

function Matches({
  t, lang, tr, setT, act, openScore, ask,
}: {
  t: Tournament
  lang: Lang
  tr: (k: Key) => string
  setT: (t: Tournament) => void
  act: DeskAct
  onError: (c: string) => void
  openScore: (id: string) => void
  ask: (q: { text: string; run: () => void } | null) => void
}) {
  const ready = readyMatches(t)
  const canDrawMain = hasKnockout(t.settings) && qualifyingComplete(t) && t.phase !== 'main'
  const suggestions = suggestAssignments(t)
  const suggestOf = new Map(suggestions.map((s) => [s.matchId, s.table]))
  const byTable = new Map<number, Match>()
  for (const m of t.matches) if (m.table && m.outcome === 'pending') byTable.set(m.table, m)
  return (
    <>
      {canDrawMain && t.players.filter((p) => !p.withdrawn).length >= 2 && (
        <div className="banner">
          <strong>{qualifyingRequired(t) ? tr('nextMain') : tr('nextMainNow')}</strong>
          <button className="btn" data-testid="generate-main" style={{ marginTop: 8 }} onClick={() => act(generateMainDraw(t))}>{tr('generateMain')}</button>
        </div>
      )}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{tr('tablesTitle')}</h2>
          <button className="btn" onClick={() => setT(applySuggestions(t))}>{tr('assignFree')}</button>
        </div>
        <div className="tables">
          {Array.from({ length: t.settings.tables }, (_, i) => {
            const n = i + 1
            const m = byTable.get(n)
            return (
              <button key={n} className={`table ${m ? 'busy' : 'free'}`} onClick={() => {
                if (m) openScore(m.id)
                else if (ready[0]) act(assignTable(t, ready[0].id, n))
              }}>
                <span className="num">{n}</span>
                {m ? (
                  <>
                    <span className="who">{pname(findPlayer(t, m.slotA), lang)}</span>
                    <span className="who">{pname(findPlayer(t, m.slotB), lang)}</span>
                  </>
                ) : <small>{tr('free')}</small>}
              </button>
            )
          })}
        </div>
      </div>
      <div className="card">
        <h2>{tr('queue')}</h2>
        {ready.length === 0 && <p className="muted">{tr('noQueue')}</p>}
        {ready.map((m) => (
          <div key={m.id} data-testid={`queue-${m.id}`}>
            <Slip t={t} m={m} lang={lang} />
            <div className="row" style={{ margin: '-4px 0 10px' }}>
              <button className="btn small" onClick={() => openScore(m.id)}>{tr('enter')}</button>
              {m.table == null && suggestOf.has(m.id) && (
                <button className="btn secondary small" onClick={() => act(assignTable(t, m.id, suggestOf.get(m.id)!))}>
                  {tr('toTable')} {suggestOf.get(m.id)}
                </button>
              )}
              {m.table != null && <button className="btn secondary small" onClick={() => act(assignTable(t, m.id, null))}>{tr('clearTable')}</button>}
            </div>
          </div>
        ))}
      </div>
      <Finished t={t} lang={lang} tr={tr} openScore={openScore} ask={ask} />
    </>
  )
}

function Finished({ t, lang, tr, openScore, ask }: { t: Tournament; lang: Lang; tr: (k: Key) => string; openScore: (id: string) => void; ask: (q: { text: string; run: () => void } | null) => void }) {
  const done = t.matches.filter((m) => m.outcome === 'score' || m.outcome === 'walkover' || m.outcome === 'retirement' || m.outcome === 'skipped').slice(-12).reverse()
  if (done.length === 0) return null
  return (
    <div className="card">
      <h3>{tr('done')}</h3>
      {done.map((m) => (
        <div key={m.id}>
          <Slip t={t} m={m} lang={lang} />
          <button className="btn secondary small" style={{ marginBottom: 8 }} onClick={() => {
            if (laterResult(t, m.id)) ask({ text: tr('correctWarn'), run: () => openScore(m.id) })
            else openScore(m.id)
          }}>{tr('correct')}</button>
        </div>
      ))}
    </div>
  )
}

function laterResult(t: Tournament, id: string): boolean {
  const seen = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const cur = queue.shift()!
    const m = t.matches.find((x) => x.id === cur)
    if (!m) continue
    for (const link of [m.winnerTo, m.loserTo]) {
      if (!link || seen.has(link.matchId)) continue
      seen.add(link.matchId)
      const n = t.matches.find((x) => x.id === link.matchId)
      if (n && n.outcome !== 'pending' && n.outcome !== 'bye') return true
      queue.push(link.matchId)
    }
  }
  return false
}

function ClassView({ t, tr, setT }: { t: Tournament; tr: (k: Key) => string; setT: (t: Tournament) => void }) {
  const rows = classification(t)
  const cat = t.settings.pointsCategory
  const override = t.settings.pointsOverride[cat] ?? {}
  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{tr('classTitle')}</h2>
          <button className="btn secondary" onClick={() => { window.location.hash = '#/druk/klasyfikacja'; window.setTimeout(() => window.print(), 50) }}>{tr('printClass')}</button>
        </div>
        <label className="field" style={{ maxWidth: 280 }}>{tr('pointsCat')}
          <select value={cat} onChange={(e) => setT(updateSettings(t, { ...t.settings, pointsCategory: e.target.value as PointsCategory }))}>
            {POINT_CATS.map((c) => <option key={c} value={c}>{tr(catKey(c))}</option>)}
          </select>
        </label>
        {rows.length === 0 && <p>{tr('classEmpty')}</p>}
        <table className="list">
          <thead><tr><th scope="col">{tr('place')}</th><th scope="col">{tr('colPlayer')}</th><th scope="col">{tr('colPoints')}</th><th scope="col">{tr('club')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = findPlayer(t, r.playerId)
              const place = placeText(r.ref, tr('notClassified'))
              return (
                <tr key={r.playerId}>
                  <td title={r.ref.kind === 'out' ? tr('notClassifiedLong') : undefined}>{place}</td>
                  <td>{p?.name}</td>
                  <td className="pts">{r.points ?? '—'}</td>
                  <td className="club-cell">{p?.club}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <details className="card">
        <summary>{tr('pointsEdit')}</summary>
        <p className="muted">{tr('pointsNote')}</p>
        <div className="grid grid-3">
          {EDITABLE_POINT_KEYS.map((key) => (
            <label className="field" key={key}>{key}
              <input
                value={override[key] ?? pointsFor(cat, key.includes('-') ? { from: Number(key.split('-')[0]), to: Number(key.split('-')[1]) } : Number(key)) ?? ''}
                onChange={(e) => {
                  const raw = e.target.value.trim()
                  const column = { ...override }
                  if (raw === '' || Number.isNaN(Number(raw))) delete column[key]
                  else column[key] = Number(raw)
                  setT(updateSettings(t, { ...t.settings, pointsOverride: { ...t.settings.pointsOverride, [cat]: column } }))
                }}
              />
            </label>
          ))}
        </div>
        <button className="btn secondary" style={{ marginTop: 8 }} onClick={() => {
          const next = { ...t.settings.pointsOverride }
          delete next[cat]
          setT(updateSettings(t, { ...t.settings, pointsOverride: next }))
        }}>{tr('resetPoints')}</button>
      </details>
    </>
  )
}

function SettingsEdit({ t, tr, setT }: { t: Tournament; tr: (k: Key) => string; setT: (t: Tournament) => void }) {
  return (
    <div className="card">
      <h2>{tr('navSettings')}</h2>
      {t.phase !== 'setup' && <p className="muted">{tr('structuralNote')}</p>}
      <SettingsFields settings={t.settings} tr={tr} onChange={(settings) => setT(updateSettings(t, settings))} />
    </div>
  )
}

export function SettingsFields({ settings, tr, onChange }: { settings: Settings; tr: (k: Key) => string; onChange: (s: Settings) => void }) {
  const set = (patch: Partial<Settings>) => onChange({ ...settings, ...patch })
  const places = (patch: Partial<PlaceFlags>) => set({ places: { ...settings.places, ...patch } })
  const knockout = hasKnockout(settings)
  return (
    <div className="grid grid-2">
      <label className="field">{tr('name')}<input value={settings.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="field">{tr('date')}<input type="date" value={settings.date} onChange={(e) => set({ date: e.target.value })} /></label>
      <label className="field">{tr('venue')}<input value={settings.venue} onChange={(e) => set({ venue: e.target.value })} /></label>
      <label className="field">{tr('category')}
        <select value={settings.category} onChange={(e) => {
          const category = e.target.value as Category
          set({ category, pointsCategory: pointsCategoryFor(category) })
        }}>
          {CATS.map((c) => <option key={c} value={c}>{tr(catKey(c))}</option>)}
        </select>
      </label>
      <label className="field">{tr('tables')}<input type="number" min={1} max={32} value={settings.tables} onChange={(e) => set({ tables: Number(e.target.value) })} /></label>
      <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={settings.autoAssign} onChange={(e) => set({ autoAssign: e.target.checked })} />{tr('autoAssign')}</label>
      <label className="field">{tr('bestOf')}
        <select value={settings.bestOf} onChange={(e) => set({ bestOf: Number(e.target.value) as 3 | 5 })}>
          <option value={5}>{tr('bestOf5')}</option>
          <option value={3}>{tr('bestOf3')}</option>
        </select>
      </label>
      {knockout && settings.bracket !== 'single' && (
        <label className="field">{tr('placeBestOf')}
          <select value={settings.placeMatchBestOf} onChange={(e) => set({ placeMatchBestOf: Number(e.target.value) as 3 | 5 })}>
            <option value={3}>{tr('bestOf3')}</option>
            <option value={5}>{tr('bestOf5')}</option>
          </select>
        </label>
      )}
      <label className="field">{tr('format')}
        <select value={settings.format} onChange={(e) => {
          const format = e.target.value as Format
          set({ format, directSeeds: defaultDirectSeeds({ format, mainDrawSize: settings.mainDrawSize }) })
        }}>
          {FORMATS.map((f) => <option key={f} value={f}>{tr(`format_${f}`)}</option>)}
        </select>
      </label>
      {knockout && (
        <>
          <label className="field">{tr('bracket')}
            <select value={settings.bracket} onChange={(e) => set({ bracket: e.target.value as Bracket })}>
              {BRACKETS.map((b) => <option key={b} value={b}>{tr(`bracket_${b}`)}</option>)}
            </select>
          </label>
          <label className="field">{tr('drawSize')}
            <select value={settings.mainDrawSize} onChange={(e) => {
              const mainDrawSize = Number(e.target.value) as DrawSize
              set({ mainDrawSize, directSeeds: settings.format === 'knockout' ? mainDrawSize / 2 : settings.directSeeds })
            }}>
              {DRAW_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">{tr('directSeeds')}<input type="number" min={0} max={64} value={settings.directSeeds} onChange={(e) => set({ directSeeds: Number(e.target.value) })} /></label>
          <label className="field">{tr('seeding')}
            <select value={settings.seeding} onChange={(e) => set({ seeding: e.target.value as Settings['seeding'] })}>
              <option value="fixed">{tr('seedingFixed')}</option>
              <option value="bands">{tr('seedingBands')}</option>
            </select>
          </label>
        </>
      )}
      {settings.format === 'groups' && (
        <>
          <label className="field">{tr('groupSize')}
            <select value={settings.groupSize} onChange={(e) => set({ groupSize: Number(e.target.value) as 3 | 4 | 5 })}>
              <option value={4}>4</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
            </select>
          </label>
          <label className="field">{tr('advance')}<input type="number" min={1} max={3} value={settings.advancePerGroup} onChange={(e) => set({ advancePerGroup: Number(e.target.value) })} /></label>
        </>
      )}
      {knockout && settings.bracket === 'placement' && (
        <div>
          <div className="muted">{tr('places')}</div>
          <label className="check"><input type="checkbox" checked={settings.places.third} onChange={(e) => places({ third: e.target.checked })} />{tr('place3')}</label>
          <label className="check"><input type="checkbox" checked={settings.places.fiveToEight} onChange={(e) => places({ fiveToEight: e.target.checked })} />{tr('place58')}</label>
          <label className="check"><input type="checkbox" checked={settings.places.nineToSixteen} onChange={(e) => places({ nineToSixteen: e.target.checked })} />{tr('place916')}</label>
          <label className="check"><input type="checkbox" checked={settings.places.seventeenToThirtyTwo} onChange={(e) => places({ seventeenToThirtyTwo: e.target.checked })} />{tr('place1732')}</label>
          <label className="check"><input type="checkbox" checked={settings.places.nonQualifiers} onChange={(e) => places({ nonQualifiers: e.target.checked })} />{tr('placeNq')}</label>
          <p className="muted">{tr('placesHint')}</p>
        </div>
      )}
    </div>
  )
}

function Slip({ t, m, lang, onOpen, onPick, picked, bare }: { t: Tournament; m: Match; lang: Lang; onOpen?: () => void; onPick?: (slot: 'A' | 'B') => void; picked?: 'A' | 'B' | null; bare?: boolean }) {
  const cls = m.outcome === 'pending' && m.table ? 'live' : m.outcome === 'pending' && m.slotA && m.slotB ? 'ready' : m.outcome === 'pending' ? 'pending' : 'done'
  const count = m.outcome === 'score' || m.outcome === 'retirement' ? setCount(m) : null
  const wonA = count?.a
  const wonB = count?.b
  const hasSets = m.sets.length > 0
  const hideRound = bare && m.label.k !== 'place'
  const title = hideRound ? '' : matchTitle(m, lang)
  const table = m.table != null ? `${translate(lang, 'suggest')} ${m.table}` : ''
  const status = m.outcome === 'bye'
    ? translate(lang, 'bye')
    : m.outcome === 'walkover'
      ? translate(lang, 'status_walkover')
      : m.outcome === 'retirement'
        ? translate(lang, 'status_retirement')
        : m.outcome === 'skipped'
          ? translate(lang, 'status_skipped')
          : ''
  const meta = [title, table, m.outcome === 'retirement' || !count ? status : ''].filter(Boolean).join(' · ')
  const playable = !!onOpen && !!m.slotA && !!m.slotB && m.outcome !== 'bye' && m.outcome !== 'cancelled'
  const winA = m.winnerId != null && m.winnerId === m.slotA
  const winB = m.winnerId != null && m.winnerId === m.slotB
  return (
    <div
      className={`slip ${cls} ${playable ? 'click' : ''}`}
      onClick={playable ? onOpen : undefined}
      onKeyDown={playable ? (e) => { if (e.key === 'Enter') onOpen?.() } : undefined}
      role={playable ? 'button' : undefined}
      tabIndex={playable ? 0 : undefined}
    >
      {meta && <div className="meta"><span>{meta}</span></div>}
      <Side t={t} id={m.slotA} win={winA} lose={m.winnerId != null && !winA && !!m.slotA} lang={lang} seed={m.slotA ? t.mainSeeds[m.slotA] : undefined} bye={!m.slotA && !m.waitA} marked={picked === 'A'} games={count ? wonA : undefined} onPick={onPick ? () => onPick('A') : undefined} />
      <Side t={t} id={m.slotB} win={winB} lose={m.winnerId != null && !winB && !!m.slotB} lang={lang} seed={m.slotB ? t.mainSeeds[m.slotB] : undefined} bye={!m.slotB && !m.waitB} marked={picked === 'B'} games={count ? wonB : undefined} onPick={onPick ? () => onPick('B') : undefined} />
      {hasSets && (
        <div className="set-chips">
          {m.sets.map((s, i) => (
            <span key={i} className={`set-chip ${s.a > s.b ? 'up' : 'down'}`}>{s.a}:{s.b}</span>
          ))}
        </div>
      )}
      {!hasSets && count && <div className="set-count">{count.a}:{count.b}</div>}
    </div>
  )
}

function Side({ t, id, win, lose, lang, seed, bye, onPick, marked, games }: { t: Tournament; id: string | null; win: boolean; lose: boolean; lang: Lang; seed?: number; bye: boolean; onPick?: () => void; marked?: boolean; games?: number }) {
  const p = findPlayer(t, id)
  return (
    <div className={`side ${win ? 'win' : ''} ${lose ? 'lose' : ''} ${onPick ? 'pick' : ''} ${marked ? 'marked' : ''}`} onClick={onPick ? (e) => { e.stopPropagation(); onPick() } : undefined}>
      {seed != null && <span className="seed">{seed}</span>}
      <span className="nm">{bye ? translate(lang, 'bye') : pname(p, lang)}</span>
      {p?.club && <span className="club">{p.club}</span>}
      {games != null && <span className="games">{games}</span>}
    </div>
  )
}

function columnHeading(matches: Match[], lang: Lang): string {
  const sample = matches[0]
  if (!sample) return ''
  if (sample.label.k === 'place') return placeColumnTitle(matches, lang)
  return roundHeading(sample, lang)
}

function BracketColumns({
  t, lang, matches, title, roundOn, setRoundOn, onSlot, highlight, onOpen,
}: {
  t: Tournament
  lang: Lang
  matches: Match[]
  title: string
  roundOn?: number
  setRoundOn?: (n: number) => void
  onSlot?: (index: number) => void
  highlight?: number | null
  onOpen?: (id: string) => void
}) {
  const [ownRound, setOwnRound] = useState(0)
  const on = roundOn ?? ownRound
  const setOn = setRoundOn ?? setOwnRound
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b)
  const multi = rounds.length > 1
  return (
    <div className="card">
      <h2>{title}</h2>
      {multi && (
        <div className="rounds-switch">
          {rounds.map((r) => {
            const inRound = matches.filter((m) => m.round === r)
            return (
              <button key={r} className={r === on ? 'on' : ''} onClick={() => setOn(r)}>{columnHeading(inRound, lang)}</button>
            )
          })}
        </div>
      )}
      <div className="bracket">
        {rounds.map((r) => {
          const inRound = matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index)
          return (
            <div className={`round ${r === on ? 'on' : ''}`} key={r}>
              {multi && <h3>{columnHeading(inRound, lang)}</h3>}
              {inRound.map((m) => (
                <Slip
                  key={m.id}
                  bare={multi}
                  t={t}
                  m={m}
                  lang={lang}
                  onOpen={onOpen && m.outcome !== 'bye' ? () => onOpen(m.id) : undefined}
                  onPick={onSlot && m.round === 0 ? (slot) => onSlot(m.index * 2 + (slot === 'A' ? 0 : 1)) : undefined}
                  picked={highlight != null && m.round === 0 ? (highlight === m.index * 2 ? 'A' : highlight === m.index * 2 + 1 ? 'B' : null) : null}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function PublicView({ t, lang, board = false }: { t: Tournament; lang: Lang; board?: boolean }) {
  const tr = (k: Key) => translate(lang, k)
  const official = t.finalClassification && t.finalClassification.length > 0 ? t.finalClassification : null
  const open = official
    ? t.matches.filter((m) => !(m.stage === 'placement' && m.outcome === 'pending'))
    : t.matches
  const finished = { ...t, matches: open }
  const live = open.filter((m) => m.outcome === 'pending' && m.table != null).sort((a, b) => (a.table ?? 0) - (b.table ?? 0))
  const next = readyMatches(finished).filter((m) => m.table == null).slice(0, 8)
  const rows = classification(t)
  const cons = t.matches.filter((m) => m.label.k === 'cons')
  const places = t.matches.filter((m) => m.label.k === 'place' && (m.slotA != null || m.slotB != null))
  const tableFirst = !hasKnockout(t.settings) || t.phase !== 'main'
  const groupTables = <Qualifying quiet t={t} lang={lang} tr={tr} act={() => undefined} go={() => undefined} />
  const [roundOn, setRoundOn] = useState(0)
  const [query, setQuery] = useState('')
  const q = query.trim().toLocaleLowerCase('pl')
  const hits = q.length < 2 ? [] : t.players.filter((p) => p.name.toLocaleLowerCase('pl').includes(q)).slice(0, 6)
  return (
    <>
      <p className="back-link"><a href="#/">{tr('back')}</a></p>
      <div className="card">
        <h2>{tr('nowPlaying')}</h2>
        {live.length === 0 && <p className="muted">{tr('noLive')}</p>}
        {live.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
      </div>
      <div className="card">
        <label className="field">{tr('findPlayer')}
          <input value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        </label>
        {q.length >= 2 && hits.length === 0 && <p className="muted">{tr('findEmpty')}</p>}
        {hits.map((p) => {
          const current = live.find((m) => m.slotA === p.id || m.slotB === p.id)
          const upcoming = next.find((m) => m.slotA === p.id || m.slotB === p.id)
            ?? readyMatches(finished).find((m) => m.table == null && (m.slotA === p.id || m.slotB === p.id))
          const row = rows.find((r) => r.playerId === p.id)
          const officialRow = officialRowOf(t, p.name)
          const active = current ?? upcoming
          const foe = active ? pname(findPlayer(t, active.slotA === p.id ? active.slotB : active.slotA), lang) : ''
          const waiting = !current && !upcoming && !officialRow && (!row || row.ref.kind === 'pending')
          return (
            <div key={p.id} className="hit">
              <strong>{p.name}</strong>
              <div className="muted">{p.club}</div>
              {current && <div>{matchLine(tr, lang, 'playingNow', current, foe)}</div>}
              {!current && upcoming && <div>{matchLine(tr, lang, 'playingNext', upcoming, foe)}</div>}
              {!current && !upcoming && officialRow && (
                <div>{officialRow.place.includes('-') ? `${tr('placesWord')} ${officialLabel(officialRow.place)}` : `${tr('place')} ${officialRow.place}`}{` · ${officialRow.points} ${tr('pointsShort')}`}</div>
              )}
              {!current && !upcoming && !officialRow && row && row.ref.kind !== 'pending' && (
                <div>{finishedLine(tr, row)}</div>
              )}
              {waiting && <div className="muted">{tr('inProgress')}</div>}
            </div>
          )
        })}
      </div>
      {next.length > 0 && (
        <div className="card">
          <h2>{tr('upNext')}</h2>
          {next.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
        </div>
      )}
      {tableFirst && groupTables}
      <div className="card">
        <h2>{official ? tr('classOfficial') : tr('classTitle')}</h2>
        <table className="list">
          <thead><tr><th scope="col">{tr('place')}</th><th scope="col">{tr('colPlayer')}</th><th scope="col">{tr('colPoints')}</th><th scope="col">{tr('club')}</th></tr></thead>
          <tbody>
            {official ? official.map((r, i) => {
              const hit = findPlayerByName(t.players, r.name)
              const p = hit.ok ? hit.player : undefined
              return (
                <tr key={`${r.place}-${r.name}-${i}`}>
                  <td>{officialLabel(r.place)}</td>
                  <td>{p?.name ?? r.name}</td>
                  <td className="pts">{r.points}</td>
                  <td className="club-cell">{p?.club ?? ''}</td>
                </tr>
              )
            }) : rows.slice(0, 32).map((r) => {
              const p = findPlayer(t, r.playerId)
              const place = placeText(r.ref, tr('notClassified'))
              return (
                <tr key={r.playerId}>
                  <td>{place}</td>
                  <td>{p?.name}</td>
                  <td className="pts">{r.points ?? '—'}</td>
                  <td className="club-cell">{p?.club}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {board && <RecentResults t={t} lang={lang} tr={tr} />}
      {t.matches.some((m) => m.stage === 'main') && (
        <BracketColumns t={t} lang={lang} matches={t.matches.filter((m) => m.stage === 'main')} title={tr('main')} roundOn={roundOn} setRoundOn={setRoundOn} />
      )}
      {cons.length > 0 && <BracketColumns t={t} lang={lang} matches={cons} title={tr('consolation')} />}
      {cons.length > 0 && places.length > 0 && <BracketColumns t={t} lang={lang} matches={places} title={tr('placement')} />}
      {board && !t.matches.some((m) => m.stage === 'main') && t.matches.some((m) => m.stage === 'qualifying') && (
        <BracketColumns t={t} lang={lang} matches={t.matches.filter((m) => m.stage === 'qualifying')} title={tr('qualBracket')} roundOn={roundOn} setRoundOn={setRoundOn} />
      )}
      {!tableFirst && t.groups.length > 0 && groupTables}
    </>
  )
}

function PrintView({ t, lang, kind }: { t: Tournament; lang: Lang; kind: string }) {
  const tr = (k: Key) => translate(lang, k)
  if (kind.startsWith('klasyfikacja')) {
    const rows = classification(t)
    return (
      <div className="card">
        <h2>{t.settings.name}</h2>
        <p>{t.settings.date} · {t.settings.venue}</p>
        <h3>{tr('classTitle')}</h3>
        <table className="list">
          <thead><tr><th scope="col">{tr('place')}</th><th scope="col">{tr('colPlayer')}</th><th scope="col">{tr('colPoints')}</th><th scope="col">{tr('club')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = findPlayer(t, r.playerId)
              const place = placeText(r.ref, tr('notClassified'))
              return <tr key={r.playerId}><td>{place}</td><td>{p?.name}</td><td className="pts">{r.points ?? ''}</td><td>{p?.club}</td></tr>
            })}
          </tbody>
        </table>
        <button className="btn no-print" onClick={() => window.print()}>{tr('print')}</button>
      </div>
    )
  }
  if (kind.startsWith('kartki')) {
    const sheets = t.matches.filter((m) => m.outcome !== 'bye' && m.outcome !== 'cancelled' && m.slotA && m.slotB)
    return (
      <div>
        <button className="btn no-print" onClick={() => window.print()}>{tr('print')}</button>
        {sheets.map((m) => (
          <div className="sheet" key={m.id}>
            <strong>{t.settings.name}</strong>
            <div>{matchTitle(m, lang)}{m.table ? ` · ${tr('suggest')} ${m.table}` : ''}</div>
            <div>{pname(findPlayer(t, m.slotA), lang)} ({findPlayer(t, m.slotA)?.club})</div>
            <div>{pname(findPlayer(t, m.slotB), lang)} ({findPlayer(t, m.slotB)?.club})</div>
            <div className="lines">{[1, 2, 3, 4, 5].slice(0, m.bestOf).map((n) => <span key={n}>{n}</span>)}</div>
            <div style={{ marginTop: 16 }}>{tr('sheetSign')}: ______________</div>
          </div>
        ))}
      </div>
    )
  }
  return (
    <div>
      <button className="btn no-print" onClick={() => window.print()}>{tr('print')}</button>
      <h2>{t.settings.name}</h2>
      <BracketColumns t={t} lang={lang} matches={t.matches.filter((m) => m.stage === 'main' || m.stage === 'qualifying')} title={tr('navBracket')} />
    </div>
  )
}

type DeskAct = (r: { ok: true; tournament: Tournament } | { ok: false; error: string }) => void

function download(t: Tournament) {
  const blob = new Blob([JSON.stringify(t, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  const slug = t.settings.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || 'turniej'
  a.download = `${slug}.json`
  a.click()
  URL.revokeObjectURL(a.href)
}

export function Welcome({
  tr, onCreate, onDemo, onImport, onOpenPublished,
}: {
  tr: (k: Key) => string
  onCreate: () => void
  onDemo: () => void
  onImport: (file: File) => void
  onOpenPublished: (slug: string) => void
}) {
  return (
    <div className="hero">
      <div className="card hero-copy">
        <p className="kicker">WZTS · KWGPP</p>
        <h2>{tr('welcomeTitle')}</h2>
        <p className="lead">{tr('welcomeLead')}</p>
        <ol className="steps">
          <li><b>1</b>{tr('stepList')}</li>
          <li><b>2</b>{tr('stepDraw')}</li>
          <li><b>3</b>{tr('stepScore')}</li>
        </ol>
        <p className="muted">{tr('stepNote')}</p>
        <div className="row">
          <button className="btn" onClick={onCreate}>{tr('newTournament')}</button>
          <button className="btn secondary" data-testid="demo-button" onClick={onDemo}>{tr('demo')}</button>
          <label className="btn secondary">
            {tr('import')}
            <input type="file" accept="application/json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f) }} />
          </label>
        </div>
        <p className="muted">{tr('demoHint')}</p>
        <OpenPublished tr={tr} onOpen={onOpenPublished} />
      </div>
      <aside className="sample">
        <p className="kicker">{tr('sample')}</p>
        <div className="sample-board">
          <article className="sample-card semi-a">
            <div className="sample-side win"><span>Kowalski</span><b>3</b></div>
            <div className="sample-side"><span>Nowak</span><b>1</b></div>
            <div className="sample-sets"><i>11:8</i><i className="down">9:11</i><i>11:6</i><i>11:7</i></div>
          </article>
          <div className="join" aria-hidden="true" />
          <article className="sample-card final">
            <div className="sample-side win"><span>Kowalski</span><b>3</b></div>
            <div className="sample-side"><span>Zieliński</span><b>1</b></div>
            <div className="sample-sets"><i>11:7</i><i className="down">6:11</i><i>12:10</i><i>11:8</i></div>
          </article>
          <article className="sample-card semi-b">
            <div className="sample-side win"><span>Zieliński</span><b>3</b></div>
            <div className="sample-side"><span>Wójcik</span><b>0</b></div>
            <div className="sample-sets"><i>11:5</i><i>11:9</i><i>11:7</i></div>
          </article>
        </div>
      </aside>
    </div>
  )
}

function OpenPublished({ tr, onOpen }: { tr: (k: Key) => string; onOpen: (slug: string) => void }) {
  const [slug, setSlug] = useState('demo')
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const name = slug.trim().toLowerCase()
        if (name) onOpen(name)
      }}
    >
      <h3 style={{ marginTop: 16 }}>{tr('openPublished')}</h3>
      <p className="muted">{tr('openPublishedHint')}</p>
      <div className="row">
        <label className="field" style={{ maxWidth: 220, margin: 0 }}>
          {tr('openSlug')}
          <input value={slug} data-testid="open-slug" onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </label>
        <button className="btn secondary" type="submit" data-testid="open-published">{tr('openBtn')}</button>
      </div>
    </form>
  )
}

function PublishBox({
  t, tr, publishedSlug, onOpen,
}: {
  t: Tournament
  tr: (k: Key) => string
  publishedSlug: string | null
  onOpen: (slug: string) => void
}) {
  const [slug, setSlug] = useState(publishedSlug || slugify(t.settings.name))
  const [copied, setCopied] = useState(false)
  const safe = isLiveSlug(slug) ? slug : slugify(slug)
  const link = `${window.location.origin}${window.location.pathname}${window.location.search}#/live/${safe}`
  return (
    <div style={{ marginTop: 14 }}>
      <h3>{tr('liveLink')}</h3>
      <div className="row">
        <label className="field" style={{ maxWidth: 260, margin: 0 }}>
          {tr('openSlug')}
          <input value={slug} data-testid="live-slug" onChange={(e) => setSlug(e.target.value.toLowerCase())} />
        </label>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            const node = document.querySelector<HTMLInputElement>('[data-testid="live-link"]')
            node?.focus()
            node?.select()
            navigator.clipboard?.writeText(link).then(() => {
              setCopied(true)
              window.setTimeout(() => setCopied(false), 2000)
            }).catch(() => setCopied(false))
          }}
        >{tr('copyLive')}</button>
        {copied && <span className="muted">{tr('copied')}</span>}
      </div>
      <input className="live-url" data-testid="live-link" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      <OpenPublished tr={tr} onOpen={onOpen} />
    </div>
  )
}

function RecentResults({ t, lang, tr }: { t: Tournament; lang: Lang; tr: (k: Key) => string }) {
  const rows = t.matches
    .filter((m) => m.outcome === 'score' || m.outcome === 'walkover' || m.outcome === 'retirement')
    .sort((a, b) => {
      const stage = (m: Match) => (m.stage === 'main' ? 0 : m.stage === 'placement' ? 1 : 2)
      return stage(a) - stage(b) || b.round - a.round || a.index - b.index
    })
    .slice(0, 12)
  if (rows.length === 0) return null
  return (
    <div className="card">
      <h2>{tr('liveResults')}</h2>
      {rows.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
    </div>
  )
}

function clock(d: Date, lang: Lang): string {
  return d.toLocaleTimeString(lang === 'pl' ? 'pl-PL' : 'en-GB', { hour: '2-digit', minute: '2-digit' })
}

export function LivePage({ lang, slug }: { lang: Lang; slug: string }) {
  const tr = (k: Key) => translate(lang, k)
  const [t, setT] = useState<Tournament | null>(null)
  const [error, setError] = useState<'missing' | 'bad' | null>(null)
  const [updated, setUpdated] = useState<Date | null>(null)
  const seen = useRef(false)
  useEffect(() => {
    let stop = false
    seen.current = false
    const pull = () => {
      fetchLive(slug).then((res) => {
        if (stop) return
        if (res.ok) {
          seen.current = true
          setT(res.tournament)
          setUpdated(new Date())
          setError(null)
        } else if (!seen.current) setError(res.error)
      })
    }
    pull()
    const id = window.setInterval(pull, 30_000)
    return () => {
      stop = true
      window.clearInterval(id)
    }
  }, [slug])
  if (!t) {
    return (
      <div className="card" data-testid="live-board">
        <p>{error === 'bad' ? tr('liveBad') : error === 'missing' ? tr('liveMissing') : tr('liveLoading')}</p>
      </div>
    )
  }
  const fromFile = t.updatedAt ? new Date(t.updatedAt) : null
  const when = fromFile && !Number.isNaN(fromFile.getTime()) ? fromFile : updated
  return (
    <div data-testid="live-board">
      <div className="live-bar">
        <h2>{t.settings.name || tr('liveTitle')}</h2>
        {when && <p className="when" data-testid="live-updated">{tr('liveUpdated')} {clock(when, lang)}</p>}
      </div>
      <PublicView t={t} lang={lang} board />
    </div>
  )
}
