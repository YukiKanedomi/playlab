// 進行曲線の計測スクリプト（夜間監査[B][D]対応）。
// 10層を通しで自動プレイし、深度（層）別に次を記録する：
//   1手あたりの強化発火数 / 最大連鎖 / 1手最大破壊数 / swarm伝播による撃破数（ビルド由来と分離） / 残酸素 / 到達率
// ドラフトは main.ts の pickDraftOptions と同じ規則（UPGRADE_CATEGORY一致 or フック種一致＝シナジー2枠＋無関係1枠）を
// ここに複製して使う。main.ts/view は Pixi 依存でNodeから直接importできない上、core は元々Pixi非依存の設計
// （board.tsの冒頭コメント参照）なので、ロジックだけを同等実装として core 側に置く（UIコードは一切importしない）。
//
// テストとして常時実行はしない（100+シードのフル10層プレイは重いため）。単発で明示的に実行する：
//   npx esbuild games/yacho/src/core/runsim.ts --bundle --platform=node --format=esm --outfile=<tmp>/runsim.mjs
//   node <tmp>/runsim.mjs [seeds] > games/yacho/assets_src/_runsim.txt
// （seeds省略時は120。このファイル自体はNode専用ツールで、main.ts/viewからは一切importされない）
import { pathToFileURL } from 'node:url'
import { Board, H, W } from './board'
import { createRunState, OXYGEN_SUPPLY_PER_FLOOR } from './run'
import { FLOORS, type FloorDef } from './floors'
import { UPGRADES, type UpgradeDef } from './upgrades'
import { makeRng, randInt, type Rng } from './rng'
import { connectedOwned, pickDraftOptions } from './draft'
import { systemOf, type System } from './hooks'
import type { Color, GoalType, LevelDef, XY } from './types'

// ---- ドラフト抽選は core/draft.ts に一本化済み（UIと計測で同じ規則を使う） ----
// 監査[B]：旧実装は同系統/同フック種を疑似シナジーとしており、閉ループの部品が届く保証がなかった

/** ドラフト選択：所持とシナジーする候補があればその中から、無ければ3択からランダムに1つ選ぶ（そこそこ上手い人の代用） */
function pickDraftChoice(owned: UpgradeDef[], options: UpgradeDef[], rng: Rng): UpgradeDef {
  const synergistic = options.filter((o) => connectedOwned(owned, o).length > 0)
  const pool = synergistic.length > 0 ? synergistic : options
  return pool[randInt(rng, pool.length)]
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
  swarmPropKills: number // このうちswarm伝播（propagateSwarmDefeat）による撃破数
  buildKills: number // 撃破総数からswarm伝播ぶんを除いたもの（＝ビルド由来）
}

export interface SeedResult {
  seed: number
  moves: MoveSample[]
  clearedFloors: number[] // クリアできた層番号
  endOxygenByFloor: Map<number, number> // 層クリア直後（補給+7を含む）の酸素
  deathFloor: number | null // 力尽きた層（run-over）。生存クリアなら null
  stuck: boolean // 有効手が尽きる等の異常系で打ち切った（バランスではなくソルバー側の限界）
  /** 層8以降で観測した酸素の最小値（層8へ到達しなければ null）。
   *  §10.3 の「残酸素平均」は生存者だけの平均＝遭難したランが除かれるぶん必ず上振れするので、
   *  「深層で本当に酸素が危なくなったか」は遭難ランも含むこの実測最小値で見る。 */
  minOxygenDeep: number | null
  /** 10層クリアしたランが最後に残していた酸素（層10クリアの補給+7を除いた実残量）。クリアできなければ null */
  finalOxygen: number | null
}

/** 1シードぶん、10層を通しで自動プレイする */
export function simulateSeed(seed: number): SeedResult {
  const run = createRunState(undefined, makeRng(seed))
  const moves: MoveSample[] = []
  const clearedFloors: number[] = []
  const endOxygenByFloor = new Map<number, number>()
  let deathFloor: number | null = null
  let stuck = false
  let minOxygenDeep: number | null = null

  for (let floor = 1; floor <= 10; floor++) {
    run.floor = floor
    const floorSeed = (seed + floor * 7919) | 0
    const board = new Board(buildFloorLevelDef(floor, floorSeed, FLOORS[floor - 1]), run, FLOORS[floor - 1])
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
      const totalDefeated = evs.filter((e) => e.t === 'enemy-defeated').length
      moves.push({
        floor,
        fires: evs.filter((e) => e.t === 'upgrade-fire').length,
        chain: board.chain,
        destroyed: board.resolveDestroyCount,
        swarmPropKills,
        buildKills: Math.max(0, totalDefeated - swarmPropKills),
      })
      if (floor >= 8) minOxygenDeep = minOxygenDeep === null ? run.oxygen : Math.min(minOxygenDeep, run.oxygen)
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
    endOxygenByFloor.set(floor, run.oxygen) // 資源はHPから酸素へ一本化（PLAN_LOOP.md §1.4）。補給+7を含んだ値
    if (floor < 10) {
      const owned = UPGRADES.filter((u) => run.upgrades.includes(u.id))
      const options = pickDraftOptions(run.upgrades, makeRng((seed + floor * 104729 + 17) | 0), floor)
      const choice = pickDraftChoice(owned, options, moveRng)
      run.upgrades.push(choice.id)
    }
  }
  const won = clearedFloors.includes(10)
  return {
    seed,
    moves,
    clearedFloors,
    endOxygenByFloor,
    deathFloor,
    stuck,
    minOxygenDeep,
    finalOxygen: won ? run.oxygen - OXYGEN_SUPPLY_PER_FLOOR : null,
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
  /** 補給+7を差し引いた「実際に層を抜けた瞬間」の酸素。§10.3「層が進むほど単調に細る」はこちらで判定する
   *  （avgEndOxygen は補給込みなので、細っていても層をまたぐと+7され、細り具合が読めない） */
  avgEndOxygenPreSupply: number | null
  moveCount: number
  avgMovesPerFloor: number // 到達1回あたりの手数（層の長さ。較正の主指標）
  avgFires: number
  maxFires: number
  avgChain: number
  maxChain: number
  p80Chain: number // この値以上が「上位20%の手」の目安（分布の80パーセンタイル）
  avgDestroyed: number
  maxDestroyed: number
  avgSwarmPropKills: number
  avgBuildKills: number
}

export function aggregate(results: SeedResult[]): FloorAgg[] {
  const out: FloorAgg[] = []
  for (let floor = 1; floor <= 10; floor++) {
    const reached = results.filter((r) => r.clearedFloors.includes(floor) || r.deathFloor === floor).length
    const cleared = results.filter((r) => r.clearedFloors.includes(floor)).length
    const endOxygens = results.filter((r) => r.clearedFloors.includes(floor)).map((r) => endOxygenFor(r, floor))
    const moves = results.flatMap((r) => r.moves.filter((m) => m.floor === floor))
    const chainsAsc = moves.map((m) => m.chain).sort((a, b) => a - b)
    out.push({
      floor,
      reached,
      cleared,
      avgEndOxygen: endOxygens.length ? avg(endOxygens) : null,
      avgEndOxygenPreSupply: endOxygens.length ? avg(endOxygens) - OXYGEN_SUPPLY_PER_FLOOR : null,
      moveCount: moves.length,
      avgMovesPerFloor: reached ? moves.length / reached : 0,
      avgFires: avg(moves.map((m) => m.fires)),
      maxFires: moves.length ? Math.max(...moves.map((m) => m.fires)) : 0,
      avgChain: avg(moves.map((m) => m.chain)),
      maxChain: chainsAsc.length ? chainsAsc[chainsAsc.length - 1] : 0,
      p80Chain: percentile(chainsAsc, 0.8),
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

  const totals = results.map((r) => r.moves.length)
  const avgTotal = avg(totals)
  out.push(`(a) 総手数 85〜100        : ${mark(avgTotal >= 85 && avgTotal <= 100)}  平均 ${avgTotal.toFixed(1)}`)

  const badFloors = aggs.filter((a) => a.reached > 0 && (a.avgMovesPerFloor < 6 || a.avgMovesPerFloor > 12))
  out.push(
    `(b) 手数/層 各層6〜12      : ${mark(badFloors.length === 0)}  ` +
      (badFloors.length ? badFloors.map((a) => `層${a.floor}=${a.avgMovesPerFloor.toFixed(1)}`).join(' ') : '全層が帯内'),
  )

  const pre = aggs.slice(0, 9).map((a) => a.avgEndOxygenPreSupply ?? 0)
  const rises = pre.map((v, i) => (i > 0 && v > pre[i - 1] ? `層${i}→${i + 1}(+${(v - pre[i - 1]).toFixed(1)})` : '')).filter(Boolean)
  out.push(`(c1) 残酸素(補給前) 単調減少: ${mark(rises.length === 0)}  ${rises.length ? rises.join(' ') : `層1 ${pre[0].toFixed(1)} → 層9 ${pre[8].toFixed(1)}`}`)
  const f8 = pre[7]
  const f9 = pre[8]
  out.push(`(c2) 層8〜9 が10以下       : ${mark(f8 <= 10 && f9 <= 10)}  層8 ${f8.toFixed(1)} / 層9 ${f9.toFixed(1)}`)

  const winRate = (results.filter((r) => r.clearedFloors.includes(10)).length / results.length) * 100
  out.push(`(d) クリア率 30〜60%       : ${mark(winRate >= 30 && winRate <= 60)}  ${winRate.toFixed(1)}%`)

  const stuckCount = results.filter((r) => r.stuck).length
  out.push(`(e) stuck 0件              : ${mark(stuckCount === 0)}  ${stuckCount}件`)

  const propBad = aggs.filter((a) => a.moveCount > 0 && a.avgSwarmPropKills > a.avgBuildKills)
  out.push(`(f) swarm伝播 ≦ build撃破  : ${mark(propBad.length === 0)}  ${propBad.length ? propBad.map((a) => `層${a.floor}`).join(' ') : '全層で成立'}`)

  // ここから下は §10.3 に無い追加指標。(c2) の「残酸素平均」は生存者だけの平均なので、
  // 遭難ランが除かれるぶん必ず上振れして「深層で酸素が危ないか」を測れない。遭難ランも数える2本を足す。
  const deep = results.map((r) => r.minOxygenDeep).filter((v): v is number => v !== null)
  const scared = deep.filter((v) => v <= 8).length
  const scaredPct = deep.length ? (scared / deep.length) * 100 : 0
  out.push(`(g) 層8以降に警告域(≦8)へ : ${mark(scaredPct >= 50)}  層8到達${deep.length}件中${scared}件=${scaredPct.toFixed(1)}%`)

  const finals = results.map((r) => r.finalOxygen).filter((v): v is number => v !== null).sort((a, b) => a - b)
  const medFinal = percentile(finals, 0.5)
  out.push(`(h) クリア時の残酸素 中央値 : ${mark(finals.length > 0 && medFinal <= 12)}  ${finals.length ? medFinal : '-'}（≦12なら「ぎりぎり勝った」）`)
  return out
}

// ---- レポート出力（人間が読める固定幅の表） ----

const pad = (s: string | number, w: number): string => String(s).padStart(w)

export function formatReport(results: SeedResult[]): string {
  const aggs = aggregate(results)
  const total = results.length
  const winRate = results.filter((r) => r.clearedFloors.includes(10)).length / total
  const stuckCount = results.filter((r) => r.stuck).length
  const lines: string[] = []
  lines.push(`シード数: ${total}　勝率(10層クリア): ${(winRate * 100).toFixed(1)}%　ソルバー行き詰まり: ${stuckCount}件`)
  const totalMoves = results.map((r) => r.moves.length).sort((a, b) => a - b)
  lines.push(`総手数: 平均 ${avg(totalMoves).toFixed(1)} / 中央値 ${percentile(totalMoves, 0.5)} （目標 85〜100）`)
  // どこで酸素が尽きたか＝較正の主情報（クリア率だけでは「どの層が重いか」が分からない）
  const deaths = new Map<number, number>()
  for (const r of results) if (r.deathFloor !== null) deaths.set(r.deathFloor, (deaths.get(r.deathFloor) ?? 0) + 1)
  const deathHist = [...deaths.entries()].sort((a, b) => a[0] - b[0]).map(([f, n]) => `層${f}:${n}`)
  lines.push(`遭難した層: ${deathHist.length ? deathHist.join('　') : 'なし'}`)
  lines.push('')
  lines.push('--- 較正の合否（SPEC_OXYGEN.md §10.3）---')
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
      pad('連鎖p80', 8),
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
        pad(a.p80Chain, 8),
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
  const results: SeedResult[] = []
  for (let i = 0; i < seeds; i++) results.push(simulateSeed(1000 + i * 7919))
  process.stdout.write(formatReport(results) + '\n')
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
