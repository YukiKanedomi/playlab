// 『そろえて、しるす。』ローグライク・エントリ。拠点（旧・縦断面図マップ流用）⇄ 層プレイの2シーン構成。
// ROGUE.md 準拠（第3弾b＝ラン進行の実装）。旧30レベル制の画面遷移は廃止。
import { Application, Container, Graphics, Point, Sprite, Text, Texture } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS30 as LEVELS } from './core/levels30'
import { createRunState, discardUpgrade, OXYGEN_GAUGE_FULL, OXYGEN_LOW, OXYGEN_CRITICAL, OXYGEN_SUPPLY_PER_FLOOR, type RunState } from './core/run'
import { applyBlessingsToFloor, isBlessingFloor, pickBlessingOptions, takeBlessing } from './core/blessings'
import { FLOORS, type FloorDef } from './core/floors'
import { RESOURCE_LABEL, UPGRADES, type UpgradeDef } from './core/upgrades'
import { buildPostmortem, thinningFloor, type DrainSample, type FloorLight } from './core/postmortem'
import { buildRunName, UPGRADE_CATEGORY, type UpgradeCategory } from './core/runname'
import { makeRng, type Rng } from './core/rng'
import { pickDraftOptions as pickDraftOptionsGraph } from './core/draft'
import { BoardView } from './view/BoardView'
import { PAL, depthBadgeTexture, loadSprites, spriteTexture, themeForLevel, upgradeIconTexture } from './view/pieces'
import { loadSave, type SaveData } from './core/save'
import { BOSS_SHELL_COUNT, enemyIntent, ENEMY_PERIOD, OXYGEN_DRAIN, type EnemyInstance } from './core/enemies'
import { systemOf } from './core/hooks'
import type { BoardEvent, EnemyKind, Goal, GoalType, LevelDef, XY } from './core/types'
import { GLOSSARY, findTerm, type GlossaryEntry } from './core/glossary'
import * as tw from './juice/tween'
import { sfx, startBgm, toggleMute, isMuted } from './juice/sound'
import { hapticsEnabled, hapticsLog, hapticsSupported, toggleHaptics } from './juice/haptics'

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

/** 層1つぶんの盤面定義。目標とレイアウトは FloorDef（core/floors.ts）が持つ正典を使う */
const buildFloorLevelDef = (floor: number, seed: number, def: FloorDef): LevelDef => ({
  id: floor,
  seed,
  moves: 9999, // 旧30レベル制の手数。ローグでは酸素が時計なので発火しない番人として残す
  colors: 5,
  goals: def.goals,
  layout: def.layout,
})

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
// 資源の語彙は upgrades.ts の RESOURCES ただ1つを正とする（抽選 core/draft.ts・表示・計測が同じ定義を読む）。
// 以前ここに produces/consumes の「近似表」を別語彙（plantPiece/ore/gearPiece/relicBoost）で持っており、
// upgrades.ts の正式語彙（plant/volatile-ore/gear-trigger/relic-match）と混ざって
// ラベル解決が undefined になる不具合を出した。真実の源を2つ持つのをやめ、近似表は削除した。
// 表示名 RESOURCE_LABEL も語彙と同じ upgrades.ts へ移した（結果画面の「あと一つ」が core 側で同じ表を読むため）。
// 呼応の一文が「Aが胞子を生む → Bが使う」形になり、効果文を埋め込まなくなったため shortEffect() は削除した（PHASE2 §3）
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
  // 資源はcore/upgrades.tsのconsumes/producesを正とする（抽選・表示・計測が同じ定義を読む。監査[C]5）
  const candProduces = candidate.produces ?? []
  const candConsumes = candidate.consumes ?? []
  const kindRank = { produce: 0, consume: 1 } as const
  let best: { rank: number; sentence: string } | null = null
  let count = 0
  for (const o of owned) {
    const oProduces = o.produces ?? []
    const oConsumes = o.consumes ?? []
    const produced = oProduces.find((r) => candConsumes.includes(r))
    const consumed = candProduces.find((r) => oConsumes.includes(r))
    let kind: keyof typeof kindRank | null = null
    let sentence = ''
    if (produced) {
      kind = 'produce'
      sentence = `${o.name}が${RESOURCE_LABEL[produced]}を生む → この知見が使う`
    } else if (consumed) {
      kind = 'consume'
      sentence = `この知見が${RESOURCE_LABEL[consumed]}を生む → ${o.name}が使う`
    }
    // 同トリガ・同系統は「近縁」であって因果の接続ではないため数えない（監査[C]5）
    if (!kind) continue
    count++
    const rank = kindRank[kind]
    if (!best || rank < best.rank) best = { rank, sentence }
  }
  return { count, sentence: best?.sentence ?? null }
}


// ボスの表示名（下の ENEMY_INFO.boss.name と同一の呼称。ボス以外はチップに個体名を出さないため他は複製しない）
const BOSS_NAME = '深匣主'

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
    // 下線は文字ボックスの「下端のさらに下」に置く（-1だと『チ』『銛』の画線に重なって取り消し線に見える）。
    // 行間 lineH=fontSize*1.56 に対し次行のインク上端まで余裕があるため、下へ出しても行同士は衝突しない。
    const uy = y + t.height + 0.5
    for (let dx = 0; dx < uw; dx += dash + gap)
      underline
        .moveTo(x + dx, uy)
        .lineTo(x + Math.min(dx + dash, uw), uy)
        .stroke({ width: 1, color: linkColor, alpha: 0.9 })
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
  } else if (kind === 'burrower') {
    // 裂坑掘り：盤面(BoardView)と同じ「暗い穴の同心円＋二つ目」をアイコン寸法で描く
    const g = new Graphics()
    g.circle(0, 0, size * 0.42).fill({ color: 0x0b0d10, alpha: 0.92 })
    g.circle(0, 0, size * 0.29).fill({ color: 0x1c2128, alpha: 0.92 })
    g.circle(0, 0, size * 0.15).fill({ color: 0x2c333b, alpha: 0.85 })
    for (const dx of [-size * 0.14, size * 0.14]) {
      g.circle(dx, -size * 0.06, size * 0.117).fill(0xf6f1e4)
      g.circle(dx, -size * 0.06, size * 0.09).fill(0xdff0ff)
      g.circle(dx, -size * 0.06, size * 0.038).fill(0x201812)
    }
    c.addChild(g)
  } else if (kind === 'breathstealer') {
    // 息喰み：盤面と同じ「三重の同心リング（危険色）＋細い一つ目」
    const g = new Graphics()
    g.circle(0, 0, size * 0.42).fill({ color: 0x2a1216, alpha: 0.95 })
    g.circle(0, 0, size * 0.3).stroke({ width: size * 0.05, color: 0xe0503a, alpha: 0.9 })
    g.circle(0, 0, size * 0.16).fill({ color: 0x120a0c, alpha: 0.95 })
    g.circle(0, -size * 0.16, size * 0.13).fill(0xf6f1e4)
    g.circle(0, -size * 0.16, size * 0.1).fill(0xffd6b0)
    g.circle(0, -size * 0.16, size * 0.042).fill(0x201812)
    c.addChild(g)
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
  /** 酸素を直接奪う敵だけが持つ説明。null の敵は「与ダメージ」行そのものを出さない（妨害屋だと読ませる） */
  oxygenDesc: string | null
  disruptDesc: string | null
  defeatDesc: string
}
const ENEMY_INFO: Record<EnemyKind, EnemyInfoEntry> = {
  swarm: {
    name: '小型胞子虫',
    oxygenDesc: null,
    disruptDesc: null,
    defeatDesc: '3つそろえでは1しか効かない。4つ以上・特殊駒・爆発で倒すと、隣の仲間へダメージが伝わる',
  },
  rockshell: {
    name: '岩殻獣',
    oxygenDesc: null,
    disruptDesc: '鉱物ひとつに甲殻をまとわせる（甲殻はもう1回壊さないと消えない）',
    defeatDesc: '隣で駒を消すとダメージ。3つそろえでは1しか入らないので、大きく消すほど早い',
  },
  sporeling: {
    name: '喰み蟲',
    oxygenDesc: null,
    disruptDesc: '盤上の駒ひとつに捕食印をつけ、2手後に食べてHPを回復する',
    defeatDesc: '印のついた駒そのものを消すと追い払える（1ダメージ＋予告がやり直しになる）',
  },
  burrower: {
    name: '裂坑掘り',
    oxygenDesc: null,
    disruptDesc: '自分から遠い2×2を亀裂として予告し、2手後にそのマスを3手ふさぐ',
    defeatDesc: '予告された2×2の中で駒を1つでも消せば崩落は止まる',
  },
  breathstealer: {
    name: '灯喰み',
    oxygenDesc: `${ENEMY_PERIOD.breathstealer}手ごとに灯を${OXYGEN_DRAIN.breathstealer}奪う`,
    disruptDesc: null,
    defeatDesc: '深界で唯一、灯を直接奪う相手。長居するほど損をする',
  },
  boss: {
    name: '深匣主',
    oxygenDesc: `${ENEMY_PERIOD.boss}手ごとに灯を${OXYGEN_DRAIN.boss}奪う`,
    disruptDesc: null,
    defeatDesc: 'まず封印匣を4枚剥がす（どんな一撃でも1枚）。核が露出したら本体のHPを削る',
  },
}

const SPECIAL_PIECE_LIST: { key: string; name: string; text: string }[] = [
  { key: 'harpoon', name: '銛（レンチ銛）', text: '駒の向きに合わせて、1列または1行をまとめて消す。' },
  // 「目標」は課目（層の達成目標）と紛れるため、用語集 sp-hamushi と同じ「狙った1マス」に揃えた
  { key: 'hamushi', name: '羽虫（コンパス甲虫）', text: '離陸地点の周囲を壊してから、狙った1マスへ飛んで壊す。' },
  { key: 'hitsubo', name: '火壺（歯車爆弾）', text: '着地点を中心に5×5マスを壊す。' },
  { key: 'seiju', name: '星珠（探窟ランタン）', text: '盤面でいちばん多い色をすべて消す。' },
]

/** 知見：プレイ中・採録の手持ち欄で共通（[C]表：名前・系統・起きること・進捗・採録時のおまけ） */
function buildUpgradeEntry(def: UpgradeDef, run: RunState): FieldNoteEntry {
  const cat = UPGRADE_CATEGORY[def.id]
  const blocks: FieldNoteBlock[] = [{ kind: 'row', label: '系統', text: CATEGORY_LABEL[cat] ?? '' }]
  // PHASE2 §3：「条件／効果」という開発データの露出をやめ、descを「起きること」1段で通しで読ませる
  blocks.push({ kind: 'row', label: '起きること', text: def.desc })
  const progress = run.progress[def.id]
  if (progress) blocks.push({ kind: 'row', label: '進捗', text: `${Math.min(progress.cur, progress.max)} / ${progress.max}` })
  if (def.starterDesc) blocks.push({ kind: 'row', label: '採録時のおまけ', text: def.starterDesc.replace(/^おまけ[:：]\s*/, '') })
  return { noteKey: `upgrade:${def.id}`, kindLabel: '知見', title: def.name, icon: (size) => makeUpgradeIconContainer(def.id, size), blocks }
}

/** 所持強化 一覧：ドラフトv2の所持ストリップ「一覧」ボタンから開く（[D]：所持欄の`一覧`で全画面のビルド一覧） */
function buildOwnedListEntry(owned: UpgradeDef[]): FieldNoteEntry {
  const blocks: FieldNoteBlock[] = owned.length
    ? [{ kind: 'items', items: owned.map((u) => ({ icon: (size: number) => makeUniqueUpgradeIcon(u.id, size), title: u.name, text: splitDesc(u.desc).effect })) }]
    : [{ kind: 'text', text: 'まだ知見を採録していません。' }]
  return {
    noteKey: 'owned-list',
    kindLabel: '手持ちの知見',
    title: `手持ちの知見 一覧（${owned.length}）`,
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

/** 敵：本体／インテントバッジのタップで開く（[C]表：名前・HP・次行動・与ダメージ・妨害内容・倒し方） */
function buildEnemyEntry(enemy: EnemyInstance, blessings: string[]): FieldNoteEntry {
  const info = ENEMY_INFO[enemy.kind]
  const intent = enemyIntent(enemy, blessings)
  const nextText = intent.kind === 'none' ? '動かない' : `${intent.label}　あと${intent.turns}手`
  const blocks: FieldNoteBlock[] = [
    { kind: 'row', label: 'HP', text: `${Math.max(0, enemy.hp)} / ${enemy.maxHp}` },
    { kind: 'row', label: '兆候', text: nextText },
  ]
  // 酸素を奪わない敵に「与ダメージ：なし」を出すと妨害屋であることが伝わらないので、行ごと省く
  if (info.oxygenDesc) blocks.push({ kind: 'row', label: '与ダメージ', text: info.oxygenDesc })
  blocks.push({ kind: 'row', label: '妨害', text: info.disruptDesc ?? '妨害は行わない' })
  blocks.push({ kind: 'row', label: '倒し方', text: info.defeatDesc })
  return { noteKey: `enemy:${enemy.id}`, kindLabel: '原生種', title: info.name, icon: (size) => makeEnemyIconContainer(enemy.kind, size), blocks }
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
  /** 次の1手で失う酸素（予告オーバーレイ用） */
  pendingOxygen: number
  minTurns: number | null
  /** 最短で来るインテントの短い日本語（'甲殻' '崩落' '捕食' '酸素-3'） */
  nextLabel: string | null
  /** 最短で来るインテントで失う酸素の合計（0＝妨害だけ） */
  nextOxygenLoss: number
  /** 定期行動を持たない（intent.kind==='none'）生存敵の数。＝チップが「あと何手」を語れない敵 */
  idleCount: number
} {
  const alive = board.enemies.filter((e) => e.hp > 0)
  const boss = alive.find((e) => e.kind === 'boss') ?? null
  let pendingOxygen = 0
  let minTurns: number | null = null
  let idleCount = 0
  for (const e of alive) {
    const it = enemyIntent(e, board.run?.blessings ?? [])
    if (it.kind === 'none') {
      idleCount++
      continue
    }
    if (it.turns === 1) pendingOxygen += it.oxygen ?? 0
    if (minTurns === null || it.turns < minTurns) minTurns = it.turns
  }
  let nextLabel: string | null = null
  let nextOxygenLoss = 0
  if (minTurns !== null)
    for (const e of alive) {
      const it = enemyIntent(e, board.run?.blessings ?? [])
      if (it.kind === 'none' || it.turns !== minTurns) continue
      nextOxygenLoss += it.oxygen ?? 0
      if (!nextLabel || it.kind === 'drain') nextLabel = it.label // 危険な予告を優先して表示する
    }
  return { aliveCount: alive.length, boss, pendingOxygen, minTurns, nextLabel, nextOxygenLoss, idleCount }
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
      // 不透明で覆う（alpha 0.96 だと素材に焼かれた「つぎへ」が透けて独自ラベルと二重に見える）。
      // 寸法は広げない：広げるとプレート内部が全面黒板になり、テーマ別素材の質感が消えるため。
      cover.roundRect(-width * 0.42, -h * 0.3, width * 0.84, h * 0.6, h * 0.22).fill({ color: 0x241a10, alpha: 1 })
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
      text: `最深記録　深度${loadRogueBest()}`,
      style: { fill: 0xd8b855, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' },
    })
    bestT.anchor.set(0.5)
    bestT.position.set(bestX + bestW / 2, vh * 0.0475)
    header.addChild(bestT)
    mapRoot.addChild(header)

    // 中央「ランかいし」ボタン（拠点の主導線。ROGUE.md §8）
    const startBtn = makeCoveredButton('探窟へ', 'next_forest', vw * 0.58)
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
  let sceneEpoch = 0 // シーン再構築の世代。跨いだ遅延コールバックは無効化
  // ラン中の強化ごとの発火回数（結果画面の「いちばん働いた強化」用）。board.ts は非改変のため
  // main.ts 側でイベント列を数える。層をまたいで積むのでシーンではなくランのスコープに置く
  const upgradeFireCount = new Map<string, number>()
  // 結果画面の「なぜ細ったか」の元データ（PHASE2.md §2.5②）。層をまたいで積むのでランのスコープに置く。
  // lightSeries は「その層を出るときの残灯（補給前）」、drainLog は原生種に直接奪われた1件ずつ
  const lightSeries: FloorLight[] = []
  const drainLog: DrainSample[] = []

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

  /**
   * 祝福をひとつ受ける画面（PHASE2.md §3）。ラン開始時と、深度10/20の幕主を仕留めた後に開く。
   * **利点（祝福）と代償（呪い）を同じ大きさで並べる**のがこの画面の要件で、隠しデメリットは作らない。
   * ビジュアルの方向が決まるまでの繋ぎなので、採録画面の作法（暗幕・紙色の面・下部の確定ボタン）を
   * そのまま踏襲した最小限にとどめる（凝らない。あとで採録画面ごと作り直す前提）。
   */
  const showBlessingPanel = (onDone: () => void) => {
    const run = runState!
    // 同じランの同じ回で必ず同じ3枚が出る（採録と同じ作法。runSeed は startRun で確定済み）
    const options = pickBlessingOptions(run.blessings, makeRng((runSeed + run.blessings.length * 65537 + 3) | 0), 3, run.floor)
    const padX = Math.max(20, vw * 0.05)

    const panel = new Container()
    const dimG = new Graphics()
    dimG.rect(0, 0, vw, vh).fill({ color: 0x0f0a06, alpha: 1 }) // 背面の盤面を透かさない
    dimG.eventMode = 'static'
    panel.addChild(dimG)
    playRoot.addChild(panel)

    const title = new Text({
      text: '祝福をひとつ受ける',
      style: { fill: 0xf4e8cf, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold' },
    })
    title.anchor.set(0, 0.5)
    title.position.set(padX, vh * 0.05)
    panel.addChild(title)

    const sub = new Text({
      text: `${run.blessings.length + 1}つめ　利点と代償は対になっている`,
      style: { fill: 0x9a8968, fontSize: fs(0.024), fontFamily: FONT },
    })
    sub.anchor.set(0, 0.5)
    sub.position.set(padX, vh * 0.095)
    panel.addChild(sub)

    const rowW = Math.min(vw - padX * 2, vh * 0.62 - 32)
    const rowX = (vw - rowW) / 2
    const rowH = vh * 0.19
    const rowGap = vh * 0.02
    const rowTop = vh * 0.14
    const inset = Math.max(rowW * 0.05, 12)
    let selected: number | null = null
    const rowBgs: Graphics[] = []

    const btnHost = new Container()
    panel.addChild(btnHost)
    const renderBtn = () => {
      btnHost.removeChildren().forEach((c) => c.destroy({ children: true }))
      const btnW = Math.min(rowW, vw * 0.7)
      const btnH = vh * 0.062
      const enabled = selected !== null
      const btn = new Container()
      const bg = new Graphics()
      if (enabled) bg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill(UI.wood).stroke({ width: 2.5, color: UI.brass })
      else bg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill({ color: 0x33291c, alpha: 0.75 }).stroke({ width: 2, color: 0x6b5f45 })
      btn.addChild(bg)
      const label = new Text({
        text: enabled ? 'この祝福を受ける' : '祝福を選ぶ',
        style: { fill: enabled ? 0xf4e8cf : 0x8a8270, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' },
      })
      label.anchor.set(0.5)
      btn.addChild(label)
      btn.position.set(vw / 2, vh * 0.93)
      if (enabled) {
        btn.eventMode = 'static'
        btn.cursor = 'pointer'
        btn.hitArea = { contains: (x: number, y: number) => x >= -btnW / 2 && x <= btnW / 2 && y >= -btnH / 2 && y <= btnH / 2 }
        btn.on('pointertap', () => {
          takeBlessing(run, options[selected!].id)
          panel.destroy({ children: true })
          onDone()
        })
      }
      btnHost.addChild(btn)
    }

    // 帯の中は羊皮紙なので墨色で書く。長い行は折り返さず縮める（showFloorRecordBand と同じ作法）
    const mk = (parent: Container, text: string, size: number, y: number, fill: number, bold: boolean) => {
      const t = new Text({ text, style: { fill, fontSize: size, fontFamily: FONT, fontWeight: bold ? 'bold' : 'normal' } })
      t.anchor.set(0, 0.5)
      t.position.set(inset, y)
      const maxW = rowW - inset * 2
      if (t.width > maxW) t.scale.set(maxW / t.width)
      parent.addChild(t)
    }

    options.forEach((b, i) => {
      const row = new Container()
      row.position.set(rowX, rowTop + i * (rowH + rowGap))
      const bg = new Graphics()
      bg.roundRect(0, 0, rowW, rowH, rowH * 0.12).fill({ color: UI.paper, alpha: 0.96 }).stroke({ width: 2, color: UI.brass, alpha: 0.7 })
      row.addChild(bg)
      rowBgs.push(bg)
      mk(row, b.name, fs(0.032), rowH * 0.24, UI.paperInk, true)
      // 利点と代償は同じ文字の大きさで並べる（PHASE2.md §3。差は色と頭の1字だけ）
      const lineSize = fs(0.025)
      mk(row, `祝　${b.boon}`, lineSize, rowH * 0.56, 0x2f6b4f, false)
      mk(row, `呪　${b.curse}`, lineSize, rowH * 0.82, 0x9c3b2c, false)
      row.eventMode = 'static'
      row.cursor = 'pointer'
      row.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= rowW && y >= 0 && y <= rowH }
      row.on('pointertap', () => {
        selected = selected === i ? null : i // 再タップで解除（採録カードと同じ作法）
        rowBgs.forEach((g, idx) => {
          g.clear()
            .roundRect(0, 0, rowW, rowH, rowH * 0.12)
            .fill({ color: UI.paper, alpha: idx === selected ? 1 : 0.96 })
            .stroke({ width: idx === selected ? 4 : 2, color: idx === selected ? 0xf2d98a : UI.brass, alpha: idx === selected ? 0.95 : 0.7 })
        })
        renderBtn()
      })
      panel.addChild(row)
    })

    renderBtn()
  }

  const startRun = () => {
    runState = createRunState()
    upgradeFireCount.clear()
    lightSeries.length = 0
    drainLog.length = 0
    runSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) | 0
    mapRoot.visible = false
    playRoot.visible = true
    playRoot.removeAllListeners()
    playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
    // 祝福はランの規則（灯・課目・盤面形状）を書き換えるので、決めてから最初の盤面を組む
    showBlessingPanel(() => {
      buildFloorScene(1)
      ensureBgm(themeFloorId(1))
    })
  }

  const buildFloorScene = (floor: number) => {
    const run = runState!
    run.floor = floor
    // 祝福・呪いは課目と盤面形状も書き換えるので、層の正典（FLOORS）を通してから盤面を組む
    const floorDef = applyBlessingsToFloor(FLOORS[floor - 1], run.blessings)
    const floorSeed = (runSeed + floor * 7919) | 0
    board = new Board(buildFloorLevelDef(floor, floorSeed, floorDef), run, floorDef)
    // 灯を奪ったのが誰かを結果画面で名指すための対応表（PHASE2.md §2.5②）。
    // 敵は層の構築時にしか湧かず、倒されると board.enemies から消えるので、ここで種別を控えておく
    const enemyKindById = new Map(board.enemies.map((e) => [e.id, e.kind]))
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
    const dockGap = Math.max(8, vh * 0.016)
    // ドックのアイコンはこのyを「中心」に置くので、半径ぶんを足さないと上端が枠へ食い込む。
    // ここでは実際の iconR（後段で所持数から決まる）の取り得る最大値で見積もる＝どの所持数でも必ず枠の下に出る
    const dockContentHalf = Math.max(vw * 0.055 * 1.2, fs(0.09) / 2)
    // view.framePad ＝ 盤面フレーム素材がタイル格子の外へ張り出す量。これを足さないと
    // 「タイルからの隙間」しか確保できず、アイコンの上端が石枠の下に食い込む（上側の目標バーも同じ理由で下げる）
    const dockTop = boardTop + boardPix + view.framePad + dockGap + dockContentHalf
    // 目標バー：遭遇帯の最下段を1行ぶん借りて盤面の真上に置く（盤面には絶対に重ねない。[A]4バンド予算の内側）
    const goalBarH = vh * 0.05
    const goalBarY = boardTop - view.framePad - goalBarH - vh * 0.014

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
    // 敵が1体もいない層（層1）ではチップを作らない。敵編成は Board 構築時に確定し層の途中で増えないので
    // 静的分岐で足りる（「残敵 0」「静観中」という無内容の2枠が一等地を占めるのを構造的に断つ）
    const hasEnemies = board.enemies.length > 0
    // 殲滅目標の層（ボス層を除く）は、左チップを「敵の正体」に振り替える。生存敵が1種類のときだけ名乗らせ、
    // 混成なら従来どおり「残敵 N」に戻す（将来の編成変更でも嘘にならない安全弁）
    const wipeFloor = board.goals.some((g) => g.type === 'enemy-kill') && !board.enemies.some((e) => e.kind === 'boss')
    const wipeKinds = new Set(board.enemies.map((e) => e.kind))
    const wipeKindName = wipeFloor && wipeKinds.size === 1 ? ENEMY_INFO[[...wipeKinds][0]].name : null
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
      // 文字列は敵名・行数ともに可変（『あと3手：崩落』『深匣主／HP 12 / 12』等）。
      // どんな長さでもチップ内に必ず収めるため、設定のたびに実測して縮める（「たまたま収まる」を作らない）
      const setText = (s: string, fill?: number) => {
        t.scale.set(1)
        t.text = s
        if (fill !== undefined) t.style.fill = fill
        const k = Math.min(1, (chipW * 0.9) / Math.max(1, t.width), (chipH * 0.86) / Math.max(1, t.height))
        if (k < 1) t.scale.set(k)
      }
      return { root: c, text: t, setText }
    }
    const enemyChip = hasEnemies ? buildChip(vw * 0.04) : null
    const actionChip = hasEnemies ? buildChip(vw * 0.96 - chipW) : null

    let bust: Sprite | null = null
    if (bustTex) {
      bust = new Sprite(bustTex)
      bust.anchor.set(0.5, 1)
      // バストは遭遇帯の天井から立ち上げ、左右のチップの「間」を通す（縦に積まない）。
      // 積むと短尺機で高さ28pxまで潰れ、「状態の語り手」として機能しなくなる。
      const bustAreaTop = encTop + vh * 0.005
      // チップ2枚の間に空く幅（左右に余白）。チップが無い層は帯を丸ごと使える
      const bustMaxW = hasEnemies ? vw - chipW * 2 - vw * 0.12 : vw * 0.6
      const bustH = Math.min(
        (goalBarY - bustAreaTop) * 0.98,
        vh * 0.26,
        bustMaxW * (bustTex.height / bustTex.width), // 横でもクランプ＝チップに潜り込ませない
      )
      bust.scale.set(Math.max(1, bustH) / bustTex.height)
      bust.position.set(vw * 0.5, goalBarY + vh * 0.006)
      playRoot.addChildAt(bust, playRoot.getChildIndex(view.root))
      // 下端のフェードマスク：目標バーの黒地で「切断」される代わりに霞んで消える（宙に浮いた胴体に見せない）
      {
        const cv = document.createElement('canvas')
        cv.width = 8
        cv.height = 256
        const c2 = cv.getContext('2d')!
        const grd = c2.createLinearGradient(0, 0, 0, 256)
        grd.addColorStop(0, 'rgba(255,255,255,1)')
        grd.addColorStop(0.72, 'rgba(255,255,255,1)')
        grd.addColorStop(1, 'rgba(255,255,255,0)')
        c2.fillStyle = grd
        c2.fillRect(0, 0, 8, 256)
        const mk = new Sprite(Texture.from(cv))
        mk.anchor.set(0.5, 1)
        mk.width = bust.width * 1.1
        mk.height = bust.height
        mk.position.set(bust.position.x, bust.position.y)
        playRoot.addChildAt(mk, playRoot.getChildIndex(bust))
        bust.mask = mk
      }
      // 被弾予告：バストの背後に置く楕円の縁光。下端は目標バーの上端で止める（バーに絶対に被せない）。
      // 前面のベタ円だとバストを覆い潰し、円の下半分がチップで切断されて赤い半円が残っていた。
      const glowCx = vw * 0.5
      const glowCy = bust.y - bust.height * 0.5
      const glowRy = Math.max(2, goalBarY - glowCy)
      const glowRx = Math.max(bust.width * 0.72, glowRy * 0.8)
      bustGlow
        .ellipse(glowCx, glowCy, glowRx, glowRy)
        .fill({ color: 0xd6432f, alpha: 0.18 })
        .stroke({ width: Math.max(1.5, vw * 0.005), color: 0xd6432f, alpha: 0.6 })
      playRoot.setChildIndex(bustGlow, playRoot.getChildIndex(bust)) // バストの背後へ（ui/目標バーより下）
    }

    // ---------- 目標バー：層の目的を盤面の真上に1行で置く（何を何個集めるかを常に読ませる） ----------
    // 公開する形は { root, icon, setValue } の3点だけ。icon のローカル原点＝アイコン中心＝収集の飛翔の着弾点。
    interface GoalChip {
      root: Container
      icon: Container
      setValue: (v: number) => void
    }
    const goalChips: GoalChip[] = []
    const GOAL_LABEL: Partial<Record<GoalType, string>> = {
      system: '植物標本',
      tsutagoke: '蔦苔の浄化',
      touhen: '陶片の回収',
      'enemy-kill': '掃討',
      kokeishi: '苔石',
      color: '採集',
      spore: '胞子の搬送',
    }
    /** 目標アイコン（新規素材は作らない）。植物標本は葉(n1)とキノコ(n4)を半分ずつ重ねて「どちらも進む」を示す */
    const makeGoalIcon = (g: Goal, size: number): Container => {
      const c = new Container()
      const add = (key: string, dx: number) => {
        const tex = spriteTexture(key)
        if (!tex) return
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set(size / Math.max(tex.width, tex.height))
        sp.position.set(dx, 0)
        c.addChild(sp)
      }
      if (g.type === 'system' && g.system === 'plant') {
        add('n1', -size * 0.16)
        add('n4', size * 0.16)
      } else if (g.type === 'system') add(CATEGORY_ICON[g.system!] ?? 'n1', 0)
      else if (g.type === 'color') add(CATEGORY_ICON[systemOf(g.color ?? 0)] ?? 'n1', 0)
      else if (g.type === 'tsutagoke') add('moss_icon', 0)
      else if (g.type === 'touhen') add('touhen', 0)
      else if (g.type === 'kokeishi') add('kokeishi', 0)
      else if (g.type === 'enemy-kill') {
        // 敵種は board.enemies ではなく floorDef から引く（この関数は撃破後の飛翔演出からも呼ばれ、
        // そのとき board.enemies は空になり得る）。これでチップの絵が盤面の敵と一致する
        const kind = floorDef.enemies[0]?.kind
        if (kind) c.addChild(makeEnemyIconContainer(kind, size))
        else add('e_swarm', 0)
      } else add('spore', 0)
      if (!c.children.length) {
        const gg = new Graphics()
        gg.circle(0, 0, size * 0.4).fill(UI.brass)
        c.addChild(gg)
      }
      return c
    }
    // ボス層（課目＝ボス撃破1件のみ）では課目バーを出さない。左チップの「匣 n/4 → HP n/m」と
    // 盤面のボスゲージが同じことを語っており、『掃討 0/1』は層クリアまで一度も動かない純粋なノイズになるため。
    const bossOnlyGoal = board.goals.length === 1 && board.goals[0].type === 'enemy-kill' && board.enemies.some((e) => e.kind === 'boss')
    if (!bossOnlyGoal) {
      const n = board.goals.length
      // [F]§2「課目：分数をやめ、残りを読む」：黒いカプセルを個別に置くのをやめ、羊皮紙一枚の中へ最大2つ納める。
      // 分数（9/50）は残り作業量の逆算を強いるので、通常時は残数（あと41）だけを出し、長押しのあいだだけ分数を補助表示する。
      const entryW = Math.min(vw * 0.52, (vw * 0.92) / Math.max(1, n))
      const sheetW = entryW * n
      const sheetX = (vw - sheetW) / 2
      const sheet = new Graphics()
      sheet.roundRect(0, 0, sheetW, goalBarH, goalBarH * 0.16).fill({ color: UI.paper, alpha: 0.95 }).stroke({ width: 2, color: UI.brass, alpha: 0.9 })
      if (n > 1) {
        // 二つ並ぶときだけ、紙の折り目にあたる縦罫を1本入れて「どちらの残数か」を分ける
        for (let i = 1; i < n; i++) sheet.moveTo(i * entryW, goalBarH * 0.18).lineTo(i * entryW, goalBarH * 0.82)
        sheet.stroke({ width: 1, color: UI.paperInk, alpha: 0.3 })
      }
      sheet.position.set(sheetX, goalBarY)
      ui.addChild(sheet)
      board.goals.forEach((g, i) => {
        const root = new Container()
        const icon = makeGoalIcon(g, goalBarH * 0.7)
        icon.position.set(goalBarH * 0.56, goalBarH / 2)
        root.addChild(icon)
        // 数字は先に作って実幅を測る（2桁と3桁で幅が変わるため、ラベルの取り分は数字の実測から決める）
        const numFont = goalBarH * 0.42
        const num = new Text({ text: `あと${g.count}`, style: { fill: UI.paperInk, fontSize: numFont, fontFamily: FONT, fontWeight: 'bold' } })
        num.anchor.set(1, 0.5)
        const numRight = entryW - goalBarH * 0.24
        num.position.set(numRight, goalBarH / 2)
        const numMaxW = entryW * 0.44 // 桁が増えても枠幅の4割強を超えさせない（左のラベルを食い潰さない）
        const fitNum = () => {
          num.scale.set(1)
          if (num.width > numMaxW) num.scale.set(numMaxW / num.width)
        }
        fitNum()
        root.addChild(num)
        // 植物標本アイコンは葉＋茸を左右にずらして重ねるぶん実幅が size の約1.3倍ある。ラベルの左端はその外側に置く
        const labelX = goalBarH * 1.14
        const label = new Text({
          text: GOAL_LABEL[g.type] ?? '課目',
          style: { fill: UI.paperInk, fontSize: goalBarH * 0.3, fontFamily: FONT, fontWeight: 'bold' },
        })
        label.anchor.set(0, 0.5)
        label.alpha = 0.82 // ラベルは残数より一段降ろす（読み順＝アイコン→残数）
        label.position.set(labelX, goalBarH / 2)
        // ラベルは「数字の左端まで」に必ず収める（溢れたら縮める。改行させないのは1行バーだから）
        const labelMaxW = Math.max(goalBarH * 0.6, numRight - numMaxW - goalBarH * 0.16 - labelX)
        if (label.width > labelMaxW) label.scale.set(labelMaxW / label.width)
        root.addChild(label)
        // 完了印：数字を0にせず金の採録印へ変える（[F]§2）。押印は300msだけ跳ねる
        const sealR = goalBarH * 0.3
        const seal = new Container()
        const sealG = new Graphics()
        sealG.circle(0, 0, sealR).fill({ color: 0xd8a12a, alpha: 0.96 }).stroke({ width: Math.max(1.5, sealR * 0.14), color: 0x8a5a12, alpha: 0.9 })
        const sealT = new Text({ text: '採', style: { fill: 0x3a2408, fontSize: sealR * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
        sealT.anchor.set(0.5)
        seal.addChild(sealG, sealT)
        seal.position.set(numRight - sealR, goalBarH / 2)
        seal.rotation = -0.12 // 手で押した傾き
        seal.visible = false
        root.addChild(seal)
        root.position.set(sheetX + i * entryW, goalBarY)
        ui.addChild(root)

        let curV = 0
        let ratioMode = false // 長押し中だけ true（分数の補助表示）
        let sealed = false
        const paint = (v: number) => {
          if (v >= g.count) {
            if (sealed) return
            sealed = true
            num.visible = false
            seal.visible = true
            seal.scale.set(0)
            tw.tween(seal.scale, { x: 1, y: 1 }, 300, { ease: tw.easeOutBack })
            return
          }
          num.text = ratioMode ? `${v} / ${g.count}` : `あと${g.count - v}`
          fitNum()
        }
        // 長押しで分数を出す。課目バーは盤面の外なので、盤面のスワイプ判定（toCellがnullを返す）とは競合しない
        root.eventMode = 'static'
        root.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= entryW && y >= 0 && y <= goalBarH }
        let holding = false
        root.on('pointerdown', () => {
          holding = true
          tw.delay(400, () => {
            if (!alive() || !holding || num.destroyed || ratioMode) return
            ratioMode = true
            paint(curV)
          })
        })
        const releaseHold = () => {
          holding = false
          if (!ratioMode) return
          ratioMode = false
          if (!num.destroyed) paint(curV)
        }
        root.on('pointerup', releaseHold)
        root.on('pointerupoutside', releaseHold)

        goalChips.push({
          root,
          icon,
          setValue: (v: number) => {
            if (num.destroyed) return
            curV = v
            paint(v)
          },
        })
      })
    }

    // ---------- HUD（ランHUD1行：左=深度／中央=酸素ゲージ／右=メニュー。[A]） ----------
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
      // 通し30層は「到達が難しくてよい」＝進捗バーではないので分母を出さない（PHASE2.md §1）。空白入りだと円内に収まらない
      text: `深度${floor}`,
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

    // 酸素ゲージ「探窟灯の油槽」（[B]）：幅優先で素材アスペクトを保ち、HUD行の高さに収まらなければ縮める
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
    // 酸素僅少時のランタン炎ゆらぎ（素材の炎位置＝左端付近への簡易オーバーレイ。周期1.4〜1.8秒でランダムに小さくなる）
    const flameFlicker = new Graphics()
    flameFlicker.circle(gaugeW * 0.095, gaugeH * 0.3, gaugeH * 0.3).fill({ color: 0xffb347, alpha: 0.55 })
    flameFlicker.visible = false
    gaugeRoot.addChild(flameFlicker)
    let flameFlickerActive = false
    const flameFlickerLoop = () => {
      if (!flameFlickerActive || flameFlicker.destroyed) return
      const dur = 700 + Math.random() * 200 // 半周期0.7〜0.9秒＝全体1.4〜1.8秒（高速点滅は禁止。[B]警告時の注記）
      const scale = 0.65 + Math.random() * 0.5
      tw.tween(flameFlicker.scale, { x: scale, y: scale }, dur, { onDone: flameFlickerLoop })
      tw.tween(flameFlicker, { alpha: 0.3 + Math.random() * 0.45 }, dur)
    }
    const oxyNumText = new Text({
      text: '',
      style: { fill: 0xf4e8cf, fontSize: gaugeH * 0.4, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
    })
    oxyNumText.anchor.set(1, 0.5)
    oxyNumText.position.set(chX1 - gaugeW * 0.015, (chY0 + chY1) / 2)
    gaugeRoot.addChild(oxyNumText)

    /** ゲージの塗り＋強奪予告の斜線オーバーレイを最新化する（酸素の実数はrefreshFloorHudが都度渡す） */
    const drawGauge = (oxygen: number, full: number, pendingDrain: number) => {
      const ratio = Math.max(0, Math.min(1, oxygen / full))
      const low = oxygen > 0 && oxygen <= OXYGEN_LOW // 割合ではなく絶対量で警告する（貯金で分母が嘘になるため）
      backingG.clear()
      backingG.roundRect(chX0, chY0, chW, chH, chH * 0.22).fill(0x2a1c10)
      fillG.clear()
      hatchLayer.removeChildren().forEach((c) => c.destroy())
      let fillW = 0
      if (oxygen > 0) {
        fillW = ratio * chW
        fillW = Math.max(0, Math.min(chW, fillW))
        fillW = Math.max(fillW, chH * 0.35) // 残り1でも「まだ残っている」ことが見える最低幅
        fillG.roundRect(chX0, chY0, fillW, chH, chH * 0.22).fill(0xd9922e)
        fillG.roundRect(chX0, chY0, fillW, chH * 0.42, chH * 0.18).fill({ color: 0xf2c96a, alpha: 0.8 })
        const pendW = Math.min(fillW, (Math.min(oxygen, pendingDrain) / full) * chW)
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
      oxyNumText.text = String(Math.max(0, oxygen)) // 分母は出さない（補給の貯金で満タンを超えるため嘘になる）
      oxyNumText.style.fill = low ? 0xff8a70 : 0xf4e8cf
      if (low !== flameFlickerActive) {
        flameFlickerActive = low
        flameFlicker.visible = low
        if (low) flameFlickerLoop()
        else {
          flameFlicker.scale.set(1)
          flameFlicker.alpha = 1
        }
      }
    }

    /** 酸素強奪の実況：80msの白い芯→180msの油揺れ（2px横揺れ）→数値わきに「-N」が浮かぶ（[B]被弾時の指示） */
    const oxygenDrainFx = (amount: number) => {
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
      dmgT.position.set(gaugeBaseX + oxyNumText.position.x - oxyNumText.width * 0.5, gaugeRoot.position.y - gaugeH * 0.3)
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

    /** 層クリアの補給：ゲージが左→右へ琥珀色に満ち、数字わきに「+7」が浮く */
    const oxygenRefillFx = (amount: number) => {
      const t = new Text({
        text: `+${amount}`,
        style: { fill: 0xf2c96a, fontSize: gaugeH * 0.42, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } },
      })
      t.anchor.set(0.5)
      t.position.set(gaugeBaseX + oxyNumText.position.x - oxyNumText.width * 0.5, gaugeRoot.position.y - gaugeH * 0.3)
      ui.addChild(t)
      tw.tween(t.position, { y: t.position.y - fs(0.05) }, 520, { ease: tw.easeOutCubic })
      tw.tween(t, { alpha: 0 }, 380, { delay: 200, onDone: () => { if (!t.destroyed) t.destroy() } })
      tw.delay(60, () => { if (alive()) refreshFloorHud() }) // 実値へ確定
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
      const panelH = rowH * 3 // ミュート → 振動 → divider → ラン中断 の3行
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
      // 振動行（P7 juice/haptics）。非対応端末（iOS Safari）はグレー表示でヒット領域を作らない＝嘘をつかない
      const hapticsLabel = () => (!hapticsSupported() ? '振動（この端末は非対応）' : hapticsEnabled() ? '振動：オン' : '振動：オフ')
      const hapticsRow = new Text({
        text: hapticsLabel(),
        style: { fill: hapticsSupported() ? 0xf4e8cf : 0x8a7c68, fontSize: fs(0.034), fontFamily: FONT, fontWeight: 'bold' },
      })
      hapticsRow.anchor.set(0, 0.5)
      hapticsRow.position.set(panelW * 0.08, rowH * 1.5)
      panel.addChild(hapticsRow)
      if (hapticsSupported()) {
        const hapticsHit = new Container()
        hapticsHit.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= panelW && y >= rowH && y <= rowH * 2 }
        hapticsHit.eventMode = 'static'
        hapticsHit.cursor = 'pointer'
        hapticsHit.on('pointertap', () => {
          toggleHaptics()
          hapticsRow.text = hapticsLabel()
        })
        panel.addChild(hapticsHit)
      }
      const divider = new Graphics()
      divider.moveTo(panelW * 0.06, rowH * 2).lineTo(panelW * 0.94, rowH * 2).stroke({ width: 1.5, color: UI.brass, alpha: 0.5 })
      panel.addChild(divider)
      const abandonRow = new Text({
        text: '探窟を切りあげて拠点へ',
        style: { fill: 0xe0a89c, fontSize: fs(0.034), fontFamily: FONT, fontWeight: 'bold' },
      })
      abandonRow.anchor.set(0, 0.5)
      abandonRow.position.set(panelW * 0.08, rowH * 2.5)
      panel.addChild(abandonRow)
      const abandonHit = new Container()
      abandonHit.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= panelW && y >= rowH * 2 && y <= rowH * 3 }
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

    /** 遭遇帯の更新：残敵/ボス情報＋次行動の要約、強奪予告の合計酸素を返す（酸素ゲージへ渡す） */
    // ゲージの分母＝「その層のタンク容量」。層の途中では動かさない（動かすと1手ぶんの減りが見えなくなる）。
    // 補給で貯金が乗ったぶんだけ層クリア時に広がり、使い切れば自動的に既定容量へ戻る。
    let gaugeFull = Math.max(OXYGEN_GAUGE_FULL, run.oxygen)
    const refreshEncounter = (): number => {
      const info = computeEncounterInfo(board)
      if (!enemyChip || !actionChip) return 0 // 敵ゼロの層はチップ自体が無い
      if (info.boss) {
        // 第1段階は匣の残り枚数、核が露出してからHP（見るべき数字が段階で変わる）
        enemyChip.setText(
          info.boss.bossPhase === 1
            ? `${BOSS_NAME}\n匣 ${info.boss.bossShellLeft}/${BOSS_SHELL_COUNT}`
            : `${BOSS_NAME}\nHP ${Math.max(0, info.boss.hp)} / ${info.boss.maxHp}`,
        )
      } else if (wipeFloor && wipeKindName) {
        // 殲滅目標の層では数の勘定は目標バーに一本化し、左チップは「敵の正体」を名乗る
        // （「残敵 3」と「掃討 1/4」で同じ盤面を逆向きの2つの数字で語るのをやめる）
        enemyChip.setText(wipeKindName)
      } else {
        enemyChip.setText(`原生種 のこり${info.aliveCount}`)
      }
      const lethal = run.oxygen > 0 && info.nextOxygenLoss > 0 && run.oxygen - info.nextOxygenLoss <= 0
      if (lethal) {
        actionChip.setText(`あと${info.minTurns ?? 1}手\n灯が尽きる`, 0xff8a70)
      } else if (info.minTurns !== null) {
        // 妨害しかしない敵でもチップが必ず語る（外すと10層中8層が「静観中」になる）。
        // PHASE2 §3「兆候は動作名＋残り手（崩落 2）」。区切りは全角空白：半角だと『灯−3 3』が
        // 『灯−33』と1つの数に見えてしまう（折り返してもこの位置で割れるので語の途中では切れない）
        actionChip.setText(`${info.nextLabel ?? '妨害'}　${info.minTurns}`, info.nextOxygenLoss > 0 ? 0xff8a70 : UI.badgeText)
      } else if (info.idleCount > 0) {
        // 定期行動を持たない敵（小型胞子虫）しかいない層で「静観中」と出すのは無内容。
        // 真で、かつ手を変える事実＝「4個以上のまとめ消しで倒すと隣へ伝播する」を出す
        actionChip.setText('まとめ消しで伝播', UI.badgeText)
      } else {
        actionChip.setText('静観中', UI.badgeText)
      }
      bustGlow.visible = info.pendingOxygen > 0
      if (bust) bust.tint = info.pendingOxygen > 0 ? 0xff9c86 : 0xffffff // 小さいバストでも必ず読める主フィードバック
      return info.pendingOxygen
    }

    /** oxygenOverride：補給前の値でゲージを描きたいとき（層クリアの+7は演出で見せるため即時反映しない） */
    const refreshFloorHud = (oxygenOverride?: number) => {
      const pendingDrain = refreshEncounter()
      drawGauge(Math.max(0, oxygenOverride ?? run.oxygen), gaugeFull, pendingDrain)
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
    ownedUpgrades.forEach((id, i) => {
      const def = UPGRADES.find((u) => u.id === id)
      if (!def) return
      // ドラフトカード・野帳と同じ固有アイコンを使う（系統色メダルだと10個中5個が同じ葉になり判別できない上、
      // 灰色石の台が盤面フレームの石テクスチャに溶ける）。固有アイコンが無いIDは従来の見た目へ自動フォールバック
      const m = makeUniqueUpgradeIcon(id, iconR * 2.3)
      m.eventMode = 'static'
      m.cursor = 'pointer'
      m.hitArea = { contains: (x: number, y: number) => x * x + y * y <= iconR * iconR * 2.4 }
      m.on('pointertap', () => showFieldNote(buildUpgradeEntry(def, run)))
      m.position.set(iconAreaCenterX + (i - (ownedUpgrades.length - 1) / 2) * iconSpacing, 0)
      boosterBar.addChild(m)
      upgradeIconG.set(id, m)
    })
    boosterBar.position.set(0, dockTop) // 盤面フレーム下端との間は dockGap（>=8px）確保済み（[A]ビルドドック必達条件）
    ui.addChild(boosterBar)
    refreshProgressBadges() // 可視化第二波④：層開始時点の進捗（あれば）を反映

    // 「野帳」ボタン（ビルドドック右端。[C]特殊駒の主導線＝タップで4種＋効果の一覧シート）
    const noteBtn = new Container()
    const noteBtnW = Math.min(dockNoteBtnW, vw * 0.2)
    const noteBtnH = Math.max(iconR * 2.1, fs(0.09))
    const noteBg = new Graphics()
    noteBg.roundRect(-noteBtnW / 2, -noteBtnH / 2, noteBtnW, noteBtnH, noteBtnH * 0.28).fill({ color: 0x2a1c10, alpha: 0.9 }).stroke({ width: 2, color: UI.brass })
    noteBtn.addChild(noteBg)
    const noteLabel = new Text({ text: '採録帖', style: { fill: 0xf4e8cf, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' } })
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
    view.onEnemyTap = (enemy) => showFieldNote(buildEnemyEntry(enemy, run.blessings))
    /** 可視化第二波②：「どの敵が奪ったか」を軌跡で示してから酸素ゲージの被弾演出（oxygenDrainFx）へ繋ぐ */
    view.onOxygenDrained = (enemyId, amount) => {
      const en = board.enemies.find((e) => e.id === enemyId)
      const cell = en?.cells[en.cells.length - 1] ?? null
      const toX = gaugeRoot.position.x + (chX0 + chX1) / 2
      const toY = gaugeRoot.position.y + (chY0 + chY1) / 2
      if (cell) {
        const fromX = view.root.position.x + (cell.x + 0.5) * view.S
        const fromY = view.root.position.y + (cell.y + 0.5) * view.S
        enemyAttackTrailFx(fromX, fromY, toX, toY)
        tw.delay(220, () => {
          if (!alive()) return
          oxygenDrainFx(amount)
        })
      } else {
        // 敵の位置が特定できない（撃破直後など）場合も被弾演出自体は必ず出す
        oxygenDrainFx(amount)
      }
    }

    // ---------- 目標収集の飛翔（JUICE.md §1②）：盤面で壊れた成果がHUDの目標チップへ吸い込まれる ----------
    const FLY_ORIGIN = new Point(0, 0)
    const goalShown = board.goals.map(() => 0) // HUDに出ている値。board.goalDone とは別に持つ
    let flightsInAir = 0
    const goalCollectFly = (index: number, done: number, fromGlobal: { x: number; y: number }, flightIndex: number) => {
      const chip = goalChips[index]
      if (!chip || chip.icon.destroyed || !alive()) return
      if (flightsInAir >= 12) {
        goalShown[index] = done
        chip.setValue(done)
        return
      }
      // 座標系：BoardView は view.root の子、チップは ui の子。どちらも playRoot の子孫なので global 経由で落とす
      const from = playRoot.toLocal(fromGlobal as Point)
      const to = playRoot.toLocal(chip.icon.toGlobal(FLY_ORIGIN))
      const icon = makeGoalIcon(board.goals[index], view.S * 0.62)
      icon.position.set(from.x, from.y)
      icon.scale.set(0.4)
      icon.alpha = 0
      playRoot.addChild(icon)
      flightsInAir++
      // A（0-90ms）ためて弾ける
      const kickA = -Math.PI / 2 + (flightIndex % 2 ? 0.55 : -0.55)
      const kickD = view.S * 0.22
      tw.tween(icon, { alpha: 1 }, 60, { channel: 'fx' })
      tw.tween(icon.scale, { x: 1.15, y: 1.15 }, 90, { ease: tw.easeOutBackSoft, channel: 'fx' })
      tw.tween(icon.position, { x: from.x + Math.cos(kickA) * kickD, y: from.y + Math.sin(kickA) * kickD }, 90, { ease: tw.easeOutCubic, channel: 'fx' })
      // B（90ms〜）弧を描いて吸われる。x と y に別のイージングを与えると経路が曲がる（ベジェ評価器は足さない）
      // x を先に詰め、y を後から効かせる（逆にすると着弾点の高さに約160ms早く到達し、その間アイコンが
      // HUDチップ行の上を横切ってラベルを覆う）。経路は「盤の高さで横に流れ→最後に下からチップへ吸い上がる」
      const D = Math.min(450, 320 + flightIndex * 14)
      tw.tween(icon.position, { y: to.y }, D, { delay: 90, ease: tw.easeInQuad, channel: 'fx' })
      tw.tween(icon.scale, { x: 0.55, y: 0.55 }, D, { delay: 90, ease: tw.easeOutCubic, channel: 'fx' })
      tw.tween(icon.position, { x: to.x }, D, {
        delay: 90,
        ease: tw.easeOutCubic,
        channel: 'fx',
        onDone: () => {
          flightsInAir--
          if (!icon.destroyed) icon.destroy()
          if (!alive() || chip.icon.destroyed) return
          goalShown[index] = Math.max(goalShown[index], done)
          chip.setValue(goalShown[index])
          tw.tween(chip.icon.scale, { x: 1.3, y: 1.3 }, 90, {
            onDone: () => {
              if (!chip.icon.destroyed) tw.tween(chip.icon.scale, { x: 1, y: 1 }, 150, { ease: tw.easeOutBack })
            },
          })
          sfx.drain(flightIndex) // 既存SE流用（semitone(980, i%12) の上昇ピング）。新規音は作らない
        },
      })
    }
    view.onGoalCollect = goalCollectFly

    /** 数字ずれの保険（飛翔ロスト・シーン破棄・上限超過）。落ちたぶんを黙って追いつかせる＝跳ねさせない */
    const syncGoalDisplay = () => {
      board.goalDone.forEach((v, i) => {
        if (goalShown[i] === v) return
        goalShown[i] = v
        goalChips[i]?.setValue(v)
      })
    }
    syncGoalDisplay() // 層開始時の初期化

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
    // 層間の採録帯（[D]§2）が出す2値。ラン通算の upgradeFireCount とは別に、この層ぶんだけを同じイベント列から数える
    let movesThisFloor = 0
    // 補給量は祝福・呪いで動くので定数ではなく実際に起きた値を採録帯へ渡す
    let refillAmount = OXYGEN_SUPPLY_PER_FLOOR
    const floorFireCount = new Map<string, number>()
    const handleFloorResult = (evs: BoardEvent[]) => {
      const dur = view.play(evs)
      // 飛翔が落ちても数字は必ず board.goalDone に追いつく（演出の取りこぼしを表示に持ち込まない）
      tw.delay(Math.min(dur + 500, 2200), () => {
        if (alive()) syncGoalDisplay()
      })
      const refill = evs.find((e) => e.t === 'oxygen-refill')
      if (refill && refill.t === 'oxygen-refill') refillAmount = refill.amount
      // 「なぜ細ったか」の記録（PHASE2.md §2.5②）。層を出るときの灯は補給を足す前の値
      if (refill && refill.t === 'oxygen-refill') lightSeries.push({ floor, light: refill.left - refill.amount })
      for (const e of evs) {
        if (e.t !== 'oxygen-drained') continue
        const kind = enemyKindById.get(e.id)
        if (kind === 'breathstealer' || kind === 'boss') drainLog.push({ floor, kind, amount: e.amount })
      }
      // 補給ぶんは層クリアバナーで見せるので、この時点では補給前の値でゲージを描く
      refreshFloorHud(refill && refill.t === 'oxygen-refill' ? refill.left - refill.amount : undefined)
      refreshProgressBadges() // 可視化第二波④：1手ごとに進捗（あれば）を反映
      // 結果画面の主記録用（夜間監査[C]7/[E]3）：1手＝このevs全体で発火した upgrade-fire の件数。board.ts は変更禁止のため
      // main.ts側でイベント列を数えて集計する（board.ts が触らない run.records の追加フィールド）。
      const firesThisMove = evs.reduce((n, e) => n + (e.t === 'upgrade-fire' ? 1 : 0), 0)
      for (const e of evs) {
        if (e.t !== 'upgrade-fire') continue
        upgradeFireCount.set(e.id, (upgradeFireCount.get(e.id) ?? 0) + 1)
        floorFireCount.set(e.id, (floorFireCount.get(e.id) ?? 0) + 1)
      }
      if (firesThisMove > run.records.maxFiresInOneMove) run.records.maxFiresInOneMove = firesThisMove
      // 酸素を直接奪われた手はゲージ側でも必ず被弾を見せる（軌跡は onOxygenDrained が別に出す）
      for (const e of evs) if (e.t === 'oxygen-drained') oxygenDrainFx(e.amount)
      // 忘れ形見（祝福）で灯が戻った手は、補給と同じ演出でゲージへ入れる（尽きた事実を黙って通さない）
      for (const e of evs) if (e.t === 'last-light') oxygenRefillFx(e.amount)
      // 1手ぶんの消費(-1)は数字の脈動だけで示す。音・揺れ・赤フラッシュは出さない（毎手鳴らすとメリハリが死ぬ。JUICE §0-2）
      if (evs.some((e) => e.t === 'oxygen-spent')) {
        movesThisFloor++ // 1手＝酸素-1。採録帯の「この層 N手」はこの数え方（不成立スワップは含まない）
        const big = run.oxygen <= OXYGEN_CRITICAL
        tw.tween(oxyNumText.scale, { x: big ? 1.25 : 1.12, y: big ? 1.25 : 1.12 }, big ? 130 : 100, {
          onDone: () => {
            if (!oxyNumText.destroyed) tw.tween(oxyNumText.scale, { x: 1, y: 1 }, big ? 130 : 100)
          },
        })
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
        // 灯が尽きた層も推移の最後の点として残す（負の値は「尽きた」と同じ事実なので0に丸める）
        lightSeries.push({ floor, light: Math.max(0, run.oxygen) })
        tw.delay(Math.min(dur, 900), () => {
          if (alive()) showRunResult(false)
        })
      }
    }

    const onFloorClear = () => {
      // ボス層クリア＝ラン勝利（ROGUE.md §6）。深度20/30は層が増えたときにそのまま繋がる
      const next = floor >= FLOORS.length ? () => showRunResult(true) : showFloorRecordBand
      // 幕主を仕留めた者に祝福を1つ（PHASE2.md §3。深度10/20）
      if (isBlessingFloor(floor)) showBlessingPanel(next)
      else next()
    }

    /**
     * 層クリアの採録帯（codex_strategy_v2 [D]）。通常層は**1.8秒・入力待ちなし**でドラフトの前に挟む。
     *   0.00〜0.35 盤面が一段暗くなる（最後の収集物が課目へ飛ぶのは、この手のタイムラインが既に担っている）
     *   0.25〜0.95 細い採録帯が下から出る。`深度N 踏破`
     *   0.55〜1.45 酸素がゲージへ入り、同時に手数と最多発火知見だけを出す
     *   1.45〜1.80 採録帯が上へ抜け、採録（ドラフト）へつなぐ
     * 出すのはこの3つだけ。全知見の発火一覧・総破壊数・星・スコア・評価語は出さない（[D]§3）。
     */
    const showFloorRecordBand = () => {
      sfx.fanfare()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0 })
      dim.eventMode = 'static' // 早送りのタップをここで受ける（背面の盤面には触らせない）
      playRoot.addChild(dim)
      tw.tween(dim, { alpha: 0.34 }, 350)

      const padX = Math.max(20, vw * 0.06)
      const bandH = vh * 0.19
      const bandTop = vh * 0.46
      const band = new Container()
      const bandBg = new Graphics()
      bandBg.rect(0, 0, vw, bandH).fill({ color: UI.paper, alpha: 0.97 })
      bandBg.moveTo(0, 1).lineTo(vw, 1).moveTo(0, bandH - 1).lineTo(vw, bandH - 1).stroke({ width: 2, color: UI.brass, alpha: 0.95 })
      band.addChild(bandBg)
      band.position.set(0, vh) // 画面外の下から出す
      playRoot.addChild(band)
      // 帯の中は羊皮紙なので墨色で書く。字送りは帯の高さから引く（機種で帯が痩せても行が重ならない）
      const mk = (text: string, size: number, x: number, y: number, ax: number, maxW: number) => {
        const t = new Text({ text, style: { fill: UI.paperInk, fontSize: size, fontFamily: FONT, fontWeight: 'bold' } })
        t.anchor.set(ax, 0.5)
        t.position.set(x, y)
        if (t.width > maxW) t.scale.set(maxW / t.width)
        band.addChild(t)
        return t
      }
      // 最多発火の1件だけ。0回の知見は責めない（同数なら先に発火したほうを採る）
      let bestId = ''
      let bestFires = 0
      for (const [id, c] of floorFireCount) {
        if (c > bestFires) {
          bestFires = c
          bestId = id
        }
      }
      const bestDef = bestFires > 0 ? UPGRADES.find((u) => u.id === bestId) : undefined
      // 発火が1件も無い層は3行目が消えるので、残る2行を帯の中で取り直す（下に空白帯を残さない）
      const rowY = bestDef ? [0.27, 0.59, 0.85] : [0.34, 0.68]
      mk(`深度${floor} 踏破`, bandH * 0.24, padX, bandH * rowY[0], 0, vw * 0.48)
      // 手数に星評価は付けない（[D]§3）。補給は「量」と「結果」の両方を出す
      const movesT = mk(`この層 ${movesThisFloor}手`, bandH * 0.17, vw - padX, bandH * rowY[0], 1, vw * 0.32)
      const oxyT = mk(`灯 +${refillAmount} → 残灯 ${run.oxygen}`, bandH * 0.22, padX, bandH * rowY[1], 0, vw - padX * 2)
      const bestT = bestDef ? mk(`最も働いた知見：${bestDef.name} ${bestFires}回`, bandH * 0.155, padX, bandH * rowY[2], 0, vw - padX * 2) : null
      const laterLines: Text[] = bestT ? [movesT, oxyT, bestT] : [movesT, oxyT]
      for (const t of laterLines) t.alpha = 0

      let refilled = false
      let exited = false
      // 補給はゲージ側で見せる（handleFloorResult が補給前の値で描いてあるので、ここで実値へ確定する）
      const doRefill = () => {
        if (refilled || !alive()) return
        refilled = true
        gaugeFull = Math.max(OXYGEN_GAUGE_FULL, run.oxygen) // 分母が変わるのは補給演出の瞬間だけ（層途中でバーが後戻りしない）
        oxygenRefillFx(refillAmount)
      }
      const doExit = () => {
        if (exited || !alive()) return
        exited = true
        doRefill() // 早送りで③を飛ばしても、補給だけは必ず起こす
        tw.tween(band.position, { y: -bandH }, 350, {
          ease: tw.easeInCubic,
          onDone: () => {
            if (!band.destroyed) band.destroy({ children: true })
          },
        })
        tw.tween(dim, { alpha: 0 }, 300, {
          onDone: () => {
            if (!dim.destroyed) dim.destroy()
          },
        })
        tw.delay(350, () => {
          if (alive()) showDraftPanel()
        })
      }
      tw.tween(band.position, { y: bandTop }, 300, { delay: 250, ease: tw.easeOutCubic }) // ②
      tw.delay(550, () => {
        if (!alive() || exited) return
        doRefill()
        tw.tween(movesT, { alpha: 1 }, 260)
        tw.tween(oxyT, { alpha: 1 }, 300, { delay: 60 })
        if (bestT) tw.tween(bestT, { alpha: 1 }, 300, { delay: 160 })
      })
      tw.delay(1450, doExit) // ④

      // 早送り：0.35秒地点から1.45秒地点へ飛ばす。0秒スキップにはしない（補給が起きた事実は必ず350ms見せる）
      const t0 = performance.now()
      let skipPending = false
      const skipNow = () => {
        if (exited || !alive()) return
        tw.snap(band.position) // 出のトゥイーンを終端（bandTop）へ飛ばしてから抜けへ繋ぐ
        for (const t of laterLines) if (!t.destroyed) t.alpha = 1
        doExit()
      }
      dim.on('pointertap', () => {
        if (skipPending || exited) return
        const dt = performance.now() - t0
        skipPending = true
        if (dt >= 350) skipNow()
        else tw.delay(350 - dt, skipNow)
      })
    }

    /**
     * 知見の枠が埋まっているときの「手放す1つを選ぶ」画面（PHASE2.md §2「取る＝捨てる」）。
     * ビジュアルの方向が決まるまでの繋ぎなので、採録画面の作法（暗幕・紙色の面・下部の確定ボタン）を
     * そのまま踏襲した最小限にとどめる（凝らない。あとで採録画面ごと作り直す前提）。
     */
    const showDiscardPanel = (picked: UpgradeDef, onDone: () => void) => {
      const owned = UPGRADES.filter((u) => run.upgrades.includes(u.id))
      const padX = Math.max(20, vw * 0.05)

      const panel = new Container()
      const dimG = new Graphics()
      dimG.rect(0, 0, vw, vh).fill({ color: 0x0f0a06, alpha: 1 }) // 背面の採録パネルを透かさない（文字が二重に見える）
      dimG.eventMode = 'static' // 背面（採録パネル）のタップを吸収
      panel.addChild(dimG)
      playRoot.addChild(panel)

      const title = new Text({
        text: `枠がいっぱい（${owned.length}/${run.slots}）— ひとつ手放す`,
        style: { fill: 0xf4e8cf, fontSize: fs(0.034), fontFamily: FONT, fontWeight: 'bold', breakWords: true },
      })
      title.anchor.set(0, 0.5)
      title.position.set(padX, vh * 0.045)
      panel.addChild(title)

      const sub = new Text({ text: `採る：${picked.name}`, style: { fill: 0xd8b855, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' } })
      sub.anchor.set(0, 0.5)
      sub.position.set(padX, vh * 0.09)
      panel.addChild(sub)

      const rowH = vh * 0.075
      const rowGap = vh * 0.012
      const rowW = Math.min(vw - padX * 2, vh * 0.62 - 32)
      const rowX = (vw - rowW) / 2
      const rowTop = vh * 0.135
      const iconSize = Math.max(24, Math.min(34, rowH * 0.66))
      let selected: number | null = null
      const rowBgs: Graphics[] = []

      const btnHost = new Container()
      panel.addChild(btnHost)
      const renderBtn = () => {
        btnHost.removeChildren().forEach((c) => c.destroy({ children: true }))
        const btnW = Math.min(rowW, vw * 0.7)
        const btnH = vh * 0.062
        const enabled = selected !== null
        const btn = new Container()
        const bg = new Graphics()
        if (enabled) bg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill(UI.wood).stroke({ width: 2.5, color: UI.brass })
        else bg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill({ color: 0x33291c, alpha: 0.75 }).stroke({ width: 2, color: 0x6b5f45 })
        btn.addChild(bg)
        const label = new Text({
          text: enabled ? 'この知見を手放す' : '手放す知見を選ぶ',
          style: { fill: enabled ? 0xf4e8cf : 0x8a8270, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' },
        })
        label.anchor.set(0.5)
        btn.addChild(label)
        btn.position.set(vw / 2, vh * 0.93)
        if (enabled) {
          btn.eventMode = 'static'
          btn.cursor = 'pointer'
          btn.hitArea = { contains: (x: number, y: number) => x >= -btnW / 2 && x <= btnW / 2 && y >= -btnH / 2 && y <= btnH / 2 }
          btn.on('pointertap', () => {
            // 手放した知見はその場で効果を失う（次の層の Board はもうこの知見を持たずに組まれる）
            discardUpgrade(run, owned[selected!].id)
            panel.destroy({ children: true }) // 続けてもう1枚手放す場合に古い一覧を残さない
            onDone()
          })
        }
        btnHost.addChild(btn)
      }

      owned.forEach((u, i) => {
        const y = rowTop + i * (rowH + rowGap)
        const row = new Container()
        row.position.set(rowX, y)
        const bg = new Graphics()
        bg.roundRect(0, 0, rowW, rowH, rowH * 0.22).fill({ color: UI.paper, alpha: 0.96 }).stroke({ width: 2, color: UI.brass, alpha: 0.7 })
        row.addChild(bg)
        rowBgs.push(bg)
        const icon = makeUniqueUpgradeIcon(u.id, iconSize)
        icon.position.set(rowH * 0.5, rowH / 2)
        row.addChild(icon)
        const nameT = new Text({ text: u.name, style: { fill: UI.paperInk, fontSize: fs(0.028), fontFamily: FONT, fontWeight: 'bold' } })
        nameT.anchor.set(0, 0.5)
        nameT.position.set(rowH * 0.5 + iconSize * 0.75, rowH * 0.38)
        row.addChild(nameT)
        const catT = new Text({
          text: CATEGORY_LABEL[UPGRADE_CATEGORY[u.id]] ?? '',
          style: { fill: 0x8a6a3f, fontSize: fs(0.02), fontFamily: FONT },
        })
        catT.anchor.set(0, 0.5)
        catT.position.set(rowH * 0.5 + iconSize * 0.75, rowH * 0.72)
        row.addChild(catT)
        row.eventMode = 'static'
        row.cursor = 'pointer'
        row.hitArea = { contains: (x: number, y2: number) => x >= 0 && x <= rowW && y2 >= 0 && y2 <= rowH }
        row.on('pointertap', () => {
          selected = selected === i ? null : i // 再タップで解除（採録カードと同じ作法）
          rowBgs.forEach((g, idx) => {
            g.clear()
              .roundRect(0, 0, rowW, rowH, rowH * 0.22)
              .fill({ color: UI.paper, alpha: idx === selected ? 1 : 0.96 })
              .stroke({ width: idx === selected ? 4 : 2, color: idx === selected ? 0xf2d98a : UI.brass, alpha: idx === selected ? 0.95 : 0.7 })
          })
          renderBtn()
        })
        panel.addChild(row)
      })

      renderBtn()
    }

    // ドラフト3択 v2（codex_consult_ui.md [D]）：タップ即取得をやめ「選択→下部バーで確定」式にし、
    // 所持強化ストリップと読めるシナジー（因果の一文バッジ）を追加する。縦バンド予算は[D]推奨表に固定で従う：
    // 0-9%タイトル+野帳 / 9-20%所持ストリップ / 20-82%候補カード3枚(各18%・間4%) / 82-96%接続要約+確定 / 96-100%safe area
    const showDraftPanel = () => {
      const options = pickDraftOptionsGraph(run.upgrades, draftRng(floor), floor)
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
        text: `深度${floor} 踏破 — 知見をひとつ採る`,
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
      const draftNoteLabel = new Text({ text: '採録帖', style: { fill: 0xf4e8cf, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' } })
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
      const ownedLabel = new Text({ text: `手持ち ${owned.length}/${run.slots}`, style: { fill: 0xcbb98a, fontSize: fs(0.028), fontFamily: FONT, fontWeight: 'bold' } })
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
        const goNext = () => {
          run.upgrades.push(options[i].id)
          const next = floor + 1
          playRoot.removeAllListeners()
          playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
          buildFloorScene(next)
          ensureBgm(themeFloorId(next))
        }
        // 枠が埋まっているなら、採るまえに手放す1つを選ばせる（PHASE2.md §2「取る＝捨てる」）。
        // 呪いで枠が減った直後は所持が枠を超えているので、収まるまで繰り返す（超過を持ち越さない）
        const makeRoom = () => {
          if (run.upgrades.length >= run.slots) showDiscardPanel(options[i], makeRoom)
          else goNext()
        }
        makeRoom()
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
            drawConnectionChip(bottomContainer, padX, summaryTop, vw - padX * 2, `呼応 ${conn.count}　${conn.sentence}`, fs(0.024))
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
          text: enabled ? 'この知見を採る' : 'カードを選んで比較',
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

        // ② 起きること（三段の第二段。PHASE2 §3：「条件／効果」のラベル列＝開発データの露出をやめ、
        // descをカード幅いっぱいの1段落で流す）。用語には点線下線＋「?」でリンクを張る（[C]用語リンクの実装方針）。
        // カード全体タップは選択トグルのみなので、用語タップは layoutRichText 側の stopPropagation で確実に分離する
        const cardUsedTerms = new Set<string>()
        const bodyTop = headerTop + Math.max(cardIconSize, headerBlockH) + cardH * 0.04
        const bodyWrapW = Math.max(20, cardW - cardInsetX * 2)
        let rowY =
          layoutRichText(card, cardMeasurer, tokenizeRich(opt.desc, cardUsedTerms), cardInsetX, bodyTop, bodyWrapW, bodyFont, UI.paperInk, 0x7a5a1e, openGlossaryTerm) +
          cardH * 0.025

        // ③ 呼応バッジ（あれば）：カード内は「呼応 N」のみ。因果の一文は選択後に下部の比較欄で見せる（[D]）
        const conn = connections[i]
        if (conn.count > 0) {
          rowY = drawConnectionChip(card, cardInsetX, rowY, cardW - cardInsetX * 2, `呼応 ${conn.count}`, Math.max(10, fs(0.022))) + cardH * 0.02
        }

        // ④ 採録時のおまけ（starterDescありのみ。三段の第三段）：本文より一段小さく・淡い帯・小さな贈り物アイコンで従属的に表示
        if (opt.starterDesc) {
          const bandH = cardH * 0.16
          // 下端固定だと呼応バッジと重なることがあるため、本文の積み上げ位置(rowY)より必ず下へ置く
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
            text: `採録時のおまけ　${bonusText}`,
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

    // ---------- 結果シーン（層10クリア or run-over。ROGUE.md §7/§8） ----------
    // 夜間監査[C]7/[E]3：旧実装はプレイシーンへパネルを重ねるだけで、背後にHUD・盤面・ビルドドックの残骸が残っていた。
    // 拠点シーン(showMap)と同じ作法でplayRootを一度空にしてから独立に描き直す。
    const showRunResult = (victory: boolean) => {
      inputLocked = true
      victory ? sfx.fanfare() : sfx.lose()
      const reached = run.floor
      saveRogueBest(reached)
      const name = buildRunName(run.upgrades)

      playRoot.removeAllListeners()
      playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))

      const panel = new Container()
      // 背景は層テーマの背景を流用（暗幕は薄く。[C]7）
      const bgSprite = new Sprite()
      bgSprite.anchor.set(0.5)
      bgSprite.position.set(vw / 2, vh / 2)
      const bgTex = spriteTexture(`bg_${theme}`)
      if (bgTex) {
        bgSprite.texture = bgTex
        bgSprite.scale.set(Math.max(vw / bgTex.width, vh / bgTex.height))
      }
      panel.addChild(bgSprite)
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x1a130c, alpha: 0.16 })
      panel.addChild(dim)

      const pw = vw * 0.9
      const panelTex = spriteTexture('ui_panel') ?? spriteTexture('ui_parchment')
      const ph = panelTex ? Math.min(vh * 0.8, (pw / panelTex.width) * panelTex.height) : vh * 0.7
      const px0 = (vw - pw) / 2
      const py0 = Math.max(vh * 0.03, (vh - ph) / 2)
      if (panelTex) {
        const sp = new Sprite(panelTex)
        const s = Math.min(pw / panelTex.width, ph / panelTex.height)
        sp.scale.set(s)
        sp.position.set((vw - panelTex.width * s) / 2, py0)
        panel.addChild(sp)
      }

      // 1) 見出し：勝利=テーマ別バナー、敗北=コード描画の見出し（「ボス撃破○×」は削り見出し自体で勝敗を示す）
      if (victory) {
        const ribbonTex = spriteTexture(`ribbon_${theme}`) ?? spriteTexture('ui_ribbon_clear')
        if (ribbonTex) {
          const rb = new Sprite(ribbonTex)
          rb.anchor.set(0.5)
          rb.scale.set((pw * 0.78) / ribbonTex.width)
          rb.position.set(vw / 2, py0 + ph * 0.1)
          panel.addChild(rb)
        }
      } else {
        const t0 = new Text({
          text: `野帳　深度${reached} まで`,
          style: { fill: UI.paperInk, fontSize: fs(0.05), fontFamily: FONT, fontWeight: 'bold' },
        })
        t0.anchor.set(0.5)
        t0.position.set(vw / 2, py0 + ph * 0.1)
        panel.addChild(t0)
      }

      // 2) ビルド名：白文字は羊皮紙上で読めないため濃い墨色に変更（[C]7）
      const nameT = new Text({
        text: name,
        style: { fill: UI.paperInk, fontSize: fs(0.05), fontFamily: FONT, fontWeight: 'bold', breakWords: true },
      })
      nameT.anchor.set(0.5)
      nameT.position.set(vw / 2, py0 + ph * 0.2)
      panel.addChild(nameT)

      // 3) 主記録：最大同時発火数を昇格
      // 表記は「帰還した探窟家が後続者へ残す実地記録」の文体に統一する（PHASE2.md §3 の register）。
      // 旧「とうたつ深度／さいだい連鎖」は仮名と漢字が混ざり、記録体と衝突していたため漢字へ寄せた。
      const records = [
        // 敗北時は見出しが「野帳　深度N まで」と同じ数字を出しているので、記録行では重ねない
        ...(victory ? [`到達深度　${reached}`] : []),
        `1手の最大発火数　${run.records.maxFiresInOneMove}`,
        `最大連鎖　${run.records.maxChain}`,
        `1手の最大破壊　${run.records.maxDestroyed}`,
      ]
      // 灯の折れ線が下に入ったぶん、記録欄を上へ寄せる（ビルド名の下に空いていた余白をそのまま図に回す）
      const recordsTop = py0 + ph * 0.25
      const recordLineH = fs(0.048)
      records.forEach((line, i) => {
        const t = new Text({
          text: line,
          style: { fill: UI.paperInk, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' },
        })
        t.anchor.set(0.5)
        t.position.set(vw / 2, recordsTop + i * recordLineH)
        panel.addChild(t)
      })
      const recordsBottom = recordsTop + (records.length - 1) * recordLineH + recordLineH * 0.6
      const buttonY = py0 + ph * 0.9

      // 3.4) 灯の推移（折れ線）。旧実装は「36 44 52 …」の数列で、30層になれば紙幅に収まらず読めもしない。
      //      横軸=深度／縦軸=層を出るときの残灯。紙面の余白がないので方眼も軸ラベルも引かず、
      //      y目盛は最大値と0の2つだけを線の左に、深度の範囲は見出しに畳む。
      //      灯が細り始めた深度（thinningFloor）に朱の輪を置き、下の「深度Nから灯が細り始めた」の一行と対で読ませる。
      const chartTop = recordsBottom + fs(0.014)
      let chartBottom = recordsBottom
      if (lightSeries.length >= 2) {
        const first = lightSeries[0].floor
        const last = lightSeries[lightSeries.length - 1].floor
        const tickStyle = { fill: UI.paperInk, fontSize: fs(0.021), fontFamily: FONT, fontWeight: 'bold' as const }
        const cap = new Text({ text: `層を出るときの灯　深度${first}〜${last}`, style: { ...tickStyle, fontSize: fs(0.022) } })
        cap.anchor.set(0.5, 0)
        cap.alpha = 0.82
        cap.position.set(vw / 2, chartTop)
        panel.addChild(cap)

        const plotW = pw * 0.58
        const plotX0 = (vw - plotW) / 2 + fs(0.018) // 左のy目盛ぶんだけ作図域を右へ寄せて、全体を紙面の中央に置く
        const plotTop = chartTop + cap.height + fs(0.008)
        const plotH = fs(0.055)
        const top = Math.max(...lightSeries.map((s) => s.light), 1)
        const px = (i: number) => plotX0 + (plotW * i) / (lightSeries.length - 1)
        const py = (v: number) => plotTop + plotH * (1 - v / top)

        const g = new Graphics()
        g.moveTo(plotX0, plotTop).lineTo(plotX0 + plotW, plotTop).stroke({ width: 1, color: UI.paperInk, alpha: 0.22 })
        g.moveTo(plotX0, plotTop + plotH).lineTo(plotX0 + plotW, plotTop + plotH).stroke({ width: 1, color: UI.paperInk, alpha: 0.4 })
        lightSeries.forEach((s, i) => (i === 0 ? g.moveTo(px(i), py(s.light)) : g.lineTo(px(i), py(s.light))))
        g.stroke({ width: Math.max(2, fs(0.006)), color: 0x2f6f96 }) // 灯＝青い液（PHASE2.md §2.7）
        lightSeries.forEach((s, i) => g.circle(px(i), py(s.light), Math.max(1.8, fs(0.005))).fill(0x2f6f96))
        const thin = thinningFloor(lightSeries)
        const ti = thin === null ? -1 : lightSeries.findIndex((s) => s.floor === thin)
        if (ti >= 0) g.circle(px(ti), py(lightSeries[ti].light), Math.max(4, fs(0.012))).stroke({ width: Math.max(2, fs(0.005)), color: 0x9c3b2c })
        panel.addChild(g)

        for (const [v, y] of [
          [top, plotTop],
          [0, plotTop + plotH],
        ]) {
          const t = new Text({ text: String(v), style: tickStyle })
          t.anchor.set(1, 0.5)
          t.alpha = 0.6
          t.position.set(plotX0 - fs(0.012), y)
          panel.addChild(t)
        }
        chartBottom = plotTop + plotH + fs(0.008)
      }

      // 3.5) 「なぜ細ったか」と「あと一つ」（PHASE2.md §2.5②③）。
      //      見た目は既存の記録行の作法そのまま（墨色・中央揃え・はみ出したら縮める）。因果図には最低限の高さを残し、
      //      入りきらないときは行の高さと字を詰める＝この欄が下の図に重ならないことを構造で保証する。
      const pm = buildPostmortem(lightSeries, drainLog, run.upgrades)
      const pmLines = [...pm.light, ...(pm.missing ? [pm.missing.title, ...pm.missing.lines] : [])]
      const pmTop = chartBottom + fs(0.014)
      let pmBottom = chartBottom
      if (pmLines.length) {
        // fs(0.3) は因果図に必ず残す高さ（見出し＋「最も働いた知見」＋アイコン列。灯の折れ線が入って紙面が詰まったので、
        // 足りないときは主役の1枚を消すのではなく、この欄の行を詰めるほうを選ぶ）
        const pmRoom = buttonY - fs(0.09) - fs(0.3) - pmTop
        const lineH = Math.min(fs(0.036), pmRoom / pmLines.length)
        if (lineH > 0) {
          const size = Math.min(fs(0.026), lineH * 0.74)
          const missingFrom = pm.light.length // ここから下が「あと一つ」欄（見出しだけ少し濃く出す）
          pmLines.forEach((line, i) => {
            const t = new Text({
              text: line,
              style: { fill: UI.paperInk, fontSize: size, fontFamily: FONT, fontWeight: 'bold' },
            })
            t.anchor.set(0.5, 0)
            t.alpha = i === missingFrom ? 1 : 0.82 // 見出し以外は記録より一段落として、主記録と競らせない
            t.position.set(vw / 2, pmTop + i * lineH)
            if (t.width > pw * 0.84) t.scale.set((pw * 0.84) / t.width)
            panel.addChild(t)
          })
          pmBottom = pmTop + pmLines.length * lineH
        }
      }

      // 4) ビルドの因果図：所持強化を固有アイコンで横一列に並べ、consumes/produces が繋がるアイコン同士を線で結ぶ。
      //    閉じた輪（サイクル）に含まれる辺は太く強調する。
      const graphTop = pmBottom + fs(0.02)
      const graphBottom = buttonY - fs(0.09)
      const graphH = Math.max(fs(0.16), graphBottom - graphTop)
      const owned = run.upgrades.map((id) => UPGRADES.find((u) => u.id === id)).filter((u): u is UpgradeDef => !!u)
      if (owned.length > 0) {
        const graphLabel = new Text({
          text: '知見の呼応',
          // 羊皮紙の上で薄すぎたため墨色に（見出しとして読めること優先）
          style: { fill: UI.paperInk, fontSize: fs(0.028), fontFamily: FONT, fontWeight: 'bold' },
        })
        graphLabel.anchor.set(0.5, 0)
        graphLabel.position.set(vw / 2, graphTop)
        panel.addChild(graphLabel)

        const n = owned.length
        // 紙の木枠を突き抜けないよう、まず幅からアイコン半径を解き、「中心」ではなく「外周」で内寸に収める。
        // 紙面の内側は横12%〜88%なので安全域を14%〜86%に取り、その内側に外周ごと入れる
        const avail = pw * 0.72
        const iconR = Math.min(fs(0.058), avail / (n * 2.2))
        const gLeft = px0 + pw * 0.14 + iconR
        const gRight = px0 + pw * 0.86 - iconR
        const rowY = graphBottom - iconR
        const nodeX = (i: number) => (n > 1 ? gLeft + ((gRight - gLeft) / (n - 1)) * i : (gLeft + gRight) / 2)

        // 主役1枚：小メダルを10個並べても「何のビルドだったか」は読めないので、
        // いちばん働いた強化を大きく1枚出し、小メダル列は「他に持っていたもの」の脇役に降ろす。
        // （発火数が1件も無いランでは嘘をつかず「この探索の起点＝最初に選んだ強化」に見出しごと切り替える）
        const heroTop = graphTop + graphLabel.height + fs(0.012)
        let heroBottom = heroTop
        const heroBand = rowY - iconR - fs(0.024) - heroTop
        if (heroBand >= fs(0.11)) {
          let bestId: string | null = null
          let bestFires = 0
          for (const def of owned) {
            const c = upgradeFireCount.get(def.id) ?? 0
            if (c > bestFires) {
              bestFires = c
              bestId = def.id
            }
          }
          const heroDef = owned.find((u) => u.id === bestId) ?? owned[0]
          const capLine = bestFires > 0 ? '最も働いた知見' : 'この探窟の起点'
          const fitText = (t: Text, maxW: number) => {
            if (t.width > maxW) t.scale.set(maxW / t.width)
          }
          const cap = new Text({ text: capLine, style: { fill: UI.paperInk, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' } })
          cap.anchor.set(0.5, 0)
          cap.alpha = 0.75
          cap.position.set(vw / 2, heroTop)
          fitText(cap, pw * 0.7)
          panel.addChild(cap)
          const textBudget = fs(0.03) * 1.35 + (bestFires > 0 ? fs(0.026) * 1.35 : 0) + fs(0.008)
          const heroR = Math.max(fs(0.032), Math.min(fs(0.075), (heroBand - cap.height - textBudget) / 2))
          const heroCy = heroTop + cap.height + fs(0.006) + heroR
          const heroNode = new Container()
          const heroBg = new Graphics()
          heroBg.circle(0, 0, heroR).fill({ color: 0x241a10, alpha: 0.94 }).stroke({ width: Math.max(2, fs(0.005)), color: 0xf2c14e, alpha: 0.95 })
          heroNode.addChild(heroBg)
          heroNode.addChild(makeUniqueUpgradeIcon(heroDef.id, heroR * 1.3))
          heroNode.position.set(vw / 2, heroCy)
          panel.addChild(heroNode)
          const heroName = new Text({
            text: heroDef.name,
            style: { fill: UI.paperInk, fontSize: fs(0.03), fontFamily: FONT, fontWeight: 'bold' },
          })
          heroName.anchor.set(0.5, 0)
          heroName.position.set(vw / 2, heroCy + heroR + fs(0.008))
          fitText(heroName, pw * 0.72) // 強化名は可変長。紙面内に必ず収める
          panel.addChild(heroName)
          heroBottom = heroName.position.y + heroName.height
          if (bestFires > 0) {
            const fireT = new Text({
              text: `発火 ${bestFires}回`,
              style: { fill: UI.paperInk, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' },
            })
            fireT.anchor.set(0.5, 0)
            fireT.alpha = 0.8
            fireT.position.set(vw / 2, heroBottom + fs(0.004))
            fitText(fireT, pw * 0.7)
            panel.addChild(fireT)
            heroBottom = fireT.position.y + fireT.height
          }
        }

        // 辺の抽出：produces(a)とconsumes(b)が1つでも重なればa→b（アイコン同士。自己ループは対象外）
        const edges: { from: number; to: number }[] = []
        const adj: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false))
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i === j) continue
            const produces = owned[i].produces ?? []
            const consumes = owned[j].consumes ?? []
            if (produces.some((r) => consumes.includes(r))) {
              edges.push({ from: i, to: j })
              adj[i][j] = true
            }
          }
        }
        // 到達性の推移閉包：j→…→i が成り立つ辺i→jは閉じた輪の一部（強調対象）
        const reach = adj.map((row) => row.slice())
        for (let k = 0; k < n; k++)
          for (let i = 0; i < n; i++) if (reach[i][k]) for (let j = 0; j < n; j++) if (reach[k][j]) reach[i][j] = true

        const lineLayer = new Container() // 線をアイコンより奥に描く
        panel.addChild(lineLayer)
        for (const e of edges) {
          const inLoop = reach[e.to][e.from]
          const x1 = nodeX(e.from)
          const x2 = nodeX(e.to)
          // 隣接する辺がメダルに埋もれて「何と何が繋がっているか」読めなくなるため、弧の高さに下限を置く。
          // 上限は主役ブロックに触れない範囲まで（弧が名前や発火数の上に乗らない）
          const arcCap = Math.max(iconR * 1.9, Math.min(graphH * 0.42, rowY - heroBottom - fs(0.012)))
          const arc = Math.min(arcCap, Math.max(iconR * 1.8, Math.abs(x2 - x1) * 0.35 + fs(0.02)))
          const midX = (x1 + x2) / 2
          const g = new Graphics()
          g.moveTo(x1, rowY).quadraticCurveTo(midX, rowY - arc, x2, rowY)
          if (inLoop) g.stroke({ width: Math.max(2, fs(0.006)), color: 0xf2c14e, alpha: 0.85 })
          else g.stroke({ width: Math.max(1, fs(0.003)), color: UI.brass, alpha: 0.45 })
          lineLayer.addChild(g)
        }

        owned.forEach((def, i) => {
          const node = new Container()
          const bg = new Graphics()
          bg.circle(0, 0, iconR).fill({ color: 0x241a10, alpha: 0.92 }).stroke({ width: 1.5, color: UI.brass, alpha: 0.9 })
          node.addChild(bg)
          node.addChild(makeUniqueUpgradeIcon(def.id, iconR * 1.3))
          node.position.set(nodeX(i), rowY)
          panel.addChild(node)
        })
      }

      // 5) もういちど
      const btn = makeCoveredButton('もう一度潜る', `next_${theme}`, pw * 0.6)
      btn.position.set(vw / 2, buttonY)
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      btn.on('pointertap', () => {
        // 再挑戦の摩擦を減らす（PHASE2.md §2.5④）：拠点（深度図）を経由させず、ここから直接次のランへ入る。
        // playRoot はこの panel ごと startRun が空にするので、ここで destroy はしない
        startRun()
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
      /** QA専用：結果画面を直接開く（10層まで自動で進める検証は不安定なため） */
      forceRunEnd: (victory: boolean) => showRunResult(victory),
      openEnemyNote: () => {
        const e = board.enemies.find((en) => en.hp > 0)
        if (e) showFieldNote(buildEnemyEntry(e, run.blessings))
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
      // 目標駆動なので「敵を全滅させる」では殲滅以外の層で効かない。目標を直接埋めてクリア判定を叩く
      forceFloorClear: () => {
        if (inputLocked) return
        board.goals.forEach((g, i) => {
          board.goalDone[i] = g.count
        })
        const ev: BoardEvent[] = []
        ;(board as unknown as { checkFloorClear: (ev: BoardEvent[]) => void }).checkFloorClear(ev)
        if (ev.length) handleFloorResult(ev)
      },
      setOxygen: (n: number) => {
        if (runState) {
          runState.oxygen = n
          refreshFloorHud()
        }
      },
      hapticsLog, // 振動は動画に写らないのでQAはこれを読む
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
