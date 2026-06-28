# Playlab

思いつきのゲームをどんどん形にして、1リポジトリ（モノレポ）で公開・試遊できる遊びの実験場。

- **最優先は「楽しく遊ぶ・遊び心」。**
- 各ゲームは完全独立。`shared/` は使ってもいい道具箱（任意）。アプローチは何でも自由。
- 公開は GitHub Pages（Vite マルチページ、`base: '/playlab/'`）。スマホ前提（タッチ・レスポンシブ）。

詳しい方針は `CLAUDE.md`、構想の全体像は `NOTES.md` を参照。

## 公開
- ハブ: https://yukikanedomi.github.io/playlab/
- `main` に push すると GitHub Actions が build → Pages へ自動公開。

## 開発
```bash
npm install
npm run dev      # ローカル開発（http://localhost:5173/）
npm run build    # dist/ にマルチページビルド
npm run preview  # ビルド結果をプレビュー
```

## 作品を増やす
1. `games/<slug>/index.html` + `main.ts` を作る（テンプレは `games/trail/` をコピー）
2. `vite.config.ts` の `input` に1行追加
3. `public/games.json` に1エントリ追記（`status` は `experiment` / `featured`）
4. push → 自動公開

## いま入っているもの
- ハブ（`index.html` / `src/`）— `public/games.json` 駆動のデータドリブン一覧
- `shared/`（薄い道具箱・任意）— `input.ts`（タッチ統一） / `registry.ts`（ハブ用ローダ）
- `games/trail/` — 1本目「なぞって、すくう。」軌跡で光を集める60秒タイムアタック（仮キャラ）
- `BACKLOG.md` — 次に作るネタの苗床
