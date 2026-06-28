// shared/transition.ts — ノートの「ページめくり」遷移（任意の道具箱・軽量・堅牢）。
// ハブ↔ゲームで使う：起動時 enter() で紙ページが左へめくれて中身が現れ、
// リンク遷移は leaveTo(url) で右からページが差し込まれてから移動。

const PAPER = '#f3efe6'
const DUR = 440
const EASE = 'cubic-bezier(.7,0,.2,1)'

function makePanel(): HTMLDivElement {
  const el = document.createElement('div')
  el.style.cssText = `position:fixed;inset:0;z-index:9999;background:${PAPER};
    box-shadow:10px 0 30px rgba(40,34,22,.22),-10px 0 30px rgba(40,34,22,.22);
    will-change:transform;pointer-events:none;`
  // 紙のとじ目っぽい細い罫線（めくり感）
  const rule = document.createElement('div')
  rule.style.cssText = `position:absolute;top:0;bottom:0;right:0;width:2px;background:rgba(24,23,19,.12);`
  el.appendChild(rule)
  return el
}

// transitionend かタイムアウトの早い方で1回だけ実行（環境差で固まらない保険）
function onceDone(el: HTMLElement, fn: () => void) {
  let done = false
  const fire = () => {
    if (done) return
    done = true
    fn()
  }
  el.addEventListener('transitionend', fire, { once: true })
  setTimeout(fire, DUR + 120)
}

/** 起動時に呼ぶ：覆っていたページが左へめくれて中身を見せる。 */
export function enterTransition() {
  const el = makePanel()
  el.style.transform = 'translateX(0)'
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${DUR}ms ${EASE}`
      el.style.transform = 'translateX(-105%)'
    })
  })
  onceDone(el, () => el.remove())
}

/** リンク遷移：右からページを差し込んでから url へ移動。 */
export function leaveTo(url: string) {
  const el = makePanel()
  el.style.transform = 'translateX(105%)'
  document.body.appendChild(el)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = `transform ${DUR}ms ${EASE}`
      el.style.transform = 'translateX(0)'
    })
  })
  onceDone(el, () => (location.href = url))
}

/** <a> を横取りしてページめくり遷移にする（同一タブ・修飾キー無しのみ）。 */
export function wireLink(a: HTMLAnchorElement) {
  a.addEventListener('click', (e) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || a.target === '_blank') return
    e.preventDefault()
    leaveTo(a.href)
  })
}
