// shared/tune.ts — 実機で数値を直に調整する共通パネル（任意の道具箱）
// スマホで開発する都合上「チャットで数値を頼む」しかなかったのを解消する。
// 使い方：各ゲームが調整したい値を panel() に登録し、返る P から毎フレーム読む。
//   const P = tune.panel('petri', { MOVE_SPEED: { v: 200, min: 80, max: 400, step: 5, group: '操作' } })
//   c.x += vx * P.MOVE_SPEED * dt   // ← const ではなく P.xxx を読むだけ
// 右下の⚙でドロワーが開き、スライダー/トグルでライブ反映＋localStorage保存。
// 「コピー」で“既定から変えた値だけ”のJSONがクリップボードへ → チャットに貼れば焼き込み。

type Base = { group?: string; label?: string; desc?: string } // desc=分かりにくい設定の一文説明
type NumDef = Base & { v: number; min?: number; max?: number; step?: number }
type BoolDef = Base & { v: boolean }
type Def = NumDef | BoolDef
type Schema = Record<string, Def>

const isBool = (d: Def): d is BoolDef => typeof d.v === 'boolean'

export function panel<T extends Schema>(gameId: string, schema: T): { [K in keyof T]: T[K]['v'] } {
  const KEY = `playlab.tune.${gameId}`
  const shot = new URLSearchParams(location.search).get('shot')

  // 保存済みの上書き（変更分のみ）を読む。shot（サムネ撮影）時は既定のまま＝UIも出さない
  let saved: Record<string, number | boolean> = {}
  if (!shot) {
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || '{}')
    } catch {}
  }

  const P: Record<string, number | boolean> = {}
  for (const k in schema) P[k] = k in saved ? (saved[k] as any) : schema[k].v

  const out = P as { [K in keyof T]: T[K]['v'] }
  if (shot) return out

  // 既定から変わった値だけを保存／コピー対象にする
  const diff = () => {
    const d: Record<string, number | boolean> = {}
    for (const k in schema) if (P[k] !== schema[k].v) d[k] = P[k]
    return d
  }
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(diff()))
    } catch {}
  }

  mountUI(gameId, schema, P, persist, diff)
  return out
}

// ─────────────────────────── UI ───────────────────────────
const PANEL_BG = 'rgba(22,26,24,0.94)'
const FG = '#e9ede9'
const SUB = '#9fb0a6'
const ACC = '#cf8b3a'

function el(tag: string, css: string, parent?: HTMLElement, text?: string): HTMLElement {
  const e = document.createElement(tag)
  e.style.cssText = css
  if (text != null) e.textContent = text
  if (parent) parent.appendChild(e)
  return e
}

function mountUI(
  gameId: string,
  schema: Schema,
  P: Record<string, number | boolean>,
  persist: () => void,
  diff: () => Record<string, number | boolean>,
) {
  const FONT = '"Hiragino Sans","Yu Gothic",system-ui,sans-serif'

  // ⚙ ボタン（右上・控えめ・常設）
  const btn = el(
    'button',
    `position:fixed;top:max(10px,env(safe-area-inset-top));right:calc(max(10px,env(safe-area-inset-right)) + 42px);
     z-index:50;width:34px;height:34px;border-radius:50%;border:1px solid rgba(255,255,255,.25);
     background:rgba(22,26,24,.55);color:#fff;font-size:17px;line-height:1;cursor:pointer;
     -webkit-backdrop-filter:blur(4px);backdrop-filter:blur(4px);touch-action:manipulation;padding:0;`,
    document.body,
    '⚙',
  ) as HTMLButtonElement

  // ドロワー本体
  const drawer = el(
    'div',
    `position:fixed;top:0;right:0;bottom:0;z-index:51;width:min(360px,86vw);
     background:${PANEL_BG};-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);
     color:${FG};font-family:${FONT};box-shadow:-8px 0 24px rgba(0,0,0,.35);
     transform:translateX(102%);transition:transform .28s cubic-bezier(.7,0,.2,1);
     display:flex;flex-direction:column;touch-action:auto;`,
    document.body,
  )

  // ヘッダ
  const head = el('div', `display:flex;align-items:center;gap:6px;padding:14px 12px 10px;border-bottom:1px solid rgba(255,255,255,.1);`, drawer)
  el('div', `font-weight:800;font-size:14px;flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;`, head, `調整 — ${gameId}`)
  const copyBtn = el('button', miniBtn(ACC), head, 'コピー') as HTMLButtonElement
  const resetBtn = el('button', miniBtn('#7a8a80'), head, 'リセット') as HTMLButtonElement
  const closeBtn = el('button', miniBtn('#7a8a80'), head, '閉じる') as HTMLButtonElement

  // ボディ（スクロール）
  const body = el('div', `flex:1;overflow:auto;padding:6px 14px 20px;-webkit-overflow-scrolling:touch;`, drawer)

  // グループ分け
  const groups: Record<string, HTMLElement> = {}
  const groupOf = (g: string) => {
    if (groups[g]) return groups[g]
    const det = el('details', `margin:10px 0 4px;`, body) as HTMLDetailsElement
    det.open = true
    const sum = el('summary', `font-size:12px;font-weight:700;color:${SUB};letter-spacing:.04em;cursor:pointer;padding:4px 0;`, det, g)
    void sum
    groups[g] = det
    return det
  }

  // 各行の値表示を更新するための関数群
  const refreshers: (() => void)[] = []

  for (const k in schema) {
    const d = schema[k]
    const g = groupOf(d.group || 'その他')
    const row = el('div', `padding:8px 0;border-top:1px solid rgba(255,255,255,.06);`, g)
    const top = el('div', `display:flex;align-items:baseline;gap:8px;`, row)
    el('div', `flex:1;font-size:13px;`, top, d.label || k)
    const valEl = el('div', `font-variant-numeric:tabular-nums;font-weight:700;font-size:13px;color:${ACC};`, top) as HTMLElement

    if (isBool(d)) {
      const cb = el('input', `width:20px;height:20px;accent-color:${ACC};`, top) as HTMLInputElement
      cb.type = 'checkbox'
      cb.checked = P[k] as boolean
      const upd = () => (valEl.textContent = (P[k] as boolean) ? 'ON' : 'OFF')
      cb.addEventListener('change', () => {
        P[k] = cb.checked
        upd()
        persist()
      })
      upd()
      refreshers.push(() => {
        cb.checked = P[k] as boolean
        upd()
      })
    } else {
      const min = d.min ?? 0
      const max = d.max ?? ((d.v as number) * 2 || 1)
      const step = d.step ?? (max - min <= 2 ? 0.01 : 1)
      const sl = el('input', `width:100%;margin-top:6px;accent-color:${ACC};`, row) as HTMLInputElement
      sl.type = 'range'
      sl.min = String(min)
      sl.max = String(max)
      sl.step = String(step)
      sl.value = String(P[k])
      const upd = () => (valEl.textContent = String(P[k]))
      sl.addEventListener('input', () => {
        P[k] = parseFloat(sl.value)
        upd()
        persist()
      })
      upd()
      refreshers.push(() => {
        sl.value = String(P[k])
        upd()
      })
    }
    // 分かりにくい設定の一文説明
    if (d.desc) el('div', `margin-top:4px;font-size:11px;line-height:1.35;color:${SUB};`, row, d.desc)
  }

  // 操作
  let open = false
  const setOpen = (o: boolean) => {
    open = o
    drawer.style.transform = o ? 'translateX(0)' : 'translateX(102%)'
    btn.style.opacity = o ? '0' : '1'
  }
  btn.addEventListener('click', () => setOpen(true))
  closeBtn.addEventListener('click', () => setOpen(false))

  resetBtn.addEventListener('click', () => {
    for (const k in schema) P[k] = schema[k].v
    persist()
    refreshers.forEach((f) => f())
  })

  const toast = (msg: string) => {
    const t = el(
      'div',
      `position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom));transform:translateX(-50%);
       z-index:60;background:rgba(22,26,24,.95);color:#fff;font-family:${FONT};font-size:13px;
       padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.2);`,
      document.body,
      msg,
    )
    setTimeout(() => t.remove(), 1600)
  }

  copyBtn.addEventListener('click', async () => {
    const payload = JSON.stringify({ [gameId]: diff() })
    try {
      await navigator.clipboard.writeText(payload)
      toast('コピーしました（チャットに貼り付け）')
    } catch {
      // フォールバック：選択させる
      const ta = el('textarea', `position:fixed;left:8px;right:8px;bottom:8px;z-index:61;height:80px;`, document.body) as HTMLTextAreaElement
      ta.value = payload
      ta.select()
      toast('長押しでコピーしてください')
      setTimeout(() => ta.remove(), 4000)
    }
  })

  // ?tune=open で初期表示（スクショ確認用の開発補助）
  if (new URLSearchParams(location.search).get('tune') === 'open') setOpen(true)
}

function miniBtn(color: string): string {
  return `border:1px solid ${color};color:${color};background:transparent;border-radius:8px;
    font-size:12px;font-weight:700;padding:5px 8px;cursor:pointer;touch-action:manipulation;
    font-family:inherit;white-space:nowrap;flex:none;`
}
