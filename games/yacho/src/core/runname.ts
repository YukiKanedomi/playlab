// ラン記録のビルド名生成（ROGUE.md §7）。
// 「取得強化の系統比率と代表強化から」`[修飾]+[主系統名詞]+[装置/庭園/炉/工場]` を決定的に合成する。
// 系統分類（UPGRADE_CATEGORY）は upgrades.ts §4 の見出し区分（植物/鉱物/ギア/遺物/異種シナジー）をそのままIDで写す。
// main.ts のドラフト抽選（系統一致シナジー判定）もこの分類を共用する。

export type UpgradeCategory = 'plant' | 'mineral' | 'gear' | 'relic' | 'synergy'

/** upgrades.ts 20種のID→系統（ROGUE.md §4の見出し順）。配列の並び順に依存しないようIDを明示する */
export const UPGRADE_CATEGORY: Record<string, UpgradeCategory> = {
  // 植物
  'spore-bloom': 'plant',
  'fungal-awakening': 'plant',
  'toxic-spore': 'plant',
  'deep-breath': 'plant',
  // 鉱物
  'root-eating-ore': 'mineral',
  'resonant-shatter': 'mineral',
  'mining-habit': 'mineral',
  'crystal-bud': 'mineral',
  // ギア
  'magnetic-mining': 'gear',
  'autonomous-mechanism': 'gear',
  overrev: 'gear',
  preheat: 'gear',
  // 遺物
  'relic-resonance': 'relic',
  'mimic-slime': 'relic',
  'transformation-furnace': 'relic',
  'gamblers-pot': 'relic',
  // 異種シナジー
  'vine-rocket': 'synergy',
  'spore-bullet': 'synergy',
  'mechanical-garden': 'synergy',
  'relic-root': 'synergy',
}

/** 代表強化の修飾語（名前の頭を飾る）。20種すべてに1語を割当てる */
const MODIFIER: Record<string, string> = {
  'spore-bloom': '繁殖',
  'fungal-awakening': '覚醒',
  'toxic-spore': '猛毒',
  'deep-breath': '深呼吸',
  'root-eating-ore': '侵食',
  'resonant-shatter': '共振',
  'mining-habit': '採掘',
  'crystal-bud': '萌芽',
  'magnetic-mining': '磁鉱',
  'autonomous-mechanism': '自律',
  overrev: '過回転',
  preheat: '予熱',
  'relic-resonance': '共鳴',
  'mimic-slime': '模倣',
  'transformation-furnace': '変換',
  'gamblers-pot': '賭博',
  'vine-rocket': '蔓撃',
  'spore-bullet': '胞弾',
  'mechanical-garden': '循環',
  'relic-root': '根源',
}

/** 主系統名詞（最も多く取った系統） */
const SYSTEM_NOUN: Record<UpgradeCategory, string> = {
  plant: '菌糸',
  mineral: '結晶',
  gear: '機関',
  relic: '遺物',
  synergy: '機巧',
}

/** 末尾の器（2番目に多い系統から選ぶ。無ければ主系統を流用） */
const SUFFIX_BY_CATEGORY: Record<UpgradeCategory, string> = {
  plant: '庭園',
  mineral: '炉',
  gear: '工場',
  relic: '装置',
  synergy: '工場',
}

/** 系統別の取得数が同数のときのタイブレーク順（ROGUE.md §4 見出し順） */
const CATEGORY_PRIORITY: UpgradeCategory[] = ['plant', 'mineral', 'gear', 'relic', 'synergy']

/** 強化を1つも取らずに終わったラン（層1で力尽きた等）の既定名 */
const FALLBACK_NAME = '無垢なる踏破者'

/**
 * ラン終了時のビルド名を決定的に合成する（ROGUE.md §7）。
 * 代表強化＝主系統のうち最後に取得したもの（直近の選択が一番「今のビルドらしさ」を表す）。
 */
export function buildRunName(upgrades: readonly string[]): string {
  if (upgrades.length === 0) return FALLBACK_NAME
  const count: Partial<Record<UpgradeCategory, number>> = {}
  for (const id of upgrades) {
    const cat = UPGRADE_CATEGORY[id]
    if (!cat) continue
    count[cat] = (count[cat] ?? 0) + 1
  }
  const ranked = CATEGORY_PRIORITY.filter((c) => (count[c] ?? 0) > 0).sort((a, b) => (count[b] ?? 0) - (count[a] ?? 0))
  if (ranked.length === 0) return FALLBACK_NAME
  const primary = ranked[0]
  const secondary = ranked[1] ?? primary
  let representative = upgrades[upgrades.length - 1]
  for (let i = upgrades.length - 1; i >= 0; i--) {
    if (UPGRADE_CATEGORY[upgrades[i]] === primary) {
      representative = upgrades[i]
      break
    }
  }
  const modifier = MODIFIER[representative] ?? ''
  return `${modifier}${SYSTEM_NOUN[primary]}${SUFFIX_BY_CATEGORY[secondary]}`
}
