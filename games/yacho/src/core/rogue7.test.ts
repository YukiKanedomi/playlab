// 夜間監査(codex_audit_night.md)[D]対応：進行曲線の調整（swarm群れ攻撃・3/6/9層クリア回復）のエンジン層テスト。
import { describe, expect, it } from 'vitest'
import { Board } from './board'
import { createRunState } from './run'
import { swarmGroupDamage, swarmShouldFire, SWARM_FIRST_ATTACK_TURN, SWARM_ATTACK_PERIOD } from './enemies'
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
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('swarmGroupDamage（夜間監査[D]推奨値：生存4体ごとに1、切り上げ、最大3）', () => {
  it('生存数に応じて切り上げで増える', () => {
    expect(swarmGroupDamage(0)).toBe(0)
    expect(swarmGroupDamage(1)).toBe(1)
    expect(swarmGroupDamage(4)).toBe(1)
    expect(swarmGroupDamage(5)).toBe(2)
    expect(swarmGroupDamage(8)).toBe(2)
    expect(swarmGroupDamage(9)).toBe(3)
    expect(swarmGroupDamage(10)).toBe(3) // 上限3（旧仕様の6〜10同時ヒットのような事故を防ぐ）
  })
})

describe('swarmShouldFire（初回4手後、以降3手ごと）', () => {
  it('4,7,10,13...でtrueになり、それ以外はfalse', () => {
    const fireTurns = [4, 7, 10, 13]
    for (let t = 1; t <= 13; t++) expect(swarmShouldFire(t)).toBe(fireTurns.includes(t))
    expect(SWARM_FIRST_ATTACK_TURN).toBe(4)
    expect(SWARM_ATTACK_PERIOD).toBe(3)
  })
})

describe('swarm群れ攻撃（board.ts resolveEnemyTurn）', () => {
  it('個体ごとではなく群れ単位で1回だけダメージを与える：6体生存なら4手目に2ダメージ、7手目にまた2ダメージ', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    for (let i = 0; i < 6; i++) b.spawnEnemy('swarm', [{ x: i, y: 0 }])
    const hpHistory: number[] = []
    for (let t = 1; t <= 7; t++) {
      const ev: BoardEvent[] = []
      priv(b).resolveEnemyTurn(ev)
      hpHistory.push(run.playerHp)
      // enemy-attackイベントは1手につき最大1回（群れ全体でまとめて1回。個体ごとの多重発火にならない）
      expect(ev.filter((e) => e.t === 'enemy-attack').length).toBeLessThanOrEqual(1)
    }
    // 1〜3手目はまだ無傷、4手目で2ダメージ（6体→ceil(6/4)=2）、5〜6手目は無傷、7手目でまた2ダメージ
    expect(hpHistory).toEqual([20, 20, 20, 18, 18, 18, 16])
  })

  it('生存数が減れば次回攻撃のダメージも減る（10体→3、途中で6体を倒すと次は4体ぶんの1ダメージ）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    // 隣接伝播（propagateSwarmDefeat）で意図せず巻き添え連鎖しないよう、2マス間隔で非隣接に散らす
    const enemies = Array.from({ length: 10 }, (_, i) => b.spawnEnemy('swarm', [{ x: (i % 4) * 2, y: Math.floor(i / 4) * 2 }]))
    const ev1: BoardEvent[] = []
    for (let t = 1; t <= 4; t++) priv(b).resolveEnemyTurn(ev1) // 4手目でceil(10/4)=3ダメージ
    expect(run.playerHp).toBe(17)
    // 6体を撃破して4体だけ残す（伝播に頼らず個別に処理：隣接しない配置なので連鎖は起きない）
    const evDamage: BoardEvent[] = []
    for (const e of enemies.slice(0, 6)) priv(b).dealEnemyDamage(e.id, 1, evDamage)
    expect(b.enemies.filter((e) => e.kind === 'swarm' && e.hp > 0).length).toBe(4)
    const ev2: BoardEvent[] = []
    for (let t = 5; t <= 7; t++) priv(b).resolveEnemyTurn(ev2) // 7手目でceil(4/4)=1ダメージ
    expect(run.playerHp).toBe(16)
  })
})

describe('3・6・9層クリア時のHP回復（夜間監査[D]推奨値：+2、上限20）', () => {
  it('3層クリア時はHPが2回復する（上限20）', () => {
    const run = createRunState([])
    run.floor = 3
    run.playerHp = 10
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('rockshell', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    ;(b as unknown as Priv).dealEnemyDamage(e.id, 8, ev)
    expect(ev.some((x) => x.t === 'floor-clear')).toBe(true)
    expect(run.playerHp).toBe(12)
  })

  it('上限20を超えて回復しない', () => {
    const run = createRunState([])
    run.floor = 6
    run.playerHp = 19
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('rockshell', [{ x: 0, y: 0 }])
    ;(b as unknown as Priv).dealEnemyDamage(e.id, 8, [])
    expect(run.playerHp).toBe(20)
  })

  it('3/6/9層以外のクリアではHPが変化しない（例：層1）', () => {
    const run = createRunState([])
    run.floor = 1
    run.playerHp = 10
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('rockshell', [{ x: 0, y: 0 }])
    ;(b as unknown as Priv).dealEnemyDamage(e.id, 8, [])
    expect(run.playerHp).toBe(10)
  })
})
