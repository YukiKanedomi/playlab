// セーブデータ（localStorage）。進行・星・コインを永続化する。
export interface SaveData {
  /** クリア済みレベルの最高ID（次に挑めるのは unlocked+1） */
  unlocked: number
  /** レベルごとの最高星数（index = id-1） */
  stars: number[]
  coins: number
}

const KEY = 'yacho-save-v1'

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const d = JSON.parse(raw) as SaveData
      if (typeof d.unlocked === 'number' && Array.isArray(d.stars) && typeof d.coins === 'number') return d
    }
  } catch {
    /* 壊れていたら初期化 */
  }
  return { unlocked: 0, stars: [], coins: 0 }
}

export function persistSave(d: SaveData): void {
  localStorage.setItem(KEY, JSON.stringify(d))
}

/** クリア報酬コイン（RM実測: Lv1で+68。レベルとともに微増） */
export function clearReward(levelId: number, stars: number): number {
  return 60 + levelId * 2 + stars * 10
}

export const EXTRA_MOVES_COST = 900 // 追加5手（RM実測準拠）
export const EXTRA_MOVES = 5
