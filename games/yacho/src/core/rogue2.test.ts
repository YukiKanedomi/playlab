// ローグライク・ピボット第2弾（Rogue-MVP②）のエンジン層テスト。ROGUE.md §5/§6 準拠。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { bossBodyCells, type EnemyInstance } from './enemies'
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

/** 盤面を単色駒で埋める（岩殻獣/胞子獣/環境効果テストの候補セルを1つだけに固定するため） */
function fillAll(b: Board, color: 0 | 1 | 2 | 3 | 4) {
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.at(x, y)!.piece = { kind: 'normal', color }
}

// private メソッドへのアクセス用（rogue.test.tsと同じ流儀：Boardとは交差させず、`b as unknown as Priv`で使う）
interface Priv {
  clearPieceAt: (p: XY, ev: BoardEvent[]) => void
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[]) => void
  rockshellAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  sporelingAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  burrowerAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  tickSeals: (ev: BoardEvent[]) => void
  tickEnvironment: (ev: BoardEvent[]) => void
  bossPeriodicAttack: (e: EnemyInstance, ev: BoardEvent[]) => void
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  checkSporeTouch: (at: XY, ev: BoardEvent[]) => void
  explodeAt: (at: XY, ev: BoardEvent[], opts?: { radius?: number; shape?: 'cross' | 'square' }) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('敵ダメージ経路：マッチ隣接', () => {
  it('身体セルに隣接するマッチはマッチ駒数ぶんダメージを与える', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, ['01003131', ...inert().slice(1)])
    const e = b.spawnEnemy('rockshell', [{ x: 2, y: 1 }]) // (2,0)の3連に隣接
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(3) // x1..x3の3個同時消滅
    expect(e.hp).toBe(8 - 3)
  })
})

describe('敵ダメージ経路：爆発', () => {
  it('爆発が敵の身体セルを直接巻き込むと3ダメージ', () => {
    // マッチ隣接ダメージ（マッチ駒数ぶん）と混ざらないよう、爆発そのものを直接発火して検証する
    // （爆発鉱石は必ずマッチの一員として爆発するため、爆発中心の隣接セルは同時にdamageAroundの対象にもなる）
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('sporeling', [{ x: 4, y: 4 }])
    const ev: BoardEvent[] = []
    priv(b).explodeAt({ x: 4, y: 3 }, ev, { radius: 1, shape: 'cross' })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(3)
    expect(e.hp).toBe(6 - 3)
  })
})

describe('敵ダメージ経路：特殊駒の効果線', () => {
  it('特殊駒の効果線が敵の身体セルを通ると1ダメージ', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    const e = b.spawnEnemy('burrower', [{ x: 5, y: 3 }]) // 同じ行を横銛が通過
    const ev = b.tap({ x: 0, y: 3 })
    const dmg = ev.find((x) => x.t === 'enemy-damage')
    expect(dmg && dmg.t === 'enemy-damage' ? dmg.amount : -1).toBe(1)
    expect(e.hp).toBe(10 - 1)
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

describe('毒胞子でHP減（胞子獣）', () => {
  it('定期行動は植物1駒を毒胞子化する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    fillAll(b, 2) // 植物(色1/4)候補を(4,4)だけに絞る
    b.at(4, 4)!.piece = { kind: 'normal', color: 1 }
    const e = b.spawnEnemy('sporeling', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).sporelingAction(e, ev)
    expect(ev.some((x) => x.t === 'spore-poisoned')).toBe(true)
    expect(b.at(4, 4)?.poisonSpore).toBe(true)
  })

  it('毒胞子化した駒を消すとプレイヤーHPが1減る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(2, 2)!.piece = { kind: 'normal', color: 1 }
    b.at(2, 2)!.poisonSpore = true
    const before = run.playerHp
    const ev: BoardEvent[] = []
    priv(b).clearPieceAt({ x: 2, y: 2 }, ev)
    expect(run.playerHp).toBe(before - 1)
    expect(ev.some((x) => x.t === 'poison-triggered')).toBe(true)
  })
})

describe('穴封鎖の期限切れ（穴潜み）', () => {
  it('定期行動は空きセルを2ターン封鎖し、自身は別の空きセルへ移動する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(1, 1)!.piece = null
    b.at(6, 6)!.piece = null
    const e = b.spawnEnemy('burrower', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).burrowerAction(e, ev)
    expect(ev.some((x) => x.t === 'cell-sealed')).toBe(true)
    expect(b.at(0, 0)?.block).toBeNull() // 元の位置は解放される
  })

  it('封鎖セルは2ターンで自動解除される', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 0)!.piece = null
    b.at(0, 0)!.block = { type: 'seal', turnsLeft: 2 }
    let ev: BoardEvent[] = []
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
  it('累計5ダメージごとに1行後退し、身体最上段が解放される', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('boss', bossBodyCells(H - 2, H - 1, W))
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(e.id, 5, ev)
    expect(ev.some((x) => x.t === 'boss-retreat')).toBe(true)
    expect(b.at(0, H - 2)?.block).toBeNull() // 最上段が解放された
    expect(b.at(0, H - 1)?.block).toEqual({ type: 'enemy', enemyId: e.id }) // 最下段は残る
    expect(e.hp).toBe(30 - 5)
  })

  it('3ターンごとに全体攻撃でプレイヤーHPが3減る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('boss', bossBodyCells(H - 2, H - 1, W))
    const ev: BoardEvent[] = []
    priv(b).bossPeriodicAttack(e, ev)
    priv(b).bossPeriodicAttack(e, ev)
    expect(run.playerHp).toBe(20) // まだ発動しない
    priv(b).bossPeriodicAttack(e, ev)
    expect(run.playerHp).toBe(17)
    expect(ev.some((x) => x.t === 'boss-slam')).toBe(true)
  })
})

describe('環境：菌糸層', () => {
  it('3ターンごとに植物駒が隣接する空きセルへ増殖する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run, { floor: 1, enemies: [], env: 'fungal' })
    fillAll(b, 3) // 植物(色1/4)候補を(3,3)だけに絞る
    b.at(3, 3)!.piece = { kind: 'normal', color: 1 }
    b.at(3, 2)!.piece = null // 唯一の増殖先候補
    let ev: BoardEvent[] = []
    priv(b).tickEnvironment(ev)
    priv(b).tickEnvironment(ev)
    expect(ev.some((x) => x.t === 'env-grow')).toBe(false)
    ev = []
    priv(b).tickEnvironment(ev)
    expect(ev.some((x) => x.t === 'env-grow')).toBe(true)
  })
})

describe('環境：結晶洞', () => {
  it('3ターンごとに鉱物駒が隣接する空きセルへ成長する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run, { floor: 1, enemies: [], env: 'crystal' })
    fillAll(b, 3) // 鉱物(色2)候補を(3,3)だけに絞る
    b.at(3, 3)!.piece = { kind: 'normal', color: 2 }
    b.at(3, 2)!.piece = null // 唯一の増殖先候補
    let ev: BoardEvent[] = []
    priv(b).tickEnvironment(ev)
    priv(b).tickEnvironment(ev)
    ev = []
    priv(b).tickEnvironment(ev)
    const grown = ev.find((x) => x.t === 'env-grow')
    expect(grown && grown.t === 'env-grow' ? grown.kind : null).toBe('mineral')
  })
})

describe('層クリア判定', () => {
  it('層内の敵を全滅させるとfloor-clearイベントが一度だけ発生する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e1 = b.spawnEnemy('rockshell', [{ x: 0, y: 0 }])
    const e2 = b.spawnEnemy('sporeling', [{ x: 1, y: 0 }])
    let ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(e1.id, 8, ev)
    expect(ev.some((x) => x.t === 'floor-clear')).toBe(false) // e2がまだ残っている
    ev = []
    priv(b).dealEnemyDamage(e2.id, 6, ev)
    expect(ev.some((x) => x.t === 'floor-clear')).toBe(true)
  })
})

describe('ラン終了判定', () => {
  it('プレイヤーHPが0以下になるとrun-overイベントが出る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    run.playerHp = 0
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
    expect(e.hp).toBeLessThan(8)
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
    expect(e.hp).toBe(6 - 3)
  })
})

describe('runなしBoardの互換性', () => {
  it('run未指定なら敵関連イベントは一切発生しない', () => {
    const b = new Board(plain())
    setPieces(b, ['01003131', ...inert().slice(1)])
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.some((x) => x.t === 'enemy-damage' || x.t === 'floor-clear' || x.t === 'run-over')).toBe(false)
    expect(b.enemies.length).toBe(0)
  })
})
