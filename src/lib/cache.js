const store = new Map()

/**
 * Wrap any async fetcher with a short-lived in-memory cache.
 * Same key within ttlMs returns the cached result instantly.
 * Realtime subscriptions still push updates — invalidate() on those events.
 */
export async function cached(key, fetcher, ttlMs = 45_000) {
  const hit = store.get(key)
  if (hit && Date.now() - hit.ts < ttlMs) return hit.data
  const data = await fetcher()
  store.set(key, { data, ts: Date.now() })
  return data
}

export function invalidate(key) {
  if (key) store.delete(key)
  else store.clear()
}
