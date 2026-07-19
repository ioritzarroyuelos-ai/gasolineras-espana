// Tests del indice de estaciones de ITV.
//
// Los casos frontera vienen de defectos REALES observados en el dataset de la
// DGT al construirlo (ver scripts/fetch-itv.mjs): municipios en mayusculas,
// estaciones sin coordenadas (las de Castellon, que vienen del portal valenciano),
// y provincias que en origen son islas.

import { describe, it, expect } from 'vitest'
import {
  parseItv, provinciaPorSlug, provinciasConItv, municipiosConItv,
  estacionesDeProvincia, estacionesDeMunicipio,
  normalizaNombreMunicipio, telHref, mapsHref,
  type EstacionITV,
} from '../src/lib/itv'

function est(p: Partial<EstacionITV>): EstacionITV {
  return {
    id: 'x', prov: '28', mun: 'MADRID', dir: 'C/ Falsa 1', cp: '28001',
    tel: '910 00 00 00', op: 'Applus', lat: 40.4, lng: -3.7, lineas: 4,
    horario: '', fuente: 'dgt', ...p,
  }
}

describe('parseItv', () => {
  it('devuelve vacio ante entrada invalida', () => {
    expect(parseItv(null)).toEqual([])
    expect(parseItv({})).toEqual([])
    expect(parseItv({ estaciones: 'no soy un array' as never })).toEqual([])
  })

  it('descarta registros sin provincia', () => {
    const out = parseItv({ estaciones: [est({}), { ...est({}), prov: undefined as never }] })
    expect(out).toHaveLength(1)
  })
})

describe('normalizaNombreMunicipio', () => {
  it('pasa de mayusculas a formato titulo', () => {
    expect(normalizaNombreMunicipio('MADRID')).toBe('Madrid')
    expect(normalizaNombreMunicipio('VILA-REAL')).toBe('Vila-real')
  })

  it('deja las particulas en minuscula salvo al principio', () => {
    expect(normalizaNombreMunicipio('SANTA CRUZ DE TENERIFE')).toBe('Santa Cruz de Tenerife')
    expect(normalizaNombreMunicipio('LAS PALMAS')).toBe('Las Palmas')
  })

  it('tolera vacios', () => {
    expect(normalizaNombreMunicipio('')).toBe('')
    expect(normalizaNombreMunicipio('   ')).toBe('')
  })
})

describe('agrupaciones', () => {
  const todas = [
    est({ id: 'a', prov: '28', mun: 'MADRID' }),
    est({ id: 'b', prov: '28', mun: 'MADRID' }),
    est({ id: 'c', prov: '28', mun: 'ALCALA DE HENARES' }),
    est({ id: 'd', prov: '08', mun: 'BARCELONA' }),
    est({ id: 'e', prov: '12', mun: 'VINAROS', lat: null, lng: null, fuente: 'gva' }),
  ]

  it('filtra por provincia', () => {
    expect(estacionesDeProvincia(todas, '28')).toHaveLength(3)
    expect(estacionesDeProvincia(todas, '12')).toHaveLength(1)
    expect(estacionesDeProvincia(todas, '99')).toHaveLength(0)
  })

  it('agrupa municipios y cuenta las estaciones de cada uno', () => {
    const munis = municipiosConItv(estacionesDeProvincia(todas, '28'))
    expect(munis).toHaveLength(2)
    // Ordenados por nombre: Alcala antes que Madrid.
    expect(munis[0].name).toBe('Alcala de Henares')
    expect(munis[1].name).toBe('Madrid')
    expect(munis[1].count).toBe(2)
  })

  it('lista las provincias con estacion resolviendo su nombre', () => {
    const provs = provinciasConItv(todas)
    const slugs = provs.map(p => p.slug)
    expect(slugs).toContain('madrid')
    expect(slugs).toContain('barcelona')
    expect(slugs).toContain('castellon')
    expect(provs.find(p => p.slug === 'madrid')!.count).toBe(3)
  })

  it('descarta codigos de provincia que no existen', () => {
    const provs = provinciasConItv([est({ prov: '99' })])
    expect(provs).toHaveLength(0)
  })

  it('filtra por municipio via slug', () => {
    const deMadrid = estacionesDeProvincia(todas, '28')
    expect(estacionesDeMunicipio(deMadrid, 'madrid')).toHaveLength(2)
    expect(estacionesDeMunicipio(deMadrid, 'alcala-de-henares')).toHaveLength(1)
    expect(estacionesDeMunicipio(deMadrid, 'inventado')).toHaveLength(0)
  })
})

describe('provinciaPorSlug', () => {
  it('resuelve slugs conocidos', () => {
    expect(provinciaPorSlug('madrid')?.id).toBe('28')
    expect(provinciaPorSlug('castellon')?.id).toBe('12')
  })

  it('devuelve null ante slug desconocido o vacio', () => {
    expect(provinciaPorSlug('narnia')).toBeNull()
    expect(provinciaPorSlug(undefined)).toBeNull()
  })
})

describe('enlaces', () => {
  it('limpia el telefono para el href tel:', () => {
    expect(telHref('945 29 27 72')).toBe('tel:945292772')
    expect(telHref('')).toBe('')
  })

  it('usa coordenadas cuando las hay', () => {
    expect(mapsHref(est({ lat: 40.4, lng: -3.7 }))).toContain('destination=40.4,-3.7')
  })

  it('cae a busqueda por texto sin coordenadas (caso Castellon)', () => {
    const href = mapsHref(est({ lat: null, lng: null, dir: 'AVDA. JOAN XXIII', mun: 'VINAROS' }))
    expect(href).toContain('/maps/search/')
    expect(href).toContain('AVDA')
  })
})
