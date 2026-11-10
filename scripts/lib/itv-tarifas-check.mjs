// Revisión de los componentes contrastados el 10/11/2026. Nunca sustituye una
// revisión normativa ni incorpora importes nuevos sin conocer sus condiciones.
// Los patrones leen la fila/epígrafe aplicable, no un hash de menús o anuncios.
export const COMPROBACIONES_TARIFAS = {
  andalucia: { total:[33.28,38.39], checks:[/turismos de menos de 1600cc\s*-?\s*29,11\s*€\s*gasolina\s*33,28\s*€\s*diesel.{0,18}38,39\s*€/, /iva\s*\(21%\)/, /trafico\s*\(4,18 euros\)/] },
  aragon: { total:[49.56,60.76], checks:[/orden pej\/1853\/2025/, /1\.2\s+de turismo.{0,700}?37,50\s+1\.3/, /1\.5\s+de turismo.{0,700}?46,76\s+1\.6/] },
  asturias: { total:[45.32,45.32], checks:[/servicios itvasa 2026/, /iva actualmente vigente del 21%/, /importe actual 4,18 euros/, /turismos \(incluido transporte escolar\)\s*34\s*€\s*\(51\s*€\)/] },
  canarias: { total:[43.52,53.26], checks:[/2026/, /turismos.{0,150}gasolina catalizados\s*31,81\s*€\s*4,96\s*€\s*diesel.{0,30}31,81\s*€\s*14,06/] },
  cantabria: { total:[55.25,61.98], checks:[/2026/, /33,77/, /catalizados:\s*8,44/, /compresion ligeros mma menor o igual a 3500 kg:\s*14 euros/] },
  'castilla-la-mancha': { total:[44.50,57.23], checks:[/2026/, /24,24/, /8,22/, /18,74/, /cataliz/, /diesel/] },
  'castilla-y-leon': { total:[51.18,60.51], checks:[/2026/, /vehiculos de hasta 3500 kg\.\s*30,95/, /catalizados\s*7,89/, /diesel de hasta 3500 kg\.\s*15,60/] },
  cataluna: { total:[40.60,45.59], checks:[/precios itv cataluna/, /turismos particulares\s*descripcion\s*tarifa\s*no catalizados\s*39,58\s*€\s*catalizados\s*40,60\s*€\s*diesel\s*45,59\s*€/, /tarifas incorporan la tasa.{0,80}iva/] },
  'comunitat-valenciana': { total:[41.47,56.15], checks:[/desde 01 enero 2023/, /turismos\s*-\s*furgonetas/, /catalizado\s*33,07\s*21,82\s*41,47\s*50,87\s*diesel\s*-\s*36,50\s*56,15\s*75,64/, /incluyen iva y tasa de trafico de 4,18/] },
  extremadura: { total:[33.43,33.43], pages:[1,67], checks:[/23 de septiembre de 2026/, /16009-0/, /1\.1\.1\.-\s*tasa inspeccion periodica vehiculos ligeros\s*\(mmta.{0,3}3\.500 kg\)\s*29,25\s*€/] },
  galicia: { total:[43.76,52.30], checks:[/tarifas vigentes/, /turismos particulares\s*gasolina \(sin catalizador\)\s*38,50\s*€\s*gasolina \(catalizados\)\s*43,76\s*€\s*diesel \(matriculado despues de 1980\)\s*52,30\s*€/, /trafico \(4,18€\) y el iva \(21%\)/] },
  'illes-balears-mallorca': { total:[21.19,35.10], checks:[/2020/, /17,01/, /13,91/, /turismes|turismos/, /gasos|gases/] },
  'illes-balears-eivissa': { total:[32.18,32.18], checks:[/2026/, /consell insular d.eivissa/, /vehicles 2.{0,12}categoria: inspeccio periodica de turismes, quadricicles i vehicles de mma fins a 3500 kg\s*28/] },
  melilla: { total:[43.09,43.09], checks:[/para el ano 2026/, /turismos \(clasificaciones 6 y 10 del reglamento general de vehiculos\)\s*29,06\s*1,16\s*4,18\s*34,40/, /control de emisiones gaseosas\s*8,35\s*0,33\s*8,69/, /prueba de diagnosis via obd\s*5,23\s*0,21\s*5,44/] },
  'pais-vasco': { total:[59.46,61.92], checks:[/2026/, /m1\s*47,72\s*57,74\s*45,69\s*55,28/, /iva \(21\s*%\)/] },
  'tasa-dgt': { checks:[/4\.6\s+anotacion del resultado de la itv\s+anotacion del resultado de la inspeccion tecnica de vehiculos.{0,260}4,18\s*€/] },
  'tasa-clm': { checks:[/2026/, /inspecci[oó]n.{0,160}veh[ií]culos.{0,250}1,04/] },
}

export function textoTarifas(raw) {
  return String(raw).replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi,' ')
    .replace(/<\/?[a-z][^>]*>|<![^>]*>/gi,' ')
    // Una sola pasada: una entidad que produce «&» nunca vuelve a decodificarse.
    .replace(/&(?:#(\d+)|#x([\da-f]+)|(nbsp|euro|amp|lt|gt|quot|apos|[aeiou]acute|ntilde));/gi, (entity, decimal, hex, named) => {
      if (named) return {nbsp:' ',euro:'€',amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",aacute:'á',eacute:'é',iacute:'í',oacute:'ó',uacute:'ú',ntilde:'ñ'}[named.toLowerCase()]
      const value = decimal ? Number(decimal) : parseInt(hex,16)
      return Number.isInteger(value) && value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff) ? String.fromCodePoint(value) : '\ufffd'
    })
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim()
}

export function compruebaTextoTarifa(id, raw, ahora = new Date()) {
  const spec = COMPROBACIONES_TARIFAS[id]
  if (!spec || ahora.toISOString().slice(0,10) > '2026-12-31') return false
  const text = textoTarifas(raw)
  return spec.checks.every(r => r.test(text))
}

export async function descargaTextoTarifa(url, pages, fetcher = fetch) {
  const response = await fetcher(url, {signal:AbortSignal.timeout(30000),headers:{'User-Agent':'EspanaUtil/1.0 (comprobacion de fuentes publicas)'}})
  if (!response.ok) throw Error('HTTP '+response.status)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length < 300 || bytes.length > 15000000) throw Error('Tamaño de documento inesperado')
  if (bytes[0] === 37 && bytes[1] === 80 && bytes[2] === 68 && bytes[3] === 70) {
    const {PDFParse} = await import('pdf-parse')
    const parser = new PDFParse({data:bytes,isEvalSupported:false})
    try { return (await parser.getText(pages ? {partial:pages} : {})).text } finally { await parser.destroy() }
  }
  return new TextDecoder().decode(bytes)
}

export async function compruebaFuenteTarifa(fuente, ahora = new Date(), descargar = descargaTextoTarifa) {
  const base = {id:fuente.id,url:fuente.url,checkedAt:ahora.toISOString()}
  try {
    const text = await descargar(fuente.url,COMPROBACIONES_TARIFAS[fuente.id]?.pages)
    if (!compruebaTextoTarifa(fuente.id,text,ahora)) return {...base,estado:'cambiada',error:'El contenido o la vigencia requieren una nueva revisión.'}
    return {...base,estado:'verificada'}
  } catch { return {...base,estado:'no_disponible',error:'No se pudo consultar el documento oficial.'} }
}
