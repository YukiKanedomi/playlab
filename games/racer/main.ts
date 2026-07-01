// games/racer/main.ts — Playlab No.06「はしって、よけて。」
// 3D初挑戦：three.js ＋ Kenney(CC0) の低ポリ3Dモデルでエンドレス・ドライバー。
// まっすぐの道を走り、迫る車や木をよけて距離をのばす。素材一覧は LICENSES.md。
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
const show = (n: HTMLElement, v: boolean) => n.classList.toggle('hidden', !v)

// ── three.js 基本 ──
const SKY = 0xbfe3ff
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
const scene = new THREE.Scene()
scene.background = new THREE.Color(SKY)
const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 2000)
function resize() {
  const w = window.innerWidth
  const h = window.innerHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / h
  camera.updateProjectionMatrix()
}
window.addEventListener('resize', resize)
resize()

// ライト
scene.add(new THREE.HemisphereLight(0xffffff, 0x557b3a, 1.05))
const sun = new THREE.DirectionalLight(0xfff3d6, 1.5)
sun.position.set(6, 12, 6)
scene.add(sun)

// ── 効果音（合成・ミュート対応） ──
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
function crashSfx() {
  if (!actx || !master || isMuted()) return
  const t = actx.currentTime
  const o = actx.createOscillator()
  const g = actx.createGain()
  o.type = 'sawtooth'
  o.frequency.setValueAtTime(180, t)
  o.frequency.exponentialRampToValueAtTime(50, t + 0.4)
  g.gain.setValueAtTime(0.3, t)
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + 0.5)
}

// ── ロード ──
// GLBは外部テクスチャ Textures/colormap.png を参照するので、バンドル済みURLへ差し替える
const manager = new THREE.LoadingManager()
manager.setURLModifier((url) => (url.includes('colormap') ? colormapUrl : url))
const loader = new GLTFLoader(manager)
const load = (url: string) => loader.loadAsync(url).then((g) => g.scene)
const bboxSize = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3())
const bboxMinY = (o: THREE.Object3D) => new THREE.Box3().setFromObject(o).min.y

// ── ゲーム状態 ──
type Mode = 'title' | 'play' | 'over'
let mode: Mode = 'title'
let segLen = 10
let halfW = 5
let laneX = 3
let carY = 0
let carLen = 2
let carW = 1.4
let speed = 0
let dist = 0
let best = Number(localStorage.getItem('playlab.racer.best') || 0)
let targetX = 0
let crashT = 0

let roadProto: THREE.Object3D
let treeProto: THREE.Object3D
let carProtos: THREE.Object3D[] = []
const roadSegs: THREE.Object3D[] = []
const trees: THREE.Object3D[] = []
type Obs = { obj: THREE.Object3D; x: number; active: boolean }
const obstacles: Obs[] = []
let player: THREE.Object3D
let spawnZ = -80
let obsTimer = 0
const CAM_BACK = () => segLen * 1.3

function buildWorld() {
  // 地面（草）
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(halfW * 20, segLen * 40),
    new THREE.MeshLambertMaterial({ color: 0x6ea84a }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.02
  ground.position.z = -segLen * 12
  scene.add(ground)

  // 道タイル
  const nSeg = Math.ceil((CAM_BACK() + segLen * 8) / segLen) + 2
  for (let i = 0; i < nSeg; i++) {
    const s = roadProto.clone()
    s.position.set(0, 0, CAM_BACK() - i * segLen)
    scene.add(s)
    roadSegs.push(s)
  }
  // 木（両側・数個ずつ）
  const nTree = 10
  for (let i = 0; i < nTree; i++) {
    for (const side of [-1, 1]) {
      const t = treeProto.clone()
      const tScale = 1
      t.scale.setScalar(tScale)
      t.position.set(side * (halfW + 1.5 + Math.random() * 2), 0, CAM_BACK() - (i / nTree) * nSeg * segLen)
      scene.add(t)
      trees.push(t)
    }
  }
  // 障害プール
  for (let i = 0; i < 10; i++) {
    const obj = carProtos[i % carProtos.length].clone()
    obj.rotation.y = Math.PI // こちらへ向かってくる（自車と逆向き）
    obj.visible = false
    scene.add(obj)
    obstacles.push({ obj, x: 0, active: false })
  }
  spawnZ = -(camera.far > 0 ? Math.min(segLen * 8, 90) : 90)
}

function resetRun() {
  mode = 'play'
  speed = segLen * 2.2
  dist = 0
  targetX = 0
  crashT = 0
  obsTimer = 0.8
  player.position.set(0, carY, 0)
  player.rotation.z = 0
  for (const o of obstacles) {
    o.active = false
    o.obj.visible = false
  }
  // 道と木を初期配置に戻す
  roadSegs.forEach((s, i) => (s.position.z = CAM_BACK() - i * segLen))
  trees.forEach((t, i) => (t.position.z = CAM_BACK() - (i / 2) * segLen * 1.6))
  show(uiTitle, false)
  show(uiOver, false)
  show(uiScore, true)
  startEngine()
}

function toTitle() {
  mode = 'title'
  show(uiTitle, true)
  show(uiOver, false)
  show(uiScore, false)
}

function spawnObs() {
  const o = obstacles.find((x) => !x.active)
  if (!o) return
  o.active = true
  o.obj.visible = true
  o.x = (Math.random() * 2 - 1) * laneX
  o.obj.position.set(o.x, carY, spawnZ)
}

function crash() {
  mode = 'over'
  crashT = 0
  crashSfx()
  if (engGain) engGain.gain.value = 0
  if (dist > best) {
    best = Math.floor(dist)
    localStorage.setItem('playlab.racer.best', String(best))
  }
  el('overScore').textContent = 'きょり ' + Math.floor(dist) + ' m'
  el('overBest').textContent = Math.floor(dist) >= best && dist > 0 ? '自己ベスト更新！' : 'best ' + best + ' m'
  show(uiOver, true)
  show(uiScore, false)
}

let last = performance.now()
function frame(now: number) {
  const dt = Math.min(0.033, (now - last) / 1000)
  last = now

  if (mode === 'play') {
    dist += (speed * dt) / 3
    speed += dt * segLen * 0.06 // じわじわ加速
    // ステア
    if (ptr.down) targetX = ((ptr.x / window.innerWidth) * 2 - 1) * laneX
    player.position.x += (targetX - player.position.x) * Math.min(1, dt * 10)
    player.rotation.z = (player.position.x - targetX) * 0.15 // 傾き
    player.position.x = Math.max(-laneX, Math.min(laneX, player.position.x))

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
      obsTimer = Math.max(0.5, 1.4 - dist * 0.002)
    }
    for (const o of obstacles) {
      if (!o.active) continue
      o.obj.position.z += dz * 0.7 // 少し遅い＝相対的に近づく
      if (o.obj.position.z > CAM_BACK() + segLen) {
        o.active = false
        o.obj.visible = false
        continue
      }
      // 衝突判定（自車 z=0 付近）
      if (Math.abs(o.obj.position.z) < carLen * 0.85 && Math.abs(o.x - player.position.x) < carW * 0.85) {
        crash()
      }
    }
    // エンジン音を速度で
    if (engOsc) engOsc.frequency.value = 70 + Math.min(speed * 2.2, 180)
    uiScore.textContent = Math.floor(dist) + ' m'
  } else if (mode === 'over') {
    crashT += dt
  }

  // カメラは自車の少し後ろ上から
  const px = player ? player.position.x : 0
  camera.position.set(px * 0.4, halfW * 1.15, CAM_BACK())
  camera.lookAt(px * 0.2, halfW * 0.25, -segLen * 2.5)
  if (mode === 'over') camera.position.x += Math.sin(crashT * 40) * Math.max(0, 0.4 - crashT) // 軽い揺れ

  renderer.render(scene, camera)
  ptrh.endFrame()
  requestAnimationFrame(frame)
}

canvas.addEventListener('pointerdown', () => {
  unlockAudio()
  if (mode === 'title') resetRun()
  else if (mode === 'over' && crashT > 0.5) toTitle()
})

async function main() {
  const [road, pl, ca, cb, tr] = await Promise.all([load(roadUrl), load(playerUrl), load(carAUrl), load(carBUrl), load(treeUrl)])
  roadProto = road
  treeProto = tr
  carProtos = [ca, cb]
  // 寸法測定（キットのスケールに依存しない配置）
  const rs = bboxSize(road)
  segLen = rs.z || 10
  halfW = (rs.x || 10) / 2
  laneX = halfW * 0.6
  const ps = bboxSize(pl)
  carLen = ps.z || 2
  carW = ps.x || 1.4
  carY = -bboxMinY(pl)
  // 自車
  player = pl
  player.rotation.y = 0 // 前（-Z）を向く想定。逆なら Math.PI
  player.position.set(0, carY, 0)
  scene.add(player)
  buildWorld()

  show(uiLoading, false)
  if (SHOT === '1') {
    resetRun()
    // それっぽい配置
    targetX = -laneX * 0.4
    player.position.x = -laneX * 0.4
    obstacles[0].active = true
    obstacles[0].obj.visible = true
    obstacles[0].x = laneX * 0.5
    obstacles[0].obj.position.set(laneX * 0.5, carY, -segLen * 1.2)
    obstacles[1].active = true
    obstacles[1].obj.visible = true
    obstacles[1].x = -laneX * 0.2
    obstacles[1].obj.position.set(-laneX * 0.2, carY, -segLen * 2.6)
    dist = 340
    uiScore.textContent = '340 m'
    mode = 'play'
  } else {
    toTitle()
  }
  requestAnimationFrame(frame)
}
main()
