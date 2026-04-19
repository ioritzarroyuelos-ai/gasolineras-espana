import { describe, it, expect } from 'vitest'
import {
  LRU,
  validateId,
  isValidProvinciaId,
  sanitizeGeocodeQuery,
  sanitizeLatLng,
  originAllowed,
  haversineKm,
  median,
  isOpenNow,
  SlidingWindowLimiter,
  estimateMonthly,
  tokensEqualConstTime,
  classifyPriceVsCycle,
  netSavings,
  perpDistanceKm,
  stationsInCorridor,
  computeL100km,
  diaryStats,
} from '../src/lib/pure'

describe('LRU', () => {
  it('respeta el tope de tamaño evictando el mas antiguo', () => {
    const c = new LRU<number>(3)
    c.set('a', { data: 1, ts: 1 })
    c.set('b', { data: 2, ts: 2 })
    c.set('c', { data: 3, ts: 3 })
    c.set('d', { data: 4, ts: 4 })
    expect(c.size).toBe(3)
    expect(c.get('a')).toBeUndefined()
    expect(c.get('d')?.data).toBe(4)
  })

  it('refresca el orden al leer (LRU real, no FIFO)', () => {
    const c = new LRU<number>(2)
    c.set('a', { data: 1, ts: 1 })
    c.set('b', { data: 2, ts: 2 })
    c.get('a') // a pasa a ser mas reciente
    c.set('c', { data: 3, ts: 3 })
    expect(c.get('a')?.data).toBe(1) // sigue vivo
    expect(c.get('b')).toBeUndefined() // b fue desalojado
  })

  it('sobreescribir una key no aumenta el tamaño', () => {
    const c = new LRU<number>(2)
    c.set('a', { data: 1, ts: 1 })
    c.set('a', { data: 2, ts: 2 })
    expect(c.size).toBe(1)
    expect(c.get('a')?.data).toBe(2)
  })
})

describe('validateId', () => {
  it('acepta ids numericos de 1-5 digitos', () => {
    expect(validateId('1')).toBe('1')
    expect(validateId('42')).toBe('42')
    expect(validateId('28001')).toBe('28001')
  })
  it('rechaza intentos de path-traversal y no-numericos', () => {
    expect(validateId('../admin')).toBeNull()
    expect(validateId('28001/../secret')).toBeNull()
    expect(validateId('28a01')).toBeNull()
    expect(validateId('')).toBeNull()
    expect(validateId(undefined)).toBeNull()
    expect(validateId('1234567')).toBeNull() // mas de 5 digitos
  })
})

describe('isValidProvinciaId', () => {
  it('acepta los 52 codigos INE validos', () => {
    expect(isValidProvinciaId('01')).toBe(true)
    expect(isValidProvinciaId('28')).toBe(true)  // Madrid
    expect(isValidProvinciaId('08')).toBe(true)  // Barcelona
    expect(isValidProvinciaId('52')).toBe(true)  // Melilla
  })
  it('rechaza codigos fuera de rango (bloquea amplificacion DoS)', () => {
    expect(isValidProvinciaId('00')).toBe(false)
    expect(isValidProvinciaId('53')).toBe(false)
    expect(isValidProvinciaId('99')).toBe(false)
    expect(isValidProvinciaId('99999')).toBe(false)
    expect(isValidProvinciaId('1')).toBe(false)    // sin zero-pad
    expect(isValidProvinciaId('28 ')).toBe(false)  // con espacios
    expect(isValidProvinciaId(null)).toBe(false)
    expect(isValidProvinciaId(undefined)).toBe(false)
    expect(isValidProvinciaId('')).toBe(false)
  })
})

describe('sanitizeGeocodeQuery', () => {
  it('acepta queries espanolas tipicas', () => {
    expect(sanitizeGeocodeQuery('Calle Mayor, Madrid')).toBe('Calle Mayor, Madrid')
    expect(sanitizeGeocodeQuery("O'Donnell")).toBe("O'Donnell")
    expect(sanitizeGeocodeQuery('Carrer de l\'Hospital')).toBe("Carrer de l'Hospital")
    expect(sanitizeGeocodeQuery('Cádiz')).toBe('Cádiz')
    expect(sanitizeGeocodeQuery('  foo   bar  ')).toBe('foo bar')  // colapsa whitespace
  })
  it('rechaza entradas peligrosas o vacias', () => {
    expect(sanitizeGeocodeQuery('')).toBeNull()
    expect(sanitizeGeocodeQuery('  ')).toBeNull()                    // solo whitespace
    expect(sanitizeGeocodeQuery('a')).toBeNull()                     // <2 chars utiles
    expect(sanitizeGeocodeQuery(null)).toBeNull()
    expect(sanitizeGeocodeQuery(undefined)).toBeNull()
    expect(sanitizeGeocodeQuery('a'.repeat(121))).toBeNull()         // >120 chars
    expect(sanitizeGeocodeQuery('foo\x00bar')).toBeNull()            // control char
    expect(sanitizeGeocodeQuery('foo<script>')).toBeNull()           // HTML-ish
    expect(sanitizeGeocodeQuery('foo`cmd`')).toBeNull()              // backtick
    expect(sanitizeGeocodeQuery('foo\\bar')).toBeNull()              // backslash
  })
})

describe('sanitizeLatLng', () => {
  it('formatea lat/lng validos a 6 decimales (estable para cache key)', () => {
    expect(sanitizeLatLng('40.4168', '-3.7038')).toEqual({ lat: '40.416800', lng: '-3.703800' })
    expect(sanitizeLatLng('40.41689999999', '-3.70380001')).toEqual({ lat: '40.416900', lng: '-3.703800' })
    expect(sanitizeLatLng('0', '0')).toEqual({ lat: '0.000000', lng: '0.000000' })
  })
  it('rechaza valores no finitos o fuera de rango', () => {
    expect(sanitizeLatLng('91', '0')).toBeNull()         // lat > 90
    expect(sanitizeLatLng('-91', '0')).toBeNull()
    expect(sanitizeLatLng('0', '181')).toBeNull()        // lng > 180
    expect(sanitizeLatLng('0', '-181')).toBeNull()
    expect(sanitizeLatLng('NaN', '0')).toBeNull()
    expect(sanitizeLatLng('foo', 'bar')).toBeNull()
    expect(sanitizeLatLng(null, '0')).toBeNull()
    expect(sanitizeLatLng('0', undefined)).toBeNull()
    expect(sanitizeLatLng('Infinity', '0')).toBeNull()
  })
})

describe('originAllowed', () => {
  const allow = new Set(['https://gasolineras.pages.dev'])
  it('permite mismo host', () => {
    expect(originAllowed('https://my.app', 'my.app', allow)).toBe(true)
  })
  it('permite origenes en whitelist', () => {
    expect(originAllowed('https://gasolineras.pages.dev', 'x', allow)).toBe(true)
  })
  it('permite previews de Cloudflare Pages', () => {
    expect(originAllowed('https://abc123.gasolineras.pages.dev', 'x', allow)).toBe(true)
  })
  it('permite requests sin Origin (same-origin, curl)', () => {
    expect(originAllowed('', 'x', allow)).toBe(true)
    expect(originAllowed(undefined, 'x', allow)).toBe(true)
  })
  it('rechaza origenes cross-site arbitrarios', () => {
    expect(originAllowed('https://evil.com', 'x', allow)).toBe(false)
    expect(originAllowed('https://gasolineras.pages.dev.evil.com', 'x', allow)).toBe(false)
  })
  it('permite localhost y 127.0.0.1', () => {
    expect(originAllowed('http://localhost:5173', 'localhost:5173', allow)).toBe(true)
    expect(originAllowed('http://127.0.0.1:5173', '127.0.0.1:5173', allow)).toBe(true)
  })
  it('no revienta con Origin malformada', () => {
    expect(originAllowed('not-a-url', 'x', allow)).toBe(false)
  })
})

describe('haversineKm', () => {
  it('distancia 0 consigo mismo', () => {
    expect(haversineKm(40.4, -3.7, 40.4, -3.7)).toBeCloseTo(0, 5)
  })
  it('Madrid-Barcelona ~ 504 km (tolerancia ±10 km)', () => {
    const d = haversineKm(40.4168, -3.7038, 41.3851, 2.1734)
    expect(d).toBeGreaterThan(494)
    expect(d).toBeLessThan(514)
  })
})

describe('median', () => {
  it('mediana impar', () => { expect(median([1, 3, 2])).toBe(2) })
  it('mediana par', () => { expect(median([1, 2, 3, 4])).toBe(2.5) })
  it('ignora NaN/Infinity', () => { expect(median([1, 2, NaN, Infinity, 3])).toBe(2) })
  it('array vacio', () => { expect(median([])).toBeNaN() })
})

describe('isOpenNow', () => {
  it('24H → siempre abierto', () => {
    expect(isOpenNow('L-D 24H')).toBe(true)
  })
  it('L-V 08:00-20:00 a martes 10:00 → abierto', () => {
    const tuesday10 = new Date(2026, 3, 14, 10, 0, 0) // martes 14 abril 2026
    expect(isOpenNow('L-V 08:00-20:00', tuesday10)).toBe(true)
  })
  it('L-V 08:00-20:00 a domingo → cerrado', () => {
    const sunday = new Date(2026, 3, 19, 10, 0, 0) // domingo 19 abril 2026
    expect(isOpenNow('L-V 08:00-20:00', sunday)).toBe(false)
  })
  it('L-V 08:00-20:00 a lunes 21:00 → cerrado', () => {
    const monday21 = new Date(2026, 3, 13, 21, 0, 0)
    expect(isOpenNow('L-V 08:00-20:00', monday21)).toBe(false)
  })
  it('sin horario → null', () => {
    expect(isOpenNow(undefined)).toBeNull()
    expect(isOpenNow('')).toBeNull()
  })
  it('horario partido L-V 07:00-13:00 Y 16:00-20:00', () => {
    const mon12 = new Date(2026, 3, 13, 12, 0, 0)
    const mon14 = new Date(2026, 3, 13, 14, 0, 0)
    const mon17 = new Date(2026, 3, 13, 17, 0, 0)
    expect(isOpenNow('L-V 07:00-13:00 Y 16:00-20:00', mon12)).toBe(true)
    expect(isOpenNow('L-V 07:00-13:00 Y 16:00-20:00', mon14)).toBe(false)
    expect(isOpenNow('L-V 07:00-13:00 Y 16:00-20:00', mon17)).toBe(true)
  })
})

describe('SlidingWindowLimiter', () => {
  it('permite hasta el limite y bloquea despues', () => {
    const rl = new SlidingWindowLimiter(3, 60_000)
    const ip = '1.2.3.4'
    expect(rl.check(ip, 1000).allowed).toBe(true)
    expect(rl.check(ip, 1100).allowed).toBe(true)
    expect(rl.check(ip, 1200).allowed).toBe(true)
    const blocked = rl.check(ip, 1300)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfterSec).toBeGreaterThan(0)
  })
  it('olvida hits fuera de la ventana', () => {
    const rl = new SlidingWindowLimiter(2, 1_000)
    rl.check('x', 0)
    rl.check('x', 500)
    expect(rl.check('x', 999).allowed).toBe(false)
    expect(rl.check('x', 2000).allowed).toBe(true)
  })
  it('cuenta por clave independiente', () => {
    const rl = new SlidingWindowLimiter(1, 60_000)
    expect(rl.check('a', 1).allowed).toBe(true)
    expect(rl.check('b', 1).allowed).toBe(true)
    expect(rl.check('a', 2).allowed).toBe(false)
  })
})

describe('estimateMonthly (widget GASTO ESTIMADO MENSUAL)', () => {
  // Reproduce EXACTAMENTE la captura: 50 L de deposito, "100 € / mes", "2 repostajes/mes aprox".
  // Defaults del onboarding: km=1000 (chip), consumo=6.5 (input range value).
  // Precio mediano habitual de gasolina 95 en Espana ~1.55 €/L (17/04/2026).
  it('reproduce la captura: 1000 km/mes, 6.5 L/100km, mediana 1,549 €/L, deposito 50 L → 100 € / 2 repostajes', () => {
    const r = estimateMonthly({
      kmPerMonth: 1000,
      consumoL100km: 6.5,
      medianPriceEurL: 1.549,
      tankL: 50,
    })
    expect(r).not.toBeNull()
    if (!r) return
    // litros = (1000/100) * 6.5 = 65
    expect(r.litersPerMonth).toBeCloseTo(65, 10)
    // cost = 65 * 1.549 = 100.685  → toFixed(0) = "100"
    expect(r.costEur).toBeCloseTo(100.685, 3)
    expect(r.costEur.toFixed(0)).toBe('101')       // sin redondeo a la baja
    // Math.round(100.685) = 101, pero el widget usa toFixed(0) que tambien redondea a 101.
    // La captura muestra "100 €" → eso implica que la mediana vista fue mas baja (~1,538)
    // o que el usuario vio otro combustible. Comprobemos coherencia matematica:
    const r2 = estimateMonthly({ kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 1.538, tankL: 50 })
    expect(r2!.costEur.toFixed(0)).toBe('100')     // 99.97 → "100"
    // repostajes = ceil(65/50) = 2
    expect(r.refuelsPerMonth).toBe(2)
  })

  it('cambiar tank reduce/aumenta repostajes pero no el coste', () => {
    const base = { kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 1.55 }
    const smallTank = estimateMonthly({ ...base, tankL: 30 })!
    const bigTank   = estimateMonthly({ ...base, tankL: 80 })!
    expect(smallTank.costEur).toBeCloseTo(bigTank.costEur, 6)   // mismo coste
    expect(smallTank.refuelsPerMonth).toBe(3)                    // ceil(65/30)=3
    expect(bigTank.refuelsPerMonth).toBe(1)                      // ceil(65/80)=1
  })

  it('escala linealmente con km', () => {
    const r500  = estimateMonthly({ kmPerMonth: 500,  consumoL100km: 6.5, medianPriceEurL: 1.55, tankL: 50 })!
    const r1000 = estimateMonthly({ kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 1.55, tankL: 50 })!
    const r2500 = estimateMonthly({ kmPerMonth: 2500, consumoL100km: 6.5, medianPriceEurL: 1.55, tankL: 50 })!
    expect(r1000.costEur).toBeCloseTo(2 * r500.costEur, 6)
    expect(r2500.costEur).toBeCloseTo(5 * r500.costEur, 6)
  })

  it('coche tragon: 1500 km a 10L/100km con diesel 1,45 €/L', () => {
    const r = estimateMonthly({
      kmPerMonth: 1500, consumoL100km: 10, medianPriceEurL: 1.45, tankL: 60,
    })!
    // litros = 15 * 10 = 150
    expect(r.litersPerMonth).toBe(150)
    // cost = 150 * 1.45 = 217.5 → "218"
    expect(r.costEur).toBeCloseTo(217.5, 6)
    // repostajes = ceil(150/60) = 3
    expect(r.refuelsPerMonth).toBe(3)
  })

  it('calcula ahorro potencial si topPrice < mediana', () => {
    const r = estimateMonthly({
      kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 1.55, tankL: 50,
      topPriceEurL: 1.40,  // 15 centimos mas barato
    })!
    // saving = (1.55 - 1.40) * 65 = 0.15 * 65 = 9.75
    expect(r.savingEur).toBeCloseTo(9.75, 6)
  })

  it('no da ahorro si el top no es mejor que la mediana', () => {
    const r = estimateMonthly({
      kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 1.55, tankL: 50,
      topPriceEurL: 1.60,  // mas caro
    })!
    expect(r.savingEur).toBe(0)
  })

  it('devuelve null ante inputs invalidos (fail-safe, no NaN en la UI)', () => {
    expect(estimateMonthly({ kmPerMonth: 0,    consumoL100km: 6.5, medianPriceEurL: 1.5, tankL: 50 })).toBeNull()
    expect(estimateMonthly({ kmPerMonth: 1000, consumoL100km: 0,   medianPriceEurL: 1.5, tankL: 50 })).toBeNull()
    expect(estimateMonthly({ kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 0,   tankL: 50 })).toBeNull()
    expect(estimateMonthly({ kmPerMonth: 1000, consumoL100km: 6.5, medianPriceEurL: 1.5, tankL: 0  })).toBeNull()
    expect(estimateMonthly({ kmPerMonth: NaN,  consumoL100km: 6.5, medianPriceEurL: 1.5, tankL: 50 })).toBeNull()
  })
})

describe('tokensEqualConstTime', () => {
  it('devuelve true solo cuando ambas cadenas coinciden exactamente', () => {
    expect(tokensEqualConstTime('abc123', 'abc123')).toBe(true)
    expect(tokensEqualConstTime('', '')).toBe(true)
    expect(tokensEqualConstTime('secret-token-xyz', 'secret-token-xyz')).toBe(true)
  })

  it('rechaza cualquier diferencia (primer, ultimo, intermedio, case)', () => {
    expect(tokensEqualConstTime('abc', 'abd')).toBe(false)       // ultimo
    expect(tokensEqualConstTime('abc', 'xbc')).toBe(false)       // primer
    expect(tokensEqualConstTime('abcd', 'aXcd')).toBe(false)     // intermedio
    expect(tokensEqualConstTime('Token', 'token')).toBe(false)   // case-sensitive
  })

  it('rechaza cadenas de distinta longitud sin tirar excepcion', () => {
    expect(tokensEqualConstTime('short', 'longer-string')).toBe(false)
    expect(tokensEqualConstTime('', 'x')).toBe(false)
    expect(tokensEqualConstTime('x', '')).toBe(false)
  })

  it('rechaza inputs no-string (defensa ante undefined/header ausente)', () => {
    // @ts-expect-error - probamos deliberadamente tipos invalidos
    expect(tokensEqualConstTime(undefined, 'x')).toBe(false)
    // @ts-expect-error
    expect(tokensEqualConstTime('x', undefined)).toBe(false)
    // @ts-expect-error
    expect(tokensEqualConstTime(null, null)).toBe(false)
    // @ts-expect-error
    expect(tokensEqualConstTime(123, '123')).toBe(false)
  })
})

describe('classifyPriceVsCycle (predictor semanal)', () => {
  it('buy_now cuando el precio actual es el mas bajo de la serie', () => {
    const r = classifyPriceVsCycle({
      currentEurL: 1.40,
      weekdaySamples: [1.55, 1.52, 1.50, 1.48, 1.45, 1.60, 1.58, 1.50],
    })
    expect(r).not.toBeNull()
    expect(r!.verdict).toBe('buy_now')
    expect(r!.percentile).toBeLessThanOrEqual(25)
    expect(r!.sampleCount).toBe(8)
    expect(r!.confidence).toBe('high')
  })

  it('wait cuando el precio esta en el top 25% de caros', () => {
    const r = classifyPriceVsCycle({
      currentEurL: 1.70,
      weekdaySamples: [1.50, 1.52, 1.48, 1.55, 1.60, 1.58, 1.62, 1.65],
    })
    expect(r).not.toBeNull()
    expect(r!.verdict).toBe('wait')
    expect(r!.percentile).toBeGreaterThanOrEqual(75)
  })

  it('neutral cuando el precio esta en el rango medio', () => {
    const r = classifyPriceVsCycle({
      currentEurL: 1.55,
      weekdaySamples: [1.45, 1.48, 1.50, 1.55, 1.60, 1.62, 1.65, 1.70],
    })
    expect(r).not.toBeNull()
    expect(r!.verdict).toBe('neutral')
  })

  it('confidence escala con el numero de muestras', () => {
    const fewSamples = classifyPriceVsCycle({
      currentEurL: 1.50,
      weekdaySamples: [1.50, 1.55],
    })
    expect(fewSamples!.confidence).toBe('low')

    const midSamples = classifyPriceVsCycle({
      currentEurL: 1.50,
      weekdaySamples: [1.50, 1.55, 1.48, 1.52, 1.60],
    })
    expect(midSamples!.confidence).toBe('mid')

    const highSamples = classifyPriceVsCycle({
      currentEurL: 1.50,
      weekdaySamples: [1.50, 1.55, 1.48, 1.52, 1.60, 1.45, 1.58, 1.62, 1.50],
    })
    expect(highSamples!.confidence).toBe('high')
  })

  it('devuelve null si no hay muestras validas', () => {
    expect(classifyPriceVsCycle({ currentEurL: 1.50, weekdaySamples: [] })).toBeNull()
    expect(classifyPriceVsCycle({ currentEurL: 1.50, weekdaySamples: [NaN, 0, -1] })).toBeNull()
  })

  it('devuelve null si el precio actual es invalido', () => {
    expect(classifyPriceVsCycle({ currentEurL: 0, weekdaySamples: [1.5] })).toBeNull()
    expect(classifyPriceVsCycle({ currentEurL: -1, weekdaySamples: [1.5] })).toBeNull()
    expect(classifyPriceVsCycle({ currentEurL: NaN, weekdaySamples: [1.5] })).toBeNull()
  })

  it('ignora muestras invalidas sin romper el calculo', () => {
    const r = classifyPriceVsCycle({
      currentEurL: 1.50,
      weekdaySamples: [1.45, NaN, 1.55, 0, 1.50, -1, Infinity],
    })
    expect(r).not.toBeNull()
    expect(r!.sampleCount).toBe(3)  // solo 1.45, 1.55, 1.50 son validos
  })

  it('tipicalEurL es coherente con la mediana de las muestras', () => {
    const r = classifyPriceVsCycle({
      currentEurL: 1.50,
      weekdaySamples: [1.40, 1.45, 1.50, 1.55, 1.60],
    })
    expect(r!.tipicalEurL).toBeCloseTo(1.50, 3)
  })
})

describe('netSavings (ahorro neto con coste de desvio)', () => {
  it('resta correctamente el coste del desvio', () => {
    // 20 km extra con 6.5 L/100km a 1.50 €/L = 1.95 €
    const r = netSavings({
      grossSavingsEur: 5.00,
      extraKm: 20,
      consumoL100km: 6.5,
      fuelPriceEurL: 1.50,
    })
    expect(r.detourCostEur).toBeCloseTo(1.95, 3)
    expect(r.netEur).toBeCloseTo(3.05, 3)
    expect(r.worthIt).toBe(true)
  })

  it('marca worthIt=false si el neto no supera 0.50 €', () => {
    const r = netSavings({
      grossSavingsEur: 2.00,
      extraKm: 20,
      consumoL100km: 6.5,
      fuelPriceEurL: 1.50,
    })
    // 2.00 - 1.95 = 0.05, por debajo del umbral
    expect(r.netEur).toBeCloseTo(0.05, 3)
    expect(r.worthIt).toBe(false)
  })

  it('neto negativo cuando el desvio supera el ahorro bruto', () => {
    const r = netSavings({
      grossSavingsEur: 1.00,
      extraKm: 30,
      consumoL100km: 7,
      fuelPriceEurL: 1.60,
    })
    // desvio = 0.30 * 7 * 1.60 = 3.36
    expect(r.detourCostEur).toBeCloseTo(3.36, 3)
    expect(r.netEur).toBeCloseTo(-2.36, 3)
    expect(r.worthIt).toBe(false)
  })

  it('sin desvio el neto es igual al bruto', () => {
    const r = netSavings({
      grossSavingsEur: 4.00,
      extraKm: 0,
      consumoL100km: 6.5,
      fuelPriceEurL: 1.50,
    })
    expect(r.detourCostEur).toBe(0)
    expect(r.netEur).toBe(4.00)
    expect(r.worthIt).toBe(true)
  })

  it('trata valores invalidos como 0 (fail-safe, nunca NaN)', () => {
    const r = netSavings({
      grossSavingsEur: 3.00,
      extraKm: NaN,
      consumoL100km: -1,
      fuelPriceEurL: 0,
    })
    expect(r.detourCostEur).toBe(0)
    expect(r.netEur).toBe(3.00)
  })
})

describe('perpDistanceKm (distancia al segmento)', () => {
  // Madrid → Barcelona
  const madrid = { lat: 40.4168, lng: -3.7038 }
  const barcelona = { lat: 41.3851, lng: 2.1734 }

  it('distancia 0 si el punto esta en el segmento', () => {
    const mid = { lat: (madrid.lat + barcelona.lat) / 2, lng: (madrid.lng + barcelona.lng) / 2 }
    expect(perpDistanceKm(mid, madrid, barcelona)).toBeLessThan(1)
  })

  it('distancia > 0 si el punto esta lejos del segmento', () => {
    // Sevilla, muy al sur de la linea Madrid-Barcelona
    const sevilla = { lat: 37.3891, lng: -5.9845 }
    const d = perpDistanceKm(sevilla, madrid, barcelona)
    expect(d).toBeGreaterThan(100)
  })

  it('se cierra en los extremos si la proyeccion cae fuera del segmento', () => {
    // Un punto muy al oeste de Madrid: la "proyeccion" caeria antes de A,
    // pero la funcion debe devolver la distancia directa a Madrid.
    const puntoOeste = { lat: 40.4168, lng: -9.0 }
    const d = perpDistanceKm(puntoOeste, madrid, barcelona)
    const expected = haversineKm(puntoOeste.lat, puntoOeste.lng, madrid.lat, madrid.lng)
    // La proyeccion equirectangular acumula error proporcional a la distancia:
    // ~0.7% a 500+ km desde el centro del segmento. Toleramos 2% para este caso.
    const relErr = Math.abs(d - expected) / expected
    expect(relErr).toBeLessThan(0.02)
  })

  it('origen = destino → distancia euclidea al punto', () => {
    const p = { lat: 40.5, lng: -3.5 }
    const d = perpDistanceKm(p, madrid, madrid)
    const expected = haversineKm(p.lat, p.lng, madrid.lat, madrid.lng)
    expect(d).toBeCloseTo(expected, 0)
  })

  it('simetrico: A→B vs B→A da misma distancia', () => {
    const p = { lat: 41.0, lng: -1.0 }
    const d1 = perpDistanceKm(p, madrid, barcelona)
    const d2 = perpDistanceKm(p, barcelona, madrid)
    expect(d1).toBeCloseTo(d2, 6)
  })
})

describe('stationsInCorridor (filtrar gasolineras en trayecto)', () => {
  const madrid = { lat: 40.4168, lng: -3.7038 }
  const barcelona = { lat: 41.3851, lng: 2.1734 }

  type S = { id: string; lat: number; lng: number; price: number | null }
  const extract = (s: S) => ({ lat: s.lat, lng: s.lng, priceEurL: s.price })

  it('devuelve solo las estaciones dentro del ancho del corredor', () => {
    const stations: S[] = [
      { id: 'near1',  lat: 41.0,    lng: -1.0,    price: 1.50 },
      { id: 'near2',  lat: 41.2,    lng: 0.0,     price: 1.48 },
      { id: 'far',    lat: 37.3891, lng: -5.9845, price: 1.40 },  // Sevilla, fuera
    ]
    const r = stationsInCorridor(stations, madrid, barcelona, 50, extract, 5)
    expect(r.length).toBe(2)
    expect(r.map(x => x.item.id).sort()).toEqual(['near1', 'near2'])
  })

  it('ordena por precio ascendente (la mas barata primero)', () => {
    const stations: S[] = [
      { id: 'cara',   lat: 41.0, lng: -1.0, price: 1.80 },
      { id: 'barata', lat: 41.1, lng: -0.5, price: 1.30 },
      { id: 'media',  lat: 41.0, lng: 0.0,  price: 1.50 },
    ]
    const r = stationsInCorridor(stations, madrid, barcelona, 100, extract, 5)
    expect(r.map(x => x.item.id)).toEqual(['barata', 'media', 'cara'])
  })

  it('desempata por distancia al corredor cuando el precio coincide', () => {
    const stations: S[] = [
      { id: 'lejos', lat: 40.0, lng: -3.0, price: 1.50 },
      { id: 'cerca', lat: 40.5, lng: -3.0, price: 1.50 },
    ]
    const r = stationsInCorridor(stations, madrid, barcelona, 100, extract, 5)
    expect(r[0].item.id).toBe('cerca')
    expect(r[0].offKm).toBeLessThan(r[1].offKm)
  })

  it('limita a topN resultados', () => {
    const stations: S[] = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`, lat: 41.0, lng: -1.0 + i * 0.1, price: 1.50 + i * 0.01,
    }))
    const r = stationsInCorridor(stations, madrid, barcelona, 200, extract, 5)
    expect(r.length).toBeLessThanOrEqual(5)
  })

  it('ignora estaciones sin precio', () => {
    const stations: S[] = [
      { id: 'sin-precio', lat: 41.0, lng: -1.0, price: null },
      { id: 'con-precio', lat: 41.0, lng: -1.0, price: 1.50 },
    ]
    const r = stationsInCorridor(stations, madrid, barcelona, 100, extract, 5)
    expect(r.length).toBe(1)
    expect(r[0].item.id).toBe('con-precio')
  })

  it('devuelve array vacio si widthKm es invalido', () => {
    const stations: S[] = [{ id: 'x', lat: 41.0, lng: -1.0, price: 1.50 }]
    expect(stationsInCorridor(stations, madrid, barcelona, 0, extract, 5)).toEqual([])
    expect(stationsInCorridor(stations, madrid, barcelona, -1, extract, 5)).toEqual([])
    expect(stationsInCorridor(stations, madrid, barcelona, NaN, extract, 5)).toEqual([])
  })
})

describe('computeL100km (consumo real por intervalo)', () => {
  it('calcula consumo correcto para un intervalo tipico', () => {
    // 40 L repostados tras recorrer 600 km → 6.67 L/100km
    expect(computeL100km(40, 12600, 12000)).toBeCloseTo(6.667, 2)
  })

  it('funciona con consumo alto', () => {
    // SUV tragon: 80 L / 800 km = 10 L/100km
    expect(computeL100km(80, 800, 0)).toBe(10)
  })

  it('devuelve null si no hay lectura previa valida (primer repostaje)', () => {
    expect(computeL100km(40, 12000, NaN)).toBeNull()
  })

  it('devuelve null si delta de km es 0 o negativo', () => {
    expect(computeL100km(40, 12000, 12000)).toBeNull()
    expect(computeL100km(40, 12000, 12500)).toBeNull()  // odometro retrocedido
  })

  it('devuelve null con litros invalidos', () => {
    expect(computeL100km(0, 12600, 12000)).toBeNull()
    expect(computeL100km(-5, 12600, 12000)).toBeNull()
    expect(computeL100km(NaN, 12600, 12000)).toBeNull()
  })
})

describe('diaryStats (estadisticas del diario de repostajes)', () => {
  it('agrega totales y medias de un diario tipico', () => {
    const entries = [
      { date: '2026-01-10', litros: 50, eurPerLitre: 1.50, kmTotales: 10000 },
      { date: '2026-02-05', litros: 45, eurPerLitre: 1.45, kmTotales: 10600 },
      { date: '2026-03-01', litros: 48, eurPerLitre: 1.55, kmTotales: 11300 },
    ]
    const s = diaryStats(entries)
    expect(s.entries).toBe(3)
    expect(s.totalLiters).toBe(143)
    // 50*1.50 + 45*1.45 + 48*1.55 = 75 + 65.25 + 74.40 = 214.65
    expect(s.totalSpentEur).toBeCloseTo(214.65, 2)
    // media €/L = (1.50 + 1.45 + 1.55) / 3 = 1.50
    expect(s.avgEurPerLitre).toBeCloseTo(1.50, 3)
    // km recorridos = 11300 - 10000 = 1300
    expect(s.totalKm).toBe(1300)
    // consumo: (45 + 48) litros / (1300/100) = 93/13 = 7.154 L/100km
    expect(s.avgL100km).toBeCloseTo(7.154, 2)
  })

  it('devuelve zeros y nulls con array vacio', () => {
    const s = diaryStats([])
    expect(s.entries).toBe(0)
    expect(s.totalLiters).toBe(0)
    expect(s.totalSpentEur).toBe(0)
    expect(s.avgEurPerLitre).toBeNull()
    expect(s.totalKm).toBe(0)
    expect(s.avgL100km).toBeNull()
  })

  it('con una sola entrada: sin consumo calculable (falta baseline)', () => {
    const s = diaryStats([
      { date: '2026-01-10', litros: 50, eurPerLitre: 1.50, kmTotales: 10000 },
    ])
    expect(s.entries).toBe(1)
    expect(s.totalLiters).toBe(50)
    expect(s.totalSpentEur).toBeCloseTo(75, 3)
    expect(s.avgEurPerLitre).toBeCloseTo(1.50, 3)
    expect(s.totalKm).toBe(0)
    expect(s.avgL100km).toBeNull()
  })

  it('ordena cronologicamente antes de calcular (tolerante a ordenes mezclados)', () => {
    const entries = [
      { date: '2026-03-01', litros: 48, eurPerLitre: 1.55, kmTotales: 11300 },
      { date: '2026-01-10', litros: 50, eurPerLitre: 1.50, kmTotales: 10000 },
      { date: '2026-02-05', litros: 45, eurPerLitre: 1.45, kmTotales: 10600 },
    ]
    const s = diaryStats(entries)
    expect(s.totalKm).toBe(1300)  // primero=10000, ultimo=11300 tras ordenar
  })

  it('filtra entradas invalidas', () => {
    const entries: any[] = [
      { date: '2026-01-10', litros: 50,  eurPerLitre: 1.50, kmTotales: 10000 },
      { date: '2026-02-05', litros: -1,  eurPerLitre: 1.45, kmTotales: 10600 }, // litros invalido
      { date: '2026-02-10', litros: 45,  eurPerLitre: 0,    kmTotales: 10700 }, // precio invalido
      { date: '2026-02-20', litros: NaN, eurPerLitre: 1.50, kmTotales: 10800 }, // litros NaN
      { date: '2026-03-01', litros: 48,  eurPerLitre: 1.55, kmTotales: 11300 },
    ]
    const s = diaryStats(entries)
    expect(s.entries).toBe(2)
    expect(s.totalLiters).toBe(98)
  })
})
