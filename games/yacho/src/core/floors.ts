// 層構成（SPEC_OXYGEN.md §1.5）。10層ぶんの「目標・敵編成・レイアウト」を1枚で持つ。盤面は8x8前提（board.ts の W/H）。
// ボスの座標は無視され、board.ts が最下行に自動配置する（bossBodyCells）。
import type { EnemyKind, Goal, XY } from './types'

export interface FloorEnemySpawn {
  kind: EnemyKind
  at: XY // 通常敵の初期セル。ボスはここを無視して自動配置する
}

export interface FloorDef {
  floor: number
  enemies: FloorEnemySpawn[]
  /** 層の目標。すべて満たすと層クリア（残敵がいてもクリアする）。空配列は禁止 */
  goals: Goal[]
  /** 8行×8列。記法は LevelDef.layout と同一（'.'通常 '#'欠け 'g/G'蔦苔 'k/K'苔石 'h'匣 's'巣灯） */
  layout: string[]
}

// 座標は5組の隣接ペアを盤面4隅+中央付近へ散らす配置（決定的固定座標）。
// ただの散開（全員非隣接）だと「撃破時に隣接swarmへダメージ伝播」が初期配置からは一切発火せず
// 連鎖の見せ場が失われるため、各ペア内だけは隣接させて伝播の起点を必ず用意する。
const SWARM_SPOTS: XY[] = [
  { x: 1, y: 1 },
  { x: 2, y: 1 }, // ペアA（左上）
  { x: 6, y: 1 },
  { x: 6, y: 2 }, // ペアB（右上）
  { x: 1, y: 6 },
  { x: 1, y: 5 }, // ペアC（左下）
  { x: 6, y: 6 },
  { x: 5, y: 6 }, // ペアD（右下）
  { x: 3, y: 3 },
  { x: 4, y: 3 }, // ペアE（中央）
]

const swarm = (n: number): FloorEnemySpawn[] => SWARM_SPOTS.slice(0, n).map((at) => ({ kind: 'swarm' as EnemyKind, at }))

const FLAT: string[] = Array(8).fill('........')
/** 敵の殲滅目標。編成をそのまま撃破数にする（層10ではボス1体＝クリア条件と一致） */
const wipeGoal = (es: FloorEnemySpawn[]): Goal => ({ type: 'enemy-kill', count: es.length })
/** 植物系（色1と色4の両方が進む）の収集目標 */
const plantGoal = (n: number): Goal => ({ type: 'system', system: 'plant', count: n })

// レイアウトの制約（SPEC_OXYGEN.md §5.2）：敵の初期セルには g/G/h/k/K/s を置かない
// （spawnEnemy が block を無条件上書きするため匣が消え、蔦苔は駒が入らず永久に剥がせなくなる）。
// 層3：蔦苔の単独導入（要求8／設置10）。角・辺・中央へ分散させ「敵の隣より目標マス」を選ばせる
const L_MOSS_A: string[] = ['g......g', '........', '..g..g..', '........', '..g...g.', '........', '........', 'g.g..g.g']
// 層8：蔦苔の再試験（要求10／設置12）。2層(G)を混ぜて「同じマスを2回叩く」計画を要求する
const L_MOSS_B: string[] = ['gg....gg', '........', '...GG...', '........', '........', '..G..G..', '........', 'gg....gg']
// 層6：匣の単独導入（要求10／設置12）。二段手順（匣を割る→陶片を回収）を学ばせる。
// 設置8では層が7手で終わり、消費が補給+7と釣り合って酸素カーブが平らになる（§10.3の単調減少が崩れる）ため12へ増やした
const L_HAKO_A: string[] = ['........', '.h....h.', '..h..h..', '...hh...', '.h....h.', '...hh...', '..h..h..', '........']
// 層9：匣＋植物の複合（要求7／設置8）
const L_HAKO_B: string[] = ['........', '.h....h.', '..h..h..', '........', '........', '..h..h..', '.h....h.', '........']

// wipeGoal に同じ配列を二度書かないよう、殲滅目標の層だけ編成を定数に括り出す
const F2 = swarm(5)
const F5: FloorEnemySpawn[] = [{ kind: 'burrower', at: { x: 4, y: 4 } }]
const F7: FloorEnemySpawn[] = [{ kind: 'rockshell', at: { x: 4, y: 4 } }]
const F10: FloorEnemySpawn[] = [{ kind: 'boss', at: { x: 0, y: 7 } }]

// 新しい敵は「その敵を倒すこと自体が目標の層」か「その妨害が目標と直接干渉する層」にだけ初出させる（§1.5）。
// 目標数は runsim の較正値（SPEC_OXYGEN.md §10.3）。層が進むほど1手の破壊数が増える（強化の累積）ため、
// 同じ手数でも後半の層ほど要求数が大きくなる。行末の数字は 120シード平均の実測手数（_runsim.txt と対で保つ）。
//
// 全層を「補給(+8)より重い」9手以上に揃えてある。1層でも補給を下回ると、そこで酸素の貯金が増えて
// 「層が進むほど細る」（§10.3）が崩れ、酸素が失敗条件として働かなくなる。目標数を減らすときはこの下限を割らないこと。
export const FLOORS: FloorDef[] = [
  { floor: 1, enemies: [], goals: [plantGoal(32)], layout: FLAT }, // 目標と酸素だけを学ぶ入口（敵なし）9.9手
  { floor: 2, enemies: F2, goals: [wipeGoal(F2)], layout: FLAT }, // まとめ消し（HP2＋小マッチ減衰）9.3手。4体だと7.0手＝補給と釣り合って酸素が減らないため5体
  { floor: 3, enemies: swarm(2), goals: [{ type: 'tsutagoke', count: 8 }], layout: L_MOSS_A }, // 敵の隣より目標マス 10.6手
  { floor: 4, enemies: swarm(3), goals: [plantGoal(56)], layout: FLAT }, // 妨害下の収集 11.6手
  { floor: 5, enemies: F5, goals: [wipeGoal(F5), plantGoal(50)], layout: FLAT }, // 裂坑掘り＋収集 10.3手。殲滅のみだと5.2手で終わっていた（崩落が収集を邪魔する＝2軸になる）
  { floor: 6, enemies: [{ kind: 'burrower', at: { x: 4, y: 4 } }], goals: [{ type: 'touhen', count: 10 }], layout: L_HAKO_A }, // 既知の敵＋新目標 10.4手（匣12設置・要求10）
  { floor: 7, enemies: F7, goals: [wipeGoal(F7), plantGoal(56)], layout: FLAT }, // 大きく消す＋収集 9.8手。殲滅のみだと4.3手で終わっていた（甲殻の合間に集める＝2軸になる）
  {
    floor: 8,
    enemies: [...swarm(2), { kind: 'sporeling', at: { x: 4, y: 4 } }],
    goals: [{ type: 'tsutagoke', count: 11 }],
    layout: L_MOSS_B,
  }, // 捕食印＝敵の隣以外を触る初出 10.9手
  {
    floor: 9,
    enemies: [
      { kind: 'sporeling', at: { x: 4, y: 4 } },
      { kind: 'breathstealer', at: { x: 5, y: 4 } },
    ],
    goals: [{ type: 'touhen', count: 7 }, plantGoal(50)],
    layout: L_HAKO_B,
  }, // 初の酸素直接ドレイン 9.1手
  { floor: 10, enemies: F10, goals: [wipeGoal(F10)], layout: FLAT }, // ボスのみ（匣→核＋ドレイン）8.7手
]
