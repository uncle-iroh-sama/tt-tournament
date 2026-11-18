import { useEffect, useState } from 'react'
import type { Lang } from '../i18n.ts'
import { translate, type Key } from '../i18n.ts'
import type { Match, SetScore } from '../logic/types.ts'
import { isValidSet, setsNeeded } from '../logic/score.ts'
import { findPlayer, pname } from './format.ts'
import type { Tournament } from '../logic/types.ts'

const QUICK = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
const DEUCE: [number, number][] = [[12, 10], [13, 11], [14, 12], [15, 13]]

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
  const [sets, setSets] = useState<SetScore[]>(match.sets)
  const [customA, setCustomA] = useState('11')
  const [customB, setCustomB] = useState('9')
  const t = (k: Key) => translate(lang, k)
  const a = findPlayer(tournament, match.slotA)
  const b = findPlayer(tournament, match.slotB)
  const need = setsNeeded(match.bestOf)
  const clean = sets.every((s) => isValidSet(s.a, s.b))
  const won = (side: 'A' | 'B') => sets.filter((s) => isValidSet(s.a, s.b) && (side === 'A' ? s.a > s.b : s.b > s.a)).length
  const finished = clean && (won('A') >= need || won('B') >= need)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'Enter' && finished) onScore(sets)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [finished, onClose, onScore, sets])

  function push(set: SetScore) {
    if (finished) return
    setSets((prev) => [...prev, set])
  }

  return (
    <div className="dialog-back" onMouseDown={onClose}>
      <div className="dialog" role="dialog" aria-modal="true" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>{t('scoreTitle')}</h2>
          <button className="btn secondary small" onClick={onClose}>{t('close')}</button>
        </div>
        <p className="muted">{match.bestOf === 5 ? t('bestOf5') : t('bestOf3')}</p>
        <div className="sets-so-far">
          {sets.map((s, i) => (
            <span className="chip" key={i} style={isValidSet(s.a, s.b) ? undefined : { background: '#fdecec' }}>{s.a}:{s.b}</span>
          ))}
          {sets.length > 0 && (
            <button className="btn secondary small" onClick={() => setSets((prev) => prev.slice(0, -1))}>
              {lang === 'pl' ? 'Cofnij set' : 'Undo set'}
            </button>
          )}
        </div>
        <div className="score-grid">
          {(['A', 'B'] as const).map((side) => {
            const p = side === 'A' ? a : b
            return (
              <div className="score-col" key={side}>
                <h4>{pname(p, lang)}</h4>
                <div className="muted">{p?.club}</div>
                <div className="pills" style={{ marginTop: 8 }}>
                  {QUICK.map((n) => (
                    <button key={n} data-testid={`set-${side}-11-${n}`} disabled={finished} onClick={() => push(side === 'A' ? { a: 11, b: n } : { a: n, b: 11 })}>
                      11:{n}
                    </button>
                  ))}
                  {DEUCE.map(([hi, lo]) => (
                    <button key={hi} disabled={finished} onClick={() => push(side === 'A' ? { a: hi, b: lo } : { a: lo, b: hi })}>
                      {hi}:{lo}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <label className="field">{t('custom')} A
            <input value={customA} inputMode="numeric" onChange={(e) => setCustomA(e.target.value)} />
          </label>
          <label className="field">B
            <input value={customB} inputMode="numeric" onChange={(e) => setCustomB(e.target.value)} />
          </label>
          <button className="btn secondary" disabled={finished} onClick={() => push({ a: Number(customA), b: Number(customB) })}>{t('addSet')}</button>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn" data-testid="score-save" disabled={!finished} onClick={() => onScore(sets)}>{t('saveScore')}</button>
          {match.slotA && <button className="btn secondary" onClick={() => onWalkover(match.slotA!)}>{t('walkover')}: {pname(a, lang)}</button>}
          {match.slotB && <button className="btn secondary" onClick={() => onWalkover(match.slotB!)}>{t('walkover')}: {pname(b, lang)}</button>}
          {match.slotA && <button className="btn secondary" onClick={() => onRetire(match.slotA!, sets)}>{t('retirement')}: {pname(a, lang)}</button>}
          {match.slotB && <button className="btn secondary" onClick={() => onRetire(match.slotB!, sets)}>{t('retirement')}: {pname(b, lang)}</button>}
        </div>
      </div>
    </div>
  )
}
