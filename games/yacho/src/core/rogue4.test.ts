// ローグライク第3波（ROGUE2.md §1原則2/§3/§11）のエンジン層テスト。
// A=全強化にスターター効果（取得直後に盤面が動く） B=サンドバッグ敵(swarm)の新設 C=敵構成比の是正
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState } from './run'
import { FLOORS, type FloorDef } from './floors'
import type { BoardEvent, LevelDef } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

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
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[], heavy?: boolean) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('スターター効果（原則2）', () => {
  it('取得済み強化のスターターはBoard構築（層開始）直後に発火し、盤面が変わる', () => {
    // 毒胞子(toxic-spore)：本体が胞子前提のため、スターターは胞子トークンを設置する（第4波でスターターを
    // 条件付き強化のみに絞った際、意図に合う形へ差し替え。spore-bloomはstarter廃止のため対象から外れた）。
    // 夜間監査[C]10：スターター量を1個へ戻した（2個は本体より強く見えるため）。本来は敵のとなりを狙うが、
    // このテストの盤面には敵がいないため配置はランダムへ後退する（配置自体は別テストで検証）。
    const run = createRunState(['toxic-spore'])
    const b = new Board(plain(), run)
    let tokenCells = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.sporeToken) tokenCells++
    expect(tokenCells).toBe(1)
    expect(b.initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'toxic-spore')).toBe(true)
    expect(run.startersApplied).toContain('toxic-spore')
  })

  it('同じ強化のスターターは次の層開始でも二重発火しない（RunStateを層間で引き継ぐ）', () => {
    const run = createRunState(['toxic-spore'])
    new Board(plain(), run) // 層1開始
    expect(run.startersApplied).toEqual(['toxic-spore'])
    const b2 = new Board(plain({ seed: 99 }), run) // 層2開始（同じrunを引き継ぐ）
    expect(run.startersApplied).toEqual(['toxic-spore']) // 増えない＝二重適用されない
    expect(b2.initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'toxic-spore')).toBe(false)
  })

  it('複数の強化を同時所持していれば、Board構築1回で複数のスターターがまとめて発火する', () => {
    // resonant-shatter/relic-resonanceは条件付き強化としてstarterが残る8種に含まれる
    // （mining-habit/overrevは第4波でstarterを外したためこのテストの対象から外れた）
    const run = createRunState(['resonant-shatter', 'relic-resonance'])
    const b = new Board(plain(), run)
    const ids = new Set(b.initEvents.filter((e) => e.t === 'upgrade-fire').map((e) => (e.t === 'upgrade-fire' ? e.id : '')))
    expect(ids).toEqual(new Set(['resonant-shatter', 'relic-resonance']))
  })
})

describe('サンドバッグ（swarm）：撃破の隣接伝播', () => {
  it('heavyな一撃で倒すと隣接swarmへ2ダメージが伝播し、HP2なので連鎖的に倒れる', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const a = b.spawnEnemy('swarm', [{ x: 3, y: 3 }])
    const c1 = b.spawnEnemy('swarm', [{ x: 4, y: 3 }]) // aに隣接
    const c2 = b.spawnEnemy('swarm', [{ x: 5, y: 3 }]) // c1に隣接（aとは非隣接）
    const isolated = b.spawnEnemy('swarm', [{ x: 0, y: 0 }]) // どれとも非隣接
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(a.id, 2, ev, true)
    expect(b.enemies.find((e) => e.id === a.id)).toBeUndefined()
    expect(b.enemies.find((e) => e.id === c1.id)).toBeUndefined() // 伝播で道連れ
    expect(b.enemies.find((e) => e.id === c2.id)).toBeUndefined() // さらに連鎖
    expect(b.enemies.find((e) => e.id === isolated.id)).toBeDefined() // 隣接していないので無事
    expect(ev.filter((e) => e.t === 'enemy-defeated').length).toBe(3)
  })

  it('heavyでない一撃（3個マッチ相当）で倒しても伝播しない（SPEC_OXYGEN §1.3）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const a = b.spawnEnemy('swarm', [{ x: 3, y: 3 }])
    const c1 = b.spawnEnemy('swarm', [{ x: 4, y: 3 }])
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(a.id, 1, ev) // 1ダメージではHP2を削り切れない
    expect(b.enemies.find((e) => e.id === a.id)?.hp).toBe(1)
    priv(b).dealEnemyDamage(a.id, 1, ev) // 2回目で撃破（heavy=false）
    expect(b.enemies.find((e) => e.id === a.id)).toBeUndefined()
    expect(b.enemies.find((e) => e.id === c1.id)?.hp).toBe(2) // 隣は無傷＝伝播していない
    expect(ev.filter((e) => e.t === 'enemy-defeated').length).toBe(1)
  })
})

describe('層の生成（FLOORS）', () => {
  it('層1は敵ゼロ・植物系の収集目標で、有効な初手が存在する', () => {
    const run = createRunState([])
    const b = new Board(levelOf(FLOORS[0]), run, FLOORS[0])
    expect(b.enemies.length).toBe(0)
    // 個数は runsim の較正で動く値なので、目標の形（植物系の収集ひとつ）だけを固定する
    expect(FLOORS[0].goals.length).toBe(1)
    expect(FLOORS[0].goals[0]).toMatchObject({ type: 'system', system: 'plant' })
    expect(FLOORS[0].goals[0].count).toBeGreaterThan(0)
    expect(b.hasValidMove()).toBe(true)
  })

  it('層2（swarm4体）でBoardが構築でき、swarmがHP2で配置され、有効な初手が存在する', () => {
    const run = createRunState([])
    const b = new Board(levelOf(FLOORS[1]), run, FLOORS[1])
    const swarms = b.enemies.filter((e) => e.kind === 'swarm')
    expect(swarms.length).toBe(4)
    expect(swarms.every((e) => e.hp === 2)).toBe(true)
    expect(b.hasValidMove()).toBe(true)
  })

  it('層9は喰み蟲1＋息喰み1の2体編成で、Boardが破綻なく構築できる', () => {
    const run = createRunState([])
    const b = new Board(levelOf(FLOORS[8]), run, FLOORS[8])
    expect(b.enemies.map((e) => e.kind).sort()).toEqual(['breathstealer', 'sporeling'])
    expect(b.hasValidMove()).toBe(true)
  })
})

describe('層編成の健全性', () => {
  it('層内に座標の重複がない（散開配置）', () => {
    for (const f of FLOORS) {
      const seen = new Set<string>()
      for (const spec of f.enemies) {
        if (spec.kind === 'boss') continue // ボスは自動配置なので対象外
        const key = `${spec.at.x},${spec.at.y}`
        expect(seen.has(key)).toBe(false)
        seen.add(key)
      }
    }
  })
})

describe('runなしBoardの互換性', () => {
  it('run未指定ならinitEventsは空のまま', () => {
    const b = new Board(plain())
    expect(b.initEvents).toEqual([])
  })
})
