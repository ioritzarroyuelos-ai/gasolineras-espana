import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Los módulos Node se usan sólo en pruebas del robot.
import { mkdtemp, readFile, rm, writeFile, readdir } from 'node:fs/promises'
// @ts-expect-error Los módulos Node se usan sólo en pruebas del robot.
import { resolve, sep } from 'node:path'
// @ts-expect-error Los módulos Node se usan sólo en pruebas del robot.
import { tmpdir } from 'node:os'
import { normalizaRefugios, normalizaSalasMadrid, leeJsonPublico, validaFuentePublica, validaServicioPublico, validaIndicePublicos, validaManifestPublicos, validaBusquedaPublicos, normalizaBusquedaPublica, SERVICIOS_PUBLICOS_FUENTES, SERVICIOS_PUBLICOS_MAX_SHARD_BYTES, type FuentePublica } from '../scripts/lib/servicios-publicos.mjs'
import { actualizaServiciosPublicos, descargaRefugios, descargaSalasMadrid, compruebaContinuidadPublica, particionaFuentePublica } from '../scripts/fetch-servicios-publicos.mjs'

const now = Date.parse('2026-11-21T12:00:00Z'), updated = '2026-11-20T12:00:00.000Z'
const refs = (n = 1000) => Array.from({ length: n }, (_, i) => ({ ':id': 'row-' + i, nom: 'Refugi ' + i, indicador_refugi: '080018|REFUGI_' + i, codi_municipi: '080018', municipi: 'Abrera', latitud: '41.51957423', longitud: '1.90278811', adreca: 'Plaça del poble', accessibilitat: 'Sí', aigua: 'Sí', lavabo: 'No', ultima_actualitzacio: '2026-05-14T13:40:00.000' }))
const salas = (n = 30) => ({ '@graph': Array.from({ length: n }, (_, i) => ({ id: String(i + 1), title: 'Sala ' + i, relation: 'http://www.madrid.es/sites/v/index.jsp?vgnextoid=' + i, address: { locality: 'MADRID', 'street-address': 'CALLE EJEMPLO ' + i, 'postal-code': '28033' }, location: { latitude: 40.47777, longitude: -3.6583 }, organization: { accesibility: '1', schedule: 'De lunes a domingo de 9 a 21. Cerrado el 1 de enero.', services: 'Aforo: 60 plazas' } })) })
function fetcher(options: { rows?: any[]; salas?: any; changedMeta?: boolean; short?: boolean; failCat?: boolean; failMadrid?: boolean; last?: string; changedHead?: boolean } = {}) {
  let metadata = 0, heads = 0
  const rows = options.rows || refs(1001), payload = JSON.stringify(options.salas || salas()), last = options.last || updated
  return vi.fn(async (url: any, init: any = {}) => {
    const u = new URL(String(url))
    if (u.hostname === 'analisi.transparenciacatalunya.cat') {
      if (options.failCat) throw Error('private diagnostic must never be published')
      if (u.pathname.includes('/api/views/')) return Response.json({ id: '9gu7-iwci', rowsUpdatedAt: Date.parse(updated) / 1000 + (options.changedMeta && metadata++ ? 1 : 0), viewLastModified: Date.parse(updated) / 1000, licenseId: 'SEE_TERMS_OF_USE', columns: ['nom', 'indicador_refugi', 'municipi', 'codi_municipi', 'latitud', 'longitud', 'ultima_actualitzacio'].map(fieldName => ({ fieldName, dataTypeName: 'text' })) })
      if (u.searchParams.get('$select') === 'count(*)') return Response.json([{ count: String(rows.length) }])
      const offset = Number(u.searchParams.get('$offset')), size = Number(u.searchParams.get('$limit'))
      return Response.json(rows.slice(offset, offset + size - (options.short ? 1 : 0)))
    }
    if (options.failMadrid) return new Response('No disponible', { status: 503 })
    const secondHead = init.method === 'HEAD' && heads++ > 0
    const headers = { 'content-length': String(new TextEncoder().encode(payload).length), 'last-modified': new Date(Date.parse(last) + (options.changedHead && secondHead ? 1000 : 0)).toUTCString(), etag: '"example-version"' }
    return new Response(init.method === 'HEAD' ? null : payload, { headers })
  }) as ReturnType<typeof vi.fn> & typeof fetch
}
let refSnapshot: FuentePublica, madridSnapshot: FuentePublica
beforeAll(async () => { refSnapshot = await normalizaRefugios(refs(), updated, now); madridSnapshot = normalizaSalasMadrid(salas(), updated, now) })
const temporary: string[] = []
afterEach(async () => {
  for (const dir of temporary.splice(0)) {
    const target = resolve(dir), parent = resolve(tmpdir()) + sep
    if (!target.startsWith(parent) || !target.slice(parent.length).startsWith('servicios-publicos-')) throw Error('Ruta temporal inesperada')
    await rm(target, { recursive: true, force: true })
  }
})

describe('contrato fiel a las fuentes oficiales', () => {
  it('mantiene el identificador oficial estable aunque cambie el nombre visible', async () => {
    const data = refs(); data[0].nom = 'Nombre actualizado'
    const result = await normalizaRefugios(data, updated, now)
    expect(result.items.find(x => x.nombre === 'Nombre actualizado')!.id).toBe(refSnapshot.items.find(x => x.nombre === 'Refugi 0')!.id)
    expect(result.fechaDatos).toBe(updated); expect(result.consultado).toBe(new Date(now).toISOString())
    expect(result.items[0].fechaFicha).toBe('2026-05-14T13:40:00.000')
  })
  it('no corrige decimales de coordenadas ni coloca fichas en el centro municipal', async () => {
    const rows = refs(); rows[0].latitud = '41521503'; rows[0].longitud = '1901389'
    const data = await normalizaRefugios(rows, updated, now), point = data.items.find(x => x.nombre === 'Refugi 0')!
    expect(data.total).toBe(1000); expect(data.sinCoordenadas).toBe(1)
    expect(point.lat).toBeNull(); expect(point.lon).toBeNull(); expect(point.municipio).toBe('Abrera')
  })
  it('conserva identificadores oficiales AMB y códigos sin ceros iniciales sin reconstruirlos', async () => {
    const rows = refs(); rows[0].codi_municipi = 'Parc AMB'; rows[0].indicador_refugi = 'Parc AMB|EQUIPAMENT'
    rows[1].codi_municipi = '8180'; rows[1].indicador_refugi = '8180|EQUIPAMENT'
    expect((await normalizaRefugios(rows, updated, now)).total).toBe(1000)
    rows[1].codi_municipi = '08180'
    await expect(normalizaRefugios(rows, updated, now)).rejects.toThrow()
  })
  it('no traduce excepciones de accesibilidad o agua a un sí simple', async () => {
    const rows = refs(); rows[0].accessibilitat = 'Sí (excepte lavabos)'; rows[0].aigua = 'sense dades'
    const data = await normalizaRefugios(rows, updated, now), point = data.items.find(x => x.nombre === 'Refugi 0')!
    expect(point.accesibilidad).toBe('desconocido'); expect(point.accesibilidadTexto).toBe('Sí (excepte lavabos)'); expect(point.aguaPotable).toBeNull()
    expect(data.items.find(x => x.nombre === 'Refugi 1')?.aguaPotable).toBe(true)
    expect(data.items.some(x => 'abierto' in x || 'activado' in x)).toBe(false)
  })
  it('deduplica sólo la misma identidad y ficha; un conflicto se rechaza', async () => {
    const rows = refs(); rows.push({ ...rows[0] })
    expect((await normalizaRefugios(rows, updated, now)).total).toBe(1000)
    rows[1000].nom = 'Otra información incompatible'
    await expect(normalizaRefugios(rows, updated, now)).rejects.toThrow()
  })
  it('conserva fichas del mismo parque en dos municipios sin elegir ni perder una', async () => {
    const rows = refs(); rows.push({ ...rows[0], municipi: 'Otro municipio publicado' })
    const data = await normalizaRefugios(rows, updated, now)
    expect(data.total).toBe(1001)
    expect(data.items.filter(p => p.nombre === 'Refugi 0')).toHaveLength(2)
    expect(new Set(data.items.filter(p => p.nombre === 'Refugi 0').map(p => p.id)).size).toBe(2)
  })
  it('rechaza fecha de ficha futura sin convertirla en fecha UTC de descarga', async () => {
    const rows = refs(); rows[0].ultima_actualitzacio = '2027-01-01T12:00:00.000'
    await expect(normalizaRefugios(rows, updated, now)).rejects.toThrow()
  })
  it.each([['0', 'no'], ['1', 'si'], ['2', 'limitado'], ['3', 'desconocido'], ['1,4,5', 'si'], ['4,5', 'desconocido'], ['0,1', 'desconocido'], ['99', 'desconocido']])('interpreta accesibilidad Madrid %s según el PDF oficial', (code, expected) => {
    const data = salas(); data['@graph'][0].organization.accesibility = code
    expect(normalizaSalasMadrid(data, updated, now).items.find(x => x.id === 'estudio-madrid-1')?.accesibilidad).toBe(expected)
  })
  it('conserva excepciones de horario y no publica aforo como plazas libres', () => {
    const point = madridSnapshot.items[0]
    expect(point.horarioTexto).toContain('Cerrado el 1 de enero.')
    expect(point.fechaFicha).toBeNull(); expect(point.web).toMatch(/^http:\/\/www\.madrid\.es\//)
    expect('plazasLibres' in point).toBe(false); expect('aforo' in point).toBe(false)
    const data = salas(); data['@graph'][0].organization.schedule = 'X'.repeat(10001)
    expect(() => normalizaSalasMadrid(data, updated, now)).toThrow()
  })
  it('conserva la sala sin coordenadas y omite enlaces con datos privados', () => {
    const data = salas(); data['@graph'][0].location.latitude = 0
    data['@graph'][0].relation = 'https://www.madrid.es/?session=example'
    const item = normalizaSalasMadrid(data, updated, now).items.find(x => x.id === 'estudio-madrid-1')!
    expect(item.lat).toBeNull(); expect(item.lon).toBeNull(); expect(item.web).toBeNull()
  })
  it('rechaza snapshots con categorías, ubicación, contadores o campos inventados', () => {
    for (const mutate of [(d: any) => d.items[0].categoria = 'farmacias-guardia', (d: any) => d.items[0].lat = 0, (d: any) => d.total++, (d: any) => d.items[0].abierto = true, (d: any) => d.items[0].web = 'https://example.com/?token=example']) {
      const data = structuredClone(madridSnapshot); mutate(data)
      expect(() => validaFuentePublica(data, now)).toThrow()
    }
  })
  it('ninguna fecha de origen futura se admite como válida ni con unos segundos de tolerancia', () => {
    expect(() => validaFuentePublica({ ...madridSnapshot, fechaDatos: new Date(now + 1000).toISOString() }, now)).toThrow()
    expect(() => validaFuentePublica({ ...madridSnapshot, fechaDatos: new Date(now + 1000).toISOString(), consultado: new Date(now + 2000).toISOString() }, now)).toThrow()
  })
  it('el validador individual rechaza la ficha inválida y la identidad de otra fuente', () => {
    const data = structuredClone(madridSnapshot); data.items[0].web = 'https://example.com/?token=example'
    expect(() => validaServicioPublico(data.items[0], data.id, now)).toThrow()
    expect(() => validaFuentePublica(data, now)).toThrow()
    expect(() => validaServicioPublico(data.items[1], 'refugios-cataluna', now)).toThrow()
    data.conCoordenadas = 100
    expect(() => validaFuentePublica(data, now)).toThrow()
  })
  it('escapa sólo controles dentro de cadenas del JSON, sin reparar números o estructuras', () => {
    expect(leeJsonPublico('{"horario":"9 a 20\nExcepto festivos"}')).toEqual({ horario: '9 a 20\nExcepto festivos' })
    expect(() => leeJsonPublico('{"lat":41521503,}')).toThrow()
    expect(() => leeJsonPublico('{"horario":"abc\\\n"}')).toThrow()
    expect(leeJsonPublico('{"text":"\\\"ok\\\""}')).toEqual({ text: '"ok"' })
  })
})

describe('descarga completa y consistente', () => {
  it('pagina el catálogo completo y comprueba metadatos y recuento antes/después', async () => {
    const fetch = fetcher(), data = await descargaRefugios({ fetch, now })
    expect(data.total).toBe(1001)
    const pages = fetch.mock.calls.map(([u]: any[]) => new URL(u)).filter((u: URL) => u.searchParams.has('$offset'))
    expect(pages.map((u: URL) => u.searchParams.get('$offset'))).toEqual(['0', '1000'])
    expect(pages.every((u: URL) => u.searchParams.get('$order') === ':id' && u.searchParams.get('$select')?.startsWith(':id,'))).toBe(true)
    expect(fetch.mock.calls.every(([, init]: any[]) => init.redirect === 'error' && init.signal && !('cookie' in init.headers))).toBe(true)
  })
  it.each([{ short: true }, { changedMeta: true }])('rechaza una página incompleta o catálogo modificado durante la descarga', async options => {
    await expect(descargaRefugios({ fetch: fetcher(options), now })).rejects.toThrow()
  })
  it('rechaza una fila repetida al cruzar la página aunque count y metadatos no cambien', async () => {
    const rows = refs(1001); rows[1000] = { ...rows[999] }
    await expect(descargaRefugios({ fetch: fetcher({ rows }), now })).rejects.toThrow()
  })
  it('rechaza sobrecobertura sin iniciar descargas de páginas', async () => {
    const fetch = fetcher({ rows: Array(20001).fill(refs(1)[0]) })
    await expect(descargaRefugios({ fetch, now })).rejects.toThrow()
    expect(fetch.mock.calls).toHaveLength(2)
  })
  it('comprueba HEAD/GET/HEAD Madrid sin inventar fecha por consulta', async () => {
    const fetch = fetcher(), data = await descargaSalasMadrid({ fetch, now })
    expect(data.total).toBe(30); expect(data.fechaDatos).toBe(updated)
    expect(fetch.mock.calls.map(([, init]: any[]) => init.method)).toEqual(['HEAD', 'GET', 'HEAD'])
    await expect(descargaSalasMadrid({ fetch: fetcher({ changedHead: true }), now })).rejects.toThrow()
  })
  it('distingue bytes comprimidos de HEAD/GET usando ETag fuerte sin relajar el límite descomprimido', async () => {
    const base = fetcher()
    const compressed = vi.fn(async (u: any, init: any) => {
      const r = await base(u, init)
      r.headers.set('content-encoding', 'gzip'); r.headers.set('content-length', init.method === 'HEAD' ? '20' : '14879')
      return r
    }) as typeof fetch
    expect((await descargaSalasMadrid({ fetch: compressed, now })).total).toBe(30)
    const weak = vi.fn(async (u: any, init: any) => { const r = await compressed(u, init); r.headers.set('etag', 'W/"example"'); return r }) as typeof fetch
    await expect(descargaSalasMadrid({ fetch: weak, now })).rejects.toThrow()
  })
  it('corta cuerpos excesivos incluso sin Content-Length', async () => {
    const fetch = vi.fn(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(1024 * 1024 + 1)); c.close() } })))
    await expect(descargaRefugios({ fetch, now })).rejects.toThrow()
  })
  it('no publica pérdidas grandes de fichas o coordenadas ni retrocesos de fecha', () => {
    expect(() => compruebaContinuidadPublica(madridSnapshot, { ...madridSnapshot, total: 10 })).toThrow()
    expect(() => compruebaContinuidadPublica(madridSnapshot, { ...madridSnapshot, conCoordenadas: 1 })).toThrow()
    expect(() => compruebaContinuidadPublica(madridSnapshot, { ...madridSnapshot, fechaDatos: '2025-01-01T00:00:00.000Z' })).toThrow()
    expect(() => compruebaContinuidadPublica(madridSnapshot, { ...madridSnapshot, conCoordenadas: 25 })).not.toThrow()
  })
})

describe('publicación atómica independiente e índice de estado', () => {
  it('una fuente caída conserva su fichero y último éxito; la otra avanza y se marca el fallo', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'servicios-publicos-')); temporary.push(dir)
    const first = await actualizaServiciosPublicos({ dir, fetch: fetcher(), now })
    expect(first.failed).toBe(false)
    const file = resolve(dir, 'refugios-cataluna.json'), saved = await readFile(file, 'utf8')
    const manifestFile = resolve(dir, 'refugios-cataluna/manifest.json'), manifestSaved = await readFile(manifestFile, 'utf8')
    const second = await actualizaServiciosPublicos({ dir, fetch: fetcher({ failCat: true, last: '2026-11-21T12:00:00.000Z' }), now: now + 86400000 })
    expect(second.failed).toBe(true)
    expect(await readFile(file, 'utf8')).toBe(saved)
    expect(await readFile(manifestFile, 'utf8')).toBe(manifestSaved)
    expect(second.index.fuentes[0].manifestSha256).toBe(first.index.fuentes[0].manifestSha256)
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(saved))), x => x.toString(16).padStart(2, '0')).join('')
    expect(second.index.fuentes[0]).toMatchObject({ bytes: new TextEncoder().encode(saved).length, sha256: digest })
    expect(second.index.fuentes[0]).toMatchObject({ estado: 'conservada', ultimoExito: first.index.fuentes[0].ultimoExito, fechaDatos: first.index.fuentes[0].fechaDatos })
    expect(second.index.fuentes[1]).toMatchObject({ estado: 'actual', ultimoExito: new Date(now + 86400000).toISOString(), fechaDatos: '2026-11-21T12:00:00.000Z' })
    expect(JSON.stringify(second.index)).not.toContain('private diagnostic')
    expect(validaIndicePublicos(JSON.parse(await readFile(resolve(dir, 'index.json'), 'utf8')), now + 86400000)).toEqual(second.index)
  })
  it('cambiar fichas crea versión nueva; el robot limpia sólo versiones SHA antiguas tras escribir el índice', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'servicios-publicos-')); temporary.push(dir)
    await actualizaServiciosPublicos({ dir, fetch: fetcher(), now })
    const sourceDir = resolve(dir, 'refugios-cataluna'), old = JSON.parse(await readFile(resolve(sourceDir, 'manifest.json'), 'utf8'))
    await writeFile(resolve(sourceDir, 'conservar.txt'), 'archivo ajeno a las versiones')
    const rows = refs(1001); rows[0].nom = 'Nombre oficialmente corregido'
    const update = await actualizaServiciosPublicos({ dir, fetch: fetcher({ rows }), now: now + 86400000 })
    const current = JSON.parse(await readFile(resolve(sourceDir, 'manifest.json'), 'utf8')), entries = await readdir(sourceDir)
    expect(update.failed).toBe(false); expect(current.version).not.toBe(old.version)
    expect(entries).not.toContain(old.version); expect(entries).toContain(current.version); expect(entries).toContain('conservar.txt')
  })
  it('sin copia previa registra error por fuente y no finge una descarga correcta', async () => {
    const dir = await mkdtemp(resolve(tmpdir(), 'servicios-publicos-')); temporary.push(dir)
    const result = await actualizaServiciosPublicos({ dir, fetch: fetcher({ failCat: true, failMadrid: true }), now })
    expect(result.failed).toBe(true)
    for (const row of result.index.fuentes) expect(row).toMatchObject({ estado: 'error', ultimoExito: null, fechaDatos: null, total: 0, bytes: 0, sha256: null })
    expect(result.index.fuentes.map(x => x.id)).toEqual(SERVICIOS_PUBLICOS_FUENTES.map(x => x.id))
    const bad = structuredClone(result.index); bad.fuentes[0].ultimoExito = new Date(now).toISOString()
    expect(() => validaIndicePublicos(bad, now)).toThrow()
  })
})

describe('partición offline para lectura acotada en Workers', () => {
  it('conserva todas las fichas en listas y búsqueda y sólo las ubicadas en el mapa', () => {
    const source = structuredClone(refSnapshot); source.items[0].lat = null; source.items[0].lon = null; source.conCoordenadas--; source.sinCoordenadas++
    const { manifest, artifacts } = particionaFuentePublica(source, now), raw = new Map(artifacts.map(x => [x.archivo, x.raw]))
    expect(validaManifestPublicos(manifest, now)).toBe(manifest)
    const listRows = manifest.listas.flatMap(d => JSON.parse(raw.get(d.archivo)!)), mapRows = Object.values(manifest.mapa).flatMap(pages => pages.flatMap(d => JSON.parse(raw.get(d.archivo)!)))
    expect(new Set(listRows.map(p => p.id))).toEqual(new Set(source.items.map(p => p.id)))
    expect(mapRows).toHaveLength(999); expect(mapRows.every(p => p.lat !== null && p.lon !== null)).toBe(true)
    const search = validaBusquedaPublicos(JSON.parse(raw.get(manifest.busqueda.archivo)!), manifest)
    expect(search).toHaveLength(source.total)
    expect(search).toEqual(listRows.map(p => normalizaBusquedaPublica(p.nombre + ' ' + p.municipio)))
    expect(manifest.listas.every(d => d.total <= 50 && d.bytes <= SERVICIOS_PUBLICOS_MAX_SHARD_BYTES)).toBe(true)
    expect(Object.values(manifest.mapa).every(pages => pages.every(d => d.total <= 100 && d.bytes <= SERVICIOS_PUBLICOS_MAX_SHARD_BYTES))).toBe(true)
  })
  it('la búsqueda normaliza acentos y espacios offline sin alterar la ficha visible', () => {
    expect(normalizaBusquedaPublica('  Biblioteca ÁNGEL   Sant Adrià  ')).toBe('biblioteca angel sant adria')
    const source = structuredClone(madridSnapshot); source.items[0].nombre = 'Sala ÁNGEL'
    const { artifacts } = particionaFuentePublica(source, now)
    const search = JSON.parse(artifacts.find(x => x.archivo === 'busqueda.json')!.raw)
    expect(search.includes('sala angel madrid')).toBe(true)
    expect(artifacts.filter(x => x.archivo.startsWith('listas/')).some(x => JSON.parse(x.raw).some((p: any) => p.nombre === 'Sala ÁNGEL'))).toBe(true)
  })
  it('cada descriptor prueba los bytes exactos de su archivo, sin metadatos temporales dentro de los shards', async () => {
    const { manifest, artifacts } = particionaFuentePublica(refSnapshot, now)
    const descriptors = [...manifest.listas, ...Object.values(manifest.mapa).flat(), manifest.busqueda]
    for (const d of descriptors) {
      const raw = artifacts.find(x => x.archivo === d.archivo)!.raw, bytes = new TextEncoder().encode(raw)
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
      expect(bytes.length).toBe(d.bytes); expect(hash).toBe(d.sha256)
      expect(Array.isArray(JSON.parse(raw))).toBe(true)
    }
  })
  it('otra consulta sin cambio de fichas conserva rutas, hashes y contenido de todos los shards', () => {
    const first = particionaFuentePublica(refSnapshot, now), second = particionaFuentePublica({ ...refSnapshot, consultado: new Date(now + 86400000).toISOString() }, now + 86400000)
    expect(second.manifest.version).toBe(first.manifest.version)
    expect(second.artifacts).toEqual(first.artifacts)
    expect(second.manifest.consultado).not.toBe(first.manifest.consultado)
  })
  it('horarios largos parten antes de 50 filas sin truncar sus excepciones', () => {
    const source = structuredClone(madridSnapshot)
    for (const p of source.items) p.horarioTexto = 'Horario publicado '.repeat(400) + 'Cerrado los festivos.'
    const { manifest, artifacts } = particionaFuentePublica(source, now)
    expect(manifest.listas.length).toBeGreaterThan(1)
    for (const d of [...manifest.listas, ...Object.values(manifest.mapa).flat()]) {
      expect(d.bytes).toBeLessThanOrEqual(SERVICIOS_PUBLICOS_MAX_SHARD_BYTES)
      expect(JSON.parse(artifacts.find(x => x.archivo === d.archivo)!.raw).every((p: any) => p.horarioTexto.endsWith('Cerrado los festivos.'))).toBe(true)
    }
  })
  it('rechaza rutas alteradas, filas perdidas e índices de búsqueda incompletos o con otro formato', () => {
    const { manifest, artifacts } = particionaFuentePublica(refSnapshot, now)
    const path = structuredClone(manifest); path.listas[0].archivo = '../fuera.json'
    expect(() => validaManifestPublicos(path, now)).toThrow()
    const lost = structuredClone(manifest); lost.listas[0].total--
    expect(() => validaManifestPublicos(lost, now)).toThrow()
    const query = JSON.parse(artifacts.find(x => x.archivo === 'busqueda.json')!.raw); query.pop()
    expect(() => validaBusquedaPublicos(query, manifest)).toThrow()
    query.push(['formato anterior', 0, 0])
    expect(() => validaBusquedaPublicos(query, manifest)).toThrow()
  })
})
