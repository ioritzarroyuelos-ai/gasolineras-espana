import { describe, it, expect } from 'vitest'
import { ELECCIONES, eleccionPorId, colorPartido, normSiglas } from '../scripts/lib/politica-catalogo.mjs'

describe('catálogo de elecciones', () => {
  it('tiene 21 elecciones: 1 generales + 1 europeas + 19 autonómicas', () => {
    expect(ELECCIONES.length).toBe(21)
    expect(ELECCIONES.filter((e) => e.tipo === 'generales').length).toBe(1)
    expect(ELECCIONES.filter((e) => e.tipo === 'europeas').length).toBe(1)
    expect(ELECCIONES.filter((e) => e.tipo === 'autonomica').length).toBe(19)
  })

  it('los ids/slugs son únicos', () => {
    const ids = ELECCIONES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('ciudadAutonoma solo en Ceuta y Melilla', () => {
    const ciudades = ELECCIONES.filter((e) => e.ciudadAutonoma).map((e) => e.id).sort()
    expect(ciudades).toEqual(['ceuta', 'melilla'])
  })

  it('cada elección tiene cámara coherente (mayoria = floor(escanos/2)+1)', () => {
    for (const e of ELECCIONES) {
      expect(e.camara.escanos).toBeGreaterThan(0)
      expect(e.camara.mayoria).toBe(Math.floor(e.camara.escanos / 2) + 1)
    }
  })

  it('cada autonómica declara su comunidad; generales/europeas no', () => {
    for (const e of ELECCIONES) {
      if (e.tipo === 'autonomica') expect(e.comunidad).toBeTruthy()
      else expect(e.comunidad).toBeUndefined()
    }
  })

  it('toda referencia de resultados apunta a un artículo; sondeos puede ser null', () => {
    for (const e of ELECCIONES) {
      expect(e.wikiResultados.articulo.length).toBeGreaterThan(0)
      if (e.wikiSondeos) expect(['es', 'en']).toContain(e.wikiSondeos.lang)
    }
    // Sin artículo de sondeos de la próxima: europeas (2029) + anticipadas recientes
    const sinSondeos = ELECCIONES.filter((e) => !e.wikiSondeos).map((e) => e.id).sort()
    expect(sinSondeos).toEqual(['aragon', 'europeas', 'extremadura'])
  })

  it('eleccionPorId encuentra y devuelve undefined si no existe', () => {
    expect(eleccionPorId('madrid')?.nombre).toContain('Madrid')
    expect(eleccionPorId('noexiste')).toBeUndefined()
  })

  it('colorPartido: conocidos con su color, desconocidos con defecto', () => {
    expect(colorPartido('PP')).toBe('#1d6fb8')
    expect(colorPartido('psoe')).toBe('#e30613')
    expect(colorPartido('EH Bildu')).toBe('#8fb63c') // normaliza acentos/espacios
    expect(colorPartido('PartidoRaro')).toBe('#8a8f98')
    expect(colorPartido('PP')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('normSiglas quita acentos, espacios y signos', () => {
    expect(normSiglas('EH Bildu')).toBe('EHBILDU')
    expect(normSiglas('Més')).toBe('MES')
  })
})
