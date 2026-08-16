// 極小トゥイーン。Pixi ticker から update(dt) を呼ぶ。
// 演出時間の根拠は RESEARCH.md §5（実測値）。

export type Ease = (t: number) => number
export const easeOutCubic: Ease = (t) => 1 - Math.pow(1 - t, 3)
export const easeInCubic: Ease = (t) => t * t * t
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
/** 重力落下。位置 x ∝ t² の実挙動そのもの（easeInCubic は溜めが強すぎて「浮いて見える」） */
export const easeInQuad: Ease = (t) => t * t
/** 控えめオーバーシュート（約5%）。標準の easeOutBack（約10%）は駒には跳ねすぎる */
export const easeOutBackSoft: Ease = (t) => {
  const c1 = 0.9
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
export const easeOutBounce: Ease = (t) => {
  const n1 = 7.5625
  const d1 = 2.75
  if (t < 1 / d1) return n1 * t * t
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
  return n1 * (t -= 2.625 / d1) * t + 0.984375
}

interface Tween {
  obj: Record<string, number>
  from: Record<string, number>
  to: Record<string, number>
  dur: number
  delay: number
  t: number
  ease: Ease
  onDone?: () => void
  dead: boolean
  channel: string
  tag?: string // 計器（C案移行 Phase1）：発注元の文脈。DIAG時のみ設定される
  scope: number // C案移行Phase4（§7.3）：この予約を作った再生スコープ（0=スコープ外の常設/FX）
}

// ---- 再生スコープ（C案移行Phase4・codex_c_phase46_plan.md §7.3）----
// playSegment() が「このセグメントが作った盤面tweenの完了」だけを待てるようにする仕組み。
// チャンネル全体（channelEnd）を待つと、爆発鉱石のゆらぎ等の常設アニメ（既定'board'）が
// 混ざって永遠に0にならない（実測：毎セグメントが上限まで待たされ手が20秒級に伸びた）。
// onDoneコールバックが作る子tween（着地バウンス等）は親のスコープを継承する＝取りこぼさない。
let currentScope = 0

/** 以降の tween()/delay() 予約に付くスコープを設定（0=スコープ外）。playSegmentが囲みで使う */
export function setTweenScope(s: number): void {
  currentScope = s
}

/** 指定スコープの生存tweenの残り時間(ms)の最大値（channelEndのスコープ版） */
export function scopeEnd(scope: number): number {
  let max = 0
  for (const tw of tweens) {
    if (tw.dead || tw.scope !== scope) continue
    const remain = tw.t < 0 ? Math.max(0, tw.delay) + tw.dur : Math.max(0, tw.dur - tw.t)
    if (remain > max) max = remain
  }
  return max
}

const tweens: Tween[] = []

// ---- 計器（C案移行 Phase1・codex_arch_review.md §1-2）：tween単一writer不変量 ----
// 同一オブジェクトの同一プロパティに「時間窓が重なる」writerが2本以上あるのは競合の兆候。
// 順次予約（連鎖の1段目と2段目の落下など、窓が重ならないもの）は正当なので窓の重なりで判定する。
let diagOn = false
let diagCtx = ''
let diagConflictCb: ((info: { key: string; newTag: string; oldTag: string; channel: string }) => void) | null = null

/** 計器の有効化（?debug 時に diag.ts が呼ぶ）。conflictCb は多重writer検出ごとに呼ばれる */
export function setTweenDiag(on: boolean, conflictCb?: (info: { key: string; newTag: string; oldTag: string; channel: string }) => void): void {
  diagOn = on
  diagConflictCb = conflictCb ?? null
}

/** 予約の発注文脈タグ（例 "m12/e84/refill"）。DIAG時、以降の tween()/delay() に焼き込まれる */
export function setTweenCtx(tag: string): void {
  diagCtx = tag
}

/** 生存tweenの時間窓 [start, end)（現在からの相対ms）。未開始= [delay, delay+dur]、開始済み= [0, dur-t] */
function windowOf(tw: Tween): [number, number] {
  if (tw.t < 0) return [Math.max(0, tw.delay), Math.max(0, tw.delay) + tw.dur]
  return [0, Math.max(0, tw.dur - tw.t)]
}

const DIAG_PROPS = ['alpha', 'x', 'y'] // 検査対象（position/scale は x/y、Sprite本体は alpha）

function checkMultiWriter(nu: Tween): void {
  // 駒スプライト（とその position/scale。makePieceが__pieceを焼き込む）だけを検査する。
  // FX粒子は既定チャンネル'board'で予約されるものが多く、チャンネルでは絞れない
  // （実測：初回計測568件の上位はupgrade-fire/goal-progressのfx連鎖同士のノイズだった）
  if (!(nu.obj as { __piece?: boolean }).__piece) return
  const keys = Object.keys(nu.to).filter((k) => DIAG_PROPS.includes(k))
  if (keys.length === 0) return
  const [ns, ne] = windowOf(nu)
  for (const tw of tweens) {
    if (tw === nu || tw.dead || tw.obj !== nu.obj) continue
    for (const k of keys) {
      if (!(k in tw.to)) continue
      const [os, oe] = windowOf(tw)
      // 8ms未満の重なりは境界の丸め（同フレーム内の連結予約）とみなし無視
      if (ns < oe - 8 && os < ne - 8) {
        diagConflictCb?.({ key: k, newTag: nu.tag ?? '?', oldTag: tw.tag ?? '?', channel: nu.channel })
        return // 1予約につき1報告で十分（大量重複時のログ洪水を防ぐ）
      }
    }
  }
}

/** tween内部時計（update()に渡されたdtMsの累積）。修正2：BoardViewが壁時計(performance.now)で
 *  タイムライン終端を計算すると、フレーム落ちでこの時計が遅れたときに+200msバッファを食い潰し、
 *  前の手の演出中にreconcileが早発する（複数駒の一斉スナップの主因候補）。tween側の遅れ（maxElapsedMS
 *  クランプ・タブ非表示での停止）と歩調を揃えるため、終端計算は必ずこの時計を基準にする */
let clock = 0
export function now(): number {
  return clock
}

export function tween(
  obj: unknown,
  to: Record<string, number>,
  dur: number,
  opts: { delay?: number; ease?: Ease; onDone?: () => void; channel?: string } = {},
): void {
  if (obj == null) return // 破棄済みPixiオブジェクトのgetterがnullを返すケース
  const tw: Tween = {
    obj: obj as Record<string, number>,
    from: {},
    to,
    dur,
    delay: opts.delay ?? 0,
    t: -1, // from 未初期化マーク
    ease: opts.ease ?? easeOutCubic,
    onDone: opts.onDone,
    dead: false,
    channel: opts.channel ?? 'board',
    scope: currentScope,
  }
  if (diagOn) {
    tw.tag = diagCtx
    checkMultiWriter(tw)
  }
  tweens.push(tw)
}

export function delay(ms: number, fn: () => void, channel?: string): void {
  // channel 省略時は 'board'（tween側の既定）。装飾FXの生成予約は 'fx' を渡し、
  // 盤面チャンネルの全断（completeChannel('board')）に巻き込まれないようにする（rm_tempo.md §8 P3 Step1）。
  // **dur=ms ではなく delay=ms で予約する**（Codex検収 blocking-1）：dur方式だと初回updateで開始済み
  // (t>=0) になり、compressChannel の「未開始のみ圧縮」から1フレームで外れてしまう＝SE・発火FXの
  // 予約が圧縮に追従しない。delay方式なら発火の瞬間まで「未開始」なので予約全体が圧縮できる
  tween({}, {}, 0, { delay: ms, onDone: fn, channel })
}

/** 対象オブジェクトの全トゥイーンを終端値まで飛ばす（入力割込のスナップ用） */
export function snap(obj: unknown): void {
  for (const tw of tweens) {
    if (tw.obj === obj && !tw.dead) {
      for (const k of Object.keys(tw.to)) tw.obj[k] = tw.to[k]
      tw.dead = true
      if (diagOn) diagCtx = `snap-cb:${tw.tag ?? '?'}`
      const prevScope = currentScope
      currentScope = tw.scope // 子tweenは親のスコープを継承（§7.3）
      tw.onDone?.()
      currentScope = prevScope
    }
  }
}

/**
 * 対象オブジェクトの進行中トゥイーンを「即時snap」ではなく短いキャッチアップtweenに置き換える（修正4）。
 * 補充駒は y=-0.8S・alpha=0 の盤外待機中はtweenが delay 予約のまま未開始（from未確定）のため、
 * そのままsnapすると盤外→最終セルへ0フレームでワープして見える（テレポート知覚の主因の一つ）。
 * 現在値をfromに取り直し、ms掛けてtoへ追いつくtweenに差し替える。onDoneは新tweenへそのまま引き継ぐ。
 */
export function snapSoft(obj: unknown, ms = 70): void {
  const list = tweens.slice() // 新tweenをその場でtweensへpushするため、スナップショットを回す（無限ループ防止）
  for (const tw of list) {
    if (tw.obj === obj && !tw.dead) {
      const from: Record<string, number> = {}
      try {
        for (const k of Object.keys(tw.to)) from[k] = tw.obj[k]
      } catch {
        continue // 破棄済みオブジェクトは無視
      }
      tw.dead = true
      tweens.push({
        obj: tw.obj,
        from,
        to: tw.to,
        dur: ms,
        delay: 0,
        t: 0,
        ease: easeOutCubic,
        onDone: tw.onDone,
        dead: false,
        channel: tw.channel,
        tag: tw.tag, // 計器：元予約の文脈を引き継ぐ
        scope: tw.scope, // スコープも引き継ぐ（§7.3）
      })
    }
  }
}

/** 対象オブジェクトに生きたトゥイーンがあるか（修正5：移動中の駒を古い座標へピン留めしないための判定用） */
export function hasTween(obj: unknown): boolean {
  return tweens.some((tw) => tw.obj === obj && !tw.dead)
}

/** 対象オブジェクトに、指定プロパティ(key)を to に含む生きたトゥイーンがあるか（タイムライン予算C：
 *  hasTween(obj)は「何かしら」のtweenの有無しか見ないため、rotationだけのtweenが残る透明駒（alpha別tween無し）
 *  を誤って「生きている」扱いしてしまう。alpha専用の判定用に追加（codex_timeline_review.md §4-1） */
export function hasTweenProperty(obj: unknown, key: string): boolean {
  return tweens.some((tw) => tw.obj === obj && !tw.dead && key in tw.to)
}

/** 指定チャンネルの生存トゥイーンの残り時間(ms)の最大値。未開始= max(0,delay)+dur、開始済み= max(0,dur-t)
 *  （タイムライン予算B：単調増加するtimelineEndAbsの代わりに、圧縮後の実際の残時間を再計算する。
 *  codex_timeline_review.md §4-1・§2-B） */
export function channelEnd(channel: string): number {
  let max = 0
  for (const tw of tweens) {
    if (tw.dead || tw.channel !== channel) continue
    const remain = tw.t < 0 ? Math.max(0, tw.delay) + tw.dur : Math.max(0, tw.dur - tw.t)
    if (remain > max) max = remain
  }
  return max
}

/** 複数チャンネルの channelEnd の最大値 */
export function channelEndMany(channels: string[]): number {
  let max = 0
  for (const ch of channels) max = Math.max(max, channelEnd(ch))
  return max
}

/** 対象オブジェクトのトゥイーンを onDone を呼ばずに打ち切る（修正8：FXパーティクルプール回収用。
 *  snap/completeAll と違い終端値を書き込まない＝再利用する側が次のacquireGで値を設定し直す前提） */
export function cancel(obj: unknown): void {
  for (const tw of tweens) {
    if (tw.obj === obj && !tw.dead) tw.dead = true
  }
}

/**
 * チャンネル内の**未開始**トゥイーンの残り時間を一様に圧縮する（2026-08-15 重なり調査）。
 * 新しい手が始まったとき、前の手の残り演出（深い連鎖ほど数秒先まで予約がある）を「切らずに早送り」する。
 * 一様な線形圧縮なので予約同士の順序は保たれ、演出は全部再生される＝JUICE §0-5「前の演出を切って
 * スナップするのは禁止」と両立する。進行中（開始済み）のトゥイーンは触らない（速度が跳ねるのを防ぐ）。
 */
export function compressChannel(channel: string, factor: number): void {
  for (const tw of tweens) {
    if (tw.dead || tw.channel !== channel) continue
    if (tw.t >= 0) continue // 開始済みは触らない
    if (tw.delay > 0) tw.delay *= factor
    tw.dur *= factor
  }
}

/** 全トゥイーンを即時完了（新しいタイムライン開始前のスナップ）。onDone も発火する */
export function completeAll(): void {
  // onDone が新しいトゥイーンを生む場合があるので、現時点の分だけ処理
  const list = tweens.slice()
  for (const tw of list) {
    if (tw.dead) continue
    tw.dead = true
    try {
      for (const k of Object.keys(tw.to)) tw.obj[k] = tw.to[k]
    } catch {
      /* 破棄済みオブジェクトは無視 */
    }
    tw.onDone?.()
  }
}

/**
 * 指定チャンネルのトゥイーンだけを即時完了する（新タイムライン開始前のスナップ）。
 * 盤面状態（駒位置・拍動等。既定チャンネル 'board'）とは別に、破棄可能な余韻FX（'fx'）を
 * 分離するために追加。'fx' は次の入力が来ても打ち切らず自然にフェードさせたい場合に使う。
 */
export function completeChannel(channel: string): void {
  const list = tweens.slice()
  for (const tw of list) {
    if (tw.dead || tw.channel !== channel) continue
    tw.dead = true
    try {
      for (const k of Object.keys(tw.to)) tw.obj[k] = tw.to[k]
    } catch {
      /* 破棄済みオブジェクトは無視 */
    }
    tw.onDone?.()
  }
}

/** 実行中トゥイーン数（QA用：静止判定） */
export function activeCount(): number {
  return tweens.filter((t) => !t.dead).length
}

export function update(dtMs: number): void {
  clock += dtMs // 修正2：内部時計を歩かせる（BoardViewの終端計算がこれを基準にする）
  for (const tw of tweens) {
    if (tw.dead) continue
    // 修正1：食い込んだdelay分はこのtween専用のローカル変数(eff)に閉じ込め、ループ共有のdtMsは
    // 絶対に書き換えない。以前はdtMs自体を書き換えていたため、同一フレームに複数のdelayed tweenが
    // 開始すると後続tween全部のdtが縮み、負になると逆再生される（駒のガタつき/瞬間移動の主因）。
    let eff = dtMs
    if (tw.delay > 0) {
      tw.delay -= dtMs
      if (tw.delay > 0) continue
      eff = dtMs + tw.delay // 食い込んだ分（tw.delayは負値）をこのtweenの実効dtとする
    }
    if (tw.t < 0) {
      tw.t = 0
      try {
        for (const k of Object.keys(tw.to)) tw.from[k] = tw.obj[k]
      } catch {
        tw.dead = true // 対象が破棄済み：このトゥイーンだけ落とす
        continue
      }
    }
    tw.t += eff
    const p = tw.dur <= 0 ? 1 : Math.min(1, tw.t / tw.dur)
    const e = tw.ease(p)
    try {
      for (const k of Object.keys(tw.to)) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e
    } catch {
      tw.dead = true // 破棄済みオブジェクト：このトゥイーンだけ落とし、他は巻き込まない
      continue
    }
    if (p >= 1) {
      tw.dead = true
      if (diagOn) diagCtx = `cb:${tw.tag ?? '?'}`
      const prevScope = currentScope
      currentScope = tw.scope // 子tween（着地バウンス等）は親のスコープを継承（§7.3）
      tw.onDone?.()
      currentScope = prevScope
    }
  }
  // 掃除
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].dead) tweens.splice(i, 1)
}
