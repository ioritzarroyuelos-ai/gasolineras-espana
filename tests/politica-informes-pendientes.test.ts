import {describe,it,expect,vi} from 'vitest'
import {fetchInformeMoreInCommon,informePendienteDeIncorporar,urlInformeMoreInCommon,compruebaInformePendiente} from '../scripts/lib/politica-informes-pendientes.mjs'
import texto from './fixtures/politica/more-in-common-20261120.txt?raw'

const url='https://moreincommon.es/pdfs/pulso-electoral/pulso-electoral-noviembre-2026.pdf'
const html='<a href="'+url+'">Abrir presentación</a><a href="pdfs/pulso-electoral/pulso-electoral-noviembre-2026.pdf">Descargar</a>'
const ahora={hoy:'2026-11-20',comprobado:'2026-11-20T22:00:00.000Z',userAgent:'Test'}
const informe={empresa:'More in Common',url,publicacion:'2026-11-20',comprobado:ahora.comprobado}
const red=(pagina=html,pdf=new Response('%PDF-1.7\nfixture'))=>vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(pagina)).mockResolvedValueOnce(pdf)

describe('informes originales pendientes de incorporación',()=>{
 it('el fallo de fuente conserva el aviso previo y su comprobación original',async()=>{
  const fetchImpl=vi.fn<typeof fetch>().mockRejectedValue(new Error('network timeout'))
  const respuesta=await compruebaInformePendiente([],informe,{...ahora,hoy:'2026-11-21',comprobado:'2026-11-21T10:00:00Z',fetchImpl})
  expect(respuesta).toEqual({pendiente:informe,error:'network timeout'})
  expect(respuesta.pendiente?.comprobado).toBe('2026-11-20T22:00:00.000Z')
  expect(await compruebaInformePendiente([{empresa:'More in Common',publicacion:'2026-11-20'}],informe,{...ahora,fetchImpl})).toEqual({pendiente:null,error:'network timeout'})
  expect(await compruebaInformePendiente([],undefined,{...ahora,fetchImpl})).toEqual({pendiente:null,error:'network timeout'})
  expect(await compruebaInformePendiente([],{...informe,url:'https://ejemplo.com/informe.pdf'},{...ahora,fetchImpl})).toEqual({pendiente:null,error:'network timeout'})
 })
 it('descubre el documento del editor y registra sus metadatos, nunca sus cifras',async()=>{
  const fetchImpl=red(),extraer=vi.fn().mockResolvedValue(texto)
  expect(await fetchInformeMoreInCommon({...ahora,fetchImpl,extraer})).toEqual(informe)
  expect(fetchImpl).toHaveBeenCalledTimes(2)
  expect(fetchImpl.mock.calls[1][0]).toBe(url)
  expect(fetchImpl.mock.calls.every(([,opts])=>opts?.redirect==='error')).toBe(true)
 })
 it('sigue un documento nuevo enlazado sin mantener un aviso fijo de noviembre',async()=>{
  const nuevo=url.replace('noviembre','diciembre')
  const r=await fetchInformeMoreInCommon({...ahora,hoy:'2026-12-10',comprobado:'2026-12-10T12:00:00Z',fetchImpl:red('<a href="'+nuevo+'">PDF</a>'),extraer:async()=>texto.replace('20 de noviembre','10 de diciembre')})
  expect(r).toMatchObject({url:nuevo,publicacion:'2026-12-10',comprobado:'2026-12-10T12:00:00Z'})
 })
 it('retira el aviso al incorporar la publicación y no compara con otra casa',()=>{
  expect(informePendienteDeIncorporar(informe,[{empresa:'More in Common',publicacion:'2026-11-03'}])).toEqual(informe)
  expect(informePendienteDeIncorporar(informe,[{empresa:'Otra casa',publicacion:'2026-11-20'}])).toEqual(informe)
  expect(informePendienteDeIncorporar(informe,[{empresa:'More in Common',publicacion:'2026-11-20'}])).toBeNull()
  expect(informePendienteDeIncorporar(informe,[{empresa:'More in Common',publicacion:'2026-11-21'}])).toBeNull()
 })
 it.each(['https://moreincommon.es.ejemplo.com/pdfs/pulso-electoral/pulso-electoral-noviembre-2026.pdf','https://u:p@moreincommon.es/pdfs/pulso-electoral/pulso-electoral-noviembre-2026.pdf',url+'?download=1','http://moreincommon.es/pdfs/pulso-electoral/pulso-electoral-noviembre-2026.pdf','javascript:alert(1)','https://moreincommon.es/data/microdatos-2026-11.zip'])('rechaza URL ajena o no autorizada: %s',valor=>{
  expect(urlInformeMoreInCommon(valor)).toBeNull()
 })
 it.each([403,429,503])('un HTTP %s conserva el fallo, sin consultar rutas alternativas',async status=>{
  const fetchImpl=vi.fn<typeof fetch>().mockResolvedValue(new Response('',{status}))
  await expect(fetchInformeMoreInCommon({...ahora,fetchImpl})).rejects.toThrow('HTTP '+status)
  expect(fetchImpl).toHaveBeenCalledTimes(1)
 })
 it.each([
  texto.replace('20 de noviembre','21 de noviembre'),
  texto.replace('Estudio propio realizado por More in Common España','Otro editor'),
  texto.replace('elecciones generales','elecciones autonómicas'),
  texto.replace('20 de noviembre','31 de noviembre'),
 ])('rechaza fecha futura/imposible o identidad/ámbito distintos',async documento=>{
  await expect(fetchInformeMoreInCommon({...ahora,fetchImpl:red(),extraer:async()=>documento})).rejects.toThrow('no reconocidos')
 })
 it('rechaza dos documentos distintos, respuestas HTML y exceso de tamaño',async()=>{
  await expect(fetchInformeMoreInCommon({...ahora,fetchImpl:red(html+'<a href="'+url.replace('noviembre','octubre')+'">Otro</a>')})).rejects.toThrow('ambiguo')
  await expect(fetchInformeMoreInCommon({...ahora,fetchImpl:red(html,new Response('<html>'))})).rejects.toThrow('no es PDF')
  await expect(fetchInformeMoreInCommon({...ahora,fetchImpl:red(html,new Response('%PDF-',{headers:{'content-length':String(9*1024*1024)}}))})).rejects.toThrow('demasiado grande')
  await expect(fetchInformeMoreInCommon({...ahora,fetchImpl:red('x'.repeat(1000001))})).rejects.toThrow('demasiado grande')
 })
})
