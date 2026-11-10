import {describe,it,expect,vi} from 'vitest'
import {compruebaTextoTarifa,compruebaFuenteTarifa,descargaTextoTarifa,textoTarifas,COMPROBACIONES_TARIFAS} from '../scripts/lib/itv-tarifas-check.mjs'
import {tarifaComprobadaHoy,comprobacionItvReciente,type EstadoTarifasItv} from '../src/lib/itv-tarifas-estado'
import {buildItvPreciosPage} from '../src/html/itv'
import {TARIFAS,desglosa} from '../src/lib/itv-tarifas'
import {ITV_PUBLIC_SOURCES} from '../src/lib/itv-relay'
const ahora = new Date('2026-11-10T12:00:00Z')
const asturias = 'Servicios ITVASA 2026. IVA actualmente vigente del 21%. Importe actual 4,18 euros. Turismos (incluido transporte escolar) 34 € (51€)'
describe('verificación diaria de las tarifas',()=>{
  it('contrasta los componentes de la fila, no sólo que la web responda',()=>{
    expect(compruebaTextoTarifa('asturias',asturias,ahora)).toBe(true)
    expect(compruebaTextoTarifa('asturias',asturias.replace('34 €','35 €')+' Otro trámite 34 €',ahora)).toBe(false)
    expect(compruebaTextoTarifa('asturias',asturias.replace('21%','22%'),ahora)).toBe(false)
    expect(compruebaTextoTarifa('asturias',asturias.replace('4,18','4,20'),ahora)).toBe(false)
    expect(compruebaTextoTarifa('asturias',asturias,new Date('2027-01-01'))).toBe(false)
  })
  it('ignora cambios de menús y conserva los signos de las tablas PDF',()=>{
    expect(compruebaTextoTarifa('asturias','<nav>Noticias nuevas</nav><p>'+asturias+'</p>',ahora)).toBe(true)
    expect(textoTarifas('MMA <3500 kg, año >2020')).toBe('mma <3500 kg, ano >2020')
  })
  it('decodifica entidades en una sola pasada y no acepta capas anidadas',()=>{
    expect(textoTarifas('&amp;#65; &#38;#65; &#x26;#65; &amp;nbsp;')).toBe('&#65; &#65; &#65; &nbsp;')
    expect(textoTarifas('&#65; &#x41; &Aacute; &euro; &amp;')).toBe('a a a € &')
    expect(textoTarifas('&#1114112; &#55296;')).toBe('\ufffd \ufffd')
    expect(compruebaTextoTarifa('asturias',asturias.replace('34 €','34 &#x26;euro;'),ahora)).toBe(false)
  })
  it('todas las cifras comparables tienen comprobación de componentes y total',()=>{
    for(const t of TARIFAS.filter(t=>t.estado==='verificada')) {
      expect(COMPROBACIONES_TARIFAS[t.slug].total).toEqual([desglosa(t,t.gasolina!).total,desglosa(t,t.diesel!).total])
    }
  })
  it('señala una fuente caída y una página de error HTTP200 sin confirmar precios',async()=>{
    const f = {id:'asturias',url:'https://sede.asturias.es/tarifa.pdf'}
    expect((await compruebaFuenteTarifa(f,ahora,async()=>{throw Error('caída')})).estado).toBe('no_disponible')
    expect((await compruebaFuenteTarifa(f,ahora,async()=>'<h1>Error</h1>')).estado).toBe('cambiada')
    expect((await compruebaFuenteTarifa(f,ahora,async()=>asturias)).estado).toBe('verificada')
  })
  it('recupera un corte temporal y limita a tres intentos una caída persistente',async()=>{
    const f={id:'asturias',url:'https://sede.asturias.es/tarifa.pdf'}
    const esperar=vi.fn(async()=>{})
    const caida=Object.assign(new TypeError('mensaje privado'),{cause:{code:'ECONNRESET'}})
    const recuperada=vi.fn().mockRejectedValueOnce(caida).mockResolvedValue(asturias)
    expect(await compruebaFuenteTarifa(f,ahora,recuperada,{esperar})).toMatchObject({estado:'verificada',intentos:2})
    expect(esperar).toHaveBeenCalledWith(1000)
    esperar.mockClear()
    const persistente=vi.fn().mockRejectedValue(caida)
    const resultado=await compruebaFuenteTarifa(f,ahora,persistente,{esperar})
    expect(resultado).toMatchObject({estado:'no_disponible',intentos:3,codigo:'ECONNRESET'})
    expect(persistente).toHaveBeenCalledTimes(3)
    expect(esperar.mock.calls).toEqual([[1000],[2000]])
    expect(JSON.stringify(resultado)).not.toContain('mensaje privado')
  })
  it.each([403,404,429])('no insiste ante HTTP%s sin permiso de reintento',async status=>{
    const fetcher=vi.fn(async()=>new Response('Error',{status}))
    const esperar=vi.fn(async()=>{})
    const resultado=await compruebaFuenteTarifa({id:'asturias',url:'https://example.com'},ahora,(url,pages)=>descargaTextoTarifa(url,pages,fetcher),{esperar})
    expect(resultado).toMatchObject({estado:'no_disponible',codigo:'HTTP_'+status,intentos:1})
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(esperar).not.toHaveBeenCalled()
  })
  it.each(['60','invalid','-1'])('no reintenta HTTP429 con Retry-After no asumible: %s',async retryAfter=>{
    const fetcher=vi.fn(async()=>new Response('',{status:429,headers:{'Retry-After':retryAfter}}))
    const esperar=vi.fn(async()=>{})
    const resultado=await compruebaFuenteTarifa({id:'asturias',url:'https://example.com'},ahora,(url,pages)=>descargaTextoTarifa(url,pages,fetcher),{esperar})
    expect(resultado).toMatchObject({codigo:'HTTP_429',intentos:1})
    expect(esperar).not.toHaveBeenCalled()
  })
  it('respeta Retry-After al recuperar un HTTP429 y confirma el contenido descargado',async()=>{
    const fetcher=vi.fn().mockResolvedValueOnce(new Response('',{status:429,headers:{'Retry-After':'3'}})).mockResolvedValueOnce(new Response(asturias+' '.repeat(300)))
    const esperar=vi.fn(async()=>{})
    const resultado=await compruebaFuenteTarifa({id:'asturias',url:'https://example.com'},ahora,(url,pages)=>descargaTextoTarifa(url,pages,fetcher),{esperar})
    expect(resultado).toMatchObject({estado:'verificada',intentos:2})
    expect(esperar).toHaveBeenCalledExactlyOnceWith(3000)
  })
  it('explica TLS y errores desconocidos sin filtrar mensajes ni insistir',async()=>{
    for (const code of ['UNABLE_TO_VERIFY_LEAF_SIGNATURE','unknown-secret-code']) {
      const descargar=vi.fn().mockRejectedValue(Object.assign(new Error('secreto'),{cause:{code}}))
      const resultado=await compruebaFuenteTarifa({id:'asturias',url:'https://example.com'},ahora,descargar)
      expect(resultado).toMatchObject({intentos:1,codigo:code==='UNABLE_TO_VERIFY_LEAF_SIGNATURE'?code:'NETWORK_ERROR'})
      expect(JSON.stringify(resultado)).not.toMatch(/secreto|unknown-secret-code/)
    }
  })
  it('usa el respaldo fijo sólo tras agotar una conexión y vuelve a comprobar los importes',async()=>{
    const fuente={id:'asturias',url:ITV_PUBLIC_SOURCES.asturias}
    const descargar=vi.fn().mockRejectedValue(new DOMException('timeout','TimeoutError'))
    const esperar=async()=>{}
    const respaldo=vi.fn(async()=>new TextEncoder().encode(asturias+' '.repeat(300)))
    expect(await compruebaFuenteTarifa(fuente,ahora,descargar,{esperar,respaldo})).toMatchObject({estado:'verificada',via:'respaldo',intentos:3,codigoDirecto:'TIMEOUT'})
    expect(respaldo).toHaveBeenCalledExactlyOnceWith('asturias',fuente.url)
    const cambiado=async()=>new TextEncoder().encode(asturias.replace('34 €','35 €')+' '.repeat(300))
    expect(await compruebaFuenteTarifa(fuente,ahora,descargar,{esperar,respaldo:cambiado})).toMatchObject({estado:'cambiada',via:'respaldo'})
  })
  it('nunca usa el respaldo para saltar HTTP403, HTTP429 o un certificado inválido',async()=>{
    const fuente={id:'asturias',url:ITV_PUBLIC_SOURCES.asturias}
    const respaldo=vi.fn(async()=>new TextEncoder().encode(asturias))
    for (const status of [403,429]) {
      const descargar=(url:string,pages?:number[])=>descargaTextoTarifa(url,pages,async()=>new Response('',{status}))
      expect((await compruebaFuenteTarifa(fuente,ahora,descargar,{respaldo})).estado).toBe('no_disponible')
    }
    const error=Object.assign(new Error('TLS'),{cause:{code:'CERT_HAS_EXPIRED'}})
    expect((await compruebaFuenteTarifa(fuente,ahora,async()=>{throw error},{respaldo})).estado).toBe('no_disponible')
    expect(respaldo).not.toHaveBeenCalled()
  })
  it('no confirma sin revisión reciente de la tarifa y todos sus suplementos',()=>{
    const estado: EstadoTarifasItv = {v:1,checkedAt:ahora.toISOString(),estado:'verificada',
      fuentes:['asturias','tasa-dgt'].map(id=>({id,url:'https://example.com',checkedAt:ahora.toISOString(),estado:'verificada'})),
      tarifas:[{slug:'asturias',estado:'verificada',fuentes:['asturias','tasa-dgt']}]}
    expect(tarifaComprobadaHoy('asturias',estado,ahora.getTime())).toBe(true)
    expect(tarifaComprobadaHoy('asturias',estado,ahora.getTime()+31*3600000)).toBe(false)
    estado.fuentes[1].estado='cambiada'
    expect(tarifaComprobadaHoy('asturias',estado,ahora.getTime())).toBe(false)
    expect(comprobacionItvReciente('2099-01-01',ahora.getTime())).toBe(false)
    expect(tarifaComprobadaHoy('asturias',null,ahora.getTime())).toBe(false)
    const html=buildItvPreciosPage('n','https://example.com/itv/precios','gasolina',null)
    expect(html).toContain('Comprobación diaria pendiente')
    expect(html).not.toContain('<b>45,32 €</b>')
    expect(html).not.toContain('Para 1.600 cc o más, 43,52 €')
  })
})
