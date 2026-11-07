import { describe, expect, it } from 'vitest'
import { interpretaRangoMotor, interpretaCalendarioFormula, interpretaSesionesFormula, interpretaClasificacionMotor, interpretaClasificacionAcademy, interpretaCalendarioAcademy, interpretaCalendarioEspanaMotor, interpretaCalendarioRfeda, interpretaEmisionMotor, obtieneMotor } from '../scripts/lib/deportes-motor.mjs'

// Fragmentos mínimos de las estructuras públicas comprobadas el 7/11/2026.
// Conservan los campos con significado deportivo y omiten imágenes y seguimiento.
const ahora = Date.parse('2026-11-07T10:00:00Z')
const rsc = (datos: Record<string, unknown>) => `<script>self.__next_f.push(${JSON.stringify([1, `1:${JSON.stringify({ url: '/en/racing/2026/melbourne', ...datos })}\n`])})</script>`
const next = (datos: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { pageData: datos } } })}</script>`
const ronda = { id: 'formula-2-melbourne', nombre: 'Melbourne', lugar: 'Melbourne', fecha: '2026-03-06', finFecha: '2026-03-08', jornada: 'Ronda 1', fuenteUrl: 'https://www.fiaformula2.com/en/racing/2026/melbourne', ganadores: { 'Sprint Race': 'J. Dürksen', 'Feature Race': 'N. Tsolov' } }
const sesion = { session: 'Race 1', shortName: 'Sprint Race', startTime: '2026-03-07T14:10:00', gmtOffset: '+11:00', state: 'completed', meetingSessionKey: 11475 }

describe('límites de las fuentes de motor', () => {
  it('no reintenta un HTTP 429 ni inicia nuevas rondas del dominio limitado', async () => {
    const llamadas = new Map<string, number>()
    const calendario = Array.from({ length: 6 }, (_, i) => `<a href="/en/racing/2026/ronda-${i}"><span>ROUND ${i + 1}</span><span>06 - 08 Nov</span><p>Ronda ${i + 1}</p></a>`).join('')
    const fetcher = (async (url: string | URL | Request) => {
      const u = String(url); llamadas.set(u, (llamadas.get(u) || 0) + 1)
      if (u === 'https://www.formula1.com/en/racing/2026') return new Response(calendario)
      if (u.startsWith('https://www.formula1.com/en/racing/2026/')) return new Response('Límite de consultas', { status: 429, headers: { 'Retry-After': '3600' } })
      return new Response('No disponible', { status: 404 })
    }) as typeof fetch
    const r = await obtieneMotor({ fetcher, ahora })
    const rondas = [...llamadas].filter(([u]) => u.startsWith('https://www.formula1.com/en/racing/2026/'))
    expect(rondas.length).toBeLessThanOrEqual(3)
    expect(rondas.every(([, n]) => n === 1)).toBe(true)
    expect(r.competiciones.find(c => c.id === 'formula-1')?.agenda.eventos).toHaveLength(6)
    expect(r.incidencias.some(i => i.motivo.includes('429'))).toBe(true)
  })
})

describe('Fechas y sesiones de motor', () => {
  it('conserva los fines de semana que cambian de mes y rechaza fechas imposibles', () => {
    expect(interpretaRangoMotor('30 OCT - 01 NOV', 2026)).toEqual({ fecha: '2026-10-30', finFecha: '2026-11-01' })
    expect(interpretaRangoMotor('31 Julio – 2 Agosto', 2026)).toEqual({ fecha: '2026-07-31', finFecha: '2026-08-02' })
    expect(interpretaRangoMotor('6-8 de Noviembre', 2026)).toEqual({ fecha: '2026-11-06', finFecha: '2026-11-08' })
    expect(() => interpretaRangoMotor('30-31 Feb', 2026)).toThrow()
    expect(() => interpretaRangoMotor('8-6 Nov', 2026)).toThrow()
  })

  it('separa el número de ronda del día pegado en el HTML y deduplica tarjetas', () => {
    const tarjeta = '<div><span>ROUND 1</span><span>06 - 08 Mar</span><span><a href="/en/racing/2026/melbourne">Melbourne</a></span><div><div>Sprint Race</div><div>J. Dürksen</div></div></div>'
    const eventos = interpretaCalendarioFormula(tarjeta + tarjeta, 'https://www.fiaformula2.com', 2026, 'formula-2')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ jornada: 'Ronda 1', fecha: '2026-03-06', ganadores: { 'Sprint Race': 'J. Dürksen' } })
  })

  it('convierte a UTC y nunca adjudica el ganador de la principal al sprint o a la clasificación', () => {
    const html = rsc({ season: '2026', meetingSessions: [sesion, { ...sesion, session: 'Qualifying 0', shortName: 'Qualifying', meetingSessionKey: 11473 }, { ...sesion, session: 'Race 2', shortName: 'Feature Race', meetingSessionKey: 11476, results: [{ positionValue: '1', driverFirstName: 'Nikola', driverLastName: 'Tsolov' }] }] })
    const eventos = interpretaSesionesFormula(html, ronda, ahora)
    expect(eventos[0]).toMatchObject({ inicio: '2026-03-07T03:10:00.000Z', nombre: 'Melbourne · Carrera sprint', detalle: 'Primero: J. Dürksen', estado: 'finalizado' })
    expect(eventos[1].detalle).not.toContain('Tsolov')
    expect(eventos[2].detalle).toBe('Primero: Nikola Tsolov')
  })

  it('no publica como confirmadas las horas TBC ni da por finalizadas sesiones solo por su fecha', () => {
    const html = rsc({ season: '2026', meetingSessions: [{ ...sesion, sessionStatus: 'TBC', state: 'upcoming' }, { ...sesion, meetingSessionKey: 2, state: 'upcoming', gmtOffset: undefined }] })
    const eventos = interpretaSesionesFormula(html, ronda, ahora)
    expect(eventos.every(e => e.inicio === null && e.estado === 'por_confirmar')).toBe(true)
    expect(eventos[0].detalle).toContain('pendiente')
    expect(eventos.every(e => !(e.detalle || '').includes('Primero'))).toBe(true)
  })

  it('rechaza una sesión de otra temporada y no publica resultados futuros', () => {
    expect(() => interpretaSesionesFormula(rsc({ season: '2025', meetingSessions: [sesion] }), ronda, ahora)).toThrow()
    const eventos = interpretaSesionesFormula(rsc({ season: '2026', meetingSessions: [{ ...sesion, startTime: '2026-12-07T14:10:00' }] }), ronda, ahora)
    expect(eventos[0].estado).toBe('por_confirmar')
    expect(eventos[0].detalle).toBeUndefined()
    expect(() => interpretaSesionesFormula(rsc({ season: '2026', url: '/en/racing/2026/otra-ronda', meetingSessions: [sesion] }), ronda, ahora)).toThrow()
  })
})

describe('Campeonatos oficiales y cobertura limitada', () => {
  it('Academy respeta la clase de sesión, las banderas de resultados y los horarios sin confirmar', () => {
    const html = next({ SeasonName: '2026 F1 Academy', Races: [{ RaceId: 28, RoundNumber: 6, CircuitShortName: 'Las Vegas', CircuitName: 'Las Vegas Strip', Sessions: [
      { SessionId: 1, SessionName: 'Reverse Grid Race', SessionStartTime: '2026-10-25T10:00:00-05:00', SessionResultsAvailable: true, WinnerName: 'N. Gademan' },
      { SessionId: 2, SessionName: 'Feature Race', SessionStartTime: '2026-11-21T20:00:00-08:00', SessionResultsAvailable: true, WinnerName: 'No publicar', Unconfirmed: true },
      { SessionId: 3, SessionName: 'Qualifying', SessionStartTime: '2026-10-25T10:00:00-05:00', SessionResultsAvailable: true, HideSessionResult: true, WinnerName: 'No publicar' },
    ] }] })
    const eventos = interpretaCalendarioAcademy(html, 2026, ahora)
    expect(eventos[0]).toMatchObject({ nombre: 'Las Vegas · Carrera con parrilla invertida', estado: 'finalizado', inicio: '2026-10-25T15:00:00.000Z' })
    expect(eventos[1]).toMatchObject({ estado: 'por_confirmar', inicio: null })
    expect(eventos[2].estado).toBe('por_confirmar')
    expect(JSON.stringify(eventos)).not.toContain('No publicar')
    expect(() => interpretaCalendarioAcademy(html, 2027, ahora)).toThrow()
  })

  it('F4 y Eurocup publican el fin de semana completo sin inventar horas ni resultados', () => {
    const html = '<h1>Calendario 2026</h1><a href="https://eurocup3.org/es/round/2026_barcelona/"><span class="round-number">R8</span><p class="date">6-8 de Noviembre</p><h4>Montmeló</h4></a>'
    const eventos = interpretaCalendarioEspanaMotor(html, 'eurocup-3', 2026, ahora)
    expect(eventos[0]).toMatchObject({ fecha: '2026-11-06', finFecha: '2026-11-08', estado: 'programado', jornada: 'Ronda 8' })
    expect(eventos[0].inicio).toBeUndefined()
    expect(eventos[0].resultado).toBeUndefined()
    expect(() => interpretaCalendarioEspanaMotor(html.replace('Calendario 2026', 'Calendario 2025') + '<footer>2026</footer>', 'eurocup-3', 2026, ahora)).toThrow(/temporada/)
    expect(() => interpretaCalendarioEspanaMotor(html.replace('/round/2026_', '/round/2025_'), 'eurocup-3', 2026, ahora)).toThrow(/temporada/)
  })

  it('RFEDA no convierte las 12:00 ficticias ni el 31/12 de una prueba aplazada en citas', () => {
    const eventos = [
      { type: 'event', id: 1, title: 'GB3 - Barcelona', date: '2026-11-07T12:00:00+01:00', endDate: '2026-11-08T12:00:00+01:00', allDay: 1, url: 'https://calendarios.rfeda.es/todos/i/1/gb3' },
      { type: 'event', id: 2, title: 'CEM AUTOHEBDO - Ubrique (APLAZADA - Pend Nueva Fecha)', date: '2026-12-31T12:00:00+01:00', endDate: '2026-12-31T12:00:00+01:00', allDay: 1, url: 'https://calendarios.rfeda.es/todos/i/2/ubrique' },
    ]
    const html = `<script id="gb-app-state">${JSON.stringify({ fuente: { body: { seccion: eventos } } })}</script>`
    const grupos = interpretaCalendarioRfeda(html, 2026, ahora)
    expect(grupos[0].eventos[0]).toMatchObject({ fecha: '2026-11-07', finFecha: '2026-11-08', estado: 'programado' })
    expect(grupos[0].eventos[0].inicio).toBeUndefined()
    expect(grupos[1].eventos[0].estado).toBe('aplazado')
    expect(grupos[1].eventos[0].fecha).toBeUndefined()
  })

  it('no duplica el nombre abreviado de F1 en la clasificación ni acepta páginas vacías', () => {
    const tabla = '<h1>2026 DRIVERS STANDINGS</h1><table>' + ['Kimi', 'Max', 'Lewis'].map((n, i) => `<tr><td>${i + 1}</td><td><span>${n}</span> <span>Apellido</span><span class="md:hidden">ABC</span></td><td>ESP</td><td>Equipo</td><td>${30 - i}</td></tr>`).join('') + '</table>'
    const filas = interpretaClasificacionMotor(tabla, 'formula-1', 2026)[0].filas
    expect(filas[0]).toMatchObject({ nombre: 'Kimi Apellido', valores: { puntos: 30, equipo: 'Equipo' } })
    expect(() => interpretaClasificacionMotor('<table></table>', 'formula-1', 2026)).toThrow()
    expect(() => interpretaClasificacionMotor(tabla, 'formula-1', 2027)).toThrow()
    expect(() => interpretaClasificacionMotor(tabla.replace('2026 DRIVERS', '2025 DRIVERS') + '<footer>2026</footer>', 'formula-1', 2026)).toThrow(/temporada/)
  })

  it('F2 y F3 comprueban la temporada de las rondas de su tabla, no la del menú', () => {
    const tabla = '<nav><a href="/en/racing/2026">2026</a></nav><table><thead><tr><th><a href="/en/racing/2025/melbourne">Melbourne</a></th></tr></thead><tbody>' + ['Piloto A', 'Piloto B', 'Piloto C'].map((n, i) => `<tr><td><span>${i + 1}</span><span>${n}</span></td><td>${10 - i}</td></tr>`).join('') + '</tbody></table>'
    for (const tipo of ['formula-2', 'formula-3']) {
      expect(() => interpretaClasificacionMotor(tabla, tipo, 2026)).toThrow(/temporada/)
      expect(interpretaClasificacionMotor(tabla.replace('/en/racing/2025/', '/en/racing/2026/'), tipo, 2026)[0].filas).toHaveLength(3)
    }
  })

  it('conserva a una invitada oficial sin inventar un equipo ni descartar la clasificación de Academy', () => {
    const tabla = next({ Season: '2026 F1 Academy', Standings: ['Alisha Palmowski', 'Nina Gademan', 'Luna Fluxa Cross (WCD)'].map((nombre, i) => ({ Position: i + 1, FullName: nombre, TotalPoints: i === 2 ? 0 : 100, TeamName: i === 2 ? '' : 'Equipo oficial' })) })
    const filas = interpretaClasificacionAcademy(tabla, 2026)[0].filas
    expect(filas[2]).toMatchObject({ nombre: 'Luna Fluxa Cross (WCD)', valores: { puntos: 0, equipo: 'No publicado' } })
  })

  it('verifica territorio y cobertura antes de anunciar dónde verlo', () => {
    const tv = '<table><tr><td>Portugal</td><td><a href="https://www.dazn.com/pt-PT/schedule">DAZN</a></td></tr><tr><td>Spain and Andorra</td><td><a href="https://www.dazn.com/en-ES/schedule">DAZN</a></td></tr></table>'
    expect(interpretaEmisionMotor(tv, 'formula-1', 2026, new Date(ahora).toISOString()).url).toBe('https://www.dazn.com/en-ES/schedule')
    expect(() => interpretaEmisionMotor(tv.replace('Spain and Andorra', 'France'), 'formula-1', 2026, new Date(ahora).toISOString())).toThrow()
    const academia = '<p>The 2026 F1 ACADEMY season. Fans across all regions can stream Qualifying and the Races</p><a href="https://www.youtube.com/@f1academy">YouTube</a>'
    expect(interpretaEmisionMotor(academia, 'f1-academy', 2026, new Date(ahora).toISOString()).territorio).toBe('España')
    expect(() => interpretaEmisionMotor(academia, 'f1-academy', 2027, new Date(ahora).toISOString())).toThrow()
  })

  it('una caída completa de fuentes mantiene los bloques honestamente sin verificar', async () => {
    const salida = await obtieneMotor({ ahora, fetcher: async () => new Response('Fallo', { status: 503 }) })
    expect(salida.competiciones).toHaveLength(6)
    expect(salida.competiciones.every(c => c.agenda.estado === 'no_disponible' && c.clasificacion.estado === 'no_disponible')).toBe(true)
    expect(salida.incidencias.length).toBeGreaterThanOrEqual(7)
    expect(JSON.stringify(salida.competiciones)).not.toContain('verificadoEn')
  })

  it.each([false, true])('aísla fallos de una ronda y reintenta solo los transitorios (permanente: %s)', async permanente => {
    let intentos = 0
    const calendario = '<a href="/en/racing/2026/melbourne"><span>ROUND 1</span><span>06 - 08 Mar</span><p>Melbourne</p></a>'
    const clasificacion = '<h1>2026 DRIVERS STANDINGS</h1><table>' + ['Piloto A', 'Piloto B', 'Piloto C'].map((n, i) => `<tr><td>${i + 1}</td><td>${n}</td><td>ESP</td><td>Equipo</td><td>${10 - i}</td></tr>`).join('') + '</table>'
    const salida = await obtieneMotor({ ahora, fetcher: async input => {
      const url = String(input)
      if (url === 'https://www.formula1.com/en/racing/2026') return new Response(calendario)
      if (url === 'https://www.formula1.com/en/results/2026/drivers') return new Response(clasificacion)
      if (url === 'https://www.formula1.com/en/racing/2026/melbourne') {
        intentos++
        return permanente ? new Response('No existe', { status: 404 }) : intentos === 1 ? new Response('Temporal', { status: 503 }) : new Response(rsc({ season: '2026', meetingSessions: [sesion] }))
      }
      return new Response('No disponible', { status: 404 })
    } })
    const f1 = salida.competiciones.find(c => c.id === 'formula-1')!
    expect(f1.clasificacion.estado).toBe('actualizado')
    expect(f1.clasificacion.tablas[0].filas).toHaveLength(3)
    expect(f1.agenda.estado).toBe('actualizado')
    expect(intentos).toBe(permanente ? 1 : 2)
    expect(f1.agenda.eventos[0].estado).toBe(permanente ? 'por_confirmar' : 'finalizado')
    if (permanente) {
      expect(f1.agenda.eventos[0].inicio).toBeUndefined()
      expect(f1.agenda.eventos[0].finFecha).toBe('2026-03-08')
      expect(f1.agenda.aviso).toContain('algunas sesiones')
    }
  })
})
