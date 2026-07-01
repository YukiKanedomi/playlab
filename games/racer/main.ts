// games/racer/main.ts — Playlab No.06「はしって、よけて。」（磨き込み版）
// three.js ＋ Kenney(CC0) の低ポリ3D。スピード感・ニアミス・コイン・クラッシュ演出・影・
// カウントダウンを追加して手触りを底上げ。素材一覧は LICENSES.md。
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { attachPointer } from '../../shared/input'
import { wireLink } from '../../shared/transition'
import { isMuted, mountMuteButton, configureMixedSession, onMuteChange } from '../../shared/audio'
import roadUrl from './assets/road.glb'
import playerUrl from './assets/player.glb'
import carAUrl from './assets/carA.glb'
import carBUrl from './assets/carB.glb'
import treeUrl from './assets/tree.glb'
import colormapUrl from './assets/colormap.png'

const canvas = document.getElementById('game') as HTMLCanvasElement
const ptrh = attachPointer(canvas)
const ptr = ptrh.pointer
document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
const SHOT = new URLSearchParams(location.search).get('shot')
mountMuteButton()

// UI
const el = (id: string) => document.getElementById(id)!
const uiScore = el('score')
const uiTitle = el('titleCard')
const uiOver = el('overCard')
const uiLoading = el('loading')
const hud = el('hud')
const show = (n: HTMLElement, v: boolean) => n.classList.toggle('hidden', !v)
// 大きな中央テキスト（カウントダウン用）
const bigText = document.createElement('div')
bigText.style.cssText =
  'position:absolute;left:0;right:0;top:34%;text-align:center;font-weight:800;font-size:72px;color:#16324a;text-shadow:0 3px 10px rgba(255,255,255,.5);pointer-events:none;'
hud.appendChild(bigText)
function popup(text: string, color: string) {
  const p = document.createElement('div')
  p.textContent = text
  p.style.cssText = `position:absolute;left:0;right:0;top:22%;text-align:center;font-weight:800;font-size:24px;color:${color};text-shadow:0 2px 8px rgba(255,255,255,.5);pointer-events:none;transition:transform .7s ease,opacity .7s ease;`
  hud.appendChild(p)
  requestAnimationFrame(() => {
    p.style.transform = 'translateY(-30px)'
    p.style.opacity = '0'
  })
  setTimeout(() => p.remove(), 750)
}

// ── three.js 基本 ──
const SKY = 0xbfe3ff
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
const scene = new THREE.Scene()
scene.background = new THREE.Color(SKY)
const BASE_FOV = 56
const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.1, 4000)
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

scene.add(new THREE.HemisphereLight(0xffffff, 0x557b3a, 1.05))
const sun = new THREE.DirectionalLight(0xfff3d6, 1.5)
sun.position.set(6, 12, 6)
scene.add(sun)

// 影（丸ブロブ）・パーティクル・コインの共有素材
const blobGeo = new THREE.CircleGeometry(1, 20)
const blobMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.26, depthWrite: false })
function addBlob(parent: THREE.Object3D, radius: number, baseY: number) {
  const b = new THREE.Mesh(blobGeo, blobMat)
  b.rotation.x = -Math.PI / 2
  b.scale.setScalar(radius)
  b.position.y = 0.03 - baseY
  parent.add(b)
}
// 3Dパーティクル（コインのキラ／クラッシュの破片）
const partGeo = new THREE.BoxGeometry(1, 1, 1)
type Part = { m: THREE.Mesh; vx: number; vy: number; vz: number; life: number; max: number }
const parts: Part[] = []
for (let i = 0; i < 60; i++) {
  const m = new THREE.Mesh(partGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }))
  m.visible = false
  scene.add(m)
  parts.push({ m, vx: 0, vy: 0, vz: 0, life: 0, max: 1 })
}
function burst(x: number, y: number, z: number, n: number, color: number, spd: number, sz: number) {
  let c = 0
  for (const p of parts) {
    if (p.life > 0) continue
    const a = Math.random() * Math.PI * 2
    const up = 1 + Math.random() * 2
    p.m.position.set(x, y, z)
    p.m.scale.setScalar(sz * (0.6 + Math.random() * 0.8))
    ;(p.m.material as THREE.MeshLambertMaterial).color.setHex(color)
    p.vx = Math.cos(a) * spd
    p.vz = Math.sin(a) * spd
    p.vy = up * spd * 0.6
    p.life = p.max = 0.5 + Math.random() * 0.4
    p.m.visible = true
    if (++c >= n) break
  }
}

// ── 効果音 ──
let actx: AudioContext | null = null
let master: GainNode | null = null
let engOsc: OscillatorNode | null = null
let engGain: GainNode | null = null
function ensureAudio() {
  if (actx) return
  try {
    actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
    master = actx.createGain()
    master.gain.value = 0.4
    master.connect(actx.destination)
    configureMixedSession()
  } catch {}
}
function startEngine() {
  if (!actx || !master || engOsc) return
  engOsc = actx.createOscillator()
  engGain = actx.createGain()
  engOsc.type = 'sawtooth'
  engOsc.frequency.value = 70
  engGain.gain.value = isMuted() ? 0 : 0.05
  engOsc.connect(engGain).connect(master)
  engOsc.start()
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
  coin() {
    blip(880, 0.06, 'triangle', 0.08, 1320)
  },
  near() {
    blip(300, 0.2, 'sawtooth', 0.05, 1200)
  },
  crash() {
    blip(180, 0.5, 'sawtooth', 0.3, 45)
    blip(90, 0.5, 'triangle', 0.16, 40)
  },
  count(hi: boolean) {
    blip(hi ? 880 : 520, 0.12, 'triangle', 0.12)
  },
}

// ── ロード ──
const manager = new THREE.LoadingManager()
manager.setURLModifier((url) => (url.includes('colormap') ? colormapUrl : url))
const loader = new GLTFLoader(manager)
const load = (url: string) => loader.loadAsync(url).then((g) => g.scene)
const bboxSize = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
const bboxMinY = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).min.y

// ── 状態 ──
type Mode = 'title' | 'count' | 'play' | 'crash' | 'over'
let mode: Mode = 'title'
let segLen = 10
let halfW = 5
let laneX = 3
let carY = 0
let carLen = 2
let carW = 1.4
let speed = 0
let baseSpeed = 22
let dist = 0
let coinsGot = 0
let best = Number(localStorage.getItem('playlab.racer.best') || 0)
let targetX = 0
let crashT = 0
let countT = 0
let camShake = 0
let nextMile = 500

let roadProto: THREE.Object3D
let treeProto: THREE.Object3D
let carProtos: THREE.Object3D[] = []
const roadSegs: THREE.Object3D[] = []
const trees: THREE.Object3D[] = []
type Obs = { obj: THREE.Object3D; x: number; active: boolean; passed: boolean }
const obstacles: Obs[] = []
type Coin = { obj: THREE.Mesh; x: number; active: boolean }
const coins: Coin[] = []
let player: THREE.Object3D
let spawnZ = -80
let obsTimer = 0
let coinTimer = 0
const CAM_BACK = () => segLen * 1.3

function buildWorld() {
  scene.fog = new THREE.Fog(SKY, segLen * 3, segLen * 8.5)
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 24, segLen * 40), new THREE.MeshLambertMaterial({ color: 0x6ea84a }))
  ground.rotation.x = -Math.PI / 2
  ground.position.set(0, -0.02, -segLen * 12)
  scene.add(ground)

  const nSeg = Math.ceil((CAM_BACK() + segLen * 8) / segLen) + 2
  for (let i = 0; i < nSeg; i++) {
    const s = roadProto.clone()
    s.position.set(0, 0, CAM_BACK() - i * segLen)
    scene.add(s)
    roadSegs.push(s)
  }
  const nTree = 12
  for (let i = 0; i < nTree; i++) {
    for (const side of [-1, 1]) {
      const t = treeProto.clone()
      t.position.set(side * (halfW + 1.5 + Math.random() * 2), 0, CAM_BACK() - (i / nTree) * nSeg * segLen)
      scene.add(t)
      trees.push(t)
    }
  }
  for (let i = 0; i < 10; i++) {
    const obj = carProtos[i % carProtos.length].clone()
    obj.rotation.y = Math.PI
    addBlob(obj, carW * 0.75, carY)
    obj.visible = false
    scene.add(obj)
    obstacles.push({ obj, x: 0, active: false, passed: false })
  }
  // コイン
  const coinGeo = new THREE.CylinderGeometry(carW * 0.36, carW * 0.36, carW * 0.1, 18)
  const coinMat = new THREE.MeshStandardMaterial({ color: 0xffcf3a, metalness: 0.3, roughness: 0.35, emissive: 0x5a3d00, emissiveIntensity: 0.3 })
  for (let i = 0; i < 16; i++) {
    const c = new THREE.Mesh(coinGeo, coinMat)
    c.rotation.x = Math.PI / 2
    c.visible = false
    scene.add(c)
    coins.push({ obj: c, x: 0, active: false })
  }
  spawnZ = -Math.min(segLen * 8, 90)
}

function resetRun() {
  mode = 'count'
  countT = 1.9
  speed = 0
  baseSpeed = segLen * 2.4
  dist = 0
  coinsGot = 0
  targetX = 0
  crashT = 0
  camShake = 0
  nextMile = 500
  obsTimer = 1.2
  coinTimer = 1.6
  player.position.set(0, carY, 0)
  player.rotation.set(0, 0, 0)
  for (const o of obstacles) {
    o.active = false
    o.obj.visible = false
  }
  for (const c of coins) {
    c.active = false
    c.obj.visible = false
  }
  roadSegs.forEach((s, i) => (s.position.z = CAM_BACK() - i * segLen))
  show(uiTitle, false)
  show(uiOver, false)
  show(uiScore, true)
}

function toTitle() {
  mode = 'title'
  bigText.textContent = ''
  el('titleBest').textContent = best > 0 ? 'best ' + best + ' m' : ''
  show(uiTitle, true)
  show(uiOver, false)
  show(uiScore, false)
}

function spawnObs() {
  const o = obstacles.find((x) => !x.active)
  if (!o) return
  o.active = true
  o.passed = false
  o.obj.visible = true
  o.x = (Math.random() * 2 - 1) * laneX
  o.obj.position.set(o.x, carY, spawnZ)
}
function spawnCoins() {
  // レーンに沿って数枚（うねって取る＝リスク&リターン）
  const lane = (Math.random() * 2 - 1) * laneX
  let placed = 0
  for (const c of coins) {
    if (c.active || placed >= 4) continue
    c.active = true
    c.obj.visible = true
    c.x = clamp(lane + placed * (Math.random() * 0.6 - 0.3), -laneX, laneX)
    c.obj.position.set(c.x, carY + carW * 0.4, spawnZ - placed * carLen * 1.6)
    placed++
    if (placed >= 4) break
  }
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))

function startCrash() {
  mode = 'crash'
  crashT = 0
  camShake = 1.2
  SFX.crash()
  if (engGain) engGain.gain.value = 0
  burst(player.position.x, carY + 0.3, 0, 20, 0xbbbbbb, segLen * 1.4, carW * 0.28)
  burst(player.position.x, carY + 0.3, 0, 8, 0xcc3b2e, segLen * 1.2, carW * 0.24)
}

function finalizeOver() {
  mode = 'over'
  if (dist > best) {
    best = Math.floor(dist)
    localStorage.setItem('playlab.racer.best', String(best))
  }
  el('overScore').textContent = 'きょり ' + Math.floor(dist) + ' m ・ コイン ' + coinsGot
  el('overBest').textContent = Math.floor(dist) >= best && dist > 0 ? '自己ベスト更新！' : 'best ' + best + ' m'
  show(uiOver, true)
  show(uiScore, false)
}

function updateParts(dt: number) {
  for (const p of parts) {
    if (p.life <= 0) continue
    p.life -= dt
    p.m.position.x += p.vx * dt
    p.m.position.y += p.vy * dt
    p.m.position.z += p.vz * dt
    p.vy -= 20 * dt
    p.m.rotation.x += dt * 6
    p.m.rotation.y += dt * 5
    const s = clamp(p.life / p.max, 0, 1)
    p.m.scale.setScalar((p.m.scale.x || 0.2) * 0.001 + s * carW * 0.24)
    if (p.life <= 0 || p.m.position.y < -1) {
      p.life = 0
      p.m.visible = false
    }
  }
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now
  updateParts(dt)
  camShake = Math.max(0, camShake - dt * 2)

  if (mode === 'count') {
    countT -= dt
    const n = Math.ceil(countT - 0.9)
    bigText.textContent = countT <= 0.9 ? 'GO!' : String(Math.max(1, n))
    if (Math.abs(countT - Math.round(countT)) < dt && countT > 0.9) SFX.count(false)
    if (countT <= 0) {
      bigText.textContent = ''
      mode = 'play'
      speed = baseSpeed
      startEngine()
      SFX.count(true)
    }
  } else if (mode === 'play') {
    dist += (speed * dt) / 3
    speed += dt * segLen * 0.05
    if (ptr.down) targetX = ((ptr.x / window.innerWidth) * 2 - 1) * laneX
    player.position.x += (targetX - player.position.x) * Math.min(1, dt * 10)
    player.rotation.z = clamp((player.position.x - targetX) * 0.12, -0.35, 0.35)
    player.position.x = clamp(player.position.x, -laneX, laneX)

    const dz = speed * dt
    for (const s of roadSegs) {
      s.position.z += dz
      if (s.position.z > CAM_BACK() + segLen) s.position.z -= roadSegs.length * segLen
    }
    for (const t of trees) {
      t.position.z += dz
      if (t.position.z > CAM_BACK() + segLen) t.position.z -= trees.length * segLen * 0.5
    }
    // 障害
    obsTimer -= dt
    if (obsTimer <= 0) {
      spawnObs()
      obsTimer = clamp(1.4 - dist * 0.002, 0.45, 1.4)
    }
    for (const o of obstacles) {
      if (!o.active) continue
      o.obj.position.z += dz * 0.72
      const dx = Math.abs(o.x - player.position.x)
      if (Math.abs(o.obj.position.z) < carLen * 0.85 && dx < carW * 0.82) {
        startCrash()
      }
      if (!o.passed && o.obj.position.z > carLen) {
        o.passed = true
        if (dx < carW * 1.7) {
          dist += 20
          camShake = Math.max(camShake, 0.4)
          popup('ニアミス！ +20', '#d2622a')
          SFX.near()
        }
      }
      if (o.obj.position.z > CAM_BACK() + segLen) {
        o.active = false
        o.obj.visible = false
      }
    }
    // コイン
    coinTimer -= dt
    if (coinTimer <= 0) {
      spawnCoins()
      coinTimer = clamp(2.4 - dist * 0.001, 1.1, 2.4)
    }
    for (const c of coins) {
      if (!c.active) continue
      c.obj.position.z += dz
      c.obj.rotation.y += dt * 5
      if (Math.abs(c.obj.position.z) < carLen * 0.8 && Math.abs(c.x - player.position.x) < carW * 0.8) {
        c.active = false
        c.obj.visible = false
        coinsGot++
        dist += 5
        SFX.coin()
        burst(c.x, carY + carW * 0.4, 0, 6, 0xffcf3a, segLen * 0.8, carW * 0.16)
      } else if (c.obj.position.z > CAM_BACK() + segLen) {
        c.active = false
        c.obj.visible = false
      }
    }
    // マイルストーン
    if (dist >= nextMile) {
      popup(nextMile + ' m！', '#2f7d6b')
      nextMile += 500
    }
    if (engOsc) engOsc.frequency.value = 70 + Math.min(speed * 2.2, 190)
    uiScore.textContent = Math.floor(dist) + ' m　◎' + coinsGot
  } else if (mode === 'crash') {
    crashT += dt
    // 自車が吹っ飛んで回転
    player.rotation.y += dt * 9
    player.rotation.x += dt * 7
    player.position.y = carY + Math.max(0, Math.sin(clamp(crashT * 2.4, 0, Math.PI)) * 2)
    if (crashT > 1.1) finalizeOver()
  }

  // カメラ：速度でFOVを広げてスピード感、揺れ
  const targetFov = BASE_FOV + (mode === 'play' ? clamp((speed - baseSpeed) * 0.5, 0, 12) : 0)
  camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 4)
  camera.updateProjectionMatrix()
  const px = player ? player.position.x : 0
  const sh = camShake + (mode === 'play' ? Math.min(speed * 0.006, 0.12) : 0)
  camera.position.set(px * 0.4 + (Math.random() * 2 - 1) * sh, halfW * 1.15 + (Math.random() * 2 - 1) * sh, CAM_BACK())
  camera.lookAt(px * 0.2, halfW * 0.25, -segLen * 2.5)

  renderer.render(scene, camera)
  ptrh.endFrame()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', () => {
  unlockAudio()
  if (mode === 'title') resetRun()
  else if (mode === 'over' && crashT > 1.4) toTitle()
})

async function main() {
  const [road, pl, ca, cb, tr] = await Promise.all([load(roadUrl), load(playerUrl), load(carAUrl), load(carBUrl), load(treeUrl)])
  roadProto = road
  treeProto = tr
  carProtos = [ca, cb]
  const rs = bboxSize(road)
  segLen = rs.z || 10
  halfW = (rs.x || 10) / 2
  laneX = halfW * 0.6
  const ps = bboxSize(pl)
  carLen = ps.z || 2
  carW = ps.x || 1.4
  carY = -bboxMinY(pl)
  player = pl
  player.rotation.y = 0
  player.position.set(0, carY, 0)
  addBlob(player, carW * 0.8, carY)
  scene.add(player)
  buildWorld()

  show(uiLoading, false)
  if (SHOT === '1') {
    resetRun()
    mode = 'play'
    speed = baseSpeed * 1.6
    targetX = -laneX * 0.4
    player.position.x = -laneX * 0.4
    startEngine()
    obstacles[0].active = true
    obstacles[0].obj.visible = true
    obstacles[0].x = laneX * 0.5
    obstacles[0].obj.position.set(laneX * 0.5, carY, -segLen * 1.2)
    obstacles[1].active = true
    obstacles[1].obj.visible = true
    obstacles[1].x = -laneX * 0.2
    obstacles[1].obj.position.set(-laneX * 0.2, carY, -segLen * 2.6)
    for (let i = 0; i < 3; i++) {
      coins[i].active = true
      coins[i].obj.visible = true
      coins[i].x = -laneX * 0.4
      coins[i].obj.position.set(-laneX * 0.4, carY + carW * 0.4, -segLen * (0.8 + i * 0.7))
    }
    dist = 340
    coinsGot = 7
    uiScore.textContent = '340 m　◎7'
  } else {
    toTitle()
  }
  requestAnimationFrame(frame)
}
main()
