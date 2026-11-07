import { describe, expect, it } from 'vitest'
import { configuracionPublicaFormula, urlResultadoFormula, interpretaResultadoFormula, interpretaResultadoF1Html, interpretaResultadosAcademy, interpretaEquiposFormula, interpretaEquiposAcademy, interpretaRondaEspanaMotor } from '../scripts/lib/deportes-motor-resultados.mjs'
import type { EventoDeportivo } from '../scripts/lib/deportes.mjs'

const sello = '2026-11-07T10:00:00.000Z', ahora = Date.parse(sello), fuente = 'https://www.fiaformula2.com/en/racing/2026/baku'
// Estructuras mínimas de respuestas oficiales comprobadas el 7/11/2026.
const sesion = { session: 'Practice 0', startTime: '2026-09-24T10:00:00', gmtOffset: '+04:00', sessionType: 'Practice', sessionNumber: 0 }
const fila = { displayPosition: '1', driverFirstName: 'Rafael', driverLastName: 'Câmara', racingNumber: '1', lapsCompleted: '18', classifiedTime: '1:53.747', teamName: 'Invicta Racing', completionStatusCode: 'OK' }
const next = (datos: unknown) => `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { pageData: datos } } })}</script>`
const tablaHtml = (headers: string[], filas: string[][]) => `<table><thead><tr>${headers.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`

describe('Resultados completos y sesión exacta', () => {
  it('rechaza la carrera principal cuando se está leyendo el sprint o la clasificación', () => {
    expect(() => interpretaResultadoFormula({ ...sesion, session: 'Race 2', results: [fila] }, sesion, fuente, sello)).toThrow('otra sesión')
    expect(() => interpretaResultadoFormula({ ...sesion, startTime: '2025-09-24T10:00:00', results: [fila] }, sesion, fuente, sello)).toThrow('otra sesión')
    expect(() => interpretaResultadoFormula({ ...sesion, gmtOffset: '+03:00', results: [fila] }, sesion, fuente, sello)).toThrow('otra sesión')
  })
  it('conserva no clasificados sin inventar una posición y omite puntos inexistentes', () => {
    const tabla = interpretaResultadoFormula({ ...sesion, results: [fila, { ...fila, driverFirstName: 'Otro', displayPosition: 'NC' }] }, sesion, fuente, sello)
    expect(tabla.filas[1].posicion).toBeNull()
    expect(tabla.filas[0].valores.tiempo).toBe('1:53.747')
    expect(tabla.columnas.some(c => c.clave === 'puntos')).toBe(false)
    expect(() => interpretaResultadoFormula({ ...sesion, results: [fila, fila] }, sesion, fuente, sello)).toThrow('duplicados')
  })
  it('F2 elimina solo la copia anónima idéntica, no resultados contradictorios', () => {
    const copia = { ...fila, driverFirstName: undefined, driverLastName: undefined }
    expect(interpretaResultadoFormula({ ...sesion, results: [copia, fila] }, sesion, fuente, sello).filas).toHaveLength(1)
    expect(() => interpretaResultadoFormula({ ...sesion, results: [{ ...copia, lapsCompleted: '19' }, fila] }, sesion, fuente, sello)).toThrow('duplicadas')
  })
  it('lee solo configuración pública de la marca y no acepta destinos externos', () => {
    const config = { brand: { id: 'f2' }, api: { baseUrl: 'https://api.formula1.com', endpoint: { results: '/v2/core-fom-results' }, key: { public: 'public-browser-fixture' } } }
    const html = `<script>(self.__next_s=self.__next_s||[]).push(${JSON.stringify([0, { children: 'globalThis.cwpConfig=' + JSON.stringify(config), id: 'public-env' }])})</script>`
    const c = configuracionPublicaFormula(html, 'f2')
    expect(urlResultadoFormula(c, { value: 'f2/practice?meeting=1295&session=0' }, 'f2')).toContain('/f2/practice?meeting=1295&session=0')
    expect(() => configuracionPublicaFormula(html, 'f3')).toThrow()
    expect(() => urlResultadoFormula(c, { value: 'https://other.example/' }, 'f2')).toThrow()
  })
  it('F1 valida el nombre y año del gran premio y conserva tiempos de clasificación vacíos', () => {
    const titulo = 'GRAN PREMIO 2026 - QUALIFYING'
    const html = `<h1>${titulo}</h1>${tablaHtml(['Pos.', 'No.', 'Driver', 'Team', 'Q1', 'Q2', 'Q3', 'Laps'], [['NC', '44', '<span>Lewis</span> <span>Hamilton</span><span class="md:hidden">HAM</span>', 'Ferrari', '1:17.341', '', '', '4']])}`
    const t = interpretaResultadoF1Html(html, titulo, 'https://www.formula1.com/', sello)
    expect(t.filas[0]).toMatchObject({ posicion: null, nombre: 'Lewis Hamilton', valores: { q2: '—', q3: '—' } })
    expect(() => interpretaResultadoF1Html(html, 'GRAN PREMIO 2025 - QUALIFYING', fuente, sello)).toThrow('no corresponde')
    expect(() => interpretaResultadoF1Html(html.replace('Q3', 'Desconocida'), titulo, fuente, sello)).toThrow('Columnas')
  })
  it('Academy respeta temporada, sesión, provisional, ocultación y futuro', () => {
    const evento: EventoDeportivo = { id: 'f1-academy-27-223', nombre: 'Austin · Entrenamientos', estado: 'finalizado', inicio: '2026-10-22T18:25:00Z', fuenteUrl: 'https://www.f1academy.com/Racing-Series/Results?raceid=27' }
    const s = { SessionId: 223, SessionStartTime: '2026-10-22T12:25:00-06:00', SessionResultsAvailable: true, ResultsAreOfficial: false, Results: [{ DriverForename: 'Emma ', DriverSurname: 'Felbermayr', FinishPosition: 1, DisplayFinishPosition: '1', CarNumber: 5, TeamName: 'Rodin Motorsport', LapsCompleted: 17, TimeOrFinishReason: '2:08.949' }] }
    const html = (ss: unknown) => next({ SeasonName: '2026 F1 Academy', RaceId: 27, SessionResults: [ss] })
    expect(interpretaResultadosAcademy(html(s), [evento], 2026, sello, ahora).get(evento.id)?.[0].nombre).toBe('Resultado provisional')
    expect(interpretaResultadosAcademy(html({ ...s, HideSessionResult: true }), [evento], 2026, sello, ahora).size).toBe(0)
    expect(() => interpretaResultadosAcademy(html(s), [evento], 2025, sello, ahora)).toThrow()
    expect(interpretaResultadosAcademy(html({ ...s, SessionStartTime: '2026-12-01T12:00:00Z' }), [{ ...evento, inicio: null }], 2026, sello, ahora).size).toBe(0)
    expect(() => interpretaResultadosAcademy(html({ ...s, SessionStartTime: 'fecha rota' }), [{ ...evento, inicio: null }], 2026, sello, ahora)).toThrow('Fecha')
  })
})

describe('Equipos y rondas nacionales', () => {
  it('equipos son una clasificación distinta y se comprueba su año', () => {
    const h = `<h1>2026 TEAMS' STANDINGS</h1>${tablaHtml(['Pos.', 'Team', 'Pts'], [['1', 'Ferrari', '440'], ['2', 'McLaren', '380']])}`
    expect(interpretaEquiposFormula(h, 'formula-1', 2026)).toMatchObject({ id: 'equipos', filas: [{ nombre: 'Ferrari' }, { nombre: 'McLaren' }] })
    expect(() => interpretaEquiposFormula(h, 'formula-1', 2027)).toThrow('temporada')
    expect(interpretaEquiposAcademy(next({ Season: '2026', Standings: [{ Position: 1, TeamID: 3, FullName: 'Campos Racing', TotalPoints: 251 }] }), 2026).filas[0].valores.puntos).toBe(251)
  })
  const ronda: EventoDeportivo = { id: 'formula-4-navarra', nombre: 'Navarra', estado: 'por_confirmar', fecha: '2026-10-09', finFecha: '2026-10-11', fuenteUrl: 'https://f4spain.org/es/round/f4s-navarra-2026/' }
  const cabecera = '<title>F4S Navarra 2026 - F4 Spain</title><link rel="canonical" href="https://f4spain.org/round/f4s-navarra-2026/">'
  const horario = '<div class="sch-day"><h3>sábado octubre 10</h3><ul><li><div class="time"><span>11:15</span></div><span>Race 1</span></li></ul></div>'
  const resultado = '<div class="round-tabs"><ul uk-tab><li><a>Race 1</a></li></ul><div class="uk-switcher"><table class="standing-table"><thead><tr><th>Total Time</th></tr></thead><tbody><tr><td>1</td><td>40</td><td></td><td><p class="driver-name">Kasper Schormans</p><p class="team-name">MP Motorsport</p></td><td>-</td><td>-</td><td>-</td></tr></tbody></table></div></div>'
  it('publica horas textuales sin inventar zona y no presenta ganador único como clasificación completa', () => {
    const [e] = interpretaRondaEspanaMotor(cabecera + horario + resultado, ronda, 2026, sello, ahora)
    expect(e).toMatchObject({ inicio: null, fecha: '2026-10-10', estado: 'finalizado' })
    expect(e.detalle).toContain('11:15')
    expect(e.detalle).toContain('no indica la zona')
    expect(e.resultados?.[0].nombre).toContain('1 piloto')
    expect(e.resultados?.[0].filas[0].valores.tiempo).toBe('-')
    expect(() => interpretaRondaEspanaMotor((cabecera + horario).replace('octubre 10', 'noviembre 10'), ronda, 2026, sello, ahora)).toThrow('fuera')
    expect(() => interpretaRondaEspanaMotor((cabecera + horario).replace('F4S Navarra 2026', 'F4S Navarra 2025'), ronda, 2026, sello, ahora)).toThrow('temporada')
  })
})
