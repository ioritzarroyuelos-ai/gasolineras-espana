import { afterEach, describe, expect, it, vi } from 'vitest'
// @ts-expect-error El productor se ejecuta en Node; los tipos de la web no incluyen fs.
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises'
// @ts-expect-error Tipos Node fuera del runtime Worker.
import { tmpdir } from 'node:os'
// @ts-expect-error Tipos Node fuera del runtime Worker.
import { join } from 'node:path'
import { actualizaAparcamientos, preparaCatalogoParking } from '../scripts/fetch-aparcamientos.mjs'
import { PARKING_NOW as now, madridList, madridRow, madridDetail, vigoRow } from './aparcamientos-fixtures'
import { validaCatalogoParking } from '../src/lib/aparcamientos-datos'
const directories: string[] = []
afterEach(async () => { for (const path of directories.splice(0)) { if (!path.startsWith(join(tmpdir(), 'parking-tests-'))) throw Error('Directorio de prueba incorrecto'); await rm(path, { recursive: true, force: true }) } })
async function temporary() { const path = await mkdtemp(join(tmpdir(), 'parking-tests-')); directories.push(path); return path }
function fetchSources({ madridFails = false, vigoFails = false, detailFails = false, rows = 50 } = {}) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (new URL(url instanceof Request ? url.url : url).hostname === 'datos.vigo.org') return vigoFails ? new Response(null, { status: 503 }) : Response.json(Array.from({ length: 8 }, (_, n) => vigoRow(4763 + n)))
    if (madridFails) return new Response(null, { status: 503 })
    const body = String(init?.body), detailId = /<i:id>(\d+)<\/i:id>/.exec(body)?.[1]
    if (detailId) return detailFails ? new Response(null, { status: 503 }) : new Response(madridDetail(Number(detailId)))
    return new Response(madridList(Array.from({ length: rows }, (_, n) => madridRow(72 + n)).join('')))
  })
}
describe('Robot diario de aparcamientos', () => {
  it('obtiene un catálogo sin guardar disponibilidad y consulta detalles secuencialmente con pausa', async () => {
    const fetcher = fetchSources(), sleep = vi.fn(async () => {})
    const data = await preparaCatalogoParking('madrid', null, { fetcher, sleep, clock: () => now })
    expect(data.total).toBe(50); expect(data.detallesPendientes).toBe(0)
    expect(data.items[0]).toMatchObject({ capacidad: 132, plazasPmr: 3, fechaFicha: null, detalleConsultado: new Date(now).toISOString(), gratis: null })
    expect(data.items[0]).not.toHaveProperty('plazasLibres'); expect(data.items[0]).not.toHaveProperty('fechaOcupacion')
    expect(fetcher).toHaveBeenCalledTimes(51); expect(sleep).toHaveBeenCalledTimes(49)
    expect(sleep).toHaveBeenCalledWith(1000)
  })
  it('un fallo de detalles conserva atributos y fecha anterior, sin rejuvenecerlos', async () => {
    const old = await preparaCatalogoParking('madrid', null, { fetcher: fetchSources(), sleep: async () => {}, clock: () => now })
    const data = await preparaCatalogoParking('madrid', old, { fetcher: fetchSources({ detailFails: true }), sleep: async () => {}, clock: () => now + 86400000 })
    expect(data.detallesPendientes).toBe(50); expect(data.consultado).not.toBe(old.consultado)
    expect(data.items[0].detalleConsultado).toBe(old.items[0].detalleConsultado)
    expect(data.items[0].plazasPmr).toBe(3)
  })
  it('rechaza pérdidas importantes respecto al catálogo anterior', async () => {
    const old = await preparaCatalogoParking('madrid', null, { fetcher: fetchSources({ rows: 75 }), sleep: async () => {}, clock: () => now })
    await expect(preparaCatalogoParking('madrid', old, { fetcher: fetchSources({ rows: 50 }), sleep: async () => {}, clock: () => now })).rejects.toThrow('Catálogo incompleto')
  })
  it('las fuentes se actualizan de forma independiente; el fallo no cambia último éxito ni copia anterior', async () => {
    const directory = await temporary()
    const first = await actualizaAparcamientos({ directory, fetcher: fetchSources(), sleep: async () => {}, clock: () => now })
    expect(first.correcto).toBe(true)
    const old = await readFile(join(directory, 'madrid.json'), 'utf8')
    const second = await actualizaAparcamientos({ directory, fetcher: fetchSources({ madridFails: true }), sleep: async () => {}, clock: () => now + 86400000 })
    expect(second.correcto).toBe(false)
    expect(second.fuentes[0]).toMatchObject({ estado: 'conservada', ultimoExito: first.fuentes[0].ultimoExito, sha256: first.fuentes[0].sha256 })
    expect(second.fuentes[1]).toMatchObject({ estado: 'actual', ultimoExito: new Date(now + 86400000).toISOString() })
    expect(await readFile(join(directory, 'madrid.json'), 'utf8')).toBe(old)
    expect(validaCatalogoParking(JSON.parse(await readFile(join(directory, 'vigo.json'), 'utf8')), 'vigo', now + 86400000).total).toBe(8)
  })
  it('publica un estado de error honesto si nunca hubo catálogo válido', async () => {
    const directory = await temporary()
    const result = await actualizaAparcamientos({ directory, fetcher: fetchSources({ madridFails: true, vigoFails: true }), sleep: async () => {}, clock: () => now })
    expect(result.correcto).toBe(false)
    expect(result.fuentes.every(source => source.estado === 'error' && source.ultimoExito === null && source.bytes === 0 && source.sha256 === null)).toBe(true)
    expect(JSON.parse(await readFile(join(directory, 'index.json'), 'utf8')).fuentes).toEqual(result.fuentes)
  })
  it('deshace escrituras si el índice no se puede reemplazar', async () => {
    const directory = await temporary()
    await actualizaAparcamientos({ directory, fetcher: fetchSources(), sleep: async () => {}, clock: () => now })
    const old = await readFile(join(directory, 'madrid.json'), 'utf8')
    await rm(join(directory, 'index.json'))
    await mkdir(join(directory, 'index.json'))
    await expect(actualizaAparcamientos({ directory, fetcher: fetchSources(), sleep: async () => {}, clock: () => now + 86400000 })).rejects.toThrow()
    expect(await readFile(join(directory, 'madrid.json'), 'utf8')).toBe(old)
  })
})
