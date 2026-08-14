// 盤面ビュー：エンジンのイベント列をタイムライン化して描く。
// 方針: ロジックは即時確定・ビューが追いかける。入力割込時は snap で追いつく。
// タイミングは RESEARCH.md §5 実測値。
import { Container, Graphics, Point, Sprite, Renderer, Text } from 'pixi.js'
import { Board, W, H } from '../core/board'
import type { BoardEvent, EnemyKind, GoalType, Piece, XY } from '../core/types'
import { BOSS_SHELL_COUNT, enemyIntent, type EnemyInstance, type EnemyIntent, type IntentKind } from '../core/enemies'
import { UPGRADES } from '../core/upgrades'
import { PAL, pieceKey, pieceTexture, spriteTexture } from './pieces'
import { completeChannel, delay, easeInCubic, easeInQuad, easeOutBack, easeOutBackSoft, easeOutCubic, tween } from '../juice/tween'
import { sfx } from '../juice/sound'
import { buzz, resetMoveBudget } from '../juice/haptics'

// ローグ拡張（ROGUE.md §5）：ダメージ数字は既存UI（main.ts）と合わせ明朝体
const FONT = '"Shippori Mincho", serif'
// 敵ブロック・ボスの顔に HP バーの描画位置を焼き込むための拡張タグ（pieces.ts の __base 流儀に倣う）
type HpHost = Container & { __hpFill?: Graphics; __hpGeom?: { x: number; y: number; w: number; h: number } }
/** ボスの顔オーバーレイ。身体セル範囲＋段階を焼き込み、変化したら作り直す判定に使う */
type BossFaceHost = Container & { __bossSpan?: string }

// 可視化第一波②：強化発動アピールのラベルに使う名前引き（idはupgrades.tsのUpgradeDef.idと一致）
const UPGRADE_NAME = new Map(UPGRADES.map((u) => [u.id, u.name]))

// 可視化第二波：特殊駒「誕生イベント」の系統色＋回転量（codex_consult [D]-1）。星珠は虹色のためcolorは代表色のみ
const SPECIAL_BORN_STYLE: Record<string, { color: number; rotDeg: number }> = {
  harpoon: { color: 0xfff1c4, rotDeg: 10 },
  hamushi: { color: 0x9fd9ff, rotDeg: 15 },
  hitsubo: { color: 0xffc978, rotDeg: 8 },
  seiju: { color: 0xd7b5ec, rotDeg: 12 },
  default: { color: 0xf4ead0, rotDeg: 10 },
}

// 目標の種類ごとに「壊れて見える瞬間」までのオフセット(ms)と破片色（GoalType を増やしたら両テーブルに行を足すこと）
const GOAL_FX_DELAY: Record<GoalType, number> = { color: 90, system: 90, tsutagoke: 120, kokeishi: 120, touhen: 120, spore: 220, 'enemy-kill': 0 }
const GOAL_DEBRIS_COLOR: Record<GoalType, number> = {
  color: 0xf0e2bd, system: 0x8fb05a, tsutagoke: 0x8fb05a, kokeishi: PAL.stone, touhen: 0xe8e2d2, spore: 0xbfe8ff, 'enemy-kill': 0xe0a89c,
}
// toGlobal の出力先を使い回す（毎フレーム Point を作らない）
const GOAL_PT = new Point()

// juice 実測値テーブル（ms）
export const T = {
  swap: 150, // 成立スワップ（easeOutBackSoft で約5%行き過ぎて戻る）
  swapBack: 120, // 不成立スワップの片道（往復240ms）
  pop: 200, // 消滅ポップ 170-230
  blockHit: 300, // 箱破壊 270-330
  fall: 380, // 落下 330-430
  chainBeat: 650, // 連鎖ビート 600-800（互換保持。実際の連鎖テンポは chainBeatFor() の加速カーブを使う）
  specialBorn: 240,
} as const

/** 演出パス「Reaction Director」：連鎖段ごとの開始間隔（codex_consult [D]-3）。10連鎖以降は220msで下げ止め */
function chainBeatFor(chain: number): number {
  if (chain <= 1) return 520
  if (chain === 2) return 470
  if (chain === 3) return 410
  if (chain === 4) return 350
  if (chain < 10) return 300
  return 220
}

/** 600ms窓で最大80msに制限するヒットストップの累積予算（play()呼び出しごとにリセット） */
class HitstopBudget {
  private log: { t: number; ms: number }[] = []
  /** 現在時刻tにdesiredMsぶんのヒットストップを申請し、実際に許可された量を返す */
  request(t: number, desiredMs: number): number {
    while (this.log.length && t - this.log[0].t > 600) this.log.shift()
    const used = this.log.reduce((a, h) => a + h.ms, 0)
    const applied = Math.max(0, Math.min(desiredMs, 80 - used))
    if (applied > 0) this.log.push({ t, ms: applied })
    return applied
  }
}

/** 演出用の決定的乱数（QA比較の安定のため Math.random() を使わない。1手ごとに新しいseedを切る） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0 || 1
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export class BoardView {
  root = new Container()
  cellLayer = new Container()
  groundLayer = new Container()
  blockLayer = new Container()
  underFxLayer = new Container() // 影・予兆・亀裂（駒の下）
  pieceLayer = new Container()
  overFxLayer = new Container() // 閃光・破片・衝撃波（駒の上）
  uiFxLayer = new Container() // 連鎖数・強化名・ダメージ数字・ツールチップ・インテントバッジ（最前面）
  fxLayer: Container // 既存呼び出しの後方互換エイリアス（= overFxLayer）
  S: number
  /** 盤面フレーム素材がタイル格子より外へ張り出す量(px)。HUD側が盤の実占有域を知るために公開する（枠無しなら0） */
  framePad = 0
  sprites = new Map<string, Sprite>() // "x,y" -> 駒スプライト
  blockG = new Map<string, Container>()
  groundG = new Map<string, Container>()
  busyUntil = 0 // タイムライン終端（ms, performance.now 基準）
  private drainCount = 0 // 勝利ドレインSEのピッチ段数
  private epoch = 0 // レベル遷移の世代。跨いだ遅延コールバックは無効化する

  // ---- ローグライク拡張（ROGUE.md §5）：敵・環境オーバーレイの帳簿 ----
  private armorG = new Map<string, Graphics>() // "x,y" -> 甲殻オーバーレイ
  private preyG = new Map<string, Graphics>() // "x,y" -> 捕食印オーバーレイ
  private fissureG = new Map<number, Graphics>() // enemyId -> 崩落予告の2x2枠
  private sporeTokenG = new Map<string, Container>() // "x,y" -> 胞子トークン（既存 spore 駒とは別物）
  private bossRowG = new Map<number, Container>() // row(y) -> ボス身体1行ぶんの連結コンテナ
  private bossFaceG = new Map<number, Container>() // enemyId -> ボスの目+HPバー（前線行に追従）
  private bossId: number | null = null
  private enemyMeta = new Map<number, { kind: EnemyKind; maxHp: number }>() // 撃破後も参照できるよう種別/最大HPを保持
  private enemyCellsCache = new Map<number, XY[]>() // 直近の敵セル座標（enemy-damage等、座標を持たないイベント用）

  // ---- 可視化第一波：敵インテント・爆発鉱石の常時発光の帳簿 ----
  private intentG = new Map<number, Container>() // enemyId -> インテントバッジ（uiFxLayer・セル内右上）
  private volatileG = new Map<string, Graphics>() // "x,y" -> 爆発鉱石の常時ゆらぎオーバーレイ

  // ---- 可視化第二波：連鎖数の常駐表示（同じコンテナを更新して鼓動させる。毎回新規Textを重ねない） ----
  private chainCounterG: Container | null = null
  private chainCounterText: Text | null = null
  private chainCounterGlow: Graphics | null = null

  // ---- 可視化第二波：Graphicsパーティクルのプール（同時粒子上限を超えたら最古の通常粒子から回収） ----
  private fxPool: Graphics[] = []
  private liveFx: { g: Graphics; priority: 'normal' | 'important' }[] = []
  private rampageActive = false // 10連鎖以降など負荷の高い局面。粒子上限を通常80→暴走時120へ

  // ---- 可視化第二波：演出専用の決定的乱数（1手ごとに再シードしQA比較を安定させる） ----
  private fxSeed = 1
  private fxRand: () => number = Math.random

  /** 所持強化バーへの発動アピール通知（main.ts が購読してアイコンをバウンスさせる。可視化第一波②） */
  /** 強化の発動をHUDへ通知（at＝起点セル。main.ts が強化バーから盤面へ因果パルスを飛ばす） */
  onUpgradeFire?: (id: string, at?: XY) => void
  /** 酸素強奪の通知（main.ts が購読して酸素ゲージへの軌跡＋被弾演出を鳴らす。可視化第二波②） */
  onOxygenDrained?: (enemyId: number, amount: number) => void
  /**
   * 目標達成物の収集（JUICE.md §1②）。BoardView は「どの目標が1つ進んだか」と盤面上の起点（グローバル座標）
   * だけを渡し、HUDへの飛翔・カウンタの跳ねは main.ts が担う（onUpgradeFire / onOxygenDrained と同じ流儀）。
   * flightIndex＝この play() 内で何本目か（0始まり）。main.ts はSEのピッチ段に使う。
   */
  onGoalCollect?: (index: number, done: number, fromGlobal: { x: number; y: number }, flightIndex: number) => void
  /**
   * 敵タップ通知（可視化第一波①〜。共通「野帳シート」統合により、説明表示そのものは main.ts 側の
   * showFieldNote() に一本化した。BoardView は「敵本体／インテントバッジがタップされた」事実だけを渡す）。
   */
  onEnemyTap?: (enemy: EnemyInstance) => void

  constructor(
    public board: Board,
    public renderer: Renderer,
    size: number,
  ) {
    this.S = Math.floor(size / W)
    this.fxLayer = this.overFxLayer
    this.root.addChild(
      this.cellLayer,
      this.groundLayer,
      this.blockLayer,
      this.underFxLayer,
      this.pieceLayer,
      this.overFxLayer,
      this.uiFxLayer,
    )
    this.drawStatic()
    this.syncAll()
  }

  /** 演出用乱数（0〜1）。play()冒頭で1手ごとに再シードする。Math.random() の代替 */
  private rnd(): number {
    return this.fxRand()
  }

  /** プール済みGraphicsを1つ確保して指定レイヤーへ追加。上限超過時は最古の 'normal' 粒子を回収する */
  private acquireG(layer: Container, priority: 'normal' | 'important' = 'normal'): Graphics {
    const cap = this.rampageActive ? 120 : 80
    if (this.liveFx.length >= cap) {
      const idx = this.liveFx.findIndex((f) => f.priority === 'normal')
      if (idx >= 0) this.releaseG(this.liveFx[idx].g)
    }
    const g = this.fxPool.pop() ?? new Graphics()
    g.clear()
    g.alpha = 1
    g.rotation = 0
    g.scale.set(1)
    layer.addChild(g)
    this.liveFx.push({ g, priority })
    return g
  }

  /** プールへ返却（destroyはしない。次のacquireGで再利用） */
  private releaseG(g: Graphics): void {
    if (g.destroyed) return
    const idx = this.liveFx.findIndex((f) => f.g === g)
    if (idx >= 0) this.liveFx.splice(idx, 1)
    g.clear()
    if (g.parent) g.parent.removeChild(g)
    this.fxPool.push(g)
  }

  key(x: number, y: number) {
    return `${x},${y}`
  }
  px(x: number) {
    return x * this.S + this.S / 2
  }

  private drawStatic() {
    const tileTex = spriteTexture('tile')
    const frameTex = spriteTexture('frame')
    if (tileTex) {
      // 生成タイル：暖色石4バリアントを決定的に散らす（AD v3。市松は微ティント）
      const variants = [tileTex, spriteTexture('tile_1') ?? tileTex, spriteTexture('tile_2') ?? tileTex, spriteTexture('tile_3') ?? tileTex]
      const base = new Graphics()
      base.roundRect(-6, -6, W * this.S + 12, H * this.S + 12, 10).fill({ color: 0x2b2118, alpha: 0.85 })
      this.cellLayer.addChild(base)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (!this.board.at(x, y)) continue
          const sp = new Sprite(variants[(x * 7 + y * 13 + ((x * x + y) >> 1)) % 4])
          sp.width = this.S
          sp.height = this.S
          sp.position.set(x * this.S, y * this.S)
          sp.tint = (x + y) % 2 ? 0xffffff : 0xf2ebe0 // 市松は微差に
          this.cellLayer.addChild(sp)
        }
      if (frameTex) {
        // スリム枠（帯内縁がテクスチャ幅の INNER 比率にある前提）を盤外周に重ねる
        const INNER = 0.053 // frame_v4 実測（帯内縁 54/1024）
        const inset = this.S * 0.06 // 外周セルへの食い込みは最小限に
        const gridW = W * this.S
        const gridH = H * this.S
        const pad = (INNER * gridW + inset) / (1 - 2 * INNER)
        const fr = new Sprite(frameTex)
        fr.width = gridW + 2 * pad
        fr.height = gridH + 2 * ((INNER * gridH + inset) / (1 - 2 * INNER))
        fr.position.set(-pad, -(INNER * gridH + inset) / (1 - 2 * INNER))
        this.framePad = (INNER * gridH + inset) / (1 - 2 * INNER)
        this.cellLayer.addChild(fr)
      }
      return
    }
    const g = new Graphics()
    // フォールバック：市松2トーンのコード描き
    g.roundRect(-8, -8, W * this.S + 16, H * this.S + 16, 14).fill(PAL.boardBg)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (!this.board.at(x, y)) continue
        g.roundRect(x * this.S + 1.5, y * this.S + 1.5, this.S - 3, this.S - 3, 6).fill((x + y) % 2 ? PAL.cellA : PAL.cellB)
      }
    this.cellLayer.addChild(g)
  }

  /** 盤の論理状態をそのまま描画に反映（初期化・保険） */
  syncAll() {
    this.epoch++ // 以降、旧世代の遅延コールバックは無効
    for (const s of this.sprites.values()) s.destroy()
    this.sprites.clear()
    // ボス身体の連結コンテナは複数セルから同一参照を共有するため、二重destroyを避けて回る
    for (const g of this.blockG.values()) if (!g.destroyed) g.destroy()
    this.blockG.clear()
    for (const g of this.groundG.values()) g.destroy()
    this.groundG.clear()
    for (const g of this.armorG.values()) if (!g.destroyed) g.destroy()
    this.armorG.clear()
    for (const g of this.preyG.values()) if (!g.destroyed) g.destroy()
    this.preyG.clear()
    for (const g of this.fissureG.values()) if (!g.destroyed) g.destroy()
    this.fissureG.clear()
    for (const g of this.sporeTokenG.values()) if (!g.destroyed) g.destroy()
    this.sporeTokenG.clear()
    for (const g of this.bossFaceG.values()) if (!g.destroyed) g.destroy()
    this.bossFaceG.clear()
    this.bossRowG.clear() // 中身は上のblockGループで既に破棄済み
    this.bossId = null
    this.enemyMeta.clear()
    this.enemyCellsCache.clear()
    for (const g of this.volatileG.values()) if (!g.destroyed) g.destroy()
    this.volatileG.clear()
    if (this.chainCounterG && !this.chainCounterG.destroyed) this.chainCounterG.destroy()
    this.chainCounterG = null
    this.chainCounterText = null
    this.chainCounterGlow = null
    for (const g of this.intentG.values()) if (!g.destroyed) g.destroy()
    this.intentG.clear()
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.board.at(x, y)
        if (!c) continue
        if (c.ground > 0) this.makeGround(x, y, c.ground as 1 | 2)
        if (c.block) this.makeBlock(x, y)
        if (c.piece) this.makePiece(x, y, c.piece)
        if (c.armored) this.makeArmorOverlay(x, y, 0)
        if (c.preyMark) this.makePreyOverlay(x, y, 0)
        if (c.sporeToken) this.makeSporeTokenSprite(x, y, 0)
        if (c.piece?.kind === 'normal' && c.piece.volatile) this.makeVolatileOverlay(x, y)
      }
    // ボスの顔（目+HPバー）は上のループ内 makeBossSegment が前線行の処理時に生成する
    this.updateIntentBadges()
  }

  private makePiece(x: number, y: number, p: Piece): Sprite {
    // 同セルに既存スプライトがいたら破棄（変換・胞子湧き等の上書き生成で孤児を作らない）
    const old = this.sprites.get(this.key(x, y))
    if (old) {
      this.sprites.delete(this.key(x, y))
      old.destroy()
    }
    const sp = new Sprite(pieceTexture(this.renderer, p, this.S))
    sp.anchor.set(0.5)
    // テクスチャ原寸に依らずセル寸法へ正規化（この基準スケールが演出の「1」）
    const target = this.S * (p.kind === 'normal' ? 0.82 : 0.86) // 正本準拠: セルに10〜15%の石地余白
    const base = target / Math.max(sp.texture.width, sp.texture.height)
    sp.scale.set(base)
    ;(sp as unknown as { __base: number }).__base = base
    if (p.kind === 'harpoon' && p.dir === 'h') sp.rotation = Math.PI / 2 // 縦画像を横向きに
    sp.position.set(this.px(x), this.px(y))
    ;(sp as unknown as { __kind: string }).__kind = pieceKey(p)
    this.pieceLayer.addChild(sp)
    this.sprites.set(this.key(x, y), sp)
    return sp
  }

  /** 演出用: スプライトの基準スケール */
  private bs(sp: Sprite): number {
    return (sp as unknown as { __base?: number }).__base ?? 1
  }

  private makeBlock(x: number, y: number) {
    const c = this.board.at(x, y)!
    const b = c.block!
    const S = this.S
    // ローグ拡張（ROGUE.md §5）：敵の身体セル・穴潜みの封鎖セル
    if (b.type === 'enemy') {
      this.makeEnemyBlock(x, y, b.enemyId)
      return
    }
    if (b.type === 'seal') {
      this.makeSealBlock(x, y)
      return
    }
    // 生成アセットがある障害物は Sprite で
    if (b.type === 'kokeishi' || b.type === 'hako' || b.type === 'touhen' || b.type === 'subi') {
      // 苔石は損傷差分アセット優先（半透明化でなく「欠け」で見せる）
      const key = b.type === 'kokeishi' && b.hp === 1 ? (spriteTexture('kokeishi_cracked') ? 'kokeishi_cracked' : 'kokeishi') : b.type
      const tex = spriteTexture(key)
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        const shrink = b.type === 'touhen' ? 0.78 : 1 // 陶片は「中身」なので小さめ
        const base = ((S - 4) * shrink) / Math.max(tex.width, tex.height)
        sp.scale.set(base)
        sp.position.set(this.px(x), this.px(y))
        if (b.type === 'kokeishi' && b.hp === 1 && key === 'kokeishi') {
          sp.alpha = 0.82 // 差分アセット未ロード時のフォールバック
          sp.tint = 0xd8d2c2
        }
        const wrap = new Container()
        wrap.addChild(sp)
        this.blockLayer.addChild(wrap)
        this.blockG.set(this.key(x, y), wrap)
        return
      }
    }
    const g = new Graphics()
    if (b.type === 'kokeishi') {
      g.roundRect(3, 3, S - 6, S - 6, 8).fill(b.hp === 2 ? PAL.stoneDark : PAL.stone)
      g.roundRect(3, 3, S - 6, S - 6, 8).stroke({ width: 2.5, color: 0x4d5147 })
      if (b.hp === 2) g.moveTo(S * 0.25, S * 0.5).lineTo(S * 0.75, S * 0.5).stroke({ width: 2, color: 0x4d5147 })
      g.circle(S * 0.3, S * 0.28, S * 0.09).fill(0x77905c) // 苔
    } else if (b.type === 'hako') {
      g.roundRect(4, 4, S - 8, S - 8, 6).fill(PAL.wood).stroke({ width: 2.5, color: 0x6b5238 })
      g.moveTo(4, S / 2).lineTo(S - 4, S / 2).stroke({ width: 2, color: 0x6b5238 })
    } else if (b.type === 'touhen') {
      g.circle(S / 2, S / 2, S * 0.34).fill(0xe8e2d2).stroke({ width: 2.5, color: 0x9a927e })
      g.circle(S / 2, S / 2, S * 0.2).stroke({ width: 1.5, color: 0x9a927e })
    } else if (b.type === 'subi') {
      g.circle(S / 2, S / 2, S * 0.4).fill(0x54636f).stroke({ width: 2.5, color: 0x39434c })
      g.circle(S / 2, S / 2, S * 0.18).fill(PAL.glowSpore)
    }
    g.position.set(x * this.S, y * this.S)
    this.blockLayer.addChild(g)
    this.blockG.set(this.key(x, y), g)
  }

  // ---- ローグライク拡張（ROGUE.md §5）：敵の描画 ----

  private drawEye(g: Graphics, cx: number, cy: number, r: number, iris: number) {
    g.circle(cx, cy, r * 1.3).fill(0xf6f1e4)
    g.circle(cx, cy, r).fill(iris)
    g.circle(cx, cy, r * 0.42).fill(0x201812)
  }

  /**
   * ボスの核（大きな目）。同心円3つだけだと周囲の描き込まれた駒と画風が断絶するため、
   * 匣タイルの「歯車の輪」意匠を虹彩の外周に重ねて盤面と絵柄を揃える。
   */
  private drawBossEye(g: Graphics, cx: number, cy: number, r: number) {
    g.circle(cx, cy, r * 1.34).fill(0xf6f1e4)
    g.circle(cx, cy, r * 1.34).stroke({ width: Math.max(1, r * 0.12), color: 0x6b5238 })
    g.circle(cx, cy, r).fill(0xe86a4a)
    const teeth = 10
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2 + Math.PI / teeth
      g.moveTo(cx + Math.cos(a) * r * 0.72, cy + Math.sin(a) * r * 0.72).lineTo(cx + Math.cos(a) * r * 1.0, cy + Math.sin(a) * r * 1.0)
    }
    g.stroke({ width: Math.max(1, r * 0.14), color: 0x8c3a24, alpha: 0.95 })
    g.circle(cx, cy, r * 0.64).stroke({ width: Math.max(1, r * 0.1), color: 0xffd7a8, alpha: 0.75 })
    g.circle(cx, cy, r * 0.42).fill(0x201812)
    g.circle(cx - r * 0.17, cy - r * 0.2, r * 0.13).fill({ color: 0xfff6e6, alpha: 0.8 })
  }

  /** 敵の身体セル1つぶんのコンテナに HP バー（背景+塗り）を焼き込む */
  private attachHpBar(wrap: Container, hp: number, maxHp: number, w: number, h: number, x0: number, y0: number) {
    const back = new Graphics()
    back.roundRect(x0, y0, w, h, h / 2).fill({ color: 0x1c1712, alpha: 0.82 })
    wrap.addChild(back)
    const fill = new Graphics()
    wrap.addChild(fill)
    const host = wrap as HpHost
    host.__hpFill = fill
    host.__hpGeom = { x: x0, y: y0, w, h }
    this.paintHpBar(wrap, hp, maxHp)
  }

  /** HP バーの塗りだけ引き直す（enemy-damage・reconcile 双方から呼ぶ） */
  private paintHpBar(wrap: Container, hp: number, maxHp: number) {
    const host = wrap as HpHost
    const fill = host.__hpFill
    const geom = host.__hpGeom
    if (!fill || !geom || fill.destroyed) return
    const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
    fill.clear()
    if (ratio > 0) fill.roundRect(geom.x, geom.y, Math.max(2, geom.w * ratio), geom.h, geom.h / 2).fill(ratio > 0.3 ? 0xc0503a : 0xe0d040)
  }

  /** 単体セルの敵（岩殻獣/胞子獣/穴潜み）を描く。ボスは別経路（makeBossSegment） */
  private makeEnemyBlock(x: number, y: number, enemyId: number) {
    const enemy = this.board.enemies.find((e) => e.id === enemyId)
    if (!enemy) return
    if (enemy.kind === 'boss') {
      this.makeBossSegment(x, y, enemy)
      return
    }
    this.enemyMeta.set(enemy.id, { kind: enemy.kind, maxHp: enemy.maxHp })
    this.enemyCellsCache.set(
      enemy.id,
      enemy.cells.map((p) => ({ ...p })),
    )
    const S = this.S
    const wrap = new Container()
    wrap.position.set(x * S, y * S)
    if (enemy.kind === 'rockshell') {
      const tex = spriteTexture('kokeishi')
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((S - 4) / Math.max(tex.width, tex.height))
        sp.position.set(S / 2, S / 2)
        wrap.addChild(sp)
      } else {
        const g = new Graphics()
        g.roundRect(3, 3, S - 6, S - 6, 8).fill(PAL.stoneDark).stroke({ width: 2.5, color: 0x4d5147 })
        wrap.addChild(g)
      }
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.44, S * 0.15, 0xf0c060) // 一つ目・琥珀
      wrap.addChild(eye)
    } else if (enemy.kind === 'sporeling') {
      const tex = spriteTexture('subi')
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((S - 4) / Math.max(tex.width, tex.height))
        sp.position.set(S / 2, S / 2)
        wrap.addChild(sp)
      } else {
        const g = new Graphics()
        g.circle(S / 2, S / 2, S * 0.4).fill(0x54636f).stroke({ width: 2.5, color: 0x39434c })
        wrap.addChild(g)
      }
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.42, S * 0.14, 0xc9a0e8) // 一つ目・菫
      wrap.addChild(eye)
    } else if (enemy.kind === 'swarm') {
      // 小型胞子虫（ROGUE2.md 第3波）。定期行動を持たない＝怒る局面が無いので通常顔で固定する
      const tex = spriteTexture('e_swarm')
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((S - 6) / Math.max(tex.width, tex.height))
        sp.position.set(S / 2, S / 2)
        wrap.addChild(sp)
      } else {
        const g = new Graphics()
        g.circle(S / 2, S / 2, S * 0.36).fill(0xb9c7c4).stroke({ width: 2.5, color: 0x6e7a76 })
        wrap.addChild(g)
      }
    } else if (enemy.kind === 'burrower') {
      // 裂坑掘り：暗い穴（同心円）＋二つ目
      const g = new Graphics()
      g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0x0b0d10, alpha: 0.92 })
      g.circle(S / 2, S / 2, S * 0.29).fill({ color: 0x1c2128, alpha: 0.92 })
      g.circle(S / 2, S / 2, S * 0.15).fill({ color: 0x2c333b, alpha: 0.85 })
      wrap.addChild(g)
      const eyes = new Graphics()
      this.drawEye(eyes, S / 2 - S * 0.14, S * 0.44, S * 0.09, 0xdff0ff)
      this.drawEye(eyes, S / 2 + S * 0.14, S * 0.44, S * 0.09, 0xdff0ff)
      wrap.addChild(eyes)
    } else if (enemy.kind === 'breathstealer') {
      // 息喰み：吸い込む口＝三重の同心リング（危険色）＋細い一つ目。唯一「酸素を奪う」敵として色相を分ける
      const g = new Graphics()
      g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0x2a1216, alpha: 0.95 })
      g.circle(S / 2, S / 2, S * 0.3).stroke({ width: S * 0.05, color: 0xe0503a, alpha: 0.9 })
      g.circle(S / 2, S / 2, S * 0.16).fill({ color: 0x120a0c, alpha: 0.95 })
      wrap.addChild(g)
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.34, S * 0.1, 0xffd6b0)
      wrap.addChild(eye)
    } else if (enemy.kind === 'binder') {
      // 綴じ蟲：列を綴じる＝縦の綴じ糸。専用アートが来るまでのコード描画（PHASE2.md §5 の納品単位は未達）
      const g = new Graphics()
      g.roundRect(S * 0.18, 3, S * 0.64, S - 6, S * 0.16).fill({ color: 0x1d2a2e, alpha: 0.95 }).stroke({ width: 2.5, color: 0x6d8f96 })
      for (const ty of [0.3, 0.5, 0.7]) g.moveTo(S * 0.24, S * ty).lineTo(S * 0.76, S * ty).stroke({ width: 2, color: 0x9ec8cf, alpha: 0.75 })
      wrap.addChild(g)
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.24, S * 0.1, 0xa8e6ef)
      wrap.addChild(eye)
    } else if (enemy.kind === 'bellfoot') {
      // 鐘脚：釣鐘の胴＋残り殻の枚数だけ外側にリングを重ねる（殻が張り直されると輪が増える）
      const g = new Graphics()
      g.moveTo(S * 0.5, S * 0.16)
        .lineTo(S * 0.82, S * 0.74)
        .lineTo(S * 0.18, S * 0.74)
        .closePath()
        .fill({ color: 0x3a2f1c, alpha: 0.95 })
        .stroke({ width: 2.5, color: 0xb99a52 })
      for (let i = 0; i < enemy.shell; i++)
        g.circle(S / 2, S * 0.52, S * (0.34 + i * 0.06)).stroke({ width: 2, color: 0xe0c070, alpha: 0.7 - i * 0.2 })
      wrap.addChild(g)
      const eye = new Graphics()
      this.drawEye(eye, S / 2, S * 0.56, S * 0.1, 0xffe6a8)
      wrap.addChild(eye)
    } else if (enemy.kind === 'maw') {
      // 奈落の喉：生きものというより地形。牙の並ぶ暗い裂け目
      const g = new Graphics()
      g.roundRect(1, S * 0.18, S - 2, S * 0.72, S * 0.1).fill({ color: 0x08090c, alpha: 0.96 }).stroke({ width: 2.5, color: 0x5a4a6b })
      for (const tx of [0.2, 0.45, 0.7]) g.moveTo(S * tx, S * 0.24).lineTo(S * (tx + 0.12), S * 0.46).lineTo(S * (tx + 0.24), S * 0.24).fill(0xcfc2dd)
      wrap.addChild(g)
    }
    // HP1の小型胞子虫はバーが常に満タンで意味を成さないため出さない（画面のノイズを減らす）。
    // 複数セルの身体（奈落の喉）は先頭セルにだけ出す＝reconcile が更新するのも先頭セルのバーだけ
    const isLeadCell = enemy.cells[0]?.x === x && enemy.cells[0]?.y === y
    if (enemy.maxHp > 1 && isLeadCell) this.attachHpBar(wrap, enemy.hp, enemy.maxHp, S * 0.72, S * 0.1, (S - S * 0.72) / 2, S * 0.06)
    // 可視化第一波①：敵セルのタップで野帳シートを開く（スワップ対象にならないセルなので入力系と衝突しない）
    wrap.eventMode = 'static'
    wrap.cursor = 'pointer'
    wrap.hitArea = { contains: (lx: number, ly: number) => lx >= 0 && lx <= S && ly >= 0 && ly <= S }
    wrap.on('pointertap', (e) => {
      e.stopPropagation()
      this.onEnemyTap?.(enemy)
    })
    this.blockLayer.addChild(wrap)
    this.blockG.set(this.key(x, y), wrap)
  }

  /** ボス身体：1行=1コンテナで hako を連結（ROGUE.md §5） */
  private makeBossSegment(x: number, y: number, enemy: EnemyInstance) {
    this.enemyMeta.set(enemy.id, { kind: 'boss', maxHp: enemy.maxHp })
    this.enemyCellsCache.set(
      enemy.id,
      enemy.cells.map((p) => ({ ...p })),
    )
    this.bossId = enemy.id
    const S = this.S
    let row = this.bossRowG.get(y)
    if (!row || row.destroyed) {
      row = new Container()
      row.position.set(0, y * S)
      this.blockLayer.addChild(row)
      this.bossRowG.set(y, row)
    }
    const seg = new Container()
    seg.position.set(x * S, 0)
    const tex = spriteTexture('hako')
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set((S - 2) / Math.max(tex.width, tex.height))
      sp.position.set(S / 2, S / 2)
      seg.addChild(sp)
    } else {
      const g = new Graphics()
      g.roundRect(1, 1, S - 2, S - 2, 5).fill(PAL.wood).stroke({ width: 2, color: 0x6b5238 })
      seg.addChild(g)
    }
    row.addChild(seg)
    this.blockG.set(this.key(x, y), row)
    if (y === H - 1 && (!this.bossFaceG.get(enemy.id) || this.bossFaceG.get(enemy.id)!.destroyed)) {
      this.makeBossFace(enemy)
    }
  }

  /** ボスの顔（中央の大きい目+HPバー）。前線行に追従する単独オーバーレイ */
  private makeBossFace(boss: EnemyInstance) {
    const old = this.bossFaceG.get(boss.id)
    if (old) {
      this.bossFaceG.delete(boss.id)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    this.bossId = boss.id
    const face = new Container() as BossFaceHost
    face.position.set(0, (H - 1) * S)
    // 顔もゲージも「いま身体が占めているセル範囲」に追従させる。第2段階で中央2セルへ縮んだとき
    // 固定幅(W*S*0.5)のままだと隣の駒の上にバーが残ってしまうため、実寸から毎回導出する。
    const xs = boss.cells.map((c) => c.x)
    const x0c = Math.min(...xs)
    const x1c = Math.max(...xs)
    const span = x1c - x0c + 1
    const cx = (x0c + span / 2) * S
    const w = span * S * 0.86
    const barX = cx - w / 2
    const eye = new Graphics()
    this.drawBossEye(eye, cx, S * 0.56, Math.min(S * 0.32, w * 0.3)) // 上端がゲージ下端(S*0.20)に触れない高さ
    face.addChild(eye)
    // 第1段階は「残りの匣」、第2段階は「核のHP」を同じバーで見せる（意味だけ切り替える）
    const cur = boss.bossPhase === 1 ? boss.bossShellLeft : boss.hp
    const max = boss.bossPhase === 1 ? BOSS_SHELL_COUNT : boss.maxHp
    const barH = S * 0.14
    const barY = S * 0.06
    this.attachHpBar(face, cur, max, w, barH, barX, barY)
    if (boss.bossPhase === 1) {
      // 匣は連続量ではなく「枚数」。刻みを入れて残り枚数がそのまま数えられる形にする
      const notch = new Graphics()
      for (let i = 1; i < BOSS_SHELL_COUNT; i++) {
        const tx = barX + (w * i) / BOSS_SHELL_COUNT
        notch.moveTo(tx, barY).lineTo(tx, barY + barH)
      }
      notch.stroke({ width: Math.max(1, S * 0.022), color: 0x1c1712, alpha: 0.95 })
      face.addChild(notch)
    }
    face.__bossSpan = `${x0c},${x1c},${boss.bossPhase}`
    // 可視化第一波①：ボスの顔もタップで野帳シートを開く
    face.eventMode = 'static'
    face.cursor = 'pointer'
    face.hitArea = { contains: (lx: number, ly: number) => lx >= x0c * S && lx <= (x1c + 1) * S && ly >= 0 && ly <= S }
    face.on('pointertap', (e) => {
      e.stopPropagation()
      this.onEnemyTap?.(boss)
    })
    this.blockLayer.addChild(face)
    this.bossFaceG.set(boss.id, face)
  }

  /** ボスのゲージを引き直す（第1段階＝匣の残り枚数／第2段階＝核HP）。boss-shell-broken と reconcile から呼ぶ */
  private paintBossGauge() {
    if (this.bossId == null) return
    const boss = this.board.enemies.find((e) => e.id === this.bossId)
    if (!boss) return
    const face = this.bossFaceG.get(this.bossId)
    if (!face || face.destroyed) return
    const cur = boss.bossPhase === 1 ? boss.bossShellLeft : boss.hp
    const max = boss.bossPhase === 1 ? BOSS_SHELL_COUNT : boss.maxHp
    this.paintHpBar(face, cur, max)
  }

  /** 裂坑掘りの封鎖セル：暗い蓋＋X字 */
  private makeSealBlock(x: number, y: number): Graphics {
    const S = this.S
    const g = new Graphics()
    g.roundRect(3, 3, S - 6, S - 6, 8).fill({ color: 0x14110f, alpha: 0.78 })
    const pad = S * 0.28
    g.moveTo(pad, pad).lineTo(S - pad, S - pad).stroke({ width: S * 0.06, color: 0x6b5a46 })
    g.moveTo(S - pad, pad).lineTo(pad, S - pad).stroke({ width: S * 0.06, color: 0x6b5a46 })
    g.position.set(x * S, y * S)
    this.blockLayer.addChild(g)
    this.blockG.set(this.key(x, y), g)
    return g
  }

  /** 岩殻獣の甲殻オーバーレイ（1回分の追加破壊を要求。ROGUE.md §5） */
  private makeArmorOverlay(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.armorG.get(k)
    if (old) {
      this.armorG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    const g = new Graphics()
    g.roundRect(4, 4, S - 8, S - 8, 8).stroke({ width: S * 0.07, color: 0x9aa2ac, alpha: 0.9 })
    g.roundRect(4, 4, S - 8, S - 8, 8).fill({ color: 0xc7ccd2, alpha: 0.14 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.armorG.set(k, g)
    tween(g, { alpha: 1 }, 200, { delay: t })
  }

  /** 喰み蟲が捕食印を付けた駒の紫の靄オーバーレイ（ROGUE.md §5） */
  private makePreyOverlay(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.preyG.get(k)
    if (old) {
      this.preyG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    const g = new Graphics()
    g.circle(S / 2, S / 2, S * 0.44).fill({ color: 0x8b5fc8, alpha: 0.26 })
    g.circle(S / 2, S / 2, S * 0.44).stroke({ width: S * 0.035, color: 0xb98be0, alpha: 0.6 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.preyG.set(k, g)
    tween(g, { alpha: 1 }, 200, { delay: t })
  }

  /** 捕食印の靄を片付ける（食べられた／追い払った の両方から呼ぶ） */
  private clearPreyOverlay(p: XY) {
    const k = this.key(p.x, p.y)
    const g = this.preyG.get(k)
    if (!g) return
    this.preyG.delete(k)
    if (!g.destroyed) g.destroy()
  }

  /**
   * 裂坑掘りの崩落予告：2x2を囲む破線枠を1.2秒周期で明滅させる。
   * 駒の下（underFxLayer）に置くので、予告中も中の駒は普通に読める＝「ここを消せば止まる」が伝わる。
   */
  private makeFissureFrame(id: number, cells: XY[], t: number) {
    this.clearFissureFrame(id)
    if (!cells.length) return
    const S = this.S
    const x0 = Math.min(...cells.map((c) => c.x)) * S
    const y0 = Math.min(...cells.map((c) => c.y)) * S
    const w = (Math.max(...cells.map((c) => c.x)) + 1) * S - x0
    const h = (Math.max(...cells.map((c) => c.y)) + 1) * S - y0
    const g = new Graphics()
    const width = S * 0.05
    // pixi に破線は無いので、辺ごとに短い線分を並べて「亀裂の予告線」に見せる
    const dash = (ax: number, ay: number, bx: number, by: number) => {
      const len = Math.hypot(bx - ax, by - ay)
      const n = Math.max(2, Math.round(len / (S * 0.4)))
      const ux = (bx - ax) / len
      const uy = (by - ay) / len
      for (let i = 0; i < n; i++) {
        const s = (len / n) * i
        const e = s + (len / n) * 0.55
        g.moveTo(ax + ux * s, ay + uy * s)
          .lineTo(ax + ux * e, ay + uy * e)
          .stroke({ width, color: 0xcbb28a })
      }
    }
    const pad = width / 2
    dash(x0 + pad, y0 + pad, x0 + w - pad, y0 + pad)
    dash(x0 + w - pad, y0 + pad, x0 + w - pad, y0 + h - pad)
    dash(x0 + w - pad, y0 + h - pad, x0 + pad, y0 + h - pad)
    dash(x0 + pad, y0 + h - pad, x0 + pad, y0 + pad)
    g.alpha = 0
    this.underFxLayer.addChild(g)
    this.fissureG.set(id, g)
    const loop = () => {
      if (g.destroyed || this.fissureG.get(id) !== g) return
      tween(g, { alpha: 0.35 }, 600, {
        onDone: () => {
          if (g.destroyed || this.fissureG.get(id) !== g) return
          tween(g, { alpha: 0.8 }, 600, { onDone: loop })
        },
      })
    }
    tween(g, { alpha: 0.8 }, 220, { delay: t, onDone: loop })
  }

  /** 崩落予告枠を片付ける（中断・実行のどちらでも同じ経路） */
  private clearFissureFrame(id: number) {
    const g = this.fissureG.get(id)
    if (!g) return
    this.fissureG.delete(id)
    if (!g.destroyed) g.destroy()
  }

  /** 胞子トークン（設置型。既存 spore 駒とは別物）。駒の70%サイズで駒レイヤーの上に置く */
  private makeSporeTokenSprite(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.sporeTokenG.get(k)
    if (old) {
      this.sporeTokenG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const tex = spriteTexture('spore')
    const target = this.S * 0.82 * 0.7
    let node: Container
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set(target / Math.max(tex.width, tex.height))
      node = sp
    } else {
      const g = new Graphics()
      g.circle(0, 0, target / 2).fill({ color: PAL.glowSpore, alpha: 0.8 })
      node = g
    }
    node.position.set(this.px(x), this.px(y))
    const baseScale = node.scale.x || 1
    node.scale.set(0)
    this.fxLayer.addChild(node)
    this.sporeTokenG.set(k, node)
    tween(node.scale, { x: baseScale, y: baseScale }, 220, { delay: t, ease: easeOutBack })
  }

  /** コンテナを左右に小さく揺らす（敵被弾・ボス全体攻撃で共用） */
  private shakeContainer(c: Container, t: number, amp = 4) {
    const bx = c.position.x
    const by = c.position.y
    const offs = [amp, -amp, amp * 0.6, -amp * 0.6, 0]
    let d = t
    for (const ox of offs) {
      tween(c.position, { x: bx + ox, y: by }, 45, { delay: d })
      d += 45
    }
  }

  /** 被弾フラッシュ（白い矩形を一瞬重ねてフェード） */
  private hitFlash(container: Container, t: number) {
    const b = container.getLocalBounds()
    const g = new Graphics()
    g.rect(b.x, b.y, b.width, b.height).fill({ color: 0xffffff, alpha: 0.5 })
    container.addChild(g)
    tween(g, { alpha: 0 }, 160, {
      delay: t,
      onDone: () => {
        if (!g.destroyed) g.destroy()
      },
    })
  }

  /** ダメージ数字ポップ（小さな明朝数字、上に浮いて消える） */
  private damageNumberFx(p: XY, amount: number, t: number) {
    delay(t, () => {
      const txt = new Text({
        text: `-${amount}`,
        style: { fill: 0xfff1d0, fontSize: this.S * 0.26, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x3a2418, width: 3 } },
      })
      txt.anchor.set(0.5)
      txt.position.set(this.px(p.x), this.px(p.y) - this.S * 0.1)
      this.uiFxLayer.addChild(txt)
      tween(txt.position, { y: txt.position.y - this.S * 0.6 }, 500, { ease: easeOutCubic })
      tween(txt, { alpha: 0 }, 380, {
        delay: 120,
        onDone: () => {
          if (!txt.destroyed) txt.destroy()
        },
      })
    })
  }

  /** enemy-damage：HPバー更新＋揺れ＋フラッシュ＋ダメージ数字（ROGUE.md §5） */
  private enemyDamageFx(id: number, amount: number, hpLeft: number, t: number) {
    const meta = this.enemyMeta.get(id)
    const cells = this.enemyCellsCache.get(id)
    if (!meta || !cells || !cells.length) return
    const container = meta.kind === 'boss' ? this.bossFaceG.get(id) : this.blockG.get(this.key(cells[0].x, cells[0].y))
    if (container && !container.destroyed) {
      this.paintHpBar(container, hpLeft, meta.maxHp)
      this.shakeContainer(container, t, 3)
      this.hitFlash(container, t)
    }
    const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
    const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
    this.damageNumberFx({ x: cx, y: cy }, amount, t)
  }

  /**
   * enemy-defeated：潰れて消えるポップ＋粒（ボスは行コンテナ＋顔も片付ける）。
   * swarm連鎖のときは撃破地点から隣接個体への衝撃パルス＋予備膨張の「ドミノ」演出を追加する（codex_consult [D]-4）。
   */
  private enemyDefeatedFx(id: number, cells: XY[], t: number, swarm?: { pos: number; total: number; nextCells?: XY[] }) {
    const meta = this.enemyMeta.get(id)
    const isSwarmChain = !!swarm && meta?.kind === 'swarm' && swarm.total > 1
    if (meta?.kind === 'boss') {
      const rows = new Set(cells.map((c) => c.y))
      for (const row of rows) {
        const rowC = this.bossRowG.get(row)
        if (rowC) {
          this.bossRowG.delete(row)
          if (!rowC.destroyed) {
            tween(rowC.scale, { x: 0, y: 0 }, 220, {
              delay: t,
              ease: easeInCubic,
              onDone: () => {
                if (!rowC.destroyed) rowC.destroy()
              },
            })
          }
        }
        for (let bx = 0; bx < W; bx++) this.blockG.delete(this.key(bx, row))
      }
      const face = this.bossFaceG.get(id)
      if (face) {
        this.bossFaceG.delete(id)
        if (!face.destroyed)
          tween(face, { alpha: 0 }, 220, {
            delay: t,
            onDone: () => {
              if (!face.destroyed) face.destroy()
            },
          })
      }
      this.bossId = null
    } else {
      for (const p of cells) {
        const k = this.key(p.x, p.y)
        const g = this.blockG.get(k)
        if (g) {
          this.blockG.delete(k)
          if (!g.destroyed) {
            if (isSwarmChain && swarm!.pos > 1) {
              // 隣からの衝撃パルスを受けた個体：潰れる前に1.15倍へ予備膨張してから通常のポップへ合流
              tween(g.scale, { x: 1.15, y: 1.15 }, 40, { delay: t })
              tween(g.scale, { x: 1.2, y: 1.2 }, 50, { delay: t + 40 })
              tween(g.scale, { x: 0, y: 0 }, 160, {
                delay: t + 90,
                ease: easeInCubic,
                onDone: () => {
                  if (!g.destroyed) g.destroy()
                },
              })
            } else {
              tween(g.scale, { x: 1.2, y: 1.2 }, 90, { delay: t })
              tween(g.scale, { x: 0, y: 0 }, 160, {
                delay: t + 90,
                ease: easeInCubic,
                onDone: () => {
                  if (!g.destroyed) g.destroy()
                },
              })
            }
          }
        }
      }
    }
    if (isSwarmChain) {
      const pos = swarm!.pos
      const sparkN = pos === 1 ? 6 : pos <= 4 ? 8 : 12
      for (const p of cells) this.swarmSparkFx(p, t, sparkN, pos >= 5)
      if (swarm!.nextCells && swarm!.nextCells.length) this.dominoPulseFx(cells, swarm!.nextCells, t)
      if (pos === swarm!.total) this.shakeRootDecay(t, 4, 140) // 最後の1体：4px揺れ（ヒットストップは呼び出し側=play()が申請）
    } else {
      for (const p of cells) this.debrisFx(p, t, 0xd9c9a8)
    }
    this.enemyMeta.delete(id)
    this.enemyCellsCache.delete(id)
  }

  /** swarmドミノの火花。1体目6・2〜4体目8・5体以上12＋金の紙片を混ぜる（codex_consult [D]-4） */
  private swarmSparkFx(p: XY, t: number, count: number, gold: boolean) {
    delay(t, () => {
      for (let i = 0; i < count; i++) {
        const g = this.acquireG(this.overFxLayer)
        const useGold = gold && i % 3 === 0
        if (useGold) g.roundRect(-2.6, -1.6, 5.2, 3.2, 1).fill(0xf2c14e)
        else g.circle(0, 0, 2.2).fill(0xf4ead0)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.35 + this.rnd() * 0.55)
        const dur = 260 + this.rnd() * 120
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0, rotation: useGold ? (this.rnd() - 0.5) * 6 : 0 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
  }

  /** swarmドミノ：撃破地点から次に倒れる隣接個体へ渡る衝撃パルス（60-90ms） */
  private dominoPulseFx(fromCells: XY[], toCells: XY[], t: number) {
    const fx = Math.round(fromCells.reduce((a, p) => a + p.x, 0) / fromCells.length)
    const fy = Math.round(fromCells.reduce((a, p) => a + p.y, 0) / fromCells.length)
    const tx = Math.round(toCells.reduce((a, p) => a + p.x, 0) / toCells.length)
    const ty = Math.round(toCells.reduce((a, p) => a + p.y, 0) / toCells.length)
    delay(t, () => {
      const g = this.acquireG(this.overFxLayer, 'important')
      g.circle(0, 0, this.S * 0.14).fill({ color: 0xe8b33c, alpha: 0.9 })
      g.position.set(this.px(fx), this.px(fy))
      const dur = 75
      tween(g.position, { x: this.px(tx), y: this.px(ty) }, dur, { ease: easeOutCubic, channel: 'fx' })
      tween(g.scale, { x: 1.6, y: 1.6 }, dur, { channel: 'fx' })
      tween(g, { alpha: 0 }, dur, {
        delay: 10,
        channel: 'fx',
        onDone: () => this.releaseG(g),
      })
    })
  }

  /**
   * swarm連鎖のドミノ段階を事前分類する（play()冒頭で一度だけ計算）。
   * defeatEnemy→propagateSwarmDefeat の再帰で enemy-damage/enemy-defeated が連続して積まれる構造を利用し、
   * 'enemy-defeated' の evsインデックス→{何体目/全体数/次に倒れる個体のcells} を求める（codex_consult [D]-4）。
   */
  private classifySwarmChain(evs: BoardEvent[]): Map<number, { pos: number; total: number; nextCells?: XY[] }> {
    const info = new Map<number, { pos: number; total: number; nextCells?: XY[] }>()
    const isSwarmStep = (ev: BoardEvent): ev is Extract<BoardEvent, { t: 'enemy-damage' } | { t: 'enemy-defeated' }> =>
      (ev.t === 'enemy-damage' || ev.t === 'enemy-defeated') && this.enemyMeta.get(ev.id)?.kind === 'swarm'
    let i = 0
    while (i < evs.length) {
      if (!isSwarmStep(evs[i])) {
        i++
        continue
      }
      const runIdx: number[] = []
      let j = i
      while (j < evs.length && isSwarmStep(evs[j])) {
        if (evs[j].t === 'enemy-defeated') runIdx.push(j)
        j++
      }
      const total = runIdx.length
      runIdx.forEach((idx, k) => {
        const nextIdx = runIdx[k + 1]
        const nextCells = nextIdx !== undefined ? (evs[nextIdx] as Extract<BoardEvent, { t: 'enemy-defeated' }>).cells : undefined
        info.set(idx, { pos: k + 1, total, nextCells })
      })
      i = j
    }
    return info
  }

  /** 爆発鉱石：3層爆発（下層=予兆円／中層=白橙コア+衝撃波2本／上層=火花・重量片・煙）。codex_consult [D]-2 */
  private explodeFx(p: XY, t: number, big: boolean) {
    this.layeredExplosionFx(p, t, {
      big,
      sparkColor: 0xffb066,
      coreColor: 0xff8a3d,
      ringColor: 0xff8a3d,
      chunkColor: 0xd9773b,
      sparkCount: big ? 24 : 18,
      chunkCount: big ? 12 : 8,
      smokeCount: big ? 6 : 4,
      ringMaxScale: big ? 3.4 : 2.6,
    })
  }

  /**
   * 3層爆発の共通実装。爆発鉱石・歯車爆弾で規模と色だけを変えて呼び出す（codex_consult [D]-2）。
   * 下層＝予兆円60ms収縮（駒の下）／中層＝白コア24ms＋色コア90ms＋衝撃波リング2本(180-260ms)／
   * 上層＝火花(160-240ms)・重量片(420-600ms)・煙(380ms〜)。全粒子で寿命と速度を変える。
   */
  private layeredExplosionFx(
    p: XY,
    t: number,
    opts: {
      big: boolean
      sparkColor: number
      coreColor: number
      ringColor: number
      chunkColor: number
      sparkCount: number
      chunkCount: number
      smokeCount: number
      ringMaxScale: number
    },
  ) {
    const S = this.S
    // 下層：予兆円（駒の下で60ms収縮）
    delay(t, () => {
      const pre = new Graphics()
      pre.circle(0, 0, S * 0.46).fill({ color: 0x2a1408, alpha: 0.55 })
      pre.position.set(this.px(p.x), this.px(p.y))
      this.underFxLayer.addChild(pre)
      tween(pre.scale, { x: 0.1, y: 0.1 }, 60, { ease: easeInCubic, channel: 'fx' })
      tween(pre, { alpha: 0 }, 60, {
        channel: 'fx',
        onDone: () => {
          if (!pre.destroyed) pre.destroy()
        },
      })
    })
    // 中層：白コア24ms
    delay(t, () => {
      const core = this.acquireG(this.overFxLayer, 'important')
      core.circle(0, 0, S * 0.24).fill({ color: 0xffffff, alpha: 0.95 })
      core.position.set(this.px(p.x), this.px(p.y))
      tween(core, { alpha: 0 }, 24, { channel: 'fx', onDone: () => this.releaseG(core) })
    })
    // 中層：色コア90ms
    delay(t + 8, () => {
      const oc = this.acquireG(this.overFxLayer, 'important')
      oc.circle(0, 0, S * 0.3).fill({ color: opts.coreColor, alpha: 0.9 })
      oc.position.set(this.px(p.x), this.px(p.y))
      tween(oc.scale, { x: 1.6, y: 1.6 }, 90, { ease: easeOutCubic, channel: 'fx' })
      tween(oc, { alpha: 0 }, 90, { channel: 'fx', onDone: () => this.releaseG(oc) })
    })
    // 中層：衝撃波リング（太い主波＋薄い副波の2本、180-260ms）
    delay(t, () => {
      const ringMain = this.acquireG(this.overFxLayer, 'important')
      ringMain.circle(0, 0, S * 0.32).stroke({ width: S * 0.14, color: opts.ringColor, alpha: 0.92 })
      ringMain.position.set(this.px(p.x), this.px(p.y))
      tween(ringMain.scale, { x: opts.ringMaxScale, y: opts.ringMaxScale }, 220, { ease: easeOutCubic, channel: 'fx' })
      tween(ringMain, { alpha: 0 }, 220, { channel: 'fx', onDone: () => this.releaseG(ringMain) })
      const ringSub = this.acquireG(this.overFxLayer)
      ringSub.circle(0, 0, S * 0.28).stroke({ width: S * 0.05, color: 0xffe3b0, alpha: 0.55 })
      ringSub.position.set(this.px(p.x), this.px(p.y))
      tween(ringSub.scale, { x: opts.ringMaxScale * 1.25, y: opts.ringMaxScale * 1.25 }, 260, { ease: easeOutCubic, channel: 'fx' })
      tween(ringSub, { alpha: 0 }, 260, { channel: 'fx', onDone: () => this.releaseG(ringSub) })
    })
    // 上層：火花（160-240ms）
    delay(t + 10, () => {
      for (let i = 0; i < opts.sparkCount; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.circle(0, 0, 2.2 + this.rnd() * 1.6).fill(opts.sparkColor)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = S * (0.5 + this.rnd() * (opts.big ? 0.9 : 0.6))
        const dur = 160 + this.rnd() * 80
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
    // 上層：重量片（420-600ms、重力落ち）
    delay(t + 20, () => {
      for (let i = 0; i < opts.chunkCount; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.roundRect(-3.2, -3.2, 6.4, 6.4, 1.4).fill(opts.chunkColor)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = S * (0.5 + this.rnd() * (opts.big ? 1.1 : 0.8))
        const dur = 420 + this.rnd() * 180
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d + S * 0.5 }, dur, {
          ease: easeOutCubic,
          channel: 'fx',
        })
        tween(g, { alpha: 0, rotation: (this.rnd() - 0.5) * 5 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
    // 上層：煙（下層に薄く漂わせる）
    delay(t + 40, () => {
      for (let i = 0; i < opts.smokeCount; i++) {
        const g = this.acquireG(this.underFxLayer)
        g.circle(0, 0, S * (0.16 + this.rnd() * 0.08)).fill({ color: 0x4a3a2a, alpha: 0.32 })
        g.position.set(this.px(p.x) + (this.rnd() - 0.5) * S * 0.3, this.px(p.y) + (this.rnd() - 0.5) * S * 0.3)
        const dur = 380 + this.rnd() * 200
        tween(g.position, { y: g.position.y - S * (0.3 + this.rnd() * 0.3) }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g.scale, { x: 1.6, y: 1.6 }, dur, { channel: 'fx' })
        tween(g, { alpha: 0 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
  }

  /**
   * 爆発／コンボ／swarmドミノ最後の一撃で使う root の減衰揺れ。初撃最大→0.6→0.3、x:y=1:0.35（codex_consult [D]-2/4）。
   * 画面全体ではなく root のみを揺らし、HUDの可読性を守る。
   */
  private shakeRootDecay(t: number, amp: number, totalDur: number) {
    const c = this.root
    const bx = c.position.x
    const by = c.position.y
    const steps = [1, -0.6, 0.6, -0.3, 0]
    const stepDur = totalDur / (steps.length - 1)
    let d = t
    for (const k of steps) {
      tween(c.position, { x: bx + amp * k, y: by + amp * 0.35 * k }, stepDur, { delay: d, channel: 'fx' })
      d += stepDur
    }
  }

  /** ギア起動：金の回転リング一瞬 */
  private gearRingFx(p: XY, t: number) {
    delay(t, () => {
      const ring = new Graphics()
      ring.circle(0, 0, this.S * 0.34).stroke({ width: this.S * 0.05, color: 0xe8b33c, alpha: 0.9 })
      ring.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(ring)
      tween(ring.scale, { x: 1.5, y: 1.5 }, 240, { ease: easeOutCubic })
      tween(ring, { rotation: Math.PI * 1.4 }, 240, { ease: easeOutCubic })
      tween(ring, { alpha: 0 }, 240, { onDone: () => ring.destroy() })
    })
  }

  /** 誕生イベント 0-70ms：周囲4-8駒を中心へ2-3px吸引＋局所減光（codex_consult [D]-1） */
  private birthPullFx(at: XY, t: number) {
    delay(t, () => {
      const S = this.S
      const dim = new Graphics()
      dim.circle(0, 0, S * 0.62).fill({ color: 0x000000, alpha: 0.2 })
      dim.position.set(this.px(at.x), this.px(at.y))
      dim.alpha = 0
      this.underFxLayer.addChild(dim)
      tween(dim, { alpha: 1 }, 30, { channel: 'fx' })
      tween(dim, { alpha: 0 }, 40, {
        delay: 30,
        channel: 'fx',
        onDone: () => {
          if (!dim.destroyed) dim.destroy()
        },
      })
      const neighbors: XY[] = [
        { x: at.x - 1, y: at.y },
        { x: at.x + 1, y: at.y },
        { x: at.x, y: at.y - 1 },
        { x: at.x, y: at.y + 1 },
        { x: at.x - 1, y: at.y - 1 },
        { x: at.x + 1, y: at.y - 1 },
        { x: at.x - 1, y: at.y + 1 },
        { x: at.x + 1, y: at.y + 1 },
      ]
      for (const n of neighbors) {
        const sp = this.sprites.get(this.key(n.x, n.y))
        if (!sp || sp.destroyed) continue
        const bx = sp.position.x
        const by = sp.position.y
        const ang = Math.atan2(this.px(at.y) - by, this.px(at.x) - bx)
        const pull = S * (0.02 + this.rnd() * 0.015) // 2-3px相当（セル比率換算）
        tween(sp.position, { x: bx + Math.cos(ang) * pull, y: by + Math.sin(ang) * pull }, 70, { ease: easeOutCubic, channel: 'fx' })
        tween(sp.position, { x: bx, y: by }, 90, { delay: 70, channel: 'fx' })
      }
    })
  }

  /** 誕生イベント 105-250ms：星片8-12＋放射線6-8（系統色。通常消去の火花とは専用色/形にする） */
  private birthBurstFx(at: XY, t: number, color: number) {
    const S = this.S
    delay(t, () => {
      const starN = 8 + Math.floor(this.rnd() * 5) // 8-12
      for (let i = 0; i < starN; i++) {
        const g = this.acquireG(this.overFxLayer)
        const r = 3.2
        g.moveTo(0, -r)
          .lineTo(r * 0.32, -r * 0.32)
          .lineTo(r, 0)
          .lineTo(r * 0.32, r * 0.32)
          .lineTo(0, r)
          .lineTo(-r * 0.32, r * 0.32)
          .lineTo(-r, 0)
          .lineTo(-r * 0.32, -r * 0.32)
          .closePath()
          .fill(color)
        g.position.set(this.px(at.x), this.px(at.y))
        const a = (i / starN) * Math.PI * 2 + this.rnd() * 0.4
        const d = S * (0.45 + this.rnd() * 0.5)
        const dur = 260 + this.rnd() * 140
        tween(g.position, { x: this.px(at.x) + Math.cos(a) * d, y: this.px(at.y) + Math.sin(a) * d }, dur, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0, rotation: (this.rnd() - 0.5) * 4 }, dur, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
      const rayN = 6 + Math.floor(this.rnd() * 3) // 6-8
      for (let i = 0; i < rayN; i++) {
        const ray = this.acquireG(this.overFxLayer)
        ray.roundRect(0, -S * 0.03, S * 0.5, S * 0.06, S * 0.03).fill({ color, alpha: 0.85 })
        ray.position.set(this.px(at.x), this.px(at.y))
        ray.rotation = (i / rayN) * Math.PI * 2
        ray.scale.set(0.15, 1)
        tween(ray.scale, { x: 1 }, 180, { ease: easeOutCubic, channel: 'fx' })
        tween(ray, { alpha: 0 }, 220, { delay: 80, channel: 'fx', onDone: () => this.releaseG(ray) })
      }
    })
  }

  /** 毒胞子発動：紫の小バースト */
  private violetBurstFx(p: XY, t: number) {
    delay(t, () => {
      for (let i = 0; i < 6; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.circle(0, 0, 2.6).fill(0xb98be0)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.35 + this.rnd() * 0.45)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 300, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0 }, 300, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
  }

  // ---- 可視化第一波①：敵インテントバッジ（fxLayer・board.enemies から都度導出。専用状態は持たない） ----

  /** 敵ごとのインテントバッジを最新状態へ再構成する（play()終端・syncAllから呼ぶ） */
  private updateIntentBadges() {
    const seen = new Set<number>()
    for (const en of this.board.enemies) {
      if (en.hp <= 0) continue
      seen.add(en.id)
      this.paintIntentBadge(en)
    }
    for (const [id, g] of [...this.intentG]) {
      if (!seen.has(id)) {
        this.intentG.delete(id)
        if (!g.destroyed) g.destroy()
      }
    }
  }

  private drawIntentIcon(g: Graphics, kind: IntentKind, r: number) {
    const col = 0xf4e8cf
    if (kind === 'armor') {
      // 盾形（甲殻付与の予告）
      g.moveTo(0, -r)
        .lineTo(r * 0.82, -r * 0.4)
        .lineTo(r * 0.82, r * 0.28)
        .lineTo(0, r)
        .lineTo(-r * 0.82, r * 0.28)
        .lineTo(-r * 0.82, -r * 0.4)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'devour') {
      // 雫形（捕食の予告）
      g.moveTo(0, -r)
        .bezierCurveTo(r * 0.8, r * 0.15, r * 0.62, r, 0, r)
        .bezierCurveTo(-r * 0.62, r, -r * 0.8, r * 0.15, 0, -r)
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'fissure') {
      // X形（崩落・封鎖の予告）
      const w = r * 0.3
      g.moveTo(-r, -r)
        .lineTo(-r + w, -r)
        .lineTo(r, r - w)
        .lineTo(r, r)
        .lineTo(r - w, r)
        .lineTo(-r, -r + w)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
      g.moveTo(r, -r)
        .lineTo(r - w, -r)
        .lineTo(-r, r - w)
        .lineTo(-r, r)
        .lineTo(-r + w, r)
        .lineTo(r, -r + w)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'drain') {
      // 衝撃波形（酸素を吸い取る予告。息喰み／深匣主の共通アイコン）
      g.arc(0, r * 0.25, r * 0.55, Math.PI * 1.15, Math.PI * 1.85).stroke({ width: r * 0.22, color: col, alpha: 0.92 })
      g.arc(0, r * 0.25, r * 1.0, Math.PI * 1.2, Math.PI * 1.8).stroke({ width: r * 0.16, color: col, alpha: 0.7 })
    } else {
      // 汎用フォールバック（行動の種類が分からない新種）：小粒3つ
      for (const [dx, dy] of [
        [-r * 0.55, r * 0.25],
        [r * 0.55, r * 0.25],
        [0, -r * 0.55],
      ])
        g.circle(dx, dy, r * 0.32).fill({ color: col, alpha: 0.92 })
    }
  }

  /** 1体ぶんのバッジを再描画（新規なら生成）。位置は敵セル内側の右上隅に収め、駒には絶対にかぶらない */
  private paintIntentBadge(en: EnemyInstance) {
    const S = this.S
    const intent: EnemyIntent = enemyIntent(en, this.board.run?.blessings ?? [])
    // 行動を持たない敵（swarm）はバッジ自体を出さない＝「読むものが無い」ことを画面から消す
    if (intent.kind === 'none') {
      const old = this.intentG.get(en.id)
      if (old) {
        this.intentG.delete(en.id)
        if (!old.destroyed) old.destroy()
      }
      return
    }
    // ボスは全幅を占有するため、身体の右端セルに代表させる（通常敵と同じ経路に統合）
    const c = en.kind === 'boss' ? en.cells[en.cells.length - 1] : en.cells[0]
    if (!c) return
    const cellX = c.x
    const cellY = c.y
    let host = this.intentG.get(en.id)
    const isNew = !host || host.destroyed
    if (isNew) {
      host = new Container()
      this.uiFxLayer.addChild(host)
      this.intentG.set(en.id, host)
    }
    const h = host!
    h.removeChildren().forEach((c) => c.destroy())
    if (isNew) {
      // 可視化第一波①：インテントバッジ自体のタップでも野帳シートを開く（[C]「敵本体／インテントバッジのタップ」）
      h.eventMode = 'static'
      h.cursor = 'pointer'
      h.on('pointertap', (e) => {
        e.stopPropagation()
        this.onEnemyTap?.(en)
      })
    }
    // 酸素を奪う相手（drain）だけを危険色・太枠・大サイズにする＝「赤いバッジは酸素が減る」の一意な約束
    const danger = intent.kind === 'drain'
    const remaining = intent.turns
    const bw = S * (danger ? 0.37 : 0.32) // 危険バッジは妨害よりわずかに大きく
    const inset = S * 0.08
    h.position.set(cellX * S + S - bw / 2 - inset, cellY * S + bw / 2 + inset)
    // タップ領域は危険/妨害の大小に関わらず最大サイズで確保（バッジの見た目より一回り広めの円）
    const hitR = S * 0.37 * 0.75
    h.hitArea = { contains: (lx: number, ly: number) => lx * lx + ly * ly <= hitR * hitR }
    const bg = new Graphics()
    bg.circle(0, 0, bw / 2)
      .fill({ color: 0x1c1712, alpha: 0.86 })
      .stroke({ width: danger ? 2.1 : 1.4, color: danger ? 0xe0503a : 0xd9c9a0, alpha: danger ? 0.95 : 0.75 })
    h.addChild(bg)
    const icon = new Graphics()
    this.drawIntentIcon(icon, intent.kind, bw * (danger ? 0.32 : 0.3))
    icon.position.set(-bw * 0.16, -bw * 0.02)
    h.addChild(icon)
    // 危険バッジは奪われる酸素量、妨害バッジは従来どおり残りターン数を出す
    const numT = new Text({
      text: danger ? String(intent.oxygen ?? '?') : String(remaining),
      style: { fill: danger ? 0xffcabb : 0xf4e8cf, fontSize: bw * (danger ? 0.46 : 0.5), fontFamily: FONT, fontWeight: 'bold' },
    })
    numT.anchor.set(0.5)
    numT.position.set(bw * 0.24, bw * 0.06)
    h.addChild(numT)
    const meta = h as unknown as { __pulsing?: boolean; __baseY?: number }
    meta.__baseY = h.position.y
    const urgent = remaining <= 1 // 点滅タイミングは攻撃/妨害いずれも「残りターン」基準で現行どおり
    if (urgent) {
      if (!meta.__pulsing) {
        meta.__pulsing = true
        this.pulseIntentBadge(h)
      }
    } else {
      meta.__pulsing = false
      h.alpha = 0.75
      h.scale.set(1)
    }
  }

  /** 残り1ターンの間だけ、ゆっくり点滅+浮上を繰り返す（うるさくしない：alpha 0.75⇄1・微小な上下動のみ） */
  private pulseIntentBadge(host: Container) {
    const meta = host as unknown as { __pulsing?: boolean; __baseY?: number }
    if (host.destroyed || !meta.__pulsing) return
    const baseY = meta.__baseY ?? host.position.y
    tween(host, { alpha: 1 }, 460, {
      onDone: () => {
        if (host.destroyed || !meta.__pulsing) return
        tween(host, { alpha: 0.75 }, 460, { onDone: () => this.pulseIntentBadge(host) })
      },
    })
    tween(host.position, { y: baseY - this.S * 0.06 }, 460, {
      onDone: () => {
        if (host.destroyed || !meta.__pulsing) return
        tween(host.position, { y: baseY }, 460)
      },
    })
  }

  /** 行動の予告：バッジを一瞬強く光らせてから、呼び出し側が実行イベントを再生する（予告→実行） */
  private flashIntentBadge(enemyId: number, t: number) {
    const g = this.intentG.get(enemyId)
    if (!g || g.destroyed) return
    delay(t, () => {
      if (g.destroyed) return
      tween(g, { alpha: 1 }, 90)
      tween(g.scale, { x: 1.6, y: 1.6 }, 130, {
        onDone: () => {
          if (g.destroyed) return
          tween(g.scale, { x: 1, y: 1 }, 170, { ease: easeOutCubic })
        },
      })
    })
  }

  // ---- 可視化第一波③：爆発鉱石の常時発光 ----

  /** 爆発鉱石（volatile化した駒）の常時ゆらぐ淡いオレンジ発光。cellのpieceが差し替わる/消えるまで帳簿で管理 */
  private makeVolatileOverlay(x: number, y: number, t = 0) {
    const k = this.key(x, y)
    const old = this.volatileG.get(k)
    if (old && !old.destroyed) return // 既にある（reconcile経由の二重生成防止）
    const S = this.S
    const g = new Graphics()
    g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0xff8a3d, alpha: 1 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.volatileG.set(k, g)
    const loop = () => {
      if (g.destroyed || this.volatileG.get(k) !== g) return
      tween(g, { alpha: 0.42 }, 560, {
        onDone: () => {
          if (g.destroyed || this.volatileG.get(k) !== g) return
          tween(g, { alpha: 0.16 }, 560, { onDone: loop })
        },
      })
    }
    tween(g, { alpha: 0.16 }, 200, { delay: t, onDone: loop })
  }

  /** 破壊された爆発鉱石の発光を片付ける（popPieceAtから共通で呼ぶ） */
  private clearVolatileOverlay(p: XY, t: number) {
    const k = this.key(p.x, p.y)
    const g = this.volatileG.get(k)
    if (!g) return
    this.volatileG.delete(k)
    if (!g.destroyed)
      tween(g, { alpha: 0 }, 150, {
        delay: t,
        onDone: () => {
          if (!g.destroyed) g.destroy()
        },
      })
  }

  // ---- 可視化第一波：小さな浮遊ラベル（因果の実況・強化発動アピール共通） ----

  /**
   * 小さな浮遊ラベル（明朝・小・上昇して消える）。token-spawn/gear-trigger/爆発鉱石変換/upgrade-fire で共用。
   * 出所が違うラベルが同じマスに同時に出ると重なって両方読めなくなる（実測：深度22の層頭で「＋胞子」と「毒胞子」）。
   * 発火数は深層で増える一方なので、生きているラベルと重なる位置なら1行ぶんずつ上へ積む。
   */
  private liveFloatLabels: Text[] = []

  private floatLabelFx(p: XY, text: string, color: number, t: number, yOffset = -0.15) {
    delay(t, () => {
      const txt = new Text({
        text,
        style: { fill: color, fontSize: this.S * 0.2, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
      })
      txt.anchor.set(0.5)
      const x = this.px(p.x)
      let y = this.px(p.y) + this.S * yOffset
      this.liveFloatLabels = this.liveFloatLabels.filter((o) => !o.destroyed)
      const hits = (yy: number) =>
        this.liveFloatLabels.some((o) => Math.abs(o.position.x - x) < this.S * 0.6 && Math.abs(o.position.y - yy) < this.S * 0.26)
      for (let i = 0; i < 4 && hits(y); i++) y -= this.S * 0.28
      txt.position.set(x, y)
      this.liveFloatLabels.push(txt)
      this.uiFxLayer.addChild(txt)
      tween(txt.position, { y: txt.position.y - this.S * 0.5 }, 520, { ease: easeOutCubic })
      tween(txt, { alpha: 0 }, 360, {
        delay: 200,
        onDone: () => {
          if (!txt.destroyed) txt.destroy()
        },
      })
    })
  }

  /** 可視化第二波③：妨害の実行元→対象セルへ細い線を1本引く（因果＝「どの敵がやったか」を示す）。フェードのみで消える */
  private causeLineFx(enemyId: number, to: XY, color: number, t: number) {
    const cells = this.enemyCellsCache.get(enemyId)
    const from = cells?.[0]
    if (!from || (from.x === to.x && from.y === to.y)) return
    delay(t, () => {
      const g = new Graphics()
      g.moveTo(this.px(from.x), this.px(from.y))
        .lineTo(this.px(to.x), this.px(to.y))
        .stroke({ width: this.S * 0.045, color, alpha: 0.7 })
      this.fxLayer.addChild(g)
      tween(g, { alpha: 0 }, 380, {
        delay: 120,
        onDone: () => {
          if (!g.destroyed) g.destroy()
        },
      })
    })
  }

  /** 可視化第二波②：酸素強奪の起点（自セル上の赤い一瞬のバースト）。着弾側（酸素ゲージ）の演出は main.ts の onOxygenDrained が担う */
  private enemyAttackTelegraphFx(enemyId: number, t: number) {
    const cells = this.enemyCellsCache.get(enemyId)
    if (!cells || !cells.length) return
    const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
    const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.28).fill({ color: 0xe0503a, alpha: 0.8 })
      g.position.set(this.px(cx), this.px(cy))
      this.fxLayer.addChild(g)
      tween(g.scale, { x: 1.9, y: 1.9 }, 220, { ease: easeOutCubic })
      tween(g, { alpha: 0 }, 220, { onDone: () => g.destroy() })
    })
  }

  /** 強化発動：起点セルに小さな金フラッシュ（ラベルは floatLabelFx が別途出す） */
  private upgradeFlashFx(p: XY, t: number) {
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.14).fill({ color: 0xf2c14e, alpha: 0.85 })
      g.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(g)
      tween(g.scale, { x: 2.2, y: 2.2 }, 240, { ease: easeOutCubic })
      tween(g, { alpha: 0 }, 240, { onDone: () => g.destroy() })
    })
  }

  private makeGround(x: number, y: number, level: 1 | 2) {
    const S = this.S
    const tex = spriteTexture(level === 2 ? 'ground_thick' : 'ground_thin')
    if (tex) {
      const sp = new Sprite(tex)
      sp.width = S
      sp.height = S
      sp.position.set(x * S, y * S)
      this.groundLayer.addChild(sp)
      this.groundG.set(this.key(x, y), sp)
      return
    }
    const g = new Graphics()
    g.roundRect(2, 2, S - 4, S - 4, 6).fill({ color: 0x4f7a4a, alpha: level === 2 ? 0.85 : 0.5 })
    g.position.set(x * this.S, y * this.S)
    this.groundLayer.addChild(g)
    this.groundG.set(this.key(x, y), g)
  }

  // ---- 可視化第二波：連鎖数の常駐表示（codex_consult [D]-3。同じコンテナを更新して鼓動させる） ----

  /** 連鎖数表示コンテナを確保（初回のみ生成。以後は使い回す） */
  private ensureChainCounter(): { host: Container; text: Text; glow: Graphics } {
    if (this.chainCounterG && !this.chainCounterG.destroyed && this.chainCounterText && this.chainCounterGlow) {
      return { host: this.chainCounterG, text: this.chainCounterText, glow: this.chainCounterGlow }
    }
    const host = new Container()
    host.position.set((W * this.S) / 2, this.S * 0.56)
    const glow = new Graphics()
    host.addChild(glow)
    const text = new Text({
      text: '',
      style: { fill: 0xfff1d0, fontSize: this.S * 0.46, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 5 } },
    })
    text.anchor.set(0.5)
    host.addChild(text)
    host.alpha = 0
    this.uiFxLayer.addChild(host)
    this.chainCounterG = host
    this.chainCounterText = text
    this.chainCounterGlow = glow
    return { host, text, glow }
  }

  /** 連鎖数表示を更新して鼓動させる。5連鎖から金縁、8連鎖から常時微発光（新規Textは重ねない） */
  private updateChainCounter(chain: number, t: number) {
    if (chain < 2) return
    const { host, text, glow } = this.ensureChainCounter()
    const ep = this.epoch
    delay(t, () => {
      if (ep !== this.epoch || host.destroyed) return
      text.text = `${chain} 連鎖`
      text.style.stroke = { color: chain >= 5 ? 0xe8b33c : 0x2a1c10, width: 5 }
      glow.clear()
      if (chain >= 8) glow.circle(0, 0, this.S * 0.9).fill({ color: 0xf2c14e, alpha: 0.22 })
      host.alpha = 1
      host.scale.set(1.14)
      tween(host.scale, { x: 1, y: 1 }, 160, { ease: easeOutBack, channel: 'fx' })
    })
  }

  /** 連鎖数表示をフェードアウト（このplay()呼び出しの終端で。次の一手までに消す） */
  private fadeChainCounter(t: number) {
    const host = this.chainCounterG
    if (!host) return
    const ep = this.epoch
    delay(t, () => {
      if (ep !== this.epoch || host.destroyed) return
      tween(host, { alpha: 0 }, 260, { channel: 'fx' })
    })
  }

  // ---- イベント→タイムライン ----

  /** イベント列をアニメ予約。所要合計msを返す */
  play(evs: BoardEvent[]): number {
    // codex_consult [D]-6：盤面状態のトゥイーン（'board'チャンネル・既定）だけを終端までスナップし、
    // 破棄可能な余韻FX（'fx'チャンネル：火花・破片・爆発演出等）は打ち切らず次の入力とも共存させる
    completeChannel('board')
    // 可視化第二波：演出用の決定的乱数を1手ごとに再シード（QA比較の安定のため Math.random() は使わない）
    this.fxSeed = (this.fxSeed * 48271 + 12345) % 0x7fffffff || 1
    this.fxRand = mulberry32(this.fxSeed)
    resetMoveBudget() // 1手あたりの振動回数の予算をここで戻す（JUICE.md §1③）
    let t = 0
    let chainSeen = 0
    let chainStartT = 0 // 連鎖セグメントの開始時刻（ビートはここから加速カーブで刻む＝落下完了を待つ）
    const upgradeFireCounts = new Map<string, number>() // 可視化第一波②：このタイムライン内での強化ごとの発動回数
    let disruptLabelCount = 0 // 可視化第二波③：因果ラベルは1ターン（=このplay呼び出し1回）に最大2個まで
    let goalFxCount = 0 // 目標収集：この手で何本目の飛翔か（破片4件・飛翔6件で打ち止める）
    const hitstop = new HitstopBudget() // 600ms窓で最大80msに制限するヒットストップ予算（codex_consult [D]-2/4）
    const swarmChain = this.classifySwarmChain(evs) // swarm連鎖ドミノの段階付け（codex_consult [D]-4）
    // 10連鎖以上を含む手は「暴走時」扱いにし、粒子の同時上限を80→120へ緩める（codex_consult [D]-6）
    this.rampageActive = evs.some((ev) => ev.t === 'match' && ev.chain >= 10)
    // 論理は確定済みなので、描画用に「イベント時点のスプライト対応」を移動しながら追う
    for (let ei = 0; ei < evs.length; ei++) {
      const e = evs[ei]
      switch (e.t) {
        case 'swap': {
          const a = this.sprites.get(this.key(e.a.x, e.a.y))
          const b = this.sprites.get(this.key(e.b.x, e.b.y))
          if (a && b) {
            this.sprites.set(this.key(e.a.x, e.a.y), b)
            this.sprites.set(this.key(e.b.x, e.b.y), a)
            const move = (sp: Sprite, to: XY, back: boolean) => {
              // 成立スワップは目標セルをわずかに行き過ぎて戻る（手応えの核。JUICE.md §1）
              tween(sp.position, { x: this.px(to.x), y: this.px(to.y) }, T.swap, { delay: t, ease: easeOutBackSoft })
              if (back)
                tween(sp.position, { x: this.px(back ? e.a.x : to.x), y: this.px(back ? e.a.y : to.y) }, T.swap, {
                  delay: t + T.swap,
                })
            }
            if (e.illegal) {
              // 行って戻る（往復240ms。オーバーシュートを付けると「震え」に見えるのでイージングは据え置き）
              tween(a.position, { x: this.px(e.b.x), y: this.px(e.b.y) }, T.swapBack, { delay: t })
              tween(b.position, { x: this.px(e.a.x), y: this.px(e.a.y) }, T.swapBack, { delay: t })
              tween(a.position, { x: this.px(e.a.x), y: this.px(e.a.y) }, T.swapBack, { delay: t + T.swapBack })
              tween(b.position, { x: this.px(e.b.x), y: this.px(e.b.y) }, T.swapBack, { delay: t + T.swapBack })
              this.sprites.set(this.key(e.a.x, e.a.y), a)
              this.sprites.set(this.key(e.b.x, e.b.y), b)
              t += T.swapBack * 2
            } else {
              move(a, e.b, false)
              move(b, e.a, false)
              t += T.swap
            }
          }
          break
        }
        case 'match': {
          if (e.chain > chainSeen) {
            // 連鎖ビート＝前セグメント開始からのテンポ。固定650msではなく加速カーブ（codex_consult [D]-3）
            // chainBeatFor は「到達する連鎖段」で引く（2連鎖目470ms・3連鎖目410ms…）
            if (e.chain > 1) t = Math.max(t, chainStartT + chainBeatFor(e.chain))
            chainSeen = e.chain
            chainStartT = t
            sfx.pop(e.chain, t / 1000)
            delay(t, () => buzz(e.chain >= 5 ? 'chain' : 'pop')) // 連鎖段が上がった瞬間だけ鳴らす（1マッチ最大1回）
            this.updateChainCounter(e.chain, t)
          }
          // 10連鎖以降は通常消去の火花を50%間引き、爆発・特殊生成・敵撃破の粒子だけを残す
          const skipChance = e.chain >= 10 ? 0.5 : 0
          for (const p of e.cells) this.popPieceAt(p, t, false, skipChance)
          break
        }
        case 'special-fire': {
          this.popPieceAt(e.at, t, true) // 発動した特殊駒自身のスプライトを消す（描画残りバグ対策）
          for (const p of e.cleared) this.popPieceAt(p, t, true)
          this.fireFx(e.at, e.piece, t)
          sfx.fire(e.piece.kind, t / 1000)
          if (e.piece.kind === 'hitsubo') {
            delay(t, () => buzz('blast'))
            this.shakeRootDecay(t, 4, 160) // 歯車爆弾：3×3相当の揺れ
            t += hitstop.request(t, 45)
          }
          t += 160 // 起爆ごとのビート（連発時に畳み掛ける間隔）
          // codex_consult [D]-3：特殊駒発火では連鎖段を0に戻さない。同じ解決内なら連鎖を維持し、音階/低域を積み上げる
          break
        }
        case 'win-drain': {
          // 残手数→特殊駒変換の彗星（1手 約45ms＝実測30-60msの中庸）
          if (e.convertAt) this.cometFx(e.convertAt, t)
          sfx.drain(this.drainCount++, t / 1000)
          t += 45
          break
        }
        case 'win-detonate-begin': {
          t += 350
          break
        }
        case 'combo': {
          // 合成：両方の特殊駒スプライトを消費（描画残りバグ対策）。特殊駒コンボは65msヒットストップ＋root揺れ
          this.popPieceAt(e.from, t, true)
          this.popPieceAt(e.at, t, true)
          this.flashFx(e.at, t)
          delay(t, () => buzz('blast'))
          this.shakeRootDecay(t, 6, 220)
          t += hitstop.request(t, 65)
          break
        }
        case 'special-born': {
          // 特殊駒生成を「誕生イベント」として演出する（codex_consult [D]-1。最優先＝基準品質のコア）
          const sp = this.makePiece(e.at.x, e.at.y, e.piece)
          const b = this.bs(sp)
          const style = SPECIAL_BORN_STYLE[e.piece.kind] ?? SPECIAL_BORN_STYLE.default
          const born0 = t + T.pop
          sp.scale.set(0)
          sp.alpha = 0
          // 0-70ms：周囲の駒を中心へ2-3px吸引＋局所減光（消滅ポップと同時並行）
          this.birthPullFx(e.at, born0)
          // 70-105ms：白コア1フレーム相当＋35msの表示上のヒットストップ（以後の予約時刻を後ろへずらす）
          const stop = hitstop.request(born0 + 70, 35)
          delay(born0 + 70, () => {
            const core = this.acquireG(this.overFxLayer, 'important')
            core.circle(0, 0, this.S * 0.36).fill({ color: 0xffffff, alpha: 0.95 })
            core.position.set(this.px(e.at.x), this.px(e.at.y))
            tween(core, { alpha: 0 }, 20, { channel: 'fx', onDone: () => this.releaseG(core) })
            buzz('born') // 白コアと同じ瞬間に鳴らす（この delay 自体が予約済みなので素で呼ぶ）
          })
          const scaleUpStart = born0 + 70 + stop
          const rotSign = (e.at.x + e.at.y) % 2 === 0 ? 1 : -1 // 決定的な回転方向（座標由来）
          const rotAmt = ((style.rotDeg * Math.PI) / 180) * rotSign
          sp.rotation = -rotAmt
          tween(sp, { alpha: 1 }, 60, { delay: scaleUpStart })
          tween(sp, { rotation: rotAmt }, 145, { delay: scaleUpStart, ease: easeOutBack })
          tween(sp, { rotation: 0 }, 90, { delay: scaleUpStart + 145, ease: easeOutCubic })
          sp.scale.set(b * 0.55)
          tween(sp.scale, { x: b * 1.18, y: b * 1.18 }, 145, { delay: scaleUpStart, ease: easeOutBack })
          tween(sp.scale, { x: b, y: b }, 90, { delay: scaleUpStart + 145 })
          this.birthBurstFx(e.at, scaleUpStart, style.color)
          sfx.born(e.piece.kind, (born0 + 70) / 1000)
          // 可視化第一波③：爆発鉱石への変換（特殊駒生成イベントを共用）は一瞬明滅+ラベルで因果を示す
          if (e.piece.kind === 'normal' && e.piece.volatile) {
            this.makeVolatileOverlay(e.at.x, e.at.y, scaleUpStart)
            this.floatLabelFx(e.at, '爆発鉱石！', 0xff8a3d, scaleUpStart, -0.2)
          }
          t += stop
          break
        }
        case 'block-hit': {
          if (e.destroyed) sfx.block(t / 1000)
          const g = this.blockG.get(this.key(e.at.x, e.at.y))
          if (g) {
            const gg = g
            tween(gg.scale, { x: 1.08, y: 1.08 }, 60, { delay: t })
            tween(gg.scale, { x: 1, y: 1 }, 100, { delay: t + 60 })
            // 破壊 or 状態変化（匣→陶片、苔石2層→1層）: 再描画。世代跨ぎ・多重破棄は無効化
            const ep = this.epoch
            delay(t + T.blockHit, () => {
              if (ep !== this.epoch || gg.destroyed) return
              gg.destroy()
              this.blockG.delete(this.key(e.at.x, e.at.y))
              const c = this.board.at(e.at.x, e.at.y)
              if (c?.block) this.makeBlock(e.at.x, e.at.y)
            })
            if (e.destroyed || e.type === 'hako') this.debrisFx(e.at, t, e.type === 'kokeishi' ? PAL.stone : PAL.wood)
          }
          break
        }
        case 'goal-progress': {
          const n = goalFxCount++
          const fxT = t + GOAL_FX_DELAY[e.goal.type]
          if (n < 4) this.debrisFx(e.at, fxT, GOAL_DEBRIS_COLOR[e.goal.type]) // 既存の粒子プール経由
          if (n < 6) {
            const stagger = Math.min(55, 300 / Math.max(1, Math.min(5, n))) * n
            const ep = this.epoch
            delay(fxT + stagger, () => {
              if (ep !== this.epoch) return
              const gp = this.pieceLayer.toGlobal({ x: this.px(e.at.x), y: this.px(e.at.y) }, GOAL_PT)
              this.onGoalCollect?.(e.index, e.done, { x: gp.x, y: gp.y }, n)
            })
          }
          // t は進めない：目標進捗は match/block-hit の副産物であり、ここでビートを消費すると連鎖テンポが壊れる
          break
        }
        case 'ground-hit': {
          const g = this.groundG.get(this.key(e.at.x, e.at.y))
          if (g) {
            const gg = g
            const left = e.left
            const ep = this.epoch
            delay(t + T.pop * 0.6, () => {
              if (ep !== this.epoch) return // レベル遷移後の幽霊タイル防止
              gg.destroy()
              this.groundG.delete(this.key(e.at.x, e.at.y))
              if (left > 0) this.makeGround(e.at.x, e.at.y, left as 1 | 2)
            })
          }
          break
        }
        case 'fall': {
          const sp = this.sprites.get(this.key(e.from.x, e.from.y))
          if (sp) {
            this.sprites.delete(this.key(e.from.x, e.from.y))
            this.sprites.set(this.key(e.to.x, e.to.y), sp)
            const dist = Math.abs(e.to.y - e.from.y)
            const b = this.bs(sp)
            const fallDur = Math.min(340, 150 * Math.sqrt(dist)) // 自由落下 t∝√h（1マス150ms基準）
            const colStagger = ((e.to.x * 5) % 4) * 9 // 列ごとの決定的スタッガー＝板ではなく崩れに見せる
            const landY = this.px(e.to.y)
            tween(sp.position, { x: this.px(e.to.x), y: landY }, fallDur, {
              delay: t + T.pop + colStagger,
              ease: easeInQuad,
              onDone: () => {
                // 着地：52msだけ潰れて沈み、110msで戻す（潰れと沈みを対で動かすと重さが出る）
                tween(sp.scale, { x: b * 1.14, y: b * 0.86 }, 52, {
                  onDone: () => tween(sp.scale, { x: b, y: b }, 110, { ease: easeOutBackSoft }),
                })
                tween(sp.position, { y: landY + this.S * 0.052 }, 52, {
                  onDone: () => tween(sp.position, { y: landY }, 110, { ease: easeOutBackSoft }),
                })
              },
            })
          }
          break
        }
        case 'refill': {
          const sp = this.makePiece(e.at.x, e.at.y, e.piece)
          sp.position.y = -this.S * 0.8
          sp.alpha = 0
          tween(sp, { alpha: 1 }, 80, { delay: t + T.pop })
          // 補充も落下と同じ加速。ただし着地バウンスは付けない（画面上端から次々降ってくるので跳ねると騒がしい）
          tween(sp.position, { y: this.px(e.at.y) }, Math.min(340, 150 * Math.sqrt(e.at.y + 1)), {
            delay: t + T.pop + e.at.y * 14,
            ease: easeInQuad,
          })
          break
        }
        case 'spore-born': {
          const sp = this.makePiece(e.at.x, e.at.y, { kind: 'spore' })
          const b = this.bs(sp)
          sp.scale.set(0)
          tween(sp.scale, { x: b, y: b }, 250, { delay: t, ease: easeOutBack })
          break
        }
        case 'spore-rise': {
          const sp = this.sprites.get(this.key(e.from.x, e.from.y))
          const other = this.sprites.get(this.key(e.to.x, e.to.y))
          if (sp) {
            this.sprites.set(this.key(e.to.x, e.to.y), sp)
            if (other) this.sprites.set(this.key(e.from.x, e.from.y), other)
            else this.sprites.delete(this.key(e.from.x, e.from.y))
            tween(sp.position, { y: this.px(e.to.y) }, 300, { delay: t, ease: easeOutCubic })
            if (other) tween(other.position, { y: this.px(e.from.y) }, 300, { delay: t, ease: easeOutCubic })
          }
          break
        }
        case 'spore-collected': {
          sfx.spore(t / 1000)
          const sp = this.sprites.get(this.key(e.at.x, e.at.y))
          if (sp) {
            this.sprites.delete(this.key(e.at.x, e.at.y))
            tween(sp, { alpha: 0 }, 250, { delay: t })
            tween(sp.position, { y: sp.position.y - this.S }, 250, { delay: t, onDone: () => sp.destroy() })
          }
          break
        }
        // ---- ローグライク拡張（ROGUE.md §3/§5/§6）：フック・敵・ターン・環境 ----
        case 'token-spawn': {
          this.makeSporeTokenSprite(e.at.x, e.at.y, t)
          this.floatLabelFx(e.at, '＋胞子', 0xbfe8ff, t, -0.3) // 可視化第一波③：因果の実況（生成系の無言解消）
          break
        }
        case 'token-consumed': {
          const k = this.key(e.at.x, e.at.y)
          const node = this.sporeTokenG.get(k)
          if (node) {
            this.sporeTokenG.delete(k)
            tween(node.scale, { x: 0, y: 0 }, 150, {
              delay: t,
              ease: easeInCubic,
              onDone: () => {
                if (!node.destroyed) node.destroy()
              },
            })
          }
          break
        }
        case 'explode': {
          for (const p of e.cells) this.popPieceAt(p, t, true)
          // 十字(通常5マス以下)か3x3(共振破砕)かをcells数から推定し、規模で見た目/揺れを変える
          const big = e.cells.length >= 6
          this.explodeFx(e.at, t, big)
          delay(t, () => buzz('blast'))
          this.shakeRootDecay(t, big ? 4 : 2.5, big ? 160 : 120)
          t += hitstop.request(t, 30) // 爆発鉱石：30msヒットストップ
          t += 200
          break
        }
        case 'gear-trigger': {
          this.gearRingFx(e.at, t)
          this.floatLabelFx(e.at, `起動 x${e.count}`, 0xe8b33c, t, -0.28) // 可視化第一波③：ギアチャージ/起動の実況
          break
        }
        case 'upgrade-fire': {
          // 可視化第一波②：発動アピール。同一タイムラインで多発する場合はラベルは最初の2回まで（うるささ対策）
          const n = (upgradeFireCounts.get(e.id) ?? 0) + 1
          upgradeFireCounts.set(e.id, n)
          if (n <= 2) {
            this.floatLabelFx(e.at, UPGRADE_NAME.get(e.id) ?? e.id, 0xf2c14e, t)
            this.upgradeFlashFx(e.at, t)
          }
          const id = e.id
          const src = { ...e.at }
          delay(t, () => this.onUpgradeFire?.(id, src)) // バー側のバウンス演出は毎回（アイコンは常に反応させる）
          break
        }
        case 'obstacle-spawn': {
          this.popPieceAt(e.at, t, true)
          const ep = this.epoch
          delay(t + 60, () => {
            if (ep !== this.epoch) return
            this.makeBlock(e.at.x, e.at.y)
          })
          t += 150
          break
        }
        case 'enemy-damage': {
          this.enemyDamageFx(e.id, e.amount, e.hpLeft, t)
          break
        }
        case 'enemy-defeated': {
          const swarmInfo = swarmChain.get(ei)
          this.enemyDefeatedFx(e.id, e.cells, t, swarmInfo)
          if (swarmInfo && swarmInfo.total > 1) {
            // swarmドミノ：連鎖ごとに20ms短縮し80msを下限。最後の1体だけ50msヒットストップ
            if (swarmInfo.pos === swarmInfo.total) t += hitstop.request(t, 50)
            t += Math.max(80, 160 - (swarmInfo.pos - 1) * 20)
          } else {
            t += 200
          }
          break
        }
        case 'armor-applied': {
          // 可視化第一波①：予告（バッジ強発光）→実行（甲殻オーバーレイ）の順
          this.flashIntentBadge(e.id, t)
          this.makeArmorOverlay(e.at.x, e.at.y, t + 120)
          this.causeLineFx(e.id, e.at, 0xc7ccd2, t + 100) // 可視化第二波③：どの敵がやったかの因果線
          if (disruptLabelCount < 2) {
            disruptLabelCount++
            this.floatLabelFx(e.at, 'かたくなった！', 0xd8d2c2, t + 160)
          }
          t += 320
          break
        }
        case 'armor-broken': {
          const k = this.key(e.at.x, e.at.y)
          const g = this.armorG.get(k)
          if (g) {
            this.armorG.delete(k)
            tween(g, { alpha: 0 }, 150, {
              delay: t,
              onDone: () => {
                if (!g.destroyed) g.destroy()
              },
            })
          }
          this.flashFx(e.at, t)
          break
        }
        case 'prey-marked': {
          this.flashIntentBadge(e.id, t) // 可視化第一波①：予告→実行
          this.makePreyOverlay(e.at.x, e.at.y, t + 120)
          this.causeLineFx(e.id, e.at, 0xb98be0, t + 100) // 可視化第二波③：因果線
          if (disruptLabelCount < 2) {
            disruptLabelCount++
            this.floatLabelFx(e.at, 'ねらわれた！', 0xb98be0, t + 160)
          }
          t += 320
          break
        }
        case 'prey-devoured': {
          this.clearPreyOverlay(e.at)
          this.violetBurstFx(e.at, t)
          this.popPieceAt(e.at, t)
          t += 200
          break
        }
        case 'prey-escaped': {
          this.clearPreyOverlay(e.at)
          this.floatLabelFx(e.at, 'おいはらった！', 0xf2c96a, t + 60)
          break
        }
        case 'fissure-telegraph': {
          this.flashIntentBadge(e.id, t)
          this.makeFissureFrame(e.id, e.cells, t)
          if (disruptLabelCount < 2) {
            disruptLabelCount++
            this.floatLabelFx(e.cells[0], '崩落の予兆', 0xcbb28a, t + 160)
          }
          t += 240
          break
        }
        case 'fissure-averted': {
          this.clearFissureFrame(e.id)
          break
        }
        case 'oxygen-drained': {
          this.flashIntentBadge(e.id, t)
          this.enemyAttackTelegraphFx(e.id, t)
          if (disruptLabelCount < 2) {
            disruptLabelCount++
            const cells = this.enemyCellsCache.get(e.id)
            if (cells?.length) {
              const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
              const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
              this.floatLabelFx({ x: cx, y: cy }, `灯を奪われた −${e.amount}`, 0xff6b5a, t + 100, -0.25)
            }
          }
          delay(t, () => this.onOxygenDrained?.(e.id, e.amount))
          t += 260
          break
        }
        case 'cell-sealed': {
          this.flashIntentBadge(e.id, t) // 可視化第一波①：予告→実行
          const g = this.makeSealBlock(e.at.x, e.at.y)
          g.scale.set(0)
          tween(g.scale, { x: 1, y: 1 }, 220, { delay: t + 120, ease: easeOutBack })
          this.causeLineFx(e.id, e.at, 0xcbb28a, t + 100) // 可視化第二波③：因果線
          if (disruptLabelCount < 2) {
            disruptLabelCount++
            this.floatLabelFx(e.at, 'ふさがれた！', 0xcbb28a, t + 160)
          }
          t += 340
          break
        }
        case 'cell-unsealed': {
          const k = this.key(e.at.x, e.at.y)
          const g = this.blockG.get(k)
          if (g && !g.destroyed) {
            this.blockG.delete(k)
            tween(g.scale, { x: 0, y: 0 }, 160, {
              delay: t,
              ease: easeInCubic,
              onDone: () => {
                if (!g.destroyed) g.destroy()
              },
            })
          }
          break
        }
        case 'boss-shell-broken': {
          this.shakeContainer(this.root, t)
          this.paintBossGauge()
          t += 160
          break
        }
        case 'boss-phase': {
          // 身体1行ぶんのコンテナと顔をまとめて畳み、reconcile で残り2セルを描き直す
          const row = this.bossRowG.get(H - 1)
          if (row && !row.destroyed) tween(row, { alpha: 0 }, 220, { delay: t })
          this.shakeRootDecay(t + 60, 6, 220)
          delay(t + 240, () => this.reconcile())
          t += 300
          break
        }
        // 酸素の増減・層クリア・遭難：ビューでは何もしない（HUDと層進行は main.ts の管轄）
        case 'oxygen-spent':
        case 'oxygen-refill':
        case 'last-light':
        case 'floor-clear':
        case 'run-over':
          break
      }
    }
    const total = t + T.pop + T.fall
    // 可視化第一波①：敵の残りターン表示は「エンジン確定後」の値を見せたいのでタイムライン終端で更新
    const ep = this.epoch
    delay(total, () => {
      if (ep !== this.epoch) return
      this.updateIntentBadges()
    })
    this.fadeChainCounter(total + 120) // 連鎖数表示は次の一手までに消す
    delay(total + 200, () => {
      if (ep === this.epoch) this.rampageActive = false // 暴走時フラグは手の終端で解除
    })
    // タイムライン終端で必ず照合修復：稀な競合で残る位置ズレ/孤児を吸収し、描画=エンジンを保証
    delay(total + 200, () => this.reconcile())
    return total
  }

  /** エンジン状態への収束（差分だけ直すので通常は何も起きない） */
  reconcile() {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = this.key(x, y)
        const c = this.board.at(x, y)
        const want = c && !c.block ? c.piece : null
        const sp = this.sprites.get(k)
        if (!want) {
          if (sp) {
            this.sprites.delete(k)
            if (!sp.destroyed) sp.destroy()
          }
          continue
        }
        if (!sp || sp.destroyed || (sp as unknown as { __kind: string }).__kind !== pieceKey(want)) {
          if (sp && !sp.destroyed) sp.destroy()
          this.sprites.delete(k)
          this.makePiece(x, y, want)
        } else {
          // 位置・透明度・スケールをセル定位置へスナップ
          sp.position.set(this.px(x), this.px(y))
          sp.alpha = 1
          const b = this.bs(sp)
          sp.scale.set(b)
          if (want.kind !== 'harpoon') sp.rotation = 0
        }
      }
    // mapに居ない可視孤児を掃除
    const mapped = new Set(this.sprites.values())
    for (const ch of [...this.pieceLayer.children]) {
      if (!mapped.has(ch as Sprite) && !ch.destroyed) ch.destroy()
    }
    // 障害物・蔦苔の帳簿も照合（レベル遷移コールバック等の取りこぼし保険）
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const k = this.key(x, y)
        const c = this.board.at(x, y)
        const bg = this.blockG.get(k)
        if (c?.block && (!bg || bg.destroyed)) {
          if (bg) this.blockG.delete(k)
          this.makeBlock(x, y)
        } else if (!c?.block && bg) {
          this.blockG.delete(k)
          if (!bg.destroyed) bg.destroy()
        }
        const gg = this.groundG.get(k)
        const groundWant = c?.ground ?? 0
        if (groundWant > 0 && (!gg || gg.destroyed)) {
          if (gg) this.groundG.delete(k)
          this.makeGround(x, y, groundWant as 1 | 2)
        } else if (groundWant === 0 && gg) {
          this.groundG.delete(k)
          if (!gg.destroyed) gg.destroy()
        }
        // ローグ拡張：胞子トークン・甲殻・毒胞子オーバーレイの帳簿照合
        const wantToken = c?.sporeToken === true
        const tk = this.sporeTokenG.get(k)
        if (wantToken && (!tk || tk.destroyed)) {
          if (tk) this.sporeTokenG.delete(k)
          this.makeSporeTokenSprite(x, y, 0)
        } else if (!wantToken && tk) {
          this.sporeTokenG.delete(k)
          if (!tk.destroyed) tk.destroy()
        }
        const wantArmor = c?.armored === true
        const ag = this.armorG.get(k)
        if (wantArmor && (!ag || ag.destroyed)) {
          if (ag) this.armorG.delete(k)
          this.makeArmorOverlay(x, y, 0)
        } else if (!wantArmor && ag) {
          this.armorG.delete(k)
          if (!ag.destroyed) ag.destroy()
        }
        const wantPrey = c?.preyMark === true
        const pg = this.preyG.get(k)
        if (wantPrey && (!pg || pg.destroyed)) {
          if (pg) this.preyG.delete(k)
          this.makePreyOverlay(x, y, 0)
        } else if (!wantPrey && pg) {
          this.preyG.delete(k)
          if (!pg.destroyed) pg.destroy()
        }
        // 可視化第一波③：爆発鉱石の常時発光も同様に帳簿照合
        const wantVolatile = c?.piece?.kind === 'normal' && c.piece.volatile === true
        const vg = this.volatileG.get(k)
        if (wantVolatile && (!vg || vg.destroyed)) {
          if (vg) this.volatileG.delete(k)
          this.makeVolatileOverlay(x, y, 0)
        } else if (!wantVolatile && vg) {
          this.volatileG.delete(k)
          if (!vg.destroyed) vg.destroy()
        }
      }
    // 敵ブロック（岩殻獣/胞子獣/穴潜み）：帳簿はblock照合ループ（上）でmakeBlock経由に自己修復済み。
    // ここではHPバー・メタ情報・座標キャッシュを最新化する（enemy-damage等の座標なしイベント用）
    for (const en of this.board.enemies) {
      if (en.kind === 'boss') continue
      this.enemyMeta.set(en.id, { kind: en.kind, maxHp: en.maxHp })
      this.enemyCellsCache.set(
        en.id,
        en.cells.map((p) => ({ ...p })),
      )
      const cell = en.cells[0]
      if (cell) {
        const g = this.blockG.get(this.key(cell.x, cell.y))
        if (g && !g.destroyed) this.paintHpBar(g, en.hp, en.maxHp)
      }
    }
    // 予告枠：telegraph を持つ敵ぶんだけ残す（裂坑掘りの2x2／綴じ蟲の列／奈落の喉の次の相。同じ帳簿照合）
    const wantFissure = new Set<number>()
    for (const en of this.board.enemies) {
      if (!en.telegraph) continue
      wantFissure.add(en.id)
      const fg = this.fissureG.get(en.id)
      if (!fg || fg.destroyed) this.makeFissureFrame(en.id, en.telegraph, 0)
    }
    for (const id of [...this.fissureG.keys()]) if (!wantFissure.has(id)) this.clearFissureFrame(id)
    // ボスの顔（目+HPバー）オーバーレイ：不在なら片付け、居るのに欠けていれば再生成・位置とHPを同期
    const boss = this.board.enemies.find((en) => en.kind === 'boss')
    if (boss) {
      this.enemyMeta.set(boss.id, { kind: 'boss', maxHp: boss.maxHp })
      this.enemyCellsCache.set(
        boss.id,
        boss.cells.map((p) => ({ ...p })),
      )
      this.bossId = boss.id
      const face = this.bossFaceG.get(boss.id) as BossFaceHost | undefined
      const xs = boss.cells.map((c) => c.x)
      const span = `${Math.min(...xs)},${Math.max(...xs)},${boss.bossPhase}`
      if (!face || face.destroyed || face.__bossSpan !== span) {
        // 身体セル範囲や段階が変わったら作り直す（縮んだ身体に対して古い幅のゲージが残らない）
        this.makeBossFace(boss)
      } else {
        face.position.set(0, (H - 1) * this.S)
        this.paintBossGauge()
        this.blockLayer.addChild(face) // 顔は常に身体の前へ（匣の再構築で背面に潜らせない）
      }
    } else {
      for (const face of this.bossFaceG.values()) if (!face.destroyed) face.destroy()
      this.bossFaceG.clear()
      this.bossId = null
    }
    this.updateIntentBadges() // 可視化第一波①：撃破・生成の取りこぼしをここでも吸収
  }

  private popPieceAt(p: XY, t: number, byFire = false, sparkSkipChance = 0) {
    const k = this.key(p.x, p.y)
    const sp = this.sprites.get(k)
    if (!sp) return
    this.sprites.delete(k)
    this.clearVolatileOverlay(p, t) // 可視化第一波③：爆発鉱石の常時発光を破壊タイミングで片付ける
    // 膨張62ms→ホールド28ms→弾け88ms の3段（合計178ms ≤ T.pop）。「溜めてから弾ける」を作る
    const b = this.bs(sp)
    tween(sp.scale, { x: b * 1.28, y: b * 1.28 }, 62, { delay: t, ease: easeOutBackSoft })
    tween(sp.scale, { x: 0, y: 0 }, 88, { delay: t + 90, ease: easeInCubic })
    tween(sp, { alpha: byFire ? 0.35 : 0 }, 84, { delay: t + 90, onDone: () => sp.destroy() })
    this.sparkFx(p, t + 88, sparkSkipChance) // 火花は「弾けた瞬間」に出す
  }

  /** 通常消去の火花。skipChance>0 なら1粒ずつ確率的に間引く（10連鎖以降の負荷対策。codex_consult [D]-3） */
  private sparkFx(p: XY, t: number, skipChance = 0) {
    delay(t, () => {
      if (skipChance > 0 && this.rnd() < skipChance) return
      for (let i = 0; i < 6; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.circle(0, 0, 2.4).fill(0xfff2c8)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.4 + this.rnd() * 0.5)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 320, { ease: easeOutCubic, channel: 'fx' })
        tween(g, { alpha: 0 }, 320, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
  }

  private debrisFx(p: XY, t: number, color: number) {
    delay(t, () => {
      for (let i = 0; i < 8; i++) {
        const g = this.acquireG(this.overFxLayer)
        g.roundRect(-3, -3, 6, 6, 1.5).fill(color)
        g.position.set(this.px(p.x), this.px(p.y))
        const a = this.rnd() * Math.PI * 2
        const d = this.S * (0.5 + this.rnd() * 0.7)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d + this.S * 0.4 }, 420, {
          ease: easeOutCubic,
          channel: 'fx',
        })
        tween(g, { alpha: 0, rotation: (this.rnd() - 0.5) * 4 }, 420, { channel: 'fx', onDone: () => this.releaseG(g) })
      }
    })
  }

  /** 特殊駒ごとの発動演出 */
  private fireFx(at: XY, piece: Piece, t: number) {
    const S = this.S
    if (piece.kind === 'harpoon') {
      // 行/列を走る光のスイープ
      delay(t, () => {
        const g = new Graphics()
        if (piece.dir === 'h') {
          g.roundRect(-S * 0.2, -S * 0.28, W * S + S * 0.4, S * 0.56, S * 0.28).fill({ color: 0xfff1c4, alpha: 0.85 })
          g.position.set(0, this.px(at.y) - 0)
          g.pivot.set(0, 0)
          g.y = this.px(at.y)
          g.x = 0
          g.scale.x = 0.05
          this.fxLayer.addChild(g)
          tween(g.scale, { x: 1 }, 160, { ease: easeOutCubic })
        } else {
          g.roundRect(-S * 0.28, -S * 0.2, S * 0.56, H * S + S * 0.4, S * 0.28).fill({ color: 0xfff1c4, alpha: 0.85 })
          this.fxLayer.addChild(g)
          g.x = this.px(at.x)
          g.y = 0
          g.scale.y = 0.05
          tween(g.scale, { y: 1 }, 160, { ease: easeOutCubic })
        }
        tween(g, { alpha: 0 }, 260, { delay: 120, onDone: () => g.destroy() })
      })
    } else if (piece.kind === 'hitsubo') {
      // 歯車爆弾：3層爆発（爆発鉱石と共通実装だが色/規模を変えて別物にする）＋広域の衝撃波スイープ
      this.layeredExplosionFx(at, t, {
        big: true,
        sparkColor: 0xfff1c4,
        coreColor: 0xffc978,
        ringColor: 0xffc978,
        chunkColor: 0x8a7048,
        sparkCount: 22,
        chunkCount: 10,
        smokeCount: 5,
        ringMaxScale: 2.8,
      })
      delay(t, () => {
        const ring = new Graphics()
        ring.circle(0, 0, S * 0.5).stroke({ width: S * 0.16, color: 0xffc978, alpha: 0.9 })
        ring.position.set(this.px(at.x), this.px(at.y))
        this.overFxLayer.addChild(ring)
        tween(ring.scale, { x: 5.2, y: 5.2 }, 340, { ease: easeOutCubic, channel: 'fx' })
        tween(ring, { alpha: 0 }, 340, {
          channel: 'fx',
          onDone: () => {
            if (!ring.destroyed) ring.destroy()
          },
        })
      })
    } else if (piece.kind === 'seiju') {
      // ランタンの虹色放射
      delay(t, () => {
        const colors = [0xf7b1a0, 0xf7e3a0, 0xb9e6a8, 0xa8cdf0, 0xd7b5ec]
        for (let i = 0; i < 10; i++) {
          const ray = new Graphics()
          ray.roundRect(0, -S * 0.09, S * 3.4, S * 0.18, S * 0.09).fill({ color: colors[i % colors.length], alpha: 0.8 })
          ray.position.set(this.px(at.x), this.px(at.y))
          ray.rotation = (i / 10) * Math.PI * 2
          ray.scale.set(0.1, 1)
          this.fxLayer.addChild(ray)
          tween(ray.scale, { x: 1 }, 300, { ease: easeOutCubic })
          tween(ray, { alpha: 0 }, 420, { delay: 140, onDone: () => ray.destroy() })
        }
      })
      this.flashFx(at, t)
    } else {
      this.flashFx(at, t)
    }
  }

  /** 画面上部からセルへ飛ぶ白い彗星（勝利ドレイン用） */
  private cometFx(p: XY, t: number) {
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.14).fill({ color: 0xfff6d8, alpha: 0.95 })
      g.circle(-this.S * 0.18, 0, this.S * 0.08).fill({ color: 0xfff6d8, alpha: 0.4 })
      g.position.set(this.px(p.x) * 0.3 - this.S, -this.S * 1.2)
      this.fxLayer.addChild(g)
      tween(g.position, { x: this.px(p.x), y: this.px(p.y) }, 260, { ease: easeOutCubic })
      tween(g, { alpha: 0 }, 300, { delay: 180, onDone: () => g.destroy() })
    })
  }

  private flashFx(p: XY, t: number) {
    delay(t, () => {
      const g = new Graphics()
      g.circle(0, 0, this.S * 0.2).fill({ color: 0xffffff, alpha: 0.9 })
      g.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(g)
      tween(g.scale, { x: 5, y: 5 }, 300, { ease: easeOutCubic })
      tween(g, { alpha: 0 }, 300, { onDone: () => g.destroy() })
    })
  }
}
