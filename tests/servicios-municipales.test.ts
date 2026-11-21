import {describe,it,expect} from 'vitest'
import {distanciaMunicipal,fichaMunicipal,validaResumenMunicipal,validaIndiceMunicipal,validaCatalogoMunicipal,contenidoMunicipalSuficiente,type ResumenMunicipal} from '../scripts/lib/servicios-municipales.mjs'
import {resumeMunicipios,empaquetaMunicipios,publicaMunicipios,leeArchivoAcotado} from '../scripts/gen-servicios-municipales.mjs'
// @ts-expect-error Los tests usan Node; la aplicación usa tipos de Workers.
import {mkdtemp,readFile,writeFile,readdir,rm,mkdir} from 'node:fs/promises'
// @ts-expect-error Los tests usan Node; la aplicación usa tipos de Workers.
import {tmpdir} from 'node:os'
// @ts-expect-error Los tests usan Node; la aplicación usa tipos de Workers.
import {join,resolve,sep,basename} from 'node:path'
import {servicioTileId,type ServicioPoi} from '../scripts/lib/servicios.mjs'
const now=Date.parse('2026-11-21T12:00:00Z')
const centro={lat:40.4168,lon:-3.7038}
async function limpiaTemporal(path:string){if(!resolve(path).startsWith(resolve(tmpdir())+sep)||!basename(path).startsWith('eu-municipales-'))throw Error('Ruta de limpieza fuera de las pruebas');await rm(path,{recursive:true,force:true})}
function poi(metres=100,id='osm-node-123'):ServicioPoi {
  return {id,nombre:'Biblioteca publicada',categorias:['bibliotecas'],lat:centro.lat+metres/6371008.8*180/Math.PI,lon:centro.lon,gratis:null,accesible:'desconocido',acceso:'publico',ubicacion:'punto',fuenteUrl:'https://www.openstreetmap.org/node/'+id.split('-').at(-1),fechaEdicion:'2020-01-01T00:00:00Z'}
}
function row(metres=100):ResumenMunicipal {
  const p=poi(metres)
  return {ine:'28079',nombre:'Madrid',slug:'madrid',provincia:'Madrid',provinciaSlug:'madrid',centro,radioM:5000,total:1,categorias:{bibliotecas:1},lugares:[fichaMunicipal(p,servicioTileId(p.lat,p.lon),distanciaMunicipal(centro,p))]}
}
const index=()=>({schema:1,provincia:'28',centros:[{ine:'28079',nombre:'Madrid',slug:'madrid',total:1,bloque:0}],bloques:[{archivo:'bloques/'+'a'.repeat(64)+'.json',bytes:2000,sha256:'a'.repeat(64),municipios:['28079']}]})
const catalog=()=>({schema:1,radioM:5000,muestra:12,consultado:'2026-11-21T11:00:00Z',fechaDatos:'2026-11-20T21:00:00Z',centros:{fuente:'AEMET maestro/municipios',generado:'2026-09-06T17:05:00.176Z',consultado:'2026-11-21T10:00:00Z',sha256:'a'.repeat(64)},fuente:{url:'https://www.openstreetmap.org/copyright',licencia:'ODbL-1.0',atribucion:'© OpenStreetMap contributors',indexSha256:'a'.repeat(64)},totalPuntos:1,totalCentros:2,conResultados:1,sinResultados:1,provincias:[{id:'28',archivo:'provincias/'+'a'.repeat(64)+'.json',bytes:2000,sha256:'a'.repeat(64),municipios:1}]})
describe('proximidad municipal sin atribuir límites administrativos',()=>{
  it('mantiene el municipio declarado y la fecha original aunque sean distintos del punto de referencia',()=>{
    const m=row();m.lugares[0].municipio='Municipio vecino'
    const v=validaResumenMunicipal(m,'28',now)
    expect(v.lugares[0].municipio).toBe('Municipio vecino')
    expect(v.lugares[0].fechaEdicion).toBe('2020-01-01T00:00:00Z')
    expect(v.lugares[0].distanciaM).toBe(100)
  })
  it('admite el borde de5km y rechaza un punto que lo sobrepasa',()=>{
    expect(validaResumenMunicipal(row(5000),'28',now).total).toBe(1)
    expect(()=>validaResumenMunicipal(row(5000.01),'28',now)).toThrow()
  })
  it('no acepta distancia redondeada inventada ni zona que no contiene al punto',()=>{
    const distance=row();distance.lugares[0].distanciaM=5
    expect(()=>validaResumenMunicipal(distance,'28',now)).toThrow()
    const zone=row();zone.lugares[0].zona='503-698'
    expect(()=>validaResumenMunicipal(zone,'28',now)).toThrow()
  })
  it('no confunde cero resultados con una ficha válida',()=>{
    expect(()=>validaResumenMunicipal({...row(),total:0,lugares:[],categorias:{}},'28',now)).toThrow()
  })
  it('rechaza el INE de otra provincia, coordenadas ausentes y categorías no verificadas',()=>{
    expect(()=>validaResumenMunicipal({...row(),ine:'08019'},'28',now)).toThrow()
    expect(()=>validaResumenMunicipal({...row(),centro:{lat:0,lon:0}},'28',now)).toThrow()
    expect(()=>validaResumenMunicipal({...row(),categorias:{inventado:1}},'28',now)).toThrow()
  })
  it('rechaza duplicados, muestras sin el recuento prometido y orden de distancia incorrecto',()=>{
    const a=row();a.total=2;a.categorias.bibliotecas=2;a.lugares.push(a.lugares[0])
    expect(()=>validaResumenMunicipal(a,'28',now)).toThrow()
    const b=row();b.total=2;b.categorias.bibliotecas=2
    expect(()=>validaResumenMunicipal(b,'28',now)).toThrow()
    const p=poi(50,'osm-node-124');b.lugares.push(fichaMunicipal(p,servicioTileId(p.lat,p.lon),50))
    expect(()=>validaResumenMunicipal(b,'28',now)).toThrow()
  })
  it('un resumen escaso no adquiere indexación por existir',()=>{
    expect(contenidoMunicipalSuficiente(row())).toBe(false)
  })
})
describe('índices acotados e integridad de la copia municipal',()=>{
  it('separa consulta, extracto original y catálogo de puntos sin rejuvenecer ninguno',()=>{
    const v=validaCatalogoMunicipal(catalog(),now)
    expect(v.fechaDatos).toBe('2026-11-20T21:00:00Z')
    expect(v.centros.generado).toBe('2026-09-06T17:05:00.176Z')
  })
  it('rechaza rutas arbitrarias y bloques que sobrepasan128KiB',()=>{
    const a=index();a.bloques[0].archivo='../snapshot.json'
    expect(()=>validaIndiceMunicipal(a,'28')).toThrow()
    const b=index();b.bloques[0].bytes=128*1024+1
    expect(()=>validaIndiceMunicipal(b,'28')).toThrow()
  })
  it('rechaza bloques e INE duplicados',()=>{
    const a=index();a.bloques.push(a.bloques[0])
    expect(()=>validaIndiceMunicipal(a,'28')).toThrow()
    const b=index();b.bloques.push({...b.bloques[0],archivo:'bloques/'+'b'.repeat(64)+'.json',sha256:'b'.repeat(64)})
    expect(()=>validaIndiceMunicipal(b,'28')).toThrow()
  })
  it('rechaza fecha imposible, fecha futura y extracto posterior a la consulta',()=>{
    expect(()=>validaCatalogoMunicipal({...catalog(),fechaDatos:'2026-02-30T00:00:00Z'},now)).toThrow()
    expect(()=>validaCatalogoMunicipal({...catalog(),fechaDatos:'2026-11-21T12:01:00Z'},now)).toThrow()
    expect(()=>validaCatalogoMunicipal({...catalog(),fechaDatos:'2026-11-21T11:01:00Z'},now)).toThrow()
  })
  it('conserva la fecha original de los puntos AEMET y no acepta una posterior a su consulta',()=>{
    const a=catalog(),centros={...a.centros,fechaDatos:'2026-08-01T00:00:00Z'}
    expect(validaCatalogoMunicipal({...a,centros},now).centros.fechaDatos).toBe('2026-08-01T00:00:00Z')
    expect(()=>validaCatalogoMunicipal({...a,centros:{...centros,fechaDatos:'2026-11-21T10:01:00Z'}},now)).toThrow()
    expect(()=>validaCatalogoMunicipal({...a,centros:{...centros,fechaDatos:'2026-02-30T00:00:00Z'}},now)).toThrow()
  })
})

describe('derivación y publicación acotada',()=>{
  const town={ine:'28079',nombre:'Madrid',slug:'madrid',provinciaNombre:'Madrid',provinciaSlug:'madrid',lat:centro.lat,lng:centro.lon}
  it('incluye sólo puntos dentro del radio y cuenta todas sus categorías una vez',()=>{
    const p=poi(100),q=poi(5001,'osm-node-124');p.categorias=['bibliotecas','centros-culturales'];p.municipio='Municipio vecino'
    const rows=resumeMunicipios([p,q].map(p=>({...p,zona:servicioTileId(p.lat,p.lon)})),[town])
    expect(rows[0].total).toBe(1)
    expect(rows[0].categorias).toEqual({bibliotecas:1,'centros-culturales':1})
    expect(rows[0].lugares[0].municipio).toBe('Municipio vecino')
    expect(resumeMunicipios([],[town])).toEqual([])
  })
  it('rechaza ID repetido aunque esté en dos tiles distintos',()=>{
    const p=poi(100)
    expect(()=>resumeMunicipios([{...p,zona:'1'},{...p,zona:'2'}],[town])).toThrow()
  })
  it('los conteos son completos aunque la muestra sólo presente12lugares',()=>{
    const points=Array.from({length:20},(_,n)=>{const p=poi(n+1,'osm-node-'+(100+n));return {...p,zona:servicioTileId(p.lat,p.lon)}})
    const [m]=resumeMunicipios(points,[town])
    expect(m.total).toBe(20);expect(m.lugares).toHaveLength(12);expect(m.categorias.bibliotecas).toBe(20)
    expect(m.lugares.at(-1)?.distanciaM).toBe(12)
  })
  it('cambia sólo artefactos propios y no publica la referencia si hay una colisión de integridad',async()=>{
    const root=await mkdtemp(join(tmpdir(),'eu-municipales-'))
    try{
      const packed=empaquetaMunicipios([row()]);const old={version:'anterior'}
      await writeFile(join(root,'index.json'),JSON.stringify(old))
      await mkdir(join(root,'bloques'))
      const [name]=[...packed.files.keys()].filter(n=>n.startsWith('bloques/'))
      await writeFile(join(root,name),'corrupto')
      await expect(publicaMunicipios(root,catalog(),packed.files)).rejects.toThrow('hash inconsistente')
      expect(JSON.parse(await readFile(join(root,'index.json'),'utf8'))).toEqual(old)
      await rm(join(root,name));await publicaMunicipios(root,catalog(),packed.files)
      expect(JSON.parse(await readFile(join(root,'index.json'),'utf8')).conResultados).toBe(1)
      await writeFile(join(root,'bloques','b'.repeat(64)+'.json'),'anterior')
      await writeFile(join(root,'bloques','nota.txt'),'conservar')
      await publicaMunicipios(root,catalog(),packed.files)
      expect(await readdir(join(root,'bloques'))).toContain('nota.txt')
      expect(await readdir(join(root,'bloques'))).not.toContain('b'.repeat(64)+'.json')
    }finally{await limpiaTemporal(root)}
  })
  it('lee el mismo archivo abierto y rechaza el tamaño antes de parsear',async()=>{
    const root=await mkdtemp(join(tmpdir(),'eu-municipales-size-'))
    try{const file=join(root,'data.json');await writeFile(file,'x'.repeat(20));await expect(leeArchivoAcotado(file,10)).rejects.toThrow();expect((await leeArchivoAcotado(file,20)).length).toBe(20)}finally{await limpiaTemporal(root)}
  })
})
