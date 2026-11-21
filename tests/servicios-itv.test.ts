import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import type { EstacionITV, ItvFile } from '../src/lib/itv'
import { normalizaItvServicios, consultaItvServicios, itvEnZona, cargaItvServicios } from '../src/lib/servicios-itv'
import { registerServiciosItvRoutes } from '../src/routes/servicios-itv'
import { servicioTileId } from '../scripts/lib/servicios.mjs'

const now = Date.parse('2026-11-21T12:00:00Z'), checked = '2026-11-21T08:00:00Z'
function station(overrides: Partial<EstacionITV & { codigo: string }> = {}): EstacionITV & { codigo: string } {
  return { id: 'itv-28-2801', codigo: '2801', prov: '28', mun: 'MADRID', dir: 'Calle de prueba, 1', cp: '28001', tel: '912345678', op: 'Operador de prueba',
    lat: 40.4, lng: -3.7, lineas: 2, horario: '', fuente: 'industria', fuenteUrl: 'https://industria.gob.es/Calidad-Industrial/vehiculos/Paginas/inspeccion-tecnica-vehiculos.aspx',
    verificadoEn: checked, publicadoEn: '2026-07', contactoFuente: 'dgt', contactoFuenteUrl: 'https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/', contactoVerificadoEn: checked,
    citaUrl: 'https://www.itevelesa.com/es/reserva-itv', citaVerificadoEn: checked, ...overrides }
}
function directory(rows = [station()]): ItvFile {
  return { v: 2, total: rows.length, generatedAt: checked, estaciones: rows,
    fuentesEstado: [{ id: 'industria', nombre: 'Ministerio', url: 'https://industria.gob.es/', consultado: checked, estado: 'actualizada' }] }
}

describe('ITV oficial en el mapa: sólo ubicaciones publicadas', () => {
  it('conserva el código oficial aunque cambie el nombre o el ID de la fila DGT', () => {
    const first = normalizaItvServicios(directory(), null, now).items[0]
    const changed = normalizaItvServicios(directory([station({ id: 'itv-28-2801-otromunicipio', mun: 'OTRO NOMBRE' })]), null, now).items[0]
    expect(first.id).toBe('itv-28-2801'); expect(changed.id).toBe(first.id)
    expect(first).toMatchObject({ proveedor: 'itv-oficial', categorias: ['itv'], gratis: null, acceso: 'desconocido', accesible: 'desconocido' })
    expect(first.directorioUrl).toBe('/itv/madrid/madrid')
  })
  it('no sustituye una estación sin coordenadas por un centro municipal ni acepta geocodificación como prueba', () => {
    for (const row of [station({ lat: null, lng: null }), station({ contactoFuente: 'centro municipal' }), station({ contactoFuente: undefined, contactoFuenteUrl: undefined, contactoVerificadoEn: undefined })]) {
      expect(normalizaItvServicios(directory([row]), null, now).items).toEqual([])
    }
  })
  it('admite el punto de DGT directo y el punto de una ficha SGS, con su fecha', () => {
    const direct = station({ fuente: 'dgt', fuenteUrl: 'https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/', contactoFuente: undefined, contactoFuenteUrl: undefined, contactoVerificadoEn: undefined })
    expect(normalizaItvServicios(directory([direct]), null, now).items[0].coordenadas).toMatchObject({ fuente: 'DGT', verificadoEn: checked })
    const sgs = station({ fuente: 'operador-sgs', fuenteUrl: 'https://www.serviciositv.es/cita-previa-itv/vizcaya/amorebieta', contactoFuente: 'SGS ITV', contactoFuenteUrl: 'https://www.serviciositv.es/cita-previa-itv/vizcaya/amorebieta' })
    expect(normalizaItvServicios(directory([sgs]), null, now).items[0].coordenadas.fuente).toBe('SGS ITV')
  })
  it('la regeneración del fichero no rejuvenece coordenadas ni enlaces antiguos', () => {
    const old = '2026-08-01T06:22:56.815Z'
    const data = normalizaItvServicios(directory([station({ contactoVerificadoEn: old, citaVerificadoEn: old })]), null, now)
    expect(data.generadoEn).toBe(checked)
    expect(data.items[0]).toMatchObject({ verificadoEn: checked, publicadoEn: '2026-07', desactualizado: true,
      coordenadas: { verificadoEn: old, desactualizadas: true }, cita: { verificadoEn: old, desactualizada: true } })
    expect(JSON.stringify(data.items[0])).not.toMatch(/precio|plazas|abiertaAhora/)
  })
  it('rechaza identidades ambiguas, coordenadas futuras y fuentes o reservas ajenas', () => {
    expect(normalizaItvServicios(directory([station(), station({ id: 'otra-fila' })]), null, now).items).toEqual([])
    expect(normalizaItvServicios(directory([station({ contactoVerificadoEn: '2027-01-01T00:00:00Z' })]), null, now).items).toEqual([])
    expect(normalizaItvServicios(directory([station({ fuenteUrl: 'https://evil.example/' })]), null, now).items).toEqual([])
    expect(normalizaItvServicios(directory([station({ citaUrl: 'https://www.itevelesa.com.evil.example/cita' })]), null, now).items[0].cita).toBeUndefined()
    expect(() => normalizaItvServicios({ ...directory(), generatedAt: '2027-01-01T00:00:00Z' }, null, now)).toThrow()
  })
  it('usa el mismo cálculo de cuadrícula del mapa y no pierde un punto de frontera', () => {
    const data = normalizaItvServicios(directory([station({ lat: 40.25, lng: -3.5 })]), null, now)
    expect(itvEnZona(data.items, servicioTileId(40.25, -3.5))).toHaveLength(1)
    expect(itvEnZona(data.items, servicioTileId(40.249, -3.5))).toHaveLength(0)
    expect(itvEnZona(data.items, servicioTileId(40.25, -3.5, 2))).toHaveLength(1)
  })
  it('conserva el mapa si las comprobaciones de tarifas faltan o están dañadas', () => {
    const data = normalizaItvServicios(directory([station({ prov: '48', codigo: '4804' })]), { fuentes: {} } as any, now)
    expect(data.items).toHaveLength(1)
    expect(data.items[0].tarifas).toMatchObject({ desactualizada: true })
  })
  it('un contacto opcional dañado no ejecuta conversiones ni rompe las estaciones válidas', () => {
    const data = normalizaItvServicios(directory([station({ tel: { toString: 'no' }, cp: { toString: 'no' } } as any)]), null, now)
    expect(data.items).toHaveLength(1); expect(data.items[0].telefono).toBeUndefined(); expect(data.items[0].cp).toBeUndefined()
  })
  it.each(['zona=521-705&lat=40', 'zona=521-705&zona=521-705', 'zona=../../itv', 'zona=000-000', ''])('rechaza consultas fuera del contrato: %s', query => {
    expect(consultaItvServicios(new URL('https://example.test/?' + query))).toBe(null)
  })
})

describe('API ITV oficial pública, sin D1 ni red hacia terceros', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now) })
  afterEach(() => { vi.restoreAllMocks() })
  function api(payload: unknown = directory()) {
    const app = new Hono<{ Bindings: Env }>(); registerServiciosItvRoutes(app)
    const fetch = vi.fn(async (req: Request) => {
      const path = new URL(req.url).pathname
      if (path === '/data/itv.json') return new Response(JSON.stringify(payload))
      if (path === '/data/itv-tarifas-estado.json') return new Response(null, { status: 404 })
      throw new Error('Ruta inesperada')
    })
    return { fetch, request: (path: string) => app.request(path, {}, { ASSETS: { fetch } } as any) }
  }
  it('devuelve sólo la cuadrícula pedida con fechas originales y cobertura explícita', async () => {
    const a = api(), zona = servicioTileId(40.4, -3.7), res = await a.request('/api/servicios/itv?zona=' + zona)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ proveedor: 'itv-oficial', zona, totalDirectorio: 1, totalConCoordenadas: 1, total: 1, items: [{ id: 'itv-28-2801', verificadoEn: checked }] })
    expect(a.fetch).toHaveBeenCalledTimes(2)
    expect(res.headers.get('cache-control')).toContain('public')
  })
  it('recupera un favorito oficial sólo si sigue presente y en esa cuadrícula', async () => {
    const a = api(), zona = servicioTileId(40.4, -3.7)
    expect((await a.request('/api/servicios/itv/itv-28-2801?zona=' + zona)).status).toBe(200)
    expect((await a.request('/api/servicios/itv/itv-28-2801?zona=' + servicioTileId(40, -3))).status).toBe(404)
    const removed = api(directory([station({ lat: null, lng: null })]))
    expect((await removed.request('/api/servicios/itv/itv-28-2801?zona=' + zona)).status).toBe(404)
  })
  it('rechaza IDs inválidos sin cargar datos y no convierte un fallo en directorio vacío', async () => {
    const a = api(), res = await a.request('/api/servicios/itv/osm-node-1?zona=521-705')
    expect(res.status).toBe(400); expect(a.fetch).not.toHaveBeenCalled()
    const broken = await api({ estaciones: [] }).request('/api/servicios/itv?zona=521-705')
    expect(broken.status).toBe(503); expect(broken.headers.get('cache-control')).toBe('no-store')
  })
  it('limita los bytes reales aunque Content-Length falte', async () => {
    const assets = { fetch: async (req: Request) => new URL(req.url).pathname.endsWith('/itv.json')
      ? new Response(' '.repeat(3 * 1024 * 1024 + 1)) : new Response(null, { status: 404 }) }
    await expect(cargaItvServicios(assets, now)).rejects.toThrow('Directorio ITV no disponible')
  })
})
