// Equivalencia entre el observatorio pre-calculado y el calculo del Worker.
//
// La agregacion vive duplicada en dos sitios que no pueden compartir codigo:
//   - scripts/lib/observatorio-precalculo.mjs  (Node, corre en GitHub Actions)
//   - src/lib/observatorio.ts                  (runtime edge, camino de respaldo)
//
// Este test es lo que hace que esa duplicacion sea segura: corre las dos sobre
// el snapshot real del repo y exige que den exactamente lo mismo. Si alguien
// toca una y se olvida de la otra, esto falla en CI y no en produccion.

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildObservatorio, observatorioFromPre } from '../src/lib/observatorio'
import { construyeObservatorio, normalizaMarca, parsePrecio } from '../scripts/lib/observatorio-precalculo.mjs'

const SNAP = resolve(__dirname, '..', 'public', 'data', 'stations.json')

describe('normalizaMarca (precalculo)', () => {
  it('unifica variantes de la misma marca', () => {
    expect(normalizaMarca('REPSOL S.A.')).toBe('Repsol')
    expect(normalizaMarca('cepsa')).toBe('Cepsa')
    expect(normalizaMarca('BONÀREA')).toBe('BonArea')
  })

  it('descarta numeros de registro, que no son marca', () => {
    expect(normalizaMarca('Nº 10.935')).toBeNull()
    expect(normalizaMarca('N 4321')).toBeNull()
    expect(normalizaMarca('12.345')).toBeNull()
    expect(normalizaMarca('   ')).toBeNull()
  })
})

describe('parsePrecio (precalculo)', () => {
  it('acepta la coma decimal del Ministerio', () => {
    expect(parsePrecio('1,619')).toBeCloseTo(1.619, 5)
  })

  it('rechaza vacios y no positivos', () => {
    expect(parsePrecio('')).toBeNull()
    expect(parsePrecio('0')).toBeNull()
    expect(parsePrecio(undefined as unknown as string)).toBeNull()
  })
})

describe('equivalencia precalculo <-> Worker', () => {
  const haySnapshot = existsSync(SNAP)

  it.runIf(haySnapshot)('produce el mismo observatorio que buildObservatorio', () => {
    const snap = JSON.parse(readFileSync(SNAP, 'utf8'))

    const referencia = buildObservatorio(snap)          // camino lento (respaldo)
    const hidratado = observatorioFromPre(construyeObservatorio(snap))  // camino rapido

    expect(referencia).not.toBeNull()
    expect(hidratado).not.toBeNull()

    expect(hidratado!.totalEstaciones).toBe(referencia!.totalEstaciones)
    expect(hidratado!.fechaMinisterio).toBe(referencia!.fechaMinisterio)

    for (const fuel of ['g95', 'diesel'] as const) {
      expect(hidratado![fuel].nacional).toBe(referencia![fuel].nacional)
      // Comparamos los arrays enteros: cubre valores, cardinalidad y ORDEN, que
      // es justo donde divergirian si cambiara un criterio de desempate.
      expect(hidratado![fuel].provincias).toEqual(referencia![fuel].provincias)
      expect(hidratado![fuel].marcas).toEqual(referencia![fuel].marcas)
    }
  })
})

describe('observatorioFromPre: validacion de entrada', () => {
  // El fichero es un asset externo: si llega corrupto la pagina debe caer al
  // calculo completo, no romperse.
  it('rechaza null y versiones desconocidas', () => {
    expect(observatorioFromPre(null)).toBeNull()
    expect(observatorioFromPre({ v: 99 })).toBeNull()
    expect(observatorioFromPre({})).toBeNull()
  })

  it('rechaza un payload al que le faltan combustibles', () => {
    expect(observatorioFromPre({ v: 1, g95: { nacional: 1.6, provincias: [], marcas: [] } })).toBeNull()
  })

  it('descarta IDs de provincia que no existen', () => {
    const out = observatorioFromPre({
      v: 1,
      totalEstaciones: 3,
      g95: {
        nacional: 1.6,
        provincias: [
          { id: '28', precio: 1.5, estaciones: 10 },
          { id: '00', precio: 1.4, estaciones: 5 },   // sin provincia -> se cae
          { id: '99', precio: 1.9, estaciones: 7 },   // inexistente  -> se cae
        ],
        marcas: [],
      },
      diesel: { nacional: 1.7, provincias: [{ id: '08', precio: 1.7, estaciones: 4 }], marcas: [] },
    })
    expect(out).not.toBeNull()
    expect(out!.g95.provincias).toHaveLength(1)
    expect(out!.g95.provincias[0].slug).toBe('madrid')
    expect(out!.diesel.provincias[0].slug).toBe('barcelona')
  })
})
