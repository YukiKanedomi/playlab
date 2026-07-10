// games/monkiri/sound.ts — 紋切りの音（WebAudio合成・ファイル不使用）
import { isMuted, configureMixedSession } from '../../shared/audio'

let _ctx: AudioContext | null = null
let _master: GainNode | null = null
let _chimeTimer: ReturnType<typeof setTimeout> | null = null
let _chimeActive = false

export function ensureAudio(): AudioContext | null {
  if (!_ctx) {
    try {
      _ctx = new (window.AudioContext || (window as any).webkitAudioContext)()
      configureMixedSession()
      _master = _ctx.createGain()
      _master.gain.value = 0.5
      _master.connect(_ctx.destination)
    } catch {
      return null
    }
  }
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {})
  return _ctx
}

function mkNoise(ac: AudioContext, dur: number): AudioBufferSourceNode {
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  const src = ac.createBufferSource()
  src.buffer = buf
  return src
}

/** 鋏音。pitchVar ±1 でピッチ揺らぎ */
export function snip(pitchVar = 0): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  const src = mkNoise(ac, 0.035)
  const bp = ac.createBiquadFilter()
  bp.type = 'bandpass'
  bp.frequency.value = 3300 * (1 + pitchVar * 0.15)
  bp.Q.value = 8
  const env = ac.createGain()
  env.gain.setValueAtTime(0, now)
  env.gain.linearRampToValueAtTime(0.25, now + 0.002)
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.032)
  src.connect(bp); bp.connect(env); env.connect(_master)
  src.start(now); src.stop(now + 0.035)
}

/** 紙片落下音 */
export function flutter(): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  const src = mkNoise(ac, 0.22)
  const lp = ac.createBiquadFilter()
  lp.type = 'lowpass'
  lp.frequency.setValueAtTime(1800, now)
  lp.frequency.exponentialRampToValueAtTime(500, now + 0.22)
  const env = ac.createGain()
  env.gain.setValueAtTime(0.12, now)
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.22)
  src.connect(lp); lp.connect(env); env.connect(_master)
  src.start(now); src.stop(now + 0.22)
}

/** 開き1枚ごとのtick音 */
export function unfoldTick(i: number, total: number): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  // noise tick
  const ns = mkNoise(ac, 0.025)
  const nenv = ac.createGain()
  nenv.gain.setValueAtTime(0.08, now)
  nenv.gain.exponentialRampToValueAtTime(0.001, now + 0.025)
  ns.connect(nenv); nenv.connect(_master)
  ns.start(now); ns.stop(now + 0.025)
  // triangle tone
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = 380 * (1 + (i / Math.max(1, total)) * 0.8)
  const tenv = ac.createGain()
  tenv.gain.setValueAtTime(0.15, now)
  tenv.gain.exponentialRampToValueAtTime(0.001, now + 0.06)
  osc.connect(tenv); tenv.connect(_master)
  osc.start(now); osc.stop(now + 0.06)
}

/** 開き切り音 */
export function reveal(): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  for (const freq of [523, 659, 784]) {
    const osc = ac.createOscillator()
    osc.type = 'triangle'
    osc.frequency.value = freq
    const env = ac.createGain()
    env.gain.setValueAtTime(0.12, now)
    env.gain.exponentialRampToValueAtTime(0.001, now + 0.5)
    osc.connect(env); env.connect(_master)
    osc.start(now); osc.stop(now + 0.5)
  }
  const ns = mkNoise(ac, 0.3)
  const hp = ac.createBiquadFilter()
  hp.type = 'highpass'
  hp.frequency.value = 4000
  const nenv = ac.createGain()
  nenv.gain.setValueAtTime(0.08, now)
  nenv.gain.exponentialRampToValueAtTime(0.001, now + 0.3)
  ns.connect(hp); hp.connect(nenv); nenv.connect(_master)
  ns.start(now); ns.stop(now + 0.3)
}

/** 判子ドン音 */
export function stampThunk(): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  const osc = ac.createOscillator()
  osc.type = 'sine'
  osc.frequency.value = 85
  const env = ac.createGain()
  env.gain.setValueAtTime(0.5, now)
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.18)
  osc.connect(env); env.connect(_master)
  osc.start(now); osc.stop(now + 0.18)
  const ns = mkNoise(ac, 0.015)
  const cenv = ac.createGain()
  cenv.gain.setValueAtTime(0.3, now)
  cenv.gain.exponentialRampToValueAtTime(0.001, now + 0.015)
  ns.connect(cenv); cenv.connect(_master)
  ns.start(now); ns.stop(now + 0.015)
}

/** UIタップ音（木の音） */
export function tick(): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  const osc = ac.createOscillator()
  osc.type = 'triangle'
  osc.frequency.value = 880
  const env = ac.createGain()
  env.gain.setValueAtTime(0.1, now)
  env.gain.exponentialRampToValueAtTime(0.001, now + 0.018)
  osc.connect(env); env.connect(_master)
  osc.start(now); osc.stop(now + 0.018)
}

/** 風鈴（切り画面中のみ。25〜40秒ランダム間隔） */
export function startWindchime(): void {
  if (_chimeActive) return
  _chimeActive = true
  scheduleChime()
}

export function stopWindchime(): void {
  _chimeActive = false
  if (_chimeTimer !== null) { clearTimeout(_chimeTimer); _chimeTimer = null }
}

function scheduleChime(): void {
  if (!_chimeActive) return
  const delay = (25 + Math.random() * 15) * 1000
  _chimeTimer = setTimeout(() => {
    if (!_chimeActive) return
    playChime()
    scheduleChime()
  }, delay)
}

function playChime(): void {
  if (isMuted()) return
  const ac = ensureAudio()
  if (!ac || !_master) return
  const now = ac.currentTime
  for (const freq of [1319, 2637]) {
    const osc = ac.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq
    const env = ac.createGain()
    env.gain.setValueAtTime(0.04, now)
    env.gain.exponentialRampToValueAtTime(0.001, now + 2.5)
    osc.connect(env); env.connect(_master)
    osc.start(now); osc.stop(now + 2.5)
  }
}
