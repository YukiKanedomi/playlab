// 強化20種（ROGUE.md §4）。強化＝フックの束。数値ではなく盤面の因果（生成・変換・起動）で表現する。
import type { Piece } from './types'
import type { Hook, HookCtx } from './hooks'

/**
 * 因果グラフの資源語彙（夜間監査[B][C]5）。各強化の consumes/produces はこの語彙だけを使う。
 * 「何を消費して発火するか」「何を新しく供給するか」を絞った少数の資源で表す。語彙を増やしすぎると
 * 個々の強化がほぼ全て孤立ノードになり、因果グラフとして機能しなくなるため意図的に少数に絞っている。
 */
export const RESOURCES = ['spore', 'volatile-ore', 'gear-trigger', 'special', 'plant', 'relic-match', 'enemy-damage'] as const
export type Resource = (typeof RESOURCES)[number]

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
   * 因果グラフのデータ化（夜間監査[B][C]5）：この強化が盤面から「何を消費して発火するか」「何を新しく供給するか」を
   * 正式なデータとして持たせる。手作業のタグ付けであり厳密な検証はしていない（実挙動から見た近似表。詳細は最終報告）。
   * UI側（main.ts）が抽選・接続表示の両方でこれを読む想定。ここではデータの提供までを担う（配線はmain.ts側の担当）。
   * 未指定＝そのフェーズでは何も consumes/produces しない（例：予熱は盤面材料を供給するだけで語彙の資源は動かさない）。
   */
  consumes?: Resource[]
  produces?: Resource[]
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
export const MAGNETIC_MINING_ID = 'magnetic-mining'
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
    consumes: ['plant'],
    produces: ['spore'],
  },
  {
    id: 'fungal-awakening',
    name: '菌糸の目覚め',
    desc: '植物マッチ時、マッチ跡地の近くに植物が生える（マッチが繋がる位置を優先。列詰め前に発生）',
    hooks: [
      {
        on: 'match',
        system: 'plant',
        act: (g, ctx) => {
          // 夜間監査[D]6：以前は「マッチ跡地の隣接1マス」を機械的に選んでおり、そのマス自体が跡地の一部
          // （＝直後に自然充填で埋まる無駄なマス）になりがちで新しいマッチにほぼ繋がらなかった。
          // growthSpotで「跡地の近く・かつマッチが即成立する外部の空きセル」を優先する。
          const spot = ctx.growthSpot(g.cells, g.color)
          if (spot) ctx.spawnPiece(spot, g.color)
        },
      },
    ],
    consumes: ['plant'],
    produces: ['plant'],
  },
  {
    id: 'toxic-spore',
    name: '毒胞子',
    desc: '胞子が原生種のとなりで消えると、その原生種に3ダメージ',
    starterDesc: 'おまけ: 原生種のとなりに胞子を1つ置く',
    hooks: [{ on: 'sporeTouch', act: (_spore, neighbor, ctx) => ctx.damageEnemy(neighbor, 3) }],
    consumes: ['spore'],
    produces: ['enemy-damage'],
    // スターター配置（夜間監査[C]10）：ランダムな空きマスではなく、本体がすぐ試せる「敵のとなり」を狙う。
    // 敵隣接マスが見つからない（層に敵が居ない等）場合のみ、従来どおりランダムな空きマスへ後退する。
    starter: (ctx) => {
      const spot =
        ctx.randomCell((c, p) => !c.block && !c.sporeToken && ctx.neighborsOf(p).some((n) => ctx.at(n.x, n.y)?.block?.type === 'enemy')) ??
        ctx.randomCell((c) => !c.block && !c.sporeToken)
      if (spot) ctx.spawnToken(spot, 'spore')
    },
  },
  {
    id: 'deep-breath',
    name: '深呼吸',
    desc: 'キノコを消すと、跡地の近くの1つが植物に変わる（マッチが繋がる位置を優先）',
    hooks: [
      {
        on: 'match',
        color: 4,
        act: (g, ctx) => {
          // 夜間監査[D]6：以前は盤面全体から完全ランダムな駒を選んでおり、周囲の色と無関係でマッチに繋がらなかった。
          const color = ctx.rng() < 0.5 ? 1 : 4
          const target = ctx.transformSpot(g.cells, color)
          if (target) ctx.transform(target, { kind: 'normal', color })
        },
      },
    ],
    consumes: ['plant'],
    produces: ['plant'],
  },
  // ---- 鉱物（4）----
  {
    id: 'root-eating-ore',
    name: '根食い鉱',
    desc: '胞子が鉱物にふれると、その鉱物が爆発鉱石になる',
    starterDesc: 'おまけ: 鉱物のとなりに胞子を1つ置く',
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
    consumes: ['spore'],
    produces: ['volatile-ore'],
    // スターター配置（夜間監査[C]10）：ランダムな空きマスではなく、本体がすぐ試せる「鉱物のとなり」を狙う。
    // 隣接可能な鉱物が無い場合のみ、従来どおりランダムな空きマスへ後退する。
    starter: (ctx) => {
      const spot =
        ctx.randomCell((c, p) => {
          if (c.block || c.sporeToken) return false
          return ctx.neighborsOf(p).some((n) => {
            const np = ctx.at(n.x, n.y)?.piece
            return np?.kind === 'normal' && np.color === 2 && !np.volatile
          })
        }) ?? ctx.randomCell((c) => !c.block && !c.sporeToken)
      if (spot) ctx.spawnToken(spot, 'spore')
    },
  },
  {
    id: RESONANT_SHATTER_ID,
    name: '共振破砕',
    desc: '爆発鉱石の爆発が十字から3×3に広がる',
    starterDesc: 'おまけ: 爆発鉱石を1つ作る',
    // 半径は「定数の変更」であり on:match/destroy/... のどれにも当たらないため、
    // board.ts が run.upgrades を直接参照して適用する（フック無し。理由は最終報告）。
    hooks: [],
    consumes: ['volatile-ore'],
    produces: [],
    starter: (ctx) => {
      const ore = ctx.randomCell((c) => c.piece?.kind === 'normal' && c.piece.color === 2 && !c.piece.volatile)
      if (ore) ctx.transform(ore, { kind: 'normal', color: 2, volatile: true })
    },
  },
  {
    id: 'mining-habit',
    name: '採掘慣れ',
    // 夜間監査[C]6：説明は「敵の甲殻と岩に追加2ダメージ」だったが、実装は全鉱物マッチで最寄りの任意敵へ2ダメージ。
    // 専用API（甲殻/岩ブロック限定）を新設するのは過剰実装のため、実装に文を合わせる（小さく直す）。
    desc: '鉱物をそろえて消すと、最寄りの原生種に2ダメージ',
    hooks: [{ on: 'match', system: 'mineral', act: (_g, ctx) => ctx.damageEnemy('nearest', 2) }],
    consumes: [],
    produces: ['enemy-damage'],
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
        act: (g, ctx) => {
          // 夜間監査[D]6：以前は完全ランダムな空きマスへ生成しており、周囲の色と無関係でマッチに繋がらなかった。
          const spot = ctx.growthSpot(g.cells, 2)
          if (spot) {
            ctx.spawnPiece(spot, 2)
            ctx.transform(spot, { kind: 'normal', color: 2, volatile: true })
          }
        },
      },
    ],
    consumes: [],
    produces: ['volatile-ore'],
  },
  // ---- ギア（4）----
  {
    id: MAGNETIC_MINING_ID,
    name: '磁気採掘',
    desc: '爆発にギアが巻きこまれると消えずに充填され、次のギアマッチが2倍になる',
    starterDesc: 'おまけ: 充填済みギアを1つ置く',
    // 夜間監査[C]2：破壊(destroy)フックは駒が既に盤面から消えた後にしか発火しないため、
    // 「破壊をキャンセルして残す」処理はdestroyフックでは書けない。爆発そのものへの介入（explodeAt側での
    // 破壊前チェック）が必要なため、board.ts が run.upgrades を直接見て処理する（他の直接処理組と同じ理由）。
    hooks: [],
    consumes: ['volatile-ore', 'gear-trigger'],
    produces: ['gear-trigger'],
    // スターター配置：Board構築直後は fillInitial() が全マスへ駒を敷き詰めた直後で「空きマス」が存在しない
    // （旧実装は !c.block && !c.piece を探しており、常に見つからず無発火だった＝夜間監査で見つかった副次的な
    // 不具合。ここで直す）。既存の通常駒1つをギアへ変換し、その場で充填状態にする。
    starter: (ctx) => {
      const spot = ctx.randomCell((c) => c.piece?.kind === 'normal')
      if (spot) {
        ctx.transform(spot, { kind: 'normal', color: 0 })
        ctx.chargeGear(spot)
      }
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
    consumes: ['gear-trigger'],
    produces: ['special'],
  },
  {
    id: 'overrev',
    name: '過回転',
    // 夜間監査[C]4：旧実装は self.chain += 1 で連鎖数の数字を増やすだけで盤面を動かさなかった
    // （「数値より挙動」に反する）。盤面上で最も遠いギア駒1個を実際に起動する挙動へ置換する。
    // これで自律機構／機械庭園への実際の因果辺になる。記録の最大連鎖はこれにより自然な再マッチのみを数える
    // （強化で数字だけ足す経路が無くなった）。
    desc: 'ギアをそろえて消すと、最も遠いギア1つを起動する',
    hooks: [{ on: 'match', system: 'gear', act: (g, ctx) => ctx.triggerFarGear(g.cells[0]) }],
    consumes: [],
    produces: ['gear-trigger'],
  },
  {
    id: PREHEAT_ID,
    name: '予熱',
    desc: '層のはじめにギアが3つ増える',
    // 層開始はフック発火点が無い（Board構築＝層開始の瞬間）ため、board.ts が直接処理する（理由は最終報告）。
    // 「毎層開始時に供給」がそのまま取得直後の層開始にも効くため starter は不要（applyPreheatがupgrade-fireも出す）。
    hooks: [],
    consumes: [],
    produces: [],
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
    consumes: ['gear-trigger'],
    produces: ['relic-match'],
    starter: (ctx) => ctx.boostNextRelic(),
  },
  {
    id: MIMIC_SLIME_ID,
    name: '模倣の粘菌',
    desc: '遺物を3つ以上消すと、直前の知見か特殊駒の効果がもう一度おきる',
    starterDesc: 'おまけ: 遺物を1つ置く',
    hooks: [{ on: 'match', system: 'relic', minSize: 3, act: (_g, ctx) => ctx.replayLast() }],
    consumes: ['relic-match'],
    produces: [],
    // スターター配置：磁気採掘と同じ理由（fillInitial()直後は空きマスが存在せず旧実装は無発火だった）で、
    // 既存の通常駒1つを遺物へ変換する方式に直す。
    starter: (ctx) => {
      const spot = ctx.randomCell((c) => c.piece?.kind === 'normal')
      if (spot) ctx.transform(spot, { kind: 'normal', color: 3 })
    },
  },
  {
    id: 'transformation-furnace',
    name: '変換炉',
    desc: '遺物マッチのとき、跡地の近くの駒1つが盤面で最も多い色に変わる（マッチが繋がる位置を優先）',
    hooks: [
      {
        on: 'match',
        system: 'relic',
        // 夜間監査[C]3：「2倍」の消費は fireMatchHooks 側（遺物マッチの入口）に一元化した。
        // このactは常に「1回ぶんの変換」だけを行い、2倍のときは fireMatchHooks がこのact自体を2回呼ぶ。
        // 夜間監査[D]6：以前は「マッチ跡地の隣接1マスのうち最初に見つかった通常駒」を機械的に選んでおり、
        // マッチ形成と無関係だった。transformSpotで「跡地の近く・かつマッチが即成立する駒」を優先する。
        act: (g, ctx) => {
          const major = ctx.mostCommonColor()
          if (major === null) return
          const target = ctx.transformSpot(g.cells, major)
          if (target) ctx.transform(target, { kind: 'normal', color: major })
        },
      },
    ],
    consumes: ['relic-match'],
    produces: [],
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
    consumes: ['relic-match'],
    produces: ['special'],
  },
  // ---- 異種シナジー（4）----
  {
    id: VINE_ROCKET_ID,
    name: '蔓ロケット',
    desc: '植物4つ消しのレンチ銛が、通った道を植物に変える',
    starterDesc: 'おまけ: レンチ銛を1つ作る',
    // 発動は「銛が実際に発射された瞬間」に依存し、5種のフック種別に無いため board.ts の fireSpecial 内で直接処理する（理由は最終報告）。
    hooks: [],
    consumes: ['plant'],
    produces: ['plant'],
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
    consumes: ['volatile-ore', 'special'],
    produces: ['spore'],
  },
  {
    id: MECHANICAL_GARDEN_ID,
    name: '機械庭園',
    desc: 'ギアが2回起動するたび、植物が2つ生まれる',
    hooks: [
      {
        on: 'gearTrigger',
        act: (at, count, ctx) => {
          if (count % GEAR_TRIGGER_THRESHOLD !== 0) return
          // 夜間監査[D]6：以前は完全ランダムな空きマスへ生成しており、周囲の色と無関係でマッチに繋がらなかった。
          for (let i = 0; i < 2; i++) {
            const color = i === 0 ? 1 : 4
            const spot = ctx.growthSpot([at], color)
            if (spot) ctx.spawnPiece(spot, color)
          }
        },
      },
    ],
    consumes: ['gear-trigger'],
    produces: ['plant'],
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
    consumes: ['relic-match'],
    produces: ['spore'],
  },
]
