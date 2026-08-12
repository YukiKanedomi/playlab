// 駒テクスチャ供給。生成アセット（assets/sprites）優先、無ければプレースホルダー（Graphics）。
import { Assets, Container, Graphics, RenderTexture, Renderer, Texture } from 'pixi.js'
import type { Piece } from '../core/types'

// 生成アセット AD v2（user_master 参照・256px透過）。vite が URL 解決する
// 色スロット: 0=鉱石(黄) 1=葉(緑) 2=結晶(青) 3=花(紫) 4=キノコ(赤)
const SPRITE_URLS: Record<string, URL> = {
  n0: new URL('../../assets/sprites2/p0_ore.png', import.meta.url),
  n1: new URL('../../assets/sprites2/p1_leaf.png', import.meta.url),
  n2: new URL('../../assets/sprites2/p2_crystal.png', import.meta.url),
  n3: new URL('../../assets/sprites2/p3_flower.png', import.meta.url),
  n4: new URL('../../assets/sprites2/p4_mushroom.png', import.meta.url),
  harpoon: new URL('../../assets/sprites2/s_wrench.png', import.meta.url),
  hamushi: new URL('../../assets/sprites2/s_compass.png', import.meta.url),
  hitsubo: new URL('../../assets/sprites2/s_gearbomb.png', import.meta.url),
  seiju: new URL('../../assets/sprites2/s_lantern.png', import.meta.url),
  spore: new URL('../../assets/sprites2/s_spore.png', import.meta.url),
  kokeishi: new URL('../../assets/sprites2/o_stone.png', import.meta.url),
  hako: new URL('../../assets/sprites2/o_crate.png', import.meta.url),
  // 層テーマ背景（Lv1-10 森 / 11-20 機械遺跡 / 21-30 結晶洞窟）
  bg_forest: new URL('../../assets/bg/bg_forest.png', import.meta.url),
  bg_machine: new URL('../../assets/bg/bg_machine.png', import.meta.url),
  bg_crystal: new URL('../../assets/bg/bg_crystal.png', import.meta.url),
}

/** レベルIDから層テーマ名 */
export function themeForLevel(id: number): 'forest' | 'machine' | 'crystal' {
  return id <= 10 ? 'forest' : id <= 20 ? 'machine' : 'crystal'
}

const loaded = new Map<string, Texture>()

/** 起動時に一括ロード。失敗した分はプレースホルダーにフォールバック */
export async function loadSprites(): Promise<void> {
  await Promise.all(
    Object.entries(SPRITE_URLS).map(async ([k, u]) => {
      try {
        loaded.set(k, await Assets.load<Texture>(u.href))
      } catch {
        /* fallback へ */
      }
    }),
  )
}

export function spriteTexture(key: string): Texture | null {
  return loaded.get(key) ?? null
}

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

/** サイズ S のセルに合わせた駒テクスチャ。生成アセット優先・無ければ Graphics 描き */
export function pieceTexture(renderer: Renderer, p: Piece, S: number): Texture {
  // 生成アセット（銛は縦画像を横向きに回すのでキーは共通）
  const assetKey = p.kind === 'normal' ? `n${p.color}` : p.kind
  const asset = loaded.get(assetKey)
  if (asset) return asset
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
