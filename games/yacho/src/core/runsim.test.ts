// runsim の集計のうち、PHASE2.md §2.5① の主指標「遭難深度の分布」だけをテストする。
// 通しプレイ（simulateSeed）は重いので回さない。ここで見るのは中央値と終盤割合の数え方が正しいことだけ。
import { describe, expect, it } from 'vitest'
import { deathDepthStats, type SeedResult } from './runsim'

/** 遭難深度だけを持つ最小のダミー結果（他のフィールドは集計に使われない） */
const res = (deathFloor: number | null): SeedResult => ({
  seed: 0,
  moves: [],
  drafts: [],
  clearedFloors: [],
  endOxygenByFloor: new Map(),
  preSupplyOxygenByFloor: new Map(),
  deathFloor,
  stuck: false,
  minOxygenDeep: null,
  finalOxygen: null,
})

describe('遭難深度の分布', () => {
  it('中央値は遭難したランだけで取る（クリアしたランは分母に入れない）', () => {
    const stats = deathDepthStats([res(5), res(8), res(9), res(null), res(null)])
    expect(stats.deaths).toBe(3)
    expect(stats.median).toBe(8)
  })

  it('終盤の割合は全ランが分母（PHASE2「全体の35%以上」）', () => {
    // 深度25以上の遭難が2件、全4ラン＝50%
    const stats = deathDepthStats([res(25), res(30), res(3), res(null)])
    expect(stats.lateFrom).toBe(25) // PHASE2 §2.5①「深度25以上」
    expect(stats.lateDeaths).toBe(2)
    expect(stats.latePct).toBeCloseTo(50)
  })

  it('序盤で尽きるランばかりなら終盤割合が下がる（＝惜しくない）', () => {
    const stats = deathDepthStats([res(3), res(4), res(5), res(26)])
    expect(stats.latePct).toBeCloseTo(25)
    expect(stats.median).toBe(5)
  })

  it('1件も遭難しなければ中央値は null', () => {
    const stats = deathDepthStats([res(null), res(null)])
    expect(stats.median).toBe(null)
    expect(stats.latePct).toBe(0)
  })

  it('中央値の合格帯は PHASE2 §2.5① の 20〜24', () => {
    expect(deathDepthStats([]).medianBand).toEqual([20, 24])
  })
})
