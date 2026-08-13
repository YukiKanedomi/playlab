// フックシステムの型定義（ROGUE.md §3）。強化＝盤面の因果に介入するイベントフックの束。
import type { Cell, Color, Piece, XY } from './types'
import type { RunRecords } from './run'

/** 駒の色→系統マッピング（ROGUE.md §2）。0=ギア 1/4=植物 2=鉱物 3=遺物 */
export type System = 'plant' | 'mineral' | 'gear' | 'relic'

export function systemOf(color: Color): System {
  if (color === 0) return 'gear'
  if (color === 2) return 'mineral'
  if (color === 3) return 'relic'
  return 'plant' // 1(葉)・4(キノコ)
}

export type DestroyCause = 'match' | 'explode' | 'special'

export interface MatchGroup {
  cells: XY[]
  color: Color
  chain: number
  system: System
}

/**
 * フックが盤面に対して行える決定的アクション一式（ROGUE.md §3 の翻訳）。
 * at/neighborsOf/randomCell/mostCommonColor は正典の一覧に無い読み取り系だが、
 * 「隣接する駒」「最多色」等の判定に強化の実装上どうしても必要なため最小限で追加した
 * （board.ts 実装時の逸脱・最終報告の対象）。
 */
export interface HookCtx {
  rng(): number
  at(x: number, y: number): Cell | null
  neighborsOf(p: XY): XY[]
  randomCell(pred: (c: Cell, p: XY) => boolean): XY | null
  mostCommonColor(): Color | null
  records: RunRecords
  spawnToken(at: XY, kind: 'spore'): void
  transform(at: XY, to: Piece): void
  convertSpecial(at: XY, to: Piece): void
  explode(at: XY, opts?: { radius?: number; shape?: 'cross' | 'square' }): void
  /** 磁気採掘：指定セルのギア駒を「充填済み」にする（次のギアマッチで消費され、そのマッチのギア起動が2倍になる。夜間監査[C]2） */
  chargeGear(at: XY): void
  damageEnemy(target: 'nearest' | XY, n: number): void
  spawnPiece(at: XY, color: Color): void
  addObstacle(at: XY): void
  /** 過回転：盤上で最も遠いギア駒1個を消して起動する＝実際にgearTriggerを発火させる（夜間監査[C]4：数値でなく盤面の因果） */
  triggerFarGear(from: XY): void
  /** 遺物共鳴(#13)：次に発動する遺物マッチ効果を2倍にする予約 */
  boostNextRelic(): void
  /** 模倣の粘菌(#14)：直前に発動した（自分以外の）フック効果、無ければ直前に発動した特殊駒効果をもう一度実行する（第5波・夜間監査[C]1で再実装） */
  replayLast(): void
  /**
   * 生成位置探索（夜間監査[D]6）：colorの駒を置くと即座にマッチが成立する空きセルを、seedCells（多くは
   * 発生源のマッチ跡地やギア起動地点）から近い順・決定的に探して返す。マッチが成立する空きセルが無ければ、
   * seedCells自身を除く最寄りの空きセルへ後退し、それも無ければ最後の手段としてseedCells自身へ後退する
   * （空きセルが盤上に皆無の場合のみ null）。
   * 従来は「マッチ跡地の隣接1マス」または完全ランダムな空きマスへ生成しており、跡地自身（＝直後に自然充填で
   * 上書きされる無駄なマス）を選びがちで、新しいマッチにほぼ繋がらなかった（監査[B]「発火が連鎖を生まない」）。
   */
  growthSpot(seedCells: XY[], color: Color): XY | null
  /** growthSpotの「変換」版（夜間監査[D]6）：既存の通常駒（色違い）の中から、colorへ変換すると即座に
   *  マッチが成立するものをseedCellsに近い順・決定的に探す（deep-breath/変換炉が使う）。 */
  transformSpot(seedCells: XY[], color: Color): XY | null
}

export type Hook =
  | { on: 'match'; system?: System; color?: Color; minSize?: number; act: (g: MatchGroup, ctx: HookCtx) => void }
  | { on: 'destroy'; act: (at: XY, cause: DestroyCause, piece: Piece, ctx: HookCtx) => void }
  | { on: 'sporeTouch'; act: (spore: XY, neighbor: XY, ctx: HookCtx) => void }
  | { on: 'gearTrigger'; act: (at: XY, count: number, ctx: HookCtx) => void }
  | { on: 'turnEnd'; act: (ctx: HookCtx) => void } // MVP①では未発火（敵/ターン制は範囲外。型のみ用意）
