// 初遭遇の1行札（PHASE2.md「祝福の回数と時機」末尾の決定：情報は初出時に1行だけ。以後は出さない）。
// ここはデータ（文言カタログ）と既視管理（localStorage・ラン跨ぎで永続）のみ。
// 表示（1.2秒＋タップで即閉じ・盤面は止めない）は main.ts の層シーンが持つ。
// 文言は「帰還した探窟家の実地記録」の筆致で統一する（「〜しよう！」のチュートリアル口調は禁止）。

/**
 * 札ID → 1行の記録。
 *   enemy:<EnemyKind>       … 原生種が初めて盤上に現れた層の開始時
 *   goal:<GoalType>         … 課目タイプの初出（system は goal:system:<system>）
 *   special:<Piece.kind>    … 特殊駒の初生成（special-born。蔓ロケットの通常駒供給は除外）
 *   intent                  … 兆候（インテントバッジ）の初表示
 *   oxygen-drain            … 灯の初ドレイン（oxygen-drained）
 */
export const FIRST_NOTES: Record<string, string> = {
  // ---- 原生種（9種） ----
  'enemy:swarm': '未採録の原生種 ── 小型胞子虫。大きく崩せば隣の群れへ伝う',
  'enemy:rockshell': '未採録の原生種 ── 岩殻獣。鉱物へ甲殻を着せてくる',
  'enemy:sporeling': '未採録の原生種 ── 喰み蟲。印の駒を先に消せば追い払える',
  'enemy:burrower': '未採録の原生種 ── 裂坑掘り。亀裂は枠内で消せば止まる',
  'enemy:breathstealer': '未採録の原生種 ── 灯喰み。灯を直に奪う。長居は禁物',
  'enemy:binder': '未採録の原生種 ── 綴じ蟲。予告の列で消せば綴じは止まる',
  'enemy:bellfoot': '未採録の原生種 ── 鐘脚。殻は1手に1枚。張り直しより速く',
  'enemy:boss': '未採録の原生種 ── 深匣主。封印匣は4枚、どの一撃でも1枚',
  'enemy:maw': '未採録の原生種 ── 奈落の喉。灯は奪わず、盤そのものを変える',
  // ---- 課目タイプ（FLOORS で使う6種） ----
  'goal:system:plant': '課目の記 ── 植物。芽石と花石、どちらを消しても進む',
  'goal:enemy-kill': '課目の記 ── 掃討。倒しきるまで、この層は明けない',
  'goal:tsutagoke': '課目の記 ── 蔦苔。苔の上で消せば一層剥がれる',
  'goal:touhen': '課目の記 ── 陶片。匣を割り、こぼれた陶片を隣で拾う',
  'goal:spore': '課目の記 ── 光胞子。巣灯から生まれ、上端に浮けば採れる',
  'goal:kokeishi': '課目の記 ── 苔石。深い個体は二度叩いてようやく崩れる',
  // ---- 特殊駒（4種） ----
  'special:harpoon': '未採録の特殊駒 ── 銛。向いた筋を一列薙ぐ。単タップで放つ',
  'special:hamushi': '未採録の特殊駒 ── 羽虫。足元を壊して飛び、狙いの一点をまた壊す',
  'special:hitsubo': '未採録の特殊駒 ── 火壺。着地を芯に5×5を吹き飛ばす',
  'special:seiju': '未採録の特殊駒 ── 星珠。盤でいちばん多い色を残らず消す',
  // ---- 一度きりの概念 ----
  intent: '兆候 ── 形が行動、数字が残り手。赤いしるしは灯を狙う',
  'oxygen-drain': '灯が喰われた ── 手数そのものが減る。奪う相手から先に落とす',
}

const KEY = 'yacho-firstnotes-v1'

/** 既視の札ID。壊れたデータ・localStorage の無い環境（テスト）は空集合に倒す */
export function loadSeenNotes(): Set<string> {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const a = JSON.parse(raw) as unknown
      if (Array.isArray(a)) return new Set(a.filter((v): v is string => typeof v === 'string'))
    }
  } catch {
    /* 壊れていたら初期化 */
  }
  return new Set()
}

export function persistSeenNotes(seen: Set<string>): void {
  localStorage.setItem(KEY, JSON.stringify([...seen]))
}
