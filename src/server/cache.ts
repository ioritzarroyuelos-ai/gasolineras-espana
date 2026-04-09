import type { Context } from 'hono'

export type CacheResult<T> = {
  cacheStatus: 'HIT' | 'MISS'
  data: T
}

export async function fetchJsonWithTimeout<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 12000
): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs)

  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    if (!response.ok) {
      throw new Error(`Upstream request failed with ${response.status}`)
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

export async function withEdgeCache<T>(
  c: Context,
  key: string,
  ttlSeconds: number,
  producer: () => Promise<T>
): Promise<CacheResult<T>> {
  const cache = caches.default
  const cacheUrl = new URL(c.req.url)
  cacheUrl.pathname = `/__cache/${key}`
  cacheUrl.search = ''

  const cacheRequest = new Request(cacheUrl.toString(), {
    method: 'GET',
    headers: { Accept: 'application/json' }
  })

  const cached = await cache.match(cacheRequest)
  if (cached) {
    return {
      cacheStatus: 'HIT',
      data: (await cached.json()) as T
    }
  }

  const data = await producer()
  const response = new Response(JSON.stringify(data), {
    headers: {
      'Cache-Control': `public, max-age=${ttlSeconds}`,
      'Content-Type': 'application/json; charset=utf-8'
    }
  })

  c.executionCtx.waitUntil(cache.put(cacheRequest, response))

  return {
    cacheStatus: 'MISS',
    data
  }
}

export function roundCoordinate(value: number, decimals = 4): number {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}
