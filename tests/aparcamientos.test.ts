import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import { APARCAMIENTOS_FUENTES, normalizaDetalleMadrid, normalizaParkingMadrid, normalizaParkingVigo, parkingHoraVigo, parkingTimestamp, validaCatalogoParking } from '../src/lib/aparcamientos-datos'
import { cargaAparcamientos, descargaParking, parkingSoapBody } from '../src/lib/aparcamientos'
import { registerAparcamientosRoutes } from '../src/routes/aparcamientos'
import { PARKING_NOW as now, parkingStamp as stamp, madridList, madridRow, madridDetail, vigoRow, parkingCatalogue, parkingAssets } from './aparcamientos-fixtures'
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('Aparcamientos: fechas, cifras y catálogo oficial', () => {
  it('conserva cero plazas libres sin convertir capacidad o PMR en disponibilidad', () => {
    expect(normalizaParkingMadrid(madridList(), now)[0]).toMatchObject({ id: 'parking-madrid-72', plazasLibres: 0, estado: 'actual', capacidad: null, plazasPmr: null, gratis: null, disuasorio: null, caduca: stamp(-240) })
    expect(normalizaParkingVigo(JSON.stringify([vigoRow()]), now)[0]).toMatchObject({ id: 'parking-vigo-4763', plazasLibres: 0, capacidad: 388, estado: 'actual', caduca: stamp(-300), plazasPmr: null })
  })
  it('caduca cada fila, aunque la respuesta HTTP sea reciente', () => {
    expect(normalizaParkingMadrid(madridList(madridRow(72, '6', stamp(300)) + madridRow(73, '8', stamp(60))), now).map(v => [v.estado, v.plazasLibres])).toEqual([['caducado', null], ['actual', 8]])
    const row = { ...vigoRow(), fechahora: '2026-11-21 12:54:00' }
    expect(normalizaParkingVigo(JSON.stringify([row]), now)[0]).toMatchObject({ estado: 'caducado', plazasLibres: null, fechaOcupacion: stamp(360) })
  })
  it('no inventa cifras cuando el total o la fecha no permiten confirmarlas', () => {
    expect(normalizaParkingMadrid(madridList(madridRow(72, null)), now)[0]).toMatchObject({ estado: 'sin_confirmar', plazasLibres: null, fechaOcupacion: null })
    expect(normalizaParkingMadrid(madridList(madridRow(72, '6', stamp(-1))), now)[0]).toMatchObject({ estado: 'sin_confirmar', plazasLibres: null, caduca: null })
  })
  it.each([-1, true, null, '', '2', 1.5, 389, 100001])('no acepta plazas libres inválidas de Vigo: %s', free => {
    expect(normalizaParkingVigo(JSON.stringify([{ ...vigoRow(), plazaslibres: free }]), now)[0].plazasLibres).toBeNull()
  })
  it.each(['-1', 'true', '1.5', '100001', ''])('no acepta plazas libres inválidas de Madrid: %s', free => {
    expect(normalizaParkingMadrid(madridList(madridRow(72, free)), now)[0].plazasLibres).toBeNull()
  })
  it.each(['2026-02-31T10:00:00Z', '2026-11-21T24:00:00Z', '2026-11-21T12:00:00+01:70', '2026-11-21T12:00:00+15:00', '2026-11-21'])('rechaza fecha imposible o sin zona: %s', value => expect(parkingTimestamp(value)).toBeNull())
  it('resuelve Madrid sin aceptar las horas ambiguas o inexistentes de cambio de hora', () => {
    expect(parkingHoraVigo('2026-11-21 13:00:00')).toBe(now)
    expect(parkingHoraVigo('2026-07-21 13:00:00')).toBe(Date.parse('2026-07-21T11:00:00Z'))
    expect(parkingHoraVigo('2026-10-25 02:30:00')).toBeNull()
    expect(parkingHoraVigo('2026-03-29 02:30:00')).toBeNull()
  })
  it('mantiene el lugar sin corregir coordenadas intercambiadas ni direcciones corruptas', () => {
    const data = normalizaParkingMadrid(madridList().replace('40.4092538', '-3.6').replace('-3.6941255', '40.4').replace('Calle del Museo', 'Calle \ufffd'), now)[0]
    expect(data).toMatchObject({ lat: null, lon: null, direccion: null, nombre: 'Parking 72' })
  })
  it('deduplica PMR idénticas sin sumarlas, conserva horario literal y no interpreta accesos invertidos', () => {
    expect(normalizaDetalleMadrid(madridDetail(), '72')).toEqual({ capacidad: 132, plazasPmr: 3, horarioTexto: '[24 Horas][Lunes,Domingo][00:00][23:59]' })
    expect(normalizaDetalleMadrid(madridDetail().replace('<ns2:content>3</ns2:content>', '<ns2:content>4</ns2:content>'), '72').plazasPmr).toBeNull()
    expect(normalizaDetalleMadrid(madridDetail(72, 'SI'), '72').plazasPmr).toBeNull()
    expect(() => normalizaDetalleMadrid(madridDetail(), '73')).toThrow()
  })
  it.each(['duplicado', 'doctype', 'namespace', 'codigo', 'vacio'])('rechaza Madrid con %s', kind => {
    let raw = madridList()
    if (kind === 'duplicado') raw = madridList(madridRow() + madridRow())
    if (kind === 'doctype') raw = '<!DOCTYPE a SYSTEM "https://example.invalid/">' + raw
    if (kind === 'namespace') raw = raw.replace('http://tempuri.org/', 'https://example.invalid/')
    if (kind === 'codigo') raw = raw.replace('<ns2:code>0</ns2:code>', '<ns2:code>1</ns2:code>')
    if (kind === 'vacio') raw = madridList('')
    expect(() => normalizaParkingMadrid(raw, now)).toThrow()
  })
  it('rechaza Vigo duplicado y catálogos que afirmen gratuidad o fechas originales inventadas', () => {
    expect(() => normalizaParkingVigo(JSON.stringify([vigoRow(), vigoRow()]), now)).toThrow()
    const data: any = parkingCatalogue('madrid')
    expect(validaCatalogoParking(data, 'madrid', now)).toEqual(data)
    data.items[0].gratis = true; expect(() => validaCatalogoParking(data, 'madrid', now)).toThrow()
    data.items[0].gratis = null; data.fechaDatos = stamp(); expect(() => validaCatalogoParking(data, 'madrid', now)).toThrow()
  })
})
describe('Aparcamientos: red y respaldo limitado', () => {
  it('usa sólo dos URLs fijas, SOAP de lectura y redirect manual', async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(madridList()))
    await descargaParking('madrid', { fetch: fetcher, now })
    expect(fetcher.mock.calls[0][0]).toBe(APARCAMIENTOS_FUENTES.madrid.datosUrl)
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST', redirect: 'manual', body: parkingSoapBody(undefined, now) })
    expect(String(fetcher.mock.calls[0][1]?.body)).not.toMatch(/latitude|longitude/)
    expect(() => parkingSoapBody('<evil/>')).toThrow()
  })
  it.each(['redirect', 'header', 'stream', 'html', 'timeout', 'body-timeout'])('limita %s sin reutilizar cifras antiguas', async kind => {
    const fetcher = vi.fn(async () => {
      if (kind === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://example.invalid/' } })
      if (kind === 'header') return new Response('[]', { headers: { 'Content-Length': '99999999' } })
      if (kind === 'stream') return new Response(new Uint8Array(131073))
      if (kind === 'html') return new Response('<html>Error</html>')
      if (kind === 'body-timeout') return new Response(new ReadableStream({ pull() { return new Promise(() => {}) } }))
      return new Promise<Response>(() => {})
    })
    const assets = await parkingAssets(parkingCatalogue('vigo'))
    const result = await cargaAparcamientos('vigo', assets, { fetch: fetcher, now, timeoutMs: 30 })
    expect(result.items[0]).toMatchObject({ estado: 'sin_confirmar', plazasLibres: null, caduca: null, capacidad: 132 })
    expect(result.consultado).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('une sólo detalles verificados, y el hash no permite un catálogo mezclado', async () => {
    const assets = await parkingAssets(parkingCatalogue('madrid')), fetcher = vi.fn(async () => new Response(madridList()))
    const data = await cargaAparcamientos('madrid', assets, { fetch: fetcher, now })
    expect(data.items[0]).toMatchObject({ plazasLibres: 0, capacidad: 132, plazasPmr: 3, fechaFicha: null })
    const altered = await parkingAssets(parkingCatalogue('madrid')); Object.assign(altered.index.fuentes[0], { sha256: '0'.repeat(64) })
    const rejected = await cargaAparcamientos('madrid', altered, { fetch: fetcher, now })
    expect(rejected.items[0].plazasPmr).toBeNull(); expect(rejected.catalogoConsultado).toBeNull()
  })
  it('no presenta como libres cifras superiores a la capacidad verificada', async () => {
    const assets = await parkingAssets(parkingCatalogue('madrid'))
    const result = await cargaAparcamientos('madrid', assets, { fetch: async () => new Response(madridList(madridRow(72, '200'))), now })
    expect(result.items[0]).toMatchObject({ plazasLibres: null, capacidad: 132, estado: 'sin_confirmar' })
  })
  it('un lugar omitido en un parte sigue en el catálogo sin una cifra inventada', async () => {
    const saved = parkingCatalogue('vigo'); saved.items.push({ ...saved.items[0], id: 'parking-vigo-4764', nombre: 'Otro aparcamiento' }); saved.total = 2
    const assets = await parkingAssets(saved)
    const result = await cargaAparcamientos('vigo', assets, { fetch: async () => Response.json([vigoRow()]), now })
    expect(result.total).toBe(2); expect(result.conDisponibilidad).toBe(1)
    expect(result.items[1]).toMatchObject({ id: 'parking-vigo-4764', estado: 'sin_confirmar', plazasLibres: null, fechaOcupacion: null, capacidad: 132 })
  })
  it('revalida la caducidad de filas en la caché y no rejuvenece consultado', async () => {
    const fetcher = vi.fn(async () => new Response('[]'))
    const cache = { match: async () => new Response(JSON.stringify([{ ...vigoRow(), fechahora: '2026-11-21 12:54:00' }]), { headers: { 'X-EU-Consultado': stamp(30) } }), put: vi.fn() }
    const result = await cargaAparcamientos('vigo', undefined, { cache, fetch: fetcher, now })
    expect(result.consultado).toBe(stamp(30)); expect(result.evaluadoEn).toBe(stamp())
    expect(result.items[0].estado).toBe('caducado'); expect(fetcher).not.toHaveBeenCalled()
  })
  it('coalesce consultas simultáneas a la misma ciudad', async () => {
    const fetcher = vi.fn(async () => { await new Promise(resolve => setTimeout(resolve, 10)); return new Response(JSON.stringify([vigoRow()])) })
    await Promise.all([cargaAparcamientos('vigo', undefined, { fetch: fetcher, now }), cargaAparcamientos('vigo', undefined, { fetch: fetcher, now })])
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('API no acepta GPS, no almacena una respuesta HTTP y devuelve fuente si falla', async () => {
    const app = new Hono<{ Bindings: Env }>(); registerAparcamientosRoutes(app)
    const fetcher = vi.fn(async () => new Response('error', { status: 503 })); vi.stubGlobal('fetch', fetcher)
    expect((await app.request('/api/aparcamientos/vigo?lat=42')).status).toBe(400)
    expect((await app.request('/api/aparcamientos/inventada')).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
    const response = await app.request('/api/aparcamientos/vigo')
    expect(response.status).toBe(503); expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ fuenteUrl: APARCAMIENTOS_FUENTES.vigo.fuenteUrl })
  })
})
