// Tests para el mapping de provincias INE ↔ slug.
// Aseguran que (a) hay exactamente 52 entradas, (b) no hay slugs duplicados,
// (c) ningun slug contiene caracteres no-URL-safe, y (d) las funciones de
// lookup funcionan en ambos sentidos.
import { describe, it, expect } from 'vitest'
import { PROVINCIAS, provinciaBySlug, provinciaById } from '../src/lib/provincias'

describe('provincias', () => {
  it('contiene las 52 provincias españolas', () => {
    expect(PROVINCIAS.length).toBe(52)
  })

  it('no tiene slugs duplicados', () => {
    const slugs = new Set<string>()
    for (const p of PROVINCIAS) {
      expect(slugs.has(p.slug), 'duplicado: ' + p.slug).toBe(false)
      slugs.add(p.slug)
    }
    expect(slugs.size).toBe(52)
  })

  it('no tiene ids duplicados', () => {
    const ids = new Set<string>()
    for (const p of PROVINCIAS) {
      expect(ids.has(p.id), 'duplicado id: ' + p.id).toBe(false)
      ids.add(p.id)
    }
    expect(ids.size).toBe(52)
  })

  it('todos los slugs son URL-safe (lowercase, [a-z0-9-])', () => {
    const re = /^[a-z0-9]+(-[a-z0-9]+)*$/
    for (const p of PROVINCIAS) {
      expect(re.test(p.slug), p.slug + ' no es URL-safe').toBe(true)
    }
  })

  it('todos los ids son códigos INE (2 dígitos, 01-52)', () => {
    for (const p of PROVINCIAS) {
      expect(p.id).toMatch(/^\d{2}$/)
      const n = parseInt(p.id, 10)
      expect(n >= 1 && n <= 52).toBe(true)
    }
  })

  it('provinciaBySlug resuelve los slugs conocidos', () => {
    expect(provinciaBySlug('madrid')?.id).toBe('28')
    expect(provinciaBySlug('barcelona')?.id).toBe('08')
    expect(provinciaBySlug('bizkaia')?.id).toBe('48')
    expect(provinciaBySlug('santa-cruz-de-tenerife')?.id).toBe('38')
  })

  it('provinciaBySlug devuelve null para slugs inexistentes', () => {
    expect(provinciaBySlug('atlantida')).toBeNull()
    expect(provinciaBySlug('')).toBeNull()
    expect(provinciaBySlug(undefined)).toBeNull()
  })

  it('provinciaBySlug es case-insensitive', () => {
    expect(provinciaBySlug('MADRID')?.id).toBe('28')
    expect(provinciaBySlug('Madrid')?.id).toBe('28')
  })

  it('provinciaById resuelve en sentido inverso', () => {
    expect(provinciaById('28')?.slug).toBe('madrid')
    expect(provinciaById('08')?.slug).toBe('barcelona')
    expect(provinciaById('99')).toBeNull()
    expect(provinciaById(undefined)).toBeNull()
  })

  it('cada entrada es redonda (slug→id→slug)', () => {
    for (const p of PROVINCIAS) {
      expect(provinciaBySlug(p.slug)?.id).toBe(p.id)
      expect(provinciaById(p.id)?.slug).toBe(p.slug)
    }
  })
})
