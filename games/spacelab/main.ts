// games/spacelab/main.ts — Playlab No.05「うって、よけて。」
// フリーアセット利用テスト：Kenney(CC0) のスプライト/背景/フォント/効果音で、
// 小さくても“売り物っぽい”トップダウン・シューターを1本。素材一覧は LICENSES.md。
import { attachPointer, fitCanvas, safeBottom } from '../../shared/input'
import { Particles, makeShake, clamp, approach, easeOutBack } from '../../shared/juice'
import { enterTransition, wireLink } from '../../shared/transition'
import { isMuted, mountMuteButton, configureMixedSession, onMuteChange } from '../../shared/audio'

// ── アセット（Vite が URL に解決） ──
import playerUrl from './assets/player.png'
import enemyRedUrl from './assets/enemyRed.png'
import enemyGreenUrl from './assets/enemyGreen.png'
import enemyBlackUrl from './assets/enemyBlack.png'
import laserBlueUrl from './assets/laserBlue.png'
import laserRedUrl from './assets/laserRed.png'
import meteorUrl from './assets/meteor.png'
import powerupUrl from './assets/powerup.png'
import bgUrl from './assets/bg.png'
import fontUrl from './assets/font.ttf'
import laserSndUrl from './assets/laser.ogg'

const FONT = 'KenVector, system-ui, sans-serif'
const C = { ink: '#dfe7ff', dim: '#8ea0c8', accent: '#ffd34e', red: '#ff6b5e', green: '#6fe08a' }

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let W = 0
let H = 0
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
})
const ptrh = attachPointer(canvas)
const ptr = ptrh.pointer
const fx = new Particles()
const shake = makeShake(24)

document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
const SHOT = new URLSearchParams(location.search).get('shot')
if (!SHOT) enterTransition()
mountMuteButton()

// ── 画像読込 ──
const IMG: Record<string, HTMLImageElement> = {}
function loadImg(key: string, url: string): Promise<void> {
  return new Promise((res) => {
    const im = new Image()
    im.onload = () => {
      IMG[key] = im
      res()
    }
    im.onerror = () => res()
    im.src = url
  })
}
// フォント
const kfont = new FontFace('KenVector', `url(${fontUrl})`)
kfont.load().then((f) => (document as any).fonts.add(f)).catch(() => {})

// ── 効果音（レーザーは実素材ogg／爆発は合成） ──
let actx: AudioContext | null = null
let master: GainNode | null = null
let laserBuf: AudioBuffer | null = null
function ensureAudio() {
  if (actx) return
  try {
    actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
    master = actx.createGain()
    master.gain.value = 0.5
    master.connect(actx.destination)
    configureMixedSession()
    fetch(laserSndUrl)
      .then((r) => r.arrayBuffer())
      .then((b) => actx!.decodeAudioData(b))
      .then((buf) => (laserBuf = buf))
      .catch(() => {})
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
let lastLaser = 0
function playLaser() {
  if (!actx || !master || isMuted() || !laserBuf) return
  if (actx.currentTime - lastLaser < 0.05) return
  lastLaser = actx.currentTime
  const s = actx.createBufferSource()
  const g = actx.createGain()
  g.gain.value = 0.35
  s.buffer = laserBuf
  s.connect(g).connect(master)
  s.start()
}
function blip(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number) {
  if (!actx || !master || isMuted()) return
  const t = actx.currentTime
  const o = actx.createOscillator()
  const g = actx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.006)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.02)
}
const SFX = {
  boom() {
    blip(220, 0.22, 'sawtooth', 0.14, 60)
    blip(120, 0.3, 'triangle', 0.1, 50)
  },
  hit() {
    blip(160, 0.2, 'square', 0.14, 60)
  },
  power() {
    ;[523, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.1, 'triangle', 0.12), i * 60))
  },
  over() {
    ;[440, 330, 247, 165].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'sawtooth', 0.12), i * 130))
  },
}

// ── 型・状態 ──
type Enemy = { x: number; y: number; vx: number; vy: number; r: number; hp: number; maxhp: number; kind: 'red' | 'green' | 'black'; sway: number; fireCd: number; t: number }
type Shot = { x: number; y: number; vx: number; vy: number; foe: boolean }
type Rock = { x: number; y: number; vy: number; vx: number; rot: number; vr: number; r: number; hp: number }
type Power = { x: number; y: number; vy: number }

type Mode = 'title' | 'play' | 'over'
let mode: Mode = 'title'
let time = 0
let titleScale = 0
let overScale = 0

const you = { x: 0, y: 0, tx: 0, ty: 0, r: 22, cool: 0, inv: 0, spread: 0 }
let hp = 3
let score = 0
let best = Number(localStorage.getItem('playlab.spacelab.best') || 0)
let enemies: Enemy[] = []
let shots: Shot[] = []
let rocks: Rock[] = []
let powers: Power[] = []
let spawnT = 0
let rockT = 0
let elapsed = 0
let bgY = 0

function reset() {
  you.x = W / 2
  you.y = H * 0.8
  you.tx = you.x
  you.ty = you.y
  you.cool = 0
  you.inv = 1
  you.spread = 0
  hp = 3
  score = 0
  enemies = []
  shots = []
  rocks = []
  powers = []
  fx.list = []
  spawnT = 0.6
  rockT = 3
  elapsed = 0
}

// 難易度：時間で強く
function diff() {
  return 1 + elapsed / 30
}

function spawnEnemy() {
  const d = diff()
  const r = Math.random()
  const kind: Enemy['kind'] = r < 0.5 ? 'red' : r < 0.82 ? 'green' : 'black'
  const hpv = kind === 'red' ? 1 : kind === 'green' ? 2 : 4
  const x = 30 + Math.random() * (W - 60)
  const spd = (60 + Math.random() * 40) * (kind === 'black' ? 0.7 : 1) * clamp(d * 0.6 + 0.5, 0.6, 2)
  enemies.push({ x, y: -30, vx: 0, vy: spd, r: kind === 'black' ? 24 : 18, hp: hpv, maxhp: hpv, kind, sway: Math.random() * Math.PI * 2, fireCd: 1 + Math.random() * 1.5, t: 0 })
}

function firePlayer() {
  playLaser()
  const n = you.spread > 0 ? 3 : 1
  for (let i = 0; i < n; i++) {
    const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.18
    shots.push({ x: you.x, y: you.y - 20, vx: Math.cos(ang) * 520, vy: Math.sin(ang) * 520, foe: false })
  }
}

function hurtPlayer() {
  if (you.inv > 0) return
  hp--
  you.inv = 1.4
  shake.add(14)
  for (let i = 0; i < 24; i++) fx.burst(you.x, you.y, 1, C.accent, 260)
  SFX.hit()
  if (hp <= 0) {
    mode = 'over'
    overScale = 0
    SFX.over()
    if (score > best) {
      best = score
      localStorage.setItem('playlab.spacelab.best', String(best))
    }
  }
}

function killEnemy(e: Enemy) {
  score += e.kind === 'black' ? 30 : e.kind === 'green' ? 15 : 10
  for (let i = 0; i < 16; i++) fx.burst(e.x, e.y, 1, i % 2 ? C.accent : C.red, 240)
  shake.add(e.kind === 'black' ? 8 : 3)
  SFX.boom()
  if (Math.random() < (e.kind === 'black' ? 0.5 : 0.08)) powers.push({ x: e.x, y: e.y, vy: 90 })
}

function update(dt: number) {
  time += dt
  fx.update(dt)
  shake.update(dt)
  bgY += 60 * dt
  if (mode === 'title') {
    titleScale = approach(titleScale, 1, dt, 8)
    return
  }
  if (mode === 'over') {
    overScale = approach(overScale, 1, dt, 9)
    return
  }
  if (mode !== 'play') return

  elapsed += dt
  you.inv = Math.max(0, you.inv - dt)
  you.spread = Math.max(0, you.spread - dt)

  // 自機：指へ追従（下側を漂う）
  if (ptr.down) {
    you.tx = clamp(ptr.x, 24, W - 24)
    you.ty = clamp(ptr.y - 30, H * 0.32, H - 30 - safeBottom())
  }
  you.x = approach(you.x, you.tx, dt, 14)
  you.y = approach(you.y, you.ty, dt, 14)

  // 自動射撃
  you.cool -= dt
  if (you.cool <= 0) {
    firePlayer()
    you.cool = you.spread > 0 ? 0.12 : 0.16
  }

  // スポーン
  spawnT -= dt
  if (spawnT <= 0) {
    spawnEnemy()
    spawnT = Math.max(0.35, 1.1 - elapsed * 0.02)
  }
  rockT -= dt
  if (rockT <= 0) {
    rocks.push({ x: 30 + Math.random() * (W - 60), y: -40, vy: 70 + Math.random() * 60, vx: (Math.random() * 2 - 1) * 30, rot: 0, vr: (Math.random() * 2 - 1) * 2, r: 22, hp: 4 })
    rockT = Math.max(1.6, 4 - elapsed * 0.03)
  }

  // 敵
  for (const e of enemies) {
    e.t += dt
    e.sway += dt * 2
    e.x += Math.sin(e.sway) * 40 * dt
    e.y += e.vy * dt
    if (e.kind !== 'red') {
      e.fireCd -= dt
      if (e.fireCd <= 0 && e.y > 0 && e.y < H * 0.75) {
        e.fireCd = (e.kind === 'black' ? 1.1 : 1.8) / diff()
        const dx = you.x - e.x
        const dy = you.y - e.y
        const d = Math.hypot(dx, dy) || 1
        shots.push({ x: e.x, y: e.y + e.r, vx: (dx / d) * 220, vy: (dy / d) * 220, foe: true })
      }
    }
    // コア接触
    if (Math.hypot(e.x - you.x, e.y - you.y) < e.r + you.r * 0.7) {
      e.hp = 0
      hurtPlayer()
      for (let i = 0; i < 10; i++) fx.burst(e.x, e.y, 1, C.red, 200)
    }
  }
  enemies = enemies.filter((e) => e.hp > 0 && e.y < H + 40)

  // 隕石
  for (const rk of rocks) {
    rk.x += rk.vx * dt
    rk.y += rk.vy * dt
    rk.rot += rk.vr * dt
    if (Math.hypot(rk.x - you.x, rk.y - you.y) < rk.r + you.r * 0.7) {
      hurtPlayer()
      rk.hp = 0
      for (let i = 0; i < 12; i++) fx.burst(rk.x, rk.y, 1, '#c8a06a', 220)
    }
  }
  rocks = rocks.filter((r) => r.hp > 0 && r.y < H + 50)

  // 弾
  for (const s of shots) {
    s.x += s.vx * dt
    s.y += s.vy * dt
    if (s.foe) {
      if (you.inv <= 0 && Math.hypot(s.x - you.x, s.y - you.y) < you.r * 0.7 + 5) {
        hurtPlayer()
        s.y = H + 999
      }
    } else {
      for (const e of enemies) {
        if (e.hp > 0 && Math.hypot(s.x - e.x, s.y - e.y) < e.r + 5) {
          e.hp--
          s.y = -999
          fx.burst(s.x, s.y, 3, C.accent, 120)
          if (e.hp <= 0) killEnemy(e)
          break
        }
      }
      for (const rk of rocks) {
        if (rk.hp > 0 && Math.hypot(s.x - rk.x, s.y - rk.y) < rk.r + 5) {
          rk.hp--
          s.y = -999
          fx.burst(s.x, s.y, 3, '#c8a06a', 120)
          if (rk.hp <= 0) {
            score += 5
            for (let i = 0; i < 10; i++) fx.burst(rk.x, rk.y, 1, '#c8a06a', 220)
            shake.add(3)
            SFX.boom()
          }
          break
        }
      }
    }
  }
  shots = shots.filter((s) => s.y > -30 && s.y < H + 30 && s.x > -30 && s.x < W + 30)

  // パワーアップ
  for (const p of powers) {
    p.y += p.vy * dt
    if (Math.hypot(p.x - you.x, p.y - you.y) < you.r + 14) {
      you.spread = 7
      score += 5
      p.y = H + 999
      SFX.power()
      for (let i = 0; i < 12; i++) fx.burst(you.x, you.y, 1, C.green, 200)
    }
  }
  powers = powers.filter((p) => p.y < H + 30)
}

// ── 入力（状態） ──
canvas.addEventListener('pointerdown', () => {
  unlockAudio()
  if (mode === 'title') {
    reset()
    mode = 'play'
    time = 0
  } else if (mode === 'over') {
    mode = 'title'
    titleScale = 0
  }
})

// ── 描画 ──
function drawBg() {
  ctx.fillStyle = '#0b1020'
  ctx.fillRect(0, 0, W, H)
  const bg = IMG.bg
  if (bg) {
    const bw = bg.width
    const bh = bg.height
    const oy = ((bgY % bh) + bh) % bh
    for (let y = -bh + oy; y < H; y += bh) for (let x = 0; x < W; x += bw) ctx.drawImage(bg, x, y)
  }
}

// 画像を (x,y) 中心・幅 tw・回転 rot で描く
function sprite(im: HTMLImageElement | undefined, x: number, y: number, tw: number, rot = 0) {
  if (!im) return
  const s = tw / im.width
  const h = im.height * s
  ctx.save()
  ctx.translate(x, y)
  if (rot) ctx.rotate(rot)
  ctx.drawImage(im, -tw / 2, -h / 2, tw, h)
  ctx.restore()
}

function drawGame() {
  // 隕石
  for (const rk of rocks) sprite(IMG.meteor, rk.x, rk.y, rk.r * 2.2, rk.rot)
  // 敵（下向き＝180°回転）
  for (const e of enemies) {
    const im = e.kind === 'red' ? IMG.enemyRed : e.kind === 'green' ? IMG.enemyGreen : IMG.enemyBlack
    sprite(im, e.x, e.y, e.r * 2.2, Math.PI)
    if (e.hp < e.maxhp) {
      ctx.fillStyle = 'rgba(0,0,0,0.4)'
      ctx.fillRect(e.x - e.r, e.y - e.r - 8, e.r * 2, 3)
      ctx.fillStyle = C.red
      ctx.fillRect(e.x - e.r, e.y - e.r - 8, e.r * 2 * (e.hp / e.maxhp), 3)
    }
  }
  // パワーアップ
  for (const p of powers) {
    const pl = 1 + Math.sin(time * 8) * 0.12
    sprite(IMG.powerup, p.x, p.y, 26 * pl)
  }
  // 弾
  for (const s of shots) sprite(s.foe ? IMG.laserRed : IMG.laserBlue, s.x, s.y, 8, s.foe ? Math.PI : 0)
  // 自機（無敵中は点滅）
  if (!(you.inv > 0 && Math.floor(time * 20) % 2 === 0)) sprite(IMG.player, you.x, you.y, you.r * 2.2)
  if (you.spread > 0) {
    ctx.strokeStyle = 'rgba(111,224,138,0.5)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(you.x, you.y, you.r + 6 + Math.sin(time * 6) * 2, 0, Math.PI * 2)
    ctx.stroke()
  }
  fx.draw(ctx)
  drawHUD()
}

function drawHUD() {
  // スコアは上部中央（左右の← lab / ⚙ を避ける）
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  ctx.font = `22px ${FONT}`
  ctx.fillText(String(score), W / 2, 34)
  // ライフ（自機アイコン）も中央下に
  for (let i = 0; i < hp; i++) sprite(IMG.player, W / 2 - (hp - 1) * 12 + i * 24, 54, 18)
  if (you.spread > 0) {
    ctx.fillStyle = C.green
    ctx.font = `12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('SPREAD ' + Math.ceil(you.spread), W / 2, 74)
  }
}

function panel(title: string, sub: string[], cta: string, scale: number, accent: string) {
  ctx.fillStyle = 'rgba(6,10,22,0.62)'
  ctx.fillRect(0, 0, W, H)
  ctx.save()
  ctx.translate(W / 2, H * 0.4)
  ctx.scale(scale, scale)
  ctx.textAlign = 'center'
  ctx.fillStyle = accent
  ctx.font = `34px ${FONT}`
  ctx.fillText(title, 0, 0)
  ctx.fillStyle = C.dim
  ctx.font = `14px ${FONT}`
  sub.forEach((l, i) => ctx.fillText(l, 0, 34 + i * 24))
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.fillStyle = C.accent
  ctx.font = `16px ${FONT}`
  ctx.globalAlpha = 0.65 + 0.35 * Math.sin(time * 4)
  ctx.fillText(cta, W / 2, H * 0.62)
  ctx.globalAlpha = 1
}

function drawTitle() {
  const s = easeOutBack(clamp(titleScale, 0, 1))
  panel('うって、よけて。', ['指で自機を動かす（弾は自動）', '敵と隕石を破壊、被弾に注意', best > 0 ? 'best ' + best : '素材：Kenney (CC0)'], 'タップでスタート', s, C.ink)
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(180,195,230,0.5)'
  ctx.font = `10px ${FONT}`
  ctx.fillText('アセット利用テスト / art・sound・font: Kenney CC0', W / 2, H - 16 - safeBottom())
}

function drawOver() {
  const s = easeOutBack(clamp(overScale, 0, 1))
  panel('GAME OVER', ['SCORE ' + score, score >= best && score > 0 ? '自己ベスト更新！' : 'best ' + best], 'タップでタイトルへ', s, C.red)
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
  update(dt)
  ctx.save()
  shake.apply(ctx)
  drawBg()
  if (mode !== 'title') drawGame()
  else fx.draw(ctx)
  ctx.restore()
  if (mode === 'title') drawTitle()
  else if (mode === 'over') drawOver()
  ptrh.endFrame()
  requestAnimationFrame(frame)
}

// 映えフレーム（サムネ）
function setupShot() {
  reset()
  mode = 'play'
  you.inv = 0
  for (let i = 0; i < 6; i++) enemies.push({ x: 50 + Math.random() * (W - 100), y: 80 + Math.random() * H * 0.4, vx: 0, vy: 40, r: i % 4 === 0 ? 24 : 18, hp: 2, maxhp: 3, kind: i % 4 === 0 ? 'black' : i % 2 ? 'green' : 'red', sway: i, fireCd: 5, t: 0 })
  for (let i = 0; i < 2; i++) rocks.push({ x: 60 + Math.random() * (W - 120), y: 120 + Math.random() * H * 0.4, vy: 60, vx: 0, rot: i, vr: 0, r: 22, hp: 4 })
  powers.push({ x: W * 0.6, y: H * 0.5, vy: 0 })
  for (let i = 0; i < 8; i++) shots.push({ x: you.x + (i - 4) * 3, y: you.y - 40 - i * 40, vx: 0, vy: -520, foe: false })
  for (const e of enemies) shots.push({ x: e.x, y: e.y + 20, vx: 0, vy: 220, foe: true })
  you.spread = 5
  score = 1280
}

async function main() {
  await Promise.all([
    loadImg('player', playerUrl),
    loadImg('enemyRed', enemyRedUrl),
    loadImg('enemyGreen', enemyGreenUrl),
    loadImg('enemyBlack', enemyBlackUrl),
    loadImg('laserBlue', laserBlueUrl),
    loadImg('laserRed', laserRedUrl),
    loadImg('meteor', meteorUrl),
    loadImg('powerup', powerupUrl),
    loadImg('bg', bgUrl),
  ])
  reset()
  if (SHOT === '1') setupShot()
  else if (SHOT === 'title') {
    titleScale = 1
    time = 1
  }
  requestAnimationFrame(frame)
}
main()
