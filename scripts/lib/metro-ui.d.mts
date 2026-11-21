export function metroParteActual(data: unknown, now?: number): boolean
export function ahoraParteMetro(evaluadoEn: string, inicioMono: number, nowWall?: number, nowMono?: number): number
export function metroLlegadasActuales<T extends { llegada: string }>(station: { llegadas: T[] }, data: unknown, now?: number): T[]
export function validaParteMetro(data: unknown, now?: number): boolean
