export interface EstadoNovanet {
  version: 1
  catalogo: { temporada: { codigo: string; nombre: string }; verificadoEn: string; categorias: Array<{ codigo: string; nombre: string; familia: string; grupos: Array<{ codigo: string; nombre: string }> | null }> } | null
  categoria: number
  grupo: number
  ultimoExito: string | null
  noConsultarAntes: string | null
  ventana: { desde: string | null; peticiones: number }
  verificados: Record<string, string>
  completos: Record<string, string>
  descubrimientoGes?: {
    fuenteUrl: string
    iniciadoEn: string
    temporada: { codigo: string; nombre: string } | null
    pendientes: Array<{ tipo: 'raiz' | 'competicion'; ruta: string; delegacion?: string; competicion?: string }>
    categorias: Array<{ codigo: string; nombre: string; familia: string; grupos: Array<{ codigo: string; nombre: string }> | null }>
    categoria: number
    grupo: number
  }
}
export function normalizaEstadoNovanet(valor: unknown): EstadoNovanet
export function parseaPausasPortales(valor?: string): Record<string, string>
export function recuperaEstadoNovanet(candidatos: unknown[]): EstadoNovanet
export function checkpointNovanet(estado: unknown, ahora?: number): EstadoNovanet & { guardadoEn: string }
