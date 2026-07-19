// Equivalencia entre el observatorio pre-calculado y el calculo del Worker.
//
// La agregacion vive duplicada en dos sitios que no pueden compartir codigo:
//   - scripts/lib/observatorio-precalculo.mjs  (Node, corre en GitHub Actions)
//   - src/lib/observatorio.ts                  (runtime edge, camino de respaldo)
//
// Este test es lo que hace segura esa duplicacion: corre las dos sobre el mismo
// snapshot y exige salidas identicas. Si alguien toca una y olvida la otra,
// falla en CI y no en produccion.
//
// El snapshot es SINTETICO a proposito, no public/data/stations.json: aquel lo
// reescribe el bot dos veces al dia, asi que el test no seria reproducible, y
// leerlo obligaria a usar node:fs (el tsconfig fija types:["vite/client"], sin
// @types/node). Aqui se construyen justo los casos frontera que importan:
// umbrales de descarte, rotulos sucios y empates de precio.

import { describe, it, expect } from 'vitest'
import { buildObservatorio, observatorioFromPre, calculaVariaciones } from '../src/lib/observatorio'
import { construyeObservatorio, normalizaMarca, parsePrecio } from '../scripts/lib/observatorio-precalculo.mjs'

const G95 = 'Precio Gasolina 95 E5'
const DIESEL = 'Precio Gasoleo A'

interface EstacionFalsa {
  IDProvincia: string
  'Rótulo': string
  [k: string]: string
}

function estacion(prov: string, rotulo: string, g95: number, diesel: number): EstacionFalsa {
  const eur = (n: number) => n.toFixed(3).replace('.', ',')
  return { IDProvincia: prov, 'Rótulo': rotulo, [G95]: eur(g95), [DIESEL]: eur(diesel) }
}

// Snapshot que cubre: provincia por debajo del umbral (<3), marca por debajo del
// umbral (<40), rotulos que no son marca, y DOS provincias con la misma mediana
// para forzar el desempate por ID.
function snapshotSintetico() {
  const estaciones: EstacionFalsa[] = []

  // Madrid (28) y Barcelona (08): misma mediana exacta -> empate deliberado.
  for (let i = 0; i < 45; i++) estaciones.push(estacion('28', 'REPSOL', 1.500, 1.600))
  for (let i = 0; i < 45; i++) estaciones.push(estacion('08', 'Repsol S.A.', 1.500, 1.600))

  // Las Palmas (35): mas barata, y con marca suficiente para el ranking.
  for (let i = 0; i < 42; i++) estaciones.push(estacion('35', 'DISA MONTAÑA', 1.300, 1.350))

  // Sevilla (41): 3 estaciones justas -> entra por los pelos.
  estaciones.push(estacion('41', 'CEPSA', 1.700, 1.800))
  estaciones.push(estacion('41', 'cepsa estacion', 1.750, 1.850))
  estaciones.push(estacion('41', 'CEPSA', 1.800, 1.900))

  // Soria (42): solo 2 -> debe descartarse por debajo del umbral.
  estaciones.push(estacion('42', 'GALP', 1.900, 2.000))
  estaciones.push(estacion('42', 'GALP', 1.950, 2.050))

  // Los tres casos siguientes van a Valencia (46) y NO a Madrid: un rotulo se
  // descarta como MARCA, pero la estacion sigue contando en la mediana de su
  // PROVINCIA. Metiendolos en Madrid se desplazaba su mediana y se rompia el
  // empate con Barcelona que este snapshot quiere provocar.

  // Rotulos que NO son marca: numeros de registro. No deben salir en el ranking.
  for (let i = 0; i < 50; i++) estaciones.push(estacion('46', 'Nº 10.935', 1.550, 1.650))

  // Marca legitima pero con muy pocas estaciones -> fuera del ranking de marcas.
  estaciones.push(estacion('46', 'Gasolinera Pepe', 1.400, 1.500))

  // Precio ausente: no debe contar en ninguna mediana.
  estaciones.push({ IDProvincia: '46', 'Rótulo': 'REPSOL', [G95]: '', [DIESEL]: '' })

  return { Fecha: '18/07/2026 21:59:01', ListaEESSPrecio: estaciones }
}

describe('normalizaMarca (precalculo)', () => {
  it('unifica variantes de la misma marca', () => {
    expect(normalizaMarca('REPSOL S.A.')).toBe('Repsol')
    expect(normalizaMarca('cepsa')).toBe('Cepsa')
    expect(normalizaMarca('BONÀREA')).toBe('BonArea')
  })

  it('descarta numeros de registro, que no son marca', () => {
    expect(normalizaMarca('Nº 10.935')).toBeNull()
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
    expect(parsePrecio(undefined)).toBeNull()
  })
})

describe('equivalencia precalculo <-> Worker', () => {
  const snap = snapshotSintetico()

  it('produce exactamente el mismo observatorio que buildObservatorio', () => {
    const referencia = buildObservatorio(snap)                          // camino lento
    const hidratado = observatorioFromPre(construyeObservatorio(snap))  // camino rapido

    expect(referencia).not.toBeNull()
    expect(hidratado).not.toBeNull()
    expect(hidratado!.totalEstaciones).toBe(referencia!.totalEstaciones)
    expect(hidratado!.fechaMinisterio).toBe(referencia!.fechaMinisterio)

    for (const fuel of ['g95', 'diesel'] as const) {
      expect(hidratado![fuel].nacional).toBe(referencia![fuel].nacional)
      // Comparar los arrays enteros cubre valores, cardinalidad y ORDEN, que es
      // donde divergirian si cambiara un criterio de desempate.
      expect(hidratado![fuel].provincias).toEqual(referencia![fuel].provincias)
      expect(hidratado![fuel].marcas).toEqual(referencia![fuel].marcas)
    }
  })

  it('aplica los umbrales de descarte igual en ambos caminos', () => {
    const out = observatorioFromPre(construyeObservatorio(snap))!
    const slugs = out.g95.provincias.map(p => p.slug)
    expect(slugs).toContain('sevilla')      // 3 estaciones: entra justo
    expect(slugs).not.toContain('soria')    // 2 estaciones: fuera

    const marcas = out.g95.marcas.map(m => m.marca)
    expect(marcas).toContain('Repsol')
    expect(marcas).not.toContain('Gasolinera pepe')  // pocas estaciones
    expect(marcas.some(m => m.includes('10.935'))).toBe(false)
  })

  it('desempata por ID de provincia cuando la mediana coincide', () => {
    const out = observatorioFromPre(construyeObservatorio(snap))!
    const madrid = out.g95.provincias.findIndex(p => p.slug === 'madrid')
    const barcelona = out.g95.provincias.findIndex(p => p.slug === 'barcelona')
    expect(out.g95.provincias[madrid].precio).toBe(out.g95.provincias[barcelona].precio)
    expect(barcelona).toBeLessThan(madrid)   // 08 antes que 28
  })
})

describe('calculaVariaciones', () => {
  // Serie diaria sintetica: el precio sube de forma constante.
  function serie(desde: string, dias: number, inicial: number, incrDiario: number) {
    const filas = []
    const d = new Date(desde + 'T00:00:00Z')
    for (let i = 0; i < dias; i++) {
      const fecha = new Date(d)
      fecha.setUTCDate(fecha.getUTCDate() + i)
      const iso = fecha.toISOString().slice(0, 10)
      filas.push({ date: iso, fuel_code: '95', avg_cents: inicial + i * incrDiario })
      filas.push({ date: iso, fuel_code: 'diesel', avg_cents: inicial + 50 + i * incrDiario })
    }
    return filas
  }

  it('calcula las tres ventanas sobre una serie completa', () => {
    // 100 dias, +1 milesima/dia desde 1500. El ultimo vale 1599.
    const v = calculaVariaciones(serie('2026-04-01', 100, 1500, 1))
    expect(v.g95.map(x => x.dias)).toEqual([7, 30, 90])
    // A 7 dias: de 1592 a 1599 = +0,4%
    expect(v.g95[0].pct).toBeCloseTo(0.4, 1)
    // A 90 dias: de 1509 a 1599 = +6,0%
    expect(v.g95[2].pct).toBeCloseTo(6.0, 1)
    expect(v.diesel[2].pct).not.toBeNull()
  })

  it('devuelve null en las ventanas sin historico suficiente', () => {
    // Solo 10 dias: 30 y 90 no tienen punto de comparacion.
    const v = calculaVariaciones(serie('2026-07-01', 10, 1500, 1))
    expect(v.g95[0].pct).not.toBeNull()   // 7 dias si entra
    expect(v.g95[1].pct).toBeNull()       // 30 no
    expect(v.g95[2].pct).toBeNull()       // 90 no
  })

  it('no revienta con la serie vacia', () => {
    const v = calculaVariaciones([])
    expect(v.g95.every(x => x.pct === null)).toBe(true)
    expect(v.diesel.every(x => x.pct === null)).toBe(true)
    expect(v.generatedAt).toBeTruthy()
  })

  it('ignora combustibles que no son 95 ni diesel', () => {
    const v = calculaVariaciones([
      { date: '2026-07-01', fuel_code: 'glp', avg_cents: 900 },
      { date: '2026-07-18', fuel_code: 'glp', avg_cents: 950 },
    ])
    expect(v.g95.every(x => x.pct === null)).toBe(true)
  })
})

describe('observatorioFromPre: validacion de entrada', () => {
  // El fichero es un asset externo: si llega corrupto, la pagina debe caer al
  // calculo completo en lugar de romperse.
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
