import type { Context } from 'hono'

import { fetchJsonWithTimeout, roundCoordinate, withEdgeCache } from './cache'

const MINISTRY_BASE =
  'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes'

const FUEL_FIELDS = [
  { id: 'gas95', label: 'Gasolina 95 E5', field: 'Precio Gasolina 95 E5', badge: '🟢' },
  { id: 'gas98', label: 'Gasolina 98 E5', field: 'Precio Gasolina 98 E5', badge: '🔵' },
  { id: 'diesel', label: 'Gasóleo A', field: 'Precio Gasoleo A', badge: '🟡' },
  { id: 'dieselPlus', label: 'Gasóleo Premium', field: 'Precio Gasoleo Premium', badge: '🟠' },
  { id: 'glp', label: 'GLP', field: 'Precio Gases licuados del petróleo', badge: '🟣' },
  { id: 'gnc', label: 'Gas Natural Comprimido', field: 'Precio Gas Natural Comprimido', badge: '⚪' },
  { id: 'gnl', label: 'Gas Natural Licuado', field: 'Precio Gas Natural Licuado', badge: '🩵' },
  { id: 'hydrogen', label: 'Hidrógeno', field: 'Precio Hidrogeno', badge: '🔴' },
  { id: 'renewableDiesel', label: 'Diésel Renovable', field: 'Precio Diésel Renovable', badge: '🌿' }
] as const

type MinistryProvince = {
  IDPovincia: string
  Provincia: string
}

type MinistryMunicipality = {
  IDMunicipio: string
  Municipio: string
}

type MinistryStationsResponse = {
  Fecha?: string
  ListaEESSPrecio?: Record<string, string>[]
}

type ReverseGeocodeResponse = {
  address?: {
    province?: string
    state?: string
    state_district?: string
    county?: string
    city?: string
    town?: string
    village?: string
    municipality?: string
    hamlet?: string
    suburb?: string
    city_district?: string
  }
  display_name?: string
}

export type ProvinceDto = {
  id: string
  name: string
  slug: string
}

export type MunicipalityDto = {
  id: string
  name: string
  slug: string
}

export type StationDto = {
  id: string
  label: string
  brand: string
  address: string
  municipality: string
  municipalityId: string
  provinceId: string
  postcode: string
  schedule: string
  lat: number | null
  lng: number | null
  prices: Record<string, number | null>
  searchText: string
}

export type StationsPayload = {
  updatedAt: string | null
  provinceId: string
  items: StationDto[]
}

export type ReverseGeocodeDto = {
  provinceName: string | null
  municipalityName: string | null
  label: string | null
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null
  const normalized = Number.parseFloat(value.replace(',', '.'))
  return Number.isFinite(normalized) ? normalized : null
}

function normalizeStation(raw: Record<string, string>, provinceId: string): StationDto {
  const prices = Object.fromEntries(
    FUEL_FIELDS.map((fuel) => [fuel.id, parseNumber(raw[fuel.field])])
  )

  const lat = parseNumber(raw['Latitud'])
  const lng = parseNumber(raw['Longitud (WGS84)'])
  const brand = raw['Rótulo']?.trim() || 'Gasolinera'
  const address = raw['Dirección']?.trim() || 'Dirección no disponible'
  const municipality = raw['Municipio']?.trim() || ''
  const schedule = raw['Horario']?.trim() || 'Horario no disponible'

  return {
    id: String(raw['IDEESS'] || `${provinceId}-${address}-${municipality}`),
    label: brand,
    brand,
    address,
    municipality,
    municipalityId: String(raw['IDMunicipio'] || ''),
    provinceId,
    postcode: raw['C.P.']?.trim() || '',
    schedule,
    lat: lat === null ? null : roundCoordinate(lat, 6),
    lng: lng === null ? null : roundCoordinate(lng, 6),
    prices,
    searchText: [brand, address, municipality, raw['Provincia'] || ''].filter(Boolean).join(' ')
  }
}

export async function getProvinces(c: Context) {
  return withEdgeCache(c, 'provinces', 60 * 60 * 24 * 7, async () => {
    const items = await fetchJsonWithTimeout<MinistryProvince[]>(
      `${MINISTRY_BASE}/Listados/Provincias/`
    )

    return items
      .map((province) => ({
        id: String(province.IDPovincia),
        name: province.Provincia,
        slug: toSlug(province.Provincia)
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'es'))
  })
}

export async function getMunicipalities(c: Context, provinceId: string) {
  return withEdgeCache(
    c,
    `municipalities-${provinceId}`,
    60 * 60 * 24 * 7,
    async () => {
      const items = await fetchJsonWithTimeout<MinistryMunicipality[]>(
        `${MINISTRY_BASE}/Listados/MunicipiosPorProvincia/${provinceId}`
      )

      return items
        .map((municipality) => ({
          id: String(municipality.IDMunicipio),
          name: municipality.Municipio,
          slug: toSlug(municipality.Municipio)
        }))
        .sort((left, right) => left.name.localeCompare(right.name, 'es'))
    }
  )
}

export async function getStationsByProvince(c: Context, provinceId: string) {
  return withEdgeCache<StationsPayload>(
    c,
    `stations-${provinceId}`,
    60 * 10,
    async () => {
      const payload = await fetchJsonWithTimeout<MinistryStationsResponse>(
        `${MINISTRY_BASE}/EstacionesTerrestres/FiltroProvincia/${provinceId}`
      )

      return {
        updatedAt: payload.Fecha ?? null,
        provinceId,
        items: (payload.ListaEESSPrecio || []).map((station) =>
          normalizeStation(station, provinceId)
        )
      }
    }
  )
}

export async function reverseGeocode(c: Context, lat: number, lng: number) {
  return withEdgeCache<ReverseGeocodeDto>(
    c,
    `reverse-${roundCoordinate(lat)}-${roundCoordinate(lng)}`,
    60 * 60,
    async () => {
      const params = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng)
      })

      const payload = await fetchJsonWithTimeout<ReverseGeocodeResponse>(
        `https://nominatim.openstreetmap.org/reverse?${params.toString()}`,
        {
          headers: {
            'Accept-Language': 'es',
            'User-Agent': 'gasolineras-espana/1.0'
          }
        }
      )

      const address = payload.address || {}

      return {
        provinceName:
          address.province || address.state || address.state_district || address.county || null,
        municipalityName:
          address.city ||
          address.town ||
          address.village ||
          address.municipality ||
          address.hamlet ||
          address.suburb ||
          address.city_district ||
          null,
        label: payload.display_name || null
      }
    }
  )
}

export function getFuelCatalog() {
  return FUEL_FIELDS.map((fuel) => ({
    id: fuel.id,
    label: fuel.label,
    badge: fuel.badge
  }))
}
