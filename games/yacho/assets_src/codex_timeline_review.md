
codex
## 結論

【確度：高】「透明な駒が数十秒先の補充演出を待っている」という根因仮説は、コードと一致します。ただし概算の `22×600 + 260×160` は厳密な実行時間ではなく、安全側の上限に近い計算です。実際は各連鎖区間について概ね `max(600ms, 区間内の発火累積)` になります。それでも260発火なら数十秒級になり得るため、症状の説明として十分成立します。

対策は A/B/C の方向でよいですが、以下の修正が必要です。

- Aは独立した漸減ルールではなく、全イベントで共有するハード予算にする。
- special-fireを連鎖拍へ加算せず、連鎖セグメント内のサブ拍として配置する。
- 24発以降も `fireFx()` を全部同拍生成するのは危険。描画・音・振動そのものを集約・間引きする。
- Bの `channelEnd()` は有効。ただしreconcile予約自身や後処理timerを計測対象から除外する。
- Cを `play()` 冒頭だけで走らせても「待っているユーザー」は救えない。channel idle/reconcile時にも走らせる。
- 現在の `compressChannel('board')` はSE・発火FX・振動と同期していません。A導入と同時に是正が必要です。

## 1. 根因のコード裏取り

### `t` の増大

【確度：高】連鎖段が上がると、前の段の開始から最低600msを確保しています。

[BoardView.ts:1970](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1970)

```ts
if (e.chain > 1) t = Math.max(t, chainStartT + CHAIN_BEAT)
chainStartT = t
```

したがって600msは無条件加算ではなく、特殊発火などで既に600ms以上進んでいれば追加されません。厳密には各段で次の形です。

```text
次段開始 = max(現在のt, 前段開始 + 600ms)
```

一方、特殊駒は発火ごとに確実に160msを加算します。

[BoardView.ts:1985](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1985)

```ts
sfx.fire(e.piece.kind, t / 1000)
...
t += hitstop.request(t, 45)
t += 160
```

【確度：高】260発なら、special-fireだけで最低41.6秒です。歯車爆弾等のヒットストップ、swap、explode、enemy-defeatedなども加わります。

ヒットストップは600ms窓あたり80msに制限されていますが、タイムライン全体が長くなれば窓が更新されるため、1手全体で80msが上限ではありません。

[BoardView.ts:82](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:82)

### `match` / `special-fire` / `win-drain`

【確度：高】

- `match`: 新しい連鎖段に最低600ms間隔。
- `special-fire`: 1発160ms＋一部ヒットストップ。
- `win-drain`: 1イベント45ms。
- `explode`: 200ms＋ヒットストップ。
- `enemy-defeated`: 通常200ms。

`win-drain`も残手数が多い場合は無視できません。

[BoardView.ts:1999](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1999)

```ts
sfx.drain(this.drainCount++, t / 1000)
t += 45
```

### 補充駒が透明で待つ経路

【確度：高】通常補充は即座に `sprites` mapへ登録されたあと、盤外・`alpha=0` にされます。

[BoardView.ts:353](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:353)  
[BoardView.ts:2138](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2138)

```ts
const sp = this.makePiece(...)
sp.position.y = -this.S * 1.2
sp.alpha = 0
const trainKey = `${t}|${e.at.x}`
```

イベント走査後、その時点の `t` を `segT` として補充開始が予約されます。

[BoardView.ts:2448](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2448)

```ts
const startAt = segT + T.pop + colStagger
tween(it.sp, { alpha: 1 }, 80, { delay: startAt })
tween(it.sp.position, ..., { delay: startAt })
```

したがって `segT` が40秒なら、補充駒は40秒間map上に存在しながら透明・盤外です。報告症状と直接一致します。

同じ待機構造は `special-born` とリロールのクロスフェードにもあります。

[BoardView.ts:2020](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2020)  
[BoardView.ts:2140](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2140)

### reconcileが遅れる経路

【確度：高】`timelineEndAbs` は過去値との `Math.max` で単調増加し、圧縮後も短縮されません。

[BoardView.ts:2502](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2502)

```ts
this.timelineEndAbs = Math.max(this.timelineEndAbs, nowMs + total)
delay(this.timelineEndAbs - nowMs + 200, ...)
```

さらに `isQuiet()` も同じ値だけを見ています。

[BoardView.ts:1805](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1805)

そのため次の影響が連動します。

- reconcileが遅れる
- アイドルヒントが遅れる
- 勝敗・層クリア画面が遅れる
- 圧縮後も「盤面が静かでない」判定が古い終端まで残る

## 2. A/B/Cの設計レビュー

### A. タイムライン予算

【確度：高】導入すべきです。ただし提示ルールは「4秒上限」を保証していません。

最初の6連鎖を一定600msにすると、chain 1から6までは5区間＝3秒です。その後16段を下限80msで刻むだけでも1.28秒。swapを加えると、special-fireがゼロでも約4.43秒です。

さらに、

```text
最初の8発 × 160ms = 1.28秒
次の16発 × 40ms = 0.64秒
```

を独立加算すれば、容易に6秒を超えます。

推奨は、連鎖と発火を別々に加算するのではなく、次の二階建てです。

1. 連鎖段が主時計を決める。
2. special-fireはその連鎖段の中のサブ拍へ配置する。

つまり、特殊発火が何十件あっても次の連鎖開始を無制限に後ろへ押さない設計です。

【確度：高】24発以降を「同拍」にするだけではCPU負荷が集中します。現在は各イベントで必ず `fireFx()` と `sfx.fire()` が呼ばれます。260件を同時刻へ寄せると、透明問題が「一瞬のフリーズ・爆音・大量AudioNode生成」に変わります。

24発以降は以下をすべきです。

- `fireFx` 自体を省略・空間集約する
- 同種特殊駒は1つの強化版FXにまとめる
- SEは同拍あたり最大1〜2音
- 振動は既存予算に加えて同拍1回
- 状態更新と `popPieceAt` は維持する
- 集約数を `×17` 等の表示へ変換する

### 正典との関係

【確度：中〜高】JUICEの一定拍を単純に破るのではなく、「通常域」と「暴走域」の境界を明文化する案に賛成です。

[JUICE.md:13](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/JUICE.md:13)

おすすめの記述は「連鎖が深いほど常時加速」ではなく、次です。

> 1〜6連鎖では600msの一定拍を守る。視覚予算を超える異常密度では、因果を失わない範囲で複数イベントを要約拍へ束ねる。

「加速」より「要約・バッチ化」と定義する方が正典との矛盾が小さいです。

### AudioContextとの同期

【確度：高】ここはAと同時修正が必要です。

`sfx.pop/fire/drain/born/block` は `play()` のイベント走査中に呼ばれ、`AudioContext.currentTime + t/1000` へ即時予約されます。

[sound.ts:34](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/sound.ts:34)

一度予約したAudioNodeは、後から `compressChannel()` しても時刻を変更できません。

さらに現状は、

- 盤面Tween: `board`
- fireFx、火花、振動: 主に `fx`
- 音: AudioContext絶対時刻

となっており、`board`だけ0.45倍にしています。

[BoardView.ts:1879](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1879)  
[tween.ts:143](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/tween.ts:143)

したがって割込時には、盤面だけ先に進み、FX・振動・SEは元の時刻に残ります。

最小で安全な修正は、長い絶対時刻予約を止めることです。

```ts
delay(at, () => sfx.fire(kind), 'cue')
```

のようにTween時計側で発火時刻まで待ち、実際のSEはdelayなしで鳴らします。`cue`を盤面と同じ係数で圧縮すれば同期を保てます。FXの「生成待ち」も `cue`、生成後のフェード余韻だけを `fx` にすると整理しやすいです。

### B. `channelEnd('board')`

【確度：高】方向は正しいです。圧縮後の実際の残時間を再計算できるため、単調増加する `timelineEndAbs` より適切です。

Tweenの残時間は概ね次です。

```ts
tw.t < 0
  ? Math.max(0, tw.delay) + tw.dur
  : Math.max(0, tw.dur - tw.t)
```

ただし罠があります。

【確度：高】reconcile予約自身を`board`に入れてから `channelEnd('board')` を取ると、自分自身が終端を延長します。また現在の以下も既定で`board`です。

- `delay(total, updateIntentBadges)`
- `delay(total + 200, rampage解除)`
- reconcile timer
- `delay()`コールバックから後続Tweenを生成する処理

そのためチャンネルを最低限分離してください。

- `board`: 駒の状態・位置・透明度
- `cue`: 発火前のFX/SE/振動予約
- `fx`: 発火後の破棄可能な余韻
- `housekeeping`: reconcile、カウンター消去、フラグ解除

終端は `max(channelEnd('board'), channelEnd('cue'))`。reconcile timer自身は`housekeeping`へ置きます。

【確度：中】`channelEnd()`は、遅延コールバックが将来生成するTweenの長さまでは予知できません。現在も落下完了後に52ms＋110msの着地Tweenを生成します。ただし+200msバッファがこれをほぼ吸収します。将来200msを超える後続Tweenを追加すると再発するため、テストか「board上のonDone子Tweenは最大180ms」の規約が必要です。

より堅牢にするなら、`channelEnd`の固定時刻予約より「board/cueが空になった状態が200ms続いたらreconcile」というidle debounceが最終形です。

### C. alpha watchdog

【確度：高】保険としては妥当ですが、`play()`冒頭だけでは不十分です。ユーザーが次の入力をしなければ永久に走りません。

推奨実行点は以下です。

- `play()`冒頭
- board/cue idle時
- reconcile直前

【確度：高】現在の `hasTween(obj)` では「アルファ系Tweenだけ」を判定できません。

[tween.ts:124](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/tween.ts:124)

`hasTweenProperty(obj, 'alpha')` を追加してください。単なる `hasTween(sp)` だとrotation Tweenだけ残っている透明駒まで除外してしまいます。

修復条件は次が安全です。

```text
sprites mapに登録済み
destroyされていない
doomedではない
エンジン上もそのセルに同じkindの駒が存在
alpha < 0.999
alphaを対象とする生Tweenがない
```

発生時は必ずログを残してください。Bのreconcileは最終的に `alpha=1` へ直すので、Cは通常動作では一度も発火しないのが理想です。

## 3. 推奨予算

【確度：中】以下を初期値として推奨します。

| 項目 | 推奨 |
|---|---:|
| 通常域 | chain 1〜6を600ms |
| 暴走域の連鎖間隔 | 300 → 200 → 120 → 80ms |
| 最終イベント開始のソフト上限 | 4.5秒 |
| 盤面状態の静止目標 | 5.2秒 |
| 強制reconcile fallback | 5.5秒 |
| special-fire高品質表示 | 最初の8発 |
| 簡略表示 | 9〜24発 |
| 24発以降 | 種類・位置ごとに集約 |
| win-drain | 最初の10件45ms、以降20ms、全体700ms上限 |

4秒を厳密上限にするなら、chain 7以降の全段表示は不可能です。連鎖カウンターを `10 → 14 → 18 → 22` のような要約更新にする必要があります。

「応答は速く、鑑賞はゆっくり」という観点では、

- 入力反応・swapは即時
- 通常6連鎖まではゆっくり読ませる
- 暴走域は因果の代表点だけ見せる
- 決着画面は最大5〜5.5秒で必ず出す

という分離が適切です。

## 4. 最小diffの実装順

1. [tween.ts:124](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/juice/tween.ts:124)

   - `hasTweenProperty(obj, key)` を追加。
   - `channelEnd(channel)` を追加。
   - 必要なら `channelEndMany(['board', 'cue'])` を追加。

2. [BoardView.ts:68](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:68)

   - `EXTREME_CHAIN_START = 7`
   - `CORE_ONSET_BUDGET = 4500`
   - `QUIET_FALLBACK = 5500`
   - fire表示上限を定数化。
   - 小さな `TimelineBudget`/`ReactionDirector` を追加。

3. [BoardView.ts:1898](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1898)

   - `chainStartT`に加えて `fireInSegment`、`visibleFireCount` を持つ。
   - `special-fire`の160msを無条件でグローバル`t`へ足す処理を廃止。
   - segment内offsetとして算出する。

4. [BoardView.ts:1970](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1970)

   - chain 1〜6は600ms。
   - 7以降は300/200/120/80ms。
   - 4.5秒以降は連鎖表示を要約する。

5. [BoardView.ts:1985](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1985)

   - 1〜8発は通常。
   - 9〜24発は簡略FX。
   - 25発以降は `fireFx`、SE、振動をイベントごとには生成しない。
   - cleared駒の状態反映は維持。

6. [BoardView.ts:1976](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1976)

   - `sfx.*(..., t/1000)` を、Tween時計での遅延呼び出しへ変更。
   - pop/fire/drain/born/block/sporeを同じ規約へ揃える。
   - cue予約とboard予約を一緒に圧縮する。

7. [BoardView.ts:1888](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:1888)

   - 暫定的に圧縮を外すか、`board`と`cue`を同時圧縮。
   - 現状の「boardだけ圧縮」は残さない。

8. [BoardView.ts:2484](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2484)

   - housekeeping timerを別チャンネルへ移す。
   - `timelineEndAbs = now() + max(channelEnd(board), channelEnd(cue))` に置換。
   - 可能なら `isQuiet()`も実際のchannel残時間を見る。

9. [BoardView.ts:2511](C:/Users/kanedomi/Desktop/Claude/playlab/games/yacho/src/view/BoardView.ts:2511)

   - `repairStrandedAlpha()`をreconcile前またはidle時に実行。
   - 発火時はセル、kind、alpha、残Tween情報をログ出力。

最優先は「Aの共有予算＋24発以降のFX集約」と「Audio/FXを含む時刻同期」です。Bで自己修復の遅延を解消し、Cは原因の隠蔽ではなく異常検出付きの最後の保険に留めるのがよい設計です。
