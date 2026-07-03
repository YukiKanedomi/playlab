// games/bakefuda/cards.ts
// Resolves card asset URLs from SVG files via Vite's import.meta.glob.
// Files follow the naming convention: m{MM}_{tag}.svg
//   tag: hikari | tane | tan | kasu1 | kasu2 | kasu3

import type { Card, Kind } from './data'

const CARD_URLS = import.meta.glob<string>(
  './assets/cards/*.svg',
  { eager: true, query: '?url', import: 'default' },
)

function assetKey(month: number, kind: Kind, ordinal: number): string {
  const mm  = String(month).padStart(2, '0')
  const tag = kind === 'ko'   ? 'hikari'
            : kind === 'tane' ? 'tane'
            : kind === 'tan'  ? 'tan'
            : `kasu${ordinal}`
  return `./assets/cards/m${mm}_${tag}.svg`
}

export function cardImgUrl(card: Pick<Card, 'month' | 'kind' | 'ordinal'>): string {
  const key = assetKey(card.month, card.kind, card.ordinal)
  return CARD_URLS[key] ?? CARD_URLS['./assets/cards/blank.svg'] ?? ''
}

export function cardBackUrl(): string {
  return CARD_URLS['./assets/cards/back.svg'] ?? ''
}
