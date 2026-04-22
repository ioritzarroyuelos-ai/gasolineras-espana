// Bumping este nombre invalida automaticamente la cache anterior (el listener
// 'activate' borra todo lo que no coincide con CACHE_NAME). Subir version en
// cada release de UX que cambie el shell HTML/CSS/JS inlineado — asi los
// usuarios con una vieja pagina cacheada reciben la nueva al siguiente navigate.
const CACHE_NAME = 'gasolineras-v15';
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

// Recursos estáticos a cachear en instalación
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
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css',
];

// Instalar: cachear recursos estáticos.
//
// Ship 14: YA NO llamamos skipWaiting() aqui. Razon: saltar automaticamente el
// waiting puede romper una pestana abierta que esta a mitad de una interaccion
// (popups, modales, streams). Preferimos:
//   1. El nuevo SW queda 'installed' pero waiting.
//   2. El cliente detecta 'updatefound' y muestra un toast 'Nueva version
//      disponible' con boton 'Actualizar'.
//   3. Al pulsar, el cliente envia postMessage({type:'SKIP_WAITING'}) y el SW
//      reacciona (handler mas abajo) haciendo skipWaiting() + clients.claim.
//   4. El cliente detecta 'controllerchange' y recarga la pestana.
// Asi el usuario controla cuando recibe la nueva version; evita el clasico
// "se me perdio el modal al recargar solo".
self.addEventListener('install', event => {
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
          caches.open(CACHE_NAME).then(cache => cache.put(request, res.clone()));
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
          caches.open(CACHE_NAME).then(cache => cache.put(request, res.clone()));
        }
        return res;
      }).catch(() => caches.match('/'));
    })
  );
});

// ============================================================
// Ship 23: PUSH NOTIFICATIONS (Web Push)
// ============================================================
// El servidor envia pushes SIN payload (ver src/lib/webpush.ts). El SW muestra
// una notif generica. Al clicar, intentamos focus a una tab ya abierta; si
// no hay, abrimos la app. Al abrir, el usuario ve los precios bajados
// resaltados en su lista de favoritos (la UI ya los pinta).
self.addEventListener('push', event => {
  // event.data puede ser null (sin payload) o texto cifrado (no manejamos).
  let title = '\u26FD Bajada de precio detectada';
  let body  = 'Tu gasolinera favorita ha bajado. Abre la app para verla.';
  if (event.data) {
    // Si algun dia enviamos payload, aceptamos texto plano como fallback.
    try {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') {
        if (typeof parsed.title === 'string') title = parsed.title;
        if (typeof parsed.body  === 'string') body  = parsed.body;
      }
    } catch (_) {
      try { body = event.data.text() || body; } catch (_) {}
    }
  }
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/static/icon-192.png',
      badge: '/static/favicon-32.png',
      tag: 'gs-price-drop',
      renotify: true,
      // Acciones: "ver" (open app) y "silenciar" (no-op, solo cierra). iOS/Safari
      // ignora actions pero se muestra en Android/desktop.
      actions: [
        { action: 'open',   title: 'Ver en la app' },
        { action: 'dismiss', title: 'Ignorar' }
      ],
      data: { url: '/' }
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      // Reusar una tab ya abierta — mas suave que abrir otra.
      for (const c of wins) {
        if (c.url && new URL(c.url).origin === self.location.origin) {
          return c.focus();
        }
      }
      return clients.openWindow(targetUrl);
    })
  );
});

// Pushsubscriptionchange: el browser puede rotar las claves de una suscripcion
// (ej. al expirar). Si no lo manejamos, los pushes empiezan a fallar con 410.
// Intentamos re-suscribirnos con el mismo applicationServerKey y mandarla al
// backend. Si falla, simplemente dejamos que el proximo subscribe manual lo
// arregle — no queremos quedar en estado inconsistente.
self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil((async () => {
    try {
      const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
      if (!key) return;
      const newSub = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
      // Nota: no sabemos aqui a que station/fuel estaba suscrito. El cliente
      // al abrir la app detectara la discrepancia y re-subscribira.
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(newSub.toJSON()),
      });
    } catch (_) { /* silencioso — el cliente se arreglara */ }
  })());
});
