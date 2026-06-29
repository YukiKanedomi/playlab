// 囲って、咲かす。 — ひと筆で標本を囲うと中身が中心で“咲く”（インクのにじみ）。時間制。
// Playlab 共通キット（theme/juice/shell/transition）を使う第一号。初期デザイン＝ラボ・スキン。
import { attachPointer, fitCanvas } from '../../shared/input'
import { LAB, SPECIMEN_COLORS, hexA, drawPaperBackground, drawSpecimen } from '../../shared/theme'
import { makeShake, Particles, easeOutBack, clamp } from '../../shared/juice'
import { drawExpLabel, drawPanel } from '../../shared/shell'
import { enterTransition, wireLink } from '../../shared/transition'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const { pointer, endFrame } = attachPointer(canvas)

let W = 0,
  H = 0
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
})
const params = new URLSearchParams(location.search)

const EXP = 'No.01'
const TITLE = '囲って、咲かす。'

// ── チューニング ──
const START_TIME = 12
const TIME_CAP = 18
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
let flash = 0
let cooldown = 0
let panelT = 0 // タイトル/結果カードの出現イーズ

const shakeFx = makeShake(24)
const fx = new Particles()

type Orb = { x: number; y: number; vx: number; vy: number; r: number; phase: number; color: string }
type Hazard = { x: number; y: number; vx: number; vy: number; r: number; spin: number }
type Flyer = { x: number; y: number; tx: number; ty: number; r: number; life: number; color: string }
type Bloom = { x: number; y: number; r: number; max: number; life: number; maxLife: number; color: string }
type Floater = { x: number; y: number; vy: number; life: number; text: string; size: number; color: string }
type Pt = { x: number; y: number }

let orbs: Orb[] = []
let hazards: Hazard[] = []
let flyers: Flyer[] = []
let blooms: Bloom[] = []
let floaters: Floater[] = []
let trail: Pt[] = []
let drawing = false
let checked = 0
let strokeBad = false

const rand = (a: number, b: number) => a + Math.random() * (b - a)
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1)
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
  orbs.push({ x: rand(m, W - m), y: rand(m, H - m), vx: rand(-22, 22), vy: rand(-22, 22), r: ORB_R, phase: rand(0, 9), color: pick(SPECIMEN_COLORS) })
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
  flash = cooldown = 0
  newBest = false
  orbs = []
  hazards = []
  flyers = []
  blooms = []
  floaters = []
  fx.list = []
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
  panelT = 0
  if (score > best) {
    best = score
    newBest = true
    localStorage.setItem(BEST_KEY, String(best))
  }
}

function penalty(x: number, y: number) {
  if (cooldown > 0) return
  cooldown = 0.6
  combo = 0
  timeLeft = Math.max(0, timeLeft - THORN_PENALTY)
  shakeFx.set(16)
  flash = 1
  fx.burst(x, y, 18, LAB.ink, 200)
  floaters.push({ x, y: y - 18, vy: -45, life: 1.1, text: `-${THORN_PENALTY}s`, size: 20, color: LAB.danger })
  if (timeLeft <= 0) gameOver()
}

function closeLasso() {
  if (strokeBad || trail.length < MIN_POINTS || polyArea(trail) < MIN_AREA) {
    if (trail.length > 2 && !strokeBad) {
      const c = trail[Math.floor(trail.length / 2)]
      fx.burst(c.x, c.y, 5, LAB.muted, 50)
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
    cy = 0
  const caught: Orb[] = []
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
  const n = caught.length
  cx /= n
  cy /= n
  combo++
  const base = ((n * (n + 1)) / 2) * 10
  const gain = Math.round(base * (1 + (combo - 1) * 0.5))
  score += gain
  const tGain = clamp(0.7 + (n - 1) * 0.55 + (combo - 1) * 0.15, 0.7, 4)
  timeLeft = Math.min(TIME_CAP, timeLeft + tGain)
  const bloomColor = caught[0].color
  for (const o of caught) {
    flyers.push({ x: o.x, y: o.y, tx: cx, ty: cy, r: o.r, life: 0.32, color: o.color })
    orbs.splice(orbs.indexOf(o), 1)
  }
  blooms.push({ x: cx, y: cy, r: 0, max: 60 + n * 26, life: 0, maxLife: 0.75, color: bloomColor })
  floaters.push({ x: cx, y: cy - 12, vy: -50, life: 1.1, text: `+${gain}${combo > 1 ? `  ${combo}x` : ''}`, size: n >= 3 ? 28 : 18, color: LAB.ink })
  floaters.push({ x: cx, y: cy + 12, vy: -34, life: 1.2, text: `+${tGain.toFixed(1)}s`, size: 15, color: '#2f7d6b' })
  shakeFx.set(Math.min(6 + n * 2.5, 22))
  flash = Math.min(0.1 + n * 0.04, 0.4)
  trail = []
}

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
  if (mode === 'title' || mode === 'over') panelT = Math.min(1, panelT + dt * 3)

  if (mode === 'play') {
    timeLeft -= dt * (1 + elapsed * 0.01)
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
      fx.burst(f.x, f.y, 6, f.color, 90)
      return false
    }
    return true
  })

  for (const b of blooms) b.life += dt
  blooms = blooms.filter((b) => b.life < b.maxLife)

  fx.update(dt)
  for (const f of floaters) {
    f.life -= dt
    f.y += f.vy * dt
    f.vy *= 0.94
  }
  floaters = floaters.filter((f) => f.life > 0)

  shakeFx.update(dt)
  flash = Math.max(0, flash - dt * 2)
}

// ── 描画（ラボ・スキン） ──
function drawOrb(o: { x: number; y: number; r: number; phase?: number; color: string }) {
  drawSpecimen(ctx, o.x, o.y, o.r * (1 + Math.sin(o.phase ?? 0) * 0.08), o.color)
}

function drawHazard(hz: Hazard) {
  ctx.save()
  ctx.translate(hz.x, hz.y)
  ctx.rotate(hz.spin)
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hz.r * 2)
  g.addColorStop(0, hexA(LAB.ink, 0.18))
  g.addColorStop(1, hexA(LAB.ink, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(0, 0, hz.r * 2, 0, 7)
  ctx.fill()
  ctx.fillStyle = LAB.ink
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const rr = i % 2 === 0 ? hz.r + 5 : hz.r - 3
    ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
  }
  ctx.closePath()
  ctx.fill()
  ctx.fillStyle = LAB.paper
  ctx.beginPath()
  ctx.arc(0, 0, hz.r * 0.34, 0, 7)
  ctx.fill()
  ctx.restore()
}

function drawTrail() {
  if (trail.length < 2) return
  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  if (trail.length >= MIN_POINTS) {
    ctx.beginPath()
    ctx.moveTo(trail[0].x, trail[0].y)
    for (const p of trail) ctx.lineTo(p.x, p.y)
    ctx.closePath()
    ctx.fillStyle = hexA(LAB.amber, 0.08)
    ctx.fill()
  }
  ctx.strokeStyle = hexA(LAB.ink, 0.85)
  ctx.lineWidth = 3.5
  ctx.beginPath()
  ctx.moveTo(trail[0].x, trail[0].y)
  for (const p of trail) ctx.lineTo(p.x, p.y)
  ctx.stroke()
  const s = trail[0]
  ctx.fillStyle = LAB.amber
  ctx.beginPath()
  ctx.arc(s.x, s.y, 5, 0, 7)
  ctx.fill()
  ctx.restore()
}

function drawBlooms() {
  for (const b of blooms) {
    const k = b.life / b.maxLife
    const r = b.max * (1 - Math.pow(1 - k, 3))
    const alpha = (1 - k) * 0.8
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r)
    g.addColorStop(0, hexA(b.color, alpha * 0.5))
    g.addColorStop(0.6, hexA(b.color, alpha * 0.22))
    g.addColorStop(1, hexA(b.color, 0))
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(b.x, b.y, r, 0, 7)
    ctx.fill()
    ctx.strokeStyle = hexA(b.color, alpha)
    ctx.lineWidth = 3 * (1 - k) + 0.6
    ctx.beginPath()
    ctx.arc(b.x, b.y, r * 0.92, 0, 7)
    ctx.stroke()
  }
}

function drawFloaters() {
  ctx.save()
  ctx.textAlign = 'center'
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life, 0, 1)
    ctx.fillStyle = f.color
    ctx.font = `800 ${f.size}px ${LAB.font}`
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
}

function drawHUD() {
  const cx = W / 2
  const low = timeLeft < 4
  const pulse = low ? 0.6 + 0.4 * Math.sin(elapsed * 10) : 1
  ctx.save()
  ctx.textAlign = 'center'
  ctx.globalAlpha = pulse
  ctx.fillStyle = low ? LAB.danger : LAB.ink
  ctx.font = `800 38px ${LAB.font}`
  ctx.fillText(timeLeft.toFixed(1), cx, 50)
  ctx.restore()
  const bw = Math.min(220, W - 80)
  const r = clamp(timeLeft / TIME_CAP, 0, 1)
  ctx.fillStyle = hexA(LAB.ink, 0.12)
  ctx.fillRect(cx - bw / 2, 60, bw, 5)
  ctx.fillStyle = low ? LAB.danger : LAB.amber
  ctx.fillRect(cx - bw / 2, 60, bw * r, 5)
  ctx.textAlign = 'right'
  ctx.fillStyle = LAB.ink
  ctx.font = `800 24px ${LAB.font}`
  ctx.fillText(String(score), W - 16, 38)
  ctx.font = `600 12px ${LAB.font}`
  ctx.fillStyle = LAB.muted
  ctx.fillText(`best ${best}`, W - 16, 54)
  if (combo >= 2) {
    ctx.textAlign = 'center'
    ctx.fillStyle = LAB.amber
    ctx.font = `800 16px ${LAB.font}`
    ctx.fillText(`${combo} chain`, cx, 86)
  }
}

function render() {
  ctx.save()
  shakeFx.apply(ctx)
  drawPaperBackground(ctx, W, H)
  drawBlooms()
  for (const o of orbs) drawOrb(o)
  for (const f of flyers) drawOrb(f)
  hazards.forEach(drawHazard)
  drawTrail()
  fx.draw(ctx)
  drawFloaters()
  ctx.restore()

  if (mode === 'play' && timeLeft < 4) {
    const p = (0.18 + 0.14 * Math.sin(elapsed * 9)) * (1 - timeLeft / 4)
    const v = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.34, W / 2, H / 2, Math.max(W, H) * 0.7)
    v.addColorStop(0, hexA(LAB.danger, 0))
    v.addColorStop(1, hexA(LAB.danger, p))
    ctx.fillStyle = v
    ctx.fillRect(0, 0, W, H)
  }
  if (flash > 0) {
    ctx.fillStyle = hexA(LAB.ink, flash * 0.12)
    ctx.fillRect(0, 0, W, H)
  }

  if (mode === 'play') {
    drawHUD()
    drawExpLabel(ctx, W, H, EXP, TITLE)
  }
  const scale = easeOutBack(clamp(panelT, 0, 1))
  if (mode === 'title')
    drawPanel(ctx, W, H, TITLE, ['標本をひと筆で囲むと咲く。', '大きく囲うほど時間が増える。', 'トゲは囲まない・触れない。', `best ${best}`, '', 'タップでスタート'], LAB.ink, scale)
  if (mode === 'over')
    drawPanel(ctx, W, H, 'TIME UP', [newBest ? `NEW BEST!  ${score}` : `score ${score}`, `best ${best}`, '', 'タップでもう一回'], newBest ? LAB.amber : LAB.danger, scale)
}

function titleAmbient(dt: number) {
  while (orbs.length < 6) spawnOrb()
  moveDrifters(orbs, 18, dt)
  for (const o of orbs) o.phase += dt * 2.5
}

// 撮影モード（?shot=1）
function setupShot() {
  mode = 'play'
  score = 1240
  combo = 4
  timeLeft = 9.4
  const cx = W * 0.5,
    cy = H * 0.52
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2
    orbs.push({ x: cx + Math.cos(a) * 70, y: cy + Math.sin(a) * 70, vx: 0, vy: 0, r: ORB_R, phase: i, color: SPECIMEN_COLORS[i % SPECIMEN_COLORS.length] })
  }
  hazards.push({ x: W * 0.22, y: H * 0.3, vx: 0, vy: 0, r: HAZ_R, spin: 0.5 })
  hazards.push({ x: W * 0.8, y: H * 0.72, vx: 0, vy: 0, r: HAZ_R, spin: 1.2 })
  for (let i = 0; i <= 28; i++) {
    const a = -Math.PI * 0.5 + (i / 28) * Math.PI * 1.7
    trail.push({ x: cx + Math.cos(a) * 100, y: cy + Math.sin(a) * 100 })
  }
  blooms.push({ x: cx, y: cy, r: 0, max: 180, life: 0.3, maxLife: 0.75, color: SPECIMEN_COLORS[0] })
  fx.burst(cx, cy, 26, SPECIMEN_COLORS[2], 150, 40)
  floaters.push({ x: cx, y: cy - 14, vy: 0, life: 1, text: '+210  4x', size: 28, color: LAB.ink })
  floaters.push({ x: cx, y: cy + 14, vy: 0, life: 1, text: '+2.6s', size: 15, color: '#2f7d6b' })
}
const shotMode = params.get('shot') === '1'

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
} else {
  enterTransition()
  const back = document.querySelector('a.back') as HTMLAnchorElement | null
  if (back) wireLink(back)
}
requestAnimationFrame(frame)
