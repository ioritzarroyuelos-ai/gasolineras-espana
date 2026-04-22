// Tests para helpers de municipios (Ship 11).
// Cubre slugificacion (diacriticos, apostrofes, slash, espacios multiples),
// agrupacion por provincia, top-N + filtros, resolucion slug→entry y stats
// por municipio. El snapshot se construye inline para independencia.

import { describe, it, expect } from 'vitest'
import {
  slugifyMunicipio,
  municipiosInProvincia,
  topMunicipiosInProvincia,
  findMunicipioBySlug,
  statsForMunicipio,
  topCheapestStationsIn,
} from '../src/lib/municipios'

describe('slugifyMunicipio', () => {
  it('elimina diacriticos y pasa a lowercase', () => {
    expect(slugifyMunicipio('Alcalá de Henares')).toBe('alcala-de-henares')
    expect(slugifyMunicipio('A Coruña')).toBe('a-coruna')
    expect(slugifyMunicipio('Cáceres')).toBe('caceres')
  })
  it('colapsa separadores raros', () => {
    expect(slugifyMunicipio("Donostia / San Sebastián")).toBe('donostia-san-sebastian')
    expect(slugifyMunicipio("L'Hospitalet de Llobregat")).toBe('l-hospitalet-de-llobregat')
    expect(slugifyMunicipio('  Madrid   ')).toBe('madrid')
  })
  it('devuelve string vacio para entrada vacia o rara', () => {
    expect(slugifyMunicipio('')).toBe('')
    expect(slugifyMunicipio('---')).toBe('')
    // @ts-expect-error testing runtime fallback
    expect(slugifyMunicipio(null)).toBe('')
  })
  it('es idempotente sobre un slug ya formado', () => {
    expect(slugifyMunicipio('alcala-de-henares')).toBe('alcala-de-henares')
  })
})

// Snapshot-fixture minimo: 3 municipios en provincia "28" (Madrid) con counts
// distintos + 1 municipio en provincia "08" para verificar filtrado.
const FIXTURE = {
  ListaEESSPrecio: [
    // Municipio Madrid (5 estaciones)
    { IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', 'Precio Gasolina 95 E5': '1,500', 'Precio Gasoleo A': '1,400' },
    { IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', 'Precio Gasolina 95 E5': '1,550', 'Precio Gasoleo A': '1,450' },
    { IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', 'Precio Gasolina 95 E5': '1,600', 'Precio Gasoleo A': '1,500' },
    { IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', 'Precio Gasolina 95 E5': '1,700' },
    { IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid' },
    // Alcalá (2 estaciones) — debajo del minStations=5 por defecto
    { IDProvincia: '28', IDMunicipio: '282', Municipio: 'Alcalá de Henares', 'Precio Gasolina 95 E5': '1,480' },
    { IDProvincia: '28', IDMunicipio: '282', Municipio: 'Alcalá de Henares', 'Precio Gasolina 95 E5': '1,520' },
    // Getafe (3 estaciones) — tambien debajo del minStations=5
    { IDProvincia: '28', IDMunicipio: '283', Municipio: 'Getafe' },
    { IDProvincia: '28', IDMunicipio: '283', Municipio: 'Getafe' },
    { IDProvincia: '28', IDMunicipio: '283', Municipio: 'Getafe' },
    // Barcelona (otra provincia) — debe quedar fuera del filter por provincia=28
    { IDProvincia: '08', IDMunicipio: '081', Municipio: 'Barcelona' },
  ],
}

describe('municipiosInProvincia', () => {
  it('agrupa por IDMunicipio y cuenta estaciones', () => {
    const out = municipiosInProvincia(FIXTURE, '28')
    expect(out).toHaveLength(3)
    // Madrid lider (5 estaciones)
    expect(out[0].name).toBe('Madrid')
    expect(out[0].stationCount).toBe(5)
    expect(out[0].slug).toBe('madrid')
    expect(out[0].provinciaId).toBe('28')
  })
  it('ordena desc por stationCount', () => {
    const out = municipiosInProvincia(FIXTURE, '28')
    const counts = out.map(m => m.stationCount)
    for (let i = 0; i < counts.length - 1; i++) {
      expect(counts[i]).toBeGreaterThanOrEqual(counts[i + 1])
    }
  })
  it('excluye estaciones de otras provincias', () => {
    const out = municipiosInProvincia(FIXTURE, '28')
    expect(out.find(m => m.name === 'Barcelona')).toBeUndefined()
  })
  it('devuelve array vacio para snapshot null', () => {
    expect(municipiosInProvincia(null, '28')).toEqual([])
    expect(municipiosInProvincia(undefined, '28')).toEqual([])
  })
})

describe('topMunicipiosInProvincia', () => {
  it('aplica minStations por defecto (5)', () => {
    const out = topMunicipiosInProvincia(FIXTURE, '28')
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Madrid')
  })
  it('respeta minStations custom', () => {
    const out = topMunicipiosInProvincia(FIXTURE, '28', { minStations: 2 })
    // Madrid (5), Getafe (3), Alcalá (2) → todos pasan
    expect(out).toHaveLength(3)
  })
  it('respeta limit', () => {
    const out = topMunicipiosInProvincia(FIXTURE, '28', { minStations: 1, limit: 2 })
    expect(out).toHaveLength(2)
    expect(out[0].name).toBe('Madrid')  // el mas grande sigue primero
  })
})

describe('findMunicipioBySlug', () => {
  it('resuelve un slug existente', () => {
    const m = findMunicipioBySlug(FIXTURE, '28', 'alcala-de-henares')
    expect(m?.name).toBe('Alcalá de Henares')
    expect(m?.id).toBe('282')
  })
  it('devuelve null si no existe', () => {
    expect(findMunicipioBySlug(FIXTURE, '28', 'no-existe')).toBeNull()
    expect(findMunicipioBySlug(FIXTURE, '28', '')).toBeNull()
  })
  it('no cruza provincias', () => {
    expect(findMunicipioBySlug(FIXTURE, '08', 'madrid')).toBeNull()
  })
  it('es case-insensitive', () => {
    const m = findMunicipioBySlug(FIXTURE, '28', 'MADRID')
    expect(m?.name).toBe('Madrid')
  })
})

describe('statsForMunicipio', () => {
  it('computa stats correctas para municipio con precios', () => {
    const r = statsForMunicipio(FIXTURE, '28', '281')
    expect(r.stationCount).toBe(5)
    expect(r.stats['95']).toBeDefined()
    expect(r.stats['95'].count).toBe(4)   // 4 estaciones con precio 95
    expect(r.stats['95'].min).toBeCloseTo(1.500, 3)
    expect(r.stats['95'].max).toBeCloseTo(1.700, 3)
    expect(r.stats['diesel']).toBeDefined()
    expect(r.stats['diesel'].count).toBe(3)
  })
  it('stats vacio si municipio no tiene precios', () => {
    const r = statsForMunicipio(FIXTURE, '28', '283')  // Getafe sin precios
    expect(r.stationCount).toBe(3)
    expect(Object.keys(r.stats)).toHaveLength(0)
  })
  it('stationCount 0 para municipio inexistente', () => {
    const r = statsForMunicipio(FIXTURE, '28', '999')
    expect(r.stationCount).toBe(0)
  })
})

// Ship 17: topCheapestStationsIn — rich fixture con los campos que el helper
// exige (IDEESS, Rotulo, Direccion, Latitud, Longitud, Municipio, Provincia).
// FIXTURE no los incluye y no queremos mutarlo para no romper los otros tests.
const RICH_FIXTURE = {
  ListaEESSPrecio: [
    {
      IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', Provincia: 'Madrid',
      IDEESS: '1001', 'Rótulo': 'REPSOL A', 'Dirección': 'Calle 1',
      Latitud: '40,41', 'Longitud (WGS84)': '-3,70', 'C.P.': '28001',
      'Precio Gasolina 95 E5': '1,600',
    },
    {
      IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', Provincia: 'Madrid',
      IDEESS: '1002', 'Rótulo': 'CEPSA B', 'Dirección': 'Calle 2',
      Latitud: '40,42', 'Longitud (WGS84)': '-3,69', 'C.P.': '28002',
      'Precio Gasolina 95 E5': '1,550',
    },
    {
      IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', Provincia: 'Madrid',
      IDEESS: '1003', 'Rótulo': 'BP C', 'Dirección': 'Calle 3',
      Latitud: '40,43', 'Longitud (WGS84)': '-3,68', 'C.P.': '28003',
      'Precio Gasolina 95 E5': '1,500',
    },
    // Sin precio 95 — debe filtrarse
    {
      IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', Provincia: 'Madrid',
      IDEESS: '1004', 'Rótulo': 'SINPRECIO', 'Dirección': 'Calle 4',
      Latitud: '40,44', 'Longitud (WGS84)': '-3,67',
    },
    // Coords invalidas (0,0) — debe filtrarse
    {
      IDProvincia: '28', IDMunicipio: '281', Municipio: 'Madrid', Provincia: 'Madrid',
      IDEESS: '1005', 'Rótulo': 'BAD COORDS', 'Dirección': 'Calle 5',
      Latitud: '0', 'Longitud (WGS84)': '0',
      'Precio Gasolina 95 E5': '1,450',
    },
    // Otra provincia — debe filtrarse por provinciaId
    {
      IDProvincia: '08', IDMunicipio: '081', Municipio: 'Barcelona', Provincia: 'Barcelona',
      IDEESS: '2001', 'Rótulo': 'REPSOL BCN', 'Dirección': 'Gran Via 1',
      Latitud: '41,38', 'Longitud (WGS84)': '2,17',
      'Precio Gasolina 95 E5': '1,400',
    },
  ],
}

describe('topCheapestStationsIn', () => {
  it('devuelve las estaciones mas baratas en 95 ordenadas asc', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', fuelCode: '95' })
    expect(r).toHaveLength(3)
    expect(r[0].price).toBe(1.500)
    expect(r[0].name).toBe('BP C')
    expect(r[1].price).toBe(1.550)
    expect(r[2].price).toBe(1.600)
  })
  it('filtra por municipioId cuando se proporciona', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', municipioId: '281', fuelCode: '95' })
    expect(r).toHaveLength(3)
    expect(r.every(s => s.municipio === 'Madrid')).toBe(true)
  })
  it('ignora estaciones sin precio valido del combustible pedido', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', fuelCode: '95' })
    // 1004 (sin precio) no debe aparecer
    expect(r.find(s => s.id === '1004')).toBeUndefined()
  })
  it('ignora estaciones con coords (0,0)', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', fuelCode: '95' })
    // 1005 (coords 0,0) no debe aparecer — invalida para JSON-LD GeoCoordinates
    expect(r.find(s => s.id === '1005')).toBeUndefined()
  })
  it('filtra por provinciaId — no mezcla Madrid con Barcelona', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', fuelCode: '95' })
    expect(r.find(s => s.provincia === 'Barcelona')).toBeUndefined()
  })
  it('respeta el limit', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', fuelCode: '95', limit: 2 })
    expect(r).toHaveLength(2)
  })
  it('devuelve [] si no hay estaciones con el combustible pedido', () => {
    const r = topCheapestStationsIn(RICH_FIXTURE, { provinciaId: '28', fuelCode: 'diesel_plus' })
    expect(r).toEqual([])
  })
  it('devuelve [] si snapshot es null', () => {
    const r = topCheapestStationsIn(null, { provinciaId: '28' })
    expect(r).toEqual([])
  })
})
