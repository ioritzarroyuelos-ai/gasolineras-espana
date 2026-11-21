import type { Hono } from 'hono'
import type { Env } from '../index'
import { cargaMetroBilbao, METRO_FUENTE, type MetroIO } from '../lib/metro-bilbao'
import { canonicalBase, genNonce } from '../lib/runtime'
import { landingHeaders } from '../html/landing'
import { buildTransportePage } from '../html/transporte'

async function sourceCache(): Promise<MetroIO['cache']> {
  try { if (typeof caches !== 'undefined') return await caches.open('metro-bilbao-v1') } catch {}
}

export function registerTransporteRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/transporte', c => c.redirect('/transporte/', 301))
  app.get('/transporte/', c => {
    const nonce = genNonce()
    return new Response(buildTransportePage({ nonce, canonical: canonicalBase(c) + '/transporte/', data: null, index: true }), { headers: landingHeaders(nonce) })
  })
  app.get('/transporte/metro-bilbao/', c => c.redirect('/transporte/metro-bilbao', 301))
  app.get('/transporte/metro-bilbao', async c => {
    const nonce = genNonce(), data = c.env?.ASSETS ? await cargaMetroBilbao(c.env.ASSETS, { cache: await sourceCache() }).catch(() => null) : null
    return new Response(buildTransportePage({ nonce, canonical: canonicalBase(c) + '/transporte/metro-bilbao', data }), { status: data ? 200 : 503, headers: landingHeaders(nonce) })
  })
  app.get('/api/transporte/metro-bilbao', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff')
    if (new URL(c.req.url).search) return c.json({ error: 'Esta consulta muestra Metro Bilbao y no necesita tu ubicación.' }, 400)
    if (!c.env?.ASSETS) return c.json({ error: 'El catálogo de Metro Bilbao no está disponible.', fuenteUrl: METRO_FUENTE }, 503)
    try {
      const data = await cargaMetroBilbao(c.env.ASSETS, { cache: await sourceCache() })
      return c.json({ ...data, evaluadoEn: new Date().toISOString() })
    } catch { return c.json({ error: 'No se pueden comprobar las llegadas ahora. Consulta Metro Bilbao o inténtalo más tarde.', fuenteUrl: METRO_FUENTE }, 503) }
  })
}
