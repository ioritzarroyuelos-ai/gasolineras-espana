import { createHash } from 'node:crypto'
import { parse } from 'node-html-parser'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'
import { instanteLocal } from './fechas.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'

export const PORTALES_GESDEPORTIVA = [
  { id: 'madrid', nombre: 'Federación de Baloncesto de Madrid', zona: 'Comunidad de Madrid', url: 'https://www.fbm.es/es/horarios-y-resultados', delegaciones: true },
  { id: 'asturias', nombre: 'Federación de Baloncesto del Principado de Asturias', zona: 'Asturias', url: 'https://www.fbpa.es/' },
  { id: 'murcia', nombre: 'Federación de Baloncesto de la Región de Murcia', zona: 'Región de Murcia', url: 'https://www.fbrm.org/' },
  { id: 'extremadura', nombre: 'Federación Extremeña de Baloncesto', zona: 'Extremadura', url: 'https://www.fexb.es/' },
  { id: 'melilla', nombre: 'Federación Melillense de Baloncesto', zona: 'Melilla', url: 'https://gesdeportiva.melillensebaloncesto.es/competiciones-15/melillense' },
  { id: 'canarias', nombre: 'Federación Canaria de Baloncesto', zona: 'Canarias', url: 'https://gesdeportiva.fcbaloncesto.es/competiciones-6/FederacionCanaria', reloj: 'Atlantic/Canary' },
]
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const numero = v => /^\d{1,10}$/.test(String(v)) ? String(v) : null
const seleccion = (d, nombre) => d.querySelector(`select[id$=${nombre}]`)
const opciones = s => (s?.querySelectorAll('option') || []).filter(o => numero(o.getAttribute('value')) && Number(o.getAttribute('value')) > 0).map(o => ({ codigo: o.getAttribute('value'), nombre: texto(o.text) }))
const elegida = s => s?.querySelector('option[selected]') || s?.querySelector('option')
const valor = (d, nombre) => elegida(seleccion(d, nombre))?.getAttribute('value')
const nombreElegido = (d, nombre) => texto(elegida(seleccion(d, nombre))?.text)
const columnas = [['pj', 'Jugados'], ['pg', 'Ganados'], ['pp', 'Perdidos'], ['pf', 'A favor'], ['pc', 'En contra'], ['puntos', 'Puntos']].map(([clave, nombre]) => ({ clave, nombre }))
const bloque = (url, sello, clave, contenido, aviso) => ({ estado: contenido.length ? 'actualizado' : 'no_disponible', consultado: sello, ...(contenido.length ? { verificadoEn: sello } : {}), fuenteUrl: url, [clave]: contenido, ...(aviso ? { aviso } : {}) })

/** Reproduce únicamente los literales que la página imprime en sus celdas; nunca ejecuta JavaScript remoto. */
export function documentoGesdeportiva(html) {
  const d = parse(html)
  for (const s of d.querySelectorAll('td script')) {
    const m = s.rawText.trim().match(/^decodificar\(("(?:[^"\\]|\\.)*")\);?$/)
    if (!m) throw Error('La celda federativa tiene un formato no reconocido')
    const literal = JSON.parse(m[1])
    // El texto contiene entidades HTML, no etiquetas ejecutables.
    s.replaceWith(literal.replace(/</g, '&lt;').replace(/>/g, '&gt;'))
  }
  return d
}

export function formularioGesdeportiva(html, campo, codigo) {
  const d = parse(html), select = seleccion(d, campo)
  if (!select || !opciones(select).some(o => o.codigo === codigo)) throw Error('El filtro solicitado no está publicado por la federación')
  const form = d.querySelector('form#aspnetForm') || select.closest('form')
  if (!form) throw Error('La página no entrega su formulario público')
  const body = new URLSearchParams()
  for (const n of form.querySelectorAll('input[type=hidden]')) if (n.getAttribute('name')) body.set(n.getAttribute('name'), n.getAttribute('value') || '')
  for (const n of form.querySelectorAll('select')) body.set(n.getAttribute('name'), elegida(n)?.getAttribute('value') || '')
  body.set(select.getAttribute('name'), codigo)
  body.set('__EVENTTARGET', select.getAttribute('name')); body.set('__EVENTARGUMENT', '')
  return body
}

function fechaCelda(n) {
  const t = texto(parse(n.innerHTML.replace(/<br\s*\/?\s*>/gi, ' ')).text)
  const m = t.match(/^(\d{2})\/(\d{2})\/(20\d{2})(?:\s+(\d{2}:\d{2}))?(?:\s|$)/)
  if (!m) return null
  const dia = m[3] + '-' + m[2] + '-' + m[1]
  if (!fechaDeportiva(dia)) throw Error('Fecha federativa incorrecta')
  return { dia, hora: m[4] && m[4] !== '00:00' ? m[4] : null }
}

export function grupoGesdeportiva(html, contexto, ahora = Date.now()) {
  const { portal, url, grupo, categoria, temporada, delegacion } = contexto, d = documentoGesdeportiva(html), sello = new Date(ahora).toISOString()
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: portal.reloj || 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ahora))
  if (valor(d, 'DDLGrupos') !== grupo || categoria && valor(d, 'DDLCategorias') !== categoria || delegacion && valor(d, 'DDLDelegacion') !== delegacion) throw Error('La federación devuelve otro grupo o categoría')
  const eventos = new Map(), temporadas = new Set(), nombre = nombreElegido(d, 'DDLCategorias'), fase = nombreElegido(d, 'DDLFases'), nombreGrupo = nombreElegido(d, 'DDLGrupos')
  if (!nombre || !nombreGrupo) throw Error('Grupo federativo sin nombre')
  // Las tablas de calendario tienen ambas celdas de marcador, fecha y campo; se evitan los resúmenes duplicados.
  for (const tabla of d.querySelectorAll('table')) {
    const encabezado = tabla.querySelector('thead')?.text || ''
    if (!/Local/.test(encabezado) || !/Visitante/.test(encabezado) || !/Fecha/.test(encabezado) || !/Campo/.test(encabezado) || !tabla.querySelector('td.puntos_locales')) continue
    const contenedor = tabla.parentNode
    const hermanos = contenedor?.parentNode?.childNodes || []
    const cabecera = hermanos.slice(0, hermanos.indexOf(contenedor)).reverse().find(n => /^H[3-5]$/.test(n.tagName))
    const jornada = texto(cabecera?.text || contenedor?.querySelector('h4,h5,h3')?.text)
    for (const [indicePartido, tr] of tabla.querySelectorAll('tbody tr').entries()) {
      const celdas = tr.querySelectorAll('td'), localP = celdas.findIndex(n => n.classList.contains('puntos_locales'))
      const visitanteP = celdas.findIndex(n => n.classList.contains('puntos_visitantes'))
      if (localP < 1 || visitanteP !== localP + 1 || celdas.length < visitanteP + 4) throw Error('Calendario federativo incompleto')
      const local = texto(celdas[localP - 1].text).replace(/^\(\*\)\s*/, ''), visitante = texto(celdas[visitanteP + 1].text).replace(/^\(\*\)\s*/, '')
      if (!local || !visitante) throw Error('Partido federativo sin equipos')
      if (/^DESCANS[AO]$/i.test(local) || /^DESCANS[AO]$/i.test(visitante)) continue
      const f = fechaCelda(celdas[visitanteP + 2]), lugar = texto(celdas[visitanteP + 3].text)
      if (!f) continue
      const year = Number(f.dia.slice(0, 4)) - (Number(f.dia.slice(5, 7)) < 7 ? 1 : 0)
      const fechaIncorrecta = temporada && year !== Number(temporada.codigo)
      if (!fechaIncorrecta) temporadas.add(year)
      const ms = f.hora ? instanteLocal(f.dia + ' ' + f.hora, portal.reloj || 'Europe/Madrid') : NaN
      if (f.hora && !Number.isFinite(ms)) throw Error('Hora federativa incorrecta')
      const a = texto(celdas[localP].text), b = texto(celdas[visitanteP].text)
      if (Boolean(a) !== Boolean(b) || a && (!/^\d+$/.test(a) || !/^\d+$/.test(b) || Number(a) > 1000 || Number(b) > 1000)) throw Error('Marcador federativo incompleto')
      const porDeterminar = /POR DETERMINAR|POR CONFIRMAR|PENDIENTE DE/i.test(local + ' ' + visitante)
      const retirado = /RETIRAD[OA]|NO PARTICIPA/i.test(local + ' ' + visitante)
      const futuro = Number.isFinite(ms) ? ms > ahora : f.dia > hoy
      // El portal no publica un estado final: un tanteo de hoy puede seguir en juego.
      const final = Boolean(a) && (Number(a) + Number(b) > 0) && f.dia < hoy && !futuro && !retirado && !fechaIncorrecta
      const estado = fechaIncorrecta || porDeterminar ? 'por_confirmar' : retirado ? 'cancelado' : final ? 'finalizado' : a ? 'por_confirmar' : Number.isFinite(ms) && futuro ? 'programado' : 'por_confirmar'
      const id = 'partido-' + createHash('sha256').update(grupo + '|' + local + '|' + visitante + '|' + (jornada || f.dia) + (porDeterminar ? '|' + indicePartido : '')).digest('hex').slice(0, 24)
      const e = { id, nombre: local + ' – ' + visitante, local, visitante, estado, ...(!fechaIncorrecta ? Number.isFinite(ms) ? { inicio: new Date(ms).toISOString() } : { fecha: f.dia } : {}), ...(jornada ? { jornada } : {}), ...(lugar ? { lugar } : {}), ...(final ? { resultado: { local: Number(a), visitante: Number(b) } } : {}), ...(fechaIncorrecta ? { detalle: 'Fecha incoherente en el calendario de la fuente. Consulta la federación.' } : retirado ? { detalle: 'La fuente identifica a uno de los equipos como retirado.' } : a && !final ? { detalle: 'Marcador pendiente de confirmar con la federación.' } : {}), fuenteUrl: url }
      if (eventos.has(id) && JSON.stringify(eventos.get(id)) !== JSON.stringify(e)) throw Error('Partidos duplicados con información distinta')
      eventos.set(id, e)
    }
  }
  if (!eventos.size || temporadas.size !== 1) throw Error('El calendario no permite comprobar una única temporada')
  const year = [...temporadas][0], filas = []
  let empate = false, falloTabla
  try {
  for (const tabla of d.querySelectorAll('table')) {
    const h = texto(tabla.querySelector('thead')?.text)
    if (!/P\.J/.test(h) || !/P\.G/.test(h) || !/P\.P/.test(h) || !/Puntos/.test(h)) continue
    const conEmpates = /P\.E/.test(h)
    empate ||= conEmpates
    for (const tr of tabla.querySelectorAll('tbody tr')) {
      const c = tr.querySelectorAll('td').filter(n => !n.classList.contains('logo_club_tabla')).map(n => texto(n.text))
      if (c.length !== (conEmpates ? 9 : 8) || !/^\d+$/.test(c[0]) || !c[1] || c.slice(2).some(v => !/^-?\d+$/.test(v))) throw Error('Clasificación federativa incompleta')
      const datos = c.slice(2).map(Number), [pj, pg, pp] = datos, pe = conEmpates ? datos[3] : 0
      const [pf, pc, puntos] = datos.slice(conEmpates ? 4 : 3)
      if (pg + pp + pe !== pj || [pj, pg, pp, pe, pf, pc].some(n => n < 0)) throw Error('Balance de clasificación federativa incoherente')
      filas.push({ posicion: Number(c[0]) || null, nombre: c[1], valores: { pj, pg, pp, ...(conEmpates ? { pe } : {}), pf, pc, puntos } })
    }
  }
  if (new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Clasificación con equipos repetidos')
  } catch (e) { filas.length = 0; falloTabla = 'No hemos podido comprobar la clasificación: ' + e.message }
  const columnasTabla = empate ? [...columnas.slice(0, 3), { clave: 'pe', nombre: 'Empatados' }, ...columnas.slice(3)] : columnas
  const genero = /MIXT/i.test(nombre) ? 'mixto' : /FEM|\bF\./i.test(nombre) ? 'femenino' : /MASC|\bMAS\b/i.test(nombre) ? 'masculino' : undefined
  return { id: 'basket-' + portal.id + '-' + (delegacion ? delegacion + '-' : '') + grupo, deporte: 'baloncesto', nombre, temporada: year + '-' + (year + 1), categoria: nombre, zona: portal.zona, grupo: fase === nombreGrupo ? nombreGrupo : fase + ' · ' + nombreGrupo, ...(genero ? { genero } : {}), fuente: { nombre: portal.nombre, url }, comprobadoEn: sello,
    agenda: bloque(url, sello, 'eventos', [...eventos.values()]), clasificacion: bloque(url, sello, 'tablas', filas.length ? [{ id: 'general', nombre: 'Clasificación del grupo', columnas: columnasTabla, filas }] : [], filas.length ? undefined : falloTabla || 'La fuente no publica una clasificación de liga para este grupo.') }
}

export async function obtieneBaloncestoGesdeportiva(opcionesLectura = {}) {
  const competiciones = [], incidencias = []
  for (const portal of opcionesLectura.portalesGesdeportiva || PORTALES_GESDEPORTIVA) {
    const key = 'basket-' + portal.id, estado = normalizaEstadoNovanet(opcionesLectura.estadoNovanet?.[key]), reloj = opcionesLectura.relojGesdeportiva || Date.now, HORA = 3600000, MAX = 120
    const guardar = () => opcionesLectura.guardarEstadoNovanet?.(key, estado), cookies = new Map()
    let siguiente = 0, page = '', pageUrl = '', detenido = false
    const disponibles = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? MAX : MAX - estado.ventana.peticiones
    const permitido = () => !detenido && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes)) && disponibles() > 0
    const incidencia = (motivo, id) => { incidencias.push({ deporte: 'baloncesto', nombre: portal.nombre, fuenteUrl: portal.url, motivo, ...(id ? { id } : {}) }); opcionesLectura.log?.(portal.id + ': ' + motivo) }
    const lee = async (url, body) => {
      if (new URL(url).origin !== new URL(portal.url).origin) throw Error('Enlace fuera del portal federativo')
      page = await leerFuenteDeportiva(url, { fetcher: async (u, init) => {
        if (!permitido()) throw Error('La próxima tanda continuará desde el grupo pendiente')
        if (siguiente > reloj()) await (opcionesLectura.duermeGesdeportiva || (ms => new Promise(r => setTimeout(r, ms))))(siguiente - reloj())
        if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
        estado.ventana.peticiones++; siguiente = reloj() + 1000
        if (!disponibles()) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
        await guardar()
        const r = await (opcionesLectura.fetcher || fetch)(u, { ...init, ...(body ? { method: 'POST', body } : {}), headers: { ...init.headers, 'User-Agent': 'Mozilla/5.0 (compatible; EspanaUtil/1.0; +https://webapp-3ft.pages.dev)', Referer: pageUrl || portal.url, ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}), ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') } : {}) } })
        for (const c of r.headers.getSetCookie?.() || []) { const par = c.split(';')[0], p = par.indexOf('='); if (p > 0) cookies.set(par.slice(0, p), par.slice(p + 1)) }
        if (r.status === 429) {
          const ra = r.headers.get('Retry-After'), t = /^\d+$/.test(ra || '') ? reloj() + Number(ra) * 1000 : Date.parse(ra)
          estado.noConsultarAntes = new Date(Math.max(Number.isFinite(t) ? t : reloj() + HORA, Date.parse(estado.noConsultarAntes || '') || 0)).toISOString(); detenido = true; await guardar()
        }
        return r
      } }); pageUrl = url; return page
    }
    const cambia = async (campo, codigo) => {
      if (valor(parse(page), campo) !== codigo) await lee(pageUrl, formularioGesdeportiva(page, campo, codigo))
      if (valor(parse(page), campo) !== codigo) throw Error('El filtro público no ha cargado la opción solicitada')
    }
    const abre = async c => {
      const f = JSON.parse(c.familia), url = new URL(f.ruta, portal.url).href
      if (pageUrl !== url) await lee(url)
      if (f.delegacion) await cambia('DDLDelegacion', f.delegacion)
      if (f.competicion) await cambia('DDLCompeticiones', f.competicion)
      await cambia('DDLCategorias', f.categoria)
      return f
    }
    try {
      if (!permitido()) { incidencia('Hay una pausa de consultas; se conserva el punto de continuación.'); continue }
      if (estado.descubrimientoGes && (estado.descubrimientoGes.fuenteUrl !== portal.url || reloj() - Date.parse(estado.descubrimientoGes.iniciadoEn) > 7 * 86400000)) delete estado.descubrimientoGes
      if (!estado.descubrimientoGes && (!estado.catalogo || reloj() - Date.parse(estado.catalogo.verificadoEn) > 7 * 86400000)) {
        await lee(portal.url)
        let raices = [{ url: portal.url }]
        if (!seleccion(parse(page), 'DDLCategorias')) {
          raices = [...new Map(parse(page).querySelectorAll('a[href]').filter(a => /^\/competicion-\d+\//.test(a.getAttribute('href')) && !/COMPETICIONES FEB|LIGA ENDESA|INTERNACIONAL/i.test(a.text)).map(a => { const url = new URL(a.getAttribute('href'), portal.url).href; return [url, { url }] })).values()]
        } else if (portal.delegaciones) raices = opciones(seleccion(parse(page), 'DDLDelegacion')).map(d => ({ url: portal.url, delegacion: d.codigo }))
        if (!raices.length) throw Error('El portal no ha entregado su catálogo público de competiciones')
        estado.descubrimientoGes = { fuenteUrl: portal.url, iniciadoEn: new Date(reloj()).toISOString(), temporada: null, categorias: [],
          pendientes: raices.map(r => { const u = new URL(r.url); return { tipo: 'raiz', ruta: u.pathname + u.search, ...(r.delegacion ? { delegacion: r.delegacion } : {}) } }) }
        await guardar()
      }
      if (estado.descubrimientoGes) {
        const parcial = estado.descubrimientoGes, intentados = new Set()
        while (parcial.pendientes.length && permitido() && disponibles() >= 5) {
          const tarea = parcial.pendientes[0], clave = JSON.stringify(tarea)
          if (intentados.has(clave)) break
          intentados.add(clave)
          try {
            const url = new URL(tarea.ruta, portal.url).href
            if (pageUrl !== url) await lee(url)
            if (tarea.delegacion) await cambia('DDLDelegacion', tarea.delegacion)
            if (tarea.tipo === 'raiz') {
              const comps = opciones(seleccion(parse(page), 'DDLCompeticiones')).filter(c => !/COMPETICIONES FEB|LIGA ENDESA|INTERNACIONAL/i.test(c.nombre))
              parcial.pendientes.splice(0, 1, ...(comps.length ? comps : [{ codigo: '' }]).map(c => ({ ...tarea, tipo: 'competicion', ...(c.codigo ? { competicion: c.codigo } : {}) })))
              await guardar()
              continue
            }
            if (tarea.competicion) await cambia('DDLCompeticiones', tarea.competicion)
            const d = parse(page)
            if (valor(d, 'DDLGrupos')) {
              let muestra
              try { muestra = grupoGesdeportiva(page, { portal, url: pageUrl, grupo: valor(d, 'DDLGrupos') }, reloj()) } catch { /* Otra categoría puede confirmar la temporada. */ }
              if (muestra) {
                if (parcial.temporada && parcial.temporada.nombre !== muestra.temporada) throw Error('El catálogo mezcla temporadas; se mantiene pendiente de comprobar')
                parcial.temporada = { codigo: muestra.temporada.slice(0, 4), nombre: muestra.temporada }
              }
            }
            const categorias = []
            for (const c of opciones(seleccion(d, 'DDLCategorias'))) {
              const codigo = (tarea.delegacion || '0').padStart(3, '0') + (tarea.competicion || tarea.ruta.match(/competicion-(\d+)/)?.[1] || '0').padStart(7, '0') + c.codigo.padStart(7, '0')
              categorias.push({ codigo, nombre: c.nombre, familia: JSON.stringify({ ruta: tarea.ruta, delegacion: tarea.delegacion, competicion: tarea.competicion, categoria: c.codigo }), grupos: null })
            }
            const anteriores = new Map(parcial.categorias.map(c => [c.codigo, c]))
            for (const c of categorias) {
              if (anteriores.has(c.codigo) && JSON.stringify(anteriores.get(c.codigo)) !== JSON.stringify(c)) throw Error('El catálogo repite una categoría con otra identidad')
              anteriores.set(c.codigo, c)
            }
            parcial.categorias = [...anteriores.values()]
            parcial.pendientes.shift()
            await guardar()
          } catch (e) {
            incidencia('No se pudo comprobar una parte del catálogo: ' + e.message)
            // La raíz que falla sigue pendiente, pero no bloquea las demás ni vuelve a consultarse en esta tanda.
            parcial.pendientes.push(parcial.pendientes.shift())
            await guardar()
            page = ''; pageUrl = ''
            if (!permitido()) break
          }
        }
        if (parcial.pendientes.length) {
          incidencia(`El catálogo tiene ${parcial.pendientes.length} partes pendientes. La próxima tanda continuará por ellas; se mantiene el catálogo anterior con su fecha.`)
        } else if (parcial.temporada && parcial.categorias.length) {
          estado.catalogo = { temporada: parcial.temporada, categorias: parcial.categorias, verificadoEn: new Date(reloj()).toISOString() }
          estado.categoria = 0; estado.grupo = 0; estado.verificados = {}; delete estado.descubrimientoGes; await guardar()
        } else {
          delete estado.descubrimientoGes; await guardar()
          throw Error('No se ha podido confirmar el catálogo de la temporada')
        }
      }
      if (!estado.catalogo) continue
      const cats = estado.catalogo.categorias, recorridos = new Set()
      while (permitido() && disponibles() >= 5) {
        const c = cats[estado.categoria], f = await abre(c)
        if (!c.grupos) {
          const grupos = [], fases = opciones(seleccion(parse(page), 'DDLFases'))
          for (const fase of fases) { await cambia('DDLFases', fase.codigo); for (const g of opciones(seleccion(parse(page), 'DDLGrupos'))) grupos.push({ codigo: g.codigo, nombre: fase.codigo + '|' + g.nombre }) }
          if (new Set(grupos.map(g => g.codigo)).size !== grupos.length) throw Error('El catálogo repite un grupo en varias fases')
          c.grupos = grupos; await guardar()
        }
        if (!c.grupos.length) { if (recorridos.has(c.codigo)) break; recorridos.add(c.codigo); estado.categoria = (estado.categoria + 1) % cats.length; estado.grupo = 0; await guardar(); continue }
        const g = c.grupos[estado.grupo], clave = c.codigo + '-' + g.codigo
        if (recorridos.has(clave)) break
        recorridos.add(clave)
        const id = 'basket-' + portal.id + '-' + (f.delegacion ? f.delegacion + '-' : '') + g.codigo
        try {
          await cambia('DDLFases', g.nombre.split('|')[0]); await cambia('DDLGrupos', g.codigo)
          const competicion = grupoGesdeportiva(page, { portal, url: pageUrl, grupo: g.codigo, categoria: f.categoria, delegacion: f.delegacion, temporada: estado.catalogo.temporada }, reloj())
          competiciones.push(competicion); estado.verificados[clave] = competicion.comprobadoEn; estado.ultimoExito = competicion.comprobadoEn
        } catch (e) { incidencia(e.message, id); if (!permitido()) break }
        estado.grupo++; if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % cats.length }
        await guardar()
      }
      incidencia(`Catálogo de ${estado.catalogo.categorias.length} categorías. Se amplía y revisa por tandas; los grupos sin datos comprobados todavía no se publican.`)
    } catch (e) { incidencia(e.message) }
  }
  return { competiciones, incidencias }
}
