# Gasolineras España

[![CI](https://github.com/YOUR_USER/YOUR_REPO/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![Snapshot](https://github.com/YOUR_USER/YOUR_REPO/actions/workflows/fetch-prices.yml/badge.svg)](../../actions/workflows/fetch-prices.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

PWA para consultar precios oficiales de gasolineras en España en tiempo real. Datos del **Ministerio para la Transición Ecológica y el Reto Demográfico**.

> **Producción**: https://gasolineras.pages.dev (reemplaza por tu URL real)

## Qué hace

- Mapa Leaflet con ~12.000 estaciones y clustering.
- Filtros por provincia, municipio, marca, combustible.
- **Cerca de mí** (Haversine) con radio configurable.
- **Comparador de ahorro**: calcula €/depósito vs. mediana de la zona.
- **Favoritos** con sparkline histórico en localStorage.
- **PWA**: instalable, offline-ready con snapshot diario como fallback.
- Accesibilidad AAA (navegación por teclado, ARIA, `prefers-reduced-motion`).
- Atajos de teclado: `/` buscar, `g` geolocalizar, `d` tema, `f` lugar, `?` ayuda.

## Stack

- **Hono** sobre **Cloudflare Pages Functions** (Workers runtime).
- **Vite** 6 con `@hono/vite-build` para SSR bundle.
- **TypeScript** strict.
- **Vitest** (tests unitarios) + **Playwright** + **axe-core** (E2E + a11y).
- **Lighthouse CI** con budgets de performance/SEO/accesibilidad.
- **Zod** para validación de esquemas en la frontera.
- **@resvg/resvg-js** para generar PNGs desde SVG en pre-build (sin tooling nativo).

## Arranque en local

```bash
# Node 20+
npm ci                 # instalar deps exactas
npm run test           # 27 tests unitarios
npm run typecheck      # tsc --noEmit
npm run build          # genera iconos PNG + bundle en dist/
npm run preview        # wrangler pages dev → http://127.0.0.1:8788
```

Para desarrollo con HMR:

```bash
npm run dev            # vite → http://127.0.0.1:5173
```

## Tests E2E

Los tests Playwright se corren contra el servidor de `wrangler pages dev`.

```bash
npx playwright install chromium --with-deps   # primera vez
npm run test:e2e                              # ejecuta la suite
npm run test:e2e -- --headed                  # con navegador visible
```

## Snapshot de datos del Ministerio

El endpoint `/api/*` proxea al Ministerio en tiempo real, pero si la API está caída se sirve un snapshot estático de fallback desde `public/data/stations.json`. Ese fichero se actualiza automáticamente dos veces al día por [`.github/workflows/fetch-prices.yml`](.github/workflows/fetch-prices.yml) (07:00 y 19:00 UTC). Si falla 3 ejecuciones seguidas, el **watchdog de freshness** marca el dataset como obsoleto y la UI muestra un banner amarillo.

Actualizar manualmente:

```bash
node scripts/fetch-prices.mjs
git add public/data && git commit -m "chore(data): snapshot manual"
```

## Deploy a Cloudflare Pages

```bash
wrangler login                          # una vez
npm run build
npm run deploy                          # wrangler pages deploy ./dist
```

Variables de entorno opcionales (define en el dashboard de Cloudflare Pages):

| Variable | Uso | Por defecto |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Turnstile en `/api/ingest` (opcional) | sin reto |
| `TURNSTILE_SITE_KEY` | Turnstile en cliente (opcional) | sin reto |

Ver [`.env.example`](./.env.example).

## Estructura

```
src/
  index.tsx              # Hono app (rutas HTML + /api/*)
  lib/
    pure.ts              # LRU, validateId, originAllowed, haversine, isOpenNow, SlidingWindowLimiter
    version.ts           # APP_VERSION
    schemas.ts           # Zod: StationSchema, MinistryResponseSchema, MunicipiosSchema
  html/
    shell.ts             # buildPage(nonce, reqUrl) — HTML shell con CSP nonce
    styles.ts            # CSS (getStyles)
    client.ts            # JS cliente (getClientScript)
public/
  manifest.json          # PWA manifest
  sw.js                  # Service Worker (caches v5)
  data/                  # snapshot del Ministerio (auto-actualizado por Action)
  static/                # favicon.svg, logo.svg, og.svg + PNGs generados
scripts/
  gen-icons.mjs          # Pre-build: SVG → PNG (apple-touch-icon, 192, 512, og)
  fetch-prices.mjs       # Fetch snapshot del Ministerio
tests/
  pure.test.ts           # 27 tests unitarios
  e2e/                   # Playwright + axe-core
.github/workflows/
  ci.yml                 # typecheck · test · build · Lighthouse · E2E
  fetch-prices.yml       # snapshot diario (08:00 + 20:00 Madrid)
```

## Seguridad

Ver [`SECURITY.md`](./SECURITY.md) para política de reporte de vulnerabilidades.

Hardening aplicado:
- CSP con nonce por request, sin `unsafe-inline` en scripts.
- SRI SHA-384 en todas las dependencias CDN.
- Validación estricta de IDs de entrada (regex `^\d{1,5}$`) — previene SSRF.
- Rate limiting por IP: 120 req/min en `/api/*`, 20 req/min en `/api/ingest` (local por Worker) + reglas de Cloudflare Rate Limiting (ver [`wrangler.jsonc`](./wrangler.jsonc)).
- Validación zod en la frontera: el servidor rechaza payloads del Ministerio que no casan con el esquema y emite `ministry.schema_drift` a los logs.
- `/.well-known/security.txt` conforme a RFC 9116.

## Contribuir

Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Licencia

[MIT](./LICENSE) — los datos son del Ministerio, reutilización libre bajo sus condiciones.
