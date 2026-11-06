type Pagina = Array<{ x: number; y: number; texto: string }>
export type TurnoSevilla = [number, number, string, string, string, string, string, string]
export function guardiasCapitalSevilla(paginas: Pagina[], fecha: string): TurnoSevilla[]
export function guardiasMunicipioSevilla(paginas: Pagina[], fecha: string, municipio: string): TurnoSevilla[]
export function guardiasZonaSevilla(paginas: Pagina[], fecha: string): TurnoSevilla[]
