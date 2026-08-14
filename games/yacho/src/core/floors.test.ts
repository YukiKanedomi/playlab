// 層表の健全性テスト（SPEC_OXYGEN.md §5 / §9.4）。
// レイアウトと敵編成は別々に編集されがちで、重なると「匣が消える」「蔦苔が永久に剥がせない」
// 「有効手0で始まる」といった静かな事故になる。それを止めるための唯一の防波堤。
// どの層が悪いかが一目で分かるよう、違反を文字列で集めてから空配列と突き合わせる。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { applyBlessingsToFloor } from './blessings'
import { FLOORS, type FloorDef } from './floors'
import { createRunState } from './run'
import type { LevelDef, XY } from './types'

/** FloorDef の目標・レイアウトをそのまま LevelDef へ流す（main.ts の buildFloorLevelDef と同じ形） */
const levelOf = (def: FloorDef, seed: number): LevelDef => ({
  id: def.floor,
  seed,
  moves: 9999,
  colors: 5,
  goals: def.goals,
  layout: def.layout,
})

/** その層で敵が占有する初期セル（ボスは board.ts が最下行の全列、奈落の喉は最下行の中央2セルに置く） */
const enemyCellsOf = (def: FloorDef): XY[] =>
  def.enemies.flatMap((e) =>
    e.kind === 'boss'
      ? Array.from({ length: W }, (_, x) => ({ x, y: H - 1 }))
      : e.kind === 'maw'
        ? [
            { x: 3, y: H - 1 },
            { x: 4, y: H - 1 },
          ]
        : [e.at],
  )

const countChars = (layout: string[], chars: string) =>
  layout
    .join('')
    .split('')
    .filter((c) => chars.includes(c)).length

describe('レイアウトの形式', () => {
  it('全層が8x8のレイアウトと1つ以上の目標を持つ', () => {
    const bad: string[] = []
    for (const def of FLOORS) {
      if (def.layout.length !== H) bad.push(`層${def.floor}: 行数${def.layout.length}`)
      for (const [i, row] of def.layout.entries()) if (row.length !== W) bad.push(`層${def.floor}: 行${i}の長さ${row.length}`)
      if (def.goals.length === 0) bad.push(`層${def.floor}: 目標が空`)
    }
    expect(bad).toEqual([])
  })
})

describe('敵とレイアウトの衝突', () => {
  it('敵の初期セルに障害物・蔦苔を置いていない', () => {
    const bad: string[] = []
    for (const def of FLOORS)
      for (const p of enemyCellsOf(def)) {
        // spawnEnemy が block を無条件上書きするため匣が消え、蔦苔は駒が入らず永久に剥がせなくなる
        const ch = def.layout[p.y][p.x]
        if ('gGhkKs'.includes(ch)) bad.push(`層${def.floor}: (${p.x},${p.y}) に '${ch}'`)
      }
    expect(bad).toEqual([])
  })

  it('敵の初期座標が層内で重複していない', () => {
    const bad: string[] = []
    for (const def of FLOORS) {
      const seen = new Set<string>()
      for (const p of enemyCellsOf(def)) {
        const key = `${p.x},${p.y}`
        if (seen.has(key)) bad.push(`層${def.floor}: (${key}) が重複`)
        seen.add(key)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('目標と素材の量', () => {
  it('enemy-kill 目標の数はその層の敵の数と一致する（倒したのに終わらない/終わりすぎるを防ぐ）', () => {
    const bad: string[] = []
    for (const def of FLOORS) {
      const wipe = def.goals.find((g) => g.type === 'enemy-kill')
      if (wipe && wipe.count !== def.enemies.length) bad.push(`層${def.floor}: 目標${wipe.count} / 敵${def.enemies.length}`)
    }
    expect(bad).toEqual([])
  })

  it('touhen 目標は匣の設置数より少なく、tsutagoke 目標は蔦苔マスの数以下', () => {
    const bad: string[] = []
    for (const def of FLOORS) {
      const touhen = def.goals.find((g) => g.type === 'touhen')
      const hako = countChars(def.layout, 'h')
      if (touhen && touhen.count >= hako) bad.push(`層${def.floor}: 陶片${touhen.count} / 匣${hako}`)
      const moss = def.goals.find((g) => g.type === 'tsutagoke')
      const ground = countChars(def.layout, 'gG')
      if (moss && moss.count > ground) bad.push(`層${def.floor}: 蔦苔${moss.count} / 設置${ground}`)
    }
    expect(bad).toEqual([])
  })

  // 第二幕・第三幕で追加した課目（光胞子・苔石）。素材が足りない層は「達成不能＝灯が尽きるまで終わらない」になる
  it('spore 目標は巣灯の排出総数より少なく、kokeishi 目標は苔石の数以下', () => {
    const bad: string[] = []
    for (const def of FLOORS) {
      const spore = def.goals.find((g) => g.type === 'spore')
      const subi = countChars(def.layout, 's') * 4 // 巣灯1基=4排出（LevelDef.subiCharge の既定値）
      if (spore && spore.count >= subi) bad.push(`層${def.floor}: 光胞子${spore.count} / 排出${subi}`)
      const koke = def.goals.find((g) => g.type === 'kokeishi')
      const stones = countChars(def.layout, 'kK')
      if (koke && koke.count > stones) bad.push(`層${def.floor}: 苔石${koke.count} / 設置${stones}`)
    }
    expect(bad).toEqual([])
  })

  // 祝福の呪い（一意専心＝二課目層の要求1.25倍）を掛けても、盤の材料に余りが残ること。
  // blessings.ts の materialCap がその課目を知らないと頭打ちが効かず**達成不能な層**になり、
  // 頭打ちが「全数ちょうど」だと**1つも取りこぼせない層**になる。どちらも灯が尽きるまで終わらない層を生む。
  // 課目の種類を増やしたら materialCap にも足す、を強制するための防波堤
  it('呪いで要求が増えても、盤の材料を1つ残らず使う要求にはならない', () => {
    const bad: string[] = []
    for (const def of FLOORS) {
      const scaled = applyBlessingsToFloor(def, ['single-minded'])
      for (const g of scaled.goals) {
        if (g.type === 'touhen' && g.count >= countChars(def.layout, 'h')) bad.push(`層${def.floor}: 陶片${g.count}`)
        if (g.type === 'tsutagoke' && g.count >= countChars(def.layout, 'gG')) bad.push(`層${def.floor}: 蔦苔${g.count}`)
        if (g.type === 'kokeishi' && g.count >= countChars(def.layout, 'kK')) bad.push(`層${def.floor}: 苔石${g.count}`)
        if (g.type === 'spore' && g.count >= countChars(def.layout, 's') * 4) bad.push(`層${def.floor}: 光胞子${g.count}`)
      }
    }
    expect(bad).toEqual([])
  })
})

describe('初期盤面の成立性', () => {
  it('全層×20シードで有効な初手がある（有効手0のソフトロック検出）', () => {
    const bad: string[] = []
    for (const def of FLOORS)
      for (let seed = 1; seed <= 20; seed++) {
        const b = new Board(levelOf(def, seed), createRunState([]), def)
        if (!b.hasValidMove()) bad.push(`層${def.floor} seed${seed}`)
      }
    expect(bad).toEqual([])
  })
})
