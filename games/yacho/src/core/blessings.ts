// 祝福と呪い（PHASE2.md §3）。ボス級の「ランの規則そのもの」を書き換える1行と、それと対になる代償1行。
//
// 知見（upgrades.ts）との切り分けがこのファイルの本体である：
//   知見 … マッチ・胞子・ギアという盤面の局所イベントに反応する部品。8枠・同系統を重ねて因果を作る
//   祝福 … 灯・課目・深度・盤面形状というランの会計と規則だけを変える。最大3つ・同名重複なし
// したがってここには Hook が1つも無い（盤面のイベントには一切触らない）。新しい資源も作らない。
// 呪いを別アイテムとして増やさず、必ず祝福と同じ1枚に書くのは「隠しデメリットを作らない」ため。
import { supplyForFloor, UPGRADE_SLOTS_DEFAULT, type RunState } from './run'
import { randInt, type Rng } from './rng'
import type { FloorDef } from './floors'
import type { Goal, GoalType } from './types'

export interface BlessingDef {
  id: string
  name: string
  /** 祝福の効果（1行）。選択画面では curse と同じ大きさで並べる */
  boon: string
  /** 呪いの代償（1行）。隠しデメリットは作らない */
  curse: string
  /** 採った瞬間の灯の増減（一度きり） */
  light?: number
  /** 層を出るときの補給の増減。深度で変わるものがあるので深度を受け取る */
  supply?: (floor: number) => number
  /** 知見の枠の増減（一度きり） */
  slots?: number
  /** 灯を奪う原生種の一撃の増減（下限1） */
  drain?: number
  /** その層の最初の1手が灯を消費しない */
  freeFirstMove?: boolean
  /** 灯が尽きた瞬間に一度だけ戻る灯の量 */
  lastLight?: number
  /** 課目の要求数の倍率。single＝課目が1つの層／multi＝課目が2つ以上の層 */
  goalMul?: { single?: number; multi?: number }
  /** 盤の四隅を欠けさせる */
  cornerHoles?: boolean
}

/**
 * 祝福7種。効くのは灯・課目・深度・盤面形状の4領域だけで、盤面の駒には触らない。
 * 「祝福が強い知見に見えたら失敗」なので、どれも1手の中では何も起こらず、層の会計だけが変わる。
 */
export const BLESSINGS: BlessingDef[] = [
  {
    id: 'great-lung',
    name: '大きな肺',
    boon: '灯が12ふえる',
    curse: '層を出るときの補給が半分になる',
    light: 12,
    supply: (floor) => -Math.floor(supplyForFloor(floor) / 2),
  },
  {
    id: 'first-bell',
    name: '早鐘',
    boon: 'その層の最初の1手は灯を消費しない',
    curse: `知見の枠が1つへる（${UPGRADE_SLOTS_DEFAULT} → ${UPGRADE_SLOTS_DEFAULT - 1}）`,
    freeFirstMove: true,
    slots: -1,
  },
  {
    id: 'held-breath',
    name: '息を殺す',
    boon: '灯喰み・深匣主に奪われる灯が 3 から 1 になる',
    // 実装は下限1でクランプする（受けた瞬間に尽きさせない）。残灯が8以下だと8まで減らないので、そこまで書く
    curse: '灯が8へる（1より下にはならない）',
    drain: -2,
    light: -8,
  },
  {
    id: 'keepsake',
    name: '忘れ形見',
    // 実装は加算ではなく代入（尽きた地点は0以下なので、超過ぶんも帳消しにして12へ戻す）。「12ふえる」ではないと書く
    boon: '一度だけ、灯が尽きた瞬間に灯が12にもどる',
    curse: '層を出るときの補給が2へる',
    lastLight: 12,
    supply: () => -2,
  },
  {
    id: 'deep-diver',
    name: '底ゆきの勘',
    boon: '深度5から下では層を出るときの補給が4ふえる',
    curse: '深度4までは層を出るときの補給が4へる',
    supply: (floor) => (floor >= 5 ? 4 : -4),
  },
  {
    id: 'single-minded',
    name: '一意専心',
    // 掃討（enemy-kill）は編成数と一致していないと詰むので scaleGoal が触らない。効かない課目まで約束しない
    boon: '課目が1つの層は掃討いがいの要求が4分の3',
    curse: '課目が2つの層は掃討いがいの要求が4分の5',
    goalMul: { single: 0.75, multi: 1.25 },
  },
  {
    id: 'hasty-survey',
    name: '早足の測量',
    boon: '掃討いがいの課目の要求が2割へる',
    curse: '盤の四隅が欠ける',
    goalMul: { single: 0.8, multi: 0.8 },
    cornerHoles: true,
  },
]

/** 幕主のあとに祝福を1つ選ぶ深度（PHASE2.md §3）。深度20は30層化のときにそのまま繋がる */
export const BLESSING_FLOORS = [10, 20]
export const isBlessingFloor = (floor: number) => BLESSING_FLOORS.includes(floor)

const byId = (ids: string[]) => BLESSINGS.filter((b) => ids.includes(b.id))

/**
 * 祝福を1つ受ける。灯と知見の枠は「採った瞬間」に一度だけ動く増減なのでここで RunState へ直接反映する
 * （補給・課目・盤面形状のように毎層参照するものは、その都度 blessingXxx() を引く）。
 */
export function takeBlessing(run: RunState, id: string) {
  const d = BLESSINGS.find((b) => b.id === id)
  if (!d || run.blessings.includes(id)) return // 同名重複なし
  run.blessings.push(id)
  run.slots += d.slots ?? 0
  // 灯の代償で即座に尽きると「選んだ瞬間にランが終わる」ので1だけ残す
  if (d.light) run.oxygen = Math.max(1, run.oxygen + d.light)
}

/** その深度で層を出るときの補給（基準値に祝福・呪いを足したもの） */
export function blessingSupply(ids: string[], floor: number): number {
  let n = supplyForFloor(floor)
  for (const b of byId(ids)) n += b.supply?.(floor) ?? 0
  return Math.max(0, n)
}

/** 灯を奪う原生種の一撃（0にはしない） */
export function blessingDrain(ids: string[], base: number): number {
  let n = base
  for (const b of byId(ids)) n += b.drain ?? 0
  return Math.max(1, n)
}

export function hasFreeFirstMove(ids: string[]): boolean {
  return byId(ids).some((b) => b.freeFirstMove)
}

/** 灯が尽きた瞬間に戻る灯の量（0＝その祝福を持っていない） */
export function blessingLastLight(ids: string[]): number {
  let n = 0
  for (const b of byId(ids)) n = Math.max(n, b.lastLight ?? 0)
  return n
}

/**
 * 選択肢（同名重複なしなので所持済みは出さない）。
 * 底ゆきの勘の呪い（深度4までの補給−4）は深度5以降ではもう起こりようがなく、代償のない祝福になってしまうので、
 * その深度では候補から外す（PHASE2.md §3「利点と代償を同じ大きさで示す」＝片方だけ効く札を出さない）。
 */
export function pickBlessingOptions(ids: string[], rng: Rng, n = 3, floor = 1): BlessingDef[] {
  const pool = BLESSINGS.filter((b) => !ids.includes(b.id) && !(b.id === 'deep-diver' && floor >= 5))
  const out: BlessingDef[] = []
  while (out.length < n && pool.length) out.push(...pool.splice(randInt(rng, pool.length), 1))
  return out
}

/** 巣灯1基あたりの胞子排出数。LevelDef.subiCharge の既定値（board.ts）で、ローグ層はこれを上書きしていない */
const SUBI_CHARGE_DEFAULT = 4

/** 課目の材料が盤に置かれた数。ここを超える要求は達成不能なので、呪いの増量の上限に使う */
function materialCap(type: GoalType, layout: string[]): number | null {
  const count = (score: (ch: string) => number) => {
    let n = 0
    for (const row of layout) for (const ch of row) n += score(ch)
    return n
  }
  // 蔦苔は「マスが0層になった瞬間」に1進むので、上限は層数ではなくマス数（2層のマスも1しか進まない）
  if (type === 'tsutagoke') return count((ch) => (ch === 'g' || ch === 'G' ? 1 : 0))
  if (type === 'touhen') return count((ch) => (ch === 'h' ? 1 : 0)) // 匣1つから陶片1つ
  if (type === 'kokeishi') return count((ch) => (ch === 'k' || ch === 'K' ? 1 : 0)) // 2層('K')でも壊れるのは1個体
  if (type === 'spore') return count((ch) => (ch === 's' ? 1 : 0)) * SUBI_CHARGE_DEFAULT // 巣灯1基が出せる胞子の数
  return null // 色・系統は補充で無限に湧くので上限なし
}

/** 課目の要求数を倍率で書き換える。殲滅だけは編成数と一致していないと詰むので触らない */
function scaleGoal(g: Goal, mul: number, layout: string[]): Goal {
  if (g.type === 'enemy-kill') return g
  const cap = materialCap(g.type, layout)
  let count = Math.max(1, Math.round(g.count * mul))
  if (cap !== null) count = Math.min(count, cap)
  return { ...g, count }
}

/** 盤の四隅を欠けさせる。課目の材料（蔦苔・匣など）が置かれた隅は残す＝呪いで課目が達成不能にならない */
function withCornerHoles(layout: string[]): string[] {
  const rows = layout.map((r) => r.split(''))
  for (const [x, y] of [
    [0, 0],
    [7, 0],
    [0, 7],
    [7, 7],
  ]) {
    if (rows[y]?.[x] === '.') rows[y][x] = '#'
  }
  return rows.map((r) => r.join(''))
}

/**
 * 層の定義に祝福・呪いを織り込む（課目と盤面形状の2領域）。
 * FLOORS は正典なので書き換えず、変わったところだけ差し替えた新しい FloorDef を返す。
 */
export function applyBlessingsToFloor(def: FloorDef, ids: string[]): FloorDef {
  const defs = byId(ids)
  if (!defs.length) return def
  const key = def.goals.length >= 2 ? 'multi' : 'single'
  let mul = 1
  for (const b of defs) mul *= b.goalMul?.[key] ?? 1
  const goals = mul === 1 ? def.goals : def.goals.map((g) => scaleGoal(g, mul, def.layout))
  const layout = defs.some((b) => b.cornerHoles) ? withCornerHoles(def.layout) : def.layout
  return goals === def.goals && layout === def.layout ? def : { ...def, goals, layout }
}
