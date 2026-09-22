import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'

// Endpoint tests de META/SEO tras extraer a src/routes/meta.ts (B1). Con ASSETS 404
// los sitemaps degradan a URLs estáticas (200), robots/privacidad no necesitan datos,
// y /status devuelve 503 (snapshot ausente = stale) — todos prueban el matching.
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>
function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('rutas META/SEO tras extraer a src/routes/meta.ts (B1)', () => {
  it('/robots.txt -> 200', async () => {
    const res = await app.request('/robots.txt', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
  })

  it('/sitemap.xml -> 200 XML', async () => {
    const res = await app.request('/sitemap.xml', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('xml')
  })

  it('/sitemap-guardias.xml -> 200', async () => {
    const res = await app.request('/sitemap-guardias.xml', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
  })

  it('/sitemap-tiempo.xml -> 200', async () => {
    const res = await app.request('/sitemap-tiempo.xml', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
  })

  it('/status responde (200 fresco / 503 stale) — registrada', async () => {
    const res = await app.request('/status', {}, { ASSETS: assets404() })
    expect([200, 503]).toContain(res.status)
  })

  it('/privacidad -> 200 HTML con el contenido honesto nuevo', async () => {
    const res = await app.request('/privacidad', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Si inicias sesión con Google')
    expect(body).toContain('Alertas de precios por Telegram')
  })
})
