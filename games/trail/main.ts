// 囲って、咲かす。 — ひと筆で光を囲うと中身が中心で弾けて咲く。時間制：囲うほど時計が伸び、トゲで縮む。
// 作業感の根（リスク/判断/焦り）を構造に。Canvas2D × juice。
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

// ── 美術テーマ：色つき背景＋光は数色の調和パレット（原色を避けたおしゃれ配色）。?theme=0|1|2 ──
type Theme = {
  name: string
  bg: [string, string] // 中心→外周（黒ではなく色を置く）
  orbHues: number[] // 光の色をここからランダムに（マルチカラー）
  thornHue: number // トゲ（光と明確に別系統の色）
  lassoHue: number
  accentHue: number // 文字/スコア
  ink: string
}
const THEMES: Theme[] = [
  {
    name: '黄昏',
    bg: ['#4a2a63', '#1b1f44'], // 葡萄→藍
    orbHues: [45, 28, 350, 12], // 金・桃・薔薇・珊瑚（暖色）
    thornHue: 188, // 冷たい青緑で対比
    lassoHue: 45,
    accentHue: 40,
    ink: '#fdeee0',
  },
  {
    name: '常磐',
    bg: ['#114a48', '#122a4a'], // 深緑青→紺
    orbHues: [14, 32, 46, 350], // 珊瑚・桃・金・薔薇
    thornHue: 305, // 菫
    lassoHue: 40,
    accentHue: 30,
    ink: '#eafff9',
  },
  {
    name: '菫と若草',
    bg: ['#33306a', '#1a1b38'], // 菫青
    orbHues: [70, 160, 45, 192], // 若草・薄荷・金・空
    thornHue: 332, // 桃紅
    lassoHue: 160,
    accentHue: 72,
    ink: '#f3f0ff',
  },
]
const params = new URLSearchParams(location.search)
const theme = THEMES[Math.min(2, Math.max(0, Number(params.get('theme') ?? 0)))]

// ── チューニング ──
const START_TIME = 12
const TIME_CAP = 18 // 貯め込み過ぎ防止（焦りを保つ）
const THORN_PENALTY = 3
const MIN_POINTS = 6
const MIN_AREA = 2600
const PT_GAP = 6
const LINE_GUARD = 7
const ORB_R = 9
const HAZ_R = 11
const BEST_KEY = 'playlab.enclose.best'

// ── 状態 ──
type Mode = 'title' | 'play' | 'over'
let mode: Mode = 'title'
let score = 0
let best = Number(localStorage.getItem(BEST_KEY) || 0)
let newBest = false
let timeLeft = START_TIME
let combo = 0
let elapsed = 0
let shake = 0
let flash = 0
let flashColor = '255,80,80'
let cooldown = 0 // 直後の二重ペナルティ防止

type Orb = { x: number; y: number; vx: number; vy: number; r: number; phase: number; hue: number }
type Hazard = { x: number; y: number; vx: number; vy: number; r: number; spin: number }
type Flyer = { x: number; y: number; tx: number; ty: number; r: number; life: number; hue: number }
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; hue: number }
type Bloom = { x: number; y: number; r: number; max: number; life: number; maxLife: number; hue: number; n: number }
type Floater = { x: number; y: number; vy: number; life: number; text: string; size: number; hue: number }
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
let strokeBad = false

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const hsl = (h: number, s: number, l: number, a = 1) => `hsla(${h}, ${s}%, ${l}%, ${a})`

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
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
  orbs.push({ x: rand(m, W - m), y: rand(m, H - m), vx: rand(-22, 22), vy: rand(-22, 22), r: ORB_R, phase: rand(0, 9), hue: pick(theme.orbHues) })
}
function spawnHazard() {
  const m = 50
  const sp = 26 + elapsed * 0.7
  const a = rand(0, Math.PI * 2)
  hazards.push({ x: rand(m, W - m), y: rand(m, H - m), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: HAZ_R, spin: rand(0, 9) })
}

function reset() {
  score = 0
  timeLeft = START_TIME
  combo = 0
  elapsed = 0
  shake = flash = cooldown = 0
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

function burst(x: number, y: number, n: number, hue: number, spd: number) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2)
    const s = rand(spd * 0.3, spd)
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), max: 0.8, r: rand(1.5, 3.5), hue: hue + rand(-10, 10) })
  }
}

function penalty(x: number, y: number) {
  if (cooldown > 0) return
  cooldown = 0.6
  combo = 0
  timeLeft = Math.max(0, timeLeft - THORN_PENALTY)
  shake = 16
  flash = 1
  flashColor = '255,70,90'
  burst(x, y, 18, theme.thornHue, 200)
  floaters.push({ x, y: y - 18, vy: -45, life: 1.1, text: `-${THORN_PENALTY}s`, size: 20, hue: 352 })
  if (timeLeft <= 0) gameOver()
}

// ── ひと筆を閉じて評価 ──
function closeLasso() {
  if (strokeBad || trail.length < MIN_POINTS || polyArea(trail) < MIN_AREA) {
    if (trail.length > 2 && !strokeBad) {
      const c = trail[Math.floor(trail.length / 2)]
      burst(c.x, c.y, 6, theme.lassoHue, 60)
    }
    trail = []
    return
  }
  for (const hz of hazards) {
    if (inPoly(hz.x, hz.y, trail)) {
      penalty(hz.x, hz.y)
      trail = []
      return
    }
  }
  let cx = 0,
    cy = 0,
    hueSum = 0
  const caught: Orb[] = []
  for (const o of orbs) {
    if (inPoly(o.x, o.y, trail)) {
      caught.push(o)
      cx += o.x
      cy += o.y
      hueSum += o.hue
    }
  }
  if (caught.length === 0) {
    trail = []
    return
  }
  const n = caught.length
  cx /= n
  cy /= n
  const avgHue = hueSum / n
  combo++
  const base = ((n * (n + 1)) / 2) * 10
  const gain = Math.round(base * (1 + (combo - 1) * 0.5))
  score += gain
  // 時間ボーナス：大きく・連鎖で囲うほど伸びる
  const tGain = clamp(0.7 + (n - 1) * 0.55 + (combo - 1) * 0.15, 0.7, 4)
  timeLeft = Math.min(TIME_CAP, timeLeft + tGain)
  for (const o of caught) {
    flyers.push({ x: o.x, y: o.y, tx: cx, ty: cy, r: o.r, life: 0.32, hue: o.hue })
    orbs.splice(orbs.indexOf(o), 1)
  }
  blooms.push({ x: cx, y: cy, r: 0, max: 60 + n * 26, life: 0, maxLife: 0.7, hue: avgHue, n })
  floaters.push({ x: cx, y: cy - 12, vy: -50, life: 1.1, text: `+${gain}${combo > 1 ? `  ${combo}x` : ''}`, size: n >= 3 ? 28 : 18, hue: theme.accentHue })
  floaters.push({ x: cx, y: cy + 12, vy: -34, life: 1.2, text: `+${tGain.toFixed(1)}s`, size: 15, hue: 150 })
  shake = Math.min(6 + n * 2.5, 22)
  flash = Math.min(0.12 + n * 0.05, 0.45)
  flashColor = '255,235,200'
  trail = []
}

// 入力
canvas.addEventListener('pointerdown', () => {
  if (mode === 'title') return startGame()
  if (mode === 'over') return elapsed > 0.4 ? startGame() : undefined
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

  if (mode === 'play') {
    timeLeft -= dt * (1 + elapsed * 0.01) // じわっと加速して焦りを増す
    if (timeLeft <= 0) {
      timeLeft = 0
      gameOver()
    }
    if (cooldown > 0) cooldown -= dt
    maintainSpawns(dt)
    moveDrifters(orbs, 30, dt)
    for (const o of orbs) o.phase += dt * 3
    moveDrifters(hazards, 14, dt)
    for (const hz of hazards) hz.spin += dt * 2.5

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
            penalty(hz.x, hz.y)
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

  for (const f of flyers) {
    f.life -= dt
    f.x += (f.tx - f.x) * Math.min(1, dt * 14)
    f.y += (f.ty - f.y) * Math.min(1, dt * 14)
    const k = 1 - Math.max(0, f.life) / 0.32
    f.r = ORB_R * (1 - k * 0.6)
  }
  flyers = flyers.filter((f) => {
    if (f.life <= 0) {
      burst(f.x, f.y, 6, f.hue, 90)
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
function drawBackground() {
  const g = ctx.createRadialGradient(W / 2, H * 0.4, 30, W / 2, H * 0.55, Math.max(W, H) * 0.85)
  g.addColorStop(0, theme.bg[0])
  g.addColorStop(1, theme.bg[1])
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const d of dust) {
    ctx.fillStyle = hsl(theme.lassoHue, 60, 85, 0.1)
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r, 0, 7)
    ctx.fill()
  }
  ctx.restore()
  // 残り時間が少ないと赤いふち（焦り）
  if (mode === 'play' && timeLeft < 4) {
    const p = 0.25 + 0.2 * Math.sin(elapsed * 9)
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.7)
    v.addColorStop(0, 'rgba(255,40,70,0)')
    v.addColorStop(1, `rgba(255,40,70,${p * (1 - timeLeft / 4)})`)
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)
  }
}

function drawOrb(o: { x: number; y: number; r: number; phase?: number; hue: number }) {
  const r = o.r * (1 + Math.sin(o.phase ?? 0) * 0.12)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, r * 3)
  g.addColorStop(0, hsl(o.hue, 100, 88, 1))
  g.addColorStop(0.35, hsl(o.hue, 95, 64, 0.85))
  g.addColorStop(1, hsl(o.hue, 90, 55, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(o.x, o.y, r * 3, 0, 7)
  ctx.fill()
  ctx.fillStyle = hsl(o.hue, 100, 96, 0.95)
  ctx.beginPath()
  ctx.arc(o.x, o.y, r * 0.5, 0, 7)
  ctx.fill()
  ctx.restore()
}

function drawHazard(hz: Hazard) {
  ctx.save()
  ctx.translate(hz.x, hz.y)
  ctx.rotate(hz.spin)
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hz.r * 2.3)
  g.addColorStop(0, hsl(theme.thornHue, 90, 65, 0.5))
  g.addColorStop(1, hsl(theme.thornHue, 90, 60, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, hz.r * 2.3, 0, 7)
  ctx.fill()
  ctx.restore()
  ctx.fillStyle = hsl(theme.thornHue, 85, 62)
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const rr = i % 2 === 0 ? hz.r + 5 : hz.r - 3
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
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
  if (trail.length >= MIN_POINTS) {
    ctx.beginPath()
    ctx.moveTo(trail[0].x, trail[0].y)
    for (const p of trail) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fillStyle = hsl(theme.lassoHue, 90, 72, 0.07)
    ctx.fill()
  }
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1],
      b = trail[i]
    const k = i / trail.length
    ctx.strokeStyle = hsl(theme.lassoHue, 95, 74, 0.9)
    ctx.lineWidth = 3 + k * 4
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  const s = trail[0]
  ctx.fillStyle = hsl(theme.lassoHue, 100, 82, 0.85)
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
    ctx.strokeStyle = hsl(b.hue, 100, 80, alpha)
    ctx.lineWidth = 6 * (1 - k) + 1
    ctx.beginPath()
    ctx.arc(b.x, b.y, r, 0, 7)
    ctx.stroke()
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r * 0.8)
    g.addColorStop(0, hsl(b.hue, 100, 92, alpha * 0.8))
    g.addColorStop(1, hsl(b.hue, 100, 72, 0))
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
    ctx.fillStyle = hsl(f.hue, 90, 72, 1)
    ctx.font = `800 ${f.size}px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
}

function drawHUD() {
  const cx = W / 2
  const low = timeLeft < 4
  const pulse = low ? 0.7 + 0.3 * Math.sin(elapsed * 10) : 1
  // タイマー数字（大きく中央上）
  ctx.save()
  ctx.textAlign = 'center'
  ctx.globalAlpha = pulse
  ctx.fillStyle = low ? hsl(352, 90, 65) : theme.ink
  ctx.font = '800 38px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillText(timeLeft.toFixed(1), cx, 50)
  ctx.restore()
  // バー
  const bw = Math.min(220, W - 80)
  const r = clamp(timeLeft / TIME_CAP, 0, 1)
  ctx.fillStyle = 'rgba(255,255,255,0.14)'
  ctx.fillRect(cx - bw / 2, 60, bw, 5)
  ctx.fillStyle = low ? hsl(352, 90, 62) : hsl(theme.accentHue, 90, 65)
  ctx.fillRect(cx - bw / 2, 60, bw * r, 5)
  // スコア
  ctx.textAlign = 'right'
  ctx.fillStyle = theme.ink
  ctx.font = '800 24px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillText(String(score), W - 16, 38)
  ctx.font = '600 12px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(`best ${best}`, W - 16, 54)
  if (combo >= 2) {
    ctx.textAlign = 'center'
    ctx.fillStyle = hsl(theme.accentHue, 95, 70)
    ctx.font = '800 16px "Hiragino Sans", system-ui, sans-serif'
    ctx.fillText(`${combo} chain`, cx, 86) // タイマーバーの下に
  }
}

function drawCenter(title: string, lines: string[], accentHue: number) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = hsl(accentHue, 95, 72, 1)
  ctx.font = `800 clamp(30px, 8.5vw, 46px) "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText(title, W / 2, H * 0.4)
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
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
  if (mode === 'title')
    drawCenter('囲って、咲かす。', ['光をひと筆で囲うと、中身が弾けて咲く。', 'うまく囲うほど時間が増える。トゲは触れない。', `best ${best}`, '', 'タップでスタート'], theme.accentHue)
  if (mode === 'over')
    drawCenter('TIME UP', [newBest ? `NEW BEST!  ${score}` : `score ${score}`, `best ${best}`, '', 'タップでもう一回'], newBest ? theme.accentHue : 352)
}

function titleAmbient(dt: number) {
  while (orbs.length < 6) spawnOrb()
  moveDrifters(orbs, 18, dt)
  for (const o of orbs) o.phase += dt * 2.5
}

// ── 撮影モード（美術比較用）：?shot=1 ──
function setupShot() {
  mode = 'play'
  score = 1240
  combo = 4
  timeLeft = 9.4
  const cx = W * 0.5,
    cy = H * 0.52
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    orbs.push({ x: cx + Math.cos(a) * 70, y: cy + Math.sin(a) * 70, vx: 0, vy: 0, r: ORB_R, phase: i, hue: theme.orbHues[i % theme.orbHues.length] })
  }
  hazards.push({ x: W * 0.22, y: H * 0.3, vx: 0, vy: 0, r: HAZ_R, spin: 0.5 })
  hazards.push({ x: W * 0.8, y: H * 0.72, vx: 0, vy: 0, r: HAZ_R, spin: 1.2 })
  for (let i = 0; i <= 28; i++) {
    const a = -Math.PI * 0.5 + (i / 28) * Math.PI * 1.7
    trail.push({ x: cx + Math.cos(a) * 100, y: cy + Math.sin(a) * 100 })
  }
  blooms.push({ x: cx, y: cy, r: 0, max: 180, life: 0.28, maxLife: 0.7, hue: theme.orbHues[0], n: 6 })
  for (let i = 0; i < 30; i++) {
    const a = rand(0, 7)
    particles.push({ x: cx, y: cy, vx: Math.cos(a) * rand(40, 160), vy: Math.sin(a) * rand(40, 160), life: 0.6, max: 0.8, r: rand(1.5, 3.5), hue: pick(theme.orbHues) })
  }
  for (let i = 0; i < 25; i++) dust.push({ x: rand(0, W), y: rand(0, H), vx: 0, vy: 0, r: rand(0.6, 1.6) })
  floaters.push({ x: cx, y: cy - 14, vy: 0, life: 1, text: '+210  4x', size: 28, hue: theme.accentHue })
  floaters.push({ x: cx, y: cy + 14, vy: 0, life: 1, text: '+2.6s', size: 15, hue: 150 })
}
const shotMode = params.get('shot') === '1'

// ── ループ ──
let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  if (shotMode) {
    render()
  } else {
    if (mode === 'title') titleAmbient(dt)
    update(dt)
    render()
  }
  endFrame()
  requestAnimationFrame(frame)
}
for (let i = 0; i < 6; i++) spawnOrb()
if (shotMode) {
  orbs = []
  trail = []
  requestAnimationFrame(() => setupShot())
}
requestAnimationFrame(frame)
