// Gasolineras Espana — features.js (generado automaticamente, no editar)
// Fuente: src/html/client/features.ts
// Este bundle contiene todas las features no-criticas: trend strip, telemetria,
// ruta optima, diario de repostajes, comparador modal wiring.


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
function appleMapsRouteUrl(from, to, _stops) {
  // Apple Maps WEB (maps.apple.com) NO soporta multi-stop via URL: aunque la
  // documentacion menciona el formato "daddr=A+to:B+to:C", solo la app nativa
  // (iOS/macOS Maps) lo interpreta correctamente. En web redirige a
  // /directions y solo lee el PRIMER destino. Para no confundir al usuario
  // (le salia una parada random como destino final), abrimos unicamente
  // origen -> destino. La UI avisa de que las paradas solo van en Google.
  return 'https://maps.apple.com/?saddr=' + navCoord(from)
       + '&daddr=' + navCoord(to)
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
// allCorridor: array opcional de estaciones del corredor (proyectadas con
// kmFromOrigin/offKm/priceEurL). Se almacena para permitir al usuario toggle
// "ver todas las gasolineras en ruta" sin recalcular la proyeccion.
function enterRouteMode(coords, stops, from, to, allCorridor) {
  if (!map) return;
  // Oculta el cluster general; al salir lo volveremos a enganchar.
  if (clusterGroup && map.hasLayer(clusterGroup)) {
    map.removeLayer(clusterGroup);
  }
  // Limpia layers previos de una ruta anterior si existiera.
  if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
  if (routeStopsLayer) { map.removeLayer(routeStopsLayer); routeStopsLayer = null; }
  if (routeCorridorLayer) { map.removeLayer(routeCorridorLayer); routeCorridorLayer = null; }
  routeCorridor = Array.isArray(allCorridor) ? allCorridor : [];
  routeCorridorVisible = false;
  updateCorridorToggleUI();

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
    // Estilos en styles.ts (.route-popup-*) para no disparar CSP con style="".
    var popup = '<div class="route-popup-title">Parada ' + (i + 1) + ': ' + esc(s['Rotulo'] || 'Gasolinera') + '</div>'
              + '<div class="route-popup-addr">' + esc((s['Direccion'] || '') + ', ' + (s['Municipio'] || '')) + '</div>'
              + '<div class="route-popup-price">' + stop.priceEurL.toFixed(3) + ' \u20AC/L</div>'
              + '<div class="route-popup-km">km ' + Math.round(stop.kmFromOrigin) + ' desde origen</div>';
    m.bindPopup(popup, { maxWidth: 240 });
    routeStopsLayer.addLayer(m);
  });
  routeStopsLayer.addTo(map);

  // Centra el mapa en la ruta completa.
  try { map.fitBounds(routeLayer.getBounds(), Object.assign({}, mapAnimOpts(), { padding: [40, 40] })); } catch (e) {}

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
  if (routeCorridorLayer) { try { map.removeLayer(routeCorridorLayer); } catch (e) {} routeCorridorLayer = null; }
  if (map && clusterGroup && !map.hasLayer(clusterGroup)) {
    map.addLayer(clusterGroup);
  }
  var bar = document.getElementById('route-mode-bar');
  if (bar) bar.classList.remove('show');
  routeModeActive = false;
  routeCorridor = [];
  routeCorridorVisible = false;
  updateCorridorToggleUI();
  routeNavFrom = null;
  routeNavTo = null;
  routeNavStops = null;
}

// Refresca el estado visual del boton "Ver todas en ruta" en el banner
// flotante. Lo llamamos cuando entramos/salimos de modo ruta y cuando el
// usuario alterna el toggle. Si no hay corredor (p.ej. no se planifico
// ninguna ruta aun), deshabilitamos el boton en vez de ocultarlo — asi el
// usuario ve que la opcion existe.
function updateCorridorToggleUI() {
  var btn = document.getElementById('route-mode-bar-corridor');
  var label = document.getElementById('route-mode-bar-corridor-label');
  if (!btn) return;
  var n = routeCorridor.length;
  btn.setAttribute('aria-pressed', routeCorridorVisible ? 'true' : 'false');
  if (label) {
    if (n === 0) {
      label.textContent = 'Ver todas en ruta';
    } else if (routeCorridorVisible) {
      label.textContent = 'Ocultar corredor (' + n + ')';
    } else {
      label.textContent = 'Ver todas en ruta (' + n + ')';
    }
  }
  btn.disabled = n === 0;
}

// Pinta o limpia los marcadores del corredor completo. Usa el mismo estilo
// de icono que los markers del mapa principal (makeIcon con color dinamico)
// para que el usuario reconozca de un vistazo el precio. Las paradas
// recomendadas siguen visibles encima (zIndexOffset mayor).
function renderRouteCorridorLayer() {
  if (!map) return;
  if (routeCorridorLayer) {
    try { map.removeLayer(routeCorridorLayer); } catch (e) {}
    routeCorridorLayer = null;
  }
  if (!routeCorridorVisible || routeCorridor.length === 0) return;
  // Recalculamos minP/maxP del corredor solo para colorear (no tocamos los
  // globales minP/maxP — esos son del listado filtrado general).
  var prices = routeCorridor.map(function(c) { return c.priceEurL; }).filter(function(p) { return p > 0; });
  var cmin = prices.length ? Math.min.apply(null, prices) : 0;
  var cmax = prices.length ? Math.max.apply(null, prices) : 0;
  var range = cmax - cmin;
  function localColor(p) {
    if (!p) return 'gray';
    if (range < 0.001) return 'green';
    var pct = (p - cmin) / range;
    if (pct < 0.33) return 'green';
    if (pct < 0.66) return 'yellow';
    return 'red';
  }
  var stopIds = {};
  (routeNavStops || []).forEach(function(st) {
    if (st && st.item) stopIds[stationId(st.item)] = true;
  });
  var group = L.layerGroup();
  var fuel = document.getElementById('sel-combustible').value;
  routeCorridor.forEach(function(c) {
    var s = c.item;
    var pos = stationLatLng(s);
    if (!pos) return;
    var id = stationId(s);
    // No repintar las estaciones que ya son paradas recomendadas (ya tienen
    // un marker numerado mucho mas visible). Solo las "otras" del corredor.
    if (stopIds[id]) return;
    var icon = makeIcon(localColor(c.priceEurL), c.priceEurL);
    var m = L.marker([pos.lat, pos.lng], {
      icon: icon,
      zIndexOffset: 300,
      _price: c.priceEurL
    });
    // Mismo popup que el marcador general — asi el usuario puede "Guardar",
    // "Compartir", "Comparar", etc. sin salir del modo ruta.
    m.bindPopup(buildPopup(s), { maxWidth: 300, className: 'custom-popup' });
    (function(station) {
      var stIdLocal = stationId(station);
      m.on('popupopen', function(e) {
        markVisited(stIdLocal);
        var p = parsePrice(station[fuel]);
        if (p) pushHistoryPoint(stIdLocal, fuel, p);
        try {
          var node = e.popup && e.popup._contentNode;
          if (!node) return;
          // Mismo fix CSP que en renderMarkers: el ph-marker guarda el % en
          // data-pct; aplicamos el left en runtime porque style="" inline esta
          // bloqueado por style-src sin 'unsafe-inline'.
          if (typeof applyPercentileMarkerPos === 'function') applyPercentileMarkerPos(node);
          var panel = node.querySelector('[data-hist-station]');
          if (panel) renderHistoryPanel(panel, 30);
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
    })(s);
    group.addLayer(m);
  });
  group.addTo(map);
  routeCorridorLayer = group;
}

function toggleRouteCorridor() {
  if (routeCorridor.length === 0) return;
  routeCorridorVisible = !routeCorridorVisible;
  renderRouteCorridorLayer();
  updateCorridorToggleUI();
  // Anuncio accesible: el banner es aria-live=polite, asi que actualizar
  // el texto lo lee automaticamente en screen-readers.
}

// Hook del boton de salida del banner flotante (existe siempre en el DOM).
(function() {
  var exitBtn = document.getElementById('route-mode-bar-exit');
  if (exitBtn) exitBtn.addEventListener('click', exitRouteMode);
  var corrBtn = document.getElementById('route-mode-bar-corridor');
  if (corrBtn) corrBtn.addEventListener('click', toggleRouteCorridor);
})();

(function() {
  var modal     = document.getElementById('modal-route');
  if (!modal) return;
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

  // Ship 7: paradas intermedias (waypoints). stopsSel es paralelo al DOM
  // (.route-stop-row en #route-stops-wrap) — cada indice guarda la seleccion
  // confirmada de esa fila o null si el usuario no ha elegido sugerencia.
  // MAX_STOPS = 3 es una cota suave: OSRM acepta mas waypoints, pero el
  // valor de UX cae rapido — rutas con 5+ paradas son edge case. Limitando
  // aqui evitamos que el modal se llene de inputs y que URLs enormes rompan
  // caches intermedios.
  var stopsSel = [];
  var MAX_STOPS = 3;

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
    // Coerce autonomy a numero defensivamente: perfiles antiguos o flujos
    // raros pueden haberlo guardado como string ("300"). Con el typeof
    // estricto anterior, esos casos caian al fallback derivado de tank/cons
    // y el planificador usaba 769 km en vez de 300 — visible como el bug
    // de "solo 1 parada" en rutas largas.
    var rawAuto = p.autonomy;
    var autoNum = typeof rawAuto === 'number' ? rawAuto : parseFloat(String(rawAuto));
    var auto = (isFinite(autoNum) && autoNum > 0)
               ? Math.round(autoNum)
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
          var open = window.__openProfileModal;
          if (typeof open === 'function') open();
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

  // Exponemos openRoute para que el item "Rutas" del desplegable de usuario
  // (ui.ts) pueda abrir el modal sin necesidad de un boton de cabecera.
  window.__openRouteModal = openRoute;

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

  // Ship 7: UI de paradas intermedias.
  //
  //   stopsWrap  contiene 0..MAX_STOPS filas (.route-stop-row). Cada fila
  //   tiene su propio input + contenedor de sugerencias + boton quitar y una
  //   instancia propia de makeGeoSearch — el callback escribe en stopsSel[i]
  //   usando el indice actual de la fila en el DOM (se recalcula tras cada
  //   remove para no pinchar si el usuario quita la fila 1 de 3).
  //
  //   El boton "Anadir parada" se deshabilita cuando stopsSel ya tiene
  //   MAX_STOPS entradas — evita que el usuario llene la UI sin sentido.
  var stopsWrap    = document.getElementById('route-stops-wrap');
  var btnAddStop   = document.getElementById('btn-route-add-stop');

  function refreshAddStopBtn() {
    if (!btnAddStop) return;
    var full = stopsSel.length >= MAX_STOPS;
    btnAddStop.disabled = full;
    btnAddStop.setAttribute('aria-disabled', full ? 'true' : 'false');
  }

  // Recalcula los data-index de cada fila tras un remove, de modo que los
  // callbacks de makeGeoSearch apunten al indice correcto en stopsSel.
  // Tambien refresca placeholder/aria-label del input y del remove — el
  // usuario ve la numeracion actualizada ("Parada 2 (ciudad...)" pasa a ser
  // "Parada 1 (ciudad...)" al quitar la primera).
  function renumberStopRows() {
    if (!stopsWrap) return;
    var rows = stopsWrap.querySelectorAll('.route-stop-row');
    for (var i = 0; i < rows.length; i++) {
      rows[i].setAttribute('data-idx', String(i));
      var input = rows[i].querySelector('input');
      if (input) input.setAttribute('placeholder', 'Parada ' + (i + 1) + ' (ciudad o lugar)');
      var rm = rows[i].querySelector('.btn-route-stop-remove');
      if (rm) rm.setAttribute('aria-label', 'Quitar parada ' + (i + 1));
      var srLabel = rows[i].querySelector('label.sr-only');
      if (srLabel) srLabel.textContent = 'Parada intermedia ' + (i + 1);
    }
  }

  function removeStopRow(row) {
    if (!stopsWrap || !row) return;
    var idx = parseInt(row.getAttribute('data-idx') || '-1', 10);
    if (idx >= 0 && idx < stopsSel.length) stopsSel.splice(idx, 1);
    row.parentNode && row.parentNode.removeChild(row);
    renumberStopRows();
    refreshAddStopBtn();
  }

  function addStopRow() {
    if (!stopsWrap || stopsSel.length >= MAX_STOPS) return;
    var idx = stopsSel.length;
    stopsSel.push(null);

    // IDs unicos por fila — aria-controls y label/for necesitan ids, y el
    // usuario puede tener hasta 3 filas abiertas a la vez.
    // Markup coherente con .route-stop-row (flex row: input + boton), mas
    // el label por aria encima (visualmente oculto via sr-only para no romper
    // el layout compacto del modal — screen readers siguen leyendolo).
    var rid = 'route-stop-' + idx + '-' + Date.now();
    var row = document.createElement('div');
    row.className = 'route-stop-row';
    row.setAttribute('data-idx', String(idx));
    row.innerHTML =
        '<label class="sr-only" for="' + rid + '">Parada intermedia ' + (idx + 1) + '</label>'
      + '<input id="' + rid + '" class="form-input" type="text" placeholder="Parada ' + (idx + 1) + ' (ciudad o lugar)" autocomplete="off" />'
      + '<button class="btn-route-stop-remove" type="button" aria-label="Quitar parada ' + (idx + 1) + '">'
      +   '<i class="fa-solid fa-xmark" aria-hidden="true"></i>'
      + '</button>'
      + '<div class="route-sug" role="listbox" id="' + rid + '-sug"></div>';
    stopsWrap.appendChild(row);

    var input  = row.querySelector('input');
    var sugBox = row.querySelector('.route-sug');
    var rmBtn  = row.querySelector('.btn-route-stop-remove');

    makeGeoSearch(input, sugBox, function(p) {
      // Recalcular idx en el momento del callback — si se quitaron filas
      // previas, el indice actual de esta fila pudo haber cambiado.
      var curIdx = parseInt(row.getAttribute('data-idx') || '-1', 10);
      if (curIdx >= 0 && curIdx < stopsSel.length) stopsSel[curIdx] = p;
    });

    if (rmBtn) rmBtn.addEventListener('click', function() { removeStopRow(row); });

    refreshAddStopBtn();
    // Foco al input nuevo para que el usuario pueda teclear inmediatamente
    // sin tener que clickear de nuevo — ahorra un paso en el flujo comun.
    setTimeout(function() { input && input.focus(); }, 30);
  }

  if (btnAddStop) btnAddStop.addEventListener('click', addStopRow);
  refreshAddStopBtn();

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
    }).map(function(s) {
      // Normaliza offKm a 0 si ausente/basura (asume on-route).
      var off = isFinite(s.offKm) && s.offKm >= 0 ? s.offKm : 0;
      return {
        item: s.item,
        kmFromOrigin: s.kmFromOrigin,
        priceEurL: s.priceEurL,
        offKm: off
      };
    }).sort(function(a, b) { return a.kmFromOrigin - b.kmFromOrigin; });

    // Coste efectivo por litro penalizando el desvio ida+vuelta.
    // Ver pure.ts:planFuelStops para la derivacion completa. Resumen:
    //   effectivePrice = priceEurL + (detourL(offKm) * priceEurL) / refillL
    // con refillL ~ 0.9 * tankL (llenado tipico).
    var refillL = Math.max(1, tankL * 0.9);
    function detourL(offKm) { return 2 * offKm * cons / 100; }
    function effectivePrice(c) {
      return c.priceEurL + (detourL(c.offKm) * c.priceEurL) / refillL;
    }

    var pos = 0;
    var rangeKm = initialRangeKm;
    var stops = [];
    var totalCost = 0;
    // Log diagnostico: ayuda a entender POR QUE un plan salio corto. En el
    // bug reportado en prod (977 km / autonomia 300 / solo 1 parada), mirar
    // estos logs deja claro si fue break-prematuro (routeKm mal calculado),
    // candidates-vacios (gap en corredor) o iter-limit (muy raro).
    try {
      console.log('[planFuelStops] start', {
        routeKm: Math.round(routeKm), maxAutonomyKm: Math.round(maxAutonomyKm),
        safetyKm: Math.round(safetyKm), initialRangeKm: Math.round(initialRangeKm),
        poolSize: pool.length
      });
    } catch (e) {}

    for (var iter = 0; iter < 50; iter++) {
      var remaining = routeKm - pos;
      if (rangeKm - safetyKm >= remaining) {
        try {
          console.log('[planFuelStops] break', {
            iter: iter, pos: Math.round(pos), remaining: Math.round(remaining),
            rangeMinusSafety: Math.round(rangeKm - safetyKm),
            totalStops: stops.length
          });
        } catch (e) {}
        break;
      }
      var windowStart = pos;
      var windowEnd = pos + Math.max(0, rangeKm - safetyKm);
      var candidates = pool.filter(function(s) {
        return s.kmFromOrigin > windowStart && s.kmFromOrigin <= windowEnd;
      });
      if (candidates.length === 0) {
        try {
          console.log('[planFuelStops] unreachable', {
            iter: iter, pos: Math.round(pos),
            windowStart: Math.round(windowStart), windowEnd: Math.round(windowEnd),
            poolInWindowOrPast: pool.filter(function(s) { return s.kmFromOrigin > pos; }).length,
            stopsSoFar: stops.length
          });
        } catch (e) {}
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
      // del precio EFECTIVO mas barato del tramo (precio + desvio). Ver pure.ts.
      var minEff = Infinity;
      for (var mi = 0; mi < candidates.length; mi++) {
        var eff = effectivePrice(candidates[mi]);
        if (eff < minEff) minEff = eff;
      }
      var effThreshold = minEff * 1.05;
      var cheap = candidates.filter(function(c) { return effectivePrice(c) <= effThreshold; });
      cheap.sort(function(a, b) {
        var d = b.kmFromOrigin - a.kmFromOrigin;
        if (d !== 0) return d;
        return effectivePrice(a) - effectivePrice(b);
      });
      var pick = cheap[0];
      stops.push({ item: pick.item, kmFromOrigin: pick.kmFromOrigin, priceEurL: pick.priceEurL });
      var consumedKm = pick.kmFromOrigin - pos;
      var consumedL = (consumedKm / 100) * cons;
      var detourExtraL = detourL(pick.offKm);
      totalCost += (consumedL + detourExtraL) * pick.priceEurL;
      try {
        console.log('[planFuelStops] pick', {
          iter: iter, km: Math.round(pick.kmFromOrigin),
          price: Number(pick.priceEurL.toFixed(3)), offKm: Number((pick.offKm || 0).toFixed(1)),
          candidates: candidates.length, cheap: cheap.length
        });
      } catch (e) {}
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
    // Solo Google Maps abre la ruta con todas las gasolineras como paradas.
    // Apple Maps web ignora el multi-stop (solo la app nativa lo soporta) y
    // Waze no admite waypoints via URL. Por eso en Apple/Waze abrimos unica-
    // mente origen -> destino final, sin paradas intermedias.
    var footnote = hasStops
      ? '<div class="route-nav-note">Solo Google Maps abre la ruta con todas las gasolineras como paradas. Apple Maps y Waze abren solo origen \u2192 destino (sus enlaces no soportan m\u00FAltiples paradas).</div>'
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
      // Ship 7: waypoints. El backend (src/index.tsx::parseStops) acepta el
      // parametro stops con formato "lat,lng;lat,lng;..." y lo inyecta
      // entre from y to antes de llamar a OSRM. Filtramos stopsSel para
      // quitar filas sin seleccion confirmada (el usuario pudo anadir la
      // fila y no elegir nada) — esas no se envian.
      var validStops = stopsSel.filter(function(s) {
        return s && typeof s.lat === 'number' && typeof s.lng === 'number';
      });
      if (validStops.length > 0) {
        var stopsParam = validStops.map(function(s) {
          return s.lat.toFixed(6) + ',' + s.lng.toFixed(6);
        }).join(';');
        routeUrl += '&stops=' + encodeURIComponent(stopsParam);
      }
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
      var polyKm = cum[cum.length - 1];
      // Preferimos route.distanceKm (OSRM autoritativo) sobre la suma
      // haversine de la polilinea: si la polilinea viene simplificada o
      // truncada, el haversine infra-estima y el planificador cree que la
      // ruta es mas corta de lo que es (bug real visto en prod: 977 km OSRM
      // -> cum ~500 km -> planner devolvia solo 1 parada con autonomia 300).
      // Caemos a cum[] solo si distanceKm no llega.
      var osrmKm = typeof route.distanceKm === 'number' && route.distanceKm > 0
                   ? route.distanceKm
                   : 0;
      var totalKm = osrmKm > 0 ? Math.max(osrmKm, polyKm) : polyKm;

      // 2. Bbox que envuelve la polilinea real → /api/estaciones/bbox.
      //    IMPORTANTE: dimensionamos el bbox con el ancho MAXIMO de reintento
      //    (10 km), no con el ancho inicial del usuario. Asi podemos ampliar
      //    el corredor en memoria (sin re-fetchear) si el primer plan sale
      //    incompleto porque el usuario eligio un corredor muy estrecho.
      var MAX_RETRY_WIDTH = 15;
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

      // Si ni siquiera el corredor maximo (15 km) tiene estaciones para el
      // combustible seleccionado, abortamos con un mensaje claro.
      if (corridorAt(15).length === 0) {
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
          polyKm: Math.round(polyKm),
          osrmKm: Math.round(osrmKm || 0),
          autonomyKm: autonomyKm,
          tankL: tankL,
          consumoL100km: Number(consumoL100km.toFixed(2)),
          profileConsumo: vehicle.consumo,
          profileAutonomyRaw: (getProfile() || {}).autonomy,
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
      // planificador no puede completar trayectos largos. Probamos hasta 15 km.
      var retryWidths = [3, 5, 7, 10, 15];
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
      // para construir los deep-links a Google/Apple/Waze Maps. El 5o
      // argumento es el corredor completo (todas las gasolineras dentro del
      // ancho usado), que se enchufa al toggle "Ver todas en ruta" del banner.
      enterRouteMode(finalCoords, planResult.stops, fromSel, toSel, corridor);

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

  // Lee del perfil el consumo declarado (L/100km) y la capacidad del deposito.
  // Si no hay perfil o faltan, devuelve nulls — diaryStats los ignora y cae
  // al calculo clasico solo-observado.
  function diaryProfileOpts() {
    try {
      var p = (typeof getProfile === 'function' ? getProfile() : null) || {};
      var cons = null;
      if (typeof p.consumo === 'number' && p.consumo > 0) cons = p.consumo;
      else if (typeof p.consumoL100km === 'number' && p.consumoL100km > 0) cons = p.consumoL100km;
      var tank = (typeof p.tank === 'number' && p.tank > 0) ? p.tank : null;
      return { profileL100km: cons, tankCapacity: tank };
    } catch(_) { return { profileL100km: null, tankCapacity: null }; }
  }

  // Funcion pura duplicada — tests cubren la version canonica en pure.ts.
  // Ver explicacion detallada de por que funciona con parciales en pure.ts.
  function diaryStats(entries, opts) {
    var clean = (entries || []).filter(function(e) {
      return e && typeof e.date === 'string'
        && isFinite(e.litros)      && e.litros      > 0
        && isFinite(e.eurPerLitre) && e.eurPerLitre > 0
        && isFinite(e.kmTotales)   && e.kmTotales   >= 0;
    }).sort(function(a, b) { return a.date.localeCompare(b.date); });
    var profileL100km = (opts && typeof opts.profileL100km === 'number' && opts.profileL100km > 0) ? opts.profileL100km : null;
    var tankCapacity  = (opts && typeof opts.tankCapacity  === 'number' && opts.tankCapacity  > 0) ? opts.tankCapacity  : null;
    if (clean.length === 0) {
      return {
        entries: 0, totalLiters: 0, totalSpentEur: 0,
        avgEurPerLitre: null, totalKm: 0, avgL100km: null,
        profileL100km: profileL100km,
        reliableL100km: profileL100km,
        reliabilityWeight: 0,
        eurPer100km: null,
        segments: []
      };
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
    // Consumo por tramo: empieza en el 2o repostaje.
    var segments = [];
    for (var k = 1; k < clean.length; k++) {
      var segKm = clean[k].kmTotales - clean[k - 1].kmTotales;
      segments.push({
        date: clean[k].date,
        km: segKm > 0 ? segKm : 0,
        litros: clean[k].litros,
        l100km: segKm > 0 ? clean[k].litros / (segKm / 100) : null
      });
    }
    // Blend observado <-> perfil (ver pure.ts para la explicacion).
    var reliabilityWeight = 0;
    var reliableL100km = null;
    if (avgL100km !== null && profileL100km !== null) {
      var wKm = totalKm > 0 ? Math.min(1, totalKm / 2000) : 0;
      var wLitros = (tankCapacity !== null && litersForCons > 0)
        ? Math.min(1, litersForCons / (tankCapacity * 2))
        : 0;
      reliabilityWeight = Math.min(1, Math.max(wKm, wLitros));
      reliableL100km = reliabilityWeight * avgL100km + (1 - reliabilityWeight) * profileL100km;
    } else if (avgL100km !== null) {
      reliabilityWeight = 1;
      reliableL100km = avgL100km;
    } else if (profileL100km !== null) {
      reliabilityWeight = 0;
      reliableL100km = profileL100km;
    }
    var avgEurPerLitre = sEpl / clean.length;
    var eurPer100km = (reliableL100km !== null && isFinite(avgEurPerLitre))
      ? reliableL100km * avgEurPerLitre
      : null;
    return {
      entries: clean.length,
      totalLiters: tL,
      totalSpentEur: tS,
      avgEurPerLitre: avgEurPerLitre,
      totalKm: totalKm > 0 ? totalKm : 0,
      avgL100km: avgL100km,
      profileL100km: profileL100km,
      reliableL100km: reliableL100km,
      reliabilityWeight: reliabilityWeight,
      eurPer100km: eurPer100km,
      segments: segments
    };
  }

  function fmtDate(iso) {
    // Formatea YYYY-MM-DD a "dd/mm/yyyy" para display. Defensivo ante inputs raros.
    if (!iso || iso.length < 10) return iso || '';
    var y = iso.slice(0, 4), m = iso.slice(5, 7), d = iso.slice(8, 10);
    return d + '/' + m + '/' + y;
  }

  function renderStats() {
    var raw = getDiary();
    var opts = diaryProfileOpts();
    var s = diaryStats(raw, opts);
    document.getElementById('ds-entries').textContent = s.entries;
    document.getElementById('ds-spent').textContent   = s.totalSpentEur.toFixed(2) + ' \u20AC';
    document.getElementById('ds-avg').textContent     = s.avgEurPerLitre ? s.avgEurPerLitre.toFixed(3) + ' \u20AC/L' : '--';
    document.getElementById('ds-km').textContent      = s.totalKm.toFixed(0) + ' km';
    // Consumo: preferimos el valor "fiable" (mezcla observado+perfil). Si no
    // hay ni datos ni perfil -> '--'.
    var consEl = document.getElementById('ds-cons');
    var consSubEl = document.getElementById('ds-cons-sub');
    if (s.reliableL100km !== null && s.reliableL100km !== undefined) {
      consEl.textContent = s.reliableL100km.toFixed(1) + ' L/100km';
      if (consSubEl) {
        if (s.reliabilityWeight >= 0.95 && s.profileL100km !== null) {
          consSubEl.textContent = 'calculado con tus repostajes';
        } else if (s.reliabilityWeight >= 0.5 && s.profileL100km !== null) {
          consSubEl.textContent = 'tus repostajes + perfil';
        } else if (s.avgL100km === null && s.profileL100km !== null) {
          consSubEl.textContent = 'segun tu perfil (aun sin repostajes)';
        } else if (s.profileL100km !== null) {
          consSubEl.textContent = 'perfil + pocos repostajes';
        } else {
          consSubEl.textContent = 'solo repostajes (sin perfil)';
        }
      }
    } else {
      consEl.textContent = '--';
      if (consSubEl) consSubEl.textContent = 'faltan datos o perfil';
    }
    // Coste por 100 km: reliableL100km * media €/L. Muy util porque responde
    // directamente a "cuanto me cuesta cada 100 km en combustible".
    var eurEl = document.getElementById('ds-eurkm');
    if (eurEl) {
      eurEl.textContent = (s.eurPer100km !== null && s.eurPer100km !== undefined && isFinite(s.eurPer100km))
        ? s.eurPer100km.toFixed(2) + ' \u20AC/100km'
        : '--';
    }
    document.getElementById('ds-liters').textContent  = s.totalLiters.toFixed(1) + ' L';
  }

  function renderList() {
    var raw = getDiary();
    if (!raw || raw.length === 0) {
      emptyWrap.style.display = '';
      listWrap.innerHTML = '';
      return;
    }
    // Calculamos los segmentos con diaryStats (cronologico) y mapeamos por
    // date+km para poder pintar el L/100km del tramo junto al repostaje que
    // lo CIERRA. Los mas recientes primero (orden DESC) para mostrar.
    // Calculamos los segmentos y los mapeamos por date+km (clave usada en el
    // borrado tambien) para pintar el L/100km del tramo junto al repostaje
    // que lo CIERRA.
    var stats = diaryStats(raw);
    var chrono = raw.slice().filter(function(e) {
      return e && isFinite(e.litros) && e.litros > 0 && isFinite(e.kmTotales) && e.kmTotales >= 0;
    }).sort(function(a, b) { return a.date.localeCompare(b.date); });
    var segByKey = {};
    for (var ci = 1; ci < chrono.length; ci++) {
      var seg = stats.segments[ci - 1];
      if (!seg) continue;
      segByKey[chrono[ci].date + '|' + chrono[ci].kmTotales] = seg;
    }
    var entries = raw.slice().sort(function(a, b) { return b.date.localeCompare(a.date); });
    emptyWrap.style.display = 'none';
    listWrap.innerHTML = entries.map(function(e) {
      var segKey = e.date + '|' + e.kmTotales;
      var seg = segByKey[segKey];
      var segLine = '';
      if (seg && seg.l100km !== null && seg.l100km !== undefined && isFinite(seg.l100km)) {
        segLine = '  <div class="diary-item-seg">' + seg.km.toFixed(0) + ' km desde el anterior \u2022 <strong>'
          + seg.l100km.toFixed(1) + ' L/100km</strong></div>';
      } else if (chrono.length > 1 && chrono[0].date === e.date && chrono[0].kmTotales === e.kmTotales) {
        // Primer repostaje (el mas antiguo): es la referencia, no tiene tramo.
        segLine = '  <div class="diary-item-seg diary-item-seg-muted">Referencia inicial \u2022 los siguientes repostajes calculan el consumo</div>';
      }
      return '<div class="diary-item">'
        + '<div class="diary-item-main">'
        + '  <div class="diary-item-date">' + esc(fmtDate(e.date)) + ' \u00B7 ' + e.litros.toFixed(2) + ' L'
        + '    <span class="diary-item-sub">a ' + e.eurPerLitre.toFixed(3) + ' \u20AC/L \u00B7 ' + (e.litros * e.eurPerLitre).toFixed(2) + ' \u20AC</span>'
        + '  </div>'
        + '  <div class="diary-item-sub">Odometro: ' + e.kmTotales.toFixed(0) + ' km</div>'
        + segLine
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

  // Exponemos openDiary para que el item "Repostajes" del desplegable de
  // usuario (ui.ts) pueda abrir el modal sin boton de cabecera.
  window.__openDiaryModal = openDiary;

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

// ============================================================
// ===== COMPARADOR SIDE-BY-SIDE =====
// ============================================================
// Wiring del modal y chip flotante. La logica de estado (compareIds,
// toggleCompare, renderCompareModal) vive arriba — aqui solo enchufamos
// los listeners al DOM tras cargar el script.
(function() {
  var modal  = document.getElementById('modal-compare');
  if (!modal) return;
  var btnClose = document.getElementById('btn-compare-close');
  var btnClear = document.getElementById('btn-compare-clear');
  var btnDone  = document.getElementById('btn-compare-done');
  var chip     = document.getElementById('compare-chip');
  var chipX    = document.getElementById('compare-chip-clear');

  if (btnClose) btnClose.addEventListener('click', closeCompareModal);
  if (btnDone)  btnDone.addEventListener('click',  closeCompareModal);
  // "Quitar seleccion" limpia compareIds pero deja abierto el modal (por si
  // el usuario quiere seguir comparando otras; ahora solo vera el empty state).
  if (btnClear) btnClear.addEventListener('click', function() {
    clearCompareSelection();
    renderCompareModal();
    showToast('Seleccion del comparador vaciada', 'info');
  });
  // Click en el chip flotante -> abre modal (si hay al menos 1 estacion).
  // El X dentro del chip limpia la seleccion en su lugar.
  if (chip) chip.addEventListener('click', function(e) {
    if (e.target && e.target.closest && e.target.closest('.compare-chip-x')) return;
    if (compareIds.length > 0) openCompareModal();
  });
  if (chipX) chipX.addEventListener('click', function(e) {
    e.stopPropagation();
    clearCompareSelection();
    showToast('Seleccion del comparador vaciada', 'info');
  });
  // Cerrar con click fuera del modal (backdrop) — patron comun con los otros
  // modales (onboarding/favoritos/diario). El click dentro del .modal burbujeara
  // hasta el backdrop tambien, asi que comprobamos que el target sea el propio.
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeCompareModal();
  });
  // Cerrar con ESC (accesibilidad basica).
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeCompareModal();
  });
})();

// ============================================================
// Ship 22: SWIPE-DOWN-TO-DISMISS para bottom sheets (movil)
// ============================================================
// Cuando el modal se muestra como bottom sheet (width <= 639px), el usuario
// espera poder cerrarlo arrastrando hacia abajo. Delegamos en document para
// cubrir todos los modales (.modal-backdrop.show) sin duplicar logica.
// Solo engancha cuando el modal-body esta en scrollTop=0 (asi el scroll
// interno sigue funcionando cuando hay contenido largo).
(function() {
  var activeModal = null;
  var startY = 0, currDelta = 0, dragging = false;

  function isMobile() {
    return window.innerWidth <= 639;
  }
  function findModal(target) {
    if (!target || !target.closest) return null;
    var backdrop = target.closest('.modal-backdrop.show');
    if (!backdrop) return null;
    var modal = backdrop.querySelector('.modal');
    return modal ? { backdrop: backdrop, modal: modal } : null;
  }
  function canDrag(modal, target) {
    // Si el usuario toca DENTRO de modal-body y este tiene scroll hacia abajo,
    // el gesto es "scroll interno", no "cerrar sheet". Solo dejamos arrastrar
    // cuando el contenido esta arriba del todo.
    if (modal.scrollTop > 0) return false;
    // Evitar conflicto con form fields, sliders, etc.
    if (target && target.closest) {
      if (target.closest('input, textarea, select, button, [role="slider"], [data-hist-range], .hist-toggle')) return false;
    }
    return true;
  }

  document.addEventListener('touchstart', function(e) {
    if (!isMobile()) return;
    var found = findModal(e.target);
    if (!found) return;
    if (!canDrag(found.modal, e.target)) return;
    activeModal = found;
    startY = e.touches[0].clientY;
    currDelta = 0;
    dragging = true;
    found.modal.style.transition = 'none';
  }, { passive: true });

  document.addEventListener('touchmove', function(e) {
    if (!dragging || !activeModal) return;
    var delta = e.touches[0].clientY - startY;
    if (delta <= 0) {
      currDelta = 0;
      activeModal.modal.style.transform = '';
      return;
    }
    currDelta = delta;
    activeModal.modal.style.transform = 'translateY(' + delta + 'px)';
    // Atenuar el backdrop conforme se arrastra para dar feedback
    var opacity = Math.max(0.2, 1 - (delta / 400));
    activeModal.backdrop.style.background = 'rgba(15,23,42,' + (opacity * 0.6).toFixed(3) + ')';
  }, { passive: true });

  document.addEventListener('touchend', function() {
    if (!dragging || !activeModal) return;
    dragging = false;
    activeModal.modal.style.transition = '';
    activeModal.backdrop.style.background = '';
    if (currDelta > 120) {
      // Cerrar: slide completo hacia abajo y remover .show
      activeModal.modal.style.transform = 'translateY(100%)';
      var backdrop = activeModal.backdrop;
      setTimeout(function() {
        backdrop.classList.remove('show');
        backdrop.querySelector('.modal').style.transform = '';
      }, 220);
    } else {
      // Snap back
      activeModal.modal.style.transform = '';
    }
    activeModal = null;
    currDelta = 0;
  }, { passive: true });

  document.addEventListener('touchcancel', function() {
    if (!dragging || !activeModal) return;
    dragging = false;
    activeModal.modal.style.transition = '';
    activeModal.modal.style.transform = '';
    activeModal.backdrop.style.background = '';
    activeModal = null;
    currDelta = 0;
  }, { passive: true });
})();

// ---- Ship 20: wiring del modal de historico ----
// Mismo patron que comparador: botones close/done + click backdrop + ESC.
// openHistoryModal se dispara desde ui.ts al clicar el boton 📈 de una card.
(function() {
  var modal = document.getElementById('modal-history');
  if (!modal) return;
  var btnClose = document.getElementById('btn-history-close');
  var btnDone  = document.getElementById('btn-history-done');
  if (btnClose) btnClose.addEventListener('click', closeHistoryModal);
  if (btnDone)  btnDone.addEventListener('click',  closeHistoryModal);
  modal.addEventListener('click', function(e) {
    if (e.target === modal) closeHistoryModal();
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeHistoryModal();
  });
})();

// ---- Ship 8: REPORTE DE PRECIO INCORRECTO ----
// Un solo IIFE que:
//  1. Delega clicks en .popup-report-link del mapa (data-pop-report contiene
//     ideess|fuel|officialPrice|rotulo).
//  2. Expone openReportModal(...) por si otros contextos (lista, favoritos)
//     quieren abrirlo en el futuro — por ahora solo el popup del mapa.
//  3. Maneja el submit: valida, POST a /api/reports/price, muestra toast y
//     cierra. Errores (429/409/500) se muestran inline sin cerrar para que
//     el usuario pueda reintentar.
(function() {
  var modal = document.getElementById('modal-report');
  if (!modal) return;
  var ctxBox    = document.getElementById('report-context');
  var selReason = document.getElementById('report-reason');
  var inPrice   = document.getElementById('report-price');
  var inComment = document.getElementById('report-comment');
  var statusEl  = document.getElementById('report-status');
  var btnClose  = document.getElementById('btn-report-close');
  var btnCancel = document.getElementById('btn-report-cancel');
  var btnSubmit = document.getElementById('btn-report-submit');

  // Estado del modal actual (resetea en openReportModal).
  var current = { ideess: '', fuel: '', officialPrice: null, rotulo: '' };

  // Mapeo de codigos internos a etiquetas usuario-friendly. Usamos los mismos
  // codigos cortos que emite map.ts (REPORT_FUEL_CODES) y que el servidor
  // valida contra REPORT_FUELS en src/index.tsx.
  var FUEL_LABELS = {
    '95': 'Gasolina 95',
    '98': 'Gasolina 98',
    'diesel': 'Di\u00E9sel A',
    'diesel_plus': 'Di\u00E9sel Plus',
    'glp': 'GLP (autogas)',
    'gnc': 'GNC',
    'gnl': 'GNL',
    'hidrogeno': 'Hidr\u00F3geno',
    'diesel_renov': 'Di\u00E9sel Renovable'
  };

  function setStatus(msg, isError) {
    if (!statusEl) return;
    statusEl.textContent = msg || '';
    if (isError) statusEl.classList.add('error');
    else statusEl.classList.remove('error');
  }

  function closeReport() {
    modal.classList.remove('show');
    setStatus('', false);
  }

  function openReportModal(ideess, fuel, officialPrice, rotulo) {
    current.ideess = String(ideess || '').trim();
    current.fuel = String(fuel || '').trim();
    current.officialPrice = (typeof officialPrice === 'number' && isFinite(officialPrice)) ? officialPrice : null;
    current.rotulo = String(rotulo || 'Gasolinera').trim();

    // Caja contextual con lo que el usuario va a reportar.
    var fuelLabel = FUEL_LABELS[current.fuel] || current.fuel;
    var priceTxt  = current.officialPrice != null
      ? current.officialPrice.toFixed(3) + ' \u20AC/L'
      : 'sin precio publicado';
    if (ctxBox) {
      ctxBox.innerHTML = 'Reportando <strong>' + esc(current.rotulo) + '</strong>'
                      + ' &middot; <strong>' + esc(fuelLabel) + '</strong>'
                      + ' &middot; oficial: <strong>' + esc(priceTxt) + '</strong>';
    }

    // Reset campos a valores por defecto cada vez que se abre — evita que el
    // usuario reporte por error la estacion X con el comentario de la Y.
    if (selReason) selReason.value = 'outdated';
    if (inPrice) inPrice.value = '';
    if (inComment) inComment.value = '';
    setStatus('', false);
    if (btnSubmit) btnSubmit.disabled = false;

    modal.classList.add('show');
    setTimeout(function() { selReason && selReason.focus(); }, 50);
  }

  // Exponer globalmente por si otros modulos quieren abrirlo.
  window.openReportModal = openReportModal;

  // Delegacion de clicks en popup-report-link del mapa. El data-pop-report
  // codifica "ideess|fuel|price|rotulo" (| como separador, rotulo puede
  // contener espacios pero no | — si acaso contuviera, join('|') al desempaquetar
  // lo reabsorberia en la parte del rotulo; cubrimos ese caso con slice(3).join).
  document.addEventListener('click', function(e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var btn = t.closest('[data-pop-report]');
    if (!btn) return;
    var payload = btn.getAttribute('data-pop-report') || '';
    var parts = payload.split('|');
    if (parts.length < 4) return;
    var ideess = parts[0];
    var fuel = parts[1];
    var price = parseFloat(parts[2]);
    var rotulo = parts.slice(3).join('|');
    openReportModal(ideess, fuel, isFinite(price) ? price : null, rotulo);
  });

  if (btnClose)  btnClose.addEventListener('click',  closeReport);
  if (btnCancel) btnCancel.addEventListener('click', closeReport);
  modal.addEventListener('click', function(e) { if (e.target === modal) closeReport(); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape' && modal.classList.contains('show')) closeReport();
  });

  // Submit: validacion client-side ligera + POST. El servidor re-valida todo
  // (ver /api/reports/price), asi que aqui solo cortamos los casos obvios
  // para dar feedback inmediato.
  if (btnSubmit) btnSubmit.addEventListener('click', async function() {
    if (!current.ideess || !current.fuel) {
      setStatus('Falta la estaci\u00F3n o el combustible.', true);
      return;
    }
    var reason = selReason ? selReason.value : '';
    if (!reason) {
      setStatus('Elige un motivo.', true);
      return;
    }

    // Precio opcional — parseo tolerante (coma o punto decimal).
    var priceRaw = inPrice ? inPrice.value.trim() : '';
    var reportedPrice = null;
    if (priceRaw) {
      var n = parseFloat(priceRaw.replace(',', '.'));
      if (!isFinite(n) || n < 0.1 || n > 10) {
        setStatus('El precio debe estar entre 0,10 y 10,00 \u20AC/L.', true);
        return;
      }
      reportedPrice = n;
    }
    var comment = inComment ? inComment.value.trim() : '';
    if (comment.length > 500) comment = comment.slice(0, 500);

    btnSubmit.disabled = true;
    setStatus('Enviando reporte\u2026', false);

    try {
      var r = await fetch('/api/reports/price', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ideess: current.ideess,
          fuel: current.fuel,
          officialPriceEur: current.officialPrice,
          reportedPriceEur: reportedPrice,
          reason: reason,
          comment: comment || null
        })
      });
      if (r.ok) {
        closeReport();
        showToast('Gracias \u2014 reporte enviado', 'success');
        return;
      }
      if (r.status === 429) {
        setStatus('Has enviado demasiados reportes. Espera un momento.', true);
      } else if (r.status === 409) {
        setStatus('Ya reportaste esta estaci\u00F3n en la \u00FAltima hora. Gracias.', true);
      } else if (r.status === 400 || r.status === 413 || r.status === 415) {
        setStatus('Datos no v\u00E1lidos. Revisa los campos y prueba de nuevo.', true);
      } else {
        setStatus('No se pudo enviar el reporte. Prueba en unos segundos.', true);
      }
      btnSubmit.disabled = false;
    } catch (err) {
      setStatus('Fallo de red. Comprueba tu conexi\u00F3n y prueba de nuevo.', true);
      btnSubmit.disabled = false;
    }
  });
})();

