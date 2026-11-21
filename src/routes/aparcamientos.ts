import type { Hono } from 'hono'
import type { Env } from '../index'
import { APARCAMIENTOS_FUENTES, parkingFuente } from '../lib/aparcamientos-datos'
import { cargaAparcamientos, type ParkingCache } from '../lib/aparcamientos'

export function registerAparcamientosRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/aparcamientos/:ciudad', async c => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    const city = c.req.param('ciudad')
    if (!parkingFuente(city)) return c.json({ error: 'No hay una fuente de aparcamientos verificada para esta ciudad.' }, 404)
    if (new URL(c.req.url).search) return c.json({ error: 'La consulta muestra la ciudad completa y no necesita tu ubicación.' }, 400)
    try {
      let cache: ParkingCache | undefined
      try { if (typeof caches !== 'undefined') cache = await caches.open('aparcamientos-v1') } catch {}
      return c.json(await cargaAparcamientos(city, c.env?.ASSETS, { cache }))
    } catch {
      return c.json({ error: 'No se puede consultar la ocupación ni recuperar el catálogo ahora. Consulta la fuente oficial.', fuenteUrl: APARCAMIENTOS_FUENTES[city].fuenteUrl }, 503)
    }
  })
}
