import type { Hono } from 'hono'
import type { Env } from '../index'
import { cargaGuardiasServicios, consultaGuardiasServicios } from '../lib/servicios-guardias'

export function registerServiciosGuardiasRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/servicios/guardias', async c => {
    const consulta = consultaGuardiasServicios(new URL(c.req.url))
    if (!consulta) return c.json({ error: 'Indica una zona y un filtro de guardias válidos.' }, 400, { 'Cache-Control': 'no-store' })
    try {
      const { errorTotal, ...result } = await cargaGuardiasServicios(c.env.ASSETS, consulta)
      // El estado «ahora» se recalcula en cada visita, sin caché HTTP que cruce
      // un cambio de turno. Sólo los ficheros originales se reutilizan 30 segundos.
      return c.json(result, errorTotal ? 503 : 200, { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    } catch { return c.json({ error: 'No se pueden comprobar ahora las guardias de esta zona. Consulta el listado de farmacias.', directorioUrl: '/farmacias' }, 503, { 'Cache-Control': 'no-store' }) }
  })
}
