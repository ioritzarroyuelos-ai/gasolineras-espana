import { describe, it, expect, vi, afterEach } from 'vitest'
// Lib .mjs con tipos en scripts/lib/tiempo.d.mts (mismo patron que historico-estatico).
import {
  frescuraTiempo, TIEMPO_STALE_HORAS, normalizaAemet, normalizaOpenMeteo, resuelvePrediccion,
  maestroAMunicipios, construyeIndiceMunicipios, prediccionVigente, normalizaHorasOpenMeteo, resuelveHoras,
} from '../scripts/lib/tiempo.mjs'
import { PROVINCIAS_INE } from '../scripts/lib/provincias-ine.mjs'
import rawAemet from './fixtures/tiempo/aemet-diaria-28079.json'
import rawOM from './fixtures/tiempo/openmeteo-madrid.json'
import maestroSample from './fixtures/tiempo/aemet-maestro-sample.json'

const meta = { ine: '28079', nombre: 'Madrid', provincia: 'Madrid' }
const fechaFixture = Date.parse('2026-09-06T13:00:00Z')
afterEach(() => vi.unstubAllGlobals())

describe('frescuraTiempo', () => {
  const ahora = Date.parse('2026-09-06T12:00:00Z')
  it('es fiable si el dato tiene menos del umbral', () => {
    const fr = frescuraTiempo('2026-09-06T09:00:00Z', ahora)
    expect(fr.fiable).toBe(true)
    expect(fr.horas).toBeCloseTo(3, 1)
  })
  it('NO es fiable si supera el umbral', () => {
    expect(frescuraTiempo('2026-09-05T20:00:00Z', ahora).fiable).toBe(false)
  })
  it('NO es fiable si no hay fecha', () => {
    expect(frescuraTiempo(null, ahora).fiable).toBe(false)
    expect(frescuraTiempo(undefined, ahora).fiable).toBe(false)
  })
  it('interpreta la hora oficial de Madrid y rechaza fechas futuras', () => {
    expect(frescuraTiempo('2026-09-06T13:00:00', ahora).horas).toBeCloseTo(1)
    expect(frescuraTiempo('2026-09-07T13:00:00', ahora).fiable).toBe(false)
  })
  it('el umbral es 12 horas', () => {
    expect(TIEMPO_STALE_HORAS).toBe(12)
  })
})

describe('normalizaAemet (fixture real de Madrid)', () => {
  const p = normalizaAemet(rawAemet, meta)
  it('marca la fuente AEMET y trae 7 dias', () => {
    expect(p.fuente).toBe('AEMET')
    expect(p.dias.length).toBe(7)
  })
  it('extrae temperaturas del dia 0 (max 36 / min 24)', () => {
    expect(p.dias[0].tmax).toBe(36)
    expect(p.dias[0].tmin).toBe(24)
  })
  it('fecha, cielo, probLluvia y viento del dia 0', () => {
    expect(p.dias[0].fecha).toMatch(/^2026-09-06/)
    expect(p.dias[0].cielo).toBe('') // «Despejado» sólo describe aquella tarde.
    expect(p.dias[0].probLluvia).toBe(0)
    expect(typeof p.dias[0].viento).toBe('number')
  })
  it('conserva el elaborado', () => {
    expect(p.elaborado).toMatch(/^2026-09-06T13:37/)
  })
})

describe('normalizaOpenMeteo (fixture real de Madrid)', () => {
  const p = normalizaOpenMeteo(rawOM, meta)
  it('marca la fuente Open-Meteo y misma forma', () => {
    expect(p.fuente).toBe('Open-Meteo')
    expect(p.dias.length).toBe(7)
    expect(p.dias[0].tmax).toBe(35.3)
    expect(p.dias[0].tmin).toBe(23.5)
    expect(p.dias[0].probLluvia).toBe(3)
    expect(p.dias[0].viento).toBe(10.2)
    expect(typeof p.dias[0].cielo).toBe('string')
    expect(p.dias[0].cielo.length).toBeGreaterThan(0) // traducido del codigo WMO
  })
})

describe('num: ausencia de dato NO es 0 (integridad M1)', () => {
  it('null / "" / undefined -> null (no 0)', () => {
    const raw = { daily: { time: ['2026-09-06'], temperature_2m_max: [null], temperature_2m_min: [''], precipitation_probability_max: [undefined], weathercode: [0], wind_speed_10m_max: [10] } }
    const p = normalizaOpenMeteo(raw, meta)
    expect(p.dias[0].tmax).toBe(null)
    expect(p.dias[0].tmin).toBe(null)
    expect(p.dias[0].probLluvia).toBe(null)
    expect(p.dias[0].viento).toBe(10)
  })
  it('un 0 real se conserva (no se confunde con ausencia)', () => {
    const raw = { daily: { time: ['2026-09-06'], temperature_2m_max: [0], temperature_2m_min: [-2], precipitation_probability_max: [0], weathercode: [0], wind_speed_10m_max: [0] } }
    const p = normalizaOpenMeteo(raw, meta)
    expect(p.dias[0].tmax).toBe(0)
    expect(p.dias[0].tmin).toBe(-2)
    expect(p.dias[0].probLluvia).toBe(0)
  })
})

describe('resuelvePrediccion (fallback y auto-recuperacion)', () => {
  const muni = { ine: '28079', nombre: 'Madrid', provincia: 'Madrid', lat: 40.4, lng: -3.7 }
  it('usa AEMET cuando responde', async () => {
    const p = await resuelvePrediccion(muni, {
      ahora: fechaFixture,
      bajaAemet: async () => rawAemet,
      bajaOpenMeteo: async () => { throw new Error('no debe llamarse') },
    })
    expect(p.fuente).toBe('AEMET')
  })
  it('cae a Open-Meteo si AEMET falla', async () => {
    const p = await resuelvePrediccion(muni, {
      ahora: fechaFixture,
      bajaAemet: async () => { throw new Error('AEMET down') },
      bajaOpenMeteo: async () => rawOM,
    })
    expect(p.fuente).toBe('Open-Meteo')
  })
  it('cae a Open-Meteo si AEMET responde pero sin dias utiles', async () => {
    const p = await resuelvePrediccion(muni, {
      ahora: fechaFixture,
      bajaAemet: async () => [{ prediccion: { dia: [] } }],
      bajaOpenMeteo: async () => rawOM,
    })
    expect(p.fuente).toBe('Open-Meteo')
  })
  it('lanza si ambas fuentes fallan', async () => {
    await expect(resuelvePrediccion(muni, {
      bajaAemet: async () => { throw new Error('AEMET down') },
      bajaOpenMeteo: async () => { throw new Error('OM down') },
    })).rejects.toThrow()
  })
})

describe('fecha civil del municipio y periodos de lluvia', () => {
  const ahora = Date.parse('2026-11-06T23:30:00Z')
  const antiguo = {
    ...meta, fuente: 'AEMET' as const, elaborado: '2026-11-06T21:00:00Z',
    dias: ['2026-11-06','2026-11-07','2026-11-08'].map(fecha => ({
      fecha, cielo: 'Niebla', probLluvia: 90, tmin: 3, tmax: 12, viento: 0,
    })),
  }
  it('pasa al sábado en Madrid, mantiene el viernes en Canarias y retira porcentajes sin periodo de copias antiguas', () => {
    expect(prediccionVigente(antiguo, ahora)?.dias.map(d => d.fecha)).toEqual(['2026-11-07','2026-11-08'])
    const canarias = prediccionVigente({...antiguo, ine:'35004'}, ahora)
    expect(canarias?.dias[0]).toMatchObject({fecha:'2026-11-06', tmax:12, cielo:'', probLluvia:null})
    expect(prediccionVigente({...antiguo, elaborado:''}, ahora)).toBeNull()
  })

  it('acepta 0% diario, pero no presenta una franja como día entero', () => {
    const dias = normalizaAemet({prediccion:{dia:[
      {probPrecipitacion:[{periodo:'00-24',value:''},{periodo:'18-24',value:90}]},
      {probPrecipitacion:[{periodo:'00-24',value:0},{periodo:'18-24',value:10}]},
      {probPrecipitacion:[{value:65}]},
    ]}}, meta).dias
    expect(dias.map(d => d.probLluvia)).toEqual([null,0,65])
  })

  it('descarta un parte antiguo de AEMET y pide el respaldo con el huso canario', async () => {
    const muni = { ...meta, ine:'35004', lat:29, lng:-13.5 }
    const respaldo = vi.fn(async () => ({daily:{time:['2026-11-06'],temperature_2m_max:[18]}}))
    const parte = await resuelvePrediccion(muni, { ahora, bajaAemet:async () => [{...rawAemet[0], id:35004}], bajaOpenMeteo:respaldo })
    expect(respaldo).toHaveBeenCalledWith(29, -13.5, 'Atlantic/Canary')
    expect(parte).toMatchObject({fuente:'Open-Meteo', elaborado:'', consultado:'2026-11-06T23:30:00.000Z'})
  })

  it('no consulta un respaldo en coordenadas por defecto si falta la posición exacta', async () => {
    const pedir = vi.fn()
    vi.stubGlobal('fetch', pedir)
    await expect(resuelvePrediccion({...meta,lat:0,lng:0}, {bajaAemet:async () => []})).rejects.toThrow('coordenadas')
    expect(pedir).not.toHaveBeenCalled()
  })

  it('respeta la hora final del tramo de Open-Meteo y la fecha local de los dos lados de medianoche', () => {
    const parte = normalizaHorasOpenMeteo({hourly:{
      time:[Date.parse('2026-11-07T00:00:00Z')/1000], temperature_2m:[0],
      wind_speed_10m:[7],precipitation_probability:[0],weather_code:[0],
    }}, '35004', ahora)
    expect(parte.horas[0]).toMatchObject({fechaHora:'2026-11-07T00:00',temperatura:0,viento:7,cielo:'Despejado'})
    expect(parte.lluvia).toEqual([{desde:'2026-11-06T23:00',hasta:'2026-11-07T00:00',probabilidad:0}])
  })

  it('lee sólo la localidad oficial y conserva las franjas hexahorarias de AEMET al cruzar medianoche', async () => {
    const muni = { ...meta, ine:'48027', lat:43.17, lng:-2.63 }
    const xml = '<root id="48027"><prediccion><dia fecha="2026-11-06"><prob_precipitacion periodo="1901">0</prob_precipitacion></dia>'
      + '<dia fecha="2026-11-07"><estado_cielo periodo="00" descripcion="Cubierto">16</estado_cielo>'
      + '<temperatura periodo="00">6</temperatura><viento periodo="00"><velocidad>4</velocidad></viento>'
      + '<prob_precipitacion periodo="0107">5</prob_precipitacion></dia></prediccion></root>'
    const responder = (cuerpo:string) => new Response(cuerpo,{headers:{'Last-Modified':'Fri, 06 Nov 2026 21:00:39 GMT'}})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(responder(xml)).mockResolvedValueOnce(responder(xml.replace('48027','48000'))))
    const respaldo = vi.fn(async () => {throw new Error('Sin respaldo')})
    const parte = await resuelveHoras(muni, {ahora,horasOpenMeteo:respaldo})
    expect(parte.horas).toEqual([{fechaHora:'2026-11-07T00:00',temperatura:6,viento:4,cielo:'Cubierto'}])
    expect(parte.lluvia).toEqual([{desde:'2026-11-06T19:00',hasta:'2026-11-07T01:00',probabilidad:0},
      {desde:'2026-11-07T01:00',hasta:'2026-11-07T07:00',probabilidad:5}])
    expect(respaldo).not.toHaveBeenCalled()
    await expect(resuelveHoras(muni, {ahora,horasOpenMeteo:respaldo})).rejects.toThrow('Sin respaldo')
  })
})

describe('maestroAMunicipios (muestra real del maestro AEMET)', () => {
  const munis = maestroAMunicipios(maestroSample, PROVINCIAS_INE)

  it('convierte cada entrada del maestro', () => {
    expect(munis.length).toBe(maestroSample.length)
  })
  it('mapea código, provincia, slug y coordenadas (Ababuj, Teruel)', () => {
    const ababuj = munis.find(m => m.ine === '44001')
    expect(ababuj).toBeTruthy()
    expect(ababuj!.provinciaId).toBe('44')
    expect(ababuj!.provinciaSlug).toBe('teruel')
    expect(ababuj!.slug).toBe('ababuj')
    expect(ababuj!.lat).toBeCloseTo(40.548, 2)
    expect(ababuj!.lng).toBeCloseTo(-0.808, 2)
    expect(ababuj!.pob).toBe(65)
    expect(ababuj!.imp).toBe(false) // pueblo pequeño
  })
  it('construyeIndiceMunicipios da {n,p,u} con la URL /tiempo/<prov>/<mun>', () => {
    const idx = construyeIndiceMunicipios(munis)
    const ab = idx.find(x => x.u === '/tiempo/teruel/ababuj')
    expect(ab).toBeTruthy()
    expect(ab!.n).toBe('Ababuj')
    expect(ab!.p).toBe('Teruel')
  })
  it('marca importante (imp) por poblacion >= 50.000, no por destacada', () => {
    const grande = maestroAMunicipios(
      [{ id: 'id28079', nombre: 'Madrid', latitud_dec: '40.4', longitud_dec: '-3.7', num_hab: '3300000', destacada: '0' }],
      PROVINCIAS_INE)
    expect(grande[0].imp).toBe(true)
    const peque = maestroAMunicipios(
      [{ id: 'id44001', nombre: 'Ababuj', latitud_dec: '40.5', longitud_dec: '-0.8', num_hab: '65', destacada: '1' }],
      PROVINCIAS_INE)
    expect(peque[0].imp).toBe(false)  // destacada ya no cuenta
  })
})
