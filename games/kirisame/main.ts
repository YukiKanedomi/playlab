// 『霧雨館の一夜』エンジン — DOMベースの推理ADV。
// say/menu/尋問(つきつけ)のプリミティブを Promise で書き、進行はシナリオ順に await で流す。
import { wireLink } from '../../shared/transition'
import { isMuted, mountMuteButton, configureMixedSession, onMuteChange } from '../../shared/audio'
import {
  CHARS, EVIDENCE, INTRO, SPOTS1, SPOTS2, T1, T2, T3,
  ACCUSE_PRE, ACCUSE_WRONG, ACCUSE_RIGHT, SHOWDOWN_PRE, SHOWDOWN, CONFESSION, EPILOGUE, BADEND,
  type Line, type Spot, type Testimony,
} from './scenario'

document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
mountMuteButton()

const $ = (id: string) => document.getElementById(id)!
const stage = $('stage')
const bgEl = $('bg')
const rainEl = $('rain')
const flashEl = $('flash')
const portraitEl = $('portrait') as unknown as SVGSVGElement
const lifeEl = $('life')
const evbtn = $('evbtn') as HTMLButtonElement
const teshead = $('teshead')
const btnrow = $('btnrow')
const nameplate = $('nameplate')
const textEl = $('text')
const cursorEl = $('cursor')
const evmodal = $('evmodal')
const evgrid = $('evgrid')
const evdetail = $('evdetail')
const evpresent = $('evpresent') as HTMLButtonElement
const evclose = $('evclose') as HTMLButtonElement
const toastEl = $('toast')
const mattaEl = $('matta')
const titleEl = $('title')
const finEl = $('fin')
const SHOT = new URLSearchParams(location.search).get('shot')

// ── 立ち絵（掛け軸に墨の影絵） ──
const SCROLL = (inner: string) => `
  <rect x="12" y="0" width="76" height="5" rx="2.4" fill="#2a2d36"/>
  <rect x="12" y="113" width="76" height="5" rx="2.4" fill="#2a2d36"/>
  <rect x="20" y="4" width="60" height="110" fill="#efe7d3"/>
  <rect x="20" y="4" width="60" height="110" fill="none" stroke="#c9bda0" stroke-width="1"/>
  ${inner}`
const PORTRAITS: Record<string, string> = {
  chiyo: SCROLL(`
    <ellipse cx="50" cy="23" rx="10" ry="7" fill="#23262e"/>
    <rect x="56" y="13" width="20" height="2.6" rx="1.3" transform="rotate(20 56 13)" fill="${CHARS.chiyo.accent}"/>
    <circle cx="50" cy="34" r="11" fill="#23262e"/>
    <path d="M50 45 C40 46 33 53 31 62 L28 112 H72 L69 62 C67 53 60 46 50 45z" fill="#23262e"/>
    <path d="M42 60 L50 75 L58 60" stroke="${CHARS.chiyo.accent}" stroke-width="3" fill="none"/>`),
  sonoda: SCROLL(`
    <circle cx="50" cy="31" r="13" fill="#23262e"/>
    <rect x="37" y="25" width="26" height="4.6" fill="${CHARS.sonoda.accent}"/>
    <path d="M50 45 C34 47 26 56 24 70 L22 112 H78 L76 70 C74 56 66 47 50 45z" fill="#23262e"/>
    <path d="M36 84 H64" stroke="${CHARS.sonoda.accent}" stroke-width="3"/>`),
  hakusen: SCROLL(`
    <ellipse cx="50" cy="29" rx="9" ry="11" fill="#23262e"/>
    <path d="M43 37 L50 66 L57 37 z" fill="#23262e"/>
    <path d="M50 45 C41 47 36 55 35 64 L33 112 H67 L65 64 C64 55 59 47 50 45z" fill="#23262e"/>
    <path d="M38 82 L62 72" stroke="${CHARS.hakusen.accent}" stroke-width="3"/>`),
  shizuku: SCROLL(`
    <circle cx="50" cy="37" r="10" fill="#23262e"/>
    <circle cx="60" cy="29" r="5.4" fill="#23262e"/>
    <path d="M50 48 C42 49 36 56 34 64 L32 112 H68 L66 64 C64 56 58 49 50 48z" fill="#23262e"/>
    <path d="M40 78 L60 88 M60 78 L40 88" stroke="${CHARS.shizuku.accent}" stroke-width="2.6"/>`),
}

// ── 効果音（合成・控えめ） ──
let actx: AudioContext | null = null
let master: GainNode | null = null
let rainGain: GainNode | null = null
function ensureAudio() {
  if (actx) return
  try {
    actx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' })
    master = actx.createGain()
    master.gain.value = 0.5
    master.connect(actx.destination)
    configureMixedSession()
    // 雨（ノイズをローパスでけむらせる）
    const len = actx.sampleRate * 2
    const buf = actx.createBuffer(1, len, actx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
    const src = actx.createBufferSource()
    src.buffer = buf
    src.loop = true
    const lp = actx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 420
    rainGain = actx.createGain()
    rainGain.gain.value = isMuted() ? 0 : 0.05
    src.connect(lp).connect(rainGain).connect(master)
    src.start()
  } catch {}
}
onMuteChange((m) => {
  if (rainGain) rainGain.gain.value = m ? 0 : rainOn ? 0.05 : 0.015
})
function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) {
  if (!actx || !master || isMuted()) return
  const t = actx.currentTime + delay
  const o = actx.createOscillator()
  const g = actx.createGain()
  o.type = type
  o.frequency.setValueAtTime(freq, t)
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t + dur)
  g.gain.setValueAtTime(0.0001, t)
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur)
  o.connect(g).connect(master)
  o.start(t)
  o.stop(t + dur + 0.03)
}
const SFX = {
  tick() { tone(1500, 0.015, 'triangle', 0.012) },
  page() { tone(660, 0.05, 'triangle', 0.05) },
  gain() { tone(740, 0.09, 'triangle', 0.09); tone(1108, 0.12, 'triangle', 0.08, undefined, 0.09) },
  matta() { tone(220, 0.16, 'sawtooth', 0.16, 440); tone(440, 0.3, 'square', 0.1, 880, 0.1) },
  damage() { tone(160, 0.3, 'sawtooth', 0.16, 60) },
  thunder() {
    if (!actx || !master || isMuted()) return
    const t = actx.currentTime
    const len = actx.sampleRate * 1.2
    const buf = actx.createBuffer(1, len, actx.sampleRate)
    const d = buf.getChannelData(0)
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.4)
    const src = actx.createBufferSource()
    src.buffer = buf
    const lp = actx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 180
    const g = actx.createGain()
    g.gain.value = 0.5
    src.connect(lp).connect(g).connect(master)
    src.start(t)
  },
}

// ── 状態 ──
const have = new Set<string>()
let life = 5
let missCount = 0
let locNow = 'title'
let rainOn = true
const SAVE_KEY = 'playlab.kirisame.v1'
function save(ph: number) {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ph, ev: [...have], life, miss: missCount }))
}
function loadSave(): { ph: number; ev: string[]; life: number; miss: number } | null {
  try {
    const s = localStorage.getItem(SAVE_KEY)
    if (!s) return null
    const d = JSON.parse(s)
    return typeof d.ph === 'number' && d.ph > 0 ? d : null
  } catch { return null }
}

function renderLife() {
  lifeEl.innerHTML = ''
  for (let i = 0; i < 5; i++) {
    const dot = document.createElement('i')
    if (i >= life) dot.className = 'off'
    lifeEl.appendChild(dot)
  }
}
function setLoc(loc: string) {
  locNow = loc
  bgEl.className = 'loc-' + loc
  setRain(loc === 'title' || loc === 'roka')
  setPortrait(null)
}
function setRain(on: boolean) {
  rainOn = on
  rainEl.classList.toggle('on', on)
  if (rainGain && !isMuted()) rainGain.gain.value = on ? 0.05 : 0.015
}
function setPortrait(who: string | null, dim = false) {
  if (!who || !PORTRAITS[who]) {
    portraitEl.classList.remove('on')
    return
  }
  portraitEl.innerHTML = PORTRAITS[who]
  portraitEl.classList.add('on')
  portraitEl.classList.toggle('dim', dim)
}

// ── タップ待ち ──
let tapResolver: (() => void) | null = null
let typing = false
let typeSkip = false
stage.addEventListener('pointerdown', (e) => {
  ensureAudio()
  const t = e.target as HTMLElement
  if (t.closest('#btnrow') || t.closest('#evmodal') || t.closest('#evbtn') || t.closest('#title') || t.closest('#fin')) return
  if (typing) { typeSkip = true; return }
  if (tapResolver) { const r = tapResolver; tapResolver = null; r() }
})
const waitTap = () => new Promise<void>((res) => { tapResolver = res })
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

async function typeLine(line: Line) {
  const who = line.s
  typing = true
  typeSkip = !!SHOT
  cursorEl.classList.remove('on')
  if (who) {
    nameplate.classList.remove('hide')
    nameplate.textContent = CHARS[who].name
    nameplate.style.setProperty('--acc', CHARS[who].accent)
    textEl.className = ''
    setPortrait(who === 'watashi' ? null : who)
  } else {
    nameplate.classList.add('hide')
    textEl.className = 'mono'
    setPortrait(null)
  }
  textEl.textContent = ''
  for (let i = 0; i < line.t.length; i++) {
    if (typeSkip) { textEl.textContent = line.t; break }
    textEl.textContent += line.t[i]
    if (i % 3 === 0) SFX.tick()
    await sleep(26)
  }
  typing = false
  typeSkip = false
  cursorEl.classList.add('on')
}
async function say(lines: Line[]) {
  btnrow.innerHTML = ''
  for (const line of lines) {
    await typeLine(line)
    if (SHOT) return
    await waitTap()
    SFX.page()
  }
  cursorEl.classList.remove('on')
}

function buttons(defs: { label: string; cls?: string; val: string }[]): Promise<string> {
  return new Promise((res) => {
    btnrow.innerHTML = ''
    for (const d of defs) {
      const b = document.createElement('button')
      b.textContent = d.label
      if (d.cls) b.className = d.cls
      b.addEventListener('pointerdown', (e) => e.stopPropagation())
      b.addEventListener('click', () => { btnrow.innerHTML = ''; SFX.page(); res(d.val) })
      btnrow.appendChild(b)
    }
  })
}
async function menu(title: string, options: string[]): Promise<number> {
  teshead.innerHTML = title
  teshead.classList.add('on')
  cursorEl.classList.remove('on')
  const v = await buttons(options.map((o, i) => ({ label: o, cls: 'wide', val: String(i) })))
  teshead.classList.remove('on')
  return Number(v)
}

// ── 証拠 ──
function toast(msg: string) {
  toastEl.textContent = msg
  toastEl.classList.add('on')
  setTimeout(() => toastEl.classList.remove('on'), 1700)
}
async function gainEv(id: string) {
  if (have.has(id)) return
  have.add(id)
  SFX.gain()
  toast('証拠を手に入れた —『' + EVIDENCE[id].name + '』')
  evbtn.classList.add('pulse')
  setTimeout(() => evbtn.classList.remove('pulse'), 1900)
  await sleep(1150)
}
let evPickResolver: ((id: string | null) => void) | null = null
let evSelected: string | null = null
function openEvidence(pick: boolean): Promise<string | null> {
  evSelected = null
  evdetail.classList.remove('on')
  evpresent.classList.remove('on')
  evgrid.innerHTML = ''
  for (const id of Object.keys(EVIDENCE)) {
    if (!have.has(id)) continue
    const e = EVIDENCE[id]
    const b = document.createElement('button')
    b.className = 'evitem'
    b.innerHTML = `<span class="mk">${e.mark}</span><span class="nm">${e.name}</span>`
    b.addEventListener('click', () => {
      evSelected = id
      evdetail.innerHTML = `<b>${e.name}</b>　${e.desc}`
      evdetail.classList.add('on')
      if (pick) evpresent.classList.add('on')
      SFX.page()
    })
    evgrid.appendChild(b)
  }
  evmodal.classList.add('on')
  return new Promise((res) => { evPickResolver = res })
}
function closeEvidence(result: string | null) {
  evmodal.classList.remove('on')
  const r = evPickResolver
  evPickResolver = null
  if (r) r(result)
}
evclose.addEventListener('click', () => closeEvidence(null))
evpresent.addEventListener('click', () => closeEvidence(evSelected))
evbtn.addEventListener('click', () => {
  if (evmodal.classList.contains('on') || evPickResolver) return
  openEvidence(false)
})

async function matta() {
  SFX.matta()
  mattaEl.classList.add('on')
  flashEl.classList.remove('hit')
  void flashEl.offsetWidth
  flashEl.classList.add('hit')
  await sleep(1000)
  mattaEl.classList.remove('on')
}
async function damage(): Promise<boolean> {
  life--
  missCount++
  SFX.damage()
  renderLife()
  await sleep(500)
  if (life > 0) return false
  await say(BADEND)
  life = 3
  renderLife()
  return true
}

// ── 捜査 ──
async function investigate(spots: Spot[], header: string, baseLoc: string) {
  const visited = new Set<string>()
  while (visited.size < spots.length) {
    setLoc(baseLoc)
    const i = await menu(header, spots.map((s) => (visited.has(s.id) ? '〔済〕' : '') + s.label))
    const sp = spots[i]
    setLoc(sp.loc)
    await say(sp.lines)
    if (!visited.has(sp.id) && sp.give) for (const id of sp.give) await gainEv(id)
    visited.add(sp.id)
  }
}

// ── 尋問 ──
async function testimony(T: Testimony) {
  setLoc(T.loc)
  await say(T.pre)
  const n = T.st.length
  let i = 0
  while (true) {
    const st = T.st[i]
    teshead.innerHTML = `${T.title}　<b>${i + 1}</b>／${n}`
    teshead.classList.add('on')
    await typeLine({ s: T.who, t: st.t })
    const act = await buttons([
      { label: '◀', val: 'prev' },
      { label: '▶', val: 'next' },
      { label: 'ゆさぶる', cls: 'sumi', val: 'press' },
      { label: 'つきつける', cls: 'aka', val: 'present' },
    ])
    if (act === 'prev') i = (i - 1 + n) % n
    else if (act === 'next') i = (i + 1) % n
    else if (act === 'press') {
      teshead.classList.remove('on')
      await say(st.press)
    } else {
      const id = await openEvidence(true)
      if (id == null) continue
      teshead.classList.remove('on')
      if (st.ev && st.ev.includes(id)) {
        await matta()
        await say(st.hit ?? [])
        break
      }
      await say(T.miss)
      await damage()
    }
  }
  teshead.classList.remove('on')
  if (T.post.length) await say(T.post)
}

// ── 追撃問答 ──
async function showdown() {
  await say(SHOWDOWN_PRE)
  for (const step of SHOWDOWN) {
    await say(step.q)
    while (true) {
      teshead.innerHTML = step.prompt
      teshead.classList.add('on')
      const v = await buttons([{ label: '証拠を、つきつける', cls: 'aka wide', val: 'go' }])
      void v
      const id = await openEvidence(true)
      teshead.classList.remove('on')
      if (id == null) continue
      if (step.accept.includes(id)) {
        await matta()
        await say(step.hit)
        break
      }
      await say(step.wrong)
      await damage()
    }
  }
}

// ── 告発 ──
async function accuse() {
  setLoc('choba')
  await say(ACCUSE_PRE)
  const names = ['chiyo', 'sonoda', 'hakusen', 'shizuku']
  while (true) {
    const i = await menu('犯人は——', names.map((c) => CHARS[c].name))
    if (names[i] === 'hakusen') break
    await say(ACCUSE_WRONG)
    await damage()
  }
  setLoc('hagi')
  await matta()
  await say(ACCUSE_RIGHT)
}

// ── 進行 ──
const PHASES: (() => Promise<void>)[] = [
  async () => { setLoc('roka'); await say(INTRO) },
  async () => { await investigate(SPOTS1, '— どこを調べる？ —', 'roka') },
  async () => { await testimony(T1) },
  async () => { await testimony(T2) },
  async () => { await investigate(SPOTS2, '— もう一度、館を調べる —', 'roka') },
  async () => { await accuse() },
  async () => { await testimony(T3); await showdown(); await say(CONFESSION) },
  async () => { setLoc('title'); setRain(false); await say(EPILOGUE) },
]

async function run(from: number) {
  evbtn.style.display = ''
  lifeEl.style.display = ''
  $('ui').style.display = ''
  renderLife()
  for (let p = from; p < PHASES.length; p++) {
    await PHASES[p]()
    save(p + 1)
  }
  localStorage.removeItem(SAVE_KEY)
  $('finstat').textContent = missCount === 0 ? '完全推理 — 白玉を、ひとつも落とさなかった' : `しくじり ${missCount} 回 ・ 残り白玉 ${life}`
  finEl.classList.add('on')
}

// ── タイトル ──
function showTitle() {
  setLoc('title')
  evbtn.style.display = 'none'
  lifeEl.style.display = 'none'
  $('ui').style.display = 'none'
  textEl.textContent = ''
  nameplate.classList.add('hide')
  cursorEl.classList.remove('on')
  titleEl.classList.remove('hide')
  const menuBox = titleEl.querySelector('.menu')!
  menuBox.innerHTML = ''
  const saved = loadSave()
  const mk = (label: string, fn: () => void) => {
    const b = document.createElement('button')
    b.textContent = label
    b.addEventListener('click', () => { ensureAudio(); fn() })
    menuBox.appendChild(b)
  }
  if (saved) {
    mk('つづきから', () => {
      have.clear()
      saved.ev.forEach((id) => have.add(id))
      life = saved.life
      missCount = saved.miss || 0
      titleEl.classList.add('hide')
      run(saved.ph)
    })
  }
  mk('はじめから', () => {
    have.clear()
    life = 5
    missCount = 0
    localStorage.removeItem(SAVE_KEY)
    titleEl.classList.add('hide')
    run(0)
  })
}
$('finback').addEventListener('click', () => {
  finEl.classList.remove('on')
  showTitle()
})

// 雷（タイトル・渡り廊下でときどき）
setInterval(() => {
  if (locNow !== 'title' && locNow !== 'roka') return
  if (Math.random() < 0.5) return
  flashEl.classList.remove('hit')
  void flashEl.offsetWidth
  flashEl.classList.add('hit')
  SFX.thunder()
}, 7000)

showTitle()
// 検証・サムネ用ショットモード（'1'=タイトル / 'play'=捜査メニュー / 't1'=尋問画面）
// このマシンのヘッドレスCrはビューポート(478px)よりスクショ(=window-size)が狭く右が切れるため、
// SHOT時は stage を撮影領域に固定して全UIを写す（実機には無関係）。
if (SHOT) {
  const q = new URLSearchParams(location.search)
  const w = Number(q.get('w') || 390)
  const h = Number(q.get('h') || 844)
  stage.style.width = w + 'px'
  stage.style.height = h + 'px'
  stage.style.right = 'auto'
  stage.style.bottom = 'auto'
}
if (SHOT === 'play') {
  titleEl.classList.add('hide')
  run(0)
} else if (SHOT === 't1') {
  titleEl.classList.add('hide')
  Object.keys(EVIDENCE).forEach((id) => have.add(id))
  evbtn.style.display = ''
  lifeEl.style.display = ''
  $('ui').style.display = ''
  renderLife()
  testimony(T1)
}
