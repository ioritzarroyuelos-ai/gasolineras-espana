// Tests del calculo de precios de ITV.
//
// Esto es lo mas delicado del vertical: se publican importes que la gente va a
// pagar. Los casos de abajo NO son inventados, son los cuadres al centimo que
// salieron al verificar las fuentes oficiales. Si alguien toca la logica fiscal
// y rompe uno, es que ha roto un precio real.

import { describe, it, expect } from 'vitest'
import {
  TARIFAS, LIBERALIZADAS, SIN_DATO, TASA_DGT, FACTOR_IMPUESTO,
  desglosa, tarifaPorProvincia,
} from '../src/lib/itv-tarifas'

function porSlug(slug: string) {
  const t = TARIFAS.find(x => x.slug === slug)
  if (!t) throw new Error('tarifa no encontrada: ' + slug)
  return t
}

describe('factores fiscales', () => {
  it('usa el impuesto propio de cada territorio, no IVA en todas partes', () => {
    expect(FACTOR_IMPUESTO.iva21).toBe(1.21)
    expect(FACTOR_IMPUESTO.igic7).toBe(1.07)   // Canarias
    expect(FACTOR_IMPUESTO.ipsi9).toBe(1.09)   // Ceuta
    expect(FACTOR_IMPUESTO.ipsi4).toBe(1.04)   // Melilla
    expect(FACTOR_IMPUESTO.exento).toBe(1)     // tasas: sin impuesto indirecto
  })

  it('la tasa de la DGT de 2026 son 4,18 €', () => {
    expect(TASA_DGT).toBe(4.18)
  })
})

describe('desglosa: fuentes que publican SIN impuesto ni tasa', () => {
  it('Canarias aplica IGIC del 7%, no IVA (36,77 -> 43,52)', () => {
    const d = desglosa(porSlug('canarias'), 36.77)
    expect(d.base).toBeCloseTo(36.77, 2)
    expect(d.impuesto).toBeCloseTo(2.57, 2)
    expect(d.total).toBeCloseTo(43.52, 2)
    // Con IVA habrian salido 48,68 €: 5,16 € de mas.
    expect(d.total).toBeLessThan(46)
  })

  it('Castilla-La Mancha si aplica IVA del 21% (32,46 -> 43,46)', () => {
    const d = desglosa(porSlug('castilla-la-mancha'), 32.46)
    expect(d.base).toBeCloseTo(32.46, 2)
    expect(d.impuesto).toBeCloseTo(6.82, 2)
    expect(d.total).toBeCloseTo(43.46, 2)
  })

  it('Ceuta aplica IPSI del 9% (46,00 -> 54,32, cuadre verificado)', () => {
    const d = desglosa(porSlug('ceuta'), 46.00)
    expect(d.total).toBeCloseTo(54.32, 2)
  })
})

describe('desglosa: fuentes que publican CON todo incluido', () => {
  it('no vuelve a sumar impuesto ni tasa a un precio final (Comunitat Valenciana)', () => {
    const d = desglosa(porSlug('comunitat-valenciana'), 41.47)
    expect(d.total).toBeCloseTo(41.47, 2)
    // Y el desglose reconstruye la base hacia atras.
    expect(d.base + d.impuesto + d.tasaDgt).toBeCloseTo(41.47, 2)
  })

  it('Melilla ya trae IPSI y tasa dentro: el total no cambia', () => {
    const d = desglosa(porSlug('melilla'), 34.40)
    expect(d.total).toBeCloseTo(34.40, 2)
  })
})

describe('desglosa: territorios donde la ITV es una TASA', () => {
  it('Mallorca no lleva impuesto pero si suma la tasa de Trafico', () => {
    const t = porSlug('illes-balears-mallorca')
    const d = desglosa(t, 17.01)
    expect(d.impuesto).toBe(0)
    expect(d.total).toBeCloseTo(17.01 + TASA_DGT, 2)
  })

  it('Eivissa no lleva impuesto y YA incluye la tasa: no se duplica', () => {
    // Es el criterio opuesto al de Mallorca, en la misma comunidad.
    const d = desglosa(porSlug('illes-balears-eivissa'), 24.18)
    expect(d.impuesto).toBe(0)
    expect(d.total).toBeCloseTo(24.18, 2)
  })

  it('Extremadura es tasa: no se le suma un 21% inexistente', () => {
    const d = desglosa(porSlug('extremadura'), 29.25)
    expect(d.impuesto).toBe(0)
    expect(d.total).toBeCloseTo(29.25 + TASA_DGT, 2)
  })
})

describe('desglosa: fuentes con impuesto pero sin tasa', () => {
  it('Pais Vasco suma la tasa aparte (55,28 -> 59,46)', () => {
    const d = desglosa(porSlug('pais-vasco'), 55.28)
    expect(d.total).toBeCloseTo(59.46, 2)
  })
})

describe('invariantes del desglose', () => {
  it('base + impuesto + tasa siempre da el total, en todas las tarifas', () => {
    for (const t of TARIFAS) {
      for (const precio of [t.gasolina, t.diesel]) {
        if (precio == null) continue
        const d = desglosa(t, precio)
        expect(d.base + d.impuesto + d.tasaDgt).toBeCloseTo(d.total, 2)
        expect(d.base).toBeGreaterThan(0)
        expect(d.impuesto).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('la tasa se suma DESPUES del impuesto, nunca antes', () => {
    const t = porSlug('canarias')
    const d = desglosa(t, 36.77)
    // Si se sumara antes: (36,77 + 4,18) x 1,07 = 43,82. Son 30 centimos de mas.
    expect(d.total).not.toBeCloseTo((36.77 + TASA_DGT) * 1.07, 2)
  })

  it('ninguna tarifa publicada se queda sin norma citada', () => {
    for (const t of TARIFAS) {
      expect(t.norma.length).toBeGreaterThan(10)
      expect(t.vigencia.length).toBeGreaterThan(3)
    }
  })
})

describe('cobertura territorial', () => {
  it('resuelve la tarifa desde el slug de provincia', () => {
    expect(tarifaPorProvincia('sevilla')?.slug).toBe('andalucia')
    expect(tarifaPorProvincia('bizkaia')?.slug).toBe('pais-vasco')
    expect(tarifaPorProvincia('toledo')?.slug).toBe('castilla-la-mancha')
  })

  it('Madrid y Murcia no tienen tarifa: estan liberalizadas', () => {
    expect(tarifaPorProvincia('madrid')).toBeNull()
    expect(tarifaPorProvincia('murcia')).toBeNull()
    const nombres = LIBERALIZADAS.map(x => x.nombre).join(' ')
    expect(nombres).toContain('Madrid')
    expect(nombres).toContain('Murcia')
  })

  it('explica por que faltan los territorios sin dato', () => {
    expect(SIN_DATO.length).toBeGreaterThan(0)
    for (const s of SIN_DATO) expect(s.motivo.length).toBeGreaterThan(20)
  })

  it('no asigna la misma provincia a dos comunidades', () => {
    const vistas = new Set<string>()
    for (const t of TARIFAS) {
      for (const p of t.provincias) {
        expect(vistas.has(p)).toBe(false)
        vistas.add(p)
      }
    }
  })
})
