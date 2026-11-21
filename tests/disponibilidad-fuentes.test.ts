import {afterEach,describe,expect,it,vi} from 'vitest'
import {cargaDisponibilidad,DisponibilidadFuenteError,type DisponibilidadConsulta} from '../scripts/lib/disponibilidad-fuentes.mjs'

const now=Date.parse('2026-11-21T12:00:00Z'),stamp=(ago=0)=>new Date(now-ago*1000).toISOString()
const consultas:Record<string,DisponibilidadConsulta>={madrid:{fuente:'aparcamientos-madrid',lugarId:'parking-madrid-72',objetivo:'plazas'},vigo:{fuente:'aparcamientos-vigo',lugarId:'parking-vigo-4763',objetivo:'plazas'},bizi:{fuente:'bicis-zaragoza',lugarId:'gbfs-zaragoza-uuid-2',objetivo:'bicis'}}
const urls={madrid:'https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios',vigo:'https://datos-ckan.vigo.org/dataset/t-parking-real',bizi:'https://bizi.zaragoza.es/es/mapa-de-disponibilidad'}
function parking(city='madrid'){
  return {fuenteId:city,consultado:stamp(20),evaluadoEn:stamp(),catalogoConsultado:'2026-11-20T12:00:00Z',fechaDatos:null,fuenteUrl:city==='madrid'?urls.madrid:urls.vigo,total:1,conDisponibilidad:1,estado:'actual',items:[{
    id:city==='madrid'?'parking-madrid-72':'parking-vigo-4763',nombre:'Aparcamiento publicado',lat:city==='madrid'?40.4:42.23,lon:city==='madrid'?-3.7:-8.72,capacidad:100,plazasPmr:5,plazasLibres:0,fechaOcupacion:stamp(60),caduca:stamp(city==='madrid'?-240:-300),estado:'actual',fuenteUrl:city==='madrid'?urls.madrid:urls.vigo,
  }]}
}
function bizi(){return {schema:1,redId:'zaragoza',consultado:stamp(20),evaluadoEn:stamp(),fechaDatos:stamp(30),caduca:stamp(-270),fuenteUrl:urls.bizi,total:1,estado:'actual',items:[{id:consultas.bizi.lugarId,nombre:'Bizi publicada',lat:41.65,lon:-.88,capacidad:19,bicis:7,anclajes:12,actualizado:stamp(60),caduca:stamp(-240),estado:'operativa',permiteAlquiler:true,permiteDevolucion:true}]}}
const load=(query:DisponibilidadConsulta,data:unknown,options={})=>cargaDisponibilidad(query,{now,fetch:vi.fn(async()=>Response.json(data)),...options})
afterEach(()=>vi.useRealTimers())

describe('una red propia, identidad pública y fecha individual de disponibilidad',()=>{
  it.each(['madrid','vigo'])('confirma cero plazas en %s sin usar plazas PMR ni renovar su fecha',async city=>{
    const fetcher=vi.fn(async()=>Response.json(parking(city))),data=await cargaDisponibilidad({...consultas[city],...{modo:'diario',proxima:now,cuenta:'nunca-a-la-red'}},{now,fetch:fetcher})
    expect(data).toMatchObject({id:consultas[city].lugarId,cantidad:0,estado:'actual',fechaDato:stamp(60),fuenteUrl:urls[city as 'madrid'|'vigo']})
    expect(fetcher).toHaveBeenCalledTimes(1)
    const [url,options]=fetcher.mock.calls[0] as unknown as [string,RequestInit]
    expect(url).toBe('https://webapp-3ft.pages.dev/api/aparcamientos/'+city)
    expect(options).toMatchObject({redirect:'manual',headers:{Accept:'application/json'}})
    expect(options).not.toHaveProperty('body');expect(url).not.toContain('?')
    expect(data.enlace).toContain('servicio='+consultas[city].lugarId);expect(data.enlace).not.toContain('nunca-a-la-red')
  })
  it('distingue bicicletas y anclajes con el mismo estado oficial',async()=>{
    expect(await load(consultas.bizi,bizi())).toMatchObject({cantidad:7,estado:'actual',fechaDato:stamp(60)})
    expect(await load({...consultas.bizi,objetivo:'anclajes'},bizi())).toMatchObject({cantidad:12,estado:'actual'})
  })
  it('cero bicicletas y cero anclajes es válido cuando la operación sigue permitida',async()=>{
    const data=bizi();data.items[0].bicis=0;data.items[0].anclajes=0
    expect((await load(consultas.bizi,data)).cantidad).toBe(0)
    expect((await load({...consultas.bizi,objetivo:'anclajes'},data)).cantidad).toBe(0)
  })
  it('no transforma una operación cerrada de Bizi en cero disponible',async()=>{
    const data=bizi();data.items[0].permiteAlquiler=false;data.items[0].bicis=0
    expect(await load(consultas.bizi,data)).toMatchObject({cantidad:null,estado:'sin_confirmar'})
    expect(await load({...consultas.bizi,objetivo:'anclajes'},data)).toMatchObject({cantidad:12,estado:'actual'})
    data.items[0].estado='cerrada'
    expect((await load({...consultas.bizi,objetivo:'anclajes'},data)).cantidad).toBeNull()
  })
  it.each(['madrid','vigo','bizi'])('el límite exacto de caducidad de %s oculta la cifra',async city=>{
    const data=city==='bizi'?bizi():parking(city),item:any=data.items[0],age=city==='vigo'?360:300
    if(city==='bizi'){item.actualizado=stamp(age);(data as ReturnType<typeof bizi>).fechaDatos=stamp(age)}else item.fechaOcupacion=stamp(age)
    item.caduca=stamp()
    expect(await load(consultas[city],data)).toMatchObject({cantidad:null,estado:'sin_confirmar',fechaDato:stamp(age)})
  })
  it('comprueba la caducidad después de terminar la descarga',async()=>{
    let clock=now;const fetcher=vi.fn(async()=>{clock+=241000;return Response.json(bizi())})
    expect(await cargaDisponibilidad(consultas.bizi,{fetch:fetcher,now:()=>clock})).toMatchObject({cantidad:null,estado:'sin_confirmar'})
  })
  it('no prolonga una estación reciente con un parte antiguo',async()=>{
    const data=bizi();data.fechaDatos=stamp(301)
    expect(await load(consultas.bizi,data)).toMatchObject({cantidad:null,estado:'sin_confirmar'})
  })
  it('mantiene una estación vigente en una red parcial, sin exigir que todas lo estén',async()=>{
    const data=bizi();data.estado='parcial'
    expect((await load(consultas.bizi,data)).cantidad).toBe(7)
  })
  it('conserva un catálogo sin coordenadas sin inventar un punto en el mapa',async()=>{
    const data:any=parking();data.items[0].lat=null;data.items[0].lon=null
    expect(await load(consultas.madrid,data)).toMatchObject({lat:null,lon:null,enlace:'https://webapp-3ft.pages.dev/cerca?categorias=aparcamientos-madrid'})
  })
  it('mantiene identidad del respaldo sin devolver cifras antiguas ni PMR libres',async()=>{
    const data:any=parking();data.consultado=null;data.estado='sin_actualizar';data.items[0].estado='sin_confirmar';data.items[0].plazasLibres=null;data.items[0].fechaOcupacion=null;data.items[0].caduca=null
    expect(await load(consultas.madrid,data)).toMatchObject({id:consultas.madrid.lugarId,cantidad:null,estado:'sin_confirmar',fechaDato:null,caduca:null})
  })
})

describe('datos ambiguos y cuerpos no verificables no habilitan avisos',()=>{
  it.each(['futura','imposible','sin-fecha','caduca-extensa','negativa','decimal','capacidad','sin-flags','flag-numerico'])('Bizi %s no produce cantidad confirmada',async mode=>{
    const data:any=bizi(),row=data.items[0]
    if(mode==='futura')row.actualizado=stamp(-1)
    if(mode==='imposible')row.actualizado='2026-02-30T00:00:00Z'
    if(mode==='sin-fecha')delete row.actualizado
    if(mode==='caduca-extensa')row.caduca=stamp(-10000)
    if(mode==='negativa')row.bicis=-1
    if(mode==='decimal')row.bicis=1.5
    if(mode==='capacidad')row.bicis=20
    if(mode==='sin-flags')delete row.permiteAlquiler
    if(mode==='flag-numerico')row.permiteDevolucion=1
    expect(await load(consultas.bizi,data)).toMatchObject({cantidad:null,estado:'sin_confirmar'})
  })
  it.each(['sin-capacidad','exceso','cadena','sin-plazas','caduca-extensa'])('aparcamiento %s no utiliza otra cifra como plazas libres',async mode=>{
    const data:any=parking(),row=data.items[0]
    if(mode==='sin-capacidad')delete row.capacidad
    if(mode==='exceso')row.plazasLibres=101
    if(mode==='cadena')row.plazasLibres='8'
    if(mode==='sin-plazas')delete row.plazasLibres
    if(mode==='caduca-extensa')row.caduca=stamp(-301)
    expect((await load(consultas.madrid,data)).cantidad).toBeNull()
  })
  it.each(['evaluado-futuro','consulta-futura','total','doble-id','otra-red','fuente-ajena','coordenada','nombre-control','id-ajeno'])('rechaza una respuesta incoherente: %s',async mode=>{
    const data:any=bizi()
    if(mode==='evaluado-futuro')data.evaluadoEn=new Date(now+1001).toISOString()
    if(mode==='consulta-futura')data.consultado=stamp(-1)
    if(mode==='total')data.total=2
    if(mode==='doble-id'){data.items.push({...data.items[0]});data.total=2}
    if(mode==='otra-red')data.redId='otra'
    if(mode==='fuente-ajena')data.fuenteUrl='https://example.invalid'
    if(mode==='coordenada')data.items[0].lat=0
    if(mode==='nombre-control')data.items[0].nombre='Lugar\u0000'
    if(mode==='id-ajeno')data.items[0].id='parking-madrid-72'
    await expect(load(consultas.bizi,data)).rejects.toMatchObject({codigo:'respuesta_invalida'})
  })
  it('un lugar eliminado devuelve un error identificable, nunca una ficha inventada',async()=>{
    const data=bizi();data.items=[];data.total=0
    await expect(load(consultas.bizi,data)).rejects.toMatchObject({codigo:'lugar_no_encontrado'})
  })
  it('no consulta red con un ID o un objetivo de otra fuente',async()=>{
    const fetcher=vi.fn()
    for(const input of [{...consultas.madrid,lugarId:'../../secreto'},{...consultas.madrid,objetivo:'bicis'},{...consultas.bizi,fuente:'fuente-ajena'}])await expect(cargaDisponibilidad(input as DisponibilidadConsulta,{fetch:fetcher,now})).rejects.toMatchObject({codigo:'solicitud_invalida'})
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['redirect','html','demasiado-header','demasiado-stream','json-roto','caida'])('controla descarga %s sin seguir redirecciones ni dar cifras',async mode=>{
    const fetcher=vi.fn(async()=>mode==='redirect'?new Response(null,{status:302,headers:{Location:'https://example.invalid'}}):mode==='html'?new Response('<html>error</html>'):mode==='demasiado-header'?new Response('{}',{headers:{'Content-Type':'application/json','Content-Length':'1048577'}}):mode==='demasiado-stream'?new Response(new Uint8Array(1048577),{headers:{'Content-Type':'application/json'}}):mode==='json-roto'?new Response('{',{headers:{'Content-Type':'application/json'}}):new Response(null,{status:503}))
    await expect(cargaDisponibilidad(consultas.bizi,{fetch:fetcher,now})).rejects.toBeInstanceOf(DisponibilidadFuenteError)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['cabeceras','cuerpo'])('aborta si se detiene la descarga de %s',async mode=>{
    vi.useFakeTimers();let signal:AbortSignal|null|undefined
    const fetcher=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{signal=init?.signal;return mode==='cabeceras'?await new Promise<Response>(()=>{}):new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{'))}}),{headers:{'Content-Type':'application/json'}})})
    const result=cargaDisponibilidad(consultas.bizi,{fetch:fetcher,now,timeoutMs:20})
    const assertion=expect(result).rejects.toMatchObject({codigo:'fuente_no_disponible'})
    await vi.advanceTimersByTimeAsync(21);await assertion;expect(signal?.aborted).toBe(true)
  })
})

describe('desfase limitado del reloj de evaluación sin rejuvenecer fuentes',()=>{
  it.each(['madrid','vigo','bizi'])('acepta74ms de evaluación adelantada en %s, sin cambiar fechas',async city=>{
    const data=city==='bizi'?bizi():parking(city);data.evaluadoEn=new Date(now+74).toISOString()
    const point=await load(consultas[city],data)
    expect(point).toMatchObject({estado:'actual',fechaDato:stamp(60),caduca:data.items[0].caduca})
  })
  it.each(['madrid','vigo','bizi'])('no confirma %s si caduca entre recepción y evaluación',async city=>{
    const data=city==='bizi'?bizi():parking(city),item:any=data.items[0],ttl=city==='vigo'?360000:300000
    data.evaluadoEn=new Date(now+74).toISOString();item.caduca=new Date(now+50).toISOString()
    if(city==='bizi'){item.actualizado=new Date(now+50-ttl).toISOString();(data as ReturnType<typeof bizi>).fechaDatos=item.actualizado}else item.fechaOcupacion=new Date(now+50-ttl).toISOString()
    expect(await load(consultas[city],data)).toMatchObject({cantidad:null,estado:'sin_confirmar',caduca:item.caduca})
  })
  it('tolera exactamente1s de evaluación pero rechaza1s+1ms',async()=>{
    const data=parking();data.evaluadoEn=new Date(now+1000).toISOString()
    expect((await load(consultas.madrid,data)).estado).toBe('actual')
    data.evaluadoEn=new Date(now+1001).toISOString()
    await expect(load(consultas.madrid,data)).rejects.toMatchObject({codigo:'respuesta_invalida'})
  })
  it.each(['madrid','bizi'])('la tolerancia no habilita una fecha individual futura en %s',async city=>{
    const data=city==='bizi'?bizi():parking(city),item:any=data.items[0]
    data.evaluadoEn=new Date(now+74).toISOString();data.consultado=new Date(now+70).toISOString()
    if(city==='bizi')item.actualizado=new Date(now+1).toISOString();else item.fechaOcupacion=new Date(now+1).toISOString()
    expect(await load(consultas[city],data)).toMatchObject({cantidad:null,estado:'sin_confirmar',fechaDato:null})
  })
  it('un parte Bizi futuro tampoco se confirma por tener consulta y evaluación adelantadas',async()=>{
    const data=bizi();data.evaluadoEn=new Date(now+74).toISOString();data.consultado=new Date(now+70).toISOString();data.fechaDatos=new Date(now+1).toISOString()
    expect(await load(consultas.bizi,data)).toMatchObject({cantidad:null,estado:'sin_confirmar',fechaDato:stamp(60)})
  })
  it('consulta propia queda acotada por evaluación, sin margen independiente',async()=>{
    const data=parking();data.evaluadoEn=new Date(now+74).toISOString();data.consultado=new Date(now+70).toISOString()
    expect((await load(consultas.madrid,data)).estado).toBe('actual')
    data.consultado=new Date(now+75).toISOString()
    await expect(load(consultas.madrid,data)).rejects.toMatchObject({codigo:'respuesta_invalida'})
  })
})
