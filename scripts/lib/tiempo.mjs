// Lógica pura del vertical "el tiempo", compartida por el robot (Node), el Worker
// (src) y los tests — mismo patrón que scripts/lib/historico-estatico.mjs (tipos en
// tiempo.d.mts). Sin DOM. Las funciones de descarga (bajaAemet/bajaOpenMeteo) usan
// `fetch` global, disponible en Node 22 y en Workers.
//

// Umbral de frescura de la predicción: si el dato tiene más de estas horas, la web
// avisa de que puede no estar actualizado (mismo espíritu que la red de seguridad de
// guardias). El tiempo se refresca varias veces al día, así que 12 h es holgado.
import { fechaHoraLocal, instanteLocal } from './fechas.mjs'
export const TIEMPO_STALE_HORAS = 12
export const AEMET_MUNICIPIOS = 'https://www.aemet.es/es/eltiempo/prediccion/municipios/'

// AEMET utiliza su propio nombre en la ruta (p. ej. «coruna-a-id15030»).
// Ambos tipos de parte identifican la misma ficha, incluso si uno falta.
export function urlMunicipioAemet(enlace, ine) {
  if (typeof enlace !== 'string' || !enlace.startsWith(AEMET_MUNICIPIOS)) return undefined
  const localidad = enlace.slice(AEMET_MUNICIPIOS.length).replace(/^horas\//, '')
  const codigo = /^[a-z0-9-]+-id(\d{5})$/.exec(localidad)?.[1]
  if (!codigo || codigo !== ine) return undefined
  return AEMET_MUNICIPIOS + localidad
}

export function zonaTiempo(ine) {
  return /^(35|38)/.test(ine) ? 'Atlantic/Canary' : 'Europe/Madrid'
}

function diaCivil(valor) {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(valor)) return ''
  const fecha = valor.slice(0, 10)
  const t = Date.parse(fecha + 'T00:00:00Z')
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === fecha ? fecha : ''
}

function sumaDias(fecha, n) {
  return new Date(Date.parse(fecha + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
}

/**
 * ¿Es fiable la predicción por su antigüedad?
 * @param {string|null|undefined} ts  timestamp de elaboración (ISO)
 * @param {number} [ahora]            epoch ms (para tests deterministas)
 * @returns {{ fiable: boolean, horas: number }}
 */
export function frescuraTiempo(ts, ahora = Date.now()) {
  const t = instanteLocal(ts)
  const horas = Number.isFinite(t) ? (ahora - t) / 3600000 : Infinity
  return { fiable: horas >= -5 / 60 && horas <= TIEMPO_STALE_HORAS, horas }
}

// ---- Adaptadores: respuesta cruda -> modelo normalizado comun -------------
// Ambas fuentes se traducen a la MISMA forma { ine, nombre, provincia,
// elaborado, fuente, dias:[{fecha,tmin,tmax,cielo,probLluvia,viento}] } para que
// la pagina renderice igual venga de donde venga (solo cambia la etiqueta).

const num = (v) => {
  // Solo aceptamos numeros finitos o strings numericos NO vacios. Antes,
  // Number(null) y Number('') daban 0 (finito), asi que una AUSENCIA de dato se
  // publicaba como 0 (p.ej. 0 grados / 0% de lluvia como si fueran reales). Un 0
  // de verdad si se conserva.
  if (v == null || typeof v === 'boolean') return null
  if (typeof v === 'string' && v.trim() === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// AEMET da los valores por PERIODOS del dia (00-24, 00-12, 12-24, ...). El
// «00-24» abarca el día. En los últimos días el único valor no lleva periodo.
// Una probabilidad de seis horas no equivale a la del día entero.
function periodoDia(arr, campo) {
  if (!Array.isArray(arr)) return null
  const diario = arr.find(x => x?.periodo === '00-24') || (arr.length === 1 && !arr[0]?.periodo ? arr[0] : null)
  return diario?.[campo] ?? null
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
  if (root?.id != null && String(root.id).padStart(5, '0') !== meta.ine) {
    const codigo = /^-?\d{1,6}$/.test(String(root.id)) ? root.id : 'inválido'
    const enlaceCoincide = Boolean(urlMunicipioAemet(root.origen?.enlace, meta.ine))
    throw new Error('INE recibido '+codigo+', solicitado '+meta.ine+', enlace oficial coincide: '+(enlaceCoincide ? 'sí' : 'no'))
  }
  const dias = (root?.prediccion?.dia || []).map(d => ({
    fecha: d.fecha,
    tmax: num(d.temperatura?.maxima),
    tmin: num(d.temperatura?.minima),
    cielo: String(periodoDia(d.estadoCielo, 'descripcion') || '').trim(),
    probLluvia: num(periodoDia(d.probPrecipitacion, 'value')),
    viento: maxVelocidad(d.viento),
  }))
  return {
    ine: meta.ine, nombre: meta.nombre, provincia: meta.provincia,
    urlMunicipio: urlMunicipioAemet(root?.origen?.enlace, meta.ine),
    elaborado: root?.elaborado || '', fuente: 'AEMET', versionPeriodos: 2, dias,
  }
}

// Tabla de códigos WMO (Open-Meteo) -> texto en castellano, alineada con AEMET.
const WMO = {
  0: 'Despejado', 1: 'Poco nuboso', 2: 'Parcialmente nuboso', 3: 'Nuboso',
  45: 'Niebla', 48: 'Niebla', 51: 'Llovizna', 53: 'Llovizna', 55: 'Llovizna',
  56: 'Llovizna helada', 57: 'Llovizna helada',
  61: 'Lluvia', 63: 'Lluvia', 65: 'Lluvia fuerte',
  66: 'Lluvia helada', 67: 'Lluvia helada',
  71: 'Nieve', 73: 'Nieve', 75: 'Nieve fuerte', 77: 'Nieve granulada',
  80: 'Chubascos', 81: 'Chubascos', 82: 'Chubascos fuertes',
  85: 'Chubascos de nieve', 86: 'Chubascos de nieve',
  95: 'Tormenta', 96: 'Tormenta con granizo', 99: 'Tormenta con granizo',
}

/** Predicción diaria de Open-Meteo -> normalizada (misma forma). */
export function normalizaOpenMeteo(raw, meta, ahora = Date.now()) {
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
    elaborado: '', consultado: new Date(ahora).toISOString(), fuente: 'Open-Meteo', versionPeriodos: 2, dias,
  }
}

// ---- Descarga real (usa fetch global: vale en Node 22 y en Workers) --------
const UA_TIEMPO = 'cercaya-tiempo/1.0 (+https://webapp-3ft.pages.dev)'

/** AEMET en dos pasos: la 1a llamada devuelve { datos: <url> } con el JSON real. */
export async function bajaAemet(ine, key) {
  const r1 = await fetch(
    'https://opendata.aemet.es/opendata/api/prediccion/especifica/municipio/diaria/' + ine,
    { headers: { 'api_key': key, 'User-Agent': UA_TIEMPO, 'Accept': 'application/json' }, signal: AbortSignal.timeout(4000) },
  )
  if (!r1.ok) throw new Error('AEMET paso1 HTTP ' + r1.status)
  const j1 = await r1.json()
  if (!j1 || !j1.datos) throw new Error('AEMET sin datos (estado ' + (j1 && j1.estado) + ')')
  const r2 = await fetch(j1.datos, { headers: { 'User-Agent': UA_TIEMPO }, signal: AbortSignal.timeout(4000) })
  if (!r2.ok) throw new Error('AEMET paso2 HTTP ' + r2.status)
  const buf = await r2.arrayBuffer()
  const raw = JSON.parse(new TextDecoder('iso-8859-1').decode(buf))
  const modificado = Date.parse(r2.headers.get('Last-Modified') || '')
  const parte = Array.isArray(raw) ? raw[0] : raw
  if (parte && Number.isFinite(modificado)) parte.elaborado = new Date(modificado).toISOString()
  return raw
}

async function consultaOpenMeteo(lat, lng, opciones) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 27 || lat > 44.5 || lng < -19 || lng > 5)
    throw new Error('Faltan coordenadas válidas del municipio')
  const qs = new URLSearchParams({latitude: String(lat), longitude: String(lng), ...opciones})
  const r = await fetch('https://api.open-meteo.com/v1/forecast?' + qs, {
    headers: { 'User-Agent': UA_TIEMPO }, signal: AbortSignal.timeout(4000),
  })
  if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status)
  return r.json()
}

export function bajaOpenMeteo(lat, lng, zona = 'Europe/Madrid') {
  return consultaOpenMeteo(lat, lng, {
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max',
    timezone: zona,
  })
}

export function prediccionVigente(pred, ahora = Date.now()) {
  if (!pred || !frescuraTiempo(pred.elaborado || pred.consultado, ahora).fiable || !Array.isArray(pred.dias)) return null
  const hoy = fechaHoraLocal(new Date(ahora), zonaTiempo(pred.ine)).slice(0, 10)
  const limite = sumaDias(hoy, 6)
  const dias = pred.dias.filter(d => {
    const fecha = diaCivil(d?.fecha)
    return fecha >= hoy && fecha <= limite && (d.tmin != null || d.tmax != null)
  }).sort((a,b) => a.fecha.localeCompare(b.fecha)).map(d => {
    // Los snapshots anteriores no conservaban el periodo de la lluvia o el cielo.
    return pred.fuente === 'AEMET' && pred.versionPeriodos !== 2 ? { ...d, cielo: '', probLluvia: null } : d
  })
  return dias.length ? { ...pred, dias } : null
}

async function documentoAemet(ine, porHoras) {
  if (!/^\d{5}$/.test(ine)) throw new Error('Municipio inválido')
  const recurso = porHoras ? 'municipios_h/localidad_h_' : 'municipios/localidad_'
  const r = await fetch('https://www.aemet.es/xml/' + recurso + ine + '.xml', {
    headers: { 'User-Agent': UA_TIEMPO }, signal: AbortSignal.timeout(4000),
  })
  if (!r.ok) throw new Error('AEMET XML HTTP ' + r.status)
  const cuerpo = new TextDecoder('iso-8859-15').decode(await r.arrayBuffer())
  const { parse } = await import('node-html-parser')
  const root = parse(cuerpo).querySelector('root')
  if (root?.id !== ine || !root.querySelector('prediccion > dia')) throw new Error('XML sin el municipio solicitado')
  // El XML no señala el huso en «elaborado». Last-Modified sí indica la hora
  // de publicación en GMT tanto para Madrid como para Canarias.
  const modificado = Date.parse(r.headers.get('Last-Modified') || '')
  if (!Number.isFinite(modificado)) throw new Error('Falta la hora de publicación del parte')
  return { dias: root.querySelectorAll('prediccion > dia'), publicado: new Date(modificado).toISOString(),
    enlace: root.querySelector('origen > enlace')?.text.trim() }
}

async function diariaXml(muni) {
  const { dias, publicado, enlace } = await documentoAemet(muni.ine, false)
  const dia = dias.map(d => {
    const periodos = selector => d.querySelectorAll(selector).map(el => ({
      periodo: el.getAttribute('periodo'), value: el.text, descripcion: el.getAttribute('descripcion'),
    }))
    return {
      fecha: d.getAttribute('fecha'),
      temperatura: { maxima: d.querySelector('temperatura > maxima')?.text, minima: d.querySelector('temperatura > minima')?.text },
      probPrecipitacion: periodos('prob_precipitacion'),
      estadoCielo: periodos('estado_cielo'),
      viento: d.querySelectorAll('viento > velocidad').map(v => ({ velocidad: v.text })),
    }
  })
  return normalizaAemet({ id: muni.ine, origen: { enlace }, elaborado: publicado, prediccion: { dia } }, muni)
}

// El robot sólo guarda partes oficiales con identidad, fecha y temperaturas verificadas.
export async function parteParaSnapshot(muni, leerOpenData, ahora = Date.now()) {
  let motivoRespaldo
  try {
    const raw = await leerOpenData(muni.ine)
    const root = Array.isArray(raw) ? raw[0] : raw
    if (root?.id == null) throw new Error('OpenData no identifica el municipio')
    const pred = prediccionVigente(normalizaAemet(raw, muni), ahora)
    if (!pred) throw new Error('OpenData no entregó un parte vigente con temperaturas')
    if (root.origen?.enlace && !pred.urlMunicipio) throw new Error('OpenData no enlaza el municipio solicitado')
    return { pred }
  } catch (e) {
    motivoRespaldo = e instanceof Error ? e.message : 'Fallo en OpenData'
  }
  const pred = prediccionVigente(await diariaXml(muni), ahora)
  if (!pred) throw new Error('XML sin parte vigente con temperaturas')
  return { pred, motivoRespaldo }
}

export async function resuelvePrediccion(muni, deps = {}) {
  const ahora = deps.ahora ?? Date.now()
  try {
    const parte = deps.bajaAemet ? normalizaAemet(await deps.bajaAemet(muni.ine), muni) : await diariaXml(muni)
    const vigente = prediccionVigente(parte, ahora)
    if (vigente) return vigente
  } catch { /* El municipio puede carecer de XML o el servicio estar caído. */ }
  const raw = await (deps.bajaOpenMeteo || bajaOpenMeteo)(muni.lat, muni.lng, zonaTiempo(muni.ine))
  const suplente = normalizaOpenMeteo(raw, muni, ahora)
  const vigente = prediccionVigente(suplente, ahora)
  if (!vigente) throw new Error('Falta predicción vigente de las dos fuentes')
  return vigente
}

// ---- Próximas horas y franjas de lluvia ------------------------------------
async function horariaXml(ine) {
  const { dias, publicado, enlace } = await documentoAemet(ine, true)
  const horas = [], lluvia = []
  for (const dia of dias) {
    const fecha = diaCivil(dia.getAttribute('fecha'))
    if (!fecha) continue
    const lecturas = new Map()
    const repetidas = new Set()
    for (const el of dia.querySelectorAll('temperatura, viento, estado_cielo')) {
      const h = el.getAttribute('periodo')
      if (!/^(?:[01]\d|2[0-3])$/.test(h)) continue
      const fila = lecturas.get(h) || { fechaHora: fecha + 'T' + h + ':00', temperatura: null, viento: null }
      if (el.rawTagName === 'estado_cielo') {
        const cielo = el.getAttribute('descripcion')?.trim()
        if (!cielo) continue
        if (fila.cielo != null) repetidas.add(h)
        fila.cielo = cielo
      } else {
        const viento = el.rawTagName === 'viento'
        const valor = num(viento ? el.querySelector('velocidad')?.text : el.text)
        if (valor === null) continue
        const campo = viento ? 'viento' : 'temperatura'
        if (fila[campo] != null) repetidas.add(h)
        fila[campo] = valor
      }
      lecturas.set(h, fila)
    }
    for (const h of repetidas) lecturas.delete(h)
    horas.push(...lecturas.values())
    for (const el of dia.querySelectorAll('prob_precipitacion')) {
      const m = /^([01]\d|2[0-3])([01]\d|2[0-3]|24)$/.exec(el.getAttribute('periodo') || '')
      const probabilidad = num(el.text)
      if (!m || m[1] === m[2] || probabilidad === null || probabilidad < 0 || probabilidad > 100) continue
      // El XML horario ya expresa los extremos UTC en la hora LOCAL de esta
      // oficina: la misma ventana de invierno es 19–01 en Durango y 18–00 en Arrecife.
      const fechaFin = m[2] < m[1] || m[2] === '24' ? sumaDias(fecha, 1) : fecha
      lluvia.push({ desde: fecha + 'T' + m[1] + ':00', hasta: fechaFin + 'T' + (m[2] === '24' ? '00' : m[2]) + ':00', probabilidad })
    }
  }
  return { fuente: 'AEMET', elaborado: publicado, urlMunicipio: urlMunicipioAemet(enlace, ine), horas, lluvia }
}

export function normalizaHorasOpenMeteo(raw, ine, ahora = Date.now()) {
  const local = ms => fechaHoraLocal(new Date(ms), zonaTiempo(ine)).replace(' ', 'T')
  const horas = [], lluvia = []
  for (const [i, t] of (raw?.hourly?.time || []).entries()) {
    if (!Number.isSafeInteger(t) || !Number.isFinite(new Date(t * 1000).getTime())) continue
    const fechaHora = local(t * 1000)
    const temperatura = num(raw.hourly.temperature_2m?.[i])
    const viento = num(raw.hourly.wind_speed_10m?.[i])
    const cielo = WMO[raw.hourly.weather_code?.[i]]
    if (temperatura !== null || viento !== null || cielo) horas.push({ fechaHora, temperatura, viento, cielo })
    // Open-Meteo documenta la probabilidad para la hora PRECEDENTE a su marca.
    const probabilidad = num(raw.hourly.precipitation_probability?.[i])
    const desde = local(t * 1000 - 3600000)
    if (probabilidad !== null && probabilidad >= 0 && probabilidad <= 100 && desde < fechaHora)
      lluvia.push({ desde, hasta: fechaHora, probabilidad })
  }
  return { fuente: 'Open-Meteo', elaborado: '', consultado: new Date(ahora).toISOString(), horas, lluvia }
}

export function horasVigentes(parte, ine, ahora = Date.now()) {
  if (!parte || !frescuraTiempo(parte.elaborado || parte.consultado, ahora).fiable) return null
  const zona = zonaTiempo(ine)
  const actual = fechaHoraLocal(new Date(ahora), zona).replace(' ', 'T')
  const hora = actual.slice(0, 13) + ':00'
  const limite = fechaHoraLocal(new Date(ahora + 24 * 3600000), zona).replace(' ', 'T').slice(0,13) + ':00'
  const horas = (parte.horas || []).filter(h => h.fechaHora >= hora && h.fechaHora < limite)
    .sort((a,b) => a.fechaHora.localeCompare(b.fechaHora))
  // Si al atrasarse el reloj una hora aparece dos veces, el XML civil no permite
  // distinguir los dos instantes. Descartarla evita atribuirle valores ambiguos.
  const unicas = horas.filter((h, i) => h.fechaHora !== horas[i-1]?.fechaHora && h.fechaHora !== horas[i+1]?.fechaHora)
  const lluvia = (parte.lluvia || []).filter(p => p.hasta > actual && p.desde < limite)
    .sort((a,b) => a.desde.localeCompare(b.desde))
  return unicas.length || lluvia.length ? { ...parte, horas: unicas, lluvia } : null
}

export async function resuelveHoras(muni, deps = {}) {
  const ahora = deps.ahora ?? Date.now()
  try {
    const parte = await (deps.horasAemet || horariaXml)(muni.ine)
    const vigente = horasVigentes(parte, muni.ine, ahora)
    if (vigente) return vigente
  } catch { /* Se intenta el respaldo solo para las coordenadas de este municipio. */ }
  const raw = deps.horasOpenMeteo ? await deps.horasOpenMeteo(muni.lat, muni.lng) :
    await consultaOpenMeteo(muni.lat, muni.lng, {
      hourly: 'temperature_2m,wind_speed_10m,precipitation_probability,weather_code',
      timeformat: 'unixtime', timezone: 'GMT', forecast_days: '3',
    })
  const vigente = horasVigentes(normalizaHorasOpenMeteo(raw, muni.ine, ahora), muni.ine, ahora)
  if (!vigente) throw new Error('Falta predicción horaria vigente de las dos fuentes')
  return vigente
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
      // "Importante" = va al snapshot estatico (robot). Solo por poblacion
      // (>=50.000, ~145 municipios). NO usamos `destacada` de AEMET: marca ~1.000,
      // demasiados para el robot y sus limites.
      imp: pob >= IMPORTANTE_MIN_HAB,
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
