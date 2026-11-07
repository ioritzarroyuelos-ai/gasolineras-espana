import { parse } from 'node-html-parser'

export const fuenteSupercars = 'https://www.gt4south.com/results?lang=es'
export const fuenteCronoJerez = 'https://www.crono-jerez.com/'
const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const slug = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const meses = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const fecha = (dia, mes, ano) => {
  const m = meses.findIndex(v => v.startsWith(mes.toLowerCase())) + 1, f = `${ano}-${String(m).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
  if (!m || !Number.isFinite(Date.parse(f)) || new Date(f).toISOString().slice(0, 10) !== f) throw Error('Fecha Supercars no válida')
  return f
}

export function interpretaIndiceSupercars(html, ano) {
  const d = parse(html), rondas = [], documentos = []; let temporada = null
  for (const e of d.querySelectorAll('h1,h2,a')) {
    const t = limpia(e.text), cambio = t.match(/^RESULTADOS (\d{4})$/)
    if (e.tagName === 'H1' && cambio) temporada = Number(cambio[1])
    if (temporada !== ano) continue
    if (e.tagName === 'A' && t === 'SUPERCARS ESPAÑA - DRIVERS AND TEAMS CHAMPIONSHIP STANDINGS') {
      const url = e.getAttribute('href')
      if (!/^https:\/\/www\.gt4south\.com\/_files\/ugd\/[a-z0-9_]+\.pdf$/.test(url || '')) throw Error('Documento Supercars sin fuente verificable')
      documentos.push(url)
    }
    if (e.tagName !== 'H2' || !/^(ALGARVE IBERIAN FESTIVAL|JARAMA CLASSIC|VALENCIA IBERIAN FESTIVAL|JEREZ IBERIAN FESTIVAL)$/.test(t)) continue
    const bloque = e.parentNode?.parentNode, m = limpia(bloque?.text).match(/(\d{2})\/(\d{2}) ([A-Za-z]+) (\d{4})/)
    if (!m || Number(m[4]) !== ano) throw Error('Ronda Supercars sin temporada verificada')
    const desde = fecha(m[1], m[3], ano), hasta = fecha(m[2], m[3], ano)
    if (desde > hasta) throw Error('Rango Supercars invertido')
    rondas.push({ id: `supercars-${slug(t)}-${ano}`, nombre: t, fecha: desde, finFecha: hasta, inicio: null, estado: 'por_confirmar', fuenteUrl: fuenteSupercars, detalle: 'Fin de semana del campeonato de España. Consulta en la fuente los documentos publicados de cada sesión.' })
  }
  if (new Set(documentos).size !== 1 || rondas.length !== 4 || new Set(rondas.map(r => r.id)).size !== rondas.length) throw Error('Calendario o puntos de Supercars España incompletos')
  return { rondas, puntosUrl: documentos[0] }
}

export function interpretaPuntosSupercars(texto, fuenteUrl, verificadoEn) {
  if (!/CLASIFICACIONES PROVISIONALES/.test(texto) || !['PORTIMAO', 'JARAMA', 'VALENCIA', 'JEREZ'].every(v => texto.includes(v))) throw Error('Puntos Supercars sin identidad del campeonato español')
  const tablas = []; let tabla
  for (const linea of texto.split('\n')) {
    const h = linea.match(/^(.+?) TOTAL\s*\t/) || linea.match(/^(GT|GTC|TOURING CARS) - TEAMS\s*$/)
    if (h) {
      const equipos = /TEAMS/.test(linea), nombre = limpia(h[1]), id = `${equipos ? 'equipos' : 'pilotos'}-${slug(nombre)}`
      tabla = { id, nombre: `${equipos ? 'Equipos' : 'Pilotos'} · ${nombre} · provisional`, fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos oficiales' }], filas: [] }; tablas.push(tabla); continue
    }
    if (!/^\d+\s*\t/.test(linea)) continue
    const m = linea.match(/^(\d+)\s*\t([^\t]+)\t\s*(\d+)(?:\s|$)/)
    if (!tabla || !m || !limpia(m[2])) throw Error('Fila de puntos Supercars incompleta')
    tabla.filas.push({ posicion: Number(m[1]), nombre: limpia(m[2]), valores: { puntos: Number(m[3]) } })
  }
  // Este documento usa rangos densos (1,1,2,2), incluso para parejas de pilotos.
  // No se recalcula un empate: si el editor cambia a 1,1,3 se conserva la copia
  // previa hasta verificar el nuevo formato, igual que ante una fila perdida.
  if (tablas.length !== 15 || new Set(tablas.map(t => t.id)).size !== tablas.length || tablas.some(t => !t.filas.length || t.filas.length > 500 || t.filas[0].posicion !== 1 || t.filas.some((f, i) => i && (f.posicion < t.filas[i - 1].posicion || f.posicion > t.filas[i - 1].posicion + 1)) || new Set(t.filas.map(f => f.nombre)).size !== t.filas.length)) throw Error('Clasificaciones Supercars incompletas o duplicadas')
  return tablas
}

export function interpretaSesionesCronoJerez(html, ronda, ano) {
  const d = parse(html)
  if (!d.querySelectorAll('h3').some(h => limpia(h.text) === `Iberian Racing Festival - Jerez ${ano}`)) throw Error('Crono-Jerez muestra otro evento o temporada')
  const sesiones = []
  for (const a of d.querySelectorAll('a.resultado')) {
    const href = (a.getAttribute('href') || '').replace(/[\r\n]/g, ''), m = href.match(new RegExp(`^\./${ano}/JIRF/(tc|gt4)(li|q|ra)([1-3])\\.pdf$`))
    if (!m) continue
    const dia = limpia(a.parentNode.querySelector('h4')?.text).match(/^[A-Za-z]+, ([A-Za-z]+) (\d+)(?:st|nd|rd|th)$/)
    if (!dia) throw Error('Sesión Crono-Jerez sin día verificable')
    const f = fecha(dia[2], dia[1], ano), numero = Number(m[3]), tipo = m[2], grupo = m[1], etiqueta = tipo === 'li' ? 'Entrenamientos colectivos' : tipo === 'q' ? 'Clasificación' : 'Carrera'
    const titulo = `${tipo === 'li' ? 'Colective Test' : tipo === 'q' ? 'Qualifying Practice' : 'Race'} ${numero}`
    if (limpia(a.text) !== titulo || f < ronda.fecha || f > ronda.finFecha) throw Error('Sesión Crono-Jerez fuera de su ronda o identidad')
    sesiones.push({ id: `supercars-jerez-${ano}-${grupo}-${tipo}${numero}`, nombre: `Jerez · ${grupo === 'gt4' ? 'GT4' : 'GTC y TC'} · ${etiqueta} ${numero}`, fecha: f, inicio: null, estado: 'por_confirmar', fuenteUrl: new URL(href, fuenteCronoJerez).href, detalle: 'Acta publicada por el cronometraje oficial. Se conserva el nombre del piloto o pareja tal como aparece en la tabla general. Hora exacta pendiente de verificar.', tipo, numero, grupo })
  }
  if (!sesiones.length || new Set(sesiones.map(s => s.id)).size !== sesiones.length) throw Error('No hay sesiones Crono-Jerez verificables')
  return sesiones
}

export function interpretaResultadoCronoJerez(texto, sesion, ano, verificadoEn) {
  // Primera página: las restantes repiten resultados por clase y análisis.
  texto = texto.split(/-- 1 of \d+ --/)[0]
  if (!/Pág 1 de 1\b/.test(texto)) throw Error('La tabla general Crono-Jerez ocupa más de una página o no declara su paginación')
  const titulo = `${sesion.tipo === 'li' ? 'COLLECTIVE TEST' : sesion.tipo === 'q' ? 'QUALIFYING PRACTICE' : 'RACE'} ${sesion.numero}`
  const grupo = sesion.grupo === 'gt4' ? 'SUPERCARS (GT4)' : 'SUPERCARS (GTC & TC)'
  const d = texto.match(/Circuito de Jerez, (\d+) DE (\w+) DE (\d{4})/), mesesEs = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
  if (!texto.includes(`JEREZ IBERIAN RACING FESTIVAL ${ano}`) || !texto.split('\n').includes(grupo) || !texto.includes(titulo + (sesion.tipo === 'ra' ? ' - SCRATCH CLASSIFICATION' : ' - RESULTS')) || !d || Number(d[3]) !== ano || `${ano}-${String(mesesEs.indexOf(d[2]) + 1).padStart(2, '0')}-${d[1].padStart(2, '0')}` !== sesion.fecha) throw Error('Acta Crono-Jerez de otra fecha, grupo o sesión')
  const filas = []
  for (const linea of texto.split('\n')) {
    if (sesion.tipo === 'ra') {
      if (!/^\d+ /.test(linea)) continue
      const m = linea.match(/^(?:(\d+) )?(\d+) (.+?) ((?:\d+:)?\d+\.\d{3}) (?:\d+:\d{2}\.\d{3}|PARRILLA)\t(\d+) \d+\t.+\t([^\t]+)$/)
      if (!m || (!m[1] && !texto.includes('No Clasificados'))) throw Error('Fila de carrera Crono-Jerez ambigua')
      filas.push({ posicion: m[1] ? Number(m[1]) : null, nombre: limpia(m[3]), valores: { numero: Number(m[2]), tiempo: m[4], vueltas: Number(m[5]), clase: limpia(m[6]), estado: m[1] ? 'Clasificado' : 'No clasificado' } })
    } else {
      if (!/^[^\t]+ [A-Z]{3} .+\t/.test(linea)) continue
      const m = linea.match(/^(.+?) [A-Z]{3} .+? (\d+:\d{2}\.\d{3}|PIT EXIT) (?:----|\S+) [\d,]+\t(\d+) \d+ \S+\t(\d+) (\d+) ([a-z0-9+]+)$/)
      if (!m) throw Error('Fila de entrenamientos Crono-Jerez ambigua')
      filas.push({ posicion: Number(m[4]), nombre: limpia(m[1]), valores: { numero: Number(m[5]), tiempo: m[2] === 'PIT EXIT' ? 'Sin tiempo publicado' : m[2], vueltas: Number(m[3]), clase: m[6], estado: m[2] === 'PIT EXIT' ? 'Sin tiempo publicado' : 'Tiempo publicado' } })
    }
  }
  if (!filas.length || filas.length > 500 || filas.some((f, i) => f.posicion !== null && f.posicion !== i + 1) || new Set(filas.map(f => f.valores.numero)).size !== filas.length) throw Error('Tabla Crono-Jerez incompleta o duplicada')
  return { id: 'resultado', nombre: `Orden publicado · ${sesion.nombre}`, fuenteUrl: sesion.fuenteUrl, verificadoEn, columnas: [{ clave: 'numero', nombre: 'Dorsal' }, { clave: 'clase', nombre: 'Clase' }, { clave: 'tiempo', nombre: sesion.tipo === 'ra' ? 'Tiempo publicado' : 'Mejor vuelta' }, { clave: 'vueltas', nombre: 'Vueltas' }, { clave: 'estado', nombre: 'Estado publicado' }], filas }
}

async function textoPdf(datos, primera = false) {
  const { PDFParse } = await import('pdf-parse'), pdf = new PDFParse({ data: datos, isEvalSupported: false })
  try { const texto = await pdf.getText(); return primera ? texto.pages[0]?.text || '' : texto.text } finally { await pdf.destroy() }
}

export async function ampliaSupercars(c, leer, ano, ahora, consultado, incidencias) {
  const falla = (fuenteUrl, e) => incidencias.push({ deporte: 'motor', id: c.id, nombre: c.nombre, fuenteUrl, motivo: e.message })
  const bloque = (fuenteUrl, datos, aviso) => ({ estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl, ...datos, aviso })
  let indice
  try { indice = interpretaIndiceSupercars(await leer(fuenteSupercars), ano) }
  catch (e) {
    falla(fuenteSupercars, e)
    c.agenda = { estado: 'no_disponible', consultado, fuenteUrl: fuenteSupercars, eventos: [], aviso: 'No se ha podido comprobar el catálogo completo de Supercars España.' }
    c.clasificacion = { estado: 'no_disponible', consultado, fuenteUrl: fuenteSupercars, tablas: [], aviso: 'No se ha podido comprobar el documento de puntos de esta temporada.' }
    return
  }
  c.categoria = 'GT y turismos'; c.zona = 'España y Portugal'
  c.agenda = bloque(fuenteSupercars, { eventos: indice.rondas }, 'Cuatro pruebas del campeonato de España; las pruebas exclusivas del campeonato portugués o ibérico no se incluyen.')
  try { c.clasificacion = bloque(indice.puntosUrl, { tablas: interpretaPuntosSupercars(await textoPdf(await leer(indice.puntosUrl, undefined, true)), indice.puntosUrl, consultado) }, 'Clasificación provisional española enlazada en la sección oficial de esta temporada. Puntos y empates publicados, sin recalcularlos. Los resultados de Jerez pueden preceder a la actualización de estos puntos.') }
  catch (e) { falla(indice.puntosUrl, e); c.clasificacion = { estado: 'no_disponible', consultado, fuenteUrl: indice.puntosUrl, tablas: [], aviso: 'No se ha podido comprobar la clasificación española completa.' } }
  const ronda = indice.rondas.find(r => r.nombre === 'JEREZ IBERIAN FESTIVAL'), hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(ahora)
  if (!ronda || ronda.fecha > hoy) return
  try {
    const sesiones = interpretaSesionesCronoJerez(await leer(fuenteCronoJerez), ronda, ano)
    // Secuencial: un solo documento activo; el lector compartido limita PDF y red.
    for (const s of sesiones) {
      const { tipo, numero, grupo, ...evento } = s
      if (s.fecha <= hoy) try { evento.resultados = [interpretaResultadoCronoJerez(await textoPdf(await leer(s.fuenteUrl, undefined, true), true), s, ano, consultado)] }
      catch (e) { falla(s.fuenteUrl, e); evento.detalle += ' La tabla no se ha podido verificar; consulta el acta en la fuente.' }
      c.agenda.eventos.push(evento)
    }
    c.agenda.aviso += ' Se incluyen las sesiones publicadas de Jerez; las demás rondas conservan su enlace oficial. Cada sesión distingue GT4 de GTC y TC.'
  } catch (e) {
    falla(fuenteCronoJerez, e)
    c.agenda = { estado: 'no_disponible', consultado, fuenteUrl: fuenteCronoJerez, eventos: [], aviso: 'El calendario responde, pero no se ha podido comprobar el índice de sesiones de Jerez. Se conservará la última agenda completa con su fecha original si está disponible.' }
  }
}
