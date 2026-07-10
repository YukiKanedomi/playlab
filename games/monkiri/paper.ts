// games/monkiri/paper.ts — 紋切りの紙エンジン
// 「折られた紙（扇形1枚）」をラスタで持ち、鋏（フリーハンドの切線）で切り離し、
// 展開（万華鏡合成）で紋様にする。切り離された紙片は"本体（最大面積）以外は落ちる"＝
// 切り絵の物理（浮いた紙は保持できない。ブリッジが要る）をそのまま採用する。
//
// 座標系：
//  - ウェッジ空間 … このファイルの canvas ピクセル座標。頂点(APEX)＝紙の中心、+x が紙の軸。
//  - 正規化座標 (r, t) … 手本の作図用。r=0..1 が頂点→外周、t=-1..1 が折り目から折り目。
//    |t|>1 や r>1 にはみ出してよい（折り目をまたぐ穴・外周を欠く切り方の作図に使う）。

export const SIZE = 720
const PAD = 16
const SLIT_W = 3 // 鋏の切線の幅（この線自体も模様として残る）
const ALPHA_ON = 64 // これ以上のαを「紙がある」とみなす

export type Pt = { r: number; t: number }
export type Cut = {
  pts: Pt[]
  /** 中点二次補間でなめらかに閉じる（花びら等） */
  smooth?: boolean
  /** 面で抜かず、切り込み線（スリット）として細く抜く */
  slit?: boolean
}
export type Fragment = {
  canvas: HTMLCanvasElement
  /** ウェッジ空間でのバウンディング左上 */
  x: number
  y: number
  /** ウェッジ空間での重心 */
  cx: number
  cy: number
  area: number
}

export class Paper {
  /** 対称の基数。展開すると 2N 枚合わせ（N=1:二つ折り, 2:四つ折り, 3:六つ折り, 4:八つ折り） */
  readonly N: number
  /** ウェッジの半開き角（軸±この角度） */
  readonly halfAngle: number
  readonly apex: { x: number; y: number }
  readonly R: number
  readonly canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private undoStack: { canvas: HTMLCanvasElement; cuts: number }[] = []
  cutCount = 0

  constructor(N: number) {
    this.N = N
    this.halfAngle = Math.PI / (2 * N)
    // 縦（y方向の広がり）と横（半径）が両方 canvas に収まる最大半径
    const maxR = Math.min(SIZE - PAD * 2, (SIZE / 2 - PAD) / Math.sin(this.halfAngle))
    this.R = Math.floor(maxR)
    this.apex = { x: PAD, y: SIZE / 2 }
    this.canvas = document.createElement('canvas')
    this.canvas.width = SIZE
    this.canvas.height = SIZE
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!
    this.reset()
  }

  get copies(): number {
    return this.N * 2
  }

  ptToXY(p: Pt): { x: number; y: number } {
    const a = p.t * this.halfAngle
    return { x: this.apex.x + p.r * this.R * Math.cos(a), y: this.apex.y + p.r * this.R * Math.sin(a) }
  }

  /** ウェッジ（扇形）の外形パスを作る。クリップや下敷きシルエット描画に。 */
  wedgePath(ctx: CanvasRenderingContext2D): void {
    ctx.beginPath()
    ctx.moveTo(this.apex.x, this.apex.y)
    ctx.arc(this.apex.x, this.apex.y, this.R, -this.halfAngle, this.halfAngle)
    ctx.closePath()
  }

  /** 紙を新品に戻す（和紙の地合いも塗り直す） */
  reset(): void {
    const ctx = this.ctx
    ctx.clearRect(0, 0, SIZE, SIZE)
    ctx.save()
    this.wedgePath(ctx)
    ctx.clip()
    // 生成りの地
    ctx.fillStyle = '#f6f1e3'
    ctx.fillRect(0, 0, SIZE, SIZE)
    // 漉きムラ（大きな薄い雲）
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * SIZE
      const y = Math.random() * SIZE
      const r = 30 + Math.random() * 80
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      const tone = Math.random() < 0.5 ? '235,226,203' : '252,249,240'
      g.addColorStop(0, `rgba(${tone},${0.05 + Math.random() * 0.07})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }
    // 繊維（短い細線）
    ctx.lineCap = 'round'
    for (let i = 0; i < 420; i++) {
      const x = Math.random() * SIZE
      const y = Math.random() * SIZE
      const a = Math.random() * Math.PI
      const l = 3 + Math.random() * 9
      ctx.strokeStyle = Math.random() < 0.6 ? 'rgba(160,144,110,0.10)' : 'rgba(255,252,244,0.35)'
      ctx.lineWidth = 0.8 + Math.random() * 0.8
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l)
      ctx.stroke()
    }
    // 折り目側（直線の2辺）に折り重なりの陰
    for (const sgn of [-1, 1]) {
      ctx.save()
      ctx.translate(this.apex.x, this.apex.y)
      ctx.rotate(sgn * this.halfAngle)
      const g = ctx.createLinearGradient(0, 0, 0, sgn * 18)
      g.addColorStop(0, 'rgba(120,104,72,0.16)')
      g.addColorStop(1, 'rgba(120,104,72,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, Math.min(0, sgn * 18), this.R, 18)
      ctx.restore()
    }
    // 外周をわずかに沈める
    const rim = ctx.createRadialGradient(this.apex.x, this.apex.y, this.R * 0.82, this.apex.x, this.apex.y, this.R)
    rim.addColorStop(0, 'rgba(0,0,0,0)')
    rim.addColorStop(1, 'rgba(110,95,64,0.10)')
    ctx.fillStyle = rim
    ctx.fillRect(0, 0, SIZE, SIZE)
    ctx.restore()
    this.undoStack.length = 0
    this.cutCount = 0
  }

  /** Cut の輪郭パスを ctx に作る（stroke/fill は呼び手が行う）。ガイド線描画にも使う。 */
  tracePath(ctx: CanvasRenderingContext2D, cut: Cut): void {
    const xs = cut.pts.map((p) => this.ptToXY(p))
    ctx.beginPath()
    if (xs.length < 2) return
    if (!cut.smooth) {
      ctx.moveTo(xs[0].x, xs[0].y)
      for (let i = 1; i < xs.length; i++) ctx.lineTo(xs[i].x, xs[i].y)
      if (!cut.slit) ctx.closePath()
      return
    }
    const mid = (a: { x: number; y: number }, b: { x: number; y: number }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
    if (cut.slit) {
      // 開いた滑らか線
      ctx.moveTo(xs[0].x, xs[0].y)
      for (let i = 1; i < xs.length - 1; i++) {
        const m = mid(xs[i], xs[i + 1])
        ctx.quadraticCurveTo(xs[i].x, xs[i].y, m.x, m.y)
      }
      ctx.lineTo(xs[xs.length - 1].x, xs[xs.length - 1].y)
    } else {
      // 閉じた滑らか輪郭（中点発着の二次曲線）
      const m0 = mid(xs[xs.length - 1], xs[0])
      ctx.moveTo(m0.x, m0.y)
      for (let i = 0; i < xs.length; i++) {
        const nxt = xs[(i + 1) % xs.length]
        const m = mid(xs[i], nxt)
        ctx.quadraticCurveTo(xs[i].x, xs[i].y, m.x, m.y)
      }
      ctx.closePath()
    }
  }

  /** 作図データで抜く（手本の生成・演出用）。成分整理はしない＝ makeTarget が最後に settle する。 */
  applyCut(cut: Cut): void {
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    this.tracePath(ctx, cut)
    if (cut.slit) {
      ctx.strokeStyle = '#000'
      ctx.lineWidth = SLIT_W
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.stroke()
    } else {
      ctx.fillStyle = '#000'
      ctx.fill()
    }
    ctx.restore()
  }

  /**
   * フリーハンドの切線（ウェッジ空間のピクセル座標列）。
   * 線で紙を裂き、本体（最大面積）以外の紙片を落として返す。
   * 何も切り離さなかった場合も切線はスリットとして残る（＝飾り切りができる）。
   */
  strokeCut(points: { x: number; y: number }[]): Fragment[] {
    // 近すぎる点を間引く
    const pts: { x: number; y: number }[] = []
    for (const p of points) {
      const last = pts[pts.length - 1]
      if (!last || (p.x - last.x) ** 2 + (p.y - last.y) ** 2 > 9) pts.push(p)
    }
    if (pts.length < 2) return []
    this.pushUndo()
    this.cutCount++
    const ctx = this.ctx
    ctx.save()
    ctx.globalCompositeOperation = 'destination-out'
    ctx.strokeStyle = '#000'
    ctx.lineWidth = SLIT_W
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(pts[0].x, pts[0].y)
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2
      const my = (pts[i].y + pts[i + 1].y) / 2
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my)
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y)
    ctx.stroke()
    ctx.restore()
    return this.settle(true)
  }

  /** 連結成分に分け、最大の1片だけ残して他を消す。withFragments なら消した片を canvas で返す。 */
  settle(withFragments: boolean): Fragment[] {
    const w = SIZE
    const h = SIZE
    const img = this.ctx.getImageData(0, 0, w, h)
    const d = img.data
    const label = new Int32Array(w * h).fill(-1)
    type Stat = { area: number; minX: number; minY: number; maxX: number; maxY: number; sx: number; sy: number }
    const stats: Stat[] = []
    const stack: number[] = []
    for (let start = 0; start < w * h; start++) {
      if (label[start] !== -1 || d[start * 4 + 3] < ALPHA_ON) continue
      const id = stats.length
      const st: Stat = { area: 0, minX: w, minY: h, maxX: 0, maxY: 0, sx: 0, sy: 0 }
      stats.push(st)
      label[start] = id
      stack.push(start)
      while (stack.length) {
        const p = stack.pop()!
        const x = p % w
        const y = (p - x) / w
        st.area++
        st.sx += x
        st.sy += y
        if (x < st.minX) st.minX = x
        if (x > st.maxX) st.maxX = x
        if (y < st.minY) st.minY = y
        if (y > st.maxY) st.maxY = y
        if (x > 0 && label[p - 1] === -1 && d[(p - 1) * 4 + 3] >= ALPHA_ON) {
          label[p - 1] = id
          stack.push(p - 1)
        }
        if (x < w - 1 && label[p + 1] === -1 && d[(p + 1) * 4 + 3] >= ALPHA_ON) {
          label[p + 1] = id
          stack.push(p + 1)
        }
        if (y > 0 && label[p - w] === -1 && d[(p - w) * 4 + 3] >= ALPHA_ON) {
          label[p - w] = id
          stack.push(p - w)
        }
        if (y < h - 1 && label[p + w] === -1 && d[(p + w) * 4 + 3] >= ALPHA_ON) {
          label[p + w] = id
          stack.push(p + w)
        }
      }
    }
    if (stats.length <= 1) return []
    let keep = 0
    for (let i = 1; i < stats.length; i++) if (stats[i].area > stats[keep].area) keep = i
    const frags: Fragment[] = []
    for (let c = 0; c < stats.length; c++) {
      if (c === keep) continue
      const st = stats[c]
      if (withFragments && st.area >= 12) {
        const fw = st.maxX - st.minX + 1
        const fh = st.maxY - st.minY + 1
        const fc = document.createElement('canvas')
        fc.width = fw
        fc.height = fh
        const fctx = fc.getContext('2d')!
        const fimg = fctx.createImageData(fw, fh)
        for (let y = st.minY; y <= st.maxY; y++) {
          for (let x = st.minX; x <= st.maxX; x++) {
            const p = y * w + x
            if (label[p] !== c) continue
            const si = p * 4
            const di = ((y - st.minY) * fw + (x - st.minX)) * 4
            fimg.data[di] = d[si]
            fimg.data[di + 1] = d[si + 1]
            fimg.data[di + 2] = d[si + 2]
            fimg.data[di + 3] = d[si + 3]
          }
        }
        fctx.putImageData(fimg, 0, 0)
        frags.push({ canvas: fc, x: st.minX, y: st.minY, cx: st.sx / st.area, cy: st.sy / st.area, area: st.area })
      }
      for (let y = st.minY; y <= st.maxY; y++) {
        for (let x = st.minX; x <= st.maxX; x++) {
          const p = y * w + x
          if (label[p] === c) d[p * 4 + 3] = 0
        }
      }
    }
    // 落ちた片のフチに残る半透明の縁取り（AAの残滓）を掃除：
    // 「紙あり(ラベル付き)」の隣にいない薄い画素は消す
    for (let p = 0; p < w * h; p++) {
      const a = d[p * 4 + 3]
      if (a === 0 || a >= ALPHA_ON) continue
      const x = p % w
      const y = (p - x) / w
      const nearKeep =
        (x > 0 && label[p - 1] === keep) ||
        (x < w - 1 && label[p + 1] === keep) ||
        (y > 0 && label[p - w] === keep) ||
        (y < h - 1 && label[p + w] === keep)
      if (!nearKeep) d[p * 4 + 3] = 0
    }
    this.ctx.putImageData(img, 0, 0)
    return frags
  }

  private pushUndo(): void {
    const c = document.createElement('canvas')
    c.width = SIZE
    c.height = SIZE
    c.getContext('2d')!.drawImage(this.canvas, 0, 0)
    this.undoStack.push({ canvas: c, cuts: this.cutCount })
    if (this.undoStack.length > 12) this.undoStack.shift()
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  undo(): boolean {
    const top = this.undoStack.pop()
    if (!top) return false
    this.ctx.save()
    this.ctx.globalCompositeOperation = 'copy'
    this.ctx.drawImage(top.canvas, 0, 0)
    this.ctx.restore()
    this.cutCount = top.cuts
    return true
  }

  /**
   * 展開して描く（万華鏡合成）。copiesFloat に小数を渡すと途中まで開いた状態（扇の開き演出）。
   * rot は全体の向き。outR は展開後の紙の半径（画面ピクセル）。
   */
  renderUnfolded(ctx: CanvasRenderingContext2D, cx: number, cy: number, outR: number, rot = 0, copiesFloat?: number): void {
    const total = this.copies
    const c = Math.max(0, Math.min(total, copiesFloat ?? total))
    const a = this.halfAngle * 2
    const s = outR / this.R
    const upto = Math.ceil(c)
    const baseAlpha = ctx.globalAlpha
    for (let i = 0; i < upto; i++) {
      ctx.save()
      ctx.globalAlpha = baseAlpha * (i < Math.floor(c) ? 1 : c - Math.floor(c))
      ctx.translate(cx, cy)
      ctx.rotate(rot)
      if (i % 2 === 0) {
        ctx.rotate(i * a)
      } else {
        // 角度 β=i*a/2 の直線に対する鏡映
        const b = (i * a) / 2
        ctx.rotate(b)
        ctx.scale(1, -1)
        ctx.rotate(-b)
      }
      ctx.scale(s, s)
      ctx.translate(-this.apex.x, -this.apex.y)
      ctx.drawImage(this.canvas, 0, 0)
      ctx.restore()
    }
    ctx.globalAlpha = baseAlpha
  }

  /** 手本との一致率（0..1）。両者のαマスクを96pxに落として Jaccard。 */
  similarity(target: Paper): number {
    const S = 96
    if (!cmpA || !cmpB) {
      cmpA = document.createElement('canvas')
      cmpA.width = cmpA.height = S
      cmpB = document.createElement('canvas')
      cmpB.width = cmpB.height = S
    }
    const ca = cmpA.getContext('2d', { willReadFrequently: true })!
    const cb = cmpB.getContext('2d', { willReadFrequently: true })!
    ca.clearRect(0, 0, S, S)
    cb.clearRect(0, 0, S, S)
    ca.drawImage(this.canvas, 0, 0, S, S)
    cb.drawImage(target.canvas, 0, 0, S, S)
    const da = ca.getImageData(0, 0, S, S).data
    const db = cb.getImageData(0, 0, S, S).data
    let inter = 0
    let union = 0
    for (let i = 3; i < da.length; i += 4) {
      const a = da[i] >= 100
      const b = db[i] >= 100
      if (a && b) inter++
      if (a || b) union++
    }
    return union === 0 ? 1 : inter / union
  }
}

let cmpA: HTMLCanvasElement | null = null
let cmpB: HTMLCanvasElement | null = null

/** 手本を作る（作図→物理整理まで）。 */
export function makeTarget(N: number, cuts: Cut[]): Paper {
  const p = new Paper(N)
  for (const c of cuts) p.applyCut(c)
  p.settle(false)
  return p
}

/** 展開した紋を単色（判子・墨摺り）で焼いた canvas を返す。手本カードやサムネ用。 */
export function renderCrest(paper: Paper, sizePx: number, color: string): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = c.height = sizePx
  const ctx = c.getContext('2d')!
  paper.renderUnfolded(ctx, sizePx / 2, sizePx / 2, sizePx * 0.47)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, sizePx, sizePx)
  return c
}
