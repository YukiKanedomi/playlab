// 流灯 — ながして、ともす。 GPU流体パズル（Playlab No.09）
// 夜の水面。指でなぞって水流を起こし、光る墨を灯籠へ導く。
import { FluidSim } from './fluid'
import { attachPointer, fitCanvas } from '../../shared/input'
import { enterTransition, wireLink } from '../../shared/transition'
import { isMuted, mountMuteButton, configureMixedSession } from '../../shared/audio'
import * as tune from '../../shared/tune'
import { isPanelOpen } from '../../shared/tune'
import { hexA } from '../../shared/theme'
import { LEVELS } from './levels'

// ── canvas 2枚構成 ──
const glCanvas = document.getElementById('fluid') as HTMLCanvasElement
const canvas   = document.getElementById('game')  as HTMLCanvasElement
const ctx      = canvas.getContext('2d')!

const Q    = new URLSearchParams(location.search)
const SHOT = Q.get('shot')

document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
mountMuteButton()
enterTransition()

// ── 調整パネル ──
const P = tune.panel(
  'nagashi',
  {
    SPLAT_FORCE:      { v: 900,    min: 200,   max: 2500, step: 50,     group: '水',   label: 'なぞりの力' },
    SPLAT_RADIUS:     { v: 0.0022, min: 0.0005, max: 0.008, step: 0.0001, group: '水', label: 'なぞりの太さ' },
    CURL:             { v: 24,     min: 0,     max: 60,   step: 1,     group: '水',   label: 'うずの強さ', desc: '大きいほど流れが渦を巻いて崩れる' },
    DYE_DISS:         { v: 0.35,   min: 0,     max: 1.5,  step: 0.05,  group: '水',   label: '墨の消えやすさ' },
    SOURCE_RATE:      { v: 1,      min: 0.3,   max: 3,    step: 0.1,   group: '遊び', label: '水源の量' },
    LIGHT_TH:         { v: 0.22,   min: 0.05,  max: 0.6,  step: 0.01,  group: '遊び', label: '点灯に要る濃さ' },
    LIGHT_HOLD:       { v: 1.2,    min: 0.2,   max: 3,    step: 0.1,   group: '遊び', label: '点灯に要る秒数' },
    INK_SECONDS_MUL:  { v: 1,      min: 0.5,   max: 3,    step: 0.1,   group: '遊び', label: '雫つぼの量倍率', desc: '全夜の墨の量にかかる倍率。難しければ上げる' },
    RIPPLE_FORCE:     { v: 0.45,   min: 0.1,   max: 1.5,  step: 0.05,  group: '水',   label: '波紋の強さ' },
  },
  { version: 2 },
)

// ── 色定数 ──
const DYE_AKA: [number, number, number] = [1.0, 0.25, 0.10]
const DYE_AO:  [number, number, number] = [0.12, 0.45, 1.0]
const CSS_AKA      = '#ff5a3c'
const CSS_AO       = '#3f9dff'
const CSS_MURASAKI = '#b06cff'
const CSS_SHIRO    = '#f2ead8'
const BG_COLOR     = '#0d1020'

// ── サイズ（2D側）。fitCanvas より前に宣言（TDZ対策）。 ──
let W = 390
let H = 700

// ── FluidSim ──
let sim: FluidSim
try {
  sim = new FluidSim(glCanvas, { simRes: 110, dyeRes: 440, bg: [0.05, 0.06, 0.12] })
} catch (e) {
  const fallCtx = canvas.getContext('2d')!
  const draw = () => {
    fallCtx.fillStyle = '#0d1020'
    fallCtx.fillRect(0, 0, canvas.width, canvas.height)
    fallCtx.fillStyle = '#cdd3e0'
    fallCtx.font = '16px sans-serif'
    fallCtx.textAlign = 'center'
    fallCtx.fillText('この端末はWebGL非対応のため、流灯を遊べません。', canvas.width / 2, canvas.height / 2)
  }
  fitCanvas(canvas, (w, h) => { W = w; H = h; draw() })
  draw()
  throw e
}

function resizeGlCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  glCanvas.width  = Math.round(glCanvas.clientWidth  * dpr)
  glCanvas.height = Math.round(glCanvas.clientHeight * dpr)
}

// ── ポインタ ──
const ptrh = attachPointer(canvas)
const ptr  = ptrh.pointer

// ── fitCanvas（寸法変化時のみ allocate）──
let lastGlW = 0
let lastGlH = 0
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
  resizeGlCanvas()
  if (glCanvas.width === lastGlW && glCanvas.height === lastGlH) return
  lastGlW = glCanvas.width
  lastGlH = glCanvas.height
  try {
    sim.allocate()
    if (levelIdx >= 0 && levelIdx < LEVELS.length) applyObstacles()
  } catch {}
})

if (SHOT) {
  const sw = Number(Q.get('w') || 390)
  const sh = Number(Q.get('h') || 844)
  const fix = (el: HTMLCanvasElement) => {
    el.style.width    = sw + 'px'
    el.style.height   = sh + 'px'
    el.style.position = 'fixed'
    el.style.left     = '0'
    el.style.top      = '0'
  }
  fix(canvas)
  fix(glCanvas)
}

// ── 効果音 ──
let actx: AudioContext | null = null
let master: GainNode | null   = null

function ensureAudio() {
  if (actx) return
  try {
    actx   = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
    master = actx.createGain()
    master.gain.value = 0.55
    master.connect(actx.destination)
    configureMixedSession()
  } catch {}
}

function noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  if (!actx || !master || isMuted()) return
  const t   = actx.currentTime
  const len = Math.ceil(actx.sampleRate * dur)
  const buf = actx.createBuffer(1, len, actx.sampleRate)
  const d   = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len)
  const src = actx.createBufferSource()
  src.buffer = buf
  const f = actx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  f.Q.value = q
  const g = actx.createGain()
  g.gain.value = gain
  src.connect(f).connect(g).connect(master)
  src.start(t)
}

function pluck(freq: number, gain = 0.05) {
  if (!actx || !master || isMuted()) return
  const t = actx.currentTime
  const o = actx.createOscillator()
  const g = actx.createGain()
  o.type = 'triangle'
  o.frequency.setValueAtTime(freq, t)
  o.frequency.exponentialRampToValueAtTime(freq * 0.985, t + 0.18)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.32)
}

const PENTA  = [262, 294, 330, 392, 440, 528, 660]
const PENTA5 = [220, 262, 330, 392, 440]

const SFX = {
  swipe(spd: number) {
    noise(0.08, 400 + spd * 0.5, 1.5, Math.min(0.06, 0.03 + spd * 0.00003), 'lowpass')
  },
  lantern() {
    noise(0.05, 1320, 8, 0.06)
    if (actx && master) {
      const t = actx.currentTime
      const o1 = actx.createOscillator()
      const g1 = actx.createGain()
      o1.type = 'sine'
      o1.frequency.value = 1320
      g1.gain.setValueAtTime(0.12, t)
      g1.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
      o1.connect(g1).connect(master)
      o1.start(t); o1.stop(t + 0.52)
      const o2 = actx.createOscillator()
      const g2 = actx.createGain()
      o2.type = 'sine'
      o2.frequency.value = 1980
      g2.gain.setValueAtTime(0.08, t + 0.04)
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.35)
      o2.connect(g2).connect(master)
      o2.start(t + 0.04); o2.stop(t + 0.37)
    }
  },
  clear() {
    if (!actx || !master) return
    const t = actx.currentTime
    for (let i = 0; i < 3; i++) {
      const o = actx.createOscillator()
      const g = actx.createGain()
      o.type = 'sine'
      o.frequency.value = PENTA[i + 2]
      g.gain.setValueAtTime(0.0001, t + i * 0.18)
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.18 + 0.01)
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.4)
      o.connect(g).connect(master)
      o.start(t + i * 0.18)
      o.stop(t + i * 0.18 + 0.45)
    }
  },
  freePluck() {
    pluck(PENTA[Math.floor(Math.random() * PENTA.length)], 0.05)
  },
  rippleTap() {
    if (!actx || !master || isMuted()) return
    const t = actx.currentTime
    const o = actx.createOscillator()
    const g = actx.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(220, t)
    o.frequency.exponentialRampToValueAtTime(160, t + 0.15)
    g.gain.setValueAtTime(0.08, t)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
    o.connect(g).connect(master)
    o.start(t); o.stop(t + 0.16)
  },
}

// ── 灯籠の持続音レイヤー ──
type OscLayer = { osc: OscillatorNode; gain: GainNode }
let lanternOscs: OscLayer[] = []

function addLanternOsc(index: number) {
  if (!actx || !master || isMuted()) return
  const freq = PENTA5[index % PENTA5.length]
  const osc  = actx.createOscillator()
  const g    = actx.createGain()
  osc.type = 'sine'
  osc.frequency.value = freq
  g.gain.value = 0.018
  osc.connect(g).connect(master)
  osc.start(actx.currentTime)
  lanternOscs.push({ osc, gain: g })
}

function stopLanternOscs() {
  if (!actx) { lanternOscs = []; return }
  for (const { osc, gain } of lanternOscs) {
    gain.gain.setTargetAtTime(0, actx.currentTime, 0.08)
    try { osc.stop(actx.currentTime + 0.5) } catch {}
  }
  lanternOscs = []
}

// ── 環境音（水のせせらぎ）──
let ambientSrc: AudioBufferSourceNode | null  = null
let ambientGain: GainNode | null              = null

function startAmbient() {
  if (!actx || !master || ambientSrc) return
  const dur = 3
  const len = Math.ceil(actx.sampleRate * dur)
  const buf = actx.createBuffer(1, len, actx.sampleRate)
  const d   = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  const src = actx.createBufferSource()
  src.buffer = buf
  src.loop   = true
  const f  = actx.createBiquadFilter()
  f.type   = 'lowpass'
  f.frequency.value = 400
  f.Q.value = 0.5
  ambientGain = actx.createGain()
  ambientGain.gain.value = isMuted() ? 0 : 0.01
  src.connect(f).connect(ambientGain).connect(master)
  src.start()
  ambientSrc = src
}

function stopAmbient() {
  if (!ambientSrc) return
  try { ambientSrc.stop() } catch {}
  ambientSrc  = null
  ambientGain = null
}

function stopAllLayeredAudio() {
  stopLanternOscs()
  stopAmbient()
}

// ── 月評価 ──
function getMoonRatings(): number[] {
  try { return JSON.parse(localStorage.getItem('playlab.nagashi.moons') || '[]') } catch { return [] }
}
function saveMoonRating(idx: number, rating: number) {
  const arr = getMoonRatings()
  while (arr.length <= idx) arr.push(0)
  if (rating > arr[idx]) arr[idx] = rating
  localStorage.setItem('playlab.nagashi.moons', JSON.stringify(arr))
}
function inkRatioToMoon(ratio: number): number {
  if (ratio >= 0.45) return 3
  if (ratio >= 0.15) return 2
  return 1
}

// ── 状態 ──
type Mode = 'title' | 'play' | 'clear' | 'fail' | 'alldone' | 'free' | 'select'
let mode: Mode = 'title'
let levelIdx   = -1
let nightBest  = Number(localStorage.getItem('playlab.nagashi.night') || 0)

// 灯籠
type LanternState = { lit: boolean; holdSec: number; ripple: number }
let lanternStates: LanternState[] = []

// 火の粉（ember）
type Ember = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number }
let embers: Ember[] = []

// 水脈トレーサー粒子
type Tracer = { x: number; y: number; vx: number; vy: number }
let tracers: Tracer[] = []

// 波紋パルス（タップ）
type RipplePulse = { x: number; y: number; life: number }
let ripplePulses: RipplePulse[] = []

// タイマー類
let probeFrame       = 0
let hintTimer        = 0
let clearDelay       = 0
let t                = 0
let inkRemain        = 0
let inkDepleted      = false
let inkDepletedTimer = 0
let clearMoonRating  = 0

// スワイプ軌跡
type Trail = { x: number; y: number; age: number }
let trail: Trail[]   = []
let prevPtr          = { x: 0, y: 0 }
let lastSwipeSfxDist = 0

// デモタイマー
let demoTimer  = 0
let demoSide   = 0  // 左右交互渦の方向

// タップ検出（波紋用）
let tapDownX    = 0
let tapDownY    = 0
let tapDownTime = -999
let tapMoved    = false
let ptrWasDown  = false

// ── 障害物を sim に適用 ──
function applyObstacles() {
  const lv = LEVELS[levelIdx]
  if (!lv || !lv.rocks || lv.rocks.length === 0) {
    sim.setObstacleMask(null)
  } else {
    sim.setObstacleMask({ circles: lv.rocks })
  }
}

// ── 月光帯（decayZone）を sim に適用 ──
function applyDecayZones() {
  const lv = LEVELS[levelIdx]
  if (!lv || !lv.moonbeams || lv.moonbeams.length === 0) {
    sim.setDecayZones(null)
  } else {
    sim.setDecayZones({ rects: lv.moonbeams })
  }
}

// ── レベル開始 ──
function startLevel(idx: number) {
  stopAllLayeredAudio()
  levelIdx     = idx
  inkDepleted  = false
  inkDepletedTimer = 0
  const lv     = LEVELS[idx]
  inkRemain    = lv.inkSeconds * P.INK_SECONDS_MUL
  sim.clear()
  applyObstacles()
  applyDecayZones()
  lanternStates = lv.lanterns.map(() => ({ lit: false, holdSec: 0, ripple: 0 }))
  embers        = []
  tracers       = Array.from({ length: 110 }, () => ({ x: Math.random(), y: Math.random(), vx: 0, vy: 0 }))
  ripplePulses  = []
  hintTimer     = 6
  mode          = 'play'
  trail         = []
  lastSwipeSfxDist = 0
  probeFrame       = 0
  tapDownTime      = -999
  ptrWasDown       = false
}

// ── タイトルへ ──
function goTitle() {
  stopAllLayeredAudio()
  mode     = 'title'
  levelIdx = -1
  sim.clear()
  sim.setObstacleMask(null)
  sim.setDecayZones(null)
  trail        = []
  embers       = []
  tracers      = []
  ripplePulses = []
}

// ── やりなおす ──
function restartLevel() {
  if (levelIdx >= 0) startLevel(levelIdx)
}

// ── 「やりなおす」ボタン矩形 ──
function retryRect() {
  return { x: W - 90, y: 52, w: 70, h: 26 }
}

// ── メインループ ──
let last = performance.now()
function frame(now: number) {
  requestAnimationFrame(frame)
  const rawDt = (now - last) / 1000
  last = now
  const dt = Math.min(1 / 30, rawDt)

  sim.opts.curl           = P.CURL
  sim.opts.dyeDissipation = P.DYE_DISS

  if (!isPanelOpen()) {
    update(dt)
  }

  sim.render()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  draw()
  ptrh.endFrame()
}

// ── 更新 ──
function update(dt: number) {
  t += dt

  // タップ開始検出
  if (ptr.justPressed) {
    tapDownX    = ptr.x
    tapDownY    = ptr.y
    tapDownTime = t
    tapMoved    = false
  }
  if (ptr.down) {
    if (Math.hypot(ptr.x - tapDownX, ptr.y - tapDownY) >= 6) tapMoved = true
  }

  // ── ポインタ入力（なぞり）──
  if (ptr.down) {
    if (!ensureAudioOnce.done) ensureAudioOnce()

    const dx   = ptr.x - prevPtr.x
    const dy   = ptr.y - prevPtr.y
    const dist = Math.hypot(dx, dy)

    if (dist >= 6) {
      const mx = (prevPtr.x + ptr.x) / 2
      const my = (prevPtr.y + ptr.y) / 2
      sim.splat(mx / W, my / H, dx / W * P.SPLAT_FORCE, dy / H * P.SPLAT_FORCE, null, P.SPLAT_RADIUS)
      sim.splat(ptr.x / W, ptr.y / H, dx / W * P.SPLAT_FORCE, dy / H * P.SPLAT_FORCE, null, P.SPLAT_RADIUS)
      trail.push({ x: ptr.x, y: ptr.y, age: 0 })
      lastSwipeSfxDist += dist
      if (lastSwipeSfxDist >= 40) {
        SFX.swipe(dist / Math.max(dt, 0.001))
        lastSwipeSfxDist = 0
      }
      if (mode === 'free' && dist >= 6) {
        const hue = (t * 80) % 360
        const [r, g, b] = hsvToRgb(hue, 0.85, 1.0)
        sim.splat(ptr.x / W, ptr.y / H, dx / W * P.SPLAT_FORCE * 0.4, dy / H * P.SPLAT_FORCE * 0.4, [r, g, b], P.SPLAT_RADIUS * 1.2)
      }
    }
    prevPtr.x = ptr.x
    prevPtr.y = ptr.y
  } else {
    prevPtr.x = ptr.x
    prevPtr.y = ptr.y
  }

  if (mode === 'free' && ptr.justPressed) {
    ensureAudioOnce()
    const hue = Math.random() * 360
    const [r, g, b] = hsvToRgb(hue, 0.85, 1.0)
    sim.splat(ptr.x / W, ptr.y / H, 0, 30, [r, g, b], P.SPLAT_RADIUS * 2)
    SFX.freePluck()
  }

  for (const tr of trail) tr.age += dt
  trail = trail.filter(tr => tr.age < 0.5)

  // モード別
  if (mode === 'play') {
    updatePlay(dt)
  } else if (mode === 'free') {
    updateFree(dt)
  } else if (mode === 'title') {
    updateTitle(dt)
  } else if (mode === 'select') {
    sim.step(dt)
  } else if (mode === 'clear') {
    clearDelay -= dt
    if (clearDelay <= 0 && ptr.justPressed) {
      ensureAudioOnce()
      const next = levelIdx + 1
      if (next < LEVELS.length) {
        startLevel(next)
      } else {
        mode = 'alldone'
        SFX.clear()
      }
    }
  } else if (mode === 'fail') {
    sim.step(dt)
    if (ptr.justPressed) {
      ensureAudioOnce()
      restartLevel()
    }
  } else if (mode === 'alldone') {
    if (ptr.justPressed) {
      ensureAudioOnce()
      goTitle()
    }
  }

  // タップ離し検出（次フレーム用に保存）
  ptrWasDown = ptr.down
}

function updatePlay(dt: number) {
  const lv = LEVELS[levelIdx]

  // 環境音の起動（play中かつ audio 初期化済みのとき）
  if (actx && !ambientSrc) startAmbient()

  // 水源（墨が残っている間だけ。SHOT中は静止画用に消費・枯渇なし）
  if (!inkDepleted || SHOT) {
    for (const src of lv.sources) {
      const dye: [number, number, number] = src.color === 'aka'
        ? [DYE_AKA[0] * 0.55 * P.SOURCE_RATE, DYE_AKA[1] * 0.55 * P.SOURCE_RATE, DYE_AKA[2] * 0.55 * P.SOURCE_RATE]
        : [DYE_AO[0]  * 0.55 * P.SOURCE_RATE, DYE_AO[1]  * 0.55 * P.SOURCE_RATE, DYE_AO[2]  * 0.55 * P.SOURCE_RATE]
      sim.splat(src.x, src.y, 0, 12, dye, 0.0016)
    }
    if (!SHOT) {
      inkRemain -= dt
      if (inkRemain <= 0) {
        inkRemain        = 0
        inkDepleted      = true
        inkDepletedTimer = 6
      }
    }
  }

  // 墨が尽きた後のカウントダウン
  if (inkDepleted && !SHOT) {
    inkDepletedTimer = Math.max(0, inkDepletedTimer - dt)
    if (inkDepletedTimer <= 0) {
      const allLit = lv.lanterns.every((_, i) => lanternStates[i].lit)
      if (!allLit) {
        mode = 'fail'
        stopAllLayeredAudio()
        return
      }
    }
  }

  // vents
  if (lv.vents) {
    for (const v of lv.vents) {
      sim.splat(v.x, v.y, v.dx, v.dy, null, 0.003)
    }
  }

  // current
  if (lv.current) {
    const { dx, dy } = lv.current
    for (const px of [0.2, 0.4, 0.6, 0.8]) {
      sim.splat(px, 0.5, dx, dy, null, 0.02)
    }
  }

  sim.step(dt)
  hintTimer = Math.max(0, hintTimer - dt)

  // 環境音のミュート同期
  if (ambientGain) {
    ambientGain.gain.setTargetAtTime(isMuted() ? 0 : 0.01, actx!.currentTime, 0.1)
  }

  // 速度プローブ（3フレームに1回）と粒子移流
  probeFrame++
  if (probeFrame % 3 === 0) sim.readVelProbe()
  for (const tr of tracers) {
    const [vx, vy] = sim.velAt(tr.x, tr.y)
    tr.vx = vx
    tr.vy = vy
    tr.x += vx * dt
    tr.y += vy * dt
    if (tr.x < 0 || tr.x > 1 || tr.y < 0 || tr.y > 1) {
      tr.x  = Math.random()
      tr.y  = Math.random()
      tr.vx = 0
      tr.vy = 0
    }
  }

  // 点灯判定（5フレームに1回、SHOT中は停止）
  if (probeFrame % 5 === 0 && !SHOT) {
    sim.readProbe()
    for (let i = 0; i < lv.lanterns.length; i++) {
      const ln = lv.lanterns[i]
      const st = lanternStates[i]
      if (st.lit) continue
      const [r, , b] = sim.probeAt(ln.x, ln.y)
      let satisfied = false
      if (ln.need === 'aka')      satisfied = r >= P.LIGHT_TH
      else if (ln.need === 'ao') satisfied = b >= P.LIGHT_TH
      else if (ln.need === 'murasaki') satisfied = r >= P.LIGHT_TH * 0.6 && b >= P.LIGHT_TH * 0.6
      else if (ln.need === 'shiro')    satisfied = (r >= P.LIGHT_TH && b <= P.LIGHT_TH * 0.3) || (b >= P.LIGHT_TH && r <= P.LIGHT_TH * 0.3)

      if (satisfied) {
        st.holdSec += (5 / 60)
        if (st.holdSec >= P.LIGHT_HOLD) {
          st.lit    = true
          st.ripple = 1
          SFX.lantern()
          addLanternOsc(lanternStates.filter(s => s.lit).length - 1)
          // 火の粉
          const ex = ln.x * W
          const ey = ln.y * H
          for (let k = 0; k < 8; k++) {
            const ang  = -Math.PI * 0.75 + Math.random() * Math.PI * 0.5
            const spd  = 20 + Math.random() * 20
            embers.push({
              x: ex, y: ey,
              vx: Math.cos(ang) * spd + (Math.random() - 0.5) * 10,
              vy: Math.sin(ang) * spd,
              life: 1.2, maxLife: 1.2,
            })
          }
        }
      } else {
        st.holdSec = Math.max(0, st.holdSec - (5 / 60) * 2)
      }
    }
    // 全灯確認
    if (lv.lanterns.every((_, i) => lanternStates[i].lit)) {
      const inkTotal  = lv.inkSeconds * P.INK_SECONDS_MUL
      clearMoonRating = inkRatioToMoon(inkRemain / inkTotal)
      saveMoonRating(levelIdx, clearMoonRating)
      const night = levelIdx + 1
      if (night > nightBest) {
        nightBest = night
        localStorage.setItem('playlab.nagashi.night', String(nightBest))
      }
      // 全灯の瞬間：gain を一瞬0.03に
      if (actx) {
        for (const { gain } of lanternOscs) {
          gain.gain.setTargetAtTime(0.03, actx.currentTime, 0.03)
          gain.gain.setTargetAtTime(0.018, actx.currentTime + 0.3, 0.1)
        }
      }
      SFX.clear()
      stopAmbient()
      mode       = 'clear'
      clearDelay = 0.8
    }
  }

  // 火の粉の更新
  for (const e of embers) {
    e.x  += e.vx * dt
    e.y  += e.vy * dt
    e.vy += 30 * dt
    e.life -= dt
  }
  embers = embers.filter(e => e.life > 0)

  // 波紋フェード
  for (const st of lanternStates) {
    if (st.ripple > 0) st.ripple = Math.max(0, st.ripple - dt * 0.8)
  }
  for (const rp of ripplePulses) rp.life -= dt
  ripplePulses = ripplePulses.filter(rp => rp.life > 0)

  // タップ波紋（押して離す 0.18秒以内 かつ 6px未満）
  const justReleased = ptrWasDown && !ptr.down
  if (justReleased && !tapMoved && (t - tapDownTime) <= 0.18 && tapDownTime > 0) {
    const px = tapDownX / W
    const py = tapDownY / H
    const F  = P.SPLAT_FORCE * P.RIPPLE_FORCE
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2
      sim.splat(px, py, Math.cos(ang) * F, Math.sin(ang) * F, null, 0.0035)
    }
    ripplePulses.push({ x: tapDownX, y: tapDownY, life: 0.5 })
    SFX.rippleTap()
    tapDownTime = -999  // 二重発火防止
  }

  // やりなおすボタン
  if (ptr.justPressed) {
    ensureAudioOnce()
    const r = retryRect()
    if (ptr.x >= r.x && ptr.x <= r.x + r.w && ptr.y >= r.y && ptr.y <= r.y + r.h) {
      tapDownTime = -999
      restartLevel()
    }
  }
}

function updateFree(dt: number) {
  sim.step(dt)
}

function updateTitle(dt: number) {
  // デモ：左(aka)と右(ao)の水源、2.2秒ごとに渦 splat
  // 文字が流体に埋もれないよう、タイトル中は湧きを弱く・消えを速くする
  sim.opts.dyeDissipation = Math.max(P.DYE_DISS, 1.1)
  sim.splat(0.38, 0.2, 0, 10, [DYE_AKA[0] * 0.14, DYE_AKA[1] * 0.14, DYE_AKA[2] * 0.14], 0.0016)
  sim.splat(0.62, 0.2, 0, 10, [DYE_AO[0]  * 0.14, DYE_AO[1]  * 0.14, DYE_AO[2]  * 0.14], 0.0016)
  demoTimer -= dt
  if (demoTimer <= 0) {
    demoTimer = 2.2
    const sx = demoSide === 0 ? 0.3 : 0.7
    const dx = demoSide === 0 ? 40 : -40
    sim.splat(sx, 0.32, dx, 55, null, 0.012)
    demoSide = 1 - demoSide
  }
  sim.step(dt)

  if (ptr.justPressed) {
    ensureAudioOnce()
    const itemY   = H * 0.72
    const itemH   = 40
    const itemGap = 48

    // メニュー項目の動的リスト
    const items: string[] = ['はじめから']
    if (nightBest > 0) {
      items.push(`つづきから（${nightBest}夜目〜）`)
      items.push('夜をえらぶ')
    }
    if (nightBest >= LEVELS.length) items.push('水遊び')

    for (let i = 0; i < items.length; i++) {
      const my = itemY + i * itemGap
      if (ptr.y >= my && ptr.y < my + itemH) {
        const label = items[i]
        if (label === 'はじめから') {
          startLevel(0)
        } else if (label.startsWith('つづきから')) {
          startLevel(Math.min(nightBest, LEVELS.length - 1))
        } else if (label === '夜をえらぶ') {
          mode = 'select'
        } else if (label === '水遊び') {
          mode     = 'free'
          levelIdx = -1
          sim.clear()
          sim.setObstacleMask(null)
          sim.setDecayZones(null)
        }
        return
      }
    }
  }
}

// ── 一度だけ AudioContext を初期化 ──
const ensureAudioOnce: { (): void; done: boolean } = Object.assign(
  () => { if (!ensureAudioOnce.done) { ensureAudio(); ensureAudioOnce.done = true } },
  { done: false },
)

// ── HSV → RGB ──
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const x = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m = v - c
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  return [r + m, g + m, b + m]
}

// ── 決定論的疑似乱数（星の位置固定用）──
function starRng(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

// ── 2D 描画 ──
function draw() {
  if (mode === 'title')  { drawTitle();  return }
  if (mode === 'select') { drawTitle(); drawSelectOverlay(); return }
  if (mode === 'free')   { drawFree();   return }
  if (mode === 'play' || mode === 'clear' || mode === 'fail' || mode === 'alldone') {
    drawGame()
  }
}

function drawGame() {
  const lv = LEVELS[levelIdx]

  // 星
  drawStars()

  // 月光帯（2D overlay）
  if (lv.moonbeams) {
    for (const mb of lv.moonbeams) {
      drawMoonbeam(mb.x * W, mb.y * H, mb.w * W, mb.h * H)
    }
  }

  // スワイプ軌跡
  for (const tr of trail) {
    const a = (1 - tr.age / 0.5) * 0.18
    ctx.strokeStyle = `rgba(255,255,255,${a.toFixed(3)})`
    ctx.lineWidth   = 6
    ctx.lineCap     = 'round'
    ctx.beginPath()
    ctx.arc(tr.x, tr.y, 3, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 岩
  if (lv.rocks) {
    for (const rock of lv.rocks) {
      drawRock(rock.x * W, rock.y * H, rock.r * Math.min(W, H))
    }
  }

  // vents の泡
  if (lv.vents) {
    for (const v of lv.vents) {
      drawVentBubbles(v.x * W, v.y * H)
    }
  }

  // 水脈トレーサー
  drawTracers()

  // 水源
  for (const src of lv.sources) {
    drawKakehi(src.x * W, src.y * H, src.color)
  }

  // 灯籠（反射は灯籠描画内で）
  for (let i = 0; i < lv.lanterns.length; i++) {
    const ln = lv.lanterns[i]
    const st = lanternStates[i]
    drawLantern(ln.x * W, ln.y * H, ln.need, st)
  }

  // 火の粉
  drawEmbers()

  // 波紋パルス（タップ）
  for (const rp of ripplePulses) {
    const progress = 1 - rp.life / 0.5
    const radius   = 10 + progress * 60
    const lw       = 2 - progress * 1.5
    const alpha    = rp.life / 0.5
    ctx.strokeStyle = `rgba(180,210,255,${alpha.toFixed(3)})`
    ctx.lineWidth   = Math.max(0.5, lw)
    ctx.beginPath()
    ctx.arc(rp.x, rp.y, radius, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 月（プレイ中）
  if (mode !== 'title') drawPlayMoon()

  // HUD
  drawHud()

  if (mode === 'clear')   drawClearOverlay()
  if (mode === 'fail')    drawFailOverlay()
  if (mode === 'alldone') drawAlldoneOverlay()
}

// ── 星 ──
function drawStars() {
  const BLINK_INDICES = [0, 8, 17]
  for (let i = 0; i < 26; i++) {
    const sx = starRng(i * 3)      * W
    const sy = starRng(i * 3 + 1) * H * 0.22
    const sr = 0.5 + starRng(i * 3 + 2) * 0.7
    let   a  = 0.15 + starRng(i * 3 + 2) * 0.3
    if (BLINK_INDICES.includes(i)) a *= 0.6 + 0.4 * Math.sin(t * 0.8 + i)
    ctx.globalAlpha = a
    ctx.fillStyle   = '#e8e2d4'
    ctx.beginPath()
    ctx.arc(sx, sy, sr, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// ── 月（プレイ中、右上）──
function drawPlayMoon() {
  if (levelIdx < 0) return
  const r  = levelIdx >= 8 ? 16 : 13
  const cx = W - 38
  const cy = 70
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fillStyle = '#e8e2d4'
  ctx.fill()
  if (levelIdx < 7) {
    const phase  = levelIdx / 7          // 0..~0.86 (七夜は満月手前)
    const offset = (1 - phase) * r * 1.8
    ctx.beginPath()
    ctx.arc(cx + offset, cy, r * 1.05, 0, Math.PI * 2)
    ctx.fillStyle = BG_COLOR
    ctx.fill()
  }
  ctx.restore()
}

// ── 月光帯（2D overlay）──
function drawMoonbeam(x: number, y: number, w: number, h: number) {
  ctx.save()
  ctx.fillStyle = hexA('#cdd3e0', 0.05)
  ctx.fillRect(x, y, w, h)
  // 縦の輪郭線
  ctx.strokeStyle = hexA('#cdd3e0', 0.12)
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.moveTo(x, y); ctx.lineTo(x, y + h)
  ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h)
  ctx.stroke()
  // 斜めの淡い光線2本
  ctx.strokeStyle = hexA('#cdd3e0', 0.07)
  ctx.lineWidth   = 3
  ctx.beginPath()
  ctx.moveTo(x + w * 0.2, y); ctx.lineTo(x + w * 0.0, y + h)
  ctx.moveTo(x + w * 0.8, y); ctx.lineTo(x + w * 0.6, y + h)
  ctx.stroke()
  ctx.restore()
}

// ── 水脈トレーサー ──
function drawTracers() {
  ctx.save()
  ctx.lineCap = 'round'
  for (const tr of tracers) {
    const spd = Math.hypot(tr.vx, tr.vy)
    if (spd < 0.0001) {
      ctx.globalAlpha = 0.05
      ctx.fillStyle   = 'rgba(180,200,235,1)'
      ctx.fillRect(tr.x * W - 0.5, tr.y * H - 0.5, 1, 1)
    } else {
      const spdNorm   = Math.min(1, spd * 50)
      const len       = 2 + spdNorm * 5
      const alpha     = 0.06 + spdNorm * 0.34
      const nx        = tr.vx / spd
      const ny        = tr.vy / spd
      ctx.strokeStyle = `rgba(180,200,235,${alpha.toFixed(3)})`
      ctx.lineWidth   = 1
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.moveTo(tr.x * W - nx * len * 0.5, tr.y * H - ny * len * 0.5)
      ctx.lineTo(tr.x * W + nx * len * 0.5, tr.y * H + ny * len * 0.5)
      ctx.stroke()
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ── 火の粉 ──
function drawEmbers() {
  ctx.save()
  for (const e of embers) {
    const ratio = e.life / e.maxLife
    ctx.globalAlpha = ratio * 0.9
    ctx.fillStyle   = ratio > 0.5 ? '#ffb347' : '#ff6a20'
    const r = 1.5 + (1 - ratio) * 1
    ctx.beginPath()
    ctx.arc(e.x, e.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

function drawFree() {
  ctx.fillStyle    = 'rgba(205,211,224,0.7)'
  ctx.font         = '500 13px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('水遊び — 自由に色の流れを楽しむ', W / 2, H - 28)
}

// ── かけひ（竹筒）──
function drawKakehi(x: number, y: number, color: 'aka' | 'ao') {
  const css   = color === 'aka' ? CSS_AKA : CSS_AO
  // 墨が尽きた場合は点滅を止める（脈打たない）
  const pulse = inkDepleted ? 0 : (0.7 + 0.3 * Math.sin(t * 3))

  ctx.save()
  ctx.translate(x, y)
  ctx.fillStyle   = 'rgba(180,200,180,0.75)'
  ctx.strokeStyle = 'rgba(140,170,140,0.8)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.rect(-5, -12, 10, 18)
  ctx.fill()
  ctx.stroke()
  ctx.strokeStyle = 'rgba(100,140,100,0.7)'
  ctx.lineWidth   = 1.5
  ctx.beginPath()
  ctx.moveTo(-5, -4); ctx.lineTo(5, -4)
  ctx.stroke()
  if (pulse > 0) {
    ctx.globalAlpha  = pulse
    ctx.fillStyle    = css
    ctx.shadowColor  = css
    ctx.shadowBlur   = 8
    ctx.beginPath()
    ctx.arc(0, 8, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur   = 0
  }
  ctx.globalAlpha = 1
  ctx.restore()
}

// ── 灯籠 ──
function drawLantern(x: number, y: number, need: 'aka' | 'ao' | 'murasaki' | 'shiro', st: LanternState) {
  const css   = need === 'aka' ? CSS_AKA : need === 'ao' ? CSS_AO : need === 'murasaki' ? CSS_MURASAKI : CSS_SHIRO
  const bob   = Math.sin(t * 1.4 + x) * 2
  const flame = st.lit ? (0.8 + 0.2 * Math.sin(t * 7 + x)) : 0

  // 水面への反射（点灯中）— 灯籠本体より先に描くことで奥行き感
  if (st.lit) {
    const refX  = x + Math.sin(t * 2.5 + x) * 1.5
    const refY  = y + bob + 18
    const grad  = ctx.createLinearGradient(refX, refY, refX, refY + 44)
    grad.addColorStop(0, hexA(css, 0.22 * flame))
    grad.addColorStop(1, hexA(css, 0))
    ctx.save()
    ctx.fillStyle = grad
    ctx.fillRect(refX - 5, refY, 10, 44)
    ctx.restore()
  }

  ctx.save()
  ctx.translate(x, y + bob)

  // 波紋（点灯エフェクト）
  if (st.ripple > 0) {
    const rScale = 1 - st.ripple
    ctx.strokeStyle = css
    ctx.lineWidth   = 2
    ctx.globalAlpha = st.ripple * 0.5
    ctx.beginPath()
    ctx.arc(0, 0, 40 + rScale * 30, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // ハロー（点灯後）
  if (st.lit) {
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 44)
    grad.addColorStop(0, hexA(css, 0.4 * flame))
    grad.addColorStop(1, hexA(css, 0))
    ctx.fillStyle = grad
    ctx.beginPath()
    ctx.arc(0, 0, 44, 0, Math.PI * 2)
    ctx.fill()
  }

  // 舟形（底の弧）
  ctx.strokeStyle = st.lit ? css : 'rgba(205,211,224,0.5)'
  ctx.lineWidth   = st.lit ? 2 : 1.5
  ctx.fillStyle   = st.lit ? css : 'transparent'
  ctx.globalAlpha = st.lit ? 0.85 : 0.5
  ctx.beginPath()
  ctx.ellipse(0, 14, 16, 5, 0, 0, Math.PI)
  ctx.stroke()

  // 提灯本体
  ctx.strokeStyle = st.lit ? css : 'rgba(205,211,224,0.35)'
  ctx.lineWidth   = st.lit ? 1.8 : 1.2
  ctx.globalAlpha = st.lit ? 0.95 : 0.45
  ctx.beginPath()
  ctx.ellipse(0, 0, 13, 18, 0, 0, Math.PI * 2)
  if (st.lit) {
    ctx.fillStyle   = css
    ctx.globalAlpha = 0.35 * flame
    ctx.fill()
    ctx.globalAlpha = 0.95
  }
  ctx.stroke()

  // 縦のひご線
  ctx.strokeStyle = st.lit ? css : 'rgba(205,211,224,0.28)'
  ctx.lineWidth   = 0.8
  ctx.globalAlpha = st.lit ? 0.6 : 0.4
  for (const ox of [-5, 5]) {
    ctx.beginPath()
    ctx.moveTo(ox, -18); ctx.lineTo(ox, 18)
    ctx.stroke()
  }

  // 未点灯リング
  if (!st.lit) {
    ctx.strokeStyle = css
    ctx.lineWidth   = 1.5
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.ellipse(0, 0, 17, 22, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  // 点灯ゲージ（holdSec 進捗弧）
  if (!st.lit && st.holdSec > 0) {
    const progress = st.holdSec / P.LIGHT_HOLD
    const pulse    = 0.8 + 0.2 * Math.sin(t * 8)
    ctx.strokeStyle = css
    ctx.lineWidth   = 2.5
    ctx.globalAlpha = pulse
    ctx.beginPath()
    ctx.arc(0, 0, 22, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

// ── 岩 ──
function drawRock(x: number, y: number, r: number) {
  ctx.save()
  ctx.fillStyle   = '#1a1f33'
  ctx.strokeStyle = 'rgba(205,211,224,0.25)'
  ctx.lineWidth   = 1.5
  for (const [ox, oy, sr] of [[-r * 0.3, r * 0.15, r * 0.8], [r * 0.3, r * 0.1, r * 0.75], [0, -r * 0.1, r * 0.65]] as [number, number, number][]) {
    ctx.beginPath()
    ctx.arc(x + ox, y + oy, sr, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

// ── vent 泡 ──
function drawVentBubbles(x: number, y: number) {
  for (let i = 0; i < 3; i++) {
    const phase = ((t * 1.8 + i * 0.33) % 1)
    const by    = y - phase * 60
    const ba    = phase < 0.15 ? phase / 0.15 : phase > 0.85 ? (1 - phase) / 0.15 : 1
    ctx.save()
    ctx.globalAlpha = ba * 0.6
    ctx.fillStyle   = 'rgba(200,220,255,0.8)'
    ctx.strokeStyle = 'rgba(200,220,255,0.5)'
    ctx.lineWidth   = 0.8
    ctx.beginPath()
    ctx.arc(x + (i - 1) * 5, by, 2.5 - i * 0.3, 0, Math.PI * 2)
    ctx.fill()
    ctx.stroke()
    ctx.restore()
  }
}

// ── HUD ──
function drawHud() {
  if (levelIdx < 0) return
  const lv = LEVELS[levelIdx]

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'alphabetic'

  // 夜名
  ctx.fillStyle = '#cdd3e0'
  ctx.font      = '500 16px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText(lv.name, W / 2, 36)

  // ヒント
  if (hintTimer > 0) {
    const a = Math.min(1, hintTimer / 1)
    ctx.globalAlpha = a * 0.6
    ctx.fillStyle   = '#cdd3e0'
    ctx.font        = '400 12px "Hiragino Mincho ProN","Yu Mincho",serif'
    ctx.fillText(lv.hint, W / 2, 56)
    ctx.globalAlpha = 1
  }

  // やりなおすボタン（右上）
  const r = retryRect()
  ctx.fillStyle   = 'rgba(13,16,32,0.6)'
  ctx.strokeStyle = 'rgba(205,211,224,0.35)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.roundRect(r.x, r.y, r.w, r.h, 4)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle    = '#cdd3e0'
  ctx.font         = '400 11px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('やりなおす', r.x + r.w / 2, r.y + r.h / 2)
  ctx.textBaseline = 'alphabetic'

  // 雫ゲージ（左上）
  drawInkGauge()
}

// ── 雫ゲージ ──
function drawInkGauge() {
  const lv      = LEVELS[levelIdx]
  const inkTotal = lv.inkSeconds * P.INK_SECONDS_MUL
  const ratio   = inkDepleted ? 0 : Math.max(0, inkRemain / inkTotal)
  const gx = 14
  const gy = 64
  const gw = 14
  const gh = 46

  ctx.save()
  // 輪郭
  ctx.strokeStyle = 'rgba(205,211,224,0.5)'
  ctx.lineWidth   = 1
  ctx.beginPath()
  ctx.roundRect(gx, gy, gw, gh, 2)
  ctx.stroke()

  // 中身（下から満たす）
  if (ratio > 0) {
    const fillH = gh * ratio
    const isLow = ratio < 0.3
    let color   = isLow ? '#ff5a3c' : '#7fc3ff'
    let alpha   = 1
    if (isLow) {
      alpha = 0.5 + 0.5 * (Math.sin(t * 4) > 0 ? 1 : 0)
    }
    ctx.globalAlpha = alpha
    ctx.fillStyle   = hexA(color, 0.75)
    ctx.beginPath()
    ctx.roundRect(gx + 1, gy + gh - fillH + 1, gw - 2, fillH - 1, 1)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  ctx.restore()
}

// ── クリアオーバーレイ ──
function drawClearOverlay() {
  ctx.fillStyle = 'rgba(13,16,32,0.5)'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = '#e8e2d4'
  ctx.font         = '600 26px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('ともった。', W / 2, H * 0.38)

  // 月アイコン＋ラベル
  const moonY = H * 0.47
  drawMoonIcon(W / 2, moonY, 18, clearMoonRating)
  const moonLabel = clearMoonRating === 3 ? '満月' : clearMoonRating === 2 ? '半月' : '三日月'
  ctx.fillStyle    = '#e8e2d4'
  ctx.font         = '400 14px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(moonLabel, W / 2, moonY + 30)

  const blink = Math.sin(t * 5) > 0
  if (blink && clearDelay <= 0) {
    ctx.fillStyle = 'rgba(205,211,224,0.7)'
    ctx.font      = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
    ctx.fillText('つぎの夜へ', W / 2, H * 0.60)
  }
  ctx.textBaseline = 'alphabetic'
}

// ── 失敗オーバーレイ ──
function drawFailOverlay() {
  ctx.fillStyle = 'rgba(13,16,32,0.6)'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = '#e8e2d4'
  ctx.font         = '500 22px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('墨が、尽きた。', W / 2, H * 0.44)
  ctx.fillStyle = 'rgba(205,211,224,0.6)'
  ctx.font      = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('タップでやりなおす', W / 2, H * 0.53)
  ctx.textBaseline = 'alphabetic'
}

// ── 全クリアオーバーレイ ──
function drawAlldoneOverlay() {
  ctx.fillStyle    = 'rgba(13,16,32,0.65)'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = '#e8e2d4'
  ctx.font         = '600 22px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('十二夜、すべてともった。', W / 2, H * 0.42)
  ctx.fillStyle = '#b06cff'
  ctx.font      = '400 15px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('水遊びがほどけた', W / 2, H * 0.51)
  ctx.fillStyle = 'rgba(205,211,224,0.5)'
  ctx.font      = '400 12px "Hiragino Mincho ProN","Yu Mincho",serif'
  if (Math.sin(t * 4) > 0) ctx.fillText('タップでタイトルへ', W / 2, H * 0.61)
  ctx.textBaseline = 'alphabetic'
}

// ── タイトル画面 ──
function drawTitle() {
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'

  // 文字の可読性を守る夜色のスクリム（中央帯を静かに沈める）
  const scrim = ctx.createLinearGradient(0, H * 0.18, 0, H * 0.9)
  scrim.addColorStop(0, hexA(BG_COLOR, 0))
  scrim.addColorStop(0.25, hexA(BG_COLOR, 0.55))
  scrim.addColorStop(0.75, hexA(BG_COLOR, 0.55))
  scrim.addColorStop(1, hexA(BG_COLOR, 0))
  ctx.fillStyle = scrim
  ctx.fillRect(0, H * 0.18, W, H * 0.72)

  // タイトル「流灯」
  const titleY = H * 0.32
  ctx.fillStyle = '#e8e2d4'
  ctx.font      = '600 46px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('流灯', W / 2, titleY)

  // 「流灯」の水面反射
  ctx.save()
  ctx.translate(0, titleY * 2 + 16)
  ctx.scale(1, -0.55)
  ctx.globalAlpha = 0.12
  ctx.fillStyle   = '#e8e2d4'
  ctx.font        = '600 46px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('流灯', W / 2, titleY)
  ctx.restore()
  ctx.globalAlpha = 1

  // サブタイトル
  ctx.fillStyle = 'rgba(205,211,224,0.8)'
  ctx.font      = '400 15px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('ながして、ともす。', W / 2, H * 0.41)

  // 説明
  ctx.fillStyle = 'rgba(205,211,224,0.55)'
  ctx.font      = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
  const descs = [
    '触れられるのは、水だけ。',
    'なぞって流れを起こし、灯りを灯籠へ。',
    '赤と青がまざれば、紫。',
    'とんと叩けば、波紋がひろがる。',
  ]
  for (let i = 0; i < descs.length; i++) {
    ctx.fillText(descs[i], W / 2, H * 0.50 + i * 22)
  }

  // 月コレクション
  const ratings = getMoonRatings()
  const collY   = H * 0.68
  const slots   = 12
  const slotW   = Math.min(26, (W * 0.8) / slots)
  const startX  = W / 2 - (slots - 1) * slotW / 2
  for (let i = 0; i < slots; i++) {
    const r = ratings[i] || 0
    drawMoonIcon(startX + i * slotW, collY, 7, r)
  }

  // メニュー
  const itemY   = H * 0.72
  const itemH   = 40
  const itemGap = 48
  const items: { label: string; special?: boolean }[] = [{ label: 'はじめから' }]
  if (nightBest > 0) {
    items.push({ label: `つづきから（${nightBest}夜目〜）` })
    items.push({ label: '夜をえらぶ' })
  }
  if (nightBest >= LEVELS.length) items.push({ label: '水遊び', special: true })

  for (let i = 0; i < items.length; i++) {
    drawMenuItem(items[i].label, W / 2, itemY + i * itemGap + itemH / 2, !!items[i].special)
  }

  ctx.textBaseline = 'alphabetic'
}

// ── 夜選択オーバーレイ ──
function drawSelectOverlay() {
  ctx.fillStyle = 'rgba(13,16,32,0.82)'
  ctx.fillRect(0, 0, W, H)

  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = '#e8e2d4'
  ctx.font         = '500 18px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('夜をえらぶ', W / 2, H * 0.12)

  const ratings  = getMoonRatings()
  const rowH     = 48
  const startY   = H * 0.18
  const available = Math.min(nightBest + 1, LEVELS.length)

  for (let i = 0; i < available; i++) {
    const lv   = LEVELS[i]
    const y    = startY + i * rowH
    const r    = ratings[i] || 0
    const isTap = ptr.justPressed && ptr.y >= y && ptr.y < y + rowH

    ctx.fillStyle   = isTap ? 'rgba(205,211,224,0.1)' : 'transparent'
    ctx.fillRect(0, y, W, rowH)

    ctx.strokeStyle = 'rgba(205,211,224,0.1)'
    ctx.lineWidth   = 0.5
    ctx.beginPath()
    ctx.moveTo(W * 0.1, y + rowH - 0.5); ctx.lineTo(W * 0.9, y + rowH - 0.5)
    ctx.stroke()

    ctx.fillStyle    = '#cdd3e0'
    ctx.font         = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
    ctx.textAlign    = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText(lv.name, W * 0.12, y + rowH / 2)

    drawMoonIcon(W * 0.88, y + rowH / 2, 9, r)
  }

  // もどる
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = 'rgba(205,211,224,0.5)'
  ctx.font         = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('もどる', W / 2, H * 0.94)

  // タップ処理
  if (ptr.justPressed) {
    ensureAudioOnce()
    if (ptr.y >= H * 0.9) {
      mode = 'title'
      return
    }
    const i = Math.floor((ptr.y - startY) / rowH)
    if (i >= 0 && i < available) {
      startLevel(i)
    }
  }

  ctx.textBaseline = 'alphabetic'
}

// ── メニュー項目 ──
function drawMenuItem(label: string, x: number, y: number, special: boolean) {
  ctx.textBaseline = 'middle'
  const tw   = Math.max(160, ctx.measureText(label).width + 40)
  ctx.fillStyle   = 'rgba(13,16,32,0.55)'
  ctx.strokeStyle = special ? 'rgba(176,108,255,0.6)' : 'rgba(205,211,224,0.35)'
  ctx.lineWidth   = 1.2
  ctx.beginPath()
  ctx.roundRect(x - tw / 2, y - 18, tw, 36, 6)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle    = special ? '#b06cff' : '#cdd3e0'
  ctx.font         = '500 15px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, x, y)
}

// ── 月アイコン（rating: 0=未/輪, 1=三日月, 2=半月, 3=満月）──
function drawMoonIcon(cx: number, cy: number, r: number, rating: number) {
  ctx.save()
  if (rating === 0) {
    ctx.strokeStyle = 'rgba(205,211,224,0.3)'
    ctx.lineWidth   = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fillStyle = '#e8e2d4'
    ctx.fill()
    if (rating < 3) {
      const offset = rating === 2 ? r * 0.95 : r * 0.5
      ctx.beginPath()
      ctx.arc(cx + offset, cy, r * 1.05, 0, Math.PI * 2)
      ctx.fillStyle = BG_COLOR
      ctx.fill()
    }
  }
  ctx.restore()
}

// ── SHOT ──
if (SHOT === '1') {
  setTimeout(() => {
    for (let i = 0; i < 110; i++) {
      sim.splat(0.5, 0.06, 0, 12, [DYE_AKA[0] * 0.4, DYE_AKA[1] * 0.4, DYE_AKA[2] * 0.4], 0.0016)
      if (i % 12 === 0) sim.splat(0.3 + (i % 36) / 90, 0.3, (i % 24) - 12, 20, null, 0.004)
      sim.step(1 / 60)
    }
    mode = 'title'
  }, 350)
} else if (SHOT === 'play') {
  setTimeout(() => {
    startLevel(11) // 十二夜
    const lv = LEVELS[11]
    for (let i = 0; i < 170; i++) {
      sim.splat(lv.sources[0].x, lv.sources[0].y, 0, 14, [DYE_AKA[0] * 0.55, DYE_AKA[1] * 0.55, DYE_AKA[2] * 0.55], 0.0016)
      sim.splat(lv.sources[1].x, lv.sources[1].y, 0, 14, [DYE_AO[0]  * 0.55, DYE_AO[1]  * 0.55, DYE_AO[2]  * 0.55], 0.0016)
      if (i === 30) { sim.splat(0.24, 0.3, 60, 90, null, 0.004); sim.splat(0.76, 0.3, -60, 90, null, 0.004) }
      if (i === 90) { sim.splat(0.35, 0.55, 30, 70, null, 0.004); sim.splat(0.65, 0.55, -30, 70, null, 0.004) }
      sim.step(1 / 60)
    }
    lanternStates[0].lit = true
    lanternStates[1].lit = true
    mode = 'play'
  }, 350)
}

requestAnimationFrame(frame)
