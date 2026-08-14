// 敵6種の最終仕様（SPEC_OXYGEN.md §1.3 / §1.4 / §9.4）のエンジン層テスト。
// 「小さい一撃は効かない」「妨害屋は酸素を奪わない」「予告は必ず外せる」の3点が核。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { bossBodyCells, BOSS_SHELL_COUNT, enemyIntent, ENEMY_HP, type EnemyInstance } from './enemies'
import { FLOORS, type FloorDef } from './floors'
import { createRunState, OXYGEN_START } from './run'
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

/** 市松で絶対にマッチしない充填（resolveEnemyTurn を挟まないテスト専用。挟むと詰み回避のリロールが走る） */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

/** FloorDef の目標・レイアウトをそのまま LevelDef へ流す（main.ts の buildFloorLevelDef と同じ形） */
const levelOf = (def: FloorDef, seed = 42): LevelDef => ({
  id: def.floor,
  seed,
  moves: 9999,
  colors: 5,
  goals: def.goals,
  layout: def.layout,
})

interface Priv {
  clearPieceAt: (p: XY, ev: BoardEvent[]) => void
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[], heavy?: boolean) => void
  damageAround: (cells: XY[], ev: BoardEvent[], enemyDmg?: number, heavy?: boolean) => void
  harvesterAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  diggerAction: (e: EnemyInstance, ev: BoardEvent[]) => void
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  beginResolve: () => void
  fireSpecial: (at: XY, p: Piece, ev: BoardEvent[], combo?: Piece) => void
}
const priv = (b: Board) => b as unknown as Priv

const firstDamage = (ev: BoardEvent[]) => {
  const d = ev.find((e) => e.t === 'enemy-damage')
  return d && d.t === 'enemy-damage' ? d.amount : -1
}

describe('ダメージ規則（SPEC_OXYGEN §1.3）', () => {
  it('3個マッチぶんの隣接ダメージは1、4個マッチぶんは4', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('rockshell', [{ x: 4, y: 4 }])
    const ev3: BoardEvent[] = []
    priv(b).damageAround([{ x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], ev3, 1, false)
    expect(firstDamage(ev3)).toBe(1)
    expect(e.hp).toBe(ENEMY_HP.rockshell - 1)
    const ev4: BoardEvent[] = []
    priv(b).damageAround([{ x: 1, y: 3 }, { x: 2, y: 3 }, { x: 3, y: 3 }, { x: 4, y: 3 }], ev4, 4, true)
    expect(firstDamage(ev4)).toBe(4)
    expect(e.hp).toBe(ENEMY_HP.rockshell - 5)
  })

  it('heavy は damageAround 経由で伝播条件まで通る（swarm の道連れ）', () => {
    const run = createRunState([])
    const soft = new Board(plain(), run)
    setPieces(soft, inert())
    soft.spawnEnemy('swarm', [{ x: 4, y: 4 }])
    soft.spawnEnemy('swarm', [{ x: 5, y: 4 }])
    priv(soft).damageAround([{ x: 4, y: 3 }], [], 2, false) // 撃破はするが heavy ではない
    expect(soft.enemies.length).toBe(1)

    const hard = new Board(plain(), createRunState([]))
    setPieces(hard, inert())
    hard.spawnEnemy('swarm', [{ x: 4, y: 4 }])
    hard.spawnEnemy('swarm', [{ x: 5, y: 4 }])
    priv(hard).damageAround([{ x: 4, y: 3 }], [], 2, true)
    expect(hard.enemies.length).toBe(0) // 隣も道連れ
  })
})

describe('喰み蟲（sporeling）', () => {
  /** 捕食印の落ち先を1マスに固定した盤面（充填ギア/爆発鉱石/胞子は prefer 候補） */
  const pinnedBoard = () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(4, 4)!.piece = { kind: 'normal', color: 1, charged: true }
    const e = b.spawnEnemy('sporeling', [{ x: 0, y: 0 }])
    return { run, b, e }
  }

  it('2手ごとに動き、印→捕食の順で駒を食べてHPが2回復する', () => {
    const { b, e } = pinnedBoard()
    priv(b).dealEnemyDamage(e.id, 2, []) // HP5→3（回復ぶんが見えるように削っておく）
    expect(e.hp).toBe(3)
    const ev1: BoardEvent[] = []
    priv(b).harvesterAction(e, ev1)
    expect(ev1.some((x) => x.t === 'prey-marked')).toBe(true)
    expect(b.at(4, 4)?.preyMark).toBe(true)
    const ev2: BoardEvent[] = []
    priv(b).harvesterAction(e, ev2)
    const dev = ev2.find((x) => x.t === 'prey-devoured')
    expect(dev && dev.t === 'prey-devoured' ? dev.hpLeft : -1).toBe(5)
    expect(b.at(4, 4)?.piece).toBeNull() // 食べられた駒は消える
    expect(b.at(4, 4)?.preyMark).toBeFalsy()
    expect(e.markAt).toBeNull()
  })

  it('周期は2手（敵ターン2回目で印が付く）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run) // 詰み回避のリロールが走らないよう既定の初期盤面を使う
    b.spawnEnemy('sporeling', [{ x: 0, y: 0 }])
    const ev1: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev1)
    expect(ev1.some((x) => x.t === 'prey-marked')).toBe(false)
    const ev2: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev2)
    expect(ev2.some((x) => x.t === 'prey-marked')).toBe(true)
  })

  it('印の駒そのものを消すと追い払える（1ダメージ＋周期リセット）', () => {
    const { b, e } = pinnedBoard()
    priv(b).harvesterAction(e, [])
    e.actionTimer = 5
    const ev: BoardEvent[] = []
    priv(b).clearPieceAt({ x: 4, y: 4 }, ev)
    expect(ev.some((x) => x.t === 'prey-escaped')).toBe(true)
    expect(e.hp).toBe(ENEMY_HP.sporeling - 1)
    expect(e.markAt).toBeNull()
    expect(e.actionTimer).toBe(0)
  })

  it('印の「となり」を消しても解除されない（その1マスを狙わせる）', () => {
    const { b, e } = pinnedBoard()
    priv(b).harvesterAction(e, [])
    const ev: BoardEvent[] = []
    priv(b).clearPieceAt({ x: 3, y: 4 }, ev)
    expect(ev.some((x) => x.t === 'prey-escaped')).toBe(false)
    expect(e.markAt).toEqual({ x: 4, y: 4 })
    expect(b.at(4, 4)?.preyMark).toBe(true)
  })
})

describe('裂坑掘り（burrower）', () => {
  it('予告→崩落（seal 3手）→移動 の順で動く', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(7, 0)!.piece = null // 移動先の空きセルを1つだけ用意する
    const e = b.spawnEnemy('burrower', [{ x: 0, y: 0 }])
    const ev1: BoardEvent[] = []
    priv(b).diggerAction(e, ev1)
    const tel = ev1.find((x) => x.t === 'fissure-telegraph')
    expect(tel && tel.t === 'fissure-telegraph' ? tel.cells.length : 0).toBe(4)
    const ev2: BoardEvent[] = []
    priv(b).diggerAction(e, ev2)
    const sealed = ev2.filter((x) => x.t === 'cell-sealed')
    expect(sealed.length).toBe(4)
    for (const s of sealed) {
      if (s.t !== 'cell-sealed') continue
      expect(s.turns).toBe(3)
      expect(b.at(s.at.x, s.at.y)?.block).toEqual({ type: 'seal', turnsLeft: 3 })
    }
    expect(e.telegraph).toBeNull()
    expect(e.cells).toEqual([{ x: 7, y: 0 }]) // 崩落のあと空きセルへ移動する
  })

  it('予告2x2の内側で駒を1つ消すと崩落が中断され、次の行動では封鎖されない', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('burrower', [{ x: 0, y: 0 }])
    priv(b).diggerAction(e, [])
    const inside = e.telegraph![0]
    const ev: BoardEvent[] = []
    priv(b).clearPieceAt(inside, ev)
    expect(ev.some((x) => x.t === 'fissure-averted')).toBe(true)
    expect(e.telegraph).toBeNull()
    const ev2: BoardEvent[] = []
    priv(b).diggerAction(e, ev2) // 予告からやり直しになる
    expect(ev2.some((x) => x.t === 'cell-sealed')).toBe(false)
    expect(ev2.some((x) => x.t === 'fissure-telegraph')).toBe(true)
  })

  // 回帰：実盤面（安定状態＝空きセルが存在しない）では relocateDigger が働かず敵が動かないため、
  // 「最遠の2x2を厳密に1つ選ぶ」だと予告が盤面の同じ角に固定され、層5の狙い（盤面全域を見る）が死ぬ。
  // 人為的に piece=null を作らないこと自体がこのテストの要件（SPEC_OXYGEN §4.11）。
  it('層5の実盤面を20手回すと崩落の予告位置が固定されない（3種類以上出る）', () => {
    const run = createRunState([])
    const b = new Board(levelOf(FLOORS[4]), run, FLOORS[4])
    const seen = new Set<string>()
    for (let i = 0; i < 20; i++) {
      const ev: BoardEvent[] = []
      priv(b).resolveEnemyTurn(ev)
      for (const x of ev) if (x.t === 'fissure-telegraph') seen.add(`${x.cells[0].x},${x.cells[0].y}`)
    }
    expect(seen.size).toBeGreaterThanOrEqual(3)
  })
})

describe('息喰み（breathstealer）', () => {
  it('3手ごとに酸素を3奪い、それ以外の手では奪わない', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    b.spawnEnemy('breathstealer', [{ x: 0, y: 0 }])
    const ev1: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev1)
    priv(b).resolveEnemyTurn(ev1)
    expect(ev1.some((x) => x.t === 'oxygen-drained')).toBe(false)
    expect(run.oxygen).toBe(OXYGEN_START)
    const ev2: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev2)
    const d = ev2.find((x) => x.t === 'oxygen-drained')
    expect(d && d.t === 'oxygen-drained' ? d.amount : -1).toBe(3)
    expect(run.oxygen).toBe(OXYGEN_START - 3)
  })
})

describe('深匣主（boss）', () => {
  it('第1段階はどんな一撃でも匣1枚、4枚剥がすと核が露出して身体が2セルになる', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const boss = b.spawnEnemy('boss', bossBodyCells(H - 1, H - 1, W))
    expect(boss.cells.length).toBe(W)
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(boss.id, 99, ev) // 大きな一撃でも1枚だけ
    const shell = ev.find((x) => x.t === 'boss-shell-broken')
    expect(shell && shell.t === 'boss-shell-broken' ? shell.left : -1).toBe(BOSS_SHELL_COUNT - 1)
    expect(ev.some((x) => x.t === 'enemy-damage')).toBe(false) // 第1段階ではHPが削れない
    expect(boss.hp).toBe(ENEMY_HP.boss)
    for (let i = 1; i < BOSS_SHELL_COUNT; i++) {
      priv(b).beginResolve() // 匣は1手1枚＝4手かけて剥がす
      priv(b).dealEnemyDamage(boss.id, 1, ev)
    }
    const phase = ev.find((x) => x.t === 'boss-phase')
    expect(phase && phase.t === 'boss-phase' ? phase.phase : -1).toBe(2)
    expect(boss.bossPhase).toBe(2)
    expect(boss.cells).toEqual([
      { x: 3, y: H - 1 },
      { x: 4, y: H - 1 },
    ])
    expect(b.at(0, H - 1)?.block).toBeNull() // 空いたセルは解放される
  })

  it('第2段階に入ると通常どおりHP8を削って撃破できる', () => {
    const run = createRunState([])
    const b = new Board(plain({ goals: [{ type: 'enemy-kill', count: 1 }] }), run)
    const boss = b.spawnEnemy('boss', bossBodyCells(H - 1, H - 1, W))
    const ev: BoardEvent[] = []
    for (let i = 0; i < BOSS_SHELL_COUNT; i++) {
      priv(b).beginResolve()
      priv(b).dealEnemyDamage(boss.id, 1, ev)
    }
    const ev2: BoardEvent[] = []
    priv(b).dealEnemyDamage(boss.id, 3, ev2)
    expect(firstDamage(ev2)).toBe(3)
    expect(boss.hp).toBe(ENEMY_HP.boss - 3)
    priv(b).dealEnemyDamage(boss.id, ENEMY_HP.boss, ev2)
    expect(ev2.some((x) => x.t === 'enemy-defeated')).toBe(true)
    expect(b.enemies.length).toBe(0)
    expect(b.goalDone[0]).toBe(1) // 撃破は enemy-kill 目標を進める
  })

  // 回帰：壺の面爆発や横向きの銛は最下行のボス身体を複数セル同時に踏むため、
  // 抑止が無いと1手で匣4枚が全部剥がれて第2段階まで飛ぶ（§1.4「4枚剥がすと第2段階」が崩壊する）。
  it('壺1発でボス身体を5セル巻き込んでも匣は1枚しか剥がれない（1手＝1枚）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const boss = b.spawnEnemy('boss', bossBodyCells(H - 1, H - 1, W))
    const ev: BoardEvent[] = []
    priv(b).beginResolve()
    priv(b).fireSpecial({ x: 3, y: 6 }, { kind: 'hitsubo' }, ev) // 半径2＝最下行の x1..5 を踏む
    expect(ev.filter((x) => x.t === 'boss-shell-broken').length).toBe(1)
    expect(boss.bossShellLeft).toBe(BOSS_SHELL_COUNT - 1)
    expect(boss.bossPhase).toBe(1)
    expect(boss.hp).toBe(ENEMY_HP.boss)
    expect(ev.some((x) => x.t === 'boss-phase')).toBe(false)
    const ev2: BoardEvent[] = []
    priv(b).beginResolve() // 次の手ではまた1枚剥がれる（抑止は1解決の中だけ）
    priv(b).fireSpecial({ x: 3, y: 6 }, { kind: 'hitsubo' }, ev2)
    expect(ev2.filter((x) => x.t === 'boss-shell-broken').length).toBe(1)
    expect(boss.bossShellLeft).toBe(BOSS_SHELL_COUNT - 2)
  })

  it('横向きの銛で身体8セルを貫いても匣は1枚だけ（本体HPにも届かない）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const boss = b.spawnEnemy('boss', bossBodyCells(H - 1, H - 1, W))
    const ev: BoardEvent[] = []
    priv(b).beginResolve()
    priv(b).fireSpecial({ x: 0, y: H - 1 }, { kind: 'harpoon', dir: 'h' }, ev)
    expect(ev.filter((x) => x.t === 'boss-shell-broken').length).toBe(1)
    expect(ev.some((x) => x.t === 'enemy-damage')).toBe(false)
    expect(boss.hp).toBe(ENEMY_HP.boss)
  })
})

describe('インテント表（enemyIntent）', () => {
  it('6種それぞれが自分の予告種別を返す（swarm だけ none）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const kinds = {
      swarm: b.spawnEnemy('swarm', [{ x: 0, y: 0 }]),
      rockshell: b.spawnEnemy('rockshell', [{ x: 1, y: 0 }]),
      sporeling: b.spawnEnemy('sporeling', [{ x: 2, y: 0 }]),
      burrower: b.spawnEnemy('burrower', [{ x: 3, y: 0 }]),
      breathstealer: b.spawnEnemy('breathstealer', [{ x: 4, y: 0 }]),
      boss: b.spawnEnemy('boss', [{ x: 5, y: 0 }]),
    }
    expect(enemyIntent(kinds.swarm)).toEqual({ kind: 'none', turns: 0, label: '動かない' })
    expect(enemyIntent(kinds.rockshell).kind).toBe('armor')
    expect(enemyIntent(kinds.rockshell).turns).toBe(2)
    expect(enemyIntent(kinds.sporeling).kind).toBe('devour')
    expect(enemyIntent(kinds.sporeling).label).toBe('目星') // 印が無いうちは「目星」
    expect(enemyIntent(kinds.burrower).kind).toBe('fissure')
    expect(enemyIntent(kinds.burrower).label).toBe('掘削')
    expect(enemyIntent(kinds.breathstealer)).toEqual({ kind: 'drain', turns: 3, oxygen: 3, label: '灯−3' })
    expect(enemyIntent(kinds.boss)).toEqual({ kind: 'drain', turns: 3, oxygen: 3, label: '灯−3' })
  })

  it('予告が立つと label が「捕食」「崩落」に変わり、予告セルが載る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(4, 4)!.piece = { kind: 'normal', color: 1, charged: true }
    const s = b.spawnEnemy('sporeling', [{ x: 0, y: 0 }])
    priv(b).harvesterAction(s, [])
    expect(enemyIntent(s).label).toBe('捕食')
    expect(enemyIntent(s).cells).toEqual([{ x: 4, y: 4 }])
    const d = b.spawnEnemy('burrower', [{ x: 7, y: 7 }])
    priv(b).diggerAction(d, [])
    expect(enemyIntent(d).label).toBe('崩落')
    expect(enemyIntent(d).cells?.length).toBe(4)
  })
})
