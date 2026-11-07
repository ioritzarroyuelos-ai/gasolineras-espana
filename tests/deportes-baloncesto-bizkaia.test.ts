import { describe, expect, it, vi } from 'vitest'
import fixtureRaw from './fixtures/deportes-baloncesto/bizkaia-grupo.json?raw'
import { basePublicaBizkaia, grupoBaloncestoOW, obtieneBaloncestoBizkaia, respuestaBaloncestoOW, temporadaBaloncestoOW } from '../scripts/lib/deportes-baloncesto-bizkaia.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'

const ahora = Date.parse('2026-11-07T15:00:00Z')
const fixture = () => JSON.parse(fixtureRaw)
const contexto = { id: 'basket-bizkaia-2830', temporada: { codigo: '2026', nombre: '2026-2027' }, categoria: { codigo: '650', nombre: 'SENIOR FEMENINA', familia: 'F' }, grupo: { codigo: '2830', nombre: 'GRUPO ÚNICO' }, zona: 'Bizkaia', territorio: '2', fuenteNombre: 'Federación Vizcaína de Baloncesto', fuenteUrl: 'https://bizkaiabasket.com/es/pagina-de-grupo/?id=2830' }
const pagina = `<script id="owbasket-js-extra">var process = {"env":{"REACT_APP_URL_ESB":"https://esb.optimalwayconsulting.com/esf/1/configPublicaDePrueba"}};</script><div data-name="CompetitionSearch" data-props='{"dzone":"2"}'></div>`
describe('baloncesto territorial Bizkaia', () => {
  it('lee el marcador publicado, convierte la hora de Bizkaia y mantiene un partido pendiente sin resultado', () => {
    const c = grupoBaloncestoOW([fixture()], contexto, ahora)
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
    expect(c.agenda.eventos[0].resultado).toEqual({ local: 43, visitante: 59 })
    expect(c.agenda.eventos[1]).toMatchObject({ inicio: '2026-11-07T17:00:00.000Z', estado: 'programado' })
    expect(c.agenda.eventos[1].resultado).toBeUndefined()
    expect(c.clasificacion.tablas[0].filas[0]).toMatchObject({ nombre: 'ERANDIO ALTZAGA MONTAJES MECCANO ESP', valores: { puntos: 12, pj: 7, pg: 5, pp: 2 } })
  })
  it('identifica la categoría cuando el nombre oficial solo dice Fase Previa', () => {
    const d = fixture(); d.group.competitionName = 'Fase Previa'
    expect(grupoBaloncestoOW([d], contexto, ahora).nombre).toBe('SENIOR FEMENINA · Fase Previa')
  })
  it.each(['grupo', 'temporada', 'categoria', 'territorio', 'partido', 'futuro'])(
    'rechaza respuesta incoherente: %s', caso => {
      const d = fixture()
      if (caso === 'grupo') d.group.idGroup = '999'
      if (caso === 'temporada') d.group.season = '2025'
      if (caso === 'categoria') d.group.idCategory = '999'
      if (caso === 'territorio') d.group.idTerritorial = '1'
      if (caso === 'partido') d.rounds[1].matches[0].idGroup = '999'
      if (caso === 'futuro') d.rounds[1].matches[0].matchDay = '2026-11-10 18:00:00'
      expect(() => grupoBaloncestoOW([d], contexto, ahora)).toThrow()
    },
  )
  it('respeta los marcadores que la federación decide no publicar y evita un 0-0 inventado', () => {
    const d = fixture(); d.group.resultsVisibles = '0'
    const c = grupoBaloncestoOW([d], contexto, ahora)
    expect(c.agenda.eventos.every(e => !e.resultado)).toBe(true)
    expect(c.clasificacion.tablas).toEqual([])
    d.group.resultsVisibles = '1'; d.rounds[1].matches[1].localScore = '0'; d.rounds[1].matches[1].visitorScore = '0'
    expect(grupoBaloncestoOW([d], contexto, ahora).agenda.eventos[1].resultado).toBeUndefined()
  })
  it('distingue equipos con el mismo nombre y rechaza una identidad repetida', () => {
    const d = fixture(), fila = d.standing[0]
    fila.idTeam = '4895'; d.standing.push({ ...fila, idTeam: '4890', position: '6' })
    expect(grupoBaloncestoOW([d], contexto, ahora).clasificacion.tablas[0].filas).toHaveLength(d.standing.length)
    d.standing.at(-1).idTeam = fila.idTeam
    const c = grupoBaloncestoOW([d], contexto, ahora)
    expect(c.clasificacion.estado).toBe('no_disponible')
    expect(c.agenda.eventos).toHaveLength(2)
  })
  it('no duplica partidos repetidos entre dos jornadas y no trata medianoche como hora confirmada', () => {
    const d = fixture(); d.rounds[1].matches[1].matchDay = '2026-11-07 00:00:00'
    const c = grupoBaloncestoOW([d, d], contexto, ahora)
    expect(c.agenda.eventos).toHaveLength(2)
    expect(c.agenda.eventos[1].inicio).toBeUndefined()
    expect(c.agenda.eventos[1].fecha).toBe('2026-11-07')
  })
  it('descarta una fecha centinela y no presenta como jugado un marcador previo de tipo P', () => {
    const d = fixture(); const pendiente = d.rounds[1].matches[1]
    pendiente.matchDay = '2100-01-01 00:00:00'; pendiente.idMatchResult = null
    const sinFecha = grupoBaloncestoOW([d], contexto, ahora).agenda.eventos[1]
    expect(sinFecha.fecha).toBeUndefined(); expect(sinFecha.inicio).toBeUndefined()
    pendiente.matchDay = '2026-11-14 18:00:00'; pendiente.state = '1'; pendiente.idMatchResult = '12345'; pendiente.typeResult = 'P'; pendiente.localScore = '20'; pendiente.visitorScore = '0'
    const previo = grupoBaloncestoOW([d], contexto, ahora).agenda.eventos[1]
    expect(previo.estado).toBe('por_confirmar'); expect(previo.resultado).toBeUndefined()
    expect(previo.detalle).toContain('antes de la fecha')
  })
  it('admite cuadros de eliminatorias como objeto sin convertir sus cifras incompletas en marcadores finales', () => {
    const d = fixture()
    d.playoffs = { 1827: { matches: { 148392: { idMatch: '148392', matchDate: '2026-09-26 17:00:00', nameLocalTeam: 'Local abreviado', nameVisitorTeam: 'Visitante abreviado', scoreLocal: '77', scoreVisitor: '48' } } } }
    const c = grupoBaloncestoOW([d], contexto, ahora)
    expect(c.agenda.eventos).toHaveLength(2)
    expect(c.agenda.eventos.some(e => e.id === 'partido-148392')).toBe(false)
    expect(c.agenda.eventos[0].resultado).toEqual({ local: 43, visitante: 59 })
  })
  it('solo admite la configuración pública esperada y una temporada activa real', () => {
    expect(basePublicaBizkaia(pagina).zona).toBe('2')
    expect(() => basePublicaBizkaia(pagina.replace('esb.optimalwayconsulting.com', 'sitio-ajeno.example'))).toThrow()
    const t = [{ idSeason: '2026', name: '2026/2027', active: '1', beginDate: '2026-07-01', finalDate: '2027-06-30' }]
    expect(temporadaBaloncestoOW(t, ahora).codigo).toBe('2026')
    expect(() => temporadaBaloncestoOW([...t, ...t], ahora)).toThrow()
    expect(() => temporadaBaloncestoOW(t, Date.parse('2028-01-01'))).toThrow()
    expect(() => respuestaBaloncestoOW(btoa(JSON.stringify({ result: 'ERROR', message: 'ACCESS DENIED' })))).toThrow()
  })
  it('un descanso guardado impide consultar de nuevo, y un 429 se conserva antes de salir', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } }))
    const guarda = vi.fn()
    const pausa = { version: 1, noConsultarAntes: new Date(ahora + 3600000).toISOString() }
    await obtieneBaloncestoBizkaia({ fetcher, relojBizkaia: () => ahora, guardarEstadoNovanet: guarda, estadoNovanet: { 'basket-bizkaia': pausa } })
    expect(fetcher).not.toHaveBeenCalled()
    await obtieneBaloncestoBizkaia({ fetcher, relojBizkaia: () => ahora, guardarEstadoNovanet: guarda })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(guarda.mock.calls.at(-1)?.[1]).toMatchObject({ noConsultarAntes: pausa.noConsultarAntes, ventana: { peticiones: 1 } })
  })
  it.each(['temporada', 'balance'])('conserva los partidos válidos si solo falla la tabla: %s', caso => {
    const d = fixture()
    if (caso === 'temporada') d.standing[0].season = '2025'
    else d.standing[0].matchPlayed = '99'
    const c = grupoBaloncestoOW([d], contexto, ahora)
    expect(c.agenda.estado).toBe('actualizado'); expect(c.agenda.eventos).toHaveLength(2)
    expect(c.clasificacion.estado).toBe('no_disponible'); expect(c.clasificacion.tablas).toEqual([])
    expect(c.clasificacion.verificadoEn).toBeUndefined()
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
  })
  it('mantiene la clasificación actual si falla la jornada anterior y permite conservar la agenda completa', async () => {
    const d = fixture(); d.lastRound = 2
    const respuesta = (datos: unknown) => new Response(btoa(JSON.stringify({ result: 'OK', messageData: datos })))
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.endsWith('/resultados-y-clasificaciones/')) return new Response(pagina)
      if (u.endsWith('/Season/getActiveWebVisibility')) return respuesta([{ idSeason: '2026', name: '2026/2027', active: '1', beginDate: '2026-07-01', finalDate: '2027-06-30' }])
      if (u.endsWith('/FCBQWeb/resultats/2830')) return respuesta(d)
      return new Response('', { status: 503 })
    })
    const salida = await obtieneBaloncestoBizkaia({ fetcher, relojBizkaia: () => ahora, duermeBizkaia: async () => {}, estadoNovanet: { 'basket-bizkaia': {
      version: 1, catalogo: { temporada: contexto.temporada, verificadoEn: new Date(ahora).toISOString(), categorias: [{ ...contexto.categoria, grupos: [contexto.grupo] }] }, categoria: 0, grupo: 0,
    } } })
    expect(salida.competiciones).toHaveLength(1)
    expect(salida.competiciones[0].clasificacion.estado).toBe('actualizado')
    expect(salida.competiciones[0].agenda.estado).toBe('no_disponible')
    expect(salida.competiciones[0].agenda.eventos).toEqual([])
  })
})
