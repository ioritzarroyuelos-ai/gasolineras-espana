import { describe, expect, it } from 'vitest'

import {
  computeStats,
  filterStations,
  findBestLocationId,
  isOpenNow,
  parseNumericPrice
} from '../public/static/modules/domain.js'

const stationA = {
  id: '1',
  label: 'Alpha',
  address: 'Calle Uno',
  municipality: 'Madrid',
  municipalityId: '28079',
  schedule: 'L-D: 00:00-23:59',
  lat: 40.4168,
  lng: -3.7038,
  prices: { gas95: 1.5, diesel: 1.42 },
  searchText: 'Alpha Calle Uno Madrid'
}

const stationB = {
  id: '2',
  label: 'Beta',
  address: 'Avenida Dos',
  municipality: 'Madrid',
  municipalityId: '28079',
  schedule: 'XX: 08:00-20:00',
  lat: 40.45,
  lng: -3.7,
  prices: { gas95: 1.62, diesel: 1.51 },
  searchText: 'Beta Avenida Dos Madrid'
}

const stationC = {
  id: '3',
  label: 'Gamma',
  address: 'Plaza Tres',
  municipality: 'Getafe',
  municipalityId: '28065',
  schedule: 'L-D: 00:00-23:59',
  lat: 40.31,
  lng: -3.73,
  prices: { gas95: null, diesel: 1.39 },
  searchText: 'Gamma Plaza Tres Getafe'
}

describe('parseNumericPrice', () => {
  it('normalizes comma decimals', () => {
    expect(parseNumericPrice('1,579')).toBe(1.579)
  })

  it('returns null for invalid values', () => {
    expect(parseNumericPrice('')).toBeNull()
    expect(parseNumericPrice('nope')).toBeNull()
  })
})

describe('isOpenNow', () => {
  it('accepts 24 hour schedules', () => {
    expect(isOpenNow('24H', new Date('2026-04-08T10:00:00'))).toBe(true)
  })

  it('matches weekday schedules', () => {
    expect(isOpenNow('L-V: 08:00-20:00', new Date('2026-04-08T10:00:00'))).toBe(true)
    expect(isOpenNow('L-V: 08:00-20:00', new Date('2026-04-08T22:00:00'))).toBe(false)
  })
})

describe('filterStations', () => {
  it('filters by municipality and text', () => {
    const result = filterStations([stationA, stationB, stationC], {
      municipalityId: '28079',
      fuelId: 'gas95',
      openOnly: false,
      query: 'avenida',
      sort: 'price-asc'
    })

    expect(result.map((item) => item.id)).toEqual(['2'])
  })

  it('filters by open now when requested', () => {
    const result = filterStations([stationA, stationB], {
      municipalityId: '',
      fuelId: 'gas95',
      openOnly: true,
      query: '',
      sort: 'price-asc'
    })

    expect(result.map((item) => item.id)).toEqual(['1'])
  })

  it('applies user location bounds', () => {
    const result = filterStations([stationA, stationB, stationC], {
      municipalityId: '',
      fuelId: 'gas95',
      openOnly: false,
      query: '',
      sort: 'price-asc',
      userLocation: { lat: 40.4168, lng: -3.7038 }
    })

    expect(result.map((item) => item.id)).toEqual(['1', '2'])
  })
})

describe('computeStats', () => {
  it('ignores null prices', () => {
    const result = computeStats([stationA, stationB, stationC], 'gas95')
    expect(result.count).toBe(3)
    expect(result.min).toBe(1.5)
    expect(result.max).toBe(1.62)
    expect(result.avg).toBeCloseTo(1.56, 2)
  })
})

describe('findBestLocationId', () => {
  it('supports common province aliases', () => {
    const result = findBestLocationId(
      [
        { id: '48', name: 'Bizkaia' },
        { id: '28', name: 'Madrid' }
      ],
      'Vizcaya'
    )

    expect(result).toBe('48')
  })
})
