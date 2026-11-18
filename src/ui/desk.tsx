import { useMemo, useState } from 'react'
import type { Lang } from '../i18n.ts'
import { translate, type Key } from '../i18n.ts'
import { classification, countFinished } from '../logic/classify.ts'
import {
  addPlayer,
  applySuggestions,
  assignTable,
  enterRetirement,
  enterScore,
  enterWalkover,
  generateMainDraw,
  generateQualifying,
  qualifyingComplete,
  qualifyingRequired,
  readyMatches,
  removePlayer,
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
import { compareRanking } from '../logic/ranking.ts'
import type { Category, Match, PlaceFlags, PointsCategory, Settings, Tournament } from '../logic/types.ts'
import { parsePlayerLines } from '../demo.ts'
import { catKey, findPlayer, matchTitle, pname, ratioText, roundHeading } from './format.ts'
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

export function Desk({
  tournament: t,
  lang,
  route,
  go,
  setT,
  onError,
  onReplace,
}: {
  tournament: Tournament
  lang: Lang
  route: string
  go: (hash: string) => void
  setT: (t: Tournament) => void
  onError: (code: string) => void
  onReplace: () => void
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
          editId={editId} setEditId={setEditId} setT={setT} onError={onError} act={act}
        />
      )}
      {route === '#/eliminacje' && <Qualifying t={t} lang={lang} tr={tr} act={act} go={go} />}
      {route === '#/drabinka' && (
        <Bracket
          t={t} lang={lang} tr={tr} roundOn={roundOn} setRoundOn={setRoundOn}
          swapFrom={swapFrom} setSwapFrom={setSwapFrom} act={act} onError={onError} setT={setT}
        />
      )}
      {route === '#/mecze' && (
        <Matches t={t} lang={lang} tr={tr} setT={setT} act={act} onError={onError} openScore={setScoreId} ask={setAsk} />
      )}
      {route === '#/klasyfikacja' && <ClassView t={t} tr={tr} setT={setT} />}
      {route === '#/ustawienia' && <SettingsEdit t={t} tr={tr} setT={setT} />}
      {(route === '#/' || route === '') && <Home t={t} lang={lang} tr={tr} go={go} setT={setT} act={act} onReplace={onReplace} ask={setAsk} />}
      {scoreMatch && (
        <ScoreDialog
          tournament={t}
          match={scoreMatch}
          lang={lang}
          onClose={() => setScoreId(null)}
          onScore={(sets) => {
            act(enterScore(t, scoreMatch.id, sets))
            setScoreId(null)
          }}
          onWalkover={(id) => {
            act(enterWalkover(t, scoreMatch.id, id))
            setScoreId(null)
          }}
          onRetire={(id, sets) => {
            act(enterRetirement(t, scoreMatch.id, id, sets))
            setScoreId(null)
          }}
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
  t, lang, tr, go, setT, act, onReplace, ask,
}: {
  t: Tournament
  lang: Lang
  tr: (k: Key) => string
  go: (h: string) => void
  setT: (t: Tournament) => void
  act: (r: { ok: true; tournament: Tournament } | { ok: false; error: string }) => void
  onReplace: () => void
  ask: (q: { text: string; run: () => void } | null) => void
}) {
  const active = t.players.filter((p) => !p.withdrawn)
  const prog = countFinished(t)
  const final = t.matches.find((m) => m.stage === 'main' && m.placeWin === 1 && m.winnerId && m.outcome !== 'pending' && m.outcome !== 'bye' && m.outcome !== 'cancelled')
  const step = nextStep(t, lang)
  const plan = useMemo(() => describePlan(t, lang), [t, lang])
  const live = t.matches.filter((m) => m.outcome === 'pending' && m.table != null)
  return (
    <>
      <div className="banner">
        <strong>{step.title}</strong>
        <p className="muted">
          {t.settings.qualifyingMode === 'groups' ? tr('modeGroups') : tr('modeKo')}
          {' · '}<span className="keep">{tr('directSeeds')} {t.settings.directSeeds}</span>
          {' · '}<span className="keep">{tr('drawSize')} {t.settings.mainDrawSize}</span>
          {' · '}<span className="keep">{t.settings.bestOf === 5 ? tr('bestOf5') : tr('bestOf3')}</span>
          {' · '}<span className="keep">{tr('placeBestOf')}: {t.settings.placeMatchBestOf === 3 ? tr('bestOf3') : tr('bestOf5')}</span>
        </p>
        <div className="row" style={{ marginTop: 8 }}>
          {step.kind === 'qual' && <button className="btn" data-testid="generate-qualifying" onClick={() => act(generateQualifying(t))}>{tr('generateQual')}</button>}
          {step.kind === 'main' && <button className="btn" data-testid="generate-main" onClick={() => act(generateMainDraw(t))}>{tr('generateMain')}</button>}
          {step.kind === 'play' && <button className="btn" onClick={() => go('#/mecze')}>{tr('navMatches')}</button>}
          {step.kind === 'players' && <button className="btn" onClick={() => go('#/zawodnicy')}>{tr('navPlayers')}</button>}
          {step.kind === 'done' && <button className="btn" onClick={() => go('#/klasyfikacja')}>{tr('navClass')}</button>}
        </div>
      </div>
      <div className="stats">
        <div className="stat"><b>{active.length}</b><span>{tr('players')}</span></div>
        <div className="stat"><b>{t.settings.tables}</b><span>{tr('tables')}</span></div>
        <div className="stat"><b>{prog.done}/{prog.total}</b><span>{tr('progress')}</span></div>
        <div className="stat"><b>{final ? pname(findPlayer(t, final.winnerId), lang) : '—'}</b><span>{tr('champion')}</span></div>
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
          <button className="btn secondary" onClick={() => go('#/druk/drabinka')}>{tr('printBracket')}</button>
          <button className="btn secondary" onClick={() => ask({ text: tr('undoConfirm'), run: () => setT(undoAll(t)) })}>{tr('undo')}</button>
          <button className="btn secondary" onClick={onReplace}>{tr('newTournament')}</button>
        </div>
        <p className="muted">{tr('drawCode')}: <b>{t.drawCode}</b>. {tr('drawCodeHint')}</p>
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
  if (s.qualifyingMode === 'knockout' && n <= s.mainDrawSize) {
    const preview = previewQualifying(n, s.mainDrawSize, s.directSeeds, 'knockout')
    return <p>{tr('planNone')} {tr('planMainByes')}: <b>{preview.byesInMain}</b>.</p>
  }
  if (s.qualifyingMode === 'groups') {
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
            {tr('roundLine')} {r.index + 1}: {r.matches} {tr('matchesWord')}
            {r.byeMatches ? `, ${r.byeMatches} ${tr('byesWord')}` : ''}. {tr('remain')} {r.advancers}.
          </li>
        ))}
      </ul>
    </>
  )
}

function Players({
  t, tr, form, setForm, paste, setPaste, editId, setEditId, setT, onError, act,
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
                  <button className="btn secondary small" onClick={() => act(removePlayer(t, p.id))}>{tr('remove')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function Qualifying({ t, lang, tr, act, go, quiet = false }: { t: Tournament; lang: Lang; tr: (k: Key) => string; act: DeskAct; go: (h: string) => void; quiet?: boolean }) {
  const groups = t.groups
  const qual = t.matches.filter((m) => m.stage === 'qualifying')
  return (
    <>
      <div className="card">
        <h2>{tr('navQual')}</h2>
        {describePlan(t, lang)}
        {!quiet && (
          <div className="row" style={{ marginTop: 10 }}>
            {t.phase === 'setup' && qualifyingRequired(t) && <button className="btn" data-testid="generate-qualifying" onClick={() => act(generateQualifying(t))}>{tr('generateQual')}</button>}
            {qualifyingComplete(t) && t.phase !== 'main' && <button className="btn" data-testid="generate-main" onClick={() => act(generateMainDraw(t))}>{tr('generateMain')}</button>}
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
                <table className="list">
                  <thead><tr><th></th><th></th><th>{tr('played')}</th><th>Pkt</th><th>{tr('setRatio')}</th><th>{tr('ballRatio')}</th></tr></thead>
                  <tbody>
                    {rows.map((r) => {
                      const p = findPlayer(t, r.playerId)
                      const advances = r.place <= t.settings.advancePerGroup && !p?.withdrawn
                      return (
                        <tr key={r.playerId}>
                          <td>{r.place}</td>
                          <td>{pname(p, lang)} <span className="muted">{p?.club}</span> {advances && <span className="adv">{tr('advanceMark')}</span>}</td>
                          <td>{r.played}</td>
                          <td>{r.points}</td>
                          <td>{ratioText(r.setsWon, r.setsLost)}</td>
                          <td>{ratioText(r.ballsWon, r.ballsLost)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
                {t.matches.filter((m) => m.groupId === g.id).map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
              </div>
            )
          })}
        </div>
      )}
      {qual.length > 0 && <BracketColumns t={t} lang={lang} matches={qual} title={tr('qualBracket')} />}
    </>
  )
}

function Bracket({
  t, lang, tr, roundOn, setRoundOn, swapFrom, setSwapFrom, act,
}: {
  t: Tournament
  lang: Lang
  tr: (k: Key) => string
  roundOn: number
  setRoundOn: (n: number) => void
  swapFrom: number | null
  setSwapFrom: (n: number | null) => void
  act: DeskAct
  onError: (c: string) => void
  setT: (t: Tournament) => void
}) {
  const main = t.matches.filter((m) => m.stage === 'main')
  const places = t.matches.filter((m) => m.stage === 'placement' && (m.outcome !== 'pending' || m.slotA != null || m.slotB != null))
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
            <button className="btn secondary" onClick={() => act(generateMainDraw(t))}>{tr('redoMain')}</button>
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
              <BracketColumns t={t} lang={lang} matches={places} title={tr('placement')} />
            </div>
          )}
          {main.length > 0 && (
            <div className="championship">
              <BracketColumns
                t={t} lang={lang} matches={main} title={tr('main')} roundOn={roundOn} setRoundOn={setRoundOn}
                onSlot={(index) => {
                  if (swapFrom == null) return
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
  const canDrawMain = qualifyingComplete(t) && t.phase !== 'main'
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
              {m.table == null && (
                <button className="btn secondary small" onClick={() => act(assignTable(t, m.id, suggestOf.get(m.id) ?? null))}>
                  {tr('suggest')} {suggestOf.get(m.id) ?? '—'}
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
  const done = t.matches.filter((m) => m.outcome === 'score' || m.outcome === 'walkover' || m.outcome === 'retirement').slice(-12).reverse()
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
          <thead><tr><th>{tr('place')}</th><th>{tr('playerName')}</th><th>{tr('club')}</th><th>{tr('kwgpp')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = findPlayer(t, r.playerId)
              const place = placeText(r.ref, tr('notClassified'))
              return (
                <tr key={r.playerId}>
                  <td title={r.ref.kind === 'out' ? tr('notClassifiedLong') : undefined}>{place}</td>
                  <td>{p?.name}</td>
                  <td>{p?.club}</td>
                  <td>{r.points ?? '—'}</td>
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
      <label className="field">{tr('bestOf')}
        <select value={settings.bestOf} onChange={(e) => set({ bestOf: Number(e.target.value) as 3 | 5 })}>
          <option value={5}>{tr('bestOf5')}</option>
          <option value={3}>{tr('bestOf3')}</option>
        </select>
      </label>
      <label className="field">{tr('placeBestOf')}
        <select value={settings.placeMatchBestOf} onChange={(e) => set({ placeMatchBestOf: Number(e.target.value) as 3 | 5 })}>
          <option value={3}>{tr('bestOf3')}</option>
          <option value={5}>{tr('bestOf5')}</option>
        </select>
      </label>
      <label className="field">{tr('drawSize')}
        <select value={settings.mainDrawSize} onChange={(e) => set({ mainDrawSize: Number(e.target.value) as 16 | 32 | 64 })}>
          <option value={16}>16</option>
          <option value={32}>32</option>
          <option value={64}>64</option>
        </select>
      </label>
      <label className="field">{tr('directSeeds')}<input type="number" min={0} max={64} value={settings.directSeeds} onChange={(e) => set({ directSeeds: Number(e.target.value) })} /></label>
      <label className="field">{tr('seeding')}
        <select value={settings.seeding} onChange={(e) => set({ seeding: e.target.value as Settings['seeding'] })}>
          <option value="fixed">{tr('seedingFixed')}</option>
          <option value="bands">{tr('seedingBands')}</option>
        </select>
      </label>
      <label className="field">{tr('mode')}
        <select value={settings.qualifyingMode} onChange={(e) => set({ qualifyingMode: e.target.value as Settings['qualifyingMode'], directSeeds: e.target.value === 'groups' ? 0 : settings.directSeeds || 16 })}>
          <option value="knockout">{tr('modeKo')}</option>
          <option value="groups">{tr('modeGroups')}</option>
        </select>
      </label>
      <label className="field">{tr('groupSize')}
        <select value={settings.groupSize} onChange={(e) => set({ groupSize: Number(e.target.value) as 3 | 4 | 5 })}>
          <option value={4}>4</option>
          <option value={3}>3</option>
          <option value={5}>5</option>
        </select>
      </label>
      <label className="field">{tr('advance')}<input type="number" min={1} max={3} value={settings.advancePerGroup} onChange={(e) => set({ advancePerGroup: Number(e.target.value) })} /></label>
      <div>
        <div className="muted">{tr('places')}</div>
        <label className="check"><input type="checkbox" checked={settings.places.third} onChange={(e) => places({ third: e.target.checked })} />{tr('place3')}</label>
        <label className="check"><input type="checkbox" checked={settings.places.fiveToEight} onChange={(e) => places({ fiveToEight: e.target.checked })} />{tr('place58')}</label>
        <label className="check"><input type="checkbox" checked={settings.places.nineToSixteen} onChange={(e) => places({ nineToSixteen: e.target.checked })} />{tr('place916')}</label>
        <label className="check"><input type="checkbox" checked={settings.places.seventeenToThirtyTwo} onChange={(e) => places({ seventeenToThirtyTwo: e.target.checked })} />{tr('place1732')}</label>
        <label className="check"><input type="checkbox" checked={settings.places.nonQualifiers} onChange={(e) => places({ nonQualifiers: e.target.checked })} />{tr('placeNq')}</label>
        <p className="muted">{tr('placesHint')}</p>
      </div>
    </div>
  )
}

function Slip({ t, m, lang }: { t: Tournament; m: Match; lang: Lang }) {
  const cls = m.outcome === 'pending' && m.table ? 'live' : m.outcome === 'pending' && m.slotA && m.slotB ? 'ready' : m.outcome === 'pending' ? 'pending' : 'done'
  const sets = m.sets.map((s) => `${s.a}:${s.b}`).join('  ')
  return (
    <div className={`slip ${cls}`}>
      <div className="meta">
        <span>{matchTitle(m, lang)}{m.table ? ` · ${translate(lang, 'suggest')} ${m.table}` : ''}</span>
        <span>{m.outcome === 'bye' ? translate(lang, 'bye') : sets || translate(lang, m.outcome === 'walkover' ? 'status_walkover' : m.outcome === 'retirement' ? 'status_retirement' : 'status_pending')}</span>
      </div>
      <Side t={t} id={m.slotA} win={m.winnerId != null && m.winnerId === m.slotA} lose={m.winnerId != null && m.winnerId !== m.slotA && !!m.slotA} lang={lang} seed={m.slotA ? t.mainSeeds[m.slotA] : undefined} bye={!m.slotA && !m.waitA} />
      <Side t={t} id={m.slotB} win={m.winnerId != null && m.winnerId === m.slotB} lose={m.winnerId != null && m.winnerId !== m.slotB && !!m.slotB} lang={lang} seed={m.slotB ? t.mainSeeds[m.slotB] : undefined} bye={!m.slotB && !m.waitB} />
    </div>
  )
}

function Side({ t, id, win, lose, lang, seed, bye }: { t: Tournament; id: string | null; win: boolean; lose: boolean; lang: Lang; seed?: number; bye: boolean }) {
  const p = findPlayer(t, id)
  return (
    <div className={`side ${win ? 'win' : ''} ${lose ? 'lose' : ''}`}>
      <span>{seed ? <span className="muted">{seed} </span> : null}{bye ? translate(lang, 'bye') : pname(p, lang)} <span className="club">{p?.club}</span></span>
    </div>
  )
}

function BracketColumns({
  t, lang, matches, title, roundOn = 0, setRoundOn, onSlot, highlight,
}: {
  t: Tournament
  lang: Lang
  matches: Match[]
  title: string
  roundOn?: number
  setRoundOn?: (n: number) => void
  onSlot?: (index: number) => void
  highlight?: number | null
}) {
  const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b)
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="rounds-switch">
        {rounds.map((r) => {
          const sampleR = matches.find((m) => m.round === r)!
          return (
            <button key={r} className={r === roundOn ? 'on' : ''} onClick={() => setRoundOn?.(r)}>{roundHeading(sampleR, lang)}</button>
          )
        })}
      </div>
      <div className="bracket">
        {rounds.map((r) => (
          <div className={`round ${r === roundOn ? 'on' : ''}`} key={r}>
            <h3>{roundHeading(matches.find((m) => m.round === r)!, lang)}</h3>
            {matches.filter((m) => m.round === r).sort((a, b) => a.index - b.index).map((m) => (
              <div key={m.id} onClick={() => {
                if (!onSlot || m.round !== 0) return
                onSlot(m.index * 2)
              }}>
                <Slip t={t} m={m} lang={lang} />
                {onSlot && m.round === 0 && (
                  <div className="row" style={{ marginTop: -6, marginBottom: 8 }}>
                    <button className={`btn small ${highlight === m.index * 2 ? '' : 'secondary'}`} onClick={(e) => { e.stopPropagation(); onSlot(m.index * 2) }}>A</button>
                    <button className={`btn small ${highlight === m.index * 2 + 1 ? '' : 'secondary'}`} onClick={(e) => { e.stopPropagation(); onSlot(m.index * 2 + 1) }}>B</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function PublicView({ t, lang }: { t: Tournament; lang: Lang }) {
  const tr = (k: Key) => translate(lang, k)
  const live = t.matches.filter((m) => m.outcome === 'pending' && m.table != null)
  const next = readyMatches(t).filter((m) => m.table == null).slice(0, 8)
  const rows = classification(t).slice(0, 16)
  const [roundOn, setRoundOn] = useState(0)
  return (
    <>
      <div className="card">
        <h2>{tr('nowPlaying')}</h2>
        {live.length === 0 && <p className="muted">{tr('noLive')}</p>}
        {live.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
      </div>
      {next.length > 0 && (
        <div className="card">
          <h2>{tr('upNext')}</h2>
          {next.map((m) => <Slip key={m.id} t={t} m={m} lang={lang} />)}
        </div>
      )}
      <div className="card">
        <h2>{tr('classTitle')}</h2>
        <table className="list">
          <tbody>
            {rows.map((r) => {
              const p = findPlayer(t, r.playerId)
              const place = placeText(r.ref, tr('notClassified'))
              return <tr key={r.playerId}><td>{place}</td><td>{p?.name}<div className="muted">{p?.club}</div></td><td>{r.points ?? ''}</td></tr>
            })}
          </tbody>
        </table>
      </div>
      {t.matches.some((m) => m.stage === 'main') && (
        <BracketColumns t={t} lang={lang} matches={t.matches.filter((m) => m.stage === 'main')} title={tr('main')} roundOn={roundOn} setRoundOn={setRoundOn} />
      )}
      {t.groups.length > 0 && <Qualifying quiet t={t} lang={lang} tr={tr} act={() => undefined} go={() => undefined} />}
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
          <thead><tr><th>{tr('place')}</th><th>{tr('playerName')}</th><th>{tr('club')}</th><th>{tr('kwgpp')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const p = findPlayer(t, r.playerId)
              const place = placeText(r.ref, tr('notClassified'))
              return <tr key={r.playerId}><td>{place}</td><td>{p?.name}</td><td>{p?.club}</td><td>{r.points ?? ''}</td></tr>
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
  tr, onCreate, onDemo, onImport,
}: {
  tr: (k: Key) => string
  onCreate: () => void
  onDemo: () => void
  onImport: (file: File) => void
}) {
  return (
    <div className="card">
      <h2 style={{ fontSize: '2rem' }}>{tr('welcomeTitle')}</h2>
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
    </div>
  )
}
