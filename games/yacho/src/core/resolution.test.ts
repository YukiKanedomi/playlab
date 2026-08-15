// C案移行 Phase5 の検収（codex_arch_review.md §3-5）：
// 「旧実装と新drainについて、最終cells、RNG状態、score、goals、イベント列をdifferential testする」
// swap() は swapStepped().drain() の互換adapterなので、ここでは
// 「一括drain」と「next()で1セグメントずつ進める」が完全に同じ結果になることを双子盤面で検証する。
// RNG状態は直接読めないため、系列の最後に同じ追加手を打って挙動一致で確認する。
import { describe, expect, it } from 'vitest'
import { Board } from './board'
import type { LevelDef } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 60,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

const snapshot = (b: Board) =>
  JSON.stringify({
    cells: b.cells,
    movesLeft: b.movesLeft,
    goalDone: b.goalDone,
    score: b.score,
  })

describe('段階的解決（Phase5: drain と next() 逐次の同値性）', () => {
  it('双子盤面で30手：一括swap()とnext()逐次で、イベント列と最終状態が完全一致する', () => {
    for (const seed of [3, 42, 777, 20260815]) {
      const a = new Board(plain({ seed }))
      const b = new Board(plain({ seed }))
      expect(snapshot(a)).toBe(snapshot(b))
      for (let i = 0; i < 30; i++) {
        const moves = a.validMoves()
        if (!moves.length || a.movesLeft <= 0) break
        const mv = moves[(seed + i * 7) % moves.length]
        const evA = a.swap(mv.a, mv.b)
        // b側は1セグメントずつ
        const r = b.swapStepped(mv.a, mv.b)
        const evB = []
        let seg
        let segCount = 0
        while ((seg = r.next()) !== null) {
          evB.push(...seg)
          segCount++
        }
        expect(evB).toEqual(evA)
        expect(r.events).toEqual(evA)
        expect(r.done).toBe(true)
        expect(snapshot(b)).toBe(snapshot(a))
        // 成立手は必ず複数セグメントに割れている（swap→resolve→gravity→…）
        if (!evA.some((e) => e.t === 'swap' && e.illegal)) expect(segCount).toBeGreaterThanOrEqual(2)
      }
      // RNG状態の一致確認：同じ追加手で同じイベントが出る
      const tail = a.validMoves()[0]
      if (tail) expect(b.swap(tail.a, tail.b)).toEqual(a.swap(tail.a, tail.b))
    }
  })

  it('next()完了後の再呼び出しはnullを返し、drain()は残り全部を返す', () => {
    const a = new Board(plain({ seed: 5 }))
    const mv = a.validMoves()[0]
    expect(mv).toBeTruthy()
    const r = a.swapStepped(mv.a, mv.b)
    const first = r.next()
    expect(first).not.toBeNull()
    const rest = r.drain()
    expect(r.done).toBe(true)
    expect(r.next()).toBeNull()
    expect([...first!, ...rest]).toEqual(r.events)
  })

  it('不正手はセグメントに割れず illegal イベント1件で完了する', () => {
    const a = new Board(plain({ seed: 9 }))
    // 隣接でない2セル
    const r = a.swapStepped({ x: 0, y: 0 }, { x: 5, y: 5 })
    const seg = r.next()
    expect(seg).toEqual([{ t: 'swap', a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, illegal: true }])
    expect(r.next()).toBeNull()
  })
})
