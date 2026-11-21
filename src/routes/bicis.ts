import type { Hono } from 'hono'
import type { Env } from '../index'
import { cargaBicisZaragoza, type BicisCache } from '../lib/bicis-gbfs'

export function registerBicisRoutes(app: Hono<{ Bindings: Env }>): void {
  app.get('/api/bicis/zaragoza', async c => {
    c.header('Cache-Control', 'no-store')
    c.header('X-Content-Type-Options', 'nosniff')
    if (new URL(c.req.url).search) return c.json({ error: 'Esta consulta muestra la red de Zaragoza completa y no necesita tu ubicación.' }, 400)
    try {
      let cache: BicisCache | undefined
      try { if (typeof caches !== 'undefined') cache = await caches.open('bicis-gbfs-v1') } catch {}
      const data = await cargaBicisZaragoza({ cache })
      return c.json({ ...data, evaluadoEn: new Date().toISOString() })
    } catch {
      return c.json({ error: 'No se puede comprobar la disponibilidad de Bizi ahora. Consulta el mapa oficial o inténtalo más tarde.',
        fuenteUrl: 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad',
      }, 503)
    }
  })
}
