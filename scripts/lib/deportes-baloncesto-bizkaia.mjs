import { parse } from 'node-html-parser'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'
import { instanteLocal } from './fechas.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'

const PAGINA = 'https://bizkaiabasket.com/es/resultados-y-clasificaciones/'
const PORTAL = 'basket-bizkaia', HORA = 3600000, PRESUPUESTO = 120
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const codigo = v => /^\d{1,15}$/.test(String(v)) ? String(v) : null
const visible = v => v === true || v === 1 || v === '1'
const entero = (v, minimo = 0, maximo = 100000) => {
  if (!/^-?\d+$/.test(String(v)) || Number(v) < minimo || Number(v) > maximo) throw Error('Cifra federativa incompleta')
  return Number(v)
}
const bloque = (fuenteUrl, sello, campo, datos, aviso) => ({ estado: datos.length ? 'actualizado' : 'no_disponible', consultado: sello,
  ...(datos.length ? { verificadoEn: sello } : {}), fuenteUrl, [campo]: datos, ...(aviso ? { aviso } : {}) })

export function basePublicaBizkaia(html) {
  const script = parse(html).querySelector('#owbasket-js-extra')?.text || ''
  const config = JSON.parse(script.match(/var process = (\{[^\n]+\});/)?.[1] || 'null')?.env
  const base = config?.REACT_APP_URL_ESB
  if (typeof base !== 'string' || !/^https:\/\/esb\.optimalwayconsulting\.com\/esf\/1\/[A-Za-z0-9_-]{10,100}$/.test(base)) throw Error('Bizkaia no publica una conexión reconocida de resultados')
  const nodo = parse(html).querySelector('[data-name="CompetitionSearch"]')
  const zona = JSON.parse(nodo?.getAttribute('data-props') || 'null')?.dzone
  if (!codigo(zona)) throw Error('Bizkaia no identifica su territorio público')
  return { base, zona: String(zona) }
}

export function respuestaBaloncestoOW(raw) {
  const contenido = texto(raw)
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(contenido)) throw Error('Respuesta federativa no reconocida')
  const datos = JSON.parse(Buffer.from(contenido, 'base64').toString('utf8'))
  if (datos?.result !== 'OK' || datos.messageData === undefined) throw Error('La federación no ha entregado datos públicos verificables')
  return datos.messageData
}

export function temporadaBaloncestoOW(datos, ahora = Date.now()) {
  if (!Array.isArray(datos)) throw Error('Temporadas federativas no disponibles')
  const activas = datos.filter(t => visible(t.active))
  if (activas.length !== 1) throw Error('La federación no identifica una única temporada activa')
  const t = activas[0], hoy = new Date(ahora).toISOString().slice(0, 10)
  if (!codigo(t.idSeason) || !/^20\d{2}[-/]20\d{2}$/.test(t.name) || !fechaDeportiva(t.beginDate) || !fechaDeportiva(t.finalDate) ||
    hoy < t.beginDate || hoy > t.finalDate || !t.name.startsWith(t.idSeason)) throw Error('Temporada federativa incoherente')
  return { codigo: String(t.idSeason), nombre: t.name.replace('/', '-') }
}

/** Lee exclusivamente calendario, marcadores visibles y tabla; nunca actas ni fichas personales. */
export function grupoBaloncestoOW(datos, contexto, ahora = Date.now()) {
  const { id, temporada, categoria, grupo, zona, fuenteUrl, fuenteNombre, territorio } = contexto
  if (!Array.isArray(datos) || !datos.length) throw Error('Grupo sin respuesta verificable')
  const principal = datos[0], g = principal.group, sello = new Date(ahora).toISOString()
  for (const d of datos) if (String(d?.group?.idGroup) !== grupo.codigo || String(d.group.season) !== temporada.codigo ||
    String(d.group.idCategory) !== categoria.codigo || territorio && String(d.group.idTerritorial) !== territorio) throw Error('La fuente devuelve otro grupo, categoría o temporada')
  if (!texto(g.competitionName) || !texto(g.nameGroup) || !visible(g.visibility)) throw Error('Grupo no visible o sin nombre verificable')
  const eventos = new Map()
  for (const d of datos) {
    const partidos = Object.values(d.rounds || {}).flatMap(r => Object.values(r.matches || {}))
    // Los cuadros playoff abreviados no incluyen temporada, visibilidad ni estado final.
    // Sus partidos se leen de rounds, que sí aporta esos datos y los marcadores autorizados.
    for (const p of partidos) {
      if (!codigo(p.idMatch) || String(p.idGroup) !== grupo.codigo || String(p.season) !== temporada.codigo ||
        String(p.idCategorySigned) !== categoria.codigo) throw Error('Partido de otro grupo o sin identidad')
      if (eventos.has(String(p.idMatch))) continue
      const local = texto(p.nameLocalTeam), visitante = texto(p.nameVisitorTeam)
      if (!local || !visitante) throw Error('Partido sin ambos equipos')
      const sinFecha = p.matchDay === '2100-01-01 00:00:00' && String(p.state) === '0' && p.idMatchResult == null
      const dia = !sinFecha && typeof p.matchDay === 'string' && fechaDeportiva(p.matchDay.slice(0, 10)) ? p.matchDay.slice(0, 10) : null
      if (dia && (dia < temporada.codigo + '-07-01' || dia > (Number(temporada.codigo) + 1) + '-06-30')) throw Error('Partido fuera de su temporada')
      const ms = dia && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(p.matchDay) && !/ 00:00:00$/.test(p.matchDay) ? instanteLocal(p.matchDay) : NaN
      const inicio = Number.isFinite(ms) ? new Date(ms).toISOString() : null
      const publicadoFinal = String(p.state) === '1' && codigo(p.idMatchResult) !== null
      const futuro = inicio ? ms > ahora : dia && dia > new Date(ahora).toISOString().slice(0, 10)
      const previo = publicadoFinal && futuro && p.typeResult === 'P'
      const final = publicadoFinal && !previo
      if (final && futuro) throw Error('Marcador final con fecha futura')
      const conMarcador = final && visible(g.resultsVisibles) && visible(p.resultsVisibles)
      const estado = final ? 'finalizado' : String(p.state) === '0' && inicio && ms > ahora ? 'programado' : 'por_confirmar'
      eventos.set(String(p.idMatch), { id: 'partido-' + p.idMatch, nombre: local + ' – ' + visitante, local, visitante, estado,
        ...(inicio ? { inicio } : dia ? { fecha: dia } : {}), jornada: 'Jornada ' + entero(p.numMatchDay, 1, 1000),
        ...(conMarcador ? { resultado: { local: entero(p.localScore, 0, 1000), visitante: entero(p.visitorScore, 0, 1000) } } : {}),
        ...(previo ? { detalle: 'La fuente publica un marcador antes de la fecha del partido. Consulta la federación.' } : {}),
        ...(final && !conMarcador ? { detalle: 'La federación no publica el marcador de este partido.' } : {}),
        ...(texto(p.nameField) ? { lugar: texto(p.nameField) + (texto(p.nameTown) ? ' · ' + texto(p.nameTown) : '') } : {}), fuenteUrl,
      })
    }
  }
  const filas = [], identidades = new Set()
  let avisoClasificacion
  try { if (visible(g.resultsVisibles) && Array.isArray(principal.standing)) for (const f of principal.standing) {
    if (String(f.idGroup) !== grupo.codigo || String(f.season) !== temporada.codigo || String(f.categoriesRegistred) !== categoria.codigo || !texto(f.teamName)) throw Error('Clasificación de otra competición')
    const identidad = codigo(f.idTeam) || texto(f.teamName)
    if (identidades.has(identidad)) throw Error('Equipos duplicados en la clasificación')
    identidades.add(identidad)
    const pj = entero(f.matchPlayed), pg = entero(f.matchWin), pp = entero(f.matchLost), pe = entero(f.matchTie ?? 0), np = entero(f.matchNotPresent ?? 0)
    if (pg + pp + pe !== pj && pg + pp + pe + np !== pj) throw Error('Clasificación con balance de partidos incoherente')
    filas.push({ posicion: entero(f.position) || null, nombre: texto(f.teamName), valores: { puntos: entero(f.standingScore, -100), pj, pg, pp, pe, pf: entero(f.matchScoreFavour), pc: entero(f.matchScoreAgainst) } })
  } } catch {
    filas.length = 0
    avisoClasificacion = 'La clasificación publicada contiene datos incoherentes. Conservamos la última copia comprobada, si existe.'
  }
  const columnas = [['puntos', 'Puntos'], ['pj', 'Jugados'], ['pg', 'Ganados'], ['pp', 'Perdidos'], ['pe', 'Empatados'], ['pf', 'A favor'], ['pc', 'En contra']].map(([clave, nombre]) => ({ clave, nombre }))
  const fase = texto(g.competitionName)
  const nombre = /^(?:(?:primera|segunda|tercera|\d+[ªaºo]?)\s+)?fase\b|^liga regular$|^copa$/i.test(fase) ? texto(categoria.nombre) + ' · ' + fase : fase
  return { id, deporte: 'baloncesto', nombre, temporada: temporada.nombre, categoria: categoria.nombre,
    zona, grupo: texto(g.nameGroup), genero: ({ M: 'masculino', F: 'femenino', X: 'mixto' })[categoria.familia],
    fuente: { nombre: fuenteNombre, url: fuenteUrl }, comprobadoEn: sello,
    agenda: bloque(fuenteUrl, sello, 'eventos', [...eventos.values()], 'Incluye las jornadas cercanas que hemos comprobado. El calendario completo está en la fuente oficial.'),
    clasificacion: bloque(fuenteUrl, sello, 'tablas', filas.length ? [{ id: 'general', nombre: 'Clasificación del grupo', columnas, filas }] : [], avisoClasificacion || (!filas.length ? 'La fuente no publica una clasificación verificable para este grupo.' : undefined)),
  }
}

export async function obtieneBaloncestoBizkaia(opciones = {}) {
  const estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[PORTAL]), competiciones = [], incidencias = []
  const reloj = opciones.relojBizkaia || Date.now, duerme = opciones.duermeBizkaia || (ms => new Promise(r => setTimeout(r, ms)))
  let siguiente = 0, detenido = false, peticiones = 0
  const guardar = () => opciones.guardarEstadoNovanet?.(PORTAL, estado)
  const restantes = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? PRESUPUESTO : PRESUPUESTO - estado.ventana.peticiones
  const disponible = () => !detenido && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes)) && restantes() > 0
  const incidencia = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, motivo, fuenteUrl: PAGINA, ...(id ? { id } : {}) })
  const lee = async url => leerFuenteDeportiva(url, { fetcher: async (u, init) => {
    if (!disponible()) throw Error('Se continuará desde este grupo en la siguiente tanda permitida')
    if (siguiente > reloj()) await duerme(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    estado.ventana.peticiones++; peticiones++; siguiente = reloj() + 1000
    if (estado.ventana.peticiones >= PRESUPUESTO) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
    await guardar()
    const r = await (opciones.fetcher || fetch)(u, { ...init, headers: { ...init.headers, Referer: PAGINA, Origin: 'https://bizkaiabasket.com' } })
    if (r.status === 429) {
      const valor = r.headers.get('Retry-After'), fecha = Date.parse(valor)
      const hasta = /^\d+$/.test(valor || '') ? reloj() + Number(valor) * 1000 : Number.isFinite(fecha) && fecha > reloj() ? fecha : reloj() + HORA
      estado.noConsultarAntes = new Date(Math.max(hasta, Date.parse(estado.noConsultarAntes || '') || 0)).toISOString(); detenido = true
      await guardar()
    }
    return r
  } })
  try {
    if (!disponible()) throw Error('La federación tiene una pausa o una tanda de consultas pendiente de completar')
    const { base, zona } = basePublicaBizkaia(await lee(PAGINA))
    const api = async ruta => respuestaBaloncestoOW(await lee(base + ruta))
    const temporada = temporadaBaloncestoOW(await api('/Season/getActiveWebVisibility'), reloj())
    if (!estado.catalogo || estado.catalogo.temporada.codigo !== temporada.codigo || reloj() - Date.parse(estado.catalogo.verificadoEn) > 7 * 86400000) {
      const categorias = []
      for (const sexo of ['M', 'F', 'X']) {
        const lista = await api(`/CategoryRegistered/getVisibleWeb/${temporada.codigo}/${zona}/${sexo}`)
        if (!Array.isArray(lista)) throw Error('Catálogo territorial no disponible')
        for (const c of lista) {
          if (!codigo(c.idCategoryRegistred) || c.season !== temporada.codigo || c.zone !== zona || c.sex !== sexo || !texto(c.categoryRegisteredName)) throw Error('Categoría de otra temporada o territorio')
          categorias.push({ codigo: String(c.idCategoryRegistred), nombre: texto(c.categoryRegisteredName), familia: sexo, grupos: null })
        }
      }
      if (!categorias.length) throw Error('No hay categorías verificadas')
      estado.catalogo = { temporada, categorias, verificadoEn: new Date(reloj()).toISOString() }; estado.categoria = 0; estado.grupo = 0; estado.verificados = {}
      await guardar()
    }
    const categorias = estado.catalogo.categorias, visitados = new Set()
    while (disponible() && restantes() >= 3) {
      const c = categorias[estado.categoria]
      if (!c.grupos) {
        const grupos = await api(`/Competition/getCompetitionGroupVisibleWeb/${c.codigo}/${zona}`)
        if (!Array.isArray(grupos)) throw Error('Grupos no disponibles')
        c.grupos = grupos.map(g => {
          if (!codigo(g.idGroup) || g.season !== temporada.codigo || g.idCategoryRegistered !== c.codigo || g.idZone !== zona || !texto(g.nameGrupCompetition)) throw Error('Grupo de otra categoría')
          return { codigo: String(g.idGroup), nombre: texto(g.nameGrupCompetition) }
        })
        await guardar()
      }
      if (!c.grupos.length) { estado.categoria = (estado.categoria + 1) % categorias.length; estado.grupo = 0; await guardar(); if (visitados.has('vacia-' + c.codigo)) break; visitados.add('vacia-' + c.codigo); continue }
      const g = c.grupos[estado.grupo], clave = c.codigo + '-' + g.codigo
      if (visitados.has(clave)) break
      visitados.add(clave)
      const id = 'basket-bizkaia-' + g.codigo, fuenteUrl = 'https://bizkaiabasket.com/es/pagina-de-grupo/?id=' + g.codigo
      try {
        const actual = await api('/FCBQWeb/resultats/' + g.codigo), respuestas = [actual]
        const anterior = Number(actual.lastRound) - 1
        let falloAnterior = false
        if (Number.isSafeInteger(anterior) && anterior > 0) {
          try { respuestas.push(await api('/FCBQWeb/resultats/' + g.codigo + '/' + anterior)) }
          catch { falloAnterior = true }
        }
        const comp = grupoBaloncestoOW(respuestas, { id, temporada, categoria: c, grupo: g, zona: 'Bizkaia', territorio: zona, fuenteUrl, fuenteNombre: 'Federación Vizcaína de Baloncesto' }, reloj())
        if (falloAnterior) comp.agenda = bloque(fuenteUrl, new Date(reloj()).toISOString(), 'eventos', [], 'No hemos podido comprobar la jornada anterior. Conservamos la última agenda completa, si existe.')
        competiciones.push(comp); estado.ultimoExito = new Date(reloj()).toISOString(); estado.verificados[clave] = estado.ultimoExito
      } catch (e) { incidencia(c.nombre + ' · ' + g.nombre, e.message, id); if (!disponible()) break }
      estado.grupo++
      if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % categorias.length }
      await guardar()
    }
  } catch (e) { incidencia('Baloncesto de Bizkaia', e.message) }
  if (estado.catalogo) incidencia('Bizkaia · actualización por grupos', `Categorías localizadas: ${estado.catalogo.categorias.length}. Grupos con datos verificados: ${Object.keys(estado.verificados).length}. Continuamos por tandas; cada grupo conserva su propia fecha.`)
  opciones.log?.(`Bizkaia: ${peticiones} consultas; ${competiciones.length} grupos leídos`)
  return { competiciones, incidencias }
}
