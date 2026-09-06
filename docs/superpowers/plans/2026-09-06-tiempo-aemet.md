# El tiempo (AEMET) — Plan de implementación v1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Añadir el vertical "el tiempo" a CercaYa: predicción por municipio desde AEMET (con Open-Meteo de suplente), con el mismo patrón buscador→página SSR que farmacias/ITV, sin tocar lo existente.

**Architecture:** Fuente primaria AEMET (API en dos pasos, clave secreta), suplente Open-Meteo por coordenadas; ambos se normalizan al mismo modelo vía adaptadores. Datos híbridos: snapshot estático de ~150 municipios "importantes" (robot cron) + bajo-demanda con Cache API para el resto. Lógica pura compartida en `scripts/lib/tiempo.mjs` (+ `.d.mts`), consumida por el robot, el Worker y los tests (mismo precedente que `historico-estatico`).

**Tech Stack:** Cloudflare Pages/Workers, Hono 4, TypeScript, wrangler 4, Cache API; robots en GitHub Actions (Node 22, `.mjs`); vitest (unit) + Playwright (e2e). Diseño: `docs/superpowers/specs/2026-09-06-tiempo-aemet-design.md`.

---

## Estructura de ficheros

**Datos (repo):**
- `public/data/tiempo/municipios.json` — maestro de municipios: `[{ine,nombre,provinciaId,provinciaSlug,slug,lat,lng,pob,imp}]` (~8.100). `imp:true` = importante (snapshot). Generado una vez por script.
- `public/data/tiempo/snapshot/<provinciaSlug>.json` — snapshot de predicción de los importantes, agrupado por provincia (para servir estático).

**Lógica compartida (pura, sin DOM):**
- `scripts/lib/tiempo.mjs` (+ `scripts/lib/tiempo.d.mts`) — modelo normalizado, `normalizaAemet(raw)`, `normalizaOpenMeteo(raw)`, `frescuraTiempo(ts, ahora)`, `construyeIndiceMunicipios(maestro)`, `eligeImportantes(maestro)`. Usa `fetch` global solo en las funciones de descarga (`bajaAemet(ine, key)`, `bajaOpenMeteo(lat,lng)`), que valen en Node 22 y en Workers.

**Worker (runtime):**
- `src/html/tiempo.ts` — `buildTiempoIndexPage`, `buildTiempoProvinciaPage`, `buildTiempoMunicipioPage`, `tiempoHeaders(nonce)`. Verde de marca; espejo de `src/html/itv.ts`.
- `src/index.tsx` — rutas `/tiempo`, `/tiempo/`, `/tiempo/:prov`, `/tiempo/:prov/:mun`, `/api/tiempo/municipios`; resolución de la predicción (snapshot→cache→AEMET→Open-Meteo); baldosa "Tiempo" en `/`.

**Robot:**
- `scripts/fetch-tiempo.mjs` — refresca el snapshot de los importantes.
- `scripts/gen-tiempo-municipios.mjs` — genera `municipios.json` (maestro AEMET + población INE). Se ejecuta puntualmente, no en cada pase.
- `.github/workflows/fetch-tiempo.yml` — cron 3-4×/día.

**Tests:**
- `tests/tiempo.test.ts` — unit de la lógica pura (contra fixtures reales).
- `tests/fixtures/tiempo/*.json` — muestras reales capturadas de AEMET/Open-Meteo.
- `tests/e2e/tiempo.spec.ts` — portada + municipio + axe.

---

## Task 1: Spike — confirmar fuentes reales y capturar fixtures

Antes de escribir parsers, capturamos respuestas REALES (no inventar formatos). Requiere `AEMET_API_KEY` (pídesela al usuario; se guarda como secreto, nunca en el repo).

**Files:**
- Create: `tests/fixtures/tiempo/aemet-diaria-28079.json` (Madrid), `tests/fixtures/tiempo/aemet-maestro-sample.json`, `tests/fixtures/tiempo/openmeteo-madrid.json`
- Create (scratch): `scripts/spike-tiempo.mjs` (temporal, se borra al final)

- [ ] **Step 1: Script de captura**

```js
// scripts/spike-tiempo.mjs — TEMPORAL. Captura muestras reales para los tests.
const KEY = process.env.AEMET_API_KEY
const H = { headers: { 'User-Agent': 'cercaya-tiempo-spike/1.0' } }
async function aemet(path) {
  const r1 = await fetch('https://opendata.aemet.es/opendata/api' + path, { headers: { ...H.headers, api_key: KEY } })
  const j1 = await r1.json()               // { estado, datos: <url> }
  if (!j1.datos) throw new Error('sin datos: ' + JSON.stringify(j1))
  const r2 = await fetch(j1.datos, H)
  return r2.json()
}
const diaria = await aemet('/prediccion/especifica/municipio/diaria/28079')
const maestro = await aemet('/maestro/municipios')
const om = await (await fetch('https://api.open-meteo.com/v1/forecast?latitude=40.4168&longitude=-3.7038&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode,wind_speed_10m_max&timezone=Europe/Madrid')).json()
const fs = await import('node:fs')
fs.mkdirSync('tests/fixtures/tiempo', { recursive: true })
fs.writeFileSync('tests/fixtures/tiempo/aemet-diaria-28079.json', JSON.stringify(diaria, null, 2))
fs.writeFileSync('tests/fixtures/tiempo/aemet-maestro-sample.json', JSON.stringify((Array.isArray(maestro)?maestro:[]).slice(0, 20), null, 2))
fs.writeFileSync('tests/fixtures/tiempo/openmeteo-madrid.json', JSON.stringify(om, null, 2))
console.log('fixtures guardadas')
```

- [ ] **Step 2: Ejecutar y verificar**

Run: `AEMET_API_KEY=... node scripts/spike-tiempo.mjs`
Expected: crea los 3 ficheros. Abrir cada uno y anotar los nombres reales de campos (AEMET diaria: `prediccion.dia[].temperatura.{maxima,minima}`, `estadoCielo`, `probPrecipitacion`, `viento`; maestro: `id/nombre/latitud_dec/longitud_dec` o similar; Open-Meteo: `daily.time[]`, `temperature_2m_max[]`, etc.). **Estos nombres reales alimentan los parsers de las Tasks 3-4.**

- [ ] **Step 3: Commit de las fixtures (sin la clave, sin el spike aún)**

```bash
git add tests/fixtures/tiempo/
git commit -m "test(tiempo): fixtures reales de AEMET y Open-Meteo"
```

---

## Task 2: Modelo normalizado + frescura (lógica pura, TDD)

**Files:**
- Create: `scripts/lib/tiempo.mjs`, `scripts/lib/tiempo.d.mts`
- Test: `tests/tiempo.test.ts`

- [ ] **Step 1: Test de `frescuraTiempo`**

```ts
import { describe, it, expect } from 'vitest'
import { frescuraTiempo } from '../scripts/lib/tiempo.mjs'

describe('frescuraTiempo', () => {
  const ahora = Date.parse('2026-09-06T12:00:00Z')
  it('fresco si < 6h', () => {
    expect(frescuraTiempo('2026-09-06T09:00:00Z', ahora).fiable).toBe(true)
  })
  it('caducado si > umbral (12h)', () => {
    expect(frescuraTiempo('2026-09-05T20:00:00Z', ahora).fiable).toBe(false)
  })
})
```

- [ ] **Step 2: Verificar que falla**

Run: `npx vitest run tests/tiempo.test.ts`
Expected: FAIL (módulo/función no existe).

- [ ] **Step 3: Implementar el modelo y frescura**

```js
// scripts/lib/tiempo.mjs
export const TIEMPO_STALE_HORAS = 12

export function frescuraTiempo(ts, ahora = Date.now()) {
  const t = ts ? Date.parse(ts) : NaN
  const horas = Number.isFinite(t) ? (ahora - t) / 3600000 : Infinity
  return { fiable: horas <= TIEMPO_STALE_HORAS, horas }
}
```

```ts
// scripts/lib/tiempo.d.mts
export const TIEMPO_STALE_HORAS: number
export interface Frescura { fiable: boolean; horas: number }
export function frescuraTiempo(ts: string | null | undefined, ahora?: number): Frescura
export interface DiaPrediccion { fecha: string; tmin: number|null; tmax: number|null; cielo: string; probLluvia: number|null; viento: number|null }
export interface Prediccion { ine: string; nombre: string; provincia: string; elaborado: string; fuente: 'AEMET'|'Open-Meteo'; dias: DiaPrediccion[] }
export function normalizaAemet(raw: unknown, meta: { ine: string; nombre: string; provincia: string }): Prediccion
export function normalizaOpenMeteo(raw: unknown, meta: { ine: string; nombre: string; provincia: string }): Prediccion
export function construyeIndiceMunicipios(maestro: unknown[]): Array<{ n: string; p: string; u: string }>
export function eligeImportantes(maestro: unknown[]): unknown[]
```

- [ ] **Step 4: Verificar que pasa**

Run: `npx vitest run tests/tiempo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/tiempo.mjs scripts/lib/tiempo.d.mts tests/tiempo.test.ts
git commit -m "feat(tiempo): modelo normalizado + frescuraTiempo (12h)"
```

---

## Task 3: Adaptador AEMET (TDD contra la fixture real)

**Files:**
- Modify: `scripts/lib/tiempo.mjs` (+ `.d.mts` ya declara `normalizaAemet`)
- Test: `tests/tiempo.test.ts`

- [ ] **Step 1: Test contra la fixture** — usar los NOMBRES DE CAMPO REALES anotados en Task 1.

```ts
import aemet28079 from './fixtures/tiempo/aemet-diaria-28079.json'
import { normalizaAemet } from '../scripts/lib/tiempo.mjs'

it('normaliza la diaria de AEMET (Madrid)', () => {
  const p = normalizaAemet(aemet28079, { ine: '28079', nombre: 'Madrid', provincia: 'Madrid' })
  expect(p.fuente).toBe('AEMET')
  expect(p.dias.length).toBeGreaterThanOrEqual(5)
  const hoy = p.dias[0]
  expect(typeof hoy.fecha).toBe('string')
  expect(hoy.tmax).toBeTypeOf('number')   // ajustar según campos reales
  expect(hoy.tmin).toBeTypeOf('number')
})
```

- [ ] **Step 2: Verificar que falla** — Run: `npx vitest run tests/tiempo.test.ts` → FAIL.

- [ ] **Step 3: Implementar `normalizaAemet`** — mapear la estructura REAL (según Task 1: típicamente `raw[0].prediccion.dia[]`, con `temperatura.maxima/minima`, `estadoCielo[].descripcion`, `probPrecipitacion[].value`, `viento[].velocidad`). Extraer `elaborado` de `raw[0].elaborado`. Añadir a `scripts/lib/tiempo.mjs`:

```js
export function normalizaAemet(raw, meta) {
  const root = Array.isArray(raw) ? raw[0] : raw
  const dias = ((root?.prediccion?.dia) || []).map(d => ({
    fecha: d.fecha,
    tmax: numOrNull(d.temperatura?.maxima),
    tmin: numOrNull(d.temperatura?.minima),
    cielo: primeraDesc(d.estadoCielo),
    probLluvia: maxValor(d.probPrecipitacion),
    viento: maxVelocidad(d.viento),
  }))
  return { ine: meta.ine, nombre: meta.nombre, provincia: meta.provincia,
    elaborado: root?.elaborado || new Date().toISOString(), fuente: 'AEMET', dias }
}
// + helpers numOrNull, primeraDesc, maxValor, maxVelocidad (según campos reales)
```

- [ ] **Step 4: Verificar que pasa** — Run: `npx vitest run tests/tiempo.test.ts` → PASS. Ajustar mapeo hasta que cuadre con la fixture.

- [ ] **Step 5: Commit** — `git commit -am "feat(tiempo): adaptador AEMET -> modelo normalizado"`

---

## Task 4: Adaptador Open-Meteo (TDD contra la fixture real)

**Files:** Modify `scripts/lib/tiempo.mjs`; Test `tests/tiempo.test.ts`

- [ ] **Step 1: Test contra `openmeteo-madrid.json`**

```ts
import om from './fixtures/tiempo/openmeteo-madrid.json'
import { normalizaOpenMeteo } from '../scripts/lib/tiempo.mjs'
it('normaliza Open-Meteo a la MISMA forma', () => {
  const p = normalizaOpenMeteo(om, { ine: '28079', nombre: 'Madrid', provincia: 'Madrid' })
  expect(p.fuente).toBe('Open-Meteo')
  expect(p.dias[0].tmax).toBeTypeOf('number')
  expect(p.dias[0]).toHaveProperty('probLluvia')
})
```

- [ ] **Step 2: Verificar que falla** → FAIL.

- [ ] **Step 3: Implementar `normalizaOpenMeteo`** — mapear `raw.daily.time[]` con arrays paralelos `temperature_2m_max/min[]`, `precipitation_probability_max[]`, `wind_speed_10m_max[]`, `weathercode[]` (traducir el código WMO a texto de cielo con una tabla pequeña).

- [ ] **Step 4: Verificar que pasa** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(tiempo): adaptador Open-Meteo (misma forma normalizada)"`

---

## Task 5: Descarga con fallback + auto-recuperación (TDD)

**Files:** Modify `scripts/lib/tiempo.mjs`; Test `tests/tiempo.test.ts`

- [ ] **Step 1: Test de `resuelvePrediccion` con adaptadores inyectados** (para no llamar a la red en el test)

```ts
import { resuelvePrediccion } from '../scripts/lib/tiempo.mjs'
it('cae a Open-Meteo si AEMET falla y marca la fuente', async () => {
  const p = await resuelvePrediccion(
    { ine:'28079', nombre:'Madrid', provincia:'Madrid', lat:40.4, lng:-3.7 },
    { bajaAemet: async () => { throw new Error('AEMET down') },
      bajaOpenMeteo: async () => ({ /* raw open-meteo mini */ }) })
  expect(p.fuente).toBe('Open-Meteo')
})
it('usa AEMET cuando responde', async () => {
  const p = await resuelvePrediccion(
    { ine:'28079', nombre:'Madrid', provincia:'Madrid', lat:40.4, lng:-3.7 },
    { bajaAemet: async () => ({ /* raw aemet mini */ }), bajaOpenMeteo: async () => { throw new Error('no debe llamarse') } })
  expect(p.fuente).toBe('AEMET')
})
```

- [ ] **Step 2: Verificar que falla** → FAIL.

- [ ] **Step 3: Implementar** `resuelvePrediccion(muni, deps)`: intenta `deps.bajaAemet(muni.ine)` (con N reintentos), normaliza con `normalizaAemet`; si falla, `deps.bajaOpenMeteo(muni.lat,muni.lng)` + `normalizaOpenMeteo`; si ambos fallan, lanza. `deps` por defecto = `{ bajaAemet, bajaOpenMeteo }` reales (usan `fetch` global). `bajaAemet` implementa los dos pasos + `api_key`.

- [ ] **Step 4: Verificar que pasa** → PASS.

- [ ] **Step 5: Commit** — `git commit -am "feat(tiempo): resuelvePrediccion con fallback AEMET->Open-Meteo"`

---

## Task 6: Maestro de municipios + endpoint del buscador

**Files:**
- Create: `scripts/gen-tiempo-municipios.mjs`, `public/data/tiempo/municipios.json`
- Modify: `src/index.tsx` (endpoint), `scripts/lib/tiempo.mjs` (`construyeIndiceMunicipios`, `eligeImportantes`)
- Test: `tests/tiempo.test.ts`

- [ ] **Step 1: Test de `construyeIndiceMunicipios` y `eligeImportantes`** contra `aemet-maestro-sample.json` (+ población simulada). Verificar shape `[{n,p,u:'/tiempo/<prov>/<mun>'}]` y que `eligeImportantes` incluye capitales + `pob>=50000`.

- [ ] **Step 2: Verificar que falla** → FAIL.

- [ ] **Step 3: Implementar** ambas funciones en `scripts/lib/tiempo.mjs` (reusar `slugifyMunicipio`/`normalizaNombreMunicipio` de `src/lib` copiados a `.mjs` o duplicados mínimos), y `scripts/gen-tiempo-municipios.mjs` que: baja el maestro AEMET (todos), lo cruza con población INE (fichero fuente puntual), fija `imp`, y escribe `public/data/tiempo/municipios.json`.

- [ ] **Step 4: Generar el fichero** — Run: `AEMET_API_KEY=... node scripts/gen-tiempo-municipios.mjs`. Verificar ~8.100 entradas y ~150 con `imp:true`.

- [ ] **Step 5: Endpoint** `/api/tiempo/municipios` en `src/index.tsx` (módulo-cacheado, mismo patrón que `/api/itv/municipios`): carga `tiempo/municipios.json` vía `loadSnapshot`, devuelve `construyeIndiceMunicipios(...)`.

- [ ] **Step 6: Verificar** — `npx vitest run` PASS; `npx tsc --noEmit` limpio. Commit: `git add ... && git commit -m "feat(tiempo): maestro de municipios + /api/tiempo/municipios"`

---

## Task 7: Páginas SSR + rutas (espejo de ITV, en verde)

**Files:**
- Create: `src/html/tiempo.ts`
- Modify: `src/index.tsx` (rutas + baldosa portada), `src/html/landing.ts` (baldosa "Tiempo")

- [ ] **Step 1: `src/html/tiempo.ts`** — copiar la ESTRUCTURA de `src/html/itv.ts` (envoltorio, CSS en **verde** `#16a34a`/`#166534` como ya quedó ITV, buscador con autocompletado contra `/api/tiempo/municipios`, `tiempoHeaders` con CSP estricta sin mapa) y adaptar: `buildTiempoIndexPage` (buscador + provincias), `buildTiempoProvinciaPage` (municipios + capital), `buildTiempoMunicipioPage(pred, frescura)` (tarjetas por día: fecha, mín/máx, cielo, prob. lluvia, viento; **sello de fuente/frescura**: "Datos de AEMET · HH:MM" o "Datos de Open-Meteo · AEMET no disponible"; aviso si `!frescura.fiable`; `noindex` si caducado, como guardias).

- [ ] **Step 2: Rutas en `src/index.tsx`** (ANTES de `/tiempo/:prov` va `/tiempo/` exacto; `/tiempo` → 301):

```ts
app.get('/tiempo', c => c.redirect('/tiempo/' + (new URL(c.req.url).search || ''), 301))
app.get('/tiempo/', async c => { /* buildTiempoIndexPage con provincias del maestro */ })
app.get('/tiempo/:prov', async c => { /* provincia o 404 */ })
app.get('/tiempo/:prov/:mun', async c => { /* resolver predicción (Task 8) o 404 */ })
```

- [ ] **Step 3: Baldosa "Tiempo"** en `src/html/landing.ts` (portada `/`), verde, enlazando a `/tiempo/`.

- [ ] **Step 4: Verificar** — `npx tsc --noEmit` limpio; `npm run build` OK. Preview: `/tiempo/` muestra buscador; `/tiempo/madrid` lista municipios. Commit.

---

## Task 8: Resolución de la predicción del municipio (snapshot → cache → fuentes)

**Files:** Modify `src/index.tsx` (handler `/tiempo/:prov/:mun`)

- [ ] **Step 1: Lógica de resolución** en el handler:
  1. Buscar el municipio en `municipios.json` (por prov+slug) → obtener `ine,lat,lng,nombre`. Si no existe → 404.
  2. Si es **importante**: leer del snapshot `tiempo/snapshot/<prov>.json` (vía `loadSnapshot`).
  3. Si no, o si el snapshot no lo tiene: **Cache API** (`caches.default`) por clave `tiempo:<ine>`; si hit y fresco → usar.
  4. Si miss: `resuelvePrediccion(muni)` (AEMET→Open-Meteo), guardar en Cache API con TTL (`Cache-Control: max-age=7200` AEMET / `1800` Open-Meteo, TTL más corto para el suplente), y servir.
  5. Render con `buildTiempoMunicipioPage(pred, frescuraTiempo(pred.elaborado))`.

- [ ] **Step 2: Verificar** en preview: `/tiempo/madrid/madrid` renderiza predicción con sello de fuente. Provocar fallo de AEMET (clave vacía) → cae a Open-Meteo y la página lo indica. Commit.

---

## Task 9: Robot del snapshot + workflow

**Files:**
- Create: `scripts/fetch-tiempo.mjs`, `.github/workflows/fetch-tiempo.yml`

- [ ] **Step 1: `scripts/fetch-tiempo.mjs`** — lee `municipios.json`, filtra `imp`, y para cada uno `resuelvePrediccion` con **throttle** (p. ej. 1 req cada ~1-2 s) y reintentos; agrupa por provincia y escribe `public/data/tiempo/snapshot/<prov>.json`. Si un municipio falla en AEMET, cae a Open-Meteo (marcado); no sobrescribe con vacío.

- [ ] **Step 2: `.github/workflows/fetch-tiempo.yml`** — copiar la estructura de `.github/workflows/fetch-itv.yml`: cron `0 */6 * * *` (4×/día) + `workflow_dispatch`; `npm ci`; `node scripts/fetch-tiempo.mjs` con `AEMET_API_KEY` de secreto; commit + **push resistente** (`git merge -X ours` + reintento, como en fetch-guardias/prices); deploy tras cambios.

- [ ] **Step 3: Verificar** — `workflow_dispatch` manual; comprobar que sube `snapshot/*.json` y despliega. Commit.

---

## Task 10: Secreto AEMET + configuración

**Files:** (sin código; configuración)

- [ ] **Step 1:** Pedir al usuario la clave de AEMET. Fijarla como **secreto de Cloudflare** (`wrangler secret put AEMET_API_KEY` o desde el panel) y como **secreto de GitHub** (`AEMET_API_KEY`) para el robot. Confirmar que NO aparece en el repo. Documentar en el README/wrangler comentario.

---

## Task 11: e2e

**Files:** Create `tests/e2e/tiempo.spec.ts`

- [ ] **Step 1:** Tests: `/tiempo/` muestra `#q` (buscador) y no `#map`; autocompletado lleva a `/tiempo/<prov>/<mun>`; `/tiempo/madrid/madrid` renderiza predicción con el sello de fuente; axe sin violaciones serias. (Mismo estilo que `tests/e2e/home.spec.ts` describe de portada.)

- [ ] **Step 2:** Run: `npx playwright test tiempo.spec.ts` → verde. Commit.

---

## Task 12: Verificación final + limpieza + despliegue

- [ ] **Step 1:** Borrar `scripts/spike-tiempo.mjs` (temporal). `git rm`.
- [ ] **Step 2:** `npm run typecheck` limpio, `npx vitest run` verde, `npm run build` OK, e2e verde.
- [ ] **Step 3:** Commit + push (rebase con `git pull --rebase`); esperar CI→deploy en verde.
- [ ] **Step 4:** Verificar en producción (navegador real / e2e): `/tiempo/` 200 con buscador; `/tiempo/madrid/madrid` 200 con predicción y sello de fuente; endpoint 200; baldosa en la portada.

---

## Notas de decisión (bloqueadas)

- **Compartir lógica**: `scripts/lib/tiempo.mjs` + `.d.mts` (precedente `historico-estatico`). Si el bundle del Worker no pudiera importar desde `scripts/`, mover la lógica pura a `src/lib/tiempo.ts` y que el robot la consuma vía `tsx`; verificar en Task 7 Step 4.
- **Caché bajo-demanda**: Cache API (`caches.default`), sin binding nuevo. TTL 2h AEMET / 30min Open-Meteo.
- **Importantes**: capitales + `pob>=50000` (~150). Ajustable.
- **Frescura**: umbral 12h (`TIEMPO_STALE_HORAS`).
