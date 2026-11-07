import { parse } from 'node-html-parser'
import { leerFuenteDeportiva } from './deportes.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'
import { grupoBaloncestoOW, respuestaBaloncestoOW, temporadaBaloncestoOW } from './deportes-baloncesto-bizkaia.mjs'
const HORA = 3600000, MAX = 120
const FUENTES = {
  fbcv: { fede: 'fbcv', pagina: 'https://www.fbcv.es/competiciones/calendario-resultados-y-clasificacion/', nombre: 'Federación de Baloncesto de la Comunitat Valenciana', zona: 'Comunitat Valenciana' },
  navarra: { fede: 'fnb', pagina: 'https://www.fnbaloncesto.com/resultados-y-clasificaciones/', nombre: 'Federación Navarra de Baloncesto', zona: 'Navarra' },
  clm: { fede: 'fbclm', pagina: 'https://fbclm.net/resultados-y-clasificaciones/', nombre: 'Federación de Baloncesto de Castilla-La Mancha', zona: 'Castilla-La Mancha' },
  rioja: { fede: 'frb', pagina: 'https://competicionesfrb.owbasket.com/', nombre: 'Federación Riojana de Baloncesto', zona: 'La Rioja' },
  cantabria: { fede: 'fecan', pagina: 'https://www.fecanbaloncesto.com/resultados-y-clasificaciones/', nombre: 'Federación de Baloncesto de Cantabria', zona: 'Cantabria' },
  baleares: { fede: 'fbib', pagina: 'https://www.fbib.es/', nombre: 'Federació de Bàsquet de les Illes Balears', zona: 'Illes Balears', bundle: true },
}
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim(), codigo = v => /^\d{1,10}$/.test(String(v))
// Algunas categorías nacionales también contienen copas territoriales: se filtra
// el grupo nacional duplicado, nunca toda la categoría que lo contiene.
export const esLigaNacionalOW = nombre => /^(?:primera feb|segunda feb|tercera feb|lf endesa|lf challenge|liga femenina (?:endesa|challenge|2))$/i.test(texto(nombre))
function configuracionPublicaOW(html) {
  const script = parse(html).querySelectorAll('script').map(s => s.text).find(s => /var owbasket = /.test(s))
  return JSON.parse(script?.match(/var owbasket = (\{[^\n]+\});/)?.[1] || 'null')
}
export function basePublicaFbcv(html, federacion = 'fbcv') {
  const config = configuracionPublicaOW(html)?.['owbasket-apis']?.[0]
  const base = config?.esb?.url
  if (!Object.values(FUENTES).some(f => f.fede === federacion) || config?.fede?.url !== federacion || config?.system?.url !== 'esb' || typeof base !== 'string' || !/^https:\/\/esb\.optimalwayconsulting\.com\/[a-z]+\/1\/[A-Za-z0-9_-]{10,100}$/.test(base) || new URL(base).pathname.split('/')[1] !== federacion) throw Error('La federación no publica una conexión reconocida de resultados')
  return base
}
export function categoriasFbcv(datos, temporada, zona, genero) {
  if (!Array.isArray(datos)) throw Error('Catálogo federativo incompleto')
  return datos.map(c => {
    if (!codigo(c.idCategoryRegistred) || c.season !== temporada || c.zone !== zona || c.sex !== genero || !texto(c.categoryRegisteredName)) throw Error('Categoría federativa de otra temporada o territorio')
    return { codigo: zona.padStart(2, '0') + c.idCategoryRegistred, nombre: texto(c.categoryRegisteredName), familia: genero + '/' + zona, grupos: null }
  })
}
export function basePublicaBaleares(javascript) {
  const bases = [...new Set(javascript.match(/https:\/\/esb\.optimalwayconsulting\.com\/fbib\/1\/[A-Za-z0-9_-]{10,100}/g) || [])]
  if (bases.length !== 1 || !javascript.includes('https://www.fbib.es/competicion/{id}/{round}')) throw Error('Baleares no identifica una única conexión pública y sus páginas de competición')
  return bases[0]
}
export async function obtieneBaloncestoFbcv(opciones = {}, fuenteId = 'fbcv') {
  const fuente = FUENTES[fuenteId]
  if (!fuente) throw Error('Federación sin conexión comprobada')
  const PAGINA = fuente.pagina, WEB = new URL(PAGINA).origin, PORTAL = 'basket-' + fuenteId
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[PORTAL]), competiciones = [], incidencias = []
  const reloj = opciones.relojFbcv || Date.now, duerme = opciones.duermeFbcv || (ms => new Promise(r => setTimeout(r, ms))), guardar = () => opciones.guardarEstadoNovanet?.(PORTAL, estado)
  let siguiente = 0, detenido = false
  const restantes = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? MAX : MAX - estado.ventana.peticiones
  const disponible = () => !detenido && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes)) && restantes() > 0
  const incidencia = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, fuenteUrl: PAGINA, motivo, ...(id ? { id } : {}) })
  const lee = url => leerFuenteDeportiva(url, { fetcher: async (destino, init) => {
    if (!disponible()) throw Error('Continuaremos desde el siguiente grupo en la próxima tanda permitida')
    if (siguiente > reloj()) await duerme(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    estado.ventana.peticiones++; siguiente = reloj() + 1000
    if (estado.ventana.peticiones >= MAX) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
    await guardar()
    const r = await (opciones.fetcher || fetch)(destino, { ...init, headers: { ...init.headers, Origin: WEB, Referer: PAGINA } })
    if (r.status === 429) {
      const valor = r.headers.get('Retry-After'), fecha = Date.parse(valor)
      const hasta = /^\d+$/.test(valor || '') ? reloj() + Number(valor) * 1000 : Number.isFinite(fecha) && fecha > reloj() ? fecha : reloj() + HORA
      estado.noConsultarAntes = new Date(Math.max(hasta, Date.parse(estado.noConsultarAntes || '') || 0)).toISOString(); detenido = true; await guardar()
    }
    return r
  } })
  try {
    if (!disponible()) throw Error('La fuente está en pausa hasta la próxima tanda permitida')
    const html = await lee(PAGINA)
    let base, grupoPagina
    if (fuente.bundle) {
      const script = parse(html).querySelector('script[src="/main.js"]')
      if (!script) throw Error('El portal balear no publica su aplicación de resultados')
      base = basePublicaBaleares(await lee(WEB + '/main.js')); grupoPagina = WEB + '/competicion/'
    } else { base = basePublicaFbcv(html, fuente.fede); grupoPagina = configuracionPublicaOW(html)?.['owbasket-urls']?.[0]?.es?.group?.url }
    const api = async ruta => respuestaBaloncestoOW(await lee(base + ruta))
    if (typeof grupoPagina !== 'string' || !grupoPagina.startsWith('https://') || new URL(grupoPagina).hostname.replace(/^www\./, '') !== new URL(PAGINA).hostname.replace(/^www\./, '')) throw Error('La federación no identifica la página pública de sus grupos')
    const temporadas = await api('/Season/getActiveWebVisibility')
    const temporada = temporadaBaloncestoOW(Array.isArray(temporadas) ? temporadas.map(t => ({ ...t, name: texto(t.name).replace(/^Temporada\s+/, '').replace(/^(20\d{2})\/(\d{2})$/, '$1/20$2') })) : temporadas, reloj())
    const zonas = await api('/Zone/getVisibleWeb')
    if (!Array.isArray(zonas) || !zonas.length || zonas.some(z => !codigo(z.idZone) || !texto(z.name) || z.visibleWeb !== '1') || new Set(zonas.map(z => z.idZone)).size !== zonas.length) throw Error('La federación no identifica sus territorios públicos')
    if (!estado.catalogo || estado.catalogo.temporada.codigo !== temporada.codigo || reloj() - Date.parse(estado.catalogo.verificadoEn) > 7 * 86400000) {
      const categorias = []
      for (const zona of zonas) for (const genero of ['M', 'F', 'X']) categorias.push(...categoriasFbcv(await api('/CategoryRegistered/getVisibleWeb/' + temporada.codigo + '/' + zona.idZone + '/' + genero), temporada.codigo, zona.idZone, genero))
      if (!categorias.length || new Set(categorias.map(c => c.codigo)).size !== categorias.length) throw Error('Catálogo federativo vacío o duplicado')
      estado.catalogo = { temporada, categorias, verificadoEn: new Date(reloj()).toISOString() }; estado.categoria = 0; estado.grupo = 0; estado.verificados = {}; await guardar()
    }
    const categorias = estado.catalogo.categorias, visitados = new Set()
    while (disponible() && restantes() >= 3) {
      const c = categorias[estado.categoria], [genero, territorio] = c.familia.split('/'), real = c.codigo.slice(2), zona = zonas.find(z => z.idZone === territorio)
      if (!zona || !['M', 'F', 'X'].includes(genero)) throw Error('El territorio guardado ya no aparece en la federación')
      if (!c.grupos) {
        const datos = await api('/Competition/getCompetitionGroupVisibleWeb/' + real + '/' + territorio)
        if (!Array.isArray(datos)) throw Error('Grupos federativos no disponibles')
        c.grupos = datos.map(g => { if (!codigo(g.idGroup) || g.season !== temporada.codigo || g.idCategoryRegistered !== real || g.idZone !== territorio || !texto(g.nameGrupCompetition)) throw Error('Grupo federativo de otra categoría'); return { codigo: String(g.idGroup), nombre: texto(g.nameGrupCompetition) } })
        await guardar()
      }
      if (!c.grupos.length) { estado.categoria = (estado.categoria + 1) % categorias.length; estado.grupo = 0; await guardar(); if (visitados.has('vacia-' + c.codigo)) break; visitados.add('vacia-' + c.codigo); continue }
      const g = c.grupos[estado.grupo], clave = c.codigo + '-' + g.codigo
      if (visitados.has(clave)) break
      visitados.add(clave)
      const id = 'basket-' + fuenteId + '-' + g.codigo, fuenteUrl = fuente.bundle ? grupoPagina + g.codigo : grupoPagina + (grupoPagina.includes('?') ? '&' : '?') + 'id=' + g.codigo
      try {
        const actual = await api('/FCBQWeb/resultats/' + g.codigo), respuestas = [actual], anterior = Number(actual.lastRound) - 1
        if (esLigaNacionalOW(actual.group?.competitionName)) {
          estado.grupo++; if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % categorias.length }
          await guardar(); continue
        }
        let faltaAnterior
        if (Number.isSafeInteger(anterior) && anterior > 0) try { respuestas.push(await api('/FCBQWeb/resultats/' + g.codigo + '/' + anterior)) } catch (e) { faltaAnterior = e.message; incidencia(c.nombre + ' · ' + g.nombre, 'No se pudo comprobar la jornada anterior: ' + e.message, id) }
        const comp = grupoBaloncestoOW(respuestas, { id, temporada, categoria: { ...c, codigo: real, familia: /mixt[oa]/i.test(c.nombre) ? 'X' : genero }, grupo: g, zona: territorio === '1' ? fuente.zona : fuente.zona + ' · ' + zona.name, territorio, fuenteUrl, fuenteNombre: fuente.nombre }, reloj())
        if (faltaAnterior) comp.agenda = { estado: 'no_disponible', consultado: comp.comprobadoEn, fuenteUrl, eventos: [], aviso: 'No se pudo comprobar la jornada anterior; se conserva la última agenda completa cuando existe.' }
        competiciones.push(comp)
        estado.ultimoExito = new Date(reloj()).toISOString(); estado.verificados[clave] = estado.ultimoExito
      } catch (e) { incidencia(c.nombre + ' · ' + g.nombre, e.message, id); if (!disponible()) break }
      estado.grupo++
      if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % categorias.length }
      await guardar()
    }
  } catch (e) { incidencia('Baloncesto · ' + fuente.zona, e.message) }
  if (estado.catalogo) incidencia(fuente.zona + ' · actualización por grupos', `Categorías localizadas: ${estado.catalogo.categorias.length}. Grupos comprobados: ${Object.keys(estado.verificados).length}. La actualización continúa por tandas y conserva la fecha de cada grupo.`)
  return { competiciones, incidencias }
}
export async function obtieneBaloncestoOtrasOW(opciones = {}) {
  const competiciones = [], incidencias = []
  for (const id of ['navarra', 'clm', 'rioja', 'cantabria', 'baleares']) {
    const r = await obtieneBaloncestoFbcv(opciones, id)
    competiciones.push(...r.competiciones); incidencias.push(...r.incidencias)
  }
  return { competiciones, incidencias }
}
