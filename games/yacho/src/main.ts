// 『そろえて、しるす。』ローグライク・エントリ。拠点（旧・縦断面図マップ流用）⇄ 層プレイの2シーン構成。
// ROGUE.md 準拠（第3弾b＝ラン進行の実装）。旧30レベル制の画面遷移は廃止。
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS30 as LEVELS } from './core/levels30'
import { createRunState, type RunState } from './core/run'
import { FLOORS } from './core/floors'
import { UPGRADES, type UpgradeDef } from './core/upgrades'
import { buildRunName, UPGRADE_CATEGORY } from './core/runname'
import { makeRng, randInt, type Rng } from './core/rng'
import { BoardView } from './view/BoardView'
import { PAL, loadSprites, spriteTexture, themeForLevel } from './view/pieces'
import { loadSave, type SaveData } from './core/save'
import type { BoardEvent, LevelDef } from './core/types'
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
  let sceneEpoch = 0 // シーン再構築の世代。跨いだ遅延コールバックは無効化

  const draftRng = (floor: number): Rng => makeRng((runSeed + floor * 104729 + 17) | 0)

  const startRun = () => {
    runState = createRunState()
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

    // 4帯レイアウト（AD v3.1流用）: HUD帯(〜0.20) / キャラ帯(0.20〜0.35) / 盤(0.35〜0.78) / ブースター帯(〜0.90)
    const boardSize = Math.min(vw * 0.9, vh * 0.48)
    view = new BoardView(board, app.renderer, boardSize)
    const bw = view.S * W
    const boardTop = vh * 0.35
    view.root.position.set((vw - bw) / 2, boardTop)
    playRoot.addChild(view.root)

    // ---------- 探窟家バスト ----------
    const bustTex = spriteTexture(`bust_${theme}`)
    if (bustTex) {
      const bust = new Sprite(bustTex)
      bust.anchor.set(0.5, 1)
      const bh = vh * 0.19 // キャラ帯（0.20〜0.35vh）に顔全体が収まる
      bust.scale.set(bh / bustTex.height)
      bust.position.set(vw * 0.5, boardTop + vh * 0.01)
      playRoot.addChildAt(bust, playRoot.getChildIndex(view.root))
    }

    // ---------- HUD ----------
    const ui = new Container()
    playRoot.addChild(ui)

    // 探窟隊HP（左上メダリオン。旧「のこりメダリオン」を差し替え。ROGUE.md §5）
    const badgeW = vw * 0.16
    const plaqueTex = spriteTexture('ui_moves')
    let badgeH = badgeW
    if (plaqueTex) {
      const sp = new Sprite(plaqueTex)
      sp.width = badgeW
      sp.height = (badgeW / plaqueTex.width) * plaqueTex.height
      badgeH = sp.height
      sp.position.set(vw * 0.035, vh * 0.022)
      ui.addChild(sp)
    }
    const hpText = new Text({
      text: '',
      style: { fill: 0xe5d8bb, fontSize: fs(0.064), fontFamily: FONT, fontWeight: 'bold' },
    })
    hpText.anchor.set(0.5)
    hpText.position.set(vw * 0.035 + badgeW / 2, vh * 0.022 + badgeH * 0.58)
    ui.addChild(hpText)

    // スコアバッジ（現状のまま）
    const scoreBadgeTex = spriteTexture('ui_score')
    const sbW = vw * 0.24
    let sbH = sbW * 0.39
    const sbX = vw * 0.02
    const sbY = vh * 0.145
    if (scoreBadgeTex) {
      const sp = new Sprite(scoreBadgeTex)
      sp.width = sbW
      sp.height = (sbW / scoreBadgeTex.width) * scoreBadgeTex.height
      sbH = sp.height
      sp.position.set(sbX, sbY)
      ui.addChild(sp)
    }
    const scoreText = new Text({
      text: '',
      style: { fill: 0xe5d8bb, fontSize: fs(0.031), fontFamily: FONT, fontWeight: 'bold' },
    })
    scoreText.anchor.set(1, 0.5)
    scoreText.position.set(sbX + sbW * 0.88, sbY + sbH * 0.5)
    ui.addChild(scoreText)

    // 歯車（ミュート）と戻る（現状のまま。戻る=ラン放棄で拠点へ）
    const gearTex = spriteTexture('ui_gear')
    const gr = vw * 0.042
    const hitR = Math.max(gr, 22) // 最低44px相当のタップ領域
    let gear: Container
    if (gearTex) {
      const sp = new Sprite(gearTex)
      sp.anchor.set(0.5)
      sp.scale.set((gr * 2) / Math.max(gearTex.width, gearTex.height))
      gear = sp
    } else {
      const g = new Graphics()
      g.circle(0, 0, gr).fill(UI.wood).stroke({ width: 3, color: UI.brass })
      gear = g
    }
    gear.position.set(vw * 0.935, vh * 0.03 + gr)
    gear.eventMode = 'static'
    gear.cursor = 'pointer'
    gear.hitArea = { contains: (x: number, y: number) => x * x + y * y <= hitR * hitR }
    gear.alpha = isMuted() ? 0.45 : 1
    gear.on('pointertap', () => {
      gear.alpha = toggleMute() ? 0.45 : 1
    })
    ui.addChild(gear)

    const backTex = spriteTexture('ui_back')
    let back: Container
    if (backTex) {
      const sp = new Sprite(backTex)
      sp.anchor.set(0.5)
      sp.scale.set((gr * 2) / Math.max(backTex.width, backTex.height))
      back = sp
    } else {
      const g = new Graphics()
      g.circle(0, 0, gr).fill(UI.wood).stroke({ width: 2, color: UI.brass })
      back = g
    }
    back.position.set(vw * 0.935, vh * 0.03 + gr * 3.45)
    back.eventMode = 'static'
    back.cursor = 'pointer'
    back.hitArea = { contains: (x: number, y: number) => x * x + y * y <= hitR * hitR }
    back.on('pointertap', () => showMap())
    ui.addChild(back)

    // 残り敵数（画面中央上・旧ターゲット札を差し替え。ROGUE.md §5）
    const tpW = vw * 0.42
    const tpTex = spriteTexture('ui_target')
    const tpH = tpTex ? (tpW / tpTex.width) * tpTex.height : badgeH
    const tp = new Container()
    if (tpTex) {
      const sp = new Sprite(tpTex)
      sp.width = tpW
      sp.height = tpH
      tp.addChild(sp)
    }
    tp.position.set((vw - tpW) / 2, vh * 0.025)
    ui.addChild(tp)

    const enemyRow = new Container()
    const enemyIconTex = spriteTexture('kokeishi')
    if (enemyIconTex) {
      const sp = new Sprite(enemyIconTex)
      sp.anchor.set(0.5)
      sp.scale.set((tpH * 0.32) / Math.max(sp.texture.width, sp.texture.height))
      sp.position.set(-tpW * 0.05, 0)
      enemyRow.addChild(sp)
    }
    const enemyCountText = new Text({
      text: '',
      style: { fill: UI.paperInk, fontSize: fs(0.048), fontFamily: FONT, fontWeight: 'bold' },
    })
    enemyCountText.anchor.set(0, 0.5)
    enemyCountText.position.set(tpW * 0.02, 0)
    enemyRow.addChild(enemyCountText)
    enemyRow.position.set(tpW * 0.5, tpH * 0.58)
    tp.addChild(enemyRow)

    const refreshFloorHud = () => {
      hpText.text = String(Math.max(0, run.playerHp))
      scoreText.text = board.score.toLocaleString()
      enemyCountText.text = String(board.enemies.length)
    }
    refreshFloorHud()
    const flashHp = () => {
      hpText.style.fill = 0xff6b5a
      tw.tween(hpText.scale, { x: 1.3, y: 1.3 }, 90, { onDone: () => tw.tween(hpText.scale, { x: 1, y: 1 }, 140) })
      tw.delay(260, () => {
        if (!hpText.destroyed) hpText.style.fill = 0xe5d8bb
      })
    }
    /** プレイヤー被弾の実況：画面縁の赤ビネット短フラッシュ＋HPメダリオンから「-N」が落ちる（ROGUE.md 可視化第一波③） */
    const hpDamageFx = (amount: number) => {
      const vignette = new Graphics()
      vignette.rect(0, 0, vw, vh).stroke({ width: vw * 0.05, color: 0xd6432f, alpha: 1 })
      vignette.alpha = 0
      playRoot.addChild(vignette)
      tw.tween(vignette, { alpha: 0.6 }, 90, {
        onDone: () =>
          tw.tween(vignette, { alpha: 0 }, 260, {
            onDone: () => {
              if (!vignette.destroyed) vignette.destroy()
            },
          }),
      })
      const dmgT = new Text({
        text: `-${amount}`,
        style: { fill: 0xff6b5a, fontSize: fs(0.05), fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1208, width: 3 } },
      })
      dmgT.anchor.set(0.5)
      dmgT.position.set(hpText.position.x, hpText.position.y)
      ui.addChild(dmgT)
      tw.tween(dmgT.position, { y: dmgT.position.y + fs(0.09) }, 500, { ease: tw.easeInCubic })
      tw.tween(dmgT, { alpha: 0 }, 380, {
        delay: 150,
        onDone: () => {
          if (!dmgT.destroyed) dmgT.destroy()
        },
      })
    }

    // 所持強化バー（旧ブースター4枠の装飾を、取得済み強化のアイコン列に差し替え。ROGUE.md 可視化第一波②）
    const boosterBar = new Container()
    const upgradeIconG = new Map<string, Container>()
    const UPGRADE_ICON_MAX = 10 // ROGUE.md §4：層1〜9クリアで最大9回ドラフト（安全側の上限）
    const ownedUpgrades = run.upgrades.slice(0, UPGRADE_ICON_MAX)
    const iconSpacing = Math.min(vw * 0.19, (vw * 0.86) / Math.max(1, ownedUpgrades.length))
    const iconR = Math.min(vw * 0.055, iconSpacing * 0.4)
    let upgradePopup: Container | null = null
    const showUpgradePopup = (def: UpgradeDef) => {
      if (upgradePopup && !upgradePopup.destroyed) upgradePopup.destroy()
      const w = vw * 0.72
      const nameT = new Text({ text: def.name, style: { fill: UI.paperInk, fontSize: fs(0.036), fontFamily: FONT, fontWeight: 'bold' } })
      const descT = new Text({
        text: def.desc,
        style: { fill: UI.paperInk, fontSize: fs(0.024), fontFamily: FONT, wordWrap: true, wordWrapWidth: w * 0.88, breakWords: true },
      })
      const padY = vh * 0.014
      const h = fs(0.05) + descT.height + padY * 3
      const box = new Container()
      const ptex = spriteTexture('ui_parchment')
      if (ptex) {
        const sp = new Sprite(ptex)
        sp.width = w
        sp.height = h
        box.addChild(sp)
      } else {
        const bg = new Graphics()
        bg.roundRect(0, 0, w, h, 12).fill(UI.paper)
        box.addChild(bg)
      }
      nameT.position.set(w * 0.06, padY)
      descT.position.set(w * 0.06, fs(0.05) + padY)
      box.addChild(nameT, descT)
      box.position.set((vw - w) / 2, boosterBar.position.y - h - vh * 0.012)
      box.alpha = 0
      ui.addChild(box)
      upgradePopup = box
      tw.tween(box, { alpha: 1 }, 140)
      tw.delay(2500, () => {
        if (!alive() || box.destroyed) return
        tw.tween(box, { alpha: 0 }, 220, {
          onDone: () => {
            if (!box.destroyed) box.destroy()
          },
        })
      })
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
      m.on('pointertap', () => showUpgradePopup(def))
      m.position.set(vw / 2 + (i - (ownedUpgrades.length - 1) / 2) * iconSpacing, 0)
      boosterBar.addChild(m)
      upgradeIconG.set(id, m)
    })
    boosterBar.position.set(0, boardTop + view.S * H + Math.min(vw * 0.1, vh * 0.05))
    ui.addChild(boosterBar)

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
    view.onUpgradeFire = (id) => bounceUpgradeIcon(id)

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
      for (const e of evs) {
        if (e.t === 'poison-triggered') {
          flashHp()
          hpDamageFx(1)
        } else if (e.t === 'boss-slam') {
          flashHp()
          hpDamageFx(e.damage)
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

    // ドラフト3択：羊皮紙カード3枚（ROGUE.md §4/§8）
    const showDraftPanel = () => {
      const options = pickDraftOptions(run.upgrades, draftRng(floor))
      const panel = new Container()
      const dimG = new Graphics()
      dimG.rect(0, 0, vw, vh).fill({ color: 0x0f0a06, alpha: 0.55 })
      panel.addChild(dimG)
      const title = new Text({
        text: 'そなえを ひとつ えらぶ',
        style: { fill: 0xf4e8cf, fontSize: fs(0.044), fontFamily: FONT, fontWeight: 'bold' },
      })
      title.anchor.set(0.5)
      title.position.set(vw / 2, vh * 0.1)
      panel.addChild(title)
      const cardW = vw * 0.86
      const cardTex = spriteTexture('ui_parchment')
      const cardH = cardTex ? Math.min(vh * 0.2, (cardW / cardTex.width) * cardTex.height) : vh * 0.18
      const gap = vh * 0.025
      const top = vh * 0.16
      options.forEach((opt, i) => {
        const card = new Container()
        const cy = top + i * (cardH + gap)
        if (cardTex) {
          const sp = new Sprite(cardTex)
          sp.width = cardW
          sp.height = cardH
          card.addChild(sp)
        } else {
          const g = new Graphics()
          g.roundRect(0, 0, cardW, cardH, 14).fill(UI.paper)
          card.addChild(g)
        }
        const name = new Text({
          text: opt.name,
          style: { fill: UI.paperInk, fontSize: fs(0.038), fontFamily: FONT, fontWeight: 'bold' },
        })
        name.position.set(cardW * 0.08, cardH * 0.16)
        card.addChild(name)
        const desc = new Text({
          text: opt.desc,
          style: { fill: UI.paperInk, fontSize: fs(0.024), fontFamily: FONT, wordWrap: true, wordWrapWidth: cardW * 0.84, breakWords: true },
        })
        desc.position.set(cardW * 0.08, cardH * 0.44)
        card.addChild(desc)
        card.position.set((vw - cardW) / 2, cy)
        card.eventMode = 'static'
        card.cursor = 'pointer'
        card.hitArea = { contains: (x: number, y: number) => x >= 0 && x <= cardW && y >= 0 && y <= cardH }
        card.on('pointertap', () => {
          run.upgrades.push(opt.id)
          const next = floor + 1
          playRoot.removeAllListeners()
          playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
          buildFloorScene(next)
          ensureBgm(themeFloorId(next))
        })
        panel.addChild(card)
      })
      playRoot.addChild(panel)
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
