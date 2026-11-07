import { describe, expect, it, vi } from 'vitest'
import { visorGalicia, listasGalicia, calendarioGalicia, clasificacionGalicia, obtieneBaloncestoGalicia } from '../scripts/lib/deportes-baloncesto-galicia.mjs'
const archivos = import.meta.glob('./fixtures/deportes-baloncesto/*', { query: '?raw', import: 'default', eager: true })
const fixture = (n: string) => String(archivos['./fixtures/deportes-baloncesto/' + n])
const fuente = 'https://fegaba.com/resultados-e-clasificacions/', ahora = Date.parse('2026-11-07T15:00:00Z')
describe('Galicia: calendario público y clasificación de FEGABA', () => {
  it('solo acepta el visor publicado por la federación y opciones con identidad', () => {
    const url = 'https://widgetsfegaba.gesdeportiva.es/widget/informacion/general-delegacion/1?key=11111111-2222-3333-4444-555555555555'
    expect(visorGalicia('<iframe src="' + url + '"></iframe>')).toBe(url)
    expect(() => visorGalicia('<iframe src="' + url.replace('widgetsfegaba', 'otro') + '"></iframe>')).toThrow('visor')
    expect(listasGalicia([{ value: '-1', text: 'Seleccionar' }, { value: '2584', text: '1ª DIV. AUTONÓMICA MASCULINA' }])).toEqual([{ codigo: '2584', nombre: '1ª DIV. AUTONÓMICA MASCULINA' }])
    expect(() => listasGalicia([{ value: '2584', text: 'A' }, { value: '2584', text: 'B' }])).toThrow('duplicado')
  })
  it('lee 56 partidos, 20 resultados y ocho equipos, usando la fecha particular y no la nominal de jornada', () => {
    const agenda = calendarioGalicia(fixture('galicia-calendario.html'), '9590', fuente, ahora)
    expect(agenda.eventos).toHaveLength(56)
    expect(agenda.temporada).toBe('Calendario 2026–2027')
    expect(agenda.eventos.filter(e => e.estado === 'finalizado')).toHaveLength(20)
    expect(agenda.eventos[0]).toMatchObject({ fecha: '2026-10-03', inicio: '2026-10-03T16:00:00.000Z', jornada: 'Jornada 1 - 04/10/2026', resultado: { local: 75, visitante: 73 } })
    const adelantado = agenda.eventos.find(e => e.jornada?.startsWith('Jornada 12') && e.local === 'SOLPOR OBRADOIRO')
    expect(adelantado?.estado).toBe('finalizado')
    expect(adelantado?.fecha?.startsWith('2026-')).toBe(true)
    expect(clasificacionGalicia(fixture('galicia-tabla.html'), '9590')[0].filas).toHaveLength(8)
  })
  it('no da por terminado un partido futuro o del mismo día ni inventa resultados de cero a cero', () => {
    const html = fixture('galicia-calendario.html')
    const futuro = calendarioGalicia(html.replace('03/10/2026 <br>', '03/12/2026 <br>'), '9590', fuente, ahora).eventos[0]
    expect(futuro.estado).toBe('por_confirmar'); expect(futuro.resultado).toBeUndefined()
    const hoy = calendarioGalicia(html.replace('03/10/2026 <br>', '07/11/2026 <br>'), '9590', fuente, ahora).eventos[0]
    expect(hoy.estado).toBe('por_confirmar'); expect(hoy.resultado).toBeUndefined()
    const pendientes = calendarioGalicia(html, '9590', fuente, ahora).eventos.filter(e => e.estado === 'programado')
    expect(pendientes.length).toBeGreaterThan(1)
    expect(pendientes.every(e => !e.resultado)).toBe(true)
    expect(() => calendarioGalicia(html.replace('Jornada  1 - 04/10/2026', 'Sin jornada'), '9590', fuente, ahora)).toThrow('identificación')
  })
  it('admite rondas de eliminatorias, hora 0:00 desconocida y cruces diferentes sin participantes decididos', () => {
    const eventos = calendarioGalicia(fixture('galicia-cruces.html'), '10012', fuente, ahora).eventos
    expect(eventos).toHaveLength(6)
    expect(new Set(eventos.map(e => e.id)).size).toBe(6)
    expect(eventos[0].inicio).toBeUndefined()
    expect(eventos.filter(e => e.local?.includes('POR DETERMINAR'))).toHaveLength(2)
    expect(eventos.filter(e => e.local?.includes('POR DETERMINAR')).every(e => e.estado === 'por_confirmar' && !e.resultado)).toBe(true)
    expect(eventos[1].inicio).toBe('2026-11-15T11:00:00.000Z')
  })
  it('envía la referencia normal del iframe público y persiste una pausa sin reintentar', async () => {
    const guardar = vi.fn(), fetcher = vi.fn(async (_url, init) => {
      expect(init.headers.Referer).toBe(fuente)
      return new Response('', { status: 429, headers: { 'Retry-After': '3600' } })
    })
    await obtieneBaloncestoGalicia({ fetcher, relojGalicia: () => ahora, guardarEstadoNovanet: guardar })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const estado = guardar.mock.calls.at(-1)?.[1]
    expect(estado.noConsultarAntes).toBe(new Date(ahora + 3600000).toISOString())
    await obtieneBaloncestoGalicia({ fetcher, relojGalicia: () => ahora, estadoNovanet: { 'basket-galicia': estado } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
