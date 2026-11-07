import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Hono } from 'hono'
import type { Localidad } from '../src/lib/localidades'

// Portada y panel personal conservan accesos útiles aunque falle una fuente.
// Las búsquedas y la selección municipal funcionan también sin JavaScript.
type AnyApp = Hono<{ Bindings: Record<string, unknown> }>
function assets404() {
  return { fetch: async () => new Response(null, { status: 404 }) }
}

let app: AnyApp
beforeEach(async () => {
  vi.resetModules()
  app = (await import('../src/index')).default as unknown as AnyApp
})

describe('portada, Mi día y observatorio de precios', () => {
  it('/ responde 200 HTML (degradada sin datos)', async () => {
    const res = await app.request('/', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type') || '').toContain('text/html')
  })

  it('/?action=cheapest redirige 301 al mapa (compat PWA vieja)', async () => {
    const res = await app.request('/?action=cheapest', {}, { ASSETS: assets404() })
    expect(res.status).toBe(301)
    expect(res.headers.get('location')).toBe('/gasolineras/mapa?action=cheapest')
  })

  it('/mi-dia conserva los seis accesos aunque no haya datos', async () => {
    const res = await app.request('/mi-dia', {}, { ASSETS: assets404() })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    const html = await res.text()
    expect(html).toContain('Tu día.')
    expect(html).toContain('A tu manera.')
    expect(html).toContain('data-mi-dia')
    for (const id of ['tiempo', 'gasolineras', 'deportes', 'farmacias', 'itv', 'politica']) {
      expect(html).toContain('data-dia-module="' + id + '"')
      expect(html).toContain('href="/' + id + '/"')
    }
    expect(html).not.toMatch(/\sstyle=/)
    expect(res.headers.get('content-security-policy')).not.toContain('unsafe-inline')
  })

  it.each(['/', '/mi-dia'])('%s no inventa un municipio que no existe', async ruta => {
    const res = await app.request(ruta + '?municipio=99999', {}, { ASSETS: assets404() })
    expect(res.status).toBe(404)
  })

  it.each(['/', '/mi-dia'])('%s conserva los servicios del municipio aunque falten las demás fuentes', async ruta => {
    const localidad: Localidad = {
      ine: '28079', nombre: 'Madrid', provinciaNombre: 'Madrid',
      gas: { url: '/gasolineras/madrid/madrid', count: 0 },
      tiempo: { url: '/tiempo/madrid/madrid' },
      farmacias: { url: '/farmacias/madrid/madrid', count: 0, zona: 'Europe/Madrid' },
      itv: { url: '/itv/madrid/madrid', count: 0 },
    }
    const assets = { fetch: async (request: Request) => new URL(request.url).pathname === '/data/localidades/28.json'
      ? Response.json([localidad]) : new Response(null, { status: 503 }) }
    const res = await app.request(ruta + '?municipio=28079', {}, { ASSETS: assets })
    expect(res.status).toBe(200)
    const html = await res.text()
    expect(html).toContain('Tu municipio: Madrid')
    for (const servicio of ['gasolineras', 'tiempo', 'farmacias', 'itv']) expect(html).toContain('href="/' + servicio + '/madrid/madrid"')
    expect(html).not.toContain('undefined')
  })

  it('/precios-carburantes está registrada (no cae al notFound genérico con 500)', async () => {
    const res = await app.request('/precios-carburantes', {}, { ASSETS: assets404() })
    expect(res.status).toBeLessThan(500)
  })
})
