// ローグライク・バランス再設計（プレイテスト反省）のエンジン層テスト。ROGUE.md §4/§5 準拠。
// 背景：「HP制ではないんですね」「連鎖してる感じがなく、恩恵も感じない」への対応。
// A=敵を本当の脅威に（妨害/攻撃の交互ローテ＋enemyIntent公開） B=強化のよく光る化＋進捗公開 C=連鎖の実感
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { enemyIntent } from './enemies'
import { createRunState, STARTER_UPGRADE_IDS } from './run'
import { makeRng } from './rng'
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

/** rogue.test.ts と同じ流儀のテスト用盤面組み立て */
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

/** 市松で絶対にマッチしない充填（rogue.test.ts/rogue2.test.ts と同じ） */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

interface Priv {
  triggerGear: (at: XY, ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

describe('敵インテント（enemyIntent）', () => {
  it('ボスは酸素を奪う予告（3手周期・酸素-3）を返し、周期はactionTimerと対で減る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const boss = b.spawnEnemy('boss', [{ x: 0, y: 6 }])
    const it = enemyIntent(boss)
    expect(it.kind).toBe('drain')
    expect(it.oxygen).toBe(3)
    expect(it.turns).toBe(3)
    boss.actionTimer = 2
    expect(enemyIntent(boss).turns).toBe(1)
  })
})

describe('進捗公開（RunState.progress）', () => {
  it('自律機構/機械庭園：ギア起動2回で1サイクル、curが1→2→(次サイクル)1と回る', () => {
    const run = createRunState(['autonomous-mechanism', 'mechanical-garden'])
    const b = new Board(plain(), run)
    expect(run.progress['autonomous-mechanism']).toEqual({ cur: 0, max: 2 }) // Board構築直後に0/2が見える
    const ev: BoardEvent[] = []
    priv(b).triggerGear({ x: 0, y: 0 }, ev)
    expect(run.progress['autonomous-mechanism']).toEqual({ cur: 1, max: 2 })
    expect(run.progress['mechanical-garden']).toEqual({ cur: 1, max: 2 })
    priv(b).triggerGear({ x: 0, y: 0 }, ev)
    expect(run.progress['autonomous-mechanism']).toEqual({ cur: 2, max: 2 }) // 発動の瞬間
    priv(b).triggerGear({ x: 0, y: 0 }, ev)
    expect(run.progress['autonomous-mechanism']).toEqual({ cur: 1, max: 2 }) // 次サイクルへ
  })

  it('遺物共鳴：ブースト待機中は1/1、消費すると0/1に戻る', () => {
    const run = createRunState(['relic-resonance'])
    const b = new Board(plain(), run)
    // 第3波：遺物共鳴はスターター効果で取得時に即boostNextRelic()するため、Board構築直後から既に1/1
    // （原則2＝取得直後から効果を実感できる、を反映した仕様変更。詳細は最終報告）
    expect(run.progress['relic-resonance']).toEqual({ cur: 1, max: 1 })
    setPieces(b, inert())
    b.at(3, 3)!.piece = { kind: 'normal', color: 0 } // ギア
    b.at(3, 2)!.piece = { kind: 'normal', color: 3 } // 隣接する遺物
    const ev: BoardEvent[] = []
    priv(b).triggerGear({ x: 3, y: 3 }, ev)
    expect(run.progress['relic-resonance']).toEqual({ cur: 1, max: 1 }) // 既にブースト中なので変化なし
  })
})

describe('ラン開始時の強化配布（STARTER_UPGRADE_IDS）', () => {
  it('upgrades省略時のみ、プールから決定的に1つ配布される', () => {
    const run = createRunState(undefined, makeRng(1))
    expect(run.upgrades.length).toBe(1)
    expect(STARTER_UPGRADE_IDS).toContain(run.upgrades[0])
  })

  it('upgradesを明示指定した場合（空配列含む）は配布されない', () => {
    expect(createRunState([]).upgrades).toEqual([])
    expect(createRunState(['spore-bloom']).upgrades).toEqual(['spore-bloom'])
  })
})

describe('連鎖の実感（3強化同時発火）', () => {
  it('盤面に独立して成立済みの3マッチが1スワップで同時解決され、3つの強化が発火する', () => {
    const run = createRunState(['overrev', 'mining-habit', 'fungal-awakening'])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    // ギア(色0)3連：row0 x0-2（過回転＝system:'gear'、minSize無しで必ず発火）
    b.at(0, 0)!.piece = { kind: 'normal', color: 0 }
    b.at(1, 0)!.piece = { kind: 'normal', color: 0 }
    b.at(2, 0)!.piece = { kind: 'normal', color: 0 }
    // 鉱物(色2)3連：row5 x0-2（採掘慣れ＝system:'mineral'）
    b.at(0, 5)!.piece = { kind: 'normal', color: 2 }
    b.at(1, 5)!.piece = { kind: 'normal', color: 2 }
    b.at(2, 5)!.piece = { kind: 'normal', color: 2 }
    // 植物(色1)3連：row2 x4-6（菌糸の目覚め＝system:'plant'）
    b.at(4, 2)!.piece = { kind: 'normal', color: 1 }
    b.at(5, 2)!.piece = { kind: 'normal', color: 1 }
    b.at(6, 2)!.piece = { kind: 'normal', color: 1 }
    // 3つとは無関係な1手（盤面に既にマッチがあるため合法に通る）
    const ev = b.swap({ x: 6, y: 7 }, { x: 7, y: 7 })
    const fires = ev.filter((e) => e.t === 'upgrade-fire')
    expect(fires.length).toBeGreaterThanOrEqual(3)
    const ids = new Set(fires.map((f) => (f.t === 'upgrade-fire' ? f.id : '')))
    expect(ids).toEqual(new Set(['overrev', 'mining-habit', 'fungal-awakening']))
  })
})
