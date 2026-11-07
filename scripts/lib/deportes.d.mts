export type Deporte = 'futbol' | 'baloncesto' | 'motor'
export interface FuenteDeportiva { nombre: string; url: string }
export interface EmisionDeportiva { nombre: string; url: string; fuenteUrl: string; territorio: 'España'; verificadoEn: string }
export interface EventoDeportivo {
  id: string
  nombre: string
  inicio?: string | null
  fecha?: string | null
  finFecha?: string | null
  estado: 'programado' | 'en_juego' | 'finalizado' | 'aplazado' | 'cancelado' | 'por_confirmar'
  local?: string
  visitante?: string
  resultado?: { local: number; visitante: number } | null
  jornada?: string
  lugar?: string
  detalle?: string
  fuenteUrl?: string
  emisiones?: EmisionDeportiva[]
  resultados?: ResultadoSesionDeportiva[]
}
export interface ResultadoSesionDeportiva {
  id: string
  nombre: string
  fuenteUrl: string
  verificadoEn: string
  conservado?: boolean
  columnas: Array<{ clave: string; nombre: string }>
  filas: Array<{ posicion: number | null; nombre: string; nombreBusqueda?: string; valores: Record<string, string | number> }>
}
export interface TablaDeportiva {
  id: string
  nombre: string
  fuenteUrl?: string
  verificadoEn?: string
  conservado?: boolean
  columnas: Array<{ clave: string; nombre: string }>
  filas: Array<{ posicion: number | null; nombre: string; nombreBusqueda?: string; valores: Record<string, string | number> }>
}
export interface BloqueDeportivo {
  estado: 'actualizado' | 'conservado' | 'no_disponible'
  consultado: string
  verificadoEn?: string
  fuenteUrl: string
  aviso?: string
}
export interface CompeticionDeportiva {
  id: string
  deporte: Deporte
  nombre: string
  temporada: string
  categoria: string
  zona: string
  genero?: 'masculino' | 'femenino' | 'mixto'
  grupo?: string
  fuente: FuenteDeportiva
  comprobadoEn: string
  agenda: BloqueDeportivo & { eventos: EventoDeportivo[] }
  clasificacion: BloqueDeportivo & { tablas: TablaDeportiva[]; tablasPendientes?: string[] }
}
export interface IncidenciaDeportes { deporte: Deporte; nombre: string; fuenteUrl: string; motivo: string; id?: string }
export interface SeguimientoGruposDeportes { conocidos: string[]; revisados: string[] }
export interface ResultadoDeportes { competiciones: CompeticionDeportiva[]; incidencias: IncidenciaDeportes[]; seguimientoGrupos?: SeguimientoGruposDeportes }
export interface OpcionesDeportes { fetcher?: typeof fetch; ahora?: number; log?: (mensaje: string) => void }
export function validarCompeticionDeportiva(valor: unknown, ahora?: number): CompeticionDeportiva
export function conservaCompeticionDeportiva(actual: CompeticionDeportiva, anterior?: CompeticionDeportiva): CompeticionDeportiva
export function validaUrlDeportiva(valor: unknown): boolean
export function fechaDeportiva(valor: unknown): boolean
export function leerFuenteDeportiva(url: string, opciones?: OpcionesDeportes): Promise<string>
export function validarIndiceDeportes(valor: unknown, ahora?: number): import('../../src/lib/deportes').IndiceDeportes
export function validarAgendaDeportes(valor: unknown, indice: import('../../src/lib/deportes').IndiceDeportes, dia: string, zona: string): import('../../src/lib/deportes').EventoAgenda[]

