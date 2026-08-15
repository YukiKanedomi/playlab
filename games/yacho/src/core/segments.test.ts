// C案移行 Phase3 の検収（codex_arch_review.md §3-3）：
// 「全Segmentをflattenしたイベント列が旧イベント列と一致すること」
import { describe, expect, it } from 'vitest'
import { Board } from './board'
import type { LevelDef } from './types'
import { segmentEvents } from './segments'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 40,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

describe('segmentEvents（Phase3: 分類はイベント列を保存する）', () => {
  it('ランダムプレイ200手ぶんをflattenすると元の列に完全一致する', () => {
    for (const seed of [1, 7, 42, 1234, 987654]) {
      const b = new Board(plain({ seed }))
      for (let i = 0; i < 40; i++) {
        const moves = b.validMoves()
        if (!moves.length || b.movesLeft <= 0) break
        const mv = moves[(seed + i * 13) % moves.length]
        const evs = b.swap(mv.a, mv.b)
        const segs = segmentEvents(evs)
        expect(segs.flatMap((s) => s.events)).toEqual(evs)
        // 全セグメントは空でなく、種別は網羅マップから来る
        for (const s of segs) expect(s.events.length).toBeGreaterThan(0)
      }
    }
  })

  it('成立スワップは swap セグメントで始まり resolve が続く', () => {
    const b = new Board(plain())
    const mv = b.validMoves()[0]
    expect(mv).toBeTruthy()
    const segs = segmentEvents(b.swap(mv.a, mv.b))
    expect(segs[0].kind).toBe('swap')
    expect(segs.some((s) => s.kind === 'resolve')).toBe(true)
    expect(segs.some((s) => s.kind === 'gravity')).toBe(true)
  })

  it('reroll イベントは gravity に分類され refill と区別できる', () => {
    const segs = segmentEvents([
      { t: 'reroll', at: { x: 1, y: 1 }, piece: { kind: 'normal', color: 0 } },
      { t: 'refill', at: { x: 1, y: 0 }, piece: { kind: 'normal', color: 1 } },
    ])
    expect(segs).toHaveLength(1)
    expect(segs[0].kind).toBe('gravity')
    expect(segs[0].events[0].t).toBe('reroll')
  })
})
