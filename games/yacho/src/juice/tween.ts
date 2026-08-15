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
}

const tweens: Tween[] = []

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
  tweens.push({
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
  })
}

export function delay(ms: number, fn: () => void, channel?: string): void {
  // channel 省略時は 'board'（tween側の既定）。装飾FXの生成予約は 'fx' を渡し、
  // 盤面チャンネルの全断（completeChannel('board')）に巻き込まれないようにする（rm_tempo.md §8 P3 Step1）
  tween({}, {}, ms, { onDone: fn, channel })
}

/** 対象オブジェクトの全トゥイーンを終端値まで飛ばす（入力割込のスナップ用） */
export function snap(obj: unknown): void {
  for (const tw of tweens) {
    if (tw.obj === obj && !tw.dead) {
      for (const k of Object.keys(tw.to)) tw.obj[k] = tw.to[k]
      tw.dead = true
      tw.onDone?.()
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
      })
    }
  }
}

/** 対象オブジェクトに生きたトゥイーンがあるか（修正5：移動中の駒を古い座標へピン留めしないための判定用） */
export function hasTween(obj: unknown): boolean {
  return tweens.some((tw) => tw.obj === obj && !tw.dead)
}

/** 対象オブジェクトのトゥイーンを onDone を呼ばずに打ち切る（修正8：FXパーティクルプール回収用。
 *  snap/completeAll と違い終端値を書き込まない＝再利用する側が次のacquireGで値を設定し直す前提） */
export function cancel(obj: unknown): void {
  for (const tw of tweens) {
    if (tw.obj === obj && !tw.dead) tw.dead = true
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
      tw.onDone?.()
    }
  }
  // 掃除
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].dead) tweens.splice(i, 1)
}
