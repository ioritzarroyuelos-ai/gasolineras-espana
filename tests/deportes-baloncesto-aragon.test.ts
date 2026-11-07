import { describe, expect, it, vi } from 'vitest'
import { catalogoAragon, formularioAragon, grupoAragon, obtieneBaloncestoAragon } from '../scripts/lib/deportes-baloncesto-aragon.mjs'
const archivos = import.meta.glob('./fixtures/deportes-baloncesto/*', { query: '?raw', import: 'default', eager: true })
const html = String(archivos['./fixtures/deportes-baloncesto/aragon.html'])
const ahora = Date.parse('2026-11-07T14:00:00Z')
const contexto = { territorio: '32', categoria: { codigo: '24136', nombre: 'Cadete Femenino ´C´' }, grupo: { codigo: '90202', nombre: 'Primera Fase Grupo 02' }, temporada: { codigo: '2026', nombre: '2026-2027' }, url: 'https://competiciones.feb.es/autonomicas/Resultados.aspx?a=32&c=24136' }
describe('Aragón: selector público y resultados del grupo real', () => {
  it('enumera las 27 categorías de Zaragoza y mantiene separadas delegación y temporada', () => {
    const c = catalogoAragon(html, '32')
    expect(c.temporada).toEqual(contexto.temporada)
    expect(c.categorias).toHaveLength(27)
    expect(c.categorias[0].codigo).toBe('3224136')
    expect(() => catalogoAragon(html.replace('2026/2027', '2025/2026'), '32')).toThrow('temporada')
  })
  it('cambia de grupo mediante el formulario real, sin asumir que el parámetro GET lo selecciona', () => {
    const form = formularioAragon(html, 'gruposDropDownList', '90203')
    expect(form.get('__EVENTTARGET')).toBe('gruposDropDownList')
    expect(form.get('gruposDropDownList')).toBe('90203')
    expect(form.get('__VIEWSTATE')).toBeTruthy()
    expect(() => formularioAragon(html, 'gruposDropDownList', '999999')).toThrow('no ofrece')
    expect(() => grupoAragon(html, { ...contexto, grupo: { codigo: '90203', nombre: 'Otro' } }, ahora)).toThrow('otro grupo')
  })
  it('lee ocho encuentros y ocho equipos, sin anunciar medianoche ni un cero a cero pendiente', () => {
    const c = grupoAragon(html, contexto, ahora)
    expect(c.agenda.eventos).toHaveLength(8)
    expect(c.clasificacion.tablas[0].filas).toHaveLength(8)
    expect(c.genero).toBe('femenino')
    expect(c.agenda.eventos[0]).toMatchObject({ local: 'EL SALVADOR CFD', visitante: 'MARIANISTAS CFC4', resultado: { local: 38, visitante: 25 }, estado: 'finalizado', fecha: '2026-10-24' })
    expect(c.agenda.eventos.every(e => !e.inicio)).toBe(true)
    expect(grupoAragon(html.replace('>38-25<', '>0-0<'), contexto, ahora).agenda.eventos[0].resultado).toBeUndefined()
    const futuro = grupoAragon(html.replace('>24/10/2026<', '>24/12/2026<'), contexto, ahora).agenda.eventos[0]
    expect(futuro.estado).toBe('por_confirmar'); expect(futuro.resultado).toBeUndefined()
    const durante = grupoAragon(html.replace('>24/10/2026<', '>07/11/2026<'), contexto, ahora).agenda.eventos[0]
    expect(durante.estado).toBe('por_confirmar'); expect(durante.resultado).toBeUndefined()
  })
  it('un marcador incomprensible no oculta una clasificación válida ni renueva una agenda anterior', () => {
    const c = grupoAragon(html.replace('>38-25<', '>desconocido<'), contexto, ahora)
    expect(c.agenda.estado).toBe('no_disponible'); expect(c.agenda.verificadoEn).toBeUndefined()
    expect(c.clasificacion.estado).toBe('actualizado')
  })
  it('respeta Retry-After y no consulta ninguna otra delegación después de recibir 429', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } })), guardar = vi.fn()
    await obtieneBaloncestoAragon({ fetcher, relojAragon: () => ahora, guardarEstadoNovanet: guardar })
    expect(fetcher).toHaveBeenCalledTimes(1)
    const estado = guardar.mock.calls.at(-1)?.[1]
    expect(estado.noConsultarAntes).toBe(new Date(ahora + 3600000).toISOString())
    await obtieneBaloncestoAragon({ fetcher, relojAragon: () => ahora, estadoNovanet: { 'basket-aragon': estado } })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
