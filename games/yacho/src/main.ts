// 『そろえて、しるす。』エントリ。AD v2（user_master モック準拠）のHUDレイアウト。
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS30 as LEVELS } from './core/levels30'
import { BoardView } from './view/BoardView'
import { PAL, loadSprites, pieceTexture, spriteTexture, themeForLevel } from './view/pieces'
import type { Goal } from './core/types'
import * as tw from './juice/tween'
import { sfx, startBgm, toggleMute, isMuted } from './juice/sound'

// AD v2 のUI配色（木×真鍮×羊皮紙）
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

  let levelIdx = 0
  let board = new Board(LEVELS[levelIdx])
  const scene = new Container()
  app.stage.addChild(scene)

  const vw = app.screen.width
  const vh = app.screen.height

  // 層テーマ背景（cover-fit）＋可読性のための薄い暗幕
  const bgSprite = new Sprite()
  bgSprite.anchor.set(0.5)
  bgSprite.position.set(vw / 2, vh / 2)
  scene.addChild(bgSprite)
  const bgDim = new Graphics()
  bgDim.rect(0, 0, vw, vh).fill({ color: 0x0a1420, alpha: 0.22 })
  scene.addChild(bgDim)
  const applyTheme = () => {
    const tex = spriteTexture(`bg_${themeForLevel(LEVELS[levelIdx].id)}`)
    if (!tex) return
    bgSprite.texture = tex
    const s = Math.max(vw / tex.width, vh / tex.height)
    bgSprite.scale.set(s)
  }
  applyTheme()
  const boardSize = Math.min(vw * 0.94, vh * 0.62)
  const view = new BoardView(board, app.renderer, boardSize)
  const bw = view.S * W
  view.root.position.set((vw - bw) / 2, vh * 0.19)
  scene.addChild(view.root)

  // ---------- HUD（user_master モック準拠） ----------
  const ui = new Container()
  scene.addChild(ui)
  const fs = (r: number) => Math.round(vw * r) // フォントスケール

  // 左上: MOVES 木札（生成UI部材。無ければコード描きにフォールバック）
  const badgeW = vw * 0.17
  const plaqueTex = spriteTexture('ui_moves')
  let badgeH = vw * 0.19
  if (plaqueTex) {
    const sp = new Sprite(plaqueTex)
    sp.width = badgeW
    sp.height = (badgeW / plaqueTex.width) * plaqueTex.height
    badgeH = sp.height
    sp.position.set(vw * 0.03, vh * 0.025)
    ui.addChild(sp)
  } else {
    const badge = new Graphics()
    badge.roundRect(0, 0, badgeW, badgeH, 10).fill(UI.wood).stroke({ width: 3, color: UI.brass })
    badge.position.set(vw * 0.03, vh * 0.025)
    ui.addChild(badge)
  }
  const movesLabel = new Text({ text: 'のこり', style: { fill: UI.badgeText, fontSize: fs(0.03), fontFamily: 'serif' } })
  movesLabel.anchor.set(0.5)
  movesLabel.position.set(vw * 0.03 + badgeW / 2, vh * 0.025 + badgeH * 0.17)
  const movesText = new Text({
    text: '',
    style: { fill: UI.badgeText, fontSize: fs(0.08), fontFamily: 'serif', fontWeight: 'bold' },
  })
  movesText.anchor.set(0.5)
  movesText.position.set(vw * 0.03 + badgeW / 2, vh * 0.025 + badgeH * 0.58)
  ui.addChild(movesLabel, movesText)

  // スコア（バッジ下に小さく）
  const scoreText = new Text({
    text: '',
    style: { fill: UI.badgeText, fontSize: fs(0.032), fontFamily: 'serif', stroke: { color: 0x2a2013, width: 3 } },
  })
  scoreText.position.set(vw * 0.03, vh * 0.03 + badgeH + 8)
  ui.addChild(scoreText)

  // 右上: 歯車（ミュート切替）
  const gearTex = spriteTexture('ui_gear')
  let gear: Container
  const gr = vw * 0.05
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
  gear.position.set(vw * 0.92, vh * 0.03 + gr)
  gear.eventMode = 'static'
  gear.cursor = 'pointer'
  gear.alpha = isMuted() ? 0.45 : 1
  gear.on('pointertap', () => {
    const m = toggleMute() // 暫定：歯車=ミュート切替（設定パネルは後続）
    gear.alpha = m ? 0.45 : 1
  })
  ui.addChild(gear)

  // 上中央〜右: ターゲット札（生成の羊皮紙パネル。タブ付き）
  const tpW = vw * 0.55
  const tpTex = spriteTexture('ui_target')
  const tpH = tpTex ? (tpW / tpTex.width) * tpTex.height : badgeH
  const tp = new Container()
  if (tpTex) {
    const sp = new Sprite(tpTex)
    sp.width = tpW
    sp.height = tpH
    tp.addChild(sp)
  } else {
    const tpBg = new Graphics()
    tpBg.roundRect(0, 0, tpW, tpH, 10).fill(UI.paper).stroke({ width: 3, color: UI.woodLight })
    tp.addChild(tpBg)
  }
  const tpLabel = new Text({ text: 'ターゲット', style: { fill: UI.badgeText, fontSize: fs(0.028), fontFamily: 'serif' } })
  tpLabel.anchor.set(0.5)
  tpLabel.position.set(tpW / 2, tpH * 0.1) // タブの帯に載せる
  tp.addChild(tpLabel)
  tp.position.set(vw * 0.26, vh * 0.02)
  ui.addChild(tp)

  // ターゲット札の中身（ゴールごとにアイコン＋残数）
  const goalItems: { icon: Container; count: Text; idx: number }[] = []
  const goalIcon = (g: Goal): Container => {
    const c = new Container()
    let sp: Sprite | null = null
    if (g.type === 'color') sp = new Sprite(pieceTexture(app.renderer, { kind: 'normal', color: g.color! }, 64))
    else if (g.type === 'kokeishi' && spriteTexture('kokeishi')) sp = new Sprite(spriteTexture('kokeishi')!)
    else if (g.type === 'spore' && spriteTexture('spore')) sp = new Sprite(spriteTexture('spore')!)
    if (sp) {
      sp.anchor.set(0.5)
      const s = (tpH * 0.28) / Math.max(sp.texture.width, sp.texture.height)
      sp.scale.set(s)
      c.addChild(sp)
    } else {
      const gph = new Graphics()
      gph.roundRect(-tpH * 0.2, -tpH * 0.2, tpH * 0.4, tpH * 0.4, 6).fill(g.type === 'tsutagoke' ? 0x4f7a4a : 0xb8b2a0)
      c.addChild(gph)
    }
    return c
  }
  const buildGoals = () => {
    for (const gi of goalItems) {
      gi.icon.destroy()
      gi.count.destroy() // テキストの破棄漏れ→前レベルの✓が残るバグの修正
    }
    goalItems.length = 0
    board.goals.forEach((g, i) => {
      const icon = goalIcon(g)
      const cx = tpW * (0.5 + (i - (board.goals.length - 1) / 2) * 0.3)
      icon.position.set(cx - tpW * 0.08, tpH * 0.58)
      const count = new Text({
        text: '',
        style: { fill: UI.paperInk, fontSize: fs(0.045), fontFamily: 'serif', fontWeight: 'bold' },
      })
      count.anchor.set(0, 0.5)
      count.position.set(cx + tpW * 0.015, tpH * 0.58)
      tp.addChild(icon)
      tp.addChild(count)
      goalItems.push({ icon, count, idx: i })
    })
  }

  // 下段: ブースター帯（メダリオン3・現状は飾り。Phase 3 で機能接続）
  const boosterBar = new Container()
  const medalKeys = ['harpoon', 'hitsubo', 'seiju']
  const medalTex = spriteTexture('ui_medal')
  medalKeys.forEach((k, i) => {
    const m = new Container()
    const r = vw * 0.075
    if (medalTex) {
      const base = new Sprite(medalTex)
      base.anchor.set(0.5)
      base.scale.set((r * 2.3) / Math.max(medalTex.width, medalTex.height))
      m.addChild(base)
    } else {
      const g = new Graphics()
      g.circle(0, 0, r).fill(UI.wood).stroke({ width: 4, color: UI.brass })
      m.addChild(g)
    }
    const tex = spriteTexture(k)
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set((r * 1.05) / Math.max(tex.width, tex.height))
      sp.position.set(0, -r * 0.06)
      m.addChild(sp)
    }
    const ct = new Text({ text: '0', style: { fill: UI.badgeText, fontSize: fs(0.032), fontFamily: 'serif', fontWeight: 'bold' } })
    ct.anchor.set(0.5)
    // メダリオン部材のバッジ円の位置（右下）に合わせる
    ct.position.set(r * 0.78, r * 0.72)
    m.addChild(ct)
    m.alpha = 0.6
    m.position.set(vw / 2 + (i - 1) * vw * 0.21, 0)
    boosterBar.addChild(m)
  })
  boosterBar.position.set(0, vh * 0.19 + view.S * H + vw * 0.12)
  ui.addChild(boosterBar)

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

  const banner = (msg: string, sub: string, color: number) => {
    const g = new Graphics()
    g.roundRect(vw * 0.08, vh * 0.4, vw * 0.84, vh * 0.16, 16).fill({ color: 0x0e1b28, alpha: 0.94 })
    g.roundRect(vw * 0.08, vh * 0.4, vw * 0.84, vh * 0.16, 16).stroke({ width: 3, color })
    const t = new Text({ text: msg, style: { fill: color, fontSize: fs(0.07), fontFamily: 'serif', fontWeight: 'bold' } })
    t.anchor.set(0.5)
    t.position.set(vw / 2, vh * 0.455)
    const s = new Text({ text: sub, style: { fill: UI.badgeText, fontSize: fs(0.04), fontFamily: 'serif' } })
    s.anchor.set(0.5)
    s.position.set(vw / 2, vh * 0.52)
    scene.addChild(g, t, s)
    return () => {
      g.destroy()
      t.destroy()
      s.destroy()
    }
  }

  // ---------- 入力 ----------
  let downAt: { x: number; y: number } | null = null
  let downCell: { x: number; y: number } | null = null
  let inputLocked = false // 勝敗後のみロック（プレイ中はロックしない＝RM流）

  const toCell = (gx: number, gy: number) => {
    const lx = gx - view.root.position.x
    const ly = gy - view.root.position.y
    const x = Math.floor(lx / view.S)
    const y = Math.floor(ly / view.S)
    if (x < 0 || y < 0 || x >= W || y >= H) return null
    return { x, y }
  }

  app.stage.eventMode = 'static'
  app.stage.hitArea = app.screen
  let bgmStarted = false
  app.stage.on('pointerdown', (e) => {
    if (!bgmStarted) {
      bgmStarted = true // 初回操作でBGM開始（オートプレイ規制対応）
      startBgm(themeForLevel(LEVELS[levelIdx].id))
    }
    downAt = { x: e.global.x, y: e.global.y }
    downCell = toCell(e.global.x, e.global.y)
  })
  app.stage.on('pointerup', (e) => {
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
      tw.delay(Math.min(dur, 1200), () => triggerWin())
    } else if (board.lost) {
      inputLocked = true
      tw.delay(900, () => {
        sfx.lose()
        const close = banner('あと少し…', `スコア ${board.score.toLocaleString()}`, 0xc9d4de)
        tw.delay(2000, () => {
          close()
          nextLevel(false)
        })
      })
    }
  })

  const nextLevel = (advance: boolean) => {
    if (advance) levelIdx = (levelIdx + 1) % LEVELS.length
    board = new Board(LEVELS[levelIdx])
    view.board = board
    view.syncAll()
    applyTheme()
    if (bgmStarted) startBgm(themeForLevel(LEVELS[levelIdx].id))
    buildGoals()
    refreshHud()
    inputLocked = false
  }

  /** 勝利シーケンス：大発見バナー→残手数ドレイン＋変換→自動起爆→探索成功パネル（RESEARCH §5） */
  const triggerWin = () => {
    inputLocked = true
    // 1. 「大発見！」バナー（暗転＋約1.6秒）
    const dim = new Graphics()
    dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0 })
    scene.addChild(dim)
    tw.tween(dim, { alpha: 0.45 }, 250)
    const bt = new Container()
    const ribbonTex = spriteTexture('ui_ribbon')
    if (ribbonTex) {
      const rb = new Sprite(ribbonTex)
      rb.anchor.set(0.5)
      rb.scale.set((vw * 0.86) / ribbonTex.width)
      bt.addChild(rb)
    }
    const btText = new Text({
      text: '見事な探窟！',
      style: { fill: 0xf6e7c6, fontSize: fs(0.062), fontFamily: 'serif', fontWeight: 'bold', stroke: { color: 0x4a1717, width: 4 } },
    })
    btText.anchor.set(0.5)
    btText.position.set(0, -vw * 0.035) // リボン本体の帯に載せる
    bt.addChild(btText)
    bt.position.set(vw / 2, vh * 0.45)
    bt.scale.set(0)
    scene.addChild(bt)
    tw.tween(bt.scale, { x: 1, y: 1 }, 320, { ease: tw.easeOutBack })
    tw.delay(1500, () => {
      // バナー退場（約300msスケールアウト・実測準拠）
      tw.tween(bt.scale, { x: 0, y: 0 }, 300, { ease: tw.easeInCubic, onDone: () => bt.destroy() })
      tw.tween(dim, { alpha: 0 }, 150, { onDone: () => dim.destroy() })
      // 2-4. ドレイン→変換→自動起爆
      const evs = board.finishWin()
      const dur = view.play(evs)
      // HUDの残手数を高速ドレイン表示（45ms/手）
      const drains = evs.filter((e) => e.t === 'win-drain')
      drains.forEach((e, i) => {
        tw.delay(i * 45, () => {
          if (e.t === 'win-drain') movesText.text = String(e.movesLeft)
        })
      })
      const scoreTick = () => {
        scoreText.text = `スコア ${board.score.toLocaleString()}`
      }
      tw.delay(dur * 0.5, scoreTick)
      tw.delay(dur, () => {
        scoreTick()
        refreshHud()
        showClearPanel()
      })
    })
  }

  // 5-6. 探索成功パネル（モック③準拠の簡易版）
  const showClearPanel = () => {
    sfx.fanfare()
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
    } else {
      const bg = new Graphics()
      bg.roundRect(px0, py0, pw, ph, 14).fill(UI.paper).stroke({ width: 4, color: UI.woodLight })
      panel.addChild(bg)
    }
    const ribbonTex2 = spriteTexture('ui_ribbon')
    if (ribbonTex2) {
      const rb = new Sprite(ribbonTex2)
      rb.anchor.set(0.5)
      rb.scale.set((pw * 0.8) / ribbonTex2.width)
      rb.position.set(vw / 2, py0 + vh * 0.005)
      panel.addChild(rb)
    }
    const title = new Text({
      text: '探索成功！',
      style: { fill: 0xf6e7c6, fontSize: fs(0.05), fontFamily: 'serif', fontWeight: 'bold', stroke: { color: 0x4a1717, width: 4 } },
    })
    title.anchor.set(0.5)
    title.position.set(vw / 2, py0 - vw * 0.02)
    panel.addChild(title)
    // 星（1つずつバウンドで出す）
    const starY = py0 + ph * 0.24
    for (let i = 0; i < 3; i++) {
      const filled = i < board.stars
      const st = new Text({
        text: '★',
        style: { fill: filled ? 0xf2c14e : 0xcbc2ab, fontSize: fs(filled ? 0.13 : 0.1), fontFamily: 'serif' },
      })
      st.anchor.set(0.5)
      st.position.set(vw / 2 + (i - 1) * pw * 0.24, starY + (i === 1 ? -ph * 0.03 : 0))
      st.scale.set(0)
      panel.addChild(st)
      tw.tween(st.scale, { x: 1, y: 1 }, 300, {
        delay: 200 + i * 180,
        ease: tw.easeOutBack,
        onDone: () => {
          if (filled) sfx.star(i)
        },
      })
    }
    const sc = new Text({
      text: `スコア\n${board.score.toLocaleString()}`,
      style: { fill: UI.paperInk, fontSize: fs(0.055), fontFamily: 'serif', fontWeight: 'bold', align: 'center' },
    })
    sc.anchor.set(0.5)
    sc.position.set(vw / 2, py0 + ph * 0.55)
    panel.addChild(sc)
    // つぎへボタン
    const btn = new Container()
    const bw2 = pw * 0.6
    const bh2 = vh * 0.06
    const bg2 = new Graphics()
    bg2.roundRect(-bw2 / 2, -bh2 / 2, bw2, bh2, 12).fill(0x5d7a3f).stroke({ width: 3, color: 0x3f5429 })
    btn.addChild(bg2)
    const bt2 = new Text({ text: 'つぎへ', style: { fill: 0xf4f8ea, fontSize: fs(0.05), fontFamily: 'serif', fontWeight: 'bold' } })
    bt2.anchor.set(0.5)
    btn.addChild(bt2)
    btn.position.set(vw / 2, py0 + ph * 0.85)
    btn.eventMode = 'static'
    btn.cursor = 'pointer'
    btn.on('pointertap', () => {
      panel.destroy({ children: true })
      nextLevel(true)
    })
    panel.addChild(btn)
    scene.addChild(panel)
  }

  app.ticker.add((t) => tw.update(t.deltaMS))

  // QA用フック
  ;(window as unknown as Record<string, unknown>).__yacho = {
    get board() {
      return board
    },
    view,
    metrics: () => ({ S: view.S, ox: view.root.position.x, oy: view.root.position.y, vw, vh }),
    /** ゴールを達成扱いにして勝利シーケンスを起動（動画撮影・QA用） */
    forceWin: () => {
      board.goals.forEach((g, i) => (board.goalDone[i] = g.count))
      refreshHud()
      triggerWin()
    },
  }
}

boot()
