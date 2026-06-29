// games/petri/main.ts — Playlab No.03「まもって、ふやして。」
// セルサバイバー（SkyFury）に学ぶ習作：顕微鏡のシャーレで、中央のコアを守る
// 移動＋自動射撃のサバイバー×タワーディフェンス。ウェーブ毎に「進化」を選び、
// 分裂で群れ（コロニー）を増やして火力と画面を盛り上げる。
// 商標名・公式アートは使わず、絵・敵・名前は自作。
import { attachPointer, fitCanvas, safeBottom } from '../../shared/input'
import { clamp, lerp, makeShake, Particles, easeOutBack, approach } from '../../shared/juice'
import { drawHowToCard } from '../../shared/shell'
import { enterTransition, wireLink } from '../../shared/transition'
import * as tune from '../../shared/tune'
import { isMuted, mountMuteButton } from '../../shared/audio'

// 実機調整パネル（右上の⚙）。const ではなく P.xxx を読む＝スライダーでライブ調整
const P = tune.panel('petri', {
  // 操作（即反映）
  MOVE_SPEED: { v: 200, min: 80, max: 400, step: 5, group: '操作', label: '最高速', desc: '細胞が動ける最高スピード。大きいほどキビキビ＝速く、小さいほどゆったり。' },
  DRAG_MAXR: { v: 76, min: 40, max: 130, step: 2, group: '操作', label: '反応距離', desc: '指をこの距離まで引くと最高速。大きいほど精密に・小さいほど少しの操作で速く動く。' },
  inputCurve: { v: 2, min: 1, max: 3, step: 0.1, group: '操作', label: '入力カーブ', desc: '1=引いた量にそのまま比例。大きいほど中央付近が繊細になり、微調整しやすい。' },
  // スコア/養分（即反映）
  COMBO_HOLD: { v: 3.2, min: 1, max: 6, step: 0.1, group: 'スコア', label: 'コンボ持続(秒)', desc: '撃破が途切れてからコンボ倍率が消えるまでの猶予。長いほど倍率を維持しやすい。' },
  magnetR: { v: 82, min: 30, max: 170, step: 2, group: 'スコア', label: '養分の吸着範囲', desc: 'この距離まで近づくと養分オーブが吸い寄せられる。大きいほど拾いやすい＝楽。' },
  // 火力（再開で反映）
  fireInterval0: { v: 0.42, min: 0.12, max: 1, step: 0.01, group: '火力(再開で反映)', label: '初期連射間隔(秒)', desc: '1発ごとの間隔。小さいほど連射が速い＝開幕の火力が上がる。' },
  damage0: { v: 1, min: 1, max: 5, step: 1, group: '火力(再開で反映)', label: '初期威力' },
  range0: { v: 210, min: 120, max: 360, step: 10, group: '火力(再開で反映)', label: '初期射程', desc: 'この範囲内の敵を自動で狙う。' },
  startColony: { v: 1, min: 0, max: 5, step: 1, group: '火力(再開で反映)', label: '開幕の仲間数', desc: 'スタート時にコアの周りを回る撃ち手の数。多いほど開幕が楽。' },
  // 敵/難度（再開で反映）
  enemyHpMul: { v: 1, min: 0.3, max: 2.5, step: 0.1, group: '敵(再開で反映)', label: '敵HP倍率', desc: '1.0が基準。上げると硬く（難）、下げると脆い（易）。' },
  enemySpdMul: { v: 1, min: 0.3, max: 2, step: 0.1, group: '敵(再開で反映)', label: '敵速度倍率', desc: '1.0が基準。上げると速く迫る（難）。' },
  spawnCountMul: { v: 1, min: 0.3, max: 2.5, step: 0.1, group: '敵(再開で反映)', label: '出現数倍率', desc: '1.0が基準。各ウェーブの敵の数を増減。' },
  coreMaxHp: { v: 10, min: 4, max: 30, step: 1, group: '敵(再開で反映)', label: 'コア最大HP', desc: '守るコアの耐久。敵が触れると減り、0で負け。' },
  bossHpMul: { v: 1, min: 0.3, max: 3, step: 0.1, group: '敵(再開で反映)', label: 'ボスHP倍率', desc: '1.0が基準。ボスの硬さ＝戦いの長さ。' },
})
mountMuteButton()

// ── 顕微鏡スライドの配色（ラボ・スキンの寒天タイント版） ──
const C = {
  agar: '#eef1ec',
  agarEdge: '#dde3da',
  ink: '#1c2821',
  muted: '#5d6b63',
  line: 'rgba(28,40,33,0.08)',
  core: '#c2701c', // 核＝琥珀
  coreDeep: '#9a560f',
  cell: '#2f7d6b', // 自分（撃ち手の細胞）＝青緑
  cellDeep: '#1f5849',
  enzyme: '#27604f', // 弾（酵素）
  virus: '#b1492e', // 雑魚ウイルス
  tank: '#6d4b8c', // 厚い細菌
  boss: '#7a2d2d',
  danger: '#9b2f2f',
}
const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif'

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}
const darken = (hex: string, f: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgb(${(((n >> 16) & 255) * f) | 0}, ${(((n >> 8) & 255) * f) | 0}, ${((n & 255) * f) | 0})`
}

// ── キャンバス ──
const canvas = document.getElementById('game') as HTMLCanvasElement
const ctx = canvas.getContext('2d')!
let W = 0,
  H = 0
fitCanvas(canvas, (w, h) => {
  W = w
  H = h
})
const ptrh = attachPointer(canvas)
const ptr = ptrh.pointer
const shake = makeShake(26)
const fx = new Particles()

// ── 効果音（WebAudio・合成。桜井「無反応を排除／音は妥協しない」） ──
let actx: AudioContext | null = null
let master: GainNode | null = null
function ensureAudio() {
  if (actx) return
  try {
    actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
    master = actx.createGain()
    master.gain.value = 0.5
    master.connect(actx.destination)
    try {
      ;(navigator as any).audioSession && ((navigator as any).audioSession.type = 'playback')
    } catch {}
  } catch {}
}
function unlockAudio() {
  if (!actx) ensureAudio()
  if (!actx) return
  if (actx.state === 'suspended') actx.resume()
  // iOS アンロック用の無音1サンプル
  const b = actx.createBuffer(1, 1, 22050)
  const s = actx.createBufferSource()
  s.buffer = b
  s.connect(actx.destination)
  s.start(0)
}
// 単音（osc）を鳴らす小ヘルパー
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
let lastShootSnd = 0
const SFX = {
  shoot() {
    if (!actx || time - lastShootSnd < 0.07) return
    lastShootSnd = time
    blip(680, 0.05, 'square', 0.025, 520)
  },
  kill() {
    blip(330, 0.09, 'triangle', 0.10, 200)
  },
  killTank() {
    blip(180, 0.16, 'sawtooth', 0.12, 90)
  },
  pickup() {
    blip(880, 0.06, 'square', 0.06, 1180)
  },
  split() {
    blip(520, 0.12, 'triangle', 0.12, 900)
  },
  coreHit() {
    blip(140, 0.18, 'sawtooth', 0.16, 70)
  },
  evolve() {
    blip(523, 0.1, 'triangle', 0.12)
    setTimeout(() => blip(784, 0.16, 'triangle', 0.12), 90)
  },
  bossDefeat() {
    ;[392, 523, 659, 784].forEach((f, i) => setTimeout(() => blip(f, 0.22, 'triangle', 0.13), i * 110))
  },
  win() {
    ;[523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.2, 'triangle', 0.12), i * 120))
  },
  lose() {
    ;[440, 330, 247].forEach((f, i) => setTimeout(() => blip(f, 0.25, 'sawtooth', 0.12), i * 140))
  },
}

document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
const SHOT = new URLSearchParams(location.search).get('shot')
if (!SHOT) enterTransition()

// ── 型 ──
type Enemy = {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  hp: number
  maxhp: number
  spd: number
  kind: 'virus' | 'tank'
  wob: number
  hit: number // 被弾フラッシュ
}
type Bullet = { x: number; y: number; vx: number; vy: number; r: number; dmg: number; pierce: number; life: number; hit: Set<any> }
type Orb = { x: number; y: number; vx: number; vy: number; life: number; value: number }
type FloatText = { x: number; y: number; text: string; life: number; color: string }
type Cell = { x: number; y: number; ang: number; cool: number; main: boolean; pop: number }
type Boss = {
  x: number
  y: number
  ang: number // 周回角
  hp: number
  maxhp: number
  r: number
  trail: { x: number; y: number }[]
  minionCool: number
  hit: number
} | null

// ── 進化（ローグライト） ──
type Stats = {
  fireInterval: number
  damage: number
  range: number
  multishot: number
  pierce: number
  bulletSpeed: number
  orbitSpeed: number
}
type Evo = { id: string; name: string; desc: string; apply: () => void }
function evoPool(): Evo[] {
  return [
    { id: 'rate', name: '酵素の活性', desc: '連射が速くなる', apply: () => (S.fireInterval *= 0.82) },
    { id: 'dmg', name: '溶解力', desc: '一発の威力 +1', apply: () => (S.damage += 1) },
    { id: 'range', name: '走化性', desc: '射程が伸びる', apply: () => (S.range += 55) },
    { id: 'split', name: '分裂', desc: '仲間が1体増える', apply: () => addColony(1) },
    { id: 'spread', name: '多核化', desc: '同時に狙う数 +1', apply: () => (S.multishot += 1) },
    { id: 'pierce', name: '貫通', desc: '弾が1体多く貫く', apply: () => (S.pierce += 1) },
    { id: 'speed', name: '弾速', desc: '弾が速くなる', apply: () => (S.bulletSpeed += 120) },
    { id: 'heal', name: '膜の修復', desc: 'コアを2回復', apply: () => (core.hp = Math.min(core.maxhp, core.hp + 2)) },
    { id: 'fort', name: '細胞壁の強化', desc: 'コア最大HP +2', apply: () => { core.maxhp += 2; core.hp += 2 } },
  ]
}

// ── 状態 ──
type Mode = 'title' | 'play' | 'evolve' | 'over'
let mode: Mode = 'title'
let time = 0
let result: 'win' | 'lose' = 'win'
let bestWave = Number(localStorage.getItem('playlab.petri.best') || 0)
// スコア＆コンボ（リスク&リターン／ごほうびの可視化）
let score = 0
let bestScore = Number(localStorage.getItem('playlab.petri.bestscore') || 0)
let combo = 0 // 連続撃破数
let comboTimer = 0 // これが切れるとコンボ0へ
let orbs: Orb[] = []
let floats: FloatText[] = []
let freezeFrames = 0 // ヒットストップ
const comboMult = () => clamp(1 + Math.floor(combo / 4) * 0.5, 1, 5) // x1〜x5

const S: Stats = { fireInterval: 0.62, damage: 1, range: 200, multishot: 1, pierce: 0, bulletSpeed: 430, orbitSpeed: 1.1 }
const core = { x: 0, y: 0, r: 30, hp: 10, maxhp: 10, pulse: 0, hitFlash: 0 }
let cells: Cell[] = []
let enemies: Enemy[] = []
let bullets: Bullet[] = []
let boss: Boss = null

// 相対ドラッグ操作（survivor.io 系の標準＝片手・画面のどこでも・引いた方向へ歩く）
// 最高速・反応距離・入力カーブは調整パネル P から（実機でライブ調整）
const DRAG_DEAD = 5 // これ未満は静止
let dragging = false
let anchorX = 0
let anchorY = 0
let knobX = 0
let knobY = 0
let velX = 0
let velY = 0

// ウェーブ進行
let wave = 0
const TOTAL_WAVES = 6 // 6体目がボス
let spawnQueue = 0 // このウェーブで残り出現数
let spawnTimer = 0
let spawnGap = 0.9
let evoChoices: Evo[] = []
let evoScale = 0
let titleScale = 0

function reset() {
  S.fireInterval = P.fireInterval0 // 初期火力（調整パネル）
  S.damage = P.damage0
  S.range = P.range0
  S.multishot = 1
  S.pierce = 0
  S.bulletSpeed = 430
  S.orbitSpeed = 1.1
  core.x = W / 2
  core.y = H / 2
  core.maxhp = P.coreMaxHp
  core.hp = P.coreMaxHp
  core.pulse = 0
  core.hitFlash = 0
  cells = []
  enemies = []
  bullets = []
  boss = null
  orbs = []
  floats = []
  fx.list = []
  wave = 0
  score = 0
  combo = 0
  comboTimer = 0
  freezeFrames = 0
  // 最初の撃ち手（指で動かすメイン）
  cells.push({ x: W / 2, y: H / 2 + 90, ang: 0, cool: 0, main: true, pop: 1 })
  // 最初から仲間＝間口を広く（Kirbyism）。コア周りの守りと火力の下限を確保
  addColony(P.startColony)
}

function addColony(n: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    cells.push({ x: core.x, y: core.y, ang: a, cool: Math.random() * 0.3, main: false, pop: 0 })
  }
}

// ── ウェーブ ──
function startWave(n: number) {
  wave = n
  if (n >= TOTAL_WAVES) {
    spawnBoss()
    return
  }
  // のこぎり波：Wave1 は少なく・ゆっくり（チュートリアル）→ 徐々に増やす
  spawnQueue = Math.round((3 + n * 2) * P.spawnCountMul) // w1=5, w2=7, w3=9...（×倍率）
  spawnGap = Math.max(0.4, 1.05 - (n - 1) * 0.08) // w1=1.05 と余裕、後半詰まる
  spawnTimer = 0.5
}

function spawnEnemy() {
  // 画面外の円周からコアへ向かう
  const a = Math.random() * Math.PI * 2
  const rad = Math.max(W, H) * 0.62
  const x = core.x + Math.cos(a) * rad
  const y = core.y + Math.sin(a) * rad
  // 敵は1種ずつ導入（マリオ1-1式）：タンクは Wave2 から
  const tank = wave >= 2 && Math.random() < 0.1 + (wave - 2) * 0.04
  const hpBase = (1.5 + (wave - 1) * 1.0) * P.enemyHpMul // w1=1.5(2発)... ×倍率
  const tspd = (24 + wave * 2) * P.enemySpdMul
  const vspd = (34 + (wave - 1) * 6) * P.enemySpdMul
  const e: Enemy = tank
    ? { x, y, vx: 0, vy: 0, r: 19, hp: hpBase * 2.4, maxhp: hpBase * 2.4, spd: tspd, kind: 'tank', wob: Math.random() * 9, hit: 0 }
    : { x, y, vx: 0, vy: 0, r: 12, hp: hpBase, maxhp: hpBase, spd: vspd, kind: 'virus', wob: Math.random() * 9, hit: 0 }
  enemies.push(e)
}

function spawnBoss() {
  const a = Math.random() * Math.PI * 2
  const rad = Math.max(W, H) * 0.6
  // コロニー規模で強さをスケール（強すぎ/弱すぎ回避）
  const hp = Math.round((55 + cells.length * 12) * P.bossHpMul)
  boss = {
    x: core.x + Math.cos(a) * rad,
    y: core.y + Math.sin(a) * rad,
    ang: a,
    hp,
    maxhp: hp,
    r: 26,
    trail: [],
    minionCool: 2,
    hit: 0,
  }
}

// ── 入力（状態ごと） ──
canvas.addEventListener('pointerdown', () => {
  unlockAudio() // iOS: タップ内で必ずアンロック
  if (mode === 'title') {
    reset()
    mode = 'play'
    time = 0
    startWave(1)
  } else if (mode === 'evolve') {
    // タップ位置で3択を選ぶ
    pickEvolveAt(ptr.x, ptr.y)
  } else if (mode === 'over') {
    mode = 'title'
    titleScale = 0
  }
})

function showEvolve() {
  mode = 'evolve'
  evoScale = 0
  const pool = evoPool()
  // 3つランダム抽出
  evoChoices = []
  const idx = [...pool.keys()]
  for (let i = 0; i < 3 && idx.length; i++) {
    const k = (Math.random() * idx.length) | 0
    evoChoices.push(pool[idx[k]])
    idx.splice(k, 1)
  }
}

// 進化カードの矩形（描画と当たり判定で共有）
function evoRects() {
  const cw = Math.min(330, W - 36)
  const ch = 78
  const gap = 14
  const total = evoChoices.length * ch + (evoChoices.length - 1) * gap
  const top = H / 2 - total / 2 + 26
  return evoChoices.map((e, i) => ({ e, x: W / 2 - cw / 2, y: top + i * (ch + gap), w: cw, h: ch }))
}
function pickEvolveAt(px: number, py: number) {
  for (const r of evoRects()) {
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      r.e.apply()
      fx.burst(core.x, core.y, 22, C.core, 220)
      shake.add(6)
      core.pulse = 1
      SFX.evolve()
      if (r.e.id === 'split') SFX.split()
      mode = 'play'
      startWave(wave + 1)
      return
    }
  }
}

// ── 更新 ──
function update(dt: number) {
  time += dt
  shake.update(dt)
  fx.update(dt)
  core.pulse = approach(core.pulse, 0, dt, 4)
  core.hitFlash = Math.max(0, core.hitFlash - dt * 3)

  if (mode === 'title') titleScale = approach(titleScale, 1, dt, 8)
  if (mode === 'evolve') {
    evoScale = approach(evoScale, 1, dt, 10)
    return // 一時停止
  }
  if (mode !== 'play') return

  // 入力（相対ドラッグ）→ 目標速度を決める
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
      // ベース（基点）を指の方へ引き寄せる＝トレイル式フローティングパッド
      const k = 1 - P.DRAG_MAXR / mag
      anchorX += dx * k
      anchorY += dy * k
      dx = ptr.x - anchorX
      dy = ptr.y - anchorY
      mag = P.DRAG_MAXR
    }
    knobX = anchorX + dx
    knobY = anchorY + dy
    if (mag >= DRAG_DEAD) {
      // 入力カーブ：中央付近は繊細に、フルで引いて初めて最高速（"動きすぎ"の抑制）
      const norm = mag / P.DRAG_MAXR
      const sp = Math.pow(norm, P.inputCurve) * P.MOVE_SPEED
      tvx = (dx / mag) * sp
      tvy = (dy / mag) * sp
    }
  } else {
    dragging = false
  }
  // 速度を滑らかに追従＝重さ（twitch防止）。停止はやや速めに収束。
  const accel = tvx === 0 && tvy === 0 ? 20 : 12
  velX = approach(velX, tvx, dt, accel)
  velY = approach(velY, tvy, dt, accel)

  // 撃ち手の移動
  cells.forEach((c, i) => {
    c.pop = approach(c.pop, 1, dt, 6)
    if (c.main) {
      c.x = clamp(c.x + velX * dt, 12, W - 12)
      c.y = clamp(c.y + velY * dt, 12, H - 12)
    } else {
      // コアの周りを周回（コロニー）
      c.ang += S.orbitSpeed * dt
      const orbitR = 64 + (i % 3) * 22
      c.x = approach(c.x, core.x + Math.cos(c.ang) * orbitR, dt, 9)
      c.y = approach(c.y, core.y + Math.sin(c.ang) * orbitR, dt, 9)
    }
    // 自動射撃
    c.cool -= dt
    if (c.cool <= 0) {
      const targets = nearestTargets(c.x, c.y, S.range, S.multishot)
      if (targets.length) {
        for (const t of targets) {
          const dx = t.x - c.x
          const dy = t.y - c.y
          const d = Math.hypot(dx, dy) || 1
          bullets.push({
            x: c.x,
            y: c.y,
            vx: (dx / d) * S.bulletSpeed,
            vy: (dy / d) * S.bulletSpeed,
            r: 4.5,
            dmg: S.damage,
            pierce: S.pierce,
            life: 1.6,
            hit: new Set(),
          })
        }
        c.cool = S.fireInterval
        if (c.main) SFX.shoot() // メインのみ・throttle済み（機関銃ノイズ回避）
      } else {
        c.cool = 0.08 // 的が無ければ素早く再走査
      }
    }
  })

  // 弾
  for (const b of bullets) {
    b.x += b.vx * dt
    b.y += b.vy * dt
    b.life -= dt
    // 敵との衝突
    for (const e of enemies) {
      if (b.hit.has(e)) continue
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) {
        e.hp -= b.dmg
        e.hit = 1
        b.hit.add(e)
        fx.burst(b.x, b.y, 4, C.enzyme, 90)
        if (b.pierce-- <= 0) b.life = 0
        if (e.hp <= 0) killEnemy(e)
        if (b.life <= 0) break
      }
    }
    // ボスとの衝突（頭＋胴のサンプル点）
    if (boss && b.life > 0 && !b.hit.has(boss)) {
      const pts = [{ x: boss.x, y: boss.y, r: boss.r }, ...bossSegPoints(boss)]
      for (const p of pts) {
        if (Math.hypot(p.x - b.x, p.y - b.y) < p.r + b.r) {
          boss.hp -= b.dmg
          boss.hit = 1
          b.hit.add(boss)
          fx.burst(b.x, b.y, 5, C.boss, 110)
          if (b.pierce-- <= 0) b.life = 0
          if (boss.hp <= 0) defeatBoss()
          break
        }
      }
    }
  }
  bullets = bullets.filter((b) => b.life > 0 && b.x > -40 && b.x < W + 40 && b.y > -40 && b.y < H + 40)

  // 敵の移動＋コア接触
  for (const e of enemies) {
    e.hit = Math.max(0, e.hit - dt * 4)
    e.wob += dt * 6
    const dx = core.x - e.x
    const dy = core.y - e.y
    const d = Math.hypot(dx, dy) || 1
    e.x += (dx / d) * e.spd * dt
    e.y += (dy / d) * e.spd * dt
    if (d < core.r + e.r) {
      damageCore(e.kind === 'tank' ? 2 : 1)
      fx.burst(e.x, e.y, 10, C.danger, 160)
      e.hp = 0
    }
  }
  enemies = enemies.filter((e) => e.hp > 0)

  // コンボ減衰（攻め続けないと倍率が落ちる）
  if (comboTimer > 0) {
    comboTimer -= dt
    if (comboTimer <= 0) combo = 0
  }

  // 養分オーブ：移動・摩擦・寿命・メイン細胞へ磁力で吸着→回収（拾う＝動く＝コアを離れるリスク）
  const mainCell = cells.find((c) => c.main)
  for (const o of orbs) {
    o.life -= dt
    o.x += o.vx * dt
    o.y += o.vy * dt
    o.vx *= 0.9
    o.vy *= 0.9
    if (mainCell) {
      const dx = mainCell.x - o.x
      const dy = mainCell.y - o.y
      const d = Math.hypot(dx, dy) || 1
      if (d < P.magnetR) {
        const pull = 300 * dt
        o.x += (dx / d) * pull
        o.y += (dy / d) * pull
        if (d < 20) {
          pickupOrb(o)
          o.life = 0
        }
      }
    }
  }
  orbs = orbs.filter((o) => o.life > 0)

  // フロートテキスト
  for (const f of floats) {
    f.life -= dt
    f.y -= 24 * dt
  }
  floats = floats.filter((f) => f.life > 0)

  // ボス
  if (boss) updateBoss(dt)

  // スポーン
  if (boss == null && wave < TOTAL_WAVES) {
    if (spawnQueue > 0) {
      spawnTimer -= dt
      if (spawnTimer <= 0) {
        spawnEnemy()
        spawnQueue--
        spawnTimer = spawnGap
      }
    } else if (enemies.length === 0) {
      // ウェーブクリア → 進化
      if (wave >= 1) showEvolve()
    }
  }

  if (core.hp <= 0) endRun('lose')
}

function nearestTargets(x: number, y: number, range: number, n: number) {
  const cand: { x: number; y: number; d: number }[] = []
  for (const e of enemies) {
    const d = Math.hypot(e.x - x, e.y - y)
    if (d <= range) cand.push({ x: e.x, y: e.y, d })
  }
  if (boss) {
    const d = Math.hypot(boss.x - x, boss.y - y)
    if (d <= range) cand.push({ x: boss.x, y: boss.y, d })
  }
  cand.sort((a, b) => a.d - b.d)
  return cand.slice(0, n)
}

function bossSegPoints(b: NonNullable<Boss>) {
  const pts: { x: number; y: number; r: number }[] = []
  const segs = Math.max(2, Math.ceil((b.hp / b.maxhp) * 6))
  for (let i = 1; i <= segs; i++) {
    const idx = Math.min(b.trail.length - 1, i * 7)
    const p = b.trail[idx]
    if (p) pts.push({ x: p.x, y: p.y, r: b.r * (1 - i * 0.07) })
  }
  return pts
}

function updateBoss(dt: number) {
  const b = boss!
  b.hit = Math.max(0, b.hit - dt * 4)
  // コアの周りを目指して周回しつつ、たまにミニオンを放つ
  const targetR = 130
  const dx = core.x - b.x
  const dy = core.y - b.y
  const d = Math.hypot(dx, dy) || 1
  if (d > targetR + 8) {
    b.x += (dx / d) * 34 * dt
    b.y += (dy / d) * 34 * dt
  } else {
    b.ang += 0.5 * dt
    const tx = core.x + Math.cos(b.ang) * targetR
    const ty = core.y + Math.sin(b.ang) * targetR
    b.x = approach(b.x, tx, dt, 2)
    b.y = approach(b.y, ty, dt, 2)
  }
  b.trail.unshift({ x: b.x, y: b.y })
  if (b.trail.length > 60) b.trail.pop()
  b.minionCool -= dt
  if (b.minionCool <= 0) {
    b.minionCool = 2.4
    // ボスからミニオン放出
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2
      enemies.push({ x: b.x + Math.cos(a) * 10, y: b.y + Math.sin(a) * 10, vx: 0, vy: 0, r: 11, hp: 3, maxhp: 3, spd: 60, kind: 'virus', wob: Math.random() * 9, hit: 0 })
    }
  }
}

function killEnemy(e: Enemy) {
  fx.burst(e.x, e.y, e.kind === 'tank' ? 18 : 10, e.kind === 'tank' ? C.tank : C.virus, 200)
  shake.add(e.kind === 'tank' ? 4 : 1.5)
  // コンボ加算（連続撃破で倍率UP）
  combo++
  comboTimer = P.COMBO_HOLD
  // 養分オーブを落とす（拾うとスコア＝動いて回収する＝コアを離れるリスク）
  const n = e.kind === 'tank' ? 3 : 1
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2
    const s = 40 + Math.random() * 60
    orbs.push({ x: e.x, y: e.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 7, value: e.kind === 'tank' ? 2 : 1 })
  }
  if (e.kind === 'tank') {
    SFX.killTank()
    freezeFrames = 3 // ヒットストップ（重い敵だけ。雑魚は群れるので無し）
  } else {
    SFX.kill()
  }
}

function defeatBoss() {
  const b = boss!
  for (let i = 0; i < 5; i++) fx.burst(b.x + (Math.random() * 60 - 30), b.y + (Math.random() * 60 - 30), 26, C.boss, 260)
  // 養分を大量にばらまく（ごほうび）
  for (let i = 0; i < 14; i++) {
    const a = Math.random() * Math.PI * 2
    const s = 60 + Math.random() * 120
    orbs.push({ x: b.x, y: b.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 9, value: 3 })
  }
  shake.add(18)
  freezeFrames = 8
  SFX.bossDefeat()
  boss = null
  endRun('win')
}

function damageCore(n: number) {
  core.hp -= n
  core.hitFlash = 1
  shake.add(7)
  combo = Math.floor(combo / 2) // 被弾でコンボ半減＝攻めすぎのリスク
  SFX.coreHit()
}

function pickupOrb(o: Orb) {
  const gain = o.value * comboMult()
  score += gain
  floats.push({ x: o.x, y: o.y - 6, text: '+' + gain, life: 0.8, color: C.core })
  SFX.pickup()
}

function endRun(r: 'win' | 'lose') {
  result = r
  mode = 'over'
  if (r === 'win') score += 100 // クリアボーナス
  const reached = r === 'win' ? TOTAL_WAVES : wave
  if (reached > bestWave) {
    bestWave = reached
    localStorage.setItem('playlab.petri.best', String(bestWave))
  }
  if (score > bestScore) {
    bestScore = score
    localStorage.setItem('playlab.petri.bestscore', String(bestScore))
  }
  if (r === 'win') SFX.win()
  else SFX.lose()
}

// ── 描画 ──
function drawBackground() {
  ctx.fillStyle = C.agar
  ctx.fillRect(0, 0, W, H)
  // 方眼（顕微鏡の目盛り）
  ctx.strokeStyle = C.line
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
  // シャーレ（培養円）＝視野
  const dishR = Math.min(W, H) * 0.46
  const g = ctx.createRadialGradient(W / 2, H / 2, dishR * 0.2, W / 2, H / 2, dishR)
  g.addColorStop(0, 'rgba(255,255,255,0.25)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, dishR, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = hexA(C.ink, 0.1)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(W / 2, H / 2, dishR, 0, Math.PI * 2)
  ctx.stroke()
  // 周辺のヴィネット
  const v = ctx.createRadialGradient(W / 2, H * 0.48, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.72)
  v.addColorStop(0, 'rgba(0,0,0,0)')
  v.addColorStop(1, 'rgba(20,30,24,0.14)')
  ctx.fillStyle = v
  ctx.fillRect(0, 0, W, H)
}

function organism(x: number, y: number, r: number, fill: string, edge: string, spikes = 0, wob = 0, hitFlash = 0) {
  ctx.save()
  ctx.translate(x, y)
  if (hitFlash > 0) {
    ctx.fillStyle = 'rgba(255,255,255,' + 0.7 * hitFlash + ')'
  }
  // 輪郭の塗り（少しだけ波打つ）
  ctx.beginPath()
  const n = 14
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = r * (1 + Math.sin(a * 3 + wob) * 0.05)
    const px = Math.cos(a) * rr
    const py = Math.sin(a) * rr
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }
  ctx.closePath()
  if (hitFlash <= 0) ctx.fillStyle = fill
  ctx.fill()
  // スパイク（ウイルスの突起）
  if (spikes > 0) {
    ctx.strokeStyle = edge
    ctx.lineWidth = Math.max(1.4, r * 0.12)
    for (let i = 0; i < spikes; i++) {
      const a = (i / spikes) * Math.PI * 2 + wob * 0.2
      const r1 = r * 0.96
      const r2 = r * 1.32
      ctx.beginPath()
      ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1)
      ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2)
      ctx.stroke()
    }
  }
  // 輪郭線
  ctx.strokeStyle = edge
  ctx.lineWidth = Math.max(1.4, r * 0.12)
  ctx.beginPath()
  ctx.arc(0, 0, r, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function drawCore() {
  const pr = 1 + core.pulse * 0.12
  core.r = 30
  const r = core.r * pr
  // 外膜
  organism(core.x, core.y, r, hexA(C.core, 0.18), C.coreDeep, 0, time * 0.6, core.hitFlash)
  // 二重リング
  ctx.strokeStyle = hexA(C.core, 0.5)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(core.x, core.y, r * 0.66, 0, Math.PI * 2)
  ctx.stroke()
  // 核小体
  ctx.fillStyle = C.core
  ctx.beginPath()
  ctx.arc(core.x, core.y, r * 0.26, 0, Math.PI * 2)
  ctx.fill()
}

function drawCell(c: Cell) {
  const s = easeOutBack(clamp(c.pop, 0, 1))
  const r = (c.main ? 15 : 12) * s
  organism(c.x, c.y, r, hexA(C.cell, 0.22), C.cellDeep, 0, time * 1.2 + c.ang, 0)
  ctx.fillStyle = C.cell
  ctx.beginPath()
  ctx.arc(c.x, c.y, r * 0.32, 0, Math.PI * 2)
  ctx.fill()
  if (c.main) {
    // 射程の薄い輪
    ctx.strokeStyle = hexA(C.cell, 0.14)
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.arc(c.x, c.y, S.range, 0, Math.PI * 2)
    ctx.stroke()
  }
}

function drawEnemy(e: Enemy) {
  if (e.kind === 'tank') organism(e.x, e.y, e.r, hexA(C.tank, 0.22), darken(C.tank, 0.7), 0, e.wob, e.hit)
  else organism(e.x, e.y, e.r, hexA(C.virus, 0.22), darken(C.virus, 0.7), 6, e.wob, e.hit)
  // HPバー（小）
  if (e.hp < e.maxhp) {
    const w = e.r * 2
    ctx.fillStyle = hexA(C.ink, 0.15)
    ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w, 3)
    ctx.fillStyle = C.danger
    ctx.fillRect(e.x - w / 2, e.y - e.r - 8, w * clamp(e.hp / e.maxhp, 0, 1), 3)
  }
}

function drawBoss() {
  const b = boss!
  // 胴（trail に沿って）
  const pts = bossSegPoints(b)
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    organism(p.x, p.y, p.r, hexA(C.boss, 0.2), darken(C.boss, 0.7), 0, time + i, 0)
  }
  // 頭
  organism(b.x, b.y, b.r, hexA(C.boss, 0.28), darken(C.boss, 0.6), 8, time * 1.5, b.hit)
  ctx.fillStyle = darken(C.boss, 0.6)
  ctx.beginPath()
  ctx.arc(b.x, b.y, b.r * 0.3, 0, Math.PI * 2)
  ctx.fill()
  // ボスHPバー（スコアの下に置く）
  const bw = Math.min(W - 40, 320)
  const bx = W / 2 - bw / 2
  const by = 60
  ctx.fillStyle = hexA(C.ink, 0.12)
  ctx.fillRect(bx, by, bw, 7)
  ctx.fillStyle = C.boss
  ctx.fillRect(bx, by, bw * clamp(b.hp / b.maxhp, 0, 1), 7)
  ctx.fillStyle = C.muted
  ctx.font = `700 11px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText('変異ボス', W / 2, by - 5)
}

function drawBullets() {
  ctx.fillStyle = C.enzyme
  for (const b of bullets) {
    ctx.beginPath()
    ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawOrbs() {
  for (const o of orbs) {
    const a = clamp(o.life / 1.2, 0, 1) // 消える間際にフェード
    const r = 3.2 + (o.value > 1 ? 1.8 : 0)
    ctx.globalAlpha = a * 0.35
    ctx.fillStyle = C.core
    ctx.beginPath()
    ctx.arc(o.x, o.y, r + 2.6 + Math.sin(time * 6 + o.x) * 0.8, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = a
    ctx.beginPath()
    ctx.arc(o.x, o.y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function drawFloats() {
  ctx.textAlign = 'center'
  for (const f of floats) {
    ctx.globalAlpha = clamp(f.life / 0.8, 0, 1)
    ctx.fillStyle = f.color
    ctx.font = `800 14px ${FONT}`
    ctx.fillText(f.text, f.x, f.y)
  }
  ctx.globalAlpha = 1
}

function drawHUD() {
  // スコア（上部中央・大きめ＝ごほうびは見える所に）
  ctx.textAlign = 'center'
  ctx.fillStyle = C.ink
  ctx.font = `800 24px ${FONT}`
  ctx.fillText(String(score), W / 2, 36)
  // コンボ倍率（攻め続けると上がる。被弾で減る）
  if (combo >= 2) {
    const m = comboMult()
    const p = 0.7 + 0.3 * clamp(comboTimer / P.COMBO_HOLD, 0, 1)
    ctx.fillStyle = m >= 2 ? C.core : C.muted
    ctx.font = `800 ${Math.round(13 * (0.9 + p * 0.25))}px ${FONT}`
    ctx.fillText(`x${m % 1 === 0 ? m : m.toFixed(1)}  (${combo})`, W / 2, 54)
  }

  const base = H - 14 - safeBottom() // セーフエリア分だけ持ち上げる
  // コアHP
  const bw = Math.min(W - 120, 220)
  const bx = W / 2 - bw / 2
  const by = base - 12
  ctx.fillStyle = hexA(C.ink, 0.12)
  ctx.fillRect(bx, by, bw, 8)
  ctx.fillStyle = core.hp / core.maxhp < 0.34 ? C.danger : C.core
  ctx.fillRect(bx, by, bw * clamp(core.hp / core.maxhp, 0, 1), 8)
  ctx.fillStyle = C.muted
  ctx.font = `700 11px ${FONT}`
  ctx.textAlign = 'center'
  ctx.fillText(`コア ${Math.max(0, Math.ceil(core.hp))}/${core.maxhp}`, W / 2, by - 5)
  // ウェーブ・コロニー
  ctx.textAlign = 'right'
  ctx.fillStyle = C.muted
  ctx.font = `700 12px ${FONT}`
  const label = boss ? 'BOSS' : `WAVE ${wave}/${TOTAL_WAVES - 1}`
  ctx.fillText(label, W - 16, base)
  ctx.textAlign = 'left'
  ctx.fillText(`コロニー ${cells.length}`, 16, base)
}

function drawJoystick() {
  if (!dragging) return
  ctx.save()
  ctx.strokeStyle = hexA(C.cell, 0.28)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(anchorX, anchorY, P.DRAG_MAXR, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = hexA(C.cell, 0.16)
  ctx.beginPath()
  ctx.arc(anchorX, anchorY, P.DRAG_MAXR, 0, Math.PI * 2)
  ctx.fill()
  // ノブ
  ctx.fillStyle = hexA(C.cell, 0.55)
  ctx.beginPath()
  ctx.arc(knobX, knobY, 17, 0, Math.PI * 2)
  ctx.fill()
  ctx.strokeStyle = hexA(C.cellDeep, 0.7)
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(knobX, knobY, 17, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function roundRect(x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  if ((ctx as any).roundRect) (ctx as any).roundRect(x, y, w, h, r)
  else {
    ctx.moveTo(x + r, y)
    ctx.arcTo(x + w, y, x + w, y + h, r)
    ctx.arcTo(x + w, y + h, x, y + h, r)
    ctx.arcTo(x, y + h, x, y, r)
    ctx.arcTo(x, y, x + w, y, r)
    ctx.closePath()
  }
}

function drawEvolve() {
  ctx.fillStyle = hexA(C.agar, 0.78)
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  // 見出しは矩形群の上に置く
  const rects = evoRects()
  const headY = rects.length ? rects[0].y - 18 : H / 2
  ctx.fillStyle = C.core
  ctx.font = `800 24px ${FONT}`
  ctx.fillText('進化を選ぶ', W / 2, headY)
  rects.forEach((r) => {
    const s = easeOutBack(clamp(evoScale, 0, 1))
    ctx.save()
    ctx.translate(r.x + r.w / 2, r.y + r.h / 2)
    ctx.scale(s, s)
    ctx.translate(-(r.x + r.w / 2), -(r.y + r.h / 2))
    roundRect(r.x, r.y, r.w, r.h, 14)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.strokeStyle = hexA(C.core, 0.55)
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.textAlign = 'left'
    ctx.fillStyle = C.ink
    ctx.font = `800 17px ${FONT}`
    ctx.fillText(r.e.name, r.x + 18, r.y + 32)
    ctx.fillStyle = C.muted
    ctx.font = `500 13px ${FONT}`
    ctx.fillText(r.e.desc, r.x + 18, r.y + 56)
    ctx.restore()
  })
}

function drawTitle() {
  drawHowToCard(ctx, W, H, {
    title: 'まもって、ふやして。',
    lines: ['画面を引いた方向へ移動（射撃は自動）', '養分を拾ってスコア・コアを守れ', '進化と分裂で群れを増やす'],
    start: 'タップでスタート',
    footer: bestWave > 0 ? `best: ${bestWave === TOTAL_WAVES ? 'クリア' : 'WAVE ' + bestWave}` : undefined,
    accent: C.core,
    ink: C.ink,
    muted: C.muted,
    panel: '#ffffff',
    border: hexA(C.core, 0.4),
    t: time,
    scale: easeOutBack(clamp(titleScale, 0, 1)),
  })
  // クレジット
  ctx.textAlign = 'center'
  ctx.fillStyle = hexA(C.ink, 0.4)
  ctx.font = `500 10px ${FONT}`
  ctx.fillText('「セルサバイバー」に学ぶ習作 / 絵・敵・名前は自作', W / 2, H - 16 - safeBottom())
}

function drawOver() {
  ctx.fillStyle = hexA(C.agar, 0.82)
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.fillStyle = result === 'win' ? C.cell : C.danger
  ctx.font = `800 34px ${FONT}`
  ctx.fillText(result === 'win' ? '培養成功！' : 'コア崩壊…', W / 2, H * 0.42)
  ctx.fillStyle = C.muted
  ctx.font = `500 15px ${FONT}`
  const msg = result === 'win' ? `全${TOTAL_WAVES - 1}ウェーブ＋ボスを撃退` : `WAVE ${wave} で力尽きた`
  ctx.fillText(msg, W / 2, H * 0.42 + 32)
  // スコア（ごほうびを大きく見せる）
  ctx.fillStyle = C.core
  ctx.font = `800 30px ${FONT}`
  ctx.fillText(`${score}`, W / 2, H * 0.42 + 74)
  ctx.fillStyle = C.muted
  ctx.font = `600 13px ${FONT}`
  ctx.fillText(`SCORE${score >= bestScore && score > 0 ? '（自己ベスト更新！）' : `  /  best ${bestScore}`}`, W / 2, H * 0.42 + 94)
  ctx.fillStyle = C.core
  ctx.font = `800 16px ${FONT}`
  const pulse = 0.65 + 0.35 * Math.sin(time * 4)
  ctx.globalAlpha = pulse
  ctx.fillText('タップでタイトルへ', W / 2, H * 0.42 + 128)
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
  // ヒットストップ：数フレーム更新を止める（描画は続ける＝打撃の重み）
  if (freezeFrames > 0 && mode === 'play') freezeFrames--
  else update(dt)

  ctx.save()
  shake.apply(ctx)
  drawBackground()
  if (mode !== 'title') {
    // コア → 弾 → オーブ → 敵 → 撃ち手 → 粒子 → フロート
    drawCore()
    drawBullets()
    drawOrbs()
    enemies.forEach(drawEnemy)
    if (boss) drawBoss()
    cells.forEach(drawCell)
    fx.draw(ctx)
    drawFloats()
    drawJoystick()
    drawHUD()
  } else {
    fx.draw(ctx)
  }
  ctx.restore()

  if (mode === 'title') drawTitle()
  else if (mode === 'evolve') drawEvolve()
  else if (mode === 'over') drawOver()

  ptrh.endFrame()
  requestAnimationFrame(frame)
}

// 映えフレーム（サムネ用）: ?shot=1
function setupShot() {
  reset()
  mode = 'play'
  wave = 3
  // それっぽい配置
  addColony(4)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2
    const d = 150 + Math.random() * 120
    enemies.push({ x: core.x + Math.cos(a) * d, y: core.y + Math.sin(a) * d, vx: 0, vy: 0, r: i % 3 === 0 ? 18 : 12, hp: 3, maxhp: 5, spd: 40, kind: i % 3 === 0 ? 'tank' : 'virus', wob: i, hit: 0 })
  }
  // コロニーを軌道上に散らす
  cells.forEach((c, i) => {
    if (c.main) {
      c.x = core.x + 70
      c.y = core.y - 56
      c.pop = 1
    } else {
      c.ang = (i / cells.length) * Math.PI * 2
      const orbitR = 64 + (i % 3) * 22
      c.x = core.x + Math.cos(c.ang) * orbitR
      c.y = core.y + Math.sin(c.ang) * orbitR
      c.pop = 1
    }
  })
  // 飛んでいる弾
  for (const e of enemies.slice(0, 6)) {
    const dx = e.x - cells[0].x
    const dy = e.y - cells[0].y
    const d = Math.hypot(dx, dy) || 1
    bullets.push({ x: lerp(cells[0].x, e.x, 0.4), y: lerp(cells[0].y, e.y, 0.4), vx: (dx / d) * 430, vy: (dy / d) * 430, r: 4.5, dmg: 1, pierce: 0, life: 1, hit: new Set() })
  }
  for (let i = 0; i < 30; i++) fx.burst(core.x + (Math.random() * 200 - 100), core.y + (Math.random() * 200 - 100), 1, i % 2 ? C.virus : C.core, 60)
  // 養分オーブをいくつか（新メカを映えフレームでも見せる）
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2
    const d = 70 + Math.random() * 130
    orbs.push({ x: core.x + Math.cos(a) * d, y: core.y + Math.sin(a) * d, vx: 0, vy: 0, life: 7, value: i % 3 === 0 ? 2 : 1 })
  }
  score = 1240
  combo = 9
  comboTimer = P.COMBO_HOLD
  S.range = 230
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
