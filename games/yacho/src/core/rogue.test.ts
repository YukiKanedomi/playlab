// ローグライク・ピボット第1弾（Rogue-MVP①）のエンジン層テスト。ROGUE.md §3/§4 準拠。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState } from './run'
import type { BoardEvent, LevelDef, Piece, XY } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 20,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** board.test.ts と同じ流儀のテスト用盤面組み立て（v=爆発鉱石を追加） */
function setPieces(b: Board, rows: string[]) {
  const map: Record<string, Piece | null> = {
    '.': null,
    '0': { kind: 'normal', color: 0 },
    '1': { kind: 'normal', color: 1 },
    '2': { kind: 'normal', color: 2 },
    '3': { kind: 'normal', color: 3 },
    '4': { kind: 'normal', color: 4 },
    v: { kind: 'normal', color: 2, volatile: true }, // 爆発鉱石
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = structuredClone(map[rows[y][x]]) ?? null
    }
}

/** 市松で絶対にマッチしない充填（0/1交互 + 3色目で行を分ける）。色4は未使用なので自由に使える */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

describe('胞子繁殖（#1）', () => {
  it('植物(色4)を4個以上で消すと、消滅域の端に胞子トークンを2個生成', () => {
    const run = createRunState(['spore-bloom'])
    const b = new Board(plain(), run)
    // board.test.ts「4連で銛」と同型のレイアウト（色0→4に差し替え）。(2,1)↔(2,0)で横4連。
    setPieces(b, ['24144313', '32421431', ...inert().slice(2)])
    const ev = b.swap({ x: 2, y: 1 }, { x: 2, y: 0 })
    const spawns = ev.filter((e) => e.t === 'token-spawn')
    expect(spawns.length).toBe(2)
  })
})

describe('根食い鉱（#5）', () => {
  it('胞子トークンに隣接する駒が消えると、トークン周囲の鉱物(色2)が爆発鉱石に変わる', () => {
    const run = createRunState(['root-eating-ore'])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(3, 3)!.sporeToken = true // 胞子トークンを直接設置
    b.at(3, 2)!.piece = { kind: 'normal', color: 2 } // トークンの隣に鉱物
    const ev: BoardEvent[] = []
    ;(b as unknown as { checkSporeTouch: (at: XY, ev: BoardEvent[]) => void }).checkSporeTouch({ x: 4, y: 3 }, ev)
    expect(ev.some((e) => e.t === 'token-consumed')).toBe(true)
    expect(b.at(3, 2)?.piece).toEqual({ kind: 'normal', color: 2, volatile: true })
  })
})

describe('爆発鉱石（トークン2種のうち鉱物側）', () => {
  it('爆発鉱石を含むマッチで破壊されると十字1マス爆発し、マッチ範囲外も巻き込む', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    // board.test.ts「横3マッチ」と同型（色0→2、真ん中を爆発鉱石 v に差し替え）
    setPieces(b, ['21v23131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((e) => e.t === 'match')).toBe(true)
    const explode = ev.find((e) => e.t === 'explode')
    expect(explode).toBeTruthy()
    expect(explode!.t === 'explode' && explode!.cells.some((c) => c.x === 2 && c.y === 1)).toBe(true) // マッチ範囲外(2,1)も巻き込む
  })
})

describe('ギア起動（#4手順）', () => {
  it('ギア(色0)がマッチ消滅するたびgearChargeが増え、gear-triggerイベントが積まれる', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(run.gearCharge).toBe(3) // x1..x3 の3個が同時消滅
    expect(ev.filter((e) => e.t === 'gear-trigger').length).toBe(3)
  })
})

describe('自律機構（#10）', () => {
  // バランス再設計（プレイテスト反省）：ギア3回起動→2回起動に緩和（ROGUE.md §4）。1回目はまだ発動しない。
  it('ギアが2回起動すると、ランダムな特殊駒が1つ生成される', () => {
    const run = createRunState(['autonomous-mechanism'])
    const b = new Board(plain(), run)
    const ev: BoardEvent[] = []
    const triggerGear = (b as unknown as { triggerGear: (at: XY, ev: BoardEvent[]) => void }).triggerGear.bind(b)
    triggerGear({ x: 0, y: 0 }, ev)
    expect(ev.some((e) => e.t === 'special-born')).toBe(false) // 1回目はまだ発動しない
    triggerGear({ x: 0, y: 0 }, ev)
    const born = ev.find((e) => e.t === 'special-born')
    expect(born && born.t === 'special-born' && born.piece.kind !== 'normal').toBe(true)
  })
})

describe('暴走対策（フック発火上限200）', () => {
  it('上限を超えると打ち切られ、records.criticalが立つ', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const consumeHookBudget = (b as unknown as { consumeHookBudget: () => boolean }).consumeHookBudget.bind(b)
    let ok = 0
    for (let i = 0; i < 250; i++) if (consumeHookBudget()) ok++
    expect(ok).toBe(200)
    expect(run.records.critical).toBe(true)
  })
})

describe('runなしBoardの互換性', () => {
  it('run未指定なら既存挙動のまま（フック関連の副作用が一切発生しない）', () => {
    const b = new Board(plain())
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((e) => e.t === 'gear-trigger' || e.t === 'token-spawn' || e.t === 'explode')).toBe(false)
  })
})
