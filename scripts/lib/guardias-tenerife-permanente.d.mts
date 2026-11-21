export type CeldaTenerife = { x: number; y: number; texto: string }
export type TurnoTenerife = { nombre: string; direccion: string; telefono: string; horario: string; nota: string }
export function guardiaPermanenteSantaCruz(paginas: CeldaTenerife[][], fecha: string, directorio?: unknown[]): TurnoTenerife[]
