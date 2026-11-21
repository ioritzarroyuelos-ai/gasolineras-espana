export const APARCAMIENTOS_MAPA: Array<{ id: string; ciudad: string; nombre: string; municipio: string; maxAge: number; maxItems: number; bounds: number[]; fuenteUrl: string; licenciaUrl: string; atribucion: string }>
export function fuenteAparcamiento(categoria: string): typeof APARCAMIENTOS_MAPA[number] | undefined
export function formateaHorarioAparcamiento(value: unknown): string
export function coordenadasAparcamiento(p: unknown, fuente: typeof APARCAMIENTOS_MAPA[number]): boolean
export function preparaParteAparcamientos(data: unknown, ciudad: string, inicioWall: number, inicioMono: number): any
export function aparcamientoActual(item: unknown, failed?: boolean, nowWall?: number, nowMono?: number): boolean
