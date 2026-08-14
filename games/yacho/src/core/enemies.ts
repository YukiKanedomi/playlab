// 敵エンティティ定義（ROGUE.md §5）。
// 種類は固定6種（強化20種のような差し替え可能なプラグイン群ではない）ため、hooks.ts の
// Ctx抽象は導入せず、挙動（ターンごとの行動・ダメージ処理）は board.ts の解決ループに直接持たせる
// （過剰な抽象化を避ける。理由は最終報告）。ここはデータ定義と純粋な初期化ヘルパのみ。
import type { EnemyKind, XY } from './types'

export interface EnemyInstance {
  id: number
  kind: EnemyKind
  hp: number
  maxHp: number
  cells: XY[]
  actionTimer: number // 全種共通の周期カウンタ（ボスも統合）
  markAt: XY | null // 喰み蟲：捕食印の位置
  telegraph: XY[] | null // 裂坑掘り：崩落予告の2x2
  bossPhase: 1 | 2 // ボス：1=封印匣 2=核
  bossShellLeft: number // ボス：残りの匣枚数
}

export const ENEMY_HP: Record<EnemyKind, number> = {
  swarm: 2, rockshell: 6, sporeling: 5, burrower: 6, breathstealer: 5, boss: 8, // boss は「核」のHP
}
/** 定期行動の周期（手）。0 = 定期行動を持たない */
export const ENEMY_PERIOD: Record<EnemyKind, number> = {
  swarm: 0, rockshell: 2, sporeling: 2, burrower: 2, breathstealer: 3, boss: 3,
}
/** 酸素を直接奪う敵と、その量（PLAN_LOOP.md §1.4「まれに酸素を奪う敵」） */
export const OXYGEN_DRAIN: Record<'breathstealer' | 'boss', number> = { breathstealer: 3, boss: 3 }
export const BOSS_SHELL_COUNT = 4
/** swarm 撃破時に隣接 swarm へ伝播するダメージ（HP2＝即死） */
export const SWARM_PROPAGATE_DAMAGE = 2

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
    markAt: null,
    telegraph: null,
    bossPhase: 1,
    bossShellLeft: kind === 'boss' ? BOSS_SHELL_COUNT : 0,
  }
}

/** ボスの身体セル：frontRow〜bottomRowの全列を塞ぐ（SPEC_OXYGEN.md §1.4：最下1行のみ。第2段階で中央2セルへ縮む） */
export function bossBodyCells(frontRow: number, bottomRow: number, width: number): XY[] {
  const out: XY[] = []
  for (let y = frontRow; y <= bottomRow; y++) for (let x = 0; x < width; x++) out.push({ x, y })
  return out
}

export type IntentKind = 'none' | 'armor' | 'devour' | 'fissure' | 'drain'

export interface EnemyIntent {
  kind: IntentKind
  turns: number // 発動までの残り手数（kind==='none' は 0）
  oxygen?: number // 奪う酸素量（'drain' のみ）
  cells?: XY[] // 予告地点（'fissure'=崩落2x2 / 'devour'=捕食印）
  label: string // バッジ脇・遭遇チップ・野帳シートで使う短い日本語
}

/**
 * 次の定期行動までの残りターン数（可視化第一波：敵インテント表示用）。
 * actionTimerは「行動が発火する瞬間にちょうど周期の倍数になる」決定的カウンタなので、
 * 新規状態を持たずに「周期 - 現在値%周期」として導出できる（board.tsの判定式と対で保つ）。
 */
export function turnsUntilAction(e: EnemyInstance): number {
  const p = ENEMY_PERIOD[e.kind]
  return p <= 0 ? 0 : p - (e.actionTimer % p)
}

/** 敵インテント（可視化契約。ビューはこの関数を通して「次に何をしてくるか」を読む） */
export function enemyIntent(e: EnemyInstance): EnemyIntent {
  const turns = turnsUntilAction(e)
  switch (e.kind) {
    case 'swarm':         return { kind: 'none', turns: 0, label: '動かない' }
    case 'rockshell':     return { kind: 'armor', turns, label: '甲殻' }
    case 'sporeling':     return { kind: 'devour', turns, cells: e.markAt ? [e.markAt] : undefined, label: e.markAt ? '捕食' : '目星' }
    case 'burrower':      return { kind: 'fissure', turns, cells: e.telegraph ?? undefined, label: e.telegraph ? '崩落' : '掘削' }
    case 'breathstealer': return { kind: 'drain', turns, oxygen: OXYGEN_DRAIN.breathstealer, label: `酸素-${OXYGEN_DRAIN.breathstealer}` }
    case 'boss':          return { kind: 'drain', turns, oxygen: OXYGEN_DRAIN.boss, label: `酸素-${OXYGEN_DRAIN.boss}` }
  }
}
