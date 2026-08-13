// 強化20種（ROGUE.md §4）。強化＝フックの束。数値ではなく盤面の因果（生成・変換・起動）で表現する。
import type { Piece } from './types'
import type { Hook, HookCtx } from './hooks'

export interface UpgradeDef {
  id: string
  name: string
  /** 本体効果のみを述べる短い1文（取得時の合成文にしない。プレイテスト指摘で第4波にて分離） */
  desc: string
  /**
   * スターターの「おまけ」を示す短い1文。starter を持つ強化にのみ設定する。
   * ビュー側は desc とは別の見た目（付記扱い）で描く。
   */
  starterDesc?: string
  hooks: Hook[]
  /**
   * スターター効果（ROGUE2.md §1 原則2）：強化を取得した瞬間に盤面へ即座に作用させる処理。
   * board.ts が Board 構築（＝次の層開始）のたび、まだ発火していない取得済み強化についてこれを1回だけ呼ぶ
   * （RunState.startersApplied で管理）。
   *
   * 第4波でプレイテスト指摘（「スターターを全部に付けるのはやり過ぎ」「メインは本体効果、スターターはおまけ」）
   * を受けて方針転換：starter は「本体効果の発動条件となる盤面要素（胞子/爆発鉱石/特殊駒等）が無いと
   * 機能しない」条件付き強化にのみ付ける（8種）。それ以外の強化は本体効果だけで単体成立するため starter は無い。
   * 予熱(PREHEAT_ID)も「毎層開始時に供給」がそのまま初回にも効くため例外として starter を持たない（board.ts側で処理）。
   */
  starter?: (ctx: HookCtx) => void
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
// バランス再設計（プレイテスト反省）：board.ts が RunState.progress を更新する際に使うID/しきい値の定数。
// ギア起動系の「N回で発動」はゲージ(gearCharge)を全強化で共有しているため、しきい値を1箇所に集約する。
export const AUTONOMOUS_MECHANISM_ID = 'autonomous-mechanism'
export const MECHANICAL_GARDEN_ID = 'mechanical-garden'
export const RELIC_RESONANCE_ID = 'relic-resonance'
export const GEAR_TRIGGER_THRESHOLD = 2 // 旧3回→2回（通常プレイで頻繁に発火させるため）

export const UPGRADES: UpgradeDef[] = [
  // ---- 植物（4）----
  {
    id: 'spore-bloom',
    name: '胞子繁殖',
    desc: '植物を3つ以上消すと、胞子が2つ生まれる',
    hooks: [
      {
        on: 'match',
        system: 'plant',
        minSize: 3,
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
    desc: '胞子が敵のとなりで消えると、その敵に3ダメージ',
    starterDesc: 'おまけ: 胞子を2つ置く',
    hooks: [{ on: 'sporeTouch', act: (_spore, neighbor, ctx) => ctx.damageEnemy(neighbor, 3) }],
    starter: (ctx) => {
      for (let i = 0; i < 2; i++) {
        const spot = ctx.randomCell((c) => !c.block && !c.sporeToken)
        if (spot) ctx.spawnToken(spot, 'spore')
      }
    },
  },
  {
    id: 'deep-breath',
    name: '深呼吸',
    desc: 'キノコを消すと、盤面のどれか1つが植物に変わる',
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
    desc: '胞子が鉱物にふれると、その鉱物が爆発鉱石になる',
    starterDesc: 'おまけ: 胞子を2つ置く',
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
    starter: (ctx) => {
      for (let i = 0; i < 2; i++) {
        const spot = ctx.randomCell((c) => !c.block && !c.sporeToken)
        if (spot) ctx.spawnToken(spot, 'spore')
      }
    },
  },
  {
    id: RESONANT_SHATTER_ID,
    name: '共振破砕',
    desc: '爆発鉱石の爆発が十字から3×3に広がる',
    starterDesc: 'おまけ: 爆発鉱石を2つ作る',
    // 半径は「定数の変更」であり on:match/destroy/... のどれにも当たらないため、
    // board.ts が run.upgrades を直接参照して適用する（フック無し。理由は最終報告）。
    hooks: [],
    starter: (ctx) => {
      for (let i = 0; i < 2; i++) {
        const ore = ctx.randomCell((c) => c.piece?.kind === 'normal' && c.piece.color === 2 && !c.piece.volatile)
        if (ore) ctx.transform(ore, { kind: 'normal', color: 2, volatile: true })
      }
    },
  },
  {
    id: 'mining-habit',
    name: '採掘慣れ',
    desc: '鉱物マッチが敵の甲殻と岩に追加2ダメージ',
    hooks: [{ on: 'match', system: 'mineral', act: (_g, ctx) => ctx.damageEnemy('nearest', 2) }],
  },
  {
    id: 'crystal-bud',
    name: '結晶の芽',
    desc: '鉱物を4つ以上消すと、爆発鉱石が1つ降ってくる',
    hooks: [
      {
        on: 'match',
        system: 'mineral',
        minSize: 4,
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
    desc: '爆発にギアが巻きこまれると消えずに充填され、次のギアマッチが2倍になる',
    starterDesc: 'おまけ: 爆発鉱石とギアを置く',
    hooks: [
      {
        on: 'destroy',
        act: (at, cause, piece, ctx) => {
          if (cause === 'explode' && piece.kind === 'normal' && piece.color === 0) ctx.chargeGear(at)
        },
      },
    ],
    starter: (ctx) => {
      const ore = ctx.randomCell((c) => !c.block && !c.piece)
      if (ore) {
        ctx.spawnPiece(ore, 2)
        ctx.transform(ore, { kind: 'normal', color: 2, volatile: true })
      }
      const gear = ctx.randomCell((c) => !c.block && !c.piece)
      if (gear) ctx.spawnPiece(gear, 0)
    },
  },
  {
    id: AUTONOMOUS_MECHANISM_ID,
    name: '自律機構',
    desc: 'ギアが2回起動するたび、特殊駒が1つ生まれる',
    hooks: [
      {
        on: 'gearTrigger',
        act: (_at, count, ctx) => {
          if (count % GEAR_TRIGGER_THRESHOLD !== 0) return
          const spot = ctx.randomCell((c) => c.piece?.kind === 'normal')
          if (spot) ctx.convertSpecial(spot, randomSpecial(ctx.rng()))
        },
      },
    ],
  },
  {
    id: 'overrev',
    name: '過回転',
    desc: 'ギアマッチが連鎖を1段のばす',
    hooks: [{ on: 'match', system: 'gear', act: (_g, ctx) => ctx.bumpChain(1) }],
  },
  {
    id: PREHEAT_ID,
    name: '予熱',
    desc: '層のはじめにギアが3つ増える',
    // 層開始はフック発火点が無い（Board構築＝層開始の瞬間）ため、board.ts が直接処理する（理由は最終報告）。
    // 「毎層開始時に供給」がそのまま取得直後の層開始にも効くため starter は不要（applyPreheatがupgrade-fireも出す）。
    hooks: [],
  },
  // ---- 遺物（4）----
  {
    id: RELIC_RESONANCE_ID,
    name: '遺物共鳴',
    desc: 'ギア起動でとなりの遺物が光り、次の遺物マッチが2倍になる',
    starterDesc: 'おまけ: 最初の1回を2倍にしておく',
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
    starter: (ctx) => ctx.boostNextRelic(),
  },
  {
    id: MIMIC_SLIME_ID,
    name: '模倣の粘菌',
    desc: '遺物を3つ以上消すと、直前の強化か特殊駒の効果がもう一度おきる',
    starterDesc: 'おまけ: 遺物を2つ置く',
    hooks: [{ on: 'match', system: 'relic', minSize: 3, act: (_g, ctx) => ctx.replayLast() }],
    starter: (ctx) => {
      for (let i = 0; i < 2; i++) {
        const spot = ctx.randomCell((c) => !c.block && !c.piece)
        if (spot) ctx.spawnPiece(spot, 3)
      }
    },
  },
  {
    id: 'transformation-furnace',
    name: '変換炉',
    desc: '遺物マッチのとき、となりの駒1つが盤面で最も多い色に変わる',
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
    desc: '遺物マッチのたび、半々で特殊駒か邪魔ピースが生まれる',
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
    desc: '植物4つ消しのレンチ銛が、通った道を植物に変える',
    starterDesc: 'おまけ: レンチ銛を1つ作る',
    // 発動は「銛が実際に発射された瞬間」に依存し、5種のフック種別に無いため board.ts の fireSpecial 内で直接処理する（理由は最終報告）。
    hooks: [],
    starter: (ctx) => {
      const spot = ctx.randomCell((c) => c.piece?.kind === 'normal')
      if (spot) ctx.convertSpecial(spot, { kind: 'harpoon', dir: ctx.rng() < 0.5 ? 'h' : 'v', origin: 'plant' })
    },
  },
  {
    id: SPORE_BULLET_ID,
    name: '胞子弾',
    desc: '爆発のあとに胞子が1つ残る',
    // 第5波で再設計：胞子に基礎効果が付いたため単体で無価値ではなくなり、スターターは不要（削除）。
    // 発動元は歯車爆弾（board.ts の fireSpecial）と爆発鉱石の爆発（board.ts の explodeAt）の両方。
    // どちらも特殊駒発動・爆発そのものへの介入のため board.ts 側で直接処理する（理由は最終報告）。
    hooks: [],
  },
  {
    id: MECHANICAL_GARDEN_ID,
    name: '機械庭園',
    desc: 'ギアが2回起動するたび、植物が2つ生まれる',
    hooks: [
      {
        on: 'gearTrigger',
        act: (_at, count, ctx) => {
          if (count % GEAR_TRIGGER_THRESHOLD !== 0) return
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
    desc: '遺物マッチのたび、胞子が2つ生まれる',
    hooks: [
      {
        on: 'match',
        system: 'relic',
        act: (g, ctx) => {
          ctx.spawnToken(g.cells[0], 'spore')
          ctx.spawnToken(g.cells[g.cells.length - 1], 'spore')
        },
      },
    ],
  },
]
