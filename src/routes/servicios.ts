import type { Hono } from 'hono'
import type { Env } from '../index'
import { SERVICIOS_CATEGORIAS, SERVICIOS_PAGINA, cargaIndiceServicios, cargaTileServicios, consultaServicios, estadoServicios, zonasAlternativasServicios } from '../lib/servicios'
import { SERVICIOS_ID_RE } from '../../scripts/lib/servicios.mjs'
import { buscaDireccionServicio, leeBusquedaDireccion, CartociudadBodyError, CARTOCIUDAD_ATRIBUCION, CARTOCIUDAD_URL } from '../lib/cartociudad'

const CACHE = { 'Cache-Control': 'public, max-age=300, s-maxage=300', 'X-Content-Type-Options': 'nosniff' }
const NO_CACHE = { 'Cache-Control': 'no-store' }
const GRUPOS: Record<string, string> = { movilidad: 'Movilidad', transporte: 'Transporte público', salud: 'Salud y cuidados', cotidiano: 'Servicios del día a día', publicos: 'Servicios públicos', ocio: 'Ocio y aire libre' }
export function registerServiciosRoutes(app: Hono<{ Bindings: Env }>): void {
  app.post('/api/servicios/buscar-direccion', async c => {
    c.header('Cache-Control', 'no-store')
    if (new URL(c.req.url).search || !/^application\/json(?:\s*;|$)/i.test(c.req.header('Content-Type') || '')) return c.json({ error: 'Envía la dirección como JSON mediante el formulario de búsqueda.' }, 400, NO_CACHE)
    try {
      const q = await leeBusquedaDireccion(c.req.raw)
      const resultados = await buscaDireccionServicio(q)
      return c.json({ resultados, consultado: new Date().toISOString(), atribucion: CARTOCIUDAD_ATRIBUCION, fuenteUrl: CARTOCIUDAD_URL,
        warnings: ['Elige la dirección que coincide con tu búsqueda. Los códigos postales y las calles sin número señalan una zona aproximada.'],
      }, 200, NO_CACHE)
    } catch (error) {
      if (error instanceof CartociudadBodyError) return c.json({ error: 'Escribe una dirección o código postal de entre 3 y 150 caracteres.' }, 400, NO_CACHE)
      return c.json({ error: 'CartoCiudad no está disponible ahora. Puedes buscar un municipio o intentarlo más tarde.' }, 503, NO_CACHE)
    }
  })
  app.get('/api/servicios/categorias', async c => {
    try {
      const index = await cargaIndiceServicios(c.env.ASSETS)
      return c.json({ schema: 1, ...estadoServicios(index), tileSize: index.tileSize, total: index.total,
        categorias: SERVICIOS_CATEGORIAS.filter(cat => index.categorias[cat.id] > 0).map(cat => ({ ...cat, grupoNombre: GRUPOS[cat.grupo], total: index.categorias[cat.id] })),
        fuentes: index.fuentes,
        zonas: index.tiles.map(tile => ({ id: tile.id, bbox: tile.bbox })),
      }, 200, CACHE)
    } catch {
      return c.json({ error: 'El directorio está temporalmente sin comprobar. Inténtalo de nuevo más tarde.' }, 503, NO_CACHE)
    }
  })
  app.get('/api/servicios/lugar/:id', async c => {
    const id = c.req.param('id'), url = new URL(c.req.url)
    const query = consultaServicios(url)
    if (!SERVICIOS_ID_RE.test(id) || !query || [...url.searchParams.keys()].some(k => k !== 'zona')) return c.json({ error: 'Indica un lugar y una zona válidos.' }, 400, NO_CACHE)
    try {
      const index = await cargaIndiceServicios(c.env.ASSETS)
      const meta = index.tiles.find(tile => tile.id === query.zona)
      if (!meta) {
        const subzonas = zonasAlternativasServicios(index, query.zona)
        if (subzonas.length) return c.json({ error: 'La distribución de esta zona ha cambiado. Consulta la zona indicada en el catálogo.', dividida: true, subzonas, zona: query.zona, ...estadoServicios(index) }, 409, NO_CACHE)
      }
      const item = meta ? (await cargaTileServicios(meta, c.env.ASSETS)).find(p => p.id === id) : undefined
      if (!item) return c.json({ error: 'El lugar ya no aparece en el directorio de esta zona.', zona: query.zona, ...estadoServicios(index) }, 404, NO_CACHE)
      const estado = estadoServicios(index)
      if (item.categorias.includes('farmacias')) estado.warnings.push('Esta farmacia pertenece al directorio general. Las guardias se consultan en la sección Farmacias de guardia.')
      return c.json({ schema: 1, ...estado, zona: query.zona, item }, 200, CACHE)
    } catch {
      return c.json({ error: 'No se puede comprobar este lugar. Inténtalo de nuevo más tarde.' }, 503, NO_CACHE)
    }
  })
  app.get('/api/servicios', async c => {
    const query = consultaServicios(new URL(c.req.url))
    if (!query) return c.json({ error: 'Indica una zona válida, categorías del catálogo y una página desde 0.' }, 400, NO_CACHE)
    try {
      const index = await cargaIndiceServicios(c.env.ASSETS)
      const meta = index.tiles.find(tile => tile.id === query.zona)
      if (!meta) {
        const subzonas = zonasAlternativasServicios(index, query.zona)
        if (subzonas.length) return c.json({ schema: 1, ...estadoServicios(index), dividida: true, subzonas, zona: query.zona, categorias: query.categorias, pagina: 0, pageSize: SERVICIOS_PAGINA, total: null, truncated: false, siguientePagina: null, items: [] }, 200, CACHE)
      }
      const pois = meta ? await cargaTileServicios(meta, c.env.ASSETS) : []
      const matches = pois.filter(p => !query.categorias.length || p.categorias.some(cat => query.categorias.includes(cat))).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      const start = query.pagina * SERVICIOS_PAGINA
      const siguientePagina = start + SERVICIOS_PAGINA < matches.length ? query.pagina + 1 : null
      const estado = estadoServicios(index), warnings = [...estado.warnings]
      if (query.categorias.includes('farmacias') || matches.some(p => p.categorias.includes('farmacias'))) warnings.push('Estas farmacias pertenecen al directorio general. Las guardias se consultan en la sección Farmacias de guardia.')
      if (!matches.length) warnings.push('No hay lugares registrados para estos filtros en esta zona. Esto no significa que no existan.')
      return c.json({ schema: 1, ...estado, warnings, zona: query.zona, categorias: query.categorias,
        pagina: query.pagina, pageSize: SERVICIOS_PAGINA, total: matches.length, truncated: matches.length > SERVICIOS_PAGINA,
        siguientePagina, items: matches.slice(start, start + SERVICIOS_PAGINA),
      }, 200, CACHE)
    } catch {
      return c.json({ error: 'No se puede comprobar el directorio de esta zona. Inténtalo de nuevo más tarde.' }, 503, NO_CACHE)
    }
  })
}
