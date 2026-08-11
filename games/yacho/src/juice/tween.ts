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
}

const tweens: Tween[] = []

export function tween(
  obj: unknown,
  to: Record<string, number>,
  dur: number,
  opts: { delay?: number; ease?: Ease; onDone?: () => void } = {},
): void {
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
  })
}

export function delay(ms: number, fn: () => void): void {
  tween({}, {}, ms, { onDone: fn })
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

export function update(dtMs: number): void {
  for (const tw of tweens) {
    if (tw.dead) continue
    if (tw.delay > 0) {
      tw.delay -= dtMs
      if (tw.delay > 0) continue
      dtMs += tw.delay // 食い込んだ分
    }
    if (tw.t < 0) {
      tw.t = 0
      for (const k of Object.keys(tw.to)) tw.from[k] = tw.obj[k]
    }
    tw.t += dtMs
    const p = tw.dur <= 0 ? 1 : Math.min(1, tw.t / tw.dur)
    const e = tw.ease(p)
    for (const k of Object.keys(tw.to)) tw.obj[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * e
    if (p >= 1) {
      tw.dead = true
      tw.onDone?.()
    }
  }
  // 掃除
  for (let i = tweens.length - 1; i >= 0; i--) if (tweens[i].dead) tweens.splice(i, 1)
}
