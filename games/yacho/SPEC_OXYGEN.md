# 実装指示書：コアループ再設計（酸素・目標・敵・手触り）

> 2026-08-14 テックリード統合版。**本書が実装の唯一の指示**。4領域の設計書とレビュー3本はここに統合済みで、
> 実装担当は元の設計書を読む必要がない（読むと矛盾する記述に当たるので**読まないこと**）。
> 上位正典は `PLAN_LOOP.md §1.4`（資源＝酸素1本）と `JUICE.md`。
> **`PLAN_LOOP.md §1.5` 冒頭の「酸素は導入しない」は §1.4 で上書き済みの古い中間案。§1.5 の「目標の劣化」も不採用**（理由は §0.3）。

---

## 0. 先に決めたこと（両論の決着）

### 0.1 統合方針

現状のコード（`board.ts` 1867行 / `main.ts` 2567行 / `BoardView.ts` 2228行、テスト90件すべて緑）を前提に、
**「1スワップ＝酸素-1、0で遭難」「層ごとに目的が変わる」「敵は妨害屋、酸素を奪うのは2種だけ」「目標が壊れてHUDへ飛ぶ」** の4点を入れる。

### 0.2 レビューで両論になった論点の決着（先送りなし）

| # | 論点 | 決定 | 理由 |
|---|---|---|---|
| 1 | 層クリアの発火口（`fireFloorClear` vs `checkFloorClear`） | **`checkFloorClear(ev)` 1本**。`defeatEnemy` からの発火と `applyFloorClearHeal` と `hadEnemies` は削除。補給+7 は `checkFloorClear` の中で行う | 目標駆動が上位仕様なので発火条件は「目標が全部埋まったか」1つ。殲滅は `enemy-kill` 目標として同じ経路に乗る |
| 2 | `run-over` の発火位置 | **`resolveEnemyTurn` 末尾に残す**（条件を `run.oxygen <= 0` に置換）。敵領域の「削除」案は破棄 | ここが唯一「1手の消費＋敵の強奪＋盤面安定」が揃う地点。消すと失敗条件が消滅する |
| 3 | 酸素を奪うイベント名（`enemy-attack` 据置 vs `oxygen-drained` 新設） | **`oxygen-drained` に一本化**。`enemy-attack` / `boss-slam` は型ごと削除 | 「酸素を奪う」という1つの事実に2つの型を残す理由がない。HUD側の呼び出し元も1本になる |
| 4 | `progressGoal` の引数順とイベント形 | **`progressGoal(match, at, ev)`** ／ **`{ t:'goal-progress'; goal; index; done; at }`** | `ev` を末尾に置く既存の慣習に合わせる。`index` はHUDカウンタの同定に必須（`indexOf(goal)` は参照依存で脆い） |
| 5 | 目標収集演出をどこに実装するか（BoardView内 vs main.ts） | **main.ts 側（`goalCollectFly`）に一本化**。BoardView は `onGoalCollect` で座標を渡すだけ | 座標変換が `toGlobal/toLocal` で正しく、飛翔ロスト時の数字ずれ保険（`goalShown`）まで設計されているのはこちら。`case 'goal-progress'` は1箇所だけ置く |
| 6 | 毒胞子を残すか、捕食印へ作り替えるか | **捕食印（`preyMark`）へ作り替え**。`poison-triggered` / `spore-poisoned` / `Cell.poisonSpore` は削除 | PLAN §3-6「盤面整理という正しい行動に罰を付けている」の是正が目的。なお「イベントを消すと紫オーバーレイが残る」という懸念は誤り（`reconcile()` 2027-2035行が毎手照合している） |
| 7 | 敵ごとのダメージ耐性（`DamageSource` 6値＋`effectiveDamage`） | **廃止。全敵共通の1行ルールにする**（§1.3）。引数は `heavy: boolean` 1つだけ | 「3個マッチは効きが薄い／大きく消すと効く」を全敵に効かせれば、種別ごとの耐性表は要らない。伝播条件も同じ boolean で判定できる |
| 8 | 敵の内部id（`sporeling`→`harvester` 等の改名） | **内部idは据え置き**（`sporeling`＝喰み蟲 / `burrower`＝裂坑掘り）。和名だけ変える。新規idは `breathstealer` の1つだけ | 改名は `ENEMY_ICON_TEX` / `makeEnemyBlock` の分岐 / テスト文字列 / 層定義に無意味な波及を生む |
| 9 | ボスの匣が「3個マッチでは剥がれない」特例 | **廃止**。どのダメージでも匣1枚。核HPは20→**8** | 特例を1つ減らす。§1.3 の共通ルールで既に「小さい一撃は弱い」が効いている |
| 10 | 酸素の数値（開始40・補給+10） | **開始24・補給+7 に変更**（§1.1） | 40/+10 だと実測消費6.2手/層に対して酸素が増え続け、警告にも遭難にも一生届かない（＝失敗条件が機能しない）。総手数予算 24+7×9=87 で PLAN の85〜100に収まる |
| 11 | 目標の数値（植物12/14 等） | **植物系だけ大幅増**（20/26/20）。位置系（蔦苔・陶片）は現行案どおり | 実測で植物12は4〜5手で終わる（1手あたり2.4個進むため）。位置系は0.47/手で既に8手前後＝適正 |
| 12 | 新規テストの置き場所（`rogue8.test.ts`） | **禁止**。`rogue8.test.ts` は既存116行のフック回帰テスト。新規は `oxygen.test.ts` / `goals.test.ts` / `enemies2.test.ts` / `floors.test.ts` | 上書きすると既存の回帰テストが消える |

### 0.3 §1.5「目標の劣化」を入れない理由

§1.4 の議論3が既に「**劣化は摩擦であって圧力ではない**（失敗に繋がらないので時間をかければ必ず達成できる）」と自己否定している。
劣化を持ち出した唯一の理由は「酸素を入れないから」であり、§1.4 で酸素を採用した時点で存在理由が消えた。
時計が2本になると「どちらの締切を見て判断するか」が読めなくなり、§1.4 の「読み方が一意」と正面衝突する。**実装しない。**

---

## 1. 確定仕様

### 1.1 酸素（唯一の資源）

| 項目 | 値 | 挙動 |
|---|---:|---|
| `OXYGEN_START` | **24** | ラン開始時の酸素。`createRunState` で設定 |
| 1手の消費 | **-1** | 成立したスワップ／特殊駒タップの**成功時のみ**。不正手（非隣接・駒なし・マッチ不成立・非特殊駒タップ）は0 |
| `OXYGEN_SUPPLY_PER_FLOOR` | **+7** | 層クリアの瞬間に加算。**上限クランプを書かない**（早く終えた残りが次層への貯金＝急ぐ動機） |
| `OXYGEN_DRAIN` | **-3** | 息喰み／ボスの定期行動。予告あり |
| 遭難 | `oxygen <= 0` | `run-over` を1回だけ発火。**失敗条件はこれだけ**（`board.lost` は旧30レベル制専用のまま触らない） |
| `OXYGEN_GAUGE_FULL` | 24 | HUD塗りの基準（貯金で超えたら満タンに丸める） |
| `OXYGEN_LOW` | 8 | 炎ゆらぎ点火＋数字を朱（`0xff8a70`） |
| `OXYGEN_CRITICAL` | 3 | 1手ごとに数字が大きく脈打つ（高速点滅はしない） |
| 総手数予算 | 24 + 7×9 = **87手** | 期待総消費 ≒86手になるよう §1.5 の目標数で調整する |

クリアと遭難が同一手で成立した場合は**クリア優先**。構造的に担保する（クリアした手では敵ターンも酸素切れ判定も走らない。§2.3）。

### 1.2 フロア目標

- `GoalType` に **`'system'`**（系統。植物＝色1と色4の両方が進む）と **`'enemy-kill'`**（撃破数）を追加。
- **目標をすべて満たした瞬間に層クリア**。残敵がいてもクリアする。殲滅は `enemy-kill` 目標に降格。
- 目標が空（`goals.length === 0`）の Board では層クリアは絶対に発火しない（旧30レベル制の保護）。

### 1.3 敵へのダメージ規則（全敵共通・1行ルール）

| 出所 | 敵へのダメージ | `heavy` |
|---|---:|:---:|
| 3個マッチ（`cells.length <= 3`） | **1** | false |
| 4個以上マッチ | `cells.length` | **true** |
| 特殊駒の効果線・羽虫 | **2** | **true** |
| 星珠の全消し | **3** | **true** |
| 爆発（爆発鉱石・火壺） | **3** | **true** |
| 強化フックの `damageEnemy` | 指定量 | false |
| swarm 伝播 | **2** | **true** |

- **swarm は `heavy` で倒されたときだけ**隣接する swarm へ伝播する（3個マッチでの各個撃破は派手にならない）。
- 甲殻（`Cell.armored`）は従来どおり駒側の追加破壊要求。敵本体の耐性ではない。

### 1.4 敵6種の最終仕様

| id | 和名 | HP | 周期 | 行動 | intent kind | 撃破・解除 |
|---|---|---:|---:|---|---|---|
| `swarm` | 小型胞子虫 | **2** | なし | **行動しない**（盤面を塞ぐだけ） | `none`（バッジを出さない） | 3個マッチ2回／4個以上・特殊駒・爆発で一撃＋伝播 |
| `rockshell` | 岩殻獣 | **6** | 2 | 鉱物(色2)1つに甲殻付与（現行 `rockshellAction` 無改造） | `armor` | 通常 |
| `sporeling` | **喰み蟲** | **5** | 2 | 印が無ければ資源1つに**捕食印**、あれば食べて駒を消し **HP+2**（`maxHp` 上限） | `devour`（`cells=[markAt]`） | 通常。加えて**印の駒そのものを消すと**印解除＋1ダメージ＋周期リセット（隣は不可） |
| `burrower` | **裂坑掘り** | **6** | 2 | 予告が無ければ**自分から最も遠い2x2**を亀裂として予告。予告があればその4マスのうち駒が残るマスを `seal`(3手)で封鎖し、**自分は空きセルへ移動** | `fissure`（`cells=telegraph`） | 通常。加えて**予告2x2の内側で1駒でも消すと予告が消える** |
| `breathstealer` | **息喰み**（新規） | **5** | 3 | **酸素-3** | `drain`（`oxygen=3`） | 通常 |
| `boss` | **深匣主** | 匣4＋核**8** | 3 | **酸素-3** | `drain`（`oxygen=3`） | 第1段階＝どんなダメージでも匣1枚。4枚剥がすと第2段階（核HP8）。身体は**最下行(H-1)の8セル**→第2段階で中央2セル(x=3,4)に縮む |

`IntentKind = 'none' | 'armor' | 'devour' | 'fissure' | 'drain'`。
息喰みとボス以外は**酸素を1も奪わない**（PLAN §1.4「基本は妨害要素」）。

### 1.5 10層の確定表（敵と目標を1枚に統合）

**規則：新しい敵は「その敵を倒すこと自体が目標の層」か「その妨害が目標と直接干渉する層」にだけ初出させる。**

| 層 | 目標（`goals`） | 敵（`enemies`） | layout | 期待手数 | 学ぶこと |
|---:|---|---|---|---:|---|
| 1 | `system plant 20` | なし | `FLAT` | 8〜9 | 目標と酸素だけを学ぶ |
| 2 | `enemy-kill 4` | swarm×4 | `FLAT` | 6 | まとめ消し（HP2＋小マッチ減衰） |
| 3 | `tsutagoke 6` | swarm×2 | `L_MOSS_A` | 8〜9 | 敵の隣より目標マス |
| 4 | `system plant 26` | swarm×3 | `FLAT` | 9 | 妨害下の収集 |
| 5 | `enemy-kill 1` | 裂坑掘り×1 | `FLAT` | 8 | 新敵の単独学習（盤面全域を見る） |
| 6 | `touhen 3` | 裂坑掘り×1 | `L_HAKO_A` | 8〜9 | 既知の敵＋新目標（亀裂が匣の周りを塞ぐ） |
| 7 | `enemy-kill 1` | 岩殻獣×1 | `FLAT` | 7 | 大きく消す |
| 8 | `tsutagoke 8` | 喰み蟲×1 + swarm×2 | `L_MOSS_B` | 9 | 捕食印＝敵の隣以外を触る初出 |
| 9 | `touhen 5` + `system plant 20` | 喰み蟲×1 + 息喰み×1 | `L_HAKO_B` | 11 | 初の酸素直接ドレイン／初の2目標 |
| 10 | `enemy-kill 1` | **ボスのみ** | `FLAT` | 11 | 匣→核＋ドレイン |

- 層10にボス以外を置かない（`enemy-kill 1` がボス撃破と一致し、「ボスを倒したのに終わらない」を構造的に防ぐ）。
- 敵の初期座標は既存 `SWARM_SPOTS` と クセ敵 `(4,4)` / `(5,4)` を使う。**障害物レイアウトはこれらの座標に絶対に重ねない**（`spawnEnemy` が `block` を無条件上書きして匣が消えるため）。
- 数値は runsim 較正の初期値。較正の調整順は **①目標数 → ②`OXYGEN_START` → ③`OXYGEN_SUPPLY_PER_FLOOR`**。

### 1.6 juice（第1弾で入れるもの）

| 対象 | 確定値 |
|---|---|
| スワップ（成立） | `T.swap = 150ms` ＋ `easeOutBackSoft`（約5%オーバーシュート） |
| スワップ（不成立） | `T.swapBack = 120ms` × 往復（計240ms）、イージングは `easeOutCubic` のまま |
| 落下 | `dur = min(340, 150 * sqrt(dist))`、`easeInQuad`、列スタッガー `((x*5)%4)*9 ms`、着地で 52ms 潰れ（`1.14/0.86` ＋ `y+S*0.052`）→110ms `easeOutBackSoft` で戻る |
| 補充 | `dur = min(340, 150*sqrt(y+1))`、`easeInQuad`、`delay = t + T.pop + y*14`。**着地バウンスは付けない** |
| 消滅ポップ | `T.pop = 200ms` 固定のまま中身を3段に：膨張62ms(`easeOutBackSoft`,×1.28)→ホールド28ms→弾け88ms(`easeInCubic`,→0)。**火花は `t+88`**（膨らみの後） |
| `reconcile` | `delay(total + 200, ...)`（現行 `+80` では着地の沈みが切られる） |
| 目標収集 | 破片は先頭4件（既存 `debrisFx` 流用）、飛翔は先頭6件、超過分は数字だけ更新。飛翔 300〜450ms の弧＋着弾でカウンタが跳ねる |
| 振動 | 通常消し8ms／特殊駒生成15ms／爆発・コンボ25ms／連鎖5以上30ms。**1手あたり pop は最大4回** |

**変更禁止**：`T.pop = 200` / `T.fall = 380`（`total` と全 delay の基準）／`chainBeatFor()` の 520-470-410-350-300-220 ／ `HitstopBudget`。

---

## 2. ファイル所有権と着手順

### 2.1 排他所有（1ファイル＝1工程。所有者以外は開かない）

| ファイル | 所有工程 | 備考 |
|---|---|---|
| `src/core/types.ts` | **P0** | 全領域の追加をここで1回だけ入れる。後から足したくなったら P0 に差し戻す |
| `src/core/run.ts` | **P0** | |
| `src/core/enemies.ts` | **P0** | |
| `src/core/board.ts`（1867行） | **P1** | **単独所有**。酸素・目標・敵ループ・ボスを1人が続けて書く。他工程は P1 完了まで開かない |
| `src/core/floors.ts` | **P2** | 敵編成も目標もレイアウトもここが所有（提案の受け渡しはしない） |
| `src/core/*.test.ts` | **P3** | 既存の書き換え＋新規。`rogue8.test.ts` は**触らない** |
| `src/core/runsim.ts` | **P4** | 集計・ソルバー・較正 |
| `src/view/BoardView.ts`（2228行） | **P5** | イベント差し替え・敵描画・juice・収集の発火 |
| `src/main.ts`（2567行）＋ `src/core/glossary.ts` | **P6** | HUD・遭遇帯・野帳・メニュー・QAフック |
| `src/juice/tween.ts` ＋ `src/juice/haptics.ts`（新規） | **P7** | 完全独立 |
| `ROGUE.md` / `PLAN_LOOP.md` の追記 | **P8** | 最後に1回 |

### 2.2 依存と並列可否

| 工程 | 依存 | 並列可能な相手 |
|---|---|---|
| P7 juice基盤 | なし | **全工程**（最初に入れてよい） |
| P0 型・定数 | なし | P7 |
| P1 board.ts | P0 | **P2 / P5 / P6**（別ファイル。ただし動作確認は P1 完了後） |
| P2 floors.ts | P0 | P1 / P5 / P6 |
| P5 BoardView | P0, P7 | P1 / P2 / P6 |
| P6 main.ts | P0, P7 | P1 / P2 / P5 |
| P3 テスト | **P1, P2** | P5 / P6 |
| P4 runsim・較正 | **P1, P2, P3が緑** | P5 / P6 |
| P8 ドキュメント | 全部 | — |

**逐次でなければならない鎖**：`P0 → P1 → P3 → P4`（および `P0 → P2 → P3`）。
**推奨の走らせ方**：`P7` → `P0` → ここで `P1` / `P2` / `P5` / `P6` の4本を並列 → `P1,P2` 完了で `P3` → `P4`（較正）→ `P8`。

**契約（並列中に守るもの）**
- BoardView → main.ts のコールバック署名は §5.5 / §6.5 の形で**先に凍結**する。
- `main.ts` が公開する目標チップは **`{ root: Container; icon: Container; setValue: (v:number)=>void }` の3点のみ**。`icon` はローカル原点＝アイコン中心（飛翔の着弾点）。
- HUD は毎手 `board.goalDone` を無条件に流し込まない（必ず `goalShown` を経由。§6.6）。

---

## 3. 工程P0：型と定数の確定

**編集ファイル**：`src/core/types.ts` / `src/core/run.ts` / `src/core/enemies.ts`
**注意**：この工程単独ではビルドが通らない（`board.ts` が追随するまで型エラーが残る）。P1と同一ブランチで連続実施する。

### 3.1 `types.ts`

1. **27行 `EnemyKind`** に `breathstealer` を追加：
   ```ts
   export type EnemyKind = 'rockshell' | 'sporeling' | 'burrower' | 'swarm' | 'breathstealer' | 'boss'
   ```
2. **36行 `poisonSpore`** を差し替え：
   ```ts
   preyMark?: boolean // 喰み蟲が次に食べる駒の印。この駒を消すと追い払える（ROGUE.md §5）
   ```
3. **39-50行 目標**：
   ```ts
   import type { System } from './hooks' // ファイル先頭に追加（型のみ＝実行時の循環は起きない）

   export type GoalType =
     | 'color'
     | 'system'      // 系統（植物は色1と色4の両方が進む）
     | 'kokeishi'
     | 'tsutagoke'
     | 'touhen'
     | 'spore'
     | 'enemy-kill'  // 敵の撃破数

   export interface Goal {
     type: GoalType
     color?: Color
     system?: System // type==='system' のときのみ
     count: number
   }
   ```
4. **85行 `goal-progress`** を差し替え（`index`＝`Board.goals` の添字、`at`＝進捗を生んだセル）：
   ```ts
   | { t: 'goal-progress'; goal: Goal; index: number; done: number; at: XY }
   ```
5. **103〜112行のローグ拡張ブロック**を次の形に置き換える。
   - **削除**：`spore-poisoned`(103) / `poison-triggered`(104) / `boss-retreat`(107) / `boss-slam`(108) / `enemy-attack`(109) / `env-grow`(110)
   - **維持**：`enemy-damage`(99) / `enemy-defeated`(100) / `armor-applied`(101) / `armor-broken`(102) / `cell-sealed`(105) / `cell-unsealed`(106)
   - **追加**：
   ```ts
     | { t: 'prey-marked'; at: XY; id: number }                       // 喰み蟲：捕食印を付けた
     | { t: 'prey-devoured'; at: XY; id: number; hpLeft: number }     // 喰み蟲：印の駒を食べた（駒は消える）
     | { t: 'prey-escaped'; at: XY; id: number }                      // 印の駒を消して追い払った
     | { t: 'fissure-telegraph'; cells: XY[]; id: number }            // 裂坑掘り：崩落予告の2x2
     | { t: 'fissure-averted'; id: number }                           // 予告の中断
     | { t: 'boss-shell-broken'; id: number; left: number }           // ボス：封印匣を1枚剥がした
     | { t: 'boss-phase'; id: number; phase: 2; freed: XY[] }         // ボス：核が露出し身体が縮む
     | { t: 'oxygen-spent'; left: number }                            // 1手ぶんの消費(-1)。不正手では出ない
     | { t: 'oxygen-refill'; amount: number; left: number }           // 層クリアの補給
     | { t: 'oxygen-drained'; id: number; amount: number; left: number } // 息喰み/ボスが酸素を直接奪う
     | { t: 'floor-clear' }                                           // 層の目標をすべて達成した（残敵の有無は問わない）
     | { t: 'run-over' }                                              // oxygen<=0 で遭難
   ```

### 3.2 `run.ts`

- 冒頭（`STARTER_UPGRADE_IDS` の直前）に定数を追加：
  ```ts
  /** ラン開始時の酸素（PLAN_LOOP.md §1.4）。1スワップ=1消費なので「最初の持ち手数」でもある */
  export const OXYGEN_START = 24
  /** 層クリアの補給。上限は設けない＝早く終えた残りがそのまま次層への貯金になる */
  export const OXYGEN_SUPPLY_PER_FLOOR = 7
  /** HUD塗りの満タン基準（表示専用。貯金で超えたら満タンに丸める） */
  export const OXYGEN_GAUGE_FULL = OXYGEN_START
  /** 警告（炎ゆらぎ＋数字の朱化）。絶対量で判定する */
  export const OXYGEN_LOW = 8
  /** 最終警告（1手ごとに数字が脈打つ） */
  export const OXYGEN_CRITICAL = 3
  ```
- **40行 `playerHp: number` を削除**し、同じ位置に：
  ```ts
    /** 唯一の資源（PLAN_LOOP.md §1.4）。1手で-1、0で遭難。層クリアで +OXYGEN_SUPPLY_PER_FLOOR（上限なし） */
    oxygen: number
  ```
- **65行 `playerHp: 20,`** → `oxygen: OXYGEN_START,`。`createRunState` の署名は変えない。

### 3.3 `enemies.ts`

1. **7-19行 `EnemyInstance`** を差し替え：
   ```ts
   export interface EnemyInstance {
     id: number
     kind: EnemyKind
     hp: number
     maxHp: number
     cells: XY[]
     actionTimer: number      // 全種共通の周期カウンタ（ボスも統合）
     markAt: XY | null        // 喰み蟲：捕食印の位置
     telegraph: XY[] | null   // 裂坑掘り：崩落予告の2x2
     bossPhase: 1 | 2         // ボス：1=封印匣 2=核
     bossShellLeft: number    // ボス：残りの匣枚数
   }
   ```
   （削除：`attackTurn` / `bossDamageAccum` / `bossAttackTimer` / `bossFrontRow`）
2. **21-48行**を差し替え：
   ```ts
   export const ENEMY_HP: Record<EnemyKind, number> = {
     swarm: 2, rockshell: 6, sporeling: 5, burrower: 6, breathstealer: 5, boss: 8, // boss は「核」のHP
   }
   /** 定期行動の周期（手）。0 = 定期行動を持たない */
   export const ENEMY_PERIOD: Record<EnemyKind, number> = {
     swarm: 0, rockshell: 2, sporeling: 2, burrower: 2, breathstealer: 3, boss: 3,
   }
   /** 酸素を直接奪う敵と、その量（PLAN_LOOP.md §1.4「まれに酸素を奪う敵」） */
   export const OXYGEN_DRAIN: Record<'breathstealer' | 'boss', number> = { breathstealer: 3, boss: 3 }
   export const BOSS_SHELL_COUNT = 4
   /** swarm 撃破時に隣接 swarm へ伝播するダメージ（HP2＝即死） */
   export const SWARM_PROPAGATE_DAMAGE = 2
   ```
   **削除**：`ENEMY_ATTACK_DAMAGE` / `SWARM_ATTACK_PERIOD` / `SWARM_FIRST_ATTACK_TURN` / `swarmTurnsUntil` / `swarmShouldFire` / `swarmGroupDamage`。
3. **83-96行 `createEnemy`**：新フィールドを初期化（`actionTimer: 0, markAt: null, telegraph: null, bossPhase: 1, bossShellLeft: kind === 'boss' ? BOSS_SHELL_COUNT : 0`）。
4. **105-127行**を差し替え：
   ```ts
   export type IntentKind = 'none' | 'armor' | 'devour' | 'fissure' | 'drain'

   export interface EnemyIntent {
     kind: IntentKind
     turns: number     // 発動までの残り手数（kind==='none' は 0）
     oxygen?: number   // 奪う酸素量（'drain' のみ）
     cells?: XY[]      // 予告地点（'fissure'=崩落2x2 / 'devour'=捕食印）
     label: string     // バッジ脇・遭遇チップ・野帳シートで使う短い日本語
   }

   export function turnsUntilAction(e: EnemyInstance): number {
     const p = ENEMY_PERIOD[e.kind]
     return p <= 0 ? 0 : p - (e.actionTimer % p)
   }

   export function enemyIntent(e: EnemyInstance): EnemyIntent {
     const turns = turnsUntilAction(e)
     switch (e.kind) {
       case 'swarm':         return { kind: 'none', turns: 0, label: '動かない' }
       case 'rockshell':     return { kind: 'armor', turns, label: '甲殻' }
       case 'sporeling':     return { kind: 'devour', turns, cells: e.markAt ? [e.markAt] : undefined, label: e.markAt ? '捕食' : '目星' }
       case 'burrower':      return { kind: 'fissure', turns, cells: e.telegraph ?? undefined, label: e.telegraph ? '崩落' : '掘削' }
       case 'breathstealer': return { kind: 'drain', turns, oxygen: OXYGEN_DRAIN.breathstealer, label: `酸素-${OXYGEN_DRAIN.breathstealer}` }
       case 'boss':          return { kind: 'drain', turns, oxygen: OXYGEN_DRAIN.boss, label: `酸素-${OXYGEN_DRAIN.boss}` }
     }
   }
   ```
5. `bossBodyCells(frontRow, bottomRow, width)` は署名据え置き（呼び出し側の引数だけ変わる）。

### 3.4 完了条件

- `git diff --stat` が上記3ファイルのみ。
- `npx tsc --noEmit`（`games/yacho`）を走らせ、**残るエラーが `board.ts` / `main.ts` / `BoardView.ts` / `runsim.ts` / テストの5系統だけ**であること（＝型の変更が漏れなく波及していることの確認。この時点でエラー0はあり得ない）。

---

## 4. 工程P1：board.ts（酸素・目標・敵ループ・ボス）

**編集ファイル**：`src/core/board.ts` のみ。行番号はすべて**変更前**のもの。

### 4.1 import と不要フィールドの掃除

- **21行**：`import { bossBodyCells, createEnemy, ENEMY_ATTACK_DAMAGE, swarmGroupDamage, swarmShouldFire, type EnemyInstance } from './enemies'`
  → `import { bossBodyCells, BOSS_SHELL_COUNT, createEnemy, ENEMY_PERIOD, OXYGEN_DRAIN, SWARM_PROPAGATE_DAMAGE, type EnemyInstance } from './enemies'`
- **20行**：`import type { RunState } from './run'` → `import { OXYGEN_SUPPLY_PER_FLOOR, type RunState } from './run'`
- **22行**：`import type { FloorDef, EnvFlag } from './floors'` → `import type { FloorDef } from './floors'`
- **71-73行**：`private env: EnvFlag = null` / `private envTurnCounter = 0` / `private hadEnemies = false` を**3行とも削除**。
- **1553行** `this.hadEnemies = true` を削除。
- **1542行** `this.env = floor.env` を削除。

### 4.2 1手のコスト（`spendMove`）

- `get lost()`（926-928行）の直後に追加：
  ```ts
    /**
     * 1手ぶんのコストを支払う（PLAN_LOOP.md §1.4：1スワップ＝酸素-1）。
     * movesLeft は旧30レベル制の手数、oxygen はランの資源。ライフサイクルが違うので別フィールドのまま保持し、
     * 「手を1つ使った」という同じ事実に対してここでだけ両方を動かす（減算点を1本にする）。
     */
    private spendMove(ev: BoardEvent[]) {
      this.movesLeft--
      if (!this.run) return
      this.run.oxygen--
      ev.push({ t: 'oxygen-spent', left: this.run.oxygen })
    }
  ```
- **315 / 331 / 346 / 361行**の `this.movesLeft--` を `this.spendMove(ev)` に置換（4か所）。
- **`finishWin()` 内の 942行 `this.movesLeft--` は置換しない**（旧30レベル制の勝利ドレイン演出。ローグからは呼ばれない）。

### 4.3 手の締め（`endMove`）

- `swap()` / `tap()` の4か所（**319-320 / 335-336 / 350-351 / 365-366行**）の
  `this.afterMove(ev)` ＋ `this.resolveEnemyTurn(ev)` の2行を、それぞれ **`this.endMove(ev)`** の1行に置換する。
- `afterMove`（882行）の直前に追加：
  ```ts
    /**
     * 1手の締め（swap/tapの4経路で共通）。afterMove → 層クリア判定 → （未クリアなら）敵ターン。
     * 目標を達成した手では敵ターンを走らせない＝早く達成すれば反撃を受けずに層を出られる。
     */
    private endMove(ev: BoardEvent[]) {
      this.afterMove(ev)
      this.checkFloorClear(ev)
      if (this.floorCleared) return
      this.resolveEnemyTurn(ev)
    }
  ```

### 4.4 目標（`progressGoal` と `checkFloorClear`）

- **913-921行 `progressGoal`** を差し替え：
  ```ts
    /**
     * 目標の前進。at＝この前進を起こしたセル（HUDへ飛ぶ収集演出の始点。JUICE.md §1②）。
     * 'system' 目標は 'color' の前進から systemOf() で導出する（呼び出し側を色ごとに書き分けない）。
     */
    private progressGoal(match: { type: Goal['type']; color?: Color }, at: XY, ev: BoardEvent[]) {
      this.goals.forEach((g, i) => {
        if (this.goalDone[i] >= g.count) return
        if (g.type === 'system') {
          if (match.type !== 'color' || match.color === undefined) return
          if (g.system !== systemOf(match.color)) return
        } else {
          if (g.type !== match.type) return
          if (g.type === 'color' && g.color !== match.color) return
        }
        this.goalDone[i]++
        ev.push({ t: 'goal-progress', goal: g, index: i, done: this.goalDone[i], at })
      })
    }
  ```
- **呼び出し9か所**に座標を渡す（第2引数）。

  | 行 | 渡す座標 |
  |---:|---|
  | 459 | `p` |
  | 468 | `p` |
  | 545 | `p` |
  | 546 | `p` |
  | 598 | `{ x, y }` |
  | 702 | `t` |
  | 761 | `p` |
  | 892 | `{ x, y }` |
  | 1173 | `p` |

- **二重計上の穴を塞ぐ（必須）**：598 / 702 / 761 / 1173行は「先に `progressGoal` → 後で `clearPieceAt`」の順で呼ぶが、
  `clearPieceAt` は `c.armored` のとき駒を消さずに return する（453-458行）。このままだと**甲殻付きの駒で目標だけが進む**。
  4か所すべてで、`progressGoal` の呼び出しを `if (!c.armored) { ... }`（＝そのセルの `Cell` を取って甲殻判定）でガードする。
- `won` getter（923-925行）と `lost` getter（926-928行）は**変更しない**。
- `defeatEnemy` の直前あたりに層クリア判定を新設：
  ```ts
    /**
     * 層クリアの唯一の判定点（PLAN_LOOP.md §1.4）。目標がすべて満たされていればクリア（残敵がいてもクリアする）。
     * 補給は層クリアと不可分なので同じ関数の中で行う。1層につき1回だけ発火する。
     */
    private checkFloorClear(ev: BoardEvent[]) {
      if (!this.run || this.floorCleared) return
      if (this.goals.length === 0) return // 空goalsだと won が true になるため必須のガード
      if (!this.won) return
      this.floorCleared = true
      ev.push({ t: 'floor-clear' })
      this.run.oxygen += OXYGEN_SUPPLY_PER_FLOOR // 上限クランプを書かないこと（貯金＝急ぐ動機）
      ev.push({ t: 'oxygen-refill', amount: OXYGEN_SUPPLY_PER_FLOOR, left: this.run.oxygen })
    }
  ```
- **1652-1661行 `applyFloorClearHeal()` をメソッドごと削除**。

### 4.5 ダメージ経路に `heavy` を通す

- **486行**：`private damageAround(cells: XY[], ev: BoardEvent[], enemyDmg?: number, heavy = false)`
  - 505行 → `this.dealEnemyDamage(c.block.enemyId, dmg, ev, heavy)`
  - 509行 → `this.damageBlock(q, ev, 1, heavy)`
- **514行**：`damageBlock(p: XY, ev: BoardEvent[], enemyDmg = 1, heavy = false)`
  - 519行 → `this.dealEnemyDamage(b.enemyId, enemyDmg, ev, heavy)`
- **呼び出し側（§1.3 の表を実装する）**

  | 行 | 変更後 |
  |---:|---|
  | 427 | `this.damageAround(cl.cells, ev, cl.cells.length >= 4 ? cl.cells.length : 1, cl.cells.length >= 4)` |
  | 587 | `this.damageBlock({ x, y }, ev, 2, true)` |
  | 695 | `this.damageAround([from], ev, 2, true)` |
  | 700 | `this.damageBlock(t, ev, 2, true)` |
  | 765 | `this.damageAround(best, ev, 3, true)` |
  | 1159 | `this.damageBlock(p, ev, 3, true)`（既に3。`, true` を足すだけ） |
  | 1412 | 変更なし（既定 `heavy=false`） |

### 4.6 `dealEnemyDamage` とボス2段階

- **1608-1622行**を差し替え：
  ```ts
    /** 敵1体にダメージ。ボス第1段階は匣を1枚剥がすだけ（量は無関係）。hp<=0 で撃破処理へ */
    private dealEnemyDamage(id: number, amount: number, ev: BoardEvent[], heavy = false) {
      const e = this.enemies.find((x) => x.id === id)
      if (!e || e.hp <= 0) return
      if (e.kind === 'boss' && e.bossPhase === 1) {
        e.bossShellLeft--
        ev.push({ t: 'boss-shell-broken', id, left: Math.max(0, e.bossShellLeft) })
        if (e.bossShellLeft <= 0) this.bossEnterPhase2(e, ev)
        return // 第1段階では hp を削らない
      }
      e.hp = Math.max(0, e.hp - amount)
      ev.push({ t: 'enemy-damage', id, amount, hpLeft: e.hp })
      if (e.hp <= 0) this.defeatEnemy(e, ev, heavy)
    }

    /** 第2段階へ：中央2セルだけ残して身体を縮める（盤面が広がるご褒美） */
    private bossEnterPhase2(e: EnemyInstance, ev: BoardEvent[]) {
      const keep = [{ x: 3, y: H - 1 }, { x: 4, y: H - 1 }]
      const freed = e.cells.filter((p) => !keep.some((k) => k.x === p.x && k.y === p.y))
      for (const p of freed) {
        const c = this.at(p.x, p.y)
        if (c?.block?.type === 'enemy' && c.block.enemyId === e.id) c.block = null
      }
      e.cells = keep
      e.bossPhase = 2
      ev.push({ t: 'boss-phase', id: e.id, phase: 2, freed })
    }
  ```
- **1624-1634行 `bossRetreat` をメソッドごと削除**。
- **1544行**：`this.spawnEnemy('boss', bossBodyCells(H - 2, H - 1, W))` → `bossBodyCells(H - 1, H - 1, W)`（下2行→最下1行）。

### 4.7 撃破と伝播

- **1636-1650行 `defeatEnemy`** を差し替え：
  ```ts
    /** 敵を撃破：身体セルを開放し、enemy-kill 目標を1つ進める。heavy な一撃で倒した swarm だけが伝播する */
    private defeatEnemy(e: EnemyInstance, ev: BoardEvent[], heavy = false) {
      for (const p of e.cells) {
        const c = this.at(p.x, p.y)
        if (c?.block?.type === 'enemy' && c.block.enemyId === e.id) c.block = null
      }
      this.enemies = this.enemies.filter((x) => x.id !== e.id)
      ev.push({ t: 'enemy-defeated', id: e.id, cells: e.cells })
      this.progressGoal({ type: 'enemy-kill' }, e.cells[0] ?? { x: 0, y: 0 }, ev)
      if (e.kind === 'swarm' && heavy) this.propagateSwarmDefeat(e, ev)
    }
  ```
  （floor-clear の発火はここから完全に無くなる）
- **1680行**：`this.dealEnemyDamage(n.id, SWARM_PROPAGATE_DAMAGE, ev, true)`。1682行の `swarmPropagationKills++` は残す。

### 4.8 敵ターン（`resolveEnemyTurn`）

**1687-1718行**を差し替え：
```ts
  /** ターン終了処理：封鎖期限→各敵の定期行動→再安定化→層クリア/遭難判定。endMove から呼ばれる */
  private resolveEnemyTurn(ev: BoardEvent[]) {
    if (!this.run) return
    this.tickSeals(ev)
    for (const e of [...this.enemies]) {
      if (e.hp <= 0) continue
      const period = ENEMY_PERIOD[e.kind]
      if (period <= 0) continue // swarm は定期行動を持たない
      e.actionTimer++
      if (e.actionTimer % period !== 0) continue
      switch (e.kind) {
        case 'rockshell': this.rockshellAction(e, ev); break
        case 'sporeling': this.harvesterAction(e, ev); break
        case 'burrower': this.diggerAction(e, ev); break
        case 'breathstealer':
        case 'boss': this.drainOxygen(e, ev); break
      }
    }
    // 敵の行動で空いた/塞がったセルを重力・補充で安定させる
    this.resolveCascades(ev)
    // 敵ターン中の偶発マッチで目標が埋まることがあるので、ここでもクリアを見る（クリア優先）
    this.checkFloorClear(ev)
    if (this.floorCleared) return
    if (this.run.oxygen <= 0 && !this.runOverFired) {
      this.runOverFired = true
      ev.push({ t: 'run-over' })
    }
  }
```
**削除**：`swarmGroupAttack`(1720-1731) / `performEnemyAction`(1733-1741) / `enemyAttackAction`(1743-1749) / `tickEnvironment`(1827-1837) / `growNear`(1839-1866) / `bossPeriodicAttack`(1818-1825)。
`rockshellAction`(1751-1763) と `tickSeals`(1803-1816) は無改造で残す。

### 4.9 酸素ドレイン（息喰み／ボス共通）

```ts
  /** 息喰み／深匣主：酸素を直接奪う（PLAN_LOOP.md §1.4 の唯一の直接ダメージ） */
  private drainOxygen(e: EnemyInstance, ev: BoardEvent[]) {
    if (!this.run) return
    const amount = OXYGEN_DRAIN[e.kind as 'breathstealer' | 'boss']
    this.run.oxygen -= amount
    ev.push({ t: 'oxygen-drained', id: e.id, amount, left: this.run.oxygen })
  }
```

### 4.10 喰み蟲（`sporelingAction` → `harvesterAction`）

**1765-1777行**を差し替え：
```ts
  /** 喰み蟲：印が無ければ資源1つに捕食印、あれば食べてHP+2。印は敵から離れた場所に付くので「敵の隣以外」を触らせる */
  private harvesterAction(e: EnemyInstance, ev: BoardEvent[]) {
    if (e.markAt) {
      const c = this.at(e.markAt.x, e.markAt.y)
      if (c?.preyMark) {
        c.preyMark = false
        c.piece = null // 食べられた駒は消える（落下で盤面が動く＝軽い妨害）
        e.hp = Math.min(e.maxHp, e.hp + 2)
        ev.push({ t: 'prey-devoured', at: e.markAt, id: e.id, hpLeft: e.hp })
      }
      e.markAt = null
      return
    }
    const prefer: XY[] = []
    const fallback: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        const p = c?.piece
        if (!c || !p || c.preyMark) continue
        if (p.kind === 'spore' || (p.kind === 'normal' && (p.volatile || p.charged))) prefer.push({ x, y })
        else if (p.kind === 'normal') fallback.push({ x, y })
      }
    const cands = prefer.length ? prefer : fallback
    if (!cands.length) return
    const at = cands[randInt(this.rng, cands.length)]
    this.at(at.x, at.y)!.preyMark = true
    e.markAt = at
    ev.push({ t: 'prey-marked', at, id: e.id })
  }

  /** 印の駒そのものが消えたときの追い払い（隣は不可＝「その1マスを狙う」を要求する） */
  private releasePreyMark(p: XY, ev: BoardEvent[]) {
    const c = this.at(p.x, p.y)
    if (!c?.preyMark) return
    c.preyMark = false
    const e = this.enemies.find((x) => x.markAt && x.markAt.x === p.x && x.markAt.y === p.y)
    if (!e) return
    e.markAt = null
    e.actionTimer = 0
    ev.push({ t: 'prey-escaped', at: p, id: e.id })
    this.dealEnemyDamage(e.id, 1, ev) // 追い払いの報酬（heavy ではない）
  }
```

### 4.11 裂坑掘り（`burrowerAction` → `diggerAction`）

**1779-1801行**を差し替え：
```ts
  /** 裂坑掘り：2手ごとに「遠い2x2の予告」と「崩落＋移動」を交互に行う（読めない封鎖の置換） */
  private diggerAction(e: EnemyInstance, ev: BoardEvent[]) {
    if (e.telegraph) {
      const sealed: XY[] = []
      for (const p of e.telegraph) {
        const c = this.at(p.x, p.y)
        if (!c || c.block || !c.piece) continue
        c.piece = null
        c.block = { type: 'seal', turnsLeft: 3 }
        sealed.push(p)
        ev.push({ t: 'cell-sealed', at: p, turns: 3, id: e.id })
      }
      if (!sealed.length) ev.push({ t: 'fissure-averted', id: e.id })
      e.telegraph = null
      this.relocateDigger(e)
      return
    }
    const src = e.cells[0]
    let best: XY | null = null
    let bestD = -1
    for (let y = 0; y + 1 < H; y++)
      for (let x = 0; x + 1 < W; x++) {
        const quad = [{ x, y }, { x: x + 1, y }, { x, y: y + 1 }, { x: x + 1, y: y + 1 }]
        if (quad.some((q) => !this.at(q.x, q.y) || this.at(q.x, q.y)!.block)) continue
        const d = Math.abs(x - src.x) + Math.abs(y - src.y)
        if (d > bestD) { bestD = d; best = { x, y } }
      }
    if (!best) return
    e.telegraph = [best, { x: best.x + 1, y: best.y }, { x: best.x, y: best.y + 1 }, { x: best.x + 1, y: best.y + 1 }]
    ev.push({ t: 'fissure-telegraph', cells: e.telegraph, id: e.id })
  }

  /** 崩落のあと空きセルへ移る（予告位置が毎回変わる＝学習済みの角に固定されない） */
  private relocateDigger(e: EnemyInstance) {
    const empties: XY[] = []
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const c = this.at(x, y)
        if (c && !c.block && !c.piece) empties.push({ x, y })
      }
    if (!empties.length) return
    const to = empties[randInt(this.rng, empties.length)]
    for (const p of e.cells) {
      const c = this.at(p.x, p.y)
      if (c?.block?.type === 'enemy' && c.block.enemyId === e.id) c.block = null
    }
    this.at(to.x, to.y)!.block = { type: 'enemy', enemyId: e.id }
    e.cells = [to]
  }

  /** 予告2x2の内側で駒が消えたら崩落を中断する */
  private checkFissureAverted(p: XY, ev: BoardEvent[]) {
    for (const e of this.enemies) {
      if (e.kind !== 'burrower' || !e.telegraph) continue
      if (!e.telegraph.some((q) => q.x === p.x && q.y === p.y)) continue
      e.telegraph = null
      ev.push({ t: 'fissure-averted', id: e.id })
    }
  }
```

### 4.12 `clearPieceAt`（462-474行）の書き換え

```ts
    if (c.piece?.kind === 'normal' && countColor !== undefined) this.progressGoal({ type: 'color', color: c.piece.color }, p, ev)
    if (c.piece) this.score += 10 * Math.max(1, this.chain)
    const destroyedPiece = c.piece
    const hadPreyMark = c.preyMark === true
    c.piece = null
    if (c.ground > 0) {
      c.ground = (c.ground - 1) as 0 | 1
      ev.push({ t: 'ground-hit', at: p, left: c.ground })
      if (c.ground === 0) this.progressGoal({ type: 'tsutagoke' }, p, ev)
    }
    if (this.run) {
      if (hadPreyMark) this.releasePreyMark(p, ev)
      if (destroyedPiece) this.checkFissureAverted(p, ev)
    }
    if (this.run && destroyedPiece) {
      this.resolveDestroyCount++
      this.onPieceDestroyed(p, destroyedPiece, cause, ev, doubleGear)
    }
```
（`wasPoisoned` と HP-1 の罰は削除。`releasePreyMark` は自分で `c.preyMark = false` を行うので、ここでは落とさない）

### 4.13 初期盤面の詰み防止（有効手0の層をなくす）

`fillInitial()` の詰み防止ガード（132行）は `spawnFloor`（94行）**より前**に走るため、敵配置で駒が消えると保証が破れる（実測で匣レイアウト＋敵で1〜2%の頻度）。
コンストラクタ **95行 `this.applyStarters(initEv)` の直前**に追加：
```ts
    if (floor) {
      let g = 0
      while (!this.hasValidMove() && g++ < 100) this.rerollSomePieces()
    }
```

### 4.14 完了条件

- `npx tsc --noEmit` の残エラーが `main.ts` / `BoardView.ts` / `runsim.ts` / テストだけになる。
- `grep -rn "playerHp\|hadEnemies\|applyFloorClearHeal\|bossRetreat\|swarmGroupAttack\|tickEnvironment\|attackTurn" src/core/board.ts` が**0件**。

---

## 5. 工程P2：floors.ts（層表・レイアウト）

**編集ファイル**：`src/core/floors.ts`

### 5.1 型

```ts
import type { EnemyKind, Goal, XY } from './types'

export interface FloorEnemySpawn { kind: EnemyKind; at: XY }

export interface FloorDef {
  floor: number
  enemies: FloorEnemySpawn[]
  /** 層の目標。すべて満たすと層クリア（残敵がいてもクリアする）。空配列は禁止 */
  goals: Goal[]
  /** 8行×8列。記法は LevelDef.layout と同一（'.'通常 '#'欠け 'g/G'蔦苔 'k/K'苔石 'h'匣 's'巣灯） */
  layout: string[]
}
```
**`EnvFlag` と `env` フィールドは型ごと削除**（PLAN §3-8「菌糸層/結晶洞のランダム増殖は一旦外す」）。

### 5.2 ヘルパとレイアウト定数

```ts
const FLAT: string[] = Array(8).fill('........')
const wipeGoal = (es: FloorEnemySpawn[]): Goal => ({ type: 'enemy-kill', count: es.length })
const plantGoal = (n: number): Goal => ({ type: 'system', system: 'plant', count: n })

// 層3：蔦苔の単独導入（要求6／設置10）。角・辺・中央へ分散させ「敵の隣より目標マス」を選ばせる
const L_MOSS_A: string[] = ['g......g', '........', '..g..g..', '........', '..g...g.', '........', '........', 'g.g..g.g']
// 層8：蔦苔の再試験（要求8／設置12）。2層(G)を混ぜて「同じマスを2回叩く」計画を要求する
const L_MOSS_B: string[] = ['gg....gg', '........', '...GG...', '........', '........', '..G..G..', '........', 'gg....gg']
// 層6：匣の単独導入（要求3／設置8）。二段手順（匣を割る→陶片を回収）を余裕をもって学ばせる
const L_HAKO_A: string[] = ['........', '........', '..h..h..', '........', '.h....h.', '...hh...', '........', '..h..h..']
// 層9：匣＋植物の複合（要求5／設置8）
const L_HAKO_B: string[] = ['........', '.h....h.', '..h..h..', '........', '........', '..h..h..', '.h....h.', '........']
```
**制約（必ず守る）**
1. 敵の初期セル（`SWARM_SPOTS` の使用ぶん、クセ敵 `(4,4)`/`(5,4)`、ボスの行7全列）に `g/G/h/k/K/s` を置かない。
2. 蔦苔を敵セルの下に置かない（敵セルには駒が入らず、永久に剥がせなくなる）。
3. 目標数より多めに素材を置く（上表の「要求／設置」を守る）。

### 5.3 `FLOORS`

`wipeGoal` に同じ配列を2度書かないよう、敵編成を定数に括り出す（例 `const F2 = swarm(4)` → `{ enemies: F2, goals: [wipeGoal(F2)], ... }`）。

| 層 | enemies | goals | layout |
|---:|---|---|---|
| 1 | `[]` | `[plantGoal(20)]` | `FLAT` |
| 2 | `swarm(4)` | `[wipeGoal(F2)]` | `FLAT` |
| 3 | `swarm(2)` | `[{type:'tsutagoke',count:6}]` | `L_MOSS_A` |
| 4 | `swarm(3)` | `[plantGoal(26)]` | `FLAT` |
| 5 | `[{kind:'burrower',at:{x:4,y:4}}]` | `[wipeGoal(F5)]` | `FLAT` |
| 6 | `[{kind:'burrower',at:{x:4,y:4}}]` | `[{type:'touhen',count:3}]` | `L_HAKO_A` |
| 7 | `[{kind:'rockshell',at:{x:4,y:4}}]` | `[wipeGoal(F7)]` | `FLAT` |
| 8 | `[...swarm(2), {kind:'sporeling',at:{x:4,y:4}}]` | `[{type:'tsutagoke',count:8}]` | `L_MOSS_B` |
| 9 | `[{kind:'sporeling',at:{x:4,y:4}}, {kind:'breathstealer',at:{x:5,y:4}}]` | `[{type:'touhen',count:5}, plantGoal(20)]` | `L_HAKO_B` |
| 10 | `[{kind:'boss',at:{x:0,y:7}}]` | `[wipeGoal(F10)]` | `FLAT` |

- `SWARM_SPOTS_UPPER`（36行）は**削除**（層10に swarm を置かないため不要）。
- `swarm(n)` ヘルパは維持。

### 5.4 完了条件

`npx tsc --noEmit` で `floors.ts` にエラーが無いこと。健全性テスト（§9.4 の `floors.test.ts`）は P3 で書く。

---

## 6. 工程P5：BoardView.ts

**編集ファイル**：`src/view/BoardView.ts`

### 6.1 import と型の掃除

- **9行・24-26行**の防御的キャスト（`import * as EnemiesCore` ／ ローカル `type EnemyIntent` ／ `enemyIntentFn`）を**すべて削除**し、
  `import { enemyIntent, turnsUntilAction, BOSS_SHELL_COUNT, type EnemyIntent, type EnemyInstance, type IntentKind } from '../core/enemies'` に置き換える。
  以降 `enemyIntentFn?.(en)` はすべて `enemyIntent(en)` に置換（455行・1230行）。
  **理由**：キャストのままだと戻り値の型を変えても型エラーが出ず、バッジが黙って壊れる。
- **12行**に `easeInQuad, easeOutBackSoft` を追加。
- **13行の下**に `import { buzz, resetMoveBudget } from '../juice/haptics'`。
- **6行**の型 import に `Goal, GoalType` を追加、**4行**の pixi import に `Point` を追加。

### 6.2 juice：タイムテーブル・落下・消滅・スワップ

1. **38-45行 `T`**：`swap: 130` → `150`、`swapBack: 120` を追加。`pop`/`fall`/`chainBeat`/`specialBorn` は変更禁止。
2. **1541行**（成立スワップ）：`tween(sp.position, {...}, T.swap, { delay: t })` → `{ delay: t, ease: easeOutBackSoft }`。
3. **1547-1555行**（不成立スワップ）：`T.swap` を `T.swapBack` に置換（dur/delay 計4か所）、1555行 `t += T.swap * 2` → `t += T.swapBack * 2`。イージングは触らない。
4. **1685-1704行 `case 'fall'`** を差し替え：
   ```ts
   case 'fall': {
     const sp = this.sprites.get(this.key(e.from.x, e.from.y))
     if (sp) {
       this.sprites.delete(this.key(e.from.x, e.from.y))
       this.sprites.set(this.key(e.to.x, e.to.y), sp)
       const dist = Math.abs(e.to.y - e.from.y)
       const b = this.bs(sp)
       const fallDur = Math.min(340, 150 * Math.sqrt(dist)) // 自由落下 t∝√h（1マス150ms基準）
       const colStagger = ((e.to.x * 5) % 4) * 9            // 列ごとの決定的スタッガー＝板ではなく崩れに見せる
       const landY = this.px(e.to.y)
       tween(sp.position, { x: this.px(e.to.x), y: landY }, fallDur, {
         delay: t + T.pop + colStagger,
         ease: easeInQuad,
         onDone: () => {
           tween(sp.scale, { x: b * 1.14, y: b * 0.86 }, 52, {
             onDone: () => tween(sp.scale, { x: b, y: b }, 110, { ease: easeOutBackSoft }),
           })
           tween(sp.position, { y: landY + this.S * 0.052 }, 52, {
             onDone: () => tween(sp.position, { y: landY }, 110, { ease: easeOutBackSoft }),
           })
         },
       })
     }
     break
   }
   ```
5. **1710行 `case 'refill'`** の tween を
   `tween(sp.position, { y: this.px(e.at.y) }, Math.min(340, 150 * Math.sqrt(e.at.y + 1)), { delay: t + T.pop + e.at.y * 14, ease: easeInQuad })` に。着地バウンスは付けない。
6. **2093-2096行 `popPieceAt` の中身**を差し替え（合計178ms ≤ `T.pop`）：
   ```ts
   const b = this.bs(sp)
   tween(sp.scale, { x: b * 1.28, y: b * 1.28 }, 62, { delay: t, ease: easeOutBackSoft })
   tween(sp.scale, { x: 0, y: 0 }, 88, { delay: t + 90, ease: easeInCubic })
   tween(sp, { alpha: byFire ? 0.35 : 0 }, 84, { delay: t + 90, onDone: () => sp.destroy() })
   this.sparkFx(p, t + 88, sparkSkipChance) // 火花は「弾けた瞬間」に出す
   ```
7. **1949行**：`delay(total + 80, () => this.reconcile())` → `delay(total + 200, () => this.reconcile())`。`total`（1937行）自体は変えない。

### 6.3 敵：新イベントへの差し替え

- **1512-1532行の `raw.t === 'enemy-attack'` ブロックを丸ごと削除**し、switch 内に `case 'oxygen-drained'` を新設（`case 'cell-sealed'` の手前に置く）：
  ```ts
  case 'oxygen-drained': {
    this.flashIntentBadge(e.id, t)
    this.enemyAttackTelegraphFx(e.id, t)
    if (disruptLabelCount < 2) {
      disruptLabelCount++
      const cells = this.enemyCellsCache.get(e.id)
      if (cells?.length) {
        const cx = Math.round(cells.reduce((a, p) => a + p.x, 0) / cells.length)
        const cy = Math.round(cells.reduce((a, p) => a + p.y, 0) / cells.length)
        this.floatLabelFx({ x: cx, y: cy }, `さんそをうばわれた！ -${e.amount}`, 0xff6b5a, t + 100, -0.25)
      }
    }
    delay(t, () => this.onOxygenDrained?.(e.id, e.amount))
    t += 260
    break
  }
  ```
- **132行のコールバック**を `onOxygenDrained?: (enemyId: number, amount: number) => void` にリネーム。
- **`case 'spore-poisoned'`(1844-1854) / `case 'poison-triggered'`(1855-1864) / `case 'boss-retreat'`(1893-1912) / `case 'boss-slam'`(1913-1918) / `case 'env-grow'`(1919-1930) を削除**し、次を追加：
  ```ts
  case 'prey-marked': {
    this.flashIntentBadge(e.id, t)
    this.makePreyOverlay(e.at.x, e.at.y, t + 120)
    this.causeLineFx(e.id, e.at, 0xb98be0, t + 100)
    if (disruptLabelCount < 2) { disruptLabelCount++; this.floatLabelFx(e.at, 'ねらわれた！', 0xb98be0, t + 160) }
    t += 320
    break
  }
  case 'prey-devoured': {
    this.clearPreyOverlay(e.at)
    this.violetBurstFx(e.at, t)
    this.popPieceAt(e.at, t)
    t += 200
    break
  }
  case 'prey-escaped': {
    this.clearPreyOverlay(e.at)
    this.floatLabelFx(e.at, 'おいはらった！', 0xf2c96a, t + 60)
    break
  }
  case 'fissure-telegraph': {
    this.flashIntentBadge(e.id, t)
    this.makeFissureFrame(e.id, e.cells, t)
    if (disruptLabelCount < 2) { disruptLabelCount++; this.floatLabelFx(e.cells[0], 'ほうらくよこく', 0xcbb28a, t + 160) }
    t += 240
    break
  }
  case 'fissure-averted': {
    this.clearFissureFrame(e.id)
    break
  }
  case 'boss-shell-broken': {
    this.shakeContainer(this.root, t)
    this.paintBossGauge()
    t += 160
    break
  }
  case 'boss-phase': {
    // 身体1行ぶんのコンテナと顔をまとめて畳み、reconcile で残り2セルを描き直す
    const row = this.bossRowG.get(H - 1)
    if (row && !row.destroyed) tween(row, { alpha: 0 }, 220, { delay: t })
    this.shakeRootDecay(t + 60, 6, 220)
    delay(t + 240, () => this.reconcile())
    t += 300
    break
  }
  ```
- **`case 'floor-clear' / 'run-over'`（1931-1934行）**に `case 'oxygen-spent':` `case 'oxygen-refill':` を並べて `break`（HUD＝main.ts の管轄であることを明示）。
- `makePoisonOverlay`(593行) を **`makePreyOverlay`** にリネーム、`poisonG` を **`preyG`** にリネーム（102行 / 281行 / reconcile 2027-2035行）。
  - **281行**：`if (c.poisonSpore)` → `if (c.preyMark)`。
  - **2027行**：`const wantPrey = c?.preyMark === true` に。
  - `clearPreyOverlay(at)` を新設（`preyG` から取り出して destroy するだけの3行）。
- `makeFissureFrame(id, cells, t)` / `clearFissureFrame(id)` を新設。`fissureG = new Map<number, Graphics>()` を帳簿に追加。
  枠は `underFxLayer` に 2x2 の破線矩形（`0xcbb28a`、太さ `S*0.05`）＋ `alpha 0.35↔0.8` の1.2秒ループ。`clearFissureFrame` は destroy して map から消す。
  `reconcile()` の末尾で `board.enemies` の `telegraph` と付き合わせて過不足を直す（他のオーバーレイと同じ流儀）。

### 6.4 敵の見た目（新種と2段階ボス）

- **468行の `else`（穴潜みの描画）を `else if (enemy.kind === 'burrower')` に変え**、最後に `breathstealer` の専用分岐を足す（未知の kind が既存敵に化けるのを防ぐ）：
  ```ts
  } else if (enemy.kind === 'breathstealer') {
    // 息喰み：吸い込む口＝三重の同心リング（危険色）＋細い一つ目。唯一「酸素を奪う」敵として色相を分ける
    const g = new Graphics()
    g.circle(S / 2, S / 2, S * 0.42).fill({ color: 0x2a1216, alpha: 0.95 })
    g.circle(S / 2, S / 2, S * 0.3).stroke({ width: S * 0.05, color: 0xe0503a, alpha: 0.9 })
    g.circle(S / 2, S / 2, S * 0.16).fill({ color: 0x120a0c, alpha: 0.95 })
    wrap.addChild(g)
    const eye = new Graphics()
    this.drawEye(eye, S / 2, S * 0.34, S * 0.1, 0xffd6b0)
    wrap.addChild(eye)
  }
  ```
- **455行**：swarm の「怒り顔」差分は `intent.kind === 'none'` で常に false になる。`const soon = false` にはせず、**`e_swarm` 固定**に単純化する（`e_swarm_angry` は未使用資産として残す。削除しない）。
- **481行**：`if (enemy.maxHp > 1)` はそのまま（swarm が HP2 になりバーが出る＝「2回いる」ことが読める。意図した変更）。
- **526行**：`if (y === enemy.bossFrontRow && ...)` → `if (y === H - 1 && ...)`。
- **541行**：`face.position.set(0, boss.bossFrontRow * S)` → `face.position.set(0, (H - 1) * S)`。
- **2075行**：`face.position.set(0, boss.bossFrontRow * this.S)` → `face.position.set(0, (H - 1) * this.S)`。
- **ボスのゲージ**：`makeBossFace`(546行) と `reconcile`(2076行) の `attachHpBar` / `paintHpBar` に渡す値を段階で切り替える。
  ```ts
  const cur = boss.bossPhase === 1 ? boss.bossShellLeft : boss.hp
  const max = boss.bossPhase === 1 ? BOSS_SHELL_COUNT : boss.maxHp
  ```
  `paintBossGauge()` はこの2行＋`paintHpBar(face, cur, max)` だけの小さな private メソッドにして、`case 'boss-shell-broken'` からも呼ぶ。
- **1202-1204行 `paintIntentBadge`**：`cellY = en.bossFrontRow` → ボスは `const c = en.cells[en.cells.length - 1]`（身体の右端セル）を使い、通常敵と同じ経路に統合する。
- **1229-1252行**：`const isAttack = intent?.kind === 'attack'` → **`const danger = intent.kind === 'drain'`**。危険色・太枠・大サイズの分岐条件をこれに置換。数字は `danger ? String(intent.oxygen) : String(intent.turns)`。
  `intent.kind === 'none'` のときは**バッジ自体を出さない**（`this.intentG` から破棄して return）。
- **1133行 `drawIntentIcon(g, kind: EnemyKind, r)`** → `drawIntentIcon(g, kind: IntentKind, r)`。既存の描き分けを `armor`=盾 / `devour`=雫 / `fissure`=X / `drain`=衝撃波 に割り当て直す（`drawSwordIcon` は `drain` 用に流用してよい）。

### 6.5 目標収集の発火（`case 'goal-progress'`）

- **128-137行のコールバック群**に追加：
  ```ts
  /**
   * 目標達成物の収集（JUICE.md §1②）。BoardView は「どの目標が1つ進んだか」と盤面上の起点（グローバル座標）
   * だけを渡し、HUDへの飛翔・カウンタの跳ねは main.ts が担う（onUpgradeFire / onOxygenDrained と同じ流儀）。
   * flightIndex＝この play() 内で何本目か（0始まり）。main.ts はSEのピッチ段に使う。
   */
  onGoalCollect?: (index: number, done: number, fromGlobal: { x: number; y: number }, flightIndex: number) => void
  ```
- モジュール先頭（35行 `SPECIAL_BORN_STYLE` の下）に：
  ```ts
  // 目標の種類ごとに「壊れて見える瞬間」までのオフセット(ms)と破片色
  const GOAL_FX_DELAY: Record<GoalType, number> = { color: 90, system: 90, tsutagoke: 120, kokeishi: 120, touhen: 120, spore: 220, 'enemy-kill': 0 }
  const GOAL_DEBRIS_COLOR: Record<GoalType, number> = {
    color: 0xf0e2bd, system: 0x8fb05a, tsutagoke: 0x8fb05a, kokeishi: PAL.stone, touhen: 0xe8e2d2, spore: 0xbfe8ff, 'enemy-kill': 0xe0a89c,
  }
  const GOAL_PT = new Point()
  ```
  （`Record<GoalType, ...>` は網羅必須。`GoalType` を増やしたら両テーブルに行を足すこと）
- `play()` 冒頭のローカル宣言（1504行 `let disruptLabelCount = 0` の隣）に `let goalFxCount = 0`。
- **switch の `case 'block-hit'` の break（1669行）の直後**に挿入（挿入位置はここで固定。他の case は末尾側に足す）：
  ```ts
  case 'goal-progress': {
    const n = goalFxCount++
    const fxT = t + GOAL_FX_DELAY[e.goal.type]
    if (n < 4) this.debrisFx(e.at, fxT, GOAL_DEBRIS_COLOR[e.goal.type]) // 既存の粒子プール経由
    if (n < 6) {
      const stagger = Math.min(55, 300 / Math.max(1, Math.min(5, n))) * n
      const ep = this.epoch
      delay(fxT + stagger, () => {
        if (ep !== this.epoch) return
        const gp = this.pieceLayer.toGlobal({ x: this.px(e.at.x), y: this.px(e.at.y) }, GOAL_PT)
        this.onGoalCollect?.(e.index, e.done, { x: gp.x, y: gp.y }, n)
      })
    }
    // t は進めない：目標進捗は match/block-hit の副産物であり、ここでビートを消費すると連鎖テンポが壊れる
    break
  }
  ```

### 6.6 振動の呼び出し

**必ず `delay(t, () => buzz(...))` で包む**（`play()` は未来を予約する関数。素で呼ぶと全部が最初の1フレームで鳴る）。

| 場所 | 追加 |
|---|---|
| `play()` 冒頭（1499行の直後） | `resetMoveBudget()` |
| `case 'match'`（1571行 `sfx.pop(...)` の直後、**連鎖段が上がった分岐の中**） | `delay(t, () => buzz(e.chain >= 5 ? 'chain' : 'pop'))` |
| `case 'special-born'`（1629行の白コア `delay(born0 + 70, ...)` の中） | `buzz('born')` |
| `case 'explode'`（1767行 `this.explodeFx(...)` の直後） | `delay(t, () => buzz('blast'))` |
| `case 'combo'`（1607行 `this.flashFx(...)` の直後） | `delay(t, () => buzz('blast'))` |
| `case 'special-fire'` の `hitsubo` 分岐（1585行の直前） | `delay(t, () => buzz('blast'))` |

**`popPieceAt` の中では絶対に鳴らさない**（1マッチ＝最大1回）。`swap`/`fall`/`refill` では鳴らさない。

### 6.7 完了条件

- `npm run build` が通る（P1・P6完了後）。
- `grep -n "enemyIntentFn\|bossFrontRow\|poisonG\|enemy-attack\|boss-slam\|env-grow" src/view/BoardView.ts` が0件。
- 検証は §10。

---

## 7. 工程P6：main.ts（HUD・遭遇帯・野帳）＋ glossary.ts

### 7.1 import

- **25行**：`import { enemyIntent, ENEMY_ATTACK_DAMAGE, SWARM_ATTACK_PERIOD, type EnemyInstance } from './core/enemies'`
  → `import { enemyIntent, ENEMY_PERIOD, OXYGEN_DRAIN, type EnemyInstance } from './core/enemies'`
- **6行**：`import { createRunState, OXYGEN_GAUGE_FULL, OXYGEN_LOW, OXYGEN_CRITICAL, OXYGEN_SUPPLY_PER_FLOOR, type RunState } from './core/run'`
- **26行**の型 import に `Goal, GoalType` を追加。`import { systemOf } from './core/hooks'` と `import type { FloorDef } from './core/floors'` を追加。
- **3行**の pixi import に `Point` を追加。
- **29行の下**：`import { hapticsEnabled, hapticsSupported, toggleHaptics } from './juice/haptics'`

### 7.2 `buildFloorLevelDef`（66-77行）

```ts
/** 層1つぶんの盤面定義。目標とレイアウトは FloorDef（core/floors.ts）が持つ正典を使う */
const buildFloorLevelDef = (floor: number, seed: number, def: FloorDef): LevelDef => ({
  id: floor,
  seed,
  moves: 9999, // 旧30レベル制の手数。ローグでは酸素が時計なので発火しない番人として残す
  colors: 5,
  goals: def.goals,
  layout: def.layout,
})
```
**1231行**：`board = new Board(buildFloorLevelDef(floor, floorSeed, floorDef), run, floorDef)`

### 7.3 敵情報（`ENEMY_INFO` 501-533行）と野帳（587-600行）

```ts
interface EnemyInfoEntry { name: string; oxygenDesc: string | null; disruptDesc: string | null; defeatDesc: string }
const ENEMY_INFO: Record<EnemyKind, EnemyInfoEntry> = {
  swarm: { name: '小型胞子虫', oxygenDesc: null, disruptDesc: null,
    defeatDesc: '3つそろえでは1しか効かない。4つ以上・特殊駒・爆発で倒すと、隣の仲間へダメージが伝わる' },
  rockshell: { name: '岩殻獣', oxygenDesc: null, disruptDesc: '鉱物ひとつに甲殻をまとわせる（甲殻はもう1回壊さないと消えない）',
    defeatDesc: '隣で駒を消すとダメージ。3つそろえでは1しか入らないので、大きく消すほど早い' },
  sporeling: { name: '喰み蟲', oxygenDesc: null, disruptDesc: '盤上の駒ひとつに捕食印をつけ、2手後に食べてHPを回復する',
    defeatDesc: '印のついた駒そのものを消すと追い払える（1ダメージ＋予告がやり直しになる）' },
  burrower: { name: '裂坑掘り', oxygenDesc: null, disruptDesc: '自分から遠い2×2を亀裂として予告し、2手後にそのマスを3手ふさぐ',
    defeatDesc: '予告された2×2の中で駒を1つでも消せば崩落は止まる' },
  breathstealer: { name: '息喰み', oxygenDesc: `3手ごとに酸素を${OXYGEN_DRAIN.breathstealer}奪う`, disruptDesc: null,
    defeatDesc: '深界で唯一、酸素を直接奪う相手。長居するほど損をする' },
  boss: { name: '深匣主', oxygenDesc: `3手ごとに酸素を${OXYGEN_DRAIN.boss}奪う`, disruptDesc: null,
    defeatDesc: 'まず封印匣を4枚剥がす（どんな一撃でも1枚）。核が露出したら本体のHPを削る' },
}
```
- `ENEMY_ICON_TEX`（449行）に `burrower: 'e_swarm'` は足さず、**`breathstealer` も未定義のまま**（フォールバックの円が出る）。
- `buildEnemyEntry`（587-600行）：
  - `nextText` は `intent.kind === 'none' ? '動かない' : \`あと${intent.turns}手：${intent.label}\``
  - 「与ダメージ」行は `info.oxygenDesc` があるときだけ出す（無い敵は行ごと出さない）。
  - `retreatDesc` の行（598行）を削除。

### 7.4 遭遇帯（`computeEncounterInfo` 611-636行 と `refreshEncounter` 1584-1606行）

```ts
function computeEncounterInfo(board: Board): {
  aliveCount: number
  boss: EnemyInstance | null
  /** 次の1手で失う酸素（予告オーバーレイ用） */
  pendingOxygen: number
  minTurns: number | null
  /** 最短で来るインテントの短い日本語（'甲殻' '崩落' '捕食' '酸素-3'） */
  nextLabel: string | null
  /** 最短で来るインテントで失う酸素の合計（0＝妨害だけ） */
  nextOxygenLoss: number
} {
  const alive = board.enemies.filter((e) => e.hp > 0)
  const boss = alive.find((e) => e.kind === 'boss') ?? null
  let pendingOxygen = 0
  let minTurns: number | null = null
  for (const e of alive) {
    const it = enemyIntent(e)
    if (it.kind === 'none') continue
    if (it.turns === 1) pendingOxygen += it.oxygen ?? 0
    if (minTurns === null || it.turns < minTurns) minTurns = it.turns
  }
  let nextLabel: string | null = null
  let nextOxygenLoss = 0
  if (minTurns !== null)
    for (const e of alive) {
      const it = enemyIntent(e)
      if (it.kind === 'none' || it.turns !== minTurns) continue
      nextOxygenLoss += it.oxygen ?? 0
      if (!nextLabel || it.kind === 'drain') nextLabel = it.label // 危険な予告を優先して表示する
    }
  return { aliveCount: alive.length, boss, pendingOxygen, minTurns, nextLabel, nextOxygenLoss }
}
```
`refreshEncounter`：
- ボス表示（1588行）は `${BOSS_NAME}\n匣 ${boss.bossShellLeft}/4`（第1段階）／`${BOSS_NAME}\nHP ${boss.hp}/${boss.maxHp}`（第2段階）。
- **1592-1603行**：
  ```ts
      const lethal = run.oxygen > 0 && info.nextOxygenLoss > 0 && run.oxygen - info.nextOxygenLoss <= 0
      if (lethal) {
        actionChip.text.text = `あと${info.minTurns ?? 1}手：遭難`
        actionChip.text.style.fill = 0xff8a70
      } else if (info.minTurns !== null) {
        actionChip.text.text = `あと${info.minTurns}手：${info.nextLabel ?? '妨害'}`
        actionChip.text.style.fill = info.nextOxygenLoss > 0 ? 0xff8a70 : UI.badgeText
      } else {
        actionChip.text.text = '静観中'
        actionChip.text.style.fill = UI.badgeText
      }
      bustGlow.visible = info.pendingOxygen > 0
      return info.pendingOxygen
  ```
  **妨害しかしない敵でもチップが必ず語る**（これを外すと10層中8層が「静観中」になる）。

### 7.5 酸素ゲージ（1414-1494行）

- **943行 `let runMaxHp = 20`** と **1216行 `runMaxHp = runState.playerHp`** を削除（`OXYGEN_GAUGE_FULL` を使う）。
- `hpNumText` → `oxyNumText`、`drawGauge(hp, maxHp, pendingDamage)` → `drawGauge(oxygen, full, pendingDrain)`（同一クロージャ内の機械的リネーム）。
- **1424-1425行**：`const ratio = Math.max(0, Math.min(1, oxygen / full))` ／ `const low = oxygen > 0 && oxygen <= OXYGEN_LOW`。
- **1432行の低HP特例（`lowHp ? chW/5 : ratio*chW`）を削除**し、常に `ratio * chW`。視認下限だけ確保：`if (oxygen > 0) fillW = Math.max(fillW, chH * 0.35)`。
- **1436行**：`const pendW = Math.min(fillW, (Math.min(oxygen, pendingDrain) / full) * chW)`。
- **1449行**：`oxyNumText.text = String(Math.max(0, oxygen))`（`/ 40` は貯金で嘘になるので**分母を出さない**）。
- **1450-1458行**：`lowHp` → `low` に置換（炎ゆらぎのロジックは無改造）。数字色は `low ? 0xff8a70 : 0xf4e8cf`。
- **1462行 `hpHitFx` → `oxygenDrainFx`** にリネーム（中身は無改造で流用）。
- 新設（`oxygenDrainFx` の直後）：
  ```ts
  /** 層クリアの補給：ゲージが左→右へ琥珀色に満ち、数字わきに「+7」が浮く */
  const oxygenRefillFx = (amount: number) => {
    const t = new Text({ text: `+${amount}`, style: { fill: 0xf2c96a, fontSize: gaugeH * 0.42, fontFamily: FONT, fontWeight: 'bold', stroke: { color: 0x2a1c10, width: 3 } } })
    t.anchor.set(0.5)
    t.position.set(gaugeBaseX + oxyNumText.position.x - oxyNumText.width * 0.5, gaugeRoot.position.y - gaugeH * 0.3)
    ui.addChild(t)
    tw.tween(t.position, { y: t.position.y - fs(0.05) }, 520, { ease: tw.easeOutCubic })
    tw.tween(t, { alpha: 0 }, 380, { delay: 200, onDone: () => { if (!t.destroyed) t.destroy() } })
    tw.delay(60, () => { if (alive()) refreshFloorHud() }) // 実値へ確定
  }
  ```
- `refreshFloorHud`（1608-1611行）に補給前の値を描くためのオーバーライドを1つ足す：
  ```ts
  const refreshFloorHud = (oxygenOverride?: number) => {
    const pendingDrain = refreshEncounter()
    drawGauge(Math.max(0, oxygenOverride ?? run.oxygen), OXYGEN_GAUGE_FULL, pendingDrain)
  }
  ```
- 1手ごとの脈動（`handleFloorResult` 内）：
  ```ts
  if (evs.some((e) => e.t === 'oxygen-spent')) {
    const big = run.oxygen <= OXYGEN_CRITICAL
    tw.tween(oxyNumText.scale, { x: big ? 1.25 : 1.12, y: big ? 1.25 : 1.12 }, big ? 130 : 100, {
      onDone: () => { if (!oxyNumText.destroyed) tw.tween(oxyNumText.scale, { x: 1, y: 1 }, big ? 130 : 100) },
    })
  }
  ```
  **音・揺れ・赤フラッシュは出さない**（毎手鳴らすとメリハリが死ぬ。JUICE §0-2）。

### 7.6 目標バー（新規）

- 定数（**1268行 `dockTop` の直後**。bust の生成より前である必要がある）：
  ```ts
  const goalBarH = vh * 0.05
  const goalBarY = boardTop - goalBarH - vh * 0.014
  ```
- 探窟家バスト（**1322-1327行**）の高さを1行ぶん詰める：`boardTop` を `goalBarY` に置換（3か所：`bustH` の計算 / `bust.position` / `bustGlow.circle`）。
- チップ本体（`buildFloorScene` 内、1328行と1330行の間）。**公開する形は `{ root, icon, setValue }` の3点**：
  ```ts
  interface GoalChip { root: Container; icon: Container; setValue: (v: number) => void }
  const goalChips: GoalChip[] = []
  const GOAL_LABEL: Partial<Record<GoalType, string>> = {
    system: '植物標本', tsutagoke: '蔦苔の浄化', touhen: '陶片の回収', 'enemy-kill': '掃討', kokeishi: '苔石', color: '採集', spore: '胞子の搬送',
  }
  /** 目標アイコン（新規素材は作らない）。植物標本は葉(n1)とキノコ(n4)を半分ずつ重ねて「どちらも進む」を示す */
  const makeGoalIcon = (g: Goal, size: number): Container => {
    const c = new Container()
    const add = (key: string, dx: number) => {
      const tex = spriteTexture(key)
      if (!tex) return
      const sp = new Sprite(tex)
      sp.anchor.set(0.5)
      sp.scale.set(size / Math.max(tex.width, tex.height))
      sp.position.set(dx, 0)
      c.addChild(sp)
    }
    if (g.type === 'system' && g.system === 'plant') { add('n1', -size * 0.16); add('n4', size * 0.16) }
    else if (g.type === 'system') add(CATEGORY_ICON[g.system!] ?? 'n1', 0)
    else if (g.type === 'color') add(CATEGORY_ICON[systemOf(g.color ?? 0)] ?? 'n1', 0)
    else if (g.type === 'tsutagoke') add('moss_icon', 0)
    else if (g.type === 'touhen') add('touhen', 0)
    else if (g.type === 'kokeishi') add('kokeishi', 0)
    else if (g.type === 'enemy-kill') add('e_swarm', 0)
    else add('spore', 0)
    if (!c.children.length) { const gg = new Graphics(); gg.circle(0, 0, size * 0.4).fill(UI.brass); c.addChild(gg) }
    return c
  }
  ```
  レイアウト：チップ幅 `min(vw*0.44, (vw*0.9 - gap*(n-1))/n)`、`gap = vw*0.03`、中央寄せ。
  背景は `roundRect(0,0,chipW,goalBarH,goalBarH*0.3).fill({color:0x241a10,alpha:0.92}).stroke({width:2,color:UI.brass})`。
  左に `icon`（中心 `x = goalBarH*0.62`、径 `goalBarH*0.74`）、その右にラベル（`fontSize = goalBarH*0.3`、色 `0xcbb98a`）、右端に数字 `0 / N`（`anchor(1,0.5)`、`fontSize = goalBarH*0.42`）。
  チップの `root` は `ui` の子（`ui` は position 未設定＝ローカル座標＝グローバル座標。ドラフト中は `ui.visible=false` で自動的に隠れる）。
  `setValue(v)` は数字テキストだけを書き換え、`v >= g.count` なら数字色を `0xf2c14e` にする（**跳ねは §7.7 が行う**）。

### 7.7 収集の飛翔（`goalCollectFly`）

`view.onEnemyAttack` の配線ブロック（**1844行**）の直後に置く。

```ts
const FLY_ORIGIN = new Point(0, 0)
const goalShown = board.goals.map(() => 0) // HUDに出ている値。board.goalDone とは別に持つ
let flightsInAir = 0
const goalCollectFly = (index: number, done: number, fromGlobal: { x: number; y: number }, flightIndex: number) => {
  const chip = goalChips[index]
  if (!chip || chip.icon.destroyed || !alive()) return
  if (flightsInAir >= 12) { goalShown[index] = done; chip.setValue(done); return }
  // 座標系：BoardView は view.root の子、チップは ui の子。どちらも playRoot の子孫なので global 経由で落とす
  const from = playRoot.toLocal(fromGlobal as Point)
  const to = playRoot.toLocal(chip.icon.toGlobal(FLY_ORIGIN))
  const icon = makeGoalIcon(board.goals[index], view.S * 0.62)
  icon.position.set(from.x, from.y)
  icon.scale.set(0.4)
  icon.alpha = 0
  playRoot.addChild(icon)
  flightsInAir++
  // A（0-90ms）ためて弾ける
  const kickA = -Math.PI / 2 + (flightIndex % 2 ? 0.55 : -0.55)
  const kickD = view.S * 0.22
  tw.tween(icon, { alpha: 1 }, 60, { channel: 'fx' })
  tw.tween(icon.scale, { x: 1.15, y: 1.15 }, 90, { ease: tw.easeOutBackSoft, channel: 'fx' })
  tw.tween(icon.position, { x: from.x + Math.cos(kickA) * kickD, y: from.y + Math.sin(kickA) * kickD }, 90, { ease: tw.easeOutCubic, channel: 'fx' })
  // B（90ms〜）弧を描いて吸われる。x と y に別のイージングを与えると経路が曲がる（ベジェ評価器は足さない）
  const D = Math.min(450, 320 + flightIndex * 14)
  tw.tween(icon.position, { y: to.y }, D, { delay: 90, ease: tw.easeOutCubic, channel: 'fx' })
  tw.tween(icon.scale, { x: 0.55, y: 0.55 }, D, { delay: 90, ease: tw.easeInQuad, channel: 'fx' })
  tw.tween(icon.position, { x: to.x }, D, {
    delay: 90, ease: tw.easeInQuad, channel: 'fx',
    onDone: () => {
      flightsInAir--
      if (!icon.destroyed) icon.destroy()
      if (!alive() || chip.icon.destroyed) return
      goalShown[index] = Math.max(goalShown[index], done)
      chip.setValue(goalShown[index])
      tw.tween(chip.icon.scale, { x: 1.3, y: 1.3 }, 90, {
        onDone: () => { if (!chip.icon.destroyed) tw.tween(chip.icon.scale, { x: 1, y: 1 }, 150, { ease: tw.easeOutBack }) },
      })
      sfx.drain(flightIndex) // 既存SE流用（semitone(980, i%12) の上昇ピング）。新規音は作らない
    },
  })
}
view.onGoalCollect = goalCollectFly
```
**`channel: 'fx'` は必須**。既定チャンネル（`'board'`）だと次の一手で `completeChannel('board')` に叩かれ、飛翔中のアイコンが瞬間移動してカウンタに突き刺さる。

数字ずれの保険（飛翔ロスト・シーン破棄・上限超過）：
```ts
const syncGoalDisplay = () => {
  board.goalDone.forEach((v, i) => {
    if (goalShown[i] === v) return
    goalShown[i] = v
    goalChips[i]?.setValue(v) // 落ちた飛翔ぶんを黙って追いつかせる（跳ねさせない＝二重演出にしない）
  })
}
```
層開始時に1回呼んで初期化する。

### 7.8 `handleFloorResult`（1911-1939行）

- **1912行 `const dur = view.play(evs)` の直後**に1行（スナップの遅延。挿入位置はここで固定）：
  ```ts
  tw.delay(Math.min(dur + 500, 2200), () => { if (alive()) syncGoalDisplay() })
  ```
- **1913行**を補給対応に：
  ```ts
  const refill = evs.find((e) => e.t === 'oxygen-refill')
  // 補給ぶんは層クリアバナーで見せるので、この時点では補給前の値でゲージを描く
  refreshFloorHud(refill && refill.t === 'oxygen-refill' ? refill.left - refill.amount : undefined)
  ```
- **1919-1925行のループ**を差し替え：
  ```ts
  for (const e of evs) if (e.t === 'oxygen-drained') oxygenDrainFx(e.amount)
  ```
  （`poison-triggered` / `boss-slam` の分岐は削除）
- **1844-1861行** `view.onEnemyAttack` を `view.onOxygenDrained = (enemyId, amount) => {...}` にリネーム。**1846行**の
  `const cell = en ? (en.kind === 'boss' ? { x: W - 1, y: en.bossFrontRow } : en.cells[0]) : null` を
  `const cell = en?.cells[en.cells.length - 1] ?? null` に置換（`bossFrontRow` は廃止された）。
  内側の `hpHitFx(damage)` は `oxygenDrainFx(amount)` に。
- `showFloorClearBanner()`（1950行）のリボン出現 tween の後ろに補給演出を差し込む：
  ```ts
  tw.delay(360, () => { if (alive()) oxygenRefillFx(OXYGEN_SUPPLY_PER_FLOOR) })
  ```

### 7.9 メニューに振動行（1526-1580行）

- **1539行** `const panelH = rowH * 2` → `rowH * 3`
- **1557行**（`panel.addChild(muteHit)`）の直後に、ミュート行と同型の「振動」行を挿入（`y = rowH*1.5`、ヒット領域 `rowH〜rowH*2`）。
  ラベルは `!hapticsSupported() ? '振動（この端末は非対応）' : hapticsEnabled() ? '振動：オン' : '振動：オフ'`。
  非対応端末は文字色 `0x8a7c68` にして**ヒット領域を作らない**（嘘をつかない）。
- **1559行** divider の y：`rowH` → `rowH * 2`
- **1566行** `abandonRow.position.set(panelW*0.08, rowH*1.5)` → `rowH * 2.5`
- **1569行** `abandonHit.hitArea` の `y >= rowH && y <= rowH*2` → `y >= rowH*2 && y <= rowH*3`
- 行の順序は **ミュート → 振動 → divider → ラン中断** で固定。

### 7.10 QAフック（2504-2552行）

- `forceFloorClear` を目標駆動に作り替える（敵を全滅させても殲滅以外の層では効かなくなるため）：
  ```ts
  forceFloorClear: () => {
    if (inputLocked) return
    board.goals.forEach((g, i) => { board.goalDone[i] = g.count })
    const ev: BoardEvent[] = []
    ;(board as unknown as { checkFloorClear: (ev: BoardEvent[]) => void }).checkFloorClear(ev)
    if (ev.length) handleFloorResult(ev)
  },
  setOxygen: (n: number) => { if (runState) { runState.oxygen = n; refreshFloorHud() } },
  hapticsLog,
  ```
  （`hapticsLog` は `juice/haptics` から import。振動は動画に写らないのでQAはこれを読む）

### 7.11 glossary.ts

- **削除**：`state-poison`(91行) / `battle-retreat`(105行)
- **追加**（`kind: '基本'` は既存の union にあるのでそのまま使える）：
  ```ts
  { id: 'oxygen', term: '酸素', aliases: ['のこり手数'], kind: '基本',
    body: '探窟に残された行動回数。駒を動かすたびに1へる。0になるとそこで遭難＝ランが終わる。層をクリアすると補給を受けられ、早く終えたぶんの残りはそのまま次の層へ持ちこせる。' },
  { id: 'state-prey', term: '捕食印', kind: '盤面',
    body: '喰み蟲が「次に食べる」と決めた駒の印。放っておくと食べられて相手のHPが回復する。印のついた駒そのものを消せば追い払える。' },
  { id: 'state-fissure', term: '亀裂', kind: '盤面',
    body: '裂坑掘りが予告する2×2の崩落地点。放っておくとそのマスが3手ふさがれる。中の駒を1つでも消せば崩落は止まる。' },
  { id: 'boss-shell', term: '封印匣', kind: '戦闘',
    body: '深匣主が身にまとう4枚の匣。どんな一撃でも1枚ずつしか剥がれない。4枚とも剥がすと核が露出し、そこからHPを削れるようになる。' },
  ```
- **書き換え**：
  - `intent`(95-99行) 本文 → 「敵が次に何をしてくるかを示すバッジ。形は行動の種類（甲殻・捕食・崩落・酸素）を、数字は発動までの残り手数を表す。赤いバッジは酸素を奪う相手。」
  - `battle-attack`(101行) → 「敵が探窟隊の**酸素**を直接奪う行動。奪われる量はあらかじめ予告される。深界では稀な、特に危険な相手だけが持つ。」
  - `battle-disrupt`(102行) → 「敵が酸素を直接は奪わず、盤面をやっかいにする行動。対処に手数を使わされる＝間接的に酸素が減るので、無視して目標へ急ぐ判断もある。」
  - `battle-aoe`(104行) → 「ボスが一定の手数ごとに繰り出す攻撃。通常の攻撃と同じく酸素を直接奪う。」

---

## 8. 工程P7：juice 基盤（tween.ts / haptics.ts）

### 8.1 `src/juice/tween.ts`

`easeOutBack`（11行）の直後に2本追加（他は一切触らない）：
```ts
/** 重力落下。位置 x ∝ t² の実挙動そのもの（easeInCubic は溜めが強すぎて「浮いて見える」） */
export const easeInQuad: Ease = (t) => t * t
/** 控えめオーバーシュート（約5%）。標準の easeOutBack（約10%）は駒には跳ねすぎる */
export const easeOutBackSoft: Ease = (t) => {
  const c1 = 0.9
  const c3 = c1 + 1
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}
```
`easeOutBounce`（12-19行）は現在どこからも使われていないが**削除しない**（報告のみ）。

### 8.2 `src/juice/haptics.ts`（新規・約40行）

```ts
// 触覚フィードバック（JUICE.md §1③）。Android Chrome は navigator.vibrate で効く。
// iOS Safari は Vibration API 非対応 → supported=false で全呼び出しが無害な no-op になる。
// iOS 18 の <input type="checkbox" switch> ハックは非公式で将来壊れるため採用しない（振動をゲーム成立の前提にしない）。
export type Buzz = 'pop' | 'born' | 'blast' | 'chain'
const MS: Record<Buzz, number> = { pop: 8, born: 15, blast: 25, chain: 30 }
const RANK: Record<Buzz, number> = { pop: 0, born: 1, blast: 2, chain: 2 }

const supported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
let enabled = localStorage.getItem('yacho-haptics') !== '0' // 既定オン。ミュート設定とは独立のキー
let lastAt = -1e9
let lastRank = -1
let strongAt = -1e9
let popsThisMove = 0
const log: { t: number; kind: Buzz }[] = []

/** play() 冒頭で呼ぶ。1手あたりの pop 回数上限をリセットする */
export function resetMoveBudget(): void { popsThisMove = 0 }

export function buzz(kind: Buzz): void {
  if (!enabled || !supported) return
  const now = performance.now()
  if (kind === 'pop' && ++popsThisMove > 4) return          // 1手あたり pop は最大4回
  if (RANK[kind] === 0 && now - strongAt < 120) return      // 強い振動の直後の弱い振動は捨てる
  if (RANK[kind] <= lastRank && now - lastAt < 70) return   // 同ランク以下の連続は70ms未満なら捨てる
  lastAt = now
  lastRank = RANK[kind]
  if (RANK[kind] >= 2) strongAt = now
  if (log.length >= 40) log.shift()
  log.push({ t: now, kind })
  try { navigator.vibrate(MS[kind]) } catch { /* 権限拒否・非対応は黙って無視 */ }
}

export function toggleHaptics(): boolean {
  enabled = !enabled
  localStorage.setItem('yacho-haptics', enabled ? '1' : '0')
  if (!enabled && supported) { try { navigator.vibrate(0) } catch {} }
  return enabled
}
export function hapticsEnabled(): boolean { return enabled }
export function hapticsSupported(): boolean { return supported }
/** QA専用：直近40件の発火履歴（動画には振動が写らないため） */
export function hapticsLog(): { t: number; kind: Buzz }[] { return log.slice() }
```
キーは `yacho-haptics`（`yacho-mute` には相乗りさせない。音を消したい人の振動まで殺すのは別物）。

---

## 9. 工程P3：テスト

### 9.1 現状

`npx vitest run games/yacho` → **10ファイル90件が緑**（変更前のベースライン）。

### 9.2 触らないファイル（回帰の砦）

`board.test.ts`（run無しBoard。`movesLeft` が19になるテストが「旧30レベル制を壊していない」証明になる）／`levels30.test.ts`／`rogue.test.ts`／`rogue5.test.ts`／`rogue6.test.ts`／**`rogue8.test.ts`（既存116行のフック回帰テスト。新規テストをここに書かない）**。

### 9.3 書き換え・削除（`rogue2` / `rogue3` / `rogue4` / `rogue7`）

| ファイル:行 | テスト | 処置 |
|---|---|---|
| rogue2:69 | 隣接マッチはマッチ駒数ぶんダメージ | **書換**：3個マッチは1ダメージ（`amount` 3→1、`e.hp` 8-3→**6-1=5**）。4個マッチで4ダメージになるケースを1本足す |
| rogue2:82 | 爆発3ダメージ | 数値のみ（sporeling `6-3` → **5-3=2**） |
| rogue2:98 | 効果線1ダメージ | **書換**：効果線は2ダメージ（burrower `10-1` → **6-2=4**） |
| rogue2:112/124 | 甲殻 | そのまま通る |
| rogue2:141 | 毒胞子化 | **書換**：`sporelingAction`→`harvesterAction`、`spore-poisoned`→`prey-marked`、`c.preyMark` |
| rogue2:153 | 毒胞子を消すとHP-1 | **削除**（§9.5 の「追い払い」テストへ置換） |
| rogue2:168/181 | 穴潜みの封鎖 | **書換**：`burrowerAction`→`diggerAction`。①1回目は `fissure-telegraph` だけ ②2回目で `cell-sealed`(turns=3)＋自分が移動 ③封鎖は3ターンで解除 |
| rogue2:199 | ボス後退 | **削除**（§9.5 の匣・phase2 テストへ置換） |
| rogue2:211 | ボス全体攻撃でHP-3 | **書換**：`oxygen-drained`（`amount:3`）／`run.oxygen` が `24→21` |
| rogue2:226/243 | 環境（菌糸層・結晶洞） | **削除**（機構ごと廃止） |
| rogue2:260 | 敵全滅で floor-clear | **書換**：`plain({ goals: [{type:'enemy-kill', count:2}] })` を使い、2体目の撃破で `floor-clear` と `oxygen-refill` が対で1回だけ出ることを見る |
| rogue2:275 | HP0で run-over | **書換**：`run.oxygen = 0` |
| rogue2:295 | 毒胞子フック | 数値のみ（sporeling `6-3` → **5-3=2**） |
| rogue2:309 | run無し互換 | 期待イベント集合に `'oxygen-spent'` / `'oxygen-refill'` / `'goal-progress'` を追加 |
| rogue3:56 | 妨害→攻撃の交互 | **削除**（交互ローテ廃止）→ §9.5 の intent 表テストへ |
| rogue3:72 | 胞子獣/穴潜み2ダメージ | **削除**（通常敵は酸素を奪わない） |
| rogue3:87 | ボスは常に攻撃 | **書換**：`enemyIntent(boss).kind === 'drain'` / `oxygen === 3` / `turns` が3周期 |
| rogue4:59 | swarm伝播 | **書換**：`dealEnemyDamage(a.id, 2, ev, true)` で伝播、**`heavy=false` では伝播しない**の2本立て。HP2前提 |
| rogue4:79 | FLOORS[0] は swarm3体 | **書換**：層1は敵0・目標 plant。`FLOORS[1]`（swarm4・HP2）で「構築でき、有効な初手がある」を見る |
| rogue4:89 | 層9は swarm10＋2種 | **書換**：層9＝喰み蟲1＋息喰み1、`hasValidMove()` が true |
| rogue4:99 | swarm比率 | **削除**（構成が変わり前提が消えた） |
| rogue4:113 | 座標重複なし | そのまま |
| rogue7 全体 | 群れ攻撃・層回復 | **ファイルごと削除**（`swarmGroupDamage`/`swarmShouldFire`/`applyFloorClearHeal` が全部無くなるため） |

### 9.4 新規ファイル

**`src/core/oxygen.test.ts`**
1. `swap` 成功で `run.oxygen` が1減り、`oxygen-spent{left}` が1つだけ出る
2. **不正手（非隣接・マッチ不成立）では減らず `oxygen-spent` も出ない**
3. 特殊駒 `tap` でも1減る／特殊駒コンボ swap でも**1手で2回引かれない**
4. `oxygen = 0` で `resolveEnemyTurn` が `run-over` を1回だけ出す（`runOverFired` ガード）
5. 目標達成で `floor-clear` と `oxygen-refill{amount:7}` が対で出て `run.oxygen` が +7 されている
6. **補給に上限が無い**（`oxygen = 22` から層クリアで `29`）
7. run無し Board では `oxygen-spent` / `oxygen-refill` が一切出ない

**`src/core/goals.test.ts`**
1. `system plant` 目標は**色1のマッチでも色4のマッチでも**進む
2. `enemy-kill` 目標：swarm2体を倒すと `floor-clear` がちょうど1回
3. **残敵がいてもクリアする**（`tsutagoke 1` ＋ swarm1体で、蔦苔を剥がした時点で `floor-clear`／`board.enemies.length > 0`）
4. **クリアした手では敵ターンが走らない**（3のケースのイベント列に `cell-sealed` / `oxygen-drained` / `armor-applied` が無い）
5. `goal-progress` に `index` と盤内の `at` が載る
6. **甲殻付きの駒では目標が進まない**（`armored=true` の駒を特殊駒で撃っても `goal-progress` が出ない＝二重計上の穴の回帰）
7. `goals.length === 0` の Board では `floor-clear` が絶対に出ない

**`src/core/enemies2.test.ts`**
1. 3個マッチは敵に1ダメージ、4個マッチは4ダメージ（`damageAround` の分岐）
2. 喰み蟲：`prey-marked` → 2手後に `prey-devoured` で駒が消えHP+2／印の駒を消すと `prey-escaped`＋1ダメージ＋`actionTimer` リセット／**印の隣を消しても解除されない**
3. 裂坑掘り：予告→崩落（`seal` 3手）→移動／予告内の駒を消すと `fissure-averted` が出て次の行動で封鎖されない
4. 息喰み：3手ごとに `oxygen-drained{amount:3}`、それ以外の手では出ない
5. ボス：どんな一撃でも匣1枚（`boss-shell-broken`）、4枚で `boss-phase{phase:2}` と身体2セル化、以降 `enemy-damage` が入り HP8 で撃破

**`src/core/floors.test.ts`**（レイアウトと敵編成の同時編集事故を止める唯一の防波堤）
1. 全 `FLOORS`：`layout.length === 8` かつ全行 `length === 8`／`goals.length > 0`
2. 敵の初期セル（ボスは行7全列）に `g/G/h/k/K/s` が置かれていない
3. `enemy-kill` 目標の `count === enemies.length`
4. `touhen` 目標の `count <` レイアウト上の `h` の数、`tsutagoke` 目標の `count <=` `g/G` の数
5. 各層について**20シードで Board を構築し `hasValidMove()` が必ず true**（有効手0のソフトロック検出）

### 9.5 完了条件

`npx vitest run games/yacho` が緑。件数の目安は **95〜105件**（削除13件前後、新規25件前後）。

---

## 10. 工程P4：runsim と較正

**編集ファイル**：`src/core/runsim.ts`

### 10.1 目標駆動への追随

- **63-71行**：
  ```ts
  import { FLOORS, type FloorDef } from './floors'
  const buildFloorLevelDef = (floor: number, seed: number, def: FloorDef): LevelDef => ({
    id: floor, seed, moves: 9999, colors: 5, goals: def.goals, layout: def.layout,
  })
  ```
  **103行**：`const board = new Board(buildFloorLevelDef(floor, floorSeed, FLOORS[floor - 1]), run, FLOORS[floor - 1])`
- **33-61行 `pickMove`**：現行は敵セルへの距離しか見ないため、目標駆動の層では実質ランダムプレイの計測になる。
  `enemyCells` に加えて**目標マス**を距離評価の対象に足す：
  - `tsutagoke` 目標が残っていれば `ground > 0` のセル
  - `touhen` / `kokeishi` 目標が残っていれば `block.type === 'hako' | 'touhen' | 'kokeishi'` のセル
  - `system` / `color` 目標が残っていれば、その系統/色の通常駒のセル
  - `enemy-kill` 目標が残っていれば従来どおり敵セル
  これらを1つの `targetCells` にまとめ、既存の最短距離ロジックをそのまま流用する。

### 10.2 集計

| 現在 | 変更後 |
|---|---|
| `SeedResult.endHpByFloor`(86,96,136行) | `endOxygenByFloor` ／ `run.oxygen` を記録 |
| `FloorAgg.avgEndHp`(161,186行) | `avgEndOxygen` |
| `endHpFor()`(202-204行) | `endOxygenFor()` |
| 表ヘッダ `残HP平均`(224,244行) | `残酸素平均` |
| 冒頭コメント(3行) の「残HP」 | 「残酸素」 |

**追加（較正に必須）**
1. `FloorAgg.avgMovesPerFloor = moveCount / reached`（0除算は0）。表に `手数/層` 列を追加。
2. サマリ行に総手数：
   ```ts
   const totalMoves = results.map((r) => r.moves.length).sort((a, b) => a - b)
   lines.push(`総手数: 平均 ${avg(totalMoves).toFixed(1)} / 中央値 ${percentile(totalMoves, 0.5)} （目標 85〜100）`)
   ```
3. サマリ行に `deathFloor` のヒストグラム1行（どこで酸素が尽きたかが較正の主情報）。

### 10.3 較正の合格条件（数字で判定する）

```
npx esbuild games/yacho/src/core/runsim.ts --bundle --platform=node --format=esm --outfile=<scratch>/runsim.mjs
node <scratch>/runsim.mjs 120 > games/yacho/assets_src/_runsim.txt
```

| 指標 | 合格帯 | 外れたときの調整 |
|---|---|---|
| 10層クリア率 | **30〜60%** | 低すぎ→目標数を下げる／高すぎ→目標数を上げる |
| 総手数（平均） | **85〜100** | 目標数で合わせる。`OXYGEN_SUPPLY_PER_FLOOR` は最後の微調整 |
| 層クリア時の残酸素 | **層が進むほど単調に細る**（層1〜3で20前後、層8〜9で10以下） | 増え続けるなら補給が多すぎ＝`+7` を下げる。**ここが失敗すると失敗条件が機能しない** |
| 層あたり手数 | 各層 **6〜12** | §1.5 の期待手数と突き合わせ、外れた層の目標数だけ動かす |
| `stuck`（ソルバー行き詰まり） | **0件** | 出たら §4.13 のガードか `pickMove` の不備を疑う |
| swarm伝播/手 | build撃破/手 を**超えない** | 超えるなら伝播条件（`heavy`）が効いていない |

**調整の順番は必ず ①目標数 → ②`OXYGEN_START` → ③`OXYGEN_SUPPLY_PER_FLOOR`。** 補給を上げてクリア率を稼ぐと総手数の目標を突き破る。

---

## 11. 検証手順（総合）

1. **単体**：`npx vitest run games/yacho` が緑（§9.5）。
2. **型**：`npm run build`（yacho を含むビルド）が通る。`grep -rn "playerHp" games/yacho/src` が **0件**。
3. **較正**：§10.3 の6指標をすべて合格帯に入れ、`assets_src/_runsim.txt` を更新してコミットする。
4. **実ドラッグ（Playwright）**：`npx vite` → `http://localhost:5173/games/yacho/`、ビューポート **390x844**。
   `window.__yacho` の `metrics()` / `busy()` / `setOxygen(n)` / `forceFloorClear()` / `hapticsLog()` を使い、次を確認する。
   - 実ドラッグで1手打つたびに酸素の数字が1減る（`__yacho.run.oxygen` と表示が一致）
   - `setOxygen(6)` で炎がゆらぎ数字が朱、`setOxygen(2)` で1手ごとに大きく脈打つ、`setOxygen(1)` から1手で結果画面へ
   - `forceFloorClear()` で層クリアバナー→`+7` が満ちる→ドラフトへ
   - 層3で蔦苔を1マス剥がすと目標チップの数字が1増える（`__yacho.board.goalDone` と一致）
5. **動画（一次証拠。静止画では判定できない＝JUICE §4）**：`motion-capture` スキルで60fps録画→**1/4速**で確認。
   | # | 見るもの | 合格条件 |
   |---|---|---|
   | 1 | 落下 | 1マス落下が1/4速で9±1フレーム。着地で1フレーム潰れて2〜3フレームで戻る。**等速に見えたら不合格**。全列同時に落ちない |
   | 2 | 消滅 | 膨らみのピークが視認でき、その**あと**に火花。同時／火花が先なら不合格 |
   | 3 | スワップ | 成立時に目標セルをわずかに行き過ぎて戻る。不成立は240msで往復し震えない |
   | 4 | **目標収集** | **音を消して第三者に見せ「今なにを何個集めたか」を説明できる**。破砕→弧を描く飛翔→カウンタの跳ね、の3拍が繋がる |
   | 5 | 多数同時 | 目標に12個以上絡む手で、飛翔は6本で打ち止め・数字は最終的に `board.goalDone` と一致 |
   | 6 | 酸素強奪 | 層9で息喰みの予告（赤バッジ・`酸素-3`）→発動で軌跡＋ゲージのフラッシュ＋`-3` が浮く |
   | 7 | ボス | 匣が4枚剥がれる（チップが `匣 n/4`）→`boss-phase` で盤面が広がる→核を削る |
   | 8 | **連鎖テンポの非退行** | 同じ seed・同じ手で `view.play(evs)` の戻り値の差が **±40ms 以内**。連鎖段の間隔が 520/470/410/350/300/220 のまま |
   | 9 | reconcile | 一手の最終フレームで駒がカクッと定位置へ飛ばない（`total + 200` が効いている） |
   | 10 | 振動 | Android Chrome：12駒同時消しで `hapticsLog()` が1手あたり**5件以下**。iOS Safari：`hapticsSupported() === false`・例外ゼロ・挙動は完全に同じ |

---

## 12. 今回やらないこと（明示的に範囲外）

| 項目 | 理由 |
|---|---|
| **目標の劣化**（蔦苔が広がる／匣が閉じ直す／標本が枯れる） | §0.3。酸素を採用した時点で存在理由が消えた。時計を2本にしない |
| **駒の常時呼吸**（JUICE §1①の一部） | `reconcile()` が毎手末に全駒の position/scale をハードスナップするため、駒に直書きすると毎手カクつく。44pxセルで±1〜2pxは見えない。第2弾へ |
| **④常時アニメーション（敵の呼吸・瞬き・身構え、idleティッカー）** | 第2弾。導入時は `wrap`（タイムライン所有）の下に `body` コンテナを1段挟んで idle に持たせる、という設計だけ BACKLOG に残す |
| **iOS の振動抜け道**（`<input type="checkbox" switch>`） | 非公式APIで将来壊れる。「どちらも失敗しても無音で成立」を守る |
| **光胞子の搬送目標／ギア起動目標** | PLAN §1.5「第2弾へ」。今回の目標は 植物標本・蔦苔・陶片・掃討 の4種のみ |
| **深層異常（ボスブラインド型）／ドラフト9→7回** | PLAN 第4段階。今回は触らない |
| **`finishWin()` の勝利ドレイン演出／`board.lost`／`solver.ts`／旧30レベル制** | ローグからは呼ばれない。壊さないために触らない |
| **敵の内部id改名**（`sporeling`→`harvester` 等） | §0.2 #8。和名だけ変える |
| **`easeOutBounce` の削除** | 現在デッドコードだが今回の依頼に無関係。報告のみで残す |
| **新規アセットの作成** | 酸素計は `ui_oil` 転用、目標アイコンは既存駒テクスチャ、息喰みは Graphics 描画。**素材の作り直しはゼロ** |
