// games/bakefuda/main.ts
// Game flow, animation, audio, UI. DOM-based — no canvas.

import { isMuted, mountMuteButton, configureMixedSession } from '../../shared/audio'
import * as tune from '../../shared/tune'
import { enterTransition, wireLink } from '../../shared/transition'
import {
  type Card, type BakeFuda, type BossId, type RoleId, type Kind,
  makeDeck, shuffle, calcScore, calcReward,
  availableBake, shopOffer, sellPrice, hasBake,
  NIGHT_TARGETS, NIGHT_BOSS, BOSS_NAME, BOSS_DESC,
  ROLE_NAME, ROLE_MULTI,
} from './data'
import { cardImgUrl } from './cards'

// ── Tune parameters ────────────────────────────────────────────────────────
const P = tune.panel('bakefuda', {
  TARGET_MUL: { v: 1,   min: 0.5, max: 2,  step: 0.05, label: '目標文倍率',   group: 'バランス' },
  PLAYS:      { v: 4,   min: 2,   max: 6,  step: 1,    label: '出し回数/夜',  group: 'バランス' },
  DISCARDS:   { v: 3,   min: 0,   max: 6,  step: 1,    label: '流し回数/夜',  group: 'バランス' },
  HAND:       { v: 8,   min: 6,   max: 10, step: 1,    label: '手札枚数',     group: 'バランス' },
  PRICE_MUL:  { v: 1,   min: 0.5, max: 2,  step: 0.05, label: '茶屋値段倍率', group: 'バランス' },
}, { version: 1 })

// ── Constants ─────────────────────────────────────────────────────────────
const NIGHT_NAMES = ['第一夜','第二夜','第三夜','第四夜','第五夜','第六夜','第七夜','第八夜']
const LS_YOKKA    = 'playlab.bakefuda.yokka'
const LS_RECORD   = 'playlab.bakefuda.record'
const LS_TUTORED  = 'playlab.bakefuda.tutored'
const MAX_BAKE    = 5

const TUTORIAL_SLIDES = [
  '札には 文（もん）がある。<br>光 <b>20</b> · タネ <b>10</b> · 短冊 <b>5</b> · カス <b>1</b>',
  '同じ月、そろいの光——<br>ならべて出すと役。倍率が 化ける',
  'えらべば その場で点が見える。<br>まよったら、帳面 を開くべし',
]

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = (id: string): HTMLElement => document.getElementById(id)!

const stage          = $('stage')
const scrTitle       = $('scr-title')
const scrNight       = $('scr-night')
const scrShop        = $('scr-shop')
const scrResult      = $('scr-result')
const toastEl        = $('toast')

const statRecord     = $('stat-record')
const statYokka      = $('stat-yokka')
const titleUnlock    = $('title-unlock')
const btnStart       = $('btn-start') as HTMLButtonElement
const btnTechoTitle  = $('btn-techo-title') as HTMLButtonElement

const nightRound     = $('night-round')
const targetPts      = $('target-pts')
const targetSuffix   = $('target-suffix')
const gaugeFill      = $('gauge-fill')
const gaugeText      = $('gauge-text')
const gaugeBar       = $('gauge-bar')
const bossBar        = $('boss-bar')
const btnTecho       = $('btn-techo') as HTMLButtonElement
const multiFlash     = $('multi-flash')
const playCardsRow   = $('play-cards-row')
const roleStamp      = $('role-stamp')
const scoreCalc      = $('score-calc')
const scoreTotalEl   = $('score-total')
const previewRow     = $('preview-row')
const handRow        = $('hand-row')
const bakeRow        = $('bake-row')
const btnPlay        = $('btn-play') as HTMLButtonElement
const btnDisc        = $('btn-disc') as HTMLButtonElement
const nightStatus    = $('night-status')

const shopWalletVal  = $('shop-wallet-val')
const shopSubtitle   = $('shop-subtitle')
const shopOfferRow   = $('shop-offer-row')
const btnReload      = $('btn-reload') as HTMLButtonElement
const btnProceed     = $('btn-proceed') as HTMLButtonElement
const shopOwnedRow   = $('shop-owned-row')

const resultNight    = $('result-night')
const resultNightSub = $('result-night-sub')
const resultYokka    = $('result-yokka')
const resultUnlock   = $('result-unlock')
const resultRecord   = $('result-record')
const btnResultBack  = $('btn-result-back') as HTMLButtonElement

const techoOverlay   = $('techo-overlay')
const techoContent   = $('techo-content')
const btnTechoClose  = $('btn-techo-close') as HTMLButtonElement

const tutorialOverlay = $('tutorial-overlay')
const tutorialSlide   = $('tutorial-slide')

// ── Persistent state ──────────────────────────────────────────────────────
let cumYokka   = 0
let bestRecord = 0
try {
  cumYokka   = parseInt(localStorage.getItem(LS_YOKKA)  || '0', 10) || 0
  bestRecord = parseInt(localStorage.getItem(LS_RECORD) || '0', 10) || 0
} catch {}

// ── Run state ─────────────────────────────────────────────────────────────
let deck:          Card[]     = []
let hand:          Card[]     = []
let selected       = new Set<number>()
let bake:          BakeFuda[] = []
let wallet         = 0
let nightIndex     = 0
let nightScore     = 0
let playsLeft      = 4
let discardsLeft   = 3
let windBonus      = 0
let playsUsed      = 0
let target         = 80
let boss:          BossId = null
let shopOffers:    BakeFuda[] = []
let sellConfirmId: string | null = null
let animating      = false
let lastPreviewRole: string = 'none'

// ── Audio ─────────────────────────────────────────────────────────────────
let audioCtx: AudioContext | null = null

function getCtx(): AudioContext {
  if (!audioCtx) {
    audioCtx = new AudioContext()
    configureMixedSession()
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  return audioCtx
}

function playTap(): void {
  if (isMuted()) return
  const c = getCtx()
  const len = Math.floor(c.sampleRate * 0.05)
  const buf = c.createBuffer(1, len, c.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) {
    data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.25)) * 0.45
  }
  const src = c.createBufferSource()
  src.buffer = buf
  const f = c.createBiquadFilter()
  f.type = 'bandpass'; f.frequency.value = 2000; f.Q.value = 2
  src.connect(f); f.connect(c.destination)
  src.start()
}

function playTick(): void {
  if (isMuted()) return
  const c = getCtx()
  const osc = c.createOscillator()
  const g   = c.createGain()
  osc.frequency.value = 1200; osc.type = 'sine'
  g.gain.setValueAtTime(0.12, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.035)
  osc.connect(g); g.connect(c.destination)
  osc.start(); osc.stop(c.currentTime + 0.035)
}

function playPreviewYaku(): void {
  if (isMuted()) return
  const c = getCtx()
  const osc = c.createOscillator()
  const g   = c.createGain()
  osc.frequency.value = 660; osc.type = 'sine'
  g.gain.setValueAtTime(0.08, c.currentTime)
  g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.18)
  osc.connect(g); g.connect(c.destination)
  osc.start(); osc.stop(c.currentTime + 0.18)
}

function playRole(): void {
  if (isMuted()) return
  const c = getCtx()
  const t = c.currentTime
  const bell = c.createOscillator()
  const bg   = c.createGain()
  bell.frequency.value = 880; bell.type = 'sine'
  bg.gain.setValueAtTime(0.18, t); bg.gain.exponentialRampToValueAtTime(0.001, t + 0.55)
  bell.connect(bg); bg.connect(c.destination)
  bell.start(t); bell.stop(t + 0.55)

  const gong = c.createOscillator()
  const gg   = c.createGain()
  gong.frequency.value = 55; gong.type = 'sine'
  gg.gain.setValueAtTime(0.28, t); gg.gain.exponentialRampToValueAtTime(0.001, t + 0.7)
  gong.connect(gg); gg.connect(c.destination)
  gong.start(t); gong.stop(t + 0.7)
}

function playClear(): void {
  if (isMuted()) return
  const c = getCtx()
  ;[523, 659, 784].forEach((freq, i) => {
    const osc = c.createOscillator()
    const g   = c.createGain()
    osc.frequency.value = freq; osc.type = 'sine'
    const t = c.currentTime + i * 0.13
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(0.18, t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28)
    osc.connect(g); g.connect(c.destination)
    osc.start(t); osc.stop(t + 0.28)
  })
}

function playDefeat(): void {
  if (isMuted()) return
  const c = getCtx()
  ;[440, 330].forEach((freq, i) => {
    const osc = c.createOscillator()
    const g   = c.createGain()
    osc.frequency.value = freq; osc.type = 'sine'
    const t = c.currentTime + i * 0.22
    g.gain.setValueAtTime(0.2, t)
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.4)
    osc.connect(g); g.connect(c.destination)
    osc.start(t); osc.stop(t + 0.4)
  })
}

// ── Utilities ─────────────────────────────────────────────────────────────
const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms))

function toast(msg: string, ms = 1600): void {
  toastEl.textContent = msg
  toastEl.classList.add('on')
  setTimeout(() => toastEl.classList.remove('on'), ms)
}

function showScreen(el: HTMLElement): void {
  for (const s of [scrTitle, scrNight, scrShop, scrResult]) {
    s.classList.toggle('active', s === el)
  }
}

function saveState(): void {
  try {
    localStorage.setItem(LS_YOKKA,  String(cumYokka))
    localStorage.setItem(LS_RECORD, String(bestRecord))
  } catch {}
}

function nextBossNight(fromNight: number): number {
  for (let i = fromNight + 1; i < 8; i++) {
    if (NIGHT_BOSS[i]) return i
  }
  return -1
}

// ── Card element helpers ──────────────────────────────────────────────────

function cardImg(card: Card): HTMLImageElement {
  const img = document.createElement('img')
  img.src = cardImgUrl(card)
  img.alt = card.label
  img.draggable = false
  img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;pointer-events:none;'
  return img
}

// Sample card URL for techo thumbnails — only needs month/kind/ordinal
function sampleUrl(month: number, kind: Kind, ordinal = 1): string {
  return cardImgUrl({ month, kind, ordinal })
}

// ── Pure score preview ────────────────────────────────────────────────────
// Single function used for both live preview and actual play score computation.
// Returns simplified display values; animatePlay calls calcScore directly for bakeEffects detail.
function previewScore(
  selectedCards: Card[],
  bakeState: BakeFuda[],
  ns: {
    deckSize: number; nightIndex: number; completedNights: number
    isFirstPlay: boolean; isLastPlay: boolean; windBonus: number; bossId: BossId
  },
): { yakuName: string; mult: number; bun: number; total: number } {
  const r = calcScore({
    selected: selectedCards,
    bake: bakeState,
    deckSize: ns.deckSize,
    nightIndex: ns.nightIndex,
    completedNights: ns.completedNights,
    isFirstPlay: ns.isFirstPlay,
    isLastPlay: ns.isLastPlay,
    windBonus: ns.windBonus,
    bossId: ns.bossId,
  })
  return { yakuName: r.roleName, mult: r.totalMulti, bun: r.basePts, total: r.total }
}

// ── Live preview row ──────────────────────────────────────────────────────
function renderPreview(): void {
  const sel = hand.filter(c => selected.has(c.id))
  if (sel.length === 0) {
    previewRow.innerHTML = '札を えらんで ならべる'
    previewRow.className = 'preview-row'
    lastPreviewRole = 'none'
    return
  }
  const ps = previewScore(sel, bake, {
    deckSize: deck.length,
    nightIndex,
    completedNights: nightIndex,
    isFirstPlay: playsUsed === 0,
    isLastPlay: playsLeft === 1,
    windBonus,
    bossId: boss,
  })
  const multStr = ps.mult % 1 === 0 ? String(ps.mult) : ps.mult.toFixed(1)
  const hasRole = ps.yakuName !== '役なし'

  if (hasRole && ps.yakuName !== lastPreviewRole) {
    playPreviewYaku()
    previewRow.classList.remove('yaku-pop')
    void previewRow.offsetWidth
    previewRow.classList.add('yaku-pop')
  }
  lastPreviewRole = ps.yakuName

  if (hasRole) {
    previewRow.innerHTML =
      `<span class="pr-yaku">${ps.yakuName}</span>` +
      ` ×<span class="pr-num">${multStr}</span>` +
      ` ＝ <span class="pr-num">${ps.total}</span>文`
    previewRow.className = 'preview-row has-role'
  } else {
    previewRow.innerHTML =
      `役なし ×<span class="pr-num">${multStr}</span>` +
      ` ＝ <span class="pr-num">${ps.total}</span>文`
    previewRow.className = 'preview-row'
  }
}

// ── Hint glow logic ───────────────────────────────────────────────────────
function isHintCard(card: Card): boolean {
  if (selected.has(card.id) || selected.size === 0) return false
  const sel = hand.filter(c => selected.has(c.id))
  const selMonths = new Set(sel.map(c => c.month))
  if (selMonths.has(card.month)) return true
  if (sel.some(c => c.kind === 'ko')   && card.kind === 'ko')   return true
  if (sel.some(c => c.kind === 'tan')  && card.kind === 'tan')  return true
  if (sel.some(c => c.kind === 'tane') && card.kind === 'tane') return true
  return false
}

// ── Techo (rule reference) ────────────────────────────────────────────────
function buildTechoHTML(): string {
  function th(month: number, kind: Kind, ordinal = 1): string {
    return `<img src="${sampleUrl(month, kind, ordinal)}" class="techo-thumb" loading="lazy" alt="">`
  }
  function thumbs(specs: Array<[number, Kind, number?]>): string {
    return specs.map(([m, k, o]) => th(m, k, o)).join('')
  }
  function row(id: RoleId, desc: string, specs: Array<[number, Kind, number?]>): string {
    return `<div class="techo-role">
      <div class="techo-role-head">
        <span class="techo-role-name">${ROLE_NAME[id]}</span>
        <span class="techo-role-multi">×${ROLE_MULTI[id]}</span>
      </div>
      <div class="techo-role-body">
        <div class="techo-role-desc">${desc}</div>
        <div class="techo-role-cards">${thumbs(specs)}</div>
      </div>
    </div>`
  }
  function sec(label: string, rows: string): string {
    return `<div class="techo-section"><div class="techo-sec-label">${label}</div>${rows}</div>`
  }

  return `
    <div class="techo-pts-row">
      <div class="techo-pt">${th(1,'ko')}<span>光</span><b>20文</b></div>
      <div class="techo-pt">${th(2,'tane')}<span>タネ</span><b>10文</b></div>
      <div class="techo-pt">${th(1,'tan')}<span>短冊</span><b>5文</b></div>
      <div class="techo-pt">${th(1,'kasu',1)}<span>カス</span><b>1文</b></div>
    </div>
    ${sec('光もの', [
      row('gogko',       '全五光（松・桜・芒・柳・桐）',         [[1,'ko'],[3,'ko'],[8,'ko'],[11,'ko'],[12,'ko']]),
      row('yonko_dry',   '四光（雨札を含まない）',               [[1,'ko'],[3,'ko'],[8,'ko'],[12,'ko']]),
      row('yonko_rain',  '四光（雨札＝柳光を含む）',             [[1,'ko'],[3,'ko'],[8,'ko'],[11,'ko']]),
      row('sanko',       '三光（雨札を除く光三枚）',             [[1,'ko'],[3,'ko'],[8,'ko']]),
    ].join(''))}
    ${sec('獣と鳥', [
      row('inoshikacho', '猪・鹿・蝶のタネ三枚',                [[7,'tane'],[10,'tane'],[6,'tane']]),
    ].join(''))}
    ${sec('短冊', [
      row('akatan',      '赤短冊三枚（一・二・三月）',            [[1,'tan'],[2,'tan'],[3,'tan']]),
      row('aotan',       '青短冊三枚（六・九・十月）',            [[6,'tan'],[9,'tan'],[10,'tan']]),
    ].join(''))}
    ${sec('月見・花見', [
      row('hanamizan',   '桜幕（三月光）＋菊盃（九月タネ）',     [[3,'ko'],[9,'tane']]),
      row('tsukimizake', '芒月（八月光）＋菊盃（九月タネ）',     [[8,'ko'],[9,'tane']]),
    ].join(''))}
    ${sec('重ね（同月）', [
      row('dotsuki4',    '同じ月の四枚すべて',                   [[1,'ko'],[1,'tan'],[1,'kasu',1],[1,'kasu',2]]),
      row('dotsuki3',    '同じ月の三枚',                         [[1,'ko'],[1,'tan'],[1,'kasu',1]]),
      row('dotsuki2',    '同じ月の二枚',                         [[1,'ko'],[1,'tan']]),
    ].join(''))}
    ${sec('数もの', [
      row('tane3',  'タネ三枚以上',                              [[2,'tane'],[4,'tane'],[7,'tane']]),
      row('tan3',   '短冊三枚以上',                              [[1,'tan'],[2,'tan'],[4,'tan']]),
      row('kasu5',  'カス五枚以上',                              [[1,'kasu',1],[1,'kasu',2],[2,'kasu',1],[2,'kasu',2],[3,'kasu',1]]),
    ].join(''))}
    ${sec('役なし', [
      row('none', '何役も成立しない — 素直に文の合計',           []),
    ].join(''))}
  `
}

function openTecho(): void {
  techoContent.innerHTML = buildTechoHTML()
  techoOverlay.classList.add('open')
}

function closeTecho(): void {
  techoOverlay.classList.remove('open')
}

// ── Tutorial (shown once on first run) ───────────────────────────────────
function showTutorial(onDone: () => void): void {
  let idx = 0
  tutorialOverlay.style.display = 'flex'

  function showSlide(): void {
    const total = TUTORIAL_SLIDES.length
    tutorialSlide.innerHTML = `
      <div class="slide-text">${TUTORIAL_SLIDES[idx]}</div>
      <div class="slide-counter">${idx + 1} / ${total}</div>
      <div class="slide-hint">どこかをタップして進む</div>
    `
  }

  showSlide()

  function advance(): void {
    idx++
    if (idx >= TUTORIAL_SLIDES.length) {
      tutorialOverlay.removeEventListener('pointerdown', advance)
      tutorialOverlay.style.display = 'none'
      try { localStorage.setItem(LS_TUTORED, '1') } catch {}
      onDone()
    } else {
      showSlide()
    }
  }

  tutorialOverlay.addEventListener('pointerdown', advance)
}

function startRunWithTutorial(): void {
  let tutored = false
  try { tutored = !!localStorage.getItem(LS_TUTORED) } catch {}
  if (tutored) {
    startRun()
  } else {
    showTutorial(startRun)
  }
}

// ── Title screen ──────────────────────────────────────────────────────────
function showTitle(): void {
  statRecord.textContent = bestRecord > 0 ? String(bestRecord) : '—'
  statYokka.textContent  = String(cumYokka)

  const unlockLevel = cumYokka >= 15 ? 2 : cumYokka >= 5 ? 1 : 0
  if (unlockLevel === 0) {
    titleUnlock.textContent = `妖貨 5 で化け札三種解放`
  } else if (unlockLevel === 1) {
    titleUnlock.textContent = `妖貨 15 で残り全解放（${15 - cumYokka > 0 ? 15 - cumYokka : 0}不足）`
  } else {
    titleUnlock.textContent = '全化け札解放済み'
  }
  showScreen(scrTitle)
}

// ── Night setup ───────────────────────────────────────────────────────────
function startRun(): void {
  bake        = []
  wallet      = 0
  nightIndex  = 0
  startNight()
}

function startNight(): void {
  boss        = NIGHT_BOSS[nightIndex]
  const handSize = boss === 'tanuki' ? 7 : P.HAND

  const raw   = makeDeck()
  deck        = shuffle(raw)
  hand        = deck.splice(0, handSize)
  selected    = new Set()
  nightScore  = 0
  playsLeft   = P.PLAYS
  discardsLeft = boss === 'short' ? 0 : P.DISCARDS
  windBonus   = 0
  playsUsed   = 0
  lastPreviewRole = 'none'
  target      = Math.round(NIGHT_TARGETS[nightIndex] * P.TARGET_MUL)
  sellConfirmId = null
  animating   = false

  renderNight()
  showScreen(scrNight)
}

// ── Night rendering ───────────────────────────────────────────────────────
function renderNight(): void {
  renderHeader()
  renderGauge()
  renderBossBar()
  renderHand()
  renderBakeRow()
  renderPlayButtons()
  renderStatus()
  clearPlayArea()
}

function renderHeader(): void {
  nightRound.textContent = NIGHT_NAMES[nightIndex]
  const remain = Math.max(0, target - nightScore)
  if (remain === 0) {
    targetPts.textContent = '達成'
    targetSuffix.textContent = ''
  } else {
    targetPts.textContent = String(remain)
    targetSuffix.textContent = '文 GO'
  }
}

function renderGauge(): void {
  const pct = Math.min(100, Math.round(nightScore / target * 100))
  gaugeFill.style.width = pct + '%'
  gaugeText.textContent = `${nightScore} / ${target}`
}

function renderBossBar(): void {
  const cur   = NIGHT_BOSS[nightIndex]
  const nextI = nextBossNight(nightIndex)
  const parts: string[] = []

  if (cur) {
    bossBar.className = 'boss-bar has-boss'
    parts.push(`親分ノ触レ ◇ ${BOSS_DESC[cur]}`)
  } else {
    bossBar.className = 'boss-bar next-boss'
  }

  if (nextI >= 0) {
    const nb = NIGHT_BOSS[nextI]!
    parts.push(`次 ${NIGHT_NAMES[nextI]} ‥ ${BOSS_NAME[nb]}`)
  } else if (!cur) {
    parts.push('—')
  }

  bossBar.textContent = parts.join('  ')
}

function renderHand(): void {
  handRow.innerHTML = ''

  const totalGap = (Math.max(hand.length, 1) - 1) * 5
  const avail    = Math.min(370, window.innerWidth - 28)
  const cw       = Math.min(42, Math.floor((avail - totalGap) / Math.max(hand.length, 1)))
  const ch       = Math.round(cw * 1.5)

  for (const card of hand) {
    const btn = document.createElement('button')
    btn.className = 'card-btn'
    btn.style.cssText = `width:${cw}px;height:${ch}px;`
    btn.appendChild(cardImg(card))

    if (selected.has(card.id)) {
      btn.classList.add('selected')
    } else if (selected.size >= 5) {
      btn.classList.add('dimmed')
    } else if (isHintCard(card)) {
      btn.classList.add('hint-glow')
    }

    btn.addEventListener('pointerdown', () => {
      if (animating || tune.isPanelOpen()) return
      playTap()
      if (selected.has(card.id)) {
        selected.delete(card.id)
      } else if (selected.size < 5) {
        selected.add(card.id)
      } else {
        btn.style.animation = 'chipBounce 0.2s ease'
        setTimeout(() => (btn.style.animation = ''), 220)
        return
      }
      renderHand()
      renderPlayButtons()
    })
    handRow.appendChild(btn)
  }

  renderPreview()
}

function renderBakeRow(): void {
  bakeRow.innerHTML = ''
  const slots = MAX_BAKE
  for (let i = 0; i < slots; i++) {
    const b    = bake[i]
    const chip = document.createElement('div')
    chip.className = b ? 'bake-chip' : 'bake-chip empty'
    chip.id = b ? `bchip-${b.id}` : `bchip-empty-${i}`

    if (b) {
      const nameChar = b.name[0]
      chip.innerHTML = `<b>${nameChar}</b><span>${b.name.slice(1, 5)}</span>`
      chip.addEventListener('pointerdown', () => {
        if (animating) return
        toast(b.desc, 2200)
      })
    } else {
      chip.innerHTML = `<b style="color:#7f8a9d;font-size:20px">＋</b>`
    }
    bakeRow.appendChild(chip)
  }
}

function renderPlayButtons(): void {
  const hasSel = selected.size > 0
  btnPlay.disabled = !hasSel || animating
  btnDisc.disabled = !hasSel || discardsLeft <= 0 || animating || boss === 'short'
}

function renderStatus(): void {
  nightStatus.textContent =
    `PLAYS ${playsLeft} · DISCARDS ${discardsLeft} · DECK ${deck.length}`
}

function clearPlayArea(): void {
  playCardsRow.innerHTML  = ''
  roleStamp.textContent   = ''
  roleStamp.className     = 'role-stamp'
  scoreCalc.textContent   = ''
  scoreTotalEl.textContent = ''
  scoreTotalEl.className  = 'score-total'
}

// ── Play animation ────────────────────────────────────────────────────────
async function animatePlay(played: Card[]): Promise<void> {
  animating = true
  renderPlayButtons()

  playCardsRow.innerHTML = ''
  const minis: HTMLDivElement[] = []
  for (const card of played) {
    const div = document.createElement('div')
    div.className = 'play-card-mini'
    div.appendChild(cardImg(card))
    playCardsRow.appendChild(div)
    minis.push(div)
  }

  await wait(100)

  let runPts = 0
  for (let i = 0; i < minis.length; i++) {
    playTick()
    minis[i].classList.add('lit')
    runPts += boss === 'rain' && played[i].isRain ? 0 : played[i].pts
    scoreCalc.textContent = String(runPts)
    await wait(80)
  }

  await wait(80)

  const result = calcScore({
    selected: played,
    bake,
    deckSize: deck.length,
    nightIndex,
    completedNights: nightIndex,
    isFirstPlay: playsUsed === 0,
    isLastPlay:  playsLeft === 1,
    windBonus,
    bossId: boss,
  })

  windBonus = 0

  playRole()
  roleStamp.textContent = result.roleName
  roleStamp.className   = 'role-stamp show'
  await wait(180)

  const multStr = result.totalMulti % 1 === 0
    ? String(result.totalMulti)
    : result.totalMulti.toFixed(1)
  scoreCalc.textContent = `${result.basePts} × ${multStr} =`
  await wait(150)

  scoreTotalEl.textContent = String(result.total)
  scoreTotalEl.className   = 'score-total show'

  for (const eff of result.bakeEffects) {
    const chip = document.getElementById(`bchip-${eff.id}`)
    if (chip) {
      chip.classList.add('bounce')
      const pop = document.createElement('div')
      pop.className = 'bake-pop'
      const val = eff.ptsDelta > 0 ? `+${eff.ptsDelta}文` : `×${(eff.multiDelta + result.roleMulti).toFixed(1)}`
      pop.textContent = val
      chip.appendChild(pop)
      setTimeout(() => { chip.classList.remove('bounce'); pop.remove() }, 700)
    }
    await wait(50)
  }

  await wait(200)

  nightScore += result.total
  renderHeader()

  if (result.totalMulti >= 6) {
    multiFlash.className = 'multi-flash flash'
    setTimeout(() => (multiFlash.className = 'multi-flash'), 450)
    gaugeBar.classList.add('gauge-shake')
    setTimeout(() => gaugeBar.classList.remove('gauge-shake'), 280)
  }

  renderGauge()
  await wait(350)

  animating = false
  renderPlayButtons()
}

// ── Play handler ──────────────────────────────────────────────────────────
async function onPlay(): Promise<void> {
  if (animating || tune.isPanelOpen()) return
  if (selected.size === 0) { toast('一枚以上選んでください'); return }

  const played = hand.filter(c => selected.has(c.id))
  selected.clear()
  lastPreviewRole = 'none'

  hand = hand.filter(c => !played.some(p => p.id === c.id))

  playsLeft--
  playsUsed++

  await animatePlay(played)

  const handSize = boss === 'tanuki' ? 7 : P.HAND
  while (hand.length < handSize && deck.length > 0) {
    hand.push(deck.shift()!)
  }

  renderHand()
  renderStatus()

  if (nightScore >= target) {
    playClear()
    await wait(600)
    afterNight(true)
    return
  }

  if (playsLeft <= 0) {
    playDefeat()
    await wait(600)
    afterNight(false)
    return
  }

  clearPlayArea()
  renderPlayButtons()
}

// ── Discard (流し) handler ────────────────────────────────────────────────
function onDiscard(): void {
  if (animating || tune.isPanelOpen()) return
  if (boss === 'short') { toast('短気ノ夜 — 流シ御法度'); return }
  if (discardsLeft <= 0) { toast('流しの回数が尽きました'); return }
  if (selected.size === 0) { toast('一枚以上選んでください'); return }

  playTap()

  const discarded = hand.filter(c => selected.has(c.id))
  hand = hand.filter(c => !selected.has(c.id))
  deck.push(...discarded)
  deck = shuffle(deck)

  if (hasBake(bake, 'kaze')) windBonus += 10

  selected.clear()
  lastPreviewRole = 'none'
  discardsLeft--

  const handSize = boss === 'tanuki' ? 7 : P.HAND
  while (hand.length < handSize && deck.length > 0) {
    hand.push(deck.shift()!)
  }

  renderHand()
  renderStatus()
  renderPlayButtons()
  clearPlayArea()
}

// ── After night (clear or defeat) ────────────────────────────────────────
function afterNight(cleared: boolean): void {
  if (cleared) {
    if (nightIndex === 7) {
      enterResult(true)
    } else {
      enterShop()
    }
  } else {
    enterResult(false)
  }
}

// ── Shop screen ───────────────────────────────────────────────────────────
function enterShop(): void {
  const reward = calcReward(playsLeft, wallet, bake)
  wallet += reward

  const avail  = availableBake(cumYokka)
  shopOffers   = shopOffer(avail, bake)
  sellConfirmId = null

  renderShop()
  showScreen(scrShop)
}

function renderShop(): void {
  shopWalletVal.textContent = String(wallet)
  shopSubtitle.textContent  = `化け札 ${bake.length}/${MAX_BAKE} 枠`

  shopOfferRow.innerHTML = ''
  const adjPrice = (b: BakeFuda) => Math.max(1, Math.round(b.price * P.PRICE_MUL))

  if (shopOffers.length === 0) {
    const msg = document.createElement('div')
    msg.style.cssText = 'font-size:12px;color:#7f8a9d;letter-spacing:.1em;text-align:center;padding:16px;'
    msg.textContent = '品切れ'
    shopOfferRow.appendChild(msg)
  }

  for (const b of shopOffers) {
    const card = document.createElement('div')
    const price = adjPrice(b)
    const canBuy = wallet >= price && bake.length < MAX_BAKE
    card.className = `bake-offer${canBuy ? '' : ' sold-out'}`
    card.innerHTML = `
      <div class="offer-name">${b.name}</div>
      <div class="offer-price">${price}<span>文貨</span></div>
      <div class="offer-desc">${b.desc}</div>`
    card.addEventListener('pointerdown', () => {
      if (!canBuy) return
      const actualPrice = adjPrice(b)
      if (wallet < actualPrice) { toast('文貨が足りません'); return }
      if (bake.length >= MAX_BAKE) { toast('化け札は5枚まで'); return }
      wallet -= actualPrice
      bake.push(b)
      shopOffers = shopOffers.filter(o => o !== b)
      playTap()
      renderShop()
    })
    shopOfferRow.appendChild(card)
  }

  btnReload.disabled = wallet < 1

  shopOwnedRow.innerHTML = ''
  if (bake.length === 0) {
    const msg = document.createElement('div')
    msg.style.cssText = 'font-size:11px;color:#7f8a9d;letter-spacing:.1em;padding:8px;'
    msg.textContent = '所持なし'
    shopOwnedRow.appendChild(msg)
  }
  for (const b of bake) {
    const sp     = sellPrice(b, bake)
    const isSell = sellConfirmId === b.id
    const item   = document.createElement('div')
    item.className = `bake-owned${isSell ? ' sell-confirm' : ''}`
    item.innerHTML = `
      <div class="own-name">${b.name}</div>
      <div class="own-sell">${isSell ? '確認: 売る?' : `売 ${sp}文`}</div>`
    item.addEventListener('pointerdown', () => {
      playTap()
      if (sellConfirmId === b.id) {
        wallet += sp
        bake = bake.filter(o => o !== b)
        sellConfirmId = null
        renderShop()
      } else {
        sellConfirmId = b.id
        renderShop()
      }
    })
    shopOwnedRow.appendChild(item)
  }
}

// ── Result screen ─────────────────────────────────────────────────────────
function enterResult(cleared: boolean): void {
  const reachedNight = nightIndex + 1
  const yokkaGain    = reachedNight

  const prevLevel = cumYokka >= 15 ? 2 : cumYokka >= 5 ? 1 : 0
  cumYokka += yokkaGain
  const newLevel  = cumYokka >= 15 ? 2 : cumYokka >= 5 ? 1 : 0

  if (cleared || reachedNight > bestRecord) {
    bestRecord = cleared ? 8 : reachedNight
  }
  saveState()

  resultNight.textContent    = String(reachedNight)
  resultNightSub.textContent = cleared ? '夜 — 全クリア' : '夜'
  resultYokka.textContent    = String(yokkaGain)

  let unlockMsg = ''
  if (newLevel > prevLevel) {
    unlockMsg = newLevel === 1
      ? '化け札 三種が解放されました (風待ち・集金・質屋)'
      : '残リの化け札 三種が解放されました (山分け・松竹梅・化ケ提灯)'
  }
  resultUnlock.textContent = unlockMsg

  resultRecord.innerHTML = `最深記録 <b>${bestRecord > 0 ? bestRecord : '—'}</b> 夜`

  showScreen(scrResult)
}

// ── SHOT mode state builders ──────────────────────────────────────────────
const SHOT = new URLSearchParams(location.search).get('shot')

function setupShotPlay(): void {
  nightIndex   = 2
  boss         = NIGHT_BOSS[2]
  target       = 480
  nightScore   = 160
  playsLeft    = 2
  discardsLeft = 1
  playsUsed    = 1
  windBonus    = 0
  bake         = []

  const raw = makeDeck()
  hand = shuffle(raw).slice(0, 5)
  deck = raw.filter(c => !hand.some(h => h.id === c.id)).slice(0, 27)

  const koCards = raw.filter(c => c.kind === 'ko' && !c.isRain).slice(0, 3)

  renderNight()
  showScreen(scrNight)

  playCardsRow.innerHTML = ''
  for (const card of koCards) {
    const div = document.createElement('div')
    div.className = 'play-card-mini lit'
    div.appendChild(cardImg(card))
    playCardsRow.appendChild(div)
  }
  roleStamp.textContent  = '三光'
  roleStamp.className    = 'role-stamp show'
  scoreCalc.textContent  = '60 × 8 ='
  scoreTotalEl.textContent = '480'
  scoreTotalEl.className  = 'score-total show'
}

function setupShotShop(): void {
  nightIndex  = 2
  wallet      = 12
  bake        = []
  const avail = availableBake(0)
  shopOffers  = shopOffer(avail, bake)
  renderShop()
  showScreen(scrShop)
}

function setupShotTecho(): void {
  openTecho()
  showTitle()
}

// ── Event wiring ──────────────────────────────────────────────────────────
btnStart.addEventListener('pointerdown', () => {
  if (tune.isPanelOpen()) return
  playTap()
  startRunWithTutorial()
})

btnTechoTitle.addEventListener('pointerdown', () => {
  playTap()
  openTecho()
})

btnTecho.addEventListener('pointerdown', () => {
  if (animating) return
  playTap()
  openTecho()
})

btnTechoClose.addEventListener('pointerdown', () => {
  playTap()
  closeTecho()
})

btnPlay.addEventListener('pointerdown', () => {
  void onPlay()
})

btnDisc.addEventListener('pointerdown', () => {
  onDiscard()
})

btnReload.addEventListener('pointerdown', () => {
  if (wallet < 1) return
  wallet -= 1
  playTap()
  const avail = availableBake(cumYokka)
  shopOffers  = shopOffer(avail, bake)
  renderShop()
})

btnProceed.addEventListener('pointerdown', () => {
  playTap()
  nightIndex++
  sellConfirmId = null
  startNight()
})

btnResultBack.addEventListener('pointerdown', () => {
  playTap()
  showTitle()
})

scrShop.addEventListener('pointerdown', (e) => {
  const t = e.target as HTMLElement
  if (!t.closest('.bake-owned') && sellConfirmId !== null) {
    sellConfirmId = null
    renderShop()
  }
})

// ── Init ──────────────────────────────────────────────────────────────────
mountMuteButton()

document.querySelectorAll<HTMLAnchorElement>('a.back-link').forEach(wireLink)

if (SHOT) {
  const q = new URLSearchParams(location.search)
  const w = Number(q.get('w') || 390)
  const h = Number(q.get('h') || 844)
  stage.style.width  = w + 'px'
  stage.style.height = h + 'px'
  stage.style.right  = 'auto'
  stage.style.bottom = 'auto'

  if (SHOT === 'play') {
    setupShotPlay()
  } else if (SHOT === 'shop') {
    setupShotShop()
  } else if (SHOT === 'techo') {
    setupShotTecho()
  } else {
    showTitle()
  }
} else {
  enterTransition()
  showTitle()
}
