// ドラフト抽選の唯一の実装（UI・計測の両方がここを使う）。
// 監査 codex_audit_night.md [B][C]5・[D]：
//   旧実装は「同じ系統」または「同じフック種」をシナジーと見なしていたため、
//   結果が繋がらない候補まで接続扱いになり、閉じた因果ループの部品が終盤まで
//   提示される保証がなかった（＝連鎖が深度で伸びない主因）。
//   本実装は upgrades.ts の consumes/produces を有向グラフとして扱い、
//   「所持の出力 → 候補の入力」または「候補の出力 → 所持の入力」だけを接続とする。
import { UPGRADES, type Resource, type UpgradeDef } from './upgrades'
import { randInt, type Rng } from './rng'

/** 候補と所持強化の因果的な繋がり（片方向でも可）。同系統は「近縁」であって接続ではない */
export function connectsTo(owned: UpgradeDef, cand: UpgradeDef): boolean {
  const has = (a: readonly Resource[] | undefined, r: Resource) => !!a && a.includes(r)
  for (const r of owned.produces ?? []) if (has(cand.consumes, r)) return true
  for (const r of cand.produces ?? []) if (has(owned.consumes, r)) return true
  return false
}

/** 所持のうち候補と因果で繋がるもの（カードの「接続」表示にも使う） */
export function connectedOwned(owned: UpgradeDef[], cand: UpgradeDef): UpgradeDef[] {
  return owned.filter((o) => connectsTo(o, cand))
}

/**
 * 候補がビルドの「輪を閉じる」か（監査[D]強化側2）。
 * 所持の出力を受け取り、かつ所持が使う資源を返す＝ A→候補→A の環が成立する。
 */
export function closesLoop(owned: UpgradeDef[], cand: UpgradeDef): boolean {
  const takesFromBuild = owned.some((o) => (o.produces ?? []).some((r) => (cand.consumes ?? []).includes(r)))
  const feedsBuild = owned.some((o) => (cand.produces ?? []).some((r) => (o.consumes ?? []).includes(r)))
  return takesFromBuild && feedsBuild
}

/** ビルドがすでに環を持っているか（持っていれば輪を閉じる保証は不要） */
function hasClosedLoop(owned: UpgradeDef[]): boolean {
  return owned.some((u) => closesLoop(owned.filter((o) => o.id !== u.id), u))
}

/**
 * 3択を作る。接続する候補を優先的に2枠、残り1枠は無関係（選択の幅）。
 * floor は保証枠の判定に使う（層クリア直後の深度）。
 */
export function pickDraftOptions(ownedIds: string[], rng: Rng, floor = 1): UpgradeDef[] {
  const owned = UPGRADES.filter((u) => ownedIds.includes(u.id))
  let remaining = UPGRADES.filter((u) => !ownedIds.includes(u.id))
  const take = (pred: (u: UpgradeDef) => boolean): UpgradeDef | null => {
    const cands = remaining.filter(pred)
    if (!cands.length) return null
    const picked = cands[randInt(rng, cands.length)]
    remaining = remaining.filter((u) => u.id !== picked.id)
    return picked
  }
  const connected = (u: UpgradeDef) => owned.some((o) => connectsTo(o, u))
  const picks: UpgradeDef[] = []

  // 深度5以降、まだ環が閉じていなければ「輪を閉じる候補」を1枠必ず提示する（監査[D]強化側2）。
  // これが無いと、終盤まで並列な小効果が並ぶだけで自走ループにならない
  if (floor >= 5 && owned.length > 0 && !hasClosedLoop(owned)) {
    const closer = take((u) => closesLoop(owned, u))
    if (closer) picks.push(closer)
  }
  // 接続枠：所持の出力を使う（または所持へ供給する）候補で埋める
  while (picks.length < 2) {
    const p = take(connected)
    if (!p) break
    picks.push(p)
  }
  // 埋め合わせ（接続候補が足りない場合）
  while (picks.length < 2) {
    const p = take(() => true)
    if (!p) break
    picks.push(p)
  }
  // 無関係枠：選択の幅を残す（接続だけだと毎回同じ方向へ収束する）
  const off = take((u) => !connected(u)) ?? take(() => true)
  if (off) picks.push(off)

  for (let i = picks.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    ;[picks[i], picks[j]] = [picks[j], picks[i]]
  }
  return picks
}
