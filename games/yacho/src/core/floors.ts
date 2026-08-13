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

export const FLOORS: FloorDef[] = [
  { floor: 1, enemies: [{ kind: 'rockshell', at: { x: 3, y: 3 } }], env: null }, // チュートリアル圧力
  { floor: 2, enemies: [{ kind: 'rockshell', at: { x: 4, y: 4 } }], env: null },
  {
    floor: 3,
    enemies: [
      { kind: 'rockshell', at: { x: 2, y: 3 } },
      { kind: 'sporeling', at: { x: 5, y: 4 } },
    ],
    env: null,
  },
  {
    floor: 4,
    enemies: [
      { kind: 'sporeling', at: { x: 3, y: 4 } },
      { kind: 'burrower', at: { x: 5, y: 3 } },
    ],
    env: null,
  },
  {
    floor: 5,
    enemies: [
      { kind: 'rockshell', at: { x: 2, y: 4 } },
      { kind: 'sporeling', at: { x: 5, y: 3 } },
    ],
    env: 'fungal',
  },
  {
    floor: 6,
    enemies: [
      { kind: 'burrower', at: { x: 3, y: 3 } },
      { kind: 'sporeling', at: { x: 5, y: 4 } },
    ],
    env: null,
  },
  {
    floor: 7,
    enemies: [
      { kind: 'rockshell', at: { x: 2, y: 3 } },
      { kind: 'burrower', at: { x: 5, y: 4 } },
      { kind: 'sporeling', at: { x: 4, y: 2 } },
    ],
    env: null,
  },
  {
    floor: 8,
    enemies: [
      { kind: 'rockshell', at: { x: 3, y: 3 } },
      { kind: 'burrower', at: { x: 4, y: 4 } },
    ],
    env: 'crystal',
  },
  {
    floor: 9,
    enemies: [
      { kind: 'rockshell', at: { x: 2, y: 2 } },
      { kind: 'sporeling', at: { x: 5, y: 3 } },
      { kind: 'burrower', at: { x: 3, y: 5 } },
    ],
    env: null,
  },
  { floor: 10, enemies: [{ kind: 'boss', at: { x: 0, y: 6 } }], env: null }, // ボス層
]
