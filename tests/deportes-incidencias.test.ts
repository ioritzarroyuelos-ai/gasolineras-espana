import { describe, expect, it, vi } from 'vitest'
import { conservaIncidenciasGrupos, conservaGrupoFueraDeTanda } from '../scripts/lib/deportes-incidencias.mjs'
import { idGrupoNovanet, obtieneNovanet } from '../scripts/lib/deportes-futbol-novanet.mjs'
import { normalizaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'
import type { CompeticionDeportiva, IncidenciaDeportes } from '../scripts/lib/deportes.mjs'

const archivos = import.meta.glob('./fixtures/deportes-futbol/avisos-madrid-207-209.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const real = JSON.parse(Object.values(archivos)[0])
const aviso = (id: string, motivo = 'Lectura pendiente'): IncidenciaDeportes => ({ deporte: 'futbol', nombre: 'Grupo', fuenteUrl: 'https://www.rffm.es/competicion/resultados-y-jornadas', motivo, id })

describe('avisos de grupos que se actualizan por tandas', () => {
  const fuenteUrl = 'https://www.rffm.es/competicion/resultados-y-jornadas'
  const anterior: CompeticionDeportiva = { id: 'grupo-publicado', deporte: 'futbol', nombre: 'Copa de prueba', temporada: '2026-2027', categoria: 'Fútbol', zona: 'Madrid',
    fuente: { nombre: 'RFFM', url: fuenteUrl }, comprobadoEn: '2026-11-09T08:00:00Z', agenda: {
      estado: 'actualizado', fuenteUrl, consultado: '2026-11-09T08:00:00Z', verificadoEn: '2026-11-09T08:00:00Z', eventos: [{ id: 'partido', nombre: 'A–B', estado: 'programado' }],
    }, clasificacion: { estado: 'no_disponible', fuenteUrl, consultado: '2026-11-09T08:00:00Z', tablas: [], aviso: 'Eliminatorias' } }
  it('deja literalmente intacta una competición omitida por cupo, sin inventar consulta ni fallo', () => {
    const copia = conservaGrupoFueraDeTanda(anterior, '2026-11-10T10:00:00Z', new Set(['otro-grupo']))
    expect(copia).toBe(anterior)
    expect(copia.agenda.estado).toBe('actualizado')
    expect(copia.agenda.consultado).toBe('2026-11-09T08:00:00Z')
  })
  it('señala un intento fallido real sin rejuvenecer la última verificación ni borrar datos', () => {
    const copia = conservaGrupoFueraDeTanda(anterior, '2026-11-10T10:00:00Z', new Set([anterior.id]))
    expect(copia.agenda).toMatchObject({ estado: 'conservado', consultado: '2026-11-10T10:00:00Z', verificadoEn: anterior.agenda.verificadoEn, eventos: anterior.agenda.eventos })
    expect(copia.clasificacion.estado).toBe('no_disponible')
    expect(anterior.agenda.estado).toBe('actualizado')
  })
  it('reproduce 207→209 conservando los cuatro avisos A/B y sustituyendo el progreso', async () => {
    const fetcher = vi.fn(async () => { throw Error('Esta comprobación no permite red') })
    const estado = normalizaEstadoNovanet(real.pr209.estado)
    const r = await obtieneNovanet({ estadoNovanet: { madrid: estado }, fuentesNovanet: ['madrid'], maxPeticionesNovanet: 0, fetcher })
    const revisados = estado.catalogo!.categorias.flatMap(c => (c.grupos || []).filter(g => estado.verificados[c.codigo + '-' + g.codigo]).map(g => idGrupoNovanet('madrid', c, g)))
    expect(revisados).toEqual(['novanet-madrid-27326802', 'rfef-tercera-masculina-7'])
    const salida = conservaIncidenciasGrupos(real.pr207.incidencias, real.pr209.incidencias, { conocidos: r.seguimientoGrupos!.conocidos, revisados })
    expect(salida.filter(i => ['novanet-madrid-26738290', 'novanet-madrid-26738291'].includes(i.id || ''))).toEqual(real.pr207.incidencias.slice(0, 4))
    expect(salida.filter(i => i.id === 'novanet-madrid-progreso')).toEqual(real.pr209.incidencias.filter((i: IncidenciaDeportes) => i.id === 'novanet-madrid-progreso'))
    expect(salida).toHaveLength(6)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('borra el aviso al revisar el grupo y conserva sólo el error nuevo si vuelve a fallar', () => {
    const id = 'rfef-tercera-masculina-7', previo = aviso(id), nuevo = aviso(id, 'Nueva respuesta no válida')
    const seguimiento = { conocidos: [id], revisados: [id] }
    expect(conservaIncidenciasGrupos([previo], [], seguimiento)).toEqual([])
    expect(conservaIncidenciasGrupos([previo], [nuevo], seguimiento)).toEqual([nuevo])
  })
  it('un lector principal recuperado limpia el aviso canónico aunque Novanet esté pausado', async () => {
    const estado = normalizaEstadoNovanet(real.pr209.estado), id = 'rfef-tercera-masculina-7'
    const fetcher = vi.fn(async () => { throw Error('No debe consultar el portal') })
    const r = await obtieneNovanet({ estadoNovanet: { madrid: estado }, fuentesNovanet: ['madrid'], maxPeticionesNovanet: 0, gruposCubiertosFutbol: [id], fetcher })
    expect(r.seguimientoGrupos?.conocidos).toContain(id)
    expect(r.seguimientoGrupos?.revisados).toContain(id)
    expect(conservaIncidenciasGrupos([aviso(id)], [], r.seguimientoGrupos)).toEqual([])
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('no conserva avisos genéricos, de catálogo, desconocidos ni de fuentes sin seguimiento', () => {
    const id = 'novanet-madrid-26738290'
    const anteriores = [aviso(id), aviso('novanet-madrid'), aviso('novanet-madrid-progreso'), aviso('novanet-madrid-26738289'), aviso('rfef-catalogo-26738289'), aviso('novanet-madrid-999')]
    expect(conservaIncidenciasGrupos(anteriores, [], { conocidos: [id], revisados: [] })).toEqual([anteriores[0]])
    expect(conservaIncidenciasGrupos(anteriores, [])).toEqual([])
  })
  it('una pausa a mitad de grupo conserva el aviso anterior sin duplicar errores idénticos', () => {
    const previo = aviso('novanet-madrid-26738290')
    expect(conservaIncidenciasGrupos([previo], [{ ...previo }], { conocidos: [previo.id!], revisados: [] })).toEqual([previo])
  })
})
