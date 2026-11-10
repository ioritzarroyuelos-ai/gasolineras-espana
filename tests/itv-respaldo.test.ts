import {describe,it,expect,vi} from 'vitest'
import {descargarRespaldoItv,permiteRespaldoItv} from '../scripts/lib/itv-respaldo.mjs'
import {ITV_PUBLIC_SOURCES,ITV_MAX_BYTES} from '../src/lib/itv-relay'
const ahora=Date.parse('2026-11-10T12:00:00Z')
const source=ITV_PUBLIC_SOURCES.asturias
const origen='https://espana-util-guardias-pr-271.ioritz-arroyuelos.workers.dev'
const respuesta=(headers:Record<string,string>={},body='documento')=>new Response(body,{headers:{
  'X-ITV-Source-Id':'asturias','X-ITV-Source-Url':source,'X-ITV-Fetched-At':new Date(ahora).toISOString(),...headers}})
const encabezadosInvalidos:Record<string,string>[]=[
  {'X-ITV-Source-Id':'cantabria'}, {'X-ITV-Source-Url':'https://otro.example'},
  {'X-ITV-Fetched-At':'invalid'}, {'X-ITV-Fetched-At':new Date(ahora-360001).toISOString()},
  {'X-ITV-Fetched-At':new Date(ahora+60001).toISOString()},
]
describe('consumo limitado del respaldo ITV',()=>{
  it('sólo admite fallos de conexión, nunca HTTP ni certificados',()=>{
    const conexion=Object.assign(new Error('fetch'),{cause:{code:'UND_ERR_CONNECT_TIMEOUT'}})
    expect(permiteRespaldoItv(conexion)).toBe(true)
    expect(permiteRespaldoItv(new DOMException('timeout','TimeoutError'))).toBe(true)
    for (const code of ['HTTP_403','HTTP_429','CERT_HAS_EXPIRED','ENOTFOUND','UNKNOWN']) {
      expect(permiteRespaldoItv({code,cause:conexion})).toBe(false)
    }
    expect(permiteRespaldoItv(new AggregateError([conexion,{code:'CERT_HAS_EXPIRED'}]))).toBe(false)
    expect(permiteRespaldoItv({code:'ECONNRESET',cause:{code:'CERT_HAS_EXPIRED'}})).toBe(false)
    expect(permiteRespaldoItv(new AggregateError([conexion,conexion]))).toBe(true)
  })
  it('comprueba origen, fecha y fuente antes de consumir los bytes',async()=>{
    const fetcher=vi.fn(async()=>respuesta())
    expect(new TextDecoder().decode(await descargarRespaldoItv('asturias',source,{origin:origen,ahora,fetcher}))).toBe('documento')
    expect(fetcher.mock.calls[0]).toMatchObject([origen+'/itv/fuentes/asturias',{method:'GET',redirect:'manual'}])
  })
  it('rechaza destinos arbitrarios y fuentes cambiadas sin hacer peticiones',async()=>{
    const fetcher=vi.fn(async()=>respuesta())
    await expect(descargarRespaldoItv('asturias','https://otro.example',{fetcher})).rejects.toThrow('fuente')
    await expect(descargarRespaldoItv('constructor',source,{fetcher})).rejects.toThrow('fuente')
    for (const origin of ['http://espana-util-guardias.ioritz-arroyuelos.workers.dev',origen+'/?url=foo','https://tercero.example',origen+'@tercero.example']) {
      await expect(descargarRespaldoItv('asturias',source,{origin,fetcher})).rejects.toThrow('origen')
    }
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(encabezadosInvalidos)('no acepta un respaldo no identificable o caducado (%#)',async headers=>{
    await expect(descargarRespaldoItv('asturias',source,{origin:origen,ahora,fetcher:async()=>respuesta(headers)})).rejects.toThrow('origen o fecha')
  })
  it('rechaza redirecciones y respuestas demasiado grandes',async()=>{
    await expect(descargarRespaldoItv('asturias',source,{origin:origen,ahora,fetcher:async()=>new Response('',{status:302})})).rejects.toThrow()
    const grande=respuesta({},'x'.repeat(ITV_MAX_BYTES+1))
    await expect(descargarRespaldoItv('asturias',source,{origin:origen,ahora,fetcher:async()=>grande})).rejects.toThrow('demasiado grande')
  })
})
