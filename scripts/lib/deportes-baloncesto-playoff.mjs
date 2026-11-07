import { parse } from 'node-html-parser'
import { fechaDeportiva } from './deportes.mjs'
import { instanteLocal } from './fechas.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'

export const PAGINA_CONSELL = 'https://www.consellsabadell.cat/ca/esports/consellesportiu/esports-dequip/basquet/138168.html'
const PORTALES = { ces: { nombre: 'Consell Esportiu Sabadell', ciudad: 'Sabadell' }, cevot: { nombre: 'Consell Esportiu del Vallès Occidental Terrassa', ciudad: 'Terrassa' } }
const texto = v => String(v || '').replace(/\s+/g, ' ').trim()
const normal = v => texto(v).toLocaleUpperCase('es')
const HORA = 3600000
function temporada(v) {
  const m = texto(v).match(/(?:CURS\s+)?(20\d{2})[-/](20\d{2}|\d{2})/i)
  if (!m) throw Error('El consejo deportivo no identifica la temporada')
  const fin = m[2].length === 2 ? '20' + m[2] : m[2]
  if (Number(fin) !== Number(m[1]) + 1) throw Error('Temporada escolar incoherente')
  return m[1] + '-' + fin
}
function enlace(href, base, ruta) {
  const u = new URL(href, base)
  if (u.origin !== new URL(base).origin || u.protocol !== 'https:' || u.pathname !== '/' + ruta) throw Error('Enlace de competición escolar no reconocido')
  return u
}

/** Los enlaces se toman del curso más reciente anunciado por el organizador. */
export function descubreConsejos(html) {
  const d = parse(html), encontrados = []
  for (const b of d.querySelectorAll('button[data-target]')) {
    if (!/RESULTATS\s+BÀSQUET\s+CURS/i.test(texto(b.text))) continue
    const curso = temporada(b.text), id = b.getAttribute('data-target')
    if (!/^#[a-zA-Z0-9_-]+$/.test(id || '')) continue
    for (const a of d.querySelector(id)?.querySelectorAll('a[href]') || []) {
      const u = new URL(a.getAttribute('href'), PAGINA_CONSELL), portal = u.hostname.split('.')[0]
      if (!PORTALES[portal] || u.origin !== 'https://' + portal + '.playoffinformatica.com' || u.pathname !== '/CompeticioResultatsWeb.php' || !/^\d+$/.test(u.searchParams.get('idTemporada') || '')) continue
      encontrados.push({ portal, temporada: curso, codigo: u.searchParams.get('idTemporada'), url: u.href })
    }
  }
  if (!encontrados.length) throw Error('El organizador no enlaza calendarios escolares con temporada verificable')
  return Object.keys(PORTALES).flatMap(portal => encontrados.filter(e => e.portal === portal).sort((a, b) => b.temporada.localeCompare(a.temporada)).slice(0, 1))
}

export function catalogoConsejo(html, origen, esperada) {
  const d = parse(html), actual = d.querySelector('.season-dropdown > a'), curso = temporada(actual?.text)
  const u = enlace(actual?.getAttribute('href') || '', origen, 'CompeticioEntradaWeb.php')
  if (curso !== esperada.temporada || u.searchParams.get('idTemporada') !== esperada.codigo) throw Error('El consejo ha devuelto otra temporada')
  const grupos = []
  for (const tr of d.querySelectorAll('tr[data-href]')) {
    const c = tr.querySelectorAll('td')
    if (!/bàsquet|basquet|baloncesto/i.test(texto(c[0]?.text))) continue
    const url = enlace(tr.getAttribute('data-href'), origen, 'CompeticioResultatsWeb.php'), codigo = url.searchParams.get('idGrup')
    if (!/^\d+$/.test(codigo || '') || url.searchParams.get('idTemporada') !== esperada.codigo || c.length !== 6 || !texto(c[1].text)) throw Error('Grupo escolar incompleto o de otra temporada')
    const sexo = c[5].getAttribute('data-search'), nombre = texto(c[0].text), generoNombre = /MIXT/i.test(nombre) ? 'mixto' : /FEMEN/i.test(nombre) ? 'femenino' : /MASCUL/i.test(nombre) ? 'masculino' : undefined
    const generoCodigo = { SXMIX: 'mixto', SXFEM: 'femenino', SXMAS: 'masculino' }[sexo]
    // Algunas ligas se titulan masculinas pero están registradas como mixtas.
    // En esa contradicción no inventamos una etiqueta de género.
    const genero = generoNombre && generoCodigo && generoNombre !== generoCodigo ? undefined : generoNombre || generoCodigo
    grupos.push({ codigo, nombre, grupo: texto(c[1].text), fase: texto(c[2].text), url: url.href, ...(genero ? { genero } : {}) })
  }
  if (!grupos.length || new Set(grupos.map(g => g.codigo)).size !== grupos.length) throw Error('Catálogo escolar vacío o duplicado')
  return grupos
}

export function identidadConsejo(html, grupo, curso) {
  const d = parse(html), actual = d.querySelector('.season-dropdown > a')
  if (temporada(actual?.text) !== curso.temporada) throw Error('La ficha escolar corresponde a otra temporada')
  const m = html.match(/peticioJornades\(\s*['"](\d+)['"]\s*,\s*['"](\d+)['"]/)
  if (!m || m[1] !== grupo.codigo) throw Error('La ficha escolar corresponde a otro grupo')
  const entry = enlace(actual?.getAttribute('href') || '', grupo.url, 'CompeticioEntradaWeb.php')
  if (entry.searchParams.get('idTemporada') !== curso.codigo) throw Error('Código de temporada escolar distinto')
  return { jornada: m[2] }
}

function fechaPartido(v, curso) {
  const m = texto(v).match(/^(\d{2})-(\d{2})-(20\d{2})(?:\s+(\d{2}):(\d{2}))?\s*h?$/)
  if (!m) { if (!texto(v) || /pendent|confirmar|ajornat|suspès|cancel/i.test(v)) return {}; throw Error('Fecha escolar no reconocida') }
  const fecha = `${m[3]}-${m[2]}-${m[1]}`
  const [inicioCurso, finCurso] = curso.split('-')
  if (!fechaDeportiva(fecha) || fecha < inicioCurso + '-07-01' || fecha > finCurso + '-06-30') throw Error('Fecha escolar fuera de su temporada')
  if (!m[4]) return { fecha }
  if (Number(m[4]) > 23 || Number(m[5]) > 59) throw Error('Hora escolar no válida')
  const ms = instanteLocal(`${fecha} ${m[4]}:${m[5]}`)
  if (!Number.isFinite(ms)) throw Error('Hora escolar inexistente en la zona local')
  return { fecha, inicio: new Date(ms).toISOString() }
}

export function agendaConsejo(calendario, resultados, contexto, ahora = Date.now()) {
  const mapa = new Map(), hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(new Date(ahora))
  for (const [html, esResultado] of [[calendario, false], [resultados, true]]) {
    if (!html) continue
    const d = parse(html), tablas = d.querySelectorAll('table.table-resultats')
    if (!tablas.length) throw Error('El consejo no publica una agenda reconocida')
    for (const tabla of tablas) for (const tr of tabla.querySelectorAll('tbody tr.detallEnfrontament')) {
      const local = texto(tr.querySelector('td.local')?.text), visitante = texto(tr.querySelector('td.visitant')?.text)
      if (/descansa|descans/i.test(local) || /descansa|descans/i.test(visitante)) continue
      const url = enlace(tr.getAttribute('data-href') || '', contexto.url, 'CompeticioDetallEnfrontament.php'), codigo = url.searchParams.get('idEvent')
      if (!local || !visitante || normal(local) === normal(visitante) || !/^\d+$/.test(codigo || '')) throw Error('Partido escolar incompleto')
      const horario = texto(tr.querySelector('td.data')?.text), fechas = fechaPartido(horario, contexto.temporada), jornada = texto(tabla.querySelector('caption')?.text)
      const id = 'consejo-' + contexto.portal + '-' + codigo, previo = mapa.get(id)
      if (previo && (!esResultado || normal(previo.local) !== normal(local) || normal(previo.visitante) !== normal(visitante) || previo.fecha !== fechas.fecha)) throw Error('Calendario y resultados escolares no coinciden')
      if (esResultado && !previo) throw Error('Resultado escolar ajeno al calendario consultado')
      const tanteo = tr.querySelector('td.scoreboard > a')?.clone()
      tanteo?.querySelectorAll('small').forEach(n => n.remove())
      const textoTanteo = texto(tanteo?.text), puntos = textoTanteo.match(/^(\d{1,3})\s*-\s*(\d{1,3})$/)
      if (textoTanteo && !puntos && !/^[–-]$|pendent|ajornat|suspès|cancel|inc|np/i.test(textoTanteo)) throw Error('Marcador escolar no reconocido')
      const final = puntos && fechas.fecha && fechas.fecha < hoy && Number(puntos[1]) + Number(puntos[2]) > 0
      const estado = /ajornat|aplazad|suspès/i.test(horario + ' ' + textoTanteo) ? 'aplazado' : /cancel/i.test(horario + ' ' + textoTanteo) ? 'cancelado' : final ? 'finalizado' : fechas.fecha && fechas.fecha >= hoy && !puntos ? 'programado' : 'por_confirmar'
      const lugar = texto(tr.querySelector('td.lloc > a')?.text) || previo?.lugar
      mapa.set(id, { id, nombre: local + ' · ' + visitante, local, visitante, jornada, ...fechas, estado, ...(lugar ? { lugar } : {}), fuenteUrl: url.href,
        ...(estado === 'finalizado' ? { resultado: { local: Number(puntos[1]), visitante: Number(puntos[2]) } } : {}),
        ...(!fechas.inicio ? { detalle: 'Hora por confirmar.' } : puntos && !final ? { detalle: 'El consejo publica un tanteo, pero no confirma el final del partido.' } : {}) })
    }
  }
  if (!mapa.size) throw Error('El calendario escolar no contiene partidos verificables')
  return [...mapa.values()]
}

export function clasificacionConsejo(html, grupo) {
  const tabla = parse(html).querySelector('table.table-classificacio')
  if (!tabla) throw Error('El consejo todavía no publica clasificación')
  const cabeceras = tabla.querySelectorAll('thead th').map(n => texto(n.text)), celdas = tabla.querySelectorAll('tbody td')
  if (cabeceras[0] !== '' || cabeceras[1] !== 'Nom' || cabeceras.length < 4 || !celdas.length || celdas.length % cabeceras.length) throw Error('Clasificación escolar incompleta')
  const columnas = cabeceras.slice(2).map((nombre, i) => ({ clave: 'c' + i, nombre }))
  const filas = []
  for (let i = 0; i < celdas.length; i += cabeceras.length) {
    const c = celdas.slice(i, i + cabeceras.length).map(n => texto(n.text))
    if (!/^\d+$/.test(c[0]) || !c[1] || c.slice(2).some(v => !/^-?\d+(?:[.,]\d+)?$/.test(v))) throw Error('Fila escolar no reconocida')
    filas.push({ posicion: Number(c[0]), nombre: c[1], valores: Object.fromEntries(columnas.map((col, j) => [col.clave, Number(c[j + 2].replace(',', '.'))])) })
  }
  if (new Set(filas.map(f => normal(f.nombre))).size !== filas.length || filas.some((f, i) => f.posicion !== i + 1)) throw Error('Posiciones escolares incoherentes')
  return [{ id: 'grupo-' + grupo, nombre: 'Clasificación publicada por el consejo deportivo', columnas, filas }]
}

export async function obtieneBaloncestoConsejos(opciones = {}) {
  const competiciones = [], incidencias = [], reloj = opciones.relojConsejos || Date.now, fetcher = opciones.fetcher || fetch
  const fallo = (nombre, fuenteUrl, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, fuenteUrl, motivo, ...(id ? { id } : {}) })
  let cursos
  async function descarga(url, params, antes, despues) {
    await antes?.()
    const r = await fetcher(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'EspanaUtil/1.0 (+https://webapp-3ft.pages.dev/privacidad)', ...(params ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) }, ...(params ? { method: 'POST', body: new URLSearchParams(params) } : {}) })
    await despues?.(r)
    if (!r.ok) { await r.body?.cancel(); throw Error('Consejo deportivo HTTP ' + r.status) }
    if (!r.body) throw Error('Respuesta escolar vacía')
    const reader = r.body.getReader(), partes = []; let bytes = 0
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 3 * 1024 * 1024) { await reader.cancel(); throw Error('Respuesta escolar demasiado grande') } partes.push(value) } } finally { reader.releaseLock() }
    const contenido = new Uint8Array(bytes); let desplazamiento = 0
    for (const p of partes) { contenido.set(p, desplazamiento); desplazamiento += p.length }
    let html
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(contenido) } catch { html = new TextDecoder('windows-1252').decode(contenido) }
    if (!html.trim() || /captcha|cf-chl-|access denied/i.test(html)) throw Error('La publicación escolar no entrega datos accesibles')
    return html
  }
  const estadoOrigen = normalizaEstadoNovanet(opciones.estadoNovanet?.['basket-consejos-origen']), guardarOrigen = () => opciones.guardarEstadoNovanet?.('basket-consejos-origen', estadoOrigen)
  try {
    if (estadoOrigen.noConsultarAntes && reloj() < Date.parse(estadoOrigen.noConsultarAntes)) throw Error('Próxima consulta del organizador permitida: ' + estadoOrigen.noConsultarAntes)
    const html = await descarga(PAGINA_CONSELL, undefined, async () => {
      if (!estadoOrigen.ventana.desde || reloj() - Date.parse(estadoOrigen.ventana.desde) >= HORA) estadoOrigen.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
      if (estadoOrigen.ventana.peticiones >= 120) { estadoOrigen.noConsultarAntes = new Date(Date.parse(estadoOrigen.ventana.desde) + HORA).toISOString(); await guardarOrigen(); throw Error('El organizador continuará en la siguiente tanda permitida') }
      estadoOrigen.ventana.peticiones++; await guardarOrigen()
    }, async r => {
      if ([401, 403, 429].includes(r.status)) { const retry = r.headers.get('Retry-After'), hasta = /^\d+$/.test(retry || '') ? reloj() + Number(retry) * 1000 : Date.parse(retry); estadoOrigen.noConsultarAntes = new Date(Math.max(reloj() + HORA, Number.isFinite(hasta) && Math.abs(hasta) <= 8640000000000000 ? hasta : 0)).toISOString(); await guardarOrigen() }
    })
    cursos = descubreConsejos(html)
  } catch (e) {
    if (/no entrega datos accesibles/.test(e.message)) { estadoOrigen.noConsultarAntes = new Date(reloj() + HORA).toISOString(); await guardarOrigen() }
    fallo('Baloncesto escolar de Cataluña', PAGINA_CONSELL, e.message); return { competiciones, incidencias }
  }
  for (const curso of cursos) {
    const config = PORTALES[curso.portal], portal = 'basket-consejo-' + curso.portal, estado = normalizaEstadoNovanet(opciones.estadoNovanet?.[portal]), origen = new URL(curso.url).origin
    let parado = false, siguiente = 0
    const guardar = () => opciones.guardarEstadoNovanet?.(portal, estado)
    const disponible = () => !parado && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes))
    const lee = (url, params) => descarga(url, params, async () => {
      if (!disponible()) throw Error('La consulta escolar continuará en la próxima tanda permitida')
      if (siguiente > reloj()) await (opciones.duermeConsejos || (ms => new Promise(r => setTimeout(r, ms))))(siguiente - reloj())
      if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
      if (estado.ventana.peticiones >= 120) { estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString(); parado = true; await guardar(); throw Error('La lectura escolar continuará al terminar nuestro presupuesto horario') }
      estado.ventana.peticiones++; siguiente = reloj() + 700; await guardar()
    }, async r => {
      if ([401, 403, 429].includes(r.status)) {
        const retry = r.headers.get('Retry-After'), hasta = /^\d+$/.test(retry || '') ? reloj() + Number(retry) * 1000 : Date.parse(retry)
        estado.noConsultarAntes = new Date(Math.max(reloj() + HORA, Number.isFinite(hasta) && Math.abs(hasta) <= 8640000000000000 ? hasta : 0)).toISOString(); parado = true; await guardar()
      }
    }).catch(async error => {
      if (/no entrega datos accesibles/.test(error.message)) { parado = true; estado.noConsultarAntes = new Date(reloj() + HORA).toISOString(); await guardar() }
      throw error
    })
    try {
      if (!disponible()) throw Error('Próxima consulta permitida: ' + estado.noConsultarAntes)
      const ficha = await lee(curso.url), d = parse(ficha), entrada = enlace(d.querySelector('.season-dropdown > a')?.getAttribute('href') || '', origen, 'CompeticioEntradaWeb.php')
      const grupos = catalogoConsejo(await lee(entrada.href), origen, curso)
      const previo = estado.catalogo?.categorias[estado.categoria]?.codigo, misma = estado.catalogo?.temporada.nombre === curso.temporada
      estado.catalogo = { temporada: { codigo: curso.codigo, nombre: curso.temporada }, verificadoEn: new Date(reloj()).toISOString(), categorias: grupos.map(g => ({ codigo: g.codigo, nombre: g.nombre, familia: g.fase, grupos: [{ codigo: g.codigo, nombre: g.grupo }] })) }
      estado.categoria = misma ? Math.max(0, grupos.findIndex(g => g.codigo === previo)) : 0; estado.grupo = 0
      if (!misma) estado.verificados = {}
      await guardar()
      const vistos = new Set()
      while (disponible() && !vistos.has(estado.categoria)) {
        const g = grupos[estado.categoria], id = 'basket-consejo-' + curso.portal + '-' + g.codigo, api = origen + '/peticioAjaxCompeticioPublica.php'
        vistos.add(estado.categoria)
        let identidad, eventos = [], tablas = [], avisoAgenda, avisoTabla, selloAgenda, selloTabla
        try { identidad = identidadConsejo(g.url === curso.url ? ficha : await lee(g.url), g, curso) } catch (e) { fallo(g.nombre, g.url, e.message, id) }
        if (identidad) {
          try {
            const calendario = await lee(api, { peticioKey: 'peticio_competicio_publica_calendari', idGrup: g.codigo }), resultados = await lee(api, { peticioKey: 'peticio_competicio_publica_resum_resultats_grup', idGrup: g.codigo })
            eventos = agendaConsejo(calendario, resultados, { portal: curso.portal, url: g.url, temporada: curso.temporada }, reloj()); selloAgenda = new Date(reloj()).toISOString()
          } catch (e) { avisoAgenda = e.message; fallo(g.nombre, g.url, e.message, id) }
          try {
            if (!eventos.length) throw Error('La clasificación escolar espera un calendario válido para confirmar sus equipos')
            const recibidas = clasificacionConsejo(await lee(api, { peticioKey: 'peticio_competicio_publica_resultats_classificacions', idJornada: identidad.jornada }), g.codigo)
            if (eventos.length) {
              const equipos = new Set(eventos.flatMap(e => [normal(e.local), normal(e.visitante)]))
              if (recibidas.some(t => t.filas.some(f => !equipos.has(normal(f.nombre))))) throw Error('La clasificación escolar contiene equipos ajenos al calendario')
            }
            tablas = recibidas; selloTabla = new Date(reloj()).toISOString()
          } catch (e) { avisoTabla = e.message; fallo(g.nombre + ' · clasificación', g.url, e.message, id) }
          if (selloAgenda || selloTabla) {
            const sello = new Date(reloj()).toISOString()
            competiciones.push({ id, deporte: 'baloncesto', nombre: config.ciudad + ' · ' + g.nombre, temporada: curso.temporada, categoria: /lleure/i.test(g.nombre + g.fase) ? 'Baloncesto popular' : 'Base · Juegos escolares', grupo: g.grupo + ' · ' + g.fase, zona: 'Cataluña', ...(g.genero ? { genero: g.genero } : {}), fuente: { nombre: config.nombre, url: g.url }, comprobadoEn: sello,
              agenda: { estado: selloAgenda ? 'actualizado' : 'no_disponible', consultado: sello, ...(selloAgenda ? { verificadoEn: selloAgenda } : {}), fuenteUrl: g.url, eventos, aviso: avisoAgenda || 'Calendario escolar o popular del consejo deportivo. Los tanteos del mismo día esperan confirmación; no es un marcador en directo.' },
              clasificacion: { estado: selloTabla ? 'actualizado' : 'no_disponible', consultado: sello, ...(selloTabla ? { verificadoEn: selloTabla } : {}), fuenteUrl: g.url, tablas, aviso: avisoTabla || 'Se conservan los puntos de juego limpio y de valores publicados por el consejo; no son canastas del marcador.' } })
            estado.verificados[g.codigo + '-' + g.codigo] = sello; estado.ultimoExito = sello
          }
        }
        if (parado) break
        estado.categoria = (estado.categoria + 1) % grupos.length; await guardar()
      }
      opciones.log?.(config.nombre + ': ' + grupos.length + ' grupos descubiertos; ' + vistos.size + ' recorridos')
    } catch (e) { fallo(config.nombre, curso.url, e.message) }
  }
  return { competiciones, incidencias }
}
