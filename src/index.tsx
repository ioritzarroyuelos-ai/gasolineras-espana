import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'

const app = new Hono()

app.use('/static/*', serveStatic({ root: './' }))

// Página principal: sirve el HTML completo con llamadas directas a la API del Ministerio
app.get('/', (c) => {
  return c.html(htmlPage())
})

function htmlPage(): string {
  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>⛽ Gasolineras España · Precios en tiempo real</title>
  <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>⛽</text></svg>" />

  <!-- Tailwind -->
  <script src="https://cdn.tailwindcss.com"></script>

  <!-- Leaflet CSS -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <!-- Leaflet JS -->
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>

  <!-- Marker Cluster -->
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css" />
  <script src="https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js"></script>

  <!-- FontAwesome -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css" />

  <style>
    /* ===== RESET & BASE ===== */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; width: 100%; overflow: hidden; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; background: #f8fafc; }

    /* ===== LAYOUT PRINCIPAL ===== */
    #app-header {
      position: fixed; top: 0; left: 0; right: 0;
      height: 60px; z-index: 1000;
      background: linear-gradient(135deg, #14532d 0%, #166534 40%, #16a34a 100%);
      display: flex; align-items: center; padding: 0 16px;
      box-shadow: 0 2px 12px rgba(0,0,0,0.25);
    }
    #app-body {
      position: fixed; top: 60px; left: 0; right: 0; bottom: 0;
      display: flex; overflow: hidden;
    }

    /* ===== SIDEBAR ===== */
    #sidebar {
      width: 288px; min-width: 288px;
      background: #fff;
      border-right: 1px solid #e2e8f0;
      display: flex; flex-direction: column;
      overflow: hidden;
      box-shadow: 2px 0 8px rgba(0,0,0,0.06);
      z-index: 100;
    }
    #sidebar-filters {
      padding: 12px; background: #f8fafc;
      border-bottom: 1px solid #e2e8f0;
      overflow-y: auto; flex-shrink: 0;
    }
    #stats-bar {
      padding: 8px 12px; background: #f0fdf4;
      border-bottom: 1px solid #bbf7d0;
      flex-shrink: 0; display: none;
    }
    #station-list {
      flex: 1; overflow-y: auto;
    }

    /* ===== MAPA ===== */
    #map-container {
      flex: 1; position: relative; overflow: hidden;
    }
    #map {
      position: absolute; inset: 0;
      width: 100% !important; height: 100% !important;
    }

    /* ===== FORM CONTROLS ===== */
    .form-label { display:block; font-size:11px; font-weight:600; color:#64748b; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:4px; }
    .form-select, .form-input {
      width: 100%; border: 1px solid #cbd5e1; border-radius: 8px;
      padding: 6px 10px; font-size: 13px; background: #fff;
      outline: none; transition: border-color 0.15s, box-shadow 0.15s;
      color: #1e293b;
    }
    .form-select:focus, .form-input:focus { border-color: #16a34a; box-shadow: 0 0 0 3px rgba(22,163,74,0.15); }
    .form-select:disabled { background: #f1f5f9; color: #94a3b8; cursor: not-allowed; }
    .form-group { margin-bottom: 10px; }
    .input-icon-wrap { position: relative; }
    .input-icon-wrap .icon { position:absolute; left:9px; top:50%; transform:translateY(-50%); color:#94a3b8; font-size:11px; }
    .input-icon-wrap .form-input { padding-left: 28px; }

    /* ===== BOTONES ===== */
    .btn-primary {
      background: #16a34a; color: #fff; border: none; border-radius: 8px;
      padding: 7px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
      transition: background 0.15s; display:inline-flex; align-items:center; gap:6px;
    }
    .btn-primary:hover { background: #15803d; }
    .btn-primary:active { background: #166534; }
    .btn-icon { background:none; border:none; cursor:pointer; color:#16a34a; font-size:15px; padding:4px; transition:color 0.15s; }
    .btn-icon:hover { color: #15803d; }

    /* ===== BADGES PRECIO ===== */
    .badge { display:inline-block; border-radius:9999px; padding:2px 9px; font-weight:700; font-size:12px; color:#fff; white-space:nowrap; }
    .badge-green  { background: #16a34a; }
    .badge-yellow { background: #d97706; }
    .badge-red    { background: #dc2626; }
    .badge-gray   { background: #9ca3af; }

    /* ===== STAT CHIPS ===== */
    .stat-chip { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:2px 8px; font-size:11px; font-weight:600; }
    .stat-chip.red    { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
    .stat-chip.yellow { background:#fffbeb; color:#d97706; border-color:#fde68a; }

    /* ===== TARJETAS LISTA ===== */
    .station-card { cursor:pointer; transition:background 0.12s; border-bottom:1px solid #f1f5f9; padding:10px 12px; }
    .station-card:hover  { background: #f0fdf4; }
    .station-card.active { background: #dcfce7; border-left: 3px solid #16a34a; padding-left: 9px; }
    .card-title   { font-size:13px; font-weight:600; color:#1e293b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .card-sub     { font-size:11px; color:#64748b; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:2px; }
    .card-time    { font-size:10px; color:#94a3b8; margin-top:1px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

    /* ===== EMPTY STATE ===== */
    .empty-state { display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; text-align:center; padding:24px; color:#94a3b8; }
    .empty-state .icon { font-size:48px; margin-bottom:12px; }
    .empty-state p { font-size:14px; font-weight:500; color:#64748b; }
    .empty-state small { font-size:12px; margin-top:4px; }

    /* ===== LOADING OVERLAY ===== */
    #loading {
      position:absolute; inset:0; background:rgba(255,255,255,0.8);
      backdrop-filter:blur(4px); display:none;
      align-items:center; justify-content:center; z-index:500;
    }
    #loading.show { display:flex; }
    .loading-box { background:#fff; border-radius:16px; box-shadow:0 8px 32px rgba(0,0,0,0.12); padding:24px 32px; display:flex; flex-direction:column; align-items:center; gap:12px; }
    .spinner { border:3px solid #e5e7eb; border-top:3px solid #16a34a; border-radius:50%; width:36px; height:36px; animation:spin 0.75s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }

    /* ===== LEYENDA ===== */
    #legend { position:absolute; bottom:24px; right:12px; background:rgba(255,255,255,0.95); backdrop-filter:blur(4px); border-radius:12px; box-shadow:0 4px 16px rgba(0,0,0,0.1); padding:12px 14px; z-index:400; border:1px solid #e2e8f0; min-width:130px; }
    #legend h4 { font-size:12px; font-weight:700; color:#374151; margin-bottom:8px; text-align:center; }
    .legend-item { display:flex; align-items:center; gap:8px; font-size:12px; color:#4b5563; margin-bottom:4px; }
    .legend-dot { width:13px; height:13px; border-radius:50%; flex-shrink:0; }

    /* ===== LEAFLET OVERRIDES ===== */
    .leaflet-popup-content-wrapper { border-radius:10px !important; box-shadow:0 4px 20px rgba(0,0,0,0.15) !important; }
    .leaflet-popup-content { min-width:230px; max-width:290px; font-size:13px; margin:12px 14px !important; }
    .fuel-row { display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid #f3f4f6; }
    .fuel-row:last-child { border-bottom:none; }

    /* ===== SCROLLBAR ===== */
    ::-webkit-scrollbar { width:5px; }
    ::-webkit-scrollbar-track { background:#f1f5f9; }
    ::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:3px; }
    ::-webkit-scrollbar-thumb:hover { background:#94a3b8; }

    /* ===== MOBILE ===== */
    #btn-toggle-sidebar { display:none; }
    @media (max-width: 768px) {
      #btn-toggle-sidebar { display:block; }
      #sidebar {
        position:absolute; top:0; left:0; height:100%;
        transform:translateX(-100%); transition:transform 0.3s ease;
      }
      #sidebar.open { transform:translateX(0); box-shadow:4px 0 20px rgba(0,0,0,0.2); }
    }

    /* ===== HEADER ELEMENTS ===== */
    .header-logo { font-size:22px; margin-right:8px; }
    .header-title { color:#fff; font-weight:700; font-size:15px; line-height:1.2; }
    .header-sub { color:rgba(255,255,255,0.7); font-size:11px; line-height:1.2; }
    .header-badge { background:rgba(255,255,255,0.2); color:#fff; font-size:12px; font-weight:600; border-radius:9999px; padding:3px 12px; }
    .header-update { color:rgba(255,255,255,0.65); font-size:11px; }

    /* ===== ROW LAYOUTS ===== */
    .row { display:flex; gap:8px; align-items:flex-end; }
    .row .flex-1 { flex:1; min-width:0; }
  </style>
</head>
<body>

<!-- ============ HEADER ============ -->
<header id="app-header">
  <button id="btn-toggle-sidebar" title="Abrir filtros">
    <i class="fas fa-bars" style="color:#fff;font-size:16px"></i>
  </button>

  <span class="header-logo">⛽</span>
  <div style="flex:1;min-width:0">
    <div class="header-title">Gasolineras España</div>
    <div class="header-sub">Precios oficiales · Ministerio de Industria y Energía</div>
  </div>

  <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
    <span id="lbl-update" class="header-update" style="display:none"></span>
    <span id="lbl-count" class="header-badge" style="display:none"></span>
  </div>
</header>

<!-- ============ CUERPO ============ -->
<div id="app-body">

  <!-- ======= SIDEBAR ======= -->
  <aside id="sidebar">

    <!-- FILTROS -->
    <div id="sidebar-filters">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:13px;font-weight:600;color:#374151;display:flex;align-items:center;gap:6px">
          <i class="fas fa-sliders-h" style="color:#16a34a"></i> Búsqueda
        </span>
        <button id="btn-geolocate" class="btn-icon" title="Usar mi ubicación">
          <i class="fas fa-crosshairs"></i>
        </button>
      </div>

      <div class="form-group">
        <label class="form-label">Provincia</label>
        <select id="sel-provincia" class="form-select">
          <option value="">— Selecciona —</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Municipio</label>
        <select id="sel-municipio" class="form-select" disabled>
          <option value="">— Todos —</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Combustible</label>
        <select id="sel-combustible" class="form-select">
          <option value="Precio Gasolina 95 E5">🟢 Gasolina 95 E5</option>
          <option value="Precio Gasolina 98 E5">🔵 Gasolina 98 E5</option>
          <option value="Precio Gasoleo A">🟡 Gasóleo A (Diesel)</option>
          <option value="Precio Gasoleo Premium">🟠 Gasóleo Premium</option>
          <option value="Precio Gases licuados del petróleo">🟣 GLP (Autogas)</option>
          <option value="Precio Gas Natural Comprimido">⚪ Gas Natural (GNC)</option>
          <option value="Precio Gas Natural Licuado">🩵 Gas Natural (GNL)</option>
          <option value="Precio Hidrogeno">🔴 Hidrógeno</option>
          <option value="Precio Diésel Renovable">🌿 Diésel Renovable</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Buscar rótulo o dirección</label>
        <div class="input-icon-wrap">
          <i class="fas fa-search icon"></i>
          <input id="search-text" class="form-input" type="text" placeholder="Repsol, Cepsa, Calle..." />
        </div>
      </div>

      <div class="row">
        <div class="flex-1">
          <label class="form-label">Ordenar</label>
          <select id="sel-orden" class="form-select">
            <option value="asc">Precio ↑ (más barato)</option>
            <option value="desc">Precio ↓ (más caro)</option>
            <option value="az">Nombre A→Z</option>
          </select>
        </div>
        <button id="btn-buscar" class="btn-primary">
          <i class="fas fa-search"></i> Buscar
        </button>
      </div>
    </div>

    <!-- STATS -->
    <div id="stats-bar">
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px">
        <span style="color:#64748b"><i class="fas fa-map-marker-alt" style="color:#16a34a;margin-right:4px"></i><strong id="stat-n">0</strong> gasolineras</span>
        <span class="stat-chip">↓ <span id="stat-min">–</span></span>
        <span class="stat-chip yellow">≈ <span id="stat-avg">–</span></span>
        <span class="stat-chip red">↑ <span id="stat-max">–</span></span>
      </div>
    </div>

    <!-- LISTA -->
    <div id="station-list">
      <div class="empty-state">
        <div class="icon">🗺️</div>
        <p>Selecciona una provincia</p>
        <small>Se cargarán todas las gasolineras con sus precios actualizados</small>
      </div>
    </div>
  </aside>

  <!-- ======= MAPA ======= -->
  <div id="map-container">
    <div id="map"></div>

    <!-- Loading -->
    <div id="loading">
      <div class="loading-box">
        <div class="spinner"></div>
        <p style="font-size:14px;font-weight:600;color:#374151">Cargando gasolineras...</p>
        <p style="font-size:12px;color:#94a3b8">Datos oficiales del Ministerio</p>
      </div>
    </div>

    <!-- LEYENDA -->
    <div id="legend">
      <h4>Precio relativo</h4>
      <div class="legend-item"><span class="legend-dot" style="background:#16a34a"></span> Más barato</div>
      <div class="legend-item"><span class="legend-dot" style="background:#d97706"></span> Precio medio</div>
      <div class="legend-item"><span class="legend-dot" style="background:#dc2626"></span> Más caro</div>
      <div class="legend-item" style="margin-bottom:0"><span class="legend-dot" style="background:#9ca3af"></span> Sin precio</div>
    </div>
  </div>

</div><!-- end app-body -->

<!-- ============ SCRIPT ============ -->
<script>
const API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';

// ---- MAPA — se inicializa después de que el DOM esté listo ----
let map;
function initMap() {
  map = L.map('map', { zoomControl: true }).setView([40.4, -3.7], 6);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);
  // Forzar recálculo de tamaño por si el contenedor cambió
  setTimeout(() => { map.invalidateSize(true); }, 100);
}

let clusterGroup = null;
let allStations = [];
let filteredStations = [];
let minP = 0, maxP = 0;

// ---- ICONS ----
function makeIcon(color) {
  const colors = { green:'#16a34a', yellow:'#d97706', red:'#dc2626', gray:'#9ca3af' };
  const fill = colors[color] || colors.gray;
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">'
    + '<path d="M13 0C5.82 0 0 5.82 0 13c0 9 13 21 13 21S26 22 26 13C26 5.82 20.18 0 13 0z" fill="' + fill + '" stroke="#fff" stroke-width="1.5"/>'
    + '<circle cx="13" cy="13" r="5.5" fill="#fff"/>'
    + '</svg>';
  return L.divIcon({ html: svg, className: '', iconSize:[26,34], iconAnchor:[13,34], popupAnchor:[0,-34] });
}

// ---- UTILS ----
function parsePrice(v) {
  if (!v || v === '') return null;
  return parseFloat(String(v).replace(',', '.'));
}

function priceColor(price) {
  if (!price) return 'gray';
  const range = maxP - minP;
  if (range < 0.001) return 'green';
  const pct = (price - minP) / range;
  if (pct < 0.33) return 'green';
  if (pct < 0.66) return 'yellow';
  return 'red';
}

function fmt(price) { return price ? price.toFixed(3) + ' €/L' : 'N/D'; }

const FUELS_POPUP = [
  ['Precio Gasolina 95 E5', '🟢 G-95'],
  ['Precio Gasolina 98 E5', '🔵 G-98'],
  ['Precio Gasoleo A', '🟡 Gasóleo A'],
  ['Precio Gasoleo Premium', '🟠 Gasóleo Prem.'],
  ['Precio Gases licuados del petróleo', '🟣 GLP'],
  ['Precio Gas Natural Comprimido', '⚪ GNC'],
  ['Precio Gas Natural Licuado', '🩵 GNL'],
  ['Precio Hidrogeno', '🔴 H₂'],
  ['Precio Diésel Renovable', '🌿 Diésel Renov.'],
];

function buildPopup(s) {
  const rows = FUELS_POPUP
    .filter(([k]) => s[k] && s[k] !== '')
    .map(([k, label]) => {
      const p = parsePrice(s[k]);
      return '<div class="fuel-row"><span style="color:#4b5563">' + label + '</span>'
        + '<strong style="color:#15803d">' + fmt(p) + '</strong></div>';
    }).join('');

  return '<div style="font-family:system-ui,sans-serif">'
    + '<div style="font-weight:700;font-size:14px;margin-bottom:4px">⛽ ' + (s['Rótulo'] || 'Gasolinera') + '</div>'
    + '<div style="font-size:11px;color:#6b7280;margin-bottom:4px"><i>📍 ' + s['Dirección'] + ', ' + s['Municipio'] + ', ' + s['Provincia'] + '</i></div>'
    + (s['Horario'] ? '<div style="font-size:11px;color:#9ca3af;margin-bottom:6px">🕐 ' + s['Horario'] + '</div>' : '')
    + (rows ? '<div style="font-size:12px">' + rows + '</div>' : '<div style="font-size:11px;color:#9ca3af">Sin precios registrados</div>')
    + '</div>';
}

// ---- RENDER MARKERS ----
function renderMarkers(stations) {
  if (clusterGroup) map.removeLayer(clusterGroup);
  clusterGroup = L.markerClusterGroup({ maxClusterRadius: 50 });

  const fuel = document.getElementById('sel-combustible').value;
  const prices = stations.map(s => parsePrice(s[fuel])).filter(p => p !== null);
  minP = prices.length ? Math.min(...prices) : 0;
  maxP = prices.length ? Math.max(...prices) : 0;

  const bounds = [];
  stations.forEach((s, idx) => {
    const lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
    const lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
    if (isNaN(lat) || isNaN(lng)) return;

    const price = parsePrice(s[fuel]);
    const icon = makeIcon(priceColor(price));
    const marker = L.marker([lat, lng], { icon });
    marker.bindPopup(buildPopup(s), { maxWidth: 290 });
    marker.on('click', () => highlightCard(idx));
    clusterGroup.addLayer(marker);
    bounds.push([lat, lng]);
  });

  map.addLayer(clusterGroup);

  if (bounds.length > 0) {
    try { map.fitBounds(bounds, { padding: [30, 30], maxZoom: 14 }); }
    catch(e) {}
  }
}

function highlightCard(idx) {
  document.querySelectorAll('.station-card').forEach(el => el.classList.remove('active'));
  const card = document.querySelector('[data-idx="' + idx + '"]');
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ---- RENDER LIST ----
function renderList(stations) {
  const list = document.getElementById('station-list');
  const fuel = document.getElementById('sel-combustible').value;
  const fuelLabel = document.getElementById('sel-combustible').selectedOptions[0].text.replace(/^\\S+\\s*/, '');

  if (!stations.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon">🔍</div><p>Sin resultados</p><small>Prueba con otros filtros</small></div>';
    return;
  }

  const prices = stations.map(s => parsePrice(s[fuel])).filter(p => p !== null);
  const sMin = prices.length ? Math.min(...prices) : null;
  const sMax = prices.length ? Math.max(...prices) : null;
  const sAvg = prices.length ? (prices.reduce((a, b) => a+b, 0)/prices.length) : null;

  document.getElementById('stats-bar').style.display = 'block';
  document.getElementById('stat-n').textContent = stations.length;
  document.getElementById('stat-min').textContent = sMin ? sMin.toFixed(3) + ' €' : 'N/D';
  document.getElementById('stat-avg').textContent = sAvg ? sAvg.toFixed(3) + ' €' : 'N/D';
  document.getElementById('stat-max').textContent = sMax ? sMax.toFixed(3) + ' €' : 'N/D';

  list.innerHTML = stations.map((s, i) => {
    const price = parsePrice(s[fuel]);
    const color = priceColor(price);
    const badgeCls = 'badge badge-' + color;
    return '<div class="station-card" data-idx="' + i + '" onclick="zoomTo(' + i + ')">'
      + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px">'
      + '<div style="min-width:0;flex:1">'
      + '<div class="card-title">⛽ ' + (s['Rótulo'] || 'Gasolinera') + '</div>'
      + '<div class="card-sub">📍 ' + s['Dirección'] + ', ' + s['Municipio'] + '</div>'
      + '<div class="card-time">🕐 ' + ((s['Horario'] || '').slice(0,35) || '–') + '</div>'
      + '</div>'
      + '<div style="flex-shrink:0;text-align:right">'
      + (price ? '<span class="' + badgeCls + '">' + price.toFixed(3) + ' €</span>' : '<span style="font-size:11px;color:#9ca3af">N/D</span>')
      + '<div style="font-size:10px;color:#9ca3af;margin-top:1px">' + fuelLabel.slice(0,18) + '</div>'
      + '</div></div></div>';
  }).join('');
}

function zoomTo(idx) {
  const s = filteredStations[idx];
  const lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
  const lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
  if (!isNaN(lat) && !isNaN(lng)) {
    map.setView([lat, lng], 17);
    clusterGroup.eachLayer(layer => {
      const lpos = layer.getLatLng();
      if (Math.abs(lpos.lat - lat) < 0.0002 && Math.abs(lpos.lng - lng) < 0.0002) {
        layer.openPopup();
      }
    });
  }
  highlightCard(idx);
  // Close sidebar on mobile
  if (window.innerWidth < 768) document.getElementById('sidebar').classList.remove('open');
}

// ---- SORT & FILTER ----
function applyFilters() {
  const fuel = document.getElementById('sel-combustible').value;
  const text = document.getElementById('search-text').value.trim().toLowerCase();
  const orden = document.getElementById('sel-orden').value;

  let stations = [...allStations];

  if (text) {
    stations = stations.filter(s =>
      (s['Rótulo'] || '').toLowerCase().includes(text) ||
      (s['Dirección'] || '').toLowerCase().includes(text) ||
      (s['Municipio'] || '').toLowerCase().includes(text)
    );
  }

  stations.sort((a, b) => {
    if (orden === 'asc') {
      const pa = parsePrice(a[fuel]), pb = parsePrice(b[fuel]);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1;
      return pa - pb;
    } else if (orden === 'desc') {
      const pa = parsePrice(a[fuel]), pb = parsePrice(b[fuel]);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1;
      return pb - pa;
    } else {
      return (a['Rótulo'] || '').localeCompare(b['Rótulo'] || '');
    }
  });

  filteredStations = stations;
  renderMarkers(stations);
  renderList(stations);

  const lbl = document.getElementById('lbl-count');
  lbl.textContent = stations.length + ' gasolineras';
  lbl.style.display = 'inline-block';
}

// ---- API CALLS (directo al Ministerio) ----
async function loadProvincias() {
  const res = await fetch(API + '/Listados/Provincias/');
  const data = await res.json();
  const sel = document.getElementById('sel-provincia');
  data.sort((a, b) => a.Provincia.localeCompare(b.Provincia));
  data.forEach(p => {
    const o = document.createElement('option');
    o.value = p.IDPovincia;
    o.textContent = p.Provincia + ' (' + p.CCAA + ')';
    sel.appendChild(o);
  });
}

async function loadMunicipios(idProv) {
  const sel = document.getElementById('sel-municipio');
  sel.innerHTML = '<option value="">— Todos —</option>';
  sel.disabled = true;
  if (!idProv) return;
  const res = await fetch(API + '/Listados/MunicipiosPorProvincia/' + idProv);
  const data = await res.json();
  data.sort((a, b) => a.Municipio.localeCompare(b.Municipio));
  data.forEach(m => {
    const o = document.createElement('option');
    o.value = m.IDMunicipio;
    o.textContent = m.Municipio;
    sel.appendChild(o);
  });
  sel.disabled = false;
}

async function loadStations() {
  const idProv = document.getElementById('sel-provincia').value;
  const idMun  = document.getElementById('sel-municipio').value;

  if (!idProv) { alert('Selecciona una provincia primero.'); return; }

  document.getElementById('loading').classList.add('show');
  document.getElementById('stats-bar').style.display = 'none';

  try {
    let url = idMun
      ? API + '/EstacionesTerrestres/FiltroMunicipio/' + idMun
      : API + '/EstacionesTerrestres/FiltroProvincia/' + idProv;

    const res = await fetch(url);
    const data = await res.json();
    allStations = data.ListaEESSPrecio || [];

    if (data.Fecha) {
      document.getElementById('lbl-update').textContent = 'Actualizado: ' + data.Fecha;
      document.getElementById('lbl-update').style.display = 'inline';
    }

    applyFilters();
  } catch(err) {
    console.error(err);
    alert('Error al cargar los datos. Inténtalo de nuevo.');
  } finally {
    document.getElementById('loading').classList.remove('show');
  }
}

// ---- GEOLOCALIZACIÓN ----
document.getElementById('btn-geolocate').addEventListener('click', () => {
  if (!navigator.geolocation) { alert('Tu navegador no soporta geolocalización.'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    map.setView([pos.coords.latitude, pos.coords.longitude], 13);
    L.circleMarker([pos.coords.latitude, pos.coords.longitude], {
      radius: 10, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.5
    }).addTo(map).bindPopup('📍 Tu ubicación').openPopup();
  }, () => alert('No se pudo obtener tu ubicación.'));
});

// ---- EVENTOS ----
document.getElementById('sel-provincia').addEventListener('change', async e => {
  await loadMunicipios(e.target.value);
  if (e.target.value) loadStations();
});
document.getElementById('sel-municipio').addEventListener('change', () => {
  if (document.getElementById('sel-provincia').value) loadStations();
});
document.getElementById('sel-combustible').addEventListener('change', () => {
  if (allStations.length) applyFilters();
});
document.getElementById('sel-orden').addEventListener('change', () => {
  if (allStations.length) applyFilters();
});
document.getElementById('search-text').addEventListener('input', () => {
  if (allStations.length) applyFilters();
});
document.getElementById('btn-buscar').addEventListener('click', loadStations);
document.getElementById('search-text').addEventListener('keydown', e => {
  if (e.key === 'Enter') loadStations();
});

// Sidebar toggle mobile
document.getElementById('btn-toggle-sidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// ---- INIT ----
// Inicializar mapa al cargar la página completamente
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { initMap(); loadProvincias(); });
} else {
  initMap(); loadProvincias();
}

// Re-invalidar tamaño al cambiar dimensiones de ventana
window.addEventListener('resize', () => { if (map) map.invalidateSize(true); });
</script>
</body>
</html>`;
}

export default app
