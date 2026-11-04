import { describe, it, expect } from 'vitest'
import {
  LRU,
  validateId,
  isValidProvinciaId,
  sanitizeLatLng,
  originAllowed,
  canonicalSite,
  haversineKm,
  median,
  isOpenNow,
  SlidingWindowLimiter,
  tokensEqualConstTime,
  classifyPriceVsCycle,
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

describe('canonicalSite (M6: canonical/sitemap/robots por PUBLIC_ORIGIN)', () => {
  it('usa PUBLIC_ORIGIN e ignora el Host (preview no es canonico)', () => {
    const s = canonicalSite('https://webapp-3ft.pages.dev', 'https', 'abc123.webapp-3ft.pages.dev')
    expect(s.origin).toBe('https://webapp-3ft.pages.dev')
    expect(s.host).toBe('webapp-3ft.pages.dev')
    expect(s.isCanonical).toBe(false)
  })
  it('marca isCanonical cuando el Host coincide con PUBLIC_ORIGIN', () => {
    expect(canonicalSite('https://webapp-3ft.pages.dev', 'https', 'webapp-3ft.pages.dev').isCanonical).toBe(true)
  })
  it('cae al host de la peticion si no hay PUBLIC_ORIGIN', () => {
    const s = canonicalSite(undefined, 'https', 'ejemplo.com')
    expect(s.origin).toBe('https://ejemplo.com')
    expect(s.isCanonical).toBe(true)
  })
  it('cae al host de la peticion si PUBLIC_ORIGIN es invalido', () => {
    const s = canonicalSite('no-es-url', 'http', 'localhost:8788')
    expect(s.origin).toBe('http://localhost:8788')
    expect(s.isCanonical).toBe(true)
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
  it('rechaza otros *.pages.dev cross-origin (no confiamos en el dominio compartido)', () => {
    // Antes se permitia cualquier *.pages.dev -> allowlist efectivamente abierto.
    // Ahora solo produccion (allowlist) + same-origin + localhost(dev).
    expect(originAllowed('https://abc123.gasolineras.pages.dev', 'x', allow)).toBe(false)
  })
  it('permite un preview de Pages llamando a SU PROPIA API (same-origin)', () => {
    expect(originAllowed('https://abc.webapp-3ft.pages.dev', 'abc.webapp-3ft.pages.dev', allow)).toBe(true)
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
