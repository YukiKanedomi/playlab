# ART_GRAMMAR.md ── 生成仕様書

> **この文書の目的**：ある漫画作品の視覚文法を言語化し、**作品名・作者名・キャラクター名を一切使わずに同じ方向の画を生成する**ための実務仕様。
> これを読んだ人が、明日から画像生成プロンプトを書けること。
>
> **正典の位置づけ**：`ART.md` はゲーム内の意匠マッピング（何を描くか）の正典。本書は**どう描くか**の正典。数値が衝突した場合は本書が優先する。
> **確定日 2026-08-14。** 全数値は本書執筆時に一次資料を Pillow で実測した値であり、標本の切り出し条件を各所に明記した。

---

## 0. 測定の作法（これを守らないと数値が意味を失う）

過去の分析で3つの結論が反転した。すべて**標本の切り出しミス**が原因だった。以後、数値を出すときは必ず次の3条件のどれで測ったかを明記する。

| 標本条件 | 定義 | 使う場面 |
|---|---|---|
| **S-画面** | 合成後のゲーム画面のみ（企画書の紙地・余白・解説欄を含めない） | 画面全体の検収 |
| **S-素材** | 単体アセットPNG。透過素材は `alpha>200` の画素のみ | 素材の検収 |
| **S-下地** | 盤領域の輝度下位40%（＝駒を除いたタイル地） | 盤の検収 |

- **明度の指標は luma（0–255, `0.299R+0.587G+0.114B`）に統一する。** HSV の V は色相・彩度を語るときだけ使い、床値・ゲートには使わない。過去に「V18%」と「輝度18」が同じ数字で混用され、検収スクリプトが書けなくなった。
- 輪郭・インクの色は「下位8%分位の平均色」で測る。影の色は「下位5%分位」。ハイライトは「V≧85% 画素」。

### 0.1 過去の3つの誤診と、その撤回（実測で確認済み）

| 撤回する処方 | 実測 | 正しい結論 |
|---|---|---|
| 「モックには準白が13.5〜55.9%ある。各画面5%以上を準白に」 | **S-画面**で測ると モックA/B/C = 3.48 / 3.08 / 1.74%、実機 r1_floor1 = 3.43%。**面積はすでに同等** | 面積ゲートは撤回。差は**明部の彩度**（モック 17.1/18.6/21.5% 対 実機 48.3%）。→ §9 で彩度ゲートに一本化 |
| 「盤タイルを luma 52 → 85 へ上げる」 | **S-下地** モックA/B/C = 48.8 / 46.6 / 46.4、実機 = 45.0。**ほぼ同一** | 明度は据え置き。欠けているのは明るさではなく**セルの分節**（ベベル・目地・リベット）。→ §5.4 |
| 「加算合成＋ガウスの発光ハロを全面禁止」 | オーナー自身のモック（企画書「2. パズルプレイ」）は、連結した結晶駒の周囲に**加算ブルーム＋電光アーク**を描いている | 全面禁止は撤回。**静止アセットでは禁止、状態遷移の瞬間（≤230ms）は許可**。→ §4.3 |

---

## 1. 文法の要約（10項目）

1. **光は環境が持ち、盤と UI は持たない。** 一次資料の背景は画素の 9.4〜14.0% が luma 217 以上（V≧85%）の**塗り残しの紙**で、その平均彩度は 9.8〜13.0%。実機の背景アセットは同じ画素が 0.43〜1.01% しかなく、代わりに橙のゲージと駒が明部を占めている。**明るさの在庫を背景に戻すこと**が最大の一手。
2. **明るくなるほど彩度が落ちる。** 透明水彩は不透明白を持たないので、最大光量は紙を残すことでしか作れない。この制約が「彩度の山は中明度、明部は無彩へ崩落」という顔料曲線を強制する。デジタルで描くときも、この曲線を手で守る。
3. **影は黒でも灰でもなく、行き先が決まっている。** 最暗部は彩度 20〜35% を保ち、luma 22 を割らない。光が暖色（H35〜45）なら、影は場に応じてオリーブ（H65〜85）／青緑（H150〜170）／スレート青（H210〜230）のどれか一つへ倒す。
4. **輪郭は無彩寄りの暖い木炭色。** 一次資料の駒シート実測 `#2F2922`（H32 / S27% / luma 42.6）。実機は S47〜70% の焦茶で、これがステッカーに見える最大の原因。**駒の印象を最も安く変えられる一手。**
5. **深さは暗さで描かない。光源の名前で描く。** 一次資料の3テーマの背景は luma 中央値 67〜87 の範囲に収まり、深いテーマが暗いわけではない。変わるのは**色相と高彩度の予算**だけ。だから幕は色名でなく光源名で呼ぶ（空明かり／炉あかり／岩あかり）。
6. **一つの物に硬いエッジと柔らかいエッジが同居する。** 線際で顔料が溜まる hard edge と、内側 1〜2 段の wet-in-wet の bloom。エアブラシの連続グラデは一発で偽物になる。
7. **紙目はどこにも残る。** 絵の中だけでなく、UI パネルの内部にも同じ紙の目と顔料のムラが残る。UI だけが平滑になった瞬間、UI は「別の画材で描かれた異物」になる。
8. **数字は必ず自分の札の上に載る。** 一次資料に縁取りされた数字は一つもない。地が正しいのでコントラストが自動的に確保されている（地との Δluma 116〜176）。縁取りは地の選択を誤った代償。
9. **要素は重なる。** リボンが板を跨ぎ、キャラが盤の上辺に隠され、蔦が枠の外角に乗る。重なりゼロの非交差の箱は入力フォームに見える。
10. **生物は「基底1系統＋接木1系統」で作る。** 3系統目を足した瞬間に、実在の分類群のどこにも置けなくなり「怪獣」という記号に落ちる。危険度は色ではなく**開く器官の数**で示す。

---

## 2. 色彩仕様

### 2.1 基調・影・ハイライトの色域

| 役割 | 色域（16進で例示） | 数値条件 | 根拠 |
|---|---|---|---|
| **紙（最大光量）** | `#F1E4C6` `#EFE4CC` `#E4D6B6` | luma 217以上／S 15〜22% | S-画面のモック明部 実測 S 17.1〜21.5% |
| **祝祭の明部**（クリア画面の星・リボンのみ） | `#FAE9AF` `#F0E3BC` | luma 225以上／S 27〜38% | S-画面のモッククリア画面 実測 S 36.4〜37.3% |
| **温白ハイライト**（金属の照り） | `#F6EBDA` | S 11%／途切れさせる | 連続ベベルの回避 |
| **中明度の彩度の山** | 各テーマの主調色 | S 28〜36% | 顔料曲線の頂点 |
| **地（羊皮紙）** | `#DCCFBC` 〜 `#EFE4CC` | luma 200〜225／S 14〜18% | UI プラークの実測域 |
| **木・暗地の札** | `#4A3A26` / 凹面 `#2E241A` | luma 55〜75 | 象牙文字が載る明度 |
| **真鍮（中間）** | `#9A7B44` | S 47%（面の中間色としてのみ） | — |
| **緑青（凹部）** | `#4A6155` `#3E5450` | H149〜169 / S 20〜26% | 実運用の影の主力帯 |
| **影（青緑系）** | `#4A5A55` | H161 / S 18% | 湿った岩・金属 |
| **影（オリーブ系）** | `#2D2E25` 近辺 | H65〜85 / S 18〜25% | 植生の場 |
| **影（スレート青系）** | `#22272D` 近辺 | H210〜230 / S 20〜28% | 寒色内部・結晶 |
| **輪郭インク** | **`#2F2922`** | H32 / S27% / luma 42.6 | 一次資料の駒シート実測。**唯一の輪郭色** |
| **錆の差し色** | `#A8613C` | 面積 3% 以内（退避級のみ5%） | — |
| **危険（酸素喪失のみ）** | `#C4553E` | H9 / S68% / V77% | 現行 `#FF6B5A`(V100%) から降ろす |
| **文字（暗地の上）** | `#F1E4C6` | 地 luma ≤90 のとき | Δluma ≥120 |
| **文字（紙の上）** | `#3A2E20` | 地 luma ≥185 のとき | Δluma ≥120 |
| **落ち影（描いた接地影）** | `#1A1410` α0.35 | luma 21。中性灰は不可 | — |

**輪郭色を1色に統一した理由**：過去の資料には `#332F27`(S23.5%) / `#3A322A`(S27.6%) / `#2A211A`(S38.1%) の3色が併存し、うち `#2A211A` は自らが禁じた「高彩度の茶」の方向に片足を入れていた。3色から選ぶのではなく、**一次資料の駒シートを実測した値 `#2F2922` を採用**する。線に差をつけたいときは色ではなく太さと途切れ方で行う。

### 2.2 幕ごとの色相計画

幕名は色名ではなく**光源名**で呼ぶ。色名で呼ぶと「フィルタを掛ける」発想になり、光源名で呼ぶと「画面内に光源を描く」発想になる。

| 幕 | 名 | 光源の申告（必ず画面内に描く） | 背景 S中央値 | 背景 luma中央値 | S≧45% 画素の予算 | 盤下地の色相 |
|---|---|---|---:|---:|---:|---|
| **第一幕（層1–10）** | **空明かり** 深界の森 | 上端の空のスリット、落ちる滝 | **18〜22%** | **80〜90** | ≤ 8% | 暖褐 `#343028` H42 S24% |
| **第二幕（層11–20）** | **炉あかり** 機械遺構 | 吊りランプ／炉の火口 | **15〜19%** | **62〜72** | ≤ 5% | 暖褐 `#342D22` H38 S34% |
| **第三幕（層21–30）** | **岩あかり** 結晶洞窟 | 岩そのものの自発光 | **30〜36%** | **68〜78** | ≤ **22%** | **無彩スレート** `#2F2D2F` H293 S4% |

**実測の根拠と、過去の処方の撤回**（S-素材、テーマスウォッチ）：

| | モック実測 S中央値 / S≧45%面積 / luma中央値 | 実機アセット | 判定 |
|---|---|---|---|
| 森 | 19.8% / 6.6% / 87.2 | `bg_forest` 18.9% / 1.7% / **66.1** | 彩度は合格。**明度が21低い** |
| 機械 | 17.1% / 3.0% / 67.1 | `bg_machine` **9.1%** / 4.8% / 44.0 | **無彩に落ちている**。明度も23低い |
| 結晶 | 34.0% / 20.3% / 73.3 | `bg_crystal` **53.1%** / **90.8%** / 47.8 | **彩度が大幅超過**。明度も25低い |

> 過去の処方「第三幕を S≤26% / S≧45%画素 ≤3% へ」は**オーナーのモック自身（34.0% / 20.3%）を不合格にする過補正**なので撤回した。実機 `bg_crystal` は新目標からもなお大幅超過なので、修正が必要という結論だけは維持する。
>
> 「深度で彩度を上げてはいけない」という規則も撤回する。モックは森 19.8% → 結晶 34.0% と**深度で彩度を上げている**。代わりに**高彩度画素を面積で予算管理する**（上表）。

**3幕を通して luma 中央値が単調に下がらないことは誤りではない。** 一次資料自身がそうなっている。降下は明度ではなく、光源の交代と色相で描く。

### 2.3 禁止色

| 禁止 | 理由 |
|---|---|
| **純黒 `#000000`／luma 22未満** | 情報が死ぬ。`bg_machine` の最暗帯が典型 |
| **純白 `#FFFFFF`** | 紙は白くない。最明は温白 `#F6EBDA` まで |
| **S≧50% の飽和した明部**（明るい純金・明るいコバルト・明るい橙） | 現行の酸素ゲージ `#D9922E`(S78%) が鉱石駒 `#E79F21`(S85%) と同色になり、資源と駒の identity が衝突している |
| **`#D9A441` を100%不透明の均一ヘアラインとして使う** | ベクターの署名。面の中間色としてのみ可 |
| **`#FF6B5A`（V100%の画面赤）** | パレット外の純粋な画面色。`#C4553E` まで降ろす |
| **紫を地の広い面／UI／金属／紙に使う** | 紫は**結晶駒・花駒・第三幕の発光点にのみ**使う。面で使う場合は必ず青紫と赤紫の2系統に割り、単色のグラデにしない |

---

## 3. 画材仕様 ──「きっぱりしすぎ」を避ける

「きっぱりしすぎ」の正体は3つで、いずれも測れる。

### 3.1 高彩度（最大の主因）

S-画面の高彩度画素（S≧45%）の面積：**モック 10.1〜13.8%、実機 21.1%**。約2倍。
明部の彩度：**モック 17.1〜21.5%、実機 48.3%**。約2.5倍。

**処方**：明部から色を抜く。ハイライトを「明るい絵の具」でなく「紙」にする。地（背景・盤・UI）の彩度を落とし、**高彩度の register は駒に譲る**。

### 3.2 平滑さ（UI に局在）

高周波エネルギー（`L − Gaussian(σ=2)` の平均絶対差）：モックUIプラーク内部 **20.97**、実機 `hud_kit_v5` バー内部 **3.52**。約6分の1。
駒は 11.2〜12.3 で合格圏（モック 12.7〜14.8）にある。**問題は UI だけ。**

`hud_kit_v5.png` を目視すると、真鍮レールは全周が連続ベベル＋均一スペキュラで、紙目も顔料ムラも一切ない。しかも左右対称でリベットが等間隔。**UI 一式が別の画材で描かれている。**

**処方**：全 UI をインク線＋水彩＋紙目で描き直す。内部の高周波を **HF ≧ 12** にする。全明度帯で S ≤ 40%。金は「S65 のブラス」でなく「S30〜40 の枯れた真鍮」。

### 3.3 エッジが一種類しかない

一次資料の駒は1個の中に2種のエッジを持つ。実機の駒はほぼ全面が soft（エアブラシ的連続グラデ）で、hard edge は輪郭線そのものしかない。

| エッジ | 描き方 | どこに出るか |
|---|---|---|
| **hard（乾いた縁）** | 乾いた紙にウォッシュを置き、止まった縁に顔料が溜まる | 輪郭線の内側 1〜2 相当のヘアライン、甲・石・金属などの乾いた面 |
| **soft（wet-in-wet の bloom）** | 濡れた紙の上でウォッシュ同士が滲む。縁ができない | 形の内側 1〜2 段だけ。粘膜・霧・毛 |

**規則：1オブジェクトに必ず両方を同居させる。**

### 3.4 線の質

- 色は `#2F2922` 一色（§2.1）。
- 太さは可変。**影側・接地側・重なりの内側で太り、上面のハイライト側では途切れて消える。** 全周均一太さは禁止。
- 線際 1〜2px 相当に顔料溜まりを作り、縁が本体より濃く見えるようにする。
- **ハッチング**：ウォッシュを乗せない暗部は、細い平行線と点描で暗くする。遺構の凹み・庇の下・生態スケッチの陰影がここに当たる。実機には現在ハッチングが一件も存在しない。
- 版ズレは使わない。彩色は線内に収める（1〜2px の滲み漏れは可）。

### 3.5 紙の質感

- 紙は決して白くない。`#EFE6D4`〜`#DCCFB6`、繊維が見え、3〜6% の褪色斑。
- 外周は**中心より少し褐色で少し暗い**（乾いた古紙が縁から褪せる見え方として描く。「乗算ビネット」という合成演算の指定は透過素材では空振りするので使わない）。
- 紙目は絵の中だけでなく **UI パネルの内部にも同じ密度で残す**。

### 3.6 影とスペキュラの線引き（禁止と必須が衝突していた点の裁定）

過去の資料は「no drop shadow / no specular」と「リボンの下に落ち影」「硝子に途切れた反射」を同時に指定していた。区別はこうする。

| | 禁止 | 許可 |
|---|---|---|
| **影** | 一様なドロップシャドウ効果（オフセット＋ぼかしのフィルタ） | **絵として描かれた不均一な接地影**。光源と接地面が画面内で説明できること |
| **照り** | 連続したベベル＋スペキュラ（CG金属の署名） | **途切れた温白のハイライト**。腐食箇所で止まる。硝子・水面の途切れた反射 |
| **駒スプライト** | **落ち影を焼き込まない**（透過素材として切り出すため。エンジン側で重ねる） | — |

---

## 4. 光の描き方

### 4.1 発光体の芯は「紙」

- 発光体の芯は塗り残しの紙（S ≤ 15%、luma 225以上）。**芯に彩度を残さない。**
- 距離減衰は**面ごとの離散ステップ**で描く。隣接面は明るく、2つ隣は少し、3つ隣は無し。連続的なガウスぼかしを使わない。
- 逆光・透過光：葉やキノコの傘は**縁だけ**が紙まで抜け、内側は暗いまま。
- 野帳ページの発光する花は、**内側の花弁を塗り残す**ことで光らせる（顔料の不在が光）。

### 4.2 静止アセットでのハロ禁止

`bg_crystal.png` は全結晶に半径の大きい放射ハロが付き、光源の芯にまで彩度が残っている（V≧85% 画素の平均 S 44.0%）。結果「光っている」でなく「発光レイヤーが乗っている」に見える。これが生成エンジンの指紋。

**規則：静止背景アセット（`bg_*.png`）および常時表示のオブジェクトに、加算合成のガウスハロを描かない。**

### 4.3 状態遷移では許可する（撤回）

オーナーの企画書「2. パズルプレイ」は、連結した結晶駒の周囲に**加算ブルーム＋電光アーク**を描いている。これはマッチ成立の juice そのものであり、削ってはいけない。

**規則：マッチ成立・特殊駒発動・連鎖など、状態遷移の瞬間に限りブルームを許可する。持続は JUICE 実測値（消滅 170–230ms）以内。常駐させない。**
`bg_crystal` の問題は「ハロを使ったこと」ではなく「全結晶に常時付けたこと」である。

### 4.4 暖色の一点

冷たい低彩度の場に置かれた小さな暖色光源（ランプ・火）は、どんなグラデーションよりも強く深度を作る（進出色／後退色）。
**予算：画面につき厳密に1個。画面上端 35% の帯に置く。盤の裏には置かない。**

---

## 5. 構図・スケール

### 5.1 一枚絵の垂直性を作る五つの操作

1. **レプソワール（近景の垂直質量）を上下フレーム外へ逃がす。** 左右端に幹・岩壁・柱を置き、上端でも下端でも切らない。終端の不可視性が寸法の上限を消す。どちらか一方でも根本や樹冠が見えた瞬間、高さは「その物体の長さ」で頭打ちになる。
2. **棚の裏面を見せる。** 崖を輪郭だけで描いても深さは出ない。**自分より上にある棚の下面**と、**自分より下にある棚の上面**を同時に描く。これで初めて「私はその間にいる」と読める。
3. **同一モジュールを 0.6 倍ずつ 3 回反復する。** 吊り橋・石段・アーチ扉のような識別可能な一つの形を、奥行き方向に3回置く。人物を出さずに定規を置く技法。`bg_forest.png` はこれを実行しており（吊り橋が全長 約200px → 180px → 90px）、**この橋3本がこの絵の高さを唯一測っている**。
4. **人物は画面高の 1/25〜1/60**（定規として使う人物の場合）。主体として描く手前のキャラはこの限りでないが、その場合は**別に定規を置くこと**。
5. **落下するリボン（滝・鎖・蔓）を着地させない。** 上端から始まり、霧の中へ消えて着地点を見せない垂直の線を1〜3本。着地させた瞬間に落差が確定して有限になる。

### 5.2 遠近の描き方（ぼかしの禁止と、その代替）

過去の資料は「遠景も近景と全く同じ描線密度を保て」と「遠景のディテールを 1/3 に崩壊させろ」を同時に指定していた。裁定する。

> **ぼかしフィルタ・霧グラデーション・被写界深度は使わない。遠景のコントラスト低下は、`描く線の本数を減らし、線の濃度を上げない` ことで作る。彩度はほぼ据え置き、明度を上げ、色相を回す。**

実測（`bg_forest.png` 近景帯→遠景帯）：局所コントラスト sd 22.2 → 15.6、luma 51.9 → 73.4（**暗部が持ち上がる**）、色相 H74（黄緑）→ H151（青緑）、彩度 24% → 19%（ほぼ不変）。

**機構**：霧は「白いベールを乗せる」のではなく「黒を殺す」。奥行きレイヤーに白を乗算・オーバーレイするのは誤りで、**暗部だけを持ち上げる lift** を掛ける。

### 5.3 カメラ

**棚の上に立つ人物の目線から、下方へ 5〜12° だけ傾ける。** 俯瞰でも煽りでもない。

- 微小な見下ろしにすると、自分より下にある物の**上面**が見える。これが「下がある」の証明になる。
- 傾きを小さく保つと、垂直の壁が画面上でほぼ垂直のまま残る。45° の俯瞰にすると縦穴が「鉢」になり、垂直性が消える。
- 感情の割り当て：俯瞰＝支配、煽り＝脅威、**5〜12° の見下ろし＝曝露**（縁に立っており、小さく、落下は現実だがまだ起きていない）。
- 見上げは**畏怖の句読点**としてのみ使う（光の柱、天蓋）。既定にしない。
- 現状：`bg_forest` は約8° で正しい。`bg_crystal` `bg_machine` はほぼ水平で、これが「世界が浅い」原因。

### 5.4 盤面背景への翻訳

**問題の定式化**：一枚絵は深度の手がかりを画面中央（霧の井戸）に置く。マッチ3は不透明・高コントラストの矩形をまさにそこに置く。深度手がかりは消滅し、装飾的な壁紙の帯だけが残る。
**解**：深度手がかりを中央から上下の余白へ移し、盤そのものを深度要素にする。

#### (a) 縦の配分を戻す

| | 環境帯（HUD＋キャラ＋風景） | 盤 | 下帯（ブースター） |
|---|---:|---:|---:|
| **一次資料 A案（実測）** | **44%** | 42% | 14% |
| 実機 r1_floor1（実測） | 35.3% | 45.3% | 19.4% |

実機は世界の帯を 9pt 削って盤を広げている。**環境帯を 44% 前後まで戻す。**

#### (b) HUD は帯を作らずに風景の上に浮かべる

一次資料には HUD バーが存在しない。円形メダリオンと羊皮紙プラークが**風景の上に直接載っている**ので、背景は画面最上端まで途切れず続く。実機は幅455pxの橙のゲージが上端を占有し、風景を分断している。**HUD 背景板を廃し、部品を風景の上に浮かべる。**

#### (c) 盤を「棚」にする

1. **上端に受光面**：枠の上辺 6〜10px を、枠の正面より **luma +25〜35** にする。「上から光が来て天板に当たった」と読める。
2. **下端に接地影**：帯Cへ向けて高さ 40〜60px、不透明度 0.35、下方 8px オフセットの柔らかい楕円影。色は暖かい黒 `#1A1410`（中性黒は不可）。現状の盤は影なしで唐突に終わっている。
3. **キャラは盤の上辺にハード遮蔽させる。** アルファフェードは「これはデカールだ」と言い、遮蔽は「これは空間内の物体だ」と言う。遮蔽は最も安価で最も強い深度手がかり。
4. **枠を破る前景要素**：蔦・垂れ根・鎖を2〜4本、盤枠の外側の角に 10〜20px 重ねる（不透明度85%）。矩形の UI をジオラマに変える最小の操作。

#### (d) セルの分節（明度は上げない）

**S-下地の明度は据え置き（luma 45〜50）。** 一次資料を拡大して確認したところ、各セルは次の構造を持つ。

- 角丸の正方形パネルが1マスずつ独立している（連続した1枚の板ではない）。
- パネル上辺・左辺の内側に**受光ベベル**（下地比 +18〜25 luma）。
- パネル間に**目地の暗線**（下地比 −10〜15 luma）。目地は太くしない。
- 交点に小さなリベット／打刻。**等間隔に揃えない。**
- セルごとに **±12〜15 luma のムラ**（1枚ずつ値の違う石として描く。均一タイリングテクスチャは不可）。
- **駒はパネルの上に載り、小さな接地影を落とす。**

#### (e) 盤下地の色相はテーマに追従する（新規・未文書化）

実測（S-下地）：森 `#343028` H42 S24% ／ 機械 `#342D22` H38 S34% ／ **結晶 `#2F2D2F` H293 S4%（無彩スレート）**。
テーマによって盤下地の色相が変わる。`ART.md §2` の「盤面下地の濃紺 `#16283B`」は v1 由来で、一次資料と一致しないので**廃止する**。

#### (f) 幕の identity は「見えている場所」に載せる

盤の裏の帯は9割隠れる。幕の色相 identity は実際に見えている要素に載せる：盤タイル（乗算 8〜12%）、盤枠（乗算 5%）、HUD の金属、パーティクル、盤の左右の隙間。これで背景がほとんど見えなくても幕の交代が読める。

#### (g) 視差（テクスチャ2枚で最大の効き）

780px 幅では、遠景の画角が小さすぎて空気遠近は「距離」ではなく「ぼけ」としか読まれない。一方、微分運動は瞬時に、曖昧さなく距離として読まれる。

- 背景を3面に分割（遠：霞んだ建築／中：棚と滝／近：下帯の地面）
- 相対移動係数 **1.00 / 0.55 / 0.25**
- 駆動源：層遷移時のスクロール ±14px、待機時8秒周期の揺らぎ ±3px

### 5.5 一次資料にあって実機に無い構図要素（未記載だった5点）

| | 一次資料 | 実機 | 対応 |
|---|---|---|---|
| **相棒の同伴** | プレイ3枚・クリア3枚**すべて**にキャラ＋随伴獣の2体1組。キャラは左1/3、相棒は右2/3 | 盤上画面に相棒が不在。キャラは**中央**でアルファフェード | **2体1組を構図規則として明記**。キャラを中央に置かない |
| **中景の定規** | キャラと相棒の間から霞んだ遺跡都市が見える＝スケールの定規 | 中央配置のバストが定規を完全に隠している | キャラを左へ寄せ、中景を空ける |
| **吹き出し** | 随伴獣が台詞を持つ（UI に「声」が入る） | 無し | 「吹き出し札」をアセットとして起票 |
| **★3進捗レール** | 星付きの横バー | 無し | 「★3進捗レール」をアセットとして起票 |
| **セルのパネル** | 駒は必ず内側ベベル付きの角丸パネルの上に載る | セルがほぼ知覚できない | §5.4(d) |

---

## 6. UI・文字・数字

### 6.1 唯一絶対の規則

> **すべての数字は自分専用の札の上に載っており、札の明度が数字の明度を決定する。**

一次資料の実測（地との Δluma）：ムーブ`28`（象牙／濃茶メダリオン）**176** ／ ターゲット`20 16`（濃茶／羊皮紙）**116** ／ スコア`71,840`（濃茶／羊皮紙）**120**。
**縁取りされた数字は一つも存在しない。** 地が正しいのでコントラストが自動的に確保されている。

実機の主数値は 3px の黒縁を除くと Δluma 約79 で、基準の半分以下。**縁取りは装飾ではなく、地の選択を誤った代償。**

コードの不変条件にする：

```
地 luma ≤ 90  → 文字 #F1E4C6
地 luma ≥ 185 → 文字 #3A2E20
不変条件: Δluma ≥ 120（一次資料の最小値116を安全側に丸めた値）
満たせない要素は、必ず背後に札を敷く
stroke は全廃。必要なら dropShadow(#1E1610, α0.55, blur2, distance2, angle π/2)
```

### 6.2 書体

現状は `Shippori Mincho` を `fontWeight:'bold'` で全テキストに適用しており、CSS のフォントマッチングにより **800（ExtraBold）に解決されている**。和文も欧文数字もすべて同じ明朝 ExtraBold で描かれている。これが「チープ」の全機構：

1. 明朝の欧文数字はディドー系の高コントラスト。ExtraBold では太細比が概ね 4:1。26〜62px を DPR3 で描くとヘアラインが実デバイス約1.2px に落ち、**グレーのフリンジにエイリアスする。それが「チープ」の正体。**
2. プロポーショナル数字なので `9 / 50` のような表示で桁が跳ぶ。
3. 和文と数字が同一ファミリー＝タイポグラフィの階層が存在しない。「フォントを一つ選んで全部に貼った」と読まれる。

| 用途 | 指定 |
|---|---|
| 和文見出し | **Shippori Mincho 600**（`'bold'` ではなく `600` を数値で明示） |
| 和文本文（13px相当以下） | **Zen Kaku Gothic New 500** |
| **すべての数字** | **等幅ライニング数字を既定で持つ、低コントラストのサン（Archivo 600）**。ストローク太細比 ≤1.6:1 |

**スラブセリフ（Bitter）を第一候補にしない理由**：一次資料の数字（ムーブ`28`／スコア`12,450`／`68,230`）を拡大確認したところ、いずれも**セリフを持たない低コントラストのやや丸みのあるサン**である。スラブは一次資料に存在しない特徴であり、足すと「モックと絵柄が違う」が再発する。

**数字グリフシートを画像生成しないこと。** 12グリフの字形同一性も送り幅の均一性も生成モデルは保証せず、グリフ欠損は残酸素やスコアの誤表示という**機能バグ**になる。質感が欲しい場合は、Archivo 600 を Canvas に描画し、紙目テクスチャの乗算・インク輪郭のオフセット合成・左上ハイライトを**プログラムで**適用して BitmapFont 化する。画像生成は「1グリフ分の質感サンプル」の取得にのみ使う。

### 6.3 パネル

- `Graphics.roundRect().fill().stroke()` を全廃し **NineSliceSprite** に置換する。必要テクスチャは4枚：①羊皮紙札（明地）②木・石札（暗地）③真鍮レール（ゲージ筐体）④野帳カード（耳付き・ちぎれ縁）。**この4枚でゲーム内の平坦矩形が全滅する。**
- **線を引くときは必ず2本にする**：内側 `#3A2C1E` 60%、外側 `#B99A5E` 80%、1px オフセット。単線の純金ヘアラインはベクターの署名。
- **打刻は中心をわずかに外し、リベットの数と間隔を左右で揃えない。** ハイライトと欠けは片側にだけ寄せる。左右対称に均整の取れた UI は「AIっぽい没個性」の主要な署名。
- **重なりを必ず3箇所作る**：リボンが板の上辺を跨ぐ／星がリボンを跨ぐ／キャラが板の角を破る。重なりゼロの非交差の箱は入力フォームに見える。

### 6.4 酸素ゲージの再設計

現行 `#D9922E`(S78% V85%)・455×60px は、①画面最大の単色面 ②鉱石駒 `#E79F21`(S85%) とほぼ同色 ③一次資料に存在しない要素、の三重の誤り。

- 空トラフを**冷たい緑青 `#3E5450`**（H170 S26% V33%）、充填を**落ち着いた琥珀 `#B98A3E`**（H38 S66% V73%）へ。暖色を冷色の上に置くと、彩度を下げても図地分離はむしろ強くなる。
- **高さを 60px → 18〜22px。** 最大の色面であることをやめさせるのが本質。
- **数字をバーから出し、円形メダリオンへ移す**（一次資料の `ムーブ 28` と同じ構造）。

### 6.5 ドラフト画面（最も AD から外れている画面）

現状は角丸18px・平坦なクリーム `#EFE3C0`・均一3px金縁の大カード3枚＝**マテリアルデザインのカード**。キーワードの点線アンダーラインは HTML リンクに見え、灰地に灰文字の角丸ボタンは無効化された HTML ボタンに見える。背景の世界は黒スクリムで消えている。
**皮肉なことに `assets_src/` には使えるパネルテクスチャ（`draft_card_v1.png` `frame_v4.png`）が既にある。素材が無いのではなく、素材を使っていない。**

- カードを**耳付き・ちぎれ縁の紙**にする。
- 各カードに **−1.2° / +0.8° / −0.5°** の微回転（完全な平行はテンプレの署名）。
- アイコンを**カードの縁からはみ出す押印ロンデル**にする。
- キーワードの下線を、点線ではなく**手描きの筆線スプライト**に置換。
- 比較ボタンを、灰の角丸から**彫り文字の真鍮／木の板**へ。
- 黒スクリムを廃し、テーマ背景を残す。

### 6.6 リザルト画面

一次資料のスコア板は**不透明な羊皮紙プラーク**であり、風景を透かす窓ではない（過去の資料の「板を窓にする」は誤り）。報酬も囲み罫つきのチップ横一列で、実機と同じ構成でよい。実差分は4点：

1. 板の素材＝羊皮紙テクスチャ＋不揃いな手描き縁（現状はフラット塗り＋均一線）
2. 背景を黒／紫スクリムで潰さず、テーマ背景を全面に残す
3. 「もういちど」を**黒ピルから緑石＋真鍮枠のプラーク**へ（黒は一次資料に一切存在しない）
4. **三つ星が板の上辺に食い込む重なり**を入れる

### 6.7 版面設計（図鑑・野帳ページ）

- **非対称・上重心。** 題字ブロックは上部左40%。図版は右と下へ裁ち落とす。**中央揃えを既定にしない。**
- **罫は1本だけ。** キャプションと図版の分離は 0.5〜0.75pt 相当の細い温かいグレーブラウン罫を1本。囲み罫は「標本」を示すときだけに限定する。囲みの多用はカタログに見える。
- **キャプション組版**：見出しの約0.35倍の小さな明朝、より淡い茶インク、1行18〜24字、右ラグ、行送り1.7〜1.9。図版の左辺に揃える。
- **図版番号だけが唯一、垂直を守る要素。** プレーンなライニング数字＋ピリオド。

---

## 7. 生物デザイン ── 原生種の成立条件

> **前提の明示**：一次資料3枚に原生種は**1体も描かれていない**。この章だけはオーナーの好みの実物が存在せず、以下は**未確認の設計判断**である。一方でモックが確定させている造形は「大きな正面2眼＋丸い体＋毛＋衣装」の側に寄っている。
> **着手前に検証コストの低い確認を取ること**：観察級1体（可愛い側・閉じた丸い体）と退避級1体（目なし・開く器官2個）を1枚ずつ先に生成し、二択でオーナーに見せる。可愛い個体の配分も「全種の2割」と「3〜4割」の2案を併記して選ばせる。

### 7.1 系統数の憲法

参照した作品の生物が実在感を持つ最大の理由は、**混ぜている系統が少ないこと**である。怪獣（特撮怪獣・凡庸なソシャゲボス）は爬虫類＋角＋牙＋翼＋トゲ＋鉱物と系統を4つ以上積む。積むほど現実の分類群のどこにも置けなくなり、記号＝怪獣に落ちる。

> **基底1系統 ＋ 接木1系統。合計2系統まで。3系統目を足したくなったら、それは別種として分ける。**

- **基底（体制）**：全体の骨格・移動様式・分節構造を決める。実在の門をそのまま借りる。
- **接木（1器官系のみ）**：基底の生活史では説明できない器官を1つだけ接ぐ。ここが「未知」の全量。
- 色・質感・付着物は系統としてカウントしない。環境由来なのでいくら足しても怪獣化せず、むしろ実在感が上がる。

**引用元プール**：深海（オオグチボヤ／クシクラゲ／ウミユリ／サルパ）／菌類（冬虫夏草／キヌガサタケ／変形菌／地衣類）／甲殻・多足（ダイオウグソクムシ／シャコの捕脚／ケラの前脚）／両生・肺魚（ハイギョ／アシナシイモリ／オオサンショウウオ／ホライモリ）／植物（食虫植物／綿毛／菌根、動かない種に限る）。

**禁止プール**：哺乳類（毛皮＋四肢＋前向き2眼）を**基底**に使わない。哺乳類基底は自動的に「可愛い獣」か「獣人モンスター」に落ち、中間の「未知の生物」に留まれない。接木として1器官（歯・爪・声）までなら強力な不気味さを生む。

**接木を必要にする環境**：接木器官は必ず本作の環境5変数（①垂直の縦穴 ②酸素 ③岩の崩落 ④菌糸と胞子 ⑤発光の希少性）のどれかへの適応として説明できること。説明できない器官は削る。

### 7.2 不気味さの7つのつまみ（1体につき2〜3個だけ回す）

不気味さは「怖い形」から来ない。**既知の身体図式が1箇所だけ壊れていること**から来る。全部回すと怪獣に戻る。

| つまみ | 機構 | 実装ルール |
|---|---|---|
| **目の数と配置** | 2つで正面＝顔＝キャラになる。0/1/奇数/多数で顔でなくなる | 既定は「目が無い」。眼窩位置に薄い皮膜。単眼は「収縮時だけ現れる」形が最も嫌 |
| **口の位置** | 顔にあると表情、腹面・末端・内側にあると器官 | 既定は腹面か体側。歯を見せるのは1種まで |
| **人間的部位の混入** | 1箇所なら強烈、2箇所以上で「人型モンスター」という別ジャンルの記号に落ちる | **1体1箇所厳守**（歯／爪／掌／声のどれか1つ） |
| **対称性の破れ** | 完全対称＝工業製品。完全非対称＝デッサン崩れ | **外形は左右対称、器官の数だけ非対称**（左に孔4・右に孔3） |
| **スケールの不整合** | 巨大なものの表面に微小構造が同精度で描かれると脳がサイズを測れない | 絵の中に**必ず同縮尺の比較物**を1つ。無い絵は納品しない |
| **質感** | **乾き／濡れ／繊毛**の3質感が1体に同居すると一気に生々しくなる | 頭部＝乾いた甲、後半＝濡れた粘膜、境界＝短い繊毛帯1列 |
| **周期のずれ** | 呼吸と別器官が別周期で動くと「制御されていない身体」に見える | idle は胴の呼吸0.9秒、排出孔3秒に1回と**素数的にずらす**。同期＝機械 |

現行 `enemies_v1.png`（環胞虫）は**このうち1つも回っていない**（左右対称・正面2眼・乾き一様・比較物なし）。等脚類の分節と淡青緑の発光斑（V95 / S7）は文法どおりで良い。**瞳を潰し、器官の数を左右でずらし、後半を濡らすだけで、同じ絵が原生種側へ移動する。**

### 7.3 機能の可読性

参照した作品の生物が「怖いのに納得できる」のは、**用途不明な突起が1つも無い**からである。器官の5枠を定義し、**1体につき最低3枠が絵から読めること**を納品条件にする。

| 枠 | 問い | 例 |
|---|---|---|
| 感覚器 | 何を探しているか | 髭・側線・膜・化学受容の房 |
| 捕食器 | 何を食べるか | 削り板・吻・糸・濾過触手 |
| 移動器 | どこをどう動くか | 掘削肢・吸盤・浮袋・多脚 |
| 防御器 | 何から逃げるか | 甲・粉の噴出・断尾・擬装 |
| 繁殖・拡散器 | どう増えるか | 胞子嚢・卵鞘・綿毛 |

**盤面挙動は必ずどれか1枠の副産物であること。** UI の矢印や枠線で挙動を補ったら、生物側の設計が失敗している証拠と見なす。

### 7.4 生態の匂わせ（体に付いた痕跡で描く）

背景を描き込んで説明してはいけない（盤上アイコンに落ちなくなる）。

1. **基質の付着**：岩粉が皮膚のしわに詰まる／苔の色素が体表に残る → どこに棲むかが分かる
2. **古い傷**：治癒した裂傷、欠けた甲の縁、折れて再生中の器官 → 天敵の存在と齢が分かる
3. **食痕と排出物**：口の周りの削りかす、下に落ちた粉の扇 → 何を食べるかが分かる
4. **姿勢**：**静止した見せポーズを禁止**する。必ず「今まさに何かをしている途中」で描く（測っている／削っている／吸っている）。これだけで生態の3割が伝わる
5. **生活史の余白**：幼生だけ描いて成体を描かない、脱皮殻だけ描く。全部説明しない

### 7.5 危険度の視覚化 ── 色ではなく「開く器官の数」

本作の環境色は暖色セピアと錆なので、**赤を危険に使うと環境と衝突する**。代わりに**形の開閉**で示す。これは生物学的にも正しい（開く器官＝捕食・排出・攻撃の機構）。

| 等級 | 開く器官 | 形の特徴 | UI印 |
|---|---|---|---|
| **観察級** | **0個** | 球・卵・団子。輪郭に凹みが無い | 灰青の一点印 |
| **警戒級** | **1個** | 一箇所だけ輪郭が割れる／裂ける | 琥珀の二点印 |
| **退避級** | **2個以上＋体積変化** | 輪郭が呼吸で変わる。中身が透ける | 朱の三点印 |
| **災害級** | 個体の輪郭が画面に収まらない | 全身像を描かない。断面・一部だけ | 黒金の環印 |

補助規則：
- **情報密度を危険度に比例させる。** 観察級は描線が少なく面が広い。退避級は描線が密で器官が多い。プレイヤーは「ごちゃごちゃした個体は危ない」と無自覚に学習する。
- **発光は情報。** 全種を光らせない。光る種は1〜2体に限定し、「光る＝誘引している＝罠」という規則を作る。
- **危険度の四段階は体表ではなく「発光点／印の色」で表す。** 体表は S≤25% に抑え、器官（口・触角・胞子嚢）だけ局所的に彩度を上げる。彩度を**情報の優先順位を示す予算**として使えば、8種を同時に出しても画面が濁らない。
- **兆候状態でのみ発光点が紙まで抜ける**設計にすると、「光ることが警告」になり、juice と可読性と画材が同時に成立する。

### 7.6 可愛さとの同居

参照した作品の生物に愛嬌があるのは、目が大きいからではない。次の3条件で作られている。

1. **体制が閉じている**（丸い・分節が球状・凹みが無い）
2. **鈍重である**（脚が短い、重心が低い）
3. **捕食者の口を持たない**（歯が見えない、口が小さい、あるいは口が無い）

つまり**可愛さは「危険度の低さの視覚化」と同じ手段で作られている**。だから可愛い個体と怖い個体が同じ世界に無理なく同居できる。

- 可愛い側の個体は**観察級に限る**。可愛い顔で退避級をやると「ダークファンタジー」の記号に落ちて安っぽくなる。
- **可愛い→怖いの変換は、形態を足さずに「開く」だけで行う。** 同じ丸い体に、開く仕組みが最初から仕込まれていた、という見せ方をする。これが機構として借りられる最も強い一撃。
- **随伴獣（マスコット）とは明確に分ける。** 随伴獣は衣装・道具・人工物を持つ。**原生種は人工物を一切持たない。** この一線を守れば、可愛い原生種が居ても随伴獣と混同されない。

### 7.7 現行8種の採点と補強

採点軸（各3点・満点15）：A 引用系統の適正／B 器官と挙動の対応／C 生態の匂わせ／D 危険度の可読／E シルエットの独自性

| 原生種 | A | B | C | D | E | 計 | 補強指示 |
|---|--:|--:|--:|--:|--:|--:|---|
| **崩れ穿ち** | 3 | 3 | 2 | 2 | 2 | **12** | §8 で完成 |
| **肺盗み** | 3 | 3 | 1 | 3 | 3 | **13** | 吸うのは捕食でなく**浮力の調整**。吸って浮き、吐いて沈む。探窟家の被害はただの巻き添えになる。この「悪意が無いのに致命的」が最も本質的な恐怖の作り方 |
| **盤殻** | 3 | 3 | 2 | 2 | 1 | **11** | 昆虫的な6本脚をやめ、**接地面の広い鋤状の脚を左右3対（数を左右で1本ずらす）**。背に貼る鉱物は**その層で実際に盤面に出ている駒と同じ意匠**に。擬装が盤面の事実と一致する |
| **環胞虫** | 3 | 3 | 1 | 2 | 2 | **11** | 食性を**床の蔦苔に走る菌糸**に固定。菌糸で個体同士が繋がるから伝播する、という因果を絵に描く（隣接個体の間に細い白糸1本）。床に破裂痕を1つ残す |
| **鐘脚** | 3 | 3 | 1 | 3 | 2 | **12** | 開いた内側に**濾過摂食の触手冠**を入れる。振動＝落石＝粒子の到来と誤認して開く。だから連鎖で開く |
| **糸釣蛾** | 2 | 3 | 2 | 2 | 1 | **10** | **「蛾」を捨てる。既知の昆虫名は未知を殺す。** 天井から下がる**幼生**として設計し、成体は一切描かない。名は形と挙動から取り直す |
| **苔舐め** | 1 | 3 | 3 | 2 | 1 | **10** | **「小型獣」＝哺乳類基底は禁止プール。** 有尾両生類へ基底を移す。「幅広い舌で巻き取る」は残す。体表に食べた苔の色が残る＝生態の匂わせとして最良なので必ず維持し、**個体ごとに色が違う** |
| **鏡綿** | 2 | 2 | 1 | 2 | 2 | **9** | 「反射」をやめ、**取り込んだ色素を腹の嚢に溜め、吐いて駒を染める**へ。腹が膨れているほど次の変換が近い、という可読性が生まれる |

**共通**：8種のうち**開く器官0個＝観察級で可愛い個体を1体だけ**確保する（環胞虫が適任）。ただし「群れると伝播する」という開かない怖さを持たせ、可愛さと危険を別軸にする。

---

## 8. 【崩れ穿ち】完成仕様

> **命名の未解決事項**：実装内の文字列は `裂坑掘り`（`r1_floor5.png` の札）だが、設計文書では `崩れ穿ち`。**発注前にどちらかへ統一すること。** 本書は `崩れ穿ち` を使う。内部 id は `burrower`。

### 8.1 挙動（実装済み・不変）

`SPEC_OXYGEN.md` より：HP6／兆候2手。予告が無ければ**自分から最も遠い2×2**を亀裂として予告。予告があればその4マスのうち駒が残るマスを3手 `seal` で封鎖し、**自分は空きセルへ移動**。**予告2×2の内側で1駒でも消すと予告が消える。**

### 8.2 生態的翻訳（挙動を全部「生き方」に読み替える）

| 挙動 | 生態 |
|---|---|
| 自分から**最も遠い**場所を掘る | 掘るのは餌のためではなく**逃走孔の事前確保**。天敵に追われたとき飛び込む縦孔を、あらかじめ離れた位置に開けておく |
| 掘った後に**自分が移動する** | 開けた孔の測点へ寄り、次の測定を始める。移動は結果であって逃走ではない |
| 予告内で1駒でも消すと**予告が消える** | 測定髭で地面の振動を測っている。予定地で振動が起きると「そこは既に崩れている／他個体が居る」と判断し、測り直す |
| 封鎖＝崩落 | **崩落そのものが採餌手段。** 崩れて潰れた小型群体種と、岩の割れ目を走る菌糸を、腹面の削り板で削り取る |

この読み替えにより、プレイヤーの盤面被害は「攻撃された」ではなく「**餌場を作られた**」になる。

### 8.3 体の構造（全身が描ける粒度）

- **基底**：扁平な**有尾両生類**（オオサンショウウオ／ホライモリ系）の体制。**接木**：前肢のみ**甲殻類の掘削肢**（ケラの前脚／シャコの捕脚）。**2系統厳守。**
- **全長**：成体 **22〜28cm**（人の前腕ほど。猫より小さい）。盤面1マス強に収まる比率。
- **形**：背腹に潰れた楔形。頭部が最も硬く、後方ほど柔らかい。尾は短く三角の鋤状で、掘った土を押し出す。
- **前肢1対**：異常に発達した鋤状。**幅は体幅の1.6倍。** 縁が石灰質で、先端は擦り減って欠けている。
- **後肢1対**：退化して短い。体を前へ押し出すだけ。**前後で全く違う形＝機能の可読性。**
- **眼**：**無い。** 眼窩の位置に薄い半透明の皮膜が張り、その下に退化した黒い眼点が透けて見える（かつて光を見た証拠＝生活史の匂わせ）。
- **測定髭**：口の左右から前方へ2本。硬く、先端の数cmだけ柔らかく膨らむ（振動受容器）。**静止時は地面に触れ、兆候時に両髭が同じ遠点へ揃う。**
- **口**：頭部の**腹面**（下向き）。上からは見えない。歯は無く、内側に角質の削り板が2枚（ヤスリ状）。
- **排粉孔**：頭頂から背にかけて、**左4対・右3対**（左右で数が違う）。ここから岩粉を噴く。**外形は対称、器官配置だけ非対称。**
- **開く器官は排粉孔のみ＝1個＝警戒級。**
- **器官5枠の充足**：感覚器（測定髭）／捕食器（削り板）／移動器（掘削肢）／防御器（粉の噴出）＝**4枠**。繁殖器は描かない（生活史の余白）。

### 8.4 体色

| 部位 | 色 | 実測条件 |
|---|---|---|
| 基調（岩粉色） | `#9A8E7C` 〜 `#7C7264` | S 約19%（hex 実測値。過去資料の「8〜14%」は hex と不一致だったので訂正） |
| 影 | `#4A5A55` | H161 / S18%。**純黒禁止** |
| ハイライト | `#E3D6B8` | S19%／白でなく古紙色／面積10%以内 |
| 排粉孔の縁 | `#A8613C` | 酸化した鉄錆。**体表面積の3%以内** |
| 髭の先端 | `#D8D2C4`（半透明の乳白） | 内部に淡い青緑の脈 `#6F9A94` が透ける |
| 輪郭線 | **`#2F2922`** | §2.1 の統一色 |

**発光させない。** この種は光を持たない。発光する種との差別化が世界の情報設計になる。

### 8.5 質感

- **頭部・前肢＝乾き**：石灰質の甲。微細な擦過痕、欠け、古い治癒痕。**縁が残るにじみ（hard edge）**で描く。
- **胴の後半＝濡れ**：粘膜。常に薄い水膜。**縁を作らないぼかし（soft edge）**で描く。
- **境界＝繊毛**：短い繊毛帯が一列（2mm程度）。**この3質感の同居が生物感の主機構。**

### 8.6 3状態（納品単位）

| 状態 | 姿勢 | 動き |
|---|---|---|
| **正面／idle** | 前肢を接地して体を低く伏せる。髭は床に触れる | 胴後半だけが1.1倍にゆっくり膨張（**0.9秒周期**）。排粉孔から細い粉が一筋（**3秒に1回**）。**周期を同期させない** |
| **兆候** | 頭を約10度持ち上げ、**両髭が予告2×2へ向かって揃う**。前肢の鋤を半分立てる | 排粉孔が全開し、体の粉が舞い上がる。**矢印や効果線を描かず、姿勢そのもので予告地点へ視線誘導する** |
| **被弾** | 頭を横へ振り、**髭が1本だけ折れて垂れる**（次の兆候までに再生） | 粘膜が白濁する。粉が横へ散る |

### 8.7 棲息域・食性

- **棲息**：深度4〜7。崩れやすい礫層と、菌糸の走る古い壁の境界。周囲に自分が開けた縦孔が複数あり、その壁面に岩粉が**扇状**に積もる。
- **食性**：崩落で潰れた小型群体種と、岩の割れ目を走る菌糸。岩そのものは食べない。
- **天敵**：不明（未観測欄に残す）。逃走孔を掘る習性から、上位捕食者の存在だけが推定される。

### 8.8 生態スケッチ1枚の構図

古紙に描かれた**博物学の野帳スケッチ**として提示する（一次資料の「探索記録 No.17」ページが版面の正）。

- 中央に全身の四分の三面図1点（**測っている最中**の姿勢）。
- 余白に器官の部分図2点（測定髭の先端断面／腹面の削り板）。
- **同縮尺の比較物を必ず1つ**：探窟家の手袋の指1本、または拳大の鉱石。
- 余白に鉛筆の縮尺目盛りを1本。
- 画面の 40% 以上が紙の白。彩色は部分的、暗部はハッチングで作る。**ここが「準白の在庫」を稼ぐ最良の場所。**
- **名札を焼き込まない**（文字はコード側描画。`ART.md §6` 準拠）。
- 逆光・霧・リムライト・ドラマチックな演出を使わない。**観察スケッチのフラットな光**で描く。

---

## 9. 生成プロンプトのテンプレート

### 9.0 発注の骨格（5ブロック固定順）

断片をばら撒くのではなく、常にこの順で連結する。

```
[1] 主題と用途を1文で
[2] 画材ブロック（下の MATERIAL を逐語でそのまま貼る。省略しない）
    ※テンプレ内の [[PASTE ...]] は日本語を含まない ASCII の目印。必ず置換してから送る
[3] 場合により追加（発光／床／UI／版面など、該当するものだけ）
[4] 禁止ブロック（下の NEGATIVE を逐語でそのまま貼る）
[5] 出力仕様（透過・比率・四隅アルファ検品）
```

**参照画像を添える場合は `mockups/ref_clean_*.jpg` のみを使う。** `user_v3_1.jpg` と `user_v3_2.jpg` には作品名が印字されており、vision モデルはそれを読む。プロンプトから作品名を除いた意味が消えるので、**原本を発注に投げてはいけない**。本作業で作成済み：

| 使ってよい参照画像 | 内容 |
|---|---|
| `mockups/ref_clean_parts.jpg` | 駒・UI・障害物・キャラ・背景テーマの素材集（題字帯を除去） |
| `mockups/ref_clean_screens.jpg` | 3テーマ×3画面のレイアウト（原本に作品名の印字なし） |
| `mockups/ref_clean_hero.jpg` | 縦穴の一枚絵（構図・スケールの正） |
| `mockups/ref_clean_flow.jpg` | 盤面・クリア画面・図鑑ページの版面 |

**`ART.md §3` の発注テンプレは参照画像を `b7_balanced.png` に固定したままなので、上記に差し替えること。**

---

### MATERIAL（必須・逐語）

```
Transparent watercolour washes over a fine ink line, on cold-press paper.
The brightest passages are bare unpainted paper — warm cream, not white —
and highlights stay between 15 and 22 percent saturation. Saturation peaks
in the midtones around 28 to 36 percent and falls away toward the light.
The darkest passage keeps 20 to 35 percent saturation and never drops below
luminance 22: there is no black and no neutral grey anywhere.
Shadows leave the hue of the light. Lit surfaces sit in warm ochre around
hue 35 to 45 degrees, and shadow falls to a single destination chosen for
the setting: olive around hue 65 to 85 for vegetation, blue-green around
hue 150 to 170 for wet stone and oxidised metal, slate blue around hue 210
to 230 for cold interiors.
The contour is a fine, slightly wobbly warm charcoal line near #2F2922 at
about 27 percent saturation — a near-neutral warm grey, not a saturated
brown. It swells on the underside and at overlaps and thins away to nothing
along the top-lit edge, and pigment pools in a hairline just inside it, no
wider than the contour itself, so the edge reads darker than the body.
Every form carries two kinds of edge at once: a hard dry edge where a wash
stops abruptly against the ink line, and one or two soft wet-in-wet blooms
inside the form.
The tooth of the cold-press paper and the granulation of the pigment stay
visible across every flat area, interface panels included; no surface is
perfectly smooth.
Where no wash is laid, darkening is done by drawn line: fine parallel
hatching and stipple in recesses and under overhangs.
```

### NEGATIVE（必須・逐語）

```
Avoid: airbrushed continuous gradients and smooth digital shading; a
uniform drop-shadow effect; a continuous bevel-and-specular metal render;
additive gaussian bloom or a glow halo around light sources; blur, fog or
depth-of-field used to push things back; pure black #000000 and pure white
#FFFFFF; saturated highlights above 50 percent saturation; a saturated
brown contour; uniform-width outline strokes; rounded-rectangle cards with
even padding and an even gold hairline; dotted underlines; perfectly
mirrored ornament and evenly spaced rivets; a flawless untouched surface;
rainbow or violet gradients; lens flare, rim light and dramatic backlight;
emoji; any lettering, numerals, logos or name plates.
```

---

### 9.1 原生種の生態スケッチ

```
A naturalist's field-note page from an expedition journal: one undescribed
cave animal drawn as an observational study on aged paper. At least forty
percent of the page is bare paper. The animal is a flattened salamander-like
tetrapod, about the length of a human forearm, wedge-shaped and pressed flat
from back to belly, hardest at the head and softer toward the tail, with a
short triangular shovel-shaped tail. Exactly one organ system is grafted
from another group: the forelimbs alone are enormous crustacean-style
digging shovels, one and a half times wider than the body, their rims
chalky and their tips worn and chipped. The hind limbs are reduced and
short — front and rear limbs are shaped completely differently because they
do different jobs. It has no eyes: a thin translucent membrane is stretched
where the sockets would be, with a vestigial dark eyespot faintly showing
through from beneath. Two stiff sensory whiskers project forward from the
sides of the mouth, soft and swollen only in the last few centimetres. The
mouth is on the underside of the head, invisible from above, toothless,
with two keratin rasping plates inside. Vent pores run from the crown down
the back — four pairs on the left and three on the right, counted
differently on each side while the outer silhouette stays bilaterally
symmetric.
Three textures coexist on the one body: dry chalky calcareous armour with
scratch marks, chips and healed old scars over the head and forelimbs; a
wet mucous membrane holding a thin film of water over the rear body; and a
single row of very short cilia along the seam between them.
It is drawn mid-action, low to the ground with its forelimbs planted and
both whiskers touching the floor as it measures — never in a neutral
upright display pose. Rock dust is packed into its skin folds and a fan of
pale powder has settled on the ground beneath it.
Colour: a desaturated rock-dust body from #9A8E7C to #7C7264 at about 19
percent saturation, shadows pushed to blue-green #4A5A55, highlights in
aged-paper cream #E3D6B8 rather than white and covering under a tenth of
the surface, a single oxidised rust accent #A8613C around the vent rims
covering under three percent of the surface. The animal emits no light of
its own.
Composition: the full body in three-quarter view at the centre, two small
margin studies of a single organ beside it, a same-scale reference object
in frame — a gloved human finger, or a fist-sized lump of ore — and a light
pencil scale bar in the margin. Flat observational lighting.
Layout is asymmetric and top-heavy, never centred; a single fine warm
grey-brown rule separates the margin study from the main figure; no boxed
frames. The paper is #EFE6D4 to #DCCFB6 with visible fibre and a few faded
foxing spots, a little browner and darker toward the outer edge as old
paper fades inward from its edge.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: one page, portrait, roughly 3 to 4 in aspect. No text, no
handwriting, no captions, no name plate, no scale numbers — all lettering
is composited later in code.
```

### 9.2 盤上アイコン（原生種トークン）

```
A single small creature token for a mobile puzzle board, to be read
instantly at the size of one board cell. A rounded, closed, blunt-bodied
segmented animal in a curled resting posture, its body plan taken from a
deep-sea isopod: overlapping chalky plates, short blunt legs tucked under,
low centre of gravity. It has no eyes and no visible mouth from above. Pale
mint bioluminescent spots sit on the plates, irregular in size and spacing,
their cores left as bare paper. Exactly one organ can open — a single seam
splits along one flank — and it is currently closed.
The plates are dry and chalky with chips and a healed scar; the underside
between the plates is a wet membrane with no edge to its shading; one row
of very short cilia runs along the seam between the two.
The outer silhouette is bilaterally symmetric but the spots and plates are
counted differently on each side. It carries no clothing, no tools, no
harness and no man-made object of any kind.
Colour: a low-saturation grey-green body under 25 percent saturation, rust
accent under three percent of the surface, shadow pushed to blue-green.
Silhouette must stay legible when reduced to a fifth of its size: a compact
rounded mass with one clearly broken contour.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, all four corners
transparent. Square. No baked drop shadow beneath the creature — it is
composited over a board tile in the engine. No text, no numerals.
```

### 9.3 背景（幕ごとの縦長背景）

**第一幕「空明かり」**

```
A tall vertical painted backdrop for a mobile game: the inside of an
enormous vertical shaft, seen from a ledge, with the camera tilted only
about eight degrees downward so the walls stay very nearly vertical on the
picture plane.
On the left and right edges, the trunks of colossal trees rise as near
foreground masses and run off both the top and the bottom of the frame, so
neither their roots nor their crowns are ever visible. Between them the
shaft falls away. Shelves of rock and masonry project from the walls: the
undersides of the shelves above the viewer and the top surfaces of the
shelves below the viewer are both described, so the viewer reads as
standing between them. One recognisable structure — a rope suspension
bridge — appears three times going back into depth, each time at about
sixty percent of the previous size, and it is the only thing measuring the
height. Two waterfalls begin at the top edge and dissolve into haze without
ever reaching a floor.
The light source is stated inside the picture: a bright slit of open sky at
the very top. Roughly one tenth of the picture is bare warm paper at that
slit and in the mist behind the middle distance, and that paper is the
brightest thing in the frame.
Depth is described by washing toward the cream of the paper and by rotating
hue from yellow-green in the near planes to blue-green in the far planes,
while saturation stays almost constant. Far planes are lighter and drawn
with fewer lines, but every line that is there is as crisp as the ones in
front — nothing is blurred and there is no fog gradient.
Ruined stonework is woven through the vegetation. The silhouette of every
ruin stays unbroken and legible as a former stair or arch; only the
interior surfaces are broken. Weathering follows gravity: moss and staining
collect on horizontal surfaces and on the lower third of vertical faces,
while the upper third stays comparatively clean, and a vertical water stain
runs down from the lip of every shelf. Two ages of material coexist — very
old stone with rounded arrises, and newer brass and iron that still has
crisp edges and has oxidised to green-blue. The masonry blocks are far too
large for a human to have laid.
Exactly one small warm light source — a hanging lamp — sits in the upper
third; there is no second warm accent anywhere.
Overall colour: median saturation about 20 percent, median luminance about
85, and pixels above 45 percent saturation cover no more than eight percent
of the picture.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: one continuous vertical painting, aspect roughly 1 to 5, with no
horizontal seams or panel divisions. No text, no logos, no user interface
elements, no characters.
```

**第二幕「炉あかり」／第三幕「岩あかり」への差し替え**（同テンプレの該当箇所のみ置換）

| | 第二幕 | 第三幕 |
|---|---|---|
| レプソワール | 巨大な鋳鉄の柱と縦の配管 | 天井から下がる巨大な結晶の束 |
| 反復モジュール（0.6倍×3） | 迫り出した鉄の歩廊 | 石の踏み段のアーチ |
| 落下するリボン | 錆びた鎖と蒸気の柱 | 落ちる水と細かい結晶の砂 |
| **光源の申告** | `a row of hanging oil lamps and the open mouth of a furnace` | `the rock itself is faintly luminous — the stone strata glow from within` |
| 色相 | `warm ochre-grey brass, hue 34 to 40` | `slate blue to blue-violet, hue 228 to 242` |
| 数値 | median S **15–19%** / median luma **62–72** / S≥45% ≤ **5%** | median S **30–36%** / median luma **68–78** / S≥45% ≤ **22%** |
| 追記 | — | `the field itself stays a deep slate; high chroma is spent only on the crystal facets that carry light` |

### 9.4 UI 素材

**(a) 盤のセルタイル（1マス分・9スライス不要）**

```
A single square floor slab used as one cell of a puzzle board, painted as a
carved stone plate. The slab is a rounded square with a chamfered edge. Its
upper and left inner edges catch light from above and read about twenty
luma brighter than the face; the lower and right edges fall away into
shadow. A narrow darker joint runs around the outside where the mortar sits,
about ten to fifteen luma below the face. Small forged rivets sit near two
of the four corners — not all four, and not evenly spaced. The stone face
is warm brown-grey around #343028 at about 24 percent saturation, mottled,
with grit and a little moss caught in the joint on one side only. Every
slab in a set differs from its neighbours by roughly twelve to fifteen luma
and by the shape of its chipping, so no two are identical and the surface
never reads as a repeating tiled texture.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, square, straight
outer edges. Provide the set as nine variants on one sheet, evenly gridded.
No text, no numerals, no icons on the slab.
```

**(b) 羊皮紙プラーク（HUD の札・9スライス）**

```
An aged parchment plaque for a game interface, painted rather than vectored,
intended to have a numeral drawn on top of it later. Ivory paper from
#DCCFBC to #EFE4CC with visible fibre and a few faded foxing spots, a
little browner and a little darker toward the outer edge as old paper fades
inward from its edge, so ink at #3A2E20 will read cleanly on the centre.
The edge is an irregular hand-painted brass-brown rim with real thickness,
about one twentieth of the plaque's short side: a darker inner line
#3A2C1E and a lighter outer line #B99A5E offset by a hairline, so it reads
as a bevel made of material rather than as a stroke. Two small pin rivets
sit at opposite corners, one of them slightly off-centre. The sheet is
faintly cockled and worn unevenly, more on one side than the other.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, all four corners
transparent, with a uniform stretchable middle suitable for nine-slice.
Landscape, roughly 3 to 1. No text, no numerals.
```

**(c) 円形メダリオン（数値の容器）**

```
A circular cast-bronze medallion used as the housing for a counter in a
game interface. A raised outer ring carrying six small rivets — unevenly
spaced, one of them slightly off-centre — encloses a recessed dark brown
inner field around #4A3A26. The inner field is flat enough and dark enough
that ivory lettering will read on it later, sitting around luminance 60 to
70, and it is left completely empty.
The ring is warm brass #9A7B44 at about 35 percent saturation — a dulled,
aged brass, not a bright gold. Green-blue patina #4A6155 collects in the
low points and along the underside. A warm-white #F6EBDA highlight appears
only across the upper-left arc, and it is broken: it stops where the metal
is pitted, and never runs continuously around the rim. One nick in the
outer edge, on one side only.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, square, all four
corners transparent. No text, no numerals, no symbols in the centre.
```

**(d) 資源ゲージ（筐体と充填を別レイヤーで）**

```
A slim horizontal gauge housing for a mobile game resource bar, shaped like
a lamp-oil sight glass set in a brass tube. The tube is deliberately slim —
roughly eight times wider than it is tall — with a brass collar at each end
and three small rivets that are not evenly spaced. A curved glass front
carries one thin specular streak along the top which is broken in two
places and does not run the full length. Behind the glass the empty trough
is a cool patina teal #3E5450 at about 26 percent saturation and 33 percent
value.
Supply the fill as a separate sheet: a settled amber oil #B98A3E at about
66 percent saturation and 73 percent value — deliberately duller than a
gemstone, with a slightly darker meniscus at its leading edge.
The brass is aged, with green-blue patina in the recesses and broken
highlights only.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: two sheets, fully transparent background, PNG with alpha, with a
horizontally stretchable centre suitable for nine-slice. No text, no
numerals, no tick labels.
```

**(e) 野帳カード（ドラフト画面）**

```
A single sheet of aged expedition notepaper torn from a bound journal, used
as a card in a draft screen. The left edge is deckled and irregular with
visible fibre tufts and two small punch holes; the other three edges are
cut. Paper #E4D6B6 with fibre texture, a ghost of faint horizontal ruling,
three or four tea-coloured stains, and an outer edge a little browner and
darker than the centre. One corner is slightly curled and casts a small
soft shadow onto the card itself — a shadow that is drawn, uneven, and
explained by light coming from the upper left. A matte dark red wax seal
blob sits at the upper-left corner, not glossy, its edge irregular where it
was pressed.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, suitable for
nine-slice with the deckled edge on the left only. Portrait, roughly 3 to 2.
No text, no ruled writing, no numerals.
```

### 9.5 キャラクター

**(a) 探窟家のバスト（盤上に立つ主体）**

```
A bust portrait of a young cave explorer for a mobile game, to be occluded
from the chest down by the top rail of a game board, so the composition
must stay readable from the shoulders up.
A rounded helmet with a single pair of goggles pushed up onto the brow, a
heavy canvas coat in dulled olive with worn leather straps and brass
buckles that have oxidised green-blue in the recesses, oversized padded
gloves, and the top of a pack showing over one shoulder. The gear is used:
scuffed leather, a repaired seam, dust caught in the stitching, one buckle
replaced with a mismatched one. Nothing is shiny.
The figure is turned slightly and looks off toward one side rather than
straight out at the viewer — an expression of alert curiosity rather than a
pose. Lighting is soft and comes from above and slightly in front, matching
daylight falling down a shaft; there is no rim light and no backlight.
Colour: the coat under 25 percent saturation, skin and hair in warm ochre,
with the highest saturation reserved for a single small accent — the glass
of the goggles — covering under three percent of the figure.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, all four corners
transparent. Portrait. No baked drop shadow and no alpha fade at the bottom
edge — the figure is cut off cleanly and is occluded in the engine. No text.
```

**(b) 随伴獣（マスコット）**

```
A small companion creature that travels with a cave explorer, designed to
read as tame and domestic rather than wild. A rounded, closed, low-slung
body covered in short dense fur, stubby limbs, a low centre of gravity, no
visible teeth and a small simple mouth — its charm comes entirely from
being closed, blunt and slow, not from large eyes.
Crucially, it wears man-made things: a small oiled cape, a scaled-down
helmet, a brass fitting or two, a tiny pack. These artefacts are what
separate a companion from wild fauna, and no wild creature in this world
carries any.
The gear is worn and slightly too big for it, mended in one place. Fur is
dulled and dusty, a paler patch on one flank only.
Colour: fur under 20 percent saturation in warm greys and creams, the cape
in a dulled olive or slate, one rust accent under three percent of the
surface.

[[PASTE THE MATERIAL BLOCK HERE VERBATIM]]
[[PASTE THE NEGATIVE BLOCK HERE VERBATIM]]

Output: fully transparent background, PNG with alpha, all four corners
transparent. No baked drop shadow. No text.
```

### 9.6 組み立て済み完成例（【崩れ穿ち】生態スケッチ・そのまま送れる）

§9.1 に MATERIAL と NEGATIVE を差し込んだ完成形。**このブロックは一切の置換なしでコピペできる。** 他の用途はこれを雛形に、主題部（先頭の1〜3段落）だけを差し替える。

```
A naturalist's field-note page from an expedition journal: one undescribed
cave animal drawn as an observational study on aged paper. At least forty
percent of the page is bare paper. The animal is a flattened salamander-like
tetrapod, about the length of a human forearm, wedge-shaped and pressed flat
from back to belly, hardest at the head and softer toward the tail, with a
short triangular shovel-shaped tail. Exactly one organ system is grafted
from another group: the forelimbs alone are enormous crustacean-style
digging shovels, one and a half times wider than the body, their rims
chalky and their tips worn and chipped. The hind limbs are reduced and
short — front and rear limbs are shaped completely differently because they
do different jobs. It has no eyes: a thin translucent membrane is stretched
where the sockets would be, with a vestigial dark eyespot faintly showing
through from beneath. Two stiff sensory whiskers project forward from the
sides of the mouth, soft and swollen only in the last few centimetres. The
mouth is on the underside of the head, invisible from above, toothless,
with two keratin rasping plates inside. Vent pores run from the crown down
the back — four pairs on the left and three on the right, counted
differently on each side while the outer silhouette stays bilaterally
symmetric.

Three textures coexist on the one body: dry chalky calcareous armour with
scratch marks, chips and healed old scars over the head and forelimbs; a
wet mucous membrane holding a thin film of water over the rear body; and a
single row of very short cilia along the seam between them. It is drawn
mid-action, low to the ground with its forelimbs planted and both whiskers
touching the floor as it measures — never in a neutral upright display
pose. Rock dust is packed into its skin folds and a fan of pale powder has
settled on the ground beneath it.

Colour: a desaturated rock-dust body from #9A8E7C to #7C7264 at about 19
percent saturation, shadows pushed to blue-green #4A5A55, highlights in
aged-paper cream #E3D6B8 rather than white and covering under a tenth of
the surface, a single oxidised rust accent #A8613C around the vent rims
covering under three percent of the surface. The animal emits no light of
its own.

Composition: the full body in three-quarter view at the centre, two small
margin studies of a single organ beside it, a same-scale reference object
in frame — a gloved human finger, or a fist-sized lump of ore — and a light
pencil scale bar in the margin. Flat observational lighting. Layout is
asymmetric and top-heavy, never centred; a single fine warm grey-brown rule
separates the margin study from the main figure; no boxed frames. The paper
is #EFE6D4 to #DCCFB6 with visible fibre and a few faded foxing spots, a
little browner and darker toward the outer edge as old paper fades inward
from its edge.

Transparent watercolour washes over a fine ink line, on cold-press paper.
The brightest passages are bare unpainted paper — warm cream, not white —
and highlights stay between 15 and 22 percent saturation. Saturation peaks
in the midtones around 28 to 36 percent and falls away toward the light.
The darkest passage keeps 20 to 35 percent saturation and never drops below
luminance 22: there is no black and no neutral grey anywhere.
Shadows leave the hue of the light. Lit surfaces sit in warm ochre around
hue 35 to 45 degrees, and shadow falls to a single destination chosen for
the setting: olive around hue 65 to 85 for vegetation, blue-green around
hue 150 to 170 for wet stone and oxidised metal, slate blue around hue 210
to 230 for cold interiors.
The contour is a fine, slightly wobbly warm charcoal line near #2F2922 at
about 27 percent saturation — a near-neutral warm grey, not a saturated
brown. It swells on the underside and at overlaps and thins away to nothing
along the top-lit edge, and pigment pools in a hairline just inside it, no
wider than the contour itself, so the edge reads darker than the body.
Every form carries two kinds of edge at once: a hard dry edge where a wash
stops abruptly against the ink line, and one or two soft wet-in-wet blooms
inside the form.
The tooth of the cold-press paper and the granulation of the pigment stay
visible across every flat area, interface panels included; no surface is
perfectly smooth.
Where no wash is laid, darkening is done by drawn line: fine parallel
hatching and stipple in recesses and under overhangs.

Avoid: airbrushed continuous gradients and smooth digital shading; a
uniform drop-shadow effect; a continuous bevel-and-specular metal render;
additive gaussian bloom or a glow halo around light sources; blur, fog or
depth-of-field used to push things back; pure black #000000 and pure white
#FFFFFF; saturated highlights above 50 percent saturation; a saturated
brown contour; uniform-width outline strokes; rounded-rectangle cards with
even padding and an even gold hairline; dotted underlines; perfectly
mirrored ornament and evenly spaced rivets; a flawless untouched surface;
rainbow or violet gradients; lens flare, rim light and dramatic backlight;
emoji; any lettering, numerals, logos or name plates.

Output: one page, portrait, roughly 3 to 4 in aspect. No text, no
handwriting, no captions, no name plate, no scale numbers — all lettering
is composited later in code.
```

---

## 10. ネガティブ指定（生成時に必ず添える禁止事項）

§9 の `NEGATIVE` ブロックが本体。その根拠と、AI っぽさ回避の追加項目を以下にまとめる。

### 10.1 画材の署名を消す

| 禁止 | 理由 |
|---|---|
| エアブラシ的連続グラデ／滑らかなデジタル陰影 | hard edge が消え、筆で置いた痕跡が出なくなる |
| 一様なドロップシャドウ効果 | フィルタの署名。描いた接地影は可（§3.6） |
| 連続したベベル＋スペキュラ | **CG 金属を偽物に見せている当のもの。** ハイライトは腐食箇所で途切れさせる |
| 加算合成のガウス発光ハロ（静止物） | 「発光レイヤーが乗っている」に見える。状態遷移の瞬間のみ可（§4.3） |
| ぼかし・霧グラデ・被写界深度で奥へ押す | 遠近は明度・色相・線の本数で作る |
| 均一太さのアウトラインストローク | インクではなくベクターに見える |
| 均一なタイリングテクスチャの石 | 1枚ずつ値の違う石として描く |

### 10.2 色の禁止

純黒 `#000000`／luma 22未満／純白 `#FFFFFF`／S≧50% の明部／彩度の高い焦茶の輪郭（S50超＝ステッカーに見える）／紫の広い面・紫の UI・紫の金属／`#FF6B5A` の画面赤／深度が増すほど彩度が上がる背景（**幕ごとの予算内なら可**、§2.2）。

### 10.3 「AIっぽい没個性」の署名（Playlab 方針に直結）

- **角丸18px・均一余白・均一縁のカードを並べる**（マテリアルデザインのカード＝最も強い署名）
- **点線・破線のアンダーライン**（HTML リンクに見える）／**灰地に灰文字の角丸ボタン**（無効化された HTML ボタンに見える）
- **要素を非交差の箱として積む**（重なりゼロ＝入力フォーム）
- **キャラを画面中央に置く**／**アルファグラデーションでフェードアウトさせる**（デカールの署名）
- **完全な左右対称・等間隔のリベット・シンメトリな装飾文様**
- **全身を覆う一様な鱗テクスチャ／均等間隔で並んだ発光斑／虹色グラデーション**
- **無傷でツルツルの体表**（必ず欠け・擦過痕・付着物で「使われてきた体」にする）
- **逆光・霧・リムライト・レンズフレア**で凄みを演出する
- **絵文字**、意味のない装飾
- **呼吸と他器官のアニメ周期を同期させる**（同期＝機械、非同期＝生物）

### 10.4 生物固有の禁止

哺乳類基底（毛皮＋四肢＋前向き2眼）／大きな正面2眼で可愛さを作る／原生種に衣装・帽子・道具を着せる／用途を説明できない角・トゲ・鰭・翼を足す／4系統以上の混成／危険を赤色で表す／人間的部位を2箇所以上入れる／全種を光らせる／盤面挙動を UI の矢印で補う／背景を描き込んで生態を説明する／可愛い個体に退避級以上の役割を与える／比較物の無い生態スケッチを納品する／能力を全部言う名前を付ける（名は形・棲息・不気味さのうち2つまでに圧縮する）。

### 10.5 発注そのものの禁止

- **プロンプトに作品名・作者名・キャラクター名・作中固有生物名を入れない。**
- **作品名の代わりになる圧縮スタイルハンドルも入れない。** 過去の断片にあった `delicate fantasy manga watercolor` は挙動が記述されておらず制御不能で、しかも `manga watercolor` はセル塗り＋エアブラシ影を引き寄せるため、`MATERIAL` ブロックの「エアブラシ禁止」と正面から衝突する。**画材そのものを名指しする語（`transparent watercolour over fine ink line on cold-press paper`）に置き換える。**
- **絶対ピクセル指定を書かない。** 出力解像度は API 側で決まり、モデルは「160px」を寸法として解釈しない。効くのは比率指定（`roughly eight times wider than tall`）だけ。効かない指定はトークン枠を占め、効く指定の相対的重みを下げる。
- **作品名の印字がある参照画像（`user_v3_1.jpg` / `user_v3_2.jpg`）を投げない。** `ref_clean_*.jpg` のみを使う。
- **禁止は必ず肯定形の代替を先に置く。** 否定形は追従が不安定で、否定対象の語自体が正の重みとして働くことがある（`the brightest passage is bare paper — never white paint` の順序で書く）。

---

## 11. 検収基準

### 11.1 機械測定（`scripts/art_check.py` として実装する）

標本条件（§0）ごとにゲートを分ける。**レイヤーを分けないと数字が意味を持たない。**

#### A. S-画面（合成後のゲーム画面）

| 指標 | 合格ライン | 一次資料実測 | 実機現況 |
|---|---|---|---|
| **V≧85% 画素の平均彩度**（プレイ画面） | **≤ 22%** | 17.1 / 18.6 / 21.5% | **48.3% ✗** |
| **V≧85% 画素の平均彩度**（クリア・祝祭画面） | **≤ 38%** | 36.4 / 37.2 / 37.3% | — |
| **S≧45% 画素の面積** | **≤ 14%** | 10.1 / 13.8 / 12.2% | **21.1% ✗** |
| 全体の平均彩度 | ≤ 32% | 26.1 / 31.1 / 25.3% | **34.0% ✗** |
| 最暗5% の luma | **≥ 22** | 28.9〜35.1 | 33.4 ✓ |
| 最暗5% の彩度 | **≥ 20%** | 33% | 34% ✓ |
| **V≧85% 画素の面積** | 参考値のみ（ゲートにしない） | 1.74〜3.79% | 3.43% |

> **面積をゲートにしない理由**：面積は一次資料と実機で既に同等であり、良し悪しを弁別しない。しかも祝祭画面（47%）とプレイ画面（2%）で桁が違う。**弁別しているのは彩度である。**

#### B. S-素材（背景アセット単体）

| 指標 | 合格ライン | 一次資料実測 | 実機現況 |
|---|---|---|---|
| **V≧85% 画素の面積** | **≥ 9%** | 9.4〜14.0% | forest 0.43 / machine 1.01 / crystal 0.93 **✗✗✗** |
| **V≧85% 画素の平均彩度** | **≤ 15%** | 9.8〜13.0% | forest 3.8 ✓ / machine 24.4 ✗ / crystal 44.0 ✗ |
| **中央値 luma** | 幕ごと（§2.2） | 67.1〜87.2 | 66.1 / 44.0 / 47.8 **全て20以上低い ✗** |
| **中央値 彩度** | 幕ごと（§2.2） | 17.1〜34.0% | 18.9 ✓ / **9.1 ✗** / **53.1 ✗** |
| **S≧45% 画素の面積** | 幕ごと（§2.2） | 3.0〜20.3% | 1.7 ✓ / 4.8 ✓ / **90.8 ✗** |
| **中央帯のエッジ密度** | 上帯の **70% 以上** | ±25% 以内 | 22〜28% **✗** |

#### C. S-素材（透過素材。`alpha>200` の画素のみ）

| 指標 | 合格ライン | 実機現況 |
|---|---|---|
| **下位8%分位の平均彩度（＝輪郭インク）** | **≤ 30%** | pieces_v5 46.8% ✗ ／ pieces_rogue 69.8% ✗ |
| **V≧85% 画素の平均彩度** | ≤ 25% | sprites3 27〜33% △ |
| **内部の高周波エネルギー**（`L − Gaussian(σ=2)` の平均絶対差、48px 正規化） | **≥ 12** | 駒 11.2〜12.3 △ ／ **hud_kit_v5 3.52 ✗** |
| 四隅のアルファ | 完全透過 | ✓ |
| 落ち影の焼き込み | 無いこと | pieces_rogue **✗** |

#### D. S-下地（盤）

| 指標 | 合格ライン | 一次資料実測 | 実機現況 |
|---|---|---|---|
| 平均 luma | **45〜50**（上げない） | 46.4〜48.8 | 45.0 ✓ |
| セル間の標準偏差 | **4〜5** | — | 2.6 **✗** |
| 目地線と下地の差 | −10〜15 luma | — | ほぼ0 ✗ |
| 受光ベベルと下地の差 | +18〜25 luma | — | 無し ✗ |
| 色相がテーマに追従しているか | §5.4(e) | 森H42/機械H38/結晶H293 | 単一色相 ✗ |

### 11.2 目視チェックリスト（生成物1点ごと）

**画材**
- [ ] 最も明るい場所は「塗り残しの紙」に見えるか。明るい絵の具になっていないか
- [ ] 1つの物の中に hard edge と soft edge が両方あるか
- [ ] 平面に紙目と顔料のムラが残っているか。UI パネルの内部にも残っているか
- [ ] 輪郭が可変幅で、影側で太り、上面で途切れているか
- [ ] ウォッシュの無い暗部がハッチングで作られているか

**色**
- [ ] 純黒・純白が無いか
- [ ] 影に色相があるか（灰色になっていないか）。行き先が場に合っているか
- [ ] 明るい部分に彩度が残っていないか
- [ ] 高彩度が「情報を持つ数点」に集中しているか。地に散らばっていないか

**構図**
- [ ] 上下フレーム外へ逃げる垂直の質量があるか
- [ ] 棚の下面と上面が両方描かれているか
- [ ] 同一モジュールが 0.6 倍で3回反復しているか（＝絵に定規があるか）
- [ ] 落ちるものが着地していないか
- [ ] 光源が画面内に描かれているか
- [ ] 暖色の点光源が**ちょうど1個**、上端35%にあるか
- [ ] ぼかし・霧で奥へ押していないか

**UI・文字**
- [ ] 全ての数字が札の上に載り、地との Δluma ≥ 120 か
- [ ] 縁取り（stroke）がゼロか
- [ ] 平坦な塗り＋均一線のパネルが残っていないか
- [ ] 線が2本（内暗・外明・1pxオフセット）になっているか
- [ ] リベット・打刻が左右で揃っていないか
- [ ] 重なりが3箇所以上あるか
- [ ] 黒（`#1A1410` の接地影以外）が画面に無いか

**生物**
- [ ] 系統は2つ以内か。3つ目を接いでいないか
- [ ] 接木器官が環境5変数のどれかへの適応として説明できるか
- [ ] 器官5枠のうち3枠以上が絵から読めるか
- [ ] 用途を説明できない突起がゼロか
- [ ] 外形は左右対称、器官の数は左右非対称か
- [ ] 乾き／濡れ／繊毛の3質感が同居しているか
- [ ] **同縮尺の比較物が画面内にあるか**
- [ ] 「何かをしている途中」の姿勢か。見せポーズになっていないか
- [ ] 体に痕跡（付着物・古傷・食痕）があるか
- [ ] 開く器官の数が、意図した危険度と一致しているか
- [ ] 人工物を着ていないか（原生種の場合）

**発注の衛生**
- [ ] プロンプトに作品名・作者名・キャラ名・作中固有生物名が無いか
- [ ] 圧縮スタイルハンドル（`... manga watercolor` 等）が無いか
- [ ] 絶対ピクセル指定が無いか（比率に翻訳したか）
- [ ] 参照画像が `ref_clean_*.jpg` のみか

### 11.3 現行アセットの判定（本書の基準による）

| アセット | 判定 | 根拠 |
|---|---|---|
| `assets/ui/upg/*.png`（強化20種） | **合格・内部基準とする** | 明部が羊皮紙まで抜け、線が細く、ロンデルが左右非対称（片側が石・片側が蔦）、ハイライトが途切れている。**パイプラインが正しい文法を出せる証拠** |
| `assets_src/bust2_*.png` | **準合格** | 線・彩色・紙目は全アセット中最良。最明部が紙まで抜けない。ゴーグル硝子と金具に S≤10% の白点を足せば到達 |
| `assets/sprites3/p*.png` | **部分合格** | ハイライトは白へ抜けている。暗部の彩度が過多（`p0_gear` 最暗5% が S78%）。輪郭を `#2F2922` へ |
| `assets_src/enemies_v1.png` | **要改修** | 発光斑（V95/S7）と分節は文法どおり。**正面2眼を潰し、器官数を左右でずらし、後半を濡らす** |
| `assets_src/pieces_rogue.png` | **要修正** | 輪郭 S69.8%。落ち影が焼き込まれている（`ART.md §6` 違反） |
| `assets_src/hud_kit_v5.png` | **不合格・最優先で描き直し** | HF 3.52（基準12）。連続ベベル、等間隔リベット、紙目ゼロ。**別画材** |
| `assets_src/frame_v4.png` | **不合格** | 全帯で暗く彩度が高い。受光辺と影辺の区別がなく、均一タイリング |
| `assets_src/bg_forest.png` | **要修正** | 彩度は合格。準白 0.43%（基準9%）、明度が21低い |
| `assets_src/bg_machine.png` | **不合格** | S中央値 9.1%（基準15〜19%）＝無彩に落ちている。準白 1.01% |
| `assets_src/bg_crystal.png` | **不合格** | S中央値 53.1%・S≧45% が 90.8%（基準22%）。全結晶に常時ハロ |

### 11.4 着手順（効き目 ÷ コスト）

| 順 | 施策 | 効き目 | コスト |
|---:|---|---|---|
| 1 | 数字を Archivo 600 等幅に分離＋`stroke` 全廃＋`fontWeight` を数値指定に | 極大 | 1時間 |
| 2 | 駒の輪郭を `#2F2922`（S27%）へ。落ち影の焼き込みを除去 | 極大 | 半日 |
| 3 | 黒カプセルを羊皮紙札（9スライス）に置換 | 極大 | 半日 |
| 4 | 盤のセル分節（受光ベベル＋目地＋±12〜15 luma のムラ）。**明度は上げない** | 大 | 半日 |
| 5 | 酸素ゲージの彩度・高さを落とし、数字をメダリオンへ。HUD 背景板を廃す | 大 | 半日 |
| 6 | キャラを左1/3へ移し、相棒を同伴させ、盤上辺でハード遮蔽 | 大 | 2時間 |
| 7 | `hud_kit_v5` 一式を紙目つきで描き直し | 大 | 1日 |
| 8 | 背景3枚を明度+20・幕ごとの彩度目標で再生成（準白 ≥9%） | 大 | 1日 |
| 9 | ドラフト画面の9スライス化・微回転・筆線下線 | 大 | 1日 |
| 10 | 背景3面パララックス（1.00 / 0.55 / 0.25） | 中 | 1日 |

---

## 12. `ART.md` への差し戻し（本書確定に伴う修正）

1. **§2 パレット表**を本書 §2.1 の暖色セピア群で置き換える。v1 由来の「深界ティール `#1E4D5C`」「盤面下地の濃紺 `#16283B`」を明示的に廃止する。`#D9A441` は「単色ヘアライン用途では使用禁止、面の中間色としてのみ可」と注記。
2. **§2 に盤下地のテーマ追従を追記**：森 `#343028` H42 S24% ／ 機械 `#342D22` H38 S34% ／ 結晶 `#2F2D2F` H293 S4%（いずれも luma 45〜50）。
3. **§3 発注テンプレ**を本書 §9.0 の5ブロック骨格に置き換える。参照画像を `b7_balanced.png` から `mockups/ref_clean_*.jpg` へ差し替える（§3 の更新漏れ）。
4. **§4 の駒名表**（陽盤・芽石・雫瓶・月角・花石）を削除し、v3 の駒（葉／結晶／花／キノコ／鉱石）に一本化する。二重定義のままだと発注で事故る。
5. **§5 アセット一覧**に「吹き出し札」「★3進捗レール」「盤セルタイル9変種」を追加する。
6. **§6 の透過取得手順**を明記する：「透過は α で取得し、失敗時のみクロマキー（`_*_chroma.png`）へフォールバック」。現在 α 版とクロマキー版が併存しており、どちらが正か文書化されていない。
7. **§6 の「数字はコード描画」は維持する。** 本書 §6.2 のとおり数字グリフの画像生成は行わず、フォント描画に紙目とインク輪郭をプログラムで適用する方式を採るため、`ART.md §6` との衝突は発生しない。
