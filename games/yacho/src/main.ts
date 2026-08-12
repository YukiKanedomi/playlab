// 『そろえて、しるす。』エントリ。AD v2（user_master モック準拠）のHUDレイアウト。
import { Application, Container, Graphics, Sprite, Text } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS } from './core/levels'
import { BoardView } from './view/BoardView'
import { PAL, loadSprites, pieceTexture, spriteTexture, themeForLevel } from './view/pieces'
import type { Goal } from './core/types'
import * as tw from './juice/tween'

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

  // 左上: MOVES バッジ（木札＋真鍮縁）
  const badgeW = vw * 0.19
  const badgeH = vw * 0.19
  const badge = new Graphics()
  badge.roundRect(0, 0, badgeW, badgeH, 10).fill(UI.wood).stroke({ width: 3, color: UI.brass })
  badge.roundRect(0, 0, badgeW, badgeH * 0.36, 10).fill(UI.woodLight)
  badge.position.set(vw * 0.03, vh * 0.03)
  const movesLabel = new Text({ text: 'のこり', style: { fill: UI.badgeText, fontSize: fs(0.032), fontFamily: 'serif' } })
  movesLabel.anchor.set(0.5)
  movesLabel.position.set(vw * 0.03 + badgeW / 2, vh * 0.03 + badgeH * 0.18)
  const movesText = new Text({
    text: '',
    style: { fill: UI.badgeText, fontSize: fs(0.075), fontFamily: 'serif', fontWeight: 'bold' },
  })
  movesText.anchor.set(0.5)
  movesText.position.set(vw * 0.03 + badgeW / 2, vh * 0.03 + badgeH * 0.64)
  ui.addChild(badge, movesLabel, movesText)

  // スコア（バッジ下に小さく）
  const scoreText = new Text({
    text: '',
    style: { fill: UI.badgeText, fontSize: fs(0.032), fontFamily: 'serif', stroke: { color: 0x2a2013, width: 3 } },
  })
  scoreText.position.set(vw * 0.03, vh * 0.03 + badgeH + 8)
  ui.addChild(scoreText)

  // 右上: 歯車（設定・現状ダミー）
  const gear = new Graphics()
  const gr = vw * 0.045
  gear.circle(0, 0, gr).fill(UI.wood).stroke({ width: 3, color: UI.brass })
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2
    gear.roundRect(Math.cos(a) * gr - gr * 0.13, Math.sin(a) * gr - gr * 0.13, gr * 0.26, gr * 0.26, gr * 0.08).fill(UI.brass)
  }
  gear.circle(0, 0, gr * 0.4).fill(UI.woodLight)
  gear.position.set(vw * 0.93, vh * 0.03 + gr)
  ui.addChild(gear)

  // 上中央〜右: ターゲット札（羊皮紙）
  const tpW = vw * 0.52
  const tpH = badgeH
  const tp = new Container()
  const tpBg = new Graphics()
  tpBg.roundRect(0, 0, tpW, tpH, 10).fill(UI.paper).stroke({ width: 3, color: UI.woodLight })
  tpBg.roundRect(tpW * 0.28, -tpH * 0.22, tpW * 0.44, tpH * 0.3, 8).fill(UI.wood).stroke({ width: 2, color: UI.brass })
  tp.addChild(tpBg)
  const tpLabel = new Text({ text: 'ターゲット', style: { fill: UI.badgeText, fontSize: fs(0.03), fontFamily: 'serif' } })
  tpLabel.anchor.set(0.5)
  tpLabel.position.set(tpW / 2, -tpH * 0.07)
  tp.addChild(tpLabel)
  tp.position.set(vw * 0.28, vh * 0.03 + tpH * 0.12)
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
      const s = (tpH * 0.42) / Math.max(sp.texture.width, sp.texture.height)
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
    for (const gi of goalItems) gi.icon.destroy()
    goalItems.length = 0
    board.goals.forEach((g, i) => {
      const icon = goalIcon(g)
      const cx = tpW * (0.5 + (i - (board.goals.length - 1) / 2) * 0.34)
      icon.position.set(cx - tpW * 0.1, tpH * 0.55)
      const count = new Text({
        text: '',
        style: { fill: UI.paperInk, fontSize: fs(0.048), fontFamily: 'serif', fontWeight: 'bold' },
      })
      count.anchor.set(0, 0.5)
      count.position.set(cx + tpW * 0.01, tpH * 0.55)
      tp.addChild(icon)
      tp.addChild(count)
      goalItems.push({ icon, count, idx: i })
    })
  }

  // 下段: ブースター帯（メダリオン3・現状は飾り。Phase 3 で機能接続）
  const boosterBar = new Container()
  const medalKeys = ['harpoon', 'hitsubo', 'seiju']
  medalKeys.forEach((k, i) => {
    const m = new Container()
    const r = vw * 0.075
    const g = new Graphics()
    g.circle(0, 0, r).fill(UI.wood).stroke({ width: 4, color: UI.brass })
    g.circle(0, 0, r * 0.8).stroke({ width: 2, color: UI.woodLight })
    m.addChild(g)
    const tex = spriteTexture(k)
    if (tex) {
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set((r * 1.1) / Math.max(tex.width, tex.height))
      m.addChild(sp)
    }
    const cb = new Graphics()
    cb.circle(r * 0.72, r * 0.72, r * 0.3).fill(UI.paper).stroke({ width: 2, color: UI.woodLight })
    m.addChild(cb)
    const ct = new Text({ text: '0', style: { fill: UI.paperInk, fontSize: fs(0.035), fontFamily: 'serif', fontWeight: 'bold' } })
    ct.anchor.set(0.5)
    ct.position.set(r * 0.72, r * 0.72)
    m.addChild(ct)
    m.alpha = 0.55
    m.position.set(vw / 2 + (i - 1) * vw * 0.2, 0)
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
  app.stage.on('pointerdown', (e) => {
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
    const dur = view.play(evs)
    refreshHud()
    if (board.won) {
      inputLocked = true
      tw.delay(Math.min(dur, 1200), () => triggerWin())
    } else if (board.lost) {
      inputLocked = true
      tw.delay(900, () => {
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
    const bt = new Text({
      text: '大 発 見 ！',
      style: { fill: UI.brass, fontSize: fs(0.1), fontFamily: 'serif', fontWeight: 'bold', stroke: { color: 0x2a1c0e, width: 6 } },
    })
    bt.anchor.set(0.5)
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
    const panel = new Container()
    const dim = new Graphics()
    dim.rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0.55 })
    panel.addChild(dim)
    const pw = vw * 0.78
    const ph = vh * 0.42
    const px0 = (vw - pw) / 2
    const py0 = vh * 0.24
    const bg = new Graphics()
    bg.roundRect(px0, py0, pw, ph, 14).fill(UI.paper).stroke({ width: 4, color: UI.woodLight })
    // リボンバナー
    bg.roundRect(px0 + pw * 0.12, py0 - vh * 0.035, pw * 0.76, vh * 0.07, 10).fill(0x7d4f3a).stroke({ width: 3, color: UI.brass })
    panel.addChild(bg)
    const title = new Text({
      text: '探索成功！',
      style: { fill: UI.badgeText, fontSize: fs(0.06), fontFamily: 'serif', fontWeight: 'bold' },
    })
    title.anchor.set(0.5)
    title.position.set(vw / 2, py0)
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
      tw.tween(st.scale, { x: 1, y: 1 }, 300, { delay: 200 + i * 180, ease: tw.easeOutBack })
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
