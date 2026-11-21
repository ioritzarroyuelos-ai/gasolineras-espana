import type { Hono } from 'hono'
import type { Env } from '../index'
import { genNonce, pageHeaders, canonicalBase, loadSnapshot } from '../lib/runtime'
import { buildPage } from '../html/shell'
import { buildServiciosDirectory } from '../html/servicios-directorio'
import { landingHeaders } from '../html/landing'
import { cargaIndiceServicios } from '../lib/servicios'
import { buscaLocalidades, type LocalidadIndex } from '../lib/localidades'

export function registerCercaRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/cerca', c => {
    const nonce = genNonce()
    return new Response(buildPage(nonce, c.req.url, {
      turnstileSiteKey: c.env.TURNSTILE_SITE_KEY, canonicalOrigin: canonicalBase(c),
      supportUrl: c.env.SUPPORT_URL, mapTool: true, servicesTool: true,
    }), { headers: pageHeaders(nonce, !!c.env.TURNSTILE_SITE_KEY) })
  })
  app.get('/cerca/', c => c.redirect('/cerca' + new URL(c.req.url).search, 301))
  app.get('/servicios', c => c.redirect('/servicios/' + new URL(c.req.url).search, 301))
  app.get('/servicios/', async c => {
    const nonce = genNonce(), query = (c.req.query('q') || '').slice(0, 70)
    const index = await cargaIndiceServicios(c.env.ASSETS).catch(() => null)
    const places = query ? buscaLocalidades(await loadSnapshot<LocalidadIndex[]>(c.req.url, 'localidades-index.json', c.env.ASSETS) || [], query) : []
    return new Response(buildServiciosDirectory({ nonce, canonical: canonicalBase(c) + '/servicios/', index, query, places }), { headers: landingHeaders(nonce) })
  })
}
