// 層構成（SPEC_OXYGEN.md §1.5 / PHASE2.md §1）。「課目・原生種の編成・レイアウト」を1枚で持つ。盤面は8x8前提（board.ts の W/H）。
// ボス／奈落の喉の座標は無視され、board.ts が最下行に自動配置する（bossBodyCells / spawnFloor）。
//
// 三幕構成（PHASE2.md §1・codex_strategy_v2.md [C]§2）。幕ごとに「要求される技術・原生種の役割・課目の種類」を変える。
// 新しい機構は1幕につき「課目1・原生種の行動1」まで（3つ以上を同時に足さない）。
//
//   第一幕 1〜10 空明かり … 基礎（まとめ消し／目標マス優先／兆候の読み）。課目＝植物・蔦苔・陶片・掃討
//                            原生種は単独で1種ずつ学ばせる。補給が消費とほぼ釣り合う＝灯を貯める幕
//   第二幕 11〜20 炉あかり … 二課目の優先順位。新課目＝**光胞子**（巣灯から生まれ1手1マス浮上、上端で回収）
//                            新原生種＝**綴じ蟲**（列を丸ごと落とす＝落ちてくる列を当てにさせない）。灯が細り始める幕
//   第三幕 21〜30 岩あかり … 完成ビルドを一手へ集約し、退避級を先に落とす。新課目＝**苔石**（2層の個体を混ぜる）
//                            新原生種＝**鐘脚**（殻を張り直す＝小突きを禁じる）。灯が尽きる幕
//   終幕   31    …………… 特殊ラスボス **奈落の喉**。盤面の使用可能域そのものが3相で変わる（既存の封鎖/解放の再利用）
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

/**
 * クセ敵（swarm 以外）の定位置。SWARM_SPOTS とも互いにも重ならず、
 * どのレイアウトでもここには障害物・蔦苔を置かない（spawnEnemy が block を無条件上書きするため）。
 */
const P1: XY = { x: 4, y: 4 }
const P2: XY = { x: 5, y: 4 }
const P3: XY = { x: 2, y: 4 }
const spawn = (kind: EnemyKind, p: XY): FloorEnemySpawn => ({ kind, at: p })

const FLAT: string[] = Array(8).fill('........')
/** 敵の殲滅目標。編成をそのまま撃破数にする（層10ではボス1体＝クリア条件と一致） */
const wipeGoal = (es: FloorEnemySpawn[]): Goal => ({ type: 'enemy-kill', count: es.length })
/** 植物系（色1と色4の両方が進む）の収集目標 */
const plantGoal = (n: number): Goal => ({ type: 'system', system: 'plant', count: n })
/** 光胞子の搬送（第二幕の新課目）。巣灯を叩いて生まれた胞子が上端まで浮上すると1進む */
const sporeGoal = (n: number): Goal => ({ type: 'spore', count: n })
/** 苔石の除去（第三幕の新課目）。'K' は2回叩かないと壊れないが、進むのは壊れた個体数 */
const kokeishiGoal = (n: number): Goal => ({ type: 'kokeishi', count: n })

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

// ---- 第二幕（11〜20 炉あかり）のレイアウト ----
// 巣灯4基＝胞子16個ぶん。上段(y=1)の2基は浮上距離が短く、下段(y=5)の2基は5手かけて上がる＝「どちらを先に叩くか」が課目の順序になる
const L_SUBI_A: string[] = ['........', '...s.s..', '........', '........', '........', '..s...s.', '........', '........']
// 巣灯3＋匣10。光胞子（時間がかかる）と陶片（手数がかかる）を並べ、先に着手する側を選ばせる二課目用
const L_SUBI_H: string[] = ['.h....h.', '...s.s..', '.h...h..', '........', '...h....', '..s...h.', '..h.h...', '.h....h.']
// 蔦苔18（うち2層が8）。第一幕の L_MOSS_B より広く、綴じ蟲に列を落とされると片側が触れなくなる配置
const L_MOSS_C: string[] = ['gg....gg', '...GG...', '........', 'g......g', '........', '...GG...', '........', 'gg....gg']
// 匣13。第一幕の L_HAKO_A（12）より1つ多いだけだが、二課目・綴じ蟲との併用で読みが変わる
const L_HAKO_C: string[] = ['..h..h..', '........', '.h...h..', 'h......h', '...h....', '..h...h.', 'h......h', '..h..h..']

// ---- 第三幕（21〜30 岩あかり）のレイアウト ----
// 苔石14（すべて2層）。1層だと3手で層が終わってしまったので全て2層にした（同じマスを二度叩く計画を要求する）
const L_KOKE_A: string[] = ['.K....K.', 'K...K...', '.K...K..', '......K.', '...K....', 'K.K...K.', '...K....', '.K....K.']
// 苔石6＋匣8。二段手順（匣→陶片）と一撃（苔石）を並べる
const L_KOKE_H: string[] = ['.k....k.', '...h.h..', '.k...k..', 'h......h', '...K....', 'k.h...k.', '...h....', '.h....h.']
// 苔石8＋蔦苔12。どちらも「同じマスを二度叩く」個体を混ぜてある
const L_KOKE_M: string[] = ['gk....kg', '....G...', '.k...k..', 'g......g', '...K....', '..G...G.', '...k....', 'gk....kg']
// 巣灯4＋苔石6。浮上する胞子の通り道を苔石が塞ぐ（割る順序が搬送速度に直結する）
const L_SUBI_K: string[] = ['........', '...s.s..', '.k...k..', '........', '...K....', '..s...s.', '...k....', '.k....k.']

// wipeGoal に同じ配列を二度書かないよう、殲滅目標の層だけ編成を定数に括り出す
const F2 = swarm(5)
const F5: FloorEnemySpawn[] = [{ kind: 'burrower', at: { x: 4, y: 4 } }]
const F7: FloorEnemySpawn[] = [{ kind: 'rockshell', at: { x: 4, y: 4 } }]
const F10: FloorEnemySpawn[] = [{ kind: 'boss', at: { x: 0, y: 7 } }]
const F12: FloorEnemySpawn[] = [spawn('binder', P1)]
const F15: FloorEnemySpawn[] = [spawn('binder', P1), spawn('rockshell', P2)]
const F20: FloorEnemySpawn[] = [{ kind: 'boss', at: { x: 0, y: 7 } }, spawn('binder', P1)]
const F22: FloorEnemySpawn[] = [spawn('bellfoot', P1), spawn('breathstealer', P2)]
// 深度22と同じ2体をもう一度出す。22は「殻が張り直される」を学ぶ層、25は灯が細った状態で
// 「どちらを先に落とすか」を測る層（鐘脚2体にすると殻の剥がし直しで14手を超え、6〜12手の帯を割った）
const F25: FloorEnemySpawn[] = [spawn('bellfoot', P1), spawn('breathstealer', P2)]
const F30: FloorEnemySpawn[] = [{ kind: 'boss', at: { x: 0, y: 7 } }, spawn('breathstealer', P1)]
/** 終幕の奈落の喉。座標は board.ts が最下行の中央2セルへ置き換えるので、ここの値は使われない */
const F31: FloorEnemySpawn[] = [{ kind: 'maw', at: { x: 3, y: 7 } }]

// 新しい敵は「その敵を倒すこと自体が課目の層」か「その妨害が課目と直接干渉する層」にだけ初出させる（§1.5）。
// 課目の数は runsim の較正値。層が進むほど1手の破壊数が増える（知見の累積）ため、同じ手数でも深い層ほど要求数が大きくなる。
// 第一幕の行末の数字は10層時代の120シード平均の実測手数。
//
// 全層を6〜12手に収めてある（PHASE2.md §2.5① の合格条件）。灯が細るかどうかは層の長さではなく
// 幕ごとの補給（run.ts の SUPPLY_BY_ACT）で決めている。要求数を動かしたら必ず runsim を回し直すこと。
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

  // ---- 第二幕 11〜20 炉あかり：二課目の優先順位／価値の高い駒の保護 ----
  // 新課目＝光胞子（11で単独導入）、新原生種＝綴じ蟲（12で単独学習）。以降は既知の組合せだけで編む
  { floor: 11, enemies: swarm(3), goals: [sporeGoal(9)], layout: L_SUBI_A }, // 光胞子の単独導入（浮上に手数がかかることを学ぶ）
  { floor: 12, enemies: F12, goals: [wipeGoal(F12), plantGoal(55)], layout: FLAT }, // 綴じ蟲の単独学習。掃討のみだと数手で終わるので収集を添える
  { floor: 13, enemies: [spawn('rockshell', P1), ...swarm(2)], goals: [{ type: 'tsutagoke', count: 11 }, plantGoal(45)], layout: L_MOSS_C }, // 二課目の初出（蔦苔＋植物）
  { floor: 14, enemies: [spawn('breathstealer', P1)], goals: [sporeGoal(6), { type: 'touhen', count: 6 }], layout: L_SUBI_H }, // 時間の課目と手数の課目、どちらを先に
  { floor: 15, enemies: F15, goals: [wipeGoal(F15), plantGoal(45)], layout: FLAT }, // 掃討2体（綴じ蟲＋岩殻獣）＋収集
  { floor: 16, enemies: [spawn('sporeling', P1), spawn('binder', P2)], goals: [{ type: 'touhen', count: 11 }], layout: L_HAKO_C }, // 列を落とされながらの二段手順
  { floor: 17, enemies: [spawn('breathstealer', P1), ...swarm(2)], goals: [{ type: 'tsutagoke', count: 11 }, plantGoal(45)], layout: L_MOSS_C }, // 灯喰みの下で二課目
  { floor: 18, enemies: [spawn('sporeling', P1), spawn('binder', P2)], goals: [sporeGoal(7), plantGoal(40)], layout: L_SUBI_A }, // 喰み蟲は胞子を優先して食う＝守る駒がはっきりする
  { floor: 19, enemies: [spawn('breathstealer', P1), spawn('binder', P2)], goals: [{ type: 'touhen', count: 6 }, sporeGoal(6)], layout: L_SUBI_H }, // 幕の総復習
  { floor: 20, enemies: F20, goals: [wipeGoal(F20)], layout: FLAT }, // 幕主：深匣主＋綴じ蟲（列が落ちる中で匣を剥がす）

  // ---- 第三幕 21〜30 岩あかり：完成ビルドを一手へ集約／退避級を先に落とす ----
  // 新課目＝苔石（21で単独導入）、新原生種＝鐘脚（22で単独学習）。灯喰みが常設になり、長居がそのまま失敗になる
  { floor: 21, enemies: [spawn('breathstealer', P1), ...swarm(2)], goals: [kokeishiGoal(10)], layout: L_KOKE_A }, // 苔石の単独導入（割るほど盤面が広がる）
  { floor: 22, enemies: F22, goals: [wipeGoal(F22), plantGoal(30)], layout: FLAT }, // 鐘脚の単独学習（小突いても殻が張り直される）
  { floor: 23, enemies: [spawn('breathstealer', P1), ...swarm(2)], goals: [kokeishiGoal(8), plantGoal(45)], layout: L_KOKE_A }, // 退避級を先に落とすか、課目を進めるか
  { floor: 24, enemies: [spawn('bellfoot', P1), spawn('breathstealer', P2)], goals: [{ type: 'touhen', count: 6 }, kokeishiGoal(4)], layout: L_KOKE_H },
  { floor: 25, enemies: F25, goals: [wipeGoal(F25), plantGoal(35)], layout: FLAT }, // 掃討2体（鐘脚＋灯喰み）＝落とす順序がそのまま灯の差になる
  { floor: 26, enemies: [spawn('sporeling', P1), spawn('breathstealer', P2)], goals: [{ type: 'tsutagoke', count: 7 }, kokeishiGoal(6)], layout: L_KOKE_M },
  { floor: 27, enemies: [spawn('breathstealer', P1), spawn('bellfoot', P2)], goals: [sporeGoal(8), kokeishiGoal(4)], layout: L_SUBI_K }, // 苔石が胞子の通り道を塞ぐ
  { floor: 28, enemies: [spawn('bellfoot', P1), spawn('binder', P2), spawn('breathstealer', P3)], goals: [{ type: 'touhen', count: 9 }, plantGoal(45)], layout: L_HAKO_C }, // 3体同時
  { floor: 29, enemies: [spawn('breathstealer', P1), spawn('bellfoot', P2)], goals: [kokeishiGoal(6), { type: 'tsutagoke', count: 7 }], layout: L_KOKE_M }, // 幕の総復習
  { floor: 30, enemies: F30, goals: [wipeGoal(F30)], layout: FLAT }, // 幕主：深匣主＋灯喰み（退避級を先に落とさないと匣を剥がしきる前に灯が尽きる）

  // ---- 終幕 31：特殊ラスボス ----
  // 「さらにHPが多い敵」にしない（PHASE2.md §1）。奈落の喉は灯を1も奪わず、盤面の使用可能域だけを
  // 3手ごとに 割れる→狭まる→開く と変える。狭い盤で一手を作れるかだけが問われる
  { floor: 31, enemies: F31, goals: [wipeGoal(F31)], layout: FLAT },
]
