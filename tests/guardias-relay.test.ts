import { describe, expect, it, vi } from 'vitest'
import { publicGuardiasSource } from '../src/lib/guardias-relay'
describe('respaldo de fuentes públicas', () => {
  it('solo consulta las fuentes oficiales permitidas', async () => {
    const request = vi.fn().mockResolvedValue(new Response('Listado oficial'))
    expect(await publicGuardiasSource('https://example.test', request)).toBe(null)
    expect(request).not.toHaveBeenCalled()
    expect((await publicGuardiasSource('asturias', request))?.html).toBe('Listado oficial')
    expect(request.mock.calls[0][0]).toContain('www.farmasturias.org/')
  })
  it('rechaza fallos y respuestas sobredimensionadas', async () => {
    await expect(publicGuardiasSource('ceuta', vi.fn().mockResolvedValue(new Response('', { status: 500 })))).rejects.toThrow()
    await expect(publicGuardiasSource('ceuta', vi.fn().mockResolvedValue(new Response(new Uint8Array(1024*1024+1))))).rejects.toThrow('grande')
  })
  it('Almería usa el nonce público, la fecha de Madrid y el único destino permitido', async () => {
    const data = { success: true, data: { data: { informacion: [] } } }
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('var vbf_vars = {"ajax_url":"https://www.cofalmeria.com/wp-admin/admin-ajax.php","nonce":"publico"};'))
      .mockResolvedValueOnce(Response.json(data))
    const result = await publicGuardiasSource('almeria', request, new Date('2026-11-03T23:30:00Z'))
    expect(result?.fecha).toBe('2026-11-04')
    expect(result?.data).toEqual(data)
    expect(result?.source).toBe('https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on')
    const [url, init] = request.mock.calls[1]
    expect(url).toBe('https://www.cofalmeria.com/wp-admin/admin-ajax.php')
    expect(init.method).toBe('POST')
    expect(init.redirect).toBe('manual')
    expect(init.body.get('nonce')).toBe('publico')
    expect(init.body.get('vbf_req_fecha')).toBe('2026-11-04')
    expect(init.body.get('vbf_req_solo_guardias')).toBe('true')
  })
  it('Almería rechaza una configuración que intente cambiar el destino', async () => {
    const request = vi.fn().mockResolvedValue(new Response('var vbf_vars = {"ajax_url":"https://example.test/robar","nonce":"publico"};'))
    await expect(publicGuardiasSource('almeria', request)).rejects.toThrow('origen de consulta inesperado')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('Almería también limita el tamaño de la segunda respuesta', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response('var vbf_vars = {"ajax_url":"https://www.cofalmeria.com/wp-admin/admin-ajax.php","nonce":"publico"};'))
      .mockResolvedValueOnce(new Response(new Uint8Array(1024 * 1024 + 1)))
    await expect(publicGuardiasSource('almeria', request)).rejects.toThrow('grande')
  })
})
