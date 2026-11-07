import { describe, expect, it } from 'vitest'
import identidades from './fixtures/deportes-motor-alkamel/identidades-pr216.json'
import { ampliaEspanaAlkamel, fuenteAlkamelEspana } from '../scripts/lib/deportes-motor-alkamel.mjs'
import { conservaCompeticionDeportiva, validarCompeticionDeportiva, type CompeticionDeportiva, type EventoDeportivo, type IncidenciaDeportes } from '../scripts/lib/deportes.mjs'

const sello = '2026-11-07T20:20:00.000Z', ahora = Date.parse(sello)
// Tabla de control para probar identidad; los nombres, URLs, fechas, horas e
// IDs de cada caso proceden de las24sesiones reales de PR216 y su calendario.
const csv = 'POS;NUMBER;LAPS;TIME;TEAM;DRIVER_FIRSTNAME;DRIVER_SECONDNAME\n1;7;5;1:23.000;Equipo;Nombre;Apellido\n'
const prepara = (caso: typeof identidades.casos[number]) => {
  const ruta = decodeURIComponent(new URL(caso.fuenteUrl).pathname).split('/'), evento = ruta[3], nombre = evento.slice(evento.indexOf('_') + 1)
  const html = `<select name="season"><option selected value="03_2026">2026</option></select><select name="evvent"><option selected value="${evento}">${nombre}</option></select><a href="${caso.fuenteUrl}">Classification</a>`
  const c: CompeticionDeportiva = { id: caso.competicionId, deporte: 'motor', nombre: caso.competicionId, temporada: '2026', categoria: 'Monoplazas', zona: 'Europa', fuente: { nombre: 'Campeonato', url: 'https://f4spain.org/' }, comprobadoEn: sello,
    agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: 'https://f4spain.org/', eventos: structuredClone(caso.primarias) as EventoDeportivo[] },
    clasificacion: { estado: 'no_disponible', consultado: sello, fuenteUrl: 'https://f4spain.org/', tablas: [] } }
  return { c, leer: async (url: string) => url === fuenteAlkamelEspana ? html : csv }
}

describe('todas las identidades añadidas en la primera lectura real de Alkamel', () => {
  it.each(identidades.casos)('$nombre · $fecha · $hora conserva o diferencia el evento que demuestra la fuente', async caso => {
    const { c, leer } = prepara(caso), cantidad = c.agenda.eventos.length, incidencias: IncidenciaDeportes[] = []
    await ampliaEspanaAlkamel([c], leer, 2026, ahora, sello, incidencias)
    expect(incidencias).toEqual([])
    expect(c.agenda.estado).toBe('actualizado')
    expect(c.agenda.eventos).toHaveLength(cantidad + (caso.esperado ? 0 : 1))
    const resultado = c.agenda.eventos.filter(e => e.resultados?.length)
    expect(resultado).toHaveLength(1)
    expect(resultado[0].id).toBe(caso.esperado || caso.id)
    expect(resultado[0].fecha).toBe(caso.fecha)
    if (/official-previous-test/.test(caso.id)) expect(resultado[0].nombre).toContain('Pruebas oficiales')
    if (caso.lugar === 'Monza') {
      expect(resultado[0].detalle).toContain('publican horas distintas')
      expect(c.agenda.eventos.filter(e => !e.resultados?.length).every(e => e.detalle?.includes('publican horas distintas'))).toBe(true)
    }
    expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
  })
  it('el inventario completo incluye19duplicados demostrables y5eventos sin identidad coincidente', () => {
    expect(identidades.casos).toHaveLength(24)
    expect(identidades.casos.filter(c => c.esperado)).toHaveLength(19)
    expect(identidades.casos.filter(c => !c.esperado && c.lugar === 'Monza')).toHaveLength(2)
  })
  it('reprocesa juntas las24sesiones de ambos campeonatos y deja cero pares con la misma identidad y hora', async () => {
    const catalogo = new Map<string, { nombre: string; urls: string[] }>()
    for (const caso of identidades.casos) {
      const ruta = decodeURIComponent(new URL(caso.fuenteUrl).pathname).split('/'), evento = ruta[3]
      if (!catalogo.has(evento)) catalogo.set(evento, { nombre: evento.slice(evento.indexOf('_') + 1), urls: [] })
      catalogo.get(evento)!.urls.push(caso.fuenteUrl)
    }
    const pagina = (elegido: string) => `<select name="season"><option selected value="03_2026">2026</option></select><select name="evvent">${[...catalogo].map(([id, c]) => `<option ${id === elegido ? 'selected' : ''} value="${id}">${c.nombre}</option>`).join('')}</select>${catalogo.get(elegido)!.urls.map(url => `<a href="${url}">Classification</a>`).join('')}`
    const competiciones = ['formula-4-espana', 'eurocup-3'].map(id => {
      const casos = identidades.casos.filter(c => c.competicionId === id), { c } = prepara(casos[0])
      c.agenda.eventos = [...new Map(casos.flatMap(c => c.primarias).map(e => [e.id, structuredClone(e)] as const)).values()] as EventoDeportivo[]
      return c
    })
    const cantidades = competiciones.map(c => c.agenda.eventos.length), incidencias: IncidenciaDeportes[] = []
    await ampliaEspanaAlkamel(competiciones, async url => url.endsWith('.CSV') ? csv : pagina(new URL(url).searchParams.get('evvent') || '24_BARCELONA'), 2026, ahora, sello, incidencias)
    expect(incidencias).toHaveLength(0)
    for (const [i, c] of competiciones.entries()) {
      const casos = identidades.casos.filter(caso => caso.competicionId === c.id)
      expect(c.agenda.eventos).toHaveLength(cantidades[i] + casos.filter(caso => !caso.esperado).length)
      for (const caso of casos) expect(c.agenda.eventos.find(e => e.id === (caso.esperado || caso.id))?.resultados).toHaveLength(1)
      const claves = c.agenda.eventos.filter(e => /Pruebas oficiales/.test(e.nombre)).map(e => `${e.jornada}|${e.lugar}|${e.fecha}|${e.detalle?.match(/Hora publicada:\s*(\d\d:\d\d)/)?.[1]}`)
      expect(new Set(claves).size).toBe(claves.length)
      expect(() => validarCompeticionDeportiva(c, ahora)).not.toThrow()
    }
  })
  it.each(['hora', 'fecha', 'familia'])('una identidad distinta por %s no se fusiona por el número generado', async diferencia => {
    const caso = identidades.casos.find(c => c.esperado?.endsWith('-official-test-2'))!, { c, leer } = prepara(caso)
    const original = c.agenda.eventos.find(e => e.id === caso.esperado)!
    if (diferencia === 'hora') original.detalle = original.detalle!.replace(caso.hora, '23:59')
    if (diferencia === 'fecha') { original.fecha = '2026-04-30'; original.finFecha = caso.fecha }
    if (diferencia === 'familia') original.id = original.id.replace('official-test', 'race')
    const cantidad = c.agenda.eventos.length
    await ampliaEspanaAlkamel([c], leer, 2026, ahora, sello, [])
    expect(c.agenda.eventos).toHaveLength(cantidad + 1)
    expect(original.resultados).toBeUndefined()
    if (diferencia === 'fecha') expect(c.agenda.eventos.find(e => e.id === caso.id)?.detalle).toContain('Las fechas o las horas publicadas')
  })
  it('dos candidatas idénticas conservan la agenda anterior en vez de escoger por orden', async () => {
    const caso = identidades.casos.find(c => c.esperado)!, { c, leer } = prepara(caso), anterior = structuredClone(c)
    const original = c.agenda.eventos.find(e => e.id === caso.esperado)!
    c.agenda.eventos.push({ ...original, id: 'otra-identidad-official-test' })
    await ampliaEspanaAlkamel([c], leer, 2026, ahora, sello, [])
    expect(c.agenda.estado).toBe('no_disponible')
    expect(conservaCompeticionDeportiva(c, anterior).agenda.estado).toBe('conservado')
  })
  it('dos documentos no sustituyen la misma primaria ni borran la última sesión de la agenda', async () => {
    const caso = identidades.casos.find(c => c.competicionId === 'eurocup-3' && c.lugar === 'Paul Ricard' && c.hora === '11:00')!, { c, leer } = prepara(caso)
    const sprint: EventoDeportivo = { id: 'eurocup-3-circuit-paul-ricard-sprint', nombre: 'Paul Ricard · Carrera sprint', fecha: '2026-05-02', inicio: null, estado: 'por_confirmar', lugar: 'Paul Ricard', jornada: caso.jornada }
    c.agenda.eventos = c.agenda.eventos.filter(e => e.id !== sprint.id)
    c.agenda.eventos.push(sprint)
    const anterior = structuredClone(c), referencias = c.agenda.eventos, cantidad = referencias.length, incidencias: IncidenciaDeportes[] = []
    const segundoUrl = caso.fuenteUrl.replaceAll('Test%201', 'Test%202')
    await ampliaEspanaAlkamel([c], async url => url === fuenteAlkamelEspana ? await leer(url) + `<a href="${segundoUrl}">Otra clasificación</a>` : csv, 2026, ahora, sello, incidencias)
    expect(incidencias.some(i => i.motivo.includes('misma sesión'))).toBe(true)
    expect(referencias).toHaveLength(cantidad)
    expect(referencias.at(-1)).toEqual(sprint)
    expect(new Set(referencias.map(e => e.id)).size).toBe(cantidad)
    expect(c.agenda.estado).toBe('no_disponible')
    const conservada = conservaCompeticionDeportiva(c, anterior)
    expect(conservada.agenda.estado).toBe('conservado')
    expect(conservada.agenda.verificadoEn).toBe(anterior.agenda.verificadoEn)
    expect(conservada.agenda.eventos.at(-1)).toEqual(sprint)
    expect(() => validarCompeticionDeportiva(conservada, ahora)).not.toThrow()
  })
})
