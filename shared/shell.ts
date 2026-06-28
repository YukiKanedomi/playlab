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
