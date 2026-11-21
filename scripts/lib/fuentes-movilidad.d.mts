export interface FuenteMovilidad {
  id: string; nombre: string; consultado: string; fechaDatos: string | null
  estado: 'actual' | 'parcial' | 'sin_actualizar' | 'error'; total: number | null; error?: string
}
export function compruebaFuentesMovilidad(loaders: Record<'bizi-zaragoza' | 'trafico-cataluna' | 'camaras-cataluna' | 'metro-bilbao', () => Promise<{ estado: string; fechaDatos?: string; fechaDirectorio?: string; total: number }>>, now?: number): Promise<{ schema: 1; consultado: string; correcto: boolean; fuentes: FuenteMovilidad[] }>
