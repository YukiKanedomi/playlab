# 決定

盤面は **v5「採集箱枠 × 蝋引き帆布」案を既定採用**する。現行の石枠盤面は廃止する。

アプリ全体の統一ADを、次の一文で固定する。

> **探窟家が携行する採集箱・測量器・野帳が、探索の進行に応じて記録され、押印され、製本されていく世界。**

背景画と探窟家バストは「現地」、盤面とHUDは「携行道具」、採録・祝福・結果は「記録物」として整理する。装飾を増やすのではなく、木・真鍮・帆布・革・古紙の役割を固定し、全画面を同じ道具箱から作られたように統一する。

現行駒 `assets/sprites3`、探窟家バスト、各テーマ背景は変更しない。

---

## 1. 盤面v5の最終採否

### 結論

v5を採用する。

現行盤面は背景との馴染みはあるが、「苔むした遺跡の床」に駒を直接置いた印象が強く、HUDや採録帖との共通言語を作れない。v5は携帯採集箱として意味が通り、駒を「採集物」として扱えるため、ゲーム固有の顔になる。

ただし、現状のv5をそのまま既定化してはならない。枠が重く、盤面内が暗く、目地が強いため、駒より箱が先に見える。

### v5最終調整値

- 外枠の見かけ幅を現状比 **70〜75%** にする。
- 透明窓のインセット比はおおむね以下へ変更する。
  - 左 `6.4%`
  - 右 `7.0%`
  - 上 `6.8%`
  - 下 `7.4%`
- `drawStaticV5()` の追加食い込み `inset` は `S * 0.06` から **`S * 0.03`** へ下げる。
- 帆布面の平均明度を現状より **12〜15%上げる**。
- 帆布の基準色は `#342C23`、セル差は明度±3%以内とする。
- 目地は `#15120F`、見かけ不透明度 **35〜42%**、幅は実機で **0.75〜1 CSS px**。
- 市松模様は禁止する。セル差は織り、擦れ、染みの個体差だけで作る。
- 木枠の金色ハイライトを抑え、真鍮角金具だけを高明度にする。
- 革ベルト、緑青、傷は外周だけに置き、盤面内へ侵入させない。
- 駒の占有率は変更しない。枠と地面を駒に従属させる。

### コード上の決定

`BoardView.ts` の比較フラグは廃止し、v5を通常経路にする。

```ts
const BOARD_V5 = true
```

最終確認後は分岐そのものを削除し、`drawStaticV5()` を `drawStatic()` の正規実装へ統合する。`?board=v5` は不要になる。

---

## 2. 全画面診断

## 2.1 拠点・深度図

商業品質に届いていない最大の理由は、背景、ノード、経路、CTAが同じ空間に属していないことにある。

- 背景が地図ではなく縦長壁紙として使われている。
- ノードは真鍮の測量印ではなく、大型のステージメダルに見える。
- 全ノードがほぼ同じ重量で、現在地、踏破済み、次地点、未到達の差が弱い。
- 現在地に脈動輪、番号メダル、肖像ピンが重なり、意味の異なる円が多すぎる。
- 点線経路が均一なUI線で、背景内の足場や裂け目と関係していない。
- `探窟へ` が画面中央を横断し、ノード3と経路を隠している。
- 最深記録よりCTAが極端に大きく、情報階層が逆転している。
- ビルド番号のプラークが世界内情報に見える。開発ビルドのみ表示する条件へ限定すべきである。

### 修正方針

深度図を「ステージ選択」ではなく「測量記録」にする。

- ノード径を現在の `vw * 0.13` から **`vw * 0.085〜0.095`** へ縮小。
- ノードは真鍮ピン＋墨の深度印とし、番号を主役にする。
- 現在地だけ肖像ピンを持ち、脈動輪は1本に限定する。
- 踏破済みは赤茶の押印、未到達は鉛筆輪郭、次地点は琥珀のピンで区別する。
- 経路は細い破線から、濃淡のある測量線へ変更する。
- CTAは中央から撤去し、画面下部の固定ドックへ移動する。
- CTA幅は **画面幅76%**、高さ **56〜60px**。ノードや経路を覆わない。
- 最深記録は右上の独立プラークではなく、上部の小さな野帳見出しへ統合する。

---

## 2.2 プレイ画面・現行盤面

現行盤面はv5より背景に埋もれ、盤面の所有物としての意味が弱い。盤の石枠、HUDの真鍮、目標票のクリーム紙、下部の丸い知見アイコンが別々のUIキットに見える。

- 盤面と背景の境界が曖昧。
- HUDの深度、油槽、メニューで輪郭線・真鍮色・立体感が揃っていない。
- 目標票の角丸が強く、生成り色の一般的なCSSカードに見える。
- 探窟家バストの下端フェードは改善されているが、目標票と盤面の間で押し込まれている。
- 下部の知見アイコンと採録帖ボタンに、共通の台座がない。
- 盤面が暗いため紫の遺物と目地が接近し、視認性が落ちる。

v5の微調整とHUD再統一により、この画面を全体の基準画面とする。

---

## 2.3 プレイ画面・v5

方向性は正しい。商業品質へ届かない部分は主に重量配分である。

- 木枠が厚く、盤面より高価な箱そのものが主役になっている。
- 上下の木板が広く、390×844ではプレイ領域を圧迫する。
- マス地が黒に近く、現行駒の暗い輪郭と競合する。
- 目地が均一かつ明瞭で、帆布よりタイルに見える。
- 革ベルトと緑青角金具の情報量が四隅へ集中しすぎる。
- HUD側は旧素材体系のままなので、盤面だけを交換した試作感が残る。

枠を細くし、盤内を明るくし、HUD・ボタン・紙票を同じ素材体系へ展開すれば正典になる。

---

## 2.4 層クリア・採録帯

現状で最も「生テキストを仮の矩形に置いた」印象が強い。

- 画面幅いっぱいの無地クリーム矩形が、背景と盤面を水平に切断している。
- 紙端、繊維、折れ、留め具、紙影がない。
- `深度1 踏破`、`この層 0手`、`灯 +12 → 残灯56` が同じ大きさに近く、読み順がない。
- 390px幅に対して文字が大きく、記録ではなく警告ダイアログに見える。
- 補給結果が紙上の文章で完結し、上部油槽へ加算される演出と視覚的につながらない。
- `タップで次へ` が盤面上に裸で置かれている。
- 帯が画面全幅を使うため、薄い紙片ではなくWebの通知バーに見える。

### 最終形

画面中央やや下へ差し込まれる、幅 **86%**、高さ **132〜148px** の破り取り式記録票にする。

情報階層は次の順に固定する。

1. 左上：小さな `踏破記録`
2. 中央：大きな `深度N`
3. 右上：朱の `踏破` 印
4. 下段左：`N手`
5. 下段右：`灯 +N`
6. 最下段：最多発火知見。存在しない場合は行ごと消す

`残灯56` は記録票へ重複表示せず、油槽の数字が増えることで示す。記録票から琥珀光が上部油槽へ移動し、数字が確定する。

`タップで次へ` は紙片下辺の小さな墨色注記に統合する。

---

## 2.5 採録・知見ドラフト

情報設計は以前より大幅に改善されているが、視覚的には依然として設定画面である。

- 3枚とも同じ大きなクリーム角丸カードで、量産されたWebカードに見える。
- 紙面が均一で、標本、機械図、異種知見の差が出ていない。
- 枠線が均一な黄色で、紙の厚みや留め方がない。
- カード間の余白が狭く、長いスクロールリストに見える。
- 背景暗転が強く、現地から完全に別モーダルへ移動した印象になる。
- `おすすめ` が一般的な黄色タグで、世界観内の記録印に見えない。
- 下部の無効ボタンが大きく、選択肢より先に目へ入る。
- `採録帖` ボタンは盤面側と同形でなく、独立したCSSボタンになっている。
- タイトル、手持ち、一覧、行為タブ、カード、確定ボタンの装飾密度が均一である。

### 最終形

カードではなく「野帳へ挟んだ標本票」として扱う。

3種類の紙型を用意する。

- 植物・菌類：繊維の見える標本紙、糸留め、淡い緑の分類線
- 鉱物・機械：方眼入りの青灰紙、真鍮クリップ、断面図用の細罫
- 遺物・異種：端が濃い薄紙、朱印、重ね貼りされた小片

文字領域とヒット領域は共通のまま維持し、紙型だけを候補カテゴリに応じて切り替える。

選択状態は金色の太枠ではなく、以下の3点で示す。

- 紙が上へ4px持ち上がる
- 左上へ小さな真鍮クリップが付く
- `採録候補` の朱印が現れる

---

## 2.6 採録帖ボタン直後の画面

画像上では、採録帖を押した結果として何が開いたのかが伝わらない。盤面がそのまま残り、下部の葉アイコンと採録帖ボタンも通常状態のままである。

- 押下前後の状態差が弱い。
- 採録帖が画面遷移なのか、選択中の知見なのか、単なる説明ボタンなのか読めない。
- 下部アイコン群に台座と見出しがなく、所持知見と操作ボタンが混在している。
- 採録帖ボタンが単独で右下に浮いている。

### 最終形

採録帖は「下から革表紙の野帳が開く」共通ボトムシートに統一する。

- 背景は完全暗転させず `#131A18` の55〜62%。
- シート上端に革の見返しを8〜12px見せる。
- 紙面は画面高の72〜78%。
- 開いた直後にタイトル、分類、アイコンがファーストビューへ入る。
- 閉じる操作は右上の小さな真鍮タブに固定する。
- 盤面下部は「所持知見ドック」として薄い革帯でまとめ、採録帖ボタンを同じ帯の右端へ収める。

---

## 2.7 祝福パネル

現状は内容の仕様確認画面であり、完成画面ではない。

- 黒一色の背景にクリームカードを3枚並べたため、世界との連続性が消えている。
- 余白が大きく、内容密度が低い。
- 祝と呪が文字色だけで分かれ、儀式性がない。
- 全カードが同じ紙、同じ角丸、同じ枠で、選択の重みがない。
- 下部ボタンが遠く、選択した札との関係が弱い。
- 深度10の幕主撃破後という重要な節目に対して、採録ドラフトより簡素に見える。

### 最終形

祝福は「野帳に綴じられた契約の見開き」にする。

- 背景を完全な黒ではなく、直前テーマ背景の暗転へ戻す。
- 3案は縦カードではなく、1枚の見開き内に3本の契約欄として配置する。
- 左に緑青の `祝` 印、右に朱の `呪` 印を同じ大きさで置く。
- 利点と代償は同サイズ・同重量を維持する。
- 選択時は契約欄の中央へ真鍮の留め具が閉じる。
- 確定ボタンは選択欄の直下へ寄せる。

---

## 2.8 野帳・ラン結果

素材の豪華さに対し、情報階層が弱い。

- 大型木枠と古紙が画面の主役になり、記録内容が小さい。
- ほぼ全要素が中央揃えで、見出し、結果、分析、報酬の差が弱い。
- ラン名、記録3行、折れ線、反省文、主役知見、知見列が同じ細さで並ぶ。
- 折れ線グラフが小さく、数値的にも感情的にも意味を読み取りにくい。
- 「最も働いた知見」が下部にあり、本来の主役なのに発見が遅い。
- 知見の呼応図が狭い範囲に圧縮され、線が装飾に見える。
- 下端の知見メダル列が細かく、内容を認識できない。
- `もう一度潜る` が重い枠に対して平坦である。

### 最終階層

1. 結果印：`全深度 踏破` または `深度N まで`
2. ラン名
3. 主役知見：大アイコン、名称、発火回数
4. 主要記録：最大発火、最大連鎖、最大破壊を3列
5. 灯の推移：横幅を現状の約1.35倍、高さを約1.6倍
6. 振り返り：最大3行
7. 呼応図
8. その他の所持知見
9. 再挑戦ボタン

全中央揃えをやめ、記録と振り返りは左揃え、数値だけ中央揃えにする。主役知見は上半分へ移す。

---

## 3. 統一ADの正典

## 3.1 素材語彙

使用可能な主要素材を次の5種に限定する。

| 素材 | 使用場所 | 禁止事項 |
|---|---|---|
| 蝋引き帆布 | 盤面マス、道具袋、背面の敷物 | 明瞭な市松、黒つぶれ |
| 古木 | 盤面外枠、野帳の机、主要ボタンの芯 | 全パネルを木枠化しない |
| 酸化真鍮 | 計器、留め具、角金具、現在地、選択状態 | 全輪郭を金色で囲まない |
| 濃茶革 | 主要CTA、野帳表紙、ドック、タブ | 大面積を真っ黒にしない |
| 古紙 | 目標票、採録票、知見票、祝福契約、結果本文 | 一様なクリーム角丸カードにしない |

補助表現は墨、鉛筆、朱印、緑青、琥珀光だけを使う。

宝石、磨かれた金、大理石、赤い王侯風ビロード、豪華な巻物は使用しない。

---

## 3.2 パレット

| トークン | HEX | 用途 |
|---|---:|---|
| `abyss` | `#131A18` | 暗幕、最深部、背景の沈め |
| `pine` | `#24322B` | 森影、二次暗色 |
| `canvas` | `#342C23` | 盤面帆布、暗い紙背 |
| `leather` | `#2A1C14` | ボタン面、野帳表紙 |
| `paper` | `#E6D6AA` | 標本票、記録紙 |
| `ink` | `#493823` | 紙上本文 |
| `brass` | `#B88932` | 留め具、細枠、選択 |
| `amber` | `#E0A83D` | 灯、補給、主要行動 |
| `verdigris` | `#4F7769` | 祝、植物分類、酸化金属 |
| `cinnabar` | `#9B4938` | 呪、危険、踏破印 |

`UI.brass` の現行 `#D9A441` は明るすぎるため通常状態には使わない。`#D9A441` は押下光、補給光、選択瞬間だけに限定する。

---

## 3.3 状態遷移と素材言語

| 状態 | 素材 | 表現 |
|---|---|---|
| 常時プレイ | 帆布・木・真鍮計器 | 道具を広げて探索中 |
| 情報確認 | 古紙・革表紙 | 野帳を開く |
| 候補選択 | 標本票・クリップ・朱印 | 紙片を比較し採る |
| 層突破 | 破り取り記録票・押印 | 測量記録が更新される |
| 祝福 | 綴じた契約紙・二色印 | 利点と代償を署名する |
| ラン終了 | 製本済み報告書 | 記録を一冊へまとめる |
| 主要行動 | 革張り木板・真鍮留め | 携行箱を閉じる／次へ進む |
| 無効 | 煤けた革・鈍い真鍮 | 彩度とコントラストを下げる |
| 危険 | 朱・油槽の揺れ | 赤い枠を常設せず瞬間表示 |

---

## 3.4 パネル規則

- 紙パネルの角丸は実機 **4〜8px**。現在の大きなカプセル角丸は禁止。
- 紙の外周線は1本だけ。真鍮二重枠を常用しない。
- 紙端は左右どちらか一方だけ不均一にし、四辺すべてを派手に破らない。
- 紙影は下方向2〜4px、低不透明度。
- 木枠は盤面と最終結果だけに限定する。
- 通常情報パネルへ木枠を付けない。
- 真鍮は面積ではなく留め具として使う。

---

## 3.5 ボタン規則

### 主要ボタン

- 暗い革張り木板
- 真鍮は外周ではなく左右の留め具
- 高さ56〜60px
- 文字18px、ウェイト800、字間0.08em
- 通常、押下、無効の3状態を持つ
- 押下時は2px沈み、上側ハイライトが消える

### 小ボタン

- 真鍮タブまたは革の耳
- 最小ヒット領域44×44px
- ラベルは12〜14px
- 大きな角丸長方形にしない

### 選択状態

金枠を太くするだけで終わらせない。位置、留め具、押印の最低2要素を変える。

---

## 3.6 文字規則

Shippori Minchoを基調にし、1画面で600と800の2ウェイトまでに限定する。

| 階層 | 390px幅でのサイズ | ウェイト | 字間 | 色 |
|---|---:|---:|---:|---|
| 結果・深度主見出し | 26〜30px | 800 | 0.08em | 紙上は`ink`、暗地は`paper` |
| 画面タイトル | 18〜20px | 800 | 0.06em | 同上 |
| カード名・主要数値 | 16〜18px | 800 | 0.04em | 同上 |
| 本文 | 13〜14px | 600 | 0.02em | `ink` |
| 補助情報 | 11〜12px | 600 | 0.04em | `ink` 72% |
| 注記・タップ誘導 | 10〜11px | 600 | 0.06em | `ink` 60% |

追加規則：

- 行高は本文1.55、補助情報1.4。
- 日本語本文の長い中央揃えは禁止。中央揃えは見出しと数値だけ。
- 数字領域は固定幅を確保し、桁数で周辺要素を動かさない。
- `深度1踏破` のように語を詰めない。`深度1　踏破` または別階層へ分ける。
- 生成画像へ日本語を焼き込まない。
- 長文を縮小して収めるのは最終手段とし、先に改行と情報削減を行う。
- 紙上文字へ太い縁取りを付けない。
- 暗地の文字縁取りは最大2px、低不透明度。

---

## 4. 実行計画

画像生成は最大13枚。駒、背景、バストは生成対象から除外する。

## 4.1 共通の画像生成禁止条件

以下を全プロンプト末尾へ付ける。

```text
No text, no letters, no numbers, no logos, no characters, no creatures, no gemstones, no royal ornament, no red velvet, no modern plastic, no glossy game UI, no watermark. Front-facing orthographic game UI asset, clean silhouette, production-ready edges.
```

---

## 4.2 P1 — 今夜ここまでで見違えさせる

### P1-1 盤面v5を既定化・軽量化

- 種別：**[両方]**
- 効果：最大
- 画像数：2

#### 画像A：帆布セル面

- 寸法：1024×1024
- 透過：不要
- 出力先案：`assets/board/cells_v6.png`

```text
A seamless square game-board surface divided into an exact 8 by 8 grid, dark warm waxed canvas stretched inside a portable specimen case. Base color warm charcoal brown, softly worn woven fibers, subtle stains and pressure marks, restrained handcrafted variation from cell to cell. Very thin recessed seams, low contrast, no checkerboard pattern. The center of every cell must remain visually quiet for colorful game pieces. Even frontal lighting, orthographic view, 1024 by 1024 pixels, opaque background.
```

#### 画像B：細身の採集箱枠

- 寸法：1024×1024
- 透過：中央と外周
- 出力先案：`assets/board/frame_v6.png`

```text
A slim square portable field specimen-case frame, aged dark wood with restrained oxidized brass corner guards and two small worn leather straps. Large transparent square opening occupying about 86 percent of the width and height. Narrow frame, asymmetrical handmade wear, subtle scratches and verdigris only around metal fittings. The frame must not intrude into the inner play area. Front-facing orthographic game UI asset, transparent center and transparent outside, 1024 by 1024 pixels.
```

#### コード変更

対象：

- `src/view/pieces.ts`
- `src/view/BoardView.ts`

内容：

- `cells_v5`、`frame_v5` のURLを新素材へ更新、またはキーを `cells_v6`、`frame_v6` へ改名。
- `BOARD_V5` を既定化。
- `drawStaticV5()` の `inset` を `S * 0.03` へ変更。
- 新枠の透明窓を実測し、`fL/fR/fT/fB` を再設定。
- 目地が画像だけで不足する場合も、コード線を追加しない。
- `framePad` を新インセットから再計算し、目標票と知見ドックの位置を再確認。

---

### P1-2 HUD上部を一つの測量器セットに統一

- 種別：**[両方]**
- 効果：大
- 画像数：3

#### 画像C：油槽

- 寸法：1280×392
- 透過：油チャンネルと外周
- 出力先案：`assets/ui/hud_oil_v6.png`

```text
A compact antique field lantern fuel gauge for a handheld exploration kit. Dark aged brass body, narrow smoked-glass horizontal reservoir, small leather fastening tabs, restrained scratches and slight verdigris. Wide transparent inner channel for a code-rendered amber liquid fill. No decorative fantasy curls. Clear rectangular silhouette with softly chamfered ends, front-facing orthographic UI asset, transparent background, 1280 by 392 pixels.
```

#### 画像D：深度計

- 寸法：512×512
- 透過：要
- 出力先案：`assets/ui/hud_depth_v6.png`

```text
A compact circular depth-measuring instrument from a portable survey kit, aged dark brass, smoked glass, a small downward engraved pointer, quiet empty center reserved for code-rendered numerals. Restrained utilitarian design matching an antique lantern fuel gauge, minimal ornament, front-facing orthographic UI asset, transparent background, 512 by 512 pixels.
```

#### 画像E：メニュー留め具

- 寸法：512×512
- 透過：要
- 出力先案：`assets/ui/hud_menu_v6.png`

```text
A compact square field-kit clasp used as a menu button, dark worn leather inset into a slim aged brass frame, three simple horizontal recessed grooves, matching an antique survey instrument set. Minimal ornament, strong readable silhouette at small size, front-facing orthographic UI asset, transparent background, 512 by 512 pixels.
```

#### コード変更

対象：

- `src/view/pieces.ts` の `ui_oil`、`ui_depth`、`ui_menu`
- `src/main.ts` の `UI`
- `buildFloorScene()` 内HUD定数

内容：

- `UI` を正典パレットへ変更。
- HUDの3部品は上端から同じ光源・同じ金属明度に揃える。
- 深度計径とメニュー径を同じにする。
- 油槽の高さをHUD行の **82〜88%** に抑え、左右アイコンより少し低くする。
- 数字 `44` は右の黒箱へ置かず、油槽内の固定幅数値域へ置く。
- 通常真鍮を `#B88932`、補給時だけ `#D9A441` へ発光させる。
- 深度文字の3px縁取りを2pxへ下げる。
- メニューのフォールバック角丸率を `0.22` から `0.1` へ下げる。

---

### P1-3 層クリア帯を記録票へ変更

- 種別：**[両方]**
- 効果：大
- 画像数：1

#### 画像F：踏破記録票

- 寸法：1536×512
- 透過：要
- 9-slice可能な中央余白
- 出力先案：`assets/ui/floor_record_slip.png`

```text
A horizontal torn field-record slip made from warm fibrous archival paper, suitable for recording a completed survey depth. Slightly irregular deckled left and right edges, one tiny brass paper clip, a faint fold, subtle lower paper shadow, a quiet blank center for code-rendered Japanese text, a small empty circular area for a red-brown completion stamp. No writing. Front-facing orthographic game UI asset, transparent background, 1536 by 512 pixels.
```

#### コード変更

対象：`showFloorRecordBand()`

内容：

- `bandH` を `vh * 0.19` から **`min(148, vh * 0.17)`** 相当へ。
- 幅を `vw` から **`vw * 0.86`** へ。
- `x = vw * 0.07`。
- `bandTop` を `vh * 0.49` 前後へ調整。
- `Graphics.rect()` の紙背景を画像スプライトへ交換。
- 情報を `深度N`、`N手`、`灯 +N`、最多知見の4階層へ再配置。
- `残灯N` の文字表示を削除。
- `oxygenRefillFx()` を記録票の灯値表示位置から油槽へ飛ぶ演出に接続。
- `タップで次へ` を票の下辺内へ移す。
- 暗幕は `0.34` から **0.24〜0.28** へ下げる。
- 紙の登場は下から全面移動ではなく、12pxの上昇＋フェード＋押印にする。

---

### P1-4 ドラフトのクリームカードを標本票へ変更

- 種別：**[両方]**
- 効果：大
- 画像数：3

#### 画像G：植物標本票

- 寸法：1024×512
- 透過：要
- 出力先案：`assets/ui/draft_ticket_plant.png`

```text
A horizontal botanical specimen ticket made from warm fibrous archival paper, subtle green classification rules, two tiny thread holes and a restrained pressed-leaf stain near one edge. Large quiet blank text area, nearly square corners with slight handmade irregularity, no writing, no illustration in the center. Front-facing orthographic game UI asset, transparent background, 1024 by 512 pixels.
```

#### 画像H：鉱物・機械標本票

- 寸法：1024×512
- 透過：要
- 出力先案：`assets/ui/draft_ticket_instrument.png`

```text
A horizontal mineral and mechanical survey ticket made from muted blue-gray archival paper, very faint technical grid, one small oxidized brass clip, subtle graphite smudges near the margin. Large quiet blank text area, restrained nearly square corners, no writing, no central illustration. Front-facing orthographic game UI asset, transparent background, 1024 by 512 pixels.
```

#### 画像I：遺物・異種標本票

- 寸法：1024×512
- 透過：要
- 出力先案：`assets/ui/draft_ticket_relic.png`

```text
A horizontal layered field-note ticket for an unusual relic, warm thin paper with a slightly darker deckled edge, one small pasted fragment, a quiet empty area reserved for a red-brown catalog stamp. Large blank center for code-rendered text, restrained nearly square corners, no writing, no symbols. Front-facing orthographic game UI asset, transparent background, 1024 by 512 pixels.
```

#### コード変更

対象：

- `src/view/pieces.ts`
- `showDraftPanel()` → `renderCards()`

内容：

- カテゴリに応じて3種の背景を選ぶ。
- `bg.roundRect()` のクリーム面を廃止し、画像へ交換。
- フォールバックの角丸率を `cardH * 0.09` から `min(8, cardH * 0.04)` へ。
- 通常時の金枠を削除。
- 選択時はスケール `1.035` を **`1.018`** へ下げ、`y -= 4`、真鍮クリップ、朱印を追加。
- `おすすめ` は黄色タグから、右上の小さな `推` 印へ変更。
- 暗幕を `0.82` から **0.64〜0.68** へ下げる。
- 未選択ボタンの高さを現状比約80%へ下げる。
- 無効時ラベルは `カードを選んで比較` ではなく `知見を選ぶ` とし、補助情報へ降格。
- タイトルと採録帖ボタンが衝突しないよう、タイトル最大幅を明示する。
- `bodyFont` は13〜14px相当を下限とし、カード内の余白を減らして確保する。

---

### P1-5 拠点ノードとCTAを再構成

- 種別：**[両方]**
- 効果：大
- 画像数：2

#### 画像J：深度ピン状態シート

- 寸法：1024×256
- 透過：要
- 4区画：踏破済み／現在地／次地点／未到達
- 出力先案：状態別に切り出して `map_pin_*.png`

```text
A horizontal sprite sheet containing four isolated antique survey-map depth markers, evenly spaced: completed marker with a muted red-brown stamped ring, current marker with a small aged brass pin and warm amber accent, next marker with an outlined brass pin, locked marker drawn as a faint graphite circle. Compact utilitarian field-map design, no numerals, no text, no medals, no crowns. Transparent background, front-facing orthographic UI assets, 1024 by 256 pixels.
```

#### 画像K：主要革ボタン状態シート

- 寸法：1024×768
- 透過：要
- 3段：通常／押下／無効
- 出力先案：状態別に切り出して `button_primary_*.png`

```text
A vertical three-state sprite sheet of the same wide primary action button: normal, pressed, and disabled. Dark brown worn leather stretched over a slim wooden core, two small aged brass fasteners near the ends, quiet empty center for code-rendered text. The pressed state sits two pixels deeper with reduced top highlight; the disabled state is desaturated and soot-darkened. No writing, minimal ornament, transparent background, 1024 by 768 pixels.
```

#### コード変更

対象：

- `buildMap()`
- `makeCoveredButton()`
- `src/view/pieces.ts`

内容：

- `map_node`、`map_node_gold` を状態別ピンへ交換。
- ノード半径 `vw * 0.065` を **`vw * 0.045`** 前後へ。
- 星アーチを廃止。踏破状態は押印で示す。
- 現在地のリングを1本へ限定し、alphaを0.45から0.32へ。
- 肖像ピンは現在地だけ維持し、番号の右上へ小さく置く。
- 経路線幅を約1.2px、色を `paper` 55%へ。ダッシュ長を不均一にする。
- `startBtn.position` を中央から **`(vw / 2, vh - safeArea - 48)`** の固定下部へ。
- 幅を `vw * 0.58` から **`vw * 0.76`** へ変更するが、盤面中央は覆わない。
- `makeCoveredButton()` の「焼き込み文字を黒い矩形で覆う」処理を廃止。
- 全主要CTAを新しい共通ボタンへ統一する。

---

### P1完了条件

以下を満たせばP1だけで「別製品」に見える。

- 通常URLでv5盤面が出る。
- 盤面の枠より駒が先に見える。
- HUD、盤面、目標票、CTAの真鍮色が一致する。
- 層クリア時に全幅クリーム矩形が出ない。
- ドラフト3枚が同じCSSカードに見えない。
- 拠点CTAがノードと経路を隠さない。
- 390×844で文字縮小による11px未満の本文が発生しない。

---

## 4.3 P2 — 節目画面を商品水準へ揃える

### P2-1 祝福を契約見開きへ変更

- 種別：**[両方]**
- 画像数：1
- 効果：中〜大

#### 画像L：祝福契約見開き

- 寸法：1024×1024
- 透過：要
- 出力先案：`assets/ui/blessing_folio.png`

```text
An open field-journal contract folio viewed straight on, dark worn leather binding visible along the outer edge, warm archival paper divided into three quiet horizontal agreement sections. Subtle center fold, small blank seal areas on the left and right of each section, restrained thread binding and paper wear. Large empty areas for code-rendered text, no writing, no symbols. Transparent outside, front-facing orthographic game UI asset, 1024 by 1024 pixels.
```

#### コード変更

対象：`showBlessingPanel()`

内容：

- `dimG` の完全黒 `alpha:1` を廃止し、直前背景＋暗幕0.62へ。
- 3つの独立クリーム角丸背景を削除。
- 1枚の見開き上へ3行を描く。
- `祝` と `呪` を同じサイズの印章として左右配置。
- 本文を左揃えにする。
- 選択枠4pxを廃止し、真鍮留め具と紙の持ち上がりで示す。
- 確定ボタンを `vh * 0.93` から見開き直下へ移す。

---

### P2-2 野帳結果の紙面と階層を再設計

- 種別：**[両方]**
- 画像数：1
- 効果：大

#### 画像M：製本済み探窟報告書

- 寸法：1024×1536
- 透過：外周のみ
- 出力先案：`assets/ui/result_report_v6.png`

```text
A vertically bound expedition field report page mounted inside a restrained dark wood and worn leather portfolio. Warm archival paper with subtle fibers, a slim aged brass hinge, small catalog tabs, generous quiet writing area, asymmetrical practical layout, no medieval scroll, no royal decoration. The outer frame must be slim and secondary to the paper. No writing, no charts, no icons. Transparent outside, front-facing orthographic game UI asset, 1024 by 1536 pixels.
```

#### コード変更

対象：`showRunResult()`

内容：

- `ui_panel` を新報告書へ交換。
- 枠幅を現状より30〜40%軽くする。
- `ph` は最大 `vh * 0.84`、紙面内左右余白を明示する。
- 主役知見ブロックをグラフ下からラン名直下へ移動。
- 記録3項目を横3列にする。
- 折れ線グラフ幅を `pw * 0.58` から **`pw * 0.72`**、高さを `fs(0.055)` から **`fs(0.085)`** 前後へ。
- 振り返りは最大3行へ要約表示し、左揃えにする。
- 呼応図を紙面下半分へ独立させる。
- 所持知見列はアイコン径を最低24px確保し、超過時は横スクロールまたは2段化する。
- `もう一度潜る` は共通主要ボタン素材へ交換する。

---

### P2-3 採録帖ボトムシートの統一

- 種別：**[コード変更]**
- 効果：中

対象：

- `showFieldNote()`
- 盤面下部の `noteBtn`
- ドラフト中の `draftNoteBtn`

内容：

- 採録帖の開閉を共通の革表紙＋古紙ボトムシートに統一。
- 盤面側とドラフト側で同じボタン素材、同じラベルサイズを使用。
- 開くときは下から12px＋フェード、閉じるときは逆再生。
- 背景暗幕は0.58。
- 閉じるタブを右上へ固定。
- 所持知見ドックに薄い革帯を敷き、単独アイコンの浮遊感をなくす。

---

## 4.4 P3 — 仕上げと例外画面

### P3-1 目標票の紙質統一

- 種別：**[コード変更]**
- 優先度：P3

対象：`buildFloorScene()` の `sheet`

内容：

- 大角丸を4〜6px相当へ。
- 背景色を `paper`、線を `ink` 25%へ。
- 常時の真鍮外枠を削除。
- 完了時だけ朱の `採` 印を使う。
- 2課目時の区切りを折り目風の破線へ。
- ラベルのalphaを0.82から0.72へ下げ、残数を主役にする。

---

### P3-2 共通ボタン適用

- 種別：**[コード変更]**
- 優先度：P3

対象：

- `makeCoveredButton()`
- 採録確定
- 祝福確定
- 採録帖
- 結果再挑戦
- メニュー内操作

内容：

- 共通の `makePrimaryButton()` と `makeTabButton()` へ整理する。
- 通常、押下、無効状態を同じ関数で管理。
- `roundRect()` による画面ごとの独自ボタンを削減する。
- 最小ヒット領域44pxを維持する。

---

### P3-3 マップ経路の測量線化

- 種別：**[コード変更]**
- 優先度：P3

対象：`buildMap()` の `pathG`

内容：

- 一定ダッシュをやめ、深度ごとに決定的な長短差を付ける。
- ノード間へ2〜3本の短い測量目盛りを追加。
- 踏破済み区間は墨色70%、未到達は鉛筆色28%。
- 現在区間だけ琥珀の短い光を流す。
- 背景の地形に正確に沿わせる大改修は今夜の範囲外としない。現在のベジェ座標内で改善する。

---

### P3-4 文字トークンの定数化

- 種別：**[コード変更]**
- 優先度：P3

対象：`src/main.ts`

内容：

```ts
const TYPE = {
  display: fs(0.072),
  title: fs(0.048),
  heading: fs(0.041),
  body: fs(0.034),
  meta: fs(0.029),
  micro: fs(0.026),
} as const
```

実機ではそれぞれ上限・下限を設け、390px幅でおおむね30/20/17/14/12/10pxへ収める。既存の散在した `fs(0.0xx)` は画面ごとの例外を残しつつ段階的に置換する。

---

## 5. 今夜の実行順

1. `cells_v6` と `frame_v6` を生成・切り出し
2. v5を既定化し、盤面位置と `framePad` を再調整
3. HUD3素材を生成・交換
4. 共通主要ボタン素材を生成し、`makeCoveredButton()` を置換
5. 踏破記録票を生成し、`showFloorRecordBand()` を再構成
6. ドラフト標本票3種を生成し、カテゴリ別に適用
7. マップ深度ピンを生成し、CTAを下部固定
8. 390×844でプレイ、踏破、ドラフト、マップを撮影してP1検品
9. 祝福見開きを生成・実装
10. 結果報告書を生成・階層変更
11. 採録帖ボトムシートを統一
12. 390×844と375×667で最終検品

---

## 6. 最終検品基準

### 視覚

- 同じ真鍮が全画面で同じ色・同じ経年感を持つ。
- クリーム角丸CSSカードが残っていない。
- 金属枠は留め具として働き、全面を囲い続けない。
- 盤面、HUD、CTA、記録票のどれか一つだけが過剰に豪華ではない。
- 駒は一切変更せず、v5帆布上で現行より明瞭に見える。
- 背景と探窟家バストの魅力をUIが覆わない。

### 情報

- 各画面で最初に読む要素が1つに定まる。
- 主要本文は13px未満へ縮まない。
- 長文の中央揃えがない。
- 無効ボタンが主役にならない。
- 層突破時に、深度・手数・補給の順が1秒以内に理解できる。
- 結果画面で、ラン名と最も働いた知見が最初の画面内に入る。

### 操作

- すべての操作領域が44×44px以上。
- 選択状態が色だけに依存しない。
- 採録帖の開閉状態が一目で分かる。
- 拠点CTAがノードと経路を隠さない。
- 375×667でも盤面、目標票、主要ボタンが重ならない。

---

## 最終宣言

この改修では「豪華なファンタジーUI」を目指さない。

目指す完成形は、背景の美しい探窟世界と、現行駒を収めた携行採集箱、そこから生まれる記録票・野帳・契約書・報告書が、同じ人物の同じ道具として自然につながって見える状態である。

盤面v5を中心に、**木×真鍮×帆布×革×古紙**の役割を固定する。P1完了時点で日常プレイと主要遷移の印象を刷新し、P2で祝福と結果を同じ正典へ収束させる。
tokens used
123,117
# 決定

盤面は **v5「採集箱枠 × 蝋引き帆布」案を既定採用**する。現行の石枠盤面は廃止する。

アプリ全体の統一ADを、次の一文で固定する。

> **探窟家が携行する採集箱・測量器・野帳が、探索の進行に応じて記録され、押印され、製本されていく世界。**

背景画と探窟家バストは「現地」、盤面とHUDは「携行道具」、採録・祝福・結果は「記録物」として整理する。装飾を増やすのではなく、木・真鍮・帆布・革・古紙の役割を固定し、全画面を同じ道具箱から作られたように統一する。

現行駒 `assets/sprites3`、探窟家バスト、各テーマ背景は変更しない。

---

## 1. 盤面v5の最終採否

### 結論

v5を採用する。

現行盤面は背景との馴染みはあるが、「苔むした遺跡の床」に駒を直接置いた印象が強く、HUDや採録帖との共通言語を作れない。v5は携帯採集箱として意味が通り、駒を「採集物」として扱えるため、ゲーム固有の顔になる。

ただし、現状のv5をそのまま既定化してはならない。枠が重く、盤面内が暗く、目地が強いため、駒より箱が先に見える。

### v5最終調整値

- 外枠の見かけ幅を現状比 **70〜75%** にする。
- 透明窓のインセット比はおおむね以下へ変更する。
  - 左 `6.4%`
  - 右 `7.0%`
  - 上 `6.8%`
  - 下 `7.4%`
- `drawStaticV5()` の追加食い込み `inset` は `S * 0.06` から **`S * 0.03`** へ下げる。
- 帆布面の平均明度を現状より **12〜15%上げる**。
- 帆布の基準色は `#342C23`、セル差は明度±3%以内とする。
- 目地は `#15120F`、見かけ不透明度 **35〜42%**、幅は実機で **0.75〜1 CSS px**。
- 市松模様は禁止する。セル差は織り、擦れ、染みの個体差だけで作る。
- 木枠の金色ハイライトを抑え、真鍮角金具だけを高明度にする。
- 革ベルト、緑青、傷は外周だけに置き、盤面内へ侵入させない。
- 駒の占有率は変更しない。枠と地面を駒に従属させる。

### コード上の決定

`BoardView.ts` の比較フラグは廃止し、v5を通常経路にする。

```ts
const BOARD_V5 = true
```

最終確認後は分岐そのものを削除し、`drawStaticV5()` を `drawStatic()` の正規実装へ統合する。`?board=v5` は不要になる。

---

## 2. 全画面診断

## 2.1 拠点・深度図

商業品質に届いていない最大の理由は、背景、ノード、経路、CTAが同じ空間に属していないことにある。

- 背景が地図ではなく縦長壁紙として使われている。
- ノードは真鍮の測量印ではなく、大型のステージメダルに見える。
- 全ノードがほぼ同じ重量で、現在地、踏破済み、次地点、未到達の差が弱い。
- 現在地に脈動輪、番号メダル、肖像ピンが重なり、意味の異なる円が多すぎる。
- 点線経路が均一なUI線で、背景内の足場や裂け目と関係していない。
- `探窟へ` が画面中央を横断し、ノード3と経路を隠している。
- 最深記録よりCTAが極端に大きく、情報階層が逆転している。
- ビルド番号のプラークが世界内情報に見える。開発ビルドのみ表示する条件へ限定すべきである。

### 修正方針

深度図を「ステージ選択」ではなく「測量記録」にする。

- ノード径を現在の `vw * 0.13` から **`vw * 0.085〜0.095`** へ縮小。
- ノードは真鍮ピン＋墨の深度印とし、番号を主役にする。
- 現在地だけ肖像ピンを持ち、脈動輪は1本に限定する。
- 踏破済みは赤茶の押印、未到達は鉛筆輪郭、次地点は琥珀のピンで区別する。
- 経路は細い破線から、濃淡のある測量線へ変更する。
- CTAは中央から撤去し、画面下部の固定ドックへ移動する。
- CTA幅は **画面幅76%**、高さ **56〜60px**。ノードや経路を覆わない。
- 最深記録は右上の独立プラークではなく、上部の小さな野帳見出しへ統合する。

---

## 2.2 プレイ画面・現行盤面

現行盤面はv5より背景に埋もれ、盤面の所有物としての意味が弱い。盤の石枠、HUDの真鍮、目標票のクリーム紙、下部の丸い知見アイコンが別々のUIキットに見える。

- 盤面と背景の境界が曖昧。
- HUDの深度、油槽、メニューで輪郭線・真鍮色・立体感が揃っていない。
- 目標票の角丸が強く、生成り色の一般的なCSSカードに見える。
- 探窟家バストの下端フェードは改善されているが、目標票と盤面の間で押し込まれている。
- 下部の知見アイコンと採録帖ボタンに、共通の台座がない。
- 盤面が暗いため紫の遺物と目地が接近し、視認性が落ちる。

v5の微調整とHUD再統一により、この画面を全体の基準画面とする。

---

## 2.3 プレイ画面・v5

方向性は正しい。商業品質へ届かない部分は主に重量配分である。

- 木枠が厚く、盤面より高価な箱そのものが主役になっている。
- 上下の木板が広く、390×844ではプレイ領域を圧迫する。
- マス地が黒に近く、現行駒の暗い輪郭と競合する。
- 目地が均一かつ明瞭で、帆布よりタイルに見える。
- 革ベルトと緑青角金具の情報量が四隅へ集中しすぎる。
- HUD側は旧素材体系のままなので、盤面だけを交換した試作感が残る。

枠を細くし、盤内を明るくし、HUD・ボタン・紙票を同じ素材体系へ展開すれば正典になる。

---

## 2.4 層クリア・採録帯

現状で最も「生テキストを仮の矩形に置いた」印象が強い。

- 画面幅いっぱいの無地クリーム矩形が、背景と盤面を水平に切断している。
- 紙端、繊維、折れ、留め具、紙影がない。
- `深度1 踏破`、`この層 0手`、`灯 +12 → 残灯56` が同じ大きさに近く、読み順がない。
- 390px幅に対して文字が大きく、記録ではなく警告ダイアログに見える。
- 補給結果が紙上の文章で完結し、上部油槽へ加算される演出と視覚的につながらない。
- `タップで次へ` が盤面上に裸で置かれている。
- 帯が画面全幅を使うため、薄い紙片ではなくWebの通知バーに見える。

### 最終形

画面中央やや下へ差し込まれる、幅 **86%**、高さ **132〜148px** の破り取り式記録票にする。

情報階層は次の順に固定する。

1. 左上：小さな `踏破記録`
2. 中央：大きな `深度N`
3. 右上：朱の `踏破` 印
4. 下段左：`N手`
5. 下段右：`灯 +N`
6. 最下段：最多発火知見。存在しない場合は行ごと消す

`残灯56` は記録票へ重複表示せず、油槽の数字が増えることで示す。記録票から琥珀光が上部油槽へ移動し、数字が確定する。

`タップで次へ` は紙片下辺の小さな墨色注記に統合する。

---

## 2.5 採録・知見ドラフト

情報設計は以前より大幅に改善されているが、視覚的には依然として設定画面である。

- 3枚とも同じ大きなクリーム角丸カードで、量産されたWebカードに見える。
- 紙面が均一で、標本、機械図、異種知見の差が出ていない。
- 枠線が均一な黄色で、紙の厚みや留め方がない。
- カード間の余白が狭く、長いスクロールリストに見える。
- 背景暗転が強く、現地から完全に別モーダルへ移動した印象になる。
- `おすすめ` が一般的な黄色タグで、世界観内の記録印に見えない。
- 下部の無効ボタンが大きく、選択肢より先に目へ入る。
- `採録帖` ボタンは盤面側と同形でなく、独立したCSSボタンになっている。
- タイトル、手持ち、一覧、行為タブ、カード、確定ボタンの装飾密度が均一である。

### 最終形

カードではなく「野帳へ挟んだ標本票」として扱う。

3種類の紙型を用意する。

- 植物・菌類：繊維の見える標本紙、糸留め、淡い緑の分類線
- 鉱物・機械：方眼入りの青灰紙、真鍮クリップ、断面図用の細罫
- 遺物・異種：端が濃い薄紙、朱印、重ね貼りされた小片

文字領域とヒット領域は共通のまま維持し、紙型だけを候補カテゴリに応じて切り替える。

選択状態は金色の太枠ではなく、以下の3点で示す。

- 紙が上へ4px持ち上がる
- 左上へ小さな真鍮クリップが付く
- `採録候補` の朱印が現れる

---

## 2.6 採録帖ボタン直後の画面

画像上では、採録帖を押した結果として何が開いたのかが伝わらない。盤面がそのまま残り、下部の葉アイコンと採録帖ボタンも通常状態のままである。

- 押下前後の状態差が弱い。
- 採録帖が画面遷移なのか、選択中の知見なのか、単なる説明ボタンなのか読めない。
- 下部アイコン群に台座と見出しがなく、所持知見と操作ボタンが混在している。
- 採録帖ボタンが単独で右下に浮いている。

### 最終形

採録帖は「下から革表紙の野帳が開く」共通ボトムシートに統一する。

- 背景は完全暗転させず `#131A18` の55〜62%。
- シート上端に革の見返しを8〜12px見せる。
- 紙面は画面高の72〜78%。
- 開いた直後にタイトル、分類、アイコンがファーストビューへ入る。
- 閉じる操作は右上の小さな真鍮タブに固定する。
- 盤面下部は「所持知見ドック」として薄い革帯でまとめ、採録帖ボタンを同じ帯の右端へ収める。

---

## 2.7 祝福パネル

現状は内容の仕様確認画面であり、完成画面ではない。

- 黒一色の背景にクリームカードを3枚並べたため、世界との連続性が消えている。
- 余白が大きく、内容密度が低い。
- 祝と呪が文字色だけで分かれ、儀式性がない。
- 全カードが同じ紙、同じ角丸、同じ枠で、選択の重みがない。
- 下部ボタンが遠く、選択した札との関係が弱い。
- 深度10の幕主撃破後という重要な節目に対して、採録ドラフトより簡素に見える。

### 最終形

祝福は「野帳に綴じられた契約の見開き」にする。

- 背景を完全な黒ではなく、直前テーマ背景の暗転へ戻す。
- 3案は縦カードではなく、1枚の見開き内に3本の契約欄として配置する。
- 左に緑青の `祝` 印、右に朱の `呪` 印を同じ大きさで置く。
- 利点と代償は同サイズ・同重量を維持する。
- 選択時は契約欄の中央へ真鍮の留め具が閉じる。
- 確定ボタンは選択欄の直下へ寄せる。

---

## 2.8 野帳・ラン結果

素材の豪華さに対し、情報階層が弱い。

- 大型木枠と古紙が画面の主役になり、記録内容が小さい。
- ほぼ全要素が中央揃えで、見出し、結果、分析、報酬の差が弱い。
- ラン名、記録3行、折れ線、反省文、主役知見、知見列が同じ細さで並ぶ。
- 折れ線グラフが小さく、数値的にも感情的にも意味を読み取りにくい。
- 「最も働いた知見」が下部にあり、本来の主役なのに発見が遅い。
- 知見の呼応図が狭い範囲に圧縮され、線が装飾に見える。
- 下端の知見メダル列が細かく、内容を認識できない。
- `もう一度潜る` が重い枠に対して平坦である。

### 最終階層

1. 結果印：`全深度 踏破` または `深度N まで`
2. ラン名
3. 主役知見：大アイコン、名称、発火回数
4. 主要記録：最大発火、最大連鎖、最大破壊を3列
5. 灯の推移：横幅を現状の約1.35倍、高さを約1.6倍
6. 振り返り：最大3行
7. 呼応図
8. その他の所持知見
9. 再挑戦ボタン

全中央揃えをやめ、記録と振り返りは左揃え、数値だけ中央揃えにする。主役知見は上半分へ移す。

---

## 3. 統一ADの正典

## 3.1 素材語彙

使用可能な主要素材を次の5種に限定する。

| 素材 | 使用場所 | 禁止事項 |
|---|---|---|
| 蝋引き帆布 | 盤面マス、道具袋、背面の敷物 | 明瞭な市松、黒つぶれ |
| 古木 | 盤面外枠、野帳の机、主要ボタンの芯 | 全パネルを木枠化しない |
| 酸化真鍮 | 計器、留め具、角金具、現在地、選択状態 | 全輪郭を金色で囲まない |
| 濃茶革 | 主要CTA、野帳表紙、ドック、タブ | 大面積を真っ黒にしない |
| 古紙 | 目標票、採録票、知見票、祝福契約、結果本文 | 一様なクリーム角丸カードにしない |

補助表現は墨、鉛筆、朱印、緑青、琥珀光だけを使う。

宝石、磨かれた金、大理石、赤い王侯風ビロード、豪華な巻物は使用しない。

---

## 3.2 パレット

| トークン | HEX | 用途 |
|---|---:|---|
| `abyss` | `#131A18` | 暗幕、最深部、背景の沈め |
| `pine` | `#24322B` | 森影、二次暗色 |
| `canvas` | `#342C23` | 盤面帆布、暗い紙背 |
| `leather` | `#2A1C14` | ボタン面、野帳表紙 |
| `paper` | `#E6D6AA` | 標本票、記録紙 |
| `ink` | `#493823` | 紙上本文 |
| `brass` | `#B88932` | 留め具、細枠、選択 |
| `amber` | `#E0A83D` | 灯、補給、主要行動 |
| `verdigris` | `#4F7769` | 祝、植物分類、酸化金属 |
| `cinnabar` | `#9B4938` | 呪、危険、踏破印 |

`UI.brass` の現行 `#D9A441` は明るすぎるため通常状態には使わない。`#D9A441` は押下光、補給光、選択瞬間だけに限定する。

---

## 3.3 状態遷移と素材言語

| 状態 | 素材 | 表現 |
|---|---|---|
| 常時プレイ | 帆布・木・真鍮計器 | 道具を広げて探索中 |
| 情報確認 | 古紙・革表紙 | 野帳を開く |
| 候補選択 | 標本票・クリップ・朱印 | 紙片を比較し採る |
| 層突破 | 破り取り記録票・押印 | 測量記録が更新される |
| 祝福 | 綴じた契約紙・二色印 | 利点と代償を署名する |
| ラン終了 | 製本済み報告書 | 記録を一冊へまとめる |
| 主要行動 | 革張り木板・真鍮留め | 携行箱を閉じる／次へ進む |
| 無効 | 煤けた革・鈍い真鍮 | 彩度とコントラストを下げる |
| 危険 | 朱・油槽の揺れ | 赤い枠を常設せず瞬間表示 |

---

## 3.4 パネル規則

- 紙パネルの角丸は実機 **4〜8px**。現在の大きなカプセル角丸は禁止。
- 紙の外周線は1本だけ。真鍮二重枠を常用しない。
- 紙端は左右どちらか一方だけ不均一にし、四辺すべてを派手に破らない。
- 紙影は下方向2〜4px、低不透明度。
- 木枠は盤面と最終結果だけに限定する。
- 通常情報パネルへ木枠を付けない。
- 真鍮は面積ではなく留め具として使う。

---

## 3.5 ボタン規則

### 主要ボタン

- 暗い革張り木板
- 真鍮は外周ではなく左右の留め具
- 高さ56〜60px
- 文字18px、ウェイト800、字間0.08em
- 通常、押下、無効の3状態を持つ
- 押下時は2px沈み、上側ハイライトが消える

### 小ボタン

- 真鍮タブまたは革の耳
- 最小ヒット領域44×44px
- ラベルは12〜14px
- 大きな角丸長方形にしない

### 選択状態

金枠を太くするだけで終わらせない。位置、留め具、押印の最低2要素を変える。

---

## 3.6 文字規則

Shippori Minchoを基調にし、1画面で600と800の2ウェイトまでに限定する。

| 階層 | 390px幅でのサイズ | ウェイト | 字間 | 色 |
|---|---:|---:|---:|---|
| 結果・深度主見出し | 26〜30px | 800 | 0.08em | 紙上は`ink`、暗地は`paper` |
| 画面タイトル | 18〜20px | 800 | 0.06em | 同上 |
| カード名・主要数値 | 16〜18px | 800 | 0.04em | 同上 |
| 本文 | 13〜14px | 600 | 0.02em | `ink` |
| 補助情報 | 11〜12px | 600 | 0.04em | `ink` 72% |
| 注記・タップ誘導 | 10〜11px | 600 | 0.06em | `ink` 60% |

追加規則：

- 行高は本文1.55、補助情報1.4。
- 日本語本文の長い中央揃えは禁止。中央揃えは見出しと数値だけ。
- 数字領域は固定幅を確保し、桁数で周辺要素を動かさない。
- `深度1踏破` のように語を詰めない。`深度1　踏破` または別階層へ分ける。
- 生成画像へ日本語を焼き込まない。
- 長文を縮小して収めるのは最終手段とし、先に改行と情報削減を行う。
- 紙上文字へ太い縁取りを付けない。
- 暗地の文字縁取りは最大2px、低不透明度。

---

## 4. 実行計画

画像生成は最大13枚。駒、背景、バストは生成対象から除外する。

## 4.1 共通の画像生成禁止条件

以下を全プロンプト末尾へ付ける。

```text
No text, no letters, no numbers, no logos, no characters, no creatures, no gemstones, no royal ornament, no red velvet, no modern plastic, no glossy game UI, no watermark. Front-facing orthographic game UI asset, clean silhouette, production-ready edges.
```

---

## 4.2 P1 — 今夜ここまでで見違えさせる

### P1-1 盤面v5を既定化・軽量化

- 種別：**[両方]**
- 効果：最大
- 画像数：2

#### 画像A：帆布セル面

- 寸法：1024×1024
- 透過：不要
- 出力先案：`assets/board/cells_v6.png`

```text
A seamless square game-board surface divided into an exact 8 by 8 grid, dark warm waxed canvas stretched inside a portable specimen case. Base color warm charcoal brown, softly worn woven fibers, subtle stains and pressure marks, restrained handcrafted variation from cell to cell. Very thin recessed seams, low contrast, no checkerboard pattern. The center of every cell must remain visually quiet for colorful game pieces. Even frontal lighting, orthographic view, 1024 by 1024 pixels, opaque background.
```

#### 画像B：細身の採集箱枠

- 寸法：1024×1024
- 透過：中央と外周
- 出力先案：`assets/board/frame_v6.png`

```text
A slim square portable field specimen-case frame, aged dark wood with restrained oxidized brass corner guards and two small worn leather straps. Large transparent square opening occupying about 86 percent of the width and height. Narrow frame, asymmetrical handmade wear, subtle scratches and verdigris only around metal fittings. The frame must not intrude into the inner play area. Front-facing orthographic game UI asset, transparent center and transparent outside, 1024 by 1024 pixels.
```

#### コード変更

対象：

- `src/view/pieces.ts`
- `src/view/BoardView.ts`

内容：

- `cells_v5`、`frame_v5` のURLを新素材へ更新、またはキーを `cells_v6`、`frame_v6` へ改名。
- `BOARD_V5` を既定化。
- `drawStaticV5()` の `inset` を `S * 0.03` へ変更。
- 新枠の透明窓を実測し、`fL/fR/fT/fB` を再設定。
- 目地が画像だけで不足する場合も、コード線を追加しない。
- `framePad` を新インセットから再計算し、目標票と知見ドックの位置を再確認。

---

### P1-2 HUD上部を一つの測量器セットに統一

- 種別：**[両方]**
- 効果：大
- 画像数：3

#### 画像C：油槽

- 寸法：1280×392
- 透過：油チャンネルと外周
- 出力先案：`assets/ui/hud_oil_v6.png`

```text
A compact antique field lantern fuel gauge for a handheld exploration kit. Dark aged brass body, narrow smoked-glass horizontal reservoir, small leather fastening tabs, restrained scratches and slight verdigris. Wide transparent inner channel for a code-rendered amber liquid fill. No decorative fantasy curls. Clear rectangular silhouette with softly chamfered ends, front-facing orthographic UI asset, transparent background, 1280 by 392 pixels.
```

#### 画像D：深度計

- 寸法：512×512
- 透過：要
- 出力先案：`assets/ui/hud_depth_v6.png`

```text
A compact circular depth-measuring instrument from a portable survey kit, aged dark brass, smoked glass, a small downward engraved pointer, quiet empty center reserved for code-rendered numerals. Restrained utilitarian design matching an antique lantern fuel gauge, minimal ornament, front-facing orthographic UI asset, transparent background, 512 by 512 pixels.
```

#### 画像E：メニュー留め具

- 寸法：512×512
- 透過：要
- 出力先案：`assets/ui/hud_menu_v6.png`

```text
A compact square field-kit clasp used as a menu button, dark worn leather inset into a slim aged brass frame, three simple horizontal recessed grooves, matching an antique survey instrument set. Minimal ornament, strong readable silhouette at small size, front-facing orthographic UI asset, transparent background, 512 by 512 pixels.
```

#### コード変更

対象：

- `src/view/pieces.ts` の `ui_oil`、`ui_depth`、`ui_menu`
- `src/main.ts` の `UI`
- `buildFloorScene()` 内HUD定数

内容：

- `UI` を正典パレットへ変更。
- HUDの3部品は上端から同じ光源・同じ金属明度に揃える。
- 深度計径とメニュー径を同じにする。
- 油槽の高さをHUD行の **82〜88%** に抑え、左右アイコンより少し低くする。
- 数字 `44` は右の黒箱へ置かず、油槽内の固定幅数値域へ置く。
- 通常真鍮を `#B88932`、補給時だけ `#D9A441` へ発光させる。
- 深度文字の3px縁取りを2pxへ下げる。
- メニューのフォールバック角丸率を `0.22` から `0.1` へ下げる。

---

### P1-3 層クリア帯を記録票へ変更

- 種別：**[両方]**
- 効果：大
- 画像数：1

#### 画像F：踏破記録票

- 寸法：1536×512
- 透過：要
- 9-slice可能な中央余白
- 出力先案：`assets/ui/floor_record_slip.png`

```text
A horizontal torn field-record slip made from warm fibrous archival paper, suitable for recording a completed survey depth. Slightly irregular deckled left and right edges, one tiny brass paper clip, a faint fold, subtle lower paper shadow, a quiet blank center for code-rendered Japanese text, a small empty circular area for a red-brown completion stamp. No writing. Front-facing orthographic game UI asset, transparent background, 1536 by 512 pixels.
```

#### コード変更

対象：`showFloorRecordBand()`

内容：

- `bandH` を `vh * 0.19` から **`min(148, vh * 0.17)`** 相当へ。
- 幅を `vw` から **`vw * 0.86`** へ。
- `x = vw * 0.07`。
- `bandTop` を `vh * 0.49` 前後へ調整。
- `Graphics.rect()` の紙背景を画像スプライトへ交換。
- 情報を `深度N`、`N手`、`灯 +N`、最多知見の4階層へ再配置。
- `残灯N` の文字表示を削除。
- `oxygenRefillFx()` を記録票の灯値表示位置から油槽へ飛ぶ演出に接続。
- `タップで次へ` を票の下辺内へ移す。
- 暗幕は `0.34` から **0.24〜0.28** へ下げる。
- 紙の登場は下から全面移動ではなく、12pxの上昇＋フェード＋押印にする。

---

### P1-4 ドラフトのクリームカードを標本票へ変更

- 種別：**[両方]**
- 効果：大
- 画像数：3

#### 画像G：植物標本票

- 寸法：1024×512
- 透過：要
- 出力先案：`assets/ui/draft_ticket_plant.png`

```text
A horizontal botanical specimen ticket made from warm fibrous archival paper, subtle green classification rules, two tiny thread holes and a restrained pressed-leaf stain near one edge. Large quiet blank text area, nearly square corners with slight handmade irregularity, no writing, no illustration in the center. Front-facing orthographic game UI asset, transparent background, 1024 by 512 pixels.
```

#### 画像H：鉱物・機械標本票

- 寸法：1024×512
- 透過：要
- 出力先案：`assets/ui/draft_ticket_instrument.png`

```text
A horizontal mineral and mechanical survey ticket made from muted blue-gray archival paper, very faint technical grid, one small oxidized brass clip, subtle graphite smudges near the margin. Large quiet blank text area, restrained nearly square corners, no writing, no central illustration. Front-facing orthographic game UI asset, transparent background, 1024 by 512 pixels.
```

#### 画像I：遺物・異種標本票

- 寸法：1024×512
- 透過：要
- 出力先案：`assets/ui/draft_ticket_relic.png`

```text
A horizontal layered field-note ticket for an unusual relic, warm thin paper with a slightly darker deckled edge, one small pasted fragment, a quiet empty area reserved for a red-brown catalog stamp. Large blank center for code-rendered text, restrained nearly square corners, no writing, no symbols. Front-facing orthographic game UI asset, transparent background, 1024 by 512 pixels.
```

#### コード変更

対象：

- `src/view/pieces.ts`
- `showDraftPanel()` → `renderCards()`

内容：

- カテゴリに応じて3種の背景を選ぶ。
- `bg.roundRect()` のクリーム面を廃止し、画像へ交換。
- フォールバックの角丸率を `cardH * 0.09` から `min(8, cardH * 0.04)` へ。
- 通常時の金枠を削除。
- 選択時はスケール `1.035` を **`1.018`** へ下げ、`y -= 4`、真鍮クリップ、朱印を追加。
- `おすすめ` は黄色タグから、右上の小さな `推` 印へ変更。
- 暗幕を `0.82` から **0.64〜0.68** へ下げる。
- 未選択ボタンの高さを現状比約80%へ下げる。
- 無効時ラベルは `カードを選んで比較` ではなく `知見を選ぶ` とし、補助情報へ降格。
- タイトルと採録帖ボタンが衝突しないよう、タイトル最大幅を明示する。
- `bodyFont` は13〜14px相当を下限とし、カード内の余白を減らして確保する。

---

### P1-5 拠点ノードとCTAを再構成

- 種別：**[両方]**
- 効果：大
- 画像数：2

#### 画像J：深度ピン状態シート

- 寸法：1024×256
- 透過：要
- 4区画：踏破済み／現在地／次地点／未到達
- 出力先案：状態別に切り出して `map_pin_*.png`

```text
A horizontal sprite sheet containing four isolated antique survey-map depth markers, evenly spaced: completed marker with a muted red-brown stamped ring, current marker with a small aged brass pin and warm amber accent, next marker with an outlined brass pin, locked marker drawn as a faint graphite circle. Compact utilitarian field-map design, no numerals, no text, no medals, no crowns. Transparent background, front-facing orthographic UI assets, 1024 by 256 pixels.
```

#### 画像K：主要革ボタン状態シート

- 寸法：1024×768
- 透過：要
- 3段：通常／押下／無効
- 出力先案：状態別に切り出して `button_primary_*.png`

```text
A vertical three-state sprite sheet of the same wide primary action button: normal, pressed, and disabled. Dark brown worn leather stretched over a slim wooden core, two small aged brass fasteners near the ends, quiet empty center for code-rendered text. The pressed state sits two pixels deeper with reduced top highlight; the disabled state is desaturated and soot-darkened. No writing, minimal ornament, transparent background, 1024 by 768 pixels.
```

#### コード変更

対象：

- `buildMap()`
- `makeCoveredButton()`
- `src/view/pieces.ts`

内容：

- `map_node`、`map_node_gold` を状態別ピンへ交換。
- ノード半径 `vw * 0.065` を **`vw * 0.045`** 前後へ。
- 星アーチを廃止。踏破状態は押印で示す。
- 現在地のリングを1本へ限定し、alphaを0.45から0.32へ。
- 肖像ピンは現在地だけ維持し、番号の右上へ小さく置く。
- 経路線幅を約1.2px、色を `paper` 55%へ。ダッシュ長を不均一にする。
- `startBtn.position` を中央から **`(vw / 2, vh - safeArea - 48)`** の固定下部へ。
- 幅を `vw * 0.58` から **`vw * 0.76`** へ変更するが、盤面中央は覆わない。
- `makeCoveredButton()` の「焼き込み文字を黒い矩形で覆う」処理を廃止。
- 全主要CTAを新しい共通ボタンへ統一する。

---

### P1完了条件

以下を満たせばP1だけで「別製品」に見える。

- 通常URLでv5盤面が出る。
- 盤面の枠より駒が先に見える。
- HUD、盤面、目標票、CTAの真鍮色が一致する。
- 層クリア時に全幅クリーム矩形が出ない。
- ドラフト3枚が同じCSSカードに見えない。
- 拠点CTAがノードと経路を隠さない。
- 390×844で文字縮小による11px未満の本文が発生しない。

---

## 4.3 P2 — 節目画面を商品水準へ揃える

### P2-1 祝福を契約見開きへ変更

- 種別：**[両方]**
- 画像数：1
- 効果：中〜大

#### 画像L：祝福契約見開き

- 寸法：1024×1024
- 透過：要
- 出力先案：`assets/ui/blessing_folio.png`

```text
An open field-journal contract folio viewed straight on, dark worn leather binding visible along the outer edge, warm archival paper divided into three quiet horizontal agreement sections. Subtle center fold, small blank seal areas on the left and right of each section, restrained thread binding and paper wear. Large empty areas for code-rendered text, no writing, no symbols. Transparent outside, front-facing orthographic game UI asset, 1024 by 1024 pixels.
```

#### コード変更

対象：`showBlessingPanel()`

内容：

- `dimG` の完全黒 `alpha:1` を廃止し、直前背景＋暗幕0.62へ。
- 3つの独立クリーム角丸背景を削除。
- 1枚の見開き上へ3行を描く。
- `祝` と `呪` を同じサイズの印章として左右配置。
- 本文を左揃えにする。
- 選択枠4pxを廃止し、真鍮留め具と紙の持ち上がりで示す。
- 確定ボタンを `vh * 0.93` から見開き直下へ移す。

---

### P2-2 野帳結果の紙面と階層を再設計

- 種別：**[両方]**
- 画像数：1
- 効果：大

#### 画像M：製本済み探窟報告書

- 寸法：1024×1536
- 透過：外周のみ
- 出力先案：`assets/ui/result_report_v6.png`

```text
A vertically bound expedition field report page mounted inside a restrained dark wood and worn leather portfolio. Warm archival paper with subtle fibers, a slim aged brass hinge, small catalog tabs, generous quiet writing area, asymmetrical practical layout, no medieval scroll, no royal decoration. The outer frame must be slim and secondary to the paper. No writing, no charts, no icons. Transparent outside, front-facing orthographic game UI asset, 1024 by 1536 pixels.
```

#### コード変更

対象：`showRunResult()`

内容：

- `ui_panel` を新報告書へ交換。
- 枠幅を現状より30〜40%軽くする。
- `ph` は最大 `vh * 0.84`、紙面内左右余白を明示する。
- 主役知見ブロックをグラフ下からラン名直下へ移動。
- 記録3項目を横3列にする。
- 折れ線グラフ幅を `pw * 0.58` から **`pw * 0.72`**、高さを `fs(0.055)` から **`fs(0.085)`** 前後へ。
- 振り返りは最大3行へ要約表示し、左揃えにする。
- 呼応図を紙面下半分へ独立させる。
- 所持知見列はアイコン径を最低24px確保し、超過時は横スクロールまたは2段化する。
- `もう一度潜る` は共通主要ボタン素材へ交換する。

---

### P2-3 採録帖ボトムシートの統一

- 種別：**[コード変更]**
- 効果：中

対象：

- `showFieldNote()`
- 盤面下部の `noteBtn`
- ドラフト中の `draftNoteBtn`

内容：

- 採録帖の開閉を共通の革表紙＋古紙ボトムシートに統一。
- 盤面側とドラフト側で同じボタン素材、同じラベルサイズを使用。
- 開くときは下から12px＋フェード、閉じるときは逆再生。
- 背景暗幕は0.58。
- 閉じるタブを右上へ固定。
- 所持知見ドックに薄い革帯を敷き、単独アイコンの浮遊感をなくす。

---

## 4.4 P3 — 仕上げと例外画面

### P3-1 目標票の紙質統一

- 種別：**[コード変更]**
- 優先度：P3

対象：`buildFloorScene()` の `sheet`

内容：

- 大角丸を4〜6px相当へ。
- 背景色を `paper`、線を `ink` 25%へ。
- 常時の真鍮外枠を削除。
- 完了時だけ朱の `採` 印を使う。
- 2課目時の区切りを折り目風の破線へ。
- ラベルのalphaを0.82から0.72へ下げ、残数を主役にする。

---

### P3-2 共通ボタン適用

- 種別：**[コード変更]**
- 優先度：P3

対象：

- `makeCoveredButton()`
- 採録確定
- 祝福確定
- 採録帖
- 結果再挑戦
- メニュー内操作

内容：

- 共通の `makePrimaryButton()` と `makeTabButton()` へ整理する。
- 通常、押下、無効状態を同じ関数で管理。
- `roundRect()` による画面ごとの独自ボタンを削減する。
- 最小ヒット領域44pxを維持する。

---

### P3-3 マップ経路の測量線化

- 種別：**[コード変更]**
- 優先度：P3

対象：`buildMap()` の `pathG`

内容：

- 一定ダッシュをやめ、深度ごとに決定的な長短差を付ける。
- ノード間へ2〜3本の短い測量目盛りを追加。
- 踏破済み区間は墨色70%、未到達は鉛筆色28%。
- 現在区間だけ琥珀の短い光を流す。
- 背景の地形に正確に沿わせる大改修は今夜の範囲外としない。現在のベジェ座標内で改善する。

---

### P3-4 文字トークンの定数化

- 種別：**[コード変更]**
- 優先度：P3

対象：`src/main.ts`

内容：

```ts
const TYPE = {
  display: fs(0.072),
  title: fs(0.048),
  heading: fs(0.041),
  body: fs(0.034),
  meta: fs(0.029),
  micro: fs(0.026),
} as const
```

実機ではそれぞれ上限・下限を設け、390px幅でおおむね30/20/17/14/12/10pxへ収める。既存の散在した `fs(0.0xx)` は画面ごとの例外を残しつつ段階的に置換する。

---

## 5. 今夜の実行順

1. `cells_v6` と `frame_v6` を生成・切り出し
2. v5を既定化し、盤面位置と `framePad` を再調整
3. HUD3素材を生成・交換
4. 共通主要ボタン素材を生成し、`makeCoveredButton()` を置換
5. 踏破記録票を生成し、`showFloorRecordBand()` を再構成
6. ドラフト標本票3種を生成し、カテゴリ別に適用
7. マップ深度ピンを生成し、CTAを下部固定
8. 390×844でプレイ、踏破、ドラフト、マップを撮影してP1検品
9. 祝福見開きを生成・実装
10. 結果報告書を生成・階層変更
11. 採録帖ボトムシートを統一
12. 390×844と375×667で最終検品

---

## 6. 最終検品基準

### 視覚

- 同じ真鍮が全画面で同じ色・同じ経年感を持つ。
- クリーム角丸CSSカードが残っていない。
- 金属枠は留め具として働き、全面を囲い続けない。
- 盤面、HUD、CTA、記録票のどれか一つだけが過剰に豪華ではない。
- 駒は一切変更せず、v5帆布上で現行より明瞭に見える。
- 背景と探窟家バストの魅力をUIが覆わない。

### 情報

- 各画面で最初に読む要素が1つに定まる。
- 主要本文は13px未満へ縮まない。
- 長文の中央揃えがない。
- 無効ボタンが主役にならない。
- 層突破時に、深度・手数・補給の順が1秒以内に理解できる。
- 結果画面で、ラン名と最も働いた知見が最初の画面内に入る。

### 操作

- すべての操作領域が44×44px以上。
- 選択状態が色だけに依存しない。
- 採録帖の開閉状態が一目で分かる。
- 拠点CTAがノードと経路を隠さない。
- 375×667でも盤面、目標票、主要ボタンが重ならない。

---

## 最終宣言

この改修では「豪華なファンタジーUI」を目指さない。

目指す完成形は、背景の美しい探窟世界と、現行駒を収めた携行採集箱、そこから生まれる記録票・野帳・契約書・報告書が、同じ人物の同じ道具として自然につながって見える状態である。

盤面v5を中心に、**木×真鍮×帆布×革×古紙**の役割を固定する。P1完了時点で日常プレイと主要遷移の印象を刷新し、P2で祝福と結果を同じ正典へ収束させる。
