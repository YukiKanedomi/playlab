// 強化20種（ROGUE.md §4）。強化＝フックの束。数値ではなく盤面の因果（生成・変換・起動）で表現する。
import type { Piece } from './types'
import type { Hook } from './hooks'

export interface UpgradeDef {
  id: string
  name: string
  desc: string
  hooks: Hook[]
}

/** #10/#16 が使うランダム特殊駒（既定分布は横銛/縦銛/羽虫/火壺/星珠を等確率） */
function randomSpecial(r: number): Piece {
  const table: Piece[] = [
    { kind: 'harpoon', dir: 'h' },
    { kind: 'harpoon', dir: 'v' },
    { kind: 'hamushi' },
    { kind: 'hitsubo' },
    { kind: 'seiju' },
  ]
  return table[Math.min(table.length - 1, Math.floor(r * table.length))]
}

/** #6 共振破砕・#12 予熱・#17 蔓ロケット・#18 胞子弾 が参照するID定数（board.ts 側で直接判定する例外組。理由は最終報告） */
export const RESONANT_SHATTER_ID = 'resonant-shatter'
export const PREHEAT_ID = 'preheat'
export const VINE_ROCKET_ID = 'vine-rocket'
export const SPORE_BULLET_ID = 'spore-bullet'
export const MIMIC_SLIME_ID = 'mimic-slime'

export const UPGRADES: UpgradeDef[] = [
  // ---- 植物（4）----
  {
    id: 'spore-bloom',
    name: '胞子繁殖',
    desc: '植物を4個以上で消すと、消滅域の端に胞子を2個生成',
    hooks: [
      {
        on: 'match',
        system: 'plant',
        minSize: 4,
        act: (g, ctx) => {
          ctx.spawnToken(g.cells[0], 'spore')
          ctx.spawnToken(g.cells[g.cells.length - 1], 'spore')
        },
      },
    ],
  },
  {
    id: 'fungal-awakening',
    name: '菌糸の目覚め',
    desc: '植物マッチ時、隣接する空きセル1つに植物が生える（列詰め前に発生）',
    hooks: [
      {
        on: 'match',
        system: 'plant',
        act: (g, ctx) => {
          for (const p of g.cells) {
            const empty = ctx.neighborsOf(p).find((n) => {
              const c = ctx.at(n.x, n.y)
              return c && !c.block && !c.piece
            })
            if (empty) {
              ctx.spawnPiece(empty, g.color)
              return
            }
          }
        },
      },
    ],
  },
  {
    id: 'toxic-spore',
    name: '毒胞子',
    desc: '胞子が敵に隣接して消費されると、その敵に3ダメージ',
    hooks: [{ on: 'sporeTouch', act: (_spore, neighbor, ctx) => ctx.damageEnemy(neighbor, 3) }],
  },
  {
    id: 'deep-breath',
    name: '深呼吸',
    desc: 'キノコを消すと、盤面のランダムな駒1つが植物に変わる',
    hooks: [
      {
        on: 'match',
        color: 4,
        act: (_g, ctx) => {
          const target = ctx.randomCell((c) => c.piece?.kind === 'normal')
          if (target) ctx.transform(target, { kind: 'normal', color: ctx.rng() < 0.5 ? 1 : 4 })
        },
      },
    ],
  },
  // ---- 鉱物（4）----
  {
    id: 'root-eating-ore',
    name: '根食い鉱',
    desc: '胞子が鉱物に触れると、その鉱物を爆発鉱石に変える',
    hooks: [
      {
        on: 'sporeTouch',
        act: (spore, _neighbor, ctx) => {
          const ore = ctx.neighborsOf(spore).find((n) => {
            const p = ctx.at(n.x, n.y)?.piece
            return p?.kind === 'normal' && p.color === 2 && !p.volatile
          })
          if (ore) ctx.transform(ore, { kind: 'normal', color: 2, volatile: true })
        },
      },
    ],
  },
  {
    id: RESONANT_SHATTER_ID,
    name: '共振破砕',
    desc: '爆発鉱石の爆発半径 +1（十字→3x3）',
    // 半径は「定数の変更」であり on:match/destroy/... のどれにも当たらないため、
    // board.ts が run.upgrades を直接参照して適用する（フック無し。理由は最終報告）。
    hooks: [],
  },
  {
    id: 'mining-habit',
    name: '採掘慣れ',
    desc: '鉱物マッチは敵の甲殻/岩盤に追加1ダメージ',
    hooks: [{ on: 'match', system: 'mineral', act: (_g, ctx) => ctx.damageEnemy('nearest', 1) }],
  },
  {
    id: 'crystal-bud',
    name: '結晶の芽',
    desc: '鉱物を5個以上で消すと、落下後に爆発鉱石1つを天井から供給',
    hooks: [
      {
        on: 'match',
        system: 'mineral',
        minSize: 5,
        act: (_g, ctx) => {
          const spot = ctx.randomCell((c) => !c.block && !c.piece)
          if (spot) {
            ctx.spawnPiece(spot, 2)
            ctx.transform(spot, { kind: 'normal', color: 2, volatile: true })
          }
        },
      },
    ],
  },
  // ---- ギア（4）----
  {
    id: 'magnetic-mining',
    name: '磁気採掘',
    desc: '爆発に巻き込まれた隣接ギアは消えず、チャージされる（次のギアマッチが2倍起動）',
    hooks: [
      {
        on: 'destroy',
        act: (at, cause, piece, ctx) => {
          if (cause === 'explode' && piece.kind === 'normal' && piece.color === 0) ctx.chargeGear(at)
        },
      },
    ],
  },
  {
    id: 'autonomous-mechanism',
    name: '自律機構',
    desc: 'ギアが3回起動するたび、ランダムな特殊駒を1つ生成',
    hooks: [
      {
        on: 'gearTrigger',
        act: (_at, count, ctx) => {
          if (count % 3 !== 0) return
          const spot = ctx.randomCell((c) => c.piece?.kind === 'normal')
          if (spot) ctx.convertSpecial(spot, randomSpecial(ctx.rng()))
        },
      },
    ],
  },
  {
    id: 'overrev',
    name: '過回転',
    desc: 'ギアマッチは連鎖カウントを+1する（連鎖ビート持続）',
    hooks: [{ on: 'match', system: 'gear', act: (_g, ctx) => ctx.bumpChain(1) }],
  },
  {
    id: PREHEAT_ID,
    name: '予熱',
    desc: '各層の開始時、盤面にギアを3つ追加供給',
    // 層開始はフック発火点が無い（Board構築＝層開始の瞬間）ため、board.ts が直接処理する（理由は最終報告）。
    hooks: [],
  },
  // ---- 遺物（4）----
  {
    id: 'relic-resonance',
    name: '遺物共鳴',
    desc: 'ギア起動時、隣接する遺物駒が光り、次の遺物マッチの効果が2倍',
    hooks: [
      {
        on: 'gearTrigger',
        act: (at, _count, ctx) => {
          const relic = ctx.neighborsOf(at).find((n) => {
            const p = ctx.at(n.x, n.y)?.piece
            return p?.kind === 'normal' && p.color === 3
          })
          if (relic) ctx.boostNextRelic()
        },
      },
    ],
  },
  {
    id: MIMIC_SLIME_ID,
    name: '模倣の粘菌',
    desc: '遺物を4個以上で消すと、直前に発動した強化効果をもう一度発動',
    hooks: [{ on: 'match', system: 'relic', minSize: 4, act: (_g, ctx) => ctx.replayLast() }],
  },
  {
    id: 'transformation-furnace',
    name: '変換炉',
    desc: '遺物マッチ時、隣接する駒を1つ選び同系統の駒に揃える（最多色へ）',
    hooks: [
      {
        on: 'match',
        system: 'relic',
        act: (g, ctx) => {
          const times = ctx.takeRelicBoost() || 1
          const major = ctx.mostCommonColor()
          if (major === null) return
          let done = 0
          for (const p of g.cells) {
            if (done >= times) break
            const target = ctx.neighborsOf(p).find((n) => ctx.at(n.x, n.y)?.piece?.kind === 'normal')
            if (target) {
              ctx.transform(target, { kind: 'normal', color: major })
              done++
            }
          }
        },
      },
    ],
  },
  {
    id: 'gamblers-pot',
    name: '賭博師の壺',
    desc: '遺物マッチ時、50%で特殊駒生成/50%で邪魔ピース1つ生成（ハイリスク）',
    hooks: [
      {
        on: 'match',
        system: 'relic',
        act: (g, ctx) => {
          if (ctx.rng() < 0.5) {
            const spot = ctx.randomCell((c) => c.piece?.kind === 'normal') ?? g.cells[0]
            ctx.convertSpecial(spot, randomSpecial(ctx.rng()))
          } else {
            const spot = ctx.randomCell((c) => !c.block && !!c.piece) ?? g.cells[0]
            ctx.addObstacle(spot)
          }
        },
      },
    ],
  },
  // ---- 異種シナジー（4）----
  {
    id: VINE_ROCKET_ID,
    name: '蔓ロケット',
    desc: '植物4個消しのレンチ銛は、通過マスの1割を植物に変える',
    // 発動は「銛が実際に発射された瞬間」に依存し、5種のフック種別に無いため board.ts の fireSpecial 内で直接処理する（理由は最終報告）。
    hooks: [],
  },
  {
    id: SPORE_BULLET_ID,
    name: '胞子弾',
    desc: '歯車爆弾の爆心に胞子を1つ残す',
    // 同上：特殊駒発動そのものへの介入のため board.ts の fireSpecial 内で直接処理する（理由は最終報告）。
    hooks: [],
  },
  {
    id: 'mechanical-garden',
    name: '機械庭園',
    desc: 'ギアが3回起動するたび、植物を2つ生成（自律機構と重複取得で循環完成）',
    hooks: [
      {
        on: 'gearTrigger',
        act: (_at, count, ctx) => {
          if (count % 3 !== 0) return
          for (let i = 0; i < 2; i++) {
            const spot = ctx.randomCell((c) => !c.block && !c.piece)
            if (spot) ctx.spawnPiece(spot, i === 0 ? 1 : 4)
          }
        },
      },
    ],
  },
  {
    id: 'relic-root',
    name: '遺物の根',
    desc: '遺物マッチ時、胞子を1つ生成',
    hooks: [{ on: 'match', system: 'relic', act: (g, ctx) => ctx.spawnToken(g.cells[0], 'spore') }],
  },
]
