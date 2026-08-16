// 盤面ビュー：エンジンのイベント列をタイムライン化して描く。
// 方針: ロジックは即時確定・ビューが追いかける。入力割込時は snap で追いつく。
// タイミングは RESEARCH.md §5 実測値。
import { Container, Graphics, Point, Sprite, Renderer, Text } from 'pixi.js'
import { Board, W, H } from '../core/board'
import type { ResolutionStep } from '../core/board'
import type { BoardEvent, EnemyKind, GoalType, Piece, XY } from '../core/types'
import { BOSS_SHELL_COUNT, enemyIntent, type EnemyInstance, type EnemyIntent, type IntentKind } from '../core/enemies'
import { UPGRADES } from '../core/upgrades'
import { PAL, pieceKey, pieceTexture, spriteTexture } from './pieces'
import {
  cancel,
  channelEndMany,
  completeChannel,
  compressChannel,
  delay,
  easeInCubic,
  easeInQuad,
  easeOutBack,
  easeOutBackSoft,
  easeOutCubic,
  hasTween,
  hasTweenProperty,
  now,
  scopeEnd,
  setTweenScope,
  snap,
  snapSoft,
  tween,
} from '../juice/tween'
import { sfx } from '../juice/sound'
import { buzz, resetMoveBudget } from '../juice/haptics'
import { setTweenCtx } from '../juice/tween'
import { DIAG, counters, dumpSprite, markPiece, opLog, recentOps, report, sidOf } from './diag'

// ローグ拡張（ROGUE.md §5）：ダメージ数字は既存UI（main.ts）と合わせ明朝体
const FONT = '"Shippori Mincho", serif'
// 敵ブロック・ボスの顔に HP バーの描画位置を焼き込むための拡張タグ（pieces.ts の __base 流儀に倣う）
type HpHost = Container & { __hpFill?: Graphics; __hpGeom?: { x: number; y: number; w: number; h: number } }
/** ボスの顔オーバーレイ。身体セル範囲＋段階を焼き込み、変化したら作り直す判定に使う */
type BossFaceHost = Container & { __bossSpan?: string }

// 可視化第一波②：強化発動アピールのラベルに使う名前引き（idはupgrades.tsのUpgradeDef.idと一致）
const UPGRADE_NAME = new Map(UPGRADES.map((u) => [u.id, u.name]))

// 可視化第二波：特殊駒「誕生イベント」の系統色＋回転量（codex_consult [D]-1）。星珠は虹色のためcolorは代表色のみ
const SPECIAL_BORN_STYLE: Record<string, { color: number; rotDeg: number }> = {
  harpoon: { color: 0xfff1c4, rotDeg: 10 },
  hamushi: { color: 0x9fd9ff, rotDeg: 15 },
  hitsubo: { color: 0xffc978, rotDeg: 8 },
  seiju: { color: 0xd7b5ec, rotDeg: 12 },
  default: { color: 0xf4ead0, rotDeg: 10 },
}

// タイムライン予算：25発以降のspecial-fireを集約表示する際の短い和名（main.tsのグロッサリー名を短縮）
const FIRE_KIND_NAME: Record<string, string> = { harpoon: '銛', hamushi: '羽虫', hitsubo: '火壺', seiju: '星珠' }

// 目標の種類ごとに「壊れて見える瞬間」までのオフセット(ms)と破片色（GoalType を増やしたら両テーブルに行を足すこと）
const GOAL_FX_DELAY: Record<GoalType, number> = { color: 90, system: 90, tsutagoke: 120, kokeishi: 120, touhen: 120, spore: 220, 'enemy-kill': 0 }
const GOAL_DEBRIS_COLOR: Record<GoalType, number> = {
  color: 0xf0e2bd, system: 0x8fb05a, tsutagoke: 0x8fb05a, kokeishi: PAL.stone, touhen: 0xe8e2d2, spore: 0xbfe8ff, 'enemy-kill': 0xe0a89c,
}
// toGlobal の出力先を使い回す（毎フレーム Point を作らない）
const GOAL_PT = new Point()

// juice 実測値テーブル（ms）
export const T = {
  swap: 150, // 成立スワップ（easeOutBackSoft で約5%行き過ぎて戻る）
  swapBackGo: 90, // 不成立スワップの行き（Codexレビュー#9：往復240msは「詰まった」感が強く160msへ短縮）
  swapBackReturn: 70, // 不成立スワップの戻り
  pop: 200, // 消滅ポップ 170-230
  blockHit: 300, // 箱破壊 270-330
  fall: 380, // 落下 330-430
  chainBeat: 650, // 連鎖ビート 600-800（互換保持・未参照。実際の連鎖テンポは CHAIN_BEAT）
  specialBorn: 240,
} as const

/** 連鎖ビート（ms・一定拍）。RM実測は~620ms一定・無加速（rm_tempo.md §3・§8 P1）。
 *  旧実装の加速カーブ（520→220ms）はRM実測により誤設計と確定し廃止（JUICE.md §0-5）。
 *  テンポ実験はこの定数1つを差し替えて試す（520/560/600/620 など） */
const CHAIN_BEAT = 600

/** タイムライン予算（codex_timeline_review.md §3・§4）：ここから先は「通常域」ではなく「暴走域」。
 *  1〜6連鎖はCHAIN_BEAT一定を守り、7連鎖以降だけ間隔を逓減させる（JUICE §0-5「加速ではなく要約」）。
 *  EXTREME_CHAIN_BEATSはchain=EXTREME_CHAIN_START以降のインデックス（0始まり、末尾でクランプ＝下限80ms）*/
const EXTREME_CHAIN_START = 7
const EXTREME_CHAIN_BEATS = [300, 200, 120, 80] as const

/** chainに対応する「前セグメントからの最短間隔」(ms)を返す純関数（検算・単体テストしやすいよう分離） */
export function chainBeatFor(chain: number): number {
  if (chain < EXTREME_CHAIN_START) return CHAIN_BEAT
  const idx = chain - EXTREME_CHAIN_START
  return EXTREME_CHAIN_BEATS[Math.min(idx, EXTREME_CHAIN_BEATS.length - 1)]
}

/** special-fire演出の表示品質の境界（play()全体を通した通し番号で判定。codex_timeline_review.md §2-A末尾）。
 *  1〜FIRE_FULL_LIMIT発＝通常品質、それ以降〜FIRE_SIMPLE_LIMIT発＝簡略FX、それ以降＝種類ごとに集約し
 *  FX/SE/振動をイベント毎には生成しない（popPieceAtによる盤面状態反映だけは常に維持する） */
const FIRE_FULL_LIMIT = 8
const FIRE_SIMPLE_LIMIT = 24
/** special-fireが1セグメント内の主時計(t)へ足せる上限(ms)。何十発起きても1つの連鎖セグメントが
 *  単独で異常に間延びしない（旧実装は1発ごとに無条件で+160msしており260発で41.6秒に達していた） */
const FIRE_SEGMENT_CAP = 320
/** special-fireが play() 全体を通して主時計(t)へ足せる合計の上限(ms)。セグメント上限だけだと、
 *  22連鎖のように「低い拍（暴走域）のセグメントを何個も狙ってFIRE_SEGMENT_CAPぶん積む」細工で
 *  合計が伸び続けてしまう（各セグメントは上限内でも、セグメント数ぶん積み上がる）。play()1回で
 *  special-fireが払える「時間」の総額そのものに上限を引くことで、セグメント数・分布によらず
 *  「合計 ≤ 連鎖拍の総和 + FIRE_GLOBAL_BUDGET + T.pop + T.fall」が常に成り立つ（検算はscratchpad参照）。
 *  22連鎖（chain1〜6=600ms・7段以降は逓減）の拍総和は4660msなので、5.5秒予算の残りに収まる値に設定。
 *  Codex検収：200msでは3発目以降が同拍になり品質3段階が時間的に読めない → 400msへ増額
 *  （最悪総計は約5.8秒＝main.ts の QUIET_WAIT_MAX=6000 の内側） */
const FIRE_GLOBAL_BUDGET = 400
const FIRE_SUB_BEAT_FULL = 160
const FIRE_SUB_BEAT_SIMPLE = 60

/** win-drain（勝利ドレイン）SEのタイミング予算：最初の10件は45ms、以降20ms、合計700ms上限
 *  （codex_timeline_review.md §3。残手数が多い層で数百件級になり得るため） */
const WIN_DRAIN_FULL_COUNT = 10
const WIN_DRAIN_STEP_FULL = 45
const WIN_DRAIN_STEP_LATER = 20
const WIN_DRAIN_BUDGET = 700

/** 落下時間 = FALL_COEF·√dist（上限 FALL_MAX）。RM実測 ~300ms/1-3行の「見える落下」に寄せる
 *  （rm_tempo.md §8 P2。一定拍化で生じる拍後半の空白を落下の見える移動で埋める） */
const FALL_COEF = 195
const FALL_MAX = 390

/** true で旧挙動（入力割込時に盤面チャンネルを全断）へ戻すスイッチ。
 *  既定 false ＝ RM流の並行続行（前の手の演出を切らず、新しい手が触る駒だけ snap。rm_tempo.md §8 P3 Step2） */
const FULL_SNAP_ON_INPUT = false

/** 600ms窓で最大80msに制限するヒットストップの累積予算（play()呼び出しごとにリセット） */
class HitstopBudget {
  private log: { t: number; ms: number }[] = []
  /** 現在時刻tにdesiredMsぶんのヒットストップを申請し、実際に許可された量を返す */
  request(t: number, desiredMs: number): number {
    while (this.log.length && t - this.log[0].t > 600) this.log.shift()
    const used = this.log.reduce((a, h) => a + h.ms, 0)
    const applied = Math.max(0, Math.min(desiredMs, 80 - used))
    if (applied > 0) this.log.push({ t, ms: applied })
    return applied
  }
}

/** 演出用の決定的乱数（QA比較の安定のため Math.random() を使わない。1手ごとに新しいseedを切る） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** C案移行 Phase4 Stage A（codex_c_phase46_plan.md §7.2）：play()冒頭でローカル宣言していた
 *  「1手ぶんの状態」を1オブジェクトへ集約したもの。beginMove()が生成し、scheduleEvents()/
 *  buildDropTrains()/finishMove()の間で使い回す（純リファクタ＝挙動・tween時刻は変えない）。 */
export interface MoveCtx {
  t: number // 主時計
  chainSeen: number
  chainStartT: number // 連鎖セグメントの開始時刻（ビートはここから加速カーブで刻む＝落下完了を待つ）
  /** stepped経路（Phase4 StageB）か。trueのとき連鎖拍は「スケジュール加算」ではなく playSegment() の
   *  開始間隔下限ゲートが担う（codex_c_phase46_plan.md §7.4＝二重待ちの回避） */
  stepped?: boolean
  /** stepped経路：直近の連鎖段が始まったtween時計（拍下限ゲートの基準） */
  chainClock?: number
  upgradeFireCounts: Map<string, number> // 可視化第一波②：このタイムライン内での強化ごとの発動回数
  disruptLabelCount: number // 可視化第二波③：因果ラベルは1ターン（=このplay呼び出し1回）に最大2個まで
  goalFxCount: number // 目標収集：この手で何本目の飛翔か（破片4件・飛翔6件で打ち止める）
  hitstop: HitstopBudget // 600ms窓で最大80msに制限するヒットストップ予算（codex_consult [D]-2/4）
  // ---- タイムライン予算（codex_timeline_review.md §4-3/4-5）：special-fireのセグメント内サブ拍 ----
  fireSegOffset: number // 現在の連鎖セグメント内でspecial-fireが主時計へ足した量（FIRE_SEGMENT_CAPで頭打ち）
  fireGlobalBudget: number // play()全体でspecial-fireが主時計へ足せる残り予算（セグメント数に関わらず総和を保証）
  lastFireSfxT: number // 直近にSEを鳴らしたfire拍のt（同拍への多重SEを防ぐ＝「同拍1音まで」）
  visibleFireCount: number // このplay()全体を通したspecial-fireの通し番号（品質3段階の判定に使う）
  aggregateFireCounts: Map<string, number> // 集約域（25発以降）：kind別の間引き件数
  aggregateFireAt: Map<string, XY> // 集約域：最後に発火した位置（×N表示の置き場所）
  // ---- win-drain（勝利ドレイン）のタイミング予算（codex_timeline_review.md §3・実装項目6） ----
  winDrainCount: number
  winDrainTotal: number
  // 補充のトレイン（2026-08-15）：同じ拍・同じ列の補充駒を「上空に1マス間隔で整列→一斉落下」させる
  // ための収集器。キーは `${拍t}|${列x}`。実際の湧き位置・落下tweenはイベント走査の後で組む
  refillTrains: Map<string, { sp: Sprite; row: number; col: number; t: number }[]>
  // 盤内の落下も同じキーで収集する。同列・同拍の落下と補充は**同じ遅延・同じ所要時間**で動かす
  // （距離ごとに別durationだと長距離の駒が短距離の駒に追いつき交差する。列内は剛体でしか動かさない）
  columnFalls: Map<string, { sp: Sprite; toX: number; toY: number; dist: number }[]>
  builtDropKeys: Set<string> // トレイン構築済みキーの記録（後続セグメント再生で未構築ぶんだけ構築するため）
  swarmChain: Map<number, { pos: number; total: number; nextCells?: XY[] }> // swarm連鎖ドミノの段階付け
  mvDrop: number // 計器：着地コールバックの世代（codex_arch_review.md §1-6）
  eventIndex: number // DIAGタグ用の通しイベント番号
}

export class BoardView {
  root = new Container()
  cellLayer = new Container()
  groundLayer = new Container()
  blockLayer = new Container()
  underFxLayer = new Container() // 影・予兆・亀裂（駒の下）
  pieceLayer = new Container()
  overFxLayer = new Container() // 閃光・破片・衝撃波（駒の上）
  uiFxLayer = new Container() // 連鎖数・強化名・ダメージ数字・ツールチップ・インテントバッジ（最前面）
  fxLayer: Container // 既存呼び出しの後方互換エイリアス（= overFxLayer）
  S: number
  /** 盤面フレーム素材がタイル格子より外へ張り出す量(px)。HUD側が盤の実占有域を知るために公開する（枠無しなら0） */
  framePad = 0
  sprites = new Map<string, Sprite>() // "x,y" -> 駒スプライト
  // 修正3：popPieceAtはsprites.deleteを即時に行うが、消滅演出(縮小/alpha)はdelay予約でdestroyは
  // その onDone（連鎖後半だと数秒先）。snapPieceForMoveはspritesマップ経由でしか駒を辿れないため、
  // 割込で「snapで定位置に出た新駒」と「ポップ待ちの旧駒」が同一セルに二重表示される穴があった。
  // destroy待ちの駒をセル単位で台帳に残し、そのセルに**次の手以降**で触れたときにsnapして畳み切る
  // （mv=登録時のmoveSeq。同じ手の消滅予約を畳むと、消える予定の駒がスワップ瞬間に透明化する）。
  private doomedByCell = new Map<string, { sp: Sprite; mv: number }[]>()
  blockG = new Map<string, Container>()
  groundG = new Map<string, Container>()
  busyUntil = 0 // タイムライン終端（ms, performance.now 基準）
  private drainCount = 0 // 勝利ドレインSEのピッチ段数
  private epoch = 0 // レベル遷移の世代。跨いだ遅延コールバックは無効化する
  // ---- 並行続行（rm_tempo.md §8 P3 Step2）：手の世代と選択的snapの帳簿 ----
  private moveSeq = 0 // 手の世代。前の手が予約した終端処理（reconcile等）は最新の手のものだけが生きる
  private moveTouched = new WeakSet<object>() // この手でsnap済みの駒（1手内の二重snap＝自分のトゥイーン破壊を防ぐ）
  private timelineEndAbs = 0 // 並走中の全タイムラインの終端（tween内部時計 now() 基準。修正2）。終端reconcileは最長の尻尾に合わせる
  // ---- アイドルヒント（RM/Candy式・控えめ） ----
  /** 現在パルス中の駒と復帰先（clearHintで位置・スケールを確実に定位置へ戻すため保持） */
  private hintSprites: { sp: Sprite; base: number; hx: number; hy: number }[] = []
  private hintGlows: Graphics[] = [] // 駒の下の光輪（clearHintで破棄）

  // ---- ローグライク拡張（ROGUE.md §5）：敵・環境オーバーレイの帳簿 ----
  private armorG = new Map<string, Graphics>() // "x,y" -> 甲殻オーバーレイ
  private preyG = new Map<string, Graphics>() // "x,y" -> 捕食印オーバーレイ
  private fissureG = new Map<number, Graphics>() // enemyId -> 崩落予告の2x2枠
  private sporeTokenG = new Map<string, Container>() // "x,y" -> 胞子トークン（既存 spore 駒とは別物）
  private bossRowG = new Map<number, Container>() // row(y) -> ボス身体1行ぶんの連結コンテナ
  private bossFaceG = new Map<number, Container>() // enemyId -> ボスの目+HPバー（前線行に追従）
  private bossId: number | null = null
  private enemyMeta = new Map<number, { kind: EnemyKind; maxHp: number }>() // 撃破後も参照できるよう種別/最大HPを保持
  private enemyCellsCache = new Map<number, XY[]>() // 直近の敵セル座標（enemy-damage等、座標を持たないイベント用）

  // ---- 可視化第一波：敵インテント・爆発鉱石の常時発光の帳簿 ----
  private intentG = new Map<number, Container>() // enemyId -> インテントバッジ（uiFxLayer・セル内右上）
  private volatileG = new Map<string, Graphics>() // "x,y" -> 爆発鉱石の常時ゆらぎオーバーレイ

  // ---- 可視化第二波：連鎖数の常駐表示（同じコンテナを更新して鼓動させる。毎回新規Textを重ねない） ----
  private chainCounterG: Container | null = null
  private chainCounterText: Text | null = null
  private chainCounterGlow: Graphics | null = null

  // ---- 可視化第二波：Graphicsパーティクルのプール（同時粒子上限を超えたら最古の通常粒子から回収） ----
  private fxPool: Graphics[] = []
  private liveFx: { g: Graphics; priority: 'normal' | 'important' }[] = []
  private rampageActive = false // 10連鎖以降など負荷の高い局面。粒子上限を通常80→暴走時120へ

  // ---- 可視化第二波：演出専用の決定的乱数（1手ごとに再シードしQA比較を安定させる） ----
  private fxSeed = 1
  private fxRand: () => number = Math.random

  /** 所持強化バーへの発動アピール通知（main.ts が購読してアイコンをバウンスさせる。可視化第一波②） */
  /** 強化の発動をHUDへ通知（at＝起点セル。main.ts が強化バーから盤面へ因果パルスを飛ばす） */
  onUpgradeFire?: (id: string, at?: XY) => void
  /** 酸素強奪の通知（main.ts が購読して酸素ゲージへの軌跡＋被弾演出を鳴らす。可視化第二波②） */
  onOxygenDrained?: (enemyId: number, amount: number) => void
  /**
   * 目標達成物の収集（JUICE.md §1②）。BoardView は「どの目標が1つ進んだか」と盤面上の起点（グローバル座標）
   * だけを渡し、HUDへの飛翔・カウンタの跳ねは main.ts が担う（onUpgradeFire / onOxygenDrained と同じ流儀）。
   * flightIndex＝この play() 内で何本目か（0始まり）。main.ts はSEのピッチ段に使う。
   */
  onGoalCollect?: (index: number, done: number, fromGlobal: { x: number; y: number }, flightIndex: number) => void
  /**
   * 敵タップ通知（可視化第一波①〜。共通「野帳シート」統合により、説明表示そのものは main.ts 側の
   * showFieldNote() に一本化した。BoardView は「敵本体／インテントバッジがタップされた」事実だけを渡す）。
   */
  onEnemyTap?: (enemy: EnemyInstance) => void

  constructor(
    public board: Board,
    public renderer: Renderer,
    size: number,
  ) {
    this.S = Math.floor(size / W)
    this.fxLayer = this.overFxLayer
    this.root.addChild(
      this.cellLayer,
      this.groundLayer,
      this.blockLayer,
      this.underFxLayer,
      this.pieceLayer,
      this.overFxLayer,
      this.uiFxLayer,
    )
    // 駒レイヤーだけ盤矩形でマスクする（2026-08-15 重なり調査）：補充の待機列は盤の上空に並ぶ設計に
    // したので、枠の外では見えず「枠の奥から降ってくる」ことにする（王道3マッチの標準）。
    // 破片・飛翔・数字は over/uiFx レイヤーなのでマスクの影響を受けない。左右と下は着地バウンス・
    // 潰れの食み出しぶんだけ余裕を持たせる
    const pieceMask = new Graphics()
    pieceMask.rect(-this.S * 0.3, -this.S * 0.06, W * this.S + this.S * 0.6, H * this.S + this.S * 0.4).fill(0xffffff)
    this.root.addChild(pieceMask)
    this.pieceLayer.mask = pieceMask
    this.drawStatic()
    this.syncAll()
  }

  /** 演出用乱数（0〜1）。play()冒頭で1手ごとに再シードする。Math.random() の代替 */
  private rnd(): number {
    return this.fxRand()
  }

  /** プール済みGraphicsを1つ確保して指定レイヤーへ追加。上限超過時は最古の 'normal' 粒子を回収する */
  private acquireG(layer: Container, priority: 'normal' | 'important' = 'normal'): Graphics {
    const cap = this.rampageActive ? 120 : 80
    if (this.liveFx.length >= cap) {
      const idx = this.liveFx.findIndex((f) => f.priority === 'normal')
      if (idx >= 0) this.releaseG(this.liveFx[idx].g)
    }
    const g = this.fxPool.pop() ?? new Graphics()
    g.clear()
    g.alpha = 1
    g.rotation = 0
    g.scale.set(1)
    layer.addChild(g)
    this.liveFx.push({ g, priority })
    return g
  }

  /** プールへ返却（destroyはしない。次のacquireGで再利用） */
  private releaseG(g: Graphics): void {
    if (g.destroyed) return
    const idx = this.liveFx.findIndex((f) => f.g === g)
    if (idx >= 0) this.liveFx.splice(idx, 1)
    // 修正8：acquireGが上限到達時に最古粒子をここへ強制回収し、直後に同じGraphicsを再利用することがある。
    // 旧tweenが生きたままだと新粒子が旧軌道で動く/途中で消えるため、onDoneを呼ばずdead化してから返却する
    cancel(g)
    cancel(g.position)
    cancel(g.scale)
    g.clear()
    if (g.parent) g.parent.removeChild(g)
    if (!this.fxPool.includes(g)) this.fxPool.push(g) // 強制回収経路と通常releaseの重複呼びで二重pushしない
  }

  key(x: number, y: number) {
    return `${x},${y}`
  }
  px(x: number) {
    return x * this.S + this.S / 2
  }

  private drawStatic() {
    const tileTex = spriteTexture('tile')
    const frameTex = spriteTexture('frame')
    if (tileTex) {
      // 生成タイル：暖色石4バリアントを決定的に散らす（AD v3。市松は微ティント）
      const variants = [tileTex, spriteTexture('tile_1') ?? tileTex, spriteTexture('tile_2') ?? tileTex, spriteTexture('tile_3') ?? tileTex]
      const base = new Graphics()
      base.roundRect(-6, -6, W * this.S + 12, H * this.S + 12, 10).fill({ color: 0x2b2118, alpha: 0.85 })
      this.cellLayer.addChild(base)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!this.board.at(x, y)) continue
          const sp = new Sprite(variants[(x * 7 + y * 13 + ((x * x + y) >> 1)) % 4])
          sp.width = this.S
          sp.height = this.S
          sp.position.set(x * this.S, y * this.S)
          sp.tint = (x + y) % 2 ? 0xffffff : 0xf2ebe0 // 市松は微差に
          this.cellLayer.addChild(sp)
        }
      if (frameTex) {
        // スリム枠（帯内縁がテクスチャ幅の INNER 比率にある前提）を盤外周に重ねる
        const INNER = 0.053 // frame_v4 実測（帯内縁 54/1024）
        const inset = this.S * 0.06 // 外周セルへの食い込みは最小限に
        const gridW = W * this.S
        const gridH = H * this.S
        const pad = (INNER * gridW + inset) / (1 - 2 * INNER)
        const fr = new Sprite(frameTex)
        fr.width = gridW + 2 * pad
        fr.height = gridH + 2 * ((INNER * gridH + inset) / (1 - 2 * INNER))
        fr.position.set(-pad, -(INNER * gridH + inset) / (1 - 2 * INNER))
        this.framePad = (INNER * gridH + inset) / (1 - 2 * INNER)
        this.cellLayer.addChild(fr)
      }
      return
    }
    const g = new Graphics()
    // フォールバック：市松2トーンのコード描き
    g.roundRect(-8, -8, W * this.S + 16, H * this.S + 16, 14).fill(PAL.boardBg)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!this.board.at(x, y)) continue
        g.roundRect(x * this.S + 1.5, y * this.S + 1.5, this.S - 3, this.S - 3, 6).fill((x + y) % 2 ? PAL.cellA : PAL.cellB)
      }
    this.cellLayer.addChild(g)
  }

  /** 盤の論理状態をそのまま描画に反映（初期化・保険） */
  syncAll() {
    this.epoch++ // 以降、旧世代の遅延コールバックは無効
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()
    // ボス身体の連結コンテナは複数セルから同一参照を共有するため、二重destroyを避けて回る
    for (const g of this.blockG.values()) if (!g.destroyed) g.destroy()
    this.blockG.clear()
    for (const g of this.groundG.values()) g.destroy()
    this.groundG.clear()
    for (const g of this.armorG.values()) if (!g.destroyed) g.destroy()
    this.armorG.clear()
    for (const g of this.preyG.values()) if (!g.destroyed) g.destroy()
    this.preyG.clear()
    for (const g of this.fissureG.values()) if (!g.destroyed) g.destroy()
    this.fissureG.clear()
    for (const g of this.sporeTokenG.values()) if (!g.destroyed) g.destroy()
    this.sporeTokenG.clear()
    for (const g of this.bossFaceG.values()) if (!g.destroyed) g.destroy()
    this.bossFaceG.clear()
    this.bossRowG.clear() // 中身は上のblockGループで既に破棄済み
    this.bossId = null
    this.enemyMeta.clear()
    this.enemyCellsCache.clear()
    for (const g of this.volatileG.values()) if (!g.destroyed) g.destroy()
    this.volatileG.clear()
    if (this.chainCounterG && !this.chainCounterG.destroyed) this.chainCounterG.destroy()
    this.chainCounterG = null
    this.chainCounterText = null
    this.chainCounterGlow = null
    for (const g of this.intentG.values()) if (!g.destroyed) g.destroy()
    this.intentG.clear()
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.board.at(x, y)
        if (!c) continue
        if (c.ground > 0) this.makeGround(x, y, c.ground as 1 | 2)
        if (c.block) this.makeBlock(x, y)
        if (c.piece) this.makePiece(x, y, c.piece)
        if (c.armored) this.makeArmorOverlay(x, y, 0)
        if (c.preyMark) this.makePreyOverlay(x, y, 0)
        if (c.sporeToken) this.makeSporeTokenSprite(x, y, 0)
        if (c.piece?.kind === 'normal' && c.piece.volatile) this.makeVolatileOverlay(x, y)
      }
    // ボスの顔（目+HPバー）は上のループ内 makeBossSegment が前線行の処理時に生成する
    this.updateIntentBadges()
  }

  private makePiece(x: number, y: number, p: Piece): Sprite {
    // 同セルに既存スプライトがいたら破棄（変換・胞子湧き等の上書き生成で孤児を作らない）
    const old = this.sprites.get(this.key(x, y))
    if (old) {
      this.sprites.delete(this.key(x, y))
      old.destroy()
    }
    const sp = new Sprite(pieceTexture(this.renderer, p, this.S))
    sp.anchor.set(0.5)
    // テクスチャ原寸に依らずセル寸法へ正規化（この基準スケールが演出の「1」）
    const target = this.S * (p.kind === 'normal' ? 0.82 : 0.86) // 正本準拠: セルに10〜15%の石地余白
    const base = target / Math.max(sp.texture.width, sp.texture.height)
    sp.scale.set(base)
    ;(sp as unknown as { __base: number }).__base = base
    // 銛は向き別テクスチャ（harpoon-h/-v）を直接描くので、ここで回して見せかける必要はない
    sp.position.set(this.px(x), this.px(y))
    ;(sp as unknown as { __kind: string }).__kind = pieceKey(p)
    this.pieceLayer.addChild(sp)
    this.sprites.set(this.key(x, y), sp)
    if (DIAG) {
      markPiece(sp)
      opLog('make', this.key(x, y), sp, this.moveSeq)
    }
    return sp
  }

  // ---- セル占有API（C案移行 Phase2・codex_arch_review.md §3-2）----
  // Sprite所有権（sprites帳簿への出入り）は makePiece / syncAll と以下の4メソッドだけが触る。
  // sprites.set / sprites.delete をこの外で直接呼ばないこと（grepで検証する）。
  // 演出（tween予約）は従来どおり呼び出し側が担う＝このPhaseでは見た目を一切変えない。

  /** 駒を fromK から toK へ移す（落下・片腕スワップ・胞子の単独移動）。行き先の居座りは畳む */
  private mapMove(fromK: string, toK: string, sp: Sprite): void {
    this.sprites.delete(fromK)
    this.foldStaleAt(toK, sp)
    this.sprites.set(toK, sp)
    if (DIAG) opLog('map-move', toK, sp, this.moveSeq)
  }

  /** 2セルの写像を交換する（スワップ・胞子の泡上がり）。両者とも所有が続くので畳みは不要 */
  private mapSwap(kA: string, kB: string, a: Sprite, b: Sprite): void {
    this.sprites.set(kA, b)
    this.sprites.set(kB, a)
    if (DIAG) {
      opLog('map-swap', kA, b, this.moveSeq)
      opLog('map-swap', kB, a, this.moveSeq)
    }
  }

  /** 駒を帳簿から外し消滅待ち（doomed台帳）へ移す（ポップ・胞子回収・リロールの旧駒） */
  private mapRetire(k: string, sp: Sprite): void {
    this.sprites.delete(k)
    if (DIAG) opLog('retire', k, sp, this.moveSeq)
    this.addDoomed(k, sp)
  }

  /** 写像だけを外す（reconcileの空セル整理など。destroyは呼び出し側の責任） */
  private mapClear(k: string, sp: Sprite): void {
    this.sprites.delete(k)
    if (DIAG) opLog('map-clear', k, sp, this.moveSeq)
  }

  /** 演出用: スプライトの基準スケール */
  private bs(sp: Sprite): number {
    return (sp as unknown as { __base?: number }).__base ?? 1
  }

  private makeBlock(x: number, y: number) {
    const c = this.board.at(x, y)!
    const b = c.block!
    const S = this.S
    // ローグ拡張（ROGUE.md §5）：敵の身体セル・穴潜みの封鎖セル
    if (b.type === 'enemy') {
      this.makeEnemyBlock(x, y, b.enemyId)
      return
    }
    if (b.type === 'seal') {
      this.makeSealBlock(x, y)
      return
    }
    // 生成アセットがある障害物は Sprite で
    if (b.type === 'kokeishi' || b.type === 'hako' || b.type === 'touhen' || b.type === 'subi') {
      // 苔石は損傷差分アセット優先（半透明化でなく「欠け」で見せる）
      const key = b.type === 'kokeishi' && b.hp === 1 ? (spriteTexture('kokeishi_cracked') ? 'kokeishi_cracked' : 'kokeishi') : b.type
      const tex = spriteTexture(key)
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        const shrink = b.type === 'touhen' ? 0.78 : 1 // 陶片は「中身」なので小さめ
        const base = ((S - 4) * shrink) / Math.max(tex.width, tex.height)
        sp.scale.set(base)
        sp.position.set(this.px(x), this.px(y))
        if (b.type === 'kokeishi' && b.hp === 1 && key === 'kokeishi') {
          sp.alpha = 0.82 // 差分アセット未ロード時のフォールバック
          sp.tint = 0xd8d2c2
        }
        const wrap = new Container()
        wrap.addChild(sp)
        this.blockLayer.addChild(wrap)
        this.blockG.set(this.key(x, y), wrap)
        return
      }
    }
    const g = new Graphics()
    if (b.type === 'kokeishi') {
      g.roundRect(3, 3, S - 6, S - 6, 8).fill(b.hp === 2 ? PAL.stoneDark : PAL.stone)
      g.roundRect(3, 3, S - 6, S - 6, 8).stroke({ width: 2.5, color: 0x4d5147 })
      if (b.hp === 2) g.moveTo(S * 0.25, S * 0.5).lineTo(S * 0.75, S * 0.5).stroke({ width: 2, color: 0x4d5147 })
      g.circle(S * 0.3, S * 0.28, S * 0.09).fill(0x77905c) // 苔
    } else if (b.type === 'hako') {
      g.roundRect(4, 4, S - 8, S - 8, 6).fill(PAL.wood).stroke({ width: 2.5, color: 0x6b5238 })
      g.moveTo(4, S / 2).lineTo(S - 4, S / 2).stroke({ width: 2, color: 0x6b5238 })
    } else if (b.type === 'touhen') {
      g.circle(S / 2, S / 2, S * 0.34).fill(0xe8e2d2).stroke({ width: 2.5, color: 0x9a927e })
      g.circle(S / 2, S / 2, S * 0.2).stroke({ width: 1.5, color: 0x9a927e })
    } else if (b.type === 'subi') {
      g.circle(S / 2, S / 2, S * 0.4).fill(0x54636f).stroke({ width: 2.5, color: 0x39434c })
      g.circle(S / 2, S / 2, S * 0.18).fill(PAL.glowSpore)
    }
    g.position.set(x * this.S, y * this.S)
    this.blockLayer.addChild(g)
    this.blockG.set(this.key(x, y), g)
  }

  // ---- ローグライク拡張（ROGUE.md §5）：敵の描画 ----

  private drawEye(g: Graphics, cx: number, cy: number, r: number, iris: number) {
    g.circle(cx, cy, r * 1.3).fill(0xf6f1e4)
    g.circle(cx, cy, r).fill(iris)
    g.circle(cx, cy, r * 0.42).fill(0x201812)
  }

  /**
   * ボスの核（大きな目）。同心円3つだけだと周囲の描き込まれた駒と画風が断絶するため、
   * 匣タイルの「歯車の輪」意匠を虹彩の外周に重ねて盤面と絵柄を揃える。
   */
  private drawBossEye(g: Graphics, cx: number, cy: number, r: number) {
    g.circle(cx, cy, r * 1.34).fill(0xf6f1e4)
    g.circle(cx, cy, r * 1.34).stroke({ width: Math.max(1, r * 0.12), color: 0x6b5238 })
    g.circle(cx, cy, r).fill(0xe86a4a)
    const teeth = 10
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2 + Math.PI / teeth
      g.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72).lineTo(cx + Math.cos(a) * r * 1.0, cy + Math.sin(a) * r * 1.0)
    }
    g.stroke({ width: Math.max(1, r * 0.14), color: 0x8c3a24, alpha: 0.95 })
    g.circle(cx, cy, r * 0.64).stroke({ width: Math.max(1, r * 0.1), color: 0xffd7a8, alpha: 0.75 })
    g.circle(cx, cy, r * 0.42).fill(0x201812)
    g.circle(cx - r * 0.17, cy - r * 0.2, r * 0.13).fill({ color: 0xfff6e6, alpha: 0.8 })
  }

  /** 敵の身体セル1つぶんのコンテナに HP バー（背景+塗り）を焼き込む */
  private attachHpBar(wrap: Container, hp: number, maxHp: number, w: number, h: number, x0: number, y0: number) {
    const back = new Graphics()
    back.roundRect(x0, y0, w, h, h / 2).fill({ color: 0x1c1712, alpha: 0.82 })
    wrap.addChild(back)
    const fill = new Graphics()
    wrap.addChild(fill)
    const host = wrap as HpHost
    host.__hpFill = fill
    host.__hpGeom = { x: x0, y: y0, w, h }
    this.paintHpBar(wrap, hp, maxHp)
  }

  /** HP バーの塗りだけ引き直す（enemy-damage・reconcile 双方から呼ぶ） */
  private paintHpBar(wrap: Container, hp: number, maxHp: number) {
    const host = wrap as HpHost
    const fill = host.__hpFill
    const geom = host.__hpGeom
    if (!fill || !geom || fill.destroyed) return
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
    fill.clear()
    if (ratio > 0) fill.roundRect(geom.x, geom.y, Math.max(2, geom.w * ratio), geom.h, geom.h / 2).fill(ratio > 0.3 ? 0xc0503a : 0xe0d040)
  }

  /** 単体セルの敵（岩殻獣/胞子獣/穴潜み）を描く。ボスは別経路（makeBossSegment） */
  private makeEnemyBlock(x: number, y: number, enemyId: number) {
    const enemy = this.board.enemies.find((e) => e.id === enemyId)
    if (!enemy) return
    if (enemy.kind === 'boss') {
      this.makeBossSegment(x, y, enemy)
      return
    }
    this.enemyMeta.set(enemy.id, { kind: enemy.kind, maxHp: enemy.maxHp })
    this.enemyCellsCache.set(
      enemy.id,
      enemy.cells.map((p) => ({ ...p })),
    )
    const S = this.S
    const wrap = new Container()
    wrap.position.set(x * S, y * S)
    if (enemy.kind === 'rockshell') {
      const tex = spriteTexture('kokeishi')
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((S - 4) / Math.max(tex.width, tex.height))
        sp.position.set(S / 2, S / 2)
        wrap.addChild(sp)
      } else {
        const g = new Graphics()
        g.roundRect(3, 3, S - 6, S - 6, 8).fill(PAL.stoneDark).stroke({ width: 2.5, color: 0x4d5147 })
        wrap.addChild(g)
      }
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.44, S * 0.15, 0xf0c060) // 一つ目・琥珀
      wrap.addChild(eye)
    } else if (enemy.kind === 'sporeling') {
      const tex = spriteTexture('subi')
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((S - 4) / Math.max(tex.width, tex.height))
        sp.position.set(S / 2, S / 2)
        wrap.addChild(sp)
      } else {
        const g = new Graphics()
        g.circle(S / 2, S / 2, S * 0.4).fill(0x54636f).stroke({ width: 2.5, color: 0x39434c })
        wrap.addChild(g)
      }
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.42, S * 0.14, 0xc9a0e8) // 一つ目・菫
      wrap.addChild(eye)
    } else if (enemy.kind === 'swarm') {
      // 小型胞子虫（ROGUE2.md 第3波）。定期行動を持たない＝怒る局面が無いので通常顔で固定する
      const tex = spriteTexture('e_swarm')
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((S - 6) / Math.max(tex.width, tex.height))
        sp.position.set(S / 2, S / 2)
        wrap.addChild(sp)
      } else {
        const g = new Graphics()
        g.circle(S / 2, S / 2, S * 0.36).fill(0xb9c7c4).stroke({ width: 2.5, color: 0x6e7a76 })
        wrap.addChild(g)
      }
    } else if (enemy.kind === 'burrower') {
      // 裂坑掘り：暗い穴（同心円）＋二つ目
      const g = new Graphics()
      g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0x0b0d10, alpha: 0.92 })
      g.circle(S / 2, S / 2, S * 0.29).fill({ color: 0x1c2128, alpha: 0.92 })
      g.circle(S / 2, S / 2, S * 0.15).fill({ color: 0x2c333b, alpha: 0.85 })
      wrap.addChild(g)
      const eyes = new Graphics()
      this.drawEye(eyes, S / 2 - S * 0.14, S * 0.44, S * 0.09, 0xdff0ff)
      this.drawEye(eyes, S / 2 + S * 0.14, S * 0.44, S * 0.09, 0xdff0ff)
      wrap.addChild(eyes)
    } else if (enemy.kind === 'breathstealer') {
      // 息喰み：吸い込む口＝三重の同心リング（危険色）＋細い一つ目。唯一「酸素を奪う」敵として色相を分ける
      const g = new Graphics()
      g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0x2a1216, alpha: 0.95 })
      g.circle(S / 2, S / 2, S * 0.3).stroke({ width: S * 0.05, color: 0xe0503a, alpha: 0.9 })
      g.circle(S / 2, S / 2, S * 0.16).fill({ color: 0x120a0c, alpha: 0.95 })
      wrap.addChild(g)
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.34, S * 0.1, 0xffd6b0)
      wrap.addChild(eye)
    } else if (enemy.kind === 'binder') {
      // 綴じ蟲：列を綴じる＝縦の綴じ糸。専用アートが来るまでのコード描画（PHASE2.md §5 の納品単位は未達）
      const g = new Graphics()
      g.roundRect(S * 0.18, 3, S * 0.64, S - 6, S * 0.16).fill({ color: 0x1d2a2e, alpha: 0.95 }).stroke({ width: 2.5, color: 0x6d8f96 })
      for (const ty of [0.3, 0.5, 0.7]) g.moveTo(S * 0.24, S * ty).lineTo(S * 0.76, S * ty).stroke({ width: 2, color: 0x9ec8cf, alpha: 0.75 })
      wrap.addChild(g)
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.24, S * 0.1, 0xa8e6ef)
      wrap.addChild(eye)
    } else if (enemy.kind === 'bellfoot') {
      // 鐘脚：釣鐘の胴＋残り殻の枚数だけ外側にリングを重ねる（殻が張り直されると輪が増える）
      const g = new Graphics()
      g.moveTo(S * 0.5, S * 0.16)
        .lineTo(S * 0.82, S * 0.74)
        .lineTo(S * 0.18, S * 0.74)
        .closePath()
        .fill({ color: 0x3a2f1c, alpha: 0.95 })
        .stroke({ width: 2.5, color: 0xb99a52 })
      for (let i = 0; i < enemy.shell; i++)
        g.circle(S / 2, S * 0.52, S * (0.34 + i * 0.06)).stroke({ width: 2, color: 0xe0c070, alpha: 0.7 - i * 0.2 })
      wrap.addChild(g)
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.56, S * 0.1, 0xffe6a8)
      wrap.addChild(eye)
    } else if (enemy.kind === 'maw') {
      // 奈落の喉：生きものというより地形。牙の並ぶ暗い裂け目
      const g = new Graphics()
      g.roundRect(1, S * 0.18, S - 2, S * 0.72, S * 0.1).fill({ color: 0x08090c, alpha: 0.96 }).stroke({ width: 2.5, color: 0x5a4a6b })
      for (const tx of [0.2, 0.45, 0.7]) g.moveTo(S * tx, S * 0.24).lineTo(S * (tx + 0.12), S * 0.46).lineTo(S * (tx + 0.24), S * 0.24).fill(0xcfc2dd)
      wrap.addChild(g)
    }
    // HP1の小型胞子虫はバーが常に満タンで意味を成さないため出さない（画面のノイズを減らす）。
    // 複数セルの身体（奈落の喉）は先頭セルにだけ出す＝reconcile が更新するのも先頭セルのバーだけ
    const isLeadCell = enemy.cells[0]?.x === x && enemy.cells[0]?.y === y
    if (enemy.maxHp > 1 && isLeadCell) this.attachHpBar(wrap, enemy.hp, enemy.maxHp, S * 0.72, S * 0.1, (S - S * 0.72) / 2, S * 0.06)
    // 可視化第一波①：敵セルのタップで野帳シートを開く（スワップ対象にならないセルなので入力系と衝突しない）
    wrap.eventMode = 'static'
    wrap.cursor = 'pointer'
    wrap.hitArea = { contains: (lx: number, ly: number) => lx >= 0 && lx <= S && ly >= 0 && ly <= S }
    wrap.on('pointertap', (e) => {
      e.stopPropagation()
      this.onEnemyTap?.(enemy)
    })
    this.blockLayer.addChild(wrap)
    this.blockG.set(this.key(x, y), wrap)
  }

  /** ボス身体：1行=1コンテナで hako を連結（ROGUE.md §5） */
  private makeBossSegment(x: number, y: number, enemy: EnemyInstance) {
    this.enemyMeta.set(enemy.id, { kind: 'boss', maxHp: enemy.maxHp })
    this.enemyCellsCache.set(
      enemy.id,
      enemy.cells.map((p) => ({ ...p })),
    )
    this.bossId = enemy.id
    const S = this.S
    let row = this.bossRowG.get(y)
    if (!row || row.destroyed) {
      row = new Container()
      row.position.set(0, y * S)
      this.blockLayer.addChild(row)
      this.bossRowG.set(y, row)
    }
    const seg = new Container()
    seg.position.set(x * S, 0)
    const tex = spriteTexture('hako')
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set((S - 2) / Math.max(tex.width, tex.height))
      sp.position.set(S / 2, S / 2)
      seg.addChild(sp)
    } else {
      const g = new Graphics()
      g.roundRect(1, 1, S - 2, S - 2, 5).fill(PAL.wood).stroke({ width: 2, color: 0x6b5238 })
      seg.addChild(g)
    }
    row.addChild(seg)
    this.blockG.set(this.key(x, y), row)
    if (y === H - 1 && (!this.bossFaceG.get(enemy.id) || this.bossFaceG.get(enemy.id)!.destroyed)) {
      this.makeBossFace(enemy)
    }
  }

  /** ボスの顔（中央の大きい目+HPバー）。前線行に追従する単独オーバーレイ */
  private makeBossFace(boss: EnemyInstance) {
    const old = this.bossFaceG.get(boss.id)
    if (old) {
      this.bossFaceG.delete(boss.id)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    this.bossId = boss.id
    const face = new Container() as BossFaceHost
    face.position.set(0, (H - 1) * S)
    // 顔もゲージも「いま身体が占めているセル範囲」に追従させる。第2段階で中央2セルへ縮んだとき
    // 固定幅(W*S*0.5)のままだと隣の駒の上にバーが残ってしまうため、実寸から毎回導出する。
    const xs = boss.cells.map((c) => c.x)
    const x0c = Math.min(...xs)
    const x1c = Math.max(...xs)
    const span = x1c - x0c + 1
    const cx = (x0c + span / 2) * S
    const w = span * S * 0.86
    const barX = cx - w / 2
    const eye = new Graphics()
    this.drawBossEye(eye, cx, S * 0.56, Math.min(S * 0.32, w * 0.3)) // 上端がゲージ下端(S*0.20)に触れない高さ
    face.addChild(eye)
    // 第1段階は「残りの匣」、第2段階は「核のHP」を同じバーで見せる（意味だけ切り替える）
    const cur = boss.bossPhase === 1 ? boss.bossShellLeft : boss.hp
    const max = boss.bossPhase === 1 ? BOSS_SHELL_COUNT : boss.maxHp
    const barH = S * 0.14
    const barY = S * 0.06
    this.attachHpBar(face, cur, max, w, barH, barX, barY)
    if (boss.bossPhase === 1) {
      // 匣は連続量ではなく「枚数」。刻みを入れて残り枚数がそのまま数えられる形にする
      const notch = new Graphics()
      for (let i = 1; i < BOSS_SHELL_COUNT; i++) {
        const tx = barX + (w * i) / BOSS_SHELL_COUNT
        notch.moveTo(tx, barY).lineTo(tx, barY + barH)
      }
      notch.stroke({ width: Math.max(1, S * 0.022), color: 0x1c1712, alpha: 0.95 })
      face.addChild(notch)
    }
    face.__bossSpan = `${x0c},${x1c},${boss.bossPhase}`
    // 可視化第一波①：ボスの顔もタップで野帳シートを開く
    face.eventMode = 'static'
    face.cursor = 'pointer'
    face.hitArea = { contains: (lx: number, ly: number) => lx >= x0c * S && lx <= (x1c + 1) * S && ly >= 0 && ly <= S }
    face.on('pointertap', (e) => {
      e.stopPropagation()
      this.onEnemyTap?.(boss)
    })
    this.blockLayer.addChild(face)
    this.bossFaceG.set(boss.id, face)
  }

  /** ボスのゲージを引き直す（第1段階＝匣の残り枚数／第2段階＝核HP）。boss-shell-broken と reconcile から呼ぶ */
  private paintBossGauge() {
    if (this.bossId == null) return
    const boss = this.board.enemies.find((e) => e.id === this.bossId)
    if (!boss) return
    const face = this.bossFaceG.get(this.bossId)
    if (!face || face.destroyed) return
    const cur = boss.bossPhase === 1 ? boss.bossShellLeft : boss.hp
    const max = boss.bossPhase === 1 ? BOSS_SHELL_COUNT : boss.maxHp
    this.paintHpBar(face, cur, max)
  }

  /** 裂坑掘りの封鎖セル：暗い蓋＋X字 */
  private makeSealBlock(x: number, y: number): Graphics {
    const S = this.S
    const g = new Graphics()
    g.roundRect(3, 3, S - 6, S - 6, 8).fill({ color: 0x14110f, alpha: 0.78 })
    const pad = S * 0.28
    g.moveTo(pad, pad).lineTo(S - pad, S - pad).stroke({ width: S * 0.06, color: 0x6b5a46 })
    g.moveTo(S - pad, pad).lineTo(pad, S - pad).stroke({ width: S * 0.06, color: 0x6b5a46 })
    g.position.set(x * S, y * S)
    this.blockLayer.addChild(g)
    this.blockG.set(this.key(x, y), g)
    return g
  }

  /** 岩殻獣の甲殻オーバーレイ（1回分の追加破壊を要求。ROGUE.md §5） */
  private makeArmorOverlay(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.armorG.get(k)
    if (old) {
      this.armorG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    const g = new Graphics()
    g.roundRect(4, 4, S - 8, S - 8, 8).stroke({ width: S * 0.07, color: 0x9aa2ac, alpha: 0.9 })
    g.roundRect(4, 4, S - 8, S - 8, 8).fill({ color: 0xc7ccd2, alpha: 0.14 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.armorG.set(k, g)
    tween(g, { alpha: 1 }, 200, { delay: t })
  }

  /** 喰み蟲が捕食印を付けた駒の紫の靄オーバーレイ（ROGUE.md §5） */
  private makePreyOverlay(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.preyG.get(k)
    if (old) {
      this.preyG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    const g = new Graphics()
    g.circle(S / 2, S / 2, S * 0.44).fill({ color: 0x8b5fc8, alpha: 0.26 })
    g.circle(S / 2, S / 2, S * 0.44).stroke({ width: S * 0.035, color: 0xb98be0, alpha: 0.6 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.preyG.set(k, g)
    tween(g, { alpha: 1 }, 200, { delay: t })
  }

  /** 捕食印の靄を片付ける（食べられた／追い払った の両方から呼ぶ） */
  private clearPreyOverlay(p: XY) {
    const k = this.key(p.x, p.y)
    const g = this.preyG.get(k)
    if (!g) return
    this.preyG.delete(k)
    if (!g.destroyed) g.destroy()
  }

  /**
   * 裂坑掘りの崩落予告：2x2を囲む破線枠を1.2秒周期で明滅させる。
   * 駒の下（underFxLayer）に置くので、予告中も中の駒は普通に読める＝「ここを消せば止まる」が伝わる。
   */
  private makeFissureFrame(id: number, cells: XY[], t: number) {
    this.clearFissureFrame(id)
    if (!cells.length) return
    const S = this.S
    const x0 = Math.min(...cells.map((c) => c.x)) * S
    const y0 = Math.min(...cells.map((c) => c.y)) * S
    const w = (Math.max(...cells.map((c) => c.x)) + 1) * S - x0
    const h = (Math.max(...cells.map((c) => c.y)) + 1) * S - y0
    const g = new Graphics()
    const width = S * 0.05
    // pixi に破線は無いので、辺ごとに短い線分を並べて「亀裂の予告線」に見せる
    const dash = (ax: number, ay: number, bx: number, by: number) => {
      const len = Math.hypot(bx - ax, by - ay)
      const n = Math.max(2, Math.round(len / (S * 0.4)))
      const ux = (bx - ax) / len
      const uy = (by - ay) / len
      for (let i = 0; i < n; i++) {
        const s = (len / n) * i
        const e = s + (len / n) * 0.55
        g.moveTo(ax + ux * s, ay + uy * s)
          .lineTo(ax + ux * e, ay + uy * e)
          .stroke({ width, color: 0xcbb28a })
      }
    }
    const pad = width / 2
    dash(x0 + pad, y0 + pad, x0 + w - pad, y0 + pad)
    dash(x0 + w - pad, y0 + pad, x0 + w - pad, y0 + h - pad)
    dash(x0 + w - pad, y0 + h - pad, x0 + pad, y0 + h - pad)
    dash(x0 + pad, y0 + h - pad, x0 + pad, y0 + pad)
    g.alpha = 0
    this.underFxLayer.addChild(g)
    this.fissureG.set(id, g)
    const loop = () => {
      if (g.destroyed || this.fissureG.get(id) !== g) return
      tween(g, { alpha: 0.35 }, 600, {
        onDone: () => {
          if (g.destroyed || this.fissureG.get(id) !== g) return
          tween(g, { alpha: 0.8 }, 600, { onDone: loop })
        },
      })
    }
    tween(g, { alpha: 0.8 }, 220, { delay: t, onDone: loop })
  }

  /** 崩落予告枠を片付ける（中断・実行のどちらでも同じ経路） */
  private clearFissureFrame(id: number) {
    const g = this.fissureG.get(id)
    if (!g) return
    this.fissureG.delete(id)
    if (!g.destroyed) g.destroy()
  }

  /** 胞子トークン（設置型。既存 spore 駒とは別物）。駒の70%サイズで駒レイヤーの上に置く */
  private makeSporeTokenSprite(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.sporeTokenG.get(k)
    if (old) {
      this.sporeTokenG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const tex = spriteTexture('spore')
    const target = this.S * 0.82 * 0.7
    let node: Container
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set(target / Math.max(tex.width, tex.height))
      node = sp
    } else {
      const g = new Graphics()
      g.circle(0, 0, target / 2).fill({ color: PAL.glowSpore, alpha: 0.8 })
      node = g
    }
    node.position.set(this.px(x), this.px(y))
    const baseScale = node.scale.x || 1
    node.scale.set(0)
    this.fxLayer.addChild(node)
    this.sporeTokenG.set(k, node)
    tween(node.scale, { x: baseScale, y: baseScale }, 220, { delay: t, ease: easeOutBack })
  }

  /** コンテナを左右に小さく揺らす（敵被弾・ボス全体攻撃で共用） */
  private shakeContainer(c: Container, t: number, amp = 4) {
    const bx = c.position.x
    const by = c.position.y
    const offs = [amp, -amp, amp * 0.6, -amp * 0.6, 0]
    let d = t
    for (const ox of offs) {
      tween(c.position, { x: bx + ox, y: by }, 45, { delay: d, channel: 'fx' })
      d += 45
    }
  }

  /** 被弾フラッシュ（白い矩形を一瞬重ねてフェード） */
  private hitFlash(container: Container, t: number) {
    const b = container.getLocalBounds()
    const g = new Graphics()
    g.rect(b.x, b.y, b.width, b.height).fill({ color: 0xffffff, alpha: 0.5 })
    container.addChild(g)
    tween(g, { alpha: 0 }, 160, {
      delay: t,
      channel: 'fx',
      onDone: () => {
        if (!g.destroyed) g.destroy()
      },
    })
  }

  /** ダメージ数字ポップ（小さな明朝数字、上に浮いて消える） */
  private damageNumberFx(p: XY, amount: number, t: number) {
    delay(t, () => {
      const txt = new Text({
        text: `-${amount}`,
        style: { fill: 0xfff1d0, fontSize: this.S * 0.26, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x3a2418, width: 3 } },
      })
      txt.anchor.set(0.5)
      txt.position.set(this.px(p.x), this.px(p.y) - this.S * 0.1)
      this.uiFxLayer.addChild(txt)
      tween(txt.position, { y: txt.position.y - this.S * 0.6 }, 500, { ease: easeOutCubic, channel: 'fx' })
      tween(txt, { alpha: 0 }, 380, {
        delay: 120,
        channel: 'fx',
        onDone: () => {
          if (!txt.destroyed) txt.destroy()
        },
      })
    }, 'fx')
  }

  /** enemy-damage：HPバー更新＋揺れ＋フラッシュ＋ダメージ数字（ROGUE.md §5） */
  private enemyDamageFx(id: number, amount: number, hpLeft: number, t: number) {
    const meta = this.enemyMeta.get(id)
    const cells = this.enemyCellsCache.get(id)
    if (!meta || !cells || !cells.length) return
    const container = meta.kind === 'boss' ? this.bossFaceG.get(id) : this.blockG.get(this.key(cells[0].x, cells[0].y))
    if (container && !container.destroyed) {
      this.paintHpBar(container, hpLeft, meta.maxHp)
      this.shakeContainer(container, t, 3)
      this.hitFlash(container, t)
    }
    const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
    const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
    this.damageNumberFx({ x: cx, y: cy }, amount, t)
  }

  /**
   * enemy-defeated：潰れて消えるポップ＋粒（ボスは行コンテナ＋顔も片付ける）。
   * swarm連鎖のときは撃破地点から隣接個体への衝撃パルス＋予備膨張の「ドミノ」演出を追加する（codex_consult [D]-4）。
   */
  private enemyDefeatedFx(id: number, cells: XY[], t: number, swarm?: { pos: number; total: number; nextCells?: XY[] }) {
    const meta = this.enemyMeta.get(id)
    const isSwarmChain = !!swarm && meta?.kind === 'swarm' && swarm.total > 1
    if (meta?.kind === 'boss') {
      const rows = new Set(cells.map((c) => c.y))
      for (const row of rows) {
        const rowC = this.bossRowG.get(row)
        if (rowC) {
          this.bossRowG.delete(row)
          if (!rowC.destroyed) {
            tween(rowC.scale, { x: 0, y: 0 }, 220, {
              delay: t,
              ease: easeInCubic,
              onDone: () => {
                if (!rowC.destroyed) rowC.destroy()
              },
            })
          }
        }
        for (let bx = 0; bx < W; bx++) this.blockG.delete(this.key(bx, row))
      }
      const face = this.bossFaceG.get(id)
      if (face) {
        this.bossFaceG.delete(id)
        if (!face.destroyed)
          tween(face, { alpha: 0 }, 220, {
            delay: t,
            onDone: () => {
              if (!face.destroyed) face.destroy()
            },
          })
      }
      this.bossId = null
    } else {
      for (const p of cells) {
        const k = this.key(p.x, p.y)
        const g = this.blockG.get(k)
        if (g) {
          this.blockG.delete(k)
          if (!g.destroyed) {
            if (isSwarmChain && swarm!.pos > 1) {
              // 隣からの衝撃パルスを受けた個体：潰れる前に1.15倍へ予備膨張してから通常のポップへ合流
              tween(g.scale, { x: 1.15, y: 1.15 }, 40, { delay: t })
              tween(g.scale, { x: 1.2, y: 1.2 }, 50, { delay: t + 40 })
              tween(g.scale, { x: 0, y: 0 }, 160, {
                delay: t + 90,
                ease: easeInCubic,
                onDone: () => {
                  if (!g.destroyed) g.destroy()
                },
              })
            } else {
              tween(g.scale, { x: 1.2, y: 1.2 }, 90, { delay: t })
              tween(g.scale, { x: 0, y: 0 }, 160, {
                delay: t + 90,
                ease: easeInCubic,
                onDone: () => {
                  if (!g.destroyed) g.destroy()
                },
              })
            }
          }
        }
      }
    }
    if (isSwarmChain) {
      const pos = swarm!.pos
      const sparkN = pos === 1 ? 6 : pos <= 4 ? 8 : 12
      for (const p of cells) this.swarmSparkFx(p, t, sparkN, pos >= 5)
      if (swarm!.nextCells && swarm!.nextCells.length) this.dominoPulseFx(cells, swarm!.nextCells, t)
      if (pos === swarm!.total) this.shakeRootDecay(t, 4, 140) // 最後の1体：4px揺れ（ヒットストップは呼び出し側=play()が申請）
    } else {
      for (const p of cells) this.debrisFx(p, t, 0xd9c9a8)
    }
    this.enemyMeta.delete(id)
    this.enemyCellsCache.delete(id)
  }

  /** swarmドミノの火花。1体目6・2〜4体目8・5体以上12＋金の紙片を混ぜる（codex_consult [D]-4） */
  private swarmSparkFx(p: XY, t: number, count: number, gold: boolean) {
    delay(t, () => {
      for (let i = 0; i < count; i++) {
        const g = this.acquireG(this.overFxLayer)
        const useGold = gold && i % 3 === 0
        if (useGold) g.roundRect(-2.6, -1.6, 5.2, 3.2, 1).fill(0xf2c14e)
        else g.circle(0, 0, 2.2).fill(0xf4ead0)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.35 + this.rnd() * 0.55)
        const dur = 260 + this.rnd() * 120
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0, rotation: useGold ? (this.rnd() - 0.5) * 6 : 0 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
  }

  /** swarmドミノ：撃破地点から次に倒れる隣接個体へ渡る衝撃パルス（60-90ms） */
  private dominoPulseFx(fromCells: XY[], toCells: XY[], t: number) {
    const fx = Math.round(fromCells.reduce((a, p) => a + p.x, 0) / fromCells.length)
    const fy = Math.round(fromCells.reduce((a, p) => a + p.y, 0) / fromCells.length)
    const tx = Math.round(toCells.reduce((a, p) => a + p.x, 0) / toCells.length)
    const ty = Math.round(toCells.reduce((a, p) => a + p.y, 0) / toCells.length)
    delay(t, () => {
      const g = this.acquireG(this.overFxLayer, 'important')
      g.circle(0, 0, this.S * 0.14).fill({ color: 0xe8b33c, alpha: 0.9 })
      g.position.set(this.px(fx), this.px(fy))
      const dur = 75
      tween(g.position, { x: this.px(tx), y: this.px(ty) }, dur, { ease: easeOutCubic, channel: 'fx' })
      tween(g.scale, { x: 1.6, y: 1.6 }, dur, { channel: 'fx' })
      tween(g, { alpha: 0 }, dur, {
        delay: 10,
        channel: 'fx',
        onDone: () => this.releaseG(g),
      })
    }, 'fx')
  }

  /**
   * swarm連鎖のドミノ段階を事前分類する（play()冒頭で一度だけ計算）。
   * defeatEnemy→propagateSwarmDefeat の再帰で enemy-damage/enemy-defeated が連続して積まれる構造を利用し、
   * 'enemy-defeated' の evsインデックス→{何体目/全体数/次に倒れる個体のcells} を求める（codex_consult [D]-4）。
   */
  private classifySwarmChain(evs: BoardEvent[]): Map<number, { pos: number; total: number; nextCells?: XY[] }> {
    const info = new Map<number, { pos: number; total: number; nextCells?: XY[] }>()
    const isSwarmStep = (ev: BoardEvent): ev is Extract<BoardEvent, { t: 'enemy-damage' } | { t: 'enemy-defeated' }> =>
      (ev.t === 'enemy-damage' || ev.t === 'enemy-defeated') && this.enemyMeta.get(ev.id)?.kind === 'swarm'
    let i = 0
    while (i < evs.length) {
      if (!isSwarmStep(evs[i])) {
        i++
        continue
      }
      const runIdx: number[] = []
      let j = i
      while (j < evs.length && isSwarmStep(evs[j])) {
        if (evs[j].t === 'enemy-defeated') runIdx.push(j)
        j++
      }
      const total = runIdx.length
      runIdx.forEach((idx, k) => {
        const nextIdx = runIdx[k + 1]
        const nextCells = nextIdx !== undefined ? (evs[nextIdx] as Extract<BoardEvent, { t: 'enemy-defeated' }>).cells : undefined
        info.set(idx, { pos: k + 1, total, nextCells })
      })
      i = j
    }
    return info
  }

  /** 爆発鉱石：3層爆発（下層=予兆円／中層=白橙コア+衝撃波2本／上層=火花・重量片・煙）。codex_consult [D]-2 */
  private explodeFx(p: XY, t: number, big: boolean) {
    this.layeredExplosionFx(p, t, {
      big,
      sparkColor: 0xffb066,
      coreColor: 0xff8a3d,
      ringColor: 0xff8a3d,
      chunkColor: 0xd9773b,
      sparkCount: big ? 24 : 18,
      chunkCount: big ? 12 : 8,
      smokeCount: big ? 6 : 4,
      ringMaxScale: big ? 3.4 : 2.6,
    })
  }

  /**
   * 3層爆発の共通実装。爆発鉱石・歯車爆弾で規模と色だけを変えて呼び出す（codex_consult [D]-2）。
   * 下層＝予兆円60ms収縮（駒の下）／中層＝白コア24ms＋色コア90ms＋衝撃波リング2本(180-260ms)／
   * 上層＝火花(160-240ms)・重量片(420-600ms)・煙(380ms〜)。全粒子で寿命と速度を変える。
   */
  private layeredExplosionFx(
    p: XY,
    t: number,
    opts: {
      big: boolean
      sparkColor: number
      coreColor: number
      ringColor: number
      chunkColor: number
      sparkCount: number
      chunkCount: number
      smokeCount: number
      ringMaxScale: number
    },
  ) {
    const S = this.S
    // 下層：予兆円（駒の下で60ms収縮）
    delay(t, () => {
      const pre = new Graphics()
      pre.circle(0, 0, S * 0.46).fill({ color: 0x2a1408, alpha: 0.55 })
      pre.position.set(this.px(p.x), this.px(p.y))
      this.underFxLayer.addChild(pre)
      tween(pre.scale, { x: 0.1, y: 0.1 }, 60, { ease: easeInCubic, channel: 'fx' })
      tween(pre, { alpha: 0 }, 60, {
        channel: 'fx',
        onDone: () => {
          if (!pre.destroyed) pre.destroy()
        },
      })
    }, 'fx')
    // 中層：白コア24ms
    delay(t, () => {
      const core = this.acquireG(this.overFxLayer, 'important')
      core.circle(0, 0, S * 0.24).fill({ color: 0xffffff, alpha: 0.95 })
      core.position.set(this.px(p.x), this.px(p.y))
      tween(core, { alpha: 0 }, 24, { channel: 'fx', onDone: () => this.releaseG(core) })
    }, 'fx')
    // 中層：色コア90ms
    delay(t + 8, () => {
      const oc = this.acquireG(this.overFxLayer, 'important')
      oc.circle(0, 0, S * 0.3).fill({ color: opts.coreColor, alpha: 0.9 })
      oc.position.set(this.px(p.x), this.px(p.y))
      tween(oc.scale, { x: 1.6, y: 1.6 }, 90, { ease: easeOutCubic, channel: 'fx' })
      tween(oc, { alpha: 0 }, 90, { channel: 'fx', onDone: () => this.releaseG(oc) })
    }, 'fx')
    // 中層：衝撃波リング（太い主波＋薄い副波の2本、180-260ms）
    delay(t, () => {
      const ringMain = this.acquireG(this.overFxLayer, 'important')
      ringMain.circle(0, 0, S * 0.32).stroke({ width: S * 0.14, color: opts.ringColor, alpha: 0.92 })
      ringMain.position.set(this.px(p.x), this.px(p.y))
      tween(ringMain.scale, { x: opts.ringMaxScale, y: opts.ringMaxScale }, 220, { ease: easeOutCubic, channel: 'fx' })
      tween(ringMain, { alpha: 0 }, 220, { channel: 'fx', onDone: () => this.releaseG(ringMain) })
      const ringSub = this.acquireG(this.overFxLayer)
      ringSub.circle(0, 0, S * 0.28).stroke({ width: S * 0.05, color: 0xffe3b0, alpha: 0.55 })
      ringSub.position.set(this.px(p.x), this.px(p.y))
      tween(ringSub.scale, { x: opts.ringMaxScale * 1.25, y: opts.ringMaxScale * 1.25 }, 260, { ease: easeOutCubic, channel: 'fx' })
      tween(ringSub, { alpha: 0 }, 260, { channel: 'fx', onDone: () => this.releaseG(ringSub) })
    }, 'fx')
    // 上層：火花（160-240ms）
    delay(t + 10, () => {
      for (let i = 0; i < opts.sparkCount; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.circle(0, 0, 2.2 + this.rnd() * 1.6).fill(opts.sparkColor)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = S * (0.5 + this.rnd() * (opts.big ? 0.9 : 0.6))
        const dur = 160 + this.rnd() * 80
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
    // 上層：重量片（420-600ms、重力落ち）
    delay(t + 20, () => {
      for (let i = 0; i < opts.chunkCount; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.roundRect(-3.2, -3.2, 6.4, 6.4, 1.4).fill(opts.chunkColor)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = S * (0.5 + this.rnd() * (opts.big ? 1.1 : 0.8))
        const dur = 420 + this.rnd() * 180
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d + S * 0.5 }, dur, {
          ease: easeOutCubic,
          channel: 'fx',
        })
        tween(g, { alpha: 0, rotation: (this.rnd() - 0.5) * 5 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
    // 上層：煙（下層に薄く漂わせる）
    delay(t + 40, () => {
      for (let i = 0; i < opts.smokeCount; i++) {
        const g = this.acquireG(this.underFxLayer)
        g.circle(0, 0, S * (0.16 + this.rnd() * 0.08)).fill({ color: 0x4a3a2a, alpha: 0.32 })
        g.position.set(this.px(p.x) + (this.rnd() - 0.5) * S * 0.3, this.px(p.y) + (this.rnd() - 0.5) * S * 0.3)
        const dur = 380 + this.rnd() * 200
        tween(g.position, { y: g.position.y - S * (0.3 + this.rnd() * 0.3) }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g.scale, { x: 1.6, y: 1.6 }, dur, { channel: 'fx' })
        tween(g, { alpha: 0 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
  }

  /**
   * 爆発／コンボ／swarmドミノ最後の一撃で使う root の減衰揺れ。初撃最大→0.6→0.3、x:y=1:0.35（codex_consult [D]-2/4）。
   * 画面全体ではなく root のみを揺らし、HUDの可読性を守る。
   */
  private shakeRootDecay(t: number, amp: number, totalDur: number) {
    const c = this.root
    const bx = c.position.x
    const by = c.position.y
    const steps = [1, -0.6, 0.6, -0.3, 0]
    const stepDur = totalDur / (steps.length - 1)
    let d = t
    for (const k of steps) {
      tween(c.position, { x: bx + amp * k, y: by + amp * 0.35 * k }, stepDur, { delay: d, channel: 'fx' })
      d += stepDur
    }
  }

  /** ギア起動：金の回転リング一瞬 */
  private gearRingFx(p: XY, t: number) {
    delay(t, () => {
      const ring = new Graphics()
      ring.circle(0, 0, this.S * 0.34).stroke({ width: this.S * 0.05, color: 0xe8b33c, alpha: 0.9 })
      ring.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(ring)
      tween(ring.scale, { x: 1.5, y: 1.5 }, 240, { ease: easeOutCubic, channel: 'fx' })
      tween(ring, { rotation: Math.PI * 1.4 }, 240, { ease: easeOutCubic, channel: 'fx' })
      tween(ring, { alpha: 0 }, 240, { channel: 'fx', onDone: () => ring.destroy() })
    }, 'fx')
  }

  /** 誕生イベント 0-70ms：周囲4-8駒を中心へ2-3px吸引＋局所減光（codex_consult [D]-1） */
  private birthPullFx(at: XY, t: number) {
    const mv = this.moveSeq // 修正5：予約時に世代を閉じる。発火時に手が進んでいたら何もしない
    delay(t, () => {
      if (mv !== this.moveSeq) return // 次の手が始まっていた＝近傍の座標キャプチャはもう古い
      const S = this.S
      const dim = new Graphics()
      dim.circle(0, 0, S * 0.62).fill({ color: 0x000000, alpha: 0.2 })
      dim.position.set(this.px(at.x), this.px(at.y))
      dim.alpha = 0
      this.underFxLayer.addChild(dim)
      tween(dim, { alpha: 1 }, 30, { channel: 'fx' })
      tween(dim, { alpha: 0 }, 40, {
        delay: 30,
        channel: 'fx',
        onDone: () => {
          if (!dim.destroyed) dim.destroy()
        },
      })
      const neighbors: XY[] = [
        { x: at.x - 1, y: at.y },
        { x: at.x + 1, y: at.y },
        { x: at.x, y: at.y - 1 },
        { x: at.x, y: at.y + 1 },
        { x: at.x - 1, y: at.y - 1 },
        { x: at.x + 1, y: at.y - 1 },
        { x: at.x - 1, y: at.y + 1 },
        { x: at.x + 1, y: at.y + 1 },
      ]
      for (const n of neighbors) {
        const sp = this.sprites.get(this.key(n.x, n.y))
        if (!sp || sp.destroyed) continue
        if (hasTween(sp.position)) continue // 修正5：移動中の駒は吸引をスキップ（古い座標への160msピン留め防止）
        const bx = sp.position.x
        const by = sp.position.y
        const ang = Math.atan2(this.px(at.y) - by, this.px(at.x) - bx)
        const pull = S * (0.02 + this.rnd() * 0.015) // 2-3px相当（セル比率換算）
        tween(sp.position, { x: bx + Math.cos(ang) * pull, y: by + Math.sin(ang) * pull }, 70, { ease: easeOutCubic, channel: 'fx' })
        tween(sp.position, { x: bx, y: by }, 90, { delay: 70, channel: 'fx' })
      }
    }, 'fx')
  }

  /** 誕生イベント 105-250ms：星片8-12＋放射線6-8（系統色。通常消去の火花とは専用色/形にする） */
  private birthBurstFx(at: XY, t: number, color: number) {
    const S = this.S
    delay(t, () => {
      const starN = 8 + Math.floor(this.rnd() * 5) // 8-12
      for (let i = 0; i < starN; i++) {
        const g = this.acquireG(this.overFxLayer)
        const r = 3.2
        g.moveTo(0, -r)
          .lineTo(r * 0.32, -r * 0.32)
          .lineTo(r, 0)
          .lineTo(r * 0.32, r * 0.32)
          .lineTo(0, r)
          .lineTo(-r * 0.32, r * 0.32)
          .lineTo(-r, 0)
          .lineTo(-r * 0.32, -r * 0.32)
          .closePath()
          .fill(color)
        g.position.set(this.px(at.x), this.px(at.y))
        const a = (i / starN) * Math.PI * 2 + this.rnd() * 0.4
        const d = S * (0.45 + this.rnd() * 0.5)
        const dur = 260 + this.rnd() * 140
        tween(g.position, { x: this.px(at.x) + Math.cos(a) * d, y: this.px(at.y) + Math.sin(a) * d }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0, rotation: (this.rnd() - 0.5) * 4 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
      const rayN = 6 + Math.floor(this.rnd() * 3) // 6-8
      for (let i = 0; i < rayN; i++) {
        const ray = this.acquireG(this.overFxLayer)
        ray.roundRect(0, -S * 0.03, S * 0.5, S * 0.06, S * 0.03).fill({ color, alpha: 0.85 })
        ray.position.set(this.px(at.x), this.px(at.y))
        ray.rotation = (i / rayN) * Math.PI * 2
        ray.scale.set(0.15, 1)
        tween(ray.scale, { x: 1 }, 180, { ease: easeOutCubic, channel: 'fx' })
        tween(ray, { alpha: 0 }, 220, { delay: 80, channel: 'fx', onDone: () => this.releaseG(ray) })
      }
    }, 'fx')
  }

  /** 毒胞子発動：紫の小バースト */
  private violetBurstFx(p: XY, t: number) {
    delay(t, () => {
      for (let i = 0; i < 6; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.circle(0, 0, 2.6).fill(0xb98be0)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.35 + this.rnd() * 0.45)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 300, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0 }, 300, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
  }

  // ---- 可視化第一波①：敵インテントバッジ（fxLayer・board.enemies から都度導出。専用状態は持たない） ----

  /** 敵ごとのインテントバッジを最新状態へ再構成する（play()終端・syncAllから呼ぶ） */
  private updateIntentBadges() {
    const seen = new Set<number>()
    for (const en of this.board.enemies) {
      if (en.hp <= 0) continue
      seen.add(en.id)
      this.paintIntentBadge(en)
    }
    for (const [id, g] of [...this.intentG]) {
      if (!seen.has(id)) {
        this.intentG.delete(id)
        if (!g.destroyed) g.destroy()
      }
    }
  }

  private drawIntentIcon(g: Graphics, kind: IntentKind, r: number) {
    const col = 0xf4e8cf
    if (kind === 'armor') {
      // 盾形（甲殻付与の予告）
      g.moveTo(0, -r)
        .lineTo(r * 0.82, -r * 0.4)
        .lineTo(r * 0.82, r * 0.28)
        .lineTo(0, r)
        .lineTo(-r * 0.82, r * 0.28)
        .lineTo(-r * 0.82, -r * 0.4)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'devour') {
      // 雫形（捕食の予告）
      g.moveTo(0, -r)
        .bezierCurveTo(r * 0.8, r * 0.15, r * 0.62, r, 0, r)
        .bezierCurveTo(-r * 0.62, r, -r * 0.8, r * 0.15, 0, -r)
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'fissure') {
      // X形（崩落・封鎖の予告）
      const w = r * 0.3
      g.moveTo(-r, -r)
        .lineTo(-r + w, -r)
        .lineTo(r, r - w)
        .lineTo(r, r)
        .lineTo(r - w, r)
        .lineTo(-r, -r + w)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
      g.moveTo(r, -r)
        .lineTo(r - w, -r)
        .lineTo(-r, r - w)
        .lineTo(-r, r)
        .lineTo(-r + w, r)
        .lineTo(r, -r + w)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'drain') {
      // 衝撃波形（酸素を吸い取る予告。息喰み／深匣主の共通アイコン）
      g.arc(0, r * 0.25, r * 0.55, Math.PI * 1.15, Math.PI * 1.85).stroke({ width: r * 0.22, color: col, alpha: 0.92 })
      g.arc(0, r * 0.25, r * 1.0, Math.PI * 1.2, Math.PI * 1.8).stroke({ width: r * 0.16, color: col, alpha: 0.7 })
    } else {
      // 汎用フォールバック（行動の種類が分からない新種）：小粒3つ
      for (const [dx, dy] of [
        [-r * 0.55, r * 0.25],
        [r * 0.55, r * 0.25],
        [0, -r * 0.55],
      ])
        g.circle(dx, dy, r * 0.32).fill({ color: col, alpha: 0.92 })
    }
  }

  /** 1体ぶんのバッジを再描画（新規なら生成）。位置は敵セル内側の右上隅に収め、駒には絶対にかぶらない */
  private paintIntentBadge(en: EnemyInstance) {
    const S = this.S
    const intent: EnemyIntent = enemyIntent(en, this.board.run?.blessings ?? [])
    // 行動を持たない敵（swarm）はバッジ自体を出さない＝「読むものが無い」ことを画面から消す
    if (intent.kind === 'none') {
      const old = this.intentG.get(en.id)
      if (old) {
        this.intentG.delete(en.id)
        if (!old.destroyed) old.destroy()
      }
      return
    }
    // ボスは全幅を占有するため、身体の右端セルに代表させる（通常敵と同じ経路に統合）
    const c = en.kind === 'boss' ? en.cells[en.cells.length - 1] : en.cells[0]
    if (!c) return
    const cellX = c.x
    const cellY = c.y
    let host = this.intentG.get(en.id)
    const isNew = !host || host.destroyed
    if (isNew) {
      host = new Container()
      this.uiFxLayer.addChild(host)
      this.intentG.set(en.id, host)
    }
    const h = host!
    h.removeChildren().forEach((c) => c.destroy())
    if (isNew) {
      // 可視化第一波①：インテントバッジ自体のタップでも野帳シートを開く（[C]「敵本体／インテントバッジのタップ」）
      h.eventMode = 'static'
      h.cursor = 'pointer'
      h.on('pointertap', (e) => {
        e.stopPropagation()
        this.onEnemyTap?.(en)
      })
    }
    // 酸素を奪う相手（drain）だけを危険色・太枠・大サイズにする＝「赤いバッジは酸素が減る」の一意な約束
    const danger = intent.kind === 'drain'
    const remaining = intent.turns
    const bw = S * (danger ? 0.37 : 0.32) // 危険バッジは妨害よりわずかに大きく
    const inset = S * 0.08
    h.position.set(cellX * S + S - bw / 2 - inset, cellY * S + bw / 2 + inset)
    // タップ領域は危険/妨害の大小に関わらず最大サイズで確保（バッジの見た目より一回り広めの円）
    const hitR = S * 0.37 * 0.75
    h.hitArea = { contains: (lx: number, ly: number) => lx * lx + ly * ly <= hitR * hitR }
    const bg = new Graphics()
    bg.circle(0, 0, bw / 2)
      .fill({ color: 0x1c1712, alpha: 0.86 })
      .stroke({ width: danger ? 2.1 : 1.4, color: danger ? 0xe0503a : 0xd9c9a0, alpha: danger ? 0.95 : 0.75 })
    h.addChild(bg)
    const icon = new Graphics()
    this.drawIntentIcon(icon, intent.kind, bw * (danger ? 0.32 : 0.3))
    icon.position.set(-bw * 0.16, -bw * 0.02)
    h.addChild(icon)
    // 危険バッジは奪われる酸素量、妨害バッジは従来どおり残りターン数を出す
    const numT = new Text({
      text: danger ? String(intent.oxygen ?? '?') : String(remaining),
      style: { fill: danger ? 0xffcabb : 0xf4e8cf, fontSize: bw * (danger ? 0.46 : 0.5), fontFamily: FONT, fontWeight: 'bold' },
    })
    numT.anchor.set(0.5)
    numT.position.set(bw * 0.24, bw * 0.06)
    h.addChild(numT)
    const meta = h as unknown as { __pulsing?: boolean; __baseY?: number }
    meta.__baseY = h.position.y
    const urgent = remaining <= 1 // 点滅タイミングは攻撃/妨害いずれも「残りターン」基準で現行どおり
    if (urgent) {
      if (!meta.__pulsing) {
        meta.__pulsing = true
        this.pulseIntentBadge(h)
      }
    } else {
      meta.__pulsing = false
      h.alpha = 0.75
      h.scale.set(1)
    }
  }

  /** 残り1ターンの間だけ、ゆっくり点滅+浮上を繰り返す（うるさくしない：alpha 0.75⇄1・微小な上下動のみ） */
  private pulseIntentBadge(host: Container) {
    const meta = host as unknown as { __pulsing?: boolean; __baseY?: number }
    if (host.destroyed || !meta.__pulsing) return
    const baseY = meta.__baseY ?? host.position.y
    tween(host, { alpha: 1 }, 460, {
      onDone: () => {
        if (host.destroyed || !meta.__pulsing) return
        tween(host, { alpha: 0.75 }, 460, { onDone: () => this.pulseIntentBadge(host) })
      },
    })
    tween(host.position, { y: baseY - this.S * 0.06 }, 460, {
      onDone: () => {
        if (host.destroyed || !meta.__pulsing) return
        tween(host.position, { y: baseY }, 460)
      },
    })
  }

  /** 行動の予告：バッジを一瞬強く光らせてから、呼び出し側が実行イベントを再生する（予告→実行） */
  private flashIntentBadge(enemyId: number, t: number) {
    const g = this.intentG.get(enemyId)
    if (!g || g.destroyed) return
    delay(t, () => {
      if (g.destroyed) return
      tween(g, { alpha: 1 }, 90, { channel: 'fx' })
      tween(g.scale, { x: 1.6, y: 1.6 }, 130, {
        channel: 'fx',
        onDone: () => {
          if (g.destroyed) return
          tween(g.scale, { x: 1, y: 1 }, 170, { ease: easeOutCubic, channel: 'fx' })
        },
      })
    }, 'fx')
  }

  // ---- 可視化第一波③：爆発鉱石の常時発光 ----

  /** 爆発鉱石（volatile化した駒）の常時ゆらぐ淡いオレンジ発光。cellのpieceが差し替わる/消えるまで帳簿で管理 */
  private makeVolatileOverlay(x: number, y: number, t = 0) {
    const k = this.key(x, y)
    const old = this.volatileG.get(k)
    if (old && !old.destroyed) return // 既にある（reconcile経由の二重生成防止）
    const S = this.S
    const g = new Graphics()
    g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0xff8a3d, alpha: 1 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.volatileG.set(k, g)
    const loop = () => {
      if (g.destroyed || this.volatileG.get(k) !== g) return
      tween(g, { alpha: 0.42 }, 560, {
        onDone: () => {
          if (g.destroyed || this.volatileG.get(k) !== g) return
          tween(g, { alpha: 0.16 }, 560, { onDone: loop })
        },
      })
    }
    tween(g, { alpha: 0.16 }, 200, { delay: t, onDone: loop })
  }

  /** 破壊された爆発鉱石の発光を片付ける（popPieceAtから共通で呼ぶ） */
  private clearVolatileOverlay(p: XY, t: number) {
    const k = this.key(p.x, p.y)
    const g = this.volatileG.get(k)
    if (!g) return
    this.volatileG.delete(k)
    if (!g.destroyed)
      tween(g, { alpha: 0 }, 150, {
        delay: t,
        onDone: () => {
          if (!g.destroyed) g.destroy()
        },
      })
  }

  // ---- 可視化第一波：小さな浮遊ラベル（因果の実況・強化発動アピール共通） ----

  /** まだ消えていない浮遊ラベル（重なり避けの当たり判定に使う。各自 destroy で自然に抜ける） */
  private liveFloatLabels: Text[] = []

  /**
   * 小さな浮遊ラベル（明朝・小・上昇して消える）。token-spawn/gear-trigger/爆発鉱石変換/upgrade-fire で共用。
   * 出所が違うラベルが同じマスに同時に出ると重なって両方読めなくなる（実測：深度22の層頭で「＋胞子」と「毒胞子」）。
   * 発火数は深層で増える一方なので、生きているラベルと重なる位置なら1行ぶんずつ上へ積む。
   */
  private floatLabelFx(p: XY, text: string, color: number, t: number, yOffset = -0.15) {
    delay(t, () => {
      const txt = new Text({
        text,
        style: { fill: color, fontSize: this.S * 0.2, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
      })
      txt.anchor.set(0.5)
      const x = this.px(p.x)
      let y = this.px(p.y) + this.S * yOffset
      this.liveFloatLabels = this.liveFloatLabels.filter((o) => !o.destroyed)
      const hits = (yy: number) =>
        this.liveFloatLabels.some((o) => Math.abs(o.position.x - x) < this.S * 0.6 && Math.abs(o.position.y - yy) < this.S * 0.26)
      for (let i = 0; i < 4 && hits(y); i++) y -= this.S * 0.28
      txt.position.set(x, y)
      this.liveFloatLabels.push(txt)
      this.uiFxLayer.addChild(txt)
      tween(txt.position, { y: txt.position.y - this.S * 0.5 }, 520, { ease: easeOutCubic, channel: 'fx' })
      tween(txt, { alpha: 0 }, 360, {
        delay: 200,
        channel: 'fx',
        onDone: () => {
          if (!txt.destroyed) txt.destroy()
        },
      })
    }, 'fx')
  }

  /** 可視化第二波③：妨害の実行元→対象セルへ細い線を1本引く（因果＝「どの敵がやったか」を示す）。フェードのみで消える */
  private causeLineFx(enemyId: number, to: XY, color: number, t: number) {
    const cells = this.enemyCellsCache.get(enemyId)
    const from = cells?.[0]
    if (!from || (from.x === to.x && from.y === to.y)) return
    delay(t, () => {
      const g = new Graphics()
      g.moveTo(this.px(from.x), this.px(from.y))
        .lineTo(this.px(to.x), this.px(to.y))
        .stroke({ width: this.S * 0.045, color, alpha: 0.7 })
      this.fxLayer.addChild(g)
      tween(g, { alpha: 0 }, 380, {
        delay: 120,
        channel: 'fx',
        onDone: () => {
          if (!g.destroyed) g.destroy()
        },
      })
    }, 'fx')
  }

  /** 可視化第二波②：酸素強奪の起点（自セル上の赤い一瞬のバースト）。着弾側（酸素ゲージ）の演出は main.ts の onOxygenDrained が担う */
  private enemyAttackTelegraphFx(enemyId: number, t: number) {
    const cells = this.enemyCellsCache.get(enemyId)
    if (!cells || !cells.length) return
    const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
    const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.28).fill({ color: 0xe0503a, alpha: 0.8 })
      g.position.set(this.px(cx), this.px(cy))
      this.fxLayer.addChild(g)
      tween(g.scale, { x: 1.9, y: 1.9 }, 220, { ease: easeOutCubic, channel: 'fx' })
      tween(g, { alpha: 0 }, 220, { channel: 'fx', onDone: () => g.destroy() })
    }, 'fx')
  }

  /** 強化発動：起点セルに小さな金フラッシュ（ラベルは floatLabelFx が別途出す） */
  private upgradeFlashFx(p: XY, t: number) {
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.14).fill({ color: 0xf2c14e, alpha: 0.85 })
      g.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(g)
      tween(g.scale, { x: 2.2, y: 2.2 }, 240, { ease: easeOutCubic, channel: 'fx' })
      tween(g, { alpha: 0 }, 240, { channel: 'fx', onDone: () => g.destroy() })
    }, 'fx')
  }

  private makeGround(x: number, y: number, level: 1 | 2) {
    const S = this.S
    const tex = spriteTexture(level === 2 ? 'ground_thick' : 'ground_thin')
    if (tex) {
      const sp = new Sprite(tex)
      sp.width = S
      sp.height = S
      sp.position.set(x * S, y * S)
      this.groundLayer.addChild(sp)
      this.groundG.set(this.key(x, y), sp)
      return
    }
    const g = new Graphics()
    g.roundRect(2, 2, S - 4, S - 4, 6).fill({ color: 0x4f7a4a, alpha: level === 2 ? 0.85 : 0.5 })
    g.position.set(x * this.S, y * this.S)
    this.groundLayer.addChild(g)
    this.groundG.set(this.key(x, y), g)
  }

  // ---- 可視化第二波：連鎖数の常駐表示（codex_consult [D]-3。同じコンテナを更新して鼓動させる） ----

  /** 連鎖数表示コンテナを確保（初回のみ生成。以後は使い回す） */
  private ensureChainCounter(): { host: Container; text: Text; glow: Graphics } {
    if (this.chainCounterG && !this.chainCounterG.destroyed && this.chainCounterText && this.chainCounterGlow) {
      return { host: this.chainCounterG, text: this.chainCounterText, glow: this.chainCounterGlow }
    }
    const host = new Container()
    host.position.set((W * this.S) / 2, this.S * 0.56)
    const glow = new Graphics()
    host.addChild(glow)
    const text = new Text({
      text: '',
      style: { fill: 0xfff1d0, fontSize: this.S * 0.46, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 5 } },
    })
    text.anchor.set(0.5)
    host.addChild(text)
    host.alpha = 0
    this.uiFxLayer.addChild(host)
    this.chainCounterG = host
    this.chainCounterText = text
    this.chainCounterGlow = glow
    return { host, text, glow }
  }

  /** 連鎖数表示を更新して鼓動させる。5連鎖から金縁、8連鎖から常時微発光（新規Textは重ねない） */
  private updateChainCounter(chain: number, t: number) {
    if (chain < 2) return
    const { host, text, glow } = this.ensureChainCounter()
    const ep = this.epoch
    delay(t, () => {
      if (ep !== this.epoch || host.destroyed) return
      text.text = `${chain} 連鎖`
      text.style.stroke = { color: chain >= 5 ? 0xe8b33c : 0x2a1c10, width: 5 }
      glow.clear()
      if (chain >= 8) glow.circle(0, 0, this.S * 0.9).fill({ color: 0xf2c14e, alpha: 0.22 })
      host.alpha = 1
      host.scale.set(1.14)
      tween(host.scale, { x: 1, y: 1 }, 160, { ease: easeOutBack, channel: 'fx' })
    }, 'fx')
  }

  /** 連鎖数表示をフェードアウト（このplay()呼び出しの終端で。次の一手までに消す） */
  private fadeChainCounter(t: number) {
    const host = this.chainCounterG
    if (!host) return
    const ep = this.epoch
    delay(t, () => {
      if (ep !== this.epoch || host.destroyed) return
      tween(host, { alpha: 0 }, 260, { channel: 'fx' })
    }, 'fx')
  }

  // ---- イベント→タイムライン ----

  /** 新しい手が触る駒だけ、進行中トゥイーンを終端へ飛ばす（選択的snap。rm_tempo.md §8 P3 Step2）。
   *  snap は onDone を発火するため、落下→着地スカッシュのような連鎖予約もその場で畳み切れる。
   *  同じ手の中で自分が予約したトゥイーンを壊さないよう、1手につき駒ごとに一度しか撃たない */
  private snapPieceForMove(sp: Sprite) {
    if (this.moveTouched.has(sp)) return
    this.moveTouched.add(sp)
    // 修正4：補充駒はalpha=0のまま盤外(y=-0.8S)で delay 予約中のことがある。その状態でsnapすると
    // from未確定のtweenが即toへ書き込まれ、盤外→最終セルへ0フレームでワープして見える（テレポート
    // 知覚の主因の一つ）。alpha=0＝盤外待機中のときだけ、短いキャッチアップtweenに差し替える
    // 順序の規約：position → scale → sp本体（alpha）の順で畳む。sp本体のsnapはonDone（destroy）を
    // 発火しうるので必ず最後。snap()はtry/catchなしで書き込むため、破棄後のscale等に触ると落ちる
    if (sp.alpha === 0) {
      snapSoft(sp.position)
      snap(sp.scale)
      snapSoft(sp)
    } else {
      snap(sp.position)
      snap(sp.scale)
      snap(sp)
    }
  }

  /** destroy待ち（popPieceAt等）の駒をセル台帳へ登録する（修正3）。どの手で消えた駒かも記録する */
  private addDoomed(k: string, sp: Sprite) {
    const entry = { sp, mv: this.moveSeq }
    const list = this.doomedByCell.get(k)
    if (list) list.push(entry)
    else this.doomedByCell.set(k, [entry])
    if (DIAG) opLog('doom+', k, sp, this.moveSeq)
  }

  /** destroy直前に台帳から外す（onDoneでsp.destroy()する直前に呼ぶ） */
  private removeDoomed(k: string, sp: Sprite) {
    const list = this.doomedByCell.get(k)
    if (!list) return
    const idx = list.findIndex((e) => e.sp === sp)
    if (idx >= 0) {
      list.splice(idx, 1)
      if (DIAG) opLog('doom-', k, sp, this.moveSeq)
    }
    if (list.length === 0) this.doomedByCell.delete(k)
  }

  /** 指定セルのdoomed駒をまとめてsnapし、destroyまで畳み切る（修正3：snap→onDone発火→sp.destroy()）。
   *  play()がswap/fall/refill/popPieceAtでセルに触れるたびに呼び、旧駒と新駒の二重表示を防ぐ。
   *  **同じ手（moveSeq一致）の駒は畳まない**：いま予約したばかりの消滅演出を自分の後続イベント
   *  （同じセルへの落下・補充）が即座に畳むと、連鎖で消える予定の駒がスワップの瞬間に透明化してしまう
   *  （2026-08-15 オーナー報告の回帰。畳むべきは「前の手」の残骸だけ） */
  private snapDoomedAt(k: string) {
    const list = this.doomedByCell.get(k)
    if (!list || !list.length) return
    for (const e of list.slice()) {
      if (e.sp.destroyed) {
        this.removeDoomed(k, e.sp) // reconcile等が先に破棄した個体（Codexレビュー3回目：破棄済みへsnapすると落ちる）
        continue
      }
      if (e.mv === this.moveSeq) continue // この手の消滅予約は生かす（演出はこれから再生される）
      // position → scale → sp本体の順（snapPieceForMoveと同じ規約）。sp本体のsnapがonDoneでdestroyを
      // 発火するため、destroy後にscale/positionへ書き込まない
      snap(e.sp.position)
      snap(e.sp.scale)
      snap(e.sp)
    }
  }

  /** 帳簿の上書き前に、そこに居座る**別の生きたスプライト**を畳む（2026-08-15 幽霊調査）。
   *  黙って sprites.set で上書きすると、古いスプライトが帳簿から漏れて alpha=1 のまま盤上に
   *  置き去りになる（幽霊）。上書きされる側はエンジン上もう存在しない駒なので、tweenを畳んで即消す */
  private foldStaleAt(k: string, keep?: Sprite) {
    const old = this.sprites.get(k)
    if (!old || old === keep || old.destroyed) return
    snap(old.position)
    snap(old.scale)
    snap(old) // destroy系のonDoneがあればここで走る
    if (!old.destroyed) old.destroy()
    if (DIAG) {
      counters.staleFolded++
      opLog('fold', k, old, this.moveSeq)
    }
    console.debug('[yacho] stale sprite folded at', k)
  }

  /** 幽霊掃除（2026-08-15 幽霊調査）：帳簿にもdoomed台帳にも無く、tweenも一切持たない完全放置の
   *  スプライトを毎手の冒頭で破棄する。終端のreconcileは盤面静止まで走らないため、連打中に生まれた
   *  幽霊はこの掃除だけが拾える（実測：CPU5倍遅延の連打40手で幽霊が5秒以上滞留していた） */
  private sweepOrphans() {
    const mapped = new Set<Sprite>(this.sprites.values())
    const doomed = new Set<Sprite>()
    for (const list of this.doomedByCell.values()) for (const e of list) doomed.add(e.sp)
    let n = 0
    for (const ch of [...this.pieceLayer.children]) {
      const sp = ch as Sprite
      if (sp.destroyed || mapped.has(sp) || doomed.has(sp)) continue
      if (hasTween(sp) || hasTween(sp.position) || hasTween(sp.scale)) continue
      if (DIAG) report('orphanSwept', 'orphan swept', { sprite: dumpSprite(sp), ops: recentOps(undefined, 8) })
      sp.destroy()
      n++
    }
    if (n > 0) console.debug('[yacho] orphan swept', n)
  }

  /** 計器（C案移行 Phase1・codex_arch_review.md §1-5）：3帳簿（sprites / doomedByCell / pieceLayer.children）
   *  の全単射チェック。違反は counters.ledger に計上し、個体ダンプと直近履歴を添えて報告する。
   *  DIAG時のみ呼ばれる（play()冒頭と reconcile 末尾）。挙動は一切変えない＝観測のみ */
  private auditLedgers(tag: string) {
    const seen = new Map<Sprite, string>()
    for (const [k, sp] of this.sprites) {
      if (seen.has(sp)) report('ledger', 'sprite mapped by two cells', { tag, k, other: seen.get(sp), sprite: dumpSprite(sp), ops: recentOps(k, 6) })
      seen.set(sp, k)
      if (sp.destroyed) report('ledger', 'mapped sprite is destroyed', { tag, k, sprite: dumpSprite(sp), ops: recentOps(k, 6) })
      else if (sp.parent !== this.pieceLayer) report('ledger', 'mapped sprite has wrong parent', { tag, k, sprite: dumpSprite(sp) })
    }
    for (const [k, list] of this.doomedByCell)
      for (const e of list) {
        if (seen.has(e.sp)) report('ledger', 'sprite is both mapped and doomed', { tag, k, mappedAt: seen.get(e.sp), sprite: dumpSprite(e.sp), ops: recentOps(k, 6) })
        // 破棄済みのdoomed残留はreconcileが掃除するまでの過渡状態なので、監査点では違反として報告する
        if (e.sp.destroyed && tag === 'reconcile-end') report('ledger', 'doomed entry is destroyed', { tag, k, sprite: dumpSprite(e.sp) })
      }
    const doomedSet = new Set<Sprite>()
    for (const list of this.doomedByCell.values()) for (const e of list) doomedSet.add(e.sp)
    for (const ch of this.pieceLayer.children) {
      const sp = ch as Sprite
      if (sp.destroyed || seen.has(sp) || doomedSet.has(sp)) continue
      // どの帳簿にも属さない可視の駒＝幽霊候補。tweenを持つ間は演出中の可能性があるため alpha と合わせて判定
      if (sp.alpha > 0.1 && !hasTween(sp) && !hasTween(sp.position) && !hasTween(sp.scale))
        report('ledger', 'visible sprite in no ledger', { tag, sprite: dumpSprite(sp), sid: sidOf(sp) })
    }
  }

  /** タイムライン予算の保険（C）：連鎖が極端に長くなった場合の最終防衛線。sprites に登録済み・
   *  destroyされていない・doomedでない・エンジン上も同セルに駒がある・alpha<0.999・alpha宛の生存tween
   *  が無い、という条件が揃った駒は「補充等のフェード予約を(圧縮やbugで)取りこぼして透明のまま残った」
   *  とみなし、100msでフェードインする。reconcile()は最終的にalpha=1へ直すため、Bが正しく機能していれば
   *  Cは通常運用で一度も発火しないのが正常（codex_timeline_review.md §2-C・実装項目8） */
  private repairStrandedAlpha(): void {
    const doomed = new Set<Sprite>()
    for (const list of this.doomedByCell.values()) for (const e of list) doomed.add(e.sp)
    for (const [k, sp] of this.sprites) {
      if (sp.destroyed || doomed.has(sp) || sp.alpha >= 0.999) continue
      if (hasTweenProperty(sp, 'alpha')) continue
      const [xs, ys] = k.split(',')
      const c = this.board.at(Number(xs), Number(ys))
      if (!c || c.block || !c.piece) continue
      // Codex検収：kind不一致（エンジン上は別の駒に置き換わっている）の古いスプライトをフェードインしない。
      // その差し替え自体は終端のreconcileが担う
      if ((sp as unknown as { __kind?: string }).__kind !== pieceKey(c.piece)) continue
      // 計器：個体ID・所有状態・履歴つきの構造化ダンプ（codex_arch_review.md §1-1。従来のログでは個体追跡ができない）
      if (DIAG) report('repairAlpha', 'repairStrandedAlpha fired', { k, sprite: dumpSprite(sp), ops: recentOps(k, 8) })
      console.debug('[yacho] repairStrandedAlpha: fading in stranded piece at', k, c.piece.kind)
      tween(sp, { alpha: 1 }, 100)
    }
  }

  /** 盤面演出が静止しているか（並走中のタイムラインが尽きたか）。呼び出し側はこれを見てからヒントを出す */
  isQuiet(): boolean {
    return now() >= this.timelineEndAbs
  }

  /** アイドルヒント（RM式）：対象2駒が**入れ替える方向へ寄って戻る**（0.11S、160ms×往復×2）＋
   *  拡大1.08＋駒の下に灯色の光輪。'fx'チャンネル・音なし。RMのヒントは駒自身が交換方向へずれる
   *  シマーで「どの手か」だけでなく「どう動かすか」まで伝える——揺れ/光だけの旧実装より一段説明的
   *  （2026-08-15 オーナー「もう少しアニメーションを使ってるイメージ」への対応）。
   *  帳簿に無い/destroy済みの駒は黙って無視する（消えかけの駒を揺らして事故る方が悪い） */
  showHint(a: XY, b: XY): void {
    this.clearHint()
    const pair: [XY, XY][] = [
      [a, b],
      [b, a],
    ]
    for (const [p, toward] of pair) {
      const sp = this.sprites.get(this.key(p.x, p.y))
      if (!sp || sp.destroyed) continue
      const base = this.bs(sp)
      const hx = this.px(p.x)
      const hy = this.px(p.y)
      // 交換相手の方向へ寄る変位（0.11S＝1マスの1割強。読めるが動きすぎない）
      const nx = hx + Math.sign(this.px(toward.x) - hx) * this.S * 0.11
      const ny = hy + Math.sign(this.px(toward.y) - hy) * this.S * 0.11
      this.hintSprites.push({ sp, base, hx, hy })
      // 光輪（駒の下・underFxLayer）。灯と同じ真鍮系の色＝「おすすめ」の色をこれで固定する
      const glow = new Graphics()
      glow.circle(0, 0, this.S * 0.56).fill({ color: 0xf1d189, alpha: 0.5 })
      glow.circle(0, 0, this.S * 0.44).fill({ color: 0xfff3cf, alpha: 0.45 })
      glow.position.set(hx, hy)
      glow.alpha = 0
      this.underFxLayer.addChild(glow)
      this.hintGlows.push(glow)
      const pulse = (times: number) => {
        if (sp.destroyed) return
        tween(sp.scale, { x: base * 1.08, y: base * 1.08 }, 160, { ease: easeOutCubic, channel: 'fx' })
        tween(sp.position, { x: nx, y: ny }, 160, { ease: easeOutCubic, channel: 'fx' })
        if (!glow.destroyed) tween(glow, { alpha: 1 }, 160, { ease: easeOutCubic, channel: 'fx' })
        delay(
          160,
          () => {
            if (!sp.destroyed) {
              tween(sp.scale, { x: base, y: base }, 160, { ease: easeOutCubic, channel: 'fx' })
              tween(sp.position, { x: hx, y: hy }, 160, { ease: easeOutCubic, channel: 'fx' })
            }
            if (!glow.destroyed) tween(glow, { alpha: 0 }, 160, { ease: easeOutCubic, channel: 'fx' })
            if (times > 1) delay(200, () => pulse(times - 1), 'fx')
          },
          'fx',
        )
      }
      pulse(2)
    }
  }

  /** アイドルヒントの動きを止め、定位置・基準スケールへ戻す */
  clearHint(): void {
    for (const e of this.hintSprites) {
      if (e.sp.destroyed) continue
      cancel(e.sp.scale)
      cancel(e.sp.position)
      e.sp.scale.set(e.base)
      e.sp.position.set(e.hx, e.hy)
    }
    this.hintSprites = []
    for (const g of this.hintGlows) {
      cancel(g)
      if (!g.destroyed) g.destroy()
    }
    this.hintGlows = []
  }

  /** 1手ぶんのローカル状態を生成する前処理（C案移行 Phase4 Stage A：旧play()冒頭の逐語移設）。
   *  evsを見ない部分だけをここで済ませ、evs依存のswarmChain/rampageActiveはscheduleEvents()側で行う */
  private beginMove(): MoveCtx {
    // rm_tempo.md §7(b)/§8 P3：割込で前の演出を切らない（RM実測 §4「並行続行」）。
    // 旧実装の completeChannel('board') 全断は ①移動中の駒のテレポート ②未消化予約の同一フレーム一斉発火
    // ③WebAudio絶対時刻予約（sfx）とのズレ を生んでいた。現在はこの手が触る駒だけを snapPieceForMove() で
    // 終端へ飛ばし、前の手の落下・破片・ビームは予定どおり並走させる（終端の reconcile が最後の保険）
    if (FULL_SNAP_ON_INPUT) completeChannel('board')
    // 前の手の残り演出を「切らずに早送り」する（2026-08-15 重なり調査）。深い連鎖は数秒先まで消滅予約が
    // 残っており、割込んだ新しい手の駒が先に到着して消え待ち駒と共存して見える。未開始予約を一様圧縮して
    // 共存の窓を縮める（順序保存＝全演出は再生される。JUICE §0-5 と両立）
    // 'cue'（発火前のFX/SE予約）も'board'と同じ係数で圧縮しないと、割込時に盤面だけ先に進み
    // SEが元の時刻に残ってズレる（codex_timeline_review.md §2「AudioContextとの同期」）
    compressChannel('board', 0.45)
    compressChannel('cue', 0.45)
    // timelineEndAbs はこのplay()末尾でchannelEndMany(['board','cue'])から実測値へ引き直す（タイムライン
    // 予算B）。開始済みtweenはcompressChannelの対象外なので、進行中の長い落下の途中でreconcileが早発する
    // ことはない（channelEndが開始済みtweenの残り時間 dur-t をそのまま返すため過小評価にはならない）
    this.moveSeq++
    this.moveTouched = new WeakSet()
    this.sweepOrphans() // 幽霊掃除（2026-08-15）。reconcileが走れない連打中の保険
    this.repairStrandedAlpha() // タイムライン予算C：透明のまま取り残された駒の保険（play()冒頭）
    if (DIAG) this.auditLedgers('play-start') // 計器：3帳簿の全単射チェック（codex_arch_review.md §1-5）
    // 可視化第二波：演出用の決定的乱数を1手ごとに再シード（QA比較の安定のため Math.random() は使わない）
    this.fxSeed = (this.fxSeed * 48271 + 12345) % 0x7fffffff || 1
    this.fxRand = mulberry32(this.fxSeed)
    resetMoveBudget() // 1手あたりの振動回数の予算をここで戻す（JUICE.md §1③）
    return {
      t: 0,
      chainSeen: 0,
      chainStartT: 0, // 連鎖セグメントの開始時刻（ビートはここから加速カーブで刻む＝落下完了を待つ）
      upgradeFireCounts: new Map<string, number>(), // 可視化第一波②：このタイムライン内での強化ごとの発動回数
      disruptLabelCount: 0, // 可視化第二波③：因果ラベルは1ターン（=このplay呼び出し1回）に最大2個まで
      goalFxCount: 0, // 目標収集：この手で何本目の飛翔か（破片4件・飛翔6件で打ち止める）
      hitstop: new HitstopBudget(), // 600ms窓で最大80msに制限するヒットストップ予算（codex_consult [D]-2/4）
      // ---- タイムライン予算（codex_timeline_review.md §4-3/4-5）：special-fireのセグメント内サブ拍 ----
      fireSegOffset: 0, // 現在の連鎖セグメント内でspecial-fireが主時計へ足した量（FIRE_SEGMENT_CAPで頭打ち）
      fireGlobalBudget: FIRE_GLOBAL_BUDGET, // play()全体でspecial-fireが主時計へ足せる残り予算（セグメント数に関わらず総和を保証）
      lastFireSfxT: -1, // 直近にSEを鳴らしたfire拍のt（同拍への多重SEを防ぐ＝「同拍1音まで」）
      visibleFireCount: 0, // このplay()全体を通したspecial-fireの通し番号（品質3段階の判定に使う）
      aggregateFireCounts: new Map<string, number>(), // 集約域（25発以降）：kind別の間引き件数
      aggregateFireAt: new Map<string, XY>(), // 集約域：最後に発火した位置（×N表示の置き場所）
      // ---- win-drain（勝利ドレイン）のタイミング予算（codex_timeline_review.md §3・実装項目6） ----
      winDrainCount: 0,
      winDrainTotal: 0,
      // 補充のトレイン（2026-08-15）：同じ拍・同じ列の補充駒を「上空に1マス間隔で整列→一斉落下」させる
      // ための収集器。キーは `${拍t}|${列x}`。実際の湧き位置・落下tweenはイベント走査の後で組む
      refillTrains: new Map<string, { sp: Sprite; row: number; col: number; t: number }[]>(),
      // 盤内の落下も同じキーで収集する。同列・同拍の落下と補充は**同じ遅延・同じ所要時間**で動かす
      // （距離ごとに別durationだと長距離の駒が短距離の駒に追いつき交差する。列内は剛体でしか動かさない）
      columnFalls: new Map<string, { sp: Sprite; toX: number; toY: number; dist: number }[]>(),
      builtDropKeys: new Set<string>(), // トレイン構築済みキーの記録（後続セグメント再生で未構築ぶんだけ構築するため）
      swarmChain: new Map(), // scheduleEvents()冒頭でclassifySwarmChain(evs)の結果に差し替える
      mvDrop: this.moveSeq, // 計器：着地コールバックの世代（codex_arch_review.md §1-6）
      eventIndex: 0, // DIAGタグ用の通しイベント番号
    }
  }

  /** イベント列を主時計に沿って予約する（旧play()のswitchループを逐語移設）。beginMove()で作った
   *  ctxを書き換えながら進む。swarmChain分類とrampageActive判定はevsに依存するためここで行う */
  private scheduleEvents(ctx: MoveCtx, evs: BoardEvent[]): void {
    ctx.swarmChain = this.classifySwarmChain(evs) // swarm連鎖ドミノの段階付け（codex_consult [D]-4）
    // 10連鎖以上を含む手は「暴走時」扱いにし、粒子の同時上限を80→120へ緩める（codex_consult [D]-6）
    this.rampageActive ||= evs.some((ev) => ev.t === 'match' && ev.chain >= 10)
    // 論理は確定済みなので、描画用に「イベント時点のスプライト対応」を移動しながら追う
    // 全イベント共有のハード予算（2026-08-15 実測）：連鎖拍とspecial-fireの予算だけでは足りず、
    // 敵撃破(200ms)・爆発(200ms+ヒットストップ)・特殊駒誕生(35ms)・block-hit等の積み増しが敵の多い層で
    // t を再び数十秒へ爆発させていた（層7実測：41セルが上空で alpha=0 のまま・quiet が永遠に偽）。
    // Codex設計レビューの「漸減ルールではなく全イベントで共有するハード予算にする」の文字通りの実装。
    // 連鎖拍の総和は最大4660ms（22連鎖）なのでキャップ5200msは通常域の拍を一切壊さない。
    // キャップ到達後のイベントは同拍に積まれる＝暴走域の「要約・バッチ化」（JUICE §0-5）
    const T_HARD_CAP = 5200
    for (let ei = 0; ei < evs.length; ei++) {
      const e = evs[ei]
      if (DIAG) setTweenCtx(`m${this.moveSeq}/e${ctx.eventIndex++}/${e.t}`) // 計器：この予約の発注元をtweenへ焼き込む
      if (ctx.t > T_HARD_CAP) ctx.t = T_HARD_CAP
      switch (e.t) {
        case 'swap': {
          const a = this.sprites.get(this.key(e.a.x, e.a.y))
          const b = this.sprites.get(this.key(e.b.x, e.b.y))
          if (a && b) {
            this.snapPieceForMove(a) // 前の手の落下等が残っていたら、この2駒だけ終端へ（他は並走続行）
            this.snapPieceForMove(b)
            this.snapDoomedAt(this.key(e.a.x, e.a.y)) // 修正3：両セルのポップ待ち駒があれば先に畳む
            this.snapDoomedAt(this.key(e.b.x, e.b.y))
            this.mapSwap(this.key(e.a.x, e.a.y), this.key(e.b.x, e.b.y), a, b)
            const move = (sp: Sprite, to: XY, back: boolean) => {
              // 成立スワップは目標セルをわずかに行き過ぎて戻る（手応えの核。JUICE.md §1）
              tween(sp.position, { x: this.px(to.x), y: this.px(to.y) }, T.swap, { delay: ctx.t, ease: easeOutBackSoft })
              if (back)
                tween(sp.position, { x: this.px(back ? e.a.x : to.x), y: this.px(back ? e.a.y : to.y) }, T.swap, {
                  delay: ctx.t + T.swap,
                })
            }
            if (e.illegal) {
              // 行って戻る（往復160ms＝行き90+戻り70。オーバーシュートを付けると「震え」に見えるのでイージングは据え置き。
              // 無くしはしない＝往復自体は残し「なぜ成立しないか」の学習を保つ）
              tween(a.position, { x: this.px(e.b.x), y: this.px(e.b.y) }, T.swapBackGo, { delay: ctx.t })
              tween(b.position, { x: this.px(e.a.x), y: this.px(e.a.y) }, T.swapBackGo, { delay: ctx.t })
              tween(a.position, { x: this.px(e.a.x), y: this.px(e.a.y) }, T.swapBackReturn, { delay: ctx.t + T.swapBackGo })
              tween(b.position, { x: this.px(e.b.x), y: this.px(e.b.y) }, T.swapBackReturn, { delay: ctx.t + T.swapBackGo })
              this.mapSwap(this.key(e.a.x, e.a.y), this.key(e.b.x, e.b.y), b, a) // 不成立：写像を元へ戻す
              ctx.t += T.swapBackGo + T.swapBackReturn
            } else {
              move(a, e.b, false)
              move(b, e.a, false)
              ctx.t += T.swap
            }
          } else if (a || b) {
            // 片方の駒しか帳簿に無い（前の手の消滅・移動と競合した稀ケース）。旧実装は何もせず
            // 帳簿がズレたまま進み、後続の fall の上書きで幽霊を量産していた（2026-08-15 幽霊調査）。
            // 見つかった側だけでも正しいセルへ移し、行き先の居座りは畳む
            const sp = (a ?? b)!
            const fromK = a ? this.key(e.a.x, e.a.y) : this.key(e.b.x, e.b.y)
            const toC = a ? e.b : e.a
            this.snapPieceForMove(sp)
            this.snapDoomedAt(this.key(toC.x, toC.y))
            if (!e.illegal) {
              this.mapMove(fromK, this.key(toC.x, toC.y), sp)
              tween(sp.position, { x: this.px(toC.x), y: this.px(toC.y) }, T.swap, { delay: ctx.t, ease: easeOutBackSoft })
              ctx.t += T.swap
            }
          }
          break
        }
        case 'match': {
          if (e.chain > ctx.chainSeen) {
            // 連鎖ビート＝前セグメント開始から一定拍。1〜6連鎖はCHAIN_BEAT固定、7連鎖以降だけ
            // chainBeatForで逓減させる（タイムライン予算：加速ではなく「暴走域だけ拍を詰める」。
            // JUICE.md §0-5・codex_timeline_review.md §3）
            // steppedではこの加算をしない：前セグメントの完了を既にawaitしており、拍は playSegment() の
            // 開始間隔下限ゲートが担う（加算すると二重待ちになる。codex_c_phase46_plan.md §7.4）
            if (e.chain > 1 && !ctx.stepped) ctx.t = Math.max(ctx.t, ctx.chainStartT + chainBeatFor(e.chain))
            ctx.chainSeen = e.chain
            ctx.chainStartT = ctx.t
            ctx.fireSegOffset = 0 // 新しいセグメントに入ったのでspecial-fireのサブ拍予算をリセット
            ctx.lastFireSfxT = -1
            delay(ctx.t, () => sfx.pop(e.chain), 'cue') // AudioContext絶対時刻の先行予約をやめ、tween時計に合わせて鳴らす
            delay(ctx.t, () => buzz(e.chain >= 5 ? 'chain' : 'pop'), 'fx') // 連鎖段が上がった瞬間だけ鳴らす（1マッチ最大1回）
            this.updateChainCounter(e.chain, ctx.t)
          }
          // 10連鎖以降は通常消去の火花を50%間引き、爆発・特殊生成・敵撃破の粒子だけを残す
          const skipChance = e.chain >= 10 ? 0.5 : 0
          for (const p of e.cells) this.popPieceAt(p, ctx.t, false, skipChance)
          break
        }
        case 'special-fire': {
          // タイムライン予算（codex_timeline_review.md §2-A・§4-3/4-5）：special-fireは連鎖の主時計tへ
          // 無条件で+160msするのをやめ、セグメント開始(chainStartT)からのサブ拍offsetとして配置する。
          // offset自体もFIRE_SEGMENT_CAPで頭打ちにするので、1セグメント内で何十発起きても次の連鎖拍を
          // 無制限に押さない。表示品質は通し番号visibleFireCountで3段階（旧実装は260発なら41.6秒だった）
          const idx = ctx.visibleFireCount
          const tier: 'full' | 'simple' | 'aggregate' =
            idx < FIRE_FULL_LIMIT ? 'full' : idx < FIRE_SIMPLE_LIMIT ? 'simple' : 'aggregate'
          const step = tier === 'full' ? FIRE_SUB_BEAT_FULL : tier === 'simple' ? FIRE_SUB_BEAT_SIMPLE : 0
          // セグメント上限とplay()全体の総額上限、両方の残りで頭打ち（総額上限がセグメント数を跨いだ悪用を塞ぐ）
          const applied = Math.min(step, FIRE_SEGMENT_CAP - ctx.fireSegOffset, ctx.fireGlobalBudget)
          ctx.fireSegOffset += applied
          ctx.fireGlobalBudget -= applied
          const fireT = ctx.chainStartT + ctx.fireSegOffset
          // 盤面状態の反映（駒の消滅）は品質段に関わらず必ず維持する
          this.popPieceAt(e.at, fireT, true) // 発動した特殊駒自身のスプライトを消す（描画残りバグ対策）
          for (const p of e.cleared) this.popPieceAt(p, fireT, true)
          if (tier === 'aggregate') {
            // 25発以降：FX・SE・振動はイベント毎には生成しない。種類ごとに件数だけ数え、末尾で×N表示する
            ctx.aggregateFireCounts.set(e.piece.kind, (ctx.aggregateFireCounts.get(e.piece.kind) ?? 0) + 1)
            ctx.aggregateFireAt.set(e.piece.kind, e.at)
          } else {
            ctx.visibleFireCount++
            this.fireFx(e.at, e.piece, fireT, tier === 'simple') // simple=trueで粒子数を間引く
            if (fireT !== ctx.lastFireSfxT) {
              delay(fireT, () => sfx.fire(e.piece.kind), 'cue') // 同拍1音まで（多重AudioNode生成の防止）
              ctx.lastFireSfxT = fireT
            }
            if (e.piece.kind === 'hitsubo') {
              delay(fireT, () => buzz('blast'), 'fx')
              this.shakeRootDecay(fireT, 4, 160) // 歯車爆弾：3×3相当の揺れ
              ctx.t = Math.max(ctx.t, fireT + ctx.hitstop.request(fireT, 45))
            }
          }
          ctx.t = Math.max(ctx.t, fireT)
          // codex_consult [D]-3：特殊駒発火では連鎖段を0に戻さない。同じ解決内なら連鎖を維持し、音階/低域を積み上げる
          break
        }
        case 'win-drain': {
          // 残手数→特殊駒変換の彗星（1手 約45ms＝実測30-60msの中庸）
          if (e.convertAt) this.cometFx(e.convertAt, ctx.t)
          // win-drainのタイミング予算（実装項目6）：最初のWIN_DRAIN_FULL_COUNT件は45ms、以降20ms、
          // 合計WIN_DRAIN_BUDGET msで頭打ち。残手数が多い層では数百件級になり得るため
          const step = ctx.winDrainCount < WIN_DRAIN_FULL_COUNT ? WIN_DRAIN_STEP_FULL : WIN_DRAIN_STEP_LATER
          ctx.winDrainCount++
          if (ctx.winDrainTotal < WIN_DRAIN_BUDGET) {
            const applied = Math.min(step, WIN_DRAIN_BUDGET - ctx.winDrainTotal)
            delay(ctx.t, () => sfx.drain(this.drainCount++), 'cue')
            ctx.winDrainTotal += applied
            ctx.t += applied
          }
          break
        }
        case 'win-detonate-begin': {
          ctx.t += 350
          break
        }
        case 'combo': {
          // 合成：両方の特殊駒スプライトを消費（描画残りバグ対策）。特殊駒コンボは65msヒットストップ＋root揺れ
          this.popPieceAt(e.from, ctx.t, true)
          this.popPieceAt(e.at, ctx.t, true)
          this.flashFx(e.at, ctx.t)
          delay(ctx.t, () => buzz('blast'), 'fx')
          this.shakeRootDecay(ctx.t, 6, 220)
          ctx.t += ctx.hitstop.request(ctx.t, 65)
          break
        }
        case 'special-born': {
          // 特殊駒生成を「誕生イベント」として演出する（codex_consult [D]-1。最優先＝基準品質のコア）
          this.snapDoomedAt(this.key(e.at.x, e.at.y)) // Codexレビュー3回目P0：前の手の消え待ち駒を先に畳む
          const sp = this.makePiece(e.at.x, e.at.y, e.piece)
          const b = this.bs(sp)
          const style = SPECIAL_BORN_STYLE[e.piece.kind] ?? SPECIAL_BORN_STYLE.default
          const born0 = ctx.t + T.pop
          sp.scale.set(0)
          sp.alpha = 0
          // 0-70ms：周囲の駒を中心へ2-3px吸引＋局所減光（消滅ポップと同時並行）
          this.birthPullFx(e.at, born0)
          // 70-105ms：白コア1フレーム相当＋35msの表示上のヒットストップ（以後の予約時刻を後ろへずらす）
          const stop = ctx.hitstop.request(born0 + 70, 35)
          delay(born0 + 70, () => {
            const core = this.acquireG(this.overFxLayer, 'important')
            core.circle(0, 0, this.S * 0.36).fill({ color: 0xffffff, alpha: 0.95 })
            core.position.set(this.px(e.at.x), this.px(e.at.y))
            tween(core, { alpha: 0 }, 20, { channel: 'fx', onDone: () => this.releaseG(core) })
            buzz('born') // 白コアと同じ瞬間に鳴らす（この delay 自体が予約済みなので素で呼ぶ）
          }, 'fx')
          const scaleUpStart = born0 + 70 + stop
          const rotSign = (e.at.x + e.at.y) % 2 === 0 ? 1 : -1 // 決定的な回転方向（座標由来）
          const rotAmt = ((style.rotDeg * Math.PI) / 180) * rotSign
          sp.rotation = -rotAmt
          tween(sp, { alpha: 1 }, 60, { delay: scaleUpStart })
          tween(sp, { rotation: rotAmt }, 145, { delay: scaleUpStart, ease: easeOutBack })
          tween(sp, { rotation: 0 }, 90, { delay: scaleUpStart + 145, ease: easeOutCubic })
          sp.scale.set(b * 0.55)
          tween(sp.scale, { x: b * 1.18, y: b * 1.18 }, 145, { delay: scaleUpStart, ease: easeOutBack })
          tween(sp.scale, { x: b, y: b }, 90, { delay: scaleUpStart + 145 })
          this.birthBurstFx(e.at, scaleUpStart, style.color)
          delay(born0 + 70, () => sfx.born(e.piece.kind), 'cue')
          // 可視化第一波③：爆発鉱石への変換（特殊駒生成イベントを共用）は一瞬明滅+ラベルで因果を示す
          if (e.piece.kind === 'normal' && e.piece.volatile) {
            this.makeVolatileOverlay(e.at.x, e.at.y, scaleUpStart)
            this.floatLabelFx(e.at, '爆発鉱石！', 0xff8a3d, scaleUpStart, -0.2)
          }
          if (e.piece.kind === 'harpoon') {
            // 誕生時の小さな「回り込み」：構えが定まる仕草として、共通の誕生回転が収まった直後に追加で振る
            const settleAt = scaleUpStart + 145 + 90
            delay(settleAt, () => {
              sp.rotation = (-25 * Math.PI) / 180
              tween(sp, { rotation: 0 }, 180, { ease: easeOutBack })
            })
          }
          ctx.t += stop
          break
        }
        case 'block-hit': {
          if (e.destroyed) delay(ctx.t, () => sfx.block(), 'cue')
          const g = this.blockG.get(this.key(e.at.x, e.at.y))
          if (g) {
            const gg = g
            tween(gg.scale, { x: 1.08, y: 1.08 }, 60, { delay: ctx.t })
            tween(gg.scale, { x: 1, y: 1 }, 100, { delay: ctx.t + 60 })
            // 破壊 or 状態変化（匣→陶片、苔石2層→1層）: 再描画。世代跨ぎ・多重破棄は無効化
            const ep = this.epoch
            delay(ctx.t + T.blockHit, () => {
              if (ep !== this.epoch || gg.destroyed) return
              gg.destroy()
              this.blockG.delete(this.key(e.at.x, e.at.y))
              const c = this.board.at(e.at.x, e.at.y)
              if (c?.block) this.makeBlock(e.at.x, e.at.y)
            })
            if (e.destroyed || e.type === 'hako') this.debrisFx(e.at, ctx.t, e.type === 'kokeishi' ? PAL.stone : PAL.wood)
          }
          break
        }
        case 'goal-progress': {
          const n = ctx.goalFxCount++
          const fxT = ctx.t + GOAL_FX_DELAY[e.goal.type]
          if (n < 4) this.debrisFx(e.at, fxT, GOAL_DEBRIS_COLOR[e.goal.type]) // 既存の粒子プール経由
          if (n < 6) {
            const stagger = Math.min(55, 300 / Math.max(1, Math.min(5, n))) * n
            const ep = this.epoch
            delay(fxT + stagger, () => {
              if (ep !== this.epoch) return
              const gp = this.pieceLayer.toGlobal({ x: this.px(e.at.x), y: this.px(e.at.y) }, GOAL_PT)
              this.onGoalCollect?.(e.index, e.done, { x: gp.x, y: gp.y }, n)
            }, 'fx')
          }
          // t は進めない：目標進捗は match/block-hit の副産物であり、ここでビートを消費すると連鎖テンポが壊れる
          break
        }
        case 'ground-hit': {
          const g = this.groundG.get(this.key(e.at.x, e.at.y))
          if (g) {
            const gg = g
            const left = e.left
            const ep = this.epoch
            delay(ctx.t + T.pop * 0.6, () => {
              if (ep !== this.epoch) return // レベル遷移後の幽霊タイル防止
              gg.destroy()
              this.groundG.delete(this.key(e.at.x, e.at.y))
              if (left > 0) this.makeGround(e.at.x, e.at.y, left as 1 | 2)
            })
          }
          break
        }
        case 'fall': {
          const sp = this.sprites.get(this.key(e.from.x, e.from.y))
          if (sp) {
            this.snapPieceForMove(sp)
            this.snapDoomedAt(this.key(e.to.x, e.to.y)) // 修正3：着地セルにポップ待ち駒が残っていたら先に畳む
            this.mapMove(this.key(e.from.x, e.from.y), this.key(e.to.x, e.to.y), sp) // 行き先の居座りは畳む
            // 落下tweenはここでは張らない。同じ列・同じ拍の落下と補充を**同じ遅延・同じ所要時間**で
            // 動かすため（別々のdurationだと落下距離の長い駒が短い駒に途中で追いつき重なる）、
            // 記録だけして play() 末尾の列ドロップ組みでまとめて張る（2026-08-15 幽霊調査の非幽霊2件）
            const dropKey = `${ctx.t}|${e.to.x}`
            const g = ctx.columnFalls.get(dropKey)
            const item = { sp, toX: e.to.x, toY: e.to.y, dist: Math.abs(e.to.y - e.from.y) }
            if (g) g.push(item)
            else ctx.columnFalls.set(dropKey, [item])
          }
          break
        }
        case 'reroll': {
          // 詰み保険リロール（C案移行Phase3で専用イベント化）：盤上の駒のその場色替え＝クロスフェード
          this.playReroll(e.at, e.piece, ctx.t)
          break
        }
        case 'refill': {
          const k = this.key(e.at.x, e.at.y)
          const already = this.sprites.get(k)
          if (already && !already.destroyed) {
            // 防御的フォールバック：reroll分離後、refillが占有セルへ来ることは無いはずだが、
            // 万一来ても旧挙動（修正6のクロスフェード）で吸収する
            this.playReroll(e.at, e.piece, ctx.t)
            break
          }
          this.snapDoomedAt(k) // 修正3：通常補充でも、このセルにポップ待ち駒が残っていたら先に畳む
          // 補充の駒はここでは湧き位置を決めない。同じ列・同じ拍の補充を「上空に1マス間隔で整列した
          // 剛体トレイン」として一斉に落とすため、いったん記録だけして play() 末尾で位置と落下を組む
          // （2026-08-15 重なり調査：旧実装は全駒が同一点 y=-0.8S に湧き、行あたり14msずらしの個別落下で
          // 列内の密着・追い越し・湧き点のスタックが起きていた＝「補充の駒がきて重なる」の正体）。
          const sp = this.makePiece(e.at.x, e.at.y, e.piece)
          sp.position.y = -this.S * 1.2 // 仮置き（マスクの外）。実位置は末尾のトレイン組みで決まる
          sp.alpha = 0
          const trainKey = `${ctx.t}|${e.at.x}`
          const train = ctx.refillTrains.get(trainKey)
          const item = { sp, row: e.at.y, col: e.at.x, t: ctx.t }
          if (train) train.push(item)
          else ctx.refillTrains.set(trainKey, [item])
          break
        }
        case 'spore-born': {
          this.snapDoomedAt(this.key(e.at.x, e.at.y)) // Codexレビュー3回目P0
          const sp = this.makePiece(e.at.x, e.at.y, { kind: 'spore' })
          const b = this.bs(sp)
          sp.scale.set(0)
          tween(sp.scale, { x: b, y: b }, 250, { delay: ctx.t, ease: easeOutBack })
          break
        }
        case 'spore-rise': {
          this.snapDoomedAt(this.key(e.from.x, e.from.y)) // Codexレビュー3回目P0：両セルの消え待ちを畳む
          this.snapDoomedAt(this.key(e.to.x, e.to.y))
          const sp = this.sprites.get(this.key(e.from.x, e.from.y))
          const other = this.sprites.get(this.key(e.to.x, e.to.y))
          if (sp) {
            this.snapPieceForMove(sp)
            if (other) this.snapPieceForMove(other)
            if (other) this.mapSwap(this.key(e.from.x, e.from.y), this.key(e.to.x, e.to.y), sp, other)
            else this.mapMove(this.key(e.from.x, e.from.y), this.key(e.to.x, e.to.y), sp)
            tween(sp.position, { y: this.px(e.to.y) }, 300, { delay: ctx.t, ease: easeOutCubic })
            if (other) tween(other.position, { y: this.px(e.from.y) }, 300, { delay: ctx.t, ease: easeOutCubic })
          }
          break
        }
        case 'spore-collected': {
          delay(ctx.t, () => sfx.spore(), 'cue')
          const k = this.key(e.at.x, e.at.y)
          const sp = this.sprites.get(k)
          if (sp) {
            this.snapPieceForMove(sp)
            // Codexレビュー3回目P0：胞子の回収演出（250ms上昇フェード）も doomed 台帳へ載せる。
            // 載せないと同セルへの補充が畳めず、旧胞子×新駒の共存になる（popPieceAtを通らない消し方の穴）
            this.mapRetire(k, sp)
            tween(sp, { alpha: 0 }, 250, { delay: ctx.t })
            tween(sp.position, { y: sp.position.y - this.S }, 250, {
              delay: ctx.t,
              onDone: () => {
                this.removeDoomed(k, sp)
                if (!sp.destroyed) sp.destroy()
              },
            })
          }
          break
        }
        // ---- ローグライク拡張（ROGUE.md §3/§5/§6）：フック・敵・ターン・環境 ----
        case 'token-spawn': {
          this.makeSporeTokenSprite(e.at.x, e.at.y, ctx.t)
          this.floatLabelFx(e.at, '＋胞子', 0xbfe8ff, ctx.t, -0.3) // 可視化第一波③：因果の実況（生成系の無言解消）
          break
        }
        case 'token-consumed': {
          const k = this.key(e.at.x, e.at.y)
          const node = this.sporeTokenG.get(k)
          if (node) {
            this.sporeTokenG.delete(k)
            tween(node.scale, { x: 0, y: 0 }, 150, {
              delay: ctx.t,
              ease: easeInCubic,
              onDone: () => {
                if (!node.destroyed) node.destroy()
              },
            })
          }
          break
        }
        case 'explode': {
          for (const p of e.cells) this.popPieceAt(p, ctx.t, true)
          // 十字(通常5マス以下)か3x3(共振破砕)かをcells数から推定し、規模で見た目/揺れを変える
          const big = e.cells.length >= 6
          this.explodeFx(e.at, ctx.t, big)
          delay(ctx.t, () => buzz('blast'), 'fx')
          this.shakeRootDecay(ctx.t, big ? 4 : 2.5, big ? 160 : 120)
          ctx.t += ctx.hitstop.request(ctx.t, 30) // 爆発鉱石：30msヒットストップ
          ctx.t += 200
          break
        }
        case 'gear-trigger': {
          this.gearRingFx(e.at, ctx.t)
          this.floatLabelFx(e.at, `起動 x${e.count}`, 0xe8b33c, ctx.t, -0.28) // 可視化第一波③：ギアチャージ/起動の実況
          break
        }
        case 'upgrade-fire': {
          // 可視化第一波②：発動アピール。同一タイムラインで多発する場合はラベルは最初の2回まで（うるささ対策）
          const n = (ctx.upgradeFireCounts.get(e.id) ?? 0) + 1
          ctx.upgradeFireCounts.set(e.id, n)
          if (n <= 2) {
            this.floatLabelFx(e.at, UPGRADE_NAME.get(e.id) ?? e.id, 0xf2c14e, ctx.t)
            this.upgradeFlashFx(e.at, ctx.t)
          }
          const id = e.id
          const src = { ...e.at }
          delay(ctx.t, () => this.onUpgradeFire?.(id, src), 'fx') // バー側のバウンス演出は毎回（アイコンは常に反応させる）
          break
        }
        case 'obstacle-spawn': {
          this.popPieceAt(e.at, ctx.t, true)
          const ep = this.epoch
          delay(ctx.t + 60, () => {
            if (ep !== this.epoch) return
            this.makeBlock(e.at.x, e.at.y)
          })
          ctx.t += 150
          break
        }
        case 'enemy-damage': {
          this.enemyDamageFx(e.id, e.amount, e.hpLeft, ctx.t)
          break
        }
        case 'enemy-defeated': {
          const swarmInfo = ctx.swarmChain.get(ei)
          this.enemyDefeatedFx(e.id, e.cells, ctx.t, swarmInfo)
          if (swarmInfo && swarmInfo.total > 1) {
            // swarmドミノ：連鎖ごとに20ms短縮し80msを下限。最後の1体だけ50msヒットストップ
            if (swarmInfo.pos === swarmInfo.total) ctx.t += ctx.hitstop.request(ctx.t, 50)
            ctx.t += Math.max(80, 160 - (swarmInfo.pos - 1) * 20)
          } else {
            ctx.t += 200
          }
          break
        }
        case 'armor-applied': {
          // 可視化第一波①：予告（バッジ強発光）→実行（甲殻オーバーレイ）の順
          this.flashIntentBadge(e.id, ctx.t)
          this.makeArmorOverlay(e.at.x, e.at.y, ctx.t + 120)
          this.causeLineFx(e.id, e.at, 0xc7ccd2, ctx.t + 100) // 可視化第二波③：どの敵がやったかの因果線
          if (ctx.disruptLabelCount < 2) {
            ctx.disruptLabelCount++
            this.floatLabelFx(e.at, 'かたくなった！', 0xd8d2c2, ctx.t + 160)
          }
          ctx.t += 320
          break
        }
        case 'armor-broken': {
          const k = this.key(e.at.x, e.at.y)
          const g = this.armorG.get(k)
          if (g) {
            this.armorG.delete(k)
            tween(g, { alpha: 0 }, 150, {
              delay: ctx.t,
              onDone: () => {
                if (!g.destroyed) g.destroy()
              },
            })
          }
          this.flashFx(e.at, ctx.t)
          break
        }
        case 'prey-marked': {
          this.flashIntentBadge(e.id, ctx.t) // 可視化第一波①：予告→実行
          this.makePreyOverlay(e.at.x, e.at.y, ctx.t + 120)
          this.causeLineFx(e.id, e.at, 0xb98be0, ctx.t + 100) // 可視化第二波③：因果線
          if (ctx.disruptLabelCount < 2) {
            ctx.disruptLabelCount++
            this.floatLabelFx(e.at, 'ねらわれた！', 0xb98be0, ctx.t + 160)
          }
          ctx.t += 320
          break
        }
        case 'prey-devoured': {
          this.clearPreyOverlay(e.at)
          this.violetBurstFx(e.at, ctx.t)
          this.popPieceAt(e.at, ctx.t)
          ctx.t += 200
          break
        }
        case 'prey-escaped': {
          this.clearPreyOverlay(e.at)
          this.floatLabelFx(e.at, 'おいはらった！', 0xf2c96a, ctx.t + 60)
          break
        }
        case 'fissure-telegraph': {
          this.flashIntentBadge(e.id, ctx.t)
          this.makeFissureFrame(e.id, e.cells, ctx.t)
          if (ctx.disruptLabelCount < 2) {
            ctx.disruptLabelCount++
            this.floatLabelFx(e.cells[0], '崩落の予兆', 0xcbb28a, ctx.t + 160)
          }
          ctx.t += 240
          break
        }
        case 'fissure-averted': {
          this.clearFissureFrame(e.id)
          break
        }
        case 'oxygen-drained': {
          this.flashIntentBadge(e.id, ctx.t)
          this.enemyAttackTelegraphFx(e.id, ctx.t)
          if (ctx.disruptLabelCount < 2) {
            ctx.disruptLabelCount++
            const cells = this.enemyCellsCache.get(e.id)
            if (cells?.length) {
              const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
              const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
              this.floatLabelFx({ x: cx, y: cy }, `灯を奪われた −${e.amount}`, 0xff6b5a, ctx.t + 100, -0.25)
            }
          }
          delay(ctx.t, () => this.onOxygenDrained?.(e.id, e.amount), 'fx')
          ctx.t += 260
          break
        }
        case 'cell-sealed': {
          this.flashIntentBadge(e.id, ctx.t) // 可視化第一波①：予告→実行
          // Codexレビュー3回目P0：エンジンは封鎖時に c.piece を null にするのに、ビューは駒を消していなかった。
          // 残った駒スプライトは帳簿上「正」に見えるため後の解封→補充でリロール誤認のクロスフェードを招く
          this.popPieceAt(e.at, ctx.t, true)
          const g = this.makeSealBlock(e.at.x, e.at.y)
          g.scale.set(0)
          tween(g.scale, { x: 1, y: 1 }, 220, { delay: ctx.t + 120, ease: easeOutBack })
          this.causeLineFx(e.id, e.at, 0xcbb28a, ctx.t + 100) // 可視化第二波③：因果線
          if (ctx.disruptLabelCount < 2) {
            ctx.disruptLabelCount++
            this.floatLabelFx(e.at, 'ふさがれた！', 0xcbb28a, ctx.t + 160)
          }
          ctx.t += 340
          break
        }
        case 'cell-unsealed': {
          const k = this.key(e.at.x, e.at.y)
          const g = this.blockG.get(k)
          if (g && !g.destroyed) {
            this.blockG.delete(k)
            tween(g.scale, { x: 0, y: 0 }, 160, {
              delay: ctx.t,
              ease: easeInCubic,
              onDone: () => {
                if (!g.destroyed) g.destroy()
              },
            })
          }
          break
        }
        case 'boss-shell-broken': {
          this.shakeContainer(this.root, ctx.t)
          this.paintBossGauge()
          ctx.t += 160
          break
        }
        case 'boss-phase': {
          // 身体1行ぶんのコンテナと顔をまとめて畳み、freedセル＋顔だけを描き直す（修正7）
          const row = this.bossRowG.get(H - 1)
          if (row && !row.destroyed) tween(row, { alpha: 0 }, 220, { delay: ctx.t })
          this.shakeRootDecay(ctx.t + 60, 6, 220)
          // 修正7：ここで全域reconcile()を呼ぶと、epoch/moveSeqガードが無いため同じ手の後続演出
          // （落下・補充）を巻き込んで無動作化し一斉テレポートさせる（ボス相転移時限定の症状）。
          // ボスの身体（freedセル）と顔だけを直す部分更新に差し替え、ガードも付ける。
          const ep = this.epoch
          const mv = this.moveSeq
          const bossId = e.id
          const freed = e.freed
          delay(ctx.t + 240, () => {
            if (ep !== this.epoch || mv !== this.moveSeq) return
            this.reconcileBossPhase(bossId, freed)
          })
          ctx.t += 300
          break
        }
        // 酸素の増減・層クリア・遭難：ビューでは何もしない（HUDと層進行は main.ts の管轄）
        case 'oxygen-spent':
        case 'oxygen-refill':
        case 'last-light':
        case 'lamp-bonus':
        case 'floor-clear':
        case 'run-over':
          break
      }
    }
  }

  /** 列ドロップの組み立て（case 'fall' / 'refill' の収集を剛体トレインとして予約する）。
   *  ctx.builtDropKeysに載っているキーは構築済みとしてスキップする（後続セグメント再生で
   *  未構築ぶんだけ構築するため。play()経由の単発呼び出しでは常に全キーが未構築なので挙動は変わらない） */
  private buildDropTrains(ctx: MoveCtx): void {
    // 列ドロップの組み立て（case 'fall' / 'refill' の収集の続き）：同じ拍・同じ列の落下と補充を、
    // **同じ遅延・同じ所要時間**で一斉に落とす（剛体）。開始時も終了時も1マス以上の間隔がある駒同士が
    // 同じ時間関数で動くので、密着・追い越し・湧き点のスタックが構造的に起きない。
    // 補充は着地行の並びを保った1マス間隔で盤の上空に整列し、pieceLayer のマスクの奥から降ってくる
    const dropKeys = new Set([...ctx.refillTrains.keys(), ...ctx.columnFalls.keys()])
    for (const key of dropKeys) {
      if (ctx.builtDropKeys.has(key)) continue
      ctx.builtDropKeys.add(key)
      if (DIAG) setTweenCtx(`m${ctx.mvDrop}/drop/${key}`)
      const train = ctx.refillTrains.get(key) ?? []
      const falls = ctx.columnFalls.get(key) ?? []
      const segT = Number(key.split('|')[0])
      const col = train[0]?.col ?? falls[0]?.toX ?? 0
      train.sort((a, b) => a.row - b.row)
      const dropRows = train.length ? train[train.length - 1].row + 1.8 : 0
      const maxFall = falls.reduce((m, f) => Math.max(m, f.dist), 0)
      // 列内の全駒が共有する所要時間（最長の旅程に合わせる。短距離の駒はゆっくり落ちる＝崩れの一体感）
      const dur = Math.min(FALL_MAX, FALL_COEF * Math.sqrt(Math.max(dropRows, maxFall, 0.8)))
      const colStagger = ((col * 5) % 4) * 9 // 列ごとの決定的スタッガー＝板ではなく崩れに見せる
      const startAt = segT + T.pop + colStagger
      for (const f of falls) {
        const landY = this.px(f.toY)
        const b = this.bs(f.sp)
        tween(f.sp.position, { x: this.px(f.toX), y: landY }, dur, {
          delay: startAt,
          ease: easeInQuad,
          onDone: () => {
            // 計器：旧世代の着地コールバックが、次の手に接収された駒へ子tweenを張る競合の観測
            // （codex_arch_review.md §1-6「落下着地callbackには世代guardがない」。まず観測のみ・挙動は変えない）
            if (DIAG && ctx.mvDrop !== this.moveSeq && [...this.sprites.values()].includes(f.sp))
              report('staleCb', 'stale-gen landing bounce on mapped sprite', { sprite: dumpSprite(f.sp), scheduledMv: ctx.mvDrop, nowMv: this.moveSeq })
            // 着地：52msだけ潰れて沈み、110msで戻す（潰れと沈みを対で動かすと重さが出る）
            tween(f.sp.scale, { x: b * 1.14, y: b * 0.86 }, 52, {
              onDone: () => tween(f.sp.scale, { x: b, y: b }, 110, { ease: easeOutBackSoft }),
            })
            tween(f.sp.position, { y: landY + this.S * 0.052 }, 52, {
              onDone: () => tween(f.sp.position, { y: landY }, 110, { ease: easeOutBackSoft }),
            })
          },
        })
      }
      for (const it of train) {
        it.sp.position.y = this.px(it.row) - dropRows * this.S
        tween(it.sp, { alpha: 1 }, 80, { delay: startAt })
        tween(it.sp.position, { y: this.px(it.row) }, dur, { delay: startAt, ease: easeInQuad })
      }
      // 計器：補充予約直後のpostcondition（codex_arch_review.md §1-3）。ここで落ちれば予約構築の欠落、
      // ここを通って次のplay()冒頭の監査で落ちれば割込・snap・callback競合＝原因の切り分けができる
      if (DIAG)
        for (const it of train) {
          if (it.sp.destroyed || (it.sp.alpha < 0.999 && !hasTweenProperty(it.sp, 'alpha')))
            report('refillPostcond', 'refill lost alpha writer', { key, sprite: dumpSprite(it.sp) })
          else if (!hasTweenProperty(it.sp.position, 'y'))
            report('refillPostcond', 'refill lost position writer', { key, sprite: dumpSprite(it.sp) })
        }
    }
  }

  /** 旧play()末尾を移設：×N集約ラベル→列ドロップ組み立て→総所要時間の確定→housekeeping/reconcile予約。
   *  戻り値の所要合計msはplay()がそのまま返す */
  private finishMove(ctx: MoveCtx): number {
    // タイムライン予算：special-fireが25発以降で集約された分は、種類ごとに「×N」で因果をまとめて示す
    for (const [kind, count] of ctx.aggregateFireCounts) {
      const at = ctx.aggregateFireAt.get(kind)
      if (!at) continue
      this.floatLabelFx(at, `${FIRE_KIND_NAME[kind] ?? kind} ×${count}`, 0xf2c14e, ctx.t)
    }
    this.buildDropTrains(ctx)
    const total = ctx.t + T.pop + T.fall
    // 可視化第一波①：敵の残りターン表示は「エンジン確定後」の値を見せたいのでタイムライン終端で更新
    // housekeeping：reconcile・カウンタ消去・フラグ解除の予約は計測対象（board/cue）から除外する
    // （codex_timeline_review.md §2-B。自分自身がchannelEndを延長する罠を避ける）
    const ep = this.epoch
    const mv = this.moveSeq
    delay(
      total,
      () => {
        if (ep !== this.epoch) return
        this.updateIntentBadges()
      },
      'housekeeping',
    )
    this.fadeChainCounter(total + 120) // 連鎖数表示は次の一手までに消す
    delay(
      total + 200,
      () => {
        if (ep === this.epoch && mv === this.moveSeq) this.rampageActive = false // 暴走時フラグは手の終端で解除
      },
      'housekeeping',
    )
    // タイムライン終端で必ず照合修復：稀な競合で残る位置ズレ/孤児を吸収し、描画=エンジンを保証。
    // 終端の再定義（タイムライン予算B）：単調増加するMath.maxをやめ、圧縮後の実際の残時間
    // channelEnd('board'/'cue') の最大値を都度測り直す。これにより割込・圧縮のたびに終端も縮む。
    // reconcile timer自身はhousekeepingチャンネルなので計測対象に含まれない（自己延長を防ぐ）。
    // 着地バウンス等onDone子tween（最大180ms）はchannelEndが予知できないが、+200msバッファが吸収する
    // 前提（channelEndで拾えるのは予約済みtweenの残時間だけ。180ms<200msなのでこの前提は崩れない）
    const endMs = channelEndMany(['board', 'cue'])
    this.timelineEndAbs = now() + endMs
    delay(
      endMs + 200,
      () => {
        if (ep === this.epoch && mv === this.moveSeq) this.reconcile()
      },
      'housekeeping',
    )
    return total
  }

  /** イベント列をアニメ予約。所要合計msを返す（C案移行 Phase4 Stage A：beginMove/scheduleEvents/
   *  finishMoveを呼ぶ薄いadapter。呼び出し順・引数・戻り値は旧play()と等価） */
  play(evs: BoardEvent[]): number {
    const ctx = this.beginMove()
    this.scheduleEvents(ctx, evs)
    return this.finishMove(ctx)
  }

  // ---- C案移行Phase4 StageB（codex_c_phase46_plan.md §7）：stepped経路 ----
  // ResolutionCoordinator（main.ts）が1手につき beginSteppedMove() → playSegment()×N →
  // finishSteppedMove() の順で呼ぶ。各セグメントの盤面所有tween（board/cue）はセグメント内で
  // 完了させ、完了を待ってから次を予約する＝表示境界と論理境界を一致させる。

  /** stepped再生の1手を開始する（beginMove＋steppedフラグ） */
  beginSteppedMove(): MoveCtx {
    const ctx = this.beginMove()
    ctx.stepped = true
    return ctx
  }

  /** 1停止境界ぶんのイベントを予約し、盤面所有tween（board/cue）の完了まで待つ */
  async playSegment(ctx: MoveCtx, step: ResolutionStep): Promise<void> {
    // 連鎖拍の下限ゲート（§7.4）：新しい連鎖段は前の連鎖開始から chainBeatFor 以上あけて始める。
    // 落下がそれ以上かかっていれば追加待ちゼロ、短ければ拍ぶんだけ補う（＝加算方式の二重待ちを避ける）
    const firstMatch = step.events.find((e): e is Extract<BoardEvent, { t: 'match' }> => e.t === 'match')
    if (firstMatch) {
      if (firstMatch.chain > 1 && ctx.chainClock !== undefined) {
        const wait = ctx.chainClock + chainBeatFor(firstMatch.chain) - now()
        if (wait > 0) await this.sleep(wait)
      }
      ctx.chainClock = now()
    }
    // セグメント内はローカル時計で予約する（前セグメントは完了済み＝累積の空白を持ち込まない）
    ctx.t = 0
    ctx.chainStartT = 0
    // 再生スコープ（§7.3）：このセグメントが作るtweenに一意のスコープIDを付け、その完了だけを待つ。
    // channelEnd待ちだと爆発鉱石のゆらぎ等の常設アニメ（既定'board'）が混ざって永遠に0にならない
    // （実測：毎セグメントが上限4秒まで待たされ、1手が20秒級に伸びてハーネスの連打が全部割込になった）
    const scopeId = ++BoardView.segScopeSeq
    setTweenScope(scopeId)
    try {
      this.scheduleEvents(ctx, step.events)
      this.buildDropTrains(ctx)
    } finally {
      setTweenScope(0)
    }
    // トレイン収集器はセグメント使い切り（キー `${t}|${col}` はローカル時刻なので、跨いで再利用すると
    // 別セグメントの同時刻・同列と衝突して builtDropKeys が誤スキップする）
    ctx.refillTrains.clear()
    ctx.columnFalls.clear()
    ctx.builtDropKeys.clear()
    await this.waitScopeIdle(scopeId)
    if (DIAG) this.auditLedgers(`segment-${step.index}`) // 検収条件：各境界で帳簿違反0（§12）
  }

  /** stepped再生スコープの通し番号（0はスコープ外＝常設アニメ・FX） */
  private static segScopeSeq = 0

  /** stepped再生の1手を締める（×N集約ラベル・housekeeping・終端reconcile予約は legacy と共用） */
  finishSteppedMove(ctx: MoveCtx): void {
    this.finishMove(ctx)
  }

  /** 指定スコープのtweenの残時間が0になるまで待つ。「2回連続0」で確定＝着地コールバックが同フレームで
   *  張る子tween（潰れ→復帰。親スコープを継承する）の隙間を静止と誤認しない。capMs はセグメント予算の
   *  保険（§7.6。到達したら残りは finishSteppedMove の終端reconcileに任せて先へ進む） */
  private waitScopeIdle(scopeId: number, capMs = 4000): Promise<void> {
    return new Promise((resolve) => {
      let waited = 0
      let zeroStreak = 0
      const poll = () => {
        const remain = scopeEnd(scopeId)
        if (remain <= 0) {
          zeroStreak++
          if (zeroStreak >= 2) return resolve()
        } else zeroStreak = 0
        if (waited >= capMs) return resolve()
        const stepMs = remain > 0 ? Math.min(Math.max(remain, 60), 300) : 90
        waited += stepMs
        delay(stepMs, poll, 'housekeeping')
      }
      poll()
    })
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => delay(ms, resolve, 'housekeeping'))
  }

  /** 割込ドレイン後の一括同期（C案移行Phase6・§9.2の renderStable 相当）。ドレインした残段は
   *  意図的に描いていないので差分が出るのが正常＝strict系の計測（reconcileCorrected）には数えない */
  renderStable() {
    this.reconcile(true)
  }

  /** エンジン状態への収束（差分だけ直すので通常は何も起きない）。
   *  expectStale=true は割込ドレイン後の一括同期＝差分が出て当然の呼び出し（計測から除外する） */
  reconcile(expectStale = false) {
    this.repairStrandedAlpha() // タイムライン予算C：透明のまま取り残された駒の保険（reconcile直前）
    let corrected = 0 // 修正9：実際に直した件数（位置スナップ/差し替え/孤児破棄）。0が正常の指標
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = this.key(x, y)
        const c = this.board.at(x, y)
        const want = c && !c.block ? c.piece : null
        const sp = this.sprites.get(k)
        if (!want) {
          if (sp) {
            this.mapClear(k, sp)
            if (!sp.destroyed) sp.destroy()
          }
          continue
        }
        if (!sp || sp.destroyed || (sp as unknown as { __kind: string }).__kind !== pieceKey(want)) {
          if (sp) {
            this.mapClear(k, sp)
            if (!sp.destroyed) sp.destroy()
          }
          this.makePiece(x, y, want)
          corrected++
          if (DIAG && !expectStale)
            console.warn('[yacho][diag] reconcile remake', k, sp ? JSON.stringify(dumpSprite(sp)) : 'missing', pieceKey(want), 'ops:', JSON.stringify(recentOps(k, 6)))
        } else {
          // 位置・透明度・スケールをセル定位置へスナップ（実際にズレていた場合だけ件数に数える）
          const wantX = this.px(x)
          const wantY = this.px(y)
          const b = this.bs(sp)
          if (sp.position.x !== wantX || sp.position.y !== wantY || sp.alpha !== 1 || sp.scale.x !== b || sp.scale.y !== b) {
            corrected++
            if (DIAG && !expectStale)
              console.warn(
                '[yacho][diag] reconcile fix',
                k,
                JSON.stringify({ dx: +(sp.position.x - wantX).toFixed(2), dy: +(sp.position.y - wantY).toFixed(2), a: +sp.alpha.toFixed(3), s: +(sp.scale.x / b).toFixed(3) }),
              )
          }
          sp.position.set(wantX, wantY)
          sp.alpha = 1
          sp.scale.set(b)
          // 銛の向きはテクスチャ自体（harpoon-h/-v）が持つので、休止状態は他駒と同じく回転0が正
          sp.rotation = 0
        }
      }
    // mapに居ない可視孤児を掃除
    const mapped = new Set(this.sprites.values())
    for (const ch of [...this.pieceLayer.children]) {
      if (!mapped.has(ch as Sprite) && !ch.destroyed) {
        ch.destroy()
        corrected++
      }
    }
    // 障害物・蔦苔の帳簿も照合（レベル遷移コールバック等の取りこぼし保険）
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = this.key(x, y)
        const c = this.board.at(x, y)
        const bg = this.blockG.get(k)
        if (c?.block && (!bg || bg.destroyed)) {
          if (bg) this.blockG.delete(k)
          this.makeBlock(x, y)
        } else if (!c?.block && bg) {
          this.blockG.delete(k)
          if (!bg.destroyed) bg.destroy()
        }
        const gg = this.groundG.get(k)
        const groundWant = c?.ground ?? 0
        if (groundWant > 0 && (!gg || gg.destroyed)) {
          if (gg) this.groundG.delete(k)
          this.makeGround(x, y, groundWant as 1 | 2)
        } else if (groundWant === 0 && gg) {
          this.groundG.delete(k)
          if (!gg.destroyed) gg.destroy()
        }
        // ローグ拡張：胞子トークン・甲殻・毒胞子オーバーレイの帳簿照合
        const wantToken = c?.sporeToken === true
        const tk = this.sporeTokenG.get(k)
        if (wantToken && (!tk || tk.destroyed)) {
          if (tk) this.sporeTokenG.delete(k)
          this.makeSporeTokenSprite(x, y, 0)
        } else if (!wantToken && tk) {
          this.sporeTokenG.delete(k)
          if (!tk.destroyed) tk.destroy()
        }
        const wantArmor = c?.armored === true
        const ag = this.armorG.get(k)
        if (wantArmor && (!ag || ag.destroyed)) {
          if (ag) this.armorG.delete(k)
          this.makeArmorOverlay(x, y, 0)
        } else if (!wantArmor && ag) {
          this.armorG.delete(k)
          if (!ag.destroyed) ag.destroy()
        }
        const wantPrey = c?.preyMark === true
        const pg = this.preyG.get(k)
        if (wantPrey && (!pg || pg.destroyed)) {
          if (pg) this.preyG.delete(k)
          this.makePreyOverlay(x, y, 0)
        } else if (!wantPrey && pg) {
          this.preyG.delete(k)
          if (!pg.destroyed) pg.destroy()
        }
        // 可視化第一波③：爆発鉱石の常時発光も同様に帳簿照合
        const wantVolatile = c?.piece?.kind === 'normal' && c.piece.volatile === true
        const vg = this.volatileG.get(k)
        if (wantVolatile && (!vg || vg.destroyed)) {
          if (vg) this.volatileG.delete(k)
          this.makeVolatileOverlay(x, y, 0)
        } else if (!wantVolatile && vg) {
          this.volatileG.delete(k)
          if (!vg.destroyed) vg.destroy()
        }
      }
    // 敵ブロック（岩殻獣/胞子獣/穴潜み）：帳簿はblock照合ループ（上）でmakeBlock経由に自己修復済み。
    // ここではHPバー・メタ情報・座標キャッシュを最新化する（enemy-damage等の座標なしイベント用）
    for (const en of this.board.enemies) {
      if (en.kind === 'boss') continue
      this.enemyMeta.set(en.id, { kind: en.kind, maxHp: en.maxHp })
      this.enemyCellsCache.set(
        en.id,
        en.cells.map((p) => ({ ...p })),
      )
      const cell = en.cells[0]
      if (cell) {
        const g = this.blockG.get(this.key(cell.x, cell.y))
        if (g && !g.destroyed) this.paintHpBar(g, en.hp, en.maxHp)
      }
    }
    // 予告枠：telegraph を持つ敵ぶんだけ残す（裂坑掘りの2x2／綴じ蟲の列／奈落の喉の次の相。同じ帳簿照合）
    const wantFissure = new Set<number>()
    for (const en of this.board.enemies) {
      if (!en.telegraph) continue
      wantFissure.add(en.id)
      const fg = this.fissureG.get(en.id)
      if (!fg || fg.destroyed) this.makeFissureFrame(en.id, en.telegraph, 0)
    }
    for (const id of [...this.fissureG.keys()]) if (!wantFissure.has(id)) this.clearFissureFrame(id)
    // ボスの顔（目+HPバー）オーバーレイの同期（修正7で単独関数に切り出し。boss-phase専用の部分更新とも共用）
    this.reconcileBossFace()
    this.updateIntentBadges() // 可視化第一波①：撃破・生成の取りこぼしをここでも吸収
    // Codexレビュー3回目：reconcileの孤児destroyはonDoneを通らないため、doomed台帳に破棄済み個体が
    // 残留する（残留すると snapDoomedAt が破棄済みへ触る）。ここで台帳を掃除して整合を保つ
    for (const [k, list] of [...this.doomedByCell]) for (const en of list.slice()) if (en.sp.destroyed) this.removeDoomed(k, en.sp)
    // 修正9：reconcileが実際に何かを直した場合のみ出す。発生ゼロが正常の指標（QA・実機での観測用）
    if (corrected > 0 && !expectStale) console.debug('[yacho] reconcile corrected', corrected)
    if (DIAG) {
      if (!expectStale) counters.reconcileCorrected += corrected // 割込後の一括同期は「差分が出て当然」＝strict計測から除外
      this.auditLedgers('reconcile-end') // 計器：終端修復の直後は3帳簿が完全一致しているはず
    }
  }

  /** ボスの顔（目+HPバー）オーバーレイ：不在なら片付け、居るのに欠けていれば再生成・位置とHPを同期。
   *  reconcile()全体からと、boss-phase専用の部分更新（reconcileBossPhase）の両方から呼ぶ（修正7） */
  private reconcileBossFace() {
    const boss = this.board.enemies.find((en) => en.kind === 'boss')
    if (boss) {
      this.enemyMeta.set(boss.id, { kind: 'boss', maxHp: boss.maxHp })
      this.enemyCellsCache.set(
        boss.id,
        boss.cells.map((p) => ({ ...p })),
      )
      this.bossId = boss.id
      const face = this.bossFaceG.get(boss.id) as BossFaceHost | undefined
      const xs = boss.cells.map((c) => c.x)
      const span = `${Math.min(...xs)},${Math.max(...xs)},${boss.bossPhase}`
      if (!face || face.destroyed || face.__bossSpan !== span) {
        // 身体セル範囲や段階が変わったら作り直す（縮んだ身体に対して古い幅のゲージが残らない）
        this.makeBossFace(boss)
      } else {
        face.position.set(0, (H - 1) * this.S)
        this.paintBossGauge()
        this.blockLayer.addChild(face) // 顔は常に身体の前へ（匣の再構築で背面に潜らせない）
      }
    } else {
      for (const face of this.bossFaceG.values()) if (!face.destroyed) face.destroy()
      this.bossFaceG.clear()
      this.bossId = null
    }
  }

  /**
   * ボス相転移（boss-phase）専用の部分更新（修正7）。全域reconcile()は同じ手の後続演出（落下・補充）を
   * 巻き込んで無動作化し一斉テレポートさせるため、freedセル（身体から開放されたセル）と現在の身体セル、
   * 顔だけに絞って直す。boss身体は共有Container（1行=1コンテナ）なのでfreedセルのblockGを破棄すると
   * kept側のblockGも道連れで無効化されるが、その直後にkept側を再生成するので結果的に正しい絵に収束する。
   */
  private reconcileBossPhase(bossId: number, freed: XY[]) {
    for (const p of freed) {
      const k = this.key(p.x, p.y)
      const bg = this.blockG.get(k)
      if (bg) {
        this.blockG.delete(k)
        if (!bg.destroyed) bg.destroy()
      }
    }
    const boss = this.board.enemies.find((en) => en.id === bossId)
    if (boss) {
      for (const p of boss.cells) {
        const k = this.key(p.x, p.y)
        const bg = this.blockG.get(k)
        if (!bg || bg.destroyed) {
          if (bg) this.blockG.delete(k)
          this.makeBlock(p.x, p.y)
        }
      }
    }
    this.reconcileBossFace()
  }

  /** 詰み保険リロールの描画（修正6）：盤上の駒をその場で色替え＝旧alpha→0／新alpha0→1の各150ms
   *  クロスフェード。上から落とすタイムラインへ流すと「盤の中ほどの駒が突然消えて別の色が降ってくる」
   *  ＝絵柄一斉変化に見えるための専用処理。既存スプライトが無ければ単純生成でフェードイン */
  private playReroll(p: XY, piece: Piece, t: number) {
    const k = this.key(p.x, p.y)
    const already = this.sprites.get(k)
    if (already && !already.destroyed) {
      this.snapPieceForMove(already)
      this.mapRetire(k, already) // 修正3：フェードアウト中も台帳に残し、次にこのセルへ触れたら畳めるように
      const oldSp = already
      const newSp = this.makePiece(p.x, p.y, piece)
      newSp.alpha = 0
      tween(newSp, { alpha: 1 }, 150, { delay: t })
      tween(oldSp, { alpha: 0 }, 150, {
        delay: t,
        onDone: () => {
          this.removeDoomed(k, oldSp)
          if (!oldSp.destroyed) oldSp.destroy()
        },
      })
      return
    }
    this.snapDoomedAt(k)
    const sp = this.makePiece(p.x, p.y, piece)
    sp.alpha = 0
    tween(sp, { alpha: 1 }, 150, { delay: t })
  }

  private popPieceAt(p: XY, t: number, byFire = false, sparkSkipChance = 0) {
    const k = this.key(p.x, p.y)
    const sp = this.sprites.get(k)
    if (!sp) return
    this.snapPieceForMove(sp) // 前の手の移動が残っていても、この駒だけセル定位置へ寄せてから消す
    this.snapDoomedAt(k) // 修正3：同じセルに前回のポップ待ち駒が残っていたら先に畳み切る
    this.mapRetire(k, sp) // 修正3：destroyはonDone任せで先の話になるため、その間もセル台帳に載せておく
    this.clearVolatileOverlay(p, t) // 可視化第一波③：爆発鉱石の常時発光を破壊タイミングで片付ける
    // 膨張62ms→ホールド28ms→弾け88ms の3段（合計178ms ≤ T.pop）。「溜めてから弾ける」を作る
    const b = this.bs(sp)
    tween(sp.scale, { x: b * 1.28, y: b * 1.28 }, 62, { delay: t, ease: easeOutBackSoft })
    tween(sp.scale, { x: 0, y: 0 }, 88, { delay: t + 90, ease: easeInCubic })
    tween(sp, { alpha: byFire ? 0.35 : 0 }, 84, {
      delay: t + 90,
      onDone: () => {
        this.removeDoomed(k, sp)
        sp.destroy()
      },
    })
    this.sparkFx(p, t + 88, sparkSkipChance) // 火花は「弾けた瞬間」に出す
  }

  /** 通常消去の火花。skipChance>0 なら1粒ずつ確率的に間引く（10連鎖以降の負荷対策。codex_consult [D]-3） */
  private sparkFx(p: XY, t: number, skipChance = 0) {
    delay(t, () => {
      if (skipChance > 0 && this.rnd() < skipChance) return
      for (let i = 0; i < 6; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.circle(0, 0, 2.4).fill(0xfff2c8)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.4 + this.rnd() * 0.5)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 320, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0 }, 320, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
  }

  private debrisFx(p: XY, t: number, color: number) {
    delay(t, () => {
      for (let i = 0; i < 8; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.roundRect(-3, -3, 6, 6, 1.5).fill(color)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.5 + this.rnd() * 0.7)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d + this.S * 0.4 }, 420, {
          ease: easeOutCubic,
          channel: 'fx',
        })
        tween(g, { alpha: 0, rotation: (this.rnd() - 0.5) * 4 }, 420, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    }, 'fx')
  }

  /** 特殊駒ごとの発動演出。simplified=true（9〜24発目・タイムライン予算）は粒子数を間引く */
  private fireFx(at: XY, piece: Piece, t: number, simplified = false) {
    const S = this.S
    if (piece.kind === 'harpoon') {
      // 行/列を走る光のスイープ
      delay(t, () => {
        const g = new Graphics()
        if (piece.dir === 'h') {
          g.roundRect(-S * 0.2, -S * 0.28, W * S + S * 0.4, S * 0.56, S * 0.28).fill({ color: 0xfff1c4, alpha: 0.85 })
          g.position.set(0, this.px(at.y) - 0)
          g.pivot.set(0, 0)
          g.y = this.px(at.y)
          g.x = 0
          g.scale.x = 0.05
          this.fxLayer.addChild(g)
          tween(g.scale, { x: 1 }, 160, { ease: easeOutCubic, channel: 'fx' })
        } else {
          g.roundRect(-S * 0.28, -S * 0.2, S * 0.56, H * S + S * 0.4, S * 0.28).fill({ color: 0xfff1c4, alpha: 0.85 })
          this.fxLayer.addChild(g)
          g.x = this.px(at.x)
          g.y = 0
          g.scale.y = 0.05
          tween(g.scale, { y: 1 }, 160, { ease: easeOutCubic, channel: 'fx' })
        }
        tween(g, { alpha: 0 }, 260, { delay: 120, channel: 'fx', onDone: () => g.destroy() })
      }, 'fx')
    } else if (piece.kind === 'hitsubo') {
      // 歯車爆弾：3層爆発（爆発鉱石と共通実装だが色/規模を変えて別物にする）＋広域の衝撃波スイープ
      this.layeredExplosionFx(at, t, {
        big: true,
        sparkColor: 0xfff1c4,
        coreColor: 0xffc978,
        ringColor: 0xffc978,
        chunkColor: 0x8a7048,
        sparkCount: simplified ? 8 : 22,
        chunkCount: simplified ? 4 : 10,
        smokeCount: simplified ? 2 : 5,
        ringMaxScale: 2.8,
      })
      delay(t, () => {
        const ring = new Graphics()
        ring.circle(0, 0, S * 0.5).stroke({ width: S * 0.16, color: 0xffc978, alpha: 0.9 })
        ring.position.set(this.px(at.x), this.px(at.y))
        this.overFxLayer.addChild(ring)
        tween(ring.scale, { x: 5.2, y: 5.2 }, 340, { ease: easeOutCubic, channel: 'fx' })
        tween(ring, { alpha: 0 }, 340, {
          channel: 'fx',
          onDone: () => {
            if (!ring.destroyed) ring.destroy()
          },
        })
      }, 'fx')
    } else if (piece.kind === 'seiju') {
      // ランタンの虹色放射
      delay(t, () => {
        const colors = [0xf7b1a0, 0xf7e3a0, 0xb9e6a8, 0xa8cdf0, 0xd7b5ec]
        const rayCount = simplified ? 4 : 10
        for (let i = 0; i < rayCount; i++) {
          const ray = new Graphics()
          ray.roundRect(0, -S * 0.09, S * 3.4, S * 0.18, S * 0.09).fill({ color: colors[i % colors.length], alpha: 0.8 })
          ray.position.set(this.px(at.x), this.px(at.y))
          ray.rotation = (i / rayCount) * Math.PI * 2
          ray.scale.set(0.1, 1)
          this.fxLayer.addChild(ray)
          tween(ray.scale, { x: 1 }, 300, { ease: easeOutCubic, channel: 'fx' })
          tween(ray, { alpha: 0 }, 420, { delay: 140, channel: 'fx', onDone: () => ray.destroy() })
        }
      }, 'fx')
      this.flashFx(at, t)
    } else {
      this.flashFx(at, t)
    }
  }

  /** 画面上部からセルへ飛ぶ白い彗星（勝利ドレイン用） */
  private cometFx(p: XY, t: number) {
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.14).fill({ color: 0xfff6d8, alpha: 0.95 })
      g.circle(-this.S * 0.18, 0, this.S * 0.08).fill({ color: 0xfff6d8, alpha: 0.4 })
      g.position.set(this.px(p.x) * 0.3 - this.S, -this.S * 1.2)
      this.fxLayer.addChild(g)
      tween(g.position, { x: this.px(p.x), y: this.px(p.y) }, 260, { ease: easeOutCubic, channel: 'fx' })
      tween(g, { alpha: 0 }, 300, { delay: 180, channel: 'fx', onDone: () => g.destroy() })
    }, 'fx')
  }

  private flashFx(p: XY, t: number) {
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.2).fill({ color: 0xffffff, alpha: 0.9 })
      g.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(g)
      tween(g.scale, { x: 5, y: 5 }, 300, { ease: easeOutCubic, channel: 'fx' })
      tween(g, { alpha: 0 }, 300, { channel: 'fx', onDone: () => g.destroy() })
    }, 'fx')
  }
}
