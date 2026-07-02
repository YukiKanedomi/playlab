// 『墨戯絵巻』筆線アニマル — 鳥獣戯画の画風に学んで全獣をコードの筆線で描く（絵は自作）。
// 各獣はローカル座標（原点=足元中心、+X=進行方向、体長おおよそ34px）で描き、呼び出し側で平行移動/反転する。
// t はアニメ位相（秒）。線は「運筆の揺れ」として sin でわずかに震わせる。

export const SUMI = '#2f2a26'

type Ctx = CanvasRenderingContext2D

// なめらかな筆線（中点二次ベジェ）。w=基本幅。二度描きで縁を濃く、腹を薄く＝墨の含み。
export function brush(ctx: Ctx, pts: number[][], w: number, alpha = 1) {
  if (pts.length < 2) return
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = SUMI
  for (const [ww, aa] of [
    [w * 1.6, 0.22 * alpha],
    [w, 0.9 * alpha],
  ]) {
    ctx.globalAlpha = aa as number
    ctx.lineWidth = ww as number
    ctx.beginPath()
    ctx.moveTo(pts[0][0], pts[0][1])
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2
      const my = (pts[i][1] + pts[i + 1][1]) / 2
      ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my)
    }
    const l = pts[pts.length - 1]
    ctx.lineTo(l[0], l[1])
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

export function dot(ctx: Ctx, x: number, y: number, r: number, alpha = 0.9) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = SUMI
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fill()
  ctx.globalAlpha = 1
}

// 蛙 — 座り腰の丸い背、大きな目、畳んだ後ろ脚。跳ねるとき脚が伸びる。
export function drawFrog(ctx: Ctx, t: number, hop: number) {
  const j = Math.sin(t * 7) * 0.7
  const up = hop * 8
  ctx.save()
  ctx.translate(0, -up)
  // 背中〜頭
  brush(ctx, [[-16, -2 + j], [-12, -13], [0, -18], [10, -14 + j], [15, -7]], 2.6)
  // 腹
  brush(ctx, [[-13, -1], [-2, 2 + j * 0.5], [10, -1]], 1.8, 0.8)
  // 目（大きく・白抜き）
  ctx.globalAlpha = 0.95
  ctx.strokeStyle = SUMI
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(9, -14, 4.4, 0, Math.PI * 2)
  ctx.stroke()
  dot(ctx, 10, -13.4, 1.6)
  // 口
  brush(ctx, [[12, -7], [17, -6 + j]], 1.6)
  // 前脚
  brush(ctx, [[8, -4], [9, 2 - hop * 3]], 2)
  // 後ろ脚（畳み Z / 跳びで伸び）
  if (hop > 0.15) brush(ctx, [[-12, -4], [-19, 2], [-24, 7]], 2.4)
  else brush(ctx, [[-10, -3], [-17, -6], [-19, 1], [-13, 2]], 2.4)
  ctx.restore()
}

// 兎 — 長い耳を後ろへ流し、跳躍の弧。尾は点。
export function drawRabbit(ctx: Ctx, t: number, air: number) {
  const g = Math.sin(t * 11)
  const stretch = 1 + air * 0.25
  ctx.save()
  ctx.translate(0, -air * 10)
  ctx.scale(stretch, 1 / stretch)
  // 背の弧
  brush(ctx, [[-15, -3], [-10, -12], [2, -15], [11, -11]], 2.6)
  // 頭・鼻先
  brush(ctx, [[11, -11], [17, -8], [18, -5 + g * 0.4]], 2.2)
  // 耳（二枚、後ろへ）
  brush(ctx, [[12, -12], [4, -22], [-2, -26]], 2)
  brush(ctx, [[14, -10], [8, -21], [3, -26]], 1.7, 0.85)
  // 目
  dot(ctx, 13.5, -9.5, 1.3)
  // 脚（走り: 前後に振る／跳び: 伸ばす）
  const k = air > 0.15 ? 1 : g
  brush(ctx, [[9, -4], [12 + k * 3, 2 - air * 4]], 2)
  brush(ctx, [[-11, -3], [-15 - k * 3, 2 - air * 5]], 2.4)
  // 尾
  dot(ctx, -16, -7, 2.2, 0.8)
  ctx.restore()
}

// 猿 — 長い腕、丸い顔の輪郭、くるり尾。墨玉を抱えると腕が前に。
export function drawMonkey(ctx: Ctx, t: number, carry: boolean) {
  const g = Math.sin(t * 9)
  // 胴（前かがみ）
  brush(ctx, [[-12, -4], [-8, -13], [3, -16], [10, -12]], 2.6)
  // 顔（輪郭白抜き）
  ctx.globalAlpha = 0.95
  ctx.strokeStyle = SUMI
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(11, -13, 4.6, 0, Math.PI * 2)
  ctx.stroke()
  dot(ctx, 12.5, -13.5, 1.2)
  brush(ctx, [[9, -10.5], [13, -10]], 1.4)
  // 腕
  if (carry) {
    brush(ctx, [[6, -10], [14, -6], [16, -2]], 2.2)
    dot(ctx, 17, -1, 3.4, 0.85) // 抱えた墨玉
  } else {
    brush(ctx, [[6, -10], [11 + g * 2, -2], [13 + g * 2, 3]], 2.2)
  }
  brush(ctx, [[-6, -10], [-9 - g * 2, -2], [-10 - g * 2, 3]], 2.2)
  // 脚
  brush(ctx, [[-10, -5], [-12, 2]], 2.2)
  // 尾（くるり）
  brush(ctx, [[-12, -8], [-18, -12], [-21, -8], [-18, -5]], 1.7, 0.85)
}

// 猪 — 太い胴、牙、背の剛毛。突進で前傾、ひっくり返ると腹見せ。
export function drawBoar(ctx: Ctx, t: number, charge: number, flip: number) {
  const g = Math.sin(t * 13) * charge
  ctx.save()
  if (flip > 0) {
    ctx.rotate(Math.PI * Math.min(1, flip * 3))
    ctx.translate(0, -10)
  } else {
    ctx.rotate(-charge * 0.12)
  }
  // 胴（どっしり）
  brush(ctx, [[-18, -3], [-16, -14], [-2, -18], [12, -15], [17, -8]], 3.2)
  brush(ctx, [[-17, -2], [-4, 1], [12, -2]], 2.2, 0.85)
  // 鼻先・牙
  brush(ctx, [[17, -8], [22, -6 + g]], 2.6)
  brush(ctx, [[19, -5], [22, -9]], 1.8)
  // 目（小さく怒り）
  dot(ctx, 12, -12, 1.4)
  // 背の剛毛（短いケバ）
  for (let i = 0; i < 5; i++) {
    const x = -13 + i * 5.5
    brush(ctx, [[x, -16 + Math.abs(i - 2) * 1.2], [x - 2, -20 + Math.abs(i - 2)]], 1.4, 0.8)
  }
  // 脚（短く、走りでバタつく）
  const legs = flip > 0 ? Math.sin(t * 20) * 3 : g * 2
  brush(ctx, [[10, -4], [11 + legs, 2]], 2.4)
  brush(ctx, [[-13, -3], [-14 - legs, 2]], 2.4)
  ctx.restore()
}

// 鳥 — 羽ばたく二枚翼、しゅっとした嘴。飛行専用。
export function drawBird(ctx: Ctx, t: number) {
  const flap = Math.sin(t * 12)
  // 胴（しずく）
  brush(ctx, [[-12, 0], [-2, -4], [8, -2]], 2.4)
  // 嘴・頭
  brush(ctx, [[8, -2], [13, -4], [17, -3]], 1.8)
  dot(ctx, 11, -4.5, 1.2)
  // 翼（上下）
  brush(ctx, [[-2, -4], [4, -12 - flap * 7], [12, -15 - flap * 10]], 2.2)
  brush(ctx, [[-3, -2], [2, 4 + flap * 6], [8, 8 + flap * 9]], 1.9, 0.8)
  // 尾羽
  brush(ctx, [[-12, 0], [-18, 2], [-17, -2]], 1.7, 0.85)
}

// 狐 — 細身、尖り耳と鼻先、大きな尾。幻は薄墨で描かれる。
export function drawFox(ctx: Ctx, t: number, ghost: boolean) {
  const g = Math.sin(t * 10)
  const a = ghost ? 0.4 : 1
  // 胴（低く流れる）
  brush(ctx, [[-14, -4], [-6, -10], [6, -10], [12, -7]], 2.4, a)
  // 頭・尖り鼻
  brush(ctx, [[12, -7], [17, -9], [21, -7]], 2, a)
  // 耳（鋭い三角）
  brush(ctx, [[13, -10], [14, -16], [16, -10]], 1.7, a)
  dot(ctx, 16, -8, 1.1, a)
  // 脚（流れる走り）
  brush(ctx, [[8, -4], [10 + g * 3, 2]], 1.9, a)
  brush(ctx, [[-9, -3], [-11 - g * 3, 2]], 1.9, a)
  // 大きな尾（ふさり）
  brush(ctx, [[-13, -6], [-20, -12], [-26, -10], [-27, -5]], 3, a * 0.9)
  dot(ctx, -27.5, -4, 2, a * 0.7)
}

// 鯰（主） — 長い髭、平たい頭、うねる長躯。大物として1.8倍で呼ばれる想定。
export function drawNamazu(ctx: Ctx, t: number, tired: boolean) {
  const w1 = Math.sin(t * (tired ? 2 : 4))
  const w2 = Math.sin(t * (tired ? 2 : 4) - 1.4)
  // 長躯（うねり）
  brush(
    ctx,
    [[-34, w2 * 4 - 2], [-22, -8 + w1 * 3], [-8, -12], [8, -10], [18, -5]],
    4.2,
  )
  brush(ctx, [[-33, w2 * 4 + 1], [-20, 1 + w1 * 3], [-6, 2], [10, 0], [18, -2]], 2.8, 0.85)
  // 平たい頭
  brush(ctx, [[14, -12], [24, -10], [27, -4], [22, 1], [14, 0]], 3)
  // 目（据わり）
  dot(ctx, 21, -7, 1.8)
  if (tired) brush(ctx, [[18, -4], [24, -3]], 1.4) // 疲れの口
  // 長い髭（左右二対、ゆらり）
  brush(ctx, [[26, -6], [34, -10 + w1 * 3], [40, -9 + w2 * 4]], 1.6, 0.9)
  brush(ctx, [[26, -3], [34, 2 + w2 * 3], [40, 4 + w1 * 4]], 1.6, 0.9)
  // 尾びれ
  brush(ctx, [[-34, w2 * 4 - 2], [-40, -7 + w2 * 5], [-39, 4 + w2 * 5]], 2.6, 0.9)
}
