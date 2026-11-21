import { describe, expect, it } from 'vitest'
// @ts-expect-error Política interna del robot Node.
import { DATA_JOBS, necesitaRecuperacion } from '../scripts/lib/data-recovery.mjs'
const now = Date.parse('2026-11-10T16:00:00Z')
const job = DATA_JOBS.find((j: {kind:string}) => j.kind === 'guardias')
const manifest = (date = '2026-11-10T12:00:00Z') => ({services:[{id:'farmacias',items:[{name:'Palencia',updatedAt:date}]}]})
const run = (status='completed', conclusion='success', createdAt='2026-11-10T10:00:00Z') => ({status,conclusion,createdAt})
describe('recuperación diaria basada en producción', () => {
  it('no confunde un robot verde con todas las provincias actualizadas', () => {
    expect(necesitaRecuperacion(job, manifest('2026-11-08T12:00:00Z'), [run()], now).retry).toBe(true)
  })
  it('recupera fallos y horarios perdidos', () => {
    expect(necesitaRecuperacion(job, manifest(), [run('completed','failure')], now).retry).toBe(true)
    expect(necesitaRecuperacion(job, manifest(), [], now).retry).toBe(true)
  })
  it('no duplica trabajos ni insiste sobre una fuente recién consultada', () => {
    expect(necesitaRecuperacion(job, manifest(), [run('queued')], now).retry).toBe(false)
    expect(necesitaRecuperacion(job, manifest('2026-11-08T12:00:00Z'), [run('completed','failure','2026-11-10T15:00:00Z')], now).retry).toBe(false)
    expect(necesitaRecuperacion(job, manifest(), [run()], now).retry).toBe(false)
  })
  it('la frescura de recarga no se oculta detrás de la de gasolina', () => {
    const electric = DATA_JOBS.find((j: {kind:string}) => j.kind === 'chargers')
    const m = {services:[{id:'gasolineras',items:[{name:'Precios del Ministerio',updatedAt:'2026-11-10T15:00:00Z'},{name:'Directorio de recarga eléctrica',updatedAt:'2026-11-07T12:00:00Z'}]}]}
    expect(necesitaRecuperacion(electric,m,[run()],now).retry).toBe(true)
  })
})

describe('cadencia única entre dos relojes',()=>{
  const lookup=(kind:string)=>DATA_JOBS.find((j:{kind:string})=>j.kind===kind)
  const freshManifest=(j:any,at=now)=>({services:[{id:j.service,items:[{name:j.item||'fuente',updatedAt:new Date(at).toISOString()}]}]})
  const completed=(hours:number,conclusion='success')=>({status:'completed',conclusion,event:'workflow_dispatch',run_started_at:new Date(now-hours*3600000).toISOString()})
  it.each(['queued','in_progress','waiting','pending','requested'])('no despacha si existe un trabajo %s, aunque sea antiguo',status=>{
    const j=lookup('deportes')
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(2),{status,created_at:'2026-01-01T00:00:00Z'}],now).retry).toBe(false)
  })
  it.each([['tiempo',3],['deportes',1]])('respeta %s cada%s horas',(kind,hours)=>{
    const j=lookup(String(kind)),h=Number(hours)
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(h-0.02)],now).retry).toBe(false)
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(h)],now).retry).toBe(true)
  })
  it.each([['prices','07:00'],['prices','19:00'],['chargers','05:15'],['guardias','05:45'],['itv','04:17'],['politica','04:20'],['servicios','08:17'],['transporte','08:47'],['servicios-publicos','08:57']])('respeta el horario UTC de %s a las %s',(kind,time)=>{
    const j=lookup(kind),t=Date.parse('2026-11-21T'+time+':00Z'),last={status:'completed',conclusion:'success',event:'workflow_dispatch',run_started_at:'2026-11-20T21:00:00Z'}
    if(kind==='prices' && time==='19:00')last.run_started_at='2026-11-21T08:00:00Z'
    expect(necesitaRecuperacion(j,freshManifest(j,t),[last],t-1).retry).toBe(false)
    expect(necesitaRecuperacion(j,freshManifest(j,t),[last],t).retry).toBe(true)
    expect(necesitaRecuperacion(j,freshManifest(j,t),[{...last,run_started_at:new Date(t).toISOString()}],t+15000).retry).toBe(false)
  })
  it('la guardia manual del20nov a21UTC no aplaza la consulta del21nov a05:45UTC',()=>{
    const j=lookup('guardias'),t=Date.parse('2026-11-21T05:45:00Z'),r={status:'completed',conclusion:'success',event:'workflow_dispatch',run_started_at:'2026-11-20T21:00:00Z'}
    expect(necesitaRecuperacion(j,freshManifest(j,t),[r],t).retry).toBe(true)
    expect(necesitaRecuperacion(j,freshManifest(j,t),[r],Date.parse('2026-11-21T00:02:00Z')).retry).toBe(false)
  })
  it('un horario diario vencido respeta4h estrictas después de un fallo',()=>{
    const j=lookup('guardias'),r={status:'completed',conclusion:'failure',event:'workflow_dispatch',run_started_at:'2026-11-21T03:00:00Z'},t=Date.parse('2026-11-21T05:47:00Z')
    expect(necesitaRecuperacion(j,freshManifest(j,t),[r],t).retry).toBe(false)
    expect(necesitaRecuperacion(j,freshManifest(j,t),[r],Date.parse('2026-11-21T07:00:00Z')).retry).toBe(true)
  })
  it('cuenta desde inicio efectivo, sin sumar duración ni horas en cola',()=>{
    const j=lookup('deportes'),r={...completed(1),created_at:new Date(now-6*3600000).toISOString(),updated_at:new Date(now-20*60000).toISOString()}
    expect(necesitaRecuperacion(j,freshManifest(j),[r],now).retry).toBe(true)
    expect(necesitaRecuperacion(j,freshManifest(j),[{...r,run_started_at:new Date(now-30*60000).toISOString()}],now).retry).toBe(false)
  })
  it.each(['prices','chargers','guardias','tiempo','itv','politica','servicios','transporte','servicios-publicos'])('limita reintentos de %s a4h',kind=>{
    const j=lookup(kind)
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(3.99,'failure')],now).retry).toBe(false)
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(4,'failure')],now).retry).toBe(true)
  })
  it('mantiene deportes horario aun con una fuente pendiente',()=>{
    const j=lookup('deportes')
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(1,'failure')],now).retry).toBe(true)
  })
  it('el vigilante de precios y los trabajos omitidos no aplazan descargas',()=>{
    const j=lookup('prices')
    expect(necesitaRecuperacion(j,freshManifest(j),[{...completed(0.1),event:'schedule'},completed(12)],now).retry).toBe(true)
    expect(necesitaRecuperacion(j,freshManifest(j),[completed(0.1,'skipped'),completed(12)],now).retry).toBe(true)
  })
  it('un pulso duplicado ve el trabajo solicitado y no vuelve a lanzarlo',()=>{
    const j=lookup('tiempo'),m=freshManifest(j),runs=[completed(4)]
    expect(necesitaRecuperacion(j,m,runs,now).retry).toBe(true)
    expect(necesitaRecuperacion(j,m,[{status:'queued'},...runs],now).retry).toBe(false)
  })
  it('no convierte fechas incomprobables en una descarga sin límite',()=>{
    const j=lookup('guardias')
    expect(necesitaRecuperacion(j,freshManifest(j),[{status:'completed',conclusion:'success',run_started_at:'bad'}],now).retry).toBe(false)
  })
  it('96pulsos diarios no multiplican los robots de datos',()=>{
    const counts:Record<string,number>={}
    const midnight=Date.parse('2026-11-21T00:02:00Z')
    for(const j of DATA_JOBS.filter((j:any)=>!j.scheduleLocal)){let runs:any[]=[{status:'completed',conclusion:'success',event:'workflow_dispatch',run_started_at:new Date(j.scheduleUtc?midnight-4*3600000:midnight-j.intervalHours*3600000).toISOString()}];counts[j.kind]=0
      for(let n=0;n<96;n++){const t=midnight+n*15*60000
        if(necesitaRecuperacion(j,freshManifest(j,t),runs,t).retry){counts[j.kind]++;runs=[{status:'completed',conclusion:'success',event:'workflow_dispatch',run_started_at:new Date(t).toISOString()}]}
      }
    }
    expect(counts).toEqual({prices:2,chargers:1,guardias:1,tiempo:8,itv:1,politica:1,deportes:24,servicios:1,transporte:1,'servicios-publicos':1})
  })
  it('mantiene24pasadas deportivas con colas20min y jitter de±15s',()=>{
    const j=lookup('deportes');let previous:any,count=0
    for(let n=0;n<96;n++){
      const jitter=[-15000,5000,15000,-5000][n%4],t=now+n*15*60000+jitter
      const runs=previous?[{...previous,status:t<Date.parse(previous.run_started_at)+20*60000?'in_progress':'completed'}]:[]
      if(necesitaRecuperacion(j,freshManifest(j,t),runs,t).retry){count++;previous={status:'completed',conclusion:'success',event:'workflow_dispatch',run_started_at:new Date(t+15000).toISOString()}}
    }
    expect(count).toBe(24)
  })
  it('admite09:17:04 tras08:17:05 pero nunca dos pasadas en59min',()=>{
    const j=lookup('deportes'),t=Date.parse('2026-11-20T09:17:04Z'),r={status:'completed',conclusion:'success',run_started_at:'2026-11-20T08:17:05Z'}
    expect(necesitaRecuperacion(j,freshManifest(j,t),[r],t).retry).toBe(true)
    expect(necesitaRecuperacion(j,freshManifest(j,t),[r],Date.parse('2026-11-20T09:16:04Z')).retry).toBe(false)
  })
})

describe('resumen de Telegram diario con cambio de hora',()=>{
  const telegram=DATA_JOBS.find((j:{kind:string})=>j.kind==='telegram')
  const normal=(at:string,conclusion='success',title='Telegram · resumen diario')=>({status:'completed',conclusion,display_title:title,run_started_at:at})
  it.each([['2026-11-21T06:59:59Z',false],['2026-11-21T07:00:00Z',true],['2026-11-21T10:59:59Z',true],['2026-11-21T11:00:00Z',false],['2026-07-21T05:59:59Z',false],['2026-07-21T06:00:00Z',true],['2026-07-21T10:00:00Z',false]])('la ventana de Madrid en %s es %s',(at,due)=>{
    expect(necesitaRecuperacion(telegram,{},[],Date.parse(String(at))).retry).toBe(due)
  })
  it('una comprobación sin envío o un envío de ayer no cubren hoy',()=>{
    const t=Date.parse('2026-11-21T09:00:00Z')
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-21T08:00:00Z','success','Telegram · comprobación sin envío')],t).retry).toBe(true)
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-20T08:00:00Z')],t).retry).toBe(true)
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-21T06:00:00Z')],t).retry).toBe(true)
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-21T08:00:00Z')],t).retry).toBe(false)
  })
  it('no duplica pendientes y limita los reintentos dentro de la ventana',()=>{
    const t=Date.parse('2026-11-21T09:00:00Z')
    expect(necesitaRecuperacion(telegram,{},[{status:'queued'}],t).retry).toBe(false)
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-21T08:01:00Z','failure')],t).retry).toBe(false)
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-21T08:00:00Z','failure')],t).retry).toBe(true)
    expect(necesitaRecuperacion(telegram,{},[normal('2026-11-21T08:00:00Z','failure')],Date.parse('2026-11-21T11:00:00Z')).retry).toBe(false)
  })
  it('96 pulsos despachan una sola entrega diaria, incluyendo los días de cambio de hora',()=>{
    for(const day of ['2026-03-29','2026-10-25','2026-11-21']) {
      const start=Date.parse(day+'T00:00:00Z');let runs:any[]=[],count=0
      for(let n=0;n<96;n++){const at=start+n*15*60000;if(necesitaRecuperacion(telegram,{},runs,at).retry){count++;runs=[normal(new Date(at).toISOString())]}}
      expect(count).toBe(1)
    }
  })
})
