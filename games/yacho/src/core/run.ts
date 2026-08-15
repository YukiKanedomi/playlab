// ラン単位の永続状態（ROGUE.md §3 RunState）。
// Board はこれを任意（コンストラクタ第2引数）で受け取り、フックの発火判定・記録集計に使う。
// 未指定なら Board は完全に旧来の（非ローグ）挙動のまま動く。
import { makeRng, randInt, type Rng } from './rng'
import { AUTONOMOUS_MECHANISM_ID, PREHEAT_ID, RELIC_RESONANCE_ID, RING_OF_RESONANCE_ID, UPGRADES } from './upgrades'

/**
 * ラン開始時の灯（PLAN_LOOP.md §1.4）。1スワップ=1消費なので「最初の持ち手数」でもある。
 * 10層構成では38だったが、30層化（PHASE2.md §1）で層の総数が3倍になったので 120シードの較正で44に置いた。
 * この値は主に「第一幕をどこまで安全にするか」を決める（深い遭難の分布を決めるのは SUPPLY_BY_ACT の方）。
 */
export const OXYGEN_START = 44
/**
 * 灯の器（lampMax）の初期値。補給・回復はすべてこの器でクランプされる（gainLamp）。
 * OXYGEN_START と切り離してあるのは較正のため：上限を開始値(44)に寄せるほど早解きの貯金が頭打ちになり、
 * 深層の生存が細る。120シードの実測（2026-08-15、深度25以上の遭難率）：
 *   器52=25.8% / 56=29.2% / 64=32.5% / 72=36.7%（目標35%以上。無制限時代の基準は37.5%）
 * → 9指標がすべて維持できる最小の72に置いた（assets_src/_runsim.txt）。知見・祝福はここを増やせる。
 */
export const LAMP_MAX_START = 72
/**
 * 層クリアの補給の基準値（＝第一幕の値）。早く終えた残りは次層への貯金になるが、器（lampMax）は超えない。
 * 実際に使う値は深度で変わるので、必ず supplyForFloor() / blessingSupply() を通すこと。
 */
export const OXYGEN_SUPPLY_PER_FLOOR = 12

/**
 * 深度ごとの補給（PHASE2.md §1 の三幕構成）。補給点では光胞子から灯を継ぐ（§2.7）が、
 * 深くなるほど光胞子が痩せて継げる量が減る。第一幕＝貯める／第二幕＝細り始める／第三幕＝尽きる。
 *
 * 30層を平らな補給で通すと**強いビルドの消費が補給を下回り、二度と細らなくなる**（120シードの実測で
 * 39%が一度も危険域に入らないまま深度30へ到達した）。層あたりの手数は6〜12に縛られていて上げられず、
 * 灯喰みの奪う量も「先に落とせば効かない」ので強いビルドには課金されない。幕ごとに補給を落とすのが
 * 「深いほど細る」を全ビルドに効かせる唯一の手だった（较正の記録：assets_src/_runsim.txt）。
 */
// 工程3の再較正：知見が20→28種に増えて第二幕の貯金が実測+8〜10（深度20の補給前 25.7→36前後）に膨らみ、
// 遭難中央値が25へ逸脱した。増設個別の弱体化（除外実験では単独犯なし＝合算で強い）より、観測とちょうど
// 釣り合う第二幕 10→9 で相殺する（10層ぶんで-10）。120シードで9指標がすべて帯へ戻ることを確認済み
export const SUPPLY_BY_ACT = [12, 9, 3]
export function supplyForFloor(floor: number): number {
  return SUPPLY_BY_ACT[Math.min(SUPPLY_BY_ACT.length - 1, Math.max(0, Math.floor((floor - 1) / 10)))]
}
/** 警告（炎ゆらぎ＋数字の朱化）。絶対量で判定する */
export const OXYGEN_LOW = 8
/** 最終警告（1手ごとに数字が脈打つ） */
export const OXYGEN_CRITICAL = 3

/**
 * 知見の所持上限（PHASE2.md §2）。枠が埋まった後の採録は「取る＝1つ捨てる」になる。
 * 呪いが「枠を1つ潰す」代償として成立するよう、実体は RunState.slots に持って可変にしてある
 * （この定数はラン開始時の初期値）。スターター知見も1枠を消費する。
 */
export const UPGRADE_SLOTS_DEFAULT = 8

/**
 * ラン開始時に配布する強化の抽選プール（プレイテスト反省：連鎖の起点を最初から1つ持たせる）。
 * 夜間監査[C]10/15：20種全体だと依存度・難度がばらばらで、前提物（遺物/爆発鉱石/特殊駒等）が
 * 無いと機能しない強化まで初手に出てしまう。単体で即座に盤面を動かす8種だけに絞る。
 */
export const STARTER_UPGRADE_IDS: string[] = [
  'spore-bloom',
  'fungal-awakening',
  'deep-breath',
  'mining-habit',
  AUTONOMOUS_MECHANISM_ID,
  PREHEAT_ID,
  'transformation-furnace',
  'relic-root',
]
// 増設（工程3）の返り血の苔・火薬の挽き臼も「単体で盤面を動かす」条件は満たすが、プールへ足すと
// 全シードの初期配布が組み替わり、較正済みの8種の分布ごと壊れる（実測：遭難中央値が25へ逸脱）ため
// 足していない。増設分は採録でのみ登場する。

export interface RunRecords {
  maxChain: number // 1手内で到達した最大連鎖数
  maxDestroyed: number // 1手内の最大破壊駒数
  effectFires: number // フック発動の総回数（ラン通算）
  /** 結果画面・主記録昇格用（夜間監査[C]7/[E]3）：1手（1回のswap/tap）内で発火した upgrade-fire イベント数の最大値。
   *  board.ts は変更禁止のため、main.ts の handleFloorResult がイベント列（BoardEvent[]）から件数を数えて更新する。 */
  maxFiresInOneMove: number
  critical: boolean // フック発火上限(200/解決)に達したことがあるか＝暴走のご褒美フラグ（ROGUE.md §3）
  /** 進行曲線計測用（夜間監査[B][D]）：swarm（サンドバッグ）の隣接撃破伝播（propagateSwarmDefeat）で
   *  倒れた数のラン通算。runsim.ts が「ビルド由来の撃破」と分離して集計するために使う（ラン通算のため、
   *  1手ぶんの値は呼び出し前後の差分で求める）。 */
  swarmPropagationKills: number
}

export interface RunState {
  upgrades: string[] // 取得済み強化ID（upgrades.ts の UpgradeDef.id）
  /** 知見の枠数（PHASE2.md §2）。upgrades.length がこれに達したら、採録には1つ捨てることが要る。
   *  呪いが減らせるように定数ではなくラン状態として持つ */
  slots: number
  /** 深化ずみの知見のID（PHASE2.md §2.8）。枠は消費しない＝upgrades と重複して持つ。
   *  Board は構築時に、ここに入っている知見のフックだけを UpgradeDef.deepen.apply へ通す */
  deepened: string[]
  /** 受けた祝福のID（blessings.ts の BlessingDef.id）。深度10/20/30の幕主後に各1つで最大3つ（開始時の祝福は廃止）。
   *  呪いは別の入れ物を作らず祝福と同じ1枚に書いてあるので、この配列だけで利点と代償の両方が決まる */
  blessings: string[]
  /** 忘れ形見（祝福）の使用済みフラグ。ランに一度だけ灯が戻る */
  lastLightUsed: boolean
  gearCharge: number // ギア起動カウンタ（自律機構/機械庭園/遺物共鳴の判定に使用）
  /** 唯一の資源（PLAN_LOOP.md §1.4）。1手で-1、0で遭難。層クリアで補給されるが lampMax を超えない */
  oxygen: number
  /** 灯の器＝oxygen の上限。HUDゲージの分母もこれ。知見・祝福が増やせる（gainLamp が回復をここでクランプする） */
  lampMax: number
  floor: number
  records: RunRecords
  /** 遺物共鳴(#13)が次の遺物マッチ効果を2倍にするための一時フラグ。消費で false に戻る。
   *  ROGUE.md の RunState 定義には無いが、フック間で状態を1個渡すのに最小限必要（最終報告に記載）。 */
  relicBoostNext: boolean
  /** 可視化契約：回数条件で発動する強化（自律機構/機械庭園/遺物共鳴）の進捗。board.ts が発火のたびcurを更新する。
   *  キーは UpgradeDef.id。未所持や未発火の強化にはキーが存在しない（存在しない＝0/未着手として扱ってよい）。 */
  progress: Record<string, { cur: number; max: number }>
  /** スターター効果（ROGUE2.md §1 原則2。第3波）：取得済み強化のうち、starterを既に発火させたIDの集合。
   *  Boardは構築（＝層開始）のたびrun.upgradesを見てここに無いIDのstarterだけを発火し、ここへ積む。
   *  ラン全体で1回のみ＝層をまたいで二重発火しない（同じRunStateオブジェクトを層間で引き継ぐ前提）。 */
  startersApplied: string[]
}

/**
 * ラン状態を生成する。
 * upgrades を省略した場合（＝main.ts の通常のラン開始）のみ、STARTER_UPGRADE_IDS から rng で1つ配布する
 * （「連鎖の起点」を最初から持たせるため）。テストのように upgrades を明示指定した場合（[]含む）はそのまま使う。
 */
export function createRunState(upgrades?: string[], rng: Rng = makeRng(Date.now())): RunState {
  const initialUpgrades = upgrades ?? [STARTER_UPGRADE_IDS[randInt(rng, STARTER_UPGRADE_IDS.length)]]
  return {
    upgrades: initialUpgrades,
    slots: UPGRADE_SLOTS_DEFAULT,
    deepened: [],
    blessings: [],
    lastLightUsed: false,
    gearCharge: 0,
    oxygen: OXYGEN_START,
    lampMax: LAMP_MAX_START,
    floor: 1,
    records: { maxChain: 0, maxDestroyed: 0, effectFires: 0, maxFiresInOneMove: 0, critical: false, swarmPropagationKills: 0 },
    relicBoostNext: false,
    progress: {},
    startersApplied: [],
  }
}

/**
 * 灯の回復の唯一の入口。器（lampMax）を超えないようクランプし、実際に増えた量を返す
 * （補給演出・採録帯の「灯 +N」は嘘をつかず、この戻り値＝本当に増えた量を出すこと）。
 * 消費（-1）や強奪はクランプと無関係なので通さない。
 */
export function gainLamp(run: RunState, amount: number): number {
  const before = run.oxygen
  run.oxygen = Math.min(run.lampMax, run.oxygen + amount)
  return run.oxygen - before
}

/**
 * 知見を1つ採録する唯一の入口（main.ts のドラフト確定・runsim が使う。テストが upgrades を直接組む場合は不要）。
 * 灯の器系の知見（UpgradeDef.lampMax / lamp。工程3）はここで会計を済ませる：
 * 器の増分は採録の瞬間に一度だけ効き、手放し（discardUpgrade）で対称に戻る。
 * 灯の増分は gainLamp を通す＝器でクランプし、実際に増えた量だけがともる（+Nの嘘を作らない）。
 */
export function takeUpgrade(run: RunState, id: string) {
  run.upgrades.push(id)
  const def = UPGRADES.find((u) => u.id === id)
  if (def?.lampMax) run.lampMax += def.lampMax
  if (def?.lamp) gainLamp(run, def.lamp)
}

/**
 * 知見を1つ手放す（PHASE2.md §2「取る＝捨てる」）。
 * 効果はその場で消える：Board は構築時に run.upgrades からフック一覧を組むので、
 * ここで外れた知見は次に組まれる盤面（＝採録直後の層）で既に働かない。
 * startersApplied と progress も落とす＝あとで採り直したときに「採録時のおまけ」も進捗も新品として扱う
 * （残しておくと、採り直した知見だけおまけが出ない不整合になる）。
 */
export function discardUpgrade(run: RunState, id: string) {
  const had = run.upgrades.includes(id)
  run.upgrades = run.upgrades.filter((u) => u !== id)
  // 灯の器系（工程3）：ひろげた器を戻し、あふれた灯はその場で削る（祝福の「器がせばまる」呪いと同じ規則）。
  // 採り直せばまた takeUpgrade でひろがる＝対称なので、取る/捨てるの往復で器が無限に育つことはない
  const def = UPGRADES.find((u) => u.id === id)
  if (had && def?.lampMax) {
    run.lampMax -= def.lampMax
    run.oxygen = Math.min(run.oxygen, run.lampMax)
  }
  run.startersApplied = run.startersApplied.filter((u) => u !== id)
  // 深化（PHASE2.md §2.8）も一緒に落とす＝採り直したら条件も元に戻る（深化だけが残ると幽霊になる）
  run.deepened = run.deepened.filter((u) => u !== id)
  delete run.progress[id]
  // 遺物共鳴だけは効果の待機状態を progress ではなく relicBoostNext に持つ。board.ts は所持を見ずにこれを消費するので、
  // 落とさないと「手放したのに次の遺物マッチが一度だけ2倍になる」＝捨てた知見が効いてしまう（Codexレビュー 2026-08-15）。
  // 合成の知見「共鳴の環」も同じ待機状態を立てるので、同じ後始末が要る（Codexレビュー2回目 2026-08-15）
  if (id === RELIC_RESONANCE_ID || id === RING_OF_RESONANCE_ID) run.relicBoostNext = false
}
