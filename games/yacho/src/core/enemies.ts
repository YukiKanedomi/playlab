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
  // ボス専用状態（ROGUE.md §5 ボス行）
  bossDamageAccum: number // 前回後退からの累計ダメージ（5で1行後退）
  bossAttackTimer: number // 3ターンごとの全体攻撃カウンタ
  bossFrontRow: number // 現在の身体最上段の行番号（後退のたびに+1）
}

export const ENEMY_HP: Record<EnemyKind, number> = {
  rockshell: 8, // 岩殻獣
  sporeling: 6, // 胞子獣
  burrower: 10, // 穴潜み
  boss: 30, // 巨大深層生物
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
