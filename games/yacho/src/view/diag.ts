// 盤面表示の計器（C案移行 Phase1・codex_arch_review.md §1）。
// ?debug 付きURLでのみ有効。Sprite個体の安定ID・帳簿操作の履歴・違反カウンタを持ち、
// 「どの個体が・どの手で・どの経路で」帳簿を出入りしたかを事後に追えるようにする。
// 本番（フラグ無し）ではカウンタ加算も履歴記録も一切走らない（呼び出し側が DIAG でガードする）。
import type { Sprite } from 'pixi.js'
import { hasTweenProperty, now as tweenNow, setTweenDiag } from '../juice/tween'

export const DIAG = typeof location !== 'undefined' && /[?&](debug|diag)\b/.test(location.search)

/** 違反・保険発動の件数。全部0が正常（C案移行の各Phaseの合格判定に使う） */
export const counters = {
  multiWriter: 0, // tween単一writer違反（時間窓の重なり）
  ledger: 0, // 3帳簿の全単射違反（mapped∩doomed・重複参照・破棄済み参照）
  staleCb: 0, // 旧世代callbackが現行mapped駒に触った回数
  refillPostcond: 0, // 補充予約直後のpostcondition違反
  repairAlpha: 0, // repairStrandedAlpha の発動（保険C）
  orphanSwept: 0, // sweepOrphans が拾った幽霊
  staleFolded: 0, // foldStaleAt が畳んだ居座り
  reconcileCorrected: 0, // 終端reconcileが実際に直した件数
}

type Op = { op: string; k: string; sid: number; kind: string; mv: number; at: number }
const OPS_CAP = 128
const ops: Op[] = []

let nextSid = 1

/** Sprite個体の安定ID（初回アクセス時に採番して焼き込む） */
export function sidOf(sp: Sprite): number {
  const s = sp as unknown as { __sid?: number }
  if (s.__sid == null) s.__sid = nextSid++
  return s.__sid
}

/** 駒スプライトの目印（tween単一writer検査の対象化）。本体・position・scale の3オブジェクトに焼き込む */
export function markPiece(sp: Sprite): void {
  ;(sp as unknown as { __piece?: boolean }).__piece = true
  ;(sp.position as unknown as { __piece?: boolean }).__piece = true
  ;(sp.scale as unknown as { __piece?: boolean }).__piece = true
}

/** 帳簿操作をring bufferへ記録（make/pop/doom+/doom-/fold/sweep/reconcile-*） */
export function opLog(op: string, k: string, sp: Sprite, mv: number): void {
  const kind = (sp as unknown as { __kind?: string }).__kind ?? '?'
  ops.push({ op, k, sid: sidOf(sp), kind, mv, at: Math.round(performance.now()) })
  if (ops.length > OPS_CAP) ops.splice(0, ops.length - OPS_CAP)
}

/** 指定セル（省略時は全体）の直近操作履歴 */
export function recentOps(k?: string, n = 16): Op[] {
  const src = k ? ops.filter((o) => o.k === k) : ops
  return src.slice(-n)
}

/** Sprite個体の診断ダンプ（違反報告に添える） */
export function dumpSprite(sp: Sprite): Record<string, unknown> {
  const s = sp as unknown as { __sid?: number; __kind?: string }
  return {
    sid: s.__sid ?? -1,
    kind: s.__kind ?? '?',
    destroyed: sp.destroyed,
    alpha: sp.destroyed ? NaN : Number(sp.alpha.toFixed(3)),
    x: sp.destroyed ? NaN : Math.round(sp.position.x),
    y: sp.destroyed ? NaN : Math.round(sp.position.y),
  }
}

/** 違反の構造化報告。counters の該当キーを加算しつつ console.warn する */
export function report(counter: keyof typeof counters, reason: string, data: Record<string, unknown>): void {
  counters[counter]++
  console.warn('[yacho][diag]', reason, data)
}

// 多重writerの「型」別集計（発注元タグの数値を潰してパターン化。どの経路ペアが競合しているかを見る）
const conflictKinds = new Map<string, number>()
function normTag(s: string): string {
  return s
    .replace(/m\d+/g, 'm')
    .replace(/e\d+\//g, '')
    .replace(/\d+\|\d+/g, 'K')
    .replace(/\d{2,}/g, '#')
}

if (DIAG) {
  setTweenDiag(true, (info) => {
    counters.multiWriter++
    const kind = `${info.key} ${normTag(info.newTag)} <> ${normTag(info.oldTag)}`
    conflictKinds.set(kind, (conflictKinds.get(kind) ?? 0) + 1)
    if (counters.multiWriter <= 20) console.warn('[yacho][diag] tween multi-writer', JSON.stringify(info))
  })
  // ハーネスから counters/ops を読めるように公開（deeprun系が合格判定に使う）
  ;(window as unknown as { __yachoDiag?: unknown }).__yachoDiag = {
    counters,
    recentOps,
    conflictKinds: () => Object.fromEntries([...conflictKinds.entries()].sort((a, b) => b[1] - a[1])),
    // 幽霊の三分類（codex_c_phase46_plan.md §6）用：検出器が「予約待ち（writerあり＝偽陽性）」と
    // 「本物のstranded（writerなし）」を切り分けるための照会窓口
    hasAlphaWriter: (sp: Sprite) => hasTweenProperty(sp, 'alpha'),
    hasPositionWriter: (sp: Sprite) => hasTweenProperty(sp.position, 'x') || hasTweenProperty(sp.position, 'y'),
    tweenNow: () => tweenNow(),
    reset: () => {
      for (const k of Object.keys(counters) as (keyof typeof counters)[]) counters[k] = 0
      ops.length = 0
      conflictKinds.clear()
    },
  }
}
