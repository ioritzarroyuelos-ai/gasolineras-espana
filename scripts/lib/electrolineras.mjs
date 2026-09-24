// Lógica PURA para el snapshot de electrolineras (sin red ni disco: testeable).
// La usa scripts/fetch-chargers.mjs, que se encarga del I/O (descargar el
// DATEX2 de la DGT / consultar Open Charge Map y escribir chargers.json).
//
// Fuente primaria: registro OFICIAL del MITERD publicado por la DGT en DATEX2
// v3 (nacional, diario, CC BY). Fuente secundaria opcional: Open Charge Map
// (comunidad, CC BY-SA 4.0) — solo si hay OCM_API_KEY; rellena puntos que no
// estén en el registro oficial. Cada punto lleva su `fuente` ('dgt' | 'ocm').
//
// Formato de salida (array-of-arrays para minimizar bytes; ~12k puntos):
//   [lat, lng, title, operator, maxKw, connectors, points, fuente]

/** Orden de campos de cada fila del snapshot. El cliente lo lee por índice. */
export const SCHEMA = ['lat', 'lng', 'title', 'operator', 'maxKw', 'connectors', 'points', 'fuente']

// Bounding box de España (península + Baleares + Canarias + Ceuta/Melilla).
// Mismo criterio defensivo que el robot viejo: descartamos coords fuera.
const ES_BBOX = { latMin: 26, latMax: 44.5, lngMin: -19, lngMax: 5.5 }

/** true si (lat,lng) es un punto plausible dentro de España. */
export function inSpain(lat, lng) {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    isFinite(lat) && isFinite(lng) && lat !== 0 && lng !== 0 &&
    lat >= ES_BBOX.latMin && lat <= ES_BBOX.latMax &&
    lng >= ES_BBOX.lngMin && lng <= ES_BBOX.lngMax
  )
}

/**
 * Normaliza el tipo de conector (enum DATEX2 o título OCM) a una etiqueta corta
 * y reconocible para el usuario: CCS, CHAdeMO, T2, T1, Tesla, Schuko, CEE.
 */
export function mapConnector(raw) {
  if (!raw) return ''
  const t = String(raw).toUpperCase().replace(/[\s_-]/g, '')
  if (t.includes('CHADEMO')) return 'CHAdeMO'
  if (t.includes('COMBO') || t.includes('CCS')) return 'CCS'
  if (t.includes('TESLA') || t.includes('SUPERCHARGER')) return 'Tesla'
  if (t.includes('T3') || t.includes('TYPE3')) return 'T3'
  // Type 2 / Mennekes (el más común en Europa). iec62196T2 (sin COMBO, ya
  // capturado arriba).
  if (t.includes('62196T2') || t.includes('TYPE2') || t.includes('MENNEKES')) return 'T2'
  if (t.includes('62196T1') || t.includes('TYPE1') || t.includes('J1772')) return 'T1'
  // Enchufe doméstico (Schuko y variantes domesticX del enum DATEX2).
  if (t.startsWith('DOMESTIC') || t.includes('SCHUKO')) return 'Schuko'
  // Industrial CEE (azul/rojo). iec60309...
  if (t.includes('60309') || t.includes('CEE')) return 'CEE'
  const s = String(raw).trim()
  return s.length > 10 ? s.slice(0, 10) : s
}

/** Vatios (DATEX2 maxPowerAtSocket) → kW enteros. Devuelve 0 si no parseable. */
export function kwFromWatts(raw) {
  const n = parseFloat(String(raw).replace(',', '.'))
  if (!isFinite(n) || n <= 0) return 0
  // El registro da la potencia en vatios (22000 = 22 kW). Algún feed anómalo
  // podría venir ya en kW (< 400): en ese caso lo tomamos tal cual.
  const kw = n >= 400 ? n / 1000 : n
  return Math.round(kw)
}

// Extrae el primer grupo de una regex sobre un texto, o '' si no hay match.
function first(re, text) {
  const m = re.exec(text)
  return m ? m[1] : ''
}

// Limpia texto de un <com:value>: colapsa espacios y recorta a `max` chars.
function clean(s, max) {
  const t = String(s || '').replace(/\s+/g, ' ').trim()
  return max && t.length > max ? t.slice(0, max) : t
}

/**
 * Parsea el DATEX2 v3 de electrolineras (EnergyInfrastructureTablePublication)
 * troceando por <egi:energyInfrastructureSite> y extrayendo cada estación con
 * regex (el XML es regular y namespaced; trocear evita cargar 80 MB en un árbol
 * de objetos). Devuelve estaciones normalizadas con fuente 'dgt'.
 */
export function parseSites(xml) {
  const out = []
  if (!xml) return out
  const chunks = String(xml).split('<egi:energyInfrastructureSite')
  // chunks[0] es la cabecera (feedDescription, etc.): se descarta.
  for (let i = 1; i < chunks.length; i++) {
    const c = chunks[i]
    const lat = parseFloat(first(/<loc:latitude>([-\d.]+)</, c))
    const lng = parseFloat(first(/<loc:longitude>([-\d.]+)</, c))
    if (!inSpain(lat, lng)) continue

    // El primer <fac:name> del trozo es el nombre del sitio.
    const title = clean(first(/<fac:name>\s*<com:values>\s*<com:value[^>]*>([^<]+)</, c), 70) || 'Punto de recarga'

    // El operador va dentro de <fac:operator …>…</fac:operator> (p.ej.
    // "IBERDROLA CLIENTES S.A.U"). Puede faltar.
    let operator = ''
    const opBlock = /<fac:operator[^>]*>([\s\S]*?)<\/fac:operator>/.exec(c)
    // Ojo: <com:value…> vs <com:values> — exigimos que tras "value" venga ' ' o
    // '>' para no capturar el contenedor plural <com:values> (y su hueco).
    if (opBlock) operator = clean(first(/<com:value(?:\s[^>]*)?>([^<]+)</, opBlock[1]), 40)

    // Potencia máxima: máximo de todos los maxPowerAtSocket (vatios) del sitio.
    let maxKw = 0
    const powRe = /<egi:maxPowerAtSocket[^>]*>([\d.,]+)</g
    let pm
    while ((pm = powRe.exec(c)) !== null) {
      const kw = kwFromWatts(pm[1])
      if (kw > maxKw) maxKw = kw
    }

    // Tipos de conector presentes (únicos, en orden de aparición).
    const conns = []
    const ctRe = /<egi:connectorType>([^<]+)</g
    let cm
    while ((cm = ctRe.exec(c)) !== null) {
      const short = mapConnector(cm[1])
      if (short && conns.indexOf(short) === -1) conns.push(short)
    }

    // Nº de puntos de recarga del sitio = nº de <egi:refillPoint>.
    const points = (c.match(/<egi:refillPoint\b/g) || []).length

    out.push({
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      title,
      operator,
      maxKw,
      connectors: conns,
      points: points || 1,
      fuente: 'dgt',
    })
  }
  return out
}

/**
 * Normaliza la respuesta de la API de Open Charge Map (array de POIs) al mismo
 * modelo. Devuelve estaciones con fuente 'ocm'. Tolerante a campos ausentes.
 */
export function normalizeOcm(pois) {
  const out = []
  if (!Array.isArray(pois)) return out
  for (const p of pois) {
    const ai = p && p.AddressInfo
    if (!ai) continue
    const lat = typeof ai.Latitude === 'number' ? ai.Latitude : parseFloat(ai.Latitude)
    const lng = typeof ai.Longitude === 'number' ? ai.Longitude : parseFloat(ai.Longitude)
    if (!inSpain(lat, lng)) continue

    const conns = []
    let maxKw = 0
    const list = Array.isArray(p.Connections) ? p.Connections : []
    for (const cn of list) {
      const kw = parseFloat(cn && cn.PowerKW)
      if (isFinite(kw) && kw > maxKw) maxKw = kw
      const title = cn && cn.ConnectionType && cn.ConnectionType.Title
      const short = mapConnector(title)
      if (short && conns.indexOf(short) === -1) conns.push(short)
    }

    out.push({
      lat: Math.round(lat * 1e5) / 1e5,
      lng: Math.round(lng * 1e5) / 1e5,
      title: clean(ai.Title, 70) || 'Punto de recarga',
      operator: clean(p.OperatorInfo && p.OperatorInfo.Title, 40),
      maxKw: Math.round(maxKw),
      connectors: conns,
      points: (typeof p.NumberOfPoints === 'number' && p.NumberOfPoints > 0) ? p.NumberOfPoints : (list.length || 1),
      fuente: 'ocm',
    })
  }
  return out
}

// Clave de celda (~111 m) para deduplicar por cercanía.
function cellKey(lat, lng) {
  return Math.round(lat * 1000) + '|' + Math.round(lng * 1000)
}

/**
 * Fusiona estaciones oficiales (DGT) con las de OCM, descartando las de OCM que
 * caen a ~100 m de una oficial (la oficial manda). Devuelve la lista combinada.
 */
export function dedup(dgt, ocm) {
  const grid = new Set()
  for (const s of dgt) grid.add(cellKey(s.lat, s.lng))
  const merged = dgt.slice()
  for (const s of ocm) {
    const la = Math.round(s.lat * 1000)
    const ln = Math.round(s.lng * 1000)
    let dupe = false
    for (let dx = -1; dx <= 1 && !dupe; dx++) {
      for (let dy = -1; dy <= 1 && !dupe; dy++) {
        if (grid.has((la + dx) + '|' + (ln + dy))) dupe = true
      }
    }
    if (!dupe) merged.push(s)
  }
  return merged
}

/** Convierte estaciones normalizadas a filas compactas según SCHEMA. */
export function toCompactRows(stations) {
  return stations.map(s => [
    s.lat, s.lng, s.title, s.operator, s.maxKw,
    (s.connectors || []).join(','), s.points, s.fuente,
  ])
}
