// 結果画面の「なぜ細ったか」と「あと一つ」（PHASE2.md §2.5 ②③）。
//
// 狙いは「ぎりぎりクリアできないが、次はいいビルドが作れる気がする」。そのために結果画面が答えるのは2つだけ：
//   ② なぜ細ったか … 灯0の終了は静かに来るので、どこから細ったか・何にいちばん奪われたかを事実として並べる
//   ③ あと一つ    … 所持していた知見に対し、輪を閉じられた候補を名前と理由つきで出す（draft.ts の closesLoop を使う）
// **責める語は書かない**（「〜すべきだった」「無駄」等）。起きたことだけを書く。
//
// このファイルは表示文字列まで作る。計算だけを返して main.ts で文を組むと文言がテストの外に出てしまうため。
import { closesLoop, connectedOwned } from './draft'
import { RESOURCE_LABEL, UPGRADES, type Resource, type UpgradeDef } from './upgrades'

/** その層を出るときに手元に残っていた灯（補給を足す前）。灯が尽きて終わった層は 0 */
export interface FloorLight {
  floor: number
  light: number
}

/** 原生種に灯を奪われた1件。灯を直接奪うのはこの2種だけ（board.ts drainOxygen） */
export interface DrainSample {
  floor: number
  kind: 'breathstealer' | 'boss'
  amount: number
}

/** 灯を奪う原生種の表示名（PHASE2.md §2.7 の語彙） */
const DRAIN_NAME: Record<DrainSample['kind'], string> = { breathstealer: '灯喰み', boss: '深匣主' }

/**
 * 灯が細り始めた深度。残灯（補給前）が最後に最大となった層の**次**の層を返す。
 * 「最後の」最大を採るのは、同じ値が並んでいる間はまだ細っていないと読むため。
 * 一度も下がらなかった（＝最大が最終層）／層が1つしかないなら null。
 * series は深度の昇順であることを前提にする。
 */
export function thinningFloor(series: FloorLight[]): number | null {
  if (series.length < 2) return null
  let peak = 0
  for (let i = 1; i < series.length; i++) if (series[i].light >= series[peak].light) peak = i
  if (peak === series.length - 1) return null
  return series[peak + 1].floor
}

/** 名指しする損失1件（同じ層の同じ原生種ぶんを合算したもの） */
export interface LossSummary {
  floor: number
  kind: DrainSample['kind']
  times: number
  amount: number
}

/**
 * 名指しする損失を1件だけ選ぶ（PHASE2.md §2.5②「直近の大きな損失を1件だけ」）。
 * 同じ層・同じ原生種ぶんを合算し、合計が最大のものを採る。同点なら深いほう＝直近を採る。
 */
export function biggestLoss(drains: DrainSample[]): LossSummary | null {
  const groups = new Map<string, LossSummary>()
  for (const d of drains) {
    const key = `${d.floor}:${d.kind}`
    const g = groups.get(key) ?? { floor: d.floor, kind: d.kind, times: 0, amount: 0 }
    g.times++
    g.amount += d.amount
    groups.set(key, g)
  }
  let best: LossSummary | null = null
  for (const g of groups.values()) {
    if (!best || g.amount > best.amount || (g.amount === best.amount && g.floor > best.floor)) best = g
  }
  return best
}

/**
 * 「なぜ細ったか」の行（0〜2行）。変曲点 → 名指しする損失の順。
 * 推移そのものは数字を並べても読めない（30層ぶんの数列になる）ので結果画面の折れ線に任せ、ここは言葉にする2件だけを返す。
 * 事実だけを書く。数字が読めれば十分なので評価語も感嘆も付けない。
 */
export function lightPostmortem(series: FloorLight[], drains: DrainSample[]): string[] {
  const out: string[] = []
  const t = thinningFloor(series)
  if (t !== null) out.push(`深度${t}から灯が細り始めた`)
  const loss = biggestLoss(drains)
  if (loss) out.push(`深度${loss.floor}　${DRAIN_NAME[loss.kind]}に${loss.times}度触れた（−${loss.amount}）`)
  return out
}

/** 「あと一つ」を提示する理由。dir は資源が流れる向き（所持→候補 / 候補→所持） */
export interface MissingReason {
  resource: Resource
  dir: 'from-build' | 'to-build'
  /** その資源を扱っていた所持知見の数 */
  owners: number
}

export interface MissingLink {
  id: string
  name: string
  reason: MissingReason
  /** 本当に輪が閉じたか。false＝片側に繋がるだけ（見出しで言い分けるために持つ） */
  closes: boolean
}

/** 提示の理由：所持と候補をいちばん多く繋いでいる資源を1つ選ぶ（同数なら所持→候補の向きを採る） */
function reasonFor(owned: UpgradeDef[], cand: UpgradeDef): MissingReason | null {
  let best: MissingReason | null = null
  for (const r of cand.consumes ?? []) {
    const owners = owned.filter((o) => (o.produces ?? []).includes(r)).length
    if (owners > 0 && (!best || owners > best.owners)) best = { resource: r, dir: 'from-build', owners }
  }
  for (const r of cand.produces ?? []) {
    const owners = owned.filter((o) => (o.consumes ?? []).includes(r)).length
    if (owners > 0 && (!best || owners > best.owners)) best = { resource: r, dir: 'to-build', owners }
  }
  return best
}

/**
 * 「あと一つ」：所持していた知見に対して、輪を閉じられた候補を最大 n 件（PHASE2.md §2.5③）。
 * 輪を閉じる候補が1つもなければ、呼応するだけの候補へ落とす（closes=false。嘘をつかないための区別）。
 * 並び順は ①輪を閉じるか ②呼応した所持の数 ③UPGRADES の並び（同点でも結果が揺れないように）。
 */
export function missingLinks(ownedIds: string[], n = 2): MissingLink[] {
  const owned = UPGRADES.filter((u) => ownedIds.includes(u.id))
  if (!owned.length) return []
  const scored = UPGRADES.filter((u) => !ownedIds.includes(u.id))
    .map((c) => ({ c, closes: closesLoop(owned, c), links: connectedOwned(owned, c).length }))
    .filter((s) => s.links > 0)
  scored.sort((a, b) => Number(b.closes) - Number(a.closes) || b.links - a.links)
  const closers = scored.filter((s) => s.closes)
  const out: MissingLink[] = []
  for (const s of closers.length ? closers : scored) {
    const reason = reasonFor(owned, s.c)
    if (!reason) continue
    out.push({ id: s.c.id, name: s.c.name, reason, closes: s.closes })
    if (out.length >= n) break
  }
  return out
}

/** 「あと一つ」1件ぶんの行。名前だけでは動機にならないので理由を必ず並べる（PHASE2.md §2.5③） */
export function missingLinkLine(link: MissingLink): string {
  const label = RESOURCE_LABEL[link.reason.resource]
  const verb = link.reason.dir === 'from-build' ? '生む' : '使う'
  return `${link.name}　${label}を${verb}知見が${link.reason.owners}つあった`
}

export interface Postmortem {
  /** 「なぜ細ったか」の行 */
  light: string[]
  /** 「あと一つ」の見出しと行。候補が無ければ null */
  missing: { title: string; lines: string[] } | null
}

/** 結果画面が出す2欄をまとめて作る（main.ts はこれを縦に並べるだけ） */
export function buildPostmortem(series: FloorLight[], drains: DrainSample[], ownedIds: string[], n = 2): Postmortem {
  const links = missingLinks(ownedIds, n)
  return {
    light: lightPostmortem(series, drains),
    missing: links.length
      ? {
          title: links[0].closes ? 'あと一つ　これがあれば輪が閉じた' : 'あと一つ　これと呼応した',
          lines: links.map(missingLinkLine),
        }
      : null,
  }
}
