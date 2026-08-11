// 『そろえて、しるす。』エントリ。Phase 2: プレースホルダー駒での試遊ビルド。
import { Application, Container, Graphics, Text } from 'pixi.js'
import { Board, W, H } from './core/board'
import { LEVELS } from './core/levels'
import { BoardView } from './view/BoardView'
import { PAL } from './view/pieces'
import * as tw from './juice/tween'

const app = new Application()

async function boot() {
  await app.init({ background: PAL.boardBg, resizeTo: window, antialias: true, resolution: Math.min(2, devicePixelRatio) })
  document.getElementById('app')!.appendChild(app.canvas)

  let levelIdx = 0
  let board = new Board(LEVELS[levelIdx])
  const scene = new Container()
  app.stage.addChild(scene)

  // レイアウト: 縦画面基準。盤は幅の94%
  const vw = app.screen.width
  const vh = app.screen.height
  const boardSize = Math.min(vw * 0.94, vh * 0.62)
  const view = new BoardView(board, app.renderer, boardSize)
  const bw = view.S * W // 実際の盤幅（floor後）で中央寄せ
  view.root.position.set((vw - bw) / 2, vh * 0.2)
  scene.addChild(view.root)

  // HUD（Phase 2 は素朴に）
  const hud = new Text({ text: '', style: { fill: 0xe8d9b0, fontSize: Math.max(16, vw * 0.045), fontFamily: 'serif' } })
  hud.position.set(vw * 0.05, vh * 0.06)
  scene.addChild(hud)
  const goalText = () =>
    board.goals
      .map((g, i) => {
        const name =
          g.type === 'color'
            ? ['陽盤', '芽石', '雫瓶', '月角', '花石'][g.color!]
            : { kokeishi: '苔石', tsutagoke: '蔦苔', touhen: '陶片', spore: '光胞子' }[g.type]
        return `${name} ${Math.min(board.goalDone[i], g.count)}/${g.count}`
      })
      .join('　')
  const refreshHud = () => {
    hud.text = `Lv${LEVELS[levelIdx].id}　のこり ${board.movesLeft} 手\n${goalText()}`
  }
  refreshHud()

  const banner = (msg: string, color: number) => {
    const g = new Graphics()
    g.roundRect(vw * 0.1, vh * 0.42, vw * 0.8, vh * 0.12, 16).fill({ color: 0x0e1b28, alpha: 0.92 })
    g.roundRect(vw * 0.1, vh * 0.42, vw * 0.8, vh * 0.12, 16).stroke({ width: 3, color })
    const t = new Text({
      text: msg,
      style: { fill: color, fontSize: vw * 0.07, fontFamily: 'serif', fontWeight: 'bold' },
    })
    t.anchor.set(0.5)
    t.position.set(vw / 2, vh * 0.48)
    scene.addChild(g, t)
    return () => {
      g.destroy()
      t.destroy()
    }
  }

  // 入力: スワイプでスワップ / 特殊駒タップ
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
      // タップ: 特殊駒発動
      const c = board.at(downCell.x, downCell.y)
      if (c?.piece && c.piece.kind !== 'normal' && c.piece.kind !== 'spore') evs = board.tap(downCell)
    } else {
      const dir = Math.abs(dx) > Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) }
      evs = board.swap(downCell, { x: downCell.x + dir.x, y: downCell.y + dir.y })
    }
    downAt = null
    downCell = null
    if (evs.length === 0) return
    view.play(evs)
    refreshHud()
    if (board.won || board.lost) {
      inputLocked = true
      tw.delay(900, () => {
        const close = banner(board.won ? '記 録 完 了' : 'あと少し…', board.won ? PAL.brass : 0xc9d4de)
        tw.delay(1600, () => {
          close()
          if (board.won) levelIdx = (levelIdx + 1) % LEVELS.length
          board = new Board(LEVELS[levelIdx])
          view.board = board
          view.syncAll()
          refreshHud()
          inputLocked = false
        })
      })
    }
  })

  app.ticker.add((t) => tw.update(t.deltaMS))

  // QA用フック（自動テスト・motion-capture が触る）
  ;(window as unknown as Record<string, unknown>).__yacho = {
    get board() {
      return board
    },
    view,
    swap: (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const evs = board.swap(a, b)
      view.play(evs)
      refreshHud()
      return evs.length
    },
    metrics: () => ({ S: view.S, ox: view.root.position.x, oy: view.root.position.y, vw, vh }),
  }
}

boot()
