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
| `HEALTH_ADMIN_TOKEN` | Gate del detalle de `/api/health` | todo publico en dev |
| `PUBLIC_ORIGIN` | Origen publico usado por `scheduled()` para leer snapshot | `https://webapp.pages.dev` |

Ver [`.env.example`](./.env.example).

## Historico de precios (D1)

Cada gasolinera muestra en su popup un **sparkline de los ultimos 30 dias** con stats (min/max/media), la **mediana provincial** como linea de referencia y un badge `Precio historicamente bajo` cuando el precio actual esta en el percentil ≤10% del periodo. Toggles `7d / 30d / 90d / 1a`.

Los datos viven en **Cloudflare D1** (SQLite managed, free tier 5 GB / 25M reads/dia). El binding se llama `DB` y la tabla es `price_history(station_id, fuel_code, date, price_cents)`.

### Setup inicial

```bash
# 1) Crear la BD (una sola vez, desde cualquier clone)
npx wrangler d1 create gasolineras-history
# → copia el `database_id` de la salida al `database_id` de wrangler.jsonc

# 2) Aplicar migraciones
npx wrangler d1 migrations apply gasolineras-history --remote

# 3) (Opcional) Backfill desde git log — carga ~180 dias historicos
npm run backfill:d1                                  # genera migrations/9999_backfill.sql
npx wrangler d1 execute gasolineras-history \
  --file=migrations/9999_backfill.sql --remote
```

### Cron (via GitHub Actions)

Cloudflare **Pages no soporta Cron Triggers nativos** (es una feature solo de Workers puros). Asi que los crons viven en GitHub Actions y disparan dos endpoints HTTP protegidos:

| Workflow | Horario | Endpoint | Que hace |
|---|---|---|---|
| `.github/workflows/cron-ingest.yml` | `0 20 * * *` | `POST /api/cron/ingest` | Lee `/data/stations.json` y upsertea precios del dia a D1 |
| `.github/workflows/cron-purge.yml`  | `0 3 * * 0`  | `POST /api/cron/purge`  | Borra filas con `date < hoy-2a` |

Ambos endpoints exigen `Authorization: Bearer <CRON_TOKEN>`.

**Setup del token** (una sola vez):

```bash
# 1. Generar el token
openssl rand -hex 32           # ej: "a264762e4ea0b28b79eac6b5e8086a07..."

# 2. Guardarlo en Cloudflare Pages (el Worker lo valida)
echo "<TU_TOKEN>" | npx wrangler pages secret put CRON_TOKEN --project-name=webapp

# 3. Guardarlo en GitHub Actions (los workflows lo envian en el header)
#    GitHub → Repo Settings → Secrets and variables → Actions → New secret
#      Name:  CRON_TOKEN
#      Value: <mismo token>

# 4. (Opcional) Variable PUBLIC_ORIGIN en GHA si tu dominio no es webapp.pages.dev
#    GitHub → Repo Settings → Secrets and variables → Actions → Variables
#      Name:  PUBLIC_ORIGIN
#      Value: https://tu-dominio.pages.dev
```

### Endpoints

| Metodo | Ruta | Respuesta | Cache |
|---|---|---|---|
| GET | `/api/history/:stationId?days=30` | `{ station_id, days, series: { '95': [...], 'diesel': [...] } }` | `public, max-age=3600` |
| GET | `/api/history/province/:id?fuel=95&days=30` | `{ provincia_id, fuel, days, median: [...] }` | `public, max-age=3600` |

Ambos devuelven 503 `history_unavailable` si no hay binding D1 (dev local) — el cliente cae a `localStorage` como fallback.

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
