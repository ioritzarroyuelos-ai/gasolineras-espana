import { parse } from 'node-html-parser'
import { createHash } from 'node:crypto'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'
import { horaGipuzkoa } from './deportes-baloncesto-territorial.mjs'
const BASE = 'https://competiciones.feb.es/autonomicas/', WEB = 'https://fabasket.com/resultados/', PORTAL = 'basket-aragon', HORA = 3600000
const TERRITORIOS = [{ codigo: '3', nombre: 'Aragón' }, { codigo: '32', nombre: 'Aragón · Zaragoza' }, { codigo: '30', nombre: 'Aragón · Huesca' }]
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const opcionesSelect = (doc, id) => doc.querySelectorAll('#' + id + ' option').map(n => ({ codigo: n.getAttribute('value'), nombre: texto(n.text), activo: n.hasAttribute('selected') }))
const opcion = (doc, id) => opcionesSelect(doc, id).find(o => o.activo)
const urlCategoria = (a, c) => BASE + 'Resultados.aspx?a=' + a + (c ? '&c=' + c : '')
export function catalogoAragon(html, territorio) {
  const doc = parse(html), t = opcion(doc, 'controlNavegacion_temporadasDropDownList'), categorias = opcionesSelect(doc, 'controlNavegacion_categoriasDropDownList')
  if (!t || !/^20\d{2}$/.test(t.codigo) || t.nombre !== t.codigo + '/' + (Number(t.codigo) + 1) || !categorias.length || categorias.some(c => !/^\d+$/.test(c.codigo) || !c.nombre)) throw Error('Aragón no identifica temporada y categorías')
  return { temporada: { codigo: t.codigo, nombre: t.nombre.replace('/', '-') }, categorias: categorias.filter(c => !/^(?:LF ENDESA|COPA ESPAÑA|PRIMERA FEB|LF CHALLENGE|SEGUNDA FEB|L\.F\.-2|TERCERA FEB|LIGA U)$/.test(c.nombre)).map(c => ({ codigo: territorio.padStart(2, '0') + c.codigo, nombre: c.nombre, familia: territorio, grupos: null })) }
}
export function formularioAragon(html, campo, codigo) {
  const doc = parse(html), select = doc.querySelectorAll('select[name]').find(n => n.getAttribute('name') === campo)
  if (!select?.querySelectorAll('option').some(o => o.getAttribute('value') === codigo)) throw Error('Aragón no ofrece el grupo solicitado')
  const body = new URLSearchParams()
  for (const n of doc.querySelectorAll('input[name][value]')) body.set(n.getAttribute('name'), n.getAttribute('value'))
  if (!body.get('__VIEWSTATE') || !body.get('__EVENTVALIDATION')) throw Error('Formulario público aragonés incompleto')
  for (const s of doc.querySelectorAll('select[name]')) body.set(s.getAttribute('name'), (s.querySelector('option[selected]') || s.querySelector('option')).getAttribute('value'))
  body.set(campo, codigo); body.set('__EVENTTARGET', campo); body.set('__EVENTARGUMENT', '')
  return body
}
function identidad(doc, contexto) {
  if (opcion(doc, 'controlNavegacion_temporadasDropDownList')?.codigo !== contexto.temporada.codigo || opcion(doc, 'controlNavegacion_categoriasDropDownList')?.codigo !== contexto.categoria.codigo || opcion(doc, 'gruposDropDownList')?.codigo !== contexto.grupo.codigo) throw Error('Aragón devuelve otro grupo, categoría o temporada')
}
function tablaAragon(doc, contexto) {
  const tabla = doc.querySelector('#clasificacionDataGrid')
  if (!tabla) return []
  const filas = tabla.querySelectorAll('tr').filter(tr => !tr.classList.contains('TablaDatosCabecera')).map(tr => {
    const c = tr.querySelectorAll('td'), nombre = texto(c[1]?.text), cifras = [0, 2, 3, 4, 5, 6, 7].map(i => texto(c[i]?.text)), enlace = c[1]?.querySelector('a[href]')?.getAttribute('href')
    if (!nombre || cifras.some(n => !/^-?\d+$/.test(n)) || !enlace) throw Error('Clasificación aragonesa incompleta')
    const u = new URL(enlace, BASE)
    if (u.origin !== new URL(BASE).origin || u.searchParams.get('c') !== contexto.categoria.codigo || u.searchParams.get('g') !== contexto.grupo.codigo || u.searchParams.get('a') !== contexto.territorio) throw Error('Clasificación aragonesa de otro grupo')
    return { posicion: Number(cifras[0]), nombre, valores: Object.fromEntries(['pj', 'pg', 'pp', 'pf', 'pc', 'pt'].map((k, i) => [k, Number(cifras[i + 1])])) }
  })
  if (!filas.length || new Set(filas.map(f => f.posicion)).size !== filas.length || filas.some(f => f.posicion < 1)) throw Error('Clasificación aragonesa vacía o repetida')
  return [{ id: 'grupo-' + contexto.grupo.codigo, nombre: contexto.grupo.nombre, columnas: ['pj', 'pg', 'pp', 'pf', 'pc', 'pt'].map(clave => ({ clave, nombre: clave.toUpperCase() })), filas }]
}
function equiposAragon(nombre, conocidos) {
  const coincidencias = conocidos.filter(n => nombre.startsWith(n + ' - ') && conocidos.includes(nombre.slice(n.length + 3))).map(local => [local, nombre.slice(local.length + 3)])
  if (coincidencias.length === 1) return coincidencias[0]
  const partes = nombre.split(' - ')
  if (partes.length === 2 && partes.every(Boolean)) return partes
  throw Error('La fuente no separa con claridad ambos equipos')
}
function agendaAragon(doc, contexto, conocidos, ahora) {
  const eventos = [], hoy = new Date(ahora).toISOString().slice(0, 10)
  for (const [id, cabecera] of [['jornadaDataGrid', 'jornadaCabeceraSeccion_tituloLabel'], ['proximaJornadaDataGrid', 'proximaJornadaCabeceraSeccion_tituloLabel']]) {
    const tabla = doc.querySelector('#' + id)
    if (!tabla) continue
    const jornada = texto(doc.querySelector('#' + cabecera)?.text)
    for (const tr of tabla.querySelectorAll('tr')) {
      const c = tr.querySelectorAll('td'), nombre = texto(c[0]?.querySelector('span')?.text), resultado = texto(c[1]?.text), f = texto(c[2]?.text), h = texto(c[3]?.text)
      if (!nombre) throw Error('Partido aragonés sin equipos')
      if (/(?:^| - )DESCANSA(?:$| - )/i.test(nombre)) continue
      const [local, visitante] = equiposAragon(nombre, conocidos), m = f.match(/^(\d{2})\/(\d{2})\/(\d{4})$/), fecha = m ? `${m[3]}-${m[2]}-${m[1]}` : null
      if (fecha && (!fechaDeportiva(fecha) || fecha < contexto.temporada.codigo + '-07-01' || fecha > (Number(contexto.temporada.codigo) + 1) + '-06-30')) throw Error('Partido aragonés fuera de temporada')
      if (!fecha && f && f !== '-') throw Error('Fecha aragonesa no reconocida')
      const inicio = fecha && h && h !== '00:00' && h !== '-' ? horaGipuzkoa(fecha, h) : null, marcador = resultado.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/)
      const futuro = fecha && (fecha > hoy || inicio && Date.parse(inicio) > ahora), final = marcador && Number(marcador[1]) + Number(marcador[2]) > 0 && fecha && fecha < hoy && !futuro
      if (!marcador && resultado !== '-' && !/aplazad|suspendid|cancelad/i.test(resultado)) throw Error('Marcador aragonés no reconocido')
      const estado = /aplazad|suspendid/i.test(resultado) ? 'aplazado' : /cancelad/i.test(resultado) ? 'cancelado' : final ? 'finalizado' : marcador && Number(marcador[1]) + Number(marcador[2]) > 0 ? 'por_confirmar' : fecha && fecha >= hoy ? 'programado' : 'por_confirmar'
      eventos.push({ id: 'aragon-' + contexto.grupo.codigo + '-' + createHash('sha256').update(jornada.replace(/Próxima /, '') + '\n' + nombre).digest('hex').slice(0, 20), nombre: local + ' · ' + visitante, local, visitante, estado, ...(fecha ? { fecha } : {}), ...(inicio ? { inicio } : {}), ...(final ? { resultado: { local: Number(marcador[1]), visitante: Number(marcador[2]) } } : {}), jornada, fuenteUrl: contexto.url,
        ...(!inicio ? { detalle: 'Hora por confirmar. En la fuente oficial selecciona el grupo «' + contexto.grupo.nombre + '».' } : {}) })
    }
  }
  if (new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Partidos aragoneses duplicados')
  return eventos
}
export function grupoAragon(html, contexto, ahora = Date.now()) {
  const doc = parse(html); identidad(doc, contexto)
  const fecha = new Date(ahora).toISOString(), incidencias = [], bloque = (campo, datos, aviso) => ({ estado: datos.length ? 'actualizado' : 'no_disponible', consultado: fecha, ...(datos.length ? { verificadoEn: fecha } : {}), fuenteUrl: contexto.url, [campo]: datos, aviso })
  let tablas = [], eventos = []
  try { tablas = tablaAragon(doc, contexto) } catch (e) { incidencias.push(e.message) }
  try { eventos = agendaAragon(doc, contexto, tablas.flatMap(t => t.filas.map(f => f.nombre)), ahora) } catch (e) { incidencias.push(e.message) }
  const genero = /mixt/i.test(contexto.categoria.nombre) ? 'mixto' : /femenin/i.test(contexto.categoria.nombre) ? 'femenino' : /masculin/i.test(contexto.categoria.nombre) ? 'masculino' : undefined
  return { id: 'basket-aragon-' + contexto.territorio + '-' + contexto.grupo.codigo, deporte: 'baloncesto', nombre: contexto.categoria.nombre + ' · ' + contexto.grupo.nombre, temporada: contexto.temporada.nombre, categoria: contexto.categoria.nombre, grupo: contexto.grupo.nombre, zona: TERRITORIOS.find(t => t.codigo === contexto.territorio)?.nombre || 'Aragón', ...(genero ? { genero } : {}), fuente: { nombre: 'Federación Aragonesa de Baloncesto · FEB', url: contexto.url }, comprobadoEn: fecha,
    agenda: bloque('eventos', eventos, incidencias.length ? incidencias.join('. ') : 'Jornada actual y siguiente publicadas por la federación. Selecciona el grupo indicado en la página oficial para consultar el resto.'),
    clasificacion: bloque('tablas', tablas, tablas.length ? 'Clasificación publicada para el grupo seleccionado.' : incidencias.join('. ') || 'La federación todavía no publica la clasificación de este grupo.') }
}
export async function obtieneBaloncestoAragon(opciones = {}) {
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[PORTAL]), competiciones = [], incidencias = [], reloj = opciones.relojAragon || Date.now, duerme = opciones.duermeAragon || (ms => new Promise(r => setTimeout(r, ms))), guardar = () => opciones.guardarEstadoNovanet?.(PORTAL, estado)
  let siguiente = 0, parado = false
  const restantes = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? 120 : 120 - estado.ventana.peticiones
  const disponible = () => !parado && restantes() > 0 && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes))
  const lee = (url, body) => leerFuenteDeportiva(url, { fetcher: async (destino, init) => {
    if (!disponible()) throw Error('Aragón continuará en la próxima tanda permitida')
    if (siguiente > reloj()) await duerme(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    estado.ventana.peticiones++; siguiente = reloj() + 1000
    if (estado.ventana.peticiones >= 120) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
    await guardar()
    const r = await (opciones.fetcher || fetch)(destino, { ...init, ...(body ? { method: 'POST', body, headers: { ...init.headers, 'Content-Type': 'application/x-www-form-urlencoded' } } : {}) })
    if (r.status === 429) { const v = r.headers.get('Retry-After'), h = /^\d+$/.test(v || '') ? reloj() + Number(v) * 1000 : Date.parse(v); estado.noConsultarAntes = new Date(Math.max(Number.isFinite(h) ? h : reloj() + HORA, reloj())).toISOString(); parado = true; await guardar() }
    return r
  } })
  const fallo = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, motivo, fuenteUrl: WEB, ...(id ? { id } : {}) })
  try {
    if (!estado.catalogo || reloj() - Date.parse(estado.catalogo.verificadoEn) > 86400000) {
      const catalogos = []
      for (const t of TERRITORIOS) catalogos.push(catalogoAragon(await lee(urlCategoria(t.codigo)), t.codigo))
      if (new Set(catalogos.map(c => c.temporada.codigo)).size !== 1) throw Error('Las delegaciones aragonesas no publican la misma temporada')
      const temporada = catalogos[0].temporada, categorias = catalogos.flatMap(c => c.categorias)
      // Se conserva el cursor al refrescar un catálogo de la misma temporada.
      const actual = estado.catalogo?.categorias[estado.categoria], misma = estado.catalogo?.temporada.codigo === temporada.codigo
      estado.catalogo = { temporada, categorias, verificadoEn: new Date(reloj()).toISOString() }; estado.categoria = misma ? Math.max(0, categorias.findIndex(c => c.codigo === actual?.codigo)) : 0
      // Las fases nuevas aparecen en el selector; hay que volver a enumerarlas.
      estado.grupo = 0; if (!misma) estado.verificados = {}
      await guardar()
    }
    const vistos = new Set(), cache = new Map(), categorias = estado.catalogo.categorias
    while (disponible() && restantes() >= 2) {
      const c = categorias[estado.categoria], territorio = c.familia, codigo = c.codigo.slice(2), url = urlCategoria(territorio, codigo)
      let html = cache.get(c.codigo)
      if (!html) { html = await lee(url); cache.set(c.codigo, html) }
      const doc = parse(html), pagina = catalogoAragon(html, territorio)
      if (pagina.temporada.codigo !== estado.catalogo.temporada.codigo || opcion(doc, 'controlNavegacion_categoriasDropDownList')?.codigo !== codigo) throw Error('Categoría aragonesa de otra temporada')
      if (!c.grupos) { c.grupos = opcionesSelect(doc, 'gruposDropDownList').map(({ codigo, nombre }) => ({ codigo, nombre })); if (c.grupos.some(g => !/^\d+$/.test(g.codigo) || !g.nombre)) throw Error('Grupo aragonés incompleto'); await guardar() }
      if (!c.grupos.length) { const vacia = 'vacia-' + c.codigo; if (vistos.has(vacia)) break; vistos.add(vacia); estado.categoria = (estado.categoria + 1) % categorias.length; estado.grupo = 0; await guardar(); continue }
      estado.grupo %= c.grupos.length
      const g = c.grupos[estado.grupo], clave = c.codigo + '-' + g.codigo
      if (vistos.has(clave)) break
      vistos.add(clave)
      try {
        const datos = opcion(doc, 'gruposDropDownList')?.codigo === g.codigo ? html : await lee(url, formularioAragon(html, 'gruposDropDownList', g.codigo))
        const comp = grupoAragon(datos, { territorio, categoria: { codigo, nombre: c.nombre }, grupo: g, temporada: estado.catalogo.temporada, url }, reloj())
        competiciones.push(comp)
        if (comp.agenda.verificadoEn || comp.clasificacion.verificadoEn) { estado.ultimoExito = comp.comprobadoEn; estado.verificados[clave] = comp.comprobadoEn }
        if (comp.agenda.estado === 'no_disponible' || comp.clasificacion.estado === 'no_disponible') fallo(comp.nombre, [comp.agenda.estado === 'no_disponible' ? comp.agenda.aviso : '', comp.clasificacion.estado === 'no_disponible' ? comp.clasificacion.aviso : ''].filter(Boolean).join('. '), comp.id)
      } catch (e) { fallo(c.nombre + ' · ' + g.nombre, e.message, 'basket-aragon-' + territorio + '-' + g.codigo) }
      if (parado) break
      estado.grupo++; if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % categorias.length }
      await guardar()
    }
    fallo('Aragón · actualización por grupos', `Categorías localizadas: ${estado.catalogo.categorias.length}. Grupos comprobados: ${Object.keys(estado.verificados).length}. La actualización continúa por tandas.`)
  } catch (e) { fallo('Baloncesto · Aragón', e.message) }
  return { competiciones, incidencias }
}
