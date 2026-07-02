// 『墨戯絵巻』 — かいて、はらう。 筆捌きタワーディフェンス（Playlab No.08）
// 指＝筆。描いた線の形（斬り/壁/丸/点/渦）を幾何で判定し、墨ゲージの経済で戦略を作る。
// 大神の筆メカニクスに学ぶ習作。絵は鳥獣戯画の画風に学んだ自作筆線（gika.ts）。
import { attachPointer, fitCanvas } from '../../shared/input'
import { Particles, makeShake, clamp, lerp } from '../../shared/juice'
import { enterTransition, wireLink } from '../../shared/transition'
import { isMuted, mountMuteButton, configureMixedSession } from '../../shared/audio'
import * as tune from '../../shared/tune'
import { isPanelOpen } from '../../shared/tune'
import { SUMI, dot, drawFrog, drawRabbit, drawMonkey, drawBoar, drawBird, drawFox, drawNamazu } from './gika'
import { makePaper, makeLandscape, Splats } from './sumi'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
const ptrh = attachPointer(canvas)
const ptr = ptrh.pointer
document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
mountMuteButton()
enterTransition()

const Q = new URLSearchParams(location.search)
const SHOT = Q.get('shot')

// ── 調整パネル ──
const P = tune.panel(
  'fude',
  {
    INK_MAX: { v: 100, min: 60, max: 200, step: 5, group: '墨', label: '墨の最大量' },
    INK_REGEN: { v: 8, min: 2, max: 20, step: 0.5, group: '墨', label: '回復/秒' },
    COST100: { v: 7, min: 2, max: 20, step: 0.5, group: '墨', label: '100px描くコスト' },
    SLASH_DMG: { v: 9, min: 2, max: 30, step: 1, group: '筆', label: '斬りの威力' },
    CIRCLE_DMG: { v: 14, min: 4, max: 40, step: 1, group: '筆', label: '丸の威力' },
    DOT_DMG: { v: 5, min: 1, max: 20, step: 1, group: '筆', label: '点の威力' },
    WALL_HP: { v: 40, min: 10, max: 120, step: 5, group: '筆', label: '壁の耐久' },
    SLOWMO: { v: 0.35, min: 0.1, max: 1, step: 0.05, group: '手触り', label: '描画中スロー', desc: '筆を走らせている間の時間の速さ。1で等速' },
    HP_MUL: { v: 1, min: 0.5, max: 3, step: 0.1, group: '敵', label: '敵体力倍率' },
    SPD_MUL: { v: 1, min: 0.5, max: 2, step: 0.1, group: '敵', label: '敵速度倍率' },
  },
  { version: 1 },
)

// ── 画面・小道 ──
let W = 390
let H = 700
let path: { x: number; y: number }[] = [] // 6px刻みサンプル
let totalLen = 0
let sealX = 0
let sealY = 0

function buildPath() {
  const cps = [
    { x: W * 0.5, y: -30 },
    { x: W * 0.8, y: H * 0.15 },
    { x: W * 0.22, y: H * 0.32 },
    { x: W * 0.76, y: H * 0.5 },
    { x: W * 0.26, y: H * 0.66 },
    { x: W * 0.5, y: H * 0.8 },
  ]
  // Catmull-Rom を 6px 刻みへ
  const pts: { x: number; y: number }[] = []
  const cr = (p0: any, p1: any, p2: any, p3: any, t: number) => {
    const t2 = t * t
    const t3 = t2 * t
    return {
      x: 0.5 * (2 * p1.x + (-p0.x + p2.x) * t + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
      y: 0.5 * (2 * p1.y + (-p0.y + p2.y) * t + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
    }
  }
  for (let i = 0; i < cps.length - 1; i++) {
    const p0 = cps[Math.max(0, i - 1)]
    const p3 = cps[Math.min(cps.length - 1, i + 2)]
    for (let t = 0; t < 1; t += 0.02) pts.push(cr(p0, cps[i], cps[i + 1], p3, t))
  }
  path = [pts[0]]
  totalLen = 0
  for (const p of pts) {
    const l = path[path.length - 1]
    const d = Math.hypot(p.x - l.x, p.y - l.y)
    if (d >= 6) {
      path.push(p)
      totalLen += d
    }
  }
  sealX = W * 0.5
  sealY = H * 0.8 + 34
}
const pathAt = (prog: number) => path[clamp(Math.floor(prog / 6), 0, path.length - 1)]

// ── オフスクリーンキャッシュ（紙・山水） ──
let paperCache: HTMLCanvasElement | null = null
let landscapeCache: HTMLCanvasElement | null = null
let landscachedMaki = -1
let titleLandscapeCache: HTMLCanvasElement | null = null

fitCanvas(canvas, (w, h) => {
  W = w
  H = h
  buildPath()
  // リサイズ時にキャッシュを破棄（次のフレームで再生成）
  paperCache = null
  landscapeCache = null
  landscachedMaki = -1
  titleLandscapeCache = null
})
if (SHOT) {
  const w = Number(Q.get('w') || 390)
  const h = Number(Q.get('h') || 844)
  canvas.style.width = w + 'px'
  canvas.style.height = h + 'px'
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
}

// ── 効果音（合成・和風） ──
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
function noise(dur: number, freq: number, q: number, gain: number, type: BiquadFilterType = 'bandpass') {
  if (!actx || !master || isMuted()) return
  const t = actx.currentTime
  const len = Math.ceil(actx.sampleRate * dur)
  const buf = actx.createBuffer(1, len, actx.sampleRate)
  const d = buf.getChannelData(0)
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
function pluck(freq: number, gain = 0.16) {
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
const PENTA = [220, 262, 294, 330, 392, 440, 524]
const SFX = {
  brushTick(spd: number) { noise(0.05, 1400 + spd * 3, 1.2, clamp(spd * 0.0007, 0.01, 0.05), 'highpass') },
  slash() { noise(0.12, 2400, 2, 0.14, 'highpass'); pluck(PENTA[4], 0.1) },
  wall() { noise(0.1, 500, 2, 0.1); pluck(PENTA[1], 0.09) },
  circle() { noise(0.2, 900, 1.5, 0.12); pluck(PENTA[2], 0.12); pluck(PENTA[5], 0.1) },
  dotHit() { noise(0.06, 1800, 2, 0.08) },
  wind() { noise(0.5, 700, 0.8, 0.14) },
  kill(i: number) { pluck(PENTA[clamp(i, 0, 6)], 0.16) },
  chew() { noise(0.05, 900, 3, 0.04) },
  smudge() { noise(0.35, 220, 1, 0.3, 'lowpass'); pluck(110, 0.2) },
  stamp() { noise(0.15, 300, 1.5, 0.25, 'lowpass'); pluck(PENTA[0], 0.2) },
  quake() { noise(0.9, 120, 0.8, 0.35, 'lowpass') },
  drop() { pluck(PENTA[6], 0.07) },
}


function getPaper(): HTMLCanvasElement {
  if (!paperCache) paperCache = makePaper(W, H)
  return paperCache
}
function getLandscape(): HTMLCanvasElement {
  if (!landscapeCache || landscachedMaki !== makiIdx) {
    landscapeCache = makeLandscape(W, H, makiIdx)
    landscachedMaki = makiIdx
  }
  return landscapeCache
}

// 飛沫・染み
const splats = new Splats()

// 被弾ビネット
let vignetteT = 0 // 0.9秒でフェード

// ── 型 ──
type EType = 'frog' | 'rabbit' | 'monkey' | 'boar' | 'bird' | 'fox' | 'namazu'
type Enemy = {
  type: EType
  prog: number
  x: number
  y: number
  hp: number
  maxHp: number
  t: number
  scale: number
  dir: number
  air: number // 兎の跳躍・蛙のホップ位相
  charge: number // 猪
  flip: number // 猪ひっくり返り
  stun: number
  ghost: boolean // 狐の幻
  carry: boolean // 猿
  quakeT: number // 鯰
  tired: number // 鯰
  dead: boolean
}
type StrokePt = { x: number; y: number; w: number; spd: number }
type Stroke = { pts: StrokePt[]; hp: number; maxHp: number; kind: 'wall' | 'residue' }
type Drop = { x: number; y: number; t: number; value: number; state: 'ground' | 'fly' | 'stolen' }
type Popup = { x: number; y: number; text: string; t: number; big: boolean }
type Note = { text: string; t: number }

const DEF: Record<EType, { hp: number; spd: number; scale: number; value: number }> = {
  frog: { hp: 10, spd: 34, scale: 0.9, value: 3 },
  rabbit: { hp: 8, spd: 58, scale: 0.9, value: 4 },
  monkey: { hp: 13, spd: 46, scale: 1, value: 5 },
  boar: { hp: 34, spd: 26, scale: 1.15, value: 8 },
  bird: { hp: 6, spd: 52, scale: 0.9, value: 4 },
  fox: { hp: 15, spd: 42, scale: 1, value: 6 },
  namazu: { hp: 240, spd: 13, scale: 1.9, value: 30 },
}
const NOTES: Record<EType, string> = {
  frog: '蛙。まっすぐ線を引けば、斬れる',
  rabbit: '兎は壁を跳びこえる。宙にいる時を斬れ',
  monkey: '猿は墨玉を盗んで逃げる。逃すな',
  boar: '猪の鎧に刃は通らぬ。丸で囲んでひっくり返せ',
  bird: '鳥は壁の上を飛ぶ。点か斬りで落とせ',
  fox: '狐は幻を連れてくる。丸で囲めば幻は消える',
  namazu: '主・鯰。地揺れがすべての壁を割る',
}

// ── 画技（ローグライク層） ──
const GAKI: { id: string; name: string; kanji: string; desc: string }[] = [
  { id: 'noboku',     name: '濃墨',     kanji: '濃', desc: '斬りの威力+40%。ただし墨の消費+15%' },
  { id: 'tanboku',   name: '淡墨',     kanji: '淡', desc: '筆の墨消費が2割減る' },
  { id: 'kaeshi',    name: '返し墨',   kanji: '返', desc: '斬りのあとに残る墨壁の耐久が2倍' },
  { id: 'shibuki',   name: '飛沫',     kanji: '沫', desc: '獣を払うと周囲に墨が飛び散り追撃する' },
  { id: 'shingan',   name: '心眼',     kanji: '眼', desc: '筆を走らせる間、時がさらにゆっくりになる' },
  { id: 'hayase',    name: '早瀬',     kanji: '瀬', desc: '墨の回復が35%はやくなる' },
  { id: 'shugo',     name: '朱護',     kanji: '護', desc: '汚れた印をひとつ、その場で清める' },
  { id: 'daien',     name: '大円',     kanji: '円', desc: '丸の破裂の威力+50%' },
  { id: 'fuujin',    name: '風神',     kanji: '風', desc: '渦の風が強くなり、押し戻しと気絶が延びる' },
  { id: 'sumidamari',name: '墨溜まり', kanji: '溜', desc: '墨の最大量+30' },
]
let taken: Record<string, number> = {}

// 効果値ヘルパー
function effInkMax() { return P.INK_MAX + 30 * (taken.sumidamari || 0) }
function effSlashDmg() { return P.SLASH_DMG * (1 + 0.4 * (taken.noboku || 0)) }
function effCircleDmg() { return P.CIRCLE_DMG * (1 + 0.5 * (taken.daien || 0)) }
function effInkRegen() { return P.INK_REGEN * (1 + 0.35 * (taken.hayase || 0)) }
function effSlowmo() { return clamp(P.SLOWMO * Math.pow(0.7, taken.shingan || 0), 0.10, 1) }
function effStrokeCost(len: number) {
  const base = (len * P.COST100) / 100
  const nob = 1 + 0.15 * (taken.noboku || 0)
  const tan = Math.pow(0.8, taken.tanboku || 0)
  return base * nob * tan
}
function effWallHpMul() { return Math.pow(2, taken.kaeshi || 0) }
function effFuujinPush() { return 95 * (1 + 0.8 * (taken.fuujin || 0)) }
function effFuujinStun() { return 0.8 + 0.5 * (taken.fuujin || 0) }

// ドラフト状態
let draftCards: typeof GAKI = []
let draftPendingNextWave = false // ドラフト後に nextWave を呼ぶフラグ

// ── 状態 ──
type Mode = 'title' | 'play' | 'over' | 'draft'
let mode: Mode = 'title'
let ink = 100
let seal = 3
let makiIdx = 0
let waveIdx = 0
let waveNum = 0 // 通し波数（エンドレス係数）
let banner = { text: '', sub: '', t: 0 }
let stampT = 0
let enemies: Enemy[] = []
let strokes: Stroke[] = []
let drops: Drop[] = []
let popups: Popup[] = []
let notes: Note[] = []
let seen = new Set<EType>()
let spawnQ: { delay: number; type: EType }[] = []
let waveDone = false
let hitstop = 0
let best = Number(localStorage.getItem('playlab.fude.best') || 0)
const parts = new Particles()
const shake = makeShake(18)

// 円割り演出
let burstFx: { pts: { x: number; y: number }[]; t: number } | null = null

// ── 巻の構成 ──
type WaveEntry = [EType, number, number] // 種・数・間隔ms
const MAKI: { name: string; waves: WaveEntry[][] }[] = [
  {
    name: '巻之一「蛙合戦」',
    waves: [
      [['frog', 6, 1000]],
      [['frog', 6, 850], ['rabbit', 3, 1600]],
      [['frog', 8, 700], ['rabbit', 5, 1200]],
    ],
  },
  {
    name: '巻之二「山の獣」',
    waves: [
      [['frog', 6, 850], ['monkey', 2, 4200]],
      [['boar', 2, 5200], ['frog', 8, 750]],
      [['boar', 3, 4400], ['rabbit', 5, 1050], ['monkey', 3, 3800]],
    ],
  },
  {
    name: '巻之三「空と幻」',
    waves: [
      [['bird', 6, 1500], ['frog', 6, 950]],
      [['fox', 3, 4000], ['rabbit', 5, 1050]],
      [['bird', 7, 1250], ['fox', 3, 3800], ['boar', 2, 6200]],
    ],
  },
]

function queueWave(entries: WaveEntry[]) {
  spawnQ = []
  for (const [type, count, iv] of entries)
    for (let i = 0; i < count; i++) spawnQ.push({ delay: 0.6 + (i * iv) / 1000 + Math.random() * 0.25, type })
  waveDone = false
}
function endlessWave(n: number) {
  const budget = 22 + n * 7
  const pool: [EType, number][] = [['frog', 3], ['rabbit', 4], ['monkey', 5], ['boar', 8], ['bird', 4], ['fox', 6]]
  const entries: WaveEntry[] = []
  let spent = 0
  while (spent < budget) {
    const [t, c] = pool[Math.floor(Math.random() * pool.length)]
    entries.push([t, 1, 0])
    spent += c
  }
  spawnQ = entries.map((e, i) => ({ delay: 0.6 + i * (2.6 - clamp(n * 0.08, 0, 1.6)) * (0.55 + Math.random() * 0.5), type: e[0] }))
  if (n % 5 === 0) spawnQ.push({ delay: 2, type: 'namazu' })
  waveDone = false
}

function spawn(type: EType) {
  const d = DEF[type]
  const hpMul = P.HP_MUL * (makiIdx >= MAKI.length ? 1 + (waveNum - 9) * 0.07 : 1)
  const e: Enemy = {
    type, prog: 0, x: 0, y: -30, hp: d.hp * hpMul, maxHp: d.hp * hpMul, t: Math.random() * 10,
    scale: d.scale, dir: 1, air: 0, charge: 0, flip: 0, stun: 0, ghost: false, carry: false,
    quakeT: 6, tired: 0, dead: false,
  }
  if (type === 'bird') e.x = W * (0.2 + Math.random() * 0.6)
  enemies.push(e)
  if (type === 'fox') {
    for (const off of [-30, 30]) {
      const g = { ...e, hp: 1, maxHp: 1, ghost: true, prog: Math.max(0, off), t: Math.random() * 10 }
      enemies.push(g)
    }
  }
  if (!seen.has(type)) {
    seen.add(type)
    if (!notes.some((n) => n.text === NOTES[type])) notes.push({ text: NOTES[type], t: 4.6 })
  }
}

function startGame() {
  mode = 'play'
  ink = effInkMax()
  seal = 3
  makiIdx = 0
  waveIdx = 0
  waveNum = 0
  taken = {}
  enemies = []
  strokes = []
  drops = []
  popups = []
  notes = []
  seen = new Set()
  vignetteT = 0
  draftPendingNextWave = false
  // 景色キャッシュをリセット（新しいゲームではmaki=0に戻る）
  landscapeCache = null
  landscachedMaki = -1
  nextWave()
}
function nextWave() {
  waveNum++
  if (makiIdx < MAKI.length) {
    const m = MAKI[makiIdx]
    if (waveIdx === 0) {
      banner = { text: m.name, sub: '', t: 2.2 }
      ink = P.INK_MAX
    } else banner = { text: '其の' + '一二三'[waveIdx], sub: '', t: 1.4 }
    queueWave(m.waves[waveIdx])
  } else {
    banner = { text: makiIdx === MAKI.length && waveIdx === 0 ? '巻之外「百鬼繚乱」' : '第' + (waveNum - 9) + '波', sub: '', t: 1.6 }
    endlessWave(waveNum - 9)
  }
}
function waveCleared() {
  waveIdx++
  stampT = 1
  SFX.stamp()
  shake.add(6)

  let makiAdvanced = false
  if (makiIdx < MAKI.length && waveIdx >= MAKI[makiIdx].waves.length) {
    makiIdx++
    waveIdx = 0
    if (seal < 3) seal++
    ink = effInkMax()
    makiAdvanced = true
    // 景色キャッシュを無効化（maki が進んだ）
    landscapeCache = null
    landscachedMaki = -1
  }

  // ドラフト発生判定
  const inEndless = makiIdx >= MAKI.length
  const endlessWaveNum = waveNum - 9
  const triggerDraft = makiAdvanced || (inEndless && endlessWaveNum > 0 && (endlessWaveNum % 3 === 0))

  if (triggerDraft) {
    // ドラフトモード突入（setTimeout での nextWave を抑止）
    draftPendingNextWave = true
    setTimeout(() => {
      if (mode === 'play' && draftPendingNextWave) {
        // ドラフトに切り替え
        openDraft()
      }
    }, 1100)
  } else {
    setTimeout(() => { if (mode === 'play') nextWave() }, 1100)
  }

  waveDone = true // 二重進行ガード
}

function openDraft() {
  // 候補3枚をランダム抽選（重複なし、shugoは seal>=3 なら除外）
  const pool = GAKI.filter((g) => !(g.id === 'shugo' && seal >= 3))
  const shuffled = pool.slice().sort(() => Math.random() - 0.5)
  draftCards = shuffled.slice(0, 3)
  mode = 'draft'
}

function pickDraft(idx: number) {
  if (idx < 0 || idx >= draftCards.length) return
  const g = draftCards[idx]
  taken[g.id] = (taken[g.id] || 0) + 1
  // shugo: 即座に印を清める
  if (g.id === 'shugo') seal = Math.min(3, seal + 1)
  SFX.stamp()
  draftPendingNextWave = false
  mode = 'play'
  nextWave()
}
function gameOver() {
  mode = 'over'
  if (waveNum > best) {
    best = waveNum
    localStorage.setItem('playlab.fude.best', String(best))
  }
}

// ── 幾何 ──
function segCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  const t = clamp(((cx - ax) * dx + (cy - ay) * dy) / len2, 0, 1)
  const px = ax + dx * t
  const py = ay + dy * t
  return Math.hypot(cx - px, cy - py) <= r
}
function polyContains(poly: { x: number; y: number }[], x: number, y: number) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// ── 筆（ジェスチャー） ──
let drawing = false
let curPts: StrokePt[] = []
let curLen = 0
let lastBrushSfx = 0

function strokeCost(len: number) { return effStrokeCost(len) }

function classifyAndFire() {
  const pts = curPts
  if (pts.length < 2) {
    fireDot(ptr.x, ptr.y)
    return
  }
  const L = curLen
  const a = pts[0]
  const b = pts[pts.length - 1]
  const D = Math.hypot(b.x - a.x, b.y - a.y)
  // 累積回転角（渦判定）
  let turn = 0
  for (let i = 2; i < pts.length; i++) {
    const a1 = Math.atan2(pts[i - 1].y - pts[i - 2].y, pts[i - 1].x - pts[i - 2].x)
    const a2 = Math.atan2(pts[i].y - pts[i - 1].y, pts[i].x - pts[i - 1].x)
    let d = a2 - a1
    while (d > Math.PI) d -= Math.PI * 2
    while (d < -Math.PI) d += Math.PI * 2
    turn += d
  }
  // 弦からの最大逸れ（直線判定）
  let dev = 0
  for (const p of pts) {
    const cross = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / (D || 1)
    dev = Math.max(dev, cross)
  }
  if (L < 26) fireDot(b.x, b.y)
  else if (Math.abs(turn) > Math.PI * 3.2) fireSpiral(pts)
  else if (D < Math.max(34, L * 0.28) && L > 90) fireCircle(pts)
  else if (dev / L < 0.13) fireSlash(pts)
  else fireWall(pts, 0.7) // ぐにゃ線＝弱い壁
}

function hitEnemy(e: Enemy, dmg: number, kind: 'slash' | 'circle' | 'dot', fromShibuki = false) {
  let mul = 1
  if (e.type === 'boar' && e.flip <= 0 && kind !== 'circle') mul = 0.25
  if (e.type === 'boar' && e.flip > 0) mul = 2
  if (e.type === 'namazu' && e.tired > 0) mul = 2
  e.hp -= dmg * mul
  parts.burst(e.x, e.y - 8, 7, 'rgba(47,42,38,0.8)', 130, 60)
  if (e.hp <= 0 && !e.dead) {
    e.dead = true
    if (!e.ghost) {
      drops.push({ x: e.x, y: e.y, t: 0, value: DEF[e.type].value, state: 'ground' })
      if (e.carry) drops.push({ x: e.x, y: e.y - 8, t: 0, value: 5, state: 'ground' })
    }
    parts.burst(e.x, e.y - 8, 14, 'rgba(47,42,38,0.85)', 190, 80)
    // 墨飛沫の討伐エフェクト
    splats.burst(e.x, e.y - 8, Math.atan2(-1, (Math.random() - 0.5) * 2))
    // 飛沫（shibuki）画技：近くの他の敵にダメージ
    if (!fromShibuki && (taken.shibuki || 0) > 0) {
      const shibukiDmg = 4 * (taken.shibuki || 0)
      for (const other of enemies) {
        if (other === e || other.dead) continue
        if (Math.hypot(other.x - e.x, other.y - e.y) < 60) {
          hitEnemy(other, shibukiDmg, 'dot', true)
        }
      }
    }
    return true
  }
  return false
}

function comboPopup(kills: number, x: number, y: number) {
  if (kills < 2) return
  const words = ['', '', '一刀両断', '三獣一筆', '四獣掃討', '百鬼一閃']
  popups.push({ x, y, text: words[clamp(kills, 2, 5)], t: 1.6, big: true })
  ink = clamp(ink + kills * 2, 0, effInkMax())
  hitstop = 0.09
  shake.add(5)
}

function fireSlash(pts: StrokePt[]) {
  let kills = 0
  let cx = 0
  let cy = 0
  let hits = 0
  for (const e of enemies) {
    if (e.dead) continue
    const r = 16 * e.scale
    let hit = false
    for (let i = 1; i < pts.length && !hit; i += 2)
      if (segCircle(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, e.x, e.y - 8, r)) hit = true
    if (hit) {
      hits++
      cx += e.x
      cy += e.y
      if (hitEnemy(e, effSlashDmg(), 'slash')) {
        kills++
        SFX.kill(kills)
      }
    }
  }
  SFX.slash()
  if (kills >= 2) comboPopup(kills, cx / hits, cy / hits - 30)
  // 残り墨は薄壁として残る（返し墨で耐久2倍）
  addStroke(pts, 0.4 * effWallHpMul(), 'residue')
}
function fireWall(pts: StrokePt[], mul = 1) {
  addStroke(pts, mul, 'wall')
  SFX.wall()
}
function addStroke(pts: StrokePt[], hpMul: number, kind: 'wall' | 'residue') {
  strokes.push({ pts, hp: P.WALL_HP * hpMul, maxHp: P.WALL_HP * hpMul, kind })
  if (strokes.length > 9) strokes.shift()
}
function fireCircle(pts: { x: number; y: number; w: number }[]) {
  let kills = 0
  let cx = 0
  let cy = 0
  let n = 0
  for (const p of pts) { cx += p.x; cy += p.y; n++ }
  cx /= n
  cy /= n
  for (const e of enemies) {
    if (e.dead) continue
    if (!polyContains(pts, e.x, e.y - 8)) continue
    if (e.type === 'boar' && e.flip <= 0) {
      e.flip = 2.6
      e.stun = 2.6
      popups.push({ x: e.x, y: e.y - 30, text: '転', t: 1, big: false })
    }
    if (e.ghost) { e.hp = 0; e.dead = true; parts.burst(e.x, e.y - 8, 10, 'rgba(47,42,38,0.5)', 150, 30); continue }
    if (e.carry) { e.carry = false; drops.push({ x: e.x, y: e.y, t: 0, value: 5, state: 'ground' }) }
    if (hitEnemy(e, effCircleDmg(), 'circle')) { kills++; SFX.kill(kills + 1) }
  }
  SFX.circle()
  burstFx = { pts: pts.map((p) => ({ x: p.x, y: p.y })), t: 0.35 }
  if (kills >= 2) comboPopup(kills, cx, cy - 30)
}
function fireDot(x: number, y: number) {
  ink = clamp(ink - 3, 0, effInkMax())
  let kills = 0
  for (const e of enemies) {
    if (e.dead) continue
    if (Math.hypot(e.x - x, e.y - 8 - y) < 34) if (hitEnemy(e, P.DOT_DMG, 'dot')) { kills++; SFX.kill(kills) }
  }
  SFX.dotHit()
  parts.burst(x, y, 8, 'rgba(47,42,38,0.7)', 120, 100)
}
function fireSpiral(pts: { x: number; y: number; w: number }[]) {
  let cx = 0
  let cy = 0
  for (const p of pts) { cx += p.x; cy += p.y }
  cx /= pts.length
  cy /= pts.length
  for (const e of enemies) {
    if (e.dead) continue
    if (Math.hypot(e.x - cx, e.y - cy) < 150) {
      if (e.type === 'bird') e.y = Math.max(-20, e.y - 90)
      else e.prog = Math.max(0, e.prog - effFuujinPush())
      e.stun = Math.max(e.stun, effFuujinStun())
      parts.burst(e.x, e.y - 8, 6, 'rgba(120,130,150,0.5)', 160, 20)
    }
  }
  SFX.wind()
  popups.push({ x: cx, y: cy - 20, text: '風', t: 1, big: false })
}

// ── 敵の更新 ──
function nearWallAhead(e: Enemy, dist: number): Stroke | null {
  const ahead = pathAt(e.prog + dist)
  for (const s of strokes) {
    for (let i = 1; i < s.pts.length; i += 2)
      if (segCircle(s.pts[i - 1].x, s.pts[i - 1].y, s.pts[i].x, s.pts[i].y, ahead.x, ahead.y, 13)) return s
  }
  return null
}
function updateEnemy(e: Enemy, dt: number) {
  e.t += dt
  const d = DEF[e.type]
  let spd = d.spd * P.SPD_MUL
  if (e.stun > 0) { e.stun -= dt; spd = 0 }
  if (e.flip > 0) { e.flip -= dt; spd = 0 }

  if (e.type === 'bird') {
    e.y += spd * dt
    e.x += Math.sin(e.t * 1.7) * 26 * dt
    if (e.y > sealY - 8) smudgeSeal(e)
    return
  }
  if (e.type === 'namazu') {
    e.quakeT -= dt
    if (e.tired > 0) { e.tired -= dt; spd = 0 }
    if (e.quakeT <= 0) {
      e.quakeT = 8
      e.tired = 2.4
      strokes = []
      shake.add(14)
      SFX.quake()
      popups.push({ x: e.x, y: e.y - 44, text: '地揺れ！', t: 1.4, big: false })
    }
  }
  if (e.type === 'monkey') {
    if (!e.carry) {
      const g = drops.find((dr) => dr.state === 'ground' && Math.hypot(dr.x - e.x, dr.y - e.y) < 60)
      if (g) { g.state = 'stolen'; e.carry = true; popups.push({ x: e.x, y: e.y - 28, text: '盗', t: 0.9, big: false }) }
    }
    if (e.carry) {
      e.prog -= spd * 1.25 * dt // 逆走して逃げる
      if (e.prog <= 0) { e.dead = true; return } // 逃げ切り
      const p = pathAt(e.prog)
      e.dir = -1
      e.x = p.x
      e.y = p.y
      return
    }
  }
  // 壁との交渉
  const wall = e.air > 0 ? null : nearWallAhead(e, 12 + spd * 0.1)
  if (wall && spd > 0) {
    if (e.type === 'rabbit') {
      e.air = 1 // 跳ぶ（1→0 へ0.6秒で減衰）
    } else if (e.type === 'boar') {
      e.charge = clamp(e.charge + dt * 2.5, 0, 1)
      if (e.charge >= 1) { wall.hp -= 55; e.charge = 0; e.stun = 0.5; shake.add(4); SFX.chew() }
      spd *= 2.4 // 突進
    } else {
      spd = 0
      wall.hp -= 7 * dt
      if (Math.random() < dt * 6) SFX.chew()
    }
  } else if (e.type === 'boar') e.charge = 0
  if (e.air > 0) { e.air -= dt / 0.6; spd *= 1.5 }

  e.prog += spd * dt
  const p = pathAt(e.prog)
  const p2 = pathAt(e.prog + 8)
  e.dir = p2.x >= p.x ? 1 : -1
  e.x = p.x
  e.y = p.y
  if (e.prog >= totalLen - 10) smudgeSeal(e)
}
function smudgeSeal(e: Enemy) {
  e.dead = true
  if (e.ghost) return
  seal--
  shake.add(12)
  SFX.smudge()
  vignetteT = 0.9 // 朱ビネット発動
  popups.push({ x: sealX, y: sealY - 40, text: '印、汚れる…', t: 1.6, big: false })
  if (seal <= 0) gameOver()
}

// ── メインループ ──
let last = performance.now()
function frame(now: number) {
  requestAnimationFrame(frame)
  let dt = Math.min(0.033, (now - last) / 1000)
  last = now
  if (isPanelOpen()) { draw(); ptrh.endFrame(); return }

  if (mode === 'play' && !SHOT) update(dt)
  else if (mode === 'draft' && ptr.justPressed && !SHOT) {
    ensureAudio()
    // カードのタップ判定（描画と同じ矩形を使う）
    for (let ci = 0; ci < draftCards.length; ci++) {
      const r = draftCardRect(ci)
      if (ptr.x >= r.x && ptr.x <= r.x + r.w && ptr.y >= r.y && ptr.y <= r.y + r.h) {
        pickDraft(ci)
        break
      }
    }
  } else if (ptr.justPressed && (mode === 'title' || mode === 'over')) {
    ensureAudio()
    startGame()
  }
  draw()
  ptrh.endFrame()
}

function update(dt: number) {
  if (hitstop > 0) { hitstop -= dt; dt *= 0.12 }
  const ts = drawing ? effSlowmo() : 1
  const gdt = dt * ts

  // 筆の入力
  if (ptr.justPressed && banner.t <= 0.6) {
    ensureAudio()
    if (ink > 3) {
      drawing = true
      curPts = [{ x: ptr.x, y: ptr.y, w: 5, spd: 0 }]
      curLen = 0
    }
  }
  if (drawing && ptr.down) {
    const l = curPts[curPts.length - 1]
    const d = Math.hypot(ptr.x - l.x, ptr.y - l.y)
    if (d > 4) {
      const spd = d / Math.max(dt, 0.001)
      const w = clamp(11 - spd * 0.006, 3.5, 11) // ゆっくり＝太い
      curPts.push({ x: ptr.x, y: ptr.y, w: lerp(l.w, w, 0.3), spd })
      curLen += d
      if (curLen - lastBrushSfx > 34) { SFX.brushTick(spd); lastBrushSfx = curLen }
      if (strokeCost(curLen) >= ink) commitStroke() // 墨切れで強制筆離れ
    }
  }
  if (drawing && !ptr.down) commitStroke()

  // 墨
  ink = clamp(ink + effInkRegen() * gdt, 0, effInkMax())

  // 湧き
  for (const q of spawnQ) q.delay -= gdt
  const ready = spawnQ.filter((q) => q.delay <= 0)
  spawnQ = spawnQ.filter((q) => q.delay > 0)
  for (const q of ready) spawn(q.type)

  // 敵
  for (const e of enemies) if (!e.dead) updateEnemy(e, gdt)
  enemies = enemies.filter((e) => !e.dead)

  // 壁の寿命
  strokes = strokes.filter((s) => s.hp > 0)

  // 墨玉
  for (const dr of drops) {
    dr.t += gdt
    if (dr.state === 'ground' && dr.t > 1.1) dr.state = 'fly'
    if (dr.state === 'fly') {
      dr.x = lerp(dr.x, 60, 1 - Math.pow(0.001, gdt))
      dr.y = lerp(dr.y, 56, 1 - Math.pow(0.001, gdt))
      if (Math.hypot(dr.x - 60, dr.y - 56) < 12) {
        ink = clamp(ink + dr.value, 0, effInkMax())
        SFX.drop()
        dr.state = 'stolen' // 消費済み扱い
        dr.t = 99
      }
    }
  }
  drops = drops.filter((d) => !(d.state === 'stolen' && d.t > 90) && d.t < 30)

  // 演出
  parts.update(dt)
  splats.update(dt)
  vignetteT = Math.max(0, vignetteT - dt)
  for (const p of popups) p.t -= dt
  popups = popups.filter((p) => p.t > 0)
  for (const n of notes) n.t -= dt
  notes = notes.filter((n) => n.t > 0)
  banner.t = Math.max(0, banner.t - dt)
  stampT = Math.max(0, stampT - dt)
  if (burstFx) { burstFx.t -= dt; if (burstFx.t <= 0) burstFx = null }
  shake.update(dt)

  // 波クリア
  if (!waveDone && spawnQ.length === 0 && enemies.length === 0 && banner.t <= 0) waveCleared()
}

function commitStroke() {
  drawing = false
  lastBrushSfx = 0
  ink = clamp(ink - strokeCost(curLen), 0, effInkMax())
  classifyAndFire()
  curPts = []
  curLen = 0
}

// ── 描画 ──
/**
 * 墨線の3層描画（にじみハロー・本線・かすれ）。
 * kind: 'wall' なら常時ハローあり。drawing=true の描き途中はハロー強め。
 */
function drawInkLine(pts: StrokePt[], alpha: number, kind?: 'wall' | 'residue', isDrawing = false) {
  if (pts.length < 2) return
  const n = pts.length
  ctx.strokeStyle = SUMI
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // (a) にじみハロー（下敷き）
  const haloAlpha = (kind === 'wall' || isDrawing) ? (isDrawing ? 0.16 : 0.10) : 0.08
  ctx.globalAlpha = haloAlpha * alpha
  for (let i = 1; i < n; i++) {
    ctx.lineWidth = pts[i].w * 2.2
    ctx.beginPath()
    ctx.moveTo(pts[i - 1].x, pts[i - 1].y)
    ctx.lineTo(pts[i].x, pts[i].y)
    ctx.stroke()
  }

  // (b) 本線 + 入り抜きテーパー
  for (let i = 1; i < n; i++) {
    // 入り抜き：最初2・最後2のセグメントを細くする
    let taper = 1
    if (i <= 2) taper = lerp(0.45, 1.0, (i - 1) / 2)
    else if (i >= n - 2) taper = lerp(1.0, 0.45, (i - (n - 2)) / 2)
    const lineA = alpha
    ctx.globalAlpha = lineA
    ctx.lineWidth = pts[i].w * taper

    // (c) かすれ（spd > 900 のセグメントは alpha 55%・割れ線付き）
    const seg = pts[i]
    const prev = pts[i - 1]
    const isKasure = (seg.spd || 0) > 900
    if (isKasure) {
      ctx.globalAlpha = alpha * 0.55
      ctx.lineWidth = pts[i].w * taper
    } else {
      ctx.globalAlpha = alpha
    }
    ctx.beginPath()
    ctx.moveTo(prev.x, prev.y)
    ctx.lineTo(seg.x, seg.y)
    ctx.stroke()

    // かすれの割れ線（法線方向に±w*0.4 ずらした細線2本）
    if (isKasure) {
      const dx = seg.x - prev.x
      const dy = seg.y - prev.y
      const len = Math.hypot(dx, dy) || 1
      const nx = -dy / len
      const ny = dx / len
      const off = pts[i].w * 0.4
      const thin = pts[i].w * 0.35
      ctx.lineWidth = thin
      ctx.globalAlpha = alpha * 0.40
      for (const sign of [1, -1]) {
        ctx.beginPath()
        ctx.moveTo(prev.x + nx * off * sign, prev.y + ny * off * sign)
        ctx.lineTo(seg.x + nx * off * sign, seg.y + ny * off * sign)
        ctx.stroke()
      }
    }
  }

  ctx.globalAlpha = 1
}

function drawEnemy(e: Enemy) {
  ctx.save()
  ctx.translate(e.x, e.y)
  ctx.scale(e.dir * e.scale, e.scale)
  if (e.ghost) ctx.globalAlpha = 0.5
  switch (e.type) {
    case 'frog': drawFrog(ctx, e.t, Math.max(0, Math.sin(e.t * 4)) * 0.6); break
    case 'rabbit': drawRabbit(ctx, e.t, clamp(e.air, 0, 1)); break
    case 'monkey': drawMonkey(ctx, e.t, e.carry); break
    case 'boar': drawBoar(ctx, e.t, e.charge, e.flip > 0 ? 1 : 0); break
    case 'bird': drawBird(ctx, e.t); break
    case 'fox': drawFox(ctx, e.t, e.ghost); break
    case 'namazu': drawNamazu(ctx, e.t, e.tired > 0); break
  }
  ctx.restore()
  // 体力（減っている時だけ薄く）
  if (e.hp < e.maxHp && !e.ghost) {
    ctx.fillStyle = 'rgba(47,42,38,0.25)'
    ctx.fillRect(e.x - 14, e.y - 30 * e.scale, 28, 2.5)
    ctx.fillStyle = 'rgba(199,62,58,0.8)'
    ctx.fillRect(e.x - 14, e.y - 30 * e.scale, (28 * e.hp) / e.maxHp, 2.5)
  }
}

function drawSeal() {
  ctx.save()
  ctx.translate(sealX, sealY)
  ctx.rotate(-0.06)
  const s = 21
  ctx.globalAlpha = seal > 0 ? 0.92 : 0.3
  ctx.fillStyle = '#c73e3a'
  ctx.fillRect(-s, -s, s * 2, s * 2)
  ctx.fillStyle = '#f2ead8'
  ctx.font = '700 26px "Hiragino Mincho ProN", "Yu Mincho", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('遊', 0, 2)
  // 汚れ（被弾ぶん）
  ctx.fillStyle = 'rgba(47,42,38,0.75)'
  for (let i = 0; i < 3 - seal; i++) {
    ctx.beginPath()
    ctx.ellipse(-8 + i * 10, -6 + i * 9, 9, 5, 0.6 + i, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
  ctx.globalAlpha = 1
}

function draw() {
  // 紙テクスチャ（キャッシュ）
  ctx.drawImage(getPaper(), 0, 0)
  // 山水（キャッシュ）
  if (mode === 'play' || mode === 'draft') ctx.drawImage(getLandscape(), 0, 0)

  ctx.save()
  shake.apply(ctx)

  // 小道（薄墨の点線）
  ctx.strokeStyle = 'rgba(47,42,38,0.18)'
  ctx.lineWidth = 5
  ctx.setLineDash([2, 13])
  ctx.beginPath()
  ctx.moveTo(path[0].x, path[0].y)
  for (const p of path) ctx.lineTo(p.x, p.y)
  ctx.stroke()
  ctx.setLineDash([])

  drawSeal()

  // 壁・残り墨
  for (const s of strokes) drawInkLine(s.pts, 0.25 + 0.65 * (s.hp / s.maxHp), s.kind)
  // 描き途中の筆
  if (drawing) drawInkLine(curPts, 0.95, undefined, true)
  // 丸の破裂
  if (burstFx) {
    ctx.strokeStyle = SUMI
    ctx.globalAlpha = burstFx.t / 0.35
    ctx.lineWidth = 3 + (1 - burstFx.t / 0.35) * 10
    ctx.beginPath()
    const c = burstFx.pts
    const k = lerp(1, 0.4, 1 - burstFx.t / 0.35)
    let cx = 0, cy = 0
    for (const p of c) { cx += p.x; cy += p.y }
    cx /= c.length
    cy /= c.length
    ctx.moveTo(cx + (c[0].x - cx) * k, cy + (c[0].y - cy) * k)
    for (const p of c) ctx.lineTo(cx + (p.x - cx) * k, cy + (p.y - cy) * k)
    ctx.closePath()
    ctx.stroke()
    ctx.globalAlpha = 1
  }

  for (const e of enemies) drawEnemy(e)

  // 墨玉
  for (const dr of drops) if (dr.state !== 'stolen') dot(ctx, dr.x, dr.y, 4.5, 0.85)

  parts.draw(ctx)
  splats.draw(ctx)

  // 賛（コンボ書）— big=true は縦書き
  for (const p of popups) {
    const a = clamp(p.t / 0.4, 0, 1)
    ctx.globalAlpha = a
    ctx.save()
    ctx.translate(p.x, p.y - (1.6 - p.t) * 18)
    ctx.rotate(-0.04)
    if (p.big) {
      // 縦書き（1文字ずつ）
      const fontSize = 30
      ctx.font = `800 ${fontSize}px "Hiragino Mincho ProN", "Yu Mincho", serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      const chars = Array.from(p.text)
      for (let ci = 0; ci < chars.length; ci++) {
        ctx.fillStyle = '#8d3a37'
        ctx.fillText(chars[ci], 0, ci * fontSize)
      }
      // 落款（朱の小矩形）
      const sealY2 = chars.length * fontSize + 4
      ctx.fillStyle = 'rgba(199,62,58,0.85)'
      ctx.fillRect(-5, sealY2, 10, 10)
    } else {
      ctx.fillStyle = SUMI
      ctx.font = `600 17px "Hiragino Mincho ProN", "Yu Mincho", serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(p.text, 0, 0)
    }
    ctx.restore()
    ctx.globalAlpha = 1
  }
  ctx.restore() // shake

  // 被弾ビネット（HUD 手前）
  if (vignetteT > 0) {
    const vA = clamp(vignetteT / 0.9, 0, 1) * 0.28
    const edge = 60
    // 四辺の縁取りグラデーション（上・下・左・右）
    const tops = ctx.createLinearGradient(0, 0, 0, edge)
    tops.addColorStop(0, `rgba(199,62,58,${vA.toFixed(3)})`)
    tops.addColorStop(1, 'rgba(199,62,58,0)')
    ctx.fillStyle = tops
    ctx.fillRect(0, 0, W, edge)
    const bots = ctx.createLinearGradient(0, H - edge, 0, H)
    bots.addColorStop(0, 'rgba(199,62,58,0)')
    bots.addColorStop(1, `rgba(199,62,58,${vA.toFixed(3)})`)
    ctx.fillStyle = bots
    ctx.fillRect(0, H - edge, W, edge)
    const lefts = ctx.createLinearGradient(0, 0, edge, 0)
    lefts.addColorStop(0, `rgba(199,62,58,${vA.toFixed(3)})`)
    lefts.addColorStop(1, 'rgba(199,62,58,0)')
    ctx.fillStyle = lefts
    ctx.fillRect(0, 0, edge, H)
    const rights = ctx.createLinearGradient(W - edge, 0, W, 0)
    rights.addColorStop(0, 'rgba(199,62,58,0)')
    rights.addColorStop(1, `rgba(199,62,58,${vA.toFixed(3)})`)
    ctx.fillStyle = rights
    ctx.fillRect(W - edge, 0, edge, H)
  }

  drawHud()
  if (banner.t > 0) drawBanner()
  if (stampT > 0) drawStamp()
  if (mode === 'title') drawTitle()
  if (mode === 'over') drawOver()
  if (mode === 'draft') drawDraft()
}

function drawHud() {
  if (mode !== 'play') return
  // 墨ゲージ（筆線バー）
  const bx = 14
  const by = 72
  const bw = 130
  ctx.strokeStyle = 'rgba(47,42,38,0.3)'
  ctx.lineWidth = 10
  ctx.lineCap = 'round'
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx + bw, by)
  ctx.stroke()
  ctx.strokeStyle = SUMI
  ctx.beginPath()
  ctx.moveTo(bx, by)
  ctx.lineTo(bx + (bw * ink) / effInkMax(), by)
  ctx.stroke()
  ctx.fillStyle = SUMI
  ctx.font = '600 12px "Hiragino Mincho ProN", serif'
  ctx.textAlign = 'left'
  ctx.fillText('墨', bx, by - 12)
  // 描き途中コスト
  if (drawing) {
    ctx.strokeStyle = '#c73e3a'
    ctx.beginPath()
    const used = clamp((bw * strokeCost(curLen)) / effInkMax(), 0, (bw * ink) / effInkMax())
    ctx.moveTo(bx + (bw * ink) / effInkMax() - used, by)
    ctx.lineTo(bx + (bw * ink) / effInkMax(), by)
    ctx.stroke()
  }
  // 巻・波
  ctx.fillStyle = 'rgba(47,42,38,0.75)'
  ctx.font = '600 13px "Hiragino Mincho ProN", serif'
  ctx.textAlign = 'center'
  const label = makiIdx < MAKI.length ? `${MAKI[makiIdx].name.slice(0, 3)}・其の${'一二三'[waveIdx]}` : `百鬼繚乱・第${waveNum - 9}波`
  ctx.fillText(label, W / 2, 30)
  // 印の残り
  for (let i = 0; i < 3; i++) {
    ctx.globalAlpha = i < seal ? 0.9 : 0.18
    ctx.fillStyle = '#c73e3a'
    ctx.fillRect(W - 26 - i * 20, 48, 13, 13)
  }
  ctx.globalAlpha = 1
  // 取得済み画技チップ（左下、最大8個）
  const takenEntries = GAKI.filter((g) => (taken[g.id] || 0) > 0)
  const chipMax = 8
  const chipSize = 20
  const chipGap = 4
  const chipBottom = H - 36
  for (let ci = 0; ci < Math.min(takenEntries.length, chipMax); ci++) {
    const g = takenEntries[ci]
    const cx2 = bx + ci * (chipSize + chipGap)
    const cy2 = chipBottom - chipSize
    ctx.fillStyle = '#efe6cd'
    ctx.strokeStyle = 'rgba(47,42,38,0.5)'
    ctx.lineWidth = 0.8
    ctx.fillRect(cx2, cy2, chipSize, chipSize)
    ctx.strokeRect(cx2, cy2, chipSize, chipSize)
    ctx.fillStyle = SUMI
    ctx.font = `700 12px "Hiragino Mincho ProN", serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(g.kanji, cx2 + chipSize / 2, cy2 + chipSize / 2)
    if ((taken[g.id] || 0) > 1) {
      ctx.font = '500 8px "Hiragino Mincho ProN", serif'
      ctx.fillStyle = '#8d3a37'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(`×${taken[g.id]}`, cx2 + chipSize, cy2)
    }
  }
  if (takenEntries.length > chipMax) {
    const cx2 = bx + chipMax * (chipSize + chipGap)
    ctx.fillStyle = 'rgba(47,42,38,0.5)'
    ctx.font = '500 10px "Hiragino Mincho ProN", serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'middle'
    ctx.fillText('…', cx2, chipBottom - chipSize / 2)
  }
  ctx.textBaseline = 'alphabetic'

  // 心得（教えの紙片。印を隠さないよう上部に、最大2枚）
  let ny = 104
  ctx.font = '600 13px "Hiragino Mincho ProN", serif'
  for (const n of notes.slice(-2)) {
    const a = clamp(n.t / 0.5, 0, 1)
    ctx.globalAlpha = 0.92 * a
    ctx.fillStyle = '#eadfc2'
    const tw = ctx.measureText(n.text).width + 30
    ctx.fillRect(W / 2 - tw / 2, ny - 15, tw, 26)
    ctx.fillStyle = SUMI
    ctx.textAlign = 'center'
    ctx.fillText(n.text, W / 2, ny + 2)
    ny += 32
    ctx.globalAlpha = 1
  }
}

function drawBanner() {
  const a = clamp(banner.t / 0.4, 0, 1) * clamp((2.2 - banner.t) / 0.3, 0, 1)
  ctx.globalAlpha = a * 0.9
  ctx.fillStyle = SUMI
  ctx.font = '800 30px "Hiragino Mincho ProN", "Yu Mincho", serif'
  ctx.textAlign = 'center'
  ctx.fillText(banner.text, W / 2, H * 0.4)
  ctx.globalAlpha = 1
}
function drawStamp() {
  const k = 1 - stampT
  const s = lerp(3, 1, clamp(k * 4, 0, 1))
  ctx.save()
  ctx.translate(W / 2, H * 0.55)
  ctx.rotate(-0.1)
  ctx.scale(s, s)
  ctx.globalAlpha = clamp(stampT / 0.25, 0, 1) * 0.85
  ctx.fillStyle = '#c73e3a'
  ctx.fillRect(-26, -26, 52, 52)
  ctx.fillStyle = '#f2ead8'
  ctx.font = '800 34px "Hiragino Mincho ProN", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('払', 0, 2)
  ctx.restore()
  ctx.globalAlpha = 1
}

function drawTitle() {
  // 山水背景（タイトルでは maki=0 の構図）。キャッシュ利用。
  if (!titleLandscapeCache) titleLandscapeCache = makeLandscape(W, H, 0)
  ctx.drawImage(titleLandscapeCache, 0, 0)
  ctx.fillStyle = 'rgba(242,234,216,0.82)'
  ctx.fillRect(0, 0, W, H)
  // 円相（筆の円）
  ctx.strokeStyle = 'rgba(47,42,38,0.85)'
  ctx.lineWidth = 10
  ctx.lineCap = 'round'
  ctx.beginPath()
  const t = performance.now() / 1000
  const open = 0.25 + Math.sin(t * 0.7) * 0.08
  ctx.arc(W / 2, H * 0.33, 84, -Math.PI / 2 + open, -Math.PI / 2 - open + Math.PI * 2)
  ctx.stroke()
  // 円の中に蛙
  ctx.save()
  ctx.translate(W / 2, H * 0.33 + 26)
  ctx.scale(1.6, 1.6)
  drawFrog(ctx, t, Math.max(0, Math.sin(t * 2.2)) * 0.6)
  ctx.restore()
  ctx.fillStyle = SUMI
  ctx.textAlign = 'center'
  ctx.font = '800 44px "Hiragino Mincho ProN", "Yu Mincho", serif'
  ctx.fillText('墨戯絵巻', W / 2, H * 0.56)
  ctx.font = '600 15px "Hiragino Mincho ProN", serif'
  ctx.fillStyle = 'rgba(47,42,38,0.75)'
  ctx.fillText('かいて、はらう。', W / 2, H * 0.61)
  ctx.font = '500 13px "Hiragino Mincho ProN", serif'
  const lines = ['指の筆で、けものを払え', '線＝斬り・壁　丸＝破裂　点＝しぶき　渦＝風', '墨は有限。倒して墨玉を取り戻せ', '巻の合間に『画技』を選んで、己の筆を作れ']
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H * 0.68 + i * 22))
  if (best > 0) ctx.fillText(`これまで 第${best}波`, W / 2, H * 0.68 + 3 * 22 + 8)
  ctx.fillStyle = '#8d3a37'
  ctx.font = '700 16px "Hiragino Mincho ProN", serif'
  if (Math.sin(t * 5) > -0.2) ctx.fillText('筆を置いて、始める', W / 2, H * 0.85)
}
function drawOver() {
  ctx.fillStyle = 'rgba(242,234,216,0.88)'
  ctx.fillRect(0, 0, W, H)
  ctx.fillStyle = SUMI
  ctx.textAlign = 'center'
  ctx.font = '800 36px "Hiragino Mincho ProN", serif'
  ctx.fillText('絵巻、汚れる', W / 2, H * 0.4)
  ctx.font = '600 16px "Hiragino Mincho ProN", serif'
  ctx.fillStyle = 'rgba(47,42,38,0.8)'
  const reach = makiIdx < MAKI.length ? `${MAKI[makiIdx].name.slice(0, 3)}・其の${'一二三'[waveIdx]}` : `百鬼繚乱・第${waveNum - 9}波`
  ctx.fillText(`たどりついた場所：${reach}`, W / 2, H * 0.47)
  ctx.fillText(`これまでの最奥：第${Math.max(best, waveNum)}波`, W / 2, H * 0.52)
  ctx.fillStyle = '#8d3a37'
  ctx.font = '700 16px "Hiragino Mincho ProN", serif'
  if (Math.sin(performance.now() / 200) > -0.2) ctx.fillText('筆を置いて、もう一度', W / 2, H * 0.66)
}

// ── ドラフト画面 ──
/** カード矩形（描画とタップ判定で共有） */
function draftCardRect(ci: number) {
  const cardW = W * 0.29
  const cardH = H * 0.36
  const gap = W * 0.03
  const totalWidth = cardW * 3 + gap * 2
  const startX = (W - totalWidth) / 2
  const cardY = H * 0.22
  return { x: startX + ci * (cardW + gap), y: cardY, w: cardW, h: cardH }
}

function drawDraft() {
  // 半透明オーバーレイ
  ctx.fillStyle = 'rgba(242,234,216,0.95)'
  ctx.fillRect(0, 0, W, H)

  // タイトル文
  ctx.fillStyle = SUMI
  ctx.font = '700 22px "Hiragino Mincho ProN", "Yu Mincho", serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText('画技を、ひとつ。', W / 2, H * 0.15)

  const rotations = [-0.02, 0.0, 0.02]

  for (let ci = 0; ci < draftCards.length; ci++) {
    const g = draftCards[ci]
    const rect = draftCardRect(ci)
    const cardW = rect.w
    const cardH = rect.h
    const cx3 = rect.x + cardW / 2
    const cy3 = rect.y + cardH / 2

    ctx.save()
    ctx.translate(cx3, cy3)
    ctx.rotate(rotations[ci] || 0)

    // カード背景・縁取り
    ctx.fillStyle = '#efe6cd'
    ctx.strokeStyle = SUMI
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 4)
    ctx.fill()
    ctx.stroke()

    // 以降のテキストはカード内にクリップ（はみ出し防止）
    ctx.beginPath()
    ctx.roundRect(-cardW / 2, -cardH / 2, cardW, cardH, 4)
    ctx.clip()

    // 大きな漢字（カード高の28%位置）
    ctx.fillStyle = SUMI
    ctx.font = `700 44px "Hiragino Mincho ProN", "Yu Mincho", serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(g.kanji, 0, -cardH / 2 + cardH * 0.28)

    // 名前（48%位置）
    ctx.font = `600 16px "Hiragino Mincho ProN", serif`
    ctx.fillText(g.name, 0, -cardH / 2 + cardH * 0.48)

    // 説明文（58%位置から。measureText で幅に収まるよう折り返し）
    ctx.font = `500 11px "Hiragino Mincho ProN", serif`
    ctx.fillStyle = 'rgba(47,42,38,0.75)'
    const descLines = wrapTextByWidth(g.desc, cardW - 14)
    const descY0 = -cardH / 2 + cardH * 0.58
    for (let li2 = 0; li2 < descLines.length; li2++) {
      ctx.fillText(descLines[li2], 0, descY0 + li2 * 15)
    }

    // 取得済み表示
    const cnt = taken[g.id] || 0
    if (cnt > 0) {
      ctx.font = `600 10px "Hiragino Mincho ProN", serif`
      ctx.fillStyle = '#8d3a37'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(`×${cnt}`, cardW / 2 - 4, -cardH / 2 + 4)
    }

    ctx.restore()
  }
}

/** 文字列を measureText で maxWidth(px) に収まるよう文字単位で折り返す（最大5行） */
function wrapTextByWidth(text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const ch of Array.from(text)) {
    if (ctx.measureText(line + ch).width > maxWidth && line.length > 0) {
      lines.push(line)
      line = ch
      if (lines.length >= 5) return lines
    } else {
      line += ch
    }
  }
  if (line.length > 0 && lines.length < 5) lines.push(line)
  return lines
}

// ── SHOT（QA・サムネ用の静止シーン） ──
if (SHOT === 'draft') {
  mode = 'draft'
  // 固定3枚（noboku, shibuki, shingan）
  draftCards = GAKI.filter((g) => ['noboku', 'shibuki', 'shingan'].includes(g.id)).slice(0, 3)
}

if (SHOT === 'battle') {
  mode = 'play'
  makiIdx = 1
  waveIdx = 1
  ink = 64
  seal = 2
  const place = (type: EType, prog: number) => {
    spawn(type)
    const e = enemies[enemies.length - 1]
    e.prog = prog
    const p = pathAt(prog)
    e.x = p.x
    e.y = p.y
  }
  setTimeout(() => {
    enemies = []
    place('frog', totalLen * 0.28)
    place('frog', totalLen * 0.34)
    place('rabbit', totalLen * 0.45)
    place('boar', totalLen * 0.55)
    const bird = { ...enemies[0] }
    spawn('bird')
    enemies[enemies.length - 1].x = W * 0.3
    enemies[enemies.length - 1].y = H * 0.24
    void bird
    // 飛沫の染みを事前散布（見た目確認用）
    for (let si = 0; si < 5; si++) {
      splats.burst(W * (0.2 + Math.random() * 0.6), H * (0.3 + Math.random() * 0.5), Math.random() * Math.PI * 2)
    }
    // 壁と賛
    const wallPts = [] as StrokePt[]
    for (let i = 0; i <= 10; i++) wallPts.push({ x: W * 0.3 + i * (W * 0.4 / 10), y: H * 0.62 - i * 4, w: 9, spd: 0 })
    strokes.push({ pts: wallPts, hp: 30, maxHp: 40, kind: 'wall' })
    popups.push({ x: W * 0.55, y: H * 0.38, text: '三獣一筆', t: 1.4, big: true })
    notes = [{ text: NOTES.boar, t: 4 }]
    for (const e of enemies) { const p = pathAt(e.prog); if (e.type !== 'bird') { e.x = p.x; e.y = p.y } }
  }, 250)
}

requestAnimationFrame(frame)
