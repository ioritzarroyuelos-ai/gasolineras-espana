import { z } from 'zod'
import { diaDeporte } from './deportes-indice.mjs'

export function validaUrlDeportiva(valor) {
  if (typeof valor !== 'string' || valor.length > 2048) return false
  try {
    const u = new URL(valor)
    return u.protocol === 'https:' && !u.username && !u.password && !u.port &&
      !/^(localhost|\d+(?:\.\d+){3}|\[.*\])$/i.test(u.hostname) && u.hostname.includes('.')
  } catch { return false }
}
export function fechaDeportiva(valor) {
  return typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor) &&
    Number.isFinite(Date.parse(valor)) && new Date(valor).toISOString().slice(0, 10) === valor
}
const texto = z.string().trim().min(1).max(500)
const id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,149}$/)
const url = z.string().refine(validaUrlDeportiva, 'URL HTTPS pública no válida')
const fecha = z.string().refine(fechaDeportiva, 'Fecha no válida')
const instante = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/)
  .refine(v => fechaDeportiva(v.slice(0, 10)) && Number(v.slice(11, 13)) < 24 && Number(v.slice(14, 16)) < 60 && (!/^\d{2}$/.test(v.slice(17, 19)) || Number(v.slice(17, 19)) < 60) && Number.isFinite(Date.parse(v)), 'Hora sin zona o no válida')
const bloque = z.object({
  estado: z.enum(['actualizado', 'conservado', 'no_disponible']),
  consultado: instante, verificadoEn: instante.optional(), fuenteUrl: url, aviso: texto.optional(),
})
const resultadoSesion = z.object({
  id, nombre: texto, fuenteUrl: url, verificadoEn: instante,
  conservado: z.boolean().optional(),
  columnas: z.array(z.object({ clave: id, nombre: texto })).min(1).max(30),
  filas: z.array(z.object({ posicion: z.number().int().positive().max(10000).nullable(), nombre: texto, nombreBusqueda: texto.optional(),
    valores: z.record(id, z.union([z.string().max(100), z.number().finite()])) })).min(1).max(500),
}).refine(t => new Set(t.columnas.map(c => c.clave)).size === t.columnas.length &&
  t.filas.every(f => t.columnas.every(c => Object.hasOwn(f.valores, c.clave))), 'Resultado de sesión incompleto')
const evento = z.object({
  id, nombre: texto, inicio: instante.nullish(), fecha: fecha.nullish(), finFecha: fecha.nullish(),
  estado: z.enum(['programado', 'en_juego', 'finalizado', 'aplazado', 'cancelado', 'por_confirmar']),
  local: texto.optional(), visitante: texto.optional(),
  resultado: z.object({ local: z.number().int().min(0).max(1000), visitante: z.number().int().min(0).max(1000) }).nullish(),
  jornada: texto.optional(), lugar: texto.optional(), detalle: texto.optional(), fuenteUrl: url.optional(),
  resultados: z.array(resultadoSesion).max(10).optional(),
  emisiones: z.array(z.object({ nombre: texto, url, fuenteUrl: url, territorio: z.literal('España'), verificadoEn: instante })).max(20).optional(),
}).refine(v => !v.finFecha || (!!v.fecha && v.finFecha >= v.fecha), 'Rango de fechas invertido')
const tabla = z.object({
  id, nombre: texto,
  fuenteUrl: url.optional(), verificadoEn: instante.optional(), conservado: z.boolean().optional(),
  columnas: z.array(z.object({ clave: id, nombre: texto })).max(30),
  filas: z.array(z.object({ posicion: z.number().int().positive().max(10000).nullable(), nombre: texto, nombreBusqueda: texto.optional(),
    valores: z.record(id, z.union([z.string().max(100), z.number().finite()])) })).min(1).max(2000),
}).refine(t => new Set(t.columnas.map(c => c.clave)).size === t.columnas.length &&
  t.filas.every(f => t.columnas.every(c => Object.hasOwn(f.valores, c.clave))), 'Columnas o celdas incompletas')
const competicion = z.object({
  id, deporte: z.enum(['futbol', 'baloncesto', 'motor']), nombre: texto,
  temporada: texto, categoria: texto, zona: texto, genero: z.enum(['masculino', 'femenino', 'mixto']).optional(), grupo: texto.optional(),
  fuente: z.object({ nombre: texto, url }), comprobadoEn: instante,
  agenda: bloque.extend({ eventos: z.array(evento).max(20000) }),
  clasificacion: bloque.extend({ tablas: z.array(tabla).max(30), tablasPendientes: z.array(id).max(30).optional() }),
})
const resumen = competicion.omit({ agenda: true, clasificacion: true }).extend({
  agenda: bloque.extend({ total: z.number().int().nonnegative() }),
  clasificacion: bloque.extend({ total: z.number().int().nonnegative() }),
  participantes: z.array(texto).max(10000),
})
const indice = z.object({ version: z.literal(1), generado: instante, dias: z.array(fecha).min(1).max(50),
  competiciones: z.array(resumen).min(1).max(20000),
  incidencias: z.array(z.object({ deporte: z.enum(['futbol', 'baloncesto', 'motor']), nombre: texto, fuenteUrl: url, motivo: texto, id: id.optional() })).max(20000),
})
const eventoAgenda = evento.safeExtend({ competicionId: id, competicion: texto, deporte: z.enum(['futbol', 'baloncesto', 'motor']), temporada: texto,
  grupo: texto.optional(), verificadoEn: instante.optional(), conservado: z.boolean(),
  resultadosDisponibles: z.number().int().min(1).max(10).optional(),
})

export function validarIndiceDeportes(valor, ahora = Date.now()) {
  const dato = indice.parse(valor)
  if (new Set(dato.competiciones.map(c => c.id)).size !== dato.competiciones.length || new Set(dato.dias).size !== dato.dias.length) throw Error('Índice deportivo con duplicados')
  if (Date.parse(dato.generado) > ahora + 300000) throw Error('Índice generado en el futuro')
  for (const c of dato.competiciones) for (const b of [c.agenda, c.clasificacion]) {
    if (b.estado !== 'no_disponible' && !b.verificadoEn || b.estado === 'no_disponible' && b.total > 0) throw Error('Bloque resumido sin verificación')
    if ([b.consultado, b.verificadoEn, c.comprobadoEn].some(f => f && Date.parse(f) > ahora + 300000)) throw Error('Comprobación futura en el índice')
  }
  return dato
}
export function validarAgendaDeportes(valor, indice, dia, zona) {
  const eventos = z.object({ eventos: z.array(eventoAgenda).max(50000) }).parse(valor).eventos
  const competiciones = new Map(indice.competiciones.map(c => [c.id, c]))
  const ids = new Set()
  for (const e of eventos) {
    const c = competiciones.get(e.competicionId), clave = e.competicionId + ':' + e.id
    const comienzo = e.inicio ? diaDeporte(e.inicio, zona) : e.fecha, fin = e.inicio ? comienzo : e.finFecha || comienzo
    if (!c || c.temporada !== e.temporada || c.deporte !== e.deporte || c.nombre !== e.competicion || c.agenda.verificadoEn !== e.verificadoEn || c.agenda.estado === 'no_disponible' || e.conservado !== (c.agenda.estado === 'conservado')) throw Error('Agenda distinta del índice comprobado')
    if (!comienzo || dia < comienzo || dia > fin) throw Error('Evento publicado en un día incorrecto')
    if (ids.has(clave)) throw Error('Evento repetido en la agenda')
    ids.add(clave)
  }
  return eventos
}

export function validarCompeticionDeportiva(valor, ahora = Date.now()) {
  const c = competicion.parse(valor)
  for (const [b, elementos] of [[c.agenda, c.agenda.eventos], [c.clasificacion, c.clasificacion.tablas]]) {
    if (b.estado !== 'no_disponible' && !b.verificadoEn) throw Error(`${c.id}: falta la fecha real de verificación`)
    if (b.estado === 'no_disponible' && elementos.length) throw Error(`${c.id}: datos sin verificar`)
    if (b.verificadoEn && Date.parse(b.verificadoEn) > Date.parse(b.consultado) + 300000) throw Error(`${c.id}: verificación posterior a la consulta`)
    if (new Set(elementos.map(e => e.id)).size !== elementos.length) throw Error(`${c.id}: identificadores repetidos`)
  }
  const fechas = [c.comprobadoEn, c.agenda.consultado, c.agenda.verificadoEn, c.clasificacion.consultado, c.clasificacion.verificadoEn,
    ...c.clasificacion.tablas.map(t => t.verificadoEn),
    ...c.agenda.eventos.flatMap(e => [...(e.emisiones || []).map(em => em.verificadoEn), ...(e.resultados || []).map(t => t.verificadoEn)])]
  if (fechas.some(f => f && Date.parse(f) > ahora + 300000)) throw Error(`${c.id}: consulta fechada en el futuro`)
  for (const e of c.agenda.eventos) if (e.resultados && (new Set(e.resultados.map(t => t.id)).size !== e.resultados.length ||
    e.resultados.some(t => Date.parse(t.verificadoEn) > Date.parse(c.agenda.consultado) + 300000))) throw Error(`${c.id}: resultados de sesión incoherentes`)
  for (const t of c.clasificacion.tablas) if (!!t.verificadoEn !== !!t.fuenteUrl || t.conservado && !t.verificadoEn ||
    t.verificadoEn && Date.parse(t.verificadoEn) > Date.parse(c.clasificacion.consultado) + 300000) throw Error(`${c.id}: clasificación sin procedencia coherente`)
  return c
}

export function conservaCompeticionDeportiva(actual, anterior) {
  if (!anterior || anterior.id !== actual.id) return actual
  const sinIdentidadTemporal = actual.temporada === 'Por confirmar' && actual.agenda.estado === 'no_disponible' && actual.clasificacion.estado === 'no_disponible'
  if (!sinIdentidadTemporal && anterior.temporada !== actual.temporada) return actual
  const salida = { ...actual, temporada: sinIdentidadTemporal ? anterior.temporada : actual.temporada }
  for (const k of ['agenda', 'clasificacion']) {
    if (actual[k].estado === 'no_disponible' && anterior[k].verificadoEn) salida[k] = {
      ...anterior[k], estado: 'conservado', consultado: actual[k].consultado,
      aviso: 'No hemos podido actualizar este apartado. Mostramos la última copia comprobada, con su fecha original.',
    }
  }
  if (actual.agenda.estado !== 'no_disponible') {
    const previos = new Map(anterior.agenda.eventos.map(e => [e.id, e]))
    salida.agenda = { ...salida.agenda, eventos: salida.agenda.eventos.map(e => {
      const previo = previos.get(e.id)
      const dia = evento => evento?.inicio ? new Date(evento.inicio).toISOString().slice(0, 10) : evento?.fecha || null
      const futuro = e.inicio ? Date.parse(e.inicio) > Date.parse(actual.agenda.consultado) : e.fecha && e.fecha > actual.agenda.consultado.slice(0, 10)
      if (e.resultados !== undefined || !previo?.resultados?.length || previo.nombre !== e.nombre ||
        e.estado === 'cancelado' || e.estado === 'aplazado' || e.estado === 'programado' || futuro || dia(e) !== dia(previo)) return e
      return { ...e, resultados: previo.resultados.map(t => ({ ...t, conservado: true })) }
    }) }
  }
  if (actual.clasificacion.estado !== 'no_disponible' && actual.clasificacion.tablasPendientes?.length) {
    const presentes = new Set(salida.clasificacion.tablas.map(t => t.id))
    const pendientes = new Set(actual.clasificacion.tablasPendientes)
    const copias = anterior.clasificacion.tablas.filter(t => pendientes.has(t.id) && !presentes.has(t.id)).map(t => ({ ...t,
      verificadoEn: t.verificadoEn || anterior.clasificacion.verificadoEn,
      fuenteUrl: t.fuenteUrl || anterior.clasificacion.fuenteUrl, conservado: true,
    }))
    salida.clasificacion = { ...salida.clasificacion, tablas: [...salida.clasificacion.tablas, ...copias] }
  }
  return salida
}

// Solo lo ejecutan los robots. El servidor muestra sus copias ya verificadas;
// ninguna URL procedente de un visitante se utiliza para hacer peticiones.
export async function leerFuenteDeportiva(url, opciones = {}) {
  if (!validaUrlDeportiva(url)) throw Error('Fuente deportiva no válida')
  const respuesta = await (opciones.fetcher || fetch)(url, {
    signal: AbortSignal.timeout(30000),
    headers: { 'User-Agent': 'EspanaUtil/1.0 (+https://webapp-3ft.pages.dev/privacidad)', Accept: 'text/html,application/json;q=0.9,*/*;q=0.5' },
  })
  if (!respuesta.ok) throw Error(`Fuente HTTP ${respuesta.status}`)
  const limite = 12 * 1024 * 1024
  if (Number(respuesta.headers.get('content-length')) > limite) { await respuesta.body?.cancel(); throw Error('Fuente demasiado grande') }
  if (!respuesta.body) throw Error('Fuente vacía')
  const lector = respuesta.body.getReader()
  const decoder = new TextDecoder()
  let total = 0, texto = ''
  try {
    for (;;) {
      const { done, value } = await lector.read()
      if (done) break
      total += value.byteLength
      if (total > limite) { await lector.cancel(); throw Error('Fuente demasiado grande') }
      texto += decoder.decode(value, { stream: true })
    }
    texto += decoder.decode()
  } finally { lector.releaseLock() }
  if (!texto.trim()) throw Error('Fuente vacía')
  return texto
}
