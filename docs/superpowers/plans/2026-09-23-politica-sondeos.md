# Vertical Política (sondeos) — Plan de implementación

> **Para el ejecutor:** implementar tarea a tarea con TDD (test que falla → mínimo para pasar → verde → commit). `tsc` + toda la batería de vitest en verde antes de cada push. Spec: `docs/superpowers/specs/2026-09-23-politica-sondeos-design.md`.

**Objetivo:** apartado `/politica/` con elecciones (generales, europeas, 19 autonómicas), tabla de todos los sondeos + gráfica de evolución SVG, sube/baja contra el resultado de la última elección, veda LOREG automática, datos desde Wikipedia por robot → JSON estáticos, aviso de errores al bot de Telegram.

**Arquitectura:** robot GitHub Actions → `public/data/politica/*.json` → SSR (`src/routes/politica.ts` + `src/html/politica.ts`) que solo lee JSON. Lógica pura testeable aparte.

**Stack:** Cloudflare Pages/Workers, Hono 4, TypeScript, Vite, wrangler 4, zod, esbuild; robots en `scripts/*.mjs` + `.github/workflows/`.

---

## Estructura de ficheros

**Nuevos (código servidor / compartido):**
- `src/data/politica-catalogo.ts` — catálogo fijo: 21 elecciones + partidos (id→nombre/siglas/color) + config por elección (artículo Wikipedia, idioma, tamaño cámara, fecha).
- `src/lib/politica-schemas.ts` — zod: `SondeoSchema`, `EleccionFileSchema`, `IndexSchema`, `IndexEntrySchema`; `POLITICA_SCHEMA_VER`.
- `src/lib/politica.ts` — lógica pura de runtime: `enVeda(fecha, ahora)`, `calculaCambio(sondeo, ref)` (maneja rangos), `estadoEleccion(entry, ahora)`, tipos TS re-exportados.
- `src/routes/politica.ts` — `registerPoliticaRoutes(app)`.
- `src/html/politica.ts` — `envoltorio`, builders de página, `graficaEvolucionSvg`, `politicaHeaders`.

**Nuevos (robot / scripts):**
- `scripts/lib/politica-parse.mjs` — parser puro: HTML de Wikipedia → sondeos estructurados (sin red).
- `scripts/lib/politica-validacion.mjs` — validación multinivel (esquema/coherencia/cobertura/regresión).
- `scripts/fetch-politica.mjs` — orquesta fetch + parse + valida + escribe JSON + index.
- `scripts/politica-monitor.mjs` — aviso Telegram al fallar (patrón `guardias-monitor.mjs`).
- `.github/workflows/fetch-politica.yml` — cron diario + commit + deploy + monitor.

**Modificados:**
- `src/index.tsx` — import + `registerPoliticaRoutes(app)`.
- `src/html/landing.ts` — sección/enlace de Política + JSON-LD.
- `src/routes/meta.ts` — bloque `/politica/*` en `/sitemap.xml`.
- `scripts/error-monitor.sh` — comprobar `index.json` de política en producción.
- `package.json` — (si hace falta) dep para parsear HTML en Node (usar `node-html-parser` o `cheerio`; preferir una ligera; evaluar en Tarea 5).

**Datos generados (gitignored salvo el seed inicial):**
- `public/data/politica/index.json`, `generales.json`, `europeas.json`, `autonomicas/<comunidad>.json`.
- `tests/fixtures/politica/*.html` — recortes reales de Wikipedia para tests del parser.

---

## Fase 0 — Catálogo y tipos

### Tarea 0.1: Catálogo de elecciones y partidos
**Files:** Create `src/data/politica-catalogo.ts`; Test `tests/politica-catalogo.test.ts`.
- [ ] Test: el catálogo tiene exactamente 21 elecciones (1 generales + 1 europeas + 19 autonómicas), slugs únicos, y cada autonómica marca `ciudadAutonoma` solo en Ceuta y Melilla.
- [ ] Test: todo partido referenciado tiene color válido (`#rrggbb`) y siglas.
- [ ] Implementar el catálogo (slugs castellano/INE coherentes con gasolineras/tiempo; config por elección: `wikiArticulo`, `wikiIdioma`, `camaraEscanos`, `mayoria`, `fecha: {valor, confirmada}`).
- [ ] Verde + commit.

### Tarea 0.2: Esquemas zod del modelo
**Files:** Create `src/lib/politica-schemas.ts`; Test `tests/politica-schemas.test.ts`.
- [ ] Test: `SondeoSchema` acepta un sondeo real (con rango de escaños `{min,max}` y celdas ausentes) y rechaza % fuera de [0,100] y escaños no enteros.
- [ ] Test: `EleccionFileSchema` exige `schemaVer`, `camara`, `referencia`, `sondeos` (array, puede ser vacío), `procedencia`.
- [ ] Test: `IndexSchema` valida el catálogo servido (21 entradas, estados del enum).
- [ ] Implementar esquemas + `POLITICA_SCHEMA_VER = 1`.
- [ ] Verde + commit.

## Fase 1 — Lógica pura de runtime

### Tarea 1.1: Cálculo del sube/baja (con rangos)
**Files:** Create `src/lib/politica.ts`; Test `tests/politica-calculo.test.ts`.
- [ ] Test: `calculaCambio(140, 137)` → `{tipo:'exacto', delta:+3}`.
- [ ] Test: `calculaCambio({min:20,max:25}, 22)` → `{tipo:'rango', min:-2, max:+3, direccion:'ambiguo'}` (sin flecha).
- [ ] Test: referencia desconocida (coalición nueva) → `{tipo:'desconocido'}` (no 0).
- [ ] Implementar. Verde + commit.

### Tarea 1.2: Ventana de veda (LOREG 69.7)
**Files:** Modify `src/lib/politica.ts`; Test `tests/politica-veda.test.ts`.
- [ ] Test: fecha confirmada 2027-05-28; `enVeda('2027-05-25', eleccion)` → true; `enVeda('2027-05-22', ...)` → false (6 días antes).
- [ ] Test: elección sin fecha confirmada → nunca en veda.
- [ ] Test: el día de la votación cuenta como veda; el día −5 incluido.
- [ ] Implementar `enVeda(ahoraISO, eleccion)` (ventana `[fecha−5d, fecha]`, solo confirmadas). Verde + commit.

### Tarea 1.3: Estado de elección
**Files:** Modify `src/lib/politica.ts`; Test en `tests/politica-calculo.test.ts`.
- [ ] Test: fresco → `ok`; sin sondeos y sin error → `sin_sondeos`; `ultimaComprobacionOk` > 30 h → `desactualizado`; marcado no disponible → `no_disponible`.
- [ ] Implementar `estadoEleccion(entry, ahora)`. Verde + commit.

## Fase 2 — Parser de Wikipedia (pura, con fixtures)

### Tarea 2.1: Fixtures reales
**Files:** Create `tests/fixtures/politica/{generales,europeas,rioja,cero-sondeos}.html`.
- [ ] Descargar con `action=parse` recortes reales (tabla de estimaciones) y guardarlos como fixtures. Documentar `pageid`/`revid` en un `.meta.json` al lado.

### Tarea 2.2: Parser DOM
**Files:** Create `scripts/lib/politica-parse.mjs`; Test `tests/politica-parse.test.ts`.
- [ ] Elegir librería HTML ligera (evaluar `node-html-parser`); añadir devDep.
- [ ] Test (generales): extrae N sondeos; separa % (`<b>`) y escaños (`<span>`); mapea partidos por nombre; detecta la fila de referencia y NO la cuenta como sondeo.
- [ ] Test (rioja): pocos sondeos, celdas `—` → ausencia (no 0); rangos `30-33` → `{min:30,max:33}`.
- [ ] Test (cero-sondeos): devuelve `[]` sin lanzar.
- [ ] Test: columna de partido desconocida → registrada como incidencia (no descartada en silencio).
- [ ] Implementar parser (reconstruye rowspan/colspan; fechas con parser explícito es/en; conserva texto original). Verde + commit.

### Tarea 2.3: Validación multinivel
**Files:** Create `scripts/lib/politica-validacion.mjs`; Test `tests/politica-validacion.test.ts`.
- [ ] Test: candidato con escaños > tamaño cámara → rechazado (coherencia).
- [ ] Test: pasar de 40 sondeos a 0 sin marca de veda → bloqueado (regresión datos→vacío).
- [ ] Test: caída > 20 % de filas → flag de revisión (no rechazo automático).
- [ ] Test: candidato válido → aceptado con diagnóstico de cobertura.
- [ ] Implementar `validaCandidato(nuevo, anterior, config)` → `{ok, motivo?, diagnostico}`. Verde + commit.

## Fase 3 — Rutas SSR + HTML

### Tarea 3.1: Builders HTML + gráfica SVG
**Files:** Create `src/html/politica.ts`; Test `tests/politica-html.test.ts`.
- [ ] Test: `buildEleccionPage` con datos escapa un `Rotulo`/nombre con `<script>` (seguridad).
- [ ] Test: en veda, el HTML NO contiene la tabla de sondeos pero SÍ el aviso "Veda electoral" y la fecha.
- [ ] Test: `graficaEvolucionSvg` produce `<svg>` con un punto por sondeo (no interpola; no une institutos distintos con una sola línea).
- [ ] Implementar `envoltorio`, `buildIndexPage`, `buildEleccionPage` (generales/europeas/comunidad comparten builder), `buildAutonomicasIndex`, `graficaEvolucionSvg`, `politicaHeaders(nonce)` (CSP con nonce + Cache-Control). Atribución CC BY-SA en el pie. Verde + commit.

### Tarea 3.2: Rutas + registro
**Files:** Create `src/routes/politica.ts`; Modify `src/index.tsx`; Test `tests/routes-politica.test.ts`.
- [ ] Test: `/politica/` → 200; `/politica` → 301; `/politica/autonomicas/madrid` → 200; slug inexistente → 404.
- [ ] Test: `/api/politica/elecciones` → 200 con las 21 entradas.
- [ ] Test (veda): con fecha del sistema simulada dentro de la ventana, la respuesta no incluye sondeos.
- [ ] Implementar `registerPoliticaRoutes(app)` (rutas literales antes de `:param`; `loadSnapshot`; veda por request) + registrar en `index.tsx`. Verde + commit.

### Tarea 3.3: Portada + sitemap
**Files:** Modify `src/html/landing.ts`, `src/routes/meta.ts`; Test en `tests/routes-meta.test.ts` / `tests/home.test.ts`.
- [ ] Test: `/sitemap.xml` incluye `/politica/` y `/politica/autonomicas/madrid`.
- [ ] Test: la portada enlaza a `/politica/`.
- [ ] Implementar la sección de Política en landing (columnas + `.mas` + footer + JSON-LD `ItemList`) y el bloque en el sitemap. Verde + commit.

## Fase 4 — Robot + workflows + datos seed

### Tarea 4.1: Robot de fetch
**Files:** Create `scripts/fetch-politica.mjs`.
- [ ] Para cada elección viva: `action=parse` (resuelve redirect, guarda pageid/revid) → parser → validación multinivel → si OK escribe el JSON, si no conserva el anterior y marca estado. Genera `index.json` desde el catálogo (independiente del scraper). `maxlag` + backoff + User-Agent identificado.
- [ ] Ejecutar en local para generar el **seed** en `public/data/politica/` y commitearlo (dato inicial real).

### Tarea 4.2: Aviso Telegram + workflow
**Files:** Create `scripts/politica-monitor.mjs`, `.github/workflows/fetch-politica.yml`.
- [ ] `politica-monitor.mjs`: `enviaTelegram()` (fetch, best-effort) con resumen de elecciones afectadas + enlace al run.
- [ ] Workflow: cron diario; pasos fetch → commit (escritor único, revalida si cambia base) → deploy (build + wrangler) → monitor `if: always()` + `continue-on-error` solo en el envío.

### Tarea 4.3: Extender error-monitor
**Files:** Modify `scripts/error-monitor.sh`.
- [ ] Añadir comprobación del `index.json` de política servido en producción (esquema + frescura por elección, umbral 30 h); incorporar al heartbeat (verde solo si también política OK). Separar última-comprobación-ok / última-modificación / fecha-último-sondeo.

## Fase 5 — Verificación

- [ ] `npx tsc --noEmit` limpio.
- [ ] `npx vitest run` toda la batería en verde (incluye los tests nuevos; que los viejos sigan pasando).
- [ ] `npm run build` OK.
- [ ] Deploy preview (PR) → verificar en `feat-politica.webapp-3ft.pages.dev`: `/politica/`, una autonómica grande (Madrid) con tabla+gráfica, una pequeña (`sin_sondeos`), y simular/verificar el render de veda.
- [ ] Merge → prod → smoke con medidas (endpoints 200, `/politica/` real).

## Fase 6 — Revisión

- [ ] Revisión adversarial (workflow multi-agente, patrón auditoría) + segunda opinión de Codex sobre el parser y la veda.
- [ ] Aplicar hallazgos confirmados. Actualizar memoria del proyecto.

---

## Notas de ejecución
- **No commitear** los ficheros ajenos ya presentes (`dgt.json`, `gva.csv`, `icgc_caps.xml`, `tests/e2e/tiempo.spec.ts`).
- **git fetch + merge origin/main** antes de cada push (el bot commitea datos 2×/día).
- Token del bot **nunca** en el código (secrets de GitHub/Cloudflare).
- Atribución de commits: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
