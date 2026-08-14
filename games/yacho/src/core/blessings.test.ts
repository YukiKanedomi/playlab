// 祝福と呪い（PHASE2.md §3）のエンジン層テスト。
// 祝福は7種あり、どれも「利点1行」と「代償1行」の対なので、1種につき**両方が実際に効いている**ことを見る。
// 盤面のイベントには触らない設計なので、確認するのは灯・課目・深度・盤面形状・知見の枠の5点だけ。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import {
  applyBlessingsToFloor,
  BLESSINGS,
  blessingSupply,
  isBlessingFloor,
  pickBlessingOptions,
  takeBlessing,
} from './blessings'
import { createRunState, OXYGEN_START, OXYGEN_SUPPLY_PER_FLOOR, UPGRADE_SLOTS_DEFAULT } from './run'
import { enemyIntent } from './enemies'
import { FLOORS } from './floors'
import { makeRng } from './rng'
import type { BoardEvent, LevelDef, Piece } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** 市松で絶対にマッチしない充填（oxygen.test.ts と同じ道具） */
function setInert(b: Board) {
  const map: Piece[] = [
    { kind: 'normal', color: 0 },
    { kind: 'normal', color: 1 },
    { kind: 'normal', color: 2 },
    { kind: 'normal', color: 3 },
  ]
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = { ...map[((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2)] }
    }
}

interface Priv {
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  checkFloorClear: (ev: BoardEvent[]) => void
}
const priv = (b: Board) => b as unknown as Priv

const refillOf = (ev: BoardEvent[]) => {
  const e = ev.find((x) => x.t === 'oxygen-refill')
  return e && e.t === 'oxygen-refill' ? e.amount : -1
}

/** 層クリアを起こして補給量を取る（補給は checkFloorClear の中でしか起きない） */
function refillAt(run: ReturnType<typeof createRunState>, floor: number): number {
  run.floor = floor
  const b = new Board(plain({ goals: [{ type: 'color', color: 0, count: 1 }] }), run)
  b.goalDone[0] = 1
  const ev: BoardEvent[] = []
  priv(b).checkFloorClear(ev)
  return refillOf(ev)
}

describe('祝福の枠組み', () => {
  it('7種あり、どれも利点と代償の両方を文で持っている（隠しデメリットを作らない）', () => {
    expect(BLESSINGS.length).toBe(7)
    for (const b of BLESSINGS) {
      expect(b.boon.length).toBeGreaterThan(0)
      expect(b.curse.length).toBeGreaterThan(0)
    }
    expect(new Set(BLESSINGS.map((b) => b.id)).size).toBe(BLESSINGS.length)
  })

  it('幕主の深度10・20の後だけ祝福を選ぶ', () => {
    expect(isBlessingFloor(10)).toBe(true)
    expect(isBlessingFloor(20)).toBe(true)
    expect(isBlessingFloor(9)).toBe(false)
  })

  it('候補に所持済みは出ない（同名重複なし）', () => {
    const opts = pickBlessingOptions(['great-lung', 'first-bell'], makeRng(3))
    expect(opts.length).toBe(3)
    expect(opts.map((b) => b.id)).not.toContain('great-lung')
    expect(new Set(opts.map((b) => b.id)).size).toBe(3)
  })

  it('幕主のあとの深度では、呪いがもう効かない祝福を候補に出さない', () => {
    // 底ゆきの勘の呪いは「深度4までの補給−4」なので、深度10で出すと代償のない祝福になってしまう
    for (let i = 0; i < 20; i++) {
      expect(pickBlessingOptions([], makeRng(i), 3, 10).map((b) => b.id)).not.toContain('deep-diver')
    }
    const start = new Set<string>()
    for (let i = 0; i < 20; i++) for (const b of pickBlessingOptions([], makeRng(i), 3, 1)) start.add(b.id)
    expect(start.has('deep-diver')).toBe(true) // ラン開始時（深度1）には出る
  })

  it('祝福を1つも持たないランは、灯も課目も盤面も一切変わらない', () => {
    const run = createRunState([])
    expect(run.blessings).toEqual([])
    expect(blessingSupply([], 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR)
    expect(applyBlessingsToFloor(FLOORS[0], [])).toBe(FLOORS[0]) // 正典をそのまま返す
  })
})

describe('大きな肺（灯が12ふえる／補給が半分）', () => {
  it('受けた瞬間に灯が12ふえる', () => {
    const run = createRunState([])
    takeBlessing(run, 'great-lung')
    expect(run.oxygen).toBe(OXYGEN_START + 12)
  })

  it('層を出るときの補給が半分になる', () => {
    const run = createRunState([])
    takeBlessing(run, 'great-lung')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - Math.floor(OXYGEN_SUPPLY_PER_FLOOR / 2))
  })
})

describe('早鐘（最初の1手は灯を消費しない／知見の枠が1つへる）', () => {
  it('その層の最初の1手だけ灯が減らず、2手目からは減る', () => {
    const run = createRunState([])
    takeBlessing(run, 'first-bell')
    const b = new Board(plain(), run)
    setInert(b)
    b.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    const ev1 = b.tap({ x: 0, y: 3 })
    expect(run.oxygen).toBe(OXYGEN_START) // 1手目は無料
    expect(ev1.filter((e) => e.t === 'oxygen-spent').length).toBe(1) // 手を使った事実は出る
    b.at(0, 5)!.piece = { kind: 'harpoon', dir: 'h' }
    b.tap({ x: 0, y: 5 })
    expect(run.oxygen).toBe(OXYGEN_START - 1)
  })

  it('無料になるのは層ごとに1手だけ（層が変われば作り直した盤面でまた1手ぶん）', () => {
    const run = createRunState([])
    takeBlessing(run, 'first-bell')
    const first = new Board(plain(), run)
    setInert(first)
    first.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    first.tap({ x: 0, y: 3 })
    const next = new Board(plain(), run) // 次の層
    setInert(next)
    next.at(0, 3)!.piece = { kind: 'harpoon', dir: 'h' }
    next.tap({ x: 0, y: 3 })
    expect(run.oxygen).toBe(OXYGEN_START) // 2層ぶん打っても1も減っていない
  })

  it('知見の枠が8から7になる', () => {
    const run = createRunState([])
    expect(run.slots).toBe(UPGRADE_SLOTS_DEFAULT)
    takeBlessing(run, 'first-bell')
    expect(run.slots).toBe(UPGRADE_SLOTS_DEFAULT - 1)
    expect(run.slots).toBe(7)
  })
})

describe('息を殺す（奪われる灯が3から1／灯が8へる）', () => {
  it('灯喰みの一撃が1になる', () => {
    const run = createRunState([])
    takeBlessing(run, 'held-breath')
    const before = run.oxygen
    const b = new Board(plain(), run)
    b.spawnEnemy('breathstealer', [{ x: 0, y: 0 }])
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    priv(b).resolveEnemyTurn(ev)
    priv(b).resolveEnemyTurn(ev) // 周期3
    const d = ev.find((e) => e.t === 'oxygen-drained')
    expect(d && d.t === 'oxygen-drained' ? d.amount : -1).toBe(1)
    expect(run.oxygen).toBe(before - 1)
  })

  it('受けた瞬間に灯が8へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'held-breath')
    expect(run.oxygen).toBe(OXYGEN_START - 8)
  })

  it('兆候（予告）も実際に奪われる量で出る＝予告と実測が食い違わない', () => {
    const run = createRunState([])
    takeBlessing(run, 'held-breath')
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('breathstealer', [{ x: 0, y: 0 }])
    const it = enemyIntent(e, run.blessings)
    expect(it.oxygen).toBe(1)
    expect(it.label).toBe('灯−1')
    expect(enemyIntent(e).oxygen).toBe(3) // 祝福を持たないランは素の値
  })
})

describe('忘れ形見（一度だけ灯が12もどる／補給が2へる）', () => {
  it('灯が尽きた瞬間に遭難せず灯が12もどる。二度目は普通に遭難する', () => {
    const run = createRunState([])
    takeBlessing(run, 'keepsake')
    const b = new Board(plain(), run)
    run.oxygen = 0
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    const back = ev.find((e) => e.t === 'last-light')
    expect(back && back.t === 'last-light' ? back.amount : -1).toBe(12)
    expect(run.oxygen).toBe(12)
    expect(ev.some((e) => e.t === 'run-over')).toBe(false)

    run.oxygen = 0
    const ev2: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev2)
    expect(ev2.some((e) => e.t === 'last-light')).toBe(false)
    expect(ev2.filter((e) => e.t === 'run-over').length).toBe(1)
  })

  it('持っていなければ灯が尽きた時点でそのまま遭難する', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    run.oxygen = 0
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    expect(ev.filter((e) => e.t === 'run-over').length).toBe(1)
  })

  it('層を出るときの補給が2へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'keepsake')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 2)
  })
})

describe('底ゆきの勘（深度5から下は補給+4／深度4までは補給-4）', () => {
  it('深度で補給が入れ替わる', () => {
    const run = createRunState([])
    takeBlessing(run, 'deep-diver')
    expect(refillAt(run, 4)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 4) // 呪い
    expect(refillAt(run, 5)).toBe(OXYGEN_SUPPLY_PER_FLOOR + 4) // 祝福
  })
})

describe('一意専心（課目1つの層は4分の3／課目2つの層は4分の5）', () => {
  it('課目が1つだけの層は要求が減る', () => {
    const f1 = applyBlessingsToFloor(FLOORS[0], ['single-minded']) // 深度1：植物32のみ
    expect(FLOORS[0].goals[0].count).toBe(32)
    expect(f1.goals[0].count).toBe(24)
  })

  it('課目が2つある層は要求が増える。ただし盤に無い材料までは要求しない', () => {
    const f9 = applyBlessingsToFloor(FLOORS[8], ['single-minded']) // 深度9：陶片7＋植物50
    expect(f9.goals[1].count).toBe(63) // 植物は補充で湧くのでそのまま5/4
    const hako = FLOORS[8].layout.join('').split('').filter((ch) => ch === 'h').length
    expect(f9.goals[0].count).toBe(hako) // 陶片は設置数が上限（8.75→9 では詰む）
    expect(f9.goals[0].count).toBeGreaterThanOrEqual(FLOORS[8].goals[0].count)
  })

  it('殲滅の課目は編成数と一致していないと詰むので触らない', () => {
    const f5 = applyBlessingsToFloor(FLOORS[4], ['single-minded']) // 深度5：殲滅1＋植物50
    expect(f5.goals[0].type).toBe('enemy-kill')
    expect(f5.goals[0].count).toBe(FLOORS[4].goals[0].count)
  })

  it('正典（FLOORS）は書き換わらない', () => {
    applyBlessingsToFloor(FLOORS[0], ['single-minded'])
    expect(FLOORS[0].goals[0].count).toBe(32)
  })
})

describe('早足の測量（課目が2割へる／盤の四隅が欠ける）', () => {
  it('すべての層で課目の要求が2割へる', () => {
    expect(applyBlessingsToFloor(FLOORS[0], ['hasty-survey']).goals[0].count).toBe(26) // 32 → 25.6
    expect(applyBlessingsToFloor(FLOORS[2], ['hasty-survey']).goals[0].count).toBe(6) // 蔦苔8 → 6.4
  })

  it('盤の四隅が欠ける', () => {
    const f1 = applyBlessingsToFloor(FLOORS[0], ['hasty-survey'])
    expect(f1.layout[0]).toBe('#......#')
    expect(f1.layout[7]).toBe('#......#')
    expect(f1.layout[3]).toBe('........') // 欠けるのは四隅だけ
  })

  it('隅に課目の材料が置かれている層では、その隅は欠けさせない（呪いで達成不能にしない）', () => {
    const f3 = applyBlessingsToFloor(FLOORS[2], ['hasty-survey']) // 深度3：四隅が蔦苔
    expect(f3.layout[0]).toBe(FLOORS[2].layout[0])
    expect(f3.layout[7]).toBe(FLOORS[2].layout[7])
  })

  it('欠けた四隅は盤面から本当に消える', () => {
    const run = createRunState([])
    takeBlessing(run, 'hasty-survey')
    const f1 = applyBlessingsToFloor(FLOORS[0], run.blessings)
    const b = new Board(plain({ layout: f1.layout }), run)
    expect(b.at(0, 0)).toBeNull()
    expect(b.at(7, 7)).toBeNull()
    expect(b.at(1, 0)).not.toBeNull()
  })
})

describe('10層すべてが祝福つきでも組める', () => {
  it('どの祝福を受けても、全層が有効手のある盤面として立ち上がる（呪いで詰み層を作らない）', () => {
    for (const bl of BLESSINGS) {
      const run = createRunState([])
      takeBlessing(run, bl.id)
      for (let floor = 1; floor <= FLOORS.length; floor++) {
        run.floor = floor
        const def = applyBlessingsToFloor(FLOORS[floor - 1], run.blessings)
        const b = new Board({ id: floor, seed: 1234 + floor, moves: 9999, colors: 5, goals: def.goals, layout: def.layout }, run, def)
        expect(b.validMoves().length, `${bl.id} 深度${floor}`).toBeGreaterThan(0)
        // 課目の要求は、盤に置かれた材料の数を超えない（超えるとその層で永久に足踏みになる）
        b.goals.forEach((g) => {
          if (g.type === 'tsutagoke') {
            const layers = def.layout.join('').split('').reduce((n, ch) => n + (ch === 'g' ? 1 : ch === 'G' ? 2 : 0), 0)
            expect(g.count, `${bl.id} 深度${floor} 蔦苔`).toBeLessThanOrEqual(layers)
          }
          if (g.type === 'touhen') {
            const hako = def.layout.join('').split('').filter((ch) => ch === 'h').length
            expect(g.count, `${bl.id} 深度${floor} 陶片`).toBeLessThanOrEqual(hako)
          }
          if (g.type === 'enemy-kill') expect(g.count, `${bl.id} 深度${floor} 殲滅`).toBe(b.enemies.length)
        })
      }
    }
  })
})

describe('祝福の上限', () => {
  it('同じ祝福は二度受けられない', () => {
    const run = createRunState([])
    takeBlessing(run, 'first-bell')
    takeBlessing(run, 'first-bell')
    expect(run.blessings).toEqual(['first-bell'])
    expect(run.slots).toBe(UPGRADE_SLOTS_DEFAULT - 1) // 枠が二重に潰れない
  })

  it('灯の代償で「受けた瞬間に尽きる」ことはない', () => {
    const run = createRunState([])
    run.oxygen = 3
    takeBlessing(run, 'held-breath') // -8
    expect(run.oxygen).toBe(1)
  })
})
