import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { buildServiciosDirectory } from '../src/html/servicios-directorio'
import { registerCercaRoutes } from '../src/routes/cerca'
import type { ServiciosIndex } from '../scripts/lib/servicios.mjs'

// Datos deliberadamente pequeños para comprobar el alcance del texto, no la
// cobertura real de los proveedores que se enlazan.
function index(ageHours = 0): ServiciosIndex {
  const ts = new Date(Date.now() - ageHours * 3600000).toISOString()
  return { schema: 1, ts, fechaDatos: ts, total: 4, categorias: { banos: 4 },
    tileSize: .25, licencia: 'ODbL-1.0', atribucion: '© OpenStreetMap', fuentes: [], tiles: [] }
}
const render = (data: ServiciosIndex | null = index(), query = '') => buildServiciosDirectory({ nonce: 'test-nonce', canonical: 'https://example.test/servicios/', index: data, query, places: [] })
const officialLinks = [
  '/cerca?categorias=aparcamientos-madrid', '/cerca?categorias=aparcamientos-vigo',
  '/cerca?categorias=bicis-zaragoza', '/transporte/metro-bilbao', '/trafico/cataluna',
  '/farmacias/guardia', '/cerca?categorias=camaras-cataluna', '/itv/',
  '/servicios/refugios-cataluna', '/servicios/salas-estudio-madrid',
]

describe('descubrimiento de servicios y cobertura por fuente', () => {
  it('ofrece recorridos oficiales aun sin índice OSM, sin afirmar disponibilidad actual', () => {
    const html = render(null)
    for (const url of officialLinks) expect(html).toContain('href="' + url + '"')
    expect(html).toContain('El directorio OpenStreetMap está pendiente de comprobar')
    expect(html).toContain('cada una indica su propio estado')
    expect(html).not.toContain('Sin registros en esta copia')
    expect(html).not.toMatch(/\d+ plazas libres|actualizado hoy|Todo actualizado/)
  })
  it('no convierte una categoría OSM vacía en ausencia del catálogo oficial de D', () => {
    const html = render()
    expect(html).toContain('Sin registros en esta copia de OpenStreetMap:')
    expect(html).toContain('Esto no describe la cobertura de los directorios oficiales anteriores')
    expect(html).not.toContain('Categorías todavía sin datos comprobados')
    expect(html).toContain('href="/servicios/refugios-cataluna"')
    expect(html).toContain('href="/servicios/salas-estudio-madrid"')
    expect(html).toContain('4 lugares registrados en esta copia de OpenStreetMap')
    expect(html).toContain('Estos recuentos no incluyen las fuentes oficiales de arriba')
    expect(html.indexOf('id="sd-live"')).toBeLessThan(html.indexOf('id="sd-osm"'))
  })
  it('separa plazas, capacidad PMR, llegadas y directorios de los estados que no acreditan', () => {
    const html = render()
    for (const text of ['Madrid · ciudad', 'Vigo · ciudad', 'Zaragoza · red Bizi', 'Red Metro Bilbao', 'Cataluña · SCT y Terrassa', 'Municipios con fuente disponible',
      'totales, no plazas PMR libres', 'no confirma su activación ni apertura', 'no indica cuántas plazas quedan libres', 'no se confirman huecos libres', 'La hora de cada imagen es desconocida', 'No equivalen a salidas']) expect(html).toContain(text)
    expect(html).not.toContain('No hay ocupación')
  })
  it('la antigüedad OSM sólo califica su copia, sin rejuvenecer ni calificar las otras fuentes', () => {
    const html = render(index(80))
    expect(html).toContain('Directorio OpenStreetMap pendiente de actualizar')
    expect(html.indexOf('Directorio OpenStreetMap pendiente')).toBeGreaterThan(html.indexOf('id="sd-osm"'))
    expect(html).toContain('Cada sección comprueba su fuente y muestra la fecha del dato')
  })
  it('conserva buscador, canonical y escape de texto, con CSP sin atributos inline', () => {
    const html = render(index(), '\"><script>alert(1)</script>')
    expect(html).toContain('name="robots" content="noindex,follow"')
    expect(html).toContain('rel="canonical" href="https://example.test/servicios/"')
    expect(html).toContain('method="get" role="search"')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).not.toMatch(/\sstyle="/)
    expect(html).toContain('<style nonce="test-nonce">')
  })
  it('la ruta sigue disponible si falla OSM sin consultar cada proveedor para decorar tarjetas', async () => {
    const fetch = vi.fn(async (_request: Request) => new Response('Fallo simulado', { status: 503 }))
    const app = new Hono<{ Bindings: Env }>(); registerCercaRoutes(app)
    const response = await app.request('/servicios/', {}, { ASSETS: { fetch } })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy')).toContain("style-src 'self' 'nonce-")
    const html = await response.text()
    for (const url of officialLinks) expect(html).toContain('href="' + url + '"')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(fetch.mock.calls[0][0].url).toContain('/data/servicios/index.json')
  })
})
