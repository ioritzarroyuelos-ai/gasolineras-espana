# Vertical "Política" (elecciones + sondeos) — Diseño

**Fecha:** 2026-09-23
**Proyecto:** CercaYa (Cloudflare Pages/Workers + Hono 4 + TypeScript + Vite + wrangler 4). Prod: `webapp-3ft.pages.dev`.
**Estado:** diseño aprobado por el usuario punto a punto; revisado por Codex (segunda opinión). Listo para plan de implementación.

## Objetivo

Añadir un apartado nuevo de **política** que, para cada elección de España, muestre:
1. su **fecha** (confirmada o prevista, con cuenta atrás si es futura),
2. **todos los sondeos** publicados (empresa, fechas de campo, muestra y, por partido, % y escaños estimados),
3. una **gráfica de evolución** de los sondeos en el tiempo,
4. el **"sube/baja"** de cada sondeo respecto al **resultado de la última elección** (los "escaños actuales").

Encaja con la visión "periódico" del sitio y sigue el molde de las verticales existentes (gasolineras/farmacias/ITV/tiempo): robot que refresca datos → ficheros estáticos → SSR sin JavaScript pesado.

## Decisiones cerradas (del usuario)

| # | Punto | Decisión |
|---|-------|----------|
| 1 | Alcance | **Solo España**. |
| 2 | Fuente de sondeos | **Wikipedia** (API MediaWiki `action=parse`), parseada + validada, citando la fuente (CC BY-SA). |
| 3 | Elecciones | **Generales + Europeas + 19 autonómicas** (17 comunidades + Ceuta y Melilla) = **21 elecciones**. |
| 4 | "Sube/baja" | Contra el **resultado de la última elección** (escaños oficiales), no la composición parlamentaria actual. |
| 5 | Contenido por elección | **Tabla de todos los sondeos + gráfica de evolución** (SVG generado en el servidor, sin JS). |
| 6 | Fechas | **Confirmadas + previstas etiquetadas**; cuenta atrás **solo** para confirmadas. Ceuta/Melilla etiquetadas como ciudades autónomas. |
| 7 | Autonomías sin sondeos | **Mostrar las 19 siempre**; estados distintos: `ok` / `sin_sondeos` / `desactualizado` / `no_disponible`. |
| 8 | Aviso de errores | **Opción C (híbrida)**: aviso inmediato a Telegram al fallar el robot + el error-monitor de 8 h vigila la frescura de política en producción. Sin usar D1 (cupo agotado). |
| 9 | Veda electoral (LOREG 69.7) | En los **5 días previos** a una elección con fecha confirmada, ocultar sondeos + gráfica (también en el JSON público) con aviso "Veda electoral". Automático por fecha, solo esa elección. |

### Requisito legal: veda electoral (LOREG art. 69.7)

> «Durante los cinco días anteriores al de la votación queda prohibida la publicación y difusión o reproducción de sondeos electorales por cualquier medio de comunicación» — LOREG art. 69.7.

La palabra **"reproducción"** implica que también los sondeos ya publicados quedan vetados esos 5 días. Por tanto, el sistema implementa una **ventana de veda automática** por elección con fecha confirmada: `[fechaVotación − 5 días, fechaVotación]`. Durante la veda, para esa elección:
- La página web **no muestra** ni la tabla de sondeos ni la gráfica; muestra un aviso de veda.
- El **JSON público** de esa elección **no incluye** el array de sondeos (se sirve un JSON "en veda").
- Sí se muestran: fecha, cuenta atrás, resultado de la última elección y estado.
- La decisión se recalcula en cada request en función de la fecha del servidor (no depende de que el robot corra), para que la veda entre y salga sola.

## Arquitectura

Cuatro piezas, siguiendo patrones existentes del repo:

1. **Robot (GitHub Actions)** → parsea Wikipedia + infoelectoral, valida, escribe JSON estáticos y los commitea.
2. **Ficheros JSON estáticos** en `public/data/politica/` (D1 agotado → mismo patrón que el histórico de precios).
3. **Rutas SSR** (`src/routes/politica.ts` + `src/html/politica.ts`) que leen esos JSON y renderizan las páginas (sin JS de cliente).
4. **Aviso de errores** → Telegram directo al fallar + extensión del error-monitor de 8 h.

### 1) Modelo de ficheros (`public/data/politica/`)

- **`index.json`** — catálogo COMPLETO e **independiente del scraper** (garantiza que las 19 autonómicas + generales + europeas aparecen siempre). Por cada elección: `id`, `tipo` (`generales|europeas|autonomica`), `comunidad` (slug + nombre + es-ciudad-autónoma), fecha (`{valor, confirmada: boolean, fuente}`), `estado` (`ok|sin_sondeos|desactualizado|no_disponible`), marcas de frescura (`ultimaComprobacionOk`, `ultimoContenidoModificado`), y ruta al fichero de detalle.
- **Un fichero por elección** — `generales.json`, `europeas.json`, `autonomicas/<comunidad>.json`. Contenido:
  - `schemaVer` (versión de esquema), `ciclo`, `camara` (nombre + total de escaños + umbral de mayoría),
  - `candidaturas` (id estable + nombre + siglas + color),
  - `referencia` (resultado oficial de la última elección: escaños por candidatura + fecha + fuente),
  - `sondeos` (array; ver esquema abajo),
  - `procedencia` (wiki, título resuelto, `pageid`, `revid`, licencia, URL del artículo).
- **Catálogo estático de comunidades y partidos** en código (`src/data/politica-catalogo.ts`): las 19 comunidades (slug castellano/INE coherente con el resto del sitio) y el mapa de partidos → color/siglas, para render uniforme.
- **Publicación coherente:** el robot escribe `index.json` y los ficheros de detalle en el mismo commit; la frescura se actualiza por elección, sin "rejuvenecer" las que fallaron.
- **Integridad en el push:** NO confiar en `merge -X ours` como garantía (puede conservar datos obsoletos). El robot es escritor único de `public/data/politica/`; ante carrera, reintenta sobre la base nueva y revalida.

Tamaño estimado: ~21 elecciones × ~200 sondeos × ~2 KB ≈ 8 MB sin comprimir en el peor caso; se medirá el tamaño real antes de plantear particiones. El `index.json` NO duplica los sondeos.

### 2) Robot de parseo (`scripts/fetch-politica.mjs` + `scripts/lib/politica-parse.mjs`)

Para cada elección viva del catálogo:
1. **Resuelve el artículo vigente** de Wikipedia (maneja renombrado "Next X" → "2026 X"): usa `action=parse` con resolución de redirecciones; guarda `pageid` y `revid` para reproducibilidad. Mantiene un **registro revisable por ciclo** (no asume plantilla de URL fija).
2. **Parsea la tabla como DOM** (no por posición de `<b>`/`<span>` ni por índice de columna):
   - Reconstruye `rowspan`/`colspan`.
   - Identifica columnas de partido por **nombre/alias estable**, no por posición. Columna desconocida potencialmente partidista → **incidencia**, no se descarta en silencio.
   - Separa tipos de fila: sondeos vs. filas de resultado/referencia vs. promedios vs. escenarios vs. separadores. Una fila de referencia **no** cuenta como sondeo.
   - `%` y escaños **independientes**: `—` ≠ 0 (ausencia, no cero); rangos de escaños como `{min, max}`; distinguir `<1` de `1`. **No** derivar escaños de % con una regla proporcional inventada.
   - **Fechas:** conservar texto original + inicio/fin de trabajo de campo + publicación por separado; parsers explícitos es/en; **no** `Date.parse()` sobre texto libre.
3. **Idioma:** fuente principal configurable por elección (es o en). Si se combinan, deduplicar por (instituto, fechas, ámbito, cliente, escenario) preservando ambas procedencias; **sin fallback silencioso** que reduzca el histórico.
4. **Buen ciudadano con Wikipedia:** `maxlag`, backoff, identificación del robot en el User-Agent.

### Validación multinivel (equivalente al guard `MIN_FILAS` de fetch-prices)

Estructural y **relativa** (0 sondeos puede ser legítimo). Antes de reemplazar el último JSON válido de una elección:

| Nivel | Regla |
|-------|-------|
| Esquema | zod: `schemaVer`, elección y ciclo conocidos; números finitos; % en [0,100]; escaños enteros; rangos ordenados (`min ≤ max`). |
| Coherencia | Escaños ≤ tamaño de la cámara de ese ciclo; fechas coherentes; ids de candidatura únicos y existentes en el catálogo. |
| Cobertura | Contar filas candidatas / aceptadas / rechazadas. No omitir una fila que parecía sondeo sin registrarlo. |
| Regresión | Bloquear pasar de datos → vacío, perder candidaturas o borrar histórico sin explicación. Caída de filas > 20 % → **revisión** (no prueba de corrupción por sí sola). |
| Publicación | Validar el **candidato completo** antes de reemplazar; guardar diagnóstico de lo rechazado. |

No se exige que los % sumen 100 (puede faltar "otros"/redondeo). Un cambio político fuerte dispara revisión, no rechazo automático. **Si una elección falla la validación, se conserva su último JSON bueno, se marca su estado y se avisa** — un fallo de extracción **nunca** produce `sin_sondeos`.

### Resultado de referencia (el "sube/baja")

- Fuente preferida: **infoelectoral** (Ministerio del Interior, descargas en Excel/CSV) para el resultado oficial por escaños; alternativa: artículo de resultados de Wikipedia.
- Cambia rarísimo (solo con elección nueva) → se mantiene casi como catálogo, con fuente y fecha.
- **Cálculo del sube/baja con rangos:** si el sondeo da un rango (p. ej. 20–25) y la referencia es 22, el cambio es −2..+3 (sin dirección única). En ese caso **no** se pinta flecha desde un punto medio inventado; se muestra el rango del cambio.

### 3) Rutas SSR (`src/routes/politica.ts`, `registerPoliticaRoutes(app)`)

Registrada en `src/index.tsx` junto al resto de `registerXRoutes`. Solo lee JSON estáticos vía `loadSnapshot` de `runtime.ts` (rápida, sin depender de Wikipedia en vivo). Orden de rutas: literales antes de `:param`.

- `GET /api/politica/elecciones` — índice para navegación (lee `index.json`, cache en memoria).
- `GET /politica/` → índice: **próximas elecciones con cuenta atrás** (confirmadas) + previstas etiquetadas + accesos a Generales / Europeas / Autonómicas.
- `GET /politica` → redirect 301 a `/politica/`.
- `GET /politica/generales/`, `GET /politica/europeas/`.
- `GET /politica/autonomicas/` → índice de las 19.
- `GET /politica/autonomicas/:comunidadSlug` → página de una comunidad.

Cada handler: genera `nonce`, calcula `canonical`, **aplica la lógica de veda por fecha del servidor**, y devuelve `new Response(buildX(...), { headers: politicaHeaders(nonce) })`.

### Render (`src/html/politica.ts`, molde ligero de `src/html/itv.ts`)

- `envoltorio(meta, cuerpo)` propio (head + CSS inline con nonce + masthead `mastheadHtml('politica')` + main + footer). Reutiliza `mastheadHtml`/`MASTHEAD_CSS`, `ogSocialTags`/`breadcrumbLd`, `escapeHtml`/`jsonLdScript`.
- **Seguridad:** todo texto que venga de Wikipedia se **escapa** (`escapeHtml`); nunca se inserta HTML crudo de Wikipedia; los enlaces se validan.
- **Página de elección:**
  - Cabecera: nombre, fecha (o "prevista para…") + cuenta atrás si confirmada y futura, total de escaños y umbral de mayoría.
  - Tarjeta de referencia: resultado de la última elección (escaños por partido).
  - Tabla de todos los sondeos: empresa, fechas, muestra, y por partido % + escaños + sube/baja (color/flecha, o rango si es ambiguo).
  - **Gráfica de evolución (SVG servidor):** puntos por **fecha de trabajo de campo**; **no** unir con línea sondeos de institutos distintos como si fuera una tendencia real; mostrar rangos cuando corresponda; **no** interpolar ausencias. Acompañada SIEMPRE de la tabla (accesibilidad).
  - Estados: `sin_sondeos` → aviso honesto + fecha + resultado anterior; `desactualizado`/`no_disponible` → aviso correspondiente (distinto de "sin sondeos").
  - **Veda:** si la fecha del servidor cae en la ventana de veda → sustituye tabla+gráfica por aviso "Veda electoral (LOREG art. 69.7)".
  - Pie de **atribución CC BY-SA:** "Sondeos: Wikipedia (enlace al artículo + revisión usada), CC BY-SA 4.0, con modificaciones. Resultado oficial: infoelectoral (Ministerio del Interior)". La procedencia también va en el JSON.
- **Portada:** añadir sección/enlace de Política en `src/html/landing.ts` (columnas `.cols` + `.mas` + footer + entrada en el JSON-LD `ItemList`).
- **Sitemap:** bloque de `/politica/*` en `/sitemap.xml` (`src/routes/meta.ts`); `lastmod` por cambios **sustantivos**, no por cada comprobación. `robots.txt` sin cambios (mismo dominio canónico).

### 4) Aviso de errores (opción C)

**Sin tocar D1** (cupo agotado). Dos capas:

1. **Aviso inmediato al fallar el robot** (`scripts/politica-monitor.mjs`, patrón de `scripts/guardias-monitor.mjs`):
   - Paso final del workflow con `if: always()` + `continue-on-error: true` **solo en el envío** (el fallo del robot NO se convierte en éxito).
   - Reintentos limitados para errores transitorios; si persiste (descarga/parseo/validación/commit/deploy), mensaje **agregado** a Telegram: elecciones afectadas, causa, último éxito y enlace al run (`${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}`).
   - Reusa `secrets.TELEGRAM_BOT_TOKEN` + `secrets.TELEGRAM_CHAT_ID` (mismo chat que el resto de monitores).
2. **Vigilancia periódica en el error-monitor de 8 h** (`scripts/error-monitor.sh`): pasa a comprobar también el **`index.json` de política servido en producción** (no el commit) — su esquema y `ultimaComprobacionOk`/frescura por elección. Umbral inicial `> 30 h` para cadencia diaria (detección real ~30–38 h). El heartbeat verde solo si todo (incluida política) está bien.
   - Se separan tres tiempos distintos: **última comprobación correcta**, **última modificación de contenido** y **fecha del último sondeo**. Un sondeo antiguo **no** implica robot roto; la comprobación correcta renueva su marca aunque no cambien los sondeos.
   - Sin persistencia no se promete dedup entre ejecuciones: un aviso por run + recordatorio cada 8 h mientras siga mal.
   - El vigilante es un workflow independiente del robot (aunque ambos comparten que Actions programadas pueden retrasarse).

## Cadencia del robot

Diaria (barato; los sondeos salen varios por semana). Dead-man de frescura vía el error-monitor de 8 h.

## Pruebas

- **Unitarias** (vitest) del parser contra **fixtures HTML reales** de Wikipedia guardados: celda %+escaños, rangos, columnas fusionadas/dinámicas, meses es/en, cero sondeos, filas de referencia. Del cálculo de sube/baja (incluido el caso rango-ambiguo). De la lógica de **veda** (dentro/fuera de ventana, solo confirmadas). De los esquemas zod y de la validación multinivel (regresión datos→vacío bloqueada).
- **De endpoint** (patrón `tests/routes-*.test.ts`, `app.request` + `vi.resetModules`): `/politica/*` devuelven 200 y el contenido esperado; en veda simulada no aparecen sondeos.
- **Verificación en producción** con medidas tras desplegar; que lo existente siga funcionando (`tsc` + toda la batería de tests en verde antes de subir).

## Riesgos y notas

- **Honestidad del dato:** el sitio dice "todos los sondeos recopilados de las fuentes indicadas" (Wikipedia no garantiza exhaustividad), con estado de cobertura y fecha de comprobación; enlace a la ficha original cuando exista.
- **Coaliciones/escisiones/cambio de nº de escaños** (p. ej. eurodiputados 54→61): comparación desconocida ≠ 0; tratamiento explícito por ciclo.
- **CC BY-SA:** atribución visible + enlace + revisión + licencia + indicación de transformación; procedencia en el JSON. Compartir bajo licencia compatible el material adaptado sujeto a ella (no convierte el resto del código del sitio en CC BY-SA).
- **Estabilidad de Wikipedia:** contenido editorial cambiante, sin SLA; por eso validación defensiva + conservar último bueno + avisos.

## Fuera de alcance (v1)

- Otros países (el formato de Wikipedia existe por país, pero cada uno es un artículo distinto).
- Sondeos municipales (no hay proyección de escaños agregada útil).
- Media/agregado propio ("poll of polls"): riesgo metodológico; si acaso, usar el de Wikipedia.
- Sondeos de intención de líder y sub-nacionales por circunscripción (existen en Wikipedia; ampliación futura).
