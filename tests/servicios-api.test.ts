import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { registerServiciosRoutes } from '../src/routes/servicios'
import { SERVICIOS_TILE_MAX, consultaServicios, cargaIndiceServicios } from '../src/lib/servicios'
import { servicioTileBbox, type ServicioPoi, type ServiciosIndex } from '../scripts/lib/servicios.mjs'

const zona = '521-705', now = Date.now()
const point = (id = 1, categorias = ['banos']): ServicioPoi => ({ id: 'osm-node-' + id, categorias, nombre: 'Lugar ' + id, lat: 40.4, lon: -3.7, gratis: null, accesible: 'desconocido', acceso: 'publico', fuenteUrl: 'https://www.openstreetmap.org/node/' + id, ubicacion: 'punto' })
async function fixture(pois = [point()], tileId = zona) {
  const bytes = new TextEncoder().encode(JSON.stringify({ schema: 1, id: tileId, pois }))
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('')
  const ts = new Date(now - 1000).toISOString(), fechaDatos = new Date(now - 86400000).toISOString()
  const categorias: Record<string, number> = {}
  for (const p of pois) for (const c of p.categorias) categorias[c] = (categorias[c] || 0) + 1
  const index: ServiciosIndex = { schema: 1, ts, fechaDatos, total: pois.length, categorias, tileSize: 0.25, licencia: 'ODbL-1.0', atribucion: '© OpenStreetMap contributors', fuentes: [{ id: 'espana', url: 'https://download.geofabrik.de/europe/spain/spain-latest.osm.pbf', fechaDatos, consultado: ts, bytes: 10000000 }], tiles: [{ id: tileId, bbox: servicioTileBbox(tileId), count: pois.length, bytes: bytes.byteLength, sha256: hash }] }
  const fetch = vi.fn(async (req: Request) => req.url.endsWith('/index.json') ? Response.json(index) : new Response(bytes))
  const app = new Hono<{ Bindings: Env }>(); registerServiciosRoutes(app)
  const request = (query = '?zona=' + zona) => app.request('/api/servicios' + query, {}, { ASSETS: { fetch } })
  return { index, bytes, fetch, request }
}
describe('directorio de servicios por cuadrículas públicas', () => {
  it('sirve información comprobable sin calcular apertura ni enviar coordenadas del usuario', async () => {
    const f = await fixture(), res = await f.request(), body = await res.json() as any
    expect(res.status).toBe(200); expect(body.items).toHaveLength(1)
    expect(body).toMatchObject({ zona, total: 1, pagina: 0, siguientePagina: null, truncated: false, desactualizado: false, fechaDatos: f.index.fechaDatos, consultado: f.index.ts, licencia: 'ODbL-1.0' })
    expect(body.items[0]).not.toHaveProperty('abierto'); expect(body.items[0]).not.toHaveProperty('distancia')
    expect(f.fetch.mock.calls.map(([r]) => new URL(r.url).pathname)).toEqual(['/data/servicios/index.json', '/data/servicios/tiles/' + zona + '.json'])
    expect(res.headers.get('cache-control')).toContain('max-age=300')
  })
  it('comparte una consulta simultánea y caduca el índice a los30segundos',async()=>{
    const f=await fixture(),assets={fetch:f.fetch}
    const [a,b]=await Promise.all([cargaIndiceServicios(assets,now),cargaIndiceServicios(assets,now)])
    expect(a).toBe(b);expect(f.fetch).toHaveBeenCalledTimes(1)
    expect(await cargaIndiceServicios(assets,now+29999)).toBe(a)
    expect(f.fetch).toHaveBeenCalledTimes(1)
    await cargaIndiceServicios(assets,now+30000)
    expect(f.fetch).toHaveBeenCalledTimes(2)
  })
  it('no mezcla despliegues ni conserva fallos o un reloj desplazado hacia atrás',async()=>{
    const f=await fixture(),assets={fetch:f.fetch}
    await cargaIndiceServicios(assets,now)
    await cargaIndiceServicios({fetch:f.fetch},now)
    expect(f.fetch).toHaveBeenCalledTimes(2)
    await cargaIndiceServicios(assets,now-1)
    expect(f.fetch).toHaveBeenCalledTimes(3)
    const get=vi.fn().mockRejectedValueOnce(Error('caída')).mockResolvedValueOnce(Response.json(f.index)),failed={fetch:get}
    await expect(cargaIndiceServicios(failed,now)).rejects.toThrow('caída')
    expect((await cargaIndiceServicios(failed,now)).total).toBe(1)
    expect(get).toHaveBeenCalledTimes(2)
  })
  it.each(['?zona=../../secret', '?zona=1-1', '?zona=521-705&categorias=adultos', '?zona=521-705&pagina=-1', '?zona=521-705&pagina=1.5', '?zona=521-705&pagina=10000', '?zona=521-705&zona=521-706', '?zona=521-705&lat=40.4168&lon=-3.7038', '?zona=521-705&categorias='])('rechaza consulta inválida antes de leer ficheros: %s', async query => {
    const f = await fixture(), res = await f.request(query)
    expect(res.status).toBe(400); expect(f.fetch).not.toHaveBeenCalled()
  })
  it('reconoce zonas de Canarias, Ceuta, Melilla y límites sin aceptar todo el mundo', () => {
    for (const id of ['472-656', '503-698', '501-708', '538-738', '521-705.2', '521-705.0.1.2.3']) expect(consultaServicios(new URL('https://test/api?zona=' + id))).not.toBeNull()
    expect(consultaServicios(new URL('https://test/api?zona=360-720'))).toBeNull()
    expect(consultaServicios(new URL('https://test/api?zona=521-705.4'))).toBeNull()
    expect(consultaServicios(new URL('https://test/api?zona=521-705.0.1.2.3.0'))).toBeNull()
  })
  it('una zona densa devuelve hojas pequeñas y nunca un falso listado vacío', async()=>{
    const leaf=zona+'.2',f=await fixture([point()],leaf)
    const parent=await (await f.request()).json() as any
    expect(parent).toMatchObject({dividida:true,total:null,subzonas:[{id:leaf,bbox:servicioTileBbox(leaf)}]})
    expect(f.fetch).toHaveBeenCalledTimes(1)
    const result=await (await f.request('?zona='+leaf)).json() as any
    expect(result.items).toHaveLength(1);expect(result.total).toBe(1)
    const catalog=await (await f.request('/categorias')).json() as any
    expect(catalog.zonas).toEqual([{id:leaf,bbox:servicioTileBbox(leaf)}])
  })
  it('si cambia la división del índice informa cómo consultar de nuevo un favorito',async()=>{
    const f=await fixture([point()],zona+'.2')
    const moved=await f.request('/lugar/osm-node-1?zona='+zona)
    expect(moved.status).toBe(409)
    expect(await moved.json()).toMatchObject({dividida:true,subzonas:[{id:zona+'.2'}]})
    expect((await f.request('/lugar/osm-node-1?zona='+zona+'.2')).status).toBe(200)
    const coarse=await fixture()
    expect(await (await coarse.request('?zona='+zona+'.2')).json()).toMatchObject({dividida:true,subzonas:[{id:zona}]})
  })
  it('pagina por identificador estable y filtra categorías sin perder resultados', async () => {
    const f = await fixture(Array.from({ length: 205 }, (_, n) => point(205 - n, ['banos', 'agua-potable'])))
    const a = await (await f.request('?zona=' + zona + '&categorias=banos,banos&pagina=0')).json() as any
    const b = await (await f.request('?zona=' + zona + '&categorias=agua-potable&pagina=1')).json() as any
    expect(a).toMatchObject({ total: 205, truncated: true, siguientePagina: 1, categorias: ['banos'] })
    expect(b).toMatchObject({ total: 205, truncated: true, siguientePagina: null })
    expect(a.items).toHaveLength(200); expect(b.items).toHaveLength(5)
    const ids = [...a.items, ...b.items].map(p => p.id)
    expect(new Set(ids).size).toBe(205); expect(ids).toEqual([...ids].sort())
  })
  it('una zona vacía se distingue de un fichero que falta', async () => {
    const f = await fixture(), empty = await (await f.request('?zona=521-706')).json() as any
    expect(empty.items).toEqual([]); expect(empty.warnings.join(' ')).toContain('no significa que no existan')
    f.fetch.mockImplementation(async req => req.url.endsWith('/index.json') ? Response.json(f.index) : new Response('missing', { status: 404 }))
    const res = await f.request(); expect(res.status).toBe(503); expect(res.headers.get('cache-control')).toBe('no-store')
  })
  it.each(['hash', 'bytes', 'malformed', 'huge-header', 'huge-stream'])('no muestra datos parciales o dañados: %s', async mode => {
    const f = await fixture()
    if (mode === 'hash') f.index.tiles[0].sha256 = '0'.repeat(64)
    if (mode === 'bytes') f.index.tiles[0].bytes++
    if (mode === 'malformed') f.index.tiles[0].bbox[0]++
    if (mode.startsWith('huge')) f.fetch.mockImplementation(async req => req.url.endsWith('/index.json') ? Response.json(f.index) : mode === 'huge-header' ? new Response('{}', { headers: { 'Content-Length': String(SERVICIOS_TILE_MAX + 1) } }) : new Response(new Uint8Array(SERVICIOS_TILE_MAX + 1)))
    expect((await f.request()).status).toBe(503)
  })
  it('un dato antiguo descargado hoy sigue marcado como antiguo', async () => {
    const f = await fixture()
    f.index.fechaDatos = f.index.fuentes[0].fechaDatos = new Date(now - 4 * 86400000).toISOString()
    const body = await (await f.request()).json() as any
    expect(body.desactualizado).toBe(true); expect(body.warnings.join(' ')).toContain('pendiente de actualizar')
    expect(body.fechaDatos).toBe(f.index.fechaDatos)
  })
  it('farmacia del directorio no se presenta como farmacia de guardia', async () => {
    const f = await fixture([point(1, ['farmacias'])]), body = await (await f.request('?zona=' + zona + '&categorias=farmacias')).json() as any
    expect(body.warnings.join(' ')).toContain('directorio general'); expect(body.items[0]).not.toHaveProperty('guardia')
  })
  it('catálogo muestra sólo categorías con lugares y mantiene las fuentes fechadas', async () => {
    const f = await fixture(), body = await (await f.request('/categorias')).json() as any
    expect(body.categorias.find((c: any) => c.id === 'banos')).toMatchObject({ total: 1, grupoNombre: 'Servicios del día a día' })
    expect(body.categorias.find((c: any) => c.id === 'talleres')).toBeUndefined()
    expect(body.fuentes[0].fechaDatos).toBe(f.index.fechaDatos)
  })
  it('recupera un favorito por identificador sin recorrer las páginas', async () => {
    const f = await fixture(Array.from({ length: 205 }, (_, n) => point(n + 1)))
    const res = await f.request('/lugar/osm-node-99?zona=' + zona), body = await res.json() as any
    expect(res.status).toBe(200); expect(body.item.id).toBe('osm-node-99')
    expect(body).toMatchObject({ zona, consultado: f.index.ts, fechaDatos: f.index.fechaDatos })
    expect(f.fetch).toHaveBeenCalledTimes(2)
  })
  it('distingue un favorito retirado o movido de un fallo de comprobación', async () => {
    const f = await fixture()
    expect((await f.request('/lugar/osm-node-999?zona=' + zona)).status).toBe(404)
    expect((await f.request('/lugar/osm-node-1?zona=521-706')).status).toBe(404)
    f.index.tiles[0].sha256 = '0'.repeat(64)
    expect((await f.request('/lugar/osm-node-1?zona=' + zona)).status).toBe(503)
  })
  it.each(['/lugar/osm-node-x?zona=521-705', '/lugar/osm-node-1?zona=../../secret', '/lugar/osm-node-1?zona=521-705&pagina=0', '/lugar/osm-node-1?zona=521-705&lat=40.4'])('rechaza la ficha inválida antes de cargar datos: %s', async path => {
    const f = await fixture()
    expect((await f.request(path)).status).toBe(400); expect(f.fetch).not.toHaveBeenCalled()
  })
})
