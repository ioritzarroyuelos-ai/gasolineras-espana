// Utilidades de ingesta: fechas españolas, peticiones acotadas y escritura atómica.
import { mkdirSync, writeFileSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const USER_AGENT = 'EspanaUtil/1.8 (+https://webapp-3ft.pages.dev/acerca)'
export function fechaMadrid(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}
export function desplazaFecha(fecha, dias) {
  const d = new Date(fecha + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}
export function rangoGuardia(fecha, desde, hasta) {
  const hora = s => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s)
  if (!hora(desde) || !hora(hasta)) throw new Error('Horario de guardia no válido')
  return `${fecha} ${desde}-${hasta > desde ? fecha : desplazaFecha(fecha, 1)} ${hasta}`
}
export function texto(value) { return String(value ?? '').replace(/\s+/g, ' ').trim() }
export function coordenadas(lat, lng, bbox) {
  const a = Number(lat), b = Number(lng)
  return Number.isFinite(a) && Number.isFinite(b) && a >= bbox[0] && a <= bbox[1] && b >= bbox[2] && b <= bbox[3]
    ? [a, b] : [0, 0]
}
export async function descargar(url, options = {}) {
  for (let intento = 0; intento < 3; intento++) {
    try {
      const r = await fetch(url, { ...options, headers: { 'User-Agent': USER_AGENT, ...options.headers }, signal: AbortSignal.timeout(20_000) })
      if (r.ok) return r
      const e = new Error(`HTTP ${r.status}: ${new URL(url).hostname}`)
      e.reintentar = r.status === 429 || r.status >= 500
      await r.body?.cancel()
      throw e
    } catch (e) {
      if (e.reintentar === false || intento === 2) throw new Error(`${e.message}${e.cause?.code ? ' (' + e.cause.code + ')' : ''}`, { cause: e })
      await new Promise(r => setTimeout(r, (intento + 1) * 1500))
    }
  }
}
export async function descargarJSON(url, options) {
  // Algunas fuentes devuelven una página HTML de error con HTTP 200.
  // Repetimos solo la respuesta ilegible, nunca aceptamos HTML como datos.
  for (let intento = 0; intento < 3; intento++) {
    const response = await descargar(url, options)
    try { return await response.json() }
    catch (error) {
      if (!(error instanceof SyntaxError)) throw error
      if (intento === 2) throw new Error('Respuesta JSON inválida de ' + new URL(url).hostname, { cause: error })
      await new Promise(resolve => setTimeout(resolve, (intento + 1) * 1500))
    }
  }
}
export async function descargarGuardiaHTML(territorio, url, encoding = 'utf-8') {
  try { return new TextDecoder(encoding).decode(await (await descargar(url)).arrayBuffer()) }
  catch (primaryError) {
    if (!['asturias', 'ceuta', 'avila'].includes(territorio)) throw primaryError
    console.warn(`${territorio}: la conexión directa falla; comprobamos el respaldo de Cloudflare`)
    const data = await descargarRespaldo(territorio, url)
    if (typeof data.html !== 'string') throw new Error('Respaldo sin listado HTML')
    return data.html
  }
}
export async function descargarRespaldo(territorio, source) {
  if (!['asturias', 'ceuta', 'almeria', 'avila'].includes(territorio)) throw new Error('Territorio de respaldo no permitido')
  const origin = process.env.GUARDIAS_RELAY_ORIGIN || 'https://espana-util-guardias.ioritz-arroyuelos.workers.dev'
  if (!/^https:\/\/espana-util-guardias(?:-pr-\d+|-preview)?\.ioritz-arroyuelos\.workers\.dev$/.test(origin)) throw new Error('Origen de respaldo no permitido')
  const data = await descargarJSON(origin + '/' + territorio)
  const age = Date.now() - Date.parse(data?.fetchedAt)
  if (data?.source !== source || !Number.isFinite(age) || age < -300000 || age > 900000) throw new Error('Respaldo sin origen o fecha válidos')
  return data
}
export function guardarGuardias(territorio, source, guardias, { fecha = fechaMadrid(), min = 1, max = 1000, sourceUrl, incidencias = [], cobertura, avisosMunicipales, horariosCompletos = false, coordenadasOficiales = false, guardiasVerificadas = false } = {}) {
  if (guardias.length < min || guardias.length > max || guardias.some(r => !r[2] || !r[3])) {
    throw new Error(`Datos de ${territorio} incompletos: ${guardias.length} turnos; se conserva el último fichero`)
  }
  const dir = process.env.GUARDIAS_OUT_DIR || resolve(dirname(fileURLToPath(import.meta.url)), '../../public/data')
  const target = resolve(dir, `guardias-${territorio}.json`)
  const data = { ts: new Date().toISOString(), fecha, source, sourceUrl, territorio, incidencias, cobertura, coordenadasOficiales, count: guardias.length, ...(horariosCompletos ? { horariosCompletos: true } : {}),
    ...(guardiasVerificadas ? { guardiasVerificadas: true } : {}), avisosMunicipales,
    schema: ['lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc', 'provinciaId'], guardias }
  mkdirSync(dir, { recursive: true })
  writeFileSync(target + '.tmp', JSON.stringify(data))
  renameSync(target + '.tmp', target)
  console.log(`OK — ${guardias.length} turnos de ${fecha} en ${target}`)
  return data
}
