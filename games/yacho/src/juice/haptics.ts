// 触覚フィードバック（JUICE.md §1③）。Android Chrome は navigator.vibrate で効く。
// iOS Safari は Vibration API 非対応 → supported=false で全呼び出しが無害な no-op になる。
// iOS 18 の <input type="checkbox" switch> ハックは非公式で将来壊れるため採用しない（振動をゲーム成立の前提にしない）。
export type Buzz = 'pop' | 'born' | 'blast' | 'chain'
const MS: Record<Buzz, number> = { pop: 8, born: 15, blast: 25, chain: 30 }
const RANK: Record<Buzz, number> = { pop: 0, born: 1, blast: 2, chain: 2 }

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
let enabled = localStorage.getItem('yacho-haptics') !== '0' // 既定オン。ミュート設定とは独立のキー
let lastAt = -1e9
let lastRank = -1
let strongAt = -1e9
let popsThisMove = 0
const log: { t: number; kind: Buzz }[] = []

/** play() 冒頭で呼ぶ。1手あたりの pop 回数上限をリセットする */
export function resetMoveBudget(): void { popsThisMove = 0 }

export function buzz(kind: Buzz): void {
  if (!enabled || !supported) return
  const now = performance.now()
  if (kind === 'pop' && ++popsThisMove > 4) return          // 1手あたり pop は最大4回
  if (RANK[kind] === 0 && now - strongAt < 120) return      // 強い振動の直後の弱い振動は捨てる
  if (RANK[kind] <= lastRank && now - lastAt < 70) return   // 同ランク以下の連続は70ms未満なら捨てる
  lastAt = now
  lastRank = RANK[kind]
  if (RANK[kind] >= 2) strongAt = now
  if (log.length >= 40) log.shift()
  log.push({ t: now, kind })
  try { navigator.vibrate(MS[kind]) } catch { /* 権限拒否・非対応は黙って無視 */ }
}

export function toggleHaptics(): boolean {
  enabled = !enabled
  localStorage.setItem('yacho-haptics', enabled ? '1' : '0')
  if (!enabled && supported) { try { navigator.vibrate(0) } catch { /* 停止失敗は無視 */ } }
  return enabled
}
export function hapticsEnabled(): boolean { return enabled }
export function hapticsSupported(): boolean { return supported }
/** QA専用：直近40件の発火履歴（動画には振動が写らないため） */
export function hapticsLog(): { t: number; kind: Buzz }[] { return log.slice() }
