// 駒テクスチャ供給。生成アセット（assets/sprites）優先、無ければプレースホルダー（Graphics）。
import { Assets, Container, Graphics, RenderTexture, Renderer, Texture } from 'pixi.js'
import type { Piece } from '../core/types'

// 生成アセット AD v3（user_v3 モック参照・256px透過）。vite が URL 解決する
// 色スロット: 0=鉱石(黄) 1=葉(緑) 2=結晶(青) 3=花(紫) 4=キノコ(赤)
const SPRITE_URLS: Record<string, URL> = {
  // ローグ4系統（ROGUE.md §2）: 0=ギア 1=葉(植物) 2=結晶(鉱物) 3=遺物 4=キノコ(植物)
  n0: new URL('../../assets/sprites3/p0_gear.png', import.meta.url),
  n1: new URL('../../assets/sprites3/p1_leaf.png', import.meta.url),
  n2: new URL('../../assets/sprites3/p2_crystal.png', import.meta.url),
  n3: new URL('../../assets/sprites3/p3_relic.png', import.meta.url),
  n4: new URL('../../assets/sprites3/p4_mushroom.png', import.meta.url),
  harpoon: new URL('../../assets/sprites3/s_wrench.png', import.meta.url),
  hamushi: new URL('../../assets/sprites3/s_compass.png', import.meta.url),
  hitsubo: new URL('../../assets/sprites3/s_gearbomb.png', import.meta.url),
  seiju: new URL('../../assets/sprites3/s_lantern.png', import.meta.url),
  spore: new URL('../../assets/sprites3/s_spore.png', import.meta.url),
  kokeishi: new URL('../../assets/sprites3/o_stone.png', import.meta.url),
  kokeishi_cracked: new URL('../../assets/sprites3/o_stone_cracked.png', import.meta.url),
  hako: new URL('../../assets/sprites3/o_crate.png', import.meta.url),
  hako_broken: new URL('../../assets/sprites3/o_crate_broken.png', import.meta.url),
  subi_open: new URL('../../assets/sprites3/o_subi_open.png', import.meta.url),
  touhen: new URL('../../assets/sprites3/o_touhen.png', import.meta.url),
  subi: new URL('../../assets/sprites3/o_subi.png', import.meta.url),
  // 敵アート（ROGUE2.md 第3波：サンドバッグ敵＝小型胞子虫）
  e_swarm: new URL('../../assets/sprites3/e_swarm.png', import.meta.url),
  e_swarm_angry: new URL('../../assets/sprites3/e_swarm_angry.png', import.meta.url),
  e_swarm_dead: new URL('../../assets/sprites3/e_swarm_dead.png', import.meta.url),
  e_swarm_spore: new URL('../../assets/sprites3/e_swarm_spore.png', import.meta.url),
  ground_thick: new URL('../../assets/sprites3/ground_thick.png', import.meta.url),
  ground_thin: new URL('../../assets/sprites3/ground_thin.png', import.meta.url),
  moss_icon: new URL('../../assets/sprites3/moss_icon.png', import.meta.url),
  // 盤素材（暖色石タイル4バリアント＋苔石フレーム）
  tile: new URL('../../assets/board/tile2_0.png', import.meta.url),
  tile_1: new URL('../../assets/board/tile2_1.png', import.meta.url),
  tile_2: new URL('../../assets/board/tile2_2.png', import.meta.url),
  tile_3: new URL('../../assets/board/tile2_3.png', import.meta.url),
  frame: new URL('../../assets/board/board_frame2.png', import.meta.url),
  // UI部材（ui_kit3切り出し。ラベルは焼き込み）
  ui_ribbon: new URL('../../assets/ui/ribbon.png', import.meta.url),
  ui_medal: new URL('../../assets/ui/booster_socket.png', import.meta.url),
  ui_gear: new URL('../../assets/ui/gear2.png', import.meta.url),
  ui_back: new URL('../../assets/ui/back2.png', import.meta.url),
  ui_parchment: new URL('../../assets/ui/parchment.png', import.meta.url),
  ui_panel: new URL('../../assets/ui/clear_panel.png', import.meta.url), // クリア画面用・四辺完全な縦2:3パネル
  // ドラフトカード（四辺完全・上部に見出し帯。帯の下端は高さの約24%＝実測107/450）
  ui_card: new URL('../../assets/ui/draft_card.png', import.meta.url),
  // ランHUD v5（codex_consult_ui.md [A][B]）。油槽ゲージは内側が透過で、油量はコード描画する。
  // 実測: 640x196 / 内側チャンネル x=0.1750〜0.9375, y=0.4949〜0.8214（この比率で塗る）
  ui_oil: new URL('../../assets/ui/hud_oil.png', import.meta.url),
  ui_depth: new URL('../../assets/ui/hud_depth.png', import.meta.url),
  ui_menu: new URL('../../assets/ui/hud_menu.png', import.meta.url),
  ui_chip: new URL('../../assets/ui/hud_chip.png', import.meta.url),
  // ブースター4種（モック準拠・盤内特殊駒とは別アセット）
  bst_pickaxe: new URL('../../assets/ui/bst_pickaxe.png', import.meta.url),
  bst_lantern: new URL('../../assets/ui/bst_lantern.png', import.meta.url),
  bst_mushroom: new URL('../../assets/ui/bst_mushroom.png', import.meta.url),
  bst_potion: new URL('../../assets/ui/bst_potion.png', import.meta.url),
  // 文字焼き込み部材（ラベルはコード描画せずこちらを使う）
  ui_button_next: new URL('../../assets/ui/button_next2.png', import.meta.url),
  ui_coin: new URL('../../assets/ui/coin.png', import.meta.url),
  ui_star_gold: new URL('../../assets/ui/star_gold.png', import.meta.url),
  ui_star_empty: new URL('../../assets/ui/star_empty.png', import.meta.url),
  ui_word_hiscore: new URL('../../assets/ui/word_hiscore.png', import.meta.url),
  // クリア画面テーマ別（バナー文言・つぎへ。正本③準拠）
  ribbon_forest: new URL('../../assets/ui/ribbon_forest.png', import.meta.url),
  ribbon_machine: new URL('../../assets/ui/ribbon_machine.png', import.meta.url),
  ribbon_crystal: new URL('../../assets/ui/ribbon_crystal.png', import.meta.url),
  next_forest: new URL('../../assets/ui/next_forest.png', import.meta.url),
  next_machine: new URL('../../assets/ui/next_machine.png', import.meta.url),
  next_crystal: new URL('../../assets/ui/next_crystal.png', import.meta.url),
  map_bg: new URL('../../assets/bg/map_bg.png', import.meta.url),
  map_node: new URL('../../assets/ui/map_node2.png', import.meta.url),
  map_node_gold: new URL('../../assets/ui/map_node_gold2.png', import.meta.url),
  map_stararc: new URL('../../assets/ui/map_stararc.png', import.meta.url),
  map_avatar: new URL('../../assets/ui/map_avatar.png', import.meta.url),
  // 探窟家バスト（盤上に覗く。層テーマで交代。v2=モック5人組の忠実コピー）
  bust_forest: new URL('../../assets/ui/bust2_forest.png', import.meta.url),
  bust_machine: new URL('../../assets/ui/bust2_machine.png', import.meta.url),
  bust_crystal: new URL('../../assets/ui/bust2_crystal.png', import.meta.url),
  mascot: new URL('../../assets/ui/mascot_moff.png', import.meta.url),
  ui_ribbon_clear: new URL('../../assets/ui/ribbon_clear.png', import.meta.url),
  ui_banner_word: new URL('../../assets/ui/banner_toha.png', import.meta.url), // 「深界踏破！」（本人選定 2026-08-12）
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

/**
 * 深度バッジ。素材は内容ベースで切り直したため単体アイコン1枚になっている
 * （旧版は横長ゲージが隣セルへはみ出したまま切っていたため2アイコン混在だった）。
 */
export function depthBadgeTexture(): Texture | null {
  return loaded.get('ui_depth') ?? null
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
