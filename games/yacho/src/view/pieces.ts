// プレースホルダー駒テクスチャ（Graphics 描き）。
// アセット差し替え時はここを Assets.load に置き換えるだけにする（ART.md §6）。
import { Container, Graphics, RenderTexture, Renderer } from 'pixi.js'
import type { Piece } from '../core/types'

// ART.md §2 パレット
export const PAL = {
  amber: 0xe8b33c,
  jade: 0x8fb05a,
  sky: 0x6fb6e8,
  violet: 0x8b6fc8,
  coral: 0xe0785a,
  boardBg: 0x16283b,
  cellA: 0x1d3349,
  cellB: 0x1a2e42,
  paper: 0xe8d9b0,
  brass: 0xd9a441,
  stone: 0x8b8f86,
  stoneDark: 0x6f7369,
  wood: 0xa8845c,
  glowSpore: 0xbfe8ff,
} as const

export const COLOR_HEX = [PAL.amber, PAL.jade, PAL.sky, PAL.violet, PAL.coral]

const cache = new Map<string, RenderTexture>()

export function pieceKey(p: Piece): string {
  if (p.kind === 'normal') return `n${p.color}`
  if (p.kind === 'harpoon') return `harpoon-${p.dir}`
  return p.kind
}

/** サイズ S のセルに合わせた駒テクスチャを生成（キャッシュ） */
export function pieceTexture(renderer: Renderer, p: Piece, S: number): RenderTexture {
  const key = `${pieceKey(p)}@${S}`
  const hit = cache.get(key)
  if (hit) return hit
  const g = new Graphics()
  const r = S * 0.36
  const cx = S / 2
  const cy = S / 2
  const outline = 0x223140
  if (p.kind === 'normal') {
    const col = COLOR_HEX[p.color]
    switch (p.color) {
      case 0: // 陽盤: スポーク付き円盤
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2
          g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r * 1.18, cy + Math.sin(a) * r * 1.18)
        }
        g.stroke({ width: S * 0.06, color: col })
        g.circle(cx, cy, r).fill(col).stroke({ width: S * 0.045, color: outline })
        g.circle(cx, cy, r * 0.45).fill(0xf7df9a)
        break
      case 1: // 芽石: 縦長の莢＋双葉
        g.ellipse(cx, cy + r * 0.15, r * 0.72, r * 0.95).fill(col).stroke({ width: S * 0.045, color: outline })
        g.ellipse(cx - r * 0.42, cy - r * 0.75, r * 0.4, r * 0.24).fill(0xb9d489)
        g.ellipse(cx + r * 0.42, cy - r * 0.75, r * 0.4, r * 0.24).fill(0xb9d489)
        break
      case 2: // 雫瓶: 雫型
        g.moveTo(cx, cy - r * 1.1)
        g.bezierCurveTo(cx + r * 0.95, cy - r * 0.1, cx + r * 0.8, cy + r * 0.9, cx, cy + r * 0.9)
        g.bezierCurveTo(cx - r * 0.8, cy + r * 0.9, cx - r * 0.95, cy - r * 0.1, cx, cy - r * 1.1)
        g.fill(col).stroke({ width: S * 0.045, color: outline })
        g.circle(cx - r * 0.25, cy + r * 0.05, r * 0.22).fill(0xcfe8f7)
        break
      case 3: // 月角: 三日月
        g.circle(cx, cy, r).fill(col)
        g.circle(cx + r * 0.5, cy - r * 0.25, r * 0.82).fill(PAL.boardBg)
        g.circle(cx, cy, r).stroke({ width: S * 0.045, color: outline })
        break
      case 4: // 花石: 花弁
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2
          g.ellipse(cx + Math.cos(a) * r * 0.62, cy + Math.sin(a) * r * 0.62, r * 0.42, r * 0.3).fill(col)
        }
        g.circle(cx, cy, r * 0.42).fill(0xf2b28e).stroke({ width: S * 0.04, color: outline })
        break
    }
  } else if (p.kind === 'harpoon') {
    // 銛: 真鍮の矢
    const w = r * 0.34
    if (p.dir === 'h') {
      g.roundRect(cx - r, cy - w, r * 2, w * 2, w).fill(PAL.brass).stroke({ width: S * 0.04, color: outline })
      g.moveTo(cx + r * 1.15, cy).lineTo(cx + r * 0.45, cy - r * 0.5).lineTo(cx + r * 0.45, cy + r * 0.5).closePath().fill(PAL.brass)
    } else {
      g.roundRect(cx - w, cy - r, w * 2, r * 2, w).fill(PAL.brass).stroke({ width: S * 0.04, color: outline })
      g.moveTo(cx, cy - r * 1.15).lineTo(cx - r * 0.5, cy - r * 0.45).lineTo(cx + r * 0.5, cy - r * 0.45).closePath().fill(PAL.brass)
    }
    g.circle(cx, cy, r * 0.3).fill(0xf1d189)
  } else if (p.kind === 'hamushi') {
    // 羽虫: 玉＋4枚羽
    for (const sx of [-1, 1])
      for (const sy of [-1, 1]) g.ellipse(cx + sx * r * 0.62, cy + sy * r * 0.45, r * 0.5, r * 0.3).fill(0xd8e6ce)
    g.circle(cx, cy, r * 0.55).fill(0x9db87a).stroke({ width: S * 0.045, color: outline })
    g.circle(cx - r * 0.15, cy - r * 0.15, r * 0.14).fill(0xf2f7ea)
  } else if (p.kind === 'hitsubo') {
    // 火壺: 陶の壺＋導火線
    g.ellipse(cx, cy + r * 0.15, r * 0.85, r * 0.75).fill(0x7d4f3a).stroke({ width: S * 0.045, color: outline })
    g.roundRect(cx - r * 0.3, cy - r * 0.85, r * 0.6, r * 0.4, r * 0.1).fill(0x9c6a4d)
    g.moveTo(cx, cy - r * 0.85).quadraticCurveTo(cx + r * 0.5, cy - r * 1.25, cx + r * 0.7, cy - r * 1.0)
    g.stroke({ width: S * 0.05, color: 0xc9b28a })
    g.circle(cx + r * 0.74, cy - r * 0.98, r * 0.14).fill(0xffb347)
  } else if (p.kind === 'seiju') {
    // 星珠: プリズム珠
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8
      g.moveTo(cx, cy).lineTo(cx + Math.cos(a) * r * 1.2, cy + Math.sin(a) * r * 1.2)
    }
    g.stroke({ width: S * 0.05, color: 0xd8c8f0 })
    g.circle(cx, cy, r * 0.75).fill(0xead9f7).stroke({ width: S * 0.045, color: outline })
    g.circle(cx - r * 0.2, cy - r * 0.2, r * 0.28).fill(0xffffff)
  } else if (p.kind === 'spore') {
    // 光胞子: ふわふわの光
    g.circle(cx, cy, r * 0.62).fill({ color: PAL.glowSpore, alpha: 0.55 })
    g.circle(cx, cy, r * 0.38).fill(0xeaf7ff)
  }
  const tex = RenderTexture.create({ width: S, height: S, resolution: 2 })
  const c = new Container()
  c.addChild(g)
  renderer.render({ container: c, target: tex })
  c.destroy({ children: true })
  cache.set(key, tex)
  return tex
}
