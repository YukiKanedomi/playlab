// 層構成（ROGUE.md §6）。MVP10層ぶんの敵編成と環境フラグ。盤面は8x8前提（board.ts の W/H）。
// ボスの座標は無視され、board.ts が下2行に自動配置する（bossBodyCells）。
import type { EnemyKind, XY } from './types'

export type EnvFlag = 'fungal' | 'crystal' | null // 菌糸層・結晶洞（ROGUE.md §6）

export interface FloorEnemySpawn {
  kind: EnemyKind
  at: XY // 通常敵の初期セル。ボスはここを無視して自動配置する
}

export interface FloorDef {
  floor: number
  enemies: FloorEnemySpawn[]
  env: EnvFlag
}

// 第3波（ROGUE2.md §3/§11）：敵構成比の是正。サンドバッグ(swarm)を主体にし、既存3種は
// クセ敵/エリート枠へ降格して1層0〜1体に絞る（層9のみ「混成」として3種そろい踏み）。
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
// ボス層は下2行（H-2/H-1＝行6・7）がボスの身体で埋まるため、そこに重ならない座標だけを使う
const SWARM_SPOTS_UPPER = SWARM_SPOTS.filter((p) => p.y < 6)

const swarm = (n: number): FloorEnemySpawn[] => SWARM_SPOTS.slice(0, n).map((at) => ({ kind: 'swarm' as EnemyKind, at }))

export const FLOORS: FloorDef[] = [
  { floor: 1, enemies: swarm(6), env: null }, // チュートリアル圧力（サンドバッグの数の圧を体験させる）
  { floor: 2, enemies: swarm(8), env: null },
  { floor: 3, enemies: [...swarm(6), { kind: 'rockshell', at: { x: 4, y: 4 } }], env: null },
  { floor: 4, enemies: [...swarm(7), { kind: 'sporeling', at: { x: 4, y: 4 } }], env: null },
  { floor: 5, enemies: [...swarm(6), { kind: 'burrower', at: { x: 4, y: 4 } }], env: 'fungal' },
  { floor: 6, enemies: swarm(8), env: null },
  { floor: 7, enemies: [...swarm(7), { kind: 'sporeling', at: { x: 4, y: 4 } }], env: null },
  { floor: 8, enemies: [...swarm(8), { kind: 'burrower', at: { x: 4, y: 4 } }], env: 'crystal' },
  {
    floor: 9,
    // 混成：クセ敵3種そろい踏み＋サンドバッグ最大数（比率是正の例外＝§4「層9=swarm10+混成」）
    enemies: [
      ...swarm(10),
      { kind: 'rockshell', at: { x: 4, y: 4 } },
      { kind: 'sporeling', at: { x: 3, y: 4 } },
      { kind: 'burrower', at: { x: 5, y: 4 } },
    ],
    env: null,
  },
  {
    floor: 10,
    enemies: [{ kind: 'boss', at: { x: 0, y: 6 } }, ...SWARM_SPOTS_UPPER.slice(0, 4).map((at) => ({ kind: 'swarm' as EnemyKind, at }))],
    env: null,
  }, // ボス層（+サンドバッグ4）
]
