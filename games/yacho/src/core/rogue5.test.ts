// ローグライク第5波（ROGUE2.md §1原則1／コンサル[E]4）のエンジン層テスト。
// 「胞子を共有語彙にするなら、胞子そのものに小さな基礎価値が必要」への根治対応。
// A=胞子の基礎効果（強化ゼロでも隣接駒1つが植物に変わる） B=基礎効果とsporeTouchフックの併存
// C=#18胞子弾が爆発鉱石の爆発でも発火 D=#14模倣の粘菌が強化ゼロでも特殊駒効果をコピー
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState } from './run'
import { MIMIC_SLIME_ID, SPORE_BULLET_ID } from './upgrades'
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

/** rogue.test.ts と同じ流儀のテスト用盤面組み立て（v=爆発鉱石を追加） */
function setPieces(b: Board, rows: string[]) {
  const map: Record<string, Piece | null> = {
    '.': null,
    '0': { kind: 'normal', color: 0 },
    '1': { kind: 'normal', color: 1 },
    '2': { kind: 'normal', color: 2 },
    '3': { kind: 'normal', color: 3 },
    '4': { kind: 'normal', color: 4 },
    v: { kind: 'normal', color: 2, volatile: true },
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = structuredClone(map[rows[y][x]]) ?? null
    }
}

/** 市松で絶対にマッチしない充填（色4は未使用なので自由に使える） */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

/** 盤面を単色駒で埋める */
function fillAll(b: Board, color: 0 | 1 | 2 | 3 | 4) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.at(x, y)!.piece = { kind: 'normal', color }
}

interface Priv {
  checkSporeTouch: (at: XY, ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('胞子の基礎効果（第5波・原則1）', () => {
  it('強化を一つも持っていなくても、胞子が消費されると隣接する駒1つが植物に変わる', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    fillAll(b, 2) // 全て鉱物(色2)で統一。植物(色1/4)は盤上に存在しない状態から始める
    b.at(3, 3)!.sporeToken = true
    const ev: BoardEvent[] = []
    // 胞子(3,3)に隣接する(4,3)の駒が消えた、という想定で基礎効果を起動する
    priv(b).checkSporeTouch({ x: 4, y: 3 }, ev)
    expect(ev.some((e) => e.t === 'token-consumed')).toBe(true)
    // 固定順（右→左→下→上）で最初に見つかる胞子の隣接駒＝(4,3)が植物に変わる
    const changed = b.at(4, 3)?.piece
    expect(changed?.kind === 'normal' && (changed.color === 1 || changed.color === 4)).toBe(true)
    // 他の隣接駒(2,3)は無関係のまま＝「1つだけ」変わる
    expect(b.at(2, 3)?.piece).toEqual({ kind: 'normal', color: 2 })
  })
})

describe('胞子の基礎効果とsporeTouchフックの併存（第5波）', () => {
  it('根食い鉱を持つ場合、フックの鉱物化と基礎効果の植物化が両方起きる（互いを上書きしない）', () => {
    const run = createRunState(['root-eating-ore'])
    const b = new Board(plain(), run)
    fillAll(b, 3) // 全て遺物(色3)で統一。根食い鉱の対象となる鉱物(色2)は(3,2)だけに絞る
    b.at(3, 3)!.sporeToken = true
    b.at(3, 2)!.piece = { kind: 'normal', color: 2 }
    const ev: BoardEvent[] = []
    priv(b).checkSporeTouch({ x: 4, y: 3 }, ev)
    // フック効果：ねらった鉱物(3,2)が爆発鉱石に変わる（基礎効果に上書きされていない）
    expect(b.at(3, 2)?.piece).toEqual({ kind: 'normal', color: 2, volatile: true })
    // 基礎効果：フックが触れていない別の隣接マス(4,3)が植物に変わる
    const changed = b.at(4, 3)?.piece
    expect(changed?.kind === 'normal' && (changed.color === 1 || changed.color === 4)).toBe(true)
  })

  it('毒胞子を持つ場合、フックの敵ダメージと基礎効果の植物化が両方起きる', () => {
    const run = createRunState(['toxic-spore'])
    const b = new Board(plain(), run)
    fillAll(b, 3)
    b.at(3, 3)!.sporeToken = true
    const enemy = b.spawnEnemy('swarm', [{ x: 5, y: 3 }]) // at=(4,3)の隣接（毒胞子の敵探索範囲）
    const ev: BoardEvent[] = []
    priv(b).checkSporeTouch({ x: 4, y: 3 }, ev)
    expect(ev.some((e) => e.t === 'enemy-damage' && e.id === enemy.id)).toBe(true)
    const changed = b.at(4, 3)?.piece
    expect(changed?.kind === 'normal' && (changed.color === 1 || changed.color === 4)).toBe(true)
  })
})

describe('胞子弾（#18 新仕様）', () => {
  it('爆発鉱石の爆発でも胞子が残る（歯車爆弾だけに依存せず単体で回る）', () => {
    const run = createRunState([SPORE_BULLET_ID])
    const b = new Board(plain(), run)
    // rogue.test.ts「爆発鉱石」テストと同型のレイアウト（爆発鉱石を含むマッチ→爆発）
    setPieces(b, ['21v23131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((e) => e.t === 'explode')).toBe(true)
    expect(ev.some((e) => e.t === 'token-spawn')).toBe(true)
    expect(ev.some((e) => e.t === 'upgrade-fire' && e.id === SPORE_BULLET_ID)).toBe(true)
  })
})

describe('模倣の粘菌（#14 新仕様）', () => {
  it('強化ゼロ（自分以外の強化を持たない）でも、直前に発動した特殊駒効果を再現する', () => {
    const run = createRunState([MIMIC_SLIME_ID])
    const b = new Board(plain(), run)
    // row0：遺物(色3)の完成済み3連（cols0-2）。まだ解決されていない状態で盤面に置く。
    // cols3-7は互いに隣接しない値にして余計なマッチを作らない。
    setPieces(b, ['33301010', ...inert().slice(1)])
    // 縦銛（列消し）を(7,4)に配置し、隣接する通常駒(6,4)とのスワップで即発動させる
    b.at(7, 4)!.piece = { kind: 'harpoon', dir: 'v' }
    const ev = b.swap({ x: 6, y: 4 }, { x: 7, y: 4 })
    const fires = ev.filter((e) => e.t === 'special-fire')
    // 1回目＝銛の本発動、2回目＝模倣の粘菌が「直前の特殊駒効果」として再現した分
    expect(fires.length).toBeGreaterThanOrEqual(2)
    expect(ev.some((e) => e.t === 'upgrade-fire' && e.id === MIMIC_SLIME_ID)).toBe(true)
    // 遺物3連がちゃんと処理されている（模倣の粘菌の発動条件）ことも確認
    expect(ev.some((e) => e.t === 'match' && e.color === 3)).toBe(true)
  })
})

describe('暴走対策：胞子の基礎効果が連鎖しても無限ループしない', () => {
  it('胞子繁殖×根食い鉱×共振破砕のビルドで連鎖が起きても、有限のイベント数で解決が終わる', () => {
    const run = createRunState(['spore-bloom', 'root-eating-ore', 'resonant-shatter'])
    const b = new Board(plain(), run)
    // rogue.test.ts「胞子繁殖」テストと同型のレイアウト（4連マッチ→胞子繁殖が発火）
    setPieces(b, ['24144313', '32421431', ...inert().slice(2)])
    // 周囲に鉱物(色2)を足し、根食い鉱（胞子タッチ→鉱物を爆発鉱石化）の材料を厚くする
    b.at(1, 2)!.piece = { kind: 'normal', color: 2 }
    b.at(5, 2)!.piece = { kind: 'normal', color: 2 }
    const ev = b.swap({ x: 2, y: 1 }, { x: 2, y: 0 })
    // vitestの既定タイムアウト内にこの行へ到達している時点で無限ループしていないことの証拠。
    // 加えて、実際に基礎効果＋フックの連鎖が起きたこと（活動があったこと）も確認する。
    expect(ev.some((e) => e.t === 'match')).toBe(true)
    expect(ev.some((e) => e.t === 'token-spawn')).toBe(true) // 胞子繁殖が発火した証拠
    expect(ev.some((e) => e.t === 'token-consumed')).toBe(true) // 胞子の基礎効果/根食い鉱が消費した証拠
    expect(Number.isFinite(ev.length)).toBe(true)
  })
})
