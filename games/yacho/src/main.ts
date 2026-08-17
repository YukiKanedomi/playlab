// 『そろえて、しるす。』ローグライク・エントリ。拠点（旧・縦断面図マップ流用）⇄ 層プレイの2シーン構成。
// ROGUE.md 準拠（第3弾b＝ラン進行の実装）。旧30レベル制の画面遷移は廃止。
import { Application, Container, Graphics, Point, Sprite, Text, Texture } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS30 as LEVELS } from './core/levels30'
import { createRunState, discardUpgrade, takeUpgrade, OXYGEN_LOW, OXYGEN_CRITICAL, OXYGEN_SUPPLY_PER_FLOOR, type RunState } from './core/run'
import { isBlessingFloor, pickBlessingOptions, takeBlessing } from './core/blessings'
import { FLOORS, type FloorDef } from './core/floors'
import { UPGRADES, type UpgradeDef } from './core/upgrades'
import { buildPostmortem, thinningFloor, type DrainSample, type FloorLight } from './core/postmortem'
import { buildRunName, UPGRADE_CATEGORY, type UpgradeCategory } from './core/runname'
import { makeRng, type Rng } from './core/rng'
import { pickDraftOptions as pickDraftOptionsGraph } from './core/draft'
import { applyDeepen, applyFusion, deepenOptions, fusionOptions, PHASE28_ENABLED } from './core/fusion'
import { BoardView } from './view/BoardView'
import { PAL, depthBadgeTexture, loadSprites, spriteTexture, themeForLevel, upgradeIconTexture } from './view/pieces'
import { loadSave, type SaveData } from './core/save'
import { BELLFOOT_SHELL_MAX, BOSS_SHELL_COUNT, enemyIntent, ENEMY_PERIOD, OXYGEN_DRAIN, type EnemyInstance } from './core/enemies'
import { systemOf } from './core/hooks'
import type { BoardEvent, Color, EnemyKind, Goal, GoalType, LevelDef, Piece, XY } from './core/types'
import { GLOSSARY, findTerm, type GlossaryEntry } from './core/glossary'
import * as tw from './juice/tween'
import { sfx, startBgm, toggleMute, isMuted } from './juice/sound'
import { hapticsEnabled, hapticsLog, hapticsSupported, toggleHaptics } from './juice/haptics'

// 統一AD正典（codex_ad_overhaul.md §3.2）の10トークン。旧キー（wood/paperInk/badgeText）は
// 参照元を壊さないためのエイリアスとして正典値へ差し替えて残す（brassのみ、旧値は「押下光/補給光/選択瞬間」
// 専用のbrassBrightへ退避＝通常状態には使わない。§3.2の指示どおり）
const UI = {
  abyss: 0x131a18,
  pine: 0x24322b,
  canvas: 0x342c23,
  leather: 0x2a1c14,
  paper: 0xe6d6aa,
  ink: 0x493823,
  brass: 0xb88932,
  brassBright: 0xd9a441,
  amber: 0xe0a83d,
  verdigris: 0x4f7769,
  cinnabar: 0x9b4938,
  // ---- 旧キーのエイリアス ----
  wood: 0x2a1c14, // = leather
  paperInk: 0x493823, // = ink
  badgeText: 0xe6d6aa, // = paper（§3.6：暗地の文字はpaper）
} as const

// 古い図鑑ふうの明朝（index.html で読み込み。未着ならserifへフォールバック）
const FONT = '"Shippori Mincho", serif'

// ---- アイドルヒント（RM/Candy式・控えめ。校正しやすいよう定数化） ----
const HINT_IDLE_MS = 4000 // この時間、無操作かつ盤面が静止したら最初のパルス

/** C案移行Phase6（codex_c_phase46_plan.md §11）：解決経路のフラグ。
 *  'legacy'=現行（board.swap()完全同期→view.play()一括予約）。既定値。
 *  'stepped'=ResolutionCoordinator（エンジンをセグメント単位で停止し、ビュー再生完了と交互に進める）。
 *  層の途中では切り替えない（モードはページ読み込みで固定）。 */
const RESOLUTION_MODE: 'legacy' | 'stepped' = /[?&]resolution=stepped/.test(location.search) ? 'stepped' : 'legacy'

/** 正規化した1手の入力（Coordinatorの単位。§9.2：queued swapは座標だけ保持しPiece参照を持たない） */
type MoveCommand = { kind: 'swap'; a: XY; b: XY } | { kind: 'tap'; at: XY }
const HINT_REPEAT_MS = 3000 // 以降、手が打たれるまでこの間隔で同じ手を再パルス

// ---- ラン記録（拠点の「さいこう とうたつ」表示。ROGUE.md §8） ----
const ROGUE_BEST_KEY = 'yacho-rogue-best'
const loadRogueBest = (): number => {
  const n = Number(localStorage.getItem(ROGUE_BEST_KEY) ?? '0')
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
const saveRogueBest = (floor: number) => {
  if (floor > loadRogueBest()) localStorage.setItem(ROGUE_BEST_KEY, String(floor))
}

/** 深度→テーマ疑似ID（themeForLevel流用）。30層化にあわせて幕ごとに絵を変える：第一幕=森／第二幕=機械／第三幕・終幕=結晶 */
const themeFloorId = (floor: number) => (floor <= 10 ? 1 : floor <= 20 ? 11 : 21)

/** 所持強化バーのアイコン：系統1色に対応する駒テクスチャキー（pieces.ts の n0〜n3。可視化第一波②） */
const CATEGORY_ICON: Record<string, string> = { gear: 'n0', plant: 'n1', mineral: 'n2', relic: 'n3', lamp: 'seiju' } // lamp＝探窟ランタンの駒絵を流用
/** 異種シナジー強化は単一系統に還元できないため、2系統のテクスチャを斜め半分ずつ重ねる簡易表現 */
const SYNERGY_HALVES: Record<string, [string, string]> = {
  'vine-rocket': ['n1', 'n0'],
  'spore-bullet': ['n0', 'n1'],
  'mechanical-garden': ['n0', 'n1'],
  'relic-root': ['n3', 'n1'],
  // 合成の知見（PHASE2.md §2.8）。専用グリフはまだ無いので、合わさった2つの資源の駒で二分割の台紙にする
  'ring-of-spores': ['n1', 'n4'],
  'blasting-vein': ['n2', 'n2'],
  'perpetual-engine': ['n0', 'n0'],
  'clockwork-chain': ['n0', 'n3'],
  'mossy-drift': ['n1', 'n1'],
  'ring-of-resonance': ['n3', 'n3'],
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
const CATEGORY_LABEL: Record<UpgradeCategory, string> = { plant: '植物', mineral: '鉱物', gear: 'ギア', relic: '遺物', synergy: '異種', lamp: '灯' }
/** 標本票の紙型（P1-4・§2.5）：植物・菌類=plant / 鉱物・機械=mineral・gear / 遺物・異種=relic・synergy・lamp */
const TICKET_KEY: Record<UpgradeCategory, string> = {
  plant: 'draft_ticket_plant',
  mineral: 'draft_ticket_instrument',
  gear: 'draft_ticket_instrument',
  relic: 'draft_ticket_relic',
  synergy: 'draft_ticket_relic',
  lamp: 'draft_ticket_relic',
}
/** 標本票3種の本文安全域（紙寸比。codex_draft_fixspec.md §2「安全域」の装飾実測値へ全面差し替え）。
 *  値は1024×512元素材上の装飾実測に基づく割合で、紙は常に2:1固定描画（暫定実装5）なのでy側はcardW/2基準。
 *  各紙型は縁の欠けや装飾が実測で異なるため、紙全体をテキスト領域にせずこの内側だけへ収める：
 *  plant=右上の葉飾り、instrument=左の金具クリップ、relic=左の紐紙片・右の空円と紙片を避ける。
 *  素材なし（フォールバック紙）は装飾が無いぶん広めに取る */
const TICKET_SAFE_ZONE: Record<string, { x0: number; x1: number; y0: number; y1: number }> = {
  draft_ticket_plant: { x0: 0.09, x1: 0.76, y0: 0.15, y1: 0.8 },
  draft_ticket_instrument: { x0: 0.13, x1: 0.93, y0: 0.14, y1: 0.87 },
  draft_ticket_relic: { x0: 0.14, x1: 0.77, y0: 0.14, y1: 0.84 },
}
const TICKET_SAFE_ZONE_FALLBACK = { x0: 0.08, x1: 0.92, y0: 0.12, y1: 0.88 }
/** 本文がcardH>naturalHへ溢れたときだけ紙下端に継ぎ足す短冊の色（正典§3.4「フル外枠は作らない」）。
 *  各紙素材の下寄り本紙域（不透明ピクセル）を実測した平均色。UI.paper（明るいクリーム）そのままだと
 *  紙自体より浮くため、継ぎ目が目立たないようこの色に寄せる */
// （短冊方式は廃止＝紙スプライトの≤18%縦伸びで吸収するため、紙トーン定数は不要になった）
/** 「推」印の最小y（naturalH比）。TICKET_SAFE_ZONEのy0（本文安全域）とは別に持つ：
 *  plantは実測で本紙の上端が装飾実測でおよそ17%からしか始まらず、本文安全域(0.15)のままだと
 *  印の上側が紙の外（透過部）へ半分はみ出す（オーナー実機QA・fx_375x667_1.png）。印だけこの値で押し下げる */
const TICKET_MARK_Y0: Record<string, number> = {
  draft_ticket_plant: 0.19,
}

/** 採録画面の3つの行為（PHASE2.md §2.8）。採る＝入れ替え／合成＝枠が空く／深化＝枠は変わらない */
type DraftMode = 'take' | 'fuse' | 'deepen'
const MODE_LABEL: Record<DraftMode, string> = { take: '採る', fuse: '合成', deepen: '深化' }
const CONFIRM_LABEL: Record<DraftMode, string> = { take: 'この知見を採る', fuse: 'この2つを合成する', deepen: 'この知見を深める' }

/** 採録カード1枚ぶんの表示内容。3つの行為で同じ器を使い、描画コードを1つに保つ */
interface DraftCardView {
  iconId: string
  category: string
  name: string
  desc: string
  /** 見出しの下の小さな1行（合成の元2つ／深化まえの効果） */
  note?: string
  /** 本文の下のバッジ（枠がひとつ空く／枠は変わらない。合成・深化のみ） */
  chip?: string
  /** 呼応する所持知見のid（採るときだけ。文章は作らずアイコン併記のみで見せる） */
  connectedIds?: string[]
  /** 採録時のおまけ（採るときだけ） */
  bonus?: string
}

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

// ---- 呼応表示（オーナー指示：説明文はやめ「今持ってるこれとシナジーがある」をアイコン併記だけで示す。Hadesのデュオブーン式） ----
// 資源の語彙は upgrades.ts の RESOURCES ただ1つを正とする（抽選 core/draft.ts・表示・計測が同じ定義を読む）。
// 以前ここに produces/consumes の「近似表」を別語彙（plantPiece/ore/gearPiece/relicBoost）で持っており、
// upgrades.ts の正式語彙（plant/volatile-ore/gear-trigger/relic-match）と混ざって
// ラベル解決が undefined になる不具合を出した。真実の源を2つ持つのをやめ、近似表は削除した。
// 「Aが胞子を生む→Bが使う」の一文表示は廃止した。理由文なしのタグ／アイコン提示に一本化する（Fated Choice式）。
interface ConnectionInfo {
  count: number
  connected: UpgradeDef[]
}
/**
 * 所持強化群 対 候補1枚の呼応（判定規則は従来と同一＝produces/consumesの資源の橋のみ。同系統・同トリガは数えない）。
 * connectedは呼応した所持知見の定義そのもの（アイコン併記に使う。文章は作らない）。
 */
function computeConnection(owned: UpgradeDef[], candidate: UpgradeDef): ConnectionInfo {
  // 資源はcore/upgrades.tsのconsumes/producesを正とする（抽選・表示・計測が同じ定義を読む。監査[C]5）
  const candProduces = candidate.produces ?? []
  const candConsumes = candidate.consumes ?? []
  const connected: UpgradeDef[] = []
  for (const o of owned) {
    const oProduces = o.produces ?? []
    const oConsumes = o.consumes ?? []
    const produced = oProduces.find((r) => candConsumes.includes(r))
    const consumed = candProduces.find((r) => oConsumes.includes(r))
    // 同トリガ・同系統は「近縁」であって因果の接続ではないため数えない（監査[C]5）
    if (produced || consumed) connected.push(o)
  }
  return { count: connected.length, connected }
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

/** 文字単位で最大幅いっぱいに改行する（CJK主体のため単語境界は見ない）。用語リンクは持たないプレーン改行専用 */
function wrapAllLines(measurer: Text, text: string, maxWidth: number, fontSize: number, bold: boolean): string[] {
  measurer.style.fontSize = fontSize
  measurer.style.fontWeight = bold ? 'bold' : 'normal'
  const lines: string[] = []
  let cur = ''
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(cur)
      cur = ''
      continue
    }
    const cand = cur + ch
    measurer.text = cand
    if (measurer.width > maxWidth && cur.length) {
      lines.push(cur)
      cur = ch
    } else {
      cur = cand
    }
  }
  lines.push(cur)
  return lines
}

/**
 * ドラフトカードの見出し・本文フォールバック用：最大maxLines行までに畳み、溢れたぶんは末尾を省略記号で切り詰める
 * （codex_draft_fixspec.md §2「折返し・行数・カード高の決定順」3・9：本文13px/補助11px未満には縮めず、行数側で吸収する）。
 */
function wrapLines(measurer: Text, text: string, maxWidth: number, maxLines: number, fontSize: number, bold = false): string[] {
  const all = wrapAllLines(measurer, text, maxWidth, fontSize, bold)
  if (all.length <= maxLines) return all
  const kept = all.slice(0, maxLines)
  let last = kept[maxLines - 1]
  measurer.text = last + '…'
  while (last.length > 0 && measurer.width > maxWidth) {
    last = last.slice(0, -1)
    measurer.text = last + '…'
  }
  kept[maxLines - 1] = last + '…'
  return kept
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
/**
 * 呼応する所持知見を「アイコンの併記」だけで見せる（オーナー指示：説明文は不要）。
 * 接頭に「呼応」の1語だけ添え、アイコンを最大3つ横並び、maxWに収まらなければ1個+「+N」へ畳み、
 * それでも収まらなければ「呼応 +N」のテキストのみへ畳む（codex_draft_fixspec.md §2 折返し規則6）。
 * 戻り値はブロック下端のy（後続要素の積み上げ用）。measurerは幅の下見専用（新規Textを都度作らない）
 */
function drawConnectedIcons(host: Container, measurer: Text, x: number, y: number, ids: string[], iconSize: number, maxW: number): number {
  const rowH = Math.max(17, iconSize + 3) // スクロール廃止（オーナー指摘）のため20→17へ詰めた
  const labelFont = Math.max(11, iconSize * 0.72)
  const gap = iconSize * 0.22
  measurer.style.fontSize = labelFont
  measurer.style.fontWeight = 'bold'
  const widthFor = (n: number) => {
    measurer.text = '呼応'
    let w = measurer.width + iconSize * 0.3 + n * iconSize + Math.max(0, n - 1) * gap
    if (ids.length > n) {
      measurer.text = `+${ids.length - n}`
      w += measurer.width + iconSize * 0.15
    }
    return w
  }
  let shown = Math.min(3, ids.length)
  while (shown > 1 && widthFor(shown) > maxW) shown--
  if (shown === 1 && widthFor(1) > maxW) {
    // 1個+ラベルすら収まらない狭さ：テキストのみ「呼応 +N」（正典§2折返し規則6の最終段）
    const only = new Text({ text: `呼応 +${ids.length}`, style: { fill: 0x8a6a3f, fontSize: labelFont, fontFamily: FONT, fontWeight: 'bold' } })
    only.position.set(x, y + (rowH - only.height) / 2)
    host.addChild(only)
    return y + rowH
  }
  const label = new Text({ text: '呼応', style: { fill: 0x8a6a3f, fontSize: labelFont, fontFamily: FONT, fontWeight: 'bold' } })
  label.position.set(x, y + (rowH - label.height) / 2)
  host.addChild(label)
  let cx = x + label.width + iconSize * 0.3
  for (const id of ids.slice(0, shown)) {
    const icon = makeUniqueUpgradeIcon(id, iconSize)
    icon.position.set(cx + iconSize / 2, y + rowH / 2)
    host.addChild(icon)
    cx += iconSize + gap
  }
  const overflow = ids.length - shown
  if (overflow > 0) {
    const moreT = new Text({ text: `+${overflow}`, style: { fill: 0x8a6a3f, fontSize: Math.max(11, iconSize * 0.62), fontFamily: FONT, fontWeight: 'bold' } })
    moreT.position.set(cx + iconSize * 0.08, y + (rowH - moreT.height) / 2)
    host.addChild(moreT)
  }
  return y + rowH
}

/**
 * 採録時のおまけ帯（codex_draft_fixspec.md §2「呼応行・おまけ帯」）：最小28px・1行固定・省略記号。
 * 下地は不透明寄り（alpha 0.55→0.88）にして紙の絵柄の上でもコントラストを確保する（オーナー実機QA指摘）。
 * 戻り値はブロック下端のy
 */
function drawBonusBand(host: Container, measurer: Text, x: number, y: number, w: number, bonus: string, fontSize: number): number {
  const bandH = Math.max(24, fontSize * 1.6) // スクロール廃止（オーナー指摘）のため28/1.8→24/1.6へ詰めた
  const band = new Graphics()
  band.roundRect(x, y, w, bandH, bandH * 0.28).fill({ color: 0xf4ecd8, alpha: 0.88 })
  host.addChild(band)
  const giftSize = bandH * 0.5
  const giftCx = x + bandH * 0.55
  const giftCy = y + bandH / 2
  const gift = new Graphics()
  gift.roundRect(giftCx - giftSize / 2, giftCy - giftSize * 0.32, giftSize, giftSize * 0.64, giftSize * 0.08).fill(UI.brass)
  gift.rect(giftCx - giftSize * 0.09, giftCy - giftSize * 0.32, giftSize * 0.18, giftSize * 0.64).fill(0x8a5a2a)
  gift.rect(giftCx - giftSize / 2, giftCy - giftSize * 0.08, giftSize, giftSize * 0.16).fill(0x8a5a2a)
  host.addChild(gift)
  const bonusText = bonus.replace(/^おまけ[:：]\s*/, '')
  const textX = giftCx + giftSize * 0.85
  const maxTextW = Math.max(20, x + w - textX - 6)
  measurer.style.fontSize = fontSize
  measurer.style.fontWeight = 'normal'
  let shown = `採録時のおまけ　${bonusText}`
  measurer.text = shown
  if (measurer.width > maxTextW) {
    while (shown.length > 0) {
      shown = shown.slice(0, -1)
      measurer.text = shown + '…'
      if (measurer.width <= maxTextW) {
        shown += '…'
        break
      }
    }
  }
  const bonusT = new Text({ text: shown, style: { fill: 0x6b5238, fontSize, fontFamily: FONT, fontWeight: 'bold' } })
  bonusT.anchor.set(0, 0.5)
  bonusT.position.set(textX, giftCy)
  host.addChild(bonusT)
  return y + bandH
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
  } else if (kind === 'binder') {
    // 綴じ蟲：盤面と同じ「縦長の胴＋横に渡る綴じ糸」
    const g = new Graphics()
    g.roundRect(-size * 0.28, -size * 0.42, size * 0.56, size * 0.84, size * 0.14).fill(0x1d2a2e).stroke({ width: 2, color: 0x6d8f96 })
    for (const ty of [-0.16, 0, 0.16]) g.moveTo(-size * 0.24, size * ty).lineTo(size * 0.24, size * ty).stroke({ width: 1.6, color: 0x9ec8cf })
    c.addChild(g)
  } else if (kind === 'bellfoot') {
    // 鐘脚：釣鐘の胴＋殻のリング
    const g = new Graphics()
    g.moveTo(0, -size * 0.36).lineTo(size * 0.34, size * 0.26).lineTo(-size * 0.34, size * 0.26).closePath().fill(0x3a2f1c).stroke({ width: 2, color: 0xb99a52 })
    g.circle(0, 0, size * 0.4).stroke({ width: 1.6, color: 0xe0c070, alpha: 0.7 })
    c.addChild(g)
  } else if (kind === 'maw') {
    // 奈落の喉：牙の並ぶ裂け目
    const g = new Graphics()
    g.roundRect(-size * 0.44, -size * 0.3, size * 0.88, size * 0.6, size * 0.1).fill(0x08090c).stroke({ width: 2, color: 0x5a4a6b })
    for (const tx of [-0.34, -0.1, 0.14]) g.moveTo(size * tx, -size * 0.24).lineTo(size * (tx + 0.1), size * 0.02).lineTo(size * (tx + 0.2), -size * 0.24).fill(0xcfc2dd)
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
  binder: {
    name: '綴じ蟲',
    oxygenDesc: null,
    disruptDesc: `1列を予告し、${ENEMY_PERIOD.binder}手後にその列を丸ごと3手ふさぐ（その列は落ちてこない）`,
    defeatDesc: '予告された列の中で駒を1つでも消せば綴じは止まる',
  },
  bellfoot: {
    name: '鐘脚',
    oxygenDesc: null,
    disruptDesc: `${ENEMY_PERIOD.bellfoot}手ごとに殻を1枚張り直す（最大${BELLFOOT_SHELL_MAX}枚）`,
    defeatDesc: '殻がある間は本体に一切通らず、1手で剥がせる殻は1枚だけ。小突き続けても張り直しに追いつかれる',
  },
  boss: {
    name: '深匣主',
    oxygenDesc: `${ENEMY_PERIOD.boss}手ごとに灯を${OXYGEN_DRAIN.boss}奪う`,
    disruptDesc: null,
    defeatDesc: 'まず封印匣を4枚剥がす（どんな一撃でも1枚）。核が露出したら本体のHPを削る',
  },
  maw: {
    name: '奈落の喉',
    oxygenDesc: null,
    disruptDesc: `${ENEMY_PERIOD.maw}手ごとに盤が変わる（割れる → 狭まる → 開く）。灯は1も奪わない`,
    defeatDesc: '狭まった盤でも一手を作れるかだけが問われる。塞がったマスは3手で必ず開く',
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
  // 深化ずみ（PHASE2 §2.8）は、いま効いている条件が本文と違うので必ず1行で示す
  if (def.deepen && run.deepened.includes(def.id)) blocks.push({ kind: 'row', label: '深化ずみ', text: def.deepen.desc })
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

  /**
   * 主要CTA共通ボタン（§3.5・P1-5）：革張り木板の button_primary 3状態（通常/押下/無効）を使う。
   * 素材が無ければ濃茶革の角丸＋左右真鍮タブへフォールバック。押下時は2px沈み、無効時は素材ごと減光する。
   * 旧 makeCoveredButton の「焼き込み文字を黒い矩形で覆う」処理は廃止した（P1-5コード変更欄）。
   */
  const makePrimaryButton = (label: string, width: number, opts?: { disabled?: boolean }): Container => {
    const disabled = opts?.disabled ?? false
    const h = Math.round(Math.min(60, Math.max(52, vw * 0.148))) // 実機56〜60px相当（§3.5）
    const c = new Container()
    const texN = spriteTexture('button_primary')
    const texP = spriteTexture('button_primary_pressed')
    const texD = spriteTexture('button_primary_disabled')
    let spN: Sprite | null = null
    let spP: Sprite | null = null
    if (texN) {
      spN = new Sprite(disabled ? texD ?? texN : texN)
      spN.anchor.set(0.5)
      spN.width = width
      spN.height = h
      c.addChild(spN)
      if (!disabled && texP) {
        spP = new Sprite(texP)
        spP.anchor.set(0.5)
        spP.width = width
        spP.height = h
        spP.visible = false
        c.addChild(spP)
      }
      if (disabled) c.alpha = 0.72
    } else {
      const g = new Graphics()
      g.roundRect(-width / 2, -h / 2, width, h, h * 0.22).fill(disabled ? 0x241a12 : UI.leather)
      // 真鍮は外周ではなく左右の留め具として置く（§3.5）
      const tabW = Math.max(5, h * 0.12)
      const tabColor = disabled ? 0x5a4a30 : UI.brass
      g.roundRect(-width / 2 + h * 0.18, -h * 0.32, tabW, h * 0.64, tabW * 0.4).fill(tabColor)
      g.roundRect(width / 2 - h * 0.18 - tabW, -h * 0.32, tabW, h * 0.64, tabW * 0.4).fill(tabColor)
      c.addChild(g)
    }
    const fontSize = Math.max(15, Math.min(18, vw * 0.0462)) // §3.5：文字18px相当
    const t = new Text({
      text: label,
      style: { fill: disabled ? 0x9a8968 : UI.paper, fontSize, fontFamily: FONT, fontWeight: '800', letterSpacing: fontSize * 0.08 },
    })
    t.anchor.set(0.5)
    c.addChild(t)
    if (!disabled) {
      c.eventMode = 'static'
      c.cursor = 'pointer'
      const setPressed = (on: boolean) => {
        t.position.y = on ? 2 : 0
        if (spN) spN.position.y = on ? 2 : 0
        if (spP) {
          spP.position.y = on ? 2 : 0
          spP.visible = on
        }
        if (spN && spP) spN.visible = !on
      }
      c.on('pointerdown', () => setPressed(true))
      c.on('pointerup', () => setPressed(false))
      c.on('pointerupoutside', () => setPressed(false))
      c.on('pointercancel', () => setPressed(false))
    }
    // Container自体には形が無いため hitArea が無いと static でも当たり判定を持てない（子のeventModeにも依存しない）
    c.hitArea = { contains: (x: number, y: number) => x >= -width / 2 && x <= width / 2 && y >= -h / 2 && y <= h / 2 }
    return c
  }
  // 小ボタン（採録帖タブ等）のラベルサイズ（§3.5：小ボタンのラベルは12〜14px）。
  // 盤面ドックとドラフト側の2箇所で同じ値を使う（P2-3「同じボタン素材、同じラベルサイズ」）
  const SMALL_BTN_LABEL = Math.max(12, Math.min(14, fs(0.032)))

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
    const topPad = vh * 0.19
    const botPad = vh * 0.12
    const nodeXY = (i: number) => ({
      x: vw / 2 + Math.sin(i * 1.22) * vw * 0.24,
      y: topPad + ((i - 1) / (LEVELS.length - 1)) * (MAP_H - topPad - botPad),
    })
    // 測量線（ノードの背面。2次ベジェを不均一な破線でなぞる。P1-5：均一UI線から「測量線」へ）
    const pathHash = (n: number) => {
      const s = Math.sin(n * 12.9898) * 43758.5453
      return s - Math.floor(s)
    }
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
      // 深度ごとに決定的な長短差を付ける（一定ダッシュを禁止。§2.1修正方針）
      const dash = vw * (0.012 + pathHash(i) * 0.016)
      const gap = vw * (0.008 + pathHash(i + 97) * 0.014)
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
      // §3.5 P1-5：幅約1.2px・色はpaper55%へ（旧：太いUI白線）
      pathG.stroke({ width: 1.2, color: UI.paper, alpha: 0.55 })
    }
    content.addChild(pathG)
    /** ノードの状態＝踏破済み／現在地／次地点／未到達（拠点を「ステージ選択」でなく「測量記録」にする。§2.1） */
    const pinState = (i: number): 'done' | 'current' | 'next' | 'locked' => {
      if (i <= save.unlocked) return 'done'
      if (i === save.unlocked + 1) return 'current'
      if (i === save.unlocked + 2) return 'next'
      return 'locked'
    }
    const pinTexKey: Record<ReturnType<typeof pinState>, string> = {
      done: 'map_pin_done',
      current: 'map_pin_current',
      next: 'map_pin_next',
      locked: 'map_pin_locked',
    }
    for (let i = 1; i <= LEVELS.length; i++) {
      const { x: nx, y: ny } = nodeXY(i)
      const node = new Container()
      const state = pinState(i)
      const current = state === 'current'
      const r = vw * 0.045 // P1-5：vw*0.065→vw*0.045前後（測量印。番号を主役にする）
      const tex = spriteTexture(pinTexKey[state])
      if (tex) {
        const sp = new Sprite(tex)
        sp.anchor.set(0.5)
        sp.scale.set((r * 2) / Math.max(tex.width, tex.height))
        node.addChild(sp)
      } else {
        // フォールバック：踏破=赤茶の押印、現在地=真鍮+琥珀、次地点=真鍮の輪郭、未到達=鉛筆色の輪郭
        const g = new Graphics()
        if (state === 'done') g.circle(0, 0, r).fill({ color: UI.cinnabar, alpha: 0.88 }).stroke({ width: 2, color: UI.cinnabar })
        else if (state === 'current') g.circle(0, 0, r).fill(UI.brassBright).stroke({ width: 2, color: UI.brass })
        else if (state === 'next') g.circle(0, 0, r).stroke({ width: 2, color: UI.brass })
        else g.circle(0, 0, r).stroke({ width: 1.5, color: 0x8a8270, alpha: 0.5 })
        node.addChild(g)
      }
      const num = new Text({
        text: String(i),
        // 薄い墨縁取り（2px・低不透明度）：番号が背景の森に溶けて宙に浮いて見える対策（P1-4検品）
        style: { fill: UI.paper, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x1c140c, width: 2, alpha: 0.55 } },
      })
      num.anchor.set(0.5)
      node.addChild(num)
      if (state === 'locked') node.alpha = 0.62
      if (current) {
        // 現在地の脈動輪は1本へ限定（旧：番号メダル+肖像ピン+脈動輪が重なっていた）。alphaも0.45→0.32
        const ring = new Graphics()
        ring.circle(0, 0, r * 1.3).stroke({ width: 2, color: UI.brass, alpha: 0.32 })
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
    // 最深記録：右上の独立プラークではなく、上部の小さな野帳見出しへ統合（P1-5「§2.1修正方針」）
    const header = new Container()
    const bestT = new Text({
      text: `野帳　最深記録 深度${loadRogueBest()}`,
      style: { fill: UI.paper, fontSize: fs(0.022), fontFamily: FONT, fontWeight: '600', letterSpacing: fs(0.022) * 0.04 },
    })
    bestT.anchor.set(1, 0)
    bestT.position.set(vw * 0.96, vh * 0.026)
    header.addChild(bestT)
    const bestRule = new Graphics()
    bestRule.moveTo(vw * 0.96 - bestT.width, bestT.y + bestT.height + 3).lineTo(vw * 0.96, bestT.y + bestT.height + 3)
    bestRule.stroke({ width: 1, color: UI.brass, alpha: 0.6 })
    header.addChild(bestRule)
    mapRoot.addChild(header)
    // ビルド刻印（2026-08-15）：不具合報告時に「どのビルドを踏んでいるか」を推測でなく確認するため。
    // 値は vite.config.ts の define（ビルド時刻 MM-DD hh:mm）。世界内情報に見えるため ?debug 時のみ表示する（P1-5）
    if (new URLSearchParams(location.search).has('debug')) {
      const buildT = new Text({
        text: `build ${__BUILD_ID__}`,
        style: { fill: 0xd8c9a3, fontSize: fs(0.024), fontFamily: FONT, fontWeight: 'bold' },
      })
      buildT.anchor.set(0, 0.5)
      const buildBg = new Graphics()
      const bw = buildT.width + fs(0.03)
      const bh = buildT.height + fs(0.016)
      buildBg.roundRect(vw * 0.02, vh * 0.985 - bh, bw, bh, bh * 0.3).fill({ color: 0x1d1710, alpha: 0.78 })
      buildT.position.set(vw * 0.02 + fs(0.015), vh * 0.985 - bh / 2)
      mapRoot.addChild(buildBg, buildT)
    }

    // 「探窟へ」CTA：画面中央からノード/経路を隠す位置ではなく、下部の固定ドックへ（P1-5）
    const startBtn = makePrimaryButton('探窟へ', vw * 0.76)
    startBtn.position.set(vw / 2, vh - vh * 0.03 - 48)
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
    // P2-3：開くときの逆再生＝12px下降＋フェードで閉じる（全面スライドで消さない）
    tw.tween(fn.panel.position, { y: fn.baseY + 12 }, 160, {
      ease: tw.easeInCubic,
      onDone: () => {
        if (!fn.root.destroyed) fn.root.destroy({ children: true })
      },
    })
    tw.tween(fn.root, { alpha: 0 }, 160)
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
    // P2-3：革の地に置いた白文字ではなく古紙(paper)の地に墨(ink)文字。用語リンクは brass（§3.2）
    let y = 0
    for (const b of blocks) {
      if (b.kind === 'text') {
        y = layoutRichText(host, measurer, tokenizeRich(b.text, usedTerms), padX, y, width - padX * 2, bodyFont, UI.ink, UI.brass, onTermTap)
        y += rowGap
      } else if (b.kind === 'row') {
        const label = new Text({ text: b.label, style: { fill: UI.ink, fontSize: labelFont, fontFamily: FONT, fontWeight: 'bold' } })
        label.alpha = 0.72
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
          UI.ink,
          UI.brass,
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
          const title = new Text({ text: item.title, style: { fill: UI.ink, fontSize: bodyFont * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
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
            UI.ink,
            UI.brass,
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
    scrim.rect(0, 0, vw, vh).fill({ color: UI.abyss, alpha: 1 })
    scrim.alpha = 0
    scrim.eventMode = 'static'
    scrim.on('pointertap', () => closeFieldNote())
    root.addChild(scrim)
    tw.tween(scrim, { alpha: 0.58 }, 160) // P2-3：革表紙ボトムシート共通仕様（§2.6/§4.3）＝暗幕0.58

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

    // 背景：P2-3（§2.6/§4.3）共通「革表紙＋古紙」。上端8〜12pxだけ革の見返しを見せ、残りは古紙の紙面にする
    const corner = fs(0.032)
    const leatherTopH = Math.max(10, Math.min(14, fs(0.028)))
    const bg = new Graphics()
    bg.roundRect(0, 0, panelW, sheetH, corner).fill({ color: UI.leather, alpha: 0.98 })
    const paperBg = new Graphics()
    paperBg.roundRect(0, leatherTopH, panelW, sheetH - leatherTopH, corner * 0.6).fill({ color: UI.paper, alpha: 0.98 })
    paperBg.roundRect(1, leatherTopH + 1, panelW - 2, sheetH - leatherTopH - 2, corner * 0.6).stroke({ width: 1.5, color: UI.ink, alpha: 0.3 }) // §3.4：紙の外周線は1本だけ
    panel.addChild(bg, paperBg)
    const studR = fs(0.007)
    for (const sx of [corner * 0.7, panelW - corner * 0.7]) {
      const stud = new Graphics()
      stud.circle(sx, leatherTopH * 0.55, studR).fill({ color: UI.brass, alpha: 0.85 })
      panel.addChild(stud)
    }
    // つまみ（掴んで下スワイプできることを示す短いバー。革の見返しの上に置く）
    const grabber = new Graphics()
    grabber.roundRect(panelW / 2 - fs(0.06), leatherTopH * 0.42, fs(0.12), fs(0.006), fs(0.003)).fill({ color: UI.brass, alpha: 0.7 })
    panel.addChild(grabber)

    // ヘッダー：アイコン＋名前＋種別ラベル、右上×
    const icon = entry.icon(headerIconSize)
    icon.position.set(padX + headerIconSize / 2, padTop + headerIconSize / 2)
    panel.addChild(icon)
    const titleT = new Text({
      text: entry.title,
      style: { fill: UI.ink, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold', breakWords: true },
    })
    titleT.position.set(padX + headerIconSize + fs(0.025), padTop + headerIconSize * 0.1)
    panel.addChild(titleT)
    const kindT = new Text({ text: entry.kindLabel, style: { fill: UI.ink, fontSize: fs(0.024), fontFamily: FONT, fontWeight: 'bold' } })
    kindT.alpha = 0.72
    kindT.position.set(padX + headerIconSize + fs(0.025), padTop + headerIconSize * 0.1 + titleT.height + fs(0.004))
    panel.addChild(kindT)
    // 閉じるタブ：革の見返しに重ねて置く固定の「真鍮タブ」（P2-3）。ヒット領域44×44px以上を確保（§3.5/§6）
    const closeR = Math.max(15, fs(0.026))
    const closeBtn = new Container()
    closeBtn.position.set(panelW - padX - closeR, leatherTopH)
    const closeBg = new Graphics()
    closeBg.circle(0, 0, closeR).fill({ color: UI.leather, alpha: 0.95 }).stroke({ width: 1.5, color: UI.brass })
    closeBtn.addChild(closeBg)
    const closeX = new Text({ text: '×', style: { fill: UI.paper, fontSize: closeR * 1.1, fontFamily: FONT, fontWeight: 'bold' } })
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
    // P2-3：全面スライドではなく12px上昇＋フェードで開く（showFloorRecordBandと同じ作法）
    panel.position.set(0, baseY + 12)
    panel.alpha = 0
    tw.tween(panel.position, { y: baseY }, 200, { ease: tw.easeOutCubic })
    tw.tween(panel, { alpha: 1 }, 200)

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
   * 祝福をひとつ受ける画面（PHASE2.md §3）。深度10/20/30の幕主を仕留めた後に開く
   * （開始時の祝福は廃止＝PHASE2.md「祝福の回数と時機」。ランは潜るだけで始まる）。
   * **利点（祝福）と代償（呪い）を同じ大きさで並べる**のがこの画面の要件で、隠しデメリットは作らない。
   * ビジュアルの方向が決まるまでの繋ぎなので、採録画面の作法（暗幕・紙色の面・下部の確定ボタン）を
   * そのまま踏襲した最小限にとどめる（凝らない。あとで採録画面ごと作り直す前提）。
   */
  const showBlessingPanel = (onDone: () => void) => {
    const run = runState!
    // 同じランの同じ回で必ず同じ3枚が出る（採録と同じ作法。runSeed は startRun で確定済み）
    const options = pickBlessingOptions(run.blessings, makeRng((runSeed + run.blessings.length * 65537 + 3) | 0), 3)
    const padX = Math.max(20, vw * 0.05)

    const panel = new Container()
    // P2-1（§2.7/§4.3）：完全黒(alpha1)を廃止。直前のプレイ背景（playRootに残ったまま）を abyss 0.62 で沈めるだけにする
    const dimG = new Graphics()
    dimG.rect(0, 0, vw, vh).fill({ color: UI.abyss, alpha: 0.62 })
    dimG.eventMode = 'static'
    panel.addChild(dimG)
    playRoot.addChild(panel)

    const title = new Text({
      text: '祝福をひとつ受ける',
      style: { fill: UI.paper, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold' },
    })
    title.anchor.set(0, 0.5)
    // ランHUD（深度バッジ／油槽／メニュー、hudTop〜hudBottom＝vh*0.03〜0.12）と重なっていたため、その下へ移す
    title.position.set(padX, vh * 0.15)
    panel.addChild(title)

    const sub = new Text({
      text: `${run.blessings.length + 1}つめ　利点と代償は対になっている`,
      style: { fill: 0xcbb98a, fontSize: fs(0.024), fontFamily: FONT },
    })
    sub.anchor.set(0, 0.5)
    sub.position.set(padX, vh * 0.183)
    panel.addChild(sub)

    // P2-1：3枚の独立クリームカードを廃止し、blessing_folio 1枚の見開き上へ3本の契約欄を描く
    const folioTex = spriteTexture('blessing_folio')
    const areaTop = vh * 0.205
    const areaBottom = vh * 0.87
    const S = Math.min(vw * 0.94, areaBottom - areaTop) // 見開きは正方形素材。縦が足りなければ縦基準に落ちる
    const px0 = (vw - S) / 2
    const py0 = areaTop + Math.max(0, (areaBottom - areaTop - S) / 2)
    if (folioTex) {
      const sp = new Sprite(folioTex)
      sp.position.set(px0, py0)
      sp.width = S
      sp.height = S
      panel.addChild(sp)
    } else {
      const g = new Graphics()
      g.roundRect(px0, py0, S, S, S * 0.02).fill({ color: UI.paper, alpha: 0.96 }).stroke({ width: 3, color: UI.leather })
      panel.addChild(g)
    }

    // 3行の帯（折り紐・留め具を避けた見開き内の安全域）
    const rowTopPad = S * 0.055
    const rowBottomPad = S * 0.06
    const rowGapV = S * 0.02
    const rowH = (S - rowTopPad - rowBottomPad - rowGapV * 2) / 3
    const rowTop = (i: number) => py0 + rowTopPad + i * (rowH + rowGapV)
    const sealR = Math.max(fs(0.024), rowH * 0.17)
    // blessing_folio.png（1024×1024）の焼き込み円を実測した中心比率。rowTop/rowHの均等割りとは微妙にズレるため、
    // 印はここから直接置く（そうしないと素材の円とコード描画の円が二重に見える）
    const sealCenterYFrac = [0.181, 0.474, 0.767]
    const sealXFracBoon = 0.142
    const sealXFracCurse = 0.855
    const textX0 = px0 + S * 0.21
    const textX1 = px0 + S * 0.79
    const textW = textX1 - textX0

    let selected: number | null = null
    const rowLifts: Container[] = []
    const clasps: Graphics[] = []

    const btnHost = new Container()
    panel.addChild(btnHost)
    const renderBtn = () => {
      btnHost.removeChildren().forEach((c) => c.destroy({ children: true }))
      const enabled = selected !== null
      // P2-1：確定ボタンは共通主要ボタン（makePrimaryButton）を使い、選択欄の直下へ寄せる
      const btn = makePrimaryButton(enabled ? 'この祝福を受ける' : '祝福を選ぶ', Math.min(S * 0.76, vw * 0.72), { disabled: !enabled })
      const belowY = enabled ? rowTop(selected!) + rowH + fs(0.032) : py0 + S + fs(0.032)
      btn.position.set(vw / 2, Math.min(belowY, vh * 0.94))
      if (enabled) {
        btn.on('pointertap', () => {
          takeBlessing(run, options[selected!].id)
          panel.destroy({ children: true })
          onDone()
        })
      }
      btnHost.addChild(btn)
    }

    options.forEach((b, i) => {
      const lift = new Container()
      lift.position.set(0, rowTop(i))
      panel.addChild(lift)
      rowLifts.push(lift)

      // 左に緑青の「祝」印、右に朱の「呪」印。同じ大きさ（P2-1：文字色だけの区別をやめる）。
      // 生成素材（seal_shuku/seal_ju）を焼き込み円の中心へ。無ければ従来のコード描画へフォールバック
      // 印の座標は素材の焼き込み円の実測中心（sealCenterYFrac等）を使う。lift はrowTop(i)へ位置しているので、
      // ここではその分を差し引いたローカルyへ変換する
      const boonX = px0 + S * sealXFracBoon
      const curseX = px0 + S * sealXFracCurse
      const sealY = py0 + S * sealCenterYFrac[i] - rowTop(i)
      const shukuSealTex = spriteTexture('seal_shuku')
      if (shukuSealTex) {
        const sp = new Sprite(shukuSealTex)
        sp.anchor.set(0.5)
        sp.position.set(boonX, sealY)
        sp.scale.set((sealR * 2.1) / Math.max(shukuSealTex.width, shukuSealTex.height))
        lift.addChild(sp)
      } else {
        const boonSeal = new Graphics()
        boonSeal.circle(boonX, sealY, sealR).fill({ color: UI.verdigris, alpha: 0.92 }).stroke({ width: 2, color: 0xcfe0d6, alpha: 0.5 })
        lift.addChild(boonSeal)
        const boonSealT = new Text({ text: '祝', style: { fill: 0xeaf3ee, fontSize: sealR * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
        boonSealT.anchor.set(0.5)
        boonSealT.position.set(boonX, sealY)
        lift.addChild(boonSealT)
      }

      const juSealTex = spriteTexture('seal_ju')
      if (juSealTex) {
        const sp = new Sprite(juSealTex)
        sp.anchor.set(0.5)
        sp.position.set(curseX, sealY)
        sp.scale.set((sealR * 2.1) / Math.max(juSealTex.width, juSealTex.height))
        lift.addChild(sp)
      } else {
        const curseSeal = new Graphics()
        curseSeal.circle(curseX, sealY, sealR).fill({ color: UI.cinnabar, alpha: 0.92 }).stroke({ width: 2, color: 0xe6c9c2, alpha: 0.5 })
        lift.addChild(curseSeal)
        const curseSealT = new Text({ text: '呪', style: { fill: 0xf5e6e0, fontSize: sealR * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
        curseSealT.anchor.set(0.5)
        curseSealT.position.set(curseX, sealY)
        lift.addChild(curseSealT)
      }

      // 本文は左揃え（§3.6）。利点と代償は同サイズ・同重量を維持する（色を分けて意味の差を作らない）
      const nameT = new Text({ text: b.name, style: { fill: UI.ink, fontSize: Math.max(15, fs(0.03)), fontFamily: FONT, fontWeight: 'bold' } })
      nameT.position.set(textX0, rowH * 0.06)
      if (nameT.width > textW) nameT.scale.set(textW / nameT.width)
      lift.addChild(nameT)

      const lineSize = Math.max(13, fs(0.024))
      const mkLine = (text: string, y: number) => {
        const t = new Text({ text, style: { fill: UI.ink, fontSize: lineSize, fontFamily: FONT, fontWeight: 'bold' } })
        t.position.set(textX0, y)
        if (t.width > textW) t.scale.set(textW / t.width)
        lift.addChild(t)
      }
      mkLine(`祝　${b.boon}`, rowH * 0.42)
      mkLine(`呪　${b.curse}`, rowH * 0.68)

      // 選択時：真鍮の留め具（本文の下・折り紐の位置＝欄の下端）＋紙の持ち上がり（y-4）。金枠4pxは廃止（P2-1）
      const clasp = new Graphics()
      clasp
        .roundRect(px0 + S / 2 - fs(0.022), rowH - fs(0.013), fs(0.044), fs(0.026), fs(0.007))
        .fill({ color: UI.brassBright, alpha: 0.95 })
        .stroke({ width: 1.5, color: 0x5a4018 })
      clasp.visible = false
      lift.addChild(clasp)
      clasps.push(clasp)

      lift.eventMode = 'static'
      lift.cursor = 'pointer'
      lift.hitArea = { contains: (x: number, y: number) => x >= px0 && x <= px0 + S && y >= 0 && y <= rowH }
      lift.on('pointertap', () => {
        selected = selected === i ? null : i // 再タップで解除（採録カードと同じ作法）
        rowLifts.forEach((l, idx) => (l.position.y = idx === selected ? rowTop(idx) - 4 : rowTop(idx)))
        clasps.forEach((c, idx) => (c.visible = idx === selected))
        renderBtn()
      })
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
    // ランは潜るだけで始まる。祝福は深度10/20/30の幕主後（PHASE2.md「祝福の回数と時機」）
    buildFloorScene(1)
    ensureBgm(themeFloorId(1))
  }

  const buildFloorScene = (floor: number) => {
    const run = runState!
    run.floor = floor
    // 祝福の盤面効果（爆発鉱石・銛・光胞子・原生種の傷）は Board 構築時に applyBlessingFloorStart が織り込む
    const floorDef = FLOORS[floor - 1]
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
      // 目標票の紙質統一（正典§4.4 P3-1繰り上げ）：角丸4〜6px・背景UI.paper・線はink25%のみ（常時の真鍮外枠は削除）
      const sheetCorner = Math.min(6, Math.max(4, goalBarH * 0.12))
      // 生成素材goal_plate（1280x320=4:1固定）。歪ませないため紙は1課目ぶん(entryW)ごとに独立して敷く
      // （旧：sheetW全体を1枚のGraphicsで縦横別倍率に伸縮しており歪みの原因だった）。
      // 4:1は幅基準で決まる高さがgoalBarHと一致しないため、goalBarHの中心に縦合わせする
      const plateTex = spriteTexture('goal_plate')
      const plateH = plateTex ? entryW * (plateTex.height / plateTex.width) : goalBarH
      board.goals.forEach((g, i) => {
        const root = new Container()
        if (plateTex) {
          const sp = new Sprite(plateTex)
          sp.width = entryW
          sp.height = plateH
          sp.position.set(0, (goalBarH - plateH) / 2)
          root.addChild(sp)
        } else {
          const bg = new Graphics()
          bg.roundRect(0, 0, entryW, goalBarH, sheetCorner).fill({ color: UI.paper, alpha: 0.95 }).stroke({ width: 1, color: UI.ink, alpha: 0.25 })
          root.addChild(bg)
        }
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
        label.alpha = 0.72 // ラベルは残数より一段降ろす（読み順＝アイコン→残数。P1-4：0.82→0.72）
        label.position.set(labelX, goalBarH / 2)
        // ラベルは「数字の左端まで」に必ず収める（溢れたら縮める。改行させないのは1行バーだから）
        const labelMaxW = Math.max(goalBarH * 0.6, numRight - numMaxW - goalBarH * 0.16 - labelX)
        if (label.width > labelMaxW) label.scale.set(labelMaxW / label.width)
        root.addChild(label)
        // 完了印：数字を0にせず朱の採録印へ変える（[F]§2／P1-4：金→朱に統一）。押印は300msだけ跳ねる
        // 生成素材seal_saiを使う。無ければ従来のコード描画スタンプへフォールバック
        const sealR = goalBarH * 0.3
        const seal = new Container()
        const saiSealTex = spriteTexture('seal_sai')
        if (saiSealTex) {
          const sp = new Sprite(saiSealTex)
          sp.anchor.set(0.5)
          sp.scale.set((sealR * 2.1) / Math.max(saiSealTex.width, saiSealTex.height))
          seal.addChild(sp)
        } else {
          const sealG = new Graphics()
          sealG.circle(0, 0, sealR).fill({ color: 0xf4ecd8, alpha: 0.9 }).stroke({ width: Math.max(1.5, sealR * 0.14), color: UI.cinnabar, alpha: 0.9 })
          const sealT = new Text({ text: '採', style: { fill: UI.cinnabar, fontSize: sealR * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
          sealT.anchor.set(0.5)
          seal.addChild(sealG, sealT)
        }
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
      // P1-2：3px縁取りを2pxへ（コード変更欄）
      style: { fill: UI.paper, fontSize: hudIconD * 0.3, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 2 } },
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
    // P1-2：hud_oil_v6を優先。高さはHUD行の82〜88%に抑える（旧98%は「油槽が主役化」しすぎていた）
    const oilTexV6 = spriteTexture('hud_oil_v6')
    const oilTex = oilTexV6 ?? spriteTexture('ui_oil')
    let gaugeW = Math.min(248, Math.max(190, vw * 0.54))
    let gaugeH = oilTex ? gaugeW * (oilTex.height / oilTex.width) : gaugeW * (196 / 640)
    const gaugeMaxH = hudRowH * 0.86
    if (gaugeH > gaugeMaxH) {
      gaugeH = gaugeMaxH
      gaugeW = oilTex ? gaugeH * (oilTex.width / oilTex.height) : gaugeH * (640 / 196)
    }
    const gaugeRoot = new Container()
    const gaugeBaseX = (vw - gaugeW) / 2
    gaugeRoot.position.set(gaugeBaseX, hudCenterY - gaugeH / 2)
    ui.addChild(gaugeRoot)
    // 内側チャンネル比率：v6素材（暖色真鍮の再生成版）は実測値（x26.2〜73.5%・y35.2〜61.0%）。旧素材/無しは従来値のまま
    const chX0 = gaugeW * (oilTexV6 ? 0.262 : oilTex ? 0.175 : 0.14)
    const chX1 = gaugeW * (oilTexV6 ? 0.735 : oilTex ? 0.9375 : 0.98)
    const chY0 = gaugeH * (oilTexV6 ? 0.352 : oilTex ? 0.4949 : 0.26)
    const chY1 = gaugeH * (oilTexV6 ? 0.61 : oilTex ? 0.8214 : 0.74)
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
    // P1-2：測量器セット統一のため hud_menu_v6 を優先（旧ui_menu/ui_gearへ段階的にフォールバック）
    const menuTex = spriteTexture('hud_menu_v6') ?? spriteTexture('ui_menu') ?? spriteTexture('ui_gear')
    const menuBtn = new Container()
    if (menuTex) {
      const sp = new Sprite(menuTex)
      sp.anchor.set(0.5)
      sp.scale.set(hudIconD / Math.max(menuTex.width, menuTex.height))
      menuBtn.addChild(sp)
    } else {
      const g = new Graphics()
      // フォールバック角丸率：0.22→0.1（P1-2コード変更欄）
      g.roundRect(-hudIconD / 2, -hudIconD / 2, hudIconD, hudIconD, hudIconD * 0.1).fill(UI.wood).stroke({ width: 3, color: UI.brass })
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

    /** oxygenOverride：補給前の値でゲージを描きたいとき（層クリアの補給は演出で見せるため即時反映しない） */
    // ゲージの分母＝灯の器（lampMax）。灯は器を超えないので、貯金しても常に満タンに見える嘘がなくなった。
    // 器が広がる（祝福・知見）と分母もその場で広がる＝塗りが少し下がって「余白ができた」が見える。
    const refreshFloorHud = (oxygenOverride?: number) => {
      const pendingDrain = refreshEncounter()
      drawGauge(Math.max(0, oxygenOverride ?? run.oxygen), run.lampMax, pendingDrain)
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
    // P2-3（§2.6/§4.3）：所持知見アイコン＋採録帖ボタンを薄い革帯のドックでまとめる（単独浮遊の解消）
    // 生成素材dock_band（革・1536x256=6:1固定）。歪ませないよう幅基準でアスペクト固定fit（過度に伸ばさない）。
    // 無ければ従来のコード描画（丸角の帯）へフォールバック
    const dockBand = new Container()
    const dockBandH = Math.max(iconR * 2.2, fs(0.095))
    const dockBandW = vw * 0.92
    const dockBandTex = spriteTexture('dock_band')
    if (dockBandTex) {
      const sp = new Sprite(dockBandTex)
      sp.anchor.set(0.5)
      sp.scale.set(dockBandW / dockBandTex.width)
      dockBand.addChild(sp)
    } else {
      const g = new Graphics()
      g.roundRect(-dockBandW / 2, -dockBandH / 2, dockBandW, dockBandH, dockBandH * 0.22)
        .fill({ color: UI.leather, alpha: 0.5 })
        .stroke({ width: 1.5, color: UI.brass, alpha: 0.32 })
      dockBand.addChild(g)
    }
    dockBand.position.set(vw / 2, 0) // boosterBar自体はx=0なので、ここで画面中央へ明示的に置く
    boosterBar.addChild(dockBand) // 最背面：アイコン列・野帳ボタンより先に足す
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
    const noteBtnH = Math.max(44, iconR * 2.1, fs(0.09)) // §3.5：小ボタンの最小ヒット領域44×44px
    const noteBg = new Graphics()
    noteBg.roundRect(-noteBtnW / 2, -noteBtnH / 2, noteBtnW, noteBtnH, noteBtnH * 0.28).fill({ color: UI.leather, alpha: 0.9 }).stroke({ width: 2, color: UI.brass })
    noteBtn.addChild(noteBg)
    // P2-3：ドラフト側の draftNoteBtn と同じラベルサイズ（SMALL_BTN_LABEL）に揃える
    const noteLabel = new Text({ text: '採録帖', style: { fill: UI.paper, fontSize: SMALL_BTN_LABEL, fontFamily: FONT, fontWeight: 'bold' } })
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

    // 初遭遇の1行札は撤去（2026-08-15 オーナー指示「一瞬表れてよくわからないまま消えていく。これであればないほうがいい」）。
    // 文言カタログ core/firstnotes.ts は採録帖（図鑑）ページの原稿として温存してある。

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
    // ---------- アイドルヒント（RM/Candy式・控えめ。無操作HINT_IDLE_MSで「消せる1組」だけ小さく揺れる） ----------
    let hintIdleMs = 0 // 直近の入力/手の解決からの経過(ms)。ticker.deltaMSを積む
    let hintNextAt = HINT_IDLE_MS // 次にパルスする閾値（発火のたびHINT_REPEAT_MSぶん先送り）
    let hintMove: { a: XY; b: XY } | null = null // 選定キャッシュ（盤面が変わるまで使い回す。resetHintTimerで捨てる）
    const resetHintTimer = () => {
      hintIdleMs = 0
      hintNextAt = HINT_IDLE_MS
      hintMove = null
      view.clearHint()
    }
    const pickHintMove = (): { a: XY; b: XY } | null => {
      const moves = board.validMoves()
      if (!moves.length) return null
      // 優先1：未達の色課目（残数>0）に触れる手。Candy Crushも事実上ランダムなので凝った評価はしない
      const unmetColors = new Set<Color>()
      board.goals.forEach((g, i) => {
        if (g.type === 'color' && g.color !== undefined && board.goalDone[i] < g.count) unmetColors.add(g.color)
      })
      if (unmetColors.size > 0) {
        const hit = moves.find((mv) => {
          const pa = board.at(mv.a.x, mv.a.y)?.piece
          const pb = board.at(mv.b.x, mv.b.y)?.piece
          return (pa?.kind === 'normal' && unmetColors.has(pa.color)) || (pb?.kind === 'normal' && unmetColors.has(pb.color))
        })
        if (hit) return hit
      }
      return moves[0] // 優先2：先頭の手
    }
    // 静止時ヒーラー（2026-08-15）：終端の reconcile は「最後の手の予約1回」しか走らないため、どの経路かで
    // 取り残された駒（alpha=0のまま等）が静止後も残り続けていた（層5実測：静止中に21セル残留）。
    // 静止中は壊せる演出が存在しない＝reconcile は定義上安全なので、静止2秒ごとに必ず回して自己修復を保証する。
    // 根本の設計見直し（即時解決エンジン×予約再生の構造）は別途 Codex と進行中
    let idleHealMs = 0
    let floorDecided = false // 層の決着処理（クリア/遭難）が起動済みか。命綱の二重発火防止
    const idleHintTick = (t: { deltaMS: number }) => {
      if (!alive()) {
        app.ticker.remove(idleHintTick)
        return
      }
      // stepped経路：Coordinatorが手を進めている間はセグメント間の待ちが「静止」に見えるが手の途中。
      // healer/命綱/ヒントを動かすと手の途中でreconcile・クリア回収・ヒント演出が割り込む（§10.2）
      if (RESOLUTION_MODE === 'stepped' && coordinatorActive) {
        idleHealMs = 0
        hintIdleMs = 0
        hintNextAt = HINT_IDLE_MS
        return
      }
      if (view.isQuiet()) {
        idleHealMs += t.deltaMS
        if (idleHealMs >= 2000) {
          idleHealMs = 0
          view.reconcile()
          // クリアの命綱（2026-08-15 オーナー報告「自己修復されたがクリア判定がなくなり進めなくなった」）：
          // 課目がすべて達成済みなのに決着処理が走っていなければ、ここで回収する（floor-clear イベントの
          // 取りこぼしがどの経路で起きても、静止2秒後に必ず前へ進める）。根本解決はC案移行で
          if (!floorDecided && board.goals.every((g, gi) => board.goalDone[gi] >= g.count)) {
            console.debug('[yacho] idle-heal: missed floor-clear recovered')
            floorDecided = true
            inputLocked = true
            onFloorClear()
          }
        }
      } else idleHealMs = 0
      // inputLocked中・盤面演出中はアイドル判定を進めない（演出が終わった瞬間から4秒を数え直す）
      if (inputLocked || !view.isQuiet()) {
        hintIdleMs = 0
        hintNextAt = HINT_IDLE_MS
        return
      }
      hintIdleMs += t.deltaMS
      if (hintIdleMs < hintNextAt) return
      if (!hintMove) hintMove = pickHintMove()
      if (hintMove) view.showHint(hintMove.a, hintMove.b)
      hintNextAt += HINT_REPEAT_MS
    }
    app.ticker.add(idleHintTick)

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
      resetHintTimer()
    })
    // Codexレビュー#5：pointerupoutside/pointercancelでも必ずpress状態を破棄する（放置すると次のpointerupが
    // 遠く離れた場所からのスワイプとして誤解決される）
    const discardPress = () => {
      downAt = null
      downCell = null
    }
    playRoot.on('pointerupoutside', discardPress)
    playRoot.on('pointercancel', discardPress)
    // ---------- デバッグ配置モード（URLに ?debug）----------
    // 2026-08-15 オーナー提案：「特殊駒を自由に置いてテストする」。爆弾・星珠の大量消し＋連鎖で出る
    // 表示バグの再現装置。パレットで種類を選び、盤セルをタップすると**手数を消費せず**その駒に置き換わる。
    // エンジンの駒を直接書き換えて view.reconcile() で同期するだけ＝本編のイベント経路は汚さない
    const DEBUG_PLACE = new URLSearchParams(location.search).has('debug')
    let debugSel: { piece: Piece | null } | null = null
    const debugSetPiece = (x: number, y: number, p: Piece | null) => {
      const c = board.at(x, y)
      if (!c || c.block) return
      c.piece = p ? { ...p } : null
      view.reconcile()
    }
    ;(window as unknown as Record<string, unknown>).__yachoDebugSetPiece = debugSetPiece
    if (DEBUG_PLACE) {
      const kinds: { label: string; piece: Piece | null }[] = [
        { label: '壺', piece: { kind: 'hitsubo' } },
        { label: '銛─', piece: { kind: 'harpoon', dir: 'h' } },
        { label: '銛｜', piece: { kind: 'harpoon', dir: 'v' } },
        { label: '珠', piece: { kind: 'seiju' } },
        { label: '虫', piece: { kind: 'hamushi' } },
        { label: '消', piece: null },
      ]
      const palY = vh * 0.965
      const btnW = fs(0.1)
      const marks: Graphics[] = []
      kinds.forEach((k, i) => {
        const bx = vw * 0.02 + i * (btnW + fs(0.012))
        const g = new Graphics()
        const draw = (on: boolean) => {
          g.clear()
          g.roundRect(bx, palY - fs(0.05), btnW, fs(0.1), 6).fill({ color: on ? 0x6b4b23 : 0x2a2216, alpha: 0.92 })
          g.roundRect(bx, palY - fs(0.05), btnW, fs(0.1), 6).stroke({ width: 2, color: on ? 0xf2d98a : UI.brass, alpha: 0.9 })
        }
        draw(false)
        marks.push(g)
        const t = new Text({ text: k.label, style: { fill: 0xf4e8cf, fontSize: fs(0.032), fontFamily: FONT, fontWeight: 'bold' } })
        t.anchor.set(0.5)
        t.position.set(bx + btnW / 2, palY)
        g.eventMode = 'static'
        g.hitArea = { contains: (hx: number, hy: number) => hx >= bx && hx <= bx + btnW && hy >= palY - fs(0.05) && hy <= palY + fs(0.05) }
        g.on('pointerdown', (ev2) => {
          ev2.stopPropagation()
          debugSel = debugSel?.piece === k.piece ? null : { piece: k.piece }
          marks.forEach((m, mi) => {
            m.clear()
            const on = debugSel !== null && kinds[mi] === k && debugSel.piece === k.piece
            m.roundRect(vw * 0.02 + mi * (btnW + fs(0.012)), palY - fs(0.05), btnW, fs(0.1), 6).fill({ color: on ? 0x6b4b23 : 0x2a2216, alpha: 0.92 })
            m.roundRect(vw * 0.02 + mi * (btnW + fs(0.012)), palY - fs(0.05), btnW, fs(0.1), 6).stroke({ width: 2, color: on ? 0xf2d98a : UI.brass, alpha: 0.9 })
          })
        })
        playRoot.addChild(g, t)
      })
    }
    playRoot.on('pointerup', (e) => {
      if (inputLocked || !downAt || !downCell) return
      // デバッグ配置：選択中はタップでその駒を置くだけ（手は消費しない）
      if (debugSel !== null) {
        debugSetPiece(downCell.x, downCell.y, debugSel.piece)
        downAt = null
        downCell = null
        return
      }
      const dx = e.global.x - downAt.x
      const dy = e.global.y - downAt.y
      const dist = Math.hypot(dx, dy)
      // 入力をコマンドへ正規化してから経路（legacy/stepped）を分岐する（C案移行Phase6）
      let cmd: MoveCommand | null = null
      if (dist < view.S * 0.35) {
        const c = board.at(downCell.x, downCell.y)
        if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') cmd = { kind: 'tap', at: downCell }
      } else {
        const adx = Math.abs(dx)
        const ady = Math.abs(dy)
        // Codexレビュー#6：斜めスワイプの方向ロック。主軸が副軸の1.25倍未満は「どちらへ倒したいか曖昧」として
        // 何もしない（不正手扱いにもしない＝音も往復も出さずキャンセル。1px差の決め打ちで誤爆していた）
        if (Math.max(adx, ady) >= Math.min(adx, ady) * 1.25) {
          const dir = adx > ady ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
          cmd = { kind: 'swap', a: downCell, b: { x: downCell.x + dir.x, y: downCell.y + dir.y } }
        }
      }
      downAt = null
      downCell = null
      if (cmd === null) return
      if (RESOLUTION_MODE === 'stepped') {
        submitStepped(cmd)
        return
      }
      const evs = cmd.kind === 'tap' ? board.tap(cmd.at) : board.swap(cmd.a, cmd.b)
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
    /**
     * 1手ぶんの「集計消費」（C案移行Phase6・codex_c_phase46_plan.md §8.1-B/§8.2）。
     * 記録・HUD数値・採録帯用カウンタなど、イベント時刻に依存しない消費だけをここに置く。
     * legacy経路は手の直後、stepped経路は手の完了時（finalize）に全イベントまとめて1回呼ぶ
     * ＝二重計上が構造的に起きない。演出（飛翔・被弾軌跡等）はBoardViewのコールバックが担う。
     */
    const accountMove = (evs: BoardEvent[]): { cleared: boolean; over: boolean } => {
      const refill = evs.find((e) => e.t === 'oxygen-refill')
      if (refill && refill.t === 'oxygen-refill') refillAmount = refill.amount
      // 「なぜ細ったか」の記録（PHASE2.md §2.5②）。層を出るときの灯は補給を足す前の値。
      // 敵ターンで灯が0を割った同じ手に偶発マッチで課目が埋まるとクリアが優先されるので、この値は負になり得る。
      // 灯に負数は無い（0＝尽きた）ので、run-over 側と同じく0で丸める（折れ線が0線の下へ出るのを防ぐ）
      if (refill && refill.t === 'oxygen-refill') lightSeries.push({ floor, light: Math.max(0, refill.left - refill.amount) })
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
      // 大喰らい（祝福）でともった灯も同じ「+N」で実況する（amountは器のクランプ後＝実際に増えた量）
      for (const e of evs) if (e.t === 'lamp-bonus') oxygenRefillFx(e.amount)
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
      return { cleared: evs.some((e) => e.t === 'floor-clear'), over: evs.some((e) => e.t === 'run-over') }
    }

    const handleFloorResult = (evs: BoardEvent[]) => {
      resetHintTimer() // 手が解決したので、次の無操作4秒をここから数え直す（選定キャッシュも捨てる）
      const dur = view.play(evs)
      // 飛翔が落ちても数字は必ず board.goalDone に追いつく（演出の取りこぼしを表示に持ち込まない）
      tw.delay(Math.min(dur + 500, 2200), () => {
        if (alive()) syncGoalDisplay()
      })
      const { cleared, over } = accountMove(evs)
      // 決着の画面は**盤面の演出が本当に終わってから**出す（2026-08-15 オーナー「連鎖が続いているのに
      // 勝利ページが出てくる」）。旧実装の Math.min(dur, 1200) は長い連鎖・勝利連射の途中で被せていた。
      // dur は「この手」のタイムラインだが、並行続行では前の手の尻尾も残りうるので isQuiet() で締める
      // 静止待ちには**上限**を置く（2026-08-15 オーナー報告「クリア条件を満たしてもクリア判定にならない」の根治）。
      // 大連鎖でタイムラインが数十秒に膨れると isQuiet() が延々 false のまま＝入力ロックで固まって見える。
      // 予算側（タイムライン予算）で通常は数秒に収まるが、どんな場合でも QUIET_WAIT_MAX で必ず決着画面を出す
      const QUIET_WAIT_MAX = 6000
      const whenBoardQuiet = (fn: () => void) => {
        const firstWait = Math.min(dur + 250, 3000) // durも爆発しうるので初回待ちにも上限
        let waited = firstWait // 上限は**関数開始からの通算**で数える（Codex検収 blocking-2：初回待ちを含めないと最大9.1秒になっていた）
        const poll = () => {
          if (!alive()) return
          if (view.isQuiet() || waited >= QUIET_WAIT_MAX) fn()
          else {
            waited += 180
            tw.delay(180, poll)
          }
        }
        tw.delay(firstWait, poll)
      }
      if (cleared) {
        floorDecided = true
        inputLocked = true
        whenBoardQuiet(onFloorClear)
      } else if (over) {
        floorDecided = true
        inputLocked = true
        // 灯が尽きた層も推移の最後の点として残す（負の値は「尽きた」と同じ事実なので0に丸める）
        lightSeries.push({ floor, light: Math.max(0, run.oxygen) })
        whenBoardQuiet(() => showRunResult(false))
      }
    }

    // ---- C案移行Phase6（codex_c_phase46_plan.md §9）：ResolutionCoordinator（?resolution=stepped 時のみ） ----
    // エンジン1セグメント → ビュー再生完了 → 次セグメント…の交互進行。入力評価時に表示と論理が一致する。
    // 割込は「現セグメントは最後まで再生 → 残段を無演出drain → reconcileで最終盤面へ → latest input 1件を再評価」。
    // 決着（floor-clear / run-over）は queued input より優先（§9.2）。
    let coordinatorActive = false
    let latestInput: MoveCommand | null = null
    const submitStepped = (cmd: MoveCommand) => {
      if (coordinatorActive) {
        latestInput = cmd // 無制限queueにしない：最新1件だけ上書き保持
        return
      }
      void runStepped(cmd)
    }
    const runStepped = async (cmd: MoveCommand): Promise<void> => {
      coordinatorActive = true
      try {
        const resolution = cmd.kind === 'swap' ? board.swapStepped(cmd.a, cmd.b) : board.tapStepped(cmd.at)
        const firstStep = resolution.next()
        if (firstStep === null) return // 空手（通常駒タップ等）。legacyの evs.length===0 と同じ扱い
        resetHintTimer()
        if (firstStep.events.some((e) => e.t === 'swap' && e.illegal)) sfx.illegal()
        else sfx.swap()
        const all: BoardEvent[] = [...firstStep.events]
        const ctx = view.beginSteppedMove()
        let step: typeof firstStep | null = firstStep
        let segs = 0
        while (step !== null) {
          segs++
          await view.playSegment(ctx, step)
          if (!alive()) return
          if (latestInput && !resolution.done) {
            // 割込：残段を無演出で確定し、最終盤面へ写像を保証してから抜ける
            const drained = resolution.drain()
            all.push(...drained.events)
            view.renderStable() // ドレイン分は意図的に描いていない＝差分が出て当然の一括同期（§9.2）
            console.debug('[yacho] stepped interrupt: segs', segs, 'drained', drained.events.length)
            break
          }
          step = resolution.next()
          if (step) all.push(...step.events)
        }
        console.debug('[yacho] stepped move done: segs', segs, 'events', all.length)
        view.finishSteppedMove(ctx)
        syncGoalDisplay()
        const { cleared, over } = accountMove(all)
        if (cleared || over) {
          floorDecided = true
          inputLocked = true
          latestInput = null // 決着はqueued inputより優先
          if (cleared) onFloorClear()
          else {
            lightSeries.push({ floor, light: Math.max(0, run.oxygen) })
            showRunResult(false)
          }
        }
      } catch (err) {
        // 非同期経路の例外はunhandled rejectionになり黙って手が途切れる。必ず可視化して盤面は写像を回復する
        console.error('[yacho] stepped move failed:', err)
        view.renderStable()
      } finally {
        coordinatorActive = false
      }
      // 手が確定した最終盤面で、保留中の最新入力を1件だけ再評価する
      const next = latestInput
      latestInput = null
      if (next && !inputLocked && alive()) void runStepped(next)
    }

    const onFloorClear = () => {
      // ボス層クリア＝ラン勝利（ROGUE.md §6）。深度20/30は層が増えたときにそのまま繋がる
      const lastFloor = floor >= FLOORS.length
      const next = lastFloor ? () => showRunResult(true) : showFloorRecordBand
      // 幕主を仕留めた者に祝福を1つ（PHASE2.md「祝福の回数と時機」。深度10/20/30）。
      // ただし最終層はここでランが終わるので、受けた祝福が一度も働かない＝選ばせない
      if (isBlessingFloor(floor) && !lastFloor) showBlessingPanel(next)
      else next()
    }

    /**
     * 層クリアの採録帯（codex_strategy_v2 [D]）。ドラフトの前に挟む。
     *   0.00〜0.35 盤面が一段暗くなる（最後の収集物が課目へ飛ぶのは、この手のタイムラインが既に担っている）
     *   0.25〜0.95 細い採録帯が下から出る。`深度N 踏破`
     *   0.55〜1.05 酸素がゲージへ入り、同時に手数と最多発火知見だけを出す
     *   以降はタップ待ち（自動では消えない。本人指示 2026-08-15「読む前に消える」の廃止）。
     *   出そろう前のタップは早送り（全文を即出し）、出そろった後のタップで採録（ドラフト）へ。
     * 出すのはこの3つだけ。全知見の発火一覧・総破壊数・星・スコア・評価語は出さない（[D]§3）。
     */
    /**
     * 踏破記録票（P1-3・codex_ad_overhaul.md §2.4/§4.2）：画面幅いっぱいのクリーム矩形を廃止し、
     * floor_record_slip（破り取り紙片）を幅86%・中央やや下へ差し込む。情報階層は
     * 左上「踏破記録」/中央「深度N」/右上朱の「踏破」印/下段左「N手」/下段右「灯+N」/最下段=最多発火知見。
     * 「残灯N」は表示せず、灯+Nの位置から油槽へ琥珀光が飛んで数字が確定する（oxygenRefillFxへ接続）。
     */
    const showFloorRecordBand = () => {
      sfx.fanfare()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0 })
      dim.eventMode = 'static' // 早送りのタップをここで受ける（背面の盤面には触らせない）
      playRoot.addChild(dim)
      tw.tween(dim, { alpha: 0.26 }, 350) // P1-3：0.34→0.24〜0.28

      const slipW = vw * 0.86
      const slipTex = spriteTexture('floor_record_slip')
      // 横断監査で判明：floor_record_slip(1536×512=3:1)を幅vw*0.86・高さmin(148,vh*0.17)の縦横別倍率で
      // 伸ばしており、端末サイズ次第で紙が歪んでいた。ドラフト票（正典§2）と同じ方針でアスペクトを固定する
      const slipH = slipTex ? slipW * (slipTex.height / slipTex.width) : slipW / 3
      const slipX = vw * 0.07
      const slipY = vh * 0.49 - slipH / 2 // 画面中央やや下へ差し込む
      const band = new Container()
      // タップは全部 dim で受ける。帯を素通しにしないと「帯の上のタップ」だけが黙って無視される
      // （playRoot が interactive なので子の帯がヒットテストに掛かる。旧実装では自動送りがこの欠陥を隠していた。実測 2026-08-15）
      band.eventMode = 'none'
      if (slipTex) {
        const sp = new Sprite(slipTex)
        sp.width = slipW
        sp.height = slipH
        band.addChild(sp)
      } else {
        const bandBg = new Graphics()
        bandBg.roundRect(0, 0, slipW, slipH, 6).fill({ color: UI.paper, alpha: 0.97 })
        bandBg.roundRect(0, 0, slipW, slipH, 6).stroke({ width: 1, color: UI.ink, alpha: 0.25 })
        band.addChild(bandBg)
      }
      band.position.set(slipX, slipY + 12) // 登場：下から全面移動ではなく12px上昇+フェード
      band.alpha = 0
      playRoot.addChild(band)
      const padX = slipW * 0.07
      const mk = (text: string, size: number, x: number, y: number, ax: number, ay: number, maxW: number, fill: number = UI.ink) => {
        const t = new Text({ text, style: { fill, fontSize: size, fontFamily: FONT, fontWeight: 'bold' } })
        t.anchor.set(ax, ay)
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

      // floor_record_slip素材は破り取り紙の縁を描くため、実際に紙面が乗っているのは縦11%〜84%あたり
      // （上下は透過の余白）。行はすべてこの可視帯（12%〜83%）の内側へ収める
      // 1) 左上：小さな「踏破記録」／2) 中央：大きな「深度N」（即時表示。②の登場と同時に読める）
      mk('踏破記録', Math.max(11, slipH * 0.1), padX, slipH * 0.17, 0, 0, slipW * 0.4, 0x6b5238)
      mk(`深度${floor}`, Math.min(30, Math.max(24, slipH * 0.24)), slipW / 2, slipH * 0.4, 0.5, 0.5, slipW * 0.46)
      // 3) 右：朱の「踏破」印（生成素材の押印。素材右側に浮き出た円のガイドへ重ねる。無ければコード描画へフォールバック）
      const stampR = slipH * 0.18
      const stamp = new Container()
      stamp.position.set(slipW * 0.855, slipH * 0.46)
      stamp.rotation = -0.12
      const tohaSealTex = spriteTexture('seal_toha')
      if (tohaSealTex) {
        const sp = new Sprite(tohaSealTex)
        sp.anchor.set(0.5)
        sp.scale.set((stampR * 2.1) / Math.max(tohaSealTex.width, tohaSealTex.height))
        stamp.addChild(sp)
      } else {
        const stampG = new Graphics()
        stampG.circle(0, 0, stampR).stroke({ width: 2, color: UI.cinnabar, alpha: 0.85 })
        stamp.addChild(stampG)
        const stampT = new Text({ text: '踏破', style: { fill: UI.cinnabar, fontSize: stampR * 0.85, fontFamily: FONT, fontWeight: 'bold' } })
        stampT.anchor.set(0.5)
        const stampFitW = stampR * 1.5
        if (stampT.width > stampFitW) stampT.scale.set(stampFitW / stampT.width)
        stamp.addChild(stampT)
      }
      stamp.scale.set(0.6)
      stamp.alpha = 0
      band.addChild(stamp)

      // 4) 下段左「N手」／5) 下段右「灯 +N」（手数に星評価は付けない[D]§3。残灯は出さず、油槽側で確定させる）
      const rowY = slipH * 0.62
      const movesT = mk(`${movesThisFloor}手`, Math.max(13, slipH * 0.11), padX, rowY, 0, 0.5, slipW * 0.35)
      const oxyT = mk(`灯 +${refillAmount}`, Math.max(13, slipH * 0.12), slipW - padX, rowY, 1, 0.5, slipW * 0.35, 0x7a5620)
      // 6) 最多発火知見（存在しなければ行ごと消える＝生成しない）
      const bestT = bestDef
        ? mk(`最も働いた知見：${bestDef.name} ${bestFires}回`, Math.max(11, slipH * 0.08), padX, slipH * 0.72, 0, 0.5, slipW - padX * 2, 0x6b5238)
        : null
      // 「タップで次へ」：紙片下辺内の小さな墨色注記へ統合（旧：盤面上に裸置き）。可視紙面の下端(約83%)内に収める
      const tapHint = mk('タップで次へ', Math.max(10, slipH * 0.07), slipW / 2, slipH * (bestDef ? 0.8 : 0.72), 0.5, 0.5, slipW * 0.5, 0x6b5238)
      tapHint.alpha = 0

      const laterLines: Text[] = bestT ? [movesT, oxyT, bestT] : [movesT, oxyT]
      for (const t of laterLines) t.alpha = 0

      let refilled = false
      let exited = false
      let ready = false // 遅延行が出そろってタップ待ちに入ったか
      // 補給はゲージ側で見せる（handleFloorResult が補給前の値で描いてあるので、ここで実値へ確定する）。
      // 記録票の「灯+N」位置から油槽へ琥珀光が飛び、着弾でoxygenRefillFxを起こして数字を確定する（P1-3）
      const doRefill = () => {
        if (refilled || !alive()) return
        refilled = true
        // band はplayRootの直下（回転・スケールなし）なので、band.position + ローカル座標がそのままplayRoot座標になる
        const glow = new Graphics()
        glow.circle(0, 0, Math.max(4, slipH * 0.05)).fill({ color: UI.brassBright, alpha: 0.95 })
        glow.position.set(band.position.x + oxyT.position.x - oxyT.width * 0.4, band.position.y + oxyT.position.y)
        playRoot.addChild(glow)
        tw.tween(glow, { x: gaugeBaseX + gaugeW * 0.5, y: hudCenterY, alpha: 0.15 }, 420, {
          ease: tw.easeInCubic,
          onDone: () => {
            if (!glow.destroyed) glow.destroy()
            if (alive()) oxygenRefillFx(refillAmount)
          },
        })
        tw.tween(glow.scale, { x: 0.35, y: 0.35 }, 420)
      }
      const hintPulse = () => {
        if (tapHint.destroyed || exited) return
        tw.tween(tapHint, { alpha: 0.45 }, 700, {
          onDone: () => {
            if (tapHint.destroyed || exited) return
            tw.tween(tapHint, { alpha: 0.85 }, 700, { onDone: hintPulse })
          },
        })
      }
      const becomeReady = () => {
        if (ready || exited || !alive()) return
        ready = true
        tapHint.alpha = 0.85
        hintPulse()
      }
      const doExit = () => {
        if (exited || !alive()) return
        exited = true
        doRefill() // 早送りで③を飛ばしても、補給だけは必ず起こす
        tw.tween(band, { alpha: 0 }, 220, {
          onDone: () => {
            if (!band.destroyed) band.destroy({ children: true })
          },
        })
        tw.tween(dim, { alpha: 0 }, 300, {
          onDone: () => {
            if (!dim.destroyed) dim.destroy()
          },
        })
        tw.delay(280, () => {
          if (alive()) showDraftPanel()
        })
      }
      // ②登場：12px上昇＋フェード＋押印（旧：全面スライドイン）
      tw.tween(band, { alpha: 1 }, 260, { delay: 150 })
      tw.tween(band.position, { y: slipY }, 260, { delay: 150, ease: tw.easeOutCubic })
      tw.delay(420, () => {
        if (!alive() || exited) return
        tw.tween(stamp, { alpha: 1 }, 160, { ease: tw.easeOutBack })
        tw.tween(stamp.scale, { x: 1, y: 1 }, 220, { ease: tw.easeOutBack })
      })
      tw.delay(520, () => {
        if (!alive() || exited) return
        doRefill()
        tw.tween(movesT, { alpha: 1 }, 260)
        tw.tween(oxyT, { alpha: 1 }, 300, { delay: 60 })
        if (bestT) tw.tween(bestT, { alpha: 1 }, 300, { delay: 160 })
        tw.delay(400, becomeReady) // 遅延行が出そろったらタップ待ちへ
      })

      // タップ遷移（本人指示 2026-08-15）：1.45秒の自動送りを廃止。
      // 出そろう前のタップ＝早送り（全文を即出し）／出そろった後のタップ＝採録へ。
      const skipNow = () => {
        if (exited || !alive()) return
        tw.snap(band.position)
        tw.snap(band)
        stamp.alpha = 1
        stamp.scale.set(1)
        for (const t of laterLines) if (!t.destroyed) t.alpha = 1
        doRefill()
        becomeReady()
      }
      dim.on('pointertap', () => {
        if (exited || !alive()) return
        if (ready) doExit()
        else skipNow()
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
      // 枠制限の一時停止（run.ts UPGRADE_SLOTS_DEFAULT=Infinity）では知見28種をラン終盤に採り尽くせる。
      // 候補ゼロの採録画面は確定ボタンが押せず詰むので、採録そのものを飛ばして次の層へ
      if (options.length === 0) {
        playRoot.removeAllListeners()
        playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
        buildFloorScene(floor + 1)
        ensureBgm(themeFloorId(floor + 1))
        return
      }
      const owned = UPGRADES.filter((u) => run.upgrades.includes(u.id))
      const connections = options.map((opt) => computeConnection(owned, opt))
      // おすすめリボン（オーナー指示：知見にもおすすめがあっていい）。呼応が最多の1枚だけに付け、理由文は書かない。
      // 同数タイならより左のカード。全カード0件なら誰にも付けない（無理に薦めない）
      const maxConnCount = Math.max(0, ...connections.map((c) => c.count))
      const recommendedIndex = maxConnCount > 0 ? connections.findIndex((c) => c.count === maxConnCount) : -1
      const padX = Math.max(20, vw * 0.05)
      // 3つの行為（PHASE2.md §2.8）。合成できる／深められるときだけ札が増える。
      // 上限3件はカード枠と同数（既存の3枚レイアウトをそのまま使い、新しい作法を持ち込まない）
      const fuseOpts = PHASE28_ENABLED ? fusionOptions(run.upgrades).slice(0, 3) : []
      const deepOpts = PHASE28_ENABLED ? deepenOptions(run).slice(0, 3) : []
      const modes: DraftMode[] = ['take']
      if (fuseOpts.length) modes.push('fuse')
      if (deepOpts.length) modes.push('deepen')
      let mode: DraftMode = 'take'

      /** いまの行為で並べる3枚（描画コードは1つのまま、中身だけ差し替える） */
      const cardsFor = (m: DraftMode): DraftCardView[] => {
        if (m === 'fuse')
          return fuseOpts.map((f) => ({
            iconId: f.def.id,
            category: '合成',
            name: f.def.name,
            note: `${f.a.name} ＋ ${f.b.name}`,
            desc: f.def.desc,
            chip: '枠がひとつ空く',
          }))
        if (m === 'deepen')
          return deepOpts.map((u) => ({
            iconId: u.id,
            category: '深化',
            name: u.name,
            note: `いま　${u.desc}`,
            desc: u.deepen!.desc,
            chip: '枠は変わらない',
          }))
        return options.map((opt, i) => ({
          iconId: opt.id,
          category: CATEGORY_LABEL[UPGRADE_CATEGORY[opt.id]] ?? '',
          name: opt.name,
          desc: opt.desc,
          connectedIds: connections[i].connected.map((u) => u.id),
          bonus: opt.starterDesc,
        }))
      }

      const panel = new Container()
      // プレイHUD（油槽・深度・残敵チップ・ビルドドック）は所持ストリップや候補カードと
      // 位置が重なるため、ドラフト中は丸ごと隠す。半透明の暗幕だけでは透けて混線する
      ui.visible = false
      const dimG = new Graphics()
      dimG.rect(0, 0, vw, vh).fill({ color: 0x0f0a06, alpha: 0.72 }) // P1-4：0.82→0.64〜0.68／実機QA：カード可読性不足で0.66→0.72（codex_draft_fixspec.md付随修正）
      dimG.eventMode = 'static' // 背面のタップを吸収（誤操作防止）
      panel.addChild(dimG)
      playRoot.addChild(panel)

      // ---- 0〜6%：タイトル＋野帳ボタン（オーナー指摘：3枚スクロール退避はUX誤り→タイトル/ストリップ帯を圧縮し
      //     カード領域を画面高の約70%まで確保する。以前の0〜9%から詰めた） ----
      const titleY = vh * 0.028
      const noteBtnW = Math.min(vw * 0.22, fs(0.24))
      const noteBtnH = Math.max(36, fs(0.072)) // スクロール廃止のため44px目安から詰めた（副次ボタンのため許容）
      // タイトルと採録帖ボタンが衝突しないよう、最大幅を明示して縮める（P1-4コード変更欄）
      const titleMaxW = vw - padX * 2 - noteBtnW - fs(0.03)
      const title = new Text({
        text: modes.length > 1 ? `深度${floor} 踏破 — ひとつだけ` : `深度${floor} 踏破 — 知見をひとつ採る`,
        style: { fill: UI.paper, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold', breakWords: true },
      })
      title.anchor.set(0, 0.5)
      title.position.set(padX, titleY)
      if (title.width > titleMaxW) title.scale.set(titleMaxW / title.width)
      panel.addChild(title)

      const draftNoteBtn = new Container()
      const draftNoteBg = new Graphics()
      // P2-3：盤面ドックの noteBtn と同じ革地・角丸比率・ラベルサイズに揃える（同じボタン素材）
      draftNoteBg
        .roundRect(-noteBtnW / 2, -noteBtnH / 2, noteBtnW, noteBtnH, noteBtnH * 0.28)
        .fill({ color: UI.leather, alpha: 0.9 })
        .stroke({ width: 2, color: UI.brass })
      draftNoteBtn.addChild(draftNoteBg)
      const draftNoteLabel = new Text({ text: '採録帖', style: { fill: UI.paper, fontSize: SMALL_BTN_LABEL, fontFamily: FONT, fontWeight: 'bold' } })
      draftNoteLabel.anchor.set(0.5)
      draftNoteBtn.addChild(draftNoteLabel)
      draftNoteBtn.position.set(vw - padX - noteBtnW / 2, titleY)
      draftNoteBtn.eventMode = 'static'
      draftNoteBtn.cursor = 'pointer'
      draftNoteBtn.hitArea = { contains: (x: number, y: number) => x >= -noteBtnW / 2 && x <= noteBtnW / 2 && y >= -noteBtnH / 2 && y <= noteBtnH / 2 }
      draftNoteBtn.on('pointertap', () => showFieldNote(buildSpecialPieceEntry()))
      panel.addChild(draftNoteBtn)

      // ---- 6〜13%：所持強化ストリップ（[D]：40pxアイコン横スクロール、左に所持N、右に一覧、系統内訳） ----
      const stripRowY = vh * 0.09
      const stripIconSize = Math.max(26, Math.min(34, fs(0.085)))
      // 枠制限の一時停止中（run.ts）は分母を出さない（「3/Infinity」を出さない）。有限に戻したら分母表示も戻す
      const ownedLabel = new Text({ text: Number.isFinite(run.slots) ? `手持ち ${owned.length}/${run.slots}` : `手持ち ${owned.length}`, style: { fill: 0xcbb98a, fontSize: fs(0.028), fontFamily: FONT, fontWeight: 'bold' } })
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
      // カード選択との双方向ハイライト用：所持id→そのアイコンに重ねる淡いリング（オーナー指示：所持ストリップ側も呼応を示す）
      const stripHighlightRings = new Map<string, Graphics[]>()
      owned.forEach((u, i) => {
        const cx = i * (stripIconSize + stripGap) + stripIconSize / 2
        const ic = makeUniqueUpgradeIcon(u.id, stripIconSize)
        ic.position.set(cx, 0)
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
        const ring = new Graphics()
        ring.circle(0, 0, stripIconSize * 0.62).stroke({ width: 2.5, color: 0xf2d98a, alpha: 0.95 })
        ring.position.set(cx, 0)
        ring.visible = false
        stripHost.addChild(ring)
        const rings = stripHighlightRings.get(u.id) ?? []
        rings.push(ring)
        stripHighlightRings.set(u.id, rings)
      })
      /** 選択カードと呼応する所持アイコンだけを淡く光らせる（選択解除・別カード選択で戻る） */
      const setStripHighlight = (ids: string[] | null) => {
        const idSet = new Set(ids ?? [])
        stripHighlightRings.forEach((rings, id) => {
          const on = idSet.has(id)
          rings.forEach((r) => (r.visible = on))
        })
      }
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
      const breakdownOrder: UpgradeCategory[] = ['plant', 'mineral', 'gear', 'relic', 'synergy', 'lamp']
      const breakdownText = breakdownOrder
        .filter((c) => counts[c])
        .map((c) => `${CATEGORY_LABEL[c]}${counts[c]}`)
        .join('・')
      if (breakdownText) {
        // 実機QA：暗地に対して薄くて読みにくい → 0x9a8968（鈍い黄土）から明るい杏色へ（付随修正）
        const bd = new Text({ text: breakdownText, style: { fill: 0xcbb98a, fontSize: fs(0.021), fontFamily: FONT } })
        bd.position.set(padX, stripRowY + fs(0.045))
        panel.addChild(bd)
      }

      // ---- 86.5〜98%：接続要約＋確定ボタン（選択状態に応じてrenderBottomで描き直す）----
      // カード領域の逆算に使うため先に確定する（以前の82〜96%から詰めた）
      const bottomTop = vh * 0.93
      const bottomH = vh * 0.068

      // ---- 候補カード3枚（オーナー指摘：選択肢の比較UIでスクロールはUX誤り→スクロール廃止）----
      // 行為が2つ以上あるときだけ、カードの上に細い行為タブを1本足して、そのぶんカードを詰める
      const hasTabs = modes.length > 1
      const tabsY = vh * 0.146
      const tabH = vh * 0.03
      const cardsRegionTop = hasTabs ? vh * 0.164 : vh * 0.13
      const cardGap = Math.max(5, vh * 0.009)
      // cardHをバンド高から逆算する（2:1固定は維持）。3枚+ギャップ2つがちょうど候補領域に収まる高さと、
      // 横幅上限（vw*0.86）の2:1相当の、小さいほうを採る。個々のカードは内容が多ければ従来どおり伸びられる
      // （下のrenderCards内 Math.max(minCardH, ...)）。スクロール機構自体は最終安全弁として残す
      const bandH = bottomTop - cardsRegionTop
      const cardH0 = Math.min((vw * 0.86) / 2, (bandH - cardGap * 2) / 3)
      const cardW = cardH0 * 2
      const naturalH = cardH0
      const minCardH = naturalH
      const cardIconSize = Math.max(24, Math.min(32, fs(0.078)))
      const connIconSize = Math.max(14, Math.min(17, fs(0.038)))
      // 2026-08-15 オーナー「文字が枠に対して小さい」→ 本文を一段大きく（0.0265→0.031）。
      // P1-4：13px相当を下限にする（§3.6本文規則）。余白側で吸収し、文字を13px未満へ縮めない
      const bodyFont = Math.max(13, fs(0.031))

      const bottomContainer = new Container()
      bottomContainer.position.set(0, bottomTop)
      panel.addChild(bottomContainer)

      let selectedIndex: number | null = null
      let cardContainers: Container[] = []
      let cardGlows: Container[] = [] // 選択マーク（真鍮クリップ＋「採録候補」朱印）の束。名は旧glowを踏襲
      let cardBaseY: number[] = [] // 選択時に-4pxする基準Y（P1-4：紙が上へ持ち上がる）
      let scrollActive = false // QA検証用（オーナー指摘：スクロールは最終安全弁のみ・6ビューポートで発動しないことが合格条件）
      let lastTotalH = 0
      let lastRegionH = 0

      const goNextFloor = () => {
        const next = floor + 1
        playRoot.removeAllListeners()
        playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
        buildFloorScene(next)
        ensureBgm(themeFloorId(next))
      }

      const confirmPick = (i: number) => {
        // 合成は2つが1つになる＝枠が空くので手放す画面は要らない。深化は枠を動かさない（PHASE2.md §2.8）
        if (mode === 'fuse') {
          applyFusion(run, fuseOpts[i])
          goNextFloor()
          return
        }
        if (mode === 'deepen') {
          applyDeepen(run, deepOpts[i].id)
          goNextFloor()
          return
        }
        // 枠が埋まっているなら、採るまえに手放す1つを選ばせる（PHASE2.md §2「取る＝捨てる」）。
        // 呪いで枠が減った直後は所持が枠を超えているので、収まるまで繰り返す（超過を持ち越さない）
        const makeRoom = () => {
          if (run.upgrades.length >= run.slots) showDiscardPanel(options[i], makeRoom)
          else {
            takeUpgrade(run, options[i].id) // 灯の器系（工程3）の会計もここで一度だけ効く
            goNextFloor()
          }
        }
        makeRoom()
      }

      const renderBottom = () => {
        bottomContainer.removeChildren().forEach((c) => c.destroy({ children: true }))
        const btnW = Math.min(cardW, vw * 0.7)
        const enabled = selectedIndex !== null
        // P1-4：未選択ボタンの高さを現状比約80%へ（無効ボタンが選択肢より先に目へ入るのを防ぐ）
        const btnH = enabled ? bottomH * 0.42 : bottomH * 0.42 * 0.8
        const btnY = bottomH - btnH / 2 - vh * 0.008

        if (selectedIndex !== null && mode !== 'take') {
          // 合成・深化は呼応の一文を持たないので、いま何が起きるのかを1行だけ添える（PHASE2.md §2.8）
          const summaryTop = bottomH * 0.06
          const f = mode === 'fuse' ? fuseOpts[selectedIndex] : null
          const t = new Text({
            text: f ? `${f.a.name} ＋ ${f.b.name} → ${f.def.name}` : `${deepOpts[selectedIndex].name} を深める`,
            style: { fill: 0x9a8968, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold', wordWrap: true, wordWrapWidth: vw - padX * 2, breakWords: true },
          })
          t.position.set(padX, summaryTop)
          bottomContainer.addChild(t)
        } else if (selectedIndex !== null) {
          // 呼応はカード側のアイコン併記だけで見せる（文章はここでも作らない。オーナー指示）。
          // ここは選択中の知見名だけを淡く添える（[D]）
          const opt = options[selectedIndex]
          const summaryTop = bottomH * 0.06
          const t = new Text({ text: opt.name, style: { fill: 0x9a8968, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' } })
          t.position.set(padX, summaryTop)
          bottomContainer.addChild(t)
        }

        const btn = new Container()
        if (enabled) {
          const btnBg = new Graphics()
          btnBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill(UI.wood).stroke({ width: 2.5, color: UI.brass })
          btn.addChild(btnBg)
        } else {
          // 無効状態は独自の線+塗り描画ではなく、共通の button_primary_disabled 素材へ統一
          const disabledTex = spriteTexture('button_primary_disabled')
          if (disabledTex) {
            const sp = new Sprite(disabledTex)
            sp.anchor.set(0.5)
            sp.width = btnW
            sp.height = btnH
            btn.addChild(sp)
          } else {
            const btnBg = new Graphics()
            btnBg.roundRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH * 0.3).fill({ color: 0x33291c, alpha: 0.75 }).stroke({ width: 2, color: 0x6b5f45 })
            btn.addChild(btnBg)
          }
        }
        // 無効時ラベルは「カードを選んで比較」ではなく「知見を選ぶ」とし、補助情報へ降格（P1-4コード変更欄）
        const btnLabel = new Text({
          text: enabled ? CONFIRM_LABEL[mode] : '知見を選ぶ',
          style: { fill: enabled ? UI.paper : 0x8a8270, fontSize: enabled ? fs(0.03) : fs(0.024), fontFamily: FONT, fontWeight: 'bold' },
        })
        btnLabel.anchor.set(0.5)
        btn.addChild(btnLabel)
        btn.position.set(vw / 2, btnY)
        if (enabled) {
          // 未選択時は無効化（タップ不可）＝「知見を選ぶ」のまま。選択後だけ確定できる（[D]）
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
          // P1-4：金の太枠ではなく「持ち上がり(scale1.018・y-4)＋真鍮クリップ＋朱印」の3点で示す
          tw.tween(c.scale, { x: on ? 1.018 : 1, y: on ? 1.018 : 1 }, 140, { ease: tw.easeOutBack })
          tw.tween(c, { y: on ? cardBaseY[idx] - 4 : cardBaseY[idx] }, 140, { ease: tw.easeOutBack })
        })
        renderBottom()
        // 所持ストリップとの双方向ハイライト（オーナー指示）。採るとき以外・未選択は消灯
        setStripHighlight(mode === 'take' && selectedIndex !== null ? connections[selectedIndex].connected.map((u) => u.id) : null)
      }

      // カード3枚は行為タブで中身が入れ替わるので、専用のホストへ描いて丸ごと作り直す。
      // カードごとに高さが変わる（正典§2：cardH = max(minH, 実測コンテンツ高+上下インセット)）ため、
      // 3枚の合計高が候補領域を超えたら cardHost をマスク＋ドラッグで縦スクロールにする（P0-7）
      const cardHost = new Container()
      panel.addChild(cardHost)
      const cardMask = new Graphics()
      panel.addChild(cardMask) // stripMaskと同じ作法：mask専用として使う限り、そのものは描画されない
      const cardsRegionBottom = bottomTop

      // 積み上げの間隔（正典§2「折返し・行数・カード高の決定順」4：標準8px→最小4pxの2段階だけ試す）
      const HEADER_GAP_STD = 8
      const HEADER_GAP_MIN = 4
      const FLOW_GAP = 4 // 本文→呼応→おまけ帯の固定間隔（正典§2「呼応行・おまけ帯」の積み上げ図どおり。スクロール廃止のため6→4）
      const BOTTOM_PAD = 4

      /** 見出し（最大2行）→本文（最大4行）→呼応/チップ→おまけ帯 の順に安全域内へ積み上げる。戻り値＝内容レイヤーと下端y */
      const buildCardContent = (view: DraftCardView, measurer: Text, zoneX0: number, zoneX1: number, zoneY0: number, headerGap: number): { layer: Container; bottomY: number } => {
        const layer = new Container()
        const textX = zoneX0 + cardIconSize + Math.max(12, fs(0.018)) // タイトルはアイコン右端+12px以上（P1-4）
        const headerWrapW = Math.max(20, zoneX1 - textX)
        const catT = new Text({ text: view.category, style: { fill: 0x8a6a3f, fontSize: fs(0.024), fontFamily: FONT, fontWeight: 'bold' } })
        catT.position.set(textX, zoneY0)
        layer.addChild(catT)
        const nameFont = fs(0.038) // 2026-08-15 オーナー「文字が枠に対して小さい」→ 見出しを一段大きく
        const nameLines = wrapLines(measurer, view.name, headerWrapW, 2, nameFont, true) // 見出し最大2行（正典§2手順3）
        const nameT = new Text({
          text: nameLines.join('\n'),
          style: { fill: UI.paperInk, fontSize: nameFont, fontFamily: FONT, fontWeight: 'bold', lineHeight: nameFont * 1.18 },
        })
        nameT.position.set(textX, zoneY0 + catT.height + 2)
        layer.addChild(nameT)
        let headerBlockH = catT.height + 2 + nameT.height
        // 合成の元2つ／深化まえの効果（PHASE2 §2.8）。見出しの直下に淡く1行だけ添える
        if (view.note) {
          const noteT = new Text({
            text: view.note,
            style: { fill: 0x8a6a3f, fontSize: fs(0.024), fontFamily: FONT, wordWrap: true, wordWrapWidth: headerWrapW, breakWords: true },
          })
          noteT.position.set(textX, zoneY0 + headerBlockH + 4)
          layer.addChild(noteT)
          headerBlockH += 4 + noteT.height
        }
        const icon = makeUniqueUpgradeIcon(view.iconId, cardIconSize)
        icon.position.set(zoneX0 + cardIconSize / 2, zoneY0 + cardIconSize / 2)
        layer.addChild(icon)

        // 起きること（三段の第二段）。descをカード幅いっぱいの1段落で流す。用語には点線下線＋「?」でリンクを張る（[C]）。
        // カード全体タップは選択トグルのみなので、用語タップは layoutRichText 側の stopPropagation で確実に分離する
        const bodyTop = zoneY0 + Math.max(cardIconSize, headerBlockH) + headerGap
        const bodyWrapW = Math.max(20, zoneX1 - zoneX0)
        const lineH = bodyFont * 1.36 // スクロール廃止（オーナー指摘）のため1.56→1.36へ詰めた（本文13px下限は維持）
        measurer.style.fontWeight = 'normal' // wrapLines(見出し)がboldへ変えているので、本文測定前に戻す
        const usedTerms = new Set<string>()
        const trial = new Container()
        const trialBottom = layoutRichText(trial, measurer, tokenizeRich(view.desc, usedTerms), zoneX0, bodyTop, bodyWrapW, bodyFont, UI.paperInk, 0x7a5a1e, openGlossaryTerm)
        let rowY: number
        if (trialBottom - bodyTop <= lineH * 4 + 0.5) {
          layer.addChild(trial) // 4行に収まった：用語リンク付きでそのまま採用
          rowY = trialBottom
        } else {
          // 4行を超える：正典§2「4行を超えるデータはカード用短縮文を別途用意」の暫定代替として、
          // 用語リンクは諦めプレーン4行+省略記号へ畳んで必ず収める（本文は13px未満へ縮めない）
          trial.destroy({ children: true })
          const lines = wrapLines(measurer, view.desc, bodyWrapW, 4, bodyFont, false)
          const bodyT = new Text({ text: lines.join('\n'), style: { fill: UI.paperInk, fontSize: bodyFont, fontFamily: FONT, lineHeight: lineH } })
          bodyT.position.set(zoneX0, bodyTop)
          layer.addChild(bodyT)
          rowY = bodyTop + lines.length * lineH
        }

        // 呼応（採るときのみ）／チップ（合成・深化の枠の動き）：バッジ。どちらか一方だけが存在する
        if (view.connectedIds && view.connectedIds.length) {
          rowY += FLOW_GAP
          rowY = drawConnectedIcons(layer, measurer, zoneX0, rowY, view.connectedIds, connIconSize, bodyWrapW)
        }
        if (view.chip) {
          rowY += FLOW_GAP
          rowY = drawConnectionChip(layer, zoneX0, rowY, bodyWrapW, view.chip, Math.max(10, fs(0.022)))
        }
        // 採録時のおまけ（starterDescありのみ・三段の第三段）：最小28px・1行・省略記号の帯
        if (view.bonus) {
          rowY += FLOW_GAP
          rowY = drawBonusBand(layer, measurer, zoneX0, rowY, bodyWrapW, view.bonus, Math.max(11, fs(0.019)))
        }
        return { layer, bottomY: rowY }
      }

      const renderCards = () => {
        cardHost.removeChildren().forEach((c) => c.destroy({ children: true }))
        cardHost.removeAllListeners() // 前回タブでのスクロールドラッグ購読を残さない
        cardContainers = []
        cardGlows = []
        cardBaseY = []
        // カード本文の用語リンク（[C]用語リンクの実装方針）：測定用Textは3枚で使い回し、生成後まとめて片付ける
        const cardMeasurer = new Text({ text: '', style: { fontFamily: FONT, fontSize: bodyFont } })
        const cardX0 = (vw - cardW) / 2
        let stackY = 0

        cardsFor(mode).forEach((view, i) => {
          // 紙型ごとの安全域（紙寸比→px）。紙は2:1固定描画（暫定実装5）なのでy側はnaturalH基準
          const ticketKey = TICKET_KEY[UPGRADE_CATEGORY[view.iconId]] ?? 'draft_ticket_relic'
          const ticketTex = spriteTexture(ticketKey)
          const zone = (ticketTex ? TICKET_SAFE_ZONE[ticketKey] : null) ?? TICKET_SAFE_ZONE_FALLBACK
          const zoneX0 = cardW * zone.x0
          const zoneX1 = cardW * zone.x1
          const zoneY0 = naturalH * zone.y0
          const zoneY1 = naturalH * zone.y1
          const bottomInset = naturalH - zoneY1

          let built = buildCardContent(view, cardMeasurer, zoneX0, zoneX1, zoneY0, HEADER_GAP_STD)
          if (built.bottomY > zoneY1) {
            const retry = buildCardContent(view, cardMeasurer, zoneX0, zoneX1, zoneY0, HEADER_GAP_MIN)
            built.layer.destroy({ children: true })
            built = retry
          }
          if (built.bottomY > zoneY1 && DEBUG_PLACE) {
            console.warn(`[yacho draft] 安全域超過: 「${view.name}」(${ticketKey}) 本文下端=${Math.round(built.bottomY)}px 安全域下端=${Math.round(zoneY1)}px → カード高を伸ばして吸収`)
          }
          const contentBottom = built.bottomY + BOTTOM_PAD
          const cardH = Math.max(minCardH, contentBottom + bottomInset) // 正典§2のcardH式（収まりきらないぶんだけ伸びる）

          const card = new Container()
          if (ticketTex) {
            // 正典§3.4「一様なクリーム角丸カードにしない」：紙の周囲に平坦な下地を敷かず、紙そのものを
            // カードの見た目にする。縦横を独立伸縮させず、常に2:1固定で描く（暫定実装5）
            const sp = new Sprite(ticketTex)
            sp.width = cardW
            // 実データが2:1へ収まらなかった分は、紙スプライト自体を最大12%だけ縦に伸ばして吸収する。
            // 有機的な紙のテクスチャではこの範囲の伸びは視認不能（実測のあふれは4〜8%）で、
            // 別素材の短冊を継ぎ足すと素材下辺の透過（紐の垂れ・破れで約2割）との間に隙間が生まれ
            // 「浮いた帯」に見える（オーナー実機QA）。12%超の稀なケースは呼応/おまけの畳み側が受ける
            sp.height = Math.min(cardH, naturalH * 1.18)
            card.addChild(sp)
          } else {
            // 素材のない生成紙（フォールバック）だけ、角丸紙面を描く（正典§3.4で使用可とされる唯一の例外）
            const bg = new Graphics()
            const radius = Math.min(8, naturalH * 0.04)
            bg.roundRect(0, 0, cardW, cardH, radius).fill({ color: UI.paper, alpha: 0.98 }).stroke({ width: 1, color: UI.ink, alpha: 0.25 })
            card.addChild(bg)
          }
          card.addChild(built.layer)
          cardContainers.push(card)

          // 選択マーク（採録候補の朱印）・「推」印は本文安全域を消費させず、紙の右マージン（zoneX1の外）へ置く。
          // マージンが足りない紙型（instrument等）では出さない＝「置けない場合は非表示」（正典§2「推印」）
          const marks = new Container()
          const clip = new Graphics()
          clip.roundRect(fs(0.014), -fs(0.012), fs(0.024), fs(0.05), fs(0.006)).fill(UI.brass).stroke({ width: 1, color: 0x6b4f22 })
          marks.addChild(clip)
          const stampMarginW = cardW - zoneX1
          const selR = Math.min(naturalH * 0.16, fs(0.06))
          const pushR = Math.max(9, fs(0.024))
          const canStamp = stampMarginW >= Math.max(selR, pushR) * 2 + 10
          if (canStamp) {
            const stampCx = zoneX1 + stampMarginW / 2
            const stamp = new Container()
            stamp.position.set(stampCx, zoneY0 + selR * 2 + 8)
            stamp.rotation = 0.14
            const sairokuSealTex = spriteTexture('seal_sairoku')
            if (sairokuSealTex) {
              const sp = new Sprite(sairokuSealTex)
              sp.anchor.set(0.5)
              sp.scale.set((selR * 2.1) / Math.max(sairokuSealTex.width, sairokuSealTex.height))
              stamp.addChild(sp)
            } else {
              const stampRing = new Graphics()
              stampRing.circle(0, 0, selR).stroke({ width: 2, color: UI.cinnabar, alpha: 0.85 })
              stamp.addChild(stampRing)
              const stampT = new Text({ text: '採録候補', style: { fill: UI.cinnabar, fontSize: selR * 0.42, fontFamily: FONT, fontWeight: 'bold' } })
              stampT.anchor.set(0.5)
              const stampFitW = selR * 1.6
              if (stampT.width > stampFitW) stampT.scale.set(stampFitW / stampT.width)
              stamp.addChild(stampT)
            }
            marks.addChild(stamp)
          }
          marks.visible = false
          card.addChild(marks)
          cardGlows.push(marks)

          // 「推」印（採るときだけ・呼応最多の1枚だけ）。y0は本文安全域のzoneY0ではなくTICKET_MARK_Y0を使う
          // （紙型によっては本文安全域より紙自体の上端が低い位置からしか始まらず、zoneY0だと印の上側が紙の外へはみ出す）
          if (canStamp && mode === 'take' && i === recommendedIndex) {
            const markY0 = naturalH * (TICKET_MARK_Y0[ticketKey] ?? zone.y0)
            const push = new Container()
            push.position.set(zoneX1 + stampMarginW / 2, markY0 + pushR)
            push.rotation = -0.1
            const suiSealTex = spriteTexture('seal_sui')
            if (suiSealTex) {
              const sp = new Sprite(suiSealTex)
              sp.anchor.set(0.5)
              sp.scale.set((pushR * 2.1) / Math.max(suiSealTex.width, suiSealTex.height))
              push.addChild(sp)
            } else {
              const pushG = new Graphics()
              pushG.circle(0, 0, pushR).stroke({ width: 1.5, color: UI.brass, alpha: 0.85 })
              push.addChild(pushG)
              const pushT = new Text({ text: '推', style: { fill: UI.brass, fontSize: pushR * 1.05, fontFamily: FONT, fontWeight: 'bold' } })
              pushT.anchor.set(0.5)
              push.addChild(pushT)
            }
            card.addChild(push)
          }

          // 最終防衛：カード自身の矩形でマスクし、計算のズレが残っても紙の外へは絶対に出さない（正典§2）
          const clipMask = new Graphics().rect(0, 0, cardW, cardH).fill(0xffffff)
          card.addChild(clipMask)
          card.mask = clipMask

          card.pivot.set(cardW / 2, cardH / 2) // 選択時の拡大が中心基準になるようpivotを中央に置く
          card.position.set(cardX0 + cardW / 2, stackY + cardH / 2)
          cardBaseY.push(card.position.y)
          card.eventMode = 'static'
          card.cursor = 'pointer'
          card.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= cardW && y >= 0 && y <= cardH }
          card.on('pointertap', () => selectCard(i))
          cardHost.addChild(card)
          stackY += cardH + cardGap
        })
        cardMeasurer.destroy()

        // 3枚（cardGap込み）の合計高が候補領域を超えたら、cardHostをマスク＋ドラッグで縦スクロール化する（最終安全弁。
        // 通常はcardH0がバンド高から逆算済みのため発動しない想定＝発動したらDEBUG_PLACEで知らせる）
        const totalH = cardContainers.length ? stackY - cardGap : 0
        const regionH = cardsRegionBottom - cardsRegionTop
        cardHost.position.set(0, cardsRegionTop)
        scrollActive = totalH > regionH
        lastTotalH = totalH
        lastRegionH = regionH
        if (scrollActive) {
          if (DEBUG_PLACE) console.warn(`[yacho draft] スクロール安全弁が発動: totalH=${Math.round(totalH)} regionH=${Math.round(regionH)} mode=${mode}`)
          cardMask.clear().rect(0, cardsRegionTop, vw, regionH).fill(0xffffff)
          cardHost.mask = cardMask
          const minY = cardsRegionTop - (totalH - regionH)
          const maxY = cardsRegionTop
          let dragStartY: number | null = null
          let dragStartHostY = 0
          cardHost.eventMode = 'static'
          cardHost.hitArea = {
            contains: (lx: number, ly: number) => {
              const screenY = cardHost.position.y + ly
              return lx >= 0 && lx <= vw && screenY >= cardsRegionTop && screenY <= cardsRegionBottom
            },
          }
          cardHost.on('pointerdown', (e) => {
            dragStartY = e.global.y
            dragStartHostY = cardHost.position.y
          })
          cardHost.on('pointermove', (e) => {
            if (dragStartY === null) return
            const dy = e.global.y - dragStartY
            cardHost.position.y = Math.max(minY, Math.min(maxY, dragStartHostY + dy))
          })
          const endCardDrag = () => {
            dragStartY = null
          }
          cardHost.on('pointerup', endCardDrag)
          cardHost.on('pointerupoutside', endCardDrag)
        } else {
          cardHost.mask = null
          cardHost.eventMode = 'passive'
        }
      }

      // ---- 行為タブ（3つ以上あるときだけ）：カードの中身を丸ごと差し替える ----
      const tabHost = new Container()
      panel.addChild(tabHost)
      const renderTabs = () => {
        if (!hasTabs) return
        tabHost.removeChildren().forEach((c) => c.destroy({ children: true }))
        const gap = 8
        const tabW = (cardW - gap * (modes.length - 1)) / modes.length
        const x0 = (vw - cardW) / 2
        modes.forEach((m, i) => {
          const on = m === mode
          const x = x0 + i * (tabW + gap)
          const g = new Graphics()
          g.roundRect(x, tabsY - tabH / 2, tabW, tabH, tabH * 0.3)
            .fill({ color: on ? UI.wood : 0x2a1c10, alpha: on ? 1 : 0.9 })
            .stroke({ width: on ? 2.5 : 2, color: on ? 0xf2d98a : UI.brass, alpha: on ? 0.95 : 0.7 })
          tabHost.addChild(g)
          const t = new Text({
            text: `${MODE_LABEL[m]} ${m === 'take' ? options.length : m === 'fuse' ? fuseOpts.length : deepOpts.length}`,
            style: { fill: on ? 0xf4e8cf : 0x9a8968, fontSize: fs(0.026), fontFamily: FONT, fontWeight: 'bold' },
          })
          t.anchor.set(0.5)
          t.position.set(x + tabW / 2, tabsY)
          tabHost.addChild(t)
          const hit = new Container()
          hit.eventMode = 'static'
          hit.cursor = 'pointer'
          hit.hitArea = { contains: (px: number, py: number) => px >= x && px <= x + tabW && py >= tabsY - tabH / 2 && py <= tabsY + tabH / 2 }
          hit.on('pointertap', () => {
            if (mode === m) return
            mode = m
            selectedIndex = null // 行為が変われば選び直し（別の行為の選択を持ち越さない）
            renderTabs()
            renderCards()
            renderBottom()
            setStripHighlight(null)
          })
          tabHost.addChild(hit)
        })
      }

      renderTabs()
      renderCards()
      renderBottom() // 初期状態＝未選択（[D]：未選択時はボタンが「カードを選んで比較」のまま無効化）
      // QA検証用フック（挙動には無関係）：3枚スクロール廃止の合否（totalH<=regionHか）を外部から読み、
      // pickFirstでスクリーンショット無しに次floorへ進められるようにする
      ;(window as unknown as Record<string, unknown>).__yachoDraftQA = {
        scrollActive: () => scrollActive,
        cardCount: () => cardContainers.length,
        sizes: () => ({ totalH: Math.round(lastTotalH), regionH: Math.round(lastRegionH), floor, hasTabs, mode }),
        pickFirst: () => {
          selectCard(0)
          confirmPick(0)
        },
      }
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

      // P2-2（§2.8/§4.3）：ui_panel（重い木枠）を result_report_v6（薄い革の携行フォルダ＋紙）へ交換。
      // 高さ優先（phは最大vh*0.84）で確保し、幅で収まらなければ幅基準へ折り返す
      const panelTex = spriteTexture('result_report_v6') ?? spriteTexture('ui_panel') ?? spriteTexture('ui_parchment')
      let ph = vh * 0.84
      let pw = panelTex ? (ph / panelTex.height) * panelTex.width : vh * 0.7 * 0.68
      if (pw > vw * 0.94) {
        pw = vw * 0.94
        ph = panelTex ? (pw / panelTex.width) * panelTex.height : ph
      }
      const px0 = (vw - pw) / 2
      const py0 = Math.max(vh * 0.02, (vh - ph) / 2)
      if (panelTex) {
        const sp = new Sprite(panelTex)
        sp.width = pw
        sp.height = ph
        sp.position.set(px0, py0)
        panel.addChild(sp)
      } else {
        const g = new Graphics()
        g.roundRect(px0, py0, pw, ph, pw * 0.02).fill({ color: UI.paper, alpha: 0.97 }).stroke({ width: 2, color: UI.leather })
        panel.addChild(g)
      }
      // 紙面の安全域（左の革台紙・右の紐タブを避ける。result_report_v6の実測比率）
      const bx0 = px0 + pw * 0.17
      const bx1 = px0 + pw * 0.87
      const contentW = bx1 - bx0

      // この画面専用の文字階層（§3.6の実機サイズ表に沿う）
      const SZ = {
        headline: Math.max(26, Math.min(30, fs(0.075))),
        title: Math.max(18, Math.min(20, fs(0.05))),
        cardName: Math.max(16, Math.min(18, fs(0.044))),
        body: Math.max(13, Math.min(14, fs(0.035))),
        meta: Math.max(11, Math.min(12, fs(0.03))),
        micro: Math.max(10, Math.min(11, fs(0.027))),
      }
      const fitText = (t: Text, maxW: number) => {
        if (t.width > maxW) t.scale.set(maxW / t.width)
      }

      let y = py0 + ph * 0.06

      // 1) 結果印：短い墨／朱の押印（§2.8最終階層①。見出しは中央揃え可＝§3.6）
      const stampText = victory ? '全深度　踏破' : `深度${reached}　まで`
      const stampColor = victory ? UI.cinnabar : UI.ink
      const stampT = new Text({
        text: stampText,
        style: { fill: stampColor, fontSize: SZ.headline, fontFamily: FONT, fontWeight: '800', letterSpacing: SZ.headline * 0.08 },
      })
      stampT.anchor.set(0.5)
      const stampPadX = SZ.headline * 0.55
      const stampPadY = SZ.headline * 0.3
      const stampW = stampT.width + stampPadX * 2
      const stampH = stampT.height + stampPadY * 2
      const stampBg = new Graphics()
      stampBg.roundRect(-stampW / 2, -stampH / 2, stampW, stampH, stampH * 0.16).stroke({ width: 2.2, color: stampColor, alpha: 0.8 })
      stampBg.roundRect(-stampW / 2 + 4, -stampH / 2 + 4, stampW - 8, stampH - 8, stampH * 0.1).stroke({ width: 1, color: stampColor, alpha: 0.45 })
      const stampC = new Container()
      stampC.addChild(stampBg, stampT)
      stampC.rotation = victory ? -0.025 : 0.02
      stampC.position.set(vw / 2, y + stampH / 2)
      panel.addChild(stampC)
      y += stampH + fs(0.016)

      // 2) ラン名（画面タイトル。§2.8最終階層②）
      const nameT = new Text({
        text: name,
        style: { fill: UI.ink, fontSize: SZ.title, fontFamily: FONT, fontWeight: '800', align: 'center', wordWrap: true, wordWrapWidth: contentW * 0.94, breakWords: true },
      })
      nameT.anchor.set(0.5, 0)
      nameT.position.set(vw / 2, y)
      panel.addChild(nameT)
      y += nameT.height + fs(0.018)

      // 3) 主役知見：大アイコン＋名称＋発火回数を上半分へ（§2.8最終階層③。旧実装はグラフ下にあり発見が遅かった）
      const owned = run.upgrades.map((id) => UPGRADES.find((u) => u.id === id)).filter((u): u is UpgradeDef => !!u)
      let heroDef: UpgradeDef | undefined
      let bestFires = 0
      if (owned.length > 0) {
        let bestId = owned[0].id
        for (const def of owned) {
          const c = upgradeFireCount.get(def.id) ?? 0
          if (c > bestFires) {
            bestFires = c
            bestId = def.id
          }
        }
        heroDef = owned.find((u) => u.id === bestId)
      }
      if (heroDef) {
        const capLine = bestFires > 0 ? '最も働いた知見' : 'この探窟の起点'
        const cap = new Text({ text: capLine, style: { fill: UI.ink, fontSize: SZ.meta, fontFamily: FONT, fontWeight: '600' } })
        cap.anchor.set(0.5, 0)
        cap.alpha = 0.75
        cap.position.set(vw / 2, y)
        fitText(cap, contentW * 0.7)
        panel.addChild(cap)
        y += cap.height + fs(0.008)

        const heroR = Math.max(fs(0.048), Math.min(fs(0.09), contentW * 0.15))
        const heroNode = new Container()
        const heroBg = new Graphics()
        heroBg.circle(0, 0, heroR).fill({ color: 0x241a10, alpha: 0.94 }).stroke({ width: Math.max(2, fs(0.005)), color: UI.brassBright, alpha: 0.95 })
        heroNode.addChild(heroBg)
        heroNode.addChild(makeUniqueUpgradeIcon(heroDef.id, heroR * 1.3))
        heroNode.position.set(vw / 2, y + heroR)
        panel.addChild(heroNode)
        y += heroR * 2 + fs(0.008)

        const heroName = new Text({ text: heroDef.name, style: { fill: UI.ink, fontSize: SZ.cardName, fontFamily: FONT, fontWeight: '800' } })
        heroName.anchor.set(0.5, 0)
        heroName.position.set(vw / 2, y)
        fitText(heroName, contentW * 0.9)
        panel.addChild(heroName)
        y += heroName.height

        if (bestFires > 0) {
          const fireT = new Text({ text: `発火 ${bestFires}回`, style: { fill: UI.ink, fontSize: SZ.meta, fontFamily: FONT, fontWeight: '600' } })
          fireT.anchor.set(0.5, 0)
          fireT.alpha = 0.8
          fireT.position.set(vw / 2, y + fs(0.004))
          fitText(fireT, contentW * 0.7)
          panel.addChild(fireT)
          y += fireT.height + fs(0.004)
        }
        y += fs(0.018)
      }

      // 4) 主要記録：最大発火／最大連鎖／最大破壊を横3列（§2.8最終階層④）
      const recordCols = [
        { label: '1手の最大発火', value: String(run.records.maxFiresInOneMove) },
        { label: '最大連鎖', value: String(run.records.maxChain) },
        { label: '1手の最大破壊', value: String(run.records.maxDestroyed) },
      ]
      const colW = contentW / 3
      let recordsBottom = y
      recordCols.forEach((c, i) => {
        const cx = bx0 + colW * i + colW / 2
        const lab = new Text({ text: c.label, style: { fill: UI.ink, fontSize: SZ.micro, fontFamily: FONT, fontWeight: '600' } })
        lab.anchor.set(0.5, 0)
        lab.alpha = 0.72
        lab.position.set(cx, y)
        if (lab.width > colW * 0.94) lab.scale.set((colW * 0.94) / lab.width)
        panel.addChild(lab)
        const val = new Text({ text: c.value, style: { fill: UI.ink, fontSize: SZ.cardName, fontFamily: FONT, fontWeight: '800' } })
        val.anchor.set(0.5, 0)
        val.position.set(cx, y + lab.height + fs(0.004))
        panel.addChild(val)
        recordsBottom = Math.max(recordsBottom, val.position.y + val.height)
      })
      y = recordsBottom + fs(0.02)

      // 5) 灯の推移（折れ線）：横幅pw*0.72・高さfs(0.085)前後＝旧比おおよそ1.35倍・1.6倍（§4.3 P2-2）
      const chartTop = y
      let chartBottom = y
      if (lightSeries.length >= 2) {
        const first = lightSeries[0].floor
        const last = lightSeries[lightSeries.length - 1].floor
        const tickStyle = { fill: UI.ink, fontSize: SZ.micro, fontFamily: FONT, fontWeight: '600' as const }
        const cap = new Text({ text: `層を出るときの灯　深度${first}〜${last}`, style: { ...tickStyle, fontSize: SZ.meta } })
        cap.anchor.set(0.5, 0)
        cap.alpha = 0.8
        cap.position.set(vw / 2, chartTop)
        panel.addChild(cap)

        const plotW = pw * 0.72
        const plotX0 = (vw - plotW) / 2 + fs(0.02) // 左のy目盛ぶんだけ作図域を右へ寄せて、全体を紙面の中央に置く
        const plotTop = chartTop + cap.height + fs(0.01)
        const plotH = fs(0.085)
        const top = Math.max(...lightSeries.map((s) => s.light), 1)
        const px = (i: number) => plotX0 + (plotW * i) / (lightSeries.length - 1)
        const py = (v: number) => plotTop + plotH * (1 - v / top)

        const g = new Graphics()
        g.moveTo(plotX0, plotTop).lineTo(plotX0 + plotW, plotTop).stroke({ width: 1, color: UI.ink, alpha: 0.22 })
        g.moveTo(plotX0, plotTop + plotH).lineTo(plotX0 + plotW, plotTop + plotH).stroke({ width: 1, color: UI.ink, alpha: 0.4 })
        lightSeries.forEach((s, i) => (i === 0 ? g.moveTo(px(i), py(s.light)) : g.lineTo(px(i), py(s.light))))
        g.stroke({ width: Math.max(2, fs(0.006)), color: UI.amber }) // 灯の線は正典パレットの琥珀色に統一（§3.2）
        lightSeries.forEach((s, i) => g.circle(px(i), py(s.light), Math.max(1.8, fs(0.005))).fill(UI.amber))
        const thin = thinningFloor(lightSeries)
        const ti = thin === null ? -1 : lightSeries.findIndex((s) => s.floor === thin)
        if (ti >= 0) g.circle(px(ti), py(lightSeries[ti].light), Math.max(4, fs(0.012))).stroke({ width: Math.max(2, fs(0.005)), color: 0x9c3b2c })
        panel.addChild(g)

        for (const [v, vy] of [
          [top, plotTop],
          [0, plotTop + plotH],
        ]) {
          const t = new Text({ text: String(v), style: tickStyle })
          t.anchor.set(1, 0.5)
          t.alpha = 0.6
          // 右揃えのまま紙の左端(bx0)より内側に収める（食い込み対策）
          t.position.set(Math.max(bx0 + t.width, plotX0 - fs(0.012)), vy)
          panel.addChild(t)
        }
        chartBottom = plotTop + plotH + fs(0.014)
      }
      y = chartBottom

      // 6) 振り返り：最大3行・左揃え（§2.8最終階層⑥。本文は13px未満にしない＝§3.6必達）
      const pm = buildPostmortem(lightSeries, drainLog, run.upgrades)
      const pmAll = [...pm.light, ...(pm.missing ? [pm.missing.title, ...pm.missing.lines] : [])]
      const pmLines = pmAll.slice(0, 3)
      const pmTop = y + fs(0.016)
      let pmBottom = y
      // 呼応図が紙面下半分を確保できるよう、振り返りはそこへ食い込む前で打ち切る（最低1件は出す＝存在しない場合は行ごと消す作法）
      const pmBudgetBottom = py0 + ph * 0.5 - fs(0.02)
      if (pmLines.length) {
        // 行によっては折り返して2行以上になる（あと一つ理由文など）。固定行高だと折り返し分が次の行と重なるため、
        // 実測した高さぶんだけ次の行へ進める（本ファイル内の他の動的レイアウトと同じ作法）
        let cy = pmTop
        for (let i = 0; i < pmLines.length; i++) {
          const t = new Text({
            text: pmLines[i],
            style: { fill: UI.ink, fontSize: SZ.body, fontFamily: FONT, fontWeight: '600', wordWrap: true, wordWrapWidth: contentW, breakWords: true, lineHeight: SZ.body * 1.4 },
          })
          if (i > 0 && cy + t.height > pmBudgetBottom) {
            t.destroy()
            break
          }
          t.alpha = i === 0 ? 1 : 0.86
          t.position.set(bx0, cy)
          panel.addChild(t)
          cy += t.height + SZ.body * 0.35
        }
        pmBottom = cy
      }
      y = pmBottom

      // 7)+8) 呼応図／その他の所持知見：紙面下半分へ独立させる（§2.8最終階層⑦⑧）。
      //      アイコンは最低24px径を確保し、収まらなければ横スクロールへ（縮め続けない）
      const buttonY = py0 + ph * 0.955
      const btnHalfH = Math.round(Math.min(60, Math.max(52, vw * 0.148))) / 2 // makePrimaryButtonと同じ高さ計算
      const graphTop = Math.max(y + fs(0.02), py0 + ph * 0.5)
      // ノードの半径ぶん（最大fs(0.05)）を見込んでボタンの上に食い込ませない
      const graphBottom = buttonY - btnHalfH - fs(0.05) - fs(0.015)
      const graphH = Math.max(fs(0.16), graphBottom - graphTop)
      if (owned.length > 0) {
        const graphLabel = new Text({ text: '知見の呼応', style: { fill: UI.ink, fontSize: SZ.meta, fontFamily: FONT, fontWeight: '800' } })
        graphLabel.anchor.set(0.5, 0)
        graphLabel.position.set(vw / 2, graphTop)
        panel.addChild(graphLabel)

        const n = owned.length
        const rowY = graphBottom
        const minIconR = 12 // §4.3 P2-2：知見アイコンの径は最低24px
        const idealR = Math.min(fs(0.05), contentW / (n * 2.4))
        const iconR = Math.max(minIconR, idealR)
        const rowW = n * iconR * 2.4
        const needsScroll = rowW > contentW
        const nodeX = (i: number) => (n > 1 ? iconR * 1.2 + (i * (rowW - iconR * 2.4)) / (n - 1) : rowW / 2)

        const rowHost = new Container()
        rowHost.position.set(needsScroll ? bx0 : vw / 2 - rowW / 2, 0)
        if (needsScroll) {
          const maskH = graphBottom - graphTop + iconR * 1.3
          const mask = new Graphics()
          mask.rect(bx0, graphTop, contentW, maskH).fill(0xffffff)
          panel.addChild(mask)
          rowHost.mask = mask
          rowHost.eventMode = 'static'
          rowHost.hitArea = { contains: (x: number, y2: number) => x >= -4 && x <= rowW + 4 && y2 >= graphTop - 4 && y2 <= graphTop + maskH + 4 }
          const minX = contentW - rowW
          let dragStartX: number | null = null
          let dragStartHostX = 0
          rowHost.on('pointerdown', (e) => {
            dragStartX = e.global.x
            dragStartHostX = rowHost.position.x
          })
          rowHost.on('pointermove', (e) => {
            if (dragStartX === null) return
            const dx = e.global.x - dragStartX
            rowHost.position.x = Math.max(bx0 + minX, Math.min(bx0, dragStartHostX + dx))
          })
          const endDrag = () => (dragStartX = null)
          rowHost.on('pointerup', endDrag)
          rowHost.on('pointerupoutside', endDrag)
        }
        panel.addChild(rowHost)

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
        rowHost.addChild(lineLayer)
        for (const e of edges) {
          const inLoop = reach[e.to][e.from]
          const x1 = nodeX(e.from)
          const x2 = nodeX(e.to)
          const arc = Math.min(graphH * 0.4, Math.max(iconR * 1.8, Math.abs(x2 - x1) * 0.32 + fs(0.02)))
          const midX = (x1 + x2) / 2
          const g = new Graphics()
          g.moveTo(x1, rowY).quadraticCurveTo(midX, rowY - arc, x2, rowY)
          if (inLoop) g.stroke({ width: Math.max(2, fs(0.006)), color: 0xf2c14e, alpha: 0.85 })
          else g.stroke({ width: Math.max(1, fs(0.003)), color: UI.brass, alpha: 0.45 })
          lineLayer.addChild(g)
        }

        owned.forEach((def, i) => {
          const node = new Container()
          const isHero = def.id === heroDef?.id
          const bg = new Graphics()
          bg.circle(0, 0, iconR).fill({ color: 0x241a10, alpha: 0.92 }).stroke({ width: isHero ? 2.4 : 1.5, color: isHero ? 0xf2c14e : UI.brass, alpha: 0.9 })
          node.addChild(bg)
          node.addChild(makeUniqueUpgradeIcon(def.id, iconR * 1.3))
          node.position.set(nodeX(i), rowY)
          rowHost.addChild(node)
        })
      }

      // 9) もういちど（共通主要ボタン。§2.8最終階層⑨）
      const btn = makePrimaryButton('もう一度潜る', pw * 0.6)
      btn.position.set(vw / 2, buttonY)
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
      // 採録画面の行為タブ（PHASE2 §2.8）の検品用：いま合成・深化がいくつ出るか
      draftActions: () =>
        PHASE28_ENABLED ? { fuse: fusionOptions(run.upgrades).length, deepen: deepenOptions(run).length } : { fuse: 0, deepen: 0 },
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
      /** QA専用：祝福パネルを直接開く（深度10まで自動で進める検証は不安定なため） */
      openBlessing: () => showBlessingPanel(() => {}),
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
          runState.oxygen = Math.min(n, runState.lampMax) // QA用でも器の不変条件（oxygen ≦ lampMax）は守る
          refreshFloorHud()
        }
      },
      // QA専用（?debug時のみ有効。DEBUG_PLACEと同じゲート）：深層でしか出ない原生種を直接出現させ、生成アートの実プレイ確認をしやすくする
      debugSpawnEnemy: (kind: EnemyKind) => {
        if (!DEBUG_PLACE || inputLocked) return
        const cells: XY[] = kind === 'maw' ? [{ x: 3, y: H - 1 }, { x: 4, y: H - 1 }] : [{ x: 4, y: 4 }]
        for (const p of cells) {
          const c = board.at(p.x, p.y)
          if (c) {
            c.piece = null
            c.block = null
          }
        }
        board.spawnEnemy(kind, cells)
        view.renderStable()
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
