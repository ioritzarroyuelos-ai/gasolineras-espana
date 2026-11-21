import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
// @ts-expect-error Sólo pruebas Node, sin añadir sus tipos al Worker.
import { createHash } from 'node:crypto'
import type { Env } from '../src/index'
import { particionaFuentePublica } from '../scripts/fetch-servicios-publicos.mjs'
import { SERVICIOS_PUBLICOS_FUENTES, SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES, SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES, validaManifestPublicos, type FuentePublica, type FuentePublicaId, type ServicioPublico, type DescriptorPublico, type IndicePublicos } from '../scripts/lib/servicios-publicos.mjs'
import { consultaLugarPublico, consultaDirectorioPublico } from '../src/lib/servicios-publicos'
import { registerServiciosPublicosRoutes } from '../src/routes/servicios-publicos'
import { buildPublicosPage } from '../src/html/servicios-publicos'

const now = Date.parse('2026-11-21T12:00:00.000Z'), consulted = '2026-11-21T10:00:00.000Z', original = '2026-10-16T12:00:00.000Z'
const integrity = (raw: string) => ({ bytes: new TextEncoder().encode(raw).length, sha256: createHash('sha256').update(raw).digest('hex') as string })
function bundle(sourceId: FuentePublicaId = 'salas-estudio-madrid') {
  const definition = SERVICIOS_PUBLICOS_FUENTES.find(f => f.id === sourceId)!, refuge = sourceId === 'refugios-cataluna'
  const items: ServicioPublico[] = Array.from({ length: refuge ? 1001 : 131 }, (_, i) => ({ id: refuge ? 'refugio-cat-' + (i + 1).toString(16).padStart(64, '0') : 'estudio-madrid-' + (i + 1),
    nombre: 'Equipamiento ' + String(2000 - i), categoria: definition.categoria, lat: i === 0 ? null : refuge ? 41.4 : 40.4, lon: i === 0 ? null : refuge ? 2.1 : -3.7,
    direccion: null, municipio: refuge ? 'Barcelona' : 'Madrid', cp: null, web: null, horarioTexto: null, fechaFicha: null, accesibilidad: 'desconocido', accesibilidadTexto: null, tipo: null, aguaPotable: null, lavabos: null, climatizacion: null, descanso: null }))
  const data: FuentePublica = { schema: 1, id: definition.id, nombre: definition.nombre, consultado: consulted, fechaDatos: original, fuenteUrl: definition.fuenteUrl, datosUrl: definition.datosUrl, licenciaUrl: definition.licenciaUrl, atribucion: definition.atribucion,
    total: items.length, conCoordenadas: items.length - 1, sinCoordenadas: 1, avisos: ['El catálogo no acredita apertura ni disponibilidad.'], items }
  const { manifest, artifacts } = particionaFuentePublica(data, now), files = new Map(artifacts.map(a => [sourceId + '/' + manifest.version + '/' + a.archivo, a.raw]))
  const index: IndicePublicos = { schema: 1, consultado: consulted, fuentes: SERVICIOS_PUBLICOS_FUENTES.map(f => f.id === sourceId ? { id: f.id, nombre: f.nombre, estado: 'actual', ultimoExito: consulted, fechaDatos: original, total: items.length, ...integrity(JSON.stringify(data)), manifestBytes: 0, manifestSha256: '' }
    : { id: f.id, nombre: f.nombre, estado: 'error', ultimoExito: null, fechaDatos: null, total: 0, bytes: 0, sha256: null, manifestBytes: 0, manifestSha256: null, error: 'Sin comprobar.' }) }
  const path = (d: DescriptorPublico) => sourceId + '/' + manifest.version + '/' + d.archivo
  const save = () => { const raw = JSON.stringify(manifest), row = index.fuentes.find(f => f.id === sourceId)!; row.manifestBytes = integrity(raw).bytes; row.manifestSha256 = integrity(raw).sha256; files.set(sourceId + '/manifest.json', raw); files.set('index.json', JSON.stringify(index)) }
  const rewrite = (d: DescriptorPublico, value: unknown) => { const raw = JSON.stringify(value); Object.assign(d, integrity(raw)); files.set(path(d), raw); save() }
  const read = (d: DescriptorPublico) => JSON.parse(files.get(path(d))!) as any[]
  const ref = (id: string) => manifest.identidades!.find(d => d.desde <= id && id <= d.hasta)!
  const fetch = vi.fn(async (r: Request) => { const raw = files.get(new URL(r.url).pathname.replace('/data/servicios-publicos/', '')); return new Response(raw ?? 'Missing', { status: raw === undefined ? 404 : 200 }) })
  const assets = { fetch }, app = new Hono<{ Bindings: Env }>(); registerServiciosPublicosRoutes(app); save()
  const request = (id: string, query = '') => app.request('/api/servicios/publicos/' + sourceId + '/lugar/' + id + query, {}, { ASSETS: assets })
  return { definition, data, items, manifest, index, files, path, save, rewrite, read, ref, fetch, assets, request }
}
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now) })
afterEach(() => vi.restoreAllMocks())

describe('identidad pública acotada y compatible', () => {
  it.each(['salas-estudio-madrid', 'refugios-cataluna'] as const)('encuentra un ID de %s leyendo sólo cuatro archivos', async source => {
    const b = bundle(source), target = b.items.at(-1)!, result = await consultaLugarPublico(b.assets, source, target.id, now)
    expect(result).toMatchObject({ item: target, favoritosDisponibles: true, consultado: consulted, fechaDatos: original, desactualizado: false })
    const urls = b.fetch.mock.calls.map(([r]) => r.url)
    expect(urls).toHaveLength(4); expect(urls.filter(u => u.includes('/identidades/'))).toHaveLength(1); expect(urls.filter(u => u.includes('/listas/'))).toHaveLength(1)
    expect(urls.some(u => u.endsWith(source + '.json') || u.endsWith('busqueda.json'))).toBe(false)
    expect(b.manifest.identidades!.every(d => d.total <= 100 && d.bytes <= SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES)).toBe(true)
    expect(integrity(JSON.stringify(b.manifest)).bytes).toBeLessThan(SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES)
  })
  it('conserva listados antiguos y distingue lookup pendiente de desaparición', async () => {
    const b = bundle(); delete b.manifest.identidades; b.save()
    const result = await consultaDirectorioPublico(b.assets, b.definition.id, { zona: null, pagina: 0, q: '' }, now)
    expect(result.favoritosDisponibles).toBe(false); expect(result.items).toHaveLength(50)
    const response = await b.request(b.items[1].id)
    expect(response.status).toBe(503); expect(await response.text()).toContain('se está preparando')
    const html = buildPublicosPage({ nonce: 'test', canonical: 'https://example.test/servicios/' + b.definition.id, definition: b.definition, data: result, query: '', pagina: 0 })
    expect(html).toContain('Ver esta zona en el mapa'); expect(html).not.toContain('Ver ficha y guardar')
  })
  it('enlaza la ficha por ID y conserva fichas sin coordenadas', async () => {
    const b = bundle(), result = await consultaDirectorioPublico(b.assets, b.definition.id, { zona: null, pagina: 2, q: '' }, now)
    const html = buildPublicosPage({ nonce: 'test', canonical: 'https://example.test/servicios/' + b.definition.id, definition: b.definition, data: result, query: '', pagina: 2 })
    expect(html).toContain('Ver ficha y guardar en el mapa'); expect(html).toContain('servicio=estudio-madrid-')
    const response = await b.request(b.items[0].id)
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ item: { id: b.items[0].id, lat: null, lon: null } })
  })
  it('localiza un traslado sin coordenadas antiguas ni fechas inventadas', async () => {
    const b = bundle(), id = b.items[4].id, d = b.ref(id), [, page, position] = b.read(d).find(r => r[0] === id), rows = b.read(b.manifest.listas[page])
    rows[position].lat = 40.6; rows[position].lon = -3.6; b.rewrite(b.manifest.listas[page], rows)
    const response = await b.request(id)
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ consultado: consulted, fechaDatos: original, item: { id, lat: 40.6, lon: -3.6 } })
    expect(b.fetch.mock.calls.every(([r]) => !new URL(r.url).search)).toBe(true)
  })
  it('distingue ID ausente y conserva aviso de copia antigua', async () => {
    const b = bundle(); expect((await b.request('estudio-madrid-99999')).status).toBe(404)
    const old = await consultaLugarPublico(b.assets, b.definition.id, b.items[1].id, now + 32 * 3600000)
    expect(old).toMatchObject({ desactualizado: true, consultado: consulted, fechaDatos: original }); expect(old.avisos.join(' ')).toContain('copia comprobada')
  })
  it.each(['?lat=40.4&lon=-3.7', '?zona=521-705', '?url=https://otro.test'])('rechaza parámetros antes de leer: %s', async query => {
    const b = bundle(); expect((await b.request(b.items[1].id, query)).status).toBe(400); expect(b.fetch).not.toHaveBeenCalled()
  })
  it.each(['osm-node-123', 'refugio-cat-' + 'a'.repeat(64), 'estudio-madrid-001', 'estudio-madrid-x'])('rechaza namespace inválido: %s', async id => {
    const b = bundle(); expect((await b.request(id)).status).toBe(400); expect(b.fetch).not.toHaveBeenCalled()
  })
  it.each(['hash', 'missing', 'duplicate-id', 'duplicate-position', 'page', 'position', 'identity', 'wrong-first', 'wrong-last'])('un daño no parece desaparición: %s', async mode => {
    const b = bundle(), id = b.items[5].id, d = b.ref(id), rows = b.read(d)
    if (mode === 'hash') b.files.set(b.path(d), '[]')
    else if (mode === 'missing') b.files.delete(b.path(d))
    else {
      const target = rows.find(r => r[0] === id)!
      if (mode === 'duplicate-id') rows[1][0] = rows[0][0]
      if (mode === 'duplicate-position') { rows[1][1] = rows[0][1]; rows[1][2] = rows[0][2] }
      if (mode === 'page') target[1] = b.manifest.listas.length
      if (mode === 'position') target[2] = b.manifest.listas[target[1]].total
      if (mode === 'identity') { const page = b.read(b.manifest.listas[target[1]]); page[target[2]].id = 'estudio-madrid-888888'; b.rewrite(b.manifest.listas[target[1]], page) }
      if (mode === 'wrong-first') d.desde = 'estudio-madrid-0'
      if (mode === 'wrong-last') d.hasta = 'estudio-madrid-999999'
      b.rewrite(d, rows)
    }
    expect((await b.request(id)).status).toBe(503)
  })
  it('rechaza rangos solapados, recuentos imposibles y rutas fuera de partición', () => {
    const b = bundle()
    for (const mutate of [(d: any) => d.identidades[1].desde = d.identidades[0].hasta, (d: any) => d.identidades[0].total--, (d: any) => d.identidades[0].archivo = '../otro.json', (d: any) => d.identidades.pop()]) {
      const manifest = structuredClone(b.manifest); mutate(manifest); expect(() => validaManifestPublicos(manifest, now)).toThrow()
    }
  })
  it('reintentar conserva versión y fechas originales; cambiar una ficha renueva la versión', () => {
    const b = bundle(), next = particionaFuentePublica({ ...b.data, consultado: '2026-11-21T11:00:00.000Z' }, now)
    expect(next.manifest.version).toBe(b.manifest.version); expect(next.manifest.fechaDatos).toBe(original)
    const rows = b.items.map(p => ({ ...p })); rows[1].lat = 40.5
    expect(particionaFuentePublica({ ...b.data, items: rows }, now).manifest.version).not.toBe(b.manifest.version)
  })
  it('cada referencia de todas las particiones enlaza una única ficha del listado completo', () => {
    const b = bundle('refugios-cataluna'), seen = new Set<string>(), positions = new Set<string>()
    for (const descriptor of b.manifest.identidades!) for (const [id, page, position] of b.read(descriptor)) {
      expect(seen.has(id)).toBe(false); seen.add(id)
      const key = page + ':' + position; expect(positions.has(key)).toBe(false); positions.add(key)
      expect(b.read(b.manifest.listas[page])[position].id).toBe(id)
    }
    expect([...seen].sort()).toEqual(b.items.map(p => p.id).sort())
  })
})
