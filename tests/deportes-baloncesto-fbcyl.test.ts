import { describe, expect, it, vi } from 'vitest'
import { basePublicaFbcyl, contextoFbcyl, obtieneBaloncestoFbcyl, opcionesFbcyl } from '../scripts/lib/deportes-baloncesto-fbcyl.mjs'
const ahora = Date.parse('2026-11-07T14:00:00Z')
const indice = '<select id="temporada"><option value="2026" selected>Temporada 2026-2027</option></select><select id="genere"><option value="M">Masculino</option><option value="F">Femenino</option><option value="X">Mixto</option></select><select id="territorial"><option value="1">FBCYL</option><option value="3">Burgos</option><option value="9">Valladolid</option></select>'
describe('descubrimiento territorial de Castilla y León', () => {
  it('lee la temporada y los territorios publicados, y rechaza destinos o temporadas ajenos', () => {
    expect(contextoFbcyl(indice).temporada).toEqual({ codigo: '2026', nombre: '2026-2027' })
    expect(contextoFbcyl(indice).territorios).toHaveLength(3)
    expect(() => contextoFbcyl(indice.replace('2026-2027', '2025-2026'))).toThrow('temporada')
    expect(basePublicaFbcyl('<script>const environment={"REACT_APP_URL_ESB":"https://esb.optimalwayconsulting.com/fbcyl/1/configPublicaPrueba"}</script>')).toContain('/fbcyl/')
    expect(() => basePublicaFbcyl('"REACT_APP_URL_ESB":"https://otra.example/fbcyl/1/configPublicaPrueba"')).toThrow()
    expect(opcionesFbcyl('<option value="0">Categoría</option>')).toEqual([])
    expect(() => opcionesFbcyl('<html>Error</html>')).toThrow()
  })
  it('mantiene separados los mismos códigos de categoría reutilizados por provincias', async () => {
    let guardado: any
    await obtieneBaloncestoFbcyl({ ahora, relojFbcyl: () => ahora, duermeFbcyl: async () => {}, guardarEstadoNovanet: async (_: string, estado: any) => { guardado = structuredClone(estado) }, fetcher: async url => {
      if (String(url).endsWith('/buscar_competicion')) return new Response(indice)
      if (String(url).includes('/combo_categories2/')) return new Response(String(url).includes('/M/') ? '<option value="1125">SENIOR PROVINCIAL MASCULINO</option>' : '<option value="0">Categoría</option>')
      if (String(url).includes('/combo_competicions2/')) return new Response('<option value="0">Grupo</option>')
      throw Error('Consulta inesperada')
    } })
    expect(guardado.catalogo.categorias.map((c: any) => [c.codigo, c.familia])).toEqual([['011125', 'M/1'], ['031125', 'M/3'], ['091125', 'M/9']])
  })
  it('conserva las pausas y no reintenta después de recibir 429', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } })), guardar = vi.fn()
    const pausa = { version: 1, noConsultarAntes: new Date(ahora + 3600000).toISOString() }
    await obtieneBaloncestoFbcyl({ ahora, relojFbcyl: () => ahora, fetcher, estadoNovanet: { 'basket-fbcyl': pausa } })
    expect(fetcher).not.toHaveBeenCalled()
    await obtieneBaloncestoFbcyl({ ahora, relojFbcyl: () => ahora, fetcher, guardarEstadoNovanet: guardar })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(guardar.mock.calls.at(-1)?.[1].noConsultarAntes).toBe(pausa.noConsultarAntes)
  })
})
