import { describe, it, expect } from 'vitest'
import { comparaEscanos, enlazaSondeosAnteriores, estadoEleccion } from '../src/lib/politica'
import type { Sondeo } from '../src/lib/politica-schemas'

describe('comparación de escaños', () => {
  it('distingue empates, ganancias y pérdidas, incluso si una cifra publicada es cero', () => {
    expect(comparaEscanos(5, 3)).toEqual({ tipo: 'sube', texto: '↑ Sube 2' })
    expect(comparaEscanos(0, 2)).toEqual({ tipo: 'baja', texto: '↓ Baja 2' })
    expect(comparaEscanos(0, 0)).toEqual({ tipo: 'igual', texto: '＝ Igual' })
    expect(comparaEscanos({ min: 3, max: 3 }, 3)).toEqual({ tipo: 'igual', texto: '＝ Igual' })
    expect(comparaEscanos(2, { min: 0, max: 0 })).toEqual({ tipo: 'sube', texto: '↑ Sube 2' })
  })

  it('muestra ambos extremos de la diferencia con la última elección', () => {
    expect(comparaEscanos({ min: 24, max: 26 }, 22)).toEqual({ tipo: 'sube', texto: '↑ Sube de 2 a 4' })
    expect(comparaEscanos({ min: 19, max: 21 }, 22)).toEqual({ tipo: 'baja', texto: '↓ Baja de 1 a 3' })
    expect(comparaEscanos({ min: 21, max: 24 }, 22)).toEqual({ tipo: 'solapado', texto: 'De −1 a +2' })
    expect(comparaEscanos({ min: 22, max: 24 }, 22)).toEqual({ tipo: 'solapado', texto: 'De 0 a +2' })
    expect(comparaEscanos({ min: 20, max: 22 }, 22)).toEqual({ tipo: 'solapado', texto: 'De −2 a 0' })
  })

  it('calcula en sentido inverso cuando la anterior publicó una horquilla y la actual un punto', () => {
    expect(comparaEscanos(22, { min: 24, max: 26 })).toEqual({ tipo: 'baja', texto: '↓ Baja de 2 a 4' })
    expect(comparaEscanos(22, { min: 19, max: 21 })).toEqual({ tipo: 'sube', texto: '↑ Sube de 1 a 3' })
    expect(comparaEscanos(22, { min: 21, max: 24 })).toEqual({ tipo: 'solapado', texto: 'De −2 a +1' })
  })

  it('la misma horquilla conserva incertidumbre sobre la cifra exacta', () => {
    expect(comparaEscanos({ min: 5, max: 9 }, { min: 5, max: 9 })).toEqual({ tipo: 'misma_horquilla', texto: '＝ Mismo rango' })
  })

  it('indica dirección entre horquillas sólo cuando todos sus valores lo permiten', () => {
    const anterior = { min: 5, max: 9 }
    expect(comparaEscanos({ min: 10, max: 11 }, anterior)).toEqual({ tipo: 'sube', texto: '↑ Sube' })
    expect(comparaEscanos({ min: 0, max: 4 }, anterior)).toEqual({ tipo: 'baja', texto: '↓ Baja' })
    expect(comparaEscanos({ min: 9, max: 11 }, anterior)).toEqual({ tipo: 'solapado', texto: 'Igual o sube' })
    expect(comparaEscanos({ min: 1, max: 5 }, anterior)).toEqual({ tipo: 'solapado', texto: 'Igual o baja' })
    expect(comparaEscanos({ min: 6, max: 8 }, anterior)).toEqual({ tipo: 'solapado', texto: 'Rangos solapados' })
    expect(comparaEscanos({ min: 7, max: 12 }, anterior)).toEqual({ tipo: 'solapado', texto: 'Rangos solapados' })
  })

  it('las cifras ausentes o imposibles nunca cuentan como cero', () => {
    for (const dato of [undefined, null, NaN, Infinity, -1, 1.5, { min: 10, max: 9 }, { min: -1, max: 3 }]) {
      expect(comparaEscanos(dato, 0).tipo).toBe('sin_actual')
      expect(comparaEscanos(0, dato).tipo).toBe('sin_referencia')
    }
    expect(comparaEscanos(null, null).tipo).toBe('sin_actual')
  })
})

function sondeo(campoFin: string | undefined, cambios: Partial<Sondeo> = {}): Sondeo {
  return { empresa: 'Sigma Dos', comitente: 'El Mundo', campoFin, datos: [], ...cambios }
}

describe('sondeo anterior de cada empresa y comitente', () => {
  it('ordena por fin de campo y reconoce los mismos nombres con espacios, marcas invisibles, acentos y mayúsculas', () => {
    const primero = sondeo('2026-06-01', { empresa: 'Opiñe', comitente: 'El Mundo' })
    const segundo = sondeo('2026-06-04', { empresa: ' OPIN\u0303E ', comitente: 'El\u00a0   mundo\u200b' })
    const ultimo = sondeo('2026-06-10', { empresa: 'opiñe', comitente: 'EL MUNDO', campoInicio: '2026-05-30' })
    primero.publicacion = '2026-06-15'
    const desordenados = [ultimo, primero, segundo]
    const anteriores = enlazaSondeosAnteriores(desordenados)
    expect(anteriores.get(ultimo)).toBe(segundo)
    expect(anteriores.get(segundo)).toBe(primero)
    expect(anteriores.has(primero)).toBe(false)
    expect(desordenados).toEqual([ultimo, primero, segundo])
  })

  it('usa la misma empresa y el mismo comitente de todo el archivo, aun fuera de la página visible', () => {
    const antiguo = sondeo('2024-02-29')
    const reciente = sondeo('2026-11-01')
    const otros = Array.from({ length: 80 }, (_, i) => sondeo('2026-10-30', { comitente: 'Otro medio ' + i }))
    const otraEmpresa = sondeo('2026-10-31', { empresa: 'Otra empresa' })
    const anteriores = enlazaSondeosAnteriores([reciente, ...otros, otraEmpresa, antiguo])
    expect(anteriores.get(reciente)).toBe(antiguo)
    expect(anteriores.size).toBe(1)
  })

  it('ante dos posibles anteriores del mismo día, evita elegir una o saltar a una más antigua', () => {
    const uno = sondeo('2026-10-01')
    const dosA = sondeo('2026-10-02', { publicacion: '2026-10-03' })
    const dosB = sondeo('2026-10-02', { publicacion: '2026-10-04' })
    const tres = sondeo('2026-10-03')
    const cuatro = sondeo('2026-10-04')
    const anteriores = enlazaSondeosAnteriores([cuatro, dosB, tres, uno, dosA])
    expect(anteriores.get(dosA)).toBe(uno)
    expect(anteriores.get(dosB)).toBe(uno)
    expect(anteriores.has(tres)).toBe(false)
    expect(anteriores.get(cuatro)).toBe(tres)
  })

  it('requiere empresa, comitente conocido y fin de campo válido', () => {
    const incompletos = [
      sondeo(undefined, { campoInicio: '2026-10-03', publicacion: '2026-10-04' }),
      sondeo('2026-02-29'), sondeo('2026-04-31'), sondeo('2026-10'),
      sondeo('2026-10-03', { comitente: undefined }), sondeo('2026-10-04', { comitente: '\u200b ' }),
      sondeo('2026-10-03', { empresa: ' ' }), sondeo('2026-10-04', { empresa: '\u200b' }),
    ]
    const primero = sondeo('2026-02-01'), ultimo = sondeo('2026-11-01')
    const anteriores = enlazaSondeosAnteriores([primero, ...incompletos, ultimo])
    expect(anteriores.size).toBe(1)
    expect(anteriores.get(ultimo)).toBe(primero)
  })

  it('conserva el anterior inmediato aunque ese sondeo no haya publicado escaños para el partido', () => {
    const antiguo = sondeo('2026-09-01', { datos: [{ candidaturaId: 'a', escanos: 3, pct: null }] })
    const anterior = sondeo('2026-10-01', { datos: [{ candidaturaId: 'a', escanos: null, pct: 5 }] })
    const actual = sondeo('2026-11-01', { datos: [{ candidaturaId: 'a', escanos: 0, pct: null }] })
    const porSondeo = enlazaSondeosAnteriores([actual, anterior, antiguo])
    expect(porSondeo.get(actual)).toBe(anterior)
    expect(comparaEscanos(actual.datos[0].escanos, porSondeo.get(actual)?.datos[0].escanos).tipo).toBe('sin_referencia')
  })
})

describe('estadoEleccion', () => {
  const ahora = '2026-09-23T12:00:00Z'

  it('fresco con sondeos -> ok', () => {
    expect(estadoEleccion({ tieneSondeos: true, ultimaComprobacionOk: '2026-09-23T06:00:00Z' }, ahora)).toBe('ok')
  })

  it('fresco sin sondeos -> sin_sondeos', () => {
    expect(estadoEleccion({ tieneSondeos: false, ultimaComprobacionOk: '2026-09-23T06:00:00Z' }, ahora)).toBe('sin_sondeos')
  })

  it('última comprobación > 30h -> desactualizado', () => {
    expect(estadoEleccion({ tieneSondeos: true, ultimaComprobacionOk: '2026-09-22T00:00:00Z' }, ahora)).toBe('desactualizado')
  })

  it('marcado no disponible -> no_disponible (aunque no tenga sondeos)', () => {
    expect(estadoEleccion({ disponible: false, tieneSondeos: false, ultimaComprobacionOk: '2026-09-23T06:00:00Z' }, ahora)).toBe('no_disponible')
  })
})
