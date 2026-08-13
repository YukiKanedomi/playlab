// 盤面の型定義。駒・障害物は「HPを持つセル要素」に統一（DESIGN.md §5）。

/** 通常駒の色。0陽盤(琥珀) 1芽石(翡翠) 2雫瓶(空) 3月角(菫) 4花石(珊瑚) */
export type Color = 0 | 1 | 2 | 3 | 4

export type Piece =
  | { kind: 'normal'; color: Color; volatile?: boolean } // volatile=爆発鉱石（ローグ拡張。ROGUE.md §3）
  | { kind: 'harpoon'; dir: 'h' | 'v'; origin?: 'plant' | 'mineral' | 'gear' | 'relic' } // 銛（RMロケット）。originは蔓ロケット強化用
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
  sporeToken?: boolean // ローグ拡張：設置型の胞子トークン（既存 spore 駒とは別物。RunState併用時のみ使用。ROGUE.md §3）
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
  star2?: number // ★2スコア閾値（既定1500）
  star3?: number // ★3スコア閾値（既定3000）
}

/** 1回の解決で起きた事実（描画・音・スコアが購読するイベント） */
export type BoardEvent =
  | { t: 'swap'; a: XY; b: XY; illegal: boolean }
  | { t: 'match'; cells: XY[]; color: Color; chain: number }
  | { t: 'special-born'; at: XY; piece: Piece }
  | { t: 'special-fire'; at: XY; piece: Piece; cleared: XY[] }
  | { t: 'combo'; at: XY; from: XY; kinds: string }
  | { t: 'block-hit'; at: XY; type: Block['type']; destroyed: boolean }
  | { t: 'ground-hit'; at: XY; left: number }
  | { t: 'spore-born'; at: XY }
  | { t: 'spore-rise'; from: XY; to: XY }
  | { t: 'spore-collected'; at: XY }
  | { t: 'fall'; from: XY; to: XY }
  | { t: 'refill'; at: XY; piece: Piece }
  | { t: 'goal-progress'; goal: Goal; done: number }
  // 勝利シーケンス（RESEARCH §5: 残手数ドレイン→特殊駒変換→自動起爆）
  | { t: 'win-drain'; movesLeft: number; convertAt: XY | null }
  | { t: 'win-detonate-begin' }
  // ローグライク拡張（ROGUE.md §3）：フックが生む決定的アクションのうち、既存イベントに翻訳できないもの
  | { t: 'token-spawn'; at: XY; kind: 'spore' } // 胞子トークン設置
  | { t: 'token-consumed'; at: XY; kind: 'spore' } // トークンが隣接消滅に反応して消費
  | { t: 'explode'; at: XY; cells: XY[] } // 爆発鉱石の爆発（destroy連鎖の起点）
  | { t: 'gear-trigger'; at: XY; count: number } // ギア駒起動（RunState.gearCharge計上）
  | { t: 'obstacle-spawn'; at: XY; blockType: Block['type'] } // 賭博師の壺などが生成する邪魔ピース

export interface XY {
  x: number
  y: number
}
