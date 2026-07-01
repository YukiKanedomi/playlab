// games/loop5/main.ts — Playlab No.04「5秒、くりかえし。」
// 5秒の時間ループ。毎ループ世界はリセットされ養分が復活。過去の自分（幽霊）が
// 記録した動きを“同時再生”しつつ、新しい1体を操作。1回の5秒で全部集めきればクリア。
// 一人では届かない→過去の自分たちでカバー。何周で解けるか（少ないほど良い）。
// Cursor*10 系の時間ループに学ぶ。絵・名前は自作。
import { attachPointer, fitCanvas, safeBottom } from '../../shared/input'
import { Particles, makeShake, clamp, lerp, easeOutBack, approach } from '../../shared/juice'
import { LAB, hexA, darken } from '../../shared/theme'
import { drawHowToCard } from '../../shared/shell'
import { enterTransition, wireLink } from '../../shared/transition'
import { isMuted, mountMuteButton, configureMixedSession, onMuteChange } from '../../shared/audio'
import * as tune from '../../shared/tune'
import { isPanelOpen } from '../../shared/tune'

const C = {
  paper: LAB.paper,
  ink: LAB.ink,
  muted: LAB.muted,
  amber: '#c2701c', // 養分
  ghost: '#2f7d6b', // 過去の自分（幽霊）＝青緑
  ghostDeep: '#1f5849',
  you: '#15b3c4', // 今の自分＝シアン
  youDeep: '#0c6f7c',
  danger: '#9b2f2f',
}
const FONT = LAB.font

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let W = 0,
  H = 0
// フィールド寸法（fitCanvas より前に宣言：初期化時のコールバックで使うため＝TDZ回避）
let cx = 0
let cy = 0
let dishR = 0
let spawnX = 0
let spawnY = 0
function layoutField() {
  cx = W / 2
  cy = H / 2
  dishR = Math.min(W, H) * 0.42
  spawnX = cx
  spawnY = cy + dishR * 0.62
}
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
  layoutField()
})
const ptrh = attachPointer(canvas)
const ptr = ptrh.pointer
const fx = new Particles()
const shake = makeShake(18)

document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
const SHOT = new URLSearchParams(location.search).get('shot')
if (!SHOT) enterTransition()
mountMuteButton()

// ── 効果音（合成・ミュート対応） ──
let actx: AudioContext | null = null
let master: GainNode | null = null
function ensureAudio() {
  if (actx) return
  try {
    actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
    master = actx.createGain()
    master.gain.value = 0.5
    master.connect(actx.destination)
    configureMixedSession()
  } catch {}
}
function unlockAudio() {
  if (!actx) ensureAudio()
  if (!actx || isMuted()) return
  if (actx.state === 'suspended') actx.resume()
}
onMuteChange((m) => {
  if (!actx) return
  if (m) actx.suspend && actx.suspend()
  else if (actx.state === 'suspended') actx.resume && actx.resume()
})
function blip(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  if (!actx || !master || isMuted()) return
  const t = actx.currentTime
  const o = actx.createOscillator()
  const g = actx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}
let lastCollect = 0
const SFX = {
  collect() {
    // ピッチを少し上げながら（拾うほど上がると気持ちいい）
    const p = 660 + clamp(collected, 0, 20) * 18
    if (actx && actx.currentTime - lastCollect < 0.03) return
    lastCollect = actx ? actx.currentTime : 0
    blip(p, 0.06, 'triangle', 0.07, p * 1.3)
  },
  loop() {
    blip(300, 0.12, 'sawtooth', 0.06, 200)
  },
  win() {
    ;[523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle', 0.12), i * 110))
  },
  rewind() {
    // 下降するワブル＝巻き戻し
    blip(620, REWIND_DUR, 'sawtooth', 0.09, 130)
    blip(930, REWIND_DUR, 'square', 0.03, 180)
  },
}

// ── 調整パネル ──
const P = tune.panel(
  'loop5',
  {
    LOOP: { v: 5, min: 3, max: 8, step: 0.5, group: 'ルール', label: 'ループ秒数', desc: '1周の長さ（秒）。' },
    BALLS: { v: 2, min: 1, max: 5, step: 1, group: 'ルール', label: '重い球の数', desc: '中央ゴールへ押し込む球の数。多いほど周回が必要。' },
    WEIGHT: { v: 2, min: 2, max: 4, step: 1, group: 'ルール', label: '球の重さ', desc: '同時に押すのに必要な身体の数。' },
    SPEED: { v: 235, min: 120, max: 360, step: 5, group: '操作', label: '移動速度', desc: '細胞の移動スピード。' },
    DRAG_MAXR: { v: 70, min: 40, max: 120, step: 2, group: '操作', label: '反応距離', desc: '指をこの距離引くと最高速。' },
  },
  { version: 2 },
)

// ── 型・状態 ──
// 重い球：weight 人の身体で同時に押すと動く。ゴール（中央）へ入れる。sx,sy=初期位置
type Ball = { x: number; y: number; vx: number; vy: number; r: number; weight: number; inGoal: boolean; sx: number; sy: number; push: number }
const GOAL_R = 46 // 中央ゴールの半径
const PUSH_ACCEL = 1500 // 押す加速度
const BALL_FRICTION = 0.87
type Sample = { t: number; x: number; y: number }
type Mode = 'title' | 'play' | 'win' | 'rewind'
let mode: Mode = 'title'
let time = 0
let titleScale = 0
let winScale = 0
const REWIND_DUR = 0.75 // 巻き戻し演出の長さ（秒）
let rewindT = 0

let balls: Ball[] = []
let ghosts: Sample[][] = [] // 過去ループの記録
let gcur: number[] = [] // 各幽霊の再生カーソル
let rec: Sample[] = [] // 今ループの記録
let loopTime = 0
let loopNum = 1
let collected = 0 // この周で集めた数
let bestLoops = Number(localStorage.getItem('playlab.loop5.best') || 0)
let banner = ''
let bannerT = 0

const you = { x: 0, y: 0 }
let velX = 0
let velY = 0
let dragging = false
let anchorX = 0
let anchorY = 0
const DRAG_DEAD = 5

function newLayout() {
  // 重い球を外周寄りにランダム配置（ゴールから離す）
  balls = []
  const n = Math.round(P.BALLS)
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.6
    const r = dishR * (0.55 + Math.random() * 0.28)
    const x = cx + Math.cos(a) * r
    const y = cy + Math.sin(a) * r
    balls.push({ x, y, vx: 0, vy: 0, r: 16, weight: Math.round(P.WEIGHT), inGoal: false, sx: x, sy: y, push: 0 })
  }
  ghosts = []
  loopNum = 1
  startLoop()
}

function startLoop() {
  for (const b of balls) {
    b.x = b.sx
    b.y = b.sy
    b.vx = 0
    b.vy = 0
    b.inGoal = false
    b.push = 0
  }
  rec = []
  gcur = ghosts.map(() => 0)
  loopTime = 0
  collected = 0
  you.x = spawnX
  you.y = spawnY
  velX = velY = 0
  banner = 'LOOP ' + loopNum
  bannerT = 1.2
}

function ghostPosAt(path: Sample[], t: number, ci: number): { x: number; y: number; ci: number } {
  let i = ci
  while (i < path.length - 1 && path[i + 1].t <= t) i++
  const a = path[i]
  const b = path[Math.min(i + 1, path.length - 1)]
  if (!a) return { x: spawnX, y: spawnY, ci: i }
  if (a === b || b.t === a.t) return { x: a.x, y: a.y, ci: i }
  const f = clamp((t - a.t) / (b.t - a.t), 0, 1)
  return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), ci: i }
}

function clampToDish(p: { x: number; y: number }) {
  const dx = p.x - cx
  const dy = p.y - cy
  const d = Math.hypot(dx, dy)
  const max = dishR - 8
  if (d > max) {
    p.x = cx + (dx / d) * max
    p.y = cy + (dy / d) * max
  }
}

// 重い球を押す：接触アクターが weight 人以上なら、合力の向きへ動く
function pushBalls(actors: { x: number; y: number }[]) {
  let inGoal = 0
  for (const b of balls) {
    if (b.inGoal) {
      inGoal++
      b.push = 0
      continue
    }
    let px = 0
    let py = 0
    let np = 0
    for (const a of actors) {
      const dx = b.x - a.x
      const dy = b.y - a.y
      const d = Math.hypot(dx, dy)
      if (d < b.r + 13 && d > 0.1) {
        np++
        px += dx / d
        py += dy / d
      }
    }
    b.push = np
    if (np >= b.weight) {
      const pd = Math.hypot(px, py) || 1
      b.vx += (px / pd) * PUSH_ACCEL * (1 / 60)
      b.vy += (py / pd) * PUSH_ACCEL * (1 / 60)
    }
    b.vx *= BALL_FRICTION
    b.vy *= BALL_FRICTION
    b.x += b.vx * (1 / 60)
    b.y += b.vy * (1 / 60)
    clampToDish(b)
    if (Math.hypot(cx - b.x, cy - b.y) < GOAL_R - 4) {
      b.inGoal = true
      inGoal++
      b.vx = b.vy = 0
      fx.burst(b.x, b.y, 16, C.amber, 220)
      shake.add(6)
      SFX.collect()
    }
  }
  collected = inGoal
}

function update(dt: number) {
  time += dt
  fx.update(dt)
  shake.update(dt)
  if (bannerT > 0) bannerT -= dt
  if (mode === 'title') {
    titleScale = approach(titleScale, 1, dt, 8)
    return
  }
  if (mode === 'win') {
    winScale = approach(winScale, 1, dt, 9)
    return
  }
  if (mode === 'rewind') {
    rewindT -= dt
    if (rewindT <= 0) {
      startLoop()
      mode = 'play'
    }
    return
  }
  if (mode !== 'play') return

  loopTime += dt

  // 入力（相対ドラッグ）
  let tvx = 0
  let tvy = 0
  if (ptr.down) {
    if (!dragging) {
      dragging = true
      anchorX = ptr.x
      anchorY = ptr.y
    }
    let dx = ptr.x - anchorX
    let dy = ptr.y - anchorY
    let mag = Math.hypot(dx, dy)
    if (mag > P.DRAG_MAXR) {
      const k = 1 - P.DRAG_MAXR / mag
      anchorX += dx * k
      anchorY += dy * k
      dx = ptr.x - anchorX
      dy = ptr.y - anchorY
      mag = P.DRAG_MAXR
    }
    if (mag >= DRAG_DEAD) {
      tvx = (dx / mag) * P.SPEED
      tvy = (dy / mag) * P.SPEED
    }
  } else {
    dragging = false
  }
  velX = approach(velX, tvx, dt, 16)
  velY = approach(velY, tvy, dt, 16)
  you.x += velX * dt
  you.y += velY * dt
  clampToDish(you)

  // 記録（今ループの自分の軌跡）
  rec.push({ t: loopTime, x: you.x, y: you.y })

  // 全アクター（幽霊＝過去の自分＋今の自分）を集めて、重い球を押す
  const actors: { x: number; y: number }[] = []
  for (let k = 0; k < ghosts.length; k++) {
    const g = ghostPosAt(ghosts[k], loopTime, gcur[k])
    gcur[k] = g.ci
    actors.push({ x: g.x, y: g.y })
  }
  actors.push({ x: you.x, y: you.y })
  pushBalls(actors)

  // 全部ゴール＝クリア
  if (collected >= balls.length) {
    mode = 'win'
    winScale = 0
    shake.add(10)
    SFX.win()
    if (bestLoops === 0 || loopNum < bestLoops) {
      bestLoops = loopNum
      localStorage.setItem('playlab.loop5.best', String(bestLoops))
    }
    return
  }

  // 5秒経過＝この周を記録→巻き戻し演出→次の周（幽霊が1体増える）
  if (loopTime >= P.LOOP) {
    ghosts.push(rec)
    loopNum++
    mode = 'rewind'
    rewindT = REWIND_DUR
    SFX.rewind()
  }
}

// ── 入力（状態） ──
canvas.addEventListener('pointerdown', () => {
  unlockAudio()
  if (mode === 'title') {
    mode = 'play'
    time = 0
    newLayout()
  } else if (mode === 'win') {
    mode = 'play'
    newLayout()
  }
})

// ── 描画 ──
function drawField() {
  ctx.fillStyle = C.paper
  ctx.fillRect(0, 0, W, H)
  // 方眼
  ctx.strokeStyle = 'rgba(24,23,19,0.06)'
  ctx.lineWidth = 1
  ctx.beginPath()
  const step = 30
  for (let x = (W % step) / 2; x < W; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, H)
  }
  for (let y = (H % step) / 2; y < H; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(W, Math.round(y) + 0.5)
  }
  ctx.stroke()
  // シャーレ
  const g = ctx.createRadialGradient(cx, cy, dishR * 0.2, cx, cy, dishR)
  g.addColorStop(0, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, dishR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = hexA(C.ink, 0.1)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, dishR, 0, Math.PI * 2)
  ctx.stroke()
  // スポーン地点（出発点）
  ctx.strokeStyle = hexA(C.ink, 0.18)
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(spawnX, spawnY, 16, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
}

function cellShape(x: number, y: number, r: number, fill: string, edge: string, wob: number, ring?: string) {
  ctx.beginPath()
  const n = 12
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = r * (1 + Math.sin(a * 3 + wob) * 0.06)
    const px = x + Math.cos(a) * rr
    const py = y + Math.sin(a) * rr
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  ctx.strokeStyle = edge
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = edge
  ctx.beginPath()
  ctx.arc(x, y, r * 0.3, 0, Math.PI * 2)
  ctx.fill()
  if (ring) {
    ctx.strokeStyle = ring
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, r + 3, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawGoal() {
  // 中央ゴール（ここへ球を押し込む）
  ctx.save()
  ctx.setLineDash([6, 6])
  ctx.strokeStyle = hexA(C.ghost, 0.55)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(cx, cy, GOAL_R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.fillStyle = hexA(C.ghost, 0.08)
  ctx.beginPath()
  ctx.arc(cx, cy, GOAL_R, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

function drawBalls() {
  for (const b of balls) {
    const pushing = b.push >= b.weight && !b.inGoal
    // グロー（押せている時は強く）
    ctx.globalAlpha = b.inGoal ? 0.2 : pushing ? 0.5 : 0.28
    ctx.fillStyle = C.amber
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r + (pushing ? 6 : 3), 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
    // 本体
    ctx.fillStyle = b.inGoal ? hexA(C.amber, 0.4) : hexA(C.amber, 0.85)
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = darken(C.amber, 0.6)
    ctx.lineWidth = 2
    ctx.stroke()
    // 必要人数「×W」
    ctx.fillStyle = '#fff'
    ctx.font = `800 13px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(b.inGoal ? '✓' : '×' + b.weight, b.x, b.y)
    ctx.textBaseline = 'alphabetic'
    // 押している人数のドット
    if (!b.inGoal && b.push > 0) {
      for (let i = 0; i < b.push; i++) {
        const a = -Math.PI / 2 + (i - (b.push - 1) / 2) * 0.4
        ctx.fillStyle = pushing ? C.ghost : C.muted
        ctx.beginPath()
        ctx.arc(b.x + Math.cos(a) * (b.r + 10), b.y + Math.sin(a) * (b.r + 10), 2.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}

// 巻き戻し演出：時間が逆再生され、全員がスタート地点へ吸い戻される
function drawRewindScene() {
  const rt = clamp(rewindT / REWIND_DUR, 0, 1) // 1→0
  const revT = P.LOOP * rt // 時刻を LOOP→0 へ
  drawGoal()
  // 球が初期位置へ戻る（rt: 1→0 でスタートへ補間）
  for (const b of balls) {
    const bx = lerp(b.sx, b.x, rt)
    const by = lerp(b.sy, b.y, rt)
    ctx.fillStyle = hexA(C.amber, 0.85)
    ctx.beginPath()
    ctx.arc(bx, by, b.r, 0, Math.PI * 2)
    ctx.fill()
    ctx.strokeStyle = darken(C.amber, 0.6)
    ctx.lineWidth = 2
    ctx.stroke()
  }
  // 全アクター（今終えた自分＝最後の幽霊 も含む）を逆時刻で描く＝スタートへ収束
  for (let k = 0; k < ghosts.length; k++) {
    const g = ghostPosAt(ghosts[k], revT, 0)
    ctx.globalAlpha = 0.5
    cellShape(g.x, g.y, 11, hexA(C.ghost, 0.5), hexA(C.ghostDeep, 0.8), time * 4 + k)
    ctx.globalAlpha = 1
  }
  // VHS 風の走査線＋ジッター
  ctx.save()
  ctx.globalAlpha = 0.5
  ctx.strokeStyle = hexA(C.ink, 0.18)
  ctx.lineWidth = 1
  for (let y = ((time * 900) % 14) - 14; y < H; y += 14) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(W, y)
    ctx.stroke()
  }
  ctx.restore()
  // ◀◀ まきもどし＋周回数
  ctx.textAlign = 'center'
  ctx.fillStyle = hexA(C.ink, 0.8)
  ctx.font = `800 26px ${FONT}`
  ctx.fillText('◀◀  まきもどし', cx, cy - dishR - 14 < 40 ? 70 : cy - dishR - 14)
  ctx.fillStyle = hexA(C.ghost, 0.9)
  ctx.font = `800 46px ${FONT}`
  ctx.fillText('LOOP ' + loopNum, cx, cy)
}

// シャーレ中央の大きな残り秒数（5秒テーマを主役に）
function drawCountdown() {
  const rem = Math.max(0, P.LOOP - loopTime)
  const n = Math.ceil(rem - 0.0001) || 0
  const frac = rem - Math.floor(rem) // 1→0 で各秒が脈打つ
  const pop = 1 + (1 - frac) * 0.12
  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `800 ${Math.round(Math.min(W, H) * 0.42 * pop)}px ${FONT}`
  ctx.fillStyle = rem <= 1.5 ? hexA(C.danger, 0.16) : hexA(C.ink, 0.09)
  ctx.fillText(String(n), cx, cy)
  ctx.restore()
  ctx.textBaseline = 'alphabetic'
}

function drawActors() {
  // 幽霊（過去の自分）：半透明。近い幽霊とは細い線で繋がる＝協力の可視化
  for (let k = 0; k < ghosts.length; k++) {
    const g = ghostPosAt(ghosts[k], loopTime, gcur[k])
    const d = Math.hypot(g.x - you.x, g.y - you.y)
    if (d < 64) {
      ctx.strokeStyle = hexA(C.you, (1 - d / 64) * 0.5)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(you.x, you.y)
      ctx.lineTo(g.x, g.y)
      ctx.stroke()
    }
    ctx.globalAlpha = 0.4
    cellShape(g.x, g.y, 11, hexA(C.ghost, 0.5), hexA(C.ghostDeep, 0.8), time * 1.2 + k)
    ctx.globalAlpha = 1
  }
  // 今の自分：くっきりシアン＋白リング
  cellShape(you.x, you.y, 13, hexA(C.you, 0.32), C.youDeep, time * 1.3, 'rgba(255,255,255,0.9)')
}

function drawHUD() {
  // ループのタイマー（上部バー）
  const f = clamp(1 - loopTime / P.LOOP, 0, 1)
  ctx.fillStyle = hexA(C.ink, 0.1)
  ctx.fillRect(12, 10, W - 24, 5)
  ctx.fillStyle = loopTime / P.LOOP > 0.8 ? C.danger : C.ghost
  ctx.fillRect(12, 10, (W - 24) * f, 5)
  // 周回・収集
  ctx.fillStyle = C.muted
  ctx.font = `800 13px ${FONT}`
  ctx.textAlign = 'left'
  ctx.fillText(`LOOP ${loopNum}`, 14, 36)
  ctx.textAlign = 'right'
  ctx.fillStyle = C.amber
  ctx.font = `800 16px ${FONT}`
  ctx.fillText(`ゴール ${collected} / ${balls.length}`, W - 14, 36)
  // 幽霊の数
  ctx.textAlign = 'left'
  ctx.fillStyle = C.muted
  ctx.font = `600 11px ${FONT}`
  const base = H - 14 - safeBottom()
  ctx.fillText(`過去の自分 ${ghosts.length}`, 14, base)
  if (bestLoops > 0) {
    ctx.textAlign = 'right'
    ctx.fillText(`best ${bestLoops}周`, W - 14, base)
  }
}

function drawBanner() {
  if (bannerT <= 0) return
  ctx.save()
  ctx.globalAlpha = Math.min(bannerT * 2.5, 1)
  ctx.textAlign = 'center'
  ctx.fillStyle = hexA(C.ink, 0.8)
  ctx.font = `800 30px ${FONT}`
  ctx.fillText(banner, cx, cy - dishR - 14 < 40 ? 70 : cy - dishR - 14)
  ctx.restore()
}

function drawTitle() {
  drawHowToCard(ctx, W, H, {
    title: '5秒、くりかえし。',
    lines: ['重い球を中央ゴールへ押し込む（指で動く）', '「×2」は2体で同時に押さないと動かない', '5秒ごとに“過去の自分”が幽霊で再生。協力せよ'],
    start: 'タップでスタート',
    footer: bestLoops > 0 ? `best: ${bestLoops}周でクリア` : undefined,
    accent: C.amber,
    ink: C.ink,
    muted: C.muted,
    panel: '#ffffff',
    border: hexA(C.amber, 0.4),
    t: time,
    scale: easeOutBack(clamp(titleScale, 0, 1)),
  })
  ctx.textAlign = 'center'
  ctx.fillStyle = hexA(C.ink, 0.4)
  ctx.font = `500 10px ${FONT}`
  ctx.fillText('時間ループに学ぶ実験 / 絵・名前は自作', cx, H - 16 - safeBottom())
}

function drawWin() {
  ctx.fillStyle = hexA(C.paper, 0.82)
  ctx.fillRect(0, 0, W, H)
  const s = easeOutBack(clamp(winScale, 0, 1))
  ctx.save()
  ctx.translate(cx, cy)
  ctx.scale(s, s)
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ghost
  ctx.font = `800 36px ${FONT}`
  ctx.fillText('クリア！', 0, -30)
  ctx.fillStyle = C.ink
  ctx.font = `800 22px ${FONT}`
  ctx.fillText(`${loopNum} 周`, 0, 6)
  ctx.fillStyle = C.muted
  ctx.font = `600 13px ${FONT}`
  ctx.fillText(loopNum <= bestLoops ? '自己ベスト更新！' : `best ${bestLoops}周`, 0, 30)
  ctx.restore()
  ctx.fillStyle = C.amber
  ctx.font = `800 16px ${FONT}`
  ctx.textAlign = 'center'
  ctx.globalAlpha = 0.65 + 0.35 * Math.sin(time * 4)
  ctx.fillText('タップでもう一度（別配置）', cx, cy + dishR * 0.6)
  ctx.globalAlpha = 1
}

// ── ループ ──
let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  if (W === 0) {
    requestAnimationFrame(frame)
    return
  }
  const paused = mode === 'play' && isPanelOpen()
  if (!paused) update(dt)

  ctx.save()
  // 巻き戻し中は小刻みに揺らす（テープ感）
  if (mode === 'rewind') ctx.translate((Math.random() * 2 - 1) * 2, (Math.random() * 2 - 1) * 2)
  shake.apply(ctx)
  drawField()
  if (mode === 'rewind') {
    drawRewindScene()
  } else if (mode !== 'title') {
    drawCountdown() // 中央の大きな残り秒数（背面）
    drawGoal()
    drawBalls()
    drawActors()
    fx.draw(ctx)
    drawHUD()
    drawBanner()
  } else {
    fx.draw(ctx)
  }
  ctx.restore()

  if (mode === 'title') drawTitle()
  else if (mode === 'win') drawWin()

  if (paused) {
    ctx.fillStyle = hexA(C.ink, 0.72)
    ctx.beginPath()
    ;(ctx as any).roundRect?.(14, 50, 126, 26, 13)
    ctx.fill()
    ctx.fillStyle = '#fff'
    ctx.fillRect(26, 58, 3.5, 10)
    ctx.fillRect(32, 58, 3.5, 10)
    ctx.font = `800 12px ${FONT}`
    ctx.textAlign = 'left'
    ctx.fillText('調整中（停止）', 40, 67)
  }

  ptrh.endFrame()
  requestAnimationFrame(frame)
}

// 映えフレーム（サムネ）: ?shot=1
function setupShot() {
  layoutField()
  mode = 'play'
  newLayout()
  loopNum = 3
  loopTime = P.LOOP * 0.4
  // 1球はゴール済み（中央）、もう1球を今まさに“みんなで押している”構図
  if (balls[0]) {
    balls[0].inGoal = true
    balls[0].x = cx
    balls[0].y = cy
  }
  const b = balls[1] || balls[0]
  if (b) {
    b.inGoal = false
    b.x = cx + 90
    b.y = cy - 40
    b.push = b.weight
  }
  // 押している幽霊＋自分を球の外側に配置
  ghosts = []
  gcur = []
  if (b) {
    for (let k = 0; k < 2; k++) {
      const a = Math.PI * 0.15 + k * 0.5
      const px = b.x + Math.cos(a) * (b.r + 12)
      const py = b.y + Math.sin(a) * (b.r + 12)
      ghosts.push([{ t: 0, x: px, y: py }, { t: P.LOOP, x: px, y: py }])
    }
    gcur = ghosts.map(() => 0)
    you.x = b.x + Math.cos(Math.PI * 0.15 + 1.0) * (b.r + 12)
    you.y = b.y + Math.sin(Math.PI * 0.15 + 1.0) * (b.r + 12)
  }
  collected = balls.filter((x) => x.inGoal).length
}

if (SHOT) {
  const wait = () => {
    if (W === 0) return requestAnimationFrame(wait)
    if (SHOT === '1') setupShot()
    else if (SHOT === 'title') {
      titleScale = 1
      time = 1
    }
  }
  requestAnimationFrame(wait)
}

requestAnimationFrame(frame)
