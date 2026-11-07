import { describe, expect, it } from 'vitest'
import { validarCompeticionDeportiva, conservaCompeticionDeportiva, type CompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import { construyeIndiceDeportes } from '../scripts/lib/deportes-indice.mjs'
import { buildCompeticionDeportesPage, tarjetaEvento } from '../src/html/deportes'

const sello = '2026-11-07T13:00:00Z', ahora = Date.parse(sello), fuente = 'https://www.formula1.com/en/results/2026/races'
function carrera(): CompeticionDeportiva {
  return { id: 'f1', deporte: 'motor', nombre: 'Fórmula 1', temporada: '2026', categoria: 'Monoplazas', zona: 'Internacional', fuente: { nombre: 'F1', url: fuente }, comprobadoEn: sello,
    agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, eventos: [{ id: 'carrera', nombre: 'Carrera de prueba', fecha: '2026-11-07', estado: 'finalizado', resultados: [{
      id: 'resultado', nombre: 'Resultado de la carrera', fuenteUrl: fuente, verificadoEn: sello,
      columnas: [{ clave: 'estado', nombre: 'Estado' }, { clave: 'tiempo', nombre: 'Tiempo' }],
      filas: [{ posicion: 1, nombre: 'Piloto <uno>', valores: { estado: 'Clasificado', tiempo: '1:23:45' } }, { posicion: null, nombre: 'Piloto dos', valores: { estado: 'Descalificado', tiempo: '—' } }],
    }] }] }, clasificacion: { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, tablas: [] } }
}
describe('resultados completos de las carreras', () => {
  it('comprueba origen, sello y celdas de cada resultado, sin inventar posición para un descalificado', () => {
    expect(validarCompeticionDeportiva(carrera(), ahora).agenda.eventos[0].resultados![0].filas[1].posicion).toBeNull()
    for (const cambia of [
      (c: CompeticionDeportiva) => { c.agenda.eventos[0].resultados![0].fuenteUrl = 'javascript:alert(1)' },
      (c: CompeticionDeportiva) => { c.agenda.eventos[0].resultados![0].verificadoEn = '2026-11-08T13:00:00Z' },
      (c: CompeticionDeportiva) => { c.agenda.eventos[0].resultados![0].filas[0].valores = {} },
      (c: CompeticionDeportiva) => { c.agenda.eventos[0].resultados!.push(c.agenda.eventos[0].resultados![0]) },
    ]) { const c = carrera(); cambia(c); expect(() => validarCompeticionDeportiva(c, ahora)).toThrow() }
  })
  it('conserva el resultado si falla su consulta, con fecha original, pero acepta una retirada explícita', () => {
    const anterior = carrera(), nuevo = carrera()
    nuevo.agenda.consultado = nuevo.agenda.verificadoEn = '2026-11-08T13:00:00Z'
    delete nuevo.agenda.eventos[0].resultados
    const copia = conservaCompeticionDeportiva(nuevo, anterior).agenda.eventos[0].resultados![0]
    expect(copia.verificadoEn).toBe(sello); expect(copia.conservado).toBe(true)
    nuevo.agenda.eventos[0].resultados = []
    expect(conservaCompeticionDeportiva(nuevo, anterior).agenda.eventos[0].resultados).toEqual([])
    delete nuevo.agenda.eventos[0].resultados
    nuevo.temporada = '2027'
    expect(conservaCompeticionDeportiva(nuevo, anterior).agenda.eventos[0].resultados).toBeUndefined()
  })
  it('retira la tabla antigua cuando el evento vuelve a programarse o cambia de día', () => {
    const anterior = carrera()
    for (const caso of ['programado', 'futuro', 'otro-dia']) {
      const nuevo = carrera(); delete nuevo.agenda.eventos[0].resultados
      if (caso === 'programado') nuevo.agenda.eventos[0].estado = 'programado'
      if (caso === 'futuro') nuevo.agenda.eventos[0].fecha = '2026-12-01'
      if (caso === 'otro-dia') nuevo.agenda.eventos[0].fecha = '2026-11-06'
      expect(conservaCompeticionDeportiva(nuevo, anterior).agenda.eventos[0].resultados).toBeUndefined()
    }
  })
  it('mantiene la agenda ligera, enlaza el resultado y permite buscar a todos los pilotos', () => {
    const { indice, agendas } = construyeIndiceDeportes([carrera()], [], ahora)
    const e = agendas['madrid/2026-11-07'][0]
    expect(e.resultados).toBeUndefined(); expect(e.resultadosDisponibles).toBe(1)
    expect(indice.competiciones[0].participantes).toContain('Piloto dos')
    const html = tarjetaEvento(e, 'canarias')
    expect(html).toContain('?evento=carrera&amp;horario=canarias#evento-carrera')
    expect(html).not.toContain('<table>')
  })
  it('una consulta fallida de equipos conserva solo esa tabla y permite actualizar la de pilotos', () => {
    const anterior = carrera(), nuevo = carrera()
    anterior.clasificacion = { ...anterior.agenda, tablas: ['pilotos', 'equipos', 'otra-fase'].map(id => ({ id, nombre: id,
      columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: id, valores: { puntos: 10 } }],
    })) }
    nuevo.clasificacion = { estado: 'actualizado', consultado: '2026-11-08T13:00:00Z', verificadoEn: '2026-11-08T13:00:00Z', fuenteUrl: fuente,
      tablas: [{ ...anterior.clasificacion.tablas[0], filas: [{ posicion: 1, nombre: 'pilotos', valores: { puntos: 20 } }] }], tablasPendientes: ['equipos'] }
    const salida = conservaCompeticionDeportiva(nuevo, anterior)
    expect(salida.clasificacion.tablas.map(t => t.id)).toEqual(['pilotos', 'equipos'])
    expect(salida.clasificacion.tablas[0].filas[0].valores.puntos).toBe(20)
    expect(salida.clasificacion.tablas[1]).toMatchObject({ verificadoEn: sello, fuenteUrl: fuente, conservado: true })
    expect(() => validarCompeticionDeportiva(salida, Date.parse('2026-11-08T13:00:00Z'))).not.toThrow()
  })
  it('muestra resultados publicados aunque la fuente todavía no los marque como finales', () => {
    const c = carrera(); c.agenda.eventos[0].estado = 'por_confirmar'
    const url = new URL('https://sitio.example/deportes/competicion/f1?vista=resultados')
    const html = buildCompeticionDeportesPage(c, 'nonce', url.origin + url.pathname, url, 'madrid')
    expect(html).toContain('Carrera de prueba'); expect(html).toContain('Ver resultados de la sesión')
    url.searchParams.set('evento', 'carrera')
    expect(buildCompeticionDeportesPage(c, 'nonce', url.origin + url.pathname, url, 'madrid')).toContain('class="watch race-results" open')
  })
  it('el enlace abre la carrera correcta aunque no esté en la primera página y deja avanzar', () => {
    const c = carrera(), objetivo = c.agenda.eventos[0]
    c.agenda.eventos = [...Array.from({ length: 49 }, (_, i) => ({ id: 'otra-' + i, nombre: 'Otra carrera ' + i, fecha: '2026-11-08', estado: 'finalizado' as const })), objetivo]
    objetivo.resultados![0].conservado = true
    const url = new URL('https://sitio.example/deportes/competicion/f1?evento=carrera&horario=canarias')
    const html = buildCompeticionDeportesPage(c, 'nonce', url.origin + url.pathname, url, 'canarias')
    expect(html).toContain('Página 3 de 3')
    expect(html).toContain('class="watch race-results" open')
    expect(html).toContain('Piloto &lt;uno&gt;')
    expect(html).toContain('<td>—</td><th scope="row">Piloto dos')
    expect(html).toContain('Resultado comprobado: 7 nov 2026, 13:00')
    expect(html).toContain('No hemos podido actualizar este resultado')
    expect(html).toContain('?horario=canarias&amp;vista=resultados&amp;p=2#calendario')
    expect(html).not.toMatch(/\sstyle=/)
  })
})
