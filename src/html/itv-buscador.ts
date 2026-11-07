import { buscadorMunicipios, resultadosMunicipios } from './buscador-municipios'
import type { ResultadoTiempo } from '../lib/tiempo-municipios'
export { CSS_BUSCADOR_MUNICIPIOS as CSS_BUSCADOR_ITV } from './buscador-municipios'

export function buscadorItv(nonce: string, consulta = ''): string {
  return buscadorMunicipios(nonce, consulta, '/itv')
}
export function resultadosItv(consulta: string, resultados: ResultadoTiempo[]): string {
  return resultadosMunicipios(consulta, resultados, '/itv')
}
