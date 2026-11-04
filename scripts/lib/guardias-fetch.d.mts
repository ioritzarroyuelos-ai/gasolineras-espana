export function fechaMadrid(date?: Date): string
export function desplazaFecha(fecha: string, dias: number): string
export function rangoGuardia(fecha: string, desde: string, hasta: string): string
export function texto(value: unknown): string
export function coordenadas(lat: unknown, lng: unknown, bbox: number[]): number[]
export function descargarJSON(url: string, options?: RequestInit): Promise<unknown>
