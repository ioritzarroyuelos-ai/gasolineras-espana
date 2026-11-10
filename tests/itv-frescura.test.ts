import { describe, it, expect } from 'vitest'
import { avisoDirectorio, buildItvIndexPage, buildItvProvinciaPage, buildItvMunicipioPage } from '../src/html/itv'

describe('antigüedad del directorio ITV', () => {
  const now = Date.parse('2026-11-03T12:00:00Z')
  it('conserva la fecha real de la copia antigua y enlaza la fuente oficial', () => {
    const html = avisoDirectorio('2026-08-01T08:00:00Z', now)
    expect(html).toContain('Directorio pendiente de actualizar')
    expect(html).toContain('1 de agosto de 2026')
    expect(html).toContain('https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/')
    expect(html).not.toContain('3 de noviembre')
  })
  it('no presenta fechas futuras o ausentes como datos actuales', () => {
    for (const date of [undefined, 'invalida', '2027-01-01T00:00:00Z']) {
      expect(avisoDirectorio(date, now)).toContain('Fecha de los datos no disponible')
      expect(avisoDirectorio(date, now)).toContain('Directorio pendiente')
    }
    expect(avisoDirectorio('2026-11-03T08:00:00Z', now)).not.toContain('pendiente de actualizar')
    expect(avisoDirectorio('2026-11-01T08:00:00Z', now)).toContain('pendiente de actualizar')
  })
  it('incluye la fecha en los tres niveles del directorio', () => {
    const updatedAt = '2026-08-01T08:00:00Z'
    const shared = { provinciaSlug: 'madrid', provinciaName: 'Madrid', estaciones: [], canonical: 'https://example.com/itv/madrid', updatedAt }
    const pages = [buildItvIndexPage('nonce', [], 0, 'https://example.com/itv/', updatedAt), buildItvProvinciaPage('nonce', { ...shared, municipios: [], tarifa: null }), buildItvMunicipioPage('nonce', { ...shared, municipioName: 'Madrid', otrosMunicipios: [] })]
    for (const page of pages) expect(page).toContain('datetime="2026-08-01T08:00:00Z"')
  })
})
