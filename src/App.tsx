import { useEffect, useState } from 'react'
import { demoTournament } from './demo.ts'
import { loadLang, saveLang, translate, type Key, type Lang } from './i18n.ts'
import { createTournament, defaultSettings } from './logic/engine.ts'
import type { Settings, Tournament } from './logic/types.ts'
import { fetchLive, isLiveSlug, loadTournament, saveTournament, tournamentFromJson } from './storage.ts'
import { Desk, LivePage, SettingsFields, Welcome } from './ui/desk.tsx'

const ERRORS: Record<string, Key> = {
  'invalid-set': 'invalidSet',
  'no-winner': 'noWinner',
  'extra-sets': 'extraSets',
  empty: 'emptyScore',
  locked: 'locked',
  'not-ready': 'notReady',
  'table-busy': 'tableBusy',
  'player-busy': 'playerBusy',
  'results-exist': 'resultsExist',
  'qualifying-open': 'qualifyingOpen',
  'qualifying-skip': 'qualifyingSkip',
  'main-started': 'mainStarted',
  'too-few': 'tooFew',
  'draw-locked': 'drawLocked',
  missing: 'missing',
  'bad-table': 'badTable',
  'already-won': 'alreadyWon',
  'import-bad': 'importBad',
  'no-draw': 'bracketEmpty',
  'bad-slot': 'missing',
  'fixed-groups': 'fixedGroups',
  'fixed-name': 'fixedName',
  'fixed-duplicate': 'fixedDuplicate',
  'fixed-empty': 'fixedEmpty',
  'fixed-field': 'fixedField',
  'fixed-size': 'fixedSize',
}

function pageKey(route: string): Key {
  if (route.startsWith('#/live/')) return 'liveTitle'
  if (route.startsWith('#/public')) return 'public'
  if (route.startsWith('#/druk/klasyfikacja')) return 'printClass'
  if (route.startsWith('#/druk/kartki')) return 'printSheets'
  if (route.startsWith('#/druk')) return 'printBracket'
  return NAV.find(([hash]) => hash === route)?.[1] ?? 'app'
}

const NAV: [string, Key][] = [
  ['#/', 'navHome'],
  ['#/zawodnicy', 'navPlayers'],
  ['#/eliminacje', 'navQual'],
  ['#/drabinka', 'navBracket'],
  ['#/mecze', 'navMatches'],
  ['#/klasyfikacja', 'navClass'],
  ['#/ustawienia', 'navSettings'],
]

export default function App() {
  const [lang, setLang] = useState<Lang>(() => loadLang())
  const [tournament, setTournament] = useState<Tournament | null>(() => loadTournament())
  const [route, setRoute] = useState(() => window.location.hash || '#/')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<Settings>(() => defaultSettings())
  const [draftCode, setDraftCode] = useState('')
  const [ask, setAsk] = useState<null | { text: string; run: () => void }>(null)
  const [openedSlug, setOpenedSlug] = useState<string | null>(() => {
    try {
      const raw = sessionStorage.getItem('tt-live-slug')
      if (!raw) return null
      const saved = JSON.parse(raw) as { id?: string; slug?: string }
      const current = loadTournament()
      if (current && saved.id === current.id && saved.slug && isLiveSlug(saved.slug)) return saved.slug
    } catch {
      /* a bad session value just means there is no remembered file name */
    }
    return null
  })

  useEffect(() => {
    const onHash = () => setRoute(window.location.hash || '#/')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => { saveTournament(tournament) }, [tournament])
  useEffect(() => {
    saveLang(lang)
    const root = document.documentElement
    root.lang = lang
    root.setAttribute('translate', 'no')
    root.classList.add('notranslate')
    const page = translate(lang, pageKey(route))
    const live = route.startsWith('#/live/')
    const name = live ? '' : tournament?.settings.name.trim()
    const app = translate(lang, 'app')
    const tag = translate(lang, 'tag')
    document.title = name ? `${page} · ${name}` : `${app} · ${tag}`
  }, [lang, route, tournament])

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'tt-tournament-v1') setTournament(loadTournament())
      if (e.key === 'tt-lang') setLang(loadLang())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  const tr = (k: Key) => translate(lang, k)
  const liveSlug = /^#\/live\/([a-z0-9][a-z0-9-]{0,62})$/.exec(route)?.[1] ?? null
  const pub = route.startsWith('#/public') || liveSlug != null
  const print = route.startsWith('#/druk')

  function forgetSlug() {
    setOpenedSlug(null)
    sessionStorage.removeItem('tt-live-slug')
  }

  function openPublished(slug: string) {
    const run = () => {
      fetchLive(slug).then((res) => {
        if (!res.ok) {
          setError(translate(lang, res.error === 'bad' ? 'liveBad' : 'liveMissing'))
          return
        }
        setOpenedSlug(slug)
        sessionStorage.setItem('tt-live-slug', JSON.stringify({ id: res.tournament.id, slug }))
        setTournament(res.tournament)
        setCreating(false)
        setError(null)
        go('#/')
      })
    }
    if (tournament) setAsk({ text: tr('replaceConfirm'), run })
    else run()
  }

  function go(hash: string) {
    if (window.location.hash === hash) setRoute(hash)
    else window.location.hash = hash
  }

  function showError(code: string) {
    const key = ERRORS[code]
    setError(key ? translate(lang, key) : code)
  }

  function beginNew() {
    const run = () => {
      setTournament(null)
      forgetSlug()
      setCreating(true)
      setDraft(defaultSettings())
      setDraftCode('')
      setError(null)
      go('#/')
    }
    if (tournament) setAsk({ text: tr('replaceConfirm'), run })
    else run()
  }

  const subtitle = liveSlug
    ? tr('tag')
    : tournament
      ? [tournament.settings.date, tournament.settings.venue].filter(Boolean).join(' · ')
      : tr('tag')

  return (
    <>
      <header className="top">
        <div className="top-row">
          <div className="brand">
            <span className="ball" aria-hidden="true" />
            <div>
              <h1>{liveSlug ? tr('liveTitle') : tournament?.settings.name || tr('app')}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="top-actions">
            {!print && (
              pub
                ? <a className="ghost" href="#/">{tr('back')}</a>
                : <a className="ghost" data-testid="public-link" href="#/public">{tr('public')}</a>
            )}
            <div className="lang" role="group" aria-label={tr('langPl')}>
              <button className={lang === 'pl' ? 'on' : ''} data-testid="lang-pl" onClick={() => setLang('pl')}>{tr('langPl')}</button>
              <button className={lang === 'en' ? 'on' : ''} data-testid="lang-en" onClick={() => setLang('en')}>{tr('langEn')}</button>
            </div>
          </div>
        </div>
      </header>
      {!pub && !print && tournament && (
        <nav className="nav">
          {NAV.map(([hash, key]) => (
            <a key={hash} className={route === hash || (hash === '#/' && route === '') ? 'on' : ''} href={hash}>{tr(key)}</a>
          ))}
        </nav>
      )}
      <main className="wrap">
        {error && (
          <div className="alert" role="alert">
            {error} <button className="btn secondary small" onClick={() => setError(null)}>{tr('close')}</button>
          </div>
        )}
        {liveSlug ? (
          <LivePage lang={lang} slug={liveSlug} />
        ) : tournament ? (
          <Desk
            tournament={tournament}
            lang={lang}
            route={route}
            go={go}
            setT={(next) => { setError(null); setTournament(next) }}
            onError={showError}
            onReplace={beginNew}
            publishedSlug={openedSlug}
            onOpenPublished={openPublished}
          />
        ) : creating ? (
          <div className="card">
            <h2>{tr('newTournament')}</h2>
            <SettingsFields settings={draft} tr={tr} onChange={setDraft} />
            <label className="field" style={{ maxWidth: 220, marginTop: 12 }}>
              {tr('drawCode')}
              <input value={draftCode} placeholder="A7K2QX" onChange={(e) => setDraftCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} />
            </label>
            <p className="muted">{tr('drawCodeHint')}</p>
            <div className="row">
              <button className="btn" onClick={() => {
                const settings = { ...draft, name: draft.name.trim() || tr('app') }
                forgetSlug()
                setTournament(createTournament(settings, draftCode || undefined))
                setCreating(false)
                go('#/zawodnicy')
              }}>{tr('create')}</button>
              <button className="btn secondary" onClick={() => setCreating(false)}>{tr('cancel')}</button>
            </div>
          </div>
        ) : (
          <Welcome
            tr={tr}
            onCreate={beginNew}
            onDemo={() => { forgetSlug(); setError(null); setTournament(demoTournament()); go('#/') }}
            onOpenPublished={openPublished}
            onImport={(file) => {
              file.text().then((raw) => {
                const parsed = tournamentFromJson(raw)
                if (!parsed) showError('import-bad')
                else { forgetSlug(); setError(null); setTournament(parsed); go('#/') }
              }).catch(() => showError('import-bad'))
            }}
          />
        )}
      </main>
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
