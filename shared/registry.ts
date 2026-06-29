// shared/registry.ts — games.json を読んでハブのカードを生成（データ駆動）
// 取得は import.meta.env.BASE_URL 起点。Pages のサブパスでも 404 にならない。

export type GameEntry = {
  slug: string
  title: string
  desc: string
  tags: string[]
  date: string
  status: 'experiment' | 'featured'
  path: string
  thumb?: string
  credit?: string
}

export function assetUrl(p: string): string {
  return import.meta.env.BASE_URL + p
}

export async function loadGames(): Promise<GameEntry[]> {
  const url = import.meta.env.BASE_URL + 'games.json'
  const res = await fetch(url)
  if (!res.ok) throw new Error(`games.json を取得できません: ${res.status}`)
  const data = await res.json()
  const games: GameEntry[] = data.games ?? []
  // 新着順
  return games.sort((a, b) => (a.date < b.date ? 1 : -1))
}

export function gameUrl(entry: GameEntry): string {
  return import.meta.env.BASE_URL + entry.path
}
