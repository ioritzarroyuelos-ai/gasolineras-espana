import type { EventoDeportivo, ResultadoSesionDeportiva, TablaDeportiva } from './deportes.mjs'
export function interpretaResultadoFormula(datos: Record<string, unknown>, esperada: Record<string, unknown>, fuenteUrl: string, verificadoEn: string): ResultadoSesionDeportiva
export function configuracionPublicaFormula(html: string, marca: string): { base: string; headers: Record<string, string> }
export function urlResultadoFormula(config: { base: string }, sesion: Record<string, unknown>, marca: string): string
export function interpretaResultadoF1Html(html: string, tituloEsperado: string, fuenteUrl: string, verificadoEn: string): ResultadoSesionDeportiva
export function interpretaResultadosAcademy(html: string, eventos: EventoDeportivo[], ano: number, verificadoEn: string, ahora: number): Map<string, ResultadoSesionDeportiva[]>
export function interpretaEquiposFormula(html: string, tipo: string, ano: number): TablaDeportiva
export function interpretaEquiposAcademy(html: string, ano: number): TablaDeportiva
export function interpretaRondaEspanaMotor(html: string, ronda: EventoDeportivo, ano: number, verificadoEn: string, ahora: number): EventoDeportivo[]
