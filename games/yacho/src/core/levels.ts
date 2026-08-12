import type { LevelDef } from './types'

// Phase 2 検証用の先行3レベル。全30本は Phase 3 で（DESIGN.md §3 の表に従う）。
export const LEVELS: LevelDef[] = [
  {
    // Lv1: 苔石の単体導入（RM Lv1 と同型：下半分に苔石の床）
    id: 1,
    seed: 101,
    moves: 32,
    colors: 4,
    goals: [{ type: 'kokeishi', count: 16 }],
    layout: [
      // 石壁は最下段に置く：壁の下に駒マスがあるとリフィル不能の死に領域になる（実機バグ報告 2026-08-12）
      '........',
      '........',
      '........',
      '........',
      '........',
      '........',
      'kkkkkkkk',
      'KKKKKKKK',
    ],
  },
  {
    // Lv2: 色集め
    id: 2,
    seed: 102,
    moves: 30,
    colors: 4,
    goals: [
      { type: 'color', color: 0, count: 20 },
      { type: 'color', color: 2, count: 20 },
    ],
    layout: Array(8).fill('........'),
  },
  {
    // Lv4 相当: 蔦苔の単体導入
    id: 3,
    seed: 104,
    moves: 30,
    colors: 4,
    goals: [{ type: 'tsutagoke', count: 24 }],
    layout: [
      '........',
      '........',
      'gggggggg',
      'gggggggg',
      'GGGGGGGG',
      '........',
      '........',
      '........',
    ],
  },
]
