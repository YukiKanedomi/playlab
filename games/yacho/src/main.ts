// 『そろえて、しるす。』エントリ。マップ（縦断面図）⇄ プレイの2シーン構成。
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS30 as LEVELS } from './core/levels30'
import { BoardView } from './view/BoardView'
import { PAL, loadSprites, pieceTexture, spriteTexture, themeForLevel } from './view/pieces'
import { loadSave, persistSave, clearReward, EXTRA_MOVES, EXTRA_MOVES_COST, type SaveData } from './core/save'
import type { Goal } from './core/types'
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

const app = new Application()

async function boot() {
  await app.init({ background: PAL.boardBg, resizeTo: window, antialias: true, resolution: Math.min(2, devicePixelRatio) })
  document.getElementById('app')!.appendChild(app.canvas)
  await loadSprites()

  const vw = app.screen.width
  const vh = app.screen.height
  const fs = (r: number) => Math.round(vw * r)
  const save: SaveData = loadSave()

  const mapRoot = new Container()
  const playRoot = new Container()
  app.stage.addChild(mapRoot, playRoot)

  let bgmStarted = false
  const ensureBgm = (themeId: number) => {
    if (bgmStarted) startBgm(themeForLevel(themeId))
  }

  // =============== マップシーン（縦断面図） ===============
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

    // レベルノード（上=浅い→下=深い）
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
        style: { fill: 0xf4e8cf, fontSize: fs(0.04), fontFamily: 'serif', fontWeight: 'bold', stroke: { color: 0x3a2c18, width: 3 } },
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
        const stt = new Text({ text: '★'.repeat(st), style: { fill: 0xf2c14e, fontSize: fs(0.03), fontFamily: 'serif' } })
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
      if (!locked) {
        node.eventMode = 'static'
        node.cursor = 'pointer'
        const id = i
        node.on('pointertap', () => {
          if (mapDragged) return
          startLevel(id)
        })
      }
      content.addChild(node)
    }

    // ヘッダー（全幅バー廃止。左=コイン札／右=星札の小型プラーク2枚＋小さな題字）
    const header = new Container()
    const plaque = (x: number) => {
      const g = new Graphics()
      g.roundRect(x, vh * 0.025, vw * 0.24, vh * 0.045, 10).fill({ color: 0x2e2416, alpha: 0.82 })
      g.roundRect(x, vh * 0.025, vw * 0.24, vh * 0.045, 10).stroke({ width: 1.5, color: UI.brass })
      return g
    }
    header.addChild(plaque(vw * 0.02))
    header.addChild(plaque(vw * 0.74))
    const coinTex = spriteTexture('ui_coin')
    if (coinTex) {
      const c = new Sprite(coinTex)
      c.anchor.set(0.5)
      c.scale.set((vh * 0.028) / Math.max(coinTex.width, coinTex.height))
      c.position.set(vw * 0.07, vh * 0.0475)
      header.addChild(c)
    }
    const coinT = new Text({
      text: save.coins.toLocaleString(),
      style: { fill: 0xe5d8bb, fontSize: fs(0.036), fontFamily: 'serif', fontWeight: 'bold' },
    })
    coinT.anchor.set(0, 0.5)
    coinT.position.set(vw * 0.11, vh * 0.0475)
    header.addChild(coinT)
    const starTotal = save.stars.reduce((a, b) => a + (b || 0), 0)
    const starT = new Text({
      text: `★ ${starTotal}`,
      style: { fill: 0xd8b855, fontSize: fs(0.036), fontFamily: 'serif', fontWeight: 'bold' },
    })
    starT.anchor.set(0.5)
    starT.position.set(vw * 0.86, vh * 0.0475)
    header.addChild(starT)
    mapRoot.addChild(header)

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
    mapDragged = false
    mapRoot.on('pointerdown', (e) => {
      if (!bgmStarted) {
        bgmStarted = true
        startBgm(themeForLevel(save.unlocked + 1))
      }
      dragStart = e.global.y
      scrollStart = mapScroll
      mapDragged = false
    })
    mapRoot.on('pointermove', (e) => {
      if (dragStart === null) return
      const dy = e.global.y - dragStart
      if (Math.abs(dy) > 8) mapDragged = true
      mapScroll = clampScroll(scrollStart + dy)
      content.position.y = mapScroll
    })
    const endDrag = () => {
      dragStart = null
    }
    mapRoot.on('pointerup', endDrag)
    mapRoot.on('pointerupoutside', endDrag)
  }
  let mapDragged = false

  const showMap = () => {
    playRoot.visible = false
    playRoot.removeAllListeners()
    playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
    mapRoot.visible = true
    buildMap()
    ensureBgm(save.unlocked + 1)
  }

  // =============== プレイシーン ===============
  let board!: Board
  let view!: BoardView
  let inputLocked = false
  let currentLevelId = 1
  let sceneEpoch = 0 // シーン再構築の世代。跨いだ遅延コールバックは無効化

  const startLevel = (id: number) => {
    currentLevelId = id
    mapRoot.visible = false
    playRoot.visible = true
    playRoot.removeAllListeners() // 旧シーンの入力ハンドラを掃除（破棄済みオブジェクト参照の防止）
    playRoot.removeChildren().forEach((c) => c.destroy({ children: true }))
    buildPlayScene(LEVELS[id - 1])
    ensureBgm(id)
  }

  const buildPlayScene = (def: (typeof LEVELS)[0]) => {
    board = new Board(def)
    inputLocked = false
    const epoch = ++sceneEpoch
    const alive = () => epoch === sceneEpoch // このシーンがまだ生きているか

    // 背景
    const bgSprite = new Sprite()
    bgSprite.anchor.set(0.5)
    bgSprite.position.set(vw / 2, vh / 2)
    const tex = spriteTexture(`bg_${themeForLevel(def.id)}`)
    if (tex) {
      bgSprite.texture = tex
      const s = Math.max(vw / tex.width, vh / tex.height)
      bgSprite.scale.set(s)
    }
    playRoot.addChild(bgSprite)
    const bgDim = new Graphics()
    bgDim.rect(0, 0, vw, vh).fill({ color: 0x2b2118, alpha: 0.1 }) // 暖色の沈め（青黒で潰さない）
    playRoot.addChild(bgDim)

    // 4帯レイアウト（AD v3.1）: HUD帯(〜0.20) / キャラ帯(0.20〜0.35) / 盤(0.35〜0.78) / ブースター帯(〜0.90)
    const boardSize = Math.min(vw * 0.9, vh * 0.48)
    view = new BoardView(board, app.renderer, boardSize)
    const bw = view.S * W
    const boardTop = vh * 0.35
    view.root.position.set((vw - bw) / 2, boardTop)
    playRoot.addChild(view.root)

    // ---------- 探窟家バスト（HUDと盤の間から覗く。盤より先に足して奥に置く） ----------
    const bustTex = spriteTexture(`bust_${themeForLevel(def.id)}`)
    if (bustTex) {
      const bust = new Sprite(bustTex)
      bust.anchor.set(0.5, 1)
      const bh = vh * 0.19 // キャラ帯（0.20〜0.35vh）に顔全体が収まる
      bust.scale.set(bh / bustTex.height)
      bust.position.set(vw * 0.5, boardTop + vh * 0.01)
      playRoot.addChildAt(bust, playRoot.getChildIndex(view.root))
    }

    // ---------- HUD（AD v3: メダリオン/中央プラーク/スコアバッジ） ----------
    const ui = new Container()
    playRoot.addChild(ui)

    // のこりメダリオン（左上・円形ブロンズ。小型化）
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
    const movesText = new Text({
      text: '',
      style: { fill: 0xe5d8bb, fontSize: fs(0.064), fontFamily: 'serif', fontWeight: 'bold' },
    })
    movesText.anchor.set(0.5)
    // メダリオンの暗い中心（リボン下）に合わせる
    movesText.position.set(vw * 0.035 + badgeW / 2, vh * 0.022 + badgeH * 0.58)
    ui.addChild(movesText)

    // スコアバッジ（小型・中央札と重ならない位置。「スコア」は焼き込み・数字のみ描画）
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
      style: { fill: 0xe5d8bb, fontSize: fs(0.031), fontFamily: 'serif', fontWeight: 'bold' },
    })
    scoreText.anchor.set(1, 0.5)
    scoreText.position.set(sbX + sbW * 0.88, sbY + sbH * 0.5)
    ui.addChild(scoreText)

    // 歯車（ミュート）と戻る（青銅メダリオン・右上に縦並び。小型化＋タップ領域確保）
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

    // ターゲット札（画面中央上・リボン見出し焼き込み。小型化）
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
    tp.position.set((vw - tpW) / 2, vh * 0.025) // 真ん中に置く（モック準拠）
    ui.addChild(tp)

    const goalItems: { icon: Container; count: Text }[] = []
    const goalIcon = (g: Goal): Container => {
      const c = new Container()
      let sp: Sprite | null = null
      if (g.type === 'color') sp = new Sprite(pieceTexture(app.renderer, { kind: 'normal', color: g.color! }, 64))
      else if (g.type === 'kokeishi' && spriteTexture('kokeishi')) sp = new Sprite(spriteTexture('kokeishi')!)
      else if (g.type === 'touhen' && spriteTexture('touhen')) sp = new Sprite(spriteTexture('touhen')!)
      else if (g.type === 'tsutagoke' && spriteTexture('moss_icon')) sp = new Sprite(spriteTexture('moss_icon')!)
      else if (g.type === 'spore' && spriteTexture('spore')) sp = new Sprite(spriteTexture('spore')!)
      if (sp) {
        sp.anchor.set(0.5)
        sp.scale.set((tpH * 0.28) / Math.max(sp.texture.width, sp.texture.height))
        c.addChild(sp)
      } else {
        const gph = new Graphics()
        gph.roundRect(-tpH * 0.12, -tpH * 0.12, tpH * 0.24, tpH * 0.24, 6).fill(g.type === 'tsutagoke' ? 0x4f7a4a : 0xb8b2a0)
        c.addChild(gph)
      }
      return c
    }
    const buildGoals = () => {
      for (const gi of goalItems) {
        gi.icon.destroy()
        gi.count.destroy()
      }
      goalItems.length = 0
      // モック準拠：アイコンの「下」に数字（重なり解消）。パネル内側に等間隔
      const n = board.goals.length
      const inner = tpW * 0.78
      const groupW = Math.min(tpW * 0.32, inner / n)
      const iconScale = n >= 3 ? 0.26 : 0.32
      board.goals.forEach((g, i) => {
        const icon = goalIcon(g)
        for (const ch of icon.children) if (ch instanceof Sprite) ch.scale.set((tpH * iconScale) / Math.max(ch.texture.width, ch.texture.height))
        const cx = tpW / 2 + (i - (n - 1) / 2) * groupW
        icon.position.set(cx, tpH * 0.52)
        const count = new Text({
          text: '',
          style: { fill: UI.paperInk, fontSize: fs(n >= 3 ? 0.036 : 0.042), fontFamily: 'serif', fontWeight: 'bold' },
        })
        count.anchor.set(0.5)
        count.position.set(cx, tpH * 0.8)
        tp.addChild(icon)
        tp.addChild(count)
        goalItems.push({ icon, count })
      })
    }

    const refreshHud = () => {
      movesText.text = String(board.movesLeft)
      scoreText.text = board.score.toLocaleString()
      board.goals.forEach((g, i) => {
        const gi = goalItems[i]
        if (!gi) return
        const left = Math.max(0, g.count - board.goalDone[i])
        gi.count.text = left === 0 ? '✓' : String(left)
        gi.count.style.fill = left === 0 ? 0x667451 : UI.paperInk
      })
    }
    buildGoals()
    refreshHud()

    // ブースター帯（モック準拠4枠・専用アイコン。機能接続はPhase 3残）
    const boosterBar = new Container()
    const medalTex = spriteTexture('ui_medal')
    ;['bst_pickaxe', 'bst_lantern', 'bst_mushroom', 'bst_potion'].forEach((k, i) => {
      const m = new Container()
      const r = vw * 0.062
      if (medalTex) {
        const base = new Sprite(medalTex)
        base.anchor.set(0.5)
        base.scale.set((r * 2.3) / Math.max(medalTex.width, medalTex.height))
        base.alpha = 0.82 // 未所持でも枠は見せる（全体を薄くしない）
        m.addChild(base)
      }
      const tex2 = spriteTexture(k)
      if (tex2) {
        const glow = new Graphics()
        glow.circle(0, -r * 0.02, r * 0.66).fill({ color: 0xe8d9b0, alpha: 0.34 })
        m.addChild(glow)
        const sp = new Sprite(tex2)
        sp.anchor.set(0.5)
        sp.scale.set((r * 1.15) / Math.max(tex2.width, tex2.height))
        sp.position.set(0, -r * 0.02)
        sp.alpha = 0.8 // 0個でも読める明るさ（所持時は1.0にする予定）
        m.addChild(sp)
      }
      const cbg = new Graphics()
      cbg.circle(r * 0.68, r * 0.62, r * 0.28).fill(0x3a2c1c).stroke({ width: 1.5, color: UI.brass })
      m.addChild(cbg)
      const ct = new Text({ text: '0', style: { fill: 0xe5d8bb, fontSize: fs(0.028), fontFamily: 'serif', fontWeight: 'bold' } })
      ct.anchor.set(0.5)
      ct.position.set(r * 0.68, r * 0.62)
      m.addChild(ct)
      m.position.set(vw / 2 + (i - 1.5) * vw * 0.17, 0)
      boosterBar.addChild(m)
    })
    boosterBar.position.set(0, boardTop + view.S * H + Math.min(vw * 0.1, vh * 0.05))
    ui.addChild(boosterBar)

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
    const stage = new Container()
    stage.eventMode = 'static'
    stage.hitArea = app.screen
    playRoot.addChildAt(stage, playRoot.children.length)
    // 入力は背景レイヤーで拾う（UIボタンは各自 eventMode）
    bgDim.eventMode = 'static'
    view.root.eventMode = 'static'
    playRoot.eventMode = 'static'
    playRoot.hitArea = app.screen
    playRoot.on('pointerdown', (e) => {
      if (!bgmStarted) {
        bgmStarted = true
        startBgm(themeForLevel(currentLevelId))
      }
      downAt = { x: e.global.x, y: e.global.y }
      downCell = toCell(e.global.x, e.global.y)
    })
    playRoot.on('pointerup', (e) => {
      if (inputLocked || !downAt || !downCell) return
      const dx = e.global.x - downAt.x
      const dy = e.global.y - downAt.y
      const dist = Math.hypot(dx, dy)
      let evs: import('./core/types').BoardEvent[] = []
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
      const dur = view.play(evs)
      refreshHud()
      if (board.won) {
        inputLocked = true
        tw.delay(Math.min(dur, 1200), () => {
          if (alive()) triggerWin()
        })
      } else if (board.lost) {
        inputLocked = true
        tw.delay(900, () => {
          if (alive()) showLoseOffer()
        })
      }
    })

    // ---------- 勝利・敗北 ----------
    const triggerWin = () => {
      inputLocked = true
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0 })
      playRoot.addChild(dim)
      tw.tween(dim, { alpha: 0.45 }, 250)
      const bt = new Container()
      const bannerTex = spriteTexture('ui_banner_word') ?? spriteTexture('ui_ribbon')
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
      tw.delay(1500, () => {
        if (!alive()) return
        tw.tween(bt.scale, { x: 0, y: 0 }, 300, { ease: tw.easeInCubic, onDone: () => bt.destroy() })
        tw.tween(dim, { alpha: 0 }, 150, { onDone: () => dim.destroy() })
        const evs = board.finishWin()
        const dur = view.play(evs)
        const drains = evs.filter((e) => e.t === 'win-drain')
        drains.forEach((e, i) => {
          tw.delay(i * 45, () => {
            if (alive() && e.t === 'win-drain' && !movesText.destroyed) movesText.text = String(e.movesLeft)
          })
        })
        tw.delay(dur * 0.5, () => {
          if (alive() && !scoreText.destroyed) scoreText.text = board.score.toLocaleString()
        })
        tw.delay(dur, () => {
          if (!alive()) return
          refreshHud()
          showClearPanel()
        })
      })
    }

    const showClearPanel = () => {
      sfx.fanfare()
      // セーブ反映
      const st = board.stars
      const reward = clearReward(currentLevelId, st)
      save.coins += reward
      save.stars[currentLevelId - 1] = Math.max(save.stars[currentLevelId - 1] ?? 0, st)
      if (!save.best) save.best = []
      const prevBest = save.best[currentLevelId - 1] ?? 0
      save.best[currentLevelId - 1] = Math.max(prevBest, board.score)
      save.unlocked = Math.max(save.unlocked, currentLevelId)
      persistSave(save)

      const panel = new Container()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x1a130c, alpha: 0.28 }) // 背景テーマを見せる（正本③）
      panel.addChild(dim)
      const pw = vw * 0.9
      const ph = vh * 0.62
      const px0 = (vw - pw) / 2
      const py0 = vh * 0.13
      const parchTex = spriteTexture('ui_parchment')
      if (parchTex) {
        const sp = new Sprite(parchTex)
        sp.width = pw
        sp.height = ph
        sp.position.set(px0, py0)
        panel.addChild(sp)
      }
      const ribbonTex2 =
        spriteTexture(`ribbon_${themeForLevel(currentLevelId)}`) ?? spriteTexture('ui_ribbon_clear') ?? spriteTexture('ui_ribbon')
      if (ribbonTex2) {
        const rb = new Sprite(ribbonTex2)
        rb.anchor.set(0.5)
        rb.scale.set((pw * 0.82) / ribbonTex2.width)
        rb.position.set(vw / 2, py0 + vh * 0.002)
        panel.addChild(rb)
      }
      // ★はスプライトで大きく（モック準拠：中央が一段高い）
      const starY = py0 + ph * 0.26
      const starGold = spriteTexture('ui_star_gold')
      const starEmpty = spriteTexture('ui_star_empty')
      for (let i = 0; i < 3; i++) {
        const filled = i < st
        const tex3 = filled ? starGold : starEmpty
        let stS: Container
        if (tex3) {
          const sp = new Sprite(tex3)
          sp.anchor.set(0.5)
          const sw = pw * (i === 1 ? 0.27 : 0.22)
          sp.scale.set(sw / tex3.width)
          stS = sp
        } else {
          const t2 = new Text({ text: '★', style: { fill: filled ? 0xf2c14e : 0xcbc2ab, fontSize: fs(0.12), fontFamily: 'serif' } })
          t2.anchor.set(0.5)
          stS = t2
        }
        stS.position.set(vw / 2 + (i - 1) * pw * 0.27, starY + (i === 1 ? -ph * 0.05 : 0))
        stS.scale.set(0)
        const target = tex3 ? (pw * (i === 1 ? 0.27 : 0.22)) / tex3.width : 1
        panel.addChild(stS)
        tw.tween(stS.scale, { x: target, y: target }, 300, {
          delay: 200 + i * 180,
          ease: tw.easeOutBack,
          onDone: () => {
            if (filled) sfx.star(i)
          },
        })
      }
      // スコア（バッジ焼き込み「スコア」＋数字）
      const scBadge = spriteTexture('ui_score')
      const scW = pw * 0.56
      let scH = scW * 0.39
      const scY = py0 + ph * 0.47
      if (scBadge) {
        const sp = new Sprite(scBadge)
        sp.anchor.set(0.5)
        sp.width = scW
        sp.height = (scW / scBadge.width) * scBadge.height
        scH = sp.height
        sp.position.set(vw / 2, scY)
        panel.addChild(sp)
      }
      const sc = new Text({
        text: board.score.toLocaleString(),
        style: { fill: 0xf4e8cf, fontSize: fs(0.046), fontFamily: 'serif', fontWeight: 'bold' },
      })
      sc.anchor.set(0.5)
      sc.position.set(vw / 2 + scW * 0.15, scY) // 「スコア」焼き込みの右側・鋲を避けて中央寄せ
      panel.addChild(sc)
      // ハイスコア（焼き込み札＋数字）
      const hsTex = spriteTexture('ui_word_hiscore')
      const hsY = scY + scH * 0.5 + vh * 0.022
      if (hsTex) {
        const sp = new Sprite(hsTex)
        sp.anchor.set(1, 0.5)
        sp.scale.set((pw * 0.3) / hsTex.width)
        sp.position.set(vw / 2 + pw * 0.02, hsY)
        panel.addChild(sp)
      }
      const hs = new Text({
        text: Math.max(prevBest, board.score).toLocaleString(),
        style: { fill: UI.paperInk, fontSize: fs(0.034), fontFamily: 'serif', fontWeight: 'bold' },
      })
      hs.anchor.set(0, 0.5)
      hs.position.set(vw / 2 + pw * 0.06, hsY)
      panel.addChild(hs)
      // 報酬コイン
      const rw = new Container()
      const coinTex = spriteTexture('ui_coin')
      if (coinTex) {
        const c = new Sprite(coinTex)
        c.anchor.set(0.5)
        c.scale.set((fs(0.05) * 1.1) / Math.max(coinTex.width, coinTex.height))
        c.position.set(-fs(0.06), 0)
        rw.addChild(c)
      }
      const rwT = new Text({
        text: `+${reward}`,
        style: { fill: 0x8a6d1f, fontSize: fs(0.045), fontFamily: 'serif', fontWeight: 'bold' },
      })
      rwT.anchor.set(0, 0.5)
      rwT.position.set(-fs(0.02), 0)
      rw.addChild(rwT)
      rw.position.set(vw / 2, py0 + ph * 0.69)
      panel.addChild(rw)
      // 探窟家と相棒がパネル下端から覗く（正本③）
      const bustTex2 = spriteTexture(`bust_${themeForLevel(currentLevelId)}`)
      if (bustTex2) {
        const ch = new Sprite(bustTex2)
        ch.anchor.set(0.5, 1)
        ch.scale.set((vh * 0.2) / bustTex2.height)
        ch.position.set(px0 + pw * 0.16, py0 + ph + vh * 0.055)
        panel.addChild(ch)
      }
      const mascotTex = spriteTexture('mascot')
      if (mascotTex) {
        const mo = new Sprite(mascotTex)
        mo.anchor.set(0.5, 1)
        mo.scale.set((vh * 0.13) / mascotTex.height)
        mo.position.set(px0 + pw * 0.84, py0 + ph + vh * 0.05)
        panel.addChild(mo)
      }
      // つぎへ（→マップ）
      const btn = new Container()
      const bw2 = pw * 0.6
      const btnTex = spriteTexture(`next_${themeForLevel(currentLevelId)}`) ?? spriteTexture('ui_button_next')
      if (btnTex) {
        const sp = new Sprite(btnTex)
        sp.anchor.set(0.5)
        sp.scale.set(bw2 / btnTex.width)
        btn.addChild(sp)
      }
      btn.position.set(vw / 2, py0 + ph * 0.86)
      btn.eventMode = 'static'
      btn.cursor = 'pointer'
      btn.on('pointertap', () => {
        panel.destroy({ children: true })
        showMap()
      })
      panel.addChild(btn)
      playRoot.addChild(panel)
    }

    // 敗北オファー（追加5手=900コイン or あきらめる）
    const showLoseOffer = () => {
      sfx.lose()
      const panel = new Container()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0.55 })
      panel.addChild(dim)
      const pw = vw * 0.8
      const ph = vh * 0.32
      const px0 = (vw - pw) / 2
      const py0 = vh * 0.3
      const parchTex = spriteTexture('ui_parchment')
      if (parchTex) {
        const sp = new Sprite(parchTex)
        sp.width = pw
        sp.height = ph
        sp.position.set(px0, py0)
        panel.addChild(sp)
      } else {
        const g = new Graphics()
        g.roundRect(px0, py0, pw, ph, 14).fill(UI.paper)
        panel.addChild(g)
      }
      const t1 = new Text({
        text: '手数が尽きた…',
        style: { fill: UI.paperInk, fontSize: fs(0.05), fontFamily: 'serif', fontWeight: 'bold' },
      })
      t1.anchor.set(0.5)
      t1.position.set(vw / 2, py0 + ph * 0.2)
      panel.addChild(t1)
      const goalLeft = board.goals.reduce((a, g, i) => a + Math.max(0, g.count - board.goalDone[i]), 0)
      const t2 = new Text({
        text: `のこり目標 ${goalLeft}。あと少し！`,
        style: { fill: UI.paperInk, fontSize: fs(0.036), fontFamily: 'serif' },
      })
      t2.anchor.set(0.5)
      t2.position.set(vw / 2, py0 + ph * 0.34)
      panel.addChild(t2)
      // +5手ボタン
      const canAfford = save.coins >= EXTRA_MOVES_COST
      const buy = new Container()
      const bg1 = new Graphics()
      bg1.roundRect(-pw * 0.3, -vh * 0.03, pw * 0.6, vh * 0.06, 12).fill(canAfford ? 0x5d7a3f : 0x777468).stroke({ width: 3, color: 0x3f5429 })
      buy.addChild(bg1)
      const buyT = new Text({
        text: `＋${EXTRA_MOVES}手  ${EXTRA_MOVES_COST}コイン`,
        style: { fill: 0xf4f8ea, fontSize: fs(0.04), fontFamily: 'serif', fontWeight: 'bold' },
      })
      buyT.anchor.set(0.5)
      buy.addChild(buyT)
      buy.position.set(vw / 2, py0 + ph * 0.56)
      if (canAfford) {
        buy.eventMode = 'static'
        buy.cursor = 'pointer'
        buy.on('pointertap', () => {
          save.coins -= EXTRA_MOVES_COST
          persistSave(save)
          board.addMoves(EXTRA_MOVES)
          panel.destroy({ children: true })
          inputLocked = false
          refreshHud()
        })
      } else buy.alpha = 0.6
      panel.addChild(buy)
      // あきらめる
      const giveup = new Text({
        text: 'あきらめて戻る',
        style: { fill: 0x6e6250, fontSize: fs(0.038), fontFamily: 'serif' },
      })
      giveup.anchor.set(0.5)
      giveup.position.set(vw / 2, py0 + ph * 0.8)
      giveup.eventMode = 'static'
      giveup.cursor = 'pointer'
      giveup.on('pointertap', () => {
        panel.destroy({ children: true })
        showMap()
      })
      panel.addChild(giveup)
      playRoot.addChild(panel)
    }

    // QA用フック
    ;(window as unknown as Record<string, unknown>).__yacho = {
      get board() {
        return board
      },
      get view() {
        return view
      },
      metrics: () => ({ S: view.S, ox: view.root.position.x, oy: view.root.position.y, vw, vh }),
      busy: () => tw.activeCount(),
      forceWin: () => {
        board.goals.forEach((g, i) => (board.goalDone[i] = g.count))
        refreshHud()
        triggerWin()
      },
      forceLose: () => {
        board.movesLeft = 0
        refreshHud()
        showLoseOffer()
      },
      showMap,
      startLevel,
      save,
    }
  }

  app.ticker.add((t) => tw.update(t.deltaMS))
  showMap()
  // マップからも QA フックを使えるように
  ;(window as unknown as Record<string, unknown>).__yachoNav = { showMap, startLevel, save }
}

boot()
