import { useEffect, useRef, useState, type KeyboardEvent as KeyEvt } from 'react'
import type { Lang } from '../i18n.ts'
import { translate, type Key } from '../i18n.ts'
import type { Match, SetScore } from '../logic/types.ts'
import { isValidSet, matchWinner } from '../logic/score.ts'
import { findPlayer, pname } from './format.ts'
import type { Tournament } from '../logic/types.ts'

type Row = { a: string; b: string }
type Side = 'a' | 'b'

function read(rows: Row[], bestOf: 3 | 5): { sets: SetScore[]; bad: number | null; winner: 'A' | 'B' | null } {
  const sets: SetScore[] = []
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i]!.a.trim()
    const b = rows[i]!.b.trim()
    if (a === '' && b === '') continue
    if (a === '' || b === '') return { sets, bad: null, winner: null }
    const sa = Number(a)
    const sb = Number(b)
    if (!isValidSet(sa, sb)) return { sets, bad: i, winner: null }
    sets.push({ a: sa, b: sb })
    const winner = matchWinner(sets, bestOf)
    if (winner) return { sets, bad: null, winner }
  }
  return { sets, bad: null, winner: null }
}

export function ScoreDialog({
  tournament,
  match,
  lang,
  onClose,
  onScore,
  onWalkover,
  onRetire,
}: {
  tournament: Tournament
  match: Match
  lang: Lang
  onClose: () => void
  onScore: (sets: SetScore[]) => void
  onWalkover: (winnerId: string) => void
  onRetire: (winnerId: string, sets: SetScore[]) => void
}) {
  const t = (k: Key) => translate(lang, k)
  const a = findPlayer(tournament, match.slotA)
  const b = findPlayer(tournament, match.slotB)
  const [rows, setRows] = useState<Row[]>(() =>
    match.sets.length > 0 ? match.sets.map((s) => ({ a: String(s.a), b: String(s.b) })) : [{ a: '', b: '' }],
  )
  const [focusAt, setFocusAt] = useState<{ i: number; side: Side } | null>({ i: 0, side: 'a' })
  const [pending, setPending] = useState<null | { kind: 'wo' | 'retire'; id: string }>(null)
  const root = useRef<HTMLDivElement>(null)
  const viewed = read(rows, match.bestOf)
  const finished = viewed.winner != null
  const wins = { A: 0, B: 0 }
  for (const s of viewed.sets) {
    if (s.a > s.b) wins.A++
    else wins.B++
  }

  useEffect(() => {
    if (!focusAt || !root.current) return
    const el = root.current.querySelector<HTMLInputElement>(`[data-set="${focusAt.i}-${focusAt.side}"]`)
    el?.focus()
    el?.select()
  }, [focusAt, rows.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function save() {
    const now = read(rows, match.bestOf)
    if (now.winner) onScore(now.sets)
  }

  function write(index: number, side: Side, raw: string) {
    const pair = raw.trim().match(/^(\d{1,2})\s*[:\- ]\s*(\d{1,2})$/)
    setRows((prev) => {
      const next = prev.map((row) => ({ ...row }))
      const row = next[index] ?? { a: '', b: '' }
      next[index] = row
      if (pair && side === 'a') {
        row.a = pair[1]!
        row.b = pair[2]!
      } else {
        row[side] = raw.replace(/\D/g, '').slice(0, 2)
      }
      return next
    })
    if (pair && side === 'a') setFocusAt({ i: index, side: 'b' })
  }

  function onKey(e: KeyEvt<HTMLInputElement>, index: number, side: Side) {
    if (e.key === ' ' && side === 'a') {
      e.preventDefault()
      setFocusAt({ i: index, side: 'b' })
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const now = read(rows, match.bestOf)
    if (now.winner) {
      onScore(now.sets)
      return
    }
    const row = rows[index]
    if (!row) return
    if (side === 'a' && row.a.trim() !== '' && row.b.trim() === '') {
      setFocusAt({ i: index, side: 'b' })
      return
    }
    if (row.a.trim() !== '' && row.b.trim() !== '' && isValidSet(Number(row.a), Number(row.b)) && index + 1 < match.bestOf) {
      setRows((prev) => (prev[index + 1] ? prev : [...prev, { a: '', b: '' }]))
      setFocusAt({ i: index + 1, side: 'a' })
    }
  }

  const winnerName = viewed.winner === 'A' ? pname(a, lang) : viewed.winner === 'B' ? pname(b, lang) : ''
  const pendingName = pending ? pname(findPlayer(tournament, pending.id), lang) : ''

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog score-dialog" role="dialog" aria-modal="true" ref={root} onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('scoreTitle')}</h2>
          <button className="btn secondary small" onClick={onClose}>{t('close')}</button>
        </div>
        <p className="muted">{match.bestOf === 5 ? t('bestOf5') : t('bestOf3')} · {wins.A}:{wins.B}</p>
        <div className="set-head">
          <strong>{pname(a, lang)}</strong>
          <strong>{pname(b, lang)}</strong>
        </div>
        {rows.map((row, i) => {
          const both = row.a.trim() !== '' && row.b.trim() !== ''
          const sa = Number(row.a)
          const sb = Number(row.b)
          const legal = both && isValidSet(sa, sb)
          const bad = both && !legal
          return (
            <div key={i}>
              <div className="set-row">
                <input
                  data-set={`${i}-a`}
                  data-testid={i === 0 ? 'set-a' : undefined}
                  inputMode="numeric"
                  aria-label={`${pname(a, lang)} ${t('set')} ${i + 1}`}
                  value={row.a}
                  className={legal && sa > sb ? 'win' : bad ? 'bad' : ''}
                  onChange={(e) => write(i, 'a', e.target.value)}
                  onKeyDown={(e) => onKey(e, i, 'a')}
                />
                <span className="colon">:</span>
                <input
                  data-set={`${i}-b`}
                  data-testid={i === 0 ? 'set-b' : undefined}
                  inputMode="numeric"
                  aria-label={`${pname(b, lang)} ${t('set')} ${i + 1}`}
                  value={row.b}
                  className={legal && sb > sa ? 'win' : bad ? 'bad' : ''}
                  onChange={(e) => write(i, 'b', e.target.value)}
                  onKeyDown={(e) => onKey(e, i, 'b')}
                />
              </div>
              {bad && <p className="set-reason">{t('setRule')}</p>}
            </div>
          )
        })}
        {finished && (
          <p className="winner-line">{t('whoWon')} {winnerName} {wins.A}:{wins.B}</p>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" data-testid="score-save" disabled={!finished} onClick={save}>{t('saveScore')}</button>
        </div>
        <details className="special">
          <summary>{t('specialTitle')}</summary>
          {pending == null ? (
            <div className="row" style={{ marginTop: 8 }}>
              {match.slotA && <button className="btn secondary small" onClick={() => setPending({ kind: 'wo', id: match.slotA! })}>{t('walkover')}: {pname(a, lang)}</button>}
              {match.slotB && <button className="btn secondary small" onClick={() => setPending({ kind: 'wo', id: match.slotB! })}>{t('walkover')}: {pname(b, lang)}</button>}
              {match.slotA && <button className="btn secondary small" onClick={() => setPending({ kind: 'retire', id: match.slotA! })}>{t('retirement')}: {pname(a, lang)}</button>}
              {match.slotB && <button className="btn secondary small" onClick={() => setPending({ kind: 'retire', id: match.slotB! })}>{t('retirement')}: {pname(b, lang)}</button>}
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              <p>{pending.kind === 'wo' ? t('walkover') : t('retirement')}: <b>{pendingName}</b>?</p>
              <div className="row">
                <button className="btn" onClick={() => {
                  if (pending.kind === 'wo') onWalkover(pending.id)
                  else onRetire(pending.id, viewed.sets)
                }}>{t('yes')}</button>
                <button className="btn secondary" onClick={() => setPending(null)}>{t('no')}</button>
              </div>
            </div>
          )}
        </details>
      </div>
    </div>
  )
}
