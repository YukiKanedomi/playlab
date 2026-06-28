// なぞって、すくう。 — 軌跡で落ちてくる光をかき集める60秒タイムアタック
// 1本目。仮の丸キャラ（後で自作キャラに差し替え）。Canvas2D × trail/particle/juice。
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

// ── チューニング ──
const ROUND_TIME = 60
const COLLECT_R = 34 // 集める判定半径（スマホで気持ちよく拾える広さ）
const COMBO_WINDOW = 1.4 // この秒数 拾わないとコンボ消滅
const HEAD_R = 18
const BEST_KEY = 'playlab.trail.best'

// ── 状態 ──
type Mode = 'title' | 'play' | 'over'
let mode: Mode = 'title'
let score = 0
let best = Number(localStorage.getItem(BEST_KEY) || 0)
let newBest = false
let combo = 0
let comboTimer = 0
let timeLeft = ROUND_TIME
let shake = 0
let flash = 0
let invuln = 0
let bgPulse = 0
let elapsed = 0

// 本体（指に追従する丸キャラ）
const head = { x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, face: 'neutral' as Face, faceT: 0 }
type Face = 'neutral' | 'happy' | 'grin' | 'shock'

type Pellet = { x: number; y: number; vy: number; vx: number; r: number; hue: number; bomb: boolean; t: number }
type Particle = { x: number; y: number; vx: number; vy: number; life: number; max: number; r: number; c: string }
type Floater = { x: number; y: number; vy: number; life: number; text: string; big: boolean }
type Trail = { x: number; y: number; life: number }

let pellets: Pellet[] = []
let particles: Particle[] = []
let floaters: Floater[] = []
let trail: Trail[] = []
let spawnT = 0

function reset() {
  score = 0
  combo = 0
  comboTimer = 0
  timeLeft = ROUND_TIME
  elapsed = 0
  shake = 0
  flash = 0
  invuln = 0
  newBest = false
  pellets = []
  particles = []
  floaters = []
  trail = []
  spawnT = 0
  head.x = head.px = W / 2
  head.y = head.py = H / 2
  head.vx = head.vy = 0
  head.face = 'neutral'
}

function startGame() {
  reset()
  mode = 'play'
}

// 入力で状態遷移（タイトル/リザルトはタップでスタート）
canvas.addEventListener('pointerdown', () => {
  if (mode === 'title') startGame()
  else if (mode === 'over' && elapsed > 0.4) startGame() // 誤連打よけ
})

// ── ユーティリティ ──
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

// 点と線分の距離（軌跡のなぞり判定に使う＝速く動いても拾える）
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax,
    dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = clamp(t, 0, 1)
  const cx = ax + t * dx,
    cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function spawnPellet() {
  const bomb = elapsed > 6 && Math.random() < clamp(0.08 + elapsed * 0.0016, 0.08, 0.2)
  pellets.push({
    x: rand(30, W - 30),
    y: -20,
    vy: rand(70, 120) + elapsed * 0.6,
    vx: rand(-20, 20),
    r: bomb ? 13 : rand(7, 11),
    hue: bomb ? 0 : rand(38, 52), // 通常=琥珀〜黄、爆弾=赤
    bomb,
    t: 0,
  })
}

function burst(x: number, y: number, n: number, hue: number, spd: number) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2)
    const s = rand(spd * 0.3, spd)
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      life: rand(0.3, 0.7),
      max: 0.7,
      r: rand(1.5, 3.5),
      c: `hsl(${hue + rand(-8, 8)} 95% ${rand(60, 78)}%)`,
    })
  }
}

function collect(p: Pellet) {
  combo++
  comboTimer = COMBO_WINDOW
  const gain = combo
  score += gain
  burst(p.x, p.y, 8 + Math.min(combo, 12), 46, 120 + combo * 6)
  floaters.push({ x: p.x, y: p.y, vy: -40, life: 0.8, text: `+${gain}`, big: combo >= 6 })
  // コンボが伸びるほど顔と画面を盛る
  head.face = combo >= 8 ? 'grin' : combo >= 3 ? 'happy' : 'neutral'
  head.faceT = 0.5
  if (combo % 5 === 0) {
    shake = Math.min(shake + 6, 16)
    bgPulse = 1
  }
}

function hitBomb(p: Pellet) {
  combo = 0
  comboTimer = 0
  timeLeft = Math.max(0, timeLeft - 2)
  shake = 18
  flash = 1
  invuln = 0.6
  head.face = 'shock'
  head.faceT = 0.7
  burst(p.x, p.y, 22, 0, 220)
}

// ── 更新 ──
function update(dt: number) {
  elapsed += dt
  bgPulse = Math.max(0, bgPulse - dt * 2.5)

  if (mode === 'play') {
    timeLeft -= dt
    if (timeLeft <= 0) {
      timeLeft = 0
      mode = 'over'
      elapsed = 0
      if (score > best) {
        best = score
        newBest = true
        localStorage.setItem(BEST_KEY, String(best))
      }
    }

    // 本体を指へ追従（ラグ＝手触り）
    head.px = head.x
    head.py = head.y
    const tx = pointer.down ? pointer.x : head.x
    const ty = pointer.down ? pointer.y : head.y
    head.x += (tx - head.x) * Math.min(1, dt * 18)
    head.y += (ty - head.y) * Math.min(1, dt * 18)
    head.vx = head.x - head.px
    head.vy = head.y - head.py

    // 軌跡
    if (pointer.down) trail.push({ x: head.x, y: head.y, life: 0.45 })
    for (const t of trail) t.life -= dt
    trail = trail.filter((t) => t.life > 0)
    if (trail.length > 40) trail.splice(0, trail.length - 40)

    // コンボ減衰
    if (comboTimer > 0) {
      comboTimer -= dt
      if (comboTimer <= 0) combo = 0
    }
    if (invuln > 0) invuln -= dt

    // 出現
    spawnT -= dt
    const interval = clamp(0.55 - elapsed * 0.005, 0.28, 0.55)
    if (spawnT <= 0) {
      spawnPellet()
      spawnT = interval
    }

    // 粒の移動＆判定
    for (const p of pellets) {
      p.t += dt
      p.y += p.vy * dt
      p.x += p.vx * dt
      if (p.x < p.r || p.x > W - p.r) p.vx *= -1
      // なぞり判定：本体の移動線分との距離
      const d = pointer.down
        ? distToSeg(p.x, p.y, head.px, head.py, head.x, head.y)
        : Math.hypot(p.x - head.x, p.y - head.y)
      if (d < COLLECT_R + p.r) {
        if (p.bomb) {
          if (invuln <= 0) hitBomb(p)
        } else {
          collect(p)
        }
        p.y = H + 999 // 回収済みフラグ代わり
      }
    }
    pellets = pellets.filter((p) => p.y < H + 40)
  }

  // パーティクル・フローター（全モード共通で動かす）
  for (const pt of particles) {
    pt.life -= dt
    pt.x += pt.vx * dt
    pt.y += pt.vy * dt
    pt.vy += 220 * dt
    pt.vx *= 0.96
  }
  particles = particles.filter((p) => p.life > 0)
  for (const f of floaters) {
    f.life -= dt
    f.y += f.vy * dt
  }
  floaters = floaters.filter((f) => f.life > 0)

  shake = Math.max(0, shake - dt * 40)
  flash = Math.max(0, flash - dt * 2.5)
}

// ── 描画 ──
function drawBackground() {
  ctx.fillStyle = '#0e0d12'
  ctx.fillRect(0, 0, W, H)
  const g = ctx.createRadialGradient(W / 2, H * 0.42, 40, W / 2, H * 0.5, Math.max(W, H) * 0.75)
  const glow = 0.06 + bgPulse * 0.12
  g.addColorStop(0, `rgba(255, 200, 120, ${glow})`)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
}

function drawTrail() {
  if (trail.length < 2) return
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1],
      b = trail[i]
    const k = i / trail.length
    ctx.strokeStyle = `rgba(255, ${180 + k * 60}, ${90 + k * 60}, ${b.life * 0.9})`
    ctx.lineWidth = 2 + k * 16
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawPellet(p: Pellet) {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const r = p.r
  if (p.bomb) {
    // 爆弾＝赤くトゲトゲ、危険サイン
    ctx.translate(p.x, p.y)
    ctx.rotate(p.t * 3)
    ctx.fillStyle = `rgba(255, 70, 60, 0.95)`
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const rr = i % 2 === 0 ? r + 4 : r - 2
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr)
    }
    ctx.closePath()
    ctx.fill()
  } else {
    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4)
    g.addColorStop(0, `hsla(${p.hue}, 100%, 80%, 1)`)
    g.addColorStop(0.4, `hsla(${p.hue}, 100%, 62%, 0.8)`)
    g.addColorStop(1, `hsla(${p.hue}, 100%, 50%, 0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawHead() {
  const speed = Math.hypot(head.vx, head.vy)
  const stretch = clamp(speed * 0.02, 0, 0.45)
  const ang = Math.atan2(head.vy, head.vx)
  ctx.save()
  ctx.translate(head.x, head.y)
  ctx.rotate(ang)
  ctx.scale(1 + stretch, 1 - stretch * 0.7)
  ctx.rotate(-ang)

  // グロー
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, HEAD_R * 2.6)
  gg.addColorStop(0, 'rgba(255, 224, 130, 0.55)')
  gg.addColorStop(1, 'rgba(255,210,120,0)')
  ctx.fillStyle = gg
  ctx.beginPath()
  ctx.arc(0, 0, HEAD_R * 2.6, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // 体（黄色い丸）
  const body = ctx.createRadialGradient(-4, -5, 2, 0, 0, HEAD_R)
  body.addColorStop(0, '#ffe98c')
  body.addColorStop(1, '#f6c945')
  ctx.fillStyle = invuln > 0 && Math.floor(invuln * 20) % 2 === 0 ? '#ffd0d0' : body
  ctx.beginPath()
  ctx.arc(0, 0, HEAD_R, 0, Math.PI * 2)
  ctx.fill()

  // 顔
  ctx.fillStyle = '#23201a'
  ctx.strokeStyle = '#23201a'
  ctx.lineWidth = 2
  ctx.lineCap = 'round'
  const face = head.face
  const ex = 6
  if (face === 'shock') {
    // 驚き：点目を縦長＋口あんぐり
    ctx.beginPath(); ctx.ellipse(-ex, -3, 2, 3.5, 0, 0, 7); ctx.ellipse(ex, -3, 2, 3.5, 0, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.arc(0, 6, 3, 0, Math.PI * 2); ctx.fill()
  } else if (face === 'grin') {
    // ニカッ：への字逆＋大口
    ctx.beginPath(); ctx.arc(-ex, -3, 2, 0, 7); ctx.arc(ex, -3, 2, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.arc(0, 3, 6, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke()
  } else if (face === 'happy') {
    ctx.beginPath(); ctx.arc(-ex, -3, 2, 0, 7); ctx.arc(ex, -3, 2, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.arc(0, 4, 4, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke()
  } else {
    // とぼけ
    ctx.beginPath(); ctx.arc(-ex, -2, 2, 0, 7); ctx.arc(ex, -2, 2, 0, 7); ctx.fill()
    ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(3, 5); ctx.stroke()
  }
  ctx.restore()
}

function drawParticles() {
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  for (const p of particles) {
    ctx.globalAlpha = clamp(p.life / p.max, 0, 1)
    ctx.fillStyle = p.c
    ctx.beginPath()
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawFloaters() {
  ctx.save()
  ctx.textAlign = 'center'
  for (const f of floaters) {
    ctx.globalAlpha = clamp(f.life / 0.8, 0, 1)
    ctx.fillStyle = f.big ? '#ffd24a' : '#fff4d6'
    ctx.font = `700 ${f.big ? 26 : 16}px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.restore()
}

function drawHUD() {
  // タイマーバー
  const pad = 16
  const top = Math.max(14, (window.visualViewport ? 0 : 0)) + pad
  const barW = W - pad * 2
  const ratio = timeLeft / ROUND_TIME
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(pad, top, barW, 5)
  const low = timeLeft <= 10
  const pulse = low ? 0.5 + 0.5 * Math.sin(elapsed * 10) : 1
  ctx.fillStyle = low ? `rgba(255, 150, 60, ${pulse})` : 'rgba(255, 224, 130, 0.95)'
  ctx.fillRect(pad, top, barW * clamp(ratio, 0, 1), 5)

  // スコア
  ctx.textAlign = 'right'
  ctx.fillStyle = '#fff'
  ctx.font = '800 28px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillText(String(score), W - pad, top + 40)
  ctx.font = '600 12px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillStyle = 'rgba(255,255,255,0.5)'
  ctx.fillText(`best ${best}`, W - pad, top + 58)

  // 残り秒
  ctx.textAlign = 'left'
  ctx.fillStyle = low ? '#ff9b3c' : 'rgba(255,255,255,0.85)'
  ctx.font = '800 28px "Hiragino Sans", system-ui, sans-serif'
  ctx.fillText(Math.ceil(timeLeft).toString(), pad, top + 40)

  // コンボ（本体の近く）
  if (combo >= 2) {
    ctx.save()
    ctx.textAlign = 'center'
    const pop = comboTimer > COMBO_WINDOW - 0.12 ? 1.25 : 1
    ctx.translate(head.x, head.y - HEAD_R - 16)
    ctx.scale(pop, pop)
    ctx.fillStyle = combo >= 8 ? '#ffd24a' : '#fff'
    ctx.font = '800 22px "Hiragino Sans", system-ui, sans-serif'
    ctx.fillText(`${combo}x`, 0, 0)
    ctx.restore()
  }
}

function drawCenterText(title: string, lines: string[], accent?: string) {
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = accent || '#fff'
  ctx.font = `800 clamp(28px, 8vw, 44px) "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText(title, W / 2, H * 0.42)
  ctx.fillStyle = 'rgba(255,255,255,0.7)'
  ctx.font = '500 15px "Hiragino Sans", system-ui, sans-serif'
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.42 + 36 + i * 24))
  ctx.restore()
}

function render() {
  ctx.save()
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake))
  drawBackground()
  pellets.forEach(drawPellet)
  drawTrail()
  drawParticles()
  if (mode !== 'title') drawHead()
  drawFloaters()
  ctx.restore()

  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 60, 50, ${flash * 0.5})`
    ctx.fillRect(0, 0, W, H)
  }

  if (mode === 'play') drawHUD()
  if (mode === 'title') {
    drawHead2(W / 2, H * 0.28) // タイトルにも丸キャラを置く
    drawCenterText('なぞって、すくう。', ['落ちてくる光を、指でかき集める。', `60秒タイムアタック ・ best ${best}`, '', 'タップでスタート'], '#ffd24a')
  }
  if (mode === 'over') {
    drawCenterText(
      'TIME UP',
      [newBest ? `NEW BEST!  ${score}` : `score ${score}`, `best ${best}`, '', 'タップでもう一回'],
      newBest ? '#ffd24a' : '#fff',
    )
  }
}

// タイトル用の静止キャラ（ふわふわ）
function drawHead2(x: number, y: number) {
  head.x = x
  head.y = y + Math.sin(elapsed * 2) * 6
  head.vx = head.vy = 0
  head.face = 'neutral'
  drawHead()
}

// ── ループ ──
let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  update(dt)
  render()
  endFrame()
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
