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
  chargeGear(at: XY): void
  damageEnemy(target: 'nearest' | XY, n: number): void
  spawnPiece(at: XY, color: Color): void
  addObstacle(at: XY): void
  bumpChain(n: number): void
  /** 遺物共鳴(#13)：次に発動する遺物マッチ効果を2倍にする予約 */
  boostNextRelic(): void
  /** 変換炉/賭博師の壺などが「今回は2倍か」を消費して読む（1回読むと予約は消える） */
  takeRelicBoost(): number
  /** 模倣の粘菌(#14)：直前に発動した（自分以外の）フック効果、無ければ直前に発動した特殊駒効果をもう一度実行する（第5波） */
  replayLast(): void
}

export type Hook =
  | { on: 'match'; system?: System; color?: Color; minSize?: number; act: (g: MatchGroup, ctx: HookCtx) => void }
  | { on: 'destroy'; act: (at: XY, cause: DestroyCause, piece: Piece, ctx: HookCtx) => void }
  | { on: 'sporeTouch'; act: (spore: XY, neighbor: XY, ctx: HookCtx) => void }
  | { on: 'gearTrigger'; act: (at: XY, count: number, ctx: HookCtx) => void }
  | { on: 'turnEnd'; act: (ctx: HookCtx) => void } // MVP①では未発火（敵/ターン制は範囲外。型のみ用意）
