// Bumping este nombre invalida automaticamente la cache anterior (el listener
// 'activate' borra todo lo que no coincide con CACHE_NAME). Subir version en
// cada release de UX que cambie el shell HTML/CSS/JS inlineado — asi los
// usuarios con una vieja pagina cacheada reciben la nueva al siguiente navigate.
const CACHE_NAME = 'gasolineras-v10';
const TILE_CACHE = CACHE_NAME + '-tiles';
// Cap defensivo contra crecimiento ilimitado de la cache de tiles (DoS de almacenamiento).
const TILE_CACHE_MAX = 400;

// Recursos estáticos a cachear en instalación
const STATIC_ASSETS = [
  '/',
  '/manifest.json',
  '/static/favicon.svg',
  '/static/logo.svg',
  '/static/apple-touch-icon.png',
  '/static/icon-192.png',
  '/static/icon-512.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js',
  'https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css',
];

// Instalar: cachear recursos estáticos
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)))
    )
  );
});

// Activar: limpiar caches antiguas (incluyendo las de tiles huerfanas)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME && k !== TILE_CACHE).map(k => caches.delete(k)))
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

// Fetch: estrategia por tipo de recurso
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Proxy API local /api/* → Network only (nunca cachear — datos en tiempo real)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() => new Response(JSON.stringify({ error: 'offline' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
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
