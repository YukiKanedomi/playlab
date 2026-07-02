// games/bakefuda/main.ts
// Game flow, animation, audio, UI. DOM-based — no canvas.

import { isMuted, mountMuteButton, configureMixedSession } from '../../shared/audio'
import * as tune from '../../shared/tune'
import { enterTransition, wireLink } from '../../shared/transition'
import {
  type Card, type BakeFuda, type BossId,
  makeDeck, shuffle, calcScore, calcReward,
  availableBake, shopOffer, sellPrice, hasBake,
  NIGHT_TARGETS, NIGHT_BOSS, BOSS_NAME, BOSS_DESC,
} from './data'
import { cardSVG } from './cards'

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
const LS_YOKKA  = 'playlab.bakefuda.yokka'
const LS_RECORD = 'playlab.bakefuda.record'
const MAX_BAKE  = 5

// ── DOM refs ──────────────────────────────────────────────────────────────
const $ = (id: string): HTMLElement => document.getElementById(id)!

const stage         = $('stage')
const scrTitle      = $('scr-title')
const scrNight      = $('scr-night')
const scrShop       = $('scr-shop')
const scrResult     = $('scr-result')
const toastEl       = $('toast')

const statRecord    = $('stat-record')
const statYokka     = $('stat-yokka')
const titleUnlock   = $('title-unlock')
const btnStart      = $('btn-start') as HTMLButtonElement

const nightRound    = $('night-round')
const targetPts     = $('target-pts')
const targetSuffix  = $('target-suffix')
const gaugeFill     = $('gauge-fill')
const gaugeText     = $('gauge-text')
const gaugeBar      = $('gauge-bar')
const bossBar       = $('boss-bar')
const multiFlash    = $('multi-flash')
const playCardsRow  = $('play-cards-row')
const roleStamp     = $('role-stamp')
const scoreCalc     = $('score-calc')
const scoreTotalEl  = $('score-total')
const handRow       = $('hand-row')
const bakeRow       = $('bake-row')
const btnPlay       = $('btn-play') as HTMLButtonElement
const btnDisc       = $('btn-disc') as HTMLButtonElement
const nightStatus   = $('night-status')

const shopWalletVal = $('shop-wallet-val')
const shopSubtitle  = $('shop-subtitle')
const shopOfferRow  = $('shop-offer-row')
const btnReload     = $('btn-reload') as HTMLButtonElement
const btnProceed    = $('btn-proceed') as HTMLButtonElement
const shopOwnedRow  = $('shop-owned-row')

const resultNight   = $('result-night')
const resultNightSub = $('result-night-sub')
const resultYokka   = $('result-yokka')
const resultUnlock  = $('result-unlock')
const resultRecord  = $('result-record')
const btnResultBack = $('btn-result-back') as HTMLButtonElement

// ── Persistent state ──────────────────────────────────────────────────────
let cumYokka  = 0
let bestRecord = 0
try {
  cumYokka   = parseInt(localStorage.getItem(LS_YOKKA)  || '0', 10) || 0
  bestRecord = parseInt(localStorage.getItem(LS_RECORD) || '0', 10) || 0
} catch {}

// ── Run state ─────────────────────────────────────────────────────────────
let deck:        Card[]    = []
let hand:        Card[]    = []
let selected     = new Set<number>()
let bake:        BakeFuda[] = []
let wallet       = 0
let nightIndex   = 0
let nightScore   = 0
let playsLeft    = 4
let discardsLeft = 3
let windBonus    = 0
let playsUsed    = 0
let target       = 80
let boss:        BossId = null
let shopOffers:  BakeFuda[] = []
let sellConfirmId: string | null = null
let animating    = false

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
  // Remaining pts to target (never negative). On reach show 達成 state.
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
  const cur  = NIGHT_BOSS[nightIndex]
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

  // Dynamically size cards to fit without scrolling
  const totalGap = (Math.max(hand.length, 1) - 1) * 5
  const avail    = Math.min(370, window.innerWidth - 28)
  const cw       = Math.min(42, Math.floor((avail - totalGap) / Math.max(hand.length, 1)))
  const ch       = Math.round(cw * 1.5)

  for (const card of hand) {
    const btn = document.createElement('button')
    btn.className  = 'card-btn'
    btn.style.cssText = `width:${cw}px;height:${ch}px;`
    btn.innerHTML  = cardSVG(card.month, card.kind, card.motif, card.tanColor)
    if (selected.has(card.id)) {
      btn.classList.add('selected')
    } else if (selected.size >= 5) {
      btn.classList.add('dimmed')
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
  playCardsRow.innerHTML = ''
  roleStamp.textContent  = ''
  roleStamp.className    = 'role-stamp'
  scoreCalc.textContent  = ''
  scoreTotalEl.textContent = ''
  scoreTotalEl.className  = 'score-total'
}

// ── Play animation ────────────────────────────────────────────────────────
async function animatePlay(played: Card[]): Promise<void> {
  animating = true
  renderPlayButtons()

  // Show mini-cards in play area
  playCardsRow.innerHTML = ''
  const minis: HTMLDivElement[] = []
  for (const card of played) {
    const div = document.createElement('div')
    div.className = 'play-card-mini'
    div.innerHTML = cardSVG(card.month, card.kind, card.motif, card.tanColor)
    playCardsRow.appendChild(div)
    minis.push(div)
  }

  await wait(100)

  // Count up pts card by card
  let runPts = 0
  for (let i = 0; i < minis.length; i++) {
    playTick()
    minis[i].classList.add('lit')
    runPts += boss === 'rain' && played[i].isRain ? 0 : played[i].pts
    scoreCalc.textContent = String(runPts)
    await wait(80)
  }

  await wait(80)

  // Calculate full score
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

  // Reset wind bonus after use
  windBonus = 0

  // Role stamp
  playRole()
  roleStamp.textContent = result.roleName
  roleStamp.className   = 'role-stamp show'
  await wait(180)

  // Multiplier line
  const multStr = result.totalMulti % 1 === 0
    ? String(result.totalMulti)
    : result.totalMulti.toFixed(1)
  scoreCalc.textContent = `${result.basePts} × ${multStr} =`
  await wait(150)

  // Total score pop
  scoreTotalEl.textContent = String(result.total)
  scoreTotalEl.className   = 'score-total show'

  // Bake-fuda bounces with pop labels
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

  // Update score and gauge
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

  // Remove played cards from hand
  hand = hand.filter(c => !played.some(p => p.id === c.id))

  playsLeft--
  playsUsed++

  await animatePlay(played)

  // Refill hand
  const handSize = boss === 'tanuki' ? 7 : P.HAND
  while (hand.length < handSize && deck.length > 0) {
    hand.push(deck.shift()!)
  }

  renderHand()
  renderStatus()

  // Check win
  if (nightScore >= target) {
    playClear()
    await wait(600)
    afterNight(true)
    return
  }

  // Check defeat
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

  // Shuffle discarded cards back into the deck
  const discarded = hand.filter(c => selected.has(c.id))
  hand = hand.filter(c => !selected.has(c.id))
  deck.push(...discarded)
  deck = shuffle(deck)

  // 風待ち: accumulate bonus for next play
  if (hasBake(bake, 'kaze')) windBonus += 10

  selected.clear()
  discardsLeft--

  // Refill hand
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
    // Enter shop (or result if last night)
    if (nightIndex === 7) {
      // Full clear
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
  // Award night reward
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

  // Offers
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

  // Reload button
  btnReload.disabled = wallet < 1

  // Owned bake-fuda
  shopOwnedRow.innerHTML = ''
  if (bake.length === 0) {
    const msg = document.createElement('div')
    msg.style.cssText = 'font-size:11px;color:#7f8a9d;letter-spacing:.1em;padding:8px;'
    msg.textContent = '所持なし'
    shopOwnedRow.appendChild(msg)
  }
  for (const b of bake) {
    const sp    = sellPrice(b, bake)
    const isSell = sellConfirmId === b.id
    const item = document.createElement('div')
    item.className = `bake-owned${isSell ? ' sell-confirm' : ''}`
    item.innerHTML = `
      <div class="own-name">${b.name}</div>
      <div class="own-sell">${isSell ? '確認: 売る?' : `売 ${sp}文`}</div>`
    item.addEventListener('pointerdown', () => {
      playTap()
      if (sellConfirmId === b.id) {
        // Second tap: sell
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
  const reachedNight = nightIndex + 1 // 1-indexed
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
  // Night 3 (index 2), 三光 scenario, 480pt displayed
  // Fixed showcase state: target 480 / current 160 → remaining 320, gauge one-third
  nightIndex  = 2
  boss        = NIGHT_BOSS[2]   // 'rain'
  target      = 480
  nightScore  = 160
  playsLeft   = 2
  discardsLeft = 1
  playsUsed   = 1
  windBonus   = 0
  bake        = []

  // Build a sample hand from full deck
  const raw = makeDeck()
  hand = shuffle(raw).slice(0, 5)
  deck = raw.filter(c => !hand.some(h => h.id === c.id)).slice(0, 27)

  // Find 三光 cards for play display
  const koCards = raw.filter(c => c.kind === 'ko' && !c.isRain).slice(0, 3)

  renderNight()
  showScreen(scrNight)

  // Show play area in frozen "result" state
  playCardsRow.innerHTML = ''
  for (const card of koCards) {
    const div = document.createElement('div')
    div.className = 'play-card-mini lit'
    div.innerHTML = cardSVG(card.month, card.kind, card.motif, card.tanColor)
    playCardsRow.appendChild(div)
  }
  roleStamp.textContent = '三光'
  roleStamp.className   = 'role-stamp show'
  scoreCalc.textContent = '60 × 8 ='
  scoreTotalEl.textContent = '480'
  scoreTotalEl.className   = 'score-total show'
}

function setupShotShop(): void {
  nightIndex = 2
  wallet     = 12
  bake       = []
  const avail = availableBake(0)
  shopOffers  = shopOffer(avail, bake)
  renderShop()
  showScreen(scrShop)
}

// ── Event wiring ──────────────────────────────────────────────────────────
btnStart.addEventListener('pointerdown', () => {
  if (tune.isPanelOpen()) return
  playTap()
  startRun()
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
  const avail  = availableBake(cumYokka)
  shopOffers   = shopOffer(avail, bake)
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

// Cancel sell confirm on outside tap
scrShop.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement
  if (!target.closest('.bake-owned') && sellConfirmId !== null) {
    sellConfirmId = null
    renderShop()
  }
})

// ── Init ──────────────────────────────────────────────────────────────────
mountMuteButton()

document.querySelectorAll<HTMLAnchorElement>('a.back-link').forEach(wireLink)

// SHOT: fix stage to screenshot dimensions
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
  } else {
    showTitle()
  }
} else {
  enterTransition()
  showTitle()
}
