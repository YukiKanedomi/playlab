// 盤面の型定義。駒・障害物は「HPを持つセル要素」に統一（DESIGN.md §5）。

/** 通常駒の色。0陽盤(琥珀) 1芽石(翡翠) 2雫瓶(空) 3月角(菫) 4花石(珊瑚) */
export type Color = 0 | 1 | 2 | 3 | 4

export type Piece =
  // volatile=爆発鉱石（ローグ拡張。ROGUE.md §3）。charged=磁気採掘の充填済みギア（夜間監査[C]2）。
  // どちらも駒そのものの状態のため駒に持たせる（Cell側に持たせると重力で駒だけが移動してフラグが
  // 取り残される。実際にこの不具合を踏んだため駒側に統一した。詳細は最終報告）。
  | { kind: 'normal'; color: Color; volatile?: boolean; charged?: boolean }
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
  | { type: 'enemy'; enemyId: number } // ローグ拡張：敵の身体セル（Board.enemiesを参照。ROGUE.md §5）
  | { type: 'seal'; turnsLeft: number } // ローグ拡張：穴潜みが封鎖したセル（残りターンで自動解除。ROGUE.md §5）

/** 敵の種類（ROGUE.md §5）。swarm=サンドバッグ（小型胞子虫）。第3波：ROGUE2.md §3/§11（連鎖で一掃する快感の主役） */
export type EnemyKind = 'rockshell' | 'sporeling' | 'burrower' | 'swarm' | 'boss'

export interface Cell {
  hole: boolean // 盤外の欠け
  piece: Piece | null
  ground: 0 | 1 | 2 // 蔦苔の層（下敷き。上でマッチ/特殊駒起爆で1層剥がれる）
  block: Block | null
  sporeToken?: boolean // ローグ拡張：設置型の胞子トークン（既存 spore 駒とは別物。RunState併用時のみ使用。ROGUE.md §3）
  armored?: boolean // ローグ拡張：岩殻獣が付与する甲殻。1回分の追加破壊を要求する（ROGUE.md §5）
  poisonSpore?: boolean // ローグ拡張：胞子獣が毒胞子化した駒。消すとプレイヤーHP-1（ROGUE.md §5）
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
  | { t: 'gear-charged'; at: XY } // 磁気採掘：爆発に巻きこまれたギアが破壊されず充填された（夜間監査[C]2）
  | { t: 'obstacle-spawn'; at: XY; blockType: Block['type'] } // 賭博師の壺などが生成する邪魔ピース
  // 可視化第一波：強化が実際に発動した瞬間（ビューの「発動アピール」用。フック act 呼び出し1回につき1個）
  | { t: 'upgrade-fire'; id: string; at: XY }
  // ローグライク拡張（ROGUE.md §5/§6）：敵・ターン制・環境・層/ラン進行
  | { t: 'enemy-damage'; id: number; amount: number; hpLeft: number } // 敵の身体セルへのダメージ
  | { t: 'enemy-defeated'; id: number; cells: XY[] } // 敵撃破。身体セルは開放され重力/補充で埋まる
  | { t: 'armor-applied'; at: XY; id: number } // 岩殻獣：鉱物1つに甲殻を付与（id=行動主の敵ID。可視化第一波：インテント予告に使用）
  | { t: 'armor-broken'; at: XY } // 甲殻セルへの1回目の破壊。駒はまだ消えない
  | { t: 'spore-poisoned'; at: XY; id: number } // 胞子獣：植物1駒を毒胞子化（idは同上）
  | { t: 'poison-triggered'; at: XY; playerHpLeft: number } // 毒胞子化した駒を消してプレイヤーHP-1
  | { t: 'cell-sealed'; at: XY; turns: number; id: number } // 穴潜み：空きセルを封鎖（idは同上）
  | { t: 'cell-unsealed'; at: XY } // 封鎖の期限切れ
  | { t: 'boss-retreat'; row: number } // ボス：累計5ダメージで1行後退（身体最上段を解放）
  | { t: 'boss-slam'; damage: number; playerHpLeft: number; id: number } // ボス：3ターンごとの全体攻撃（idは同上）
  | { t: 'enemy-attack'; id: number; damage: number } // 通常敵：妨害と交互の攻撃ターン。プレイヤーHPを削る（ROGUE.md §5）
  | { t: 'env-grow'; at: XY; kind: 'plant' | 'mineral' } // 環境効果：菌糸層/結晶洞の自然増殖
  | { t: 'floor-clear' } // 層内の敵を全滅させた
  | { t: 'run-over' } // playerHp<=0 でラン終了

export interface XY {
  x: number
  y: number
}
