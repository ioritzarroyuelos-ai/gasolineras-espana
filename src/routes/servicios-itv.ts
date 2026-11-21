import type { Hono } from 'hono'
import type { Env } from '../index'
import { cargaItvServicios, consultaItvServicios, itvEnZona, SERVICIO_ITV_ID } from '../lib/servicios-itv'

const CACHE = { 'Cache-Control': 'public, max-age=300, s-maxage=300', 'X-Content-Type-Options': 'nosniff' }
const NO_CACHE = { 'Cache-Control': 'no-store' }

export function registerServiciosItvRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/servicios/itv/:id', async c => {
    const id = c.req.param('id'), zona = consultaItvServicios(new URL(c.req.url))
    if (!SERVICIO_ITV_ID.test(id) || !zona) return c.json({ error: 'Indica una estación ITV y una zona válidas.' }, 400, NO_CACHE)
    try {
      const { items, ...state } = await cargaItvServicios(c.env.ASSETS)
      const item = itvEnZona(items, zona).find(item => item.id === id)
      return item ? c.json({ ...state, zona, item }, 200, CACHE) : c.json({ ...state, zona, error: 'Esta estación ya no tiene una ubicación comprobable en esta zona. Consulta el directorio de ITV.' }, 404, NO_CACHE)
    } catch { return c.json({ error: 'No se puede comprobar ahora el directorio de ITV. Inténtalo más tarde.' }, 503, NO_CACHE) }
  })
  app.get('/api/servicios/itv', async c => {
    const zona = consultaItvServicios(new URL(c.req.url))
    if (!zona) return c.json({ error: 'Indica una zona válida.' }, 400, NO_CACHE)
    try {
      const { items, ...state } = await cargaItvServicios(c.env.ASSETS)
      const matches = itvEnZona(items, zona)
      if (!matches.length) state.warnings.push('No hay estaciones con ubicación comprobable en esta zona. Consulta el directorio completo: puede haber otras sin coordenadas.')
      return c.json({ ...state, zona, total: matches.length, items: matches }, 200, CACHE)
    } catch { return c.json({ error: 'No se puede comprobar ahora el directorio de ITV. Inténtalo más tarde.' }, 503, NO_CACHE) }
  })
}
