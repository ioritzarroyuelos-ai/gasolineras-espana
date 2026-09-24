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

  it('sitemap: los hubs semi-estáticos NO emiten lastmod (evita lastmod falso)', async () => {
    const res = await app.request('/sitemap.xml', {}, { ASSETS: assets404() })
    const body = await res.text()
    // Hubs sin fecha fiable: la URL va directa a <changefreq>, sin <lastmod> en medio.
    expect(body).toMatch(/\/tiempo\/<\/loc><changefreq>/)
    expect(body).toMatch(/\/farmacias\/<\/loc><changefreq>/)
    expect(body).toMatch(/\/politica\/<\/loc><changefreq>/)
    expect(body).toMatch(/\/privacidad<\/loc><changefreq>yearly/)
    // Gasolineras SÍ mantiene lastmod (fecha real del snapshot; hoy como fallback).
    expect(body).toMatch(/\/gasolineras\/<\/loc><lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/)
  })

  it('/acerca -> 200 HTML con metodología y fuentes (E-E-A-T)', async () => {
    const res = await app.request('/acerca', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('Acerca de España Útil')
    expect(body).toContain('AEMET')
    expect(body).toContain('Ministerio')
  })

  it('sitemap incluye /acerca', async () => {
    const res = await app.request('/sitemap.xml', {}, { ASSETS: assets404() })
    const body = await res.text()
    expect(body).toContain('/acerca</loc>')
  })

  it('sitemap-tiempo: municipios con changefreq weekly y sin lastmod global', async () => {
    const res = await app.request('/sitemap-tiempo.xml', {}, { ASSETS: assets404() })
    const body = await res.text()
    // Con ASSETS 404 no hay municipios, pero el documento es XML válido y vacío de urls.
    expect(body).toContain('<urlset')
    expect(body).not.toContain('<lastmod>')
  })
})
