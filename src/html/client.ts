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

// ---- AHORRO NETO (desvio) ----
// Duplica la logica de netSavings() en pure.ts para uso en cliente sin
// bundler. Tranquilo: hay tests unitarios que verifican la version canonica.
// Devuelve { detourCostEur, netEur, worthIt }. Si no tenemos userPos, el
// cliente no muestra "net", solo el grossSavings historico.
function computeNetSavings(grossSavingsEur, extraKm, consumoL100km, fuelPriceEurL) {
  var gross = (typeof grossSavingsEur === 'number' && isFinite(grossSavingsEur)) ? grossSavingsEur : 0;
  var km    = (typeof extraKm        === 'number' && isFinite(extraKm)        && extraKm        > 0) ? extraKm        : 0;
  var cons  = (typeof consumoL100km  === 'number' && isFinite(consumoL100km)  && consumoL100km  > 0) ? consumoL100km  : 0;
  var price = (typeof fuelPriceEurL  === 'number' && isFinite(fuelPriceEurL)  && fuelPriceEurL  > 0) ? fuelPriceEurL  : 0;
  var detourCostEur = (km / 100) * cons * price;
  var netEur = gross - detourCostEur;
  return { detourCostEur: detourCostEur, netEur: netEur, worthIt: netEur >= 0.5 };
}

// Mapa de codigos cortos ('95', 'diesel', ...) para el endpoint /api/predict.
// Mismo mapeo que src/lib/history.ts FUEL_MAP. No todos los combustibles del
// dropdown tienen historico D1 (H2, GLP, etc.) — para esos no pedimos predict.
var FUEL_CODES_BY_LABEL = {
  'Precio Gasolina 95 E5':  '95',
  'Precio Gasolina 98 E5':  '98',
  'Precio Gasoleo A':       'diesel',
  'Precio Gasoleo Premium': 'diesel_plus'
};

// Fetcher cacheado por session+estacion+combustible. Evita llamar al endpoint
// dos veces si el usuario abre y cierra el popup (o ve la misma estacion en
// card y popup). El cache es un objeto plano — perdura solo en memoria.
var predictCache = {};
function fetchPredict(stationIdStr, fuelLabel, currentEurL) {
  var fuelCode = FUEL_CODES_BY_LABEL[fuelLabel];
  if (!fuelCode) return Promise.resolve(null);
  if (!stationIdStr || !/^\\d{1,10}$/.test(stationIdStr)) return Promise.resolve(null);
  var k = stationIdStr + '|' + fuelCode;
  if (predictCache[k]) return Promise.resolve(predictCache[k]);
  var url = '/api/predict/' + encodeURIComponent(stationIdStr) + '?fuel=' + fuelCode;
  if (currentEurL && currentEurL > 0) url += '&current=' + currentEurL.toFixed(3);
  return fetch(url, { credentials: 'same-origin' }).then(function(r) {
    if (r.status === 503) return null;
    if (!r.ok) return null;
    return r.json();
  }).then(function(data) {
    if (!data || !data.verdict) return null;
    predictCache[k] = data;
    return data;
  }).catch(function() { return null; });
}

// Genera el HTML del badge predictor. Usa clases para que el estilo (verde /
// amarillo / rojo) viva en CSS y podamos cambiar la apariencia sin tocar JS.
function predictBadgeHTML(predict) {
  if (!predict || !predict.verdict) return '';
  var verdict = predict.verdict;  // 'buy_now' | 'neutral' | 'wait'
  var label, cls, emoji;
  if (verdict === 'buy_now') {
    cls = 'predict-badge predict-badge--good';
    emoji = '\u{1F7E2}';
    label = 'Buen momento';
  } else if (verdict === 'wait') {
    cls = 'predict-badge predict-badge--bad';
    emoji = '\u{1F534}';
    label = 'Mejor esperar';
  } else {
    cls = 'predict-badge predict-badge--neutral';
    emoji = '\u{1F7E1}';
    label = 'Precio tipico';
  }
  var conf = predict.confidence === 'high' ? '' : (predict.confidence === 'mid' ? ' \u00B7 muestra media' : ' \u00B7 poca muestra');
  var tip = 'Percentil ' + predict.percentile + ' en ' + predict.sampleCount + ' observaciones (mismo dia de la semana). Tipico: ' + predict.tipicalEurL.toFixed(3) + ' \u20AC/L.';
  return '<span class="' + cls + '" title="' + esc(tip) + '" aria-label="' + esc(label + ' \u2014 ' + tip) + '">' + emoji + ' ' + label + conf + '</span>';
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
  // Guardamos ademas provinciaId y municipioId: son la pieza que nos permite
  // navegar a la favorita aunque actualmente estes viendo otra provincia.
  // Sin estos IDs, un click en una favorita "remota" no podria cambiar la
  // provincia ni el municipio.
  favs.push({
    id: id,
    rotulo: station['Rotulo'] || 'Gasolinera',
    municipio: station['Municipio'] || '',
    municipioId: station['IDMunicipio'] || '',
    provincia: station['Provincia'] || '',
    provinciaId: station['IDProvincia'] || '',
    direccion: station['Direccion'] || '',
    lat: parseFloat((station['Latitud'] || '').replace(',', '.')),
    lng: parseFloat((station['Longitud (WGS84)'] || '').replace(',', '.'))
  });
  setFavs(favs);
  return true;
}

// ---- ALERTAS DE BAJADA DE PRECIO (localStorage + Notification API) ----
// El usuario activa alertas con un click — al hacerlo, pedimos permiso de
// notificaciones del navegador y marcamos el flag gs_alerts_on. Para cada
// favorita guardamos un "baseline" (ultimo precio visto por combustible).
// Cuando cargamos snapshot y encontramos una bajada >= ALERT_THRESHOLD_EUR,
// disparamos una Notification local (y un toast de respaldo). Los baselines
// se actualizan cada vez que vemos precio para que las alertas sean
// progresivas ("cada vez que vuelva a bajar") y no spammeen.
var ALERTS_ON_KEY    = 'gs_alerts_on';
var ALERTS_BASE_KEY  = 'gs_alerts_base_v1';        // { "id|fuel": {p: 1.459, ts: 172...} }
var ALERTS_LAST_KEY  = 'gs_alerts_last_v1';        // dedupe: { "id|fuel": tsUltimaNotif }
var ALERT_THRESHOLD_EUR = 0.02;                    // 2 centimos de bajada
var ALERT_COOLDOWN_MS   = 6 * 60 * 60 * 1000;      // no repetir la misma alerta en <6h

function alertsEnabled() {
  try { return localStorage.getItem(ALERTS_ON_KEY) === '1'; } catch(e) { return false; }
}
function setAlertsEnabled(on) {
  try { localStorage.setItem(ALERTS_ON_KEY, on ? '1' : '0'); } catch(e) {}
}
function getAlertBaselines() {
  try { return JSON.parse(localStorage.getItem(ALERTS_BASE_KEY) || '{}'); } catch(e) { return {}; }
}
function setAlertBaselines(b) {
  try { localStorage.setItem(ALERTS_BASE_KEY, JSON.stringify(b)); } catch(e) {}
}
function getAlertLast() {
  try { return JSON.parse(localStorage.getItem(ALERTS_LAST_KEY) || '{}'); } catch(e) { return {}; }
}
function setAlertLast(l) {
  try { localStorage.setItem(ALERTS_LAST_KEY, JSON.stringify(l)); } catch(e) {}
}

// Dispara una notificacion local (no requiere service worker). Si el navegador
// no da permiso o no soporta Notification, fallback a toast dentro de la app.
function fireDropNotification(title, body) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      var n = new Notification(title, {
        body: body,
        icon: '/static/favicon-32.png',
        badge: '/static/favicon-32.png',
        tag: 'gs-price-drop',
        // A pesar del tag dedupe, respetamos el cooldown por id+fuel.
      });
      // Al clic, enfoca la tab.
      n.onclick = function() {
        try { window.focus(); n.close(); } catch(_) {}
      };
      return true;
    }
  } catch(_) {}
  // Fallback visual in-app
  try { showToast('\u{1F514} ' + title + ' — ' + body, 'success'); } catch(_) {}
  return false;
}

// Se llama despues de cada loadStations. Recorre favoritos, compara precios
// actuales con baselines y notifica bajadas. Luego actualiza baselines.
function checkPriceDropsAndUpdateBaselines(stations, fuel) {
  if (!stations || !stations.length || !fuel) return;
  var favs = getFavs();
  if (!favs.length) return;
  var favIds = {}; favs.forEach(function(f) { favIds[f.id] = f; });
  var baselines = getAlertBaselines();
  var lastNotif = getAlertLast();
  var now = Date.now();
  var enabled = alertsEnabled();

  stations.forEach(function(s) {
    var id = stationId(s);
    if (!favIds[id]) return;
    var p = parsePrice(s[fuel]);
    if (!p) return;
    var k = id + '|' + fuel;
    var base = baselines[k];
    if (!base) {
      // Primera vez: establecer baseline, sin notificar (no hay referencia).
      baselines[k] = { p: p, ts: now };
      return;
    }
    // Si el precio ha bajado por encima del umbral...
    if (enabled && base.p - p >= ALERT_THRESHOLD_EUR) {
      // Dedup por cooldown.
      if (!lastNotif[k] || now - lastNotif[k] > ALERT_COOLDOWN_MS) {
        var drop = (base.p - p);
        var fav = favIds[id];
        var title = 'Precio en bajada: ' + (fav.rotulo || 'gasolinera');
        var body = '-' + (drop * 100).toFixed(1) + 'c (ahora ' + p.toFixed(3) + ' \u20AC) en ' + (fav.municipio || '');
        fireDropNotification(title, body);
        lastNotif[k] = now;
      }
    }
    // Actualizamos baseline al precio actual: asi el proximo test compara
    // contra la observacion mas reciente y notifica "cada vez que vuelva a
    // bajar" en lugar de repetir la misma bajada indefinidamente.
    baselines[k] = { p: p, ts: now };
  });

  setAlertBaselines(baselines);
  setAlertLast(lastNotif);
}

// ---- HISTORICO DE PRECIOS (14 dias, por estacion+combustible) ----
// Estructura: { "idStation|fuel": [ {d:"2026-04-17", p:1.459}, ... ] }
//
// Criterio de grabacion: (favoritos) + (estaciones visitadas recientemente).
// Una estacion se considera "visitada" cuando el usuario abre su popup en el
// mapa o clica su tarjeta en la lista. Asi el historico se construye
// organicamente segun el comportamiento del usuario, sin inflar storage
// grabando miles de estaciones que nunca consultara.
var HISTORY_KEY = 'gs_hist_v1';
var VISITED_KEY = 'gs_visited_v1';
var HISTORY_MAX_DAYS = 14;
var VISITED_MAX = 150;              // tope duro de estaciones rastreadas
var VISITED_TTL_DAYS = 30;          // se olvidan las que no se ven en 30 dias
function getHistory() {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}'); } catch(e) { return {}; }
}
function setHistory(h) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)); } catch(e) {}
}
function getVisited() {
  try { return JSON.parse(localStorage.getItem(VISITED_KEY) || '{}'); } catch(e) { return {}; }
}
function setVisited(v) {
  try { localStorage.setItem(VISITED_KEY, JSON.stringify(v)); } catch(e) {}
}
// Marca una estacion como visitada hoy. Mantenemos solo el ultimo timestamp
// por id, y podamos LRU cuando superamos el tope.
function markVisited(stId) {
  if (!stId) return;
  var v = getVisited();
  v[stId] = Date.now();
  var ids = Object.keys(v);
  if (ids.length > VISITED_MAX) {
    // LRU: ordenar por timestamp y dejar los VISITED_MAX mas recientes.
    ids.sort(function(a,b){ return v[b] - v[a]; });
    var kept = {};
    for (var i = 0; i < VISITED_MAX; i++) kept[ids[i]] = v[ids[i]];
    v = kept;
  }
  setVisited(v);
}
// Devuelve el set de ids "activos" (favoritos + visitados recientes) sobre los
// que grabar historico. Los visitados caducados se ignoran pero no se borran
// automaticamente (se reciclan via LRU cuando haga falta).
function getTrackedIds() {
  var ids = {};
  try { getFavs().forEach(function(f) { if (f.id) ids[f.id] = true; }); } catch(_) {}
  var v = getVisited();
  var cutoff = Date.now() - VISITED_TTL_DAYS * 24 * 60 * 60 * 1000;
  for (var k in v) { if (v[k] >= cutoff) ids[k] = true; }
  return ids;
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
// Graba historial tras cargar snapshot de estaciones. Cubre favoritos y
// visitados recientes (ver getTrackedIds). Se ejecuta en cada loadStations.
function recordHistoryForTracked(stations, fuel) {
  var ids = getTrackedIds();
  stations.forEach(function(s) {
    var id = stationId(s);
    if (!ids[id]) return;
    var p = parsePrice(s[fuel]);
    if (p) pushHistoryPoint(id, fuel, p);
  });
}
// Alias retro-compatible por si algun call-site antiguo persiste; ahora cubre
// favoritos + visitados.
var recordHistoryForFavorites = recordHistoryForTracked;

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

// ---- MODO RUTA: estado del mapa cuando hay una ruta planificada ----
// Al planificar A->B, dibujamos la polilinea real (OSRM) + marcadores de las
// paradas recomendadas, y ocultamos el cluster general. Guardamos el layer
// exacto para poder desmontarlo limpiamente al salir.
var routeLayer = null;         // L.polyline con la ruta real
var routeStopsLayer = null;    // L.layerGroup con los marcadores numerados de las paradas
var routeModeActive = false;   // estado para evitar doble-entrada

// Estado nuevo: posicion del usuario (tras geolocalizar), ahorro.
var userPos = null;                         // { lat, lng } tras geolocate
var userPosMarker = null;                   // circleMarker del usuario en el mapa (para removerlo al salir del modo geo)
var currentMedianPrice = null;              // mediana del listado filtrado actual
var topCheapIds = {};                       // ids de las 3 estaciones mas baratas (para medallas)

// Formatea precio en €/L (unica unidad soportada tras quitar el toggle).
function fmtPriceUnit(price) {
  if (price == null) return 'N/D';
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
  if (!h) return '<span class="popup-muted">Horario no disponible</span>';
  if (is24H(h)) return '<span class="popup-h24">&#x2665; Abierto 24 horas todos los dias</span>';
  var segs = h.split(';').map(function(s){ return s.trim(); }).filter(Boolean);
  return segs.map(function(seg) {
    var parts = seg.match(/^([^:]+):\s*(.+)$/);
    if (!parts) return '<div class="popup-segment">' + esc(seg) + '</div>';
    return '<div class="popup-segment-row">'
      + '<span class="popup-seg-day">' + esc(parts[1].trim()) + '</span>'
      + '<span class="popup-seg-hrs">' + esc(parts[2].trim()) + '</span>'
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

// Dibuja un sparkline SVG alineado por fecha. Acepta:
//   points          : array principal [{d:"YYYY-MM-DD", p:euros}]
//   medianPoints    : array opcional de mediana provincial para pintar linea
//                     de referencia discontinua (misma escala vertical).
// Ambas series comparten eje: calculamos min/max considerando las dos, asi
// la linea de mediana no se sale del SVG si la estacion se dispara. El eje X
// se reparte por indice de fecha — para que dos series con fechas distintas
// (la estacion puede tener huecos) queden alineadas, fabricamos una ventana
// de fechas unica y posicionamos cada punto por su indice en esa ventana.
function buildSparkline(points, medianPoints) {
  if (!points || points.length < 2) return '';
  // Ventana de fechas: union ordenada de las dos series.
  var dateSet = {};
  points.forEach(function(pp) { dateSet[pp.d] = true; });
  if (medianPoints) medianPoints.forEach(function(mp) { dateSet[mp.d] = true; });
  var dates = Object.keys(dateSet).sort();
  if (dates.length < 2) return '';
  var idxByDate = {};
  for (var i = 0; i < dates.length; i++) idxByDate[dates[i]] = i;

  // Escala vertical sobre el conjunto completo (estacion + mediana) para
  // evitar que una serie se salga arriba/abajo.
  var allVals = points.map(function(pp) { return pp.p; });
  if (medianPoints) medianPoints.forEach(function(mp) { allVals.push(mp.p); });
  var min = Math.min.apply(null, allVals);
  var max = Math.max.apply(null, allVals);
  var range = max - min || 0.001;
  var w = 220, h = 60, step = dates.length > 1 ? w / (dates.length - 1) : 0;
  function yOf(p) {
    return (h - ((p - min) / range) * (h - 4) - 2).toFixed(1);
  }
  function pathFor(series) {
    return series.map(function(pt, i) {
      var x = (idxByDate[pt.d] * step).toFixed(1);
      var y = yOf(pt.p);
      return (i === 0 ? 'M' : 'L') + x + ',' + y;
    }).join(' ');
  }
  var path = pathFor(points);
  // Area bajo la curva: cerramos desde el ultimo punto hasta el primero por
  // la base del SVG. Usamos solo los puntos de la estacion (no la mediana).
  var lastX = (idxByDate[points[points.length-1].d] * step).toFixed(1);
  var firstX = (idxByDate[points[0].d] * step).toFixed(1);
  var area = path + ' L' + lastX + ',' + h + ' L' + firstX + ',' + h + ' Z';
  var first = points[0].p, last = points[points.length-1].p;
  var cls = last > first + 0.005 ? 'sp-up' : (last < first - 0.005 ? 'sp-down' : 'sp-flat');
  var svg = '<svg class="sparkline ' + cls + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" aria-hidden="true">'
          + '<path class="sp-area" d="' + area + '"/>'
          + '<path d="' + path + '"/>';
  if (medianPoints && medianPoints.length >= 2) {
    svg += '<path class="sp-median" d="' + pathFor(medianPoints) + '"/>';
  }
  svg += '</svg>';
  return svg;
}

// Panel de historico asincrono. buildPopup() emite el marcador HTML con
// data-atributos; renderHistoryPanel lee esos atributos, hace fetch a
// /api/history/:id (+ /api/history/province/:id en paralelo) y rellena.
// Separado del sparkline para poder reusar el fetch desde toggles de rango.
function buildHistoryPlaceholder(stationId, provinciaId, fuel, fuelLabel, currentPrice) {
  var stAttr = encodeURIComponent(stationId || '');
  var prAttr = encodeURIComponent(provinciaId || '');
  var fAttr  = encodeURIComponent(fuel || '');
  var flAttr = encodeURIComponent(fuelLabel || '');
  var cp     = currentPrice ? currentPrice.toFixed(3) : '';
  return '<div class="popup-trend-top hist-panel"'
       + ' data-hist-station="' + stAttr + '"'
       + ' data-hist-province="' + prAttr + '"'
       + ' data-hist-fuel="' + fAttr + '"'
       + ' data-hist-fuel-label="' + flAttr + '"'
       + ' data-hist-current="' + cp + '"'
       + ' data-hist-days="30">'
       + '<div class="popup-trend-caption">\u{1F4C8} Evolucion (' + esc(fuelLabel || fuel) + ')</div>'
       + '<div class="hist-toggles" role="tablist" aria-label="Rango de historico">'
       + '<button type="button" class="hist-toggle"            data-hist-range="7"   role="tab" aria-selected="false">7d</button>'
       + '<button type="button" class="hist-toggle active"     data-hist-range="30"  role="tab" aria-selected="true">30d</button>'
       + '<button type="button" class="hist-toggle"            data-hist-range="90"  role="tab" aria-selected="false">90d</button>'
       + '<button type="button" class="hist-toggle"            data-hist-range="365" role="tab" aria-selected="false">1a</button>'
       + '</div>'
       + '<div class="hist-body" data-hist-body="1"><div class="hist-loading">\u23F3 Cargando historial\u2026</div></div>'
       + '</div>';
}

// Hace fetch a los endpoints (estacion + mediana provincial) en paralelo y
// pinta el sparkline + stats dentro del contenedor dado. 'days' es el rango.
// Si el servidor devuelve 503 (dev sin D1) o el station no tiene datos, cae
// al historico local de localStorage — seguimos mostrando algo util.
function renderHistoryPanel(container, days) {
  var stationIdV = decodeURIComponent(container.getAttribute('data-hist-station') || '');
  var provinceId = decodeURIComponent(container.getAttribute('data-hist-province') || '');
  var fuel       = decodeURIComponent(container.getAttribute('data-hist-fuel') || '');
  var fuelLabel  = decodeURIComponent(container.getAttribute('data-hist-fuel-label') || '');
  var currentStr = container.getAttribute('data-hist-current') || '';
  var currentP   = currentStr ? parseFloat(currentStr) : null;
  var body       = container.querySelector('[data-hist-body]');
  if (!body) return;
  // Refresca estado visual de los toggles
  var toggles = container.querySelectorAll('.hist-toggle');
  for (var i = 0; i < toggles.length; i++) {
    var range = toggles[i].getAttribute('data-hist-range');
    var active = range === String(days);
    toggles[i].classList.toggle('active', active);
    toggles[i].setAttribute('aria-selected', active ? 'true' : 'false');
  }
  container.setAttribute('data-hist-days', String(days));
  body.innerHTML = '<div class="hist-loading">\u23F3 Cargando historial\u2026</div>';

  // Fetch estacion (obligatorio) + mediana provincial (opcional, no bloquea).
  var stationUrl = '/api/history/' + encodeURIComponent(stationIdV) + '?days=' + days;
  var medianUrl  = provinceId
    ? '/api/history/province/' + encodeURIComponent(provinceId) + '?fuel=' + encodeURIComponent(fuel) + '&days=' + days
    : null;

  var pStation = fetch(stationUrl, { credentials: 'same-origin' }).then(function(r) {
    if (r.status === 503) return { unavailable: true };
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
  var pMedian = medianUrl
    ? fetch(medianUrl, { credentials: 'same-origin' }).then(function(r) {
        if (!r.ok) return null;
        return r.json();
      }).catch(function(){ return null; })
    : Promise.resolve(null);

  Promise.all([pStation, pMedian]).then(function(results) {
    var st = results[0], md = results[1];
    if (st && st.unavailable) {
      renderFallbackLocal(body, stationIdV, fuel, days);
      return;
    }
    var series = (st && st.series && st.series[fuel]) || [];
    // Remap a formato interno {d, p} que usa buildSparkline.
    var points = series.map(function(p) { return { d: p.date, p: p.price }; });
    var medianPoints = null;
    if (md && md.median && md.median.length >= 2) {
      medianPoints = md.median.map(function(p) { return { d: p.date, p: p.price }; });
    }
    if (points.length < 2) {
      // Fallback a localStorage si no hay 2 puntos historicos aun (primer
      // dia tras deploy o estacion sin tracking suficiente).
      renderFallbackLocal(body, stationIdV, fuel, days);
      return;
    }
    renderHistoryBody(body, points, medianPoints, currentP, fuelLabel);
  }).catch(function() {
    // Fallo de red/servidor: caemos al local como ultimo recurso.
    renderFallbackLocal(body, stationIdV, fuel, days);
  });
}

function renderFallbackLocal(body, stationIdV, fuel, days) {
  var local = getHistory()[stationIdV + '|' + fuel] || [];
  if (local.length < 2) {
    body.innerHTML = '<div class="hist-empty">Sin datos suficientes para este rango</div>';
    return;
  }
  // Aplicamos un cutoff por 'days' para que el slider local respete el rango.
  var cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  var cutoffStr = cutoff.toISOString().slice(0, 10);
  var filtered = local.filter(function(pt) { return pt.d >= cutoffStr; });
  if (filtered.length < 2) filtered = local;  // si el rango corta demasiado, dejamos todo el local
  renderHistoryBody(body, filtered, null, null, fuel);
  var note = document.createElement('div');
  note.className = 'trend-label u-mt-2';
  note.textContent = '\u2139 Datos locales (servidor sin historial)';
  body.appendChild(note);
}

// Pinta el cuerpo del panel: sparkline + stats (min/max/media) + badge de
// "precio historicamente bajo". Extraido para poder llamarlo desde fallback
// local y desde la via normal.
function renderHistoryBody(body, points, medianPoints, currentPrice, fuelLabel) {
  var vals = points.map(function(p) { return p.p; });
  var min = Math.min.apply(null, vals);
  var max = Math.max.apply(null, vals);
  var avg = vals.reduce(function(a, b) { return a + b; }, 0) / vals.length;
  var fmt = function(v) { return v.toFixed(3) + ' \u20AC'; };
  // Badge "historicamente bajo": precio actual <= percentil 10 del periodo.
  // Usamos una copia ordenada para no mutar el array original.
  var sorted = vals.slice().sort(function(a, b) { return a - b; });
  var p10 = sorted[Math.max(0, Math.floor(sorted.length * 0.1) - 1)];
  var lowBadge = '';
  if (currentPrice && currentPrice <= p10 + 0.0005 && sorted.length >= 5) {
    // El +0.0005 absorbe redondeos de eurosToCents en el servidor.
    lowBadge = '<div class="hist-lowbadge">\u{1F3C6} Precio historicamente bajo</div>';
  }
  // Tendencia total sobre la ventana mostrada
  var first = vals[0], last = vals[vals.length - 1];
  var delta = last - first;
  var trendClass = delta > 0.005 ? 'trend-up' : (delta < -0.005 ? 'trend-down' : '');
  var trendArrow = delta > 0.005 ? '\u2191' : (delta < -0.005 ? '\u2193' : '\u2192');
  var trendTxt = '<div class="trend-label u-mt-2 ' + trendClass + '">'
               + trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(3) + ' \u20AC en ' + points.length + ' observaciones</div>';

  var legend = medianPoints
    ? '<div class="hist-legend">'
      + '<span><span class="hist-legend-swatch hist-legend-price"></span>Esta estacion</span>'
      + '<span><span class="hist-legend-swatch hist-legend-median"></span>Mediana provincial</span>'
      + '</div>'
    : '';

  body.innerHTML = buildSparkline(points, medianPoints)
    + legend
    + '<div class="hist-stats">'
    + '<div class="hist-stat"><div class="hist-stat-label">Min</div><div class="hist-stat-value">' + fmt(min) + '</div></div>'
    + '<div class="hist-stat"><div class="hist-stat-label">Media</div><div class="hist-stat-value">' + fmt(avg) + '</div></div>'
    + '<div class="hist-stat"><div class="hist-stat-label">Max</div><div class="hist-stat-value">' + fmt(max) + '</div></div>'
    + '</div>'
    + trendTxt
    + lowBadge;
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

  // Distancia (la calculamos antes del ahorro para que el ahorro neto pueda
  // restar el coste del desvio).
  var distHtml = '';
  var extraKmPopup = null;
  if (userPos && hasCoords) {
    var kmPop = distanceKm(userPos.lat, userPos.lng, lat, lng);
    extraKmPopup = kmPop * 2;  // ida + vuelta, conservador
    var minsPop = Math.round(kmPop / 40 * 60); // 40 km/h urbano
    distHtml = '<span class="distance-chip u-ml-6">\u{1F9ED} ' + kmPop.toFixed(1) + ' km &middot; ~' + minsPop + ' min</span>';
  }

  // Ahorro — ahora AHORRO NETO si tenemos userPos + perfil (resta el coste
  // en gasolina del desvio ida-vuelta usando el consumo declarado). Si no
  // hay datos, cae al bruto como antes.
  var savingsHtml = '';
  if (mainPrice && currentMedianPrice && currentMedianPrice > mainPrice) {
    var tankP = parseInt(localStorage.getItem('gs_tank') || '50', 10);
    var grossP = (currentMedianPrice - mainPrice) * tankP;
    var profP = getProfile();
    if (extraKmPopup != null && profP && profP.consumo > 0) {
      var netP = computeNetSavings(grossP, extraKmPopup, profP.consumo, mainPrice);
      if (netP.worthIt) {
        savingsHtml = '<div class="savings-badge u-mt-6">\u{1F4B0} Ahorro neto ' + netP.netEur.toFixed(2) + ' \u20AC / deposito ' + tankP + 'L'
                    + ' <span class="savings-sub">(' + grossP.toFixed(2) + ' \u20AC \u2212 ' + netP.detourCostEur.toFixed(2) + ' desvio)</span></div>';
      } else if (grossP >= 0.5) {
        savingsHtml = '<div class="savings-badge savings-badge--negative u-mt-6">\u26A0 El desvio cuesta ' + netP.detourCostEur.toFixed(2) + ' \u20AC — no compensa (neto ' + netP.netEur.toFixed(2) + ' \u20AC)</div>';
      }
    } else if (grossP >= 0.5) {
      savingsHtml = '<div class="savings-badge u-mt-6">\u{1F4B0} Ahorras ' + grossP.toFixed(2) + ' \u20AC / deposito ' + tankP + 'L</div>';
    }
  }

  // Predictor: placeholder que carga asincrono en popupopen. Solo si hay
  // mainPrice (si la estacion no tiene precio publicado, no hay nada que
  // predecir). Marcamos el contenedor con data-predict-* para que el
  // listener de popupopen dispare fetchPredict. Siempre pinta el combustible
  // como codigo corto (95/98/diesel/diesel_plus) — el cliente filtra los que
  // no estan en FUEL_CODES_BY_LABEL.
  var predictPlaceholder = '';
  if (mainPrice && FUEL_CODES_BY_LABEL[fuel]) {
    predictPlaceholder = '<div class="predict-slot"'
      + ' data-predict-station="' + esc(id) + '"'
      + ' data-predict-fuel="' + esc(fuel) + '"'
      + ' data-predict-current="' + mainPrice.toFixed(3) + '"></div>';
  }

  // Panel de historico asincrono. Renderizamos el placeholder en el HTML del
  // popup; el fetch (y la pintura del sparkline) ocurren en popupopen cuando
  // Leaflet inserta el DOM. Esto evita bloquear la apertura del popup y nos
  // deja variar el rango (7/30/90/1a) sin rebuild completo.
  var provinciaId = s['IDProvincia'] || '';
  var sparkHtml = buildHistoryPlaceholder(id, provinciaId, fuel, fuelLabel, mainPrice);

  // Deep links a apps de navegacion. Los 3 siguen sus URL schemes oficiales:
  //   Google Maps: https://developers.google.com/maps/documentation/urls/get-started
  //   Waze:        https://developers.google.com/waze/deeplinks
  //   Apple Maps:  https://developer.apple.com/library/archive/featuredarticles/
  //                iPhoneURLScheme_Reference/MapLinks/MapLinks.html
  //
  // Comportamiento esperado segun plataforma:
  //   - Desktop            -> nueva pestana con la version web
  //   - Mobile con app     -> Universal Link / Android intent abre la app nativa
  //                           con navegacion ya arrancada (navigate=yes/dirflg=d)
  //   - Mobile sin app     -> cae al web viewer del vendor
  //
  // Notas:
  //   - Waze: www. explicito para evitar 301 extra (waze.com redirige a www.).
  //   - Apple Maps: q= pinta la etiqueta del pin con el nombre de la estacion
  //     en vez de solo las coordenadas.
  //   - Coordenadas redondeadas a 6 decimales (~11cm de precision). Mas que
  //     suficiente para apuntar al surtidor y genera URLs limpias sin artefactos
  //     de coma flotante (ej. 43.2199999998).
  //   - target="_blank" + rel="noopener" impide que la pestana destino acceda
  //     a window.opener (reverse-tabnabbing).
  var latS = lat.toFixed(6);
  var lngS = lng.toFixed(6);
  // Label para Apple Maps: nombre de la estacion o fallback generico.
  // encodeURIComponent garantiza que comas, espacios y tildes no rompan la URL.
  var aplLabel = encodeURIComponent(s['Rotulo'] || 'Gasolinera');
  var navBtns = hasCoords ? (
    '<div class="popup-nav-row">'
    + '<a class="popup-nav-btn popup-nav-google" href="https://www.google.com/maps/dir/?api=1&destination=' + latS + ',' + lngS + '&travelmode=driving" target="_blank" rel="noopener">Google Maps</a>'
    + '<a class="popup-nav-btn popup-nav-waze" href="https://www.waze.com/ul?ll=' + latS + ',' + lngS + '&navigate=yes" target="_blank" rel="noopener">Waze</a>'
    + '<a class="popup-nav-btn popup-nav-apple" href="https://maps.apple.com/?daddr=' + latS + ',' + lngS + '&q=' + aplLabel + '&dirflg=d" target="_blank" rel="noopener">Apple Maps</a>'
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

  // priceColor() ya devuelve uno de {green,yellow,red,gray}; lo usamos como
  // sufijo de clase (.popup-price-main--green, .popup-header--green, etc.).
  // Asi evitamos style inline con color calculado en tiempo real sin tener
  // que mantener una tabla de casos especiales en JS.
  var priceDisplay = mainPrice
    ? '<strong class="popup-price-main popup-price-main--' + mainColor + '">' + mainPrice.toFixed(3) + ' <span class="popup-price-main-unit">\u20AC/L</span></strong>'
    : '<span class="popup-price-none">Sin precio</span>';

  return '<div class="popup-root">'
    // Cabecera — la gradiente del fondo se pinta por clase .popup-header--<color>
    + '<div class="popup-header popup-header--' + mainColor + '">'
    + '  <div class="popup-header-title">\u26FD ' + esc(s['Rotulo'] || 'Gasolinera') + '</div>'
    + '  <div class="popup-header-sub">\u{1F4CD} ' + esc(s['Direccion'] || '') + ', ' + esc(s['Municipio'] || '') + distHtml + '</div>'
    + (statusHtml ? '  <div class="popup-header-status">' + statusHtml + '</div>' : '')
    + '</div>'
    // Precio
    + '<div class="popup-price-row">'
    + '  <span class="popup-fuel-label">' + esc(fuelLabel) + '</span>'
    + '  ' + priceDisplay
    + '</div>'
    + predictPlaceholder
    + savingsHtml
    // Horario (uso --mb4 porque la caption del horario lleva mb:4 a diferencia
    // de la de Evolucion, que es mb:2 por defecto)
    + '<div class="popup-trend-top">'
    + '  <div class="popup-trend-caption popup-trend-caption--mb4">\u{1F550} Horario</div>'
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
      var count    = cluster.getChildCount();
      var sz       = count > 200 ? 52 : count > 50 ? 44 : 36;
      var szCls    = 'cluster-icon--s' + sz;           // s36/s44/s52
      var fsCls    = count > 99 ? 'cluster-icon-count--fs9' : 'cluster-icon-count--fs11';
      // La divIcon de Leaflet inserta el HTML sin hook post-render, asi que
      // no podemos setear estilos via CSSOM post-insertion; expresamos todos
      // los valores dinamicos (tamano, color, tamano de fuente) con clases
      // modificadoras — ambos sets son discretos, cuesta 9 clases en el CSS.
      return L.divIcon({
        html: [
          '<div class="cluster-icon ' + szCls + ' cluster-icon--' + cColor + '">',
          '  <span class="cluster-icon-count ' + fsCls + '">' + count + '</span>',
          cMin ? '<span class="cluster-icon-price">' + cMin.toFixed(2) + '\u20AC</span>' : '',
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
    var stId = stationId(s);
    marker.on('click', function() { highlightCard(idx); });
    // Marcamos la estacion como visitada y disparamos la carga asincrona del
    // historial. El placeholder ya esta en el DOM (buildPopup), asi que aqui
    // solo necesitamos localizarlo y llamar a renderHistoryPanel.
    marker.on('popupopen', function(e) {
      markVisited(stId);
      // Seguimos alimentando el cache local — sirve de fallback si el
      // endpoint /api/history responde 503 (dev sin D1) o el backfill aun
      // no llego a esta estacion.
      var p = parsePrice(s[fuel]);
      if (p) pushHistoryPoint(stId, fuel, p);
      // El DOM del popup ya existe en e.popup._contentNode.
      try {
        var node = e.popup && e.popup._contentNode;
        if (!node) return;
        var panel = node.querySelector('[data-hist-station]');
        if (panel) renderHistoryPanel(panel, 30);
        // Predictor: fetch asincrono del veredicto y reemplazo del placeholder
        // sin bloquear la apertura del popup. Si el endpoint 503 o no hay
        // datos suficientes, el placeholder se queda vacio (no rompemos nada).
        var predSlot = node.querySelector('[data-predict-station]');
        if (predSlot) {
          var predSt = predSlot.getAttribute('data-predict-station');
          var predFuel = predSlot.getAttribute('data-predict-fuel');
          var predCur = parseFloat(predSlot.getAttribute('data-predict-current') || '');
          fetchPredict(predSt, predFuel, isFinite(predCur) ? predCur : null).then(function(pred) {
            if (!pred) { predSlot.innerHTML = ''; return; }
            predSlot.innerHTML = predictBadgeHTML(pred);
          });
        }
      } catch (_) {}
    });
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
  // Distancia (calculada ANTES del ahorro para que el ahorro neto reste el
  // coste del desvio ida-vuelta).
  var distHtml = '';
  var extraKmCard = null;
  if (userPos) {
    var posC = stationLatLng(s);
    if (posC) {
      var kmC = distanceKm(userPos.lat, userPos.lng, posC.lat, posC.lng);
      extraKmCard = kmC * 2;
      if (kmC < 1) distHtml = '<span class="distance-chip" aria-label="Distancia">' + Math.round(kmC*1000) + ' m</span>';
      else distHtml = '<span class="distance-chip" aria-label="Distancia">' + kmC.toFixed(1) + ' km</span>';
    }
  }

  var savingsHtml = '';
  if (price && currentMedianPrice && currentMedianPrice > price) {
    var tankC = parseInt(localStorage.getItem('gs_tank') || '50', 10);
    var grossC = (currentMedianPrice - price) * tankC;
    var profC = getProfile();
    if (extraKmCard != null && profC && profC.consumo > 0) {
      var netC = computeNetSavings(grossC, extraKmCard, profC.consumo, price);
      if (netC.worthIt) {
        savingsHtml = '<span class="savings-badge" title="Ahorro - coste desvio">\u{1F4B0} neto ' + netC.netEur.toFixed(2) + ' \u20AC / dep.</span>';
      } else if (grossC >= 0.5) {
        savingsHtml = '<span class="savings-badge savings-badge--negative" title="El desvio cuesta mas que el ahorro">\u26A0 desvio no compensa</span>';
      }
    } else if (grossC >= 0.5) {
      savingsHtml = '<span class="savings-badge" title="Ahorro frente a la mediana del listado">\u{1F4B0} ahorra ' + grossC.toFixed(2) + ' \u20AC / dep.</span>';
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
    : '<span class="row-row-noprice">N/D</span>';

  return '<div class="station-card" data-idx="' + i + '" data-zoom="1" role="listitem" tabindex="0" aria-label="' + esc((s['Rotulo']||'Gasolinera')+' en '+(s['Municipio']||'')+(price?', '+priceText:'')) + '">'
    + '<button class="fav-btn' + (fav ? ' active' : '') + '" data-fav-id="' + esc(id) + '" aria-label="' + (fav ? 'Quitar de favoritas' : 'A\u00f1adir a favoritas') + '" aria-pressed="' + fav + '">'
    + (fav ? '\u2605' : '\u2606') + '</button>'
    + '<div class="row-info-flex">'
    + '<div class="row-info-left">'
    + '<div class="card-title">' + medal + '\u26FD ' + esc(s['Rotulo'] || 'Gasolinera') + distHtml + '</div>'
    + '<div class="card-sub">\u{1F4CD} ' + esc(s['Direccion'] || '') + ', ' + esc(s['Municipio'] || '') + '</div>'
    + '<div class="card-time">\u{1F550} ' + horarioCard(s['Horario']) + statusHtml + '</div>'
    + (savingsHtml ? '<div class="u-mt-3">' + savingsHtml + '</div>' : '')
    + '</div>'
    + '<div class="row-info-right">'
    + priceEl
    + '<div class="row-fuel-label">' + esc(fuelLabel.slice(0,18)) + '</div>'
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
  list.innerHTML = '<div id="list-sentinel" class="list-sentinel">Cargando mas...</div>';
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
// Conjunto de marcas conocidas: para el filtro "low-cost" (cualquier rotulo
// que NO este en esta lista se considera generico/low-cost). Lista espejo de
// lo que aparece en el dropdown de marcas en shell.ts.
var KNOWN_BRANDS = {
  REPSOL:1, CEPSA:1, MOEVE:1, GALP:1, BALLENOIL:1, PLENERGY:1, SHELL:1,
  PETROPRIX:1, PETRONOR:1, CARREFOUR:1, BP:1, AVIA:1, Q8:1, CAMPSA:1,
  ESCLATOIL:1, ALCAMPO:1, EROSKI:1, BONAREA:1, MEROIL:1, VALCARCE:1,
  ENI:1, GASEXPRESS:1, BEROIL:1, HAM:1, AGLA:1
};

function applyFilters() {
  var fuel  = document.getElementById('sel-combustible').value;
  var text  = document.getElementById('search-text').value.trim().toLowerCase();
  var orden = document.getElementById('sel-orden').value;
  var radius = parseInt(document.getElementById('in-radius').value, 10);

  // Filtros avanzados (operan sobre resultados ya cargados, aplican en vivo)
  var fltAbierto = document.getElementById('flt-abierto');
  var flt24h     = document.getElementById('flt-24h');
  var selMarca   = document.getElementById('sel-marca');
  var onlyOpen  = fltAbierto ? fltAbierto.checked : false;
  var only24h   = flt24h ? flt24h.checked : false;
  var brand     = selMarca ? selMarca.value : '';

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

  // Filtros avanzados — se aplican entre radio y texto para minimizar el set
  // antes del filtro mas caro (text, que hace normalize NFD por estacion).
  if (only24h) {
    stations = stations.filter(function(s) { return is24H(s['Horario']); });
  } else if (onlyOpen) {
    // 24h ⊂ abierto-ahora, por eso el else (evita double-filter cuando ambos on).
    stations = stations.filter(function(s) {
      var st = isOpenNow(s['Horario']);
      return st && st.open;
    });
  }
  if (brand) {
    stations = stations.filter(function(s) {
      var r = (s['Rotulo'] || '').toUpperCase().trim();
      if (brand === '__LOWCOST__') {
        // Low-cost: cualquier cosa que no matchee una marca conocida. Incluye
        // rotulos vacios, regionales desconocidos y cadenas independientes.
        // Hacemos indexOf en vez de match exacto por variantes "REPSOL EESS S.A."
        for (var key in KNOWN_BRANDS) { if (r.indexOf(key) >= 0) return false; }
        return true;
      }
      return r.indexOf(brand) >= 0;
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

  // Guardar historico de precios (favoritos + visitados recientes).
  recordHistoryForTracked(stations, fuel);
  // Alertas: comparamos el precio vs baseline y notificamos bajadas de
  // favoritos. checkPriceDropsAndUpdateBaselines aisla el estado en
  // localStorage y respeta el cooldown/consentimiento.
  try { checkPriceDropsAndUpdateBaselines(stations, fuel); } catch(_) {}
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
    // Limpia cualquier marker previo antes de agregar el nuevo (re-click en geolocate).
    if (userPosMarker) { try { map.removeLayer(userPosMarker); } catch(_) {} userPosMarker = null; }
    userPosMarker = L.circleMarker([lat, lng], {
      radius: 11, color: '#2563eb', fillColor: '#3b82f6', fillOpacity: 0.55, weight: 2
    }).addTo(map).bindPopup('<b>&#x1F4CD; Tu ubicacion</b>').openPopup();

    // 2. Geocodificacion inversa via nuestro proxy /api/geocode/reverse.
    //    Ventaja: la IP del usuario no llega a OpenStreetMap (privacy) y el
    //    servidor cachea + rate-limitea. Si el proxy falla, 'addr' queda {}.
    var revRes = await fetch(
      '/api/geocode/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng)
    );
    var addr = (revRes.ok ? (await revRes.json()).address : null) || {};

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
          // No logueamos el match porque contiene datos de ubicacion; ver /privacidad.
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
        // No logueamos el municipio: lo mismo, rastro de ubicacion del usuario.
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

// Sale del "modo geolocalizacion": limpia userPos, oculta el slider de radio,
// quita el marker del mapa y resetea orden si estaba en 'cerca'/'dist'.
// Se invoca cuando el usuario cambia manualmente provincia o municipio DESPUES
// de haber pulsado "Mi ubicacion": la señal clara de que ya no quiere ver
// resultados relativos a su posicion GPS anterior.
// NOTA: asignaciones programaticas a selProv.value/selMun.value (las que hace
// el propio btn-geolocate) NO disparan el evento 'change', asi que este helper
// solo se ejecuta en interacciones reales del usuario.
function clearGeolocationMode() {
  if (!userPos) return; // ya estaba limpio: no-op
  userPos = null;
  if (userPosMarker) { try { map.removeLayer(userPosMarker); } catch(_) {} userPosMarker = null; }
  var rg = document.getElementById('radius-group');
  if (rg) rg.style.display = 'none';
  var selOrden = document.getElementById('sel-orden');
  if (selOrden && (selOrden.value === 'cerca' || selOrden.value === 'dist')) {
    selOrden.value = 'precio';
  }
}

// ---- EVENTOS ----
// Filosofia UX: los cambios en los filtros NO disparan carga ni render. El
// usuario decide cuando mirar resultados pulsando "Buscar" (o "Mi ubicacion").
// Asi evitamos que un usuario indeciso vea la lista bailar mientras ajusta 4
// controles — y ahorramos llamadas innecesarias al Ministerio.
document.getElementById('sel-provincia').addEventListener('change', async function(e) {
  // Cambio manual de provincia = el usuario quiere mirar otra region, asi que
  // salimos del modo geolocalizacion (si estabamos dentro). Sin esto,
  // loadStations() descartaba el municipio y ordenaba por distancia a la GPS
  // vieja — bug reportado.
  clearGeolocationMode();
  // Unica excepcion: al cambiar provincia hay que refrescar el dropdown de
  // municipios (es un selector dependiente). No carga estaciones.
  await loadMunicipios(e.target.value);
});
document.getElementById('sel-municipio').addEventListener('change', function() {
  // Mismo razonamiento: si el usuario elige un municipio concreto, quiere ese
  // municipio — no la provincia entera filtrada por distancia GPS.
  clearGeolocationMode();
  // No-op adicional: el render llega con "Buscar".
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

// Filtros avanzados: tambien se aplican en vivo (operan sobre el pool ya
// cargado, no disparan fetch). Actualizar tambien el contador-chip para que el
// usuario vea "Filtros avanzados (2)" cuando tenga varios activos.
function updateAdvCountBadge() {
  var cnt = 0;
  if (document.getElementById('flt-abierto').checked) cnt++;
  if (document.getElementById('flt-24h').checked) cnt++;
  if (document.getElementById('sel-marca').value) cnt++;
  var badge = document.getElementById('adv-filters-count');
  if (cnt > 0) { badge.textContent = String(cnt); badge.classList.add('show'); }
  else { badge.textContent = ''; badge.classList.remove('show'); }
}
function advFilterChanged() {
  updateAdvCountBadge();
  if (allStations.length) applyFilters();
}
document.getElementById('flt-abierto').addEventListener('change', advFilterChanged);
document.getElementById('flt-24h').addEventListener('change', advFilterChanged);
document.getElementById('sel-marca').addEventListener('change', advFilterChanged);

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
      var color = price ? priceColor(price) : 'gray';
      var nameSafe = esc(s['Rotulo'] || 'Gasolinera');
      // Highlight sobre el texto ya escapado: $1 es siempre texto seguro
      var hl    = nameSafe.replace(new RegExp('(' + q.replace(/[.*+?^{}$()|[\]\\]/g,'\\$&') + ')', 'gi'), '<mark class="suggest-highlight">$1</mark>');
      return '<div class="suggest-item" data-idx="' + i + '">'
        + '<div class="suggest-row">'
        + '  <div class="suggest-name">&#x26FD; ' + hl + '</div>'
        + '  <div class="suggest-sub">&#x1F4CD; ' + esc(s['Municipio']) + '</div>'
        + '</div>'
        + (price ? '<span class="suggest-price suggest-price--' + color + '">' + price.toFixed(3) + ' &#x20AC;</span>' : '')
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

// Geocoder del header retirado por decision de producto (usuarios lo usaban
// poco frente al filtro por provincia + geolocalizacion). El modal de ruta
// sigue usando /api/geocode/search internamente para origen/destino.

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

// ---- URL SYNC + SEO SEED ----
// Dos funcionalidades relacionadas:
//   1) Al cargar, leemos query params (?prov=28&mun=XXX&fuel=...&order=asc
//      &text=...&open=1&h24=1&brand=REPSOL&radius=5) para rehidratar el estado
//      de los controles → habilita enlaces compartibles (?a un compa?ero).
//   2) Tras una busqueda, reescribimos la URL con history.replaceState para
//      que el "Compartir" funcione y refrescar la pagina no pierda contexto.
// La seed via window.__SEO__ (rutas /gasolineras/<slug>) solo rellena la
// provincia; los query params tienen prioridad sobre ella.
var __urlSyncActive = false;   // evita que la rehidratacion dispare loadStations
function readQueryState() {
  var p = new URLSearchParams(location.search);
  // Fallback: si la ruta es /gasolineras/<slug> y no hay ?prov, usamos __SEO__.
  var seo = null;
  try { seo = (window).__SEO__ || null; } catch(_) {}
  return {
    prov:   p.get('prov')   || (seo && seo.provinciaId) || '',
    mun:    p.get('mun')    || '',
    fuel:   p.get('fuel')   || '',
    order:  p.get('order')  || '',
    text:   p.get('text')   || '',
    brand:  p.get('brand')  || '',
    open:   p.get('open')   === '1',
    h24:    p.get('h24')    === '1',
    radius: p.get('radius') || ''
  };
}
function writeQueryState() {
  try {
    var p = new URLSearchParams();
    var prov  = document.getElementById('sel-provincia').value;
    var mun   = document.getElementById('sel-municipio').value;
    var fuel  = document.getElementById('sel-combustible').value;
    var order = document.getElementById('sel-orden').value;
    var text  = (document.getElementById('search-text').value || '').trim();
    var radius= document.getElementById('in-radius').value;
    var brand = (document.getElementById('sel-marca') || {}).value || '';
    var open  = (document.getElementById('flt-abierto') || {}).checked;
    var h24   = (document.getElementById('flt-24h')     || {}).checked;
    if (prov)  p.set('prov',  prov);
    if (mun)   p.set('mun',   mun);
    // fuel por defecto es "Precio Gasolina 95 E5"; no lo escribimos para URLs limpias
    if (fuel && fuel !== 'Precio Gasolina 95 E5') p.set('fuel', fuel);
    if (order && order !== 'asc') p.set('order', order);
    if (text)  p.set('text',  text);
    if (brand) p.set('brand', brand);
    if (open)  p.set('open',  '1');
    if (h24)   p.set('h24',   '1');
    // Radio solo se guarda en modos cerca/dist
    if (radius && (order === 'cerca' || order === 'dist')) p.set('radius', radius);
    var qs = p.toString();
    var base = location.pathname;
    // En rutas /gasolineras/<slug>, mantener la ruta pero anadir querys para
    // filtros adicionales. La ruta ya codifica la provincia (no la duplicamos).
    var seo = null; try { seo = (window).__SEO__ || null; } catch(_) {}
    if (seo && seo.provinciaId && prov === seo.provinciaId) {
      p.delete('prov');
      qs = p.toString();
    }
    history.replaceState(null, '', base + (qs ? '?' + qs : ''));
  } catch(_) {}
}

async function applyQueryState(state) {
  // Orden: provincia (dispara loadMunicipios asincrono) → municipio → resto.
  var selProv = document.getElementById('sel-provincia');
  var selMun  = document.getElementById('sel-municipio');
  var selFuel = document.getElementById('sel-combustible');
  var selOrd  = document.getElementById('sel-orden');
  var txt     = document.getElementById('search-text');
  var selMk   = document.getElementById('sel-marca');
  var fOpen   = document.getElementById('flt-abierto');
  var f24     = document.getElementById('flt-24h');
  var rg      = document.getElementById('radius-group');
  var inR     = document.getElementById('in-radius');
  var lblR    = document.getElementById('lbl-radius');

  if (state.prov && selProv) {
    selProv.value = state.prov;
    // Aguardamos a que el dropdown de municipios se rellene antes de
    // autoselecccionar uno (si procede).
    try { await loadMunicipios(state.prov); } catch(_) {}
  }
  if (state.mun && selMun) {
    // Solo intentamos seleccionar si la opcion existe (municipio del slug).
    var match = false;
    for (var i = 0; i < selMun.options.length; i++) {
      if (selMun.options[i].value === state.mun) { match = true; break; }
    }
    if (match) selMun.value = state.mun;
  }
  if (state.fuel && selFuel)  selFuel.value = state.fuel;
  if (state.order && selOrd)  selOrd.value  = state.order;
  if (state.text && txt)      txt.value     = state.text;
  if (state.brand && selMk)   selMk.value   = state.brand;
  if (fOpen) fOpen.checked = !!state.open;
  if (f24)   f24.checked   = !!state.h24;
  if (state.radius && inR) {
    inR.value = state.radius;
    if (lblR) lblR.textContent = state.radius + ' km';
  }
  // Mostrar radius si order es cerca/dist y tenemos userPos (aunque userPos
  // llega despues; el handler de sel-orden ya lo vuelve a evaluar).
  if ((state.order === 'cerca' || state.order === 'dist') && rg && userPos) {
    rg.style.display = 'block';
  }
  // Refrescamos el contador de filtros avanzados si existe.
  try { if (typeof updateAdvCountBadge === 'function') updateAdvCountBadge(); } catch(_) {}
}

// Inicializar mapa + provincias + (opcional) aplicar query state y buscar.
async function bootApp() {
  initMap();
  loadProvincias();
  var st = readQueryState();
  __urlSyncActive = true;
  if (st.prov) {
    // Rehidratacion completa: aplicamos estado y disparamos busqueda
    // automaticamente para que la URL compartida funcione "en un click".
    await applyQueryState(st);
    try { await loadStations(); } catch(_) {}
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { bootApp(); });
} else {
  bootApp();
}

// Tras cada busqueda, escribimos la URL. Hookeamos en el boton Buscar.
(function() {
  var btn = document.getElementById('btn-buscar');
  if (btn) btn.addEventListener('click', function() {
    // writeQueryState se ejecuta en el siguiente microtask para no interferir
    // con el click handler original (loadStations).
    setTimeout(writeQueryState, 0);
  });
  // Filtros avanzados: al cambiar, reescribimos tambien.
  ['flt-abierto','flt-24h','sel-marca'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function() { setTimeout(writeQueryState, 0); });
  });
})();

// ---- BOTON SHARE ----
// Usa Web Share API si esta disponible (movil) y cae a copiar-al-clipboard
// en escritorio. Primero nos aseguramos de que la URL refleja el estado actual.
(function() {
  var btn = document.getElementById('btn-share');
  if (!btn) return;
  btn.addEventListener('click', function() {
    writeQueryState();
    var url = location.href;
    var title = document.title;
    var text  = 'Precios de gasolineras actualizados';
    if (navigator.share) {
      navigator.share({ title: title, text: text, url: url }).catch(function(){});
      return;
    }
    // Fallback: copy to clipboard
    try {
      navigator.clipboard.writeText(url).then(function() {
        showToast('Enlace copiado al portapapeles', 'success');
      }).catch(function() {
        // Fallback del fallback: mostramos la URL en un prompt
        try { window.prompt('Copia este enlace:', url); } catch(_) {}
      });
    } catch(_) {
      try { window.prompt('Copia este enlace:', url); } catch(_) {}
    }
  });
})();

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
    if (!isNaN(idx)) {
      // Clic en tarjeta cuenta como "visita" a efectos de historico.
      try {
        var st = filteredStations[idx];
        if (st) markVisited(stationId(st));
      } catch(_) {}
      zoomTo(idx);
    }
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

  // Toggle de rango del historial (7/30/90/1a). Delegado por el mismo
  // listener global — cada toggle lleva data-hist-range y el panel
  // contenedor tiene data-hist-station. Re-fetch ocurre en renderHistoryPanel.
  var rangeBtn = t.closest('[data-hist-range]');
  if (rangeBtn) {
    var panel = rangeBtn.closest('[data-hist-station]');
    if (panel) {
      var range = parseInt(rangeBtn.getAttribute('data-hist-range') || '30', 10);
      if (Number.isFinite(range) && range >= 1 && range <= 365) {
        renderHistoryPanel(panel, range);
      }
    }
    return;
  }
});

// ---- FAVORITOS: BOTON DE HEADER + MODAL ----
// La estrella del header es el unico acceso a favoritas. Abre un modal que
// contiene la lista de gasolineras guardadas. Click en una favorita ->
// cierra modal y navega en el mapa (setea provincia, carga municipios,
// setea municipio, pone el rotulo en la caja de busqueda y hace zoom).
// El modal se re-renderiza en cada apertura y tambien cuando cambia la
// lista (toggleFav). Para compatibilidad con el resto del codigo mantenemos
// el nombre renderFavsPanel() como alias de renderFavs() — asi no hay que
// tocar las llamadas ya existentes (markVisited, toggle de card, etc).

// Busca una estacion por id en allStations (provincia actual) y, si no esta,
// en cualquier cache gs_v2_* de localStorage. Devuelve { station, ts, stale }
// o null. Permite stale hasta 30 dias (CACHE_HARD_TTL en getCache) porque
// para el listado de favoritas "precio viejo con marca visual" es mas util
// que "sin datos". El precio del Ministerio cambia como mucho varias veces
// al dia, asi que un dato de hace 2h suele ser muy representativo.
function lookupStationInCaches(favId) {
  if (!favId) return null;
  // 1) Hot path: provincia que el usuario esta viendo ahora mismo.
  for (var i = 0; i < allStations.length; i++) {
    if (stationId(allStations[i]) === favId) {
      return { station: allStations[i], ts: Date.now(), stale: false };
    }
  }
  // 2) Otras provincias cacheadas en localStorage. Iteramos claves gs_v2_*.
  try {
    for (var k = 0; k < localStorage.length; k++) {
      var key = localStorage.key(k);
      if (!key || key.indexOf('gs_v2_') !== 0) continue;
      var raw = localStorage.getItem(key);
      if (!raw) continue;
      var parsed;
      try { parsed = JSON.parse(raw); } catch(_) { continue; }
      var data = parsed && parsed.data;
      var ts = parsed && parsed.ts;
      if (!Array.isArray(data) || !ts) continue;
      // Si es mayor que CACHE_HARD_TTL, getCache ya lo habria purgado en su
      // proxima llamada; aqui lo ignoramos tambien.
      if (Date.now() - ts > CACHE_HARD_TTL) continue;
      for (var j = 0; j < data.length; j++) {
        if (stationId(data[j]) === favId) {
          return { station: data[j], ts: ts, stale: Date.now() - ts > CACHE_FRESH_TTL };
        }
      }
    }
  } catch(_) {}
  return null;
}

// Set de provinciaIds que ya estamos pre-fetching ahora mismo (para no
// duplicar trabajo si el modal se re-renderiza mientras el fetch esta en
// vuelo). Tambien acumula las que fallaron para no reintentar en bucle.
var favsFetchInFlight = {};
var favsFetchFailed = {};

// Para cada favorita con provinciaId pero sin datos frescos en ningun cache,
// dispara un fetch a /api/estaciones/provincia/{id} en background. Cuando
// responde, guarda en cache y re-renderiza el modal (si sigue abierto). No
// bloquea el render inicial — el usuario ve "Sin datos" unos ms y luego
// aparece el precio. Deduplica por provinciaId para no hacer N fetches si
// tienes varias favs en la misma provincia.
function prefetchFavsPrices(favs) {
  var seen = {};
  for (var i = 0; i < favs.length; i++) {
    var f = favs[i];
    if (!f.provinciaId) continue;
    // Si ya tenemos cache fresco para esa provincia, saltamos.
    var cache = getCache(cacheKey(f.provinciaId, ''));
    if (cache && !cache.stale) continue;
    // Si ya esta en vuelo o fallo recientemente, saltamos.
    if (favsFetchInFlight[f.provinciaId]) continue;
    if (favsFetchFailed[f.provinciaId]) continue;
    seen[f.provinciaId] = true;
  }
  var provIds = Object.keys(seen);
  if (!provIds.length) return;
  // Disparamos en paralelo. Cap implicito = numero de provincias con favs,
  // raramente > 3. fetchJSON ya usa el service worker / red normal.
  provIds.forEach(function(pid) {
    favsFetchInFlight[pid] = true;
    fetchJSON('/api/estaciones/provincia/' + pid).then(function(data) {
      var stations = (data.ListaEESSPrecio || []).map(normalizeStation);
      setCache(cacheKey(pid, ''), stations, data.Fecha || '');
      // Re-render si el modal sigue abierto.
      var modal = document.getElementById('modal-favs');
      if (modal && modal.classList.contains('show')) renderFavsModalList();
    }).catch(function() {
      // Marcamos como fallida para no machacar el servidor. Se limpia en el
      // siguiente refresh de pagina (variable en memoria, no persiste).
      favsFetchFailed[pid] = true;
    }).then(function() {
      delete favsFetchInFlight[pid];
    });
  });
}

// Actualiza el boton estrella del header: color segun tiene/no favoritas,
// insignia numerica solo si hay >=1. Y, si el modal esta abierto, refresca.
function renderFavs() {
  var favs = getFavs();
  var btn = document.getElementById('btn-favs');
  var badge = document.getElementById('fav-badge');
  var icon = document.getElementById('btn-favs-icon');
  if (btn && badge && icon) {
    if (favs.length) {
      btn.classList.add('has-favs');
      icon.className = 'fas fa-star';
      badge.textContent = String(favs.length);
      badge.hidden = false;
    } else {
      btn.classList.remove('has-favs');
      icon.className = 'far fa-star';
      badge.hidden = true;
    }
  }
  // Si el modal esta abierto, refrescamos su lista en vivo.
  var modal = document.getElementById('modal-favs');
  if (modal && modal.classList.contains('show')) renderFavsModalList();
}
// Alias: renderFavsPanel es el nombre historico llamado desde toggle/handlers.
function renderFavsPanel() { renderFavs(); }

// Render de la lista de favoritas dentro del modal. Cada fila muestra rotulo
// + municipio + provincia y, si la gasolinera ya esta cargada en allStations,
// el precio actual (badge). El click navega al mapa via navigateToFav() —
// independientemente de la provincia que se esta viendo ahora mismo.
function renderFavsModalList() {
  var list = document.getElementById('favs-list');
  var empty = document.getElementById('favs-empty');
  var countEl = document.getElementById('favs-modal-count');
  if (!list || !empty) return;
  var favs = getFavs();
  if (countEl) countEl.textContent = String(favs.length);
  list.innerHTML = '';
  if (!favs.length) {
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';
  var fuel = document.getElementById('sel-combustible').value;
  // Disparamos prefetch de las provincias con favs sin datos en background
  // ANTES del render: asi si llega antes de que el usuario cierre el modal,
  // se re-renderiza automaticamente con precios frescos.
  prefetchFavsPrices(favs);
  favs.forEach(function(f) {
    // Busqueda global: allStations (provincia actual) + cualquier cache
    // localStorage gs_v2_* de otras provincias. Permite stale hasta 30d.
    var found = lookupStationInCaches(f.id);
    var live = found ? found.station : null;
    // Enriquecimiento oportunista: si la estacion esta disponible (en la
    // provincia actual o en otra cacheada) y la favorita es legacy,
    // completamos sus IDs silenciosamente para futuras navegaciones.
    if (live && (!f.provinciaId || !f.municipioId)) {
      enrichFav(f.id, {
        provinciaId: live['IDProvincia'] || '',
        municipioId: live['IDMunicipio'] || '',
        provincia:   live['Provincia']   || '',
        municipio:   live['Municipio']   || ''
      });
      if (!f.provinciaId) f.provinciaId = live['IDProvincia'] || '';
      if (!f.municipioId) f.municipioId = live['IDMunicipio'] || '';
      if (!f.provincia)   f.provincia   = live['Provincia']   || '';
      if (!f.municipio)   f.municipio   = live['Municipio']   || '';
    }
    var price = live ? parsePrice(live[fuel]) : null;
    // Si el precio viene de un cache stale (>4h pero <30d), lo marcamos con
    // el mismo icono de "atencion" que usa showCacheIndicator y con un
    // tooltip claro. Asi el usuario no asume que el precio es live.
    var ageHint = (found && found.stale) ? ' title="Precio guardado ' + formatAge(found.ts) + ' (pulsa para actualizar)"' : '';
    var stalePrefix = (found && found.stale) ? '\u26A0 ' : '';
    var priceHtml = price
      ? '<span class="fav-row-price badge badge-' + priceColor(price) + '"' + ageHint + '>' + stalePrefix + fmtPriceUnit(price) + '</span>'
      : '<span class="fav-row-sub fav-row-sub--small">Sin datos</span>';
    // Mostramos municipio (+ provincia si la conocemos) para que el usuario
    // entienda de un vistazo donde vive cada favorita.
    var loc = esc(f.municipio || '');
    if (f.provincia && f.provincia !== f.municipio) loc += (loc ? ', ' : '') + esc(f.provincia);
    var row = document.createElement('div');
    row.className = 'fav-row';
    row.innerHTML =
        '<div class="fav-row-info" role="button" tabindex="0" aria-label="Ver ' + esc(f.rotulo) + ' en el mapa">'
      + '  <div class="fav-row-title">\u2B50 ' + esc(f.rotulo) + '</div>'
      + '  <div class="fav-row-sub">\u{1F4CD} ' + loc + '</div>'
      + '</div>'
      + '<div>' + priceHtml + '</div>'
      + '<button class="fav-row-remove" data-remove-id="' + esc(f.id) + '" aria-label="Quitar de favoritas" title="Quitar"><i class="fas fa-trash" aria-hidden="true"></i></button>';
    // Click en info -> navegar a la favorita (setea provincia, municipio,
    // busqueda por rotulo y zoom). Funciona aunque actualmente estes viendo
    // otra provincia: navigateToFav carga lo que haga falta.
    var info = row.querySelector('.fav-row-info');
    if (info) {
      info.addEventListener('click', function() { navigateToFav(f); });
      info.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter' || ev.key === ' ') {
          ev.preventDefault();
          navigateToFav(f);
        }
      });
    }
    // Click en quitar -> toggleFav + re-render.
    row.querySelector('.fav-row-remove').addEventListener('click', function() {
      // Necesitamos una "station-like" para toggleFav; reconstruimos la
      // minima informacion a partir del objeto favorito guardado.
      toggleFav({
        'IDEESS': f.id,
        'Rotulo': f.rotulo,
        'Municipio': f.municipio,
        'Direccion': f.direccion,
        'Latitud': String(f.lat),
        'Longitud (WGS84)': String(f.lng)
      });
      showToast('Eliminada de favoritas', 'info');
      renderFavs();
      // El boton de favorito dentro de la station-card (si esta en el DOM)
      // tambien tiene que sincronizarse.
      var cardBtn = document.querySelector('.fav-btn[data-fav-id="' + f.id + '"]');
      if (cardBtn) {
        cardBtn.classList.remove('active');
        cardBtn.textContent = '\u2606';
        cardBtn.setAttribute('aria-pressed', 'false');
        cardBtn.setAttribute('aria-label', 'A\u00f1adir a favoritas');
      }
    });
    list.appendChild(row);
  });
}

// Mapa manual de nombre -> codigo INE. Nominatim devuelve a veces el nombre
// en castellano y nuestro dropdown en el idioma cooficial (Bizkaia/Vizcaya,
// Gipuzkoa/Guipuzcoa, A Coruna/La Coruna, Ourense/Orense, Illes Balears/
// Baleares). Esta tabla ancla los casos donde el match por 'includes' sobre
// SPAIN_PROVINCIAS podria fallar. Las claves estan ya normalizadas
// (normStr: minusculas, sin acentos, sin signos).
var PROV_NAME_TO_ID = {
  'vizcaya': '48', 'bizkaia': '48',
  'guipuzcoa': '20', 'gipuzkoa': '20',
  'alava': '01', 'araba': '01',
  'la coruna': '15', 'a coruna': '15', 'coruna': '15',
  'orense': '32', 'ourense': '32',
  'gerona': '17', 'girona': '17',
  'lerida': '25', 'lleida': '25',
  'baleares': '07', 'islas baleares': '07', 'illes balears': '07',
  'palmas': '35', 'las palmas': '35',
  'tenerife': '38', 'santa cruz de tenerife': '38',
  'navarra': '31', 'nafarroa': '31',
  'castellon': '12', 'castello': '12'
};

// Resuelve un nombre de provincia (puede venir de Nominatim con acentos,
// en castellano, en euskera...) a su codigo INE de 2 digitos. Usa la tabla
// de aliases primero y luego recorre SPAIN_PROVINCIAS con match por
// inclusion bidireccional. Reutiliza normStr() (ya definida arriba) para
// normalizar ambos lados con el mismo criterio que el resto del cliente.
function provinciaIdByName(name) {
  var n = normStr(name);
  if (!n) return '';
  if (PROV_NAME_TO_ID[n]) return PROV_NAME_TO_ID[n];
  for (var i = 0; i < SPAIN_PROVINCIAS.length; i++) {
    var candidate = normStr(SPAIN_PROVINCIAS[i].Provincia);
    if (candidate === n || candidate.includes(n) || n.includes(candidate)) {
      return SPAIN_PROVINCIAS[i].IDPovincia;
    }
  }
  return '';
}

// Para favoritas legacy (guardadas antes de v1.6.1, sin provinciaId) hacemos
// reverse geocode con Nominatim usando las coordenadas que ya tenemos.
// Devuelve el primer nombre no vacio en el orden que mejor funciona para
// direcciones espanolas (el mismo que ya usa el flujo /btn-geolocate):
// state_district > county > province > state. Si el servicio no responde
// o no hay provincia reconocible, devolvemos ''. El mapeo a codigo INE lo
// hace provinciaIdByName() a continuacion.
async function reverseProvinciaFromLatLng(lat, lng) {
  if (!lat || !lng || isNaN(lat) || isNaN(lng)) return '';
  try {
    // Va por /api/geocode/reverse → no exponemos la IP del usuario a OSM.
    var url = '/api/geocode/reverse?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lng);
    var r = await fetch(url);
    if (!r.ok) return '';
    var data = await r.json();
    var addr = data && data.address || {};
    return addr.state_district || addr.county || addr.province || addr.state || '';
  } catch (_) { return ''; }
}

// Persiste campos enriquecidos en una favorita concreta (por id) sin
// duplicar la entrada. Devuelve true si hubo cambios.
function enrichFav(id, patch) {
  if (!id || !patch) return false;
  var favs = getFavs();
  var changed = false;
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].id !== id) continue;
    for (var k in patch) {
      if (!favs[i][k] && patch[k]) { favs[i][k] = patch[k]; changed = true; }
    }
    break;
  }
  if (changed) setFavs(favs);
  return changed;
}

// Borra los campos de provincia/municipio previamente cacheados en una
// favorita. Se usa cuando descubrimos que eran incorrectos (p.ej. reverse
// geocode devolvio mal la provincia: Nominatim puede devolver la provincia
// mas cercana si el lat/lng cae en un limite administrativo raro). Forzar
// clear permite que el siguiente navigateToFav los vuelva a resolver de cero.
function clearFavProvinceHints(id) {
  if (!id) return;
  var favs = getFavs();
  var changed = false;
  for (var i = 0; i < favs.length; i++) {
    if (favs[i].id !== id) continue;
    if (favs[i].provinciaId || favs[i].municipioId || favs[i].provincia || favs[i].municipio) {
      delete favs[i].provinciaId;
      delete favs[i].municipioId;
      delete favs[i].provincia;
      delete favs[i].municipio;
      changed = true;
    }
    break;
  }
  if (changed) setFavs(favs);
}

// Navega el mapa+sidebar hasta la favorita indicada:
//   1. Cierra el modal.
//   2. Si tenemos provinciaId: fija el select de provincia, carga municipios,
//      fija el select de municipio, rellena la caja "Buscar gasolinera" con
//      el rotulo y dispara loadStations() + applyFilters() — asi el unico
//      resultado visible es la favorita.
//   3. Hace zoom y abre su popup.
// Si la favorita es legacy (sin provinciaId): intentamos resolver la
// provincia con reverse geocoding de Nominatim sobre sus coordenadas, la
// persistimos en localStorage y seguimos con el flujo normal. Asi el
// usuario no tiene que re-guardar nada.
async function navigateToFav(f) {
  closeFavsModal();
  var selProv = document.getElementById('sel-provincia');
  var selMun  = document.getElementById('sel-municipio');
  var inText  = document.getElementById('search-text');

  // Clicar una favorita es un cambio de contexto explicito: olvidamos la
  // GPS anterior (si el usuario habia pulsado "Mi ubicacion" antes en
  // otra provincia, applyFilters despues filtraba por radio contra esas
  // coords viejas y dejaba 0 resultados aunque cargaramos la provincia
  // correcta).
  clearGeolocationMode();

  // Paso 0: centrar el mapa INMEDIATAMENTE sobre la ubicacion real de la
  // favorita. Esto desacopla el feedback visual (siempre funciona si
  // guardamos lat/lng) de la resolucion de provincia (que puede fallar o
  // devolver dato equivocado). Si luego todo va bien, zoomTo() refinara el
  // zoom y abrira el popup.
  var favLat = parseFloat(f.lat);
  var favLng = parseFloat(f.lng);
  var haveFavCoords = !isNaN(favLat) && !isNaN(favLng) && (favLat !== 0 || favLng !== 0);
  if (haveFavCoords) {
    try { map.setView([favLat, favLng], 15); } catch(_) {}
  }

  // --- Resolver provinciaId para favoritas legacy ---
  if (!f.provinciaId) {
    // Atajo 1: si esta en allStations (la provincia actual), cogemos los
    // IDs de ahi sin llamar a Nominatim.
    for (var q = 0; q < allStations.length; q++) {
      if (stationId(allStations[q]) === f.id) {
        var s = allStations[q];
        var pid = s['IDProvincia'] || '';
        var mid = s['IDMunicipio'] || '';
        var pname = s['Provincia'] || '';
        if (pid) {
          enrichFav(f.id, { provinciaId: pid, municipioId: mid, provincia: pname });
          f.provinciaId = pid; f.municipioId = mid; f.provincia = pname;
        }
        break;
      }
    }
  }
  if (!f.provinciaId) {
    // Atajo 2: reverse geocode por lat/lng y mapear nombre -> codigo INE.
    showToast('Resolviendo ubicacion de la favorita\u2026', 'info');
    var provName = await reverseProvinciaFromLatLng(favLat, favLng);
    var provId = provName ? provinciaIdByName(provName) : '';
    if (provId) {
      enrichFav(f.id, { provinciaId: provId, provincia: provName });
      f.provinciaId = provId;
      f.provincia = provName;
    }
  }
  if (!f.provinciaId) {
    // Sin provinciaId: si el mapa ya esta centrado en la favorita (paso 0),
    // al menos el usuario la ve. Quitamos el search text (para no mentir
    // con "Sin resultados") y damos un toast explicativo.
    if (inText) inText.value = '';
    applyFilters();
    if (haveFavCoords) {
      showToast('No pudimos resolver la provincia. Seleccionala manualmente — el mapa ya esta centrado en la favorita.', 'warning');
    } else {
      showToast('No hemos podido ubicar esta favorita. Quitala y guardala otra vez.', 'warning');
    }
    return;
  }

  // Helper interno: carga las estaciones del provinciaId actual y devuelve
  // si la favorita aparece en allStations. Evita repetir el bloque en el
  // primer intento + el reintento de self-healing.
  async function loadAndCheck() {
    if (selProv) selProv.value = f.provinciaId;
    try { await loadMunicipios(f.provinciaId); } catch(_) {}
    if (selMun && f.municipioId) {
      var hasOpt = false;
      for (var o = 0; o < selMun.options.length; o++) {
        if (selMun.options[o].value === f.municipioId) { hasOpt = true; break; }
      }
      selMun.value = hasOpt ? f.municipioId : '';
    } else if (selMun) {
      selMun.value = '';
    }
    try { await loadStations(); } catch(_) {}
    for (var p = 0; p < allStations.length; p++) {
      if (stationId(allStations[p]) === f.id) return true;
    }
    return false;
  }

  // --- A partir de aqui tenemos provinciaId (posiblemente incorrecto de un
  // reverse anterior). Cargamos; si el fav NO aparece, lo tratamos como
  // provinciaId corrupto, lo borramos y reintentamos con reverse fresco.
  if (inText) inText.value = f.rotulo || '';
  var found = await loadAndCheck();

  if (!found && haveFavCoords) {
    // Self-heal: la provinciaId cacheada es incorrecta. La borramos y
    // pedimos un reverse geocode nuevo. Si la API devuelve una provincia
    // distinta, reintentamos loadStations sobre esa.
    var oldProvId = f.provinciaId;
    clearFavProvinceHints(f.id);
    f.provinciaId = '';
    f.municipioId = '';
    showToast('Re-resolviendo ubicacion de la favorita\u2026', 'info');
    var provName2 = await reverseProvinciaFromLatLng(favLat, favLng);
    var provId2 = provName2 ? provinciaIdByName(provName2) : '';
    if (provId2 && provId2 !== oldProvId) {
      enrichFav(f.id, { provinciaId: provId2, provincia: provName2 });
      f.provinciaId = provId2;
      f.provincia = provName2;
      found = await loadAndCheck();
    }
  }

  if (!found) {
    // Ni con self-heal sale. Quitamos el filtro de texto (para que el
    // usuario pueda mirar las de la provincia actual si ya esta), avisamos,
    // y dejamos el mapa centrado en la favorita como hicimos en paso 0.
    if (inText) inText.value = '';
    applyFilters();
    showToast('No encontramos "' + (f.rotulo || 'esta favorita') + '" en los datos actuales. El mapa esta centrado en su ubicacion.', 'warning');
    return;
  }

  // Enriquecer la favorita con los IDs correctos ahora que sabemos que
  // aparece en allStations (caso legacy donde solo teniamos provincia por
  // reverse — ahora tambien capturamos municipio).
  for (var p2 = 0; p2 < allStations.length; p2++) {
    if (stationId(allStations[p2]) === f.id) {
      var st2 = allStations[p2];
      enrichFav(f.id, {
        provinciaId: st2['IDProvincia'] || '',
        municipioId: st2['IDMunicipio'] || '',
        provincia:   st2['Provincia']   || '',
        municipio:   st2['Municipio']   || ''
      });
      break;
    }
  }

  // Buscar la estacion en el resultado filtrado y hacer zoom. Si el filtro
  // de combustible/avanzados la escondio del listado, applyFilters ya ha
  // corrido desde loadStations — pero la favorita SI esta en allStations.
  for (var i = 0; i < filteredStations.length; i++) {
    if (stationId(filteredStations[i]) === f.id) { zoomTo(i); return; }
  }
  showToast('Esa gasolinera existe pero esta oculta por los filtros avanzados', 'info');
}

function openFavsModal() {
  var modal = document.getElementById('modal-favs');
  if (!modal) return;
  renderFavsModalList();
  modal.classList.add('show');
}
function closeFavsModal() {
  var modal = document.getElementById('modal-favs');
  if (modal) modal.classList.remove('show');
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
  var inAuto    = document.getElementById('in-autonomy');

  // Autonomia es un campo INDEPENDIENTE. tmpProfile.autonomy se setea una
  // vez (como default al abrir el modal: deposito/consumo*100) y a partir
  // de ahi solo cambia si el usuario lo edita. Cambiar deposito o consumo
  // NO lo mueve — el usuario ya declaro un valor fijo.
  var tmpProfile = { fuel: '', km: 0, consumo: 6.5, tank: 50, autonomy: 0, strictFuel: true };

  // Autonomia por defecto: si el perfil aun no tiene autonomy guardada, la
  // derivamos de tank+cons para dar un valor de partida razonable. Si ya
  // existe (el usuario la guardo antes), la respetamos tal cual.
  function deriveDefaultAutonomy(cur) {
    var t = (typeof cur.tank === 'number' && cur.tank > 0) ? cur.tank : 50;
    var c = (typeof cur.consumo === 'number' && cur.consumo > 0) ? cur.consumo : 6.5;
    return Math.round((t / c) * 100);
  }

  function openModal() {
    var cur = getProfile() || {};
    // Autonomia: si el perfil ya tiene un valor guardado (>0), lo usamos;
    // si no, la derivamos de tank/cons UNA SOLA VEZ como default inicial.
    // A partir de ese momento vive independiente.
    var savedAuto = (typeof cur.autonomy === 'number' && cur.autonomy > 0) ? cur.autonomy : 0;
    tmpProfile = {
      fuel: cur.fuel || '',
      km: cur.km || 0,
      consumo: cur.consumo || 6.5,
      tank: cur.tank || 50,
      autonomy: savedAuto || deriveDefaultAutonomy(cur),
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
    if (inAuto) inAuto.value = String(tmpProfile.autonomy);
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
  // Los sliders de consumo y deposito ya NO tocan la autonomia: son campos
  // independientes. La autonomia es un dato que el usuario declara (y que
  // domina en el planificador de rutas).
  inCons.addEventListener('input', function() {
    tmpProfile.consumo = parseFloat(inCons.value);
    lblCons.textContent = tmpProfile.consumo.toString().replace('.', ',') + ' L';
  });
  inTankM.addEventListener('input', function() {
    tmpProfile.tank = parseInt(inTankM.value, 10);
    lblTankM.textContent = tmpProfile.tank + ' L';
  });

  // Autonomia independiente: el usuario la fija y se queda fija. Solo
  // validamos el rango [50, 2000] para evitar valores absurdos (y para
  // que el planificador de rutas no se rompa). Listener en 'change' (no
  // 'input') para no pelearse con cada tecla intermedia.
  if (inAuto) {
    inAuto.addEventListener('change', function() {
      var km = parseInt(inAuto.value, 10);
      if (!isFinite(km) || km <= 0) {
        // Valor invalido: restauramos lo que habia.
        inAuto.value = String(tmpProfile.autonomy);
        return;
      }
      if (km < 50) km = 50;
      if (km > 2000) km = 2000;
      tmpProfile.autonomy = km;
      inAuto.value = String(km);
    });
  }

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

// Toggle €/centimos retirado: precios siempre se muestran en €/L para evitar
// que los usuarios despistados comparen mentalmente 1.449 con 144.9.

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
  } else if (e.key === '?') {
    showToast('Atajos: / buscar \u00B7 g ubicacion \u00B7 d tema', 'info');
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

// ---- HANDLERS DEL MODAL DE FAVORITAS ----
// Modal accesible desde la estrella del header. Solo renderiza la lista —
// el click en una fila dispara navigateToFav() (ver arriba) y el user
// acaba con esa gasolinera unica visible en el mapa. Las alertas
// (navegador/email) se dejaron fuera de este release para mantener la UI
// centrada en "ver mis favoritas".
(function() {
  var modal = document.getElementById('modal-favs');
  if (!modal) return;
  var btnOpen   = document.getElementById('btn-favs');
  var btnClose  = document.getElementById('btn-favs-close');
  var btnDone   = document.getElementById('btn-favs-done');

  if (btnOpen)  btnOpen.addEventListener('click', openFavsModal);
  if (btnClose) btnClose.addEventListener('click', closeFavsModal);
  if (btnDone)  btnDone.addEventListener('click', closeFavsModal);
  // Cerrar con click en backdrop o Escape.
  modal.addEventListener('click', function(e) { if (e.target === modal) closeFavsModal(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeFavsModal();
  });

  // Render inicial de la estrella (color + insignia) antes de que se carguen
  // las gasolineras — asi el boton ya refleja las favoritas persistidas.
  renderFavs();
})();

// ---- SERVICE WORKER (PWA) ----
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js').catch(function() {});
  });
}

// ---- TREND STRIP (tendencia nacional hoy vs ciclo anterior) ----
// Lee /data/trends.json (generado por scripts/fetch-prices.mjs cada cron) y
// pinta un strip horizontal con medianas nacionales de gasolina 95 + gasoleo A
// mas delta vs la ejecucion anterior. Se oculta si no hay "previous" (primera
// ejecucion) o si el usuario lo descarto en este ciclo (recordamos la
// dismissal anclada al ministryDate para que vuelva a aparecer al dia
// siguiente con nuevos datos).
(function() {
  var strip  = document.getElementById('trend-strip');
  if (!strip) return;
  var g95El  = document.getElementById('trend-g95');
  var dslEl  = document.getElementById('trend-diesel');
  var closer = document.getElementById('trend-strip-close');
  var DISMISS_KEY = 'gs_trend_dismiss_v1';

  function fmtPrice(v) { return v == null ? '--' : v.toFixed(3) + ' \u20AC'; }
  function fmtDelta(d) {
    if (d == null) return '';
    // Mostramos en centimos porque el delta inter-ciclo es de decimas de cent.
    var cents = d * 100;
    var abs = Math.abs(cents);
    if (abs < 0.5) return '<span class="dlt dlt-flat">\u2194 sin cambio</span>';
    var arrow = cents < 0 ? '\u2193' : '\u2191';
    var cls = cents < 0 ? 'dlt-down' : 'dlt-up';
    return '<span class="dlt ' + cls + '">' + arrow + ' ' + abs.toFixed(1) + 'c</span>';
  }
  function paint(label, curr, prev, node) {
    if (curr == null) { node.textContent = ''; return false; }
    var delta = (prev != null) ? (curr - prev) : null;
    node.innerHTML = label + ' <b>' + fmtPrice(curr) + '</b> ' + fmtDelta(delta);
    return true;
  }

  try {
    fetch('/data/trends.json', { cache: 'no-store' }).then(function(r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function(data) {
      if (!data || !data.current) return;
      // No mostramos el strip hasta tener un "previous" (primera ejecucion
      // del cron no tiene con que comparar).
      if (!data.previous) return;
      var curr = data.current.medians || {};
      var prev = data.previous.medians || {};
      // Dismissal: si el usuario cerro este mismo snapshot, respetamos.
      var dismissed = '';
      try { dismissed = localStorage.getItem(DISMISS_KEY) || ''; } catch(_) {}
      if (dismissed && dismissed === (data.ministryDate || '')) return;

      var any = false;
      any = paint('G95:',   curr.g95,    prev.g95,    g95El) || any;
      any = paint('Di\u00E9sel:', curr.diesel, prev.diesel, dslEl) || any;
      if (any) strip.hidden = false;
    }).catch(function() { /* silenciar — strip es opcional */ });
  } catch(_) {}

  if (closer) {
    closer.addEventListener('click', function() {
      strip.hidden = true;
      // Ancla la dismissal al ministryDate activo: al dia siguiente, cuando
      // cambie el snapshot, volvera a aparecer.
      try {
        fetch('/data/trends.json', { cache: 'no-store' }).then(function(r) {
          return r.ok ? r.json() : null;
        }).then(function(data) {
          if (!data) return;
          try { localStorage.setItem(DISMISS_KEY, data.ministryDate || ''); } catch(_) {}
        }).catch(function(){});
      } catch(_) {}
    });
  }
})();

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

// ============================================================
// ===== RUTA OPTIMA A->B (Feature 4) =========================
// ============================================================
// Modal que acepta origen + destino (geocoder Nominatim), la autonomia del
// coche y el ancho del corredor. Calcula:
//   1. Pide a /api/route la ruta REAL por carretera (proxy OSRM): obtenemos
//      la polilinea [[lng, lat], ...] y la distancia total en km.
//   2. Fetchea /api/estaciones/bbox con la bbox que envuelve la polilinea
//      (+margen). Cubre todas las provincias intermedias.
//   3. Para cada estacion del bbox, proyecta sobre la POLILINEA (no sobre
//      linea recta) y conserva las que caen dentro del corredor
//      (offKm <= width).
//   4. Aplica planFuelStops() con la autonomia declarada para decidir
//      EN QUE estacion parar (la mas barata alcanzable en cada tramo).
//   5. Entra en "modo ruta" en el mapa: oculta el cluster, dibuja la
//      polilinea, pinta solo las paradas recomendadas con marcadores
//      numerados, y muestra un banner flotante para salir.
//
// Por que routing real (y no linea recta como antes):
//  - La linea recta Madrid-Barcelona pasa sobre los Pirineos. Las
//    estaciones reales estan en la A-2 / AP-7, que serpentea por Zaragoza
//    y Lleida. Con linea recta, una estacion "a 3 km del corredor" puede
//    estar a 80 km por carretera.
//  - El km-desde-origen en linea recta subestima la ruta real en 10-30%
//    en trayectos reales, lo que mete paradas imposibles en el plan.
//
// La feature usa el demo publico de OSRM, cacheado 24h en el server: las
// carreteras no cambian en horas, asi que 99% de las rutas sirven el
// primer hit a la siguiente peticion identica.

// ---- URL builders para llevar la ruta a apps de navegacion ----
// Google Maps y Apple Maps soportan MULTI-paradas via URL. Waze NO: su
// esquema de deep-link solo acepta un destino, asi que para Waze abrimos
// la proxima parada no visitada (o el destino final si no hay paradas) y
// el usuario tiene que repetir el proceso en cada gasolinera. Mostramos
// esa limitacion en la UI para que no haya sorpresas.
//
// Formatos:
//   Google: dir/?api=1&origin=LAT,LNG&destination=LAT,LNG
//           &waypoints=LAT,LNG|LAT,LNG&travelmode=driving
//   Apple:  ?saddr=LAT,LNG&daddr=LAT,LNG+to:LAT,LNG+to:LAT,LNG&dirflg=d
//   Waze:   ?ll=LAT,LNG&navigate=yes
//
// Google Maps acepta hasta 9 waypoints; Apple tiene un limite practico
// similar. MAX_ROUTE_STOPS ya esta capado a 8 en el backend, pero
// defendemos aqui tambien por si un futuro cambio lo eleva.
var NAV_MAX_WAYPOINTS = 9;
function navCoord(ll) {
  return ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6);
}

// Construye la direccion POSTAL completa de una gasolinera para pasarsela
// como waypoint textual a Google/Apple Maps. Motivo: si mandamos solo
// LAT,LNG, Maps reverse-geocodea al nombre de calle mas cercano y pierde la
// referencia de la gasolinera concreta (el pin puede acabar en la carretera
// en vez de en la estacion). Con direccion textual el buscador resuelve al
// POI exacto. Formato: "Rotulo, Direccion, CP Municipio, Provincia, Espana".
// Si faltan piezas, las saltamos y devolvemos null si no queda nada util
// (el caller cae a LAT,LNG).
function stationAddress(s) {
  if (!s) return null;
  var parts = [];
  var rot = (s['Rotulo'] || '').trim();
  var dir = (s['Direccion'] || '').trim();
  var cp  = (s['C.P.'] || s['CP'] || '').trim();
  var mun = (s['Municipio'] || '').trim();
  var prov = (s['Provincia'] || '').trim();
  if (rot) parts.push(rot);
  if (dir) parts.push(dir);
  var cpMun = [cp, mun].filter(Boolean).join(' ').trim();
  if (cpMun) parts.push(cpMun);
  if (prov) parts.push(prov);
  if (parts.length === 0) return null;
  parts.push('Espana');
  return parts.join(', ');
}

// Devuelve la representacion preferida para pasar como waypoint al
// navegador. Intentamos direccion textual primero (apunta a la gasolinera
// concreta) y caemos a coordenadas si la direccion esta vacia.
function stationWaypoint(stop) {
  if (!stop || !stop.item) return null;
  var addr = stationAddress(stop.item);
  if (addr) return { kind: 'text', value: addr };
  var ll = stationLatLng(stop.item);
  if (ll) return { kind: 'coord', value: navCoord(ll) };
  return null;
}

function navStopsWaypoints(stops) {
  var out = [];
  if (!stops) return out;
  for (var i = 0; i < stops.length && i < NAV_MAX_WAYPOINTS; i++) {
    var wp = stationWaypoint(stops[i]);
    if (wp) out.push(wp);
  }
  return out;
}
function googleMapsRouteUrl(from, to, stops) {
  // Origen + destino seguimos pasandolos como LAT,LNG (el usuario puso los
  // puntos via geocoder, tenemos coords exactas y asi evitamos ambiguedades
  // con nombres de ciudad). Los waypoints de gasolineras van como TEXTO
  // cuando tenemos la direccion completa — asi Google Maps apunta al POI
  // concreto y no a la carretera mas cercana.
  var url = 'https://www.google.com/maps/dir/?api=1'
          + '&origin=' + navCoord(from)
          + '&destination=' + navCoord(to)
          + '&travelmode=driving';
  var wps = navStopsWaypoints(stops);
  if (wps.length > 0) {
    url += '&waypoints=' + encodeURIComponent(wps.map(function(w) { return w.value; }).join('|'));
  }
  return url;
}
function appleMapsRouteUrl(from, to, stops) {
  // daddr = parada1+to:parada2+to:destino. Apple requiere que el destino
  // final sea el ULTIMO elemento de daddr, no un parametro separado.
  // Igual que Google: waypoints textuales para apuntar a la gasolinera
  // exacta; saddr/destino final quedan en coordenadas (geocoder precisas).
  var wps = navStopsWaypoints(stops);
  var daddrParts = wps.map(function(w) { return w.value; });
  daddrParts.push(navCoord(to));
  return 'https://maps.apple.com/?saddr=' + navCoord(from)
       + '&daddr=' + encodeURIComponent(daddrParts.join('+to:'))
       + '&dirflg=d';
}
function wazeRouteUrl(to) {
  // Waze NO soporta waypoints via URL: su esquema ?ll=LAT,LNG solo acepta
  // un destino. Devolvemos el URL al destino final. La UI avisa al usuario.
  return 'https://waze.com/ul?ll=' + navCoord(to) + '&navigate=yes';
}

// Estado conservado entre entrar/salir de modo-ruta: permite re-generar
// las URLs si el usuario cambia de app sin recalcular la ruta.
var routeNavFrom = null;
var routeNavTo = null;
var routeNavStops = null;

// Entra en modo-ruta: oculta los marcadores generales, dibuja la polilinea y
// los marcadores numerados de las paradas recomendadas, y centra el mapa.
// Guarda los layers para poder desmontarlos al salir.
function enterRouteMode(coords, stops, from, to) {
  if (!map) return;
  // Oculta el cluster general; al salir lo volveremos a enganchar.
  if (clusterGroup && map.hasLayer(clusterGroup)) {
    map.removeLayer(clusterGroup);
  }
  // Limpia layers previos de una ruta anterior si existiera.
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (routeStopsLayer) { map.removeLayer(routeStopsLayer); routeStopsLayer = null; }

  // Guarda contexto para re-generar deep-links (Waze secuencial, etc.).
  routeNavFrom = from || null;
  routeNavTo = to || null;
  routeNavStops = stops || [];

  // Polilinea: coords viene como [[lng, lat], ...] (GeoJSON). Leaflet usa
  // [lat, lng] en L.polyline, asi que le damos la vuelta.
  var latLngs = coords.map(function(c) { return [c[1], c[0]]; });
  routeLayer = L.polyline(latLngs, {
    color: '#0f766e',
    weight: 5,
    opacity: 0.85,
    lineJoin: 'round',
    lineCap: 'round'
  }).addTo(map);

  // Marcadores numerados de las paradas.
  routeStopsLayer = L.layerGroup();
  (stops || []).forEach(function(stop, i) {
    var s = stop.item;
    var pos = stationLatLng(s);
    if (!pos) return;
    var icon = L.divIcon({
      className: 'route-stop-divicon',
      html: '<div class="route-stop-marker">' + (i + 1) + '</div>',
      iconSize: [36, 36],
      iconAnchor: [18, 18]
    });
    var m = L.marker([pos.lat, pos.lng], { icon: icon, zIndexOffset: 800 });
    // Popup informativo: rotulo, direccion, precio y km desde origen. Sin
    // botones de navegacion por gasolinera: la ruta completa se lleva a
    // Google/Apple/Waze desde el banner flotante o el plan del modal.
    var popup = '<div style="font-weight:700;margin-bottom:4px;">Parada ' + (i + 1) + ': ' + esc(s['Rotulo'] || 'Gasolinera') + '</div>'
              + '<div style="font-size:12px;color:#475569;margin-bottom:4px;">' + esc((s['Direccion'] || '') + ', ' + (s['Municipio'] || '')) + '</div>'
              + '<div style="font-size:14px;font-weight:800;color:#16a34a;margin-bottom:4px;">' + stop.priceEurL.toFixed(3) + ' \u20AC/L</div>'
              + '<div style="font-size:11px;color:#475569;">km ' + Math.round(stop.kmFromOrigin) + ' desde origen</div>';
    m.bindPopup(popup, { maxWidth: 240 });
    routeStopsLayer.addLayer(m);
  });
  routeStopsLayer.addTo(map);

  // Centra el mapa en la ruta completa.
  try { map.fitBounds(routeLayer.getBounds(), { padding: [40, 40] }); } catch (e) {}

  // Pobla los deep-links del banner flotante (Google/Apple con paradas,
  // Waze solo al destino). Si faltan origen/destino, ocultamos el bloque.
  var navBox = document.getElementById('route-mode-bar-nav');
  if (navBox && from && to) {
    var gLink = document.getElementById('nav-gmaps');
    var aLink = document.getElementById('nav-amaps');
    var wLink = document.getElementById('nav-waze');
    if (gLink) gLink.setAttribute('href', googleMapsRouteUrl(from, to, stops));
    if (aLink) aLink.setAttribute('href', appleMapsRouteUrl(from, to, stops));
    if (wLink) wLink.setAttribute('href', wazeRouteUrl(to));
    navBox.style.display = 'inline-flex';
  } else if (navBox) {
    navBox.style.display = 'none';
  }

  // Banner flotante de estado.
  var bar = document.getElementById('route-mode-bar');
  if (bar) bar.classList.add('show');
  routeModeActive = true;
}

// Sale de modo-ruta: quita polilinea + marcadores y restaura el cluster.
function exitRouteMode() {
  if (routeLayer) { try { map.removeLayer(routeLayer); } catch (e) {} routeLayer = null; }
  if (routeStopsLayer) { try { map.removeLayer(routeStopsLayer); } catch (e) {} routeStopsLayer = null; }
  if (map && clusterGroup && !map.hasLayer(clusterGroup)) {
    map.addLayer(clusterGroup);
  }
  var bar = document.getElementById('route-mode-bar');
  if (bar) bar.classList.remove('show');
  routeModeActive = false;
  routeNavFrom = null;
  routeNavTo = null;
  routeNavStops = null;
}

// Hook del boton de salida del banner flotante (existe siempre en el DOM).
(function() {
  var exitBtn = document.getElementById('route-mode-bar-exit');
  if (exitBtn) exitBtn.addEventListener('click', exitRouteMode);
})();

(function() {
  var modal     = document.getElementById('modal-route');
  if (!modal) return;
  var btnOpen   = document.getElementById('btn-route');
  var btnClose  = document.getElementById('btn-route-close');
  var btnDone   = document.getElementById('btn-route-done');
  var btnGo     = document.getElementById('btn-route-go');
  var inFrom    = document.getElementById('route-from');
  var inTo      = document.getElementById('route-to');
  var sugFrom   = document.getElementById('route-from-sug');
  var sugTo     = document.getElementById('route-to-sug');
  var stat      = document.getElementById('route-status');
  var plan      = document.getElementById('route-plan');
  var res       = document.getElementById('route-results');
  // Bloque informativo del perfil (read-only). No hay input de autonomia ni
  // de ancho del corredor: la autonomia sale de deposito+consumo del perfil
  // y el ancho arranca en 5 km con auto-retry.
  var profTankEl = document.getElementById('route-profile-tank');
  var profConsEl = document.getElementById('route-profile-cons');
  var profAutoEl = document.getElementById('route-profile-auto');
  var profBox    = document.getElementById('route-profile-box');

  // Ancho inicial del corredor (km). El auto-retry en doSearch() amplia
  // automaticamente a 3/5/7/10 si es necesario, asi que este valor solo
  // afecta a la primera iteracion. 5 km es buen punto de partida: cubre
  // casi todas las areas de servicio de autopista sin arrastrar gasolineras
  // de carreteras secundarias alejadas del trayecto.
  var DEFAULT_CORRIDOR_WIDTH_KM = 5;

  // Estado: guardamos la ultima seleccion confirmada de cada input (con
  // {lat, lng} resueltos). Si el usuario cambia el texto sin seleccionar
  // una sugerencia, lo invalidamos.
  var fromSel = null;
  var toSel   = null;

  // Lee tank+consumo+autonomia del perfil local. Devuelve null si falta
  // cualquiera de los tres — ese caso lo gestiona openRoute() ensenando un
  // CTA para configurar el perfil. La autonomia es el valor que el usuario
  // declaro explicitamente (prioritario); si no existe en el perfil (perfiles
  // antiguos), caemos a la derivada tank/cons*100. tank y cons se leen igual
  // para mostrarlos en el bloque informativo del modal.
  function readProfileVehicle() {
    var p = getProfile() || {};
    var tank = (typeof p.tank === 'number' && p.tank > 0) ? p.tank : null;
    var cons = null;
    if (typeof p.consumo === 'number' && p.consumo > 0) cons = p.consumo;
    else if (typeof p.consumoL100km === 'number' && p.consumoL100km > 0) cons = p.consumoL100km;
    if (!tank || !cons) return null;
    var auto = (typeof p.autonomy === 'number' && p.autonomy > 0)
               ? p.autonomy
               : Math.round((tank / cons) * 100);
    return { tank: tank, consumo: cons, autonomyKm: auto };
  }

  // Refresca el bloque "Tu coche (segun perfil)" con los valores actuales.
  // Si falta perfil, oculta el bloque y muestra un aviso con enlace al modal
  // de perfil — sin perfil no podemos planificar, asi evitamos que el usuario
  // pulse "Planificar" y reciba un error confuso.
  function refreshProfileBox() {
    var v = readProfileVehicle();
    if (!v) {
      if (profBox) {
        profBox.innerHTML = '<div class="route-profile-missing">'
          + '\u26A0\uFE0F Para planificar una ruta necesitamos tu dep\u00F3sito y consumo. '
          + '<a href="#" id="route-profile-link">Configura tu perfil</a>.'
          + '</div>';
        var lnk = document.getElementById('route-profile-link');
        if (lnk) lnk.addEventListener('click', function(e) {
          e.preventDefault();
          closeRoute();
          var btn = document.getElementById('btn-profile');
          if (btn) btn.click();
        });
      }
      return false;
    }
    if (profTankEl) profTankEl.textContent = String(v.tank);
    if (profConsEl) profConsEl.textContent = v.consumo.toString().replace('.', ',');
    if (profAutoEl) profAutoEl.textContent = String(v.autonomyKm);
    return true;
  }

  function openRoute() {
    res.innerHTML = '';
    plan.innerHTML = '';
    stat.textContent = '';
    stat.classList.remove('error');
    refreshProfileBox();
    modal.classList.add('show');
    setTimeout(function(){ inFrom && inFrom.focus(); }, 50);
  }
  function closeRoute() { modal.classList.remove('show'); }

  if (btnOpen) btnOpen.addEventListener('click', openRoute);
  if (btnClose) btnClose.addEventListener('click', closeRoute);
  if (btnDone) btnDone.addEventListener('click', closeRoute);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeRoute(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeRoute();
  });

  // Debounced geocoder search — reusa /api/geocode/search (Nominatim proxy).
  // Cada input tiene su propio timer para evitar llamadas cruzadas. Umbral
  // bajo (2 chars, 180ms) para que las sugerencias aparezcan mientras el
  // usuario escribe, sin saturar Nominatim — el server tiene cache y rate
  // limit propio para ese caso. Si el usuario escribe la misma consulta de
  // golpe ('Madrid'), el cache del server devuelve sin golpear Nominatim.
  function makeGeoSearch(input, container, onPick) {
    var timer = null;
    var lastQ = '';
    function hide() { container.classList.remove('show'); container.innerHTML = ''; }
    function runSearch(q) {
      if (q === lastQ) return;  // dedupe
      lastQ = q;
      fetch('/api/geocode/search?q=' + encodeURIComponent(q), { credentials: 'same-origin' })
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (input.value.trim() !== q) return;  // el usuario ya cambio el texto
          if (!data || !Array.isArray(data) || data.length === 0) { hide(); return; }
          var html = data.slice(0, 5).map(function(item) {
            var lat = parseFloat(item.lat);
            var lon = parseFloat(item.lon);
            var name = item.display_name || '';
            return '<div class="route-sug-item" data-lat="' + lat + '" data-lng="' + lon + '">'
                 + esc(name.length > 70 ? name.slice(0, 70) + '\u2026' : name)
                 + '</div>';
          }).join('');
          container.innerHTML = html;
          container.classList.add('show');
        }).catch(hide);
    }
    input.addEventListener('input', function() {
      var q = input.value.trim();
      // Usuario modifica el texto -> invalida seleccion previa
      onPick(null);
      if (timer) clearTimeout(timer);
      if (q.length < 2) { hide(); lastQ = ''; return; }
      timer = setTimeout(function() { runSearch(q); }, 180);
    });
    // Al hacer focus en un input con texto >=2 chars, re-mostrar sugerencias
    // sin esperar a teclear mas.
    input.addEventListener('focus', function() {
      var q = input.value.trim();
      if (q.length >= 2) runSearch(q);
    });
    container.addEventListener('mousedown', function(e) {
      // mousedown (no click) previene que el blur del input se dispare antes
      // de poder registrar la seleccion.
      var it = e.target.closest('.route-sug-item');
      if (!it) return;
      e.preventDefault();
      var lat = parseFloat(it.getAttribute('data-lat'));
      var lng = parseFloat(it.getAttribute('data-lng'));
      if (!isNaN(lat) && !isNaN(lng)) {
        input.value = it.textContent;
        onPick({ lat: lat, lng: lng, label: it.textContent });
      }
      hide();
    });
    input.addEventListener('blur', function() { setTimeout(hide, 200); });
  }
  makeGeoSearch(inFrom, sugFrom, function(p) { fromSel = p; });
  makeGeoSearch(inTo,   sugTo,   function(p) { toSel   = p; });

  // Duplicados locales de cumulativePolylineKm / projectOnPolyline (funciones
  // puras en src/lib/pure.ts). Los tests unitarios garantizan equivalencia;
  // aqui son copia literal en JS plano.
  function _toXY(p, cLat, cLng) {
    var R = 6371;
    var toRad = function(d) { return d * Math.PI / 180; };
    return {
      x: toRad(p.lng - cLng) * Math.cos(toRad(cLat)) * R,
      y: toRad(p.lat - cLat) * R
    };
  }
  function _haversineKm(lat1, lon1, lat2, lon2) {
    var R = 6371;
    var toRad = function(d) { return d * Math.PI / 180; };
    var dLat = toRad(lat2 - lat1);
    var dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat/2) * Math.sin(dLat/2)
          + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2))
          * Math.sin(dLon/2) * Math.sin(dLon/2);
    return 2 * R * Math.asin(Math.sqrt(a));
  }
  function cumulativePolylineKm(coords) {
    var cum = [0];
    for (var i = 1; i < coords.length; i++) {
      var p0 = coords[i - 1], p1 = coords[i];
      cum.push(cum[i - 1] + _haversineKm(p0[1], p0[0], p1[1], p1[0]));
    }
    return cum;
  }
  function projectOnPolyline(point, coords, cumKm) {
    if (!coords || coords.length < 2) {
      return { offKm: Infinity, kmFromOrigin: 0, totalKm: 0 };
    }
    var cum = (cumKm && cumKm.length === coords.length) ? cumKm : cumulativePolylineKm(coords);
    var totalKm = cum[cum.length - 1];
    var bestOff = Infinity, bestKm = 0;
    for (var i = 0; i < coords.length - 1; i++) {
      var lng1 = coords[i][0], lat1 = coords[i][1];
      var lng2 = coords[i+1][0], lat2 = coords[i+1][1];
      var segLen = cum[i+1] - cum[i];
      if (segLen < 1e-6) continue;
      var cLat = (lat1 + lat2) / 2;
      var cLng = (lng1 + lng2) / 2;
      var A = _toXY({ lat: lat1, lng: lng1 }, cLat, cLng);
      var B = _toXY({ lat: lat2, lng: lng2 }, cLat, cLng);
      var P = _toXY(point, cLat, cLng);
      var dx = B.x - A.x, dy = B.y - A.y;
      var len2 = dx*dx + dy*dy;
      if (len2 < 1e-9) continue;
      var t = ((P.x - A.x) * dx + (P.y - A.y) * dy) / len2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      var cx = A.x + t * dx, cy = A.y + t * dy;
      var ex = P.x - cx, ey = P.y - cy;
      var off = Math.sqrt(ex*ex + ey*ey);
      if (off < bestOff) {
        bestOff = off;
        bestKm = cum[i] + t * segLen;
      }
    }
    return { offKm: bestOff, kmFromOrigin: bestKm, totalKm: totalKm };
  }

  // Copia literal de planFuelStops() en pure.ts. Ver alli para la explicacion
  // completa del algoritmo.
  function planFuelStops(input) {
    var routeKm = input.routeKm;
    var tankL = input.tankL;
    var cons = input.consumoL100km;
    var fuelPct = input.currentFuelPct;
    var safety = input.safetyPct != null ? input.safetyPct : 0.10;
    var stations = input.stations || [];
    var empty = { stops: [], unreachable: false, maxAutonomyKm: 0, initialRangeKm: 0, totalCostEur: 0 };
    if (!isFinite(routeKm)  || routeKm  <= 0) return empty;
    if (!isFinite(tankL)    || tankL    <= 0) return empty;
    if (!isFinite(cons)     || cons     <= 0) return empty;
    if (!isFinite(fuelPct)) fuelPct = 0;
    if (fuelPct < 0) fuelPct = 0; else if (fuelPct > 1) fuelPct = 1;
    if (!isFinite(safety)) safety = 0.10;
    if (safety < 0) safety = 0; else if (safety > 0.5) safety = 0.5;

    var maxAutonomyKm = (tankL / cons) * 100;
    var safetyKm = maxAutonomyKm * safety;
    var initialRangeKm = maxAutonomyKm * fuelPct;

    var pool = stations.filter(function(s) {
      return s && isFinite(s.kmFromOrigin) && s.kmFromOrigin >= 0
          && s.kmFromOrigin <= routeKm
          && isFinite(s.priceEurL) && s.priceEurL > 0;
    }).slice().sort(function(a, b) { return a.kmFromOrigin - b.kmFromOrigin; });

    var pos = 0;
    var rangeKm = initialRangeKm;
    var stops = [];
    var totalCost = 0;

    for (var iter = 0; iter < 50; iter++) {
      var remaining = routeKm - pos;
      if (rangeKm - safetyKm >= remaining) break;
      var windowStart = pos;
      var windowEnd = pos + Math.max(0, rangeKm - safetyKm);
      var candidates = pool.filter(function(s) {
        return s.kmFromOrigin > windowStart && s.kmFromOrigin <= windowEnd;
      });
      if (candidates.length === 0) {
        return {
          stops: stops,
          unreachable: true,
          maxAutonomyKm: maxAutonomyKm,
          initialRangeKm: initialRangeKm,
          totalCostEur: totalCost
        };
      }
      // "Farthest-among-reasonably-cheap": avanzar lo maximo posible por parada
      // (menos paradas totales) pero restringido a estaciones dentro del 5%
      // del precio mas barato del tramo. Ver pure.ts para la explicacion.
      var minPrice = Infinity;
      for (var mi = 0; mi < candidates.length; mi++) {
        if (candidates[mi].priceEurL < minPrice) minPrice = candidates[mi].priceEurL;
      }
      var priceThreshold = minPrice * 1.05;
      var cheap = candidates.filter(function(c) { return c.priceEurL <= priceThreshold; });
      cheap.sort(function(a, b) { return b.kmFromOrigin - a.kmFromOrigin; });
      var pick = cheap[0];
      stops.push({ item: pick.item, kmFromOrigin: pick.kmFromOrigin, priceEurL: pick.priceEurL });
      var consumedKm = pick.kmFromOrigin - pos;
      var consumedL = (consumedKm / 100) * cons;
      totalCost += consumedL * pick.priceEurL;
      pos = pick.kmFromOrigin;
      rangeKm = maxAutonomyKm;
    }
    return {
      stops: stops,
      unreachable: false,
      maxAutonomyKm: maxAutonomyKm,
      initialRangeKm: initialRangeKm,
      totalCostEur: totalCost
    };
  }

  // Bbox que envuelve la polilinea REAL de la ruta + margen. 1 grado lat
  // ~ 111 km; 1 grado lng ~ 111 * cos(lat) km. Margen = max(width*3, 15 km).
  function polylineBbox(coords, widthKm) {
    var minLat = Infinity, maxLat = -Infinity;
    var minLng = Infinity, maxLng = -Infinity;
    for (var i = 0; i < coords.length; i++) {
      var lng = coords[i][0], lat = coords[i][1];
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
    var centerLat = (minLat + maxLat) / 2;
    var marginKm = Math.max(widthKm * 3, 15);
    var dLat = marginKm / 111;
    var dLng = marginKm / (111 * Math.max(0.3, Math.cos(centerLat * Math.PI / 180)));
    return {
      minLat: minLat - dLat,
      maxLat: maxLat + dLat,
      minLng: minLng - dLng,
      maxLng: maxLng + dLng
    };
  }

  // Bloque "Abrir la ruta completa en..." — 3 botones uno al lado del otro.
  // Google y Apple Maps van con paradas (waypoints); Waze solo acepta destino.
  // Si falta from/to (render inicial antes de entrar en modo-ruta), omitimos
  // el bloque; se re-renderiza cuando el flujo llega a enterRouteMode.
  function renderNavButtons(from, to, stops) {
    if (!from || !to) return '';
    var gUrl = googleMapsRouteUrl(from, to, stops);
    var aUrl = appleMapsRouteUrl(from, to, stops);
    var wUrl = wazeRouteUrl(to);
    var hasStops = stops && stops.length > 0;
    // Google y Apple llevan todas las paradas como waypoints. Waze no lo
    // soporta via deep-link (solo acepta un destino), asi que solo el destino
    // final. Lo decimos claramente para que el usuario no crea que es un bug.
    var footnote = hasStops
      ? '<div class="route-nav-note">Google Maps y Apple Maps abren la ruta con todas las gasolineras como paradas. Waze no admite paradas m\u00FAltiples v\u00EDa enlace, as\u00ED que solo abre el destino final.</div>'
      : '';
    return '<div class="route-nav-title">Abrir ruta en:</div>'
         + '<div class="route-nav-buttons">'
         + '  <a href="' + gUrl + '" target="_blank" rel="noopener" class="route-nav-btn route-nav-google">Google Maps</a>'
         + '  <a href="' + aUrl + '" target="_blank" rel="noopener" class="route-nav-btn route-nav-apple">Apple Maps</a>'
         + '  <a href="' + wUrl + '" target="_blank" rel="noopener" class="route-nav-btn route-nav-waze">Waze</a>'
         + '</div>'
         + footnote;
  }

  function renderPlanSection(plan_result, fuelLabel, autonomyKm, from, to) {
    var header = '<div class="route-plan-title">&#x26FD; Plan de repostajes</div>'
               + '<div class="route-plan-subtitle">Autonom\u00EDa: ' + Math.round(autonomyKm) + ' km</div>';

    if (plan_result.unreachable) {
      // Muestra el ultimo punto alcanzado para que el usuario entienda donde
      // "se rompe" el plan. Ya no pedimos al usuario que ampl\u00EDe corredor
      // o suba autonomia (no hay inputs para eso): el auto-retry ya probo
      // hasta 10 km; si sigue sin completar es problema real de cobertura,
      // no de configuracion. Sugerimos cambiar el coche (perfil) o la ruta.
      var lastKm = plan_result.stops.length > 0
                   ? Math.round(plan_result.stops[plan_result.stops.length - 1].kmFromOrigin)
                   : 0;
      var where = lastKm > 0
                  ? ('A partir del km ' + lastKm + ' no hay gasolineras dentro del alcance de tu coche. ')
                  : 'No hay gasolineras alcanzables desde el origen con tu autonom\u00EDa. ';
      return header + '<div class="route-plan-warning">\u26A0\uFE0F ' + where
           + 'Revisa en tu perfil el dep\u00F3sito y consumo, o prueba con otro origen/destino.</div>';
    }
    if (plan_result.stops.length === 0) {
      return header
           + '<div class="route-plan-success">\u2705 No necesitas repostar. '
           + 'Puedes completar la ruta con la autonom\u00EDa actual.</div>'
           + renderNavButtons(from, to, []);
    }
    // Cada parada: info solo (sin link individual a ningun navegador). La
    // ruta completa con todas las paradas se abre desde los 3 botones de
    // "Abrir ruta en:" al final del panel.
    var itemsHtml = plan_result.stops.map(function(stop, i) {
      var s = stop.item;
      return '<div class="route-plan-stop">'
        + '<div class="route-plan-info">'
        + '  <div class="route-plan-badge">' + (i + 1) + '</div>'
        + '  <div class="route-plan-main">'
        + '    <div class="route-plan-title2">' + esc(s['Rotulo'] || 'Gasolinera') + '</div>'
        + '    <div class="route-plan-sub">\u{1F4CD} ' + esc((s['Direccion'] || '') + ', ' + (s['Municipio'] || '')) + '</div>'
        + '  </div>'
        + '</div>'
        + '<div class="route-plan-right">'
        + '  <div class="route-plan-price">' + stop.priceEurL.toFixed(3) + ' \u20AC</div>'
        + '  <div class="route-plan-km">a ' + Math.round(stop.kmFromOrigin) + ' km</div>'
        + '</div>'
        + '</div>';
    }).join('');
    return header + itemsHtml + renderNavButtons(from, to, plan_result.stops);
  }

  async function doSearch() {
    if (!fromSel || !toSel) {
      stat.textContent = 'Selecciona origen y destino de la lista de sugerencias.';
      stat.classList.add('error');
      return;
    }
    // Tank + consumo salen DIRECTAMENTE del perfil. Si falta cualquiera de
    // los dos no podemos planificar (no hay forma de saber la autonomia),
    // asi que abortamos con un mensaje claro. La UI del modal ya ensena un
    // link a "configurar perfil" en refreshProfileBox(), aqui es defensa.
    var vehicle = readProfileVehicle();
    if (!vehicle) {
      stat.textContent = 'Configura tu perfil (dep\u00F3sito y consumo) antes de planificar una ruta.';
      stat.classList.add('error');
      return;
    }
    var autonomyKm = vehicle.autonomyKm;
    stat.classList.remove('error');
    stat.textContent = 'Calculando ruta por carretera\u2026';
    plan.innerHTML = '';
    res.innerHTML = '';
    // Corridor width inicial (km). No lo pide al usuario: 5 km cubre bien
    // autopistas sin arrastrar gasolineras de carreteras lejanas. El
    // auto-retry mas abajo amplia a 7/10 si el plan sale corto.
    var width = DEFAULT_CORRIDOR_WIDTH_KM;
    var fuel = document.getElementById('sel-combustible').value;
    var fuelLabel = (document.getElementById('sel-combustible').selectedOptions[0].text) || fuel;

    try {
      // 1. /api/route → ruta real por carretera (proxy OSRM cacheado 24h).
      var routeUrl = '/api/route?fromLat=' + fromSel.lat.toFixed(6)
                   + '&fromLng=' + fromSel.lng.toFixed(6)
                   + '&toLat=' + toSel.lat.toFixed(6)
                   + '&toLng=' + toSel.lng.toFixed(6);
      var rr = await fetch(routeUrl, { credentials: 'same-origin' });
      if (!rr.ok) {
        if (rr.status === 429) {
          stat.textContent = 'Demasiadas peticiones de ruta. Espera un momento y prueba de nuevo.';
        } else if (rr.status === 422) {
          stat.textContent = 'No se pudo calcular la ruta entre esos puntos. Prueba otro origen/destino.';
        } else {
          stat.textContent = 'No se pudo calcular la ruta. Prueba de nuevo en unos segundos.';
        }
        stat.classList.add('error');
        return;
      }
      var route = await rr.json();
      var coords = route && Array.isArray(route.coordinates) ? route.coordinates : null;
      if (!coords || coords.length < 2) {
        stat.textContent = 'Ruta no disponible para ese trayecto.';
        stat.classList.add('error');
        return;
      }
      var cum = cumulativePolylineKm(coords);
      var totalKm = cum[cum.length - 1];

      // 2. Bbox que envuelve la polilinea real → /api/estaciones/bbox.
      //    IMPORTANTE: dimensionamos el bbox con el ancho MAXIMO de reintento
      //    (10 km), no con el ancho inicial del usuario. Asi podemos ampliar
      //    el corredor en memoria (sin re-fetchear) si el primer plan sale
      //    incompleto porque el usuario eligio un corredor muy estrecho.
      var MAX_RETRY_WIDTH = 10;
      var bboxWidthKm = Math.max(width, MAX_RETRY_WIDTH);
      var bbox = polylineBbox(coords, bboxWidthKm);
      stat.textContent = 'Ruta ' + totalKm.toFixed(0) + ' km. Cargando estaciones del trayecto\u2026';
      var bboxUrl = '/api/estaciones/bbox?minLat=' + bbox.minLat.toFixed(4)
                  + '&maxLat=' + bbox.maxLat.toFixed(4)
                  + '&minLng=' + bbox.minLng.toFixed(4)
                  + '&maxLng=' + bbox.maxLng.toFixed(4);
      var r = await fetch(bboxUrl, { credentials: 'same-origin' });
      if (!r.ok) {
        stat.textContent = 'No se pudieron cargar estaciones para esa ruta.';
        stat.classList.add('error');
        return;
      }
      var data = await r.json();
      var pool = (data.ListaEESSPrecio || []).map(normalizeStation);

      if (pool.length === 0) {
        stat.textContent = 'Sin estaciones en la zona del trayecto.';
        stat.classList.add('error');
        return;
      }

      // 3. Para cada estacion del bbox: proyecta sobre la POLILINEA REAL (no
      //    sobre linea recta). Guardamos el array "projected" completo para
      //    poder re-filtrar por anchos distintos sin re-proyectar (el 99% del
      //    coste CPU del tramo 3-4 es la proyeccion).
      var projected = [];
      for (var k = 0; k < pool.length; k++) {
        var s = pool[k];
        var pos = stationLatLng(s);
        if (!pos) continue;
        var price = parsePrice(s[fuel]);
        if (!price) continue;
        var proj = projectOnPolyline({ lat: pos.lat, lng: pos.lng }, coords, cum);
        projected.push({
          item: s,
          kmFromOrigin: proj.kmFromOrigin,
          offKm: proj.offKm,
          priceEurL: price
        });
      }
      function corridorAt(w) {
        return projected.filter(function(p) { return p.offKm <= w; });
      }
      var corridor = corridorAt(width);

      // Si ni siquiera el corredor maximo (10 km) tiene estaciones para el
      // combustible seleccionado, abortamos con un mensaje claro.
      if (corridorAt(10).length === 0) {
        stat.textContent = 'Sin gasolineras con ' + fuelLabel + ' cerca del trayecto.';
        stat.classList.add('error');
        return;
      }

      // 4. Planifica paradas. El dato autoritativo es la AUTONOMIA declarada
      // por el usuario en el perfil (vehicle.autonomyKm). tank y consumo
      // son secundarios: planFuelStops internamente calcula
      // maxAutonomyKm = (tank/cons)*100, asi que derivamos un consumo
      // EFECTIVO que satisface la ecuacion con el tank del perfil. Esto
      // garantiza que el planificador respeta la autonomia del usuario
      // independientemente de lo que diga el slider de consumo.
      var tankL = vehicle.tank;
      var consumoL100km = (vehicle.tank * 100) / autonomyKm;

      // Diagnostico: imprime los parametros usados por el planificador para que
      // sea facil verificar que tank/consumo/autonomia llegan con valores
      // razonables cuando el resultado no es el esperado.
      try {
        console.log('[ruta] planifica', {
          routeKm: Math.round(totalKm),
          autonomyKm: autonomyKm,
          tankL: tankL,
          consumoL100km: Number(consumoL100km.toFixed(2)),
          profileConsumo: vehicle.consumo,
          corridorCount: corridor.length,
          corridorWidthKm: width,
          fuel: fuel,
          sourceOfProfile: 'profile'
        });
      } catch (e) { /* sin consola: sigue */ }

      function runPlan(stations) {
        return planFuelStops({
          routeKm: totalKm,
          tankL: tankL,
          consumoL100km: consumoL100km,
          currentFuelPct: 1.0,
          stations: stations
        });
      }

      var planResult = runPlan(corridor);
      var usedWidth = width;
      var widenedAutomatically = false;

      // Estimamos el numero MINIMO de paradas que deberia tener un plan
      // "razonable" para esta ruta: cuantas veces hay que repostar sabiendo
      // que el tanque lleno da maxAutonomyKm y que dejamos un 10% de reserva.
      // Si el planificador devuelve MENOS paradas de las esperadas aunque
      // diga unreachable=false, sospechamos que el corredor es demasiado
      // estrecho y forzamos el retry igual.
      var maxAutonomyKm = (tankL / consumoL100km) * 100;
      var usableRangeKm = Math.max(10, maxAutonomyKm * 0.90);
      var initialFullRange = maxAutonomyKm;  // asumimos tanque lleno al salir
      var expectedMinStops = Math.max(0, Math.floor((totalKm - initialFullRange) / usableRangeKm));

      function needsRetry(p) {
        return p.unreachable || p.stops.length < expectedMinStops;
      }

      // Auto-retry: si el plan salio incompleto o con muy pocas paradas,
      // probamos con corredores progresivamente mas anchos. Motivo: las
      // gasolineras de autopista suelen estar a 2-3 km de la ruta (salidas,
      // areas de servicio); con corredor <=2 km entran pocas y el
      // planificador no puede completar trayectos largos. Probamos 3, 5, 7, 10.
      var retryWidths = [3, 5, 7, 10];
      for (var rw = 0; rw < retryWidths.length && needsRetry(planResult); rw++) {
        var w = retryWidths[rw];
        if (w <= usedWidth) continue;  // no retrocedemos
        var corr2 = corridorAt(w);
        if (corr2.length <= corridor.length) continue;  // no aporta estaciones nuevas
        var plan2 = runPlan(corr2);
        try {
          console.log('[ruta] retry', {
            width: w,
            corridor: corr2.length,
            stops: plan2.stops.length,
            unreachable: plan2.unreachable,
            expectedMinStops: expectedMinStops
          });
        } catch (e) {}
        // Nos quedamos con el retry si mejora: completa la ruta, O al menos
        // encuentra mas paradas que el intento anterior (acercandose al esperado).
        if (!plan2.unreachable || plan2.stops.length > planResult.stops.length) {
          planResult = plan2;
          corridor = corr2;
          usedWidth = w;
          widenedAutomatically = true;
          // Si ya completa Y tiene el numero esperado de paradas, paramos.
          if (!plan2.unreachable && plan2.stops.length >= expectedMinStops) break;
        }
      }

      try {
        console.log('[ruta] resultado', {
          stops: planResult.stops.length,
          unreachable: planResult.unreachable,
          maxAutonomyKm: Math.round(planResult.maxAutonomyKm),
          totalCostEur: Number(planResult.totalCostEur.toFixed(2)),
          finalCorridorWidthKm: usedWidth,
          widenedAutomatically: widenedAutomatically
        });
      } catch (e) { /* idem */ }

      // Mensaje de estado. Si el auto-retry tuvo que ampliar el corredor,
      // lo mencionamos discretamente (para que se entienda por que algunas
      // gasolineras no son pegadas a la autopista) pero sin culpar al usuario
      // — el ancho es una decision interna que ya no controla.
      var widthNote = widenedAutomatically
        ? ' \u00B7 corredor ampliado a ' + usedWidth + ' km para encontrar gasolineras'
        : '';
      stat.textContent = 'Ruta ' + totalKm.toFixed(0) + ' km \u00B7 ' + corridor.length + ' estaciones en el corredor \u00B7 ' + planResult.stops.length + ' paradas recomendadas.' + widthNote;
      // Renderizado inicial del plan SIN botones de navegacion para feedback
      // inmediato. Se re-renderiza con botones justo despues de enterRouteMode,
      // cuando tenemos confirmados from/to/stops definitivos.
      plan.innerHTML = renderPlanSection(planResult, fuelLabel, autonomyKm, null, null);

      // 5. Si hay paradas, pide a OSRM una SEGUNDA ruta que pase por las
      // gasolineras como waypoints intermedios. Asi la polilinea en el mapa
      // hace el desvio por cada gasolinera en vez de ignorarla. OSRM une los
      // tramos en una sola polilinea; la cacheamos 24h junto a la directa.
      var finalCoords = coords;
      var finalTotalKm = totalKm;
      if (planResult.stops.length > 0) {
        stat.textContent = 'Dibujando ruta con paradas\u2026';
        try {
          var stopsParam = planResult.stops.map(function(stop) {
            var ll = stationLatLng(stop.item);
            return ll ? (ll.lat.toFixed(6) + ',' + ll.lng.toFixed(6)) : '';
          }).filter(function(s) { return s; }).join(';');
          if (stopsParam) {
            var routeWithStopsUrl = '/api/route?fromLat=' + fromSel.lat.toFixed(6)
                                  + '&fromLng=' + fromSel.lng.toFixed(6)
                                  + '&toLat=' + toSel.lat.toFixed(6)
                                  + '&toLng=' + toSel.lng.toFixed(6)
                                  + '&stops=' + encodeURIComponent(stopsParam);
            var rr2 = await fetch(routeWithStopsUrl, { credentials: 'same-origin' });
            if (rr2.ok) {
              var route2 = await rr2.json();
              if (route2 && Array.isArray(route2.coordinates) && route2.coordinates.length >= 2) {
                finalCoords = route2.coordinates;
                if (typeof route2.distanceKm === 'number') finalTotalKm = route2.distanceKm;
              }
            }
            // Si falla la segunda llamada (rate limit, 503), caemos a la ruta
            // directa: mejor ensenar algo razonable que bloquear al usuario.
          }
        } catch (e) { /* fallback silencioso a coords originales */ }
      }

      // 6. Entra en modo-ruta en el mapa: polilinea (posiblemente ya con
      // waypoints) + SOLO las paradas recomendadas (el usuario pidio
      // explicitamente ver solo las que debe repostar). Pasamos fromSel/toSel
      // para construir los deep-links a Google/Apple/Waze Maps.
      enterRouteMode(finalCoords, planResult.stops, fromSel, toSel);

      // Re-renderiza el plan con el bloque de botones de navegacion ahora
      // que tenemos from/to disponibles.
      plan.innerHTML = renderPlanSection(planResult, fuelLabel, autonomyKm, fromSel, toSel);

      // Actualiza el texto del banner flotante con informacion de la ruta.
      // Si hubo que ampliar el corredor automaticamente, lo decimos en el
      // banner tambien (el modal se cerrara enseguida).
      var barText = document.getElementById('route-mode-bar-text');
      if (barText) {
        var stopsLabel;
        if (planResult.unreachable) {
          stopsLabel = 'ruta no completable con tu autonom\u00EDa';
        } else if (planResult.stops.length === 0) {
          stopsLabel = 'sin paradas (autonom\u00EDa suficiente)';
        } else if (planResult.stops.length === 1) {
          stopsLabel = '1 parada recomendada';
        } else {
          stopsLabel = planResult.stops.length + ' paradas recomendadas';
        }
        var widenMsg = widenedAutomatically
          ? ' \u00B7 corredor ' + usedWidth + ' km (ampliado)'
          : '';
        barText.textContent = 'Ruta ' + finalTotalKm.toFixed(0) + ' km \u00B7 ' + stopsLabel + widenMsg;
      }

      // 7. Cierra el modal para que el usuario vea el mapa con la ruta.
      closeRoute();
    } catch (err) {
      stat.textContent = 'Error al buscar. Prueba de nuevo.';
      stat.classList.add('error');
    }
  }
  btnGo.addEventListener('click', doSearch);
})();

// ============================================================
// ===== DIARIO DE REPOSTAJES (Feature 5) =====================
// ============================================================
// Registro local (localStorage) de repostajes con calculo de consumo real
// L/100km y gasto mensual. Exporta CSV. Privacidad total — nada sale del
// navegador. La clave es 'gs_diary_v1': array de { date, litros, eurPerLitre,
// kmTotales } ordenado cronologicamente.
(function() {
  var modal  = document.getElementById('modal-diary');
  if (!modal) return;
  var btnOpen   = document.getElementById('btn-diary');
  var btnClose  = document.getElementById('btn-diary-close');
  var btnDone   = document.getElementById('btn-diary-done');
  var btnAdd    = document.getElementById('btn-diary-add');
  var btnExport = document.getElementById('btn-diary-export');
  var btnClear  = document.getElementById('btn-diary-clear');
  var inL       = document.getElementById('diary-litros');
  var inP       = document.getElementById('diary-price');
  var inK       = document.getElementById('diary-km');
  var inD       = document.getElementById('diary-date');
  var listWrap  = document.getElementById('diary-list');
  var emptyWrap = document.getElementById('diary-empty');

  var DIARY_KEY = 'gs_diary_v1';
  function getDiary() {
    try { return JSON.parse(localStorage.getItem(DIARY_KEY) || '[]'); } catch(e) { return []; }
  }
  function setDiary(arr) {
    try { localStorage.setItem(DIARY_KEY, JSON.stringify(arr)); } catch(e) {}
  }

  // Funcion pura duplicada — tests cubren la version canonica en pure.ts.
  function diaryStats(entries) {
    var clean = (entries || []).filter(function(e) {
      return e && typeof e.date === 'string'
        && isFinite(e.litros)      && e.litros      > 0
        && isFinite(e.eurPerLitre) && e.eurPerLitre > 0
        && isFinite(e.kmTotales)   && e.kmTotales   >= 0;
    }).sort(function(a, b) { return a.date.localeCompare(b.date); });
    if (clean.length === 0) {
      return { entries: 0, totalLiters: 0, totalSpentEur: 0, avgEurPerLitre: null, totalKm: 0, avgL100km: null };
    }
    var tL = 0, tS = 0, sEpl = 0;
    for (var i = 0; i < clean.length; i++) {
      tL += clean[i].litros;
      tS += clean[i].litros * clean[i].eurPerLitre;
      sEpl += clean[i].eurPerLitre;
    }
    var totalKm = clean[clean.length - 1].kmTotales - clean[0].kmTotales;
    var litersForCons = 0;
    for (var j = 1; j < clean.length; j++) litersForCons += clean[j].litros;
    var avgL100km = totalKm > 0 && litersForCons > 0 ? litersForCons / (totalKm / 100) : null;
    return {
      entries: clean.length,
      totalLiters: tL,
      totalSpentEur: tS,
      avgEurPerLitre: sEpl / clean.length,
      totalKm: totalKm > 0 ? totalKm : 0,
      avgL100km: avgL100km
    };
  }

  function fmtDate(iso) {
    // Formatea YYYY-MM-DD a "dd/mm/yyyy" para display. Defensivo ante inputs raros.
    if (!iso || iso.length < 10) return iso || '';
    var y = iso.slice(0, 4), m = iso.slice(5, 7), d = iso.slice(8, 10);
    return d + '/' + m + '/' + y;
  }

  function renderStats() {
    var s = diaryStats(getDiary());
    document.getElementById('ds-entries').textContent = s.entries;
    document.getElementById('ds-spent').textContent   = s.totalSpentEur.toFixed(2) + ' \u20AC';
    document.getElementById('ds-avg').textContent     = s.avgEurPerLitre ? s.avgEurPerLitre.toFixed(3) + ' \u20AC/L' : '--';
    document.getElementById('ds-km').textContent      = s.totalKm.toFixed(0) + ' km';
    document.getElementById('ds-cons').textContent    = s.avgL100km ? s.avgL100km.toFixed(1) + ' L/100km' : '--';
    document.getElementById('ds-liters').textContent  = s.totalLiters.toFixed(1) + ' L';
  }

  function renderList() {
    var entries = getDiary().slice().sort(function(a, b) { return b.date.localeCompare(a.date); });
    if (entries.length === 0) {
      emptyWrap.style.display = '';
      listWrap.innerHTML = '';
      return;
    }
    emptyWrap.style.display = 'none';
    listWrap.innerHTML = entries.map(function(e) {
      return '<div class="diary-item">'
        + '<div class="diary-item-main">'
        + '  <div class="diary-item-date">' + esc(fmtDate(e.date)) + ' \u00B7 ' + e.litros.toFixed(2) + ' L'
        + '    <span class="diary-item-sub">a ' + e.eurPerLitre.toFixed(3) + ' \u20AC/L \u00B7 ' + (e.litros * e.eurPerLitre).toFixed(2) + ' \u20AC</span>'
        + '  </div>'
        + '  <div class="diary-item-sub">Odometro: ' + e.kmTotales.toFixed(0) + ' km</div>'
        + '</div>'
        + '<button class="diary-item-del" data-diary-del="' + esc(e.date + '|' + e.kmTotales) + '" aria-label="Borrar repostaje">\u2716</button>'
        + '</div>';
    }).join('');
  }

  function openDiary() {
    // Fecha por defecto: hoy (YYYY-MM-DD).
    try { inD.value = new Date().toISOString().slice(0, 10); } catch(_) {}
    renderStats();
    renderList();
    modal.classList.add('show');
  }
  function closeDiary() { modal.classList.remove('show'); }

  btnOpen.addEventListener('click', openDiary);
  btnClose.addEventListener('click', closeDiary);
  btnDone.addEventListener('click', closeDiary);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeDiary(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeDiary();
  });

  btnAdd.addEventListener('click', function() {
    var l = parseFloat((inL.value || '').replace(',', '.'));
    var p = parseFloat((inP.value || '').replace(',', '.'));
    var k = parseFloat((inK.value || '').replace(',', '.'));
    var d = (inD.value || '').trim();
    if (!isFinite(l) || l <= 0) { showToast('Litros invalidos', 'warning'); return; }
    if (!isFinite(p) || p <= 0) { showToast('Precio \u20AC/L invalido', 'warning'); return; }
    if (!isFinite(k) || k < 0)  { showToast('Odometro invalido', 'warning'); return; }
    if (!d || !/^\\d{4}-\\d{2}-\\d{2}$/.test(d)) { showToast('Fecha invalida', 'warning'); return; }
    var arr = getDiary();
    arr.push({ date: d, litros: l, eurPerLitre: p, kmTotales: k });
    arr.sort(function(a, b) { return a.date.localeCompare(b.date); });
    setDiary(arr);
    inL.value = ''; inP.value = ''; inK.value = '';
    renderStats();
    renderList();
    showToast('Repostaje guardado \u2713', 'success');
  });

  // Borrado via delegacion — data-diary-del="date|km" identifica la entrada
  // sin inventar un id. Colisiones solo posibles si dos repostajes con mismo
  // dia y mismo km total: casi imposible y sin consecuencias.
  listWrap.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-diary-del]');
    if (!btn) return;
    var key = btn.getAttribute('data-diary-del') || '';
    var parts = key.split('|');
    if (parts.length !== 2) return;
    var dt = parts[0], km = parseFloat(parts[1]);
    var arr = getDiary();
    var idx = -1;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].date === dt && Math.abs(arr[i].kmTotales - km) < 0.5) { idx = i; break; }
    }
    if (idx < 0) return;
    arr.splice(idx, 1);
    setDiary(arr);
    renderStats();
    renderList();
    showToast('Repostaje eliminado', 'info');
  });

  btnExport.addEventListener('click', function() {
    var entries = getDiary();
    if (entries.length === 0) { showToast('No hay entradas para exportar', 'warning'); return; }
    // CSV: cabeceras en castellano, separador coma, decimal punto (compatible
    // con Excel en locale EN y la mayoria de herramientas). Escapamos strings
    // con comillas si llevaran coma — nuestros campos son numericos/ISO asi que
    // no hay riesgo actual.
    var lines = ['fecha,litros,eur_por_litro,km_totales,coste_total_eur'];
    entries.slice().sort(function(a, b) { return a.date.localeCompare(b.date); }).forEach(function(e) {
      lines.push([
        e.date,
        e.litros.toFixed(2),
        e.eurPerLitre.toFixed(3),
        e.kmTotales.toFixed(0),
        (e.litros * e.eurPerLitre).toFixed(2)
      ].join(','));
    });
    var blob = new Blob([lines.join('\\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'diario-repostajes-' + new Date().toISOString().slice(0,10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); a.remove(); }, 500);
  });

  btnClear.addEventListener('click', function() {
    if (!confirm('Borrar todos los repostajes del diario? Esta accion no se puede deshacer.')) return;
    setDiary([]);
    renderStats();
    renderList();
    showToast('Diario borrado', 'info');
  });
})();

// ---- VERSION visible en consola (ayuda a diagnosticar sin ingenieria inversa) ----
try { console.info('%cGasolineras Espana v' + APP_VER, 'color:#16a34a;font-weight:bold'); } catch(_) {}
</script>`
}
