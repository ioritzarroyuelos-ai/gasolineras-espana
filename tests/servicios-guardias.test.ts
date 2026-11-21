import { afterEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import type { Env } from '../src/index'
import type { GuardiasFile } from '../src/lib/guardias'
import { guardiasFileForProvincia } from '../src/lib/guardias'
import { servicioTileId } from '../scripts/lib/servicios.mjs'
import { cargaGuardiasServicios, consultaGuardiasServicios, provinciasGuardiasEnZona, GUARDIAS_MAPA_MAX_BYTES } from '../src/lib/servicios-guardias'
import { registerServiciosGuardiasRoutes } from '../src/routes/servicios-guardias'

const now = Date.parse('2026-11-21T12:00:00Z'), checked = '2026-11-21T10:00:00Z'
const madrid = servicioTileId(40.42, -3.7)
function row(values: unknown[] = []): unknown[] { return [40.42, -3.7, 'FARMACIA DE PRUEBA · CALLE REAL, 1', 'MADRID', '912345678', '28001', '2026-11-21 09:00-2026-11-22 09:00', '', ...values] }
function file(territorio = 'madrid', rows = [row()], overrides: Partial<GuardiasFile> = {}): GuardiasFile {
  return { ts: checked, fecha: '2026-11-21', source: territorio === 'madrid' ? 'cofm.es' : 'colegio.example', territorio, count: rows.length, guardias: rows,
    guardiasVerificadas: true, coordenadasOficiales: true, ...overrides }
}
function binding(files: Record<string, GuardiasFile | Response> = {}) {
  const fetch = vi.fn(async (req: Request) => {
    const filename = new URL(req.url).pathname.split('/').pop()!
    const payload = files[filename]
    if (payload instanceof Response) return payload
    return new Response(JSON.stringify(payload || file(filename.slice(9, -5), [])))
  })
  return { fetch }
}
async function load(data = file(), zone = madrid, turno: 'todas' | 'ahora' | '24h' = 'todas', at = now) {
  return cargaGuardiasServicios(binding({ ['guardias-' + data.territorio + '.json']: data }), { zona: zone, turno, pagina: 0 }, at)
}
afterEach(() => vi.restoreAllMocks())

describe('Guardias oficiales en el mapa', () => {
  it('conserva procedencia, fecha de turno y consulta sin convertir el evento en favorito', async () => {
    const result = await load()
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ proveedor: 'guardias-oficiales', guardable: false, estado: 'activa', todoElDia: true,
      fechaTurno: '2026-11-21', consultado: checked, lat: 40.42, lon: -3.7, directorioUrl: '/farmacias/madrid/madrid', categorias: ['farmacias-guardia'] })
    expect(result.items[0].id).toMatch(/^guardia-madrid-[0-9a-f]{32}$/)
    expect(result.items[0].fuenteUrl).toBe('https://www.cofm.es/es/buscador-de-farmacias/')
  })
  it('no transforma coordenadas sin marca oficial, falsas o ausentes en puntos fiables', async () => {
    for (const flag of [undefined, false]) {
      const data = file('barcelona', [[41.4, 2.15, 'Farmacia', 'Barcelona', '', '', '00:00 - 24:00', '']], { coordenadasOficiales: flag })
      const result = await load(data, servicioTileId(41.4, 2.15))
      expect(result.items).toEqual([])
      expect(result.fuentes.find(f => f.provincia === 'barcelona')).toMatchObject({ estado: 'sin_coordenadas', consultado: checked })
    }
  })
  it('respeta la excepción nativa de Madrid ya comprobada por el lector existente', async () => {
    expect((await load(file('madrid', [row()], { coordenadasOficiales: undefined }))).items).toHaveLength(1)
    expect((await load(file('madrid', [row()], { coordenadasOficiales: undefined, source: 'otro.example' }))).items).toHaveLength(0)
  })
  it('una consulta reciente no vuelve vigente una guardia de ayer que ya terminó', async () => {
    const data = file('madrid', [[40.42, -3.7, 'Farmacia', 'Madrid', '', '', '09:00 - 23:00', '']], { fecha: '2026-11-20' })
    const result = await load(data)
    expect(result.items).toEqual([])
    expect(result.fuentes.find(f => f.provincia === 'madrid')).toMatchObject({ consultado: checked, fechaReferencia: '2026-11-20' })
    expect(result.fuentes.find(f => f.provincia === 'madrid')!.warnings.join(' ')).toContain('2026-11-20')
  })
  it('mantiene un turno nocturno de ayer sólo mientras su intervalo sigue vigente', async () => {
    const data = file('madrid', [[40.42, -3.7, 'Farmacia', 'Madrid', '', '', '2026-11-20 22:00-2026-11-21 09:00', '']], { fecha: '2026-11-20', ts: '2026-11-20T22:00:00Z' })
    expect((await load(data, madrid, 'ahora', Date.parse('2026-11-21T07:59:00Z'))).items).toHaveLength(1)
    expect((await load(data, madrid, 'ahora', Date.parse('2026-11-21T08:00:00Z'))).items).toHaveLength(0)
  })
  it('conserva avisos y enlace de una fuente caducada sin dibujar sus guardias como actuales', async () => {
    const data = file('madrid', [row()], { ts: '2026-11-19T23:00:00Z', incidencias: ['La fuente no respondió.'], avisosMunicipales: { Madrid: ['Llamar al colegio.'] } })
    const result = await load(data)
    expect(result.items).toEqual([])
    expect(result.fuentes.find(f => f.provincia === 'madrid')).toMatchObject({ estado: 'sin_actualizar', consultado: data.ts, avisosMunicipales: data.avisosMunicipales })
    expect(result.fuentes.find(f => f.provincia === 'madrid')!.warnings).toContain('La fuente no respondió.')
  })
  it('Almería con inicio y fin iguales conserva la advertencia y nunca entra en abierta o 24h', async () => {
    const data = file('almeria', [[36.84, -2.46, 'Farmacia', 'Almería', '', '', '2026-11-21 09:00-2026-11-21 09:00', 'Horario por confirmar: llama antes de acudir']])
    const zone = servicioTileId(36.84, -2.46)
    // El lector existente descarta el intervalo ISO vacío; el aviso permanece.
    expect((await load(data, zone)).items).toEqual([])
    const simple = file('almeria', [[36.84, -2.46, 'Farmacia', 'Almería', '', '', '09:00 - 09:00', 'Horario por confirmar: llama antes de acudir']])
    expect((await load(simple, zone)).items[0].estado).toBe('por_confirmar')
    expect((await load(data, zone, 'ahora')).items).toEqual([])
    expect((await load(data, zone, '24h')).items).toEqual([])
    const withoutCoords = await load({ ...data, coordenadasOficiales: false }, zone)
    expect(withoutCoords.items).toEqual([])
    expect(withoutCoords.fuentes.find(f => f.provincia === 'almeria')!.warnings.join(' ')).toContain('horario por confirmar')
  })
  it('localizada y modalidad condicional no se muestran como abiertas aunque indiquen 24 horas', async () => {
    const localized = row(); localized[7] = 'Guardia localizada: previa llamada'
    const data = file('madrid', [localized])
    expect((await load(data)).items[0]).toMatchObject({ estado: 'localizada', todoElDia: false })
    expect((await load(data, madrid, 'ahora')).items).toEqual([])
    localized[7] = 'Puede ser localizada'
    expect((await load(data)).items[0].estado).toBe('por_confirmar')
  })
  it('no mezcla la apertura normal con los turnos de guardia de Tenerife', async () => {
    const data = file('tenerife', [[28.46, -16.25, 'Farmacia', 'Santa Cruz', '', '', '00:00 - 24:00', 'Horario habitual de apertura']])
    expect((await load(data, servicioTileId(28.46, -16.25))).items).toEqual([])
  })
  it('no interpreta las urgencias observadas en Cáceres como guardia con horario confirmado', async () => {
    const data = file('caceres', [[39.47, -6.37, 'Farmacia', 'Cáceres', '', '', '00:00 - 24:00', 'En servicio de urgencias en el momento de la consulta']])
    expect((await load(data, servicioTileId(39.47, -6.37))).items[0].estado).toBe('por_confirmar')
  })
  it('calcula las horas canarias con el huso del colegio, sin sumar la hora peninsular', async () => {
    const data = file('laspalmas', [[28.12, -15.43, 'Farmacia', 'Las Palmas', '', '', '2026-11-21 13:00-2026-11-21 14:00', 'Guardia']])
    const zone = servicioTileId(28.12, -15.43)
    expect((await load(data, zone, 'ahora')).items).toEqual([])
    expect((await load(data, zone, 'ahora', now + 3600000)).items).toHaveLength(1)
  })
  it('respeta un día de 25 horas al cambiar al horario de invierno', async () => {
    const data = file('madrid', [[40.42, -3.7, 'Farmacia', 'Madrid', '', '', '2026-10-25 00:00-2026-10-26 00:00', '']], { fecha: '2026-10-25', ts: '2026-10-25T00:00:00Z' })
    expect((await load(data, madrid, '24h', Date.parse('2026-10-25T22:30:00Z'))).items).toHaveLength(1)
  })
  it('caduca antes del cambio de turno exacto sin pedir que el navegador interprete el horario', async () => {
    const guardia = row(); guardia[6] = '2026-11-21 09:00-2026-11-21 14:00'
    const data = file('madrid', [guardia]), at = Date.parse('2026-11-21T12:59:59.500Z')
    const result = await load(data, madrid, 'ahora', at)
    expect(result).toMatchObject({ evaluadoEn: '2026-11-21T12:59:59.500Z', revalidarAntes: '2026-11-21T13:00:00.000Z' })
    expect(result.items[0]).toMatchObject({ estado: 'activa', estadoHasta: result.revalidarAntes })
    expect((await load(data, madrid, 'ahora', at + 500)).items).toHaveLength(0)
  })
  it('caduca antes del siguiente minuto si alcanza primero las 30 horas de la fuente', async () => {
    const result = await load(file('madrid', [row()], { ts: '2026-11-20T06:00:00.250Z' }))
    expect(result.revalidarAntes).toBe('2026-11-21T12:00:00.250Z')
    expect(result.items[0].estadoHasta).toBe(result.revalidarAntes)
  })
  it('no corta ni simplifica horarios desconocidos para hacerlos parecer abiertos', async () => {
    const data = file('madrid', [[40.42, -3.7, 'Farmacia', 'Madrid', '', '', '09:00 - 23:00 salvo festivos y previa llamada', '']])
    const result = await load(data)
    expect(result.items[0].horario).toContain('salvo festivos')
    expect(result.items[0].estado).not.toBe('activa')
    expect((await load(data, madrid, 'ahora')).items).toHaveLength(0)
  })
  it('usa límites semiabiertos, admite hojas e ignora puntos fuera de la cuadrícula', async () => {
    const a = row(), b = row(); a[0] = 40.25; a[1] = -3.5; b[0] = 40.249; b[1] = -3.5
    expect((await load(file('madrid', [a, b]), servicioTileId(40.25, -3.5, 2))).items).toHaveLength(1)
  })
  it('el ID resiste una nueva descarga pero cambia cuando cambia el turno', async () => {
    const original = (await load()).items[0].id
    expect((await load(file('madrid', [row()], { ts: '2026-11-21T11:00:00Z' }))).items[0].id).toBe(original)
    const tomorrow = row(); tomorrow[6] = '2026-11-22 09:00-2026-11-23 09:00'
    expect((await load(file('madrid', [tomorrow], { fecha: '2026-11-22', ts: '2026-11-22T10:00:00Z' }), madrid, 'todas', now + 86400000)).items[0].id).not.toBe(original)
  })
  it('pagina de forma determinista sin guardar eventos temporales en la cuenta', async () => {
    const rows = Array.from({ length: 205 }, (_, i) => { const value = row(); value[2] = 'Farmacia ' + i; return value })
    const assets = binding({ 'guardias-madrid.json': file('madrid', rows) })
    const first = await cargaGuardiasServicios(assets, { zona: madrid, turno: 'todas', pagina: 0 }, now)
    const second = await cargaGuardiasServicios(assets, { zona: madrid, turno: 'todas', pagina: 1 }, now)
    expect(first).toMatchObject({ total: 205, truncated: true, siguientePagina: 1 }); expect(first.items).toHaveLength(200)
    expect(second).toMatchObject({ total: 205, truncated: false, siguientePagina: null }); expect(second.items).toHaveLength(5)
    expect(new Set([...first.items, ...second.items].map(i => i.id)).size).toBe(205)
    expect(first.items.every(i => i.guardable === false)).toBe(true)
  })
})

describe('Consulta acotada de fuentes y API de guardias', () => {
  it('selecciona como máximo 5 ficheros por cuadrícula en todas las zonas admitidas', () => {
    let max = 0
    for (const [south, north, west, east] of [[500, 538, 680, 738], [468, 480, 644, 668]]) {
      for (let y = south; y <= north; y++) for (let x = west; x <= east; x++) {
        const files = new Set(provinciasGuardiasEnZona(y + '-' + x).map(p => guardiasFileForProvincia(p.slug)).filter(Boolean))
        max = Math.max(max, files.size)
      }
    }
    expect(max).toBe(5)
  })
  it('comparte una lectura de Castilla-La Mancha y conserva la provincia explícita de cada fila', async () => {
    const a = row(['45']); a[2] = 'Farmacia Toledo'; a[3] = 'Toledo'; a[5] = '45001'
    const b = row(['19']); b[2] = 'Farmacia Guadalajara'; b[3] = 'Guadalajara'; b[5] = '19001'
    const assets = binding({ 'guardias-clm.json': file('clm', [a, b]) })
    const result = await cargaGuardiasServicios(assets, { zona: madrid, turno: 'todas', pagina: 0 }, now)
    expect(assets.fetch.mock.calls.map(([r]) => new URL(r.url).pathname).filter(p => p.endsWith('guardias-clm.json'))).toHaveLength(1)
    expect(result.items.map(i => i.directorioUrl).sort()).toEqual(['/farmacias/guadalajara/guadalajara', '/farmacias/toledo/toledo'])
  })
  it('cachea sólo datos originales por binding, agrupa peticiones y recalcula el turno cada vez', async () => {
    const a = binding({ 'guardias-madrid.json': file() }), query = { zona: madrid, turno: 'ahora' as const, pagina: 0 }
    const result = await Promise.all([cargaGuardiasServicios(a, query, now), cargaGuardiasServicios(a, query, now)])
    expect(result[0].items).toHaveLength(1); expect(a.fetch).toHaveBeenCalledTimes(2)
    await cargaGuardiasServicios(a, query, now + 29999); expect(a.fetch).toHaveBeenCalledTimes(2)
    await cargaGuardiasServicios(a, query, now + 30000); expect(a.fetch).toHaveBeenCalledTimes(4)
    const b = binding(); expect((await cargaGuardiasServicios(b, query, now)).items).toHaveLength(0)
  })
  it('no retiene fallos en caché ni trata una fuente incorrecta como un listado vacío válido', async () => {
    const assets = binding({ 'guardias-madrid.json': file('alava') })
    const query = { zona: madrid, turno: 'todas' as const, pagina: 0 }
    expect((await cargaGuardiasServicios(assets, query, now)).fuentes.find(f => f.provincia === 'madrid')!.estado).toBe('error')
    await cargaGuardiasServicios(assets, query, now)
    expect(assets.fetch.mock.calls.filter(([r]) => r.url.endsWith('guardias-madrid.json'))).toHaveLength(2)
  })
  it('rechaza un flujo demasiado grande aunque su cabecera prometa un tamaño pequeño', async () => {
    const assets = binding({ 'guardias-bizkaia.json': new Response('x'.repeat(GUARDIAS_MAPA_MAX_BYTES + 1), { headers: { 'Content-Length': '2' } }) })
    const result = await cargaGuardiasServicios(assets, { zona: servicioTileId(43.3, -2.8), turno: 'todas', pagina: 0 }, now)
    expect(result.errorTotal).toBe(true); expect(result.completo).toBe(false)
    expect(result.fuentes[0].fuenteUrl).toContain('cofbizkaia.eus')
  })
  it('conserva Lugo visible con enlace cuando no existe robot para su colegio', async () => {
    const result = await cargaGuardiasServicios(binding(), { zona: servicioTileId(43.01, -7.56), turno: 'todas', pagina: 0 }, now)
    expect(result.fuentes.find(f => f.provincia === 'lugo')).toMatchObject({ estado: 'sin_datos', fuenteUrl: 'https://www.coflugo.org/farmacia-guardia' })
  })
  it.each(['zona=521-705&lat=40', 'zona=521-705&lon=-3', 'zona=521-705&zona=521-705', 'zona=../../guardias', 'zona=000-000', 'zona=521-705&turno=abiertas', 'zona=521-705&pagina=-1', 'zona=521-705&pagina=01', ''])('rechaza consultas ajenas al contrato: %s', query => {
    expect(consultaGuardiasServicios(new URL('https://example.test/?' + query))).toBe(null)
  })
  it('la API responde sin caché HTTP que sobreviva a un cambio de turno y rechaza GPS preciso', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const app = new Hono<{ Bindings: Env }>(); registerServiciosGuardiasRoutes(app)
    const assets = binding({ 'guardias-madrid.json': file() })
    const response = await app.request('/api/servicios/guardias?zona=' + madrid, {}, { ASSETS: assets } as any)
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ proveedor: 'guardias-oficiales', total: 1, completo: true })
    expect((await app.request('/api/servicios/guardias?zona=' + madrid + '&lat=40.4', {}, { ASSETS: assets } as any)).status).toBe(400)
  })
  it('un fallo total responde 503 con enlaces provinciales y nunca afirma que no hay farmacias', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const app = new Hono<{ Bindings: Env }>(); registerServiciosGuardiasRoutes(app)
    const assets = binding({ 'guardias-bizkaia.json': new Response(null, { status: 404 }) })
    const response = await app.request('/api/servicios/guardias?zona=' + servicioTileId(43.3, -2.8), {}, { ASSETS: assets } as any)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ completo: false, fuentes: [{ provincia: 'bizkaia', estado: 'error', directorioUrl: '/farmacias/bizkaia' }] })
  })
})
