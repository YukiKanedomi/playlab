// 祝福と呪い（PHASE2.md §3・工程2の再設計）のエンジン層テスト。
// 祝福は9種あり、どれも「利点1行」と「代償1行」の対なので、1種につき**両方が実際に効いている**ことを見る。
// 再設計の規則＝祝福は盤面・駒・原生種に見える挙動（発火点は層開始の一度だけ）、呪いは会計（補給・灯・器・枠）。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import {
  BLESSINGS,
  blessingBoardFx,
  blessingSupply,
  isBlessingFloor,
  pickBlessingOptions,
  takeBlessing,
} from './blessings'
import { createRunState, LAMP_MAX_START, OXYGEN_START, OXYGEN_SUPPLY_PER_FLOOR } from './run'
import { enemyIntent, turnsUntilAction } from './enemies'
import { FLOORS, type FloorDef } from './floors'
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

/** 敵入りの層定義（floor-start の盤面効果は Board 構築時に適用されるので、敵はこの経路で置く） */
const floorWith = (enemies: FloorDef['enemies']): FloorDef => ({
  floor: 1,
  enemies,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
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

/** 層クリアを起こして補給量を取る（補給は checkFloorClear の中でしか起きない）。
 *  灯は器（lampMax）から離しておく＝ここで見るのは祝福による補給の増減だけで、クランプは oxygen.test.ts が見る */
function refillAt(run: ReturnType<typeof createRunState>, floor: number): number {
  run.floor = floor
  run.oxygen = 20
  const b = new Board(plain({ goals: [{ type: 'color', color: 0, count: 1 }] }), run)
  b.goalDone[0] = 1
  const ev: BoardEvent[] = []
  priv(b).checkFloorClear(ev)
  return refillOf(ev)
}

/** 盤上の駒を条件で数える（火の脈・置き銛の「層開始時に置かれている」の確認用） */
function countPieces(b: Board, pred: (p: Piece) => boolean): number {
  let n = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const p = b.at(x, y)?.piece
      if (p && pred(p)) n++
    }
  return n
}

describe('祝福の枠組み', () => {
  it('9種あり、どれも利点と代償の両方を文で持っている（隠しデメリットを作らない）', () => {
    expect(BLESSINGS.length).toBe(9)
    for (const b of BLESSINGS) {
      expect(b.boon.length).toBeGreaterThan(0)
      expect(b.curse.length).toBeGreaterThan(0)
    }
    expect(new Set(BLESSINGS.map((b) => b.id)).size).toBe(BLESSINGS.length)
  })

  it('呪いはすべて会計（補給・灯・器・枠）＝盤面を触る呪いを作らない', () => {
    for (const b of BLESSINGS) {
      const accounting = (b.supply !== undefined || (b.light ?? 0) < 0 || (b.lampMax ?? 0) < 0 || (b.slots ?? 0) < 0)
      expect(accounting, `${b.id} の呪いが会計になっていない`).toBe(true)
    }
  })

  it('幕主の深度10・20・30の後だけ祝福を選ぶ（開始時の祝福は廃止）', () => {
    expect(isBlessingFloor(10)).toBe(true)
    expect(isBlessingFloor(20)).toBe(true)
    expect(isBlessingFloor(30)).toBe(true)
    expect(isBlessingFloor(1)).toBe(false)
    expect(isBlessingFloor(9)).toBe(false)
    expect(isBlessingFloor(31)).toBe(false)
  })

  it('候補に所持済みは出ない（同名重複なし）', () => {
    const opts = pickBlessingOptions(['great-lung', 'fire-vein'], makeRng(3))
    expect(opts.length).toBe(3)
    expect(opts.map((b) => b.id)).not.toContain('great-lung')
    expect(new Set(opts.map((b) => b.id)).size).toBe(3)
  })

  it('祝福を1つも持たないランは、灯も補給も盤面も一切変わらない', () => {
    const run = createRunState([])
    expect(run.blessings).toEqual([])
    expect(blessingSupply([], 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR)
    const fx = blessingBoardFx([])
    expect(fx).toEqual({ oreSeeds: 0, harpoons: 0, sporeTokens: 0, wound: 0, wakeDelay: 0 })
    const b = new Board(plain(), run)
    expect(countPieces(b, (p) => p.kind !== 'normal')).toBe(0)
    expect(countPieces(b, (p) => p.kind === 'normal' && p.volatile === true)).toBe(0)
  })
})

describe('大きな肺（灯の器が12ひろがり灯も12ふえる／補給が1へる）', () => {
  it('受けた瞬間に器（lampMax）が12ひろがり、灯も12ふえる（広がった器は超えない）', () => {
    const run = createRunState([])
    takeBlessing(run, 'great-lung')
    expect(run.lampMax).toBe(LAMP_MAX_START + 12)
    expect(run.oxygen).toBe(Math.min(OXYGEN_START + 12, run.lampMax))
  })

  it('層を出るときの補給が1へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'great-lung')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 1)
  })
})

describe('息を殺す（奪われる灯が3から1／灯が6へる）', () => {
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

  it('受けた瞬間に灯が6へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'held-breath')
    expect(run.oxygen).toBe(OXYGEN_START - 6)
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

describe('忘れ形見（一度だけ灯が16もどる／補給が1へる）', () => {
  it('灯が尽きた瞬間に遭難せず灯が16もどる。二度目は普通に遭難する', () => {
    const run = createRunState([])
    takeBlessing(run, 'keepsake')
    const b = new Board(plain(), run)
    run.oxygen = 0
    const ev: BoardEvent[] = []
    priv(b).resolveEnemyTurn(ev)
    const back = ev.find((e) => e.t === 'last-light')
    expect(back && back.t === 'last-light' ? back.amount : -1).toBe(16)
    expect(run.oxygen).toBe(16)
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

  it('層を出るときの補給が1へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'keepsake')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 1)
  })
})

describe('火の脈（層開始時に爆発鉱石5つ／補給が1へる）', () => {
  it('層開始時、盤に爆発鉱石がちょうど5つ埋まっている（鉱物色のまま）', () => {
    const run = createRunState([])
    takeBlessing(run, 'fire-vein')
    const b = new Board(plain(), run)
    expect(countPieces(b, (p) => p.kind === 'normal' && p.volatile === true)).toBe(5)
    expect(countPieces(b, (p) => p.kind === 'normal' && p.volatile === true && p.color === 2)).toBe(5)
    // ビューが「取った瞬間から画面で分かる」ための実況（special-born）も出る
    expect(b.initEvents.filter((e) => e.t === 'special-born').length).toBe(5)
  })

  it('層を出るときの補給が1へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'fire-vein')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 1)
  })
})

describe('置き銛（層開始時に銛2本／灯の器が4せばまる）', () => {
  it('層開始時、盤に銛がちょうど2本置かれている', () => {
    const run = createRunState([])
    takeBlessing(run, 'set-harpoon')
    const b = new Board(plain(), run)
    expect(countPieces(b, (p) => p.kind === 'harpoon')).toBe(2)
  })

  it('層が変われば（＝盤面を作り直せば）また2本置かれる', () => {
    const run = createRunState([])
    takeBlessing(run, 'set-harpoon')
    new Board(plain(), run)
    const next = new Board(plain({ seed: 43 }), run)
    expect(countPieces(next, (p) => p.kind === 'harpoon')).toBe(2)
  })

  it('灯の器が4せばまり、器からあふれた灯はその場で削れる', () => {
    const run = createRunState([])
    run.oxygen = run.lampMax // 満タンから受ける＝あふれるケース
    takeBlessing(run, 'set-harpoon')
    expect(run.lampMax).toBe(LAMP_MAX_START - 4)
    expect(run.oxygen).toBe(run.lampMax)
  })
})

describe('光の名残（層開始時に光胞子トークン4つ／補給が1へる）', () => {
  it('層開始時、盤に光胞子トークンがちょうど4つ落ちている', () => {
    const run = createRunState([])
    takeBlessing(run, 'spore-trail')
    const b = new Board(plain(), run)
    let n = 0
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.sporeToken) n++
    expect(n).toBe(4)
    expect(b.initEvents.filter((e) => e.t === 'token-spawn').length).toBe(4)
  })

  it('層を出るときの補給が1へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'spore-trail')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 1)
  })
})

describe('先手の礫（層開始時に全原生種が1の傷／灯の器が4せばまる）', () => {
  it('層開始時、すべての原生種がHP-1で始まる', () => {
    const run = createRunState([])
    takeBlessing(run, 'first-strike')
    const b = new Board(
      plain(),
      run,
      floorWith([
        { kind: 'swarm', at: { x: 1, y: 1 } },
        { kind: 'breathstealer', at: { x: 6, y: 6 } },
      ]),
    )
    for (const e of b.enemies) expect(e.hp, e.kind).toBe(e.maxHp - 1)
    expect(b.initEvents.filter((e) => e.t === 'enemy-damage').length).toBe(2)
  })

  it('殻もち（鐘脚）は殻が1枚剥がれて始まる（本体HPはそのまま＝殻の規則を破らない）', () => {
    const run = createRunState([])
    takeBlessing(run, 'first-strike')
    const b = new Board(plain(), run, floorWith([{ kind: 'bellfoot', at: { x: 4, y: 4 } }]))
    const e = b.enemies[0]
    expect(e.shell).toBe(1) // BELLFOOT_SHELL_MAX(2) - 1
    expect(e.hp).toBe(e.maxHp)
  })

  it('灯の器が4せばまる', () => {
    const run = createRunState([])
    takeBlessing(run, 'first-strike')
    expect(run.lampMax).toBe(LAMP_MAX_START - 4)
  })
})

describe('眠りの帳（原生種の目覚めが4手おそい／補給が1へる）', () => {
  it('灯喰み（周期3）が6手では動かず、7手目に初めて灯を奪う。以後は素の周期に戻る', () => {
    const run = createRunState([])
    takeBlessing(run, 'slow-wake')
    const b = new Board(plain(), run, floorWith([{ kind: 'breathstealer', at: { x: 0, y: 0 } }]))
    const ev: BoardEvent[] = []
    for (let i = 0; i < 6; i++) priv(b).resolveEnemyTurn(ev)
    expect(ev.some((e) => e.t === 'oxygen-drained')).toBe(false) // 6手目まで眠っている
    priv(b).resolveEnemyTurn(ev) // 7手目＝初回の発火
    expect(ev.filter((e) => e.t === 'oxygen-drained').length).toBe(1)
    const ev2: BoardEvent[] = []
    for (let i = 0; i < 3; i++) priv(b).resolveEnemyTurn(ev2) // 目覚めた後は素の周期3
    expect(ev2.filter((e) => e.t === 'oxygen-drained').length).toBe(1)
  })

  it('兆候（残り手数）も遅れた実際の値で出る＝予告と実測が食い違わない', () => {
    const run = createRunState([])
    takeBlessing(run, 'slow-wake')
    const b = new Board(plain(), run, floorWith([{ kind: 'breathstealer', at: { x: 0, y: 0 } }]))
    expect(turnsUntilAction(b.enemies[0])).toBe(7) // 素の3 + 遅れ4
  })

  it('層を出るときの補給が1へる', () => {
    const run = createRunState([])
    takeBlessing(run, 'slow-wake')
    expect(refillAt(run, 1)).toBe(OXYGEN_SUPPLY_PER_FLOOR - 1)
  })
})

describe('大喰らい（4つ以上そろえるたび灯+1／知見の枠が1つへる）', () => {
  /** 横一列の4連マッチを1手で作る：y=0 に [c,c,_,c]、(2,1) に c を置いて (2,0)⇄(2,1) をスワップする */
  function bigMatchBoard(run: ReturnType<typeof createRunState>): Board {
    const b = new Board(plain(), run)
    setInert(b)
    const c: Piece = { kind: 'normal', color: 4 } // 市松（色0〜3）に出ない色で干渉を断つ
    b.at(0, 0)!.piece = { ...c }
    b.at(1, 0)!.piece = { ...c }
    b.at(3, 0)!.piece = { ...c }
    b.at(2, 1)!.piece = { ...c }
    return b
  }

  it('4連を作った手は灯が1ともる（1手の消費-1と相殺して差し引き0）', () => {
    const run = createRunState([])
    takeBlessing(run, 'big-catch')
    run.oxygen = 20
    const b = bigMatchBoard(run)
    const ev = b.swap({ x: 2, y: 0 }, { x: 2, y: 1 })
    const bonus = ev.find((e) => e.t === 'lamp-bonus')
    expect(bonus && bonus.t === 'lamp-bonus' ? bonus.amount : -1).toBe(1)
    expect(run.oxygen).toBe(20) // -1（手）+1（大喰らい）
  })

  it('3個のマッチではともらない', () => {
    const run = createRunState([])
    takeBlessing(run, 'big-catch')
    run.oxygen = 20
    const b = new Board(plain(), run)
    setInert(b)
    const c: Piece = { kind: 'normal', color: 4 }
    b.at(0, 0)!.piece = { ...c }
    b.at(1, 0)!.piece = { ...c }
    b.at(2, 1)!.piece = { ...c }
    const ev = b.swap({ x: 2, y: 0 }, { x: 2, y: 1 })
    expect(ev.some((e) => e.t === 'match')).toBe(true)
    expect(ev.some((e) => e.t === 'lamp-bonus')).toBe(false)
    expect(run.oxygen).toBe(19)
  })

  it('灯が満タン（器いっぱい）なら何も出さない＝「+0」の嘘の実況を作らない', () => {
    const run = createRunState([])
    takeBlessing(run, 'big-catch')
    const b = bigMatchBoard(run)
    run.oxygen = run.lampMax + 1 // スワップの消費-1で満タンちょうどになる
    const ev = b.swap({ x: 2, y: 0 }, { x: 2, y: 1 })
    expect(ev.some((e) => e.t === 'lamp-bonus')).toBe(false)
    expect(run.oxygen).toBe(run.lampMax)
  })

  it('持っていないランでは4連でも何も起きない', () => {
    const run = createRunState([])
    run.oxygen = 20
    const b = bigMatchBoard(run)
    const ev = b.swap({ x: 2, y: 0 }, { x: 2, y: 1 })
    expect(ev.some((e) => e.t === 'lamp-bonus')).toBe(false)
    expect(run.oxygen).toBe(19)
  })

  it('呪い＝層を出るときの補給が1へる（旧「枠が1つへる」は枠制限の一時停止で差し替え 2026-08-15）', () => {
    const run = createRunState([])
    takeBlessing(run, 'big-catch')
    expect(blessingSupply(run.blessings, 1)).toBe(blessingSupply([], 1) - 1)
  })
})

describe('全層すべてが祝福つきでも組める', () => {
  it('どの祝福を受けても、全層が有効手のある盤面として立ち上がる（祝福で詰み層を作らない）', () => {
    for (const bl of BLESSINGS) {
      const run = createRunState([])
      takeBlessing(run, bl.id)
      for (let floor = 1; floor <= FLOORS.length; floor++) {
        run.floor = floor
        run.oxygen = 40 // 灯の代償で序盤に尽きないよう毎層戻す（見るのは盤面の成立性だけ）
        const def = FLOORS[floor - 1]
        const b = new Board({ id: floor, seed: 1234 + floor, moves: 9999, colors: 5, goals: def.goals, layout: def.layout }, run, def)
        expect(b.validMoves().length + b.specialsOnBoard().length, `${bl.id} 深度${floor}`).toBeGreaterThan(0)
      }
    }
  })
})

describe('祝福の上限', () => {
  it('同じ祝福は二度受けられない', () => {
    const run = createRunState([])
    takeBlessing(run, 'big-catch')
    takeBlessing(run, 'big-catch')
    expect(run.blessings).toEqual(['big-catch'])
    expect(blessingSupply(run.blessings, 1)).toBe(blessingSupply([], 1) - 1) // 呪いが二重にかからない
  })

  it('灯の代償で「受けた瞬間に尽きる」ことはない', () => {
    const run = createRunState([])
    run.oxygen = 3
    takeBlessing(run, 'held-breath') // -6
    expect(run.oxygen).toBe(1)
  })
})
