import type { Hono } from 'hono'
import type { Env } from '../index'
import { cargaTraficoSct, SCT_FUENTE, type SctIO } from '../lib/trafico-sct'
import { canonicalBase, genNonce } from '../lib/runtime'
import { landingHeaders } from '../html/landing'
import { buildTraficoPage } from '../html/trafico'

async function sourceCache(): Promise<SctIO['cache']> {
  try { if (typeof caches !== 'undefined') return await caches.open('trafico-sct-v1') } catch {}
}

export function registerTraficoRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/trafico', c => c.redirect('/trafico/', 301))
  app.get('/trafico/', c => {
    const nonce = genNonce()
    return new Response(buildTraficoPage({ nonce, canonical: canonicalBase(c) + '/trafico/', data: null, index: true }), { headers: landingHeaders(nonce) })
  })
  app.get('/trafico/cataluna', async c => {
    const nonce = genNonce(), data = await cargaTraficoSct({ cache: await sourceCache() }).catch(() => null)
    return new Response(buildTraficoPage({ nonce, canonical: canonicalBase(c) + '/trafico/cataluna', data }), {
      status: data ? 200 : 503, headers: { ...landingHeaders(nonce), 'Cache-Control': 'no-store' },
    })
  })
  app.get('/trafico/cataluna/', c => c.redirect('/trafico/cataluna', 301))
  app.get('/api/trafico/cataluna', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff')
    if (new URL(c.req.url).search) return c.json({ error: 'Esta consulta cubre Cataluña y no necesita tu ubicación.' }, 400)
    try {
      const data = await cargaTraficoSct({ cache: await sourceCache() })
      return c.json({ ...data, evaluadoEn: new Date().toISOString() })
    } catch {
      return c.json({ error: 'No se puede comprobar el tráfico de Cataluña ahora. Consulta el estado publicado por el SCT.', fuenteUrl: SCT_FUENTE }, 503)
    }
  })
}
