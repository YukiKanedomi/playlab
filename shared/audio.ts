// shared/audio.ts — 全ゲーム共通のミュート（任意の道具箱）
// 自分の音楽を聴きながら遊びたい時に、ゲーム音だけを消せる。
// 状態は localStorage で全ゲーム共通（一度ミュートすればどの作品でも継続）。
// 各ゲームは mountMuteButton() を呼び、音を鳴らす前に isMuted() を見るだけ。

const KEY = 'playlab.muted'
let muted = false
try {
  muted = localStorage.getItem(KEY) === '1'
} catch {}

const listeners: ((m: boolean) => void)[] = []

export function isMuted(): boolean {
  return muted
}

/**
 * ゲーム音を他アプリ（Apple Music 等）と"共存"させる音声セッション設定。
 * iOS/Safari: 'ambient' はミックス（他の音を止めない）＝Playlab の既定ポリシー。
 * 代償として端末のサイレントスイッチで消音される。AudioContext 作成直後に呼ぶ。
 */
export function configureMixedSession(): void {
  try {
    const ns: any = navigator
    if (ns.audioSession) ns.audioSession.type = 'ambient'
  } catch {}
}

/** ミュート状態が変わったら呼ばれる（dj のように master gain を切り替えたい時用）。登録時に現在値も即通知。 */
export function onMuteChange(cb: (m: boolean) => void): void {
  listeners.push(cb)
  cb(muted)
}

export function setMuted(m: boolean): void {
  muted = m
  try {
    localStorage.setItem(KEY, m ? '1' : '0')
  } catch {}
  for (const cb of listeners) cb(muted)
}

/** 右上隅にミュートトグル（🔊/🔇）を設置。?shot 時は出さない（サムネを汚さない）。 */
export function mountMuteButton(): void {
  if (new URLSearchParams(location.search).get('shot')) return
  if (document.getElementById('pl-mute')) return // 二重設置防止
  const b = document.createElement('button')
  b.id = 'pl-mute'
  b.style.cssText = `position:fixed;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));
    z-index:50;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.4);
    background:rgba(22,26,24,.72);color:#fff;cursor:pointer;padding:0;display:flex;align-items:center;justify-content:center;
    -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);touch-action:manipulation;`
  // 絵文字依存を避け SVG で描画（明暗どちらの背景でも視認できる）
  const ICON_ON =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h3.5L13 19V5L7.5 9H4z" fill="#fff"/><path d="M16 8.5a4.5 4.5 0 010 7" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>'
  const ICON_OFF =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h3.5L13 19V5L7.5 9H4z" fill="#fff" opacity="0.85"/><path d="M16.5 9.5l5 5M21.5 9.5l-5 5" stroke="#ff6b5e" stroke-width="1.8" stroke-linecap="round"/></svg>'
  const render = () => {
    b.innerHTML = muted ? ICON_OFF : ICON_ON
    b.style.opacity = muted ? '0.85' : '1'
    b.setAttribute('aria-label', muted ? 'ミュート中（タップで解除）' : '音オン（タップでミュート）')
  }
  b.addEventListener('click', () => {
    setMuted(!muted)
    render()
  })
  render()
  document.body.appendChild(b)
}
