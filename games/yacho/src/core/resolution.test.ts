// C案移行 Phase5/5.5 の検収（codex_arch_review.md §3-5・codex_c_phase46_plan.md §4-5）：
// 「一括drain（swap()）」と「next()逐次」の同値性、ResolutionStep契約
// （kind・revision単調増加・snapshotAfterの境界一致）を双子盤面で検証する。
// RNG状態は直接読めないため、系列の最後に同じ追加手を打って挙動一致で確認する。
import { describe, expect, it } from 'vitest'
import { Board } from './board'
import type { LevelDef } from './types'
import { createRunState } from './run'
import { FLOORS, type FloorDef } from './floors'
import { makeRng } from './rng'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 60,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** 敵IDはモジュール全体の連番なので双子盤面でも一致しない。ID系だけ正規化して比較する */
const normIds = (s: string) => s.replace(/"enemyId":\d+/g, '"enemyId":0').replace(/"id":\d+/g, '"id":0')

const snapshot = (b: Board) =>
  normIds(
    JSON.stringify({
      cells: b.cells,
      enemies: b.enemies,
      movesLeft: b.movesLeft,
      goalDone: b.goalDone,
      score: b.score,
      oxygen: b.run ? b.run.oxygen : null,
    }),
  )

const KINDS = new Set(['swap', 'resolve', 'gravity', 'after-move', 'enemy', 'finish'])

/** b側で1手をnext()逐次実行し、step契約を検証しながら全イベントを集める */
function playStepped(b: Board, mv: { a: { x: number; y: number }; b: { x: number; y: number } }) {
  const r = b.swapStepped(mv.a, mv.b)
  const evB = []
  const kinds: string[] = []
  let step
  let prevIndex = -1
  let prevAfterRev = b.revision
  while ((step = r.next()) !== null) {
    evB.push(...step.events)
    kinds.push(step.kind)
    expect(KINDS.has(step.kind)).toBe(true)
    expect(step.events.length).toBeGreaterThan(0) // 空境界は返さない契約
    expect(step.index).toBe(prevIndex + 1)
    prevIndex = step.index
    expect(step.beforeRevision).toBe(prevAfterRev)
    expect(step.afterRevision).toBeGreaterThan(step.beforeRevision) // revision単調増加
    prevAfterRev = step.afterRevision
    // snapshotAfter は「この境界時点」の盤面と一致する（境界の間でエンジンは進まない）
    expect(JSON.stringify(step.snapshotAfter.cells)).toBe(JSON.stringify(b.cells))
    expect(step.snapshotAfter.movesLeft).toBe(b.movesLeft)
    expect(JSON.stringify(step.snapshotAfter.enemies)).toBe(JSON.stringify(b.enemies))
  }
  expect(r.done).toBe(true)
  return { evB, kinds, events: r.events }
}

describe('段階的解決（Phase5.5: drain と next() 逐次の同値性＋step契約）', () => {
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
        const { evB, kinds, events } = playStepped(b, mv)
        expect(evB).toEqual(evA)
        expect(events).toEqual(evA)
        expect(snapshot(b)).toBe(snapshot(a))
        // 成立手は swap セグメントで始まり、複数セグメントに割れている
        if (!evA.some((e) => e.t === 'swap' && e.illegal)) {
          expect(kinds[0]).toBe('swap')
          expect(kinds.length).toBeGreaterThanOrEqual(2)
        }
      }
      // RNG状態の一致確認：同じ追加手で同じイベントが出る
      const tail = a.validMoves()[0]
      if (tail) expect(b.swap(tail.a, tail.b)).toEqual(a.swap(tail.a, tail.b))
    }
  })

  it('ランモード（層7・敵あり）でも逐次と一括が一致し、enemy/finish セグメントが出る', () => {
    const floor = 7
    const def: FloorDef = FLOORS[floor - 1]
    const mkTwin = (seed: number) => {
      const run = createRunState(undefined, makeRng(seed))
      run.floor = floor
      return new Board({ id: floor, seed, moves: 9999, colors: 5, goals: def.goals, layout: def.layout }, run, def)
    }
    for (const seed of [11, 20260816]) {
      const a = mkTwin(seed)
      const b = mkTwin(seed)
      expect(snapshot(a)).toBe(snapshot(b))
      const seenKinds = new Set<string>()
      for (let i = 0; i < 20; i++) {
        const moves = a.validMoves()
        if (!moves.length) break
        const mv = moves[(seed + i * 13) % moves.length]
        const evA = a.swap(mv.a, mv.b)
        const { evB, kinds } = playStepped(b, mv)
        for (const k of kinds) seenKinds.add(k)
        expect(normIds(JSON.stringify(evB))).toBe(normIds(JSON.stringify(evA)))
        expect(snapshot(b)).toBe(snapshot(a))
        if (evA.some((e) => e.t === 'run-over' || e.t === 'floor-clear')) break
      }
      // 敵のいる層では敵ターン境界が実際に発行されている（oxygen-spentはswap側なのでenemy行動 or finishで確認）
      expect(seenKinds.has('swap')).toBe(true)
      expect(seenKinds.has('gravity')).toBe(true)
      expect(seenKinds.has('finish') || seenKinds.has('enemy')).toBe(true)
    }
  })

  it('next()完了後の再呼び出しはnullを返し、next×N→drainの全境界で最終状態が同じになる', () => {
    // まず全step数を数える
    const count = (() => {
      const b = new Board(plain({ seed: 5 }))
      const mv = b.validMoves()[0]
      const r = b.swapStepped(mv.a, mv.b)
      let n = 0
      while (r.next() !== null) n++
      expect(r.next()).toBeNull()
      return { n, final: snapshot(b), mv }
    })()
    expect(count.n).toBeGreaterThanOrEqual(2)
    // next×k → drain を全kで試し、イベント合計と最終状態が一致する
    for (let k = 0; k <= count.n; k++) {
      const b = new Board(plain({ seed: 5 }))
      const r = b.swapStepped(count.mv.a, count.mv.b)
      const got = []
      for (let i = 0; i < k; i++) {
        const s = r.next()
        if (s) got.push(...s.events)
      }
      const rest = r.drain()
      expect(r.done).toBe(true)
      expect([...got, ...rest.events]).toEqual(r.events)
      expect(snapshot(b)).toBe(count.final)
      expect(JSON.stringify(rest.finalSnapshot.cells)).toBe(JSON.stringify(b.cells))
    }
  })

  it('不正手は swap セグメント1つ（illegalイベントのみ）で完了する', () => {
    const a = new Board(plain({ seed: 9 }))
    const r = a.swapStepped({ x: 0, y: 0 }, { x: 5, y: 5 })
    const step = r.next()
    expect(step?.kind).toBe('swap')
    expect(step?.events).toEqual([{ t: 'swap', a: { x: 0, y: 0 }, b: { x: 5, y: 5 }, illegal: true }])
    expect(r.next()).toBeNull()
  })
})
