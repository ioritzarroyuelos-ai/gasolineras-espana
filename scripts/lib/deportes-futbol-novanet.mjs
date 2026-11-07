import { parse } from 'node-html-parser'
import { fechaMadrid, fechaEspanola } from './deportes-futbol-fechas.mjs'
import { creaSesionFederativa } from './deportes-futbol-sesion.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'
import { paginaMadrid, categoriasMadrid, gruposMadrid, jornadasMadrid, parseaAgendaMadrid, parseaClasificacionMadrid } from './deportes-futbol-madrid.mjs'

const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const entero = v => /^-?\d+$/.test(texto(v)) ? Number(texto(v)) : null
const normal = v => texto(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const columnas = [['puntos', 'Puntos'], ['jugados', 'Jugados'], ['ganados', 'Ganados'], ['empatados', 'Empatados'], ['perdidos', 'Perdidos'], ['favor', 'Goles a favor'], ['contra', 'Goles en contra']].map(([clave, nombre]) => ({ clave, nombre }))

export function parseaCatalogoNovanet(html) {
  const doc = parse(html), temporadas = doc.querySelectorAll('select[name=temporada] option')
  const codigo = html.match(/\.temporada\.value\s*=\s*["']?(\d+)/)?.[1]
  const opcion = temporadas.find(o => o.getAttribute('value') === codigo) || temporadas.find(o => o.hasAttribute('selected')) || temporadas[0]
  const nombre = texto(opcion?.text)
  if (!/^20\d{2}-20\d{2}$/.test(nombre) || !/^\d+$/.test(opcion?.getAttribute('value') || '')) throw Error('La federación no identifica la temporada del catálogo')
  const categorias = doc.querySelectorAll('select[name=competicion] option,select[name=CodCompeticion] option').filter(o => /^[1-9]\d*$/.test(o.getAttribute('value') || '')).map(o => ({ codigo: o.getAttribute('value'), nombre: texto(o.text), familia: texto(o.parentNode.getAttribute('label')), grupos: null }))
  if (!categorias.length || new Set(categorias.map(c => c.codigo)).size !== categorias.length) throw Error('La federación no entrega un catálogo de competiciones válido')
  return { temporada: { codigo: opcion.getAttribute('value'), nombre }, categorias }
}

/** Read the public selector's literal data, without evaluating downloaded JavaScript. */
export function parseaSelectorNovanet(html, nombre) {
  if (!['grupos', 'jornadas'].includes(nombre)) throw Error('Selector federativo desconocido')
  const contenido = html.match(new RegExp(`\\bvar\\s+${nombre}\\s*=\\s*new Array\\(([\\s\\S]*?)\\);`))?.[1]
  if (contenido === undefined) throw Error('La federación no entrega el selector solicitado')
  let valores
  try { valores = JSON.parse(`[${contenido}]`) } catch { throw Error('El selector federativo no contiene datos literales válidos') }
  if (!Array.isArray(valores) || valores.length % 2 || valores.some(v => typeof v !== 'string')) throw Error('Selector federativo incompleto')
  const opciones = []
  for (let i = 0; i < valores.length; i += 2) if (/^[1-9]\d*$/.test(valores[i])) opciones.push({ codigo: valores[i], nombre: texto(valores[i + 1]) })
  if (new Set(opciones.map(o => o.codigo)).size !== opciones.length) throw Error('Selector federativo con identificadores repetidos')
  return opciones
}

function mapaDigitos(doc) {
  const mapas = doc.querySelectorAll('script').filter(s => s.text.includes('ntype') && s.text.includes('classList')).flatMap(s => [...s.text.matchAll(/\[([\d,]+)\]/g)].map(m => m[1].split(',').map(Number))).filter(m => m.length === 40 && m.every(n => Number.isInteger(n) && n >= 0 && n <= 9) && [0, 10, 20, 30].every(inicio => new Set(m.slice(inicio, inicio + 10)).size === 10))
  const unicos = [...new Map(mapas.map(m => [m.join(','), m])).values()]
  if (unicos.length > 1) throw Error('La representación de las cifras cambió dentro de la página')
  return unicos[0]
}

/** Decode only the digits actually displayed; ignore hidden decoys and never run eval. */
export function numeroVisualNovanet(nodo, mapa) {
  const especiales = new Map(), pseudoelementos = new Map()
  for (const script of nodo.querySelectorAll('script')) {
    const llamada = script.text.trim().match(/^ntype\(["']([\w-]+)["'],\s*(\d+),\s*(\d+),\s*["']fa-\d{1,3}["']\);?$/)
    if (!llamada) continue
    if (!mapa || Number(llamada[2]) > 9 || Number(llamada[3]) > 3 || !nodo.querySelector(`[id="${llamada[1]}"]`)) throw Error('Cifra visual federativa no verificable')
    especiales.set(llamada[1], String(mapa[Number(llamada[3]) * 10 + Number(llamada[2])]))
  }
  for (const estilo of nodo.querySelectorAll('style')) {
    const regla = estilo.text.trim().match(/^#([\w-]+):{1,2}(before|after)\s*\{\s*content:\s*["'](\\[0-9a-fA-F]{1,6}\s?|\d)["']\s*(;\s*display\s*:\s*none)?\s*;?\s*\}$/)
    if (!regla || !nodo.querySelector(`[id="${regla[1]}"]`)) throw Error('Cifra CSS federativa no verificable')
    if (regla[4]) continue
    const digito = regla[3].startsWith('\\') ? String.fromCodePoint(parseInt(regla[3].slice(1).trim(), 16)) : regla[3]
    if (!/^\d$/.test(digito)) throw Error('Cifra CSS federativa no numérica')
    pseudoelementos.set(regla[1], { ...(pseudoelementos.get(regla[1]) || {}), [regla[2]]: digito })
  }
  function visible(n) {
    if (n.nodeType === 3) return n.text
    if (['SCRIPT', 'STYLE'].includes(n.tagName) || /display\s*:\s*none/i.test(n.getAttribute?.('style') || '')) return ''
    const id = n.getAttribute?.('id')
    if (especiales.has(id)) return especiales.get(id)
    const pseudo = pseudoelementos.get(id) || {}
    const hijos = (pseudo.before || '') + (n.childNodes || []).map(visible).join('') + (pseudo.after || '')
    if (!hijos.trim()) {
      const icono = (n.getAttribute?.('class') || '').match(/(?:^|\s)fa-(\d)(?:\s|$)/)
      if (icono && !n.querySelector?.('script')) return icono[1]
    }
    return hijos
  }
  const resultado = visible(nodo).replace(/[\s\u00a0-]+/g, '')
  if (!/^\d{1,3}$/.test(resultado)) throw Error('Marcador visual federativo no verificable')
  return Number(resultado)
}

function compruebaIdentidad(doc, html, esperada) {
  for (const [campo, valor] of [['competicion', esperada.competicion], ['grupo', esperada.grupo], ['jornada', esperada.jornada]]) {
    if (valor === undefined) continue
    const preseleccion = html.match(new RegExp(`Select_Preselecciona\\(document.getElementById\\(["']${campo}["']\\),["'](\\d+)["']\\)`))?.[1]
    const seleccionado = doc.querySelector(`select[name=${campo}] option[selected]`)?.getAttribute('value')
    if ((preseleccion || seleccionado) !== String(valor)) throw Error(`La federación devuelve otra ${campo}`)
  }
  const temporada = doc.querySelectorAll('h1,h2,h3,h4').map(n => texto(n.text)).find(t => /^(Temporada|Denboraldia)[ .]/i.test(t))?.match(/20\d{2}-20\d{2}/)?.[0]
  if (temporada !== esperada.temporada) throw Error('La federación devuelve otra temporada')
}

export function parseaJornadasPaginaNovanet(html, esperada) {
  const doc = parse(html)
  compruebaIdentidad(doc, html, { ...esperada, jornada: undefined })
  const opciones = doc.querySelectorAll('select[name=jornada] option').filter(o => /^[1-9]\d*$/.test(o.getAttribute('value') || '')).map(o => ({ codigo: o.getAttribute('value'), nombre: texto(o.text) }))
  if (!opciones.length) throw Error('La página del grupo no contiene jornadas verificables')
  return opciones
}

export function parseaAgendaNovanet(html, esperada, fuenteUrl) {
  const doc = parse(html)
  compruebaIdentidad(doc, html, esperada)
  const mapa = mapaDigitos(doc), eventos = []
  const esPartido = t => t.querySelectorAll('.font_widgetL h4').length === 1 && t.querySelectorAll('.font_widgetV h4').length === 1
  const tablas = doc.querySelectorAll('table').filter(t => esPartido(t) && !t.querySelectorAll('table').some(esPartido))
  for (const [i, tabla] of tablas.entries()) {
    const equipo = clase => { const n = tabla.querySelector(`${clase} h4`); return texto(n?.querySelector('a[href*="NFG_VisEquipos"]')?.text || n?.text) }
    const local = equipo('.font_widgetL'), visitante = equipo('.font_widgetV')
    if (/^descansa$/i.test(local) || /^descansa$/i.test(visitante)) continue
    if (!local || !visitante) throw Error('Partido federativo sin equipos')
    const horas = tabla.querySelectorAll('.horario').map(n => texto(n.text))
    const fecha = fechaEspanola(horas.find(t => /^\d{2}-\d{2}-\d{4}$/.test(t)) || '')
    if (fecha && (Number(fecha.slice(0, 4)) < Number(esperada.temporada.slice(0, 4)) || Number(fecha.slice(0, 4)) > Number(esperada.temporada.slice(-4)))) throw Error('La jornada contiene fechas de otra temporada')
    const zonaPorConfirmar = ['canarias', 'las-palmas', 'tenerife'].includes(esperada.fuenteId)
    const hora = horas.find(t => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t)), inicio = fecha && hora && !zonaPorConfirmar ? fechaMadrid(fecha, hora) : null
    const cerrados = tabla.querySelectorAll('.wid2_resultado_cerrada'), provisionales = tabla.querySelectorAll('.wid2_resultado_prov,.wid2_resultado_enjuego,.wid2_resultado_noacaba')
    const estadoTexto = texto(tabla.text)
    const estado = /aplazad/i.test(estadoTexto) ? 'aplazado' : /suspendid|cancelad|retirad/i.test(estadoTexto) ? 'cancelado' : cerrados.length === 2 ? 'finalizado' : provisionales.length ? 'por_confirmar' : inicio ? 'programado' : 'por_confirmar'
    const resultado = estado === 'finalizado' ? { local: numeroVisualNovanet(cerrados[0], mapa), visitante: numeroVisualNovanet(cerrados[1], mapa) } : null
    const acta = tabla.querySelector('a[href*="CodActa="]')?.getAttribute('href')?.match(/CodActa=(\d+)/)?.[1]
    const comparativa = tabla.querySelector('a[href*="NFG_LstComparativaEquipos"]')?.getAttribute('href')
    const equipos = comparativa ? new URL(comparativa, fuenteUrl).searchParams : null
    const identidad = equipos?.get('equipo1') && equipos?.get('equipo2') ? `${esperada.grupo}-${esperada.jornada}-${equipos.get('equipo1')}-${equipos.get('equipo2')}` : acta || `${esperada.grupo}-${esperada.jornada}-${i}`
    const avisos = [provisionales.length ? 'La federación señala datos provisionales; el resultado está pendiente de confirmar.' : '', zonaPorConfirmar && hora ? `La fuente publica las ${hora}; falta confirmar la zona horaria.` : ''].filter(Boolean)
    eventos.push({ id: `nova-${esperada.fuenteId}-${identidad}`, nombre: `${local} — ${visitante}`, local, visitante, fecha, inicio, estado, resultado, jornada: `Jornada ${esperada.jornada}`, fuenteUrl, ...(avisos.length ? { detalle: avisos.join(' ') } : {}) })
  }
  if (!eventos.length) throw Error('La federación no publica partidos verificables para esta jornada')
  if (new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('La federación repite partidos en la jornada')
  return eventos
}

export function parseaClasificacionNovanet(html, esperada, fuenteUrl) {
  const doc = parse(html), titulo = texto(doc.querySelector('.la_roja_regular_titulo1')?.text)
  if (normal(titulo) !== normal(esperada.nombre)) throw Error('La clasificación pertenece a otra competición')
  const temporada = doc.querySelectorAll('h1,h2,h3,h4').map(n => texto(n.text)).find(t => /^(Temporada|Denboraldia)[ .]/i.test(t))?.match(/20\d{2}-20\d{2}/)?.[0]
  if (temporada !== esperada.temporada) throw Error('La clasificación pertenece a otra temporada')
  const links = doc.querySelectorAll('a[href*="NFG_VisCalendario_Vis"]').map(n => new URL(n.getAttribute('href'), fuenteUrl))
  if (!links.some(u => u.searchParams.get('codcompeticion') === String(esperada.competicion) && u.searchParams.get('codgrupo') === String(esperada.grupo))) throw Error('La clasificación pertenece a otro grupo')
  const tablas = doc.querySelectorAll('table.table-bordered')
  const resumida = tablas.find(t => /Partidos|Partidak/.test(t.querySelectorAll('tr')[0]?.text || '') && !/Casa|Fuera|Etxeko|Kanpoko/.test(t.querySelectorAll('tr')[0]?.text || ''))
  if (!resumida) throw Error('La federación no ofrece una clasificación resumida verificable')
  const adicional = /Pts\/PJ/.test(resumida.querySelectorAll('tr')[1]?.text || '') ? 1 : 0
  const filas = resumida.querySelectorAll('tr').slice(2).map(tr => {
    const c = tr.querySelectorAll('td')
    const posicion = entero(c[1]?.text), nombre = texto(c[2]?.text)
    const valores = Object.fromEntries(['puntos', 'jugados', 'ganados', 'empatados', 'perdidos'].map((k, i) => [k, entero(c[i + 3 + adicional]?.text)]))
    if (!posicion || !nombre || Object.values(valores).some(v => v === null)) throw Error('Clasificación federativa incompleta')
    return { posicion, nombre, valores }
  })
  if (!filas.length) throw Error('La clasificación federativa no contiene equipos')
  const detallada = tablas.find(t => /Casa.*Fuera|Etxeko.*Kanpoko/.test(t.querySelectorAll('tr')[0]?.text || ''))
  if (detallada) for (const tr of detallada.querySelectorAll('tr').slice(2)) {
    const c = tr.querySelectorAll('td'), fila = filas.find(f => f.nombre === texto(c[2]?.text))
    const extra = /Pts\/PJ/.test(detallada.querySelectorAll('tr')[1]?.text || '') ? 1 : 0
    const favor = entero(c[12 + extra]?.text), contra = entero(c[13 + extra]?.text)
    if (!fila || favor === null || contra === null) throw Error('Las tablas de clasificación no coinciden')
    fila.valores.favor = favor; fila.valores.contra = contra
  }
  const jornada = doc.querySelectorAll('h1,h2,h3,h4').map(n => texto(n.text)).find(t => /^Jornada \d+/.test(t))
  return [{ id: 'general', nombre: jornada ? `Clasificación · ${jornada}` : 'Clasificación general', columnas: detallada ? columnas : columnas.slice(0, 5), filas }]
}

export const FUENTES_NOVANET = [
  ['rfef', 'Real Federación Española de Fútbol', 'España', 'https://marcadores.rfef.es/pnfg/NPcd/', '1000120'],
  ['andalucia', 'Real Federación Andaluza de Fútbol', 'Andalucía', 'https://www.rfaf.es/pnfg/NPcd/', '1000120'],
  ['aragon', 'Real Federación Aragonesa de Fútbol', 'Aragón', 'https://www.futbolaragon.com/pnfg/NPcd/', '1000120'],
  ['asturias', 'Real Federación de Fútbol del Principado de Asturias', 'Asturias', 'https://www.asturfutbol.es/pnfg/NPcd/', '1000120'],
  ['baleares', 'Federació de Futbol de les Illes Balears', 'Baleares', 'https://www.ffib.es/Fed/NPcd/', '1000110'],
  ['canarias', 'Federación Canaria de Fútbol', 'Canarias', 'https://www.federacioncanariafutbol.es/pnfg/NPcd/', '1000120'],
  ['cantabria', 'Real Federación Cántabra de Fútbol', 'Cantabria', 'https://www.rfcf.es/pnfg/NPcd/', '1000120'],
  ['castilla-leon', 'Real Federación de Castilla y León de Fútbol', 'Castilla y León', 'https://www.rfcylf.es/pnfg/NPcd/', '1000120'],
  ['castilla-la-mancha', 'Federación de Fútbol de Castilla-La Mancha', 'Castilla-La Mancha', 'https://www.ffcm.es/pnfg/NPcd/', '1000120'],
  ['ceuta', 'Real Federación de Fútbol de Ceuta', 'Ceuta', 'https://www.rffce.es/pnfg/NPcd/', '1000120'],
  ['extremadura', 'Real Federación Extremeña de Fútbol', 'Extremadura', 'https://www.fexfutbol.com/pnfg/NPcd/', '1000120'],
  ['galicia', 'Real Federación Galega de Fútbol', 'Galicia', 'https://www.futgal.es/pnfg/NPcd/', '1000120'],
  ['melilla', 'Real Federación Melillense de Fútbol', 'Melilla', 'https://www.rfmf.es/pnfg/NPcd/', '1000120'],
  ['murcia', 'Federación de Fútbol de la Región de Murcia', 'Región de Murcia', 'https://webffrm.novanet.es/pnfg/NPcd/', '1000120'],
  ['navarra', 'Federación Navarra de Fútbol', 'Navarra', 'https://www.futnavarra.es/pnfg/NPcd/', '1000120'],
  ['euskadi', 'Euskadiko Futbol Federakundea', 'Euskadi', 'https://www.euskadifutbol.eus/pnfg/NPcd/', '1000120'],
  ['rioja', 'Federación Riojana de Fútbol', 'La Rioja', 'https://www.frfutbol.com/pnfg/NPcd/', '1000120'],
  ['madrid', 'Real Federación de Fútbol de Madrid', 'Madrid', 'https://www.rffm.es/competicion/', ''],
  ['euskadi-alava', 'Federación Alavesa de Fútbol', 'Álava', 'https://www.faf-aff.eus/pnfg/NPcd/', '1000120'],
  ['euskadi-bizkaia', 'Federación Vizcaína de Fútbol', 'Bizkaia', 'https://www.fvf-bff.eus/pnfg/NPcd/', '1000120'],
  ['euskadi-gipuzkoa', 'Federación Guipuzcoana de Fútbol', 'Gipuzkoa', 'https://www.gipuzkoafutbola.eus/pnfg/NPcd/', '1000120'],
  ['las-palmas', 'Real Federación de Fútbol de Las Palmas', 'Las Palmas', 'https://www.fiflp.com/pnfg/NPcd/', '1000120'],
  ['tenerife', 'Federación Interinsular de Fútbol de Tenerife', 'Santa Cruz de Tenerife', 'https://www.ftf.es/pnfg/NPcd/', '1000120'],
].map(([id, nombre, zona, base, primaria]) => ({ id, nombre, zona, base, primaria }))

const cubiertas = new Set(['Campeonato Nacional de Liga de Primera División', 'Campeonato Nacional de Liga de Segunda División', 'Campeonato Nacional de Liga de Primera Federación', 'Primera División de Fútbol Femenino', 'Liga Prime Futsal', 'Segunda División Fútbol Sala Masculino', 'Primera División Fútbol Sala Femenino', 'Segunda División Fútbol Sala Femenino', 'Supercopa de España Masculina Fútbol Sala'])

/** Regional portals also mirror national leagues; their primary reader owns those. */
export function categoriaDuplicadaNovanet(categoria, fuenteId) {
  if (fuenteId === 'rfef') return cubiertas.has(categoria.nombre) || /copa.*reina.*(?:fs|futbol sala)/.test(normal(categoria.nombre))
  // Territorial mirrors remain eligible as fallbacks; only a currently valid primary block skips their group.
  return false
}

function numeroGrupo(nombre) {
  const n = normal(nombre)
  if (/copa|play.?off|ascenso|descenso|eliminatoria/.test(n)) return null
  const raw = n.match(/grup(?:o)?\s*[-.:]?\s*(\d+|[ivx]+)(?=\b|\s|$)/)?.[1] || (/^(\d+|[ivx]+)$/.test(n) ? n : null)
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Number(raw)
  const romanos = ['i','ii','iii','iv','v','vi','vii','viii','ix','x','xi','xii','xiii','xiv','xv','xvi','xvii','xviii','xix','xx']
  return romanos.indexOf(raw) + 1 || null
}

/** A shared national group gets one route, including the previously published FFCV routes. */
export function idGrupoNovanet(fuenteId, categoria, grupo) {
  const n = normal(categoria.nombre), familia = normal(categoria.familia), numero = numeroGrupo(grupo.nombre)
  const femenino = /femen|futfem/.test(n + familia), sala = /sala|futsal|f\.s\./.test(n + familia)
  const territorial = /autonomic|territorial|regional|provincial|extremena|galega|gallega|andaluza|cantabria|rioja|rffm|ffib|futgal|ffcv/.test(n)
  const unico = numero || (/unico|liga regular|campeonato|primera federacion/.test(normal(grupo.nombre)) ? 1 : null)
  if (!territorial && !/playa/.test(n + familia)) {
    if (/(primera|segunda) federacion/.test(n)) {
      if (/primera federacion/.test(n) && femenino && unico === 1) return 'rfef-33836145'
      if (/primera federacion/.test(n) && !femenino && numero) return `primera-federacion-group-${numero}`
      if (/segunda federacion/.test(n) && numero) return femenino && numero === 1 ? 'rfef-33836147' : `rfef-segunda-${femenino ? 'femenina' : 'masculina'}-${numero}`
    }
    if (/(?:division (?:de )?)?honor juvenil/.test(n) && numero) {
      if (!sala && [2,3,5,7].includes(numero)) return `rfef-${{ 2:33836118,3:33836119,5:33836121,7:33836123 }[numero]}`
      return `rfef-honor-juvenil${sala ? '-sala' : ''}-${numero}`
    }
    if (!sala && /^(?:campeonato nacional de liga de )?primera division(?: de futbol femenino)?$/.test(n)) return femenino ? 'futbol-femenino' : 'laliga-easports'
    if (!sala && /^(?:campeonato nacional de liga de )?segunda division$/.test(n)) return 'laliga-hypermotion'
    if (sala && !/copa|tercera|juvenil|cadete|infantil|alevin|benjamin/.test(n)) {
      if (/segunda division.*\bb\b/.test(n) && numero) return `rfef-segunda-b-sala-${numero}`
      if (/segunda division/.test(n) && (!femenino || numero)) return `rfef-futsal-segunda${femenino ? '-femenina' : ''}-${femenino ? numero : 1}`
      if (/primera division|prime futsal/.test(n)) return `rfef-futsal-${femenino ? 'primera-femenina' : 'liga-prime-futsal'}-1`
    }
    if (/copa.*reina/.test(n)) return sala ? 'rfef-futsal-copa-del-rey-femenina-playoffs' : `rfef-copa-reina-${/previa/.test(normal(grupo.nombre)) ? 'previa' : 'general'}`
    if (/copa.*rey/.test(n)) return `rfef-copa-rey${sala ? '-sala' : ''}-${/previa/.test(normal(grupo.nombre)) ? 'previa' : 'general'}`
    if (/copa federacion/.test(n) && (fuenteId === 'rfef' || /nacional/.test(normal(grupo.nombre) + n))) return 'rfef-copa-federacion-nacional'
  }
  if (numero && !/copa/.test(n)) {
    if (/(tercera|3a|3ª) federacion/.test(n)) {
      if (numero === 6) return femenino ? 'ffcv-905431519' : 'ffcv-905431605'
      return `rfef-tercera-${femenino ? 'femenina' : 'masculina'}-${numero}`
    }
    if (/tercera division/.test(n) && /sala|futsal|f\.s\./.test(n + familia)) {
      if (numero === 14) return 'ffcv-905431873'
      if (numero === 15) return 'ffcv-905431874'
      return `rfef-tercera-sala-${numero}`
    }
    if (/nacional.*juvenil|juvenil.*nacional/.test(n)) return numero === 8 ? 'ffcv-905431879' : `rfef-nacional-juvenil-${numero}`
  }
  return fuenteId === 'rfef' ? `rfef-${grupo.codigo}` : `novanet-${fuenteId}-${grupo.codigo}`
}

export function fusionaCompeticionesFutbol(anteriores, nuevas) {
  const mapa = new Map(anteriores.map(c => [c.id, c]))
  for (const nueva of nuevas) {
    const previa = mapa.get(nueva.id)
    if (!previa) { mapa.set(nueva.id, nueva); continue }
    if (previa.temporada !== nueva.temporada) {
      if (/^20\d{2}-20\d{2}$/.test(nueva.temporada) && (!/^20\d{2}-20\d{2}$/.test(previa.temporada) || nueva.temporada.localeCompare(previa.temporada) > 0)) mapa.set(nueva.id, nueva)
      continue
    }
    // Preserve the existing official reader if both versions are valid. A failed block can be filled independently.
    mapa.set(nueva.id, { ...previa, agenda: previa.agenda.estado === 'actualizado' ? previa.agenda : nueva.agenda, clasificacion: previa.clasificacion.estado === 'actualizado' ? previa.clasificacion : nueva.clasificacion })
  }
  return [...mapa.values()]
}
const vacio = (url, consultado, campo) => ({ estado: 'no_disponible', consultado, fuenteUrl: url, [campo]: [] })
const bloque = (url, consultado, campo, datos) => ({ estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl: url, [campo]: datos })

function jornadasCercanas(opciones, ahora, seleccionada) {
  const ordenadas = opciones.map(j => ({ ...j, fecha: fechaEspanola(j.nombre.match(/\d{2}-\d{2}-\d{4}/)?.[0] || '') })).filter(j => j.fecha).sort((a, b) => a.fecha.localeCompare(b.fecha))
  if (!ordenadas.length) return opciones.filter(j => j.codigo === seleccionada)
  const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ahora))
  let indice = ordenadas.findIndex(j => j.fecha >= hoy)
  if (indice < 0) indice = ordenadas.length - 1
  return ordenadas.slice(Math.max(0, indice - 1), indice + 1)
}

async function obtienePortalNovanet(fuente, opciones, maximoPasada) {
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[fuente.id]), ahora = opciones.ahora ?? Date.now(), consultado = new Date(ahora).toISOString()
  const madrid = fuente.id === 'madrid'
  const competiciones = [], incidencias = [], categoriasResueltas = [], urlBase = madrid ? `${fuente.base}resultados-y-jornadas` : `${fuente.base}NFG_CmpJornada?cod_primaria=${fuente.primaria}`
  let peticionesPasada = 0, pausado = false, intentados = 0, vaciasSeguidas = 0
  const guarda = async () => { await opciones.guardarEstadoNovanet?.(fuente.id, normalizaEstadoNovanet(estado)) }
  const incidencia = (nombre, motivo, id = `novanet-${fuente.id}`) => incidencias.push({ deporte: 'futbol', nombre, fuenteUrl: urlBase, motivo, id })
  const disponible = () => !pausado && peticionesPasada < maximoPasada && (!estado.noConsultarAntes || Date.now() >= Date.parse(estado.noConsultarAntes))
  const sesion = creaSesionFederativa(fuente.base, {
    fetcher: opciones.fetcher,
    antesDePedir: async () => {
      if (!disponible()) throw Error('Las consultas de esta federación continuarán en la próxima pasada permitida')
      if (!estado.ventana.desde || Date.now() - Date.parse(estado.ventana.desde) >= 3600000) estado.ventana = { desde: new Date().toISOString(), peticiones: 0 }
      if (estado.ventana.peticiones >= 120) {
        estado.noConsultarAntes = new Date(Math.max(Date.parse(estado.ventana.desde) + 3600000, Date.parse(estado.noConsultarAntes || '') || 0)).toISOString()
        pausado = true; await guarda(); throw Error('Se ha alcanzado el presupuesto horario de consultas de esta federación')
      }
      estado.ventana.peticiones++; peticionesPasada++; estado.noConsultarAntes = null
      await guarda()
    },
    alLimite: async hasta => { estado.noConsultarAntes = hasta; pausado = true; await guarda() },
  })
  const lee = async ruta => {
    const resultado = await sesion.leer(new URL(ruta, fuente.base).href)
    await opciones.capturaNovanet?.(fuente.id, resultado.url, resultado.html)
    vaciasSeguidas = resultado.html.trim() ? 0 : vaciasSeguidas + 1
    if (vaciasSeguidas >= 3) {
      estado.noConsultarAntes = new Date(Date.now() + 3600000).toISOString()
      pausado = true; await guarda()
      throw Error('La federación ha devuelto tres páginas vacías consecutivas. Dejamos una hora de descanso antes de continuar; no se sustituye información válida.')
    }
    return resultado.html
  }
  const siguienteCategoria = () => { estado.categoria = (estado.categoria + 1) % estado.catalogo.categorias.length; estado.grupo = 0 }
  try {
    if (disponible() && (!estado.catalogo || Date.parse(consultado) - Date.parse(estado.catalogo.verificadoEn) > 7 * 86400000 && estado.categoria === 0 && estado.grupo === 0)) {
      let catalogo
      if (madrid) {
        const pagina = paginaMadrid(await lee(urlBase))
        const categorias = categoriasMadrid(pagina.competitions)
        for (const tipo of pagina.gameTypes || []) if (String(tipo.codigo_tipo_juego) !== String(pagina.idGameType)) categorias.push(...categoriasMadrid(JSON.parse(await lee(`/api/competitions?temporada=${pagina.season.cod_temporada}&tipojuego=${tipo.codigo_tipo_juego}`))))
        catalogo = { temporada: { codigo: pagina.season.cod_temporada, nombre: pagina.season.nombre }, categorias: [...new Map(categorias.map(c => [c.codigo, c])).values()] }
      } else catalogo = parseaCatalogoNovanet(await lee(urlBase))
      catalogo.categorias = catalogo.categorias.filter(c => !categoriaDuplicadaNovanet(c, fuente.id))
      if (!catalogo.categorias.length) throw Error('No quedan categorías nuevas verificables en este catálogo')
      if (estado.catalogo?.temporada.nombre !== catalogo.temporada.nombre) { estado.verificados = {}; estado.completos = {} }
      estado.catalogo = { ...catalogo, verificadoEn: consultado }; estado.categoria = 0; estado.grupo = 0
      await guarda()
    }
    const visitados = new Set()
    while (estado.catalogo && disponible()) {
      const clave = `${estado.categoria}:${estado.grupo}`
      if (visitados.has(clave)) break
      visitados.add(clave)
      const categoria = estado.catalogo.categorias[estado.categoria]
      if (categoriaDuplicadaNovanet(categoria, fuente.id)) { siguienteCategoria(); await guarda(); continue }
      if (!categoria.grupos) {
        try {
          categoria.grupos = madrid ? gruposMadrid(await lee(`/api/groups?competicion=${categoria.codigo}`)) : parseaSelectorNovanet(await lee(`NFG_CmpJornada_Exec?cod_primaria=${fuente.primaria}&codcompeticion=${categoria.codigo}`), 'grupos')
          await guarda()
        } catch (error) {
          incidencia(`${fuente.zona} · ${categoria.nombre}`, error.message, `novanet-${fuente.id}-${categoria.codigo}`)
          if (!disponible()) break
          siguienteCategoria(); await guarda(); continue
        }
      }
      if (!categoria.grupos.length) { siguienteCategoria(); await guarda(); continue }
      const reserva = sesion.estadisticas().peticiones ? 5 : 7
      if (maximoPasada - peticionesPasada < reserva || 120 - estado.ventana.peticiones < reserva) break
      const grupo = categoria.grupos[estado.grupo], temporada = estado.catalogo.temporada
      const params = new URLSearchParams({ cod_primaria: fuente.primaria, CodCompeticion: categoria.codigo, CodGrupo: grupo.codigo, CodTemporada: temporada.codigo })
      const parametrosMadrid = new URLSearchParams({ temporada: temporada.codigo, competicion: categoria.codigo, grupo: grupo.codigo })
      const url = madrid ? `${fuente.base}resultados-y-jornadas?${parametrosMadrid}` : `${fuente.base}NFG_CmpJornada?${params}`, tablaUrl = madrid ? `${fuente.base}clasificaciones?${parametrosMadrid}` : `${fuente.base}NFG_VisClasificacion?cod_primaria=${fuente.primaria}&codcompeticion=${categoria.codigo}&codgrupo=${grupo.codigo}`
      const id = idGrupoNovanet(fuente.id, categoria, grupo)
      if (opciones.gruposCubiertosFutbol?.includes(id)) {
        estado.grupo++
        if (estado.grupo >= categoria.grupos.length) siguienteCategoria()
        await guarda(); continue
      }
      const familia = `${categoria.familia} ${categoria.nombre}`
      const genero = /mixt/i.test(familia) ? 'mixto' : /femen|futfem|valenta|reina/i.test(familia) ? 'femenino' : /mascul/i.test(familia) || fuente.id === 'rfef' && /^(Fútbol|Fútbol Juvenil|Juveniles)$/.test(categoria.familia) ? 'masculino' : undefined
      const c = { id, deporte: 'futbol', nombre: categoria.nombre, grupo: grupo.nombre, temporada: temporada.nombre, categoria: /sala|futsal/i.test(familia) ? 'Fútbol sala' : /playa|platja/i.test(familia) ? 'Fútbol playa' : fuente.id === 'rfef' ? 'Fútbol federado' : 'Fútbol territorial y de base', zona: fuente.zona, ...(genero ? { genero } : {}), fuente: { nombre: fuente.nombre, url }, comprobadoEn: consultado, agenda: vacio(url, consultado, 'eventos'), clasificacion: vacio(tablaUrl, consultado, 'tablas') }
      const esperada = { fuenteId: fuente.id, competicion: categoria.codigo, nombre: categoria.nombre, grupo: grupo.codigo, temporada: temporada.nombre }
      let jornadaTabla
      try {
        let opcionesJornadas, seleccionada
        try {
          const selector = await lee(madrid ? `/api/group-rounds?idGroup=${grupo.codigo}&fetchBy=standings` : `NFG_CmpJornada_Exec?cod_primaria=${fuente.primaria}&codgrupo=${grupo.codigo}`)
          opcionesJornadas = madrid ? jornadasMadrid(selector) : parseaSelectorNovanet(selector, 'jornadas')
          seleccionada = selector.match(/\.jornada\.value\s*=\s*["']?(\d+)/)?.[1]
        } catch (error) {
          if (!disponible() || madrid) throw error
          opcionesJornadas = parseaJornadasPaginaNovanet(await lee(url), esperada)
        }
        const jornadas = jornadasCercanas(opcionesJornadas, ahora, seleccionada)
        if (!jornadas.length) throw Error('La federación todavía no publica jornadas con fecha verificable')
        const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ahora))
        jornadaTabla = jornadas.filter(j => j.fecha && j.fecha <= hoy).at(-1)?.codigo || jornadas[0].codigo
        const eventos = []
        for (const jornada of jornadas) {
          const enlace = `${url}&${madrid ? 'jornada' : 'CodJornada'}=${jornada.codigo}`
          eventos.push(...(madrid ? parseaAgendaMadrid(await lee(`/api/results?idGroup=${grupo.codigo}&round=${jornada.codigo}`), { ...esperada, jornada: jornada.codigo }, enlace) : parseaAgendaNovanet(await lee(enlace), { ...esperada, jornada: jornada.codigo }, enlace)))
        }
        c.agenda = bloque(url, consultado, 'eventos', eventos)
        c.agenda.aviso = 'Jornada anterior y jornada más cercana a hoy publicadas por la federación. Otros días, en la fuente oficial. No es un marcador en directo.'
      } catch (error) { incidencia(`${categoria.nombre} · ${grupo.nombre}`, error.message, id) }
      let terminoGrupo = false
      if (disponible()) {
        const enlace = jornadaTabla ? `${tablaUrl}&${madrid ? 'jornada' : 'codjornada'}=${jornadaTabla}` : tablaUrl
        try {
          const html = await lee(enlace), doc = madrid ? null : parse(html)
          if (doc && !doc.querySelector('table.table-bordered') && doc.querySelectorAll('h3').some(h => /\d{2}-\d{2}-\d{4}.*(?:final|octavos|cuartos|previa)/i.test(h.text)) && doc.querySelectorAll('h4').some(h => normal(h.text) === normal(categoria.nombre))) c.clasificacion.aviso = 'La fuente muestra un cuadro de eliminatorias. Consulta los partidos; no hay una tabla de puntos para este grupo.'
          else c.clasificacion = bloque(enlace, consultado, 'tablas', madrid ? parseaClasificacionMadrid(html, esperada) : parseaClasificacionNovanet(html, esperada, enlace))
        }
        catch (error) { incidencia(`${categoria.nombre} · ${grupo.nombre} · clasificación`, error.message, id) }
        terminoGrupo = true
      }
      if (c.agenda.eventos.length || c.clasificacion.tablas.length) { competiciones.push(c); estado.verificados[`${categoria.codigo}-${grupo.codigo}`] = consultado; estado.ultimoExito = consultado }
      if (c.agenda.eventos.length && (c.clasificacion.tablas.length || c.clasificacion.aviso?.includes('cuadro de eliminatorias'))) estado.completos[`${categoria.codigo}-${grupo.codigo}`] = consultado
      intentados++
      if (!terminoGrupo || estado.noConsultarAntes) { await guarda(); break }
      estado.grupo++
      if (estado.grupo >= categoria.grupos.length) siguienteCategoria()
      await guarda()
    }
  } catch (error) { incidencia(fuente.nombre, error.message) }
  if (estado.catalogo) {
    for (const c of estado.catalogo.categorias) if (c.grupos?.length && c.grupos.every(g => estado.completos[`${c.codigo}-${g.codigo}`] || opciones.gruposCubiertosFutbol?.includes(idGrupoNovanet(fuente.id, c, g)))) categoriasResueltas.push(c.codigo)
    const grupos = estado.catalogo.categorias.reduce((n, c) => n + (c.grupos?.length || 0), 0), porDescubrir = estado.catalogo.categorias.filter(c => !c.grupos).length
    incidencia(`${fuente.zona} · cobertura por grupos`, `Catálogo: ${estado.catalogo.categorias.length} categorías y ${grupos} grupos descubiertos${porDescubrir ? `; quedan categorías por recorrer` : ''}. Hay lecturas válidas de ${Object.keys(estado.verificados).length} grupos. Cada ficha conserva su fecha.${estado.noConsultarAntes ? ` Próximo intento permitido: ${estado.noConsultarAntes}.` : ''}`, `novanet-${fuente.id}-progreso`)
  }
  opciones.log?.(`Novanet ${fuente.id}: ${JSON.stringify({ ...sesion.estadisticas(), intentados, fichas: competiciones.length })}`)
  return { competiciones, incidencias, categoriasResueltas, fuenteId: fuente.id, estadisticas: sesion.estadisticas() }
}

export async function obtieneNovanet(opciones = {}) {
  const fuentes = FUENTES_NOVANET.filter(f => !opciones.fuentesNovanet || opciones.fuentesNovanet.includes(f.id))
  const presupuesto = Math.min(250, Math.max(0, opciones.maxPeticionesNovanet ?? 250))
  const porFuente = Math.min(15, Math.floor(presupuesto / Math.max(1, fuentes.length)))
  const resultados = [], competiciones = [], incidencias = []
  let siguiente = 0
  await Promise.all([0, 1, 2].map(async () => {
    while (siguiente < fuentes.length) {
      const fuente = fuentes[siguiente++]
      resultados.push(await obtienePortalNovanet(fuente, opciones, porFuente))
    }
  }))
  resultados.sort((a, b) => fuentes.findIndex(f => f.id === a.fuenteId) - fuentes.findIndex(f => f.id === b.fuenteId))
  for (const r of resultados) { competiciones.push(...r.competiciones); incidencias.push(...r.incidencias) }
  return { competiciones: fusionaCompeticionesFutbol([], competiciones), incidencias, rfefResueltas: resultados.find(r => r.fuenteId === 'rfef')?.categoriasResueltas || [], fuentesIntentadas: fuentes.map(f => f.id), estadisticas: resultados.map(r => ({ fuente: r.fuenteId, ...r.estadisticas })) }
}
