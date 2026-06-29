// shared/shell.ts — 共通の“額装”（任意の道具箱）。実験を「標本」として枠に入れる canvas chrome。
// 紙背景は theme.drawPaperBackground、戻るチップは各ゲームHTML、遷移は transition.ts。
import { LAB, hexA } from './theme'

/** 実験ラベル（左下に小さく EXP番号＋タイトル）。荒い試作も“標本”として意図的に見せる。 */
export function drawExpLabel(ctx: CanvasRenderingContext2D, _W: number, H: number, code: string, title: string) {
  ctx.save()
  ctx.textAlign = 'left'
  ctx.fillStyle = LAB.muted
  ctx.font = `600 11px "Courier New", monospace`
  ctx.fillText(code, 18, H - 26)
  ctx.fillStyle = hexA(LAB.ink, 0.5)
  ctx.font = `600 12px ${LAB.font}`
  ctx.fillText(title, 18, H - 11)
  ctx.restore()
}

const FONT = '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif'

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  if ((ctx as any).roundRect) {
    ctx.beginPath()
    ;(ctx as any).roundRect(x, y, w, h, r)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export type HowTo = {
  title: string
  lines: string[] // あそびかた（1〜3行）
  start: string // 開始CTA
  footer?: string // best など小さく
  accent: string
  ink: string
  muted: string
  panel: string // カード地
  border?: string
  glow?: boolean // ネオン用に見出しを発光
  t?: number // CTA点滅用の時間
  scale?: number // 出現イーズ
}

/** Playlab 共通の「あそびかた」カード（標準の説明画面）。各ゲームは配色だけ渡す。 */
export function drawHowToCard(ctx: CanvasRenderingContext2D, W: number, H: number, o: HowTo) {
  const cw = Math.min(330, W - 36)
  const lh = 27
  const ch = 132 + o.lines.length * lh + (o.footer ? 22 : 0)
  const cx = W / 2
  const top = H * 0.46 - ch / 2
  const s = o.scale ?? 1
  ctx.save()
  ctx.translate(cx, top + ch / 2)
  ctx.scale(s, s)
  ctx.translate(-cx, -(top + ch / 2))
  // 台紙
  roundRectPath(ctx, cx - cw / 2, top, cw, ch, 18)
  ctx.fillStyle = o.panel
  ctx.fill()
  if (o.border) {
    ctx.strokeStyle = o.border
    ctx.lineWidth = 1
    ctx.stroke()
  }
  ctx.textAlign = 'center'
  // タイトル
  if (o.glow) {
    ctx.shadowColor = o.accent
    ctx.shadowBlur = 16
  }
  ctx.fillStyle = o.accent
  ctx.font = `800 26px ${FONT}`
  ctx.fillText(o.title, cx, top + 46)
  ctx.shadowBlur = 0
  // 見出し
  ctx.fillStyle = o.muted
  ctx.font = `700 11px ${FONT}`
  ctx.save()
  ;(ctx as any).letterSpacing = '0.18em'
  ctx.fillText('あ そ び か た', cx, top + 72)
  ctx.restore()
  // 行
  ctx.fillStyle = o.ink
  ctx.font = `500 14px ${FONT}`
  o.lines.forEach((l, i) => ctx.fillText(l, cx, top + 100 + i * lh))
  // footer
  let by = top + ch - 20
  if (o.footer) {
    ctx.fillStyle = o.muted
    ctx.font = `600 12px ${FONT}`
    ctx.fillText(o.footer, cx, by - 24)
  }
  // 開始CTA（点滅）
  const pulse = o.t != null ? 0.65 + 0.35 * Math.sin(o.t * 4) : 1
  ctx.globalAlpha = pulse
  ctx.fillStyle = o.accent
  ctx.font = `800 16px ${FONT}`
  ctx.fillText(o.start, cx, by)
  ctx.globalAlpha = 1
  ctx.restore()
}

/** タイトル/結果の中央パネル（薄い台紙＋見出し＋数行）。scale で出現アニメに使える。 */
export function drawPanel(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  title: string,
  lines: string[],
  accent: string,
  scale = 1,
) {
  ctx.save()
  ctx.translate(W / 2, H * 0.42)
  ctx.scale(scale, scale)
  ctx.textAlign = 'center'
  ctx.fillStyle = accent
  ctx.font = `800 clamp(30px, 8.5vw, 46px) ${LAB.font}`
  ctx.fillText(title, 0, 0)
  ctx.fillStyle = LAB.muted
  ctx.font = `500 15px ${LAB.font}`
  lines.forEach((l, i) => ctx.fillText(l, 0, 40 + i * 25))
  ctx.restore()
}
