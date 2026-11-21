import type { DisponibilidadFuente, DisponibilidadObjetivo } from './disponibilidad.mjs'
export interface DisponibilidadConsulta { fuente: DisponibilidadFuente; lugarId: string; objetivo: DisponibilidadObjetivo }
export interface DisponibilidadFicha { id: string; nombre: string; fuente: DisponibilidadFuente; objetivo: DisponibilidadObjetivo; lat: number|null; lon: number|null; cantidad: number|null; fechaDato: string|null; caduca: string|null; estado: 'actual'|'sin_confirmar'; fuenteUrl: string; enlace: string }
export type DisponibilidadFuenteErrorCodigo = 'solicitud_invalida'|'fuente_no_disponible'|'respuesta_invalida'|'lugar_no_encontrado'
export class DisponibilidadFuenteError extends Error { readonly codigo: DisponibilidadFuenteErrorCodigo; constructor(codigo: DisponibilidadFuenteErrorCodigo) }
export function cargaDisponibilidad(input: DisponibilidadConsulta, io?: { fetch?: typeof fetch; now?: number|(()=>number); timeoutMs?: number }): Promise<DisponibilidadFicha>
