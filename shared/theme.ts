// shared/theme.ts — Playlab「ラボ・スキン」（任意の道具箱）
// ハブ（実験ノート調）と地続きの“初期デザイン”。各ゲームはデザインが固まるまでこれで描き、
// 固まったら独自の絵に卒業してよい。紙×インク×琥珀＋にじみ（加算発光は使わない＝明るい紙の上でも映える）。

export const LAB = {
  paper: '#f3efe6',
  paperEdge: '#e7e0d0', // 周辺をわずかに沈める用
  ink: '#181713',
  muted: '#76726a',
  amber: '#c2701c',
  line: 'rgba(24,23,19,0.09)', // 方眼
  danger: '#9b2f2f', // 失敗・残り時間わずか
  font: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", system-ui, sans-serif',
}

// 光/標本の色：原色を避けた、紙に映えるくすんだ宝石色（多色）
export const SPECIMEN_COLORS = ['#c2701c', '#b1492e', '#2f7d6b', '#6d4b8c', '#c99a2e', '#3f6f9c']

// #rrggbb → rgba(,a)
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

/** 紙＋方眼の背景。周辺を軽く沈めて中央に視線を集める。 */
export function drawPaperBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = LAB.paper
  ctx.fillRect(0, 0, w, h)
  // 周辺の沈み（紙のヴィネット）
  const g = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.2, w / 2, h * 0.5, Math.max(w, h) * 0.72)
  g.addColorStop(0, 'rgba(0,0,0,0)')
  g.addColorStop(1, 'rgba(40,34,22,0.12)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // 方眼
  ctx.strokeStyle = LAB.line
  ctx.lineWidth = 1
  ctx.beginPath()
  const step = 28
  for (let x = (w % step) / 2; x < w; x += step) {
    ctx.moveTo(Math.round(x) + 0.5, 0)
    ctx.lineTo(Math.round(x) + 0.5, h)
  }
  for (let y = (h % step) / 2; y < h; y += step) {
    ctx.moveTo(0, Math.round(y) + 0.5)
    ctx.lineTo(w, Math.round(y) + 0.5)
  }
  ctx.stroke()
}

/** 紙の上の“標本”ドット（インク＋にじみ＋ハイライト）。加算は使わない。 */
export function drawSpecimen(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  const aura = ctx.createRadialGradient(x, y, 0, x, y, r * 2.3)
  aura.addColorStop(0, hexA(color, 0.3))
  aura.addColorStop(1, hexA(color, 0))
  ctx.fillStyle = aura
  ctx.beginPath()
  ctx.arc(x, y, r * 2.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.arc(x - r * 0.3, y - r * 0.32, r * 0.3, 0, Math.PI * 2)
  ctx.fill()
}
