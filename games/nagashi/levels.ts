// 流灯 — レベルデータ（12夜）
// 座標は正規化 0..1、y 下向き。

export type Level = {
  name: string
  inkSeconds: number
  sources: { x: number; y: number; color: 'aka' | 'ao' }[]
  lanterns: { x: number; y: number; need: 'aka' | 'ao' | 'murasaki' | 'shiro' }[]
  rocks?: { x: number; y: number; r: number }[]
  vents?: { x: number; y: number; dx: number; dy: number }[]
  current?: { dx: number; dy: number }
  moonbeams?: { x: number; y: number; w: number; h: number }[]
  hint: string
}

export const LEVELS: Level[] = [
  {
    name: '一夜「はじまり」',
    inkSeconds: 30,
    sources: [{ x: 0.5, y: 0.06, color: 'aka' }],
    lanterns: [{ x: 0.5, y: 0.84, need: 'aka' }],
    hint: '指でなぞると、水が流れる。灯りを下の灯籠へ',
  },
  {
    name: '二夜「ふたて」',
    inkSeconds: 28,
    sources: [{ x: 0.5, y: 0.06, color: 'aka' }],
    lanterns: [
      { x: 0.2, y: 0.82, need: 'aka' },
      { x: 0.8, y: 0.82, need: 'aka' },
    ],
    hint: 'ひとつの流れを、ふたつに分ける',
  },
  {
    name: '三夜「いわ」',
    inkSeconds: 26,
    sources: [{ x: 0.18, y: 0.06, color: 'aka' }],
    lanterns: [{ x: 0.82, y: 0.84, need: 'aka' }],
    rocks: [
      { x: 0.35, y: 0.45, r: 0.09 },
      { x: 0.62, y: 0.42, r: 0.1 },
      { x: 0.88, y: 0.46, r: 0.08 },
    ],
    hint: '岩のすきまを、くぐらせる',
  },
  {
    name: '四夜「ふきだし」',
    inkSeconds: 24,
    sources: [{ x: 0.5, y: 0.06, color: 'aka' }],
    lanterns: [{ x: 0.5, y: 0.86, need: 'aka' }],
    vents: [{ x: 0.5, y: 0.55, dx: 0, dy: -220 }],
    hint: '噴き上げに、正面から挑まない',
  },
  {
    name: '五夜「いろわけ」',
    inkSeconds: 24,
    sources: [
      { x: 0.2, y: 0.06, color: 'aka' },
      { x: 0.8, y: 0.06, color: 'ao' },
    ],
    lanterns: [
      { x: 0.2, y: 0.84, need: 'ao' },
      { x: 0.8, y: 0.84, need: 'aka' },
    ],
    hint: 'ふたすじの灯り、行き先は逆',
  },
  {
    name: '六夜「まざりび」',
    inkSeconds: 22,
    sources: [
      { x: 0.22, y: 0.06, color: 'aka' },
      { x: 0.78, y: 0.06, color: 'ao' },
    ],
    lanterns: [{ x: 0.5, y: 0.85, need: 'murasaki' }],
    hint: '赤と青、水のなかで混ぜる',
  },
  {
    name: '七夜「よこかぜ」',
    inkSeconds: 20,
    sources: [{ x: 0.5, y: 0.06, color: 'ao' }],
    lanterns: [{ x: 0.16, y: 0.84, need: 'ao' }],
    rocks: [{ x: 0.5, y: 0.55, r: 0.09 }],
    current: { dx: 90, dy: 0 },
    hint: '横かぜに、さからって',
  },
  {
    name: '八夜「まつり」',
    inkSeconds: 20,
    sources: [
      { x: 0.15, y: 0.06, color: 'aka' },
      { x: 0.85, y: 0.06, color: 'ao' },
    ],
    lanterns: [
      { x: 0.14, y: 0.86, need: 'ao' },
      { x: 0.86, y: 0.86, need: 'aka' },
      { x: 0.5, y: 0.88, need: 'murasaki' },
    ],
    rocks: [{ x: 0.5, y: 0.5, r: 0.11 }],
    vents: [{ x: 0.28, y: 0.62, dx: 0, dy: -150 }],
    hint: 'すべての灯りを、ともせ',
  },
  {
    name: '九夜「しろいはな」',
    inkSeconds: 20,
    sources: [
      { x: 0.3, y: 0.06, color: 'aka' },
      { x: 0.7, y: 0.06, color: 'ao' },
    ],
    lanterns: [
      { x: 0.24, y: 0.85, need: 'shiro' },
      { x: 0.76, y: 0.85, need: 'murasaki' },
    ],
    hint: '白灯籠は、まじりけを嫌う',
  },
  {
    name: '十夜「つきのみち」',
    inkSeconds: 20,
    sources: [{ x: 0.5, y: 0.06, color: 'aka' }],
    lanterns: [{ x: 0.5, y: 0.86, need: 'aka' }],
    moonbeams: [{ x: 0.38, y: 0.35, w: 0.24, h: 0.3 }],
    hint: '月のひかりは、墨を溶かす',
  },
  {
    name: '十一夜「きよめ」',
    inkSeconds: 18,
    sources: [
      { x: 0.2, y: 0.06, color: 'aka' },
      { x: 0.8, y: 0.06, color: 'ao' },
    ],
    lanterns: [
      { x: 0.5, y: 0.85, need: 'shiro' },
      { x: 0.14, y: 0.8, need: 'aka' },
      { x: 0.86, y: 0.8, need: 'ao' },
    ],
    rocks: [{ x: 0.5, y: 0.45, r: 0.09 }],
    hint: 'まぜずに、そそげ',
  },
  {
    name: '十二夜「みずうみのまつり」',
    inkSeconds: 18,
    sources: [
      { x: 0.15, y: 0.06, color: 'aka' },
      { x: 0.85, y: 0.06, color: 'ao' },
    ],
    lanterns: [
      { x: 0.12, y: 0.86, need: 'ao' },
      { x: 0.88, y: 0.86, need: 'aka' },
      { x: 0.38, y: 0.88, need: 'murasaki' },
      { x: 0.62, y: 0.88, need: 'shiro' },
    ],
    rocks: [{ x: 0.5, y: 0.42, r: 0.1 }],
    vents: [{ x: 0.7, y: 0.6, dx: 0, dy: -140 }],
    moonbeams: [{ x: 0.44, y: 0.55, w: 0.12, h: 0.22 }],
    hint: 'すべての夜の、しめくくり',
  },
]
