import type { MunicipioLista } from '../../scripts/lib/tiempo.mjs'
import type { EstacionITV } from './itv'
import { slugifyMunicipio } from './municipios'
import { haversineKm } from './pure'
import { buscaTiempo, rutaMunicipioTiempo, type IndiceBusquedaTiempo } from './tiempo-municipios'

// Se comparte el catálogo oficial y el índice de alias generado para El Tiempo.
// Sólo cambia el destino de la búsqueda. No se descarga otro listado de pueblos.
export function buscaItv(indice: IndiceBusquedaTiempo, consulta: string) {
  const encontrada = buscaTiempo(indice, consulta)
  const ruta = (url: string) => url.replace(/^\/tiempo\//, '/itv/')
  return {
    resultados: encontrada.resultados.map(r => ({ ...r, u: ruta(r.u) })),
    destino: encontrada.destino ? ruta(encontrada.destino) : undefined,
  }
}

export interface ItvCercana { estacion: EstacionITV; distanciaKm: number }
export interface OrigenCercanas { nombre: string; lat: number; lng: number }
export const DISTANCIA_MAX_ITV_KM = 80

function tieneCoordenadas<T extends {lat: number | null; lng: number | null}>(lugar: T): lugar is T & {lat: number; lng: number} {
  return typeof lugar.lat === 'number' && Number.isFinite(lugar.lat) && Math.abs(lugar.lat) <= 90
    && typeof lugar.lng === 'number' && Number.isFinite(lugar.lng) && Math.abs(lugar.lng) <= 180
    && (lugar.lat !== 0 || lugar.lng !== 0)
}

export function origenDelMunicipio(m: MunicipioLista | undefined): OrigenCercanas | undefined {
  if (m && tieneCoordenadas(m)) return { nombre: m.nombre, lat: m.lat, lng: m.lng }
}

export function estacionesCercanas(estaciones: EstacionITV[], origen: OrigenCercanas, limite = 5): ItvCercana[] {
  if (!tieneCoordenadas(origen)) return []
  return estaciones.filter(tieneCoordenadas).map(estacion => ({
    estacion, distanciaKm: haversineKm(origen.lat, origen.lng, estacion.lat, estacion.lng),
  })).filter(e => e.distanciaKm <= DISTANCIA_MAX_ITV_KM)
    .sort((a, b) => a.distanciaKm - b.distanciaKm || a.estacion.id.localeCompare(b.estacion.id)).slice(0, limite)
}

// Algunos orígenes usan el nombre de un barrio o núcleo. Sólo se asigna al
// municipio cuando el nombre o un alias documentado lo identifica sin dudas.
export function estacionesEnMunicipio(estaciones: EstacionITV[], municipio: MunicipioLista, catalogoProvincia: MunicipioLista[]): EstacionITV[] {
  return estaciones.filter(e => {
    if (e.prov !== municipio.provinciaId) return false
    const nombres = new Set([e.mun, ...(e.aliasMunicipios || [])].flatMap(n => [n, ...n.split('/')]))
    const candidatos = new Set([...nombres].map(n => rutaMunicipioTiempo(catalogoProvincia, slugifyMunicipio(n))?.municipio.ine).filter(Boolean))
    return candidatos.size === 1 && candidatos.has(municipio.ine)
  })
}

export function rutaAnteriorItv(estaciones: EstacionITV[], slug: string): string | undefined {
  const destinos = new Set(estaciones.filter(e => e.aliasMunicipios?.some(n => slugifyMunicipio(n) === slug)).map(e => slugifyMunicipio(e.mun)))
  if (destinos.size === 1) return [...destinos][0]
}
