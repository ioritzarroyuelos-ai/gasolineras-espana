import {describe,it,expect,vi,afterEach} from 'vitest'
// @ts-expect-error Tests Node; la aplicación se compila con tipos Workers.
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises'
// @ts-expect-error Tests Node; la aplicación se compila con tipos Workers.
import {join,resolve} from 'node:path'
// @ts-expect-error Tests Node; la aplicación se compila con tipos Workers.
import {tmpdir} from 'node:os'
import {categoriasServicio,SERVICIOS_IDS} from '../scripts/lib/servicios-catalogo.mjs'
import {normalizaServicio,validaServicio,validaServiciosIndex,validaServiciosTile,servicioTileId,servicioTileBbox,servicioContienePunto,webServicio,SERVICIOS_LIMITE_URL,SERVICIOS_LIMITE_ATRIBUCION} from '../scripts/lib/servicios.mjs'
import type {ServicioFuente} from '../scripts/lib/servicios.mjs'
import {SERVICIOS_FUENTES,urlExtractoPermitida,mismoExtractoPublicado,peticionExtracto,descargaExtracto,descargaLimiteTerritorial,leePois,preparaSnapshot,leeSnapshot,guardaSnapshot,coberturaRegionalServicios,validaContinuidadServicios} from '../scripts/fetch-servicios.mjs'

const ts='2026-11-21T10:00:00.000Z',now=Date.parse(ts),fecha='2026-11-19T21:22:20.000Z'
const fuente:ServicioFuente={id:'espana',url:'https://download.geofabrik.de/europe/spain/spain-261119.osm.pbf',fechaDatos:fecha,consultado:ts,bytes:1504079862}
const raw=(tags:Record<string,string>={},extra:Record<string,unknown>={})=>({type:'node',id:'123',lat:40.4168,lon:-3.7038,tags:{amenity:'toilets',name:'Baños de la plaza',...tags},timestamp:'2020-01-10T12:00:00Z',...extra})
const poi=(tags:Record<string,string>={},extra:Record<string,unknown>={})=>normalizaServicio(raw(tags,extra))!
const paths:string[]=[]
async function temporary(){const path=await mkdtemp(join(tmpdir(),'servicios-test-'));paths.push(path);return path}
afterEach(async()=>{vi.restoreAllMocks();for(const path of paths.splice(0)){if(!resolve(path).startsWith(resolve(tmpdir()))||!path.includes('servicios-test-'))throw Error('Ruta de prueba inválida');await rm(path,{recursive:true,force:true})}})

describe('clasificación conservadora de servicios',()=>{
  it('no convierte una fuente decorativa ni agua no potable en agua de beber',()=>{
    expect(categoriasServicio({amenity:'fountain'})).not.toContain('agua-potable')
    expect(categoriasServicio({amenity:'drinking_water',drinking_water:'no'})).not.toContain('agua-potable')
    expect(categoriasServicio({amenity:'drinking_water'})).toContain('agua-potable')
    expect(categoriasServicio({amenity:'fountain',drinking_water:'yes'})).toContain('agua-potable')
  })
  it('no inventa urgencias, guardias ni piscinas públicas',()=>{
    expect(categoriasServicio({amenity:'hospital'})).toEqual(['hospitales'])
    expect(categoriasServicio({amenity:'hospital',emergency:'yes'})).toEqual(['hospitales','urgencias'])
    expect(categoriasServicio({amenity:'veterinary',opening_hours:'24/7'})).toEqual(['veterinarios'])
    expect(categoriasServicio({amenity:'pharmacy'})).toEqual(['farmacias'])
    expect(categoriasServicio({leisure:'swimming_pool'})).toEqual([])
    expect(categoriasServicio({leisure:'swimming_pool',access:'yes'})).toEqual(['piscinas'])
  })
  it('no confunde agencias privadas ni redes con oficinas públicas o wifi gratuito',()=>{
    expect(categoriasServicio({office:'employment_agency'})).toEqual([])
    expect(categoriasServicio({office:'government',government:'employment_agency'})).toEqual(['sepe'])
    expect(categoriasServicio({internet_access:'wlan'})).toEqual([])
    expect(categoriasServicio({internet_access:'wlan','internet_access:fee':'no',access:'yes'})).toEqual(['wifi'])
    expect(SERVICIOS_IDS.has('puntos-violeta')).toBe(true)
    expect(categoriasServicio({name:'Punto Violeta'})).toEqual([])
  })
  it.each(['no','private','permit','military'])('descarta acceso %s',access=>expect(normalizaServicio(raw({access}))).toBeNull())
  it.each<Record<string,string>>([{disused:'yes'},{abandoned:'building'},{construction:'shop'},{'disused:amenity':'toilets'},{end_date:'2025'}])('descarta equipamientos retirados %j',tags=>expect(normalizaServicio(raw(tags))).toBeNull())
  it('conserva lo desconocido y un horario literal sin prometer apertura',()=>{
    const p=poi({opening_hours:'Mo-Fr 09:00-18:00; PH off'})
    expect(p.gratis).toBeNull();expect(p.accesible).toBe('desconocido');expect(p.acceso).toBe('desconocido')
    expect(p.horario).toBe('Mo-Fr 09:00-18:00; PH off');expect(p).not.toHaveProperty('abierto')
    expect(p).not.toHaveProperty('municipio');expect(p).not.toHaveProperty('direccion')
    expect(p.fechaEdicion).toBe('2020-01-10T12:00:00Z')
    expect(poi({fee:'no','fee:conditional':'yes @ (Mo-Fr)'}).gratis).toBeNull()
    expect(poi({fee:'no',wheelchair:'limited',access:'customers'})).toMatchObject({gratis:true,accesible:'limitado',acceso:'clientes'})
  })
  it('nunca corta una condición del horario ni presenta acceso condicional como libre',()=>{
    const long='Mo-Fr 09:00-18:00; '.repeat(14)+'PH off'
    expect(long.length).toBeGreaterThan(240)
    expect(poi({opening_hours:long})).not.toHaveProperty('horario')
    expect(poi({opening_hours:'24/7',access:'yes','access:conditional':'no @ (PH)'})).toMatchObject({acceso:'desconocido'})
    expect(poi({opening_hours:'24/7',access:'yes','access:conditional':'no @ (PH)'})).not.toHaveProperty('horario')
    expect(poi({wheelchair:'yes','wheelchair:conditional':'no @ (Mo)'}).accesible).toBe('desconocido')
    expect(poi({phone:'1'.repeat(81)})).not.toHaveProperty('telefono')
  })
  it('identifica el objeto original y los recintos sin inventar una entrada',()=>{
    const p=poi({'addr:street':'Calle Mayor','addr:housenumber':'7','addr:city':'Madrid','addr:postcode':'28001'}, {type:'way',id:'456'})
    expect(p).toMatchObject({id:'osm-way-456',fuenteUrl:'https://www.openstreetmap.org/way/456',ubicacion:'recinto',direccion:'Calle Mayor, 7',municipio:'Madrid',cp:'28001'})
    expect(normalizaServicio(raw({'addr:country':'PT'}))).toBeNull()
    expect(normalizaServicio(raw({}, {lat:0,lon:0}))).toBeNull()
    expect(poi({}, {lat:28.1248,lon:-15.43}).id).toBe('osm-node-123')
  })
  it.each(['javascript:alert(1)','https://user:pass@example.com','http://127.0.0.1','http://2130706433','http://192.168.1.1','http://0.0.0.0','http://[::1]','http://site.local','https://evil.test'])('descarta enlaces inseguros %s',url=>expect(webServicio(url)).toBeUndefined())
  it('valida también los textos al leer JSON ajeno al robot',()=>{
    expect(webServicio('https://www.madrid.es')).toBe('https://www.madrid.es/')
    expect(webServicio('https://www.madrid.es/'+'á'.repeat(100))).toBeUndefined()
    expect(poi({phone:'javascript:alert(1)'}).telefono).toBeUndefined()
    expect(()=>validaServicio({...poi(),telefono:'javascript:alert(1)'},now)).toThrow()
    expect(()=>validaServicio({...poi(),nombre:'Nombre\u0000oculto'},now)).toThrow()
    expect(()=>validaServicio({...poi(),acceso:'privado'},now)).toThrow()
    expect(()=>validaServicio({...poi(),fechaEdicion:'2026-11-22T00:00:00Z'},now)).toThrow()
  })
})

describe('copias completas y fechas honestas',()=>{
  const coverage=(rows:[string,number][])=>({total:rows.reduce((n,[,count])=>n+count,0),tiles:rows.map(([id,count])=>({id,bbox:servicioTileBbox(id),count,bytes:1000,sha256:'a'.repeat(64)}))})
  it('una pérdida del90% en Canarias aborta aunque el total apenas cambie',()=>{
    const old=coverage([['521-705',10000],['525-728',10000],['472-658',1000]])
    const next=coverage([['521-705',10000],['525-728',10000],['472-658',100]])
    expect(next.total/old.total).toBeGreaterThan(0.95)
    expect(()=>validaContinuidadServicios(old,next)).toThrow('Canarias')
    expect(()=>validaContinuidadServicios(coverage([['521-705',1000],['472-658',10000],['473-654',10000]]),coverage([['521-705',100],['472-658',10000],['473-654',10000]]))).toThrow('España sin Canarias')
  })
  it('dividir o desplazar hojas dentro de la región no cambia su recuento',()=>{
    const old=coverage([['521-705',1000],['472-658',1000]])
    const next=coverage([['521-705.0',400],['521-706',600],['472-658.0.0',250],['472-658.0.1',250],['473-654.3',500]])
    expect(coberturaRegionalServicios(old)).toEqual({espana:1000,canarias:1000})
    expect(coberturaRegionalServicios(next)).toEqual(coberturaRegionalServicios(old))
    expect(()=>validaContinuidadServicios(old,next)).not.toThrow()
    expect(()=>validaContinuidadServicios(old,coverage([['521-705',1000],['472-658',700]]))).not.toThrow()
    expect(()=>validaContinuidadServicios(old,coverage([['521-705',1000],['472-658',699]]))).toThrow('Canarias')
    expect(()=>validaContinuidadServicios(null,next)).not.toThrow()
  })
  it('cada punto queda en su cuadrícula y un identificador nunca puede ser ruta',()=>{
    const p=poi(),id=servicioTileId(p.lat,p.lon)
    expect(servicioTileBbox(id)).toEqual([-3.75,40.25,-3.5,40.5])
    expect(()=>validaServiciosTile({schema:1,id,pois:[p,{...p}]},now)).toThrow()
    expect(()=>validaServiciosTile({schema:1,id,pois:[{...p,lon:-4.2}]},now)).toThrow()
    expect(()=>servicioTileBbox('../index')).toThrow()
    expect(()=>servicioTileBbox('720-1000')).toThrow()
  })
  it('los límites semiabiertos no duplican puntos entre cuatro hojas vecinas',()=>{
    expect(servicioTileBbox('521-705.0')).toEqual([-3.75,40.25,-3.625,40.375])
    expect(servicioTileBbox('521-705.3')).toEqual([-3.625,40.375,-3.5,40.5])
    expect(servicioTileId(40.375,-3.625,1)).toBe('521-705.3')
    expect([0,1,2,3].filter(q=>servicioContienePunto('521-705.'+q,40.375,-3.625))).toEqual([3])
    expect(()=>servicioTileBbox('521-705.4')).toThrow()
    expect(()=>servicioTileBbox('521-705.0.1.2.3.0')).toThrow()
  })
  it('divide sólo las zonas grandes y conserva todos los puntos bajo2MB por fichero',()=>{
    const points=Array.from({length:6000},(_,i)=>poi({name:'Lugar '+String(i).padStart(6,'0')+' '+ 'x'.repeat(160)},{id:String(i+1),lat:i%4<2?40.3:40.45,lon:i%2?-3.55:-3.7}))
    const copy=preparaSnapshot(points,[fuente],ts)
    expect(copy.index.total).toBe(6000);expect(copy.index.tiles).toHaveLength(4)
    expect(copy.index.tiles.every(t=>t.id.startsWith('521-705.')&&t.bytes<=2*1024*1024)).toBe(true)
    expect(copy.index.tiles.reduce((n,t)=>n+t.count,0)).toBe(6000)
    for(const content of copy.files.values())expect(()=>validaServiciosTile(JSON.parse(content),now)).not.toThrow()
    const bad={...copy.index,total:7500,categorias:{banos:7500},tiles:[...copy.index.tiles,{...copy.index.tiles[0],id:'521-705',bbox:servicioTileBbox('521-705')}]}
    expect(()=>validaServiciosIndex(bad,now)).toThrow('solapadas')
  })
  it('una nueva consulta no rejuvenece el PBF ni los lugares ni reescribe tiles',()=>{
    const first=preparaSnapshot([poi()],[fuente],ts)
    const second=preparaSnapshot([poi()],[{...fuente,consultado:'2026-11-22T10:00:00.000Z'}],'2026-11-22T10:00:00.000Z')
    expect(first.files).toEqual(second.files)
    expect(first.index.tiles).toEqual(second.index.tiles)
    expect(first.index.fechaDatos).toBe(second.index.fechaDatos)
    expect(first.index.fechaDatos).toBe(fecha)
    expect([...second.files.values()][0]).toContain('2020-01-10T12:00:00Z')
  })
  it('deduplica fronteras de extractos conservando la edición más nueva',()=>{
    const old=poi(),latest={...old,nombre:'Nombre corregido',fechaEdicion:'2026-10-01T00:00:00Z'}
    const copy=preparaSnapshot([latest,old],[fuente],ts)
    expect(copy.index.total).toBe(1)
    expect([...copy.files.values()][0]).toContain('Nombre corregido')
  })
  it('rechaza índices adulterados, fuentes cambiadas y recuentos imposibles',()=>{
    const index=preparaSnapshot([poi()],[fuente],ts).index
    expect(validaServiciosIndex(index,now)).toBe(index)
    for(const bad of [
      {...index,total:2}, {...index,fechaDatos:ts}, {...index,ts:'2026-11-22T00:00:00Z'},
      {...index,fuentes:[{...fuente,url:'https://example.com/espana.osm.pbf'}]},
      {...index,fuentes:[{...fuente,id:'canarias'}]},
      {...index,tiles:[{...index.tiles[0],id:'../../index'}]},
      {...index,tiles:[{...index.tiles[0],sha256:'no-es-un-hash'}]},
      {...index,tiles:[{...index.tiles[0],bytes:3*1024*1024}]},
    ])expect(()=>validaServiciosIndex(bad,now)).toThrow()
  })
  it('conserva atribución y consulta IGN separadas de la fecha OSM',()=>{
    const limite={fuenteUrl:SERVICIOS_LIMITE_URL,atribucion:SERVICIOS_LIMITE_ATRIBUCION,licencia:'CC-BY-4.0' as const,consultado:ts,bytes:156860166,sha256:'a'.repeat(64),administraciones:19 as const}
    const copy=preparaSnapshot([poi()],[fuente],ts,limite)
    expect(copy.index.limiteTerritorial).toEqual(limite);expect(copy.index.fechaDatos).toBe(fecha)
    expect(()=>validaServiciosIndex({...copy.index,limiteTerritorial:{...limite,administraciones:20}},now)).toThrow()
  })
  it('no sustituye una copia válida si la nueva tiene un fichero corrupto',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now)
    const folder=join(await temporary(),'servicios'),copy=preparaSnapshot([poi()],[fuente],ts)
    await guardaSnapshot(copy,folder)
    const before=await readFile(join(folder,'index.json'),'utf8')
    const broken={...copy,files:new Map(copy.files)};broken.files.set(copy.index.tiles[0].id,'{"incorrecto":true}')
    await expect(guardaSnapshot(broken,folder)).rejects.toThrow()
    expect(await readFile(join(folder,'index.json'),'utf8')).toBe(before)
    expect((await leeSnapshot(folder,now))?.total).toBe(1)
    await expect(guardaSnapshot(copy,join(folder,'..','otro-destino'))).rejects.toThrow()
  })
  it('detecta corrupción posterior por hash antes de reutilizar la copia',async()=>{
    vi.spyOn(Date,'now').mockReturnValue(now)
    const folder=join(await temporary(),'servicios'),copy=preparaSnapshot([poi()],[fuente],ts)
    await guardaSnapshot(copy,folder)
    await writeFile(join(folder,'tiles',copy.index.tiles[0].id+'.json'),'{}')
    await expect(leeSnapshot(folder,now)).rejects.toThrow('corrupta')
  })
  it('rechaza JSON roto y datos futuros en lugar de publicar una parte',async()=>{
    const file=join(await temporary(),'raw.ndjson')
    await writeFile(file,[raw(),raw({access:'private'},{id:'456'}),raw({}, {timestamp:'2026-10-01T00:00:00Z'})].map(x=>JSON.stringify(x)).join('\n'))
    const parsed=await leePois(file,now)
    expect(parsed).toMatchObject({lines:3,rejected:1});expect(parsed.pois).toHaveLength(1)
    expect(parsed.pois[0].fechaEdicion).toBe('2026-10-01T00:00:00Z')
    await writeFile(file,JSON.stringify(raw())+'\n{')
    await expect(leePois(file,now)).rejects.toThrow()
  })
  it('un separador Unicode dentro de una dirección no rompe el registro NDJSON',async()=>{
    const file=join(await temporary(),'unicode.ndjson')
    await writeFile(file,JSON.stringify(raw({'addr:street':'Barrio Baolafuente, s/n, Rasines\u2028','name':'Baños\u2029públicos'}))+'\n'+JSON.stringify(raw({}, {id:'456'}))+'\n')
    const parsed=await leePois(file,now)
    expect(parsed.pois).toHaveLength(2);expect(parsed.lines).toBe(2)
    expect(parsed.pois[0].direccion).toBe('Barrio Baolafuente, s/n, Rasines')
    expect(parsed.pois[0].nombre).toBe('Baños públicos')
  })
})

describe('descargas públicas acotadas',()=>{
  const source=SERVICIOS_FUENTES[0]
  it('una URL latest no se considera inmutable aunque conserve tamaño',()=>{
    expect(mismoExtractoPublicado(fuente,fuente)).toBe(true)
    expect(mismoExtractoPublicado(fuente,{...fuente,bytes:fuente.bytes+1})).toBe(false)
    const mutable={...fuente,url:source.url}
    expect(mismoExtractoPublicado(mutable,mutable)).toBe(false)
    expect(mismoExtractoPublicado(undefined,fuente)).toBe(false)
  })
  it('sólo acepta los extractos previstos y redirecciones de esa fuente',async()=>{
    const get=vi.fn().mockResolvedValueOnce(new Response(null,{status:302,headers:{location:fuente.url}})).mockResolvedValueOnce(new Response(null,{headers:{'content-length':'1500000'}}))
    expect((await peticionExtracto(source,'HEAD',{fetch:get})).url).toBe(fuente.url)
    expect(get).toHaveBeenCalledTimes(2)
    expect(urlExtractoPermitida(fuente.url,'canarias')).toBe(false)
    expect(urlExtractoPermitida(fuente.url+'?redirect=evil','espana')).toBe(false)
    const bad=vi.fn().mockResolvedValue(new Response(null,{status:302,headers:{location:'http://127.0.0.1/private'}}))
    await expect(peticionExtracto(source,'HEAD',{fetch:bad})).rejects.toThrow('no permitido')
    expect(bad).toHaveBeenCalledTimes(1)
  })
  it('no insiste ante límites HTTP ni acepta descargas de tamaño desconocido',async()=>{
    const rate=vi.fn().mockResolvedValue(new Response('limit',{status:429}))
    await expect(peticionExtracto(source,'HEAD',{fetch:rate})).rejects.toThrow('429')
    expect(rate).toHaveBeenCalledTimes(1)
    const oversized=vi.fn().mockResolvedValue(new Response(null,{headers:{'content-length':'9999999999'}}))
    await expect(peticionExtracto(source,'HEAD',{fetch:oversized})).rejects.toThrow('Tamaño')
    await expect(peticionExtracto(source,'HEAD',{fetch:vi.fn().mockResolvedValue(new Response(null))})).rejects.toThrow('Tamaño')
  })
  it('detecta una descarga cortada aunque devuelva HTTP200',async()=>{
    const path=join(await temporary(),'extract.osm.pbf')
    const get=vi.fn().mockResolvedValue(new Response(new Uint8Array(1000),{headers:{'content-length':'1500'}}))
    await expect(descargaExtracto(source,path,{fetch:get})).rejects.toThrow('incompleta')
  })
  it('descarga el contorno IGN con límite de bytes, hash y origen fijo',async()=>{
    const path=join(await temporary(),'boundary.json'),body=' '.repeat(1100)
    const get=vi.fn().mockResolvedValue(new Response(body,{headers:{'content-type':'application/geo+json'}}))
    const result=await descargaLimiteTerritorial(path,ts,{fetch:get})
    expect(result).toMatchObject({fuenteUrl:SERVICIOS_LIMITE_URL,bytes:1100,administraciones:19,consultado:ts,licencia:'CC-BY-4.0'})
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(get.mock.calls[0][1].redirect).toBe('error')
    const bad=vi.fn().mockResolvedValue(new Response('<html>error</html>',{headers:{'content-type':'text/html'}}))
    await expect(descargaLimiteTerritorial(path+'.bad',ts,{fetch:bad})).rejects.toThrow('IGN')
  })
})
