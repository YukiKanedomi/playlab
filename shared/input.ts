// shared/input.ts — タッチ/マウス統一ポインタ（極薄・任意の道具箱）
// スマホ運用が前提なので「指でなぞる」を最優先に正規化する。
// 使う側は pointer.x / pointer.y / pointer.down を毎フレーム読むだけでよい。

export type Pointer = {
  x: number
  y: number
  down: boolean
  /** down になった瞬間だけ true（押した直後の1フレーム） */
  justPressed: boolean
}

export type PointerHandle = {
  pointer: Pointer
  /** 毎フレームの最後に呼ぶ。justPressed を1フレームで消すため。 */
  endFrame: () => void
  dispose: () => void
}

/**
 * canvas にポインタ入力を取り付ける。CSSピクセル座標（canvas の見た目サイズ基準）で返す。
 * devicePixelRatio でスケールした描画をしていても、ここは CSS 座標で統一。
 */
export function attachPointer(canvas: HTMLCanvasElement): PointerHandle {
  const pointer: Pointer = { x: 0, y: 0, down: false, justPressed: false }

  const setPos = (clientX: number, clientY: number) => {
    const r = canvas.getBoundingClientRect()
    pointer.x = clientX - r.left
    pointer.y = clientY - r.top
  }

  const onDown = (e: PointerEvent) => {
    setPos(e.clientX, e.clientY)
    if (!pointer.down) pointer.justPressed = true
    pointer.down = true
    canvas.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }
  const onMove = (e: PointerEvent) => {
    setPos(e.clientX, e.clientY)
    e.preventDefault()
  }
  const onUp = (e: PointerEvent) => {
    pointer.down = false
    e.preventDefault()
  }

  // touch-action:none を併用してスクロール/ズームを抑止（CSS側でも指定）
  canvas.addEventListener('pointerdown', onDown, { passive: false })
  canvas.addEventListener('pointermove', onMove, { passive: false })
  window.addEventListener('pointerup', onUp, { passive: false })
  window.addEventListener('pointercancel', onUp, { passive: false })

  return {
    pointer,
    endFrame: () => {
      pointer.justPressed = false
    },
    dispose: () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    },
  }
}

// iOS のホームバー等（下部セーフエリア）の高さ。下端のテキスト/HUDが被らないよう
// 各ゲームはこの値ぶん上へ寄せる。初回呼び出しで実測＆resize 追従でキャッシュ更新。
let _safeBottom = -1
function measureSafeBottom() {
  const p = document.createElement('div')
  p.style.cssText =
    'position:fixed;left:0;bottom:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden;'
  document.body.appendChild(p)
  _safeBottom = p.getBoundingClientRect().height || 0
  p.remove()
}
export function safeBottom(): number {
  if (_safeBottom < 0) {
    measureSafeBottom()
    window.addEventListener('resize', measureSafeBottom)
    window.addEventListener('load', measureSafeBottom)
  }
  return _safeBottom
}

/**
 * canvas を親要素いっぱい＋高DPI対応にする。resize に追従。
 * 描画は ctx.scale(dpr,dpr) 済みなので CSSピクセルで描けばよい。
 * onResize には CSSピクセルの (w,h) が渡る。
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  onResize?: (w: number, h: number) => void,
): () => void {
  const ctx = canvas.getContext('2d')!
  const apply = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    canvas.width = Math.round(w * dpr)
    canvas.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    onResize?.(w, h)
  }
  apply()
  // レイアウト/ビューポート確定後に測り直す（初回が誤幅になる事故を防ぐ）
  requestAnimationFrame(apply)
  setTimeout(apply, 120)
  window.addEventListener('load', apply)
  window.addEventListener('resize', apply)
  return () => window.removeEventListener('resize', apply)
}
