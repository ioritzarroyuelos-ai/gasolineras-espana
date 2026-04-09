import {
  API_ROUTES,
  DEFAULT_FILTERS,
  FUEL_OPTIONS,
  LIST_PAGE_SIZE,
  getFuelOption
} from './modules/config.js'
import {
  computeStats,
  escapeHtml,
  filterStations,
  findBestLocationId,
  formatPrice,
  getAvailableFuels,
  getMapsUrl,
  getStationPrice,
  isOpenNow
} from './modules/domain.js'
import { MapView } from './modules/map-view.js'
import {
  readStoredFilters,
  readUrlState,
  writeStoredFilters,
  writeUrlState
} from './modules/storage.js'

const dom = {
  body: document.body,
  liveRegion: document.getElementById('live-region'),
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  mobileScrim: document.getElementById('mobile-scrim'),
  provinceInput: document.getElementById('sel-provincia'),
  provinceList: document.getElementById('provincia-list'),
  provinceMobile: document.getElementById('sel-provincia-mobile'),
  municipalityInput: document.getElementById('sel-municipio'),
  municipalityList: document.getElementById('municipio-list'),
  municipalityMobile: document.getElementById('sel-municipio-mobile'),
  fuelSelect: document.getElementById('sel-combustible'),
  searchInput: document.getElementById('search-text'),
  sortSelect: document.getElementById('sel-orden'),
  openOnlyCheckbox: document.getElementById('chk-open-only'),
  btnSearch: document.getElementById('btn-buscar'),
  btnGeolocate: document.getElementById('btn-geolocate'),
  btnLoadMore: document.getElementById('btn-load-more'),
  lblUpdate: document.getElementById('lbl-update'),
  lblCount: document.getElementById('lbl-count'),
  resultsCaption: document.getElementById('results-caption'),
  resultsPill: document.getElementById('results-pill'),
  resultsSection: document.querySelector('.results-section'),
  stationList: document.getElementById('station-list'),
  statsBar: document.getElementById('stats-bar'),
  statCount: document.getElementById('stat-n'),
  statMin: document.getElementById('stat-min'),
  statAvg: document.getElementById('stat-avg'),
  statMax: document.getElementById('stat-max'),
  stationDetail: document.getElementById('station-detail'),
  detailSubtitle: document.getElementById('detail-subtitle'),
  detailPrice: document.getElementById('detail-price'),
  detailStatus: document.getElementById('detail-status'),
  detailSchedule: document.getElementById('detail-schedule'),
  detailAddress: document.getElementById('detail-address'),
  detailFuels: document.getElementById('detail-fuels'),
  detailFuelsCount: document.getElementById('detail-fuels-count'),
  detailDirections: document.getElementById('detail-directions'),
  loading: document.getElementById('loading'),
  loadingTitle: document.querySelector('#loading .loading-title'),
  loadingSubtitle: document.querySelector('#loading .loading-subtitle'),
  btnSatellite: document.getElementById('btn-satellite'),
  satelliteImg: document.getElementById('satellite-img'),
  satelliteLabel: document.querySelector('#btn-satellite .label')
}

const sidebarMedia = window.matchMedia('(max-width: 980px)')

const state = {
  fuels: [...FUEL_OPTIONS],
  provinces: [],
  municipalities: [],
  municipalityCache: new Map(),
  stationCache: new Map(),
  allStations: [],
  filteredStations: [],
  updatedAt: '',
  visibleCount: LIST_PAGE_SIZE,
  selectedStationId: '',
  userLocation: null,
  filters: { ...DEFAULT_FILTERS },
  activeProvinceLoad: 0
}

const mapView = new MapView({
  onStationSelect: (stationId) => {
    handleStationSelection(stationId, {
      source: 'map',
      focusMap: false,
      openPopup: true,
      scrollCard: true
    })
  }
})

function debounce(fn, delay = 180) {
  let timer = 0
  return (...args) => {
    window.clearTimeout(timer)
    timer = window.setTimeout(() => fn(...args), delay)
  }
}

function fetchJson(url, timeoutMs = 15000) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  return fetch(url, {
    signal: controller.signal,
    headers: { Accept: 'application/json' }
  })
    .then(async (response) => {
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error || 'No se pudo completar la operación.')
      }
      return payload
    })
    .catch((error) => {
      if (error.name === 'AbortError') {
        throw new Error('La solicitud tardó demasiado. Comprueba tu conexión e inténtalo de nuevo.')
      }
      throw error
    })
    .finally(() => window.clearTimeout(timer))
}

function isMobileLayout() {
  return sidebarMedia.matches
}

function setSidebarOpen(isOpen) {
  if (!isMobileLayout()) {
    dom.body.classList.remove('is-sidebar-open')
    dom.btnToggleSidebar?.setAttribute('aria-expanded', 'false')
    return
  }

  dom.body.classList.toggle('is-sidebar-open', isOpen)
  dom.btnToggleSidebar?.setAttribute('aria-expanded', String(isOpen))
}

function announce(message) {
  if (dom.liveRegion) dom.liveRegion.textContent = message
}

function setLoading(
  isLoading,
  title = 'Sincronizando estaciones...',
  subtitle = 'Preparando filtros, lista y mapa'
) {
  dom.loading.hidden = !isLoading
  if (dom.loadingTitle) dom.loadingTitle.textContent = title
  if (dom.loadingSubtitle) dom.loadingSubtitle.textContent = subtitle
}

function createOption(value, label) {
  const option = document.createElement('option')
  option.value = value
  option.textContent = label
  return option
}

function getSelectedFuel() {
  return state.fuels.find((item) => item.id === state.filters.fuelId) || getFuelOption(state.filters.fuelId)
}

function getProvinceName(provinceId = state.filters.provinceId) {
  return state.provinces.find((item) => item.id === provinceId)?.name || ''
}

function getMunicipalityName(municipalityId = state.filters.municipalityId) {
  return state.municipalities.find((item) => item.id === municipalityId)?.name || ''
}

function formatUpdatedAt(value) {
  if (!value) return ''

  const ddmmyyyy = value.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})(?::\d{2})?$/)
  if (ddmmyyyy) {
    return `${ddmmyyyy[1]}/${ddmmyyyy[2]} ${ddmmyyyy[4]}`
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value

  return parsed.toLocaleString('es-ES', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatDistanceKm(location, station) {
  if (!location || station.lat === null || station.lng === null) return ''

  const toRadians = (value) => (value * Math.PI) / 180
  const earthRadiusKm = 6371
  const dLat = toRadians(station.lat - location.lat)
  const dLng = toRadians(station.lng - location.lng)

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(location.lat)) *
      Math.cos(toRadians(station.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)

  const distance = 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return `${distance.toFixed(distance < 10 ? 1 : 0)} km`
}

function buildEmptyState(title, body, icon = 'fa-route') {
  return `
    <div class="empty-state">
      <div class="icon"><i class="fas ${icon}"></i></div>
      <p>${escapeHtml(title)}</p>
      <small>${escapeHtml(body)}</small>
    </div>
  `
}

function syncFuelOptions() {
  dom.fuelSelect.textContent = ''
  for (const fuel of state.fuels) {
    const option = document.createElement('option')
    option.value = fuel.id
    option.textContent = `${fuel.badge} ${fuel.label}`
    dom.fuelSelect.append(option)
  }

  dom.fuelSelect.value = state.filters.fuelId
}

function syncProvinceControls() {
  const provinceName = getProvinceName()
  dom.provinceInput.value = provinceName
  dom.provinceMobile.value = state.filters.provinceId || ''
}

function syncMunicipalityControls() {
  const municipalityName = getMunicipalityName()
  const disabled = !state.filters.provinceId

  dom.municipalityInput.disabled = disabled
  dom.municipalityMobile.disabled = disabled
  dom.municipalityInput.value = municipalityName
  dom.municipalityMobile.value = state.filters.municipalityId || ''
}

function syncSimpleControls() {
  dom.fuelSelect.value = state.filters.fuelId
  dom.searchInput.value = state.filters.query
  dom.sortSelect.value = state.filters.sort
  dom.openOnlyCheckbox.checked = state.filters.openOnly
}

function syncGeolocateButton() {
  const active = Boolean(state.userLocation)
  dom.btnGeolocate.classList.toggle('is-active', active)
  dom.btnGeolocate.setAttribute('aria-pressed', String(active))
  dom.btnGeolocate.title = active ? 'Quitar filtro por ubicación' : 'Usar mi ubicación'
}

function populateProvinceControls() {
  dom.provinceList.textContent = ''
  for (const province of state.provinces) {
    dom.provinceList.append(createOption(province.name, province.name))
  }

  dom.provinceMobile.textContent = ''
  dom.provinceMobile.append(createOption('', 'Elegir provincia...'))
  for (const province of state.provinces) {
    dom.provinceMobile.append(createOption(province.id, province.name))
  }

  syncProvinceControls()
}

function populateMunicipalityControls() {
  dom.municipalityList.textContent = ''
  for (const municipality of state.municipalities) {
    dom.municipalityList.append(createOption(municipality.name, municipality.name))
  }

  dom.municipalityMobile.textContent = ''
  dom.municipalityMobile.append(createOption('', 'Municipio (opcional)'))
  for (const municipality of state.municipalities) {
    dom.municipalityMobile.append(createOption(municipality.id, municipality.name))
  }

  syncMunicipalityControls()
}

function resolveProvinceIdFromControls() {
  if (isMobileLayout()) {
    return dom.provinceMobile.value || ''
  }
  return findBestLocationId(state.provinces, dom.provinceInput.value.trim()) || ''
}

function resolveMunicipalityIdFromControls() {
  if (isMobileLayout()) {
    return dom.municipalityMobile.value || ''
  }
  return findBestLocationId(state.municipalities, dom.municipalityInput.value.trim()) || ''
}

function updateHeaderMeta() {
  const count = state.filteredStations.length
  const updateText = formatUpdatedAt(state.updatedAt)

  dom.lblUpdate.hidden = !updateText
  dom.lblUpdate.textContent = updateText ? `Actualizado ${updateText}` : ''

  dom.lblCount.hidden = !state.filters.provinceId
  dom.lblCount.textContent = `${count} visibles`

  const locationText = [getMunicipalityName(), getProvinceName()].filter(Boolean).join(', ')
  const subtitleLocation = locationText || 'Lista sincronizada con el mapa'
  dom.resultsCaption.textContent = `${subtitleLocation} · ${getSelectedFuel().label}`

  dom.resultsPill.hidden = !count
  dom.resultsPill.textContent =
    state.visibleCount < count ? `${state.visibleCount} / ${count}` : `${count} resultados`
}

function renderStats() {
  if (!state.filters.provinceId) {
    dom.statsBar.hidden = true
    return
  }

  const stats = computeStats(state.filteredStations, state.filters.fuelId)
  dom.statsBar.hidden = false
  dom.statCount.textContent = String(stats.count)
  dom.statMin.textContent = formatPrice(stats.min)
  dom.statAvg.textContent = formatPrice(stats.avg)
  dom.statMax.textContent = formatPrice(stats.max)
}

function getSelectedStation() {
  return state.filteredStations.find((station) => station.id === state.selectedStationId) || null
}

function renderDetail() {
  const station = getSelectedStation()
  if (!station) {
    dom.stationDetail.hidden = true
    return
  }

  const fuel = getSelectedFuel()
  const price = getStationPrice(station, fuel.id)
  const isOpen = isOpenNow(station.schedule)
  const distance = formatDistanceKm(state.userLocation, station)
  const meta = [station.municipality, station.postcode, distance].filter(Boolean).join(' · ')
  const availableFuels = getAvailableFuels(station, state.fuels)

  dom.stationDetail.hidden = false
  dom.detailSubtitle.textContent = meta
  dom.detailPrice.textContent = formatPrice(price)
  dom.detailPrice.dataset.tone = price === null ? 'neutral' : isOpen ? 'positive' : 'muted'
  dom.detailStatus.textContent = isOpen ? 'Abierta ahora' : 'Cerrada ahora'
  dom.detailStatus.dataset.state = isOpen ? 'open' : 'closed'
  dom.detailSchedule.textContent = station.schedule || 'Horario no disponible'
  dom.detailAddress.textContent = station.address
  dom.detailFuelsCount.textContent = `${availableFuels.length} disponibles`
  dom.detailDirections.href = getMapsUrl(station)

  dom.detailFuels.innerHTML = availableFuels
    .map((item) => {
      const activeClass = item.id === fuel.id ? ' detail-fuel-chip-active' : ''
      return `
        <span class="detail-fuel-chip${activeClass}">
          <span class="detail-fuel-badge">${escapeHtml(item.badge)}</span>
          <span>${escapeHtml(item.label)}</span>
          <strong>${formatPrice(item.value)}</strong>
        </span>
      `
    })
    .join('')
}

function ensureSelectionVisible() {
  if (!state.selectedStationId) return
  const index = state.filteredStations.findIndex((station) => station.id === state.selectedStationId)
  if (index === -1 || index < state.visibleCount) return

  state.visibleCount = (Math.floor(index / LIST_PAGE_SIZE) + 1) * LIST_PAGE_SIZE
}

function renderList() {
  if (!state.filters.provinceId) {
    dom.sidebar.dataset.hasResults = 'false'
    dom.resultsSection.hidden = true
    dom.stationList.dataset.mode = 'pristine'
    dom.stationList.innerHTML = buildEmptyState(
      'Elige una provincia para empezar',
      'Cargaremos las estaciones de esa zona, su detalle y el mapa centrado automaticamente.'
    )
    dom.btnLoadMore.hidden = true
    return
  }

  if (!state.filteredStations.length) {
    dom.sidebar.dataset.hasResults = 'false'
    dom.resultsSection.hidden = true
    dom.stationList.dataset.mode = 'empty'
    dom.stationList.innerHTML = buildEmptyState(
      'No hemos encontrado estaciones con esos filtros',
      'Prueba otro combustible, abre el radio o elimina la busqueda de texto.',
      'fa-circle-exclamation'
    )
    dom.btnLoadMore.hidden = true
    return
  }

  dom.sidebar.dataset.hasResults = 'true'
  dom.resultsSection.hidden = false
  dom.stationList.dataset.mode = 'ready'
  ensureSelectionVisible()

  const fuel = getSelectedFuel()
  const visibleStations = state.filteredStations.slice(0, state.visibleCount)

  dom.stationList.innerHTML = visibleStations
    .map((station) => {
      const selected = station.id === state.selectedStationId
      const price = getStationPrice(station, fuel.id)
      const isOpen = isOpenNow(station.schedule)
      const distance = formatDistanceKm(state.userLocation, station)
      const meta = [station.municipality, distance].filter(Boolean).join(' · ') || 'Sin municipio'
      const availableCount = getAvailableFuels(station, state.fuels).length

      return `
        <article class="station-card${selected ? ' is-selected' : ''}">
          <button
            type="button"
            class="station-card-button"
            data-station-id="${escapeHtml(station.id)}"
            aria-pressed="${selected ? 'true' : 'false'}"
          >
            <div class="station-card-head">
              <div class="station-card-copy">
                <p class="station-card-brand">${escapeHtml(station.label)}</p>
                <p class="station-card-meta">${escapeHtml(meta)}</p>
              </div>
              <div class="station-card-price" data-state="${price === null ? 'empty' : isOpen ? 'open' : 'closed'}">
                <strong>${formatPrice(price)}</strong>
                <span>${escapeHtml(fuel.label)}</span>
              </div>
            </div>

            <p class="station-card-address">
              <i class="fas fa-location-dot" aria-hidden="true"></i>
              <span>${escapeHtml(station.address)}</span>
            </p>

            <div class="station-card-tags">
              <span class="station-tag" data-state="${isOpen ? 'open' : 'closed'}">
                <i class="fas ${isOpen ? 'fa-circle-check' : 'fa-clock'}" aria-hidden="true"></i>
                ${isOpen ? 'Abierta ahora' : 'Cerrada ahora'}
              </span>
              <span class="station-tag">
                <i class="fas fa-gas-pump" aria-hidden="true"></i>
                ${availableCount} combustibles
              </span>
            </div>
          </button>

          <div class="station-card-foot">
            <span class="station-card-schedule">${escapeHtml(station.schedule || 'Horario no disponible')}</span>
            <a
              class="station-card-link"
              href="${getMapsUrl(station)}"
              target="_blank"
              rel="noreferrer"
            >
              <i class="fas fa-route"></i> Ruta
            </a>
          </div>
        </article>
      `
    })
    .join('')

  dom.btnLoadMore.hidden = state.visibleCount >= state.filteredStations.length
}

function renderMap({ fitMap = false, rerender = true } = {}) {
  if (rerender) {
    mapView.renderStations(state.filteredStations, {
      fuel: getSelectedFuel(),
      selectedStationId: state.selectedStationId,
      fitMap,
      onStationSelect: (stationId, options) => {
        handleStationSelection(stationId, {
          source: options?.source || 'map',
          focusMap: false,
          openPopup: true,
          scrollCard: true
        })
      }
    })
    return
  }

  mapView.setSelectedStation(state.selectedStationId)
}

function persistState() {
  writeStoredFilters(state.filters)
  writeUrlState(state.filters)
}

function applyFilters({ fitMap = false, rerenderMap = true, resetPage = false, announceResult = true } = {}) {
  if (resetPage) {
    state.visibleCount = LIST_PAGE_SIZE
  }

  state.filteredStations = filterStations(state.allStations, {
    ...state.filters,
    userLocation: state.userLocation
  })

  if (!state.filteredStations.some((station) => station.id === state.selectedStationId)) {
    state.selectedStationId = ''
  }

  renderStats()
  renderDetail()
  renderList()
  updateHeaderMeta()
  renderMap({ fitMap, rerender: rerenderMap })
  persistState()

  if (announceResult) {
    const provinceName = getProvinceName() || 'la zona seleccionada'
    announce(`${state.filteredStations.length} estaciones visibles en ${provinceName}.`)
  }
}

function scrollSelectedCardIntoView() {
  const selectedCard = dom.stationList.querySelector('.station-card.is-selected')
  if (!selectedCard) return

  selectedCard.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  })
}

function handleStationSelection(stationId, options = {}) {
  if (!stationId) return

  state.selectedStationId = stationId
  renderDetail()
  renderList()
  updateHeaderMeta()
  renderMap({ rerender: false })
  persistState()

  const station = getSelectedStation()
  if (station && options.focusMap !== false) {
    mapView.focusStation(station, { openPopup: Boolean(options.openPopup) })
  }

  if (options.scrollCard) {
    window.requestAnimationFrame(scrollSelectedCardIntoView)
  }

  if (options.source === 'list' && isMobileLayout()) {
    setSidebarOpen(false)
  }
}

async function ensureMunicipalities(provinceId) {
  if (state.municipalityCache.has(provinceId)) {
    return state.municipalityCache.get(provinceId)
  }

  const payload = await fetchJson(API_ROUTES.municipalities(provinceId))
  state.municipalityCache.set(provinceId, payload.items || [])
  return payload.items || []
}

async function ensureStations(provinceId) {
  if (state.stationCache.has(provinceId)) {
    return state.stationCache.get(provinceId)
  }

  const payload = await fetchJson(API_ROUTES.stations(provinceId))
  state.stationCache.set(provinceId, payload)
  return payload
}

async function loadProvinceData(
  provinceId,
  { fitMap = true, preferredMunicipalityId = '', preferredMunicipalityText = '' } = {}
) {
  if (!provinceId) {
    state.filters.provinceId = ''
    state.filters.municipalityId = ''
    state.municipalities = []
    state.allStations = []
    state.updatedAt = ''
    state.selectedStationId = ''
    populateMunicipalityControls()
    syncProvinceControls()
    applyFilters({ fitMap: false, rerenderMap: true, resetPage: true })
    return
  }

  const loadId = ++state.activeProvinceLoad
  setLoading(
    true,
    'Cargando provincia...',
    'Estamos preparando municipios, estaciones y mapa.'
  )

  try {
    const [municipalities, payload] = await Promise.all([
      ensureMunicipalities(provinceId),
      ensureStations(provinceId)
    ])

    if (loadId !== state.activeProvinceLoad) return

    state.filters.provinceId = provinceId
    state.municipalities = municipalities
    state.allStations = payload.items || []
    state.updatedAt = payload.updatedAt || ''

    const nextMunicipalityId =
      preferredMunicipalityId ||
      findBestLocationId(municipalities, preferredMunicipalityText) ||
      ''

    state.filters.municipalityId = municipalities.some((item) => item.id === nextMunicipalityId)
      ? nextMunicipalityId
      : ''

    syncProvinceControls()
    populateMunicipalityControls()
    applyFilters({ fitMap, rerenderMap: true, resetPage: true })
  } catch (error) {
    if (loadId !== state.activeProvinceLoad) return

    state.allStations = []
    state.filteredStations = []
    state.updatedAt = ''
    dom.stationList.dataset.mode = 'error'
    dom.stationList.innerHTML = buildEmptyState(
      'No se ha podido cargar la provincia',
      error instanceof Error ? error.message : 'Intentalo de nuevo en unos segundos.',
      'fa-triangle-exclamation'
    )
    dom.btnLoadMore.hidden = true
    renderStats()
    renderDetail()
    updateHeaderMeta()
    mapView.renderStations([], {
      fuel: getSelectedFuel(),
      selectedStationId: '',
      fitMap: false,
      onStationSelect: () => {}
    })
    announce('Ha fallado la carga de estaciones para la provincia seleccionada.')
  } finally {
    if (loadId === state.activeProvinceLoad) {
      setLoading(false)
    }
  }
}

function syncFilterFields() {
  state.filters.query = dom.searchInput.value.trim()
  state.filters.sort = dom.sortSelect.value
  state.filters.fuelId = dom.fuelSelect.value
  state.filters.openOnly = dom.openOnlyCheckbox.checked
}

async function handleProvinceCommit({ clearUserLocation = true } = {}) {
  const provinceId = resolveProvinceIdFromControls()
  const municipalityId = resolveMunicipalityIdFromControls()
  const provinceChanged = provinceId !== state.filters.provinceId

  if (clearUserLocation) {
    state.userLocation = null
    mapView.setUserLocation(null)
    syncGeolocateButton()
  }

  if (provinceChanged) {
    await loadProvinceData(provinceId, {
      fitMap: true,
      preferredMunicipalityId: municipalityId
    })
    return
  }

  state.filters.municipalityId = municipalityId
  syncMunicipalityControls()
  applyFilters({ fitMap: true, rerenderMap: true, resetPage: true })
}

async function useCurrentLocation() {
  if (state.userLocation) {
    state.userLocation = null
    mapView.setUserLocation(null)
    syncGeolocateButton()
    applyFilters({ fitMap: false, rerenderMap: true, resetPage: true })
    announce('Se ha quitado el filtro por ubicación.')
    return
  }

  if (!navigator.geolocation) {
    announce('Este navegador no permite geolocalización.')
    return
  }

  dom.btnGeolocate.disabled = true
  setLoading(
    true,
    'Buscando tu ubicación...',
    'Cuando la encontremos aplicaremos un radio aproximado de 10 km.'
  )

  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000
      })
    })

    const location = {
      lat: position.coords.latitude,
      lng: position.coords.longitude
    }

    state.userLocation = location
    mapView.setUserLocation(location)
    syncGeolocateButton()

    const params = new URLSearchParams({
      lat: String(location.lat),
      lng: String(location.lng)
    })
    const payload = await fetchJson(`${API_ROUTES.reverseGeocode}?${params.toString()}`)
    const provinceId =
      findBestLocationId(state.provinces, payload.provinceName || payload.label || '') || ''

    if (provinceId) {
      await loadProvinceData(provinceId, {
        fitMap: true,
        preferredMunicipalityText: payload.municipalityName || payload.label || ''
      })
      announce('Ubicación aplicada. Estamos mostrando estaciones cercanas a ti.')
    } else {
      applyFilters({ fitMap: false, rerenderMap: true, resetPage: true })
      announce('Ubicación detectada, pero no hemos podido asociarla a una provincia.')
    }
  } catch (error) {
    state.userLocation = null
    mapView.setUserLocation(null)
    syncGeolocateButton()

    let geoMessage = 'No se pudo obtener tu ubicación.'
    if (error instanceof GeolocationPositionError) {
      if (error.code === GeolocationPositionError.PERMISSION_DENIED) {
        geoMessage = 'Permiso de ubicación denegado. Actívalo en la configuración del navegador.'
      } else if (error.code === GeolocationPositionError.POSITION_UNAVAILABLE) {
        geoMessage = 'Ubicación no disponible en este momento. Inténtalo de nuevo.'
      } else if (error.code === GeolocationPositionError.TIMEOUT) {
        geoMessage = 'Se agotó el tiempo al obtener la ubicación. Inténtalo de nuevo.'
      }
    } else if (error instanceof Error) {
      geoMessage = error.message
    }
    announce(geoMessage)
  } finally {
    dom.btnGeolocate.disabled = false
    setLoading(false)
  }
}

function registerEvents() {
  const debouncedSearch = debounce(() => {
    syncFilterFields()
    applyFilters({
      fitMap: false,
      rerenderMap: true,
      resetPage: true,
      announceResult: false
    })
  }, 220)

  dom.btnToggleSidebar?.addEventListener('click', () => {
    setSidebarOpen(!dom.body.classList.contains('is-sidebar-open'))
    window.setTimeout(() => mapView.invalidateSize(), 260)
  })

  dom.mobileScrim?.addEventListener('click', () => {
    setSidebarOpen(false)
    mapView.invalidateSize()
  })

  window.addEventListener(
    'resize',
    debounce(() => {
      setSidebarOpen(false)
      mapView.invalidateSize()
    }, 100)
  )

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSidebarOpen(false)
    }
  })

  dom.provinceInput.addEventListener('change', () => {
    handleProvinceCommit()
  })
  dom.provinceMobile.addEventListener('change', () => {
    handleProvinceCommit()
  })

  dom.municipalityInput.addEventListener('change', () => {
    state.filters.municipalityId = resolveMunicipalityIdFromControls()
    syncMunicipalityControls()
    applyFilters({ fitMap: true, rerenderMap: true, resetPage: true })
  })
  dom.municipalityMobile.addEventListener('change', () => {
    state.filters.municipalityId = resolveMunicipalityIdFromControls()
    syncMunicipalityControls()
    applyFilters({ fitMap: true, rerenderMap: true, resetPage: true })
  })

  dom.searchInput.addEventListener('input', () => {
    debouncedSearch()
  })
  dom.searchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      syncFilterFields()
      handleProvinceCommit()
    }
  })

  dom.sortSelect.addEventListener('change', () => {
    syncFilterFields()
    applyFilters({
      fitMap: false,
      rerenderMap: false,
      resetPage: true,
      announceResult: false
    })
  })

  dom.fuelSelect.addEventListener('change', () => {
    syncFilterFields()
    applyFilters({
      fitMap: false,
      rerenderMap: true,
      resetPage: false,
      announceResult: false
    })
  })

  dom.openOnlyCheckbox.addEventListener('change', () => {
    syncFilterFields()
    applyFilters({ fitMap: false, rerenderMap: true, resetPage: true })
  })

  dom.btnSearch.addEventListener('click', async () => {
    syncFilterFields()
    await handleProvinceCommit()
  })

  dom.btnGeolocate.addEventListener('click', () => {
    useCurrentLocation()
  })

  dom.btnLoadMore.addEventListener('click', () => {
    state.visibleCount += LIST_PAGE_SIZE
    renderList()
    updateHeaderMeta()
  })

  dom.stationList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-station-id]')
    if (!button) return

    handleStationSelection(button.getAttribute('data-station-id'), {
      source: 'list',
      focusMap: true,
      openPopup: true
    })
  })
}

async function init() {
  mapView.init()
  mapView.setSatellitePreviewButton(
    dom.btnSatellite,
    dom.satelliteImg,
    dom.satelliteLabel
  )

  const storedFilters = readStoredFilters(DEFAULT_FILTERS)
  const urlState = readUrlState(storedFilters)
  state.filters = { ...storedFilters, ...urlState.filters }
  state.selectedStationId = ''

  syncGeolocateButton()
  renderStats()
  renderDetail()
  renderList()
  registerEvents()

  setLoading(
    true,
    'Preparando la aplicación...',
    'Cargando configuración y provincias disponibles.'
  )

  try {
    const [configPayload, provincesPayload] = await Promise.all([
      fetchJson(API_ROUTES.config),
      fetchJson(API_ROUTES.provinces)
    ])

    state.fuels = configPayload.fuels?.length ? configPayload.fuels : [...FUEL_OPTIONS]
    state.provinces = provincesPayload.items || []

    syncFuelOptions()
    populateProvinceControls()
    populateMunicipalityControls()
    syncSimpleControls()

    if (state.filters.provinceId) {
      await loadProvinceData(state.filters.provinceId, {
        fitMap: true,
        preferredMunicipalityId: state.filters.municipalityId
      })
    } else {
      updateHeaderMeta()
    }
  } catch (error) {
    dom.stationList.dataset.mode = 'error'
    dom.stationList.innerHTML = buildEmptyState(
      'La aplicación no ha podido arrancar',
      error instanceof Error ? error.message : 'Revisa la conexión y vuelve a intentarlo.',
      'fa-plug-circle-xmark'
    )
    announce('La aplicación no ha podido arrancar.')
  } finally {
    setLoading(false)
  }
}

init()
