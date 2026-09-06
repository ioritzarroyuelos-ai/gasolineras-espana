import { describe, it, expect } from 'vitest'
// Lib .mjs con tipos en scripts/lib/tiempo.d.mts (mismo patron que historico-estatico).
import {
  frescuraTiempo, TIEMPO_STALE_HORAS, normalizaAemet, normalizaOpenMeteo, resuelvePrediccion,
  maestroAMunicipios, construyeIndiceMunicipios,
} from '../scripts/lib/tiempo.mjs'
import { PROVINCIAS_INE } from '../scripts/lib/provincias-ine.mjs'
import rawAemet from './fixtures/tiempo/aemet-diaria-28079.json'
import rawOM from './fixtures/tiempo/openmeteo-madrid.json'
import maestroSample from './fixtures/tiempo/aemet-maestro-sample.json'

const meta = { ine: '28079', nombre: 'Madrid', provincia: 'Madrid' }

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
    expect(typeof p.dias[0].cielo).toBe('string')
    expect(p.dias[0].cielo.length).toBeGreaterThan(0) // "Despejado" etc.
    expect(typeof p.dias[0].probLluvia).toBe('number')
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

describe('resuelvePrediccion (fallback y auto-recuperacion)', () => {
  const muni = { ine: '28079', nombre: 'Madrid', provincia: 'Madrid', lat: 40.4, lng: -3.7 }
  it('usa AEMET cuando responde', async () => {
    const p = await resuelvePrediccion(muni, {
      bajaAemet: async () => rawAemet,
      bajaOpenMeteo: async () => { throw new Error('no debe llamarse') },
    })
    expect(p.fuente).toBe('AEMET')
  })
  it('cae a Open-Meteo si AEMET falla', async () => {
    const p = await resuelvePrediccion(muni, {
      bajaAemet: async () => { throw new Error('AEMET down') },
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
})
