import { parse } from 'node-html-parser'
import { leerFuenteDeportiva } from './deportes.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'
import { grupoBaloncestoOW, respuestaBaloncestoOW } from './deportes-baloncesto-bizkaia.mjs'
const WEB = 'https://www.fbcyl.es', INDICE = WEB + '/buscar_competicion', PORTAL = 'basket-fbcyl', HORA = 3600000, MAX = 120
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
export function opcionesFbcyl(html, selector = 'option') {
  const opciones = parse(html).querySelectorAll(selector)
  if (!opciones.length) throw Error('El selector FBCYL no está disponible')
  const lista = opciones.filter(n => /^\d+$/.test(n.getAttribute('value') || '') && Number(n.getAttribute('value')) > 0).map(n => ({ codigo: n.getAttribute('value'), nombre: texto(n.text) }))
  if (lista.some(n => !n.nombre) || new Set(lista.map(n => n.codigo)).size !== lista.length) throw Error('Selector FBCYL incompleto o duplicado')
  return lista
}
export function contextoFbcyl(html) {
  const doc = parse(html), seleccionado = doc.querySelector('#temporada option[selected]')
  const codigo = seleccionado?.getAttribute('value'), nombre = texto(seleccionado?.text).replace(/^Temporada\s+/, '')
  if (!/^20\d{2}$/.test(codigo || '') || nombre !== codigo + '-' + (Number(codigo) + 1)) throw Error('FBCYL no confirma la temporada del catálogo')
  const territorios = opcionesFbcyl(html, '#territorial option')
  const generos = doc.querySelectorAll('#genere option').map(n => n.getAttribute('value')).filter(n => ['M', 'F', 'X'].includes(n))
  if (!territorios.length || generos.length !== 3) throw Error('FBCYL no entrega sus territorios o categorías')
  return { temporada: { codigo, nombre }, territorios, generos }
}
export function basePublicaFbcyl(html) {
  const raw = html.match(/"REACT_APP_URL_ESB"\s*:\s*("[^"\r\n]+")/)?.[1]
  const base = raw ? JSON.parse(raw) : null
  if (typeof base !== 'string' || !/^https:\/\/esb\.optimalwayconsulting\.com\/fbcyl\/1\/[A-Za-z0-9_-]{10,100}$/.test(base)) throw Error('FBCYL no publica una conexión reconocida de resultados')
  return base
}
export async function obtieneBaloncestoFbcyl(opciones = {}) {
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[PORTAL]), competiciones = [], incidencias = []
  const reloj = opciones.relojFbcyl || Date.now, duerme = opciones.duermeFbcyl || (ms => new Promise(r => setTimeout(r, ms)))
  const guardar = () => opciones.guardarEstadoNovanet?.(PORTAL, estado)
  let detenido = false, siguiente = 0
  const restantes = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? MAX : MAX - estado.ventana.peticiones
  const disponible = () => !detenido && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes)) && restantes() > 0
  const incidencia = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, fuenteUrl: INDICE, motivo, ...(id ? { id } : {}) })
  const lee = url => leerFuenteDeportiva(url, { fetcher: async (destino, init) => {
    if (!disponible()) throw Error('La siguiente tanda continuará desde el último grupo pendiente')
    if (siguiente > reloj()) await duerme(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    estado.ventana.peticiones++; siguiente = reloj() + 1000
    if (estado.ventana.peticiones >= MAX) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
    await guardar()
    const r = await (opciones.fetcher || fetch)(destino, { ...init, headers: { ...init.headers, Origin: WEB, Referer: INDICE } })
    if (r.status === 429) {
      const valor = r.headers.get('Retry-After'), fecha = Date.parse(valor)
      const hasta = /^\d+$/.test(valor || '') ? reloj() + Number(valor) * 1000 : Number.isFinite(fecha) && fecha > reloj() ? fecha : reloj() + HORA
      estado.noConsultarAntes = new Date(Math.max(hasta, Date.parse(estado.noConsultarAntes || '') || 0)).toISOString(); detenido = true; await guardar()
    }
    return r
  } })
  try {
    if (!disponible()) throw Error('La fuente está en pausa hasta la siguiente tanda permitida')
    const contexto = contextoFbcyl(await lee(INDICE)), { temporada, territorios } = contexto
    if (!estado.catalogo || estado.catalogo.temporada.codigo !== temporada.codigo || reloj() - Date.parse(estado.catalogo.verificadoEn) > 7 * 86400000) {
      const categorias = []
      for (const territorio of territorios) for (const genero of contexto.generos) {
        const html = await lee(WEB + '/ajax/combo_categories2/' + temporada.codigo + '/' + genero + '/' + territorio.codigo)
        // La misma categoría se reutiliza en varias provincias. El prefijo del
        // territorio mantiene cursares independientes sin mezclar sus grupos.
        categorias.push(...opcionesFbcyl(html).map(c => ({ ...c, codigo: territorio.codigo.padStart(2, '0') + c.codigo, familia: genero + '/' + territorio.codigo, grupos: null })))
      }
      if (!categorias.length || new Set(categorias.map(c => c.codigo)).size !== categorias.length) throw Error('Catálogo FBCYL vacío o duplicado')
      estado.catalogo = { temporada, categorias, verificadoEn: new Date(reloj()).toISOString() }; estado.categoria = 0; estado.grupo = 0; estado.verificados = {}; await guardar()
    }
    const categorias = estado.catalogo.categorias, visitados = new Set()
    let base
    while (disponible() && restantes() >= 4) {
      const c = categorias[estado.categoria], [genero, territorio] = c.familia.split('/'), categoriaReal = c.codigo.slice(2)
      const zona = territorios.find(t => t.codigo === territorio)
      if (!zona || !contexto.generos.includes(genero)) throw Error('El territorio guardado ya no está en el catálogo FBCYL')
      if (!c.grupos) { c.grupos = opcionesFbcyl(await lee(WEB + '/ajax/combo_competicions2/' + categoriaReal + '/' + genero + '/' + territorio)); await guardar() }
      if (!c.grupos.length) { estado.categoria = (estado.categoria + 1) % categorias.length; estado.grupo = 0; await guardar(); if (visitados.has('vacia-' + c.codigo)) break; visitados.add('vacia-' + c.codigo); continue }
      const g = c.grupos[estado.grupo], clave = c.codigo + '-' + g.codigo
      if (visitados.has(clave)) break
      visitados.add(clave)
      const id = 'basket-fbcyl-' + g.codigo, fuenteUrl = WEB + '/competiciones/resultados/' + g.codigo
      try {
        if (!base) base = basePublicaFbcyl(await lee(fuenteUrl))
        const actual = respuestaBaloncestoOW(await lee(base + '/FCBQWeb/resultats/' + g.codigo)), respuestas = [actual]
        const anterior = Number(actual.lastRound) - 1
        let faltaAnterior
        if (Number.isSafeInteger(anterior) && anterior > 0) try { respuestas.push(respuestaBaloncestoOW(await lee(base + '/FCBQWeb/resultats/' + g.codigo + '/' + anterior))) } catch (e) { faltaAnterior = e.message; incidencia(c.nombre + ' · ' + g.nombre, 'No se pudo comprobar la jornada anterior: ' + e.message, id) }
        const comp = grupoBaloncestoOW(respuestas, { id, temporada, categoria: { ...c, codigo: categoriaReal, familia: genero }, grupo: g, zona: territorio === '1' ? 'Castilla y León' : 'Castilla y León · ' + zona.nombre, territorio, fuenteUrl, fuenteNombre: 'Federación de Baloncesto de Castilla y León' }, reloj())
        if (faltaAnterior) comp.agenda = { estado: 'no_disponible', consultado: comp.comprobadoEn, fuenteUrl, eventos: [], aviso: 'No se pudo comprobar la jornada anterior; se conserva la última agenda completa cuando existe.' }
        competiciones.push(comp)
        estado.ultimoExito = new Date(reloj()).toISOString(); estado.verificados[clave] = estado.ultimoExito
      } catch (e) { incidencia(c.nombre + ' · ' + g.nombre, e.message, id); if (!disponible()) break }
      estado.grupo++
      if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % categorias.length }
      await guardar()
    }
  } catch (e) { incidencia('Baloncesto de Castilla y León', e.message) }
  if (estado.catalogo) incidencia('Castilla y León · actualización por grupos', `Categorías localizadas: ${estado.catalogo.categorias.length}. Grupos comprobados: ${Object.keys(estado.verificados).length}. La actualización continúa por tandas y conserva la fecha de cada grupo.`)
  return { competiciones, incidencias }
}
