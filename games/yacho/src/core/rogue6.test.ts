// 夜間監査(codex_audit_night.md)対応のエンジン層テスト。
// [C]1模倣の粘菌 [C]2磁気採掘 [C]3遺物共鳴 [C]4過回転 [C]6採掘慣れ の実挙動修正、
// [B][C]5因果グラフのデータ化(consumes/produces)、[C]10/15スターター配布の適正化を検証する。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState, STARTER_UPGRADE_IDS } from './run'
import { FLOORS } from './floors'
import { AUTONOMOUS_MECHANISM_ID, MAGNETIC_MINING_ID, MIMIC_SLIME_ID, PREHEAT_ID, RELIC_RESONANCE_ID, RESOURCES, UPGRADES } from './upgrades'
import type { LevelDef, Piece, XY } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** rogue.test.ts と同じ流儀のテスト用盤面組み立て（v=爆発鉱石を追加） */
function setPieces(b: Board, rows: string[]) {
  const map: Record<string, Piece | null> = {
    '.': null,
    '0': { kind: 'normal', color: 0 },
    '1': { kind: 'normal', color: 1 },
    '2': { kind: 'normal', color: 2 },
    '3': { kind: 'normal', color: 3 },
    '4': { kind: 'normal', color: 4 },
    v: { kind: 'normal', color: 2, volatile: true },
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = structuredClone(map[rows[y][x]]) ?? null
    }
}

/** 市松で絶対にマッチしない充填（0/1交互 + 3色目で行を分ける） */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

describe('模倣の粘菌（夜間監査[C]1：関数クロージャではなくデータで再現する）', () => {
  it('別の手（別のev配列）で再発動しても、直前の手のフック効果が"今の"イベント列とctxへ正しく書き込まれる', () => {
    const run = createRunState(['mining-habit', MIMIC_SLIME_ID])
    const b = new Board(plain(), run)
    const enemy = b.spawnEnemy('rockshell', [{ x: 7, y: 7 }])
    // 1手目：鉱物3連 → 採掘慣れが発火し、lastHookReplayへスナップショット（データのみ）が積まれる
    setPieces(b, ['21223131', ...inert().slice(1)])
    const ev1 = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev1.some((e) => e.t === 'upgrade-fire' && e.id === 'mining-habit')).toBe(true)
    expect(enemy.hp).toBe(6 - 2) // 岩殻獣のHPは6（SPEC_OXYGEN.md §1.4 で 8→6）。採掘慣れの-2は不変
    // 2手目（別の swap 呼び出し＝別の ev 配列）：遺物3連を直接設置し、無関係な1手で拾わせる。
    // 模倣の粘菌が発火し、直前の採掘慣れ（1手目に発動）をもう一度「今のev・今のctx」で再実行するはず。
    // 修正前は発生時の古いev（ev1、既に呼び出し元へ返却済み）を握った関数を実行していたため、
    // ev2には何も書き込まれず見かけ上の空振りになっていた。
    b.at(0, 0)!.piece = { kind: 'normal', color: 3 }
    b.at(1, 0)!.piece = { kind: 'normal', color: 3 }
    b.at(2, 0)!.piece = { kind: 'normal', color: 3 }
    b.at(3, 0)!.piece = { kind: 'normal', color: 1 } // ランに巻き込まれないよう境界を非遺物色にする
    const ev2 = b.swap({ x: 3, y: 4 }, { x: 4, y: 4 }) // 盤面の別の場所での無関係な1手（row0のマッチが拾われる）
    expect(ev2.some((e) => e.t === 'upgrade-fire' && e.id === MIMIC_SLIME_ID)).toBe(true)
    // 模倣の粘菌が「採掘慣れ」を再現した証拠：ev2自身にupgrade-fire(mining-habit)とenemy-damageが積まれている
    expect(ev2.some((e) => e.t === 'upgrade-fire' && e.id === 'mining-habit')).toBe(true)
    expect(ev2.some((e) => e.t === 'enemy-damage' && e.id === enemy.id)).toBe(true)
    expect(enemy.hp).toBe(6 - 2 - 2) // 1手目の-2 + 再現された-2
  })
})

describe('磁気採掘（夜間監査[C]2：実際に「充填」して2倍を実現する）', () => {
  it('爆発に巻きこまれたギアは破壊されず、充填済み(chargedGear)になって盤面に残る', () => {
    const run = createRunState([MAGNETIC_MINING_ID])
    const b = new Board(plain(), run)
    setPieces(b, [
      '13413413',
      '34134134',
      '41301341', // (3,2)=ギア。爆発の巻き添え候補（周囲は非0色なので孤立していて誤マッチしない）
      '132v2413', // (2,3)(3,3)=爆発鉱石(4,3) の3連。爆発の十字が(3,2)まで届く
      '34134134',
      '41341341',
      '13413413',
      '34134134',
    ])
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 }) // 盤面の別の場所での無害な1手（既存のrow3マッチが拾われる）
    expect(ev.some((e) => e.t === 'explode')).toBe(true)
    expect(ev.some((e) => e.t === 'gear-charged' && e.at.x === 3 && e.at.y === 2)).toBe(true)
    // charged は駒(Piece)側のフラグ（夜間監査[C]2で発見：セル側に持たせると重力で駒だけ移動しフラグが
    // 取り残される不具合があったため駒側に統一した）。盤面全体から「破壊されず生き残ったギア」を確認する。
    let chargedCount = 0
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = b.at(x, y)?.piece
        if (p?.kind === 'normal' && p.charged) {
          chargedCount++
          expect(p.color).toBe(0)
        }
      }
    expect(chargedCount).toBe(1)
  })

  it('充填済みギアを含むマッチは、そのマッチから出るギア起動回数が2倍になる', () => {
    const run = createRunState([MAGNETIC_MINING_ID])
    const b = new Board(plain(), run)
    setPieces(b, ['01003131', ...inert().slice(1)]) // swapでx1..x3にギア3連ができる（rogue.test.tsと同型）
    const chargedPiece = b.at(2, 0)!.piece
    if (chargedPiece?.kind === 'normal') chargedPiece.charged = true // 充填済み状態を直接付与（発生経路は別テストで検証済み）
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    // 通常なら3個のギアが消えてgear-triggerが3回。充填済みが1つ混ざっているため、このマッチ分は2倍の6回になる。
    expect(ev.filter((e) => e.t === 'gear-trigger').length).toBe(6)
    expect(run.gearCharge).toBe(6)
    // 充填済みギアはマッチで消費されて盤面から消えている＝どこにも charged:true の駒が残っていない
    let chargedRemaining = 0
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = b.at(x, y)?.piece
        if (p?.kind === 'normal' && p.charged) chargedRemaining++
      }
    expect(chargedRemaining).toBe(0)
  })
})

describe('遺物共鳴（夜間監査[C]3：全遺物フックへ共通適用する）', () => {
  it('変換炉以外（相乗りする遺物強化）にも2倍が効く', () => {
    const run = createRunState([RELIC_RESONANCE_ID, 'relic-root'])
    const b = new Board(plain(), run)
    run.relicBoostNext = true // ブースト待機中を直接用意（発生源=gearTriggerフックは既存テストで検証済み）
    setPieces(b, ['33301010', ...inert().slice(1)]) // row0: 遺物(色3)の3連が既に成立
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 }) // 無関係な1手で拾われる
    const fires = ev.filter((e) => e.t === 'upgrade-fire' && e.id === 'relic-root')
    // 以前は「次の遺物マッチ2倍」の消費が変換炉のtakeRelicBoost()呼び出しにしか無く、
    // relic-root（消費を読まない強化）は常に1回だった。修正後はfireMatchHooksが一元的に2回呼ぶ。
    expect(fires.length).toBe(2)
    expect(run.relicBoostNext).toBe(false) // 消費済み
  })

  it('ブーストが無ければ通常どおり1回だけ発動する（対照）', () => {
    // 遺物共鳴のスターターは取得直後に自動でブーストを1回仕込む（原則2）ため、遺物共鳴自体は持たせない。
    const run = createRunState(['relic-root'])
    const b = new Board(plain(), run)
    setPieces(b, ['33301010', ...inert().slice(1)])
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 })
    const fires = ev.filter((e) => e.t === 'upgrade-fire' && e.id === 'relic-root')
    expect(fires.length).toBe(1)
  })
})

describe('過回転（夜間監査[C]4：数値ではなく盤面の因果に置換）', () => {
  it('ギアをそろえて消すと、最も遠いギア駒1個を実際に消して起動する', () => {
    const run = createRunState(['overrev'])
    const b = new Board(plain(), run)
    setPieces(b, ['01003131', ...inert().slice(1)]) // x1..x3にギア3連（原点はおよそ(2,0)）
    b.at(7, 7)!.piece = { kind: 'normal', color: 0 } // 盤面上で最も遠い孤立ギア（他に0は無いよう配置済みの盤で確認）
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    const gearTriggers = ev.filter((e) => e.t === 'gear-trigger')
    // 通常のマッチ由来3回 + 過回転が(7,7)を遠隔起動した1回 = 4回。旧実装はchain+=1で盤面が一切動かなかった。
    expect(gearTriggers.length).toBe(4)
    expect(gearTriggers.some((e) => e.t === 'gear-trigger' && e.at.x === 7 && e.at.y === 7)).toBe(true)
  })
})

describe('採掘慣れの説明文（夜間監査[C]6：実装と一致させる）', () => {
  it('descが「鉱物をそろえて消すと、最寄りの原生種に2ダメージ」になっている（甲殻/岩専用ではない実装に合わせた）', () => {
    const def = UPGRADES.find((u) => u.id === 'mining-habit')
    expect(def?.desc).toBe('鉱物をそろえて消すと、最寄りの原生種に2ダメージ')
  })
})

describe('因果グラフのデータ化（夜間監査[B][C]5）', () => {
  it('全20種にconsumes/producesが定義されており、語彙はRESOURCESの範囲に収まっている', () => {
    expect(UPGRADES.length).toBe(20)
    for (const u of UPGRADES) {
      expect(u.consumes).toBeDefined()
      expect(u.produces).toBeDefined()
      for (const r of [...(u.consumes ?? []), ...(u.produces ?? [])]) {
        expect(RESOURCES).toContain(r)
      }
    }
  })
})

describe('スターター配布プールの限定（夜間監査[C]10/15）', () => {
  it('単体で即座に盤面を動かす8種に限定されている', () => {
    expect(new Set(STARTER_UPGRADE_IDS)).toEqual(
      new Set(['spore-bloom', 'fungal-awakening', 'deep-breath', 'mining-habit', AUTONOMOUS_MECHANISM_ID, PREHEAT_ID, 'transformation-furnace', 'relic-root']),
    )
  })
})

describe('スターター量を1個に統一（夜間監査[C]10/[D]強化側4）', () => {
  it('共振破砕・模倣の粘菌のスターターは対象物を1個だけ生成する', () => {
    // plain()はfillInitial()で全マスがランダムな5色で埋まるため、盤面全体を色でスキャンする方式だと
    // 偶然の一致（元々色3/2volatileの駒が別途存在する）を拾ってしまう。各スターターが積んだ
    // special-bornイベントの数（＝実際に変換した駒の数）で数える方が正確。
    const run = createRunState(['resonant-shatter', MIMIC_SLIME_ID])
    const b = new Board(plain(), run)
    const countSpecialBornAfter = (id: string) => {
      const startIdx = b.initEvents.findIndex((e) => e.t === 'upgrade-fire' && e.id === id)
      expect(startIdx).toBeGreaterThanOrEqual(0)
      let endIdx = b.initEvents.length
      for (let i = startIdx + 1; i < b.initEvents.length; i++) {
        if (b.initEvents[i].t === 'upgrade-fire') {
          endIdx = i
          break
        }
      }
      return b.initEvents.slice(startIdx + 1, endIdx).filter((e) => e.t === 'special-born').length
    }
    expect(countSpecialBornAfter('resonant-shatter')).toBe(1)
    expect(countSpecialBornAfter(MIMIC_SLIME_ID)).toBe(1)
  })

  it('磁気採掘のスターターは充填済みギアを1個だけ置く', () => {
    const run = createRunState([MAGNETIC_MINING_ID])
    const b = new Board(plain(), run)
    let charged = 0
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = b.at(x, y)?.piece
        if (p?.kind === 'normal' && p.charged) charged++
      }
    expect(charged).toBe(1)
  })
})

describe('スターター配置：本体をすぐ試せる位置（夜間監査[C]10）', () => {
  it('毒胞子のスターター胞子は敵のとなりに置かれる', () => {
    const run = createRunState(['toxic-spore'])
    // 層1は敵ゼロになった（§1.5）ので、敵のいる層2（swarm×4）で「敵のとなりに置く」を見る
    const b = new Board(plain(), run, FLOORS[1])
    let spot: XY | null = null
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.sporeToken) spot = { x, y }
    expect(spot).not.toBeNull()
    const isEnemy = (p: XY) => b.at(p.x, p.y)?.block?.type === 'enemy'
    const adjacentToEnemy =
      isEnemy({ x: spot!.x - 1, y: spot!.y }) || isEnemy({ x: spot!.x + 1, y: spot!.y }) || isEnemy({ x: spot!.x, y: spot!.y - 1 }) || isEnemy({ x: spot!.x, y: spot!.y + 1 })
    expect(adjacentToEnemy).toBe(true)
  })

  it('根食い鉱のスターター胞子は鉱物のとなりに置かれる', () => {
    const run = createRunState(['root-eating-ore'])
    const b = new Board(plain(), run, FLOORS[0])
    let spot: XY | null = null
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.sporeToken) spot = { x, y }
    expect(spot).not.toBeNull()
    const isOre = (p: XY) => {
      const piece = b.at(p.x, p.y)?.piece
      return piece?.kind === 'normal' && piece.color === 2 && !piece.volatile
    }
    const adjacentToOre =
      isOre({ x: spot!.x - 1, y: spot!.y }) || isOre({ x: spot!.x + 1, y: spot!.y }) || isOre({ x: spot!.x, y: spot!.y - 1 }) || isOre({ x: spot!.x, y: spot!.y + 1 })
    expect(adjacentToOre).toBe(true)
  })
})
