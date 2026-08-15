// 進行曲線の計測スクリプト（夜間監査[B][D]対応）。
// FLOORS の全層（30層＋終幕31）を通しで自動プレイし、深度別に次を記録する：
//   1手あたりの強化発火数 / 最大連鎖 / 1手最大破壊数 / swarm伝播による撃破数（ビルド由来と分離） / 残酸素 / 到達率
// ドラフトは main.ts の pickDraftOptions と同じ規則（UPGRADE_CATEGORY一致 or フック種一致＝シナジー2枠＋無関係1枠）を
// ここに複製して使う。main.ts/view は Pixi 依存でNodeから直接importできない上、core は元々Pixi非依存の設計
// （board.tsの冒頭コメント参照）なので、ロジックだけを同等実装として core 側に置く（UIコードは一切importしない）。
//
// テストとして常時実行はしない（100+シードのフル31層プレイは重いため）。単発で明示的に実行する：
//   npx esbuild games/yacho/src/core/runsim.ts --bundle --platform=node --format=esm --outfile=<tmp>/runsim.mjs
//   node <tmp>/runsim.mjs [seeds] > games/yacho/assets_src/_runsim.txt
// （seeds省略時は120。このファイル自体はNode専用ツールで、main.ts/viewからは一切importされない）
import { pathToFileURL } from 'node:url'
import { Board, H, REFILL_BIAS, setRefillBias, W } from './board'
import { createRunState, discardUpgrade, takeUpgrade, type RunState } from './run'
import { blessingSupply, isBlessingFloor, pickBlessingOptions, takeBlessing } from './blessings'
import { FLOORS, type FloorDef } from './floors'
import { UPGRADES, type UpgradeDef } from './upgrades'
import { makeRng, randInt, type Rng } from './rng'
import { connectedOwned, pickDraftOptions } from './draft'
import { applyDeepen, applyFusion, deepenOptions, fusionOptions, PHASE28_ENABLED } from './fusion'
import { systemOf, type System } from './hooks'
import type { BoardEvent, Color, GoalType, LevelDef, XY } from './types'

// ---- ドラフト抽選は core/draft.ts に一本化済み（UIと計測で同じ規則を使う） ----
// 監査[B]：旧実装は同系統/同フック種を疑似シナジーとしており、閉ループの部品が届く保証がなかった

/** ドラフト選択：所持とシナジーする候補があればその中から、無ければ3択からランダムに1つ選ぶ（そこそこ上手い人の代用） */
function pickDraftChoice(owned: UpgradeDef[], options: UpgradeDef[], rng: Rng): UpgradeDef {
  const synergistic = options.filter((o) => connectedOwned(owned, o).length > 0)
  const pool = synergistic.length > 0 ? synergistic : options
  return pool[randInt(rng, pool.length)]
}

/**
 * 枠が埋まったときに手放す1つを選ぶ（PHASE2.md §2「取る＝捨てる」のソルバー側の規則）。
 * 規則：**このランで発火回数が最も少なかった知見を捨てる。同数なら先に採録したもの（古い方）**。
 * run.upgrades は採録順なので、strict `<` で走査すれば同数のとき先頭側が残り＝古い方が捨てられる。
 */
function pickDiscard(run: RunState, fires: Map<string, number>): string {
  let worst = run.upgrades[0]
  for (const id of run.upgrades) if ((fires.get(id) ?? 0) < (fires.get(worst) ?? 0)) worst = id
  return worst
}

// ---- 手選択（solver.ts の「そこそこ上手い人」ヒューリスティックを踏襲。未達成の目標に効くマスへの近さで優先する） ----

/**
 * まだ埋まっていない目標に効くマスを集める（SPEC_OXYGEN.md §10.1）。
 * 敵セルだけを見ていると目標駆動の層が実質ランダムプレイの計測になるため、目標の種類ごとに狙い先を足す。
 */
function targetCells(b: Board): XY[] {
  const want = (t: GoalType) => b.goals.some((g, i) => g.type === t && b.goalDone[i] < g.count)
  const wantSystems = new Set<System>()
  const wantColors = new Set<Color>()
  b.goals.forEach((g, i) => {
    if (b.goalDone[i] >= g.count) return
    if (g.type === 'system' && g.system) wantSystems.add(g.system)
    if (g.type === 'color' && g.color !== undefined) wantColors.add(g.color)
  })
  const out: XY[] = []
  if (want('enemy-kill')) for (const e of b.enemies) out.push(...e.cells)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (!c) continue
      if (c.ground > 0 && want('tsutagoke')) out.push({ x, y })
      if ((c.block?.type === 'hako' || c.block?.type === 'touhen') && want('touhen')) out.push({ x, y })
      if (c.block?.type === 'kokeishi' && want('kokeishi')) out.push({ x, y })
      // 光胞子（第二幕の新課目）：巣灯を叩かないと胞子が生まれないので、巣灯そのものを狙い先に入れる
      if (c.block?.type === 'subi' && want('spore')) out.push({ x, y })
      const p = c.piece
      if (p?.kind === 'normal' && (wantColors.has(p.color) || wantSystems.has(systemOf(p.color)))) out.push({ x, y })
    }
  return out
}

function pickMove(b: Board, rng: Rng): { tap?: XY; swap?: { a: XY; b: XY } } | null {
  const specials = b.specialsOnBoard()
  if (specials.length > 0 && rng() < 0.8) {
    for (const s of specials) {
      const n = specials.find((q) => q !== s && Math.abs(q.x - s.x) + Math.abs(q.y - s.y) === 1)
      if (n) return { swap: { a: s, b: n } }
    }
    return { tap: specials[randInt(rng, specials.length)] }
  }
  const moves = b.validMoves()
  // スワップが尽きても特殊駒が残っていればタップで盤面は動く。ここで諦めると
  // 実際には打てる局面が stuck として計上される（§10.3 の「stuck 0件」はソルバー側の限界を見る指標）
  if (moves.length === 0) return specials.length > 0 ? { tap: specials[randInt(rng, specials.length)] } : null
  const targets = targetCells(b)
  if (targets.length > 0) {
    let best: { m: { a: XY; b: XY }; d: number } | null = null
    for (const m of moves) {
      let d = Infinity
      for (const g of targets) {
        for (const p of [m.a, m.b]) {
          const dist = Math.abs(p.x - g.x) + Math.abs(p.y - g.y)
          if (dist < d) d = dist
        }
      }
      if (!best || d < best.d || (d === best.d && rng() < 0.5)) best = { m, d }
    }
    if (best) return { swap: best.m }
  }
  return { swap: moves[randInt(rng, moves.length)] }
}

/** 1層ぶんの盤面定義。main.ts:buildFloorLevelDef と同じ（目標とレイアウトは FLOORS から流す。手数はローグでは未使用） */
const buildFloorLevelDef = (floor: number, seed: number, def: FloorDef): LevelDef => ({
  id: floor,
  seed,
  moves: 9999,
  colors: 5,
  goals: def.goals,
  layout: def.layout,
})

export interface MoveSample {
  floor: number
  fires: number // 強化発火数（upgrade-fireイベント数）
  chain: number // この手で到達した最大連鎖
  destroyed: number // この手の破壊駒数
  specialsBorn: number // この手で生成された特殊駒の数（special-born のうち kind!=='normal'。蔓ロケットの通常駒供給は除く）
  combos: number // 特殊駒どうしの合体（comboイベント）数。スワップ1手につき高々1
  swarmPropKills: number // このうちswarm伝播（propagateSwarmDefeat）による撃破数
  buildKills: number // 撃破総数からswarm伝播ぶんを除いたもの（＝ビルド由来）
}

/** 1回の採録（層クリア後のドラフト）の記録。PHASE2 §2 の合否②「入れ替えが実際に起きているか」の元データ */
export interface DraftSample {
  floor: number // 採録が起きた層（この層をクリアした直後）
  discardedId: string | null // 枠が埋まっていて捨てた知見。捨てずに済んだなら null
  /** その回に選んだ行為（PHASE2 §2.8）。take=採る／fuse=合成／deepen=深化 */
  action: 'take' | 'fuse' | 'deepen'
}

/** 合成・深化を入れるかどうか（PHASE2 §2.8 は未承認の設計なので、入れない場合と必ず比べられるようにする） */
export interface SimOptions {
  fusion?: boolean
  deepen?: boolean
}

export interface SeedResult {
  seed: number
  moves: MoveSample[]
  drafts: DraftSample[]
  clearedFloors: number[] // クリアできた層番号
  endOxygenByFloor: Map<number, number> // 層クリア直後（補給を含む）の灯
  /** 層を抜けた瞬間＝**補給を受ける直前**の灯。補給量は祝福・呪いで動く（blessingSupply）ので、
   *  補給後の値から素の supplyForFloor() を引いて復元すると誤差が出る。oxygen-refill イベントの
   *  amount からその場で記録する（Codexレビュー2回目 2026-08-15） */
  preSupplyOxygenByFloor: Map<number, number>
  deathFloor: number | null // 力尽きた層（run-over）。生存クリアなら null
  stuck: boolean // 有効手が尽きる等の異常系で打ち切った（バランスではなくソルバー側の限界）
  /** 深度20以降で観測した灯の最小値（深度20へ到達しなければ null）。
   *  §10.3 の「残酸素平均」は生存者だけの平均＝遭難したランが除かれるぶん必ず上振れするので、
   *  「深層で本当に酸素が危なくなったか」は遭難ランも含むこの実測最小値で見る。 */
  minOxygenDeep: number | null
  /** 終幕まで踏破したランが最後に残していた灯（最終層の補給を除いた実残量）。踏破できなければ null */
  finalOxygen: number | null
}

/** 1シードぶん、FLOORS の全層（30層＋終幕）を通しで自動プレイする */
export function simulateSeed(seed: number, opts: SimOptions = {}): SeedResult {
  const run = createRunState(undefined, makeRng(seed))
  // 祝福は深度10/20/30の幕主のあとに各1つ（PHASE2.md「祝福の回数と時機」。開始時の祝福は廃止）。
  // main.ts と同じ規則をここでも通す＝祝福を計測に入れないと、補給・灯の器・層開始の盤面が実プレイと違う値のまま較正することになる
  const blessRng = makeRng((seed ^ 0x9e3779b9) >>> 0)
  const takeOneBlessing = () => {
    const opts = pickBlessingOptions(run.blessings, blessRng, 3)
    if (opts.length) takeBlessing(run, opts[randInt(blessRng, opts.length)].id)
  }
  const moves: MoveSample[] = []
  const drafts: DraftSample[] = []
  // 知見ごとの発火回数（ラン通算）。捨てる1つを決める規則がこれだけを見る
  const firesById = new Map<string, number>()
  const countFires = (evs: BoardEvent[]) => {
    for (const e of evs) if (e.t === 'upgrade-fire') firesById.set(e.id, (firesById.get(e.id) ?? 0) + 1)
  }
  const clearedFloors: number[] = []
  const endOxygenByFloor = new Map<number, number>()
  const preSupplyOxygenByFloor = new Map<number, number>()
  let deathFloor: number | null = null
  let stuck = false
  let minOxygenDeep: number | null = null

  for (let floor = 1; floor <= FLOORS.length; floor++) {
    run.floor = floor
    const floorSeed = (seed + floor * 7919) | 0
    // 祝福の盤面効果は Board 構築時に applyBlessingFloorStart が織り込む（main.ts と同じ経路）
    const def = FLOORS[floor - 1]
    const board = new Board(buildFloorLevelDef(floor, floorSeed, def), run, def)
    countFires(board.initEvents) // 採録時のおまけ（starter）もその知見の働きとして数える
    const moveRng = makeRng((floorSeed ^ 0x5bd1e995) >>> 0) // 盤面seedとは別系統の決定的乱数（手選択・ドラフト選択用）
    let cleared = false
    let over = false
    let guard = 0
    while (!cleared && !over && guard++ < 400) {
      const mv = pickMove(board, moveRng)
      if (!mv) {
        stuck = true
        break
      }
      const propBefore = run.records.swarmPropagationKills
      const evs = mv.tap ? board.tap(mv.tap) : board.swap(mv.swap!.a, mv.swap!.b)
      const swarmPropKills = run.records.swarmPropagationKills - propBefore
      countFires(evs)
      const totalDefeated = evs.filter((e) => e.t === 'enemy-defeated').length
      moves.push({
        floor,
        fires: evs.filter((e) => e.t === 'upgrade-fire').length,
        chain: board.chain,
        destroyed: board.resolveDestroyCount,
        specialsBorn: evs.filter((e) => e.t === 'special-born' && e.piece.kind !== 'normal').length,
        combos: evs.filter((e) => e.t === 'combo').length,
        swarmPropKills,
        buildKills: Math.max(0, totalDefeated - swarmPropKills),
      })
      if (floor >= 20) minOxygenDeep = minOxygenDeep === null ? run.oxygen : Math.min(minOxygenDeep, run.oxygen)
      // 補給前の灯は「補給イベントの left から amount を引いた値」＝実際に層を抜けた瞬間の残量
      for (const e of evs) if (e.t === 'oxygen-refill') preSupplyOxygenByFloor.set(floor, e.left - e.amount)
      // main.ts:handleFloorResult と同じ優先順位（同一手でクリアと敗北が両方成立してもクリア扱い）
      cleared = evs.some((e) => e.t === 'floor-clear')
      over = !cleared && evs.some((e) => e.t === 'run-over')
    }
    if (guard >= 400 && !cleared && !over) stuck = true
    if (over || stuck) {
      deathFloor = floor
      break
    }
    clearedFloors.push(floor)
    endOxygenByFloor.set(floor, run.oxygen) // 資源はHPから酸素へ一本化（PLAN_LOOP.md §1.4）。補給を含んだ値
    if (isBlessingFloor(floor)) takeOneBlessing() // 幕主のあとに祝福を1つ（深度10/20/30）
    if (floor < FLOORS.length) {
      // 採録の3つの行為（PHASE2.md §2.8）。ソルバーの規則は「枠が埋まるまでは採るのが一番強い」を前提に、
      //   枠が埋まっている & 合成できる → 合成（捨てずに済み、枠も1つ空く）
      //   枠が埋まっている & 深化できる → 半々で深化（残りは入れ替えて採る）
      //   それ以外                     → 採る
      // としている。合成・深化を切れば従来（採るだけ）の較正と直接比べられる。
      const full = run.upgrades.length >= run.slots
      // 既定は本編の入り切り（PHASE28_ENABLED）に従う。opts で明示すれば両方を測って比較できる
      const fuses = (opts.fusion ?? PHASE28_ENABLED) ? fusionOptions(run.upgrades) : []
      const deeps = (opts.deepen ?? PHASE28_ENABLED) ? deepenOptions(run) : []
      if (full && fuses.length > 0) {
        const f = fuses[randInt(moveRng, fuses.length)]
        firesById.delete(f.a.id)
        firesById.delete(f.b.id)
        applyFusion(run, f)
        drafts.push({ floor, discardedId: null, action: 'fuse' })
      } else if (full && deeps.length > 0 && moveRng() < 0.5) {
        applyDeepen(run, deeps[randInt(moveRng, deeps.length)].id)
        drafts.push({ floor, discardedId: null, action: 'deepen' })
      } else {
        const owned = UPGRADES.filter((u) => run.upgrades.includes(u.id))
        const options = pickDraftOptions(run.upgrades, makeRng((seed + floor * 104729 + 17) | 0), floor)
        const choice = pickDraftChoice(owned, options, moveRng)
        // 枠が埋まっていれば「取る＝捨てる」（PHASE2.md §2）
        let discardedId: string | null = null
        if (full) {
          discardedId = pickDiscard(run, firesById)
          discardUpgrade(run, discardedId)
          firesById.delete(discardedId) // 採り直したときに新品として扱う（discardUpgrade と同じ扱い）
        }
        drafts.push({ floor, discardedId, action: 'take' })
        takeUpgrade(run, choice.id) // 灯の器系（工程3）の会計も本編と同じ経路で効かせる
      }
    }
  }
  const won = clearedFloors.includes(FLOORS.length)
  return {
    seed,
    moves,
    drafts,
    clearedFloors,
    endOxygenByFloor,
    preSupplyOxygenByFloor,
    deathFloor,
    stuck,
    minOxygenDeep,
    finalOxygen: won ? run.oxygen - blessingSupply(run.blessings, FLOORS.length) : null,
  }
}

// ---- 集計 ----

const avg = (arr: number[]): number => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0)
/** 昇順ソート済み配列から「上位20%の下限値」を取る（p=0.8） */
const percentile = (sortedAsc: number[], p: number): number => {
  if (sortedAsc.length === 0) return 0
  const idx = Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))
  return sortedAsc[idx]
}

export interface FloorAgg {
  floor: number
  reached: number
  cleared: number
  avgEndOxygen: number | null
  /** 補給を受ける直前＝「実際に層を抜けた瞬間」の酸素。§10.3「層が進むほど単調に細る」はこちらで判定する
   *  （avgEndOxygen は補給込みなので、細っていても層をまたぐと増え、細り具合が読めない） */
  avgEndOxygenPreSupply: number | null
  moveCount: number
  avgMovesPerFloor: number // 到達1回あたりの手数（層の長さ。較正の主指標）
  avgFires: number
  maxFires: number
  avgChain: number
  maxChain: number
  p50Chain: number // 連鎖分布の中央値（工程3：連鎖傾斜の比較指標）
  p80Chain: number // この値以上が「上位20%の手」の目安（分布の80パーセンタイル）
  p95Chain: number // 分布の裾（工程3：「たまに大連鎖」がどれだけ持ち上がったか）
  noCascadePct: number // 無連鎖の手の割合(%)＝連鎖1以下（落ちてきた駒が1度も追撃しなかった手）
  avgSpecialsBorn: number // 特殊駒の生成数/手
  avgDestroyed: number
  maxDestroyed: number
  avgSwarmPropKills: number
  avgBuildKills: number
}

export function aggregate(results: SeedResult[]): FloorAgg[] {
  const out: FloorAgg[] = []
  for (let floor = 1; floor <= FLOORS.length; floor++) {
    const reached = results.filter((r) => r.clearedFloors.includes(floor) || r.deathFloor === floor).length
    const cleared = results.filter((r) => r.clearedFloors.includes(floor)).length
    const survivors = results.filter((r) => r.clearedFloors.includes(floor))
    const endOxygens = survivors.map((r) => endOxygenFor(r, floor))
    const preOxygens = survivors.map((r) => r.preSupplyOxygenByFloor.get(floor)).filter((v): v is number => v !== undefined)
    const moves = results.flatMap((r) => r.moves.filter((m) => m.floor === floor))
    const chainsAsc = moves.map((m) => m.chain).sort((a, b) => a - b)
    out.push({
      floor,
      reached,
      cleared,
      avgEndOxygen: endOxygens.length ? avg(endOxygens) : null,
      avgEndOxygenPreSupply: preOxygens.length ? avg(preOxygens) : null,
      moveCount: moves.length,
      avgMovesPerFloor: reached ? moves.length / reached : 0,
      avgFires: avg(moves.map((m) => m.fires)),
      maxFires: moves.length ? Math.max(...moves.map((m) => m.fires)) : 0,
      avgChain: avg(moves.map((m) => m.chain)),
      maxChain: chainsAsc.length ? chainsAsc[chainsAsc.length - 1] : 0,
      p50Chain: percentile(chainsAsc, 0.5),
      p80Chain: percentile(chainsAsc, 0.8),
      p95Chain: percentile(chainsAsc, 0.95),
      noCascadePct: moves.length ? (moves.filter((m) => m.chain <= 1).length / moves.length) * 100 : 0,
      avgSpecialsBorn: avg(moves.map((m) => m.specialsBorn)),
      avgDestroyed: avg(moves.map((m) => m.destroyed)),
      maxDestroyed: moves.length ? Math.max(...moves.map((m) => m.destroyed)) : 0,
      avgSwarmPropKills: avg(moves.map((m) => m.swarmPropKills)),
      avgBuildKills: avg(moves.map((m) => m.buildKills)),
    })
  }
  return out
}

function endOxygenFor(r: SeedResult, floor: number): number {
  return r.endOxygenByFloor.get(floor) ?? 0
}

// ---- 遭難深度の分布（PHASE2.md §2.5①） ----
// 「ぎりぎりクリアできないが次はいいビルドが作れる気がする」は勝率では測れない。深度5で尽きるのと
// 深度9で尽きるのでは意味が違うので、**遭難した深度の分布**を主指標として別に集計する。

/** 終盤とみなす最も浅い深度。PHASE2 §2.5①「深度25以上での遭難が全体の35%以上」の 25 */
const LATE_FROM = 25
/** 中央値の合格帯。PHASE2 §2.5①「遭難深度の中央値 20〜24」 */
const MEDIAN_BAND: [number, number] = [20, 24]

export interface DeathDepthStats {
  /** 遭難したランの遭難深度の中央値。1件も遭難しなければ null */
  median: number | null
  /** 遭難したランの数 */
  deaths: number
  /** 終盤（層 LATE_FROM 以降）で遭難したランの数 */
  lateDeaths: number
  /** 終盤遭難の割合(%)。分母は**全ラン**（PHASE2 の「深度25以上での遭難が全体の35%以上」に合わせる） */
  latePct: number
  lateFrom: number
  medianBand: [number, number]
}

export function deathDepthStats(results: SeedResult[]): DeathDepthStats {
  const depths = results.map((r) => r.deathFloor).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const lateDeaths = depths.filter((d) => d >= LATE_FROM).length
  return {
    median: depths.length ? percentile(depths, 0.5) : null,
    deaths: depths.length,
    lateDeaths,
    latePct: results.length ? (lateDeaths / results.length) * 100 : 0,
    lateFrom: LATE_FROM,
    medianBand: MEDIAN_BAND,
  }
}

// ---- 較正の合否判定（SPEC_OXYGEN.md §10.3 の6指標を機械的に判定する） ----

/**
 * 6指標を1行ずつ「OK/NG＋実測値」で出す。
 * 目視で表を読むと「だいたい合っている」で通してしまうため、帯の内外を数字で言い切らせる。
 * とくに酸素は「補給前の値が層1→9で単調に細り、層8〜9で10以下」を見る（§10.3の主眼＝失敗条件が機能するか）。
 */
export function verdictLines(results: SeedResult[]): string[] {
  const aggs = aggregate(results)
  const mark = (ok: boolean) => (ok ? 'OK' : 'NG')
  const out: string[] = []

  // PHASE2 §2.5①（惜しい負けを量産する）。30層化で最上位の合否指標になった2本を先頭に置く
  const dd = deathDepthStats(results)
  const medOk = dd.median !== null && dd.median >= dd.medianBand[0] && dd.median <= dd.medianBand[1]
  out.push(`(a) 遭難深度の中央値 20〜24 : ${mark(medOk)}  ${dd.median ?? '-'}（遭難${dd.deaths}件）`)
  out.push(`(b) 深度25以上の遭難 35%以上: ${mark(dd.latePct >= 35)}  全${results.length}ラン中${dd.lateDeaths}件=${dd.latePct.toFixed(1)}%`)

  const badFloors = aggs.filter((a) => a.reached > 0 && (a.avgMovesPerFloor < 6 || a.avgMovesPerFloor > 12))
  out.push(
    `(c) 手数/層 各層6〜12       : ${mark(badFloors.length === 0)}  ` +
      (badFloors.length ? badFloors.map((a) => `深度${a.floor}=${a.avgMovesPerFloor.toFixed(1)}`).join(' ') : '全層が帯内'),
  )

  // 幕をまたいで灯が細るか。**必ず同じ集団で追う**（層ごとの平均は「その層をクリアできた者」だけの平均で、
  // 細ったランが次の層から消えるぶん必ず上振れする＝細っているのに数字が上がる）。
  // 集団＝深度20を抜けたラン。その者たちの深度10・深度20の残灯（補給前）と、第三幕での最小値を並べる
  const cohort = results.filter((r) => r.clearedFloors.includes(20))
  const preAt = (f: number) => avg(cohort.map((r) => r.preSupplyOxygenByFloor.get(f) ?? 0))
  const act3Min = avg(cohort.map((r) => r.minOxygenDeep ?? 0))
  // 旧判定は「深度10・深度20のどちらもが第三幕の最小より多いか」だけを見ており、**幕をまたいで灯が増えて
  // いても OK になった**（合成・深化ONの実測：深度10 42.4 → 深度20 55.3 でも合格していた）。
  // §10.3 の「層が進むほど単調に細る」を素直に書き直す＝幕ごとに必ず前より少ないこと（Codexレビュー2回目の
  // 「補給前の値が較正条件」という指摘を、判定式そのものにも適用する）
  const thinning = cohort.length > 0 && preAt(10) > preAt(20) && preAt(20) > act3Min
  out.push(
    `(d) 幕をまたいで灯が細る    : ${mark(thinning)}  ` +
      `深度20到達組(${cohort.length}件) 深度10 ${preAt(10).toFixed(1)} → 深度20 ${preAt(20).toFixed(1)} → 第三幕の最小 ${act3Min.toFixed(1)}`,
  )

  const stuckCount = results.filter((r) => r.stuck).length
  out.push(`(e) stuck 0件               : ${mark(stuckCount === 0)}  ${stuckCount}件`)

  const propBad = aggs.filter((a) => a.moveCount > 0 && a.avgSwarmPropKills > a.avgBuildKills)
  out.push(`(f) swarm伝播 ≦ build撃破   : ${mark(propBad.length === 0)}  ${propBad.length ? propBad.map((a) => `深度${a.floor}`).join(' ') : '全層で成立'}`)

  // 遭難ランも含む実測最小値。生存者だけの平均は必ず上振れして「深層で灯が危ないか」を測れない
  const deep = results.map((r) => r.minOxygenDeep).filter((v): v is number => v !== null)
  const scared = deep.filter((v) => v <= 8).length
  const scaredPct = deep.length ? (scared / deep.length) * 100 : 0
  out.push(`(g) 深度20以降に警告域(≦8)へ: ${mark(scaredPct >= 50)}  深度20到達${deep.length}件中${scared}件=${scaredPct.toFixed(1)}%`)

  // PHASE2 §2（知見の枠）の合否：①発火/手が深層で頭打ちになるか ②後半の採録で実際に入れ替えが起きるか。
  // 採録は30回近くあるので、ここで初めて「枠8が効いているか」を評価できる（PHASE2 §2 の要求）
  // 帯は 11-15 と 21-25 を使う。深度27以降は到達が数十件しか無く、しかも**いちばん強いビルドだけ**が残るので
  // 平均が跳ねる（実測で深度30は9件で18.9）。頭打ちの判定にはサンプルが安定している帯を使い、
  // 深層の生の値は下の層別表（発火/手平均の列）で読むこと。
  const firesIn = (from: number, to: number) => avg(aggs.filter((a) => a.floor >= from && a.floor <= to && a.moveCount > 0).map((a) => a.avgFires))
  const midFires = firesIn(11, 15)
  const deepFires = firesIn(21, 25)
  const ratio = midFires > 0 ? deepFires / midFires : 0
  out.push(`(h) 発火/手が深層で頭打ち   : ${mark(ratio <= 1.2)}  深度11-15平均 ${midFires.toFixed(2)} → 深度21-25平均 ${deepFires.toFixed(2)}（比 ${ratio.toFixed(2)}）`)

  // (i) は「採る」を選んだ回だけを分母にする（合成・深化は捨てる行為ではないので、混ぜると割合の意味が消える）
  const lateDrafts = results.flatMap((r) => r.drafts).filter((d) => d.floor >= 10)
  const lateTakes = lateDrafts.filter((d) => d.action === 'take')
  const swapped = lateTakes.filter((d) => d.discardedId !== null).length
  const swapPct = lateTakes.length ? (swapped / lateTakes.length) * 100 : 0
  out.push(`(i) 後半の「採る」が入れ替え: ${mark(swapPct >= 50)}  深度10以降に採った ${swapped}/${lateTakes.length}=${swapPct.toFixed(1)}%`)

  // PHASE2 §2.8：終盤の採録が「3つの異なる行為」になっているか。1つに偏っていたら設計が効いていない
  const actPct = (n: number) => (lateDrafts.length ? ((n / lateDrafts.length) * 100).toFixed(1) : '0.0')
  const nFuse = lateDrafts.filter((d) => d.action === 'fuse').length
  const nDeep = lateDrafts.filter((d) => d.action === 'deepen').length
  out.push(
    `(j) 後半の採録の行為の内訳  : 　 深度10以降${lateDrafts.length}回中 ` +
      `採る ${actPct(lateTakes.length)}% / 合成 ${actPct(nFuse)}% / 深化 ${actPct(nDeep)}%`,
  )

  // 到達率は合否ではなく参考値（PHASE2 §1「深度30への到達は難しくてよい」）
  const deepClear = (results.filter((r) => r.clearedFloors.includes(30)).length / results.length) * 100
  const allClear = (results.filter((r) => r.clearedFloors.includes(FLOORS.length)).length / results.length) * 100
  out.push(`(参考) 深度30クリア率        : ${deepClear.toFixed(1)}%　終幕(深度31)まで踏破 ${allClear.toFixed(1)}%`)

  const finals = results.map((r) => r.finalOxygen).filter((v): v is number => v !== null).sort((a, b) => a - b)
  out.push(`(参考) 踏破時の残灯 中央値   : ${finals.length ? percentile(finals, 0.5) : '-'}`)

  const avgTotal = avg(results.map((r) => r.moves.length))
  out.push(`(参考) 1ランの総手数 平均    : ${avgTotal.toFixed(1)}`)
  return out
}

// ---- レポート出力（人間が読める固定幅の表） ----

const pad = (s: string | number, w: number): string => String(s).padStart(w)

export function formatReport(results: SeedResult[]): string {
  const aggs = aggregate(results)
  const total = results.length
  const winRate = results.filter((r) => r.clearedFloors.includes(30)).length / total
  const stuckCount = results.filter((r) => r.stuck).length
  const lines: string[] = []
  lines.push(`シード数: ${total}　深度30クリア率: ${(winRate * 100).toFixed(1)}%　ソルバー行き詰まり: ${stuckCount}件`)
  const totalMoves = results.map((r) => r.moves.length).sort((a, b) => a - b)
  lines.push(`総手数: 平均 ${avg(totalMoves).toFixed(1)} / 中央値 ${percentile(totalMoves, 0.5)}`)
  // 連鎖・特殊駒の全体分布（工程3：補充の連鎖傾斜 REFILL_BIAS の比較指標）
  const allMoves = results.flatMap((r) => r.moves)
  const allChains = allMoves.map((m) => m.chain).sort((a, b) => a - b)
  const noCasc = allMoves.length ? (allMoves.filter((m) => m.chain <= 1).length / allMoves.length) * 100 : 0
  lines.push(
    `連鎖分布(全手): p50 ${percentile(allChains, 0.5)} / p80 ${percentile(allChains, 0.8)} / p95 ${percentile(allChains, 0.95)}　` +
      `無連鎖(連鎖≤1)の手: ${noCasc.toFixed(1)}%　補充傾斜 REFILL_BIAS=${REFILL_BIAS}`,
  )
  lines.push(
    `特殊駒: 生成 ${avg(allMoves.map((m) => m.specialsBorn)).toFixed(3)}個/手　` +
      `合体(コンボ) 平均 ${avg(results.map((r) => r.moves.reduce((s, m) => s + m.combos, 0))).toFixed(2)}回/ラン`,
  )
  // どこで酸素が尽きたか＝較正の主情報（クリア率だけでは「どの層が重いか」が分からない）
  const deaths = new Map<number, number>()
  for (const r of results) if (r.deathFloor !== null) deaths.set(r.deathFloor, (deaths.get(r.deathFloor) ?? 0) + 1)
  const deathHist = [...deaths.entries()].sort((a, b) => a[0] - b[0]).map(([f, n]) => `層${f}:${n}`)
  lines.push(`遭難した層: ${deathHist.length ? deathHist.join('　') : 'なし'}`)
  // 遭難深度の分布（PHASE2 §2.5①）。勝率より上位の主指標なのでヒストグラムの直後に要約を置く
  const dd = deathDepthStats(results)
  lines.push(`遭難深度: 中央値 ${dd.median ?? '-'}（目標 ${dd.medianBand[0]}〜${dd.medianBand[1]}）　深度${dd.lateFrom}以上の遭難 ${dd.lateDeaths}/${total}=${dd.latePct.toFixed(1)}%（目標 35%以上）`)
  // 知見の枠（PHASE2 §2）：どの層の採録から「取る＝捨てる」になったかを層別に出す
  const swapHist: string[] = []
  for (let f = 1; f < FLOORS.length; f++) {
    const ds = results.flatMap((r) => r.drafts).filter((d) => d.floor === f)
    if (!ds.length) continue
    const n = ds.filter((d) => d.discardedId !== null).length
    swapHist.push(`層${f}:${((n / ds.length) * 100).toFixed(0)}%`)
  }
  lines.push(`採録が入れ替えになった割合: ${swapHist.join('　')}`)
  lines.push('')
  lines.push('--- 較正の合否（PHASE2.md §2.5① / §2）---')
  lines.push(...verdictLines(results))
  lines.push('')
  lines.push(
    [
      pad('層', 3),
      pad('到達', 5),
      pad('クリア', 6),
      pad('到達率%', 8),
      pad('残酸素平均', 10),
      pad('補給前', 7),
      pad('手数', 6),
      pad('手数/層', 7),
      pad('発火/手平均', 11),
      pad('発火最大', 8),
      pad('連鎖平均', 8),
      pad('連鎖最大', 8),
      pad('連鎖p50', 8),
      pad('連鎖p80', 8),
      pad('連鎖p95', 8),
      pad('無連鎖%', 8),
      pad('特殊/手', 8),
      pad('破壊/手平均', 11),
      pad('破壊最大', 8),
      pad('swarm伝播/手', 12),
      pad('build撃破/手', 12),
    ].join(' | '),
  )
  for (const a of aggs) {
    lines.push(
      [
        pad(a.floor, 3),
        pad(a.reached, 5),
        pad(a.cleared, 6),
        pad(a.reached ? ((a.cleared / a.reached) * 100).toFixed(1) : '-', 8),
        pad(a.avgEndOxygen !== null ? a.avgEndOxygen.toFixed(1) : '-', 10),
        pad(a.avgEndOxygenPreSupply !== null ? a.avgEndOxygenPreSupply.toFixed(1) : '-', 7),
        pad(a.moveCount, 6),
        pad(a.avgMovesPerFloor.toFixed(1), 7),
        pad(a.avgFires.toFixed(2), 11),
        pad(a.maxFires, 8),
        pad(a.avgChain.toFixed(2), 8),
        pad(a.maxChain, 8),
        pad(a.p50Chain, 8),
        pad(a.p80Chain, 8),
        pad(a.p95Chain, 8),
        pad(a.noCascadePct.toFixed(1), 8),
        pad(a.avgSpecialsBorn.toFixed(2), 8),
        pad(a.avgDestroyed.toFixed(2), 11),
        pad(a.maxDestroyed, 8),
        pad(a.avgSwarmPropKills.toFixed(2), 12),
        pad(a.avgBuildKills.toFixed(2), 12),
      ].join(' | '),
    )
  }
  return lines.join('\n')
}

// ---- 単発実行エントリポイント ----

function main() {
  const seeds = Number(process.argv[2]) || 120
  // 第2引数で PHASE2 §2.8 の入り切りを変える（同じシードで比べるため）: on / off / fuse(合成だけ) / deep(深化だけ)。
  // **既定は本編と同じ**（PHASE28_ENABLED）。ここを 'on' 固定にしていると、本編で切っているのに
  // 較正だけ入りの数字を測ることになり、出荷する状態と報告がずれる
  const mode = process.argv[3] ?? (PHASE28_ENABLED ? 'on' : 'off')
  const opts: SimOptions = { fusion: mode === 'on' || mode === 'fuse', deepen: mode === 'on' || mode === 'deep' }
  // 第3引数：補充の連鎖傾斜（工程3）。省略時は本編の既定値（board.ts の REFILL_BIAS）のまま測る
  const biasArg = Number(process.argv[4])
  if (Number.isFinite(biasArg) && biasArg > 0) setRefillBias(biasArg)
  const results: SeedResult[] = []
  for (let i = 0; i < seeds; i++) results.push(simulateSeed(1000 + i * 7919, opts))
  process.stdout.write(`合成・深化（PHASE2 §2.8）: 合成${opts.fusion ? '有' : '無'}・深化${opts.deepen ? '有' : '無'}\n` + formatReport(results) + '\n')
}

// node runsim.mjs として直接実行された場合のみ走る（importされただけでは何もしない）
function isMainModule(): boolean {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] ?? '').href
  } catch {
    return false // ブラウザ等 process.argv が無い環境からimportされた場合（このファイルはNode専用ツール）
  }
}
if (isMainModule()) main()
