import { afterEach, describe, expect, it, vi } from 'vitest'
import { descargarJSON } from '../scripts/lib/guardias-fetch.mjs'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('descarga JSON de fuentes oficiales', () => {
  it('recupera una página de error HTTP 200 sin cambiar la consulta', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('<h1>Error temporal</h1>'))
      .mockResolvedValueOnce(Response.json({ success: true, fecha: '2026-11-04' }))
    vi.stubGlobal('fetch', fetchMock)
    const options = { method: 'POST', body: new URLSearchParams({ fecha: '2026-11-04' }) }
    const result = descargarJSON('https://www.cofalmeria.com/wp-admin/admin-ajax.php', options)
    await vi.runAllTimersAsync()
    await expect(result).resolves.toEqual({ success: true, fecha: '2026-11-04' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [url, request] of fetchMock.mock.calls) {
      expect(url).toBe('https://www.cofalmeria.com/wp-admin/admin-ajax.php')
      expect(request.method).toBe('POST')
      expect(request.body).toBe(options.body)
    }
  })

  it('rechaza una respuesta ilegible persistente tras tres intentos', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] })
    const fetchMock = vi.fn().mockImplementation(async () => new Response('<h1>Error</h1>'))
    vi.stubGlobal('fetch', fetchMock)
    const rejection = expect(descargarJSON('https://www.cofalmeria.com/listado')).rejects.toThrow('Respuesta JSON inválida de www.cofalmeria.com')
    await vi.runAllTimersAsync()
    await rejection
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('no repite una denegación de acceso HTTP 403', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 }))
    vi.stubGlobal('fetch', fetchMock)
    await expect(descargarJSON('https://www.cofalmeria.com/listado')).rejects.toThrow('HTTP 403')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
