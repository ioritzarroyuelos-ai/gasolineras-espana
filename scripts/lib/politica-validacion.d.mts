export interface DiagnosticoValidacion {
  sondeos: number
  anteriores: number
  anomalias: number
  caida?: number
}

export interface ResultadoValidacion {
  ok: boolean
  motivo?: string
  revision: boolean
  diagnostico: DiagnosticoValidacion
}

export function validaEleccion(nuevo: any, anterior: any | null, opts?: { enVeda?: boolean }): ResultadoValidacion
