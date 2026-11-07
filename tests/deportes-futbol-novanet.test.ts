import { describe, expect, it, vi } from 'vitest'
import { parse } from 'node-html-parser'
import { categoriaDuplicadaNovanet, fusionaCompeticionesFutbol, idGrupoNovanet, numeroVisualNovanet, obtieneNovanet, parseaAgendaNovanet, parseaCatalogoNovanet, parseaClasificacionNovanet, parseaSelectorNovanet } from '../scripts/lib/deportes-futbol-novanet.mjs'
import type { CompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import { creaSesionFederativa } from '../scripts/lib/deportes-futbol-sesion.mjs'
import { parseaAgendaMadrid, parseaClasificacionMadrid } from '../scripts/lib/deportes-futbol-madrid.mjs'
import { checkpointNovanet, normalizaEstadoNovanet, recuperaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'

const fixtures = import.meta.glob('./fixtures/deportes-futbol/novanet/*', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (nombre: string) => fixtures[`./fixtures/deportes-futbol/novanet/${nombre}`]
const fuente = 'https://marcadores.rfef.es/pnfg/NPcd/NFG_CmpJornada'
const esperada = { fuenteId: 'rfef', competicion: '33836091', nombre: 'Campeonato Nacional de Liga de Segunda Federación', grupo: '33836092', jornada: '9', temporada: '2026-2027' }

describe('lectura fiel de los resultados públicos de las federaciones', () => {
  it('lee la temporada y las categorías auténticas, no simples títulos de noticias', () => {
    const c = parseaCatalogoNovanet(fixture('catalogo.html'))
    expect(c.temporada).toEqual({ codigo: '22', nombre: '2026-2027' })
    expect(c.categorias).toHaveLength(42)
    expect(c.categorias.find(c => c.codigo === '33836091')?.nombre).toContain('Segunda Federación')
    expect(() => parseaCatalogoNovanet('<h1>Segunda Federación</h1>')).toThrow('temporada')
  })
  it('lee las listas públicas sin ejecutar JavaScript recibido', () => {
    expect(parseaSelectorNovanet(fixture('grupos.html'), 'grupos')).toHaveLength(5)
    expect(parseaSelectorNovanet(fixture('jornadas.html'), 'jornadas')).toHaveLength(34)
    expect(() => parseaSelectorNovanet('<script>var grupos=new Array("1",dangerous());</script>', 'grupos')).toThrow('literales')
  })
  it('los nueve marcadores visuales coinciden con la tabla de resultados independiente', () => {
    const agenda = parseaAgendaNovanet(fixture('segunda-jornada-9.html'), esperada, fuente)
    const tabla = parse(fixture('segunda-clasificacion.html')).querySelector('table.table-hover')
    expect(agenda).toHaveLength(9)
    for (const fila of tabla?.querySelectorAll('tr') || []) {
      const celdas = fila.querySelectorAll('td')
      const local = celdas[0]?.text.trim(), visitante = celdas[2]?.text.trim()
      const marcador = celdas[1]?.text.match(/(\d+)\s*-\s*(\d+)/)
      const partido = agenda.find(p => p.local === local && p.visitante === visitante)
      expect(partido?.resultado, `${local} - ${visitante}`).toEqual({ local: Number(marcador?.[1]), visitante: Number(marcador?.[2]) })
    }
    expect(agenda[0]).toMatchObject({ estado: 'finalizado', resultado: { local: 2, visitante: 1 }, inicio: '2026-10-31T15:00:00.000Z' })
  })
  it('descarta dígitos ocultos y pseudoelementos ocultos, incluidos marcadores de dos cifras', () => {
    expect(numeroVisualNovanet(parse('<span><style>#c:after{content:"\\0032"}</style><span id="c"><span style="display:none">0</span></span></span>'))).toBe(2)
    expect(numeroVisualNovanet(parse('<span><style>#c:before{content:"\\0030";display:none}</style><span id="c">1<span style="display:none">4</span></span></span>'))).toBe(1)
    expect(numeroVisualNovanet(parse('<span><style>#c:before{content:"1"}</style><span id="c">2</span></span>'))).toBe(12)
    expect(() => numeroVisualNovanet(parse('<span><i id="c" class="fa-7"><script>ntype("c",8,0,"fa-7");</script></i></span>'))).toThrow('no verificable')
  })
  it('no presenta datos provisionales como resultado final y rechaza otra temporada o grupo', () => {
    const html = fixture('segunda-jornada-9.html')
    expect(parseaAgendaNovanet(html.replaceAll('wid2_resultado_cerrada', 'wid2_resultado_prov'), esperada, fuente).every(e => e.resultado === null && e.estado === 'por_confirmar')).toBe(true)
    expect(() => parseaAgendaNovanet(html, { ...esperada, grupo: 'otro' }, fuente)).toThrow('grupo')
    expect(() => parseaAgendaNovanet(html, { ...esperada, temporada: '2025-2026' }, fuente)).toThrow('temporada')
  })
  it('lee totales y goles sin mezclar las columnas de casa y fuera', () => {
    const tabla = parseaClasificacionNovanet(fixture('segunda-clasificacion.html'), esperada, fuente)[0]
    expect(tabla.filas).toHaveLength(18)
    expect(tabla.filas[0]).toMatchObject({ nombre: 'Sestao River Club', valores: { puntos: 22, jugados: 9, ganados: 7, empatados: 1, perdidos: 1, favor: 11, contra: 3 } })
    expect(() => parseaClasificacionNovanet(fixture('segunda-clasificacion.html'), { ...esperada, grupo: 'otro' }, fuente)).toThrow('grupo')
  })
  it('la columna opcional de puntos por partido no desplaza puntos ni goles', () => {
    const tabla = parseaClasificacionNovanet(fixture('asturias-tabla.html'), { ...esperada, nombre: 'Tercera Federación', competicion: '22880342', grupo: '22922739' }, 'https://www.asturfutbol.es/')[0]
    expect(tabla.filas[0]).toMatchObject({ nombre: 'C.D. Covadonga "A"', valores: { puntos: 20, jugados: 9, ganados: 6, empatados: 2, perdidos: 1, favor: 23, contra: 9 } })
  })
  it('reconoce los encabezados de la misma tabla en euskera', () => {
    const tabla = parseaClasificacionNovanet(fixture('euskadi-tabla.html'), { ...esperada, nombre: 'PRIMERA FEDERACIÓN / LEHEN FEDERAZIOA', competicion: '24675380', grupo: '24675438' }, 'https://www.euskadifutbol.eus/')[0]
    expect(tabla.filas[0]).toMatchObject({ nombre: 'LUGO C.D.', valores: { puntos: 25, jugados: 10, ganados: 8, empatados: 1, perdidos: 1, favor: 18, contra: 9 } })
  })
  it('una final en una tabla anidada aparece una vez y sin confundir Ganador con el nombre', () => {
    const eventos = parseaAgendaNovanet(fixture('galicia-final.html'), { ...esperada, fuenteId: 'galicia', competicion: '27103570', grupo: '27103619', jornada: '4' }, 'https://www.futgal.es/')
    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({ local: 'C.D. BOIRO', visitante: 'BERGANTIÑOS C.F.', resultado: { local: 1, visitante: 3 } })
    expect(parseaAgendaNovanet(fixture('melilla-jornada.html'), { ...esperada, fuenteId: 'melilla', competicion: '22028332', grupo: '22028333', jornada: '1' }, 'https://www.rfmf.es/')).toHaveLength(1)
  })
  it('no convierte una hora canaria cuya zona no está confirmada', () => {
    const e = parseaAgendaNovanet(fixture('segunda-jornada-9.html'), { ...esperada, fuenteId: 'canarias' }, fuente)[0]
    expect(e.inicio).toBeNull()
    expect(e.fecha).toBe('2026-10-31')
    expect(e.detalle).toContain('zona horaria')
  })
  it('los cinco resultados de Las Palmas coinciden con la tabla aunque la clase oculta contenga once', () => {
    const eventos = parseaAgendaNovanet(fixture('las-palmas-agenda.html'), { ...esperada, fuenteId: 'las-palmas', competicion: '54977176', grupo: '55103366', jornada: '3' }, 'https://www.fiflp.com/')
    expect(eventos).toHaveLength(5)
    const tabla = parse(fixture('las-palmas-tabla.html')).querySelector('table.table-hover')
    for (const tr of tabla?.querySelectorAll('tr') || []) {
      const c = tr.querySelectorAll('td'), marcador = c[1]?.text.match(/(\d+)\s*-\s*(\d+)/)
      if (!marcador) continue
      const e = eventos.find(e => e.local === c[0].text.trim() && e.visitante === c[2].text.trim())
      expect(e?.resultado).toEqual({ local: Number(marcador[1]), visitante: Number(marcador[2]) })
      expect(e?.inicio).toBeNull()
    }
  })
})

describe('una única ficha por grupo nacional', () => {
  it('mantiene disponibles las copias territoriales como respaldo si falla el lector principal', () => {
    for (const nombre of ['PRIMERA DIVISIÓN', 'Campeonato Nacional de Liga de Segunda División', 'SEGUNDA FEDERACIÓN FEMENINA', 'DIVISIÓN DE HONOR JUVENIL', 'Campeonato de Segunda División B Fútbol Sala']) expect(categoriaDuplicadaNovanet({ nombre, familia: '' }, 'cantabria'), nombre).toBe(false)
    for (const nombre of ['PRIMERA DIVISIÓN EXTREMEÑA', 'Tercera Federación', 'Fase Autonómica Copa Federación', 'ELIMINATORIA AUTONÓMICA DE ACCESO FASE PREVIA COPA S.M. EL REY']) expect(categoriaDuplicadaNovanet({ nombre, familia: '' }, 'extremadura'), nombre).toBe(false)
  })
  it('comparte identidad entre territorios y mantiene las rutas FFCV publicadas', () => {
    const c = { nombre: 'TERCERA FEDERACIÓN FUTFEM', familia: 'Femenino' }
    expect(idGrupoNovanet('murcia', c, { codigo: '1', nombre: 'Grupo VI' })).toBe('ffcv-905431519')
    expect(idGrupoNovanet('rfef', c, { codigo: '999', nombre: 'Grupo VI' })).toBe('ffcv-905431519')
    expect(idGrupoNovanet('asturias', c, { codigo: '2', nombre: 'Grupo I' })).toBe(idGrupoNovanet('galicia', c, { codigo: '3', nombre: 'Grupo 1' }))
    expect(idGrupoNovanet('murcia', { nombre: 'Tercera División de Futsal', familia: '' }, { codigo: '4', nombre: 'Grupo 14' })).toBe('ffcv-905431873')
    expect(idGrupoNovanet('aragon', { nombre: 'Liga Nacional Juvenil', familia: '' }, { codigo: '5', nombre: 'Grup - VIII' })).toBe('ffcv-905431879')
    expect(idGrupoNovanet('rfef', { nombre: 'Liga Nacional Juvenil', familia: '' }, { codigo: '999', nombre: 'Grupo VIII' })).toBe('ffcv-905431879')
    expect(idGrupoNovanet('cantabria', { nombre: 'Segunda Federación', familia: '' }, { codigo: '9', nombre: 'Grupo 1' })).toBe(idGrupoNovanet('rfef', { nombre: 'Campeonato Nacional de Liga de Segunda Federación', familia: 'Fútbol' }, { codigo: '33836092', nombre: 'FASE REGULAR - GRUPO 1' }))
    expect(idGrupoNovanet('euskadi', { nombre: 'PRIMERA FEDERACIÓN', familia: 'Masculino' }, { codigo: '8', nombre: 'GRUPO 1' })).toBe('primera-federacion-group-1')
    expect(idGrupoNovanet('euskadi', { nombre: 'Primera Federación de Fútbol Femenino', familia: '' }, { codigo: '7', nombre: '1 - Único' })).toBe('rfef-33836145')
  })
  it('no sustituye datos válidos por una copia vacía ni mezcla temporadas', () => {
    const c = { id: 'ffcv-905431519', temporada: '2026-2027', agenda: { estado: 'actualizado', eventos: [{ id: 'real' }] }, clasificacion: { estado: 'no_disponible', tablas: [] } } as unknown as CompeticionDeportiva
    const n = { ...c, agenda: { estado: 'no_disponible', eventos: [] }, clasificacion: { estado: 'actualizado', tablas: [{ id: 'tabla' }] } } as unknown as CompeticionDeportiva
    expect(fusionaCompeticionesFutbol([c], [n])).toEqual([{ ...c, clasificacion: n.clasificacion }])
    expect(fusionaCompeticionesFutbol([c], [{ ...n, temporada: '2025-2026' }])).toEqual([c])
    expect(fusionaCompeticionesFutbol([{ ...c, temporada: 'Por confirmar' }], [n])).toEqual([n])
  })
})

describe('consulta pública de Madrid', () => {
  const esperadaMadrid = { ...esperada, competicion: '26738226', grupo: '26738227' }
  it.each([
    { estado: '0', codigo_competicion: '26738226', codigo_grupo: '26738227', tipoEstado: 'string' },
    { estado: 1, codigo_competicion: '26738226', codigo_grupo: '26738227', tipoEstado: 'number' },
    { estado: '1', codigo_competicion: '999', codigo_grupo: '26738227', tipoEstado: 'string' },
    { estado: '1', codigo_competicion: '26738226', codigo_grupo: '999', tipoEstado: 'string' },
  ])('mantiene el rechazo estricto y un diagnóstico interno acotado: %j', datos => {
    let error: unknown
    try { parseaAgendaMadrid(JSON.stringify({ ...datos, equipos: 'NO_PUBLICAR', cookie: 'NO_PUBLICAR' }), esperadaMadrid, fuente) } catch (e) { error = e }
    expect(error).toMatchObject({ message: 'Madrid devuelve otra competición o grupo', diagnosticoMadrid: {
      estado: String(datos.estado), tipoEstado: datos.tipoEstado,
      competicionEsperada: esperadaMadrid.competicion, grupoEsperado: esperadaMadrid.grupo,
      competicionRecibida: datos.codigo_competicion, grupoRecibido: datos.codigo_grupo,
    } })
    expect(JSON.stringify(error)).toBe('{}')
    expect(String(error)).not.toContain('NO_PUBLICAR')
  })
  it('no incluye textos arbitrarios recibidos dentro del diagnóstico de identidad', () => {
    let error: unknown
    try { parseaAgendaMadrid(JSON.stringify({ estado: 'NO_PUBLICAR', codigo_competicion: { cuerpo: 'NO_PUBLICAR' }, codigo_grupo: 'NO_PUBLICAR' }), esperadaMadrid, fuente) } catch (e) { error = e }
    expect(error).toMatchObject({ diagnosticoMadrid: { estado: null, tipoEstado: 'string', competicionRecibida: null, grupoRecibido: null } })
  })
  it('envía el diagnóstico sólo al registro del robot y mantiene los avisos públicos sin detalles internos', async () => {
    vi.useFakeTimers()
    try {
      const ahora = Date.parse('2026-11-07T16:00:00Z'); vi.setSystemTime(ahora)
      const estado = normalizaEstadoNovanet({ version: 1, catalogo: { temporada: { codigo: '22', nombre: '2026-2027' }, verificadoEn: new Date(ahora).toISOString(),
        categorias: [{ codigo: esperadaMadrid.competicion, nombre: 'TERCERA FEDERACIÓN RFEF', familia: 'Fútbol', grupos: [{ codigo: esperadaMadrid.grupo, nombre: 'GRUPO VII' }] }] } })
      const log = vi.fn(), fetcher = vi.fn(async (url: RequestInfo | URL) => {
        if (String(url).includes('/api/group-rounds')) return new Response(JSON.stringify({ estado: '1', jornadas: [{ codjornada: '9', nombre: '9', fecha_jornada: '01-11-2026' }] }))
        if (String(url).includes('/api/results')) return new Response(JSON.stringify({ estado: '0', codigo_competicion: esperadaMadrid.competicion, codigo_grupo: esperadaMadrid.grupo, cookie: 'NO_PUBLICAR' }))
        return new Response('<script id="__NEXT_DATA__">' + JSON.stringify({ props: { pageProps: { season: { cod_temporada: '22', nombre: '2026-2027' },
          standings: { estado: '1', codigo_competicion: esperadaMadrid.competicion, codigo_grupo: '999', equipos: 'NO_PUBLICAR' } } } }) + '</script>')
      })
      const pendiente = obtieneNovanet({ ahora, fuentesNovanet: ['madrid'], estadoNovanet: { madrid: estado }, fetcher, log })
      await vi.runAllTimersAsync()
      const salida = await pendiente
      const diagnosticos = log.mock.calls.map(([s]) => s).filter(s => s.startsWith('Madrid · diagnóstico'))
      expect(diagnosticos).toHaveLength(2)
      expect(diagnosticos[0]).toContain('"estado":"0"')
      expect(diagnosticos[1]).toContain('"grupoRecibido":"999"')
      expect(JSON.stringify(log.mock.calls)).not.toContain('NO_PUBLICAR')
      expect(salida.incidencias.filter(i => i.motivo === 'Madrid devuelve otra competición o grupo')).toHaveLength(2)
      expect(JSON.stringify(salida)).not.toMatch(/diagnosticoMadrid|grupoRecibido|competicionEsperada|NO_PUBLICAR/)
      expect(salida.competiciones).toHaveLength(0)
      expect(fetcher).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })
  it('contrasta marcadores finales y clasificación de Tercera grupo7', () => {
    const eventos = parseaAgendaMadrid(fixture('madrid-agenda.json'), esperadaMadrid, 'https://www.rffm.es/competicion/resultados-y-jornadas')
    expect(eventos[0]).toMatchObject({ local: 'CLUB SIELLO NUEVO BOADILLA F.C.', resultado: { local: 1, visitante: 4 }, inicio: '2026-11-01T10:30:00.000Z', estado: 'finalizado' })
    const tabla = parseaClasificacionMadrid(fixture('madrid-tabla.html'), esperadaMadrid)[0]
    expect(tabla.filas[0]).toMatchObject({ nombre: "C.D. MOSTOLES U.R.J.C. 'A'", valores: { puntos: 20, jugados: 9, favor: 21, contra: 6 } })
  })
  it('un cero inicial sin acta cerrada no es un resultado final', () => {
    const json = JSON.parse(fixture('madrid-agenda.json'))
    Object.assign(json.partidos[0], { acta_cerrada: '0', Goles_casa: '0', Goles_visitante: '0' })
    expect(parseaAgendaMadrid(JSON.stringify(json), esperadaMadrid, fuente)[0].resultado).toBeNull()
    expect(() => parseaAgendaMadrid(fixture('madrid-agenda.json'), { ...esperadaMadrid, jornada: '10' }, fuente)).toThrow('jornada')
    expect(() => parseaClasificacionMadrid(fixture('madrid-tabla.html'), { ...esperadaMadrid, temporada: '2025-2026' })).toThrow('temporada')
  })
})

describe('sesión anónima normal de la federación', () => {
  it('conserva la cookie entre redirecciones y descifra correctamente los acentos de ISO-8859-15', async () => {
    let hora = 0
    const peticiones: Array<{ url: string; cookie?: string }> = []
    const fetcher = (async (entrada: RequestInfo | URL, init?: RequestInit) => {
      const url = String(entrada), cookie = new Headers(init?.headers).get('cookie') || undefined
      peticiones.push({ url, cookie })
      if (peticiones.length === 1) return new Response(null, { status: 302, headers: { location: '/pnfg/NLogin', 'Set-Cookie': 'anonimo=consulta; Path=/pnfg; Secure; HttpOnly' } })
      if (peticiones.length === 2) return new Response(null, { status: 302, headers: { location: '/pnfg/calendario' } })
      return new Response(new Uint8Array([0xC1, 0x72, 0x61, 0x62, 0x61]), { headers: { 'Content-Type': 'text/html;charset=ISO-8859-15' } })
    }) as typeof fetch
    const sesion = creaSesionFederativa('https://federacion.example/pnfg/', { fetcher, reloj: () => hora, espera: async ms => { hora += ms } })
    expect((await sesion.leer('/pnfg/calendario')).html).toBe('Áraba')
    expect(peticiones[0].cookie).toBeUndefined()
    expect(peticiones.slice(1).every(p => p.cookie === 'anonimo=consulta')).toBe(true)
    expect(sesion.estadisticas()).toEqual({ peticiones: 3, bytes: 5 })
  })
  it('no envía cookies fuera de la ruta ni sigue redirecciones a portales desconocidos', async () => {
    let hora = 0
    const cookies: Array<string | null> = []
    const fetcher = (async (_entrada: RequestInfo | URL, init?: RequestInit) => {
      cookies.push(new Headers(init?.headers).get('cookie'))
      return cookies.length === 1 ? new Response('ok', { headers: { 'Set-Cookie': 'anonimo=consulta; Path=/privado; Secure' } }) : new Response(null, { status: 302, headers: { location: 'https://ajeno.example/recibir' } })
    }) as typeof fetch
    const sesion = creaSesionFederativa('https://federacion.example/pnfg/', { fetcher, reloj: () => hora, espera: async ms => { hora += ms } })
    await sesion.leer('/pnfg/inicio')
    await expect(sesion.leer('/pnfg/calendario')).rejects.toThrow('fuera')
    expect(cookies).toEqual([null, null])
  })
  it('detiene un 429, guarda su descanso y no hace un reintento oculto', async () => {
    let llamadas = 0, pausa = ''
    const fetcher = (async () => { llamadas++; return new Response('Límite', { status: 429, headers: { 'Retry-After': '3600' } }) }) as typeof fetch
    const sesion = creaSesionFederativa('https://federacion.example/pnfg/', { fetcher, reloj: () => Date.parse('2026-11-07T14:00:00Z'), alLimite: f => { pausa = f } })
    await expect(sesion.leer('/pnfg/calendario')).rejects.toThrow('limitado')
    expect(llamadas).toBe(1)
    expect(pausa).toBe('2026-11-07T15:00:00.000Z')
  })
})

describe('checkpoint de categorías y grupos territoriales', () => {
  const semilla = () => normalizaEstadoNovanet({ version: 1, catalogo: { ...parseaCatalogoNovanet(fixture('catalogo.html')), verificadoEn: '2026-11-07T12:00:00.000Z' }, categoria: 3, noConsultarAntes: '2026-11-07T14:00:00Z', ventana: { desde: '2026-11-07T12:00:00Z', peticiones: 80 } })
  it('conserva el punto más reciente, la pausa más larga y el mayor contador de esa hora', () => {
    const viejo = checkpointNovanet(semilla(), Date.parse('2026-11-07T12:01:00Z'))
    const nuevo = checkpointNovanet({ ...semilla(), categoria: 4, noConsultarAntes: '2026-11-07T13:00:00Z', ventana: { ...viejo.ventana, peticiones: 20 } }, Date.parse('2026-11-07T12:20:00Z'))
    const estado = recuperaEstadoNovanet([viejo, nuevo])
    expect(estado.categoria).toBe(4)
    expect(estado.noConsultarAntes).toBe('2026-11-07T14:00:00.000Z')
    expect(estado.ventana.peticiones).toBe(80)
    expect(JSON.stringify(checkpointNovanet({ ...estado, cookie: 'secreto' }))).not.toContain('secreto')
    expect(estado.completos).toEqual({})
    expect(normalizaEstadoNovanet({ ...estado, completos: { '33836091-33836092': '2026-11-07T12:00:00Z', invalido: 'ayer' } }).completos).toEqual({ '33836091-33836092': '2026-11-07T12:00:00.000Z' })
  })
  it('un 429 conserva el grupo pendiente y la siguiente pasada no consulta antes de tiempo', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T17:00:00Z'))
    try {
      let llamadas = 0, guardado = normalizaEstadoNovanet({})
      const fetcher = (async () => { llamadas++; return new Response('Límite', { status: 429, headers: { 'Retry-After': '3600' } }) }) as typeof fetch
      const opciones = { fetcher, fuentesNovanet: ['rfef'], guardarEstadoNovanet: (_id: string, estado: typeof guardado) => { guardado = estado } }
      await obtieneNovanet(opciones)
      expect(llamadas).toBe(1)
      expect(guardado.noConsultarAntes).toBe('2026-11-07T18:00:00.000Z')
      expect(guardado.ventana.peticiones).toBe(1)
      await obtieneNovanet({ ...opciones, estadoNovanet: { rfef: guardado } })
      expect(llamadas).toBe(1)
    } finally { vi.useRealTimers() }
  })
  it('tres páginas vacías detienen las consultas y guardan una hora de descanso', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T17:00:00Z'))
    try {
      const catalogo = { temporada: { codigo: '22', nombre: '2026-2027' }, verificadoEn: '2026-11-07T16:00:00Z', categorias: [{ codigo: esperada.competicion, nombre: esperada.nombre, familia: 'Fútbol', grupos: [{ codigo: esperada.grupo, nombre: 'Grupo1' }] }] }
      let llamadas = 0, guardado = normalizaEstadoNovanet({ version: 1, catalogo })
      const fetcher = (async () => { llamadas++; return new Response('') }) as typeof fetch
      const pendiente = obtieneNovanet({ fetcher, fuentesNovanet: ['rfef'], estadoNovanet: { rfef: guardado }, guardarEstadoNovanet: (_id, estado) => { guardado = estado } })
      await vi.advanceTimersByTimeAsync(5000)
      const r = await pendiente
      expect(llamadas).toBe(3)
      expect(guardado.grupo).toBe(0)
      expect(Date.parse(guardado.noConsultarAntes || '')).toBeGreaterThanOrEqual(Date.parse('2026-11-07T18:00:00Z'))
      expect(r.competiciones).toHaveLength(0)
      expect(r.incidencias.some(i => i.motivo.includes('tres páginas vacías'))).toBe(true)
    } finally { vi.useRealTimers() }
  })
  it('si falla una jornada no reemplaza la agenda completa ni cuenta el grupo como completo', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-07T17:00:00Z'))
    try {
      const catalogo = { temporada: { codigo: '22', nombre: '2026-2027' }, verificadoEn: '2026-11-07T16:00:00Z', categorias: [{ codigo: esperada.competicion, nombre: esperada.nombre, familia: 'Fútbol', grupos: [{ codigo: esperada.grupo, nombre: 'Grupo1' }] }] }
      let guardado = normalizaEstadoNovanet({ version: 1, catalogo })
      const fetcher = (async entrada => {
        const url = String(entrada)
        if (url.includes('_Exec')) return new Response(fixture('jornadas.html'))
        if (url.includes('VisClasificacion')) return new Response(fixture('segunda-clasificacion.html'))
        return url.endsWith('CodJornada=9') ? new Response(fixture('segunda-jornada-9.html')) : new Response('Fallo', { status: 503 })
      }) as typeof fetch
      const pendiente = obtieneNovanet({ fetcher, fuentesNovanet: ['rfef'], estadoNovanet: { rfef: guardado }, guardarEstadoNovanet: (_id, estado) => { guardado = estado } })
      await vi.advanceTimersByTimeAsync(5000)
      const r = await pendiente
      expect(r.competiciones[0].agenda.eventos).toHaveLength(0)
      expect(r.competiciones[0].clasificacion.tablas).toHaveLength(1)
      expect(guardado.completos).toEqual({})
      expect(r.rfefResueltas).toEqual([])
    } finally { vi.useRealTimers() }
  })
})
