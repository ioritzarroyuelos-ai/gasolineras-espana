import { describe, expect, it, vi } from 'vitest'
import { publicGuardiasSource } from '../src/lib/guardias-relay'
describe('respaldo de fuentes públicas', () => {
  it('solo consulta las dos fuentes oficiales permitidas', async () => {
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
})
