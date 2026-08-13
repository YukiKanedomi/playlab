// 夜間監査(codex_audit_night.md)[B][D]6対応：発火が連鎖を生まない問題のエンジン層テスト。
// 主因（最終報告参照）：植物/鉱物/遺物マッチ→生成/変換フックの生成位置が「マッチ跡地自身（自己参照・
// 直後に自然充填で上書きされる無駄なマス）」や「完全ランダム」で、新しいマッチにほぼ繋がらなかった。
// 修正：HookCtx.growthSpot/transformSpot（board.ts）で「マッチが即成立する近傍の空き/既存セル」を
// 決定的に探し、無ければ跡地自身を避けた最寄りセルへ後退する。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState } from './run'
import type { BoardEvent, LevelDef, Piece, XY } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** 隣接（横・縦・斜め方向いずれも）で絶対に3連が起きない充填：(x+y)%5 の巡回パターン */
function inert5(): string[] {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String((x + y) % 5)
    rows.push(r)
  }
  return rows
}

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

interface Priv {
  findGrowthSpot: (seedCells: XY[], color: number) => XY | null
  findTransformSpot: (seedCells: XY[], color: number) => XY | null
}
const priv = (b: Board) => b as unknown as Priv

describe('HookCtx.growthSpot（夜間監査[D]6：生成位置の決定）', () => {
  it('マッチ跡地自身（自己参照）より、マッチが即成立する外部の空きセルを優先する', () => {
    const b = new Board(plain())
    setPieces(b, inert5())
    // マッチ跡地（自己参照の空きセル）を(1,3)に用意
    b.at(1, 3)!.piece = null
    // 外部の空きセル(5,3)の左右(4,3)(6,3)を色1にしておく → (5,3)へ色1を置けば横3連が即成立
    b.at(4, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(6, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(5, 3)!.piece = null

    const spot = priv(b).findGrowthSpot([{ x: 1, y: 3 }], 1)
    expect(spot).toEqual({ x: 5, y: 3 })
  })

  it('マッチ形成先が無ければ、跡地自身を避けた最寄りの空きセルへ後退する', () => {
    const b = new Board(plain())
    setPieces(b, inert5())
    b.at(1, 3)!.piece = null // 跡地（自己参照）
    b.at(2, 3)!.piece = null // 跡地の隣：外部だがマッチは作らない、これが選ばれるはず
    const spot = priv(b).findGrowthSpot([{ x: 1, y: 3 }], 1)
    expect(spot).toEqual({ x: 2, y: 3 })
    expect(spot).not.toEqual({ x: 1, y: 3 })
  })
})

describe('HookCtx.transformSpot（夜間監査[D]6：変換位置の決定）', () => {
  it('マッチが即成立する既存駒（色違い）を優先して選ぶ', () => {
    const b = new Board(plain())
    setPieces(b, inert5())
    // (5,3)を色2にしておき、その両隣(4,3)(6,3)を色1にする → (5,3)を色1へ変換すれば横3連が即成立
    b.at(4, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(5, 3)!.piece = { kind: 'normal', color: 2 }
    b.at(6, 3)!.piece = { kind: 'normal', color: 1 }
    const spot = priv(b).findTransformSpot([{ x: 4, y: 3 }], 1)
    expect(spot).toEqual({ x: 5, y: 3 })
  })
})

describe('植物マッチ→菌糸の目覚めが同じ解決内で二段目のマッチを起こす（夜間監査[B]の再現テスト）', () => {
  it('菌糸の目覚め所持時、植物マッチの跡地近くに用意した2連へ植物が生えて連鎖段が2になる', () => {
    const run = createRunState(['fungal-awakening'])
    const b = new Board(plain(), run)
    setPieces(b, inert5())
    // 横3連(0,3)(1,3)(2,3)=色1をswapで作る（(3,3)の色1を(2,3)へ動かす）
    b.at(0, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(1, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(2, 3)!.piece = { kind: 'normal', color: 4 } // swap前は非マッチ
    b.at(3, 3)!.piece = { kind: 'normal', color: 1 } // これを(2,3)へ動かす
    // マッチ跡地から少し離れた場所(4,3)(6,3)=色1、(5,3)を空けておく → 生え先候補
    b.at(4, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(5, 3)!.piece = null
    b.at(6, 3)!.piece = { kind: 'normal', color: 1 }

    const ev = b.swap({ x: 3, y: 3 }, { x: 2, y: 3 })
    expect(b.chain).toBeGreaterThanOrEqual(2)
    const matchChains = ev.filter((e): e is Extract<BoardEvent, { t: 'match' }> => e.t === 'match').map((e) => e.chain)
    expect(Math.max(...matchChains)).toBeGreaterThanOrEqual(2)
    // 生成された植物が跡地自身(0,3)(1,3)(2,3)ではなく外部の(5,3)であること
    const born = ev.find((e) => e.t === 'special-born' && e.at.x === 5 && e.at.y === 3)
    expect(born).toBeTruthy()
  })
})
