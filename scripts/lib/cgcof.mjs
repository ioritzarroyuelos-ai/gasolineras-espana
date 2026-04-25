// Helper compartido para los COFs que delegan en el portal central CGCOF
// (farmaciasguardia.farmaceuticos.com). Cubre Malaga (29), Zaragoza (50) y
// Badajoz (06), entre otros.
//
// Patron del CGCOF:
//   1) GET https://farmaciasguardia.farmaceuticos.com/web_guardias/publico/Provincia_p.asp?id=PROV
//      → Set-Cookie con ASPSESSIONID. HTML tiene `<select name="vzona">` con
//        opciones `<option value="PPPPNNN">NOMBRE_ZONA</option>`.
//   2) GET .../Guardias.asp?date=DD/M/YYYY&vzona=VVVV&vmenu=1&provincia=PROV
//      Headers requeridos: Cookie + Referer al Provincia_p.asp.
//      → HTML con secciones GUARDIAS DE DIA / GUARDIAS DE NOCHE. Cada
//        farmacia es un `<a href=javascript:abbre(PROV,FARMID,0)>`.
//   3) GET .../datos.asp?id=FARMID
//      → HTML tabla con Titular, Direccion, Localidad ((CP) - SECTOR),
//        Telefono.
//
// CAVEAT — encoding Windows-1252:
//   El servidor responde con `text/html` sin charset. El contenido es
//   Windows-1252 (Direcci�n, Tel�fono). TextDecoder('windows-1252') OK.
//
// CAVEAT — coordenadas:
//   El portal NO expone lat/lng. Hay que geocodificar con Nominatim
//   (1 req/s) usando direccion + localidad + provincia.

const CGCOF_HOST = 'https://farmaciasguardia.farmaceuticos.com'
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search'

/** Carga inicial: Provincia_p.asp para tomar cookie + lista de zonas. */
export async function obtenerSesionYZonas(provinciaId, userAgent) {
  const url = `${CGCOF_HOST}/web_guardias/publico/Provincia_p.asp?id=${provinciaId}`
  const res = await fetch(url, {
    headers: { 'User-Agent': userAgent, 'Accept': 'text/html' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`Provincia_p HTTP ${res.status}`)

  // Coleccionar todas las cookies del Set-Cookie (puede haber varias ASPSESSIONID).
  let cookies = ''
  if (typeof res.headers.getSetCookie === 'function') {
    const arr = res.headers.getSetCookie()
    cookies = arr.map(c => c.split(';')[0]).join('; ')
  } else {
    const sc = res.headers.get('set-cookie') || ''
    const m = sc.match(/(ASPSESSIONID[A-Z]+=[A-Z0-9]+)/)
    if (m) cookies = m[1]
  }
  if (!cookies) throw new Error('Sin cookie ASPSESSIONID')

  const buf = await res.arrayBuffer()
  const html = new TextDecoder('windows-1252').decode(buf)

  // Extraer opciones del select vzona (omitiendo "0" placeholder).
  const zonas = []
  const reSelect = /<select[^>]+name="vzona"[\s\S]*?<\/select>/i
  const mSelect = html.match(reSelect)
  if (!mSelect) throw new Error('Select vzona no encontrado')
  const reOpt = /<option\s+value="(\d+)"[^>]*>([\s\S]*?)<\/option>/gi
  let m
  while ((m = reOpt.exec(mSelect[0])) !== null) {
    const id = m[1]
    if (id === '0') continue
    zonas.push({ id, nombre: m[2].replace(/\s+/g, ' ').trim() })
  }
  return { cookies, zonas, referer: url }
}

/** Devuelve HTML del Guardias.asp para una zona y fecha. */
export async function fetchHtmlGuardias(provinciaId, zonaId, fecha, cookies, referer, userAgent) {
  const url = `${CGCOF_HOST}/web_guardias/Guardias.asp?date=${fecha}&vzona=${zonaId}&vmenu=1&provincia=${provinciaId}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html',
      'Cookie': cookies,
      'Referer': referer,
    },
  })
  if (!res.ok) throw new Error(`Guardias HTTP ${res.status}`)
  const buf = await res.arrayBuffer()
  return new TextDecoder('windows-1252').decode(buf)
}

/** GET datos.asp?id=FARMID y parsear los campos basicos. */
export async function fetchDatosFarmacia(provinciaId, farmaciaId, cookies, referer, userAgent) {
  const url = `${CGCOF_HOST}/web_guardias/datos.asp?id=${farmaciaId}`
  const res = await fetch(url, {
    headers: {
      'User-Agent': userAgent,
      'Accept': 'text/html',
      'Cookie': cookies,
      'Referer': referer,
    },
  })
  if (!res.ok) return null
  const buf = await res.arrayBuffer()
  const html = new TextDecoder('windows-1252').decode(buf)

  const get = (label) => {
    // El HTML coloca el label en una <td> con `&nbsp;&nbsp;&nbsp;LABEL`
    // y el valor en la <td> siguiente dentro de `<font ... color: #a352ae;>`.
    // Usamos `(?:&nbsp;|\s)*` para tolerar nbsp repetidos o espacios.
    const re = new RegExp(`(?:&nbsp;|\\s)*${label}(?:&nbsp;|\\s)*<\\/font>[\\s\\S]*?#a352ae[^>]*>([\\s\\S]*?)<\\/font>`, 'i')
    const mm = html.match(re)
    return mm ? mm[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim() : ''
  }
  // El servidor envia "Direcci�n" / "Tel�fono" en Windows-1252 — al decodear
  // como windows-1252 deberia salir "Dirección" / "Teléfono".
  const titular = get('Titular')
  const direccion = get('Direcci(?:ón|on|�n)')
  const localidad = get('Localidad')
  const telefono = get('Tel(?:éfono|efono|�fono)').replace(/\s+/g, '')

  // Localidad viene como "(CCCCC) - NOMBRE" o "() - NOMBRE" (CP vacio en Badajoz).
  let cp = ''
  let municipio = localidad
  const mLoc = localidad.match(/^\(\s*(\d{5})?\s*\)\s*[\-:]?\s*(.*)$/)
  if (mLoc) {
    cp = mLoc[1] || ''
    municipio = mLoc[2].trim()
  }
  return { titular, direccion, municipio, cp, telefono }
}

/** Extrae IDs de farmacia del HTML de Guardias.asp + tipo de guardia (DIA/NOCHE). */
export function extraerFarmaciasDelHtml(html) {
  // El HTML tiene secciones que empiezan por
  //   GUARDIAS DE D&Iacute;A   ó   GUARDIAS DE NOCHE
  // Trackear la seccion activa para asignar tipo a cada farmacia.
  const out = []
  // Splitter por sub-secciones (DIA vs NOCHE).
  const idxDia = html.search(/GUARDIAS\s+DE\s+D[^A-Z]*A/i)
  const idxNoche = html.search(/GUARDIAS\s+DE\s+NOCHE/i)
  const seccion = (offset) => {
    if (idxDia !== -1 && idxNoche !== -1) {
      if (idxDia < idxNoche) return offset < idxNoche ? 'DIA' : 'NOCHE'
      return offset < idxDia ? 'NOCHE' : 'DIA'
    }
    if (idxDia !== -1) return 'DIA'
    if (idxNoche !== -1) return 'NOCHE'
    return ''
  }
  const re = /abbre\(\d+,(\d+),0\)/g
  let m
  const seen = new Set()
  while ((m = re.exec(html)) !== null) {
    const id = m[1]
    const tipo = seccion(m.index)
    const key = `${id}|${tipo}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id, tipo })
  }
  return out
}

/** Geocoding via Nominatim respetuoso (1.1s entre peticiones). Retorna [lat,lng] o null.
 *  Ante 429 (rate-limit) hace back-off exponencial hasta 3 reintentos. */
export async function geocodeNominatim(direccion, municipio, provincia, bbox, userAgent) {
  const q = `${direccion}, ${municipio}, ${provincia}, España`
  const url = `${NOMINATIM_URL}?format=json&limit=1&countrycodes=es&q=${encodeURIComponent(q)}`
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': userAgent } })
      if (res.status === 429) {
        // Rate-limit: dormir 30s, 60s, 120s y reintentar.
        const wait = 30000 * attempt
        console.error(`      Nominatim 429, esperando ${wait/1000}s...`)
        await new Promise(r => setTimeout(r, wait))
        continue
      }
      if (!res.ok) return null
      const data = await res.json()
      if (!Array.isArray(data) || data.length === 0) return null
      const lat = parseFloat(data[0].lat)
      const lng = parseFloat(data[0].lon)
      if (!isFinite(lat) || !isFinite(lng)) return null
      if (lat < bbox.minLat || lat > bbox.maxLat) return null
      if (lng < bbox.minLng || lng > bbox.maxLng) return null
      return [Math.round(lat * 1e5) / 1e5, Math.round(lng * 1e5) / 1e5]
    } catch { return null }
  }
  return null
}

export function fechaCgcof(d = new Date()) {
  // El portal usa formato DD/M/YYYY (sin cero a la izquierda en mes).
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`
}
