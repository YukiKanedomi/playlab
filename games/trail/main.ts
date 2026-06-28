// 囲って、咲かす。 — ひと筆で光を囲うと、中身が中心に弾けて咲く。トゲは避けて囲む。
// 作業感の根（リスク/判断の不在）を構造で潰す囲い込みゲーム。Canvas2D × juice。
import { attachPointer, fitCanvas } from '../../shared/input'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const { pointer, endFrame } = attachPointer(canvas)

let W = 0,
  H = 0
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
})

// ── 美術テーマ（render-check で見比べて選ぶ。?theme=0|1|2 で切替） ──
type Theme = {
  name: string
  bg: [string, string] // 中心→外周
  orb: string // 光のhsl色相用ベース（hsl文字列のH,S,Lで使う）
  orbHue: number
  hazard: string
  lasso: [number, number] // hue start,end
  ink: string
}
const THEMES: Theme[] = [
  {
    name: '蛍の夜庭',
    bg: ['#16212a', '#070a0e'],
    orb: '#ffd98a',
    orbHue: 44,
    hazard: '#b06bd6',
    lasso: [44, 60],
    ink: '#fff6e0',
  },
  {
    name: '深海の発光',
    bg: ['#0d2233', '#02060c'],
    orb: '#7df2e6',
    orbHue: 172,
    hazard: '#ff5d8f',
    lasso: [170, 190],
    ink: '#e6fbff',
  },
  {
    name: '墨と金',
    bg: ['#23201a', '#0a0805'],
    orb: '#f4ce6e',
    orbHue: 40,
    hazard: '#e0533a',
    lasso: [38, 50],
    ink: '#fdeec2',
  },
]
const params = new URLSearchParams(location.search)
const theme = THEMES[Math.min(2, Math.max(0, Number(params.get('theme') ?? 1)))]

// ── チューニング ──
const HP_MAX = 3
const MIN_POINTS = 6
const MIN_AREA = 2600 // これ未満の輪は不成立（誤タップよけ）
const PT_GAP = 6 // 軌跡点の最小間隔
const LINE_GUARD = 7 // 描画線とトゲの当たり余裕
const ORB_R = 9
const HAZ_R = 11
const BEST_KEY = 'playlab.enclose.best'

// ── 状態 ──
type Mode = 'title' | 'play' | 'over'
let mode: Mode = 'title'
let score = 0
let best = Number(localStorage.getItem(BEST_KEY) || 0)
let newBest = false
let hp = HP_MAX
let combo = 0
let elapsed = 0
let shake = 0
let flash = 0
let flashColor = '255,80,80'
let invuln = 0

type Orb = { x: number; y: number; vx: number; vy: number; r: number; phase: number }
type Hazard = { x: number; y: number; vx: number; vy: number; r: number; spin: number }
type Flyer = { x: number; y: number; tx: number; ty: number; r: number; life: number }
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; hue: number }
type Bloom = { x: number; y: number; r: number; max: number; life: number; maxLife: number; hue: number; n: number }
type Floater = { x: number; y: number; vy: number; life: number; text: string; big: boolean }
type Pt = { x: number; y: number }
type Dust = { x: number; y: number; vx: number; vy: number; r: number }

let orbs: Orb[] = []
let hazards: Hazard[] = []
let flyers: Flyer[] = []
let particles: Particle[] = []
let blooms: Bloom[] = []
let floaters: Floater[] = []
let dust: Dust[] = []
let trail: Pt[] = []
let drawing = false
let checked = 0
let strokeBad = false // 今のストローク中にトゲで切れたか
let strokeFlash = 0

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = clamp(t, 0, 1)
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
function polyArea(p: Pt[]) {
  let a = 0
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j].x + p[i].x) * (p[j].y - p[i].y)
  return Math.abs(a / 2)
}
function inPoly(px: number, py: number, p: Pt[]) {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    if (p[i].y > py !== p[j].y > py && px < ((p[j].x - p[i].x) * (py - p[i].y)) / (p[j].y - p[i].y) + p[i].x)
      c = !c
  }
  return c
}

function spawnOrb() {
  const m = 40
  orbs.push({ x: rand(m, W - m), y: rand(m, H - m), vx: rand(-22, 22), vy: rand(-22, 22), r: ORB_R, phase: rand(0, 9) })
}
function spawnHazard() {
  const m = 50
  const sp = 26 + elapsed * 0.7
  const a = rand(0, Math.PI * 2)
  hazards.push({ x: rand(m, W - m), y: rand(m, H - m), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: HAZ_R, spin: rand(0, 9) })
}

function reset() {
  score = 0
  hp = HP_MAX
  combo = 0
  elapsed = 0
  shake = flash = invuln = 0
  newBest = false
  orbs = []
  hazards = []
  flyers = []
  particles = []
  blooms = []
  floaters = []
  trail = []
  drawing = false
  for (let i = 0; i < 5; i++) spawnOrb()
}
function startGame() {
  reset()
  mode = 'play'
}
function gameOver() {
  mode = 'over'
  elapsed = 0
  if (score > best) {
    best = score
    newBest = true
    localStorage.setItem(BEST_KEY, String(best))
  }
}

function damage(x: number, y: number) {
  if (invuln > 0) return
  hp--
  combo = 0
  invuln = 1.1
  shake = 16
  flash = 1
  flashColor = '255,70,80'
  burst(x, y, 18, 0, 200)
  if (hp <= 0) gameOver()
}

function burst(x: number, y: number, n: number, hue: number, spd: number) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2)
    const s = rand(spd * 0.3, spd)
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), max: 0.8, r: rand(1.5, 3.5), hue: hue + rand(-10, 10) })
  }
}

// ── ひと筆を閉じて評価 ──
function closeLasso() {
  if (strokeBad || trail.length < MIN_POINTS || polyArea(trail) < MIN_AREA) {
    if (trail.length > 2 && !strokeBad) {
      // 小さすぎ/空振り：軽い不発（ペナルティ無し）
      const c = trail[Math.floor(trail.length / 2)]
      burst(c.x, c.y, 6, theme.orbHue, 60)
    }
    trail = []
    return
  }
  // トゲが輪の中にあれば catch 失敗（＝何を囲うかの判断）
  for (const hz of hazards) {
    if (inPoly(hz.x, hz.y, trail)) {
      strokeFlash = 0
      damage(hz.x, hz.y)
      floaters.push({ x: hz.x, y: hz.y - 20, vy: -40, life: 1, text: 'トゲ！', big: false })
      trail = []
      return
    }
  }
  // 中の光を集計
  let cx = 0,
    cy = 0,
    caught: Orb[] = []
  for (const o of orbs) {
    if (inPoly(o.x, o.y, trail)) {
      caught.push(o)
      cx += o.x
      cy += o.y
    }
  }
  if (caught.length === 0) {
    trail = []
    return
  }
  cx /= caught.length
  cy /= caught.length
  combo++
  const n = caught.length
  const base = (n * (n + 1)) / 2 * 10 // まとめ取りが指数的に得
  const gain = Math.round(base * (1 + (combo - 1) * 0.5))
  score += gain
  // 演出：光が中心へ吸い込まれて咲く
  for (const o of caught) {
    flyers.push({ x: o.x, y: o.y, tx: cx, ty: cy, r: o.r, life: 0.32 })
    orbs.splice(orbs.indexOf(o), 1)
  }
  blooms.push({ x: cx, y: cy, r: 0, max: 60 + n * 26, life: 0, maxLife: 0.7, hue: theme.orbHue, n })
  floaters.push({ x: cx, y: cy - 10, vy: -50, life: 1.1, text: `+${gain}${combo > 1 ? `  ${combo}x` : ''}`, big: n >= 3 })
  shake = Math.min(6 + n * 2.5, 22)
  flash = Math.min(0.15 + n * 0.06, 0.5)
  flashColor = '255,220,150'
  trail = []
}

// 入力
canvas.addEventListener('pointerdown', () => {
  if (mode === 'title') return startGame()
  if (mode === 'over') return elapsed > 0.4 ? startGame() : undefined
  // play: ストローク開始
  trail = [{ x: pointer.x, y: pointer.y }]
  drawing = true
  checked = 0
  strokeBad = false
})
window.addEventListener('pointerup', () => {
  if (mode === 'play' && drawing) {
    drawing = false
    closeLasso()
  }
})

// ── 更新 ──
function maintainSpawns(dt: number) {
  const targetOrbs = Math.min(5 + Math.floor(elapsed / 11), 13)
  if (orbs.length + flyers.length < targetOrbs && Math.random() < dt * 1.5) spawnOrb()
  const targetHaz = elapsed > 6 ? Math.min(1 + Math.floor((elapsed - 6) / 13), 5) : 0
  if (hazards.length < targetHaz && Math.random() < dt * 0.8) spawnHazard()
}

function moveDrifters(arr: { x: number; y: number; vx: number; vy: number; r: number }[], jitter: number, dt: number) {
  for (const o of arr) {
    o.vx += rand(-jitter, jitter) * dt
    o.vy += rand(-jitter, jitter) * dt
    o.x += o.vx * dt
    o.y += o.vy * dt
    const m = o.r + 6
    if (o.x < m) (o.x = m), (o.vx = Math.abs(o.vx))
    if (o.x > W - m) (o.x = W - m), (o.vx = -Math.abs(o.vx))
    if (o.y < m) (o.y = m), (o.vy = Math.abs(o.vy))
    if (o.y > H - m) (o.y = H - m), (o.vy = -Math.abs(o.vy))
  }
}

function update(dt: number) {
  elapsed += dt
  strokeFlash = Math.max(0, strokeFlash - dt * 3)

  if (mode === 'play') {
    if (invuln > 0) invuln -= dt
    maintainSpawns(dt)
    moveDrifters(orbs, 30, dt)
    for (const o of orbs) o.phase += dt * 3
    moveDrifters(hazards, 14, dt)
    for (const hz of hazards) hz.spin += dt * 2.5

    // 描画中：指へ点を足す＆新セグメントがトゲに触れたら切れる
    if (drawing) {
      const last = trail[trail.length - 1]
      if (!last || Math.hypot(pointer.x - last.x, pointer.y - last.y) > PT_GAP) {
        trail.push({ x: pointer.x, y: pointer.y })
        if (trail.length > 260) trail.shift()
      }
      for (let i = Math.max(1, checked); i < trail.length; i++) {
        const a = trail[i - 1],
          b = trail[i]
        for (const hz of hazards) {
          if (distToSeg(hz.x, hz.y, a.x, a.y, b.x, b.y) < hz.r + LINE_GUARD) {
            strokeBad = true
            damage(hz.x, hz.y)
            drawing = false
            trail = []
            break
          }
        }
        if (strokeBad) break
      }
      checked = trail.length
    }
  }

  // flyers（中心へ吸い込み→咲く）
  for (const f of flyers) {
    f.life -= dt
    const k = 1 - Math.max(0, f.life) / 0.32
    f.x += (f.tx - f.x) * Math.min(1, dt * 14)
    f.y += (f.ty - f.y) * Math.min(1, dt * 14)
    f.r = ORB_R * (1 - k * 0.6)
  }
  flyers = flyers.filter((f) => {
    if (f.life <= 0) {
      burst(f.x, f.y, 6, theme.orbHue, 90)
      return false
    }
    return true
  })

  for (const b of blooms) b.life += dt
  blooms = blooms.filter((b) => b.life < b.maxLife)

  for (const p of particles) {
    p.life -= dt
    p.x += p.vx * dt
    p.y += p.vy * dt
    p.vy += 80 * dt
    p.vx *= 0.96
  }
  particles = particles.filter((p) => p.life > 0)
  for (const f of floaters) {
    f.life -= dt
    f.y += f.vy * dt
    f.vy *= 0.94
  }
  floaters = floaters.filter((f) => f.life > 0)

  // 漂う塵（雰囲気）
  if (dust.length < 40) dust.push({ x: rand(0, W), y: rand(0, H), vx: rand(-4, 4), vy: rand(-6, -2), r: rand(0.5, 1.6) })
  for (const d of dust) {
    d.x += d.vx * dt
    d.y += d.vy * dt
    if (d.y < -5) (d.y = H + 5), (d.x = rand(0, W))
  }

  shake = Math.max(0, shake - dt * 40)
  flash = Math.max(0, flash - dt * 2)
}

// ── 描画 ──
function hsl(h: number, s: number, l: number, a = 1) {
  return `hsla(${h}, ${s}%, ${l}%, ${a})`
}

function drawBackground() {
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 30, W / 2, H * 0.55, Math.max(W, H) * 0.8)
  g.addColorStop(0, theme.bg[0])
  g.addColorStop(1, theme.bg[1])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // 塵
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const d of dust) {
    ctx.fillStyle = hsl(theme.orbHue, 60, 80, 0.12)
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r, 0, 7)
    ctx.fill()
  }
  ctx.restore()
}

function drawOrb(o: { x: number; y: number; r: number; phase?: number }) {
  const pulse = 1 + Math.sin((o.phase ?? 0)) * 0.12
  const r = o.r * pulse
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 3)
  g.addColorStop(0, hsl(theme.orbHue, 100, 88, 1))
  g.addColorStop(0.35, hsl(theme.orbHue, 95, 66, 0.85))
  g.addColorStop(1, hsl(theme.orbHue, 90, 55, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(o.x, o.y, r * 3, 0, 7)
  ctx.fill()
  ctx.fillStyle = hsl(theme.orbHue, 100, 95, 0.95)
  ctx.beginPath()
  ctx.arc(o.x, o.y, r * 0.55, 0, 7)
  ctx.fill()
  ctx.restore()
}

function drawHazard(hz: Hazard) {
  ctx.save()
  ctx.translate(hz.x, hz.y)
  ctx.rotate(hz.spin)
  // 外側のにじみ
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hz.r * 2.2)
  g.addColorStop(0, 'rgba(255,90,120,0.5)')
  g.addColorStop(1, 'rgba(255,60,90,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, hz.r * 2.2, 0, 7)
  ctx.fill()
  ctx.restore()
  // トゲ
  ctx.fillStyle = theme.hazard
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const rr = i % 2 === 0 ? hz.r + 5 : hz.r - 3
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.55)'
  ctx.beginPath()
  ctx.arc(0, 0, hz.r * 0.4, 0, 7)
  ctx.fill()
  ctx.restore()
}

function drawTrail() {
  if (trail.length < 2) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  // うっすら囲み予告（開いたパスを塗る）
  if (trail.length >= MIN_POINTS) {
    ctx.beginPath()
    ctx.moveTo(trail[0].x, trail[0].y)
    for (const p of trail) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fillStyle = hsl(theme.lasso[0], 90, 70, 0.06)
    ctx.fill()
  }
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1],
      b = trail[i]
    const k = i / trail.length
    const hue = theme.lasso[0] + (theme.lasso[1] - theme.lasso[0]) * k
    ctx.strokeStyle = hsl(hue, 95, 72, 0.9)
    ctx.lineWidth = 3 + k * 4
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  // 始点（戻れば閉じる合図）
  const s = trail[0]
  ctx.fillStyle = hsl(theme.lasso[0], 100, 80, 0.8)
  ctx.beginPath()
  ctx.arc(s.x, s.y, 5, 0, 7)
  ctx.fill()
  ctx.restore()
}

function drawBlooms() {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const b of blooms) {
    const k = b.life / b.maxLife
    const r = b.max * (1 - Math.pow(1 - k, 3))
    const alpha = (1 - k) * 0.9
    // 咲くリング
    ctx.strokeStyle = hsl(b.hue, 100, 78, alpha)
    ctx.lineWidth = 6 * (1 - k) + 1
    ctx.beginPath()
    ctx.arc(b.x, b.y, r, 0, 7)
    ctx.stroke()
    // 中心の閃光
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 0.8)
    g.addColorStop(0, hsl(b.hue, 100, 92, alpha * 0.8))
    g.addColorStop(1, hsl(b.hue, 100, 70, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(b.x, b.y, r * 0.8, 0, 7)
    ctx.fill()
  }
  ctx.restore()
}

function drawParticles() {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
    ctx.fillStyle = hsl(p.hue, 95, 70, 1)
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, 7)
    ctx.fill()
  }
  ctx.restore()
}

function drawFloaters() {
  ctx.save()
  ctx.textAlign = 'center'
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life, 0, 1)
    ctx.fillStyle = f.big ? hsl(theme.orbHue, 100, 75, 1) : theme.ink
    ctx.font = `800 ${f.big ? 28 : 18}px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
}

function drawHearts() {
  const pad = 16
  for (let i = 0; i < HP_MAX; i++) {
    const x = pad + 6 + i * 26
    const y = pad + 52 // 「← lab」ボタンの下に逃がす
    const on = i < hp
    const blink = invuln > 0 && i === hp && Math.floor(invuln * 12) % 2 === 0
    ctx.save()
    ctx.translate(x, y)
    ctx.fillStyle = on ? hsl(theme.orbHue, 90, 70, 1) : 'rgba(255,255,255,0.18)'
    if (blink) ctx.fillStyle = 'rgba(255,120,120,0.9)'
    ctx.beginPath()
    ctx.arc(-3.2, -1, 3.6, 0, 7)
    ctx.arc(3.2, -1, 3.6, 0, 7)
    ctx.moveTo(-6.6, 0.4)
    ctx.lineTo(0, 8)
    ctx.lineTo(6.6, 0.4)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }
}

function drawHUD() {
  drawHearts()
  const pad = 16
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.ink
  ctx.font = '800 30px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillText(String(score), W - pad, pad + 28)
  ctx.font = '600 12px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(`best ${best}`, W - pad, pad + 46)
  if (combo >= 2) {
    ctx.textAlign = 'center'
    ctx.fillStyle = hsl(theme.orbHue, 100, 75, 1)
    ctx.font = '800 20px "Hiragino Sans", system-ui, sans-serif'
    ctx.fillText(`${combo} chain`, W / 2, pad + 26)
  }
}

function drawCenter(title: string, lines: string[], accentHue: number) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = hsl(accentHue, 100, 72, 1)
  ctx.font = `800 clamp(30px, 8.5vw, 46px) "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText(title, W / 2, H * 0.4)
  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '500 15px "Hiragino Sans", system-ui, sans-serif'
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.4 + 40 + i * 25))
  ctx.restore()
}

function render() {
  ctx.save()
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake))
  drawBackground()
  drawBlooms()
  for (const o of orbs) drawOrb(o)
  for (const f of flyers) drawOrb(f)
  hazards.forEach(drawHazard)
  drawTrail()
  drawParticles()
  drawFloaters()
  ctx.restore()

  if (flash > 0) {
    ctx.fillStyle = `rgba(${flashColor}, ${flash * 0.4})`
    ctx.fillRect(0, 0, W, H)
  }

  if (mode === 'play') drawHUD()
  if (mode === 'title') {
    // タイトルにも光をいくつか漂わせる（drawは update 非依存で orbs を使う）
    drawCenter('囲って、咲かす。', ['光を“ひと筆”で囲うと、中身が弾けて咲く。', 'トゲは囲まない・触れない。', `best ${best}`, '', 'タップでスタート'], theme.orbHue)
  }
  if (mode === 'over') {
    drawCenter('GAME OVER', [newBest ? `NEW BEST!  ${score}` : `score ${score}`, `best ${best}`, '', 'タップでもう一回'], newBest ? theme.orbHue : 0)
  }
}

// タイトル画面でも光を漂わせて美しく見せる
function titleAmbient(dt: number) {
  if (orbs.length < 6) for (let i = orbs.length; i < 6; i++) spawnOrb()
  moveDrifters(orbs, 18, dt)
  for (const o of orbs) o.phase += dt * 2.5
}

// ── 撮影モード（美術比較用）：?shot=1 で映えフレームを固定表示 ──
function setupShot() {
  mode = 'play'
  hp = 3
  score = 1240
  combo = 4
  const cx = W * 0.5,
    cy = H * 0.52
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    orbs.push({ x: cx + Math.cos(a) * 70, y: cy + Math.sin(a) * 70, vx: 0, vy: 0, r: ORB_R, phase: i })
  }
  hazards.push({ x: W * 0.22, y: H * 0.3, vx: 0, vy: 0, r: HAZ_R, spin: 0.5 })
  hazards.push({ x: W * 0.8, y: H * 0.7, vx: 0, vy: 0, r: HAZ_R, spin: 1.2 })
  // 囲みかけの輪
  for (let i = 0; i <= 28; i++) {
    const a = -Math.PI * 0.5 + (i / 28) * Math.PI * 1.7
    trail.push({ x: cx + Math.cos(a) * 100, y: cy + Math.sin(a) * 100 })
  }
  // 咲いた瞬間のブルーム
  blooms.push({ x: cx, y: cy, r: 0, max: 180, life: 0.28, maxLife: 0.7, hue: theme.orbHue, n: 6 })
  for (let i = 0; i < 30; i++) {
    const a = rand(0, 7)
    particles.push({ x: cx, y: cy, vx: Math.cos(a) * rand(40, 160), vy: Math.sin(a) * rand(40, 160), life: 0.6, max: 0.8, r: rand(1.5, 3.5), hue: theme.orbHue })
  }
  for (let i = 0; i < 25; i++) dust.push({ x: rand(0, W), y: rand(0, H), vx: 0, vy: 0, r: rand(0.6, 1.6) })
  floaters.push({ x: cx, y: cy - 16, vy: 0, life: 1, text: '+210  4x', big: true })
}
const shotMode = params.get('shot') === '1'

// ── ループ ──
let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  if (shotMode) {
    render() // 固定フレーム
  } else {
    if (mode === 'title') titleAmbient(dt)
    update(dt)
    render()
  }
  endFrame()
  requestAnimationFrame(frame)
}
// 起動時に少し光を置く（タイトルを綺麗に）
for (let i = 0; i < 6; i++) spawnOrb()
if (shotMode) {
  orbs = []
  trail = []
  // W,H 確定後に配置
  requestAnimationFrame(() => {
    setupShot()
  })
}
requestAnimationFrame(frame)
