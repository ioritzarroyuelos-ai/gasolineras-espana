import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error Node test utilities; the application targets Workers types.
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
// @ts-expect-error Node test utilities.
import { join, resolve, relative } from 'node:path'
// @ts-expect-error Node test utilities.
import { tmpdir } from 'node:os'
// @ts-expect-error Node test utilities.
import { createHash } from 'node:crypto'
import { SERVICIOS_FUENTES, SERVICIOS_PRODUCTOR_ARCHIVOS, huellaProductorServicios, productorServiciosValido, consultaSnapshotSinCambios, preparaSnapshot, leeSnapshot, guardaSnapshot, validaContinuidadServicios, urlExtractoPermitida, compruebaExtracto, extractosRecientesDelIndice, descargaExtracto } from '../scripts/fetch-servicios.mjs'
import type { ProductorServicios } from '../scripts/fetch-servicios.mjs'
import { normalizaServicio, validaServiciosIndex, SERVICIOS_LIMITE_URL, SERVICIOS_LIMITE_ATRIBUCION } from '../scripts/lib/servicios.mjs'
import type { ServicioFuente, ServicioLimiteTerritorial } from '../scripts/lib/servicios.mjs'

const TS = '2026-11-21T10:00:00.000Z', NOW = Date.parse(TS), DATE = '2026-11-20T21:00:00.000Z'
const productor: ProductorServicios = { version: 1, sha256: 'a'.repeat(64) }, changed: ProductorServicios = { version: 1, sha256: 'b'.repeat(64) }
const sources: ServicioFuente[] = [
  { id: 'espana', url: 'https://download.geofabrik.de/europe/spain/spain-261120.osm.pbf', bytes: 1500000000, fechaDatos: DATE, consultado: TS },
  { id: 'canarias', url: 'https://download.geofabrik.de/africa/canary-islands/canary-islands-261120.osm.pbf', bytes: 50000000, fechaDatos: DATE, consultado: TS },
]
const boundary: ServicioLimiteTerritorial = { fuenteUrl: SERVICIOS_LIMITE_URL, atribucion: SERVICIOS_LIMITE_ATRIBUCION, licencia: 'CC-BY-4.0', consultado: TS, bytes: 10000, sha256: 'c'.repeat(64), administraciones: 19 }
const poi = normalizaServicio({ type: 'node', id: '123', lat: 40.4168, lon: -3.7038, tags: { amenity: 'toilets', name: 'Baño de prueba' }, timestamp: '2020-01-10T12:00:00Z' })!
const snapshot = (fingerprint: ProductorServicios | undefined = productor) => preparaSnapshot([poi], sources, TS, boundary, fingerprint)
const temporary: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const dir of temporary.splice(0)) {
    const path = resolve(dir), parent = resolve(tmpdir())
    if (!path.startsWith(parent + '\\') && !path.startsWith(parent + '/')) throw Error('Test path outside temp')
    if (!path.includes('servicios-productor-test-')) throw Error('Unexpected test path')
    await rm(path, { recursive: true, force: true })
  }
})

describe('huella reproducible y explícita del productor', () => {
  const fixtureRoot = resolve('/test-producer-only')
  function input(crlf = false, changes: Record<string, string> = {}) {
    const requested: string[] = []
    const reader = async (path: string) => {
      const name = relative(fixtureRoot, path).replaceAll('\\', '/'); requested.push(name)
      if (!SERVICIOS_PRODUCTOR_ARCHIVOS.includes(name)) throw Error('Unexpected source read')
      return (changes[name] || 'first line of ' + name + '\nsecond line\n').replaceAll('\n', crlf ? '\r\n' : '\n')
    }
    return { io: { readFile: reader }, requested }
  }
  it('incluye extracción, filtros, normalizador, partición y versiones del robot; no usa la red ni el entorno', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network allowed'))
    const f = input(), result = await huellaProductorServicios(fixtureRoot, f.io)
    expect(productorServiciosValido(result)).toBe(true)
    expect(f.requested).toEqual(['scripts/fetch-servicios.mjs', 'scripts/lib/servicios.mjs', 'scripts/lib/servicios-catalogo.mjs', 'scripts/osm-servicios.py', '.github/workflows/fetch-servicios.yml'])
    expect(Object.keys(result)).toEqual(['version', 'sha256']); expect(fetcher).not.toHaveBeenCalled()
  })
  it('el mismo código con LF o CRLF produce exactamente la misma huella', async () => {
    expect(await huellaProductorServicios(fixtureRoot, input(false).io)).toEqual(await huellaProductorServicios(fixtureRoot, input(true).io))
  })
  it.each([...SERVICIOS_PRODUCTOR_ARCHIVOS])('un cambio en %s invalida el fastpath del mismo extracto', async name => {
    const before = await huellaProductorServicios(fixtureRoot, input().io)
    const after = await huellaProductorServicios(fixtureRoot, input(false, { [name]: 'changed code\n' }).io)
    expect(after.sha256).not.toBe(before.sha256)
    expect(consultaSnapshotSinCambios(snapshot(before).index, sources, after, TS)).toBeNull()
  })
  it('si falta un archivo no inventa una huella ni permite reutilizar', async () => {
    await expect(huellaProductorServicios(fixtureRoot, { readFile: async () => { throw Error('fixture_missing_file') } })).rejects.toThrow('fixture_missing_file')
  })
})

describe('fastpath con versión del productor y fechas originales', () => {
  it('misma huella y fuentes permiten actualizar sólo la consulta, sin mutar la copia previa', () => {
    const old = snapshot().index, original = structuredClone(old), ts = '2026-11-21T11:00:00.000Z'
    const next = consultaSnapshotSinCambios(old, sources, productor, ts)!
    expect(next).toEqual({ ...old, ts, fuentes: old.fuentes.map(source => ({ ...source, consultado: ts })) })
    expect(old).toEqual(original); expect(next.fechaDatos).toBe(DATE); expect(next.tiles).toEqual(old.tiles); expect(next.limiteTerritorial).toEqual(old.limiteTerritorial)
  })
  it('un índice anterior sin huella sigue siendo legible, pero debe regenerarse', () => {
    const old = preparaSnapshot([poi], sources, TS, boundary).index
    expect(() => validaServiciosIndex(old, NOW)).not.toThrow()
    expect(consultaSnapshotSinCambios(old, sources, productor, TS)).toBeNull()
    expect(() => validaServiciosIndex(snapshot().index, NOW)).not.toThrow()
  })
  it('no reutiliza con productor distinto, inválido o protocolo futuro', () => {
    for (const value of [changed, { version: 1, sha256: 'bad' }, { version: 2, sha256: productor.sha256 }]) expect(consultaSnapshotSinCambios(snapshot().index, sources, value as ProductorServicios, TS)).toBeNull()
    expect(() => snapshot({ version: 1, sha256: 'bad' })).toThrow('Huella')
  })
  it('mismo productor no elimina guardas de fuentes, vigencia o límites', () => {
    const old = snapshot().index
    const different = sources.map(source => ({ ...source })); different[1].bytes++
    expect(consultaSnapshotSinCambios(old, different, productor, TS)).toBeNull()
    expect(consultaSnapshotSinCambios(old, sources.slice(0, 1), productor, TS)).toBeNull()
    expect(consultaSnapshotSinCambios(old, [sources[0], sources[0]], productor, TS)).toBeNull()
    expect(consultaSnapshotSinCambios(old, sources, productor, '2026-11-24T10:00:00.000Z')).toBeNull()
    expect(consultaSnapshotSinCambios({ ...old, limiteTerritorial: { ...boundary, consultado: '2026-10-01T10:00:00.000Z' } }, sources, productor, TS)).toBeNull()
  })
  it('latest no equivale a una versión fechada aunque tamaño y productor coincidan', () => {
    const old = snapshot().index, latest = sources.map(source => ({ ...source, url: source.url.replace('261120', 'latest') }))
    expect(consultaSnapshotSinCambios({ ...old, fuentes: latest }, latest, productor, TS)).toBeNull()
    expect(urlExtractoPermitida('!261120.osm.pbf', 'unknown')).toBe(false)
  })
})

async function oldSnapshot(options: { fingerprint?: ProductorServicios | null; badWeb?: boolean; removedCategory?: boolean; corrupt?: boolean; wrongId?: boolean; wrongCount?: boolean } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'servicios-productor-test-')); temporary.push(dir)
  const out = join(dir, 'servicios'), data = snapshot(options.fingerprint === null ? undefined : options.fingerprint || productor)
  if (options.fingerprint === null) delete data.index.productor
  const entry = data.index.tiles[0], tile = JSON.parse(data.files.get(entry.id)!)
  if (options.badWeb) tile.pois[0].web = 'https://example.com/?token=fixture-only'
  if (options.removedCategory) { tile.pois[0].categorias = ['old-removed-category']; data.index.categorias = { 'old-removed-category': 1 } }
  if (options.wrongId) tile.id = '000-000'
  if (options.wrongCount) tile.pois.push(structuredClone(tile.pois[0]))
  const content = JSON.stringify(tile)
  entry.bytes = new TextEncoder().encode(content).byteLength; entry.sha256 = createHash('sha256').update(content).digest('hex')
  await mkdir(join(out, 'tiles'), { recursive: true })
  await writeFile(join(out, 'tiles', entry.id + '.json'), content + (options.corrupt ? ' ' : ''))
  await writeFile(join(out, 'index.json'), JSON.stringify(data.index))
  return { out, index: data.index }
}

describe('reconstruir datos de un productor anterior sin eludir la integridad', () => {
  it.each([productor, null])('un POI rechazado por la regla nueva puede reconstruirse con huella anterior %j', async fingerprint => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW)
    const f = await oldSnapshot({ fingerprint, badWeb: true })
    await expect(leeSnapshot(f.out, NOW)).rejects.toThrow('web inválida')
    const old = await leeSnapshot(f.out, NOW, { allowOldProducer: changed })
    expect(old).toEqual(f.index); expect(consultaSnapshotSinCambios(old, sources, changed, TS)).toBeNull()
    const fresh = snapshot(changed)
    expect(() => validaContinuidadServicios(old, fresh.index)).not.toThrow()
    await guardaSnapshot(fresh, f.out)
    expect((await leeSnapshot(f.out, NOW))?.productor).toEqual(changed)
    const content = await readFile(join(f.out, 'tiles', fresh.index.tiles[0].id + '.json'), 'utf8')
    expect(content).not.toContain('fixture-only'); expect(content).toContain('2020-01-10T12:00:00Z')
  })
  it('la misma huella nunca relaja las validaciones semánticas', async () => {
    const f = await oldSnapshot({ badWeb: true })
    await expect(leeSnapshot(f.out, NOW, { allowOldProducer: productor })).rejects.toThrow('web inválida')
  })
  it('una categoría retirada conserva sólo los recuentos para la continuidad del nuevo catálogo', async () => {
    const f = await oldSnapshot({ removedCategory: true })
    await expect(leeSnapshot(f.out, NOW)).rejects.toThrow('categorías')
    const old = await leeSnapshot(f.out, NOW, { allowOldProducer: changed })
    expect(old?.total).toBe(1); expect(consultaSnapshotSinCambios(old, sources, changed, TS)).toBeNull()
  })
  it.each([{ corrupt: true }, { wrongId: true }, { wrongCount: true }])('una huella nueva no permite una copia corrupta: %j', async options => {
    const f = await oldSnapshot(options)
    await expect(leeSnapshot(f.out, NOW, { allowOldProducer: changed })).rejects.toThrow(/corrupta|incoherente/)
  })
  it('un recuento falso o una huella mal formada tampoco sirven de referencia', async () => {
    const f = await oldSnapshot()
    await writeFile(join(f.out, 'index.json'), JSON.stringify({ ...f.index, total: 100 }))
    await expect(leeSnapshot(f.out, NOW, { allowOldProducer: changed })).rejects.toThrow('estructura')
    await writeFile(join(f.out, 'index.json'), JSON.stringify({ ...f.index, productor: { version: 1, sha256: 'invalid' } }))
    await expect(leeSnapshot(f.out, NOW, { allowOldProducer: changed })).rejects.toThrow('Huella')
  })
})

describe('recuperación acotada de una publicación Geofabrik con latest404', () => {
  const source = SERVICIOS_FUENTES[0], directory = 'https://download.geofabrik.de/europe/spain/index.html'
  const dated = (day: string) => 'https://download.geofabrik.de/europe/spain/spain-' + day + '.osm.pbf'
  const head = () => new Response(null, { headers: { 'Content-Length': '1000' } })
  const index = (html: string) => new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  const html = '<a href="spain-261120.osm.pbf">20</a><a href="spain-261119.osm.pbf">19</a>'
  it('latest307 apunta a un404, el índice oficial ofrece ayer y el HEAD confirma esa copia', async () => {
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === source.url) return new Response(null, { status: 307, headers: { Location: dated('261120') } })
      if (url === dated('261120')) return new Response(null, { status: 404 })
      if (url === directory) { expect(init?.redirect).toBe('error'); return index(html) }
      if (url === dated('261119')) { expect(init?.method).toBe('HEAD'); return head() }
      throw Error('Unexpected URL in fixture')
    })
    const result = await compruebaExtracto(source, { fetch: fetcher, now: NOW })
    expect(result).toMatchObject({ url: dated('261119'), bytes: 1000 })
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([source.url, dated('261120'), directory, dated('261119')])
  })
  it('sólo admite enlaces exactos de la misma fuente publicados en los3últimos días', () => {
    const markup = '<a href="https://evil.test/spain-261121.osm.pbf">externo</a>' +
      '<a href="spain-261118.osm.pbf">antiguo</a><a href="spain-261122.osm.pbf">futuro</a><a href="spain-latest.osm.pbf">mutable</a>' +
      '<a href="spain-261121.osm.pbf.md5">hash</a><a href="spain-261121.osm.pbf?x=1">query</a>' +
      '<a data-href="spain-261121.osm.pbf">no enlace</a><!-- <a href="spain-261121.osm.pbf">comentario</a> -->' +
      '<script>"<a href=spain-261121.osm.pbf>script</a>"</script>' + html + '<a href=spain-261119.osm.pbf>duplicado</a>'
    expect(extractosRecientesDelIndice(markup, source, NOW)).toEqual([dated('261120'), dated('261119')])
    expect(extractosRecientesDelIndice('<a href="spain-261119.osm.pbf">19</a><a href="spain-261121.osm.pbf">21</a>' + html, source, NOW)).toEqual([dated('261121'), dated('261120'), dated('261119')])
    expect(extractosRecientesDelIndice(html, SERVICIOS_FUENTES[1], NOW)).toEqual([])
    expect(extractosRecientesDelIndice('<a href="canary-islands-261119.osm.pbf">Canarias</a>', SERVICIOS_FUENTES[1], NOW)).toEqual(['https://download.geofabrik.de/africa/canary-islands/canary-islands-261119.osm.pbf'])
  })
  it.each(['', '<p>No hay extractos</p>', '<a href="https://evil.test/spain-261120.osm.pbf">externo</a>', '<a href="spain-261118.osm.pbf">demasiado antiguo</a>'])('un índice vacío, inseguro o antiguo no inventa un destino: %s', async body => {
    const fetcher = vi.fn<typeof fetch>(async url => url === source.url ? new Response(null, { status: 404 }) : url === directory ? index(body) : Promise.reject(Error('No additional URL allowed')))
    await expect(compruebaExtracto(source, { fetch: fetcher, now: NOW })).rejects.toThrow('últimos tres días')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([403, 500])('un fallo HTTP%s de latest no se oculta buscando otra copia', async status => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status }))
    await expect(compruebaExtracto(source, { fetch: fetcher, now: NOW })).rejects.toThrow('HTTP ' + status)
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each([403, 500])('un fallo HTTP%s del candidato tampoco se oculta', async status => {
    const fetcher = vi.fn<typeof fetch>(async url => url === source.url ? new Response(null, { status: 404 }) : url === directory ? index(html) : new Response(null, { status }))
    await expect(compruebaExtracto(source, { fetch: fetcher, now: NOW })).rejects.toThrow('HTTP ' + status)
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('rechaza una redirección externa y nunca consulta ese host ni el índice', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 307, headers: { Location: 'https://evil.test/spain-261120.osm.pbf' } }))
    await expect(compruebaExtracto(source, { fetch: fetcher, now: NOW })).rejects.toThrow('Destino')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('una copia disponible no consulta el índice y un índice excesivo se rechaza antes de elegir', async () => {
    const ready = vi.fn<typeof fetch>(async () => head())
    expect((await compruebaExtracto(source, { fetch: ready, now: NOW })).url).toBe(source.url); expect(ready).toHaveBeenCalledOnce()
    const excessive = vi.fn<typeof fetch>(async url => url === source.url ? new Response(null, { status: 404 }) : new Response('x', { headers: { 'Content-Type': 'text/html', 'Content-Length': String(2 * 1024 * 1024 + 1) } }))
    await expect(compruebaExtracto(source, { fetch: excessive, now: NOW })).rejects.toThrow('índice oficial')
    expect(excessive).toHaveBeenCalledTimes(2)
  })
  it('un GET se fija a la URL y al tamaño comprobados sin volver a latest', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'servicios-productor-test-')); temporary.push(dir)
    const checked = { url: dated('261119'), bytes: 1000 }, pinned = { ...source, url: checked.url }
    const fetcher = vi.fn<typeof fetch>(async (url, init) => { expect(url).toBe(checked.url); expect(init?.method).toBe('GET'); return new Response('x'.repeat(1000), { headers: { 'Content-Length': '1000' } }) })
    expect(await descargaExtracto(pinned, join(dir, 'fixture.pbf'), { fetch: fetcher }, checked)).toEqual(checked)
    expect((await readFile(join(dir, 'fixture.pbf'))).length).toBe(1000)
    const changedSize = vi.fn<typeof fetch>(async () => new Response('x'.repeat(1001), { headers: { 'Content-Length': '1001' } }))
    await expect(descargaExtracto(pinned, join(dir, 'must-not-exist.pbf'), { fetch: changedSize }, checked)).rejects.toThrow('cambió desde')
    await expect(readFile(join(dir, 'must-not-exist.pbf'))).rejects.toMatchObject({ code: 'ENOENT' })
    const changedUrl = vi.fn<typeof fetch>(async url => url === checked.url ? new Response(null, { status: 307, headers: { Location: dated('261120') } }) : head())
    await expect(descargaExtracto(pinned, join(dir, 'also-not-created.pbf'), { fetch: changedUrl }, checked)).rejects.toThrow('cambió desde')
  })
})
