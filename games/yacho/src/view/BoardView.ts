// 盤面ビュー：エンジンのイベント列をタイムライン化して描く。
// 方針: ロジックは即時確定・ビューが追いかける。入力割込時は snap で追いつく。
// タイミングは RESEARCH.md §5 実測値。
import { Container, Graphics, Sprite, Renderer } from 'pixi.js'
import { Board, W, H } from '../core/board'
import type { BoardEvent, Piece, XY } from '../core/types'
import { PAL, pieceKey, pieceTexture, spriteTexture } from './pieces'
import { completeAll, delay, easeInCubic, easeOutBack, easeOutCubic, tween } from '../juice/tween'
import { sfx } from '../juice/sound'

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
    for (const g of this.blockG.values()) g.destroy()
    this.blockG.clear()
    for (const g of this.groundG.values()) g.destroy()
    this.groundG.clear()
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.board.at(x, y)
        if (!c) continue
        if (c.ground > 0) this.makeGround(x, y, c.ground as 1 | 2)
        if (c.block) this.makeBlock(x, y)
        if (c.piece) this.makePiece(x, y, c.piece)
      }
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
    // 論理は確定済みなので、描画用に「イベント時点のスプライト対応」を移動しながら追う
    for (const e of evs) {
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
      }
    }
    const total = t + T.pop + T.fall
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
      }
  }

  private popPieceAt(p: XY, t: number, byFire = false) {
    const k = this.key(p.x, p.y)
    const sp = this.sprites.get(k)
    if (!sp) return
    this.sprites.delete(k)
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
