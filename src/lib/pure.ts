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

// ---- Sanitizacion de query de geocoding ----
// Nominatim acepta queries largas pero aqui acotamos agresivamente para limitar
// superficie de abuso (logs, cache keys gigantes, payloads maliciosos). Normas:
//   1. Rechaza cadenas vacias, >120 chars, o con caracteres de control.
//   2. Colapsa whitespace multiple a un solo espacio.
//   3. Preserva letras Unicode (acentos, n), digitos, espacios y signos tipicos
//      de direcciones espanolas (- , . ' / ').
//   4. Devuelve null si tras limpiar queda <2 chars utiles.
const GEO_DISALLOWED = /[\u0000-\u001F\u007F<>{}\\^`]/  // control chars + shell-like
export function sanitizeGeocodeQuery(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  if (raw.length === 0 || raw.length > 120) return null
  if (GEO_DISALLOWED.test(raw)) return null
  const collapsed = raw.replace(/\s+/g, ' ').trim()
  if (collapsed.length < 2) return null
  return collapsed
}

// Valida que (lat, lng) sean finitos, dentro de rango, y mantiene precision.
// Devuelve el par formateado como strings con 6 decimales (~11cm de precision)
// para que la clave de cache no dependa del formato exacto del cliente.
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
    if (u.hostname.endsWith('.pages.dev')) return true
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true
  } catch { /* origin invalido */ }
  return false
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

// ---- Gasto mensual estimado ----
// Duplicado literal de la logica en client.ts (updateMonthlyWidget) para
// poder testearla con numeros reales. Si cambias una, cambia la otra.
//
//   litros/mes        = (km/100) * consumo
//   coste/mes         = litros * precio_mediano
//   repostajes/mes    = ceil(litros / tank)       (al menos 1 si >0)
//   ahorro/mes        = (precio_mediano - precio_top) * litros  si > 0
export interface MonthlyEstimateInput {
  kmPerMonth: number           // ej. 1000
  consumoL100km: number        // ej. 6.5
  medianPriceEurL: number      // mediana €/L del listado filtrado, ej. 1.549
  tankL: number                // capacidad del deposito, ej. 50
  topPriceEurL?: number        // precio de la mas barata (opcional, para ahorro)
}
export interface MonthlyEstimate {
  litersPerMonth: number
  costEur: number
  refuelsPerMonth: number
  savingEur: number            // 0 si topPrice no mejora la mediana
}
export function estimateMonthly(input: MonthlyEstimateInput): MonthlyEstimate | null {
  const { kmPerMonth, consumoL100km, medianPriceEurL, tankL, topPriceEurL } = input
  // Validaciones defensivas: numeros finitos y positivos.
  if (!Number.isFinite(kmPerMonth)     || kmPerMonth     <= 0) return null
  if (!Number.isFinite(consumoL100km)  || consumoL100km  <= 0) return null
  if (!Number.isFinite(medianPriceEurL)|| medianPriceEurL<= 0) return null
  if (!Number.isFinite(tankL)          || tankL          <= 0) return null

  const liters = (kmPerMonth / 100) * consumoL100km
  const cost   = liters * medianPriceEurL
  const refuels = Math.ceil(liters / tankL)
  let saving = 0
  if (Number.isFinite(topPriceEurL as number) && (topPriceEurL as number) > 0 && (topPriceEurL as number) < medianPriceEurL) {
    saving = (medianPriceEurL - (topPriceEurL as number)) * liters
  }
  return {
    litersPerMonth: liters,
    costEur: cost,
    refuelsPerMonth: refuels,
    savingEur: saving,
  }
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

// ---- AHORRO NETO: precio bruto - coste de desvio ----
// El ahorro mostrado en las cards ahora resta explicitamente el coste en
// gasolina del desvio (ida y vuelta) desde la posicion del usuario. Si el
// ahorro neto resulta negativo, el cliente la marca como "no merece la pena"
// en vez de esconderla (util: el usuario quiere saber que esa barata esta
// demasiado lejos).
//
// Modelo (conservador):
//   consumoL100km: lo que gasta el coche del usuario.
//   extraKm: distancia de ida y vuelta del desvio en km.
//            Aproximamos con 2*haversine (atajo razonable sin routing real).
//   fuelPriceEurL: el precio del combustible que va a usar en el desvio.
//            Usamos el precio de la PROPIA estacion barata — asi no
//            sobrestimamos el coste del desvio con el precio medio.
//   tankL: deposito del usuario (ya se usa para calcular grossSavings).
//
//   grossSavingsEur  = (medianPrice - stationPrice) * tankL     (ya existente)
//   detourCostEur    = (extraKm/100) * consumoL100km * fuelPriceEurL
//   netSavingsEur    = grossSavingsEur - detourCostEur
export interface NetSavingsInput {
  grossSavingsEur: number
  extraKm: number
  consumoL100km: number
  fuelPriceEurL: number
}
export interface NetSavingsResult {
  detourCostEur: number
  netEur: number
  worthIt: boolean
}
export function netSavings(input: NetSavingsInput): NetSavingsResult {
  const { grossSavingsEur, extraKm, consumoL100km, fuelPriceEurL } = input
  const gross = Number.isFinite(grossSavingsEur) ? grossSavingsEur : 0
  const km    = Number.isFinite(extraKm)        && extraKm        > 0 ? extraKm        : 0
  const cons  = Number.isFinite(consumoL100km)  && consumoL100km  > 0 ? consumoL100km  : 0
  const price = Number.isFinite(fuelPriceEurL)  && fuelPriceEurL  > 0 ? fuelPriceEurL  : 0
  const detourCostEur = (km / 100) * cons * price
  const netEur = gross - detourCostEur
  // Umbral practico: consideramos "worth it" si despues del coste del desvio
  // aun quedan al menos 50 centimos en la operacion. Por debajo es
  // estadisticamente ruido (fluctuacion semanal, error del consumo declarado).
  return {
    detourCostEur,
    netEur,
    worthIt: netEur >= 0.5,
  }
}

// ---- RUTA A→B: distancia perpendicular de un punto a un segmento ----
// Para la feature "mejores gasolineras en mi trayecto", el cliente recibe dos
// coordenadas (origen + destino) y necesita filtrar las estaciones que caen
// en un corredor de ancho W a cada lado de la linea recta AB. Para distancias
// tipicas (<800 km, que es toda Espana penisnsular), usar la proyeccion
// equirectangular centrada en el punto medio da error <0.3% — perfectamente
// aceptable para "esta esta a 2 km de la ruta" con margen de error de decenas
// de metros.
//
// Algoritmo: pasamos lat/lng a metros locales respecto al punto medio (eje X
// en km E-O corregido por cos(lat), eje Y en km N-S), y calculamos la
// distancia minima del punto al segmento en ese plano.
export interface LatLng { lat: number; lng: number }
function llToXYkm(p: LatLng, center: LatLng): { x: number; y: number } {
  const R = 6371
  const toRad = (d: number) => d * Math.PI / 180
  const x = toRad(p.lng - center.lng) * Math.cos(toRad(center.lat)) * R
  const y = toRad(p.lat - center.lat) * R
  return { x, y }
}
export function perpDistanceKm(point: LatLng, a: LatLng, b: LatLng): number {
  // Punto medio para proyeccion equirectangular. Con distancias <800 km el
  // error de la proyeccion es <0.3%, mas que suficiente para un filtro de
  // corredor con granularidad de km.
  const center: LatLng = {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  }
  const P = llToXYkm(point, center)
  const A = llToXYkm(a, center)
  const B = llToXYkm(b, center)
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) {
    // Origen = destino: caemos a distancia euclidea desde cualquiera.
    const ex = P.x - A.x
    const ey = P.y - A.y
    return Math.sqrt(ex * ex + ey * ey)
  }
  // Proyeccion escalar (t en [0,1] = dentro del segmento).
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = A.x + t * dx
  const cy = A.y + t * dy
  const ex = P.x - cx
  const ey = P.y - cy
  return Math.sqrt(ex * ex + ey * ey)
}

// Filtra estaciones dentro de un corredor de ancho W a cada lado del segmento
// AB. Las ordena por (precio ascendente, distancia-al-corredor) y devuelve
// top N. El callback extrae (lat, lng, price) de cada estacion para que esta
// funcion sea agnostica de la forma exacta del record.
export interface CorridorItem<T> {
  item: T
  offKm: number           // distancia perpendicular al segmento
  priceEurL: number
}
export function stationsInCorridor<T>(
  items: T[],
  a: LatLng,
  b: LatLng,
  widthKm: number,
  extract: (x: T) => { lat: number; lng: number; priceEurL: number | null } | null,
  topN: number = 5,
): CorridorItem<T>[] {
  if (!Number.isFinite(widthKm) || widthKm <= 0) return []
  const hits: CorridorItem<T>[] = []
  for (const it of items) {
    const e = extract(it)
    if (!e) continue
    if (e.priceEurL == null || !Number.isFinite(e.priceEurL) || e.priceEurL <= 0) continue
    const off = perpDistanceKm({ lat: e.lat, lng: e.lng }, a, b)
    if (off <= widthKm) hits.push({ item: it, offKm: off, priceEurL: e.priceEurL })
  }
  // Orden principal por precio (lo que busca el usuario que activa la feature);
  // desempate por distancia al trayecto (menos desvio es mejor).
  hits.sort((x, y) => (x.priceEurL - y.priceEurL) || (x.offKm - y.offKm))
  return hits.slice(0, Math.max(1, topN))
}

// ---- PLANIFICACION DE PARADAS DE REPOSTAJE EN RUTA ----
// Dada una ruta A->B (distancia total en km), el deposito del coche, su
// consumo, el nivel de combustible actual, y una lista de estaciones ya
// PROYECTADAS sobre la ruta (con su km-desde-origen), decide EN QUE
// ESTACIONES parar para completar el viaje sin quedarse sin gasolina,
// minimizando el gasto total (elige la mas barata alcanzable en cada tramo).
//
// Modelo greedy-por-tramo:
//   1. Calcula autonomia maxima (km) = tankL / consumoL100km * 100
//   2. Calcula km alcanzables AHORA = autonomia * currentFuelPct
//   3. Define reserva minima (km) que queremos conservar = autonomia * safetyPct
//      (por defecto 10% del tanque: si autonomia=700km, reservamos 70km)
//   4. Mientras no lleguemos a destino con reserva:
//      - Ventana alcanzable = [posActual, posActual + kmRestantesDeTanque - reserva]
//      - Elige estacion MAS BARATA de la ventana; desempate por mayor km
//        (mas lejos => menos paradas futuras).
//      - Si no hay ninguna estacion en la ventana => ruta imposible con esta
//        autonomia; devuelve unreachable=true (el cliente avisa).
//      - Llena el deposito (asumimos llenado completo), avanza posicion,
//        sigue.
//   5. Para al llegar a destino.
//
// La heuristica NO minimiza el coste total optimo (problema NP-hard en
// general), pero produce planes razonables en O(n * stopsCount) — para
// rutas tipicas (2-5 paradas sobre <1000 estaciones) es instantaneo.
export interface PlanFuelStopsInput<T> {
  routeKm: number                 // distancia total A->B en km
  tankL: number                   // capacidad deposito en litros
  consumoL100km: number           // consumo en L/100km
  currentFuelPct: number          // [0..1] nivel actual del deposito
  safetyPct?: number              // [0..1] reserva minima; default 0.10 (10%)
  stations: {
    item: T
    kmFromOrigin: number          // km-desde-origen del punto proyectado
    priceEurL: number
  }[]
}
export interface PlannedStop<T> {
  item: T
  kmFromOrigin: number
  priceEurL: number
}
export interface PlanFuelStopsResult<T> {
  stops: PlannedStop<T>[]
  unreachable: boolean            // true si no es posible completar la ruta
  maxAutonomyKm: number            // autonomia con deposito lleno
  initialRangeKm: number           // km alcanzables al inicio (segun currentFuelPct)
  totalCostEur: number             // coste total de las paradas planificadas
                                    // (asume llenar hasta tope en cada parada)
}
export function planFuelStops<T>(input: PlanFuelStopsInput<T>): PlanFuelStopsResult<T> {
  const {
    routeKm, tankL, consumoL100km, currentFuelPct,
    safetyPct = 0.10, stations,
  } = input
  // Defaults ultra-conservadores si el input es ruidoso.
  const empty: PlanFuelStopsResult<T> = {
    stops: [], unreachable: false, maxAutonomyKm: 0, initialRangeKm: 0, totalCostEur: 0,
  }
  if (!Number.isFinite(routeKm)         || routeKm         <= 0) return empty
  if (!Number.isFinite(tankL)           || tankL           <= 0) return empty
  if (!Number.isFinite(consumoL100km)   || consumoL100km   <= 0) return empty
  const fuelPct   = Math.max(0, Math.min(1, Number.isFinite(currentFuelPct) ? currentFuelPct : 0))
  const safety    = Math.max(0, Math.min(0.5, Number.isFinite(safetyPct) ? safetyPct : 0.10))

  const maxAutonomyKm = (tankL / consumoL100km) * 100
  const safetyKm      = maxAutonomyKm * safety
  const initialRangeKm = maxAutonomyKm * fuelPct

  // Estaciones validas, ordenadas por km-desde-origen ascendente (nos da el
  // orden temporal en que las "veremos" al conducir).
  const pool = stations
    .filter(s => s && Number.isFinite(s.kmFromOrigin) && s.kmFromOrigin >= 0
             && s.kmFromOrigin <= routeKm
             && Number.isFinite(s.priceEurL) && s.priceEurL > 0)
    .slice()
    .sort((a, b) => a.kmFromOrigin - b.kmFromOrigin)

  let pos = 0
  let rangeKm = initialRangeKm
  const plan: PlannedStop<T>[] = []
  let totalCost = 0

  // Bucle acotado: como maximo ceil(routeKm / (tankL/consumoL*100 - safetyKm))
  // paradas. Anadimos un hard-cap de 50 como safety-net anti-infinito.
  for (let iter = 0; iter < 50; iter++) {
    const remaining = routeKm - pos
    if (rangeKm - safetyKm >= remaining) break  // llegamos sin parar mas

    const windowStart = pos
    const windowEnd   = pos + Math.max(0, rangeKm - safetyKm)

    // Candidatas alcanzables desde nuestra posicion actual (reserva incluida).
    // Las que ya pasamos (< pos) no cuentan.
    const candidates = pool.filter(s =>
      s.kmFromOrigin > windowStart && s.kmFromOrigin <= windowEnd,
    )
    if (candidates.length === 0) {
      // Ruta imposible: ni siquiera la primera estacion alcanzable existe.
      return {
        stops: plan,
        unreachable: true,
        maxAutonomyKm,
        initialRangeKm,
        totalCostEur: totalCost,
      }
    }
    // Escoge la MAS BARATA; si empate, la mas lejana (menos futuras paradas).
    candidates.sort((a, b) =>
      (a.priceEurL - b.priceEurL) || (b.kmFromOrigin - a.kmFromOrigin),
    )
    const pick = candidates[0]
    plan.push({
      item: pick.item,
      kmFromOrigin: pick.kmFromOrigin,
      priceEurL: pick.priceEurL,
    })
    // Coste: asumimos que en cada parada llenas hasta tope. Litros necesarios
    // para reponer desde el nivel actual (tras consumir pick.kmFromOrigin - pos km)
    // hasta el deposito lleno.
    const consumedKm = pick.kmFromOrigin - pos
    const consumedL  = (consumedKm / 100) * consumoL100km
    totalCost += consumedL * pick.priceEurL
    pos = pick.kmFromOrigin
    rangeKm = maxAutonomyKm  // deposito lleno tras repostar
  }
  return {
    stops: plan,
    unreachable: false,
    maxAutonomyKm,
    initialRangeKm,
    totalCostEur: totalCost,
  }
}

// ---- RUTA: proyeccion de un punto sobre el segmento A->B ----
// Devuelve { offKm, kmFromOrigin } donde kmFromOrigin es la distancia desde A
// hasta el punto proyectado (en km) sobre el segmento recto A->B.
// Util para ordenar temporalmente las estaciones del corredor al planificar
// paradas: "primero encuentro la estacion X a 120km, luego la Y a 310km".
export function projectOnRoute(
  point: LatLng, a: LatLng, b: LatLng,
): { offKm: number; kmFromOrigin: number; totalKm: number } {
  const center: LatLng = {
    lat: (a.lat + b.lat) / 2,
    lng: (a.lng + b.lng) / 2,
  }
  const P = llToXYkm(point, center)
  const A = llToXYkm(a, center)
  const B = llToXYkm(b, center)
  const dx = B.x - A.x
  const dy = B.y - A.y
  const len2 = dx * dx + dy * dy
  const totalKm = Math.sqrt(len2)
  if (len2 < 1e-9) {
    const ex = P.x - A.x
    const ey = P.y - A.y
    return { offKm: Math.sqrt(ex * ex + ey * ey), kmFromOrigin: 0, totalKm: 0 }
  }
  let t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const cx = A.x + t * dx
  const cy = A.y + t * dy
  const ex = P.x - cx
  const ey = P.y - cy
  return {
    offKm: Math.sqrt(ex * ex + ey * ey),
    kmFromOrigin: t * totalKm,
    totalKm,
  }
}

// ---- DIARIO DE REPOSTAJES: consumo real L/100km ----
// Dado una entrada del diario con litros cargados + km totales del coche al
// repostar, y la entrada anterior con sus km_totales, calculamos el consumo
// REAL del intervalo. Esto supera al "consumo declarado" del perfil porque
// refleja la conduccion real (velocidad, carga, estilo).
//
//   L/100km = litros / (deltaKm / 100)
//
// Si la entrada anterior no existe (primer repostaje) o deltaKm <= 0
// (odometro manipulado / repostaje antes de agotar), devolvemos null —
// el cliente muestra "--" hasta tener un segundo repostaje valido.
export function computeL100km(litros: number, kmNow: number, kmPrev: number): number | null {
  if (!Number.isFinite(litros) || litros <= 0) return null
  if (!Number.isFinite(kmNow) || !Number.isFinite(kmPrev)) return null
  const dk = kmNow - kmPrev
  if (dk <= 0) return null
  return litros / (dk / 100)
}

// Dado un array de entradas del diario { date, litros, eurPerLitre, kmTotales }
// ordenadas cronologicamente, calcula estadisticas agregadas utiles para el
// widget: gasto total, media €/L, consumo medio L/100km, km recorridos.
// Ignora la PRIMERA entrada para computar km/consumo (no tenemos baseline).
export interface DiaryEntry {
  date: string            // ISO YYYY-MM-DD
  litros: number
  eurPerLitre: number     // €/L al que repostaste
  kmTotales: number       // odometro al repostar
}
export interface DiaryStats {
  entries: number
  totalLiters: number
  totalSpentEur: number
  avgEurPerLitre: number | null
  totalKm: number            // km realmente recorridos entre entradas
  avgL100km: number | null
}
export function diaryStats(entries: DiaryEntry[]): DiaryStats {
  const clean = (entries || []).filter(e =>
    e &&
    typeof e.date === 'string' &&
    Number.isFinite(e.litros)      && e.litros      > 0 &&
    Number.isFinite(e.eurPerLitre) && e.eurPerLitre > 0 &&
    Number.isFinite(e.kmTotales)   && e.kmTotales   >= 0
  ).sort((a, b) => a.date.localeCompare(b.date))
  if (clean.length === 0) {
    return {
      entries: 0,
      totalLiters: 0,
      totalSpentEur: 0,
      avgEurPerLitre: null,
      totalKm: 0,
      avgL100km: null,
    }
  }
  let totalLiters = 0
  let totalSpent = 0
  let sumEurPerLitre = 0
  for (const e of clean) {
    totalLiters += e.litros
    totalSpent  += e.litros * e.eurPerLitre
    sumEurPerLitre += e.eurPerLitre
  }
  // Km reales recorridos = diferencia entre primera y ultima lectura del odometro.
  // No sumamos intervalos porque el odometro es monotono creciente.
  const totalKm = clean[clean.length - 1].kmTotales - clean[0].kmTotales
  // Consumo real: litros consumidos ENTRE repostajes (ignorando el litraje del
  // primero, que reposto antes de empezar el diario) / km recorridos.
  let litersForConsumption = 0
  for (let i = 1; i < clean.length; i++) litersForConsumption += clean[i].litros
  const avgL100km = totalKm > 0 && litersForConsumption > 0
    ? litersForConsumption / (totalKm / 100)
    : null
  return {
    entries: clean.length,
    totalLiters,
    totalSpentEur: totalSpent,
    avgEurPerLitre: sumEurPerLitre / clean.length,
    totalKm: totalKm > 0 ? totalKm : 0,
    avgL100km,
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
