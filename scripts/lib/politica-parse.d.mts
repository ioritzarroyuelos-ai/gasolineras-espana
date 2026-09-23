export type EscanosEstim = number | { min: number; max: number } | null

export interface SondeoParseado {
  empresa: string
  comitente?: string
  fechaTexto: string
  campoInicio?: string
  campoFin?: string
  muestra?: number
  datos: { candidaturaId: string; pct: number | null; escanos: EscanosEstim }[]
}

export interface ReferenciaParseada {
  texto: string
  anio: string | null
  escanos: { candidaturaId: string; escanos: number }[]
}

export interface ResultadoParse {
  tablasCoincidentes: number
  candidaturas: { id: string; nombre: string; siglas: string }[]
  sondeos: SondeoParseado[]
  referencia: ReferenciaParseada | null
  incidencias: string[]
  filas: { candidatas: number; aceptadas: number; rechazadas: number }
}

export function parsePct(text: string): number | null
export function parseEscanos(raw: string): EscanosEstim
export function parseFecha(text: string, anioContexto?: number): { texto: string; inicio?: string; fin?: string }
export function parseSondeos(
  html: string,
  opts?: { anioReferencia?: number; hoy?: { anio: number; mes: number } },
): ResultadoParse
