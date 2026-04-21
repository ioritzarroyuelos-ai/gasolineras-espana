export const clientCoreScript = `
// ============================================================
// ===== ERROR REPORTER (Nivel 1: deteccion) =====
// ============================================================
// Hookea los dos buses de error no-handleados del navegador y POSTea cada
// incidencia a /api/client-error. El servidor dedupe por fingerprint y persiste
// en D1. Un cron de GitHub Actions cada 8h lee esta tabla y notifica Telegram.
//
// Guardrails anti-ruido:
// - Dedupe cliente 10s por fingerprint (msg + primera linea stack). Evita que
//   un error en un loop (p.ej. re-render bucle) mande 1000 POSTs en 1s.
// - Filtro de ruido conocido: ResizeObserver loop, extensiones de terceros
//   (safari-extension://, chrome-extension://), canceled fetches. No es
//   nuestro problema.
// - keepalive: true en el fetch -> el navegador persiste el envio aunque la
//   pestana se cierre (ideal para errores fatales durante navegacion).
//
// Ship 13 enriquecimiento:
// - window.__crumbs: ring buffer de las ultimas 8 acciones (click target,
//   navegacion, modal open/close, network failures). Se incluye en el payload
//   como 'breadcrumbs' para debug determinista.
// - module: identificado heuristicamente del stack. map.js / list.js /
//   features.js tienen frames con 'features' en la URL; core/ui se identifican
//   por keywords conocidas (initModalFocusTrap, showToast, etc.).
// - context: {prov, mun, fuel, online} — metadatos que permiten agrupar
//   errores "solo en ruta X" sin tener que parsear la URL del reporter.
(function initErrorReporter() {
  var lastSent = Object.create(null);
  function hashCode(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return (h >>> 0).toString(36);
  }
  // ---- Ship 13: breadcrumbs — ring buffer expuesto en window.__crumbs ----
  // Cualquier modulo puede empujar eventos con window.__addCrumb('evt:tag').
  // El reporter los consume on-error. Maximo 8 entradas, se descartan las mas
  // viejas. Las lineas son strings cortas para minimizar payload (<500 bytes).
  var CRUMB_MAX = 8;
  var crumbs = [];
  function addCrumb(tag) {
    if (!tag) return;
    var s = String(tag).slice(0, 80);
    crumbs.push(s);
    if (crumbs.length > CRUMB_MAX) crumbs.shift();
  }
  // Exponemos addCrumb + la lista (read-only clone on-demand).
  window.__addCrumb = addCrumb;
  window.__crumbs = function() { return crumbs.slice(); };

  // Auto-registrado de breadcrumbs comunes: clicks sobre buttons / links con
  // id o clase identificable, cambios de visibility y navegaciones del hash.
  // Los listeners van en capture=true para pillar eventos antes de que el
  // handler del modulo los stope (e.stopPropagation).
  document.addEventListener('click', function(ev) {
    try {
      var t = ev.target;
      if (!t || !t.closest) return;
      var el = t.closest('button,a,[role="button"],input[type="button"],input[type="submit"]');
      if (!el) return;
      var tag = el.tagName ? el.tagName.toLowerCase() : '?';
      var id  = el.id ? ('#' + el.id) : '';
      var cls = (!id && el.className && typeof el.className === 'string')
        ? ('.' + el.className.split(/\\s+/).filter(Boolean).slice(0,2).join('.'))
        : '';
      addCrumb('click:' + tag + (id || cls));
    } catch(_) {}
  }, true);
  document.addEventListener('visibilitychange', function() {
    addCrumb('visibility:' + (document.hidden ? 'hidden' : 'visible'));
  });
  window.addEventListener('online',  function() { addCrumb('net:online'); });
  window.addEventListener('offline', function() { addCrumb('net:offline'); });

  // Ruido conocido: usamos indexOf para evitar quebraderos de cabeza con
  // regex escapes dentro del template literal del wrapper (en \`...\` los
  // \\ se comen y las barras cierran el regex antes de tiempo).
  function isNoise(msg, stack) {
    if (!msg) return true;
    var ml = String(msg).toLowerCase();
    if (ml.indexOf('resizeobserver loop') >= 0) return true;   // benigno Chrome
    if (ml === 'script error' || ml === 'script error.') {
      if (!stack) return true;                                 // cross-origin sin info util
    }
    if (ml.indexOf('non-error promise rejection captured') >= 0) return true;
    var s = String(stack || '');
    if (s.indexOf('chrome-extension://') >= 0) return true;    // extensiones terceros
    if (s.indexOf('moz-extension://') >= 0) return true;
    if (s.indexOf('safari-extension://') >= 0) return true;
    return false;
  }
  // ---- Ship 13: infiere el modulo a partir del stack ----
  // Orden de match: (1) URL del frame (features.js → 'features'), (2)
  // keywords inequivocas del stack (buildPopup/initMap → 'map'), (3) fallback.
  function inferModule(stack) {
    if (!stack) return 'unknown';
    var s = String(stack);
    // La URL del asset mas explicita primero.
    if (s.indexOf('/static/features.js') >= 0) return 'features';
    // Keywords: funciones exportadas o nombres muy distintivos por modulo.
    if (/initMap|buildPopup|renderMarkers|createMap|computePricePercentile/.test(s)) return 'map';
    if (/renderList|renderCompareModal|buildCard|addToCompare/.test(s))            return 'list';
    if (/readQueryState|writeQueryState|applyQueryState|loadMunicipios|loadStations/.test(s)) return 'ui';
    if (/initErrorReporter|showToast|initModalFocusTrap|initRUM/.test(s))          return 'core';
    return 'unknown';
  }
  // ---- Ship 13: context de la sesion (ruta, filtros, red) ----
  function snapshotContext() {
    var ctx = { path: location.pathname };
    try {
      var seo = window.__SEO__;
      if (seo && seo.provinciaSlug) ctx.prov = seo.provinciaSlug;
      if (seo && seo.municipioSlug) ctx.mun  = seo.municipioSlug;
    } catch(_) {}
    try {
      var selP = document.getElementById('sel-provincia');
      if (selP && selP.value && !ctx.prov) ctx.prov = selP.value;
      var selM = document.getElementById('sel-municipio');
      if (selM && selM.value && !ctx.mun) ctx.mun = selM.value;
      var selF = document.getElementById('sel-combustible');
      if (selF && selF.value) {
        // Solo el sufijo corto: "Precio Gasolina 95 E5" → "95 E5". Ahorra bytes.
        var v = String(selF.value).replace(/^Precio\\s+/i, '').slice(0, 40);
        ctx.fuel = v;
      }
    } catch(_) {}
    try {
      if (typeof navigator.onLine === 'boolean') ctx.online = navigator.onLine;
    } catch(_) {}
    return ctx;
  }
  function send(err) {
    try {
      var msg = '';
      var stack = '';
      if (err && typeof err === 'object') {
        msg = String(err.message || err.reason || err);
        stack = String(err.stack || '');
      } else {
        msg = String(err);
      }
      if (isNoise(msg, stack)) return;
      var firstLine = (stack.split('\\n')[0] || '').substring(0, 200);
      var fp = hashCode(msg + '|' + firstLine);
      var now = Date.now();
      if (lastSent[fp] && now - lastSent[fp] < 10000) return;
      lastSent[fp] = now;
      // Ship 13: adjuntamos module / breadcrumbs / context al payload.
      // breadcrumbs se serializa a JSON string (max 500 chars tras trim).
      // context idem a 200 chars.
      var bcStr = '';
      try { bcStr = JSON.stringify(crumbs); if (bcStr.length > 500) bcStr = bcStr.slice(0, 500); } catch(_) {}
      var ctxStr = '';
      try { ctxStr = JSON.stringify(snapshotContext()); if (ctxStr.length > 200) ctxStr = ctxStr.slice(0, 200); } catch(_) {}
      var body = JSON.stringify({
        message: msg.substring(0, 500),
        stack: stack.substring(0, 4000),
        url: location.pathname,
        version: APP_VER,
        module: inferModule(stack),
        breadcrumbs: bcStr || undefined,
        context: ctxStr || undefined
      });
      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'same-origin'
      }).catch(function() { /* swallow — no queremos loop infinito de errores */ });
    } catch (e) { /* swallow */ }
  }
  window.addEventListener('error', function(ev) {
    send(ev.error || { message: ev.message, stack: (ev.filename||'') + ':' + (ev.lineno||0) });
  });
  window.addEventListener('unhandledrejection', function(ev) {
    var r = ev.reason;
    if (r && typeof r === 'object') send(r);
    else send({ message: 'unhandled rejection: ' + String(r), stack: '' });
  });
})();

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
  // Timeout por intento via AbortController. Sin esto, una conexion lenta/colgada
  // (DNS stall, TCP sin ACK, movil con mala cobertura) dejaba el fetch pendiente
  // indefinidamente: los 3 reintentos nunca arrancaban porque ninguno terminaba,
  // y los skeletons de la UI se quedaban pintados para siempre porque el finally
  // de loadStations() nunca corria. 8s por intento + 1.5s backoff = ~30s max.
  var lastErr;
  for (var i = 1; i <= 3; i++) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var tid = ctrl ? setTimeout(function() { ctrl.abort(); }, 8000) : 0;
    try {
      var opts = ctrl ? { signal: ctrl.signal } : undefined;
      var res = await fetch(url, opts);
      if (tid) clearTimeout(tid);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (data && data.error) throw new Error(data.error);
      return data;
    } catch(e) {
      if (tid) clearTimeout(tid);
      lastErr = e;
      var reason = (e && e.name === 'AbortError') ? 'timeout 8s' : (e && e.message) || String(e);
      console.warn('[fetchJSON] intento ' + i + ' fallido (' + url + '):', reason);
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

// ============================================================
// ===== prefers-reduced-motion helper (Ship 3 a11y) =====
// ============================================================
// WCAG 2.3.3 — permite a usuarios con vestibular disorder desactivar
// animaciones. El CSS ya tiene un @media (prefers-reduced-motion: reduce)
// global, pero hay 3 animaciones JS-driven que no cubre:
//   1. card.scrollIntoView({behavior: 'smooth'}) en highlightCard — hace
//      scroll animado de la lista al enfocar estacion.
//   2. map.fitBounds({..., animate: true}) — Leaflet anima pan+zoom.
//   3. map.flyTo() — si se usa. Por defecto anima.
// Exponemos window.prefersReducedMotion() para que cada call-site decida.
// Subscribimos a cambios del media query asi el toggle del SO aplica en
// vivo sin recargar.
var PRM_MQ = null;
var PRM_VALUE = false;
try {
  if (window.matchMedia) {
    PRM_MQ = window.matchMedia('(prefers-reduced-motion: reduce)');
    PRM_VALUE = !!PRM_MQ.matches;
    var update = function() { PRM_VALUE = !!PRM_MQ.matches; };
    if (typeof PRM_MQ.addEventListener === 'function') PRM_MQ.addEventListener('change', update);
    else if (typeof PRM_MQ.addListener === 'function') PRM_MQ.addListener(update); // Safari <14
  }
} catch (_) { /* no matchMedia — asumimos no-preference */ }
function prefersReducedMotion() { return PRM_VALUE; }
// Helper publico: resuelve el scroll-behavior segun preferencia. Uso:
//   el.scrollIntoView({ behavior: scrollBehavior('smooth'), block: 'nearest' })
function scrollBehavior(fallback) { return PRM_VALUE ? 'auto' : (fallback || 'smooth'); }
// Opcion compartida para Leaflet fitBounds / setView con animacion
// respetando la preferencia. Se pasa como opts:
//   map.fitBounds(b, Object.assign({}, mapAnimOpts(), { padding: [40,40] }))
function mapAnimOpts() { return { animate: !PRM_VALUE }; }

// Elimina tildes de las claves del objeto estacion (evita problemas de encoding del documento)
function normalizeStation(s) {
  var out = {};
  for (var k in s) {
    out[k.normalize('NFD').replace(/[\u0300-\u036f]/g, '')] = s[k];
  }
  return out;
}

// ============================================================
// ===== FOCUS TRAP para modales (Ship 2 a11y) =====
// ============================================================
// WCAG 2.1 SC 2.4.3 (Focus Order) + 2.1.2 (No Keyboard Trap — ESC sale)
// + 2.4.11 (Focus Appearance).
// Todos los .modal-backdrop[aria-modal="true"] reciben gestion automatica:
//   - Al mostrarse (class "show" anadida), guardamos document.activeElement y
//     enfocamos el primer elemento focusable dentro del modal.
//   - Tab y Shift+Tab ciclan dentro del modal (trap) hasta que se cierre.
//   - Al ocultarse, devolvemos foco al elemento original.
// Implementacion: un MutationObserver observa el atributo 'class' de cada
// modal. Asi no tenemos que instrumentar cada openX()/closeX() existente —
// funciona con modales actuales (profile/favs/route/diary/compare) y con
// futuros nuevos modales mientras mantengan la convencion .modal-backdrop.
(function initModalFocusTrap() {
  var FOCUSABLE = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(',');
  // Mapa modal -> { previousFocus, keydownHandler }. Clave por el node para
  // poder desinstalar el handler correcto si el modal se re-muestra.
  var state = new WeakMap();
  function getFocusable(modal) {
    var nodes = modal.querySelectorAll(FOCUSABLE);
    var out = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      // Ignora ocultos (display:none / visibility:hidden / disabled)
      var rects = el.getClientRects();
      if (rects.length === 0) continue;
      if (el.offsetParent === null && el !== document.activeElement) continue;
      out.push(el);
    }
    return out;
  }
  function onOpen(modal) {
    if (state.has(modal)) return;
    var previous = document.activeElement;
    // Enfoca el primer focusable — o el propio modal si no hay ninguno (con
    // tabindex=-1 temporalmente para que reciba foco programatico).
    var focusables = getFocusable(modal);
    var first = focusables[0];
    if (first) {
      try { first.focus(); } catch (_) {}
    } else {
      modal.setAttribute('tabindex', '-1');
      try { modal.focus(); } catch (_) {}
    }
    function onKeydown(e) {
      if (e.key !== 'Tab') return;
      var list = getFocusable(modal);
      if (list.length === 0) { e.preventDefault(); return; }
      var idx = list.indexOf(document.activeElement);
      if (e.shiftKey) {
        if (idx <= 0) { e.preventDefault(); list[list.length - 1].focus(); }
      } else {
        if (idx === list.length - 1 || idx === -1) { e.preventDefault(); list[0].focus(); }
      }
    }
    modal.addEventListener('keydown', onKeydown);
    state.set(modal, { previous: previous, keydown: onKeydown });
  }
  function onClose(modal) {
    var s = state.get(modal);
    if (!s) return;
    modal.removeEventListener('keydown', s.keydown);
    state.delete(modal);
    // Devolver foco al origen si sigue existiendo y es focusable.
    if (s.previous && document.body.contains(s.previous) && typeof s.previous.focus === 'function') {
      try { s.previous.focus(); } catch (_) {}
    }
  }
  function handleMutation(modal) {
    if (modal.classList.contains('show')) {
      onOpen(modal);
      // Ship 13: breadcrumb automatico al abrir/cerrar cualquier modal.
      // window.__addCrumb puede no existir si initErrorReporter fallo — try/catch.
      try { if (window.__addCrumb) window.__addCrumb('modal:open:' + (modal.id || '?')); } catch(_) {}
    } else {
      onClose(modal);
      try { if (window.__addCrumb) window.__addCrumb('modal:close:' + (modal.id || '?')); } catch(_) {}
    }
  }
  function register(modal) {
    // Si ya esta visible en init, activa el trap inmediatamente.
    if (modal.classList.contains('show')) onOpen(modal);
    var obs = new MutationObserver(function(mutations) {
      for (var i = 0; i < mutations.length; i++) {
        if (mutations[i].attributeName === 'class') { handleMutation(modal); break; }
      }
    });
    obs.observe(modal, { attributes: true, attributeFilter: ['class'] });
  }
  function init() {
    var modals = document.querySelectorAll('.modal-backdrop[aria-modal="true"]');
    for (var i = 0; i < modals.length; i++) register(modals[i]);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

// ============================================================
// ===== Ship 12: REAL USER MONITORING (Core Web Vitals) =====
// ============================================================
// Mide las metricas Web Vitals reales en el navegador del usuario y las
// envia con UN beacon cuando la pagina se oculta (visibilitychange=hidden
// o pagehide — lo que ocurra primero). Una sola request por sesion evita
// inflar el log y captura el mejor valor disponible de cada metrica.
//
// Metricas recolectadas:
//  - LCP (Largest Contentful Paint): toma la MAYOR entry antes del final.
//    Alta fidelidad: PerformanceObserver 'largest-contentful-paint' es la
//    fuente canonica, sin fallback JS.
//  - INP (Interaction to Next Paint): aproximacion via observacion de
//    'event' entries (PerformanceEventTiming). Tomamos el PEOR duration
//    de cualquier interaccion (click/keydown/pointerdown/...). El valor
//    real de INP usa percentil 98 pero para 1 sample por sesion el peor
//    caso es una aproximacion razonable y es lo que web-vitals.js reporta.
//  - CLS (Cumulative Layout Shift): suma de 'layout-shift' entries con
//    hadRecentInput=false (estandar de Web Vitals). Agrupamos en sesiones
//    pero para simplificar tomamos la SUMA TOTAL no-user-initiated.
//  - FCP (First Contentful Paint): 'paint' entry 'first-contentful-paint'.
//  - TTFB (Time to First Byte): performance.getEntriesByType('navigation')
//    [0].responseStart — sin observer.
//
// Privacidad: no enviamos IP (el servidor no la logea), no enviamos IDs,
// no enviamos query strings (solo pathname). El user-agent SI va porque
// lo necesitamos para segmentar por tipo de dispositivo.
//
// Graceful degradation: Safari < 15 no expone LoAF / event timing; en ese
// caso INP queda undefined y el resto se envia igual. Navegadores con
// Performance API nula (< ~2015) no envian nada (early return).
(function initRUM() {
  if (typeof performance === 'undefined' || typeof PerformanceObserver === 'undefined') return;

  var metrics = {
    lcp: undefined,
    inp: undefined,
    cls: 0,        // acumula, se envia al final
    fcp: undefined,
    ttfb: undefined,
  };
  var sent = false;
  var clsHasShifts = false;

  // ---- LCP ----
  // PerformanceObserver con buffered:true para capturar LCPs anteriores al
  // registro del observer (ocurren antes de que el JS se ejecute). El valor
  // definitivo es el de la ULTIMA entry antes de cualquier interaccion del
  // usuario — nos quedamos siempre con el mayor renderTime visto.
  try {
    var lcpObs = new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        var v = e.renderTime || e.loadTime || e.startTime;
        if (v > 0 && (metrics.lcp === undefined || v > metrics.lcp)) metrics.lcp = v;
      }
    });
    lcpObs.observe({ type: 'largest-contentful-paint', buffered: true });
    // Dejar de observar en cuanto el usuario interactua — LCP por spec es
    // valido solo hasta la primera interaccion.
    var stopLCP = function() {
      try { lcpObs.takeRecords(); lcpObs.disconnect(); } catch(_) {}
      removeEventListener('keydown', stopLCP, true);
      removeEventListener('click', stopLCP, true);
      removeEventListener('pointerdown', stopLCP, true);
    };
    addEventListener('keydown', stopLCP, { capture: true, once: true });
    addEventListener('click', stopLCP, { capture: true, once: true });
    addEventListener('pointerdown', stopLCP, { capture: true, once: true });
  } catch(_) {}

  // ---- FCP ----
  try {
    var fcpObs = new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name === 'first-contentful-paint') {
          metrics.fcp = entries[i].startTime;
          try { fcpObs.disconnect(); } catch(_) {}
          break;
        }
      }
    });
    fcpObs.observe({ type: 'paint', buffered: true });
  } catch(_) {}

  // ---- CLS ----
  try {
    var clsObs = new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        // Ignora shifts provocados por input reciente del usuario (spec).
        if (!e.hadRecentInput) {
          metrics.cls += e.value;
          clsHasShifts = true;
        }
      }
    });
    clsObs.observe({ type: 'layout-shift', buffered: true });
  } catch(_) {}

  // ---- INP (aproximacion): peor 'event' duration observado ----
  // PerformanceEventTiming esta en Chromium y Safari 16+. Ignoramos 'keydown'
  // por si solo porque Chrome lo reporta con duration 0 antes del repaint.
  try {
    var inpObs = new PerformanceObserver(function(list) {
      var entries = list.getEntries();
      for (var i = 0; i < entries.length; i++) {
        var d = entries[i].duration;
        if (typeof d === 'number' && (metrics.inp === undefined || d > metrics.inp)) metrics.inp = d;
      }
    });
    // durationThreshold 40: filtra interacciones "rapidas" de la cola. INP por
    // spec es > 40ms (nadie lo percibe por debajo de ese umbral).
    inpObs.observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch(_) {}

  // ---- TTFB (Navigation Timing API) ----
  try {
    var navEntries = performance.getEntriesByType('navigation');
    if (navEntries && navEntries.length > 0) {
      var nav = navEntries[0];
      metrics.ttfb = nav.responseStart;
    }
  } catch(_) {}

  // ---- Envio ----
  function flush() {
    if (sent) return;
    sent = true;
    try {
      // Contexto del navegador: navType (navigate/reload/back_forward),
      // connection type (4g / 3g / wifi) si la API lo expone. Ayuda a
      // segmentar: un LCP alto en "3g" es esperado y no deberia saltar
      // alarma — en "wifi" si.
      var navType;
      try {
        var nav = performance.getEntriesByType('navigation')[0];
        if (nav && nav.type) navType = String(nav.type);
      } catch(_) {}
      var connType;
      try {
        var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        if (c && c.effectiveType) connType = String(c.effectiveType);
      } catch(_) {}

      var payload = {
        lcp:  metrics.lcp  !== undefined ? Math.round(metrics.lcp)  : undefined,
        inp:  metrics.inp  !== undefined ? Math.round(metrics.inp)  : undefined,
        // CLS solo lo enviamos si HUBO al menos un shift (si no, 0 es ruido
        // por la forma que tiene 'buffered:true' de inicializar — no significa
        // que la pagina fuera perfecta sino que aun no detectamos ninguno).
        cls:  clsHasShifts ? metrics.cls : undefined,
        fcp:  metrics.fcp  !== undefined ? Math.round(metrics.fcp)  : undefined,
        ttfb: metrics.ttfb !== undefined ? Math.round(metrics.ttfb) : undefined,
        path: location.pathname,
        navType: navType,
        conn: connType,
        ver: APP_VER
      };
      // Al menos una metrica real → enviamos.
      var hasAny = payload.lcp != null || payload.inp != null || payload.cls != null
                 || payload.fcp != null || payload.ttfb != null;
      if (!hasAny) return;
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        navigator.sendBeacon('/api/vitals', blob);
      } else {
        fetch('/api/vitals', { method:'POST', headers:{'Content-Type':'application/json'}, body: body, keepalive: true })
          .catch(function(){});
      }
    } catch(_) {}
  }
  // visibilitychange=hidden es el mejor trigger (incluye cerrar tab, cambiar
  // a otra pestana, bloquear pantalla, background en movil). pagehide es el
  // fallback para Safari < 14 que no dispara visibilitychange en algunas
  // transiciones. Ejecutamos flush() en el primero que llegue (sent=true
  // hace idempotente la segunda llamada).
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'hidden') flush();
  });
  window.addEventListener('pagehide', flush);
})();

`
