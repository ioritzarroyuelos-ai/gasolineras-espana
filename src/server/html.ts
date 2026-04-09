export function renderAppHtml(): string {
  return `<!DOCTYPE html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, interactive-widget=resizes-content"
    />
    <title>Gasolineras España · Radar de ahorro</title>
    <meta
      name="description"
      content="Busca gasolineras en España con datos oficiales, filtros inteligentes, mapa interactivo y detalle de precios en tiempo real."
    />
    <link
      rel="icon"
      href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛽</text></svg>"
    />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=Space+Grotesk:wght@500;700&display=swap"
      rel="stylesheet"
    />

    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css"
    />
    <link
      rel="stylesheet"
      href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css"
    />
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
    />
    <link rel="stylesheet" href="/static/app.css" />
  </head>
  <body>
    <div id="app-shell">
      <header id="app-header">
        <div class="header-brand">
          <button
            id="btn-toggle-sidebar"
            class="icon-button mobile-only"
            type="button"
            aria-label="Abrir filtros"
            aria-controls="sidebar"
            aria-expanded="false"
          >
            <i class="fas fa-bars"></i>
          </button>
          <span class="header-logo-shell" aria-hidden="true">
            <span class="header-logo">⛽</span>
          </span>
          <div class="header-copy">
            <span class="header-eyebrow">España · precios en vivo</span>
            <div class="header-title-row">
              <h1 class="header-title">Gasolineras España</h1>
              <span class="header-chip">Radar de ahorro</span>
            </div>
            <p class="header-sub">
              Datos oficiales, filtros útiles y una interfaz mucho más clara para decidir dónde
              repostar mejor.
            </p>
          </div>
        </div>

        <div class="header-status">
          <span id="lbl-update" class="header-update" hidden></span>
          <span id="lbl-count" class="header-badge" hidden></span>
        </div>
      </header>

      <div id="live-region" class="sr-only" aria-live="polite" aria-atomic="true"></div>

      <div id="app-body">
        <aside id="sidebar" data-collapsed="false" aria-label="Panel de filtros">
          <div id="sidebar-scroll">
            <section class="panel-hero" aria-labelledby="hero-title">
              <div class="panel-hero-top">
                <div>
                  <span class="panel-kicker">Tu próxima parada</span>
                  <h2 id="hero-title" class="panel-title">Encuentra la gasolinera ideal</h2>
                </div>
                <button
                  id="btn-geolocate"
                  class="icon-button hero-locate"
                  type="button"
                  aria-label="Usar mi ubicación"
                >
                  <i class="fas fa-crosshairs"></i>
                </button>
              </div>
              <p class="panel-copy">
                Explora estaciones cercanas, compara precios al instante y decide con mejor
                contexto visual.
              </p>
              <div class="panel-hero-pills" aria-hidden="true">
                <span class="hero-pill"><i class="fas fa-bolt"></i> Tiempo real</span>
                <span class="hero-pill"><i class="fas fa-map-location-dot"></i> Mapa inmersivo</span>
                <span class="hero-pill"><i class="fas fa-circle-check"></i> Datos oficiales</span>
              </div>
            </section>

            <section class="panel-card filters-card" aria-labelledby="filters-title">
              <div class="panel-card-head">
                <div>
                  <h2 id="filters-title" class="panel-section-title">
                    <i class="fas fa-sliders-h"></i> Ajusta tu búsqueda
                  </h2>
                  <p class="panel-section-note">Provincia, municipio, combustible y texto libre</p>
                </div>
              </div>

              <div class="field-grid">
                <div class="form-group">
                  <label class="form-label" for="sel-provincia">Provincia</label>
                  <div class="input-icon-wrap desktop-field">
                    <i class="fas fa-map icon"></i>
                    <input
                      type="text"
                      id="sel-provincia"
                      class="form-input"
                      list="provincia-list"
                      placeholder="Selecciona provincia..."
                      autocomplete="off"
                    />
                    <datalist id="provincia-list"></datalist>
                  </div>
                  <select id="sel-provincia-mobile" class="form-select mobile-field" aria-label="Provincia">
                    <option value="">Elegir provincia…</option>
                  </select>
                </div>

                <div class="form-group">
                  <label class="form-label" for="sel-municipio">Municipio</label>
                  <div class="input-icon-wrap desktop-field">
                    <i class="fas fa-city icon"></i>
                    <input
                      type="text"
                      id="sel-municipio"
                      class="form-input"
                      list="municipio-list"
                      placeholder="Selecciona municipio..."
                      autocomplete="off"
                      disabled
                    />
                    <datalist id="municipio-list"></datalist>
                  </div>
                  <select
                    id="sel-municipio-mobile"
                    class="form-select mobile-field"
                    aria-label="Municipio"
                    disabled
                  >
                    <option value="">Municipio (opcional)</option>
                  </select>
                </div>
              </div>

              <div class="form-group">
                <label class="form-label" for="sel-combustible">Combustible</label>
                <select id="sel-combustible" class="form-select" aria-label="Combustible"></select>
              </div>

              <div class="form-group">
                <label class="form-label" for="search-text">Buscar rótulo o dirección</label>
                <div class="input-icon-wrap">
                  <i class="fas fa-search icon"></i>
                  <input
                    id="search-text"
                    class="form-input"
                    type="search"
                    placeholder="Repsol, Cepsa, Calle..."
                    autocomplete="off"
                  />
                </div>
              </div>

              <div class="row-actions">
                <div class="form-group flex-grow">
                  <label class="form-label" for="sel-orden">Ordenar</label>
                  <select id="sel-orden" class="form-select" aria-label="Ordenar resultados">
                    <option value="price-asc">Precio ↑ (más barato)</option>
                    <option value="price-desc">Precio ↓ (más caro)</option>
                    <option value="brand-asc">Nombre A→Z</option>
                  </select>
                </div>
                <button id="btn-buscar" class="btn-primary" type="button">
                  <i class="fas fa-search"></i> Buscar
                </button>
              </div>

              <label class="toggle-card" for="chk-open-only">
                <input id="chk-open-only" type="checkbox" />
                <span class="toggle-copy">
                  <strong>Solo abiertas ahora</strong>
                  <span>Oculta estaciones cerradas en este momento</span>
                </span>
                <span class="toggle-pulse"></span>
              </label>
            </section>

            <section
              id="station-detail"
              class="panel-card station-detail"
              hidden
              aria-labelledby="detail-title"
            >
              <div class="station-detail-head">
                <div>
                  <p class="detail-kicker">Selección activa</p>
                  <h2 id="detail-title" class="detail-title">Detalle de la estación</h2>
                  <p id="detail-subtitle" class="detail-subtitle"></p>
                </div>
                <div id="detail-price" class="detail-price">N/D</div>
              </div>

              <div class="detail-meta">
                <span id="detail-status" class="detail-pill"></span>
                <span id="detail-schedule" class="detail-pill detail-pill-muted"></span>
              </div>

              <p id="detail-address" class="detail-address"></p>

              <div class="detail-fuels-head">
                <span>Combustibles disponibles</span>
                <span id="detail-fuels-count"></span>
              </div>
              <div id="detail-fuels" class="detail-fuels"></div>

              <div class="detail-actions">
                <a id="detail-directions" class="btn-secondary" target="_blank" rel="noreferrer">
                  <i class="fas fa-route"></i> Cómo llegar
                </a>
              </div>
            </section>

            <section id="stats-bar" class="stats-panel" hidden aria-labelledby="stats-title">
              <div class="stats-title">
                <h2 id="stats-title" class="stats-heading">
                  <i class="fas fa-wave-square"></i> Resumen en vivo
                </h2>
                <span class="stats-caption">Combustible seleccionado</span>
              </div>
              <div class="stats-grid">
                <div class="stats-card stats-card-primary">
                  <span class="stats-label">Estaciones</span>
                  <strong id="stat-n">0</strong>
                </div>
                <div class="stats-card">
                  <span class="stats-label">Más barato</span>
                  <strong id="stat-min">—</strong>
                </div>
                <div class="stats-card">
                  <span class="stats-label">Media</span>
                  <strong id="stat-avg">—</strong>
                </div>
                <div class="stats-card">
                  <span class="stats-label">Más caro</span>
                  <strong id="stat-max">—</strong>
                </div>
              </div>
            </section>
          </div>

          <section class="results-section" aria-labelledby="results-title" hidden>
            <div class="results-head">
              <div>
                <h2 id="results-title">Resultados</h2>
                <p id="results-caption">Lista sincronizada con el mapa</p>
              </div>
              <span id="results-pill" class="results-pill" hidden></span>
            </div>

            <div id="station-list" class="station-list" data-mode="pristine">
              <div class="empty-state">
                <div class="icon"><i class="fas fa-route"></i></div>
                <p>Elige una provincia para empezar</p>
                <small>
                  Cargaremos las estaciones de esa zona, su detalle y el mapa centrado
                  automáticamente.
                </small>
              </div>
            </div>

            <button id="btn-load-more" class="btn-ghost" type="button" hidden>
              Mostrar más resultados
            </button>
          </section>
        </aside>

        <button id="mobile-scrim" type="button" aria-label="Cerrar filtros"></button>

        <main id="map-container">
          <div class="map-topbar">
            <div class="map-panel">
              <span class="map-kicker">Explora</span>
              <h2 class="map-title">España en directo</h2>
              <p class="map-copy">
                Localiza estaciones al instante, revisa su contexto y compara el precio elegido
                con menos fricción.
              </p>
              <div class="map-tags" aria-hidden="true">
                <span class="map-tag"><i class="fas fa-fire"></i> Precios vivos</span>
                <span class="map-tag"><i class="fas fa-layer-group"></i> Clusters inteligentes</span>
              </div>
            </div>
          </div>

          <button
            id="btn-satellite"
            type="button"
            aria-pressed="false"
            aria-label="Cambiar entre mapa y satélite"
            title="Cambiar mapa"
          >
            <img
              id="satellite-img"
              src="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/15/12242/16045"
              alt="Vista previa de la capa alternativa"
            />
            <span class="label">SATÉLITE</span>
          </button>

          <div id="map" aria-label="Mapa de estaciones"></div>

          <div id="loading" role="status" aria-live="polite" hidden>
            <div class="loading-box">
              <div class="spinner"></div>
              <p class="loading-title">Sincronizando estaciones…</p>
              <p class="loading-subtitle">Preparando filtros, lista y mapa</p>
            </div>
          </div>

          <section id="legend" aria-label="Leyenda de precio relativo">
            <h2>Leyenda</h2>
            <div class="legend-item"><span class="legend-dot badge-green"></span> Más barato</div>
            <div class="legend-item"><span class="legend-dot badge-yellow"></span> Intermedio</div>
            <div class="legend-item"><span class="legend-dot badge-red"></span> Más caro</div>
            <div class="legend-item"><span class="legend-dot badge-gray"></span> Sin precio</div>
          </section>
        </main>
      </div>
    </div>

    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
    <script src="https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js"></script>
    <script type="module" src="/static/app.js"></script>
  </body>
</html>`
}
