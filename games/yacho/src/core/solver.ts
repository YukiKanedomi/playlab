// ヘッドレス自動プレイヤー（レベル検収・難易度計測用）。
// 「そこそこ上手い人」を模す貪欲ヒューリスティック。難易度はこのソルバーの勝率で相対比較する。
import { Board, H, W } from './board'
import type { LevelDef, XY } from './types'
import { makeRng, randInt, type Rng } from './rng'

export interface PlayResult {
  won: boolean
  movesUsed: number
  score: number
  stars: number
}

/** ゴールに関係する障害物・下敷きの座標集合 */
function goalCells(b: Board): XY[] {
  const out: XY[] = []
  const want = (t: string) => b.goals.some((g, i) => g.type === t && b.goalDone[i] < g.count)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (!c) continue
      if (c.block?.type === 'kokeishi' && want('kokeishi')) out.push({ x, y })
      if ((c.block?.type === 'hako' || c.block?.type === 'touhen') && want('touhen')) out.push({ x, y })
      if (c.block?.type === 'subi' && want('spore')) out.push({ x, y })
      if (c.ground > 0 && want('tsutagoke')) out.push({ x, y })
    }
  return out
}

/** 1手を選ぶ：特殊駒があれば高確率で使用。スワップはゴール近接を優先 */
function pickMove(b: Board, rng: Rng): { tap?: XY; swap?: { a: XY; b: XY } } | null {
  const specials = b.specialsOnBoard()
  if (specials.length > 0 && rng() < 0.8) {
    // 隣接する特殊駒同士があれば合成
    for (const s of specials) {
      const n = specials.find((q) => q !== s && Math.abs(q.x - s.x) + Math.abs(q.y - s.y) === 1)
      if (n) return { swap: { a: s, b: n } }
    }
    return { tap: specials[randInt(rng, specials.length)] }
  }
  const moves = b.validMoves()
  if (moves.length === 0) return null
  const goals = goalCells(b)
  if (goals.length > 0) {
    // ゴールセルに隣接 or 直上のマッチを優先
    let best: { m: { a: XY; b: XY }; d: number } | null = null
    for (const m of moves) {
      let d = Infinity
      for (const g of goals) {
        for (const p of [m.a, m.b]) {
          const dist = Math.abs(p.x - g.x) + Math.abs(p.y - g.y)
          if (dist < d) d = dist
        }
      }
      if (!best || d < best.d || (d === best.d && rng() < 0.5)) best = { m, d }
    }
    if (best) return { swap: best.m }
  }
  return { swap: moves[randInt(rng, moves.length)] }
}

/** 1プレイ実行 */
export function autoplay(def: LevelDef, solverSeed: number): PlayResult {
  const b = new Board(def)
  const rng = makeRng(solverSeed)
  let guard = 0
  while (!b.won && !b.lost && guard++ < 500) {
    const mv = pickMove(b, rng)
    if (!mv) break
    if (mv.tap) b.tap(mv.tap)
    else if (mv.swap) b.swap(mv.swap.a, mv.swap.b)
  }
  return { won: b.won, movesUsed: def.moves - b.movesLeft, score: b.score, stars: b.stars }
}

/** N回試行して勝率などを計測 */
export function measure(def: LevelDef, attempts = 20): { winRate: number; avgScore: number; avgMovesLeft: number } {
  let wins = 0
  let scoreSum = 0
  let movesLeftSum = 0
  for (let i = 0; i < attempts; i++) {
    const r = autoplay(def, 1000 + i * 7919)
    if (r.won) {
      wins++
      movesLeftSum += def.moves - r.movesUsed
    }
    scoreSum += r.score
  }
  return {
    winRate: wins / attempts,
    avgScore: scoreSum / attempts,
    avgMovesLeft: wins > 0 ? movesLeftSum / wins : 0,
  }
}
