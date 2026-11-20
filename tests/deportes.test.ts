import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { validarCompeticionDeportiva, conservaCompeticionDeportiva, fechaDeportiva, leerFuenteDeportiva, type CompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import { construyeIndiceDeportes } from '../scripts/lib/deportes-indice.mjs'
import { tarjetaEvento, buildCompeticionDeportesPage } from '../src/html/deportes'
import { filtraCompeticiones, etiquetaEstadoDeporte } from '../src/lib/deportes'

const ahora = Date.parse('2026-11-07T13:00:00Z'), sello = new Date(ahora).toISOString(), fuente = 'https://federacion.example/calendario'
function competicion(): CompeticionDeportiva { return {
  id: 'liga-prueba', deporte: 'futbol', nombre: 'Liga de pruebas', temporada: '2026-2027', categoria: 'Sénior', zona: 'España', fuente: { nombre: 'Federación de prueba', url: fuente }, comprobadoEn: sello,
  agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, eventos: [
    { id: 'partido-1', nombre: 'Águilas – Bosque', local: 'Águilas', visitante: 'Bosque', inicio: '2026-11-07T23:30:00Z', estado: 'programado' },
    { id: 'carrera-1', nombre: 'Fin de semana', fecha: '2026-11-06', finFecha: '2026-11-08', estado: 'programado' },
    { id: 'sin-fecha', nombre: 'Encuentro aplazado', estado: 'aplazado' },
  ] },
  clasificacion: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, tablas: [{ id: 'tabla', nombre: 'Clasificación', columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: 'Águilas', valores: { puntos: 12 } }] }] },
} }
describe('datos deportivos verificables', () => {
  it('rechaza fechas imposibles, verificación futura, enlaces peligrosos y horas sin zona', () => {
    expect(fechaDeportiva('2026-02-30')).toBe(false)
    for (const cambia of [
      (c: CompeticionDeportiva) => { c.agenda.verificadoEn = '2027-01-01T00:00:00Z' },
      (c: CompeticionDeportiva) => { c.agenda.eventos[0].inicio = '2026-11-07T18:00:00' },
      (c: CompeticionDeportiva) => { c.agenda.eventos[0].inicio = '2026-02-30T18:00:00Z' },
      (c: CompeticionDeportiva) => { c.fuente.url = 'javascript:alert(1)' },
      (c: CompeticionDeportiva) => { c.agenda.eventos.push(c.agenda.eventos[0]) },
      (c: CompeticionDeportiva) => { c.clasificacion.tablas[0].filas[0].valores = {} },
    ]) { const c = competicion(); cambia(c); expect(() => validarCompeticionDeportiva(c, ahora)).toThrow() }
  })
  it('un fallo conserva únicamente el apartado anterior y nunca rejuvenece su fecha', () => {
    const anterior = competicion(), nuevo = competicion()
    nuevo.clasificacion = { estado: 'no_disponible', consultado: '2026-11-08T13:00:00Z', fuenteUrl: fuente, tablas: [] }
    nuevo.agenda.verificadoEn = nuevo.agenda.consultado = '2026-11-08T13:00:00Z'
    const c = conservaCompeticionDeportiva(nuevo, anterior)
    expect(c.clasificacion.estado).toBe('conservado')
    expect(c.clasificacion.verificadoEn).toBe(sello)
    expect(c.agenda.verificadoEn).toBe('2026-11-08T13:00:00Z')
    nuevo.temporada = '2027-2028'
    expect(conservaCompeticionDeportiva(nuevo, anterior).clasificacion.tablas).toEqual([])
    nuevo.temporada = 'Por confirmar'
    nuevo.agenda = { estado: 'no_disponible', consultado: '2026-11-08T13:00:00Z', fuenteUrl: fuente, eventos: [] }
    const sinFuente = conservaCompeticionDeportiva(nuevo, anterior)
    expect(sinFuente.temporada).toBe(anterior.temporada)
    expect(sinFuente.agenda.verificadoEn).toBe(sello)
    expect(sinFuente.agenda.estado).toBe('conservado')
  })
  it('el mismo partido cambia de día entre Canarias y la Península; un fin de semana incluye sus tres días', () => {
    const { agendas } = construyeIndiceDeportes([competicion()], [], ahora)
    expect(agendas['madrid/2026-11-08'].some(e => e.id === 'partido-1')).toBe(true)
    expect(agendas['canarias/2026-11-07'].some(e => e.id === 'partido-1')).toBe(true)
    for (const d of ['06', '07', '08']) expect(agendas['madrid/2026-11-' + d].some(e => e.id === 'carrera-1')).toBe(true)
    expect(Object.values(agendas).flat().some(e => e.id === 'sin-fecha')).toBe(false)
  })
  it('buscar un equipo encuentra la competición aunque solo figure en su clasificación', () => {
    const c = competicion(); c.agenda.eventos = []
    const { indice } = construyeIndiceDeportes([c], [], ahora)
    expect(filtraCompeticiones(indice.competiciones, { q: 'aguilas' })).toHaveLength(1)
    expect(filtraCompeticiones(indice.competiciones, { q: 'aguilas', zona: 'Portugal' })).toHaveLength(0)
  })
  it('un grupo enumerado pero sin datos comprobados no cuenta como competición disponible', () => {
    const c = competicion()
    c.agenda = { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, eventos: [] }
    c.clasificacion = { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, tablas: [] }
    const { indice } = construyeIndiceDeportes([c], [], ahora)
    expect(filtraCompeticiones(indice.competiciones, {})).toEqual([])
    indice.competiciones[0].agenda = { ...indice.competiciones[0].agenda, estado: 'conservado', verificadoEn: sello }
    expect(filtraCompeticiones(indice.competiciones, {})).toHaveLength(1)
  })
  it('no muestra un 0-0 pendiente como marcador ni un partido consultado como directo actual', () => {
    const c = competicion(), e = c.agenda.eventos[0]
    e.resultado = { local: 0, visitante: 0 }
    const html = tarjetaEvento({ ...e, competicion: c.nombre, competicionId: c.id, deporte: c.deporte, temporada: c.temporada, conservado: false, verificadoEn: sello }, 'madrid')
    expect(html).not.toContain('class="score">0')
    expect(html).toContain('Sin retransmisión confirmada para España')
    expect(etiquetaEstadoDeporte({ ...e, estado: 'en_juego' }, sello)).toContain('al consultar')
    const final = tarjetaEvento({ ...e, estado: 'finalizado', competicion: c.nombre, competicionId: c.id, deporte: c.deporte, temporada: c.temporada, conservado: false }, 'madrid')
    expect(final).not.toContain('Emisión publicada')
    expect(final).toContain('Sin retransmisión confirmada para España')
  })
  it('pide confirmar el resultado desde la hora prevista, sin modificar la fecha ni inventar un marcador', () => {
    const e = { ...competicion().agenda.eventos[0], inicio: '2026-11-07T13:00:00Z' }
    const original = structuredClone(e)
    expect(etiquetaEstadoDeporte(e, sello, 'madrid', ahora - 1)).toBe('Programado')
    expect(etiquetaEstadoDeporte(e, sello, 'madrid', ahora)).toBe('Resultado por confirmar')
    expect(etiquetaEstadoDeporte(e, sello, 'canarias', ahora + 1)).toBe('Resultado por confirmar')
    expect(e).toEqual(original)
    const reloj = vi.spyOn(Date, 'now').mockReturnValue(ahora)
    try {
      const html = tarjetaEvento({ ...e, competicion: 'Liga de pruebas', competicionId: 'liga-prueba', deporte: 'futbol', temporada: '2026-2027', conservado: false, verificadoEn: sello }, 'madrid')
      expect(html).toContain('Resultado por confirmar')
      expect(html).toContain('14:00')
      expect(html.match(/class="score">—/g)).toHaveLength(2)
      expect(html).not.toContain('Finalizado')
    } finally { reloj.mockRestore() }
  })
  it('sin hora, conserva Programado todo el día local y respeta el final de los eventos de varios días', () => {
    const evento = { id: 'fecha-sola', nombre: 'Encuentro', fecha: '2026-11-07', estado: 'programado' as const }
    const medianochePeninsula = Date.parse('2026-11-07T23:00:00Z')
    expect(etiquetaEstadoDeporte(evento, sello, 'madrid', medianochePeninsula - 1)).toBe('Programado')
    expect(etiquetaEstadoDeporte(evento, sello, 'madrid', medianochePeninsula)).toBe('Resultado por confirmar')
    expect(etiquetaEstadoDeporte(evento, sello, 'canarias', medianochePeninsula)).toBe('Programado')
    expect(etiquetaEstadoDeporte(evento, sello, 'canarias', Date.parse('2026-11-08T00:00:00Z'))).toBe('Resultado por confirmar')
    const finDeSemana = competicion().agenda.eventos[1]
    expect(etiquetaEstadoDeporte(finDeSemana, sello, 'madrid', Date.parse('2026-11-08T22:59:59Z'))).toBe('Programado')
    expect(etiquetaEstadoDeporte(finDeSemana, sello, 'madrid', Date.parse('2026-11-08T23:00:00Z'))).toBe('Resultado por confirmar')
    expect(etiquetaEstadoDeporte({ ...evento, fecha: undefined }, sello, 'madrid', ahora)).toBe('Programado')
  })
  it('conserva los estados confirmados por la fuente aunque haya pasado la hora prevista', () => {
    const evento = { ...competicion().agenda.eventos[0], inicio: '2026-11-06T13:00:00Z' }
    for (const [estado, etiqueta] of Object.entries({ finalizado: 'Finalizado', aplazado: 'Aplazado', cancelado: 'Cancelado', por_confirmar: 'Por confirmar' })) {
      expect(etiquetaEstadoDeporte({ ...evento, estado: estado as typeof evento.estado }, sello, 'madrid', ahora)).toBe(etiqueta)
    }
    expect(etiquetaEstadoDeporte({ ...evento, estado: 'en_juego' }, sello, 'madrid', ahora)).toContain('En juego al consultar')
  })
  it('un rango RFEDA con hora inicial espera al último día y no se trata como una sesión aislada', () => {
    const evento = { id: 'rfeda-1', nombre: 'Fin de semana RFEDA', fecha: '2026-11-07', finFecha: '2026-11-08', inicio: '2026-11-07T09:00:00Z', estado: 'programado' as const }
    const original = structuredClone(evento)
    expect(etiquetaEstadoDeporte(evento, sello, 'madrid', ahora)).toBe('Programado')
    const finEnPeninsula = Date.parse('2026-11-08T23:00:00Z')
    expect(etiquetaEstadoDeporte(evento, sello, 'madrid', finEnPeninsula - 1)).toBe('Programado')
    expect(etiquetaEstadoDeporte(evento, sello, 'madrid', finEnPeninsula)).toBe('Resultado por confirmar')
    expect(etiquetaEstadoDeporte(evento, sello, 'canarias', finEnPeninsula)).toBe('Programado')
    expect(etiquetaEstadoDeporte(evento, sello, 'canarias', Date.parse('2026-11-09T00:00:00Z'))).toBe('Resultado por confirmar')
    expect(etiquetaEstadoDeporte({ ...evento, finFecha: evento.fecha }, sello, 'madrid', ahora)).toBe('Resultado por confirmar')
    expect(evento).toEqual(original)
  })
  it('escapa textos externos y no añade estilos en línea', () => {
    const c = competicion(); c.nombre = '<script>alert(1)</script>'
    const html = buildCompeticionDeportesPage(c, 'nonce', 'https://sitio.example/deportes/competicion/liga-prueba', new URL('https://sitio.example/deportes/competicion/liga-prueba'), 'madrid')
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>alert(1)')
    expect(html).not.toMatch(/\sstyle=/)
  })
  it('rechaza respuestas vacías, fallidas o demasiado grandes', async () => {
    for (const res of [new Response('', { status: 200 }), new Response('', { status: 503 }), new Response('x', { headers: { 'content-length': '999999999' } })]) {
      await expect(leerFuenteDeportiva(fuente, { fetcher: vi.fn(async () => res) as typeof fetch })).rejects.toThrow()
    }
  })
})
describe('rutas de deportes', () => {
  beforeEach(() => { vi.resetModules(); vi.spyOn(Date, 'now').mockReturnValue(ahora) })
  afterEach(() => vi.restoreAllMocks())
  it('filtros, agendas y fichas funcionan con una fuente comprobada y no interfieren con otras rutas', async () => {
    const c = competicion(), { indice, agendas } = construyeIndiceDeportes([c], [], ahora)
    const app = (await import('../src/index')).default
    const ASSETS = { fetch: async (req: Request | string | URL) => {
      const p = new URL(req instanceof Request ? req.url : String(req)).pathname
      if (p.endsWith('/index.json')) return Response.json(indice)
      if (p.endsWith('/liga-prueba.json')) return Response.json(c)
      if (p.includes('/agenda/')) return Response.json({ eventos: agendas[p.split('/agenda/')[1].replace('.json', '')] || [] })
      return new Response(null, { status: 404 })
    } }
    const page = await app.request('/deportes/futbol?q=aguilas&fecha=2026-11-08', {}, { ASSETS })
    expect(page.status).toBe(200); expect(await page.text()).toContain('Águilas')
    expect(page.headers.get('cache-control')).toBe('no-store')
    const comp = await app.request('/deportes/competicion/liga-prueba', {}, { ASSETS })
    expect(comp.status).toBe(200); expect(await comp.text()).toContain('Clasificación')
    expect((await app.request('/deportes/no-existe', {}, { ASSETS })).status).toBe(404)
    expect((await app.request('/itv/precios', {}, { ASSETS })).status).toBe(200)
    const sitemap = await app.request('/sitemap-deportes.xml', {}, { ASSETS })
    expect(await sitemap.text()).toContain('/deportes/competicion/liga-prueba')
  })
  it('retira el acceso directo a una ficha que nunca tuvo datos comprobados', async () => {
    const c = competicion()
    c.agenda = { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, eventos: [] }
    c.clasificacion = { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, tablas: [] }
    const app = (await import('../src/index')).default
    const ASSETS = { fetch: async () => Response.json(c) }
    expect((await app.request('/deportes/competicion/liga-prueba', {}, { ASSETS })).status).toBe(404)
  })
  it('sin copia verificada ofrece un aviso y no una lista vacía supuestamente actual', async () => {
    const app = (await import('../src/index')).default
    const r = await app.request('/deportes/', {}, { ASSETS: { fetch: async () => new Response(null, { status: 404 }) } })
    expect(r.status).toBe(503); expect(await r.text()).toContain('preparando los datos')
  })
})
