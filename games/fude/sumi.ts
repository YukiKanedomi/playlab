// sumi.ts — 水墨画の質感レイヤー（紙・山水・飛沫・染み）
// games/fude/main.ts から import して使う。描画は Canvas2D のみ。

import { SUMI } from './gika'
import { clamp } from '../../shared/juice'

// ── 1. 紙テクスチャ ──────────────────────────────────────────────
/**
 * 紙の繊維と染みを焼き込んだオフスクリーン Canvas を返す。
 * resize 時に一度だけ生成してキャッシュすること（毎フレーム生成禁止）。
 */
export function makePaper(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  // ベタ塗り
  ctx.fillStyle = '#f2ead8'
  ctx.fillRect(0, 0, w, h)

  // 繊維（約400本の薄い線）
  for (let i = 0; i < 400; i++) {
    const x = Math.random() * w
    const y = Math.random() * h
    const len = 8 + Math.random() * 22
    const ang = Math.random() * Math.PI
    const alpha = 0.03 + Math.random() * 0.02
    ctx.save()
    ctx.strokeStyle = `rgba(120,105,80,${alpha.toFixed(3)})`
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x - Math.cos(ang) * len * 0.5, y - Math.sin(ang) * len * 0.5)
    ctx.lineTo(x + Math.cos(ang) * len * 0.5, y + Math.sin(ang) * len * 0.5)
    ctx.stroke()
    ctx.restore()
  }

  // 染み（5〜8個の radialGradient）
  const numStains = 5 + Math.floor(Math.random() * 4)
  for (let i = 0; i < numStains; i++) {
    const sx = Math.random() * w
    const sy = Math.random() * h
    const r = 40 + Math.random() * 80
    const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r)
    grad.addColorStop(0, 'rgba(90,80,60,0.02)')
    grad.addColorStop(1, 'rgba(90,80,60,0)')
    ctx.fillStyle = grad
    ctx.fillRect(sx - r, sy - r, r * 2, r * 2)
  }

  return c
}

// ── 2. 山水背景 ──────────────────────────────────────────────────
/**
 * 遠山のシルエット（2〜3層）を焼き込んだオフスクリーン Canvas を返す。
 * maki が変わるたびに再生成してキャッシュすること。
 */
export function makeLandscape(w: number, h: number, maki: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!

  // 透明ベース
  ctx.clearRect(0, 0, w, h)

  // 百鬼繚乱（maki>=3）では全体をやや暗く
  const darkBonus = maki >= 3 ? 0.04 : 0

  // 山のシルエット生成（有機的な稜線）
  function buildRidgeLine(
    seed: number,
    yBase: number,
    freqs: number[],
    amps: number[],
  ): { x: number; y: number }[] {
    const pts: { x: number; y: number }[] = []
    const steps = Math.ceil(w / 4) + 2
    for (let i = 0; i <= steps; i++) {
      const xr = i / steps
      let yNoise = 0
      for (let fi = 0; fi < freqs.length; fi++) {
        yNoise += Math.sin(xr * freqs[fi] * Math.PI + seed + fi * 1.3) * amps[fi]
        yNoise += Math.cos(xr * freqs[fi] * 1.7 * Math.PI + seed * 2.1 + fi) * amps[fi] * 0.4
      }
      pts.push({ x: xr * w, y: yBase + yNoise })
    }
    return pts
  }

  type LayerDef = { alphas: number[]; yBase: number; yRange: number; freqs: number[]; amps: number[] }

  let layers: LayerDef[]
  if (maki === 0) {
    // なだらかな丘
    layers = [
      { alphas: [0.05 + darkBonus], yBase: h * 0.22, yRange: h * 0.05, freqs: [1.8, 3.2], amps: [h * 0.04, h * 0.02] },
      { alphas: [0.09 + darkBonus], yBase: h * 0.26, yRange: h * 0.04, freqs: [2.4, 4.1], amps: [h * 0.025, h * 0.015] },
      { alphas: [0.14 + darkBonus], yBase: h * 0.29, yRange: h * 0.03, freqs: [3.0, 5.5], amps: [h * 0.02, h * 0.01] },
    ]
  } else if (maki === 1) {
    // 尖った山が2つ
    layers = [
      { alphas: [0.05 + darkBonus], yBase: h * 0.14, yRange: h * 0.07, freqs: [2.0, 1.0], amps: [h * 0.07, h * 0.05] },
      { alphas: [0.09 + darkBonus], yBase: h * 0.20, yRange: h * 0.05, freqs: [2.0, 4.2], amps: [h * 0.06, h * 0.02] },
      { alphas: [0.14 + darkBonus], yBase: h * 0.27, yRange: h * 0.03, freqs: [4.0, 6.0], amps: [h * 0.025, h * 0.01] },
    ]
  } else if (maki === 2) {
    // 高い霞と遠くの鳥
    layers = [
      { alphas: [0.05 + darkBonus], yBase: h * 0.10, yRange: h * 0.09, freqs: [1.2, 2.5], amps: [h * 0.08, h * 0.04] },
      { alphas: [0.09 + darkBonus], yBase: h * 0.18, yRange: h * 0.06, freqs: [2.2, 4.0], amps: [h * 0.05, h * 0.02] },
      { alphas: [0.14 + darkBonus], yBase: h * 0.27, yRange: h * 0.04, freqs: [3.5, 6.0], amps: [h * 0.02, h * 0.01] },
    ]
  } else {
    // 百鬼繚乱（maki>=3）
    layers = [
      { alphas: [0.09 + darkBonus], yBase: h * 0.12, yRange: h * 0.08, freqs: [1.5, 3.0], amps: [h * 0.07, h * 0.04] },
      { alphas: [0.13 + darkBonus], yBase: h * 0.20, yRange: h * 0.06, freqs: [2.5, 5.0], amps: [h * 0.05, h * 0.025] },
      { alphas: [0.18 + darkBonus], yBase: h * 0.28, yRange: h * 0.04, freqs: [4.0, 7.0], amps: [h * 0.02, h * 0.01] },
    ]
  }

  const seed = maki * 3.7

  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li]
    const ridge = buildRidgeLine(seed + li * 2.1, layer.yBase, layer.freqs, layer.amps)

    // シルエット塗り（余白を守る：稜線から下へ h*0.12 で透明にフェード。
    // y > h*0.40 には一切墨を置かない）
    const alpha = layer.alphas[0]
    let ridgeMaxY = 0
    for (const rp of ridge) ridgeMaxY = Math.max(ridgeMaxY, rp.y)
    const fadeBottom = Math.min(ridgeMaxY + h * 0.12, h * 0.40)
    const fillGrad = ctx.createLinearGradient(0, ridgeMaxY, 0, fadeBottom)
    fillGrad.addColorStop(0, `rgba(47,42,38,${alpha.toFixed(3)})`)
    fillGrad.addColorStop(1, 'rgba(47,42,38,0)')
    ctx.save()
    ctx.fillStyle = fillGrad
    ctx.beginPath()
    ctx.moveTo(0, fadeBottom)
    ctx.lineTo(ridge[0].x, ridge[0].y)
    for (let i = 1; i < ridge.length; i++) {
      const prev = ridge[i - 1]
      const curr = ridge[i]
      const mx = (prev.x + curr.x) / 2
      const my = (prev.y + curr.y) / 2
      ctx.quadraticCurveTo(prev.x, prev.y, mx, my)
    }
    const last = ridge[ridge.length - 1]
    ctx.lineTo(last.x, last.y)
    ctx.lineTo(w, fadeBottom)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // 層と層の間の霞の帯（最終層以外）
    if (li < layers.length - 1) {
      const nextLayer = layers[li + 1]
      const hazeyTop = layer.yBase - layer.yRange
      const hazeyBot = nextLayer.yBase + nextLayer.yRange
      const hazeGrad = ctx.createLinearGradient(0, hazeyTop, 0, hazeyBot)
      hazeGrad.addColorStop(0, 'rgba(242,234,216,0)')
      hazeGrad.addColorStop(0.4, 'rgba(242,234,216,0.5)')
      hazeGrad.addColorStop(1, 'rgba(242,234,216,0)')
      ctx.fillStyle = hazeGrad
      ctx.fillRect(0, hazeyTop, w, hazeyBot - hazeyTop)
    }
  }

  // maki===2: 鳥を数羽（「く」の字の筆線）
  if (maki === 2) {
    ctx.save()
    ctx.strokeStyle = 'rgba(47,42,38,0.18)'
    ctx.lineWidth = 1.2
    ctx.lineCap = 'round'
    const birdPositions = [
      { x: w * 0.62, y: h * 0.09 },
      { x: w * 0.70, y: h * 0.07 },
      { x: w * 0.78, y: h * 0.085 },
      { x: w * 0.67, y: h * 0.12 },
      { x: w * 0.55, y: h * 0.11 },
    ]
    for (const bp of birdPositions) {
      const size = 4 + Math.random() * 3
      ctx.beginPath()
      ctx.moveTo(bp.x - size, bp.y)
      ctx.quadraticCurveTo(bp.x, bp.y - size * 0.6, bp.x + size, bp.y)
      ctx.stroke()
    }
    ctx.restore()
  }

  // maki>=3: 右上に淡墨の満月（帯内に収まるよう半径をクランプ）
  if (maki >= 3) {
    const mx = w * 0.82
    const my = h * 0.10
    const mr = Math.min(w * 0.09, h * 0.26)
    // 月の本体
    const moonGrad = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr)
    moonGrad.addColorStop(0, 'rgba(47,42,38,0.08)')
    moonGrad.addColorStop(0.75, 'rgba(47,42,38,0.08)')
    moonGrad.addColorStop(1, 'rgba(47,42,38,0.14)')
    ctx.save()
    ctx.beginPath()
    ctx.arc(mx, my, mr, 0, Math.PI * 2)
    ctx.fillStyle = moonGrad
    ctx.fill()
    ctx.restore()
  }

  return c
}

// ── 3. 飛沫・染み ──────────────────────────────────────────────────
type Splat = {
  x: number
  y: number
  vx: number
  vy: number
  rx: number
  ry: number
  ang: number
  life: number
  maxLife: number
  stain: boolean // true=染みに変換済み
}

type Stain = {
  x: number
  y: number
  rx: number
  ry: number
  ang: number
  age: number   // 0→8 (秒)
}

const STAIN_FADE = 8    // 秒でフェードアウト
const STAIN_MAX = 40   // 最大染み数

export class Splats {
  private splats: Splat[] = []
  private stains: Stain[] = []

  /**
   * dir 方向（±0.6rad のばらつき）に飛沫を8〜14個飛ばす。
   */
  burst(x: number, y: number, dir: number) {
    const count = 8 + Math.floor(Math.random() * 7)
    for (let i = 0; i < count; i++) {
      const ang = dir + (Math.random() - 0.5) * 1.2
      const spd = 60 + Math.random() * 120
      const rx = 2 + Math.random() * 5
      const ry = 1.5 + Math.random() * 4
      this.splats.push({
        x,
        y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        rx,
        ry,
        ang,
        life: 0.5,
        maxLife: 0.5,
        stain: false,
      })
    }
  }

  update(dt: number) {
    const gravity = 80

    for (const s of this.splats) {
      if (s.stain) continue
      s.x += s.vx * dt
      s.y += s.vy * dt
      s.vy += gravity * dt
      s.life -= dt
      if (s.life <= 0) {
        s.stain = true
        this._addStain(s.x, s.y, s.rx, s.ry, s.ang)
      }
    }
    this.splats = this.splats.filter((s) => !s.stain)

    for (const st of this.stains) st.age += dt
    this.stains = this.stains.filter((st) => st.age < STAIN_FADE)
  }

  private _addStain(x: number, y: number, rx: number, ry: number, ang: number) {
    if (this.stains.length >= STAIN_MAX) this.stains.shift()
    this.stains.push({
      x,
      y,
      rx: clamp(rx, 1.5, 5),
      ry: clamp(ry * 0.6, 1, 3.5),
      ang,
      age: 0,
    })
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = SUMI

    // 飛沫（楕円）
    for (const s of this.splats) {
      const progress = 1 - s.life / s.maxLife
      const alpha = lerp(0.75, 0, progress)
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.translate(s.x, s.y)
      ctx.rotate(s.ang)
      ctx.beginPath()
      ctx.ellipse(0, 0, s.rx, s.ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    // 染み（フェードアウト・薄く小さく）
    for (const st of this.stains) {
      const alpha = clamp(0.055 * (1 - st.age / STAIN_FADE), 0, 0.055)
      if (alpha < 0.005) continue
      ctx.save()
      ctx.globalAlpha = alpha
      ctx.fillStyle = SUMI
      ctx.translate(st.x, st.y)
      ctx.rotate(st.ang)
      ctx.beginPath()
      ctx.ellipse(0, 0, st.rx, st.ry, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }

    ctx.globalAlpha = 1
  }
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}
