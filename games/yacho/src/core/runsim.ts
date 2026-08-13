// 進行曲線の計測スクリプト（夜間監査[B][D]対応）。
// 10層を通しで自動プレイし、深度（層）別に次を記録する：
//   1手あたりの強化発火数 / 最大連鎖 / 1手最大破壊数 / swarm伝播による撃破数（ビルド由来と分離） / 残HP / 到達率
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
import { createRunState } from './run'
import { FLOORS } from './floors'
import { UPGRADES, type UpgradeDef } from './upgrades'
import { makeRng, randInt, type Rng } from './rng'
import { connectedOwned, pickDraftOptions } from './draft'
import type { LevelDef, XY } from './types'

// ---- ドラフト抽選は core/draft.ts に一本化済み（UIと計測で同じ規則を使う） ----
// 監査[B]：旧実装は同系統/同フック種を疑似シナジーとしており、閉ループの部品が届く保証がなかった

/** ドラフト選択：所持とシナジーする候補があればその中から、無ければ3択からランダムに1つ選ぶ（そこそこ上手い人の代用） */
function pickDraftChoice(owned: UpgradeDef[], options: UpgradeDef[], rng: Rng): UpgradeDef {
  const synergistic = options.filter((o) => connectedOwned(owned, o).length > 0)
  const pool = synergistic.length > 0 ? synergistic : options
  return pool[randInt(rng, pool.length)]
}

// ---- 手選択（solver.ts の「そこそこ上手い人」ヒューリスティックを踏襲。ゴール駒の代わりに敵セルへの近さで優先する） ----

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
  if (moves.length === 0) return null
  const enemyCells: XY[] = []
  for (const e of b.enemies) enemyCells.push(...e.cells)
  if (enemyCells.length > 0) {
    let best: { m: { a: XY; b: XY }; d: number } | null = null
    for (const m of moves) {
      let d = Infinity
      for (const g of enemyCells) {
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

/** 1層ぶんの盤面定義。main.ts:buildFloorLevelDef と同じ（moves/goalsはrogueでは実質未使用にする定型値） */
const buildFloorLevelDef = (floor: number, seed: number): LevelDef => ({
  id: floor,
  seed,
  moves: 9999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999999 }],
  layout: Array(H).fill('.'.repeat(W)),
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
  endHpByFloor: Map<number, number> // 層クリア直後のHP
  deathFloor: number | null // 力尽きた層（run-over）。生存クリアなら null
  stuck: boolean // 有効手が尽きる等の異常系で打ち切った（バランスではなくソルバー側の限界）
}

/** 1シードぶん、10層を通しで自動プレイする */
export function simulateSeed(seed: number): SeedResult {
  const run = createRunState(undefined, makeRng(seed))
  const moves: MoveSample[] = []
  const clearedFloors: number[] = []
  const endHpByFloor = new Map<number, number>()
  let deathFloor: number | null = null
  let stuck = false

  for (let floor = 1; floor <= 10; floor++) {
    run.floor = floor
    const floorSeed = (seed + floor * 7919) | 0
    const board = new Board(buildFloorLevelDef(floor, floorSeed), run, FLOORS[floor - 1])
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
    endHpByFloor.set(floor, run.playerHp)
    if (floor < 10) {
      const owned = UPGRADES.filter((u) => run.upgrades.includes(u.id))
      const options = pickDraftOptions(run.upgrades, makeRng((seed + floor * 104729 + 17) | 0), floor)
      const choice = pickDraftChoice(owned, options, moveRng)
      run.upgrades.push(choice.id)
    }
  }
  return { seed, moves, clearedFloors, endHpByFloor, deathFloor, stuck }
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
  avgEndHp: number | null
  moveCount: number
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
    const endHps = results.filter((r) => r.clearedFloors.includes(floor)).map((r) => endHpFor(r, floor))
    const moves = results.flatMap((r) => r.moves.filter((m) => m.floor === floor))
    const chainsAsc = moves.map((m) => m.chain).sort((a, b) => a - b)
    out.push({
      floor,
      reached,
      cleared,
      avgEndHp: endHps.length ? avg(endHps) : null,
      moveCount: moves.length,
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

function endHpFor(r: SeedResult, floor: number): number {
  return r.endHpByFloor.get(floor) ?? 0
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
  lines.push('')
  lines.push(
    [
      pad('層', 3),
      pad('到達', 5),
      pad('クリア', 6),
      pad('到達率%', 8),
      pad('残HP平均', 9),
      pad('手数', 6),
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
        pad(a.avgEndHp !== null ? a.avgEndHp.toFixed(1) : '-', 9),
        pad(a.moveCount, 6),
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
