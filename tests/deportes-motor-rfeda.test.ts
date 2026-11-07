import { describe, expect, it } from 'vitest'
import { interpretaClasificacionesRfedaHtml, interpretaPaginasClasificacionTcr, interpretaResultadoTcrTexto, rondasCerx, leerPdfMotor } from '../scripts/lib/deportes-motor-rfeda.mjs'
import { interpretaRondasGb3, interpretaEquiposGb3, interpretaPilotosGb3, interpretaResultadoGb3 } from '../scripts/lib/deportes-motor-gb3.mjs'
import { interpretaCatalogoFerrari, interpretaResultadoFerrari, interpretaPuntosFerrariPaginas } from '../scripts/lib/deportes-motor-ferrari.mjs'
import { interpretaCalendarioFrec, documentosFrec, interpretaPuntosFrec } from '../scripts/lib/deportes-motor-frec.mjs'

const sello = '2026-11-07T10:00:00.000Z', ahora = Date.parse(sello), url = 'https://www.rfeda.es/clasificaciones'
// Fragmentos mínimos de los formatos oficiales comprobados el 7/11/2026.
describe('RFEDA: tablas y documentos sin deducir resultados', () => {
  it('conserva NC, empates y puntos netos diferentes de los brutos', () => {
    const html = `<title>Clasificaciones CERA 2026</title><script>const DATA=${JSON.stringify([{ id: 'general', name: 'General', rows: [{ pos: '1', name: 'Piloto A', totals: { 'TOTAL NETO': '60', 'TOTAL BRUTO': '80' } }, { pos: '1', name: 'Piloto B', totals: { TOTALES: '60' } }, { pos: 'NC', name: 'Piloto C', totals: { TOTALES: '0' } }] }])};</script>`
    const t = interpretaClasificacionesRfedaHtml(html, 'CERA', 2026, url, sello)[0]
    expect(t.filas.map(f => f.posicion)).toEqual([1, 1, null])
    expect(t.filas[0].valores).toMatchObject({ puntos: 60, bruto: 80 })
    expect(() => interpretaClasificacionesRfedaHtml(html, 'CERA', 2025, url, sello)).toThrow('temporada')
  })
  it('rechaza PDF de otro año y una fila TCR ilegible en lugar de omitirla', () => {
    const pagina = 'TCR SPAIN 2026\nNombre Total\n1 Viktor Andersson\t233\t12\n2 Erik Zabala\t190\t15\n'
    expect(interpretaPaginasClasificacionTcr([pagina], 2026, url, sello)[0].filas).toHaveLength(2)
    expect(() => interpretaPaginasClasificacionTcr([pagina], 2025, url, sello)).toThrow('temporada')
    expect(() => interpretaPaginasClasificacionTcr([pagina.replace('190', '???')], 2026, url, sello)).toThrow('incompleta')
  })
  it('lee los tres días CERX y rechaza un año ambiguo', () => {
    const datos = { x: { body: { articles: [{ id: '1', title: 'Montalegre', summary: 'Fecha: 18, 19 y 20 septiembre 2026', url: 'https://cerx.rfeda.es/resultados/i/1/montalegre' }] } } }
    const html = `<script id="gb-app-state">${JSON.stringify(datos)}</script>`
    expect(rondasCerx(html, 2026)[0]).toMatchObject({ fecha: '2026-09-18', finFecha: '2026-09-20', estado: 'por_confirmar', inicio: null })
    expect(() => rondasCerx(html, 2025)).toThrow('temporada')
  })
  it('no trata una pantalla HTML de acceso como un PDF ni reintenta aquí un 429', async () => {
    let llamadas = 0
    await expect(leerPdfMotor(url, { fetcher: async () => new Response('<html>Acceder</html>') })).rejects.toThrow('PDF')
    await expect(leerPdfMotor(url, { fetcher: async () => { llamadas++; return new Response('', { status: 429 }) } })).rejects.toThrow('429')
    expect(llamadas).toBe(1)
  })
  it('TCR no convierte los tiempos corruptos del PDF en datos ni atribuye posición al DNC', () => {
    const texto = 'TCR WORLD TOUR EVENT OF VALENCIA\n12 - 14 June 2026\nTCR Spain\nFinal result Race 1\n10 Viktor Andersson (SWE)\t1 -- 24 laps --\tCupra\n32 :40.771 1:19.8 22 3\nNot Classified\n13 Manuel Fernandes (POR)\tDNC -- 14 laps --\tAudi\n'
    const t = interpretaResultadoTcrTexto(texto, 'Carrera 1', 2026, url, sello)
    expect(t.filas).toHaveLength(2); expect(t.filas[1].posicion).toBeNull()
    expect(t.columnas.some(c => c.clave === 'tiempo')).toBe(false)
    expect(() => interpretaResultadoTcrTexto(texto, 'Carrera 2', 2026, url, sello)).toThrow('otra sesión')
  })
})

const sesion = { Id: 5205, Name: 'Race one', DateTime: '2026-11-07T14:00:00', Timezone: 'CEST', Type: 2 }
const ronda = { IsTest: false, RoundUrl: '/calendar/2026/barcelona', FirstDate: '2026-11-07T00:00:00', LastDate: '2026-11-08T00:00:00', Venue: 'Circuit de Barcelona-Catalunya', DateFormattedShort: '7/8 Nov', Number: 8, Series: [{ ChampionshipID: 22, Sessions: [sesion] }] }
describe('GB3: calendario y tablas con identidad comprobada', () => {
  it('no convierte CEST erróneo en noviembre ni da por acabada una sesión pasada', () => {
    const e = interpretaRondasGb3([ronda], 2026, ahora).eventos[0]
    expect(e.inicio).toBeNull()
    expect(e.detalle).toContain('no coincide')
    const valido = { ...ronda, Series: [{ ChampionshipID: 22, Sessions: [{ ...sesion, Timezone: 'CET', DateTime: '2026-11-07T08:00:00' }] }] }
    expect(interpretaRondasGb3([valido], 2026, ahora).eventos[0]).toMatchObject({ inicio: '2026-11-07T07:00:00.000Z', estado: 'por_confirmar' })
    expect(() => interpretaRondasGb3([{ ...ronda, RoundUrl: '/calendar/2025/barcelona' }], 2026, ahora)).toThrow('temporada')
  })
  it('no mezcla clasificaciones de otro año y elige tiempo de carrera o mejor vuelta', () => {
    const fila = { DriverUrl: '/drivers/2026/nikita', Firstname: 'Nikita', Surname: 'Bedrin', Team: 'Equipo', Position: 'NC', Number: 10, Points: 480, Laps: 16, TotalTime: '28:00.000', FastestLap: '1:35.000' }
    expect(interpretaPilotosGb3([fila], 2026, url, sello).filas[0].posicion).toBeNull()
    expect(interpretaResultadoGb3([fila], { Type: 2 }, 2026, url, sello).filas[0].valores.tiempo).toBe('28:00.000')
    expect(interpretaResultadoGb3([fila], { Type: 1 }, 2026, url, sello).filas[0].valores.tiempo).toBe('1:35.000')
    expect(() => interpretaPilotosGb3([fila], 2025, url, sello)).toThrow('temporada')
  })
  it('exige todas las fechas de calendario para aceptar equipos sin año impreso', () => {
    const html = '<table class="results"><thead><tr><th colspan="3"><h6>Circuit de Barcelona-Catalunya</h6><h6>7/8 Nov</h6></th></tr></thead><tbody><tr><td class="pos">1</td><td>Rodin</td><td>758</td></tr></tbody></table>'
    expect(interpretaEquiposGb3(html, [ronda], url, sello).filas[0].valores.puntos).toBe(758)
    expect(() => interpretaEquiposGb3(html, [{ ...ronda, DateFormattedShort: '8/9 Nov' }], url, sello)).toThrow('temporada')
  })
})

describe('Ferrari: catálogo oficial y resultados por sesión', () => {
  it('no utiliza la fecha de subida como fecha de carrera y excluye otra serie', () => {
    const camino = 'ferrarichallenge/results/05_Europe/14_2026/06_HUNGARORING/400_TROFEO PIRELLI/202609131455_Race 2/03_Classification_Race 2.CSV'
    const datos = { folders: [{ children: [{ name: 'Classification_Race 2.CSV', url: camino, date: '2026-10-28T10:00:00Z' }, { url: camino.replace('400_TROFEO PIRELLI', '500_CLUB CHALLENGE') }] }] }
    const c = interpretaCatalogoFerrari(datos, 2026)
    expect(c.sesiones).toHaveLength(1)
    expect(c.sesiones[0]).toMatchObject({ fecha: '2026-09-13', inicio: null, estado: 'por_confirmar' })
    expect(() => interpretaCatalogoFerrari(datos, 2025)).toThrow('temporada')
    expect(() => interpretaCatalogoFerrari({ folders: [{ url: 'https://otro.example/documento.csv' }] }, 2026)).toThrow('ajeno')
  })
  it('interpreta comillas CSV, NC y carrera sin confundirla con clasificación', () => {
    const csv = 'POSITION;NUMBER;STATUS;LAPS;TOTAL_TIME;GAP_FIRST;TEAM;CLASS;DRIVER_FIRSTNAME;DRIVER_SECONDNAME;\n1;1;Classified;18;32:04.649;-;"Equipo; Uno";P;Sergio;PAULET;\n;2;Not Classified;0;;18 laps;Otro;P-AM;Otro;Piloto;\n'
    const t = interpretaResultadoFerrari(csv, 'Race 2', url, sello)
    expect(t.filas[0].valores).toMatchObject({ equipo: 'Equipo; Uno', tiempo: '32:04.649', vueltas: 18 })
    expect(t.filas[1].posicion).toBeNull()
    expect(() => interpretaResultadoFerrari(csv, 'Qualifying 2', url, sello)).toThrow('otra sesión')
    expect(() => interpretaResultadoFerrari(csv.replace('PAULET;', 'PAULET;extra;'), 'Race 2', url, sello)).toThrow('incompleta')
  })
  it('une páginas del campeonato y no interpreta EX como participante', () => {
    const cab = 'Season Standings\nFerrari Challenge Coppa Shell\nPos\nTotal\nPoints\n'
    const p1 = cab + 'NS 1\t1\tTibor VALINT\t1 83 12 15\tEX\t1 1 1\n13/09/2026 Page 1 / 2\n'
    const p2 = cab + '/\tCarl RUNEFELT\t2 80 15\n13/09/2026 Page 2 / 2\n'
    const t = interpretaPuntosFerrariPaginas([p1, p2], 2026, url, sello)
    expect(t).toHaveLength(1); expect(t[0].filas.map(f => f.nombre)).toEqual(['Tibor VALINT', 'Carl RUNEFELT'])
    expect(() => interpretaPuntosFerrariPaginas([p1, p2.replace('2 80', '3 80')], 2026, url, sello)).toThrow('perdidas')
    expect(() => interpretaPuntosFerrariPaginas([p1], 2025, url, sello)).toThrow('temporada')
  })
  it('conserva dorsales con letra y nombres numerados del CSV de Le Mans', () => {
    const csv = 'POS;NUMBER;LAPS;TIME;TEAM;DRIVER1_FIRSTNAME;DRIVER1_SECONDNAME;DRIVER2_FIRSTNAME;DRIVER2_SECONDNAME;\n1;1b;32;2:03.201;Equipo;Gilbert;YATES;;;;\n'
    expect(() => interpretaResultadoFerrari(csv, 'Free Practice 1', url, sello)).toThrow('incompleta')
    const correcto = csv.replace('YATES;;;;', 'YATES;;;')
    expect(interpretaResultadoFerrari(correcto, 'Free Practice 1', url, sello).filas[0]).toMatchObject({ nombre: 'Gilbert YATES', valores: { numero: '1b' } })
  })
})

describe('FREC: temporada seleccionada y PDF revisado', () => {
  const calendario = { anno: 2026, count: 1, items: [{ id: 184, titolo: 'SPIELBERG', data_inizio: '20260424', data_fine: '20260426', round: '01', stato: 'Austria', permalink: 'https://fiafrec.com/race/spielberg/' }] }
  it('rechaza el calendario predeterminado 2027 aunque la web mantenga pie 2026', () => {
    expect(interpretaCalendarioFrec(calendario, 2026)[0]).toMatchObject({ fecha: '2026-04-24', finFecha: '2026-04-26' })
    expect(() => interpretaCalendarioFrec({ ...calendario, anno: 2027 }, 2026)).toThrow('temporada')
    expect(() => documentosFrec('<a href="https://fiafrec.com/team/mp/">MP Motorsport</a><a href="https://fiafrec.com/wp-content/uploads/2025/Driver-Standing.pdf">Overall standings</a>', 2026)).toThrow('temporada')
  })
  it('toma 100 puntos del PDF revisado, sin recalcular carreras ni copiar los 10 del HTML', () => {
    const eventos = interpretaCalendarioFrec(calendario, 2026), texto = '1 15 Alexander Abkhazava MP Motorsport\t6\t0\t15\t100\nN/A: Not Applicable\nCOMPETITION SPIELBERG\nPoints'
    const t = interpretaPuntosFrec(texto, 'pilotos', ['MP Motorsport'], eventos, 'https://fiafrec.com/wp-content/uploads/2026/09/Driver-Standing.pdf', sello)
    expect(t.filas[0]).toMatchObject({ nombre: 'Alexander Abkhazava', valores: { puntos: 100, numero: 15 } })
    expect(() => interpretaPuntosFrec(texto.replace('SPIELBERG', 'MONZA'), 'pilotos', ['MP Motorsport'], eventos, url, sello)).toThrow('temporada')
  })
})
