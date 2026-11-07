import { describe, expect, it, vi } from 'vitest'
import { actualizaOperadoresItv } from '../scripts/lib/itv-operadores.mjs'
import type { EstacionFuente } from '../scripts/lib/itv-fuentes.mjs'

const url='https://www.itvasa.es/citas/'
const ahora=Date.parse('2026-11-07T10:30:00Z')
const estacion:EstacionFuente={id:'33-3303',codigo:'3303',prov:'33',mun:'MIERES',dir:'Polígono La Fábrica, parcela 7',cp:'33600',op:'ITVASA',tel:'985451815',lat:null,lng:null,lineas:3,horario:'',fuente:'industria'}
// Estructura pública observada en ITVASA, sin valores personales ni estado de sesión.
const formulario='<form id="Datos" method="post" action="./">'
  +'<input name="nombre" type="text"><input name="cif" type="text">'
  +'<input name="telefono" type="text"><input name="matricula" type="text">'
  +'<select name="selEstacion"><option value="0">Seleccione estación de ITV</option>'
  +'<option value="6">ITV DE PRUVIA</option><option value="7">ITV DE MIERES</option></select>'
  +'<input name="btn_continuar" type="submit" value="Enviar"></form>'
const pagina=(contenido=formulario)=>'<html><head><title>ITVASA - Cita Previa</title></head><body>'
  +'<h1>ITVASA Cita Previa Primeras Inspecciones</h1>'+contenido+'</body></html>'
const respuesta=(html=pagina(),final=url)=>{
  const r=new Response(html)
  Object.defineProperty(r,'url',{value:final})
  return r
}

describe('verificación del canal de citas ITVASA',()=>{
  it('comprueba una vez el formulario real y asigna sólo las estaciones del operador en Asturias',async()=>{
    const fetcher=vi.fn(async()=>respuesta())
    const res=await actualizaOperadoresItv([estacion,{...estacion,id:'3302',codigo:'3302',mun:'RIBADESELLA'},
      {...estacion,id:'otra',op:'OTRA'},{...estacion,id:'otra-provincia',prov:'01'}],{},{ahora,fetcher})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(res.estaciones.map(e=>e.citaUrl)).toEqual([url,url,undefined,undefined])
    expect(res.perfiles.itvasa).toMatchObject({estado:'actualizada',ultimoExito:new Date(ahora).toISOString()})
    const opciones=fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(opciones[1].signal).toBeInstanceOf(AbortSignal)
  })

  it.each([
    '<title>ITVASA Cita previa</title>',
    pagina('<p>Servicio no disponible</p>'),
    '<html><head><title>ITVASA</title></head><body><script>Cita previa</script></body></html>',
    pagina('<form><input type="password"><button>Iniciar sesión</button></form>'),
    pagina('<script type="text/plain">'+formulario+'</script>'),
    pagina(formulario.replace('action="./"','action="https://tercero.example/reserva"')),
    pagina(formulario.replace('action="./"','action="https://usuario@www.itvasa.es/citas/"')),
    pagina(formulario.replace('name="matricula" type="text"','name="matricula" type="hidden"')),
    pagina(formulario.replace('name="selEstacion"','name="selEstacion" disabled')),
    pagina(formulario.replace('name="btn_continuar"','name="btn_continuar" disabled')),
  ])('no da por verificada una página sin una reserva utilizable (%#)',async html=>{
    const res=await actualizaOperadoresItv([estacion],{},{ahora,fetcher:async()=>respuesta(html)})
    expect(res.estaciones[0].citaUrl).toBeUndefined()
    expect(res.perfiles.itvasa.estado).toBe('conservada')
    expect(res.perfiles.itvasa.ultimoExito).toBeUndefined()
  })

  it.each(['https://tercero.example/citas/','http://www.itvasa.es/citas/'])('rechaza una redirección a %s',async final=>{
    const res=await actualizaOperadoresItv([estacion],{},{ahora,fetcher:async()=>respuesta(pagina(),final)})
    expect(res.estaciones[0].citaUrl).toBeUndefined()
    expect(res.perfiles.itvasa.error).toContain('Redirección')
  })

  it('conserva la fecha de comprobación anterior tras una caída y registra su causa',async()=>{
    const valida=await actualizaOperadoresItv([estacion],{},{ahora,fetcher:async()=>respuesta()})
    const fallo=new TypeError('fetch failed',{cause:Object.assign(new Error('Connect Timeout Error'),{code:'UND_ERR_CONNECT_TIMEOUT'})})
    const fetcher=vi.fn(async()=>{throw fallo})
    const res=await actualizaOperadoresItv([estacion],valida.perfiles,{ahora:ahora+86400000,fetcher})
    expect(res.estaciones[0]).toMatchObject({citaUrl:url,citaVerificadoEn:new Date(ahora).toISOString()})
    expect(res.perfiles.itvasa).toMatchObject({estado:'conservada',consultado:new Date(ahora+86400000).toISOString(),
      ultimoExito:new Date(ahora).toISOString(),error:'[UND_ERR_CONNECT_TIMEOUT] fetch failed'})
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it.each([
    new DOMException('The operation was aborted due to timeout','TimeoutError'),
    new TypeError('fetch failed',{cause:Object.assign(new Error('socket reset'),{code:'ECONNRESET'})}),
  ])('recupera una caída temporal con un segundo GET y valida el formulario',async fallo=>{
    const fetcher=vi.fn<typeof fetch>().mockRejectedValueOnce(fallo).mockResolvedValueOnce(respuesta())
    const res=await actualizaOperadoresItv([estacion],{},{ahora,fetcher})
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls.map(([,opciones])=>opciones?.method)).toEqual(['GET','GET'])
    expect(fetcher.mock.calls.every(([,opciones])=>!opciones?.body)).toBe(true)
    expect(fetcher.mock.calls[0][1]?.signal).not.toBe(fetcher.mock.calls[1][1]?.signal)
    expect(res.estaciones[0]).toMatchObject({citaUrl:url,citaVerificadoEn:new Date(ahora).toISOString()})
    expect(res.perfiles.itvasa.estado).toBe('actualizada')
  })

  it('reintenta un HTTP503 temporal, pero respeta un Retry-After y los errores permanentes',async()=>{
    const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(respuesta())
    expect((await actualizaOperadoresItv([estacion],{},{ahora,fetcher})).estaciones[0].citaUrl).toBe(url)
    expect(fetcher).toHaveBeenCalledTimes(2)
    for (const respuestaError of [new Response('',{status:403}),new Response('',{status:404}),
      new Response('',{status:503,headers:{'Retry-After':'120'}})]) {
      const permanente=vi.fn(async()=>respuestaError)
      const res=await actualizaOperadoresItv([estacion],{},{ahora,fetcher:permanente})
      expect(res.estaciones[0].citaUrl).toBeUndefined()
      expect(permanente).toHaveBeenCalledTimes(1)
    }
  })

  it('el segundo intento no convierte una página sin formulario en cita verificada',async()=>{
    const fetcher=vi.fn<typeof fetch>()
      .mockRejectedValueOnce(new DOMException('timeout','TimeoutError'))
      .mockResolvedValueOnce(respuesta(pagina('<p>Servicio no disponible</p>')))
    const res=await actualizaOperadoresItv([estacion],{},{ahora,fetcher})
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(res.estaciones[0].citaUrl).toBeUndefined()
    expect(res.perfiles.itvasa.error).toContain('formulario')
  })

  it('no añade reintentos a otros operadores',async()=>{
    const fetcher=vi.fn(async()=>{throw new DOMException('timeout','TimeoutError')})
    const res=await actualizaOperadoresItv([{...estacion,op:'ITEVELESA'}],{},{ahora,fetcher})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(res.estaciones[0].citaUrl).toBeUndefined()
  })

  it('un fallo de certificado sigue siendo un fallo y no activa una conexión insegura',async()=>{
    const fallo=new TypeError('fetch failed',{cause:Object.assign(new Error('certificate'),{code:'CERT_HAS_EXPIRED'})})
    const fetcher=vi.fn(async()=>{throw fallo})
    const res=await actualizaOperadoresItv([estacion],{},{ahora,fetcher})
    expect(res.estaciones[0].citaUrl).toBeUndefined()
    expect(res.perfiles.itvasa.error).toBe('[CERT_HAS_EXPIRED] fetch failed')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
