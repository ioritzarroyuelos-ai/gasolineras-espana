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
    * { box-sizing: border-box; }
    body { margin: 0; font-family: 'Segoe UI', system-ui, sans-serif; }
    #map { height: calc(100vh - 60px); }

    /* Sidebar */
    .sidebar-panel { transition: transform 0.3s ease; }

    /* Scrollbar */
    ::-webkit-scrollbar { width: 5px; }
    ::-webkit-scrollbar-track { background: #f1f5f9; }
    ::-webkit-scrollbar-thumb { background: #94a3b8; border-radius: 3px; }

    /* Precio badge */
    .badge { display:inline-block; border-radius:9999px; padding:2px 9px; font-weight:700; font-size:12px; color:#fff; }
    .badge-green  { background: #16a34a; }
    .badge-yellow { background: #d97706; }
    .badge-red    { background: #dc2626; }
    .badge-gray   { background: #9ca3af; }

    /* Tarjeta */
    .station-card { cursor:pointer; transition: background 0.12s; border-bottom: 1px solid #f1f5f9; }
    .station-card:hover { background: #f0fdf4; }
    .station-card.active { background: #dcfce7; border-left: 3px solid #16a34a; }

    /* Loading */
    .spinner { border:3px solid #e5e7eb; border-top:3px solid #16a34a; border-radius:50%; width:32px; height:32px; animation:spin 0.75s linear infinite; }
    @keyframes spin { to { transform:rotate(360deg); } }

    /* Popup */
    .leaflet-popup-content { min-width: 230px; font-size: 13px; }
    .fuel-row { display:flex; justify-content:space-between; align-items:center; padding:3px 0; border-bottom:1px solid #f3f4f6; }
    .fuel-row:last-child { border-bottom:none; }

    /* Custom marker icon */
    .custom-marker { width:28px; height:36px; position:relative; }

    /* Stat chips */
    .stat-chip { background:#f0fdf4; color:#15803d; border:1px solid #bbf7d0; border-radius:6px; padding:2px 8px; font-size:11px; font-weight:600; }
    .stat-chip.red { background:#fef2f2; color:#dc2626; border-color:#fecaca; }
    .stat-chip.yellow { background:#fffbeb; color:#d97706; border-color:#fde68a; }

    /* Mobile sidebar toggle */
    @media (max-width: 768px) {
      #sidebar { position:absolute; top:60px; left:0; height:calc(100vh - 60px); z-index:1000; transform:translateX(-100%); }
      #sidebar.open { transform:translateX(0); }
    }
  </style>
</head>
<body class="bg-gray-100">

<!-- ============ HEADER ============ -->
<header class="h-[60px] bg-gradient-to-r from-green-800 via-green-700 to-green-500 flex items-center px-4 shadow-lg relative z-50">
  <!-- Mobile toggle -->
  <button id="btn-toggle-sidebar" class="md:hidden mr-3 text-white text-lg">
    <i class="fas fa-bars"></i>
  </button>

  <div class="flex items-center gap-2 flex-1 min-w-0">
    <span class="text-2xl">⛽</span>
    <div class="min-w-0">
      <h1 class="text-white font-bold text-base leading-tight truncate">Gasolineras España</h1>
      <p class="text-green-200 text-[11px] leading-tight truncate">Precios oficiales · Ministerio de Industria y Energía</p>
    </div>
  </div>

  <div class="flex items-center gap-2 flex-shrink-0">
    <span id="lbl-update" class="text-green-200 text-[11px] hidden sm:block"></span>
    <span id="lbl-count" class="bg-white/20 text-white text-xs font-semibold rounded-full px-3 py-1 hidden"></span>
  </div>
</header>

<!-- ============ MAIN LAYOUT ============ -->
<div class="flex h-[calc(100vh-60px)] relative">

  <!-- ======= SIDEBAR ======= -->
  <aside id="sidebar" class="sidebar-panel w-72 bg-white shadow-xl flex flex-col z-40 overflow-hidden border-r border-gray-200 md:relative">

    <!-- FILTROS -->
    <div class="p-3 space-y-2 bg-gray-50 border-b border-gray-200 overflow-y-auto">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700 flex items-center gap-1">
          <i class="fas fa-sliders-h text-green-600"></i> Búsqueda
        </h2>
        <button id="btn-geolocate" title="Usar mi ubicación" class="text-green-600 hover:text-green-800 text-sm">
          <i class="fas fa-crosshairs"></i>
        </button>
      </div>

      <!-- Provincia -->
      <div>
        <label class="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Provincia</label>
        <select id="sel-provincia" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400">
          <option value="">— Selecciona —</option>
        </select>
      </div>

      <!-- Municipio -->
      <div>
        <label class="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Municipio</label>
        <select id="sel-municipio" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400" disabled>
          <option value="">— Todos —</option>
        </select>
      </div>

      <!-- Combustible -->
      <div>
        <label class="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Combustible</label>
        <select id="sel-combustible" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400">
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

      <!-- Búsqueda texto -->
      <div>
        <label class="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Buscar rótulo o dirección</label>
        <div class="relative">
          <i class="fas fa-search absolute left-2.5 top-2.5 text-gray-400 text-xs"></i>
          <input id="search-text" type="text" placeholder="Repsol, Cepsa, Calle..." class="w-full border border-gray-200 rounded-lg pl-7 pr-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
        </div>
      </div>

      <!-- Ordenar -->
      <div class="flex gap-2 items-end">
        <div class="flex-1">
          <label class="text-[11px] font-medium text-gray-500 mb-1 block uppercase tracking-wide">Ordenar</label>
          <select id="sel-orden" class="w-full border border-gray-200 rounded-lg px-2 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-400">
            <option value="asc">Precio ↑ (más barato)</option>
            <option value="desc">Precio ↓ (más caro)</option>
            <option value="az">Nombre A→Z</option>
          </select>
        </div>
        <button id="btn-buscar" class="flex-shrink-0 bg-green-600 hover:bg-green-700 active:bg-green-800 text-white rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors flex items-center gap-1.5">
          <i class="fas fa-search"></i> Buscar
        </button>
      </div>
    </div>

    <!-- STATS -->
    <div id="stats-bar" class="hidden px-3 py-1.5 bg-green-50 border-b border-green-100">
      <div class="flex flex-wrap gap-1.5 text-xs items-center">
        <span class="text-gray-500"><i class="fas fa-map-marker-alt text-green-600 mr-1"></i><strong id="stat-n">0</strong> gasolineras</span>
        <span class="stat-chip green">↓ <span id="stat-min">–</span></span>
        <span class="stat-chip yellow">≈ <span id="stat-avg">–</span></span>
        <span class="stat-chip red">↑ <span id="stat-max">–</span></span>
      </div>
    </div>

    <!-- LISTA -->
    <div id="station-list" class="flex-1 overflow-y-auto text-sm">
      <div class="flex flex-col items-center justify-center h-full text-center text-gray-400 p-6">
        <div class="text-5xl mb-3">🗺️</div>
        <p class="font-medium text-gray-500">Selecciona una provincia</p>
        <p class="text-xs mt-1">Se cargarán todas las gasolineras con sus precios actualizados</p>
      </div>
    </div>
  </aside>

  <!-- ======= MAPA ======= -->
  <div class="flex-1 relative">
    <div id="map" class="w-full h-full z-0"></div>

    <!-- Loading -->
    <div id="loading" class="hidden absolute inset-0 bg-white/75 backdrop-blur-sm flex items-center justify-center z-50">
      <div class="bg-white rounded-2xl shadow-xl p-6 flex flex-col items-center gap-3">
        <div class="spinner"></div>
        <p class="text-sm font-semibold text-gray-600">Cargando gasolineras...</p>
        <p class="text-xs text-gray-400">Datos oficiales del Ministerio</p>
      </div>
    </div>

    <!-- LEYENDA -->
    <div class="absolute bottom-8 right-3 bg-white/95 backdrop-blur-sm rounded-xl shadow-lg p-3 z-40 border border-gray-200 text-xs">
      <p class="font-bold text-gray-600 mb-2 text-center">Precio relativo</p>
      <div class="space-y-1">
        <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-full bg-green-500 inline-block"></span><span>Más barato</span></div>
        <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-full bg-yellow-400 inline-block"></span><span>Precio medio</span></div>
        <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-full bg-red-500 inline-block"></span><span>Más caro</span></div>
        <div class="flex items-center gap-2"><span class="w-3.5 h-3.5 rounded-full bg-gray-400 inline-block"></span><span>Sin precio</span></div>
      </div>
    </div>
  </div>

</div><!-- end main layout -->

<!-- ============ SCRIPT ============ -->
<script>
const API = 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes';

// ---- MAPA ----
const map = L.map('map', { zoomControl: true }).setView([40.4, -3.7], 6);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  maxZoom: 19
}).addTo(map);

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
    list.innerHTML = '<div class="flex flex-col items-center justify-center h-full text-center text-gray-400 p-6"><div class="text-4xl mb-2">🔍</div><p class="font-medium">Sin resultados</p><p class="text-xs mt-1">Prueba con otros filtros</p></div>';
    return;
  }

  const prices = stations.map(s => parsePrice(s[fuel])).filter(p => p !== null);
  const sMin = prices.length ? Math.min(...prices) : null;
  const sMax = prices.length ? Math.max(...prices) : null;
  const sAvg = prices.length ? (prices.reduce((a, b) => a+b, 0)/prices.length) : null;

  document.getElementById('stats-bar').classList.remove('hidden');
  document.getElementById('stat-n').textContent = stations.length;
  document.getElementById('stat-min').textContent = sMin ? sMin.toFixed(3) + ' €' : 'N/D';
  document.getElementById('stat-avg').textContent = sAvg ? sAvg.toFixed(3) + ' €' : 'N/D';
  document.getElementById('stat-max').textContent = sMax ? sMax.toFixed(3) + ' €' : 'N/D';

  list.innerHTML = stations.map((s, i) => {
    const price = parsePrice(s[fuel]);
    const color = priceColor(price);
    const badgeCls = 'badge badge-' + color;
    return '<div class="station-card px-3 py-2" data-idx="' + i + '" onclick="zoomTo(' + i + ')">'
      + '<div class="flex justify-between items-start gap-1">'
      + '<div style="min-width:0;flex:1">'
      + '<div class="font-semibold text-gray-800 truncate" style="font-size:13px">⛽ ' + (s['Rótulo'] || 'Gasolinera') + '</div>'
      + '<div class="text-gray-500 truncate" style="font-size:11px">📍 ' + s['Dirección'] + ', ' + s['Municipio'] + '</div>'
      + '<div class="text-gray-400 truncate" style="font-size:10px">🕐 ' + ((s['Horario'] || '').slice(0,35) || '–') + '</div>'
      + '</div>'
      + '<div class="flex-shrink-0 text-right">'
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
  lbl.classList.remove('hidden');
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

  document.getElementById('loading').classList.remove('hidden');
  document.getElementById('stats-bar').classList.add('hidden');

  try {
    let url = idMun
      ? API + '/EstacionesTerrestres/FiltroMunicipio/' + idMun
      : API + '/EstacionesTerrestres/FiltroProvincia/' + idProv;

    const res = await fetch(url);
    const data = await res.json();
    allStations = data.ListaEESSPrecio || [];

    if (data.Fecha) {
      document.getElementById('lbl-update').textContent = 'Actualizado: ' + data.Fecha;
      document.getElementById('lbl-update').classList.remove('hidden');
    }

    applyFilters();
  } catch(err) {
    console.error(err);
    alert('Error al cargar los datos. Inténtalo de nuevo.');
  } finally {
    document.getElementById('loading').classList.add('hidden');
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
loadProvincias();
</script>
</body>
</html>`;
}

export default app
