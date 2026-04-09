import { escapeHtml, formatPrice, getMapsUrl, getPriceColor, getStationPrice } from './domain.js'

function makeMarkerIcon(color, selected = false) {
  const colors = {
    green: '#16b978',
    yellow: '#f59e0b',
    red: '#ef4444',
    gray: '#94a3b8'
  }

  const fill = colors[color] || colors.gray
  const ring = selected ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.42)'
  const ringWidth = selected ? 4 : 2

  const svg = `
    <svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M18 1C8.61116 1 1 8.61116 1 18C1 30 18 43 18 43C18 43 35 30 35 18C35 8.61116 27.3888 1 18 1Z" fill="${fill}" stroke="${ring}" stroke-width="${ringWidth}"/>
      <circle cx="18" cy="18" r="6.5" fill="white"/>
    </svg>
  `

  return window.L.divIcon({
    html: `<div class="marker-shell marker-shell-${color}${selected ? ' marker-shell-selected' : ''}">${svg}</div>`,
    className: '',
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -40]
  })
}

function buildPopup(station, fuel) {
  const price = getStationPrice(station, fuel.id)
  const directionsUrl = getMapsUrl(station)

  return `
    <div class="popup-card">
      <div class="popup-card-head">
        <div class="popup-card-brand">${escapeHtml(station.label)}</div>
        <div class="popup-card-meta">${escapeHtml(station.municipality || '')}</div>
      </div>
      <div class="popup-card-body">
        <div class="popup-price-row">
          <span class="popup-price">${formatPrice(price)}</span>
          <span class="popup-fuel">${fuel.badge} ${escapeHtml(fuel.label)}</span>
        </div>
        <p class="popup-address">
          <i class="fas fa-location-dot"></i>
          <span>${escapeHtml(station.address)}</span>
        </p>
        <p class="popup-address">
          <i class="far fa-clock"></i>
          <span>${escapeHtml(station.schedule)}</span>
        </p>
      </div>
      <div class="popup-card-foot">
        <a class="btn-popup-nav" href="${directionsUrl}" target="_blank" rel="noreferrer">
          <i class="fas fa-route"></i> Cómo llegar
        </a>
      </div>
    </div>
  `
}

export class MapView {
  constructor({ onStationSelect }) {
    this.onStationSelect = onStationSelect
    this.map = null
    this.clusterGroup = null
    this.markersById = new Map()
    this.markerColorsById = new Map()
    this.userLocationMarker = null
    this.activeLayer = 'map'
    this.layers = {}
    this.selectedStationId = ''
  }

  init() {
    const voyager = window.L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
      {
        attribution: '© OpenStreetMap contributors © CARTO',
        subdomains: 'abcd',
        maxZoom: 19
      }
    )

    const satellite = window.L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution:
          'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
      }
    )

    this.map = window.L.map('map', {
      zoomControl: true,
      layers: [voyager]
    }).setView([40.4, -3.7], 6)

    this.layers = { map: voyager, satellite }

    window.L.control.layers(
      {
        Mapa: voyager,
        Satélite: satellite
      },
      null,
      { position: 'topright' }
    ).addTo(this.map)

    this.clusterGroup = window.L.markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 55,
      iconCreateFunction: (cluster) => {
        const count = cluster.getChildCount()
        const size = count > 180 ? 54 : count > 50 ? 48 : 42
        const tone = count > 180 ? 'red' : count > 50 ? 'yellow' : 'green'
        return window.L.divIcon({
          html: `<div class="custom-cluster"><span class="cluster-${tone}">${count}</span></div>`,
          className: '',
          iconSize: [size, size]
        })
      }
    })

    this.map.addLayer(this.clusterGroup)
    this.map.invalidateSize(true)
  }

  setSatellitePreviewButton(button, image, label) {
    this.toggleButton = button
    this.previewImage = image
    this.previewLabel = label

    this.updatePreview()
    button.addEventListener('click', () => {
      this.toggleBaseLayer()
    })
    this.map.on('moveend', () => this.updatePreview())
  }

  toggleBaseLayer() {
    if (!this.map) return

    if (this.activeLayer === 'map') {
      this.map.removeLayer(this.layers.map)
      this.map.addLayer(this.layers.satellite)
      this.activeLayer = 'satellite'
    } else {
      this.map.removeLayer(this.layers.satellite)
      this.map.addLayer(this.layers.map)
      this.activeLayer = 'map'
    }

    if (this.toggleButton) {
      this.toggleButton.setAttribute('aria-pressed', String(this.activeLayer === 'satellite'))
    }
    this.updatePreview()
  }

  updatePreview() {
    if (!this.map || !this.previewImage || !this.previewLabel) return

    const center = this.map.getCenter()
    const zoom = 15
    const x = Math.floor(((center.lng + 180) / 360) * 2 ** zoom)
    const y = Math.floor(
      ((1 -
        Math.log(
          Math.tan((center.lat * Math.PI) / 180) +
            1 / Math.cos((center.lat * Math.PI) / 180)
        ) /
          Math.PI) /
        2) *
        2 ** zoom
    )

    if (this.activeLayer === 'map') {
      this.previewImage.src = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${y}/${x}`
      this.previewLabel.textContent = 'SATÉLITE'
    } else {
      this.previewImage.src = `https://a.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${x}/${y}.png`
      this.previewLabel.textContent = 'MAPA'
    }
  }

  renderStations(stations, options) {
    if (!this.map || !this.clusterGroup) return

    const {
      fuel,
      selectedStationId = '',
      fitMap = false,
      onStationSelect
    } = options

    this.clusterGroup.clearLayers()
    this.markersById.clear()
    this.markerColorsById.clear()
    this.selectedStationId = selectedStationId

    const prices = stations
      .map((station) => getStationPrice(station, fuel.id))
      .filter((value) => value !== null)

    const minPrice = prices.length ? Math.min(...prices) : null
    const maxPrice = prices.length ? Math.max(...prices) : null
    const bounds = []

    for (const station of stations) {
      if (station.lat === null || station.lng === null) continue

      const price = getStationPrice(station, fuel.id)
      const color = getPriceColor(price, minPrice, maxPrice)
      const selected = station.id === selectedStationId
      const marker = window.L.marker([station.lat, station.lng], {
        icon: makeMarkerIcon(color, selected)
      })

      marker.bindPopup(buildPopup(station, fuel), {
        className: 'modern-popup',
        maxWidth: 320
      })
      marker.on('click', () => onStationSelect(station.id, { source: 'map' }))

      this.markersById.set(station.id, marker)
      this.markerColorsById.set(station.id, color)
      this.clusterGroup.addLayer(marker)
      bounds.push([station.lat, station.lng])
    }

    if (fitMap && bounds.length) {
      this.map.fitBounds(bounds, { padding: [32, 32], maxZoom: 14 })
    }
  }

  setUserLocation(location) {
    if (!this.map) return
    if (this.userLocationMarker) this.map.removeLayer(this.userLocationMarker)
    this.userLocationMarker = null
    if (!location) return

    this.userLocationMarker = window.L.circleMarker([location.lat, location.lng], {
      radius: 9,
      color: '#2563eb',
      fillColor: '#3b82f6',
      fillOpacity: 0.42,
      weight: 2
    })
      .addTo(this.map)
      .bindPopup('Tu ubicacion')
  }

  focusStation(station, { openPopup = false } = {}) {
    if (!this.map || !station || station.lat === null || station.lng === null) return

    this.map.setView([station.lat, station.lng], 16)

    const marker = this.markersById.get(station.id)
    if (marker && openPopup) {
      marker.openPopup()
    }
  }

  invalidateSize() {
    if (this.map) this.map.invalidateSize(true)
  }

  setSelectedStation(selectedStationId) {
    if (!this.map || this.selectedStationId === selectedStationId) return

    const previousMarker = this.markersById.get(this.selectedStationId)
    const previousColor = this.markerColorsById.get(this.selectedStationId)
    if (previousMarker && previousColor) {
      previousMarker.setIcon(makeMarkerIcon(previousColor, false))
    }

    const nextMarker = this.markersById.get(selectedStationId)
    const nextColor = this.markerColorsById.get(selectedStationId)
    if (nextMarker && nextColor) {
      nextMarker.setIcon(makeMarkerIcon(nextColor, true))
    }

    this.selectedStationId = selectedStationId
  }
}
