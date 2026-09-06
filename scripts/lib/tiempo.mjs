// Lógica pura del vertical "el tiempo", compartida por el robot (Node), el Worker
// (src) y los tests — mismo patrón que scripts/lib/historico-estatico.mjs (tipos en
// tiempo.d.mts). Sin DOM. Las funciones de descarga (bajaAemet/bajaOpenMeteo) usan
// `fetch` global, disponible en Node 22 y en Workers.
//
// De momento: modelo de frescura. El resto (adaptadores AEMET/Open-Meteo, fallback,
// índice de municipios) se añade en las siguientes tareas del plan.

// Umbral de frescura de la predicción: si el dato tiene más de estas horas, la web
// avisa de que puede no estar actualizado (mismo espíritu que la red de seguridad de
// guardias). El tiempo se refresca varias veces al día, así que 12 h es holgado.
export const TIEMPO_STALE_HORAS = 12

/**
 * ¿Es fiable la predicción por su antigüedad?
 * @param {string|null|undefined} ts  timestamp de elaboración (ISO)
 * @param {number} [ahora]            epoch ms (para tests deterministas)
 * @returns {{ fiable: boolean, horas: number }}
 */
export function frescuraTiempo(ts, ahora = Date.now()) {
  const t = ts ? Date.parse(ts) : NaN
  const horas = Number.isFinite(t) ? (ahora - t) / 3600000 : Infinity
  return { fiable: horas <= TIEMPO_STALE_HORAS, horas }
}

// ---- Adaptadores: respuesta cruda -> modelo normalizado comun -------------
// Ambas fuentes se traducen a la MISMA forma { ine, nombre, provincia,
// elaborado, fuente, dias:[{fecha,tmin,tmax,cielo,probLluvia,viento}] } para que
// la pagina renderice igual venga de donde venga (solo cambia la etiqueta).

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null }

// AEMET da los valores por PERIODOS del dia (00-24, 00-12, 12-24, ...). El
// "00-24" es el del dia entero; en el dia de HOY suele venir vacio (ya pasado),
// asi que caemos al primer periodo con dato.
function periodoDia(arr, campo) {
  if (!Array.isArray(arr)) return null
  const full = arr.find(x => x && x.periodo === '00-24')
  const val = (x) => (x == null || x[campo] === '' || x[campo] == null) ? null : x[campo]
  if (full && val(full) != null) return val(full)
  for (const x of arr) { const v = val(x); if (v != null) return v }
  return null
}
function maxVelocidad(arr) {
  if (!Array.isArray(arr)) return null
  let m = null
  for (const x of arr) { const v = num(x?.velocidad); if (v != null) m = m == null ? v : Math.max(m, v) }
  return m
}

/** Predicción diaria de AEMET (respuesta del segundo paso) -> normalizada. */
export function normalizaAemet(raw, meta) {
  const root = Array.isArray(raw) ? raw[0] : raw
  const dias = ((root && root.prediccion && root.prediccion.dia) || []).map(d => ({
    fecha: d.fecha,
    tmax: num(d.temperatura?.maxima),
    tmin: num(d.temperatura?.minima),
    cielo: String(periodoDia(d.estadoCielo, 'descripcion') || '').trim(),
    probLluvia: num(periodoDia(d.probPrecipitacion, 'value')),
    viento: maxVelocidad(d.viento),
  }))
  return {
    ine: meta.ine, nombre: meta.nombre, provincia: meta.provincia,
    elaborado: (root && root.elaborado) || new Date().toISOString(),
    fuente: 'AEMET', dias,
  }
}

// Tabla de códigos WMO (Open-Meteo) -> texto en castellano, alineada con AEMET.
const WMO = {
  0: 'Despejado', 1: 'Poco nuboso', 2: 'Parcialmente nuboso', 3: 'Nuboso',
  45: 'Niebla', 48: 'Niebla', 51: 'Llovizna', 53: 'Llovizna', 55: 'Llovizna',
  56: 'Llovizna helada', 57: 'Llovizna helada',
  61: 'Lluvia', 63: 'Lluvia', 65: 'Lluvia fuerte',
  66: 'Lluvia helada', 67: 'Lluvia helada',
  71: 'Nieve', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Granizo',
  80: 'Chubascos', 81: 'Chubascos', 82: 'Chubascos fuertes',
  85: 'Chubascos de nieve', 86: 'Chubascos de nieve',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo',
}

/** Predicción diaria de Open-Meteo -> normalizada (misma forma). */
export function normalizaOpenMeteo(raw, meta) {
  const d = (raw && raw.daily) || {}
  const t = Array.isArray(d.time) ? d.time : []
  const dias = t.map((fecha, i) => ({
    fecha: fecha + 'T00:00:00',
    tmax: num(d.temperature_2m_max?.[i]),
    tmin: num(d.temperature_2m_min?.[i]),
    cielo: WMO[d.weathercode?.[i]] || 'No disponible',
    probLluvia: num(d.precipitation_probability_max?.[i]),
    viento: num(d.wind_speed_10m_max?.[i]),
  }))
  return {
    ine: meta.ine, nombre: meta.nombre, provincia: meta.provincia,
    elaborado: new Date().toISOString(), fuente: 'Open-Meteo', dias,
  }
}

// ---- Descarga real (usa fetch global: vale en Node 22 y en Workers) --------
const UA_TIEMPO = 'cercaya-tiempo/1.0 (+https://webapp-3ft.pages.dev)'

/** AEMET en dos pasos: la 1a llamada devuelve { datos: <url> } con el JSON real. */
export async function bajaAemet(ine, key) {
  const r1 = await fetch(
    'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/' + ine,
    { headers: { 'api_key': key, 'User-Agent': UA_TIEMPO, 'Accept': 'application/json' } },
  )
  if (!r1.ok) throw new Error('AEMET paso1 HTTP ' + r1.status)
  const j1 = await r1.json()
  if (!j1 || !j1.datos) throw new Error('AEMET sin datos (estado ' + (j1 && j1.estado) + ')')
  const r2 = await fetch(j1.datos, { headers: { 'User-Agent': UA_TIEMPO } })
  if (!r2.ok) throw new Error('AEMET paso2 HTTP ' + r2.status)
  const buf = await r2.arrayBuffer()
  return JSON.parse(new TextDecoder('iso-8859-1').decode(buf))
}

export async function bajaOpenMeteo(lat, lng) {
  const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lng
    + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max'
    + '&timezone=Europe%2FMadrid'
  const r = await fetch(url, { headers: { 'User-Agent': UA_TIEMPO } })
  if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status)
  return r.json()
}

/**
 * Devuelve la predicción normalizada de un municipio: AEMET primero, y si falla
 * (tras reintentos), Open-Meteo. `deps` inyectable para tests. `key` = AEMET_API_KEY.
 */
export async function resuelvePrediccion(muni, deps = {}) {
  const meta = { ine: muni.ine, nombre: muni.nombre, provincia: muni.provincia }
  const bajaA = deps.bajaAemet || ((ine) => bajaAemet(ine, deps.key || muni.key))
  const bajaO = deps.bajaOpenMeteo || (() => bajaOpenMeteo(muni.lat, muni.lng))
  const intentos = deps.intentos ?? 2
  let ultimoError
  for (let i = 0; i < intentos; i++) {
    try { return normalizaAemet(await bajaA(muni.ine), meta) }
    catch (e) { ultimoError = e }
  }
  // AEMET no responde: suplente Open-Meteo (etiquetado como tal).
  try { return normalizaOpenMeteo(await bajaO(muni.lat, muni.lng), meta) }
  catch (e) { throw new Error('AEMET y Open-Meteo fallaron: ' + (ultimoError && ultimoError.message) + ' / ' + e.message) }
}

// ---- Maestro de municipios (AEMET) -> lista propia -------------------------
// Umbral de población para el snapshot estático ("importantes").
export const IMPORTANTE_MIN_HAB = 50000

/** slug URL-safe (minúsculas, sin acentos ni signos). Autoconsistente con las
 *  rutas /tiempo/<prov>/<mun> (gen y router usan el mismo municipios.json). */
export function slugTiempo(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Convierte el maestro de municipios de AEMET en nuestra lista normalizada.
 * @param {unknown[]} maestro  respuesta de /maestro/municipios (id "id28079",
 *   nombre, latitud_dec, longitud_dec, num_hab, destacada, ...)
 * @param {Array<{id:string,slug:string,name:string}>} provincias  INE 2 díg -> slug/nombre
 * @returns municipios [{ine,nombre,provinciaId,provinciaSlug,provinciaNombre,slug,lat,lng,pob,imp}]
 */
export function maestroAMunicipios(maestro, provincias) {
  const byProv = new Map((provincias || []).map(p => [p.id, p]))
  const out = []
  for (const e of (Array.isArray(maestro) ? maestro : [])) {
    const ine = String((e && e.id) || '').replace(/^id/, '')
    if (ine.length !== 5) continue
    const provinciaId = ine.slice(0, 2)
    const prov = byProv.get(provinciaId)
    if (!prov) continue
    const nombre = String((e.nombre || e.capital || '')).trim()
    if (!nombre) continue
    const pob = parseInt(e.num_hab, 10) || 0
    out.push({
      ine, nombre,
      provinciaId, provinciaSlug: prov.slug, provinciaNombre: prov.name,
      slug: slugTiempo(nombre),
      lat: num(e.latitud_dec), lng: num(e.longitud_dec),
      pob,
      imp: e.destacada === '1' || pob >= IMPORTANTE_MIN_HAB,
    })
  }
  return out
}

/** municipios normalizados -> índice ligero para el autocompletado del buscador. */
export function construyeIndiceMunicipios(municipios) {
  const out = []
  const seen = new Set()
  for (const m of (Array.isArray(municipios) ? municipios : [])) {
    const u = '/tiempo/' + m.provinciaSlug + '/' + m.slug
    if (seen.has(u)) continue
    seen.add(u)
    out.push({ n: m.nombre, p: m.provinciaNombre, u })
  }
  out.sort((a, b) => a.n.localeCompare(b.n, 'es'))
  return out
}
