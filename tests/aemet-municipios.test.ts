import {describe,it,expect,vi} from 'vitest'
// @ts-expect-error Los tests usan Node; la aplicación usa tipos de Workers.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
// @ts-expect-error Los tests usan Node; la aplicación usa tipos de Workers.
import {tmpdir} from 'node:os'
// @ts-expect-error Los tests usan Node; la aplicación usa tipos de Workers.
import {join,resolve,sep,basename} from 'node:path'
import {AEMET_MAESTRO_URL,urlDatosMaestro,preparaMaestroMunicipios,actualizaMaestroMunicipios} from '../scripts/lib/aemet-municipios.mjs'
import {PROVINCIAS_INE} from '../scripts/lib/provincias-ine.mjs'
const now=Date.parse('2026-11-21T12:00:00Z'),ts=new Date(now).toISOString(),old='2026-09-06T12:00:00.000Z'
const raw=()=>PROVINCIAS_INE.flatMap(p=>Array.from({length:135},(_,i)=>({id:'id'+p.id+String(i+1).padStart(3,'0'),nombre:'Localidad '+p.id+' '+i,latitud_dec:['35','38'].includes(p.id)?'28.4':'40.4',longitud_dec:['35','38'].includes(p.id)?'-16.4':'-3.7',num_hab:'200'})))
const previous=()=>preparaMaestroMunicipios(raw(),null,{consultado:old,fechaDatos:null})
async function temporary(){const dir=await mkdtemp(join(tmpdir(),'eu-aemet-maestro-'));return {dir,output:join(dir,'municipios.json'),statusPath:join(dir,'estado.json')}}
async function clean(dir:string){if(!resolve(dir).startsWith(resolve(tmpdir())+sep)||!basename(dir).startsWith('eu-aemet-maestro-'))throw Error('Ruta de limpieza fuera de pruebas');await rm(dir,{recursive:true,force:true})}
describe('maestro AEMET independiente y con fechas honestas',()=>{
  it('una comprobación del mismo contenido conserva su fecha de copia',()=>{
    const p=previous(),m=preparaMaestroMunicipios(raw().reverse(),p,{consultado:ts,fechaDatos:null})
    expect(m.generado).toBe(old);expect(m.consultado).toBe(ts);expect(m.fechaDatos).toBeNull();expect(m.total).toBe(7020)
  })
  it('un contenido nuevo guarda fecha de copia separada de la fecha original',()=>{
    const p=previous(),data=raw();data[0].nombre='Nombre corregido'
    const m=preparaMaestroMunicipios(data,p,{consultado:ts,fechaDatos:'2026-11-20T10:00:00Z'})
    expect(m.generado).toBe(ts);expect(m.fechaDatos).toBe('2026-11-20T10:00:00Z')
  })
  it('rechaza duplicados, coordenadas incompletas, provincia ausente y fecha futura',()=>{
    const duplicate=raw();duplicate[1]=duplicate[0]
    expect(()=>preparaMaestroMunicipios(duplicate,null,{consultado:ts})).toThrow()
    const coords=raw();coords[0].latitud_dec=''
    expect(()=>preparaMaestroMunicipios(coords,null,{consultado:ts})).toThrow()
    expect(()=>preparaMaestroMunicipios(raw().filter(r=>!r.id.startsWith('id51')),null,{consultado:ts})).toThrow()
    expect(()=>preparaMaestroMunicipios(raw(),null,{consultado:ts,fechaDatos:'2026-11-22T00:00:00Z'})).toThrow()
  })
  it.each(['http://opendata.aemet.es/opendata/sh/1234','https://otra.example/opendata/sh/1234','https://opendata.aemet.es/opendata/sh/1234?api_key=x','https://usuario@opendata.aemet.es/opendata/sh/1234','https://opendata.aemet.es/administracion/1234'])('no permite destino arbitrario: %s',url=>expect(urlDatosMaestro(url)).toBeNull())
  it('sólo envía la clave al endpoint inicial y conserva los metadatos de origen',async()=>{
    const f=await temporary();try{
      await writeFile(f.output,JSON.stringify(previous()))
      const get=vi.fn(async(url:any,opts:any)=>url===AEMET_MAESTRO_URL?Response.json({estado:200,datos:'https://opendata.aemet.es/opendata/sh/data1234',metadatos:'https://opendata.aemet.es/opendata/sh/meta1234'}):url.endsWith('data1234')?new Response(JSON.stringify(raw()),{headers:{'content-type':'application/json;charset=utf-8','last-modified':'Fri, 20 Nov 2026 10:00:00 GMT'}}):Response.json({campos:[{id:'nombre',descripcion:'Nombre del municipio'}],licencia:'Condiciones de reutilización AEMET'}))
      const result=await actualizaMaestroMunicipios({...f,key:'credencial-de-prueba',fetcher:get,now})
      expect(result.correcto).toBe(true);expect(get).toHaveBeenCalledTimes(3)
      expect(get.mock.calls[0][1].headers.api_key).toBe('credencial-de-prueba')
      expect(get.mock.calls[1][1].headers).not.toHaveProperty('api_key');expect(get.mock.calls[2][1].headers).not.toHaveProperty('api_key')
      expect(get.mock.calls.every(([,o])=>o.redirect==='manual')).toBe(true)
      const saved=JSON.parse(await readFile(f.output,'utf8'));expect(saved.generado).toBe(old);expect(saved.consultado).toBe(ts);expect(saved.fechaDatos).toBe('2026-11-20T10:00:00.000Z');expect(saved.metadatos.campos[0].id).toBe('nombre')
    }finally{await clean(f.dir)}
  })
  it('un fallo conserva byte a byte el catálogo previo y publica estado de error con último éxito antiguo',async()=>{
    const f=await temporary();try{
      const content=JSON.stringify(previous());await writeFile(f.output,content)
      const get=vi.fn(async()=>{throw Error('fallo remoto')})
      const result=await actualizaMaestroMunicipios({...f,key:'credencial-de-prueba',fetcher:get,now})
      expect(result.correcto).toBe(false);expect(await readFile(f.output,'utf8')).toBe(content)
      expect(JSON.parse(await readFile(f.statusPath,'utf8'))).toMatchObject({estado:'conservada',consultado:ts,ultimoExito:old,total:7020})
    }finally{await clean(f.dir)}
  })
  it('rechaza el enlace externo antes de enviar una segunda petición',async()=>{
    const f=await temporary();try{
      const get=vi.fn(async()=>Response.json({estado:200,datos:'https://otra.example/data'}))
      const result=await actualizaMaestroMunicipios({...f,key:'credencial-de-prueba',fetcher:get,now})
      expect(result.correcto).toBe(false);expect(get).toHaveBeenCalledTimes(1);expect(result.status.estado).toBe('error')
    }finally{await clean(f.dir)}
  })
})
