import { buscadorMunicipios, resultadosMunicipios } from './buscador-municipios'
import type { ResultadoTiempo } from '../lib/tiempo-municipios'
export { CSS_BUSCADOR_MUNICIPIOS as CSS_BUSCADOR_TIEMPO } from './buscador-municipios'

export function buscadorTiempo(nonce: string, consulta = ''): string {
  return buscadorMunicipios(nonce, consulta, '/tiempo')
}
export function resultadosTiempo(consulta: string, resultados: ResultadoTiempo[]): string {
  return resultadosMunicipios(consulta, resultados, '/tiempo')
}
