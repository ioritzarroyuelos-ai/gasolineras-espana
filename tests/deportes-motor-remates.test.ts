import { describe, expect, it } from 'vitest'
import datos from './fixtures/deportes-motor-pendientes/datos.json'
import sprint from './fixtures/deportes-motor-pendientes/ec3-sprint.json'
import { ampliaFerrari } from '../scripts/lib/deportes-motor-ferrari.mjs'
import { ampliaEspanaAlkamel, fuenteAlkamelEspana } from '../scripts/lib/deportes-motor-alkamel.mjs'
import { leerFuenteDeportiva, validarCompeticionDeportiva, type CompeticionDeportiva, type IncidenciaDeportes } from '../scripts/lib/deportes.mjs'

const sello = '2026-11-07T20:00:00.000Z', ahora = Date.parse(sello)
const competicion = (id: string): CompeticionDeportiva => ({ id, deporte: 'motor', nombre: id, temporada: '2026', categoria: 'Motor', zona: 'Europa', fuente: { nombre: 'Campeonato', url: 'https://eurocup3.org/' }, comprobadoEn: sello,
  agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: 'https://eurocup3.org/', eventos: [] },
  clasificacion: { estado: 'no_disponible', consultado: sello, fuenteUrl: 'https://eurocup3.org/', tablas: [] } })
const indice = (evento: string, lugar: string, url: string) => `<select name="season"><option selected value="03_2026">2026</option></select><select name="evvent"><option selected value="${evento}">${lugar}</option></select><a href="${url}">Classification</a>`

describe('Ferrari con el lector HTTP que utiliza el robot', () => {
  const raiz = 'https://files.alkamelcloud.com/', ruta = 'ferrarichallenge/results/05_Europe/14_2026/05_PORTIMAO/396_COPPA%20SHELL/202607170900_Test/', normal = raiz + ruta + '03_Classification_Test.CSV', clase = raiz + ruta + '05_ClassificationByClass_Test.CSV'
  it.each([200, 204, 403, 429, 503, 'red'])('respaldo para cuerpo vacío HTTP %s; acceso o red nunca habilitan otra URL', async estado => {
    const llamadas: string[] = [], c = competicion('rfeda-ferrari-challenge-trofeo-pirelli'), incidencias: IncidenciaDeportes[] = []
    const fetcher = async (input: RequestInfo | URL) => {
      const url = String(input); llamadas.push(url)
      if (url.endsWith('/manifests/results.json')) return Response.json({ series: [{ id: '05_Europe', name: 'Europe', indexUrl: 'ferrarichallenge/manifests/series.json' }] })
      if (url.endsWith('/series.json')) return Response.json({ seasons: [{ id: '14_2026', name: '2026', manifestUrl: 'ferrarichallenge/manifests/season.json' }] })
      if (url.endsWith('/season.json')) return Response.json({ folders: [{ url: normal }, { url: clase }] })
      if (url === normal) { if (estado === 'red') throw Error('Conexión interrumpida'); return new Response(estado === 204 ? null : '', { status: Number(estado) }) }
      if (url === clase) return new Response(datos.ferrariPorClase)
      throw Error('Consulta inesperada')
    }
    await ampliaFerrari(c, url => leerFuenteDeportiva(url, { fetcher }), 2026, ahora, sello, incidencias)
    const permitido = estado === 200 || estado === 204
    expect(llamadas.includes(clase)).toBe(permitido)
    expect(c.agenda.eventos[0].resultados?.[0].filas.length).toBe(permitido ? 18 : undefined)
    expect(c.agenda.eventos[0].fuenteUrl).toBe(permitido ? clase : normal)
    expect(incidencias.length).toBe(permitido ? 0 : 1)
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
  })
})

describe('Alkamel: carreras sprint y misma identidad del calendario', () => {
  it('la carrera sprint real conserva ID, usa el tiempo total y publica los30pilotos sin duplicar tarjeta', async () => {
    const c = competicion('eurocup-3'), incidencias: IncidenciaDeportes[] = [], id = 'eurocup-3-circuit-paul-ricard-sprint'
    c.agenda.eventos = [{ id, nombre: 'Paul Ricard · Carrera sprint', fecha: '2026-05-01', finFecha: '2026-05-03', inicio: null, estado: 'por_confirmar', lugar: 'Paul Ricard', jornada: 'Ronda 1' }]
    const html = indice('08_PAUL RICARD', 'PAUL RICARD', sprint.procedencia.url), urls: string[] = []
    await ampliaEspanaAlkamel([c], url => leerFuenteDeportiva(url, { fetcher: async input => { urls.push(String(input)); return new Response(String(input) === fuenteAlkamelEspana ? html : sprint.texto) } }), 2026, ahora, sello, incidencias)
    expect(incidencias).toEqual([])
    expect(urls).toEqual([fuenteAlkamelEspana, sprint.procedencia.url])
    expect(c.agenda.estado).toBe('actualizado'); expect(c.agenda.eventos).toHaveLength(1)
    const e = c.agenda.eventos[0], t = e.resultados![0]
    expect(e).toMatchObject({ id, nombre: 'Paul Ricard · Carrera sprint', fecha: '2026-05-02', inicio: null })
    expect(t.filas).toHaveLength(30)
    expect(t.filas[0]).toMatchObject({ nombre: 'Chistopher EL FEGHALI', valores: { tiempo: '23:34.331', vueltas: 11 } })
    expect(t.columnas.find(c => c.clave === 'tiempo')?.nombre).toBe('Tiempo total')
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
  })
  it('Montmeló coincide con Barcelona y el ID numerado conserva las dos sesiones de entrenamiento', async () => {
    const c = competicion('formula-4-espana'), incidencias: IncidenciaDeportes[] = [], url = 'https://f4spain-e3.alkamelsystems.com/Results/03_2026/24_BARCELONA/710_F4Spain/202611061315_Free%20Practice%201/03_Classification_Free%20Practice%201.CSV'
    c.agenda.eventos = [1, 2].map(n => ({ id: `f4s-barcelona-free-practice-${n}`, nombre: 'Montmeló · Entrenamientos', fecha: '2026-11-06', inicio: null, estado: 'por_confirmar', lugar: 'Montmeló', jornada: 'Ronda 7' }))
    const csv = 'POS;NUMBER;LAPS;TIME;TEAM;DRIVER_FIRSTNAME;DRIVER_SECONDNAME\n1;7;5;1:23.000;Equipo;Nombre;Apellido\n'
    await ampliaEspanaAlkamel([c], async u => u === fuenteAlkamelEspana ? indice('24_BARCELONA', 'BARCELONA', url) : csv, 2026, ahora, sello, incidencias)
    expect(incidencias).toEqual([]); expect(c.agenda.eventos).toHaveLength(2)
    expect(c.agenda.eventos[0]).toMatchObject({ id: 'f4s-barcelona-free-practice-1', nombre: 'Montmeló · Entrenamientos libres 1' })
    expect(c.agenda.eventos[0].resultados?.[0].filas).toHaveLength(1)
    expect(c.agenda.eventos[1].resultados).toBeUndefined()
  })
  it.each([true, false])('ID sin número se asocia sólo si coincide también la hora publicada: %s', async coincide => {
    const c = competicion('formula-4-espana'), incidencias: IncidenciaDeportes[] = [], url = 'https://f4spain-e3.alkamelsystems.com/Results/03_2026/10_PORTIMAO/667_F4Spain/202606051250_Free%20Practice%201/03_Classification_Free%20Practice%201.CSV'
    c.agenda.eventos = [{ id: 'formula-4-espana-f4s-portimao-2026-free-practice', nombre: 'Portimao · Entrenamientos', fecha: '2026-06-05', inicio: null, estado: 'por_confirmar', lugar: 'Portimao', jornada: 'Ronda 2', detalle: `Hora publicada: ${coincide ? '12:50' : '12:51'}.` }, { id: 'formula-4-espana-f4s-portimao-2026-free-practice-2', nombre: 'Portimao · Entrenamientos', fecha: '2026-06-05', inicio: null, estado: 'por_confirmar', lugar: 'Portimao', jornada: 'Ronda 2', detalle: 'Hora publicada: 14:50.' }]
    const csv = 'POS;NUMBER;LAPS;TIME;TEAM;DRIVER_FIRSTNAME;DRIVER_SECONDNAME\n1;7;5;1:23.000;Equipo;Nombre;Apellido\n'
    await ampliaEspanaAlkamel([c], async u => u === fuenteAlkamelEspana ? indice('10_PORTIMAO', 'PORTIMAO', url) : csv, 2026, ahora, sello, incidencias)
    expect(incidencias).toEqual([])
    expect(c.agenda.eventos).toHaveLength(coincide ? 2 : 3)
    expect(c.agenda.eventos[0].resultados?.length).toBe(coincide ? 1 : undefined)
    expect(c.agenda.eventos[1].resultados).toBeUndefined()
  })
})
