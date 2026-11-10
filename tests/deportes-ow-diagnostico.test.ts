import { describe, expect, it, vi } from 'vitest'
import { causaSeguraOW, diagnosticaFuenteOW, FUENTES_DIAGNOSTICO_OW } from '../scripts/lib/deportes-ow-diagnostico.mjs'

const base = 'https://esb.optimalwayconsulting.com/esf/1/identificadorPublicoPrueba'
const pagina = '<script id="owbasket-js-extra">var process = {"env":{"REACT_APP_URL_ESB":"' + base + '"}};</script><div data-name="CompetitionSearch" data-props=\'{"dzone":"1"}\'></div>'

describe('diagnóstico acotado de conexiones OW', () => {
  it('limita las fuentes al catálogo explícito de ocho y no consulta direcciones arbitrarias', async () => {
    const fetcher = vi.fn()
    expect(FUENTES_DIAGNOSTICO_OW).toHaveLength(8)
    await expect(diagnosticaFuenteOW('otro', { fetcher })).rejects.toThrow('no permitida')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('distingue una página correcta de un fallo TLS en la primera llamada API sin exponer su identificador', async () => {
    const tls = Object.assign(new Error('certificate has expired'), { code: 'CERT_HAS_EXPIRED' })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(pagina)).mockRejectedValueOnce(new TypeError('fetch failed', { cause: tls }))
    const resultado = await diagnosticaFuenteOW('bizkaia', { fetcher })
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(resultado.correcto).toBe(false)
    expect(resultado.peticiones[0].http).toBe(200)
    expect(resultado.peticiones[1].etapa).toBe('api-temporada')
    expect(resultado.peticiones[1].causa).toContainEqual(expect.objectContaining({ codigo: 'CERT_HAS_EXPIRED' }))
    expect(JSON.stringify(resultado)).not.toContain('identificadorPublicoPrueba')
    expect(resultado.peticiones[1].url).toContain('/esf/1/[identificador]/Season/')
  })

  it.each([403, 429])('detiene el portal con HTTP%s sin API ni reintento', async status => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('Acceso no disponible', { status, headers: { 'Retry-After': '3600' } }))
    const resultado = await diagnosticaFuenteOW('bizkaia', { fetcher })
    expect(resultado.correcto).toBe(false)
    expect(resultado.peticiones[0].http).toBe(status)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('registra un timeout del cuerpo sin repetir una petición que ya respondió', async () => {
    const stream = new ReadableStream({ start(c) { c.error(new DOMException('The operation timed out', 'TimeoutError')) } })
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream))
    const resultado = await diagnosticaFuenteOW('bizkaia', { fetcher })
    expect(resultado.peticiones[0].http).toBe(200)
    expect(resultado.causa?.[0].nombre).toBe('TimeoutError')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('sólo da por correcta la conexión completa con respuesta API reconocida', async () => {
    const api = btoa(JSON.stringify({ result: 'OK', messageData: [{ idSeason: '2026' }] }))
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(pagina)).mockResolvedValueOnce(new Response(api))
    const resultado = await diagnosticaFuenteOW('bizkaia', { fetcher })
    expect(resultado.correcto).toBe(true)
    expect(resultado.peticiones.map(p => p.http)).toEqual([200, 200])
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each(['baleares', 'fbcyl'])('descubre %s con un máximo de tres GET sin guardar configuración del visor', async id => {
    const clave = 'identificadorPublicoPrueba'
    const fuente = id === 'baleares'
      ? '<script src="/main.js"></script>'
      : '<html>Buscador de competiciones</html>'
    const visor = id === 'baleares'
      ? 'https://esb.optimalwayconsulting.com/fbib/1/' + clave + ' https://www.fbib.es/competicion/{id}/{round}'
      : '{"REACT_APP_URL_ESB":"https://esb.optimalwayconsulting.com/fbcyl/1/' + clave + '"}'
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(fuente)).mockResolvedValueOnce(new Response(visor))
      .mockResolvedValueOnce(new Response(btoa(JSON.stringify({ result: 'OK', messageData: [{ idSeason: '2026' }] }))))
    const resultado = await diagnosticaFuenteOW(id, { fetcher, grupoFbcyl: '12345' })
    expect(resultado.correcto).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(JSON.stringify(resultado)).not.toContain(clave)
  })

  it('conserva causas agregadas de red y oculta el identificador también en mensajes de error', () => {
    const detalle = Object.assign(new Error('connect ' + base + '/Season/getActiveWebVisibility'), { code: 'ETIMEDOUT' })
    const error = new TypeError('fetch failed', { cause: new AggregateError([detalle], 'all connections failed') })
    const causas = causaSeguraOW(error)
    expect(causas.some(c => c.codigo === 'ETIMEDOUT')).toBe(true)
    expect(JSON.stringify(causas)).not.toContain('identificadorPublicoPrueba')
  })
})
