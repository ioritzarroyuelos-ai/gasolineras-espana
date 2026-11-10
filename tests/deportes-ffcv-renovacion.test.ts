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
  it('renueva cinco publicados antes del siguiente descubrimiento y conserva su cursor al consumir presupuesto', async () => {
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

  it('recorre los469 publicados en20pasadas útiles respetando120consultas, aunque el primer grupo falle siempre', async () => {
    let estado = semilla(667), reloj = ahora
    estado.cursor = 500
    const marcas = fechas(469), renovados = new Set<string>()
    for (let pasada = 0; pasada < 20; pasada++) {
      reloj = ahora + pasada * 3601000
      const fetcher = vi.fn(async (u: RequestInfo | URL) => new URL(String(u)).searchParams.get('cod_grupo') === '1000' ? new Response('Fallo temporal', { status: 503 }) : respuesta(u))
      const salida = await obtieneFFCV({ estadoFFCV: estado, gruposPublicadosFutbol: publicados(469), fechasPublicadasFutbol: marcas, ahora: reloj,
        relojFFCV: () => reloj, duermeFFCV: async ms => { reloj += ms }, guardarEstadoFFCV: e => { estado = e }, fetcher })
      expect(fetcher.mock.calls.length).toBeLessThanOrEqual(120)
      for (const c of salida.competiciones) if (marcas[c.id] && c.agenda.verificadoEn && c.clasificacion.verificadoEn) {
        marcas[c.id] = [c.agenda.verificadoEn, c.clasificacion.verificadoEn].sort()[0]; renovados.add(c.id)
      }
      estado = recuperaEstadoFFCV([checkpointFFCV(estado, reloj)])
    }
    expect(renovados.size).toBe(468)
    expect(marcas['ffcv-1000']).toBe(antigua)
    expect(estado.cursor).not.toBe(500)
    expect(capacidadActualizacionFFCV(publicados(469))).toMatchObject({ pasadasNecesarias: 20, margenHoras: 4 })
    expect(capacidadActualizacionFFCV(publicados(600)).margenHoras).toBeLessThan(0)
  }, 20000) // Recorre veinte horas simuladas y miles de respuestas/checkpoints; no hay red ni esperas reales.
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
