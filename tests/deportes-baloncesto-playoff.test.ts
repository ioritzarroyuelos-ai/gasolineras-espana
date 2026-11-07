import { describe, expect, it, vi } from 'vitest'
import { descubreConsejos, catalogoConsejo, identidadConsejo, agendaConsejo, clasificacionConsejo, obtieneBaloncestoConsejos, PAGINA_CONSELL } from '../scripts/lib/deportes-baloncesto-playoff.mjs'
import { validarCompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import { normalizaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'
const archivos = import.meta.glob('./fixtures/deportes-baloncesto/playoff-*.html', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const fixture = (nombre: string) => archivos['./fixtures/deportes-baloncesto/playoff-' + nombre + '.html']
const cursos = descubreConsejos(fixture('origen')), curso = cursos[0], contexto = { portal: 'ces', url: curso.url, temporada: curso.temporada }, ahora = Date.parse('2026-11-07T20:00:00Z')
const grupos = catalogoConsejo(fixture('sabadell-catalogo'), curso.url, curso)

describe('consejos deportivos: fuentes escolares independientes', () => {
  it('descubre la temporada y todos los grupos de ambos catálogos, excluyendo otros deportes', () => {
    expect(cursos.map(c => [c.portal, c.temporada])).toEqual([['ces', '2026-2027'], ['cevot', '2026-2027']])
    expect(grupos).toHaveLength(1)
    const terrassa = catalogoConsejo(fixture('terrassa-catalogo'), cursos[1].url, cursos[1])
    expect(terrassa).toHaveLength(12)
    expect(terrassa.some(g => /LLEURE/.test(g.nombre))).toBe(true)
    expect(terrassa[0].genero).toBeUndefined() // nombre masculino frente a código mixto en la fuente
    expect(grupos[0].genero).toBe('mixto')
  })
  it('rechaza otra temporada o un enlace de grupo ajeno al portal', () => {
    expect(() => catalogoConsejo(fixture('sabadell-catalogo'), curso.url, { ...curso, temporada: '2025-2026' })).toThrow('otra temporada')
    expect(() => catalogoConsejo(fixture('sabadell-catalogo').replaceAll('data-href="CompeticioResultatsWeb.php', 'data-href="https://otro.example/CompeticioResultatsWeb.php'), curso.url, curso)).toThrow('Enlace')
    expect(() => identidadConsejo(fixture('ficha'), { ...grupos[0], codigo: '999' }, curso)).toThrow('otro grupo')
    expect(identidadConsejo(fixture('ficha'), grupos[0], curso).jornada).toBe('9566')
  })
  it('une los resultados al calendario sin confundir juego limpio con canastas y convierte el horario local', () => {
    const eventos = agendaConsejo(fixture('agenda'), fixture('resultados'), contexto, ahora)
    expect(eventos).toHaveLength(12)
    expect(eventos[0]).toMatchObject({ inicio: '2026-10-24T08:30:00.000Z', resultado: { local: 15, visitante: 50 }, estado: 'finalizado' })
    expect(eventos[2]).toMatchObject({ fecha: '2026-11-06', inicio: '2026-11-06T17:30:00.000Z', estado: 'por_confirmar' })
    expect(eventos.find(e => e.fecha === '2026-11-28' && !e.inicio)?.detalle).toBe('Hora por confirmar.')
    expect(eventos.filter(e => e.resultado)).toHaveLength(2)
  })
  it('no anuncia final ni marcador del mismo día o del futuro aunque aparezcan dos números', () => {
    for (const dia of ['07-11-2026', '08-11-2026']) {
      const eventos = agendaConsejo(fixture('agenda').replaceAll('24-10-2026', dia), fixture('resultados').replaceAll('24-10-2026', dia), contexto, ahora)
      expect(eventos[0]).toMatchObject({ estado: 'por_confirmar' })
      expect(eventos[0].resultado).toBeUndefined()
    }
  })
  it('rechaza emparejamientos, fechas o duplicados incongruentes entre publicaciones', () => {
    expect(() => agendaConsejo(fixture('agenda'), fixture('resultados').replace('53617', '99999'), contexto, ahora)).toThrow('ajeno')
    expect(() => agendaConsejo(fixture('agenda'), fixture('resultados').replace('15 ', 'falso '), contexto, ahora)).toThrow('Marcador')
    expect(() => agendaConsejo(fixture('agenda').replaceAll('24-10-2026', '31-02-2026'), '', contexto, ahora)).toThrow('Fecha')
    expect(() => agendaConsejo(fixture('agenda').replaceAll('24-10-2026', '24-01-2026'), '', contexto, ahora)).toThrow('temporada')
    expect(() => agendaConsejo(fixture('agenda'), fixture('resultados').replace('53618', '53617'), contexto, ahora)).toThrow('no coinciden')
  })
  it('mantiene todas las columnas y su orden, incluidas juego limpio y valores', () => {
    const tabla = clasificacionConsejo(fixture('tabla'), '1187')[0]
    expect(tabla.filas).toHaveLength(4)
    expect(tabla.columnas.map(c => c.nombre)).toContain('JN')
    expect(tabla.filas[0].valores).toMatchObject({ c0: 1, c4: 50, c7: 3, c9: 6 })
    const otra = clasificacionConsejo(fixture('terrassa-tabla'), '1875')[0]
    expect(otra.filas).toHaveLength(10)
    expect(otra.columnas.map(c => c.nombre)).toContain('PUNTSVALORS')
    expect(() => clasificacionConsejo(fixture('tabla').replace('<strong>2</strong>', '<strong>1</strong>'), '1187')).toThrow('Posiciones')
  })
})

describe('lectura escolar y conservación independiente', () => {
  const origenSoloSabadell = fixture('origen').replaceAll('https://cevot.playoffinformatica.com', 'https://no-utilizado.example')
  function lector(fallo = '') {
    return vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url), body = String(init?.body || '')
      if (u === PAGINA_CONSELL) return new Response(origenSoloSabadell)
      if (u.includes('CompeticioEntradaWeb')) return new Response(fixture('sabadell-catalogo'))
      if (u.includes('CompeticioResultatsWeb')) return new Response(fixture('ficha'))
      if (body.includes('resum_resultats_grup')) return new Response(fixture('resultados'))
      if (body.includes('calendari')) return new Response(fixture('agenda'))
      if (body.includes('resultats_classificacions')) return fallo === 'tabla' ? new Response('Tabla rota') : fallo === '429' ? new Response('Pausa', { status: 429, headers: { 'Retry-After': '7200' } }) : new Response(fixture('tabla'))
      throw Error('Consulta inesperada: ' + u)
    })
  }
  it('valida una lectura completa y mantiene agenda si falla la tabla', async () => {
    for (const fallo of ['', 'tabla']) {
      const r = await obtieneBaloncestoConsejos({ fetcher: lector(fallo), relojConsejos: () => ahora, duermeConsejos: async () => {} })
      expect(r.competiciones).toHaveLength(1)
      expect(() => validarCompeticionDeportiva(r.competiciones[0], ahora)).not.toThrow()
      expect(r.competiciones[0].agenda.eventos).toHaveLength(12)
      expect(r.competiciones[0].clasificacion.estado).toBe(fallo ? 'no_disponible' : 'actualizado')
    }
  })
  it('persiste Retry-After y no consulta el portal durante la pausa siguiente', async () => {
    const estado: Record<string, ReturnType<typeof normalizaEstadoNovanet>> = {}, fetcher = lector('429')
    const opciones = { fetcher, relojConsejos: () => ahora, duermeConsejos: async () => {}, estadoNovanet: estado, guardarEstadoNovanet: (id: string, e: ReturnType<typeof normalizaEstadoNovanet>) => { estado[id] = normalizaEstadoNovanet(e) } }
    const r = await obtieneBaloncestoConsejos(opciones)
    expect(r.competiciones[0].agenda.eventos).toHaveLength(12)
    expect(estado['basket-consejo-ces'].noConsultarAntes).toBe('2026-11-07T22:00:00.000Z')
    fetcher.mockClear()
    await obtieneBaloncestoConsejos(opciones)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0][0]).toBe(PAGINA_CONSELL)
  })
  it('no renueva verificaciones al fallar ambos bloques', async () => {
    const base = lector(), fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => String(url).includes('peticioAjax') ? new Response('Error', { status: 503 }) : base(url, init))
    const r = await obtieneBaloncestoConsejos({ fetcher, relojConsejos: () => ahora, duermeConsejos: async () => {} })
    expect(r.competiciones).toEqual([])
    expect(r.incidencias).toHaveLength(2)
    expect(fetcher.mock.calls.some(([, init]) => String(init?.body).includes('resultats_classificacions'))).toBe(false)
  })
  it('guarda la pausa expresa de la portada del organizador y no vuelve a consultarla', async () => {
    const estado: Record<string, ReturnType<typeof normalizaEstadoNovanet>> = {}, fetcher = vi.fn(async () => new Response('Pausa', { status: 429, headers: { 'Retry-After': '7200' } }))
    const opciones = { fetcher, relojConsejos: () => ahora, estadoNovanet: estado, guardarEstadoNovanet: (id: string, e: ReturnType<typeof normalizaEstadoNovanet>) => { estado[id] = normalizaEstadoNovanet(e) } }
    await obtieneBaloncestoConsejos(opciones)
    expect(estado['basket-consejos-origen'].noConsultarAntes).toBe('2026-11-07T22:00:00.000Z')
    fetcher.mockClear()
    await obtieneBaloncestoConsejos(opciones)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['origen', 'portal'])('persiste una pausa segura si Retry-After desborda Date en %s', async destino => {
    const estado: Record<string, ReturnType<typeof normalizaEstadoNovanet>> = {}, base = lector()
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => (destino === 'origen' ? String(url) === PAGINA_CONSELL : String(url).includes('peticioAjax')) ? new Response('Pausa', { status: 429, headers: { 'Retry-After': '999999999999999' } }) : base(url, init))
    const opciones = { fetcher, relojConsejos: () => ahora, duermeConsejos: async () => {}, estadoNovanet: estado, guardarEstadoNovanet: (id: string, e: ReturnType<typeof normalizaEstadoNovanet>) => { estado[id] = normalizaEstadoNovanet(e) } }
    await obtieneBaloncestoConsejos(opciones)
    expect(estado[destino === 'origen' ? 'basket-consejos-origen' : 'basket-consejo-ces'].noConsultarAntes).toBe('2026-11-07T21:00:00.000Z')
    fetcher.mockClear()
    await obtieneBaloncestoConsejos(opciones)
    expect(fetcher).toHaveBeenCalledTimes(destino === 'origen' ? 0 : 1)
  })
  it.each([403, 200])('detiene las consultas si encuentra protección de acceso con HTTP %s', async status => {
    const base = lector(), fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => String(url).includes('peticioAjax') ? new Response('captcha', { status }) : base(url, init))
    let guardado = normalizaEstadoNovanet(null)
    const r = await obtieneBaloncestoConsejos({ fetcher, relojConsejos: () => ahora, duermeConsejos: async () => {}, guardarEstadoNovanet: (_id, e) => { guardado = normalizaEstadoNovanet(e) } })
    expect(r.competiciones).toEqual([])
    expect(fetcher.mock.calls.filter(([u]) => String(u).includes('peticioAjax'))).toHaveLength(1)
    expect(guardado.noConsultarAntes).toBe('2026-11-07T21:00:00.000Z')
  })
  it('rechaza una tabla de equipos ajenos y conserva el calendario válido', async () => {
    const base = lector(), fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => String(init?.body).includes('resultats_classificacions') ? new Response(fixture('tabla').replaceAll('ESCOLA MIQUEL MARTÍ I POL', 'OTRO EQUIPO')) : base(url, init))
    const r = await obtieneBaloncestoConsejos({ fetcher, relojConsejos: () => ahora, duermeConsejos: async () => {} })
    expect(r.competiciones[0].agenda.eventos).toHaveLength(12)
    expect(r.competiciones[0].clasificacion.tablas).toEqual([])
    expect(r.incidencias[0].motivo).toContain('ajenos')
  })
  it('al agotar su presupuesto no avanza el cursor ni vuelve a consultar', async () => {
    let estado = normalizaEstadoNovanet({ version: 1, ventana: { desde: new Date(ahora).toISOString(), peticiones: 118 } })
    const fetcher = lector(), r = await obtieneBaloncestoConsejos({ fetcher, relojConsejos: () => ahora, duermeConsejos: async () => {}, estadoNovanet: { 'basket-consejo-ces': estado }, guardarEstadoNovanet: (_id, e) => { estado = normalizaEstadoNovanet(e) } })
    expect(r.competiciones).toEqual([])
    expect(estado.categoria).toBe(0)
    expect(estado.ventana.peticiones).toBe(120)
    expect(fetcher).toHaveBeenCalledTimes(3) // organizador más ficha y catálogo
    expect(estado.noConsultarAntes).toBe('2026-11-07T21:00:00.000Z')
  })
})
