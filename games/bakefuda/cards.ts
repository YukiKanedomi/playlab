// games/bakefuda/cards.ts
// Generates inline SVG string for each hanafuda card.
// Style: copper line engraving on ivory — stroke-dominant, minimal fill.
// Palette: stroke #8a6a3f / accent stroke #b87333 / crimson #b8452e / pine #2c4a3e

import type { Kind } from './data'

const S  = '#8a6a3f'    // main stroke
const SA = '#b87333'    // accent / lighter copper
const CR = '#b8452e'    // crimson accent (flowers, ribbon)
const PI = '#2c4a3e'    // pine green accent

// Month label codes
const MONTH_CODE = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC']
const MONTH_PLANT = ['松','梅','桜','藤','菖蒲','牡丹','萩','芒','菊','紅葉','柳','桐']

// ── Plant line drawings (shared per month, no fill) ──────────────────────

function pine(): string {
  return `
    <path d="M35 98 L35 30" stroke="${S}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M35 30 L20 60 M35 30 L50 60" stroke="${S}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M35 50 L22 72 M35 50 L48 72" stroke="${S}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M35 68 L25 82 M35 68 L45 82" stroke="${S}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M28 56 L16 62 M42 56 L54 62" stroke="${PI}" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M26 70 L14 78 M44 70 L56 78" stroke="${PI}" stroke-width="1.2" stroke-linecap="round"/>`
}

function plum(): string {
  return `
    <path d="M18 100 C22 72 38 46 56 22" stroke="${S}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M28 78 C18 62 20 44 34 38" stroke="${S}" stroke-width="1.6" stroke-linecap="round" fill="none"/>
    <circle cx="30" cy="60" r="7" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <circle cx="44" cy="42" r="7" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <circle cx="20" cy="78" r="6" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <circle cx="30" cy="60" r="2.5" fill="${CR}"/>
    <circle cx="44" cy="42" r="2.5" fill="${CR}"/>
    <circle cx="20" cy="78" r="2.2" fill="${CR}"/>`
}

function sakura(): string {
  return `
    <path d="M18 96 Q26 66 22 28 M30 98 Q40 68 38 30" stroke="${S}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <g fill="none" stroke="${CR}" stroke-width="1.6">
      <path d="M46 24 C44 18 52 18 50 24 C56 22 56 30 50 28 C52 34 44 34 46 28 C40 30 40 22 46 24z"/>
      <path d="M52 38 C50 32 58 32 56 38 C62 36 62 44 56 42 C58 48 50 48 52 42 C46 44 46 36 52 38z"/>
    </g>`
}

function wisteria(): string {
  return `
    <path d="M35 20 C35 50 20 68 24 96" stroke="${S}" stroke-width="2" stroke-linecap="round" fill="none"/>
    <path d="M35 28 C50 40 54 60 46 84" stroke="${S}" stroke-width="1.4" fill="none"/>
    <g fill="${CR}" stroke="none">
      <ellipse cx="28" cy="46" rx="4" ry="6" transform="rotate(-15 28 46)"/>
      <ellipse cx="22" cy="62" rx="4" ry="6" transform="rotate(-10 22 62)"/>
      <ellipse cx="24" cy="78" rx="3.5" ry="5"/>
      <ellipse cx="46" cy="50" rx="4" ry="6" transform="rotate(10 46 50)"/>
      <ellipse cx="44" cy="68" rx="4" ry="6" transform="rotate(8 44 68)"/>
    </g>`
}

function iris(): string {
  return `
    <path d="M28 98 L28 52 M42 98 L42 56" stroke="${PI}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M28 52 C20 42 20 28 28 22 C36 28 36 42 28 52z" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <path d="M42 56 C34 46 34 32 42 26 C50 32 50 46 42 56z" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <path d="M28 22 C24 16 32 14 28 22z M42 26 C38 20 46 18 42 26z" fill="${CR}"/>`
}

function peony(): string {
  return `
    <path d="M22 96 C26 76 30 60 35 46 C40 60 44 76 48 96" stroke="${S}" stroke-width="1.8" fill="none"/>
    <path d="M35 46 C28 36 26 24 35 20 C44 24 42 36 35 46z" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <circle cx="35" cy="30" r="6" fill="none" stroke="${CR}" stroke-width="1.6"/>
    <circle cx="24" cy="60" r="5" fill="none" stroke="${CR}" stroke-width="1.4"/>
    <circle cx="46" cy="60" r="5" fill="none" stroke="${CR}" stroke-width="1.4"/>
    <circle cx="35" cy="78" r="6" fill="none" stroke="${CR}" stroke-width="1.4"/>`
}

function clover(): string {
  return `
    <path d="M20 96 C24 74 30 58 35 44 M50 96 C46 74 40 58 35 44" stroke="${S}" stroke-width="2" fill="none"/>
    <path d="M35 44 C26 36 22 24 30 20 C38 24 38 36 35 44z" fill="none" stroke="${CR}" stroke-width="1.6"/>
    <path d="M35 44 C44 36 48 24 40 20 C32 24 32 36 35 44z" fill="none" stroke="${CR}" stroke-width="1.6"/>
    <path d="M20 68 C26 62 34 64 35 72 C36 64 44 62 50 68" stroke="${S}" stroke-width="1.2" fill="none"/>`
}

function pampas(): string {
  return `
    <path d="M35 98 L35 38" stroke="${S}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M35 38 C28 28 20 24 16 18 M35 38 C42 28 50 24 54 18" stroke="${S}" stroke-width="1.6" fill="none"/>
    <path d="M35 52 C26 46 18 44 14 40" stroke="${S}" stroke-width="1.4" fill="none"/>
    <path d="M35 52 C44 46 52 44 56 40" stroke="${S}" stroke-width="1.4" fill="none"/>
    <path d="M16 18 C18 12 24 12 22 18 M54 18 C52 12 46 12 48 18" fill="${SA}" stroke="none"/>`
}

function chrysanth(): string {
  return `
    <path d="M22 96 L26 70 M48 96 L44 70" stroke="${S}" stroke-width="1.8"/>
    <path d="M26 70 C28 58 32 52 35 48 C38 52 42 58 44 70" stroke="${S}" stroke-width="1.6" fill="none"/>
    <g fill="none" stroke="${PI}" stroke-width="1.5">
      <path d="M35 48 C30 36 26 30 28 20 M35 48 C40 36 44 30 42 20"/>
      <path d="M35 48 C24 42 18 36 16 26 M35 48 C46 42 52 36 54 26"/>
      <path d="M35 48 C26 52 20 56 18 66 M35 48 C44 52 50 56 52 66"/>
    </g>
    <circle cx="35" cy="48" r="5" fill="none" stroke="${CR}" stroke-width="1.6"/>`
}

function maple(): string {
  return `
    <path d="M28 98 C30 78 32 64 35 50 M42 98 C40 78 38 64 35 50" stroke="${S}" stroke-width="2" fill="none"/>
    <path d="M35 50 L22 38 M35 50 L48 38" stroke="${S}" stroke-width="1.6"/>
    <path d="M22 38 L12 30 M22 38 L16 26 M22 38 L28 26" stroke="${CR}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M48 38 L58 30 M48 38 L54 26 M48 38 L42 26" stroke="${CR}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M35 50 L35 28 M35 28 L28 16 M35 28 L42 16" stroke="${CR}" stroke-width="1.4" stroke-linecap="round"/>`
}

function willow(): string {
  return `
    <path d="M35 18 L35 58" stroke="${S}" stroke-width="2" stroke-linecap="round"/>
    <path d="M35 28 C28 38 22 52 24 72 M35 28 C42 38 48 52 46 72" stroke="${PI}" stroke-width="1.4" fill="none"/>
    <path d="M35 38 C24 52 18 68 20 88 M35 38 C46 52 52 68 50 88" stroke="${PI}" stroke-width="1.2" fill="none"/>
    <path d="M24 72 C20 80 22 90 28 96 M46 72 C50 80 48 90 42 96" stroke="${PI}" stroke-width="1.2" fill="none"/>`
}

function paulownia(): string {
  return `
    <path d="M35 98 L35 42" stroke="${S}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M35 42 L18 62 M35 42 L52 62" stroke="${S}" stroke-width="1.6" fill="none"/>
    <path d="M35 42 L26 28 M35 42 L44 28" stroke="${S}" stroke-width="1.6" fill="none"/>
    <path d="M26 28 C24 18 28 14 35 18 C42 14 46 18 44 28" stroke="${PI}" stroke-width="1.6" fill="none"/>
    <circle cx="35" cy="24" r="4" fill="${PI}" stroke="none" opacity="0.7"/>`
}

const PLANT_SVG: ((m: number) => string)[] = [
  () => pine(),
  () => plum(),
  () => sakura(),
  () => wisteria(),
  () => iris(),
  () => peony(),
  () => clover(),
  () => pampas(),
  () => chrysanth(),
  () => maple(),
  () => willow(),
  () => paulownia(),
]

// ── Kind-specific overlays ────────────────────────────────────────────────

// 光 motifs
function crane(): string {
  return `
    <ellipse cx="52" cy="30" rx="10" ry="7" fill="none" stroke="${SA}" stroke-width="1.6"/>
    <path d="M42 30 C36 34 32 38 34 44" stroke="${SA}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M34 44 C30 50 24 52 20 50" stroke="${SA}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M34 44 C36 52 32 60 28 64" stroke="${SA}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <ellipse cx="52" cy="28" rx="4" ry="2.5" fill="${CR}"/>`
}

function curtain(): string {
  // 花見の幕（curtain/camp curtain）
  return `
    <rect x="12" y="18" width="46" height="40" fill="none" stroke="${SA}" stroke-width="1.6"/>
    <path d="M12 18 L12 58 M58 18 L58 58" stroke="${SA}" stroke-width="2.2"/>
    <path d="M12 28 L58 28 M12 38 L58 38 M12 48 L58 48" stroke="${SA}" stroke-width="0.8" opacity="0.5"/>
    <path d="M12 18 L58 18" stroke="${CR}" stroke-width="3"/>
    <path d="M12 58 L58 58" stroke="${CR}" stroke-width="3"/>`
}

function moon(): string {
  return `
    <circle cx="38" cy="36" r="20" fill="${SA}" opacity="0.15"/>
    <circle cx="38" cy="36" r="20" fill="none" stroke="${SA}" stroke-width="2"/>
    <path d="M28 32 C32 26 44 26 48 32" stroke="${SA}" stroke-width="1.2" fill="none" opacity="0.5"/>`
}

function rainCard(): string {
  // 小野道風 / 雨 — frog watching willow + rain lines
  return `
    <path d="M20 20 L20 84 M26 16 L26 88" stroke="${SA}" stroke-width="0.9" opacity="0.5"/>
    <path d="M34 14 L34 90 M42 18 L42 86" stroke="${SA}" stroke-width="0.9" opacity="0.5"/>
    <path d="M50 22 L50 82 M56 26 L56 78" stroke="${SA}" stroke-width="0.9" opacity="0.5"/>
    <ellipse cx="35" cy="80" rx="8" ry="5" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <circle cx="35" cy="78" r="2.5" fill="${PI}"/>
    <path d="M31 76 L29 70 M39 76 L41 70" stroke="${PI}" stroke-width="1.4" stroke-linecap="round"/>`
}

function phoenix(): string {
  return `
    <path d="M35 22 C22 30 18 46 24 60 C20 58 16 62 20 70 C26 66 30 72 28 80" stroke="${SA}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M35 22 C48 30 52 46 46 60 C50 58 54 62 50 70 C44 66 40 72 42 80" stroke="${SA}" stroke-width="1.8" fill="none" stroke-linecap="round"/>
    <path d="M28 80 C30 88 40 90 42 80" stroke="${SA}" stroke-width="1.6" fill="none"/>
    <ellipse cx="35" cy="26" rx="7" ry="10" fill="none" stroke="${SA}" stroke-width="1.6"/>
    <path d="M30 18 C32 12 38 12 40 18" stroke="${CR}" stroke-width="1.6" fill="none"/>
    <circle cx="35" cy="30" r="3" fill="${CR}"/>`
}

// タネ motifs
function warbler(): string {
  return `
    <ellipse cx="42" cy="60" rx="10" ry="7" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <circle cx="54" cy="56" r="5" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <path d="M32 60 C26 64 22 70 24 76" stroke="${PI}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M42 67 L38 78 M48 67 L46 78" stroke="${PI}" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="56" cy="54" r="1.5" fill="${PI}"/>`
}

function cuckoo(): string {
  return `
    <ellipse cx="40" cy="54" rx="11" ry="8" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <circle cx="52" cy="50" r="6" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <path d="M29 54 C24 60 22 68 26 76" stroke="${PI}" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <path d="M40 62 L36 76 M44 62 L44 76" stroke="${PI}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M50 50 C56 44 60 42 62 46" stroke="${PI}" stroke-width="1.4" fill="none"/>
    <circle cx="54" cy="48" r="1.5" fill="${PI}"/>`
}

function bridge(): string {
  // 八橋 — arched bridge
  return `
    <path d="M10 70 C20 52 50 52 60 70" stroke="${S}" stroke-width="2.2" fill="none"/>
    <path d="M10 70 L10 82 M60 70 L60 82" stroke="${S}" stroke-width="1.8"/>
    <path d="M10 70 L60 70 M10 76 L60 76 M10 82 L60 82" stroke="${S}" stroke-width="1.2"/>
    <path d="M22 70 L22 82 M35 70 L35 82 M48 70 L48 82" stroke="${S}" stroke-width="1"/>`
}

function butterfly(): string {
  return `
    <path d="M35 58 C24 44 16 40 14 50 C12 60 24 66 35 58z" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <path d="M35 58 C46 44 54 40 56 50 C58 60 46 66 35 58z" fill="none" stroke="${CR}" stroke-width="1.8"/>
    <path d="M35 58 C26 62 20 72 22 80 C28 78 34 68 35 58z" fill="none" stroke="${CR}" stroke-width="1.6"/>
    <path d="M35 58 C44 62 50 72 48 80 C42 78 36 68 35 58z" fill="none" stroke="${CR}" stroke-width="1.6"/>
    <path d="M35 58 L35 70" stroke="${S}" stroke-width="1.2"/>
    <circle cx="35" cy="58" r="2.5" fill="${S}"/>`
}

function boar(): string {
  return `
    <ellipse cx="38" cy="62" rx="16" ry="10" fill="none" stroke="${S}" stroke-width="1.8"/>
    <circle cx="52" cy="58" r="8" fill="none" stroke="${S}" stroke-width="1.8"/>
    <path d="M56 56 L62 50 M58 60 L66 58" stroke="${S}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M22 68 L16 78 M26 70 L22 80" stroke="${S}" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="55" cy="56" r="2" fill="${S}"/>
    <path d="M50 62 C50 68 46 70 42 68" stroke="${S}" stroke-width="1.2" fill="none"/>`
}

function geese(): string {
  // Three geese in V formation
  return `
    <path d="M20 50 C26 44 34 44 40 50" stroke="${S}" stroke-width="1.6" fill="none"/>
    <path d="M20 50 C18 56 20 62 26 64" stroke="${S}" stroke-width="1.4" fill="none"/>
    <path d="M40 50 C42 56 40 62 34 64" stroke="${S}" stroke-width="1.4" fill="none"/>
    <path d="M30 60 C36 54 44 54 50 60" stroke="${S}" stroke-width="1.6" fill="none"/>
    <path d="M30 60 C28 66 30 72 36 74" stroke="${S}" stroke-width="1.4" fill="none"/>
    <path d="M50 60 C52 66 50 72 44 74" stroke="${S}" stroke-width="1.4" fill="none"/>
    <path d="M14 38 C20 32 28 32 34 38" stroke="${S}" stroke-width="1.4" fill="none" opacity="0.7"/>`
}

function cup(): string {
  // 菊盃 — sake cup / sakazuki
  return `
    <path d="M20 60 C22 50 48 50 50 60 L48 70 C44 78 26 78 22 70z" fill="none" stroke="${SA}" stroke-width="1.8"/>
    <path d="M35 70 L35 88" stroke="${SA}" stroke-width="1.8" stroke-linecap="round"/>
    <path d="M26 88 L44 88" stroke="${SA}" stroke-width="2"/>
    <path d="M20 60 L50 60" stroke="${SA}" stroke-width="1.2" opacity="0.5"/>
    <path d="M26 54 C28 46 42 46 44 54" stroke="${SA}" stroke-width="1.2" fill="none" opacity="0.6"/>`
}

function deer(): string {
  return `
    <ellipse cx="36" cy="64" rx="15" ry="10" fill="none" stroke="${S}" stroke-width="1.8"/>
    <circle cx="50" cy="58" r="8" fill="none" stroke="${S}" stroke-width="1.8"/>
    <path d="M48 50 L44 38 M52 50 L56 38" stroke="${S}" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M44 38 L40 28 M44 38 L48 30" stroke="${S}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M56 38 L52 28 M56 38 L60 30" stroke="${S}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M22 70 L18 82 M26 72 L24 84" stroke="${S}" stroke-width="1.4" stroke-linecap="round"/>
    <circle cx="52" cy="56" r="2" fill="${S}"/>`
}

function swallow(): string {
  return `
    <path d="M35 46 C24 40 16 42 14 50 C22 52 30 50 35 46z" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <path d="M35 46 C46 40 54 42 56 50 C48 52 40 50 35 46z" fill="none" stroke="${PI}" stroke-width="1.6"/>
    <ellipse cx="35" cy="46" rx="6" ry="4" fill="none" stroke="${PI}" stroke-width="1.4"/>
    <path d="M30 50 L24 66 M40 50 L46 66" stroke="${PI}" stroke-width="1.4" stroke-linecap="round"/>
    <path d="M24 66 L18 72 M24 66 L28 74" stroke="${PI}" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M46 66 L52 72 M46 66 L42 74" stroke="${PI}" stroke-width="1.2" stroke-linecap="round"/>`
}

// 短冊 overlay
function tanRect(color: 'red' | 'blue' | 'plain'): string {
  const fill = color === 'red' ? CR : color === 'blue' ? '#2a5fa0' : '#9e9080'
  return `
    <rect x="44" y="14" width="14" height="58" rx="2" fill="${fill}" opacity="0.85"/>
    <rect x="46" y="16" width="10" height="54" rx="1" fill="none" stroke="rgba(255,255,255,0.25)" stroke-width="1"/>
    <path d="M49 20 L53 20 M49 26 L53 26 M49 32 L53 32" stroke="rgba(255,255,255,0.35)" stroke-width="0.8"/>`
}

// Map from motif names to overlay functions
const KO_OVERLAYS: Record<string, () => string> = {
  crane:   crane,
  curtain: curtain,
  moon:    moon,
  rain:    rainCard,
  phoenix: phoenix,
}

const TANE_OVERLAYS: Record<string, () => string> = {
  warbler:   warbler,
  cuckoo:    cuckoo,
  bridge:    bridge,
  butterfly: butterfly,
  boar:      boar,
  geese:     geese,
  cup:       cup,
  deer:      deer,
  swallow:   swallow,
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns an inline SVG string for the given month (1-12) and kind.
 * The SVG viewBox is "0 0 70 106" — card aspect ratio 2:3.
 */
export function cardSVG(month: number, kind: Kind, motif: string, tanColor?: 'red' | 'blue' | 'plain'): string {
  const mi = month - 1
  const code  = MONTH_CODE[mi]
  const plant = MONTH_PLANT[mi]
  const plantLayer = PLANT_SVG[mi](month)

  let overlay = ''
  if (kind === 'ko') {
    overlay = (KO_OVERLAYS[motif] ?? (() => ''))()
  } else if (kind === 'tane') {
    overlay = (TANE_OVERLAYS[motif] ?? (() => ''))()
  } else if (kind === 'tan' && tanColor) {
    overlay = tanRect(tanColor)
  }

  return `<svg viewBox="0 0 70 106" xmlns="http://www.w3.org/2000/svg" style="position:absolute;inset:0;width:100%;height:100%">
    ${plantLayer}
    ${overlay}
    <text x="5" y="10" font-size="7" fill="${SA}" font-family="Georgia,serif" letter-spacing="0.5">${code}</text>
    <text x="5" y="20" font-size="7.5" fill="${S}" font-family="serif">${plant}</text>
  </svg>`
}
