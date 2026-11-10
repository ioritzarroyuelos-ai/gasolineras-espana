# España Útil

[![CI](https://github.com/ioritzarroyuelos-ai/gasolineras-espana/actions/workflows/ci.yml/badge.svg)](../../actions/workflows/ci.yml)
[![Snapshot](https://github.com/ioritzarroyuelos-ai/gasolineras-espana/actions/workflows/fetch-prices.yml/badge.svg)](../../actions/workflows/fetch-prices.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)

PWA para consultar precios oficiales de gasolineras en España en tiempo real. Datos del **Ministerio para la Transición Ecológica y el Reto Demográfico**.

> **Producción**: https://webapp-3ft.pages.dev

## Qué hace

- Mapa Leaflet con ~12.000 estaciones y clustering.
- Filtros por provincia, municipio, marca, combustible.
- **Cerca de mí** (Haversine) con radio configurable.
- **Comparador de ahorro**: calcula €/depósito vs. mediana de la zona.
- **Favoritos** con sparkline histórico en localStorage.
- **PWA**: instalable, offline-ready con snapshot diario como fallback.
- Accesibilidad (navegación por teclado, ARIA, `prefers-reduced-motion`).
- Atajos de teclado: `/` buscar, `g` geolocalizar, `d` tema, `f` lugar, `?` ayuda.

## Stack

- **Hono** sobre **Cloudflare Pages Functions** (Workers runtime).
- **Vite** 8 con `@hono/vite-build` para SSR bundle.
- **TypeScript** strict.
- **Vitest** (tests unitarios) + **Playwright** + **axe-core** (E2E + a11y).
- **Lighthouse CI** con budgets de performance/SEO/accesibilidad.
- **Zod** para validación de esquemas en la frontera.
- **@resvg/resvg-js** para generar PNGs desde SVG en pre-build (sin tooling nativo).

## Arranque en local

```bash
# Node 22+
npm ci                 # instalar deps exactas
npm run test           # pruebas unitarias
npm run typecheck      # tsc --noEmit
npm run build          # genera iconos PNG + bundle en dist/
npm run preview        # wrangler pages dev → http://127.0.0.1:8788
```

Para desarrollo con HMR:

```bash
npm run dev            # vite → http://127.0.0.1:5173
```

## Dependencias y seguridad

`security.yml` ejecuta npm audit, gitleaks y OSV de forma obligatoria. OSV analiza el lockfile completo, incluidas las herramientas de desarrollo, y sube el informe SARIF aunque encuentre problemas. No se silencian sus errores.

Las versiones mínimas de `overrides` cubren avisos pendientes en dependencias transitivas de desarrollo: el adaptador Hono, minimatch/glob, chrome-launcher y basic-ftp. Lighthouse CI 0.16 utiliza Lighthouse 13 y requiere Node 22.19 o posterior. Tras modificar estas versiones se deben comprobar también el servidor de desarrollo y los presupuestos Lighthouse, además de las pruebas de aplicación.

## Tests E2E

Los tests Playwright se corren contra el servidor de `wrangler pages dev`.

```bash
npx playwright install chromium --with-deps   # primera vez
npm run test:e2e                              # ejecuta la suite
npm run test:e2e -- --headed                  # con navegador visible
```

## Snapshot de datos del Ministerio

El endpoint `/api/*` proxea al Ministerio en tiempo real, pero si la API está caída se sirve un snapshot estático de fallback desde `public/data/stations.json`. Ese fichero se actualiza automáticamente dos veces al día por [`.github/workflows/fetch-prices.yml`](.github/workflows/fetch-prices.yml) (07:00 y 19:00 UTC). Si falla 3 ejecuciones seguidas, el **watchdog de freshness** marca el dataset como obsoleto y la UI muestra un banner amarillo.

Para actualizar datos manualmente, lanza el workflow correspondiente desde `main`. Los robots generan una rama de datos, abren un PR, ejecutan CI y Security, y solo fusionan el commit comprobado. No se escriben datos a mano ni se suben directamente a `main`.

Los robots usan una GitHub App privada instalada únicamente en este repositorio: Contents y Pull requests con escritura, Actions con lectura y Metadata con lectura implícita. Guarda su Client ID en la variable `DATA_APP_CLIENT_ID` y su clave privada en el secreto `DATA_APP_PRIVATE_KEY`. Cada publicación obtiene un token de una hora, limitado al repositorio actual y revocado al terminar; el token se crea después de descargar los datos. No necesita acceso a la administración ni permiso para modificar workflows.

La App dispara las comprobaciones nativas de `pull_request` y el `push` posterior a la fusión. Esto es necesario porque los [checks de `workflow_dispatch` no satisfacen las reglas de rama](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated) y los PR creados con `GITHUB_TOKEN` requieren aprobación manual para ejecutarlas. Una identidad ausente o unas pruebas fallidas dejan los datos sin publicar; nunca se utiliza un bypass de `main`.

## Publicación validada en Cloudflare Pages

Los cambios de código se preparan en una rama y se revisan mediante PR. Antes de fusionar deben pasar tipos, pruebas, navegador, accesibilidad, presupuestos móviles y seguridad. `main` exige estas comprobaciones y rechaza pushes directos, borrado y reescritura de historial.

Tras la fusión, CI construye y verifica el `main` resultante. El único workflow de producción es `deploy.yml`: descarga ese artefacto exacto, comprueba que sigue siendo el commit actual, aplica migraciones, actualiza el respaldo regional y publica Pages. Los despliegues se serializan y comprueban `/api/health` al terminar.

Para volver a publicar el `main` ya validado, sin cambios locales:

```bash
npm run ship
# Equivalente: npm run deploy
```

También se puede lanzar `deploy.yml` manualmente. Se rechazará si el `main` actual aún no tiene CI verde; no publica una compilación local ni un commit antiguo.

### Guardias, estado y fechas reales

- `/status` y `/api/status` indican el estado de gasolineras, farmacias, tiempo, ITV y política a partir de las fechas de sus copias. Una fuente atrasada mantiene el aviso aunque el despliegue sea reciente.
- Asturias y Ceuta disponen de un respaldo de descarga en España (`wrangler.guardias.jsonc`), limitado a sus dos fuentes oficiales. Los PR usan un Worker de prueba independiente.
- Almería muestra los turnos con duración ambigua como «Horario por confirmar» y los excluye de «Abierta ahora» y «24 horas».
- Si la DGT no permite descargar el directorio ITV, se conserva la última copia con su fecha, un aviso y el enlace oficial. No se cambia la fecha al fallar la descarga.
- Los avisos recurrentes de Telegram tienen una espera de 24 horas; solo se marcan como notificados tras confirmar la entrega.

Variables de entorno opcionales (define en el dashboard de Cloudflare Pages):

| Variable | Uso | Por defecto |
|---|---|---|
| `TURNSTILE_SECRET_KEY` | Turnstile en `/api/ingest` (opcional) | sin reto |
| `TURNSTILE_SITE_KEY` | Turnstile en cliente (opcional) | sin reto |
| `HEALTH_ADMIN_TOKEN` | Gate del detalle de `/api/health` | todo publico en dev |
| `PUBLIC_ORIGIN` | Origen publico usado por `scheduled()` para leer snapshot | `https://webapp.pages.dev` |

Ver [`.env.example`](./.env.example).

## Automatizacion completa

Las consultas y publicaciones periódicas se ejecutan en GitHub Actions. Si una fuente cambia o deja de responder, se conserva su última copia válida con fecha y aviso; un cambio de formato puede necesitar mantenimiento.

| Evento | Workflow | Trigger | Resultado |
|---|---|---|---|
| Push a `main` | `ci.yml` | `push` | Typecheck, tests, build, E2E, Lighthouse. Sube `dist` como artefacto. |
| CI verde en `main` | `deploy.yml` | `workflow_run(CI)` | Aplica migraciones D1, publica el artefacto validado y comprueba su revisión, datos y seis secciones en producción. |
| Dos veces al dia | `fetch-prices.yml` | `cron 0 7,19 * * *` | Snapshot del Ministerio → PR con pruebas → CI de main → Deploy si cambia. |
| Diario 05:15 UTC | `fetch-chargers.yml` | `cron 15 5 * * *` | Comprueba el directorio oficial de recarga eléctrica. |
| Diario 05:45 UTC | `fetch-guardias.yml` | `cron 45 5 * * *` | Consulta las fuentes de guardias y señala los fallos parciales después de publicar las lecturas válidas. |
| Cada 3 horas | `fetch-tiempo.yml` | `cron 11 */3 * * *` | Renueva la precarga meteorológica; las fichas también consultan la fuente bajo demanda. |
| Diario 04:17 UTC | `fetch-itv.yml` | `cron 17 4 * * *` | Revisa directorios, canales de cita y documentos de tarifas. |
| Diario 04:20 UTC | `fetch-politica.yml` | `cron 20 4 * * *` | Comprueba las fuentes integradas de sondeos y fechas. |
| Cada hora | `fetch-deportes.yml` | `cron 23 * * * *` | Intenta renovar fútbol, baloncesto y motor, respetando el progreso y los descansos de las fuentes. |
| Cada 4 horas | `data-recovery.yml` | `cron 43 */4 * * *` | Reintenta trabajos fallidos o datos publicados atrasados, sin duplicar procesos activos ni reintentar antes de cuatro horas. |
| Cada 12h | `fetch-prices.yml` (dead-man) | `cron 30 */12 * * *` | Falla el workflow si el snapshot lleva >26h sin actualizar. |
| Diario 20:00 UTC | `cron-ingest.yml` | `cron 0 20 * * *` | `POST /api/cron/ingest` -> upsertea precios del dia a D1. |
| Domingos 03:00 UTC | `cron-purge.yml` | `cron 0 3 * * 0` | `POST /api/cron/purge` -> borra filas >2 anos. |
| Push o PR | `security.yml` | `push`, `pull_request` | npm audit (runtime, moderate+), gitleaks, OSV-Scanner. |
| Push o PR | `codeql.yml` | `push`, `pull_request` | Analisis estatico de codigo (CodeQL). |
| Lunes 04:00 Madrid | Dependabot | interno | PRs semanales agrupadas: deps npm + github-actions. |
| PR de Dependabot | `dependabot-auto-merge.yml` | `pull_request` | Auto-merge squash si es patch/minor o dev-only. Majors quedan manual. |

Las horas de la tabla son la programación, no una garantía de ejecución puntual: GitHub puede retrasar trabajos y las fuentes pueden limitar consultas. `/status` muestra las fechas e incidencias de las copias realmente publicadas; una ejecución correcta no demuestra cobertura completa de una fuente.

### Hook pre-push local (opcional pero recomendado)

Tras `npm ci`, el `postinstall` activa `.githooks/pre-push` automaticamente. Antes de cada `git push` se corren `npm run typecheck` + `npm test`: si fallan, el push se aborta en local (~10s) en vez de esperar al CI (2-3 min) para enterarte.

Saltar puntualmente:

```bash
git push --no-verify
```

Desactivarlo permanentemente en tu clone:

```bash
git config --local --unset core.hooksPath
```

### Setup unico (primera vez en la vida del proyecto)

Cosas que **no** se automatizan porque son one-shot o requieren credenciales nuevas:

1. `npx wrangler d1 create gasolineras-history` + pegar `database_id` en `wrangler.jsonc`
2. Secretos en Cloudflare Pages y GitHub Actions:
   - `CLOUDFLARE_API_TOKEN` (GHA) con permisos **Cloudflare Pages: Edit** + **D1: Edit** + **Workers Scripts: Edit** + **Account Settings: Read** (limitados a la cuenta que contiene `webapp`; si faltan, el despliegue se detiene).
   - `CLOUDFLARE_ACCOUNT_ID` (GHA)
   - `CRON_TOKEN` (Pages + GHA, mismo valor)
   - `HEALTH_ADMIN_TOKEN` (Pages, opcional)
3. Primer `npm run backfill:d1` + `wrangler d1 execute ... --file=migrations/9999_backfill.sql --remote` si quieres historico previo al primer cron-ingest

**Regenerar el API token con permisos D1** (si el step `Aplicar migraciones D1 pendientes` de Deploy queda amarillo):

```
Cloudflare Dashboard → My Profile → API Tokens → Create Token → Custom token
  Permissions:
    - Account | Cloudflare Pages     | Edit
    - Account | Workers Scripts      | Edit   (opcional, para deploy directo)
    - Account | D1                   | Edit   ← imprescindible para migraciones
  Account Resources: Include | Specific account | <tu cuenta>
  Zone Resources:    All zones from an account
→ Copia el token y sobrescribe GHA repo secret CLOUDFLARE_API_TOKEN
```

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
  pure.test.ts           # pruebas unitarias
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

## Contribuir

Ver [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Licencia

[MIT](./LICENSE) — los datos son del Ministerio, reutilización libre bajo sus condiciones.
