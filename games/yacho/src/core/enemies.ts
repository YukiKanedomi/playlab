// 敵エンティティ定義（ROGUE.md §5）。
// 種類は固定4種（強化20種のような差し替え可能なプラグイン群ではない）ため、hooks.ts の
// Ctx抽象は導入せず、挙動（ターンごとの行動・ダメージ処理）は board.ts の解決ループに直接持たせる
// （過剰な抽象化を避ける。理由は最終報告）。ここはデータ定義と純粋な初期化ヘルパのみ。
import type { EnemyKind, XY } from './types'

export interface EnemyInstance {
  id: number
  kind: EnemyKind
  hp: number
  maxHp: number
  cells: XY[] // 居座るセル群（ボスは複数行ぶん）
  actionTimer: number // 2ターンごとの定期行動カウンタ（岩殻獣/胞子獣/穴潜み用。ボスは未使用）
  attackTurn: boolean // 次の定期行動が「攻撃」か「妨害」か（交互。false=妨害から開始。ボスは未使用＝常に攻撃）
  // ボス専用状態（ROGUE.md §5 ボス行）
  bossDamageAccum: number // 前回後退からの累計ダメージ（5で1行後退）
  bossAttackTimer: number // 3ターンごとの全体攻撃カウンタ
  bossFrontRow: number // 現在の身体最上段の行番号（後退のたびに+1）
}

export const ENEMY_HP: Record<EnemyKind, number> = {
  rockshell: 8, // 岩殻獣
  sporeling: 6, // 胞子獣
  burrower: 10, // 穴潜み
  swarm: 1, // サンドバッグ＝小型胞子虫（第3波。ROGUE2.md §3：連鎖で一掃する快感の主役）
  boss: 30, // 巨大深層生物
}

/** 攻撃ターンのプレイヤーHPダメージ量（ROGUE.md §5：妨害と攻撃を交互に行う） */
export const ENEMY_ATTACK_DAMAGE: Record<EnemyKind, number> = {
  rockshell: 3,
  sporeling: 2,
  burrower: 2,
  swarm: 1, // 妨害を持たない攻撃専業。数で圧をかける（周期はSWARM_ATTACK_PERIOD参照）。
  // 夜間監査[D]以降は個体単位ではなく群れ単位で攻撃するため、実際のダメージ量はswarmGroupDamage()が決める
  // （この値は表示用の名残であり、enemyIntentの参考値以上の意味は持たない）。
  boss: 3, // ボスは3ターン周期の全体攻撃（既存のまま。妨害は行わない）
}

/**
 * サンドバッグ（swarm）の攻撃周期。既存敵と同じ2ターンにすると1層6〜10体の同時攻撃で瞬時にHP20を溶かすため、
 * バランス再設計として3ターンに緩和した（第3波・最終報告に理由記載）。HP1で連鎖撃破されやすい前提とセットの調整。
 * 夜間監査[D]で「個体ごとに3ターンで1ダメージ」から「群れ単位で1回攻撃」へ再設計した（下記swarmGroupDamage参照）。
 * 周期そのものは維持し、初回発動だけ4手後へ遅らせた（SWARM_FIRST_ATTACK_TURN）。
 */
export const SWARM_ATTACK_PERIOD = 3
/** サンドバッグ群れの初回攻撃までの手数（夜間監査[D]推奨値）。以降はSWARM_ATTACK_PERIODごとに攻撃する */
export const SWARM_FIRST_ATTACK_TURN = 4

/**
 * サンドバッグ群れの次回攻撃までの残り手数。turnはactionTimer（群れ全個体が同じ手数だけ増える共有カウンタ扱い）。
 * board.ts の発動判定（swarmShouldFire）と対で保つ。
 */
function swarmTurnsUntil(turn: number): number {
  if (turn < SWARM_FIRST_ATTACK_TURN) return SWARM_FIRST_ATTACK_TURN - turn
  const sinceFirst = turn - SWARM_FIRST_ATTACK_TURN
  const rem = sinceFirst % SWARM_ATTACK_PERIOD
  return rem === 0 ? SWARM_ATTACK_PERIOD : SWARM_ATTACK_PERIOD - rem
}

/** turn（actionTimerの増加後の値）がサンドバッグ群れの攻撃タイミングかどうか（board.tsのresolveEnemyTurnが使う） */
export function swarmShouldFire(turn: number): boolean {
  return turn === SWARM_FIRST_ATTACK_TURN || (turn > SWARM_FIRST_ATTACK_TURN && (turn - SWARM_FIRST_ATTACK_TURN) % SWARM_ATTACK_PERIOD === 0)
}

/**
 * サンドバッグ群れの1回の攻撃ダメージ（夜間監査[D]推奨値）：生存4体ごとに1ダメージ、切り上げ、1回最大3。
 * 個体ごとに同時多数が殴る事故（6〜10体同時被弾）を避け、数の圧を保ちつつ被ダメージを緩やかにする。
 */
export function swarmGroupDamage(aliveCount: number): number {
  if (aliveCount <= 0) return 0
  return Math.min(3, Math.ceil(aliveCount / 4))
}

let nextEnemyId = 1

/** テスト間でID採番を初期化したい場合用（決定的テストのため） */
export function resetEnemyIds(): void {
  nextEnemyId = 1
}

/** 敵インスタンスを生成する。cellsは初期の身体セル（呼び出し側が盤面に合わせて決める） */
export function createEnemy(kind: EnemyKind, cells: XY[]): EnemyInstance {
  return {
    id: nextEnemyId++,
    kind,
    hp: ENEMY_HP[kind],
    maxHp: ENEMY_HP[kind],
    cells,
    actionTimer: 0,
    attackTurn: false, // 最初の定期行動は妨害から（チュートリアル圧力。ROGUE.md §6 層1-2の意図を踏襲）
    bossDamageAccum: 0,
    bossAttackTimer: 0,
    bossFrontRow: cells.length ? Math.min(...cells.map((c) => c.y)) : 0,
  }
}

/** ボスの身体セル：frontRow〜bottomRowの全列を塞ぐ（ROGUE.md §5：下2行を身体で塞ぐ） */
export function bossBodyCells(frontRow: number, bottomRow: number, width: number): XY[] {
  const out: XY[] = []
  for (let y = frontRow; y <= bottomRow; y++) for (let x = 0; x < width; x++) out.push({ x, y })
  return out
}

/**
 * 次の定期行動までの残りターン数（可視化第一波：敵インテント表示用）。
 * actionTimer/bossAttackTimerは「行動が発火する瞬間にちょうど周期の倍数になる」決定的カウンタなので、
 * 新規状態を持たずに「周期 - 現在値%周期」として導出できる（board.tsの判定式と対で保つ）。
 */
export function turnsUntilAction(e: EnemyInstance): number {
  if (e.kind === 'boss') return 3 - (e.bossAttackTimer % 3)
  if (e.kind === 'swarm') return swarmTurnsUntil(e.actionTimer)
  return 2 - (e.actionTimer % 2)
}

/**
 * 敵インテント（可視化契約。ビューはこの関数を通して「次に何をしてくるか」を読む）。
 * 通常敵は妨害/攻撃が交互（周期2ターンのまま）。ボスは常に攻撃（3ターン周期の全体攻撃）。
 * kind='attack' のときのみ damage を持つ（妨害ターンはダメージ量が定まらないため省略）。
 */
export function enemyIntent(e: EnemyInstance): { kind: 'attack' | 'disrupt'; damage?: number; turns: number } {
  const turns = turnsUntilAction(e)
  if (e.kind === 'boss') return { kind: 'attack', damage: ENEMY_ATTACK_DAMAGE.boss, turns }
  if (e.kind === 'swarm') return { kind: 'attack', damage: ENEMY_ATTACK_DAMAGE.swarm, turns } // 妨害を持たない（第3波）
  const kind: 'attack' | 'disrupt' = e.attackTurn ? 'attack' : 'disrupt'
  return kind === 'attack' ? { kind, damage: ENEMY_ATTACK_DAMAGE[e.kind], turns } : { kind, turns }
}
