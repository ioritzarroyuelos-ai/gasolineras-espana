export const API_ROUTES = {
  config: '/api/config',
  provinces: '/api/provincias',
  municipalities: (provinceId) => `/api/municipios/${encodeURIComponent(provinceId)}`,
  stations: (provinceId) => `/api/estaciones/${encodeURIComponent(provinceId)}`,
  reverseGeocode: '/api/reverse-geocode'
}

export const FUEL_OPTIONS = [
  { id: 'gas95', label: 'Gasolina 95 E5', badge: '🟢' },
  { id: 'gas98', label: 'Gasolina 98 E5', badge: '🔵' },
  { id: 'diesel', label: 'Gasóleo A', badge: '🟡' },
  { id: 'dieselPlus', label: 'Gasóleo Premium', badge: '🟠' },
  { id: 'glp', label: 'GLP', badge: '🟣' },
  { id: 'gnc', label: 'Gas Natural Comprimido', badge: '⚪' },
  { id: 'gnl', label: 'Gas Natural Licuado', badge: '🩵' },
  { id: 'hydrogen', label: 'Hidrógeno', badge: '🔴' },
  { id: 'renewableDiesel', label: 'Diésel Renovable', badge: '🌿' }
]

export const DEFAULT_FILTERS = {
  provinceId: '',
  municipalityId: '',
  fuelId: 'gas95',
  query: '',
  sort: 'price-asc',
  openOnly: false
}

export const LIST_PAGE_SIZE = 50

export const LAT_10KM = 0.0898
export const LNG_10KM = 0.117

export function getFuelOption(fuelId) {
  return FUEL_OPTIONS.find((item) => item.id === fuelId) || FUEL_OPTIONS[0]
}
