import { getStyles } from './styles'
import { getClientScript } from './client'
import { APP_VERSION } from '../lib/version'

export interface SeoContext {
  // Contexto SEO por ruta (provincia/municipio). Si falta, page genera la
  // version generica /. Si viene, sobreescribe title/description/canonical y
  // expone window.__SEO__ en el cliente para que autoseleccione el dropdown.
  provinciaId?: string
  provinciaSlug?: string
  provinciaName?: string
  // Futuro: municipioId / municipioSlug / municipioName
}

export interface BuildPageOpts {
  // Site key publica de Cloudflare Turnstile. Si esta presente, inyectamos el
  // widget (invisible) para /api/ingest. En dev (sin claves) se omite.
  turnstileSiteKey?: string
  // Contexto SEO (rutas /gasolineras/<slug>).
  seo?: SeoContext
}

export function buildPage(
  nonce: string = '',
  reqUrl: string = 'https://gasolineras.pages.dev/',
  opts: BuildPageOpts = {},
): string {
  // Base URL (origen) para meta tags canonicos / OG. En Workers reqUrl llega como absoluto.
  let origin = 'https://gasolineras.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }
  const seo = opts.seo
  const pathname = seo?.provinciaSlug ? ('/gasolineras/' + seo.provinciaSlug) : '/'
  const canonical = origin + pathname
  const pageTitle = seo?.provinciaName
    ? 'Gasolineras en ' + seo.provinciaName + ' · Precios oficiales'
    : 'Gasolineras España · Precios oficiales en tiempo real'
  const pageDesc = seo?.provinciaName
    ? 'Precios actualizados de gasolina y diésel en ' + seo.provinciaName + '. Mapa interactivo, comparador y favoritos con datos oficiales del Ministerio.'
    : 'Precios oficiales de gasolineras en España en tiempo real. Mapa, comparador de ahorro, favoritos y modo offline. Datos del Ministerio para la Transición Ecológica.'
  const ogTitle = seo?.provinciaName
    ? 'Gasolineras en ' + seo.provinciaName + ' · Precios oficiales'
    : 'Gasolineras España · Precios en tiempo real'
  const ogDesc = seo?.provinciaName
    ? 'Mapa de precios de combustible en ' + seo.provinciaName + ', actualizados a diario. Datos oficiales.'
    : 'Encuentra la gasolinera más barata cerca de ti. Datos oficiales del Ministerio, actualizados a diario.'
  // Los crawlers de Twitter/Facebook/LinkedIn no renderizan SVG en previews: usamos PNG 1200x630.
  const ogImage   = origin + '/static/og.png'
  const logoUrl   = origin + '/static/logo.svg'

  // Turnstile: solo inyectamos si hay site key. El widget se carga en modo
  // invisible — auto-ejecuta en pageload y el resultado llega por callback
  // (window.__onTsOk / window.__onTsExpired). Guardamos el token en
  // window.__TS_TOKEN__ para que la telemetria de /api/ingest lo adjunte.
  // El script se carga async con nonce (coincide con la CSP).
  const tsKey = opts.turnstileSiteKey
  const turnstileScripts = tsKey
    ? `<script nonce="${nonce}">
window.__TS_KEY__=${JSON.stringify(tsKey)};
window.__TS_TOKEN__='';
window.__onTsOk=function(t){ window.__TS_TOKEN__ = t || ''; };
window.__onTsExpired=function(){ window.__TS_TOKEN__ = ''; };
</script>
<script defer async
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        nonce="${nonce}"></script>`
    : ''

  // Contexto SEO expuesto al cliente: el script arranque autoseleccionara el
  // dropdown de provincia si hay un provinciaId (via ruta /gasolineras/<slug>).
  // Queda como window.__SEO__ y el cliente lo lee en initMap().
  const seoScript = seo?.provinciaId
    ? `<script nonce="${nonce}">window.__SEO__=${JSON.stringify({
        provinciaId: seo.provinciaId,
        provinciaSlug: seo.provinciaSlug,
        provinciaName: seo.provinciaName,
      })};</script>`
    : ''

  // JSON-LD: declara la aplicacion como WebApplication + el dataset de precios.
  // Breadcrumbs: solo en rutas provinciales. Ayuda a Google a entender la
  // jerarquia y a pintar migas en los resultados.
  const breadcrumbs = seo?.provinciaName ? [{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Inicio', item: origin + '/' },
      { '@type': 'ListItem', position: 2, name: 'Gasolineras en ' + seo.provinciaName, item: canonical },
    ],
  }] : []
  const jsonLd = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Gasolineras España',
      url: canonical,
      description: pageDesc,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      inLanguage: 'es-ES',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      softwareVersion: APP_VERSION,
      image: ogImage,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: seo?.provinciaName ? 'Precios de carburantes en ' + seo.provinciaName : 'Precios de carburantes en España',
      description: 'Snapshot oficial de precios de estaciones de servicio terrestres.',
      license: 'https://datos.gob.es/es/catalogo/e05068001-precio-de-carburantes-en-las-gasolineras-espanolas',
      creator: { '@type': 'GovernmentOrganization', name: 'Ministerio para la Transición Ecológica y el Reto Demográfico' },
      spatialCoverage: { '@type': 'Place', name: seo?.provinciaName || 'España' },
      inLanguage: 'es',
    },
    ...breadcrumbs,
  ])

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#16a34a" />
  <meta name="color-scheme" content="light dark" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Gasolineras" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="application-name" content="Gasolineras España" />
  <meta name="author" content="Gasolineras España" />
  <meta name="generator" content="Hono + Cloudflare Pages" />
  <meta name="description" content="${pageDesc}" />
  <meta name="keywords" content="gasolineras, precios combustible, gasolina, diesel, España, mapa gasolineras, ahorro combustible${seo?.provinciaName ? ', ' + seo.provinciaName.toLowerCase() : ''}" />

  <!-- Open Graph / redes -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Gasolineras España" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:alt" content="Gasolineras España · comparador de precios oficial" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="es_ES" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="${ogImage}" />
  <meta name="twitter:image:alt" content="Gasolineras España · comparador de precios oficial" />

  <link rel="canonical" href="${canonical}" />
  <title>${pageTitle}</title>

  <!-- Favicon / PWA icons -->
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png" />
  <link rel="mask-icon" href="/static/favicon.svg" color="#16a34a" />
  <link rel="manifest" href="/manifest.json" />

  <!-- Preconnect a hosts criticos: reduce handshake en LCP -->
  <link rel="preconnect" href="https://sedeaplicaciones.minetur.gob.es" />
  <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://b.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://d.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://unpkg.com" crossorigin />
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
  <link rel="dns-prefetch" href="https://nominatim.openstreetmap.org" />

  <!-- Leaflet CSS (critico para map) -->
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <!-- Leaflet JS (defer: parse HTML sin bloquear, ejecutar antes de DOMContentLoaded) -->
  <script defer
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>

  <!-- Marker Cluster -->
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css"
        integrity="sha384-lPzjPsFQL6te2x+VxmV6q1DpRxpRk0tmnl2cpwAO5y04ESyc752tnEWPKDfl1olr"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css"
        integrity="sha384-5kMSQJ6S4Qj5i09mtMNrWpSi8iXw230pKU76xTmrpezGnNJQzj0NzXjQLLg+jE7k"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <script defer
          src="https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js"
          integrity="sha384-RLIyj5q1b5XJTn0tqUhucRZe40nFTocRP91R/NkRJHwAe4XxnTV77FXy/vGLiec2"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>

  <!-- FontAwesome -->
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
        integrity="sha384-iw3OoTErCYJJB9mCa8LNS2hbsQ7M3C0EpIsO/H5+EGAkPGc6rk+V8i04oW/K5xq0"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />

  <!-- JSON-LD para SEO / rich results -->
  <script type="application/ld+json" nonce="${nonce}">${jsonLd}</script>

  ${seoScript}
  ${turnstileScripts}

  ${getStyles(nonce)}
</head>
<body>

<!-- ============ HEADER ============ -->
<header id="app-header">
  <button id="btn-toggle-sidebar" title="Abrir filtros" aria-label="Abrir panel de filtros">
    <i class="fas fa-bars u-c-white u-fs-16" aria-hidden="true"></i>
  </button>

  <a href="/" id="brand" class="brand-link" aria-label="Gasolineras España · inicio">
    <img src="${logoUrl}" width="32" height="32" alt="" class="header-logo-img" decoding="async" />
    <div class="u-mw-0">
      <div class="header-title">Gasolineras España</div>
      <div class="header-sub">Precios oficiales · Ministerio de Industria y Energía</div>
    </div>
  </a>

  <div class="header-actions">
    <span id="lbl-update" class="header-update u-hide"></span>
    <span id="lbl-count" class="header-badge u-hide"></span>
    <!-- Acceso a favoritas: abre el modal con la lista + alertas. La estrella
         se rellena cuando hay >=1 favorita, y la insignia numerica solo se
         muestra en ese caso. -->
    <button id="btn-favs" class="btn-header-fav" title="Mis favoritas" aria-label="Ver mis favoritas">
      <i class="far fa-star" id="btn-favs-icon" aria-hidden="true"></i>
      <span id="fav-badge" class="fav-badge" hidden>0</span>
    </button>
    <!-- Ruta optima A->B: abre modal para buscar las mas baratas del trayecto -->
    <button id="btn-route" class="btn-header-fav" title="Ruta: mejores gasolineras del trayecto" aria-label="Planificar ruta con gasolineras">
      <i class="fas fa-route" aria-hidden="true"></i>
    </button>
    <!-- Diario de repostajes: gasto mensual real + consumo real + top estaciones -->
    <button id="btn-diary" class="btn-header-fav" title="Mi diario de repostajes" aria-label="Abrir diario de repostajes">
      <i class="fas fa-book" aria-hidden="true"></i>
    </button>
    <button id="btn-dark" title="Modo oscuro / claro" aria-label="Alternar tema claro u oscuro"><i class="fas fa-moon" aria-hidden="true"></i></button>
  </div>
</header>

<!-- Banner offline -->
<div id="offline-banner" role="status" aria-live="polite">
  <i class="fas fa-wifi u-mr-6 u-op-80" aria-hidden="true"></i>
  <span id="offline-text">Sin conexión · mostrando datos guardados</span>
</div>

<!-- Banner datos desactualizados (>24h) -->
<div id="stale-banner" role="status" aria-live="polite">
  <i class="fas fa-hourglass-half u-mr-6" aria-hidden="true"></i>
  <span id="stale-text">Los datos oficiales llevan más de 24 h sin actualizarse.</span>
</div>

<!-- Tendencia nacional: ultra-compacta, se puebla via JS con trends.json.
     Oculta por defecto y solo se muestra cuando hay deltas computables
     (segundo snapshot en adelante). -->
<div id="trend-strip" role="status" aria-live="polite" hidden>
  <span class="trend-strip-label">Hoy en España:</span>
  <span class="trend-strip-item" id="trend-g95"></span>
  <span class="trend-strip-sep">·</span>
  <span class="trend-strip-item" id="trend-diesel"></span>
  <button id="trend-strip-close" class="trend-strip-close" aria-label="Ocultar tendencia">&times;</button>
</div>

<!-- ============ CUERPO ============ -->
<div id="app-body">

  <!-- ======= SIDEBAR ======= -->
  <aside id="sidebar">

    <!-- FILTROS -->
    <div id="sidebar-filters">
      <div class="search-heading-row">
        <span class="search-heading">
          <i class="fas fa-sliders-h u-c-green" aria-hidden="true"></i> Búsqueda
        </span>
        <div class="search-actions">
          <button id="btn-share" class="btn-icon" title="Compartir búsqueda" aria-label="Compartir búsqueda actual">
            <i class="fas fa-share-alt" aria-hidden="true"></i>
          </button>
          <button id="btn-geolocate" class="btn-icon" title="Usar mi ubicación" aria-label="Usar mi ubicación">
            <i class="fas fa-crosshairs" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="sel-provincia">Provincia</label>
        <select id="sel-provincia" class="form-select">
          <option value="">-- Selecciona --</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="sel-municipio">Municipio</label>
        <select id="sel-municipio" class="form-select" disabled>
          <option value="">-- Todos --</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="sel-combustible">Combustible</label>
        <select id="sel-combustible" class="form-select">
          <option value="Precio Gasolina 95 E5">Gasolina 95 E5</option>
          <option value="Precio Gasolina 98 E5">Gasolina 98 E5</option>
          <option value="Precio Gasoleo A">Gasoleo A (Diesel)</option>
          <option value="Precio Gasoleo Premium">Gasoleo Premium</option>
          <option value="Precio Gases licuados del petroleo">GLP (Autogas)</option>
          <option value="Precio Gas Natural Comprimido">Gas Natural (GNC)</option>
          <option value="Precio Gas Natural Licuado">Gas Natural (GNL)</option>
          <option value="Precio Hidrogeno">Hidrogeno</option>
          <option value="Precio Diesel Renovable">Diesel Renovable</option>
        </select>
      </div>

      <div class="form-group u-pos-rel">
        <label class="form-label" for="search-text">Buscar gasolinera</label>
        <div class="input-icon-wrap">
          <i class="fas fa-search icon" aria-hidden="true"></i>
          <input id="search-text" class="form-input" type="text" placeholder="Repsol, BP, Cepsa..." autocomplete="off" />
        </div>
        <div id="search-suggestions" role="listbox"></div>
      </div>

      <div class="row">
        <div class="flex-1">
          <label class="form-label" for="sel-orden">Ordenar</label>
          <select id="sel-orden" class="form-select">
            <option value="asc">Precio &#x2191; (más barato)</option>
            <option value="desc">Precio &#x2193; (más caro)</option>
            <option value="cerca">Cerca + barato (mixto)</option>
            <option value="dist">Distancia</option>
            <option value="az">Nombre A&#x2192;Z</option>
          </select>
        </div>
        <button id="btn-buscar" class="btn-primary" aria-label="Buscar gasolineras">
          <i class="fas fa-search" aria-hidden="true"></i> Buscar
        </button>
      </div>

      <!-- Filtros avanzados: operan sobre resultados ya cargados, por eso se
           aplican en vivo (no requieren "Buscar" de nuevo). Van en una caja
           colapsable para no saturar al usuario que no los necesita. -->
      <details class="adv-filters" id="adv-filters">
        <summary class="adv-filters-summary">
          <i class="fas fa-filter" aria-hidden="true"></i>
          <span>Filtros avanzados</span>
          <span class="adv-filters-count" id="adv-filters-count" aria-hidden="true"></span>
        </summary>
        <div class="adv-filters-body">
          <div class="chip-row">
            <label class="chip-check">
              <input type="checkbox" id="flt-abierto" />
              <span>&#x1F7E2; Abierto ahora</span>
            </label>
            <label class="chip-check">
              <input type="checkbox" id="flt-24h" />
              <span>&#x1F319; 24 horas</span>
            </label>
          </div>
          <div class="form-group u-mt-10 u-mb-0">
            <label class="form-label" for="sel-marca">Marca</label>
            <select id="sel-marca" class="form-select">
              <option value="">-- Cualquiera --</option>
              <option value="REPSOL">Repsol</option>
              <option value="CEPSA">Cepsa</option>
              <option value="MOEVE">Moeve</option>
              <option value="GALP">Galp</option>
              <option value="BALLENOIL">Ballenoil</option>
              <option value="PLENERGY">Plenergy</option>
              <option value="SHELL">Shell</option>
              <option value="PETROPRIX">Petroprix</option>
              <option value="PETRONOR">Petronor</option>
              <option value="CARREFOUR">Carrefour</option>
              <option value="BP">BP</option>
              <option value="AVIA">Avia</option>
              <option value="Q8">Q8</option>
              <option value="CAMPSA">Campsa</option>
              <option value="ESCLATOIL">Esclatoil</option>
              <option value="ALCAMPO">Alcampo</option>
              <option value="EROSKI">Eroski</option>
              <option value="BONAREA">BonÀrea</option>
              <option value="MEROIL">Meroil</option>
              <option value="__LOWCOST__">Low-cost (sin marca conocida)</option>
            </select>
          </div>
        </div>
      </details>

      <!-- Radio de busqueda (cerca-de-mi) -->
      <div class="form-group u-hide" id="radius-group">
        <label class="form-label" for="in-radius">Radio de búsqueda</label>
        <div class="range-group">
          <input id="in-radius" type="range" min="1" max="50" step="1" value="10" aria-label="Radio en kilómetros" />
          <span class="range-val" id="lbl-radius">10 km</span>
        </div>
      </div>

      <!-- Deposito del vehiculo (para calculo de ahorro) -->
      <div class="form-group">
        <label class="form-label" for="in-tank">Depósito <span class="tank-sub">(para calcular ahorro)</span></label>
        <div class="range-group">
          <input id="in-tank" type="range" min="20" max="120" step="5" value="50" aria-label="Capacidad del depósito en litros" />
          <span class="range-val" id="lbl-tank">50 L</span>
        </div>
      </div>

      <!-- Widget de gasto mensual (se activa tras onboarding) -->
      <div id="monthly-widget" role="region" aria-label="Gasto estimado mensual">
        <div class="mw-title">&#x1F4CA; Gasto estimado mensual</div>
        <div class="mw-cost" id="mw-cost">--</div>
        <div class="mw-sub" id="mw-sub">--</div>
      </div>

      <!-- Edit perfil -->
      <button id="btn-profile" class="btn-ghost btn-profile-util">
        <i class="fas fa-user-cog u-mr-6" aria-hidden="true"></i>
        <span id="btn-profile-label">Configurar mi vehículo</span>
      </button>
    </div>

    <!-- STATS -->
    <div id="stats-bar">
      <div class="stats-flex">
        <span class="u-c-slate"><i class="fas fa-map-marker-alt u-c-green u-mr-4" aria-hidden="true"></i><strong id="stat-n">0</strong> gasolineras</span>
        <span class="stat-chip">&#x2193; <span id="stat-min">--</span></span>
        <span class="stat-chip yellow">&#x2248; <span id="stat-avg">--</span></span>
        <span class="stat-chip red">&#x2191; <span id="stat-max">--</span></span>
      </div>
    </div>

    <!-- LISTA -->
    <div id="station-list" aria-label="Lista de gasolineras" aria-live="polite" aria-busy="false">
      <div class="empty-state">
        <div class="icon" aria-hidden="true">&#x1F5FA;&#xFE0F;</div>
        <p>Selecciona una provincia</p>
        <small>Se cargarán todas las gasolineras con sus precios actualizados</small>
      </div>
    </div>

  </aside>

  <!-- Backdrop mobile -->
  <div id="sidebar-backdrop"></div>

  <!-- ======= MAPA ======= -->
  <div id="map-container">
    <div id="map" role="region" aria-label="Mapa de gasolineras"></div>

    <!-- Banner "modo ruta" flotante sobre el mapa. Se activa al planificar
         una ruta y se oculta al cerrar el modo. -->
    <div id="route-mode-bar" class="route-mode-bar" role="status" aria-live="polite">
      <span class="route-mode-bar-text" id="route-mode-bar-text">Modo ruta activo</span>
      <span class="route-mode-bar-nav" id="route-mode-bar-nav" aria-label="Abrir ruta en">
        <a id="nav-gmaps" href="#" target="_blank" rel="noopener" title="Abrir ruta en Google Maps">Google</a>
        <a id="nav-amaps" href="#" target="_blank" rel="noopener" title="Abrir ruta en Apple Maps">Apple</a>
        <a id="nav-waze"  href="#" target="_blank" rel="noopener" title="Abrir destino en Waze (no admite paradas)">Waze</a>
      </span>
      <button id="route-mode-bar-exit" class="route-mode-bar-exit" type="button">Salir de la ruta</button>
    </div>

    <!-- Loading -->
    <div id="loading" role="status" aria-live="polite">
      <div class="loading-box">
        <div class="spinner" aria-hidden="true"></div>
        <p class="loading-line-1">Cargando gasolineras...</p>
        <p class="loading-line-2">Datos oficiales del Ministerio</p>
      </div>
    </div>

    <!-- INFO CARD -->
    <div id="map-info">
      <div class="info-title">&#x26FD; Gasolineras en directo</div>
      <div class="info-desc">Localiza estaciones al instante, revisa su contexto y compara el precio elegido con menos fricción.</div>
    </div>

    <!-- LEYENDA -->
    <div id="legend" aria-label="Leyenda de precios">
      <h4>LEYENDA</h4>
      <div class="legend-item"><span class="legend-dot dot-green" aria-hidden="true"></span> Más barato</div>
      <div class="legend-item"><span class="legend-dot dot-orange" aria-hidden="true"></span> Intermedio</div>
      <div class="legend-item"><span class="legend-dot dot-red" aria-hidden="true"></span> Más caro</div>
      <div class="legend-item u-mb-0"><span class="legend-dot dot-gray" aria-hidden="true"></span> Sin precio</div>
    </div>
  </div>

</div><!-- end app-body -->

<!-- ============ MODAL ONBOARDING / PERFIL ============ -->
<div id="modal-profile" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-title">
  <div class="modal">
    <div class="modal-header">
      <h2 id="profile-title">&#x26FD; Personaliza tu experiencia</h2>
      <p>Solo se guarda en tu navegador. Puedes cambiarlo cuando quieras.</p>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">&#x26FD; Qué combustible usas</label>
        <div id="chips-fuel" class="chip-group" role="radiogroup" aria-label="Combustible">
          <button class="chip" data-fuel="Precio Gasolina 95 E5"   role="radio">Gasolina 95</button>
          <button class="chip" data-fuel="Precio Gasolina 98 E5"   role="radio">Gasolina 98</button>
          <button class="chip" data-fuel="Precio Gasoleo A"        role="radio">Diesel</button>
          <button class="chip" data-fuel="Precio Gasoleo Premium"  role="radio">Diesel Premium</button>
          <button class="chip" data-fuel="Precio Gases licuados del petroleo" role="radio">GLP</button>
          <button class="chip" data-fuel="Precio Hidrogeno"        role="radio">Hidrogeno</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">&#x1F6E3;&#xFE0F; Kilómetros que haces al mes</label>
        <div id="chips-km" class="chip-group" role="radiogroup" aria-label="Kilómetros al mes">
          <button class="chip" data-km="500"   role="radio">~500 km</button>
          <button class="chip" data-km="1000"  role="radio">~1.000 km</button>
          <button class="chip" data-km="1500"  role="radio">~1.500 km</button>
          <button class="chip" data-km="2500"  role="radio">~2.500 km</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="in-consumo">&#x1F4A7; Consumo medio (L/100km)</label>
        <div class="range-group">
          <input id="in-consumo" type="range" min="3" max="15" step="0.5" value="6.5" aria-label="Consumo en litros por 100 kilómetros" />
          <span class="range-val" id="lbl-consumo">6,5 L</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="in-tank-modal">&#x26FD; Capacidad del depósito</label>
        <div class="range-group">
          <input id="in-tank-modal" type="range" min="20" max="120" step="5" value="50" aria-label="Capacidad del depósito en litros" />
          <span class="range-val" id="lbl-tank-modal">50 L</span>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-profile-skip"  class="btn-ghost">Ahora no</button>
      <button id="btn-profile-save"  class="btn-primary">Guardar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL FAVORITAS ============ -->
<!-- Se abre desde el boton estrella del header. Solo contiene la lista de
     gasolineras favoritas. Al hacer click en una, el modal cierra y el
     cliente navega (provincia + municipio + texto de busqueda) para dejar en
     el mapa unicamente esa estacion. Alertas (navegador/email) se dejan
     para un release posterior; el flujo actual es 100% navegacion. -->
<div id="modal-favs" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="favs-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="favs-title">&#x2B50; Mis favoritas (<span id="favs-modal-count">0</span>)</h2>
        <p>Haz click en una favorita para verla en el mapa.</p>
      </div>
      <button id="btn-favs-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <!-- Lista de favoritas -->
      <div id="favs-list-wrap">
        <div id="favs-empty" class="favs-empty">
          <i class="far fa-star" aria-hidden="true"></i>
          Aun no tienes favoritas. Pulsa la estrella en el popup de una gasolinera para guardarla.
        </div>
        <div id="favs-list"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-favs-done" class="btn-primary">Cerrar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL RUTA A->B ============ -->
<!-- Busca la TOP-N de gasolineras mas baratas dentro de un corredor a lo
     largo del trayecto entre dos puntos (origen + destino). Reutiliza
     /api/geocode/search (Nominatim proxy) para resolver los nombres a
     coordenadas; el filtrado corredor + ranking es 100% cliente. -->
<div id="modal-route" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="route-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="route-title">&#x1F6E3;&#xFE0F; Ruta: d&oacute;nde repostar</h2>
        <p>Te decimos en qu&eacute; gasolineras parar seg&uacute;n tu autonom&iacute;a y el precio.</p>
      </div>
      <button id="btn-route-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="route-from">Origen</label>
        <input id="route-from" class="form-input" type="text" placeholder="Madrid, Valencia, ..." autocomplete="off" />
        <div id="route-from-sug" class="route-sug" role="listbox"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="route-to">Destino</label>
        <input id="route-to" class="form-input" type="text" placeholder="Barcelona, Sevilla, ..." autocomplete="off" />
        <div id="route-to-sug" class="route-sug" role="listbox"></div>
      </div>
      <div class="form-group">
        <label class="form-label" for="route-range-km">Autonom&iacute;a actual del coche (km)</label>
        <input id="route-range-km" class="form-input" type="number" min="20" max="2000" step="10" value="500" inputmode="numeric" />
        <p class="form-help" id="route-autonomy-lbl">Cu&aacute;ntos km puedes conducir antes de parar a repostar. Si sales con el dep&oacute;sito lleno, pon la autonom&iacute;a m&aacute;xima de tu coche.</p>
      </div>
      <div class="form-group">
        <label class="form-label" for="route-width">Ancho del corredor (desv&iacute;o m&aacute;ximo)</label>
        <div class="range-group">
          <input id="route-width" type="range" min="1" max="10" step="1" value="3" aria-label="Ancho del corredor en kilometros" />
          <span class="range-val" id="route-width-lbl">3 km</span>
        </div>
      </div>
      <div id="route-status" class="route-status" aria-live="polite"></div>
      <div id="route-plan" class="route-plan" aria-live="polite"></div>
      <div id="route-results" class="route-results"></div>
    </div>
    <div class="modal-footer">
      <button id="btn-route-go" class="btn-primary">Planificar</button>
      <button id="btn-route-done" class="btn-ghost">Cerrar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL DIARIO DE REPOSTAJES ============ -->
<!-- Registro local (localStorage) de cada repostaje: litros, €/L, km totales.
     Calcula consumo real L/100km, gasto total, medias, y exporta CSV.
     Privacidad total: nada sale del navegador. -->
<div id="modal-diary" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="diary-title">
  <div class="modal diary-modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="diary-title">&#x1F4D6; Mi diario de repostajes</h2>
        <p>Lleva la cuenta real de tu consumo y ahorro. Todo se guarda solo en tu navegador.</p>
      </div>
      <button id="btn-diary-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div id="diary-stats" class="diary-stats" aria-live="polite">
        <div class="diary-stat"><div class="ds-label">Entradas</div><div class="ds-value" id="ds-entries">0</div></div>
        <div class="diary-stat"><div class="ds-label">Gasto total</div><div class="ds-value" id="ds-spent">0 &euro;</div></div>
        <div class="diary-stat"><div class="ds-label">Media &euro;/L</div><div class="ds-value" id="ds-avg">--</div></div>
        <div class="diary-stat"><div class="ds-label">Km recorridos</div><div class="ds-value" id="ds-km">0</div></div>
        <div class="diary-stat"><div class="ds-label">Consumo real</div><div class="ds-value" id="ds-cons">--</div></div>
        <div class="diary-stat"><div class="ds-label">Litros cargados</div><div class="ds-value" id="ds-liters">0 L</div></div>
      </div>

      <div class="diary-form">
        <h3 class="diary-subtitle">&#x2795; Nuevo repostaje</h3>
        <div class="diary-form-row">
          <div class="form-group">
            <label class="form-label" for="diary-litros">Litros</label>
            <input id="diary-litros" class="form-input" type="number" step="0.01" min="0.1" placeholder="40.00" />
          </div>
          <div class="form-group">
            <label class="form-label" for="diary-price">&euro;/L</label>
            <input id="diary-price" class="form-input" type="number" step="0.001" min="0.1" placeholder="1.529" />
          </div>
          <div class="form-group">
            <label class="form-label" for="diary-km">Km totales</label>
            <input id="diary-km" class="form-input" type="number" step="1" min="0" placeholder="42850" />
          </div>
          <div class="form-group">
            <label class="form-label" for="diary-date">Fecha</label>
            <input id="diary-date" class="form-input" type="date" />
          </div>
        </div>
        <button id="btn-diary-add" class="btn-primary">Guardar repostaje</button>
      </div>

      <div class="diary-list-wrap">
        <h3 class="diary-subtitle">&#x1F5C3;&#xFE0F; Historial</h3>
        <div id="diary-empty" class="favs-empty">
          Aun no hay repostajes. Anade el primero arriba y cada vez que llenes.
        </div>
        <div id="diary-list" class="diary-list"></div>
      </div>
    </div>
    <div class="modal-footer diary-footer">
      <button id="btn-diary-export" class="btn-ghost" title="Exportar CSV">&#x2B07;&#xFE0F; Exportar CSV</button>
      <button id="btn-diary-clear" class="btn-ghost" title="Borrar todo el diario">&#x1F5D1;&#xFE0F; Borrar todo</button>
      <button id="btn-diary-done" class="btn-primary">Cerrar</button>
    </div>
  </div>
</div>

${tsKey ? `<!-- Turnstile invisible widget para proteger /api/ingest sin UX intrusiva -->
<div id="ts-widget"
     class="cf-turnstile ts-widget-hidden"
     data-sitekey="${tsKey}"
     data-size="invisible"
     data-appearance="interaction-only"
     data-callback="__onTsOk"
     data-expired-callback="__onTsExpired"
     aria-hidden="true"></div>` : ''}

${getClientScript(nonce, APP_VERSION)}
</body>
</html>`
}
