import type { GuardiasFile } from '../../src/lib/guardias'
export const registroOficinasRioja: string
export function corrigeZonaCervera(fichero: GuardiasFile): GuardiasFile
export function municipioOficinaRioja(direccion: string, oficinas: Array<{ DENOMINACION: string; DESC_POBLACION: string; VIA: string; NUMERO_VIA: string }>, zona: string): string | null
export function anotaDestinoRioja(avisos: Record<string, string[]>, zona: string, direccion: string, municipio: string | null, horario?: string): void
