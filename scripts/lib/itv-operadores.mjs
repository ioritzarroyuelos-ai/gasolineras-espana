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

export async function actualizaOperadoresItv(estaciones, anteriores={}, opciones={}) {
  const consulta=new Date(opciones.ahora ?? Date.now()).toISOString(), fetcher=opciones.fetcher || fetch
  const perfiles={}
  const activos=CANALES.filter(c=>estaciones.some(e=>c.admite(e)))
  await Promise.all(activos.map(async canal=>{
    const previa=anteriores[canal.id]
    try {
      const res=await fetcher(canal.url,{signal:AbortSignal.timeout(12000)})
      if (!res.ok) throw Error('HTTP '+res.status)
      if (res.url && new URL(res.url).origin!==new URL(canal.url).origin) throw Error('Redirección fuera del operador')
      const doc=parse(await res.text())
      // Se comprueban identidad y reserva en el contenido, no sólo HTTP 200.
      const titulo=limpia(doc.querySelector('title')?.text)
      const texto=limpia(doc.text)
      if (!canal.operador.test(texto) || !canal.reserva.test(texto)
          || /Just a moment|Access denied|Login -/i.test(titulo))
        throw Error('No se reconoce el canal oficial de citas')
      const estacion=estaciones.find(e=>canal.admite(e))
      const detalles=canal.ficha ? fichaSgs(doc,canal,estacion,consulta) : undefined
      const registro=canal.ficha ? clave([estacion.prov,estacion.codigo,estacion.cp,estacion.dir,estacion.op]) : undefined
      perfiles[canal.id]={url:canal.url,nombre:canal.nombre,consultado:consulta,ultimoExito:consulta,estado:'actualizada',detalles,registro}
    } catch(e) {
      perfiles[canal.id]={...(previa?.url===canal.url ? previa : {}),url:canal.url,nombre:canal.nombre,
        consultado:consulta,estado:'conservada',error:limpia(e.message).slice(0,160)}
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
