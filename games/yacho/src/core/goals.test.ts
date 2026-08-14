// フロア目標（SPEC_OXYGEN.md §1.2 / §9.4）のエンジン層テスト。
// 「目標を満たした瞬間に層クリア（残敵は問わない）」「クリアした手では敵ターンが走らない」が核。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState } from './run'
import type { BoardEvent, Color, GoalType, LevelDef, Piece, XY } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

function setPieces(b: Board, rows: string[]) {
  const map: Record<string, Piece | null> = {
    '.': null,
    '0': { kind: 'normal', color: 0 },
    '1': { kind: 'normal', color: 1 },
    '2': { kind: 'normal', color: 2 },
    '3': { kind: 'normal', color: 3 },
    '4': { kind: 'normal', color: 4 },
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = structuredClone(map[rows[y][x]]) ?? null
    }
}

/** 市松で絶対にマッチしない充填 */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

interface Priv {
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[], heavy?: boolean) => void
  fireAt: (at: XY, ev: BoardEvent[]) => void
  progressGoal: (match: { type: GoalType; color?: Color }, at: XY, ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

/**
 * 蔦苔1マス(0,0)を1手で剥がせる盤面。x=0 の縦3連が (0,0) を含むので、この1手で tsutagoke が1進む。
 * 敵は呼び出し側が spawnEnemy で足す（setPieces のあとに置くこと）。
 */
function boardClearableByOneMove(run = createRunState([])) {
  const b = new Board(plain({ goals: [{ type: 'tsutagoke', count: 1 }], layout: ['g.......', ...Array(7).fill('........')] }), run)
  setPieces(b, inert())
  b.at(0, 0)!.piece = { kind: 'normal', color: 0 }
  b.at(0, 1)!.piece = { kind: 'normal', color: 0 }
  b.at(0, 2)!.piece = { kind: 'normal', color: 1 }
  b.at(1, 2)!.piece = { kind: 'normal', color: 0 } // これを (0,2) と入れ替えて縦3連が立つ
  return b
}

describe('system 目標（植物＝色1と色4の両方）', () => {
  it('色1のマッチでも色4のマッチでも同じ目標が進む（鉱物では進まない）', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'system', system: 'plant', count: 999 }] }), run)
    const ev: BoardEvent[] = []
    priv(b).progressGoal({ type: 'color', color: 1 }, { x: 0, y: 0 }, ev)
    expect(b.goalDone[0]).toBe(1)
    priv(b).progressGoal({ type: 'color', color: 4 }, { x: 1, y: 0 }, ev)
    expect(b.goalDone[0]).toBe(2)
    priv(b).progressGoal({ type: 'color', color: 2 }, { x: 2, y: 0 }, ev) // 鉱物は別系統
    expect(b.goalDone[0]).toBe(2)
    expect(ev.length).toBe(2)
  })

  it('実際のマッチ（色1の3連）でも進む', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'system', system: 'plant', count: 999 }] }), run)
    setPieces(b, inert())
    b.at(0, 0)!.piece = { kind: 'normal', color: 1 }
    b.at(1, 0)!.piece = { kind: 'normal', color: 4 } // これを (0,0) と入れ替えて x1..x3 の色1が揃う
    b.at(2, 0)!.piece = { kind: 'normal', color: 1 }
    b.at(3, 0)!.piece = { kind: 'normal', color: 1 }
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((e) => e.t === 'goal-progress')).toBe(true)
    expect(b.goalDone[0]).toBeGreaterThanOrEqual(3)
  })
})

describe('enemy-kill 目標', () => {
  it('swarm2体を倒すとfloor-clearがちょうど1回出る', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'enemy-kill', count: 2 }] }), run)
    const a = b.spawnEnemy('swarm', [{ x: 3, y: 3 }])
    b.spawnEnemy('swarm', [{ x: 4, y: 3 }]) // 隣接＝heavyな撃破で伝播して道連れになる
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(a.id, 2, ev, true)
    expect(b.enemies.length).toBe(0)
    expect(b.goalDone[0]).toBe(2)
    priv(b).resolveEnemyTurn(ev)
    expect(ev.filter((e) => e.t === 'floor-clear').length).toBe(1)
    const ev2: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev2)
    expect(ev2.some((e) => e.t === 'floor-clear')).toBe(false)
  })
})

describe('層クリアの条件', () => {
  it('残敵がいても目標を満たした瞬間にクリアする', () => {
    const run = createRunState([])
    const b = boardClearableByOneMove(run)
    b.spawnEnemy('swarm', [{ x: 5, y: 5 }])
    const ev = b.swap({ x: 0, y: 2 }, { x: 1, y: 2 })
    expect(ev.filter((e) => e.t === 'floor-clear').length).toBe(1)
    expect(b.enemies.length).toBeGreaterThan(0) // 敵は生きたままクリアしている
  })

  it('クリアした手では敵ターンが走らない（行動直前まで溜まっていても発動しない）', () => {
    const run = createRunState([])
    const b = boardClearableByOneMove(run)
    const rock = b.spawnEnemy('rockshell', [{ x: 5, y: 5 }])
    const breath = b.spawnEnemy('breathstealer', [{ x: 7, y: 6 }])
    rock.actionTimer = 1 // 周期2＝次の敵ターンで甲殻を付ける
    breath.actionTimer = 2 // 周期3＝次の敵ターンで酸素を奪う
    const ev = b.swap({ x: 0, y: 2 }, { x: 1, y: 2 })
    expect(ev.some((e) => e.t === 'floor-clear')).toBe(true)
    expect(ev.some((e) => e.t === 'armor-applied' || e.t === 'oxygen-drained' || e.t === 'cell-sealed')).toBe(false)
    expect(rock.actionTimer).toBe(1) // カウンタも進んでいない
    expect(breath.actionTimer).toBe(2)
  })

  it('goals が空の Board では floor-clear が絶対に出ない（旧30レベル制の保護）', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [] }), run)
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(b.won).toBe(true) // 空goalsは every() が true になる
    expect(ev.some((e) => e.t === 'floor-clear' || e.t === 'oxygen-refill')).toBe(false)
  })
})

describe('goal-progress イベント', () => {
  it('index（goals の添字）と盤内の at が載る', () => {
    const run = createRunState([])
    const b = new Board(
      plain({
        goals: [
          { type: 'color', color: 3, count: 999 },
          { type: 'color', color: 0, count: 999 },
        ],
      }),
      run,
    )
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    const gp = ev.filter((e) => e.t === 'goal-progress')
    expect(gp.length).toBeGreaterThan(0)
    for (const e of gp) {
      if (e.t !== 'goal-progress') continue
      expect(e.index).toBe(1) // 色0の目標は2番目
      expect(e.at.x).toBeGreaterThanOrEqual(0)
      expect(e.at.x).toBeLessThan(W)
      expect(e.at.y).toBeGreaterThanOrEqual(0)
      expect(e.at.y).toBeLessThan(H)
    }
  })

  it('甲殻付きの駒では目標が進まない（二重計上の穴の回帰）', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'color', color: 1, count: 999 }] }), run)
    setPieces(b, inert()) // 行3は色3/色2だけ＝色1は下で置くぶんだけ
    b.at(2, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(5, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(5, 3)!.armored = true
    b.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    const ev: BoardEvent[] = []
    priv(b).fireAt({ x: 0, y: 3 }, ev) // 崩落・補充を挟まず効果線だけを見る
    expect(ev.some((e) => e.t === 'armor-broken')).toBe(true)
    expect(b.at(5, 3)?.piece).toEqual({ kind: 'normal', color: 1 }) // 甲殻に阻まれて消えていない
    const gp = ev.filter((e) => e.t === 'goal-progress')
    expect(gp.length).toBe(1) // 進むのは甲殻なしの (2,3) だけ
    expect(gp[0].t === 'goal-progress' ? gp[0].at : null).toEqual({ x: 2, y: 3 })
    expect(b.goalDone[0]).toBe(1)
  })
})
