// 敵エンティティ定義（ROGUE.md §5）。
// 種類は固定6種（強化20種のような差し替え可能なプラグイン群ではない）ため、hooks.ts の
// Ctx抽象は導入せず、挙動（ターンごとの行動・ダメージ処理）は board.ts の解決ループに直接持たせる
// （過剰な抽象化を避ける。理由は最終報告）。ここはデータ定義と純粋な初期化ヘルパのみ。
import type { EnemyKind, XY } from './types'
import { blessingDrain } from './blessings'

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
  /** 鐘脚：残りの殻の枚数。0より大きいあいだ本体HPには一切通らない（量に関係なく1解決で1枚だけ剥がれる） */
  shell: number
  /** 鐘脚：殻を剥がした解決の番号（同一解決での二重剥がし抑止。ボスの bossShellHitAtSeq と同じ理由） */
  shellSeq: number
}

export const ENEMY_HP: Record<EnemyKind, number> = {
  swarm: 2, rockshell: 6, sporeling: 5, burrower: 6, breathstealer: 5, binder: 7, bellfoot: 10, boss: 8, maw: 11, // boss は「核」のHP
}
/** 定期行動の周期（手）。0 = 定期行動を持たない */
export const ENEMY_PERIOD: Record<EnemyKind, number> = {
  swarm: 0, rockshell: 2, sporeling: 2, burrower: 2, breathstealer: 3, binder: 3, bellfoot: 3, boss: 3, maw: 3,
}
/** 鐘脚が張り直せる殻の上限（初期値でもある） */
export const BELLFOOT_SHELL_MAX = 2
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
    shell: kind === 'bellfoot' ? BELLFOOT_SHELL_MAX : 0,
    shellSeq: -1,
  }
}

/**
 * 奈落の喉（特殊ラスボス）が相ごとに封鎖する盤面。既存の seal（board.ts）をそのまま使うので新しい機構は無い。
 * 相0=中央2列が落ちて盤が二つに割れる／相1=四隅が落ちて中央十字だけが残る／相2=全域が開く。
 * seal の期限（3手）と行動周期（3手）が一致しているので、次の相が来る手に前の相がちょうど解ける。
 */
export const MAW_PHASE_LABELS = ['割れる', '狭まる', '開く'] as const
export const MAW_PHASES = MAW_PHASE_LABELS.length

export function mawPhaseCells(phase: number, width: number, height: number): XY[] {
  const out: XY[] = []
  if (phase === 0) {
    // 中央2列（本体のいる最下行は除く＝身体セルは封鎖の対象にならない）
    for (let y = 0; y < height - 1; y++) for (const x of [3, 4]) out.push({ x, y })
  } else if (phase === 1) {
    // 四隅の3x3。残るのは中央十字（行3-4と列3-4）
    for (const [ox, oy] of [[0, 0], [width - 3, 0], [0, height - 3], [width - 3, height - 3]] as const)
      for (let y = oy; y < oy + 3; y++) for (let x = ox; x < ox + 3; x++) out.push({ x, y })
  }
  return out
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
 * 眠りの帳（祝福）はカウンタを負から始める＝最初の発火は必ずカウンタが p に達した手なので、
 * 負の間は「p - 現在値」がそのまま残り手数（board.ts側の「0以下は発火しない」ガードと対）。
 */
export function turnsUntilAction(e: EnemyInstance): number {
  const p = ENEMY_PERIOD[e.kind]
  if (p <= 0) return 0
  return e.actionTimer < 0 ? p - e.actionTimer : p - (e.actionTimer % p)
}

/**
 * 敵インテント（可視化契約。ビューはこの関数を通して「次に何をしてくるか」を読む）。
 * 祝福「息を殺す」で奪われる量が3から1へ変わるため、灯を奪う敵は blessings を通した**実際に奪われる量**で出す
 * （予告と実測が食い違うと兆候が嘘になる）。blessings 省略時は素の値。
 */
export function enemyIntent(e: EnemyInstance, blessings: string[] = []): EnemyIntent {
  const turns = turnsUntilAction(e)
  const drain = (kind: 'breathstealer' | 'boss') => blessingDrain(blessings, OXYGEN_DRAIN[kind])
  switch (e.kind) {
    case 'swarm':         return { kind: 'none', turns: 0, label: '動かない' }
    case 'rockshell':     return { kind: 'armor', turns, label: '甲殻' }
    case 'sporeling':     return { kind: 'devour', turns, cells: e.markAt ? [e.markAt] : undefined, label: e.markAt ? '捕食' : '目星' }
    case 'burrower':      return { kind: 'fissure', turns, cells: e.telegraph ?? undefined, label: e.telegraph ? '崩落' : '掘削' }
    // 綴じ蟲は「予告した列を封鎖する」＝裂坑掘りと同じ読み方（予告セル＋残り手）なので intent の型を増やさない
    case 'binder':        return { kind: 'fissure', turns, cells: e.telegraph ?? undefined, label: e.telegraph ? '綴じ' : '見立て' }
    // 鐘脚は殻＝甲殻と同じ記号で読ませる。数字が「あと何枚剥がせば本体に通るか」を語る
    case 'bellfoot':      return { kind: 'armor', turns, label: e.shell > 0 ? `殻${e.shell}` : '殻なし' }
    case 'breathstealer': return { kind: 'drain', turns, oxygen: drain('breathstealer'), label: `灯−${drain('breathstealer')}` }
    case 'boss':          return { kind: 'drain', turns, oxygen: drain('boss'), label: `灯−${drain('boss')}` }
    // 奈落の喉：灯は奪わない。次に来る相の名前と残り手だけを出す。
    // cells（盤上の予告枠）は出さない：予告枠はセル群の外接矩形で描かれるので、四隅を塞ぐ相では
    // 「盤面全体が塞がる」という嘘の枠になる（BoardView.makeFissureFrame）
    case 'maw':           return { kind: 'fissure', turns, label: MAW_PHASE_LABELS[mawNextPhase(e)] }
  }
}

/** 奈落の喉が次の行動で入る相（0/1/2）。k回目の行動が相 (k-1)%3 に対応する */
export function mawNextPhase(e: EnemyInstance): number {
  const p = ENEMY_PERIOD.maw
  return Math.floor(e.actionTimer / p) % MAW_PHASE_LABELS.length
}
