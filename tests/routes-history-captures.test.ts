import {describe,it,expect,vi,afterEach} from 'vitest'
import type {Hono} from 'hono'
afterEach(()=>vi.useRealTimers())
describe('histórico servido con días sin descarga',()=>{
  it('publica los huecos reales y no prolonga el último precio hasta hoy',async()=>{
    vi.useFakeTimers().setSystemTime(new Date('2026-11-11T12:00:00Z'))
    vi.resetModules()
    const app=(await import('../src/index')).default as unknown as Hono<{Bindings:Record<string,unknown>}>
    const assets={fetch:async(req:Request)=>{
      const path=new URL(req.url).pathname
      const data = path.endsWith('/stations.json') ? {ListaEESSPrecio:[{IDEESS:'12345',IDProvincia:'28'}]}
        : path.endsWith('/history/28.json') ? {from:'2026-11-08',to:'2026-11-10',stations:{'12345':{'95':[['2026-11-08',1500]]}}}
        : path.endsWith('/history/median/28.json') ? {median:{'95':[['2026-11-08',1500],['2026-11-10',1500]]}} : null
      return data?Response.json(data):new Response(null,{status:404})
    }}
    const response=await app.request('/api/history/12345?days=7',{}, {ASSETS:assets})
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({series:{'95':[{date:'2026-11-08',price:1.5},{date:'2026-11-10',price:1.5}]},missing_dates:{'95':['2026-11-09','2026-11-11']}})
    const bind=vi.fn(()=>({all:async()=>({results:[{fuel_code:'95',date:'2026-11-09',price_cents:1600}]})}))
    const withDb=await app.request('/api/history/12345?days=7',{}, {ASSETS:assets,DB:{prepare:()=>({bind})}})
    expect(bind).toHaveBeenCalledWith('12345','2026-11-09')
    expect(await withDb.json()).toMatchObject({series:{'95':[{date:'2026-11-08',price:1.5},{date:'2026-11-09',price:1.6},{date:'2026-11-10',price:1.5}]},missing_dates:{'95':['2026-11-11']}})
  })
})
