import { describe, expect, it } from 'vitest'
import { creaEstadoFFCV, descubreCatalogoRFEF, descubreFutsal, eligeJornadasFFCV, fechaMadrid, generoFFCV, normalizaEstadoFFCV, obtieneFFCV, obtieneFutbol, parseaAgendaFFCV, parseaAgendaFutsal, parseaAgendaLaLiga, parseaAgendaRFEF, parseaClasificacionFFCV, parseaClasificacionFutsal, parseaClasificacionLaLiga, parseaFichaFutsal } from '../scripts/lib/deportes-futbol.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'

const fixtures = import.meta.glob('./fixtures/deportes-futbol/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (nombre: string) => fixtures[`./fixtures/deportes-futbol/${nombre}`]
const html = (datos: unknown) => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(datos)}</script>`
const sello = '2026-11-07T12:00:00.000Z'
const url = 'https://www.laliga.com/laliga-easports/resultados'
const ficha = { nombre: 'Primera FS Iberdrola', category: '30', year: '2027', league: '1299', group: '1', round: '7', rounds: ['6', '7', '8'], grupos: ['1'] }

describe('fútbol con fuentes oficiales', () => {
  it('conserva un 0-0 final y nunca convierte el 0-0 inicial en un resultado', () => {
    const datos = JSON.parse(fixture('laliga-agenda.json'))
    datos.props.pageProps.matches[1].home_score = 0
    datos.props.pageProps.matches[1].away_score = 0
    const partidos = parseaAgendaLaLiga(html(datos), 'primera-division', url, sello)
    expect(partidos.temporada).toBe('2026-2027')
    expect(partidos.eventos[0].resultado).toEqual({ local: 0, visitante: 0 })
    expect(partidos.eventos[1].resultado).toBeNull()
    expect(partidos.eventos[1].estado).toBe('programado')
    expect(partidos.eventos[1].inicio).toBe('2026-11-07T13:00:00.000Z')
  })
  it('rechaza una competición equivocada y un marcador final incompleto', () => {
    const datos = JSON.parse(fixture('laliga-agenda.json'))
    expect(() => parseaAgendaLaLiga(html(datos), 'segunda-division', url, sello)).toThrow('otra competición')
    delete datos.props.pageProps.matches[0].away_score
    expect(() => parseaAgendaLaLiga(html(datos), 'primera-division', url, sello)).toThrow('marcador')
  })
  it('no atribuye canales extranjeros a España ni a partidos cancelados', () => {
    const datos = JSON.parse(fixture('laliga-agenda.json'))
    datos.props.country = 'GB'
    expect(parseaAgendaLaLiga(html(datos), 'primera-division', url, sello).eventos[0].emisiones).toEqual([])
    datos.props.country = 'ES'
    datos.props.pageProps.matches[0].status = 'Canceled'
    const evento = parseaAgendaLaLiga(html(datos), 'primera-division', url, sello).eventos[0]
    expect(evento.estado).toBe('cancelado')
    expect(evento.resultado).toBeNull()
    expect(evento.emisiones).toEqual([])
  })
  it('lee la tabla general, no las tablas parciales de casa o fuera', () => {
    const datos = JSON.parse(fixture('laliga-clasificacion.json'))
    datos.props.pageProps.standingsHome = [{ points: 999 }]
    const tabla = parseaClasificacionLaLiga(html(datos), 'primera-division').tablas[0]
    expect(tabla.filas[0]).toMatchObject({ posicion: 1, nombre: 'FC Barcelona', valores: { puntos: 30, jugados: 11 } })
    expect(tabla.filas).toHaveLength(2)
  })
  it('respeta el cambio de hora de España y rechaza fechas u horas imposibles', () => {
    expect(fechaMadrid('2026-11-07', '11:00')).toBe('2026-11-07T10:00:00.000Z')
    expect(fechaMadrid('2026-09-07', '11:00')).toBe('2026-09-07T09:00:00.000Z')
    expect(fechaMadrid('2026-02-30', '11:00')).toBeNull()
    expect(fechaMadrid('2026-11-07', '25:00')).toBeNull()
    expect(fechaMadrid('2026-03-29', '02:30')).toBeNull()
  })
  it('descubre todos los grupos enlazados y evita duplicar las eliminatorias', () => {
    const enlaces = descubreFutsal('<a href="/competicion/segunda-femenina/2027/resultados/1">1</a><a href="/competicion/segunda-femenina/2027/resultados/2">2</a><a href="/competicion/segunda-femenina/2027/resultados/3">3</a><a href="/competicion/supercopa/2027/resultados">Copa</a><a href="/competicion/supercopa/2027/resultados/playoffs">Copa</a><a href="https://ajena.example/competicion/falsa/2027/resultados">Ajena</a>')
    expect(enlaces).toHaveLength(4)
    expect(enlaces.filter(e => e.slug === 'segunda-femenina').map(e => e.grupo)).toEqual(['1', '2', '3'])
  })
  it('verifica temporada y grupo en la ficha antes de descargar partidos', () => {
    const pagina = '<title>Resultados de Primera FS Iberdrola 2027 | RFEF</title><input id="active_league" value="1299"><select id="select_round_competition" onchange="changeRoundResult(30,2027,1)"><option value="1299-7-7-1" selected>Jornada 7</option></select>'
    expect(parseaFichaFutsal(pagina, { year: 2027, grupo: '1' }).round).toBe('7')
    expect(() => parseaFichaFutsal(pagina, { year: 2026, grupo: '1' })).toThrow('temporada')
    expect(() => parseaFichaFutsal(pagina, { year: 2027, grupo: '2' })).toThrow('grupo')
  })
  it('lee fútbol sala con índices no consecutivos y oculta los marcadores de partidos pendientes', () => {
    const datos = JSON.parse(fixture('futsal-jornada.json'))
    const partidos = datos['2026-11-07'].matches
    datos['2026-11-07'].matches = { 1: partidos[0], 7: partidos[1], 8: partidos[2] }
    const eventos = parseaAgendaFutsal(datos, ficha, 'https://futsal.rfef.es/competicion/primera-femenina/2027/resultados/1', sello)
    expect(eventos).toHaveLength(3)
    expect(eventos[0].resultado).toEqual({ local: 2, visitante: 5 })
    expect(eventos[0].inicio).toBe('2026-11-07T10:00:00.000Z')
    expect(eventos[1].resultado).toBeNull()
    expect(eventos[1].estado).toBe('programado')
    expect(eventos[2].emisiones?.[0].nombre).toBe('YouTube FutsalRFEF')
  })
  it('rechaza mezclar grupos o temporadas y no inventa una hora ausente', () => {
    const datos = JSON.parse(fixture('futsal-jornada.json'))
    expect(() => parseaAgendaFutsal(datos, { ...ficha, group: '2' }, url, sello)).toThrow('mezcló')
    expect(() => parseaAgendaFutsal(datos, { ...ficha, year: '2026' }, url, sello)).toThrow('mezcló')
    datos['2026-11-07'].matches[0].no_hour = '1'
    expect(parseaAgendaFutsal(datos, ficha, url, sello)[0].inicio).toBeNull()
  })
  it('lee clasificación de sala sin incluir las columnas ocultas de casa/fuera', () => {
    const tabla = parseaClasificacionFutsal(fixture('futsal-clasificacion.html'), 'General')[0]
    expect(tabla.filas[0]).toMatchObject({ nombre: 'Futsi Atlético Navalcarnero', valores: { puntos: 18, jugados: 7, ganados: 6, perdidos: 1, favor: 36, contra: 13 } })
  })
  it('descubre categorías de RFEF sin confundir su catálogo con resultados', () => {
    const catalogo = descubreCatalogoRFEF('<select name="season"><option>2026-2027</option></select><select name="competition"><optgroup label="Fútbol Juvenil"><option value="33836116">División de Honor Juvenil</option></optgroup></select>')
    expect(catalogo[0]).toEqual({ id: '33836116', nombre: 'División de Honor Juvenil', categoria: 'Fútbol Juvenil', temporada: '2026-2027' })
    expect(() => descubreCatalogoRFEF('<p>Error al obtener datos</p>')).toThrow()
  })
  it('un fallo de fuentes deja apartados vacíos sin ponerles una verificación falsa', async () => {
    const fetcher = (async () => new Response('Temporalmente no disponible', { status: 503 })) as typeof fetch
    const salida = await obtieneFutbol({ fetcher, ahora: Date.parse(sello) })
    expect(salida.competiciones).toHaveLength(3)
    for (const competicion of salida.competiciones) {
      expect(competicion.agenda.estado).toBe('no_disponible')
      expect(competicion.agenda.verificadoEn).toBeUndefined()
      expect(competicion.clasificacion.tablas).toEqual([])
      expect(() => validarCompeticionDeportiva(competicion, Date.parse(sello))).not.toThrow()
    }
    expect(salida.incidencias.some(i => /503/.test(i.motivo))).toBe(true)
  })
  it('conserva la jornada anterior junto a la más cercana sin descargar toda la temporada', () => {
    const jornadas = [{ codjornada: '9', fecha_jornada: '01-11-2026' }, { codjornada: '10', fecha_jornada: '08-11-2026' }, { codjornada: '11', fecha_jornada: '15-11-2026' }]
    expect(eligeJornadasFFCV(jornadas, Date.parse(sello)).map(j => j.codjornada)).toEqual(['9', '10'])
    expect(eligeJornadasFFCV(jornadas, Date.parse('2026-12-01T00:00Z')).map(j => j.codjornada)).toEqual(['10', '11'])
    expect(eligeJornadasFFCV([{ codjornada: '1', fecha_jornada: 'sin fecha' }])).toEqual([])
  })
  it('el lunes sigue enseñando los resultados del fin de semana recién terminado', () => {
    const jornadas = [{ codjornada: '9', fecha_jornada: '01-11-2026' }, { codjornada: '10', fecha_jornada: '08-11-2026' }, { codjornada: '11', fecha_jornada: '15-11-2026' }]
    expect(eligeJornadasFFCV(jornadas, Date.parse('2026-11-09T08:00:00Z')).map(j => j.codjornada)).toEqual(['10', '11'])
    expect(eligeJornadasFFCV(jornadas, Date.parse('2026-10-31T08:00:00Z')).map(j => j.codjornada)).toEqual(['9'])
  })
  it('distingue el cero inicial valenciano del marcador final publicado', () => {
    const pendientes = parseaAgendaFFCV(JSON.parse(fixture('ffcv-pendientes.json')), '10', 'https://ffcv.es/competiciones/')
    expect(pendientes[0]).toMatchObject({ estado: 'programado', resultado: null, inicio: '2026-11-08T16:00:00.000Z' })
    const finales = parseaAgendaFFCV(JSON.parse(fixture('ffcv-finalizados.json')), '9', 'https://ffcv.es/competiciones/')
    expect(finales[0]).toMatchObject({ estado: 'finalizado', resultado: { local: 1, visitante: 1 } })
    expect(() => parseaAgendaFFCV(JSON.parse(fixture('ffcv-finalizados.json')), '10', url)).toThrow('otra jornada')
  })
  it('no convierte aplazamientos, retirados o marcadores provisionales en resultados finales', () => {
    const datos = JSON.parse(fixture('ffcv-finalizados.json'))
    datos.partidos[0].estado = '2'
    datos.partidos[1].resultado_provisional = '1'
    const eventos = parseaAgendaFFCV(datos, '9', 'https://ffcv.es/competiciones/')
    expect(eventos[0]).toMatchObject({ estado: 'aplazado', resultado: null })
    expect(eventos[1]).toMatchObject({ estado: 'por_confirmar', resultado: null })
    datos.partidos[0].retirado_local = '1'
    expect(parseaAgendaFFCV(datos, '9', url)[0].estado).toBe('cancelado')
  })
  it('respeta los descansos y muestra un marcador ausente como pendiente de confirmar', () => {
    const datos = JSON.parse(fixture('ffcv-finalizados.json'))
    datos.partidos[0].cod_equipo_local = '-1'
    datos.partidos[1].resultado = '0'
    const eventos = parseaAgendaFFCV(datos, '9', 'https://ffcv.es/competiciones/')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ estado: 'por_confirmar', resultado: null })
    expect(eventos[0].detalle).toContain('por confirmar')
  })
  it('comprueba el grupo de la clasificación valenciana y conserva las sanciones negativas', () => {
    const datos = JSON.parse(fixture('ffcv-clasificacion.json'))
    expect(parseaClasificacionFFCV(datos, '905431604', '905431605')[0].filas[0]).toMatchObject({ posicion: 1, valores: { puntos: 24, jugados: 9 } })
    expect(() => parseaClasificacionFFCV(datos, '905431604', 'otro')).toThrow('otro grupo')
    datos.clasificacion[0].puntos = '-3'
    expect(parseaClasificacionFFCV(datos, '905431604', '905431605')[0].filas[0].valores.puntos).toBe(-3)
  })
  it('no inventa un estado final si RFEF sólo publica marcador y acta', () => {
    const competicion = { nombre: 'Primera Federación de Fútbol Femenino', temporada: '2026-2027' }
    const eventos = parseaAgendaRFEF(fixture('rfef-primera-femenina.html'), competicion, '33836145', 'https://rfef.es/es/resultados')
    expect(eventos[0]).toMatchObject({ estado: 'por_confirmar', resultado: { local: 5, visitante: 0 }, fecha: '2026-10-31' })
    expect(eventos[0].detalle).toBe('Marcador publicado en el acta: 5–0. Estado del partido por confirmar.')
    expect(() => parseaAgendaRFEF(fixture('rfef-primera-femenina.html'), competicion, '1234', url)).toThrow('otro grupo')
    expect(() => parseaAgendaRFEF(fixture('rfef-primera-femenina.html'), { ...competicion, temporada: '2025-2026' }, '33836145', url)).toThrow('otra temporada')
  })
  it('usa el género que publica la federación, sin deducirlo de la edad', () => {
    expect(generoFFCV({ nombre: 'Lliga Preferent Alevi Futsal', nombre_grupo_categoria: 'MASCULÍ FUTSAL' })).toBe('masculino')
    expect(generoFFCV({ nombre: 'Benjamí', nombre_grupo_categoria: 'MASCULÍ F8' })).toBe('masculino')
    expect(generoFFCV({ nombre: 'Infantil Valenta' })).toBe('femenino')
    expect(generoFFCV({ nombre: 'Infantil Mixt' })).toBe('mixto')
    expect(generoFFCV({ nombre: 'Escoleta' })).toBeUndefined()
  })
  it('no sustituye una agenda completa de LaLiga si falla una jornada cercana', async () => {
    const datos = JSON.parse(fixture('laliga-agenda.json'))
    datos.props.pageProps.gameweekList = [{ week: 11, name: 'Jornada 11' }, { week: 12, name: 'Jornada 12' }]
    datos.props.pageProps.gameweek = { week: 12, name: 'Jornada 12' }
    const fetcher = (async (entrada: RequestInfo | URL) => String(entrada) === url ? new Response(html(datos)) : new Response('Caída temporal', { status: 503 })) as typeof fetch
    const salida = await obtieneFutbol({ fetcher, ahora: Date.parse(sello) })
    expect(salida.competiciones.find(c => c.id === 'laliga-easports')?.agenda).toMatchObject({ estado: 'no_disponible', eventos: [] })
  })
})

describe('actualización valenciana persistida por bloques', () => {
  const semilla = () => creaEstadoFFCV([{ codigo: '905431604', nombre: 'Tercera Federación', TipoJuego: 'Futbol-11', nombre_grupo_categoria: 'MASCULÍ F11', visible_clasificacion: '0', grupos: [{ codigo: '905431605', nombre: 'Grupo VI', ver_clasificacion: '0' }, { codigo: '905431606', nombre: 'Otro grupo', ver_clasificacion: '0' }] }], { cod_temporada: '22', nombre: '2026-2027' }, sello)
  const jornadas = { jornadas: [{ codjornada: '9', fecha_jornada: '01-11-2026' }, { codjornada: '10', fecha_jornada: '08-11-2026' }] }
  const respuesta = (entrada: RequestInfo | URL) => {
    const enlace = String(entrada)
    if (enlace === 'https://ffcv.es/competiciones/') return new Response('<meta name="ffcv-pt" content="sesion-publica-de-prueba">', { headers: { 'Set-Cookie': 'sesion=anonima; Path=/' } })
    if (enlace.includes('jornadas_fetch')) return new Response(JSON.stringify(jornadas))
    if (enlace.includes('cod_jornada=9')) return new Response(fixture('ffcv-finalizados.json'))
    if (enlace.includes('cod_jornada=10')) return new Response(fixture('ffcv-pendientes.json'))
    return new Response('Petición inesperada', { status: 500 })
  }
  it('reutiliza el catálogo auténtico y continúa el siguiente grupo al agotar el presupuesto horario', async () => {
    let tiempo = Date.parse(sello), guardado = semilla()
    guardado.ventana = { desde: sello, peticiones: 116 }
    const llamadas: string[] = []
    const fetcher = (async (entrada: RequestInfo | URL) => { llamadas.push(String(entrada)); return respuesta(entrada) }) as typeof fetch
    const salida = await obtieneFFCV({ estadoFFCV: guardado, guardarEstadoFFCV: e => { guardado = e }, relojFFCV: () => tiempo, duermeFFCV: async ms => { tiempo += ms }, ahora: tiempo, fetcher })
    expect(llamadas).toHaveLength(4)
    expect(llamadas.some(u => /temporadas_fetch|competiciones_fetch|grupos_fetch/.test(u))).toBe(false)
    expect(salida.competiciones).toHaveLength(1)
    expect(salida.competiciones[0].agenda.eventos.length).toBeGreaterThan(0)
    expect(guardado.cursor).toBe(1)
    expect(guardado.ventana.peticiones).toBe(120)
    expect(guardado.noConsultarAntes).toBe('2026-11-07T13:00:00.000Z')
    expect(guardado.catalogo?.verificadoEn).toBe(sello)
    expect(JSON.stringify(guardado)).not.toMatch(/sesion-publica-de-prueba|anonima|Cookie|token/)
    tiempo = Date.parse('2026-11-07T13:00:01Z')
    llamadas.length = 0
    await obtieneFFCV({ estadoFFCV: guardado, guardarEstadoFFCV: e => { guardado = e }, relojFFCV: () => tiempo, duermeFFCV: async ms => { tiempo += ms }, ahora: tiempo, fetcher })
    expect(llamadas[1]).toContain('cod_grupo=905431606')
    expect(guardado.ventana.peticiones).toBeLessThan(120)
  })
  it('guarda Retry-After y ni abre sesión desde otra ejecución antes de terminar el descanso', async () => {
    let tiempo = Date.parse(sello), guardado = semilla(), llamadas = 0
    const fetcher = (async (entrada: RequestInfo | URL) => { llamadas++; return String(entrada).includes('/api/') ? new Response('Demasiadas consultas', { status: 429, headers: { 'Retry-After': '3600' } }) : respuesta(entrada) }) as typeof fetch
    await obtieneFFCV({ estadoFFCV: guardado, guardarEstadoFFCV: e => { guardado = e }, relojFFCV: () => tiempo, duermeFFCV: async ms => { tiempo += ms }, ahora: tiempo, fetcher })
    expect(llamadas).toBe(2)
    expect(guardado.cursor).toBe(0)
    expect(guardado.noConsultarAntes).toBe('2026-11-07T13:00:01.000Z')
    await obtieneFFCV({ estadoFFCV: guardado, relojFFCV: () => tiempo + 1800000, ahora: tiempo, fetcher })
    expect(llamadas).toBe(2)
    expect(guardado.verificados).toEqual({})
  })
  it('no publica como completa una agenda valenciana si falla una de las dos jornadas', async () => {
    let tiempo = Date.parse(sello)
    const fetcher = (async (entrada: RequestInfo | URL) => String(entrada).includes('cod_jornada=9') ? new Response('Fallo temporal', { status: 503 }) : respuesta(entrada)) as typeof fetch
    const salida = await obtieneFFCV({ estadoFFCV: semilla(), relojFFCV: () => tiempo, duermeFFCV: async ms => { tiempo += ms }, ahora: tiempo, fetcher })
    expect(salida.competiciones).toEqual([])
    expect(salida.incidencias.some(i => i.motivo.includes('503'))).toBe(true)
  })
  it('el presupuesto local nunca acorta un Retry-After recibido en la última petición', async () => {
    let tiempo = Date.parse(sello), guardado = semilla()
    guardado.ventana = { desde: sello, peticiones: 116 }
    const fetcher = (async (entrada: RequestInfo | URL) => String(entrada).includes('cod_jornada=10') ? new Response('Límite', { status: 429, headers: { 'Retry-After': '3600' } }) : respuesta(entrada)) as typeof fetch
    await obtieneFFCV({ estadoFFCV: guardado, guardarEstadoFFCV: e => { guardado = e }, relojFFCV: () => tiempo, duermeFFCV: async ms => { tiempo += ms }, ahora: tiempo, fetcher })
    expect(guardado.ventana.peticiones).toBe(120)
    expect(guardado.noConsultarAntes).toBe('2026-11-07T13:00:03.000Z')
    expect(guardado.cursor).toBe(0)
  })
  it('valida el catálogo persistido y elimina campos ajenos a los datos públicos', () => {
    expect(normalizaEstadoFFCV({ ...semilla(), token: 'secreto', cookie: 'sesion' })).toEqual(semilla())
    expect(normalizaEstadoFFCV({ version: 1, catalogo: { categorias: [] }, noConsultarAntes: 'sin fecha', cursor: -2 }).catalogo).toBeNull()
    const estado = semilla()
    if (estado.catalogo) estado.catalogo.categorias[0].grupos?.push({ codigo: 'sin-codigo', nombre: 'Inválido', ver_clasificacion: '1' })
    expect(normalizaEstadoFFCV(estado).catalogo).toBeNull()
  })
  it('retoma una enumeración de catálogo a medias sin repetir las categorías ya leídas', async () => {
    let tiempo = Date.parse(sello), guardado = semilla()
    if (guardado.catalogo) { guardado.catalogo.categorias[0].grupos = null; guardado.catalogo.completo = false }
    guardado.ventana = { desde: sello, peticiones: 118 }
    const llamadas: string[] = []
    const fetcher = (async (entrada: RequestInfo | URL) => {
      llamadas.push(String(entrada))
      return String(entrada).includes('grupos_fetch') ? new Response(JSON.stringify({ grupos: semilla().catalogo?.categorias[0].grupos })) : respuesta(entrada)
    }) as typeof fetch
    await obtieneFFCV({ estadoFFCV: guardado, guardarEstadoFFCV: e => { guardado = e }, relojFFCV: () => tiempo, duermeFFCV: async ms => { tiempo += ms }, ahora: tiempo, fetcher })
    expect(llamadas).toHaveLength(2)
    expect(llamadas[1]).toContain('grupos_fetch.php?cod_competicion=905431604')
    expect(guardado.catalogo?.completo).toBe(true)
    expect(guardado.catalogo?.categorias[0].grupos).toHaveLength(2)
    expect(guardado.cursor).toBe(0)
    expect(guardado.noConsultarAntes).toBe('2026-11-07T13:00:00.000Z')
  })
})
