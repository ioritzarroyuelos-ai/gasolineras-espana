import type { Guardia } from './guardias'
import { fechaHoraLocal, instanteLocal } from '../../scripts/lib/fechas.mjs'

const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const desconocida = { conocida: false, abierta: false, todoElDia: false }
type Tramo = [string, string]

function normaliza(s: string) { return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '') }

export function tipoAtencionGuardia(g: Guardia): 'guardia' | 'apertura' | 'localizada' | 'sin_confirmar' {
  const texto = normaliza(g.horario + ' ' + g.horarioDesc)
  if (/localizad[ao]|no presencial|puerta cerrada|previo aviso|previa llamada/.test(texto)) return 'localizada'
  if (g.territorio === 'laspalmas' && !g.horarioDesc && !iso.test(g.horario)) return 'sin_confirmar'
  if (g.territorio === 'huesca' && !/farmacia de guardia/.test(texto)) return 'sin_confirmar'
  if (g.territorio === 'palencia' && !g.fechaTurno) return 'sin_confirmar'
  if (/rotacion|por confirmar|confirmar horario/.test(texto)) return 'sin_confirmar'
  if (['tenerife', 'valencia', 'caceres'].includes(g.territorio || '')) return 'apertura'
  return 'guardia'
}

function fechaValida(fecha: string) {
  const d = new Date(fecha + 'T12:00:00Z')
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) && Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === fecha
}

function desplaza(fecha: string, dias: number) {
  return new Date(Date.parse(fecha + 'T12:00:00Z') + dias * 86400000).toISOString().slice(0, 10)
}

function hora(valor: string) {
  const [h, m = '00'] = valor.split(':')
  return h.padStart(2, '0') + ':' + m
}

function tramo(fecha: string, inicio: string, fin: string, siguiente = false): Tramo | null {
  if (!fechaValida(fecha)) return null
  const a = hora(inicio), b = hora(fin)
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(a) || !/^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(b)) return null
  if (a === b && !siguiente) return null
  return [fecha + ' ' + a, (b === '24:00' || siguiente || b < a ? desplaza(fecha, 1) : fecha) + ' ' + (b === '24:00' ? '00:00' : b)]
}

function horasSimples(texto: string, fecha: string): Tramo[] {
  // Cada fragmento ha de encajar entero; un festivo, una excepción o una segunda
  // hora incompleta se conservan como texto y se excluyen de los filtros.
  const tramos: Tramo[] = []
  for (const parte of texto.split(/\s*(?:,|;|\sy\s)\s*/i)) {
    const m = /^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(parte)
    const t = m && tramo(fecha, m[1], m[2])
    if (!t) return []
    tramos.push(t)
  }
  return tramos
}

function tramosTenerife(g: Guardia, ahora: Date, zona: string) {
  const hoy = fechaHoraLocal(ahora, zona).slice(0, 10)
  // La consulta «open/now» corresponde a su día local; no extrapolar una
  // semana corriente a los festivos o al día posterior al de la consulta.
  const ayer = desplaza(hoy, -1)
  if (hoy !== g.fechaTurno && ayer !== g.fechaTurno) return { texto: 'Horario de hoy por confirmar', tramos: [] }
  const nombre = (fecha: string) => dias[new Date(fecha + 'T12:00:00Z').getUTCDay()]
  const lineas = g.horario.split(/\r?\n/)
  const tramos: Tramo[] = [], etiquetas: string[] = []
  let completoHoy = false
  const esDia = (linea: string, fecha: string) => normaliza(linea.split(':')[0].trim()) === normaliza(nombre(fecha))
  for (const fecha of hoy === g.fechaTurno ? [ayer, hoy] : [ayer]) {
    // El colegio publica desde ayer hasta el mismo día de la semana siguiente.
    // El primer jueves puede continuar el viernes; el último jueves es futuro.
    const indiceHoy = lineas.findIndex(l => esDia(l, hoy))
    const candidatas = fecha === ayer && indiceHoy > 0 ? lineas.slice(0, indiceHoy) : lineas
    const filas = candidatas.filter(l => esDia(l, fecha))
    if (filas.length !== 1) continue
    const fila = filas[0]
    // Las copias antiguas recortaban a 100 caracteres, incluso a mitad de tramo.
    if (g.horarioCompleto === false && fila === lineas[lineas.length - 1]) continue
    const valor = fila.slice(fila.indexOf(':') + 1).trim()
    const partes: Tramo[] = []
    for (const p of normaliza(valor).split(/\s+y\s+/)) {
      const m = /^desde las (\d{1,2}:\d{2}) hasta las (\d{1,2}:\d{2})(?: del ([a-z]+))?\.?$/.exec(p)
      if (!m || (m[3] && m[3] !== normaliza(nombre(desplaza(fecha, 1))))) break
      const t = tramo(fecha, m[1], m[2], !!m[3])
      if (!t) break
      partes.push(t)
    }
    if (!partes.length || partes.length !== valor.split(/\s+y\s+/i).length) {
      if (fecha === hoy) etiquetas.push('Horario de ' + nombre(hoy) + ' por confirmar')
      continue
    }
    if (fecha === hoy) {
      completoHoy = true
      etiquetas.push(nombre(hoy) + ': ' + valor)
      tramos.push(...partes)
    } else {
      const continuidad = partes.find(t => t[1].slice(0, 10) === hoy && fechaHoraLocal(ahora, zona) < t[1])
      if (continuidad) {
        tramos.push(continuidad)
        etiquetas.push('Turno del ' + nombre(fecha) + ' hasta las ' + continuidad[1].slice(-5))
      }
    }
  }
  if (!completoHoy && !etiquetas.length) etiquetas.push('Horario de hoy por confirmar')
  return { texto: etiquetas.join(' · '), tramos }
}

const iso = /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*-\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2})$/
function datosHorario(g: Guardia, ahora: Date, zona: string): { texto: string; tramos: Tramo[] } {
  const h = g.horario.trim()
  if (g.territorio === 'tenerife' && /(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo):/i.test(h)) return tramosTenerife(g, ahora, zona)
  if (iso.test(h.split(' / ')[0])) {
    const tramos: Tramo[] = [], etiquetas: string[] = []
    for (const parte of h.split(' / ')) {
      const m = iso.exec(parte)
      if (!m || m[2] <= m[1]) return { texto: 'Horario por confirmar: llama antes de acudir', tramos: [] }
      const diaMes = (s: string) => s.slice(0, 10).split('-').reverse().join('/')
      etiquetas.push(diaMes(m[1]) + ' de ' + m[1].slice(-5) + ' a ' + m[2].slice(-5) + (m[1].slice(0, 10) === m[2].slice(0, 10) ? '' : ' del ' + diaMes(m[2])))
      tramos.push([m[1], m[2]])
    }
    return { texto: etiquetas.join(' · '), tramos }
  }
  const conFecha = /^(\d{2})\/(\d{2})\/(\d{4}) de (\d{1,2}(?::\d{2})?)\s*(?:h\.?|mañana)?\s*a (\d{1,2}(?::\d{2})?)\s*(?:h\.?)?\s*(del día siguiente)?\.?$/i.exec(h)
  if (conFecha) {
    const [, dia, mes, anio, a, b, siguiente] = conFecha
    const t = tramo([anio, mes, dia].join('-'), a, b, !!siguiente)
    return { texto: h, tramos: t ? [t] : [] }
  }
  // Teruel usaba antiguamente un texto «24 horas» de relleno.
  if (g.territorio === 'teruel' && !g.fechaTurno && /24\s*horas/i.test(h)) return { texto: 'Horario por confirmar: llama antes de acudir', tramos: [] }
  if (/^(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.test(h)) {
    const [a, b] = h.split(/\s*[-–]\s*/)
    if (hora(a) === hora(b)) return { texto: h + ' · Fin del turno por confirmar', tramos: [] }
  }
  const simple = h.replace(/ \(incluye horario de urgencias\)$/i, '')
  return { texto: h, tramos: g.fechaTurno ? horasSimples(simple, g.fechaTurno) : [] }
}

export function textoHorarioGuardia(g: Guardia, _actualizado?: string, ahora = new Date(), zona = 'Europe/Madrid'): string {
  const { texto } = datosHorario(g, ahora, zona)
  // «Quedan 6 horas» describe la hora de descarga, no la de la visita.
  const isoHoras = iso.exec(g.horario)
  const notaMadrid = /^Guardia de hoy (\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})$/i.exec(g.horarioDesc.trim())
  const repetida = isoHoras && notaMadrid && isoHoras[1].endsWith(notaMadrid[1]) && isoHoras[2].endsWith(notaMadrid[2])
  const nota = repetida || /^(?:quedan?\s+\d+|abierta$)/i.test(g.horarioDesc) ? '' : g.horarioDesc.trim()
  return [...new Set([texto, nota].filter(Boolean))].join(' · ') || 'Horario por confirmar: llama antes de acudir'
}

export function estadoHorarioGuardia(g: Guardia, ahora: Date, zona: string) {
  const tipo = tipoAtencionGuardia(g)
  if (tipo === 'localizada' || tipo === 'sin_confirmar') return desconocida
  const { tramos } = datosHorario(g, ahora, zona)
  if (!tramos.length) return desconocida
  const unidos: Tramo[] = []
  for (const [a, b] of tramos.sort((l, r) => l[0].localeCompare(r[0]))) {
    const ultimo = unidos[unidos.length - 1]
    if (ultimo && ultimo[1] >= a) { if (b > ultimo[1]) ultimo[1] = b }
    else unidos.push([a, b])
  }
  for (const [a, b] of unidos) {
    const inicio = instanteLocal(a, zona), fin = instanteLocal(b, zona)
    if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return desconocida
    if (ahora.getTime() >= inicio && ahora.getTime() < fin) {
      // Un día de reloj local también puede durar 23 o 25 horas reales.
      const diaCompleto = Date.parse(b.replace(' ', 'T') + 'Z') - Date.parse(a.replace(' ', 'T') + 'Z') >= 86400000
      return { conocida: true, abierta: true, todoElDia: diaCompleto }
    }
  }
  return { conocida: true, abierta: false, todoElDia: false }
}
