import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import type { LevelDef, Piece } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 20,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** テスト用に盤面を直接組む */
function setPieces(b: Board, rows: string[]) {
  const map: Record<string, Piece | null> = {
    '.': null,
    '0': { kind: 'normal', color: 0 },
    '1': { kind: 'normal', color: 1 },
    '2': { kind: 'normal', color: 2 },
    '3': { kind: 'normal', color: 3 },
    '4': { kind: 'normal', color: 4 },
    H: { kind: 'harpoon', dir: 'h' },
    V: { kind: 'harpoon', dir: 'v' },
    B: { kind: 'hitsubo' },
    S: { kind: 'seiju' },
    M: { kind: 'hamushi' },
    o: { kind: 'spore' },
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = structuredClone(map[rows[y][x]]) ?? null
    }
}

/** 市松で絶対にマッチしない充填（0/1交互 + 3色目で行を分ける） */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

describe('マッチ検出と特殊駒生成', () => {
  it('横3マッチで消えて手数が減る', () => {
    const b = new Board(plain())
    // (0,0)↔(1,0) で x1..x3 が 0 の3連に
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((e) => e.t === 'match')).toBe(true)
    expect(b.movesLeft).toBe(19)
  })

  it('4連で銛が生まれる（横4連→縦銛）', () => {
    const b = new Board(plain())
    setPieces(b, ['20100313', '32021031', ...inert().slice(2)])
    // (2,1)の0を(2,0)へ → x1..x4 が 0 の横4連
    const ev = b.swap({ x: 2, y: 1 }, { x: 2, y: 0 })
    const born = ev.find((e) => e.t === 'special-born')
    expect(born && born.t === 'special-born' && born.piece.kind === 'harpoon' && born.piece.dir === 'v').toBe(true)
  })

  it('L字5で火壺、5連で星珠', () => {
    const b = new Board(plain())
    // 縦0×2(x0,y0-y1) + 横0×2(x1-x2,y2)。(0,3)の0を(0,2)へ上げるとL字5に
    setPieces(b, ['02121212', '03232323', '10021212', '04343434', ...inert().slice(4)])
    const ev = b.swap({ x: 0, y: 3 }, { x: 0, y: 2 })
    expect(ev.some((e) => e.t === 'special-born' && e.piece.kind === 'hitsubo')).toBe(true)

    const b2 = new Board(plain())
    setPieces(b2, ['00100122', '32021031', ...inert().slice(2)])
    const ev2 = b2.swap({ x: 2, y: 1 }, { x: 2, y: 0 })
    expect(ev2.some((e) => e.t === 'special-born' && e.piece.kind === 'seiju')).toBe(true)
  })

  it('2×2で羽虫', () => {
    const b = new Board(plain())
    // (1,1)↔(2,1) で (0,0)(1,0)(0,1)(1,1) が 0 の2×2 に
    setPieces(b, ['00343434', '04034343', ...inert().slice(2)])
    const ev = b.swap({ x: 2, y: 1 }, { x: 1, y: 1 })
    expect(ev.some((e) => e.t === 'special-born' && e.piece.kind === 'hamushi')).toBe(true)
  })
})

describe('特殊駒の発動とコンボ', () => {
  it('銛タップで行が消える', () => {
    const b = new Board(plain())
    const rows = inert()
    setPieces(b, [rows[0], rows[1], 'H' + rows[2].slice(1), ...rows.slice(3)])
    const ev = b.tap({ x: 0, y: 2 })
    const fire = ev.find((e) => e.t === 'special-fire')
    expect(fire).toBeTruthy()
    // 行内の通常駒が消えている（リフィルで埋まるので fire イベントで確認）
    expect(fire!.t === 'special-fire' && fire!.cleared.length >= 5).toBe(true)
  })

  it('火壺+火壺コンボで半径4爆発', () => {
    const b = new Board(plain())
    const rows = inert()
    setPieces(b, [rows[0], rows[1], rows[2], rows[3].slice(0, 3) + 'BB' + rows[3].slice(5), ...rows.slice(4)])
    const ev = b.swap({ x: 3, y: 3 }, { x: 4, y: 3 })
    expect(ev.some((e) => e.t === 'combo' && e.kinds.includes('hitsubo'))).toBe(true)
    expect(b.movesLeft).toBe(19)
  })

  it('星珠+銛で最多色が銛に変換され誘爆する', () => {
    const b = new Board(plain())
    const rows = inert()
    setPieces(b, [rows[0], 'SV' + rows[1].slice(2), ...rows.slice(2)])
    const ev = b.swap({ x: 0, y: 1 }, { x: 1, y: 1 })
    const borns = ev.filter((e) => e.t === 'special-born' && e.piece.kind === 'harpoon')
    expect(borns.length).toBeGreaterThan(5) // 最多色ぶん変換
    expect(ev.filter((e) => e.t === 'special-fire').length).toBeGreaterThan(5)
  })
})

describe('障害物', () => {
  it('苔石2層は2回の隣接マッチで壊れゴール計上', () => {
    const layout = ['K.......', ...Array(7).fill('........')]
    const b = new Board(plain({ layout, goals: [{ type: 'kokeishi', count: 1 }] }))
    // 直接ダメージAPIで層剥がしを検証
    const ev: import('./types').BoardEvent[] = []
    b.damageBlock({ x: 0, y: 0 }, ev)
    expect(ev.some((e) => e.t === 'block-hit' && !e.destroyed)).toBe(true)
    b.damageBlock({ x: 0, y: 0 }, ev)
    expect(ev.some((e) => e.t === 'block-hit' && e.destroyed)).toBe(true)
    expect(b.goalDone[0]).toBe(1)
  })

  it('匣は壊すと陶片になり、陶片回収でゴール', () => {
    const layout = ['h.......', ...Array(7).fill('........')]
    const b = new Board(plain({ layout, goals: [{ type: 'touhen', count: 1 }] }))
    const ev: import('./types').BoardEvent[] = []
    b.damageBlock({ x: 0, y: 0 }, ev)
    expect(b.at(0, 0)?.block?.type).toBe('touhen')
    b.damageBlock({ x: 0, y: 0 }, ev)
    expect(b.at(0, 0)?.block).toBe(null)
    expect(b.goalDone[0]).toBe(1)
  })

  it('巣灯は隣接ヒットで胞子を排出し、胞子は毎手浮上して上端で回収', () => {
    const layout = [...Array(4).fill('........'), '...s....', ...Array(3).fill('........')]
    const b = new Board(plain({ layout, goals: [{ type: 'spore', count: 1 }], subiCharge: 1 }))
    const ev: import('./types').BoardEvent[] = []
    b.damageBlock({ x: 3, y: 4 }, ev)
    expect(ev.some((e) => e.t === 'spore-born')).toBe(true)
    // 胞子の位置を特定
    let sp: { x: number; y: number } | null = null
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.piece?.kind === 'spore') sp = { x, y }
    expect(sp).toBeTruthy()
    // 手を打つたびに1段ずつ上がる（不正手でも afterMove は走らないので、有効手を打つ代わりに内部APIで）
    let guard = 0
    while (b.goalDone[0] < 1 && guard++ < 12) {
      ;(b as unknown as { afterMove: (ev: unknown[]) => void }).afterMove([])
    }
    expect(b.goalDone[0]).toBe(1)
  })
})

describe('斜め落下（本家仕様）', () => {
  it('障害物の真下の空マスに斜め上から駒が供給される', () => {
    // (3,2)に苔石。 (3,3)を空にすると、垂直供給不可→斜め上(2,2)or(4,2)から滑り込む
    const layout = ['........', '........', '...k....', '........', '........', '........', '........', '........']
    const b = new Board(plain({ layout }))
    const c = b.at(3, 3)!
    c.piece = null
    const ev: import('./types').BoardEvent[] = []
    ;(b as unknown as { applyGravity: (e: unknown[]) => void }).applyGravity(ev)
    expect(b.at(3, 3)?.piece).toBeTruthy()
    expect(ev.some((e) => (e as { t: string }).t === 'fall')).toBe(true)
  })
})

describe('健全性', () => {
  it('初期盤面に即マッチが無く、有効手がある', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const b = new Board(plain({ seed }))
      expect(b.hasValidMove()).toBe(true)
      expect((b as unknown as { findRuns: () => unknown[] }).findRuns().length).toBe(0)
    }
  })

  it('ランダムプレイ50手で盤面が壊れない（駒欠落・詰みなし）', () => {
    const b = new Board(plain({ moves: 999, seed: 7 }))
    for (let i = 0; i < 50; i++) {
      // 有効手を探して打つ
      let done = false
      outer: for (let y = 0; y < H && !done; y++)
        for (let x = 0; x < W; x++) {
          for (const [dx, dy] of [
            [1, 0],
            [0, 1],
          ] as const) {
            const ev = b.swap({ x, y }, { x: x + dx, y: y + dy })
            if (ev.some((e) => e.t === 'swap' && !e.illegal)) {
              done = true
              break outer
            }
          }
        }
      expect(done).toBe(true)
      // 盤面検査：block/hole 以外の全マスに駒がある
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const c = b.at(x, y)
          if (c && !c.block) expect(c.piece).toBeTruthy()
        }
      expect(b.hasValidMove()).toBe(true)
    }
  })
})
