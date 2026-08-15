// 酸素＝唯一の資源（SPEC_OXYGEN.md §1.1 / §9.4）のエンジン層テスト。
// 「1手＝-1」「不正手は0」「クリアで補給（器＝lampMaxを超えない）」「0で遭難」の4点だけを見る。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState, LAMP_MAX_START, OXYGEN_START, OXYGEN_SUPPLY_PER_FLOOR } from './run'
import type { BoardEvent, LevelDef, Piece } from './types'

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
  checkFloorClear: (ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

/** 色0の3個マッチが成立する1手を用意した盤面（この1手で goal color:0 が3進む） */
function boardWithColorMatch(run = createRunState([]), goals?: LevelDef['goals']) {
  const b = new Board(plain(goals ? { goals } : {}), run)
  setPieces(b, ['01003131', ...inert().slice(1)])
  return b
}

const spent = (ev: BoardEvent[]) => ev.filter((e) => e.t === 'oxygen-spent')

describe('1手のコスト', () => {
  it('成立したスワップで酸素が1減り、oxygen-spentが1つだけ出る', () => {
    const run = createRunState([])
    const b = boardWithColorMatch(run)
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(run.oxygen).toBe(OXYGEN_START - 1)
    expect(spent(ev).length).toBe(1)
    const e = spent(ev)[0]
    expect(e.t === 'oxygen-spent' ? e.left : -1).toBe(OXYGEN_START - 1)
  })

  it('不正手（非隣接・マッチ不成立・非特殊駒タップ）では減らず、oxygen-spentも出ない', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const far = b.swap({ x: 0, y: 0 }, { x: 5, y: 5 }) // 非隣接
    const noMatch = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 }) // マッチが成立しない
    const dud = b.tap({ x: 0, y: 0 }) // 通常駒のタップ
    expect(run.oxygen).toBe(OXYGEN_START)
    expect(spent([...far, ...noMatch, ...dud]).length).toBe(0)
  })

  it('特殊駒のタップでも1減る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    const ev = b.tap({ x: 0, y: 3 })
    expect(run.oxygen).toBe(OXYGEN_START - 1)
    expect(spent(ev).length).toBe(1)
  })

  it('特殊駒コンボのスワップでも1手で2回引かれない', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    b.at(1, 3)!.piece = { kind: 'hitsubo' }
    const ev = b.swap({ x: 0, y: 3 }, { x: 1, y: 3 })
    expect(spent(ev).length).toBe(1)
    expect(run.oxygen).toBe(OXYGEN_START - 1)
  })
})

describe('遭難（run-over）', () => {
  it('酸素0で敵ターンを回すとrun-overが1回だけ出る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    run.oxygen = 0
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    priv(b).resolveEnemyTurn(ev) // 2回目は runOverFired ガードで出ない
    expect(ev.filter((e) => e.t === 'run-over').length).toBe(1)
  })
})

describe('層クリアの補給', () => {
  it('目標達成でfloor-clearとoxygen-refillが対で出て、酸素が補給ぶん増える', () => {
    const run = createRunState([])
    run.oxygen = 20 // 器（lampMax）から十分に離しておく＝この検証では補給の素の量だけを見る
    const b = boardWithColorMatch(run, [{ type: 'color', color: 0, count: 3 }])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.filter((e) => e.t === 'floor-clear').length).toBe(1)
    const refills = ev.filter((e) => e.t === 'oxygen-refill')
    expect(refills.length).toBe(1)
    const r = refills[0]
    expect(r.t === 'oxygen-refill' ? r.amount : -1).toBe(OXYGEN_SUPPLY_PER_FLOOR)
    // 1手ぶんの消費(-1)のあとに補給(+12)が乗る
    expect(run.oxygen).toBe(20 - 1 + OXYGEN_SUPPLY_PER_FLOOR)
    expect(r.t === 'oxygen-refill' ? r.left : -1).toBe(run.oxygen)
  })

  it('補給は器（lampMax）でクランプされ、amountは実際に増えた量になる', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'color', color: 0, count: 1 }] }), run)
    // 満タン目前で層クリアしても器は超えない。イベントのamountは「本当に増えた量」＝HUDの「灯 +N」が嘘をつかない
    run.oxygen = run.lampMax - 2
    b.goalDone[0] = 1
    const ev: BoardEvent[] = []
    priv(b).checkFloorClear(ev)
    expect(run.oxygen).toBe(run.lampMax)
    expect(run.lampMax).toBe(LAMP_MAX_START)
    const r = ev.find((e) => e.t === 'oxygen-refill')
    expect(r && r.t === 'oxygen-refill' ? r.amount : -1).toBe(2)
    expect(r && r.t === 'oxygen-refill' ? r.left : -1).toBe(run.lampMax)
  })
})

describe('runなしBoardの互換性', () => {
  it('run未指定なら酸素イベントは一切出ない', () => {
    const b = new Board(plain({ goals: [{ type: 'color', color: 0, count: 3 }] }))
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((e) => e.t === 'oxygen-spent' || e.t === 'oxygen-refill' || e.t === 'floor-clear')).toBe(false)
  })
})
