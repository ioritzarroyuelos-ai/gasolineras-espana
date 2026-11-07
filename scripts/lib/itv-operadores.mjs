import { parse } from 'node-html-parser'
import { coordenadasItv } from './itv-fuentes.mjs'

const limpia = v => String(v ?? '').replace(/\s+/g,' ').trim()
const clave = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'')
const regiones = (e, ids) => ids.includes(e.prov)

// Canales de reserva contrastados con la propia empresa. Los enlaces se vuelven
// a comprobar; una caída conserva su comprobación anterior, nunca la rejuvenece.
const CANALES = [
  { id:'applus', nombre:'Applus+ Iteuve', url:'https://www.applusiteuve.com/es-es/',
    operador:/APPLUS/i, reserva:/CITA\s*PREVIA/i,
    admite:e=>/^APPLUSITEUVE/.test(clave(e.op)) && regiones(e,['02','08','13','16','17','19','22','25','28','35','38','43','44','45','48','50']) },
  { id:'syc', nombre:'SYC Applus+', url:'https://www.applusiteuve.com/es-es/estaciones-itv/itv-galicia/',
    operador:/SYC\s*APPLUS/i, reserva:/CITA\s*PREVIA/i,
    admite:e=>/^(?:SUPYCONTROL|SUPERVISIONYCONTROL|SYC)/.test(clave(e.op)) && regiones(e,['15','27','32','36']) },
  { id:'itevelesa', nombre:'Itevelesa', url:'https://www.itevelesa.com/es/reserva-itv',
    operador:/ITEVELESA/i, reserva:/CITA\s*PREVIA/i,
    admite:e=>/^(?:GRUPO)?ITEVELESA/.test(clave(e.op)) },
  { id:'veiasa', nombre:'VEIASA', url:'https://www.itvcita.com/',
    operador:/VEIASA/i, reserva:/SOLICITAR\s*CITA/i,
    admite:e=>clave(e.op)==='VEIASA' && regiones(e,['04','11','14','18','21','23','29','41']) },
  { id:'itvasa', nombre:'ITVASA', url:'https://www.itvasa.es/citas/',
    operador:/ITVASA/i, reserva:/CITA\s*PREVIA/i,
    admite:e=>clave(e.op)==='ITVASA' && e.prov==='33' },
  { id:'itasua', nombre:'ITASUA', url:'https://itasua.com/es/cita-previa/',
    operador:/ITASUA/i, reserva:/CITA\s*PREVIA/i,
    admite:e=>/^(?:ITAASUA|ITASUA)/.test(clave(e.op)) && regiones(e,['01','20']) },
  { id:'sitval', nombre:'SITVAL', url:'https://citaitvsitval.com/',
    operador:/SITVAL/i, reserva:/CITA\s*PREVIA/i,
    admite:e=>clave(e.op)==='SITVAL' && regiones(e,['03','12','46']) },
]

// El Gobierno Vasco identifica estas páginas como las del operador de cada
// estación: https://www.euskadi.eus/itv/. No se utiliza un buscador de terceros.
for (const [codigo,slug,nombre] of [['4804','amorebieta','Amorebieta'],['4802','trapaga','Trápaga'],['4805','zalla','Zalla']]) {
  CANALES.push({ id:'sgs-'+codigo, nombre:'SGS ITV '+nombre,
    url:'https://www.serviciositv.es/cita-previa-itv/vizcaya/'+slug,
    operador:/SGS/i, reserva:/CITA|RESERVA/i, ficha:nombre,
    admite:e=>e.prov==='48' && e.codigo===codigo && /^(?:INSPECCIONTECNICALINK|ITELINK)/.test(clave(e.op)) })
}

function nodosJsonLd(doc) {
  return doc.querySelectorAll('script[type="application/ld+json"]').flatMap(s => {
    try { const datos=JSON.parse(s.text); return datos['@graph'] || (Array.isArray(datos) ? datos : [datos]) } catch { return [] }
  })
}

function fichaSgs(doc, canal, estacion, consulta) {
  const ficha = nodosJsonLd(doc).find(n => n.url===canal.url && [].concat(n['@type']).includes('LocalBusiness'))
  if (!ficha || clave(ficha.name)!==clave('ITV '+canal.ficha) || ficha.address?.postalCode!==estacion.cp
      || !limpia(ficha.address.streetAddress) || !limpia(ficha.address.addressLocality))
    throw Error('La ficha del operador no coincide con la estación')
  const coords=coordenadasItv(ficha.geo?.latitude,ficha.geo?.longitude)
  if (coords.lat===null) throw Error('La ficha carece de coordenadas válidas')
  const telefono=limpia(ficha.telephone)
  if (!/^(?:\+34)?[6789]\d{8}$/.test(telefono)) throw Error('La ficha carece de teléfono válido')
  const horario=limpia(doc.querySelector('.field--name-horarios')?.text)
  if (!horario || horario.length>1000) throw Error('Falta el horario publicado')
  return { nombre:limpia(ficha.name), mun:limpia(ficha.address.addressLocality),
    dir:limpia(ficha.address.streetAddress), cp:estacion.cp, tel:telefono, ...coords, horario,
    fuente:'operador-sgs', fuenteUrl:canal.url, verificadoEn:consulta, publicadoEn:undefined,
    contactoFuente:'SGS ITV', contactoFuenteUrl:canal.url, contactoVerificadoEn:consulta }
}

function formularioItvasa(doc, url) {
  // Formulario observado en el enlace de primera inspección de www.itvasa.es.
  // El título y los textos del menú también existen en páginas sin reserva.
  doc.querySelectorAll('script,style,noscript,template').forEach(n=>n.remove())
  const cuerpo=doc.querySelector('body'), formulario=cuerpo?.querySelector('form#Datos')
  if (!formulario || !/ITVASA/i.test(limpia(cuerpo.text))
      || !/CITA\s*PREVIA/i.test(limpia(cuerpo.text))
      || formulario.getAttribute('method')?.toLowerCase()!=='post') return false
  let destino
  try { destino=new URL(formulario.getAttribute('action') || '',url) } catch { return false }
  if (destino.origin!==new URL(url).origin || destino.username || destino.password
      || !/^\/citas\/(?:Default\.aspx)?$/i.test(destino.pathname)) return false
  if (!['nombre','cif','telefono','matricula'].every(nombre=>{
    const campo=formulario.querySelector('input[name="'+nombre+'"]')
    return campo && !campo.hasAttribute('disabled') && !campo.hasAttribute('readonly')
      && !['hidden','password'].includes(campo.getAttribute('type')?.toLowerCase())
  })) return false
  const selector=formulario.querySelector('select[name="selEstacion"]')
  const estaciones=selector?.querySelectorAll('option').filter(o=>
    o.getAttribute('value') && o.getAttribute('value')!=='0' && !o.hasAttribute('disabled')
      && /^ITV\s+D(?:E|EL)\s+/i.test(limpia(o.text))) || []
  const continuar=formulario.querySelector('input[name="btn_continuar"][type="submit"]')
  return !selector?.hasAttribute('disabled') && new Set(estaciones.map(o=>clave(o.text))).size>=2
    && !!continuar && !continuar.hasAttribute('disabled')
}

function errorOperador(error) {
  // Node agrupa los fallos de red bajo "fetch failed". Guardamos la causa
  // concreta sin incluir certificados, cabeceras ni contenido de la respuesta.
  const codigos=new Set()
  const visita=(e,nivel=0)=>{
    if (!e || nivel>4) return
    if (/^[A-Z0-9_]{3,60}$/.test(e.code || '')) codigos.add(e.code)
    visita(e.cause,nivel+1)
    if (Array.isArray(e.errors)) e.errors.forEach(causa=>visita(causa,nivel+1))
  }
  visita(error)
  return limpia((codigos.size ? '['+[...codigos].join(', ')+'] ' : '')+(error?.message || error)).slice(0,160)
}

function falloTemporal(error,nivel=0) {
  if (!error || nivel>4) return false
  if (error.temporal===true || error.name==='TimeoutError') return true
  if (['UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT',
    'UND_ERR_SOCKET','ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(error.code)) return true
  if (Array.isArray(error.errors) && error.errors.length)
    return error.errors.every(e=>falloTemporal(e,nivel+1))
  return falloTemporal(error.cause,nivel+1)
}

async function leerCanal(canal,fetcher) {
  const intentos=canal.id==='itvasa' ? 2 : 1
  const limite=canal.id==='itvasa' ? 20000 : 12000
  for (let intento=1;intento<=intentos;intento++) {
    try {
      // Sólo lecturas GET: nunca se envían datos personales ni formularios.
      const res=await fetcher(canal.url,{method:'GET',signal:AbortSignal.timeout(limite)})
      if (!res.ok) {
        const temporal=[408,500,502,503,504].includes(res.status) && !res.headers.has('Retry-After')
        await res.body?.cancel().catch(()=>{})
        throw Object.assign(Error('HTTP '+res.status),{temporal})
      }
      if (res.url && new URL(res.url).origin!==new URL(canal.url).origin) throw Error('Redirección fuera del operador')
      return parse(await res.text())
    } catch(error) {
      if (intento===intentos || !falloTemporal(error)) throw error
      // Dos intentos como máximo: unos 40,5 s de límite total en ITVASA.
      await new Promise(resolve=>setTimeout(resolve,500))
    }
  }
}

export async function actualizaOperadoresItv(estaciones, anteriores={}, opciones={}) {
  const consulta=new Date(opciones.ahora ?? Date.now()).toISOString(), fetcher=opciones.fetcher || fetch
  const perfiles={}
  const activos=CANALES.filter(c=>estaciones.some(e=>c.admite(e)))
  await Promise.all(activos.map(async canal=>{
    const previa=anteriores[canal.id]
    try {
      const doc=await leerCanal(canal,fetcher)
      // Se comprueban identidad y reserva en el contenido, no sólo HTTP 200.
      const titulo=limpia(doc.querySelector('title')?.text)
      const texto=limpia(doc.text)
      if (!canal.operador.test(texto) || !canal.reserva.test(texto)
          || /Just a moment|Access denied|Login -/i.test(titulo))
        throw Error('No se reconoce el canal oficial de citas')
      if (canal.id==='itvasa' && !formularioItvasa(doc,canal.url))
        throw Error('No se encuentra el formulario de citas de ITVASA')
      const estacion=estaciones.find(e=>canal.admite(e))
      const detalles=canal.ficha ? fichaSgs(doc,canal,estacion,consulta) : undefined
      const registro=canal.ficha ? clave([estacion.prov,estacion.codigo,estacion.cp,estacion.dir,estacion.op]) : undefined
      perfiles[canal.id]={url:canal.url,nombre:canal.nombre,consultado:consulta,ultimoExito:consulta,estado:'actualizada',detalles,registro}
    } catch(e) {
      perfiles[canal.id]={...(previa?.url===canal.url ? previa : {}),url:canal.url,nombre:canal.nombre,
        consultado:consulta,estado:'conservada',error:errorOperador(e)}
    }
  }))
  const resultado=estaciones.map(e=>{
    const canal=activos.find(c=>c.admite(e)), perfil=canal && perfiles[canal.id]
    if (!perfil?.ultimoExito) return e
    // Una dirección/código postal cambiado invalida también la ficha conservada.
    const detalles=perfil.detalles?.cp===e.cp && perfil.registro===clave([e.prov,e.codigo,e.cp,e.dir,e.op]) ? perfil.detalles : undefined
    return { ...e, ...detalles, ...(detalles ? {
      municipioFuente:e.municipioFuente || e.mun,
      aliasMunicipios:[...new Set([e.mun,...(e.aliasMunicipios || []),detalles.mun])],
    } : {}), citaUrl:perfil.url, webUrl:perfil.url,
      citaVerificadoEn:perfil.ultimoExito, webVerificadoEn:perfil.ultimoExito }
  })
  return { estaciones:resultado, perfiles }
}
