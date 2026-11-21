import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
// @ts-expect-error Node sólo en las pruebas del productor y los hashes de fixtures.
import { createHash } from 'node:crypto'
import type { Env } from '../src/index'
import { particionaFuentePublica } from '../scripts/fetch-servicios-publicos.mjs'
import { SERVICIOS_PUBLICOS_FUENTES, type FuentePublica, type ServicioPublico, type IndicePublicos } from '../scripts/lib/servicios-publicos.mjs'
import { consultaDirectorioPublico, consultaPublicos } from '../src/lib/servicios-publicos'
import { registerServiciosPublicosRoutes } from '../src/routes/servicios-publicos'

const now = Date.parse('2026-11-21T12:00:00.000Z'), checked = '2026-11-21T10:00:00.000Z', original = '2026-10-16T12:45:30.000Z'
const source = SERVICIOS_PUBLICOS_FUENTES[1], zone = '521-705'
const integrity = (raw: string) => ({ bytes: new TextEncoder().encode(raw).length, sha256: createHash('sha256').update(raw).digest('hex') as string })
function point(i: number, overrides: Partial<ServicioPublico> = {}): ServicioPublico {
  return { id: 'estudio-madrid-' + (i + 1), nombre: 'Sala ' + String(i).padStart(4, '0'), categoria: 'salas-estudio', lat: 40.4, lon: -3.7, direccion: 'Calle de ejemplo', municipio: 'Madrid', cp: '28001', web: null,
    horarioTexto: 'De 9 a 21 h. Cerrado el 1 y 6 de enero. No se publica disponibilidad de plazas.', fechaFicha: null, accesibilidad: 'desconocido', accesibilidadTexto: null, tipo: null, aguaPotable: null, lavabos: null, climatizacion: null, descanso: null, ...overrides }
}
function bundle(items = Array.from({ length: 60 }, (_, i) => point(i, i === 0 ? { lat: null, lon: null } : {}))) {
  const data: FuentePublica = { schema: 1, id: source.id, nombre: source.nombre, consultado: checked, fechaDatos: original, fuenteUrl: source.fuenteUrl, datosUrl: source.datosUrl, licenciaUrl: source.licenciaUrl, atribucion: source.atribucion,
    total: items.length, conCoordenadas: items.filter(p => p.lat !== null).length, sinCoordenadas: items.filter(p => p.lat === null).length, avisos: ['El catálogo no publica plazas libres.'], items }
  const { manifest, artifacts } = particionaFuentePublica(data, now), files = new Map<string, string>()
  for (const a of artifacts) files.set(source.id + '/' + manifest.version + '/' + a.archivo, a.raw)
  const index: IndicePublicos = { schema: 1, consultado: checked, fuentes: SERVICIOS_PUBLICOS_FUENTES.map(f => f.id === source.id ? { id: f.id, nombre: f.nombre, estado: 'actual', ultimoExito: checked, fechaDatos: original, total: data.total, ...integrity(JSON.stringify(data)), manifestBytes: 0, manifestSha256: '' }
    : { id: f.id, nombre: f.nombre, estado: 'error', ultimoExito: null, fechaDatos: null, total: 0, bytes: 0, sha256: null, manifestBytes: 0, manifestSha256: null, error: 'No se pudo comprobar.' }) }
  const save = () => { const raw = JSON.stringify(manifest), proof = integrity(raw), row = index.fuentes.find(f => f.id === source.id)!; row.manifestBytes = proof.bytes; row.manifestSha256 = proof.sha256; files.set(source.id + '/manifest.json', raw); files.set('index.json', JSON.stringify(index)) }
  const rewrite = (descriptor: { archivo: string; bytes: number; sha256: string }, raw: unknown) => { const text = JSON.stringify(raw); Object.assign(descriptor, integrity(text)); files.set(source.id + '/' + manifest.version + '/' + descriptor.archivo, text); save() }
  save()
  const fetch = vi.fn(async (request: Request): Promise<Response> => { const path = new URL(request.url).pathname.replace('/data/servicios-publicos/', ''); const raw = files.get(path); return new Response(raw ?? 'Missing', { status: raw === undefined ? 404 : 200 }) })
  const app = new Hono<{ Bindings: Env }>(); registerServiciosPublicosRoutes(app)
  return { data, files, manifest, index, save, rewrite, fetch, assets: { fetch }, request: (path: string) => app.request(path, {}, { ASSETS: { fetch } } as any) }
}
const query = { zona: null, pagina: 0, q: '' }
beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(now) })
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

describe('lectura pública acotada por bloques y con fechas originales', () => {
  it('el listado conserva fichas sin coordenadas y sólo lee índice, manifest y una página', async () => {
    const b = bundle(), result = await consultaDirectorioPublico(b.assets, source.id, query, now)
    expect(result).toMatchObject({ total: 60, totalPaginas: 2, siguientePagina: 1, conCoordenadas: 59, sinCoordenadas: 1, fechaDatos: original, consultado: checked, desactualizado: false })
    expect(result.items).toHaveLength(50); expect(result.items[0].lat).toBeNull()
    expect(b.fetch).toHaveBeenCalledTimes(3)
    expect(b.fetch.mock.calls.map(([r]) => r.url)).not.toContain(expect.stringContaining(source.id + '.json'))
    const last = await consultaDirectorioPublico(b.assets, source.id, { ...query, pagina: 1 }, now)
    expect(last.items).toHaveLength(10); expect(last.siguientePagina).toBeNull(); expect(b.fetch).toHaveBeenCalledTimes(4)
  })
  it('el mapa sólo incluye puntos publicados y conserva el aviso de cobertura', async () => {
    const b = bundle(), result = await consultaDirectorioPublico(b.assets, source.id, { ...query, zona: zone }, now)
    expect(result.items).toHaveLength(59); expect(result.sinCoordenadas).toBe(1)
    expect(result.items.every(p => typeof p.lat === 'number')).toBe(true)
    expect(JSON.stringify(result.items)).not.toMatch(/plazasLibres|abiertoAhora|activado/)
  })
  it('recorre todos los resultados dispersos leyendo como máximo dos bloques de fichas por página', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => point(i, i % 50 === 0 ? { nombre: 'Sala ' + String(i).padStart(4, '0') + ' Única' } : {})), b = bundle(rows)
    const first = await consultaDirectorioPublico(b.assets, source.id, { ...query, q: 'unica' }, now)
    expect(first).toMatchObject({ total: 6, totalPaginas: 3, siguientePagina: 1 }); expect(first.items).toHaveLength(2)
    expect(b.fetch).toHaveBeenCalledTimes(5)
    const second = await consultaDirectorioPublico(b.assets, source.id, { ...query, q: 'ÚNICA', pagina: 1 }, now)
    expect(second.items).toHaveLength(2); expect(second.siguientePagina).toBe(2)
    const last = await consultaDirectorioPublico(b.assets, source.id, { ...query, q: 'ÚNICA', pagina: 2 }, now)
    expect(last.siguientePagina).toBeNull(); expect(new Set([...first.items, ...second.items, ...last.items].map(p => p.id)).size).toBe(6)
  })
  it('un bloque de pocas filas por tamaño usa la paginación del manifest, sin saltos', async () => {
    const b = bundle(Array.from({ length: 60 }, (_, i) => point(i, { horarioTexto: 'Horario: ' + 'Texto completo. '.repeat(500) + 'Excepción final: cerrado.' })))
    expect(b.manifest.listas.length).toBeGreaterThan(2)
    const ids: string[] = []
    for (let p = 0; p < b.manifest.listas.length; p++) { const r = await consultaDirectorioPublico(b.assets, source.id, { ...query, pagina: p }, now); ids.push(...r.items.map(x => x.id)); expect(r.totalPaginas).toBe(b.manifest.listas.length) }
    expect(ids).toHaveLength(60); expect(new Set(ids).size).toBe(60)
  })
  it('una copia conservada y una comprobación de hace más de30h nunca aparentan actuales', async () => {
    const b = bundle(); Object.assign(b.index.fuentes.find(f => f.id === source.id)!, { estado: 'conservada', error: 'No se pudo renovar.' }); b.save()
    expect(await consultaDirectorioPublico(b.assets, source.id, query, now)).toMatchObject({ desactualizado: true, estado: 'conservada', fechaDatos: original, consultado: checked })
    const c = bundle(); expect(await consultaDirectorioPublico(c.assets, source.id, query, now + 31 * 3600000)).toMatchObject({ desactualizado: true, fechaDatos: original })
  })
  it('una consulta fallida no se queda almacenada en caché como directorio vacío', async () => {
    const b = bundle(); b.fetch.mockImplementationOnce(async () => new Response(null, { status: 503 }))
    await expect(consultaDirectorioPublico(b.assets, source.id, query, now)).rejects.toThrow()
    expect((await consultaDirectorioPublico(b.assets, source.id, query, now)).items).toHaveLength(50)
  })
  it('la caché queda aislada por binding y conserva una única lectura concurrente', async () => {
    const b = bundle(), other = bundle(Array.from({ length: 30 }, (_, i) => point(i, { nombre: 'Otro ' + i })))
    const [a, c, d] = await Promise.all([consultaDirectorioPublico(b.assets, source.id, query, now), consultaDirectorioPublico(b.assets, source.id, query, now), consultaDirectorioPublico(other.assets, source.id, query, now)])
    expect(a.items).toEqual(c.items); expect(d.total).toBe(30); expect(b.fetch).toHaveBeenCalledTimes(3)
  })
})

describe('integridad y fallos visibles', () => {
  it('rechaza el manifest alterado y no expone contenido sin comprobar', async () => {
    const b = bundle(); b.files.set(source.id + '/manifest.json', b.files.get(source.id + '/manifest.json')!.replace('Madrid', 'Mallorca'))
    expect((await b.request('/api/servicios/publicos/' + source.id)).status).toBe(503)
  })
  it('rechaza bytes añadidos, tipos rotos y enlaces no válidos aunque un bloque tenga hash coherente', async () => {
    for (const bad of [{ web: 'javascript:alert(1)' }, { lat: 0, lon: 0 }, { nombre: 34 }, { categoria: 'refugios-climaticos' }]) {
      const b = bundle(), d = b.manifest.listas[0], rows = JSON.parse(b.files.get(source.id + '/' + b.manifest.version + '/' + d.archivo)!)
      Object.assign(rows[0], bad); b.rewrite(d, rows)
      expect((await b.request('/api/servicios/publicos/' + source.id)).status).toBe(503)
    }
    const b = bundle(), d = b.manifest.listas[0], path = source.id + '/' + b.manifest.version + '/' + d.archivo
    b.files.set(path, b.files.get(path)! + ' ')
    expect((await b.request('/api/servicios/publicos/' + source.id)).status).toBe(503)
  })
  it('una ficha desplazada a otra zona no se muestra en el punto incorrecto', async () => {
    const b = bundle(), d = b.manifest.mapa[zone][0], rows = JSON.parse(b.files.get(source.id + '/' + b.manifest.version + '/' + d.archivo)!)
    rows[0].lat = 40.6; b.rewrite(d, rows)
    expect((await b.request('/api/servicios/publicos/' + source.id + '?zona=' + zone)).status).toBe(503)
  })
  it('la búsqueda comprueba el texto contra la ficha, no confía sólo en la posición', async () => {
    const b = bundle(), d = b.manifest.busqueda, rows = JSON.parse(b.files.get(source.id + '/' + b.manifest.version + '/' + d.archivo)!)
    rows[0] = 'fantasma madrid'; b.rewrite(d, rows)
    expect((await b.request('/servicios/' + source.id + '?q=fantasma')).status).toBe(503)
  })
  it('una fecha original futura se rechaza incluso dentro de la tolerancia de comprobación', async () => {
    const b = bundle(); b.manifest.fechaDatos = new Date(now + 60000).toISOString(); b.manifest.consultado = b.manifest.fechaDatos
    Object.assign(b.index.fuentes.find(f => f.id === source.id)!, { fechaDatos: b.manifest.fechaDatos, ultimoExito: b.manifest.consultado }); b.index.consultado = b.manifest.consultado; b.save()
    expect((await b.request('/api/servicios/publicos/' + source.id)).status).toBe(503)
  })
  it('acota el cuerpo declarado y no lee contenido sobredimensionado', async () => {
    const b = bundle(); b.fetch.mockImplementationOnce(async () => new Response('{}', { headers: { 'Content-Length': '9000000' } }))
    expect((await b.request('/api/servicios/publicos/' + source.id)).status).toBe(503)
    expect(b.fetch).toHaveBeenCalledTimes(1)
  })
  it('termina una lectura bloqueada sin esperar indefinidamente', async () => {
    vi.useFakeTimers(); const b = bundle(); b.fetch.mockImplementationOnce(async () => new Promise<Response>(() => {}))
    const request = b.request('/api/servicios/publicos/' + source.id)
    await vi.advanceTimersByTimeAsync(6001)
    expect((await request).status).toBe(503)
  })
})

describe('API y páginas comprensibles sin JavaScript', () => {
  it.each(['lat=40&lon=-3', 'zona=521-705.0', 'zona=521-705&zona=521-705', 'pagina=-1', 'pagina=1.2', 'q=foo', 'zona=../../secreto'])('la API rechaza parámetros fuera del contrato: %s', async params => {
    expect(consultaPublicos(new URL('https://test/?' + params), true)).toBeNull()
    const b = bundle(); expect((await b.request('/api/servicios/publicos/' + source.id + '?' + params)).status).toBe(400); expect(b.fetch).not.toHaveBeenCalled()
  })
  it('las páginas mantienen horario y excepciones completos y escapan texto', async () => {
    const b = bundle(Array.from({ length: 30 }, (_, i) => point(i, { nombre: i === 0 ? '<script>alert(1)</script>' : 'Sala ' + i, horarioTexto: 'De 9 a 21. Excepción final: <cerrado> el 6 de enero.' })))
    const res = await b.request('/servicios/' + source.id), html = await res.text()
    expect(res.status).toBe(200); expect(html).toContain('Excepción final: &lt;cerrado&gt; el 6 de enero.'); expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;'); expect(html).toContain('no se publican plazas libres')
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'")
  })
  it('el error da503 y fuente oficial, sin afirmar que no hay equipamientos', async () => {
    const b = bundle(); b.files.delete('index.json')
    const r = await b.request('/servicios/' + source.id), html = await r.text()
    expect(r.status).toBe(503); expect(html).toContain('Esto no significa que no existan equipamientos'); expect(html).toContain(source.fuenteUrl)
  })
  it('muestra paginación real, conserva la búsqueda y devuelve404 fuera de rango', async () => {
    const b = bundle(); const search = await (await b.request('/servicios/' + source.id + '?q=sala')).text()
    expect(search).toContain('Página 1 de 3'); expect(search).toContain('q=sala&amp;pagina=1')
    expect(search).toContain('noindex,follow'); expect((await b.request('/servicios/' + source.id + '?pagina=999')).status).toBe(404)
  })
  it('la API no admite parámetros para el índice ni confunde fuente desconocida con vacía', async () => {
    const b = bundle(); expect((await b.request('/api/servicios/publicos?lat=40')).status).toBe(400)
    expect((await b.request('/api/servicios/publicos/inventada')).status).toBe(400)
    const res = await b.request('/api/servicios/publicos/' + source.id)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })
})
