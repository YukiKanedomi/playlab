import { describe, expect, it } from 'vitest'
import { LEVELS30 } from './levels30'
import { Board } from './board'
import { measure } from './solver'

const layerOf = (id: number) => (id <= 10 ? 1 : id <= 20 ? 2 : 3)

describe('LEVELS30 静的検証', () => {
  it('30本・ID連番・基本パラメータが仕様通り', () => {
    expect(LEVELS30.length).toBe(30)
    LEVELS30.forEach((d, i) => {
      expect(d.id).toBe(i + 1)
      expect(d.seed).toBe(100 + d.id)
      expect(d.colors).toBe(d.id <= 10 ? 4 : 5)
      const layer = layerOf(d.id)
      const [lo, hi] = layer === 1 ? [30, 38] : layer === 2 ? [25, 30] : [23, 27]
      expect(d.moves, `Lv${d.id} moves`).toBeGreaterThanOrEqual(lo)
      expect(d.moves, `Lv${d.id} moves`).toBeLessThanOrEqual(hi)
      expect(d.layout.length).toBe(8)
      for (const row of d.layout) {
        expect(row.length).toBe(8)
        expect(/^[.#gGkKhs]{8}$/.test(row), `Lv${d.id} layout chars: ${row}`).toBe(true)
      }
    })
  })

  it('絶界行フラグと導入レベルの単独構成', () => {
    expect(LEVELS30[28].bossRun).toBe(true)
    expect(LEVELS30[29].bossRun).toBe(true)
    // 導入レベル: その障害物のみ
    const only = (d: (typeof LEVELS30)[0], chars: string) => d.layout.join('').split('').every((ch) => ('.#' + chars).includes(ch))
    expect(only(LEVELS30[0], 'kK'), 'Lv1はkokeishiのみ').toBe(true)
    expect(only(LEVELS30[3], 'gG'), 'Lv4はtsutagokeのみ').toBe(true)
    expect(only(LEVELS30[10], 'h'), 'Lv11はhakoのみ').toBe(true)
    expect(only(LEVELS30[20], 's'), 'Lv21はsubiのみ').toBe(true)
  })

  it('ゴール数が盤面在庫と矛盾しない', () => {
    for (const d of LEVELS30) {
      const all = d.layout.join('')
      const cnt = (re: RegExp) => (all.match(re) ?? []).length
      // カウント単位は「個数」（石1個=1、蔦苔1セル=1。層数ではない＝エンジン/RM準拠）
      const stoneCnt = cnt(/k/g) + cnt(/K/g)
      const groundCnt = cnt(/g/g) + cnt(/G/g)
      const hako = cnt(/h/g)
      const subi = cnt(/s/g)
      for (const g of d.goals) {
        if (g.type === 'kokeishi') expect(g.count, `Lv${d.id} kokeishi`).toBeLessThanOrEqual(stoneCnt)
        if (g.type === 'tsutagoke') expect(g.count, `Lv${d.id} tsutagoke`).toBeLessThanOrEqual(groundCnt)
        if (g.type === 'touhen') expect(g.count, `Lv${d.id} touhen`).toBeLessThanOrEqual(hako)
        if (g.type === 'spore') expect(g.count, `Lv${d.id} spore`).toBeLessThanOrEqual(subi * (d.subiCharge ?? 4))
      }
    }
  })

  it('全レベル: 盤面が生成でき、初手が存在する', () => {
    for (const d of LEVELS30) {
      const b = new Board(d)
      expect(b.hasValidMove(), `Lv${d.id} 初手なし`).toBe(true)
    }
  })
})

describe('LEVELS30 難易度計測（ソルバー勝率）', () => {
  it('全レベルがソルバーでクリア可能・難易度カーブが崩壊していない', async () => {
    const HARD = new Set([10, 15, 20, 25])
    const SUPER = new Set([29, 30])
    const rows: string[] = []
    const results: { id: number; winRate: number }[] = []
    for (const d of LEVELS30) {
      const m = measure(d, 16)
      results.push({ id: d.id, winRate: m.winRate })
      const tag = SUPER.has(d.id) ? 'SUPER' : HARD.has(d.id) ? 'HARD ' : '     '
      rows.push(
        `Lv${String(d.id).padStart(2)} ${tag} win=${(m.winRate * 100).toFixed(0).padStart(3)}% avgScore=${Math.round(m.avgScore).toString().padStart(5)} movesLeft=${m.avgMovesLeft.toFixed(1)}`,
      )
    }
    const { writeFileSync } = await import('node:fs')
    writeFileSync('games/yacho/assets_src/_difficulty.txt', rows.join('\n'))
    // 全レベル計測後にまとめて判定（1つの落第で表が失われないように）
    for (const r of results) {
      expect(r.winRate, `Lv${r.id} クリア不能`).toBeGreaterThan(0)
      if (!HARD.has(r.id) && !SUPER.has(r.id)) expect(r.winRate, `Lv${r.id} 勝率低すぎ`).toBeGreaterThanOrEqual(0.5)
      if (SUPER.has(r.id)) expect(r.winRate, `Lv${r.id} SUPERが緩すぎ`).toBeLessThanOrEqual(0.9)
    }
  }, 240000)
})
