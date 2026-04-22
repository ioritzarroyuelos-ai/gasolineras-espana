export const clientMapScript = `
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
    maxZoom: 20,  // OBLIGATORIO para maplibre-gl-leaflet: si falta, el bridge
                  // lanza "Map has no maxZoom specified" y la promesa del
                  // layer queda sin manejar, rompiendo otros flujos UI.
    maxBounds: SPAIN_BOUNDS,
    maxBoundsViscosity: 1.0,
    worldCopyJump: false
  }).setView([40.4, -3.7], 6);

  // Capa base clara: arrancamos en raster "voyager_nolabels" — basemap sin
  // toponimia. Las etiquetas las pintamos nosotros (SPAIN_LABELS) en castellano
  // puro mientras carga el upgrade vectorial. Si MapLibre GL + Liberty carga
  // bien (applyLibertyLanguage), reemplazamos esta capa por un vector tile
  // layer con text-field parcheado a name:es — entonces obtenemos todos los
  // municipios/calles/POIs de OSM, en castellano cuando existe el tag.
  mapLayers.light = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, minZoom: 5, noWrap: true, bounds: SPAIN_BOUNDS
  });
  // Modo oscuro sin etiquetas — dark_nolabels es el gemelo nocturno de
  // voyager_nolabels. Sobre el pintamos SPAIN_LABELS (solo CCAA + ciudades
  // principales) en castellano: suficiente para orientarse en modo nocturno y
  // mantenemos coherencia con "todo en castellano".
  mapLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd', maxZoom: 20, minZoom: 5, noWrap: true, bounds: SPAIN_BOUNDS
  });
  // Activar capa segun tema actual
  (isDarkStart ? mapLayers.dark : mapLayers.light).addTo(map);

  // Controles: solo zoom (abajo-derecha) y escala (abajo-izquierda). Sin
  // selector Mapa/Satelite (quitado por peticion del usuario) — un unico
  // basemap, sin opciones visibles que ocupen esquina del mapa.
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control.scale({ position: 'bottomleft', imperial: false, maxWidth: 120 }).addTo(map);

  // Capa de etiquetas propias — CCAA + ciudades principales en castellano.
  // Funciona como FALLBACK garantizado: mientras MapLibre GL carga (async) y
  // si falla por cualquier motivo (CDN, sin WebGL, CSP, etc.), el usuario ve
  // al menos la toponimia basica en castellano encima del basemap sin rotulos.
  // Cuando MapLibre GL + Liberty se aplica correctamente (applyLibertyLanguage
  // mas abajo), quitamos esta capa porque el vector tile ya trae TODA la
  // toponimia OSM con name:es.
  labelLayer = L.layerGroup().addTo(map);
  renderLabels();
  map.on('zoomend', renderLabels);

  // Upgrade async a tiles vectoriales en castellano: fetcheamos el style
  // Liberty de OpenFreeMap, parcheamos todas las expresiones text-field para
  // que prioricen name:es con fallback a name:latin/name, y reemplazamos la
  // capa base clara. Si algo falla, nos quedamos en el raster + SPAIN_LABELS.
  // .catch() obligatorio: el bridge maplibre-gl-leaflet rechaza promesas
  // internas cuando el map no esta bien configurado (p.ej. sin maxZoom).
  // Sin catch quedaba "Uncaught (in promise) Map has no maxZoom specified"
  // que en algunas rutas rompia renderStations via estado incoherente del map.
  applyLibertyLanguage().catch(function(e) {
    console.warn('[liberty] upgrade no aplicado, seguimos con raster:', (e && e.message) || e);
  });

  setTimeout(function() { map.invalidateSize(true); }, 100);
}

// Poligono simplificado que cubre unicamente territorio espanol: Peninsula
// Iberica (siguiendo la frontera con Portugal/Francia), Baleares, Canarias,
// Ceuta y Melilla. Lo usamos como filter "within" en cada capa de texto del
// estilo Liberty — asi MapLibre GL solo renderiza labels cuyos features caen
// DENTRO de Espana. Portugal, Francia, Marruecos, Argelia, Gibraltar, Andorra
// quedan sin toponimia.
//
// Precision: ~30 vertices en Peninsula, suficiente para distinguir Portugal
// de Espana en la frontera y no es demasiado lento de evaluar. Archipielagos
// son cajas rectangulares (no hay islas de otro pais en esos bboxes).
var SPAIN_GEOMETRY = {
  type: 'MultiPolygon',
  coordinates: [
    // Peninsula — en sentido antihorario, aproximando frontera con Portugal
    // (oeste) y Francia (norte / Pirineos).
    [[[-9.30, 43.20], [-9.50, 42.80], [-8.88, 42.17], [-8.22, 42.15],
      [-7.05, 41.95], [-6.93, 41.00], [-7.35, 40.20], [-7.20, 39.67],
      [-7.50, 38.85], [-7.35, 38.25], [-7.50, 37.50], [-7.43, 37.20],
      [-6.95, 36.80], [-6.50, 36.45], [-5.85, 36.00], [-5.35, 36.15],
      [-4.40, 36.68], [-3.50, 36.70], [-2.90, 36.70], [-1.80, 36.75],
      [-0.75, 37.60], [0.20, 39.40], [0.55, 40.70], [1.30, 41.00],
      [3.30, 41.90], [3.30, 42.30], [1.70, 42.40], [0.70, 42.70],
      [-0.30, 42.80], [-1.40, 43.05], [-1.75, 43.35], [-2.93, 43.45],
      [-3.80, 43.48], [-4.85, 43.55], [-6.20, 43.65], [-7.42, 43.79],
      [-8.20, 43.75], [-9.30, 43.20]]],
    // Baleares (bbox amplio — no hay islas de otro pais cerca)
    [[[1.00, 38.55], [4.60, 38.55], [4.60, 40.20], [1.00, 40.20], [1.00, 38.55]]],
    // Canarias (bbox amplio)
    [[[-18.30, 27.30], [-13.20, 27.30], [-13.20, 29.60], [-18.30, 29.60], [-18.30, 27.30]]],
    // Ceuta
    [[[-5.43, 35.84], [-5.23, 35.84], [-5.23, 35.95], [-5.43, 35.95], [-5.43, 35.84]]],
    // Melilla
    [[[-3.03, 35.22], [-2.88, 35.22], [-2.88, 35.35], [-3.03, 35.35], [-3.03, 35.22]]]
  ]
};

// Fetch + patch + apply del style Liberty de OpenFreeMap.
// Dos patches:
//   1) text-field -> coalesce(name:es, name:latin, name)  — fuerza castellano
//      incluso si la layer pedia originalmente name:en/name:fr/name:latin.
//   2) filter    -> ["all", originalFilter, ["within", SPAIN_GEOMETRY]]  — solo
//      renderiza texto si la feature cae DENTRO de Espana. Portugal, Francia,
//      Marruecos, Argelia, Andorra, Gibraltar quedan sin ningun label.
async function applyLibertyLanguage() {
  // Esperamos a que los scripts MapLibre carguen (son defer, asi que pueden
  // no estar listos cuando initMap() corre).
  var tries = 0;
  while ((typeof L.maplibreGL !== 'function' || typeof window.maplibregl === 'undefined') && tries < 40) {
    await new Promise(function(r) { setTimeout(r, 50); });
    tries++;
  }
  if (typeof L.maplibreGL !== 'function' || typeof window.maplibregl === 'undefined') return;
  try {
    // Timeout duro 6s — si el CDN de OpenFreeMap esta lento o caido, nos
    // quedamos con el raster + SPAIN_LABELS. Sin AbortController, un stall
    // en este fetch dejaba la Promise pendiente indefinidamente consumiendo
    // recursos y podia interferir con otros flujos del cliente.
    var libCtrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var libTid  = libCtrl ? setTimeout(function() { libCtrl.abort(); }, 6000) : 0;
    var resp = await fetch('https://tiles.openfreemap.org/styles/liberty', {
      credentials: 'omit',
      signal: libCtrl ? libCtrl.signal : undefined
    });
    if (libTid) clearTimeout(libTid);
    if (!resp.ok) return;
    var style = await resp.json();

    // Patch recursivo de text-field. Capturamos CUALQUIER key que empiece por
    // 'name' (name, name:latin, name:en, name:nonlatin, name_en, name_es,
    // name_int, ...) salvo las espanolas, y las reescribimos al mismo coalesce
    // agresivo. Liberty usa mezcla de sintaxis con dos puntos y con underscore
    // (name_en es el fallback ingles por defecto) — ahora los cubrimos todos.
    // Orden del coalesce: name:es > name_es > name:latin > name — garantiza
    // castellano siempre que OSM / OpenMapTiles tengan el tag, y cae a texto
    // original como ultimo recurso.
    function patchGet(expr) {
      if (Array.isArray(expr)) {
        if (expr[0] === 'get' && typeof expr[1] === 'string') {
          var k = expr[1];
          var isNameKey = k === 'name' ||
                          k.indexOf('name:') === 0 ||
                          k.indexOf('name_') === 0;
          var isSpanish = k === 'name:es' || k === 'name_es';
          if (isNameKey && !isSpanish) {
            return ['coalesce',
              ['get', 'name:es'],
              ['get', 'name_es'],
              ['get', 'name:latin'],
              ['get', 'name']
            ];
          }
        }
        return expr.map(patchGet);
      }
      if (expr && typeof expr === 'object') {
        var out = {};
        for (var kk in expr) if (Object.prototype.hasOwnProperty.call(expr, kk)) out[kk] = patchGet(expr[kk]);
        return out;
      }
      return expr;
    }

    // Combina el filter original con "within Espana" — preserva la logica de
    // Liberty (rank, class, etc.) y anade el recorte geografico encima.
    var spatialFilter = ['within', SPAIN_GEOMETRY];
    function addSpanishFilter(originalFilter) {
      if (!originalFilter) return spatialFilter;
      return ['all', originalFilter, spatialFilter];
    }

    if (Array.isArray(style.layers)) {
      for (var i = 0; i < style.layers.length; i++) {
        var layer = style.layers[i];
        if (!layer || !layer.layout) continue;
        if (!layer.layout['text-field']) continue;
        // 1) Castellano siempre
        layer.layout['text-field'] = patchGet(layer.layout['text-field']);
        // 2) Solo dentro de Espana
        layer.filter = addSpanishFilter(layer.filter);
      }
    }

    // Montamos el vector tile layer y lo swap-eamos por el raster claro.
    // minZoom/maxZoom: el bridge maplibre-gl-leaflet valida que el layer
    // conozca sus limites de zoom — sin ellos lanza "Map has no maxZoom".
    var libertyLayer = L.maplibreGL({
      style: style,
      minZoom: 5,
      maxZoom: 20,
      attribution: '&copy; <a href="https://openfreemap.org/">OpenFreeMap</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    });
    var wasLight = map.hasLayer(mapLayers.light);
    if (wasLight) map.removeLayer(mapLayers.light);
    mapLayers.light = libertyLayer;
    if (wasLight) libertyLayer.addTo(map);

    // Liberty ya trae toda la toponimia en castellano y limitada a Espana:
    // la capa SPAIN_LABELS solo duplicaria texto. La desactivamos en modo claro.
    if (labelLayer && wasLight) {
      map.removeLayer(labelLayer);
      labelLayer = null;
      map.off('zoomend', renderLabels);
    }
  } catch (e) {
    // Silent — nos quedamos con el raster + SPAIN_LABELS que ya estan activos.
  }
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
var routeCorridorLayer = null; // L.layerGroup con TODAS las gasolineras del corredor (toggle)
var routeCorridor = [];        // array de { item, kmFromOrigin, offKm, priceEurL } del corredor
var routeCorridorVisible = false;  // estado del toggle "ver todas en ruta"
var routeModeActive = false;   // estado para evitar doble-entrada

// Estado nuevo: posicion del usuario (tras geolocalizar), ahorro.
var userPos = null;                         // { lat, lng } tras geolocate
var userPosMarker = null;                   // circleMarker del usuario en el mapa (para removerlo al salir del modo geo)
var currentMedianPrice = null;              // mediana del listado filtrado actual
var topCheapIds = {};                       // ids de las 3 estaciones mas baratas (para medallas)

// Ship 6: estado del heatmap. Se alterna desde el boton flotante
// #btn-heatmap — renderMarkers inspecciona heatMode para decidir si pinta
// la capa de calor o el cluster.
var heatMode = false;
var heatLayer = null;

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

// Mapeo claves Ministerio → codigos cortos aceptados por POST /api/reports/price
// (whitelist REPORT_FUELS en src/index.tsx). Sin este map, el cliente empaquetaba
// la clave larga ("Precio Gasolina 95 E5") en data-pop-report y el server
// respondia 400 "bad fuel" porque la whitelist son codigos ('95', 'diesel', ...).
// Si la clave no esta aqui, no pintamos el boton de reportar — asi el usuario
// no se come un 400 opaco.
var REPORT_FUEL_CODES = {
  'Precio Gasolina 95 E5':              '95',
  'Precio Gasolina 98 E5':              '98',
  'Precio Gasoleo A':                   'diesel',
  'Precio Gasoleo Premium':             'diesel_plus',
  'Precio Gases licuados del petroleo': 'glp',
  'Precio Gas Natural Comprimido':      'gnc',
  'Precio Gas Natural Licuado':         'gnl',
  'Precio Hidrogeno':                   'hidrogeno',
  'Precio Diesel Renovable':            'diesel_renov'
};

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
  var p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  var lowBadge = '';
  var highBadge = '';
  if (currentPrice && sorted.length >= 5) {
    // El +/- 0.0005 absorbe redondeos de eurosToCents en el servidor (precios
    // son multiplos de 0.001 €/L en las dos puntas).
    if (currentPrice <= p10 + 0.0005) {
      lowBadge = '<div class="hist-lowbadge">\u{1F3C6} Precio historicamente bajo</div>';
    } else if (currentPrice >= p90 - 0.0005) {
      // Senal inversa: si ha estado mas barato la mayoria de dias, espera;
      // el combustible en Espana suele volver a su banda en 1-2 semanas.
      highBadge = '<div class="hist-highbadge">\u{1F4B8} Precio historicamente alto</div>';
    }
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
    + lowBadge
    + highBadge;
}

// Ship 10: calcula el percentil del precio dentro del conjunto filtrado.
// Devuelve:
//   { rank, pct, cheaperThanPct, quintile, total }
// donde:
//   rank            → posicion 1-based (1 = mas barato)
//   pct             → percentil [0..100] del precio (0 = mas barato, 100 = mas caro)
//   cheaperThanPct  → % de estaciones a las que supera en barato (pct invertido)
//   quintile        → 0..4 (0 = top 20% mas barato, 4 = bottom 20%)
//   total           → N de estaciones con precio valido en el conjunto
// Devuelve null si no hay >=3 estaciones con precio (histograma sin sentido).
function computePricePercentile(price, stations, fuel) {
  if (!price || !stations || !fuel) return null;
  var prices = [];
  for (var i = 0; i < stations.length; i++) {
    var p = parsePrice(stations[i][fuel]);
    if (p != null) prices.push(p);
  }
  if (prices.length < 3) return null;
  prices.sort(function(a, b) { return a - b; });
  // Rank: primer indice donde prices[idx] >= price. 1-based.
  var rank = 1;
  for (var j = 0; j < prices.length; j++) {
    if (prices[j] < price) rank = j + 2;
    else break;
  }
  if (rank > prices.length) rank = prices.length;
  // pct 0..100: donde cae el precio en la distribucion. 0 = mas barato posible.
  var pct = ((rank - 1) / Math.max(1, prices.length - 1)) * 100;
  if (pct < 0) pct = 0; if (pct > 100) pct = 100;
  var cheaperThanPct = Math.max(0, Math.min(100, Math.round(100 - pct)));
  var quintile = Math.min(4, Math.floor(pct / 20));
  return {
    rank: rank, pct: pct, cheaperThanPct: cheaperThanPct,
    quintile: quintile, total: prices.length
  };
}

// Dibuja un mini-histograma en 5 bins (quintiles) con marcador en la posicion
// de la estacion. Colores: verde (top 20%) → rojo (peor 20%), pasando por
// amarillo/naranja. El marcador es una linea vertical negra/blanca (adaptada a
// dark) en la posicion proporcional al percentil.
function buildPercentileHistogram(info) {
  if (!info) return '';
  var bins = [
    '<div class="ph-bin ph-bin--q0"></div>',
    '<div class="ph-bin ph-bin--q1"></div>',
    '<div class="ph-bin ph-bin--q2"></div>',
    '<div class="ph-bin ph-bin--q3"></div>',
    '<div class="ph-bin ph-bin--q4"></div>'
  ].join('');
  // Clamp marker al [2%..98%] para que no desaparezca en los bordes con el
  // knob de 10px de diametro (centrado via translateX(-50%)).
  var rawPct = typeof info.pct === 'number' && isFinite(info.pct) ? info.pct : 0;
  var markerPct = Math.max(2, Math.min(98, rawPct));
  var label;
  if (info.rank === 1) {
    label = '\u{1F3C6} La m\u00E1s barata de su zona (' + info.total + ' estaciones)';
  } else if (info.quintile === 0) {
    label = 'Top 20% m\u00E1s barato \u2014 m\u00E1s barata que el ' + info.cheaperThanPct + '% (' + info.total + ')';
  } else if (info.quintile === 4) {
    label = 'Peor 20% \u2014 solo supera al ' + info.cheaperThanPct + '% (' + info.total + ')';
  } else {
    label = 'M\u00E1s barata que el ' + info.cheaperThanPct + '% de su zona (' + info.total + ')';
  }
  var markerTitle = 'T\u00FA: posici\u00F3n ' + info.rank + ' de ' + info.total;
  // IMPORTANTE: no usamos style="left:X%" inline porque el CSP (style-src sin
  // 'unsafe-inline') los bloquea y el marcador acaba en left:auto = 0 (extremo
  // izquierdo, zona verde) aunque el precio sea el mas caro. En su lugar
  // guardamos el porcentaje en data-pct y el handler de popupopen aplica
  // element.style.left en runtime (asignacion JS no cae bajo style-src).
  // Ver commit que corrige este bug para contexto completo.
  return '<div class="popup-percentile" aria-label="' + esc(label) + '">'
       +   '<div class="ph-track">'
       +     '<div class="ph-bins">' + bins + '</div>'
       +     '<div class="ph-marker" title="' + esc(markerTitle) + '" data-pct="' + markerPct.toFixed(1) + '"></div>'
       +   '</div>'
       +   '<div class="ph-label ph-label--q' + info.quintile + '">' + label + '</div>'
       + '</div>';
}

// Ship 25.6 (fix) — Aplica el left:X% del marcador via JS una vez que el
// popup esta en el DOM. Se llama desde el handler de popupopen en
// renderMarkers/features. Esta separacion existe porque CSP con style-src sin
// 'unsafe-inline' strippea los style inline del HTML y el marcador acabaria
// siempre en la zona verde (left default=0) aunque el precio fuese el mas caro.
function applyPercentileMarkerPos(popupNode) {
  if (!popupNode) return;
  var nodes = popupNode.querySelectorAll('.ph-marker[data-pct]');
  for (var i = 0; i < nodes.length; i++) {
    var pct = parseFloat(nodes[i].getAttribute('data-pct'));
    if (isFinite(pct)) nodes[i].style.left = pct.toFixed(1) + '%';
  }
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

  // Ship 25.6: Badge "Solo socios" para Costco. El Ministerio publica sus
  // precios (obligados por ley) pero repostar requiere tarjeta Costco Club.
  // Aviso en el popup para que el usuario no conduzca hasta ahi sin saberlo.
  var rotuloUpper = (s['Rotulo'] || '').toUpperCase();
  if (rotuloUpper.indexOf('COSTCO') >= 0) {
    statusHtml = (statusHtml ? statusHtml + ' ' : '')
      + '<span class="status-chip status-members">\u{1F511} Solo socios Costco Club</span>';
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

  // Acciones (fav, share, copiar, comparar)
  // El boton "Comparar" cambia de label segun si la estacion ya esta en la
  // seleccion. Dos clicks consecutivos sobre la misma estacion la toggle
  // (anadir/quitar), y al llegar a 2 el siguiente click abre el modal en
  // vez de apilar una 3a (vease handler en el delegado).
  var inCompare = compareIds && compareIds.indexOf(id) !== -1;
  var actionBtns =
      '<div class="popup-actions">'
    + '  <button data-pop-fav="' + esc(id) + '" aria-pressed="' + fav + '" aria-label="' + (fav ? 'Quitar de favoritas' : 'A\u00f1adir a favoritas') + '">'
    + (fav ? '\u2605 Favorita' : '\u2606 Guardar')
    + '  </button>'
    + '  <button data-pop-compare="' + esc(id) + '" aria-pressed="' + inCompare + '" aria-label="' + (inCompare ? 'Quitar de comparativa' : 'A\u00f1adir a comparativa') + '">'
    + (inCompare ? '\u2696\uFE0F En comparativa' : '\u2696\uFE0F Comparar')
    + '</button>'
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

  // Ship 8: link de reporte. Solo lo mostramos si hay precio publicado — si
  // no hay, no tiene sentido reportar "precio incorrecto". data-pop-report
  // lleva el contexto minimo (id|fuelCode|precio|rotulo) para que el handler en
  // features.ts abra el modal con los datos prefijados sin pasar por lookup.
  // fuelCode = codigo corto ('95','diesel',...) — el server valida contra la
  // misma whitelist (REPORT_FUELS). Si el combustible seleccionado no tiene
  // traduccion conocida, no pintamos el boton.
  var reportLink = '';
  var reportFuelCode = REPORT_FUEL_CODES[fuel];
  if (mainPrice && reportFuelCode) {
    var repPayload = id + '|' + reportFuelCode + '|' + mainPrice.toFixed(3) + '|' + (s['Rotulo'] || 'Gasolinera');
    reportLink = '<button class="popup-report-link" data-pop-report="' + esc(repPayload) + '" type="button">'
               + '\u{1F6A9} Reportar precio incorrecto'
               + '</button>';
  }

  // Ship 10: mini-histograma de posicion (percentil) del precio dentro del
  // conjunto filtrado actual. Contexto relativo inmediato — "esta gasolinera
  // es la mas barata de tu busqueda" / "te quedan 10% mas baratas". Solo
  // sobre filteredStations porque la comparacion tiene que ser con lo que el
  // usuario esta viendo (si filtra REPSOL, percentil dentro de REPSOL).
  var percentileHtml = '';
  if (mainPrice && filteredStations && filteredStations.length >= 3) {
    var pInfo = computePricePercentile(mainPrice, filteredStations, fuel);
    if (pInfo) percentileHtml = buildPercentileHistogram(pInfo);
  }

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
    + percentileHtml
    + reportLink
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
// Ship 6: cache de las estaciones renderizadas para poder re-renderizar al
// togglear el heatmap sin tener que re-disparar loadStations.
var lastRenderedStations = [];
function renderMarkers(stations) {
  lastRenderedStations = stations || [];
  if (clusterGroup) map.removeLayer(clusterGroup);
  if (typeof heatLayer !== 'undefined' && heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }

  var fuel = document.getElementById('sel-combustible').value;
  var prices = stations.map(function(s) { return parsePrice(s[fuel]); }).filter(function(p) { return p !== null; });
  minP = prices.length ? Math.min.apply(null, prices) : 0;
  maxP = prices.length ? Math.max.apply(null, prices) : 0;

  // Ship 6: modo heatmap. Si el usuario tiene activa la vista de calor y
  // leaflet.heat esta cargado, renderizamos la capa de calor en lugar del
  // cluster. Cada punto lleva peso = (maxP - price) / (maxP - minP) — asi
  // el precio MINIMO tiene peso 1 (mas caliente) y el MAXIMO peso 0 (frio).
  // Fallback: si leaflet.heat no esta (red offline durante primera carga),
  // caemos al cluster normal. Nunca rompemos la pagina.
  if (heatMode && typeof L.heatLayer === 'function' && stations.length > 0) {
    var heatPoints = [];
    var range = maxP - minP || 1;
    stations.forEach(function(s) {
      var lat = parseFloat((s['Latitud'] || '').replace(',', '.'));
      var lng = parseFloat((s['Longitud (WGS84)'] || '').replace(',', '.'));
      if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) return;
      var p = parsePrice(s[fuel]);
      if (p === null) return;
      var w = Math.max(0.05, (maxP - p) / range);
      heatPoints.push([lat, lng, w]);
    });
    if (heatPoints.length > 0) {
      heatLayer = L.heatLayer(heatPoints, {
        radius: 25, blur: 18, maxZoom: 13, minOpacity: 0.35,
        // Gradient inverso: valor alto (barato) = rojo; valor bajo (caro) = azul.
        gradient: { 0.1: '#1e40af', 0.3: '#06b6d4', 0.5: '#84cc16', 0.7: '#facc15', 0.9: '#f97316', 1.0: '#dc2626' },
      });
      heatLayer.addTo(map);
      // Mantenemos fitBounds para centrar igual que en modo cluster.
      try {
        var bnds = heatPoints.map(function(pt) { return [pt[0], pt[1]]; });
        if (bnds.length) map.fitBounds(bnds, Object.assign({}, mapAnimOpts(), { padding: [40, 40], maxZoom: 13 }));
      } catch(e) {}
      return;
    }
  }

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
        // CSP (style-src sin 'unsafe-inline') bloquea style="" del HTML
        // asi que aplicamos el left% del ph-marker via JS.
        applyPercentileMarkerPos(node);
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
    try { map.fitBounds(bounds, Object.assign({}, mapAnimOpts(), { padding: [40, 40], maxZoom: 14 })); }
    catch(e) {}
  }
}

function highlightCard(idx) {
  document.querySelectorAll('.station-card').forEach(function(el) { el.classList.remove('active'); });
  var card = document.querySelector('[data-idx="' + idx + '"]');
  if (card) {
    card.classList.add('active');
    card.scrollIntoView({ behavior: scrollBehavior('smooth'), block: 'nearest' });
  }
}

// Ship 6: toggle del heatmap. Re-renderiza con las ultimas estaciones
// cacheadas en renderMarkers — si el usuario tiene filtros aplicados, el
// heatmap refleja SOLO esas estaciones (mas util que el agregado global).
(function() {
  var btn = document.getElementById('btn-heatmap');
  if (!btn) return;
  btn.addEventListener('click', function() {
    // Defensive: si leaflet.heat no cargo (red caida, CSP, etc.), informa y
    // no togglea. Asi el boton nunca da una experiencia silenciosa rota.
    if (!heatMode && typeof L.heatLayer !== 'function') {
      try { if (typeof showToast === 'function') showToast('El mapa de calor aun esta cargando, prueba en un segundo', 'warn'); } catch(_) {}
      return;
    }
    heatMode = !heatMode;
    btn.setAttribute('aria-pressed', heatMode ? 'true' : 'false');
    btn.setAttribute('aria-label', heatMode ? 'Desactivar mapa de calor' : 'Activar mapa de calor de precios');
    if (lastRenderedStations.length) {
      renderMarkers(lastRenderedStations);
    }
    try {
      if (typeof showToast === 'function') {
        showToast(heatMode
          ? 'Mapa de calor: rojo = mas barato, azul = mas caro'
          : 'Volviendo a vista de agrupaciones', 'info');
      }
    } catch (_) {}
  });
})();

// ---- Ship 25.5: PUNTOS DE RECARGA ELECTRICA (OpenChargeMap) ----
//
// Lazy-load: el snapshot /data/chargers.json (~400KB gzip) solo se descarga
// cuando el usuario toca el boton #btn-chargers. Los usuarios con coche de
// combustion no pagan ese coste de red.
//
// Capa separada del clusterGroup de gasolineras: los precios y los
// recargadores son dominios distintos y mezclarlos en un solo cluster
// confundiria los iconos (precio €/L vs potencia kW). Toggle on/off añade/
// quita la capa; los datos quedan cacheados en memoria hasta recarga de
// pagina.
var chargersLayer = null;        // L.markerClusterGroup (null = aun no se ha tocado el toggle)
var chargersDataLoaded = false;  // evita re-fetch si el usuario abre/cierra varias veces
var chargersVisible = false;

// Normaliza kW a una clase de pin (afecta color y etiqueta):
//   <50 kW  → normal (AC / slow DC)
//   50-149  → fast   (DC rapido tipico CCS/CHAdeMO hasta 149)
//   >=150   → ultra  (hipercargadores, Tesla V3, CCS 250+)
function chargerClass(kw) {
  if (kw >= 150) return 'ultra';
  if (kw >= 50)  return 'fast';
  return 'normal';
}

function chargerPinIcon(kw) {
  var klass = chargerClass(kw);
  var cls = 'charger-pin' + (klass === 'normal' ? '' : ' charger-pin--' + klass);
  return L.divIcon({
    html: '<div class="' + cls + '" aria-hidden="true">\u26A1</div>',
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13]
  });
}

// Escapa HTML para el popup (no hay escapeHtml global accesible aqui, pero
// sí existe esc() definida mas arriba en este mismo modulo).
function chargerPopupHTML(entry) {
  // entry = [lat, lng, title, operator, maxKw, connectors]
  var title = esc(entry[2] || 'Recargador eléctrico');
  var op    = entry[3] ? esc(entry[3]) : '';
  var kw    = entry[4] || 0;
  var conns = entry[5] || '';
  var kwClass = chargerClass(kw);
  var kwExtraCls = kwClass === 'normal' ? '' : ' charger-popup-kw--' + kwClass;
  var kwLabel = kw > 0 ? kw + ' kW' : 'N/D';
  var kwBadge = kwClass === 'ultra' ? ' (ultra)' : (kwClass === 'fast' ? ' (rápido)' : '');
  return '<div class="charger-popup">'
       +   '<div class="charger-popup-title">\u26A1 ' + title + '</div>'
       +   (op ? '<div class="charger-popup-op">' + op + '</div>' : '')
       +   '<div class="charger-popup-row">'
       +     '<span class="charger-popup-label">Potencia</span>'
       +     '<span class="charger-popup-value charger-popup-kw' + kwExtraCls + '">' + kwLabel + kwBadge + '</span>'
       +   '</div>'
       +   (conns
            ? '<div class="charger-popup-row">'
              + '<span class="charger-popup-label">Conectores</span>'
              + '<span class="charger-popup-value">' + esc(conns) + '</span>'
              + '</div>'
            : '')
       +   '<div class="charger-popup-row">'
       +     '<span class="charger-popup-label">Fuente</span>'
       +     '<span class="charger-popup-value" style="font-size:11px;font-weight:500;opacity:0.7">OpenStreetMap</span>'
       +   '</div>'
       + '</div>';
}

function buildChargersLayer(chargers) {
  // Cluster azul con contador de puntos — mismo patron visual que las
  // gasolineras pero sin badge de precio.
  var layer = L.markerClusterGroup({
    maxClusterRadius: 60,
    iconCreateFunction: function(cluster) {
      var count = cluster.getChildCount();
      var sz = count > 200 ? 52 : count > 50 ? 44 : 36;
      return L.divIcon({
        html: '<div class="charger-cluster" style="width:' + sz + 'px;height:' + sz + 'px">' + count + '</div>',
        className: '',
        iconSize: [sz, sz],
        iconAnchor: [sz / 2, sz / 2]
      });
    }
  });

  chargers.forEach(function(c) {
    var lat = c[0], lng = c[1];
    if (typeof lat !== 'number' || typeof lng !== 'number') return;
    var kw = c[4] || 0;
    var m = L.marker([lat, lng], { icon: chargerPinIcon(kw) });
    // Bind popup lazy: solo construimos el HTML cuando se abre el popup, no
    // al crear 18k markers. Ahorra mucho tiempo de render inicial.
    m.bindPopup(function() { return chargerPopupHTML(c); }, {
      maxWidth: 280,
      className: 'charger-leaflet-popup'
    });
    layer.addLayer(m);
  });

  return layer;
}

// Fetch del snapshot (una sola vez por sesion) + toggle on/off.
(function() {
  var btn = document.getElementById('btn-chargers');
  if (!btn) return;

  function setLoading(isLoading) {
    if (isLoading) {
      btn.setAttribute('data-loading', '1');
      btn.style.opacity = '0.6';
      btn.style.cursor = 'wait';
    } else {
      btn.removeAttribute('data-loading');
      btn.style.opacity = '';
      btn.style.cursor = '';
    }
  }

  function loadChargersOnce() {
    if (chargersDataLoaded) return Promise.resolve(chargersLayer);
    setLoading(true);
    return fetch('/data/chargers.json', { cache: 'force-cache' })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function(data) {
        var arr = (data && Array.isArray(data.chargers)) ? data.chargers : [];
        chargersLayer = buildChargersLayer(arr);
        chargersDataLoaded = true;
        setLoading(false);
        try {
          if (typeof showToast === 'function') {
            if (arr.length) {
              showToast('Cargados ' + arr.length + ' puntos de recarga', 'info');
            } else {
              showToast('Aun no hay snapshot de recargadores — vuelve en unos minutos', 'warn');
            }
          }
        } catch (_) {}
        return chargersLayer;
      })
      .catch(function(e) {
        setLoading(false);
        console.warn('[chargers] fetch fallo:', e && e.message);
        try {
          if (typeof showToast === 'function') {
            showToast('No se pudo cargar el mapa de recargadores', 'warn');
          }
        } catch (_) {}
        return null;
      });
  }

  btn.addEventListener('click', function() {
    // Caso 1: primer click, aun no hay datos → carga y muestra.
    if (!chargersDataLoaded) {
      loadChargersOnce().then(function(layer) {
        if (!layer) return;  // error ya notificado
        map.addLayer(layer);
        chargersVisible = true;
        btn.setAttribute('aria-pressed', 'true');
        btn.setAttribute('aria-label', 'Ocultar puntos de recarga electrica');
      });
      return;
    }
    // Caso 2: datos ya en memoria, toggle rapido add/remove de capa.
    if (chargersVisible) {
      if (chargersLayer) map.removeLayer(chargersLayer);
      chargersVisible = false;
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-label', 'Mostrar puntos de recarga para coche electrico');
    } else {
      if (chargersLayer) map.addLayer(chargersLayer);
      chargersVisible = true;
      btn.setAttribute('aria-pressed', 'true');
      btn.setAttribute('aria-label', 'Ocultar puntos de recarga electrica');
    }
  });
})();

`
