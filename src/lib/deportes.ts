import type { Deporte, CompeticionDeportiva, EventoDeportivo, BloqueDeportivo, IncidenciaDeportes } from '../../scripts/lib/deportes.mjs'
import { diaDeporte, ZONAS_DEPORTES } from '../../scripts/lib/deportes-indice.mjs'
export type { Deporte, CompeticionDeportiva, EventoDeportivo, BloqueDeportivo }
export type ResumenCompeticion = Omit<CompeticionDeportiva, 'agenda' | 'clasificacion'> & {
  agenda: BloqueDeportivo & { total: number }; clasificacion: BloqueDeportivo & { total: number }; participantes: string[]
}
export type EventoAgenda = EventoDeportivo & { competicionId: string; competicion: string; deporte: Deporte; temporada: string; grupo?: string; verificadoEn?: string; conservado: boolean; resultadosDisponibles?: number }
export interface IndiceDeportes { version: 1; generado: string; dias: string[]; competiciones: ResumenCompeticion[]; incidencias: IncidenciaDeportes[] }
export const NOMBRES_DEPORTES: Record<Deporte, string> = { futbol: 'Fútbol', baloncesto: 'Baloncesto', motor: 'Motor' }
export const esDeporte = (s: string): s is Deporte => Object.hasOwn(NOMBRES_DEPORTES, s)
export const idDeportivo = (s: string): boolean => /^[a-z0-9][a-z0-9_-]{0,149}$/.test(s)
export { diaDeporte }
export const normalizaDeporte = (s: string): string => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const ALIAS_COMPETICIONES: Record<string, string[]> = {
  'laliga-easports': ['La Liga', 'LaLiga', 'Primera División'],
  'laliga-hypermotion': ['La Liga', 'LaLiga', 'Segunda División'],
  'futbol-femenino': ['Liga F', 'Primera División femenina'],
  'acb-liga-endesa': ['ACB', 'Liga ACB'],
  'formula-1': ['F1', 'Formula1'],
  'formula-2': ['F2', 'Formula2'],
  'formula-3': ['F3', 'Formula3'],
  'formula-4-espana': ['F4', 'Formula4'],
  'f1-academy': ['F1 Academy'],
  'formula-regional-european': ['FREC'],
}
// El nombre oficial no siempre coincide con el que utiliza quien busca.
// Se comparte con la agenda para que «ACB» encuentre también sus partidos.
export function textoBusquedaCompeticion(c: ResumenCompeticion, incluirParticipantes = true): string {
  return normalizaDeporte([c.nombre, c.grupo, c.temporada, c.categoria, c.zona, c.fuente.nombre,
    c.id.replace(/[-_]+/g, ' '), ...(ALIAS_COMPETICIONES[c.id] || []), ...(incluirParticipantes ? c.participantes : []),
  ].join(' '))
}
export function filtraCompeticiones(competiciones: ResumenCompeticion[], filtros: { deporte?: Deporte; q?: string; zona?: string; categoria?: string; genero?: string }) {
  const q = normalizaDeporte(filtros.q || '')
  return competiciones.filter(c => (c.agenda.verificadoEn || c.clasificacion.verificadoEn) && (!filtros.deporte || c.deporte === filtros.deporte) &&
    (!filtros.zona || c.zona === filtros.zona) && (!filtros.categoria || c.categoria === filtros.categoria) && (!filtros.genero || c.genero === filtros.genero) &&
    (!q || textoBusquedaCompeticion(c).includes(q)))
}
export function horaDeporte(inicio: string, zona = 'madrid'): string {
  return new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: ZONAS_DEPORTES[zona] || ZONAS_DEPORTES.madrid }).format(new Date(inicio))
}
export function fechaConsultaDeporte(fecha?: string, zona = 'madrid'): string {
  if (!fecha || !Number.isFinite(Date.parse(fecha))) return 'Sin comprobación disponible'
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: ZONAS_DEPORTES[zona] || ZONAS_DEPORTES.madrid }).format(new Date(fecha))
}
export function etiquetaEstadoDeporte(e: EventoDeportivo, verificadoEn?: string, zona = 'madrid'): string {
  if (e.estado === 'en_juego') return 'En juego al consultar' + (verificadoEn ? ' · ' + fechaConsultaDeporte(verificadoEn, zona) : '')
  return ({ programado: 'Programado', finalizado: 'Finalizado', aplazado: 'Aplazado', cancelado: 'Cancelado', por_confirmar: 'Por confirmar' })[e.estado]
}
export function bloqueAtrasado(b: { estado?: string; verificadoEn?: string }, ahora = Date.now()): boolean {
  return b.estado === 'conservado' || !b.verificadoEn || ahora - Date.parse(b.verificadoEn) > 24 * 3600000
}
