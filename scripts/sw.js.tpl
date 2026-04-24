// ATENCION: este fichero es una PLANTILLA. scripts/gen-sw.mjs lo lee y genera
// public/sw.js substituyendo el placeholder (ver const CACHE_NAME abajo) por
// APP_VERSION + short SHA de git. No edites public/sw.js directamente —
// esta gitignoreado y se regenera en cada prebuild.
//
// Motivo: antes CACHE_NAME era un literal 'gasolineras-vXX' que habia que
// subir a mano en cada release. Si se olvidaba, el listener 'activate' no
// purgaba nada (mismo nombre de cache) y los usuarios seguian sirviendo
// HTML/JS viejos desde la cache hasta que borraban cookies. Ahora el build
// id es unico por commit -> toda release nueva invalida la cache vieja y
// el usuario recibe la pagina fresca en el proximo navigate sin tocar nada.
const CACHE_NAME = 'gasolineras-__BUILD_ID__';
const TILE_CACHE = CACHE_NAME + '-tiles';
// Cache de respuestas API (snapshots por provincia / bbox). Network-first con
// fallback a cache cuando el usuario esta offline. Separada de TILE/STATIC
// para poder aplicar un LRU distinto y evitar que snapshots viejos expulsen
// tiles utiles o viceversa.
const API_CACHE = CACHE_NAME + '-api';
// Cap defensivo contra crecimiento ilimitado de la cache de tiles (DoS de almacenamiento).
const TILE_CACHE_MAX = 400;
// Cap de snapshots API: 24 entradas cubren con holgura los casos de uso:
// provincia del usuario + algunas consultadas recientemente + varias bbox
// del planificador de rutas. Suficiente para que tras un viaje reciente la
// app siga funcionando offline. Mas seria acumular ruido.
const API_CACHE_MAX = 24;

// Recursos estáticos a cachear en instalación.
// Las librerias del mapa se sirven desde /static/vendor/map/* (ver shell.ts
// y scripts/fetch-map-vendor.mjs). FontAwesome sigue viniendo de jsdelivr
// porque pesa y no justifica autohost por ahora.
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/static/favicon.svg',
  '/static/logo.svg',
  '/static/apple-touch-icon.png',
  '/static/icon-192.png',
  '/static/icon-512.png',
  // Ship 1: features.js se carga con ?v=X.Y.Z en produccion para cache-busting.
  // Precacheamos la URL sin query — el fetch handler (cache-first) servira
  // este mismo blob aunque llegue con query distinta porque ignoraremos la
  // query al hacer match (ver cache-first handler con {ignoreSearch:true}).
  '/static/features.js',
  '/static/vendor/map/leaflet/leaflet.css',
  '/static/vendor/map/leaflet/leaflet.js',
  '/static/vendor/map/leaflet.markercluster/MarkerCluster.css',
  '/static/vendor/map/leaflet.markercluster/MarkerCluster.Default.css',
  '/static/vendor/map/leaflet.markercluster/leaflet.markercluster.js',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css',
];

// Instalar: cachear recursos estáticos + auto-promocion.
//
// v18: volvemos a skipWaiting() automatico. El modelo "toast -> Actualizar"
// dejaba a algunos usuarios con SW viejo activo indefinidamente (ignoraban
// el toast) cuyos HTMLs cacheados generaban violaciones CSP + errores
// 'Response body is already used' permanentes. Coste: si el usuario tiene
// un modal abierto al deployar, se recargara bajo sus pies. Beneficio:
// nunca mas se queda con un SW viejo sirviendo codigo roto. Trade-off
// aceptado porque la consola llena de errores es peor UX.
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)))
    )
  );
});

// Mensajes desde el cliente. Ship 14: SKIP_WAITING para promover el SW nuevo
// cuando el usuario acepta actualizar. Ignoramos cualquier otro tipo de
// mensaje — una extension o un iframe no confiable podria postMessage-ear
// cosas raras; whitelist estricto.
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Activar: limpiar caches antiguas (incluyendo las de tiles/API huerfanas)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE && k !== API_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Limita el tamano de la cache de tiles (LRU aproximado: borra los mas antiguos).
async function trimTileCache() {
  try {
    const cache = await caches.open(TILE_CACHE);
    const keys = await cache.keys();
    if (keys.length <= TILE_CACHE_MAX) return;
    const excess = keys.length - TILE_CACHE_MAX;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch (e) { /* no-op */ }
}

// Mismo LRU para el cache de snapshots API. Llamado tras cada put exitoso.
async function trimApiCache() {
  try {
    const cache = await caches.open(API_CACHE);
    const keys = await cache.keys();
    if (keys.length <= API_CACHE_MAX) return;
    const excess = keys.length - API_CACHE_MAX;
    for (let i = 0; i < excess; i++) await cache.delete(keys[i]);
  } catch (e) { /* no-op */ }
}

// Decide que endpoints /api/* merecen cacheado offline. Listado conservador:
//   - /api/estaciones             -> snapshot full (raro, pero puede ocurrir)
//   - /api/estaciones/provincia   -> snapshot filtrado por provincia (hot path)
//   - /api/estaciones/bbox        -> usado por el planificador de rutas
//   - /api/history/*              -> datos historicos, valiosos sin red
//   - /api/predict/*              -> predictor, no critico pero ayuda UX
// Explicitamente NO cacheamos:
//   - /api/ingest (POST)          -> escritura, sin sentido offline
//   - /api/geocode/*              -> peticion puntual, cambia por query
//   - /api/route                  -> OSRM ya cachea server-side 24h
//   - /api/health                 -> debe reflejar estado actual
function shouldCacheApi(url) {
  if (url.pathname.startsWith('/api/estaciones')) return true;
  if (url.pathname.startsWith('/api/history/')) return true;
  if (url.pathname.startsWith('/api/predict/')) return true;
  // Ship 15: stats nacionales. Cambian solo 1 vez/dia con el cron — cachear
  // offline tiene sentido (el widget sigue pintando precios aun sin red).
  if (url.pathname.startsWith('/api/stats/')) return true;
  return false;
}

// Fetch: estrategia por tipo de recurso
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Proxy API local /api/*:
  //   - Endpoints de lectura whitelisted (shouldCacheApi) -> Network-first con
  //     fallback a la ultima respuesta cacheada. La respuesta servida desde
  //     cache lleva la cabecera 'X-Cache-Source: sw' para que el cliente
  //     pueda avisar al usuario ("datos de hace X" / "sin conexion") si
  //     quiere. TTL no se aplica aqui — preferimos mostrar datos viejos que
  //     un error cuando no hay red.
  //   - Resto de /api/* (POST, health, geocode, route, etc.) -> Network-only
  //     con fallback a 503 JSON. Son operaciones volatiles que no tienen
  //     sentido offline.
  if (url.pathname.startsWith('/api/')) {
    if (request.method === 'GET' && shouldCacheApi(url)) {
      event.respondWith(
        fetch(request).then(res => {
          // Solo cacheamos respuestas completas (200 OK). Un 503 con
          // "stale=true" del health o un 429 no deberian quedarse pegados
          // como "ultimo bueno".
          if (res.ok) {
            const clone = res.clone();
            caches.open(API_CACHE).then(cache => cache.put(request, clone)).then(trimApiCache).catch(() => {});
          }
          return res;
        }).catch(() => caches.open(API_CACHE).then(cache => cache.match(request)).then(cached => {
          if (cached) {
            // Clonamos para no consumir el body original y anadimos la
            // cabecera X-Cache-Source (el cliente puede leerla via
            // fetch().then(r => r.headers.get(...))).
            return cached.blob().then(blob => new Response(blob, {
              status: cached.status,
              statusText: cached.statusText,
              headers: (() => {
                const h = new Headers(cached.headers);
                h.set('X-Cache-Source', 'sw');
                return h;
              })()
            }));
          }
          return new Response(JSON.stringify({ error: 'offline' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json', 'X-Cache-Source': 'none' }
          });
        }))
      );
      return;
    }
    // Resto de /api/*: network-only con fallback 503 JSON (comportamiento previo).
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json', 'X-Cache-Source': 'none' }
      }))
    );
    return;
  }

  // API del Ministerio → Network only (datos en tiempo real)
  if (url.hostname.includes('minetur.gob.es')) {
    event.respondWith(fetch(request).catch(() => new Response('{"error":"offline"}', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // Nominatim geocoding → Network only
  if (url.hostname.includes('nominatim.openstreetmap.org')) {
    event.respondWith(fetch(request).catch(() => new Response('[]', { headers: { 'Content-Type': 'application/json' } })));
    return;
  }

  // HTML navigations (app shell) → Network FIRST, cache fallback
  // Evita servir codigo viejo al usuario
  const isHTML = request.mode === 'navigate' ||
                 (request.method === 'GET' && request.headers.get('accept') && request.headers.get('accept').includes('text/html'));
  if (isHTML && url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request).then(r => r || caches.match('/')))
    );
    return;
  }

  // Tiles del mapa → Stale While Revalidate
  // Incluye basemaps.cartocdn.com (usado por client.ts como tema claro/oscuro).
  // Sin esta entrada los tiles de Carto caian en el catch-all cache-first y se congelaban.
  const isTileHost =
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.endsWith('.basemaps.cartocdn.com');
  if (isTileHost) {
    event.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(request);
        const networkFetch = fetch(request).then(res => {
          if (res.ok) {
            cache.put(request, res.clone()).then(trimTileCache);
          }
          return res;
        }).catch(() => null);
        // Stale-while-revalidate: sirve cached pero dispara fetch en paralelo
        if (cached) { networkFetch; return cached; }
        return networkFetch;
      })
    );
    return;
  }

  // Ship 1: features.js llega con ?v=<APP_VERSION> para invalidar el cache
  // del navegador en cada release. Al matchear en la cache del SW usamos
  // ignoreSearch:true asi un shell cacheado con ?v=1.8.0 sigue sirviendose
  // mientras el nuevo ?v=1.8.1 se descarga en background (network-first
  // efectivo porque el put cachea la URL completa y la siguiente request
  // con la misma ?v hace hit directo).
  if (url.pathname === '/static/features.js') {
    event.respondWith(
      fetch(request).then(res => {
        if (res.ok && request.method === 'GET') {
          // Clonamos sincronamente aqui, antes de `return res`, para que
          // el body este disponible aun si el consumer agota `res` antes
          // de que `caches.open` resuelva. Si clonasemos dentro del then
          // async, a veces el body ya esta consumido -> TypeError.
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      }).catch(() => caches.match(request, { ignoreSearch: true }).then(c => c || caches.match('/static/features.js')))
    );
    return;
  }

  // Resto (app shell, librerías CDN) → Cache first, Network fallback
  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok && request.method === 'GET') {
          // Mismo motivo que arriba: clonar antes del async caches.open().
          const clone = res.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return res;
      }).catch(() => caches.match('/'));
    })
  );
});

// ============================================================
// Ship 25: Telegram sustituye Web Push.
// ============================================================
// Los listeners 'push', 'notificationclick' y 'pushsubscriptionchange' fueron
// eliminados en Ship 25. Las notificaciones de bajada de precio ahora llegan
// via bot de Telegram (ver src/lib/telegram.ts + /api/cron/telegram-check).
// Ventajas respecto a Web Push:
//   - Funciona en iOS Safari y otros navegadores sin soporte Push.
//   - No requiere permisos del navegador ni SW activo para recibirlas.
//   - El usuario puede silenciar/reanudar desde la propia app de Telegram.
// Bumping CACHE_NAME (ahora via __BUILD_ID__) purga estos listeners de los clientes ya instalados.
