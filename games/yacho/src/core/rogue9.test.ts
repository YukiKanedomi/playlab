// 工程3【知見の増設】のテスト。増設8種それぞれの本体効果と、灯の器（lampMax）会計の対称性、
// enemy-damage の環が閉じるようになったこと（返り血の苔）を検証する。
import { describe, expect, it } from 'vitest'
import { Board, H, W } from './board'
import { createRunState, discardUpgrade, takeUpgrade, LAMP_MAX_START, OXYGEN_START } from './run'
import { closesLoop, connectsTo } from './draft'
import { DISMANTLE_KNACK_ID, EMBER_CORE_ID, POWDER_MILL_ID, UPGRADES } from './upgrades'
import type { BoardEvent, LevelDef, Piece } from './types'

const plain = (over: Partial<LevelDef> = {}): LevelDef => ({
  id: 0,
  seed: 42,
  moves: 999,
  colors: 5,
  goals: [{ type: 'color', color: 0, count: 999 }],
  layout: Array(8).fill('........'),
  ...over,
})

/** rogue6.test.ts と同じ流儀のテスト用盤面組み立て（v=爆発鉱石） */
function setPieces(b: Board, rows: string[]) {
  const map: Record<string, Piece | null> = {
    '.': null,
    '0': { kind: 'normal', color: 0 },
    '1': { kind: 'normal', color: 1 },
    '2': { kind: 'normal', color: 2 },
    '3': { kind: 'normal', color: 3 },
    '4': { kind: 'normal', color: 4 },
    v: { kind: 'normal', color: 2, volatile: true },
  }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = b.at(x, y)
      if (c) c.piece = structuredClone(map[rows[y][x]]) ?? null
    }
}

/** 市松で絶対にマッチしない充填（rogue6.test.ts と同じ） */
const inert = () => {
  const rows: string[] = []
  for (let y = 0; y < H; y++) {
    let r = ''
    for (let x = 0; x < W; x++) r += String(((x + (y % 2)) % 2) + (y % 4 < 2 ? 0 : 2))
    rows.push(r)
  }
  return rows
}

/** private メソッドへのアクセス（rogue2/rogue4.test.ts と同じ流儀） */
type Priv = { dealEnemyDamage: (id: number, amount: number, ev: BoardEvent[], heavy?: boolean) => void }
const priv = (b: Board) => b as unknown as Priv

describe('灯守の甕（採録で器+6・灯+6。手放すと器は戻り、灯は器へクランプ）', () => {
  it('採録の瞬間に器が6ひろがり、灯も6ともる', () => {
    const run = createRunState([])
    takeUpgrade(run, 'lamp-vessel')
    expect(run.upgrades).toContain('lamp-vessel')
    expect(run.lampMax).toBe(LAMP_MAX_START + 6)
    expect(run.oxygen).toBe(OXYGEN_START + 6)
  })

  it('手放すと器は元に戻る（すでにともった灯は器に収まる限り残る）', () => {
    const run = createRunState([])
    takeUpgrade(run, 'lamp-vessel')
    discardUpgrade(run, 'lamp-vessel')
    expect(run.lampMax).toBe(LAMP_MAX_START)
    expect(run.oxygen).toBe(OXYGEN_START + 6) // 50 は素の器 72 に収まるので削れない
  })
})

describe('深底の油壺（採録で器+12のみ。灯そのものは増えない）', () => {
  it('器だけが12ひろがる', () => {
    const run = createRunState([])
    takeUpgrade(run, 'deep-flask')
    expect(run.lampMax).toBe(LAMP_MAX_START + 12)
    expect(run.oxygen).toBe(OXYGEN_START)
  })

  it('手放すと器が戻り、あふれた灯はその場で削れる', () => {
    const run = createRunState([])
    takeUpgrade(run, 'deep-flask')
    run.oxygen = run.lampMax // ひろがった器いっぱいまで貯めた状態
    discardUpgrade(run, 'deep-flask')
    expect(run.lampMax).toBe(LAMP_MAX_START)
    expect(run.oxygen).toBe(LAMP_MAX_START)
  })

  it('持っていない知見を手放しても器は動かない（会計の安全弁）', () => {
    const run = createRunState([])
    discardUpgrade(run, 'deep-flask')
    expect(run.lampMax).toBe(LAMP_MAX_START)
  })
})

describe('返り血の苔（原生種が傷つくたび、そのそばに植物が1つ生える）', () => {
  it('HPが実際に削れると発火し、空きマスへ植物が生まれる', () => {
    const run = createRunState(['blood-moss'])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('rockshell', [{ x: 7, y: 7 }])
    b.at(6, 7)!.piece = null // 敵のそばに空きマスを1つ用意（実プレイではマッチ直後の穴に相当）
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(e.id, 2, ev)
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === 'blood-moss')).toBe(true)
    expect(ev.some((x) => x.t === 'special-born' && x.piece.kind === 'normal' && (x.piece.color === 1 || x.piece.color === 4))).toBe(true)
    expect(b.at(6, 7)!.piece).not.toBeNull()
  })

  it('殻が受け止めた分では発火しない（「傷ついた」の嘘を作らない）', () => {
    const run = createRunState(['blood-moss'])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    const e = b.spawnEnemy('bellfoot', [{ x: 7, y: 7 }]) // 鐘脚は殻2枚から始まる
    const ev: BoardEvent[] = []
    priv(b).dealEnemyDamage(e.id, 5, ev)
    expect(ev.some((x) => x.t === 'shell-peeled')).toBe(true)
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === 'blood-moss')).toBe(false)
  })

  it('毒胞子（enemy-damageを生む）＋胞子繁殖と組むと環が閉じる（enemy-damage の使い手が初めてできた）', () => {
    const toxic = UPGRADES.find((u) => u.id === 'toxic-spore')!
    const bloom = UPGRADES.find((u) => u.id === 'spore-bloom')!
    const moss = UPGRADES.find((u) => u.id === 'blood-moss')!
    expect(connectsTo(toxic, moss)).toBe(true) // 毒胞子のダメージを返り血の苔が受け取る
    expect(closesLoop([toxic, bloom], moss)).toBe(true) // 植物→胞子→ダメージ→植物 の環
  })
})

describe('四つ目の刻印（4つ以上そろえると、跡地の近くの駒1つが遺物に変わる）', () => {
  it('4個マッチで発火し、駒が1つ遺物（色3）へ変換される', () => {
    const run = createRunState(['fourth-sigil'])
    const b = new Board(plain(), run)
    setPieces(b, ['11110313', ...inert().slice(1)]) // row0 x0..x3 に4個マッチを直接設置
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 }) // 無関係な1手で拾われる（rogue6と同じ流儀）
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === 'fourth-sigil')).toBe(true)
    expect(ev.some((x) => x.t === 'special-born' && x.piece.kind === 'normal' && x.piece.color === 3)).toBe(true)
  })

  it('3個マッチでは発火しない（minSize=4）', () => {
    const run = createRunState(['fourth-sigil'])
    const b = new Board(plain(), run)
    setPieces(b, ['11101313', ...inert().slice(1)]) // 3個だけ
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 })
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === 'fourth-sigil')).toBe(false)
  })
})

describe('胞子ぜんまい（胞子が消えると、近くの駒1つがギアに変わる）', () => {
  it('胞子の消費で発火し、駒が1つギア（色0）へ変換される', () => {
    const run = createRunState(['spore-mainspring'])
    const b = new Board(plain(), run)
    setPieces(b, ['11103131', ...inert().slice(1)]) // row0 x0..x2 に植物3個マッチ
    b.at(3, 0)!.sporeToken = true // マッチ跡地のとなりに胞子トークン
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 })
    expect(ev.some((x) => x.t === 'token-consumed')).toBe(true)
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === 'spore-mainspring')).toBe(true)
    expect(ev.some((x) => x.t === 'special-born' && x.piece.kind === 'normal' && x.piece.color === 0)).toBe(true)
  })

  it('スターター：採録直後の層開始で胞子が1つ置かれる', () => {
    const run = createRunState(['spore-mainspring'])
    const b = new Board(plain(), run)
    expect(b.initEvents.some((x) => x.t === 'upgrade-fire' && x.id === 'spore-mainspring')).toBe(true)
    expect(b.initEvents.some((x) => x.t === 'token-spawn')).toBe(true)
  })
})

describe('熾火の芯（爆発鉱石が爆発すると、最寄りの原生種に2ダメージ）', () => {
  it('爆発鉱石の爆発で最寄りの原生種のHPが2削れる', () => {
    const run = createRunState([EMBER_CORE_ID])
    const b = new Board(plain(), run)
    setPieces(b, [
      '13413413',
      '34134134',
      '41341341',
      '132v2413', // x2..x4 = 2,v,2 の鉱物3連（vが爆発する）
      '34134134',
      '41341341',
      '13413413',
      '34134134',
    ])
    const e = b.spawnEnemy('rockshell', [{ x: 7, y: 7 }]) // HP6。マッチにも爆発にも隣接しない位置
    const ev = b.swap({ x: 6, y: 6 }, { x: 7, y: 6 }) // 無関係な1手で拾われる
    expect(ev.some((x) => x.t === 'explode')).toBe(true)
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === EMBER_CORE_ID)).toBe(true)
    expect(e.hp).toBe(6 - 2)
  })
})

describe('解体の心得（特殊駒が発動すると、最寄りの原生種に2ダメージ）', () => {
  it('銛の発動で最寄りの原生種のHPが2削れる', () => {
    const run = createRunState([DISMANTLE_KNACK_ID])
    const b = new Board(plain(), run)
    setPieces(b, inert())
    b.at(0, 0)!.piece = { kind: 'harpoon', dir: 'h' } // 行0を掃く＝敵(7,7)には直接当たらない
    const e = b.spawnEnemy('rockshell', [{ x: 7, y: 7 }]) // HP6
    const ev = b.tap({ x: 0, y: 0 })
    expect(ev.some((x) => x.t === 'special-fire')).toBe(true)
    expect(ev.some((x) => x.t === 'upgrade-fire' && x.id === DISMANTLE_KNACK_ID)).toBe(true)
    expect(e.hp).toBe(6 - 2)
  })
})

describe('火薬の挽き臼（ギアが2回起動するたび、盤上の鉱物1つが爆発鉱石になる）', () => {
  it('ギア3連（起動3回）で1回発動し、鉱物が爆発鉱石へ変わる', () => {
    const run = createRunState([POWDER_MILL_ID])
    const b = new Board(plain(), run)
    setPieces(b, ['01003131', ...inert().slice(1)]) // swapで x1..x3 にギア3連（overrevテストと同型）
    const ev = b.swap({ x: 0, y: 0 }, { x: 1, y: 0 })
    expect(ev.filter((x) => x.t === 'gear-trigger').length).toBeGreaterThanOrEqual(3)
    // 2回目の起動（count=2）で発動し、盤上のどこかの鉱物が volatile になっている
    expect(ev.some((x) => x.t === 'special-born' && x.piece.kind === 'normal' && x.piece.color === 2 && x.piece.volatile === true)).toBe(true)
    // 可視化契約：進捗欄が自律機構と同じ「N/2」で更新されている
    expect(run.progress[POWDER_MILL_ID]?.max).toBe(2)
  })
})
