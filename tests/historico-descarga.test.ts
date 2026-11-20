import {afterEach, describe, expect, it, vi} from 'vitest'
import {descargaSnapshotHistorico} from '../scripts/lib/historico-descarga.mjs'

const captura = {Fecha:'19/11/2026 0:00:00',ListaEESSPrecio:[{IDEESS:'1'}]}
afterEach(()=>vi.useRealTimers())

function descargaLenta(ms: number) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => new Response(new ReadableStream({
    start(stream) {
      const timer = setTimeout(()=>{stream.enqueue(new TextEncoder().encode(JSON.stringify(captura)));stream.close()},ms)
      init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);stream.error(init.signal?.reason)},{once:true})
    },
  })))
}

describe('descarga completa del archivo oficial',()=>{
  it('acepta un cuerpo que termina después de los antiguos 25 segundos',async()=>{
    vi.useFakeTimers()
    const fetcher=descargaLenta(31000)
    const descarga=descargaSnapshotHistorico('2026-11-19',{intentos:2,fetcher})
    await vi.advanceTimersByTimeAsync(31000)
    expect(await descarga).toEqual(captura)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(String(fetcher.mock.calls[0][0])).toMatch(/\/EstacionesTerrestresHist\/19-11-2026$/)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('cancela un cuerpo bloqueado a los 45 segundos y acaba tras dos intentos',async()=>{
    vi.useFakeTimers()
    const fetcher=descargaLenta(100000), anotar=vi.fn()
    const resultado=descargaSnapshotHistorico('2026-11-19',{intentos:2,fetcher,anotar}).catch(e=>e)
    await vi.advanceTimersByTimeAsync(93000)
    expect((await resultado).name).toBe('TimeoutError')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(anotar).toHaveBeenCalledTimes(2)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('nunca acepta una captura de otro día ni un número ilimitado de intentos',async()=>{
    const fetcher=vi.fn(async()=>Response.json(captura)), esperar=vi.fn(async()=>{})
    await expect(descargaSnapshotHistorico('2026-11-18',{intentos:2,fetcher,esperar})).rejects.toThrow('Fecha oficial distinta')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(esperar).not.toHaveBeenCalled()
    await expect(descargaSnapshotHistorico('2026-11-19',{intentos:5,fetcher})).rejects.toThrow('intentos')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('un archivo vacío sigue siendo un día sin datos',async()=>{
    const fetcher=vi.fn(async()=>Response.json({...captura,ListaEESSPrecio:[]}))
    expect(await descargaSnapshotHistorico('2026-11-19',{fetcher})).toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each([403,404,429])('no insiste ante HTTP%s, aunque ofrezca Retry-After',async(status)=>{
    const fetcher=vi.fn(async()=>new Response('',{status,headers:{'Retry-After':'60'}})), esperar=vi.fn(async()=>{})
    await expect(descargaSnapshotHistorico('2026-11-19',{intentos:2,fetcher,esperar})).rejects.toThrow('HTTP '+status)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(esperar).not.toHaveBeenCalled()
  })
  it.each(['CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE'])('no reintenta un fallo TLS %s',async(code)=>{
    const fetcher=vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'),{cause:{code}}))
    await expect(descargaSnapshotHistorico('2026-11-19',{intentos:2,fetcher})).rejects.toThrow('fetch failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('no reintenta un JSON corrupto',async()=>{
    const fetcher=vi.fn(async()=>new Response('{incompleto'))
    await expect(descargaSnapshotHistorico('2026-11-19',{intentos:2,fetcher})).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('recupera un fallo de conexión y un HTTP503 con intentos acotados',async()=>{
    const esperar=vi.fn(async()=>{})
    for (const primero of ['red','http']) {
      const fetcher=vi.fn()
      if (primero==='red') fetcher.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'),{cause:{code:'ECONNRESET'}}))
      else fetcher.mockResolvedValueOnce(new Response('',{status:503}))
      fetcher.mockResolvedValueOnce(Response.json(captura))
      expect(await descargaSnapshotHistorico('2026-11-19',{intentos:2,fetcher,esperar})).toEqual(captura)
      expect(fetcher).toHaveBeenCalledTimes(2)
    }
    expect(esperar.mock.calls).toEqual([[3000],[3000]])
  })
})
