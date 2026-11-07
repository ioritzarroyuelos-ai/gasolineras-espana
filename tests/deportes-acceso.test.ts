import { afterEach, describe, expect, it, vi } from 'vitest'
import { construyeIndiceDeportes } from '../scripts/lib/deportes-indice.mjs'
import { filtraCompeticiones, textoBusquedaCompeticion, type CompeticionDeportiva } from '../src/lib/deportes'

const ahora = Date.parse('2026-11-07T13:00:00Z'), sello = new Date(ahora).toISOString()
function liga(id = 'acb-liga-endesa'): CompeticionDeportiva {
  return {
    id, nombre: 'Liga Endesa', deporte: 'baloncesto', temporada: '2026-2027', categoria: 'Sénior nacional', zona: 'España', genero: 'masculino',
    fuente: { nombre: 'Asociación de Clubes de Baloncesto', url: 'https://federacion.example/' }, comprobadoEn: sello,
    agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: 'https://federacion.example/', eventos: [
      { id: 'partido-aguilas', nombre: 'Águilas – Bosque', local: 'Águilas', visitante: 'Bosque', fecha: '2026-11-07', estado: 'programado' },
      { id: 'partido-rio', nombre: 'Río – Montaña', local: 'Río', visitante: 'Montaña', fecha: '2026-11-07', estado: 'programado' },
    ] },
    clasificacion: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: 'https://federacion.example/', tablas: [
      { id: 'general', nombre: 'Clasificación general', columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: 'Águilas', valores: { puntos: 12 } }] },
    ] },
  }
}

describe('encontrar competiciones por sus nombres habituales', () => {
  it.each([
    ['acb-liga-endesa', 'Liga Endesa', 'ACB'],
    ['acb-liga-endesa', 'Liga Endesa', 'liga acb'],
    ['laliga-easports', 'Primera División · LALIGA EA SPORTS', 'la liga'],
    ['laliga-hypermotion', 'Segunda División · LALIGA HYPERMOTION', 'la liga'],
    ['futbol-femenino', 'Liga F Moeve', 'primera division femenina'],
    ['formula-1', 'Fórmula 1', 'F1'],
    ['formula-4-espana', 'Fórmula 4 España', 'F4'],
    ['formula-regional-european', 'Fórmula Regional Europea', 'FREC'],
  ])('encuentra %s al buscar %s como %s', (id, nombre, q) => {
    const c = liga(id); c.nombre = nombre
    const { indice } = construyeIndiceDeportes([c], [], ahora)
    expect(filtraCompeticiones(indice.competiciones, { q }).map(c => c.id)).toEqual([id])
  })
  it('encuentra categorías abreviadas por edad, territorio y federación sin saltarse filtros', () => {
    const c = liga('basket-grupo'); c.nombre = 'PREFERENT'; c.categoria = 'Cadete femenino'; c.zona = 'Illes Balears'; c.genero = 'femenino'
    const { indice } = construyeIndiceDeportes([c], [], ahora)
    for (const q of ['cadete', 'balears', 'asociacion', 'aguilas']) expect(filtraCompeticiones(indice.competiciones, { q })).toHaveLength(1)
    expect(filtraCompeticiones(indice.competiciones, { q: 'cadete', genero: 'masculino' })).toHaveLength(0)
    expect(filtraCompeticiones(indice.competiciones, { q: 'cadete', zona: 'Andalucía' })).toHaveLength(0)
    expect(textoBusquedaCompeticion(indice.competiciones[0], false)).not.toContain('aguilas')
  })
})

describe('búsqueda coherente entre catálogo y partidos', () => {
  afterEach(() => vi.restoreAllMocks())
  it('ACB muestra todos sus partidos, mientras un equipo muestra sólo los suyos', async () => {
    vi.resetModules(); vi.spyOn(Date, 'now').mockReturnValue(ahora)
    const c = liga(), { indice, agendas } = construyeIndiceDeportes([c], [], ahora)
    const app = (await import('../src/index')).default
    const ASSETS = { fetch: async (req: Request | string | URL) => {
      const p = new URL(req instanceof Request ? req.url : String(req)).pathname
      if (p.endsWith('/index.json')) return Response.json(indice)
      if (p.includes('/agenda/')) return Response.json({ eventos: agendas[p.split('/agenda/')[1].replace('.json', '')] || [] })
      return new Response(null, { status: 404 })
    } }
    const acb = await app.request('/deportes/baloncesto?q=ACB', {}, { ASSETS }), acbHtml = await acb.text()
    expect(acb.status).toBe(200)
    expect(acbHtml).toContain('Águilas'); expect(acbHtml).toContain('Montaña')
    const equipo = await app.request('/deportes/baloncesto?q=aguilas', {}, { ASSETS }), equipoHtml = await equipo.text()
    expect(equipo.status).toBe(200)
    expect(equipoHtml).toContain('Águilas'); expect(equipoHtml).not.toContain('Montaña')
  })
})
