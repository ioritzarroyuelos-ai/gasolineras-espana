import { parse } from 'node-html-parser'
import { createHash } from 'node:crypto'
import { fechaDeportiva, leerFuenteDeportiva } from './deportes.mjs'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'
import { horaGipuzkoa } from './deportes-baloncesto-territorial.mjs'
const PAGINA = 'https://fegaba.com/resultados-e-clasificacions/', WIDGET = 'https://widgetsfegaba.gesdeportiva.es', PORTAL = 'basket-galicia', HORA = 3600000
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim(), codigo = v => /^\d{1,6}$/.test(String(v)) && Number(v) > 0
export function listasGalicia(datos) {
  if (!Array.isArray(datos)) throw Error('La federación gallega no entrega el selector solicitado')
  const lista = datos.filter(d => String(d.value) !== '-1').map(d => {
    if (!codigo(d.value) || !texto(d.text)) throw Error('Opción gallega incompleta')
    return { codigo: String(d.value), nombre: texto(d.text) }
  })
  if (new Set(lista.map(d => d.codigo)).size !== lista.length) throw Error('Selector gallego duplicado')
  return lista
}
export function visorGalicia(html) {
  const url = parse(html).querySelectorAll('iframe[src]').map(n => n.getAttribute('src')).find(u => u.startsWith(WIDGET + '/widget/informacion/general-delegacion/'))
  if (!url || !/^\/widget\/informacion\/general-delegacion\/\d+$/.test(new URL(url).pathname) || !/^[a-f0-9-]{36}$/.test(new URL(url).searchParams.get('key') || '')) throw Error('FEGABA no identifica su visor público de resultados')
  return url
}
const opciones = (doc, id) => listasGalicia(doc.querySelectorAll('#' + id + ' option').map(o => ({ value: o.getAttribute('value'), text: o.text })))
export function calendarioGalicia(html, grupo, fuenteUrl, ahora = Date.now()) {
  const doc = parse(html), tablas = doc.querySelectorAll('table.ordenTabla').filter(t => texto(t.querySelector('thead')?.text) === 'Local Visitante Fecha Campo')
  if (!tablas.length) throw Error('FEGABA todavía no publica un calendario para este grupo')
  const eventos = [], fechas = [], hoy = new Date(ahora).toISOString().slice(0, 10)
  for (let ti = 0; ti < tablas.length; ti++) {
    const tabla = tablas[ti], jornada = texto(tabla.parentNode?.previousElementSibling?.text)
    if (!/^(?:Jornada|Ronda) \d+ - \d{2}\/\d{2}\/\d{4}$/.test(jornada)) throw Error('Jornada gallega sin identificación')
    for (const [numeroFila, tr] of tabla.querySelectorAll('tbody tr').entries()) {
      const c = tr.querySelectorAll('td'), local = texto(c[0]?.text), visitante = texto(c[3]?.text), horario = texto(c[4]?.querySelector('strong')?.text), m = horario.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{1,2}:\d{2}))?$/)
      if (c.length !== 7 || !local || !visitante) throw Error('Partido gallego incompleto')
      if (/^descansa$/i.test(local) || /^descansa$/i.test(visitante)) continue
      const fecha = m ? `${m[3]}-${m[2]}-${m[1]}` : null
      if (fecha && !fechaDeportiva(fecha) || !fecha && horario && horario !== '-' && !/pendiente|por confirmar|sin fecha|aplazad/i.test(horario)) throw Error('Fecha gallega no reconocida')
      if (fecha) fechas.push(fecha)
      const inicio = fecha && m[4] ? horaGipuzkoa(fecha, m[4].padStart(5, '0')) : null, a = texto(c[1].text), b = texto(c[2].text), marcador = /^\d{1,3}$/.test(a) && /^\d{1,3}$/.test(b)
      if (!marcador && [a, b].some(v => v && v !== '-')) throw Error('Marcador gallego no reconocido')
      const pendientes = /EQUIPO POR DETERMINAR/i.test(local + ' ' + visitante)
      const futuro = fecha && (inicio ? Date.parse(inicio) > ahora : fecha > hoy), final = !pendientes && marcador && Number(a) + Number(b) > 0 && fecha && fecha < hoy && !futuro
      // Este visor no distingue un tanteo en curso de uno final: el mismo día no
      // se anuncia como terminado solo porque haya dos números en el calendario.
      const sinMarcador = !marcador || Number(a) + Number(b) === 0
      const estado = /aplazad/i.test(horario) ? 'aplazado' : pendientes ? 'por_confirmar' : final ? 'finalizado' : fecha && sinMarcador && (futuro || fecha === hoy) ? 'programado' : 'por_confirmar'
      eventos.push({ id: 'galicia-' + grupo + '-' + createHash('sha256').update(jornada + '\n' + local + '\n' + visitante + (pendientes ? '\ncruce-' + numeroFila : '')).digest('hex').slice(0, 20), nombre: local + ' · ' + visitante, local, visitante, jornada, estado, ...(fecha ? { fecha } : {}), ...(inicio ? { inicio } : {}), ...(final ? { resultado: { local: Number(a), visitante: Number(b) } } : {}), ...(texto(c[5].text) ? { lugar: texto(c[5].text) } : {}), fuenteUrl, ...(pendientes ? { detalle: 'La federación todavía no confirma ambos participantes.' } : !inicio ? { detalle: 'Hora por confirmar.' } : {}) })
    }
  }
  if (!eventos.length || !fechas.length || new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Calendario gallego vacío, sin fechas o duplicado')
  const anos = [...new Set(fechas.map(f => Number(f.slice(0, 4))))].sort()
  if (anos.at(-1) - anos[0] > 1) throw Error('El calendario gallego mezcla años no consecutivos')
  return { eventos, temporada: 'Calendario ' + anos.join('–'), anos }
}
export function clasificacionGalicia(html, grupo) {
  const tabla = parse(html).querySelector('table.tablaClasificacion')
  if (!tabla || texto(tabla.querySelector('thead')?.text) !== 'N° Nombre P.J P.G P.P P.F P.C Puntos % Victorias') throw Error('FEGABA todavía no publica una clasificación reconocida')
  const filas = tabla.querySelectorAll('tbody tr').map(tr => {
    const c = tr.querySelectorAll('td').map(n => texto(n.text)), claves = ['pj', 'pg', 'pp', 'pf', 'pc', 'pt']
    if (c.length !== 10 || !c[2] || !/^\d+$/.test(c[0]) || c.slice(3, 9).some(v => !/^-?\d+$/.test(v))) throw Error('Clasificación gallega incompleta')
    return { posicion: Number(c[0]), nombre: c[2], valores: Object.fromEntries(claves.map((k, i) => [k, Number(c[i + 3])])) }
  })
  if (!filas.length || new Set(filas.map(f => f.posicion)).size !== filas.length || filas.some(f => f.posicion < 1)) throw Error('Clasificación gallega vacía o duplicada')
  return [{ id: 'grupo-' + grupo, nombre: 'Clasificación del grupo', columnas: ['pj', 'pg', 'pp', 'pf', 'pc', 'pt'].map(clave => ({ clave, nombre: clave.toUpperCase() })), filas }]
}
export async function obtieneBaloncestoGalicia(opcionesLectura = {}) {
  const o = opcionesLectura, estado = normalizaEstadoNovanet(o.estadoNovanet?.[PORTAL]), competiciones = [], incidencias = [], reloj = o.relojGalicia || Date.now, duerme = o.duermeGalicia || (ms => new Promise(r => setTimeout(r, ms))), guardar = () => o.guardarEstadoNovanet?.(PORTAL, estado)
  let siguiente = 0, parado = false
  const restantes = () => !estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA ? 120 : 120 - estado.ventana.peticiones
  const disponible = () => !parado && restantes() > 0 && (!estado.noConsultarAntes || reloj() >= Date.parse(estado.noConsultarAntes))
  const lee = (url, body) => leerFuenteDeportiva(url, { fetcher: async (destino, init) => {
    if (!disponible()) throw Error('Galicia continuará en la próxima tanda permitida')
    if (siguiente > reloj()) await duerme(siguiente - reloj())
    if (!estado.ventana.desde || reloj() - Date.parse(estado.ventana.desde) >= HORA) estado.ventana = { desde: new Date(reloj()).toISOString(), peticiones: 0 }
    estado.ventana.peticiones++; siguiente = reloj() + 1000
    if (estado.ventana.peticiones >= 120) estado.noConsultarAntes = new Date(Date.parse(estado.ventana.desde) + HORA).toISOString()
    await guardar()
    // Es la referencia que envía el iframe público de FEGABA; no es una sesión de usuario.
    const r = await (o.fetcher || fetch)(destino, { ...init, headers: { ...init.headers, Referer: PAGINA, ...(body ? { 'Content-Type': 'application/json; charset=utf-8' } : {}) }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) })
    if (r.status === 429) { const v = r.headers.get('Retry-After'), h = /^\d+$/.test(v || '') ? reloj() + Number(v) * 1000 : Date.parse(v); estado.noConsultarAntes = new Date(Math.max(Number.isFinite(h) ? h : reloj() + HORA, reloj())).toISOString(); parado = true; await guardar() }
    return r
  } })
  const fallo = (nombre, motivo, id) => incidencias.push({ deporte: 'baloncesto', nombre, motivo, fuenteUrl: PAGINA, ...(id ? { id } : {}) })
  try {
    const visor = visorGalicia(await lee(PAGINA)), key = new URL(visor).searchParams.get('key'), html = await lee(visor), doc = parse(html)
    const competicionesFuente = opciones(doc, 'ddlCompeticion'), api = async (handler, body) => listasGalicia(JSON.parse(await lee(WIDGET + '/widget/informacion/general-delegacion?handler=' + handler + '&key=' + key, body)))
    for (const handler of ['ObtenerCategoriaCompeticion', 'ObtenerFases', 'ObtenerGrupo']) if (!html.includes('?handler=' + handler + '&key=' + key)) throw Error('El visor gallego no publica los selectores esperados')
    const urlCalendario = (fase, grupo) => WIDGET + '/widget/informacion/calendario/' + fase + '/' + grupo + '?key=' + key + '&data='
    if (!estado.catalogo || reloj() - Date.parse(estado.catalogo.verificadoEn) > 86400000 || competicionesFuente.some(c => !estado.catalogo.categorias.some(v => v.codigo.startsWith(c.codigo.padStart(6, '0'))))) {
      const faseInicial = opciones(doc, 'ddlFases')[0]?.codigo, grupoInicial = opciones(doc, 'ddlGrupos')[0]?.codigo
      if (!faseInicial || !grupoInicial) throw Error('Galicia no publica un calendario de referencia')
      const calendario = calendarioGalicia(await lee(urlCalendario(faseInicial, grupoInicial)), grupoInicial, PAGINA, reloj())
      // El estado guarda el intervalo real del calendario, incluso si una copa
      // ocupa un solo año; la web lo etiqueta «Calendario», no temporada oficial.
      const temporada = { codigo: String(calendario.anos[0]), nombre: calendario.anos[0] + '-' + calendario.anos.at(-1) }, categorias = []
      for (const comp of competicionesFuente) for (const cat of await api('ObtenerCategoriaCompeticion', { IdCompeticion: comp.codigo })) categorias.push({ codigo: comp.codigo.padStart(6, '0') + cat.codigo, nombre: cat.nombre, familia: comp.nombre, grupos: null })
      if (!categorias.length || new Set(categorias.map(c => c.codigo)).size !== categorias.length) throw Error('Catálogo gallego vacío o repetido')
      const anterior = estado.catalogo?.categorias[estado.categoria], misma = estado.catalogo?.temporada.codigo === temporada.codigo
      estado.catalogo = { temporada, categorias, verificadoEn: new Date(reloj()).toISOString() }; estado.categoria = misma ? Math.max(0, categorias.findIndex(c => c.codigo === anterior?.codigo)) : 0
      // La siguiente fase puede publicar grupos nuevos dentro de la misma categoría.
      estado.grupo = 0; if (!misma) estado.verificados = {}
      await guardar()
    }
    const vistos = new Set(), categorias = estado.catalogo.categorias
    while (disponible() && restantes() >= 4) {
      const c = categorias[estado.categoria], categoria = c.codigo.slice(6)
      if (!c.grupos) {
        const fases = await api('ObtenerFases', { IdCompeticionCategoria: categoria }), grupos = []
        for (const f of fases) for (const g of await api('ObtenerGrupo', { IdFase: f.codigo })) grupos.push({ codigo: f.codigo.padStart(6, '0') + g.codigo, nombre: f.nombre + ' · ' + g.nombre })
        c.grupos = grupos; await guardar()
      }
      if (!c.grupos.length) { const vacia = 'vacia-' + c.codigo; if (vistos.has(vacia)) break; vistos.add(vacia); estado.categoria = (estado.categoria + 1) % categorias.length; estado.grupo = 0; await guardar(); continue }
      estado.grupo %= c.grupos.length
      const g = c.grupos[estado.grupo], fase = String(Number(g.codigo.slice(0, 6))), grupo = g.codigo.slice(6), clave = c.codigo + '-' + g.codigo, id = 'basket-galicia-' + grupo
      if (vistos.has(clave)) break
      vistos.add(clave)
      try {
        const agenda = calendarioGalicia(await lee(urlCalendario(fase, grupo)), grupo, PAGINA, reloj()), sello = new Date(reloj()).toISOString()
        let tablas = [], aviso
        try { tablas = clasificacionGalicia(await lee(WIDGET + '/widget/informacion/clasificacion/' + grupo + '?key=' + key), grupo) } catch (e) { aviso = e.message; fallo(c.nombre + ' · ' + g.nombre, aviso, id) }
        const fechaTabla = new Date(reloj()).toISOString(), genero = /mixt/i.test(c.nombre) ? 'mixto' : /fem/i.test(c.nombre) ? 'femenino' : /masc/i.test(c.nombre) ? 'masculino' : undefined
        competiciones.push({ id, deporte: 'baloncesto', nombre: c.familia + ' · ' + c.nombre + ' · ' + g.nombre, temporada: agenda.temporada, categoria: c.nombre, grupo: g.nombre, zona: 'Galicia', ...(genero ? { genero } : {}), fuente: { nombre: 'Federación Galega de Baloncesto', url: PAGINA }, comprobadoEn: fechaTabla,
          agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: PAGINA, eventos: agenda.eventos, aviso: 'Calendario del grupo publicado por FEGABA. En la fuente oficial selecciona la competición, categoría, fase y grupo indicados.' },
          clasificacion: { estado: tablas.length ? 'actualizado' : 'no_disponible', consultado: fechaTabla, ...(tablas.length ? { verificadoEn: fechaTabla } : { aviso }), fuenteUrl: PAGINA, tablas } })
        estado.ultimoExito = sello; estado.verificados[clave] = sello
      } catch (e) { fallo(c.nombre + ' · ' + g.nombre, e.message, id) }
      if (parado) break
      estado.grupo++; if (estado.grupo >= c.grupos.length) { estado.grupo = 0; estado.categoria = (estado.categoria + 1) % categorias.length }
      await guardar()
    }
    fallo('Galicia · actualización por grupos', `Categorías localizadas: ${categorias.length}. Grupos comprobados: ${Object.keys(estado.verificados).length}. La actualización continúa por tandas.`)
  } catch (e) { fallo('Baloncesto · Galicia', e.message) }
  return { competiciones, incidencias }
}
