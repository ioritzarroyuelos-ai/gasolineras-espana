import type { Hono } from 'hono'
import type { Env } from '../index'
import { cargaCamarasSct, CAMARAS_SCT_FUENTE, type CamarasIO } from '../lib/camaras-sct'

export function registerCamarasRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/camaras/cataluna', async c => {
    c.header('Cache-Control', 'no-store'); c.header('X-Content-Type-Options', 'nosniff')
    if (new URL(c.req.url).search) return c.json({ error: 'Este directorio cubre Cataluña y no necesita tu ubicación.' }, 400)
    try {
      let cache: CamarasIO['cache']
      try { if (typeof caches !== 'undefined') cache = await caches.open('camaras-sct-v1') } catch {}
      return c.json(await cargaCamarasSct({ cache }))
    } catch {
      return c.json({ error: 'No se puede comprobar el directorio de cámaras ahora. Consulta la fuente oficial.', fuenteUrl: CAMARAS_SCT_FUENTE }, 503)
    }
  })
}
