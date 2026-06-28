// Playlab Service Worker — network-first（常に最新を取りに行く／オフライン時のみキャッシュ）
// ホーム画面アプリでも更新が反映されるようにするのが目的。assets はハッシュ付きなので衝突しない。
const CACHE = 'playlab-v1'

self.addEventListener('install', () => {
  self.skipWaiting() // 新SWを即待機解除
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      await self.clients.claim() // 既存タブも即制御下に
    })(),
  )
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  e.respondWith(
    (async () => {
      try {
        const fresh = await fetch(req) // まずネットワーク＝常に最新
        const cache = await caches.open(CACHE)
        cache.put(req, fresh.clone()).catch(() => {})
        return fresh
      } catch {
        const cached = await caches.match(req) // 失敗時のみキャッシュ（オフライン）
        if (cached) return cached
        throw new Error('offline and not cached')
      }
    })(),
  )
})
