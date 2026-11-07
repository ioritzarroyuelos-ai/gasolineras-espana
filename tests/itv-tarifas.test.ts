// Regresiones de importes oficiales, suplementos y ausencia de precios sin confirmar.

import { describe, it, expect } from 'vitest'
import {
  TARIFAS, LIBERALIZADAS, SIN_DATO, TASA_DGT, FACTOR_IMPUESTO, TASA_DGT_FUENTE,
  desglosa, tarifaPorProvincia, tarifaVigente,
} from '../src/lib/itv-tarifas'

function porSlug(slug: string) {
  const t = TARIFAS.find(x => x.slug === slug)
  if (!t) throw new Error('tarifa no encontrada: ' + slug)
  return t
}

describe('vigencia de la revisión y de la tarifa', () => {
  it('limita a 120 días los precios sin fecha oficial de fin', () => {
    const t = { ...porSlug('andalucia'), revisada: '2026-01-01' }
    expect(tarifaVigente(t, Date.parse('2026-05-01T12:00:00Z'))).toBe(true)
    expect(tarifaVigente(t, Date.parse('2026-05-02T12:00:00Z'))).toBe(false)
  })

  it('retira antes una tarifa cuyo periodo oficial termina al cambiar el día en España', () => {
    const t = { ...porSlug('aragon'), vigenteHasta: '2026-11-30' }
    expect(tarifaVigente(t, Date.parse('2026-11-30T22:59:59Z'))).toBe(true)
    expect(tarifaVigente(t, Date.parse('2026-11-30T23:00:00Z'))).toBe(false)
  })

  it('requiere revisar DGT en el nuevo año aunque la norma autonómica siga vigente', () => {
    for (const slug of ['illes-balears-eivissa', 'canarias']) {
      const t = porSlug(slug)
      expect(tarifaVigente(t, Date.parse('2026-12-31T22:59:59Z'))).toBe(true)
      expect(tarifaVigente(t, Date.parse('2026-12-31T23:00:00Z'))).toBe(false)
    }
    expect(porSlug('canarias').vigenteHasta).toBe('2027-01-31')
    expect(porSlug('illes-balears-eivissa').vigenteHasta).toBeUndefined()
  })

  it('no considera verificado un precio pendiente ni una revisión futura o inválida', () => {
    const ahora = Date.parse('2026-11-07T12:00:00Z')
    expect(tarifaVigente(porSlug('ceuta'), ahora)).toBe(false)
    expect(tarifaVigente({ ...porSlug('andalucia'), revisada: '2026-11-08' }, ahora)).toBe(false)
    expect(tarifaVigente({ ...porSlug('andalucia'), revisada: 'sin revisar' }, ahora)).toBe(false)
    expect(tarifaVigente(porSlug('andalucia'), NaN)).toBe(false)
  })
})

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
    expect(new URL(TASA_DGT_FUENTE).hostname).toBe('sedeclave.dgt.gob.es')
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

  it('Castilla-La Mancha añade la tasa autonómica, sin volver a gravarla', () => {
    const d = desglosa(porSlug('castilla-la-mancha'), 32.46)
    expect(d.base).toBeCloseTo(32.46, 2)
    expect(d.impuesto).toBeCloseTo(6.82, 2)
    expect(d.suplementos).toEqual([expect.objectContaining({ concepto: 'Tasa autonómica', importe: 1.04 })])
    expect(d.total).toBe(44.50)
    expect(desglosa(porSlug('castilla-la-mancha'), 42.98).total).toBe(57.23)
  })

  it('conserva Ceuta y La Rioja como pendientes y evita compararlas con cifras sin confirmar', () => {
    for (const slug of ['ceuta', 'la-rioja']) {
      const t = porSlug(slug)
      expect(t.estado).toBe('pendiente')
      expect(t.gasolina).toBeUndefined()
      expect(t.diesel).toBeUndefined()
      expect(t.condiciones).toBeTruthy()
    }
  })
})

describe('desglosa: fuentes que publican CON todo incluido', () => {
  it('no vuelve a sumar impuesto ni tasa a un precio final (Comunitat Valenciana)', () => {
    const d = desglosa(porSlug('comunitat-valenciana'), 41.47)
    expect(d.total).toBeCloseTo(41.47, 2)
    // Y el desglose reconstruye la base hacia atras.
    expect(d.base + d.impuesto + d.tasaDgt).toBeCloseTo(41.47, 2)
  })

  it('Melilla conserva el total oficial de emisiones y explica el posible suplemento OBD', () => {
    const d = desglosa(porSlug('melilla'), 34.40)
    expect(d.total).toBe(43.09)
    expect(d.suplementos).toEqual([{ concepto: 'Control de emisiones, IPSI incluido', importe: 8.69 }])
    expect(porSlug('melilla').condiciones).toContain('5,44')
    expect(porSlug('melilla').alcancePrecio).toContain('OBD')
    expect(porSlug('melilla').tipoPrecio).toBe('maximo')
  })

  it('conserva al céntimo cualquier importe que la fuente ya publique con impuestos y DGT', () => {
    const t = { ...porSlug('comunitat-valenciana'), suplementos: [] }
    for (let centimos = 3000; centimos <= 5000; centimos++) {
      expect(desglosa(t, centimos / 100).total).toBe(centimos / 100)
    }
  })
})

describe('desglosa: territorios donde la ITV es una TASA', () => {
  it('Mallorca no lleva impuesto pero si suma la tasa de Trafico', () => {
    const t = porSlug('illes-balears-mallorca')
    const d = desglosa(t, 17.01)
    expect(d.impuesto).toBe(0)
    expect(d.total).toBeCloseTo(17.01 + TASA_DGT, 2)
  })

  it('Eivissa usa la ordenanza de agosto de 2026 para ambos combustibles sin duplicar DGT', () => {
    const t = porSlug('illes-balears-eivissa')
    expect(t.gasolina).toBe(32.18)
    expect(t.diesel).toBe(32.18)
    expect(t.vigencia).toContain('2026')
    const d = desglosa(t, t.gasolina!)
    expect(d.impuesto).toBe(0)
    expect(d.total).toBe(32.18)
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
  it('los componentes del desglose, incluidos los suplementos, suman el total', () => {
    for (const t of TARIFAS) {
      for (const precio of [t.gasolina, t.diesel]) {
        if (precio == null) continue
        const d = desglosa(t, precio)
        const extras = d.suplementos.reduce((total, s) => total + s.importe, 0)
        expect(d.base + d.impuesto + d.tasaDgt + extras).toBeCloseTo(d.total, 2)
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
      expect(t.revisada).toBe('2026-11-07')
      if (t.estado === 'verificada') expect(new URL(t.fuenteUrl!).protocol).toBe('https:')
    }
  })
  it('distingue máximos, condiciones de cilindrada y vigencias de duración limitada', () => {
    expect(porSlug('canarias').tipoPrecio).toBe('maximo')
    expect(porSlug('canarias').vigenteHasta).toBe('2027-01-31')
    expect(porSlug('pais-vasco').vigenteHasta).toBe('2026-12-31')
    expect(porSlug('andalucia').alcancePrecio).toContain('1.600')
    expect(porSlug('andalucia').condiciones).toContain('43,52')
    expect(porSlug('andalucia').condiciones).toContain('48,62')
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
