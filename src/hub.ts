import { loadGames, gameUrl, assetUrl, type GameEntry } from '../shared/registry'
import { enterTransition, wireLink } from '../shared/transition'

const shelf = document.getElementById('shelf')!
const countEl = document.getElementById('count')!

enterTransition()

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
  } catch (e) {
    shelf.innerHTML = `<p class="loading">読み込みに失敗しました。</p>`
    console.error(e)
  }
}

main()
