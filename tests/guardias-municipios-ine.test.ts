import catalogoMeteorologico from '../public/data/tiempo/municipios.json?raw'
import { describe, it, expect } from 'vitest'
import app from '../src/index'
import { municipiosFarmacia, slugsFarmacia } from '../src/lib/guardias-municipios-ine'
import { PROVINCIAS } from '../src/lib/provincias'
import type { LocalidadIndex } from '../src/lib/localidades'

const base: LocalidadIndex[] = JSON.parse(catalogoMeteorologico).municipios
const catalogo = municipiosFarmacia(base)
const nuevas = catalogo.filter(m => !base.some(v => v.ine === m.ine))
const as = { fetch: async (req: Request) => {
  const ruta = new URL(req.url).pathname
  if (ruta === '/data/localidades-index.json') return Response.json(base)
  const provincia = ruta.match(/^\/data\/localidades\/(\d\d)\.json$/)?.[1]
  if (provincia) return Response.json(base.filter(m => m.ine.startsWith(provincia)))
  const territorio = ruta.match(/guardias-([a-z]+)\.json$/)?.[1]
  return territorio ? Response.json({ territorio, ts: new Date().toISOString(), guardias: [] }) : new Response(null, { status: 404 })
} }
const get = (ruta: string) => app.request(ruta, {}, { ASSETS: as } as never)

describe('catálogo INE de Farmacias', () => {
  it('contiene 8.132 municipios distintos, incorpora doce y respeta las dos bajas por fusión', () => {
    expect(catalogo).toHaveLength(8132)
    expect(new Set(catalogo.map(m => m.ine)).size).toBe(8132)
    expect(nuevas).toHaveLength(12)
    expect(catalogo.some(m => m.ine === '36011' || m.ine === '36012')).toBe(false)
    expect(municipiosFarmacia(catalogo)).toEqual(catalogo)
  })

  it('encuentra las doce altas y muestra su ficha con el aviso de turno pendiente', async () => {
    for (const m of nuevas) {
      const prov = PROVINCIAS.find(p => p.id === m.ine.slice(0, 2))!
      const ruta = '/farmacias/' + prov.slug + '/' + slugsFarmacia(m)[0]
      expect((await get('/farmacias/buscar?q=' + encodeURIComponent(m.nombre))).headers.get('location')).toBe(ruta)
      const ficha = await get(ruta)
      expect(ficha.status).toBe(200)
      expect(await ficha.text()).toContain('Hoy no tenemos un turno confirmado en ' + m.nombre)
    }
  })

  it('conserva nombres anteriores y remite los municipios fusionados cuando faltan datos propios', async () => {
    expect((await get('/farmacias/buscar?q=Palamós')).headers.get('location')).toBe('/farmacias/girona/palamos-i-sant-joan')
    expect((await get('/farmacias/girona/palamos')).status).toBe(200)
    expect((await get('/farmacias/pontevedra/cerdedo?turno=ahora')).headers.get('location')).toBe('/farmacias/pontevedra/cerdedo-cotobade?turno=ahora')
    expect((await get('/farmacias/buscar?q=Cotobade')).headers.get('location')).toBe('/farmacias/pontevedra/cerdedo-cotobade')
  })
})
