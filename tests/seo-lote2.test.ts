import { describe, it, expect } from 'vitest'
import { buildPage } from '../src/html/shell'

const stats = { '95': { min: 1.5, avg: 1.6, max: 1.7, count: 12 } }
const topStations = [
  { id: '1', name: 'REPSOL', address: 'Av. de América 1', municipio: 'Madrid', provincia: 'Madrid', lat: 40, lon: -3, price: 1.499, fuelCode: '95' },
  { id: '2', name: 'CEPSA', address: 'Calle Mayor 5', municipio: 'Alcalá', provincia: 'Madrid', lat: 40, lon: -3, price: 1.512, fuelCode: '95' },
]

describe('SEO Lote 2 — contenido visible y malla', () => {
  it('provincia: muestra las gasolineras más baratas VISIBLES (no solo en JSON-LD)', () => {
    const html = buildPage('n1', 'https://webapp-3ft.pages.dev/gasolineras/madrid', {
      seo: { provinciaId: '13', provinciaSlug: 'madrid', provinciaName: 'Madrid', stats, stationCount: 400, topStations },
    })
    expect(html).toContain('seo-cheap')
    expect(html).toContain('REPSOL')
    expect(html).toContain('1.499 €/L')
  })

  it('provincia: enlaces cruzados a otras verticales + observatorio', () => {
    const html = buildPage('n1', 'https://webapp-3ft.pages.dev/gasolineras/madrid', {
      seo: { provinciaId: '13', provinciaSlug: 'madrid', provinciaName: 'Madrid', stats, stationCount: 400, topStations },
    })
    expect(html).toContain('href="/tiempo/madrid"')
    expect(html).toContain('href="/farmacias/madrid"')
    expect(html).toContain('href="/itv/madrid"')
    expect(html).toContain('href="/precios-carburantes"')
  })

  it('municipio: enlaza municipios hermanos de la provincia', () => {
    const html = buildPage('n1', 'https://webapp-3ft.pages.dev/gasolineras/madrid/alcala-de-henares', {
      seo: { provinciaId: '13', provinciaSlug: 'madrid', provinciaName: 'Madrid',
        municipioId: 'x', municipioSlug: 'alcala-de-henares', municipioName: 'Alcalá de Henares', stats, stationCount: 30, topStations },
      municipios: [{ slug: 'getafe', name: 'Getafe', stationCount: 20 }, { slug: 'leganes', name: 'Leganés', stationCount: 18 }],
    })
    expect(html).toContain('Otras localidades de Madrid')
    expect(html).toContain('href="/gasolineras/madrid/getafe"')
  })
})
