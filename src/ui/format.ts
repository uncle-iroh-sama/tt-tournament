import type { Lang } from '../i18n.ts'
import { translate } from '../i18n.ts'
import type { Match, Player, Tournament } from '../logic/types.ts'

export function pname(p: Player | null | undefined, lang: Lang): string {
  if (!p) return '—'
  return p.withdrawn ? `${p.name} (${translate(lang, 'withdrawn')})` : p.name
}

/** Players still in the round. A 32-player round is 1/16, and 1/32 is a 64-player round. */
export function roundName(players: number, lang: Lang): string {
  if (players === 2) return translate(lang, 'final')
  if (players === 4) return translate(lang, 'semi')
  if (players === 8) return translate(lang, 'quarter')
  if (lang === 'en') return `Round of ${players}`
  return `1/${players / 2}`
}

function namedRound(players: number | undefined, lang: Lang): string | null {
  if (players == null || players < 2 || (players & (players - 1)) !== 0) return null
  return roundName(players, lang)
}

export function matchTitle(m: Match, lang: Lang): string {
  const l = m.label
  if (l.k === 'qual') {
    const named = namedRound(l.draw, lang)
    if (named) return named
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
  return roundName(2 ** (l.rounds - l.round), lang)
}

export function placeColumnTitle(matches: Match[], lang: Lang): string {
  const places = matches.flatMap((m) => (m.label.k === 'place' ? [m.label.place] : []))
  if (places.length === 0) return translate(lang, 'placement')
  const lo = Math.min(...places)
  const hi = Math.max(...places)
  if (lo === hi) return lang === 'pl' ? `O ${lo}. miejsce` : `Place ${lo}`
  return lang === 'pl' ? `Miejsca ${lo}–${hi}` : `Places ${lo}–${hi}`
}

/** 1 mecz, 2–4 mecze, 5+ meczów (and 21 mecz, 22 mecze). English uses one / other. */
export function countForm(n: number, lang: Lang, one: string, few: string, many: string): string {
  if (lang === 'en') return Math.abs(n) === 1 ? one : many
  const abs = Math.abs(Math.trunc(n))
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function roundHeading(m: Match, lang: Lang): string {
  if (m.stage === 'qualifying') {
    const draw = m.label.k === 'qual' ? m.label.draw : undefined
    return namedRound(draw, lang) ?? `${translate(lang, 'qual')} · ${m.round + 1}`
  }
  if (m.stage === 'group') return `${translate(lang, 'group')} · ${translate(lang, 'kolejka')} ${m.round + 1}`
  if (m.stage === 'placement') return placeColumnTitle([m], lang)
  const label = m.label
  if (label.k !== 'main') return translate(lang, 'main')
  return roundName(2 ** (label.rounds - label.round), lang)
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

export function catKey(cat: string): 'cat_senior' | 'cat_mlodziezowiec' | 'cat_junior' | 'cat_kadet' | 'cat_mlodzik' | 'cat_zak' | 'cat_skrzat' | 'cat_masters' | 'cat_custom' {
  const key = `cat_${cat}` as const
  if (
    key === 'cat_senior' || key === 'cat_mlodziezowiec' || key === 'cat_junior' || key === 'cat_kadet' ||
    key === 'cat_mlodzik' || key === 'cat_zak' || key === 'cat_skrzat' || key === 'cat_masters' || key === 'cat_custom'
  ) return key
  return 'cat_senior'
}
