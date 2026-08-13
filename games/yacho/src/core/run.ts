// ラン単位の永続状態（ROGUE.md §3 RunState）。
// Board はこれを任意（コンストラクタ第2引数）で受け取り、フックの発火判定・記録集計に使う。
// 未指定なら Board は完全に旧来の（非ローグ）挙動のまま動く。

export interface RunRecords {
  maxChain: number // 1手内で到達した最大連鎖数
  maxDestroyed: number // 1手内の最大破壊駒数
  effectFires: number // フック発動の総回数（ラン通算）
  critical: boolean // フック発火上限(200/解決)に達したことがあるか＝暴走のご褒美フラグ（ROGUE.md §3）
}

export interface RunState {
  upgrades: string[] // 取得済み強化ID（upgrades.ts の UpgradeDef.id）
  gearCharge: number // ギア起動カウンタ（自律機構/機械庭園/遺物共鳴の判定に使用）
  playerHp: number
  floor: number
  records: RunRecords
  /** 遺物共鳴(#13)が次の遺物マッチ効果を2倍にするための一時フラグ。消費で false に戻る。
   *  ROGUE.md の RunState 定義には無いが、フック間で状態を1個渡すのに最小限必要（最終報告に記載）。 */
  relicBoostNext: boolean
}

export function createRunState(upgrades: string[] = []): RunState {
  return {
    upgrades,
    gearCharge: 0,
    playerHp: 20,
    floor: 1,
    records: { maxChain: 0, maxDestroyed: 0, effectFires: 0, critical: false },
    relicBoostNext: false,
  }
}
