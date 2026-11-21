import {afterEach,describe,expect,it} from 'vitest'
// @ts-expect-error Las pruebas usan Node; la aplicación conserva tipos de Workers.
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,existsSync,rmSync} from 'node:fs'
// @ts-expect-error Las pruebas usan Node; la aplicación conserva tipos de Workers.
import {tmpdir} from 'node:os'
// @ts-expect-error Las pruebas usan Node; la aplicación conserva tipos de Workers.
import {resolve,sep} from 'node:path'
// @ts-expect-error Las pruebas usan Node; la aplicación conserva tipos de Workers.
import {createHash} from 'node:crypto'
import {construyePreciosComparacion,validaIndicePreciosComparacion,validaBloquePreciosComparacion,cuboPrecio} from '../scripts/lib/precios-comparacion.mjs'
import {leeComparacionPrevia,guardaComparacionPrecios} from '../scripts/lib/precios-comparacion-disco.mjs'
import workflow from '../.github/workflows/fetch-prices.yml?raw'

const date = '21/11/2026 09:00:05', now = new Date('2026-11-21T08:10:00.000Z')
const beforeDate = '20/11/2026 21:00:05', beforeNow = new Date('2026-11-20T20:10:00.000Z')
const station = (id='100',price='1,500') => ({IDEESS:id,'Rótulo':'Estación de prueba',Municipio:'Madrid','Precio Gasolina 95 E5':price,'Precio Gasolina 98 E5':'1,600','Precio Gasoleo A':'1,400','Precio Gasoleo Premium':''})
const snapshot = (Fecha=date,rows=[station()]) => ({Fecha,ListaEESSPrecio:rows})
const previous = () => construyePreciosComparacion(snapshot(beforeDate,[station('100','1,520')]),{now:beforeNow})
const filas = (r:Awaited<ReturnType<typeof previous>>) => r.bloques.flatMap(b=>b.filas)
const folders:string[]=[]
function temp() {const path=mkdtempSync(resolve(tmpdir(),'eu-precios-test-'));folders.push(path);return path}
afterEach(()=>{for(const path of folders.splice(0)){const absolute=resolve(path);if(!absolute.startsWith(resolve(tmpdir())+sep)||!absolute.includes('eu-precios-test-'))throw Error('Unsafe test cleanup');rmSync(absolute,{recursive:true,force:true})}})

describe('capturas por gasolinera para avisos de precios',()=>{
  it('crea32bloques completos sin inventar un precio anterior',async()=>{
    const result=await construyePreciosComparacion(snapshot(),{now})
    expect(result.bloques).toHaveLength(32);expect(result.artifacts).toHaveLength(32)
    expect(validaIndicePreciosComparacion(result.index,now.getTime())).toBe(true)
    expect(result.index.actual.fechaFuente).toBe('2026-11-21T08:00:05.000Z')
    expect(result.index.anterior).toBeNull();expect(filas(result)[0]).toEqual(['100','Estación de prueba','Madrid',[1500,1600,1400,null],[null,null,null,null]])
    for(const block of result.bloques)expect(validaBloquePreciosComparacion(block,result.index,block.bucket)).toBe(true)
    for(const artifact of result.artifacts){const descriptor=result.index.shards[artifact.archivo.slice(-7,-5)];expect(new TextEncoder().encode(artifact.content).byteLength).toBe(descriptor.bytes);expect(createHash('sha256').update(artifact.content).digest('hex')).toBe(descriptor.sha256)}
  })
  it('compara sólo la misma estación y combustible conservando ambas fechas',async()=>{
    const first=await previous(),result=await construyePreciosComparacion(snapshot(date,[station(),station('101','1,200')]),{now,previousBundle:first})
    expect(result.index.anterior).toEqual(first.index.actual)
    expect(filas(result).find(r=>r[0]==='100')?.[4]).toEqual([1520,1600,1400,null])
    expect(filas(result).find(r=>r[0]==='101')?.[4]).toEqual([null,null,null,null])
    expect(filas(result)[0][4][0]! - filas(result)[0][3][0]!).toBe(20)
  })
  it('arranca con la foto general anterior sólo si su metadata coincide',async()=>{
    const old=snapshot(beforeDate,[station('100','1,600')]),meta={ministryDate:beforeDate,fetchedAt:beforeNow.toISOString()}
    const result=await construyePreciosComparacion(snapshot(),{now,previousSnapshot:old,previousMeta:meta})
    expect(filas(result)[0][4][0]).toBe(1600)
    expect((await construyePreciosComparacion(snapshot(),{now,previousSnapshot:old,previousMeta:{...meta,ministryDate:date}})).index.anterior).toBeNull()
  })
  it('repetir la misma foto conserva fecha de consulta, referencia y versión',async()=>{
    const first=await previous(),second=await construyePreciosComparacion(snapshot(),{now,previousBundle:first})
    const retry=await construyePreciosComparacion(snapshot(),{now:new Date(now.getTime()+3600000),previousBundle:second})
    expect(retry.index.snapshotId).toBe(second.index.snapshotId)
    expect(retry.index.actual).toEqual(second.index.actual);expect(retry.index.anterior).toEqual(first.index.actual)
    expect(retry.index.consultado).not.toBe(retry.index.actual.consultado)
    expect(retry.artifacts).toEqual(second.artifacts)
  })
  it('rechaza cambios de precios con la misma fecha oficial y retrocesos',async()=>{
    const first=await construyePreciosComparacion(snapshot(),{now})
    await expect(construyePreciosComparacion(snapshot(date,[station('100','1,100')]),{now,previousBundle:first})).rejects.toThrow(/misma fecha/)
    await expect(construyePreciosComparacion(snapshot(beforeDate),{now,previousBundle:first})).rejects.toThrow(/anterior/)
  })
  it.each(['31/11/2026 09:00:05','21/11/2026 10:00:05','19/11/2026 09:00:05'])('no publica fechas imposibles, futuras o antiguas: %s',async Fecha=>{
    await expect(construyePreciosComparacion(snapshot(Fecha),{now})).rejects.toThrow(/fecha/)
  })
  it('no rejuvenece una referencia antigua ni usa la fecha de descarga como fecha de precios',async()=>{
    const old=snapshot('19/11/2026 09:00:05'),meta={ministryDate:old.Fecha,fetchedAt:now.toISOString()}
    expect((await construyePreciosComparacion(snapshot(),{now,previousSnapshot:old,previousMeta:meta})).index.anterior).toBeNull()
  })
  it('rechaza identificadores duplicados aunque lleven ceros iniciales',async()=>{
    await expect(construyePreciosComparacion(snapshot(date,[station('100'),station('0100')]),{now})).rejects.toThrow(/repetido/)
    await expect(construyePreciosComparacion(snapshot(date,[station('abc')]),{now})).rejects.toThrow(/Identificador/)
  })
  it('precios ausentes, negativos o mal escritos permanecen desconocidos',async()=>{
    const s=station();Object.assign(s,{'Precio Gasolina 95 E5':'0','Precio Gasolina 98 E5':'-1,100','Precio Gasoleo A':'no disponible','Precio Gasoleo Premium':'1,2345'})
    const result=await construyePreciosComparacion(snapshot(date,[s]),{now});expect(filas(result)[0][3]).toEqual([null,null,null,null])
  })
  it('no acepta tipo numérico deID, bloques mezclados o referencias inventadas',async()=>{
    const result=await construyePreciosComparacion(snapshot(),{now}),bucket=cuboPrecio('100'),block=result.bloques.find(b=>b.bucket===bucket)!
    const bad=structuredClone(block) as any;bad.filas[0][0]=100;expect(validaBloquePreciosComparacion(bad,result.index,bucket)).toBe(false)
    bad.filas[0][0]='100';bad.filas[0][4][0]=999;expect(validaBloquePreciosComparacion(bad,result.index,bucket)).toBe(false)
    expect(validaBloquePreciosComparacion({...block,snapshotId:'f'.repeat(64)},result.index,bucket)).toBe(false)
  })
  it('rechaza rutas externas o escapadas y caducidad aunque se cambie consultado',async()=>{
    const result=await construyePreciosComparacion(snapshot(),{now}),index=structuredClone(result.index)
    index.shards['00'].archivo='../stations.json';expect(validaIndicePreciosComparacion(index,now.getTime())).toBe(false)
    index.shards['00'].archivo='https://example.test/a';expect(validaIndicePreciosComparacion(index,now.getTime())).toBe(false)
    const old=structuredClone(result.index);old.consultado='2026-11-23T08:10:00.000Z';expect(validaIndicePreciosComparacion(old,Date.parse(old.consultado))).toBe(false)
  })
  it('publica el índice al final, detecta corrupción y conserva el índice válido ante un plan incompleto',async()=>{
    const dir=temp(),result=await construyePreciosComparacion(snapshot(),{now})
    expect(leeComparacionPrevia(dir)).toBeNull();guardaComparacionPrecios(dir,result)
    expect(leeComparacionPrevia(dir)).toEqual({index:result.index,bloques:result.bloques})
    const original=readFileSync(resolve(dir,'index.json'),'utf8')
    expect(()=>guardaComparacionPrecios(dir,{...result,artifacts:result.artifacts.slice(1)})).toThrow(/incompleta/)
    expect(readFileSync(resolve(dir,'index.json'),'utf8')).toBe(original)
    writeFileSync(resolve(dir,result.artifacts[0].archivo),'corrupto')
    expect(()=>leeComparacionPrevia(dir)).toThrow(/inválido|integridad/)
  })
  it('mantiene dos versiones, sin borrar carpetas ajenas ni archivos inesperados',async()=>{
    const dir=temp(),a=await previous();guardaComparacionPrecios(dir,a)
    const b=await construyePreciosComparacion(snapshot(),{now,previousBundle:a});guardaComparacionPrecios(dir,b,a.index.snapshotId)
    const unrelated=resolve(dir,'guardar');mkdirSync(unrelated);writeFileSync(resolve(unrelated,'nota.txt'),'conservar')
    const foreign=resolve(dir,'f'.repeat(64));mkdirSync(foreign);writeFileSync(resolve(foreign,'nota.txt'),'conservar')
    const c=await construyePreciosComparacion(snapshot('21/11/2026 21:00:05',[station('100','1,490')]),{now:new Date('2026-11-21T20:10:00.000Z'),previousBundle:b})
    guardaComparacionPrecios(dir,c,b.index.snapshotId)
    expect(existsSync(resolve(dir,a.index.snapshotId))).toBe(false);expect(existsSync(resolve(dir,b.index.snapshotId))).toBe(true)
    expect(readFileSync(resolve(unrelated,'nota.txt'),'utf8')).toBe('conservar');expect(readFileSync(resolve(foreign,'nota.txt'),'utf8')).toBe('conservar')
  })
  it('incluye todos los bloques en la misma publicación automática de precios',()=>{
    expect(workflow.split('\n').find(line=>line.trim().startsWith('git add '))).toContain('public/data/precios-comparacion')
  })
})
