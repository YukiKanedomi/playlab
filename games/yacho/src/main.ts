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
  const MAP_H = vh * 2.6
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
    const topPad = vh * 0.16
    const botPad = vh * 0.12
    for (let i = 1; i <= LEVELS.length; i++) {
      const t = (i - 1) / (LEVELS.length - 1)
      const nx = vw / 2 + Math.sin(i * 1.05) * vw * 0.27
      const ny = topPad + t * (MAP_H - topPad - botPad)
      const node = new Container()
      const cleared = i <= save.unlocked
      const current = i === save.unlocked + 1
      const locked = i > save.unlocked + 1
      const r = vw * 0.055
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
        style: { fill: cleared ? 0x4a3a10 : UI.badgeText, fontSize: fs(0.04), fontFamily: 'serif', fontWeight: 'bold' },
      })
      num.anchor.set(0.5)
      node.addChild(num)
      // 星
      const st = save.stars[i - 1] ?? 0
      if (cleared && st > 0) {
        const stt = new Text({ text: '★'.repeat(st), style: { fill: 0xf2c14e, fontSize: fs(0.03), fontFamily: 'serif' } })
        stt.anchor.set(0.5)
        stt.position.set(0, r * 1.45)
        node.addChild(stt)
      }
      if (current) {
        const ring = new Graphics()
        ring.circle(0, 0, r * 1.3).stroke({ width: 4, color: 0xf2e2a0, alpha: 0.9 })
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
      }
      if (locked) node.alpha = 0.45
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

    // ヘッダー（コイン・星合計）
    const header = new Container()
    const hb = new Graphics()
    hb.roundRect(vw * 0.03, vh * 0.025, vw * 0.94, vh * 0.06, 12).fill({ color: 0x141f14, alpha: 0.75 })
    hb.roundRect(vw * 0.03, vh * 0.025, vw * 0.94, vh * 0.06, 12).stroke({ width: 2, color: UI.brass })
    header.addChild(hb)
    const coinTex = spriteTexture('ui_coin')
    if (coinTex) {
      const c = new Sprite(coinTex)
      c.anchor.set(0.5)
      c.scale.set((vh * 0.032) / Math.max(coinTex.width, coinTex.height))
      c.position.set(vw * 0.1, vh * 0.055)
      header.addChild(c)
    }
    const coinT = new Text({
      text: save.coins.toLocaleString(),
      style: { fill: UI.badgeText, fontSize: fs(0.042), fontFamily: 'serif', fontWeight: 'bold' },
    })
    coinT.anchor.set(0, 0.5)
    coinT.position.set(vw * 0.15, vh * 0.055)
    header.addChild(coinT)
    const starTotal = save.stars.reduce((a, b) => a + (b || 0), 0)
    const starT = new Text({
      text: `★ ${starTotal}`,
      style: { fill: 0xf2c14e, fontSize: fs(0.042), fontFamily: 'serif', fontWeight: 'bold' },
    })
    starT.anchor.set(1, 0.5)
    starT.position.set(vw * 0.94, vh * 0.055)
    header.addChild(starT)
    const title = new Text({
      text: '深界断面図',
      style: { fill: UI.badgeText, fontSize: fs(0.038), fontFamily: 'serif' },
    })
    title.anchor.set(0.5)
    title.position.set(vw / 2, vh * 0.055)
    header.addChild(title)
    mapRoot.addChild(header)

    // スクロール（ドラッグ）
    const clampScroll = (v: number) => Math.min(0, Math.max(-(MAP_H - vh), v))
    // 現在ノードへフォーカス
    const curT = save.unlocked / (LEVELS.length - 1)
    mapScroll = clampScroll(-(topPad + curT * (MAP_H - topPad - botPad)) + vh * 0.4)
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
    bgDim.rect(0, 0, vw, vh).fill({ color: 0x0a1420, alpha: 0.22 })
    playRoot.addChild(bgDim)

    // 盤はRM流に「親指の届く下側」へ。上1/4はHUD帯、下端にブースター帯
    const boardSize = Math.min(vw * 0.94, vh * 0.58)
    view = new BoardView(board, app.renderer, boardSize)
    const bw = view.S * W
    const boardTop = vh * 0.27
    view.root.position.set((vw - bw) / 2, boardTop)
    playRoot.addChild(view.root)

    // ---------- HUD ----------
    const ui = new Container()
    playRoot.addChild(ui)

    const badgeW = vw * 0.2
    const plaqueTex = spriteTexture('ui_moves')
    let badgeH = vw * 0.19
    if (plaqueTex) {
      const sp = new Sprite(plaqueTex)
      sp.width = badgeW
      sp.height = (badgeW / plaqueTex.width) * plaqueTex.height
      badgeH = sp.height
      sp.position.set(vw * 0.03, vh * 0.025)
      ui.addChild(sp)
    }
    const movesText = new Text({
      text: '',
      style: { fill: UI.badgeText, fontSize: fs(0.08), fontFamily: 'serif', fontWeight: 'bold' },
    })
    movesText.anchor.set(0.5)
    movesText.position.set(vw * 0.03 + badgeW / 2, vh * 0.025 + badgeH * 0.62)
    ui.addChild(movesText)

    const scoreText = new Text({
      text: '',
      style: { fill: UI.badgeText, fontSize: fs(0.032), fontFamily: 'serif', stroke: { color: 0x2a2013, width: 3 } },
    })
    scoreText.position.set(vw * 0.03, vh * 0.025 + badgeH + 8)
    ui.addChild(scoreText)

    // 歯車（ミュート）
    const gearTex = spriteTexture('ui_gear')
    const gr = vw * 0.05
    let gear: Container
    if (gearTex) {
      const sp = new Sprite(gearTex)
      sp.anchor.set(0.5)
      sp.scale.set((gr * 2.2) / Math.max(gearTex.width, gearTex.height))
      gear = sp
    } else {
      const g = new Graphics()
      g.circle(0, 0, gr).fill(UI.wood).stroke({ width: 3, color: UI.brass })
      gear = g
    }
    gear.position.set(vw * 0.93, vh * 0.03 + gr)
    gear.eventMode = 'static'
    gear.cursor = 'pointer'
    gear.alpha = isMuted() ? 0.45 : 1
    gear.on('pointertap', () => {
      gear.alpha = toggleMute() ? 0.45 : 1
    })
    ui.addChild(gear)

    // マップへ戻る（左上の小さな札の下・青銅の矢印）
    const back = new Graphics()
    back.roundRect(-vw * 0.035, -vh * 0.016, vw * 0.07, vh * 0.032, 8).fill(UI.wood).stroke({ width: 2, color: UI.brass })
    back.moveTo(vw * 0.01, -vh * 0.009).lineTo(-vw * 0.012, 0).lineTo(vw * 0.01, vh * 0.009).stroke({ width: 3, color: UI.badgeText })
    back.position.set(vw * 0.93, vh * 0.03 + gr * 2 + vh * 0.028) // 歯車の下に縦並び（重なり解消）
    back.eventMode = 'static'
    back.cursor = 'pointer'
    back.on('pointertap', () => showMap())
    ui.addChild(back)

    // ターゲット札
    const tpW = vw * 0.44
    const tpTex = spriteTexture('ui_target')
    const tpH = tpTex ? (tpW / tpTex.width) * tpTex.height : badgeH
    const tp = new Container()
    if (tpTex) {
      const sp = new Sprite(tpTex)
      sp.width = tpW
      sp.height = tpH
      tp.addChild(sp)
    }
    tp.position.set(vw * 0.27 + (vw * 0.62 - tpW) / 2, vh * 0.02) // 木札と右ボタン群の間で中央寄せ
    ui.addChild(tp)

    const goalItems: { icon: Container; count: Text }[] = []
    const goalIcon = (g: Goal): Container => {
      const c = new Container()
      let sp: Sprite | null = null
      if (g.type === 'color') sp = new Sprite(pieceTexture(app.renderer, { kind: 'normal', color: g.color! }, 64))
      else if (g.type === 'kokeishi' && spriteTexture('kokeishi')) sp = new Sprite(spriteTexture('kokeishi')!)
      else if (g.type === 'touhen' && spriteTexture('hako')) sp = new Sprite(spriteTexture('hako')!)
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
      // 目標数に応じてグループ幅を決め、パネルの内側（12%〜88%）に収める
      const n = board.goals.length
      const inner = tpW * 0.76
      const groupW = Math.min(tpW * 0.3, inner / n)
      const iconScale = n >= 3 ? 0.22 : 0.28
      board.goals.forEach((g, i) => {
        const icon = goalIcon(g)
        for (const ch of icon.children) if (ch instanceof Sprite) ch.scale.set((tpH * iconScale) / Math.max(ch.texture.width, ch.texture.height))
        const cx = tpW / 2 + (i - (n - 1) / 2) * groupW
        icon.position.set(cx - groupW * 0.22, tpH * 0.58)
        const count = new Text({
          text: '',
          style: { fill: UI.paperInk, fontSize: fs(n >= 3 ? 0.038 : 0.045), fontFamily: 'serif', fontWeight: 'bold' },
        })
        count.anchor.set(0, 0.5)
        count.position.set(cx + groupW * 0.06, tpH * 0.58)
        tp.addChild(icon)
        tp.addChild(count)
        goalItems.push({ icon, count })
      })
    }

    const refreshHud = () => {
      movesText.text = String(board.movesLeft)
      scoreText.text = `スコア ${board.score.toLocaleString()}`
      board.goals.forEach((g, i) => {
        const gi = goalItems[i]
        if (!gi) return
        const left = Math.max(0, g.count - board.goalDone[i])
        gi.count.text = left === 0 ? '✓' : String(left)
        gi.count.style.fill = left === 0 ? 0x3f7a3f : UI.paperInk
      })
    }
    buildGoals()
    refreshHud()

    // ブースター帯（飾り。機能接続はPhase 3残）
    const boosterBar = new Container()
    const medalTex = spriteTexture('ui_medal')
    ;['harpoon', 'hitsubo', 'seiju'].forEach((k, i) => {
      const m = new Container()
      const r = vw * 0.075
      if (medalTex) {
        const base = new Sprite(medalTex)
        base.anchor.set(0.5)
        base.scale.set((r * 2.3) / Math.max(medalTex.width, medalTex.height))
        m.addChild(base)
      }
      const tex2 = spriteTexture(k)
      if (tex2) {
        const sp = new Sprite(tex2)
        sp.anchor.set(0.5)
        sp.scale.set((r * 1.05) / Math.max(tex2.width, tex2.height))
        sp.position.set(0, -r * 0.06)
        m.addChild(sp)
      }
      const ct = new Text({ text: '0', style: { fill: UI.badgeText, fontSize: fs(0.032), fontFamily: 'serif', fontWeight: 'bold' } })
      ct.anchor.set(0.5)
      ct.position.set(r * 0.78, r * 0.72)
      m.addChild(ct)
      m.alpha = 0.6
      m.position.set(vw / 2 + (i - 1) * vw * 0.21, 0)
      boosterBar.addChild(m)
    })
    boosterBar.position.set(0, boardTop + view.S * H + vw * 0.11)
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
        rb.scale.set((vw * 0.86) / bannerTex.width)
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
          if (alive() && !scoreText.destroyed) scoreText.text = `スコア ${board.score.toLocaleString()}`
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
      save.unlocked = Math.max(save.unlocked, currentLevelId)
      persistSave(save)

      const panel = new Container()
      const dim = new Graphics()
      dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0.55 })
      panel.addChild(dim)
      const pw = vw * 0.82
      const ph = vh * 0.42
      const px0 = (vw - pw) / 2
      const py0 = vh * 0.24
      const parchTex = spriteTexture('ui_parchment')
      if (parchTex) {
        const sp = new Sprite(parchTex)
        sp.width = pw
        sp.height = ph
        sp.position.set(px0, py0)
        panel.addChild(sp)
      }
      const ribbonTex2 = spriteTexture('ui_ribbon_clear') ?? spriteTexture('ui_ribbon')
      if (ribbonTex2) {
        const rb = new Sprite(ribbonTex2)
        rb.anchor.set(0.5)
        rb.scale.set((pw * 0.82) / ribbonTex2.width)
        rb.position.set(vw / 2, py0 + vh * 0.002)
        panel.addChild(rb)
      }
      const starY = py0 + ph * 0.34
      for (let i = 0; i < 3; i++) {
        const filled = i < st
        const stT = new Text({
          text: '★',
          style: { fill: filled ? 0xf2c14e : 0xcbc2ab, fontSize: fs(filled ? 0.13 : 0.1), fontFamily: 'serif' },
        })
        stT.anchor.set(0.5)
        stT.position.set(vw / 2 + (i - 1) * pw * 0.24, starY + (i === 1 ? -ph * 0.03 : 0))
        stT.scale.set(0)
        panel.addChild(stT)
        tw.tween(stT.scale, { x: 1, y: 1 }, 300, {
          delay: 200 + i * 180,
          ease: tw.easeOutBack,
          onDone: () => {
            if (filled) sfx.star(i)
          },
        })
      }
      const sc = new Text({
        text: `スコア ${board.score.toLocaleString()}`,
        style: { fill: UI.paperInk, fontSize: fs(0.05), fontFamily: 'serif', fontWeight: 'bold', align: 'center' },
      })
      sc.anchor.set(0.5)
      sc.position.set(vw / 2, py0 + ph * 0.55)
      panel.addChild(sc)
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
      rw.position.set(vw / 2, py0 + ph * 0.67)
      panel.addChild(rw)
      // つぎへ（→マップ）
      const btn = new Container()
      const bw2 = pw * 0.6
      const btnTex = spriteTexture('ui_button_next')
      if (btnTex) {
        const sp = new Sprite(btnTex)
        sp.anchor.set(0.5)
        sp.scale.set(bw2 / btnTex.width)
        btn.addChild(sp)
      }
      btn.position.set(vw / 2, py0 + ph * 0.85)
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
