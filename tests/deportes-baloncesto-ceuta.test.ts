import { describe, expect, it, vi } from 'vitest'
import { CALENDARIO_CEUTA, conexionPublicaCeuta, temporadaCeuta, gruposCeuta, calendarioCeuta, clasificacionCeuta, obtieneBaloncestoCeuta } from '../scripts/lib/deportes-baloncesto-ceuta.mjs'
import { normalizaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'
const archivos = import.meta.glob('./fixtures/deportes-baloncesto/ceuta*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (n: string) => JSON.parse(archivos['./fixtures/deportes-baloncesto/' + n + '.json'])
const ahora = Date.parse('2026-11-07T19:15:00Z'), temporada = temporadaCeuta(fixture('ceutaTemporadas'), ahora), grupos = gruposCeuta(fixture('ceutaCompeticiones'))
const calendario = (i = 0) => fixture('ceuta-' + grupos[i].id + '-calendar'), tabla = (i = 0) => fixture('ceuta-' + grupos[i].id + '-standings')
const pagina = '<script src="//widget.nbn23.com/widget-react.js.gz"></script><script>swish_widget_app.init({apiKey: "' + ['0'.repeat(8), '0'.repeat(4), '0'.repeat(4), '0'.repeat(4), '0'.repeat(12)].join('-') + '"})</script>'

describe('calendario público vigente de Ceuta', () => {
  it('descubre cinco grupos de la temporada activa y no confunde el archivo antiguo de noticias con el visor', () => {
    expect(conexionPublicaCeuta(pagina)).toHaveLength(36)
    expect(() => conexionPublicaCeuta('<html>Noticias</html>')).toThrow('visor')
    expect(temporada.nombre).toBe('2026-2027')
    expect(grupos).toHaveLength(5)
    expect(() => gruposCeuta(fixture('ceutaCompeticiones').map((c: object) => ({ ...c, projectKey: 'otra-federacion' })))).toThrow('ajena')
    expect(() => temporadaCeuta([...fixture('ceutaTemporadas'), fixture('ceutaTemporadas')[0]], ahora)).toThrow('única')
  })
  it('recupera ochenta partidos y omite descansos sin convertir ceros ni fechas1970 en resultados', () => {
    const resultados = grupos.map((g, i) => calendarioCeuta(calendario(i), g, temporada, ahora))
    expect(resultados.reduce((n, a) => n + a.eventos.length, 0)).toBe(80)
    expect(resultados.flatMap(a => a.eventos).every(e => !e.resultado && !e.inicio?.startsWith('1970'))).toBe(true)
    expect(resultados[0].eventos.some(e => !e.fecha && e.estado === 'por_confirmar')).toBe(true)
    expect(resultados[3].eventos.every(e => e.estado === 'por_confirmar')).toBe(true) // torneo de octubre aún sin resultados publicados
  })
  it('exige identidad de grupo, de temporada y de ambos equipos en el marcador', () => {
    expect(() => calendarioCeuta(calendario(), grupos[1], temporada, ahora)).toThrow('otro grupo')
    const otra = calendario(); otra.rounds[0].seasonId = grupos[0].id
    expect(() => calendarioCeuta(otra, grupos[0], temporada, ahora)).toThrow('temporada')
    const cambiado = calendario(); cambiado.rounds[0].matches[1].score.totals[0].teamId = grupos[0].id
    expect(() => calendarioCeuta(cambiado, grupos[0], temporada, ahora)).toThrow('ambos equipos')
    const fechaImposible = calendario(); fechaImposible.rounds[0].matches[1].date = '2026-11-31T10:00:00Z'
    expect(() => calendarioCeuta(fechaImposible, grupos[0], temporada, ahora)).toThrow('Fecha')
  })
  it.each(['LIVE', 'FINISHED', 'CLOSED'])('no publica un marcador futuro aunque el estado diga %s', status => {
    const c = calendario(), p = c.rounds[0].matches[1]
    p.status = status; p.score.totals[0].total = 10; p.score.totals[1].total = 8
    const e = calendarioCeuta(c, grupos[0], temporada, ahora).eventos.find(e => e.id === 'ceuta-' + p.id)
    expect(e?.estado).toBe('por_confirmar'); expect(e?.resultado).toBeUndefined()
  })
  it('usa los identificadores del equipo y el estado final explícito, aunque cambie el orden de los totales', () => {
    const c = calendario(), p = c.rounds[0].matches[1]
    p.date = '2026-11-07T10:15:00.000Z'; p.status = 'FINISHED'
    p.score.totals[0].total = 72; p.score.totals[1].total = 69; p.score.totals.reverse()
    const e = calendarioCeuta(c, grupos[0], temporada, ahora).eventos.find(e => e.id === 'ceuta-' + p.id)
    expect(e).toMatchObject({ estado: 'finalizado', resultado: { local: 72, visitante: 69 } })
    p.status = 'DEFERRED'
    expect(calendarioCeuta(c, grupos[0], temporada, ahora).eventos.find(e => e.id === 'ceuta-' + p.id)?.resultado).toBeUndefined()
  })
  it('compara la clasificación con los equipos y aclara el orden provisional sin partidos contabilizados', () => {
    const a = calendarioCeuta(calendario(), grupos[0], temporada, ahora), t = clasificacionCeuta(tabla(), grupos[0], a.equipos)[0]
    expect(t.filas).toHaveLength(7)
    expect(t.nombre).toContain('sin partidos contabilizados')
    const ajena = tabla(); ajena[0].teamId = grupos[1].id
    expect(() => clasificacionCeuta(ajena, grupos[0], a.equipos)).toThrow('ajeno')
    expect(() => clasificacionCeuta([], grupos[1])).toThrow('todavía')
  })
})

describe('robot de Ceuta', () => {
  function lector() {
    return vi.fn(async (url: RequestInfo | URL) => {
      const u = new URL(String(url))
      if (String(url) === CALENDARIO_CEUTA) return new Response(pagina + '<script>var et_divi_recaptcha = {};</script>')
      if (u.pathname === '/seasons') return Response.json(fixture('ceutaTemporadas'))
      if (u.pathname === '/competitions') return Response.json(fixture('ceutaCompeticiones'))
      const g = grupos.findIndex(g => g.id === u.searchParams.get('groupId'))
      if (g < 0) throw Error('Grupo no esperado')
      return Response.json(u.pathname === '/calendar' ? calendario(g) : tabla(g))
    })
  }
  it('valida la lectura completa y deja las dos clasificaciones vacías pendientes', async () => {
    const r = await obtieneBaloncestoCeuta({ fetcher: lector(), relojCeuta: () => ahora, duermeCeuta: async () => {} })
    expect(r.competiciones).toHaveLength(5)
    expect(r.competiciones.every(c => validarCompeticionDeportiva(c, ahora))).toBe(true)
    expect(r.incidencias).toHaveLength(2)
    expect(r.competiciones.filter(c => c.clasificacion.estado === 'actualizado')).toHaveLength(3)
  })
  it('si falla agenda conserva la copia anterior y no acepta una tabla sin identidad propia', async () => {
    const base = lector(), fetcher = vi.fn(async (url: RequestInfo | URL) => new URL(String(url)).pathname === '/calendar' ? new Response('Fallo', { status: 503 }) : base(url))
    const r = await obtieneBaloncestoCeuta({ fetcher, relojCeuta: () => ahora, duermeCeuta: async () => {} })
    expect(r.competiciones).toEqual([])
    expect(fetcher.mock.calls.some(([u]) => new URL(String(u)).pathname === '/standings')).toBe(false)
  })
  it.each([403, 429, 200])('pausa toda la fuente y respeta el siguiente intento tras protección HTTP%s', async status => {
    const base = lector(), fetcher = vi.fn(async (url: RequestInfo | URL) => new URL(String(url)).pathname === '/calendar' ? new Response(status === 200 ? 'captcha' : 'Pausa', { status, headers: { 'Retry-After': '7200' } }) : base(url))
    let estado = normalizaEstadoNovanet(null)
    const r = await obtieneBaloncestoCeuta({ fetcher, relojCeuta: () => ahora, duermeCeuta: async () => {}, guardarEstadoNovanet: (_id, e) => { estado = normalizaEstadoNovanet(e) } })
    expect(r.competiciones).toEqual([])
    expect(fetcher).toHaveBeenCalledTimes(4)
    expect(estado.grupo).toBe(0)
    fetcher.mockClear()
    await obtieneBaloncestoCeuta({ fetcher, relojCeuta: () => ahora, duermeCeuta: async () => {}, estadoNovanet: { 'basket-ceuta': estado } })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('persiste una hora de pausa si Retry-After excede el rango de Date', async () => {
    const base = lector(), fetcher = vi.fn(async (url: RequestInfo | URL) => new URL(String(url)).pathname === '/calendar' ? new Response('Pausa', { status: 429, headers: { 'Retry-After': '999999999999999' } }) : base(url))
    let estado = normalizaEstadoNovanet(null)
    await obtieneBaloncestoCeuta({ fetcher, relojCeuta: () => ahora, duermeCeuta: async () => {}, guardarEstadoNovanet: (_id, e) => { estado = normalizaEstadoNovanet(e) } })
    expect(estado.noConsultarAntes).toBe(new Date(ahora + 3600000).toISOString())
    fetcher.mockClear()
    await obtieneBaloncestoCeuta({ fetcher, relojCeuta: () => ahora, estadoNovanet: { 'basket-ceuta': estado } })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
