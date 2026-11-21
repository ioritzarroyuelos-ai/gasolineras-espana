import type { Hono } from 'hono'
import type { Env } from '../index'
import { canonicalBase, genNonce } from '../lib/runtime'
import { landingHeaders } from '../html/landing'
import { SERVICIOS_PUBLICOS_FUENTES } from '../../scripts/lib/servicios-publicos.mjs'
import { cargaIndicePublicos, consultaDirectorioPublico, consultaPublicos, fuentePublicaId } from '../lib/servicios-publicos'
import { buildPublicosPage } from '../html/servicios-publicos'
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }

export function registerServiciosPublicosRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/servicios/publicos', async c => {
    if (new URL(c.req.url).search) return c.json({ error: 'El catálogo de fuentes no necesita parámetros.' }, 400, HEADERS)
    try { return c.json(await cargaIndicePublicos(c.env.ASSETS), 200, HEADERS) }
    catch { return c.json({ error: 'No se puede comprobar el catálogo de fuentes oficiales.' }, 503, HEADERS) }
  })
  app.get('/api/servicios/publicos/:fuente', async c => {
    const id = fuentePublicaId(c.req.param('fuente')), query = consultaPublicos(new URL(c.req.url), true)
    if (!id || !query) return c.json({ error: 'Indica una fuente, una zona pública y una página válidas. Esta consulta no necesita tu GPS.' }, 400, HEADERS)
    try { return c.json(await consultaDirectorioPublico(c.env.ASSETS, id, query), 200, HEADERS) }
    catch { return c.json({ error: 'No se puede comprobar ahora este directorio. Consulta su fuente oficial.', fuenteUrl: SERVICIOS_PUBLICOS_FUENTES.find(f => f.id === id)!.fuenteUrl }, 503, HEADERS) }
  })
  for (const definition of SERVICIOS_PUBLICOS_FUENTES) {
    app.get('/servicios/' + definition.id + '/', c => c.redirect('/servicios/' + definition.id + new URL(c.req.url).search, 301))
    app.get('/servicios/' + definition.id, async c => {
      const query = consultaPublicos(new URL(c.req.url)), nonce = genNonce()
      if (!query) return new Response('Indica un texto de búsqueda y una página válidos.', { status: 400, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
      const data = await consultaDirectorioPublico(c.env.ASSETS, definition.id, query).catch(() => null)
      const invalidPage = data && data.pagina > 0 && !data.items.length
      return new Response(buildPublicosPage({ nonce, canonical: canonicalBase(c) + '/servicios/' + definition.id, definition, data, query: query.q, pagina: query.pagina }), { status: !data ? 503 : invalidPage ? 404 : 200, headers: landingHeaders(nonce) })
    })
  }
}
