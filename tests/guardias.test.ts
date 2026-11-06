import { describe, it, expect } from 'vitest'
import { frescuraGuardia, GUARDIA_STALE_HORAS, parseGuardias, estadoGuardia, fuenteGuardia } from '../src/lib/guardias'
import { buildGuardiaMunicipioPage } from '../src/html/guardia-municipio'

// Fecha de referencia fija para que los tests no dependan del reloj.
const AHORA = new Date('2026-09-04T12:00:00Z')

describe('frescuraGuardia', () => {
  it('respeta la medianoche local y rechaza fechas futuras', () => {
    const now = new Date('2026-11-03T23:30:00Z')
    expect(frescuraGuardia('2026-11-03T23:05:00Z', now).fecha).toBe('2026-11-04')
    expect(frescuraGuardia('2026-11-03T23:05:00Z', now, 'Atlantic/Canary').fecha).toBe('2026-11-03')
    expect(frescuraGuardia('2026-11-05T00:00:00Z', now).fiable).toBe(false)
  })
  it('capturado hoy: fiable y esHoy', () => {
    const f = frescuraGuardia('2026-09-04T06:00:00Z', AHORA)
    expect(f.fiable).toBe(true)
    expect(f.esHoy).toBe(true)
    expect(f.fecha).toBe('2026-09-04')
  })

  it('capturado ayer de madrugada, dentro de 30 h: fiable pero NO esHoy', () => {
    // Robot corre a las 06:00 UTC; a las 12:00 del dia siguiente son 30 h justas.
    const f = frescuraGuardia('2026-09-03T06:00:00Z', AHORA)
    expect(f.horas).toBeCloseTo(30, 5)
    expect(f.fiable).toBe(true)      // 30 <= 30
    expect(f.esHoy).toBe(false)      // fecha de captura = ayer
    expect(f.fecha).toBe('2026-09-03')
  })

  it('pasadas mas de 30 h (se salto un pase): NO fiable', () => {
    const f = frescuraGuardia('2026-09-03T05:59:00Z', AHORA)
    expect(f.horas).toBeGreaterThan(GUARDIA_STALE_HORAS)
    expect(f.fiable).toBe(false)
    expect(f.esHoy).toBe(false)
  })

  it('territorio viejo de hace meses: NO fiable', () => {
    const f = frescuraGuardia('2026-04-25T20:59:42.303Z', AHORA)
    expect(f.fiable).toBe(false)
    expect(f.esHoy).toBe(false)
    expect(f.fecha).toBe('2026-04-25')
  })

  it('sin ts o ts invalido: NO fiable, horas Infinity', () => {
    for (const bad of [undefined, '', 'no-es-fecha']) {
      const f = frescuraGuardia(bad as string | undefined, AHORA)
      expect(f.fiable).toBe(false)
      expect(f.esHoy).toBe(false)
      expect(f.horas).toBe(Infinity)
      expect(f.fecha).toBe('')
    }
  })

  it('el margen de 30 h cubre el hueco nocturno sin apagar la pagina', () => {
    // Dato capturado ayer 06:00; visita de madrugada de hoy (03:00), antes del
    // pase diario. Debe seguir siendo fiable (no apagon), aunque no sea "hoy".
    const madrugada = new Date('2026-09-04T03:00:00Z')
    const f = frescuraGuardia('2026-09-03T06:00:00Z', madrugada)
    expect(f.horas).toBeCloseTo(21, 5)
    expect(f.fiable).toBe(true)
    expect(f.esHoy).toBe(false)
  })
})

describe('turnos comprobables y coordenadas oficiales', () => {
  const date = '2026-11-03T08:00:00Z'
  const ahora = new Date('2026-11-03T23:30:00Z')
  const turno = parseGuardias({ territorio: 'madrid', ts: date, guardias: [[40.4,-3.7,'Farmacia A','Madrid','','','2026-11-03 09:30-2026-11-04 09:30','']] }, ahora)[0]
  it('reconoce el turno nocturno de 24 h y deja de marcarlo al finalizar', () => {
    expect(estadoGuardia(turno, date, ahora)).toEqual({ conocida: true, abierta: true, todoElDia: true })
    expect(estadoGuardia(turno, date, new Date('2026-11-04T08:30:00Z')).abierta).toBe(false)
    expect(estadoGuardia(turno, '2026-10-01T08:00:00Z', ahora).abierta).toBe(false)
  })
  it('no inventa apertura para horarios dudosos, iguales, libres o guardias localizadas', () => {
    for (const horario of ['', '24 horas', '2026-11-03 09:00-2026-11-03 09:00']) expect(estadoGuardia({ ...turno, horario }, date, ahora).conocida).toBe(false)
    expect(estadoGuardia({ ...turno, horarioDesc: 'Guardia localizada' }, date, ahora).abierta).toBe(false)
    expect(estadoGuardia({ ...turno, horarioDesc: 'Guardia no presencial' }, date, ahora).abierta).toBe(false)
  })
  it('solo usa coordenadas identificadas por el generador como oficiales', () => {
    const guardias = [[40.4,-3.7,'A','Madrid'],[0,0,'B','Madrid'],[200,-3.7,'C','Madrid']]
    expect(parseGuardias({ guardias }).every(g => !g.coordenadasFiables)).toBe(true)
    expect(parseGuardias({ guardias, coordenadasOficiales: true }).map(g => g.coordenadasFiables)).toEqual([true,false,false])
  })
  it('Almería muestra el aviso en todos y lo excluye de abierta ahora', () => {
    const dudosa = { ...turno, direccion: 'FICHA DUDOSA', horario: '', horarioDesc: 'Horario por confirmar: llama antes de acudir' }
    const data = { provinciaSlug: 'almeria', provinciaName: 'Almería', municipioSlug: 'almeria', municipioName: 'Almería', guardias: [turno,dudosa], otrosMunicipios: [], actualizado: date, canonical: 'https://example.test/farmacias/almeria/almeria', ahora }
    expect(buildGuardiaMunicipioPage('nonce', data)).toContain('FICHA DUDOSA')
    const filtrada = buildGuardiaMunicipioPage('nonce', { ...data, turno: 'ahora' })
    expect(filtrada).not.toContain('FICHA DUDOSA')
    expect(filtrada).toContain('Farmacia A')
    expect(filtrada).toContain('https://www.cofalmeria.com/buscador-de-farmacias/')
  })
  it('conserva la alternativa oficial al caducar los datos y rechaza enlaces inseguros', () => {
    expect(fuenteGuardia('madrid', { sourceUrl: 'javascript:alert(1)' })).toBe('https://www.cofm.es/es/buscador-de-farmacias/')
    expect(fuenteGuardia('burgos', { sourceUrl: 'javascript:alert(1)' })).toBe(null)
    const html = buildGuardiaMunicipioPage('nonce', { provinciaSlug: 'avila', provinciaName: 'Ávila', municipioSlug: 'avila', municipioName: 'Ávila', guardias: [turno], otrosMunicipios: [], actualizado: '2026-01-01', canonical: 'https://example.test/farmacias/avila/avila', ahora })
    expect(html).toContain('Consultar la fuente oficial')
    expect(html).not.toContain('Farmacia A')
    expect(html).not.toContain('mapa de farmacias')
  })
})

// Regresion: el parser sigue devolviendo los campos posicionales tal cual.
describe('parseGuardias (regresion)', () => {
  it('mapea el array posicional a objeto', () => {
    const rows = parseGuardias({
      ts: '2026-09-04T06:00:00Z',
      guardias: [[40.4, -3.7, 'CALLE X, 1', 'MADRID', '910000000', '28001',
        '2026-09-04 09:30-2026-09-04 23:00', 'Guardia de hoy 09:30 – 23:00']],
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].municipio).toBe('MADRID')
    expect(rows[0].telefono).toBe('910000000')
    expect(rows[0].horarioDesc).toContain('Guardia de hoy')
  })
})
