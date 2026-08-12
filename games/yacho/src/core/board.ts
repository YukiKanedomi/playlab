// ヘッドレス盤面エンジン。Pixi 非依存。全ての状態遷移はイベント列として返す。
// 設計根拠: DESIGN.md §1/§5、RESEARCH.md §1-2（RM実仕様）。
import { makeRng, randInt, type Rng } from './rng'
import type { BoardEvent, Cell, Color, Goal, LevelDef, Piece, XY } from './types'

export const W = 8
export const H = 8

export class Board {
  cells: Cell[][] = [] // [y][x]
  rng: Rng
  movesLeft: number
  colors: Color[]
  goals: Goal[]
  goalDone: number[] = []
  chain = 0 // 現在の連鎖段数（SEピッチ用）
  subiCharge: number
  score = 0 // 消去1駒=10点×連鎖倍率、特殊駒発動=+50（DESIGN.md §2）

  constructor(public def: LevelDef) {
    this.rng = makeRng(def.seed)
    this.movesLeft = def.moves
    this.colors = ([0, 1, 2, 3, 4] as Color[]).slice(0, def.colors)
    this.goals = def.goals
    this.goalDone = def.goals.map(() => 0)
    this.subiCharge = def.subiCharge ?? 4
    this.loadLayout(def.layout)
    this.fillInitial()
  }

  private loadLayout(layout: string[]) {
    for (let y = 0; y < H; y++) {
      const row: Cell[] = []
      for (let x = 0; x < W; x++) {
        const ch = layout[y]?.[x] ?? '.'
        const c: Cell = { hole: ch === '#', piece: null, ground: 0, block: null }
        if (ch === 'g') c.ground = 1
        if (ch === 'G') c.ground = 2
        if (ch === 'k') c.block = { type: 'kokeishi', hp: 1 }
        if (ch === 'K') c.block = { type: 'kokeishi', hp: 2 }
        if (ch === 'h') c.block = { type: 'hako', hp: 1 }
        if (ch === 's') c.block = { type: 'subi', remaining: this.subiCharge }
        row.push(c)
      }
      this.cells.push(row)
    }
  }

  at(x: number, y: number): Cell | null {
    if (x < 0 || y < 0 || x >= W || y >= H) return null
    const c = this.cells[y][x]
    return c.hole ? null : c
  }

  /** 初期配置：即マッチ無し・有効手ありを保証 */
  private fillInitial() {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (!c || c.block) continue
        c.piece = { kind: 'normal', color: this.pickColorNoMatch(x, y) }
      }
    let guard = 0
    while (!this.hasValidMove() && guard++ < 100) this.rerollSomePieces()
  }

  private pickColorNoMatch(x: number, y: number): Color {
    const bad = new Set<Color>()
    const cw = (dx: number, dy: number) => {
      const c = this.at(x + dx, y + dy)?.piece
      return c && c.kind === 'normal' ? c.color : null
    }
    // 左2連・上2連と同色は避ける（初期即マッチ防止）
    if (cw(-1, 0) !== null && cw(-1, 0) === cw(-2, 0)) bad.add(cw(-1, 0)!)
    if (cw(0, -1) !== null && cw(0, -1) === cw(0, -2)) bad.add(cw(0, -1)!)
    const pool = this.colors.filter((c) => !bad.has(c))
    return pool[randInt(this.rng, pool.length)]
  }

  private rerollSomePieces() {
    // 詰み防止：ランダムな通常駒を数個塗り直す（盤面シャッフルはしない＝RM流）
    for (let i = 0; i < 6; i++) {
      const x = randInt(this.rng, W)
      const y = randInt(this.rng, H)
      const c = this.at(x, y)
      if (c?.piece?.kind === 'normal') c.piece = { kind: 'normal', color: this.colors[randInt(this.rng, this.colors.length)] }
    }
  }

  /** 有効手（スワップしてマッチが生まれる手 or 特殊駒タップ）があるか */
  hasValidMove(): boolean {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') return true
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ] as const) {
          if (this.wouldMatch(x, y, x + dx, y + dy)) return true
        }
      }
    return false
  }

  private wouldMatch(ax: number, ay: number, bx: number, by: number): boolean {
    const a = this.at(ax, ay)
    const b = this.at(bx, by)
    if (!a?.piece || !b?.piece) return false
    if (a.piece.kind !== 'normal' || b.piece.kind !== 'normal') return false
    this.swapPieces(a, b)
    const hit = this.hasAnyMatch()
    this.swapPieces(a, b)
    return hit
  }

  /** ラン（3+連）または2×2正方形が盤上にあるか */
  private hasAnyMatch(): boolean {
    return this.findRuns().length > 0 || this.findSquares().length > 0
  }

  private swapPieces(a: Cell, b: Cell) {
    const t = a.piece
    a.piece = b.piece
    b.piece = t
  }

  // ---- マッチ検出 ----

  /** 縦横の3+連を列挙 */
  private findRuns(): { cells: XY[]; color: Color; dir: 'h' | 'v' }[] {
    const runs: { cells: XY[]; color: Color; dir: 'h' | 'v' }[] = []
    const colAt = (x: number, y: number) => {
      const p = this.at(x, y)?.piece
      return p?.kind === 'normal' ? p.color : null
    }
    for (let y = 0; y < H; y++) {
      let x = 0
      while (x < W) {
        const c = colAt(x, y)
        if (c === null) {
          x++
          continue
        }
        let len = 1
        while (colAt(x + len, y) === c) len++
        if (len >= 3) runs.push({ color: c, dir: 'h', cells: Array.from({ length: len }, (_, i) => ({ x: x + i, y })) })
        x += len
      }
    }
    for (let x = 0; x < W; x++) {
      let y = 0
      while (y < H) {
        const c = colAt(x, y)
        if (c === null) {
          y++
          continue
        }
        let len = 1
        while (colAt(x, y + len) === c) len++
        if (len >= 3) runs.push({ color: c, dir: 'v', cells: Array.from({ length: len }, (_, i) => ({ x, y: y + i })) })
        y += len
      }
    }
    return runs
  }

  /** 2×2 の同色正方形（羽虫）。ラン優先のため、ラン所属セルを除いた判定は呼び出し側で行う */
  private findSquares(): { cells: XY[]; color: Color }[] {
    const out: { cells: XY[]; color: Color }[] = []
    const colAt = (x: number, y: number) => {
      const p = this.at(x, y)?.piece
      return p?.kind === 'normal' ? p.color : null
    }
    for (let y = 0; y < H - 1; y++)
      for (let x = 0; x < W - 1; x++) {
        const c = colAt(x, y)
        if (c === null) continue
        if (colAt(x + 1, y) === c && colAt(x, y + 1) === c && colAt(x + 1, y + 1) === c)
          out.push({
            color: c,
            cells: [
              { x, y },
              { x: x + 1, y },
              { x, y: y + 1 },
              { x: x + 1, y: y + 1 },
            ],
          })
      }
    return out
  }

  // ---- 解決ループ ----

  /**
   * プレイヤーの1手（スワップ）。イベント列を返す。
   * 不正手（マッチも特殊駒も絡まない）は illegal イベントのみで手数を消費しない。
   */
  swap(a: XY, b: XY): BoardEvent[] {
    const ev: BoardEvent[] = []
    const ca = this.at(a.x, a.y)
    const cb = this.at(b.x, b.y)
    if (!ca?.piece || !cb?.piece || Math.abs(a.x - b.x) + Math.abs(a.y - b.y) !== 1) {
      ev.push({ t: 'swap', a, b, illegal: true })
      return ev
    }
    const isSpecial = (p: Piece) => p.kind !== 'normal' && p.kind !== 'spore'
    // 特殊駒コンボ（両方特殊）: 両方消費して b 地点で合成発動
    if (isSpecial(ca.piece) && isSpecial(cb.piece)) {
      const pa = ca.piece
      const pb = cb.piece
      ca.piece = null
      cb.piece = null
      ev.push({ t: 'swap', a, b, illegal: false })
      ev.push({ t: 'combo', at: b, from: a, kinds: `${pa.kind}+${pb.kind}` })
      this.movesLeft--
      this.chain = 0
      this.fireSpecial(b, pb, ev, pa)
      this.resolveCascades(ev)
      this.afterMove(ev)
      return ev
    }
    // 片方が特殊駒: スワップして移動先で単発発動
    if (isSpecial(ca.piece) || isSpecial(cb.piece)) {
      this.swapPieces(ca, cb)
      const at = isSpecial(cb.piece!) ? b : a
      const cell = this.at(at.x, at.y)!
      const p = cell.piece!
      cell.piece = null
      ev.push({ t: 'swap', a, b, illegal: false })
      this.movesLeft--
      this.chain = 0
      this.fireSpecial(at, p, ev)
      this.resolveCascades(ev)
      this.afterMove(ev)
      return ev
    }
    this.swapPieces(ca, cb)
    if (!this.hasAnyMatch()) {
      this.swapPieces(ca, cb) // 戻す
      ev.push({ t: 'swap', a, b, illegal: true })
      return ev
    }
    ev.push({ t: 'swap', a, b, illegal: false })
    this.movesLeft--
    this.chain = 0
    this.resolveMatches(ev, b)
    this.resolveCascades(ev)
    this.afterMove(ev)
    return ev
  }

  /** 特殊駒タップ発動 */
  tap(at: XY): BoardEvent[] {
    const ev: BoardEvent[] = []
    const c = this.at(at.x, at.y)
    if (!c?.piece || c.piece.kind === 'normal' || c.piece.kind === 'spore') return ev
    this.movesLeft--
    this.chain = 0
    this.fireAt(at, ev)
    this.resolveCascades(ev)
    this.afterMove(ev)
    return ev
  }

  /** 1連鎖ぶんのマッチを消して特殊駒を生成。何か消したら true */
  private resolveMatches(ev: BoardEvent[], born?: XY): boolean {
    const runs = this.findRuns()
    const squaresEarly = this.findSquares()
    if (runs.length === 0 && squaresEarly.length === 0) return false
    this.chain++
    const used = new Set<string>()
    const key = (p: XY) => `${p.x},${p.y}`
    // ラン同士の交差 → L/T字（火壺）。単独5連 → 星珠。4連 → 銛。
    const clusters: { cells: XY[]; color: Color; special?: Piece }[] = []
    const taken = new Set<number>()
    for (let i = 0; i < runs.length; i++) {
      if (taken.has(i)) continue
      const r = runs[i]
      let cells = [...r.cells]
      let special: Piece | undefined
      for (let j = i + 1; j < runs.length; j++) {
        if (taken.has(j)) continue
        const s = runs[j]
        if (s.color !== r.color || s.dir === r.dir) continue
        if (r.cells.some((p) => s.cells.some((q) => q.x === p.x && q.y === p.y))) {
          cells = [...cells, ...s.cells.filter((q) => !cells.some((p) => p.x === q.x && p.y === q.y))]
          special = { kind: 'hitsubo' }
          taken.add(j)
        }
      }
      if (!special) {
        if (r.cells.length >= 5) special = { kind: 'seiju' }
        else if (r.cells.length === 4) special = { kind: 'harpoon', dir: r.dir === 'h' ? 'v' : 'h' }
      }
      clusters.push({ cells, color: r.color, special })
      taken.add(i)
    }
    // 2×2（羽虫）：ランに使われていないセルのみで成立
    for (const sq of this.findSquares()) {
      const overlap = clusters.some((cl) => cl.cells.some((p) => sq.cells.some((q) => q.x === p.x && q.y === p.y)))
      if (!overlap) clusters.push({ cells: sq.cells, color: sq.color, special: { kind: 'hamushi' } })
    }
    for (const cl of clusters) {
      ev.push({ t: 'match', cells: cl.cells, color: cl.color, chain: this.chain })
      for (const p of cl.cells) {
        if (used.has(key(p))) continue
        used.add(key(p))
        this.clearPieceAt(p, ev, cl.color)
      }
      this.damageAround(cl.cells, ev)
      if (cl.special) {
        // 生成位置：プレイヤーのスワップ先がクラスタ内ならそこ、でなければ中央
        const spawnAt = born && cl.cells.some((p) => p.x === born.x && p.y === born.y) ? born : cl.cells[Math.floor(cl.cells.length / 2)]
        const c = this.at(spawnAt.x, spawnAt.y)
        if (c && !c.block) {
          c.piece = cl.special
          ev.push({ t: 'special-born', at: spawnAt, piece: cl.special })
        }
      }
    }
    return true
  }

  /** 駒を消す（蔦苔剥がし・ゴール計上・スコア込み） */
  private clearPieceAt(p: XY, ev: BoardEvent[], countColor?: Color) {
    const c = this.at(p.x, p.y)
    if (!c) return
    if (c.piece?.kind === 'normal' && countColor !== undefined) this.progressGoal({ type: 'color', color: c.piece.color }, ev)
    if (c.piece) this.score += 10 * Math.max(1, this.chain)
    c.piece = null
    if (c.ground > 0) {
      c.ground = (c.ground - 1) as 0 | 1
      ev.push({ t: 'ground-hit', at: p, left: c.ground })
      if (c.ground === 0) this.progressGoal({ type: 'tsutagoke' }, ev)
    }
  }

  /** マッチ隣接ダメージ（苔石・匣・陶片・巣灯） */
  private damageAround(cells: XY[], ev: BoardEvent[]) {
    const hit = new Set<string>()
    for (const p of cells)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const q = { x: p.x + dx, y: p.y + dy }
        const k = `${q.x},${q.y}`
        if (hit.has(k)) continue
        hit.add(k)
        this.damageBlock(q, ev)
      }
  }

  damageBlock(p: XY, ev: BoardEvent[]) {
    const c = this.at(p.x, p.y)
    if (!c?.block) return
    const b = c.block
    if (b.type === 'subi') {
      // 巣灯：隣接ヒットで胞子を1つ排出（空きマスがあれば）。残0で閉鎖
      if (b.remaining > 0) {
        const spot = this.findSporeSpot(p)
        if (spot) {
          const sc = this.at(spot.x, spot.y)!
          sc.piece = { kind: 'spore' }
          b.remaining--
          ev.push({ t: 'spore-born', at: spot })
          ev.push({ t: 'block-hit', at: p, type: 'subi', destroyed: b.remaining === 0 })
          if (b.remaining === 0) c.block = null // 閉鎖＝マスが空く
        }
      }
      return
    }
    b.hp--
    const destroyed = b.hp <= 0
    ev.push({ t: 'block-hit', at: p, type: b.type, destroyed })
    if (destroyed) {
      if (b.type === 'hako') {
        c.block = { type: 'touhen', hp: 1 } // 匣→陶片
      } else {
        if (b.type === 'kokeishi') this.progressGoal({ type: 'kokeishi' }, ev)
        if (b.type === 'touhen') this.progressGoal({ type: 'touhen' }, ev)
        c.block = null
      }
    }
  }

  private findSporeSpot(near: XY): XY | null {
    // 巣灯の周囲：空きマス優先、無ければ通常駒を置き換えて湧く
    const dirs = [
      [0, -1],
      [1, 0],
      [-1, 0],
      [0, 1],
    ] as const
    for (const [dx, dy] of dirs) {
      const c = this.at(near.x + dx, near.y + dy)
      if (c && !c.block && !c.piece) return { x: near.x + dx, y: near.y + dy }
    }
    for (const [dx, dy] of dirs) {
      const c = this.at(near.x + dx, near.y + dy)
      if (c && !c.block && c.piece?.kind === 'normal') return { x: near.x + dx, y: near.y + dy }
    }
    return null
  }

  // ---- 特殊駒発動・コンボ ----

  private fireAt(at: XY, ev: BoardEvent[]) {
    const c = this.at(at.x, at.y)
    if (!c?.piece) return
    const p = c.piece
    c.piece = null
    this.fireSpecial(at, p, ev)
  }

  private fireSpecial(at: XY, p: Piece, ev: BoardEvent[], combo?: Piece) {
    const cleared: XY[] = []
    const clearCell = (x: number, y: number) => {
      const c = this.at(x, y)
      if (!c) return
      if (c.block) {
        this.damageBlock({ x, y }, ev)
        return
      }
      if (!c.piece) return
      if (c.piece.kind === 'spore') return // 胞子は特殊駒でも壊れない（回収は上端のみ）
      if (c.piece.kind !== 'normal') {
        // 誘爆
        const q = c.piece
        c.piece = null
        this.fireSpecial({ x, y }, q, ev)
      } else {
        this.progressGoal({ type: 'color', color: c.piece.color }, ev)
        this.clearPieceAt({ x, y }, ev)
      }
      cleared.push({ x, y })
    }
    const row = (y: number) => {
      for (let x = 0; x < W; x++) clearCell(x, y)
    }
    const col = (x: number) => {
      for (let y = 0; y < H; y++) clearCell(x, y)
    }
    const blast = (cx: number, cy: number, r: number) => {
      for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) clearCell(x, y)
    }
    this.score += 50 // 特殊駒発動ボーナス
    const kinds = combo ? [p.kind, combo.kind].sort().join('+') : p.kind

    switch (kinds) {
      case 'harpoon':
        p.kind === 'harpoon' && p.dir === 'h' ? row(at.y) : col(at.x)
        break
      case 'hitsubo':
        blast(at.x, at.y, 2)
        break
      case 'hamushi':
        this.hamushiStrike(at, ev, 1, cleared)
        break
      case 'seiju':
        this.seijuClear(at, ev, null)
        break
      case 'harpoon+harpoon':
        row(at.y)
        col(at.x)
        break
      case 'harpoon+hitsubo':
        for (let d = -1; d <= 1; d++) {
          row(at.y + d)
          col(at.x + d)
        }
        break
      case 'hitsubo+hitsubo':
        blast(at.x, at.y, 4)
        break
      case 'hamushi+hamushi':
        this.hamushiStrike(at, ev, 3, cleared)
        break
      case 'hamushi+harpoon':
      case 'hamushi+hitsubo': {
        // 羽虫が相方を運んで目標地点で起爆
        const t = this.pickHamushiTarget()
        if (t) {
          if (kinds === 'hamushi+harpoon') {
            row(t.y)
            col(t.x)
          } else blast(t.x, t.y, 2)
        }
        break
      }
      case 'harpoon+seiju':
      case 'hitsubo+seiju':
      case 'hamushi+seiju':
        this.seijuClear(at, ev, combo && p.kind === 'seiju' ? combo : p)
        break
      case 'seiju+seiju':
        for (let y = 0; y < H; y++) row(y)
        break
    }
    ev.push({ t: 'special-fire', at, piece: p, cleared })
  }

  /** 羽虫：残ゴールに効くマスを狙う（無ければランダムの通常駒）。消したマスは cleared に記録＝ビューへ通知 */
  private hamushiStrike(from: XY, ev: BoardEvent[], count: number, cleared: XY[]) {
    // 離陸時に隣接1マスも消す（RM仕様）
    this.damageAround([from], ev)
    for (let i = 0; i < count; i++) {
      const t = this.pickHamushiTarget()
      if (!t) return
      const c = this.at(t.x, t.y)!
      if (c.block) this.damageBlock(t, ev)
      else if (c.piece?.kind === 'normal') {
        this.progressGoal({ type: 'color', color: c.piece.color }, ev)
        this.clearPieceAt(t, ev)
        cleared.push(t)
      }
    }
  }

  private pickHamushiTarget(): XY | null {
    // 優先: 残ゴールに関係する障害物/蔦苔 → 通常駒
    const cands: XY[] = []
    const want = (t: string) => this.goals.some((g, i) => g.type === t && this.goalDone[i] < g.count)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (!c) continue
        if (c.block?.type === 'kokeishi' && want('kokeishi')) cands.push({ x, y })
        if (c.block?.type === 'touhen' && want('touhen')) cands.push({ x, y })
        if (c.block?.type === 'hako' && want('touhen')) cands.push({ x, y })
        if (c.ground > 0 && want('tsutagoke')) cands.push({ x, y })
      }
    if (cands.length === 0)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (this.at(x, y)?.piece?.kind === 'normal') cands.push({ x, y })
    return cands.length ? cands[randInt(this.rng, cands.length)] : null
  }

  /** 星珠：盤上最多色を全消し。combo があれば消す代わりにその特殊駒へ変換して順次起爆 */
  private seijuClear(_at: XY, ev: BoardEvent[], convertTo: Piece | null) {
    const count = new Map<Color, XY[]>()
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = this.at(x, y)?.piece
        if (p?.kind === 'normal') {
          if (!count.has(p.color)) count.set(p.color, [])
          count.get(p.color)!.push({ x, y })
        }
      }
    let best: XY[] = []
    for (const v of count.values()) if (v.length > best.length) best = v
    if (convertTo) {
      for (const p of best) {
        const c = this.at(p.x, p.y)!
        c.piece = convertTo.kind === 'harpoon' ? { kind: 'harpoon', dir: this.rng() < 0.5 ? 'h' : 'v' } : { ...convertTo }
        ev.push({ t: 'special-born', at: p, piece: c.piece })
      }
      for (const p of best) {
        const c = this.at(p.x, p.y)!
        if (c.piece && c.piece.kind !== 'normal') {
          const q = c.piece
          c.piece = null
          this.fireSpecial(p, q, ev)
        }
      }
    } else {
      for (const p of best) {
        const c = this.at(p.x, p.y)!
        this.progressGoal({ type: 'color', color: (c.piece as { color: Color }).color }, ev)
        this.clearPieceAt(p, ev)
      }
      this.damageAround(best, ev)
    }
  }

  // ---- 重力・リフィル・連鎖 ----

  private resolveCascades(ev: BoardEvent[]) {
    let guard = 0
    while (guard++ < 50) {
      this.applyGravity(ev)
      this.refill(ev)
      if (!this.resolveMatches(ev)) break
    }
    // 連鎖収束後の詰み保険
    let g2 = 0
    while (!this.hasValidMove() && g2++ < 100) this.rerollSomePieces()
  }

  private applyGravity(ev: BoardEvent[]) {
    // 列ごとに、block/hole で区切られたセグメント内で下詰め。胞子は落ちない（浮遊）。
    for (let x = 0; x < W; x++) {
      let segBottom = H - 1
      for (let y = H - 1; y >= -1; y--) {
        const c = y >= 0 ? this.at(x, y) : null
        const solid = y < 0 || !c || c.block
        if (solid) {
          // セグメント [y+1 .. segBottom] を下詰め
          let write = segBottom
          for (let ry = segBottom; ry > y; ry--) {
            const rc = this.at(x, ry)!
            if (rc.piece && rc.piece.kind !== 'spore') {
              if (ry !== write) {
                this.at(x, write)!.piece = rc.piece
                rc.piece = null
                ev.push({ t: 'fall', from: { x, y: ry }, to: { x, y: write } })
              }
              write--
            } else if (rc.piece?.kind === 'spore') {
              // 胞子はその場に留まる：write を胞子の上へ
              write = ry - 1
            }
          }
          segBottom = y - 1
        }
      }
    }
  }

  private refill(ev: BoardEvent[]) {
    for (let x = 0; x < W; x++)
      for (let y = 0; y < H; y++) {
        const c = this.at(x, y)
        if (!c || c.block || c.piece) continue
        // 上に block がある列セグメントには湧かない（RM同様、上端からのみ供給）
        let blocked = false
        for (let uy = y - 1; uy >= 0; uy--) {
          const u = this.at(x, uy)
          if (!u || u.block) {
            blocked = true
            break
          }
        }
        if (blocked) continue
        const piece: Piece = { kind: 'normal', color: this.pickColorNoMatch(x, y) }
        c.piece = piece
        ev.push({ t: 'refill', at: { x, y }, piece })
      }
  }

  /** 手の締め：胞子の浮上・回収、勝敗判定用の状態更新 */
  private afterMove(ev: BoardEvent[]) {
    // 胞子は1手ごとに1マス浮上（上のマスの駒と入れ替わる「泡上がり」）。上端で回収。
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c?.piece?.kind !== 'spore') continue
        if (y === 0 || !this.at(x, y - 1)) {
          c.piece = null
          ev.push({ t: 'spore-collected', at: { x, y } })
          this.progressGoal({ type: 'spore' }, ev)
          continue
        }
        const up = this.at(x, y - 1)!
        if (!up.block && (!up.piece || up.piece.kind === 'normal')) {
          const t = up.piece
          up.piece = c.piece
          c.piece = t
          ev.push({ t: 'spore-rise', from: { x, y }, to: { x, y: y - 1 } })
        }
      }
  }

  private progressGoal(match: { type: Goal['type']; color?: Color }, ev: BoardEvent[]) {
    this.goals.forEach((g, i) => {
      if (g.type !== match.type) return
      if (g.type === 'color' && g.color !== match.color) return
      if (this.goalDone[i] >= g.count) return
      this.goalDone[i]++
      ev.push({ t: 'goal-progress', goal: g, done: this.goalDone[i] })
    })
  }

  get won(): boolean {
    return this.goals.every((g, i) => this.goalDone[i] >= g.count)
  }
  get lost(): boolean {
    return !this.won && this.movesLeft <= 0
  }
  /**
   * 勝利シーケンス：残手数を特殊駒（銛/歯車爆弾）に変換して全自動起爆（RM実測の再現）。
   * クリア確定後に一度だけ呼ぶ。イベント列を返す。
   */
  finishWin(): BoardEvent[] {
    const ev: BoardEvent[] = []
    const drain = Math.min(this.movesLeft, 20) // 演出上限
    for (let i = 0; i < drain; i++) {
      this.movesLeft--
      // 変換先：ランダムな通常駒
      const cands: XY[] = []
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) if (this.at(x, y)?.piece?.kind === 'normal') cands.push({ x, y })
      let at: XY | null = null
      if (cands.length > 0) {
        at = cands[randInt(this.rng, cands.length)]
        const c = this.at(at.x, at.y)!
        const p: Piece =
          this.rng() < 0.75 ? { kind: 'harpoon', dir: this.rng() < 0.5 ? 'h' : 'v' } : { kind: 'hitsubo' }
        c.piece = p
        ev.push({ t: 'special-born', at, piece: p })
      }
      ev.push({ t: 'win-drain', movesLeft: this.movesLeft, convertAt: at })
    }
    this.movesLeft = 0
    ev.push({ t: 'win-detonate-begin' })
    // 盤上の特殊駒を順に全起爆（誘爆・連鎖込み）
    let guard = 0
    while (guard++ < 80) {
      let fired = false
      outer: for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const c = this.at(x, y)
          if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') {
            const p = c.piece
            c.piece = null
            this.chain = 0
            this.fireSpecial({ x, y }, p, ev)
            this.resolveCascades(ev)
            fired = true
            break outer
          }
        }
      if (!fired) break
    }
    return ev
  }

  /** 3つ星評価（★1=クリア、★2/★3=スコア閾値。閾値はレベル定義 or 既定値） */
  get stars(): 0 | 1 | 2 | 3 {
    if (!this.won) return 0
    const s2 = this.def.star2 ?? 1500
    const s3 = this.def.star3 ?? 3000
    return this.score >= s3 ? 3 : this.score >= s2 ? 2 : 1
  }
}
