// La tabla recopilada puede sumar PP y PP–UPN bajo una sola etiqueta. Sólo el
// PDF del editor permite conservar la identidad y la proyección de cada lista.
import { parseFecha } from './politica-parse.mjs'

const MAX_BYTES = 8 * 1024 * 1024
const limpia = s => String(s || '').replace(/[\uE081\uE082\uE088\uE089\uE09D\uE09E\uE092]/g,
  c => ({'\uE081':'(', '\uE082':')', '\uE088':'-', '\uE089':'–', '\uE09D':'+', '\uE09E':'-', '\uE092':':'})[c])
  .replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim()
const clave = s => limpia(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]/g, '')

export function urlSeguimientoPdf(valor) {
  try {
    const u = new URL(valor)
    return u.origin === 'https://laseptima.com' && !u.username && !u.password && !u.search && !u.hash
      && /^\/wp-content\/uploads\/20\d{2}\/\d{2}\/barometro-n\d{1,3}-\d{1,2}[a-z]{3}20\d{2}\.pdf$/.test(u.pathname) ? u.href : null
  } catch { return null }
}

const alias = { psoe:'psoe', pp:'pp-sin-navarra', vox:'vox', frenteamplio:'fa', erc:'erc', ehbildu:'ehbildu',
  junts:'junts', eajpnv:'pnv', adelanteandalucia:'aa', bng:'bng', coalicioncanaria:'cca',
  ppupnnavarra:'ppupn-navarra', podemos:'podemos', salf:'salf', teruelexiste:'teruelexiste', otrascandidaturas:'otras' }

export function tablaSeguimientoPdf(texto, candidato, hoy) {
  const url = urlSeguimientoPdf(candidato?.fuenteUrl)
  if (!url) throw Error('SW: documento fuera del editor oficial')
  const lineas = String(texto).split(/\r?\n/).map(limpia)
  const todo = lineas.join(' ')
  if (!/Un estudio de SW Demoscopia para La Séptima/.test(todo) || !/Elecciones Generales 29 de noviembre de 2026/.test(todo))
    throw Error('SW: identidad o elección del informe no reconocida')
  const entrega = /Entregado el (\d{1,2} de [a-záéíóú]+ de 20\d{2})/i.exec(todo)?.[1]
  const publicacion = parseFecha(entrega, 2026).fin
  const muestraCampo = /Jornadas del (\d{1,2} de [a-záéíóú]+ al \d{1,2} de [a-záéíóú]+)\s*·\s*([\d.]+) entrevistas/i.exec(todo)
  const campo = parseFecha(muestraCampo?.[1].replace(/ de /g, ' ').replace(' al ', '–'), Number(publicacion?.slice(0,4)))
  const muestra = Number(muestraCampo?.[2].replaceAll('.', ''))
  if (!publicacion || publicacion > hoy || !campo.inicio || !campo.fin || campo.fin > publicacion || !Number.isSafeInteger(muestra) || muestra < 1
    || candidato.campoFin !== campo.fin || candidato.publicacion && candidato.publicacion !== publicacion || candidato.muestra && candidato.muestra !== muestra)
    throw Error('SW: fecha, muestra o documento enlazado no coinciden')
  const comienzos = lineas.map((l,i) => l === 'Voto y escaños por candidatura' ? i : -1).filter(i=>i>=0)
  if (comienzos.length !== 1) throw Error('SW: tabla nacional ambigua o ausente')
  const inicio = comienzos[0], fin = lineas.findIndex((l,i)=>i>inicio && l.startsWith('Bloques y mayorías'))
  if (fin < 0 || !/^Candidatura % voto Escaños \(central\) Mediana P25–P75 P10–P90 2023 \(23-J\) Dif\.$/.test(lineas[inicio+1]))
    throw Error('SW: columnas de escaños no reconocidas')
  // Esta nota distingue el PP del resto de España de la candidatura navarra.
  if (!/Navarra: PP y UPN en lista única, presentada como candidatura propia \(PP–UPN\) fuera del total del PP/.test(todo))
    throw Error('SW: no está confirmada la separación de PP y PP–UPN')
  const filas = lineas.slice(inicio+2,fin).filter(Boolean)
  if (!/^Total 100,0 350 350 350$/.test(filas.pop() || '')) throw Error('SW: total nacional no reconocido')
  const candidaturas = [], datos = [], vistos = new Set()
  for (const fila of filas) {
    const m = /^(.+?) (\d{1,3},\d) (\d{1,3}) (\d{1,3}) (\d{1,3})–(\d{1,3}) (\d{1,3})–(\d{1,3}) (\d{1,3}) ([+-]\d{1,3})$/.exec(fila)
    if (!m) throw Error('SW: fila nacional no reconocida')
    const id = alias[clave(m[1])], pct = Number(m[2].replace(',','.')), escanos = Number(m[3]), mediana = Number(m[4])
    const [q25,q75,q10,q90] = m.slice(5,9).map(Number)
    if (!id || vistos.has(id) || pct > 100 || escanos > 350 || q10 > q25 || q25 > mediana || mediana > q75 || q75 > q90 || q90 > 350)
      throw Error('SW: candidatura, valor o intervalo incoherente')
    vistos.add(id)
    const nombre = id === 'pp-sin-navarra' ? 'PP (sin Navarra)' : id === 'ppupn-navarra' ? 'PP–UPN (Navarra)' : m[1]
    candidaturas.push({id, siglas:nombre, nombre})
    datos.push({candidaturaId:id, pct, escanos})
  }
  if (!vistos.has('pp-sin-navarra') || !vistos.has('ppupn-navarra') || datos.length < 10
    || datos.reduce((s,d)=>s+d.escanos,0) !== 350 || Math.abs(datos.reduce((s,d)=>s+d.pct,0)-100) > 0.2)
    throw Error('SW: reparto nacional incompleto')
  return {candidaturas, sondeo:{empresa:'SW Demoscopia', comitente:'La Séptima', campoInicio:campo.inicio, campoFin:campo.fin,
    publicacion, muestra, fuenteUrl:url, datos, fuenteVerificada:'sw-pdf-v1',
    notaFuente:'Escaños: reparto central del informe, distinto de las medianas y los rangos. El PP excluye Navarra; PP–UPN (Navarra) figura por separado.'}}
}

async function leePdf(url, fetchImpl, userAgent) {
  const r = await fetchImpl(url,{headers:{'User-Agent':userAgent},redirect:'manual',signal:AbortSignal.timeout(30000)})
  if (!r.ok || r.url && r.url !== url || Number(r.headers.get('content-length')) > MAX_BYTES) {
    await r.body?.cancel(); throw Error('SW: documento no disponible (HTTP '+r.status+')')
  }
  const reader = r.body?.getReader(), partes = []; let total = 0
  if (!reader) throw Error('SW: documento sin contenido')
  try { for (;;) { const {value,done} = await reader.read(); if (done) break; total += value.byteLength
    if (total > MAX_BYTES) throw Error('SW: documento demasiado grande'); partes.push(value) }
  } finally { await reader.cancel().catch(()=>{}) }
  const bytes = new Uint8Array(total); let offset = 0
  for (const parte of partes) { bytes.set(parte,offset); offset += parte.length }
  if (total < 300 || new TextDecoder().decode(bytes.slice(0,4)) !== '%PDF') throw Error('SW: el editor no entregó un PDF')
  const {PDFParse} = await import('pdf-parse')
  const parser = new PDFParse({data:bytes,isEvalSupported:false})
  try { return (await parser.getText()).text } finally { await parser.destroy() }
}

export async function fetchSeguimientoPdf(candidatos, {hoy, userAgent, fetchImpl=fetch, extraer=leePdf}={}) {
  const porUrl = new Map()
  for (const candidato of candidatos) if (urlSeguimientoPdf(candidato.fuenteUrl)) {
    const previo = porUrl.get(candidato.fuenteUrl)
    if (previo && previo.campoFin !== candidato.campoFin) throw Error('SW: documento asignado a dos jornadas distintas')
    porUrl.set(candidato.fuenteUrl,candidato)
  }
  // Las tres últimas entregas cubren la actualización y la comparación diaria.
  // Las anteriores que ya fueron verificadas se conservan en el robot.
  const elegidos = [...porUrl.values()].sort((a,b)=>b.campoFin.localeCompare(a.campoFin)).slice(0,3)
  if (!elegidos.length) throw Error('SW: no hay informes originales enlazados')
  const sondeos = [], candidaturas = new Map(), fallos = []
  for (const candidato of elegidos) {
    try {
      const resultado = tablaSeguimientoPdf(await extraer(candidato.fuenteUrl,fetchImpl,userAgent),candidato,hoy)
      sondeos.push(resultado.sondeo)
      for (const c of resultado.candidaturas) candidaturas.set(c.id,c)
    } catch { fallos.push(candidato.campoFin) }
  }
  return {sondeos, candidaturas:[...candidaturas.values()], fallos}
}
