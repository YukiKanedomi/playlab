// 盤面ビュー：エンジンのイベント列をタイムライン化して描く。
// 方針: ロジックは即時確定・ビューが追いかける。入力割込時は snap で追いつく。
// タイミングは RESEARCH.md §5 実測値。
import { Container, Graphics, Sprite, Renderer, Text } from 'pixi.js'
import { Board, W, H } from '../core/board'
import type { BoardEvent, EnemyKind, Piece, XY } from '../core/types'
import type { EnemyInstance } from '../core/enemies'
import { turnsUntilAction } from '../core/enemies'
import * as EnemiesCore from '../core/enemies' // 可視化第二波②：enemyIntent は並行実装中。名前空間importで未着でもビルドを壊さない
import { UPGRADES } from '../core/upgrades'
import { PAL, pieceKey, pieceTexture, spriteTexture } from './pieces'
import { completeAll, delay, easeInCubic, easeOutBack, easeOutCubic, tween } from '../juice/tween'
import { sfx } from '../juice/sound'

// ローグ拡張（ROGUE.md §5）：ダメージ数字は既存UI（main.ts）と合わせ明朝体
const FONT = '"Shippori Mincho", serif'
// 敵ブロック・ボスの顔に HP バーの描画位置を焼き込むための拡張タグ（pieces.ts の __base 流儀に倣う）
type HpHost = Container & { __hpFill?: Graphics; __hpGeom?: { x: number; y: number; w: number; h: number } }

// 可視化第一波②：強化発動アピールのラベルに使う名前引き（idはupgrades.tsのUpgradeDef.idと一致）
const UPGRADE_NAME = new Map(UPGRADES.map((u) => [u.id, u.name]))

// 可視化第一波①：敵タップ・ツールチップの文言。可視化第二波②：core側で妨害/攻撃の交互行動が入ったため文言更新＋swarm追加。
// core が今後さらに敵種を増やしても即座にビルドが壊れないよう Partial にし、未知の種は showEnemyTooltip 側で汎用文言にフォールバックする
const ENEMY_INFO: Partial<Record<EnemyKind, { name: string; desc: string }>> = {
  rockshell: { name: '岩殻獣', desc: '妨害と攻撃を交互に行う。妨害では鉱物ひとつに甲殻をまとわせ、攻撃では探窟隊にダメージ' },
  sporeling: { name: '胞子獣', desc: '妨害と攻撃を交互に行う。妨害では植物ひとつを毒胞子に変え、攻撃では探窟隊にダメージ' },
  burrower: { name: '穴潜み', desc: '妨害と攻撃を交互に行う。妨害では空きマスを2手ふさいで自分は別マスへ移り、攻撃では探窟隊にダメージ' },
  swarm: { name: 'サンドバッグ', desc: '妨害を持たない攻撃専業。1体倒すと隣接する仲間にもダメージが伝わり連鎖しやすい' },
  boss: { name: '巨大深層生物', desc: '3手ごとに探窟隊全体を打つ。ダメージで後退する' },
}

// 可視化第二波②：敵の予告（攻撃/妨害）。core側の enemyIntent（enemies.ts export）が並行実装中のため、
// 名前空間importを any 経由で覗く防御的な参照にする（未着の間は undefined のまま turnsUntilAction にフォールバック）
type EnemyIntent = { kind: 'attack' | 'disrupt'; damage?: number; turns: number }
const enemyIntentFn = (EnemiesCore as unknown as { enemyIntent?: (e: EnemyInstance) => EnemyIntent }).enemyIntent

// juice 実測値テーブル（ms）
export const T = {
  swap: 130,
  pop: 200, // 消滅ポップ 170-230
  blockHit: 300, // 箱破壊 270-330
  fall: 380, // 落下 330-430
  chainBeat: 650, // 連鎖ビート 600-800
  specialBorn: 240,
} as const

export class BoardView {
  root = new Container()
  cellLayer = new Container()
  groundLayer = new Container()
  blockLayer = new Container()
  pieceLayer = new Container()
  fxLayer = new Container()
  S: number
  sprites = new Map<string, Sprite>() // "x,y" -> 駒スプライト
  blockG = new Map<string, Container>()
  groundG = new Map<string, Container>()
  busyUntil = 0 // タイムライン終端（ms, performance.now 基準）
  private drainCount = 0 // 勝利ドレインSEのピッチ段数
  private epoch = 0 // レベル遷移の世代。跨いだ遅延コールバックは無効化する

  // ---- ローグライク拡張（ROGUE.md §5）：敵・環境オーバーレイの帳簿 ----
  private armorG = new Map<string, Graphics>() // "x,y" -> 甲殻オーバーレイ
  private poisonG = new Map<string, Graphics>() // "x,y" -> 毒胞子オーバーレイ
  private sporeTokenG = new Map<string, Container>() // "x,y" -> 胞子トークン（既存 spore 駒とは別物）
  private bossRowG = new Map<number, Container>() // row(y) -> ボス身体1行ぶんの連結コンテナ
  private bossFaceG = new Map<number, Container>() // enemyId -> ボスの目+HPバー（前線行に追従）
  private bossId: number | null = null
  private enemyMeta = new Map<number, { kind: EnemyKind; maxHp: number }>() // 撃破後も参照できるよう種別/最大HPを保持
  private enemyCellsCache = new Map<number, XY[]>() // 直近の敵セル座標（enemy-damage等、座標を持たないイベント用）

  // ---- 可視化第一波：敵インテント・爆発鉱石の常時発光の帳簿 ----
  private intentG = new Map<number, Container>() // enemyId -> インテントバッジ（fxLayer・セル内右上）
  private volatileG = new Map<string, Graphics>() // "x,y" -> 爆発鉱石の常時ゆらぎオーバーレイ
  private tooltipG: Container | null = null // 敵タップの説明ツールチップ（同時に1個のみ）

  /** 所持強化バーへの発動アピール通知（main.ts が購読してアイコンをバウンスさせる。可視化第一波②） */
  onUpgradeFire?: (id: string) => void
  /** 敵の攻撃通知（main.ts が購読して探窟隊HUDへの軌跡＋被弾演出を鳴らす。可視化第二波②） */
  onEnemyAttack?: (enemyId: number, damage: number) => void

  constructor(
    public board: Board,
    public renderer: Renderer,
    size: number,
  ) {
    this.S = Math.floor(size / W)
    this.root.addChild(this.cellLayer, this.groundLayer, this.blockLayer, this.pieceLayer, this.fxLayer)
    this.drawStatic()
    this.syncAll()
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
    for (const g of this.poisonG.values()) if (!g.destroyed) g.destroy()
    this.poisonG.clear()
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
    for (const g of this.intentG.values()) if (!g.destroyed) g.destroy()
    this.intentG.clear()
    if (this.tooltipG && !this.tooltipG.destroyed) this.tooltipG.destroy()
    this.tooltipG = null
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.board.at(x, y)
        if (!c) continue
        if (c.ground > 0) this.makeGround(x, y, c.ground as 1 | 2)
        if (c.block) this.makeBlock(x, y)
        if (c.piece) this.makePiece(x, y, c.piece)
        if (c.armored) this.makeArmorOverlay(x, y, 0)
        if (c.poisonSpore) this.makePoisonOverlay(x, y, 0)
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
      // 小型胞子虫（ROGUE2.md 第3波）。次のターンに殴ってくるときだけ「怒り顔」差分に切り替える
      const soon = (enemyIntentFn?.(enemy)?.turns ?? turnsUntilAction(enemy)) <= 1
      const tex = spriteTexture(soon ? 'e_swarm_angry' : 'e_swarm') ?? spriteTexture('e_swarm')
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
    } else {
      // 穴潜み：暗い穴（同心円）＋二つ目
      const g = new Graphics()
      g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0x0b0d10, alpha: 0.92 })
      g.circle(S / 2, S / 2, S * 0.29).fill({ color: 0x1c2128, alpha: 0.92 })
      g.circle(S / 2, S / 2, S * 0.15).fill({ color: 0x2c333b, alpha: 0.85 })
      wrap.addChild(g)
      const eyes = new Graphics()
      this.drawEye(eyes, S / 2 - S * 0.14, S * 0.44, S * 0.09, 0xdff0ff)
      this.drawEye(eyes, S / 2 + S * 0.14, S * 0.44, S * 0.09, 0xdff0ff)
      wrap.addChild(eyes)
    }
    // HP1の小型胞子虫はバーが常に満タンで意味を成さないため出さない（画面のノイズを減らす）
    if (enemy.maxHp > 1) this.attachHpBar(wrap, enemy.hp, enemy.maxHp, S * 0.72, S * 0.1, (S - S * 0.72) / 2, S * 0.06)
    // 可視化第一波①：敵セルのタップで名前+行動の説明ツールチップ（スワップ対象にならないセルなので入力系と衝突しない）
    wrap.eventMode = 'static'
    wrap.cursor = 'pointer'
    wrap.hitArea = { contains: (lx: number, ly: number) => lx >= 0 && lx <= S && ly >= 0 && ly <= S }
    wrap.on('pointertap', () => this.showEnemyTooltip(enemy.kind, x, y))
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
    if (y === enemy.bossFrontRow && (!this.bossFaceG.get(enemy.id) || this.bossFaceG.get(enemy.id)!.destroyed)) {
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
    const face = new Container()
    face.position.set(0, boss.bossFrontRow * S)
    const eye = new Graphics()
    this.drawEye(eye, (W * S) / 2, S * 0.5, S * 0.34, 0xe86a4a)
    face.addChild(eye)
    const w = W * S * 0.5
    this.attachHpBar(face, boss.hp, boss.maxHp, w, S * 0.14, (W * S - w) / 2, S * 0.06)
    // 可視化第一波①：ボスの顔もタップでツールチップ
    face.eventMode = 'static'
    face.cursor = 'pointer'
    face.hitArea = { contains: (lx: number, ly: number) => lx >= 0 && lx <= W * S && ly >= 0 && ly <= S }
    face.on('pointertap', () => this.showEnemyTooltip('boss', W - 1, boss.bossFrontRow))
    this.blockLayer.addChild(face)
    this.bossFaceG.set(boss.id, face)
  }

  /** 穴潜みの封鎖セル：暗い蓋＋X字 */
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

  /** 胞子獣が毒胞子化した駒の紫の靄オーバーレイ（ROGUE.md §5） */
  private makePoisonOverlay(x: number, y: number, t: number) {
    const k = this.key(x, y)
    const old = this.poisonG.get(k)
    if (old) {
      this.poisonG.delete(k)
      if (!old.destroyed) old.destroy()
    }
    const S = this.S
    const g = new Graphics()
    g.circle(S / 2, S / 2, S * 0.44).fill({ color: 0x8b5fc8, alpha: 0.26 })
    g.circle(S / 2, S / 2, S * 0.44).stroke({ width: S * 0.035, color: 0xb98be0, alpha: 0.6 })
    g.position.set(x * S, y * S)
    g.alpha = 0
    this.fxLayer.addChild(g)
    this.poisonG.set(k, g)
    tween(g, { alpha: 1 }, 200, { delay: t })
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
      this.fxLayer.addChild(txt)
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

  /** enemy-defeated：潰れて消えるポップ＋粒（ボスは行コンテナ＋顔も片付ける） */
  private enemyDefeatedFx(id: number, cells: XY[], t: number) {
    const meta = this.enemyMeta.get(id)
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
    for (const p of cells) this.debrisFx(p, t, 0xd9c9a8)
    this.enemyMeta.delete(id)
    this.enemyCellsCache.delete(id)
  }

  /** 爆発鉱石：橙のフラッシュ円＋破片粒（既存 debrisFx を流用） */
  private explodeFx(p: XY, t: number) {
    delay(t, () => {
      const ring = new Graphics()
      ring.circle(0, 0, this.S * 0.3).fill({ color: 0xff8a3d, alpha: 0.85 })
      ring.position.set(this.px(p.x), this.px(p.y))
      this.fxLayer.addChild(ring)
      tween(ring.scale, { x: 2.6, y: 2.6 }, 260, { ease: easeOutCubic })
      tween(ring, { alpha: 0 }, 260, { onDone: () => ring.destroy() })
    })
    this.debrisFx(p, t, 0xff8a3d)
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

  /** 毒胞子発動：紫の小バースト */
  private violetBurstFx(p: XY, t: number) {
    delay(t, () => {
      for (let i = 0; i < 6; i++) {
        const g = new Graphics()
        g.circle(0, 0, 2.6).fill(0xb98be0)
        g.position.set(this.px(p.x), this.px(p.y))
        this.fxLayer.addChild(g)
        const a = Math.random() * Math.PI * 2
        const d = this.S * (0.35 + Math.random() * 0.45)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 300, { ease: easeOutCubic })
        tween(g, { alpha: 0 }, 300, { onDone: () => g.destroy() })
      }
    })
  }

  /** 環境効果の自然増殖：緑/青の芽吹きキラ */
  private envGrowFx(p: XY, kind: 'plant' | 'mineral', t: number) {
    delay(t, () => {
      const color = kind === 'plant' ? 0x8fb05a : 0x6fb6e8
      for (let i = 0; i < 5; i++) {
        const g = new Graphics()
        g.circle(0, 0, 2.6).fill(color)
        g.position.set(this.px(p.x), this.px(p.y))
        this.fxLayer.addChild(g)
        const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.6
        const d = this.S * (0.3 + Math.random() * 0.4)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 380, { ease: easeOutCubic })
        tween(g, { alpha: 0 }, 380, { onDone: () => g.destroy() })
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

  private drawIntentIcon(g: Graphics, kind: EnemyKind, r: number) {
    const col = 0xf4e8cf
    if (kind === 'rockshell') {
      // 盾形（甲殻付与の予告）
      g.moveTo(0, -r)
        .lineTo(r * 0.82, -r * 0.4)
        .lineTo(r * 0.82, r * 0.28)
        .lineTo(0, r)
        .lineTo(-r * 0.82, r * 0.28)
        .lineTo(-r * 0.82, -r * 0.4)
        .closePath()
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'sporeling') {
      // 雫形（毒胞子化の予告）
      g.moveTo(0, -r)
        .bezierCurveTo(r * 0.8, r * 0.15, r * 0.62, r, 0, r)
        .bezierCurveTo(-r * 0.62, r, -r * 0.8, r * 0.15, 0, -r)
        .fill({ color: col, alpha: 0.92 })
    } else if (kind === 'burrower') {
      // X形（封鎖の予告）
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
    } else if (kind === 'boss') {
      // 衝撃波形（ボスの全体攻撃の予告。enemyIntent未着時のフォールバック表示にも使う）
      g.arc(0, r * 0.25, r * 0.55, Math.PI * 1.15, Math.PI * 1.85).stroke({ width: r * 0.22, color: col, alpha: 0.92 })
      g.arc(0, r * 0.25, r * 1.0, Math.PI * 1.2, Math.PI * 1.8).stroke({ width: r * 0.16, color: col, alpha: 0.7 })
    } else {
      // 汎用フォールバック（swarm等・enemyIntent未着で攻撃/妨害の別が分からない新種）：小粒3つ
      for (const [dx, dy] of [
        [-r * 0.55, r * 0.25],
        [r * 0.55, r * 0.25],
        [0, -r * 0.55],
      ])
        g.circle(dx, dy, r * 0.32).fill({ color: col, alpha: 0.92 })
    }
  }

  /** 可視化第二波②：攻撃予告アイコン（斜めの刀身＋鍔）。妨害系より強く目立たせるため専用に描く */
  private drawSwordIcon(g: Graphics, r: number) {
    const blade = 0xfff1e4
    g.moveTo(-r * 0.72, r * 0.82).lineTo(r * 0.58, -r * 0.78).stroke({ width: r * 0.26, color: blade })
    g.moveTo(r * 0.58, -r * 0.78)
      .lineTo(r * 0.22, -r * 0.3)
      .lineTo(r * 0.84, -r * 0.46)
      .closePath()
      .fill(blade) // 切先
    g.moveTo(-r * 0.18, r * 0.32).lineTo(r * 0.32, -r * 0.18).stroke({ width: r * 0.24, color: 0xe0503a }) // 鍔
  }

  /** 1体ぶんのバッジを再描画（新規なら生成）。位置は敵セル内側の右上隅に収め、駒には絶対にかぶらない */
  private paintIntentBadge(en: EnemyInstance) {
    const S = this.S
    let cellX: number
    let cellY: number
    if (en.kind === 'boss') {
      cellX = W - 1 // ボスは全幅を占有するため、前線行の右端セルに代表させる
      cellY = en.bossFrontRow
    } else {
      const c = en.cells[0]
      if (!c) return
      cellX = c.x
      cellY = c.y
    }
    let host = this.intentG.get(en.id)
    const isNew = !host || host.destroyed
    if (isNew) {
      host = new Container()
      this.fxLayer.addChild(host)
      this.intentG.set(en.id, host)
    }
    const h = host!
    h.removeChildren().forEach((c) => c.destroy())
    // 可視化第二波②：enemyIntent が来ていれば攻撃/妨害で描き分け。未着なら常に disrupt 扱い＝旧来の見た目のまま
    const intent = enemyIntentFn?.(en)
    const isAttack = intent?.kind === 'attack'
    const remaining = intent?.turns ?? turnsUntilAction(en)
    const bw = S * (isAttack ? 0.37 : 0.32) // 攻撃バッジは妨害よりわずかに大きく
    const inset = S * 0.08
    h.position.set(cellX * S + S - bw / 2 - inset, cellY * S + bw / 2 + inset)
    const bg = new Graphics()
    bg.circle(0, 0, bw / 2)
      .fill({ color: 0x1c1712, alpha: 0.86 })
      .stroke({ width: isAttack ? 2.1 : 1.4, color: isAttack ? 0xe0503a : 0xd9c9a0, alpha: isAttack ? 0.95 : 0.75 })
    h.addChild(bg)
    const icon = new Graphics()
    if (isAttack) this.drawSwordIcon(icon, bw * 0.32)
    else this.drawIntentIcon(icon, en.kind, bw * 0.3)
    icon.position.set(-bw * 0.16, -bw * 0.02)
    h.addChild(icon)
    // 攻撃バッジはダメージ数字、妨害バッジは従来どおり残りターン数を出す
    const numT = new Text({
      text: isAttack ? String(intent?.damage ?? '?') : String(remaining),
      style: { fill: isAttack ? 0xffcabb : 0xf4e8cf, fontSize: bw * (isAttack ? 0.46 : 0.5), fontFamily: FONT, fontWeight: 'bold' },
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

  /** 敵ブロック/ボスの顔タップ：名前+行動の説明を羊皮紙の小片で2.5秒表示 */
  private showEnemyTooltip(kind: EnemyKind, cellX: number, cellY: number) {
    if (this.tooltipG && !this.tooltipG.destroyed) this.tooltipG.destroy()
    const info = ENEMY_INFO[kind] ?? { name: kind, desc: '' } // core未着の新種でも汎用表示にフォールバック
    const S = this.S
    const w = Math.min(W * S * 0.86, S * 6.4) // 盤幅基準（Sは盤セル寸法でありビュー全体の比率には小さすぎるため）
    const name = new Text({ text: info.name, style: { fill: 0x4a3a24, fontSize: S * 0.32, fontFamily: FONT, fontWeight: 'bold' } })
    const desc = new Text({
      text: info.desc,
      style: { fill: 0x4a3a24, fontSize: S * 0.22, fontFamily: FONT, wordWrap: true, wordWrapWidth: w * 0.86, breakWords: true, align: 'center' },
    })
    const padY = S * 0.14
    const h = name.height + desc.height + padY * 3
    const box = new Container()
    const bg = new Graphics()
    bg.roundRect(-w / 2, -h / 2, w, h, h * 0.16)
      .fill({ color: 0xe8d9b0, alpha: 0.96 })
      .stroke({ width: 1.6, color: 0x8a6f45 })
    box.addChild(bg)
    name.anchor.set(0.5, 0)
    name.position.set(0, -h / 2 + padY)
    box.addChild(name)
    desc.anchor.set(0.5, 0)
    desc.position.set(0, -h / 2 + padY * 2 + name.height)
    box.addChild(desc)
    const px = Math.max(w / 2 + 2, Math.min(W * S - w / 2 - 2, this.px(cellX)))
    const py = Math.max(h / 2 + 2, this.px(cellY) - S * 0.78)
    box.position.set(px, py)
    box.alpha = 0
    this.fxLayer.addChild(box)
    this.tooltipG = box
    tween(box, { alpha: 1 }, 140)
    const ep = this.epoch
    delay(2500, () => {
      if (ep !== this.epoch || box.destroyed) return
      tween(box, { alpha: 0 }, 220, {
        onDone: () => {
          if (!box.destroyed) box.destroy()
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

  /** 小さな浮遊ラベル（明朝・小・上昇して消える）。token-spawn/gear-trigger/爆発鉱石変換/upgrade-fire で共用 */
  private floatLabelFx(p: XY, text: string, color: number, t: number, yOffset = -0.15) {
    delay(t, () => {
      const txt = new Text({
        text,
        style: { fill: color, fontSize: this.S * 0.2, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
      })
      txt.anchor.set(0.5)
      txt.position.set(this.px(p.x), this.px(p.y) + this.S * yOffset)
      this.fxLayer.addChild(txt)
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

  /** 可視化第二波②：敵の攻撃の起点（自セル上の赤い一瞬のバースト）。着弾側（探窟隊HUD）の演出は main.ts の onEnemyAttack が担う */
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

  // ---- イベント→タイムライン ----

  /** イベント列をアニメ予約。所要合計msを返す */
  play(evs: BoardEvent[]): number {
    completeAll() // 進行中の演出を終端までスナップ（入力割込・連続タイムラインの整合）
    let t = 0
    let chainSeen = 0
    let chainStartT = 0 // 連鎖セグメントの開始時刻（ビートはここから650ms刻み＝落下完了を待つ）
    const upgradeFireCounts = new Map<string, number>() // 可視化第一波②：このタイムライン内での強化ごとの発動回数
    let disruptLabelCount = 0 // 可視化第二波③：因果ラベルは1ターン（=このplay呼び出し1回）に最大2個まで
    // 論理は確定済みなので、描画用に「イベント時点のスプライト対応」を移動しながら追う
    for (const e of evs) {
      // 可視化第二波②：core契約の新イベント 'enemy-attack' は BoardEvent 型に未着の可能性があるため、
      // switch（判別可能ユニオン）の外・any経由で先取りして処理する（型が来ても来なくても安全）
      const raw = e as unknown as { t: string; id?: number; damage?: number }
      if (raw.t === 'enemy-attack' && typeof raw.id === 'number') {
        const id = raw.id
        const dmg = raw.damage ?? 0
        this.flashIntentBadge(id, t)
        this.enemyAttackTelegraphFx(id, t)
        if (disruptLabelCount < 2) {
          disruptLabelCount++
          const cells = this.enemyCellsCache.get(id)
          if (cells && cells.length) {
            const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
            const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
            this.floatLabelFx({ x: cx, y: cy }, `こうげき！ -${dmg}`, 0xff6b5a, t + 100, -0.25)
          }
        }
        delay(t, () => this.onEnemyAttack?.(id, dmg))
        t += 260
        continue
      }
      switch (e.t) {
        case 'swap': {
          const a = this.sprites.get(this.key(e.a.x, e.a.y))
          const b = this.sprites.get(this.key(e.b.x, e.b.y))
          if (a && b) {
            this.sprites.set(this.key(e.a.x, e.a.y), b)
            this.sprites.set(this.key(e.b.x, e.b.y), a)
            const move = (sp: Sprite, to: XY, back: boolean) => {
              tween(sp.position, { x: this.px(to.x), y: this.px(to.y) }, T.swap, { delay: t })
              if (back)
                tween(sp.position, { x: this.px(back ? e.a.x : to.x), y: this.px(back ? e.a.y : to.y) }, T.swap, {
                  delay: t + T.swap,
                })
            }
            if (e.illegal) {
              // 行って戻る
              tween(a.position, { x: this.px(e.b.x), y: this.px(e.b.y) }, T.swap, { delay: t })
              tween(b.position, { x: this.px(e.a.x), y: this.px(e.a.y) }, T.swap, { delay: t })
              tween(a.position, { x: this.px(e.a.x), y: this.px(e.a.y) }, T.swap, { delay: t + T.swap })
              tween(b.position, { x: this.px(e.b.x), y: this.px(e.b.y) }, T.swap, { delay: t + T.swap })
              this.sprites.set(this.key(e.a.x, e.a.y), a)
              this.sprites.set(this.key(e.b.x, e.b.y), b)
              t += T.swap * 2
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
            // 連鎖ビート＝前セグメント開始から650ms（落下がt+pop+fallで終わるのを跨がない）Codexレビュー#2
            if (e.chain > 1) t = Math.max(t, chainStartT + T.chainBeat)
            chainSeen = e.chain
            chainStartT = t
            sfx.pop(e.chain, t / 1000)
          }
          for (const p of e.cells) this.popPieceAt(p, t)
          break
        }
        case 'special-fire': {
          this.popPieceAt(e.at, t, true) // 発動した特殊駒自身のスプライトを消す（描画残りバグ対策）
          for (const p of e.cleared) this.popPieceAt(p, t, true)
          this.fireFx(e.at, e.piece, t)
          sfx.fire(e.piece.kind, t / 1000)
          t += 160 // 起爆ごとのビート（連発時に畳み掛ける間隔）
          chainSeen = 0
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
          // 合成：両方の特殊駒スプライトを消費（描画残りバグ対策）
          this.popPieceAt(e.from, t, true)
          this.popPieceAt(e.at, t, true)
          this.flashFx(e.at, t)
          break
        }
        case 'special-born': {
          const sp = this.makePiece(e.at.x, e.at.y, e.piece)
          const b = this.bs(sp)
          sp.scale.set(0)
          sp.alpha = 0
          tween(sp, { alpha: 1 }, 80, { delay: t + T.pop })
          tween(sp.scale, { x: b, y: b }, T.specialBorn, { delay: t + T.pop, ease: easeOutBack })
          // 可視化第一波③：爆発鉱石への変換（特殊駒生成イベントを共用）は一瞬明滅+ラベルで因果を示す
          if (e.piece.kind === 'normal' && e.piece.volatile) {
            this.makeVolatileOverlay(e.at.x, e.at.y, t + T.pop)
            this.floatLabelFx(e.at, '爆発鉱石！', 0xff8a3d, t + T.pop, -0.2)
          }
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
            tween(sp.position, { x: this.px(e.to.x), y: this.px(e.to.y) }, T.fall * Math.min(1, 0.5 + dist * 0.25), {
              delay: t + T.pop,
              ease: easeInCubic,
              onDone: () => {
                // 着地バウンス
                tween(sp.scale, { x: b * 1.12, y: b * 0.88 }, 60, {
                  onDone: () => tween(sp.scale, { x: b, y: b }, 90, { ease: easeOutCubic }),
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
          tween(sp.position, { y: this.px(e.at.y) }, T.fall, { delay: t + T.pop + e.at.y * 18, ease: easeInCubic })
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
          this.explodeFx(e.at, t)
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
          delay(t, () => this.onUpgradeFire?.(id)) // バー側のバウンス演出は毎回（アイコンは常に反応させる）
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
          this.enemyDefeatedFx(e.id, e.cells, t)
          t += 200
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
        case 'spore-poisoned': {
          this.flashIntentBadge(e.id, t) // 可視化第一波①：予告→実行
          this.makePoisonOverlay(e.at.x, e.at.y, t + 120)
          this.causeLineFx(e.id, e.at, 0xb98be0, t + 100) // 可視化第二波③：因果線
          if (disruptLabelCount < 2) {
            disruptLabelCount++
            this.floatLabelFx(e.at, 'けすとダメージ！', 0xb98be0, t + 160)
          }
          t += 320
          break
        }
        case 'poison-triggered': {
          const k = this.key(e.at.x, e.at.y)
          const g = this.poisonG.get(k)
          if (g) {
            this.poisonG.delete(k)
            if (!g.destroyed) g.destroy()
          }
          this.violetBurstFx(e.at, t)
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
        case 'boss-retreat': {
          const prevRow = e.row - 1
          const oldRow = this.bossRowG.get(prevRow)
          this.bossRowG.delete(prevRow)
          for (let bx = 0; bx < W; bx++) this.blockG.delete(this.key(bx, prevRow))
          if (oldRow && !oldRow.destroyed) {
            tween(oldRow, { alpha: 0 }, 220, {
              delay: t,
              onDone: () => {
                if (!oldRow.destroyed) oldRow.destroy()
              },
            })
          }
          if (this.bossId != null) {
            const face = this.bossFaceG.get(this.bossId)
            if (face && !face.destroyed) tween(face.position, { y: e.row * this.S }, 260, { delay: t, ease: easeOutCubic })
          }
          t += 220
          break
        }
        case 'boss-slam': {
          this.flashIntentBadge(e.id, t) // 可視化第一波①：予告→実行
          this.shakeContainer(this.root, t + 120)
          t += 340
          break
        }
        case 'env-grow': {
          const c = this.board.at(e.at.x, e.at.y)
          if (c?.piece) {
            const sp = this.makePiece(e.at.x, e.at.y, c.piece)
            const b = this.bs(sp)
            sp.scale.set(0)
            tween(sp.scale, { x: b, y: b }, 260, { delay: t, ease: easeOutBack })
          }
          this.envGrowFx(e.at, e.kind, t)
          t += 200
          break
        }
        // floor-clear / run-over：ビューでは何もしない（main.ts が層進行・記録画面を扱う）
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
    // タイムライン終端で必ず照合修復：稀な競合で残る位置ズレ/孤児を吸収し、描画=エンジンを保証
    delay(total + 80, () => this.reconcile())
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
        const wantPoison = c?.poisonSpore === true
        const pg = this.poisonG.get(k)
        if (wantPoison && (!pg || pg.destroyed)) {
          if (pg) this.poisonG.delete(k)
          this.makePoisonOverlay(x, y, 0)
        } else if (!wantPoison && pg) {
          this.poisonG.delete(k)
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
    // ボスの顔（目+HPバー）オーバーレイ：不在なら片付け、居るのに欠けていれば再生成・位置とHPを同期
    const boss = this.board.enemies.find((en) => en.kind === 'boss')
    if (boss) {
      this.enemyMeta.set(boss.id, { kind: 'boss', maxHp: boss.maxHp })
      this.enemyCellsCache.set(
        boss.id,
        boss.cells.map((p) => ({ ...p })),
      )
      this.bossId = boss.id
      const face = this.bossFaceG.get(boss.id)
      if (!face || face.destroyed) {
        this.makeBossFace(boss)
      } else {
        face.position.set(0, boss.bossFrontRow * this.S)
        this.paintHpBar(face, boss.hp, boss.maxHp)
      }
    } else {
      for (const face of this.bossFaceG.values()) if (!face.destroyed) face.destroy()
      this.bossFaceG.clear()
      this.bossId = null
    }
    this.updateIntentBadges() // 可視化第一波①：撃破・生成の取りこぼしをここでも吸収
  }

  private popPieceAt(p: XY, t: number, byFire = false) {
    const k = this.key(p.x, p.y)
    const sp = this.sprites.get(k)
    if (!sp) return
    this.sprites.delete(k)
    this.clearVolatileOverlay(p, t) // 可視化第一波③：爆発鉱石の常時発光を破壊タイミングで片付ける
    const b = this.bs(sp)
    tween(sp.scale, { x: b * 1.25, y: b * 1.25 }, T.pop * 0.35, { delay: t })
    tween(sp.scale, { x: 0, y: 0 }, T.pop * 0.65, { delay: t + T.pop * 0.35, ease: easeInCubic })
    tween(sp, { alpha: byFire ? 0.4 : 0.9 }, T.pop, { delay: t, onDone: () => sp.destroy() })
    this.sparkFx(p, t)
  }

  private sparkFx(p: XY, t: number) {
    delay(t, () => {
      for (let i = 0; i < 6; i++) {
        const g = new Graphics()
        g.circle(0, 0, 2.4).fill(0xfff2c8)
        g.position.set(this.px(p.x), this.px(p.y))
        this.fxLayer.addChild(g)
        const a = Math.random() * Math.PI * 2
        const d = this.S * (0.4 + Math.random() * 0.5)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d }, 320, { ease: easeOutCubic })
        tween(g, { alpha: 0 }, 320, { onDone: () => g.destroy() })
      }
    })
  }

  private debrisFx(p: XY, t: number, color: number) {
    delay(t, () => {
      for (let i = 0; i < 8; i++) {
        const g = new Graphics()
        g.roundRect(-3, -3, 6, 6, 1.5).fill(color)
        g.position.set(this.px(p.x), this.px(p.y))
        this.fxLayer.addChild(g)
        const a = Math.random() * Math.PI * 2
        const d = this.S * (0.5 + Math.random() * 0.7)
        tween(g.position, { x: this.px(p.x) + Math.cos(a) * d, y: this.px(p.y) + Math.sin(a) * d + this.S * 0.4 }, 420, {
          ease: easeOutCubic,
        })
        tween(g, { alpha: 0, rotation: (Math.random() - 0.5) * 4 }, 420, { onDone: () => g.destroy() })
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
      // 衝撃波リング＋閃光
      delay(t, () => {
        const ring = new Graphics()
        ring.circle(0, 0, S * 0.5).stroke({ width: S * 0.16, color: 0xffc978, alpha: 0.9 })
        ring.position.set(this.px(at.x), this.px(at.y))
        this.fxLayer.addChild(ring)
        tween(ring.scale, { x: 5.2, y: 5.2 }, 340, { ease: easeOutCubic })
        tween(ring, { alpha: 0 }, 340, { onDone: () => ring.destroy() })
      })
      this.flashFx(at, t)
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
