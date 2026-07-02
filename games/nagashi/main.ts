// 『流灯』— ながして、ともす。 GPU流体パズル（Playlab No.09）
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
// glCanvas: 下層 WebGL（流体レンダリング）
// canvas  : 上層 2D（灯籠・水源・HUD・オーバーレイ）
const glCanvas = document.getElementById('fluid') as HTMLCanvasElement
const canvas   = document.getElementById('game')  as HTMLCanvasElement
const ctx      = canvas.getContext('2d')!

const Q    = new URLSearchParams(location.search)
const SHOT = Q.get('shot')

// ── URLリンクとUI ──
document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
mountMuteButton()
enterTransition()

// ── 調整パネル ──
const P = tune.panel(
  'nagashi',
  {
    SPLAT_FORCE:  { v: 900,    min: 200,   max: 2500, step: 50,     group: '水',   label: 'なぞりの力' },
    SPLAT_RADIUS: { v: 0.0022, min: 0.0005, max: 0.008, step: 0.0001, group: '水', label: 'なぞりの太さ' },
    CURL:         { v: 24,     min: 0,     max: 60,   step: 1,     group: '水',   label: 'うずの強さ', desc: '大きいほど流れが渦を巻いて崩れる' },
    DYE_DISS:     { v: 0.35,   min: 0,     max: 1.5,  step: 0.05,  group: '水',   label: '墨の消えやすさ' },
    SOURCE_RATE:  { v: 1,      min: 0.3,   max: 3,    step: 0.1,   group: '遊び', label: '水源の量' },
    LIGHT_TH:     { v: 0.22,   min: 0.05,  max: 0.6,  step: 0.01,  group: '遊び', label: '点灯に要る濃さ' },
    LIGHT_HOLD:   { v: 1.2,    min: 0.2,   max: 3,    step: 0.1,   group: '遊び', label: '点灯に要る秒数' },
  },
  { version: 1 },
)

// ── 色定数 ──
const DYE_AKA: [number, number, number]    = [1.0, 0.25, 0.10]
const DYE_AO:  [number, number, number]    = [0.12, 0.45, 1.0]
const CSS_AKA = '#ff5a3c'
const CSS_AO  = '#3f9dff'
const CSS_MURASAKI = '#b06cff'

// ── サイズ（2D側）。fitCanvas の cb で更新。宣言は fitCanvas より前。 ──
let W = 390
let H = 700

// ── FluidSim ──
let sim: FluidSim
try {
  sim = new FluidSim(glCanvas, { simRes: 110, dyeRes: 440, bg: [0.05, 0.06, 0.12] })
} catch (e) {
  // WebGL 未対応端末への対応
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

// ── glCanvas のリサイズ（fitCanvas は使わない）──
function resizeGlCanvas() {
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  glCanvas.width  = Math.round(glCanvas.clientWidth  * dpr)
  glCanvas.height = Math.round(glCanvas.clientHeight * dpr)
}

// ── ポインタ（2D 上層に取り付け）──
const ptrh = attachPointer(canvas)
const ptr  = ptrh.pointer

// ── fitCanvas（2D 側のみ。変数は宣言済み）──
// 注意：allocate() は場を全消去するので、実際に寸法が変わった時だけ行う
// （fitCanvas は初期化時にも複数回発火するため、毎回やると墨が消える）
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

// SHOT 時はサイズ固定
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

// ── 効果音（合成・fude の noise/pluck 方式）──
let actx: AudioContext | null   = null
let master: GainNode | null     = null

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

const PENTA = [262, 294, 330, 392, 440, 528, 660]

const SFX = {
  // なぞり中：40px 毎に lowpass ノイズ（速度に比例）
  swipe(spd: number) {
    noise(0.08, 400 + spd * 0.5, 1.5, Math.min(0.06, 0.03 + spd * 0.00003), 'lowpass')
  },
  // 灯籠点灯：鈴
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
  // クリア：ペンタトニック上昇3音
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
  // 水遊びの墨
  freePluck() {
    pluck(PENTA[Math.floor(Math.random() * PENTA.length)], 0.05)
  },
}

// ── 状態 ──
type Mode = 'title' | 'play' | 'clear' | 'alldone' | 'free'
let mode: Mode = 'title'
let levelIdx   = -1       // 現在の夜（0..7）、-1 はタイトル中
let nightBest  = Number(localStorage.getItem('playlab.nagashi.night') || 0)

// 灯籠の状態
type LanternState = { lit: boolean; holdSec: number; ripple: number }
let lanternStates: LanternState[] = []

let probeFrame = 0       // readProbe のフレームカウンタ
let hintTimer  = 0       // ヒント表示カウンタ
let clearDelay = 0       // クリア演出後の待機
let t          = 0       // グローバル時刻（秒）

// ── スワイプ軌跡（2D側のフェード描画用）──
type Trail = { x: number; y: number; age: number }
let trail: Trail[]   = []
let prevPtr          = { x: 0, y: 0 }
let lastSwipeSfxDist = 0   // SFX 用累積距離

// ── デモ用（タイトル中の定期 splat）──
let demoTimer = 0

// ── 障害物を sim に適用 ──
function applyObstacles() {
  const lv = LEVELS[levelIdx]
  if (!lv || !lv.rocks || lv.rocks.length === 0) {
    sim.setObstacleMask(null)
  } else {
    sim.setObstacleMask({ circles: lv.rocks })
  }
}

// ── レベル開始 ──
function startLevel(idx: number) {
  levelIdx = idx
  sim.clear()
  applyObstacles()
  const lv = LEVELS[idx]
  lanternStates = lv.lanterns.map(() => ({ lit: false, holdSec: 0, ripple: 0 }))
  hintTimer = 6
  mode = 'play'
  trail = []
  lastSwipeSfxDist = 0
  probeFrame       = 0
}

// ── タイトルへ ──
function goTitle() {
  mode     = 'title'
  levelIdx = -1
  sim.clear()
  sim.setObstacleMask(null)
  trail = []
}

// ── やりなおす ──
function restartLevel() {
  if (levelIdx >= 0) startLevel(levelIdx)
}

// ── 「やりなおす」ボタン矩形（HUD）──
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

  // tune パネルを sim に反映
  sim.opts.curl           = P.CURL
  sim.opts.dyeDissipation = P.DYE_DISS

  if (!isPanelOpen()) {
    update(dt)
  }

  // WebGL 描画（下層）
  sim.render()

  // 2D 描画（上層）
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  draw()

  ptrh.endFrame()
}

// ── 更新 ──
function update(dt: number) {
  t += dt

  // ── ポインタ入力（なぞり）──
  if (ptr.down) {
    if (!ensureAudioOnce.done) ensureAudioOnce()

    const dx = ptr.x - prevPtr.x
    const dy = ptr.y - prevPtr.y
    const dist = Math.hypot(dx, dy)

    if (dist >= 6) {
      // 中間を2分割して滑らかに
      const mx = (prevPtr.x + ptr.x) / 2
      const my = (prevPtr.y + ptr.y) / 2
      sim.splat(mx / W, my / H, dx / W * P.SPLAT_FORCE, dy / H * P.SPLAT_FORCE, null, P.SPLAT_RADIUS)
      sim.splat(ptr.x / W, ptr.y / H, dx / W * P.SPLAT_FORCE, dy / H * P.SPLAT_FORCE, null, P.SPLAT_RADIUS)

      trail.push({ x: ptr.x, y: ptr.y, age: 0 })

      lastSwipeSfxDist += dist
      if (lastSwipeSfxDist >= 40) {
        const spd = dist / Math.max(dt, 0.001)
        SFX.swipe(spd)
        lastSwipeSfxDist = 0
      }

      // free モード：タップ位置に色墨
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

  // free モード：タップした瞬間に墨
  if (mode === 'free' && ptr.justPressed) {
    ensureAudioOnce()
    const hue = Math.random() * 360
    const [r, g, b] = hsvToRgb(hue, 0.85, 1.0)
    sim.splat(ptr.x / W, ptr.y / H, 0, 30, [r, g, b], P.SPLAT_RADIUS * 2)
    SFX.freePluck()
  }

  // 軌跡の老化
  for (const tr of trail) tr.age += dt
  trail = trail.filter(tr => tr.age < 0.5)

  // ── モード別 ──
  if (mode === 'play') {
    updatePlay(dt)
  } else if (mode === 'free') {
    updateFree(dt)
  } else if (mode === 'title') {
    updateTitle(dt)
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
  } else if (mode === 'alldone') {
    if (ptr.justPressed) {
      ensureAudioOnce()
      goTitle()
    }
  }
}

function updatePlay(dt: number) {
  const lv = LEVELS[levelIdx]

  // 水源（毎フレーム）
  for (const src of lv.sources) {
    const dye: [number, number, number] = src.color === 'aka'
      ? [DYE_AKA[0] * 0.55 * P.SOURCE_RATE, DYE_AKA[1] * 0.55 * P.SOURCE_RATE, DYE_AKA[2] * 0.55 * P.SOURCE_RATE]
      : [DYE_AO[0]  * 0.55 * P.SOURCE_RATE, DYE_AO[1]  * 0.55 * P.SOURCE_RATE, DYE_AO[2]  * 0.55 * P.SOURCE_RATE]
    sim.splat(src.x, src.y, 0, 12, dye, 0.0016)
  }

  // vents
  if (lv.vents) {
    for (const v of lv.vents) {
      sim.splat(v.x, v.y, v.dx, v.dy, null, 0.003)
    }
  }

  // current（全体の定常流）
  if (lv.current) {
    const { dx, dy } = lv.current
    for (const px of [0.2, 0.4, 0.6, 0.8]) {
      sim.splat(px, 0.5, dx, dy, null, 0.02)
    }
  }

  // 流体ステップ
  sim.step(dt)

  // ヒントタイマー
  hintTimer = Math.max(0, hintTimer - dt)

  // 判定（5 フレームに1回。SHOT中は静止画のため判定しない）
  probeFrame++
  if (probeFrame % 5 === 0 && !SHOT) {
    sim.readProbe()
    let allLit = true
    for (let i = 0; i < lv.lanterns.length; i++) {
      const ln   = lv.lanterns[i]
      const st   = lanternStates[i]
      if (st.lit) continue

      const [r, , b] = sim.probeAt(ln.x, ln.y)
      let satisfied = false
      if (ln.need === 'aka')      satisfied = r >= P.LIGHT_TH
      else if (ln.need === 'ao') satisfied = b >= P.LIGHT_TH
      else                        satisfied = r >= P.LIGHT_TH * 0.6 && b >= P.LIGHT_TH * 0.6

      if (satisfied) {
        st.holdSec += (5 / 60)  // 約 5 フレーム分
        if (st.holdSec >= P.LIGHT_HOLD) {
          st.lit    = true
          st.ripple = 1
          SFX.lantern()
        }
      } else {
        st.holdSec = Math.max(0, st.holdSec - (5 / 60) * 2)
      }
      allLit = false
    }
    // 全灯確認
    if (lv.lanterns.every((_, i) => lanternStates[i].lit)) {
      // クリア
      const night = levelIdx + 1
      if (night > nightBest) {
        nightBest = night
        localStorage.setItem('playlab.nagashi.night', String(nightBest))
      }
      SFX.clear()
      mode       = 'clear'
      clearDelay = 0.8
      void allLit
    }
  }

  // 波紋フェード
  for (const st of lanternStates) {
    if (st.ripple > 0) st.ripple = Math.max(0, st.ripple - dt * 0.8)
  }

  // タッチ：やりなおすボタン
  if (ptr.justPressed) {
    ensureAudioOnce()
    const r = retryRect()
    if (ptr.x >= r.x && ptr.x <= r.x + r.w && ptr.y >= r.y && ptr.y <= r.y + r.h) {
      restartLevel()
    }
  }
}

function updateFree(dt: number) {
  sim.step(dt)
}

function updateTitle(dt: number) {
  // デモ：中央に aka 水源 + 2秒毎ランダム splat
  sim.splat(0.5, 0.06, 0, 12, [DYE_AKA[0] * 0.4, DYE_AKA[1] * 0.4, DYE_AKA[2] * 0.4], 0.0016)
  demoTimer -= dt
  if (demoTimer <= 0) {
    demoTimer = 2
    const rx = 0.2 + Math.random() * 0.6
    const ry = 0.3 + Math.random() * 0.4
    sim.splat(rx, ry, (Math.random() - 0.5) * 80, (Math.random() - 0.5) * 80, null, 0.015)
  }
  sim.step(dt)

  // タイトルのタップ処理
  if (ptr.justPressed) {
    ensureAudioOnce()
    // メニュー項目の矩形をヒットテスト
    const itemY  = H * 0.72
    const itemH  = 40
    const itemGap = 48
    // はじめから
    if (ptr.y >= itemY && ptr.y < itemY + itemH) {
      startLevel(0)
      return
    }
    // つづきから（進捗があれば）
    if (nightBest > 0 && ptr.y >= itemY + itemGap && ptr.y < itemY + itemGap + itemH) {
      startLevel(Math.min(nightBest, LEVELS.length - 1))
      return
    }
    // 水遊び（全夜クリア後）
    const freeOffset = nightBest >= LEVELS.length ? itemGap * 2 : itemGap
    if (nightBest >= LEVELS.length && ptr.y >= itemY + freeOffset && ptr.y < itemY + freeOffset + itemH) {
      mode     = 'free'
      levelIdx = -1
      sim.clear()
      sim.setObstacleMask(null)
    }
  }
}

// ── 一度だけ AudioContext を初期化するユーティリティ ──
const ensureAudioOnce: { (): void; done: boolean } = Object.assign(
  () => {
    if (!ensureAudioOnce.done) {
      ensureAudio()
      ensureAudioOnce.done = true
    }
  },
  { done: false },
)

// ── HSV → RGB ──
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c  = v * s
  const x  = c * (1 - Math.abs((h / 60) % 2 - 1))
  const m  = v - c
  let r = 0, g = 0, b = 0
  if (h < 60)       { r = c; g = x; b = 0 }
  else if (h < 120) { r = x; g = c; b = 0 }
  else if (h < 180) { r = 0; g = c; b = x }
  else if (h < 240) { r = 0; g = x; b = c }
  else if (h < 300) { r = x; g = 0; b = c }
  else              { r = c; g = 0; b = x }
  return [r + m, g + m, b + m]
}

// ── 2D 描画 ──
function draw() {
  if (mode === 'title')   { drawTitle(); return }
  if (mode === 'free')    { drawFree();  return }
  if (mode === 'play' || mode === 'clear' || mode === 'alldone') {
    drawGame()
  }
}

function drawGame() {
  const lv = LEVELS[levelIdx]

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

  // 水源（かけひ）
  for (const src of lv.sources) {
    drawKakehi(src.x * W, src.y * H, src.color)
  }

  // 灯籠
  for (let i = 0; i < lv.lanterns.length; i++) {
    const ln = lv.lanterns[i]
    const st = lanternStates[i]
    drawLantern(ln.x * W, ln.y * H, ln.need, st)
  }

  // HUD
  drawHud()

  // clear / alldone オーバーレイ
  if (mode === 'clear') {
    drawClearOverlay()
  } else if (mode === 'alldone') {
    drawAlldoneOverlay()
  }
}

function drawFree() {
  // free: 戻るボタンのみ（背景は WebGL）
  ctx.fillStyle = 'rgba(205,211,224,0.7)'
  ctx.font      = '500 13px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillText('水遊び — 自由に色の流れを楽しむ', W / 2, H - 28)
}

// ── かけひ（竹筒）描画 ──
function drawKakehi(x: number, y: number, color: 'aka' | 'ao') {
  const css   = color === 'aka' ? CSS_AKA : CSS_AO
  const pulse = 0.7 + 0.3 * Math.sin(t * 3)

  ctx.save()
  ctx.translate(x, y)

  // 竹筒本体（斜め矩形）
  ctx.fillStyle = 'rgba(180,200,180,0.75)'
  ctx.strokeStyle = 'rgba(140,170,140,0.8)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.rect(-5, -12, 10, 18)
  ctx.fill()
  ctx.stroke()

  // 竹の節
  ctx.strokeStyle = 'rgba(100,140,100,0.7)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-5, -4)
  ctx.lineTo(5, -4)
  ctx.stroke()

  // 先端の色の雫（点滅）
  ctx.globalAlpha = pulse
  ctx.fillStyle   = css
  ctx.shadowColor  = css
  ctx.shadowBlur   = 8
  ctx.beginPath()
  ctx.arc(0, 8, 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.shadowBlur = 0
  ctx.globalAlpha = 1

  ctx.restore()
}

// ── 灯籠描画 ──
function drawLantern(x: number, y: number, need: 'aka' | 'ao' | 'murasaki', st: LanternState) {
  const css    = need === 'aka' ? CSS_AKA : need === 'ao' ? CSS_AO : CSS_MURASAKI
  const bob    = Math.sin(t * 1.4 + x) * 2  // 上下ゆらぎ
  const flame  = st.lit ? (0.8 + 0.2 * Math.sin(t * 7 + x)) : 0

  ctx.save()
  ctx.translate(x, y + bob)

  // 波紋
  if (st.ripple > 0) {
    const rScale = 1 - st.ripple
    const rAlpha = st.ripple * 0.5
    ctx.strokeStyle = css
    ctx.lineWidth   = 2
    ctx.globalAlpha = rAlpha
    ctx.beginPath()
    ctx.arc(0, 0, 40 + rScale * 30, 0, Math.PI * 2)
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  // 点灯時：ハロー（中心から消えていく放射グラデーション）
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

  // 提灯本体（楕円）
  ctx.strokeStyle = st.lit ? css : 'rgba(205,211,224,0.35)'
  ctx.lineWidth   = st.lit ? 1.8 : 1.2
  ctx.globalAlpha = st.lit ? 0.95 : 0.45
  ctx.beginPath()
  ctx.ellipse(0, 0, 13, 18, 0, 0, Math.PI * 2)
  if (st.lit) {
    ctx.fillStyle = css
    ctx.globalAlpha = 0.35 * flame
    ctx.fill()
    ctx.globalAlpha = 0.95
  }
  ctx.stroke()

  // 縦のひご線（2本）
  ctx.strokeStyle = st.lit ? css : 'rgba(205,211,224,0.28)'
  ctx.lineWidth   = 0.8
  ctx.globalAlpha = st.lit ? 0.6 : 0.4
  for (const ox of [-5, 5]) {
    ctx.beginPath()
    ctx.moveTo(ox, -18)
    ctx.lineTo(ox, 18)
    ctx.stroke()
  }

  // 必要な色のリング（未点灯時の手掛かり）
  if (!st.lit) {
    ctx.strokeStyle = css
    ctx.lineWidth   = 1.5
    ctx.globalAlpha = 0.55
    ctx.beginPath()
    ctx.ellipse(0, 0, 17, 22, 0, 0, Math.PI * 2)
    ctx.stroke()
  }

  ctx.globalAlpha = 1
  ctx.restore()
}

// ── 岩描画（円を3つ重ねたブロブ）──
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

// ── vent 泡描画 ──
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

  // 夜名（上中央）
  ctx.fillStyle = '#cdd3e0'
  ctx.font      = '500 16px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText(lv.name, W / 2, 36)

  // ヒント（開始から6秒でフェードアウト）
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
}

// ── クリアオーバーレイ ──
function drawClearOverlay() {
  ctx.fillStyle    = 'rgba(13,16,32,0.5)'
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign    = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillStyle    = '#e8e2d4'
  ctx.font         = '600 26px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('ともった。', W / 2, H * 0.44)

  const blink = Math.sin(t * 5) > 0
  if (blink && clearDelay <= 0) {
    ctx.fillStyle = 'rgba(205,211,224,0.7)'
    ctx.font      = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
    ctx.fillText('つぎの夜へ', W / 2, H * 0.53)
  }
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
  ctx.fillText('八夜、すべてともった。', W / 2, H * 0.42)
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

  // タイトル（明朝 46px）
  ctx.fillStyle = '#e8e2d4'
  ctx.font      = '600 46px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('流灯', W / 2, H * 0.32)

  // サブタイトル
  ctx.fillStyle = 'rgba(205,211,224,0.8)'
  ctx.font      = '400 15px "Hiragino Mincho ProN","Yu Mincho",serif'
  ctx.fillText('ながして、ともす。', W / 2, H * 0.41)

  // 説明3行
  ctx.fillStyle = 'rgba(205,211,224,0.55)'
  ctx.font      = '400 13px "Hiragino Mincho ProN","Yu Mincho",serif'
  const descs = [
    '触れられるのは、水だけ。',
    'なぞって流れを起こし、灯りを灯籠へ。',
    '赤と青がまざれば、紫。',
  ]
  for (let i = 0; i < descs.length; i++) {
    ctx.fillText(descs[i], W / 2, H * 0.50 + i * 22)
  }

  // メニュー
  const itemY  = H * 0.72
  const itemH  = 40
  const itemGap = 48

  drawMenuItem('はじめから', W / 2, itemY + itemH / 2, false)
  if (nightBest > 0) {
    drawMenuItem(`つづきから（${nightBest}夜目〜）`, W / 2, itemY + itemGap + itemH / 2, false)
  }
  if (nightBest >= LEVELS.length) {
    const off = nightBest > 0 ? itemGap * 2 : itemGap
    drawMenuItem('水遊び', W / 2, itemY + off + itemH / 2, true)
  }

  ctx.textBaseline = 'alphabetic'
}

function drawMenuItem(label: string, x: number, y: number, special: boolean) {
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

// ── SHOT（QA・サムネ撮影）──
// リサイズ/allocate が落ち着いた後に前ロールする（先に走ると場がリセットされ墨が消える）
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
    startLevel(7) // 八夜：灯籠3つ＋岩＋噴き（1つ点けてもクリアにならず絵が揃う）
    const lv = LEVELS[7]
    // 途中で左右から内へ寄せる流れを作りつつ、水源を吐かせながら前ロール
    for (let i = 0; i < 170; i++) {
      sim.splat(lv.sources[0].x, lv.sources[0].y, 0, 14, [DYE_AKA[0] * 0.55, DYE_AKA[1] * 0.55, DYE_AKA[2] * 0.55], 0.0016)
      sim.splat(lv.sources[1].x, lv.sources[1].y, 0, 14, [DYE_AO[0] * 0.55, DYE_AO[1] * 0.55, DYE_AO[2] * 0.55], 0.0016)
      if (i === 30) { sim.splat(0.24, 0.3, 60, 90, null, 0.004); sim.splat(0.76, 0.3, -60, 90, null, 0.004) }
      if (i === 90) { sim.splat(0.35, 0.55, 30, 70, null, 0.004); sim.splat(0.65, 0.55, -30, 70, null, 0.004) }
      sim.step(1 / 60)
    }
    lanternStates[0].lit = true
    mode = 'play'
  }, 350)
}

requestAnimationFrame(frame)
