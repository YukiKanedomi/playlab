// C案移行 Phase3（codex_arch_review.md §3-3）：確定済みイベント列を「解決セグメント」へ束ねる純関数。
// エンジン挙動は一切変えない＝分類はイベントの順序を保存し、flattenすると元の列に完全一致する
// （segments.test.ts が担保）。Phase4でビューはこの単位で再生し、Phase5でエンジン自身がこの単位で
// 停止できるようになる（そのとき beforeRevision/afterRevision/snapshotAfter を足す）。
import type { BoardEvent } from './types'

export type SegmentKind = 'swap' | 'resolve' | 'gravity' | 'enemy' | 'finish'

export interface Segment {
  kind: SegmentKind
  events: BoardEvent[]
}

/** イベント種別 → セグメント種別の写像（BoardEventの全メンバーを網羅。増えたらここに足すこと） */
const KIND_OF: Record<BoardEvent['t'], SegmentKind> = {
  // 手の入力と対価
  swap: 'swap',
  combo: 'swap',
  'oxygen-spent': 'swap',
  // マッチ・発火・破壊とその因果（1連鎖ステップの「消える」側）
  match: 'resolve',
  'special-born': 'resolve',
  'special-fire': 'resolve',
  explode: 'resolve',
  'block-hit': 'resolve',
  'ground-hit': 'resolve',
  'gear-trigger': 'resolve',
  'gear-charged': 'resolve',
  'token-spawn': 'resolve',
  'token-consumed': 'resolve',
  'obstacle-spawn': 'resolve',
  'upgrade-fire': 'resolve',
  'goal-progress': 'resolve',
  'armor-broken': 'resolve',
  'enemy-damage': 'resolve',
  'enemy-defeated': 'resolve',
  'boss-shell-broken': 'resolve',
  'shell-peeled': 'resolve',
  'boss-phase': 'resolve',
  'prey-escaped': 'resolve',
  'spore-born': 'resolve',
  'lamp-bonus': 'resolve',
  // 盤面の移動（1連鎖ステップの「動く」側）
  fall: 'gravity',
  refill: 'gravity',
  reroll: 'gravity',
  'spore-rise': 'gravity',
  'spore-collected': 'gravity',
  // 敵ターンの行動（プレイヤーの解決とは別の主体）
  'armor-applied': 'enemy',
  'cell-sealed': 'enemy',
  'cell-unsealed': 'enemy',
  'prey-marked': 'enemy',
  'prey-devoured': 'enemy',
  'fissure-telegraph': 'enemy',
  'fissure-averted': 'enemy',
  'shell-raised': 'enemy',
  'oxygen-drained': 'enemy',
  // 手・層・ランの締め
  'win-drain': 'finish',
  'win-detonate-begin': 'finish',
  'oxygen-refill': 'finish',
  'last-light': 'finish',
  'floor-clear': 'finish',
  'run-over': 'finish',
}

/**
 * イベント列をセグメント列へ分類する。連続する同種イベントは同じセグメントに束ね、
 * 種別が変わったら新しいセグメントを開く（resolve→gravity→resolve… の交互が連鎖ステップに対応する）。
 * 順序は保存される：segments.flatMap(s => s.events) ≡ evs
 */
export function segmentEvents(evs: BoardEvent[]): Segment[] {
  const out: Segment[] = []
  for (const e of evs) {
    const kind = KIND_OF[e.t]
    const last = out[out.length - 1]
    if (last && last.kind === kind) last.events.push(e)
    else out.push({ kind, events: [e] })
  }
  return out
}
