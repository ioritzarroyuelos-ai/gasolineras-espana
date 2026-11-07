import { parse } from 'node-html-parser'
import { fechaMadrid, fechaEspanola } from './deportes-futbol-fechas.mjs'
const texto = v => String(v ?? '').replace(/\s+/g, ' ').trim()
const numero = v => /^-?\d+$/.test(String(v)) ? Number(v) : null

export function paginaMadrid(html) {
  const s = parse(html).querySelector('#__NEXT_DATA__')?.text
  const p = s ? JSON.parse(s)?.props?.pageProps : null
  if (!p || !/^20\d{2}-20\d{2}$/.test(p.season?.nombre) || !/^\d+$/.test(p.season.cod_temporada)) throw Error('Madrid no identifica la temporada de su página de competiciones')
  return p
}

export function categoriasMadrid(datos) {
  if (!Array.isArray(datos)) throw Error('El catálogo de Madrid no contiene una lista')
  return datos.map(c => {
    if (!/^\d+$/.test(c.codigo) || !texto(c.nombre)) throw Error('Competición de Madrid incompleta')
    return { codigo: String(c.codigo), nombre: texto(c.nombre), familia: texto(`${c.TipoJuego || ''} ${c.nombre_grupo_categoria || ''}`), grupos: null }
  })
}

export function gruposMadrid(json) {
  const datos = JSON.parse(json)
  if (!Array.isArray(datos)) throw Error('Madrid no entrega los grupos de la competición')
  return datos.map(g => {
    if (!/^\d+$/.test(g.codigo) || !texto(g.nombre)) throw Error('Grupo de Madrid incompleto')
    return { codigo: String(g.codigo), nombre: texto(g.nombre) }
  })
}

export function jornadasMadrid(json) {
  const datos = JSON.parse(json)
  if (datos.estado !== '1' || !Array.isArray(datos.jornadas)) throw Error('Madrid no entrega las jornadas del grupo')
  return datos.jornadas.map(j => {
    if (!/^\d+$/.test(j.codjornada) || !fechaEspanola(j.fecha_jornada)) throw Error('Jornada de Madrid incompleta')
    return { codigo: String(j.codjornada), nombre: `${j.nombre} - ${j.fecha_jornada}` }
  })
}

function identidad(datos, esperada) {
  if (datos?.estado !== '1' || String(datos.codigo_competicion) !== esperada.competicion || String(datos.codigo_grupo) !== esperada.grupo) {
    const digitos = (v, maximo) => (typeof v === 'string' || typeof v === 'number') && new RegExp(`^\\d{1,${maximo}}$`).test(String(v)) ? String(v) : null
    const error = Error('Madrid devuelve otra competición o grupo')
    // Sólo metadatos numéricos de identidad: nunca publicar el cuerpo recibido.
    Object.defineProperty(error, 'diagnosticoMadrid', { value: Object.freeze({
      estado: digitos(datos?.estado, 6), tipoEstado: typeof datos?.estado,
      competicionEsperada: digitos(esperada.competicion, 20), grupoEsperado: digitos(esperada.grupo, 20),
      competicionRecibida: digitos(datos?.codigo_competicion, 20), grupoRecibido: digitos(datos?.codigo_grupo, 20),
    }) })
    throw error
  }
}

export function parseaAgendaMadrid(json, esperada, fuenteUrl) {
  const datos = JSON.parse(json); identidad(datos, esperada)
  if (String(datos.jornada) !== esperada.jornada || !Array.isArray(datos.partidos)) throw Error('Madrid devuelve otra jornada')
  const eventos = datos.partidos.filter(p => !/^descansa$/i.test(texto(p.Nombre_equipo_local)) && !/^descansa$/i.test(texto(p.Nombre_equipo_visitante))).map(p => {
    const local = texto(p.Nombre_equipo_local), visitante = texto(p.Nombre_equipo_visitante)
    if (!local || !visitante) throw Error('Madrid publica un partido sin equipos')
    const fecha = fechaEspanola(p.fecha)
    if (fecha && (fecha.slice(0, 4) < esperada.temporada.slice(0, 4) || fecha.slice(0, 4) > esperada.temporada.slice(-4))) throw Error('Madrid devuelve partidos de otra temporada')
    const inicio = fecha && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.hora || '') ? fechaMadrid(fecha, p.hora) : null
    const motivo = texto(p.motivo_estado), estado = /aplazad/i.test(motivo) ? 'aplazado' : /suspendid|cancelad|retirad/i.test(motivo) ? 'cancelado' : p.acta_cerrada === '1' ? 'finalizado' : p.partido_en_juego === '1' ? 'en_juego' : inicio ? 'programado' : 'por_confirmar'
    const goles = { local: numero(p.Goles_casa), visitante: numero(p.Goles_visitante) }
    if (estado === 'finalizado' && (goles.local === null || goles.visitante === null || goles.local < 0 || goles.visitante < 0)) throw Error('Madrid marca un partido final sin resultado válido')
    const id = /^[1-9]\d*$/.test(p.codacta) ? p.codacta : `${esperada.grupo}-${esperada.jornada}-${p.CodEquipo_local}-${p.CodEquipo_visitante}`
    return { id: `madrid-${id}`, nombre: `${local} — ${visitante}`, local, visitante, fecha, inicio, estado, resultado: ['finalizado','en_juego'].includes(estado) && goles.local !== null && goles.visitante !== null ? goles : null, jornada: `Jornada ${datos.nombre_jornada || datos.jornada}`, fuenteUrl, ...(motivo ? { detalle: motivo } : {}) }
  })
  if (!eventos.length || new Set(eventos.map(e => e.id)).size !== eventos.length) throw Error('La jornada de Madrid no contiene una lista de partidos válida')
  return eventos
}

export function parseaClasificacionMadrid(html, esperada) {
  const p = paginaMadrid(html), datos = p.standings; identidad(datos, esperada)
  if (p.season.nombre !== esperada.temporada) throw Error('Madrid devuelve la clasificación de otra temporada')
  if (!Array.isArray(datos.clasificacion) || !datos.clasificacion.length) throw Error('Madrid no publica una tabla de puntos para este grupo')
  const campos = [['puntos','Puntos','puntos'],['jugados','Jugados','jugados'],['ganados','Ganados','ganados'],['empatados','Empatados','empatados'],['perdidos','Perdidos','perdidos'],['favor','Goles a favor','goles_a_favor'],['contra','Goles en contra','goles_en_contra']]
  const filas = datos.clasificacion.map(f => {
    const posicion = numero(f.posicion), nombre = texto(f.nombre), valores = Object.fromEntries(campos.map(([key,,campo]) => [key,numero(f[campo])]))
    if (!posicion || !nombre || Object.values(valores).some(v => v === null)) throw Error('La clasificación de Madrid tiene filas incompletas')
    return { posicion, nombre, valores }
  })
  return [{ id: 'general', nombre: `Clasificación · Jornada ${datos.jornada}`, columnas: campos.map(([clave,nombre]) => ({clave,nombre})), filas }]
}
