import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { construyeIndiceDeportes } from '../scripts/lib/deportes-indice.mjs'
import type { CompeticionDeportiva } from '../scripts/lib/deportes.mjs'
import { buildCompeticionDeportesPage, tarjetaEvento } from '../src/html/deportes'

const ahora = Date.parse('2026-11-07T13:00:00Z'), sello = new Date(ahora).toISOString(), fuente = 'https://federacion.example/calendario'
const competicion = (id = 'liga-prueba', genero: 'femenino' | 'masculino' = 'femenino'): CompeticionDeportiva => ({
  id, deporte: 'baloncesto', nombre: 'Liga territorial', temporada: '2026/2027', categoria: 'Sénior', zona: 'Gipuzkoa', genero,
  fuente: { nombre: 'Federación', url: fuente }, comprobadoEn: sello,
  agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, eventos: [{ id: 'partido', nombre: 'Águilas – Bosque', local: 'Águilas', visitante: 'Bosque', inicio: '2026-11-07T17:30:00Z', estado: 'programado' }] },
  clasificacion: { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, tablas: [] },
})
const datos = () => construyeIndiceDeportes([competicion()], [], ahora)
async function solicita(indice: unknown, agenda: unknown, ruta = '/deportes/baloncesto?fecha=2026-11-07') {
  const app = (await import('../src/index')).default
  return app.request(ruta, {}, { ASSETS: { fetch: async (req: Request) => {
    const path = new URL(req.url).pathname
    return path.endsWith('/index.json') ? Response.json(indice) : path.includes('/agenda/') ? Response.json(agenda) : new Response(null, { status: 404 })
  } } })
}

describe('auditoría de copias deportivas antes de mostrarlas', () => {
  beforeEach(() => { vi.resetModules(); vi.spyOn(Date, 'now').mockReturnValue(ahora); vi.spyOn(console, 'error').mockImplementation(() => {}) })
  afterEach(() => vi.restoreAllMocks())

  it.each(['competicion_nula', 'participantes_no_lista', 'fecha_indice_invalida'])(
    'un índice mal formado (%s) ofrece 503 y un aviso, nunca una excepción 500', async caso => {
      const { indice, agendas } = datos()
      const corrupto = structuredClone(indice) as unknown as Record<string, unknown>
      if (caso === 'competicion_nula') corrupto.competiciones = [null]
      if (caso === 'participantes_no_lista') (corrupto.competiciones as Record<string, unknown>[])[0].participantes = {}
      if (caso === 'fecha_indice_invalida') corrupto.dias = [{}]
      const r = await solicita(corrupto, { eventos: agendas['madrid/2026-11-07'] }, '/deportes/baloncesto?fecha=2026-11-07&q=aguilas')
      expect(r.status).toBe(503)
      expect(await r.text()).not.toContain('Internal Server Error')
    },
  )

  it.each(['evento_nulo', 'hora_imposible', 'partido_de_otro_dia', 'temporada_incorrecta'])(
    'una agenda incoherente (%s) se anuncia como no disponible, conservando acceso a las competiciones', async caso => {
      const { indice, agendas } = datos()
      const eventos = structuredClone(agendas['madrid/2026-11-07']) as unknown as Record<string, unknown>[]
      if (caso === 'evento_nulo') (eventos as unknown[])[0] = null
      if (caso === 'hora_imposible') eventos[0].inicio = 'fecha-invalida'
      if (caso === 'partido_de_otro_dia') eventos[0].inicio = '2026-11-09T17:30:00Z'
      if (caso === 'temporada_incorrecta') eventos[0].temporada = '2025/2026'
      const r = await solicita(indice, { eventos })
      expect(r.status).toBe(503)
      const html = await r.text()
      expect(html).toContain('No se ha podido cargar la agenda')
      expect(html).toContain('Liga territorial')
      expect(html).not.toContain('class="event-time"')
    },
  )

  it('combina búsqueda sin acentos, territorio, categoría y modalidad sin mezclar ligas', async () => {
    const c = competicion(), otra = competicion('liga-masculina', 'masculino')
    otra.nombre = 'Otra liga'
    const { indice, agendas } = construyeIndiceDeportes([c, otra], [], ahora)
    const r = await solicita(indice, { eventos: agendas['madrid/2026-11-07'] }, '/deportes/baloncesto?fecha=2026-11-07&q=aguilas&zona=Gipuzkoa&categoria=S%C3%A9nior&genero=femenino')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('Liga territorial')
    expect(html).not.toContain('Otra liga')
    expect(html).toContain('1 eventos')
  })

  it('una fecha fuera del intervalo no se anuncia como cero partidos comprobados', async () => {
    const { indice } = datos()
    const r = await solicita(indice, { eventos: [] }, '/deportes/baloncesto?fecha=2027-01-01')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('No tenemos una agenda comprobada para esta fecha')
    expect(html).toContain('Agenda no disponible')
    expect(html).not.toContain('0 eventos')
  })

  it('un fin de semana de motor pertenece también a su día intermedio sin inventar una hora', async () => {
    const c = competicion()
    c.deporte = 'motor'; c.nombre = 'F4 España'; delete c.genero
    c.agenda.eventos = [{ id: 'ronda', nombre: 'Jerez', fecha: '2026-11-06', finFecha: '2026-11-08', estado: 'programado' }]
    const { indice, agendas } = construyeIndiceDeportes([c], [], ahora)
    const r = await solicita(indice, { eventos: agendas['canarias/2026-11-07'] }, '/deportes/motor?fecha=2026-11-07&horario=canarias')
    expect(r.status).toBe(200)
    const html = await r.text()
    expect(html).toContain('Jerez'); expect(html).toContain('Hora por confirmar')
    expect(html).toContain('1 eventos')
  })

  it('la etiqueta de un partido en juego usa la misma zona horaria elegida para su consulta', () => {
    const c = competicion(), e = { ...c.agenda.eventos[0], estado: 'en_juego' as const, competicion: c.nombre, competicionId: c.id, deporte: c.deporte, temporada: c.temporada, conservado: false, verificadoEn: sello }
    const html = tarjetaEvento(e, 'canarias')
    expect(html).toContain('En juego al consultar · 7 nov 2026, 13:00')
    expect(html).not.toContain('En juego al consultar · 7 nov 2026, 14:00')
  })

  it('la ficha normaliza la página fraccionaria antes de recortar su calendario', () => {
    const c = competicion()
    c.agenda.eventos = Array.from({ length: 60 }, (_, n) => ({ id: 'partido-' + n, nombre: 'Partido ' + n, fecha: '2026-11-08', estado: 'programado' as const }))
    const html = buildCompeticionDeportesPage(c, 'nonce', 'https://sitio.example/deportes/competicion/liga-prueba', new URL('https://sitio.example/deportes/competicion/liga-prueba?p=1.5'), 'madrid')
    expect(html).toContain('Página 1 de 3')
    expect(html).toContain('Partido 0')
    expect(html).not.toContain('Página 1.5')
  })
})
