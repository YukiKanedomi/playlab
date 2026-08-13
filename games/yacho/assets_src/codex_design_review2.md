# AD v3 デザイン照合レビュー（2026-08-13）

## 判定基準

- 正本は `mockups/user_v3_1.jpg`（企画全体）、`mockups/user_v3_2.jpg`（キャラクター／駒／障害物／ブースター／UI部品）、`mockups/user_v3_3.jpg`（森・機械遺構・結晶洞窟のゲーム／マップ／クリア画面レイアウト）および `ART.md` 冒頭の「AD v3 の要点」。
- 優先度は **高 → 中 → 低**。高は正本との同一性、進行理解、または表示成立を損なうもの、中は品質・統一感・可読性を大きく損なうもの、低は仕上げ上の差分。
- 画像再生成には、特記がない限り次の共通指定を必ず先頭に置く：`Open and study mockups/user_v3_2.jpg and mockups/user_v3_3.jpg. Delicate fantasy manga colour illustration, very fine slightly wobbly ink contours, transparent watercolour washes, warm muted sepia, low-to-medium contrast, weathered matte materials, aged-paper accents, faint prismatic pastel shimmer; no pure black, no hard vector outline, no glossy mobile-game rendering, fully transparent PNG with alpha.` 背景のみ `fully transparent` を外し、縦長一枚絵と指定する。

## 優先度順の指摘

1. **［高］`app_clear.png` がクリア画面になっていない（表示／検証不成立）**
   - **差分**：`user_v3_3.jpg` 下段③は「テーマ別リボン見出し → 大きな3星 → スコア／ハイスコア → キャラクターと相棒 → 大きな『つぎへ』」が一画面で成立している。一方 `app_clear.png` は通常の森プレイ画面のままで、クリアパネル、暗転、リボン、星、結果数値、次ボタンが一切見えない。現在の納品画像だけではクリア画面をレビューできず、目立つレンチ駒が一個ある通常盤面を誤って「clear」として記録している。
   - **具体修正**：`src/main.ts:574-578` の `board.won` 到達、`triggerWin()`、`src/main.ts:621-625` の `showClearPanel()` 呼び出しを計測ログで確認し、勝利後のドレイン終了を待って撮影する。スクリーンショット自動化側は勝利入力後、`showClearPanel` にテスト用フック／DOM・Pixi状態フラグを立て、それを待ってから撮る（固定待機なら現行のバナー 1,500ms＋`view.play(evs)` より後、少なくとも 4秒）。表示されない実機バグなら `tw.delay(dur, ...)` の `dur` と `alive()` を調査し、パネル生成直後に `playRoot.addChild(panel)` が必ず実行されることまで確認する。

2. **［高］3テーマの探窟家が正本キャラクターと別物（オーナー指摘1を確認）**
   - **差分**：`user_v3_2.jpg` 上段と `user_v3_3.jpg` 各①の人物は、頭身が低く、くすんだオリーブ／カーキ／焦茶の重装備、使い込んだ丸兜・ゴーグル・背嚢・ベルト、小さな点状ハイライト、落ち着いた表情の「風雨にさらされた洞窟探検隊」。現状は共通して肌と瞳の彩度が高く、輪郭が太く滑らか、頬が明るい、装備が新品で、現代的な“明るいアニメかわいい胸像”に寄っている。
   - **テーマ別差分**：森は正本のゴーグル付き丸兜・オリーブ装備の少年に対し、現状は帽子がほぼ隠れた緑フードの快活な少年。機械遺構は正本の灰髪の人間探窟家＋丸い青眼機械相棒に対し、現状は画面を占める擬人化モグラ／猫で、種族もシルエットも違う。結晶洞窟は正本の白〜淡青髪、灰白フードコート、杖の少女＋キノコ相棒に対し、現状は緑髪、黄土ジャケットの少女で、テーマ色と装備が逆。
   - **具体修正（再生成）**：共通発注句に、森は `Use user_v3_2 top row, first explorer and user_v3_3 column A character as the exact design reference: muted olive expedition coat, weathered round helmet with brass goggles, brown scarf, layered belts and backpack, calm small smile, 2.5-head chibi proportions, waist-up front view.`、機械は `Use user_v3_2 top row grey/white-haired explorer and user_v3_3 column B: human cave explorer, ash-grey hair, worn khaki helmet and goggles, brown expedition gear; include the small round one-blue-eye brass robot only as a separate companion asset; absolutely no animal-person.`、結晶は `Use user_v3_2 top row hooded pale-haired explorer and user_v3_3 column C: pale silver-blue hair, muted grey-white hooded cave coat, desaturated violet-blue accents, small brass staff; companion mushroom as a separate asset; no green hair, no bright yellow jacket.` を追加。胸像は頭頂から腰まで、盤縁に手が掛かる余白を含め、顔のハイライトと彩度を現状比30〜40%落とす。

3. **［高］ターゲット札・スコア札・キャラクターが互いに重なり、顔と数値が隠れる（オーナー指摘3を確認）**
   - **差分**：森では中央ターゲット札が左のスコア札右端を覆い、スコア数値が読めない。3画面ともターゲット札下端がキャラの帽子／額を切る。機械遺構は特に、ターゲット札とスコア札が巨大な動物キャラの両目・額を横断し、顔の大部分が隠れる。`user_v3_3.jpg` 各①では3HUD部品の占有域が分離し、キャラの顔全体がその下に見え、盤上辺とも自然につながる。
   - **具体修正（レイアウト）**：`src/main.ts:311` の `boardTop = vh * 0.27` を縦長端末では **`vh * 0.35`**（短い端末のみ `Math.max(vh * 0.30, ...)`）へ下げ、キャラ帯を確保する。`src/main.ts:416` の `tpW = vw * 0.46` を **`vw * 0.42`**、`src/main.ts:426` の y を **`vh * 0.025`** にする。`src/main.ts:354-357` は `sbW = vw * 0.24`、`sbX = vw * 0.02`、`sbY = vh * 0.145` とし、札の右端を中央札の左端より8px以上左に置く。`src/main.ts:323` の胸像を `x = vw * 0.50`、`y = boardTop + vh * 0.010`、`src/main.ts:320` の `bh` を **`vh * 0.19`** にし、顔の矩形が全HUDの下端＋12pxより下に始まることをランタイムで検証する。

4. **［高］縦長端末へのレイアウト適応がなく、上半分に詰まり、下約30%が空洞化**
   - **差分**：現状の全プレイ画面はHUD〜盤〜ブースターが画面上70〜76%に集まり、下部は背景だけが長く余る。`user_v3_3.jpg` 各①ではゲーム盤とブースター列が画面下端近くまで使われ、上部のキャラ場と下部の操作場が均衡している。現状は重要要素が小さく見え、親指操作域も上すぎる。
   - **具体修正（レイアウト）**：上記 `boardTop = vh * 0.35` に加え、`src/main.ts:308` を **`const boardSize = Math.min(vw * 0.90, vh * 0.48)`** とする。`src/main.ts:523` のブースター y は `boardTop + view.S * H + Math.min(vw * 0.10, vh * 0.045)` に変更し、ブースター中心が概ね **`vh * 0.83`** に来るようにする。最終的な盤外枠上端／下端／ブースター下端を画面比でスナップショットテストし、目標値を 0.34〜0.36／0.76〜0.79／0.90以下とする。

5. **［高］通常駒5種が素材正本とまだ一致しない（オーナー指摘2を確認）**
   - **差分（`user_v3_2.jpg` 中央左「ピースデザイン」と右上「特殊ピース」）**：
     - **葉（緑）**：現状は細長く反った写実的な一枚葉で、黄緑ハイライトが強い。正本は幅広く丸い葉、短い茎、柔らかな葉脈、くすんだ翡翠色。
     - **結晶（青）**：現状は白〜水色の氷のような高明度・硬い面取りの束。正本は中明度の群青〜青緑を含む、低い台形シルエットの水晶群で、透明水彩のにじみがある。
     - **花（紫）**：現状は均一な丸い5弁と黄色い球芯のクリップアート的形。正本は花弁の大小・重なりに揺れがあり、菫〜灰紫の濃淡と細いインク線がある。
     - **キノコ（赤）**：現状は高彩度の朱赤、真円に近い傘、真っ白な水玉、強い立体光沢。正本は褪せた赤茶の非対称な傘、生成りの斑点、土色の軸、マットな水彩。
     - **鉱石（金）**：現状は金色の松ぼっくり／鱗の塊に見え、橙の照り返しが強い。正本は不揃いな琥珀〜黄土の結晶柱／鉱物片で、輪郭の抜けと淡い面色がある。
   - **具体修正（再生成）**：共通発注句に `Create five separate 256x256 match-3 pieces, exact silhouettes from user_v3_2 piece-design grid and special-piece examples: one broad weathered jade leaf; one compact clustered blue crystal; one irregular five-petal muted violet flower; one asymmetric faded red-brown spotted mushroom; one cluster of angular ochre-amber ore crystals. Each fills 76-82% of canvas, consistent visual mass, no cast shadow, matte transparent-watercolour surface, 3-5px equivalent fine sepia ink, no white specular gloss.` を追加し、5枚を同一バッチで作る。`src/view/BoardView.ts:128` の通常駒占有率 `0.94` は再生成後 **`0.82`** へ落とし、線とセル内余白を見せる。

6. **［高］障害物の形・状態差分が正本／ART canonと不一致**
   - **差分（`user_v3_2.jpg`「ギミックブロック・障害物」）**：苔石は現状、明るい多面体の丸岩で苔がほぼなく、2層→1層が単なる半透明化なので損傷が伝わらない。蔦苔は `app_clear.png` でセル縁に黄緑ノイズが散るだけで、正本の太い蔦と苔の被覆に見えない。匣は現状の小さな木箱＋金属印が玩具的で、正本の重い古代封印／石箱の面密度と異なる。陶片はターゲット札では橙青の陶片一枚だが、破壊元となる匣との材質・文様の関係が見えない。巣灯は結晶画面の盤上で青い芯を持つ小型金属壺に見え、`ART.md` の「隣接ヒットで光胞子を排出する巣」の有機性・開閉状態が不足。正本素材集の結晶壁・泥沼・古代封印も、採用／不採用が画面から判別できない。
   - **具体修正（再生成）**：共通発注句に `Use user_v3_2 obstacle row as the exact material and silhouette reference. Produce separate state sprites: moss stone intact = dark irregular rock block wrapped by thick olive vines and moss; damaged = clearly missing 35% mass with a pale fracture, not alpha fade. Vine moss = transparent tangled roots and velvety moss covering 60% of cell with a clean centre opening. Ancient box/seal = heavy square weathered stone-and-dark-wood reliquary with recessed brass seal; broken state exposes matching blue-and-ochre pottery shards. Nest lamp = original cave-organism lantern, muted brass cage around soft aqua spores, explicit open and closed silhouettes, no glossy grenade shape.` を追加。`src/view/BoardView.ts:159-162` の半透明／tint処理をやめ、苔石 hp 2・hp 1 を別キー（例 `o_stone_intact` / `o_stone_cracked`）で選ぶ。蔦苔の `ground_thick` / `ground_thin` も状態差分を輪郭量で見せる。

7. **［高］特殊駒とブースターの品目・意匠・個数が正本と混線**
   - **差分**：`user_v3_2.jpg` 右中段「アイテム・ブースター」は探窟ランプ、つるはし、ヒカリダケ、薬シャッフル、機械ギア、探窟ロボ、作業バッグ、帰還筒を、下のUI例は4つの円形ソケットを示す。`user_v3_3.jpg` 各①も下段は4メダリオン。一方、現状は3個だけで、レンチ状道具／歯車爆弾／ランタンが暗い巨大ソケットに入り、すべて `0`。特殊駒（盤内生成物）と所持ブースター（盤外操作）が同じアセットを兼用して役割が不明。`pieces.ts:22-25` でも `harpoon` を `s_wrench.png` に割り当て、名称と見た目が食い違う。
   - **具体修正（再生成）**：共通発注句に `Use user_v3_2 item/booster panel and UI medallion row. Create four equipped booster icons as a coherent set: weathered brass pickaxe, warm explorer lantern, blue bioluminescent mushroom, violet potion/shuffle bottle; separate from board special pieces. Also create board specials as compact in-cell objects: directional brass wrench/harpoon with obvious arrow axis, mechanical compass beetle, gear bomb with fuse, prismatic explorer lantern. Muted brass #A9823C, olive #697050, parchment #D7C49B, no shiny orange metal.` を追加。`src/main.ts:494` の配列を4ブースター専用キーへ変え、`src/main.ts:496` の `r = vw * 0.075` を **`vw * 0.062`**、`src/main.ts:520` の間隔を **`vw * 0.17`** にし、4個を中央揃え。数バッジは `src/main.ts:517` を `(r * 0.72, r * 0.62)` として円内右下へ収める。

8. **［高］画面全体の画材・彩度・輪郭・材質がAD v3より硬く派手**
   - **差分**：正本3枚は暖色セピアを基調に、細く少し揺れる焦茶線、透明水彩の濃淡、紙色が透ける低〜中コントラスト、枯れた真鍮で統一される。現状は背景が高精細デジタルペイント、駒は太い均一輪郭＋強い白ハイライト、UIは橙金の硬い3Dレリーフ、セルはほぼ黒の深い溝で、レイヤーごとに別ゲームの素材に見える。特に結晶洞窟の紫青とキノコ赤、鉱石橙が高彩度で、森／機械も黒潰れが多い。
   - **具体修正**：背景・キャラ・盤・駒・UIの各再生成に共通発注句を厳守し、追加で `global palette: warm parchment #D8C7A1, muted olive #657052, deep teal #274C4D, weathered brass #A9823C, faded coral #A85F4D, dusty violet #756681; darkest value is coloured deep brown-teal, never black; highlights are paper-coloured washes, never pure white; reduce saturation 25-35% from current screenshots.` と指定。最終合成にも軽い紙粒子（3〜5%）と暖色カラールックアップを全レイヤー共通でかけ、素材単体のコントラスト補正を禁止する。

9. **［高］プレイ画面の情報階層が `user_v3_3.jpg` ①と異なる**
   - **差分**：正本は上段に小型の手数／ターゲット／設定、中段に“全身感の残る”小さなキャラ、下段に盤、最下段に4ブースターという明確な4帯。現状は大きなターゲット札が最上位、左の手数＋スコアが別々に突出、キャラは札の背後、盤は太枠の巨大正方形、ブースター3個は離れた暗箱になっている。視線がターゲット札→キャラの切れた顔→盤枠へ散り、手数と盤の関係も弱い。
   - **具体修正（レイアウト）**：HUDの安全領域を `0.02vh〜0.20vh`、キャラ帯を `0.20vh〜0.36vh`、盤を `0.35vh〜0.78vh`、ブースターを `0.80vh〜0.90vh` と固定し、各要素の bounds が隣帯へ8px以上侵入したら開発時警告を出す。`src/main.ts:328` の `ui` を `hudLayer`、`characterLayer`、`boardLayer`、`boosterLayer` の順に明示し、単なる追加順依存をやめる。

10. **［中］盤枠とセルが正本より明るく硬く、背景から浮いている**
   - **差分**：`user_v3_2.jpg` ステージギミック例／`user_v3_3.jpg` 各①の盤は、暗い茶系石セルに柔らかな内影、苔の絡む厚い暗褐石枠、鈍い真鍮の細線。現状の外枠は明るいベージュ石の直線的な額縁で、角の金具が大きく、セル境界は黒く均一、各セルがボタンのように盛り上がる。森背景の石材より黄白く、機械・結晶テーマでも同じ明色枠なので合成感が強い。
   - **具体修正（再生成＋実装）**：共通発注句に `Use user_v3_2 stage-gimmick boards and user_v3_3 gameplay board frames: thick carved dark brown stone, restrained aged-brass hairline, sparse olive moss creeping asymmetrically, rounded worn corners, transparent-watercolour texture, centre fully transparent; no pale sandstone, no large shiny corner bolts.` を追加。セルは `warm dark umber stone, four subtly different washes, soft inner shadow, hairline sepia grout, no bevelled button look`。`src/view/BoardView.ts:70` の市松 tint `0xe4d6c4` を **`0xf2ebe0`** 程度の微差にし、`src/view/BoardView.ts:75-76` は新枠実測に合わせつつ、現状の `inset = S * 0.12` を **`S * 0.06`** にしてセルへの食い込みを半減する。

11. **［中］背景3テーマは題材は合うが、正本の空気遠近・暖色セピア・水彩感が不足**
   - **差分**：森は正本Aの縦穴・巨大樹・遠景の霞より、現状は前景の葉と石が均等にシャープで暗い。機械は正本Bの古代巨大機構と黄金の逆光より、現状は配管密度が全域同じで黒褐色に潰れ、キャラ／盤の背後が騒がしい。結晶は正本Cの紺紫洞窟＋局所的な淡い結晶発光より、現状は青紫の彩度と発光面積が大きく、背景だけ近代的なゲームコンセプトアートに見える。
   - **具体修正（再生成）**：森は `Use user_v3_3 column A gameplay background: immense vertical forest abyss, giant roots framing the sides, pale warm mist and tiny ruins at centre, olive/teal/sepia watercolour, quiet centre behind character and board.`、機械は `Use column B: ancient subterranean machine ruins, one large readable gear and aqueduct silhouette, warm dusty backlight, oxidised brass and dark umber, simplify texture by 40% behind HUD and board.`、結晶は `Use column C: deep indigo-violet crystal cavern, a few large rose/lavender crystals on side ledges, aqua depth mist, muted glow with paper-coloured highlights, reserve high chroma for 5% of image.`。`src/main.ts:304` の一律青黒 dim `0x0a1420, alpha 0.22` は背景をさらに黒くするため、**暖色 `0x2b2118, alpha 0.10`** を基本にし、テーマ別に調整する。

12. **［中］ターゲット札が大きく重厚すぎ、羊皮紙の軽さと余白がない**
   - **差分**：`user_v3_2.jpg` UIデザインパーツと `user_v3_3.jpg` 各①は、小さな古紙プラーク、細い枯れ真鍮／木枠、小リボン、アイコン下の数字。現状は厚い木製の箱枠と巨大な四隅鋲が面積を取り、見出し「ターゲット」が過大。アイコンが小さく余白が広い割に、札そのものがキャラを圧迫する。
   - **具体修正（再生成＋実装）**：`Use user_v3_2 UI target plaque and user_v3_3 gameplay top centre: compact horizontal aged parchment, thin weathered bronze-and-wood frame, narrow muted ribbon with baked-in ターゲット label, tiny corner fasteners, generous clean inner field; aspect ratio about 1.65:1; no thick 3D frame.`。`src/main.ts:416` を `tpW = vw * 0.42`、アセット比率を約1.65:1にし、`src/main.ts:464/470` の icon/count y を **`tpH * 0.55` / `tpH * 0.79`**、アイコン `iconScale` を2目標時 **0.36** にして、札を小さくしても判読性を保つ。

13. **［中］手数メダリオンの金属が橙色で硬く、文字階層も正本より重い**
   - **差分**：正本の「ムーブ数／のこり」は枯れたブロンズ円盤と小さな古紙帯で、数字が主役。現状は外周のオレンジ金属、厚い歯、濃い茶の中心、白い巨大数字のコントラストが強く、カジノUIに寄る。
   - **具体修正（再生成＋実装）**：`Use user_v3_2 UI moves part and user_v3_3 upper-left medallion: worn round bronze medallion, shallow engraved rim, small aged-paper ribbon with baked-in のこり, muted brown centre, asymmetric patina and fine ink line; no orange gold, no glossy bevel.`。`src/main.ts:332` の `badgeW = vw * 0.185` は **`vw * 0.16`**、`src/main.ts:345` の数字 `fs(0.075)` は **`fs(0.064)`**、位置の `badgeH * 0.58` は新アセット中央実測値へ合わせる。

14. **［中］スコア札がプレイ中HUDとして大きすぎ、ラベルと数値の可読性も壊れている**
   - **差分**：現状は左に幅30vwの横長札を追加し、ターゲット札と衝突。森では「スコア」だけ見えて数値が隠れ、機械／結晶でも暗褐地に小さな数字で優先順位が曖昧。`user_v3_3.jpg` ①ではプレイ中のスコアは強く主張せず、主要3要素の邪魔をしない。
   - **具体修正**：重なり解消値 `sbW = vw * 0.24`, `sbX = vw * 0.02`, `sbY = vh * 0.145` を採用。再生成は `Use user_v3_2 score plaque: slim flat engraved-brass badge, baked-in スコア at left, quiet dark parchment-brown centre, small rivets, low relief.`。`src/main.ts:371` は `sbX + sbW * 0.88`、フォント `fs(0.034)` は **`fs(0.031)`**、数値に1px相当の暗い影だけを付ける。

15. **［中］設定／戻るボタンが正本より立体的で、アイコン意味も弱い**
   - **差分**：正本は小さな石／真鍮メダリオンに細線の歯車で、テーマに溶ける。現状は橙金の厚い円形ボタンが二つ縦並びで強く浮き、上の歯車は中心が黒く、戻る矢印は太い。機械画面では背景歯車と競合する。
   - **具体修正（再生成＋実装）**：`Use user_v3_2 UI gear part and user_v3_3 top-right control: small weathered bronze medallion, thin engraved gear/arrow glyph, matte oxidised recess, transparent background, low relief.`。`src/main.ts:376` の `gr = vw * 0.048` を **`vw * 0.042`**、スプライト径係数 `2.2` を **`2.0`**、xを `vw * 0.935`、上下間隔は `gr * 2.45` とする。最低44 CSS pxのタップ領域は透明 hitArea で別途確保する。

16. **［中］駒がセルを埋めすぎ、形の違いより白ハイライトの塊が先に見える**
   - **差分**：正本の盤は各駒に10〜15%の石地余白があり、細い輪郭とシルエットで判別できる。現状は `BoardView.ts:128` の `0.94` により結晶・鉱石・花がほぼセル端まで達し、8×8の密度と太い枠も相まって盤面が騒がしい。結晶と鉱石はともに「明るい尖った束」として近似して見える。
   - **具体修正**：通常駒の `target` を **`S * 0.82`**、特殊駒を **`S * 0.86`** にする。アセット生成では5種の外接面積を同じにせず“見た目の質量”を揃え、結晶は横広がり、鉱石は縦の不揃い柱、花は円、葉は斜線、キノコはT字として輪郭を明確化。色覚差に頼らない縮小64pxテストを追加する。

17. **［中］蔦苔の描画が低解像度ノイズ／セル汚れに見え、状態が読めない**
   - **差分**：`app_clear.png` 中央の蔦苔は、黄緑の細かな四角ノイズがセル周囲に出ており、正本 `user_v3_2.jpg` の「ツタ／壁のピースを縛る」太い植物形状や `ART.md` の透明水彩苔と異なる。どのセルが厚い／薄いのかも判別しづらい。
   - **具体修正**：再生成は `two separate 256x256 transparent overlays, thick vine-moss and thin vine-moss; 3-5 readable olive roots crossing the cell, velvety moss clumps, brown broken edges, centre opening, watercolour alpha with no pixel noise; use user_v3_2 vine obstacle as silhouette reference.`。`src/view/BoardView.ts:196-198` のセル一杯ストレッチは維持してよいが、テクスチャの有効領域をセル内92%にし、nearestではなくlinear sampling、厚／薄を色ではなく蔦の本数で分ける。

18. **［中］目標アイコンが盤上の同一物と見えないものがある**
   - **差分**：森の岩目標は盤上の多面岩と近いが、札内では小さく色が沈む。機械の陶片は札内で大きな橙青片だが盤上の箱から出ることが視覚的に予測できない。結晶の白い胞子目標は雪玉／花火に見え、盤上の青芯金属壺や `ART.md` の光胞子との対応が不明。正本は同じ駒絵を小型化して目標に使い、対応が即読できる。
   - **具体修正**：目標用別イラストを作らず、盤面と同じ透過PNGを縮小使用する。胞子は `soft aqua bioluminescent spore cluster, 5-7 translucent round spores around a warm cream core, fine sepia ink, no snowflake spikes` と再生成。`src/main.ts:440/462` の縮尺計算はそのまま同一テクスチャを参照し、最小表示径を **`tpH * 0.34`**、小片の陶片のみ `0.28` と個別補正する。

19. **［中］マップに破線の道がなく、ノードが背景上に浮遊している**
   - **差分**：`user_v3_3.jpg` 各②と `user_v3_1.jpg`「ステージ選択」は、石メダリオンを白い破線／足跡状の道が結び、次の進行方向が一目で分かる。現状 `app_map.png` はノード間を結ぶ線が完全になく、滝や壁面の上に金属円盤が独立している。
   - **具体修正（実装）**：`src/main.ts:68` のノード生成前に `pathLayer` を追加し、同じ `nx/ny` 列を記録して各点間を2次ベジェで結ぶ。線は幅 **`vw * 0.004`**、色 `0xE5D7B3`、alpha **0.72**、破線長 **`vw * 0.018`**／間隔 **`vw * 0.016`**。背景の地形に沿うよう中点を左右へ `vw * 0.06` だけ曲げ、ノードより背面に置く。アセットなら `user_v3_3` ②の白い足跡破線を参照し、紙白ではなく生成り水彩で作る。

20. **［中］マップの先頭ノード／星が固定ヘッダーに重なり、クリッピングされる**
   - **差分**：`app_map.png` 最上部のノード1はヘッダー中央下に食い込み、番号が横線で切られ、上の星3個も暗いヘッダー内に潜って読めない。これはオーナー指摘3の別箇所。正本②では全ノードと星がヘッダー領域から分離している。
   - **具体修正（レイアウト）**：`src/main.ts:71` の `topPad = vh * 0.16` を **`vh * 0.19`**、`src/main.ts:190-191` のヘッダー下端は `vh * 0.085` なので、スクロール後もノード bounds が `vh * 0.105` より上に来ないよう content に矩形マスクを設定する。`src/main.ts:229` のフォーカス位置 `vh * 0.4` は **`vh * 0.46`** として現在ノードをやや下げる。最上部に戻った際は `mapScroll = 0` でノード1の星上端がヘッダー下端＋12pxになることを検証する。

21. **［中］マップノード、星アーチ、現在地アバターの造形と階層が正本と違う**
   - **差分**：正本②は暗い石メダリオン、上辺に沿う小さな3星、現在地はノードの横に独立した小さな丸肖像。現状は金色の歯車円盤が強く、星が大きくバラけ、現在地は白い太いパルス円＋盾型枠＋明るい顔でノードを完全に置換する。白リングだけが画面で突出し、レベル番号も失われる。ロックノードは alpha 0.45で背景に沈みすぎる。
   - **具体修正（再生成＋実装）**：`Use user_v3_2 UI parts and user_v3_3 world-map nodes: dark carved stone medallion with a hairline weathered-brass rim; separate shallow three-star arch; separate small round parchment portrait pin; matte, muted, no shield, no bright white ring.`。`src/main.ts:81` の `r = vw * 0.055` を **`vw * 0.065`**、`src/main.ts:104-106` の星位置を `[-0.72r,-1.16r]`, `[0,-1.28r]`, `[0.72r,-1.16r]`、星径を現状の約75%へ。現在地 pin は `src/main.ts:144` の `pr = r * 0.82`、`src/main.ts:159` を **`(r * 1.35, -r * 0.10)`** としてノード右に置き、番号を残す。白パルス輪 `r * 1.3` は真鍮 `alpha 0.45`, 幅2へ。ロックは `alpha = 0.62`。

22. **［中］マップのノード密度とスクロール焦点が正本より散漫**
   - **差分**：正本②は1画面に4前後の大きなノードが見え、地形の名所を巡るリズムがある。現状は小ノードが長い縦穴にほぼ等間隔で置かれ、背景の足場・橋・歯車と無関係。正弦波だけの左右移動なので、道が壁や滝を横切る。
   - **具体修正（レイアウト）**：`src/main.ts:43` の `MAP_H = vh * 2.6` は12レベルなら **`vh * 3.1`**、ノード半径を上記0.065vwへ拡大し、1画面3.5〜4.5ノードにする。`src/main.ts:75` の `Math.sin(i * 1.05) * vw * 0.27` を固定ウェイポイント配列（各背景の足場中心を0〜1正規化）へ置換する。最低限の数式案は振幅を **`vw * 0.24`**、位相を `i * 1.22` とし、端から `r * 2` の安全余白をクランプする。

23. **［中］マップ上部ヘッダーが正本の世界観／情報量と合わず、背景を横断して圧迫**
   - **差分**：現状は画面幅94%の黒緑半透明バーにコイン、巨大タイトル「深界断面図」、星数を横並び。`user_v3_3.jpg` ②は小さなライフ／コインUIで背景と道を主役にし、`ART.md` ではライフ・下部ナビは不採用だが、巨大タイトルバーの採用は示していない。現状バーはノード1を隠し、金縁が現代的なステータスバーに見える。
   - **具体修正**：ライフは追加せず、コイン札を左上、星合計を右上の小型古紙／真鍮札に分離し、タイトルは幅 **`vw * 0.34`** の小リボンまたは背景へ焼き込み。`src/main.ts:190` の横長 `vw * 0.94` を廃止し、左右札を各 **`vw * 0.24 × vh * 0.045`**、y=`vh * 0.025` にする。再生成は `small flat aged-paper map title ribbon, fine olive ink, weathered brass pins, use user_v3_2 UI parts; no full-width black glass bar.`。

24. **［中］クリアパネル実装値も、表示できた場合に正本③と異なる可能性が高い**
   - **差分**：コード上のパネルは `src/main.ts:646-649` で幅82vw・高さ46vh・上22vhの中央小窓、全面黒 dim 0.55。正本③は画面の大半を使うテーマ背景一体型の結果画面で、リボン、星、古紙スコア面、キャラが大きく、黒いモーダル感がない。現行実装には結果画面のキャラ／相棒がなく、報酬は小コイン一行で、`user_v3_3` の構図を満たさない。
   - **具体修正（レイアウト）**：まず項目1の表示を直した後、`pw = vw * 0.90`、`ph = vh * 0.66`、`py0 = vh * 0.14`、dim alphaを **0.28** にする。テーマ背景をそのまま見せ、パネル下左右へゲーム中と同じ再生成キャラ／相棒を `height = vh * 0.22` で配置。星 `starY = py0 + ph * 0.24`、スコア `scY = py0 + ph * 0.47`、ハイスコア `0.59`、報酬 `0.69`、次ボタン `0.86` とし、正本③の縦順を守る。

25. **［中］クリア用リボン、3星、スコア札、『つぎへ』ボタンの造形が重厚・汎用的**
   - **差分**：`user_v3_3.jpg` ③はテーマ別の布色（森＝枯緑、機械＝青緑、結晶＝紫）、手描き文字、大きなやや不揃いの金星、明るい古紙スコア面、テーマ色の横長ボタン。現行コードは全テーマ共通 `ui_ribbon_clear`、汎用金星、プレイ中と同じ暗い `ui_score`、共通ボタンを使う。`triggerWin` の中間バナーも `banner_toha.png` 一種類なので、正本の「探索成功！／遺構調査完了！／探索完了！」と一致しない。
   - **具体修正（再生成＋実装）**：`Use user_v3_3 bottom row as exact layout and colour reference. Create three separate clear ribbons with baked-in Japanese wording: forest muted olive cloth 探索成功！; machine desaturated teal cloth 遺構調査完了！; crystal dusty violet cloth 探索完了！. Create one hand-painted matte gold star with uneven ink edge, one pale parchment score panel, and three theme-colour wide つぎへ buttons; weathered, no glitter or glossy bevel.`。`pieces.ts` にテーマ別キーを追加し、`src/main.ts:595/658` で `themeForLevel(currentLevelId)` から選択。`src/main.ts:599` の中間バナー幅 `0.86vw` は **`0.72vw`**、`src/main.ts:677` の星幅は左右 `pw*0.20`／中央 `pw*0.23` として過密を防ぐ。

26. **［中］日本語ラベルと数字の書体・コントラストが素材間で統一されていない**
   - **差分**：正本はラベルが手描き風の明朝／筆致で素材に焼き込まれ、数字は古い図鑑の活字風。現状の「ターゲット」は太い黒文字、手数とマップ数字は高コントラストの白い標準 serif、マップタイトルは細い白、チェックは鮮やかな緑で、同一野帳の文字に見えない。森のスコア数値は重なりで消え、ロックノード数字は暗すぎる。
   - **具体修正**：焼き込み対象（のこり／ターゲット／スコア／ハイスコア／つぎへ／3種バナー）は上記再生成で統一。コード数字は日本語明朝系1ファミリーへ統一し、色を古紙 `#E5D8BB` または墨 `#4A3828`、strokeは純黒でなく `#3A2C20` 1〜2px相当。`src/main.ts:95` のノード stroke width 3を **2**、`src/main.ts:345` の手数は白ではなく `0xe5d8bb`、`src/main.ts:485` の完了緑 `0x3f7a3f` は **`0x667451`** とする。

27. **［低］盤枠の描画順と食い込みがセル／駒をクリップして見せる**
   - **差分**：現状は `BoardView.ts:84` で枠を `cellLayer` の最後に置き、さらに `inset = S*0.12` で盤へ深く食い込むため、外周セルの石地が細く、端の大きな駒が枠に押し込まれて見える。正本は厚枠でも内側に均等な暗い余白がある。
   - **具体修正**：項目10の `inset = S*0.06` に変更し、外周セルの見える幅が内部セルの90%以上あることを確認。必要なら frame専用 `frameLayer` を `pieceLayer` の下・cellの上へ分け、駒が枠下へ潜らず、枠の内影だけが盤に重なる9-slice構造にする。

28. **［低］UIソケットとカウンターが暗く、未所持状態が“無効ボタン”にしか見えない**
   - **差分**：現状の3ソケットは `src/main.ts:519` で全体 alpha 0.6、中心も暗く、数字0が円外右下に漂う。正本 `user_v3_2.jpg` UI列／`user_v3_3.jpg` ①は、枯れ真鍮の円枠、道具、黒地の小丸カウンターがそれぞれ明瞭で、所持数3/2/1などが円内に収まる。
   - **具体修正**：未所持でも枠 alpha **0.82**、アイコン alpha **0.55** と階層を分ける（container全体を薄くしない）。カウンターは半径 `r*0.28` の暗褐丸＋生成り数字を `(r*0.68,r*0.62)` に置く。0個なら数字だけでなく小さな錠前または空ソケット差分を使い、タップ可否を視覚化する。

29. **［低］`ART.md` 内の旧マッピングと実アセットのフォールバックが、ロード失敗時に別デザインへ戻る**
   - **差分**：`ART.md` 冒頭AD v3は正しく「葉／結晶／花／キノコ／鉱石」を正とするが、後段§4には旧「陽盤／芽石／雫瓶／月角／花石」が残る。`src/view/pieces.ts` のGraphicsフォールバックも旧5種を描くため、画像ロード失敗時に、通常時と全く違う記号へ変わる。また `pieceKey` の `harpoon-h/v` とロードキー `harpoon` の命名も混在する。
   - **具体修正**：実装時は `pieces.ts` のフォールバックを5つの単純化した現行正本シルエット（葉／結晶／花／キノコ／鉱石）へ置換し、色も再生成アセットの中央値へ合わせる。特殊駒キーは描画・キャッシュ・アセットで `wrench_h` / `wrench_v` 等に統一する。文書はAD v3の節を唯一の現行表として明示し、旧節を「履歴」に移す。

30. **［低］スクリーンショット検品の状態網羅が不足**
   - **差分**：今回の5枚では、クリアUIが未表示、特殊駒はレンチ一種程度、苔石損傷差分・匣破壊後陶片・巣灯開閉・4ブースター所持状態・マップの各テーマが確認できない。「各素材がある」ことと「画面で正しく見える」ことの照合ができない。
   - **具体修正**：次回は同一780×1688で、(1)各テーマ通常盤、(2)通常5駒＋特殊4種を一盤に置いた検品盤、(3)障害物全状態、(4)4ブースターを3/2/1/0で表示、(5)マップ浅層／中層／深層、(6)各テーマのクリア最終パネル、(7)狭幅・短高端末を撮る。自動画像差分ではHUD／キャラ／盤／ブースターのbounds矩形を同時出力し、重なり0px、画面外クリップ0pxを合格条件にする。

## 総括

オーナーが挙げた3点はすべて確認でき、特にキャラクター3体の再設計、HUD／キャラの衝突解消、駒・障害物・ブースターの正本準拠は最優先である。それに加えて、`app_clear.png` が結果画面を表示していないこと、縦長端末で盤以下が上に寄り下部が大きく空くこと、マップの破線欠落とヘッダー重なりが、現状の完成度を大きく下げている。個別素材を少しずつ補修するより、まず共通の水彩・低彩度・枯れ真鍮ルックを固定し、キャラ／盤駒／HUD／背景の順に同じ正本を参照してバッチ再生成し、その後 `main.ts` の4帯レイアウトへ組み直すのが最短である。
