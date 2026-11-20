// Detecta el informe original aunque sus gráficos aún no tengan un lector
// fiable. Nunca transforma texto narrativo, microdatos u OCR en estimaciones.
import { parse } from 'node-html-parser'
import { parseFecha } from './politica-parse.mjs'

const PAGINA = 'https://moreincommon.es/pulso-electoral.html'
const EMPRESA = 'More in Common'

export function urlInformeMoreInCommon(valor) {
  try {
    const u = new URL(valor, PAGINA)
    return u.origin === 'https://moreincommon.es' && !u.username && !u.password && !u.search && !u.hash
      && /^\/pdfs\/pulso-electoral\/pulso-electoral-[a-z]+-20\d{2}\.pdf$/.test(u.pathname) ? u.href : null
  } catch { return null }
}

async function descarga(url, maxBytes, fetchImpl, userAgent) {
  const r = await fetchImpl(url, {headers:{'User-Agent':userAgent}, redirect:'error', signal:AbortSignal.timeout(30000)})
  if (!r.ok) throw Error('More in Common: HTTP '+r.status)
  if (Number(r.headers.get('content-length')) > maxBytes) throw Error('More in Common: documento demasiado grande')
  const lector = r.body?.getReader()
  if (!lector) throw Error('More in Common: respuesta vacía')
  const partes = []; let total = 0
  try {
    while (true) {
      const {value,done} = await lector.read()
      if (done) break
      total += value.length
      if (total > maxBytes) throw Error('More in Common: documento demasiado grande')
      partes.push(value)
    }
  } catch (error) { await lector.cancel(); throw error }
  return Buffer.concat(partes)
}

async function textoPdf(bytes) {
  const { PDFParse } = await import('pdf-parse')
  const pdf = new PDFParse({data:new Uint8Array(bytes),isEvalSupported:false})
  try { return (await pdf.getText()).text } finally { await pdf.destroy() }
}

export async function fetchInformeMoreInCommon({hoy, comprobado, userAgent, fetchImpl=fetch, extraer=textoPdf}={}) {
  const html = (await descarga(PAGINA, 1000000, fetchImpl, userAgent)).toString('utf8')
  const urls = [...new Set(parse(html).querySelectorAll('a[href]').map(a=>urlInformeMoreInCommon(a.getAttribute('href'))).filter(Boolean))]
  if (urls.length !== 1) throw Error('More in Common: informe actual ausente o ambiguo')
  const bytes = await descarga(urls[0], 8*1024*1024, fetchImpl, userAgent)
  if (bytes.subarray(0,5).toString() !== '%PDF-') throw Error('More in Common: respuesta no es PDF')
  const texto = String(await extraer(bytes)).replace(/\s+/g,' ').trim()
  const fecha = /^Pulso electoral.{0,100}?\b(\d{1,2} de [a-z]+ de 20\d{2})\b/i.exec(texto)?.[1]
  const publicacion = parseFecha(fecha).fin
  if (!publicacion || publicacion > hoy || !/Estudio propio realizado por More in Common España/.test(texto)
    || !/Estimación de voto/i.test(texto) || !/elecciones generales/i.test(texto))
    throw Error('More in Common: identidad, ámbito o fecha no reconocidos')
  return {empresa:EMPRESA, url:urls[0], publicacion, comprobado}
}

export function informePendienteDeIncorporar(informe, sondeos) {
  const ultima = sondeos.filter(s=>s.empresa===informe.empresa).map(s=>s.publicacion).filter(Boolean).sort().at(-1)
  return !ultima || informe.publicacion > ultima ? informe : null
}

export async function compruebaInformePendiente(sondeos, anterior, opciones) {
  try {
    const informe = await fetchInformeMoreInCommon(opciones)
    return {pendiente:informePendienteDeIncorporar(informe,sondeos)}
  } catch (err) {
    const valido = anterior?.empresa === EMPRESA && urlInformeMoreInCommon(anterior.url)
    return {pendiente:valido ? informePendienteDeIncorporar(anterior,sondeos) : null, error:String(err.message || err)}
  }
}
