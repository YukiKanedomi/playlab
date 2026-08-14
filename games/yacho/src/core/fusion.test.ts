// 合成と深化（PHASE2.md §2.8）のエンジン層テスト。
// 見るのは設計の骨だけ：①合成は呼応する2つを持つときだけ出る ②合成すると枠が1つ空く
// ③合成の知見は採録に出ない ④深化は枠を動かさず、発動条件だけがゆるむ（盤面で実際に効く）
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState, discardUpgrade } from './run'
import { applyDeepen, applyFusion, deepenOptions, fusionOptions } from './fusion'
import { pickDraftOptions } from './draft'
import { RESOURCES, UPGRADES } from './upgrades'
import { makeRng } from './rng'
import type { BoardEvent, LevelDef, XY } from './types'

const plain = (): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
})

interface Priv {
  checkSporeTouch: (at: XY, ev: BoardEvent[]) => void
}

describe('合成（PHASE2.md §2.8）', () => {
  it('資源を生む知見と使う知見の両方を持つときだけ出る', () => {
    // 胞子繁殖＝胞子を生む／毒胞子＝胞子を使う
    expect(fusionOptions(['spore-bloom']).length).toBe(0)
    const opts = fusionOptions(['spore-bloom', 'toxic-spore'])
    expect(opts.length).toBe(1)
    expect(opts[0].resource).toBe('spore')
    expect(opts[0].def.id).toBe('ring-of-spores')
  })

  it('合成すると2つが1つになり、枠がひとつ空く', () => {
    const run = createRunState(['spore-bloom', 'toxic-spore'])
    const before = run.upgrades.length
    applyFusion(run, fusionOptions(run.upgrades)[0])
    expect(run.upgrades.length).toBe(before - 1) // 枠は動かさず、埋まっている数だけが減る
    expect(run.slots).toBe(8)
    expect(run.upgrades).toEqual(['ring-of-spores'])
  })

  it('同じ資源の組は1つしか出ず、合成ずみの知見はもう出ない', () => {
    // 遺物の根・変換炉・模倣の粘菌がそろっていても「遺物の共鳴」の組は1つだけ
    const owned = ['relic-resonance', 'transformation-furnace', 'mimic-slime']
    expect(fusionOptions(owned).filter((o) => o.resource === 'relic-match').length).toBe(1)
    expect(fusionOptions([...owned, 'ring-of-resonance']).filter((o) => o.resource === 'relic-match').length).toBe(0)
  })

  it('合成の知見は採録の抽選には出ない（合成でしか手に入らない）', () => {
    for (let seed = 0; seed < 60; seed++) {
      const opts = pickDraftOptions(['spore-bloom', 'toxic-spore'], makeRng(seed), 12)
      expect(opts.every((o) => !o.fusion)).toBe(true)
    }
  })

  it('合成の知見は資源ごとに1つで、語彙は RESOURCES の範囲に収まっている', () => {
    const fusions = UPGRADES.filter((u) => u.fusion)
    expect(new Set(fusions.map((u) => u.fusion)).size).toBe(fusions.length)
    for (const u of fusions) {
      expect(RESOURCES).toContain(u.fusion)
      for (const r of [...(u.consumes ?? []), ...(u.produces ?? [])]) expect(RESOURCES).toContain(r)
    }
  })
})

describe('深化（PHASE2.md §2.8）', () => {
  it('深めても枠は変わらない。手放せば深化も落ちる', () => {
    const run = createRunState(['crystal-bud'])
    applyDeepen(run, 'crystal-bud')
    expect(run.upgrades.length).toBe(1) // 枠を消費しない
    expect(deepenOptions(run).some((u) => u.id === 'crystal-bud')).toBe(false) // 二度は深められない
    discardUpgrade(run, 'crystal-bud')
    expect(run.deepened).not.toContain('crystal-bud')
  })

  it('数値ではなく発動条件がゆるむ（結晶の芽：4つ以上 → 3つ以上）', () => {
    const def = UPGRADES.find((u) => u.id === 'crystal-bud')!
    const base = def.hooks[0]
    const deep = def.deepen!.apply(base)
    expect(base.on === 'match' && base.minSize).toBe(4)
    expect(deep.on === 'match' && deep.minSize).toBe(3)
  })

  it('盤面で実際に効く（毒胞子：となりに居なくても最寄りの原生種へ通る）', () => {
    const damageAfterSporeTouch = (deepened: string[]): number => {
      const run = createRunState(['toxic-spore'])
      run.deepened = deepened
      const b = new Board(plain(), run)
      // 採録時のおまけが置いた胞子を片付けてから、狙った1マスだけに胞子を置く
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) b.at(x, y)!.sporeToken = false
      const e = b.spawnEnemy('rockshell', [{ x: 7, y: 7 }]) // 胞子から遠い＝となりではない
      b.at(1, 0)!.sporeToken = true
      const ev: BoardEvent[] = []
      ;(b as unknown as Priv).checkSporeTouch({ x: 0, y: 0 }, ev)
      return 6 - e.hp
    }
    expect(damageAfterSporeTouch([])).toBe(0)
    expect(damageAfterSporeTouch(['toxic-spore'])).toBe(3)
  })
})
