import {describe,expect,it,vi} from 'vitest'
import {tablaSeguimientoPdf,fetchSeguimientoPdf,urlSeguimientoPdf} from '../scripts/lib/politica-sw-pdf.mjs'
import {combinaSeguimiento} from '../scripts/lib/politica-seguimiento.mjs'
import type {Sondeo} from '../src/lib/politica-schemas'
import {renderSondeos} from '../src/html/politica-sondeos'
import type {EleccionFile} from '../src/lib/politica-schemas'

const archivos=import.meta.glob('./fixtures/politica/sw-*.txt',{query:'?raw',import:'default',eager:true}) as Record<string,string>
const ficha=(n:number):Sondeo=>({empresa:'SW Demoscopia',comitente:'La Séptima',campoFin:`2026-11-${n+3}`,
  publicacion:`2026-11-${n+4}`,muestra:n===15?10500:10000,
  fuenteUrl:`https://laseptima.com/wp-content/uploads/2026/11/barometro-n${n}-${n+3}nov2026.pdf`,datos:[]})
const texto=(n:number)=>archivos[`./fixtures/politica/sw-n${n}-20261120.txt`]
const hoy='2026-11-20'

describe('originales SW: identidad de las listas y semántica de los escaños',()=>{
  it.each([14,15])('lee el informe original n%s, conserva las dos listas y suma350',n=>{
    const resultado=tablaSeguimientoPdf(texto(n),ficha(n),hoy), datos=resultado.sondeo.datos
    expect(resultado.sondeo).toMatchObject({...ficha(n),datos:expect.any(Array),fuenteVerificada:'sw-pdf-v1',campoInicio:'2026-10-26'})
    expect(datos.reduce((s,d)=>s+Number(d.escanos),0)).toBe(350)
    expect(datos.find(d=>d.candidaturaId==='pp-sin-navarra')).toEqual({candidaturaId:'pp-sin-navarra',pct:n===15?29.2:29.1,escanos:n===15?120:118})
    expect(datos.find(d=>d.candidaturaId==='ppupn-navarra')).toEqual({candidaturaId:'ppupn-navarra',pct:0.2,escanos:2})
    expect(datos.find(d=>d.candidaturaId==='psoe')?.escanos).toBe(n===15?133:134) // Su mediana es131.
    expect(datos.find(d=>d.candidaturaId==='pnv')?.pct).toBe(n===15?0.8:0.7)
    expect(datos.some(d=>d.candidaturaId==='pp' || d.candidaturaId==='ppupn')).toBe(false)
    expect(resultado.sondeo.notaFuente).toContain('reparto central')
  })
  it('no acepta otra jornada, datos futuros, una muestra distinta o un documento ajeno',()=>{
    for(const cambio of [{campoFin:'2026-11-17'},{publicacion:'2026-11-20'},{muestra:10000},{fuenteUrl:'https://laseptima.com.ejemplo.org/encuesta.pdf'}])
      expect(()=>tablaSeguimientoPdf(texto(15),{...ficha(15),...cambio},hoy)).toThrow()
    expect(()=>tablaSeguimientoPdf(texto(15),ficha(15),'2026-11-18')).toThrow()
    for(const url of ['https://laseptima.com/wp-content/uploads/2026/11/barometro-n15-18nov2026.pdf?url=https://evil.test',
      'http://laseptima.com/wp-content/uploads/2026/11/barometro-n15-18nov2026.pdf']) expect(urlSeguimientoPdf(url)).toBeNull()
  })
  it('rechaza columnas movidas, sumas incompletas, duplicados y PP sin nota de separación',()=>{
    for(const cambiado of [texto(15).replace('Escaños (central) Mediana','Mediana Escaños (central)'),
      texto(15).replace('29,2 \t120','29,2 \t119'),texto(15).replace('PP\uE089UPN \uE081Navarra)','PP'),
      texto(15).replace('fuera del total del PP','incluida dentro del PP')])
      expect(()=>tablaSeguimientoPdf(cambiado,ficha(15),hoy)).toThrow()
  })
  it('publica solo los originales comprobados y no reintroduce el PP ambiguo de Wikipedia',()=>{
    const original=tablaSeguimientoPdf(texto(15),ficha(15),hoy).sondeo
    const wiki={...ficha(15),datos:[{candidaturaId:'pp',pct:29.4,escanos:{min:119,max:125}}]}
    expect(combinaSeguimiento([wiki,{...wiki,campoFin:'2026-11-17'}, {...wiki,empresa:'Otra'}],[original])).toEqual([{...wiki,empresa:'Otra'},original])
  })
  it('explica el reparto central y no compara PP sinNavarra con los137escaños del PP de2023',()=>{
    const original=tablaSeguimientoPdf(texto(15),ficha(15),hoy)
    const file={candidaturas:original.candidaturas,sondeos:[original.sondeo],referencia:{fecha:'2023-07-23',escanos:[{candidaturaId:'pp',escanos:137}]}} as EleccionFile
    const html=renderSondeos(file,file.sondeos,'elecciones')
    expect(html).toContain('PP (sin Navarra)')
    expect(html).toContain('PP–UPN (Navarra)')
    expect(html).toContain('Escaños: reparto central del informe')
    expect(html).toContain('Sin dato de referencia')
    expect(html).not.toContain('Baja 17')
  })
})

describe('descarga acotada del seguimiento original',()=>{
  it('un informe fallido no oculta el otro confirmado ni convierte su fallo en dato',async()=>{
    const extraer=vi.fn(async(url:string)=>{if(url.includes('n15-'))throw Error('HTTP503');return texto(14)})
    const resultado=await fetchSeguimientoPdf([ficha(14),ficha(15)],{hoy,userAgent:'test',extraer})
    expect(extraer).toHaveBeenCalledTimes(2)
    expect(resultado.fallos).toEqual(['2026-11-18'])
    expect(resultado.sondeos.map(s=>s.campoFin)).toEqual(['2026-11-17'])
  })
  it('no ejecuta conexiones a enlaces ajenos ni acepta el mismo PDF para dos jornadas',async()=>{
    const extraer=vi.fn()
    await expect(fetchSeguimientoPdf([{...ficha(15),fuenteUrl:'https://ajeno.test/a.pdf'}],{hoy,userAgent:'test',extraer})).rejects.toThrow()
    await expect(fetchSeguimientoPdf([ficha(15),{...ficha(15),campoFin:'2026-11-17'}],{hoy,userAgent:'test',extraer})).rejects.toThrow()
    expect(extraer).not.toHaveBeenCalled()
  })
  it('rechaza redirecciones, respuestas sinPDF y cuerpos demasiado grandes sin reintentar',async()=>{
    for(const response of [new Response(null,{status:302,headers:{Location:'https://ajeno.test/a.pdf'}}),
      new Response('texto '.repeat(100)),new Response('PDF',{headers:{'content-length':'9000000'}})]){
      const fetchImpl=vi.fn(async()=>response)
      const resultado=await fetchSeguimientoPdf([ficha(15)],{hoy,userAgent:'test',fetchImpl})
      expect(resultado.sondeos).toEqual([])
      expect(resultado.fallos).toEqual(['2026-11-18'])
      expect(fetchImpl).toHaveBeenCalledTimes(1)
    }
  })
})
