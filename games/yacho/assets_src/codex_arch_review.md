
codex
正典原稿は完成しましたが、ワークスペースが読み取り専用のため `games/yacho/assets_src/codex_architecture_root_review.md` への書き込みは拒否されました。以下が配置予定のレビュー要旨です。

# 盤面表示アーキテクチャ根本レビュー

## 結論

推奨は **C「エンジンの段階的解決」** です。

A「セル占有API」は移行の足場として先行導入し、B「状態駆動」は毎フレームではなく、各解決セグメントの境界で採用します。

現行の根因は個別のalpha処理ではありません。

- エンジンはswapから連鎖、補充、敵ターンまで同期的に完了します。  
  [board.ts:378](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/core/board.ts:378)、[board.ts:866](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/core/board.ts:866)

- ビューは確定済みイベント列を未来へ予約します。  
  [BoardView.ts:1945](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1945)

- 通常入力は `view.isQuiet()` を待たず、次の `board.swap()` / `tap()` を実行します。  
  [main.ts:2545](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/main.ts:2545)

つまり通常運用で以下が一致しません。

```text
見えている盤面
≠ 次入力が作用するエンジン盤面
≠ 古い予約が想定する盤面
```

さらに、Spriteの所有権が `sprites`、`doomedByCell`、`pieceLayer.children`、tween内部へ分散しています。  
[BoardView.ts:165](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:165)、[BoardView.ts:1832](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1832)

特に危険なのは、`snap()` が旧tweenの `onDone` を同期発火する点です。  
[tween.ts:83](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/tween.ts:83)

旧落下をsnapすると、その場で着地バウンスが新規生成されます。その直後、新手も同じ `position` にtweenを張れます。  
[BoardView.ts:2596](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2596)

tween基盤は同一object/propertyへの複数writerを禁止していません。  
[tween.ts:53](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/tween.ts:53)、[tween.ts:222](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/tween.ts:222)

これが最優先で観測すべき上流競合です。

## 1. 多角デバッグ計画

優先順は以下です。

1. Spriteに安定IDと所有権履歴を付ける

   `makePiece()` で `spriteId / bornMoveSeq / bornEventIndex / pieceKey` を記録します。`sprites.set/delete`、doomed追加・削除、destroyの直近16操作をring bufferに残します。

   `repairStrandedAlpha()` 発動時は、セルとkindだけでなく、個体ID、所有者、live tween、履歴を一括出力します。現行ログでは個体追跡ができません。  
   [BoardView.ts:398](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:398)、[BoardView.ts:1855](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1855)

   ```ts
   console.assert(ownerCount(sp) === 1, 'piece owner invariant', dump(sp))
   ```

2. tweenの単一writer不変量

   開発時だけ各tweenに `ownerTag`、例 `m12/e84/refill-alpha` を持たせます。

   ```ts
   console.assert(
     writers(obj, property).length <= 1,
     'multi-writer',
     writers(obj, property),
   )
   ```

   最初は `alpha`、`position.x/y`、`scale.x/y` に限定します。`snap/snapSoft/cancel/onDone/例外drop` も構造化ログを出します。

3. refill予約直後のpostcondition

   列トレイン構築直後に、この `play()` で生成した全refill駒を検査します。  
   [BoardView.ts:2576](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2576)

   ```ts
   console.assert(
     sp.alpha >= .999 || hasTweenProperty(sp, 'alpha'),
     'refill lost alpha writer',
     dump(sp),
   )

   console.assert(
     atTarget(sp, cell) ||
       hasTweenProperty(sp.position, 'x') ||
       hasTweenProperty(sp.position, 'y'),
     'refill lost position writer',
     dump(sp),
   )
   ```

   ここで落ちれば予約構築の欠落。ここを通って次の `play()` 冒頭で落ちれば、割込・snap・callback競合です。

4. BoardEventの影盤面reducer

   `play()` 冒頭の表示帳簿をコピーし、イベントを純粋reducerへ1件ずつ適用します。各イベント後に `sprites` と比較し、最後にのみエンジン最終状態と比較します。

   これで「イベント不足・順序不備」と「ビュー適用ミス」を分離できます。

   現在は通常補充とリロールがどちらも `refill` で、ビューが「既存Spriteがあるか」から意味を推測しています。  
   [board.ts:229](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/core/board.ts:229)、[BoardView.ts:2264](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2264)

5. 3帳簿の全単射チェック

   `play()` 冒頭・末尾・reconcile前後で検査します。

   - 生存するpieceLayer子は、mapped XOR doomedの一方だけに属する
   - 1 Spriteを複数セルが参照しない
   - mapped Spriteのkindが影盤面と一致する
   - doomedは必ずdestroy経路を持つ
   - parentは必ずpieceLayer

   現行の孤児掃除は「どの帳簿にもなく、tweenもない」個体しか拾えません。  
   [BoardView.ts:1835](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1835)

6. 世代付きcallbackチェック

   盤面Spriteを操作する全 `onDone` に `scheduledMoveSeq` と `spriteId` を捕捉させます。

   古い世代のcallbackが、現在mappedのSpriteに子tweenを追加したらassertします。終端reconcileには世代guardがありますが、落下着地callbackにはありません。  
   [BoardView.ts:2620](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2620)、[BoardView.ts:2596](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2596)

7. 決定的再現と二分スイッチ

   固定seed、CPU 1×/5×、入力間隔0/50/100/200msで試験します。既存のデバッグ配置も利用できます。  
   [main.ts:2492](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/main.ts:2492)

   診断スイッチ：

   - 割込禁止
   - `snap()` のonDone抑止
   - 旧世代callbackの子tween生成抑止
   - refillを即時alpha=1・定位置
   - rerollを専用イベントへ分離

## 2. 代替案比較

| 案 | 移行コスト | 構造的効果 | 主リスク | JUICE |
|---|---:|---|---|---|
| A. 予約＋セル占有API | 中 | 所有権漏れ・上書き・二重destroyを抑止 | 最終盤面先行と新旧timeline合成は残る | 既存演出を温存しやすい |
| B. 毎フレーム状態駆動 | 高 | 静止状態では表示=状態を強制 | 最終Boardを参照すると連鎖途中が即消える。presentation stateを持つと二重状態へ戻る | 落下・溜め・誕生を保つには追加設計が必要 |
| C. 段階的解決 | 高、ただし分割可能 | 表示境界と論理境界が一致 | hook、敵ターン、RNG順序の回帰リスク | セグメント内の既存演出をほぼ温存可能 |

B単独では不十分です。現行 `resolveCascades()` は全連鎖をwhileで完了させるため、状態を毎フレーム描くだけでは途中経過が存在しません。  
[board.ts:866](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/core/board.ts:866)

途中を見せるには、結局エンジンstep化か、別presentation stateが必要です。後者は現行問題を形を変えて残します。

## 3. 推奨する段階的移行

1. 計器化

   上記assertを導入し、修復前に必ずdumpします。

   検証：固定seedで100手以上、CPU 5×、50ms連打。`repairStrandedAlpha` の通常発火ゼロを基準にします。

2. Aを移行用の足場として導入

   `PiecePresenter.spawn/move/retire/replace/reconcileCell` にSprite所有権を集約します。予約方式と見た目はまだ変えません。

   検証：gateway外の `sprites.set/delete` をgrepでゼロにし、所有権assertもゼロにします。

3. イベントをSegmentへ束ねる

   まずエンジン挙動を変えず、イベント列を以下へ分類します。

   ```text
   SwapSegment
   ResolveSegment
   GravitySegment
   EnemySegment
   FinishSegment
   ```

   各Segmentは `beforeRevision / afterRevision / events / snapshotAfter` を持ちます。`reroll` は `refill` から分離します。

   検証：全Segmentをflattenしたイベント列が旧イベント列と一致すること。

4. ビューを `playSegment()` へ分割

   盤面所有tweenはセグメント内で完了させます。破片、光、音など所有権を持たない余韻のみ次Segmentへ跨がせます。

   検証：各境界で `reconcile corrected === 0` を必須にします。

5. エンジンを停止可能なResolutionへ変更

   推奨状態機械：

   ```text
   AfterCommand
      → ResolveMatch
      → ApplyGravity
      → Refill
      → CheckStable
      → AfterMove
      → EnemyTurn
      → Done
   ```

   既存 `swap()/tap()` はResolutionを最後までdrainする互換adapterとして残します。

   検証：旧実装と新drainについて、最終cells、RNG状態、score、goals、enemy、run state、イベント列をdifferential testします。

6. `ResolutionCoordinator` に入力を集約

   `main.ts` はBoardを直接呼ばず、`coordinator.submit(command)` のみ呼びます。

   通常時：

   ```text
   next segment → await view.playSegment → next
   ```

   割込時：

   ```text
   現在の表示Segmentをfinish
   → エンジン残段を無演出drain
   → renderStable(finalSnapshot)
   → 新入力を評価
   ```

   入力ロックは不要です。ただし無制限queueではなく、latest inputを1件だけ保持します。

7. 境界状態駆動へ移行

   各Segment完了時は `renderStable(snapshot)` でセル→Sprite写像を保証します。2リリース分、全assertと修復発火がゼロなら保険を撤去します。

## 4. 撤去できる対症

| 対症 | 判断 |
|---|---|
| doomed台帳 / `snapDoomedAt` | Phase 3〜5後に撤去 |
| 選択的snap / `moveTouched` | Phase 5後に撤去 |
| 幽霊掃除 `sweepOrphans` | Presenter単一所有権の完成後に撤去 |
| 列剛体 | **温存**。バグ保険ではなく、追越し防止と落下JUICEの仕様 |
| 前手の時間圧縮 | Phase 5後に撤去 |
| 連鎖拍・発火集約予算 | 演出品質・負荷制御として温存 |
| 全イベント共有5.2秒cap | Segment化後に撤去。各Segmentへ短い上限を置く |
| `timelineEndAbs` と終端reconcile予約 | `await playSegment()` 移行後に撤去 |
| `repairStrandedAlpha` | Phase 6後に修復からassertへ変更 |
| 静止時2秒reconcile | Phase 6後に撤去。[main.ts:2437](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/main.ts:2437) |

最終的な完了条件は次の4点です。

1. 入力評価時に表示revisionとBoard revisionが一致する。
2. 盤面Spriteは常に単一所有で、同一propertyのwriterは最大1本。
3. 全Segment境界でreconcile差分ゼロ。
4. 固定seed連打試験でalpha修復、orphan、multi-writer、owner違反がすべてゼロ。

書き込み可能な状態になれば、上記を `games/yacho/assets_src/codex_architecture_root_review.md` としてそのまま配置できます。
