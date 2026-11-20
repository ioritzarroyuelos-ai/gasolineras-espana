import type { Candidatura, Sondeo } from '../../src/lib/politica-schemas'
export function urlSeguimientoPdf(valor: string): string | null
export function tablaSeguimientoPdf(texto: string, candidato: Sondeo, hoy: string): {candidaturas:Candidatura[]; sondeo:Sondeo}
export function fetchSeguimientoPdf(candidatos: readonly Sondeo[], opciones: {
  hoy:string; userAgent:string; fetchImpl?:typeof fetch;
  extraer?:(url:string, fetchImpl:typeof fetch, userAgent:string)=>Promise<string>
}): Promise<{sondeos:Sondeo[]; candidaturas:Candidatura[]; fallos:string[]}>
