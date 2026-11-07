import { parse } from 'node-html-parser'
import { readSheet } from 'read-excel-file/node'
import { PROVINCIAS_INE } from './provincias-ine.mjs'

export const FUENTES_ITV = [
  { id: 'dgt', nombre: 'DGT', url: 'https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/',
    descarga: 'https://services3.arcgis.com/TXNiwnLDifb5lMaR/ArcGIS/rest/services/ITV/FeatureServer/0/query?where=1%3D1&outFields=*&f=geojson&outSR=4326' },
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
  ['01',['ALAVA','ARABA']], ['07',['BALEARES','BALEARS ILLES','MALLORCA','MENORCA','IBIZA','FORMENTERA']],
  ['13',['CUIDAD REAL']], ['15',['LA CORUÑA','CORUÑA']], ['20',['GUIPUZCOA','GIPUZKOA']], ['25',['LLERIDA','LERIDA']],
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
  const estaciones = geojson.features.map(f => {
    const p = f?.properties || {}
    const prov = provincias.get(clave(p.Provincia)), cod = codigo(p.Codigo_centro)
    if (!prov || !cod || !limpia(p.Municipio) || !limpia(p.Dirección)) return null
    const coords = f.geometry?.coordinates
    const coord = coordenadasItv(coords?.[1] ?? p.Latitud, coords?.[0] ?? p.Longitud)
    return estacion({ codigo: cod, prov, mun: limpia(p.Municipio), dir: limpia(p.Dirección), cp: postal(p.Código_postal),
      tel: limpia(p.Teléfono_1), op: limpia(p.Autoescuela), ...coord,
      lineas: numero(/L[íi]neas\s*:\s*(\d+)/i.exec(p.Info || '')?.[1]),
    }, meta)
  }).filter(Boolean)
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

function contactoDesde(estacion, contacto) {
  const mismaDireccion = direccionComparable(estacion.dir) === direccionComparable(contacto.dir)
  const coords = mismaDireccion ? coordenadasItv(contacto.lat, contacto.lng) : {lat:null,lng:null}
  return { ...estacion, mun: contacto.mun, municipioFuente: estacion.mun,
    aliasMunicipios: [...new Set([estacion.mun, ...(estacion.aliasMunicipios || []), contacto.mun, ...(contacto.aliasMunicipios || [])])],
    tel: contacto.tel || '', ...coords,
    contactoVerificadoEn: contacto.verificadoEn, contactoFuente: contacto.fuente, contactoFuenteUrl: contacto.fuenteUrl }
}

// Correcciones de localidad contrastadas con el operador o la administración
// autonómica. Sólo se aplican al código, CP y dirección documentados; no permiten
// trasladar una estación futura ni renuevan esta comprobación al ejecutar el robot.
const MUNICIPIOS_CONFIRMADOS = [
  { prov:'04', codigo:'0441', cp:'04760', nombre:'BALANEGRA', previos:['BERJA','BALANEGRA'], direccion:/BALANEGRA/,
    url:'https://www.veiasa.es/itv/estaciones-itv/estaciones-fijas' },
  { prov:'37', codigo:'3703', cp:'37439', nombre:'CASTELLANOS DE MORISCOS', previos:['SALAMANCA','CASTELLANOSDEMORISCOS'], direccion:/CASTELLANOSDEMORISCOS/,
    url:'https://www.itevelesa.com/es/nuestras-estaciones/itv-castellanos-de-moriscos' },
  { prov:'38', codigo:'3812', cp:'38340', nombre:'TACORONTE', previos:['TACORONTE','SANTACRUZDETENERIFE'], direccion:/SANGRADERA/,
    url:'https://www.gobiernodecanarias.org/industria/temas/itv/Estaciones_ITV/index.html' },
]

function municipioConfirmado(e) {
  const correccion=MUNICIPIOS_CONFIRMADOS.find(m=>m.prov===e.prov && m.codigo===e.codigo && m.cp===e.cp
    && m.previos.includes(clave(e.mun)) && m.direccion.test(clave(e.dir)))
  return correccion ? { ...e, mun:correccion.nombre,
    aliasMunicipios:[...new Set([e.mun,...(e.aliasMunicipios || []),correccion.nombre])],
    municipioVerificadoEn:'2026-11-07', municipioFuenteUrl:correccion.url } : e
}

export function combinaFuentesItv(fuentes) {
  const industria = fuentes.find(f => f.id === 'industria'), gva = fuentes.find(f => f.id === 'gva'), dgt = fuentes.find(f => f.id === 'dgt')
  const nacionales = industria?.estaciones || []
  const base = new Map(nacionales.map(e => [identidad(e), e]))
  const excluidas = new Set((industria?.excluidas || []).map(identidad))
  const bloqueadas = new Set((industria?.excluidas || []).filter(e => e.motivo !== 'unidad móvil o agrícola').map(identidad))
  for (const e of gva?.estaciones || []) {
    if (bloqueadas.has(identidad(e))) continue
    // La fuente autonómica mantiene los horarios y las altas posteriores al registro nacional.
    const anterior = base.get(identidad(e))
    base.set(identidad(e), { ...e, aliasMunicipios: [...new Set([e.mun, ...(anterior ? [anterior.mun] : [])])] })
    excluidas.delete(identidad(e))
  }
  for (const e of dgt?.estaciones || []) {
    const porCodigo = base.get(identidad(e))
    let destino = porCodigo && mismoLugar(porCodigo,e) ? porCodigo : null
    if (!destino) {
      // Resuelve la errata DGT de Mieres (3302) sólo con municipio y CP concordantes.
      const candidatos = [...base.values()].filter(b => b.prov === e.prov && b.cp && b.cp === e.cp && municipiosCompatibles(b.mun,e.mun))
      if (candidatos.length === 1) destino = candidatos[0]
    }
    if (destino) {
      base.set(identidad(destino), contactoDesde(destino,e))
    } else if (!porCodigo && !excluidas.has(identidad(e))) {
      // Conserva la localidad diferenciada cuando el origen repite un código.
      const id = identidad(e) + '/' + clave(e.mun)
      base.set(id, { ...e, id: e.id + '-' + clave(e.mun).toLowerCase() })
    }
  }
  // Una copia de otra fuente no puede reintroducir estas unidades documentadas,
  // incluida Alcañiz cuando la DGT use su provincia correcta (44) y el registro 50.
  const resultado = [...base.values()].filter(e=>!MOVILES_DOCUMENTADAS.has(identidad(e))).map(municipioConfirmado)
  if (new Set(resultado.map(e => e.id)).size !== resultado.length) throw Error('Identificadores repetidos tras combinar fuentes')
  return resultado.sort((a,b) => a.prov.localeCompare(b.prov) || a.mun.localeCompare(b.mun,'es') || a.codigo.localeCompare(b.codigo))
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
    } else {
      const res = await descargar(fuente.descarga,fetcher)
      const publicado = Date.parse(res.headers.get('Last-Modified') || '')
      if (Number.isFinite(publicado) && publicado <= ahora) meta.publicado = new Date(publicado).toISOString()
      datos = fuente.id === 'gva' ? estacionesGva(await res.text(),meta) : estacionesDgt(await res.json(),meta)
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
