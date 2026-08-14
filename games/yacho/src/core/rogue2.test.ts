// ローグライク・ピボット第2弾（Rogue-MVP②）のエンジン層テスト。SPEC_OXYGEN.md §1.3/§1.4 準拠へ更新。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { bossBodyCells, type EnemyInstance } from './enemies'
import { createRunState, OXYGEN_START, OXYGEN_SUPPLY_PER_FLOOR } from './run'
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

/** 盤面を単色駒で埋める（岩殻獣/喰み蟲テストの候補セルを1つだけに固定するため） */
function fillAll(b: Board, color: 0 | 1 | 2 | 3 | 4) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.at(x, y)!.piece = { kind: 'normal', color }
}

// private メソッドへのアクセス用（rogue.test.tsと同じ流儀：Boardとは交差させず、`b as unknown as Priv`で使う）
interface Priv {
  clearPieceAt: (p: XY, ev: BoardEvent[]) => void
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[], heavy?: boolean) => void
  rockshellAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  harvesterAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  diggerAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  tickSeals: (ev: BoardEvent[]) => void
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  checkSporeTouch: (at: XY, ev: BoardEvent[]) => void
  explodeAt: (at: XY, ev: BoardEvent[], opts?: { radius?: number; shape?: 'cross' | 'square' }) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('敵ダメージ経路：マッチ隣接', () => {
  it('3個マッチは1ダメージしか入らない（SPEC_OXYGEN §1.3）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, ['01003131', ...inert().slice(1)])
    const e = b.spawnEnemy('rockshell', [{ x: 2, y: 1 }]) // (2,0)の3連に隣接
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(1) // 3個マッチは減衰して1
    expect(e.hp).toBe(6 - 1)
  })

  it('4個以上のマッチはマッチ駒数ぶんダメージを与える（heavy な一撃）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    // 縦の 2+1 を1手でつないで x=7 の4連にする（事前にマッチが成立していない形にする）
    b.at(7, 0)!.piece = { kind: 'normal', color: 0 }
    b.at(7, 1)!.piece = { kind: 'normal', color: 0 }
    b.at(7, 2)!.piece = { kind: 'normal', color: 1 }
    b.at(7, 3)!.piece = { kind: 'normal', color: 0 }
    b.at(6, 2)!.piece = { kind: 'normal', color: 0 }
    b.spawnEnemy('rockshell', [{ x: 6, y: 1 }]) // (7,1)の4連に隣接
    const ev = b.swap({ x: 6, y: 2 }, { x: 7, y: 2 })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(4)
  })
})

describe('敵ダメージ経路：爆発', () => {
  it('爆発が敵の身体セルを直接巻き込むと3ダメージ', () => {
    // マッチ隣接ダメージと混ざらないよう、爆発そのものを直接発火して検証する
    // （爆発鉱石は必ずマッチの一員として爆発するため、爆発中心の隣接セルは同時にdamageAroundの対象にもなる）
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('sporeling', [{ x: 4, y: 4 }])
    const ev: BoardEvent[] = []
    priv(b).explodeAt({ x: 4, y: 3 }, ev, { radius: 1, shape: 'cross' })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(3)
    expect(e.hp).toBe(5 - 3)
  })
})

describe('敵ダメージ経路：特殊駒の効果線', () => {
  it('特殊駒の効果線が敵の身体セルを通ると2ダメージ', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    const e = b.spawnEnemy('burrower', [{ x: 5, y: 3 }]) // 同じ行を横銛が通過
    const ev = b.tap({ x: 0, y: 3 })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(2)
    expect(e.hp).toBe(6 - 2)
  })
})

describe('甲殻付与と追加破壊（岩殻獣）', () => {
  it('定期行動は鉱物1つに甲殻を付与する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    fillAll(b, 3) // 鉱物(色2)候補を(4,4)だけに絞る
    b.at(4, 4)!.piece = { kind: 'normal', color: 2 }
    const e = b.spawnEnemy('rockshell', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).rockshellAction(e, ev)
    expect(ev.some((x) => x.t === 'armor-applied')).toBe(true)
    expect(b.at(4, 4)?.armored).toBe(true)
  })

  it('甲殻セルは1回目の破壊では駒が残り、2回目で実際に消える', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(3, 3)!.piece = { kind: 'normal', color: 2 }
    b.at(3, 3)!.armored = true
    const ev1: BoardEvent[] = []
    priv(b).clearPieceAt({ x: 3, y: 3 }, ev1)
    expect(ev1.some((x) => x.t === 'armor-broken')).toBe(true)
    expect(b.at(3, 3)?.piece).toEqual({ kind: 'normal', color: 2 }) // まだ消えていない
    const ev2: BoardEvent[] = []
    priv(b).clearPieceAt({ x: 3, y: 3 }, ev2)
    expect(b.at(3, 3)?.piece).toBeNull()
  })
})

describe('捕食印（喰み蟲）', () => {
  it('定期行動は資源1駒に捕食印をつける', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    fillAll(b, 3)
    // 充填ギア/爆発鉱石/胞子は優先候補（prefer）。1つだけ置いて印の落ち先を固定する
    b.at(4, 4)!.piece = { kind: 'normal', color: 1, charged: true }
    const e = b.spawnEnemy('sporeling', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).harvesterAction(e, ev)
    expect(ev.some((x) => x.t === 'prey-marked')).toBe(true)
    expect(b.at(4, 4)?.preyMark).toBe(true)
    expect(e.markAt).toEqual({ x: 4, y: 4 })
  })
})

describe('崩落予告と封鎖（裂坑掘り）', () => {
  it('1回目の定期行動は崩落を予告するだけで、まだ封鎖しない', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('burrower', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).diggerAction(e, ev)
    expect(ev.some((x) => x.t === 'fissure-telegraph')).toBe(true)
    expect(ev.some((x) => x.t === 'cell-sealed')).toBe(false)
    expect(e.telegraph?.length).toBe(4)
  })

  it('2回目の定期行動で予告の2x2を3手ぶん封鎖し、自身は空きセルへ移動する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(7, 0)!.piece = null // 移動先の空きセルを1つだけ用意する
    const e = b.spawnEnemy('burrower', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).diggerAction(e, ev) // 予告
    priv(b).diggerAction(e, ev) // 崩落＋移動
    const sealed = ev.filter((x) => x.t === 'cell-sealed')
    expect(sealed.length).toBeGreaterThan(0)
    expect(sealed.every((x) => x.t === 'cell-sealed' && x.turns === 3)).toBe(true)
    expect(b.at(0, 0)?.block).toBeNull() // 元の位置は解放される
    expect(e.cells).toEqual([{ x: 7, y: 0 }])
  })

  it('封鎖セルは3ターンで自動解除される', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 0)!.piece = null
    b.at(0, 0)!.block = { type: 'seal', turnsLeft: 3 }
    let ev: BoardEvent[] = []
    priv(b).tickSeals(ev)
    priv(b).tickSeals(ev)
    expect(b.at(0, 0)?.block).toEqual({ type: 'seal', turnsLeft: 1 })
    expect(ev.some((x) => x.t === 'cell-unsealed')).toBe(false)
    ev = []
    priv(b).tickSeals(ev)
    expect(b.at(0, 0)?.block).toBeNull()
    expect(ev.some((x) => x.t === 'cell-unsealed')).toBe(true)
  })
})

describe('ボス', () => {
  it('3ターンごとに酸素を3奪う', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    b.spawnEnemy('boss', bossBodyCells(H - 1, H - 1, W))
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    priv(b).resolveEnemyTurn(ev)
    expect(run.oxygen).toBe(OXYGEN_START) // まだ発動しない
    priv(b).resolveEnemyTurn(ev)
    const drained = ev.find((x) => x.t === 'oxygen-drained')
    expect(drained && drained.t === 'oxygen-drained' ? drained.amount : -1).toBe(3)
    expect(run.oxygen).toBe(OXYGEN_START - 3)
  })
})

describe('層クリア判定', () => {
  it('enemy-kill目標を満たすとfloor-clearと補給が対で一度だけ出る', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'enemy-kill', count: 2 }] }), run)
    const e1 = b.spawnEnemy('rockshell', [{ x: 0, y: 0 }])
    const e2 = b.spawnEnemy('sporeling', [{ x: 6, y: 0 }])
    let ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(e1.id, 6, ev)
    priv(b).resolveEnemyTurn(ev) // 発火口は checkFloorClear のみ（dealEnemyDamage からは出ない）
    expect(ev.some((x) => x.t === 'floor-clear')).toBe(false) // e2がまだ残っている
    ev = []
    const before = run.oxygen
    priv(b).dealEnemyDamage(e2.id, 5, ev)
    priv(b).resolveEnemyTurn(ev)
    expect(ev.filter((x) => x.t === 'floor-clear').length).toBe(1)
    const refill = ev.find((x) => x.t === 'oxygen-refill')
    expect(refill && refill.t === 'oxygen-refill' ? refill.amount : -1).toBe(OXYGEN_SUPPLY_PER_FLOOR)
    expect(run.oxygen).toBe(before + OXYGEN_SUPPLY_PER_FLOOR)
    const ev2: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev2)
    expect(ev2.some((x) => x.t === 'floor-clear')).toBe(false) // 2回目は出ない
  })
})

describe('ラン終了判定', () => {
  it('酸素が0以下になるとrun-overイベントが出る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    run.oxygen = 0
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    expect(ev.some((x) => x.t === 'run-over')).toBe(true)
  })
})

describe('フック接続：damageEnemy', () => {
  it('採掘慣れ(#7)：鉱物マッチで最も近い敵にダメージが入る（no-op解消）', () => {
    const run = createRunState(['mining-habit'])
    const b = new Board(plain(), run)
    setPieces(b, ['21223131', ...inert().slice(1)])
    const e = b.spawnEnemy('rockshell', [{ x: 7, y: 7 }])
    b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(e.hp).toBeLessThan(6) // 岩殻獣の最大HPは6（無傷なら6のまま）
  })

  it('毒胞子(#3)：胞子トークンが敵に隣接して消費されるとダメージが入る（no-op解消）', () => {
    const run = createRunState(['toxic-spore'])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('sporeling', [{ x: 5, y: 2 }])
    b.at(4, 3)!.sporeToken = true
    const ev: BoardEvent[] = []
    priv(b).checkSporeTouch({ x: 4, y: 2 }, ev)
    expect(ev.some((x) => x.t === 'token-consumed')).toBe(true)
    expect(e.hp).toBe(5 - 3)
  })
})

describe('runなしBoardの互換性', () => {
  it('run未指定なら敵・酸素・目標のローグ拡張イベントは一切発生しない', () => {
    const b = new Board(plain())
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(
      ev.some(
        (x) =>
          x.t === 'enemy-damage' ||
          x.t === 'floor-clear' ||
          x.t === 'run-over' ||
          x.t === 'oxygen-spent' ||
          x.t === 'oxygen-refill',
      ),
    ).toBe(false)
    expect(b.enemies.length).toBe(0)
    // 目標の前進は run 非依存（旧30レベル制もこの経路を使う）ので、こちらは run 無しでも出る
    expect(ev.some((x) => x.t === 'goal-progress')).toBe(true)
  })
})
