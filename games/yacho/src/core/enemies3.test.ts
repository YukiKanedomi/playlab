// 30層化（PHASE2.md §1）で幕ごとに1種ずつ足した原生種3種のエンジン層テスト。
// 見るのは「その種がプレイヤーに強いる1つの禁じ手」が実装として成立しているかだけ：
//   綴じ蟲 … 落ちてくる列を当てにさせない（予告した列を丸ごと塞ぐ／予告は必ず外せる）
//   鐘脚   … 小突かせない（殻がある間は本体に通らず、1手で剥がせるのは1枚。3手ごとに張り直す）
//   奈落の喉 … 盤面の使用可能域そのものを変える（灯は1も奪わない）
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { BELLFOOT_SHELL_MAX, ENEMY_HP, enemyIntent, MAW_PHASE_LABELS, mawPhaseCells, type EnemyInstance } from './enemies'
import { createRunState, OXYGEN_START } from './run'
import type { BoardEvent, LevelDef, XY } from './types'

const plain = (): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
})

interface Priv {
  clearPieceAt: (p: XY, ev: BoardEvent[]) => void
  dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[], heavy?: boolean) => void
  resolveEnemyTurn: (ev: BoardEvent[]) => void
  beginResolve: () => void
}
const priv = (b: Board) => b as unknown as Priv
/** n手ぶん敵ターンを進めてイベントをまとめて返す */
const turns = (b: Board, n: number): BoardEvent[] => {
  const ev: BoardEvent[] = []
  for (let i = 0; i < n; i++) priv(b).resolveEnemyTurn(ev)
  return ev
}

describe('綴じ蟲（binder）', () => {
  it('3手で1列を予告し、次の周期でその列を封鎖する（自分の列は選ばない）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('binder', [{ x: 0, y: 0 }])
    const ev1 = turns(b, 3)
    const tel = ev1.find((x) => x.t === 'fissure-telegraph')
    expect(tel).toBeTruthy()
    expect(e.telegraph!.every((p) => p.x === e.telegraph![0].x)).toBe(true) // 1列ぶん
    expect(e.telegraph![0].x).not.toBe(0) // 自分の列は塞いでも盤面が変わらないので候補外
    const col = e.telegraph![0].x
    const ev2 = turns(b, 3)
    const sealed = ev2.filter((x) => x.t === 'cell-sealed')
    expect(sealed.length).toBeGreaterThan(0)
    expect(sealed.every((x) => x.t === 'cell-sealed' && x.at.x === col)).toBe(true)
    expect(e.telegraph).toBeNull()
  })

  it('予告された列で駒を1つ消せば綴じは止まる（裂坑掘りと同じ作法）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('binder', [{ x: 0, y: 0 }])
    turns(b, 3)
    const inside = e.telegraph![0]
    const ev: BoardEvent[] = []
    priv(b).clearPieceAt(inside, ev)
    expect(ev.some((x) => x.t === 'fissure-averted')).toBe(true)
    expect(e.telegraph).toBeNull()
  })

  it('灯は1も奪わない（妨害屋）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    b.spawnEnemy('binder', [{ x: 0, y: 0 }])
    const ev = turns(b, 9)
    expect(ev.some((x) => x.t === 'oxygen-drained')).toBe(false)
    expect(run.oxygen).toBe(OXYGEN_START)
  })
})

describe('鐘脚（bellfoot）', () => {
  const hit = (b: Board, e: EnemyInstance, amount = 6) => {
    const ev: BoardEvent[] = []
    priv(b).beginResolve() // 解決の番号を進める＝別の手として扱わせる
    priv(b).dealEnemyDamage(e.id, amount, ev, true)
    return ev
  }

  it('殻がある間は本体HPに一切通らず、1手で剥がせる殻は1枚だけ', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('bellfoot', [{ x: 0, y: 0 }])
    expect(e.shell).toBe(BELLFOOT_SHELL_MAX)
    const ev: BoardEvent[] = []
    priv(b).beginResolve()
    priv(b).dealEnemyDamage(e.id, 6, ev, true)
    priv(b).dealEnemyDamage(e.id, 6, ev, true) // 同じ解決の中では2枚目は剥がれない
    expect(ev.filter((x) => x.t === 'shell-peeled').length).toBe(1)
    expect(e.shell).toBe(BELLFOOT_SHELL_MAX - 1)
    expect(e.hp).toBe(ENEMY_HP.bellfoot)
  })

  it('殻を剥がしきってから本体に通る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('bellfoot', [{ x: 0, y: 0 }])
    for (let i = 0; i < BELLFOOT_SHELL_MAX; i++) hit(b, e)
    expect(e.shell).toBe(0)
    expect(e.hp).toBe(ENEMY_HP.bellfoot)
    const ev = hit(b, e, 4)
    expect(ev.some((x) => x.t === 'enemy-damage')).toBe(true)
    expect(e.hp).toBe(ENEMY_HP.bellfoot - 4)
  })

  it('3手ごとに殻を1枚張り直す（上限まで）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('bellfoot', [{ x: 0, y: 0 }])
    hit(b, e)
    hit(b, e)
    expect(e.shell).toBe(0)
    const ev = turns(b, 3)
    expect(ev.some((x) => x.t === 'shell-raised')).toBe(true)
    expect(e.shell).toBe(1)
    turns(b, 3)
    expect(e.shell).toBe(BELLFOOT_SHELL_MAX)
    turns(b, 3)
    expect(e.shell).toBe(BELLFOOT_SHELL_MAX) // 上限を超えない
  })

  it('兆候は残り殻の枚数を語る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = b.spawnEnemy('bellfoot', [{ x: 0, y: 0 }])
    expect(enemyIntent(e).label).toBe(`殻${BELLFOOT_SHELL_MAX}`)
    hit(b, e)
    hit(b, e)
    expect(enemyIntent(e).label).toBe('殻なし')
  })
})

describe('奈落の喉（maw・特殊ラスボス）', () => {
  const spawnMaw = (b: Board) =>
    b.spawnEnemy('maw', [
      { x: 3, y: H - 1 },
      { x: 4, y: H - 1 },
    ])

  it('相ごとに封鎖する領域が変わり、3手で必ず開く', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = spawnMaw(b)
    const sealedNow = () => {
      const out: string[] = []
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (b.at(x, y)?.block?.type === 'seal') out.push(`${x},${y}`)
      return out
    }
    // 相0：中央2列（最下行の身体セルは対象外）
    turns(b, 3)
    const split = sealedNow()
    expect(split.length).toBeGreaterThan(0)
    expect(split.every((k) => k.startsWith('3,') || k.startsWith('4,'))).toBe(true)
    expect(split.includes(`3,${H - 1}`)).toBe(false)
    // 相1：四隅（前の相はちょうど解けている＝封鎖が積み上がらない）
    turns(b, 3)
    const cross = sealedNow()
    expect(cross.some((k) => k.startsWith('0,'))).toBe(true)
    expect(cross.some((k) => k.startsWith('3,') && k !== `3,${H - 1}`)).toBe(false)
    // 相2：全域が開く
    turns(b, 3)
    expect(sealedNow().length).toBe(0)
    expect(e.hp).toBe(ENEMY_HP.maw)
  })

  it('灯は1も奪わない（HPを盛るのではなく盤面の使用可能域で戦う）', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    spawnMaw(b)
    const ev = turns(b, 12)
    expect(ev.some((x) => x.t === 'oxygen-drained')).toBe(false)
    expect(run.oxygen).toBe(OXYGEN_START)
  })

  it('どの相でも本体に隣接して殴れるマスが残る', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    spawnMaw(b)
    for (const phase of [0, 1, 2]) {
      const sealed = new Set(mawPhaseCells(phase, W, H).map((p) => `${p.x},${p.y}`))
      const around = [
        { x: 2, y: H - 1 },
        { x: 5, y: H - 1 },
        { x: 3, y: H - 2 },
        { x: 4, y: H - 2 },
      ]
      expect(around.some((p) => !sealed.has(`${p.x},${p.y}`))).toBe(true)
    }
  })

  it('兆候は次に来る相の名前を出す', () => {
    const run = createRunState([])
    const b = new Board(plain(), run)
    const e = spawnMaw(b)
    expect(enemyIntent(e).label).toBe(MAW_PHASE_LABELS[0])
    turns(b, 3)
    expect(enemyIntent(e).label).toBe(MAW_PHASE_LABELS[1])
  })
})
