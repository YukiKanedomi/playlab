// shared/juice.ts — 手触りの定石（任意の道具箱）。イージング・画面揺れ・粒子・トゥイーン。
// trail の中身を抽出。新作はこれを import するだけで“気持ちよさ”の下限が上がる。

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

// イージング（t: 0..1）
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOutBack = (t: number) => {
  const c1 = 1.70158,
    c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

/** 画面揺れ。add(強さ)で積み、毎フレーム update(dt)、描画前に apply(ctx)。 */
export function makeShake(max = 24) {
  let v = 0
  return {
    add: (m: number) => {
      v = Math.min(v + m, max)
    },
    set: (m: number) => {
      v = Math.min(m, max)
    },
    update: (dt: number) => {
      v = Math.max(0, v - dt * 40)
    },
    apply: (ctx: CanvasRenderingContext2D) => {
      if (v > 0) ctx.translate((Math.random() * 2 - 1) * v, (Math.random() * 2 - 1) * v)
    },
    get value() {
      return v
    },
  }
}

export type JParticle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; color: string; grav: number }

/** 汎用パーティクル。burst で撒き、update/draw するだけ。 */
export class Particles {
  list: JParticle[] = []
  burst(x: number, y: number, n: number, color: string, spd: number, grav = 80) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      const s = spd * (0.3 + Math.random() * 0.7)
      this.list.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.3 + Math.random() * 0.5, max: 0.8, r: 1.5 + Math.random() * 2, color, grav })
    }
  }
  update(dt: number) {
    for (const p of this.list) {
      p.life -= dt
      p.x += p.vx * dt
      p.y += p.vy * dt
      p.vy += p.grav * dt
      p.vx *= 0.96
    }
    this.list = this.list.filter((p) => p.life > 0)
  }
  draw(ctx: CanvasRenderingContext2D) {
    for (const p of this.list) {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
      ctx.fillStyle = p.color
      ctx.beginPath()
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }
}

/** 値を目標へ追従させる簡易トゥイーン（減衰補間）。手触りのラグ作りに。 */
export function approach(cur: number, target: number, dt: number, rate = 14) {
  return cur + (target - cur) * Math.min(1, dt * rate)
}
