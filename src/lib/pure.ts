// Funciones puras testeables. Se reutilizan en el server (src/index.tsx) y en los
// tests unitarios. Las versiones embebidas en client.ts son copia literal de estas
// (convertidas a JS plano). Si cambias una, revisa la otra.

// ---- LRU bounded ----
export class LRU<V> {
  private max: number
  private map = new Map<string, { data: V; ts: number }>()
  constructor(max: number) { this.max = Math.max(1, max) }

  get(k: string): { data: V; ts: number } | undefined {
    const v = this.map.get(k)
    if (!v) return undefined
    this.map.delete(k)
    this.map.set(k, v)
    return v
  }

  set(k: string, v: { data: V; ts: number }): void {
    if (this.map.has(k)) this.map.delete(k)
    this.map.set(k, v)
    while (this.map.size > this.max) {
      const first = this.map.keys().next().value
      if (first === undefined) break
      this.map.delete(first)
    }
  }

  get size(): number { return this.map.size }
}

// ---- Validacion de IDs numericos (INE / Ministerio). Bloquea SSRF / path-traversal ----
const ID_RE = /^\d{1,5}$/
export function validateId(id: string | undefined): string | null {
  if (!id || !ID_RE.test(id)) return null
  return id
}

// Allowlist de IDs de provincia validos (52 codigos INE: 01-52). Rechaza 99999
// y compania antes de hacer passthrough al Ministerio → reduce amplificacion
// cache-miss a ratio 1:1 con el universo real. Complementa validateId().
const VALID_PROVINCIA_IDS = new Set<string>([
  '01','02','03','04','05','06','07','08','09','10',
  '11','12','13','14','15','16','17','18','19','20',
  '21','22','23','24','25','26','27','28','29','30',
  '31','32','33','34','35','36','37','38','39','40',
  '41','42','43','44','45','46','47','48','49','50',
  '51','52',
])
export function isValidProvinciaId(id: string | null | undefined): boolean {
  return !!id && VALID_PROVINCIA_IDS.has(id)
}

export function sanitizeLatLng(latRaw: string | null | undefined, lngRaw: string | null | undefined):
  { lat: string; lng: string } | null {
  if (typeof latRaw !== 'string' || typeof lngRaw !== 'string') return null
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
  return { lat: lat.toFixed(6), lng: lng.toFixed(6) }
}

// ---- CORS / anti-hotlink ----
export function originAllowed(
  origin: string | undefined,
  host: string | undefined,
  allowList: ReadonlySet<string>,
): boolean {
  if (!origin) return true
  if (host && origin === 'https://' + host) return true
  if (host && origin === 'http://' + host) return true
  if (allowList.has(origin)) return true
  try {
    const u = new URL(origin)
    // NO confiamos en todo *.pages.dev: es un dominio compartido (cualquiera
    // puede desplegar ahi, seria un allowlist efectivamente abierto). El mismo
    // host —produccion y los previews llamando a SU PROPIA API— ya se permite
    // arriba via `origin === scheme + host`.
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true
  } catch { /* origin invalido */ }
  return false
}

// ---- Origen canonico para SEO (canonical / sitemaps / robots) ----
// Independiente del Host de la peticion: si PUBLIC_ORIGIN esta configurado,
// manda (asi los despliegues preview <hash>.pages.dev no generan canonicals ni
// sitemaps propios que Google indexaria como duplicados). Si no esta, cae al
// host/esquema de la peticion (comportamiento previo). `isCanonical` indica si
// la peticion llega por el host canonico (para, p.ej., bloquear previews en robots).
export function canonicalSite(
  publicOrigin: string | undefined,
  reqScheme: string,
  reqHost: string,
): { origin: string; host: string; isCanonical: boolean } {
  if (publicOrigin) {
    try {
      const u = new URL(publicOrigin)
      const host = u.host
      const origin = u.protocol.replace(':', '') + '://' + host
      return { origin, host, isCanonical: reqHost === host }
    } catch { /* PUBLIC_ORIGIN invalido: fallback abajo */ }
  }
  return { origin: reqScheme + '://' + reqHost, host: reqHost, isCanonical: true }
}

// ---- Haversine: distancia en kilometros entre dos coordenadas ----
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const toRad = (d: number) => d * Math.PI / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// ---- Mediana ----
export function median(values: number[]): number {
  const xs = values.filter(n => Number.isFinite(n)).sort((a, b) => a - b)
  if (!xs.length) return NaN
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2
}

// ---- Parse de horario del Ministerio (L-V 07:00-22:00; S 08:00-14:00; D cerrado; etc.) ----
// Devuelve si la estacion esta abierta en el instante dado.
const DAY_MAP: Record<string, number> = { L: 1, M: 2, X: 3, J: 4, V: 5, S: 6, D: 0 }
function expandDayRange(token: string): number[] {
  const m = /^([LMXJVSD])-([LMXJVSD])$/.exec(token)
  if (m) {
    const a = DAY_MAP[m[1]], b = DAY_MAP[m[2]]
    const days: number[] = []
    // Permite L-D o V-L (cruce de semana)
    let i = a
    for (let n = 0; n < 8; n++) {
      days.push(i)
      if (i === b) break
      i = (i + 1) % 7
    }
    return days
  }
  if (DAY_MAP[token] !== undefined) return [DAY_MAP[token]]
  return []
}

export function isOpenNow(horario: string | undefined, when: Date = new Date()): boolean | null {
  if (!horario) return null
  const raw = horario.trim().toUpperCase()
  if (!raw) return null
  if (raw.includes('24H') || raw === 'L-D 24H' || /^L-D\s*00:00-24:00/.test(raw)) return true

  const day = when.getDay()
  const nowMin = when.getHours() * 60 + when.getMinutes()

  // Separa por ';'
  const blocks = raw.split(';').map(s => s.trim()).filter(Boolean)
  for (const block of blocks) {
    // Ejemplo: "L-V 07:00-22:00" o "S 08:00-14:00" o "L-V 07:00-13:30 Y 16:00-20:00"
    const dayPart = block.match(/^([LMXJVSD](?:-[LMXJVSD])?)\s+(.+)$/)
    if (!dayPart) continue
    const days = expandDayRange(dayPart[1])
    if (!days.includes(day)) continue
    const ranges = dayPart[2].split(/\s+Y\s+|,/i)
    for (const range of ranges) {
      const m = /(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/.exec(range)
      if (!m) continue
      const start = (+m[1]) * 60 + (+m[2])
      let end = (+m[3]) * 60 + (+m[4])
      if (end === 0) end = 24 * 60
      if (nowMin >= start && nowMin < end) return true
    }
  }
  return false
}

// ---- Comparacion de tokens en tiempo constante ----
// Evita que un atacante deduzca caracter a caracter el token midiendo el
// tiempo de respuesta (timing attack). === en JS hace early-return al primer
// byte distinto, asi que un atacante con jitter bajo (p99 estable) puede en
// teoria inferir el prefijo correcto. Con XOR acumulado recorremos siempre
// ambas cadenas completas y comparamos al final.
//
// Nota: la comprobacion previa de longitudes SI filtra por longitud (por
// diseno: un token de longitud distinta no puede ser el valido), pero nunca
// por contenido. Si necesitas resistir tambien el oraculo de longitud, genera
// siempre tokens de la misma longitud (es el caso: HEALTH_ADMIN_TOKEN es un
// UUID/hex fijo).
export function tokensEqualConstTime(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return diff === 0
}

// ---- PREDICTOR SEMANAL: "Lleno ahora o espero?" ----
// Modelo ultra-simple basado en el percentil del precio actual dentro de la
// distribucion de precios OBSERVADOS EN EL MISMO DIA DE LA SEMANA. Razon:
// los patrones de precios del Ministerio tienen estacionalidad semanal fuerte
// (los lunes suelen ser mas baratos que los viernes en muchos mercados). Asi
// evitamos comparar "sabado con lunes" y damos una recomendacion honesta.
//
// Input:
//   currentEurL — precio actual €/L de esta estacion+combustible.
//   weekdaySamples — array de €/L observados en el mismo weekday (0=domingo)
//                    en los ultimos N dias (tipicamente 90d => ~12 muestras).
//
// Output:
//   verdict: 'buy_now'  — percentil <=25 → mejor que el tipico para este dia
//            'neutral'  — percentil 26-74
//            'wait'     — percentil >=75 → peor que el tipico; probablemente bajara
//   confidence: 'low' (<4 muestras) | 'mid' (4-7) | 'high' (>=8)
//   percentile: numero [0,100] (0 = mas barato visto, 100 = mas caro)
//   sampleCount: cuantas muestras se usaron
//   tipicalEurL: mediana de las muestras (para mostrar "hoy suele estar en X")
//
// Devuelve null si no hay muestras o el precio actual no es valido — el
// cliente lo interpreta como "sin prediccion disponible" y oculta el badge.
export interface PredictInput {
  currentEurL: number
  weekdaySamples: number[]
}
export interface PredictResult {
  verdict: 'buy_now' | 'neutral' | 'wait'
  confidence: 'low' | 'mid' | 'high'
  percentile: number
  sampleCount: number
  tipicalEurL: number
}
export function classifyPriceVsCycle(input: PredictInput): PredictResult | null {
  const { currentEurL, weekdaySamples } = input
  if (!Number.isFinite(currentEurL) || currentEurL <= 0) return null
  const samples = (weekdaySamples || []).filter(v => Number.isFinite(v) && v > 0)
  if (samples.length === 0) return null
  const sorted = samples.slice().sort((a, b) => a - b)
  // Percentil inclusivo: proporcion de muestras <= currentEurL.
  let below = 0
  for (const v of sorted) if (v <= currentEurL) below++
  const percentile = Math.round((below / sorted.length) * 100)
  const verdict: PredictResult['verdict'] =
    percentile <= 25 ? 'buy_now' :
    percentile >= 75 ? 'wait'    : 'neutral'
  const confidence: PredictResult['confidence'] =
    sorted.length >= 8 ? 'high' : sorted.length >= 4 ? 'mid' : 'low'
  const tipicalEurL = sorted[Math.floor(sorted.length / 2)]
  return {
    verdict,
    confidence,
    percentile,
    sampleCount: sorted.length,
    tipicalEurL,
  }
}

// ---- Rate limiter en memoria (ventana deslizante por IP) ----
// Aproximado: limpia entries caducadas al insertar. No sustituye a Cloudflare Rate
// Limiting pero anade friccion basica sin depender de KV.
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>()
  constructor(private limit: number, private windowMs: number) {}

  check(key: string, now: number = Date.now()): { allowed: boolean; remaining: number; retryAfterSec: number } {
    const cutoff = now - this.windowMs
    const arr = (this.hits.get(key) ?? []).filter(t => t > cutoff)
    if (arr.length >= this.limit) {
      this.hits.set(key, arr)
      const retryAfterSec = Math.max(1, Math.ceil((arr[0] + this.windowMs - now) / 1000))
      return { allowed: false, remaining: 0, retryAfterSec }
    }
    arr.push(now)
    this.hits.set(key, arr)
    // GC ocasional: si crece demasiado, limpia entries vacios
    if (this.hits.size > 5000) {
      for (const [k, v] of this.hits) {
        if (v.length === 0 || v[v.length - 1] <= cutoff) this.hits.delete(k)
      }
    }
    return { allowed: true, remaining: this.limit - arr.length, retryAfterSec: 0 }
  }
}
