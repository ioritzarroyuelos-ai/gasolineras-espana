const base = 'https://files.alkamelcloud.com/'
const fuente = 'https://ferrarichallenge.alkamelsystems.com/'
const limpia = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const slug = v => limpia(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
const numero = v => /^\d+$/.test(limpia(v)) ? Number(v) : null
const validaFecha = f => /^\d{4}-\d\d-\d\d$/.test(f) && Number.isFinite(Date.parse(f)) && new Date(f).toISOString().slice(0, 10) === f
const nombreSesion = s => s.replace(/^Race /, 'Carrera ').replace(/^Qualifying /, 'Clasificación ').replace(/^Free Practice /, 'Entrenamientos libres ')

// El catálogo es el que carga la página pública de Alkamel. No necesita sesión,
// ni el formulario de acceso que ofrece para otras funciones de la web.
export function interpretaCatalogoFerrari(datos, ano) {
  if (!Array.isArray(datos?.folders)) throw Error('Catálogo Ferrari no reconocido')
  const documentos = []
  function recorre(nodos) {
    for (const n of nodos || []) {
      if (n.url) {
        const url = new URL(n.url, base)
        if (url.origin !== new URL(base).origin || !url.pathname.startsWith('/ferrarichallenge/results/05_Europe/') || !new RegExp(`/\\d+_${ano}/`).test(url.pathname)) throw Error('Documento Ferrari ajeno a Europa o temporada')
        documentos.push({ ...n, url: url.href })
      }
      if (n.children) recorre(n.children)
    }
  }
  recorre(datos.folders)
  const sesiones = documentos.filter(d => /\/03_Classification_[^/]+\.CSV$/i.test(d.url)).flatMap(d => {
    const ruta = decodeURIComponent(new URL(d.url).pathname)
    const m = ruta.match(/\/\d+_(\d{4})\/\d+_([^/]+)\/\d+_(TROFEO PIRELLI|COPPA SHELL|FERRARI CHALLENGE)\/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})_([^/]+)\/03_Classification_([^/]+)\.CSV$/i)
    if (!m) return [] // Otras series (UK, Club Challenge) tienen su propio alcance.
    const fecha = `${m[4]}-${m[5]}-${m[6]}`
    if (Number(m[1]) !== ano || Number(m[4]) !== ano || !validaFecha(fecha) || Number(m[7]) > 23 || Number(m[8]) > 59 || m[9] !== m[10]) throw Error('Sesión Ferrari con fecha o identidad contradictoria')
    return [{ id: `ferrari-${slug(`${m[2]}-${m[3]}-${m[4]}${m[5]}${m[6]}-${m[9]}`)}`, nombre: `${m[2]} · ${m[3]} · ${nombreSesion(m[9])}`, fecha, inicio: null, estado: 'por_confirmar', lugar: m[2], fuenteUrl: d.url, detalle: `Hora publicada: ${m[7]}:${m[8]}. El catálogo no indica zona horaria; consulta los documentos de la prueba.`, sesion: m[9] }]
  })
  const clasificaciones = documentos.filter(d => /CHAMPIONSHIP%20STANDINGS\//i.test(d.url) && /\.pdf$/i.test(d.url)).map(d => ({ ...d, ronda: Number(decodeURIComponent(d.url).match(/\/\d+_\d{4}\/(\d+)_/)?.[1]) })).filter(d => Number.isInteger(d.ronda))
  if (!sesiones.length || new Set(sesiones.map(s => s.id)).size !== sesiones.length) throw Error('Sesiones Ferrari vacías o duplicadas')
  clasificaciones.sort((a, b) => b.ronda - a.ronda || b.name.localeCompare(a.name))
  return { sesiones, clasificacion: clasificaciones[0]?.url || null }
}

function csvFilas(texto) {
  const filas = [], textoLimpio = texto.replace(/^\uFEFF/, ''); let fila = [], valor = '', comillas = false
  for (let i = 0; i < textoLimpio.length; i++) {
    const c = textoLimpio[i]
    if (c === '"') { if (comillas && textoLimpio[i + 1] === '"') { valor += '"'; i++ } else comillas = !comillas }
    else if (!comillas && (c === ';' || c === '\n')) { fila.push(valor); valor = ''; if (c === '\n') { if (fila.some(v => v.trim())) filas.push(fila); fila = [] } }
    else if (c !== '\r') valor += c
  }
  if (comillas) throw Error('CSV Ferrari truncado')
  fila.push(valor); if (fila.some(v => v.trim())) filas.push(fila)
  return filas
}
export function interpretaResultadoFerrari(texto, sesion, fuenteUrl, verificadoEn) {
  const [cabecera, ...datos] = csvFilas(texto), nombres = cabecera?.map(limpia) || []
  const carrera = /^Race\b/.test(sesion), pos = carrera ? 'POSITION' : 'POS', tiempo = carrera ? 'TOTAL_TIME' : 'TIME'
  const prefijos = nombres.includes('DRIVER_FIRSTNAME') ? ['DRIVER'] : nombres.filter(n => /^DRIVER\d+_FIRSTNAME$/.test(n)).map(n => n.replace('_FIRSTNAME', ''))
  for (const c of [pos, 'NUMBER', 'LAPS', tiempo, 'TEAM']) if (!nombres.includes(c)) throw Error('CSV Ferrari de otra sesión o columnas incompletas')
  if (!prefijos.length || prefijos.some(p => !nombres.includes(`${p}_SECONDNAME`))) throw Error('CSV Ferrari sin nombres de pilotos')
  const filas = datos.map(f => {
    if (f.length > cabecera.length || f.length < cabecera.length && nombres.slice(f.length).some(n => n && !/^DRIVER[2-6]_/.test(n))) throw Error('Fila Ferrari incompleta')
    const r = Object.fromEntries(nombres.map((n, i) => [n, limpia(f[i])])), vueltas = numero(r.LAPS), dorsal = numero(r.NUMBER)
    const nombre = prefijos.map(p => limpia(`${r[`${p}_FIRSTNAME`]} ${r[`${p}_SECONDNAME`]}`)).filter(Boolean).join(' / ')
    if (!nombre || vueltas === null || !/^\d{1,4}[a-z]?$/i.test(r.NUMBER)) throw Error('Piloto Ferrari sin identidad o vueltas')
    return { posicion: numero(r[pos]) || null, nombre, valores: { numero: dorsal ?? r.NUMBER, equipo: r.TEAM || '—', clase: r.CLASS || '—', vueltas, tiempo: r[tiempo] || '—', diferencia: r.GAP_FIRST || '—', estado: r.STATUS || r[pos] || 'Sin posición publicada' } }
  })
  if (!filas.length || filas.length > 500 || new Set(filas.map(f => f.valores.numero)).size !== filas.length) throw Error('Resultados Ferrari vacíos o duplicados')
  return { id: 'resultado', nombre: 'Resultado publicado por Ferrari Challenge', fuenteUrl, verificadoEn, columnas: [{ clave: 'numero', nombre: 'Dorsal' }, { clave: 'equipo', nombre: 'Equipo' }, { clave: 'clase', nombre: 'Categoría' }, { clave: 'vueltas', nombre: 'Vueltas' }, { clave: 'tiempo', nombre: carrera ? 'Tiempo total' : 'Mejor vuelta' }, { clave: 'diferencia', nombre: 'Diferencia' }, { clave: 'estado', nombre: 'Estado oficial' }], filas }
}

export function interpretaPuntosFerrariPaginas(paginas, ano, fuenteUrl, verificadoEn) {
  const tablas = new Map()
  for (const pagina of paginas) {
    const nombre = pagina.match(/^Ferrari Challenge [^\n]+/m)?.[0], fecha = pagina.match(new RegExp(`\\b(\\d{2})/(\\d{2})/${ano} Page \\d+ / \\d+`))
    if (!nombre || !fecha || !validaFecha(`${ano}-${fecha[2]}-${fecha[1]}`) || !/Season Standings/.test(pagina) || !/Total\s+Points/.test(pagina)) throw Error('Clasificación Ferrari sin temporada verificada')
    // Una fila por línea: los estados EX/NS de carreras individuales no son
    // nombres ni nuevas posiciones del campeonato.
    const filas = pagina.split('\n').flatMap(linea => { const m = linea.match(/(?:^|\t)([^\t]*[A-Za-zÀ-ÿ][^\t]*)\t(\d+) (\d+)(?:\s|$)/); return m ? [{ posicion: Number(m[2]), nombre: limpia(m[1]), valores: { puntos: Number(m[3]) } }] : [] })
    if (!filas.length) throw Error('Página Ferrari sin filas reconocibles')
    const id = slug(nombre), anterior = tablas.get(id)
    if (anterior) anterior.filas.push(...filas)
    else tablas.set(id, { id, nombre, fuenteUrl, verificadoEn, columnas: [{ clave: 'puntos', nombre: 'Puntos oficiales' }], filas })
  }
  for (const t of tablas.values()) if (t.filas.length > 500 || t.filas.some((f, i) => f.posicion !== i + 1) || new Set(t.filas.map(f => f.nombre)).size !== t.filas.length) throw Error('Clasificación Ferrari con filas perdidas o duplicadas')
  if (!tablas.size || tablas.size > 30) throw Error('Clasificación Ferrari vacía')
  return [...tablas.values()]
}
export async function ampliaFerrari(c, leer, ano, ahora, consultado, incidencias) {
  const bloque = (fuenteUrl, datos, aviso) => ({ estado: 'actualizado', consultado, verificadoEn: consultado, fuenteUrl, ...datos, aviso })
  const falla = (url, e) => incidencias.push({ deporte: 'motor', id: c.id, nombre: 'Ferrari Challenge Europa', fuenteUrl: url, motivo: e.message })
  let catalogo
  try {
    const indice = JSON.parse(await leer(`${base}ferrarichallenge/manifests/results.json`)), serie = indice.series?.find(s => s.id === '05_Europe' && s.name === 'Europe')
    if (!serie?.indexUrl?.startsWith('ferrarichallenge/manifests/')) throw Error('No aparece Europa en el catálogo Ferrari')
    const temporadas = JSON.parse(await leer(new URL(serie.indexUrl, base).href)), temporada = temporadas.seasons?.find(s => s.name === String(ano) && s.id.endsWith(`_${ano}`))
    if (!temporada?.manifestUrl?.startsWith('ferrarichallenge/manifests/')) throw Error('No aparece esta temporada en el catálogo Ferrari')
    catalogo = interpretaCatalogoFerrari(JSON.parse(await leer(new URL(temporada.manifestUrl, base).href)), ano)
    const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid' }).format(ahora), pendientes = catalogo.sesiones.filter(s => s.fecha <= hoy)
    let siguiente = 0
    await Promise.all(Array.from({ length: Math.min(3, pendientes.length) }, async () => { while (siguiente < pendientes.length) { const e = pendientes[siguiente++]; try { e.resultados = [interpretaResultadoFerrari(await leer(e.fuenteUrl), e.sesion, e.fuenteUrl, consultado)] } catch (error) { falla(e.fuenteUrl, error) } } }))
    const eventos = catalogo.sesiones.map(({ sesion, ...e }) => e), fechas = new Set(eventos.map(e => e.fecha))
    // El catálogo enumera documentos publicados; la RFEDA aporta las próximas
    // rondas que aún no tienen documentos, con sus fechas originales.
    eventos.push(...c.agenda.eventos.filter(e => e.fecha >= hoy && !fechas.has(e.fecha)))
    c.agenda = bloque(fuente, { eventos }, 'Sesiones con documentos oficiales de Ferrari Challenge Europa y próximas pruebas RFEDA. Las horas sin zona confirmada se muestran como texto.'); c.categoria = 'Automovilismo'; c.zona = 'Europa'
  } catch (e) { falla(fuente, e) }
  if (!catalogo?.clasificacion) return
  try {
    const { PDFParse } = await import('pdf-parse'), pdf = new PDFParse({ data: await leer(catalogo.clasificacion, undefined, true), isEvalSupported: false })
    try { const documento = await pdf.getText(); c.clasificacion = bloque(catalogo.clasificacion, { tablas: interpretaPuntosFerrariPaginas(documento.pages.map(p => p.text), ano, catalogo.clasificacion, consultado) }, 'Última clasificación de temporada publicada por Ferrari Challenge Europa; cada categoría mantiene sus propios puntos.') } finally { await pdf.destroy() }
  } catch (e) { falla(catalogo.clasificacion, e); c.clasificacion = { estado: 'no_disponible', consultado, fuenteUrl: catalogo.clasificacion, tablas: [], aviso: 'No se ha podido comprobar la última clasificación Ferrari.' } }
}
