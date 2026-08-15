// 祝福と呪い（PHASE2.md §3）。ボス級の「ランの規則そのもの」を書き換える1行と、それと対になる代償1行。
//
// 工程2の再設計：**祝福＝盤面・駒・原生種に見える挙動、呪い＝会計（補給・灯・器・枠）**。
// 旧7種は祝福側がほぼ全部「灯の会計」で、呪い側（四隅が欠ける等）だけが盤面に見えて派手という逆転が
// 起きていた（本人指摘 2026-08-15「祝福は面白くない。呪いの方が目立っている」）。ROGUE2.md の
// 「数値強化より挙動変化」を祝福側に適用し、呪いは読めば分かる数字に退げる。
//
// 知見（upgrades.ts）との切り分けがこのファイルの本体である：
//   知見 … マッチ・胞子・ギアという盤面の局所イベントに**毎回**反応する部品。8枠・同系統を重ねて因果を作る
//   祝福 … ランの会計と規則を変える。盤面に触れる祝福も**発火点は層開始（Board構築時）の一度だけ**に限定し、
//          毎マッチ反応する知見の領分を侵さない（唯一の例外は大喰らい＝4つ以上のまとめ消しで灯+1。これは
//          盤面を動かさない会計への還元なので、フックではなく早鐘方式のフラグ1つで board.ts が扱う）
// 呪いを別アイテムとして増やさず、必ず祝福と同じ1枚に書くのは「隠しデメリットを作らない」ため。
import { gainLamp, supplyForFloor, UPGRADE_SLOTS_DEFAULT, type RunState } from './run'
import { randInt, type Rng } from './rng'

export interface BlessingDef {
  id: string
  name: string
  /** 祝福の効果（1行）。選択画面では curse と同じ大きさで並べる */
  boon: string
  /** 呪いの代償（1行）。隠しデメリットは作らない */
  curse: string
  /** 採った瞬間の灯の増減（一度きり）。増える側は器（lampMax）でクランプされる */
  light?: number
  /** 採った瞬間の器（lampMax）の増減（一度きり）。減る側は灯もその場で器へクランプする */
  lampMax?: number
  /** 層を出るときの補給の増減。深度で変わるものがあるので深度を受け取る */
  supply?: (floor: number) => number
  /** 知見の枠の増減（一度きり） */
  slots?: number
  /** 灯を奪う原生種の一撃の増減（下限1） */
  drain?: number
  /** 灯が尽きた瞬間に一度だけ戻る灯の量 */
  lastLight?: number
  // ---- 盤面効果（発火点は層開始の一度だけ。board.ts の applyBlessingFloorStart が読む）----
  /** 層開始時、鉱物の駒N個が爆発鉱石に変わっている */
  oreSeeds?: number
  /** 層開始時、盤に銛がN本置かれている */
  harpoons?: number
  /** 層開始時、光胞子トークンがN個落ちている */
  sporeTokens?: number
  /** 層開始時、すべての原生種がNの傷を負う（殻もちは殻が1枚剥がれる） */
  woundAll?: number
  /** 層開始時、原生種の定期行動の初回がN手おくれる */
  wakeDelay?: number
  /** 4つ以上のまとめ消し1回につき灯がNともる（会計だがプレイへの報酬。層開始限定の例外） */
  bigMatchLamp?: number
}

/**
 * 祝福9種。盤面に見える6種（火の脈・置き銛・光の名残・先手の礫・眠りの帳＋原生種の一撃を変える息を殺す）と、
 * 会計だが劇的な3種（大きな肺＝器・忘れ形見＝一度だけの復活・大喰らい＝まとめ消しの報酬）。
 * 呪いはすべて会計（補給・灯・器・枠）＝画面はうるさくならない。
 */
export const BLESSINGS: BlessingDef[] = [
  {
    id: 'great-lung',
    name: '大きな肺',
    // 灯に器（lampMax）が入ったので「+12」は器ごと広げる。器を広げないと満タン時に何も起きない死んだ祝福になる
    // 呪いは旧「補給半分」から定額-1へ（工程2の較正）：半分は第一幕-6/第二幕-5と序盤ほど重く、
    // 受けたランが深部に届く前に枯れて祝福の意味を失っていた（較正の記録は assets_src/_runsim.txt）
    boon: '灯の器が12ひろがり、灯も12ふえる',
    curse: '層を出るときの補給が1へる',
    light: 12,
    lampMax: 12,
    supply: () => -1,
  },
  {
    id: 'held-breath',
    name: '息を殺す',
    boon: '灯喰み・深匣主に奪われる灯が 3 から 1 になる',
    // 実装は下限1でクランプする（受けた瞬間に尽きさせない）。残灯が6以下だと6まで減らないので、そこまで書く
    curse: '灯が6へる（1より下にはならない）',
    drain: -2,
    light: -6,
  },
  {
    id: 'keepsake',
    name: '忘れ形見',
    // 実装は加算ではなく代入（尽きた地点は0以下なので、超過ぶんも帳消しにして12へ戻す）。「12ふえる」ではないと書く
    boon: '一度だけ、灯が尽きた瞬間に灯が16にもどる',
    curse: '層を出るときの補給が1へる',
    lastLight: 16,
    supply: () => -1,
  },
  {
    id: 'fire-vein',
    name: '火の脈',
    boon: '層のはじまり、鉱物の駒5つが爆発鉱石に変わっている',
    curse: '層を出るときの補給が1へる',
    oreSeeds: 5,
    supply: () => -1,
  },
  {
    id: 'set-harpoon',
    name: '置き銛',
    boon: '層のはじまり、盤のどこかに銛が2本置かれている',
    curse: '灯の器が4せばまる',
    harpoons: 2,
    lampMax: -4,
  },
  {
    id: 'spore-trail',
    name: '光の名残',
    boon: '層のはじまり、光胞子が4つ盤に落ちている',
    curse: '層を出るときの補給が1へる',
    sporeTokens: 4,
    supply: () => -1,
  },
  {
    id: 'first-strike',
    name: '先手の礫',
    boon: '層のはじまり、すべての原生種が1の傷を負っている',
    curse: '灯の器が4せばまる',
    woundAll: 1,
    lampMax: -4,
  },
  {
    id: 'slow-wake',
    name: '眠りの帳',
    boon: '層のはじまり、原生種の目覚めが4手おそくなる',
    curse: '層を出るときの補給が1へる',
    wakeDelay: 4,
    supply: () => -1,
  },
  {
    id: 'big-catch',
    name: '大喰らい',
    boon: '4つ以上そろえるたび、灯が1ともる',
    curse: `知見の枠が1つへる（${UPGRADE_SLOTS_DEFAULT} → ${UPGRADE_SLOTS_DEFAULT - 1}）`,
    bigMatchLamp: 1,
    slots: -1,
  },
]

/** 幕主のあとに祝福を1つ選ぶ深度（PHASE2.md §3）。深度20は30層化のときにそのまま繋がる */
export const BLESSING_FLOORS = [10, 20]
export const isBlessingFloor = (floor: number) => BLESSING_FLOORS.includes(floor)

const byId = (ids: string[]) => BLESSINGS.filter((b) => ids.includes(b.id))

/**
 * 祝福を1つ受ける。灯・器・知見の枠は「採った瞬間」に一度だけ動く増減なのでここで RunState へ直接反映する
 * （補給のように毎層参照するものは、その都度 blessingXxx() を引く。盤面効果は層開始に board.ts が引く）。
 */
export function takeBlessing(run: RunState, id: string) {
  const d = BLESSINGS.find((b) => b.id === id)
  if (!d || run.blessings.includes(id)) return // 同名重複なし
  run.blessings.push(id)
  run.slots += d.slots ?? 0
  run.lampMax += d.lampMax ?? 0 // 器の増減は灯より先（大きな肺＝広げた器に注ぐ）
  run.oxygen = Math.min(run.oxygen, run.lampMax) // 器がせばまる呪い（置き銛・先手の礫）は灯もその場で器まで削る
  // 増える側は器でクランプ（gainLamp）。灯の代償で即座に尽きると「選んだ瞬間にランが終わる」ので1だけ残す
  if (d.light) {
    if (d.light > 0) gainLamp(run, d.light)
    else run.oxygen = Math.max(1, run.oxygen + d.light)
  }
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

/** 灯が尽きた瞬間に戻る灯の量（0＝その祝福を持っていない） */
export function blessingLastLight(ids: string[]): number {
  let n = 0
  for (const b of byId(ids)) n = Math.max(n, b.lastLight ?? 0)
  return n
}

/** 層開始（Board構築時）に一度だけ適用する盤面効果の合算。board.ts の applyBlessingFloorStart が読む */
export function blessingBoardFx(ids: string[]) {
  const fx = { oreSeeds: 0, harpoons: 0, sporeTokens: 0, wound: 0, wakeDelay: 0 }
  for (const b of byId(ids)) {
    fx.oreSeeds += b.oreSeeds ?? 0
    fx.harpoons += b.harpoons ?? 0
    fx.sporeTokens += b.sporeTokens ?? 0
    fx.wound += b.woundAll ?? 0
    fx.wakeDelay += b.wakeDelay ?? 0
  }
  return fx
}

/** 4つ以上のまとめ消し1回につきともる灯（0＝その祝福を持っていない） */
export function blessingBigMatchLamp(ids: string[]): number {
  let n = 0
  for (const b of byId(ids)) n += b.bigMatchLamp ?? 0
  return n
}

/** 選択肢（同名重複なしなので所持済みは出さない） */
export function pickBlessingOptions(ids: string[], rng: Rng, n = 3): BlessingDef[] {
  const pool = BLESSINGS.filter((b) => !ids.includes(b.id))
  const out: BlessingDef[] = []
  while (out.length < n && pool.length) out.push(...pool.splice(randInt(rng, pool.length), 1))
  return out
}
