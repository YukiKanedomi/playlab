import { defineConfig } from 'vite'
import { resolve } from 'node:path'

// GitHub Pages のプロジェクトページ配信。サブパス '/playlab/' 必須。
// データ取得は import.meta.env.BASE_URL 起点（絶対パス '/...' は404になる）。
export default defineConfig({
  base: '/playlab/',
  // GLBモデルをアセット(URL)として扱う（3Dゲーム用）
  assetsInclude: ['**/*.glb'],
  build: {
    rollupOptions: {
      input: {
        // ハブ + 各ゲームをマルチページで一括ビルド。新作はここに1行足す。
        hub: resolve(__dirname, 'index.html'),
        codex: resolve(__dirname, 'codex/index.html'),
        trail: resolve(__dirname, 'games/trail/index.html'),
        dj: resolve(__dirname, 'games/dj/index.html'),
        petri: resolve(__dirname, 'games/petri/index.html'),
        loop5: resolve(__dirname, 'games/loop5/index.html'),
        spacelab: resolve(__dirname, 'games/spacelab/index.html'),
        racer: resolve(__dirname, 'games/racer/index.html'),
        kirisame: resolve(__dirname, 'games/kirisame/index.html'),
        fude: resolve(__dirname, 'games/fude/index.html'),
      },
    },
  },
})
