// 『そろえて、しるす。』ローグライク・エントリ。拠点（旧・縦断面図マップ流用）⇄ 層プレイの2シーン構成。
// ROGUE.md 準拠（第3弾b＝ラン進行の実装）。旧30レベル制の画面遷移は廃止。
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS30 as LEVELS } from './core/levels30'
import { createRunState, type RunState } from './core/run'
import { FLOORS } from './core/floors'
import {
  UPGRADES,
  type UpgradeDef,
  AUTONOMOUS_MECHANISM_ID,
  MECHANICAL_GARDEN_ID,
  MIMIC_SLIME_ID,
  PREHEAT_ID,
  RELIC_RESONANCE_ID,
  RESONANT_SHATTER_ID,
  SPORE_BULLET_ID,
  VINE_ROCKET_ID,
} from './core/upgrades'
import { buildRunName, UPGRADE_CATEGORY, type UpgradeCategory } from './core/runname'
import { makeRng, randInt, type Rng } from './core/rng'
import { BoardView } from './view/BoardView'
import { PAL, depthBadgeTexture, loadSprites, spriteTexture, themeForLevel, upgradeIconTexture } from './view/pieces'
import { loadSave, type SaveData } from './core/save'
import { enemyIntent, ENEMY_ATTACK_DAMAGE, SWARM_ATTACK_PERIOD, type EnemyInstance } from './core/enemies'
import type { BoardEvent, EnemyKind, LevelDef, XY } from './core/types'
import { GLOSSARY, findTerm, type GlossaryEntry } from './core/glossary'
import * as tw from './juice/tween'
import { sfx, startBgm, toggleMute, isMuted } from './juice/sound'

const UI = {
  wood: 0x4a3b28,
  woodLight: 0x6b5238,
  brass: 0xd9a441,
  paper: 0xe8d9b0,
  paperInk: 0x4a3a24,
  badgeText: 0xfff4dc,
} as const

// 古い図鑑ふうの明朝（index.html で読み込み。未着ならserifへフォールバック）
const FONT = '"Shippori Mincho", serif'

// ---- ラン記録（拠点の「さいこう とうたつ」表示。ROGUE.md §8） ----
const ROGUE_BEST_KEY = 'yacho-rogue-best'
const loadRogueBest = (): number => {
  const n = Number(localStorage.getItem(ROGUE_BEST_KEY) ?? '0')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
const saveRogueBest = (floor: number) => {
  if (floor > loadRogueBest()) localStorage.setItem(ROGUE_BEST_KEY, String(floor))
}

/** 層番号→テーマ疑似ID（themeForLevel流用。1-4=森/5-8=機械/9-10=結晶。ROGUE.md §6/§9） */
const themeFloorId = (floor: number) => (floor <= 4 ? floor : floor <= 8 ? floor + 10 : floor + 20)

/** 所持強化バーのアイコン：系統1色に対応する駒テクスチャキー（pieces.ts の n0〜n3。可視化第一波②） */
const CATEGORY_ICON: Record<string, string> = { gear: 'n0', plant: 'n1', mineral: 'n2', relic: 'n3' }
/** 異種シナジー強化は単一系統に還元できないため、2系統のテクスチャを斜め半分ずつ重ねる簡易表現 */
const SYNERGY_HALVES: Record<string, [string, string]> = {
  'vine-rocket': ['n1', 'n0'],
  'spore-bullet': ['n0', 'n1'],
  'mechanical-garden': ['n0', 'n1'],
  'relic-root': ['n3', 'n1'],
}

/**
 * 層1つぶんの盤面定義。ローグは手数制・ゴール駒を廃止（ROGUE.md §6：勝敗は敵殲滅とHPで判定）。
 * 旧LevelDefの moves/goals は Board.won/lost 判定にしか使わないため、実質発火しない値で埋めて無効化する。
 */
const buildFloorLevelDef = (floor: number, seed: number): LevelDef => ({
  id: floor,
  seed,
  moves: 9999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999999 }],
  layout: Array(8).fill('........'),
})

/** 所持強化とのシナジー判定（簡易版）：系統一致 or フック種が同じ＝「因果が繋がる」とみなす（ROGUE.md §4） */
function isSynergyWith(owned: UpgradeDef[], candidate: UpgradeDef): boolean {
  const candCat = UPGRADE_CATEGORY[candidate.id]
  for (const o of owned) {
    if (UPGRADE_CATEGORY[o.id] === candCat) return true
    for (const oh of o.hooks) for (const ch of candidate.hooks) if (oh.on === ch.on) return true
  }
  return false
}

// ---- ドラフトカード情報設計（codex_consult_rogue.md [B]。left切れ修正の第4波で全面差し替え） ----

/** ドラフトカード見出し帯の系統ラベル（色だけに頼らず文字でも示す。UPGRADE_CATEGORYのカテゴリ→日本語1〜2字） */
const CATEGORY_LABEL: Record<UpgradeCategory, string> = { plant: '植物', mineral: '鉱物', gear: 'ギア', relic: '遺物', synergy: '異種' }

/**
 * upgrades.tsのdescを「条件」「効果」に機械的に分割する（[B]：〜すると、〜を2行へ。割れない場合は効果1行のみ）。
 * 接続語+読点の位置で切るだけで、文言そのものは変更しない（分割不能なら condition は null）。
 */
const COND_MARKERS = ['とき、', 'たび、', 'たら、', 'なら、', '時、', 'と、']
function splitDesc(desc: string): { condition: string | null; effect: string } {
  let hitIdx = -1
  let hitMarker = ''
  for (const marker of COND_MARKERS) {
    const idx = desc.indexOf(marker)
    if (idx >= 0 && (hitIdx === -1 || idx < hitIdx)) {
      hitIdx = idx
      hitMarker = marker
    }
  }
  if (hitIdx === -1) return { condition: null, effect: desc }
  return { condition: desc.slice(0, hitIdx + hitMarker.length - 1), effect: desc.slice(hitIdx + hitMarker.length) }
}

// ---- 読めるシナジー表示（codex_consult_ui.md [D]：金文字の名前羅列をやめ、因果の一文にする） ----
// 各強化が「盤面に何を供給し（produces）」「何を消費して発火するか（consumes）」を手作業でタグ付けする。
// upgrades.ts の hooks は on種別のみで内容までは表せないため、この表は実装の実挙動（起動条件テキストと一致）を
// 見て作った近似表。目的は「必ず正しい因果グラフ」ではなく「繋がりを説明できる一文」を機械的に組み立てること。
const RESOURCE_LABEL: Record<string, string> = {
  spore: '胞子',
  ore: '爆発鉱石',
  special: '特殊駒',
  gearPiece: 'ギアの駒',
  relicBoost: '遺物の共鳴',
  plantPiece: '植物の駒',
}
const UPGRADE_PRODUCES: Record<string, string[]> = {
  'spore-bloom': ['spore'],
  'fungal-awakening': ['plantPiece'],
  'deep-breath': ['plantPiece'],
  'root-eating-ore': ['ore'],
  'crystal-bud': ['ore'],
  [AUTONOMOUS_MECHANISM_ID]: ['special'],
  [PREHEAT_ID]: ['gearPiece'],
  [RELIC_RESONANCE_ID]: ['relicBoost'],
  'gamblers-pot': ['special'],
  [VINE_ROCKET_ID]: ['plantPiece'],
  [SPORE_BULLET_ID]: ['spore'],
  [MECHANICAL_GARDEN_ID]: ['plantPiece'],
  'relic-root': ['spore'],
}
const UPGRADE_CONSUMES: Record<string, string[]> = {
  'spore-bloom': ['plantPiece'],
  'fungal-awakening': ['plantPiece'],
  'toxic-spore': ['spore'],
  'deep-breath': ['plantPiece'],
  'root-eating-ore': ['spore'],
  [RESONANT_SHATTER_ID]: ['ore'],
  'magnetic-mining': ['ore', 'gearPiece'],
  [AUTONOMOUS_MECHANISM_ID]: ['gearPiece'],
  overrev: ['gearPiece'],
  [RELIC_RESONANCE_ID]: ['gearPiece'],
  'transformation-furnace': ['relicBoost'],
  [VINE_ROCKET_ID]: ['plantPiece'],
  [SPORE_BULLET_ID]: ['special'],
  [MECHANICAL_GARDEN_ID]: ['gearPiece'],
}
/** 発火のきっかけ（[D]接続の型③「同じきっかけで発動が重なる」用。produces/consumesで説明が付かない時のみ使う） */
const UPGRADE_TRIGGER: Record<string, string> = {
  'spore-bloom': '植物のマッチ',
  'fungal-awakening': '植物のマッチ',
  'toxic-spore': '胞子との接触',
  'deep-breath': 'キノコのマッチ',
  'root-eating-ore': '胞子との接触',
  'mining-habit': '鉱物のマッチ',
  'crystal-bud': '鉱物のマッチ',
  'magnetic-mining': '爆発とギア',
  [AUTONOMOUS_MECHANISM_ID]: 'ギア起動',
  overrev: 'ギアのマッチ',
  [PREHEAT_ID]: '層のはじめ',
  [RELIC_RESONANCE_ID]: 'ギア起動',
  [MIMIC_SLIME_ID]: '遺物のマッチ',
  'transformation-furnace': '遺物のマッチ',
  'gamblers-pot': '遺物のマッチ',
  [VINE_ROCKET_ID]: 'レンチ銛の発射',
  [SPORE_BULLET_ID]: '火壺の発動',
  [MECHANICAL_GARDEN_ID]: 'ギア起動',
  'relic-root': '遺物のマッチ',
}
/** カード本文「効果」の要約（接続一文に埋め込む短縮版。読点までを最大16字で切る） */
function shortEffect(def: UpgradeDef): string {
  const head = splitDesc(def.desc).effect.split('、')[0]
  return head.length > 16 ? head.slice(0, 16) + '…' : head
}
interface ConnectionInfo {
  count: number
  sentence: string | null
}
/**
 * 所持強化群 対 候補1枚の「読めるシナジー」（[D]：名前の羅列でなく因果の一文）。
 * 型は優先度順に4種：①所持が作る資源を候補が使う ②候補が作る資源を所持が使う ③同じきっかけで発動が重なる
 * ④同じ系統（フォールバック）。countは所持のうちどれか1つでも当てはまった数（バッジの「接続 N」）、
 * sentenceは最も説明力の高い1件だけを代表として出す（複数を連結すると長くなりすぎるため）。
 */
function computeConnection(owned: UpgradeDef[], candidate: UpgradeDef): ConnectionInfo {
  const candProduces = UPGRADE_PRODUCES[candidate.id] ?? []
  const candConsumes = UPGRADE_CONSUMES[candidate.id] ?? []
  const candTrigger = UPGRADE_TRIGGER[candidate.id]
  const candCat = UPGRADE_CATEGORY[candidate.id]
  const kindRank = { produce: 0, consume: 1, trigger: 2, category: 3 } as const
  let best: { rank: number; sentence: string } | null = null
  let count = 0
  for (const o of owned) {
    const oProduces = UPGRADE_PRODUCES[o.id] ?? []
    const oConsumes = UPGRADE_CONSUMES[o.id] ?? []
    const produced = oProduces.find((r) => candConsumes.includes(r))
    const consumed = candProduces.find((r) => oConsumes.includes(r))
    let kind: keyof typeof kindRank | null = null
    let sentence = ''
    if (produced) {
      kind = 'produce'
      sentence = `${o.name}で作る${RESOURCE_LABEL[produced]} → この強化で${shortEffect(candidate)}`
    } else if (consumed) {
      kind = 'consume'
      sentence = `この強化が作る${RESOURCE_LABEL[consumed]} → ${o.name}が使う`
    } else if (candTrigger && UPGRADE_TRIGGER[o.id] === candTrigger) {
      kind = 'trigger'
      sentence = `${o.name}と同じ「${candTrigger}」で発動が重なる`
    } else if (UPGRADE_CATEGORY[o.id] === candCat) {
      kind = 'category'
      sentence = `${o.name}と同じ${CATEGORY_LABEL[candCat] ?? ''}系統`
    }
    if (!kind) continue
    count++
    const rank = kindRank[kind]
    if (!best || rank < best.rank) best = { rank, sentence }
  }
  return { count, sentence: best?.sentence ?? null }
}

/**
 * ドラフト3択（ROGUE.md §4）：所持済みとシナジーする2枠＋無関係1枠。同一強化の重複なし。
 * 所持0（初回ドラフト）はシナジー元が無いので自然に3枠ともランダムになる。
 */
function pickDraftOptions(ownedIds: string[], rng: Rng): UpgradeDef[] {
  const owned = UPGRADES.filter((u) => ownedIds.includes(u.id))
  let remaining = UPGRADES.filter((u) => !ownedIds.includes(u.id))
  const take = (pred: (u: UpgradeDef) => boolean): UpgradeDef | null => {
    const cands = remaining.filter(pred)
    if (!cands.length) return null
    const picked = cands[randInt(rng, cands.length)]
    remaining = remaining.filter((u) => u.id !== picked.id)
    return picked
  }
  const synergy = (u: UpgradeDef) => isSynergyWith(owned, u)
  const picks: UpgradeDef[] = []
  for (let i = 0; i < 2; i++) {
    const p = take(synergy) ?? take(() => true)
    if (p) picks.push(p)
  }
  const off = take((u) => !synergy(u)) ?? take(() => true)
  if (off) picks.push(off)
  // 表示順をシャッフル（決定的）
  for (let i = picks.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1)
    ;[picks[i], picks[j]] = [picks[j], picks[i]]
  }
  return picks
}

// ボスの表示名（下の ENEMY_INFO.boss.name と同一の呼称。ボス以外はチップに個体名を出さないため他は複製しない）
const BOSS_NAME = '巨大深層生物'

// =============== 野帳シート：共通ボトムシート（codex_consult_ui.md [C]） ===============
// 強化ポップ・敵ツールチップの2実装を統合する中核データ・エンジン部分（モジュール直下＝vw/vhに依存しない純粋関数群）。
// 実際にシートを開閉する状態機械（vw/vh/playRoot/inputLockedを使う）は boot() 内 showFieldNote() が持つ。

type FieldNoteIcon = (size: number) => Container
interface FieldNoteRowBlock {
  kind: 'row'
  label: string
  text: string
}
interface FieldNoteTextBlock {
  kind: 'text'
  text: string
}
interface FieldNoteItemsBlock {
  kind: 'items'
  items: { icon: FieldNoteIcon; title: string; text: string }[]
}
type FieldNoteBlock = FieldNoteRowBlock | FieldNoteTextBlock | FieldNoteItemsBlock
interface FieldNoteEntry {
  /** 同一対象の再タップ判定＆用語シート切替のキー（例: `upgrade:${id}` / `enemy:${enemyId}` / `term:${id}`） */
  noteKey: string
  kindLabel: string // 見出し下の種別ラベル（強化/特殊駒/敵/用語のkind名）
  title: string
  icon: FieldNoteIcon
  blocks: FieldNoteBlock[]
}

// ---- 用語リンク（[C]用語リンクの実装方針）：termまたはaliasesが本文に現れたら最初の1回だけリンク化する ----
const GLOSSARY_MATCHERS = GLOSSARY.flatMap((g) => [{ id: g.id, text: g.term }, ...(g.aliases ?? []).map((a) => ({ id: g.id, text: a }))]).sort(
  (a, b) => b.text.length - a.text.length, // 長い語から優先照合（「敵インテント」等の複合語が部分一致に負けないように）
)
interface RichToken {
  text: string
  termId?: string
}
/** 本文を「用語トークン」と「地の文トークン」に分解する。usedTermsは呼び出し側が本文単位で使い回し、二重リンクを防ぐ */
function tokenizeRich(text: string, usedTerms: Set<string>): RichToken[] {
  const tokens: RichToken[] = []
  let i = 0
  let plain = ''
  const flush = () => {
    if (plain) {
      tokens.push({ text: plain })
      plain = ''
    }
  }
  scan: while (i < text.length) {
    for (const m of GLOSSARY_MATCHERS) {
      if (usedTerms.has(m.id) || !m.text) continue
      if (text.startsWith(m.text, i)) {
        flush()
        tokens.push({ text: m.text, termId: m.id })
        usedTerms.add(m.id)
        i += m.text.length
        continue scan
      }
    }
    plain += text[i]
    i++
  }
  flush()
  return tokens
}

/**
 * 用語ごとに独立したTextを並べて1行を組む簡易リッチテキスト（Textは矩形しか持たないため）。折り返しは行単位で自前計算する。
 * 用語トークンは点線下線＋小さな「?」を付け（色だけに頼らない）、タップで onTermTap を呼ぶ。
 * 用語タップはドラフトカード選択等の祖先へ伝播させないよう、必ず e.stopPropagation() する。戻り値＝本文の下端y。
 */
function layoutRichText(
  host: Container,
  measurer: Text,
  tokens: RichToken[],
  x0: number,
  y0: number,
  maxW: number,
  fontSize: number,
  color: number,
  linkColor: number,
  onTermTap: (id: string) => void,
): number {
  const lineH = fontSize * 1.56
  let x = x0
  let y = y0
  measurer.style.fontSize = fontSize // 呼び出しごとにサイズが違う（シート本文/カード本文）ため、都度measurerへ反映する
  const measure = (s: string) => {
    measurer.text = s
    return measurer.width
  }
  const placeTerm = (text: string, termId: string) => {
    const t = new Text({ text, style: { fill: linkColor, fontSize, fontFamily: FONT, fontWeight: 'bold', breakWords: true } })
    t.position.set(x, y)
    host.addChild(t)
    const uw = t.width
    const underline = new Graphics()
    const dash = fontSize * 0.22
    const gap = fontSize * 0.16
    for (let dx = 0; dx < uw; dx += dash + gap)
      underline
        .moveTo(x + dx, y + t.height - 1)
        .lineTo(x + Math.min(dx + dash, uw), y + t.height - 1)
        .stroke({ width: 1.4, color: linkColor, alpha: 0.9 })
    host.addChild(underline)
    // 監査[C]8：「?」を本文ベースラインへ割り込ませると `遺物?を` と読めて文章が壊れる。
    // 主記号は点線下線だけにし、識別は下線の色と太さで担う（校正記号に見せない）
    const hitW = uw + fontSize * 0.2
    const hitH = t.height + fontSize * 0.3
    const hit = new Container()
    hit.position.set(x - fontSize * 0.08, y - fontSize * 0.12)
    hit.hitArea = { contains: (lx: number, ly: number) => lx >= 0 && lx <= hitW && ly >= 0 && ly <= hitH }
    hit.eventMode = 'static'
    hit.cursor = 'pointer'
    hit.on('pointertap', (e) => {
      e.stopPropagation() // カード選択・シート開閉タップへ伝播させない（[C]用語リンクの実装方針）
      onTermTap(termId)
    })
    host.addChild(hit)
    x += uw
  }
  const placePlain = (str: string) => {
    const t = new Text({ text: str, style: { fill: color, fontSize, fontFamily: FONT } })
    t.position.set(x, y)
    host.addChild(t)
    x += t.width
  }
  for (const tok of tokens) {
    if (tok.termId) {
      const w = measure(tok.text) + fontSize * 0.9
      if (x > x0 && x + w > x0 + maxW) {
        x = x0
        y += lineH
      }
      placeTerm(tok.text, tok.termId)
      continue
    }
    let s = tok.text
    while (s.length) {
      if (x >= x0 + maxW - 1 && x > x0) {
        x = x0
        y += lineH
      }
      let n = 0
      let cur = ''
      for (; n < s.length; n++) {
        const cand = cur + s[n]
        if (measure(cand) > x0 + maxW - x) break
        cur = cand
      }
      if (n === 0) n = 1 // 1文字も入らない幅でも無限ループにしない（最低1文字は強制的に置く）
      placePlain(s.slice(0, n))
      s = s.slice(n)
      if (s.length) {
        x = x0
        y += lineH
      }
    }
  }
  return y + lineH
}

// ---- 野帳シートのアイコン（ビルドドックの描き方を簡略再利用。素材キーは spriteTexture(...) ?? null で必ずフォールバック） ----
function makeUpgradeIconContainer(id: string, size: number): Container {
  const c = new Container()
  const medalTex = spriteTexture('ui_medal')
  if (medalTex) {
    const base = new Sprite(medalTex)
    base.anchor.set(0.5)
    base.scale.set((size * 1.15) / Math.max(medalTex.width, medalTex.height))
    c.addChild(base)
  }
  const cat = UPGRADE_CATEGORY[id]
  if (cat === 'synergy') {
    const [a, b] = SYNERGY_HALVES[id] ?? ['n1', 'n0']
    const r = size / 2
    ;([
      [a, 'l'],
      [b, 'r'],
    ] as const).forEach(([key, side]) => {
      const tex = spriteTexture(key)
      if (!tex) return
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set((size * 0.62) / Math.max(tex.width, tex.height))
      const mask = new Graphics()
      if (side === 'l') mask.moveTo(-r, -r).lineTo(r, -r).lineTo(-r, r).closePath().fill(0xffffff)
      else mask.moveTo(r, -r).lineTo(r, r).lineTo(-r, r).closePath().fill(0xffffff)
      sp.mask = mask
      c.addChild(mask, sp)
    })
  } else {
    const tex = spriteTexture(CATEGORY_ICON[cat] ?? 'n1')
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set((size * 0.64) / Math.max(tex.width, tex.height))
      c.addChild(sp)
    }
  }
  return c
}

/**
 * ドラフトv2の固有アイコン（codex_consult_ui.md [D]強化アイコン体系）。
 * upgradeIconTexture(id) があれば専用グリフをそのまま描き、無ければ既存の系統駒テクスチャ表現
 * （makeUpgradeIconContainer＝メダル台+系統色）へフォールバックする（基盤メモの指示どおり）。
 */
function makeUniqueUpgradeIcon(id: string, size: number): Container {
  const tex = upgradeIconTexture(id)
  if (!tex) return makeUpgradeIconContainer(id, size)
  const c = new Container()
  const sp = new Sprite(tex)
  sp.anchor.set(0.5)
  sp.scale.set(size / Math.max(tex.width, tex.height))
  c.addChild(sp)
  return c
}

// ---- 接続バッジの見た目（[D]：金文字をやめ、濃い深界ティール地×古紙色文字×鎖アイコン×枠線2pxへ） ----
const CONN_BG = 0x1e4d5c
const CONN_TEXT = 0xf4e8cf
/** 鎖アイコン：連結した2つの角丸リング（絵文字を使わず、コード描画で個性を出す） */
function chainGlyph(size: number): Graphics {
  const g = new Graphics()
  const w = size * 0.62
  const h = size * 0.42
  const lw = Math.max(1.4, size * 0.16)
  g.roundRect(-w * 0.52, -h / 2, w * 0.58, h, h / 2).stroke({ width: lw, color: CONN_TEXT })
  g.roundRect(-w * 0.06, -h / 2, w * 0.58, h, h / 2).stroke({ width: lw, color: CONN_TEXT })
  return g
}
/** 接続バッジを host のローカル座標(x,y)を左上に描く。戻り値はバッジ下端のy（後続要素の積み上げ用） */
function drawConnectionChip(host: Container, x: number, y: number, maxW: number, text: string, fontSize: number): number {
  const padX = fontSize * 0.55
  const padY = fontSize * 0.4
  const iconSize = fontSize * 1.1
  const textX = x + padX * 2 + iconSize
  const textMaxW = Math.max(30, maxW - (textX - x) - padX)
  const label = new Text({
    text,
    style: { fill: CONN_TEXT, fontSize, fontFamily: FONT, fontWeight: 'bold', wordWrap: true, wordWrapWidth: textMaxW, breakWords: true, lineHeight: fontSize * 1.35 },
  })
  const chipH = Math.max(iconSize + padY * 2, label.height + padY * 2)
  const chipW = Math.min(maxW, textX - x + label.width + padX)
  const bg = new Graphics()
  bg.roundRect(x, y, chipW, chipH, chipH * 0.32).fill({ color: CONN_BG, alpha: 0.95 }).stroke({ width: 2, color: UI.brass, alpha: 0.9 })
  host.addChild(bg)
  const icon = chainGlyph(iconSize)
  icon.position.set(x + padX + iconSize / 2, y + chipH / 2)
  host.addChild(icon)
  label.position.set(textX, y + (chipH - label.height) / 2)
  host.addChild(label)
  return y + chipH
}
const ENEMY_ICON_TEX: Partial<Record<EnemyKind, string>> = { rockshell: 'kokeishi', sporeling: 'subi', swarm: 'e_swarm', boss: 'hako' }
function makeEnemyIconContainer(kind: EnemyKind, size: number): Container {
  const c = new Container()
  const tex = spriteTexture(ENEMY_ICON_TEX[kind] ?? '') ?? null
  if (tex) {
    const sp = new Sprite(tex)
    sp.anchor.set(0.5)
    sp.scale.set((size * 0.86) / Math.max(tex.width, tex.height))
    c.addChild(sp)
  } else {
    const g = new Graphics()
    g.circle(0, 0, size * 0.42).fill(0x3a4048).stroke({ width: 2, color: 0x8a94a0 })
    c.addChild(g)
  }
  return c
}
function makeSpecialIconContainer(spriteKey: string, size: number): Container {
  const c = new Container()
  const tex = spriteTexture(spriteKey) ?? null
  if (tex) {
    const sp = new Sprite(tex)
    sp.anchor.set(0.5)
    sp.scale.set((size * 0.82) / Math.max(tex.width, tex.height))
    c.addChild(sp)
  } else {
    const g = new Graphics()
    g.roundRect(-size * 0.36, -size * 0.36, size * 0.72, size * 0.72, size * 0.14).fill(UI.brass)
    c.addChild(g)
  }
  return c
}
function makeTermIconContainer(size: number): Container {
  const c = new Container()
  const g = new Graphics()
  g.circle(0, 0, size * 0.44)
    .fill({ color: 0x2a1c10, alpha: 0.92 })
    .stroke({ width: 2, color: UI.brass })
  c.addChild(g)
  const t = new Text({ text: '?', style: { fill: 0xf4e8cf, fontSize: size * 0.5, fontFamily: FONT, fontWeight: 'bold' } })
  t.anchor.set(0.5)
  c.addChild(t)
  return c
}

// ---- 敵の野帳データ（実装の実挙動と一致させる。enemies.ts/board.ts を読んで確認済み） ----
interface EnemyInfoEntry {
  name: string
  attackDesc: string
  disruptDesc: string | null
  defeatDesc: string
  retreatDesc?: string
}
const ENEMY_INFO: Record<EnemyKind, EnemyInfoEntry> = {
  rockshell: {
    name: '岩殻獣',
    attackDesc: `探窟隊に${ENEMY_ATTACK_DAMAGE.rockshell}ダメージを与える`,
    disruptDesc: '鉱物ひとつに甲殻をまとわせる（甲殻はもう1回壊さないと消えない）',
    defeatDesc: '隣接するマスで駒を消すとダメージが入る。HPが尽きると撃破',
  },
  sporeling: {
    name: '胞子獣',
    attackDesc: `探窟隊に${ENEMY_ATTACK_DAMAGE.sporeling}ダメージを与える`,
    disruptDesc: '植物ひとつを毒胞子に変える（消すと探窟隊に1ダメージ）',
    defeatDesc: '隣接するマスで駒を消すとダメージが入る。HPが尽きると撃破',
  },
  burrower: {
    name: '穴潜み',
    attackDesc: `探窟隊に${ENEMY_ATTACK_DAMAGE.burrower}ダメージを与える`,
    disruptDesc: '空きマスを2手ふさいで自分は別のマスへ移る（封鎖は攻撃で解除できない）',
    defeatDesc: '隣接するマスで駒を消すとダメージが入る。HPが尽きると撃破',
  },
  swarm: {
    name: 'サンドバッグ',
    attackDesc: `探窟隊に${ENEMY_ATTACK_DAMAGE.swarm}ダメージを与える（${SWARM_ATTACK_PERIOD}手ごと）`,
    disruptDesc: null,
    defeatDesc: 'HP1で即撃破。1体倒すと隣接する仲間にもダメージが伝わり連鎖しやすい',
  },
  boss: {
    name: '巨大深層生物',
    attackDesc: `3手ごとに探窟隊全体へ${ENEMY_ATTACK_DAMAGE.boss}ダメージ`,
    disruptDesc: null,
    defeatDesc: '身体の前線行へダメージを与え続けるとHPが減る',
    retreatDesc: '累計5ダメージがたまるたび、身体の最上段1行が解放されて1行後退する',
  },
}

const SPECIAL_PIECE_LIST: { key: string; name: string; text: string }[] = [
  { key: 'harpoon', name: '銛（レンチ銛）', text: '駒の向きに合わせて、1列または1行をまとめて消す。' },
  { key: 'hamushi', name: '羽虫（コンパス甲虫）', text: '離陸地点の周囲を壊してから、目標へ飛んで壊す。' },
  { key: 'hitsubo', name: '火壺（歯車爆弾）', text: '着地点を中心に5×5マスを壊す。' },
  { key: 'seiju', name: '星珠（探窟ランタン）', text: '盤面でいちばん多い色をすべて消す。' },
]

/** 強化：プレイ中・ドラフト所持欄で共通（[C]表：名前・系統・条件→効果・進捗・獲得ボーナス） */
function buildUpgradeEntry(def: UpgradeDef, run: RunState): FieldNoteEntry {
  const cat = UPGRADE_CATEGORY[def.id]
  const { condition, effect } = splitDesc(def.desc)
  const blocks: FieldNoteBlock[] = [{ kind: 'row', label: '系統', text: CATEGORY_LABEL[cat] ?? '' }]
  if (condition) blocks.push({ kind: 'row', label: '条件', text: condition })
  blocks.push({ kind: 'row', label: '効果', text: effect })
  const progress = run.progress[def.id]
  if (progress) blocks.push({ kind: 'row', label: '進捗', text: `${Math.min(progress.cur, progress.max)} / ${progress.max}` })
  if (def.starterDesc) blocks.push({ kind: 'row', label: '獲得ボーナス', text: def.starterDesc.replace(/^おまけ[:：]\s*/, '') })
  return { noteKey: `upgrade:${def.id}`, kindLabel: '強化', title: def.name, icon: (size) => makeUpgradeIconContainer(def.id, size), blocks }
}

/** 所持強化 一覧：ドラフトv2の所持ストリップ「一覧」ボタンから開く（[D]：所持欄の`一覧`で全画面のビルド一覧） */
function buildOwnedListEntry(owned: UpgradeDef[]): FieldNoteEntry {
  const blocks: FieldNoteBlock[] = owned.length
    ? [{ kind: 'items', items: owned.map((u) => ({ icon: (size: number) => makeUniqueUpgradeIcon(u.id, size), title: u.name, text: splitDesc(u.desc).effect })) }]
    : [{ kind: 'text', text: 'まだ強化を所持していません。' }]
  return {
    noteKey: 'owned-list',
    kindLabel: '所持強化',
    title: `所持強化 一覧（${owned.length}）`,
    icon: (size) => (owned[0] ? makeUniqueUpgradeIcon(owned[0].id, size) : makeTermIconContainer(size)),
    blocks,
  }
}

/** 特殊駒：野帳ボタンから開く一覧（[C]表：4種の早見。効果は board.ts fireSpecial の実挙動と一致） */
function buildSpecialPieceEntry(): FieldNoteEntry {
  return {
    noteKey: 'special-pieces',
    kindLabel: '特殊駒',
    title: '特殊駒 早見表',
    icon: (size) => makeSpecialIconContainer('harpoon', size),
    blocks: [
      {
        kind: 'items',
        items: SPECIAL_PIECE_LIST.map((p) => ({ icon: (size: number) => makeSpecialIconContainer(p.key, size), title: p.name, text: p.text })),
      },
      { kind: 'text', text: '特殊駒どうしを隣り合わせて動かすと、組み合わせでさらに強力な効果が起きる。' },
    ],
  }
}

/** 敵：本体／インテントバッジのタップで開く（[C]表：名前・HP・次行動・与ダメージ・妨害内容・倒し方。ボスは後退条件も） */
function buildEnemyEntry(enemy: EnemyInstance): FieldNoteEntry {
  const info = ENEMY_INFO[enemy.kind]
  const intent = enemyIntent(enemy)
  const nextText = intent.kind === 'attack' ? `あと${intent.turns}手で攻撃（${intent.damage}ダメージ）` : `あと${intent.turns}手で妨害`
  const blocks: FieldNoteBlock[] = [
    { kind: 'row', label: 'HP', text: `${Math.max(0, enemy.hp)} / ${enemy.maxHp}` },
    { kind: 'row', label: '次行動', text: nextText },
    { kind: 'row', label: '与ダメージ', text: info.attackDesc },
    { kind: 'row', label: '妨害', text: info.disruptDesc ?? '妨害は行わない' },
    { kind: 'row', label: '倒し方', text: info.defeatDesc },
  ]
  if (info.retreatDesc) blocks.push({ kind: 'row', label: '後退条件', text: info.retreatDesc })
  return { noteKey: `enemy:${enemy.id}`, kindLabel: '敵', title: info.name, icon: (size) => makeEnemyIconContainer(enemy.kind, size), blocks }
}

/** 用語：本文・ドラフトカード中の用語リンクから開く（[C]表：2〜3行の定義＋小図。図はアイコンで代替） */
function buildGlossaryEntry(g: GlossaryEntry): FieldNoteEntry {
  return { noteKey: `term:${g.id}`, kindLabel: g.kind, title: g.term, icon: (size) => makeTermIconContainer(size), blocks: [{ kind: 'text', text: g.body }] }
}

/**
 * 遭遇帯の「状態の語り手」に必要な最小限の集計（codex_consult_ui.md [A]：残敵/次行動、[B]：被弾予告）。
 * enemyIntent（core/enemies.ts）を読むだけで、敵AIの判定そのものには踏み込まない（core非改変の方針）。
 */
function computeEncounterInfo(board: Board): {
  aliveCount: number
  boss: EnemyInstance | null
  pendingDamage: number
  minAttackTurns: number | null
  /** 監査[C]13：最短で来る攻撃の合計ダメージ。「あと3手」だけでは危険量が読めないため併記する */
  nextAttackDamage: number
} {
  const aliveEnemies = board.enemies.filter((e) => e.hp > 0)
  const boss = aliveEnemies.find((e) => e.kind === 'boss') ?? null
  let pendingDamage = 0
  let minAttackTurns: number | null = null
  for (const e of aliveEnemies) {
    const intent = enemyIntent(e)
    if (intent.kind !== 'attack') continue
    if (intent.turns === 1) pendingDamage += intent.damage ?? 0
    if (minAttackTurns === null || intent.turns < minAttackTurns) minAttackTurns = intent.turns
  }
  let nextAttackDamage = 0
  if (minAttackTurns !== null)
    for (const e of aliveEnemies) {
      const intent = enemyIntent(e)
      if (intent.kind === 'attack' && intent.turns === minAttackTurns) nextAttackDamage += intent.damage ?? 0
    }
  return { aliveCount: aliveEnemies.length, boss, pendingDamage, minAttackTurns, nextAttackDamage }
}

const app = new Application()

async function boot() {
  await app.init({ background: PAL.boardBg, resizeTo: window, antialias: true, resolution: Math.min(2, devicePixelRatio) })
  document.getElementById('app')!.appendChild(app.canvas)
  // Webフォントを待ってから Text を作る（後着だと既定serifのまま固まる）
  try {
    await Promise.race([document.fonts.load('600 16px "Shippori Mincho"'), new Promise((r) => setTimeout(r, 2500))])
  } catch {
    /* オフライン等はフォールバック */
  }
  await loadSprites()

  const vw = app.screen.width
  const vh = app.screen.height
  const fs = (r: number) => Math.round(vw * r)
  const save: SaveData = loadSave() // 旧セーブは拠点の装飾（ノード色/星）にのみ流用。ローグ進行では更新しない

  const mapRoot = new Container()
  const playRoot = new Container()
  app.stage.addChild(mapRoot, playRoot)

  let bgmStarted = false
  const ensureBgm = (themeId: number) => {
    if (bgmStarted) startBgm(themeForLevel(themeId))
  }

  /** 焼き込み文言（「つぎへ」）が乗った既存ボタン素材の上に、独自ラベルで覆って再利用する（MVP：好評ならv2で焼き込み） */
  const makeCoveredButton = (label: string, texKey: string, width: number): Container => {
    const c = new Container()
    const tex = spriteTexture(texKey) ?? spriteTexture('ui_button_next')
    let h: number
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set(width / tex.width)
      c.addChild(sp)
      h = (width / tex.width) * tex.height
      const cover = new Graphics()
      cover.roundRect(-width * 0.42, -h * 0.3, width * 0.84, h * 0.6, h * 0.22).fill({ color: 0x241a10, alpha: 0.96 })
      c.addChild(cover)
    } else {
      h = width * 0.32
      const g = new Graphics()
      g.roundRect(-width / 2, -h / 2, width, h, 14).fill(UI.wood).stroke({ width: 3, color: UI.brass })
      c.addChild(g)
    }
    const t = new Text({ text: label, style: { fill: 0xf4e8cf, fontSize: fs(0.044), fontFamily: FONT, fontWeight: 'bold' } })
    t.anchor.set(0.5)
    c.addChild(t)
    // Container自体には形が無いため hitArea が無いと static でも当たり判定を持てない（子のeventModeにも依存しない）
    c.hitArea = { contains: (x: number, y: number) => x >= -width / 2 && x <= width / 2 && y >= -h / 2 && y <= h / 2 }
    return c
  }

  // =============== 拠点シーン（旧・縦断面図マップを流用） ===============
  const MAP_H = vh * 4.2 // ノード密度を上げる（背景の縦解像度と両立する上限）
  let mapScroll = 0

  const buildMap = () => {
    mapRoot.removeAllListeners() // 再構築時に旧リスナーを掃除（累積防止）
    mapRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
    const content = new Container()
    mapRoot.addChild(content)

    // 背景（縦断面図）
    const bgTex = spriteTexture('map_bg')
    if (bgTex) {
      const bg = new Sprite(bgTex)
      bg.width = vw
      bg.height = MAP_H
      content.addChild(bg)
    } else {
      const g = new Graphics()
      g.rect(0, 0, vw, MAP_H).fill(0x18303c)
      content.addChild(g)
    }
    const dim = new Graphics()
    dim.rect(0, 0, vw, MAP_H).fill({ color: 0x0a1420, alpha: 0.18 })
    content.addChild(dim)

    // レベルノード（上=浅い→下=深い。ROGUE: タップ起動は撤去し、装飾としてのみ残す）
    const nodeTex = spriteTexture('map_node')
    const nodeGoldTex = spriteTexture('map_node_gold')
    const topPad = vh * 0.19
    const botPad = vh * 0.12
    const nodeXY = (i: number) => ({
      x: vw / 2 + Math.sin(i * 1.22) * vw * 0.24,
      y: topPad + ((i - 1) / (LEVELS.length - 1)) * (MAP_H - topPad - botPad),
    })
    // 破線の道（ノードの背面。2次ベジェを短い破線でなぞる）
    const pathG = new Graphics()
    for (let i = 1; i < LEVELS.length; i++) {
      const a = nodeXY(i)
      const b = nodeXY(i + 1)
      const mx = (a.x + b.x) / 2 + (i % 2 ? 1 : -1) * vw * 0.06
      const my = (a.y + b.y) / 2
      const q = (t: number) => ({
        x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * mx + t * t * b.x,
        y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * my + t * t * b.y,
      })
      const dash = vw * 0.018
      const gap = vw * 0.016
      let acc = 0
      let pen = false
      let prev = q(0)
      const steps = 48
      for (let s = 1; s <= steps; s++) {
        const p = q(s / steps)
        const seg = Math.hypot(p.x - prev.x, p.y - prev.y)
        acc += seg
        if (!pen && acc >= gap) {
          pathG.moveTo(prev.x, prev.y)
          pen = true
          acc = 0
        } else if (pen && acc >= dash) {
          pathG.lineTo(p.x, p.y)
          pen = false
          acc = 0
        } else if (pen) {
          pathG.lineTo(p.x, p.y)
        }
        prev = p
      }
      pathG.stroke({ width: Math.max(1.5, vw * 0.004), color: 0xe5d7b3, alpha: 0.72 })
    }
    content.addChild(pathG)
    for (let i = 1; i <= LEVELS.length; i++) {
      const { x: nx, y: ny } = nodeXY(i)
      const node = new Container()
      const cleared = i <= save.unlocked
      const current = i === save.unlocked + 1
      const locked = i > save.unlocked + 1
      const r = vw * 0.065
      const tex = cleared ? (nodeGoldTex ?? nodeTex) : nodeTex
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((r * 2) / Math.max(tex.width, tex.height))
        node.addChild(sp)
      } else {
        const g = new Graphics()
        g.circle(0, 0, r).fill(cleared ? 0xb08d3f : 0x3d4a55).stroke({ width: 3, color: cleared ? UI.brass : 0x27313a })
        node.addChild(g)
      }
      const num = new Text({
        text: String(i),
        style: { fill: 0xf4e8cf, fontSize: fs(0.04), fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x3a2c18, width: 3 } },
      })
      num.anchor.set(0.5)
      node.addChild(num)
      // 星アーチ（ノードの上に王冠状。獲得数ぶんの小さな金星）
      const st = save.stars[i - 1] ?? 0
      const starTex = spriteTexture('ui_star_gold')
      if (cleared && st > 0 && starTex) {
        const slots = [
          [-r * 0.72, -r * 1.16, 0.51],
          [0, -r * 1.28, 0.64],
          [r * 0.72, -r * 1.16, 0.51],
        ] as const
        const order = st === 1 ? [1] : st === 2 ? [0, 1] : [0, 1, 2]
        for (const k of order) {
          const [sx, sy, sscale] = slots[k]
          const s2 = new Sprite(starTex)
          s2.anchor.set(0.5)
          s2.scale.set((r * sscale) / starTex.width)
          s2.position.set(sx, sy)
          node.addChild(s2)
        }
      } else if (cleared && st > 0) {
        const stt = new Text({ text: '★'.repeat(st), style: { fill: 0xf2c14e, fontSize: fs(0.03), fontFamily: FONT } })
        stt.anchor.set(0.5)
        stt.position.set(0, -r * 1.4)
        node.addChild(stt)
      }
      if (locked) node.alpha = 0.62
      if (current) {
        const ring = new Graphics()
        ring.circle(0, 0, r * 1.3).stroke({ width: 2, color: UI.brass, alpha: 0.45 })
        node.addChild(ring)
        const pulse = () => {
          if (ring.destroyed) return
          tw.tween(ring.scale, { x: 1.15, y: 1.15 }, 600, {
            onDone: () => {
              if (ring.destroyed) return
              tw.tween(ring.scale, { x: 1, y: 1 }, 600, { onDone: pulse })
            },
          })
        }
        pulse()
        // アバターピン（層テーマの探窟家がノード上に浮かぶ）
        const pinTex = spriteTexture('map_avatar')
        const bustTex2 = spriteTexture(`bust_${themeForLevel(i)}`)
        if (pinTex) {
          const pin = new Container()
          const ring2 = new Sprite(pinTex)
          ring2.anchor.set(0.5)
          const pr = r * 0.82 // ノードの横に置く小型ピン（番号を隠さない）
          ring2.scale.set((pr * 2) / pinTex.width)
          pin.addChild(ring2) // 中心が不透過なので、顔はリングの上にマスク付きで載せる
          if (bustTex2) {
            const face = new Sprite(bustTex2)
            face.anchor.set(0.5, 0.24)
            face.scale.set((pr * 1.5) / bustTex2.width)
            face.position.set(0, -pr * 0.62)
            const m = new Graphics()
            m.circle(0, -pr * 0.05, pr * 0.68).fill(0xffffff)
            face.mask = m
            pin.addChild(face)
            pin.addChild(m)
          }
          // 正本②準拠：ノードの右横に独立した小さな肖像ピン（番号は残す）
          pin.position.set(r * 1.35, -r * 0.1)
          node.addChild(pin)
          const bob = () => {
            if (pin.destroyed) return
            tw.tween(pin, { y: -r * 0.32 }, 900, {
              onDone: () => {
                if (pin.destroyed) return
                tw.tween(pin, { y: -r * 0.1 }, 900, { onDone: bob })
              },
            })
          }
          bob()
        }
      }
      node.position.set(nx, ny)
      // ROGUE: レベルノードのタップ起動は撤去。描画は「拠点」の装飾として残す（ROGUE.md §8）
      content.addChild(node)
    }

    // ヘッダー（コイン札は非表示。右に「さいこう とうたつ」プラーク＝ローグの最深記録）
    const header = new Container()
    const plaque = (x: number, w: number) => {
      const g = new Graphics()
      g.roundRect(x, vh * 0.025, w, vh * 0.045, 10).fill({ color: 0x2e2416, alpha: 0.82 })
      g.roundRect(x, vh * 0.025, w, vh * 0.045, 10).stroke({ width: 1.5, color: UI.brass })
      return g
    }
    const bestX = vw * 0.56
    const bestW = vw * 0.42
    header.addChild(plaque(bestX, bestW))
    const bestT = new Text({
      text: `さいこう とうたつ ${loadRogueBest()}そう`,
      style: { fill: 0xd8b855, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' },
    })
    bestT.anchor.set(0.5)
    bestT.position.set(bestX + bestW / 2, vh * 0.0475)
    header.addChild(bestT)
    mapRoot.addChild(header)

    // 中央「ランかいし」ボタン（拠点の主導線。ROGUE.md §8）
    const startBtn = makeCoveredButton('ランかいし', 'next_forest', vw * 0.58)
    startBtn.position.set(vw / 2, vh * 0.5)
    startBtn.eventMode = 'static'
    startBtn.cursor = 'pointer'
    startBtn.on('pointertap', () => startRun())
    mapRoot.addChild(startBtn)

    // スクロール（ドラッグ）
    const clampScroll = (v: number) => Math.min(0, Math.max(-(MAP_H - vh), v))
    // 現在ノードへフォーカス
    const curT = save.unlocked / (LEVELS.length - 1)
    mapScroll = clampScroll(-(topPad + curT * (MAP_H - topPad - botPad)) + vh * 0.46)
    content.position.y = mapScroll
    let dragStart: number | null = null
    let scrollStart = 0
    mapRoot.eventMode = 'static'
    mapRoot.hitArea = app.screen
    mapRoot.on('pointerdown', (e) => {
      if (!bgmStarted) {
        bgmStarted = true
        startBgm(themeForLevel(1))
      }
      dragStart = e.global.y
      scrollStart = mapScroll
    })
    mapRoot.on('pointermove', (e) => {
      if (dragStart === null) return
      const dy = e.global.y - dragStart
      mapScroll = clampScroll(scrollStart + dy)
      content.position.y = mapScroll
    })
    const endDrag = () => {
      dragStart = null
    }
    mapRoot.on('pointerup', endDrag)
    mapRoot.on('pointerupoutside', endDrag)
  }

  const showMap = () => {
    playRoot.visible = false
    playRoot.removeAllListeners()
    playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
    mapRoot.visible = true
    buildMap()
    ensureBgm(1)
  }

  // =============== ラン・層プレイ ===============
  let board!: Board
  let view!: BoardView
  let inputLocked = false
  let runState: RunState | null = null
  let runSeed = 0
  let runMaxHp = 20 // 可視化第二波①：「20 / 20」併記用の最大値。startRunで実測値に更新
  let sceneEpoch = 0 // シーン再構築の世代。跨いだ遅延コールバックは無効化

  const draftRng = (floor: number): Rng => makeRng((runSeed + floor * 104729 + 17) | 0)

  // ---- 野帳シート：状態機械（vw/vh/playRoot/inputLockedを使う部分。データ・レイアウト計算は上のモジュール関数） ----
  let fieldNote: {
    key: string
    root: Container
    panel: Container
    baseY: number
    scrollHost: Container
    contentH: number
    viewH: number
    scrollY: number
    dragStartY: number | null
    dragStartScroll: number
    dragMode: 'none' | 'scroll' | 'dismiss'
  } | null = null
  let fieldNotePrevInputLocked = false

  const closeFieldNote = () => {
    if (!fieldNote) return
    const fn = fieldNote
    fieldNote = null
    inputLocked = fieldNotePrevInputLocked
    tw.tween(fn.panel.position, { y: vh }, 180, {
      ease: tw.easeInCubic,
      onDone: () => {
        if (!fn.root.destroyed) fn.root.destroy({ children: true })
      },
    })
    tw.tween(fn.root, { alpha: 0 }, 180)
  }

  /** 強化/特殊駒/敵/用語の本文を、シート幅に合わせてレイアウトする（[C]表：各表面共通の描画部） */
  const renderFieldNoteBlocks = (host: Container, measurer: Text, blocks: FieldNoteBlock[], width: number, onTermTap: (id: string) => void): number => {
    const padX = Math.max(24, vw * 0.05) // 内容安全域：左右24px以上（[C]必達）
    const bodyFont = fs(0.0265)
    const labelFont = fs(0.024)
    // ラベル列の幅は実際のラベル文字列（「獲得ボーナス」等の長いものを含む）から実測する（固定幅だと本文と重なる）
    measurer.style.fontSize = labelFont
    let maxLabelW = labelFont * 2
    for (const b of blocks) {
      if (b.kind !== 'row') continue
      measurer.text = b.label
      if (measurer.width > maxLabelW) maxLabelW = measurer.width
    }
    const labelW = Math.min(width * 0.34, maxLabelW + labelFont * 0.8)
    const contentX = padX + labelW
    const rowGap = bodyFont * 0.9
    const usedTerms = new Set<string>() // 「1つの本文で同じ用語は最初の1回だけ」＝シート1枚を1本文として共有
    let y = 0
    for (const b of blocks) {
      if (b.kind === 'text') {
        y = layoutRichText(host, measurer, tokenizeRich(b.text, usedTerms), padX, y, width - padX * 2, bodyFont, 0xf4e8cf, 0xd8b855, onTermTap)
        y += rowGap
      } else if (b.kind === 'row') {
        const label = new Text({ text: b.label, style: { fill: 0xcbb98a, fontSize: labelFont, fontFamily: FONT, fontWeight: 'bold' } })
        label.position.set(padX, y)
        host.addChild(label)
        const contentBottom = layoutRichText(
          host,
          measurer,
          tokenizeRich(b.text, usedTerms),
          contentX,
          y,
          width - padX - contentX,
          bodyFont,
          0xf4e8cf,
          0xd8b855,
          onTermTap,
        )
        y = Math.max(y + label.height, contentBottom) + rowGap
      } else {
        for (const item of b.items) {
          const iconSize = fs(0.1)
          const icon = item.icon(iconSize)
          icon.position.set(padX + iconSize / 2, y + iconSize / 2)
          host.addChild(icon)
          const titleX = padX + iconSize + fs(0.02)
          const title = new Text({ text: item.title, style: { fill: 0xf4e8cf, fontSize: bodyFont * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
          title.position.set(titleX, y)
          host.addChild(title)
          const textY = y + title.height + fs(0.006)
          const textBottom = layoutRichText(
            host,
            measurer,
            tokenizeRich(item.text, usedTerms),
            titleX,
            textY,
            width - padX - titleX,
            bodyFont,
            0xe8d9b0,
            0xd8b855,
            onTermTap,
          )
          y = Math.max(y + iconSize, textBottom) + rowGap
        }
      }
    }
    return y
  }

  /**
   * 共通ボトムシート本体。旧 showUpgradePopup（main.ts）と BoardView.showEnemyTooltip の統合先（codex_consult_ui.md [C]）。
   * 高さは通常48dvh、本文が長ければ最大72dvhまで伸び、それでも収まらなければ内部スクロール。
   * 閉じ方：背景タップ／×／下スワイプ／同じ対象の再タップ。開いている間は盤面入力（inputLocked）だけ止める。
   */
  const showFieldNote = (entry: FieldNoteEntry) => {
    if (fieldNote && fieldNote.key === entry.noteKey) {
      closeFieldNote() // 同じ対象の再タップ→閉じる
      return
    }
    if (!fieldNote) fieldNotePrevInputLocked = inputLocked // 新規オープン時だけ元のロック状態を記憶（用語切替では上書きしない）
    if (fieldNote) {
      if (!fieldNote.root.destroyed) fieldNote.root.destroy({ children: true })
      fieldNote = null
    }
    inputLocked = true

    const root = new Container()
    const scrim = new Graphics()
    scrim.rect(0, 0, vw, vh).fill({ color: 0x0f0a06, alpha: 1 })
    scrim.alpha = 0
    scrim.eventMode = 'static'
    scrim.on('pointertap', () => closeFieldNote())
    root.addChild(scrim)
    tw.tween(scrim, { alpha: 0.42 }, 160)

    const panelW = vw
    const padX = Math.max(24, vw * 0.05)
    const padTop = fs(0.03)
    const padBottom = Math.max(fs(0.03), vh * 0.02)
    const headerIconSize = fs(0.13)
    const headerH = Math.max(headerIconSize, fs(0.09)) + fs(0.02)

    const panel = new Container()
    const measurer = new Text({ text: '', style: { fontFamily: FONT, fontSize: fs(0.0265) } })
    const scrollHost = new Container()
    const contentH = renderFieldNoteBlocks(scrollHost, measurer, entry.blocks, panelW, openGlossaryTerm)
    measurer.destroy()

    const sheetMin = vh * 0.48
    const sheetMax = vh * 0.72
    const needed = headerH + padTop + contentH + padBottom
    const sheetH = Math.min(sheetMax, Math.max(sheetMin, needed))
    const viewH = Math.max(fs(0.1), sheetH - headerH - padTop - padBottom)

    // 背景：コード描画の地＋brass枠＋四隅の小さな鋲飾り（[C]：一枚絵の引き伸ばし禁止への対応）
    const corner = fs(0.032)
    const bg = new Graphics()
    bg.roundRect(0, 0, panelW, sheetH, corner).fill({ color: 0x241a10, alpha: 0.98 })
    bg.roundRect(1.5, 1.5, panelW - 3, sheetH - 3, corner).stroke({ width: 2.4, color: UI.brass, alpha: 0.9 })
    panel.addChild(bg)
    const studR = fs(0.007)
    for (const sx of [corner * 0.7, panelW - corner * 0.7]) {
      const stud = new Graphics()
      stud.circle(sx, corner * 0.7, studR).fill({ color: UI.brass, alpha: 0.85 })
      panel.addChild(stud)
    }
    // つまみ（掴んで下スワイプできることを示す短いバー）
    const grabber = new Graphics()
    grabber.roundRect(panelW / 2 - fs(0.06), fs(0.01), fs(0.12), fs(0.006), fs(0.003)).fill({ color: UI.brass, alpha: 0.6 })
    panel.addChild(grabber)

    // ヘッダー：アイコン＋名前＋種別ラベル、右上×
    const icon = entry.icon(headerIconSize)
    icon.position.set(padX + headerIconSize / 2, padTop + headerIconSize / 2)
    panel.addChild(icon)
    const titleT = new Text({
      text: entry.title,
      style: { fill: 0xf4e8cf, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold', breakWords: true },
    })
    titleT.position.set(padX + headerIconSize + fs(0.025), padTop + headerIconSize * 0.1)
    panel.addChild(titleT)
    const kindT = new Text({ text: entry.kindLabel, style: { fill: 0xcbb98a, fontSize: fs(0.024), fontFamily: FONT, fontWeight: 'bold' } })
    kindT.position.set(padX + headerIconSize + fs(0.025), padTop + headerIconSize * 0.1 + titleT.height + fs(0.004))
    panel.addChild(kindT)
    const closeR = fs(0.026)
    const closeBtn = new Container()
    closeBtn.position.set(panelW - padX - closeR, padTop + closeR * 0.7)
    const closeBg = new Graphics()
    closeBg.circle(0, 0, closeR).fill({ color: 0x2a1c10, alpha: 0.85 }).stroke({ width: 1.5, color: UI.brass })
    closeBtn.addChild(closeBg)
    const closeX = new Text({ text: '×', style: { fill: 0xf4e8cf, fontSize: closeR * 1.1, fontFamily: FONT, fontWeight: 'bold' } })
    closeX.anchor.set(0.5)
    closeBtn.addChild(closeX)
    closeBtn.eventMode = 'static'
    closeBtn.cursor = 'pointer'
    closeBtn.hitArea = { contains: (lx: number, ly: number) => lx * lx + ly * ly <= closeR * closeR * 2.4 }
    closeBtn.on('pointertap', (e) => {
      e.stopPropagation()
      closeFieldNote()
    })
    panel.addChild(closeBtn)

    // 本文：マスクでスクロール領域を切り出す（縦ドラッグでスクロール。慣性は無し）
    const scrollTop = headerH + padTop
    const scrollMask = new Graphics()
    scrollMask.rect(0, scrollTop, panelW, viewH).fill(0xffffff)
    panel.addChild(scrollMask)
    scrollHost.position.set(0, scrollTop)
    scrollHost.mask = scrollMask
    panel.addChild(scrollHost)

    panel.eventMode = 'static'
    panel.hitArea = { contains: (lx: number, ly: number) => lx >= 0 && lx <= panelW && ly >= 0 && ly <= sheetH }
    root.addChild(panel)
    playRoot.addChild(root) // 常に最後尾＝最前面（ドラフトパネルより上に出す）

    const baseY = vh - sheetH
    panel.position.set(0, vh)
    tw.tween(panel.position, { y: baseY }, 200, { ease: tw.easeOutCubic })

    const state = {
      key: entry.noteKey,
      root,
      panel,
      baseY,
      scrollHost,
      contentH,
      viewH,
      scrollY: 0,
      dragStartY: null as number | null,
      dragStartScroll: 0,
      dragMode: 'none' as 'none' | 'scroll' | 'dismiss',
    }
    fieldNote = state

    const minScroll = -Math.max(0, contentH - viewH)
    panel.on('pointerdown', (e) => {
      state.dragStartY = e.global.y
      state.dragStartScroll = state.scrollY
      state.dragMode = 'none'
    })
    panel.on('pointermove', (e) => {
      if (state.dragStartY === null || fieldNote !== state) return
      const dy = e.global.y - state.dragStartY
      if (state.dragMode === 'none') {
        if (Math.abs(dy) < 6) return
        // 上端（これ以上スクロールできない）で下方向に引いたときだけ「閉じるスワイプ」扱いにする
        state.dragMode = dy > 0 && state.scrollY >= -0.5 ? 'dismiss' : 'scroll'
      }
      if (state.dragMode === 'scroll') {
        state.scrollY = Math.max(minScroll, Math.min(0, state.dragStartScroll + dy))
        scrollHost.position.y = scrollTop + state.scrollY
      } else {
        panel.position.y = baseY + Math.max(0, dy)
      }
    })
    const endDrag = () => {
      if (fieldNote !== state) return
      if (state.dragMode === 'dismiss') {
        const dy = panel.position.y - baseY
        if (dy > sheetH * 0.22) closeFieldNote()
        else tw.tween(panel.position, { y: baseY }, 160, { ease: tw.easeOutCubic })
      }
      state.dragStartY = null
      state.dragMode = 'none'
    }
    panel.on('pointerup', endDrag)
    panel.on('pointerupoutside', endDrag)
  }

  /** 用語シートへの遷移（本文・ドラフトカード双方の用語リンクから共通で呼ぶ） */
  const openGlossaryTerm = (id: string) => {
    const g = findTerm(id)
    if (g) showFieldNote(buildGlossaryEntry(g))
  }

  const startRun = () => {
    runState = createRunState()
    runMaxHp = runState.playerHp
    runSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0
    mapRoot.visible = false
    playRoot.visible = true
    playRoot.removeAllListeners()
    playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
    buildFloorScene(1)
    ensureBgm(themeFloorId(1))
  }

  const buildFloorScene = (floor: number) => {
    const run = runState!
    run.floor = floor
    const floorDef = FLOORS[floor - 1]
    const floorSeed = (runSeed + floor * 7919) | 0
    board = new Board(buildFloorLevelDef(floor, floorSeed), run, floorDef)
    inputLocked = false
    const epoch = ++sceneEpoch
    const alive = () => epoch === sceneEpoch // このシーンがまだ生きているか
    const themeId = themeFloorId(floor)
    const theme = themeForLevel(themeId)

    // 背景
    const bgSprite = new Sprite()
    bgSprite.anchor.set(0.5)
    bgSprite.position.set(vw / 2, vh / 2)
    const tex = spriteTexture(`bg_${theme}`)
    if (tex) {
      bgSprite.texture = tex
      const s = Math.max(vw / tex.width, vh / tex.height)
      bgSprite.scale.set(s)
    }
    playRoot.addChild(bgSprite)
    const bgDim = new Graphics()
    bgDim.rect(0, 0, vw, vh).fill({ color: 0x2b2118, alpha: 0.1 }) // 暖色の沈め（青黒で潰さない）
    playRoot.addChild(bgDim)

    // ---------- 縦バンド予算（codex_consult_ui.md [A]：プレイ画面の再設計。旧4帯レイアウトから全面差し替え） ----------
    // 0-3%=上端safe area / 3-12%=ランHUD / 12-38%(短尺機は34%)=遭遇帯 / 38-84%=盤面 / 84-92%=ビルドドック / 92-100%=下端
    const shortScreen = vh < 700 // 700px未満は遭遇帯を22%へ縮め、盤面上端を34%へ繰り上げる（[A]表の注記）
    const hudTop = vh * 0.03
    const hudBottom = vh * 0.12
    const encTop = hudBottom
    const boardTop = shortScreen ? vh * 0.34 : vh * 0.38
    const boardSize = Math.min(vw * 0.92, vh * 0.44)
    view = new BoardView(board, app.renderer, boardSize)
    const boardPix = view.S * W
    view.root.position.set((vw - boardPix) / 2, boardTop)
    playRoot.addChild(view.root)
    // 盤面とビルドドックの間隔（[A]必達の下限は8px。BoardView側の盤面フレーム下端の飾りに視覚的に食い込まないよう
    // 実際には少し広めに取る。92%帯の下端safe areaまでは十分な余白があるため詰める必要はない）
    const dockGap = Math.max(8, vh * 0.035)
    const dockTop = boardTop + boardPix + dockGap

    // ---------- HUD/遭遇帯の共通レイヤー ----------
    const ui = new Container()
    playRoot.addChild(ui)

    // ---------- 遭遇帯：探窟家バスト＋残敵/次行動チップ（[A]「状態の語り手」） ----------
    const bustGlow = new Graphics() // 被弾予告時にバストへ出す赤い縁光（常時は非表示）
    bustGlow.visible = false
    playRoot.addChild(bustGlow)
    const bustTex = spriteTexture(`bust_${theme}`)
    const chipW = vw * 0.3
    const chipTex = spriteTexture('ui_chip')
    const chipH = chipTex ? chipW * (chipTex.height / chipTex.width) : chipW * 0.46
    const chipY = encTop + vh * 0.02
    const buildChip = (x: number) => {
      const c = new Container()
      if (chipTex) {
        const sp = new Sprite(chipTex)
        sp.width = chipW
        sp.height = chipH
        c.addChild(sp)
      } else {
        const g = new Graphics()
        g.roundRect(0, 0, chipW, chipH, chipH * 0.3).fill({ color: 0x2e2416, alpha: 0.85 }).stroke({ width: 1.5, color: UI.brass })
        c.addChild(g)
      }
      const t = new Text({
        text: '',
        style: {
          fill: UI.badgeText,
          fontSize: chipH * 0.3,
          fontFamily: FONT,
          fontWeight: 'bold',
          align: 'center',
          wordWrap: true,
          wordWrapWidth: chipW * 0.86,
          breakWords: true,
        },
      })
      t.anchor.set(0.5)
      t.position.set(chipW / 2, chipH / 2)
      c.addChild(t)
      c.position.set(x, chipY)
      ui.addChild(c)
      return { root: c, text: t }
    }
    const enemyChip = buildChip(vw * 0.04)
    const actionChip = buildChip(vw * 0.96 - chipW)

    let bust: Sprite | null = null
    if (bustTex) {
      bust = new Sprite(bustTex)
      bust.anchor.set(0.5, 1)
      const bustAreaTop = chipY + chipH + vh * 0.015
      const bustH = Math.min((boardTop - bustAreaTop) * 0.98, vh * 0.26)
      bust.scale.set(Math.max(1, bustH) / bustTex.height)
      bust.position.set(vw * 0.5, boardTop + vh * 0.006)
      playRoot.addChildAt(bust, playRoot.getChildIndex(view.root))
      bustGlow.circle(vw * 0.5, boardTop - bust.height * 0.42, bust.width * 0.62).stroke({ width: vw * 0.018, color: 0xd6432f, alpha: 0.75 })
    }

    // ---------- HUD（ランHUD1行：左=深度／中央=HPゲージ／右=メニュー。[A]） ----------
    const hudRowH = hudBottom - hudTop
    const hudCenterY = hudTop + hudRowH / 2
    const hudIconD = Math.min(hudRowH * 0.9, vw * 0.11)

    // 深度バッジ（左。旧HPメダリオンの意匠は円形深度バッジ ui_depth へ転用。[B]末尾の指示）
    const depthTex = depthBadgeTexture()
    const depthBadge = new Container()
    if (depthTex) {
      const sp = new Sprite(depthTex)
      sp.anchor.set(0.5)
      sp.scale.set(hudIconD / Math.max(depthTex.width, depthTex.height))
      depthBadge.addChild(sp)
    } else {
      const g = new Graphics()
      g.circle(0, 0, hudIconD / 2).fill(UI.wood).stroke({ width: 3, color: UI.brass })
      depthBadge.addChild(g)
    }
    const depthText = new Text({
      text: `${floor}/${FLOORS.length}`, // 空白入りだと円内に収まらない
      style: { fill: 0xf4e8cf, fontSize: hudIconD * 0.3, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
    })
    depthText.anchor.set(0.5)
    // 円内の空欄に必ず収める（層が2桁になっても溢れないよう実測して縮める）
    const depthFitW = hudIconD * 0.6
    if (depthText.width > depthFitW) depthText.scale.set(depthFitW / depthText.width)
    depthText.position.set(0, hudIconD * 0.15)
    depthBadge.addChild(depthText)
    depthBadge.position.set(vw * 0.04 + hudIconD / 2, hudCenterY)
    ui.addChild(depthBadge)

    // HPゲージ「探窟灯の油槽」（[B]）：幅優先で素材アスペクトを保ち、HUD行の高さに収まらなければ縮める
    const oilTex = spriteTexture('ui_oil')
    let gaugeW = Math.min(248, Math.max(190, vw * 0.54))
    let gaugeH = gaugeW * (196 / 640) // 素材の実寸比（切り直し後 640x196）
    const gaugeMaxH = hudRowH * 0.98
    if (gaugeH > gaugeMaxH) {
      gaugeH = gaugeMaxH
      gaugeW = gaugeH * (640 / 241)
    }
    const gaugeRoot = new Container()
    const gaugeBaseX = (vw - gaugeW) / 2
    gaugeRoot.position.set(gaugeBaseX, hudCenterY - gaugeH / 2)
    ui.addChild(gaugeRoot)
    // 内側チャンネル比率：素材ありは実測値、無ければコード描画用に広めの仮想チャンネルを使う
    const chX0 = gaugeW * (oilTex ? 0.175 : 0.14)
    const chX1 = gaugeW * (oilTex ? 0.9375 : 0.98)
    const chY0 = gaugeH * (oilTex ? 0.4949 : 0.26)
    const chY1 = gaugeH * (oilTex ? 0.8214 : 0.74)
    const chW = chX1 - chX0
    const chH = chY1 - chY0
    const backingG = new Graphics()
    gaugeRoot.addChild(backingG)
    const fillG = new Graphics()
    gaugeRoot.addChild(fillG)
    const hatchLayer = new Container()
    gaugeRoot.addChild(hatchLayer)
    if (oilTex) {
      const sp = new Sprite(oilTex)
      sp.width = gaugeW
      sp.height = gaugeH
      gaugeRoot.addChild(sp)
    } else {
      const frameG = new Graphics()
      frameG.roundRect(0, 0, gaugeW, gaugeH, gaugeH * 0.3).stroke({ width: 3, color: UI.brass })
      for (let i = 1; i < 5; i++) {
        const tx = chX0 + chW * (i / 5)
        frameG.moveTo(tx, chY0).lineTo(tx, chY1).stroke({ width: 1.5, color: 0x8a6a3f, alpha: 0.7 })
      }
      gaugeRoot.addChild(frameG)
    }
    // 低HP時のランタン炎ゆらぎ（素材の炎位置＝左端付近への簡易オーバーレイ。周期1.4〜1.8秒でランダムに小さくなる）
    const flameFlicker = new Graphics()
    flameFlicker.circle(gaugeW * 0.095, gaugeH * 0.3, gaugeH * 0.3).fill({ color: 0xffb347, alpha: 0.55 })
    flameFlicker.visible = false
    gaugeRoot.addChild(flameFlicker)
    let flameFlickerActive = false
    const flameFlickerLoop = () => {
      if (!flameFlickerActive || flameFlicker.destroyed) return
      const dur = 700 + Math.random() * 200 // 半周期0.7〜0.9秒＝全体1.4〜1.8秒（高速点滅は禁止。[B]低HP注記）
      const scale = 0.65 + Math.random() * 0.5
      tw.tween(flameFlicker.scale, { x: scale, y: scale }, dur, { onDone: flameFlickerLoop })
      tw.tween(flameFlicker, { alpha: 0.3 + Math.random() * 0.45 }, dur)
    }
    const hpNumText = new Text({
      text: '',
      style: { fill: 0xf4e8cf, fontSize: gaugeH * 0.4, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
    })
    hpNumText.anchor.set(1, 0.5)
    hpNumText.position.set(chX1 - gaugeW * 0.015, (chY0 + chY1) / 2)
    gaugeRoot.addChild(hpNumText)

    /** ゲージの塗り＋被弾予告の斜線オーバーレイを最新化する（HP実数はrefreshFloorHudが都度渡す） */
    const drawGauge = (hp: number, maxHp: number, pendingDamage: number) => {
      const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0
      const lowHp = hp > 0 && ratio <= 0.25
      backingG.clear()
      backingG.roundRect(chX0, chY0, chW, chH, chH * 0.22).fill(0x2a1c10)
      fillG.clear()
      hatchLayer.removeChildren().forEach((c) => c.destroy())
      let fillW = 0
      if (hp > 0) {
        fillW = lowHp ? chW / 5 : ratio * chW // 低HP：5区画中「最後の1区画」だけを塗る（[B]低HP注記1）
        fillW = Math.max(0, Math.min(chW, fillW))
        fillG.roundRect(chX0, chY0, fillW, chH, chH * 0.22).fill(0xd9922e)
        fillG.roundRect(chX0, chY0, fillW, chH * 0.42, chH * 0.18).fill({ color: 0xf2c96a, alpha: 0.8 })
        const pendW = Math.min(fillW, (Math.min(hp, pendingDamage) / maxHp) * chW)
        if (pendW > 0.5) {
          const px0 = chX0 + fillW - pendW
          const mask = new Graphics()
          mask.rect(px0, chY0, pendW, chH).fill(0xffffff)
          const hatch = new Graphics()
          const spacing = Math.max(3, chH * 0.4)
          for (let x = px0 - chH; x < px0 + pendW + chH; x += spacing) hatch.moveTo(x, chY1).lineTo(x + chH, chY0)
          hatch.stroke({ width: Math.max(1, chH * 0.14), color: 0x7a2c1c, alpha: 0.7 })
          hatch.mask = mask
          hatchLayer.addChild(mask, hatch)
        }
      }
      hpNumText.text = `${Math.max(0, hp)} / ${maxHp}`
      if (lowHp !== flameFlickerActive) {
        flameFlickerActive = lowHp
        flameFlicker.visible = lowHp
        if (lowHp) flameFlickerLoop()
        else {
          flameFlicker.scale.set(1)
          flameFlicker.alpha = 1
        }
      }
    }

    /** 被弾の実況：80msの白い芯→180msの油揺れ（2px横揺れ）→数値わきに「-N」が浮かぶ（[B]被弾時の指示） */
    const hpHitFx = (amount: number) => {
      const flash = new Graphics()
      flash.roundRect(chX0, chY0, chW, chH, chH * 0.22).fill({ color: 0xffffff, alpha: 0.95 })
      gaugeRoot.addChild(flash)
      tw.tween(flash, { alpha: 0 }, 80, { onDone: () => { if (!flash.destroyed) flash.destroy() } })
      tw.delay(70, () => {
        if (!alive() || gaugeRoot.destroyed) return
        const bx = gaugeBaseX
        tw.tween(gaugeRoot, { x: bx - 2 }, 45, {
          onDone: () =>
            tw.tween(gaugeRoot, { x: bx + 2 }, 45, {
              onDone: () => tw.tween(gaugeRoot, { x: bx - 1 }, 45, { onDone: () => tw.tween(gaugeRoot, { x: bx }, 45) }),
            }),
        })
      })
      const dmgT = new Text({
        text: `-${amount}`,
        style: { fill: 0xff6b5a, fontSize: gaugeH * 0.42, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1208, width: 3 } },
      })
      dmgT.anchor.set(0.5)
      dmgT.position.set(gaugeBaseX + hpNumText.position.x - hpNumText.width * 0.5, gaugeRoot.position.y - gaugeH * 0.3)
      ui.addChild(dmgT)
      tw.tween(dmgT.position, { y: dmgT.position.y - fs(0.05) }, 500, { ease: tw.easeInCubic })
      tw.tween(dmgT, { alpha: 0 }, 380, { delay: 150, onDone: () => { if (!dmgT.destroyed) dmgT.destroy() } })
      // 画面縁の赤ビネット短フラッシュ（旧実装から継続。被弾の実況として維持）
      const vignette = new Graphics()
      vignette.rect(0, 0, vw, vh).stroke({ width: vw * 0.05, color: 0xd6432f, alpha: 1 })
      vignette.alpha = 0
      playRoot.addChild(vignette)
      tw.tween(vignette, { alpha: 0.6 }, 90, {
        onDone: () => tw.tween(vignette, { alpha: 0 }, 260, { onDone: () => { if (!vignette.destroyed) vignette.destroy() } }),
      })
    }

    // メニューボタン（右。歯車/戻るを統合。[A]「歯車1個のメニュー内へ設定／ランを中断／マップ確認を格納」）
    const menuTex = spriteTexture('ui_menu') ?? spriteTexture('ui_gear')
    const menuBtn = new Container()
    if (menuTex) {
      const sp = new Sprite(menuTex)
      sp.anchor.set(0.5)
      sp.scale.set(hudIconD / Math.max(menuTex.width, menuTex.height))
      menuBtn.addChild(sp)
    } else {
      const g = new Graphics()
      g.roundRect(-hudIconD / 2, -hudIconD / 2, hudIconD, hudIconD, hudIconD * 0.22).fill(UI.wood).stroke({ width: 3, color: UI.brass })
      menuBtn.addChild(g)
    }
    const menuHitR = Math.max(hudIconD / 2, 22) // 最低44px相当のタップ領域
    menuBtn.position.set(vw * 0.96 - hudIconD / 2, hudCenterY)
    menuBtn.eventMode = 'static'
    menuBtn.cursor = 'pointer'
    menuBtn.hitArea = { contains: (x: number, y: number) => x * x + y * y <= menuHitR * menuHitR }
    let menuOpen = false
    let menuOverlay: Container | null = null
    let menuPanel: Container | null = null
    let menuPrevInputLocked = false
    const closeRunMenu = () => {
      if (menuOverlay && !menuOverlay.destroyed) menuOverlay.destroy()
      if (menuPanel && !menuPanel.destroyed) menuPanel.destroy({ children: true })
      menuOverlay = null
      menuPanel = null
      if (menuOpen) inputLocked = menuPrevInputLocked
      menuOpen = false
    }
    const openRunMenu = () => {
      menuPrevInputLocked = inputLocked
      menuOpen = true
      inputLocked = true
      const overlay = new Container()
      overlay.eventMode = 'static'
      overlay.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= vw && y >= 0 && y <= vh }
      overlay.on('pointertap', () => closeRunMenu())
      ui.addChild(overlay)
      menuOverlay = overlay

      const panelW = vw * 0.58
      const rowH = Math.max(44, vh * 0.06)
      const panelH = rowH * 2
      const panel = new Container()
      const bg = new Graphics()
      bg.roundRect(0, 0, panelW, panelH, 12).fill({ color: 0x241a10, alpha: 0.97 }).stroke({ width: 2, color: UI.brass })
      panel.addChild(bg)
      const muteLabel = () => (isMuted() ? '設定（ミュート：オン）' : '設定（ミュート：オフ）')
      const muteRow = new Text({ text: muteLabel(), style: { fill: 0xf4e8cf, fontSize: fs(0.034), fontFamily: FONT, fontWeight: 'bold' } })
      muteRow.anchor.set(0, 0.5)
      muteRow.position.set(panelW * 0.08, rowH * 0.5)
      panel.addChild(muteRow)
      const muteHit = new Container()
      muteHit.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= panelW && y >= 0 && y <= rowH }
      muteHit.eventMode = 'static'
      muteHit.cursor = 'pointer'
      muteHit.on('pointertap', () => {
        toggleMute()
        muteRow.text = muteLabel()
      })
      panel.addChild(muteHit)
      const divider = new Graphics()
      divider.moveTo(panelW * 0.06, rowH).lineTo(panelW * 0.94, rowH).stroke({ width: 1.5, color: UI.brass, alpha: 0.5 })
      panel.addChild(divider)
      const abandonRow = new Text({
        text: 'ランを中断して拠点へ',
        style: { fill: 0xe0a89c, fontSize: fs(0.034), fontFamily: FONT, fontWeight: 'bold' },
      })
      abandonRow.anchor.set(0, 0.5)
      abandonRow.position.set(panelW * 0.08, rowH * 1.5)
      panel.addChild(abandonRow)
      const abandonHit = new Container()
      abandonHit.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= panelW && y >= rowH && y <= rowH * 2 }
      abandonHit.eventMode = 'static'
      abandonHit.cursor = 'pointer'
      abandonHit.on('pointertap', () => {
        closeRunMenu()
        showMap()
      })
      panel.addChild(abandonHit)
      panel.position.set(vw * 0.96 - panelW, hudBottom + vh * 0.012)
      ui.addChild(panel)
      menuPanel = panel
    }
    menuBtn.on('pointertap', () => (menuOpen ? closeRunMenu() : openRunMenu()))
    ui.addChild(menuBtn)

    /** 遭遇帯の更新：残敵/ボス情報＋次行動の要約、被弾予告の合計ダメージを返す（HPゲージへ渡す） */
    const refreshEncounter = (): number => {
      const info = computeEncounterInfo(board)
      if (info.boss) {
        enemyChip.text.text = `${BOSS_NAME}\nHP ${Math.max(0, info.boss.hp)} / ${info.boss.maxHp}`
      } else {
        enemyChip.text.text = `残敵 ${info.aliveCount}`
      }
      const lethal = run.playerHp > 0 && info.nextAttackDamage > 0 && run.playerHp - info.nextAttackDamage <= 0
      if (lethal) {
        actionChip.text.text = `あと${info.minAttackTurns ?? 1}手：致死`
        actionChip.text.style.fill = 0xff8a70
      } else if (info.minAttackTurns !== null) {
        // ダメージ量まで出す（同じ「あと3手」でもHP16と2では意味が違う）
        actionChip.text.text = `あと${info.minAttackTurns}手：${info.nextAttackDamage}ダメージ`
        actionChip.text.style.fill = UI.badgeText
      } else {
        actionChip.text.text = '静観中'
        actionChip.text.style.fill = UI.badgeText
      }
      bustGlow.visible = info.pendingDamage > 0
      return info.pendingDamage
    }

    const refreshFloorHud = () => {
      const pendingDamage = refreshEncounter()
      drawGauge(Math.max(0, run.playerHp), runMaxHp, pendingDamage)
    }
    refreshFloorHud()

    /** 可視化第二波②：敵→探窟隊HUDへ飛ぶ赤い弧（軌跡＋着弾の小玉）。着弾点でHPゲージのフラッシュ演出に繋ぐ */
    const enemyAttackTrailFx = (fromX: number, fromY: number, toX: number, toY: number) => {
      const g = new Graphics()
      const midX = (fromX + toX) / 2
      const midY = Math.min(fromY, toY) - Math.abs(toX - fromX) * 0.18
      g.moveTo(fromX, fromY).quadraticCurveTo(midX, midY, toX, toY).stroke({ width: fs(0.006), color: 0xe0503a, alpha: 0.8 })
      playRoot.addChild(g)
      tw.tween(g, { alpha: 0 }, 360, {
        delay: 80,
        onDone: () => {
          if (!g.destroyed) g.destroy()
        },
      })
      const spark = new Graphics()
      spark.circle(0, 0, fs(0.014)).fill({ color: 0xffb199, alpha: 0.95 })
      spark.position.set(fromX, fromY)
      playRoot.addChild(spark)
      tw.tween(spark.position, { x: toX, y: toY }, 220, {
        ease: tw.easeInCubic,
        onDone: () => {
          if (!spark.destroyed) spark.destroy()
        },
      })
    }

    // 所持強化バー（旧ブースター4枠の装飾を、取得済み強化のアイコン列に差し替え。ROGUE.md 可視化第一波②）
    const boosterBar = new Container()
    const upgradeIconG = new Map<string, Container>()
    const UPGRADE_ICON_MAX = 10 // ROGUE.md §4：層1〜9クリアで最大9回ドラフト（安全側の上限）
    const ownedUpgrades = run.upgrades.slice(0, UPGRADE_ICON_MAX)
    // 右端に「野帳」ボタン（[C]特殊駒の主導線）を置く分、アイコン列の幅を詰める
    const dockNoteBtnW = vw * 0.145
    const iconAreaW = vw * 0.86 - dockNoteBtnW
    const iconSpacing = Math.min(vw * 0.19, iconAreaW / Math.max(1, ownedUpgrades.length))
    const iconR = Math.min(vw * 0.055, iconSpacing * 0.4)
    const iconAreaCenterX = vw * 0.04 + iconAreaW / 2
    // 強化説明・特殊駒・敵・用語は共通「野帳シート」に統合済み（showFieldNote。旧ここにあった個別ポップアップ実装は撤去）
    // 可視化第二波④：強化アイコンの回数条件バッジ（run.progress は並行実装中。無ければ何も描かない）
    type UpgradeProgress = Record<string, { cur: number; max: number }>
    const getProgress = (): UpgradeProgress | undefined => (run as unknown as { progress?: UpgradeProgress }).progress
    const progressBadgeG = new Map<string, { host: Container; text: Text }>()
    const progressLastCur = new Map<string, number>()
    const ensureProgressBadge = (id: string, icon: Container) => {
      const existing = progressBadgeG.get(id)
      if (existing) return existing
      const host = new Container()
      host.position.set(iconR * 0.62, iconR * 0.6)
      const bg = new Graphics()
      bg.circle(0, 0, iconR * 0.42)
        .fill({ color: 0x2a1c10, alpha: 0.92 })
        .stroke({ width: 1.2, color: 0xd9c9a0, alpha: 0.85 })
      host.addChild(bg)
      const txt = new Text({ text: '', style: { fill: 0xe8d9b0, fontSize: iconR * 0.4, fontFamily: FONT, fontWeight: 'bold' } })
      txt.anchor.set(0.5)
      host.addChild(txt)
      icon.addChild(host)
      const rec = { host, text: txt }
      progressBadgeG.set(id, rec)
      return rec
    }
    /** 強化の回数条件バッジを最新化。進んだ瞬間にポップ、maxへ到達（発動）した瞬間は金に一瞬光る */
    const refreshProgressBadges = () => {
      const progress = getProgress()
      for (const id of ownedUpgrades) {
        const icon = upgradeIconG.get(id)
        if (!icon) continue
        const p = progress?.[id]
        if (!p) {
          const rec = progressBadgeG.get(id)
          if (rec) rec.host.visible = false
          continue
        }
        const rec = ensureProgressBadge(id, icon)
        rec.host.visible = true
        rec.text.text = `${Math.min(p.cur, p.max)}/${p.max}`
        const prevCur = progressLastCur.get(id)
        if (prevCur !== undefined && p.cur !== prevCur) {
          tw.tween(rec.host.scale, { x: 1.25, y: 1.25 }, 100, {
            onDone: () => {
              if (!rec.host.destroyed) tw.tween(rec.host.scale, { x: 1, y: 1 }, 160, { ease: tw.easeOutBack })
            },
          })
          if (p.cur >= p.max) {
            const glow = new Graphics()
            glow.circle(0, 0, iconR * 0.5).fill({ color: 0xf2c14e, alpha: 0.9 })
            rec.host.addChildAt(glow, 0)
            tw.tween(glow, { alpha: 0 }, 300, {
              onDone: () => {
                if (!glow.destroyed) glow.destroy()
              },
            })
          }
        }
        progressLastCur.set(id, p.cur)
      }
    }
    const medalTex = spriteTexture('ui_medal')
    ownedUpgrades.forEach((id, i) => {
      const def = UPGRADES.find((u) => u.id === id)
      if (!def) return
      const m = new Container()
      if (medalTex) {
        const base = new Sprite(medalTex)
        base.anchor.set(0.5)
        base.scale.set((iconR * 2.3) / Math.max(medalTex.width, medalTex.height))
        m.addChild(base)
      }
      const cat = UPGRADE_CATEGORY[id]
      const drawHalf = (texKey: string, side: 'l' | 'r') => {
        const tex = spriteTexture(texKey)
        if (!tex) return
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((iconR * 1.2) / Math.max(tex.width, tex.height))
        sp.position.set(0, -iconR * 0.02)
        const mask = new Graphics()
        if (side === 'l') mask.moveTo(-iconR, -iconR).lineTo(iconR, -iconR).lineTo(-iconR, iconR).closePath().fill(0xffffff)
        else mask.moveTo(iconR, -iconR).lineTo(iconR, iconR).lineTo(-iconR, iconR).closePath().fill(0xffffff)
        sp.mask = mask
        m.addChild(mask, sp)
      }
      if (cat === 'synergy') {
        const [a, b] = SYNERGY_HALVES[id] ?? ['n1', 'n0']
        drawHalf(a, 'l')
        drawHalf(b, 'r')
      } else {
        const tex = spriteTexture(CATEGORY_ICON[cat] ?? 'n1')
        if (tex) {
          const sp = new Sprite(tex)
          sp.anchor.set(0.5)
          sp.scale.set((iconR * 1.25) / Math.max(tex.width, tex.height))
          sp.position.set(0, -iconR * 0.02)
          m.addChild(sp)
        }
      }
      m.eventMode = 'static'
      m.cursor = 'pointer'
      m.hitArea = { contains: (x: number, y: number) => x * x + y * y <= iconR * iconR * 2.4 }
      m.on('pointertap', () => showFieldNote(buildUpgradeEntry(def, run)))
      m.position.set(iconAreaCenterX + (i - (ownedUpgrades.length - 1) / 2) * iconSpacing, 0)
      boosterBar.addChild(m)
      upgradeIconG.set(id, m)
    })
    boosterBar.position.set(0, dockTop) // 盤面との間はdockGap（>=8px）確保済み（[A]ビルドドック必達条件）
    ui.addChild(boosterBar)
    refreshProgressBadges() // 可視化第二波④：層開始時点の進捗（あれば）を反映

    // 「野帳」ボタン（ビルドドック右端。[C]特殊駒の主導線＝タップで4種＋効果の一覧シート）
    const noteBtn = new Container()
    const noteBtnW = Math.min(dockNoteBtnW, vw * 0.2)
    const noteBtnH = Math.max(iconR * 2.1, fs(0.09))
    const noteBg = new Graphics()
    noteBg.roundRect(-noteBtnW / 2, -noteBtnH / 2, noteBtnW, noteBtnH, noteBtnH * 0.28).fill({ color: 0x2a1c10, alpha: 0.9 }).stroke({ width: 2, color: UI.brass })
    noteBtn.addChild(noteBg)
    const noteLabel = new Text({ text: '野帳', style: { fill: 0xf4e8cf, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' } })
    noteLabel.anchor.set(0.5)
    noteBtn.addChild(noteLabel)
    noteBtn.position.set(vw * 0.96 - noteBtnW / 2, 0)
    noteBtn.eventMode = 'static'
    noteBtn.cursor = 'pointer'
    noteBtn.hitArea = { contains: (x: number, y: number) => x >= -noteBtnW / 2 && x <= noteBtnW / 2 && y >= -noteBtnH / 2 && y <= noteBtnH / 2 }
    noteBtn.on('pointertap', () => showFieldNote(buildSpecialPieceEntry()))
    boosterBar.addChild(noteBtn)

    /** 強化発動アピール：バー内の該当アイコンをバウンス+金の一瞬発光（BoardView.onUpgradeFireから購読） */
    const bounceUpgradeIcon = (id: string) => {
      const icon = upgradeIconG.get(id)
      if (!icon || icon.destroyed) return
      tw.tween(icon.scale, { x: 1.35, y: 1.35 }, 110, {
        onDone: () => {
          if (!icon.destroyed) tw.tween(icon.scale, { x: 1, y: 1 }, 160, { ease: tw.easeOutBack })
        },
      })
      const glow = new Graphics()
      glow.circle(0, 0, iconR * 1.15).fill({ color: 0xf2c14e, alpha: 0.55 })
      icon.addChildAt(glow, 0)
      tw.tween(glow, { alpha: 0 }, 260, {
        onDone: () => {
          if (!glow.destroyed) glow.destroy()
        },
      })
    }
    /**
     * 因果パルス：強化バーの発火アイコンから盤面の起点セルへ金のパルスを飛ばす（codex_consult_rogue.md [B]④）。
     * 「自分のビルドが盤面を動かした」を見せる。同じ強化の連発は最初の2回までパルス、以降はbounceUpgradeIconの
     * バウンス＋発光のみに留める（うるささ対策、BoardView.tsの upgrade-fire ラベル間引きと同じ方針）。
     * at座標はBoardEvent側に既にあるが、onUpgradeFireのシグネチャ拡張はBoardView.ts（並行編集中）側の変更が要る。
     * 呼び出し側が旧シグネチャ（idのみ）のままなら at は undefined になり、自然にバウンスのみへフォールバックする。
     */
    const upgradeFirePulseCount = new Map<string, number>()
    const upgradeFirePulseFx = (id: string, at: XY) => {
      const icon = upgradeIconG.get(id)
      if (!icon || icon.destroyed) return
      const n = (upgradeFirePulseCount.get(id) ?? 0) + 1
      upgradeFirePulseCount.set(id, n)
      if (n > 2) return
      const fromX = icon.position.x
      const fromY = boosterBar.position.y + icon.position.y
      const toX = view.root.position.x + (at.x + 0.5) * view.S
      const toY = view.root.position.y + (at.y + 0.5) * view.S
      const line = new Graphics()
      line.moveTo(fromX, fromY).lineTo(toX, toY).stroke({ width: Math.max(1.5, fs(0.0035)), color: 0xf2c14e, alpha: 0.75 })
      playRoot.addChild(line)
      tw.tween(line, { alpha: 0 }, 170, {
        onDone: () => {
          if (!line.destroyed) line.destroy()
        },
      })
      const spark = new Graphics()
      spark.circle(0, 0, fs(0.009)).fill({ color: 0xfff2c0, alpha: 0.95 })
      spark.position.set(fromX, fromY)
      playRoot.addChild(spark)
      tw.tween(spark.position, { x: toX, y: toY }, 150, {
        ease: tw.easeOutCubic,
        onDone: () => {
          tw.tween(spark, { alpha: 0 }, 80, {
            onDone: () => {
              if (!spark.destroyed) spark.destroy()
            },
          })
        },
      })
    }
    view.onUpgradeFire = (id: string, at?: XY) => {
      bounceUpgradeIcon(id)
      if (at) upgradeFirePulseFx(id, at)
    }
    // 敵本体／インテントバッジのタップ→共通「野帳シート」（[C]表：敵の開き方）。旧BoardView.showEnemyTooltipの統合先
    view.onEnemyTap = (enemy) => showFieldNote(buildEnemyEntry(enemy))
    /** 可視化第二波②：「どの敵が殴ったか」を軌跡で示してからHPゲージの被弾演出（hpHitFx）へ繋ぐ */
    view.onEnemyAttack = (enemyId, damage) => {
      const en = board.enemies.find((e) => e.id === enemyId)
      const cell = en ? (en.kind === 'boss' ? { x: W - 1, y: en.bossFrontRow } : en.cells[0]) : null
      const toX = gaugeRoot.position.x + (chX0 + chX1) / 2
      const toY = gaugeRoot.position.y + (chY0 + chY1) / 2
      if (cell) {
        const fromX = view.root.position.x + (cell.x + 0.5) * view.S
        const fromY = view.root.position.y + (cell.y + 0.5) * view.S
        enemyAttackTrailFx(fromX, fromY, toX, toY)
        tw.delay(220, () => {
          if (!alive()) return
          hpHitFx(damage)
        })
      } else {
        // 敵の位置が特定できない（撃破直後など）場合も被弾演出自体は必ず出す
        hpHitFx(damage)
      }
    }

    // ---------- 入力 ----------
    let downAt: { x: number; y: number } | null = null
    let downCell: { x: number; y: number } | null = null
    const toCell = (gx: number, gy: number) => {
      const lx = gx - view.root.position.x
      const ly = gy - view.root.position.y
      const x = Math.floor(lx / view.S)
      const y = Math.floor(ly / view.S)
      if (x < 0 || y < 0 || x >= W || y >= H) return null
      return { x, y }
    }
    // 入力は playRoot 自身（hitArea=app.screen）で拾う（UIボタンは各自 eventMode）。
    // 旧実装にあった未使用の全画面 stage コンテナは、ui層のgear/back等より後ろに手前へ差し込まれ
    // ヒットテストを奪ってしまう（リスナー無しの死んだレイヤー）ため、このシーンでは持ち込まない（逸脱・理由は最終報告）。
    bgDim.eventMode = 'static'
    view.root.eventMode = 'static'
    playRoot.eventMode = 'static'
    playRoot.hitArea = app.screen
    playRoot.on('pointerdown', (e) => {
      if (!bgmStarted) {
        bgmStarted = true
        startBgm(theme)
      }
      downAt = { x: e.global.x, y: e.global.y }
      downCell = toCell(e.global.x, e.global.y)
    })
    playRoot.on('pointerup', (e) => {
      if (inputLocked || !downAt || !downCell) return
      const dx = e.global.x - downAt.x
      const dy = e.global.y - downAt.y
      const dist = Math.hypot(dx, dy)
      let evs: BoardEvent[] = []
      if (dist < view.S * 0.35) {
        const c = board.at(downCell.x, downCell.y)
        if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') evs = board.tap(downCell)
      } else {
        const dir = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
        evs = board.swap(downCell, { x: downCell.x + dir.x, y: downCell.y + dir.y })
      }
      downAt = null
      downCell = null
      if (evs.length === 0) return
      if (evs.some((ev2) => ev2.t === 'swap' && ev2.illegal)) sfx.illegal()
      else sfx.swap()
      handleFloorResult(evs)
    })

    // ---------- 層の決着（floor-clear / run-over。ROGUE.md §5/§6/§8） ----------
    const handleFloorResult = (evs: BoardEvent[]) => {
      const dur = view.play(evs)
      refreshFloorHud()
      refreshProgressBadges() // 可視化第二波④：1手ごとに進捗（あれば）を反映
      for (const e of evs) {
        if (e.t === 'poison-triggered') {
          hpHitFx(1)
        } else if (e.t === 'boss-slam') {
          hpHitFx(e.damage)
        }
      }
      const cleared = evs.some((e) => e.t === 'floor-clear')
      const over = evs.some((e) => e.t === 'run-over')
      if (cleared) {
        inputLocked = true
        tw.delay(Math.min(dur, 1200), () => {
          if (alive()) onFloorClear()
        })
      } else if (over) {
        inputLocked = true
        tw.delay(Math.min(dur, 900), () => {
          if (alive()) showRunResult(false)
        })
      }
    }

    const onFloorClear = () => {
      if (floor >= 10) {
        showRunResult(true) // ボス層クリア＝ラン勝利（ROGUE.md §6）
        return
      }
      showFloorClearBanner()
    }

    // 層クリア演出（既存テーマバナー流用）→ ドラフト3択（ROGUE.md §8）
    const showFloorClearBanner = () => {
      sfx.fanfare()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0 })
      playRoot.addChild(dim)
      tw.tween(dim, { alpha: 0.4 }, 220)
      const bt = new Container()
      const bannerTex = spriteTexture(`ribbon_${theme}`) ?? spriteTexture('ui_ribbon_clear')
      if (bannerTex) {
        const rb = new Sprite(bannerTex)
        rb.anchor.set(0.5)
        rb.scale.set((vw * 0.72) / bannerTex.width)
        bt.addChild(rb)
      }
      bt.position.set(vw / 2, vh * 0.45)
      bt.scale.set(0)
      playRoot.addChild(bt)
      tw.tween(bt.scale, { x: 1, y: 1 }, 320, { ease: tw.easeOutBack })
      tw.delay(1100, () => {
        if (!alive()) return
        tw.tween(bt.scale, { x: 0, y: 0 }, 280, { ease: tw.easeInCubic, onDone: () => bt.destroy() })
        tw.tween(dim, { alpha: 0 }, 200, { onDone: () => dim.destroy() })
        tw.delay(160, () => {
          if (alive()) showDraftPanel()
        })
      })
    }

    // ドラフト3択 v2（codex_consult_ui.md [D]）：タップ即取得をやめ「選択→下部バーで確定」式にし、
    // 所持強化ストリップと読めるシナジー（因果の一文バッジ）を追加する。縦バンド予算は[D]推奨表に固定で従う：
    // 0-9%タイトル+野帳 / 9-20%所持ストリップ / 20-82%候補カード3枚(各18%・間4%) / 82-96%接続要約+確定 / 96-100%safe area
    const showDraftPanel = () => {
      const options = pickDraftOptions(run.upgrades, draftRng(floor))
      const owned = UPGRADES.filter((u) => run.upgrades.includes(u.id))
      const connections = options.map((opt) => computeConnection(owned, opt))
      const padX = Math.max(20, vw * 0.05)

      const panel = new Container()
      // プレイHUD（油槽・深度・残敵チップ・ビルドドック）は所持ストリップや候補カードと
      // 位置が重なるため、ドラフト中は丸ごと隠す。半透明の暗幕だけでは透けて混線する
      ui.visible = false
      const dimG = new Graphics()
      dimG.rect(0, 0, vw, vh).fill({ color: 0x0f0a06, alpha: 0.82 })
      dimG.eventMode = 'static' // 背面のタップを吸収（誤操作防止）
      panel.addChild(dimG)
      playRoot.addChild(panel)

      // ---- 0〜9%：タイトル＋野帳ボタン ----
      const titleY = vh * 0.045
      const title = new Text({
        text: `深度${floor} 踏破 — 強化を1つ選ぶ`,
        style: { fill: 0xf4e8cf, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold', breakWords: true },
      })
      title.anchor.set(0, 0.5)
      title.position.set(padX, titleY)
      panel.addChild(title)

      const noteBtnW = Math.min(vw * 0.22, fs(0.24))
      const noteBtnH = fs(0.075)
      const draftNoteBtn = new Container()
      const draftNoteBg = new Graphics()
      draftNoteBg
        .roundRect(-noteBtnW / 2, -noteBtnH / 2, noteBtnW, noteBtnH, noteBtnH * 0.3)
        .fill({ color: 0x2a1c10, alpha: 0.9 })
        .stroke({ width: 2, color: UI.brass })
      draftNoteBtn.addChild(draftNoteBg)
      const draftNoteLabel = new Text({ text: '野帳', style: { fill: 0xf4e8cf, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' } })
      draftNoteLabel.anchor.set(0.5)
      draftNoteBtn.addChild(draftNoteLabel)
      draftNoteBtn.position.set(vw - padX - noteBtnW / 2, titleY)
      draftNoteBtn.eventMode = 'static'
      draftNoteBtn.cursor = 'pointer'
      draftNoteBtn.hitArea = { contains: (x: number, y: number) => x >= -noteBtnW / 2 && x <= noteBtnW / 2 && y >= -noteBtnH / 2 && y <= noteBtnH / 2 }
      draftNoteBtn.on('pointertap', () => showFieldNote(buildSpecialPieceEntry()))
      panel.addChild(draftNoteBtn)

      // ---- 9〜20%：所持強化ストリップ（[D]：40pxアイコン横スクロール、左に所持N、右に一覧、系統内訳） ----
      const stripRowY = vh * 0.135
      const stripIconSize = Math.max(30, Math.min(40, fs(0.1)))
      const ownedLabel = new Text({ text: `所持 ${owned.length}`, style: { fill: 0xcbb98a, fontSize: fs(0.028), fontFamily: FONT, fontWeight: 'bold' } })
      ownedLabel.anchor.set(0, 0.5)
      ownedLabel.position.set(padX, stripRowY)
      panel.addChild(ownedLabel)

      const listLabel = new Text({ text: '一覧', style: { fill: 0xd8b855, fontSize: fs(0.028), fontFamily: FONT, fontWeight: 'bold' } })
      listLabel.anchor.set(1, 0.5)
      listLabel.position.set(vw - padX, stripRowY)
      panel.addChild(listLabel)
      const listBtn = new Container()
      listBtn.eventMode = 'static'
      listBtn.cursor = 'pointer'
      const listHitW = listLabel.width + fs(0.03)
      listBtn.hitArea = { contains: (x: number, y: number) => x >= vw - padX - listHitW && x <= vw && y >= stripRowY - fs(0.045) && y <= stripRowY + fs(0.045) }
      listBtn.on('pointertap', () => showFieldNote(buildOwnedListEntry(owned)))
      panel.addChild(listBtn)

      const stripX0 = padX + ownedLabel.width + fs(0.03)
      const stripX1 = vw - padX - listLabel.width - fs(0.03)
      const stripW = Math.max(stripIconSize, stripX1 - stripX0)
      const stripMask = new Graphics()
      stripMask.rect(stripX0, stripRowY - stripIconSize / 2 - 6, stripW, stripIconSize + 12).fill(0xffffff)
      panel.addChild(stripMask)
      const stripHost = new Container()
      stripHost.position.set(stripX0, stripRowY)
      stripHost.mask = stripMask
      stripHost.eventMode = 'static'
      stripHost.hitArea = { contains: (x: number, y: number) => x >= -4 && x <= stripW + 4 && y >= -stripIconSize / 2 - 6 && y <= stripIconSize / 2 + 6 }
      panel.addChild(stripHost)
      const stripGap = stripIconSize * 0.3
      owned.forEach((u, i) => {
        const ic = makeUniqueUpgradeIcon(u.id, stripIconSize)
        ic.position.set(i * (stripIconSize + stripGap) + stripIconSize / 2, 0)
        ic.eventMode = 'static'
        ic.cursor = 'pointer'
        const hr = stripIconSize * 0.6
        ic.hitArea = { contains: (x: number, y: number) => x * x + y * y <= hr * hr }
        // アイコンタップで野帳シートが開く。候補カードは消さず、閉じれば同じ選択状態のまま戻る（[D]）
        ic.on('pointertap', (e) => {
          e.stopPropagation()
          showFieldNote(buildUpgradeEntry(u, run))
        })
        stripHost.addChild(ic)
      })
      const stripContentW = owned.length ? owned.length * (stripIconSize + stripGap) - stripGap : 0
      if (stripContentW > stripW) {
        // 7個を超えたら縮小せず横スクロール（[D]）。ドラッグはstripHostが子アイコンからのバブリングも拾う
        const minX = stripW - stripContentW
        let dragStartX: number | null = null
        let dragStartHostX = 0
        stripHost.on('pointerdown', (e) => {
          dragStartX = e.global.x
          dragStartHostX = stripHost.position.x
        })
        stripHost.on('pointermove', (e) => {
          if (dragStartX === null) return
          const dx = e.global.x - dragStartX
          stripHost.position.x = Math.max(stripX0 + minX, Math.min(stripX0, dragStartHostX + dx))
        })
        const endStripDrag = () => {
          dragStartX = null
        }
        stripHost.on('pointerup', endStripDrag)
        stripHost.on('pointerupoutside', endStripDrag)
      }

      // 主系統の内訳（例：植物3・鉱物1・ギア1）
      const counts: Partial<Record<UpgradeCategory, number>> = {}
      for (const u of owned) {
        const c = UPGRADE_CATEGORY[u.id]
        counts[c] = (counts[c] ?? 0) + 1
      }
      const breakdownOrder: UpgradeCategory[] = ['plant', 'mineral', 'gear', 'relic', 'synergy']
      const breakdownText = breakdownOrder
        .filter((c) => counts[c])
        .map((c) => `${CATEGORY_LABEL[c]}${counts[c]}`)
        .join('・')
      if (breakdownText) {
        const bd = new Text({ text: breakdownText, style: { fill: 0x9a8968, fontSize: fs(0.021), fontFamily: FONT } })
        bd.position.set(padX, stripRowY + fs(0.045))
        panel.addChild(bd)
      }

      // ---- 20〜82%：候補カード3枚（各18%・間隔4%。[D]表のとおり固定） ----
      const cardTop = vh * 0.2
      const cardH = vh * 0.18
      const cardGap = vh * 0.04
      const safeW = Math.min(vw, vh * 0.62)
      const cardW = safeW - 32
      const cardInsetX = Math.max(cardW * 0.06, 12) // 本文はカード内側からさらに6%以上内側（必達）
      const cardIconSize = Math.max(30, Math.min(40, fs(0.1)))
      const bodyFont = fs(0.0265)
      const labelFont = fs(0.024)
      // カード本文の用語リンク（[C]用語リンクの実装方針）：測定用Textは3枚で使い回し、生成後まとめて片付ける
      const cardMeasurer = new Text({ text: '', style: { fontFamily: FONT, fontSize: bodyFont } })

      // ---- 82〜96%：接続要約＋確定ボタン（選択状態に応じてrenderBottomで描き直す） ----
      const bottomTop = vh * 0.82
      const bottomH = vh * 0.14
      const bottomContainer = new Container()
      bottomContainer.position.set(0, bottomTop)
      panel.addChild(bottomContainer)

      let selectedIndex: number | null = null
      const cardContainers: Container[] = []
      const cardGlows: Graphics[] = []

      const confirmPick = (i: number) => {
        run.upgrades.push(options[i].id)
        const next = floor + 1
        playRoot.removeAllListeners()
        playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
        buildFloorScene(next)
        ensureBgm(themeFloorId(next))
      }

      const renderBottom = () => {
        bottomContainer.removeChildren().forEach((c) => c.destroy({ children: true }))
        const btnW = Math.min(cardW, vw * 0.7)
        const btnH = bottomH * 0.42
        const btnY = bottomH - btnH / 2 - vh * 0.008
        const enabled = selectedIndex !== null

        if (selectedIndex !== null) {
          const conn = connections[selectedIndex]
          const opt = options[selectedIndex]
          const summaryTop = bottomH * 0.06
          if (conn.sentence) {
            // 選択時：因果の一文をカード内より広い幅でフルに見せる（[D]：カードで収まらない分はここで見せる）
            drawConnectionChip(bottomContainer, padX, summaryTop, vw - padX * 2, `接続 ${conn.count}　${conn.sentence}`, fs(0.024))
          } else {
            // 相性なしは罰のように見せない：バッジは出さず、選択中の強化名だけ淡く添える（[D]）
            const t = new Text({ text: opt.name, style: { fill: 0x9a8968, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' } })
            t.position.set(padX, summaryTop)
            bottomContainer.addChild(t)
          }
        }

        const btn = new Container()
        const btnBg = new Graphics()
        if (enabled) {
          btnBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill(UI.wood).stroke({ width: 2.5, color: UI.brass })
        } else {
          btnBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill({ color: 0x33291c, alpha: 0.75 }).stroke({ width: 2, color: 0x6b5f45 })
        }
        btn.addChild(btnBg)
        const btnLabel = new Text({
          text: enabled ? 'この強化を取る' : 'カードを選んで比較',
          style: { fill: enabled ? 0xf4e8cf : 0x8a8270, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' },
        })
        btnLabel.anchor.set(0.5)
        btn.addChild(btnLabel)
        btn.position.set(vw / 2, btnY)
        if (enabled) {
          // 未選択時は無効化（タップ不可）＝「カードを選んで比較」のまま。選択後だけ確定できる（[D]）
          btn.eventMode = 'static'
          btn.cursor = 'pointer'
          btn.hitArea = { contains: (x: number, y: number) => x >= -btnW / 2 && x <= btnW / 2 && y >= -btnH / 2 && y <= btnH / 2 }
          btn.on('pointertap', () => confirmPick(selectedIndex!))
        }
        bottomContainer.addChild(btn)
      }

      const selectCard = (i: number) => {
        // タップは選択状態にするだけ（再タップで解除）。取得は下部の確定ボタンでのみ行う（[D]）
        selectedIndex = selectedIndex === i ? null : i
        cardContainers.forEach((c, idx) => {
          const on = idx === selectedIndex
          cardGlows[idx].visible = on
          tw.tween(c.scale, { x: on ? 1.035 : 1, y: on ? 1.035 : 1 }, 140, { ease: tw.easeOutBack })
        })
        renderBottom()
      }

      options.forEach((opt, i) => {
        const cy = cardTop + i * (cardH + cardGap)
        const card = new Container()
        card.pivot.set(cardW / 2, cardH / 2) // 選択時の拡大が中心基準になるようpivotを中央に置く
        card.position.set((vw - cardW) / 2 + cardW / 2, cy + cardH / 2)

        // 背景：素材の9スライス化を試したが、見出し帯の位置が崩れて可読性が落ちたためコード描画を採用。
        // 帯予算に対して素材の縦横比が合わないので、ラスターの伸縮は使わない
        const bg = new Graphics()
        bg.roundRect(0, 0, cardW, cardH, cardH * 0.09).fill({ color: UI.paper, alpha: 0.98 }).stroke({ width: 2, color: UI.brass, alpha: 0.85 })
        card.addChild(bg)
        // 選択ハイライト：未選択時は非表示、選択時だけ光る枠を出す（拡大はcard.scale側で行う）
        const glow = new Graphics()
        glow.roundRect(-3, -3, cardW + 6, cardH + 6, cardH * 0.1).stroke({ width: 4, color: 0xf2d98a, alpha: 0.95 })
        glow.visible = false
        card.addChild(glow)
        cardGlows.push(glow)
        cardContainers.push(card)

        // ① 左に固有アイコン36〜40px、右に系統名（小）＋強化名（大）
        const headerTop = cardH * 0.06
        const textX = cardInsetX + cardIconSize + fs(0.018)
        const catT = new Text({
          text: CATEGORY_LABEL[UPGRADE_CATEGORY[opt.id]] ?? '',
          style: { fill: 0x8a6a3f, fontSize: fs(0.02), fontFamily: FONT, fontWeight: 'bold' },
        })
        catT.position.set(textX, headerTop)
        card.addChild(catT)
        const nameT = new Text({
          text: opt.name,
          style: {
            fill: UI.paperInk,
            fontSize: fs(0.032),
            fontFamily: FONT,
            fontWeight: 'bold',
            wordWrap: true,
            wordWrapWidth: cardW - textX - cardInsetX,
            breakWords: true,
          },
        })
        nameT.position.set(textX, headerTop + catT.height + fs(0.002))
        card.addChild(nameT)
        const headerBlockH = catT.height + fs(0.002) + nameT.height
        const icon = makeUniqueUpgradeIcon(opt.id, cardIconSize)
        icon.position.set(cardInsetX + cardIconSize / 2, headerTop + cardIconSize / 2)
        card.addChild(icon)

        // ② 条件／効果（既存splitDescを流用）。用語には点線下線＋「?」でリンクを張る（[C]用語リンクの実装方針）。
        // カード全体タップは選択トグルのみなので、用語タップは layoutRichText 側の stopPropagation で確実に分離する
        const { condition, effect } = splitDesc(opt.desc)
        const labelW = Math.max(fs(0.06), labelFont * 2.4)
        const contentX = cardInsetX + labelW
        const contentWrapW = Math.max(20, cardW - contentX - cardInsetX)
        const cardUsedTerms = new Set<string>()
        let rowY = headerTop + Math.max(cardIconSize, headerBlockH) + cardH * 0.04
        const addRow = (label: string, content: string) => {
          const l = new Text({ text: label, style: { fill: 0x8a6a3f, fontSize: labelFont, fontFamily: FONT, fontWeight: 'bold' } })
          l.position.set(cardInsetX, rowY)
          card.addChild(l)
          const bottom = layoutRichText(card, cardMeasurer, tokenizeRich(content, cardUsedTerms), contentX, rowY, contentWrapW, bodyFont, UI.paperInk, 0x7a5a1e, openGlossaryTerm)
          rowY = Math.max(rowY + l.height, bottom) + cardH * 0.025
        }
        if (condition) addRow('条件', condition)
        addRow('効果', effect)

        // ③ 接続バッジ（あれば）：カード内は「接続 N」のみ。因果の一文は選択後に下部の比較欄で見せる（[D]）
        const conn = connections[i]
        if (conn.count > 0) {
          rowY = drawConnectionChip(card, cardInsetX, rowY, cardW - cardInsetX * 2, `接続 ${conn.count}`, Math.max(10, fs(0.022))) + cardH * 0.02
        }

        // ④ 獲得ボーナス（starterDescありのみ）：本文より一段小さく・淡い帯・小さな贈り物アイコンで従属的に表示
        if (opt.starterDesc) {
          const bandH = cardH * 0.16
          // 下端固定だと接続バッジと重なることがあるため、本文の積み上げ位置(rowY)より必ず下へ置く
          const bandY = Math.max(cardH - bandH - cardH * 0.04, rowY + cardH * 0.01)
          const bandX = cardInsetX * 0.7
          const bandW = cardW - bandX * 2
          const band = new Graphics()
          band.roundRect(bandX, bandY, bandW, bandH, bandH * 0.28).fill({ color: 0xf4ecd8, alpha: 0.55 })
          card.addChild(band)
          const giftSize = bandH * 0.5
          const giftCx = bandX + bandH * 0.55
          const giftCy = bandY + bandH / 2
          const gift = new Graphics()
          gift.roundRect(giftCx - giftSize / 2, giftCy - giftSize * 0.32, giftSize, giftSize * 0.64, giftSize * 0.08).fill(UI.brass)
          gift.rect(giftCx - giftSize * 0.09, giftCy - giftSize * 0.32, giftSize * 0.18, giftSize * 0.64).fill(0x8a5a2a)
          gift.rect(giftCx - giftSize / 2, giftCy - giftSize * 0.08, giftSize, giftSize * 0.16).fill(0x8a5a2a)
          card.addChild(gift)
          const bonusText = opt.starterDesc.replace(/^おまけ[:：]\s*/, '')
          const bonusFont = Math.max(fs(0.019), bandH * 0.34)
          const bonusT = new Text({
            text: `獲得ボーナス　${bonusText}`,
            style: { fill: 0x6b5238, fontSize: bonusFont, fontFamily: FONT, wordWrap: true, wordWrapWidth: bandW - giftSize * 1.9, breakWords: true },
          })
          bonusT.anchor.set(0, 0.5)
          bonusT.position.set(giftCx + giftSize * 0.85, giftCy)
          card.addChild(bonusT)
        }

        card.eventMode = 'static'
        card.cursor = 'pointer'
        card.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= cardW && y >= 0 && y <= cardH }
        card.on('pointertap', () => selectCard(i))
        panel.addChild(card)
      })
      cardMeasurer.destroy()

      renderBottom() // 初期状態＝未選択（[D]：未選択時はボタンが「カードを選んで比較」のまま無効化）
    }

    // ---------- 記録画面（層10クリア or run-over。ROGUE.md §7/§8） ----------
    const showRunResult = (victory: boolean) => {
      inputLocked = true
      victory ? sfx.fanfare() : sfx.lose()
      const reached = run.floor
      saveRogueBest(reached)
      const name = buildRunName(run.upgrades)

      const panel = new Container()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x1a130c, alpha: 0.32 })
      panel.addChild(dim)
      const pw = vw * 0.9
      const panelTex = spriteTexture('ui_panel') ?? spriteTexture('ui_parchment')
      const ph = panelTex ? Math.min(vh * 0.72, (pw / panelTex.width) * panelTex.height) : vh * 0.68
      const px0 = (vw - pw) / 2
      const py0 = vh * 0.11
      if (panelTex) {
        const sp = new Sprite(panelTex)
        const s = Math.min(pw / panelTex.width, ph / panelTex.height)
        sp.scale.set(s)
        sp.position.set((vw - panelTex.width * s) / 2, py0)
        panel.addChild(sp)
      }
      if (victory) {
        const ribbonTex = spriteTexture('ui_banner_word') ?? spriteTexture('ui_ribbon_clear')
        if (ribbonTex) {
          const rb = new Sprite(ribbonTex)
          rb.anchor.set(0.5)
          rb.scale.set((pw * 0.82) / ribbonTex.width)
          rb.position.set(vw / 2, py0 + vh * 0.002)
          panel.addChild(rb)
        }
      } else {
        const t0 = new Text({
          text: 'ここまでの記録',
          style: { fill: UI.paperInk, fontSize: fs(0.05), fontFamily: FONT, fontWeight: 'bold' },
        })
        t0.anchor.set(0.5)
        t0.position.set(vw / 2, py0 + ph * 0.12)
        panel.addChild(t0)
      }
      const nameT = new Text({
        text: name,
        style: { fill: 0xf4e8cf, fontSize: fs(0.05), fontFamily: FONT, fontWeight: 'bold' },
      })
      nameT.anchor.set(0.5)
      nameT.position.set(vw / 2, py0 + ph * 0.22)
      panel.addChild(nameT)

      const records = [
        `とうたつ深度　${reached}層`,
        `さいだい連鎖　${run.records.maxChain}`,
        `1手さいだい破壊　${run.records.maxDestroyed}`,
        `発動した効果　${run.records.effectFires}回`,
        `ボス撃破　${victory ? '○' : '×'}`,
      ]
      records.forEach((line, i) => {
        const t = new Text({
          text: line,
          style: { fill: UI.paperInk, fontSize: fs(0.032), fontFamily: FONT, fontWeight: 'bold' },
        })
        t.anchor.set(0.5)
        t.position.set(vw / 2, py0 + ph * 0.36 + i * fs(0.055))
        panel.addChild(t)
      })

      const bustTex2 = spriteTexture(`bust_${theme}`)
      if (bustTex2) {
        const ch = new Sprite(bustTex2)
        ch.anchor.set(0.5, 1)
        const chH = Math.min(vh * 0.16, ((pw * 0.22) / bustTex2.width) * bustTex2.height)
        ch.scale.set(chH / bustTex2.height)
        ch.position.set(px0 + pw * 0.1, py0 + ph + vh * 0.045)
        panel.addChild(ch)
      }

      const btn = makeCoveredButton('もういちど', `next_${theme}`, pw * 0.6)
      btn.position.set(vw / 2, py0 + ph * 0.9)
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      btn.on('pointertap', () => {
        panel.destroy({ children: true })
        showMap()
      })
      panel.addChild(btn)
      playRoot.addChild(panel)
    }

    // 強化のスターター効果（ROGUE2.md §1 原則2）は Board 構築時に確定済み。
    // 盤とHUDが揃ったこの時点で演出だけ再生し「選んだ強化がいきなり仕事した」を見せる
    if (board.initEvents.length) {
      const initEv = board.initEvents
      board.initEvents = [] // 二重再生の防止
      inputLocked = true
      tw.delay(500, () => {
        if (!alive()) return
        const dur = view.play(initEv)
        refreshFloorHud()
        refreshProgressBadges()
        tw.delay(Math.min(dur, 1400), () => {
          if (alive()) inputLocked = false
        })
      })
    }

    // QA用フック（既存 __yacho の流儀＝シーン再構築のたびに全体を差し替え）
    ;(window as unknown as Record<string, unknown>).__yacho = {
      get board() {
        return board
      },
      get view() {
        return view
      },
      get run() {
        return runState
      },
      metrics: () => ({ S: view.S, ox: view.root.position.x, oy: view.root.position.y, vw, vh }),
      busy: () => tw.activeCount(),
      // 野帳シートQA用フック（実装検証：main.ts本体の open 経路と同じ関数を直接叩けるようにする）
      openFieldNote: showFieldNote,
      closeFieldNote,
      fieldNoteInfo: () => (fieldNote ? { key: fieldNote.key, top: fieldNote.baseY, viewH: fieldNote.viewH, contentH: fieldNote.contentH } : null),
      openUpgradeNote: (id?: string) => {
        const uid = id ?? run.upgrades[0]
        const def = UPGRADES.find((u) => u.id === uid)
        if (def) showFieldNote(buildUpgradeEntry(def, run))
      },
      openSpecialNote: () => showFieldNote(buildSpecialPieceEntry()),
      openEnemyNote: () => {
        const e = board.enemies.find((en) => en.hp > 0)
        if (e) showFieldNote(buildEnemyEntry(e))
      },
      openTermNote: (id: string) => {
        const g = findTerm(id)
        if (g) showFieldNote(buildGlossaryEntry(g))
      },
      // 実タップ検証用：実際のUI要素（野帳ボタン／所持強化アイコン）の画面座標（QA専用、挙動には無関係）
      noteButtonPos: () => noteBtn.getGlobalPosition(),
      upgradeIconPos: (id?: string) => {
        const icon = upgradeIconG.get(id ?? run.upgrades[0])
        return icon ? icon.getGlobalPosition() : null
      },
      startRun,
      forceFloorClear: () => {
        if (inputLocked) return
        const ev: BoardEvent[] = []
        const priv = board as unknown as { dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[]) => void }
        for (const e of [...board.enemies]) priv.dealEnemyDamage(e.id, e.hp, ev)
        if (ev.length) handleFloorResult(ev)
      },
      showMap,
    }
  }

  app.ticker.add((t) => tw.update(t.deltaMS))
  showMap()
  // 拠点表示前でも startRun 等をコンソールから呼べるようにベースラインを用意（floor開始後は上で全体が差し替わる）
  ;(window as unknown as Record<string, unknown>).__yacho = {
    startRun,
    showMap,
    get run() {
      return runState
    },
  }
}

boot()
