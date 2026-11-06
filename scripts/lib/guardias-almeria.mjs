import { consultaBuscadorGuardias } from './guardias-vcomm.mjs'

export const ALMERIA_SOURCE = 'https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on'
export function consultaAlmeria(fecha, readers) {
  return consultaBuscadorGuardias(ALMERIA_SOURCE, fecha, readers)
}
