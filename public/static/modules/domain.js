import { LAT_10KM, LNG_10KM } from './config.js'

const PROVINCE_ALIASES = {
  vizcaya: 'bizkaia',
  guipuzcoa: 'gipuzkoa',
  alava: 'araba',
  gerona: 'girona',
  lerida: 'lleida',
  alicante: 'alacant',
  castellon: 'castello',
  baleares: 'balears',
  coruna: 'acoruna'
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      case "'":
        return '&#39;'
      default:
        return char
    }
  })
}

export function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim()
}

export function parseNumericPrice(value) {
  if (value === null || value === undefined || value === '') return null
  const normalized = Number.parseFloat(String(value).replace(',', '.'))
  return Number.isFinite(normalized) ? normalized : null
}

export function formatPrice(value) {
  if (value === null || value === undefined) return 'N/D'
  return `${value.toFixed(3)} EUR`
}

export function getStationPrice(station, fuelId) {
  return station?.prices?.[fuelId] ?? null
}

export function getSearchText(station) {
  return station.searchText || [station.label, station.address, station.municipality].filter(Boolean).join(' ')
}

export function isOpenNow(schedule, now = new Date()) {
  if (!schedule) return true
  const upper = schedule.toUpperCase()
  if (upper.includes('24H')) return true

  const currentMinutes = now.getHours() * 60 + now.getMinutes()
  const today = ['D', 'L', 'M', 'X', 'J', 'V', 'S'][now.getDay()]
  const week = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

  try {
    for (const block of upper.split(';')) {
      const splitIndex = block.indexOf(':')
      if (splitIndex === -1) continue

      const daysPart = block.slice(0, splitIndex).trim()
      const hoursPart = block.slice(splitIndex + 1).trim()

      let activeDay = false
      if (daysPart.includes('-')) {
        const [startRaw, endRaw] = daysPart.split('-')
        const start = week.indexOf(startRaw.trim())
        const end = week.indexOf(endRaw.trim())
        const todayIndex = week.indexOf(today)

        if (start !== -1 && end !== -1 && todayIndex !== -1) {
          activeDay = start <= end
            ? todayIndex >= start && todayIndex <= end
            : todayIndex >= start || todayIndex <= end
        }
      } else {
        activeDay = daysPart
          .split(',')
          .map((value) => value.trim())
          .includes(today)
      }

      if (!activeDay) continue

      const times = hoursPart.match(/(\d{2}:\d{2})/g)
      if (!times || times.length < 2) continue

      const [startHours, startMinutes] = times[0].split(':').map(Number)
      const [endHours, endMinutes] = times[1].split(':').map(Number)

      const start = startHours * 60 + startMinutes
      const end = endHours * 60 + endMinutes

      if (end > start) {
        if (currentMinutes >= start && currentMinutes <= end) return true
      } else if (currentMinutes >= start || currentMinutes <= end) {
        return true
      }
    }
  } catch {
    return true
  }

  return false
}

function buildBounds(source) {
  let minLat = 90
  let maxLat = -90
  let minLng = 180
  let maxLng = -180

  for (const station of source) {
    if (station.lat === null || station.lng === null) continue
    minLat = Math.min(minLat, station.lat)
    maxLat = Math.max(maxLat, station.lat)
    minLng = Math.min(minLng, station.lng)
    maxLng = Math.max(maxLng, station.lng)
  }

  if (minLat === 90) return null

  return {
    minLat,
    maxLat,
    minLng,
    maxLng
  }
}

function expandBounds(bounds) {
  if (!bounds) return null
  return {
    minLat: bounds.minLat - LAT_10KM,
    maxLat: bounds.maxLat + LAT_10KM,
    minLng: bounds.minLng - LNG_10KM,
    maxLng: bounds.maxLng + LNG_10KM
  }
}

function filterByBounds(stations, bounds) {
  if (!bounds) return stations
  return stations.filter((station) => {
    if (station.lat === null || station.lng === null) return false
    return (
      station.lat >= bounds.minLat &&
      station.lat <= bounds.maxLat &&
      station.lng >= bounds.minLng &&
      station.lng <= bounds.maxLng
    )
  })
}

export function filterStations(stations, filters) {
  const search = normalizeText(filters.query)
  let result = [...stations]

  if (filters.openOnly) {
    result = result.filter((station) => isOpenNow(station.schedule))
  }

  let bounds = null
  if (
    Number.isFinite(filters.userLocation?.lat) &&
    Number.isFinite(filters.userLocation?.lng)
  ) {
    bounds = {
      minLat: filters.userLocation.lat - LAT_10KM,
      maxLat: filters.userLocation.lat + LAT_10KM,
      minLng: filters.userLocation.lng - LNG_10KM,
      maxLng: filters.userLocation.lng + LNG_10KM
    }
  } else if (filters.municipalityId) {
    const scoped = result.filter((station) => station.municipalityId === filters.municipalityId)
    bounds = expandBounds(buildBounds(scoped))
    if (!bounds && scoped.length) {
      result = scoped
    }
  }

  result = filterByBounds(result, bounds)

  if (search) {
    result = result.filter((station) =>
      normalizeText(getSearchText(station)).includes(search)
    )
  }

  return sortStations(result, filters)
}

export function sortStations(stations, filters) {
  const result = [...stations]
  result.sort((left, right) => {
    if (filters.sort === 'brand-asc') {
      return left.label.localeCompare(right.label, 'es')
    }

    const leftPrice = getStationPrice(left, filters.fuelId)
    const rightPrice = getStationPrice(right, filters.fuelId)

    if (leftPrice === null && rightPrice === null) return 0
    if (leftPrice === null) return 1
    if (rightPrice === null) return -1

    return filters.sort === 'price-desc' ? rightPrice - leftPrice : leftPrice - rightPrice
  })

  return result
}

export function computeStats(stations, fuelId) {
  const prices = stations
    .map((station) => getStationPrice(station, fuelId))
    .filter((value) => value !== null)

  if (!prices.length) {
    return {
      count: stations.length,
      min: null,
      avg: null,
      max: null
    }
  }

  const sum = prices.reduce((accumulator, price) => accumulator + price, 0)
  return {
    count: stations.length,
    min: Math.min(...prices),
    avg: sum / prices.length,
    max: Math.max(...prices)
  }
}

export function getPriceColor(price, minPrice, maxPrice) {
  if (price === null || minPrice === null || maxPrice === null) return 'gray'
  const range = maxPrice - minPrice
  if (range < 0.001) return 'green'

  const percent = (price - minPrice) / range
  if (percent < 0.33) return 'green'
  if (percent < 0.66) return 'yellow'
  return 'red'
}

export function getMapsUrl(station) {
  if (station.lat === null || station.lng === null) return '#'
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${station.lat},${station.lng}`
  )}`
}

export function getAvailableFuels(station, fuels) {
  return fuels
    .map((fuel) => ({
      ...fuel,
      value: getStationPrice(station, fuel.id)
    }))
    .filter((fuel) => fuel.value !== null)
}

export function findBestLocationId(items, rawText) {
  if (!rawText) return null

  const normalizedTarget = normalizeText(rawText)
  const aliasTarget = PROVINCE_ALIASES[normalizedTarget] || normalizedTarget

  let best = null
  for (const item of items) {
    const normalizedItem = normalizeText(item.name)
    if (normalizedItem === normalizedTarget || normalizedItem === aliasTarget) {
      return item.id
    }

    if (
      normalizedItem.includes(normalizedTarget) ||
      normalizedTarget.includes(normalizedItem) ||
      normalizedItem.includes(aliasTarget) ||
      aliasTarget.includes(normalizedItem)
    ) {
      best = item.id
    }
  }

  return best
}
