// 採録画面の「採る」以外の2つの行為（PHASE2.md §2.8）。
//
//   合成 … 呼応する2つ（資源Rを生む知見＋Rを使う知見）を1つの知見にまとめる。**枠が1つ空く**
//   深化 … 手持ちの知見の発動条件を1段ゆるめる。**枠は変わらない**
//
// 呼応の判定は既に core/draft.ts が upgrades.ts の consumes/produces でやっているので、ここでも同じ
// データだけを見る（ペアごとの手書き表は作らない＝50組を超えて破綻するため）。
// 合成後の知見は upgrades.ts に `fusion: <資源>` の印で置いてあり、抽選には出ない（core/draft.ts）。
import { RESOURCES, UPGRADES, type Resource, type UpgradeDef } from './upgrades'
import { discardUpgrade, type RunState } from './run'

export interface FusionOption {
  /** 合成してできる知見 */
  def: UpgradeDef
  /** 資源を生む側の知見（表示の左） */
  a: UpgradeDef
  /** 資源を使う側の知見（表示の右） */
  b: UpgradeDef
  resource: Resource
}

const defOf = (id: string): UpgradeDef | undefined => UPGRADES.find((u) => u.id === id)

/**
 * 合成・深化そのものの入り切り（**PHASE2 §2.8 はまだ最終承認前**）。
 * false にすれば採録画面は行為タブごと消えて、承認ずみの「採る」だけの採録に完全に戻る
 * （知見の定義に残る deepen / fusion 欄は、どこからも読まれない死荷重になるだけで悪さはしない）。
 */
export const PHASE28_ENABLED = false

/**
 * 合成・深化の上限（**私が足した歯止め。要判断**。PHASE2 §2.8 の記載を参照）。
 * どちらも枠を食わずに強くなるので、上限が無いと PHASE2 §2 の「発火/手が深層で頭打ちになる」が壊れる
 * （120シードの実測：上限なしだと発火/手が深度21-25で 55、深度30クリア率 45%）。
 * 数字を戻すだけで上限は外せる（Infinity で無制限）。
 *
 * 注意：これは**ラン通算の回数**ではなく「いま持っている合成札の数／いま深化されている知見の数」の上限である
 * （Codexレビュー2回目 2026-08-15）。合成札や深化ずみの知見を採録で手放すと枠が1つ戻り、その分もう一度
 * 合成・深化できる。回数上限にしたければ RunState に実行回数を持つ必要があるが、§2.8 自体が未承認なので
 * 今は実装の通りに書いておく（採否が決まってから直す）。
 */
export const FUSION_MAX = 2
export const DEEPEN_MAX = 3

/**
 * いま合成できる組み合わせ。**1つの資源につき1組**だけ出す（同じ結果の札が2枚並ぶのを避ける）。
 * 組は所持順（採録順）の先頭から決めるので、同じ手持ちなら毎回同じ組になる。
 * 合成でできた知見どうしはさらに合成しない（環の環を作らない）。
 */
export function fusionOptions(ownedIds: readonly string[]): FusionOption[] {
  // PHASE28_ENABLED はここでは見ない。フラグは「採録画面に行為タブを出すか」という境界の判断なので
  // 呼び出し側（main.ts / runsim.ts）が持つ。ここに置くと、機能を切っている間だけ規則のテストが
  // 通らなくなり、テストが機能の入り切りに依存してしまう。
  const owned = ownedIds.map(defOf).filter((u): u is UpgradeDef => !!u && !u.fusion)
  if (ownedIds.filter((id) => defOf(id)?.fusion).length >= FUSION_MAX) return []
  const out: FusionOption[] = []
  for (const r of RESOURCES) {
    const def = UPGRADES.find((u) => u.fusion === r)
    if (!def || ownedIds.includes(def.id)) continue
    const a = owned.find((u) => u.produces?.includes(r))
    const b = owned.find((u) => u !== a && u.consumes?.includes(r))
    if (a && b) out.push({ def, a, b, resource: r })
  }
  return out
}

/** 合成する：もとの2つを手放し、合成後の知見を1つ得る（差し引きで枠が1つ空く） */
export function applyFusion(run: RunState, opt: FusionOption) {
  discardUpgrade(run, opt.a.id)
  discardUpgrade(run, opt.b.id)
  run.upgrades.push(opt.def.id)
}

/**
 * いま深化できる手持ちの知見（深化の欄を持ち、まだ深めていないもの）。
 * 並びは**所持順（採録順）**にする＝合成側と同じ規則。UPGRADES の定義順で返すと、ビューが先頭3件しか
 * 出さない（main.ts の slice(0,3)）ため、定義が前にある植物・鉱物の知見だけが常に候補に居座り、
 * 後ろの遺物・異種シナジーは一度も深化の札に出ないまま上限に達する（Codexレビュー2回目 2026-08-15）。
 */
export function deepenOptions(run: RunState): UpgradeDef[] {
  if (run.deepened.length >= DEEPEN_MAX) return [] // フラグを見ない理由は fusionOptions のコメント参照
  return run.upgrades.map(defOf).filter((u): u is UpgradeDef => !!u && !!u.deepen && !run.deepened.includes(u.id))
}

/** 深める：知見はそのまま、発動条件だけがゆるくなる（枠は動かない） */
export function applyDeepen(run: RunState, id: string) {
  if (!run.deepened.includes(id)) run.deepened.push(id)
}
