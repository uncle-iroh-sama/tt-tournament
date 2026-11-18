import type { Lang } from '../i18n.ts'
import { translate } from '../i18n.ts'
import type { Match, Player, Tournament } from '../logic/types.ts'

export function pname(p: Player | null | undefined, lang: Lang): string {
  if (!p) return '—'
  return p.withdrawn ? `${p.name} (${translate(lang, 'withdrawn')})` : p.name
}

export function matchTitle(m: Match, lang: Lang): string {
  const l = m.label
  if (l.k === 'qual') {
    return lang === 'pl'
      ? `Eliminacje · runda ${l.round + 1} · mecz ${l.n}`
      : `Qualifying · round ${l.round + 1} · match ${l.n}`
  }
  if (l.k === 'group') {
    return lang === 'pl'
      ? `Grupa ${l.group} · kolejka ${l.kolejka} · mecz ${l.n}`
      : `Group ${l.group} · round ${l.kolejka} · match ${l.n}`
  }
  if (l.k === 'place') {
    return lang === 'pl' ? `Mecz o ${l.place}. miejsce` : `Match for place ${l.place}`
  }
  const size = 2 ** (l.rounds - l.round)
  if (size === 2) return translate(lang, 'final')
  if (size === 4) return translate(lang, 'semi')
  if (size === 8) return translate(lang, 'quarter')
  return `1/${size}`
}

export function roundHeading(m: Match, lang: Lang): string {
  if (m.stage === 'qualifying') return `${translate(lang, 'qual')} · ${m.round + 1}`
  if (m.stage === 'group') return `${translate(lang, 'group')} · ${translate(lang, 'kolejka')} ${m.round + 1}`
  if (m.stage === 'placement') return translate(lang, 'placement')
  const label = m.label
  if (label.k !== 'main') return translate(lang, 'main')
  const size = 2 ** (label.rounds - label.round)
  if (size === 2) return translate(lang, 'final')
  if (size === 4) return translate(lang, 'semi')
  if (size === 8) return translate(lang, 'quarter')
  return `1/${size}`
}

export function findPlayer(t: Tournament, id: string | null): Player | null {
  if (!id) return null
  return t.players.find((p) => p.id === id) ?? null
}

export function ratioText(won: number, lost: number): string {
  if (lost === 0) return won === 0 ? '0' : `${won}/0`
  const v = won / lost
  return `${won}:${lost} (${v.toFixed(2)})`
}

export function catKey(cat: string): 'cat_senior' | 'cat_mlodziezowiec' | 'cat_junior' | 'cat_kadet' | 'cat_mlodzik' | 'cat_zak' | 'cat_skrzat' | 'cat_masters' {
  const key = `cat_${cat}` as const
  if (
    key === 'cat_senior' || key === 'cat_mlodziezowiec' || key === 'cat_junior' || key === 'cat_kadet' ||
    key === 'cat_mlodzik' || key === 'cat_zak' || key === 'cat_skrzat' || key === 'cat_masters'
  ) return key
  return 'cat_senior'
}
