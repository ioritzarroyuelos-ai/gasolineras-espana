import { describe, expect, it, vi } from 'vitest'
import { ampliaEspanaAlkamel, interpretaIndiceAlkamelEspana, interpretaSesionesAlkamelEspana, interpretaResultadoAlkamelEspana, fuenteAlkamelEspana } from '../scripts/lib/deportes-motor-alkamel.mjs'
import { conservaCompeticionDeportiva, validarCompeticionDeportiva, type CompeticionDeportiva, type IncidenciaDeportes } from '../scripts/lib/deportes.mjs'

const archivos = import.meta.glob('./fixtures/deportes-motor-alkamel/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const html = archivos['./fixtures/deportes-motor-alkamel/portimao-extracto.html'], csv = archivos['./fixtures/deportes-motor-alkamel/portimao-f4-qualy2.csv']
const ahora = Date.parse('2026-11-07T19:00:00.000Z'), sello = new Date(ahora).toISOString(), anteriorSello = '2026-11-06T18:00:00.000Z'
const sesion = interpretaSesionesAlkamelEspana(html, '03_2026', '10_PORTIMAO', 2026)[0]
const tabla = interpretaResultadoAlkamelEspana(csv, sesion.sesion, sesion.fuenteUrl, anteriorSello)
function competicion(): CompeticionDeportiva { return {
  id: 'formula-4-espana', deporte: 'motor', nombre: 'Fórmula 4 España', temporada: '2026', categoria: 'Motor', zona: 'España',
  fuente: { nombre: 'Fórmula 4 España', url: 'https://f4spain.org/' }, comprobadoEn: sello,
  agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: 'https://f4spain.org/es/f4s-calendario-2026/', eventos: [{
    id: 'f4-portimao-qualifying-2', nombre: 'Portimao · Clasificación 2', fecha: '2026-06-07', inicio: null,
    estado: 'finalizado', lugar: 'Portimao', jornada: 'Ronda 2', detalle: 'Hora publicada: 09:00.',
    resultados: [{ ...tabla, nombre: 'Resultado publicado · 1 piloto identificado', fuenteUrl: 'https://f4spain.org/es/round/f4s-portimao-2026/', verificadoEn: sello, filas: tabla.filas.slice(0, 1) }],
  }] },
  clasificacion: { estado: 'no_disponible', consultado: sello, fuenteUrl: 'https://f4spain.org/', tablas: [] },
} }

describe('Alkamel: aislamiento y conservación de la tabla completa', () => {
  it('conserva las sesiones correctas de Portimao sin elegir entre Race 3 y su fichero ambiguo Race 3-2', () => {
    const informa = vi.fn(), sesiones = interpretaSesionesAlkamelEspana(html, '03_2026', '10_PORTIMAO', 2026, informa)
    expect(sesiones.map(s => s.sesion)).toEqual(['Qualifying 2'])
    expect(informa).toHaveBeenCalledTimes(1)
    const conExacto = html + `<a href="${informa.mock.calls[0][1].replace('Race%203-2.CSV', 'Race%203.CSV')}">Race 3</a>`
    expect(interpretaSesionesAlkamelEspana(conExacto, '03_2026', '10_PORTIMAO', 2026).map(s => s.sesion)).toEqual(['Qualifying 2'])
    expect(() => interpretaSesionesAlkamelEspana(html, '03_2026', '06_VALENCIA', 2026)).toThrow('otra prueba')
    expect(interpretaIndiceAlkamelEspana(html, 2026).temporada).toBe('03_2026')
  })
  it('un enlace residual de otra temporada no mezcla datos ni bloquea la sesión vigente', () => {
    const ajeno = `<a href="${sesion.fuenteUrl.replace('/03_2026/', '/02_2025/').replace('20260607', '20250607')}">Anterior</a>`
    expect(interpretaSesionesAlkamelEspana(html + ajeno, '03_2026', '10_PORTIMAO', 2026)).toEqual([sesion])
  })
  it.each(['general', 'ronda', 'csv'])('si falla %s no reemplaza la tabla completa anterior por el ganador de la web principal', async fallo => {
    const actual = competicion(), anterior = competicion(), incidencias: IncidenciaDeportes[] = []
    anterior.agenda.verificadoEn = anterior.agenda.consultado = anteriorSello
    anterior.agenda.eventos[0].resultados = [tabla]
    const portada = fallo === 'ronda' ? html.replace('Value="10_PORTIMAO" SELECTED', 'Value="10_PORTIMAO"').replace('Value="24_BARCELONA"', 'Value="24_BARCELONA" SELECTED') : html
    const leer = vi.fn(async (url: string) => { if (fallo === 'general' || url !== fuenteAlkamelEspana) throw Error('HTTP 503'); return portada })
    await ampliaEspanaAlkamel([actual], leer, 2026, ahora, sello, incidencias)
    expect(leer).toHaveBeenCalledTimes(fallo === 'general' ? 1 : 2)
    if (fallo === 'ronda') expect(leer.mock.calls[1][0]).toContain('?season=03_2026&evvent=10_PORTIMAO')
    if (fallo === 'csv') expect(leer.mock.calls[1][0]).toBe(sesion.fuenteUrl)
    expect(actual.agenda.estado).toBe('no_disponible')
    expect(() => validarCompeticionDeportiva(actual, ahora)).not.toThrow()
    const guardada = conservaCompeticionDeportiva(actual, anterior)
    expect(guardada.agenda.estado).toBe('conservado')
    expect(guardada.agenda.verificadoEn).toBe(anteriorSello)
    expect(guardada.agenda.eventos[0].resultados?.[0]).toEqual(tabla)
    expect(tabla.filas.length).toBeGreaterThan(1)
    const otraTemporada = { ...anterior, temporada: '2025' }
    expect(conservaCompeticionDeportiva(actual, otraTemporada).agenda.eventos).toEqual([])
    expect(actual.clasificacion).toEqual(competicion().clasificacion)
  })
  it('una lectura válida sustituye el resumen de un piloto por toda la tabla verificada', async () => {
    const c = competicion(), incidencias: IncidenciaDeportes[] = []
    await ampliaEspanaAlkamel([c], async url => url.endsWith('.CSV') ? csv : html, 2026, ahora, sello, incidencias)
    expect(c.agenda.estado).toBe('actualizado')
    expect(c.agenda.eventos[0].resultados?.[0].filas).toEqual(tabla.filas)
    expect(c.agenda.eventos[0].resultados?.[0].verificadoEn).toBe(sello)
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
  })
})
