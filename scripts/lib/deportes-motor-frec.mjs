import { parse } from 'node-html-parser'
const base = 'https://fiafrec.com'
const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const fecha = v => /^\d{8}$/.test(v || '') ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6)}` : null
const valida = v => v && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
export function interpretaCalendarioFrec(datos, ano) {
  if (datos?.anno !== ano || !Array.isArray(datos.items) || datos.count !== datos.items.length || !datos.items.length) throw Error('Calendario FREC sin temporada verificada')
  const eventos = datos.items.map(r => {
    const inicio = fecha(r.data_inizio), fin = fecha(r.data_fine)
    if (!valida(inicio) || !valida(fin) || inicio.slice(0, 4) !== String(ano) || fin.slice(0, 4) !== String(ano) || inicio > fin || !Number.isInteger(r.id) || !r.titolo || !r.permalink?.startsWith(`${base}/race/`)) throw Error('Ronda FREC sin identidad o fecha verificable')
    return { id: `frec-${r.id}`, nombre: limpia(r.titolo), fecha: inicio, finFecha: fin, inicio: null, estado: 'por_confirmar', jornada: `Ronda ${r.round}`, lugar: limpia(r.stato), fuenteUrl: r.permalink, detalle: 'Fin de semana oficial. Los resultados por sesión se publican en documentos externos; no se deducen a partir de los puntos del campeonato.' }
  })
  if (new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('Rondas FREC duplicadas')
  return eventos
}

export function documentosFrec(html, ano) {
  const d = parse(html), equipos = [...new Set(d.querySelectorAll('a[href]').filter(a => a.getAttribute('href')?.startsWith(`${base}/team/`)).map(a => limpia(a.text)).filter(Boolean))]
  if (!equipos.length) throw Error('No se pueden comprobar los equipos de FREC')
  const tipos = [{ id: 'pilotos', etiqueta: 'Overall standings', nombre: 'Clasificación de pilotos', patron: /Driver-Standing/i }, { id: 'equipos', etiqueta: 'Overall team', nombre: 'Clasificación de equipos', patron: /Team-Standing/i }, { id: 'rookies', etiqueta: 'Overall rookie', nombre: 'Clasificación de debutantes', patron: /Rookies-Standing/i }]
  return { equipos, documentos: tipos.map(t => {
    const a = d.querySelectorAll('a').find(a => limpia(a.text) === t.etiqueta), url = a?.getAttribute('href')
    if (!url?.startsWith(`${base}/wp-content/uploads/${ano}/`) || !t.patron.test(url) || !url.endsWith('.pdf')) throw Error('Documento FREC sin temporada o tipo verificados')
    return { id: t.id, nombre: t.nombre, fuenteUrl: url }
  }) }
}

export function interpretaPuntosFrec(texto, tipo, equipos, eventos, fuenteUrl, verificadoEn) {
  const anoDocumento = fuenteUrl.match(/^https:\/\/fiafrec\.com\/wp-content\/uploads\/(\d{4})\//)?.[1]
  if (!anoDocumento || !/COMPETITION/.test(texto) || !/Points/.test(texto) || !eventos.length || eventos.some(e => e.fecha?.slice(0, 4) !== anoDocumento || !texto.toUpperCase().includes(e.nombre.toUpperCase()))) throw Error('El PDF FREC no coincide con el calendario de temporada')
  const filas = []
  for (const linea of texto.split('N/A:')[0].split('\n')) {
    const m = linea.match(tipo === 'equipos' ? /^(\d+) (.+)\s+(\d+)\s*$/ : /^(\d+) (\d+) (.+)\s+(\d+)\s*$/)
    if (!m) continue
    const cuerpo = limpia(m[tipo === 'equipos' ? 2 : 3]), puntos = Number(m[tipo === 'equipos' ? 3 : 4])
    const equipo = equipos.find(e => tipo === 'equipos' ? cuerpo.toLowerCase().startsWith(e.toLowerCase() + ' ') : cuerpo.toLowerCase().includes(` ${e.toLowerCase()} `))
    if (!equipo) throw Error('Equipo FREC no verificable en el PDF')
    const nombre = tipo === 'equipos' ? equipo : cuerpo.slice(0, cuerpo.toLowerCase().indexOf(` ${equipo.toLowerCase()} `))
    if (!nombre) throw Error('Piloto FREC sin nombre')
    filas.push({ posicion: Number(m[1]), nombre, valores: { puntos, ...(tipo !== 'equipos' ? { numero: Number(m[2]), equipo } : {}) } })
  }
  if (!filas.length || filas.length > 500 || filas.some((f, i) => f.posicion !== i + 1) || new Set(filas.map(f => f.nombre)).size !== filas.length) throw Error('Clasificación FREC incompleta o duplicada')
  return { id: tipo, nombre: tipo === 'pilotos' ? 'Clasificación de pilotos' : tipo === 'equipos' ? 'Clasificación de equipos' : 'Clasificación de debutantes', fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos oficiales' }, ...(tipo !== 'equipos' ? [{ clave: 'numero', nombre: 'Dorsal' }, { clave: 'equipo', nombre: 'Equipo' }] : [])], filas }
}

export async function obtieneFrec(leer, ano, consultado, incidencias) {
  const calendario = `${base}/calendar/?anno=${ano}`, clasificacion = `${base}/standings/`, c = { id: 'formula-regional-european', deporte: 'motor', nombre: 'Fórmula Regional Europea (FREC)', temporada: String(ano), categoria: 'Monoplazas', zona: 'Europa', genero: 'mixto', fuente: { nombre: 'FIA Formula Regional European Championship', url: base }, comprobadoEn: consultado }
  const bloque = (fuenteUrl, datos, aviso) => ({ estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl, ...datos, aviso })
  const falla = (fuenteUrl, e) => incidencias.push({ deporte: 'motor', id: c.id, nombre: c.nombre, fuenteUrl, motivo: e.message })
  try { c.agenda = bloque(calendario, { eventos: interpretaCalendarioFrec(JSON.parse(await leer(`${base}/wp-json/frec/v1/gare?anno=${ano}`)), ano) }, 'Calendario oficial de FREC, nombre que sustituye a FRECA desde 2026. Resultados por sesión en los documentos oficiales de cada ronda.') }
  catch (e) { falla(calendario, e); c.agenda = { estado: 'no_disponible', consultado, fuenteUrl: calendario, eventos: [], aviso: 'No se ha podido comprobar el calendario de FREC.' } }
  try {
    const documentos = documentosFrec(await leer(clasificacion), ano), tablas = [], tablasPendientes = []
    for (const d of documentos.documentos) {
      try {
        const { PDFParse } = await import('pdf-parse'), pdf = new PDFParse({ data: await leer(d.fuenteUrl, undefined, true), isEvalSupported: false })
        try { tablas.push(interpretaPuntosFrec((await pdf.getText()).text, d.id, documentos.equipos, c.agenda.eventos, d.fuenteUrl, consultado)) } finally { await pdf.destroy() }
      } catch (e) { falla(d.fuenteUrl, e); tablasPendientes.push(d.id) }
    }
    if (!tablas.length) throw Error('Ninguna clasificación FREC comprobable')
    c.clasificacion = bloque(clasificacion, { tablas, ...(tablasPendientes.length ? { tablasPendientes } : {}) }, 'Puntos del PDF oficial de cada categoría. Se utilizan los documentos revisados enlazados por el campeonato, porque la tabla HTML contiene un dato incoherente.')
  } catch (e) { falla(clasificacion, e); c.clasificacion = { estado: 'no_disponible', consultado, fuenteUrl: clasificacion, tablas: [], aviso: 'No se han podido comprobar las clasificaciones oficiales de FREC.' } }
  return c
}
