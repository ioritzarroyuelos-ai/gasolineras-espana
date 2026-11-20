import type { EstacionFuente } from './itv-fuentes.mjs'
interface PerfilOperador {
  url: string
  nombre: string
  consultado: string
  ultimoExito?: string
  estado: 'actualizada' | 'conservada'
  via?: 'directa' | 'respaldo'
  error?: string
  detalles?: Partial<EstacionFuente>
  registro?: string
}
export function actualizaOperadoresItv(estaciones:EstacionFuente[],anteriores?:Record<string,PerfilOperador>,opciones?:{ahora?:number;fetcher?:typeof fetch}):Promise<{estaciones:EstacionFuente[];perfiles:Record<string,PerfilOperador>}>
