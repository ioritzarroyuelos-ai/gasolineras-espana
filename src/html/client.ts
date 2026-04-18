export function getClientScript(nonce: string, version: string = '0.0.0'): string {
  // El nonce debe coincidir con el del header CSP para que el script se ejecute.
  // __APP_VERSION__ se inyecta desde el server: queda accesible como var global 'APP_VER'.
  return `<script nonce="${nonce}">
var APP_VER = ${JSON.stringify(version)};
// ---- TOASTS ----
// Usa nodos DOM + textContent para evitar XSS si 'msg' viene de un backend comprometido.
function showToast(msg, type) {
  type = type || 'error';
  var cfg = {
    error:   {bg:'#fef2f2', border:'#fca5a5', color:'#dc2626', icon:'\u2715'},
    warning: {bg:'#fffbeb', border:'#fcd34d', color:'#d97706', icon:'\u26A0'},
    success: {bg:'#f0fdf4', border:'#86efac', color:'#16a34a', icon:'\u2713'},
    info:    {bg:'#eff6ff', border:'#93c5fd', color:'#2563eb', icon:'\u2139'}
  };
  var c = cfg[type] || cfg.error;
  var t = document.createElement('div');
  t.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:'+c.bg+';border:1px solid '+c.border+';color:'+c.color+';padding:12px 20px;border-radius:12px;font-size:13px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,0.14);z-index:9999;display:flex;align-items:center;gap:8px;max-width:380px;white-space:pre-wrap';
  var iconEl = document.createElement('span');
  iconEl.style.fontSize = '15px';
  iconEl.textContent = c.icon;
  var msgEl = document.createElement('span');
  msgEl.textContent = String(msg == null ? '' : msg);
  t.appendChild(iconEl);
  t.appendChild(msgEl);
  document.body.appendChild(t);
  setTimeout(function(){ if(t.parentNode) t.remove(); }, 5000);
}

// ---- HTML ESCAPE — previene XSS con datos del API ----
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ============================================================
// ===== HELPERS NUEVOS (ahorro, distancia, horario, perfil) =====
// ============================================================

// Distancia Haversine entre dos puntos (km).
function distanceKm(lat1, lon1, lat2, lon2) {
  if (lat1 == null || lat2 == null) return Infinity;
  var R = 6371;
  var toRad = function(d) { return d * Math.PI / 180; };
  var dLat = toRad(lat2 - lat1);
  var dLon = toRad(lon2 - lon1);
  var a = Math.sin(dLat/2) * Math.sin(dLat/2) +
          Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
          Math.sin(dLon/2) * Math.sin(dLon/2);
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function stationLatLng(s) {
  var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
  var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
  if (isNaN(lat) || isNaN(lng) || (lat === 0 && lng === 0)) return null;
  return { lat: lat, lng: lng };
}

function stationId(s) {
  // IDEESS es el identificador del Ministerio. Fallback: hash por Rotulo+lat+lng.
  return s['IDEESS'] || (s['Rotulo'] || '') + '|' + (s['Latitud'] || '') + '|' + (s['Longitud (WGS84)'] || '');
}

// Mediana de un array numerico (ignora null/0)
function median(arr) {
  var vals = arr.filter(function(v) { return v != null && v > 0; }).sort(function(a,b) { return a - b; });
  if (!vals.length) return null;
  var mid = Math.floor(vals.length / 2);
  return vals.length % 2 ? vals[mid] : (vals[mid-1] + vals[mid]) / 2;
}

// ---- PERFIL DEL USUARIO (localStorage) ----
var PROFILE_KEY = 'gs_profile_v1';
function getProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch(e) { return null; }
}
function setProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch(e) {}
}

// ---- FAVORITOS (localStorage) ----
var FAV_KEY = 'gs_favs_v1';
function getFavs() {
  try { return JSON.parse(localStorage.getItem(FAV_KEY) || '[]'); } catch(e) { return []; }
}
function setFavs(list) {
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list)); } catch(e) {}
}
function isFav(id) {
  var favs = getFavs();
  for (var i = 0; i < favs.length; i++) if (favs[i].id === id) return true;
  return false;
}
function toggleFav(station) {
  var id = stationId(station);
  var favs = getFavs();
  var idx = -1;
  for (var i = 0; i < favs.length; i++) if (favs[i].id === id) { idx = i; break; }
  if (idx >= 0) { favs.splice(idx, 1); setFavs(favs); return false; }
  favs.push({
    id: id,
    rotulo: station['Rotulo'] || 'Gasolinera',
    municipio: station['Municipio'] || '',
    direccion: station['Direccion'] || '',
    lat: parseFloat((station['Latitud'] || '').replace(',', '.')),
    lng: parseFloat((station['Longitud (WGS84)'] || '').replace(',', '.'))
  });
  setFavs(favs);
  return true;
}

// ---- HISTORICO DE PRECIOS (14 dias, por estacion+combustible) ----
// Estructura: { "idStation|fuel": [ {d:"2026-04-17", p:1.459}, ... ] }
var HISTORY_KEY = 'gs_hist_v1';
var HISTORY_MAX_DAYS = 14;
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch(e) { return {}; }
}
function setHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch(e) {}
}
function pushHistoryPoint(stId, fuel, price) {
  if (!price || price <= 0) return;
  var h = getHistory();
  var k = stId + '|' + fuel;
  var today = new Date().toISOString().slice(0, 10);
  var arr = h[k] || [];
  // Reemplaza el punto del dia si ya existe
  if (arr.length && arr[arr.length-1].d === today) arr[arr.length-1].p = price;
  else arr.push({ d: today, p: price });
  // Trunca a N dias
  if (arr.length > HISTORY_MAX_DAYS) arr = arr.slice(arr.length - HISTORY_MAX_DAYS);
  h[k] = arr;
  setHistory(h);
}
// Guarda un lote (tras cargar estaciones): solo para favoritos para no llenar storage.
function recordHistoryForFavorites(stations, fuel) {
  var favIds = {};
  getFavs().forEach(function(f) { favIds[f.id] = true; });
  stations.forEach(function(s) {
    var id = stationId(s);
    if (!favIds[id]) return;
    var p = parsePrice(s[fuel]);
    if (p) pushHistoryPoint(id, fuel, p);
  });
}

// ---- HORARIO VIVO: parsea el string del Ministerio y decide si esta abierta ahora ----
// Formato tipico: "L-V: 06:00-22:00; S: 07:00-14:00; D: cerrado"
var DAY_MAP = { L:1, M:2, X:3, J:4, V:5, S:6, D:0 };
function parseTime(s) {
  var m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return parseInt(m[1],10) * 60 + parseInt(m[2],10);
}
function expandDayRange(token) {
  token = token.toUpperCase().replace(/\s/g,'');
  if (token === 'LABORABLES' || token === 'L-V') return [1,2,3,4,5];
  if (token === 'DIARIO' || token === 'L-D' || token === 'TODOS') return [0,1,2,3,4,5,6];
  if (token.indexOf('-') > -1) {
    var pair = token.split('-');
    var from = DAY_MAP[pair[0]], to = DAY_MAP[pair[1]];
    if (from == null || to == null) return [];
    var days = [];
    var d = from;
    for (var i = 0; i < 8; i++) {
      days.push(d);
      if (d === to) break;
      d = (d + 1) % 7;
    }
    return days;
  }
  // Lista "L,M,X"
  return token.split(',').map(function(t) { return DAY_MAP[t]; }).filter(function(d) { return d != null; });
}
function isOpenNow(horario) {
  if (!horario) return null;
  var upper = horario.toUpperCase();
  if (upper.indexOf('24H') >= 0 || upper.indexOf('00:00-24:00') >= 0) return { open: true, nextChange: null };
  var now = new Date();
  var day = now.getDay();
  var minutes = now.getHours()*60 + now.getMinutes();
  var segs = horario.split(';').map(function(s) { return s.trim(); });
  for (var i = 0; i < segs.length; i++) {
    var seg = segs[i];
    var m = seg.match(/^([^:]+):\s*(.+)$/);
    if (!m) continue;
    var days = expandDayRange(m[1]);
    if (days.indexOf(day) < 0) continue;
    var times = m[2];
    if (times.toUpperCase().indexOf('CERRADO') >= 0) return { open: false, nextChange: null };
    // Rango HH:MM-HH:MM (posibles multiples)
    var ranges = times.split(/[,Y]/).map(function(r) { return r.trim(); });
    for (var j = 0; j < ranges.length; j++) {
      var rg = ranges[j].match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
      if (!rg) continue;
      var from = parseTime(rg[1]);
      var to   = parseTime(rg[2]);
      if (to === 0) to = 24*60;
      if (minutes >= from && minutes < to) return { open: true,  closesAt: rg[2] };
      if (minutes < from)                  return { open: false, opensAt: rg[1] };
    }
  }
  return null;
}

// ---- FETCH CON RETRY (hasta 3 intentos con espera creciente) ----
async function fetchJSON(url) {
  var lastErr;
  for (var i = 1; i <= 3; i++) {
    try {
      var res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (data && data.error) throw new Error(data.error);
      return data;
    } catch(e) {
      lastErr = e;
      console.warn('[fetchJSON] intento ' + i + ' fallido (' + url + '):', e.message);
      if (i < 3) await new Promise(function(r) { setTimeout(r, i * 1500); });
    }
  }
  throw lastErr;
}

// ---- CACHE GENERICA en localStorage (sin TTL estricto, stale-while-revalidate) ----
function lsRead(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) { return null; }
}
function lsWrite(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data })); } catch(e) {}
}

function showListError(msg, retryLabel) {
  var list = document.getElementById('station-list');
  list.innerHTML = '';
  var box = document.createElement('div');
  box.className = 'empty-state';
  var icon = document.createElement('div');
  icon.className = 'icon';
  icon.style.fontSize = '40px';
  icon.textContent = '\u26A0';
  var p = document.createElement('p');
  p.textContent = String(msg == null ? '' : msg);
  var btn = document.createElement('button');
  btn.className = 'btn-primary';
  btn.style.marginTop = '14px';
  btn.textContent = retryLabel || 'Reintentar';
  btn.addEventListener('click', loadStations);
  box.appendChild(icon);
  box.appendChild(p);
  box.appendChild(btn);
  list.appendChild(box);
}

// Elimina tildes de las claves del objeto estacion (evita problemas de encoding del documento)
function normalizeStation(s) {
  var out = {};
  for (var k in s) {
    out[k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] = s[k];
  }
  return out;
}

// ---- MAPA ----
var map;
var mapLayers = {};

function initMap() {
  var isDarkStart = document.body.classList.contains('dark');

  // Limites geograficos de Espana: peninsula + Baleares + Canarias + Ceuta/Melilla.
  // Leaflet los usa para:
  //  - maxBounds: impide arrastrar el mapa fuera del bounding box.
  //  - maxBoundsViscosity: 1.0 = el borde es "rigido" (no se puede salir ni con inercia).
  //  - minZoom: por debajo de este nivel se ve media Europa / medio mundo → sin sentido.
  var SPAIN_BOUNDS = L.latLngBounds(
    [26.5, -19.0],  // SW — al sur de El Hierro y al oeste del mismo
    [44.5,   5.5]   // NE — al norte del Cantabrico y al este de Menorca
  );

  map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    zoomAnimation: true,
    fadeAnimation: true,
    markerZoomAnimation: true,
    minZoom: 5,
    maxBounds: SPAIN_BOUNDS,
    maxBoundsViscosity: 1.0,
    worldCopyJump: false
  }).setView([40.4, -3.7], 6);

  // Tiles CartoDB *_nolabels*: el mapa base viene SIN nombres. Los nombres los
  // pintamos nosotros con una capa propia (renderLabels) solo para Espana, en
  // castellano. Asi evitamos dos cosas:
  //  1) Ver "SPAIN" / "ANDALUSIA" / "CATALONIA" en ingles (CartoDB rotula en
  //     ingles a nivel de pais/region; OSM seria local pero Carto es EN).
  //  2) Ver nombres de Francia, Portugal, Marruecos o Argelia — el usuario
  //     viene a consultar gasolineras en Espana, el resto es ruido visual.
  // noWrap=true evita que los tiles se repitan horizontalmente cuando el
  // usuario intenta hacer zoom-out (sin esto, veria varios planetas).
  mapLayers.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, minZoom: 5, noWrap: true, bounds: SPAIN_BOUNDS
  });
  mapLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, minZoom: 5, noWrap: true, bounds: SPAIN_BOUNDS
  });
  // El satelite de ESRI no tiene capa "nolabels" pero tampoco trae rotulos por
  // defecto (es pura ortofoto), asi que vale tal cual.
  mapLayers.satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye',
    maxZoom: 19, minZoom: 5, noWrap: true, bounds: SPAIN_BOUNDS
  });

  // Activar capa segun tema actual
  (isDarkStart ? mapLayers.dark : mapLayers.light).addTo(map);

  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 120 }).addTo(map);
  L.control.layers(
    { '&#x1F5FA;&#xFE0F; Mapa': mapLayers.light, '&#x1F6F0;&#xFE0F; Satelite': mapLayers.satellite },
    {}, { position: 'topright', collapsed: false }
  ).addTo(map);

  // Etiquetas en castellano (pais / CCAA / ciudades). Se repintan en cada
  // zoomend para mostrar/ocultar segun el nivel actual.
  labelLayer = L.layerGroup().addTo(map);
  renderLabels();
  map.on('zoomend', renderLabels);

  setTimeout(function() { map.invalidateSize(true); }, 100);
}

// ---- ETIQUETAS EN CASTELLANO ----
// Capa propia de texto encima del mapa. Como los tiles vienen sin nombres,
// pintamos nosotros solo lo que queremos ver (Espana) y en el idioma correcto.
//
// Estilo: imitamos a CartoDB Voyager — texto pequeno (10-12px), peso medio,
// gris azulado con halo blanco. Mayusculas suaves para CCAA, sin transformar
// para ciudades. Nada de titulos "ESPANA" gigantes en el centro.
//
// Cada entrada: { t: texto, p: [lat, lng], c: clase CSS, mn: zoom minimo,
// mx: zoom maximo }. Rangos NO solapados (CCAA hasta 7, ciudades desde 8) para
// que el mapa no se llene de texto a zoom intermedio.
//
// Nombres cortos en CCAA que coinciden con capital (Madrid, Murcia, La Rioja
// comparten texto con la ciudad): solo la ciudad a zoom alto; a zoom bajo se
// ven como region sin redundancia.
var labelLayer = null;
var SPAIN_LABELS = [
  // Comunidades autonomas — zoom 5-7. Nombres cortos de uso comun.
  { t: 'Galicia',            p: [42.75, -7.90], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Asturias',           p: [43.30, -6.00], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Cantabria',          p: [43.20, -4.00], c: 'map-label-ccaa', mn: 6, mx: 7 },
  { t: 'País Vasco',         p: [43.05, -2.60], c: 'map-label-ccaa', mn: 6, mx: 7 },
  { t: 'Navarra',            p: [42.70, -1.65], c: 'map-label-ccaa', mn: 6, mx: 7 },
  { t: 'La Rioja',           p: [42.30, -2.50], c: 'map-label-ccaa', mn: 7, mx: 7 },
  { t: 'Aragón',             p: [41.50, -0.70], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Cataluña',           p: [41.80,  1.50], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Castilla y León',    p: [41.80, -4.50], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Madrid',             p: [40.55, -3.70], c: 'map-label-ccaa', mn: 6, mx: 7 },
  { t: 'Castilla-La Mancha', p: [39.55, -3.30], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Extremadura',        p: [39.20, -6.10], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'C. Valenciana',      p: [39.60, -0.70], c: 'map-label-ccaa', mn: 6, mx: 7 },
  { t: 'Murcia',             p: [38.00, -1.80], c: 'map-label-ccaa', mn: 7, mx: 7 },
  { t: 'Andalucía',          p: [37.40, -4.80], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Baleares',           p: [39.70,  3.00], c: 'map-label-ccaa', mn: 6, mx: 7 },
  { t: 'Canarias',           p: [28.30,-15.80], c: 'map-label-ccaa', mn: 5, mx: 7 },
  { t: 'Ceuta',              p: [35.89, -5.32], c: 'map-label-ccaa', mn: 8, mx: 10 },
  { t: 'Melilla',            p: [35.29, -2.94], c: 'map-label-ccaa', mn: 8, mx: 10 },

  // Ciudades principales — zoom 8+. Capitales de provincia y grandes nucleos.
  { t: 'Madrid',     p: [40.4168, -3.7038], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Barcelona',  p: [41.3851,  2.1734], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Valencia',   p: [39.4699, -0.3763], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Sevilla',    p: [37.3891, -5.9845], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Zaragoza',   p: [41.6488, -0.8891], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Málaga',     p: [36.7213, -4.4214], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Murcia',     p: [37.9922, -1.1307], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Palma',      p: [39.5696,  2.6502], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Las Palmas de Gran Canaria', p: [28.1235, -15.4363], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Bilbao',     p: [43.2630, -2.9350], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Alicante',   p: [38.3452, -0.4810], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Córdoba',    p: [37.8882, -4.7794], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Valladolid', p: [41.6523, -4.7245], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Vigo',       p: [42.2406, -8.7207], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Gijón',      p: [43.5322, -5.6611], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Granada',    p: [37.1773, -3.5986], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'A Coruña',   p: [43.3623, -8.4115], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Oviedo',     p: [43.3614, -5.8593], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Pamplona',   p: [42.8125, -1.6458], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Santa Cruz de Tenerife', p: [28.4636, -16.2518], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Santander',  p: [43.4623, -3.8099], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Toledo',     p: [39.8628, -4.0273], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'San Sebastián', p: [43.3183, -1.9812], c: 'map-label-city', mn: 9, mx: 20 },
  { t: 'Albacete',   p: [38.9943, -1.8585], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Jaén',       p: [37.7796, -3.7849], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Salamanca',  p: [40.9701, -5.6635], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Logroño',    p: [42.4627, -2.4450], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Burgos',     p: [42.3439, -3.6969], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Cádiz',      p: [36.5271, -6.2886], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Almería',    p: [36.8340, -2.4637], c: 'map-label-city', mn: 8, mx: 20 },
  { t: 'Badajoz',    p: [38.8794, -6.9707], c: 'map-label-city', mn: 8, mx: 20 }
];

function renderLabels() {
  if (!labelLayer || !map) return;
  labelLayer.clearLayers();
  var z = map.getZoom();
  for (var i = 0; i < SPAIN_LABELS.length; i++) {
    var lab = SPAIN_LABELS[i];
    if (z < lab.mn || z > lab.mx) continue;
    var icon = L.divIcon({
      className: 'map-label ' + lab.c,
      html: lab.t,
      iconSize: null,     // null = el CSS dimensiona segun el texto
      iconAnchor: [0, 0]  // no centrar; el CSS aplica transform: translate(-50%, -50%)
    });
    L.marker(lab.p, { icon: icon, interactive: false, keyboard: false }).addTo(labelLayer);
  }
}

var clusterGroup = null;
var allStations = [];
var filteredStations = [];
var minP = 0, maxP = 0;

// Estado nuevo: posicion del usuario (tras geolocalizar), unidad precio, ahorro.
var userPos = null;                         // { lat, lng } tras geolocate
var priceUnit = localStorage.getItem('gs_unit') === 'c' ? 'c' : 'e';  // 'e' = €/L, 'c' = c/L
var currentMedianPrice = null;              // mediana del listado filtrado actual
var topCheapIds = {};                       // ids de las 3 estaciones mas baratas (para medallas)

// Formatea precio segun unidad seleccionada
function fmtPriceUnit(price) {
  if (price == null) return 'N/D';
  if (priceUnit === 'c') return (price * 100).toFixed(1) + ' c';
  return price.toFixed(3) + ' \u20AC';
}

// ---- ICONS - price badge pill ----
var CLRS = { green:'#16a34a', yellow:'#d97706', red:'#dc2626', gray:'#64748b' };

function makeIcon(color, price) {
  var bg  = CLRS[color] || CLRS.gray;
  var txt = price ? price.toFixed(3) : 'N/D';
  var w = price ? 58 : 44;
  var h = 26;
  var tip = 7;
  var r = 10;

  var svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + (h + tip) + '" viewBox="0 0 ' + w + ' ' + (h + tip) + '">',
    '  <defs>',
    '    <filter id="dp" x="-30%" y="-30%" width="160%" height="160%">',
    '      <feDropShadow dx="0" dy="2" stdDeviation="2.5" flood-color="rgba(0,0,0,0.35)"/>',
    '    </filter>',
    '  </defs>',
    '  <rect x="1" y="1" width="' + (w-2) + '" height="' + (h-2) + '" rx="' + r + '" fill="' + bg + '" filter="url(#dp)"/>',
    '  <polygon points="' + (w/2-5) + ',' + h + ' ' + (w/2+5) + ',' + h + ' ' + (w/2) + ',' + (h+tip) + '" fill="' + bg + '"/>',
    '  <text x="' + (w/2) + '" y="' + (h/2+4.5) + '" text-anchor="middle" font-size="11.5" font-weight="700" font-family="system-ui,sans-serif" fill="#fff" letter-spacing="0.3">' + txt + '</text>',
    '  <rect x="1" y="1" width="' + (w-2) + '" height="' + (h-2) + '" rx="' + r + '" fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="1.2"/>',
    '</svg>'
  ].join('');

  return L.divIcon({
    html: svg,
    className: '',
    iconSize:    [w, h + tip],
    iconAnchor:  [w / 2, h + tip],
    popupAnchor: [0, -(h + tip + 2)]
  });
}

// ---- UTILS ----
function parsePrice(v) {
  if (!v || v === '') return null;
  return parseFloat(String(v).replace(',', '.'));
}

function priceColor(price) {
  if (!price) return 'gray';
  var range = maxP - minP;
  if (range < 0.001) return 'green';
  var pct = (price - minP) / range;
  if (pct < 0.33) return 'green';
  if (pct < 0.66) return 'yellow';
  return 'red';
}

function fmt(price) { return price ? price.toFixed(3) + ' \u20AC/L' : 'N/D'; }

// Detecta si una gasolinera es 24H
function is24H(h) {
  if (!h) return false;
  var u = h.toUpperCase().replace(/\s/g,'');
  return u === '24H' || u.includes('00:00-24:00') || u.includes('00:00-00:00') || u === 'L-D:00:00-24:00';
}

// Version corta para la tarjeta (primer segmento)
function horarioCard(h) {
  if (!h) return 'Horario no disponible';
  if (is24H(h)) return '&#x2665; Abierto 24 horas';
  var segs = h.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
  if (!segs.length) return h;
  return segs[0] + (segs.length > 1 ? ' (+' + (segs.length-1) + ' tramos)' : '');
}

// Version completa para el popup (cada tramo en su linea)
function horarioPopup(h) {
  if (!h) return '<span style="color:#94a3b8;font-size:11px">Horario no disponible</span>';
  if (is24H(h)) return '<span style="color:#16a34a;font-weight:700;font-size:12px">&#x2665; Abierto 24 horas todos los dias</span>';
  var segs = h.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
  return segs.map(function(seg) {
    var parts = seg.match(/^([^:]+):\s*(.+)$/);
    if (!parts) return '<div style="font-size:11px;padding:2px 0">' + esc(seg) + '</div>';
    return '<div style="display:flex;justify-content:space-between;gap:8px;padding:3px 0;font-size:11px;border-bottom:1px solid #f1f5f9">'
      + '<span style="color:#64748b;font-weight:600">' + esc(parts[1].trim()) + '</span>'
      + '<span style="color:#1e293b">' + esc(parts[2].trim()) + '</span>'
      + '</div>';
  }).join('');
}

var FUELS_POPUP = [
  ['Precio Gasolina 95 E5', 'G-95'],
  ['Precio Gasolina 98 E5', 'G-98'],
  ['Precio Gasoleo A', 'Gasoleo A'],
  ['Precio Gasoleo Premium', 'Gasoleo Prem.'],
  ['Precio Gases licuados del petroleo', 'GLP'],
  ['Precio Gas Natural Comprimido', 'GNC'],
  ['Precio Gas Natural Licuado', 'GNL'],
  ['Precio Hidrogeno', 'H2'],
  ['Precio Diesel Renovable', 'Diesel Renov.'],
];

// Dibuja un sparkline SVG con los ultimos puntos de historico (array [{d,p}]).
function buildSparkline(points) {
  if (!points || points.length < 2) return '';
  var vals = points.map(function(p) { return p.p; });
  var min = Math.min.apply(null, vals);
  var max = Math.max.apply(null, vals);
  var range = max - min || 0.001;
  var w = 220, h = 30, step = w / (points.length - 1);
  var path = points.map(function(p, i) {
    var x = (i * step).toFixed(1);
    var y = (h - ((p.p - min) / range) * (h - 4) - 2).toFixed(1);
    return (i === 0 ? 'M' : 'L') + x + ',' + y;
  }).join(' ');
  var area = path + ' L' + w + ',' + h + ' L0,' + h + ' Z';
  var first = points[0].p, last = points[points.length-1].p;
  var cls = last > first + 0.005 ? 'sp-up' : (last < first - 0.005 ? 'sp-down' : 'sp-flat');
  var delta = last - first;
  var trendClass = delta > 0.005 ? 'trend-up' : (delta < -0.005 ? 'trend-down' : '');
  var trendArrow = delta > 0.005 ? '\u2191' : (delta < -0.005 ? '\u2193' : '\u2192');
  var trendTxt = '<div class="trend-label ' + trendClass + '" style="margin-top:2px">'
               + trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(3) + ' \u20AC en ' + points.length + ' dias</div>';
  return '<svg class="sparkline ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
       + '<path class="sp-area" d="' + area + '"/>'
       + '<path d="' + path + '"/>'
       + '</svg>' + trendTxt;
}

function buildPopup(s) {
  var fuel = document.getElementById('sel-combustible').value;
  var fuelEntry = FUELS_POPUP.find(function(f){ return f[0] === fuel; });
  var fuelLabel = fuelEntry ? fuelEntry[1] : fuel;
  var mainPrice = parsePrice(s[fuel]);
  var mainColor = mainPrice ? priceColor(mainPrice) : 'gray';
  var mainBg = CLRS[mainColor];
  var id = stationId(s);
  var fav = isFav(id);

  var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
  var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
  var hasCoords = !isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0);

  // Estado abierta/cerrada
  var status = isOpenNow(s['Horario']);
  var statusHtml = '';
  if (status) {
    statusHtml = status.open
      ? '<span class="status-chip status-open">\u25CF Abierta' + (status.closesAt ? ' hasta ' + esc(status.closesAt) : '') + '</span>'
      : '<span class="status-chip status-closed">\u25CF Cerrada' + (status.opensAt ? ' hasta ' + esc(status.opensAt) : '') + '</span>';
  }

  // Ahorro
  var savingsHtml = '';
  if (mainPrice && currentMedianPrice && currentMedianPrice > mainPrice) {
    var tank = parseInt(localStorage.getItem('gs_tank') || '50', 10);
    var saving = (currentMedianPrice - mainPrice) * tank;
    if (saving >= 0.5) {
      savingsHtml = '<div class="savings-badge" style="margin-top:6px">\u{1F4B0} Ahorras ' + saving.toFixed(2) + ' \u20AC / deposito ' + tank + 'L</div>';
    }
  }

  // Distancia
  var distHtml = '';
  if (userPos && hasCoords) {
    var km = distanceKm(userPos.lat, userPos.lng, lat, lng);
    var mins = Math.round(km / 40 * 60); // 40 km/h urbano
    distHtml = '<span class="distance-chip" style="margin-left:6px">\u{1F9ED} ' + km.toFixed(1) + ' km &middot; ~' + mins + ' min</span>';
  }

  // Sparkline historico (solo si hay datos)
  var hist = getHistory()[id + '|' + fuel] || [];
  var sparkHtml = hist.length >= 2
    ? '<div style="border-top:1px solid #f1f5f9;padding-top:8px;margin-top:8px">'
      + '<div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.05em">\u{1F4C8} Evolucion</div>'
      + buildSparkline(hist)
      + '</div>'
    : '';

  var navBtns = hasCoords ? (
    '<div style="display:flex;gap:5px;margin-top:12px">'
    + '<a href="https://www.google.com/maps/dir/?api=1&destination=' + lat + ',' + lng + '&travelmode=driving" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;background:#4285f4;color:#fff;text-decoration:none">Google Maps</a>'
    + '<a href="https://waze.com/ul?ll=' + lat + ',' + lng + '&navigate=yes" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;background:#09d3f7;color:#0d1b2a;text-decoration:none">Waze</a>'
    + '<a href="https://maps.apple.com/?daddr=' + lat + ',' + lng + '&dirflg=d" target="_blank" rel="noopener" style="flex:1;text-align:center;padding:8px 4px;border-radius:8px;font-size:11px;font-weight:700;background:#1c1c1e;color:#fff;text-decoration:none">Apple Maps</a>'
    + '</div>'
  ) : '';

  // Acciones (fav, share, copiar)
  var actionBtns =
      '<div class="popup-actions">'
    + '  <button data-pop-fav="' + esc(id) + '" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Quitar de favoritas' : 'A\u00f1adir a favoritas') + '">'
    + (fav ? '\u2605 Favorita' : '\u2606 Guardar')
    + '  </button>'
    + '  <button data-pop-share="1" aria-label="Compartir gasolinera">\u{1F4E4} Compartir</button>'
    + '  <button data-pop-copy="' + esc((s['Direccion']||'') + ', ' + (s['Municipio']||'')) + '" aria-label="Copiar direccion">\u{1F4CB} Copiar</button>'
    + '</div>';

  var priceDisplay = mainPrice
    ? (priceUnit === 'c'
        ? '<strong style="font-size:22px;font-weight:800;color:' + mainBg + '">' + (mainPrice * 100).toFixed(1) + ' <span style="font-size:13px">c/L</span></strong>'
        : '<strong style="font-size:22px;font-weight:800;color:' + mainBg + '">' + mainPrice.toFixed(3) + ' <span style="font-size:13px">\u20AC/L</span></strong>'
      )
    : '<span style="font-size:14px;color:#9ca3af">Sin precio</span>';

  return '<div style="font-family:system-ui,sans-serif;min-width:250px">'
    // Cabecera
    + '<div style="background:linear-gradient(135deg,' + mainBg + ' 0%,#0f172a 100%);color:#fff;padding:14px 16px;margin:-12px -14px 12px;border-radius:8px 8px 0 0">'
    + '  <div style="font-weight:800;font-size:15px;line-height:1.2">\u26FD ' + esc(s['Rotulo'] || 'Gasolinera') + '</div>'
    + '  <div style="font-size:11px;opacity:0.75;margin-top:4px">\u{1F4CD} ' + esc(s['Direccion'] || '') + ', ' + esc(s['Municipio'] || '') + distHtml + '</div>'
    + (statusHtml ? '  <div style="margin-top:6px">' + statusHtml + '</div>' : '')
    + '</div>'
    // Precio
    + '<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 2px 10px">'
    + '  <span style="font-size:12px;color:#64748b">' + esc(fuelLabel) + '</span>'
    + '  ' + priceDisplay
    + '</div>'
    + savingsHtml
    // Horario
    + '<div style="border-top:1px solid #f1f5f9;padding-top:8px;margin-top:8px">'
    + '  <div style="font-size:11px;font-weight:700;color:#374151;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.05em">\u{1F550} Horario</div>'
    + horarioPopup(s['Horario'])
    + '</div>'
    + sparkHtml
    // Botones nav + acciones
    + navBtns
    + actionBtns
    + '</div>';
}

// ---- RENDER MARKERS ----
function renderMarkers(stations) {
  if (clusterGroup) map.removeLayer(clusterGroup);

  var fuel = document.getElementById('sel-combustible').value;
  var prices = stations.map(function(s) { return parsePrice(s[fuel]); }).filter(function(p) { return p !== null; });
  minP = prices.length ? Math.min.apply(null, prices) : 0;
  maxP = prices.length ? Math.max.apply(null, prices) : 0;

  // Cluster personalizado: muestra precio minimo del grupo
  clusterGroup = L.markerClusterGroup({
    maxClusterRadius: 55,
    iconCreateFunction: function(cluster) {
      var children = cluster.getAllChildMarkers();
      var cPrices  = children.map(function(m) { return m.options._price; }).filter(function(p) { return p > 0; });
      var cMin     = cPrices.length ? Math.min.apply(null, cPrices) : null;
      var cColor   = cMin ? priceColor(cMin) : 'gray';
      var bg       = CLRS[cColor] || CLRS.gray;
      var count    = cluster.getChildCount();
      var sz       = count > 200 ? 52 : count > 50 ? 44 : 36;
      var fs       = count > 99  ? 9  : 11;
      return L.divIcon({
        html: [
          '<div style="width:' + sz + 'px;height:' + sz + 'px;background:' + bg + ';',
          'border-radius:50%;display:flex;flex-direction:column;align-items:center;',
          'justify-content:center;border:3px solid rgba(255,255,255,0.85);',
          'box-shadow:0 3px 12px rgba(0,0,0,0.3);font-family:system-ui,sans-serif;gap:1px">',
          '  <span style="color:#fff;font-size:' + fs + 'px;font-weight:800;line-height:1">' + count + '</span>',
          cMin ? '<span style="color:rgba(255,255,255,0.9);font-size:8px;font-weight:600;line-height:1">' + cMin.toFixed(2) + '\u20AC</span>' : '',
          '</div>'
        ].join(''),
        className: '',
        iconSize:   [sz, sz],
        iconAnchor: [sz / 2, sz / 2]
      });
    }
  });

  var bounds = [];
  stations.forEach(function(s, idx) {
    var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
    var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;

    var price = parsePrice(s[fuel]);
    var color = priceColor(price);
    var icon  = makeIcon(color, price);
    var marker = L.marker([lat, lng], { icon: icon, _price: price || 0 });
    marker.bindPopup(buildPopup(s), { maxWidth: 300, className: 'custom-popup' });
    marker.on('click', function() { highlightCard(idx); });
    clusterGroup.addLayer(marker);
    bounds.push([lat, lng]);
  });

  map.addLayer(clusterGroup);

  if (bounds.length > 0) {
    try { map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 }); }
    catch(e) {}
  }
}

function highlightCard(idx) {
  document.querySelectorAll('.station-card').forEach(function(el) { el.classList.remove('active'); });
  var card = document.querySelector('[data-idx="' + idx + '"]');
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ---- RENDER LIST (paginacion virtual, 30 items + scroll infinito) ----
var PAGE_SIZE = 30;
var listStations = [];
var listOffset = 0;

function cardHTML(s, i, fuel, fuelLabel) {
  var price = parsePrice(s[fuel]);
  var color = priceColor(price);
  var badgeCls = 'badge badge-' + color;
  var id = stationId(s);
  var fav = isFav(id);

  // Medalla top3 + ahorro por deposito
  var medal = '';
  if (topCheapIds[id] && price) {
    var rank = topCheapIds[id];
    medal = '<span class="medal" aria-hidden="true">' + (rank === 1 ? '\u{1F947}' : rank === 2 ? '\u{1F948}' : '\u{1F949}') + '</span>';
  }
  var savingsHtml = '';
  if (price && currentMedianPrice && currentMedianPrice > price) {
    var tank = parseInt(localStorage.getItem('gs_tank') || '50', 10);
    var saving = (currentMedianPrice - price) * tank;
    if (saving >= 0.5) {
      savingsHtml = '<span class="savings-badge" title="Ahorro frente a la mediana del listado">\u{1F4B0} ahorra ' + saving.toFixed(2) + ' \u20AC / dep.</span>';
    }
  }

  // Distancia si tenemos userPos
  var distHtml = '';
  if (userPos) {
    var pos = stationLatLng(s);
    if (pos) {
      var km = distanceKm(userPos.lat, userPos.lng, pos.lat, pos.lng);
      if (km < 1) distHtml = '<span class="distance-chip" aria-label="Distancia">' + Math.round(km*1000) + ' m</span>';
      else distHtml = '<span class="distance-chip" aria-label="Distancia">' + km.toFixed(1) + ' km</span>';
    }
  }

  // Horario vivo
  var statusHtml = '';
  var status = isOpenNow(s['Horario']);
  if (status) {
    if (status.open) {
      statusHtml = '<span class="status-chip status-open" aria-label="Abierta ahora">\u25CF Abierta'
                 + (status.closesAt ? ' &middot; cierra ' + esc(status.closesAt) : '') + '</span>';
    } else {
      statusHtml = '<span class="status-chip status-closed" aria-label="Cerrada ahora">\u25CF Cerrada'
                 + (status.opensAt ? ' &middot; abre ' + esc(status.opensAt) : '') + '</span>';
    }
  }

  var priceText = price ? fmtPriceUnit(price) : '';
  var priceEl = price
    ? '<span class="' + badgeCls + '">' + priceText + '</span>'
    : '<span style="font-size:11px;color:#9ca3af">N/D</span>';

  return '<div class="station-card" data-idx="' + i + '" data-zoom="1" role="listitem" tabindex="0" aria-label="' + esc((s['Rotulo']||'Gasolinera')+' en '+(s['Municipio']||'')+(price?', '+priceText:'')) + '">'
    + '<button class="fav-btn' + (fav ? ' active' : '') + '" data-fav-id="' + esc(id) + '" aria-label="' + (fav ? 'Quitar de favoritas' : 'A\u00f1adir a favoritas') + '" aria-pressed="' + fav + '">'
    + (fav ? '\u2605' : '\u2606') + '</button>'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:4px;padding-right:22px">'
    + '<div style="min-width:0;flex:1">'
    + '<div class="card-title">' + medal + '\u26FD ' + esc(s['Rotulo'] || 'Gasolinera') + distHtml + '</div>'
    + '<div class="card-sub">\u{1F4CD} ' + esc(s['Direccion'] || '') + ', ' + esc(s['Municipio'] || '') + '</div>'
    + '<div class="card-time">\u{1F550} ' + horarioCard(s['Horario']) + statusHtml + '</div>'
    + (savingsHtml ? '<div style="margin-top:3px">' + savingsHtml + '</div>' : '')
    + '</div>'
    + '<div style="flex-shrink:0;text-align:right">'
    + priceEl
    + '<div style="font-size:10px;color:#9ca3af;margin-top:1px">' + esc(fuelLabel.slice(0,18)) + '</div>'
    + '</div></div></div>';
}

function appendPage() {
  var list = document.getElementById('station-list');
  var fuel = document.getElementById('sel-combustible').value;
  var fuelLabel = document.getElementById('sel-combustible').selectedOptions[0].text.replace(/^\S+\s*/, '');
  var slice = listStations.slice(listOffset, listOffset + PAGE_SIZE);
  if (!slice.length) return;
  var frag = slice.map(function(s, j) { return cardHTML(s, listOffset + j, fuel, fuelLabel); }).join('');
  list.insertAdjacentHTML('beforeend', frag);
  listOffset += slice.length;
  var sentinel = list.querySelector('#list-sentinel');
  if (sentinel) sentinel.style.display = listOffset >= listStations.length ? 'none' : 'block';
}

function renderList(stations) {
  var list = document.getElementById('station-list');
  var fuel = document.getElementById('sel-combustible').value;
  list.setAttribute('aria-busy', 'false');

  if (!stations.length) {
    list.innerHTML = '<div class="empty-state"><div class="icon" aria-hidden="true">&#x1F50D;</div><p>Sin resultados</p><small>Prueba con otros filtros</small></div>';
    return;
  }

  var prices = stations.map(function(s) { return parsePrice(s[fuel]); }).filter(function(p) { return p !== null; });
  var sMin = prices.length ? Math.min.apply(null, prices) : null;
  var sMax = prices.length ? Math.max.apply(null, prices) : null;
  var sAvg = prices.length ? (prices.reduce(function(a, b) { return a+b; }, 0)/prices.length) : null;

  document.getElementById('stats-bar').style.display = 'block';
  document.getElementById('stat-n').textContent = stations.length;
  document.getElementById('stat-min').textContent = sMin ? sMin.toFixed(3) + ' \u20AC' : 'N/D';
  document.getElementById('stat-avg').textContent = sAvg ? sAvg.toFixed(3) + ' \u20AC' : 'N/D';
  document.getElementById('stat-max').textContent = sMax ? sMax.toFixed(3) + ' \u20AC' : 'N/D';

  // Reset estado virtual
  listStations = stations;
  listOffset = 0;
  list.innerHTML = '<div id="list-sentinel" style="display:none;text-align:center;padding:10px;font-size:12px;color:#94a3b8">Cargando mas...</div>';
  appendPage(); // primera pagina

  // IntersectionObserver para cargar al llegar al final
  if (list._observer) list._observer.disconnect();
  var sentinel = list.querySelector('#list-sentinel');
  var observer = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting && listOffset < listStations.length) appendPage();
  }, { root: list, threshold: 0.1 });
  observer.observe(sentinel);
  list._observer = observer;
}

function zoomTo(idx) {
  var s = filteredStations[idx];
  var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
  var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
  if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
    map.setView([lat, lng], 17);
    clusterGroup.eachLayer(function(layer) {
      var lpos = layer.getLatLng();
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
  var fuel  = document.getElementById('sel-combustible').value;
  var text  = document.getElementById('search-text').value.trim().toLowerCase();
  var orden = document.getElementById('sel-orden').value;
  var radius = parseInt(document.getElementById('in-radius').value, 10);

  var stations = allStations.slice();

  // Filtro por combustible: si el usuario eligio perfil estricto, quitar estaciones sin precio en ese combustible
  // Solo cuando hay un perfil y el orden es por precio o cerca
  var profile = getProfile();
  var strictFuel = profile && profile.strictFuel;
  if (strictFuel && (orden === 'asc' || orden === 'desc' || orden === 'cerca')) {
    stations = stations.filter(function(s) { return parsePrice(s[fuel]); });
  }

  // Filtro por radio (solo si hay userPos y el sel-orden indica cerca/dist)
  var usingNearby = userPos && (orden === 'cerca' || orden === 'dist');
  if (usingNearby && radius) {
    stations = stations.filter(function(s) {
      var pos = stationLatLng(s);
      if (!pos) return false;
      return distanceKm(userPos.lat, userPos.lng, pos.lat, pos.lng) <= radius;
    });
  }

  if (text) {
    var normText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    stations = stations.filter(function(s) {
      return (s['Rotulo'] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').includes(normText);
    });
  }

  // Mediana para calculo de ahorro
  var prices = stations.map(function(s) { return parsePrice(s[fuel]); });
  currentMedianPrice = median(prices);

  // Ordenaciones
  stations.sort(function(a, b) {
    if (orden === 'asc' || orden === 'desc') {
      var pa = parsePrice(a[fuel]), pb = parsePrice(b[fuel]);
      if (!pa && !pb) return 0; if (!pa) return 1; if (!pb) return -1;
      return orden === 'asc' ? pa - pb : pb - pa;
    } else if (orden === 'cerca' && userPos) {
      // Score: penalizar distancia (0.02 €/km equivale a compensar ~1km por cada cent.)
      var pa2 = parsePrice(a[fuel]), pb2 = parsePrice(b[fuel]);
      var posA = stationLatLng(a), posB = stationLatLng(b);
      var dA = posA ? distanceKm(userPos.lat, userPos.lng, posA.lat, posA.lng) : 9999;
      var dB = posB ? distanceKm(userPos.lat, userPos.lng, posB.lat, posB.lng) : 9999;
      var sa = (pa2 || 99) + dA * 0.02;
      var sb = (pb2 || 99) + dB * 0.02;
      return sa - sb;
    } else if (orden === 'dist' && userPos) {
      var posA2 = stationLatLng(a), posB2 = stationLatLng(b);
      var dA2 = posA2 ? distanceKm(userPos.lat, userPos.lng, posA2.lat, posA2.lng) : 9999;
      var dB2 = posB2 ? distanceKm(userPos.lat, userPos.lng, posB2.lat, posB2.lng) : 9999;
      return dA2 - dB2;
    }
    return (a['Rotulo'] || '').localeCompare(b['Rotulo'] || '');
  });

  // Top 3 mas baratas (para medallas)
  topCheapIds = {};
  var ranking = stations
    .map(function(s) { return { id: stationId(s), p: parsePrice(s[fuel]) }; })
    .filter(function(x) { return x.p; })
    .sort(function(a,b) { return a.p - b.p; });
  for (var i = 0; i < Math.min(3, ranking.length); i++) {
    topCheapIds[ranking[i].id] = i + 1;
  }

  filteredStations = stations;
  renderMarkers(stations);
  renderList(stations);

  var lbl = document.getElementById('lbl-count');
  lbl.textContent = stations.length + ' gasolineras';
  lbl.style.display = 'inline-block';

  // Guardar historico de precios (solo favoritos, evita llenar storage)
  recordHistoryForFavorites(stations, fuel);
  // Actualizar gasto mensual + panel favoritos
  updateMonthlyWidget();
  renderFavsPanel();
}

// ---- CACHE localStorage ----
// Fresco: <4h, datos casi en tiempo real
// Stale: 4h-30d, se puede usar como fallback cuando el Ministerio esta caido
var CACHE_FRESH_TTL = 4 * 60 * 60 * 1000;
var CACHE_HARD_TTL  = 30 * 24 * 60 * 60 * 1000;
function cacheKey(idProv, idMun) { return 'gs_v2_' + idProv + '_' + (idMun || 'all'); }
function getCache(key, allowStale) {
  try {
    var raw = localStorage.getItem(key);
    if (!raw) return null;
    var parsed = JSON.parse(raw);
    var ts = parsed.ts, data = parsed.data, fecha = parsed.fecha;
    var age = Date.now() - ts;
    if (age > CACHE_HARD_TTL) { localStorage.removeItem(key); return null; }
    if (!allowStale && age > CACHE_FRESH_TTL) return null;
    return { data: data, fecha: fecha, ts: ts, stale: age > CACHE_FRESH_TTL };
  } catch(e) { return null; }
}
function setCache(key, data, fecha) {
  try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data: data, fecha: fecha })); } catch(e) {}
}

// ---- CACHE AGE INDICATOR ----
function formatAge(ts) {
  var mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 2) return 'ahora mismo';
  if (mins < 60) return 'hace ' + mins + ' min';
  var hrs = Math.floor(mins / 60);
  if (hrs < 24) return 'hace ' + hrs + 'h';
  return 'hace ' + Math.floor(hrs/24) + 'd';
}

function showCacheIndicator(ts, stale) {
  var lbl = document.getElementById('lbl-update');
  var age = formatAge(ts);
  lbl.innerHTML = '';
  if (stale) {
    lbl.appendChild(document.createTextNode('\u26A0 ' + age + ' '));
    var btn = document.createElement('button');
    btn.textContent = 'Actualizar';
    btn.style.cssText = 'background:rgba(255,255,255,0.25);border:none;color:#fff;border-radius:4px;padding:1px 6px;font-size:10px;cursor:pointer;margin-left:4px';
    btn.addEventListener('click', forceReload);
    lbl.appendChild(btn);
  } else {
    lbl.textContent = '\u2713 ' + age;
  }
  lbl.style.display = 'inline';
}

async function refreshInBackground(key, idProv, idMun) {
  try {
    var url = idMun ? '/api/estaciones/municipio/' + idMun : '/api/estaciones/provincia/' + idProv;
    var res = await fetch(url);
    if (!res.ok) return;
    var data = await res.json();
    var stations = (data.ListaEESSPrecio || []).map(normalizeStation);
    setCache(key, stations, data.Fecha || '');
    allStations = stations;
    applyFilters();
    showCacheIndicator(Date.now(), false);
  } catch(e) { /* silencioso */ }
}

function forceReload() {
  var idProv = document.getElementById('sel-provincia').value;
  var idMun = document.getElementById('sel-municipio').value;
  if (!idProv) return;
  var key = cacheKey(idProv, idMun);
  try { localStorage.removeItem(key); } catch(e) {}
  loadStations();
}

// ---- API CALLS (via proxy Hono) ----
// ---- PROVINCIAS HARDCODEADAS (INE oficial, 52 entradas) ----
// No dependemos de la API del Ministerio para el listado estatico de provincias.
var SPAIN_PROVINCIAS = [
  { IDPovincia: '01', Provincia: 'ARABA/ALAVA',        CCAA: 'Pais Vasco' },
  { IDPovincia: '02', Provincia: 'ALBACETE',           CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '03', Provincia: 'ALICANTE',           CCAA: 'Comunidad Valenciana' },
  { IDPovincia: '04', Provincia: 'ALMERIA',            CCAA: 'Andalucia' },
  { IDPovincia: '33', Provincia: 'ASTURIAS',           CCAA: 'Principado de Asturias' },
  { IDPovincia: '05', Provincia: 'AVILA',              CCAA: 'Castilla y Leon' },
  { IDPovincia: '06', Provincia: 'BADAJOZ',            CCAA: 'Extremadura' },
  { IDPovincia: '07', Provincia: 'ILLES BALEARS',      CCAA: 'Illes Balears' },
  { IDPovincia: '08', Provincia: 'BARCELONA',          CCAA: 'Cataluna' },
  { IDPovincia: '48', Provincia: 'BIZKAIA',            CCAA: 'Pais Vasco' },
  { IDPovincia: '09', Provincia: 'BURGOS',             CCAA: 'Castilla y Leon' },
  { IDPovincia: '10', Provincia: 'CACERES',            CCAA: 'Extremadura' },
  { IDPovincia: '11', Provincia: 'CADIZ',              CCAA: 'Andalucia' },
  { IDPovincia: '39', Provincia: 'CANTABRIA',          CCAA: 'Cantabria' },
  { IDPovincia: '12', Provincia: 'CASTELLON',          CCAA: 'Comunidad Valenciana' },
  { IDPovincia: '51', Provincia: 'CEUTA',              CCAA: 'Ceuta' },
  { IDPovincia: '13', Provincia: 'CIUDAD REAL',        CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '14', Provincia: 'CORDOBA',            CCAA: 'Andalucia' },
  { IDPovincia: '15', Provincia: 'A CORUNA',           CCAA: 'Galicia' },
  { IDPovincia: '16', Provincia: 'CUENCA',             CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '20', Provincia: 'GIPUZKOA',           CCAA: 'Pais Vasco' },
  { IDPovincia: '17', Provincia: 'GIRONA',             CCAA: 'Cataluna' },
  { IDPovincia: '18', Provincia: 'GRANADA',            CCAA: 'Andalucia' },
  { IDPovincia: '19', Provincia: 'GUADALAJARA',        CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '21', Provincia: 'HUELVA',             CCAA: 'Andalucia' },
  { IDPovincia: '22', Provincia: 'HUESCA',             CCAA: 'Aragon' },
  { IDPovincia: '23', Provincia: 'JAEN',               CCAA: 'Andalucia' },
  { IDPovincia: '24', Provincia: 'LEON',               CCAA: 'Castilla y Leon' },
  { IDPovincia: '25', Provincia: 'LLEIDA',             CCAA: 'Cataluna' },
  { IDPovincia: '27', Provincia: 'LUGO',               CCAA: 'Galicia' },
  { IDPovincia: '28', Provincia: 'MADRID',             CCAA: 'Comunidad de Madrid' },
  { IDPovincia: '29', Provincia: 'MALAGA',             CCAA: 'Andalucia' },
  { IDPovincia: '52', Provincia: 'MELILLA',            CCAA: 'Melilla' },
  { IDPovincia: '30', Provincia: 'MURCIA',             CCAA: 'Region de Murcia' },
  { IDPovincia: '31', Provincia: 'NAVARRA',            CCAA: 'Comunidad Foral de Navarra' },
  { IDPovincia: '32', Provincia: 'OURENSE',            CCAA: 'Galicia' },
  { IDPovincia: '34', Provincia: 'PALENCIA',           CCAA: 'Castilla y Leon' },
  { IDPovincia: '35', Provincia: 'PALMAS (LAS)',       CCAA: 'Canarias' },
  { IDPovincia: '36', Provincia: 'PONTEVEDRA',         CCAA: 'Galicia' },
  { IDPovincia: '26', Provincia: 'LA RIOJA',           CCAA: 'La Rioja' },
  { IDPovincia: '37', Provincia: 'SALAMANCA',          CCAA: 'Castilla y Leon' },
  { IDPovincia: '38', Provincia: 'SANTA CRUZ DE TENERIFE', CCAA: 'Canarias' },
  { IDPovincia: '40', Provincia: 'SEGOVIA',            CCAA: 'Castilla y Leon' },
  { IDPovincia: '41', Provincia: 'SEVILLA',            CCAA: 'Andalucia' },
  { IDPovincia: '42', Provincia: 'SORIA',              CCAA: 'Castilla y Leon' },
  { IDPovincia: '43', Provincia: 'TARRAGONA',          CCAA: 'Cataluna' },
  { IDPovincia: '44', Provincia: 'TERUEL',             CCAA: 'Aragon' },
  { IDPovincia: '45', Provincia: 'TOLEDO',             CCAA: 'Castilla-La Mancha' },
  { IDPovincia: '46', Provincia: 'VALENCIA',           CCAA: 'Comunidad Valenciana' },
  { IDPovincia: '47', Provincia: 'VALLADOLID',         CCAA: 'Castilla y Leon' },
  { IDPovincia: '49', Provincia: 'ZAMORA',             CCAA: 'Castilla y Leon' },
  { IDPovincia: '50', Provincia: 'ZARAGOZA',           CCAA: 'Aragon' }
];

function fillProvincias(sel, data) {
  data.sort(function(a, b) { return a.Provincia.localeCompare(b.Provincia); });
  data.forEach(function(p) {
    var o = document.createElement('option');
    o.value = p.IDPovincia;
    o.textContent = p.Provincia + ' (' + p.CCAA + ')';
    sel.appendChild(o);
  });
}

function loadProvincias() {
  // Siempre cargamos desde la constante hardcodeada - zero dependencia de API
  var sel = document.getElementById('sel-provincia');
  fillProvincias(sel, SPAIN_PROVINCIAS.slice());
}

// ---- CARGA DE MUNICIPIOS con cache localStorage por provincia ----
var MUN_KEY_PREFIX = 'gs_mun_v1_';
var MUN_TTL_FRESH  = 7  * 24 * 60 * 60 * 1000;
var MUN_TTL_STALE  = 30 * 24 * 60 * 60 * 1000;

function fillMunicipios(sel, data) {
  data.sort(function(a, b) { return a.Municipio.localeCompare(b.Municipio); });
  data.forEach(function(m) {
    var o = document.createElement('option');
    o.value = m.IDMunicipio;
    o.textContent = m.Municipio;
    sel.appendChild(o);
  });
  sel.disabled = false;
}

async function loadMunicipios(idProv) {
  var sel = document.getElementById('sel-municipio');
  sel.innerHTML = '<option value="">-- Todos --</option>';
  sel.disabled = true;
  if (!idProv) return;

  var key    = MUN_KEY_PREFIX + idProv;
  var cached = lsRead(key);
  var age    = cached ? Date.now() - cached.ts : Infinity;

  if (cached && age < MUN_TTL_FRESH) {
    fillMunicipios(sel, cached.data);
    return;
  }

  if (cached && age < MUN_TTL_STALE) {
    fillMunicipios(sel, cached.data);
    fetchJSON('/api/municipios/' + idProv).then(function(data) {
      lsWrite(key, data);
    }).catch(function() {});
    return;
  }

  try {
    var data = await fetchJSON('/api/municipios/' + idProv);
    lsWrite(key, data);
    fillMunicipios(sel, data);
  } catch(e) {
    if (cached) {
      fillMunicipios(sel, cached.data);
    } else {
      showToast('API del Ministerio no disponible. Puedes buscar por provincia sin municipio.', 'warning');
      sel.disabled = false;
    }
  }
}

function renderSkeletons(count) {
  var list = document.getElementById('station-list');
  list.setAttribute('aria-busy', 'true');
  var html = '';
  for (var i = 0; i < count; i++) {
    html += '<div class="skeleton-card" aria-hidden="true">'
         +   '<div class="sk-left">'
         +     '<div class="sk-line sk-title"></div>'
         +     '<div class="sk-line sk-sub"></div>'
         +     '<div class="sk-line sk-time"></div>'
         +   '</div>'
         +   '<div class="sk-badge"></div>'
         + '</div>';
  }
  list.innerHTML = html;
}

async function loadStations() {
  var idProv = document.getElementById('sel-provincia').value;
  var idMunSel = document.getElementById('sel-municipio').value;
  var orden = document.getElementById('sel-orden').value;

  if (!idProv) { showToast('Selecciona una provincia primero', 'warning'); return; }

  // Modo radio (cerca / distancia) con userPos: cargar SIEMPRE a nivel provincial
  // para que el filtro haversine posterior tenga un pool grande. Si el usuario
  // selecciono "Durango" (1 estacion) + radio 20km, cargar solo Durango hacia
  // que el filtro sea un no-op. A nivel provincia (~150 estaciones en Bizkaia)
  // el radio de 20km devuelve decenas.
  var usingNearby = userPos && (orden === 'cerca' || orden === 'dist');
  var idMun = usingNearby ? '' : idMunSel;

  document.getElementById('stats-bar').style.display = 'none';
  renderSkeletons(6);

  var key = cacheKey(idProv, idMun);
  var cached = getCache(key);

  if (cached) {
    allStations = cached.data;
    var stale = Date.now() - cached.ts > 2 * 60 * 60 * 1000;
    showCacheIndicator(cached.ts, stale);
    applyFilters();
    if (stale) refreshInBackground(key, idProv, idMun);
    return;
  }

  document.getElementById('loading').classList.add('show');

  try {
    var url = idMun
      ? '/api/estaciones/municipio/' + idMun
      : '/api/estaciones/provincia/' + idProv;

    var data = await fetchJSON(url);
    allStations = (data.ListaEESSPrecio || []).map(normalizeStation);

    showCacheIndicator(Date.now(), false);
    if (data.Fecha) {
      var lbl = document.getElementById('lbl-update');
      lbl.title = 'Datos del Ministerio: ' + data.Fecha;
    }

    setCache(key, allStations, data.Fecha || '');
    applyFilters();
  } catch(err) {
    console.error(err);
    // Fallback: usar cache vieja (hasta 30 dias) si existe
    var stale = getCache(key, true);
    if (stale) {
      allStations = stale.data;
      showCacheIndicator(stale.ts, true);
      applyFilters();
      showToast('El Ministerio no responde. Mostrando datos guardados (' + formatAge(stale.ts) + ').', 'warning');
    } else {
      showListError('El Ministerio de Industria no responde ahora mismo. Vuelve a intentarlo en unos minutos.');
      showToast('API del Ministerio no disponible. Reintenta en unos minutos.', 'error');
    }
  } finally {
    document.getElementById('loading').classList.remove('show');
  }
}

// ---- GEOLOCALIZACION -> carga gasolineras del municipio ----
function normStr(s) {
  return (s || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Alias: nombre que devuelve Nominatim -> fragmento que aparece en el selector del Ministerio
var PROV_ALIAS = {
  'vizcaya'    : 'bizkaia',
  'guipuzcoa'  : 'gipuzkoa',
  'alava'      : 'araba',
  'gerona'     : 'girona',
  'lerida'     : 'lleida',
  'la coruna'  : 'coruna',
  'orense'     : 'ourense',
  'la rioja'   : 'rioja',
  'islas baleares' : 'balears',
  'islas canarias' : 'palmas',
  'gran canaria'   : 'palmas',
  'tenerife'       : 'santa cruz de tenerife',
};

function matchProv(raw) {
  var n = normStr(raw);
  return PROV_ALIAS[n] || n;
}

document.getElementById('btn-geolocate').addEventListener('click', async function() {
  if (!navigator.geolocation) { showToast('Tu navegador no soporta geolocalizacion', 'warning'); return; }

  var btn  = document.getElementById('btn-geolocate');
  var icon = btn.querySelector('i');
  icon.className = 'fas fa-spinner fa-spin';
  btn.disabled   = true;

  try {
    // 1. Coordenadas GPS
    var pos = await new Promise(function(res, rej) {
      navigator.geolocation.getCurrentPosition(res, rej, {
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60000
      });
    });
    var lat = pos.coords.latitude;
    var lng = pos.coords.longitude;
    userPos = { lat: lat, lng: lng };
    // Mostrar slider de radio y cambiar orden automaticamente a "cerca"
    document.getElementById('radius-group').style.display = 'block';
    var selOrden = document.getElementById('sel-orden');
    if (selOrden.value !== 'cerca' && selOrden.value !== 'dist') selOrden.value = 'cerca';

    map.setView([lat, lng], 13);
    L.circleMarker([lat, lng], {
      radius: 11, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.55, weight: 2
    }).addTo(map).bindPopup('<b>&#x1F4CD; Tu ubicacion</b>').openPopup();

    // 2. Geocodificacion inversa
    var revRes = await fetch(
      'https://nominatim.openstreetmap.org/reverse?format=json&lat=' + lat + '&lon=' + lng + '&addressdetails=1',
      { headers: { 'Accept-Language': 'es' } }
    );
    var addr = (await revRes.json()).address || {};
    console.log('[geo] address:', JSON.stringify(addr));

    // Candidatos de provincia en orden de fiabilidad
    var provCandidates = [
      addr.state_district, addr.county, addr.province, addr.state
    ].filter(Boolean);

    // Candidato de municipio
    var munRaw = addr.city || addr.town || addr.village || addr.municipality || addr.suburb || '';

    // 3. Buscar provincia: probar cada candidato con alias
    var selProv   = document.getElementById('sel-provincia');
    var foundProvId = null;

    outer: for (var ci = 0; ci < provCandidates.length; ci++) {
      var raw = provCandidates[ci];
      var needle = matchProv(raw);
      var words  = needle.split(' ').filter(function(w) { return w.length > 2; });
      for (var oi = 0; oi < selProv.options.length; oi++) {
        var opt = selProv.options[oi];
        if (!opt.value) continue;
        var optN = normStr(opt.textContent);
        if (words.some(function(w) { return optN.includes(w); })) {
          foundProvId   = opt.value;
          selProv.value = opt.value;
          console.log('[geo] provincia encontrada:', opt.textContent, '<- candidato:', raw);
          break outer;
        }
      }
    }

    if (!foundProvId) {
      showToast('No se pudo identificar tu provincia. Seleccionala manualmente.', 'warning');
      return;
    }

    // 4. Cargar municipios
    await loadMunicipios(foundProvId);

    // 5. Buscar municipio (matching flexible)
    if (munRaw) {
      var selMun  = document.getElementById('sel-municipio');
      var normMun = normStr(munRaw);
      var bestOpt   = null, bestScore = 0;
      for (var mi = 0; mi < selMun.options.length; mi++) {
        var mopt = selMun.options[mi];
        if (!mopt.value) continue;
        var moptN = normStr(mopt.textContent);
        var score = moptN === normMun ? 3 : normMun.startsWith(moptN) || moptN.startsWith(normMun) ? 2 : moptN.includes(normMun) || normMun.includes(moptN) ? 1 : 0;
        if (score > bestScore) { bestScore = score; bestOpt = mopt; }
      }
      if (bestOpt && bestScore > 0) {
        selMun.value = bestOpt.value;
        console.log('[geo] municipio encontrado:', bestOpt.textContent, 'score:', bestScore);
      }
    }

    // 6. Cargar gasolineras
    await loadStations();

  } catch(e) {
    console.error('[geo] error:', e);
    if (e.code === 1)      showToast('Permiso de ubicacion denegado.\\nActiva la ubicacion en el icono del candado (barra de direcciones).', 'error');
    else if (e.code === 2) showToast('Ubicacion no disponible. Asegurate de tener WiFi o datos activos.', 'error');
    else if (e.code === 3) showToast('Tiempo de espera agotado. Comprueba que el navegador tiene permiso de ubicacion e intentalo de nuevo.', 'error');
    else                   showToast('No se pudo obtener la ubicacion (error ' + (e.code || '?') + '). Intentalo de nuevo.', 'error');
  } finally {
    icon.className = 'fas fa-crosshairs';
    btn.disabled   = false;
  }
});

// ---- EVENTOS ----
// Filosofia UX: los cambios en los filtros NO disparan carga ni render. El
// usuario decide cuando mirar resultados pulsando "Buscar" (o "Mi ubicacion").
// Asi evitamos que un usuario indeciso vea la lista bailar mientras ajusta 4
// controles — y ahorramos llamadas innecesarias al Ministerio.
document.getElementById('sel-provincia').addEventListener('change', async function(e) {
  // Unica excepcion: al cambiar provincia hay que refrescar el dropdown de
  // municipios (es un selector dependiente). No carga estaciones.
  await loadMunicipios(e.target.value);
});
document.getElementById('sel-municipio').addEventListener('change', function() {
  // No-op: el render llega con "Buscar".
});
document.getElementById('sel-combustible').addEventListener('change', function() {
  // No-op: el render llega con "Buscar".
});
document.getElementById('sel-orden').addEventListener('change', function(e) {
  // Mostrar slider de radio solo cuando tiene sentido (cerca / distancia).
  var needsRadius = (e.target.value === 'cerca' || e.target.value === 'dist');
  var rg = document.getElementById('radius-group');
  if (needsRadius && userPos) rg.style.display = 'block';
  else if (!needsRadius) rg.style.display = 'none';
  else if (needsRadius && !userPos) {
    showToast('Pulsa el boton de ubicacion para usar esta ordenacion', 'warning');
  }
  // Excepcion a la regla "nada hasta Buscar": el orden SI se reaplica en vivo
  // si ya hay estaciones cargadas. Motivo: ordenar es una operacion puramente
  // de cliente (reordenar un array en memoria) — no dispara fetch ni cambia
  // el conjunto de resultados, solo el orden. Si el usuario va a la lista y
  // quiere ver "mas barato primero" en lugar de "A-Z", forzarle un click de
  // Buscar extra seria absurdo.
  if (allStations.length) applyFilters();
});

// ---- AUTOCOMPLETADO BUSQUEDA ----
(function() {
  var input  = document.getElementById('search-text');
  var box    = document.getElementById('search-suggestions');
  var selIdx   = -1;

  function normQ(s) {
    return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function showSuggestions(q) {
    if (!q || q.length < 2 || !allStations.length) { box.classList.remove('show'); return; }
    var ql = normQ(q);
    var fuel = document.getElementById('sel-combustible').value;

    var seen = new Set();
    var matches = [];
    for (var i = 0; i < allStations.length; i++) {
      var s = allStations[i];
      var rotulo = normQ(s['Rotulo'] || '');
      if (!rotulo.includes(ql)) continue;
      if (seen.has(rotulo)) continue;
      seen.add(rotulo);
      matches.push(s);
      if (matches.length >= 8) break;
    }

    if (!matches.length) { box.classList.remove('show'); return; }

    selIdx = -1;
    box.innerHTML = matches.map(function(s, i) {
      var price = parsePrice(s[fuel]);
      var color = priceColor(price);
      var bg    = CLRS[color] || CLRS.gray;
      var nameSafe = esc(s['Rotulo'] || 'Gasolinera');
      // Highlight sobre el texto ya escapado: $1 es siempre texto seguro
      var hl    = nameSafe.replace(new RegExp('(' + q.replace(/[.*+?^{}$()|[\]\\]/g,'\\$&') + ')', 'gi'), '<mark style="background:#bbf7d0;color:#15803d;border-radius:2px">$1</mark>');
      return '<div class="suggest-item" data-idx="' + i + '">'
        + '<div style="flex:1;min-width:0">'
        + '  <div class="suggest-name">&#x26FD; ' + hl + '</div>'
        + '  <div class="suggest-sub">&#x1F4CD; ' + esc(s['Municipio']) + '</div>'
        + '</div>'
        + (price ? '<span class="suggest-price" style="background:' + bg + '">' + price.toFixed(3) + ' &#x20AC;</span>' : '')
        + '</div>';
    }).join('');

    box._matches = matches;
    box.classList.add('show');
  }

  function selectItem(s) {
    input.value = s['Rotulo'] || '';
    box.classList.remove('show');
    applyFilters();
    var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
    var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
    if (!isNaN(lat) && !isNaN(lng) && (lat !== 0 || lng !== 0)) {
      map.setView([lat, lng], 17);
      if (clusterGroup) {
        clusterGroup.eachLayer(function(layer) {
          var lp = layer.getLatLng();
          if (Math.abs(lp.lat - lat) < 0.0002 && Math.abs(lp.lng - lng) < 0.0002) layer.openPopup();
        });
      }
    }
  }

  input.addEventListener('input', function() {
    // El autocomplete (dropdown de sugerencias) sigue funcionando en vivo —
    // es una ayuda visual, no cambia el mapa. Pero NO reaplicamos filtros al
    // vuelo: el usuario vera la lista filtrada cuando pulse "Buscar".
    showSuggestions(input.value.trim());
  });

  box.addEventListener('mousedown', function(e) {
    var item = e.target.closest('.suggest-item');
    if (!item) return;
    e.preventDefault();
    selectItem(box._matches[+item.dataset.idx]);
  });

  // Navegacion con teclado arriba abajo Enter Esc
  input.addEventListener('keydown', function(e) {
    var items = box.querySelectorAll('.suggest-item');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selIdx = Math.min(selIdx + 1, items.length - 1);
      items.forEach(function(el, i) { el.style.background = i === selIdx ? '#f0fdf4' : ''; });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selIdx = Math.max(selIdx - 1, -1);
      items.forEach(function(el, i) { el.style.background = i === selIdx ? '#f0fdf4' : ''; });
    } else if (e.key === 'Enter') {
      if (selIdx >= 0 && box._matches) { selectItem(box._matches[selIdx]); }
      else loadStations();
    } else if (e.key === 'Escape') {
      box.classList.remove('show');
    }
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('.form-group')) box.classList.remove('show');
  });

  input.addEventListener('focus', function() {
    if (input.value.trim().length >= 2) showSuggestions(input.value.trim());
  });
})();

document.getElementById('btn-buscar').addEventListener('click', loadStations);

// ---- SIDEBAR TOGGLE ----
var sidebar    = document.getElementById('sidebar');
var backdrop   = document.getElementById('sidebar-backdrop');

function isMobile() { return window.innerWidth < 1024; }

function openMobileSidebar() {
  sidebar.classList.add('open');
  backdrop.classList.add('show');
}
function closeMobileSidebar() {
  sidebar.classList.remove('open');
  backdrop.classList.remove('show');
}
// ---- DESKTOP SIDEBAR: colapso con tira + persistencia ----
function sidebarIcon() {
  var i = document.querySelector('#btn-toggle-sidebar i');
  if (!i) return;
  if (isMobile()) {
    i.className = 'fas fa-bars';
  } else {
    i.className = sidebar.classList.contains('collapsed')
      ? 'fas fa-chevron-right'
      : 'fas fa-chevron-left';
  }
}

function toggleDesktopSidebar() {
  var isCollapsed = sidebar.classList.contains('collapsed');
  sidebar.classList.toggle('collapsed', !isCollapsed);
  localStorage.setItem('gs_sb', isCollapsed ? '1' : '0');
  sidebarIcon();
  setTimeout(function() { if (map) map.invalidateSize(true); }, 300);
}

// Restaurar estado al cargar
(function() {
  if (!isMobile() && localStorage.getItem('gs_sb') === '0') {
    sidebar.classList.add('collapsed');
  }
  sidebarIcon();
})();

document.getElementById('btn-toggle-sidebar').addEventListener('click', function() {
  if (isMobile()) {
    sidebar.classList.contains('open') ? closeMobileSidebar() : openMobileSidebar();
  } else {
    toggleDesktopSidebar();
  }
});

backdrop.addEventListener('click', closeMobileSidebar);

window.addEventListener('resize', function() {
  if (!isMobile()) {
    closeMobileSidebar();
    // Al pasar a desktop, restaurar preferencia guardada
    var pref = localStorage.getItem('gs_sb');
    sidebar.classList.toggle('collapsed', pref === '0');
  } else {
    sidebar.classList.remove('collapsed');
    closeMobileSidebar();
  }
  sidebarIcon();
  if (map) map.invalidateSize(true);
});

// ---- GEOCODER (Nominatim) ----
(function() {
  var input   = document.getElementById('geocoder-input');
  var results = document.getElementById('geocoder-results');
  var debounce;

  async function search(q) {
    if (q.length < 3) { results.classList.remove('show'); return; }
    try {
      var url = 'https://nominatim.openstreetmap.org/search?format=json'
        + '&q=' + encodeURIComponent(q)
        + '&countrycodes=es'
        + '&viewbox=-18.2,43.9,4.6,27.4'
        + '&bounded=1'
        + '&limit=8&addressdetails=1';
      var res  = await fetch(url, { headers: { 'Accept-Language': 'es' } });
      var all  = await res.json();

      var data = all.filter(function(r) {
        var cc   = (r.address || {}).country_code || '';
        var name = (r.display_name || '').toLowerCase();
        return cc === 'es' || name.endsWith('espana') || name.endsWith('spain');
      });

      if (!data.length) {
        results.innerHTML = '<div class="geocoder-item" style="color:#9ca3af;cursor:default;font-size:12px">Sin resultados en Espana</div>';
        results.classList.add('show');
        return;
      }

      results.innerHTML = data.map(function(r) {
        var addr  = r.address || {};
        var place = r.name || addr.city || addr.town || addr.village || r.display_name.split(',')[0];
        var parts = r.display_name.split(',').map(function(p) { return p.trim(); })
          .filter(function(p) { return p && !['espana','spain'].includes(p.toLowerCase()); }).slice(1, 4);
        var sub = parts.join(', ');
        return '<div class="geocoder-item" data-lat="' + r.lat + '" data-lon="' + r.lon + '">'
          + '<strong>' + esc(place) + '</strong>'
          + (sub ? '<span style="font-size:11px;color:#9ca3af;display:block">' + esc(sub) + '</span>' : '')
          + '</div>';
      }).join('');
      results.classList.add('show');
    } catch(e) { console.error('[geocoder]', e); }
  }

  input.addEventListener('input', function() {
    clearTimeout(debounce);
    debounce = setTimeout(function() { search(input.value.trim()); }, 350);
  });

  results.addEventListener('click', function(e) {
    var item = e.target.closest('.geocoder-item');
    if (!item || !item.dataset.lat) return;
    var lat = parseFloat(item.dataset.lat);
    var lon = parseFloat(item.dataset.lon);
    map.setView([lat, lon], 14);
    results.classList.remove('show');
    input.value = '';
    input.blur();
  });

  document.addEventListener('click', function(e) {
    if (!e.target.closest('#geocoder-wrap')) results.classList.remove('show');
  });

  input.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') { results.classList.remove('show'); input.blur(); }
  });
})();

// ---- MODO OSCURO — siempre arranca en claro, sin persistencia ----
(function() {
  var btn = document.getElementById('btn-dark');
  var icon = btn.querySelector('i');
  function updateIcon() {
    var dark = document.body.classList.contains('dark');
    icon.className = dark ? 'fas fa-sun' : 'fas fa-moon';
    btn.title = dark ? 'Modo claro' : 'Modo oscuro';
  }
  updateIcon();
  btn.addEventListener('click', function() {
    document.body.classList.toggle('dark');
    updateIcon();
    // Sincronizar tile del mapa si no esta en satelite
    if (map && mapLayers.light && mapLayers.dark) {
      var onSat = map.hasLayer(mapLayers.satellite);
      if (!onSat) {
        var isDark = document.body.classList.contains('dark');
        if (isDark) { map.removeLayer(mapLayers.light); mapLayers.dark.addTo(map); }
        else        { map.removeLayer(mapLayers.dark);  mapLayers.light.addTo(map); }
      }
    }
  });
})();

// ---- INIT ----
// Limpiar cache antigua (datos sin normalizar) si existe
(function() {
  try {
    var keys = Object.keys(localStorage).filter(function(k) { return k.startsWith('gs_v1_'); });
    keys.forEach(function(k) { localStorage.removeItem(k); });
  } catch(e) {}
})();

// Inicializar mapa al cargar la pagina completamente
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { initMap(); loadProvincias(); });
} else {
  initMap(); loadProvincias();
}

// Re-invalidar tamano al cambiar dimensiones de ventana
window.addEventListener('resize', function() { if (map) map.invalidateSize(true); });

// ---- DELEGACION DE CLICKS EN LA LISTA (evita onclick= inline para CSP estricto) ----
// Gestiona: click/enter en tarjeta (zoom) + click en boton favorito
(function() {
  var list = document.getElementById('station-list');
  if (!list) return;

  function handleCardActivation(target) {
    var favBtn = target.closest('.fav-btn');
    if (favBtn) {
      var id = favBtn.getAttribute('data-fav-id');
      var station = null;
      for (var i = 0; i < filteredStations.length; i++) {
        if (stationId(filteredStations[i]) === id) { station = filteredStations[i]; break; }
      }
      if (!station) return;
      var added = toggleFav(station);
      favBtn.classList.toggle('active', added);
      favBtn.textContent = added ? '\u2605' : '\u2606';
      favBtn.setAttribute('aria-pressed', String(added));
      favBtn.setAttribute('aria-label', added ? 'Quitar de favoritas' : 'A\u00f1adir a favoritas');
      showToast(added ? 'Guardada en favoritas \u2605' : 'Eliminada de favoritas', added ? 'success' : 'info');
      renderFavsPanel();
      return true;
    }
    var card = target.closest('[data-zoom]');
    if (!card) return false;
    var idx = parseInt(card.getAttribute('data-idx'), 10);
    if (!isNaN(idx)) zoomTo(idx);
    return true;
  }

  list.addEventListener('click', function(e) { handleCardActivation(e.target); });
  // A11y: Enter/Space activa la tarjeta desde teclado
  list.addEventListener('keydown', function(e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var card = e.target.closest ? e.target.closest('.station-card') : null;
    if (!card) return;
    e.preventDefault();
    handleCardActivation(card);
  });
})();

// ---- DELEGACION DE ACCIONES EN POPUPS (fav/share/copy) ----
document.addEventListener('click', function(e) {
  var t = e.target;
  if (!t || !t.closest) return;

  // Favorito en popup
  var favBtn = t.closest('[data-pop-fav]');
  if (favBtn) {
    var id = favBtn.getAttribute('data-pop-fav');
    var station = null;
    for (var i = 0; i < filteredStations.length; i++) {
      if (stationId(filteredStations[i]) === id) { station = filteredStations[i]; break; }
    }
    if (!station) return;
    var added = toggleFav(station);
    favBtn.textContent = added ? '\u2605 Favorita' : '\u2606 Guardar';
    favBtn.setAttribute('aria-pressed', String(added));
    showToast(added ? 'Guardada en favoritas \u2605' : 'Eliminada de favoritas', added ? 'success' : 'info');
    // Refrescar lista para actualizar icono tambien alli
    applyFilters();
    return;
  }

  // Compartir
  var shareBtn = t.closest('[data-pop-share]');
  if (shareBtn) {
    var popup = shareBtn.closest('.leaflet-popup-content');
    var title = popup ? (popup.querySelector('[style*="font-weight:800"]') || {}).textContent : '';
    var addr  = popup ? (popup.querySelector('[style*="opacity:0.75"]') || {}).textContent : '';
    var url = window.location.href;
    var textMsg = (title || 'Gasolinera') + ' - ' + (addr || '') + ' - ' + url;
    if (navigator.share) {
      navigator.share({ title: title || 'Gasolinera', text: textMsg, url: url }).catch(function(){});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(textMsg).then(function() {
        showToast('Enlace copiado al portapapeles', 'success');
      });
    } else {
      showToast('Tu navegador no permite compartir', 'warning');
    }
    return;
  }

  // Copiar direccion
  var copyBtn = t.closest('[data-pop-copy]');
  if (copyBtn) {
    var txt = copyBtn.getAttribute('data-pop-copy') || '';
    if (navigator.clipboard) {
      navigator.clipboard.writeText(txt).then(function() {
        showToast('Direccion copiada', 'success');
      }).catch(function() { showToast('No se pudo copiar', 'error'); });
    } else {
      showToast('Tu navegador no permite copiar', 'warning');
    }
    return;
  }
});

// ---- PANEL DE FAVORITOS EN SIDEBAR ----
function renderFavsPanel() {
  var section = document.getElementById('favs-section');
  var list = document.getElementById('fav-list');
  var favs = getFavs();
  document.getElementById('fav-count').textContent = favs.length;
  if (!favs.length) { section.classList.remove('show'); return; }
  section.classList.add('show');
  list.innerHTML = '';
  favs.forEach(function(f) {
    // Busca si la favorita esta en el listado actual (para mostrar precio)
    var live = null;
    for (var i = 0; i < allStations.length; i++) {
      if (stationId(allStations[i]) === f.id) { live = allStations[i]; break; }
    }
    var fuel = document.getElementById('sel-combustible').value;
    var price = live ? parsePrice(live[fuel]) : null;
    var priceHtml = price
      ? '<span class="badge badge-' + priceColor(price) + '">' + fmtPriceUnit(price) + '</span>'
      : '<span style="font-size:10px;color:#9ca3af">Sin datos aqui</span>';
    var item = document.createElement('div');
    item.className = 'station-card';
    item.setAttribute('data-fav-live', live ? '1' : '0');
    item.innerHTML =
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:4px">'
      + '  <div style="min-width:0;flex:1">'
      + '    <div class="card-title">\u2B50 ' + esc(f.rotulo) + '</div>'
      + '    <div class="card-sub">\u{1F4CD} ' + esc(f.municipio) + '</div>'
      + '  </div>'
      + '  <div style="text-align:right">' + priceHtml + '</div>'
      + '</div>';
    if (live) {
      item.style.cursor = 'pointer';
      item.addEventListener('click', function() {
        // Selecciona provincia/municipio y carga
        var id = stationId(live);
        for (var j = 0; j < filteredStations.length; j++) {
          if (stationId(filteredStations[j]) === id) { zoomTo(j); return; }
        }
      });
    }
    list.appendChild(item);
  });
}

// ---- WIDGET DE GASTO MENSUAL ----
function updateMonthlyWidget() {
  var prof = getProfile();
  var widget = document.getElementById('monthly-widget');
  if (!prof || !prof.km || !prof.consumo || !currentMedianPrice) {
    widget.classList.remove('show');
    return;
  }
  var litros = (prof.km / 100) * prof.consumo;
  var cost = litros * currentMedianPrice;
  document.getElementById('mw-cost').textContent = cost.toFixed(0) + ' \u20AC / mes';
  // Calcular ahorro potencial si reposta en el top 3
  var tank = parseInt(localStorage.getItem('gs_tank') || '50', 10);
  var repostajes = Math.ceil(litros / tank);
  var topPrice = null;
  for (var id in topCheapIds) { if (topCheapIds[id] === 1) {
    for (var i = 0; i < filteredStations.length; i++) {
      if (stationId(filteredStations[i]) === id) {
        topPrice = parsePrice(filteredStations[i][document.getElementById('sel-combustible').value]);
        break;
      }
    }
  }}
  var saving = topPrice ? (currentMedianPrice - topPrice) * litros : 0;
  document.getElementById('mw-sub').textContent = saving > 1
    ? 'Ahorro potencial: ' + saving.toFixed(0) + ' \u20AC/mes (' + repostajes + ' repostajes)'
    : repostajes + ' repostajes/mes aprox';
  widget.classList.add('show');
}

// ---- ONBOARDING / PERFIL ----
(function() {
  var modal = document.getElementById('modal-profile');
  var chipsFuel = document.getElementById('chips-fuel');
  var chipsKm   = document.getElementById('chips-km');
  var inCons    = document.getElementById('in-consumo');
  var lblCons   = document.getElementById('lbl-consumo');
  var inTankM   = document.getElementById('in-tank-modal');
  var lblTankM  = document.getElementById('lbl-tank-modal');

  var tmpProfile = { fuel: '', km: 0, consumo: 6.5, tank: 50, strictFuel: true };

  function openModal() {
    var cur = getProfile() || {};
    tmpProfile = {
      fuel: cur.fuel || '',
      km: cur.km || 0,
      consumo: cur.consumo || 6.5,
      tank: cur.tank || 50,
      strictFuel: cur.strictFuel !== false
    };
    Array.prototype.forEach.call(chipsFuel.querySelectorAll('.chip'), function(c) {
      c.classList.toggle('selected', c.getAttribute('data-fuel') === tmpProfile.fuel);
      c.setAttribute('aria-checked', String(c.getAttribute('data-fuel') === tmpProfile.fuel));
    });
    Array.prototype.forEach.call(chipsKm.querySelectorAll('.chip'), function(c) {
      c.classList.toggle('selected', parseInt(c.getAttribute('data-km'),10) === tmpProfile.km);
      c.setAttribute('aria-checked', String(parseInt(c.getAttribute('data-km'),10) === tmpProfile.km));
    });
    inCons.value = tmpProfile.consumo;
    lblCons.textContent = tmpProfile.consumo.toString().replace('.', ',') + ' L';
    inTankM.value = tmpProfile.tank;
    lblTankM.textContent = tmpProfile.tank + ' L';
    modal.classList.add('show');
  }
  function closeModal() { modal.classList.remove('show'); }

  chipsFuel.addEventListener('click', function(e) {
    var c = e.target.closest('.chip'); if (!c) return;
    tmpProfile.fuel = c.getAttribute('data-fuel');
    Array.prototype.forEach.call(chipsFuel.querySelectorAll('.chip'), function(x) {
      var sel = x === c;
      x.classList.toggle('selected', sel);
      x.setAttribute('aria-checked', String(sel));
    });
  });
  chipsKm.addEventListener('click', function(e) {
    var c = e.target.closest('.chip'); if (!c) return;
    tmpProfile.km = parseInt(c.getAttribute('data-km'), 10);
    Array.prototype.forEach.call(chipsKm.querySelectorAll('.chip'), function(x) {
      var sel = x === c;
      x.classList.toggle('selected', sel);
      x.setAttribute('aria-checked', String(sel));
    });
  });
  inCons.addEventListener('input', function() {
    tmpProfile.consumo = parseFloat(inCons.value);
    lblCons.textContent = tmpProfile.consumo.toString().replace('.', ',') + ' L';
  });
  inTankM.addEventListener('input', function() {
    tmpProfile.tank = parseInt(inTankM.value, 10);
    lblTankM.textContent = tmpProfile.tank + ' L';
  });

  document.getElementById('btn-profile-save').addEventListener('click', function() {
    setProfile(tmpProfile);
    try { localStorage.setItem('gs_tank', String(tmpProfile.tank)); } catch(e) {}
    // Sincronizar combustible y slider deposito del sidebar
    if (tmpProfile.fuel) document.getElementById('sel-combustible').value = tmpProfile.fuel;
    var tankInp = document.getElementById('in-tank');
    if (tankInp) { tankInp.value = tmpProfile.tank; document.getElementById('lbl-tank').textContent = tmpProfile.tank + ' L'; }
    document.getElementById('btn-profile-label').textContent = 'Mi perfil \u{1F464}';
    closeModal();
    if (allStations.length) applyFilters();
    showToast('Perfil guardado \u2713', 'success');
  });
  document.getElementById('btn-profile-skip').addEventListener('click', closeModal);
  document.getElementById('btn-profile').addEventListener('click', openModal);

  // Cerrar con Escape o click en backdrop
  modal.addEventListener('click', function(e) { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeModal();
  });

  // Auto-abrir la primera vez
  if (!getProfile() && !localStorage.getItem('gs_onboarded')) {
    setTimeout(function() {
      openModal();
      try { localStorage.setItem('gs_onboarded', '1'); } catch(e) {}
    }, 900);
  } else if (getProfile()) {
    document.getElementById('btn-profile-label').textContent = 'Mi perfil \u{1F464}';
    var p = getProfile();
    if (p.fuel) {
      // Espera a que el select este listo
      setTimeout(function() {
        var sel = document.getElementById('sel-combustible');
        if (sel) sel.value = p.fuel;
      }, 50);
    }
    if (p.tank) {
      try { localStorage.setItem('gs_tank', String(p.tank)); } catch(e) {}
      var tankInp2 = document.getElementById('in-tank');
      if (tankInp2) { tankInp2.value = p.tank; document.getElementById('lbl-tank').textContent = p.tank + ' L'; }
    }
  }
})();

// ---- SLIDER DE DEPOSITO Y RADIO ----
(function() {
  var inTank = document.getElementById('in-tank');
  var lblTank = document.getElementById('lbl-tank');
  var saved = parseInt(localStorage.getItem('gs_tank') || '50', 10);
  inTank.value = saved;
  lblTank.textContent = saved + ' L';
  inTank.addEventListener('input', function() {
    lblTank.textContent = inTank.value + ' L';
    try { localStorage.setItem('gs_tank', inTank.value); } catch(e) {}
    if (allStations.length) renderList(filteredStations);
  });

  var inRad = document.getElementById('in-radius');
  var lblRad = document.getElementById('lbl-radius');
  inRad.addEventListener('input', function() {
    lblRad.textContent = inRad.value + ' km';
    if (userPos && allStations.length) applyFilters();
  });
})();

// ---- TOGGLE €/CENTIMOS ----
(function() {
  var btn = document.getElementById('btn-unit');
  function updateLabel() { btn.textContent = priceUnit === 'c' ? 'c/L' : '\u20AC/L'; }
  updateLabel();
  btn.addEventListener('click', function() {
    priceUnit = priceUnit === 'c' ? 'e' : 'c';
    try { localStorage.setItem('gs_unit', priceUnit); } catch(e) {}
    updateLabel();
    if (allStations.length) applyFilters();
  });
})();

// ---- BANNER OFFLINE ----
(function() {
  var banner = document.getElementById('offline-banner');
  function update() {
    if (navigator.onLine) banner.classList.remove('show');
    else banner.classList.add('show');
  }
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
})();

// ---- ATAJOS DE TECLADO ----
// /  -> foco en buscador
// g  -> geolocalizar
// d  -> dark/light
// f  -> foco en geocoder (buscar lugar)
// Los atajos se ignoran si el usuario esta escribiendo en un input/textarea.
document.addEventListener('keydown', function(e) {
  var tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') {
    if (e.key === 'Escape') e.target.blur();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === '/') {
    e.preventDefault();
    document.getElementById('search-text').focus();
  } else if (e.key === 'g' || e.key === 'G') {
    document.getElementById('btn-geolocate').click();
  } else if (e.key === 'd' || e.key === 'D') {
    document.getElementById('btn-dark').click();
  } else if (e.key === 'f' || e.key === 'F') {
    e.preventDefault();
    document.getElementById('geocoder-input').focus();
  } else if (e.key === '?') {
    showToast('Atajos: / buscar \u00B7 f lugar \u00B7 g ubicacion \u00B7 d tema', 'info');
  }
});

// ---- APP BADGE (PWA): numero de favoritas con precio al minimo de la zona ----
(function() {
  if (!('setAppBadge' in navigator)) return;
  try {
    var fav = getFavs().length;
    if (fav) navigator.setAppBadge(fav).catch(function(){});
  } catch(e) {}
})();

// ---- SERVICE WORKER (PWA) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  });
}

// ---- WATCHDOG DE FRESCURA ----
// Si /api/health devuelve 503, significa que el snapshot del Ministerio
// lleva >24h sin actualizarse (o falta meta). Mostramos un banner amarillo
// no-intrusivo para que el usuario sepa que los precios pueden estar
// desfasados. Tambien lo mostramos si el endpoint da otro error de red
// persistente (offline prolongado) para avisar de la posible discrepancia.
//
// Se ejecuta una vez al cargar + al volver del background (visibilitychange),
// con un throttle de 5 minutos para no martillear la salud en tabs zombis.
(function() {
  var LAST = 0;
  var MIN_INTERVAL_MS = 5 * 60 * 1000;
  function checkHealth() {
    var now = Date.now();
    if (now - LAST < MIN_INTERVAL_MS) return;
    LAST = now;
    try {
      fetch('/api/health', { cache: 'no-store' }).then(function(r) {
        var banner = document.getElementById('stale-banner');
        if (!banner) return;
        // 503 === snapshot stale. 200 === fresco. Cualquier otro estado no
        // es concluyente → no tocamos el banner (evita falsos positivos).
        if (r.status === 503) banner.classList.add('show');
        else if (r.status === 200) banner.classList.remove('show');
      }).catch(function() {
        // Red caida: no mostramos stale (el offline-banner ya cubre ese caso).
      });
    } catch(_) {}
  }
  // Primera comprobacion diferida 3s para no competir con carga inicial.
  setTimeout(checkHealth, 3000);
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) checkHealth();
  });
})();

// ---- TELEMETRIA MINIMA DE ERRORES ----
// Reporta errores JS al endpoint /api/ingest. Sin PII, sin cookies. Rate-limited
// server-side. Localmente el usuario puede desactivar bloqueando esa ruta.
(function() {
  var sent = 0;
  var MAX_PER_SESSION = 5;
  function report(payload) {
    if (sent >= MAX_PER_SESSION) return;
    sent++;
    try {
      // Turnstile: si hay token (widget invisible resuelto), lo adjuntamos
      // en el body como "ts". sendBeacon no permite headers personalizados,
      // por eso va en el payload. Si no hay token (dev / widget aun sin
      // resolver / bloqueado), el servidor hace fail-open si tampoco hay
      // secret configurado.
      try {
        var tok = (window).__TS_TOKEN__;
        if (typeof tok === 'string' && tok) payload.ts = tok;
      } catch(_) {}
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/ingest', blob);
      } else {
        fetch('/api/ingest', { method:'POST', headers:{'Content-Type':'application/json'}, body: body, keepalive: true })
          .catch(function(){});
      }
    } catch(_) {}
  }
  window.addEventListener('error', function(e) {
    report({
      msg: e && e.message ? String(e.message) : 'error',
      src: e && e.filename ? String(e.filename) : undefined,
      line: e && typeof e.lineno === 'number' ? e.lineno : undefined,
      col:  e && typeof e.colno  === 'number' ? e.colno  : undefined,
      stk: (e && e.error && e.error.stack) ? String(e.error.stack) : undefined,
      url: location.pathname,
      ver: APP_VER
    });
  });
  window.addEventListener('unhandledrejection', function(e) {
    var r = e && e.reason;
    report({
      msg: 'unhandledrejection: ' + (r && r.message ? r.message : String(r)),
      stk: (r && r.stack) ? String(r.stack) : undefined,
      url: location.pathname,
      ver: APP_VER
    });
  });
})();

// ---- VERSION visible en consola (ayuda a diagnosticar sin ingenieria inversa) ----
try { console.info('%cGasolineras Espana v' + APP_VER, 'color:#16a34a;font-weight:bold'); } catch(_) {}
</script>`
}
