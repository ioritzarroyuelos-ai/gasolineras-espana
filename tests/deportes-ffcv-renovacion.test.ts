import { describe, expect, it, vi } from 'vitest'
import { capacidadActualizacionFFCV, creaEstadoFFCV, eligeActualizacionFFCV, obtieneFFCV } from '../scripts/lib/deportes-futbol.mjs'
import { checkpointFFCV, recuperaEstadoFFCV } from '../scripts/lib/deportes-checkpoint.mjs'

const ahora = Date.parse('2026-11-10T18:00:00Z'), antigua = '2026-11-08T10:00:00.000Z'
const fixtures = import.meta.glob('./fixtures/deportes-futbol/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (nombre: string) => fixtures[`./fixtures/deportes-futbol/${nombre}`]
const semilla = (cantidad = 8) => creaEstadoFFCV([{ codigo: '905431604', nombre: 'Liga regional', visible_clasificacion: '1',
  grupos: Array.from({ length: cantidad }, (_, i) => ({ codigo: String(1000 + i), nombre: 'Grupo ' + i, ver_clasificacion: '1' })) }],
{ cod_temporada: '22', nombre: '2026-2027' }, new Date(ahora).toISOString())
const publicados = (cantidad: number) => Array.from({ length: cantidad }, (_, i) => 'ffcv-' + (1000 + i))
const fechas = (cantidad: number) => Object.fromEntries(publicados(cantidad).map(id => [id, antigua]))

function respuesta(entrada: RequestInfo | URL) {
  const url = new URL(String(entrada))
  if (!url.pathname.includes('/api/')) return new Response('<meta name="ffcv-pt" content="publica">', { headers: { 'Set-Cookie': 'sesion=publica; Path=/' } })
  if (url.pathname.includes('jornadas_fetch')) return new Response(JSON.stringify({ jornadas: [{ codjornada: '9', fecha_jornada: '01-11-2026' }, { codjornada: '10', fecha_jornada: '08-11-2026' }] }))
  if (url.pathname.includes('clasificaciones_ajax')) {
    const tabla = JSON.parse(fixture('ffcv-clasificacion.json'))
    tabla.codigo_grupo = url.searchParams.get('cod_grupo')
    return new Response(JSON.stringify(tabla))
  }
  return new Response(fixture(url.searchParams.get('cod_jornada') === '9' ? 'ffcv-finalizados.json' : 'ffcv-pendientes.json'))
}

describe('renovación diaria de los grupos FFCV publicados', () => {
  it('reserva la última plaza para un descubrimiento y conserva su cursor al consumir presupuesto', async () => {
    let estado = semilla(), reloj = ahora
    estado.cursor = 7; estado.ventana = { desde: new Date(ahora).toISOString(), peticiones: 95 }
    const orden: string[] = []
    const fetcher = vi.fn(async (u: RequestInfo | URL) => { if (String(u).includes('jornadas_fetch')) orden.push(new URL(String(u)).searchParams.get('cod_grupo')!); return respuesta(u) })
    await obtieneFFCV({ estadoFFCV: estado, gruposPublicadosFutbol: publicados(7), fechasPublicadasFutbol: fechas(7), ahora, relojFFCV: () => reloj,
      duermeFFCV: async ms => { reloj += ms }, guardarEstadoFFCV: e => { estado = e }, fetcher })
    expect(orden).toEqual(['1000', '1001', '1002', '1003', '1004', '1007'])
    expect(estado.cursor).toBe(0)
    expect(fetcher).toHaveBeenCalledTimes(25)
    expect(estado.ventana.peticiones).toBe(120)
    expect(estado.catalogo?.verificadoEn).toBe(new Date(ahora).toISOString())
  })

  it('un fallo no cambia su fecha verificada ni se repite durante una hora, tampoco por el cursor normal', async () => {
    let estado = semilla(1), reloj = ahora
    estado.verificados['1000'] = antigua
    const fetcher = vi.fn(async (u: RequestInfo | URL) => String(u).includes('/api/') ? new Response('Fallo temporal', { status: 503 }) : respuesta(u))
    const opciones = () => ({ estadoFFCV: estado, gruposPublicadosFutbol: publicados(1), fechasPublicadasFutbol: fechas(1), ahora: reloj,
      relojFFCV: () => reloj, duermeFFCV: async (ms: number) => { reloj += ms }, guardarEstadoFFCV: (e: typeof estado) => { estado = e }, fetcher })
    const salida = await obtieneFFCV(opciones())
    expect(salida.competiciones).toEqual([])
    expect(estado.verificados['1000']).toBe(antigua)
    expect(estado.intentos['1000']).toBeTruthy()
    const previas = fetcher.mock.calls.filter(c => String(c[0]).includes('/api/')).length
    reloj += 1800000
    await obtieneFFCV(opciones())
    expect(fetcher.mock.calls.filter(c => String(c[0]).includes('/api/'))).toHaveLength(previas)
    reloj += 1801000
    await obtieneFFCV(opciones())
    expect(fetcher.mock.calls.filter(c => String(c[0]).includes('/api/')).length).toBeGreaterThan(previas)
  })

  it('usa el bloque publicado más antiguo y desplaza un fallo repetido detrás de los pendientes', () => {
    const estado = semilla(3)
    estado.verificados = { '1000': new Date(ahora).toISOString(), '1001': antigua, '1002': antigua }
    estado.intentos['1000'] = new Date(ahora - 3601000).toISOString()
    const opciones = { publicados: publicados(3), fechas: { ...fechas(3), 'ffcv-1000': '2026-11-01T10:00:00Z' } }
    expect(eligeActualizacionFFCV(estado, ahora, opciones)?.grupo.codigo).toBe('1001')
    expect(eligeActualizacionFFCV(estado, ahora, { ...opciones, visitados: ['1001', '1002'] })?.grupo.codigo).toBe('1000')
  })

  it.each([{ cantidad: 558, pasadas: 20 }, { cantidad: 667, pasadas: 23 }])('renueva $cantidad publicados en $pasadas pasadas útiles respetando120consultas, aunque el primero falle siempre', async ({ cantidad, pasadas }) => {
    let estado = semilla(667), reloj = ahora
    estado.cursor = 600
    const marcas = fechas(cantidad), renovados = new Set<string>()
    for (let pasada = 0; pasada < pasadas; pasada++) {
      reloj = ahora + pasada * 3601000
      const fetcher = vi.fn(async (u: RequestInfo | URL) => new URL(String(u)).searchParams.get('cod_grupo') === '1000' ? new Response('Fallo temporal', { status: 503 }) : respuesta(u))
      const salida = await obtieneFFCV({ estadoFFCV: estado, gruposPublicadosFutbol: publicados(cantidad), fechasPublicadasFutbol: marcas, ahora: reloj,
        relojFFCV: () => reloj, duermeFFCV: async ms => { reloj += ms }, guardarEstadoFFCV: e => { estado = e }, fetcher })
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(120)
      const nuevos = fetcher.mock.calls.filter(([u]) => String(u).includes('jornadas_fetch') && !marcas['ffcv-' + new URL(String(u)).searchParams.get('cod_grupo')])
      expect(nuevos.length).toBeLessThanOrEqual(cantidad === 667 ? 0 : 1)
      for (const c of salida.competiciones) if (marcas[c.id] && c.agenda.verificadoEn && c.clasificacion.verificadoEn) {
        marcas[c.id] = [c.agenda.verificadoEn, c.clasificacion.verificadoEn].sort()[0]; renovados.add(c.id)
      }
      estado = recuperaEstadoFFCV([checkpointFFCV(estado, reloj)])
    }
    expect(renovados.size).toBe(cantidad - 1)
    expect(marcas['ffcv-1000']).toBe(antigua)
    if (cantidad < 667) expect(estado.cursor).not.toBe(600)
    expect(capacidadActualizacionFFCV(publicados(cantidad), estado.catalogo)).toMatchObject({ pasadasNecesarias: pasadas, margenHoras: 24 - pasadas })
    expect(capacidadActualizacionFFCV(publicados(697), semilla(697).catalogo).margenHoras).toBeLessThan(0)
  }, 45000) // Recorre una ronda diaria simulada; no hay red ni esperas reales.

  it('no consulta otra vez grupos recién comprobados por el cursor cuando todo el catálogo está publicado', async () => {
    let estado = semilla(35), reloj = ahora
    const fetcher = vi.fn(async (u: RequestInfo | URL) => respuesta(u))
    const salida = await obtieneFFCV({ estadoFFCV: estado, gruposPublicadosFutbol: publicados(35),
      fechasPublicadasFutbol: Object.fromEntries(publicados(35).map(id => [id, new Date(ahora - 3600000).toISOString()])),
      ahora, relojFFCV: () => reloj, duermeFFCV: async ms => { reloj += ms }, guardarEstadoFFCV: e => { estado = e }, fetcher })
    expect(salida.competiciones).toEqual([])
    expect(fetcher).toHaveBeenCalledOnce() // Sólo comprueba la sesión pública; ninguna jornada ni tabla repetida.
    expect(estado.cursor).toBe(0)
  })

  it('una respuesta429 corta la renovación, conserva el cursor y respeta el Retry-After', async () => {
    let estado = semilla(35), reloj = ahora
    estado.cursor = 34
    const fetcher = vi.fn(async (u: RequestInfo | URL) => String(u).includes('/api/') ? new Response('Esperar', { status: 429, headers: { 'Retry-After': '7200' } }) : respuesta(u))
    const opciones = () => ({ estadoFFCV: estado, gruposPublicadosFutbol: publicados(34), fechasPublicadasFutbol: fechas(34), ahora: reloj,
      relojFFCV: () => reloj, duermeFFCV: async (ms: number) => { reloj += ms }, guardarEstadoFFCV: (e: typeof estado) => { estado = e }, fetcher })
    await obtieneFFCV(opciones())
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(estado.cursor).toBe(34)
    expect(estado.motivoPausa).toBe('fuente')
    expect(Date.parse(estado.noConsultarAntes!)).toBeGreaterThanOrEqual(ahora + 7200000)
    reloj = ahora + 3601000
    await obtieneFFCV(opciones())
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('espera breve y checkpoint sin ignorar las pausas de FFCV', () => {
  it.each(['presupuesto', 'fuente', null] as const)('sólo espera los10segundos cuando la pausa es propia (%s)', async motivoPausa => {
    let reloj = ahora
    const estado = semilla(1)
    estado.ventana = { desde: new Date(ahora - 3590000).toISOString(), peticiones: 120 }
    estado.noConsultarAntes = new Date(ahora + 10000).toISOString(); estado.motivoPausa = motivoPausa
    const duerme = vi.fn(async (ms: number) => { reloj += ms }), fetcher = vi.fn(async (u: RequestInfo | URL) => respuesta(u))
    await obtieneFFCV({ estadoFFCV: estado, ahora, relojFFCV: () => reloj, duermeFFCV: duerme, fetcher })
    if (motivoPausa === 'presupuesto') { expect(duerme.mock.calls[0][0]).toBe(10000); expect(fetcher).toHaveBeenCalled() }
    else { expect(duerme).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled() }
  })

  it('no espera una pausa propia de más de15segundos y preserva los intentos recientes al recuperar un checkpoint', async () => {
    const estado = semilla(2)
    estado.noConsultarAntes = new Date(ahora + 16000).toISOString(); estado.motivoPausa = 'presupuesto'
    estado.intentos['1000'] = new Date(ahora - 30000).toISOString()
    const fetcher = vi.fn(), duerme = vi.fn()
    await obtieneFFCV({ estadoFFCV: estado, relojFFCV: () => ahora, fetcher, duermeFFCV: duerme })
    expect(fetcher).not.toHaveBeenCalled(); expect(duerme).not.toHaveBeenCalled()
    const copia = checkpointFFCV(estado, ahora), otra = checkpointFFCV({ ...estado, cursor: 1, intentos: {} }, ahora + 1)
    otra.motivoPausa = 'fuente'
    const restaurado = recuperaEstadoFFCV([copia, otra])
    expect(restaurado.cursor).toBe(1)
    expect(restaurado.intentos['1000']).toBe(estado.intentos['1000'])
    expect(restaurado.motivoPausa).toBe('fuente')
    expect(recuperaEstadoFFCV([copia], copia.noConsultarAntes!).motivoPausa).toBe('fuente')
  })
})
