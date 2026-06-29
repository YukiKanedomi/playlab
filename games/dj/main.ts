// きいて、かえして。 — コール&レスポンスのリズムゲー。DJ(ミニキャラ)のお手本を同じリズムで返す。
// 成功を重ねるほどヒート上昇→オーディエンス増→演出が派手に。冷めると客が帰る(負け)。
// 新技術＝WebAudioでビート合成＋タイミング同期。作風はラボ・スキンから卒業した暗いクラブ×ネオン。
import { attachPointer, fitCanvas, safeBottom } from '../../shared/input'
import { isMuted, onMuteChange, mountMuteButton } from '../../shared/audio'
import { Particles, makeShake, clamp } from '../../shared/juice'
import { drawHowToCard } from '../../shared/shell'
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
const shot = params.get('shot')
const shotMode = !!shot
function setupShotCalib() {
  state = 'calib'
  calibTaps = [0.05, 0.04, 0.06]
  beatPulse = 0.7
}

// ── ネオン配色 ──
const C = { bg0: '#171029', bg1: '#0b0815', cyan: '#28e0d0', magenta: '#ff3d9a', violet: '#9b6cff', amber: '#ffc24a', ink: '#f3eeff', dim: 'rgba(243,238,255,0.5)' }

// ── 音楽 ──
let BPM = 100
const SUBDIV = 8 // 1小節=8つの8分
const BEST_KEY = 'playlab.dj.best'
let actx: any = null
let master: GainNode
let reverb: any = null // 残響バス（送り）
let noiseBuf: AudioBuffer
let L = 0.03 // 出力遅延の推定/補正値（目・耳・判定を揃えるために全所で使う）
const LAT_KEY = 'playlab.dj.lat'
const WIN = 0.2 // 判定窓（簡単め）
function ensureAudio() {
  if (actx) return
  actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
  L = clamp(Number(localStorage.getItem(LAT_KEY)) || actx.outputLatency || actx.baseLatency || 0.03, 0, 0.35)
  // セッション種別：通常は 'playback'（しっかり鳴らす）、ミュート時は 'ambient'
  // （他アプリ=Apple Music 等と共存し再生を止めない）。リズムゲーはクロックを保つため suspend しない
  try {
    const ns: any = navigator
    if (ns.audioSession) ns.audioSession.type = isMuted() ? 'ambient' : 'playback'
  } catch {}
  master = actx.createGain()
  master.gain.value = isMuted() ? 0 : 0.9 // 共通ミュート対応
  const comp = actx.createDynamicsCompressor()
  master.connect(comp).connect(actx.destination)
  const len = actx.sampleRate * 1
  noiseBuf = actx.createBuffer(1, len, actx.sampleRate)
  const d = noiseBuf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
  // 残響（合成インパルス）。メロディ/和音/歓声を少し送って“空間”を出す
  const rl = Math.floor(actx.sampleRate * 1.1)
  const rb = actx.createBuffer(2, rl, actx.sampleRate)
  for (let ch = 0; ch < 2; ch++) {
    const cd = rb.getChannelData(ch)
    for (let i = 0; i < rl; i++) cd[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 2.6)
  }
  const conv = actx.createConvolver()
  conv.buffer = rb
  const rg = actx.createGain()
  rg.gain.value = 0.22
  conv.connect(rg).connect(master)
  reverb = conv
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
// ── 音が主役：コード進行＋ベース＋パッド＋メロディ＋効果音 ──
// 4小節ループ Am→F→C→G（Aを基準=半音0）。和音はトライアド。
const CHORDS = [
  [0, 3, 7], // Am
  [-4, 0, 3], // F (F A C)
  [-9, -5, -2], // C (低めのCEG)
  [-2, 2, 5], // G (G B D)
]
const chordOf = (bar: number) => CHORDS[((bar % 4) + 4) % 4]
function bass(t: number, semi: number, gain = 0.5) {
  const o = actx.createOscillator(),
    g = actx.createGain()
  o.type = 'triangle'
  o.frequency.value = 55 * Math.pow(2, semi / 12)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.02)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.3)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.32)
}
function scratch(t: number, semi: number) {
  stab(t, semi, 0.5)
  const s = actx.createBufferSource()
  s.buffer = noiseBuf
  const bp = actx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.setValueAtTime(1100, t)
  bp.frequency.exponentialRampToValueAtTime(3200, t + 0.08)
  bp.Q.value = 2
  const g = actx.createGain()
  g.gain.setValueAtTime(0.25, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.1)
  s.connect(bp).connect(g).connect(master)
  s.start(t)
  s.stop(t + 0.12)
}
function airhorn(t: number) {
  const g = actx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.32, t + 0.03)
  g.gain.setValueAtTime(0.32, t + 0.32)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.6)
  g.connect(master)
  for (const m of [1, 1.5, 2.01]) {
    const o = actx.createOscillator()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(330 * m, t)
    o.frequency.linearRampToValueAtTime(392 * m, t + 0.06)
    o.connect(g)
    o.start(t)
    o.stop(t + 0.62)
  }
}
function cheer(t: number) {
  const s = actx.createBufferSource()
  s.buffer = noiseBuf
  const bp = actx.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 900
  bp.Q.value = 0.5
  const g = actx.createGain()
  g.gain.setValueAtTime(0.0001, t)
  g.gain.linearRampToValueAtTime(0.3, t + 0.15)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
  s.connect(bp).connect(g).connect(master)
  s.start(t)
  s.stop(t + 0.75)
}
function recordStop(t: number) {
  const o = actx.createOscillator(),
    g = actx.createGain()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(300, t)
  o.frequency.exponentialRampToValueAtTime(45, t + 0.4)
  g.gain.setValueAtTime(0.4, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.45)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.46)
}
function click(t: number, hi = false) {
  const o = actx.createOscillator(),
    g = actx.createGain()
  o.type = 'square'
  o.frequency.value = hi ? 1500 : 950
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(0.22, t + 0.005)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.06)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.07)
}
// 和音パッド（やわらかい持続音＋残響）＝曲の土台
function pad(t: number, notes: number[]) {
  const dur = barDur()
  for (const s of notes) {
    const o = actx.createOscillator(),
      g = actx.createGain(),
      f = actx.createBiquadFilter()
    o.type = 'triangle'
    o.frequency.value = 220 * Math.pow(2, s / 12)
    f.type = 'lowpass'
    f.frequency.value = 1300
    g.gain.setValueAtTime(0.0001, t)
    g.gain.linearRampToValueAtTime(0.05, t + 0.25)
    g.gain.linearRampToValueAtTime(0.0001, t + dur * 0.95)
    o.connect(f).connect(g)
    g.connect(master)
    if (reverb) g.connect(reverb)
    o.start(t)
    o.stop(t + dur)
  }
}
// メロディの一音（プラック＋残響）。ヒート高で増える
function pluck(t: number, semi: number, gain = 0.12) {
  const o = actx.createOscillator(),
    g = actx.createGain()
  o.type = 'triangle'
  o.frequency.value = 440 * Math.pow(2, semi / 12)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01)
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.26)
  o.connect(g)
  g.connect(master)
  if (reverb) g.connect(reverb)
  o.start(t)
  o.stop(t + 0.28)
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
type State = 'title' | 'calib' | 'calibdone' | 'play' | 'over'
let state: State = 'title'
let best = Number(localStorage.getItem(BEST_KEY) || 0)
let score = 0
let combo = 0
let hype = 0.34
let phraseCount = 0
let level = 0
let phase: 'call' | 'prep' | 'response' = 'call'

// キャリブレーション（音ズレ調整）
const CAL_BEATS = 8
const CAL_KEY = 'playlab.dj.cal'
let calibTimer: any = null
let calibNext = 0
let calibBeats: number[] = []
let calibTaps: number[] = []
let calibHeard = 0
let calibResult: number | null = null

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
let charArm = 0 // 0..1 腕上げ/スクラッチ衝撃
let charBob = 0
let charCelebrate = 0 // 成功で沸く
let charSlump = 0 // ミスで落ち込む
let crowdCheer = 0 // 客が沸く
let crowdShock = 0 // 客がしーん
let countLabel = ''
let countLife = 0
let counting = false
let elapsed = 0
// 判定フィードバック
let judgeText = ''
let judgeColor = ''
let judgeLife = 0
let offsets: number[] = [] // 直近のズレ（−はやい/＋おそい）。タイミングバー用
function showJudge(off: number | null) {
  if (off === null) {
    judgeText = 'ミス'
    judgeColor = C.dim
    judgeLife = 0.5
    return
  }
  offsets.push(off)
  if (offsets.length > 8) offsets.shift()
  if (Math.abs(off) < 0.05) {
    judgeText = 'ジャスト'
    judgeColor = C.amber
  } else if (off < 0) {
    judgeText = 'はやい'
    judgeColor = C.cyan
  } else {
    judgeText = 'おそい'
    judgeColor = C.magenta
  }
  judgeLife = 0.7
}

// スケジューラ
let slot = 0
let nextNoteTime = 0
let schedTimer: any = null
const cues: { time: number; kind: string; idx?: number }[] = []

// パターンの音楽化：手作りのリズム句（易→難）。ランダム卒業。
const PATTERNS = {
  e: [[0, 4], [0, 2, 4], [0, 4, 6], [0, 2, 4, 6]],
  m: [[0, 3, 4, 6], [0, 2, 4, 7], [0, 4, 5, 7], [0, 2, 4, 6, 7]],
  h: [[0, 2, 3, 5, 6], [0, 3, 4, 6, 7], [0, 1, 3, 4, 6], [0, 2, 3, 5, 6, 7]],
}
let lastPattern: number[] = []
let themeRepeat = 0
function startNewPattern() {
  phraseCount++
  level = Math.min(9, Math.floor((phraseCount - 1) / 2))
  const tier = level < 2 ? PATTERNS.e : level < 5 ? PATTERNS.m : PATTERNS.h
  // テーマ→変化：たまに同じ句を1回繰り返して耳に馴染ませる
  if (lastPattern.length && themeRepeat === 0 && Math.random() < 0.4) {
    themeRepeat = 1
    pattern = lastPattern
  } else {
    themeRepeat = 0
    let p = tier[Math.floor(Math.random() * tier.length)]
    if (p === lastPattern && tier.length > 1) p = tier[(tier.indexOf(p) + 1) % tier.length]
    pattern = p
    lastPattern = p
  }
}

function scheduleSlot(s: number, t: number) {
  const slotInBar = s % SUBDIV
  const bar = Math.floor(s / SUBDIV)
  // グルーヴ＋コード（音が主役）
  const chord = chordOf(bar)
  if (slotInBar === 0 || slotInBar === 4) {
    kick(t)
    cues.push({ time: t, kind: 'beat' })
    if (bar > 0) bass(t, chord[0] + (slotInBar === 4 ? 7 : 0))
  }
  if (bar > 0 && slotInBar === 0) pad(t, chord) // 小節頭に和音パッド
  // ハイハット（裏拍はスウィングで少し後ろ＝グルーヴ）
  const sw = slotInBar % 2 === 1 ? eighth() * 0.16 : 0
  hat(t + sw, slotInBar % 2 === 0 ? 0.24 : 0.14)
  if (slotInBar === 4 && hype > 0.5) clap(t, 0.32)
  // メロディ（ヒートが上がるほど増える）
  if (bar > 0) {
    if (hype > 0.4 && (slotInBar === 2 || slotInBar === 6)) pluck(t + sw, chord[1] + 12, 0.1)
    if (hype > 0.72 && (slotInBar === 3 || slotInBar === 7)) pluck(t + sw, chord[2] + 12, 0.08)
  }

  // bar 0 はカウントイン（3・2・1・GO）
  if (bar === 0) {
    if (slotInBar === 0) cues.push({ time: t, kind: 'count', idx: 3 })
    else if (slotInBar === 2) cues.push({ time: t, kind: 'count', idx: 2 })
    else if (slotInBar === 4) cues.push({ time: t, kind: 'count', idx: 1 })
    else if (slotInBar === 6) cues.push({ time: t, kind: 'count', idx: 0 }) // GO
    return
  }

  // 3小節サイクル：0=コール(手本) / 1=予備(せーので構える) / 2=レスポンス(まねる)
  const cyc = (bar - 1) % 3
  // 予備小節：各拍にカウントのクリック（最後の拍は高く＝せーの！）
  if (cyc === 1 && slotInBar % 2 === 0) click(t, slotInBar === 6)
  if (slotInBar === 0) {
    if (cyc === 0) {
      startNewPattern()
      cues.push({ time: t, kind: 'call-start' })
      pattern.forEach((idx, n) => {
        const ht = t + idx * eighth()
        if (idx >= 1) cues.push({ time: ht - eighth(), kind: 'windup' }) // 予備拍：直前にキャラが溜める
        scratch(ht, SCALE[n % SCALE.length])
        cues.push({ time: ht, kind: 'call-hit', idx })
      })
    } else if (cyc === 1) {
      cues.push({ time: t, kind: 'prep-start' })
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
  // 先読みを広げて、応答スロットを早めに用意（食い気味の1音目も拾えるように）
  while (nextNoteTime < actx.currentTime + 0.3) {
    scheduleSlot(slot, nextNoteTime)
    nextNoteTime += eighth()
    slot++
  }
}

// ── キャリブレーション（ビートに合わせてタップ→ズレ平均でLを決める。BT遅延対策） ──
function startCalib() {
  ensureAudio()
  unlockAudio()
  state = 'calib'
  calibBeats = []
  calibTaps = []
  calibHeard = 0
  calibResult = null
  cues.length = 0
  calibNext = actx.currentTime + 0.5
  if (calibTimer) clearInterval(calibTimer)
  calibTimer = setInterval(calibScheduler, 25)
}
function calibScheduler() {
  while (calibNext < actx.currentTime + 0.12) {
    const t = calibNext
    kick(t, 1)
    cues.push({ time: t, kind: 'calbeat' })
    calibBeats.push(t)
    if (calibBeats.length > 16) calibBeats.shift()
    calibNext += beatDur()
  }
}
function calibTap() {
  if (!calibBeats.length) return
  const t = actx.currentTime
  let nb = calibBeats[0]
  for (const b of calibBeats) if (Math.abs(b - t) < Math.abs(nb - t)) nb = b
  const r = t - nb
  if (Math.abs(r) < beatDur() * 0.6) {
    calibTaps.push(r)
    beatPulse = 1
    flash = 0.2
  }
  if (calibTaps.length >= 6) finalizeCalib()
}
function finalizeCalib() {
  if (calibTimer) {
    clearInterval(calibTimer)
    calibTimer = null
  }
  cues.length = 0
  if (calibTaps.length >= 3) {
    const s = [...calibTaps].sort((a, b) => a - b)
    const trimmed = s.length >= 5 ? s.slice(1, -1) : s // 外れ値を端から落とす
    const avg = trimmed.reduce((a, b) => a + b, 0) / trimmed.length
    L = clamp(avg, 0, 0.4)
    localStorage.setItem(LAT_KEY, String(L))
    calibResult = Math.round(L * 1000)
  } else {
    calibResult = -1 // スキップ（Lは据え置き）
  }
  localStorage.setItem(CAL_KEY, '1')
  state = 'calibdone'
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
  lastPattern = []
  themeRepeat = 0
  charCelebrate = charSlump = crowdCheer = crowdShock = 0
  countLabel = ''
  countLife = 0
  counting = true // 最初はカウントイン
  offsets = []
  state = 'play'
  nextNoteTime = actx.currentTime + 0.3
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
    charCelebrate = 0.6
    crowdCheer = 0.7
    cheer(actx.currentTime)
    if (combo % 4 === 0) airhorn(actx.currentTime + 0.04) // 連続成功でエアホーン
  } else {
    combo = 0
    hype = clamp(hype - 0.17, 0, 1)
    lastResult = 'miss'
    audienceTarget = Math.round(6 + hype * 80)
    shakeFx.add(6)
    charSlump = 0.7
    crowdShock = 0.7
    recordStop(actx.currentTime) // ミスはレコード停止音で可笑しく
    if (hype <= 0) gameOver()
  }
}
function pickNeon() {
  return [C.cyan, C.magenta, C.violet, C.amber][Math.floor(Math.random() * 4)]
}

// 入力
const recalY = () => H * 0.84 // タイトルの「音ズレ調整」リンクのy
canvas.addEventListener('pointerdown', () => {
  ensureAudio()
  unlockAudio() // どのタップでも確実にオーディオを起こす（iOS対策）
  if (state === 'title') {
    if (pointer.y > recalY() - 24 && pointer.y < recalY() + 16) return startCalib() // 調整リンク
    return localStorage.getItem(CAL_KEY) ? startGame() : startCalib() // 初回は調整から
  }
  if (state === 'calib') return calibTap()
  if (state === 'calibdone') return startGame()
  if (state === 'over') return elapsed - elapsedAtOver > 0.4 ? startGame() : undefined
  if (state !== 'play') return
  // 応答が用意できていれば局面ラベルに依らず受付（1音目を食い気味でも拾う）
  if (respEvaluated || expected.length === 0) return
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
    const off = jt - expected[bi].time // −はやい / ＋おそい
    expected[bi].matched = true
    scratch(actx.currentTime, SCALE[bi % SCALE.length])
    padFlash[pattern[bi]] = 1
    charArm = 1
    fx.burst(padX(pattern[bi]), padY(), 6, Math.abs(off) < 0.05 ? C.amber : C.cyan, 120, 30)
    showJudge(off)
  } else {
    extraTaps++
    dull(actx.currentTime)
    shakeFx.add(4)
    showJudge(null)
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
  charCelebrate = Math.max(0, charCelebrate - dt)
  charSlump = Math.max(0, charSlump - dt)
  crowdCheer = Math.max(0, crowdCheer - dt)
  crowdShock = Math.max(0, crowdShock - dt)
  countLife = Math.max(0, countLife - dt)
  judgeLife = Math.max(0, judgeLife - dt)
  charBob += dt * (2 + hype * 3)
  audienceShown += (audienceTarget - audienceShown) * Math.min(1, dt * 3)
  shakeFx.update(dt)
  fx.update(dt)

  if (actx && (state === 'play' || state === 'calib')) {
    // キュー消化（出力遅延Lぶん遅らせて＝音が聞こえる瞬間に光らせる）
    while (cues.length && cues[0].time + L <= actx.currentTime) {
      const c = cues.shift()!
      if (c.kind === 'beat') beatPulse = 1
      if (c.kind === 'calbeat') calibHeard++ // キャリブ中は“光”で誘導しない（耳でタップ）
      else if (c.kind === 'count') {
        countLabel = c.idx ? String(c.idx) : 'GO'
        countLife = 0.55
        beatPulse = 1
      } else if (c.kind === 'windup') {
        charArm = Math.max(charArm, 0.5) // 予備動作：直前にキャラが溜める
      } else if (c.kind === 'call-start') {
        phase = 'call'
        curBarStart = c.time
        counting = false
      } else if (c.kind === 'prep-start') {
        phase = 'prep'
        curBarStart = c.time
      } else if (c.kind === 'resp-start') {
        phase = 'response'
        curBarStart = c.time
      } else if (c.kind === 'call-hit') {
        padFlash[c.idx!] = 1
        charArm = 1
      }
    }
  }
  if (state === 'play' && actx) {
    const now = audioTime()
    if (!respEvaluated && now > respBarEnd + WIN + 0.05) {
      respEvaluated = true
      evaluateResponse()
    }
    hype = clamp(hype - dt * 0.012, 0, 1)
    if (hype <= 0 && expected.length === 0) gameOver()
  }
  if (state === 'calib' && actx && calibHeard >= CAL_BEATS) finalizeCalib()
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
    boothCy = H * 0.42 + Math.sin(charBob) * 4
  // ブース
  ctx.save()
  ctx.strokeStyle = hexA(C.cyan, 0.8)
  ctx.lineWidth = 3
  ctx.shadowColor = C.cyan
  ctx.shadowBlur = 14
  const bw = Math.min(220, W * 0.6)
  ctx.strokeRect(cx - bw / 2, boothCy + 20, bw, 70)
  for (const dx of [-bw * 0.26, bw * 0.26]) {
    ctx.beginPath()
    ctx.arc(cx + dx, boothCy + 55, 18, 0, 7)
    ctx.stroke()
  }
  ctx.restore()
  // ミニキャラ：成功で跳ねる／ミスで落ち込む／ヒットで腕を振る
  const jump = charCelebrate > 0 ? Math.sin((1 - charCelebrate / 0.6) * Math.PI) * 16 : 0
  const slump = charSlump > 0 ? 1 : 0
  const cy = boothCy - jump + slump * 6
  ctx.save()
  ctx.translate(cx, cy)
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(0, -2)
  ctx.lineTo(0, 22)
  ctx.stroke()
  // 頭
  ctx.beginPath()
  ctx.arc(0, -16 + slump * 3, 13, 0, 7)
  ctx.fillStyle = C.amber
  ctx.shadowColor = C.amber
  ctx.shadowBlur = 12
  ctx.fill()
  ctx.shadowBlur = 0
  // 目（ミス＝＞＜風、それ以外＝点目）
  ctx.strokeStyle = '#2a1c00'
  ctx.fillStyle = '#2a1c00'
  ctx.lineWidth = 2
  if (slump) {
    ctx.beginPath()
    ctx.moveTo(-7, -19); ctx.lineTo(-2, -16); ctx.moveTo(-2, -19); ctx.lineTo(-7, -16)
    ctx.moveTo(2, -19); ctx.lineTo(7, -16); ctx.moveTo(7, -19); ctx.lineTo(2, -16)
    ctx.stroke()
  } else {
    ctx.beginPath()
    ctx.arc(-4, -17, 1.8, 0, 7)
    ctx.arc(4, -17, 1.8, 0, 7)
    ctx.fill()
  }
  // 腕
  ctx.strokeStyle = C.ink
  ctx.lineWidth = 4
  if (charCelebrate > 0) {
    ctx.beginPath()
    ctx.moveTo(0, 4); ctx.lineTo(-15, -16); ctx.moveTo(0, 4); ctx.lineTo(15, -16) // バンザイ
    ctx.stroke()
  } else if (slump) {
    ctx.beginPath()
    ctx.moveTo(0, 4); ctx.lineTo(-12, 16); ctx.moveTo(0, 4); ctx.lineTo(12, 16) // だらり
    ctx.stroke()
  } else {
    const up = charArm
    ctx.beginPath()
    ctx.moveTo(0, 4); ctx.lineTo(-14, 4 - up * 22); ctx.moveTo(0, 4); ctx.lineTo(14, 4 - up * 22)
    ctx.stroke()
  }
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
    // コール/予備中はパターン位置をうっすら予告（予備は琥珀＝もうすぐ番）
    if ((phase === 'call' || phase === 'prep') && inPattern) {
      ctx.fillStyle = hexA(phase === 'prep' ? C.amber : C.magenta, 0.28)
      ctx.beginPath()
      ctx.arc(x, y, 8, 0, 7)
      ctx.fill()
    }
    // レスポンス中は「叩く対象」を明確に（クリア済みは琥珀で塗り）
    if (phase === 'response' && inPattern) {
      const k = pattern.indexOf(i)
      const done = !!(expected[k] && expected[k].matched)
      ctx.strokeStyle = hexA(done ? C.amber : C.cyan, 0.95)
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.arc(x, y, 16, 0, 7)
      ctx.stroke()
      ctx.fillStyle = hexA(done ? C.amber : C.cyan, done ? 0.55 : 0.18)
      ctx.beginPath()
      ctx.arc(x, y, done ? 10 : 7, 0, 7)
      ctx.fill()
    }
    // プレイヘッド（今ここ＝この線が対象に重なった瞬間にタップ）
    if (head >= 0 && Math.floor(head) === i) {
      ctx.strokeStyle = hexA(C.amber, 0.9)
      ctx.lineWidth = 2.5
      ctx.beginPath()
      ctx.arc(x, y, 20, 0, 7)
      ctx.stroke()
    }
  }
}

function drawAudience() {
  const n = Math.round(audienceShown)
  const baseY = H - 8 - safeBottom()
  ctx.save()
  for (let i = 0; i < n; i++) {
    // 擬似ランダム配置（iベース）
    const rx = ((i * 73) % 100) / 100
    const row = i % 3
    const x = 14 + rx * (W - 28)
    const y = baseY - row * 16
    const shock = crowdShock > 0
    const bob = shock ? 0 : Math.sin(charBob * 1.0 + i) * (1.5 + hype * 4 + crowdCheer * 8)
    const armUp = !shock && (crowdCheer > 0 || (lastResult === 'good' && Math.sin(elapsed * 8 + i) > 0))
    const col = i % 4 === 0 ? hexA(C.violet, shock ? 0.5 : 0.9) : `rgba(8,5,16,${shock ? 0.7 : 0.92})`
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
  // カウントイン or フェーズ表示
  if (countLife > 0) {
    ctx.save()
    ctx.globalAlpha = clamp(countLife / 0.55, 0, 1)
    neonText(countLabel, W / 2, H * 0.34, countLabel === 'GO' ? 48 : 64, C.amber)
    ctx.restore()
  } else if (state === 'play' && !counting) {
    const label = phase === 'call' ? 'きいて！' : phase === 'prep' ? 'せーの…' : 'かえして！'
    const col = phase === 'call' ? C.magenta : phase === 'prep' ? C.amber : C.cyan
    neonText(label, W / 2, H * 0.52, 26, col)
  }
}

function drawCalib() {
  const cx = W / 2,
    cy = H * 0.42
  ctx.save()
  ctx.globalCompositeOperation = 'lighter'
  const r = 42 + beatPulse * 30
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.7)
  g.addColorStop(0, hexA(C.cyan, 0.5 * (0.35 + beatPulse * 0.65)))
  g.addColorStop(1, hexA(C.cyan, 0))
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.7, 0, 7)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = hexA(C.cyan, 0.85)
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, 7)
  ctx.stroke()
  neonText('音ズレ調整', cx, cy - 95, 28, C.cyan)
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  ctx.font = `700 17px "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText('音に合わせてタップ（耳で）', cx, cy + 96)
  ctx.fillStyle = C.dim
  ctx.font = `500 13px "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText(`タップ ${calibTaps.length} / 6`, cx, cy + 124)
  ctx.fillText('イヤホン使用時は特におすすめ', cx, cy + 150)
  ctx.fillText('（タップせず待つとスキップ）', cx, cy + 174)
}
function drawCalibDone() {
  const cx = W / 2,
    cy = H * 0.4
  if (calibResult != null && calibResult >= 0) {
    neonText('調整完了', cx, cy, 30, C.amber)
    ctx.textAlign = 'center'
    ctx.fillStyle = C.ink
    ctx.font = `700 16px "Hiragino Sans", system-ui, sans-serif`
    ctx.fillText(`ズレ +${calibResult}ms を補正`, cx, cy + 38)
  } else {
    neonText('スキップ', cx, cy, 28, C.dim)
  }
  neonText('タップでスタート', cx, cy + 84, 18, C.amber)
}

function drawJudge() {
  if (judgeLife <= 0) return
  ctx.save()
  ctx.globalAlpha = clamp(judgeLife / 0.7, 0, 1)
  neonText(judgeText, W / 2, H * 0.3, 30, judgeColor)
  ctx.restore()
}
function drawTimingMeter() {
  const cx = W / 2,
    y = H * 0.7,
    w = Math.min(240, W - 80)
  ctx.save()
  ctx.textAlign = 'center'
  ctx.fillStyle = 'rgba(255,255,255,0.1)'
  ctx.fillRect(cx - w / 2, y, w, 4)
  ctx.fillStyle = hexA(C.amber, 0.85) // 中央＝ジャスト
  ctx.fillRect(cx - 1, y - 5, 2, 14)
  ctx.fillStyle = C.dim
  ctx.font = `600 10px "Hiragino Sans", system-ui, sans-serif`
  ctx.fillText('はやい', cx - w / 2 + 16, y + 18)
  ctx.fillText('おそい', cx + w / 2 - 16, y + 18)
  offsets.forEach((o, idx) => {
    const px = cx + clamp(o / WIN, -1, 1) * (w / 2)
    const a = 0.3 + 0.7 * ((idx + 1) / offsets.length)
    ctx.fillStyle = hexA(Math.abs(o) < 0.05 ? C.amber : o < 0 ? C.cyan : C.magenta, a)
    ctx.beginPath()
    ctx.arc(px, y + 2, 4, 0, 7)
    ctx.fill()
  })
  ctx.restore()
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
  ctx.fillText('No.02', 16, H - 14 - safeBottom())
  ctx.restore()

  if (state === 'play') {
    drawHUD()
    drawTimingMeter()
    drawJudge()
  }
  if (state === 'calib') drawCalib()
  if (state === 'calibdone') drawCalibDone()
  if (state === 'title') {
    drawHowToCard(ctx, W, H, {
      title: 'きいて、かえして。',
      lines: ['DJのお手本を、同じリズムで返す。', '合図のあと「せーの」で構えてタップ。', '決めるほど客が増えて盛り上がる。'],
      start: 'タップでスタート',
      footer: `best ${best}`,
      accent: C.cyan,
      ink: C.ink,
      muted: C.dim,
      panel: 'rgba(255,255,255,0.06)',
      border: 'rgba(255,255,255,0.16)',
      glow: true,
      t: elapsed,
    })
    neonText('♪ 音ズレ調整（イヤホンはこちら）', W / 2, recalY(), 14, C.cyan)
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
  offsets = [-0.05, 0.04, 0.0, -0.02, 0.06]
  judgeText = 'ジャスト'
  judgeColor = C.amber
  judgeLife = 0.7
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
    if (W > 0) shot === 'calib' ? setupShotCalib() : setupShot()
    else return requestAnimationFrame(wait)
  }
  requestAnimationFrame(wait)
} else {
  enterTransition()
  const back = document.querySelector('a.back') as HTMLAnchorElement | null
  if (back) wireLink(back)
  // 共通ミュート：ボタン設置＋トグルで master gain を切替（音楽を聴きながら遊ぶ用）
  mountMuteButton()
  onMuteChange((m) => {
    if (master) master.gain.value = m ? 0 : 0.9
    // ミュート時は 'ambient' へ（Apple Music 等の再生を止めない）。解除で 'playback' に戻す
    try {
      const ns: any = navigator
      if (ns.audioSession) ns.audioSession.type = m ? 'ambient' : 'playback'
    } catch {}
  })
}
requestAnimationFrame(frame)
