# C案移行 Phase4/6 実装計画＋Phase1/2/3/5検収（Codexレビュー 2026-08-16）

# C案移行 Phase1/2/3/5 検収レビューと Phase4/6 実装計画

## 0. 結論

Phase1・Phase2・Phase3は、C案へ移るための足場として概ね妥当である。

Phase5は、`swap()` / `tap()` の同期互換adapterとしては妥当だが、現状の `MoveResolution.next()` をそのままPhase6の `ResolutionCoordinator` に接続してはいけない。エンジンの停止境界と表示セグメント境界がまだ一致していないためである。

着手順は次とする。

1. Phase5.5として、`next()` の返り値を明示的な `ResolutionStep` に変更し、resolve・gravity・enemy・finishの実停止境界を完成させる
2. `BoardView.play()` を「1手コンテキスト」と `playSegment()` に分割する
3. `main.ts` のイベント消費を、逐次演出と手完了時集計に分離する
4. `ResolutionCoordinator` を旧経路と並存させる
5. stepped経路で境界修復ゼロを確認してから、`whenBoardQuiet`・idle healer・clear lifelineを撤去する

42件の透明駒については、現時点ではP3/P5退行よりも、旧アーキテクチャに残る「最終盤面を先に確定し、数秒分の表示を予約する」ことによる予約待ちの一括検出と見るのが妥当である。ただし、`repairStrandedAlpha` と `reconcile corrected` が非ゼロであるため、表示系全体が健全になったとは判定しない。

---

## 1. Phase1 検収

### 判定

条件付き合格。

計器化は本番挙動から `?debug` / `?diag` で分離され、Sprite個体ID、帳簿操作履歴、旧世代callback、refill postcondition、修復発火を関連付けられるようになっている。今回の病巣を「所有権破壊」と「予約writer競合」に分離する目的を満たしている。

### 1.1 多重writerを時間窓の重なりで判定する設計

時間窓判定は正しい。

同一object/propertyに複数のtweenが存在しても、次のような直列予約は競合ではない。

```text
移動 0–200ms
着地 200–252ms
復帰 252–362ms
```

したがって、「生きているtween本数」ではなく、`[start, end)` の交差を検出する現在の方式が適切である。

一方、現在の数値には次の制限がある。

- 1予約につき最初の1競合だけを報告するため、競合property数や競合相手数を表す厳密な総数ではない
- 8ms未満の重なりを無視するため、短時間の実競合も意図的に捨てる
- `alpha`、`position.x/y`、`scale.x/y`相当だけが対象であり、rotation等は対象外
- callbackが新しいtweenを作った後の発注元タグは追えるが、`diagCtx` はグローバルなので、診断タグの正確性は実行順に依存する

したがって、`multiWriter=400` は「400個の表示不良」を意味しない。ただし、上位が旧世代の着地callbackと次の手のwriterであることは、現行設計の世代競合を十分に示している。

Phase6の合格条件は、件数の多少ではなく次とする。

```text
stepped経路で、駒Spriteのboard系propertyに対する時間窓重複が0
```

FXや意図的な合成writerを許可する場合は、無視条件を時間幅ではなく明示的なwriter policyで表現する方がよい。

```ts
type WriterPolicy = 'exclusive' | 'composable'
```

### 1.2 帳簿監査の注意点

現在の `auditLedgers()` は、過渡状態の誤検出を避けるため、帳簿外Spriteについて次を監査対象外にしている。

- 透明なSprite
- tweenを持つSprite

そのため、`ledger=0` は「全pieceLayer childが常時 mapped XOR doomed」という厳密証明ではない。通常の予約再生中には必要な緩和だが、Phase6のセグメント境界では過渡状態が終わっているため、別の厳格監査を追加する。

```ts
assertStableLedger(snapshotAfter)
```

境界監査では次を例外なく確認する。

- 生存pieceLayer childは mapped XOR doomed
- mapped Spriteはちょうど1セルから参照される
- mapped Spriteのkindはsnapshotと一致する
- mapped Spriteは定位置・`alpha=1`・基準scale
- doomedは境界完了時には空
- 駒Spriteに生存中のboard writerがない

### 1.3 診断履歴の容量

128件の共有ring bufferは、42セル一括症状や深い連鎖では原因操作が押し出される可能性が高い。Phase6検証中は次のいずれかへ拡張する。

- 共有履歴を1024件程度へ増やす
- Sprite IDごとに直近16件を保持する
- 異常検出時だけ対象Spriteと同一セルの履歴を凍結する

---

## 2. Phase2 検収

### 判定

合格。C案への足場として目的を満たしている。

`sprites.set/delete` が `makePiece()`、`syncAll()`、`mapMove()`、`mapSwap()`、`mapRetire()`、`mapClear()` に限定されており、所有権変更点を追える状態になった。

ただし、Phase6前に各APIへdebug時preconditionを加える。

```ts
mapMove(from, to, sp):
  sprites.get(from) === sp
  from !== to
  destinationに別Spriteがいる場合は、明示的にfoldされたこと

mapSwap(a, b, sa, sb):
  sprites.get(a) === sa
  sprites.get(b) === sb

mapRetire(cell, sp):
  sprites.get(cell) === sp
  doomedに未登録

mapClear(cell, sp):
  sprites.get(cell) === sp
```

`makePiece()` が占有済みセルを黙ってdestroyして上書きできる点は、移行中の保険としては許容する。ただしstepped経路では異常なので、debug時に別カウンタを立てる。

```text
spawn-overwrite
```

最終的には `makePiece()` を純粋なspawnにし、replaceは `replacePiece()` として分離するのが望ましい。

---

## 3. Phase3 検収

### 判定

分類器として合格。ただし、Phase6のエンジン停止境界の正本には使わない。

`segmentEvents()` は順序保存とflatten一致を満たしている。`reroll` を `refill` から分離した判断も正しい。

### 3.1 reroll分離後の `already` 防御分岐

防御分岐を残したことは妥当である。移行中の旧タイムライン競合まで即座に例外化すると、本番の自己回復能力を失う。

ただし、現在は正常経路と異常吸収を区別できない。次のように計測する。

```ts
case 'refill':
  if (already) {
    report('occupiedRefill', ...)
    playReroll(...)
  }
```

運用方針は次とする。

- legacy経路では防御動作を残す
- stepped経路では `occupiedRefill` を契約違反として扱う
- stepped経路で十分な走行数がゼロになった後、fallbackをassertへ縮小する

### 3.2 `segmentEvents()` の限界

イベント種別だけでは、そのイベントを発生させた論理フェーズを完全には表せない。

例：

- 敵ターン中の偶発マッチでも `match` / `fall` / `refill` が出る
- `goal-progress` はプレイヤー解決中にも敵ターン中にも出る
- `prey-devoured` は敵行動であると同時に駒除去でもある
- `last-light` は敵ターン終端で起きるが、分類上はfinishになる

したがって、Phase6では次を分離する。

- `segmentEvents()`：確定イベント列を見た目の種類に束ねる補助関数
- `ResolutionStep.kind`：エンジン自身が発行する実停止境界

---

## 4. Phase5 検収

### 判定

同期互換adapterとしては合格。Phase6の停止可能エンジンとしては未完成。

### 4.1 良い点

- `swap()` / `tap()` と段階経路が同じコードパスを通る
- `drain()` と逐次 `next()` のイベント順を比較している
- 複数seed・複数手で最終cells、手数、目標、score、後続RNG挙動を比較している
- 不正手と完了後の再呼び出しがテストされている

### 4.2 Phase6を阻む停止境界のずれ

現状の `next()` は「意味上の1セグメント」を返すのではなく、「次のyieldまでに増えたイベント差分」を返す。

通常スワップでは、おおむね次になる。

```text
next #1:
  swap + oxygen-spent

next #2:
  resolveMatches
  applyGravity
  refill
  → resolveイベントとgravityイベントが同じ差分に入る
```

さらに次が残っている。

- `afterMove()` 内の胞子浮上後 `resolveCascades()` はその場でdrainされる
- `resolveEnemyTurn()` 内の再安定化もその場でdrainされる
- 敵ターン中のenemy・resolve・gravity・finishが一度の `next()` に混在し得る
- `Segment` に予定されていた `beforeRevision`、`afterRevision`、`snapshotAfter` がない
- `BoardView` が現在のlive `Board` を読むため、表示中のイベントより先の状態が見える危険が残る

このまま `next() → await playSegment()` を接続すると、「表示境界と論理境界を一致させる」というC案の中心条件を満たさない。

### 4.3 differential testの不足

現テストは「リファクタ前実装」と「リファクタ後実装」の比較ではない。どちらも現在のジェネレータを通るため、同じ誤りが一括経路と逐次経路へ入ればテストは通る。

またsnapshot対象に次が含まれていない。

- enemiesとaction timer
- block、ground、armor、prey、seal等のセル状態の明示比較
- RunStateのoxygen、blessings、records、lastLightUsed等
- `floorCleared`、`runOverFired`、hook予算・再生状態
- tap、特殊駒コンボ、敵行動、ボス相転移、層クリア、遭難
- `next()` を数回呼んだ後の部分 `drain()`

Phase5.5で次を追加する。

1. `ce31158` 実装から固定seedのgolden fixtureを作り、イベント列と全状態を比較する
2. `BoardSnapshot` を正規化して全論理状態を比較する
3. swap、tap、特殊駒単発、特殊駒コンボ、胞子、敵全種、ボス、clear、run-overを含める
4. `next×N → drain` をNの全境界で試す
5. 各stepで `snapshotAfter === board.snapshot()` を確認する
6. 全stepのflattenが旧イベント列と一致することを確認する
7. 同一seedで100手以上のproperty testを行う

---

## 5. Phase5.5：Resolution契約の完成

Phase4/6より先に、返り値を次の形へ変更する。

```ts
type ResolutionStepKind =
  | 'swap'
  | 'resolve'
  | 'gravity'
  | 'after-move'
  | 'enemy'
  | 'finish'

interface ResolutionStep {
  resolutionId: number
  index: number
  kind: ResolutionStepKind
  events: readonly BoardEvent[]
  beforeRevision: number
  afterRevision: number
  snapshotAfter: BoardSnapshot
}

interface MoveResolution {
  next(): ResolutionStep | null
  drain(): {
    steps: ResolutionStep[]
    events: BoardEvent[]
    finalSnapshot: BoardSnapshot
  }
  readonly done: boolean
  readonly events: readonly BoardEvent[]
}
```

`revision` は各step確定時に単調増加させる。`snapshotAfter` は最低限、表示とHUDが参照する次を含める。

```text
cells
enemies
goals / goalDone
movesLeft
score / chain
run.oxygen / lampMax / records
floorCleared / runOverFired
```

### 必要なyield位置

```text
swap適用後
resolveMatches / fireSpecial後
gravity + refillの安定後
reroll後
spore-rise / spore-collected後
afterMove由来の各resolve / gravity後
敵の直接行動後
敵行動由来の各resolve / gravity後
floor-clear / oxygen-refill / run-over確定後
```

`resolveCascades()` の互換drainは旧adapter内部だけに残し、stepped解決の内部からは使わない。

エンジンが `kind` を発行し、`segmentEvents()` から論理フェーズを逆推測しない。

---

## 6. 42件幽霊の解釈

### 現時点の判定

42件の一括検出だけを根拠にP3/P5退行とは判定しない。既知の残存症状、特に「補充Spriteを `alpha=0` で生成し、長い予約タイムラインの後方でfade-inさせる」状態を、壁時計ベースの4秒検出器が拾った可能性が高い。

根拠は次である。

- 全42件が `alpha=0.00`
- その後、操作不能や論理停止なしに自己解消した
- 帳簿違反、refill postcondition、orphanが0
- 深層連続走行でのみ一度発生した
- 層8直行では再現していない
- CPUスロットル下では壁時計とtween内部時計の進みが一致しない
- 現行実装は論理盤面を先に最終状態へ進めるため、「エンジンに駒があるが表示は予約待ち」が構造上発生する

ただし、次の観測は別問題として重い。

```text
repairStrandedAlpha: 0〜133
reconcile corrected: 2〜245
```

`repairStrandedAlpha` は「alpha writerが存在しない透明mapped Sprite」にだけ発火する。これは単なる予約待ちではない。したがって、42件バッチが検出器由来でも、現行表示系に本物の取り残しが残っていることは否定できない。

### 決定的な追加計測

幽霊検出時にセルごとに次を保存する。

```ts
{
  wallAgeMs,
  tweenAgeMs,
  tweenNow,
  timelineRemainingMs,
  viewQuiet,
  resolutionId,
  moveSeq,
  boardRevision,
  presentedRevision,
  spriteId,
  cell,
  boardKind,
  spriteKind,
  alpha,
  hasAlphaWriter,
  alphaWriterTag,
  alphaStartRemainingMs,
  alphaEndRemainingMs,
  hasPositionWriter,
  positionWriterTag,
  doomed,
  mapped,
  recentOps,
  documentVisibilityState
}
```

判定は次の三分類にする。

| 状態 | 解釈 |
|---|---|
| `hasAlphaWriter=true` かつ開始予定が未来 | 予約待ち。壁時計検出器の偽陽性 |
| `hasAlphaWriter=false` かつkind一致・mapped | 本物のstranded alpha |
| kind不一致、または `boardRevision > presentedRevision` | 論理と表示の先行差。C案が解消すべき構造症状 |

検出条件も二系統に分ける。

```text
A. wall detector:
   alpha < 0.5 が壁時計4秒

B. stable detector:
   view.isQuiet()になった後もalpha < 0.5が2回連続
```

Bだけが発火した場合を本物の幽霊とする。Aだけなら予約遅延である。

さらに、同一seed・同一入力列・同一スロットルで `ce31158` とHEADを最低20走ずつ比較する。層到達度ではなく、入力列を固定したpaired comparisonにする。

---

## 7. Phase4：`BoardView.playSegment()` への分割

### 7.1 API

```ts
interface MovePlayback {
  resolutionId: number
  moveSeq: number
  startedAt: number
  visibleFireCount: number
  fireGlobalBudget: number
  upgradeFireCounts: Map<string, number>
  aggregateFireCounts: Map<string, number>
  aggregateFireAt: Map<string, XY>
  goalFxCount: number
  disruptLabelCount: number
  previousChain: number
  nextChainEarliest: number
}

class BoardView {
  beginMove(resolutionId: number): MovePlayback

  playSegment(
    playback: MovePlayback,
    step: ResolutionStep,
  ): Promise<void>

  finishMove(
    playback: MovePlayback,
    finalSnapshot: BoardSnapshot,
  ): void

  renderStable(snapshot: BoardSnapshot): void
}
```

`moveSeq`、FX乱数seed、振動予算、全手共通の発火集約予算は `beginMove()` で一度だけ更新する。`playSegment()` ごとに更新してはいけない。

### 7.2 現行 `play()` の分解順

最初にロジックを次の四層へ機械的に分ける。

```text
beginMove()
  世代更新
  hint解除
  1手単位予算初期化

scheduleEvent()
  現行switchの各case

scheduleGravityTrain()
  fall/refillの列剛体化

finishSegment()
  board/cue writer完了待ち
  境界監査
```

legacyの `play(evs)` は当面、これらを呼ぶadapterとして残す。

```ts
play(evs) {
  const ctx = beginMove(...)
  for (const segment of segmentEvents(evs)) {
    scheduleSegmentLegacy(ctx, segment)
  }
  return legacyDuration
}
```

stepped経路だけが `await playSegment()` を使う。

### 7.3 Promise完了条件

`playSegment()` の完了は戻り値の推定durationだけで決めない。

条件は次のすべてとする。

- そのsegmentが作ったboard writerが完了
- そのsegmentが作ったcueが完了
- 着地callbackが作るscale/position復帰tweenも完了
- mapped/doomed台帳が境界状態に収束
- scene epochが有効

各tweenへ `resolutionId/segmentId` を持たせ、segment単位のpending writer数を数える方式が最も確実である。`channelEndMany()+200ms` は移行中のfallbackに留める。

FX粒子の余韻は待たなくてよい。駒Spriteや論理的な障害物に触れない `fx` のみ次segmentへ跨げる。

### 7.4 CHAIN_BEAT

現行の `CHAIN_BEAT` は、一括イベント列のローカル時刻 `t` に次の連鎖開始時刻を置くための仕組みである。逐次再生後は、前segmentをawaitするため、そのまま加算すると二重待ちになる。

新経路では「連鎖開始間隔の下限」として扱う。

```ts
nextChainEarliest =
  chainStartTweenClock + chainBeatFor(nextChain)
```

次のresolve segmentを始める時点で、

```ts
await max(
  previousSegmentCompletion,
  nextChainEarliest
)
```

とする。

つまり、落下が600ms以上かかった場合は追加待ちなし、短かった場合だけ拍を補う。7連鎖以降の逓減規則は維持する。

### 7.5 列剛体トレイン

列トレインはgravity segment内だけで完結させる。

- 同一gravity segmentのfall/refillを収集
- Spriteごとに最初のfromと最後のtoへcoalesce
- 同じSpriteへ複数のposition writerを作らない
- 最終到達列ごとに剛体トレインを作る
- refillは最終行順に上空へ1マス間隔で並べる
- segment完了時には全mapped Spriteを定位置へ戻す

現行の `startAt = segT + T.pop + stagger` の `T.pop` は、resolve segmentを既にawaitしているため原則不要になる。gravity側には列staggerだけを残す。

斜め移動や複数回fallを含む場合も、一つのgravity step内で同じSpriteへ複数tweenを予約しない。

### 7.6 T_HARD_CAP

全手一括の `T_HARD_CAP=5200` は撤去せず、移行中はlegacy専用として残す。

stepped経路では、予約列全体が数十秒先まで伸びること自体がなくなるため、次の二段予算に置き換える。

```text
segment budget:
  swap       400ms前後
  resolve    1200〜1600ms
  gravity    1200ms
  enemy      1500ms
  finish     個別仕様。勝利演出のみ長め

move quality budget:
  実再生が一定時間を超えたら、
  発火FXの間引き・ラベル集約・CHAIN_BEAT短縮を強める
```

segment cap到達後はイベントを落とさず、FX品質だけを集約する。盤面writerは必ず最後まで完了させる。

---

## 8. main.tsのイベント消費移行

### 8.1 消費者を三種類に分ける

#### A. segment再生中に必要な視覚消費

- `onGoalCollect`
- `onUpgradeFire`
- `onOxygenDrained`
- 盤面SE、飛翔、バウンス、被弾軌跡

これらは `playSegment()` のイベント時刻に合わせて発火する。

#### B. 手完了時にまとめてよい集計

- `movesThisFloor`
- `refillAmount`
- `lightSeries`
- `drainLog`
- `upgradeFireCount`
- `floorFireCount`
- `maxFiresInOneMove`
- postmortem用記録
- `floor-clear` / `run-over` の最終判定

これらはresolution全イベントを蓄積し、完了時に一度だけ処理してよい。むしろ二重計上防止のため、その方が安全である。

#### C. snapshotから再描画できる表示

- 酸素値
- 目標数値
- 進捗badge
- 敵intent
- その他の現在値HUD

通常完了時はsegmentごと、割込drain後はfinal snapshotから一括同期する。

### 8.2 推奨する移行形

現在の `handleFloorResult(evs)` を分ける。

```ts
interface MoveEventAccumulator {
  events: BoardEvent[]
  firesThisMove: number
  terminal: 'clear' | 'over' | null
}

function consumeSegment(
  acc: MoveEventAccumulator,
  step: ResolutionStep,
): void

function finalizeMove(
  acc: MoveEventAccumulator,
  finalSnapshot: BoardSnapshot,
): void
```

`consumeSegment()` は純粋な集計だけを行う。演出は `BoardView` が担当する。

`finalizeMove()` で次を一度だけ行う。

- 記録確定
- HUD最終同期
- `floorDecided` 更新
- floor clear / run over遷移
- queued inputを実行してよいか判定

「resolution完了時に全イベントをまとめて渡す」折衷は、Bの集計消費者には推奨する。一方、同じ全イベントを再度 `view.play()` へ渡してはいけない。

---

## 9. ResolutionCoordinator

### 9.1 基本形

```ts
class ResolutionCoordinator {
  private active: ActiveResolution | null = null
  private latestInput: Command | null = null

  submit(command: Command): void {
    if (this.active) {
      this.latestInput = command
      this.active.interruptRequested = true
      return
    }
    void this.run(command)
  }

  private async run(command: Command): Promise<void> {
    const resolution = createResolution(command)
    const playback = view.beginMove(...)
    const acc = createAccumulator()

    this.active = { resolution, playback, acc, interruptRequested: false }

    while (true) {
      const step = resolution.next()
      if (!step) break

      consumeSegment(acc, step)
      await view.playSegment(playback, step)

      if (this.active.interruptRequested) {
        const drained = resolution.drain()
        for (const skipped of drained.steps) consumeSegment(acc, skipped)

        view.renderStable(drained.finalSnapshot)
        break
      }
    }

    const finalSnapshot = board.snapshot()
    view.finishMove(playback, finalSnapshot)
    finalizeMove(acc, finalSnapshot)

    const terminal = acc.terminal
    const next = this.latestInput
    this.latestInput = null
    this.active = null

    if (!terminal && next) await this.run(next)
  }
}
```

### 9.2 割込規則

```text
入力到着
→ latest inputを上書き保存
→ 現segmentは最後まで再生
→ 残りエンジンstepを無演出drain
→ drainedイベントも集計へ渡す
→ renderStable(finalSnapshot)
→ 手完了処理
→ terminalでなければlatest input 1件を最終盤面で再評価
```

重要事項：

- 割込でdrainしたイベントを捨ててはいけない
- `floor-clear` / `run-over` はqueued inputより優先する
- queued swapは座標だけ保持し、元のPiece参照を保持しない
- 最新盤面で不正になった入力は通常のillegalまたはcancel規則で処理する
- 無制限queueは作らない
- scene破棄はユーザー割込と別扱いにし、epoch/abortで即終了できるようにする

---

## 10. whenBoardQuiet・idle healer・clear lifeline

### 10.1 `whenBoardQuiet`

legacy経路では残す。

stepped経路では、最後の `await playSegment()` または割込後の `renderStable()` が決着画面を出せる境界であるため、`whenBoardQuiet()` は使わない。

```text
legacy:
  dur + isQuiet poll + 6秒上限

stepped:
  coordinator finalize
  → 即 onFloorClear / showRunResult
```

### 10.2 idle healer

段階的に扱う。

1. legacy経路では現状維持
2. stepped経路では修復せず、2秒ごとの厳格assertだけにする
3. segment境界の `corrected=0` が十分な走行数で確認できたらticker登録自体を撤去する

stepped経路で `view.reconcile()` を定期実行すると、新設計の欠陥を隠すため禁止する。

### 10.3 clear lifeline

legacy経路では残す。

stepped経路では次を契約違反として診断する。

```ts
if (snapshot.won && !acc.events.some(e => e.t === 'floor-clear')) {
  report('missingFloorClear', ...)
}
```

ここから直接 `onFloorClear()` を呼んではいけない。Phase5.5のテストとエンジン修正で解消する。

### 10.4 reconcile / renderStable

移行順は次とする。

1. segment境界で `renderStable(snapshotAfter)` を呼び、修正件数を計測
2. stepped経路で修正0が安定したら、通常境界ではassert-onlyにする
3. `renderStable()` は割込drain、scene復帰、debug操作など明示的な再同期用途だけに残す
4. `repairStrandedAlpha()` は最後に削除し、debug assertへ置換する

---

## 11. フラグ戦略

モードは層開始時に固定し、1手の途中で切り替えない。

```ts
type ResolutionMode =
  | 'legacy'
  | 'segmented-batch'
  | 'stepped'
```

- `legacy`: 現行 `board.swap() → view.play(evs)`
- `segmented-batch`: boardは一括解決し、表示分割だけ検証する診断モード
- `stepped`: Phase5.5 + coordinatorの本命経路

`segmented-batch` はPhase4の見た目比較には有用だが、論理盤面が先行するため本番の最終形にはしない。

推奨展開順：

1. 既定値legacy
2. `?resolution=segmented` を開発者向けに追加
3. `?resolution=stepped` を追加
4. CIでlegacy/stepped双方のcore・coordinatorテスト
5. QAハーネスをsteppedへ
6. steppedで固定seed深層走行
7. 既定値をsteppedへ変更
8. 1リリース分は `?resolution=legacy` のkill switchを残す
9. 問題がなければlegacyの予約圧縮・quiet healer・lifelineを削除

同じBoardインスタンスへ旧経路と新経路を同時適用するshadow executionは禁止する。比較する場合は、完全に独立した双子BoardとRunStateを使用する。

---

## 12. テスト計画

### Core

- 旧goldenとのイベント・全状態比較
- 全step flatten一致
- revision単調増加
- `snapshotAfter` 一致
- stepのイベントが空でない
- `next×N → drain` 全境界
- tap / combo / special / spore / enemy / boss / clear / over
- 固定seed長時間property test

### View

- `playSegment()` 完了時に駒board writerが0
- 各境界で厳格帳簿監査0
- refill占有fallback 0
- stale callback 0
- multi-writer 0
- gravity segmentで1 Sprite/1 property/1 writer
- segmentごとの最大所要時間
- scene破棄時にPromiseが残留しない

### Coordinator

- 通常逐次進行
- segment中に1回割込
- segment中に複数入力しlatestだけ残る
- drainイベントも集計される
- drain中のfloor-clearがqueued inputより優先
- queued inputが最終盤面で再評価される
- illegal入力
- scene破棄
- legacyとsteppedの最終状態・集計一致

### 実機検収条件

stepped経路の合格条件を次とする。

```text
固定seed 100手以上
CPU 1x / 4x
入力間隔 0 / 50 / 100 / 200ms

ledger violation       0
refill postcondition   0
occupied refill        0
stale callback         0
piece multi-writer     0
repair alpha           0
orphan                 0
boundary corrected     0
missing floor-clear    0
stable ghost           0
```

---

## 13. 最終判定

| Phase | 判定 | 備考 |
|---|---|---|
| Phase1 | 条件付き合格 | 時間窓判定は正しい。境界用の厳格監査とwriter詳細計測を追加する |
| Phase2 | 合格 | 所有権変更点は集約できた。debug preconditionを追加する |
| Phase3 | 合格 | 分類器として使用。エンジン停止境界の正本にはしない |
| Phase5 | 条件付き合格 | 同期互換性は良いが、Phase6用step契約と実停止境界が不足 |
| 42件幽霊 | 退行認定せず | 予約待ちの可能性が高い。tween時計・writer・revisionを同時記録して確定する |
| Phase4/6着手 | Phase5.5後に可 | `ResolutionStep + snapshot + revision` を先に完成させる |

C案の狙いは、修復機構を増やすことではなく、「エンジンが次へ進む時点」と「表示がその状態へ到達した時点」を同じ境界にすることである。Phase4/6では、`reconcile corrected === 0` を結果ではなく設計契約として扱う。
tokens used
118,480
# C案移行 Phase1/2/3/5 検収レビューと Phase4/6 実装計画

## 0. 結論

Phase1・Phase2・Phase3は、C案へ移るための足場として概ね妥当である。

Phase5は、`swap()` / `tap()` の同期互換adapterとしては妥当だが、現状の `MoveResolution.next()` をそのままPhase6の `ResolutionCoordinator` に接続してはいけない。エンジンの停止境界と表示セグメント境界がまだ一致していないためである。

着手順は次とする。

1. Phase5.5として、`next()` の返り値を明示的な `ResolutionStep` に変更し、resolve・gravity・enemy・finishの実停止境界を完成させる
2. `BoardView.play()` を「1手コンテキスト」と `playSegment()` に分割する
3. `main.ts` のイベント消費を、逐次演出と手完了時集計に分離する
4. `ResolutionCoordinator` を旧経路と並存させる
5. stepped経路で境界修復ゼロを確認してから、`whenBoardQuiet`・idle healer・clear lifelineを撤去する

42件の透明駒については、現時点ではP3/P5退行よりも、旧アーキテクチャに残る「最終盤面を先に確定し、数秒分の表示を予約する」ことによる予約待ちの一括検出と見るのが妥当である。ただし、`repairStrandedAlpha` と `reconcile corrected` が非ゼロであるため、表示系全体が健全になったとは判定しない。

---

## 1. Phase1 検収

### 判定

条件付き合格。

計器化は本番挙動から `?debug` / `?diag` で分離され、Sprite個体ID、帳簿操作履歴、旧世代callback、refill postcondition、修復発火を関連付けられるようになっている。今回の病巣を「所有権破壊」と「予約writer競合」に分離する目的を満たしている。

### 1.1 多重writerを時間窓の重なりで判定する設計

時間窓判定は正しい。

同一object/propertyに複数のtweenが存在しても、次のような直列予約は競合ではない。

```text
移動 0–200ms
着地 200–252ms
復帰 252–362ms
```

したがって、「生きているtween本数」ではなく、`[start, end)` の交差を検出する現在の方式が適切である。

一方、現在の数値には次の制限がある。

- 1予約につき最初の1競合だけを報告するため、競合property数や競合相手数を表す厳密な総数ではない
- 8ms未満の重なりを無視するため、短時間の実競合も意図的に捨てる
- `alpha`、`position.x/y`、`scale.x/y`相当だけが対象であり、rotation等は対象外
- callbackが新しいtweenを作った後の発注元タグは追えるが、`diagCtx` はグローバルなので、診断タグの正確性は実行順に依存する

したがって、`multiWriter=400` は「400個の表示不良」を意味しない。ただし、上位が旧世代の着地callbackと次の手のwriterであることは、現行設計の世代競合を十分に示している。

Phase6の合格条件は、件数の多少ではなく次とする。

```text
stepped経路で、駒Spriteのboard系propertyに対する時間窓重複が0
```

FXや意図的な合成writerを許可する場合は、無視条件を時間幅ではなく明示的なwriter policyで表現する方がよい。

```ts
type WriterPolicy = 'exclusive' | 'composable'
```

### 1.2 帳簿監査の注意点

現在の `auditLedgers()` は、過渡状態の誤検出を避けるため、帳簿外Spriteについて次を監査対象外にしている。

- 透明なSprite
- tweenを持つSprite

そのため、`ledger=0` は「全pieceLayer childが常時 mapped XOR doomed」という厳密証明ではない。通常の予約再生中には必要な緩和だが、Phase6のセグメント境界では過渡状態が終わっているため、別の厳格監査を追加する。

```ts
assertStableLedger(snapshotAfter)
```

境界監査では次を例外なく確認する。

- 生存pieceLayer childは mapped XOR doomed
- mapped Spriteはちょうど1セルから参照される
- mapped Spriteのkindはsnapshotと一致する
- mapped Spriteは定位置・`alpha=1`・基準scale
- doomedは境界完了時には空
- 駒Spriteに生存中のboard writerがない

### 1.3 診断履歴の容量

128件の共有ring bufferは、42セル一括症状や深い連鎖では原因操作が押し出される可能性が高い。Phase6検証中は次のいずれかへ拡張する。

- 共有履歴を1024件程度へ増やす
- Sprite IDごとに直近16件を保持する
- 異常検出時だけ対象Spriteと同一セルの履歴を凍結する

---

## 2. Phase2 検収

### 判定

合格。C案への足場として目的を満たしている。

`sprites.set/delete` が `makePiece()`、`syncAll()`、`mapMove()`、`mapSwap()`、`mapRetire()`、`mapClear()` に限定されており、所有権変更点を追える状態になった。

ただし、Phase6前に各APIへdebug時preconditionを加える。

```ts
mapMove(from, to, sp):
  sprites.get(from) === sp
  from !== to
  destinationに別Spriteがいる場合は、明示的にfoldされたこと

mapSwap(a, b, sa, sb):
  sprites.get(a) === sa
  sprites.get(b) === sb

mapRetire(cell, sp):
  sprites.get(cell) === sp
  doomedに未登録

mapClear(cell, sp):
  sprites.get(cell) === sp
```

`makePiece()` が占有済みセルを黙ってdestroyして上書きできる点は、移行中の保険としては許容する。ただしstepped経路では異常なので、debug時に別カウンタを立てる。

```text
spawn-overwrite
```

最終的には `makePiece()` を純粋なspawnにし、replaceは `replacePiece()` として分離するのが望ましい。

---

## 3. Phase3 検収

### 判定

分類器として合格。ただし、Phase6のエンジン停止境界の正本には使わない。

`segmentEvents()` は順序保存とflatten一致を満たしている。`reroll` を `refill` から分離した判断も正しい。

### 3.1 reroll分離後の `already` 防御分岐

防御分岐を残したことは妥当である。移行中の旧タイムライン競合まで即座に例外化すると、本番の自己回復能力を失う。

ただし、現在は正常経路と異常吸収を区別できない。次のように計測する。

```ts
case 'refill':
  if (already) {
    report('occupiedRefill', ...)
    playReroll(...)
  }
```

運用方針は次とする。

- legacy経路では防御動作を残す
- stepped経路では `occupiedRefill` を契約違反として扱う
- stepped経路で十分な走行数がゼロになった後、fallbackをassertへ縮小する

### 3.2 `segmentEvents()` の限界

イベント種別だけでは、そのイベントを発生させた論理フェーズを完全には表せない。

例：

- 敵ターン中の偶発マッチでも `match` / `fall` / `refill` が出る
- `goal-progress` はプレイヤー解決中にも敵ターン中にも出る
- `prey-devoured` は敵行動であると同時に駒除去でもある
- `last-light` は敵ターン終端で起きるが、分類上はfinishになる

したがって、Phase6では次を分離する。

- `segmentEvents()`：確定イベント列を見た目の種類に束ねる補助関数
- `ResolutionStep.kind`：エンジン自身が発行する実停止境界

---

## 4. Phase5 検収

### 判定

同期互換adapterとしては合格。Phase6の停止可能エンジンとしては未完成。

### 4.1 良い点

- `swap()` / `tap()` と段階経路が同じコードパスを通る
- `drain()` と逐次 `next()` のイベント順を比較している
- 複数seed・複数手で最終cells、手数、目標、score、後続RNG挙動を比較している
- 不正手と完了後の再呼び出しがテストされている

### 4.2 Phase6を阻む停止境界のずれ

現状の `next()` は「意味上の1セグメント」を返すのではなく、「次のyieldまでに増えたイベント差分」を返す。

通常スワップでは、おおむね次になる。

```text
next #1:
  swap + oxygen-spent

next #2:
  resolveMatches
  applyGravity
  refill
  → resolveイベントとgravityイベントが同じ差分に入る
```

さらに次が残っている。

- `afterMove()` 内の胞子浮上後 `resolveCascades()` はその場でdrainされる
- `resolveEnemyTurn()` 内の再安定化もその場でdrainされる
- 敵ターン中のenemy・resolve・gravity・finishが一度の `next()` に混在し得る
- `Segment` に予定されていた `beforeRevision`、`afterRevision`、`snapshotAfter` がない
- `BoardView` が現在のlive `Board` を読むため、表示中のイベントより先の状態が見える危険が残る

このまま `next() → await playSegment()` を接続すると、「表示境界と論理境界を一致させる」というC案の中心条件を満たさない。

### 4.3 differential testの不足

現テストは「リファクタ前実装」と「リファクタ後実装」の比較ではない。どちらも現在のジェネレータを通るため、同じ誤りが一括経路と逐次経路へ入ればテストは通る。

またsnapshot対象に次が含まれていない。

- enemiesとaction timer
- block、ground、armor、prey、seal等のセル状態の明示比較
- RunStateのoxygen、blessings、records、lastLightUsed等
- `floorCleared`、`runOverFired`、hook予算・再生状態
- tap、特殊駒コンボ、敵行動、ボス相転移、層クリア、遭難
- `next()` を数回呼んだ後の部分 `drain()`

Phase5.5で次を追加する。

1. `ce31158` 実装から固定seedのgolden fixtureを作り、イベント列と全状態を比較する
2. `BoardSnapshot` を正規化して全論理状態を比較する
3. swap、tap、特殊駒単発、特殊駒コンボ、胞子、敵全種、ボス、clear、run-overを含める
4. `next×N → drain` をNの全境界で試す
5. 各stepで `snapshotAfter === board.snapshot()` を確認する
6. 全stepのflattenが旧イベント列と一致することを確認する
7. 同一seedで100手以上のproperty testを行う

---

## 5. Phase5.5：Resolution契約の完成

Phase4/6より先に、返り値を次の形へ変更する。

```ts
type ResolutionStepKind =
  | 'swap'
  | 'resolve'
  | 'gravity'
  | 'after-move'
  | 'enemy'
  | 'finish'

interface ResolutionStep {
  resolutionId: number
  index: number
  kind: ResolutionStepKind
  events: readonly BoardEvent[]
  beforeRevision: number
  afterRevision: number
  snapshotAfter: BoardSnapshot
}

interface MoveResolution {
  next(): ResolutionStep | null
  drain(): {
    steps: ResolutionStep[]
    events: BoardEvent[]
    finalSnapshot: BoardSnapshot
  }
  readonly done: boolean
  readonly events: readonly BoardEvent[]
}
```

`revision` は各step確定時に単調増加させる。`snapshotAfter` は最低限、表示とHUDが参照する次を含める。

```text
cells
enemies
goals / goalDone
movesLeft
score / chain
run.oxygen / lampMax / records
floorCleared / runOverFired
```

### 必要なyield位置

```text
swap適用後
resolveMatches / fireSpecial後
gravity + refillの安定後
reroll後
spore-rise / spore-collected後
afterMove由来の各resolve / gravity後
敵の直接行動後
敵行動由来の各resolve / gravity後
floor-clear / oxygen-refill / run-over確定後
```

`resolveCascades()` の互換drainは旧adapter内部だけに残し、stepped解決の内部からは使わない。

エンジンが `kind` を発行し、`segmentEvents()` から論理フェーズを逆推測しない。

---

## 6. 42件幽霊の解釈

### 現時点の判定

42件の一括検出だけを根拠にP3/P5退行とは判定しない。既知の残存症状、特に「補充Spriteを `alpha=0` で生成し、長い予約タイムラインの後方でfade-inさせる」状態を、壁時計ベースの4秒検出器が拾った可能性が高い。

根拠は次である。

- 全42件が `alpha=0.00`
- その後、操作不能や論理停止なしに自己解消した
- 帳簿違反、refill postcondition、orphanが0
- 深層連続走行でのみ一度発生した
- 層8直行では再現していない
- CPUスロットル下では壁時計とtween内部時計の進みが一致しない
- 現行実装は論理盤面を先に最終状態へ進めるため、「エンジンに駒があるが表示は予約待ち」が構造上発生する

ただし、次の観測は別問題として重い。

```text
repairStrandedAlpha: 0〜133
reconcile corrected: 2〜245
```

`repairStrandedAlpha` は「alpha writerが存在しない透明mapped Sprite」にだけ発火する。これは単なる予約待ちではない。したがって、42件バッチが検出器由来でも、現行表示系に本物の取り残しが残っていることは否定できない。

### 決定的な追加計測

幽霊検出時にセルごとに次を保存する。

```ts
{
  wallAgeMs,
  tweenAgeMs,
  tweenNow,
  timelineRemainingMs,
  viewQuiet,
  resolutionId,
  moveSeq,
  boardRevision,
  presentedRevision,
  spriteId,
  cell,
  boardKind,
  spriteKind,
  alpha,
  hasAlphaWriter,
  alphaWriterTag,
  alphaStartRemainingMs,
  alphaEndRemainingMs,
  hasPositionWriter,
  positionWriterTag,
  doomed,
  mapped,
  recentOps,
  documentVisibilityState
}
```

判定は次の三分類にする。

| 状態 | 解釈 |
|---|---|
| `hasAlphaWriter=true` かつ開始予定が未来 | 予約待ち。壁時計検出器の偽陽性 |
| `hasAlphaWriter=false` かつkind一致・mapped | 本物のstranded alpha |
| kind不一致、または `boardRevision > presentedRevision` | 論理と表示の先行差。C案が解消すべき構造症状 |

検出条件も二系統に分ける。

```text
A. wall detector:
   alpha < 0.5 が壁時計4秒

B. stable detector:
   view.isQuiet()になった後もalpha < 0.5が2回連続
```

Bだけが発火した場合を本物の幽霊とする。Aだけなら予約遅延である。

さらに、同一seed・同一入力列・同一スロットルで `ce31158` とHEADを最低20走ずつ比較する。層到達度ではなく、入力列を固定したpaired comparisonにする。

---

## 7. Phase4：`BoardView.playSegment()` への分割

### 7.1 API

```ts
interface MovePlayback {
  resolutionId: number
  moveSeq: number
  startedAt: number
  visibleFireCount: number
  fireGlobalBudget: number
  upgradeFireCounts: Map<string, number>
  aggregateFireCounts: Map<string, number>
  aggregateFireAt: Map<string, XY>
  goalFxCount: number
  disruptLabelCount: number
  previousChain: number
  nextChainEarliest: number
}

class BoardView {
  beginMove(resolutionId: number): MovePlayback

  playSegment(
    playback: MovePlayback,
    step: ResolutionStep,
  ): Promise<void>

  finishMove(
    playback: MovePlayback,
    finalSnapshot: BoardSnapshot,
  ): void

  renderStable(snapshot: BoardSnapshot): void
}
```

`moveSeq`、FX乱数seed、振動予算、全手共通の発火集約予算は `beginMove()` で一度だけ更新する。`playSegment()` ごとに更新してはいけない。

### 7.2 現行 `play()` の分解順

最初にロジックを次の四層へ機械的に分ける。

```text
beginMove()
  世代更新
  hint解除
  1手単位予算初期化

scheduleEvent()
  現行switchの各case

scheduleGravityTrain()
  fall/refillの列剛体化

finishSegment()
  board/cue writer完了待ち
  境界監査
```

legacyの `play(evs)` は当面、これらを呼ぶadapterとして残す。

```ts
play(evs) {
  const ctx = beginMove(...)
  for (const segment of segmentEvents(evs)) {
    scheduleSegmentLegacy(ctx, segment)
  }
  return legacyDuration
}
```

stepped経路だけが `await playSegment()` を使う。

### 7.3 Promise完了条件

`playSegment()` の完了は戻り値の推定durationだけで決めない。

条件は次のすべてとする。

- そのsegmentが作ったboard writerが完了
- そのsegmentが作ったcueが完了
- 着地callbackが作るscale/position復帰tweenも完了
- mapped/doomed台帳が境界状態に収束
- scene epochが有効

各tweenへ `resolutionId/segmentId` を持たせ、segment単位のpending writer数を数える方式が最も確実である。`channelEndMany()+200ms` は移行中のfallbackに留める。

FX粒子の余韻は待たなくてよい。駒Spriteや論理的な障害物に触れない `fx` のみ次segmentへ跨げる。

### 7.4 CHAIN_BEAT

現行の `CHAIN_BEAT` は、一括イベント列のローカル時刻 `t` に次の連鎖開始時刻を置くための仕組みである。逐次再生後は、前segmentをawaitするため、そのまま加算すると二重待ちになる。

新経路では「連鎖開始間隔の下限」として扱う。

```ts
nextChainEarliest =
  chainStartTweenClock + chainBeatFor(nextChain)
```

次のresolve segmentを始める時点で、

```ts
await max(
  previousSegmentCompletion,
  nextChainEarliest
)
```

とする。

つまり、落下が600ms以上かかった場合は追加待ちなし、短かった場合だけ拍を補う。7連鎖以降の逓減規則は維持する。

### 7.5 列剛体トレイン

列トレインはgravity segment内だけで完結させる。

- 同一gravity segmentのfall/refillを収集
- Spriteごとに最初のfromと最後のtoへcoalesce
- 同じSpriteへ複数のposition writerを作らない
- 最終到達列ごとに剛体トレインを作る
- refillは最終行順に上空へ1マス間隔で並べる
- segment完了時には全mapped Spriteを定位置へ戻す

現行の `startAt = segT + T.pop + stagger` の `T.pop` は、resolve segmentを既にawaitしているため原則不要になる。gravity側には列staggerだけを残す。

斜め移動や複数回fallを含む場合も、一つのgravity step内で同じSpriteへ複数tweenを予約しない。

### 7.6 T_HARD_CAP

全手一括の `T_HARD_CAP=5200` は撤去せず、移行中はlegacy専用として残す。

stepped経路では、予約列全体が数十秒先まで伸びること自体がなくなるため、次の二段予算に置き換える。

```text
segment budget:
  swap       400ms前後
  resolve    1200〜1600ms
  gravity    1200ms
  enemy      1500ms
  finish     個別仕様。勝利演出のみ長め

move quality budget:
  実再生が一定時間を超えたら、
  発火FXの間引き・ラベル集約・CHAIN_BEAT短縮を強める
```

segment cap到達後はイベントを落とさず、FX品質だけを集約する。盤面writerは必ず最後まで完了させる。

---

## 8. main.tsのイベント消費移行

### 8.1 消費者を三種類に分ける

#### A. segment再生中に必要な視覚消費

- `onGoalCollect`
- `onUpgradeFire`
- `onOxygenDrained`
- 盤面SE、飛翔、バウンス、被弾軌跡

これらは `playSegment()` のイベント時刻に合わせて発火する。

#### B. 手完了時にまとめてよい集計

- `movesThisFloor`
- `refillAmount`
- `lightSeries`
- `drainLog`
- `upgradeFireCount`
- `floorFireCount`
- `maxFiresInOneMove`
- postmortem用記録
- `floor-clear` / `run-over` の最終判定

これらはresolution全イベントを蓄積し、完了時に一度だけ処理してよい。むしろ二重計上防止のため、その方が安全である。

#### C. snapshotから再描画できる表示

- 酸素値
- 目標数値
- 進捗badge
- 敵intent
- その他の現在値HUD

通常完了時はsegmentごと、割込drain後はfinal snapshotから一括同期する。

### 8.2 推奨する移行形

現在の `handleFloorResult(evs)` を分ける。

```ts
interface MoveEventAccumulator {
  events: BoardEvent[]
  firesThisMove: number
  terminal: 'clear' | 'over' | null
}

function consumeSegment(
  acc: MoveEventAccumulator,
  step: ResolutionStep,
): void

function finalizeMove(
  acc: MoveEventAccumulator,
  finalSnapshot: BoardSnapshot,
): void
```

`consumeSegment()` は純粋な集計だけを行う。演出は `BoardView` が担当する。

`finalizeMove()` で次を一度だけ行う。

- 記録確定
- HUD最終同期
- `floorDecided` 更新
- floor clear / run over遷移
- queued inputを実行してよいか判定

「resolution完了時に全イベントをまとめて渡す」折衷は、Bの集計消費者には推奨する。一方、同じ全イベントを再度 `view.play()` へ渡してはいけない。

---

## 9. ResolutionCoordinator

### 9.1 基本形

```ts
class ResolutionCoordinator {
  private active: ActiveResolution | null = null
  private latestInput: Command | null = null

  submit(command: Command): void {
    if (this.active) {
      this.latestInput = command
      this.active.interruptRequested = true
      return
    }
    void this.run(command)
  }

  private async run(command: Command): Promise<void> {
    const resolution = createResolution(command)
    const playback = view.beginMove(...)
    const acc = createAccumulator()

    this.active = { resolution, playback, acc, interruptRequested: false }

    while (true) {
      const step = resolution.next()
      if (!step) break

      consumeSegment(acc, step)
      await view.playSegment(playback, step)

      if (this.active.interruptRequested) {
        const drained = resolution.drain()
        for (const skipped of drained.steps) consumeSegment(acc, skipped)

        view.renderStable(drained.finalSnapshot)
        break
      }
    }

    const finalSnapshot = board.snapshot()
    view.finishMove(playback, finalSnapshot)
    finalizeMove(acc, finalSnapshot)

    const terminal = acc.terminal
    const next = this.latestInput
    this.latestInput = null
    this.active = null

    if (!terminal && next) await this.run(next)
  }
}
```

### 9.2 割込規則

```text
入力到着
→ latest inputを上書き保存
→ 現segmentは最後まで再生
→ 残りエンジンstepを無演出drain
→ drainedイベントも集計へ渡す
→ renderStable(finalSnapshot)
→ 手完了処理
→ terminalでなければlatest input 1件を最終盤面で再評価
```

重要事項：

- 割込でdrainしたイベントを捨ててはいけない
- `floor-clear` / `run-over` はqueued inputより優先する
- queued swapは座標だけ保持し、元のPiece参照を保持しない
- 最新盤面で不正になった入力は通常のillegalまたはcancel規則で処理する
- 無制限queueは作らない
- scene破棄はユーザー割込と別扱いにし、epoch/abortで即終了できるようにする

---

## 10. whenBoardQuiet・idle healer・clear lifeline

### 10.1 `whenBoardQuiet`

legacy経路では残す。

stepped経路では、最後の `await playSegment()` または割込後の `renderStable()` が決着画面を出せる境界であるため、`whenBoardQuiet()` は使わない。

```text
legacy:
  dur + isQuiet poll + 6秒上限

stepped:
  coordinator finalize
  → 即 onFloorClear / showRunResult
```

### 10.2 idle healer

段階的に扱う。

1. legacy経路では現状維持
2. stepped経路では修復せず、2秒ごとの厳格assertだけにする
3. segment境界の `corrected=0` が十分な走行数で確認できたらticker登録自体を撤去する

stepped経路で `view.reconcile()` を定期実行すると、新設計の欠陥を隠すため禁止する。

### 10.3 clear lifeline

legacy経路では残す。

stepped経路では次を契約違反として診断する。

```ts
if (snapshot.won && !acc.events.some(e => e.t === 'floor-clear')) {
  report('missingFloorClear', ...)
}
```

ここから直接 `onFloorClear()` を呼んではいけない。Phase5.5のテストとエンジン修正で解消する。

### 10.4 reconcile / renderStable

移行順は次とする。

1. segment境界で `renderStable(snapshotAfter)` を呼び、修正件数を計測
2. stepped経路で修正0が安定したら、通常境界ではassert-onlyにする
3. `renderStable()` は割込drain、scene復帰、debug操作など明示的な再同期用途だけに残す
4. `repairStrandedAlpha()` は最後に削除し、debug assertへ置換する

---

## 11. フラグ戦略

モードは層開始時に固定し、1手の途中で切り替えない。

```ts
type ResolutionMode =
  | 'legacy'
  | 'segmented-batch'
  | 'stepped'
```

- `legacy`: 現行 `board.swap() → view.play(evs)`
- `segmented-batch`: boardは一括解決し、表示分割だけ検証する診断モード
- `stepped`: Phase5.5 + coordinatorの本命経路

`segmented-batch` はPhase4の見た目比較には有用だが、論理盤面が先行するため本番の最終形にはしない。

推奨展開順：

1. 既定値legacy
2. `?resolution=segmented` を開発者向けに追加
3. `?resolution=stepped` を追加
4. CIでlegacy/stepped双方のcore・coordinatorテスト
5. QAハーネスをsteppedへ
6. steppedで固定seed深層走行
7. 既定値をsteppedへ変更
8. 1リリース分は `?resolution=legacy` のkill switchを残す
9. 問題がなければlegacyの予約圧縮・quiet healer・lifelineを削除

同じBoardインスタンスへ旧経路と新経路を同時適用するshadow executionは禁止する。比較する場合は、完全に独立した双子BoardとRunStateを使用する。

---

## 12. テスト計画

### Core

- 旧goldenとのイベント・全状態比較
- 全step flatten一致
- revision単調増加
- `snapshotAfter` 一致
- stepのイベントが空でない
- `next×N → drain` 全境界
- tap / combo / special / spore / enemy / boss / clear / over
- 固定seed長時間property test

### View

- `playSegment()` 完了時に駒board writerが0
- 各境界で厳格帳簿監査0
- refill占有fallback 0
- stale callback 0
- multi-writer 0
- gravity segmentで1 Sprite/1 property/1 writer
- segmentごとの最大所要時間
- scene破棄時にPromiseが残留しない

### Coordinator

- 通常逐次進行
- segment中に1回割込
- segment中に複数入力しlatestだけ残る
- drainイベントも集計される
- drain中のfloor-clearがqueued inputより優先
- queued inputが最終盤面で再評価される
- illegal入力
- scene破棄
- legacyとsteppedの最終状態・集計一致

### 実機検収条件

stepped経路の合格条件を次とする。

```text
固定seed 100手以上
CPU 1x / 4x
入力間隔 0 / 50 / 100 / 200ms

ledger violation       0
refill postcondition   0
occupied refill        0
stale callback         0
piece multi-writer     0
repair alpha           0
orphan                 0
boundary corrected     0
missing floor-clear    0
stable ghost           0
```

---

## 13. 最終判定

| Phase | 判定 | 備考 |
|---|---|---|
| Phase1 | 条件付き合格 | 時間窓判定は正しい。境界用の厳格監査とwriter詳細計測を追加する |
| Phase2 | 合格 | 所有権変更点は集約できた。debug preconditionを追加する |
| Phase3 | 合格 | 分類器として使用。エンジン停止境界の正本にはしない |
| Phase5 | 条件付き合格 | 同期互換性は良いが、Phase6用step契約と実停止境界が不足 |
| 42件幽霊 | 退行認定せず | 予約待ちの可能性が高い。tween時計・writer・revisionを同時記録して確定する |
| Phase4/6着手 | Phase5.5後に可 | `ResolutionStep + snapshot + revision` を先に完成させる |

C案の狙いは、修復機構を増やすことではなく、「エンジンが次へ進む時点」と「表示がその状態へ到達した時点」を同じ境界にすることである。Phase4/6では、`reconcile corrected === 0` を結果ではなく設計契約として扱う。
