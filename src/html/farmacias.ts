// Pagina `/farmacias/` del portal CercaYa — MVP nacional.
//
// Vision del usuario:
//   "Que segun la ubicacion del usuario le diga las farmacias de su
//   municipio con todos horarios y todo lo que pueda tener, que le diga
//   las farmacias de guardia de esa misma semana, que pueda seleccionar
//   esa farmacia y le diga en un gps a cuanto esta de la farmacia."
//
// Funcionalidad actual:
//   - Snapshot nacional de OSM (~18k farmacias) con name/addr/phone/hours.
//   - Geolocalizacion opcional: si el usuario acepta, ordenamos por
//     distancia Haversine y centramos el mapa en su posicion.
//   - Filtro por radio (2km / 5km / 10km).
//   - Lista con top-50 mas cercanas para no saturar el DOM.
//   - Mapa con clustering (Leaflet + markercluster — vendor ya servido
//     por el proyecto desde /static/vendor/map/).
//   - Ficha por farmacia: nombre, direccion, tel: tap-to-call, horario
//     crudo de OSM, boton "Como llegar" (Google Maps / Apple Maps).
//
// Guardias (Fases 2-8 — Madrid + Euskadi + A Coruña + Murcia + Almería +
// Girona + Tarragona + Córdoba + Cantabria + Pontevedra + Las Palmas +
// Alicante + Cádiz + Ceuta + Valencia):
//   - 17 ficheros /data/guardias-<territorio>.json cargados en paralelo
//     tras farmacias.json: madrid, bizkaia, gipuzkoa, alava, coruna, murcia,
//     almeria, girona, tarragona, cordoba, cantabria, pontevedra,
//     laspalmas, alicante, cadiz, ceuta, valencia.
//   - Si una farmacia OSM coincide (~100m) con una de guardia, aparece
//     con badge "DE GUARDIA" + horario en card y popup.
//   - Las guardias sin match OSM (porque el COF tiene farmacia que OSM no
//     indexa, o porque el matching fue impreciso) se pintan en el mapa
//     como marker dorado extra, sin entrar en la lista.
//   - Fases siguientes ampliaran a mas provincias segun disponibilidad.
//
// Arquitectura:
//   - HTML + CSS + JS inline con nonce (CSP strict compatible con el
//     resto del portal).
//   - Leaflet servido localmente desde /static/vendor/map/ (mismo vendor
//     que usa el mapa de gasolineras — cero CDN externo, menos latency
//     y adblockers friendly).
//   - JSON de farmacias descargado con fetch una sola vez, con cache HTTP
//     aprovechando ETag (Cloudflare Pages sirve ASSETS con ETag por
//     defecto).
//   - Distancia Haversine pura en el cliente. Radio filtrado en JS para
//     no tener que paginar/API-ficar.

import { APP_VERSION } from '../lib/version'

export function buildFarmaciasPage(
  nonce: string = '',
  reqUrl: string = 'https://webapp-3ft.pages.dev/farmacias/',
): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }

  const canonical = origin + '/farmacias/'
  const title = 'Farmacias en España · CercaYa'
  const desc = 'Farmacias cercanas en España con dirección, teléfono y horario. Usa tu ubicación para ver las más próximas ordenadas por distancia. Datos de OpenStreetMap, sin registro.'
  const logoUrl = origin + '/static/logo.svg'

  // JSON-LD: declaramos la pagina como WebPage + Service. Cuando tengamos
  // guardias, anyadiremos un Dataset por territorio.
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        name: title,
        url: canonical,
        description: desc,
        inLanguage: 'es-ES',
        isPartOf: {
          '@type': 'WebSite',
          name: 'CercaYa',
          url: origin,
        },
      },
      {
        '@type': 'Service',
        name: 'Farmacias España',
        description: desc,
        url: canonical,
        serviceType: 'Localización de farmacias',
        areaServed: { '@type': 'Country', name: 'España' },
        provider: {
          '@type': 'Organization',
          name: 'CercaYa',
          url: origin,
          logo: logoUrl,
        },
      },
    ],
  }

  const esc = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#14532d" />

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />

  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png" />
  <link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />

  <meta property="og:type" content="website" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:site_name" content="CercaYa" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(origin)}/static/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />

  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="generator" content="CercaYa v${APP_VERSION}" />

  <script type="application/ld+json" nonce="${nonce}">${JSON.stringify(jsonLd)}</script>

  <!-- Leaflet local (mismo vendor que el mapa de gasolineras) -->
  <link rel="stylesheet" href="/static/vendor/map/leaflet/leaflet.css" />
  <link rel="stylesheet" href="/static/vendor/map/leaflet.markercluster/MarkerCluster.css" />
  <link rel="stylesheet" href="/static/vendor/map/leaflet.markercluster/MarkerCluster.Default.css" />
  <script defer src="/static/vendor/map/leaflet/leaflet.js"></script>
  <script defer src="/static/vendor/map/leaflet.markercluster/leaflet.markercluster.js"></script>

  <style nonce="${nonce}">
    :root {
      --c-bg: #f8fafc;
      --c-surface: #ffffff;
      --c-text: #0f172a;
      --c-muted: #64748b;
      --c-brand-dark: #14532d;
      --c-brand: #16a34a;
      --c-brand-soft: #dcfce7;
      --c-border: #e2e8f0;
      --c-danger: #b91c1c;
      --c-info-bg: #e0f2fe;
      --c-info-text: #075985;
      --c-shadow: 0 4px 12px rgba(15,23,42,0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --c-bg: #0f172a;
        --c-surface: #1e293b;
        --c-text: #f1f5f9;
        --c-muted: #94a3b8;
        --c-brand-dark: #064e3b;
        --c-brand: #4ade80;
        --c-brand-soft: #064e3b;
        --c-border: #334155;
        --c-danger: #fca5a5;
        --c-info-bg: #0c4a6e;
        --c-info-text: #bae6fd;
        --c-shadow: 0 4px 12px rgba(0,0,0,0.3);
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: var(--c-bg);
      color: var(--c-text);
      line-height: 1.55;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    a { color: var(--c-brand-dark); }
    @media (prefers-color-scheme: dark) { a { color: var(--c-brand); } }
    /* ---- Hero compacto ---- */
    .hero {
      background: linear-gradient(135deg, var(--c-brand-dark) 0%, var(--c-brand) 100%);
      color: #ffffff;
      padding: 24px 24px 20px;
    }
    .hero-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      gap: 16px;
      flex-wrap: wrap;
    }
    .hero-back {
      color: #ffffff;
      text-decoration: none;
      font-size: 14px;
      padding: 6px 12px;
      border: 1px solid rgba(255,255,255,0.4);
      border-radius: 8px;
      transition: background 0.15s ease;
    }
    .hero-back:hover { background: rgba(255,255,255,0.1); }
    .hero-title { font-size: 22px; font-weight: 700; margin: 0; letter-spacing: -0.01em; flex: 1; }
    .hero-count { font-size: 13px; opacity: 0.92; }

    /* ---- Toolbar ---- */
    .toolbar {
      background: var(--c-surface);
      border-bottom: 1px solid var(--c-border);
      padding: 12px 24px;
    }
    .toolbar-inner {
      max-width: 1200px;
      margin: 0 auto;
      display: flex;
      gap: 12px;
      align-items: center;
      flex-wrap: wrap;
    }
    /* Usamos --c-brand-dark (#14532d) para los botones con texto blanco para
       cumplir WCAG AA (4.5:1). El --c-brand (#16a34a) sobre blanco da 3.29:1,
       por debajo del minimo para texto normal. Solo se puede usar brand claro
       como fondo si el texto va en bold >=18px (ratio minimo 3:1). */
    .btn {
      background: var(--c-brand-dark);
      color: #ffffff;
      border: 0;
      border-radius: 8px;
      padding: 8px 14px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: filter 0.15s ease;
    }
    .btn:hover, .btn:focus-visible {
      filter: brightness(1.15);
      outline: 2px solid var(--c-brand-dark);
      outline-offset: 2px;
    }
    .btn-ghost {
      background: transparent;
      color: var(--c-brand-dark);
      border: 1px solid var(--c-border);
    }
    @media (prefers-color-scheme: dark) {
      .btn-ghost { color: var(--c-brand); }
    }
    .btn-ghost:hover { background: var(--c-brand-soft); }
    .radius-group { display: inline-flex; border: 1px solid var(--c-border); border-radius: 8px; overflow: hidden; }
    .radius-group button {
      background: var(--c-surface);
      color: var(--c-text);
      border: 0;
      padding: 8px 12px;
      font-size: 13px;
      cursor: pointer;
      border-right: 1px solid var(--c-border);
    }
    .radius-group button:last-child { border-right: 0; }
    .radius-group button[aria-pressed="true"] {
      background: var(--c-brand-dark);
      color: #ffffff;
      font-weight: 600;
    }
    .status-msg {
      font-size: 13px;
      color: var(--c-muted);
      flex: 1;
      min-width: 180px;
    }
    .status-msg.error { color: var(--c-danger); }

    /* ---- Layout principal ---- */
    main {
      flex: 1;
      display: grid;
      grid-template-columns: minmax(320px, 420px) 1fr;
      gap: 0;
      max-width: 1400px;
      margin: 0 auto;
      width: 100%;
      min-height: 0;
    }
    .list-panel {
      background: var(--c-surface);
      border-right: 1px solid var(--c-border);
      overflow-y: auto;
      max-height: calc(100vh - 150px);
    }
    .list-panel ol {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    /* Stretched-link pattern: el <li> es un contenedor pasivo (sin role ni
       tabindex) y dentro hay un <button class="card-select"> cuyo ::before
       se estira sobre toda la tarjeta. Asi la zona de click es el card
       entero pero el unico focusable "del card" es ese boton. Los <a tel:>
       del .card-meta quedan en z-index superior y son focusables propios.
       De esta forma no violamos la regla axe no-focusable-content (ningun
       focusable envuelve a otro focusable). */
    .card {
      position: relative;
      padding: 14px 18px;
      border-bottom: 1px solid var(--c-border);
      transition: background 0.15s ease;
    }
    .card:hover,
    .card:focus-within {
      background: var(--c-brand-soft);
    }
    .card[aria-current="true"] {
      background: var(--c-brand-soft);
      border-left: 3px solid var(--c-brand);
      padding-left: 15px;
    }
    .card-select {
      background: transparent;
      border: 0;
      padding: 0;
      margin: 0;
      font: inherit;
      color: inherit;
      text-align: left;
      cursor: pointer;
      display: block;
      width: 100%;
    }
    .card-select::before {
      content: "";
      position: absolute;
      inset: 0;
      z-index: 0;
    }
    .card-select:focus-visible {
      outline: 2px solid var(--c-brand-dark);
      outline-offset: -4px;
    }
    .card-name {
      font-size: 15px;
      font-weight: 600;
      margin: 0 0 4px;
      color: var(--c-text);
    }
    .card-addr {
      font-size: 13px;
      color: var(--c-muted);
      margin: 0 0 6px;
    }
    .card-meta {
      position: relative;
      z-index: 1; /* por encima del ::before del card-select para que los
                     <a tel:> del meta sigan siendo clicables e independientes. */
      display: flex;
      gap: 12px;
      font-size: 12px;
      color: var(--c-muted);
      flex-wrap: wrap;
    }
    .card-dist {
      color: var(--c-brand-dark);
      font-weight: 600;
    }
    @media (prefers-color-scheme: dark) {
      .card-dist { color: var(--c-brand); }
    }
    /* Badge DE GUARDIA — rojo oscuro sobre amarillo palido, contraste WCAG AA.
       Solo aparece cuando la farmacia tiene match en los snapshots de guardia. */
    .badge-guardia {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      border-radius: 4px;
      background: #fef3c7;
      color: #78350f;
      font-weight: 700;
      font-size: 11px;
      letter-spacing: 0.02em;
      text-transform: uppercase;
      white-space: nowrap;
    }
    @media (prefers-color-scheme: dark) {
      .badge-guardia { background: #422006; color: #fcd34d; }
    }
    .guardia-horario {
      color: #78350f;
      font-size: 12px;
    }
    @media (prefers-color-scheme: dark) {
      .guardia-horario { color: #fcd34d; }
    }
    /* Marker de guardia sin match OSM: dorado con anillo rojo. */
    .guardia-pin-only {
      background: #f59e0b;
      color: #78350f;
      font-weight: 800;
      font-size: 14px;
      width: 28px; height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      border: 2px solid #b45309;
      box-shadow: 0 1px 3px rgba(0,0,0,.35);
    }
    .empty-state {
      padding: 40px 24px;
      text-align: center;
      color: var(--c-muted);
      font-size: 14px;
    }

    /* ---- Mapa ---- */
    #map {
      height: calc(100vh - 150px);
      min-height: 400px;
      background: var(--c-bg);
    }
    .leaflet-popup-content { font-size: 13px; line-height: 1.45; }
    .popup-name { font-weight: 600; font-size: 14px; margin: 0 0 4px; }
    .popup-addr { color: var(--c-muted); margin: 0 0 6px; }
    .popup-actions { display: flex; gap: 8px; margin-top: 8px; flex-wrap: wrap; }
    .popup-actions a {
      font-size: 12px;
      padding: 4px 10px;
      background: var(--c-brand-dark);
      color: #ffffff;
      text-decoration: none;
      border-radius: 6px;
    }
    .popup-actions a.secondary {
      background: transparent;
      color: var(--c-brand-dark);
      border: 1px solid var(--c-border);
    }

    /* ---- Footer ---- */
    footer {
      padding: 20px 24px;
      text-align: center;
      font-size: 12px;
      color: var(--c-muted);
      border-top: 1px solid var(--c-border);
      background: var(--c-surface);
    }
    footer a { text-decoration: underline; }
    footer a:hover { text-decoration: none; }

    /* ---- Responsive: stack en movil ---- */
    @media (max-width: 780px) {
      main { grid-template-columns: 1fr; }
      .list-panel { max-height: 45vh; border-right: 0; border-bottom: 1px solid var(--c-border); }
      #map { height: 55vh; min-height: 300px; }
      .hero { padding: 16px 20px 14px; }
      .hero-title { font-size: 18px; }
      .toolbar-inner { gap: 8px; }
      .btn { padding: 6px 10px; font-size: 13px; }
      .radius-group button { padding: 6px 8px; font-size: 12px; }
    }
  </style>
</head>
<body>
  <header class="hero">
    <div class="hero-inner">
      <a href="/" class="hero-back" aria-label="Volver a CercaYa">&larr; CercaYa</a>
      <h1 class="hero-title">Farmacias en España</h1>
      <span class="hero-count" id="hero-count" aria-live="polite"></span>
    </div>
  </header>

  <div class="toolbar">
    <div class="toolbar-inner">
      <button type="button" class="btn" id="btn-geo" aria-label="Usar mi ubicación para ordenar por cercanía">
        &#x1F4CD; Usar mi ubicación
      </button>
      <div class="radius-group" role="group" aria-label="Radio de búsqueda">
        <button type="button" data-r="2" aria-pressed="false">2 km</button>
        <button type="button" data-r="5" aria-pressed="true">5 km</button>
        <button type="button" data-r="10" aria-pressed="false">10 km</button>
      </div>
      <span class="status-msg" id="status-msg" aria-live="polite">Pulsa &laquo;Usar mi ubicación&raquo; para ordenar por cercanía.</span>
    </div>
  </div>

  <main>
    <aside class="list-panel" aria-label="Listado de farmacias">
      <ol id="list" aria-live="polite"></ol>
      <div class="empty-state" id="empty" hidden>
        Aún no hay ubicación. Pulsa &laquo;Usar mi ubicación&raquo; o mueve el mapa para explorar.
      </div>
    </aside>
    <section id="map" role="region" aria-label="Mapa de farmacias"></section>
  </main>

  <footer>
    <div>Datos de <a href="https://www.openstreetmap.org/copyright" rel="noopener">OpenStreetMap</a> (ODbL) · CercaYa v${APP_VERSION}</div>
  </footer>

  <script nonce="${nonce}">
  (function(){
    'use strict';

    // Estado global del cliente. Mantengo esto en un objeto para que sea
    // facil de inspeccionar desde devtools y para que el codigo no caiga
    // en closures accidentales.
    var state = {
      all: [],          // array crudo desde farmacias.json
      filtered: [],     // subset por radio + ubicacion
      user: null,       // { lat, lng } tras geolocalizacion
      radiusKm: 5,
      selected: null,   // indice en filtered
      map: null,
      cluster: null,
      userMarker: null,
      // Guardias agregadas de los 6 COF (Madrid + Euskadi + A Coruña + Murcia). Cada una sigue
      // el schema [lat, lng, direccion, poblacion, telefono, cp,
      // horarioGuardia, horarioGuardiaDesc]. Se carga en paralelo a
      // farmacias.json — si algun fetch falla, seguimos sin ese territorio.
      guardias: [],
      // Mapa "bucketKey -> guardia" para lookup O(1) al matchear una
      // farmacia OSM con una guardia. Clave = lat(4dec)_lng(4dec) que agrupa
      // en celdas de ~11m — suficientemente fino para no falsos matches y
      // lo bastante amplio para tolerar diferencias de coord de 1-2 decimales.
      guardiaByBucket: null,
      guardiaLayer: null, // L.layerGroup con markers de guardias sin match OSM
    };

    var el = function(id){ return document.getElementById(id); };
    var list = el('list');
    var statusMsg = el('status-msg');
    var empty = el('empty');
    var heroCount = el('hero-count');

    function setStatus(msg, isErr){
      statusMsg.textContent = msg;
      statusMsg.classList.toggle('error', !!isErr);
    }

    // Haversine. Radio de la Tierra en km. La aproximacion plana seria mas
    // rapida para distancias cortas pero la diferencia sobre 10km es <0.1m,
    // asi que no merece la pena.
    function haversine(lat1, lon1, lat2, lon2){
      var R = 6371;
      var dLat = (lat2 - lat1) * Math.PI / 180;
      var dLon = (lon2 - lon1) * Math.PI / 180;
      var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
      return 2 * R * Math.asin(Math.sqrt(a));
    }

    // Formatea una distancia en km a texto breve. <1km -> "450 m", resto -> "2.3 km".
    function fmtDist(km){
      if (km < 1) return Math.round(km * 1000) + ' m';
      return km.toFixed(1).replace('.', ',') + ' km';
    }

    // Clave de bucket para matcheo guardia<->OSM. 4 decimales = ~11m,
    // suficientemente permisivo para absorber el error de geocoding (~20m
    // en zonas urbanas) y estricto para no matchear la farmacia de al lado.
    // En la practica redondeamos a 3 decimales (~110m) tambien para tener
    // un segundo nivel mas tolerante — algunas guardias de Gipuzkoa vienen
    // de Nominatim con precision variable.
    function bucketKeyFine(lat, lng){
      return lat.toFixed(4) + '_' + lng.toFixed(4);
    }
    function bucketKeyCoarse(lat, lng){
      return lat.toFixed(3) + '_' + lng.toFixed(3);
    }

    // Devuelve la entrada de guardia asociada a una farmacia OSM, o null.
    // Intenta primero bucket fino (<11m) y luego grueso (<110m). La grueso
    // es para el caso "misma farmacia pero con una coord algo desplazada".
    function findGuardia(lat, lng){
      if (!state.guardiaByBucket) return null;
      var fine = state.guardiaByBucket.fine.get(bucketKeyFine(lat, lng));
      if (fine) return fine;
      var coarse = state.guardiaByBucket.coarse.get(bucketKeyCoarse(lat, lng));
      return coarse || null;
    }

    // Sanitiza texto para innerHTML. Mejor que atar el DOM a cadenas crudas.
    function esc(s){
      return String(s == null ? '' : s)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }

    // Construye el enlace a Maps. En iOS Safari, 'maps:' abre Apple Maps;
    // en todo lo demas vale el link https a Google Maps. Usamos este unico
    // patron que funciona para todos y deja que el SO decida.
    function mapsLink(lat, lng, label){
      var q = encodeURIComponent(label + ' @' + lat + ',' + lng);
      return 'https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&destination_name=' + q;
    }

    function updateHeroCount(){
      if (state.user){
        heroCount.textContent = state.filtered.length + ' farmacias a ≤' + state.radiusKm + ' km';
      } else {
        heroCount.textContent = state.all.length.toLocaleString('es-ES') + ' farmacias';
      }
    }

    // Refiltra por radio y usuario. Si no hay usuario, mostramos las 50 mas
    // cercanas al centro actual del mapa (para que la lista no quede vacia).
    function refilter(){
      var cx, cy;
      if (state.user){
        cx = state.user.lng; cy = state.user.lat;
      } else if (state.map){
        var c = state.map.getCenter();
        cx = c.lng; cy = c.lat;
      } else {
        state.filtered = [];
        renderList();
        return;
      }
      var r = state.radiusKm;
      var arr = [];
      for (var i = 0; i < state.all.length; i++){
        var f = state.all[i];
        var d = haversine(cy, cx, f[0], f[1]);
        if (!state.user || d <= r){
          arr.push({ idx: i, dist: d });
        }
      }
      arr.sort(function(a,b){ return a.dist - b.dist; });
      // Cap a 50 items para no saturar el DOM — el mapa muestra todos.
      state.filtered = arr.slice(0, 50);
      renderList();
      updateHeroCount();
    }

    function renderList(){
      list.innerHTML = '';
      if (state.filtered.length === 0){
        empty.hidden = false;
        if (state.user){
          setStatus('No hay farmacias en ' + state.radiusKm + ' km de tu ubicación. Prueba un radio mayor.');
        }
        return;
      }
      empty.hidden = true;
      var frag = document.createDocumentFragment();
      for (var i = 0; i < state.filtered.length; i++){
        var row = state.filtered[i];
        var f = state.all[row.idx];
        var g = findGuardia(f[0], f[1]); // guardia asociada o null
        var li = document.createElement('li');
        li.className = 'card' + (g ? ' card-guardia' : '');
        li.setAttribute('data-idx', String(row.idx));
        if (g) li.setAttribute('data-guardia', 'true');
        // Stretched-link: el boton envuelve nombre+direccion y su ::before
        // cubre toda la tarjeta. Asi todo el card es clickable sin que el
        // <li> sea focusable-ambiguo.
        var btnHtml =
          '<button type="button" class="card-select" data-idx="' + row.idx + '" aria-label="Ver ' + esc(f[2]) + ' en el mapa' + (g ? ' (de guardia)' : '') + '">' +
            '<p class="card-name">' + esc(f[2]) + '</p>' +
            (f[3] ? '<p class="card-addr">' + esc(f[3]) + '</p>' : '') +
          '</button>';
        var meta = [];
        meta.push('<span class="card-dist">' + esc(fmtDist(row.dist)) + '</span>');
        if (g) {
          // Badge + horario de guardia. El horario puede venir como "08:00 - 22:00"
          // o como null/vacio — no lo ocultamos si hay, aunque sea corto.
          meta.push('<span class="badge-guardia">De guardia</span>');
          if (g[6]) meta.push('<span class="guardia-horario">&#x1F550; ' + esc(g[6]) + '</span>');
        }
        if (f[4]) meta.push('<a href="tel:' + esc(f[4].replace(/\\s+/g,'')) + '">' + esc(f[4]) + '</a>');
        if (f[5]) meta.push('<span>' + esc(f[5].length > 40 ? f[5].slice(0,40) + '…' : f[5]) + '</span>');
        li.innerHTML = btnHtml + '<div class="card-meta">' + meta.join('') + '</div>';
        var btn = li.querySelector('.card-select');
        btn.addEventListener('click', onCardClick);
        frag.appendChild(li);
      }
      list.appendChild(frag);
    }

    function onCardClick(ev){
      var idx = parseInt(this.getAttribute('data-idx'), 10);
      selectFarmacia(idx, true);
    }

    function selectFarmacia(idx, panMap){
      state.selected = idx;
      // aria-current en la tarjeta activa
      var cards = list.querySelectorAll('.card');
      for (var i = 0; i < cards.length; i++){
        var c = cards[i];
        c.setAttribute('aria-current', c.getAttribute('data-idx') === String(idx) ? 'true' : 'false');
      }
      if (!state.map) return;
      var f = state.all[idx];
      if (panMap) state.map.setView([f[0], f[1]], Math.max(state.map.getZoom(), 15));
      // Abrir el popup del marker correspondiente
      var m = markers[idx];
      if (m && state.map.hasLayer(state.cluster)){
        state.cluster.zoomToShowLayer(m, function(){
          m.openPopup();
        });
      }
    }

    // Geolocalizacion. Pedimos con high accuracy porque las farmacias son
    // a nivel calle — un GPS de ~10m ayuda. Timeout 15s para no dejar al
    // usuario esperando indefinidamente.
    function requestLocation(){
      if (!navigator.geolocation){
        setStatus('Tu navegador no admite geolocalización.', true);
        return;
      }
      setStatus('Obteniendo tu ubicación…');
      navigator.geolocation.getCurrentPosition(function(pos){
        state.user = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setStatus('Ubicación detectada. Mostrando farmacias a ≤' + state.radiusKm + ' km.');
        if (state.map){
          state.map.setView([state.user.lat, state.user.lng], 14);
          if (state.userMarker) state.map.removeLayer(state.userMarker);
          state.userMarker = L.circleMarker([state.user.lat, state.user.lng], {
            radius: 8, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.6, weight: 2
          }).addTo(state.map).bindTooltip('Tu ubicación', { permanent: false });
        }
        refilter();
      }, function(err){
        var msg = 'No se pudo obtener tu ubicación.';
        if (err && err.code === err.PERMISSION_DENIED) msg = 'Has denegado el permiso de ubicación.';
        else if (err && err.code === err.POSITION_UNAVAILABLE) msg = 'Ubicación no disponible (sin GPS?).';
        else if (err && err.code === err.TIMEOUT) msg = 'El GPS tardó demasiado. Prueba de nuevo.';
        setStatus(msg, true);
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    }

    // Mantenemos refs a los markers por indice absoluto para poder abrirlos
    // desde el click en la lista. El cluster es el layer real en el mapa;
    // este dict es solo un indice inverso.
    var markers = {};

    function initMap(){
      // Centro inicial: aprox centro geografico de Espana peninsular.
      state.map = L.map('map', {
        center: [40.0, -3.7],
        zoom: 6,
        preferCanvas: true,
      });
      L.tileLayer('https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap &copy; CARTO',
        maxZoom: 19,
        subdomains: 'abcd',
      }).addTo(state.map);

      state.cluster = L.markerClusterGroup({
        chunkedLoading: true,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        maxClusterRadius: 60,
      });
      var icon = L.divIcon({
        className: 'farmacia-pin',
        html: '<div style="background:#16a34a;color:#fff;font-weight:700;font-size:16px;width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.3);">+</div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      for (var i = 0; i < state.all.length; i++){
        var f = state.all[i];
        var m = L.marker([f[0], f[1]], { icon: icon });
        // Popup lazy: se construye al abrirlo para no gastar memoria con 18k DOMs.
        (function(mk, data, idx){
          mk.bindPopup(function(){
            var name = esc(data[2]);
            var addr = data[3] ? '<p class="popup-addr">' + esc(data[3]) + '</p>' : '';
            var phoneLink = data[4] ? '<a href="tel:' + esc(data[4].replace(/\\s+/g,'')) + '" class="secondary">&#x260E; ' + esc(data[4]) + '</a>' : '';
            var hours = data[5] ? '<p style="margin:4px 0 0;font-size:12px;">&#x1F550; ' + esc(data[5]) + '</p>' : '';
            var dirLink = '<a href="' + esc(mapsLink(data[0], data[1], data[2])) + '" target="_blank" rel="noopener">Cómo llegar</a>';
            // Si esta farmacia esta de guardia, lo mostramos arriba del todo
            // con el horario (si lo hay) y la zona/barrio (campo 7 de guardias).
            var g = findGuardia(data[0], data[1]);
            var gHtml = '';
            if (g) {
              var horario = g[6] ? ' &middot; &#x1F550; ' + esc(g[6]) : '';
              var zona = g[7] ? '<p style="margin:2px 0 0;font-size:11px;color:#78350f;">' + esc(g[7]) + '</p>' : '';
              gHtml = '<p style="margin:0 0 6px;"><span class="badge-guardia">De guardia</span>' + horario + '</p>' + zona;
            }
            return (
              gHtml +
              '<p class="popup-name">' + name + '</p>' + addr + hours +
              '<div class="popup-actions">' + dirLink + phoneLink + '</div>'
            );
          }, { maxWidth: 260 });
        })(m, f, i);
        markers[i] = m;
        state.cluster.addLayer(m);
      }
      state.map.addLayer(state.cluster);
      state.map.on('moveend', function(){
        if (!state.user) refilter();
      });

      // Capa extra con las guardias que NO tienen match en OSM (es decir, no
      // hay farmacia OSM cerca que les corresponda). Pintamos un marker
      // dorado "G" para que el usuario las vea igualmente aunque no esten
      // en la lista. Son pocas (~50-150 en total) asi que sin clustering.
      addGuardiaLayer();
    }

    function addGuardiaLayer(){
      if (!state.map || state.guardias.length === 0) return;
      // Si ya existe, la recreamos desde cero.
      if (state.guardiaLayer) state.map.removeLayer(state.guardiaLayer);
      var osmKeys = new Set();
      for (var i = 0; i < state.all.length; i++){
        var f = state.all[i];
        osmKeys.add(bucketKeyFine(f[0], f[1]));
        osmKeys.add(bucketKeyCoarse(f[0], f[1]));
      }
      var gIcon = L.divIcon({
        className: 'guardia-pin-wrap',
        html: '<div class="guardia-pin-only" aria-label="Farmacia de guardia">G</div>',
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      });
      var group = L.layerGroup();
      var added = 0;
      for (var j = 0; j < state.guardias.length; j++){
        var g = state.guardias[j];
        var matched = osmKeys.has(bucketKeyFine(g[0], g[1])) || osmKeys.has(bucketKeyCoarse(g[0], g[1]));
        if (matched) continue; // esta guardia se muestra via la farmacia OSM
        var gm = L.marker([g[0], g[1]], { icon: gIcon });
        (function(mk, data){
          mk.bindPopup(function(){
            var horario = data[6] ? '<p style="margin:4px 0 0;font-size:12px;">&#x1F550; ' + esc(data[6]) + '</p>' : '';
            var zona = data[7] ? '<p style="margin:2px 0 0;font-size:11px;color:#78350f;">' + esc(data[7]) + '</p>' : '';
            var phoneLink = data[4] ? '<a href="tel:' + esc(String(data[4]).replace(/\\s+/g,'')) + '" class="secondary">&#x260E; ' + esc(data[4]) + '</a>' : '';
            var dirLink = '<a href="' + esc(mapsLink(data[0], data[1], data[2])) + '" target="_blank" rel="noopener">Cómo llegar</a>';
            return (
              '<p style="margin:0 0 6px;"><span class="badge-guardia">De guardia</span></p>' +
              '<p class="popup-name">' + esc(data[2]) + '</p>' +
              (data[3] ? '<p class="popup-addr">' + esc(data[3]) + '</p>' : '') +
              horario + zona +
              '<div class="popup-actions">' + dirLink + phoneLink + '</div>'
            );
          }, { maxWidth: 260 });
        })(gm, g);
        group.addLayer(gm);
        added++;
      }
      if (added > 0) {
        group.addTo(state.map);
        state.guardiaLayer = group;
      }
    }

    // Cargar el JSON principal de farmacias + los 11 JSON de guardias en
    // paralelo. Si alguno de los de guardias falla (red, 404, CDN frio), la
    // pagina sigue funcionando sin ese territorio — no rompemos el flujo.
    var territorios = ['madrid', 'bizkaia', 'gipuzkoa', 'alava', 'coruna', 'murcia', 'almeria', 'girona', 'tarragona', 'cordoba', 'cantabria', 'pontevedra', 'laspalmas', 'alicante', 'cadiz', 'ceuta', 'valencia'];
    var pFarmacias = fetch('/data/farmacias.json', { cache: 'default' }).then(function(r){
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
    var pGuardias = territorios.map(function(t){
      return fetch('/data/guardias-' + t + '.json', { cache: 'default' })
        .then(function(r){ return r.ok ? r.json() : null; })
        .catch(function(){ return null; });
    });

    Promise.all([pFarmacias].concat(pGuardias))
      .then(function(results){
        var farm = results[0];
        if (!farm || !Array.isArray(farm.farmacias)){
          throw new Error('Formato inesperado del snapshot');
        }
        state.all = farm.farmacias;

        // Juntar todas las guardias en un solo array. Cada una ya viene con
        // el mismo schema [lat, lng, direccion, poblacion, telefono, cp,
        // horarioGuardia, horarioGuardiaDesc] asi que no hay que transformar.
        var allGuardias = [];
        for (var i = 1; i <= territorios.length; i++){
          var g = results[i];
          if (g && Array.isArray(g.guardias)) {
            for (var k = 0; k < g.guardias.length; k++) allGuardias.push(g.guardias[k]);
          }
        }
        state.guardias = allGuardias;
        // Indexar para lookup O(1). Mantenemos 2 buckets (fino y grueso).
        var fine = new Map();
        var coarse = new Map();
        for (var m = 0; m < allGuardias.length; m++){
          var gg = allGuardias[m];
          if (typeof gg[0] !== 'number' || typeof gg[1] !== 'number') continue;
          var kf = bucketKeyFine(gg[0], gg[1]);
          var kc = bucketKeyCoarse(gg[0], gg[1]);
          if (!fine.has(kf)) fine.set(kf, gg);
          if (!coarse.has(kc)) coarse.set(kc, gg);
        }
        state.guardiaByBucket = { fine: fine, coarse: coarse };

        updateHeroCount();
        initMap();
        refilter();
      })
      .catch(function(err){
        setStatus('No se pudieron cargar los datos de farmacias: ' + (err && err.message || 'error desconocido') + '. Reintenta en unos minutos.', true);
      });

    // Wire-up toolbar
    el('btn-geo').addEventListener('click', requestLocation);
    var radiusBtns = document.querySelectorAll('.radius-group button');
    for (var j = 0; j < radiusBtns.length; j++){
      radiusBtns[j].addEventListener('click', function(){
        var r = parseInt(this.getAttribute('data-r'), 10);
        state.radiusKm = r;
        for (var k = 0; k < radiusBtns.length; k++){
          radiusBtns[k].setAttribute('aria-pressed', radiusBtns[k] === this ? 'true' : 'false');
        }
        if (state.user){
          setStatus('Mostrando farmacias a ≤' + r + ' km de tu ubicación.');
        }
        refilter();
      });
    }
  })();
  </script>
</body>
</html>`
}

// Headers HTTP para /farmacias/. Similar a la landing pero permitimos
// los CDN de tiles (cartocdn) en img-src. Leaflet es 'self' porque lo
// servimos desde /static/vendor/map/.
export function farmaciasHeaders(nonce: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self' 'nonce-" + nonce + "' 'unsafe-inline'", // Leaflet inyecta styles inline en sus popups
    "img-src 'self' data: https://*.basemaps.cartocdn.com",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ')

  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    // Cache corto: snapshot puede cambiar con el cron mensual. 5 min edge
    // + SWR para que si Pages empuja una version nueva se vea en menos de
    // 1h sin golpear el origen.
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    'Link': [
      '<https://a.basemaps.cartocdn.com>; rel=preconnect; crossorigin',
    ].join(', '),
  }
}
