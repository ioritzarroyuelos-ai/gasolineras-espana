import {describe,it,expect} from 'vitest'
// @ts-expect-error Node sólo en las pruebas.
import {readFileSync} from 'node:fs'
// @ts-expect-error Node sólo en las pruebas.
import {createRequire} from 'node:module'
import {estadoMaestroMunicipal,estadoDerivacionMunicipal} from '../scripts/lib/servicios-municipales-estado.mjs'
// @ts-expect-error Lógica del coordinador Node sin declaración TypeScript.
import {DATA_JOBS,necesitaRecuperacion} from '../scripts/lib/data-recovery.mjs'
const yaml=createRequire(import.meta.url)('js-yaml')
const now=Date.parse('2026-11-21T12:00:00Z'),today='2026-11-21T11:00:00Z',old='2026-11-20T11:00:00Z'
const cat=(checked=old)=>({fuente:'AEMET maestro/municipios',consultado:checked,generado:'2026-09-06T00:00:00Z',total:7000,municipios:Array(7000).fill({})})
const state=(estado='actual',ultimoExito=today)=>({schema:1,estado,consultado:today,ultimoExito,fechaDatos:null,total:7000})
describe('estado honesto del catálogo y derivación',()=>{
  it('un fallo reciente no presenta la revisión anterior como comprobada hoy',()=>{
    const [s]=estadoMaestroMunicipal(state('conservada',old),cat(),now)
    expect(s.updatedAt).toBe(old);expect(s.issue).toContain('falló');expect(s.count).toBe(7000)
  })
  it('una consulta válida conserva una copia antigua sin llamar antigua a la consulta',()=>{
    const [s]=estadoMaestroMunicipal(state(),cat(today),now)
    expect(s.updatedAt).toBe(today);expect(s.issue).toBeUndefined()
  })
  it('rechaza el verde si el informe y el catálogo no coinciden',()=>{
    expect(estadoMaestroMunicipal(state(),cat(),now)[0].count).toBe(0)
    expect(estadoMaestroMunicipal(state('actual',old),cat(),now)[0].issue).toBeTruthy()
    expect(estadoMaestroMunicipal({...state(),fechaDatos:'2026-11-22T00:00:00Z'},cat(today),now)[0].issue).toBeTruthy()
  })
  it('una derivación ausente no es un directorio sin lugares',()=>{
    expect(estadoDerivacionMunicipal(null,now)[0]).toMatchObject({updatedAt:null,count:0,issue:'No hay un resumen de proximidad comprobable.'})
  })
})
describe('robots diarios separados',()=>{
  it.each([['municipios','08:07','gen-tiempo-municipios.yml'],['servicios-municipales','09:27','fetch-servicios-municipales.yml']])('programa %s y mantiene reintento sin multiplicarlo', (kind,time,workflow)=>{
    const j=DATA_JOBS.find((v:any)=>v.kind===kind)
    expect(j.scheduleUtc).toEqual([time]);expect(j.workflow||'fetch-'+j.kind+'.yml').toBe(workflow)
    const manifest={services:[{id:j.service,items:[{name:j.item,updatedAt:today,count:1}]}]}
    const recent=[{status:'completed',conclusion:'failure',run_started_at:new Date(now-3*3600000).toISOString()}]
    expect(necesitaRecuperacion(j,manifest,recent,now).retry).toBe(false)
    expect(necesitaRecuperacion(j,manifest,recent,now+3600000).retry).toBe(true)
  })
  it('publica el aviso de AEMET después de un fallo y mantiene el fallo final para el reloj',()=>{
    const wf=yaml.load(readFileSync('.github/workflows/gen-tiempo-municipios.yml','utf8')),steps=wf.jobs.gen.steps
    expect(steps.find((s:any)=>s.id==='maestro')['continue-on-error']).toBe(true)
    const publisher=steps.findIndex((s:any)=>s.run?.includes('publish-data.mjs municipios'))
    const failure=steps.findIndex((s:any)=>s.if==="steps.maestro.outcome != 'success'")
    expect(publisher).toBeLessThan(failure);expect(steps[publisher].run).toContain('municipios-estado.json');expect(steps[failure].run).toContain('exit 1')
    expect(wf.on.schedule).toBeUndefined()
  })
  it('el resumen sólo lee las copias y no se añade al robot de extracción OSM',()=>{
    const wf=yaml.load(readFileSync('.github/workflows/fetch-servicios-municipales.yml','utf8'))
    expect(wf.on.schedule).toBeUndefined();expect(wf.concurrency['cancel-in-progress']).toBe(false)
    expect(wf.jobs.fetch.steps.some((s:any)=>s.run==='node scripts/gen-servicios-municipales.mjs')).toBe(true)
    expect(readFileSync('.github/workflows/fetch-servicios.yml','utf8')).not.toContain('gen-servicios-municipales')
  })
})
