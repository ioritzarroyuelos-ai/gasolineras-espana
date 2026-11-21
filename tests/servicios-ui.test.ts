import {describe,it,expect} from 'vitest'
import {abiertoServicio,zonasServicios,distanciaServicio,enlacesServicio,biciServicioActual,plazoServicio,restanteServicio,vigenteServicio} from '../scripts/lib/servicios-ui.mjs'
const at=(value:string)=>Date.parse(value)

describe('caducidad anclada al servidor y al tiempo transcurrido',()=>{
  const checked='2026-11-21T12:00:00Z',expiry='2026-11-21T12:00:30Z',server=at(checked)
  it('un reloj atrasado no amplía el plazo de30s del servidor',()=>{
    const start=server-120000,p=plazoServicio(expiry,checked,start,200)!
    expect(restanteServicio(p,start+29999,30199)).toBe(1)
    expect(vigenteServicio(p,start+30000,30200)).toBe(false)
  })
  it('descuenta el tiempo en red y no regala30s desde la llegada',()=>{
    const start=server-120000,p=plazoServicio(expiry,checked,start,200)
    expect(restanteServicio(p,start+10000,10200)).toBe(20000)
    expect(restanteServicio(p,start+40000,40200)).toBe(0)
  })
  it('atrasar Date.now durante la visita no revive un estado caducado',()=>{
    const p=plazoServicio(expiry,checked,server,200)
    expect(vigenteServicio(p,server-3600000,30200)).toBe(false)
    expect(restanteServicio(p,server-3600000,30200)).toBe(0)
  })
  it('adelantar el reloj usa también el límite absoluto conservador',()=>{
    const p=plazoServicio(expiry,checked,server,200)
    expect(vigenteServicio(p,server+60000,201)).toBe(false)
  })
  it('la navegación SSR descuenta la llegada del documento y la ejecución del script',()=>{
    const origin=server-120000,p=plazoServicio(expiry,checked,origin,0)
    expect(restanteServicio(p,origin+5000,5000)).toBe(25000)
    expect(vigenteServicio(p,origin+35000,35000)).toBe(false)
  })
  it('fechas inexistentes, orden inverso o relojes inválidos fallan cerrados',()=>{
    expect(plazoServicio('',checked,server,0)).toBeNull()
    expect(plazoServicio(expiry,'',server,0)).toBeNull()
    expect(plazoServicio(checked,expiry,server,0)).toBeNull()
    expect(plazoServicio(expiry,checked,NaN,0)).toBeNull()
    expect(plazoServicio(expiry,checked,server,-1)).toBeNull()
    expect(vigenteServicio(null,server,0)).toBe(false)
    expect(vigenteServicio({absoluto:Infinity,monotono:Infinity},server,0)).toBe(false)
  })
})

it('retira disponibilidad de bicicletas exactamente al caducar cada estación',()=>{
  const updated='2026-11-21T00:00:00Z',expiry='2026-11-21T00:03:00Z'
  const item={actualizado:updated,caduca:expiry,estado:'operativa'}
  expect(biciServicioActual(item,at(expiry)-1)).toBe(true)
  expect(biciServicioActual(item,at(expiry))).toBe(false)
  expect(biciServicioActual({...item,caduca:'2026-11-21T00:30:00Z'},at(updated)+300000)).toBe(false)
  expect(biciServicioActual(item,at(updated)-1)).toBe(false)
  expect(biciServicioActual({...item,estado:'sin_actualizar'},at(updated))).toBe(false)
  expect(biciServicioActual(null)).toBe(false)
})
describe('horarios del directorio, sin convertir ambigüedad en apertura',()=>{
  it('respeta minutos, descansos y días de semana',()=>{
    const h='Mo-Fr 09:00-13:30,16:00-19:30; Sa 09:00-13:00; Su off'
    expect(abiertoServicio(h,40,-3,at('2026-11-20T08:00Z'))).toBe(true)
    expect(abiertoServicio(h,40,-3,at('2026-11-20T12:30Z'))).toBe(false)
    expect(abiertoServicio(h,40,-3,at('2026-11-20T15:00Z'))).toBe(true)
    expect(abiertoServicio(h,40,-3,at('2026-11-22T09:00Z'))).toBe(false)
  })
  it('distingue Canarias y cambio horario de verano',()=>{
    expect(abiertoServicio('09:00-10:00',40,-3,at('2026-11-20T08:30Z'))).toBe(true)
    expect(abiertoServicio('09:00-10:00',28,-15,at('2026-11-20T08:30Z'))).toBe(false)
    expect(abiertoServicio('09:00-10:00',40,-3,at('2026-07-20T07:30Z'))).toBe(true)
  })
  it('un turno nocturno sigue en su día siguiente y termina a su hora',()=>{
    expect(abiertoServicio('Fr 20:00-02:00',40,-3,at('2026-11-20T23:30Z'))).toBe(true)
    expect(abiertoServicio('Fr 20:00-02:00',40,-3,at('2026-11-21T01:00Z'))).toBe(false)
    expect(abiertoServicio('Su 20:00-02:00',40,-3,at('2026-11-22T23:30Z'))).toBe(true)
  })
  it.each(['','PH off','Mo-Fr 09:00-19:00; PH off','sunrise-sunset','by appointment','09:00+','09:00-09:00','25:00-26:00','10:75-12:00','24/7 "excepto citas"','Mo 08:00-18:00; Mo off','Fr 20:00-02:00; Sa off'])('conserva %s como desconocido',h=>expect(abiertoServicio(h,40,-3)).toBe(null))
  it('admite sólo 24/7 explícito y cierre explícito',()=>{
    expect(abiertoServicio('24/7',40,-3)).toBe(true)
    expect(abiertoServicio('closed',40,-3)).toBe(false)
    expect(abiertoServicio(undefined,40,-3)).toBe(null)
  })
})
describe('zonas y enlaces del mapa',()=>{
  it('limita una consulta nacional y acepta zonas vecinas sin punto GPS',()=>{
    expect(zonasServicios({south:27,north:44.5,west:-19,east:5})).toEqual([])
    expect(zonasServicios({south:40.4,north:40.45,west:-3.75,east:-3.65})).toEqual(['521-705'])
    expect(zonasServicios({south:NaN,north:41,west:-3,east:-2})).toEqual([])
  })
  it('calcula distancia en el cliente y sólo enlaza al destino público',()=>{
    expect(distanciaServicio({lat:40,lon:-3},{lat:40,lon:-3})).toBe(0)
    expect(distanciaServicio({lat:40,lon:-3},{lat:41,lon:-3})).toBeCloseTo(111.195,2)
    const links=enlacesServicio({lat:40,lon:-3})!
    expect(new URL(links.google).searchParams.get('destination')).toBe('40,-3')
    expect(new URL(links.google).searchParams.has('origin')).toBe(false)
    expect(new URL(links.apple).hostname).toBe('maps.apple.com')
    expect(new URL(links.waze).hostname).toBe('www.waze.com')
    expect(enlacesServicio({lat:0,lon:0})).toBeNull()
  })
})
