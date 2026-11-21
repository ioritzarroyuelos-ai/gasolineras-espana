import { webServicio, servicioTileBbox } from './servicios.mjs'

const GENCAT = 'https://analisi.transparenciacatalunya.cat'
const MADRID = 'https://datos.madrid.es/dataset/217921-0-salas-estudio'
export const SERVICIOS_PUBLICOS_FUENTES = Object.freeze([
  Object.freeze({ id: 'refugios-cataluna', nombre: 'Refugios climáticos de Cataluña', categoria: 'refugios-climaticos',
    fuenteUrl: GENCAT + '/Seguretat/Refugis-clim-tics-dels-municipis-de-Catalunya/9gu7-iwci', datosUrl: GENCAT + '/resource/9gu7-iwci.json',
    metaUrl: GENCAT + '/api/views/9gu7-iwci.json', licenciaUrl: 'https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies',
    atribucion: "Generalitat de Catalunya. Departament d'Interior i Seguretat Pública.", min: 1000, max: 20000, maxBytes: 8 * 1024 * 1024 }),
  Object.freeze({ id: 'salas-estudio-madrid', nombre: 'Salas de estudio y lectura de Madrid', categoria: 'salas-estudio',
    fuenteUrl: MADRID, datosUrl: MADRID + '/resource/217921-0-salas-estudio-json/download/217921-0-salas-estudio.json',
    metaUrl: MADRID + '/resource/217921-5-salas-estudio/download/estructura_ds_conjuntodatos.pdf',
    licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/', atribucion: 'Ayuntamiento de Madrid. Datos abiertos, CC BY 4.0.', min: 30, max: 1000, maxBytes: 2 * 1024 * 1024 }),
])
export const SERVICIOS_PUBLICOS_MAX_SNAPSHOT_BYTES = 12 * 1024 * 1024
export const SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES = 512 * 1024
export const SERVICIOS_PUBLICOS_MAX_SHARD_BYTES = 128 * 1024
export const SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES = 1024 * 1024
export const SERVICIOS_PUBLICOS_LISTA_FILAS = 50
export const SERVICIOS_PUBLICOS_MAPA_FILAS = 200
export const SERVICIOS_PUBLICOS_IDENTIDADES_FILAS = 100
export const SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES = 16 * 1024
const source = id => SERVICIOS_PUBLICOS_FUENTES.find(f => f.id === id)
const fail = () => { throw Error('Servicios públicos: datos incompletos, incoherentes o fuera de los límites admitidos.') }
const object = x => !!x && typeof x === 'object' && !Array.isArray(x)
const text = (x, max = 600) => {
  if (x === undefined || x === null || x === '') return null
  if (typeof x !== 'string') fail()
  const v = x.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (v.length > max) fail() // Nunca cortar una excepción al final de un horario.
  return v || null
}
const strictIso = x => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x) && Number.isFinite(Date.parse(x)) && new Date(x).toISOString() === x
const yesNo = x => typeof x === 'string' && /^s[ií]$/i.test(x.trim()) ? true : typeof x === 'string' && /^no$/i.test(x.trim()) ? false : null
const number = x => typeof x === 'number' ? x : typeof x === 'string' && /^-?\d+(?:\.\d+)?$/.test(x.trim()) ? Number(x) : NaN
export function coordenadasPublicas(id, lat, lon) {
  if (![lat, lon].every(Number.isFinite)) return false
  return id === 'refugios-cataluna' ? lat >= 40.4 && lat <= 43 && lon >= 0 && lon <= 3.5
    : id === 'salas-estudio-madrid' ? lat >= 40.3 && lat <= 40.7 && lon >= -3.9 && lon <= -3.5 : false
}
function coords(id, latitude, longitude) {
  const lat = number(latitude), lon = number(longitude)
  // Ni corregir decimales, ni invertir ejes, ni usar el centro municipal.
  return coordenadasPublicas(id, lat, lon) ? { lat, lon } : { lat: null, lon: null }
}
function localDate(value, now) {
  if (!value) return null
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?$/.test(value)) fail()
  const checked = value.includes('.') ? value + 'Z' : value + '.000Z'
  if (!strictIso(checked) || value.slice(0, 10) > new Date(now).toISOString().slice(0, 10)) fail()
  // Socrata calendar_date carece de zona horaria: conservar el texto original.
  return value
}
function common(f, id, nombre, municipio) {
  if (!nombre || !municipio) fail()
  return { id, nombre, categoria: f.categoria, lat: null, lon: null, direccion: null, municipio, cp: null, web: null,
    horarioTexto: null, fechaFicha: null, accesibilidad: 'desconocido', accesibilidadTexto: null,
    tipo: null, aguaPotable: null, lavabos: null, climatizacion: null, descanso: null }
}
async function sha(value) {
  const result = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(result), n => n.toString(16).padStart(2, '0')).join('')
}
export async function normalizaRefugios(rows, fechaDatos, now = Date.now()) {
  const f = source('refugios-cataluna')
  if (!Array.isArray(rows) || rows.length > f.max) fail()
  const items = await Promise.all(rows.map(async r => {
    // La fuente contiene códigos de longitud variable y un identificador AMB
    // no numérico. Se conserva su identidad literal, sin inventar un código INE.
    if (!object(r) || typeof r.indicador_refugi !== 'string' || !/^[^|\u0000-\u001f]{1,80}\|[^|\u0000-\u001f]{1,500}$/.test(r.indicador_refugi) || r.indicador_refugi.split('|')[0] !== r.codi_municipi) fail()
    const municipio = text(r.municipi)
    // Un parque limítrofe aparece con el mismo indicador en dos municipios.
    // Ambas fichas municipales se conservan, sin escoger una como verdadera.
    const item = common(f, 'refugio-cat-' + await sha(r.indicador_refugi + '\n' + municipio), text(r.nom), municipio)
    const accessible = yesNo(r.accessibilitat)
    return { ...item, ...coords(f.id, r.latitud, r.longitud), direccion: text(r.adreca), web: webServicio(r.informacio_web) || null,
      fechaFicha: localDate(r.ultima_actualitzacio, now), accesibilidad: accessible === true ? 'si' : accessible === false ? 'no' : 'desconocido',
      accesibilidadTexto: text(r.accessibilitat), tipo: text(r.tipologia), aguaPotable: yesNo(r.aigua), lavabos: yesNo(r.lavabo),
      climatizacion: yesNo(r.climatitzacio), descanso: yesNo(r.area_descans) }
  }))
  return snapshot(f, items, fechaDatos, now, ['Este catálogo identifica equipamientos; no confirma que estén activados como refugio ni abiertos ahora. Consulta el calendario y las condiciones del municipio.',
    'La fecha de cada ficha se conserva tal como la publica la fuente, sin zona horaria indicada.',
    'Un equipamiento compartido por varios municipios puede tener una ficha por municipio en el catálogo.'])
}
const accessibilityLabels = ['No accesible', 'Accesible', 'Parcialmente accesible para personas con movilidad reducida', 'Sin información de accesibilidad', 'Lengua de signos', 'Señalización podotáctil', 'Bucle de inducción magnético']
function accesibilidadMadrid(value) {
  const raw = text(value), codes = raw?.split(',').map(x => x.trim()) || []
  if (!codes.length || codes.some(x => !/^[0-6]$/.test(x)) || new Set(codes).size !== codes.length) return { accesibilidad: 'desconocido', accesibilidadTexto: raw }
  const primary = codes.filter(x => Number(x) <= 3)
  return { accesibilidad: primary.length === 1 ? ({ 0: 'no', 1: 'si', 2: 'limitado', 3: 'desconocido' })[primary[0]] : 'desconocido',
    accesibilidadTexto: codes.map(x => accessibilityLabels[Number(x)]).join('; ') }
}
export function normalizaSalasMadrid(data, fechaDatos, now = Date.now()) {
  const f = source('salas-estudio-madrid'), rows = data?.['@graph']
  if (!Array.isArray(rows) || rows.length > f.max) fail()
  const items = rows.map(r => {
    if (!object(r) || !/^[1-9]\d{0,15}$/.test(r.id) || !object(r.address)) fail()
    const item = common(f, 'estudio-madrid-' + r.id, text(r.title), text(r.address.locality))
    const url = webServicio(r.relation), web = url && /(?:^|\.)madrid\.es$/i.test(new URL(url).hostname) ? url : null
    const cp = text(r.address['postal-code'])
    if (cp && !/^28\d{3}$/.test(cp)) fail()
    return { ...item, ...coords(f.id, r.location?.latitude, r.location?.longitude), direccion: text(r.address['street-address']), cp, web,
      horarioTexto: text(r.organization?.schedule, 10000), ...accesibilidadMadrid(r.organization?.accesibility) }
  })
  return snapshot(f, items, fechaDatos, now, ['Catálogo municipal de salas de estudio y lectura. No informa de plazas libres ni confirma apertura en este momento.',
    'Los horarios se muestran como texto de la fuente, incluidas sus excepciones. La fecha del archivo no es una comprobación individual de cada sala.'])
}
function snapshot(f, items, fechaDatos, now, avisos) {
  const unique = new Map()
  for (const item of items) {
    if (unique.has(item.id) && JSON.stringify(unique.get(item.id)) !== JSON.stringify(item)) fail()
    unique.set(item.id, item)
  }
  const sorted = Array.from(unique.values()).sort((a, b) => a.id.localeCompare(b.id)), conCoordenadas = sorted.filter(p => p.lat !== null).length
  if (sorted.length < items.length) avisos.push('Se han unido registros repetidos idénticos de la fuente.')
  if (conCoordenadas < sorted.length) avisos.push('Las fichas sin coordenadas geográficas comprobables se conservan en el listado, sin colocarlas en el mapa.')
  const data = { schema: 1, id: f.id, nombre: f.nombre, consultado: new Date(now).toISOString(), fechaDatos,
    fuenteUrl: f.fuenteUrl, datosUrl: f.datosUrl, licenciaUrl: f.licenciaUrl, atribucion: f.atribucion,
    total: sorted.length, conCoordenadas, sinCoordenadas: sorted.length - conCoordenadas, avisos, items: sorted }
  validaFuentePublica(data, now)
  return data
}
const ITEM_FIELDS = new Set(['id', 'nombre', 'categoria', 'lat', 'lon', 'direccion', 'municipio', 'cp', 'web', 'horarioTexto', 'fechaFicha', 'accesibilidad', 'accesibilidadTexto', 'tipo', 'aguaPotable', 'lavabos', 'climatizacion', 'descanso'])
export function identidadPublicaValida(id, fuenteId) {
  return typeof id === 'string' && (fuenteId === 'refugios-cataluna' ? /^refugio-cat-[a-f0-9]{64}$/.test(id) : fuenteId === 'salas-estudio-madrid' && /^estudio-madrid-[1-9]\d{0,15}$/.test(id))
}
export function validaServicioPublico(p, fuenteId, now = Date.now()) {
  const f = source(fuenteId)
  if (!f || !Number.isFinite(now) || !object(p) || Object.keys(p).length !== ITEM_FIELDS.size || Object.keys(p).some(k => !ITEM_FIELDS.has(k)) || typeof p.id !== 'string' || p.categoria !== f.categoria) fail()
  if (!identidadPublicaValida(p.id, f.id)) fail()
  for (const key of ['nombre', 'municipio']) if (typeof p[key] !== 'string' || !p[key] || text(p[key]) !== p[key]) fail()
  for (const key of ['direccion', 'cp', 'horarioTexto', 'accesibilidadTexto', 'tipo']) if (p[key] !== null && (typeof p[key] !== 'string' || !p[key] || text(p[key], key === 'horarioTexto' ? 10000 : 600) !== p[key])) fail()
  if (p.cp !== null && !/^\d{5}$/.test(p.cp) || p.web !== null && webServicio(p.web) !== p.web || !['si', 'no', 'limitado', 'desconocido'].includes(p.accesibilidad)) fail()
  if (p.fechaFicha !== null && (f.id !== 'refugios-cataluna' || localDate(p.fechaFicha, now) !== p.fechaFicha)) fail()
  for (const key of ['aguaPotable', 'lavabos', 'climatizacion', 'descanso']) if (p[key] !== null && typeof p[key] !== 'boolean') fail()
  if (!(p.lat === null && p.lon === null) && !coordenadasPublicas(f.id, p.lat, p.lon)) fail()
  return p
}
function validaCabecera(data, now) {
  const f = source(data?.id)
  if (!f || !object(data) || data.schema !== 1 || !Number.isFinite(now)) fail()
  for (const key of ['nombre', 'fuenteUrl', 'datosUrl', 'licenciaUrl', 'atribucion']) if (data[key] !== f[key]) fail()
  if (!strictIso(data.consultado) || !strictIso(data.fechaDatos) || Date.parse(data.consultado) > now + 300000 || Date.parse(data.fechaDatos) > Date.parse(data.consultado) || Date.parse(data.fechaDatos) > now || Date.parse(data.fechaDatos) < Date.UTC(2000, 0)) fail()
  if (!Number.isSafeInteger(data.total) || data.total < f.min || data.total > f.max || !Number.isInteger(data.conCoordenadas) || data.conCoordenadas < 0 || data.conCoordenadas > data.total || data.sinCoordenadas !== data.total - data.conCoordenadas) fail()
  if (!Array.isArray(data.avisos) || data.avisos.length > 10 || data.avisos.some(x => typeof x !== 'string' || !x || x.length > 1000)) fail()
  return f
}
export function validaFuentePublica(data, now = Date.now()) {
  const f = validaCabecera(data, now)
  if (!Array.isArray(data.items) || data.items.length !== data.total) fail()
  const ids = new Set()
  let located = 0
  for (const p of data.items) {
    validaServicioPublico(p, f.id, now)
    if (ids.has(p.id)) fail()
    ids.add(p.id)
    if (p.lat === null && p.lon === null) continue
    located++
  }
  if (located !== data.conCoordenadas || new TextEncoder().encode(JSON.stringify(data)).length > SERVICIOS_PUBLICOS_MAX_SNAPSHOT_BYTES) fail()
  return data
}
function descriptor(d, archivo, maxRows, maxBytes) {
  if (!object(d) || d.archivo !== archivo || !Number.isInteger(d.total) || d.total < 1 || d.total > maxRows || !Number.isInteger(d.bytes) || d.bytes < 2 || d.bytes > maxBytes || typeof d.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(d.sha256)) fail()
}
export function validaManifestPublicos(data, now = Date.now()) {
  validaCabecera(data, now)
  if ('items' in data || typeof data.version !== 'string' || !/^[a-f0-9]{64}$/.test(data.version) || !Array.isArray(data.listas) || !data.listas.length || data.listas.length > data.total || !object(data.mapa) || Object.keys(data.mapa).length > 500) fail()
  let listTotal = 0, mapTotal = 0
  data.listas.forEach((d, i) => { descriptor(d, `listas/${i}.json`, SERVICIOS_PUBLICOS_LISTA_FILAS, SERVICIOS_PUBLICOS_MAX_SHARD_BYTES); listTotal += d.total })
  for (const [zona, pages] of Object.entries(data.mapa)) {
    if (!/^\d{1,3}-\d{1,4}$/.test(zona) || !Array.isArray(pages) || !pages.length || pages.length > data.conCoordenadas) fail()
    servicioTileBbox(zona)
    pages.forEach((d, i) => { descriptor(d, `mapa/${zona}-${i}.json`, SERVICIOS_PUBLICOS_MAPA_FILAS, SERVICIOS_PUBLICOS_MAX_SHARD_BYTES); mapTotal += d.total })
  }
  descriptor(data.busqueda, 'busqueda.json', data.total, SERVICIOS_PUBLICOS_MAX_BUSQUEDA_BYTES)
  if (listTotal !== data.total || mapTotal !== data.conCoordenadas || data.busqueda.total !== data.total) fail()
  // Opcional para leer snapshots anteriores. Las nuevas referencias son sólo
  // posiciones dentro de páginas ya comprobadas, nunca URLs ni coordenadas.
  if (data.identidades !== undefined) {
    if (!Array.isArray(data.identidades) || data.identidades.length !== Math.ceil(data.total / SERVICIOS_PUBLICOS_IDENTIDADES_FILAS)) fail()
    let total = 0, previous = ''
    data.identidades.forEach((d, i) => {
      descriptor(d, `identidades/${i}.json`, SERVICIOS_PUBLICOS_IDENTIDADES_FILAS, SERVICIOS_PUBLICOS_MAX_IDENTIDADES_BYTES)
      if (!identidadPublicaValida(d.desde, data.id) || !identidadPublicaValida(d.hasta, data.id) || d.desde > d.hasta || previous && previous >= d.desde
        || d.total !== Math.min(SERVICIOS_PUBLICOS_IDENTIDADES_FILAS, data.total - total)) fail()
      previous = d.hasta; total += d.total
    })
    if (total !== data.total) fail()
  }
  return data
}
export function validaIdentidadesPublicas(rows, manifest, descriptor) {
  if (!Array.isArray(rows) || rows.length !== descriptor.total || !rows.length) fail()
  let previous = ''; const positions = new Set()
  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== 3 || !identidadPublicaValida(row[0], manifest.id) || previous && previous >= row[0]
      || !Number.isInteger(row[1]) || row[1] < 0 || row[1] >= manifest.listas.length || !Number.isInteger(row[2]) || row[2] < 0 || row[2] >= manifest.listas[row[1]].total) fail()
    const position = row[1] + ':' + row[2]
    if (positions.has(position)) fail()
    positions.add(position); previous = row[0]
  }
  if (rows[0][0] !== descriptor.desde || rows.at(-1)[0] !== descriptor.hasta) fail()
  return rows
}
export function validaBusquedaPublicos(data, manifest) {
  if (!Array.isArray(data) || data.length !== manifest.total) fail()
  for (const row of data) {
    if (typeof row !== 'string' || !row || row.length > 1201) fail()
  }
  return data
}
export function normalizaBusquedaPublica(value) {
  if (typeof value !== 'string') fail()
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}
export function validaIndicePublicos(data, now = Date.now()) {
  if (!object(data) || data.schema !== 1 || !strictIso(data.consultado) || Date.parse(data.consultado) > now + 300000 || !Array.isArray(data.fuentes) || data.fuentes.length !== SERVICIOS_PUBLICOS_FUENTES.length) fail()
  const ids = new Set()
  for (const row of data.fuentes) {
    const f = source(row?.id)
    if (!f || ids.has(row.id) || row.nombre !== f.nombre || !['actual', 'conservada', 'error'].includes(row.estado) || !Number.isInteger(row.total) || row.total < 0 || row.total > f.max) fail()
    ids.add(row.id)
    if (row.estado === 'error') { if (row.ultimoExito !== null || row.fechaDatos !== null || row.total !== 0 || row.bytes !== 0 || row.sha256 !== null || row.manifestBytes !== 0 || row.manifestSha256 !== null) fail() }
    else if (!strictIso(row.ultimoExito) || !strictIso(row.fechaDatos) || Date.parse(row.ultimoExito) > Date.parse(data.consultado) || Date.parse(row.fechaDatos) > Date.parse(row.ultimoExito) || Date.parse(row.fechaDatos) > now || row.total < f.min
      || !Number.isSafeInteger(row.bytes) || row.bytes <= 0 || row.bytes > SERVICIOS_PUBLICOS_MAX_SNAPSHOT_BYTES || typeof row.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.sha256)
      || !Number.isSafeInteger(row.manifestBytes) || row.manifestBytes <= 0 || row.manifestBytes > SERVICIOS_PUBLICOS_MAX_MANIFEST_BYTES || typeof row.manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.manifestSha256)) fail()
    if (row.estado === 'actual' && row.error !== undefined || row.estado !== 'actual' && (typeof row.error !== 'string' || row.error.length > 300 || !row.error)) fail()
  }
  return data
}

// El JSON oficial madrileño puede contener CR/LF literales en cadenas. Sólo
// escapamos caracteres de control dentro de cadenas; no corregimos estructuras,
// valores, comentarios o comas. JSON.parse sigue rechazando lo demás.
export function leeJsonPublico(raw) {
  if (typeof raw !== 'string') fail()
  let inside = false, escaped = false, out = ''
  for (const c of raw.replace(/^\uFEFF/, '')) {
    if (inside && c.charCodeAt(0) < 32) { if (escaped) fail(); out += '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'); continue }
    out += c
    if (escaped) { escaped = false; continue }
    if (inside && c === '\\') { escaped = true; continue }
    if (c === '"') inside = !inside
  }
  return JSON.parse(out)
}
