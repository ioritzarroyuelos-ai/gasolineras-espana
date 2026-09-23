import { describe, it, expect } from 'vitest'
import {
  SondeoSchema,
  EleccionFileSchema,
  IndexFileSchema,
  CandidaturaSchema,
  POLITICA_SCHEMA_VER,
} from '../src/lib/politica-schemas'

const candidatura = { id: 'pp', nombre: 'Partido Popular', siglas: 'PP', color: '#1d6fb8' }

const sondeoOk = {
  empresa: 'EM-Analytics',
  comitente: 'Electomanía',
  campoInicio: '2025-12-22',
  campoFin: '2025-12-26',
  muestra: 1782,
  datos: [
    { candidaturaId: 'pp', pct: 31.9, escanos: 133 },
    { candidaturaId: 'psoe', pct: 27.3, escanos: { min: 100, max: 103 } },
    { candidaturaId: 'cis-solo-pct', pct: 29.4, escanos: null }, // "—" no es 0
  ],
}

describe('SondeoSchema', () => {
  it('acepta un sondeo real con rango de escaños y celdas ausentes', () => {
    expect(SondeoSchema.safeParse(sondeoOk).success).toBe(true)
  })

  it('rechaza % fuera de [0,100]', () => {
    const bad = { ...sondeoOk, datos: [{ candidaturaId: 'pp', pct: 120, escanos: 10 }] }
    expect(SondeoSchema.safeParse(bad).success).toBe(false)
  })

  it('rechaza escaños no enteros', () => {
    const bad = { ...sondeoOk, datos: [{ candidaturaId: 'pp', pct: 30, escanos: 12.5 }] }
    expect(SondeoSchema.safeParse(bad).success).toBe(false)
  })

  it('rechaza un rango invertido (min>max)', () => {
    const bad = { ...sondeoOk, datos: [{ candidaturaId: 'pp', pct: 30, escanos: { min: 40, max: 10 } }] }
    expect(SondeoSchema.safeParse(bad).success).toBe(false)
  })
})

describe('CandidaturaSchema', () => {
  it('exige color hex #rrggbb', () => {
    expect(CandidaturaSchema.safeParse(candidatura).success).toBe(true)
    expect(CandidaturaSchema.safeParse({ ...candidatura, color: 'azul' }).success).toBe(false)
  })
})

describe('EleccionFileSchema', () => {
  const base = {
    schemaVer: POLITICA_SCHEMA_VER,
    id: 'generales',
    tipo: 'generales',
    ciclo: 'XV',
    camara: { nombre: 'Congreso de los Diputados', escanos: 350, mayoria: 176 },
    candidaturas: [candidatura],
    referencia: { fecha: '2023-07-23', escanos: [{ candidaturaId: 'pp', escanos: 137 }], fuente: 'infoelectoral' },
    sondeos: [sondeoOk],
    procedencia: { wiki: 'es', articulo: 'Encuestas...', url: 'https://es.wikipedia.org/...', licencia: 'CC BY-SA 4.0', obtenido: '2026-09-23' },
  }

  it('acepta un fichero de elección completo', () => {
    expect(EleccionFileSchema.safeParse(base).success).toBe(true)
  })

  it('acepta sondeos vacíos (aún no hay sondeos es legítimo)', () => {
    expect(EleccionFileSchema.safeParse({ ...base, sondeos: [] }).success).toBe(true)
  })

  it('rechaza si falta la cámara', () => {
    const { camara, ...sinCamara } = base
    expect(EleccionFileSchema.safeParse(sinCamara).success).toBe(false)
  })
})

describe('IndexFileSchema', () => {
  it('valida el índice con estados del enum', () => {
    const idx = {
      schemaVer: POLITICA_SCHEMA_VER,
      generado: '2026-09-23T00:00:00Z',
      elecciones: [
        {
          id: 'madrid',
          tipo: 'autonomica',
          nombre: 'Elecciones a la Asamblea de Madrid',
          comunidad: 'Comunidad de Madrid',
          fecha: { valor: '2027-05-23', confirmada: false },
          estado: 'ok',
          ruta: '/data/politica/autonomicas/madrid.json',
        },
      ],
    }
    expect(IndexFileSchema.safeParse(idx).success).toBe(true)
  })

  it('rechaza un estado desconocido', () => {
    const idx = {
      schemaVer: 1,
      generado: '2026-09-23',
      elecciones: [
        { id: 'x', tipo: 'generales', nombre: 'X', fecha: { valor: null, confirmada: false }, estado: 'kaputt', ruta: '/x' },
      ],
    }
    expect(IndexFileSchema.safeParse(idx).success).toBe(false)
  })
})
