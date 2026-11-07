import { createHash } from 'node:crypto'
import { normalizaEstadoNovanet } from './deportes-novanet-estado.mjs'

const HORA = 3600000
function origen(entrada) {
  const u = new URL(typeof entrada === 'string' || entrada instanceof URL ? entrada : entrada.url)
  if (!['https:', 'http:'].includes(u.protocol)) throw Error('Origen de motor no válido')
  return u.origin
}

/** Clave estable de metadatos públicos; nunca se guardan rutas, cabeceras ni credenciales. */
export function clavePausaMotor(entrada) {
  return 'motor-pausa-' + createHash('sha256').update(origen(entrada)).digest('hex').slice(0, 32)
}

function esperaSolicitada(valor, ahora) {
  const v = valor?.trim() || ''
  const esFechaHttp = /^(?:[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]+, \d{2}-[A-Za-z]{3}-\d{2} \d{2}:\d{2}:\d{2} GMT|[A-Za-z]{3} [A-Za-z]{3} [ \d]\d \d{2}:\d{2}:\d{2} \d{4})$/.test(v)
  const fecha = /^\d+$/.test(v) ? ahora + Number(v) * 1000 : esFechaHttp ? Date.parse(v) : NaN
  return Number.isFinite(fecha) && Math.abs(fecha) <= 8640000000000000 ? Math.max(ahora + HORA, fecha) : null
}

export function creaFetchMotorConPausas(opciones = {}) {
  const fetcher = opciones.fetcher || fetch, reloj = opciones.reloj || Date.now
  const estados = new Map(), bloqueados = new Map(), escrituras = new Map()
  function estadoDe(origin) {
    const id = clavePausaMotor(origin)
    if (!estados.has(id)) estados.set(id, normalizaEstadoNovanet(opciones.estadoNovanet?.[id]))
    return { id, estado: estados.get(id) }
  }
  async function guardaPausa(origin, hasta) {
    const { id } = estadoDe(origin)
    // Serializar las escrituras impide que respuestas simultáneas acorten una pausa mayor.
    const escritura = (escrituras.get(id) || Promise.resolve()).then(async () => {
      const previo = estados.get(id), pausa = Math.max(Date.parse(previo.noConsultarAntes || '') || 0, hasta)
      const limpio = normalizaEstadoNovanet({ ...previo, noConsultarAntes: new Date(pausa).toISOString() })
      estados.set(id, limpio)
      if (opciones.estadoNovanet) opciones.estadoNovanet[id] = limpio
      await opciones.guardarEstadoNovanet?.(id, limpio)
    })
    escrituras.set(id, escritura)
    await escritura
  }
  return async (entrada, init) => {
    const origin = origen(entrada), { estado } = estadoDe(origin)
    if (estado.noConsultarAntes && reloj() < Date.parse(estado.noConsultarAntes)) throw Error('La fuente de motor pide esperar hasta ' + estado.noConsultarAntes)
    if (bloqueados.has(origin)) throw Error('Fuente de motor HTTP ' + bloqueados.get(origin) + ': consultas detenidas durante esta actualización')
    const respuesta = await fetcher(entrada, init)
    const espera = [429, 503].includes(respuesta.status) ? esperaSolicitada(respuesta.headers.get('Retry-After'), reloj()) : null
    if ([401, 403, 429].includes(respuesta.status) || respuesta.status === 503 && espera !== null) {
      // Detener también el origen final cuando fetch sigue una redirección normal.
      const afectados = new Set([origin])
      if (respuesta.url) afectados.add(origen(respuesta.url))
      for (const actual of afectados) bloqueados.set(actual, respuesta.status)
      if (respuesta.status === 429 || respuesta.status === 503) {
        const hasta = espera ?? reloj() + HORA
        await Promise.all([...afectados].map(actual => guardaPausa(actual, hasta)))
      }
    }
    return respuesta
  }
}
