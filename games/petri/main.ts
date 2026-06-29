// games/petri/main.ts — Playlab No.03「まもって、ふやして。」
// セルサバイバー（SkyFury）に学ぶ習作：顕微鏡のシャーレで、中央のコアを守る
// 移動＋自動射撃のサバイバー×タワーディフェンス。ウェーブ毎に「進化」を選び、
// 分裂で群れ（コロニー）を増やして火力と画面を盛り上げる。
// 商標名・公式アートは使わず、絵・敵・名前は自作。
import { attachPointer, fitCanvas } from '../../shared/input'
import { clamp, lerp, makeShake, Particles, easeOutBack, approach } from '../../shared/juice'
import { drawHowToCard } from '../../shared/shell'
import { enterTransition, wireLink } from '../../shared/transition'

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
const ptr = attachPointer(canvas)
const shake = makeShake(26)
const fx = new Particles()

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

const S: Stats = { fireInterval: 0.62, damage: 1, range: 200, multishot: 1, pierce: 0, bulletSpeed: 430, orbitSpeed: 1.1 }
const core = { x: 0, y: 0, r: 30, hp: 10, maxhp: 10, pulse: 0, hitFlash: 0 }
let cells: Cell[] = []
let enemies: Enemy[] = []
let bullets: Bullet[] = []
let boss: Boss = null

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
  S.fireInterval = 0.62
  S.damage = 1
  S.range = 200
  S.multishot = 1
  S.pierce = 0
  S.bulletSpeed = 430
  S.orbitSpeed = 1.1
  core.x = W / 2
  core.y = H / 2
  core.maxhp = 10
  core.hp = 10
  core.pulse = 0
  core.hitFlash = 0
  cells = []
  enemies = []
  bullets = []
  boss = null
  fx.list = []
  wave = 0
  // 最初の撃ち手（指で動かすメイン）
  cells.push({ x: W / 2, y: H / 2 + 90, ang: 0, cool: 0, main: true, pop: 1 })
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
  spawnQueue = 5 + n * 3
  spawnGap = Math.max(0.35, 0.95 - n * 0.08)
  spawnTimer = 0.4
}

function spawnEnemy() {
  // 画面外の円周からコアへ向かう
  const a = Math.random() * Math.PI * 2
  const rad = Math.max(W, H) * 0.62
  const x = core.x + Math.cos(a) * rad
  const y = core.y + Math.sin(a) * rad
  const tank = Math.random() < 0.18 + wave * 0.03
  const hpBase = 2 + wave * 0.9
  const e: Enemy = tank
    ? { x, y, vx: 0, vy: 0, r: 19, hp: hpBase * 2.4, maxhp: hpBase * 2.4, spd: 26 + wave * 2, kind: 'tank', wob: Math.random() * 9, hit: 0 }
    : { x, y, vx: 0, vy: 0, r: 12, hp: hpBase, maxhp: hpBase, spd: 44 + wave * 4, kind: 'virus', wob: Math.random() * 9, hit: 0 }
  enemies.push(e)
}

function spawnBoss() {
  const a = Math.random() * Math.PI * 2
  const rad = Math.max(W, H) * 0.6
  boss = {
    x: core.x + Math.cos(a) * rad,
    y: core.y + Math.sin(a) * rad,
    ang: a,
    hp: 70 + 0 * wave,
    maxhp: 70,
    r: 26,
    trail: [],
    minionCool: 2,
    hit: 0,
  }
}

// ── 入力（状態ごと） ──
canvas.addEventListener('pointerdown', () => {
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

  // 撃ち手の移動
  cells.forEach((c, i) => {
    c.pop = approach(c.pop, 1, dt, 6)
    if (c.main) {
      if (ptr.down) {
        c.x = approach(c.x, ptr.x, dt, 18)
        c.y = approach(c.y, ptr.y, dt, 18)
      }
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
  const before = enemies.length
  enemies = enemies.filter((e) => e.hp > 0)
  void before

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
}

function defeatBoss() {
  const b = boss!
  for (let i = 0; i < 5; i++) fx.burst(b.x + (Math.random() * 60 - 30), b.y + (Math.random() * 60 - 30), 26, C.boss, 260)
  shake.add(18)
  boss = null
  endRun('win')
}

function damageCore(n: number) {
  core.hp -= n
  core.hitFlash = 1
  shake.add(7)
}

function endRun(r: 'win' | 'lose') {
  result = r
  mode = 'over'
  const reached = r === 'win' ? TOTAL_WAVES : wave
  if (reached > bestWave) {
    bestWave = reached
    localStorage.setItem('playlab.petri.best', String(bestWave))
  }
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
  // ボスHPバー（上部）
  const bw = Math.min(W - 40, 320)
  const bx = W / 2 - bw / 2
  const by = 18
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

function drawHUD() {
  // コアHP
  const bw = Math.min(W - 120, 220)
  const bx = W / 2 - bw / 2
  const by = H - 26
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
  ctx.fillText(label, W - 16, H - 14)
  ctx.textAlign = 'left'
  ctx.fillText(`コロニー ${cells.length}`, 16, H - 14)
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
    lines: ['指で細胞を動かす（射撃は自動）', '敵を中央のコアに触れさせない', 'ウェーブ毎に進化、分裂で増やす'],
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
  ctx.fillText('「セルサバイバー」に学ぶ習作 / 絵・敵・名前は自作', W / 2, H - 16)
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
  ctx.fillText(msg, W / 2, H * 0.42 + 34)
  ctx.fillText(`コロニー最大 ${cells.length}`, W / 2, H * 0.42 + 58)
  ctx.fillStyle = C.core
  ctx.font = `800 16px ${FONT}`
  const pulse = 0.65 + 0.35 * Math.sin(time * 4)
  ctx.globalAlpha = pulse
  ctx.fillText('タップでタイトルへ', W / 2, H * 0.42 + 100)
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
  update(dt)

  ctx.save()
  shake.apply(ctx)
  drawBackground()
  if (mode !== 'title') {
    // コア → 弾 → 敵 → 撃ち手 → 粒子
    drawCore()
    drawBullets()
    enemies.forEach(drawEnemy)
    if (boss) drawBoss()
    cells.forEach(drawCell)
    fx.draw(ctx)
    drawHUD()
  } else {
    fx.draw(ctx)
  }
  ctx.restore()

  if (mode === 'title') drawTitle()
  else if (mode === 'evolve') drawEvolve()
  else if (mode === 'over') drawOver()

  ptr.endFrame()
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
