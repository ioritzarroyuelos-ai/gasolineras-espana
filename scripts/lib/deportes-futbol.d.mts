import type { EventoDeportivo, OpcionesDeportes, ResultadoDeportes, TablaDeportiva } from './deportes.mjs'
export interface FichaFutsal { nombre: string; category: string; year: string; league: string; group: string; round: string; rounds: string[]; grupos: string[] }
export interface GrupoFFCV { codigo: string; nombre: string; ver_clasificacion: string }
export interface CategoriaFFCV { codigo: string; nombre: string; TipoJuego: string; nombre_grupo_categoria: string; visible_clasificacion: string; grupos: GrupoFFCV[] | null }
export interface EstadoFFCV {
  version: 1
  catalogo: { temporada: { cod_temporada: string; nombre: string }; categorias: CategoriaFFCV[]; verificadoEn: string; completo: boolean } | null
  cursor: number
  ultimoExito: string | null
  noConsultarAntes: string | null
  ventana: { desde: string | null; peticiones: number }
  verificados: Record<string, string>
}
export interface OpcionesFutbol extends OpcionesDeportes { estadoFFCV?: unknown; guardarEstadoFFCV?: (estado: EstadoFFCV) => void | Promise<void>; relojFFCV?: () => number; duermeFFCV?: (ms: number) => Promise<void> }
export function creaEstadoFFCV(categorias: unknown[], temporada: { cod_temporada: string; nombre: string }, verificadoEn: string): EstadoFFCV
export function normalizaEstadoFFCV(estado: unknown): EstadoFFCV
export function generoFFCV(categoria: { nombre?: string; nombre_grupo_categoria?: string }): 'masculino' | 'femenino' | 'mixto' | undefined
export function obtieneFFCV(opciones?: OpcionesFutbol): Promise<ResultadoDeportes>
export function obtieneFutbol(opciones?: OpcionesFutbol): Promise<ResultadoDeportes>
export function parseaAgendaLaLiga(html: string, esperada: string, fuenteUrl: string, verificadoEn: string): { temporada: string; eventos: EventoDeportivo[]; jornadas: Array<{ week: number; name: string }>; jornada: number }
export function parseaClasificacionLaLiga(html: string, esperada: string): { temporada: string; tablas: TablaDeportiva[] }
export function fechaMadrid(fecha: string, hora: string): string | null
export function descubreFutsal(html: string): Array<{ slug: string; year: number; grupo: string; url: string }>
export function parseaFichaFutsal(html: string, esperada: { year: number; grupo: string }): FichaFutsal
export function parseaAgendaFutsal(valor: unknown, ficha: FichaFutsal, fuenteUrl: string, verificadoEn: string): EventoDeportivo[]
export function parseaClasificacionFutsal(html: string, nombre: string): TablaDeportiva[]
export function descubreCatalogoRFEF(html: string): Array<{ id: string; nombre: string; categoria: string; temporada: string }>
export function eligeJornadasFFCV(jornadas: Array<{ codjornada: string; fecha_jornada: string }>, ahora?: number): Array<{ codjornada: string; fecha_jornada: string; fechaISO: string }>
export function parseaAgendaFFCV(datos: unknown, jornada: string, fuenteUrl: string): EventoDeportivo[]
export function parseaClasificacionFFCV(datos: unknown, competicion: string, grupo: string): TablaDeportiva[]
export function parseaAgendaRFEF(html: string, competicion: { nombre: string; temporada: string }, grupo: string, fuenteUrl: string): EventoDeportivo[]
