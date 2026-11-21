export interface ServicioCategoria {id:string;nombre:string;grupo:string}
export const SERVICIOS_CATEGORIAS: ServicioCategoria[]
export const SERVICIOS_IDS: Set<string>
export const OSM_TAG_FILTERS: string[][]
export function categoriasServicio(tags:Record<string,string>):string[]
