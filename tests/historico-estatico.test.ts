// Historico estatico incremental: el bot anade un dia a los ficheros de
// public/data/history y el Worker los rehidrata. Este test junta las dos mitades,
// que no pueden compartir codigo (Node en GitHub Actions vs runtime edge):
//
//   - scripts/lib/historico-estatico.mjs  escribe series dedupeadas (solo cambios)
//   - src/lib/history.ts                  hydrateDedupe() las expande a un punto por dia
//
// La prueba central es de ida y vuelta: se simulan N dias de fotos, se aplican
// una a una, y lo que hydrateDedupe() reconstruye tiene que ser EXACTAMENTE la
// verdad dia a dia. Si alguien cambia el dedupe sin cambiar la rehidratacion (o
// al reves), falla aqui y no en las graficas de produccion.
//
// Los snapshots son sinteticos: el tsconfig no trae @types/node y el fichero
// real lo reescribe el bot dos veces al dia.

import { describe, it, expect } from 'vitest'
import { hydrateDedupe, snapshotToRows } from '../src/lib/history'
import {
  filasSnapshot, anadePunto, medianaInferior,
  anadeDiaProvincia, anadeDiaMediana, anadeDiaNacional,
  aplicaSnapshot, construyeIndex,
  type EstadoHistorico, type FicheroProvincia, type FicheroMediana, type FicheroNacional, type Punto,
} from '../scripts/lib/historico-estatico.mjs'

const G95 = 'Precio Gasolina 95 E5'
const G98 = 'Precio Gasolina 98 E5'
const DIESEL = 'Precio Gasoleo A'

interface EstacionFalsa {
  IDEESS: string
  IDProvincia?: string
  [k: string]: string | undefined
}

// Precio en formato Ministerio ("1,479") a partir de centimos-milesimas.
function eur(cents: number): string {
  return (cents / 1000).toFixed(3).replace('.', ',')
}

function estacion(id: string, prov: string | undefined, precios: Record<string, number | undefined>): EstacionFalsa {
  const s: EstacionFalsa = { IDEESS: id }
  if (prov !== undefined) s.IDProvincia = prov
  for (const [k, v] of Object.entries(precios)) if (v != null) s[k] = eur(v)
  return s
}

function foto(estaciones: EstacionFalsa[]) {
  return { Fecha: '01/01/2026 0:00:00', ListaEESSPrecio: estaciones }
}

const AHORA = new Date('2026-09-04T12:00:00Z')

function estadoVacio(): EstadoHistorico {
  return { provincias: new Map(), medianas: new Map(), nacional: null }
}

// Dias consecutivos desde `desde` (YYYY-MM-DD).
function dias(desde: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(desde + 'T00:00:00Z')
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

describe('filasSnapshot', () => {
  it('filtra igual que snapshotToRows (IDEESS valido, precio parseable, con o sin provincia)', () => {
    const snap = foto([
      estacion('1', '28', { [G95]: 1500, [DIESEL]: 1400 }),
      estacion('2', undefined, { [G95]: 1600 }),          // sin provincia: cuenta para la media nacional
      estacion('abc', '28', { [G95]: 1700 }),             // IDEESS invalido: fuera
      estacion('3', '08', { [G95]: undefined, [G98]: 1650 }),
    ])
    const filas = filasSnapshot(snap)
    const esperadas = snapshotToRows(snap, '2026-05-01')
    expect(filas.length).toBe(esperadas.length)
    for (let i = 0; i < filas.length; i++) {
      expect(filas[i].station_id).toBe(esperadas[i].station_id)
      expect(filas[i].fuel_code).toBe(esperadas[i].fuel_code)
      expect(filas[i].cents).toBe(esperadas[i].price_cents)
    }
    expect(filas.find(f => f.station_id === '2')!.provincia).toBeNull()
    expect(filas.find(f => f.station_id === '3')!.provincia).toBe('08')
  })

  it('rellena la provincia a dos digitos', () => {
    const filas = filasSnapshot(foto([estacion('1', '8', { [G95]: 1500 })]))
    expect(filas[0].provincia).toBe('08')
  })

  it('devuelve [] para entradas sin lista', () => {
    expect(filasSnapshot(null)).toEqual([])
    expect(filasSnapshot({})).toEqual([])
    expect(filasSnapshot({ ListaEESSPrecio: 'no' })).toEqual([])
  })
})

describe('anadePunto', () => {
  it('crea el primer punto', () => {
    expect(anadePunto([], '2026-05-01', 1500)).toEqual([['2026-05-01', 1500]])
  })

  it('no anade nada si el precio no cambia', () => {
    const s: Punto[] = [['2026-05-01', 1500]]
    expect(anadePunto(s, '2026-05-02', 1500)).toEqual([['2026-05-01', 1500]])
  })

  it('anade cuando cambia', () => {
    const s: Punto[] = [['2026-05-01', 1500]]
    expect(anadePunto(s, '2026-05-02', 1510)).toEqual([['2026-05-01', 1500], ['2026-05-02', 1510]])
  })

  it('la segunda foto del mismo dia sustituye a la primera', () => {
    const manana = anadePunto([['2026-05-01', 1500]], '2026-05-02', 1510)
    const tarde = anadePunto(manana, '2026-05-02', 1520)
    expect(tarde).toEqual([['2026-05-01', 1500], ['2026-05-02', 1520]])
    // Y si por la tarde vuelve al precio de ayer, el punto de hoy desaparece.
    expect(anadePunto(manana, '2026-05-02', 1500)).toEqual([['2026-05-01', 1500]])
  })

  it('retira el marcador final heredado del backfill (ultimo igual al penultimo)', () => {
    const heredada: Punto[] = [['2026-04-20', 1480], ['2026-04-25', 1480]]
    expect(anadePunto(heredada, '2026-05-01', 1480)).toEqual([['2026-04-20', 1480]])
    expect(anadePunto(heredada, '2026-05-01', 1500)).toEqual([['2026-04-20', 1480], ['2026-05-01', 1500]])
  })

  it('no muta la serie de entrada', () => {
    const s: Punto[] = [['2026-05-01', 1500]]
    anadePunto(s, '2026-05-02', 1510)
    expect(s).toEqual([['2026-05-01', 1500]])
  })
})

describe('medianaInferior', () => {
  it('usa el elemento central por indice, como el endpoint provincial sobre D1', () => {
    // Regla del Worker: arr.sort(); arr[Math.floor(arr.length / 2)]
    expect(medianaInferior([1600, 1500, 1520, 1510])).toBe(1520)
    expect(medianaInferior([1600, 1500, 1520])).toBe(1520)
    expect(medianaInferior([7])).toBe(7)
    expect(medianaInferior([])).toBeNull()
  })
})

describe('ida y vuelta con hydrateDedupe', () => {
  // Verdad dia a dia por estacion (undefined = ese dia no aparece en la foto).
  const DIAS = dias('2026-05-01', 10)
  const verdad: Record<string, Array<number | undefined>> = {
    '11': [1500, 1500, 1510, 1510, 1510, undefined, 1510, 1490, 1490, 1490],
    '22': [undefined, undefined, undefined, 1600, 1600, 1620, 1620, 1620, 1600, 1600],
    '33': [1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450, 1450],
  }

  function aplicaTodo(inicial: EstadoHistorico): EstadoHistorico {
    let estado = inicial
    DIAS.forEach((fecha, i) => {
      const lista: EstacionFalsa[] = []
      for (const [id, precios] of Object.entries(verdad)) {
        const p = precios[i]
        if (p != null) lista.push(estacion(id, '28', { [G95]: p }))
      }
      estado = aplicaSnapshot(estado, foto(lista), fecha, AHORA).estado
    })
    return estado
  }

  // Lo que el Worker debe pintar: el ultimo precio conocido hasta ese dia.
  function esperado(precios: Array<number | undefined>): Array<{ date: string; price: number }> {
    const out: Array<{ date: string; price: number }> = []
    let ultimo: number | null = null
    DIAS.forEach((fecha, i) => {
      if (precios[i] != null) ultimo = precios[i]!
      if (ultimo != null) out.push({ date: fecha, price: ultimo / 1000 })
    })
    return out
  }

  it('rehidratar las series reconstruye exactamente la verdad dia a dia', () => {
    const fichero = aplicaTodo(estadoVacio()).provincias.get('28')!
    expect(fichero.from).toBe(DIAS[0])
    expect(fichero.to).toBe(DIAS[DIAS.length - 1])
    expect(fichero.days).toBe(10)
    for (const [id, precios] of Object.entries(verdad)) {
      const serie = fichero.stations[id]['95']
      expect(hydrateDedupe(serie, fichero.from, fichero.to)).toEqual(esperado(precios))
    }
    // Y de verdad esta dedupeado: C no cambia nunca -> un solo punto.
    expect(fichero.stations['33']['95']).toEqual([['2026-05-01', 1450]])
  })

  it('sobre un fichero heredado del backfill conserva lo antiguo y empalma sin salto', () => {
    const heredado: FicheroProvincia = {
      v: 1, provincia_id: '28', from: '2025-04-26', to: '2026-04-25', days: 365,
      generated_at: '2026-04-26T10:30:00Z',
      stations: {
        '11': { '95': [['2025-04-26', 1480], ['2026-04-25', 1480]] },   // con marcador final
        '99': { '95': [['2025-04-26', 1700], ['2025-12-01', 1710], ['2026-04-25', 1710]] }, // cerrada: no vuelve a salir
      },
    }
    const inicial: EstadoHistorico = { provincias: new Map([['28', heredado]]), medianas: new Map(), nacional: null }
    const fichero = aplicaTodo(inicial).provincias.get('28')!

    expect(fichero.from).toBe('2025-04-26')       // nunca avanza
    expect(fichero.to).toBe('2026-05-10')
    // 11: el marcador de abril desaparece y el 1 de mayo empieza el precio nuevo.
    expect(fichero.stations['11']['95'].slice(0, 2)).toEqual([['2025-04-26', 1480], ['2026-05-01', 1500]])
    const hidratadaA = hydrateDedupe(fichero.stations['11']['95'], '2026-04-24', '2026-05-02')
    expect(hidratadaA).toEqual([
      { date: '2026-04-24', price: 1.48 }, { date: '2026-04-25', price: 1.48 },
      { date: '2026-04-26', price: 1.48 }, { date: '2026-04-27', price: 1.48 },
      { date: '2026-04-28', price: 1.48 }, { date: '2026-04-29', price: 1.48 },
      { date: '2026-04-30', price: 1.48 }, { date: '2026-05-01', price: 1.5 },
      { date: '2026-05-02', price: 1.5 },
    ])
    // 99 no aparece en ninguna foto nueva: su serie queda intacta.
    expect(fichero.stations['99']['95']).toEqual(heredado.stations['99']['95'])
  })

  it('aplicar dos veces el mismo dia deja el resultado de la segunda foto', () => {
    const d = '2026-05-01'
    const e1 = aplicaSnapshot(estadoVacio(), foto([estacion('11', '28', { [G95]: 1500 })]), d, AHORA).estado
    const e2 = aplicaSnapshot(e1, foto([estacion('11', '28', { [G95]: 1530 })]), d, AHORA).estado
    expect(e2.provincias.get('28')!.stations['11']['95']).toEqual([[d, 1530]])
    expect(e2.medianas.get('28')!.median['95']).toEqual([[d, 1530]])
    expect(e2.nacional!.series['95']).toEqual([[d, 1530, 1]])
  })

  it('rechaza un dia anterior al ultimo guardado (no recorta nada)', () => {
    const e1 = aplicaSnapshot(estadoVacio(), foto([estacion('11', '28', { [G95]: 1500 })]), '2026-05-02', AHORA).estado
    expect(() => aplicaSnapshot(e1, foto([estacion('11', '28', { [G95]: 1400 })]), '2026-05-01', AHORA))
      .toThrow(/anterior al ultimo dia guardado/)
    expect(() => anadeDiaProvincia(e1.provincias.get('28')!, '28', [], '2026-5-1')).toThrow(/fecha invalida/)
  })
})

describe('anadeDiaMediana', () => {
  it('un punto por dia y combustible, con la misma mediana que el Worker', () => {
    const filas = filasSnapshot(foto([
      estacion('1', '28', { [G95]: 1500, [DIESEL]: 1400 }),
      estacion('2', '28', { [G95]: 1520, [DIESEL]: 1380 }),
      estacion('3', '28', { [G95]: 1510 }),
      estacion('4', '28', { [G95]: 1600 }),
    ]))
    const f = anadeDiaMediana(null, '28', filas, '2026-05-01', AHORA)
    expect(f.median['95']).toEqual([['2026-05-01', 1520]])
    expect(f.median['diesel']).toEqual([['2026-05-01', 1400]])
    expect(f.median['98']).toBeUndefined()
    expect(f.to).toBe('2026-05-01')
    const f2 = anadeDiaMediana(f, '28', filasSnapshot(foto([estacion('1', '28', { [G95]: 1490 })])), '2026-05-02', AHORA)
    expect(f2.median['95']).toEqual([['2026-05-01', 1520], ['2026-05-02', 1490]])
    expect(f2.median['diesel']).toEqual([['2026-05-01', 1400]])   // sin dato ese dia: no se inventa
    expect(f2.from).toBe('2026-05-01')
  })

  it('conserva un fichero heredado y le anade el dia nuevo', () => {
    const heredado: FicheroMediana = {
      v: 1, provincia_id: '28', from: '2025-04-26', to: '2026-04-25', days: 365, generated_at: 'x',
      median: { '95': [['2026-04-24', 1500], ['2026-04-25', 1505]] },
    }
    const f = anadeDiaMediana(heredado, '28', filasSnapshot(foto([estacion('1', '28', { [G95]: 1510 })])), '2026-05-01', AHORA)
    expect(f.median['95']).toEqual([['2026-04-24', 1500], ['2026-04-25', 1505], ['2026-05-01', 1510]])
    expect(f.from).toBe('2025-04-26')
    expect(f.days).toBe(371)
  })
})

describe('anadeDiaNacional', () => {
  it('media y muestra coinciden con AVG/COUNT sobre las filas de snapshotToRows', () => {
    const snap = foto([
      estacion('1', '28', { [G95]: 1500, [DIESEL]: 1400 }),
      estacion('2', undefined, { [G95]: 1601 }),           // sin provincia: cuenta igual (D1 la contaba)
      estacion('3', '08', { [G95]: 1510, [DIESEL]: 1390 }),
      estacion('zz', '08', { [G95]: 9999 }),                // IDEESS invalido: fuera
    ])
    const f = anadeDiaNacional(null, filasSnapshot(snap), '2026-05-01', AHORA)
    const rows = snapshotToRows(snap, '2026-05-01')
    for (const fuel of ['95', 'diesel']) {
      const cents = rows.filter(r => r.fuel_code === fuel).map(r => r.price_cents)
      const avg = cents.reduce((a, b) => a + b, 0) / cents.length
      const [fecha, media, n] = f.series[fuel][0]
      expect(fecha).toBe('2026-05-01')
      expect(n).toBe(cents.length)
      expect(Math.abs(media - avg)).toBeLessThan(0.001)
    }
    expect(f.series['95'][0][2]).toBe(3)
    expect(f.series['98']).toBeUndefined()
  })

  it('acumula dias sin borrar los anteriores', () => {
    let f: FicheroNacional | null = null
    for (const d of dias('2026-05-01', 200)) {
      f = anadeDiaNacional(f, filasSnapshot(foto([estacion('1', '28', { [G95]: 1500 })])), d, AHORA)
    }
    expect(f!.series['95'].length).toBe(200)
    expect(f!.from).toBe('2026-05-01')
    expect(f!.to).toBe('2026-11-16')
    expect(f!.days).toBe(200)
  })
})

describe('aplicaSnapshot / construyeIndex', () => {
  it('crea los ficheros que faltan y no toca las provincias ausentes en la foto', () => {
    const e1 = aplicaSnapshot(estadoVacio(), foto([
      estacion('1', '28', { [G95]: 1500 }),
      estacion('2', '08', { [G95]: 1600 }),
    ]), '2026-05-01', AHORA)
    expect(e1.resumen).toEqual({ fecha: '2026-05-01', filas: 2, provincias: 2 })
    const e2 = aplicaSnapshot(e1.estado, foto([estacion('1', '28', { [G95]: 1510 })]), '2026-05-02', AHORA)
    expect(e2.estado.provincias.get('28')!.to).toBe('2026-05-02')
    expect(e2.estado.provincias.get('08')!.to).toBe('2026-05-01')   // sin datos: no avanza
    expect(e2.estado.provincias.get('08')).toBe(e1.estado.provincias.get('08'))
    const idx = construyeIndex(e2.estado, AHORA)
    expect(idx.provinces).toEqual(['08', '28'])
    expect(idx.to).toBe('2026-05-01')       // el menor: hasta cuando esta TODO
    expect(idx.from).toBe('2026-05-01')
    expect(idx.nacional).toEqual({ from: '2026-05-01', to: '2026-05-02' })
    expect(idx.generated_at).toBe(AHORA.toISOString())
  })

  it('rechaza una foto sin precios', () => {
    expect(() => aplicaSnapshot(estadoVacio(), foto([]), '2026-05-01', AHORA)).toThrow(/ningun precio valido/)
  })

  it('no muta el estado de entrada', () => {
    const e0 = estadoVacio()
    aplicaSnapshot(e0, foto([estacion('1', '28', { [G95]: 1500 })]), '2026-05-01', AHORA)
    expect(e0.provincias.size).toBe(0)
    expect(e0.nacional).toBeNull()
  })
})
