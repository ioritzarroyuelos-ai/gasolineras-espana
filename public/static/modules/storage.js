const STORAGE_KEY = 'gasolineras.pref.v3'

export function readStoredFilters(defaultFilters) {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...defaultFilters }
    return { ...defaultFilters, ...JSON.parse(raw) }
  } catch {
    return { ...defaultFilters }
  }
}

export function writeStoredFilters(filters) {
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        provinceId: filters.provinceId,
        municipalityId: filters.municipalityId,
        fuelId: filters.fuelId,
        query: filters.query,
        sort: filters.sort,
        openOnly: filters.openOnly
      })
    )
  } catch {
    // Intentionally ignored.
  }
}

export function readUrlState(defaultFilters) {
  const params = new URLSearchParams(window.location.search)
  return {
    filters: {
      ...defaultFilters,
      provinceId: params.get('prov') || defaultFilters.provinceId,
      municipalityId: params.get('mun') || defaultFilters.municipalityId,
      fuelId: params.get('fuel') || defaultFilters.fuelId,
      query: params.get('q') || defaultFilters.query,
      sort: params.get('sort') || defaultFilters.sort,
      openOnly: params.get('open') === '1' ? true : defaultFilters.openOnly
    }
  }
}

export function writeUrlState(filters) {
  const params = new URLSearchParams()

  if (filters.provinceId) params.set('prov', filters.provinceId)
  if (filters.municipalityId) params.set('mun', filters.municipalityId)
  if (filters.fuelId && filters.fuelId !== 'gas95') params.set('fuel', filters.fuelId)
  if (filters.query) params.set('q', filters.query)
  if (filters.sort && filters.sort !== 'price-asc') params.set('sort', filters.sort)
  if (filters.openOnly) params.set('open', '1')

  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`
  window.history.replaceState({}, '', nextUrl)
}
