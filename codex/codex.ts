// codex/codex.ts — Playlab Codex（遊びの設計ノート）
// 調べたゲーム制作のセオリーを「触って確かめられる・動く」ノートに。
// 出典/全文は ~/.claude/skills/game-design（5本のリファレンス）。ここは“見せる”要約。
import { enterTransition, wireLink } from '../shared/transition'
import { Particles, makeShake, clamp, easeOutCubic } from '../shared/juice'

const C = { ink: '#181713', amber: '#c2701c', teal: '#2f7d6b', muted: '#76726a', paper: '#f3efe6', danger: '#9b2f2f', line: 'rgba(24,23,19,0.12)' }
const FONT = '"Hiragino Sans","Yu Gothic",system-ui,sans-serif'
const app = document.getElementById('app')!

document.querySelectorAll<HTMLAnchorElement>('a.back').forEach(wireLink)
enterTransition()

// ── 小さなDOMヘルパー ──
function h(tag: string, cls?: string, html?: string): HTMLElement {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (html != null) e.innerHTML = html
  return e
}

// ── キャンバス・ウィジェット基盤（1つのrAFで全部描く。閉じてる/画面外はスキップ） ──
type Widget = { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; aspect: number; cw: number; ch: number; t: number; draw: (w: Widget, t: number, dt: number) => void }
const widgets: Widget[] = []
function mkCanvas(parent: HTMLElement, aspect: number, draw: Widget['draw']): Widget {
  const canvas = h('canvas') as HTMLCanvasElement
  parent.appendChild(canvas)
  const w: Widget = { canvas, ctx: canvas.getContext('2d')!, aspect, cw: 0, ch: 0, t: 0, draw }
  widgets.push(w)
  return w
}
function refit(w: Widget) {
  const cssW = w.canvas.clientWidth
  if (cssW && cssW !== w.cw) {
    w.cw = cssW
    w.ch = Math.round(cssW * w.aspect)
    w.canvas.style.height = w.ch + 'px'
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    w.canvas.width = cssW * dpr
    w.canvas.height = w.ch * dpr
    w.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  }
}
let last = performance.now()
function loop(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000)
  last = now
  for (const w of widgets) {
    if (w.canvas.clientWidth === 0) continue // details が閉じている等
    refit(w)
    if (!w.cw) continue
    w.t += dt
    w.draw(w, w.t, dt)
  }
  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)

const hexA = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
}

// ════════════════════ ページ構築 ════════════════════

// ヒーロー
app.appendChild(
  h(
    'div',
    'hero reveal',
    `<p class="kicker">Playlab Codex</p>
     <h1 class="title"><span class="ink">遊びの</span><span class="am">設計ノート</span></h1>
     <p class="lead">「何を・どう面白くするか」の研究メモ。読むより、触って確かめる。
     根本の面白さ／レベル/手触り/見た目、そして桜井政博の方法論まで。</p>`,
  ),
)

// ひとつの法則
app.appendChild(
  h(
    'div',
    'law reveal',
    `<small>THE ONE LAW</small><b>で、これ<span class="beat">遊んで楽しい？</span></b>`,
  ),
)

// ── 体感デモ（juice） ──
{
  const sec = h('section', 'reveal')
  sec.appendChild(h('p', 'eyebrow', 'さわって、たしかめる'))
  sec.appendChild(h('h2', 'sec', '手触り（juice）は“返し”で決まる'))
  sec.appendChild(h('p', 'note', '入力に即・派手に反応が返ると気持ちいい。下を何度でもタップ。揺れ・粒子・スケールの“ぷるん”を体感。'))
  const demo = h('div', 'demo')
  sec.appendChild(demo)
  const cap = h('div', 'cap', '<b>タップ</b>＝細胞がぷるんと弾けて、粒子＋画面揺れで返ってくる')
  // juice プレイグラウンド
  const fx = new Particles()
  const shake = makeShake(18)
  let pop = 0
  let tapped = false
  const blobs: { x: number; y: number; pop: number }[] = []
  const wj = mkCanvas(demo, 0.62, (w, t) => {
    const { ctx, cw, ch } = w
    ctx.save()
    ctx.clearRect(0, 0, cw, ch)
    ctx.fillStyle = hexA(C.ink, 0.02)
    ctx.fillRect(0, 0, cw, ch)
    shake.update(1 / 60)
    fx.update(1 / 60)
    ctx.save()
    shake.apply(ctx)
    // 中央のメイン細胞
    pop = pop + (0 - pop) * 0.12
    drawBlob(ctx, cw / 2, ch / 2, 26 * (1 + pop * 0.5), C.teal, t)
    for (const b of blobs) {
      b.pop = b.pop + (0 - b.pop) * 0.1
      if (b.pop > 0.02) drawBlob(ctx, b.x, b.y, 14 * (1 + b.pop), C.amber, t + b.x)
    }
    fx.draw(ctx)
    ctx.restore()
    if (!tapped) {
      ctx.fillStyle = hexA(C.muted, 0.9)
      ctx.font = `700 14px ${FONT}`
      ctx.textAlign = 'center'
      ctx.fillText('タップしてみて', cw / 2, ch - 16)
    }
    ctx.restore()
  })
  const tap = (e: PointerEvent) => {
    const r = wj.canvas.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    tapped = true
    fx.burst(x, y, 16, Math.random() < 0.5 ? C.amber : C.teal, 220)
    shake.add(7)
    pop = 1
    blobs.push({ x, y, pop: 1 })
    if (blobs.length > 6) blobs.shift()
    e.preventDefault()
  }
  wj.canvas.addEventListener('pointerdown', tap, { passive: false })
  demo.appendChild(cap)
  app.appendChild(sec)
}

// ── 章 ──
type Chap = { no: string; title: string; bullets: string[]; mount?: (host: HTMLElement) => void }
function chapter(c: Chap, open = false) {
  const d = h('details', 'chap reveal') as HTMLDetailsElement
  if (open) d.open = true
  const sum = h('summary')
  sum.innerHTML = `<span class="cno">${c.no}</span><span class="ctitle">${c.title}</span><span class="chev">▸</span>`
  d.appendChild(sum)
  const body = h('div', 'body')
  const ul = h('ul')
  for (const b of c.bullets) ul.appendChild(h('li', undefined, b))
  body.appendChild(ul)
  if (c.mount) {
    const mini = h('div', 'mini demo')
    body.appendChild(mini)
    c.mount(mini)
  }
  d.appendChild(body)
  app.appendChild(d)
}

const secWrap = h('section', 'reveal')
secWrap.appendChild(h('p', 'eyebrow', '5つの柱'))
secWrap.appendChild(h('h2', 'sec', '面白さは、ひとつの体系だった'))
secWrap.appendChild(h('p', 'note', 'タップで開く。図は動く。'))
app.appendChild(secWrap)

// 1. 根本の面白さ（リスク&リターン interactive ＋ フロー図）
chapter(
  {
    no: '01',
    title: '根本の面白さ',
    bullets: [
      '<b>リスクとリターン</b>：攻めるほど得だが事故る。これが同じ操作の上に・近い距離であるほど中毒的。これが無いと“作業”になる。',
      '<b>意味のある選択</b>（Sid Meier）：自動で最適が決まる所は選択じゃない。',
      '<b>Theory of Fun</b>（Koster）：面白さ＝脳がパターンを学ぶ快感。学びが尽きると退屈。',
      '<b>MDA</b>：届けたい感情を先に決め、動作→ルールへ逆算する。',
    ],
    mount: (host) => {
      // リスク&リターン：押し続けるほど賭け↑、危険ラインを越えると事故。離すと確定。
      let charge = 0
      let danger = 0.55 + Math.random() * 0.4
      let total = 0
      let holding = false
      let flash = 0
      let flashCol = C.teal
      let msg = '長押しで賭ける → 離して確定'
      const w = mkCanvas(host, 0.5, (wd, _t, dt) => {
        const { ctx, cw, ch } = wd
        ctx.clearRect(0, 0, cw, ch)
        if (holding) {
          charge += dt / 1.6
          if (charge >= danger) {
            // 事故
            flash = 1
            flashCol = C.danger
            msg = '事故！ 賭けが弾けた'
            charge = 0
            danger = 0.55 + Math.random() * 0.4
            holding = false
          }
        }
        flash = Math.max(0, flash - dt * 2)
        const pad = 18
        const barW = cw - pad * 2
        const y = ch * 0.5
        // バー背景
        ctx.fillStyle = hexA(C.ink, 0.08)
        ctx.fillRect(pad, y - 12, barW, 24)
        // リターン（charge）
        ctx.fillStyle = C.teal
        ctx.fillRect(pad, y - 12, barW * clamp(charge, 0, 1), 24)
        // 危険ライン
        const dx = pad + barW * danger
        ctx.strokeStyle = C.danger
        ctx.lineWidth = 2
        ctx.beginPath()
        ctx.moveTo(dx, y - 18)
        ctx.lineTo(dx, y + 18)
        ctx.stroke()
        ctx.fillStyle = C.danger
        ctx.font = `700 10px ${FONT}`
        ctx.textAlign = 'center'
        ctx.fillText('危険', dx, y - 22)
        // ラベル
        ctx.fillStyle = C.muted
        ctx.font = `700 12px ${FONT}`
        ctx.textAlign = 'left'
        ctx.fillText('リターン', pad, y - 22)
        ctx.textAlign = 'right'
        ctx.fillStyle = C.ink
        ctx.font = `800 14px ${FONT}`
        ctx.fillText('得点 ' + total, cw - pad, ch - 14)
        ctx.textAlign = 'center'
        ctx.fillStyle = flash > 0 ? flashCol : C.muted
        ctx.font = `700 13px ${FONT}`
        ctx.fillText(msg, cw / 2, 22)
        if (flash > 0) {
          ctx.fillStyle = hexA(flashCol, flash * 0.18)
          ctx.fillRect(0, 0, cw, ch)
        }
      })
      const down = (e: PointerEvent) => { holding = true; e.preventDefault() }
      const up = (e: PointerEvent) => {
        if (holding && charge > 0) {
          total += Math.round(charge * 100)
          flash = 1
          flashCol = C.teal
          msg = '+' + Math.round(charge * 100) + ' 確定！'
          charge = 0
          danger = 0.55 + Math.random() * 0.4
        }
        holding = false
        e.preventDefault()
      }
      w.canvas.addEventListener('pointerdown', down, { passive: false })
      window.addEventListener('pointerup', up, { passive: false })
      host.appendChild(h('div', 'cap', '<b>リスク&リターン</b>：押すほど得、でも危険ラインを越えると全部パー。離して確定。'))
    },
  },
  true,
)

// フロー図（独立セクションの図として根本の下に）
{
  const sec = h('section', 'reveal')
  sec.appendChild(h('p', 'eyebrow', '難易度の置きどころ'))
  sec.appendChild(h('h2', 'sec', 'フロー：能力と挑戦の釣り合い'))
  sec.appendChild(h('p', 'note', '退屈と不安のあいだの帯（フロー）に居続けると没入する。点はその帯を漂う。'))
  const demo = h('div', 'demo')
  sec.appendChild(demo)
  mkCanvas(demo, 0.5, (w, t) => {
    const { ctx, cw, ch } = w
    ctx.clearRect(0, 0, cw, ch)
    const pad = 26
    // 軸
    ctx.strokeStyle = hexA(C.ink, 0.25)
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(pad, pad * 0.4)
    ctx.lineTo(pad, ch - pad)
    ctx.lineTo(cw - pad * 0.4, ch - pad)
    ctx.stroke()
    // フロー帯（対角）
    ctx.fillStyle = hexA(C.teal, 0.16)
    ctx.beginPath()
    ctx.moveTo(pad, ch - pad)
    ctx.lineTo(cw - pad, pad * 0.4)
    ctx.lineTo(cw - pad, pad * 0.4 + 40)
    ctx.lineTo(pad, ch - pad - 40 < pad ? pad : ch - pad - 40)
    ctx.closePath()
    ctx.fill()
    ctx.fillStyle = C.muted
    ctx.font = `600 11px ${FONT}`
    ctx.textAlign = 'left'
    ctx.fillText('挑戦＞能力＝不安', pad + 6, pad * 0.4 + 12)
    ctx.textAlign = 'right'
    ctx.fillText('能力＞挑戦＝退屈', cw - pad - 4, ch - pad - 8)
    ctx.save()
    ctx.fillStyle = C.teal
    ctx.font = `800 12px ${FONT}`
    ctx.textAlign = 'center'
    ctx.fillText('フロー', cw / 2, ch / 2)
    ctx.restore()
    // 帯を漂う点（対角線＋揺れ）
    const p = (Math.sin(t * 0.6) * 0.5 + 0.5)
    const lx = pad + (cw - pad * 2) * p
    const ly = ch - pad - (ch - pad * 1.4) * p + Math.sin(t * 2.2) * 10
    ctx.fillStyle = C.amber
    ctx.beginPath()
    ctx.arc(lx, ly, 6, 0, Math.PI * 2)
    ctx.fill()
  })
  demo.appendChild(h('div', 'cap', '難しすぎ＝不安／簡単すぎ＝退屈。<b>のこぎり波</b>で山と谷を作り、この帯を保つ。'))
  app.appendChild(sec)
}

// 2. レベルデザイン（のこぎり波アニメ）
chapter({
  no: '02',
  title: 'レベルデザインとペース',
  bullets: [
    '<b>構造で教える</b>：マリオ1-1のように、言葉でなく配置でルールを伝える。最初の失敗は低コストに。',
    '<b>起承転結</b>：導入→展開→“既存要素の意外な組合せ”でひねり→締め。',
    '<b>のこぎり波</b>：単調上昇は燃え尽きる。山と谷の周期で“呼吸”させる。',
    '<b>少ない要素を掛け算</b>：ルールを増やすより、組合せで深さを出す。',
  ],
  mount: (host) => {
    mkCanvas(host, 0.45, (w, t) => {
      const { ctx, cw, ch } = w
      ctx.clearRect(0, 0, cw, ch)
      const pad = 18
      ctx.strokeStyle = hexA(C.ink, 0.2)
      ctx.beginPath()
      ctx.moveTo(pad, ch - pad)
      ctx.lineTo(cw - pad, ch - pad)
      ctx.stroke()
      // のこぎり波：3つの山（谷で少しリセット）
      const W = cw - pad * 2
      const baseY = ch - pad
      const amp = ch - pad * 2.2
      const pts: [number, number][] = []
      const cycles = 3
      for (let i = 0; i <= 120; i++) {
        const f = i / 120
        const ph = (f * cycles) % 1
        const env = 0.35 + 0.65 * f // 全体は徐々に上がる
        const v = ph * env // 山は上がってストンと谷
        pts.push([pad + W * f, baseY - amp * v])
      }
      ctx.strokeStyle = C.amber
      ctx.lineWidth = 2.5
      ctx.beginPath()
      pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])))
      ctx.stroke()
      // 進行する点
      const f = (Math.sin(t * 0.4) * 0.5 + 0.5)
      const idx = Math.floor(f * (pts.length - 1))
      const pt = pts[idx]
      ctx.fillStyle = C.teal
      ctx.beginPath()
      ctx.arc(pt[0], pt[1], 6, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = C.muted
      ctx.font = `600 11px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText('難易度', pad, pad)
      ctx.textAlign = 'right'
      ctx.fillText('時間 →', cw - pad, ch - 4)
    })
    host.appendChild(h('div', 'cap', '<b>のこぎり波</b>：山(挑戦)→谷(休憩)を繰り返しつつ、全体は少しずつ上昇。'))
  },
})

// 3. 手触り（イージング比較アニメ）
chapter({
  no: '03',
  title: '手触り（juice）',
  bullets: [
    '<b>無反応をなくす</b>：あらゆる入力に即フィードバック（音・色・揺れ）。',
    '<b>最強の3点</b>：効果音／ヒット時の粒子／画面揺れ（必ず減衰）。',
    '<b>ヒットストップ</b>：当たった瞬間に数フレーム止めると“効いた”感。',
    '<b>メリハリ</b>：普段は静か→決め所で一気に。常時派手は禁物。',
  ],
  mount: (host) => {
    mkCanvas(host, 0.4, (w, t) => {
      const { ctx, cw, ch } = w
      ctx.clearRect(0, 0, cw, ch)
      const pad = 16
      const cyc = (t % 2) / 2 // 0..1 で2秒ループ
      const p = clamp(cyc * 1.4, 0, 1)
      const x0 = pad
      const x1 = cw - pad - 14
      // リニア
      const yL = ch * 0.36
      ctx.fillStyle = hexA(C.ink, 0.35)
      ctx.beginPath()
      ctx.arc(x0 + (x1 - x0) * p, yL, 8, 0, Math.PI * 2)
      ctx.fill()
      // イーズアウト
      const yE = ch * 0.7
      ctx.fillStyle = C.amber
      ctx.beginPath()
      ctx.arc(x0 + (x1 - x0) * easeOutCubic(p), yE, 8 * (1 + (1 - p) * 0.3), 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = C.muted
      ctx.font = `700 12px ${FONT}`
      ctx.textAlign = 'left'
      ctx.fillText('リニア（味がない）', pad, yL - 14)
      ctx.fillStyle = C.amber
      ctx.fillText('イーズアウト（生きてる）', pad, yE - 14)
    })
    host.appendChild(h('div', 'cap', '同じ移動でも<b>イージング</b>で“慣性”が出て生きて見える。'))
  },
})

// 4. 見た目（限定パレットの呼吸）
chapter({
  no: '04',
  title: '見た目（個性）',
  bullets: [
    '<b>明度が先</b>：グレースケールにしても見分けられるか（色より明暗）。',
    '<b>限定パレット＋一貫モチーフ</b>：制限が個性をつくる。',
    '<b>“AIっぽい没個性”を避ける</b>：絵文字多用・無目的なグラデ・安易な紫・量産フォント・無意味な装飾を避ける。',
    '<b>Simple ≠ Generic</b>：シンプルさに“意図”があるか。',
  ],
  mount: (host) => {
    const pal = ['#c2701c', '#2f7d6b', '#b1492e', '#6d4b8c', '#c99a2e', '#3f6f9c']
    mkCanvas(host, 0.32, (w, t) => {
      const { ctx, cw, ch } = w
      ctx.clearRect(0, 0, cw, ch)
      const pad = 16
      const n = pal.length
      const gap = 8
      const sw = (cw - pad * 2 - gap * (n - 1)) / n
      for (let i = 0; i < n; i++) {
        const pop = 0.5 + 0.5 * Math.sin(t * 2 - i * 0.6)
        const yy = ch / 2 - sw / 2 + (1 - pop) * 6
        ctx.fillStyle = hexA(pal[i], 0.35 + pop * 0.5)
        ctx.fillRect(pad + i * (sw + gap), yy, sw, sw)
        ctx.strokeStyle = pal[i]
        ctx.lineWidth = 1.5
        ctx.strokeRect(pad + i * (sw + gap), yy, sw, sw)
      }
    })
    host.appendChild(h('div', 'cap', '原色を避けた“くすんだ宝石色”を少数。<b>意図ある制限</b>が作風になる。'))
  },
})

// 5. 桜井政博
chapter({
  no: '05',
  title: '桜井政博の方法論',
  bullets: [
    '<b>プレイヤー視点が最上位</b>：開発者でなく遊ぶ人のために。',
    '<b>ゲーム性＝リスクとリターン</b>／<b>ストレスと解放</b>（ためて放つ）。',
    '<b>無反応を排除／音は妥協しない</b>。誇張した“フィクションの音”が重く感じる。',
    '<b>間口は広く、天井は高く</b>（Kirbyism）。難度は強制せず、失敗で辱めない。',
    '<b>遅さは罪</b>：即リトライ。短く凝縮＞長く水増し（＝モバイル向き）。',
  ],
})

// ── 開発の歩み ──
{
  const sec = h('section', 'reveal')
  sec.appendChild(h('p', 'eyebrow', 'Playlab の歩み'))
  sec.appendChild(h('h2', 'sec', '実験の記録（節目で更新）'))
  const tl = h('div', 'timeline')
  const events: [string, string][] = [
    ['2026-06-28', '<b>No.01 trail</b>「囲って、咲かす。」公開。ハブ＋共通キット＋Pages公開を確立。'],
    ['2026-06-28', '<b>No.02 dj</b>「きいて、かえして。」WebAudioのコール&レスポンス。'],
    ['2026-06-29', '<b>No.03 petri</b>「まもって、ふやして。」セルサバイバーに学ぶサバイバー×TD。'],
    ['2026-06-29', '<b>設計セオリーを調査・skill化</b>。petriに反映（操作の制御性・間口・のこぎり波）。'],
    ['2026-06-29', '<b>養分・コンボ・効果音・ヒットストップ</b>を追加（リスク&リターンと手触り）。'],
    ['2026-06-29', '<b>実機調整パネル(⚙)</b>と<b>共通ミュート</b>。スマホで数値をライブ調整。'],
    ['2026-06-30', '<b>蛇ボスを螺旋接近に</b>・進化v2（重ねがけ＋新ビルド）・分裂体。'],
    ['2026-06-30', '<b>この Codex を新設</b>。学びを“動く・触れる”ノートに。'],
    ['2026-06-30', 'petri を<b>XPレベル制（ヴァンサバ式）</b>に。養分=経験値→進化、宝箱・エリート・エンドレス化。'],
    ['2026-06-30', 'petri に<b>武器の進化合成・設置タレット</b>。敵も多彩化＆インフレで釣り合いを調整。'],
    ['2026-06-30', '<b>ハブが“生きた実験室”に</b>。微生物がうろつき、触ると反応、サイコロでランダム実験。'],
    ['2026-07-01', '<b>No.04「5秒、くりかえし。」</b>。時間ループ＝過去の自分が幽霊で手伝う5秒パズル。'],
  ]
  for (const [d, t] of events) {
    const item = h('div', 'tl')
    item.appendChild(h('div', 'd', d))
    item.appendChild(h('div', 't', t))
    tl.appendChild(item)
  }
  sec.appendChild(tl)
  app.appendChild(sec)
}

app.appendChild(
  h(
    'div',
    'foot',
    `要約のノート。設計の全文・出典は開発側のスキル <code>game-design</code> に蓄積。
     · <a href="https://github.com/YukiKanedomi/playlab" target="_blank" rel="noopener">source</a>`,
  ),
)

// 共通の細胞ブロブ描画（juiceデモ用）
function drawBlob(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, wob: number) {
  ctx.save()
  ctx.translate(x, y)
  ctx.beginPath()
  const n = 14
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const rr = r * (1 + Math.sin(a * 3 + wob) * 0.06)
    const px = Math.cos(a) * rr
    const py = Math.sin(a) * rr
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
  }
  ctx.closePath()
  ctx.fillStyle = hexA(col, 0.22)
  ctx.fill()
  ctx.strokeStyle = col
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = col
  ctx.beginPath()
  ctx.arc(0, 0, r * 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

// ── スクロールで現れる ──
const io = new IntersectionObserver(
  (ents) => {
    for (const e of ents) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
  },
  { threshold: 0.12 },
)
document.querySelectorAll('.reveal').forEach((el) => io.observe(el))
// 念のため：すぐ画面内のものは即表示
requestAnimationFrame(() => document.querySelectorAll('.reveal').forEach((el) => {
  const r = el.getBoundingClientRect()
  if (r.top < window.innerHeight) el.classList.add('in')
}))
