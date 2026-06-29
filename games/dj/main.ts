// きいて、かえして。 — コール&レスポンスのリズムゲー。DJ(ミニキャラ)のお手本を同じリズムで返す。
// 成功を重ねるほどヒート上昇→オーディエンス増→演出が派手に。冷めると客が帰る(負け)。
// 新技術＝WebAudioでビート合成＋タイミング同期。作風はラボ・スキンから卒業した暗いクラブ×ネオン。
import { attachPointer, fitCanvas } from '../../shared/input'
import { Particles, makeShake, clamp } from '../../shared/juice'
import { enterTransition, wireLink } from '../../shared/transition'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const { pointer } = attachPointer(canvas)
let W = 0,
  H = 0
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
})
const params = new URLSearchParams(location.search)
const shotMode = params.get('shot') === '1'

// ── ネオン配色 ──
const C = { bg0: '#171029', bg1: '#0b0815', cyan: '#28e0d0', magenta: '#ff3d9a', violet: '#9b6cff', amber: '#ffc24a', ink: '#f3eeff', dim: 'rgba(243,238,255,0.5)' }

// ── 音楽 ──
let BPM = 100
const SUBDIV = 8 // 1小節=8つの8分
const BEST_KEY = 'playlab.dj.best'
let actx: any = null
let master: GainNode
let noiseBuf: AudioBuffer
let L = 0.03 // 出力遅延の推定/補正値（目・耳・判定を揃えるために全所で使う）
const LAT_KEY = 'playlab.dj.lat'
const WIN = 0.2 // 判定窓（簡単め）
let calSum = 0,
  calN = 0 // 自動キャリブレーション用
function ensureAudio() {
  if (actx) return
  actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
  L = clamp(Number(localStorage.getItem(LAT_KEY)) || actx.outputLatency || actx.baseLatency || 0.03, 0, 0.35)
  // iOS16.4+: マナースイッチを無視して鳴らす
  try {
    const ns: any = navigator
    if (ns.audioSession) ns.audioSession.type = 'playback'
  } catch {}
  master = actx.createGain()
  master.gain.value = 0.9
  const comp = actx.createDynamicsCompressor()
  master.connect(comp).connect(actx.destination)
  const len = actx.sampleRate * 1
  noiseBuf = actx.createBuffer(1, len, actx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
}
const beatDur = () => 60 / BPM
const eighth = () => beatDur() / 2
const barDur = () => eighth() * SUBDIV

function kick(t: number, gain = 1) {
  const o = actx.createOscillator(),
    g = actx.createGain()
  o.frequency.setValueAtTime(150, t)
  o.frequency.exponentialRampToValueAtTime(45, t + 0.12)
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.2)
}
function hat(t: number, gain = 0.25) {
  const s = actx.createBufferSource()
  s.buffer = noiseBuf
  const hp = actx.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 7500
  const g = actx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.05)
  s.connect(hp).connect(g).connect(master)
  s.start(t)
  s.stop(t + 0.06)
}
function clap(t: number, gain = 0.5) {
  const s = actx.createBufferSource()
  s.buffer = noiseBuf
  const bp = actx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 1800
  bp.Q.value = 0.8
  const g = actx.createGain()
  g.gain.setValueAtTime(gain, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
  s.connect(bp).connect(g).connect(master)
  s.start(t)
  s.stop(t + 0.14)
}
const SCALE = [0, 3, 5, 7, 10, 12] // 短ペンタトニック
function stab(t: number, semi: number, gain = 0.5) {
  const freq = 220 * Math.pow(2, semi / 12)
  const o = actx.createOscillator(),
    o2 = actx.createOscillator(),
    g = actx.createGain()
  o.type = 'square'
  o2.type = 'sawtooth'
  o.frequency.value = freq
  o2.frequency.value = freq * 1.005
  const f = actx.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.setValueAtTime(2600, t)
  f.frequency.exponentialRampToValueAtTime(700, t + 0.18)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.22)
  o.connect(f)
  o2.connect(f)
  f.connect(g).connect(master)
  o.start(t)
  o2.start(t)
  o.stop(t + 0.24)
  o2.stop(t + 0.24)
}
function dull(t: number) {
  const o = actx.createOscillator(),
    g = actx.createGain()
  o.type = 'sine'
  o.frequency.value = 110
  g.gain.setValueAtTime(0.4, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.12)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.14)
}
const audioTime = () => actx.currentTime - L

// iOS のオーディオ・アンロック（ジェスチャ内で resume＋無音1サンプル再生が必要）
function unlockAudio() {
  if (!actx) return
  if (actx.state === 'suspended') actx.resume && actx.resume()
  try {
    const s = actx.createBufferSource()
    s.buffer = actx.createBuffer(1, 1, 22050)
    s.connect(actx.destination)
    s.start(0)
  } catch {}
}

// ── 状態 ──
type State = 'title' | 'play' | 'over'
let state: State = 'title'
let best = Number(localStorage.getItem(BEST_KEY) || 0)
let score = 0
let combo = 0
let hype = 0.34
let phraseCount = 0
let level = 0
let phase: 'call' | 'response' = 'call'

let pattern: number[] = []
let expected: { time: number; matched: boolean }[] = []
let extraTaps = 0
let respBarEnd = 0
let respEvaluated = true
let curBarStart = 0
let lastResult: '' | 'good' | 'miss' = ''

// 演出
const fx = new Particles()
const shakeFx = makeShake(20)
let beatPulse = 0
let flash = 0
let padFlash: number[] = new Array(SUBDIV).fill(0)
let audienceTarget = 6
let audienceShown = 6
let charArm = 0 // 0..1 腕上げ
let charBob = 0
let elapsed = 0

// スケジューラ
let slot = 0
let nextNoteTime = 0
let schedTimer: any = null
const cues: { time: number; kind: string; idx?: number }[] = []

function startNewPattern() {
  phraseCount++
  level = Math.min(9, Math.floor((phraseCount - 1) / 2))
  const k = clamp(2 + Math.floor(level / 2), 2, 5)
  const strong = [0, 4, 2, 6]
  const weak = [3, 1, 5, 7]
  const slots = new Set<number>()
  for (const s of strong) {
    if (slots.size >= k) break
    slots.add(s)
  }
  // レベルが上がると裏拍も
  let wi = 0
  while (slots.size < k && wi < weak.length) {
    if (level >= 2 || Math.random() < 0.4) slots.add(weak[wi])
    wi++
  }
  pattern = [...slots].sort((a, b) => a - b)
}

function scheduleSlot(s: number, t: number) {
  const slotInBar = s % SUBDIV
  const bar = Math.floor(s / SUBDIV)
  const isCall = bar % 2 === 0
  // グルーヴ
  if (slotInBar === 0 || slotInBar === 4) {
    kick(t)
    cues.push({ time: t, kind: 'beat' })
  }
  hat(t, slotInBar % 2 === 0 ? 0.28 : 0.16)
  if (slotInBar === 4 && hype > 0.5) clap(t, 0.35)

  if (slotInBar === 0) {
    if (isCall) {
      startNewPattern()
      cues.push({ time: t, kind: 'call-start' })
      pattern.forEach((idx, n) => {
        const ht = t + idx * eighth()
        stab(ht, SCALE[n % SCALE.length], 0.5)
        cues.push({ time: ht, kind: 'call-hit', idx })
      })
    } else {
      cues.push({ time: t, kind: 'resp-start' })
      expected = pattern.map((idx) => ({ time: t + idx * eighth(), matched: false }))
      extraTaps = 0
      respBarEnd = t + SUBDIV * eighth()
      respEvaluated = false
    }
  }
}

function scheduler() {
  while (nextNoteTime < actx.currentTime + 0.12) {
    scheduleSlot(slot, nextNoteTime)
    nextNoteTime += eighth()
    slot++
  }
}

function startGame() {
  ensureAudio()
  unlockAudio()
  score = 0
  combo = 0
  hype = 0.34
  phraseCount = 0
  level = 0
  pattern = []
  expected = []
  respEvaluated = true
  lastResult = ''
  fx.list = []
  audienceTarget = 6
  audienceShown = 6
  slot = 0
  cues.length = 0
  phase = 'call'
  state = 'play'
  nextNoteTime = actx.currentTime + 0.25
  curBarStart = nextNoteTime
  if (schedTimer) clearInterval(schedTimer)
  schedTimer = setInterval(scheduler, 25)
}
function gameOver() {
  state = 'over'
  elapsedAtOver = elapsed
  if (schedTimer) clearInterval(schedTimer)
  schedTimer = null
  if (score > best) {
    best = score
    localStorage.setItem(BEST_KEY, String(best))
  }
}
let elapsedAtOver = 0

function evaluateResponse() {
  const got = expected.filter((e) => e.matched).length
  const need = expected.length
  const perfectish = got === need && extraTaps === 0
  if (perfectish) {
    combo++
    const mult = 1 + Math.min(combo, 10) * 0.3
    score += Math.round(50 * mult)
    hype = clamp(hype + 0.09 + Math.min(combo, 8) * 0.004, 0, 1)
    lastResult = 'good'
    audienceTarget = Math.round(6 + hype * 80)
    fx.burst(W / 2, H * 0.4, 24 + Math.min(combo, 12) * 2, pickNeon(), 220, 40)
    shakeFx.add(4 + Math.min(combo, 8))
    flash = 0.35
    charArm = 1
  } else {
    combo = 0
    hype = clamp(hype - 0.17, 0, 1)
    lastResult = 'miss'
    audienceTarget = Math.round(6 + hype * 80)
    shakeFx.add(6)
    if (hype <= 0) gameOver()
  }
}
function pickNeon() {
  return [C.cyan, C.magenta, C.violet, C.amber][Math.floor(Math.random() * 4)]
}

// 入力
canvas.addEventListener('pointerdown', () => {
  ensureAudio()
  unlockAudio() // どのタップでも確実にオーディオを起こす（iOS対策）
  if (state === 'title') return startGame()
  if (state === 'over') return elapsed - elapsedAtOver > 0.4 ? startGame() : undefined
  if (state !== 'play') return
  if (phase !== 'response') {
    // コール中のタップは軽く鳴らすだけ（判定なし）
    return
  }
  const jt = audioTime()
  let bi = -1,
    bd = 1
  for (let i = 0; i < expected.length; i++) {
    if (expected[i].matched) continue
    const d = Math.abs(expected[i].time - jt)
    if (d < bd) {
      bd = d
      bi = i
    }
  }
  if (bi >= 0 && bd < WIN) {
    expected[bi].matched = true
    stab(actx.currentTime, SCALE[bi % SCALE.length], 0.55)
    padFlash[pattern[bi]] = 1
    charArm = 1
    fx.burst(padX(pattern[bi]), padY(), 6, bd < 0.07 ? C.amber : C.cyan, 120, 30)
    // 自動キャリブレーション：成功タップのズレ平均でLを微調整（端末/Bluetooth差を吸収）
    calSum += jt - expected[bi].time
    calN++
    if (calN >= 4) {
      L = clamp(L + (calSum / calN) * 0.4, 0, 0.35)
      localStorage.setItem(LAT_KEY, String(L))
      calSum = 0
      calN = 0
    }
  } else {
    extraTaps++
    dull(actx.currentTime)
    shakeFx.add(4)
  }
})

// ── レイアウト ──
const padY = () => H * 0.6
const padX = (i: number) => {
  const gap = Math.min(46, (W - 60) / SUBDIV)
  return W / 2 + (i - (SUBDIV - 1) / 2) * gap
}

// ── 更新 ──
function update(dt: number) {
  elapsed += dt
  beatPulse = Math.max(0, beatPulse - dt * 3)
  flash = Math.max(0, flash - dt * 2)
  for (let i = 0; i < SUBDIV; i++) padFlash[i] = Math.max(0, padFlash[i] - dt * 4)
  charArm = Math.max(0, charArm - dt * 2.5)
  charBob += dt * (2 + hype * 3)
  audienceShown += (audienceTarget - audienceShown) * Math.min(1, dt * 3)
  shakeFx.update(dt)
  fx.update(dt)

  if (state === 'play' && actx) {
    const now = audioTime()
    // キュー消化（出力遅延Lぶん遅らせて＝音が聞こえる瞬間に光らせる）
    while (cues.length && cues[0].time + L <= actx.currentTime) {
      const c = cues.shift()!
      if (c.kind === 'beat') beatPulse = 1
      else if (c.kind === 'call-start') {
        phase = 'call'
        curBarStart = c.time
      } else if (c.kind === 'resp-start') {
        phase = 'response'
        curBarStart = c.time
      } else if (c.kind === 'call-hit') {
        padFlash[c.idx!] = 1
        charArm = 1
      }
    }
    // レスポンス採点（バー終了後）
    if (!respEvaluated && now > respBarEnd + WIN + 0.05) {
      respEvaluated = true
      evaluateResponse()
    }
    // じわじわ冷める
    hype = clamp(hype - dt * 0.012, 0, 1)
    if (hype <= 0 && expected.length === 0) gameOver()
  }
}

// ── 描画 ──
function neonText(text: string, x: number, y: number, size: number, color: string, align: CanvasTextAlign = 'center') {
  ctx.save()
  ctx.textAlign = align
  ctx.font = `800 ${size}px "Hiragino Sans", system-ui, sans-serif`
  ctx.shadowColor = color
  ctx.shadowBlur = 18
  ctx.fillStyle = color
  ctx.fillText(text, x, y)
  ctx.shadowBlur = 0
  ctx.fillStyle = C.ink
  ctx.globalAlpha = 0.9
  ctx.fillText(text, x, y)
  ctx.restore()
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, C.bg0)
  g.addColorStop(1, C.bg1)
  ctx.fillStyle = g
  ctx.fillRect(0, 0, W, H)
  // ネオングロー（ビートで脈動）
  const gl = ctx.createRadialGradient(W / 2, H * 0.42, 20, W / 2, H * 0.42, Math.max(W, H) * 0.7)
  const a = 0.06 + beatPulse * 0.1 + hype * 0.06
  gl.addColorStop(0, `rgba(155,108,255,${a})`)
  gl.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = gl
  ctx.fillRect(0, 0, W, H)
}

function drawLights() {
  // 上部から扇状のネオンビーム（ヒートで強く）
  const beams = 5
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const cols = [C.cyan, C.magenta, C.violet, C.amber, C.cyan]
  for (let i = 0; i < beams; i++) {
    const sway = Math.sin(elapsed * 1.3 + i) * 0.5
    const x = W * (0.2 + 0.15 * i) + sway * 60
    const a = (0.04 + beatPulse * 0.08 + hype * 0.08) * 0.9
    const grad = ctx.createLinearGradient(W / 2, -20, x, H * 0.7)
    grad.addColorStop(0, hexA(cols[i], a))
    grad.addColorStop(1, hexA(cols[i], 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.moveTo(W / 2 - 18, -20)
    ctx.lineTo(W / 2 + 18, -20)
    ctx.lineTo(x + 80, H * 0.72)
    ctx.lineTo(x - 80, H * 0.72)
    ctx.closePath()
    ctx.fill()
  }
  ctx.restore()
}
function hexA(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

function drawChar() {
  const cx = W / 2,
    cy = H * 0.42 + Math.sin(charBob) * 4
  // ブース
  ctx.save()
  ctx.strokeStyle = hexA(C.cyan, 0.8)
  ctx.lineWidth = 3
  ctx.shadowColor = C.cyan
  ctx.shadowBlur = 14
  const bw = Math.min(220, W * 0.6)
  ctx.strokeRect(cx - bw / 2, cy + 20, bw, 70)
  // ターンテーブル2枚
  for (const dx of [-bw * 0.26, bw * 0.26]) {
    ctx.beginPath()
    ctx.arc(cx + dx, cy + 55, 18, 0, 7)
    ctx.stroke()
  }
  ctx.restore()
  // ミニキャラ（丸頭＋体＋腕）
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = C.ink
  ctx.fillStyle = C.ink
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  // 体
  ctx.beginPath()
  ctx.moveTo(0, -2)
  ctx.lineTo(0, 22)
  ctx.stroke()
  // 頭
  ctx.beginPath()
  ctx.arc(0, -16, 13, 0, 7)
  ctx.fillStyle = C.amber
  ctx.shadowColor = C.amber
  ctx.shadowBlur = 12
  ctx.fill()
  ctx.shadowBlur = 0
  // 目
  ctx.fillStyle = '#2a1c00'
  ctx.beginPath()
  ctx.arc(-4, -17, 1.8, 0, 7)
  ctx.arc(4, -17, 1.8, 0, 7)
  ctx.fill()
  // 腕（ヒット時に上げる）
  ctx.strokeStyle = C.ink
  const up = charArm
  ctx.beginPath()
  ctx.moveTo(0, 4)
  ctx.lineTo(-14, 4 - up * 22)
  ctx.moveTo(0, 4)
  ctx.lineTo(14, 4 - up * 22)
  ctx.stroke()
  ctx.restore()
}

function drawPads() {
  const y = padY()
  // 現在バーのプレイヘッド
  let head = -1
  if (state === 'play' && actx) head = clamp((audioTime() - curBarStart) / barDur(), 0, 1) * SUBDIV
  for (let i = 0; i < SUBDIV; i++) {
    const x = padX(i)
    const inPattern = pattern.includes(i)
    const fl = padFlash[i]
    const r = 13 + fl * 8
    // 枠
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    if (fl > 0.01) {
      const col = phase === 'call' ? C.magenta : C.cyan
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4)
      g.addColorStop(0, hexA(col, 0.9 * fl))
      g.addColorStop(1, hexA(col, 0))
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(x, y, r * 2.4, 0, 7)
      ctx.fill()
    }
    ctx.restore()
    ctx.strokeStyle = hexA('#ffffff', 0.22)
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.arc(x, y, 13, 0, 7)
    ctx.stroke()
    // コール中はパターン位置をうっすら予告
    if (phase === 'call' && inPattern) {
      ctx.fillStyle = hexA(C.magenta, 0.25)
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, 7)
      ctx.fill()
    }
    // プレイヘッド
    if (head >= 0 && Math.floor(head) === i) {
      ctx.strokeStyle = hexA(C.amber, 0.8)
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, 7)
      ctx.stroke()
    }
  }
}

function drawAudience() {
  const n = Math.round(audienceShown)
  const baseY = H - 8
  ctx.save()
  for (let i = 0; i < n; i++) {
    // 擬似ランダム配置（iベース）
    const rx = ((i * 73) % 100) / 100
    const row = i % 3
    const x = 14 + rx * (W - 28)
    const y = baseY - row * 16
    const bob = Math.sin(charBob * 1.0 + i) * (1.5 + hype * 4)
    const armUp = lastResult === 'good' && Math.sin(elapsed * 8 + i) > 0
    const col = i % 4 === 0 ? hexA(C.violet, 0.9) : 'rgba(8,5,16,0.92)'
    ctx.fillStyle = col
    // 体
    ctx.beginPath()
    ctx.arc(x, y - 18 + bob, 6, 0, 7) // 頭
    ctx.fill()
    ctx.fillRect(x - 5, y - 12 + bob, 10, 16)
    if (armUp) {
      ctx.strokeStyle = col
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.moveTo(x - 4, y - 8 + bob)
      ctx.lineTo(x - 9, y - 18 + bob)
      ctx.moveTo(x + 4, y - 8 + bob)
      ctx.lineTo(x + 9, y - 18 + bob)
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawHUD() {
  // ヒートメーター
  const bw = Math.min(240, W - 60)
  const x = W / 2 - bw / 2
  const y = 26
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(x, y, bw, 8)
  const hc = hype > 0.66 ? C.magenta : hype > 0.33 ? C.amber : C.cyan
  ctx.save()
  ctx.shadowColor = hc
  ctx.shadowBlur = 12
  ctx.fillStyle = hc
  ctx.fillRect(x, y, bw * hype, 8)
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.fillStyle = C.dim
  ctx.font = `700 11px "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText('HYPE', W / 2, y - 6)
  // スコア・コンボ
  ctx.textAlign = 'right'
  ctx.fillStyle = C.ink
  ctx.font = `800 24px "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText(String(score), W - 16, y + 34)
  ctx.font = `600 12px "Hiragino Sans", system-ui, sans-serif`
  ctx.fillStyle = C.dim
  ctx.fillText(`best ${best}`, W - 16, y + 50)
  if (combo >= 2) neonText(`${combo} COMBO`, 16 + 60, y + 34, 18, C.amber, 'left')
  // フェーズ表示
  if (state === 'play') {
    const label = phase === 'call' ? 'きいて！' : 'かえして！'
    const col = phase === 'call' ? C.magenta : C.cyan
    neonText(label, W / 2, H * 0.52, 26, col)
  }
}

function render() {
  ctx.save()
  shakeFx.apply(ctx)
  drawBackground()
  drawLights()
  drawAudience()
  if (state === 'play') {
    drawChar()
    drawPads()
  }
  fx.draw(ctx)
  ctx.restore()

  if (flash > 0) {
    ctx.fillStyle = hexA(C.magenta, flash * 0.25)
    ctx.fillRect(0, 0, W, H)
  }

  // 作品No.（額装・控えめ）
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = C.dim
  ctx.font = `600 11px "Courier New", monospace`
  ctx.fillText('No.02', 16, H - 14)
  ctx.restore()

  if (state === 'play') drawHUD()
  if (state === 'title') {
    neonText('きいて、かえして。', W / 2, H * 0.4, 34, C.cyan)
    ctx.textAlign = 'center'
    ctx.fillStyle = C.dim
    ctx.font = `500 15px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText('DJのお手本を、同じリズムでタップして返す。', W / 2, H * 0.4 + 38)
    ctx.fillText('決めるほど客が増えて盛り上がる。', W / 2, H * 0.4 + 62)
    ctx.fillText(`best ${best}`, W / 2, H * 0.4 + 92)
    neonText('タップでスタート', W / 2, H * 0.4 + 130, 18, C.amber)
  }
  if (state === 'over') {
    neonText('CLOSING TIME', W / 2, H * 0.4, 32, C.magenta)
    ctx.textAlign = 'center'
    ctx.fillStyle = C.ink
    ctx.font = `700 18px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText(`score ${score}`, W / 2, H * 0.4 + 40)
    ctx.fillStyle = C.dim
    ctx.font = `500 14px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText(`best ${best}`, W / 2, H * 0.4 + 64)
    neonText('タップでもう一回', W / 2, H * 0.4 + 104, 18, C.amber)
  }
}

// 撮影モード（盛り上がりの映えフレーム）
function setupShot() {
  state = 'play'
  hype = 0.85
  combo = 7
  score = 1840
  phase = 'response'
  pattern = [0, 2, 4, 6, 7]
  audienceTarget = audienceShown = 70
  for (let i = 0; i < SUBDIV; i++) padFlash[i] = pattern.includes(i) ? 0.9 : 0
  charArm = 1
  beatPulse = 1
  flash = 0.3
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * 7
    fx.list.push({ x: W / 2 + Math.cos(a) * Math.random() * 160, y: H * 0.4 + Math.sin(a) * Math.random() * 120, vx: 0, vy: 0, life: 0.8, max: 0.8, r: 2 + Math.random() * 3, color: pickNeon(), grav: 0 })
  }
}

let lastT = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - lastT) / 1000)
  lastT = now
  if (!shotMode) update(dt)
  render()
  requestAnimationFrame(frame)
}
if (shotMode) {
  const wait = () => {
    if (W > 0) setupShot()
    else return requestAnimationFrame(wait)
  }
  requestAnimationFrame(wait)
} else {
  enterTransition()
  const back = document.querySelector('a.back') as HTMLAnchorElement | null
  if (back) wireLink(back)
}
requestAnimationFrame(frame)
