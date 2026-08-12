// WebAudio 自前合成のSE/BGM。素材ファイル不要（ライセンス問題なし・ロードゼロ）。
// 連鎖ピッチ上昇は RM 解剖の核仕様（RESEARCH §5）。

let ctx: AudioContext | null = null
let master: GainNode | null = null
let muted = localStorage.getItem('yacho-mute') === '1'

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext()
      master = ctx.createGain()
      master.gain.value = muted ? 0 : 0.5
      master.connect(ctx.destination)
    } catch {
      return null
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function toggleMute(): boolean {
  muted = !muted
  localStorage.setItem('yacho-mute', muted ? '1' : '0')
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.02)
  return muted
}
export function isMuted(): boolean {
  return muted
}

/** 単音（正弦/三角波）。glide で終端周波数へ滑る */
function tone(freq: number, dur: number, opts: { type?: OscillatorType; gain?: number; glide?: number; delay?: number } = {}) {
  const c = ac()
  if (!c || !master) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const o = c.createOscillator()
  const g = c.createGain()
  o.type = opts.type ?? 'sine'
  o.frequency.setValueAtTime(freq, t0)
  if (opts.glide) o.frequency.exponentialRampToValueAtTime(Math.max(30, opts.glide), t0 + dur)
  g.gain.setValueAtTime(0.0001, t0)
  g.gain.exponentialRampToValueAtTime(opts.gain ?? 0.2, t0 + 0.01)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  o.connect(g).connect(master)
  o.start(t0)
  o.stop(t0 + dur + 0.05)
}

/** ノイズバースト（打撃・破壊） */
function thud(dur: number, opts: { gain?: number; low?: number; delay?: number } = {}) {
  const c = ac()
  if (!c || !master) return
  const t0 = c.currentTime + (opts.delay ?? 0)
  const len = Math.floor(c.sampleRate * dur)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'lowpass'
  f.frequency.value = opts.low ?? 900
  const g = c.createGain()
  g.gain.value = opts.gain ?? 0.3
  src.connect(f).connect(g).connect(master)
  src.start(t0)
}

// ---- ゲームSE ----
const PENTA = [0, 2, 4, 7, 9] // メジャーペンタ（連鎖の上昇に使う）
const semitone = (base: number, n: number) => base * Math.pow(2, n / 12)

export const sfx = {
  swap() {
    tone(520, 0.06, { type: 'triangle', gain: 0.12 })
  },
  illegal() {
    tone(220, 0.09, { type: 'triangle', gain: 0.1, glide: 180 })
  },
  /** 消滅ポップ：連鎖ごとにペンタトニックで上がる（RM文法） */
  pop(chain: number, delay = 0) {
    const step = PENTA[Math.min(chain - 1, PENTA.length - 1)] + Math.floor((chain - 1) / PENTA.length) * 12
    tone(semitone(660, step), 0.14, { type: 'triangle', gain: 0.18, delay })
    tone(semitone(1320, step), 0.1, { gain: 0.06, delay })
  },
  block(delay = 0) {
    thud(0.14, { gain: 0.28, low: 700, delay })
  },
  born(delay = 0) {
    tone(880, 0.12, { gain: 0.14, delay })
    tone(1320, 0.16, { gain: 0.1, delay: delay + 0.06 })
  },
  fire(kind: string, delay = 0) {
    if (kind === 'harpoon') {
      tone(300, 0.22, { type: 'sawtooth', gain: 0.1, glide: 1400, delay })
    } else if (kind === 'hitsubo') {
      thud(0.3, { gain: 0.4, low: 400, delay })
      tone(90, 0.28, { type: 'sine', gain: 0.25, glide: 45, delay })
    } else if (kind === 'seiju') {
      for (let i = 0; i < 5; i++) tone(semitone(880, PENTA[i]), 0.14, { gain: 0.1, delay: delay + i * 0.05 })
    } else {
      tone(740, 0.1, { type: 'triangle', gain: 0.12, delay })
    }
  },
  drain(i: number, delay = 0) {
    tone(semitone(980, i % 12), 0.05, { type: 'square', gain: 0.05, delay })
  },
  spore(delay = 0) {
    tone(1560, 0.2, { gain: 0.12, delay })
    tone(2080, 0.24, { gain: 0.07, delay: delay + 0.08 })
  },
  star(i: number) {
    tone(semitone(1040, [0, 4, 7][i] ?? 0), 0.3, { gain: 0.2 })
  },
  fanfare() {
    const seq = [0, 4, 7, 12]
    seq.forEach((s, i) => {
      tone(semitone(523, s), 0.28, { type: 'triangle', gain: 0.16, delay: i * 0.11 })
      tone(semitone(1046, s), 0.2, { gain: 0.07, delay: i * 0.11 })
    })
  },
  lose() {
    tone(392, 0.3, { type: 'triangle', gain: 0.12 })
    tone(311, 0.4, { type: 'triangle', gain: 0.12, delay: 0.18 })
  },
}

// ---- 生成アンビエントBGM（層ごとの調性） ----
let bgmTimer: number | null = null

const THEME_NOTES: Record<string, number[]> = {
  forest: [220, 277, 330, 415, 494], // Aメジャー系の暖かさ
  machine: [196, 233, 294, 349, 392], // ドリアン寄りの陰り
  crystal: [233, 294, 370, 440, 554], // リディアン寄りの煌めき
}

export function startBgm(theme: string) {
  stopBgm()
  const notes = THEME_NOTES[theme] ?? THEME_NOTES.forest
  const step = () => {
    // 低いパッド＋まれに鈴。音量は控えめ
    const n = notes[Math.floor(Math.random() * notes.length)]
    tone(n / 2, 3.2, { type: 'sine', gain: 0.045 })
    tone(n / 2 * 1.5, 3.2, { type: 'sine', gain: 0.03 })
    if (Math.random() < 0.4) tone(n * 2, 1.2, { gain: 0.05, delay: 0.8 + Math.random() })
    bgmTimer = window.setTimeout(step, 2600 + Math.random() * 1200)
  }
  step()
}

export function stopBgm() {
  if (bgmTimer !== null) {
    clearTimeout(bgmTimer)
    bgmTimer = null
  }
}
