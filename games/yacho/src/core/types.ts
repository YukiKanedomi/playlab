// 盤面の型定義。駒・障害物は「HPを持つセル要素」に統一（DESIGN.md §5）。

/** 通常駒の色。0陽盤(琥珀) 1芽石(翡翠) 2雫瓶(空) 3月角(菫) 4花石(珊瑚) */
export type Color = 0 | 1 | 2 | 3 | 4

export type Piece =
  | { kind: 'normal'; color: Color }
  | { kind: 'harpoon'; dir: 'h' | 'v' } // 銛（RMロケット）
  | { kind: 'hamushi' } // 羽虫（RMプロペラ）
  | { kind: 'hitsubo' } // 火壺（RM TNT）
  | { kind: 'seiju' } // 星珠（RMライトボール）
  | { kind: 'spore' } // 光胞子：1手ごとに1マス浮上、上端で回収（独自ルール）

/** マスを占有する障害物（駒が入れない） */
export type Block =
  | { type: 'kokeishi'; hp: 1 | 2 } // 苔石（Box型・最大2層）
  | { type: 'hako'; hp: 1 } // 匣（Container型。壊すと陶片に変わる）
  | { type: 'touhen'; hp: 1 } // 陶片（匣の中身。隣接ダメージで回収）
  | { type: 'subi'; remaining: number } // 巣灯（Generator型。隣接ヒットで胞子排出、残0で閉鎖）

export interface Cell {
  hole: boolean // 盤外の欠け
  piece: Piece | null
  ground: 0 | 1 | 2 // 蔦苔の層（下敷き。上でマッチ/特殊駒起爆で1層剥がれる）
  block: Block | null
}

export type GoalType =
  | 'color' // 指定色を規定数
  | 'kokeishi'
  | 'tsutagoke'
  | 'touhen'
  | 'spore'

export interface Goal {
  type: GoalType
  color?: Color
  count: number
}

export interface LevelDef {
  id: number
  seed: number
  moves: number
  colors: 4 | 5
  goals: Goal[]
  /**
   * 8行×8列。1文字=1マス:
   * '.'=通常 '#'=欠け 'g'=蔦苔1 'G'=蔦苔2
   * 'k'=苔石1層 'K'=苔石2層 'h'=匣 's'=巣灯
   */
  layout: string[]
  /** 巣灯1基あたりの排出数（既定4） */
  subiCharge?: number
  bossRun?: boolean // 絶界行（ブースター不可・報酬増）
}

/** 1回の解決で起きた事実（描画・音・スコアが購読するイベント） */
export type BoardEvent =
  | { t: 'swap'; a: XY; b: XY; illegal: boolean }
  | { t: 'match'; cells: XY[]; color: Color; chain: number }
  | { t: 'special-born'; at: XY; piece: Piece }
  | { t: 'special-fire'; at: XY; piece: Piece; cleared: XY[] }
  | { t: 'combo'; at: XY; kinds: string }
  | { t: 'block-hit'; at: XY; type: Block['type']; destroyed: boolean }
  | { t: 'ground-hit'; at: XY; left: number }
  | { t: 'spore-born'; at: XY }
  | { t: 'spore-rise'; from: XY; to: XY }
  | { t: 'spore-collected'; at: XY }
  | { t: 'fall'; from: XY; to: XY }
  | { t: 'refill'; at: XY; piece: Piece }
  | { t: 'goal-progress'; goal: Goal; done: number }

export interface XY {
  x: number
  y: number
}
