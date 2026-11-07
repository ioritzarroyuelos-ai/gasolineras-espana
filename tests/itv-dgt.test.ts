import { describe, expect, it, vi } from 'vitest'
import { actualizaFuenteItv, combinaFuentesItv, conservaDatosPreviosItv, estacionesDgt, FUENTES_ITV } from '../scripts/lib/itv-fuentes.mjs'
import type { EstacionFuente, IncidenciaItv, ParteFuenteItv } from '../scripts/lib/itv-fuentes.mjs'
import { estacionesEnMunicipio } from '../src/lib/itv-busqueda'

const fuente = FUENTES_ITV.find(f => f.id === 'dgt')!
const ahora = Date.parse('2026-11-07T15:00:00Z')
const editado = Date.parse('2026-08-21T13:31:15.393Z')
const antiguo = '2026-08-01T06:22:56.815Z'
const meta = { ...fuente, consultado:new Date(ahora).toISOString(), publicado:new Date(editado).toISOString() }
const feature = (id:number) => ({ type:'Feature', id,
  properties:{ OBJECTID_1:id, codigo_centro:2800+id, provincia:'MADRID', municipio:'MADRID',
    direccion:'Calle '+id, codigo_postal:'28001', telefono:'912 345 678', nombre:'ITV '+id, info:'Líneas:3' },
  geometry:{ type:'Point', coordinates:[-3.7,40.4] },
})
const previa:ParteFuenteItv = { ...fuente, consultado:antiguo, ultimoExito:antiguo, publicado:antiguo,
  estado:'actualizada', ...estacionesDgt({features:[feature(1)]},{...meta,consultado:antiguo,publicado:antiguo}),
}
type Json = Record<string, any>

function servidor(opciones:{cantidad?:number;limite?:number;alterar?:(datos:Json,url:URL,consulta:number)=>Json}={}) {
  const filas = Array.from({length:opciones.cantidad ?? 300},(_,i)=>feature(i+1))
  let consulta = 0
  return vi.fn(async (entrada:RequestInfo|URL) => {
    const url = new URL(String(entrada)), q = url.searchParams
    let datos:Json
    if (!url.pathname.endsWith('/query')) datos = {
      objectIdField:'OBJECTID_1', geometryType:'esriGeometryPoint', maxRecordCount:opciones.limite ?? 1000,
      fields:[{name:'OBJECTID_1',type:'esriFieldTypeOID'}],
      editingInfo:{dataLastEditDate:editado,schemaLastEditDate:editado},
    }
    else if (q.get('returnCountOnly')) datos = {count:filas.length}
    else if (q.get('returnIdsOnly')) datos = {objectIdFieldName:'OBJECTID_1',objectIds:filas.map(f=>f.id)}
    else {
      const ids = new Set(q.get('objectIds')!.split(',').map(Number))
      datos = {type:'FeatureCollection',crs:{type:'name',properties:{name:'EPSG:4326'}},features:filas.filter(f=>ids.has(f.id))}
    }
    return Response.json(opciones.alterar?.(datos,url,++consulta) ?? datos,{headers:{'Last-Modified':'Sat, 07 Nov 2026 15:00:00 GMT'}})
  })
}

describe('descarga pública íntegra de ITV DGT', () => {
  it('usa la capa publicada por el mapa oficial, sin credenciales', () => {
    expect(fuente.descarga).toBe('https://services-eu1.arcgis.com/xMJSZjeskIpAzCcP/arcgis/rest/services/ITV_pre/FeatureServer/0')
  })

  it('obtiene todos los lotes por IDs y conserva la fecha de edición, distinta de la consulta', async () => {
    const fetcher=servidor({cantidad:518,limite:150})
    const resultado=await actualizaFuenteItv(fuente,previa,{ahora,fetcher})
    expect(resultado.estado).toBe('actualizada')
    expect(resultado.estaciones).toHaveLength(518)
    expect(resultado.publicado).toBe('2026-08-21T13:31:15.393Z')
    expect(resultado.ultimoExito).toBe('2026-11-07T15:00:00.000Z')
    expect(resultado.estaciones[0]).toMatchObject({codigo:'2801',tel:'912 345 678',lat:40.4,lng:-3.7,lineas:3,
      verificadoEn:'2026-11-07T15:00:00.000Z',publicadoEn:'2026-08-21T13:31:15.393Z'})
    const lotes=fetcher.mock.calls.map(([u])=>new URL(String(u))).filter(u=>u.searchParams.has('objectIds'))
    expect(lotes.map(u=>u.searchParams.get('objectIds')!.split(',').length)).toEqual([150,150,150,68])
    expect(lotes.every(u=>u.searchParams.get('outSR')==='4326')).toBe(true)
  })

  const errores:Array<[string,(d:Json,u:URL,n:number)=>Json]> = [
    ['el antiguo error Token Required dentro de HTTP 200',()=>({error:{code:499,message:'Token Required'}})],
    ['un recuento que no coincide con los IDs',(d,u)=>u.searchParams.has('returnCountOnly')?{count:301}:d],
    ['un ID repetido en el inventario',(d)=>d.objectIds?{...d,objectIds:[1,...d.objectIds.slice(0,-1)]}:d],
    ['un lote cortado aunque el total anterior superara el mínimo',(d)=>d.features?{...d,features:d.features.slice(1)}:d],
    ['un límite de transferencia anunciado',(d)=>d.features?{...d,exceededTransferLimit:true}:d],
    ['un error en el segundo lote',(d,u)=>u.searchParams.get('objectIds')?.startsWith('201,')?{error:{code:500,message:'Error del servidor'}}:d],
    ['una fila duplicada en un lote',(d)=>d.features?{...d,features:[d.features[0],...d.features.slice(0,-1)]}:d],
    ['una página anterior repetida',(d,u)=>u.searchParams.get('objectIds')?.startsWith('201,')?{...d,features:d.features.map((_:unknown,i:number)=>feature(i+1))}:d],
    ['un ID fuera del lote solicitado',(d)=>d.features?{...d,features:[feature(9999),...d.features.slice(1)]}:d],
    ['un sistema de coordenadas diferente',(d)=>d.features?{...d,crs:{properties:{name:'EPSG:3857'}}}:d],
    ['una fecha de edición futura',(d)=>d.editingInfo?{...d,editingInfo:{...d.editingInfo,dataLastEditDate:ahora+1}}:d],
    ['una edición que cambia durante la descarga',(d,_u,n)=>d.editingInfo&&n>1?{...d,editingInfo:{...d.editingInfo,dataLastEditDate:editado+1}}:d],
    ['una fila sin municipio identificable',(d)=>d.features?{...d,features:d.features.map((f:Json)=>({...f,properties:{...f.properties,municipio:''}}))}:d],
  ]
  it.each(errores)('conserva la copia entera y sus fechas ante %s', async (_nombre,alterar) => {
    const resultado=await actualizaFuenteItv(fuente,previa,{ahora,fetcher:servidor({alterar})})
    expect(resultado.estado).toBe('conservada')
    expect(resultado.error).toBeTruthy()
    expect(resultado.estaciones).toEqual(previa.estaciones)
    expect(resultado.ultimoExito).toBe(antiguo)
    expect(resultado.publicado).toBe(antiguo)
  })
})

describe('contrato del mapa DGT', () => {
  it('mantiene las filas sin código con un ID técnico distinto del código oficial', () => {
    const a=feature(517), b=feature(518)
    const datos=estacionesDgt({features:[a,b].map(f=>({...f,properties:{...f.properties,codigo_centro:null}}))},meta)
    expect(datos.estaciones.map(e=>e.id)).toEqual(['itv-28-dgt-517','itv-28-dgt-518'])
    expect(datos.estaciones.map(e=>e.codigo)).toEqual(['',''])
  })

  it('acepta nombres bilingües de provincia sin confundir cod_ine con un municipio', () => {
    const f=feature(1)
    const datos=estacionesDgt({features:[{...f,properties:{...f.properties,provincia:'ARABA/ÁLAVA',codigo_centro:101,
      municipio:'VITORIA-GASTEIZ',codigo_postal:'01195',cod_ine:'1'}}]},meta)
    expect(datos.estaciones[0]).toMatchObject({prov:'01',mun:'VITORIA-GASTEIZ',codigo:'0101',cp:'01195'})
  })

  it('no interpreta metros o coordenadas imposibles como una ubicación válida', () => {
    const f=feature(1)
    expect(estacionesDgt({features:[{...f,geometry:{type:'Point',coordinates:[-400000,5000000]}}]},meta).estaciones[0])
      .toMatchObject({lat:null,lng:null})
    expect(()=>estacionesDgt({features:[{...f,geometry:{type:'Polygon',coordinates:[]}}]},meta)).toThrow('Geometría')
  })
})

describe('conciliación DGT sin duplicados ni traslados inventados', () => {
  const base=estacionesDgt({features:[feature(1)]},meta).estaciones[0]
  const nacional=(datos:Partial<EstacionFuente>={}):EstacionFuente=>({...base,fuente:'industria',tel:'',...datos})
  const contacto=(datos:Partial<EstacionFuente>={}):EstacionFuente=>({...base,...datos})
  function combina(n:EstacionFuente[],d:EstacionFuente[]) {
    const incidencias:IncidenciaItv[]=[]
    const estaciones=combinaFuentesItv([{id:'industria',estaciones:n,excluidas:[]},{id:'dgt',estaciones:d,excluidas:[]}],incidencias)
    return {estaciones,incidencias}
  }

  it('une un centro sin código sólo por municipio, CP y dirección únicos', () => {
    const n=nacional()
    const sinCodigo=contacto({codigo:'',id:'itv-28-dgt-517',idFuente:'517'})
    const r=combina([n],[sinCodigo])
    expect(r.estaciones).toHaveLength(1)
    expect(r.estaciones[0]).toMatchObject({id:n.id,codigo:n.codigo,tel:'912 345 678'})
    expect(r.incidencias).toEqual([])
  })

  it('no publica otro centro sin código si difiere la dirección o hay dos posibles destinatarios', () => {
    const sinCodigo=contacto({codigo:'',id:'itv-28-dgt-517',idFuente:'517'})
    const distinto=combina([nacional({dir:'Otra calle'})],[sinCodigo])
    expect(distinto.estaciones).toHaveLength(1)
    expect(distinto.estaciones[0].tel).toBe('')
    expect(distinto.incidencias[0]).toMatchObject({idFuente:'517',codigo:'',motivo:expect.stringContaining('Sin código')})
    const ambiguo=combina([nacional(),nacional({id:'itv-28-2802',codigo:'2802'})],[sinCodigo])
    expect(ambiguo.estaciones).toHaveLength(2)
    expect(ambiguo.estaciones.every(e=>e.tel==='')).toBe(true)
    expect(ambiguo.incidencias).toHaveLength(1)
  })

  it('resuelve Getafe Morse sin crear una segunda estación por la errata del código DGT', () => {
    const r=combina([nacional({id:'itv-28-2809',codigo:'2809',mun:'GETAFE',cp:'28906',dir:'MORSE 2'})],
      [contacto({id:'itv-28-2889',codigo:'2889',mun:'GETAFE',cp:'28906',dir:'CALLE MORSE, 2.'})])
    expect(r.estaciones).toHaveLength(1)
    expect(r.estaciones[0]).toMatchObject({codigo:'2809',tel:'912 345 678'})
  })

  it('conserva CP y provincia nacionales cuando DGT contradice la estación', () => {
    const r=combina([nacional({id:'itv-39-3903',prov:'39',codigo:'3903',mun:'CORRALES',cp:'39400',dir:'P.I. DE BARROS P-19'})],
      [contacto({id:'itv-39-3903',prov:'39',codigo:'3903',mun:'CORRALES DE BUELNA (LOS)',cp:'29400',dir:'POLÍGONO DE LOS BARROS, P 19'})])
    expect(r.estaciones).toHaveLength(1)
    expect(r.estaciones[0]).toMatchObject({prov:'39',cp:'39400',mun:'CORRALES',tel:''})
    expect(r.incidencias[0].motivo).toContain('incompatibles')
  })

  it('mantiene Barro y no lo traslada a Pontevedra aunque el CP coincida', () => {
    const r=combina([nacional({id:'itv-36-3612',prov:'36',codigo:'3612',mun:'BARRO',cp:'36191'})],
      [contacto({id:'itv-36-3612',prov:'36',codigo:'3612',mun:'PONTEVEDRA',cp:'36191'})])
    expect(r.estaciones[0].mun).toBe('BARRO')
    expect(r.estaciones[0].aliasMunicipios).not.toContain('PONTEVEDRA')
    expect(r.incidencias[0].motivo).toContain('Municipio DGT distinto')
  })

  it('un código DGT repetido no gana por orden ni toma contacto de otra dirección', () => {
    const n=nacional({id:'itv-38-3815',prov:'38',codigo:'3815',mun:'SAN CRISTÓBAL DE LA LAGUNA',cp:'38320',dir:'ZEROLO 14'})
    const d1=contacto({...n,fuente:'dgt',tel:'922109090',dir:'ZEROLO 14'})
    const d2=contacto({...n,fuente:'dgt',tel:'922985711',dir:'CARPINTERIA 1',mun:'OROTAVA (LA)',cp:'38312'})
    for (const d of [[d1,d2],[d2,d1]]) {
      const r=combina([n],d)
      expect(r.estaciones).toHaveLength(1)
      expect(r.estaciones[0]).toMatchObject({codigo:'3815',tel:'922109090',mun:'SAN CRISTÓBAL DE LA LAGUNA'})
      expect(r.incidencias).toHaveLength(1)
    }
  })

  it('concilia documentalmente La Gomera con 3807, sin inventar código ni transferir otra dirección', () => {
    const n=nacional({id:'itv-38-3807',prov:'38',codigo:'3807',mun:'S SEBASTIAN',cp:'38800',dir:'TRANSV GARCIA CABRERA'})
    const d=contacto({id:'itv-38-dgt-409',idFuente:'409',prov:'38',codigo:'',mun:'SAN SEBASTIÁN DE LA GOMERA',
      cp:'38800',dir:'Av. José Aguiar, s/n',op:'ITV La Gomera SGS',tel:'922 87 01 38'})
    const r=combina([n],[d])
    expect(r.estaciones).toHaveLength(1)
    expect(r.estaciones[0]).toMatchObject({id:'itv-38-3807',codigo:'3807',mun:'SAN SEBASTIÁN DE LA GOMERA',
      dir:'TRANSV GARCIA CABRERA',tel:'922 87 01 38',lat:null,lng:null})
    expect(combina([n],[{...d,dir:'Nueva calle 9'}]).estaciones[0].tel).toBe('')
  })

  it('no resucita la sede 3001 cerrada en 2023 desde una copia DGT antigua', () => {
    const vieja=contacto({id:'itv-30-3001',prov:'30',codigo:'3001',mun:'ALCANTARILLA',cp:'30820',dir:'CTRA. DE MULA, KM. 1,8.'})
    expect(combina([], [vieja]).estaciones).toEqual([])
    expect(combina([], [vieja]).incidencias[0].motivo).toContain('BORM 7192')
    expect(combina([nacional({...vieja,fuente:'industria'})], []).estaciones).toEqual([])
    expect(combina([nacional({...vieja,fuente:'industria',dir:'Otra sede 2'})], []).estaciones).toHaveLength(1)
  })

  it.each([
    ['21','2141','21530','Pol. Ind. Santa Bárbara, s/n.','POL. IND. SANTA BÁRBARA, S/Nº. THARSIS'],
    ['24','2401','24231','CTRA ZAMORA, KM 11','CTRA. ZAMORA KM. 11. CEMBRANOS'],
    ['45','4509','45224','Camino de Ciempozuelos, s/n','CAMINO CIEMPOZUELOS, S/N. SESEÑA NUEVO'],
    ['46','4606','46600','CTRA. ALGEMESÍ, S/N','CARRETERA ALGEMES͍, S/N.'],
  ])('usa el punto de DGT actual para la dirección equivalente documentada %s/%s', (prov,codigo,cp,principal,direccionDgt) => {
    const n=nacional({id:'itv-'+prov+'-'+codigo,prov,codigo,cp,dir:principal})
    const d=contacto({...n,fuente:'dgt',dir:direccionDgt,lat:40.4,lng:-3.7,verificadoEn:meta.consultado})
    const r=combina([n],[d]).estaciones[0]
    expect(r).toMatchObject({dir:principal,lat:40.4,lng:-3.7,contactoVerificadoEn:meta.consultado})
    // Una nueva numeración no se vuelve equivalente por tener el mismo código.
    const traslado=combina([n],[{...d,dir:direccionDgt+' 99'}]).estaciones[0]
    expect(traslado).toMatchObject({lat:null,lng:null})
  })
})

describe('continuidad de rutas con identidad de sede comprobada', () => {
  const actual=estacionesDgt({features:[feature(1)]},meta).estaciones[0]

  it('guarda nombres y alias antiguos sin cambiar el municipio, datos ni fechas actuales', () => {
    const anterior={...actual,mun:'Nombre histórico',dir:'C/ 1',aliasMunicipios:['Otra grafía','Nombre histórico']}
    const [r]=conservaDatosPreviosItv([actual],[anterior])
    expect(r.aliasMunicipios).toEqual(['MADRID','Nombre histórico','Otra grafía'])
    const {aliasMunicipios:_,...resto}=r
    expect(resto).toEqual(actual)
    expect(actual.aliasMunicipios).toBeUndefined()
    expect(conservaDatosPreviosItv([r],[r])[0]).toEqual(r)
  })

  it.each([
    {prov:'29'}, {codigo:'2802'}, {cp:'28002'}, {dir:'Otra sede 3'},
  ])('no hereda rutas si cambia la identidad o la sede: %j', cambio => {
    const anterior={...actual,...cambio,mun:'Nombre histórico'}
    expect(conservaDatosPreviosItv([actual],[anterior])[0].aliasMunicipios).toBeUndefined()
  })

  it('no elige entre dos antecedentes de la misma sede ni infiere un código ausente', () => {
    const anterior={...actual,mun:'Nombre histórico'}
    expect(conservaDatosPreviosItv([actual],[anterior,{...anterior,mun:'Otra estación'}])[0].aliasMunicipios).toBeUndefined()
    expect(conservaDatosPreviosItv([{...actual,codigo:''}],[{...anterior,codigo:''}])[0].aliasMunicipios).toBeUndefined()
  })

  it('un alias antiguo de otro municipio no desplaza la ubicación principal reconocida', () => {
    const [r]=conservaDatosPreviosItv([{...actual,prov:'36',codigo:'3612',cp:'36191',mun:'BARRO'}],
      [{...actual,prov:'36',codigo:'3612',cp:'36191',mun:'PONTEVEDRA'}])
    const provincia={provinciaId:'36',provinciaSlug:'pontevedra',provinciaNombre:'Pontevedra',pob:1000,imp:false}
    const catalogo=[{...provincia,ine:'36002',nombre:'Barro',slug:'barro',lat:42.5,lng:-8.6},
      {...provincia,ine:'36038',nombre:'Pontevedra',slug:'pontevedra',lat:42.4,lng:-8.6}]
    expect(estacionesEnMunicipio([r],catalogo[0],catalogo)).toEqual([r])
    expect(estacionesEnMunicipio([r],catalogo[1],catalogo)).toEqual([])
  })
})

describe('último contacto comprobado de la misma sede', () => {
  const actual={...estacionesDgt({features:[feature(1)]},meta).estaciones[0],tel:'',lat:null,lng:null}
  const anterior={...actual,tel:'912 345 678',lat:40.4,lng:-3.7,contactoVerificadoEn:antiguo,
    contactoFuente:'dgt',contactoFuenteUrl:fuente.url}

  it('recupera el bloque completo con su fecha antigua sin rejuvenecerlo al consultar otra fuente', () => {
    const [r]=conservaDatosPreviosItv([actual],[anterior],ahora)
    expect(r).toMatchObject({tel:'912 345 678',lat:40.4,lng:-3.7,contactoVerificadoEn:antiguo,
      contactoFuente:'dgt',contactoFuenteUrl:fuente.url,verificadoEn:new Date(ahora).toISOString()})
    expect(conservaDatosPreviosItv([r],[r],ahora+86400000)[0].contactoVerificadoEn).toBe(antiguo)
  })

  it.each([
    {tel:'911 111 111'}, {lat:40.5,lng:-3.8}, {contactoVerificadoEn:new Date(ahora).toISOString()},
    {contactoFuente:'operador'}, {contactoFuenteUrl:'https://operador.example/estacion'},
  ])('no mezcla contacto antiguo con cualquier parte de un contacto nuevo: %j', nuevo => {
    const entrada={...actual,...nuevo}
    const [r]=conservaDatosPreviosItv([entrada],[anterior],ahora)
    const {aliasMunicipios:_,...datos}=r
    expect(datos).toEqual(entrada)
  })

  it.each([
    {cp:'28002'}, {dir:'Sede trasladada 9'}, {codigo:'2802'}, {prov:'29'},
    {contactoVerificadoEn:undefined}, {contactoVerificadoEn:'sin comprobar'},
    {contactoVerificadoEn:new Date(ahora+86400000).toISOString()}, {contactoFuente:undefined}, {contactoFuenteUrl:undefined},
  ])('no recupera un contacto sin identidad y procedencia comprobables: %j', cambio => {
    const [r]=conservaDatosPreviosItv([actual],[{...anterior,...cambio}],ahora)
    expect(r).toMatchObject({tel:'',lat:null,lng:null})
    expect(r.contactoVerificadoEn).toBeUndefined()
  })

  it('no devuelve contacto a la sede cerrada de Alcantarilla aunque coincida con la copia antigua', () => {
    const cerrada={...actual,codigo:'3001',prov:'30',cp:'30820',dir:'Ctra. de Mula, km. 1,8'}
    const previa={...anterior,...cerrada,tel:'968 800 000'}
    expect(conservaDatosPreviosItv([cerrada],[previa],ahora)[0].tel).toBe('')
  })

  it.each([
    ['3006','30100','AVDA. JUAN CARLOS I, SN','868459510','968307444','30100','https://mui.carm.es/ja/web/mui/listado-de-estaciones-itv-autorizadas'],
    ['3013','30201','P.I. CABEZO BEAZA, CALLE BERLÍN, 1','968677196','968677199','30353','https://www.itevelesa.com/es/nuestras-estaciones/itv-antigua-morata'],
    ['3010','30001','AVDA. DE ALICANTE, 10','968852301','968852301','30007','https://itvciudaddemurcia.com/contacto/'],
  ])('prioriza el contacto comprobado y fijo de Murcia %s sin cambiar sede ni heredar coordenadas', (codigo,cp,dir,telAntes,tel,cpFinal,url) => {
    const sede={...actual,prov:'30',codigo,cp,dir}
    const vieja={...anterior,...sede,tel:telAntes,lat:38,lng:-1.1,aliasMunicipios:['Nombre histórico']}
    const [r]=conservaDatosPreviosItv([sede],[vieja],ahora)
    expect(r).toMatchObject({tel,cp:cpFinal,dir,lat:null,lng:null,contactoVerificadoEn:'2026-11-07',contactoFuenteUrl:url})
    expect(r.aliasMunicipios).toContain('Nombre histórico')
    expect(conservaDatosPreviosItv([sede],[r],ahora+86400000)[0].contactoVerificadoEn).toBe('2026-11-07')
    expect(conservaDatosPreviosItv([{...sede,dir:'Otro emplazamiento 9'}],[vieja],ahora)[0].tel).toBe('')
    expect(conservaDatosPreviosItv([{...sede,cp:'30999'}],[vieja],ahora)[0].tel).toBe('')
    if (codigo !== '3010') {
      const copiaConsultadaHoy={...sede,tel:telAntes,lat:38,lng:-1.1,contactoVerificadoEn:meta.consultado,
        contactoFuente:'dgt',contactoFuenteUrl:fuente.url}
      expect(conservaDatosPreviosItv([copiaConsultadaHoy],[],ahora)[0])
        .toMatchObject({tel,lat:null,lng:null,contactoVerificadoEn:'2026-11-07',contactoFuenteUrl:url})
    }
  })

  it('una comprobación posterior del operador prevalece sobre la corrección puntual', () => {
    const sede={...actual,prov:'30',codigo:'3006',cp:'30100',dir:'AVDA. JUAN CARLOS I, SN',tel:'968 307 383',
      lat:38,lng:-1.1,contactoVerificadoEn:'2026-11-08',contactoFuente:'operador',contactoFuenteUrl:'https://itvespinardo.com/'}
    expect(conservaDatosPreviosItv([sede],[],ahora+86400000)[0]).toEqual(sede)
  })
})
