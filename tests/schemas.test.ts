// Tests de los schemas zod que validan respuestas del Ministerio.
// Objetivo: garantizar que la defensa-en-frontera se comporta como esperamos
// ante (a) payloads correctos, (b) payloads con campos nuevos desconocidos,
// (c) payloads corruptos, y (d) intentos de DoS con arrays gigantes.

import { describe, it, expect } from 'vitest'
import {
  StationSchema,
  MinistryResponseSchema,
  MunicipioSchema,
  MunicipioListSchema,
  ProvinciaSchema,
  ProvinciaListSchema,
  safeValidate,
} from '../src/lib/schemas'

describe('StationSchema', () => {
  it('acepta un registro minimo vacio (todos los campos son opcionales)', () => {
    const r = StationSchema.safeParse({})
    expect(r.success).toBe(true)
  })

  it('acepta un registro realista del Ministerio', () => {
    const rec = {
      IDEESS: '12345',
      IDProvincia: '28',
      IDMunicipio: '28079',
      Provincia: 'MADRID',
      Municipio: 'MADRID',
      Rotulo: 'REPSOL',
      Direccion: 'CALLE ALCALA 100',
      Latitud: '40,4167',
      'Longitud (WGS84)': '-3,7036',
      'Precio Gasolina 95 E5': '1,549',
      'Precio Gasoleo A': '1,449',
    }
    const r = StationSchema.safeParse(rec)
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.Rotulo).toBe('REPSOL')
    }
  })

  it('pasa passthrough: campos extra no rompen el parseo', () => {
    const r = StationSchema.safeParse({
      IDEESS: '1',
      CampoNuevo: 'valor desconocido',
      OtroCampoFuturo: 42,
    })
    expect(r.success).toBe(true)
  })

  it('rechaza strings gigantes (DoS de memoria)', () => {
    const r = StationSchema.safeParse({ Rotulo: 'x'.repeat(500) })
    expect(r.success).toBe(false)
  })

  it('rechaza tipos incorrectos en campos conocidos', () => {
    const r = StationSchema.safeParse({ Rotulo: 123 })
    expect(r.success).toBe(false)
  })
})

describe('MinistryResponseSchema', () => {
  it('acepta respuesta canonica', () => {
    const resp = {
      Fecha: '18/04/2026 07:00:00',
      ListaEESSPrecio: [
        { IDEESS: '1', Rotulo: 'CEPSA' },
        { IDEESS: '2', Rotulo: 'BP' },
      ],
    }
    const r = MinistryResponseSchema.safeParse(resp)
    expect(r.success).toBe(true)
  })

  it('rechaza listas enormes (>20000 entradas)', () => {
    const huge = { ListaEESSPrecio: Array.from({ length: 20_001 }, () => ({ IDEESS: 'x' })) }
    const r = MinistryResponseSchema.safeParse(huge)
    expect(r.success).toBe(false)
  })

  it('rechaza si ListaEESSPrecio no es array', () => {
    const r = MinistryResponseSchema.safeParse({ ListaEESSPrecio: 'no soy array' })
    expect(r.success).toBe(false)
  })
})

describe('MunicipioSchema / MunicipioListSchema', () => {
  it('acepta un municipio valido', () => {
    const r = MunicipioSchema.safeParse({
      IDMunicipio: '28079',
      Municipio: 'MADRID',
      IDProvincia: '28',
    })
    expect(r.success).toBe(true)
  })

  it('acepta lista hasta 1500', () => {
    const list = Array.from({ length: 1500 }, (_, i) => ({
      IDMunicipio: String(i).padStart(5, '0'),
      Municipio: 'M' + i,
      IDProvincia: '28',
    }))
    const r = MunicipioListSchema.safeParse(list)
    expect(r.success).toBe(true)
  })

  it('rechaza lista de >1500', () => {
    const list = Array.from({ length: 1501 }, () => ({
      IDMunicipio: '1', Municipio: 'X', IDProvincia: '28',
    }))
    const r = MunicipioListSchema.safeParse(list)
    expect(r.success).toBe(false)
  })
})

describe('ProvinciaSchema', () => {
  it('acepta la variante con typo IDPovincia (historico del Ministerio)', () => {
    const r = ProvinciaSchema.safeParse({ IDPovincia: '28', Provincia: 'MADRID' })
    expect(r.success).toBe(true)
  })

  it('acepta la variante corregida IDProvincia', () => {
    const r = ProvinciaSchema.safeParse({ IDProvincia: '28', Provincia: 'MADRID' })
    expect(r.success).toBe(true)
  })

  it('rechaza si falta Provincia', () => {
    const r = ProvinciaSchema.safeParse({ IDProvincia: '28' })
    expect(r.success).toBe(false)
  })
})

describe('ProvinciaListSchema', () => {
  it('acepta lista de 52 provincias (real)', () => {
    const list = Array.from({ length: 52 }, (_, i) => ({
      IDProvincia: String(i + 1).padStart(2, '0'),
      Provincia: 'P' + i,
    }))
    const r = ProvinciaListSchema.safeParse(list)
    expect(r.success).toBe(true)
  })

  it('rechaza >80 provincias (alerta de payload amplificado)', () => {
    const list = Array.from({ length: 81 }, () => ({ IDProvincia: '1', Provincia: 'P' }))
    const r = ProvinciaListSchema.safeParse(list)
    expect(r.success).toBe(false)
  })
})

describe('safeValidate', () => {
  it('retorna ok:true con data en caso de exito', () => {
    const r = safeValidate(StationSchema, { IDEESS: '1', Rotulo: 'REPSOL' })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.Rotulo).toBe('REPSOL')
  })

  it('retorna ok:false con issues acotados a 5', () => {
    // 10 campos con tipo incorrecto → issues puede ser muchos
    const payload: Record<string, number> = {}
    for (let i = 0; i < 10; i++) payload['Precio Gasolina 95 E5'] = 123
    payload.IDEESS = 999 as unknown as number
    payload.Rotulo = 888 as unknown as number
    const r = safeValidate(StationSchema, payload)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(Array.isArray(r.issues)).toBe(true)
      expect(r.issues.length).toBeLessThanOrEqual(5)
      // Cada issue debe tener formato "path: mensaje"
      for (const i of r.issues) expect(i).toMatch(/:\s/)
    }
  })

  it('no lanza con inputs basura (null, undefined, string)', () => {
    expect(() => safeValidate(StationSchema, null)).not.toThrow()
    expect(() => safeValidate(StationSchema, undefined)).not.toThrow()
    expect(() => safeValidate(StationSchema, 'lolwut')).not.toThrow()
    expect(safeValidate(StationSchema, null).ok).toBe(false)
  })
})
