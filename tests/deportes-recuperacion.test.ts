import { describe, expect, it, vi } from 'vitest'
import { parseaPRsRecuperacion, parseaFechaRecuperacion, validaPRRecuperacion, combinaRecuperacionDeportiva, recuperaDeportesDesdePR } from '../scripts/lib/deportes-recuperacion.mjs'
import { construyeIndiceDeportes } from '../scripts/lib/deportes-indice.mjs'
import type { CompeticionDeportiva } from '../scripts/lib/deportes.mjs'

const ahora = Date.parse('2026-11-20T22:00:00Z'), fuente = 'https://federacion.example/resultados'
const ref = '065bcdfd12d358c0db860565e3f46ed0573098d2', repo = 'ioritzarroyuelos-ai/gasolineras-espana'
const seleccion = '506:' + ref, desde = '2026-11-20', objetivo = { numero: 506, sha: ref }
const propuesta = () => ({ number: 506, user: { login: 'espanautildatos-ioritzarroyuelos[bot]', type: 'Bot', id: 352320937 },
  head: { ref: 'datos/deportes-44781622605-1', sha: ref, repo: { full_name: repo } }, base: { ref: 'main', repo: { full_name: repo } } })
function competicion(fecha = '2026-11-20T17:00:00Z'): CompeticionDeportiva {
  return { id: 'liga-prueba', deporte: 'futbol', nombre: 'Liga de pruebas', temporada: '2026-2027', categoria: 'Sénior', zona: 'Madrid', fuente: { nombre: 'Federación', url: fuente }, comprobadoEn: fecha,
    agenda: { estado: 'actualizado', consultado: fecha, verificadoEn: fecha, fuenteUrl: fuente, eventos: [{ id: 'partido', nombre: 'Uno – Dos', fecha: '2026-11-21', estado: 'programado' }] },
    clasificacion: { estado: 'actualizado', consultado: fecha, verificadoEn: fecha, fuenteUrl: fuente, tablas: [{ id: 'tabla', nombre: 'Tabla', columnas: [{ clave: 'p', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: 'Uno', valores: { p: 10 } }] }] } }
}
const indice = (cs: CompeticionDeportiva[]) => construyeIndiceDeportes(cs, [], ahora).indice
const respuesta = (v: unknown) => new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json' } })

describe('recuperación de snapshots deportivos del robot', () => {
  it('solo acepta una selección explícita, acotada y sin duplicados', () => {
    expect(parseaPRsRecuperacion(seleccion)).toEqual([objetivo])
    expect(parseaPRsRecuperacion('490:' + ref + ', 494:' + ref + ',500:' + ref + ',' + seleccion)).toHaveLength(4)
    for (const v of ['', undefined, '507', seleccion + ',' + seleccion, '506; echo hola', '../506', '506,', '506:main', seleccion + ',']) expect(() => parseaPRsRecuperacion(v)).toThrow()
    expect(() => parseaPRsRecuperacion(Array.from({ length: 5 }, (_, i) => (490 + i) + ':' + ref).join(','))).toThrow()
  })
  it('exige una fecha mínima explícita, real y no futura', () => {
    expect(parseaFechaRecuperacion(desde, ahora)).toBe(Date.parse('2026-11-20T00:00:00Z'))
    for (const v of ['', undefined, '2026-02-30', '20/11/2026', '2026-11-21']) expect(() => parseaFechaRecuperacion(v, ahora)).toThrow()
  })
  it('rechaza autor, repositorio, rama, SHA o número distintos de los aprobados', () => {
    expect(validaPRRecuperacion(propuesta(), objetivo)).toBe(ref)
    const casos = [
      (p: ReturnType<typeof propuesta>) => { p.user.login = 'otro[bot]' },
      (p: ReturnType<typeof propuesta>) => { p.user.id++ },
      (p: ReturnType<typeof propuesta>) => { p.user.type = 'User' },
      (p: ReturnType<typeof propuesta>) => { p.head.repo.full_name = 'otro/repositorio' },
      (p: ReturnType<typeof propuesta>) => { p.base.repo.full_name = 'otro/repositorio' },
      (p: ReturnType<typeof propuesta>) => { p.head.sha = 'a'.repeat(40) },
      (p: ReturnType<typeof propuesta>) => { p.head.ref = 'main' },
      (p: ReturnType<typeof propuesta>) => { p.base.ref = 'otra' },
      (p: ReturnType<typeof propuesta>) => { p.number = 500 },
    ]
    for (const cambia of casos) { const p = propuesta(); cambia(p); expect(() => validaPRRecuperacion(p, objetivo)).toThrow() }
  })
  it('elige cada apartado por su verificación, sin retroceder ni cambiar fechas de consulta', () => {
    const actual = competicion('2026-11-12T10:00:00Z'), copia = competicion()
    actual.clasificacion = competicion('2026-11-20T21:00:00Z').clasificacion
    actual.comprobadoEn = '2026-11-20T21:00:00Z'
    const salida = combinaRecuperacionDeportiva(actual, copia, undefined, ahora)
    expect(salida.agenda).toEqual(copia.agenda)
    expect(salida.clasificacion).toEqual(actual.clasificacion)
    expect(salida.comprobadoEn).toBe(actual.comprobadoEn)
    expect(combinaRecuperacionDeportiva(salida, copia, undefined, ahora)).toEqual(salida)
    expect(actual.agenda.verificadoEn).toBe('2026-11-12T10:00:00Z')
  })
  it('rechaza datos inválidos o de otra temporada y conserva la fecha de las copias', () => {
    const c = competicion(), mala = competicion(); mala.temporada = '2025-2026'
    expect(() => combinaRecuperacionDeportiva(c, mala, undefined, ahora)).toThrow(/temporadas/)
    mala.temporada = c.temporada; mala.agenda.eventos[0].inicio = 'hora inventada'
    expect(() => combinaRecuperacionDeportiva(c, mala, undefined, ahora)).toThrow()
    expect(combinaRecuperacionDeportiva(undefined, competicion('2026-11-12T10:00:00Z'), undefined, ahora).agenda.verificadoEn).toBe('2026-11-12T10:00:00Z')
  })
  it('reconstruye índice y agenda con los bloques verificados y solo envía el token a la API fija', async () => {
    const anterior = competicion('2026-11-12T10:00:00Z'), copia = competicion(), urls: string[] = []
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(String(url)); urls.push(u.href)
      if (u.hostname === 'api.github.com') { expect(new Headers(init?.headers).get('authorization')).toBe('Bearer prueba'); return respuesta(propuesta()) }
      expect(u.hostname).toBe('raw.githubusercontent.com'); expect(u.pathname).toContain('/' + ref + '/public/data/deportes/')
      expect(new Headers(init?.headers).has('authorization')).toBe(false)
      return respuesta(u.pathname.endsWith('/index.json') ? indice([copia]) : copia)
    })
    const salida = await recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([anterior]), anteriores: [anterior], ahora, fetcher, token: 'prueba' })
    expect(salida.informe.apartadosRecuperados).toBe(2)
    expect(urls).toHaveLength(3)
    expect(salida.competiciones[0]).toEqual(copia)
    expect(salida.agendas['madrid/2026-11-21'][0].verificadoEn).toBe(copia.agenda.verificadoEn)
    expect(salida.indice.competiciones[0].agenda.verificadoEn).toBe(copia.agenda.verificadoEn)
  })
  it('no descarga datos cuando el PR es ajeno ni reintenta un bloqueo de GitHub', async () => {
    const base = competicion(), p = propuesta(); p.user.login = 'ajeno'
    const ajeno = vi.fn(async () => respuesta(p))
    await expect(recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher: ajeno })).rejects.toThrow(/robot/)
    expect(ajeno).toHaveBeenCalledTimes(1)
    for (const status of [403, 429]) {
      const bloqueado = vi.fn(async () => new Response('', { status }))
      await expect(recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher: bloqueado })).rejects.toThrow('HTTP ' + status)
      expect(bloqueado).toHaveBeenCalledTimes(1)
    }
  })
  it('aborta si un JSON válido pertenece a otro índice o si sus datos son inválidos', async () => {
    const base = competicion('2026-11-12T10:00:00Z'), copia = competicion()
    for (const invalida of [false, true]) {
      const incorrecta = structuredClone(copia)
      if (invalida) incorrecta.agenda.eventos[0].inicio = 'sin zona'
      else incorrecta.id = 'otra-liga'
      const fetcher = vi.fn(async (url: RequestInfo | URL) => respuesta(String(url).includes('/pulls/') ? propuesta() : String(url).endsWith('/index.json') ? indice([copia]) : incorrecta))
      await expect(recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher })).rejects.toThrow()
      expect(base.agenda.verificadoEn).toBe('2026-11-12T10:00:00Z')
    }
  })
  it('no descarga apartados anteriores al mínimo ni sobrescribe una tanda publicada después del snapshot', async () => {
    const base = competicion('2026-11-20T21:00:00Z'), antigua = competicion('2026-11-12T10:00:00Z')
    for (const copia of [antigua, competicion()]) {
      const fetcher = vi.fn(async (url: RequestInfo | URL) => respuesta(String(url).includes('/pulls/') ? propuesta() : indice([copia])))
      const salida = await recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher })
      expect(salida.informe.apartadosRecuperados).toBe(0)
      expect(salida.competiciones[0]).toEqual(base)
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
  })
  it('rechaza un índice actual incoherente antes de consultar GitHub', async () => {
    const base = competicion(), resumen = indice([base]); resumen.competiciones[0].agenda.total++
    const fetcher = vi.fn(async () => respuesta(propuesta()))
    await expect(recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: resumen, anteriores: [base], ahora, fetcher })).rejects.toThrow(/índice/)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('combina dos snapshots por apartado, con independencia del orden elegido', async () => {
    const ref2 = '20ff76652a5c55ca4ebd1b2c4185d9472dd89187', base = competicion('2026-11-12T10:00:00Z')
    const a = competicion('2026-11-20T19:00:00Z'), b = competicion('2026-11-20T18:00:00Z')
    a.agenda = competicion('2026-11-20T17:00:00Z').agenda
    b.clasificacion = competicion('2026-11-20T16:00:00Z').clasificacion
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url))
      if (u.hostname === 'api.github.com') {
        const p = propuesta(); if (u.pathname.endsWith('/500')) { p.number = 500; p.head.sha = ref2 }
        return respuesta(p)
      }
      const c = u.pathname.includes(ref2) ? b : a
      return respuesta(u.pathname.endsWith('/index.json') ? indice([c]) : c)
    })
    for (const seleccionDoble of [seleccion + ',500:' + ref2, '500:' + ref2 + ',' + seleccion]) {
      const salida = await recuperaDeportesDesdePR({ seleccion: seleccionDoble, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher })
      expect(salida.informe.apartadosRecuperados).toBe(2)
      expect(salida.competiciones[0].agenda).toEqual(b.agenda)
      expect(salida.competiciones[0].clasificacion).toEqual(a.clasificacion)
      expect(salida.competiciones[0].comprobadoEn).toBe(a.comprobadoEn)
    }
  })
  it('no arrastra a una competición nueva apartados anteriores a la fecha mínima y limita los cuerpos', async () => {
    const base = competicion(), nueva = competicion(); nueva.id = 'liga-nueva'
    nueva.clasificacion = competicion('2026-11-12T10:00:00Z').clasificacion
    const fetcher = vi.fn(async (url: RequestInfo | URL) => respuesta(String(url).includes('/pulls/') ? propuesta() : String(url).endsWith('/index.json') ? indice([nueva]) : nueva))
    const salida = await recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher })
    expect(salida.informe.competicionesNuevas).toBe(1)
    expect(salida.competiciones.find(c => c.id === nueva.id)?.clasificacion).toMatchObject({ estado: 'no_disponible', tablas: [] })
    expect(salida.competiciones.find(c => c.id === nueva.id)?.clasificacion.verificadoEn).toBeUndefined()
    const enorme = vi.fn(async () => new Response(' '.repeat(1024 * 1024 + 1)))
    await expect(recuperaDeportesDesdePR({ seleccion, desde, indiceAnterior: indice([base]), anteriores: [base], ahora, fetcher: enorme })).rejects.toThrow(/demasiado grande/)
    expect(enorme).toHaveBeenCalledTimes(1)
  })
})
