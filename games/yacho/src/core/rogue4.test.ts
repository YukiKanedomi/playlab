// ローグライク第3波（ROGUE2.md §1原則2/§3/§11）のエンジン層テスト。
// A=全強化にスターター効果（取得直後に盤面が動く） B=サンドバッグ敵(swarm)の新設 C=敵構成比の是正
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState } from './run'
import { FLOORS } from './floors'
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

interface Priv {
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('スターター効果（原則2）', () => {
  it('取得済み強化のスターターはBoard構築（層開始）直後に発火し、盤面が変わる', () => {
    // 胞子繁殖(spore-bloom)：取得時に胞子トークンを2個生成
    const run = createRunState(['spore-bloom'])
    const b = new Board(plain(), run)
    let tokenCells = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.sporeToken) tokenCells++
    expect(tokenCells).toBe(2)
    expect(b.initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'spore-bloom')).toBe(true)
    expect(run.startersApplied).toContain('spore-bloom')
  })

  it('同じ強化のスターターは次の層開始でも二重発火しない（RunStateを層間で引き継ぐ）', () => {
    const run = createRunState(['spore-bloom'])
    new Board(plain(), run) // 層1開始
    expect(run.startersApplied).toEqual(['spore-bloom'])
    const b2 = new Board(plain({ seed: 99 }), run) // 層2開始（同じrunを引き継ぐ）
    expect(run.startersApplied).toEqual(['spore-bloom']) // 増えない＝二重適用されない
    expect(b2.initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'spore-bloom')).toBe(false)
  })

  it('複数の強化を同時所持していれば、Board構築1回で複数のスターターがまとめて発火する', () => {
    const run = createRunState(['mining-habit', 'overrev'])
    const b = new Board(plain(), run)
    const ids = new Set(b.initEvents.filter((e) => e.t === 'upgrade-fire').map((e) => (e.t === 'upgrade-fire' ? e.id : '')))
    expect(ids).toEqual(new Set(['mining-habit', 'overrev']))
  })
})

describe('サンドバッグ（swarm）：撃破の隣接伝播', () => {
  it('1体を倒すと隣接するswarmへ1ダメージが伝播し、HP1なので連鎖的に倒れる', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const a = b.spawnEnemy('swarm', [{ x: 3, y: 3 }])
    const c1 = b.spawnEnemy('swarm', [{ x: 4, y: 3 }]) // aに隣接
    const c2 = b.spawnEnemy('swarm', [{ x: 5, y: 3 }]) // c1に隣接（aとは非隣接）
    const isolated = b.spawnEnemy('swarm', [{ x: 0, y: 0 }]) // どれとも非隣接
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(a.id, 1, ev)
    expect(b.enemies.find((e) => e.id === a.id)).toBeUndefined()
    expect(b.enemies.find((e) => e.id === c1.id)).toBeUndefined() // 伝播で道連れ
    expect(b.enemies.find((e) => e.id === c2.id)).toBeUndefined() // さらに連鎖
    expect(b.enemies.find((e) => e.id === isolated.id)).toBeDefined() // 隣接していないので無事
    expect(ev.filter((e) => e.t === 'enemy-defeated').length).toBe(3)
  })
})

describe('swarmを含む層の生成', () => {
  it('FLOORS[0]（swarm6体）でBoardが構築でき、swarmがHP1で配置され、有効な初手が存在する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run, FLOORS[0])
    const swarms = b.enemies.filter((e) => e.kind === 'swarm')
    expect(swarms.length).toBe(6)
    expect(swarms.every((e) => e.hp === 1)).toBe(true)
    expect(b.hasValidMove()).toBe(true)
  })

  it('層9（混成）はswarm10体＋クセ敵3種を含み、Boardが破綻なく構築できる', () => {
    const run = createRunState([])
    const b = new Board(plain(), run, FLOORS[8])
    expect(b.enemies.filter((e) => e.kind === 'swarm').length).toBe(10)
    expect(b.enemies.filter((e) => e.kind !== 'swarm').length).toBe(3)
    expect(b.hasValidMove()).toBe(true)
  })
})

describe('層編成のサンドバッグ比率（ROGUE2.md §11の是正）', () => {
  it('全10層でswarmが主体を占め、既存3種（クセ敵/エリート枠）は各層0〜1体（層9のみ混成で3体まで）に絞られている', () => {
    let swarmCount = 0
    let otherCount = 0
    FLOORS.forEach((f, i) => {
      const nonBoss = f.enemies.filter((e) => e.kind !== 'boss')
      const others = nonBoss.filter((e) => e.kind !== 'swarm')
      const cap = i === 8 ? 3 : 1 // 層9（index8）だけ混成を許容
      expect(others.length).toBeLessThanOrEqual(cap)
      swarmCount += nonBoss.length - others.length
      otherCount += others.length
    })
    expect(swarmCount).toBeGreaterThan(otherCount * 2) // サンドバッグが明確に主体
  })

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
