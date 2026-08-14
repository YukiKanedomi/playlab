// 結果画面の「なぜ細ったか」「あと一つ」（PHASE2.md §2.5②③）の計算テスト。
// 見た目は後で作り直す前提なので、ここで担保するのは**計算と文言が正しいこと**。
import { describe, expect, it } from 'vitest'
import { biggestLoss, buildPostmortem, lightPostmortem, missingLinks, thinningFloor, type DrainSample, type FloorLight } from './postmortem'

const series = (...lights: number[]): FloorLight[] => lights.map((light, i) => ({ floor: i + 1, light }))

describe('灯が細り始めた深度', () => {
  it('ピークの次の深度を返す', () => {
    // 層3で最大 → 層4から細り始めた
    expect(thinningFloor(series(38, 40, 42, 33, 21))).toBe(4)
  })

  it('同じ値が並んでいる間はまだ細っていない（最後のピークを採る）', () => {
    expect(thinningFloor(series(30, 30, 30, 24))).toBe(4)
  })

  it('一度も下がらなければ null', () => {
    expect(thinningFloor(series(10, 20, 30))).toBe(null)
    expect(thinningFloor(series(10))).toBe(null)
    expect(thinningFloor([])).toBe(null)
  })

  it('灯が尽きた層（0）が末尾に入ると、そこまでの下り坂の始まりを指す', () => {
    // 層1〜2で伸び、層3から下り、層5で尽きた
    expect(thinningFloor(series(38, 41, 35, 18, 0))).toBe(3)
  })
})

describe('名指しする損失', () => {
  const d = (floor: number, kind: DrainSample['kind'], amount: number): DrainSample => ({ floor, kind, amount })

  it('同じ層の同じ原生種ぶんを合算し、合計が最大のものを1件だけ選ぶ', () => {
    const got = biggestLoss([d(9, 'breathstealer', 3), d(9, 'breathstealer', 3), d(9, 'breathstealer', 3), d(10, 'boss', 3), d(10, 'boss', 3)])
    expect(got).toEqual({ floor: 9, kind: 'breathstealer', times: 3, amount: 9 })
  })

  it('合計が同じなら深いほう（直近）を選ぶ', () => {
    const got = biggestLoss([d(9, 'breathstealer', 3), d(10, 'boss', 3)])
    expect(got?.floor).toBe(10)
  })

  it('奪われていなければ null', () => {
    expect(biggestLoss([])).toBe(null)
  })
})

describe('「なぜ細ったか」の行', () => {
  it('変曲点・損失の2行を出す（推移そのものは結果画面の折れ線が示す）', () => {
    const lines = lightPostmortem(series(38, 41, 35, 18, 0), [
      { floor: 4, kind: 'breathstealer', amount: 3 },
      { floor: 4, kind: 'breathstealer', amount: 3 },
      { floor: 4, kind: 'breathstealer', amount: 3 },
    ])
    expect(lines).toEqual(['深度3から灯が細り始めた', '深度4　灯喰みに3度触れた（−9）'])
  })

  it('責める語を書かない（事実だけ）', () => {
    const lines = lightPostmortem(series(30, 12, 0), [{ floor: 3, kind: 'boss', amount: 3 }])
    for (const w of ['べき', 'ミス', '無駄', 'もっと', '失敗']) expect(lines.join('')).not.toContain(w)
  })

  it('記録が無ければ何も出さない', () => {
    expect(lightPostmortem([], [])).toEqual([])
  })
})

describe('「あと一つ」', () => {
  it('輪を閉じる候補を、理由つきで出す', () => {
    // 胞子を生む知見が3つ（胞子繁殖・胞子弾・遺物の根）。根食い鉱は胞子を受けて爆発鉱石を返すので輪が閉じる
    const links = missingLinks(['spore-bloom', 'spore-bullet', 'relic-root'])
    expect(links[0].id).toBe('root-eating-ore')
    expect(links[0].closes).toBe(true)
    expect(links[0].reason).toEqual({ resource: 'spore', dir: 'from-build', owners: 3 })
  })

  it('輪を閉じる候補があれば、繋がるだけの候補より先に出す', () => {
    // 胞子繁殖(植物→胞子)＋根食い鉱(胞子→爆発鉱石) に対し、胞子弾(爆発鉱石→胞子)が輪を閉じる
    const links = missingLinks(['spore-bloom', 'root-eating-ore'])
    expect(links.length).toBeGreaterThan(0)
    expect(links.every((l) => l.closes)).toBe(true)
    expect(links.map((l) => l.id)).toContain('spore-bullet')
  })

  it('輪を閉じる候補が1つも無ければ、呼応するだけの候補へ落とす', () => {
    const links = missingLinks(['spore-bloom'])
    expect(links.length).toBe(2)
    expect(links.every((l) => l.closes)).toBe(false)
    expect(links.every((l) => l.reason.owners > 0)).toBe(true)
  })

  it('所持している知見は候補にしない', () => {
    const owned = ['spore-bloom', 'root-eating-ore', 'spore-bullet']
    for (const l of missingLinks(owned, 5)) expect(owned).not.toContain(l.id)
  })

  it('何も持っていなければ何も出さない', () => {
    expect(missingLinks([])).toEqual([])
  })

  it('同じ所持なら何度呼んでも同じ結果（提示が揺れない）', () => {
    const a = missingLinks(['spore-bloom', 'root-eating-ore', 'crystal-bud'])
    const b = missingLinks(['spore-bloom', 'root-eating-ore', 'crystal-bud'])
    expect(a).toEqual(b)
  })
})

describe('結果画面の2欄', () => {
  it('見出しと行がそろう', () => {
    const pm = buildPostmortem(series(38, 30, 0), [{ floor: 3, kind: 'breathstealer', amount: 3 }], ['spore-bloom', 'root-eating-ore'])
    expect(pm.light[0]).toBe('深度2から灯が細り始めた')
    expect(pm.missing?.title).toBe('あと一つ　これがあれば輪が閉じた')
    expect(pm.missing?.lines[0]).toMatch(/^胞子弾　爆発鉱石を生む知見が1つあった$/)
  })

  it('輪が閉じない提示では「輪が閉じた」と書かない（嘘をつかない）', () => {
    const pm = buildPostmortem(series(38), [], ['spore-bloom'])
    expect(pm.missing?.title).toBe('あと一つ　これと呼応した')
  })

  it('知見が1つも無ければ「あと一つ」欄そのものが出ない', () => {
    expect(buildPostmortem(series(38, 0), [], []).missing).toBe(null)
  })
})
