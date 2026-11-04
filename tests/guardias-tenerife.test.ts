import { describe, expect, it } from 'vitest'
import { leerListadoTenerife } from '../scripts/lib/guardias-tenerife.mjs'

describe('respuestas oficiales de Tenerife', () => {
  it('acepta HTTP 204 sin contenido como municipio sin resultados', async () => {
    await expect(leerListadoTenerife(new Response(null, { status: 204 }), true)).resolves.toEqual([])
  })
  it('no acepta HTTP 204 para el catálogo de municipios', async () => {
    await expect(leerListadoTenerife(new Response(null, { status: 204 }))).rejects.toThrow()
  })
  it.each([new Response(''), Response.json({ error: 'temporal' }), new Response('Unavailable', { status: 503 })])(
    'no convierte respuestas defectuosas en ausencia de farmacias: %j', async response => {
      await expect(leerListadoTenerife(response, true)).rejects.toThrow()
    },
  )
  it('conserva el listado publicado sin inferir horarios', async () => {
    const rows = [{ idFarmacia: 15, descripcionHorario: 'Horario por confirmar' }]
    await expect(leerListadoTenerife(Response.json(rows), true)).resolves.toEqual(rows)
  })
})
