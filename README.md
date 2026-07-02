# Playlab — 遊びの実験室

思いつきのゲームをどんどん形にして、1リポジトリ（モノレポ）で公開・試遊する実験場。

**▶ 遊ぶ: https://yukikanedomi.github.io/playlab/**（スマホ推奨）

- 最優先は「楽しく遊ぶ・遊び心」。技術と構成は手段。
- **毎回バラす**：作品ごとに技術・ジャンル・作風を変えて実験する。
- 各ゲームは完全独立。`shared/` は使ってもいい道具箱（任意）。
- 制作の学びは [Codex（遊びの設計ノート）](https://yukikanedomi.github.io/playlab/codex/) に「触って学ぶ」形で公開。

## 作品一覧

| No. | タイトル | ひとこと | 主な技術 |
|---|---|---|---|
| 10 | [ならべて、ばける。](https://yukikanedomi.github.io/playlab/games/bakefuda/) | 花札×Balatro型ローグライト。役×化け札で文をインフレ | DOM / CSS演出 |
| 09 | [ながして、ともす。](https://yukikanedomi.github.io/playlab/games/nagashi/) | 触れられるのは水だけ。GPU流体で墨を灯籠へ導く | WebGL / Stable Fluids |
| 08 | [かいて、はらう。](https://yukikanedomi.github.io/playlab/games/fude/) | 筆の形を幾何で読む筆捌きTD。鳥獣戯画ふう自作筆線 | Canvas2D / ジェスチャー認識 |
| 07 | [あつめて、あばく。](https://yukikanedomi.github.io/playlab/games/kirisame/) | 書き下ろし和風ミステリーADV『霧雨館の一夜』 | DOM / シナリオ駆動 |
| 06 | [はしって、よけて。](https://yukikanedomi.github.io/playlab/games/racer/) | 低ポリ3Dのエンドレス・ドライバー | three.js / GLB |
| 05 | [うって、よけて。](https://yukikanedomi.github.io/playlab/games/spacelab/) | フリー素材（Kenney/CC0）のトップダウン・シューター | Canvas2D / アセット |
| 04 | [5秒、くりかえし。](https://yukikanedomi.github.io/playlab/games/loop5/) | 過去の自分が幽霊で手伝う5秒時間ループ | Canvas2D |
| 03 | [まもって、ふやして。](https://yukikanedomi.github.io/playlab/games/petri/) | シャーレの中のサバイバー×TD。進化と分裂 | Canvas2D |
| 02 | [きいて、かえして。](https://yukikanedomi.github.io/playlab/games/dj/) | コール&レスポンスのリズムゲー | WebAudio |
| 01 | [囲って、咲かす。](https://yukikanedomi.github.io/playlab/games/trail/) | ひと筆で囲うと中身が咲く60秒アクション | Canvas2D |

素材はすべて自作またはフリー（CC0中心・各 `games/*/LICENSES.md` に明記）。既存作を参考にした場合は「学ぶ習作」であり、名前・アート・音源のコピーはしない。

## 開発

```bash
npm install
npm run dev      # ローカル開発（http://localhost:5173/playlab/）
npm run build    # dist/ にマルチページビルド
npm run preview  # ビルド結果をプレビュー
```

`main` に push すると GitHub Actions が build → GitHub Pages へ自動公開。

## 作品を増やす

1. `games/<slug>/index.html` + `main.ts` を作る（`?shot=1` のサムネ用フレームも用意）
2. `vite.config.ts` の `input` に1行追加
3. サムネを撮って `public/thumbs/<slug>.png`
4. `public/games.json` に1エントリ追記（`status` は `experiment` / `featured`）
5. push → 自動公開

## 構成

```
index.html / src/        ハブ（games.json 駆動の一覧）
codex/                   遊びの設計ノート（学びの公開ページ）
games/<slug>/            各作品（完全独立・自由）
shared/                  薄い道具箱（任意）: input / juice / theme / shell /
                         transition / tune（実機パラメータ調整） / audio（共通ミュート） / registry
public/games.json        作品レジストリ（真実の源）
public/thumbs/           サムネイル
BACKLOG.md               改善ネタ・次回作の苗床
```

方針の詳細は `CLAUDE.md`、初期構想の記録は `NOTES.md`（歴史文書）へ。
