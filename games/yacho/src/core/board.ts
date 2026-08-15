// ヘッドレス盤面エンジン。Pixi 非依存。全ての状態遷移はイベント列として返す。
// 設計根拠: DESIGN.md §1/§5、RESEARCH.md §1-2（RM実仕様）。
import { makeRng, randInt, type Rng } from './rng'
import type { BoardEvent, Cell, Color, EnemyKind, Goal, LevelDef, Piece, XY } from './types'
import type { DestroyCause, Hook, HookCtx, MatchGroup } from './hooks'
import { systemOf } from './hooks'
import {
  AUTONOMOUS_MECHANISM_ID,
  GEAR_TRIGGER_THRESHOLD,
  DISMANTLE_KNACK_ID,
  EMBER_CORE_ID,
  MAGNETIC_MINING_ID,
  MECHANICAL_GARDEN_ID,
  MIMIC_SLIME_ID,
  POWDER_MILL_ID,
  PREHEAT_ID,
  RELIC_RESONANCE_ID,
  RESONANT_SHATTER_ID,
  SPORE_BULLET_ID,
  UPGRADES,
  VINE_ROCKET_ID,
} from './upgrades'
import { gainLamp, type RunState } from './run'
import { blessingBigMatchLamp, blessingBoardFx, blessingDrain, blessingLastLight, blessingSupply } from './blessings'
import {
  BELLFOOT_SHELL_MAX,
  bossBodyCells,
  createEnemy,
  ENEMY_PERIOD,
  MAW_PHASES,
  mawNextPhase,
  mawPhaseCells,
  OXYGEN_DRAIN,
  SWARM_PROPAGATE_DAMAGE,
  type EnemyInstance,
} from './enemies'
import type { FloorDef } from './floors'

export const W = 8
export const H = 8

/** growthSpot/transformSpot がマッチ形成を狙って探索する範囲（マンハッタン距離。夜間監査[D]6） */
const GROWTH_MATCH_RADIUS = 2

/**
 * 補充の連鎖傾斜（工程3）。落下補充で湧く駒の色を「着地点の周囲に既にある色」へやや寄せる重み。
 * 1.0=無傾斜（完全ランダム）。周囲の同色1つにつき重みが REFILL_BIAS 倍される（2つ隣接なら二乗）。
 * オーナー観察「落ちてきた駒で連鎖が起きにくいのはもどかしい」への見えない味付け。即マッチの保証はしない
 * （pickColorRefill 参照。初期配置・詰み防止の塗り直しには効かせない＝補充だけ）。
 * 計測比較は runsim の第3引数（1.0/1.3/1.6 で連鎖分布がどう動くかは assets_src/_runsim.txt と工程3報告）。
 * 2026-08-15 オーナー指示で 1.3 → 1.6（「連鎖は1.6にしてみてもいい」。いろいろなバージョンを試す段階）。
 */
export let REFILL_BIAS = 1.6
export function setRefillBias(v: number) {
  REFILL_BIAS = v
}

/**
 * 模倣の粘菌(#14)が再現するフック発火の「入力スナップショット」（夜間監査[C]1）。
 * 以前は関数(クロージャ)を保存していたため、発生時の古い ev / ctx を握ったまま別の手で再発動すると
 * 現在のイベント列に結果が書き込まれない不具合があった（見かけ上の空振り・演出/記録の同期崩れ）。
 * 関数ではなくデータだけを保存し、再実行時（replayLast）は必ず現在の ev から作った新しい ctx で act を呼び直す。
 * 対象範囲＝「直前に発動した1件（同じ手の中とは限らない。層をまたいでも保持する）」：次にどれかのフックが
 * 発動するたびに上書きされる、いわば「最後に鳴った鐘」。データのみの保存なので古い手をまたいでも安全に
 * 再実行できる（＝この不具合の根治）。1手の中だけに絞る案もあり得るが、模倣の粘菌が空振りする場面を
 * 増やすだけで得るものが無いため採らなかった（仕様として明記。詳細は最終報告）。
 */
type HookReplaySnapshot =
  | { on: 'match'; upgradeId: string; hook: Extract<Hook, { on: 'match' }>; g: MatchGroup; origin: XY }
  | { on: 'destroy'; upgradeId: string; hook: Extract<Hook, { on: 'destroy' }>; at: XY; cause: DestroyCause; piece: Piece }
  | { on: 'sporeTouch'; upgradeId: string; hook: Extract<Hook, { on: 'sporeTouch' }>; spore: XY; neighbor: XY }
  | { on: 'gearTrigger'; upgradeId: string; hook: Extract<Hook, { on: 'gearTrigger' }>; at: XY; count: number }
  | { on: 'enemyHit'; upgradeId: string; hook: Extract<Hook, { on: 'enemyHit' }>; cells: XY[]; amount: number }

/**
 * C案移行Phase5.5（codex_c_phase46_plan.md §5）：エンジン自身が発行する実停止境界の種別。
 * ビュー側の segmentEvents()（イベント種別からの分類）は補助であり、正本はこちら。
 */
export type ResolutionStepKind = 'swap' | 'resolve' | 'gravity' | 'after-move' | 'enemy' | 'finish'

/** 表示・HUDが参照する論理状態の正規化スナップショット（deep clone済み・以後の盤面変化と独立） */
export interface BoardSnapshot {
  cells: Cell[][]
  enemies: EnemyInstance[]
  goalDone: number[]
  movesLeft: number
  score: number
  chain: number
  oxygen: number | null // run が無ければ null
  floorCleared: boolean
  runOverFired: boolean
}

/** 1停止境界ぶんの確定結果。events はこの境界までに新しく積まれた差分 */
export interface ResolutionStep {
  resolutionId: number
  index: number
  kind: ResolutionStepKind
  events: BoardEvent[]
  beforeRevision: number
  afterRevision: number
  snapshotAfter: BoardSnapshot
}

/**
 * 1手の解決を「セグメント境界で停止できる」形で進めるハンドル。
 * swap()/tap() はジェネレータを直接drainする互換adapter＝従来と完全に同じ同期挙動
 * （snapshot構築のコストも払わない。runsimの性能を落とさないため）。
 * ResolutionCoordinator（Phase6）は next() でビュー再生の完了と交互に進める。
 * 注: drain() はコスト上 steps[] を組まず events + finalSnapshot だけを返す
 * （割込時の集計はイベント列から行える。codex_c_phase46_plan.md §8.2-B）。
 */
export interface MoveResolution {
  /** 次の境界まで実行し、その境界のstepを返す。もう差分が無ければ null */
  next(): ResolutionStep | null
  /** 残りをすべて実行し、残り差分と最終スナップショットを返す（割込時の無演出drain用） */
  drain(): { events: BoardEvent[]; finalSnapshot: BoardSnapshot }
  readonly done: boolean
  /** ここまでに積まれた全イベント */
  readonly events: BoardEvent[]
}

let resolutionSeq = 0

function makeResolution(board: Board, ev: BoardEvent[], gen: Generator<ResolutionStepKind>): MoveResolution {
  const resolutionId = ++resolutionSeq
  let cursor = 0
  let index = 0
  let finished = false
  return {
    next: () => {
      if (finished && cursor >= ev.length) return null
      // イベント差分が出る境界まで進める（空境界は飛ばす）。kind はその境界の yield 値
      let kind: ResolutionStepKind = 'finish'
      while (!finished) {
        const r = gen.next()
        if (r.done) {
          finished = true
          break
        }
        if (ev.length > cursor) {
          kind = r.value
          break
        }
      }
      if (ev.length === cursor) return null
      const events = ev.slice(cursor)
      cursor = ev.length
      const beforeRevision = board.revision
      board.revision++ // 境界の確定＝表示が追うべき論理状態が1つ進んだ
      return {
        resolutionId,
        index: index++,
        kind,
        events,
        beforeRevision,
        afterRevision: board.revision,
        snapshotAfter: board.snapshot(),
      }
    },
    drain: () => {
      const start = cursor
      while (!finished) {
        if (gen.next().done) finished = true
      }
      cursor = ev.length
      board.revision++
      return { events: ev.slice(start), finalSnapshot: board.snapshot() }
    },
    get done() {
      return finished
    },
    get events() {
      return ev
    },
  }
}

export class Board {
  cells: Cell[][] = [] // [y][x]
  rng: Rng
  movesLeft: number
  colors: Color[]
  goals: Goal[]
  goalDone: number[] = []
  chain = 0 // 現在の連鎖段数（SEピッチ用）
  subiCharge: number
  score = 0 // 消去1駒=10点×連鎖倍率、特殊駒発動=+50（DESIGN.md §2）
  /** C案移行Phase5.5：停止境界の確定ごとに単調増加。表示側は presentedRevision と比較して追従を検証する */
  revision = 0

  // ---- ローグライク拡張（ROGUE.md §3）：run が無ければ以下は一切使われない ----
  private hooks: { upgradeId: string; hook: Hook }[] = []
  private hookFireCount = 0 // 1解決あたりのフック発火数（暴走対策の上限200）
  private hooksSuspended = false
  resolveDestroyCount = 0 // 1解決あたりの破壊駒数（RunRecords.maxDestroyed用）。runsim.tsが1手ぶんの値を直接読むため公開している
  private lastHookReplay: HookReplaySnapshot | null = null // 模倣の粘菌(#14)用（データのみ。夜間監査[C]1）
  private lastSpecialReplay: { at: XY; piece: Piece; combo?: Piece } | null = null // 模倣の粘菌(#14)：他の強化が1つも発動していない場合のフォールバック先（第5波・データのみ）
  /** 第3波：Board構築（＝層開始）時に発生した初期イベント（予熱供給・スターター効果）。
   *  main.ts側のswap/tap経由イベントとは違い戻り値で受け取れないため、公開フィールドとして保持する。
   *  ビュー側は `new Board(...)` の直後にこれを読んで発動演出を出す想定（契約。実装はビュー側の役割）。 */
  initEvents: BoardEvent[] = []

  // ---- ローグライク拡張（ROGUE.md §5/§6）：敵・ターン制・環境。run が無ければ一切使われない ----
  enemies: EnemyInstance[] = []
  private floorCleared = false
  private runOverFired = false
  /** 大喰らい（祝福）：4つ以上のまとめ消し1回につきともる灯（0＝持っていない）。
   *  盤面を動かさない会計への還元なのでフックにせず、このフラグ1つで resolveMatches が扱う */
  private bigMatchLamp = 0
  private resolveSeq = 0 // 解決（1手）の通し番号。beginResolve で進む
  private bossShellHitAtSeq = -1 // 匣を剥がした解決の番号（同一解決での二重剥がし抑止。初期値-1＝未剥がし）

  constructor(
    public def: LevelDef,
    public run?: RunState,
    floor?: FloorDef,
  ) {
    this.rng = makeRng(def.seed)
    this.movesLeft = def.moves
    this.colors = ([0, 1, 2, 3, 4] as Color[]).slice(0, def.colors)
    this.goals = def.goals
    this.goalDone = def.goals.map(() => 0)
    this.subiCharge = def.subiCharge ?? 4
    if (run)
      this.hooks = UPGRADES.filter((u) => run.upgrades.includes(u.id)).flatMap((u) => {
        // 深化（PHASE2.md §2.8）：知見は入れ替わらず、発動条件だけがゆるんだフックに差し替わる
        const deepen = u.deepen && run.deepened.includes(u.id) ? u.deepen.apply : null
        return u.hooks.map((hook) => ({ upgradeId: u.id, hook: deepen ? deepen(hook) : hook }))
      })
    if (run) this.bigMatchLamp = blessingBigMatchLamp(run.blessings)
    this.initProgress()
    this.loadLayout(def.layout)
    this.fillInitial()
    const initEv: BoardEvent[] = []
    this.applyPreheat(initEv)
    if (floor) this.spawnFloor(floor)
    this.applyStarters(initEv) // 第3波：敵配置の後（damageEnemyが敵を参照できるように）
    this.applyBlessingFloorStart(initEv) // 祝福の盤面効果（工程2）。原生種を傷つけるものがあるので敵配置の後
    // fillInitial の詰み防止は spawnFloor より前に走るため、敵配置や採録時のおまけ（starter）で
    // 駒が書き換わると保証が破れる。**盤面を動かす処理をすべて終えた最後に**もう一度「有効手あり」を
    // 作り直す（有効手0で始まる層をなくす）。starter の後に置かないと、たとえば磁気採掘が最後の有効手を
    // ギアに塗り替えた層が1手も打てない状態で始まり、遊ぶ側は投了しかできなくなる（実測：seed 515735 深度27）
    if (floor) {
      let g = 0
      while (!this.hasValidMove() && g++ < 100) this.rerollSomePieces()
    }
    this.initEvents = initEv
  }

  private loadLayout(layout: string[]) {
    for (let y = 0; y < H; y++) {
      const row: Cell[] = []
      for (let x = 0; x < W; x++) {
        const ch = layout[y]?.[x] ?? '.'
        const c: Cell = { hole: ch === '#', piece: null, ground: 0, block: null }
        if (ch === 'g') c.ground = 1
        if (ch === 'G') c.ground = 2
        if (ch === 'k') c.block = { type: 'kokeishi', hp: 1 }
        if (ch === 'K') c.block = { type: 'kokeishi', hp: 2 }
        if (ch === 'h') c.block = { type: 'hako', hp: 1 }
        if (ch === 's') c.block = { type: 'subi', remaining: this.subiCharge }
        row.push(c)
      }
      this.cells.push(row)
    }
  }

  at(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= W || y >= H) return null
    const c = this.cells[y][x]
    return c.hole ? null : c
  }

  /** 初期配置：即マッチ無し・有効手ありを保証 */
  private fillInitial() {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (!c || c.block) continue
        c.piece = { kind: 'normal', color: this.pickColorNoMatch(x, y) }
      }
    let guard = 0
    while (!this.hasValidMove() && guard++ < 100) this.rerollSomePieces()
  }

  private pickColorNoMatch(x: number, y: number): Color {
    const pool = this.matchSafePool(x, y)
    return pool[randInt(this.rng, pool.length)]
  }

  /** 左2連・上2連との即マッチを作らない色の候補（pickColorNoMatch / pickColorRefill 共通の規則） */
  private matchSafePool(x: number, y: number): Color[] {
    const bad = new Set<Color>()
    const cw = (dx: number, dy: number) => {
      const c = this.at(x + dx, y + dy)?.piece
      return c && c.kind === 'normal' ? c.color : null
    }
    // 左2連・上2連と同色は避ける（初期即マッチ防止）
    if (cw(-1, 0) !== null && cw(-1, 0) === cw(-2, 0)) bad.add(cw(-1, 0)!)
    if (cw(0, -1) !== null && cw(0, -1) === cw(0, -2)) bad.add(cw(0, -1)!)
    return this.colors.filter((c) => !bad.has(c))
  }

  /**
   * 補充専用の色選び（工程3）。即マッチ回避は pickColorNoMatch と同じ規則のまま、
   * 着地点の上下左右に既にある通常駒の色へ REFILL_BIAS 倍だけ重みを寄せる（同色2つ隣接なら二乗）。
   * 見た目に規則が読める強さにはしない＝あくまで確率の裾を持ち上げるだけ。マッチの保証はどこにも無い。
   * REFILL_BIAS=1.0 のときは乱数消費まで従来と同一（randInt 1回）＝無傾斜の挙動が正確に再現できる。
   */
  private pickColorRefill(x: number, y: number): Color {
    const pool = this.matchSafePool(x, y)
    if (REFILL_BIAS === 1 || pool.length <= 1) return pool[randInt(this.rng, pool.length)]
    const counts = new Map<Color, number>()
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const p = this.at(x + dx, y + dy)?.piece
      if (p?.kind === 'normal') counts.set(p.color, (counts.get(p.color) ?? 0) + 1)
    }
    const weights = pool.map((c) => Math.pow(REFILL_BIAS, counts.get(c) ?? 0))
    let total = 0
    for (const w of weights) total += w
    let r = this.rng() * total
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i]
      if (r < 0) return pool[i]
    }
    return pool[pool.length - 1] // 浮動小数の端数で稀にここへ落ちる保険
  }

  private rerollSomePieces(ev?: BoardEvent[]) {
    // 詰み防止：ランダムな通常駒を数個塗り直す（盤面シャッフルはしない＝RM流）
    // 即マッチを作らない色を選び、ビューへは refill イベントで通知する（Codexレビュー#1）
    for (let i = 0; i < 6; i++) {
      const x = randInt(this.rng, W)
      const y = randInt(this.rng, H)
      const c = this.at(x, y)
      if (c?.piece?.kind === 'normal') {
        const piece: Piece = { kind: 'normal', color: this.pickColorNoMatch(x, y) }
        c.piece = piece
        ev?.push({ t: 'reroll', at: { x, y }, piece }) // C案移行Phase3：補充と区別できる専用イベントで通知
      }
    }
  }

  /** 有効なスワップ手を列挙（ソルバー・ヒント用） */
  validMoves(): { a: XY; b: XY }[] {
    const out: { a: XY; b: XY }[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (this.wouldMatch(x, y, x + dx, y + dy)) out.push({ a: { x, y }, b: { x: x + dx, y: y + dy } })
        }
    return out
  }

  /** 盤上の特殊駒位置を列挙 */
  specialsOnBoard(): XY[] {
    const out: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = this.at(x, y)?.piece
        if (p && p.kind !== 'normal' && p.kind !== 'spore') out.push({ x, y })
      }
    return out
  }

  /** 有効手（スワップしてマッチが生まれる手 or 特殊駒タップ）があるか */
  hasValidMove(): boolean {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') return true
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (this.wouldMatch(x, y, x + dx, y + dy)) return true
        }
      }
    return false
  }

  private wouldMatch(ax: number, ay: number, bx: number, by: number): boolean {
    const a = this.at(ax, ay)
    const b = this.at(bx, by)
    if (!a?.piece || !b?.piece) return false
    if (a.piece.kind !== 'normal' || b.piece.kind !== 'normal') return false
    this.swapPieces(a, b)
    const hit = this.hasAnyMatch()
    this.swapPieces(a, b)
    return hit
  }

  /** ラン（3+連）または2×2正方形が盤上にあるか */
  private hasAnyMatch(): boolean {
    return this.findRuns().length > 0 || this.findSquares().length > 0
  }

  private swapPieces(a: Cell, b: Cell) {
    const t = a.piece
    a.piece = b.piece
    b.piece = t
  }

  // ---- マッチ検出 ----

  /** 縦横の3+連を列挙 */
  private findRuns(): { cells: XY[]; color: Color; dir: 'h' | 'v' }[] {
    const runs: { cells: XY[]; color: Color; dir: 'h' | 'v' }[] = []
    const colAt = (x: number, y: number) => {
      const p = this.at(x, y)?.piece
      return p?.kind === 'normal' ? p.color : null
    }
    for (let y = 0; y < H; y++) {
      let x = 0
      while (x < W) {
        const c = colAt(x, y)
        if (c === null) {
          x++
          continue
        }
        let len = 1
        while (colAt(x + len, y) === c) len++
        if (len >= 3) runs.push({ color: c, dir: 'h', cells: Array.from({ length: len }, (_, i) => ({ x: x + i, y })) })
        x += len
      }
    }
    for (let x = 0; x < W; x++) {
      let y = 0
      while (y < H) {
        const c = colAt(x, y)
        if (c === null) {
          y++
          continue
        }
        let len = 1
        while (colAt(x, y + len) === c) len++
        if (len >= 3) runs.push({ color: c, dir: 'v', cells: Array.from({ length: len }, (_, i) => ({ x, y: y + i })) })
        y += len
      }
    }
    return runs
  }

  /** 2×2 の同色正方形（羽虫）。ラン優先のため、ラン所属セルを除いた判定は呼び出し側で行う */
  private findSquares(): { cells: XY[]; color: Color }[] {
    const out: { cells: XY[]; color: Color }[] = []
    const colAt = (x: number, y: number) => {
      const p = this.at(x, y)?.piece
      return p?.kind === 'normal' ? p.color : null
    }
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const c = colAt(x, y)
        if (c === null) continue
        if (colAt(x + 1, y) === c && colAt(x, y + 1) === c && colAt(x + 1, y + 1) === c)
          out.push({
            color: c,
            cells: [
              { x, y },
              { x: x + 1, y },
              { x, y: y + 1 },
              { x: x + 1, y: y + 1 },
            ],
          })
      }
    return out
  }

  // ---- 解決ループ ----
  // C案移行Phase5（codex_arch_review.md §3-5）：1手の解決はジェネレータ（swapGen/tapGen）が
  // セグメント境界（yield）を挟みながら実行する。従来の swap()/tap() は最後までdrainする
  // 互換adapter＝呼び出し側から見た同期挙動・イベント順・RNG消費は完全に不変。
  // 将来のResolutionCoordinator（Phase6）は swapStepped()/tapStepped() の next() で
  // ビュー再生の完了と交互に進める（表示境界と論理境界を一致させる）。

  /**
   * プレイヤーの1手（スワップ）。イベント列を返す。
   * 不正手（マッチも特殊駒も絡まない）は illegal イベントのみで手数を消費しない。
   */
  swap(a: XY, b: XY): BoardEvent[] {
    const ev: BoardEvent[] = []
    for (const _ of this.swapGen(a, b, ev)) {
      /* drain（snapshot・step構築のコストは払わない） */
    }
    return ev
  }

  /** swapの段階的解決ハンドル（Phase5）。まだ何も実行していない＝最初のnext()/drain()で動き出す */
  swapStepped(a: XY, b: XY): MoveResolution {
    const ev: BoardEvent[] = []
    return makeResolution(this, ev, this.swapGen(a, b, ev))
  }

  /** 表示・HUDが参照する論理状態のdeep cloneスナップショット（Phase5.5） */
  snapshot(): BoardSnapshot {
    return structuredClone({
      cells: this.cells,
      enemies: this.enemies,
      goalDone: this.goalDone,
      movesLeft: this.movesLeft,
      score: this.score,
      chain: this.chain,
      oxygen: this.run ? this.run.oxygen : null,
      floorCleared: this.floorCleared,
      runOverFired: this.runOverFired,
    })
  }

  private *swapGen(a: XY, b: XY, ev: BoardEvent[]): Generator<ResolutionStepKind> {
    const ca = this.at(a.x, a.y)
    const cb = this.at(b.x, b.y)
    if (!ca?.piece || !cb?.piece || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) {
      ev.push({ t: 'swap', a, b, illegal: true })
      yield 'swap'
      return
    }
    this.beginResolve() // 1解決（このswap一手ぶんの連鎖・浮上再安定化まで）のフック予算をリセット
    const isSpecial = (p: Piece) => p.kind !== 'normal' && p.kind !== 'spore'
    // 特殊駒コンボ（両方特殊）: 両方消費して b 地点で合成発動
    if (isSpecial(ca.piece) && isSpecial(cb.piece)) {
      const pa = ca.piece
      const pb = cb.piece
      ca.piece = null
      cb.piece = null
      ev.push({ t: 'swap', a, b, illegal: false })
      ev.push({ t: 'combo', at: b, from: a, kinds: `${pa.kind}+${pb.kind}` })
      this.spendMove(ev)
      this.chain = 0
      yield 'swap'
      this.fireSpecial(b, pb, ev, pa)
      yield 'resolve' // 発動の消しが確定
      yield* this.cascadeSegments(ev)
      yield* this.endMoveSegments(ev)
      return
    }
    // 片方が特殊駒: スワップして移動先で単発発動
    if (isSpecial(ca.piece) || isSpecial(cb.piece)) {
      this.swapPieces(ca, cb)
      const at = isSpecial(cb.piece!) ? b : a
      const cell = this.at(at.x, at.y)!
      const p = cell.piece!
      cell.piece = null
      ev.push({ t: 'swap', a, b, illegal: false })
      this.spendMove(ev)
      this.chain = 0
      yield 'swap'
      this.fireSpecial(at, p, ev)
      yield 'resolve' // 発動の消しが確定
      yield* this.cascadeSegments(ev)
      yield* this.endMoveSegments(ev)
      return
    }
    this.swapPieces(ca, cb)
    if (!this.hasAnyMatch()) {
      this.swapPieces(ca, cb) // 戻す
      ev.push({ t: 'swap', a, b, illegal: true })
      yield 'swap'
      return
    }
    ev.push({ t: 'swap', a, b, illegal: false })
    this.spendMove(ev)
    this.chain = 0
    yield 'swap'
    this.resolveMatches(ev, b)
    yield 'resolve' // 1連鎖目の消しが確定
    yield* this.cascadeSegments(ev)
    yield* this.endMoveSegments(ev)
  }

  /** 特殊駒タップ発動 */
  tap(at: XY): BoardEvent[] {
    const ev: BoardEvent[] = []
    for (const _ of this.tapGen(at, ev)) {
      /* drain */
    }
    return ev
  }

  /** tapの段階的解決ハンドル（Phase5） */
  tapStepped(at: XY): MoveResolution {
    const ev: BoardEvent[] = []
    return makeResolution(this, ev, this.tapGen(at, ev))
  }

  private *tapGen(at: XY, ev: BoardEvent[]): Generator<ResolutionStepKind> {
    this.beginResolve()
    const c = this.at(at.x, at.y)
    if (!c?.piece || c.piece.kind === 'normal' || c.piece.kind === 'spore') return
    this.spendMove(ev)
    this.chain = 0
    yield 'swap' // 入力コスト（タップも入力フェーズとして扱う）
    this.fireAt(at, ev)
    yield 'resolve' // 発動の消しが確定
    yield* this.cascadeSegments(ev)
    yield* this.endMoveSegments(ev)
  }

  /**
   * 1手の締め（swap/tapの共通末尾）。afterMove → 層クリア判定 → （未クリアなら）敵ターン。
   * 目標を達成した手では敵ターンを走らせない＝早く達成すれば反撃を受けずに層を出られる。
   */
  private *endMoveSegments(ev: BoardEvent[]): Generator<ResolutionStepKind> {
    yield 'gravity' // cascadeSegments末尾（ガード後の充填・詰み保険reroll）をここで区切る
    yield* this.afterMoveSegments(ev)
    this.checkFloorClear(ev)
    yield 'finish' // floor-clear / oxygen-refill の確定（未クリアなら空境界としてスキップされる）
    if (this.floorCleared) return
    yield* this.enemyTurnSegments(ev)
  }

  /** 1連鎖ぶんのマッチを消して特殊駒を生成。何か消したら true */
  private resolveMatches(ev: BoardEvent[], born?: XY): boolean {
    const runs = this.findRuns()
    const squaresEarly = this.findSquares()
    if (runs.length === 0 && squaresEarly.length === 0) return false
    this.chain++
    const used = new Set<string>()
    const key = (p: XY) => `${p.x},${p.y}`
    // ラン同士の交差 → L/T字（火壺）。単独5連 → 星珠。4連 → 銛。
    const clusters: { cells: XY[]; color: Color; special?: Piece }[] = []
    const taken = new Set<number>()
    for (let i = 0; i < runs.length; i++) {
      if (taken.has(i)) continue
      const r = runs[i]
      let cells = [...r.cells]
      let special: Piece | undefined
      for (let j = i + 1; j < runs.length; j++) {
        if (taken.has(j)) continue
        const s = runs[j]
        if (s.color !== r.color || s.dir === r.dir) continue
        if (r.cells.some((p) => s.cells.some((q) => q.x === p.x && q.y === p.y))) {
          cells = [...cells, ...s.cells.filter((q) => !cells.some((p) => p.x === q.x && p.y === q.y))]
          special = { kind: 'hitsubo' }
          taken.add(j)
        }
      }
      if (!special) {
        if (r.cells.length >= 5) special = { kind: 'seiju' }
        else if (r.cells.length === 4) {
          special = { kind: 'harpoon', dir: r.dir === 'h' ? 'v' : 'h' }
          if (this.run) special.origin = systemOf(r.color) // 蔓ロケット(#17)判定用のタグ付け（発動時にfireSpecialが読む）
        }
      }
      clusters.push({ cells, color: r.color, special })
      taken.add(i)
    }
    // 2×2（羽虫）：ランに使われていないセルのみで成立
    for (const sq of this.findSquares()) {
      const overlap = clusters.some((cl) => cl.cells.some((p) => sq.cells.some((q) => q.x === p.x && q.y === p.y)))
      if (!overlap) clusters.push({ cells: sq.cells, color: sq.color, special: { kind: 'hamushi' } })
    }
    for (const cl of clusters) {
      ev.push({ t: 'match', cells: cl.cells, color: cl.color, chain: this.chain })
      // 磁気採掘（夜間監査[C]2）：このギアマッチに充填済みギアが1つでも含まれていれば、このマッチから出る
      // ギア起動を2回にする。消費は「マッチ成立の瞬間」に1回だけ（複数の充填ギアが混ざっていても2倍が上限）。
      let gearBoost = false
      if (this.run && systemOf(cl.color) === 'gear') {
        for (const p of cl.cells) {
          const piece = this.at(p.x, p.y)?.piece
          if (piece?.kind === 'normal' && piece.charged) gearBoost = true
        }
      }
      for (const p of cl.cells) {
        if (used.has(key(p))) continue
        used.add(key(p))
        this.clearPieceAt(p, ev, cl.color, 'match', gearBoost)
      }
      // SPEC_OXYGEN §1.3：3個マッチは1ダメージ、4個以上はマッチ駒数ぶん＋heavy（swarm伝播の条件）
      this.damageAround(cl.cells, ev, cl.cells.length >= 4 ? cl.cells.length : 1, cl.cells.length >= 4)
      if (this.run) {
        const g: MatchGroup = { cells: cl.cells, color: cl.color, chain: this.chain, system: systemOf(cl.color) }
        this.fireMatchHooks(g, ev)
        // 大喰らい（祝福）：4つ以上のまとめ消し（2×2含む）1回につき灯が1ともる。器で頭打ち＝実際に
        // 増えた量だけを出す（満タンで0なら何も出さない。「+0」の嘘の実況を作らない）
        if (this.bigMatchLamp > 0 && cl.cells.length >= 4) {
          const gained = gainLamp(this.run, this.bigMatchLamp)
          if (gained > 0) ev.push({ t: 'lamp-bonus', amount: gained, at: cl.cells[0], left: this.run.oxygen })
        }
      }
      if (cl.special) {
        // 生成位置：プレイヤーのスワップ先がクラスタ内ならそこ、でなければ中央
        const spawnAt = born && cl.cells.some((p) => p.x === born.x && p.y === born.y) ? born : cl.cells[Math.floor(cl.cells.length / 2)]
        const c = this.at(spawnAt.x, spawnAt.y)
        if (c && !c.block) {
          c.piece = cl.special
          ev.push({ t: 'special-born', at: spawnAt, piece: cl.special })
        }
      }
    }
    return true
  }

  /**
   * 駒を消す（蔦苔剥がし・ゴール計上・スコア込み）。
   * doubleGear：磁気採掘（夜間監査[C]2）用。このマッチに充填済みギアが含まれていたとき true になり、
   * このマッチから出るギア駒のgearTrigger発火を2回にする（onPieceDestroyedへ渡す）。
   */
  private clearPieceAt(p: XY, ev: BoardEvent[], countColor?: Color, cause: DestroyCause = 'match', doubleGear = false) {
    const c = this.at(p.x, p.y)
    if (!c) return
    if (c.armored) {
      // 岩殻獣の甲殻（ROGUE.md §5）：1回分の追加破壊を要求する。駒はまだ消えない
      c.armored = false
      ev.push({ t: 'armor-broken', at: p })
      return
    }
    if (c.piece?.kind === 'normal' && countColor !== undefined) this.progressGoal({ type: 'color', color: c.piece.color }, p, ev)
    if (c.piece) this.score += 10 * Math.max(1, this.chain)
    const destroyedPiece = c.piece
    const hadPreyMark = c.preyMark === true
    c.piece = null
    if (c.ground > 0) {
      c.ground = (c.ground - 1) as 0 | 1
      ev.push({ t: 'ground-hit', at: p, left: c.ground })
      if (c.ground === 0) this.progressGoal({ type: 'tsutagoke' }, p, ev)
    }
    if (this.run) {
      // 捕食印の駒そのものを消したら追い払い、崩落予告の内側を消したら中断（どちらも「その1マスを狙う」ご褒美）
      if (hadPreyMark) this.releasePreyMark(p, ev)
      if (destroyedPiece) this.checkFissureAverted(p, ev)
    }
    if (this.run && destroyedPiece) {
      this.resolveDestroyCount++
      this.onPieceDestroyed(p, destroyedPiece, cause, ev, doubleGear)
    }
  }

  /**
   * マッチ隣接ダメージ（苔石・匣・陶片・巣灯・敵の身体セル）。
   * 敵へのダメージ量は既定でマッチ駒数ぶん（ROGUE.md §5：「隣接するマッチ=マッチ駒数ぶんダメージ」）。
   * 同じ敵の身体セルに複数隣接していても、1回のマッチにつき1回だけダメージを与える（enemyIdで重複排除）。
   * heavy：大きく消した一撃かどうか（SPEC_OXYGEN §1.3）。swarm の伝播条件に使う。
   */
  private damageAround(cells: XY[], ev: BoardEvent[], enemyDmg?: number, heavy = false) {
    const dmg = enemyDmg ?? cells.length
    const hit = new Set<string>()
    const hitEnemies = new Set<number>()
    for (const p of cells)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const q = { x: p.x + dx, y: p.y + dy }
        const k = `${q.x},${q.y}`
        if (hit.has(k)) continue
        hit.add(k)
        const c = this.at(q.x, q.y)
        if (c?.block?.type === 'enemy') {
          if (!hitEnemies.has(c.block.enemyId)) {
            hitEnemies.add(c.block.enemyId)
            this.dealEnemyDamage(c.block.enemyId, dmg, ev, heavy)
          }
          continue
        }
        this.damageBlock(q, ev, 1, heavy)
      }
  }

  /** enemyDmg：敵の身体セルを直接ヒットした場合のダメージ量（既定1＝特殊駒の効果線が通った扱い。爆発は3を渡す） */
  damageBlock(p: XY, ev: BoardEvent[], enemyDmg = 1, heavy = false) {
    const c = this.at(p.x, p.y)
    if (!c?.block) return
    const b = c.block
    if (b.type === 'enemy') {
      this.dealEnemyDamage(b.enemyId, enemyDmg, ev, heavy)
      return
    }
    if (b.type === 'seal') return // 穴潜みの封鎖セルは攻撃で解除されない（期限切れのみ）
    if (b.type === 'subi') {
      // 巣灯：隣接ヒットで胞子を1つ排出（空きマスがあれば）。残0で閉鎖
      if (b.remaining > 0) {
        const spot = this.findSporeSpot(p)
        if (spot) {
          const sc = this.at(spot.x, spot.y)!
          sc.piece = { kind: 'spore' }
          b.remaining--
          ev.push({ t: 'spore-born', at: spot })
          ev.push({ t: 'block-hit', at: p, type: 'subi', destroyed: b.remaining === 0 })
          if (b.remaining === 0) c.block = null // 閉鎖＝マスが空く
        }
      }
      return
    }
    b.hp--
    const destroyed = b.hp <= 0
    ev.push({ t: 'block-hit', at: p, type: b.type, destroyed })
    if (destroyed) {
      if (b.type === 'hako') {
        c.block = { type: 'touhen', hp: 1 } // 匣→陶片
      } else {
        if (b.type === 'kokeishi') this.progressGoal({ type: 'kokeishi' }, p, ev)
        if (b.type === 'touhen') this.progressGoal({ type: 'touhen' }, p, ev)
        c.block = null
      }
    }
  }

  private findSporeSpot(near: XY): XY | null {
    // 巣灯の周囲：空きマス優先、無ければ通常駒を置き換えて湧く
    const dirs = [
      [0, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
    ] as const
    for (const [dx, dy] of dirs) {
      const c = this.at(near.x + dx, near.y + dy)
      if (c && !c.block && !c.piece) return { x: near.x + dx, y: near.y + dy }
    }
    for (const [dx, dy] of dirs) {
      const c = this.at(near.x + dx, near.y + dy)
      if (c && !c.block && c.piece?.kind === 'normal') return { x: near.x + dx, y: near.y + dy }
    }
    return null
  }

  // ---- 特殊駒発動・コンボ ----

  private fireAt(at: XY, ev: BoardEvent[]) {
    const c = this.at(at.x, at.y)
    if (!c?.piece) return
    const p = c.piece
    c.piece = null
    this.fireSpecial(at, p, ev)
  }

  private fireSpecial(at: XY, p: Piece, ev: BoardEvent[], combo?: Piece) {
    const cleared: XY[] = []
    const clearCell = (x: number, y: number) => {
      const c = this.at(x, y)
      if (!c) return
      if (c.block) {
        this.damageBlock({ x, y }, ev, 2, true) // 特殊駒の効果線は敵に2ダメージ＋heavy（SPEC_OXYGEN §1.3）
        return
      }
      if (!c.piece) return
      if (c.piece.kind === 'spore') return // 胞子は特殊駒でも壊れない（回収は上端のみ）
      if (c.piece.kind !== 'normal') {
        // 誘爆
        const q = c.piece
        c.piece = null
        this.fireSpecial({ x, y }, q, ev)
      } else {
        // 甲殻付きの駒は clearPieceAt が消さずに return するため、ここで目標だけ進むと二重計上になる
        if (!c.armored) this.progressGoal({ type: 'color', color: c.piece.color }, { x, y }, ev)
        this.clearPieceAt({ x, y }, ev, undefined, 'special')
      }
      cleared.push({ x, y })
    }
    const row = (y: number) => {
      for (let x = 0; x < W; x++) clearCell(x, y)
    }
    const col = (x: number) => {
      for (let y = 0; y < H; y++) clearCell(x, y)
    }
    const blast = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) clearCell(x, y)
    }
    this.score += 50 // 特殊駒発動ボーナス
    const kinds = combo ? [p.kind, combo.kind].sort().join('+') : p.kind

    switch (kinds) {
      case 'harpoon':
        p.kind === 'harpoon' && p.dir === 'h' ? row(at.y) : col(at.x)
        break
      case 'hitsubo':
        blast(at.x, at.y, 2)
        break
      case 'hamushi':
        this.hamushiStrike(at, ev, 1, cleared)
        break
      case 'seiju':
        this.seijuClear(at, ev, null, cleared)
        break
      case 'harpoon+harpoon':
        row(at.y)
        col(at.x)
        break
      case 'harpoon+hitsubo':
        for (let d = -1; d <= 1; d++) {
          row(at.y + d)
          col(at.x + d)
        }
        break
      case 'hitsubo+hitsubo':
        blast(at.x, at.y, 4)
        break
      case 'hamushi+hamushi':
        this.hamushiStrike(at, ev, 3, cleared)
        break
      case 'hamushi+harpoon':
      case 'hamushi+hitsubo': {
        // 羽虫が相方を運んで目標地点で起爆
        const t = this.pickHamushiTarget()
        if (t) {
          if (kinds === 'hamushi+harpoon') {
            row(t.y)
            col(t.x)
          } else blast(t.x, t.y, 2)
        }
        break
      }
      case 'harpoon+seiju':
      case 'hitsubo+seiju':
      case 'hamushi+seiju':
        this.seijuClear(at, ev, combo && p.kind === 'seiju' ? combo : p, cleared)
        break
      case 'seiju+seiju':
        for (let y = 0; y < H; y++) row(y)
        break
    }
    // 異種シナジー強化（#17/#18）：特殊駒の発動そのものに介入するため on:match/destroy/... のどれにも
    // 当てはまらない。ここで run.upgrades を直接見て処理する（フック化していない理由は最終報告）。
    if (this.run) {
      if (p.kind === 'harpoon' && p.origin === 'plant' && this.run.upgrades.includes(VINE_ROCKET_ID) && cleared.length > 0) {
        const n = Math.floor(cleared.length * 0.1)
        for (let i = 0; i < n; i++) {
          const at2 = cleared[randInt(this.rng, cleared.length)]
          const c2 = this.at(at2.x, at2.y)
          if (c2 && !c2.block && !c2.piece) {
            c2.piece = { kind: 'normal', color: this.rng() < 0.5 ? 1 : 4 }
            ev.push({ t: 'special-born', at: at2, piece: c2.piece })
          }
        }
        if (n > 0) ev.push({ t: 'upgrade-fire', id: VINE_ROCKET_ID, at }) // 可視化第一波②：フック化していない強化も同様に発動アピール
      }
      if ((p.kind === 'hitsubo' || combo?.kind === 'hitsubo') && this.run.upgrades.includes(SPORE_BULLET_ID)) {
        this.spawnTokenAt(at, 'spore', ev)
        ev.push({ t: 'upgrade-fire', id: SPORE_BULLET_ID, at })
      }
      // 解体の心得（工程3）：特殊駒の発動そのものに反応する＝蔓ロケット・胞子弾と同じ直接処理組。
      // 原生種が居ない層では発火アピールも出さない（嘘を作らない）
      if (this.run.upgrades.includes(DISMANTLE_KNACK_ID)) {
        const e = this.nearestEnemy(at)
        if (e) {
          ev.push({ t: 'upgrade-fire', id: DISMANTLE_KNACK_ID, at })
          this.dealEnemyDamage(e.id, 2, ev) // 較正（工程3）：3→2（熾火の芯と同時に弱めた）
          this.run.records.effectFires++
        }
      }
      // 模倣の粘菌(#14・第5波)：強化を1つも発動していなくても空振りしないためのフォールバック対象として、
      // 直前に発動した特殊駒効果（種類・位置・コンボ相手）をデータとして覚えておく（関数は保存しない。夜間監査[C]1）。
      // replayLast()はlastHookReplayが無いときだけこれを使う（makeCtx参照）。
      this.lastSpecialReplay = { at, piece: { ...p }, combo: combo ? { ...combo } : undefined }
    }
    ev.push({ t: 'special-fire', at, piece: p, cleared })
  }

  /** 羽虫：残ゴールに効くマスを狙う（無ければランダムの通常駒）。消したマスは cleared に記録＝ビューへ通知 */
  private hamushiStrike(from: XY, ev: BoardEvent[], count: number, cleared: XY[]) {
    // 離陸時に隣接1マスも消す（RM仕様）。羽虫も特殊駒扱い＝2ダメージ＋heavy（SPEC_OXYGEN §1.3）
    this.damageAround([from], ev, 2, true)
    for (let i = 0; i < count; i++) {
      const t = this.pickHamushiTarget()
      if (!t) return
      const c = this.at(t.x, t.y)!
      if (c.block) this.damageBlock(t, ev, 2, true)
      else if (c.piece?.kind === 'normal') {
        if (!c.armored) this.progressGoal({ type: 'color', color: c.piece.color }, t, ev) // 甲殻付きは消えないので進めない
        this.clearPieceAt(t, ev, undefined, 'special')
        cleared.push(t)
      }
    }
  }

  private pickHamushiTarget(): XY | null {
    // 優先: 残ゴールに関係する障害物/蔦苔 → 通常駒
    const cands: XY[] = []
    const want = (t: string) => this.goals.some((g, i) => g.type === t && this.goalDone[i] < g.count)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (!c) continue
        if (c.block?.type === 'kokeishi' && want('kokeishi')) cands.push({ x, y })
        if (c.block?.type === 'touhen' && want('touhen')) cands.push({ x, y })
        if (c.block?.type === 'hako' && want('touhen')) cands.push({ x, y })
        if (c.ground > 0 && want('tsutagoke')) cands.push({ x, y })
      }
    if (cands.length === 0)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (this.at(x, y)?.piece?.kind === 'normal') cands.push({ x, y })
    return cands.length ? cands[randInt(this.rng, cands.length)] : null
  }

  /** 星珠：盤上最多色を全消し。combo があれば消す代わりにその特殊駒へ変換して順次起爆。消去セルは cleared に記録 */
  private seijuClear(_at: XY, ev: BoardEvent[], convertTo: Piece | null, cleared: XY[]) {
    const count = new Map<Color, XY[]>()
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = this.at(x, y)?.piece
        if (p?.kind === 'normal') {
          if (!count.has(p.color)) count.set(p.color, [])
          count.get(p.color)!.push({ x, y })
        }
      }
    let best: XY[] = []
    for (const v of count.values()) if (v.length > best.length) best = v
    if (convertTo) {
      for (const p of best) {
        const c = this.at(p.x, p.y)!
        c.piece = convertTo.kind === 'harpoon' ? { kind: 'harpoon', dir: this.rng() < 0.5 ? 'h' : 'v' } : { ...convertTo }
        ev.push({ t: 'special-born', at: p, piece: c.piece })
      }
      for (const p of best) {
        const c = this.at(p.x, p.y)!
        if (c.piece && c.piece.kind !== 'normal') {
          const q = c.piece
          c.piece = null
          this.fireSpecial(p, q, ev)
        }
      }
    } else {
      for (const p of best) {
        const c = this.at(p.x, p.y)!
        // 計測用の長時間プレイで発見（バランス変更とは無関係の既存バグ）：このループ中に爆発鉱石の誘爆等の
        // 副作用でbest内の別セルが先に消えていることがある。既に無ければ何もしない（防御）。
        if (!c.piece || c.piece.kind !== 'normal') continue
        if (!c.armored) this.progressGoal({ type: 'color', color: c.piece.color }, p, ev) // 甲殻付きは消えないので進めない
        this.clearPieceAt(p, ev, undefined, 'special')
        cleared.push(p) // ビューへ通知（未通知だと幽霊/空白の温床）
      }
      this.damageAround(best, ev, 3, true) // 星珠の全消しは敵に3ダメージ＋heavy（SPEC_OXYGEN §1.3）
    }
  }

  // ---- 重力・リフィル・連鎖 ----

  /** 互換drain（Phase5）：内部呼び出し（afterMoveの再安定化・敵ターン・勝利起爆）はセグメント停止を
   *  使わないので、ジェネレータをその場で回し切る＝旧resolveCascadesと同一挙動 */
  private resolveCascades(ev: BoardEvent[]) {
    for (const _ of this.cascadeSegments(ev)) {
      /* drain */
    }
  }

  private *cascadeSegments(ev: BoardEvent[]): Generator<ResolutionStepKind> {
    let guard = 0
    while (guard++ < 50) {
      // 充填（落下＋斜め滑り＋リフィル）が安定するまで反復してからマッチ解決
      let inner = 0
      while (inner++ < 20) {
        const before = ev.length
        this.applyGravity(ev)
        this.refill(ev)
        if (ev.length === before) break
      }
      yield 'gravity' // 充填安定＝gravityセグメント境界
      if (!this.resolveMatches(ev)) break
      yield 'resolve' // 1連鎖ぶんの消しが確定＝resolveセグメント境界
    }
    // 連鎖ガード到達時も充填だけは安定させる（Codexレビュー#6）
    let inner2 = 0
    while (inner2++ < 20) {
      const before = ev.length
      this.applyGravity(ev)
      this.refill(ev)
      if (ev.length === before) break
    }
    // 連鎖収束後の詰み保険
    let g2 = 0
    while (!this.hasValidMove() && g2++ < 100) this.rerollSomePieces(ev)
  }

  private applyGravity(ev: BoardEvent[]) {
    // 垂直落下＋斜め滑り込みを安定するまで反復（本家仕様：真上が塞がれた空マスへ斜め上から供給）
    let guard = 0
    while (guard++ < 30) {
      this.applyVerticalGravity(ev)
      if (!this.applyDiagonalSlide(ev)) break
    }
  }

  /** 真上が障害物/盤外で塞がれた空マスへ、斜め上の駒を1つ滑り込ませる。動きがあれば true */
  private applyDiagonalSlide(ev: BoardEvent[]): boolean {
    let moved = false
    for (let y = H - 1; y >= 1; y--)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (!c || c.block || c.piece) continue
        const up = this.at(x, y - 1)
        const upSealed = !up || up.block !== null // 盤外 or 障害物＝垂直供給が不可能
        if (!upSealed) continue
        for (const dx of [-1, 1]) {
          const s = this.at(x + dx, y - 1)
          if (s?.piece && s.piece.kind !== 'spore') {
            c.piece = s.piece
            s.piece = null
            ev.push({ t: 'fall', from: { x: x + dx, y: y - 1 }, to: { x, y } })
            moved = true
            break
          }
        }
      }
    return moved
  }

  private applyVerticalGravity(ev: BoardEvent[]) {
    // 列ごとに、block/hole で区切られたセグメント内で下詰め。胞子は落ちない（浮遊）。
    for (let x = 0; x < W; x++) {
      let segBottom = H - 1
      for (let y = H - 1; y >= -1; y--) {
        const c = y >= 0 ? this.at(x, y) : null
        const solid = y < 0 || !c || c.block
        if (solid) {
          // セグメント [y+1 .. segBottom] を下詰め
          let write = segBottom
          for (let ry = segBottom; ry > y; ry--) {
            const rc = this.at(x, ry)!
            if (rc.piece && rc.piece.kind !== 'spore') {
              if (ry !== write) {
                this.at(x, write)!.piece = rc.piece
                rc.piece = null
                ev.push({ t: 'fall', from: { x, y: ry }, to: { x, y: write } })
              }
              write--
            } else if (rc.piece?.kind === 'spore') {
              // 胞子はその場に留まる：write を胞子の上へ
              write = ry - 1
            }
          }
          segBottom = y - 1
        }
      }
    }
  }

  private refill(ev: BoardEvent[]) {
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = this.at(x, y)
        if (!c || c.block || c.piece) continue
        // 上に block がある列セグメントには湧かない（RM同様、上端からのみ供給）
        let blocked = false
        for (let uy = y - 1; uy >= 0; uy--) {
          const u = this.at(x, uy)
          if (!u || u.block) {
            blocked = true
            break
          }
        }
        if (blocked) continue
        const piece: Piece = { kind: 'normal', color: this.pickColorRefill(x, y) } // 補充だけ連鎖傾斜（工程3）
        c.piece = piece
        ev.push({ t: 'refill', at: { x, y }, piece })
      }
  }

  /** 手の締め：胞子の浮上・回収、勝敗判定用の状態更新（テストが直接呼ぶ互換drain。本体からは afterMoveSegments を使う） */
  protected afterMove(ev: BoardEvent[]) {
    for (const _ of this.afterMoveSegments(ev)) {
      /* drain */
    }
  }

  private *afterMoveSegments(ev: BoardEvent[]): Generator<ResolutionStepKind> {
    let sporeMoved = false
    // 胞子は1手ごとに1マス浮上（上のマスの駒と入れ替わる「泡上がり」）。上端で回収。
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c?.piece?.kind !== 'spore') continue
        if (y === 0 || !this.at(x, y - 1)) {
          c.piece = null
          ev.push({ t: 'spore-collected', at: { x, y } })
          this.progressGoal({ type: 'spore' }, { x, y }, ev)
          sporeMoved = true
          continue
        }
        const up = this.at(x, y - 1)!
        if (!up.block && (!up.piece || up.piece.kind === 'normal')) {
          const t = up.piece
          up.piece = c.piece
          c.piece = t
          ev.push({ t: 'spore-rise', from: { x, y }, to: { x, y: y - 1 } })
          sporeMoved = true
        }
      }
    yield 'after-move' // 胞子の浮上・回収を区切る
    // 浮上で生じた空セル・偶発マッチを再安定化（Codexレビュー#3）
    if (sporeMoved) {
      yield* this.cascadeSegments(ev)
      yield 'gravity' // 再安定化の末尾（充填・reroll）を区切る
    }
    if (this.run) {
      this.run.records.maxChain = Math.max(this.run.records.maxChain, this.chain)
      this.run.records.maxDestroyed = Math.max(this.run.records.maxDestroyed, this.resolveDestroyCount)
    }
  }

  /**
   * 目標の前進。at＝この前進を起こしたセル（HUDへ飛ぶ収集演出の始点。JUICE.md §1②）。
   * 'system' 目標は 'color' の前進から systemOf() で導出する（呼び出し側を色ごとに書き分けない）。
   */
  private progressGoal(match: { type: Goal['type']; color?: Color }, at: XY, ev: BoardEvent[]) {
    this.goals.forEach((g, i) => {
      if (this.goalDone[i] >= g.count) return
      if (g.type === 'system') {
        if (match.type !== 'color' || match.color === undefined) return
        if (g.system !== systemOf(match.color)) return
      } else {
        if (g.type !== match.type) return
        if (g.type === 'color' && g.color !== match.color) return
      }
      this.goalDone[i]++
      ev.push({ t: 'goal-progress', goal: g, index: i, done: this.goalDone[i], at })
    })
  }

  get won(): boolean {
    return this.goals.every((g, i) => this.goalDone[i] >= g.count)
  }
  get lost(): boolean {
    return !this.won && this.movesLeft <= 0
  }

  /**
   * 1手ぶんのコストを支払う（PLAN_LOOP.md §1.4：1スワップ＝酸素-1）。
   * movesLeft は旧30レベル制の手数、oxygen はランの資源。ライフサイクルが違うので別フィールドのまま保持し、
   * 「手を1つ使った」という同じ事実に対してここでだけ両方を動かす（減算点を1本にする）。
   */
  private spendMove(ev: BoardEvent[]) {
    this.movesLeft--
    if (!this.run) return
    this.run.oxygen--
    ev.push({ t: 'oxygen-spent', left: this.run.oxygen })
  }

  /**
   * 層クリアの唯一の判定点（PLAN_LOOP.md §1.4）。目標がすべて満たされていればクリア（残敵がいてもクリアする）。
   * 補給は層クリアと不可分なので同じ関数の中で行う。1層につき1回だけ発火する。
   */
  private checkFloorClear(ev: BoardEvent[]) {
    if (!this.run || this.floorCleared) return
    if (this.goals.length === 0) return // 空goalsだと won が true になるため必須のガード
    if (!this.won) return
    this.floorCleared = true
    ev.push({ t: 'floor-clear' })
    // 補給量は祝福・呪いで動く（深度で変わるものもあるので run.floor を渡す）
    const supply = blessingSupply(this.run.blessings, this.run.floor)
    // 器（lampMax）でクランプ。amount は「実際に増えた量」＝ HUD の「灯 +N」も runsim の補給前復元（left-amount）も嘘にならない
    const gained = gainLamp(this.run, supply)
    ev.push({ t: 'oxygen-refill', amount: gained, left: this.run.oxygen })
  }
  /**
   * 勝利シーケンス：残手数を特殊駒（銛/歯車爆弾）に変換して全自動起爆（RM実測の再現）。
   * クリア確定後に一度だけ呼ぶ。イベント列を返す。
   */
  private winFinished = false

  finishWin(): BoardEvent[] {
    if (this.winFinished) return [] // 二重呼び出しガード（Codexレビュー#7）
    this.winFinished = true
    const ev: BoardEvent[] = []
    this.beginResolve()
    const drain = Math.min(this.movesLeft, 12) // 演出上限（ラッシュ全体を約5-6秒に収める）
    for (let i = 0; i < drain; i++) {
      this.movesLeft--
      // 変換先：ランダムな通常駒
      const cands: XY[] = []
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (this.at(x, y)?.piece?.kind === 'normal') cands.push({ x, y })
      let at: XY | null = null
      if (cands.length > 0) {
        at = cands[randInt(this.rng, cands.length)]
        const c = this.at(at.x, at.y)!
        const p: Piece =
          this.rng() < 0.75 ? { kind: 'harpoon', dir: this.rng() < 0.5 ? 'h' : 'v' } : { kind: 'hitsubo' }
        c.piece = p
        ev.push({ t: 'special-born', at, piece: p })
      }
      ev.push({ t: 'win-drain', movesLeft: this.movesLeft, convertAt: at })
    }
    this.movesLeft = 0
    ev.push({ t: 'win-detonate-begin' })
    // 盤上の特殊駒を順に全起爆（誘爆・連鎖込み）
    let guard = 0
    while (guard++ < 80) {
      let fired = false
      outer: for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const c = this.at(x, y)
          if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') {
            const p = c.piece
            c.piece = null
            this.chain = 0
            this.fireSpecial({ x, y }, p, ev)
            this.resolveCascades(ev)
            fired = true
            break outer
          }
        }
      if (!fired) break
    }
    return ev
  }

  /** 追加手数の購入（敗北オファー用） */
  addMoves(n: number): void {
    this.movesLeft += n
  }

  /** 3つ星評価（★1=クリア、★2/★3=スコア閾値。閾値はレベル定義 or 既定値） */
  get stars(): 0 | 1 | 2 | 3 {
    if (!this.won) return 0
    const s2 = this.def.star2 ?? 1500
    const s3 = this.def.star3 ?? 3000
    return this.score >= s3 ? 3 : this.score >= s2 ? 2 : 1
  }

  // ==== ローグライク拡張：フックシステム（ROGUE.md §3） ====
  // run が無いBoard（旧30レベル制）では以下は一切呼ばれず、挙動・性能とも無変化。

  /** 1解決（1手ぶんの連鎖～浮上再安定化まで）の頭でフック予算をリセット */
  private beginResolve() {
    this.resolveSeq++
    this.hookFireCount = 0
    this.hooksSuspended = false
    this.resolveDestroyCount = 0
    // 模倣の粘菌(#14)用のlastHookReplay/lastSpecialReplayはここではリセットしない（手をまたいで保持する。
    // 対象範囲は夜間監査[C]1のコメント＝HookReplaySnapshot定義の直前を参照）。
  }

  /** フック発火予算（暴走対策・上限200/解決）を1つ消費。使い切っていたら false＝以後のフックは打ち切り */
  private consumeHookBudget(): boolean {
    if (this.hookFireCount >= 200) {
      this.hooksSuspended = true
      if (this.run) this.run.records.critical = true // 臨界＝ご褒美フラグ（ROGUE.md §3）
      return false
    }
    this.hookFireCount++
    return true
  }

  /**
   * 可視化契約：回数条件で発動する強化の進捗欄をBoard構築時に確保する（ビューが所持直後から「0/2」を出せるように）。
   * 層をまたいでも run.progress は同じRunStateオブジェクト上で引き継がれるため、既にある値は上書きしない。
   */
  private initProgress() {
    if (!this.run) return
    const ensure = (id: string, max: number) => {
      if (this.run!.upgrades.includes(id) && !this.run!.progress[id]) this.run!.progress[id] = { cur: 0, max }
    }
    ensure(AUTONOMOUS_MECHANISM_ID, GEAR_TRIGGER_THRESHOLD)
    ensure(MECHANICAL_GARDEN_ID, GEAR_TRIGGER_THRESHOLD)
    ensure(POWDER_MILL_ID, GEAR_TRIGGER_THRESHOLD) // 火薬の挽き臼（工程3）も同じ「2回ごと」の可視化契約に乗る
    ensure(RELIC_RESONANCE_ID, 1) // 遺物共鳴は回数カウンタではなく「ブースト待機中」の0/1状態
  }

  /** 各層開始時（＝Board構築時）にギアを3つ追加供給する「予熱」強化の適用。第3波：発動をupgrade-fireで可視化する */
  private applyPreheat(ev: BoardEvent[]) {
    if (!this.run?.upgrades.includes(PREHEAT_ID)) return
    let first: XY | null = null
    for (let i = 0; i < 3; i++) {
      const cands: XY[] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (this.at(x, y)?.piece?.kind === 'normal') cands.push({ x, y })
      if (!cands.length) break
      const spot = cands[randInt(this.rng, cands.length)]
      const piece: Piece = { kind: 'normal', color: 0 }
      this.at(spot.x, spot.y)!.piece = piece
      ev.push({ t: 'special-born', at: spot, piece })
      first ??= spot
    }
    if (first) ev.push({ t: 'upgrade-fire', id: PREHEAT_ID, at: first })
  }

  /**
   * スターター効果（ROGUE2.md §1 原則2。第3波）：Board構築（＝層開始）のたび、取得済み強化のうち
   * まだ starter を発火していないものだけを1回発火する。適用済み管理は RunState.startersApplied。
   * ラン開始時に配布される初期強化（STARTER_UPGRADE_IDS）も、この仕組みで層1開始時に自然に発火する。
   */
  private applyStarters(ev: BoardEvent[]) {
    if (!this.run) return
    const ctx = this.makeCtx(ev)
    const center: XY = { x: Math.floor(W / 2), y: Math.floor(H / 2) }
    for (const u of UPGRADES) {
      if (!u.starter) continue
      if (!this.run.upgrades.includes(u.id) || this.run.startersApplied.includes(u.id)) continue
      this.run.startersApplied.push(u.id)
      const before = ev.length
      u.starter(ctx)
      const first = ev[before]
      const at = first && 'at' in first ? (first as unknown as { at: XY }).at : center
      ev.splice(before, 0, { t: 'upgrade-fire', id: u.id, at })
      this.run.records.effectFires++
    }
  }

  /**
   * 祝福の盤面効果（工程2）。**発火点は層開始（Board構築時）の一度だけ**：毎マッチ反応する知見と違い、
   * 祝福は「層がこう始まる」という規則の変更として画面に現れる（blessings.ts の切り分けを参照）。
   * 順序は敵配置・starterの後＝原生種を傷つける効果が敵を参照でき、構築末尾の詰み防止（有効手の作り直し）が
   * ここで置いた駒も込みで走る。乱数は盤面と同じ this.rng＝同じ層seedなら同じ場所に出る（決定的）。
   */
  private applyBlessingFloorStart(ev: BoardEvent[]) {
    if (!this.run) return
    const fx = blessingBoardFx(this.run.blessings)
    const randomCell = (pred: (c: Cell) => boolean): XY | null => {
      const cands: XY[] = []
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const c = this.at(x, y)
          if (c && pred(c)) cands.push({ x, y })
        }
      return cands.length ? cands[randInt(this.rng, cands.length)] : null
    }
    // 火の脈：鉱物の駒2つが爆発鉱石に。鉱物が足りない盤では他の通常駒を鉱物ごと爆発鉱石へ変える（死んだ祝福を作らない）
    for (let i = 0; i < fx.oreSeeds; i++) {
      const p =
        randomCell((c) => c.piece?.kind === 'normal' && c.piece.color === 2 && !c.piece.volatile) ??
        randomCell((c) => c.piece?.kind === 'normal' && !c.piece.volatile)
      if (!p) break
      this.transformPieceAt(p, { kind: 'normal', color: 2, volatile: true }, ev)
    }
    // 置き銛：通常駒1つを銛に置き換える（銛はタップで撃てるので、有効手の保証にもそのまま数えられる）
    for (let i = 0; i < fx.harpoons; i++) {
      const p = randomCell((c) => c.piece?.kind === 'normal' && !c.piece.volatile)
      if (!p) break
      this.transformPieceAt(p, { kind: 'harpoon', dir: this.rng() < 0.5 ? 'h' : 'v' }, ev)
    }
    // 光の名残：光胞子トークンを落とす（隣で駒が消えると反応する既存のトークンそのもの）
    for (let i = 0; i < fx.sporeTokens; i++) {
      const p = randomCell((c) => !c.block && !c.sporeToken)
      if (!p) break
      this.spawnTokenAt(p, 'spore', ev)
    }
    // 先手の礫：すべての原生種が傷を負って始まる（殻もち＝深匣主・鐘脚は殻が1枚剥がれる）
    if (fx.wound > 0) for (const e of [...this.enemies]) this.dealEnemyDamage(e.id, fx.wound, ev)
    // 眠りの帳：定期行動のカウンタを負から始める＝初回だけ発火が遅れる（resolveEnemyTurn が負の間は発火させない）
    if (fx.wakeDelay > 0) for (const e of this.enemies) e.actionTimer -= fx.wakeDelay
  }

  /**
   * 駒が1つ破壊された直後のローグ処理（destroyフック→胞子タッチ→ギア起動→爆発鉱石連鎖）。clearPieceAtから一元的に呼ばれる。
   * doubleGear：磁気採掘（夜間監査[C]2）。charged状態だったギアを含むマッチから来た破壊なら、
   * このギア駒のgearTrigger発火を2回にする（自律機構/機械庭園/遺物共鳴などgearTrigger購読側が2回分見る）。
   */
  private onPieceDestroyed(at: XY, piece: Piece, cause: DestroyCause, ev: BoardEvent[], doubleGear = false) {
    if (!this.run) return
    this.fireDestroyHooks(at, cause, piece, ev)
    this.checkSporeTouch(at, ev)
    if (piece.kind === 'normal' && piece.color === 0 && (cause === 'match' || cause === 'explode')) {
      this.triggerGear(at, ev)
      if (doubleGear) this.triggerGear(at, ev)
    }
    if (piece.kind === 'normal' && piece.volatile) {
      this.explodeAt(at, ev, this.defaultExplosionOpts())
    }
  }

  private defaultExplosionOpts(): { radius: number; shape: 'cross' | 'square' } {
    return this.run?.upgrades.includes(RESONANT_SHATTER_ID) ? { radius: 1, shape: 'square' } : { radius: 1, shape: 'cross' }
  }

  /** ギア起動（マッチ消滅 or 爆発に巻き込まれる、または強化による追加チャージ）。ROGUE.md §3 */
  private triggerGear(at: XY, ev: BoardEvent[]) {
    if (!this.run) return
    this.run.gearCharge++
    const count = this.run.gearCharge
    ev.push({ t: 'gear-trigger', at, count })
    this.updateGearCountProgress(count)
    this.fireGearTriggerHooks(at, count, ev)
  }

  /** 自律機構/機械庭園（ギアN回起動で発動）の進捗を更新する。gearChargeは全強化共有の1本カウンタなので、
   *  「今のサイクル内で何回目か」を ((count-1) % N) + 1 で求める（N回目でmaxに達し、次サイクルで1に戻る） */
  private updateGearCountProgress(count: number) {
    if (!this.run) return
    const cur = ((count - 1) % GEAR_TRIGGER_THRESHOLD) + 1
    for (const id of [AUTONOMOUS_MECHANISM_ID, MECHANICAL_GARDEN_ID, POWDER_MILL_ID]) {
      if (!this.run.upgrades.includes(id)) continue
      // 深化ずみ（PHASE2.md §2.8「2回ごと→毎回」）は間引きが無いので、進捗表示も 1/1 にする（1/2 のままだと嘘になる）
      this.run.progress[id] = this.run.deepened.includes(id) ? { cur: 1, max: 1 } : { cur, max: GEAR_TRIGGER_THRESHOLD }
    }
  }

  /**
   * 過回転（夜間監査[C]4）：盤上で最も遠いギア駒1個を消して起動する。距離はマンハッタン距離、
   * 同着はスキャン順（先着）で決める（決定的）。clearPieceAt経由なので通常のギア起動と同じ後処理
   * （gearTrigger発火・落下・補充）が自然に走る。ギアが盤上に無ければ何もしない。
   */
  private triggerFarthestGear(from: XY, ev: BoardEvent[]) {
    let best: XY | null = null
    let bestD = -1
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c?.piece?.kind === 'normal' && c.piece.color === 0) {
          const d = Math.abs(x - from.x) + Math.abs(y - from.y)
          if (d > bestD) {
            bestD = d
            best = { x, y }
          }
        }
      }
    if (best) this.clearPieceAt(best, ev, undefined, 'match')
  }

  /** 爆発鉱石・トークン等の爆発。中心含む十字1マス、または3x3（共振破砕）。destroy連鎖はclearPieceAt経由で自然に波及する */
  private explodeAt(at: XY, ev: BoardEvent[], opts?: { radius?: number; shape?: 'cross' | 'square' }) {
    if (!this.run) return
    const shape = opts?.shape ?? 'cross'
    const r = opts?.radius ?? 1
    const targets: XY[] =
      shape === 'cross'
        ? [
            { x: at.x, y: at.y },
            { x: at.x - 1, y: at.y },
            { x: at.x + 1, y: at.y },
            { x: at.x, y: at.y - 1 },
            { x: at.x, y: at.y + 1 },
          ]
        : (() => {
            const out: XY[] = []
            for (let y = at.y - r; y <= at.y + r; y++) for (let x = at.x - r; x <= at.x + r; x++) out.push({ x, y })
            return out
          })()
    const destroyed: XY[] = []
    for (const p of targets) {
      const c = this.at(p.x, p.y)
      if (!c) continue
      if (c.block) {
        this.damageBlock(p, ev, 3, true) // 爆発が敵の身体セルを直接巻き込むと3ダメージ＋heavy（ROGUE.md §5 / SPEC_OXYGEN §1.3）
        continue
      }
      if (!c.piece || c.piece.kind === 'spore') continue
      // 磁気採掘（夜間監査[C]2）：爆発に巻きこまれたギアは破壊せず「充填」状態にして盤面に残す。
      // destroyフックは駒が消えた後にしか発火しないため、ここ（爆発の破壊対象を決める場所）で
      // 破壊そのものをキャンセルする必要がある。次にこのギアが「マッチ」で消えるとき、
      // そのマッチのギア起動が2倍になる（resolveMatches側で消費）。
      if (this.run.upgrades.includes(MAGNETIC_MINING_ID) && c.piece.kind === 'normal' && c.piece.color === 0 && !c.piece.charged) {
        c.piece.charged = true
        ev.push({ t: 'gear-charged', at: p })
        ev.push({ t: 'upgrade-fire', id: MAGNETIC_MINING_ID, at: p })
        continue
      }
      if (c.piece.kind === 'normal' && !c.armored) this.progressGoal({ type: 'color', color: c.piece.color }, p, ev) // 甲殻付きは消えないので進めない
      this.clearPieceAt(p, ev, undefined, 'explode')
      destroyed.push(p)
    }
    if (destroyed.length) {
      ev.push({ t: 'explode', at, cells: destroyed })
      // 胞子弾(#18・第5波で再設計)：歯車爆弾(fireSpecial側)に加え、爆発鉱石の爆発でも発火させる（単体完結化）
      if (this.run.upgrades.includes(SPORE_BULLET_ID)) {
        this.spawnTokenAt(at, 'spore', ev)
        ev.push({ t: 'upgrade-fire', id: SPORE_BULLET_ID, at })
      }
      // 熾火の芯（工程3）：爆発が最寄りの原生種を焼く。destroyフックだと破壊駒1つごとに発火が数えられて
      // しまうため、胞子弾と同じくここで直接処理する。原生種が居ない層では発火アピールも出さない（嘘を作らない）
      if (this.run.upgrades.includes(EMBER_CORE_ID)) {
        const e = this.nearestEnemy(at)
        if (e) {
          ev.push({ t: 'upgrade-fire', id: EMBER_CORE_ID, at })
          this.dealEnemyDamage(e.id, 2, ev) // 較正（工程3）：3→2（遭難中央値を帯へ戻す）
          this.run.records.effectFires++
        }
      }
    }
  }

  /** 胞子トークンを設置（既存 spore 駒とは別物。隣接消滅で消費される） */
  private spawnTokenAt(at: XY, kind: 'spore', ev: BoardEvent[]) {
    const c = this.at(at.x, at.y)
    if (!c || c.block || c.sporeToken) return
    c.sporeToken = true
    ev.push({ t: 'token-spawn', at, kind })
  }

  /**
   * 破壊された駒の隣接4マスにある胞子トークンを「触れた」判定→消費し、基礎効果→sporeTouchフックの順で発火。
   * 基礎効果（第5波・コンサル[E]4）：胞子は強化が無くても「隣接する駒1つを植物へ変える」という土台の価値を持つ。
   * 毒胞子/根食い鉱などのsporeTouchフックはこれに追加で乗る（併存）。
   */
  private checkSporeTouch(at: XY, ev: BoardEvent[]) {
    if (!this.run) return
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const n = { x: at.x + dx, y: at.y + dy }
      const c = this.at(n.x, n.y)
      if (!c?.sporeToken) continue
      c.sporeToken = false
      ev.push({ t: 'token-consumed', at: n, kind: 'spore' })
      const beforeHook = ev.length
      this.fireSporeTouchHooks(n, at, ev)
      this.applySporeBaseEffect(n, ev, beforeHook)
    }
  }

  /**
   * 胞子の基礎効果本体：胞子の隣接4マス（固定順＝右→左→下→上）を走査し、そのフックが今回変換しなかった
   * 通常駒を1つだけ植物（葉=色1／キノコ=色4）に変える。フックが既に変換した駒（beforeHook以降に積まれた
   * special-bornの座標）は対象から外し、根食い鉱の鉱物化などフック本体の効果を上書きしないようにする。
   */
  private applySporeBaseEffect(spore: XY, ev: BoardEvent[], beforeHook: number) {
    const touchedByHook = new Set(
      ev
        .slice(beforeHook)
        .filter((e): e is Extract<BoardEvent, { t: 'special-born' }> => e.t === 'special-born')
        .map((e) => `${e.at.x},${e.at.y}`),
    )
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const p = { x: spore.x + dx, y: spore.y + dy }
      if (touchedByHook.has(`${p.x},${p.y}`)) continue
      const c = this.at(p.x, p.y)
      if (c?.piece?.kind === 'normal') {
        this.transformPieceAt(p, { kind: 'normal', color: this.rng() < 0.5 ? 1 : 4 }, ev)
        return
      }
    }
  }

  /** 既存駒を別の駒に置き換える（変換・生まれ変わり）。既存 special-born イベントを再利用（Ctx.transform/convertSpecial共通） */
  private transformPieceAt(at: XY, to: Piece, ev: BoardEvent[]) {
    const c = this.at(at.x, at.y)
    if (!c || c.block || !c.piece) return
    c.piece = to
    ev.push({ t: 'special-born', at, piece: to })
  }

  /** 空セルに駒を新規生成（既存 special-born イベントを再利用） */
  private spawnPieceAt(at: XY, color: Color, ev: BoardEvent[]) {
    const c = this.at(at.x, at.y)
    if (!c || c.block || c.piece) return
    const p: Piece = { kind: 'normal', color }
    c.piece = p
    ev.push({ t: 'special-born', at, piece: p })
  }

  /**
   * 生成位置探索（夜間監査[D]6・HookCtx.growthSpot実装）。seedCellsから近い順・決定的（同距離はy,x昇順）に
   * 空きセルを走査し、colorを置くと即座にマッチが成立する最初の1つを、GROWTH_MATCH_RADIUS以内に限って探す
   * （位置依存の原則：発生源から離れた場所のマッチ機会まで拾うと「どこで起きたか」が意味を失うため範囲を絞る。
   * 副次的に全強化が毎回確実にマッチを量産する過剰な雪だるまも防ぐ）。範囲内に無ければseedCells自身を除く
   * 最寄りの空きセルへ、それも無ければseedCells自身へ後退する（空きセルが盤上に皆無なら null）。
   */
  private findGrowthSpot(seedCells: XY[], color: Color): XY | null {
    const seedKeys = new Set(seedCells.map((p) => `${p.x},${p.y}`))
    const dist = (p: XY) => (seedCells.length ? Math.min(...seedCells.map((s) => Math.abs(s.x - p.x) + Math.abs(s.y - p.y))) : 0)
    const candidates: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c && !c.block && !c.piece) candidates.push({ x, y })
      }
    if (!candidates.length) return null
    candidates.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x)
    const nearby = candidates.filter((p) => dist(p) <= GROWTH_MATCH_RADIUS)
    for (const p of nearby) if (!seedKeys.has(`${p.x},${p.y}`) && this.wouldCreateMatchAt(p, color)) return p
    for (const p of nearby) if (this.wouldCreateMatchAt(p, color)) return p
    for (const p of candidates) if (!seedKeys.has(`${p.x},${p.y}`)) return p
    return candidates[0]
  }

  /**
   * 変換位置探索（夜間監査[D]6・HookCtx.transformSpot実装）。findGrowthSpotの「変換」版：既存の通常駒
   * （色がcolor以外）の中から、seedCellsに近い順・決定的にcolorへ変換すると即座にマッチが成立する最初の
   * 1つを、GROWTH_MATCH_RADIUS以内に限って探す（位置依存の原則・過剰な雪だるま防止はfindGrowthSpotと同じ理由）。
   * 範囲内に無ければ最寄りの通常駒（色違い）へ後退する（通常駒が盤上に皆無なら null）。
   */
  private findTransformSpot(seedCells: XY[], color: Color): XY | null {
    const dist = (p: XY) => (seedCells.length ? Math.min(...seedCells.map((s) => Math.abs(s.x - p.x) + Math.abs(s.y - p.y))) : 0)
    const candidates: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = this.at(x, y)?.piece
        if (p?.kind === 'normal' && p.color !== color) candidates.push({ x, y })
      }
    if (!candidates.length) return null
    candidates.sort((a, b) => dist(a) - dist(b) || a.y - b.y || a.x - b.x)
    for (const p of candidates) if (dist(p) <= GROWTH_MATCH_RADIUS && this.wouldCreateMatchAt(p, color)) return p
    return candidates[0]
  }

  /** (x,y)にcolorの通常駒を置いたと仮定して、3連（縦横）または2×2正方形が即成立するか */
  private wouldCreateMatchAt(at: XY, color: Color): boolean {
    const colAt = (x: number, y: number): Color | null => {
      const p = this.at(x, y)?.piece
      return p?.kind === 'normal' ? p.color : null
    }
    let left = 0
    while (colAt(at.x - 1 - left, at.y) === color) left++
    let right = 0
    while (colAt(at.x + 1 + right, at.y) === color) right++
    if (left + right + 1 >= 3) return true
    let up = 0
    while (colAt(at.x, at.y - 1 - up) === color) up++
    let down = 0
    while (colAt(at.x, at.y + 1 + down) === color) down++
    if (up + down + 1 >= 3) return true
    for (const [ox, oy] of [
      [at.x - 1, at.y - 1],
      [at.x, at.y - 1],
      [at.x - 1, at.y],
      [at.x, at.y],
    ]) {
      const cells: XY[] = [
        { x: ox, y: oy },
        { x: ox + 1, y: oy },
        { x: ox, y: oy + 1 },
        { x: ox + 1, y: oy + 1 },
      ]
      if (cells.every((c) => (c.x === at.x && c.y === at.y) || colAt(c.x, c.y) === color)) return true
    }
    return false
  }

  /** 邪魔ピース（苔石1層）を生成（賭博師の壺のハズレ枠） */
  private addObstacleAt(at: XY, ev: BoardEvent[]) {
    const c = this.at(at.x, at.y)
    if (!c || c.block) return
    c.piece = null
    c.block = { type: 'kokeishi', hp: 1 }
    ev.push({ t: 'obstacle-spawn', at, blockType: 'kokeishi' })
  }

  /**
   * フックへ渡す決定的アクション一式を組み立てる。ev（現在解決中のイベント列）にクロージャで束縛する。
   * origin：damageEnemy('nearest', n) の基準点（各fire*Hooksが「何が起きた場所か」を渡す）
   */
  private makeCtx(ev: BoardEvent[], origin?: XY): HookCtx {
    const self = this
    return {
      rng: () => self.rng(),
      at: (x, y) => self.at(x, y),
      neighborsOf: (p) =>
        (
          [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const
        )
          .map(([dx, dy]) => ({ x: p.x + dx, y: p.y + dy }))
          .filter((q) => !!self.at(q.x, q.y)),
      randomCell: (pred) => {
        const cands: XY[] = []
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const c = self.at(x, y)
            if (c && pred(c, { x, y })) cands.push({ x, y })
          }
        return cands.length ? cands[randInt(self.rng, cands.length)] : null
      },
      mostCommonColor: () => {
        const count = new Map<Color, number>()
        for (let y = 0; y < H; y++)
          for (let x = 0; x < W; x++) {
            const p = self.at(x, y)?.piece
            if (p?.kind === 'normal') count.set(p.color, (count.get(p.color) ?? 0) + 1)
          }
        let best: Color | null = null
        let bestN = 0
        for (const [c, n] of count)
          if (n > bestN) {
            best = c
            bestN = n
          }
        return best
      },
      records: self.run!.records,
      spawnToken: (at, kind) => self.spawnTokenAt(at, kind, ev),
      transform: (at, to) => self.transformPieceAt(at, to, ev),
      convertSpecial: (at, to) => self.transformPieceAt(at, to, ev),
      explode: (at, opts) => self.explodeAt(at, ev, opts),
      // 磁気採掘：指定セルのギア駒を「充填済み」にする（夜間監査[C]2）。爆発介入はexplodeAt側で直接行うため、
      // ここは主にスターター（新しく生やしたギアをその場で充填状態にする）から使う。
      chargeGear: (at) => {
        const c = self.at(at.x, at.y)
        if (c?.piece?.kind === 'normal' && c.piece.color === 0 && !c.piece.charged) {
          c.piece.charged = true
          ev.push({ t: 'gear-charged', at })
        }
      },
      damageEnemy: (target, n) => {
        const enemy = target === 'nearest' ? self.nearestEnemy(origin) : self.enemyNear(target)
        if (enemy) self.dealEnemyDamage(enemy.id, n, ev)
      },
      spawnPiece: (at, color) => self.spawnPieceAt(at, color, ev),
      addObstacle: (at) => self.addObstacleAt(at, ev),
      // 過回転（夜間監査[C]4）：盤上で最も遠いギア駒1個を実際に消して起動する（数値だけの連鎖延長をやめた置換）
      triggerFarGear: (from) => self.triggerFarthestGear(from, ev),
      boostNextRelic: () => {
        if (!self.run) return
        self.run.relicBoostNext = true
        if (self.run.upgrades.includes(RELIC_RESONANCE_ID)) self.run.progress[RELIC_RESONANCE_ID] = { cur: 1, max: 1 } // 可視化契約：ブースト待機中
      },
      growthSpot: (seedCells, color) => self.findGrowthSpot(seedCells, color),
      transformSpot: (seedCells, color) => self.findTransformSpot(seedCells, color),
      // 模倣の粘菌(#14)：直前に発動した（自分以外の）フック効果があればそれを、無ければ直前に発動した
      // 特殊駒効果を代わりに再現する（第5波：強化ゼロでも空振りしないためのフォールバック）。
      // 夜間監査[C]1：保存してあるのは入力データのみ。ここ（現在解決中のevを束縛したmakeCtx呼び出し内）で
      // 新しいctxを作って act を呼び直すため、常に「今」のイベント列・盤面に対して再実行される。
      replayLast: () => {
        const snap = self.lastHookReplay
        if (snap) {
          switch (snap.on) {
            case 'match': {
              const replayCtx = self.makeCtx(ev, snap.origin)
              ev.push({ t: 'upgrade-fire', id: snap.upgradeId, at: snap.origin })
              snap.hook.act(snap.g, replayCtx)
              break
            }
            case 'destroy': {
              const replayCtx = self.makeCtx(ev, snap.at)
              ev.push({ t: 'upgrade-fire', id: snap.upgradeId, at: snap.at })
              snap.hook.act(snap.at, snap.cause, snap.piece, replayCtx)
              break
            }
            case 'sporeTouch': {
              const replayCtx = self.makeCtx(ev, snap.neighbor)
              ev.push({ t: 'upgrade-fire', id: snap.upgradeId, at: snap.neighbor })
              snap.hook.act(snap.spore, snap.neighbor, replayCtx)
              break
            }
            case 'gearTrigger': {
              const replayCtx = self.makeCtx(ev, snap.at)
              ev.push({ t: 'upgrade-fire', id: snap.upgradeId, at: snap.at })
              snap.hook.act(snap.at, snap.count, replayCtx)
              break
            }
            case 'enemyHit': {
              const replayCtx = self.makeCtx(ev, snap.cells[0])
              ev.push({ t: 'upgrade-fire', id: snap.upgradeId, at: snap.cells[0] })
              snap.hook.act(snap.cells, snap.amount, replayCtx)
              break
            }
          }
          self.run!.records.effectFires++
          return
        }
        if (self.lastSpecialReplay) {
          const { at, piece, combo } = self.lastSpecialReplay
          self.fireSpecial(at, piece, ev, combo)
        }
      },
    }
  }

  private fireMatchHooks(g: MatchGroup, ev: BoardEvent[]) {
    if (!this.run || this.hooksSuspended) return
    const origin = g.cells[Math.floor(g.cells.length / 2)]
    const ctx = this.makeCtx(ev, origin)
    // 遺物共鳴（夜間監査[C]3）：遺物マッチの入口で倍率を一度だけ決め、このマッチに属する全ての遺物フックへ
    // 共通に適用する。以前は各強化が個別に takeRelicBoost() を読む設計で、読み忘れた強化（賭博師の壺・
    // 模倣の粘菌・遺物の根）には2倍が効かなかった（変換炉だけ効いていた）。消費もここで一元化する。
    let repeat = 1
    if (g.system === 'relic' && this.run.relicBoostNext) {
      repeat = 2
      this.run.relicBoostNext = false
      if (this.run.upgrades.includes(RELIC_RESONANCE_ID)) this.run.progress[RELIC_RESONANCE_ID] = { cur: 0, max: 1 }
    }
    for (const { upgradeId, hook: h } of this.hooks) {
      if (h.on !== 'match') continue
      if (h.system && h.system !== g.system) continue
      if (h.color !== undefined && h.color !== g.color) continue
      if (h.minSize && g.cells.length < h.minSize) continue
      for (let i = 0; i < repeat; i++) {
        if (!this.consumeHookBudget()) return
        // 可視化第一波：フック act を呼ぶ直前に発動アピール用イベントを積む（ROGUE.md 可視化第一波②）
        ev.push({ t: 'upgrade-fire', id: upgradeId, at: origin })
        h.act(g, ctx)
        this.run.records.effectFires++
        if (upgradeId !== MIMIC_SLIME_ID) this.lastHookReplay = { on: 'match', upgradeId, hook: h, g, origin }
      }
    }
  }

  private fireDestroyHooks(at: XY, cause: DestroyCause, piece: Piece, ev: BoardEvent[]) {
    if (!this.run || this.hooksSuspended) return
    const ctx = this.makeCtx(ev, at)
    for (const { upgradeId, hook: h } of this.hooks) {
      if (h.on !== 'destroy') continue
      if (!this.consumeHookBudget()) return
      ev.push({ t: 'upgrade-fire', id: upgradeId, at })
      h.act(at, cause, piece, ctx)
      this.run.records.effectFires++
      this.lastHookReplay = { on: 'destroy', upgradeId, hook: h, at, cause, piece }
    }
  }

  private fireSporeTouchHooks(spore: XY, neighbor: XY, ev: BoardEvent[]) {
    if (!this.run || this.hooksSuspended) return
    const ctx = this.makeCtx(ev, neighbor)
    for (const { upgradeId, hook: h } of this.hooks) {
      if (h.on !== 'sporeTouch') continue
      if (!this.consumeHookBudget()) return
      ev.push({ t: 'upgrade-fire', id: upgradeId, at: neighbor })
      h.act(spore, neighbor, ctx)
      this.run.records.effectFires++
      this.lastHookReplay = { on: 'sporeTouch', upgradeId, hook: h, spore, neighbor }
    }
  }

  private fireGearTriggerHooks(at: XY, count: number, ev: BoardEvent[]) {
    if (!this.run || this.hooksSuspended) return
    const ctx = this.makeCtx(ev, at)
    for (const { upgradeId, hook: h } of this.hooks) {
      if (h.on !== 'gearTrigger') continue
      if (!this.consumeHookBudget()) return
      ev.push({ t: 'upgrade-fire', id: upgradeId, at })
      h.act(at, count, ctx)
      this.run.records.effectFires++
      this.lastHookReplay = { on: 'gearTrigger', upgradeId, hook: h, at, count }
    }
  }

  /** 原生種のHPが実際に削れた直後（工程3・hooks.ts の enemyHit）。cells＝撃破で開放される前の身体セル */
  private fireEnemyHitHooks(cells: XY[], amount: number, ev: BoardEvent[]) {
    if (!this.run || this.hooksSuspended) return
    const ctx = this.makeCtx(ev, cells[0])
    for (const { upgradeId, hook: h } of this.hooks) {
      if (h.on !== 'enemyHit') continue
      if (!this.consumeHookBudget()) return
      ev.push({ t: 'upgrade-fire', id: upgradeId, at: cells[0] })
      h.act(cells, amount, ctx)
      this.run.records.effectFires++
      this.lastHookReplay = { on: 'enemyHit', upgradeId, hook: h, cells, amount }
    }
  }

  // ==== ローグライク拡張：敵・ターン制・環境（ROGUE.md §5/§6） ====
  // run が無いBoard（旧30レベル制）では floor 未指定＝enemies は常に空のまま、以下は一切呼ばれない。

  /** 層の敵編成・環境フラグを盤面に適用する（Board構築時に一度だけ） */
  private spawnFloor(floor: FloorDef) {
    for (const spec of floor.enemies) {
      if (spec.kind === 'boss') this.spawnEnemy('boss', bossBodyCells(H - 1, H - 1, W)) // 身体は最下行の8セルだけ（第2段階で2セルへ縮む）
      // 奈落の喉は最下行の中央2セルに口を開ける（ボス第2段階と同じ形。左右と上から必ず届く）
      else if (spec.kind === 'maw') this.spawnEnemy('maw', [{ x: 3, y: H - 1 }, { x: 4, y: H - 1 }])
      else this.spawnEnemy(spec.kind, [spec.at])
    }
  }

  /** 敵を盤面に配置する（テスト・spawnFloor共用）。占有セルは駒が入らない block:'enemy' になる */
  spawnEnemy(kind: EnemyKind, cells: XY[]): EnemyInstance {
    const e = createEnemy(kind, cells)
    this.enemies.push(e)
    for (const p of cells) {
      const c = this.at(p.x, p.y)
      if (c) {
        c.piece = null
        c.block = { type: 'enemy', enemyId: e.id }
      }
    }
    return e
  }

  /** 指定セルにいる敵を返す（damageEnemy(XY,...)用の厳密一致） */
  private enemyAt(p: XY): EnemyInstance | null {
    const b = this.at(p.x, p.y)?.block
    return b?.type === 'enemy' ? (this.enemies.find((e) => e.id === b.enemyId) ?? null) : null
  }

  /**
   * damageEnemy(XY, n) が探す敵：指定セル自身、無ければ隣接4マス。
   * 毒胞子(#3)が渡す座標は「トークンに隣接して消えた駒」の位置であり、敵の身体セルそのものとは
   * 一致し得ない（駒セルと敵セルは同一マスを共有しない）ため、隣接まで探索範囲を広げて接続する
   * （逸脱・理由は最終報告）。
   */
  private enemyNear(p: XY): EnemyInstance | null {
    const here = this.enemyAt(p)
    if (here) return here
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const found = this.enemyAt({ x: p.x + dx, y: p.y + dy })
      if (found) return found
    }
    return null
  }

  /** damageEnemy('nearest', n) が探す敵：originからのマンハッタン距離が最も近い1体 */
  private nearestEnemy(origin?: XY): EnemyInstance | null {
    if (this.enemies.length === 0) return null
    if (!origin) return this.enemies[0]
    let best: EnemyInstance | null = null
    let bestD = Infinity
    for (const e of this.enemies)
      for (const p of e.cells) {
        const d = Math.abs(p.x - origin.x) + Math.abs(p.y - origin.y)
        if (d < bestD) {
          bestD = d
          best = e
        }
      }
    return best
  }

  /** 敵1体にダメージ。ボス第1段階は匣を1枚剥がすだけ（量は無関係）。hp<=0 で撃破処理へ */
  private dealEnemyDamage(id: number, amount: number, ev: BoardEvent[], heavy = false) {
    const e = this.enemies.find((x) => x.id === id)
    if (!e || e.hp <= 0) return
    if (e.kind === 'boss' && e.bossPhase === 1) {
      // 1手（1解決）につき匣は1枚まで。壺の面爆発や横向きの銛は最下行のボス身体を複数セル同時に踏み、
      // damageBlock 経路には damageAround のような同一敵の重複排除が無いため、ここで抑えないと
      // 特殊駒1発で第1段階（4枚）が丸ごと消える（SPEC_OXYGEN §1.4 / §0.2 #9）。
      if (this.bossShellHitAtSeq === this.resolveSeq) return
      this.bossShellHitAtSeq = this.resolveSeq
      e.bossShellLeft--
      ev.push({ t: 'boss-shell-broken', id, left: Math.max(0, e.bossShellLeft) })
      if (e.bossShellLeft <= 0) this.bossEnterPhase2(e, ev)
      return // 第1段階では hp を削らない
    }
    if (e.kind === 'bellfoot' && e.shell > 0) {
      // 鐘脚：殻がある間は本体に一切通らず、量に関係なく1解決で1枚だけ剥がれる（ボスの匣と同じ規則）。
      // 3手ごとに1枚張り直すので、小突き続けると永久に剥がせない＝一手へまとめることを要求する
      if (e.shellSeq === this.resolveSeq) return
      e.shellSeq = this.resolveSeq
      e.shell--
      ev.push({ t: 'shell-peeled', id, left: e.shell })
      return
    }
    e.hp = Math.max(0, e.hp - amount)
    ev.push({ t: 'enemy-damage', id, amount, hpLeft: e.hp })
    const bodyCells = [...e.cells] // 撃破で身体セルが開放される前に控える（enemyHitフックの生成位置の種）
    if (e.hp <= 0) this.defeatEnemy(e, ev, heavy)
    // enemyHit（工程3）：殻・匣で止まった分は上でreturn済み＝ここに来るのは本当にHPが削れたときだけ。
    // 撃破処理の後に発火する＝開放されたセルも生成先に使える（swarm伝播の再帰内でもそれぞれ発火する）
    this.fireEnemyHitHooks(bodyCells, amount, ev)
  }

  /** 第2段階へ：中央2セルだけ残して身体を縮める（盤面が広がるご褒美） */
  private bossEnterPhase2(e: EnemyInstance, ev: BoardEvent[]) {
    const keep = [{ x: 3, y: H - 1 }, { x: 4, y: H - 1 }]
    const freed = e.cells.filter((p) => !keep.some((k) => k.x === p.x && k.y === p.y))
    for (const p of freed) {
      const c = this.at(p.x, p.y)
      if (c?.block?.type === 'enemy' && c.block.enemyId === e.id) c.block = null
    }
    e.cells = keep
    e.bossPhase = 2
    ev.push({ t: 'boss-phase', id: e.id, phase: 2, freed })
  }

  /** 敵を撃破：身体セルを開放し、enemy-kill 目標を1つ進める。heavy な一撃で倒した swarm だけが伝播する */
  private defeatEnemy(e: EnemyInstance, ev: BoardEvent[], heavy = false) {
    for (const p of e.cells) {
      const c = this.at(p.x, p.y)
      if (c?.block?.type === 'enemy' && c.block.enemyId === e.id) c.block = null
    }
    this.enemies = this.enemies.filter((x) => x.id !== e.id)
    ev.push({ t: 'enemy-defeated', id: e.id, cells: e.cells })
    this.progressGoal({ type: 'enemy-kill' }, e.cells[0] ?? { x: 0, y: 0 }, ev)
    if (e.kind === 'swarm' && heavy) this.propagateSwarmDefeat(e, ev)
  }

  /**
   * サンドバッグ（swarm）撃破時、隣接する同種へ SWARM_PROPAGATE_DAMAGE を伝播する（ROGUE2.md §3・第3波：連鎖の爽快感の核）。
   * swarmはHP2で伝播も2ダメージなので命中すれば必ず撃破→再度この関数を呼ぶ形で自然に連鎖する。
   * 呼ばれるのは heavy な一撃で倒したときだけ（SPEC_OXYGEN §1.3：3個マッチでの各個撃破は派手にしない）。
   * 撃破済みの身体セルは直前にblockを外しているため、同じ敵への二重伝播は起きない。
   */
  private propagateSwarmDefeat(e: EnemyInstance, ev: BoardEvent[]) {
    const seen = new Set<number>()
    for (const p of e.cells)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const n = this.enemyAt({ x: p.x + dx, y: p.y + dy })
        if (n && n.kind === 'swarm' && n.hp > 0 && !seen.has(n.id)) {
          seen.add(n.id)
          this.dealEnemyDamage(n.id, SWARM_PROPAGATE_DAMAGE, ev, true)
          // 計測用（夜間監査[B][D]）：swarmはHP2固定なので2ダメージ=必ず撃破。ビルド由来の撃破と分離集計するため加算する
          if (this.run) this.run.records.swarmPropagationKills++
        }
      }
  }

  /** ターン終了処理：封鎖期限→各敵の定期行動→再安定化→層クリア/遭難判定（テストが直接呼ぶ互換drain。本体からは enemyTurnSegments を使う） */
  protected resolveEnemyTurn(ev: BoardEvent[]) {
    for (const _ of this.enemyTurnSegments(ev)) {
      /* drain */
    }
  }

  private *enemyTurnSegments(ev: BoardEvent[]): Generator<ResolutionStepKind> {
    if (!this.run) return
    this.tickSeals(ev)
    yield 'enemy' // 封鎖の期限切れを区切る
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue
      const period = ENEMY_PERIOD[e.kind]
      if (period <= 0) continue // swarm は定期行動を持たない
      e.actionTimer++
      // 眠りの帳（祝福）はカウンタを負から始める。0以下＝まだ眠っている（通常のランでは常に1以上なので素通り）
      if (e.actionTimer <= 0 || e.actionTimer % period !== 0) continue
      switch (e.kind) {
        case 'rockshell': this.rockshellAction(e, ev); break
        case 'sporeling': this.harvesterAction(e, ev); break
        case 'burrower': this.diggerAction(e, ev); break
        case 'binder': this.binderAction(e, ev); break
        case 'bellfoot': this.bellfootAction(e, ev); break
        case 'maw': this.mawAction(e, ev); break
        case 'breathstealer':
        case 'boss': this.drainOxygen(e, ev); break
      }
      yield 'enemy' // 敵1体の行動ごとの境界
    }
    // 敵の行動で空いた/塞がったセルを重力・補充で安定させる
    yield* this.cascadeSegments(ev)
    yield 'gravity' // 再安定化の末尾（充填・reroll）を区切る
    // 敵ターン中の偶発マッチで目標が埋まることがあるので、ここでもクリアを見る（クリア優先）
    this.checkFloorClear(ev)
    if (this.floorCleared) {
      yield 'finish'
      return
    }
    if (this.run.oxygen <= 0 && !this.runOverFired) {
      if (this.tryLastLight(ev)) {
        yield 'finish' // last-light の確定
        return
      }
      this.runOverFired = true
      ev.push({ t: 'run-over' })
    }
    yield 'finish'
  }

  /** 忘れ形見（祝福）：灯が尽きた瞬間に灯を戻す。ランに一度だけで、使い切ったら次は普通に遭難する */
  private tryLastLight(ev: BoardEvent[]): boolean {
    if (!this.run || this.run.lastLightUsed) return false
    const amount = blessingLastLight(this.run.blessings)
    if (amount <= 0) return false
    this.run.lastLightUsed = true
    this.run.oxygen = Math.min(amount, this.run.lampMax) // 尽きた地点（0以下）からの復帰なので、加算ではなくこの値に戻す（器は超えない）
    ev.push({ t: 'last-light', amount, left: this.run.oxygen })
    return true
  }

  /** 息喰み／深匣主：酸素を直接奪う（PLAN_LOOP.md §1.4 の唯一の直接ダメージ） */
  private drainOxygen(e: EnemyInstance, ev: BoardEvent[]) {
    if (!this.run) return
    // 息を殺す（祝福）を持っていれば一撃が軽くなる（0にはならない）
    const amount = blessingDrain(this.run.blessings, OXYGEN_DRAIN[e.kind as 'breathstealer' | 'boss'])
    this.run.oxygen -= amount
    ev.push({ t: 'oxygen-drained', id: e.id, amount, left: this.run.oxygen })
  }

  /** 岩殻獣：鉱物1つに甲殻を付与する（ROGUE.md §5） */
  private rockshellAction(e: EnemyInstance, ev: BoardEvent[]) {
    const cands: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c?.piece?.kind === 'normal' && c.piece.color === 2 && !c.armored) cands.push({ x, y })
      }
    if (!cands.length) return
    const p = cands[randInt(this.rng, cands.length)]
    this.at(p.x, p.y)!.armored = true
    ev.push({ t: 'armor-applied', at: p, id: e.id })
  }

  /** 喰み蟲：印が無ければ資源1つに捕食印、あれば食べてHP+2。印は敵から離れた場所に付くので「敵の隣以外」を触らせる */
  private harvesterAction(e: EnemyInstance, ev: BoardEvent[]) {
    if (e.markAt) {
      const c = this.at(e.markAt.x, e.markAt.y)
      if (c?.preyMark) {
        c.preyMark = false
        c.piece = null // 食べられた駒は消える（落下で盤面が動く＝軽い妨害）
        e.hp = Math.min(e.maxHp, e.hp + 2)
        ev.push({ t: 'prey-devoured', at: e.markAt, id: e.id, hpLeft: e.hp })
      }
      e.markAt = null
      return
    }
    const prefer: XY[] = []
    const fallback: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        const p = c?.piece
        if (!c || !p || c.preyMark) continue
        if (p.kind === 'spore' || (p.kind === 'normal' && (p.volatile || p.charged))) prefer.push({ x, y })
        else if (p.kind === 'normal') fallback.push({ x, y })
      }
    const cands = prefer.length ? prefer : fallback
    if (!cands.length) return
    const at = cands[randInt(this.rng, cands.length)]
    this.at(at.x, at.y)!.preyMark = true
    e.markAt = at
    ev.push({ t: 'prey-marked', at, id: e.id })
  }

  /** 印の駒そのものが消えたときの追い払い（隣は不可＝「その1マスを狙う」を要求する） */
  private releasePreyMark(p: XY, ev: BoardEvent[]) {
    const c = this.at(p.x, p.y)
    if (!c?.preyMark) return
    c.preyMark = false
    const e = this.enemies.find((x) => x.markAt && x.markAt.x === p.x && x.markAt.y === p.y)
    if (!e) return
    e.markAt = null
    e.actionTimer = 0
    ev.push({ t: 'prey-escaped', at: p, id: e.id })
    this.dealEnemyDamage(e.id, 1, ev) // 追い払いの報酬（heavy ではない）
  }

  /** 裂坑掘り：2手ごとに「遠い2x2の予告」と「崩落＋移動」を交互に行う（読めない封鎖の置換） */
  private diggerAction(e: EnemyInstance, ev: BoardEvent[]) {
    if (e.telegraph) {
      const sealed: XY[] = []
      for (const p of e.telegraph) {
        const c = this.at(p.x, p.y)
        if (!c || c.block || !c.piece) continue
        c.piece = null
        c.block = { type: 'seal', turnsLeft: 3 }
        sealed.push(p)
        ev.push({ t: 'cell-sealed', at: p, turns: 3, id: e.id })
      }
      if (!sealed.length) ev.push({ t: 'fissure-averted', id: e.id })
      e.telegraph = null
      this.relocateDigger(e)
      return
    }
    const src = e.cells[0]
    const cands: { p: XY; d: number }[] = []
    let bestD = -1
    for (let y = 0; y + 1 < H; y++)
      for (let x = 0; x + 1 < W; x++) {
        const quad = [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]
        if (quad.some((q) => !this.at(q.x, q.y) || this.at(q.x, q.y)!.block)) continue
        const d = Math.abs(x - src.x) + Math.abs(y - src.y)
        cands.push({ p: { x, y }, d })
        if (d > bestD) bestD = d
      }
    // 「最遠を1つ厳密選択」だと、安定盤面では relocateDigger が動けず src が固定されるため予告が同じ角に張り付く。
    // 最遠付近（-2まで）から毎回抽選して、予告位置が変わる＝盤面全域を見る学習（§4.11）を成立させる。
    const far = cands.filter((c) => c.d >= bestD - 2)
    const best = far.length ? far[randInt(this.rng, far.length)].p : null
    if (!best) return
    e.telegraph = [best, { x: best.x + 1, y: best.y }, { x: best.x, y: best.y + 1 }, { x: best.x + 1, y: best.y + 1 }]
    ev.push({ t: 'fissure-telegraph', cells: e.telegraph, id: e.id })
  }

  /** 崩落のあと空きセルへ移る（予告位置が毎回変わる＝学習済みの角に固定されない） */
  private relocateDigger(e: EnemyInstance) {
    const empties: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c && !c.block && !c.piece) empties.push({ x, y })
      }
    if (!empties.length) return
    const to = empties[randInt(this.rng, empties.length)]
    for (const p of e.cells) {
      const c = this.at(p.x, p.y)
      if (c?.block?.type === 'enemy' && c.block.enemyId === e.id) c.block = null
    }
    this.at(to.x, to.y)!.block = { type: 'enemy', enemyId: e.id }
    e.cells = [to]
  }

  /**
   * 綴じ蟲（第二幕）：3手ごとに「1列の予告」と「その列の封鎖」を交互に行う。
   * 裂坑掘りが2x2を塞ぐのに対しこちらは列を丸ごと落とすので、盤が縦に分断され「落ちてくる列」が読めなくなる。
   * 予告と解除の作法（予告内で駒を1つ消せば中断）は裂坑掘りと共通にして、覚え直しをさせない。
   */
  private binderAction(e: EnemyInstance, ev: BoardEvent[]) {
    if (e.telegraph) {
      const sealed: XY[] = []
      for (const p of e.telegraph) {
        const c = this.at(p.x, p.y)
        if (!c || c.block || !c.piece) continue
        c.piece = null
        c.block = { type: 'seal', turnsLeft: 3 }
        sealed.push(p)
        ev.push({ t: 'cell-sealed', at: p, turns: 3, id: e.id })
      }
      if (!sealed.length) ev.push({ t: 'fissure-averted', id: e.id })
      e.telegraph = null
      return
    }
    // 自分の列は選ばない（本体が身体セルで塞いでいる列を封鎖しても盤面が変わらない）
    const cols: number[] = []
    for (let x = 0; x < W; x++) {
      if (e.cells.some((p) => p.x === x)) continue
      let free = 0
      for (let y = 0; y < H; y++) if (this.at(x, y)?.piece) free++
      if (free >= 4) cols.push(x) // 駒が半分も無い列は塞いでも効かないので候補にしない
    }
    if (!cols.length) return
    const col = cols[randInt(this.rng, cols.length)]
    const cells: XY[] = []
    for (let y = 0; y < H; y++) if (this.at(col, y)?.piece) cells.push({ x: col, y })
    e.telegraph = cells
    ev.push({ t: 'fissure-telegraph', cells, id: e.id })
  }

  /** 鐘脚（第三幕）：3手ごとに殻を1枚張り直す。剥がすより速く張られるので、まとめて剥がしきる手が要る */
  private bellfootAction(e: EnemyInstance, ev: BoardEvent[]) {
    if (e.shell >= BELLFOOT_SHELL_MAX) return
    e.shell++
    ev.push({ t: 'shell-raised', id: e.id, left: e.shell })
  }

  /**
   * 奈落の喉（終幕の特殊ラスボス）：3手ごとに盤面の使用可能域そのものを切り替える。
   * 封鎖の期限（3手）と周期（3手）が一致しているので、次の相が来る手にちょうど前の相が解ける
   * ＝新しい状態を1つも持たずに「割れる→狭まる→開く」が回る（既存の seal/tickSeals の再利用）。
   */
  private mawAction(e: EnemyInstance, ev: BoardEvent[]) {
    // actionTimer はこの手ぶんが既に加算済みなので、いま入る相は「1つ前」の値で決まる
    const phase = (mawNextPhase(e) + MAW_PHASES - 1) % MAW_PHASES
    for (const p of mawPhaseCells(phase, W, H)) {
      const c = this.at(p.x, p.y)
      if (!c || c.block || !c.piece) continue
      c.piece = null
      c.block = { type: 'seal', turnsLeft: 3 }
      ev.push({ t: 'cell-sealed', at: p, turns: 3, id: e.id })
    }
  }

  /** 予告2x2の内側で駒が消えたら崩落を中断する（綴じ蟲の列予告も同じ作法で中断する） */
  private checkFissureAverted(p: XY, ev: BoardEvent[]) {
    for (const e of this.enemies) {
      if ((e.kind !== 'burrower' && e.kind !== 'binder') || !e.telegraph) continue
      if (!e.telegraph.some((q) => q.x === p.x && q.y === p.y)) continue
      e.telegraph = null
      ev.push({ t: 'fissure-averted', id: e.id })
    }
  }

  /** 封鎖セルの期限を1つ消費し、0になったら解除する */
  private tickSeals(ev: BoardEvent[]) {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        const b = c?.block
        if (!b || b.type !== 'seal') continue
        b.turnsLeft--
        if (b.turnsLeft <= 0) {
          c!.block = null
          ev.push({ t: 'cell-unsealed', at: { x, y } })
        }
      }
  }
}
