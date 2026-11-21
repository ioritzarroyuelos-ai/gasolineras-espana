import {describe,it,expect,vi} from 'vitest'
import {Hono} from 'hono'
import type {Env} from '../src/index'
import {registerServiciosMunicipalesRoutes} from '../src/routes/servicios-municipales'
import {cargaCatalogoMunicipal,cargaResumenMunicipal,estadoMunicipal} from '../src/lib/servicios-municipales'
import {empaquetaMunicipios} from '../scripts/gen-servicios-municipales.mjs'
import {servicioTileId} from '../scripts/lib/servicios.mjs'
import type {CatalogoMunicipal,ResumenMunicipal} from '../scripts/lib/servicios-municipales.mjs'

const now=Date.now(),ts=new Date(now-1000).toISOString(),original=new Date(now-86400000).toISOString()
const row=(ine='28079',nombre='Madrid'):ResumenMunicipal=>({ine,nombre,slug:nombre.toLowerCase().replace(/[^a-z0-9]/g,'-'),provincia:'Madrid',provinciaSlug:'madrid',centro:{lat:40.4168,lon:-3.7038},radioM:5000,total:1,categorias:{bibliotecas:1},lugares:[{id:'osm-node-123',nombre:'Biblioteca <script>alert(1)</script>',categorias:['bibliotecas'],lat:40.4168,lon:-3.7038,zona:servicioTileId(40.4168,-3.7038),distanciaM:0,ubicacion:'punto',fechaEdicion:'2020-01-01T00:00:00Z',municipio:'Otro municipio'}]})
function fixture(rows=[row()]){
  const packed=empaquetaMunicipios(rows)
  const catalog:CatalogoMunicipal={schema:1,radioM:5000,muestra:12,consultado:ts,fechaDatos:original,centros:{fuente:'AEMET maestro/municipios',generado:'2026-09-06T17:05:00.176Z',consultado:ts,sha256:'a'.repeat(64)},fuente:{url:'https://www.openstreetmap.org/copyright',licencia:'ODbL-1.0',atribucion:'© OpenStreetMap contributors',indexSha256:'b'.repeat(64)},totalPuntos:1,totalCentros:rows.length,conResultados:rows.length,sinResultados:0,provincias:packed.provincias}
  const fetch=vi.fn(async(req:Request)=>{const path=new URL(req.url).pathname.replace('/data/servicios-municipales/','');if(path==='index.json')return Response.json(catalog);const bytes=packed.files.get(path);return bytes?new Response(new Uint8Array(bytes)):new Response('no encontrado',{status:404})})
  const assets={fetch},app=new Hono<{Bindings:Env}>();registerServiciosMunicipalesRoutes(app)
  const request=(path='/servicios/municipio/28079/madrid')=>app.request(path,{}, {ASSETS:assets})
  return {catalog,packed,fetch,assets,request}
}
describe('lectura municipal acotada y consistente',()=>{
  it('lee3archivos comprobados sin coordenadas del visitante y comparte caché inmutable',async()=>{
    const f=fixture(),a=await cargaResumenMunicipal(f.assets,'28079',now)
    expect(a?.resumen.total).toBe(1);expect(f.fetch).toHaveBeenCalledTimes(3)
    expect(f.fetch.mock.calls.every(([r])=>!new URL(r.url).search)).toBe(true)
    await cargaResumenMunicipal(f.assets,'28079',now+29999);expect(f.fetch).toHaveBeenCalledTimes(3)
    await cargaResumenMunicipal(f.assets,'28079',now+30000);expect(f.fetch).toHaveBeenCalledTimes(4)
  })
  it('no mezcla bindings ni conserva fallos como una respuesta válida',async()=>{
    const f=fixture();await cargaCatalogoMunicipal(f.assets,now);await cargaCatalogoMunicipal({fetch:f.fetch},now);expect(f.fetch).toHaveBeenCalledTimes(2)
    const get=vi.fn().mockRejectedValueOnce(Error('caída')).mockResolvedValueOnce(Response.json(f.catalog)),assets={fetch:get}
    await expect(cargaCatalogoMunicipal(assets,now)).rejects.toThrow();expect((await cargaCatalogoMunicipal(assets,now)).conResultados).toBe(1)
  })
  it('rechaza un bloque alterado aunque siga siendo JSON válido',async()=>{
    const f=fixture(),key=[...f.packed.files.keys()].find(k=>k.startsWith('bloques/'))!
    f.packed.files.set(key,new TextEncoder().encode('[]') as any)
    await expect(cargaResumenMunicipal(f.assets,'28079',now)).rejects.toThrow()
  })
  it('frena un cuerpo demasiado grande sin confiar en su cabecera',async()=>{
    const get=vi.fn(async()=>new Response('x'.repeat(128*1024+1)))
    await expect(cargaCatalogoMunicipal({fetch:get},now)).rejects.toThrow()
  })
  it('un INE desconocido no carga bloques ni inventa ausencia de servicios',async()=>{
    const f=fixture();expect(await cargaResumenMunicipal(f.assets,'../../privado',now)).toBeNull();expect(f.fetch).not.toHaveBeenCalled()
    expect(await cargaResumenMunicipal(f.assets,'28001',now)).toBeNull();expect(f.fetch).toHaveBeenCalledTimes(2)
  })
  it('la fecha de consulta no rejuvenece el extracto',()=>{
    const f=fixture();f.catalog.fechaDatos=new Date(now-73*3600000).toISOString()
    expect(estadoMunicipal(f.catalog,now).copiaAntigua).toBe(true)
  })
})
describe('páginas de proximidad con noindex inicial',()=>{
  it('muestra radio, referencia, municipio declarado y fechas sin script inyectado',async()=>{
    const f=fixture(),r=await f.request(),html=await r.text()
    expect(r.status).toBe(200);expect(r.headers.get('x-robots-tag')).toBe('noindex, follow')
    expect(r.headers.get('content-security-policy')).not.toContain('unsafe-inline')
    expect(html).toContain('noindex,follow');expect(html).toContain('5 km en línea recta');expect(html).toContain('punto de referencia de AEMET')
    expect(html).toContain('Real Observatorio');expect(html).toContain('Municipio indicado en la ficha: Otro municipio')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('https://www.openstreetmap.org/node/123');expect(html).toContain('/cerca?servicio=osm-node-123')
  })
  it('la caída devuelve503 explicativo, no un falso resultado vacío',async()=>{
    const f=fixture();f.fetch.mockRejectedValue(Error('caída'));const r=await f.request(),html=await r.text()
    expect(r.status).toBe(503);expect(html).toContain('No se puede comprobar');expect(html).not.toContain('0 lugares')
  })
  it('redirige el nombre antiguo a la URL canónica de la ficha comprobada',async()=>{
    const f=fixture(),r=await f.request('/servicios/municipio/28079/nombre-antiguo')
    expect(r.status).toBe(301);expect(r.headers.get('location')).toBe('/servicios/municipio/28079/madrid')
  })
  it('ofrece navegación desde provincias y pagina50municipios sin ocultar el resto',async()=>{
    const rows=Array.from({length:51},(_,i)=>row(String(28001+i),'Municipio'+i)),f=fixture(rows)
    const root=await (await f.request('/servicios/municipios')).text();expect(root).toContain('/servicios/municipios/28')
    const first=await (await f.request('/servicios/municipios/28')).text();expect(first).toContain('Página 1 de 2');expect(first).toContain('?pagina=1');expect(first).not.toContain('Municipio50</a>')
    const last=await (await f.request('/servicios/municipios/28?pagina=1')).text();expect(last).toContain('Municipio50</a>')
    expect((await f.request('/servicios/municipios/28?pagina=2')).status).toBe(404)
  })
})
