// games/monkiri/levels.ts — 手本帖（12題）
// 手本は「折られた紙の上での切り方」を (r, t) で作図する。r=0..1 頂点→外周、t=-1..1 折り目間。
// |t|>1 は折り目をまたぐ穴（鏡映で完成する）、r>1 は外周を欠く切り方。
// 前半はガイド（下絵）つき＝なぞり切り、後半はガイドなし＝開いた紋から折りを逆算する。

import type { Cut, Pt } from './paper'

const P = (r: number, t: number): Pt => ({ r, t })

/** 弧なりの帯（r0..r1 × t0..t1）。輪・中心穴・外周欠きに。 */
function band(r0: number, r1: number, t0: number, t1: number, steps = 10): Cut {
  const pts: Pt[] = []
  for (let i = 0; i <= steps; i++) pts.push(P(r1, t0 + ((t1 - t0) * i) / steps))
  for (let i = steps; i >= 0; i--) pts.push(P(r0, t0 + ((t1 - t0) * i) / steps))
  return { pts }
}

/** 花びら（角丸ひし形の穴）。中心 (rc,tc)、半径方向 rr・角度方向 tt。 */
function petal(rc: number, tc: number, rr: number, tt: number): Cut {
  return { pts: [P(rc + rr, tc), P(rc, tc + tt), P(rc - rr, tc), P(rc, tc - tt)], smooth: true }
}

/** 直線多角形の穴。 */
function poly(...pts: Pt[]): Cut {
  return { pts }
}

/** なめらかな自由形の穴。 */
function blob(...pts: Pt[]): Cut {
  return { pts, smooth: true }
}

/** 切り込み線（切り離さない飾りスリット）。 */
function slit(...pts: Pt[]): Cut {
  return { pts, slit: true }
}

export type Level = {
  id: string
  /** 題名（ひらがな中心） */
  name: string
  /** 対称の基数（展開で 2N 枚） */
  N: number
  /** 下絵ガイドを紙に刷るか（前半=true） */
  guide: boolean
  cuts: Cut[]
  /** ガイドなし題の小さな助け舟 */
  hint?: string
}

export const FOLD_LABEL: Record<number, string> = {
  1: '二つ折り',
  2: '四つ折り',
  3: '六つ折り',
  4: '八つ折り',
}

export const LEVELS: Level[] = [
  // ── 一 ── まずは1切り。切る→落ちる→ひらくを覚える
  {
    id: 'futaba',
    name: 'ふたば',
    N: 1,
    guide: true,
    cuts: [petal(0.5, 0.5, 0.38, 0.4)],
  },
  // ── 二 ── 折り目をまたぐ穴＝鏡映で完成する形（猪目＝逆さの桃）
  {
    id: 'momo',
    name: 'もも',
    N: 1,
    guide: true,
    cuts: [blob(P(0.9, 1.15), P(0.74, 0.6), P(0.48, 0.42), P(0.18, 0.55), P(0.4, 1.15))],
  },
  // ── 三 ── 頂点を切る＝中心に穴。外周を欠く＝縁の飾り
  {
    id: 'mado',
    name: 'まど',
    N: 2,
    guide: true,
    cuts: [band(-0.1, 0.24, -1.3, 1.3), petal(1.04, 0, 0.14, 0.42)],
  },
  // ── 四 ── 花びら2種の組み合わせ
  {
    id: 'hanabishi',
    name: 'はなびし',
    N: 2,
    guide: true,
    cuts: [petal(0.58, 0, 0.3, 0.55), petal(0.32, 1.0, 0.1, 0.32)],
  },
  // ── 五 ── ガイドなし入門：輪はブリッジがないと落ちる、を体で知る
  {
    id: 'shima',
    name: 'しま',
    N: 2,
    guide: false,
    cuts: [band(0.34, 0.46, -0.65, 0.65), band(0.62, 0.74, -0.65, 0.65)],
    hint: 'わは、つなぎをのこす。',
  },
  // ── 六 ── 雪輪。切らずに残した「つなぎ」が模様になる
  {
    id: 'yukiwa',
    name: 'ゆきわ',
    N: 3,
    guide: true,
    cuts: [band(-0.1, 0.16, -1.3, 1.3), band(0.52, 0.7, -0.72, 0.72), petal(1.05, 0, 0.13, 0.5)],
  },
  // ── 七 ── 六弁の花
  {
    id: 'hana',
    name: 'はな',
    N: 3,
    guide: true,
    cuts: [band(-0.1, 0.13, -1.3, 1.3), petal(0.6, 0, 0.28, 0.6), petal(0.3, 1.0, 0.1, 0.42)],
  },
  // ── 八 ── ガイドなし：一刀で星。頂点側に深く切り込む
  {
    id: 'hoshi',
    name: 'ほし',
    N: 3,
    guide: false,
    cuts: [poly(P(1.1, -0.95), P(0.52, 0), P(1.1, 0.95))],
    hint: 'そとから、ふかく、そとへ。',
  },
  // ── 九 ── ガイドなし：折り目の上の花びらは「半分だけ切る」
  {
    id: 'kikyou',
    name: 'ききょう',
    N: 3,
    guide: false,
    cuts: [band(-0.1, 0.22, -1.3, 1.3), petal(0.6, 1.0, 0.32, 0.7), petal(1.06, 0, 0.2, 0.55)],
    hint: 'おりめのはなは、はんぶんだけ。',
  },
  // ── 十 ── 八つ折りの菊。細かさとの勝負
  {
    id: 'kiku',
    name: 'きく',
    N: 4,
    guide: true,
    cuts: [band(-0.1, 0.14, -1.3, 1.3), petal(0.48, 0, 0.16, 0.55), petal(0.8, 1.0, 0.16, 0.55), petal(1.05, 0, 0.1, 0.5)],
  },
  // ── 十一 ── 雪華。スリット（飾り切り）の初出題
  {
    id: 'sekka',
    name: 'せっか',
    N: 4,
    guide: false,
    cuts: [band(-0.1, 0.1, -1.3, 1.3), slit(P(0.26, 0), P(0.78, 0)), petal(0.94, 0, 0.1, 0.42), petal(0.42, 1.0, 0.12, 0.5)],
    hint: 'きりこみだけなら、おちない。',
  },
  // ── 十二 ── 大紋。全部のせ
  {
    id: 'oomon',
    name: 'おおもん',
    N: 4,
    guide: false,
    cuts: [
      band(-0.1, 0.12, -1.3, 1.3),
      petal(0.6, 0, 0.26, 0.5),
      petal(0.34, 1.0, 0.11, 0.55),
      petal(0.88, 1.0, 0.1, 0.4),
      slit(P(0.74, 0.5), P(1.02, 0.72)),
    ],
    hint: 'おおきいはなから、じゅんに。',
  },
]
