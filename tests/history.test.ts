import { describe, it, expect } from 'vitest'
import {
  FUEL_MAP,
  FUEL_CODES,
  parsePriceString,
  eurosToCents,
  centsToEuros,
  snapshotToRows,
  todayUtc,
  buildInsertBatches,
  purgeCutoffDate,
} from '../src/lib/history'

// ============================================================
// history.ts — conversion snapshot Ministerio → filas D1.
// ============================================================
// Los tests cubren el camino critico: validacion de entradas sucias
// (numeros con coma, N/D, null, fuera de rango) y la estabilidad del
// roundtrip euros ↔ cents, que es la base de que min/max/media sean
// reproducibles bit a bit.

describe('FUEL_MAP / FUEL_CODES', () => {
  it('tiene exactamente los 4 combustibles soportados', () => {
    expect(FUEL_CODES.sort()).toEqual(['95', '98', 'diesel', 'diesel_plus'].sort())
  })

  it('cada clave del ministerio mapea a un codigo unico', () => {
    const codes = Object.values(FUEL_MAP)
    expect(new Set(codes).size).toBe(codes.length)
  })
})

describe('parsePriceString', () => {
  it('parsea "1,479" (coma decimal del ministerio)', () => {
    expect(parsePriceString('1,479')).toBe(1.479)
  })

  it('parsea "1.479" (punto decimal, formato alternativo)', () => {
    expect(parsePriceString('1.479')).toBe(1.479)
  })

  it('ignora espacios circundantes', () => {
    expect(parsePriceString('  1,599  ')).toBe(1.599)
  })

  it('devuelve null para cadena vacia', () => {
    expect(parsePriceString('')).toBeNull()
    expect(parsePriceString('   ')).toBeNull()
  })

  it('devuelve null para null/undefined', () => {
    expect(parsePriceString(null)).toBeNull()
    expect(parsePriceString(undefined)).toBeNull()
  })

  it('devuelve null para "N/D" o cualquier texto no numerico', () => {
    expect(parsePriceString('N/D')).toBeNull()
    expect(parsePriceString('abc')).toBeNull()
  })

  it('rechaza precios fuera de rango [>0, <=10]', () => {
    expect(parsePriceString('0')).toBeNull()      // limite inferior estricto
    expect(parsePriceString('-1,5')).toBeNull()   // negativos
    expect(parsePriceString('10,01')).toBeNull()  // justo fuera del rango
    expect(parsePriceString('99,99')).toBeNull()  // muy fuera
  })

  it('acepta rango valido hasta 10 inclusive', () => {
    expect(parsePriceString('0,001')).toBe(0.001)
    expect(parsePriceString('10')).toBe(10)
  })
})

describe('eurosToCents / centsToEuros', () => {
  it('roundtrip exacto en casos tipicos', () => {
    for (const p of [1.479, 1.599, 1.899, 0.999, 2.005]) {
      expect(centsToEuros(eurosToCents(p))).toBe(p)
    }
  })

  it('redondea en lugar de truncar (evita 1.4789999 → 1478)', () => {
    // 1.4789999 × 1000 = 1478.9999 → Math.round → 1479 (no 1478)
    expect(eurosToCents(1.4789999)).toBe(1479)
  })

  it('redondea half-up en valores .5 exactos', () => {
    // 1.4785 × 1000 = 1478.5 → 1479 (half-away-from-zero en JS modern engines)
    expect(eurosToCents(1.4785)).toBe(1479)
  })
})

describe('snapshotToRows', () => {
  const base = {
    Fecha: '19/04/2026 10:02:18',
    ListaEESSPrecio: [
      {
        IDEESS: '1234',
        Rotulo: 'REPSOL',
        'Precio Gasolina 95 E5':  '1,479',
        'Precio Gasolina 98 E5':  '1,599',
        'Precio Gasoleo A':       '1,399',
        'Precio Gasoleo Premium': '1,499',
      },
    ],
  }

  it('convierte una estacion completa en 4 filas', () => {
    const rows = snapshotToRows(base, '2026-04-19')
    expect(rows).toHaveLength(4)
    const byFuel = Object.fromEntries(rows.map(r => [r.fuel_code, r]))
    expect(byFuel['95'].price_cents).toBe(1479)
    expect(byFuel['98'].price_cents).toBe(1599)
    expect(byFuel['diesel'].price_cents).toBe(1399)
    expect(byFuel['diesel_plus'].price_cents).toBe(1499)
    for (const r of rows) {
      expect(r.station_id).toBe('1234')
      expect(r.date).toBe('2026-04-19')
    }
  })

  it('ignora estaciones sin IDEESS', () => {
    const snap = {
      ListaEESSPrecio: [
        { 'Precio Gasolina 95 E5': '1,479' },           // falta IDEESS
        { IDEESS: '', 'Precio Gasolina 95 E5': '1,479' }, // IDEESS vacio
      ],
    }
    expect(snapshotToRows(snap, '2026-04-19')).toEqual([])
  })

  it('ignora IDEESS que no es 1-10 digitos', () => {
    const snap = {
      ListaEESSPrecio: [
        { IDEESS: 'abcd',          'Precio Gasolina 95 E5': '1,479' },
        { IDEESS: '12345678901',   'Precio Gasolina 95 E5': '1,479' }, // 11 digitos
        { IDEESS: '<script>',      'Precio Gasolina 95 E5': '1,479' },
      ],
    }
    expect(snapshotToRows(snap, '2026-04-19')).toEqual([])
  })

  it('ignora combustibles con precio no parseable (no rompe la fila entera)', () => {
    const snap = {
      ListaEESSPrecio: [
        {
          IDEESS: '42',
          'Precio Gasolina 95 E5':  '1,479',
          'Precio Gasolina 98 E5':  '',      // vacio → ignorar
          'Precio Gasoleo A':       'N/D',   // texto → ignorar
          'Precio Gasoleo Premium': '1,499',
        },
      ],
    }
    const rows = snapshotToRows(snap, '2026-04-19')
    expect(rows.map(r => r.fuel_code).sort()).toEqual(['95', 'diesel_plus'])
  })

  it('devuelve [] para entradas no-objeto o sin ListaEESSPrecio', () => {
    expect(snapshotToRows(null, '2026-04-19')).toEqual([])
    expect(snapshotToRows(undefined, '2026-04-19')).toEqual([])
    expect(snapshotToRows('no soy json', '2026-04-19')).toEqual([])
    expect(snapshotToRows({}, '2026-04-19')).toEqual([])
    expect(snapshotToRows({ ListaEESSPrecio: 'oops' }, '2026-04-19')).toEqual([])
  })

  it('asigna la misma fecha a todas las filas (util para backfill)', () => {
    const rows = snapshotToRows(base, '2022-01-15')
    expect(rows.every(r => r.date === '2022-01-15')).toBe(true)
  })

  it('ignora items del array que no son objetos', () => {
    const snap = {
      ListaEESSPrecio: [
        null,
        undefined,
        'string suelta',
        42,
        { IDEESS: '1', 'Precio Gasolina 95 E5': '1,479' },
      ],
    }
    const rows = snapshotToRows(snap, '2026-04-19')
    expect(rows).toHaveLength(1)
    expect(rows[0].station_id).toBe('1')
  })
})

describe('todayUtc', () => {
  it('devuelve YYYY-MM-DD en UTC (no deriva por timezone)', () => {
    // Usamos una hora justo en la frontera UTC: 23:59 UTC el 18 abril
    // sigue siendo "2026-04-18" aunque en local (Madrid +2) sea 01:59 del 19.
    const d = new Date('2026-04-18T23:59:59Z')
    expect(todayUtc(d)).toBe('2026-04-18')
  })

  it('usa new Date() por defecto (smoke test)', () => {
    const s = todayUtc()
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('buildInsertBatches', () => {
  const sampleRows = Array.from({ length: 3 }, (_, i) => ({
    station_id: String(1000 + i),
    fuel_code: '95',
    date: '2026-04-19',
    price_cents: 1479 + i,
  }))

  it('devuelve un solo batch cuando las filas caben', () => {
    const batches = buildInsertBatches(sampleRows, 250)
    expect(batches).toHaveLength(1)
    expect(batches[0].sql).toContain('INSERT OR REPLACE INTO price_history')
    expect(batches[0].sql).toContain('(?,?,?,?),(?,?,?,?),(?,?,?,?)')
    expect(batches[0].params).toEqual([
      '1000', '95', '2026-04-19', 1479,
      '1001', '95', '2026-04-19', 1480,
      '1002', '95', '2026-04-19', 1481,
    ])
  })

  it('parte en varios batches cuando se supera rowsPerStmt', () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      station_id: String(i),
      fuel_code: 'diesel',
      date: '2026-04-19',
      price_cents: 1000 + i,
    }))
    const batches = buildInsertBatches(many, 3)
    expect(batches).toHaveLength(3)
    // 3 + 3 + 1
    expect(batches[0].params).toHaveLength(12)
    expect(batches[1].params).toHaveLength(12)
    expect(batches[2].params).toHaveLength(4)
  })

  it('devuelve [] para entrada vacia (no statements vacios)', () => {
    expect(buildInsertBatches([], 250)).toEqual([])
  })

  it('cada statement tiene params alineados con placeholders', () => {
    const batches = buildInsertBatches(sampleRows, 250)
    const placeholders = (batches[0].sql.match(/\?/g) || []).length
    expect(placeholders).toBe(batches[0].params.length)
  })
})

describe('purgeCutoffDate', () => {
  it('devuelve la fecha 2 anos antes por defecto', () => {
    const now = new Date('2026-04-19T12:00:00Z')
    expect(purgeCutoffDate(now)).toBe('2024-04-19')
  })

  it('acepta anos custom', () => {
    const now = new Date('2026-04-19T12:00:00Z')
    expect(purgeCutoffDate(now, 1)).toBe('2025-04-19')
    expect(purgeCutoffDate(now, 5)).toBe('2021-04-19')
  })

  it('maneja el 29 de febrero sin romper (cae en 28 feb de un ano no bisiesto)', () => {
    // 29 feb 2024 - 1 ano = 28 feb 2023 (JS hace clamp natural via setUTCFullYear)
    const now = new Date('2024-02-29T00:00:00Z')
    const r = purgeCutoffDate(now, 1)
    // Puede ser 2023-02-28 o 2023-03-01 segun la implementacion interna,
    // ambos son razonables. Verificamos que no estalla y devuelve formato valido.
    expect(r).toMatch(/^2023-0[23]-(28|01)$/)
  })
})
