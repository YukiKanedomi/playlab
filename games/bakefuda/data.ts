// games/bakefuda/data.ts
// Core data: deck, role evaluation, bake-fuda catalogue, score calculation.

export type Kind = 'ko' | 'tane' | 'tan' | 'kasu'
export type TanColor = 'red' | 'blue' | 'plain'
export type BossId = 'rain' | 'short' | 'tanuki' | null

export type RoleId =
  | 'gogko'       // 五光 x15
  | 'yonko_dry'   // 四光(雨なし) x12
  | 'yonko_rain'  // 雨四光 x10
  | 'sanko'       // 三光 x8
  | 'inoshikacho' // 猪鹿蝶 x7
  | 'dotsuki4'    // 四重ネ x7
  | 'akatan'      // 赤短 x6
  | 'aotan'       // 青短 x6
  | 'hanamizan'   // 花見酒 x5
  | 'tsukimizake' // 月見酒 x5
  | 'dotsuki3'    // 同月三 x4
  | 'tane3'       // タネ三 x3
  | 'tan3'        // 短冊三 x3
  | 'kasu5'       // 塵積 x3
  | 'dotsuki2'    // 同月二 x2
  | 'none'        // 役なし x1

export const ROLE_NAME: Record<RoleId, string> = {
  gogko:       '五光',
  yonko_dry:   '四光',
  yonko_rain:  '雨四光',
  sanko:       '三光',
  inoshikacho: '猪鹿蝶',
  dotsuki4:    '四重ネ',
  akatan:      '赤短',
  aotan:       '青短',
  hanamizan:   '花見酒',
  tsukimizake: '月見酒',
  dotsuki3:    '同月三',
  tane3:       'タネ三',
  tan3:        '短冊三',
  kasu5:       '塵積',
  dotsuki2:    '同月二',
  none:        '役なし',
}

export const ROLE_MULTI: Record<RoleId, number> = {
  gogko:       15,
  yonko_dry:   12,
  yonko_rain:  10,
  sanko:       8,
  inoshikacho: 7,
  dotsuki4:    7,
  akatan:      6,
  aotan:       6,
  hanamizan:   5,
  tsukimizake: 5,
  dotsuki3:    4,
  tane3:       3,
  tan3:        3,
  kasu5:       3,
  dotsuki2:    2,
  none:        1,
}

export interface Card {
  id: number
  month: number          // 1-12
  kind: Kind
  pts: number            // base points
  tanColor?: TanColor    // only for kind === 'tan'
  isRain: boolean        // true only for 11月光 (small-ono-no-komachi)
  motif: string          // used for role/bake-fuda checks
  label: string          // "JAN・松"
}

export interface BakeFuda {
  id: string
  name: string
  price: number
  desc: string
  category: 'pts' | 'multi' | 'role' | 'special'
}

export interface RoleResult {
  role: RoleId
  multi: number
}

export interface ScoreContext {
  selected: Card[]
  bake: BakeFuda[]
  deckSize: number
  nightIndex: number          // 0-7
  completedNights: number     // nights already finished
  isFirstPlay: boolean
  isLastPlay: boolean
  windBonus: number           // 風待ち accumulated pts
  bossId: BossId
}

export interface BakeEffect {
  id: string
  ptsDelta: number
  multiDelta: number
}

export interface ScoreResult {
  total: number
  rawPts: number
  flatBonus: number
  basePts: number
  roleMulti: number
  multiBonus: number
  totalMulti: number
  role: RoleId
  roleName: string
  bakeEffects: BakeEffect[]
}

// ── Night target scores ────────────────────────────────────────────────────
export const NIGHT_TARGETS = [80, 130, 200, 320, 500, 780, 1200, 1900]

// ── Bosses per night index ─────────────────────────────────────────────────
export const NIGHT_BOSS: BossId[] = [
  null, null,
  'rain',   // night 3 (index 2)
  null, null,
  'short',  // night 6 (index 5)
  null,
  'tanuki', // night 8 (index 7)
]

export const BOSS_NAME: Record<string, string> = {
  rain:   '雨鬼',
  short:  '短気',
  tanuki: '大狸',
}

export const BOSS_DESC: Record<string, string> = {
  rain:   '雨札ハ文ヲ持タズ',
  short:  '流シハ御法度ナリ',
  tanuki: '手札七枚ニ削ル',
}

// ── Bake-fuda catalogue (18 total) ────────────────────────────────────────
// First 12 are in the initial pool. 13-15 unlock at cumYokka >= 5, 16-18 at >= 15.
export const ALL_BAKE: BakeFuda[] = [
  { id: 'kitsune',    name: '狐の嫁入り', price: 5, category: 'role',    desc: '雨札ヲ光トシテ扱フ' },
  { id: 'tsuki',      name: '月夜の宴',   price: 4, category: 'pts',     desc: '光一枚ニ付キ文＋二十' },
  { id: 'cho',        name: '猪突',       price: 4, category: 'role',    desc: '猪鹿蝶ノ倍率二倍' },
  { id: 'ito',        name: '赤い糸',     price: 3, category: 'pts',     desc: '短冊一枚ニ付キ文＋十五' },
  { id: 'sakazuki',   name: '盃事',       price: 5, category: 'multi',   desc: '盃ヲ含ム出シハ倍率＋三' },
  { id: 'hyakki',     name: '百鬼夜行',   price: 5, category: 'multi',   desc: 'カス一枚ニ付キ倍率＋〇・八' },
  { id: 'mikazuki',   name: '三日月',     price: 4, category: 'multi',   desc: 'チョウド三枚ノ出シハ倍率＋二' },
  { id: 'furumai',    name: '大盤振舞',   price: 4, category: 'pts',     desc: 'チョウド五枚ノ出シハ文＋六十' },
  { id: 'rijgi',      name: '律義者',     price: 3, category: 'role',    desc: '役ナシモ倍率二倍' },
  { id: 'hayazaki',   name: '早咲き',     price: 4, category: 'multi',   desc: '各夜最初ノ出シハ倍率＋三' },
  { id: 'shimemai',   name: '締めの舞',   price: 4, category: 'multi',   desc: '各夜最後ノ出シハ文二倍' },
  { id: 'kotto',      name: '骨董屋',     price: 6, category: 'multi',   desc: '同月系役ノ倍率＋二' },
  { id: 'kaze',       name: '風待ち',     price: 3, category: 'pts',     desc: '流ス度ニ次ノ出シ文＋十（累積）' },
  { id: 'shukin',     name: '集金',       price: 6, category: 'special', desc: '夜ノ報酬文貨＋二' },
  { id: 'shichiya',   name: '質屋',       price: 4, category: 'special', desc: '売値ガ買値ト同額ニナル' },
  { id: 'yamawake',   name: '山分け',     price: 5, category: 'multi',   desc: '山札二十枚以下デ倍率＋二' },
  { id: 'shochikubai',name: '松竹梅',     price: 5, category: 'multi',   desc: '一〜三月ノミノ出シハ倍率＋三' },
  { id: 'chochin',    name: '化ケ提灯',   price: 6, category: 'multi',   desc: '倍率＋一、夜ガ進ム毎＋〇・五' },
]

export function availableBake(cumYokka: number): BakeFuda[] {
  if (cumYokka >= 15) return ALL_BAKE
  if (cumYokka >= 5)  return ALL_BAKE.slice(0, 15)
  return ALL_BAKE.slice(0, 12)
}

export function hasBake(owned: BakeFuda[], id: string): boolean {
  return owned.some(b => b.id === id)
}

// ── Deck construction ─────────────────────────────────────────────────────
export function makeDeck(): Card[] {
  let id = 0
  const c = (month: number, kind: Kind, pts: number, motif: string, tanColor?: TanColor, isRain = false): Card => {
    const lblPfx = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'][month - 1]
    const plant = ['松','梅','桜','藤','菖蒲','牡丹','萩','芒','菊','紅葉','柳','桐'][month - 1]
    return { id: id++, month, kind, pts, isRain, motif, label: `${lblPfx}・${plant}`, tanColor }
  }

  return [
    // 1月 松
    c(1,'ko',  20,'crane'),
    c(1,'tan',  5,'tan','red'),
    c(1,'kasu', 1,'plain'),
    c(1,'kasu', 1,'plain'),
    // 2月 梅
    c(2,'tane',10,'warbler'),
    c(2,'tan',  5,'tan','red'),
    c(2,'kasu', 1,'plain'),
    c(2,'kasu', 1,'plain'),
    // 3月 桜
    c(3,'ko',  20,'curtain'),
    c(3,'tan',  5,'tan','red'),
    c(3,'kasu', 1,'plain'),
    c(3,'kasu', 1,'plain'),
    // 4月 藤
    c(4,'tane',10,'cuckoo'),
    c(4,'tan',  5,'tan','plain'),
    c(4,'kasu', 1,'plain'),
    c(4,'kasu', 1,'plain'),
    // 5月 菖蒲
    c(5,'tane',10,'bridge'),
    c(5,'tan',  5,'tan','plain'),
    c(5,'kasu', 1,'plain'),
    c(5,'kasu', 1,'plain'),
    // 6月 牡丹
    c(6,'tane',10,'butterfly'),
    c(6,'tan',  5,'tan','blue'),
    c(6,'kasu', 1,'plain'),
    c(6,'kasu', 1,'plain'),
    // 7月 萩
    c(7,'tane',10,'boar'),
    c(7,'tan',  5,'tan','plain'),
    c(7,'kasu', 1,'plain'),
    c(7,'kasu', 1,'plain'),
    // 8月 芒
    c(8,'ko',  20,'moon'),
    c(8,'tane',10,'geese'),
    c(8,'kasu', 1,'plain'),
    c(8,'kasu', 1,'plain'),
    // 9月 菊
    c(9,'tane',10,'cup'),
    c(9,'tan',  5,'tan','blue'),
    c(9,'kasu', 1,'plain'),
    c(9,'kasu', 1,'plain'),
    // 10月 紅葉
    c(10,'tane',10,'deer'),
    c(10,'tan',  5,'tan','blue'),
    c(10,'kasu', 1,'plain'),
    c(10,'kasu', 1,'plain'),
    // 11月 柳
    c(11,'ko',  20,'rain', undefined, true),  // isRain = true
    c(11,'tane',10,'swallow'),
    c(11,'tan',  5,'tan','plain'),
    c(11,'kasu', 1,'plain'),
    // 12月 桐
    c(12,'ko',  20,'phoenix'),
    c(12,'kasu', 1,'plain'),
    c(12,'kasu', 1,'plain'),
    c(12,'kasu', 1,'plain'),
  ]
}

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Role evaluation (for a single play = selected cards) ──────────────────
export function evaluateRole(cards: Card[], treatRainAsKo: boolean): RoleResult {
  if (cards.length === 0) return { role: 'none', multi: 1 }

  const isKo = (card: Card) => card.kind === 'ko' || (treatRainAsKo && card.isRain)
  const hasRainKo = !treatRainAsKo && cards.some(c => c.isRain && c.kind === 'ko')

  const koCards = cards.filter(isKo)
  const koCount = koCards.length
  const koMonths = new Set(koCards.map(c => c.month))

  // 五光: all 5 hikari (months 1,3,8,11,12)
  if (koCount >= 5 && [1,3,8,11,12].every(m => koMonths.has(m))) {
    return { role: 'gogko', multi: 15 }
  }

  // 四光 dry (4+ ko, no rain)
  if (koCount >= 4 && !hasRainKo) {
    return { role: 'yonko_dry', multi: 12 }
  }

  // 雨四光 (4+ ko including rain)
  if (koCount >= 4 && hasRainKo) {
    return { role: 'yonko_rain', multi: 10 }
  }

  // 三光: 3+ ko excluding rain (if rain included it's just not 三光)
  const nonRainKo = cards.filter(c => c.kind === 'ko' && (treatRainAsKo || !c.isRain))
  if (nonRainKo.length >= 3) {
    return { role: 'sanko', multi: 8 }
  }

  // Month counts for 同月 checks
  const monthCounts: Record<number, number> = {}
  for (const card of cards) monthCounts[card.month] = (monthCounts[card.month] || 0) + 1
  const maxSameMonth = Math.max(...Object.values(monthCounts))

  // 四重ネ: all 4 cards of same month
  if (maxSameMonth >= 4) return { role: 'dotsuki4', multi: 7 }

  // 猪鹿蝶
  const hasBoar      = cards.some(c => c.motif === 'boar')
  const hasDeer      = cards.some(c => c.motif === 'deer')
  const hasButterfly = cards.some(c => c.motif === 'butterfly')
  if (hasBoar && hasDeer && hasButterfly) return { role: 'inoshikacho', multi: 7 }

  // 赤短: 3+ red tan
  const redTan  = cards.filter(c => c.kind === 'tan' && c.tanColor === 'red').length
  if (redTan >= 3) return { role: 'akatan', multi: 6 }

  // 青短: 3+ blue tan
  const blueTan = cards.filter(c => c.kind === 'tan' && c.tanColor === 'blue').length
  if (blueTan >= 3) return { role: 'aotan', multi: 6 }

  // 花見酒: 桜幕(3月光) + 菊盃(9月タネ)
  if (cards.some(c => c.motif === 'curtain') && cards.some(c => c.motif === 'cup')) {
    return { role: 'hanamizan', multi: 5 }
  }

  // 月見酒: 芒月(8月光) + 菊盃
  if (cards.some(c => c.motif === 'moon') && cards.some(c => c.motif === 'cup')) {
    return { role: 'tsukimizake', multi: 5 }
  }

  // 同月三
  if (maxSameMonth >= 3) return { role: 'dotsuki3', multi: 4 }

  // タネ三
  if (cards.filter(c => c.kind === 'tane').length >= 3) return { role: 'tane3', multi: 3 }

  // 短冊三
  if (cards.filter(c => c.kind === 'tan').length >= 3) return { role: 'tan3', multi: 3 }

  // 塵積: 5+ kasu
  if (cards.filter(c => c.kind === 'kasu').length >= 5) return { role: 'kasu5', multi: 3 }

  // 同月二
  if (maxSameMonth >= 2) return { role: 'dotsuki2', multi: 2 }

  return { role: 'none', multi: 1 }
}

const DOTSUKI_ROLES: RoleId[] = ['dotsuki4', 'dotsuki3', 'dotsuki2']

// ── Full score calculation ────────────────────────────────────────────────
export function calcScore(ctx: ScoreContext): ScoreResult {
  const { selected, bake, deckSize, completedNights, isFirstPlay, isLastPlay, windBonus, bossId } = ctx

  // Raw pts (boss 雨鬼 zeroes rain cards)
  let rawPts = 0
  for (const card of selected) {
    if (bossId === 'rain' && card.isRain) continue
    rawPts += card.pts
  }

  const bakeEffects: BakeEffect[] = []

  // 締めの舞: last play doubles raw pts
  if (isLastPlay && hasBake(bake, 'shimemai')) {
    bakeEffects.push({ id: 'shimemai', ptsDelta: rawPts, multiDelta: 0 })
    rawPts *= 2
  }

  // Flat point bonuses
  const koInSel   = selected.filter(c => c.kind === 'ko').length
  const tanInSel  = selected.filter(c => c.kind === 'tan').length
  const kasuInSel = selected.filter(c => c.kind === 'kasu').length

  let flatBonus = 0

  if (hasBake(bake, 'tsuki') && koInSel > 0) {
    const delta = 20 * koInSel
    flatBonus += delta
    bakeEffects.push({ id: 'tsuki', ptsDelta: delta, multiDelta: 0 })
  }
  if (hasBake(bake, 'ito') && tanInSel > 0) {
    const delta = 15 * tanInSel
    flatBonus += delta
    bakeEffects.push({ id: 'ito', ptsDelta: delta, multiDelta: 0 })
  }
  if (hasBake(bake, 'furumai') && selected.length === 5) {
    flatBonus += 60
    bakeEffects.push({ id: 'furumai', ptsDelta: 60, multiDelta: 0 })
  }
  if (windBonus > 0) {
    flatBonus += windBonus
    bakeEffects.push({ id: 'kaze', ptsDelta: windBonus, multiDelta: 0 })
  }

  const basePts = rawPts + flatBonus

  // Role evaluation
  const treatRain = hasBake(bake, 'kitsune')
  const { role, multi: baseRoleMulti } = evaluateRole(selected, treatRain)

  // 猪突: double 猪鹿蝶 multiplier
  let roleMulti = baseRoleMulti
  if (role === 'inoshikacho' && hasBake(bake, 'cho')) {
    roleMulti *= 2
    bakeEffects.push({ id: 'cho', ptsDelta: 0, multiDelta: roleMulti - baseRoleMulti })
  }

  // 律義者: no-role → x2
  if (role === 'none' && hasBake(bake, 'rijgi')) {
    roleMulti = 2
    bakeEffects.push({ id: 'rijgi', ptsDelta: 0, multiDelta: 1 })
  }

  // Multi bonuses
  let multiBonus = 0

  if (hasBake(bake, 'hyakki') && kasuInSel > 0) {
    const delta = Math.round(0.8 * kasuInSel * 10) / 10
    multiBonus += delta
    bakeEffects.push({ id: 'hyakki', ptsDelta: 0, multiDelta: delta })
  }
  if (hasBake(bake, 'mikazuki') && selected.length === 3) {
    multiBonus += 2
    bakeEffects.push({ id: 'mikazuki', ptsDelta: 0, multiDelta: 2 })
  }
  if (hasBake(bake, 'hayazaki') && isFirstPlay) {
    multiBonus += 3
    bakeEffects.push({ id: 'hayazaki', ptsDelta: 0, multiDelta: 3 })
  }
  if (hasBake(bake, 'sakazuki') && selected.some(c => c.motif === 'cup')) {
    multiBonus += 3
    bakeEffects.push({ id: 'sakazuki', ptsDelta: 0, multiDelta: 3 })
  }
  if (hasBake(bake, 'kotto') && DOTSUKI_ROLES.includes(role)) {
    multiBonus += 2
    bakeEffects.push({ id: 'kotto', ptsDelta: 0, multiDelta: 2 })
  }
  if (hasBake(bake, 'yamawake') && deckSize <= 20) {
    multiBonus += 2
    bakeEffects.push({ id: 'yamawake', ptsDelta: 0, multiDelta: 2 })
  }
  if (hasBake(bake, 'shochikubai') && selected.every(c => c.month <= 3)) {
    multiBonus += 3
    bakeEffects.push({ id: 'shochikubai', ptsDelta: 0, multiDelta: 3 })
  }
  if (hasBake(bake, 'chochin')) {
    const delta = 1 + 0.5 * completedNights
    multiBonus += delta
    bakeEffects.push({ id: 'chochin', ptsDelta: 0, multiDelta: delta })
  }

  const totalMulti = roleMulti + multiBonus
  const total = Math.max(1, Math.floor(basePts * totalMulti))

  return {
    total, rawPts, flatBonus, basePts,
    roleMulti, multiBonus, totalMulti,
    role, roleName: ROLE_NAME[role],
    bakeEffects,
  }
}

// ── Night reward calculation ──────────────────────────────────────────────
export function calcReward(playsLeft: number, wallet: number, owned: BakeFuda[]): number {
  const base    = 4
  const leftPts = playsLeft
  const interest = Math.min(3, Math.floor(wallet / 5))
  const shukin   = hasBake(owned, 'shukin') ? 2 : 0
  return base + leftPts + interest + shukin
}

// ── Shop helpers ──────────────────────────────────────────────────────────
export function shopOffer(available: BakeFuda[], owned: BakeFuda[]): BakeFuda[] {
  const ownedIds = new Set(owned.map(b => b.id))
  const pool = available.filter(b => !ownedIds.has(b.id))
  if (pool.length === 0) return []

  // Vary by category: try to pick one from each of 3 different categories
  const byCategory: Record<string, BakeFuda[]> = {}
  for (const b of shuffle(pool)) {
    if (!byCategory[b.category]) byCategory[b.category] = []
    byCategory[b.category].push(b)
  }

  const cats = Object.values(byCategory)
  const result: BakeFuda[] = []
  // Round-robin by category
  let ci = 0
  while (result.length < 3 && result.length < pool.length) {
    const cat = cats[ci % cats.length]
    const pick = cat.find(b => !result.includes(b))
    if (pick) result.push(pick)
    ci++
    if (ci > cats.length * 10) break // safety
  }
  return result.slice(0, 3)
}

export function sellPrice(b: BakeFuda, owned: BakeFuda[]): number {
  if (hasBake(owned, 'shichiya')) return b.price
  return Math.ceil(b.price / 2)
}
