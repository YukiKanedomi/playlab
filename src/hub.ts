import { loadGames, gameUrl, assetUrl, type GameEntry } from '../shared/registry'
import { enterTransition, wireLink, leaveTo } from '../shared/transition'
import { SPECIMEN_COLORS, hexA, darken } from '../shared/theme'

const shelf = document.getElementById('shelf')!
const countEl = document.getElementById('count')!

enterTransition()

// Codex への導線（ページめくり遷移）
const codexLink = document.getElementById('codexLink') as HTMLAnchorElement | null
if (codexLink) wireLink(codexLink)

// ════════ 生きたハブ：方眼の上をうごめく微生物＋手触り ════════
{
  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
  const bg = document.getElementById('bg') as HTMLCanvasElement | null
  if (bg) {
    const ctx = bg.getContext('2d')!
    let W = 0,
      H = 0
    const fit = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      W = window.innerWidth
      H = window.innerHeight
      bg.width = W * dpr
      bg.height = H * dpr
      bg.style.width = W + 'px'
      bg.style.height = H + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    fit()
    window.addEventListener('resize', fit)

    type Bug = { x: number; y: number; vx: number; vy: number; r: number; col: string; wob: number; excite: number }
    type Par = { x: number; y: number; vx: number; vy: number; life: number; col: string }
    const bugs: Bug[] = []
    const pars: Par[] = []
    const N = Math.round(clamp((W * H) / 42000, 9, 18))
    for (let i = 0; i < N; i++) {
      bugs.push({
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() * 2 - 1) * 14,
        vy: (Math.random() * 2 - 1) * 14,
        r: 5 + Math.random() * 8,
        col: SPECIMEN_COLORS[(Math.random() * SPECIMEN_COLORS.length) | 0],
        wob: Math.random() * 9,
        excite: 0,
      })
    }
    // ポインタ（指/カーソル）から逃げる
    const ptr = { x: -999, y: -999, on: false }
    const move = (e: PointerEvent) => {
      ptr.x = e.clientX
      ptr.y = e.clientY
      ptr.on = true
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', move)

    function burst(x: number, y: number, n: number, col: string, spd: number) {
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2
        const s = spd * (0.3 + Math.random() * 0.7)
        pars.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6 + Math.random() * 0.5, col })
      }
    }

    let swarm = 0 // 隠し要素：微生物が中心へ集まる演出の残り時間
    let swarmX = 0
    let swarmY = 0
    function organism(x: number, y: number, r: number, col: string, wob: number, ex: number) {
      const edge = darken(col, 0.7)
      ctx.beginPath()
      const n = 12
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2
        const rr = r * (1 + Math.sin(a * 3 + wob) * 0.07)
        const px = x + Math.cos(a) * rr
        const py = y + Math.sin(a) * rr
        i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)
      }
      ctx.closePath()
      ctx.fillStyle = hexA(col, 0.16 + ex * 0.2)
      ctx.fill()
      ctx.strokeStyle = hexA(edge, 0.55)
      ctx.lineWidth = Math.max(1.2, r * 0.12)
      ctx.stroke()
      ctx.fillStyle = hexA(edge, 0.6)
      ctx.beginPath()
      ctx.arc(x, y, Math.max(1.4, r * 0.18), 0, Math.PI * 2)
      ctx.fill()
    }

    let last = performance.now()
    function loop(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      ctx.clearRect(0, 0, W, H)
      if (swarm > 0) swarm -= dt
      for (const b of bugs) {
        b.wob += dt * (1 + b.excite * 3)
        b.excite = Math.max(0, b.excite - dt)
        // ふらつき
        b.vx += (Math.random() * 2 - 1) * 26 * dt
        b.vy += (Math.random() * 2 - 1) * 26 * dt
        // 指から逃げる
        if (ptr.on) {
          const dx = b.x - ptr.x
          const dy = b.y - ptr.y
          const d = Math.hypot(dx, dy)
          if (d < 110 && d > 0.1) {
            const f = ((110 - d) / 110) * 240
            b.vx += (dx / d) * f * dt
            b.vy += (dy / d) * f * dt
            b.excite = Math.min(1, b.excite + dt * 2)
          }
        }
        // 隠し要素：中心へ吸い寄せ
        if (swarm > 0) {
          const dx = swarmX - b.x
          const dy = swarmY - b.y
          const d = Math.hypot(dx, dy) || 1
          b.vx += (dx / d) * 320 * dt
          b.vy += (dy / d) * 320 * dt
        }
        // 速度制限＋減衰
        const sp = Math.hypot(b.vx, b.vy)
        const max = 30 + b.excite * 90
        if (sp > max) {
          b.vx = (b.vx / sp) * max
          b.vy = (b.vy / sp) * max
        }
        b.vx *= 0.99
        b.vy *= 0.99
        b.x += b.vx * dt
        b.y += b.vy * dt
        // 端で折り返し
        const m = b.r
        if (b.x < m) (b.x = m), (b.vx = Math.abs(b.vx))
        if (b.x > W - m) (b.x = W - m), (b.vx = -Math.abs(b.vx))
        if (b.y < m) (b.y = m), (b.vy = Math.abs(b.vy))
        if (b.y > H - m) (b.y = H - m), (b.vy = -Math.abs(b.vy))
        organism(b.x, b.y, b.r, b.col, b.wob, b.excite)
      }
      // 粒子
      for (const p of pars) {
        p.life -= dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 0.95
        p.vy *= 0.95
        ctx.globalAlpha = clamp(p.life / 0.8, 0, 1)
        ctx.fillStyle = p.col
        ctx.beginPath()
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      for (let i = pars.length - 1; i >= 0; i--) if (pars[i].life <= 0) pars.splice(i, 1)
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)

    // ワードマーク：触ると弾む＋粒子。連打で隠し要素（微生物が集まって弾ける）
    const wm = document.querySelector('.wm') as HTMLElement | null
    let taps = 0
    let tapAt = 0
    if (wm) {
      wm.addEventListener('pointerdown', () => {
        wm.classList.remove('pop')
        void wm.offsetWidth // リフロー＝アニメ再生
        wm.classList.add('pop')
        const r = wm.getBoundingClientRect()
        const cx = r.left + r.width * 0.5
        const cy = r.top + r.height * 0.6
        burst(cx, cy, 10, SPECIMEN_COLORS[(Math.random() * SPECIMEN_COLORS.length) | 0], 160)
        for (const b of bugs) {
          const dx = b.x - cx
          const dy = b.y - cy
          const d = Math.hypot(dx, dy) || 1
          if (d < 220) {
            b.vx += (dx / d) * 140
            b.vy += (dy / d) * 140
            b.excite = 1
          }
        }
        const now = performance.now()
        taps = now - tapAt < 900 ? taps + 1 : 1
        tapAt = now
        if (taps >= 5) {
          taps = 0
          // 隠し要素：全微生物が中心に集合→弾けて増殖
          swarmX = window.innerWidth / 2
          swarmY = window.innerHeight * 0.42
          swarm = 0.9
          setTimeout(() => {
            for (let i = 0; i < 5; i++) burst(swarmX, swarmY, 14, SPECIMEN_COLORS[i % SPECIMEN_COLORS.length], 300)
            // 増殖（上限まで）
            if (bugs.length < 28)
              for (let i = 0; i < 4; i++)
                bugs.push({ x: swarmX, y: swarmY, vx: (Math.random() * 2 - 1) * 120, vy: (Math.random() * 2 - 1) * 120, r: 5 + Math.random() * 8, col: SPECIMEN_COLORS[(Math.random() * SPECIMEN_COLORS.length) | 0], wob: Math.random() * 9, excite: 1 })
            toast('標本がふえた')
          }, 850)
        }
      })
    }

    function toast(msg: string) {
      const t = document.createElement('div')
      t.textContent = msg
      t.style.cssText = `position:fixed;left:50%;top:38%;transform:translate(-50%,-50%);z-index:9998;
        background:rgba(24,23,19,.85);color:#f3efe6;font:700 14px "Hiragino Sans",system-ui,sans-serif;
        padding:9px 16px;border-radius:999px;pointer-events:none;`
      document.body.appendChild(t)
      setTimeout(() => t.remove(), 1500)
    }
  }
}

function card(g: GameEntry): HTMLAnchorElement {
  const a = document.createElement('a')
  a.className = 'card' + (g.status === 'featured' ? ' is-featured' : '')
  a.href = gameUrl(g)

  const featured = g.status === 'featured'
  const statusLabel = featured ? 'featured' : '実験中'

  const thumbHtml = g.thumb
    ? `<div class="thumb"><img src="${assetUrl(g.thumb)}" alt="" loading="lazy" /></div>`
    : ''
  const no = g.no ? 'No.' + String(g.no).padStart(2, '0') : ''
  a.innerHTML = `
    ${thumbHtml}
    <div class="card-top">
      <span class="meta-left">
        ${no ? `<span class="no">${no}</span>` : ''}
        <span class="status ${featured ? 'featured' : ''}">${statusLabel}</span>
      </span>
      <span class="date">${g.date}</span>
    </div>
    <h2 class="card-title"></h2>
    <p class="card-desc"></p>
    <div class="tags"></div>
  `
  a.querySelector('.card-title')!.textContent = g.title
  a.querySelector('.card-desc')!.textContent = g.desc
  const tags = a.querySelector('.tags')!
  for (const t of g.tags) {
    const s = document.createElement('span')
    s.className = 'tag'
    s.textContent = t
    tags.appendChild(s)
  }
  wireLink(a) // クリックでページめくり遷移
  return a
}

async function main() {
  try {
    const games = await loadGames()
    shelf.innerHTML = ''
    if (games.length === 0) {
      shelf.innerHTML = '<p class="loading">まだ実験がありません。最初の一本を仕込み中…</p>'
      return
    }
    for (const g of games) shelf.appendChild(card(g))
    countEl.textContent = `${games.length} experiment${games.length > 1 ? 's' : ''}`
    // サイコロ：ランダムに実験を開く（ページめくり遷移）
    const dice = document.getElementById('dice') as HTMLButtonElement | null
    if (dice)
      dice.addEventListener('click', () => {
        dice.classList.remove('roll')
        void dice.offsetWidth
        dice.classList.add('roll')
        const g = games[(Math.random() * games.length) | 0]
        setTimeout(() => leaveTo(gameUrl(g)), 260)
      })
  } catch (e) {
    shelf.innerHTML = `<p class="loading">読み込みに失敗しました。</p>`
    console.error(e)
  }
}

main()
