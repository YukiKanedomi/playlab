import type { LevelDef } from './types'

export const LEVELS30: LevelDef[] = [
  // 苔石の壊し方を、下段の一層と二層で素直に学ぶ導入面。
  {
    id: 1, seed: 101, moves: 38, colors: 4,
    goals: [{ type: 'kokeishi', count: 5 }],
    layout: ['........', '........', '........', '........', '........', '........', '.k.k.k..', '..K.K...'],
    star2: 2300, star3: 4200,
  },
  // 色集めと苔石を組み合わせ、障害物越しの消去に慣れる面。
  {
    id: 2, seed: 102, moves: 36, colors: 4,
    goals: [{ type: 'color', color: 0, count: 18 }, { type: 'kokeishi', count: 5 }],
    layout: ['........', '........', '........', '........', '........', '..k..k..', '...K....', '..k..k..'],
    star2: 2200, star3: 4000,
  },
  // 二層苔石を中央に置き、狙った場所で連鎖を作らせる面。
  {
    id: 3, seed: 103, moves: 35, colors: 4,
    goals: [{ type: 'color', color: 1, count: 20 }, { type: 'kokeishi', count: 6 }],
    layout: ['........', '........', '........', '........', '........', '..kKKk..', '...kk...', '........'],
    star2: 2100, star3: 3900,
  },
  // 蔦苔だけに集中し、一層と二層の地面を剥がす導入面。
  {
    id: 4, seed: 104, moves: 34, colors: 4,
    goals: [{ type: 'tsutagoke', count: 12 }],
    layout: ['........', '........', '........', '..gggg..', '..gGGg..', '..gGGg..', '........', '........'],
    star2: 2000, star3: 3700,
  },
  // 第一小節の山場として、広い蔦苔と多めの色目標を両立する面。
  {
    id: 5, seed: 105, moves: 30, colors: 4,
    goals: [{ type: 'color', color: 2, count: 26 }, { type: 'tsutagoke', count: 24 }],
    layout: ['........', '.gggggg.', '.gGGGGg.', '.gGGGGg.', '.gggggg.', '........', '........', '........'],
    star2: 1800, star3: 3300,
  },
  // 苔石と色集めを左右に分け、盤面全体を見る練習面。
  {
    id: 6, seed: 106, moves: 37, colors: 4,
    goals: [{ type: 'color', color: 3, count: 20 }, { type: 'kokeishi', count: 8 }],
    layout: ['........', '........', '........', '........', '.k....k.', '.K....K.', '.k....k.', '.K....K.'],
    star2: 2200, star3: 4100,
  },
  // 蔦苔の十字を消しながら二色を集めるテンポ重視の面。
  {
    id: 7, seed: 107, moves: 35, colors: 4,
    goals: [{ type: 'color', color: 0, count: 18 }, { type: 'color', color: 2, count: 18 }, { type: 'tsutagoke', count: 18 }],
    layout: ['........', '...gg...', '...GG...', '.ggGGgg.', '.ggGGgg.', '...gg...', '........', '........'],
    star2: 2100, star3: 3900,
  },
  // 苔石の列を段違いに配置し、縦横の特殊消去を誘う面。
  {
    id: 8, seed: 108, moves: 34, colors: 4,
    goals: [{ type: 'color', color: 1, count: 24 }, { type: 'kokeishi', count: 8 }],
    layout: ['........', '........', '........', '..k..k..', '..K..K..', '.k....k.', '.K....K.', '........'],
    star2: 2000, star3: 3700,
  },
  // 二種類の障害物を初めて併置し、優先順位を考えさせる面。
  {
    id: 9, seed: 109, moves: 33, colors: 4,
    goals: [{ type: 'color', color: 3, count: 22 }, { type: 'kokeishi', count: 4 }, { type: 'tsutagoke', count: 10 }],
    layout: ['........', '..gggg..', '..gGGg..', '...gg...', '..k..k..', '..K..K..', '........', '........'],
    star2: 2000, star3: 3600,
  },
  // 第一層の総仕上げとして、苔石と蔦苔を少ない手数で掃除する難面。
  {
    id: 10, seed: 110, moves: 24, colors: 5,
    goals: [{ type: 'color', color: 2, count: 40 }, { type: 'kokeishi', count: 8 }, { type: 'tsutagoke', count: 18 }],
    layout: ['........', '.gggggg.', '.gGGGGg.', '.gggggg.', '.kK..Kk.', '.Kk..kK.', '........', '........'],
    star2: 1800, star3: 3300,
  },
  // 箱だけを壊して陶片を集める、第二層の単独導入面。
  {
    id: 11, seed: 111, moves: 30, colors: 5,
    goals: [{ type: 'touhen', count: 8 }],
    layout: ['........', '........', '..h..h..', '........', '.h....h.', '.h....h.', '..h..h..', '........'],
    star2: 1800, star3: 3300,
  },
  // 箱と色目標を合わせ、箱の周囲で消す基本を固める面。
  {
    id: 12, seed: 112, moves: 29, colors: 5,
    goals: [{ type: 'color', color: 4, count: 18 }, { type: 'touhen', count: 10 }, { type: 'kokeishi', count: 4 }],
    layout: ['........', '..h..h..', '........', '.h.h..h.', '..k..k..', '.h..h.h.', '..h..h..', '..K..K..'],
    star2: 1700, star3: 3200,
  },
  // 箱と苔石を交互に置き、隣接消去の波及を狙う面。
  {
    id: 13, seed: 113, moves: 28, colors: 5,
    goals: [{ type: 'color', color: 0, count: 20 }, { type: 'touhen', count: 6 }, { type: 'kokeishi', count: 6 }],
    layout: ['........', '........', '.h.k..h.', '.K.h..K.', '.h.k..h.', '.K.h..K.', '........', '........'],
    star2: 1700, star3: 3100,
  },
  // 箱を蔦苔の周囲に置き、同じ消去で複数目標を進める面。
  {
    id: 14, seed: 114, moves: 27, colors: 5,
    goals: [{ type: 'color', color: 1, count: 22 }, { type: 'touhen', count: 8 }, { type: 'tsutagoke', count: 12 }],
    layout: ['........', '..hhhh..', '..gggg..', '..gGGg..', '..gggg..', '..hhhh..', '........', '........'],
    star2: 1600, star3: 3000,
  },
  // 箱・苔石・蔦苔を密集させ、第二層前半の難所を作る面。
  {
    id: 15, seed: 115, moves: 21, colors: 5,
    goals: [{ type: 'color', color: 2, count: 28 }, { type: 'touhen', count: 8 }, { type: 'kokeishi', count: 8 }, { type: 'tsutagoke', count: 14 }],
    layout: ['........', '.hggggh.', '.gKkkKg.', '.hGhhGh.', '.gKkkKg.', '.hggggh.', '........', '........'],
    star2: 1500, star3: 2800,
  },
  // 左右対称の欠け盤面で、箱へ届く経路を見つける面。
  {
    id: 16, seed: 116, moves: 30, colors: 5,
    goals: [{ type: 'color', color: 3, count: 18 }, { type: 'touhen', count: 6 }, { type: 'kokeishi', count: 4 }],
    layout: ['#......#', '........', '.h....h.', '..k..k..', '..K..K..', '.h....h.', '..h..h..', '#......#'],
    star2: 1800, star3: 3300,
  },
  // 中央の箱列と蔦苔を同時に削り、連続消去を促す面。
  {
    id: 17, seed: 117, moves: 29, colors: 5,
    goals: [{ type: 'color', color: 4, count: 20 }, { type: 'touhen', count: 8 }, { type: 'tsutagoke', count: 16 }],
    layout: ['........', '..ghhg..', '..gGGg..', '.hggggh.', '.hggggh.', '..ghhg..', '........', '........'],
    star2: 1700, star3: 3200,
  },
  // 菱形に欠けた盤面で、箱と苔石への当て方を切り替える面。
  {
    id: 18, seed: 118, moves: 28, colors: 5,
    goals: [{ type: 'color', color: 0, count: 24 }, { type: 'touhen', count: 8 }, { type: 'kokeishi', count: 8 }],
    layout: ['##....##', '#.h..h.#', '.k....k.', '.K.hK.h.', '.h.Kh.K.', '.k....k.', '#.h..h.#', '##....##'],
    star2: 1700, star3: 3100,
  },
  // 三種の障害物を横帯に分け、手順を組み立てる面。
  {
    id: 19, seed: 119, moves: 30, colors: 5,
    goals: [{ type: 'color', color: 1, count: 16 }, { type: 'touhen', count: 6 }, { type: 'tsutagoke', count: 9 }],
    layout: ['........', '.hhhhhh.', '.ggGGgg.', '.gGggGg.', '.kK..Kk.', '.Kk..kK.', '.hhhhhh.', '........'],
    star2: 1600, star3: 3000,
  },
  // 第二層の総仕上げとして、全目標を高密度で要求する難面。
  {
    id: 20, seed: 120, moves: 22, colors: 5,
    goals: [{ type: 'color', color: 2, count: 30 }, { type: 'touhen', count: 14 }, { type: 'kokeishi', count: 8 }],
    layout: ['........', '.hhhhhh.', '.gGGGGg.', '.gGggGg.', '.kKhhKk.', '.KkhhkK.', '.hhhhhh.', '........'],
    star2: 1500, star3: 2800,
  },
  // 二基の巣火から胞子を回収する、第三層の単独導入面。
  {
    id: 21, seed: 121, moves: 27, colors: 5,
    goals: [{ type: 'spore', count: 8 }],
    layout: ['........', '........', '........', '........', '........', '........', '..s..s..', '........'],
    subiCharge: 4, star2: 1600, star3: 3000,
  },
  // 巣火の起動と色集めを並行し、胞子の流れを読む面。
  {
    id: 22, seed: 122, moves: 26, colors: 5,
    goals: [{ type: 'color', color: 3, count: 18 }, { type: 'spore', count: 6 }, { type: 'kokeishi', count: 2 }],
    layout: ['........', '........', '........', '........', '.k....K.', '........', '.s....s.', '........'],
    subiCharge: 4, star2: 1600, star3: 2900,
  },
  // 巣火のそばに箱を置き、起動と陶片回収を競合させる面。
  {
    id: 23, seed: 123, moves: 25, colors: 5,
    goals: [{ type: 'color', color: 4, count: 20 }, { type: 'spore', count: 7 }, { type: 'touhen', count: 8 }],
    layout: ['........', '........', '..h..h..', '.h....h.', '........', '.h....h.', '..s..s..', '..h..h..'],
    subiCharge: 4, star2: 1500, star3: 2800,
  },
  // 蔦苔の間から胞子を通し、地面と回収を同時に進める面。
  {
    id: 24, seed: 124, moves: 26, colors: 5,
    goals: [{ type: 'color', color: 0, count: 20 }, { type: 'spore', count: 6 }, { type: 'tsutagoke', count: 16 }],
    layout: ['........', '..gggg..', '..gGGg..', '..gggg..', '..gGGg..', '........', '..s..s..', '........'],
    subiCharge: 4, star2: 1400, star3: 2600,
  },
  // 苔石・箱・蔦苔と胞子を束ね、第三層前半の難所にする面。
  {
    id: 25, seed: 125, moves: 26, colors: 5,
    goals: [{ type: 'color', color: 1, count: 20 }, { type: 'spore', count: 6 }, { type: 'touhen', count: 6 }],
    // 胞子の煙突（x3,x4）を空けた壁構造。巣灯は中央下
    layout: ['........', '.hg..gh.', '.gK..Kg.', '.hG..Gh.', '.gK..Kg.', '.h....h.', '...ss...', '........'],
    subiCharge: 4, star2: 1400, star3: 2500,
  },
  // 対称の欠け盤面で、胞子の上昇経路と箱処理を選ぶ面。
  {
    id: 26, seed: 126, moves: 27, colors: 5,
    goals: [{ type: 'color', color: 2, count: 18 }, { type: 'spore', count: 6 }, { type: 'touhen', count: 4 }],
    layout: ['#......#', '........', '.h....h.', '..k..k..', '..K..K..', '.h....h.', '..s..s..', '#......#'],
    subiCharge: 4, star2: 1600, star3: 3000,
  },
  // 巣火を三基に増やし、蔦苔と色目標をテンポよく削る面。
  {
    id: 27, seed: 127, moves: 26, colors: 5,
    goals: [{ type: 'color', color: 3, count: 22 }, { type: 'spore', count: 7 }, { type: 'tsutagoke', count: 22 }],
    layout: ['........', '..gggg..', '.gGggGg.', '.ggGGgg.', '.gGggGg.', '........', '.s.s.s..', '........'],
    subiCharge: 4, star2: 1600, star3: 2900,
  },
  // 菱形盤面に全ギミックを配置し、狭い中央で連鎖を作る面。
  {
    id: 28, seed: 128, moves: 27, colors: 5,
    goals: [{ type: 'color', color: 4, count: 20 }, { type: 'spore', count: 6 }, { type: 'touhen', count: 4 }],
    // 菱形盤面。巣灯の直上（x2,x5）は蔦苔のみ＝通行可の煙突
    layout: ['##....##', '#.g..g.#', '.kg..gk.', '.Kg..gK.', '.hg..gh.', '.hg..gh.', '#.s..s.#', '##....##'],
    subiCharge: 4, star2: 1500, star3: 2800,
  },
  // 全ギミックを高密度に詰めた、連続ボスラン第一戦の超難面。
  {
    id: 29, seed: 129, moves: 26, colors: 5,
    goals: [{ type: 'color', color: 0, count: 26 }, { type: 'spore', count: 8 }, { type: 'touhen', count: 6 }],
    // 巣灯4基のうち中央2基（x3,x4）は煙突直結、外側2基は石壁を割らないと届かない
    layout: ['#......#', '.hg..gh.', '.gK..Kg.', '.hg..gh.', '.gK..Kg.', '.h....h.', '..ssss..', '#......#'],
    subiCharge: 4, bossRun: true, star2: 1400, star3: 2600,
  },
  // 最高密度の目標を最少手数で突破する、最終ボスランの超難面。
  {
    id: 30, seed: 130, moves: 26, colors: 5,
    goals: [{ type: 'color', color: 4, count: 20 }, { type: 'spore', count: 6 }, { type: 'touhen', count: 6 }],
    // 最終面：狭い菱形＋二重石壁。煙突はx3,x4のみ、外側の巣灯は壁割り必須
    layout: ['##....##', '#hg..gh#', '.gK..Kg.', '.hG..Gh.', '.gK..Kg.', '.hg..gh.', '#.ssss.#', '##....##'],
    subiCharge: 4, bossRun: true, star2: 1400, star3: 2500,
  },
]
