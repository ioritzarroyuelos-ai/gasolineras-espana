import { parse } from 'node-html-parser'
import { readSheet } from 'read-excel-file/node'
import { PROVINCIAS_INE } from './provincias-ine.mjs'

export const FUENTES_ITV = [
  { id: 'dgt', nombre: 'DGT', url: 'https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/',
    // Capa pública enlazada por https://gis.dgt.es/mapa/js/capas.js (mapa de la DGT).
    descarga: 'https://services-eu1.arcgis.com/xMJSZjeskIpAzCcP/arcgis/rest/services/ITV_pre/FeatureServer/0' },
  { id: 'industria', nombre: 'Ministerio de Industria y Turismo',
    url: 'https://industria.gob.es/Calidad-Industrial/vehiculos/Paginas/inspeccion-tecnica-vehiculos.aspx' },
  { id: 'gva', nombre: 'Generalitat Valenciana',
    url: 'https://dadesobertes.gva.es/dataset/f5b0a27c-0ae5-41a4-93bb-d18ea34243ec',
    descarga: 'https://dadesobertes.gva.es/dataset/f5b0a27c-0ae5-41a4-93bb-d18ea34243ec/resource/0881b4a5-62c7-483c-ba57-748c965f633d/download/estaciones-itv.csv' },
]

const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const clave = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '')
const provincias = new Map(PROVINCIAS_INE.map(p => [clave(p.name), p.id]))
for (const [id, nombres] of [
  ['01',['ALAVA','ARABA','ARABA/ÁLAVA']], ['03',['ALICANTE/ALACANT']],
  ['07',['BALEARES','BALEARS ILLES','MALLORCA','MENORCA','IBIZA','FORMENTERA']],
  ['12',['CASTELLÓN/CASTELLÒ','CASTELLÓN DE LA PLANA/CASTELLÓ DE LA PLANA']],
  ['13',['CUIDAD REAL']], ['15',['LA CORUÑA','CORUÑA']], ['20',['GUIPUZCOA','GIPUZKOA']], ['25',['LLERIDA','LERIDA']],
  ['15',['CORUÑA (A)']], ['26',['RIOJA (LA)']], ['46',['VALENCIA/VALÈNCIA']],
  ['32',['ORENSE']], ['35',['GRAN CANARIA','FUERTEVENTURA','LANZAROTE']], ['38',['TENERIFE','LA PALMA','EL HIERRO','LA GOMERA']],
  ['48',['VIZCAYA']], ['51',['CIUDAD A CEUTA']], ['52',['CIUDAD A MELILLA']],
]) for (const nombre of nombres) provincias.set(clave(nombre), id)

const codigo = valor => /^\d{1,4}$/.test(limpia(valor)) ? limpia(valor).padStart(4, '0') : ''
const postal = valor => /^\d{1,5}$/.test(limpia(valor)) && Number(valor) > 0 ? limpia(valor).padStart(5, '0') : ''
const numero = valor => valor == null || limpia(valor) === '' || !Number.isFinite(Number(valor)) ? null : Number(valor)
const identidad = e => e.prov + '/' + e.codigo

// En estas filas el registro nacional omite "móvil" en el domicilio. El anexo
// de acreditación identifica cada unidad; no es una segunda estación fija.
const MOVILES_DOCUMENTADAS = new Map([
  ['22/2281','https://www.enac.es/documents/7020/5d576ff8-a25f-4c98-81bd-7b84c9f4de70'],
  ['22/2284','https://www.enac.es/documents/7020/5d576ff8-a25f-4c98-81bd-7b84c9f4de70'],
  ['22/2282','https://www.enac.es/documents/7020/5eadcb67-cedf-43f0-a3fc-4549bce07452'],
  ['50/5083','https://www.enac.es/documents/7020/2a4035d4-17bf-4993-abd0-e6d7d9ff88c2'],
  ['22/2283','https://www.enac.es/documents/7020/e5308483-85ac-4544-8c0c-b58556492756'],
  ['44/4481','https://www.enac.es/documents/7020/e5308483-85ac-4544-8c0c-b58556492756'],
  ['50/5082','https://www.enac.es/documents/7020/cd1536ec-d8e5-47fd-b36f-ae8f4064a5f3'],
  ['50/5084','https://www.enac.es/documents/7020/cd1536ec-d8e5-47fd-b36f-ae8f4064a5f3'],
  ['44/4482','https://www.enac.es/documents/7020/cd1536ec-d8e5-47fd-b36f-ae8f4064a5f3'],
  // El registro de julio sitúa por error la móvil de Alcañiz en Zaragoza.
  ['50/4482','https://www.enac.es/documents/7020/cd1536ec-d8e5-47fd-b36f-ae8f4064a5f3'],
])

export function coordenadasItv(lat, lng) {
  const a = numero(lat), o = numero(lng)
  return a !== null && o !== null && a >= 27 && a <= 44.5 && o >= -19 && o <= 5
    ? { lat: a, lng: o } : { lat: null, lng: null }
}

function estacion(datos, meta) {
  return { id: 'itv-' + datos.prov + '-' + datos.codigo, mun: '', dir: '', cp: '', tel: '', op: '',
    lat: null, lng: null, horario: '', lineas: null, ...datos, fuente: meta.id, fuenteUrl: meta.url,
    verificadoEn: meta.ultimoExito || meta.consultado, publicadoEn: meta.publicado }
}

export function estacionesDgt(geojson, meta) {
  if (!Array.isArray(geojson?.features)) throw Error('La DGT no entregó estaciones')
  if (geojson.exceededTransferLimit) throw Error('La DGT entregó un listado parcial')
  const estaciones = geojson.features.map(f => {
    const p = f?.properties || {}
    const prov = provincias.get(clave(p.provincia ?? p.Provincia)), cod = codigo(p.codigo_centro ?? p.Codigo_centro)
    const mun = limpia(p.municipio ?? p.Municipio), dir = limpia(p.direccion ?? p.Dirección)
    if (!prov || !mun || !dir || (!cod && !Number.isSafeInteger(p.OBJECTID_1)))
      throw Error('Estación DGT sin provincia, municipio, dirección o identificador válido')
    if (f.geometry && (f.geometry.type !== 'Point' || !Array.isArray(f.geometry.coordinates)))
      throw Error('Geometría DGT desconocida')
    const coords = f.geometry?.coordinates
    const coord = coordenadasItv(coords?.[1] ?? p.latitud ?? p.Latitud, coords?.[0] ?? p.longitud ?? p.Longitud)
    return estacion({ codigo: cod, prov, mun, dir, cp: postal(p.codigo_postal ?? p.Código_postal),
      // OBJECTID_1 identifica la fila del mapa; nunca se presenta como código oficial de estación.
      ...(Number.isSafeInteger(p.OBJECTID_1) ? { idFuente:String(p.OBJECTID_1) } : {}),
      ...(!cod ? { id:'itv-'+prov+'-dgt-'+p.OBJECTID_1 } : {}),
      tel: limpia(p.telefono ?? p.Teléfono_1), op: limpia(p.nombre ?? p.Autoescuela), ...coord,
      lineas: numero(/L[íi]neas\s*:\s*(\d+)/i.exec(p.info ?? p.Info ?? '')?.[1]),
    }, meta)
  })
  return { estaciones, excluidas: [] }
}

// CSV con comillas, separadores dentro de una celda y saltos de línea escapados.
export function leeCsvItv(texto) {
  const filas = [], fila = []
  let valor = '', entreComillas = false
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i]
    if (c === '"') {
      if (entreComillas && texto[i + 1] === '"') { valor += '"'; i++ }
      else entreComillas = !entreComillas
    } else if (!entreComillas && (c === ';' || c === '\n')) {
      fila.push(valor.trim()); valor = ''
      if (c === '\n') { if (fila.some(Boolean)) filas.push([...fila]); fila.length = 0 }
    } else if (c !== '\r') valor += c
  }
  if (entreComillas) throw Error('CSV con una celda sin cerrar')
  fila.push(valor.trim())
  if (fila.some(Boolean)) filas.push(fila)
  const cabecera = filas.shift()?.map(h => h.replace(/^\uFEFF/, '')) || []
  return filas.map(f => Object.fromEntries(cabecera.map((h, i) => [h, f[i] || ''])))
}

export function estacionesGva(csv, meta) {
  const filas = leeCsvItv(csv), estaciones = []
  if (filas.length && !Object.hasOwn(filas[0], 'tipo_estacion')) throw Error('CSV valenciano con columnas desconocidas')
  for (const f of filas) {
    if (!/FIJA/i.test(f.tipo_estacion)) continue
    const cp = postal(f.cp), cod = codigo(f.num_estacion), prov = cp.slice(0, 2)
    if (!['03','12','46'].includes(prov) || !cod || !limpia(f.municipio) || !limpia(f.direccion)) continue
    estaciones.push(estacion({ codigo: cod, prov, cp, mun: limpia(f.municipio), dir: limpia(f.direccion),
      op: 'SITVAL', horario: limpia(f.horarios),
    }, meta))
  }
  return { estaciones, excluidas: [] }
}

function fechaCelda(valor) {
  if (valor instanceof Date && Number.isFinite(valor.getTime())) return valor.toISOString().slice(0,10)
  if (typeof valor === 'number' && valor > 10000 && valor < 100000)
    return new Date(Date.UTC(1899, 11, 30) + valor * 86400000).toISOString().slice(0,10)
  const texto = limpia(valor)
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0,10) : ''
}

export function estacionesIndustria(filas, meta, ahora = Date.now()) {
  const cabecera = filas.findIndex(f => clave(f[1]) === 'CODIGOESTACION' && clave(f[5]) === 'MUNICIPIO')
  if (cabecera < 0 || clave(filas[cabecera][13]) !== 'SUSPENSIONINICIO') throw Error('Registro nacional con columnas desconocidas')
  const estaciones = [], excluidas = []
  const hoy = new Date(ahora).toISOString().slice(0,10)
  for (const f of filas.slice(cabecera + 1)) {
    const cod = codigo(f[1]), cp = postal(f[7])
    const provinciaPostal = !limpia(f[4]) && cod.slice(0,2) === cp.slice(0,2) ? cp.slice(0,2) : undefined
    const prov = provincias.get(clave(f[4])) || provinciaPostal
    if (!cod) continue
    const acreditacionMovil = MOVILES_DOCUMENTADAS.get(prov+'/'+cod)
    const noFija = /MOVIL|AGRICOLA/.test(clave([f[4], f[5], f[6]].join(' '))) || clave(f[4]) === 'MOVIAG'
      || (acreditacionMovil && [f[9],f[10],f[11]].every(v=>numero(v)===0) && numero(f[12])>0)
    const inicio = fechaCelda(f[13]), fin = fechaCelda(f[14])
    const suspendida = Boolean(f[13]) && (!inicio || inicio <= hoy) && (!fin || fin >= hoy)
    const inactiva = /NOOPERATIVA|CERRADA|BAJADEFINITIVA/.test(clave(f[0]))
    // Estas tres estaciones sólo inspeccionan la flota del Departamento de Seguridad.
    // Instrucción del Gobierno Vasco 2026-02-10, apartado 1.2.2:
    // https://www.euskadi.eus/contenidos/informacion/industria_itv/eu_def/adjuntos/IAT_ITV_JARRAIBIDEA_2025_V2_REV2.pdf
    const flotaPropia = ['01/0120','20/2020','48/4820'].includes(prov+'/'+cod)
    if (noFija || suspendida || inactiva || flotaPropia) {
      // El código oficial permite evitar resucitar una baja desde una copia DGT anterior.
      excluidas.push({ codigo: cod, prov: prov || cod.slice(0,2), motivo: flotaPropia ? 'uso exclusivo de la flota de Seguridad' : suspendida || inactiva ? 'suspendida o no operativa' : 'unidad móvil o agrícola',
        ...(acreditacionMovil ? { fuenteUrl:acreditacionMovil,verificadoEn:'2026-11-07' } : {}) })
      continue
    }
    if (!prov || !limpia(f[5]) || !limpia(f[6])) continue
    estaciones.push(estacion({ codigo: cod, prov, mun: limpia(f[5]), dir: limpia(f[6]), cp,
      op: limpia(f[0]), lineas: numero(f[8]),
    }, meta))
  }
  return { estaciones, excluidas }
}

function sinDuplicados(estaciones) {
  const vistas = new Map()
  for (const e of estaciones) {
    const id = identidad(e)
    const previo = vistas.get(id)
    if (previo && (clave(previo.mun) !== clave(e.mun) || clave(previo.dir) !== clave(e.dir)))
      throw Error('Código '+e.codigo+' asignado a estaciones distintas')
    vistas.set(id, e)
  }
  return [...vistas.values()]
}

function municipiosCompatibles(a, b) {
  const nombresA = a.split('/').map(clave), nombresB = b.split('/').map(clave)
  return nombresA.some(n => n && nombresB.includes(n))
}

function mismoLugar(a, b) {
  return a.prov === b.prov && ((a.cp && a.cp === b.cp) || municipiosCompatibles(a.mun,b.mun))
}

function direccionComparable(valor) {
  return limpia(valor).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()
    .replace(/\b(?:CALLE|C|CTRA|CARRETERA|AVDA|AVENIDA|AV|POLIGONO|POLIG|POL|INDUSTRIAL|IND|PLG|P|I|DE|DEL|LA|EL|LAS|LOS|N|Nº|S|SN)\b/g,'')
    .replace(/[^A-Z0-9]/g,'')
}

function sedeCerrada(e) {
  // BORM 19-12-2023, resolución 7192: cese de la sede de carretera de Mula
  // km 1,800. La exclusión no afecta a una futura sede con otra dirección.
  // https://www.borm.es/services/boletin/ano/2023/numero/291/pdf
  return e.prov === '30' && e.codigo === '3001' && /^MULAKM1(?:8|800)$/.test(direccionComparable(e.dir))
}

// Pares contrastados entre el registro nacional/GVA y el mapa público DGT el
// 07-11-2026. DGT añade el núcleo al domicilio o codifica mal la í de Algemesí;
// mantiene código, CP y punto. No es una regla para admitir otras direcciones.
// Fuente de los cuatro puntos actuales: FUENTES_ITV[0].descarga, OBJECTID_1
// 214, 237, 457 y 352, respectivamente.
const DIRECCIONES_EQUIVALENTES = [
  {prov:'21',codigo:'2141',cp:'21530',principal:'Pol. Ind. Santa Bárbara, s/n.',dgt:'POL. IND. SANTA BÁRBARA, S/Nº. THARSIS'},
  {prov:'24',codigo:'2401',cp:'24231',principal:'CTRA ZAMORA, KM 11',dgt:'CTRA. ZAMORA KM. 11. CEMBRANOS'},
  {prov:'45',codigo:'4509',cp:'45224',principal:'Camino de Ciempozuelos, s/n',dgt:'CAMINO CIEMPOZUELOS, S/N. SESEÑA NUEVO'},
  {prov:'46',codigo:'4606',cp:'46600',principal:'CTRA. ALGEMESÍ, S/N',dgt:'CARRETERA ALGEMES͍, S/N.'},
]

function mismaDireccionConfirmada(principal, contacto) {
  if (direccionComparable(principal.dir) === direccionComparable(contacto.dir)) return true
  return DIRECCIONES_EQUIVALENTES.some(d=>d.prov===principal.prov && d.prov===contacto.prov
    && d.codigo===principal.codigo && d.codigo===contacto.codigo && d.cp===principal.cp && d.cp===contacto.cp
    && direccionComparable(d.principal)===direccionComparable(principal.dir) && direccionComparable(d.dgt)===direccionComparable(contacto.dir))
}

// Comprobaciones puntuales del 07-11-2026: no se renueva esta fecha al ejecutar
// el robot. El código, CP y domicilio nacional delimitan la estación; estos
// teléfonos no provienen de las filas sin código o duplicadas del mapa DGT.
const CONTACTOS_CONFIRMADOS = [
  {codigo:'3006',cps:['30100'],direccion:'AVDA. JUAN CARLOS I, SN',tel:'968307444',
    url:'https://mui.carm.es/ja/web/mui/listado-de-estaciones-itv-autorizadas'},
  {codigo:'3013',cps:['30201','30353'],direccion:'P.I. CABEZO BEAZA, CALLE BERLÍN, 1',tel:'968677199',cp:'30353',
    url:'https://www.itevelesa.com/es/nuestras-estaciones/itv-antigua-morata'},
  {codigo:'3010',cps:['30001','30007'],direccion:'AVDA. DE ALICANTE, 10',tel:'968852301',cp:'30007',
    url:'https://itvciudaddemurcia.com/contacto/'},
]

function contactoConfirmado(e, ahora) {
  const fecha = '2026-11-07'
  if (ahora < Date.parse(fecha) || e.prov !== '30') return e
  const dato = CONTACTOS_CONFIRMADOS.find(d=>d.codigo===e.codigo && d.cps.includes(e.cp)
    && direccionComparable(d.direccion)===direccionComparable(e.dir))
  if (!dato) return e
  // 868459510 corresponde a 3019/Av. Dr. Pedro Guillén, no a 3006. La web del
  // operador lo confirma: https://www.itevelesa.com/es/nuestras-estaciones/itv-av-mariano-rojas
  // Para 3013 se prioriza el número actual del operador (acabado en 199) sobre
  // el 196 de la copia anterior, aunque esa copia vuelva a consultarse hoy.
  const telefono = e.tel.replace(/\D/g,'')
  const superado = (e.codigo === '3006' && telefono === '868459510') || (e.codigo === '3013' && telefono === '968677196')
  const posterior = Date.parse(e.contactoVerificadoEn || '') >= Date.parse(fecha) && limpia(e.tel) && !superado
  return { ...e, ...(dato.cp ? {cp:dato.cp} : {}), ...(posterior ? {} : {
    tel:dato.tel, lat:null, lng:null, contactoVerificadoEn:fecha,
    contactoFuente:'operador o administración autonómica', contactoFuenteUrl:dato.url,
  }) }
}

function contactoDesde(estacion, contacto) {
  const mismaDireccion = mismaDireccionConfirmada(estacion,contacto)
  const coords = mismaDireccion ? coordenadasItv(contacto.lat, contacto.lng) : {lat:null,lng:null}
  const compatible = municipiosCompatibles(estacion.mun,contacto.mun)
  return { ...estacion,
    ...(compatible ? { mun:contacto.mun, municipioFuente:estacion.mun } : {}),
    aliasMunicipios: [...new Set([estacion.mun, ...(estacion.aliasMunicipios || []), ...(compatible ? [contacto.mun, ...(contacto.aliasMunicipios || [])] : [])])],
    tel: contacto.tel || '', ...coords,
    contactoVerificadoEn: contacto.verificadoEn, contactoFuente: contacto.fuente, contactoFuenteUrl: contacto.fuenteUrl }
}

// Correcciones de localidad contrastadas con el operador o la administración
// autonómica. Sólo se aplican al código, CP y dirección documentados; no permiten
// trasladar una estación futura ni renuevan esta comprobación al ejecutar el robot.
const MUNICIPIOS_CONFIRMADOS = [
  { prov:'48', codigo:'4804', cp:'48340', nombre:'AMOREBIETA-ETXANO', previos:['AMOREBIETA','AMOREBIETAETXANO'], direccion:/ZUBIETA/,
    url:'https://www.serviciositv.es/cita-previa-itv/vizcaya/amorebieta' },
  { prov:'04', codigo:'0441', cp:'04760', nombre:'BALANEGRA', previos:['BERJA','BALANEGRA'], direccion:/BALANEGRA/,
    url:'https://www.veiasa.es/itv/estaciones-itv/estaciones-fijas' },
  { prov:'37', codigo:'3703', cp:'37439', nombre:'CASTELLANOS DE MORISCOS', previos:['SALAMANCA','CASTELLANOSDEMORISCOS'], direccion:/CASTELLANOSDEMORISCOS/,
    url:'https://www.itevelesa.com/es/nuestras-estaciones/itv-castellanos-de-moriscos' },
  { prov:'38', codigo:'3812', cp:'38340', nombre:'TACORONTE', previos:['TACORONTE','SANTACRUZDETENERIFE'], direccion:/SANGRADERA/,
    url:'https://www.gobiernodecanarias.org/industria/temas/itv/Estaciones_ITV/index.html' },
  { prov:'38', codigo:'3807', cp:'38800', nombre:'SAN SEBASTIÁN DE LA GOMERA', previos:['SSEBASTIAN','SANSEBASTIANDELAGOMERA'], direccion:/GARCIACABRERA/,
    url:'https://www.gobiernodecanarias.org/industria/temas/itv/Estaciones_ITV/itv_canarias.json' },
]

function municipioConfirmado(e) {
  const correccion=MUNICIPIOS_CONFIRMADOS.find(m=>m.prov===e.prov && m.codigo===e.codigo && m.cp===e.cp
    && m.previos.includes(clave(e.mun)) && m.direccion.test(clave(e.dir)))
  return correccion ? { ...e, mun:correccion.nombre, municipioFuente:e.municipioFuente || e.mun,
    aliasMunicipios:[...new Set([e.mun,...(e.aliasMunicipios || []),correccion.nombre])],
    municipioVerificadoEn:'2026-11-07', municipioFuenteUrl:correccion.url } : e
}

export function combinaFuentesItv(fuentes, incidencias = []) {
  const industria = fuentes.find(f => f.id === 'industria'), gva = fuentes.find(f => f.id === 'gva'), dgt = fuentes.find(f => f.id === 'dgt')
  const nacionales = industria?.estaciones || []
  const base = new Map(nacionales.map(e => [identidad(e), e]))
  const excluidas = new Set((industria?.excluidas || []).map(identidad))
  const bloqueadas = new Set((industria?.excluidas || []).filter(e => e.motivo !== 'unidad móvil o agrícola').map(identidad))
  const anotar = (e,motivo,fuenteUrl=e.fuenteUrl || dgt?.url || FUENTES_ITV[0].url) => incidencias.push({id:e.id,
    ...(e.idFuente ? {idFuente:e.idFuente} : {}), codigo:e.codigo, prov:e.prov, motivo, fuenteUrl})
  for (const e of gva?.estaciones || []) {
    if (bloqueadas.has(identidad(e))) continue
    // La fuente autonómica mantiene los horarios y las altas posteriores al registro nacional.
    const anterior = base.get(identidad(e))
    base.set(identidad(e), { ...e, aliasMunicipios: [...new Set([e.mun, ...(anterior ? [anterior.mun] : [])])] })
    excluidas.delete(identidad(e))
  }
  const repetidos = new Map()
  for (const e of dgt?.estaciones || []) if (e.codigo) repetidos.set(identidad(e),(repetidos.get(identidad(e)) || 0)+1)
  const coincideDireccion = mismaDireccionConfirmada
  for (const e of dgt?.estaciones || []) {
    const porCodigo = e.codigo ? base.get(identidad(e)) : null
    if (sedeCerrada(e)) {
      anotar(e,'Sede cerrada por resolución BORM 7192 de diciembre de 2023','https://www.borm.es/services/boletin/ano/2023/numero/291/pdf')
      continue
    }
    if (MOVILES_DOCUMENTADAS.has(identidad(e)) || (!porCodigo && excluidas.has(identidad(e)))) {
      anotar(e,'Estación excluida por el registro nacional o acreditación oficial')
      continue
    }
    if (e.codigo && e.codigo.slice(0,2) !== e.prov) {
      anotar(e,'Código de estación incompatible con la provincia publicada por DGT')
      continue
    }
    const repetido = repetidos.get(identidad(e)) > 1
    const cpCompatible = porCodigo && (!porCodigo.cp || !e.cp || porCodigo.cp === e.cp)
    let destino = porCodigo && cpCompatible && mismoLugar(porCodigo,e)
      && (!repetido || coincideDireccion(porCodigo,e)) ? porCodigo : null
    if (!destino) {
      // Un código ausente o repetido no permite unir por municipio o CP solos.
      // La dirección también debe coincidir y sólo puede haber una candidata.
      const candidatos = [...base.values()].filter(b => b.fuente !== 'dgt' && b.prov === e.prov && b.cp && b.cp === e.cp
        && municipiosCompatibles(b.mun,e.mun) && coincideDireccion(b,e))
      if (candidatos.length === 1) destino = candidatos[0]
    }
    // La DGT no da código para La Gomera. El registro autonómico identifica 3807
    // en Transv. García Cabrera y enlaza esta ficha SGS, que también nombra Av.
    // José Aguiar. Sólo esta combinación documentada concilia ambas direcciones.
    // https://www.serviciositv.es/cita-previa-itv/canarias/santa-cruz-de-tenerife/la-gomera
    if (!destino && !e.codigo && e.prov === '38' && e.cp === '38800'
      && clave(e.mun) === 'SANSEBASTIANDELAGOMERA' && direccionComparable(e.dir) === 'JOSEAGUIAR'
      && e.tel.replace(/\D/g,'') === '922870138' && /SGS/.test(e.op)) {
      const gomera = base.get('38/3807')
      if (gomera?.cp === '38800' && clave(gomera.dir) === 'TRANSVGARCIACABRERA'
        && ['SSEBASTIAN','SANSEBASTIANDELAGOMERA'].includes(clave(gomera.mun))) destino = gomera
    }
    if (destino) {
      if (!municipiosCompatibles(destino.mun,e.mun))
        anotar(e,'Municipio DGT distinto; se conserva el municipio del registro nacional')
      base.set(identidad(destino), contactoDesde(destino,e))
    } else if (!e.codigo) {
      anotar(e,'Sin código oficial y sin coincidencia inequívoca de municipio, CP y dirección')
    } else if (porCodigo || repetido) {
      anotar(e,'Código con municipio, CP o dirección incompatibles; se conserva el registro nacional')
    } else {
      // Alta publicada por DGT con código propio, sin colisión ni baja nacional.
      const id = identidad(e) + '/' + clave(e.mun)
      base.set(id, { ...e, id: e.id + '-' + clave(e.mun).toLowerCase() })
    }
  }
  // Una copia de otra fuente no puede reintroducir estas unidades documentadas,
  // incluida Alcañiz cuando la DGT use su provincia correcta (44) y el registro 50.
  const resultado = [...base.values()].filter(e=>{
    if (sedeCerrada(e)) {
      anotar(e,'Sede cerrada por resolución BORM 7192 de diciembre de 2023','https://www.borm.es/services/boletin/ano/2023/numero/291/pdf')
      return false
    }
    return !MOVILES_DOCUMENTADAS.has(identidad(e))
  }).map(municipioConfirmado)
  if (new Set(resultado.map(e => e.id)).size !== resultado.length) throw Error('Identificadores repetidos tras combinar fuentes')
  return resultado.sort((a,b) => a.prov.localeCompare(b.prov) || a.mun.localeCompare(b.mun,'es') || a.codigo.localeCompare(b.codigo))
}

// Conserva nombres anteriores y el último contacto comprobado sólo si sigue
// siendo la misma sede. Un contacto nuevo, incluso incompleto, tiene prioridad:
// nunca se mezclan coordenadas antiguas con una fecha de contacto reciente.
export function conservaDatosPreviosItv(estaciones, anteriores = [], ahora = Date.now()) {
  estaciones = estaciones.map(e=>contactoConfirmado(e,ahora))
  anteriores = anteriores.map(e=>contactoConfirmado(e,ahora))
  const porCodigo = new Map()
  for (const anterior of anteriores) {
    const id = identidad(anterior)
    if (!porCodigo.has(id)) porCodigo.set(id,[])
    porCodigo.get(id).push(anterior)
  }
  return estaciones.map(e => {
    if (!/^\d{4}$/.test(e.codigo || '') || !/^\d{5}$/.test(e.cp || '') || !direccionComparable(e.dir)) return e
    const candidatas = (porCodigo.get(identidad(e)) || []).filter(a => a.cp === e.cp
      && direccionComparable(a.dir) === direccionComparable(e.dir))
    if (candidatas.length !== 1) return e
    const anterior = candidatas[0]
    const aliasMunicipios = [...new Set([e.mun,...(e.aliasMunicipios || []),anterior.mun,...(anterior.aliasMunicipios || [])]
      .filter(n => typeof n === 'string').map(limpia).filter(Boolean))]
    const comprobado = Date.parse(anterior.contactoVerificadoEn || '')
    const vacio = !limpia(e.tel) && e.lat == null && e.lng == null
      && !e.contactoVerificadoEn && !e.contactoFuente && !e.contactoFuenteUrl
    const coord = coordenadasItv(anterior.lat,anterior.lng)
    const valido = (limpia(anterior.tel) || coord.lat !== null) && Number.isFinite(comprobado) && comprobado <= ahora
      && limpia(anterior.contactoFuente) && /^https:\/\//.test(anterior.contactoFuenteUrl || '') && !sedeCerrada(e)
    return { ...e, aliasMunicipios, ...(vacio && valido ? {
      tel:limpia(anterior.tel), ...coord, contactoVerificadoEn:anterior.contactoVerificadoEn,
      contactoFuente:anterior.contactoFuente, contactoFuenteUrl:anterior.contactoFuenteUrl,
    } : {}) }
  })
}

export function migraCopiaDgt(snapshot) {
  const meta = { ...FUENTES_ITV[0], consultado: snapshot.generatedAt || '', ultimoExito: snapshot.generatedAt || '', estado: 'conservada' }
  return { ...meta, estaciones: (snapshot.estaciones || []).filter(e => e.fuente === 'dgt').map(e => estacion({
    ...e, codigo: codigo(e.id.replace(/^dgt-/, '')), ...coordenadasItv(e.lat,e.lng),
  }, meta)), excluidas: [] }
}

async function descargar(url, fetcher) {
  let ultimo
  for (let intento = 0; intento < 2; intento++) {
    try {
      const res = await fetcher(url, { signal: AbortSignal.timeout(15000), headers: { 'User-Agent': 'EspanaUtil-ITV/2.0 (+https://webapp-3ft.pages.dev)' } })
      if (res.ok) return res
      if (res.status < 500 && res.status !== 429) throw Object.assign(Error('HTTP '+res.status), { definitivo: true })
      throw Error('HTTP '+res.status)
    } catch (e) {
      ultimo = e
      if (e.definitivo) break
      if (!intento) await new Promise(r => setTimeout(r, 1000))
    }
  }
  throw ultimo
}

// El listado de IDs no está limitado como las páginas de resultados. Se descarga
// cada lote por sus IDs y se comprueba contra el recuento oficial antes de aceptar
// nada: una página repetida, cortada o fallida conserva la copia anterior entera.
async function descargaDgt(fuente, fetcher, ahora) {
  const leer = async (consulta, parametros) => {
    const url = new URL(fuente.descarga + (consulta ? '/query' : ''))
    url.search = new URLSearchParams(parametros).toString()
    const datos = await (await descargar(url.href, fetcher)).json()
    if (!datos || typeof datos !== 'object' || datos.error)
      throw Error('DGT: '+limpia(datos?.error?.message || 'respuesta desconocida'))
    if (datos.exceededTransferLimit) throw Error('La DGT entregó un listado parcial')
    return datos
  }
  const metadata = await leer(false, { f:'json' })
  const oid = metadata.objectIdField
  const editado = metadata.editingInfo?.dataLastEditDate
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(oid || '') || metadata.geometryType !== 'esriGeometryPoint'
    || !Number.isInteger(metadata.maxRecordCount) || metadata.maxRecordCount < 1
    || !metadata.fields?.some(f => f.name === oid && f.type === 'esriFieldTypeOID'))
    throw Error('Metadatos DGT desconocidos')
  if (!Number.isSafeInteger(editado) || editado <= 0 || editado > ahora)
    throw Error('Fecha de edición DGT ausente o futura')
  const [recuento, listado] = await Promise.all([
    leer(true, { f:'json', where:'1=1', returnCountOnly:'true' }),
    leer(true, { f:'json', where:'1=1', returnIdsOnly:'true' }),
  ])
  const ids = listado.objectIds
  if (!Number.isInteger(recuento.count) || recuento.count < 1 || recuento.count > 10000
    || !Array.isArray(ids) || ids.length !== recuento.count || listado.objectIdFieldName !== oid
    || ids.some(id => !Number.isSafeInteger(id) || id < 0) || new Set(ids).size !== ids.length)
    throw Error('Recuento o identificadores DGT incompletos')
  const features = [], recibidos = new Set()
  const tamano = Math.min(200, metadata.maxRecordCount)
  ids.sort((a,b) => a-b)
  for (let inicio = 0; inicio < ids.length; inicio += tamano) {
    const lote = ids.slice(inicio, inicio + tamano), esperados = new Set(lote)
    const pagina = await leer(true, { f:'geojson', objectIds:lote.join(','), outFields:'*', outSR:'4326', returnGeometry:'true' })
    if (pagina.type !== 'FeatureCollection' || !Array.isArray(pagina.features) || pagina.features.length !== lote.length)
      throw Error('Página DGT incompleta')
    const crs = pagina.crs?.properties?.name
    if (crs && !['EPSG:4326','urn:ogc:def:crs:OGC:1.3:CRS84','urn:ogc:def:crs:EPSG::4326'].includes(crs))
      throw Error('Coordenadas DGT en un sistema desconocido')
    for (const feature of pagina.features) {
      const id = feature?.properties?.[oid]
      if (!esperados.has(id) || recibidos.has(id) || feature.type !== 'Feature')
        throw Error('Identificadores DGT repetidos o inesperados')
      recibidos.add(id)
      features.push(feature)
    }
  }
  const final = await leer(false, { f:'json' })
  if (final.editingInfo?.dataLastEditDate !== editado || final.objectIdField !== oid
    || final.editingInfo?.schemaLastEditDate !== metadata.editingInfo?.schemaLastEditDate)
    throw Error('La DGT cambió durante la descarga; se conserva la copia anterior')
  return { geojson:{ type:'FeatureCollection', features }, publicado:new Date(editado).toISOString() }
}

export async function actualizaFuenteItv(fuente, anterior, opciones = {}) {
  const ahora = opciones.ahora ?? Date.now(), fetcher = opciones.fetcher || fetch
  const consultado = new Date(ahora).toISOString()
  const meta = { id:fuente.id, nombre:fuente.nombre, url:fuente.url, consultado, ultimoExito:consultado, estado:'actualizada' }
  try {
    let datos
    if (fuente.id === 'industria') {
      const pagina = parse(await (await descargar(fuente.url,fetcher)).text())
      const registro = pagina.querySelector('#Registrodeestaciones')
      const enlace = registro?.querySelector('a')?.getAttribute('href')
      if (!enlace) throw Error('Falta el enlace oficial al registro')
      const url = new URL(enlace,fuente.url)
      if (url.origin !== 'https://industria.gob.es' || !url.pathname.endsWith('.xlsx')) throw Error('Enlace de registro inesperado')
      const fecha = /\b(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)\s+(20\d{2})/i.exec(registro.text)
      if (fecha) {
        const mes = 'enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre'.split(' ').indexOf(fecha[1].toLowerCase()) + 1
        meta.publicado = fecha[2]+'-'+String(mes).padStart(2,'0')
      }
      const res = await descargar(url.href,fetcher)
      datos = estacionesIndustria(await readSheet(Buffer.from(await res.arrayBuffer())),meta,ahora)
    } else if (fuente.id === 'dgt') {
      const descarga = await descargaDgt(fuente,fetcher,ahora)
      // Es la edición declarada por la fuente, distinta de la consulta del robot.
      meta.publicado = descarga.publicado
      datos = estacionesDgt(descarga.geojson,meta)
    } else {
      const res = await descargar(fuente.descarga,fetcher)
      const publicado = Date.parse(res.headers.get('Last-Modified') || '')
      if (Number.isFinite(publicado) && publicado <= ahora) meta.publicado = new Date(publicado).toISOString()
      datos = estacionesGva(await res.text(),meta)
    }
    const minimo = fuente.id === 'gva' ? 20 : 300
    if (datos.estaciones.length < minimo) throw Error('Listado incompleto ('+datos.estaciones.length+' estaciones)')
    if (anterior?.estaciones?.length && datos.estaciones.length < anterior.estaciones.length * 0.8)
      throw Error('El listado perdió más del 20 % de sus estaciones')
    if (fuente.id !== 'dgt') datos.estaciones = sinDuplicados(datos.estaciones)
    return { ...meta, ...datos }
  } catch (e) {
    return { ...meta, ...anterior, id:fuente.id, nombre:fuente.nombre, url:fuente.url, consultado,
      ultimoExito:anterior?.ultimoExito, estado:'conservada', error:limpia(e.message).slice(0,160),
      estaciones:anterior?.estaciones || [], excluidas:anterior?.excluidas || [] }
  }
}
