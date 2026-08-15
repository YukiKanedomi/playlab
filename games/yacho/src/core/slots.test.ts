// 知見の枠（PHASE2.md §2「取る＝捨てる」）のエンジン層テスト。
// 枠そのものは RunState.slots と discardUpgrade の2つだけの機構なので、ここで見るのは
// ①初期値と「スターター知見も1枠を消費する」こと ②手放した知見がその場で盤面から外れること。
import { describe, expect, it } from 'vitest'
import { Board } from './board'
import { createRunState, discardUpgrade, UPGRADE_SLOTS_DEFAULT } from './run'
import { makeRng } from './rng'
import { RELIC_RESONANCE_ID } from './upgrades'
import type { LevelDef } from './types'

const plain = (): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
})

describe('知見の枠', () => {
  it('枠制限は一時停止中（2026-08-15 オーナー指示）＝上限なしで、スターター知見を1つ持って始まる', () => {
    const run = createRunState(undefined, makeRng(7))
    expect(run.slots).toBe(UPGRADE_SLOTS_DEFAULT)
    expect(UPGRADE_SLOTS_DEFAULT).toBe(Infinity) // 有限に戻したらこのテストごと8枠制の記述へ戻す
    expect(run.upgrades.length).toBe(1)
  })

  it('手放した知見は upgrades から消え、盤面の効果もその場で失われる', () => {
    const run = createRunState(['toxic-spore'], makeRng(7))
    // 採録時のおまけ（starter）が働く＝この知見が効いていることの確認
    expect(new Board(plain(), run).initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'toxic-spore')).toBe(true)

    discardUpgrade(run, 'toxic-spore')
    expect(run.upgrades).not.toContain('toxic-spore')
    expect(run.startersApplied).not.toContain('toxic-spore')
    // 手放した直後に組まれる盤面では、もうこの知見は働かない
    expect(new Board(plain(), run).initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'toxic-spore')).toBe(false)
  })

  it('遺物共鳴を手放すと、待機していたブーストも一緒に消える（捨てた知見が一度だけ効いてしまわない）', () => {
    const run = createRunState([RELIC_RESONANCE_ID], makeRng(7))
    run.relicBoostNext = true // 採録時のおまけ／ギア起動で立った「次の遺物マッチは2倍」の待機状態
    discardUpgrade(run, RELIC_RESONANCE_ID)
    expect(run.relicBoostNext).toBe(false)
  })

  it('手放したあとで採り直すと、採録時のおまけが新品として働く', () => {
    const run = createRunState(['toxic-spore'], makeRng(7))
    new Board(plain(), run) // 1回目の層開始でおまけを消費
    discardUpgrade(run, 'toxic-spore')
    run.upgrades.push('toxic-spore')
    expect(new Board(plain(), run).initEvents.some((e) => e.t === 'upgrade-fire' && e.id === 'toxic-spore')).toBe(true)
  })
})
