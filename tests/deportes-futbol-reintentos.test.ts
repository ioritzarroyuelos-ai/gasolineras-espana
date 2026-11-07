import { afterEach, describe, expect, it, vi } from 'vitest'
import { eligeReintentoNovanet, obtieneNovanet } from '../scripts/lib/deportes-futbol-novanet.mjs'
import { parseaAgendaMadrid, parseaClasificacionMadrid } from '../scripts/lib/deportes-futbol-madrid.mjs'
import { checkpointNovanet, normalizaEstadoNovanet, recuperaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'
import { conservaCompeticionDeportiva, validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import type { EstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'

const archivos = import.meta.glob('./fixtures/deportes-futbol/madrid-reintentos.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const reales = JSON.parse(Object.values(archivos)[0]).grupos
const A = '26738290', B = '26738291', C = '9001', D = '9002', E = '9003', competicion = '26738289'
const inicio = Date.parse('2026-11-07T19:10:00Z'), clave = (g: string) => competicion + '-' + g
const tablaHtml = (p: unknown) => '<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: p } }) + '</script>'
const semilla = (grupos = [A, B, C, D], grupo = 2): EstadoNovanet => normalizaEstadoNovanet({ version: 1, grupo, catalogo: { temporada: { codigo: '22', nombre: '2026-2027' }, verificadoEn: new Date(inicio).toISOString(),
  categorias: [{ codigo: competicion, nombre: 'COPA RFEF FASE AUTONÓMICA', familia: 'Fútbol', grupos: grupos.map(g => ({ codigo: g, nombre: 'Grupo ' + g })) }] } })

function fuente(opciones: { limiteGrupo?: string; retryAfter?: string; tablaVacia?: boolean } = {}) {
  const peticiones: string[] = []
  const fetcher = vi.fn(async (entrada: RequestInfo | URL) => {
    const url = new URL(String(entrada)); peticiones.push(url.href)
    const grupo = url.searchParams.get('idGroup') || url.searchParams.get('grupo') || ''
    const original = reales.find((g: { codigo: string }) => g.codigo === grupo) || reales[0]
    if (url.pathname.endsWith('/group-rounds')) return new Response(JSON.stringify(original.jornadas))
    if (url.pathname.endsWith('/results')) {
      if (grupo === opciones.limiteGrupo) return new Response('Límite', { status: 429, headers: { 'Retry-After': opciones.retryAfter ?? '3600' } })
      const datos = JSON.parse(JSON.stringify(original.agendas[url.searchParams.get('round') || '2']))
      datos.codigo_grupo = grupo
      if (![A, B].includes(grupo)) datos.partidos.forEach((p: { codacta: string }, i: number) => { p.codacta = grupo + url.searchParams.get('round') + i })
      return new Response(JSON.stringify(datos))
    }
    const p = JSON.parse(JSON.stringify(original.tabla)); p.standings.codigo_grupo = grupo
    if (opciones.tablaVacia) p.standings.clasificacion = []
    return new Response(tablaHtml(p))
  })
  return { fetcher, peticiones }
}

async function tanda(estado: EstadoNovanet, f: ReturnType<typeof fuente>, presupuesto = 10) {
  let guardado = estado
  const pendiente = obtieneNovanet({ fuentesNovanet: ['madrid'], estadoNovanet: { madrid: estado }, maxPeticionesNovanet: presupuesto, fetcher: f.fetcher,
    guardarEstadoNovanet: (_id, nuevo) => { guardado = normalizaEstadoNovanet(checkpointNovanet(nuevo)) } })
  await vi.runAllTimersAsync()
  return { salida: await pendiente, estado: guardado }
}

afterEach(() => vi.useRealTimers())
describe('reintentos de grupos fallidos con el mismo presupuesto', () => {
  it('reproduce las respuestas reales actuales de A/B sin rebajar identidad ni marcadores', () => {
    for (const g of reales) {
      const esperada = { competicion, grupo: g.codigo, temporada: '2026-2027' }
      const eventos = [2, 3].flatMap(j => parseaAgendaMadrid(JSON.stringify(g.agendas[j]), { ...esperada, jornada: String(j) }, 'https://www.rffm.es/competicion/resultados-y-jornadas'))
      expect(eventos).toHaveLength(4)
      expect(eventos.every(e => e.estado === 'finalizado' && e.resultado)).toBe(true)
      expect(parseaClasificacionMadrid(tablaHtml(g.tabla), esperada)[0].filas).toHaveLength(4)
    }
  })
  it('con diez peticiones por tanda y sesiones nuevas recupera A y B mientras avanza C y D', async () => {
    vi.useFakeTimers(); vi.setSystemTime(inicio)
    const primeraFuente = fuente(), primera = await tanda(semilla(), primeraFuente)
    expect(primera.salida.competiciones.map(c => c.id)).toEqual([`novanet-madrid-${C}`, `novanet-madrid-${A}`])
    expect(primera.estado.grupo).toBe(3)
    expect(primeraFuente.peticiones).toHaveLength(8)
    expect(primera.estado.ventana.peticiones).toBe(8)
    vi.setSystemTime(inicio + 3605000)
    const segundaFuente = fuente(), segunda = await tanda(primera.estado, segundaFuente)
    expect(segunda.salida.competiciones.map(c => c.id)).toEqual([`novanet-madrid-${D}`, `novanet-madrid-${B}`])
    expect(segunda.estado.grupo).toBe(0)
    expect(segundaFuente.peticiones).toHaveLength(8)
    expect(segunda.estado.ventana.peticiones).toBe(8)
    expect(segunda.estado.intentos?.[clave(A)].fallo).toBe(false)
    expect(segunda.estado.intentos?.[clave(B)].fallo).toBe(false)
    for (const c of [...primera.salida.competiciones, ...segunda.salida.competiciones]) expect(() => validarCompeticionDeportiva(c, inicio + 3605000)).not.toThrow()
  })
  it('no duplica un grupo fallido que se recupera desde el cursor normal', async () => {
    vi.useFakeTimers(); vi.setSystemTime(inicio)
    const estado = semilla([A], 0)
    estado.intentos = { [clave(A)]: { fecha: new Date(inicio - 7200000).toISOString(), fallo: true } }
    const f = fuente(), r = await tanda(estado, f)
    expect(r.salida.competiciones.map(c => c.id)).toEqual([`novanet-madrid-${A}`])
    expect(f.peticiones).toHaveLength(4)
    expect(r.estado.intentos?.[clave(A)].fallo).toBe(false)
  })
  it('una pausa durante el reintento mantiene el cursor normal y lo retoma tras el descanso', async () => {
    vi.useFakeTimers(); vi.setSystemTime(inicio)
    const estado = semilla([A, B, C, D, E]); estado.verificados[clave(B)] = new Date(inicio - 7200000).toISOString()
    const primeraFuente = fuente({ limiteGrupo: A }), primera = await tanda(estado, primeraFuente)
    expect(primeraFuente.peticiones).toHaveLength(6)
    expect(primera.estado.grupo).toBe(3)
    expect(primera.estado.intentos?.[clave(A)].fallo).toBe(true)
    expect(primera.estado.noConsultarAntes).toBeTruthy()
    const pausaFuente = fuente(), pausa = await tanda(primera.estado, pausaFuente)
    expect(pausaFuente.peticiones).toHaveLength(0)
    expect(pausa.estado.grupo).toBe(3)
    vi.setSystemTime(inicio + 3610000)
    const ultimaFuente = fuente(), ultima = await tanda(primera.estado, ultimaFuente)
    expect(ultima.salida.competiciones.map(c => c.id)).toEqual([`novanet-madrid-${D}`, `novanet-madrid-${A}`])
    expect(ultima.estado.grupo).toBe(4)
    expect(ultimaFuente.peticiones).toHaveLength(8)
    expect(ultima.estado.intentos?.[clave(A)].fallo).toBe(false)
  })
  it('no repite un fallo en menos de una hora ni toma categorías aún pendientes de redescubrimiento', () => {
    const estado = semilla()
    estado.intentos = { [clave(A)]: { fecha: new Date(inicio - 1000).toISOString(), fallo: true }, [clave(B)]: { fecha: new Date(inicio - 1000).toISOString(), fallo: false } }
    expect(eligeReintentoNovanet('madrid', estado, inicio)).toBeNull()
    expect(eligeReintentoNovanet('madrid', estado, inicio + 3600000)).toEqual({ categoria: 0, grupo: 0 })
    expect(eligeReintentoNovanet('madrid', estado, inicio + 3600000, [`novanet-madrid-${A}`])).toBeNull()
    estado.catalogo!.categorias[0].gruposPendientes = true
    expect(eligeReintentoNovanet('madrid', estado, inicio + 3600000)).toBeNull()
  })
  it.each(['999999999999999', '9'.repeat(400)])('un Retry-After desbordado guarda una hora de pausa y bloquea la siguiente tanda (%s)', async retryAfter => {
    vi.useFakeTimers(); vi.setSystemTime(inicio)
    const f = fuente({ limiteGrupo: A, retryAfter }), r = await tanda(semilla([A], 0), f)
    expect(f.peticiones).toHaveLength(2)
    expect(Date.parse(r.estado.noConsultarAntes!) - Date.parse(r.estado.intentos![clave(A)].fecha)).toBe(3601000)
    expect(r.estado.ventana.peticiones).toBe(2)
    expect(r.estado.intentos?.[clave(A)].fallo).toBe(true)
    expect(r.salida.incidencias.some(i => i.motivo.includes('se respeta su descanso'))).toBe(true)
    const siguiente = fuente(), pausada = await tanda(r.estado, siguiente)
    expect(siguiente.peticiones).toHaveLength(0)
    expect(pausada.estado.noConsultarAntes).toBe(r.estado.noConsultarAntes)
    expect(pausada.estado.ventana.peticiones).toBe(2)
  })
  it('reanuda una cuota agotada y ya expirada sin saltarse una pausa más larga', async () => {
    vi.useFakeTimers(); vi.setSystemTime(inicio)
    const estado = semilla([A], 0)
    estado.ventana = { desde: new Date(inicio - 7200000).toISOString(), peticiones: 120 }
    estado.noConsultarAntes = new Date(inicio + 3600000).toISOString()
    const bloqueada = fuente(); await tanda(estado, bloqueada)
    expect(bloqueada.peticiones).toHaveLength(0)
    vi.setSystemTime(inicio + 3600001)
    const f = fuente(), r = await tanda(estado, f)
    expect(f.peticiones).toHaveLength(4)
    expect(r.estado.ventana.peticiones).toBe(4)
  })
  it('la tabla vacía válida no borra una copia buena ni genera un fallo que se reintente siempre', async () => {
    vi.useFakeTimers(); vi.setSystemTime(inicio)
    const estado = semilla([A], 0), completa = await tanda(estado, fuente())
    vi.setSystemTime(inicio + 3605000)
    const vacia = await tanda(completa.estado, fuente({ tablaVacia: true }))
    expect(vacia.salida.competiciones[0].clasificacion).toMatchObject({ estado: 'no_disponible', tablas: [] })
    expect(vacia.salida.competiciones[0].clasificacion.verificadoEn).toBeUndefined()
    expect(vacia.estado.intentos?.[clave(A)].fallo).toBe(false)
    expect(vacia.salida.incidencias.filter(i => i.id === `novanet-madrid-${A}`)).toHaveLength(0)
    const conservada = conservaCompeticionDeportiva(vacia.salida.competiciones[0], completa.salida.competiciones[0])
    expect(conservada.clasificacion.estado).toBe('conservado')
    expect(conservada.clasificacion.tablas[0].filas).toHaveLength(4)
  })
  it('persiste sólo intentos de grupos conocidos y poda los retirados con el catálogo confirmado', () => {
    const estado = semilla(), marca = { fecha: new Date(inicio).toISOString(), fallo: true }
    const guardado = recuperaEstadoNovanet([checkpointNovanet({ ...estado, intentos: { [clave(A)]: marca, '999-999': marca, [clave(B)]: { ...marca, fallo: 'texto' } } }, inicio)])
    expect(guardado.intentos).toEqual({ [clave(A)]: marca })
    guardado.catalogo!.categorias[0].grupos = [{ codigo: B, nombre: 'B' }]
    expect(normalizaEstadoNovanet(guardado).intentos).toEqual({})
  })
})
