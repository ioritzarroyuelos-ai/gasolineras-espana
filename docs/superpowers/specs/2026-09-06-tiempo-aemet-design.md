# El tiempo (AEMET) — diseño v1

Fecha: 2026-09-06
Estado: aprobado el diseño; pendiente de plan de implementación.

## Contexto

CercaYa (repo `webapp`, prod `webapp-3ft.pages.dev`, Cloudflare Pages/Workers) es
un portal de datos oficiales de España: gasolineras (Ministerio), farmacias de
guardia (COF) e ITV (DGT). Patrón común: buscador de municipio → página SSR por
municipio, con buen SEO de cola larga ("X en <municipio>"); datos servidos como
ficheros estáticos o vía Worker con caché; robots (GitHub Actions cron) refrescan.

Este documento cubre el **primer paso** de una visión mayor (convertir CercaYa en
un portal tipo periódico con datos + artículos propios). Se empieza por el vertical
más sencillo y sin riesgo: **el tiempo**. La capa editorial (artículos redactados
por IA a partir de los datos, revisados por el humano) queda para después; aquí NO
se construye.

## Objetivo (v1)

Predicción meteorológica por municipio de España, fuente **AEMET**, con el mismo
patrón que el resto de verticales: buscador → página del municipio. Sin artículo de
IA. Color verde de marca. Sin tocar nada de lo existente.

## No-objetivos (YAGNI en v1)

- Sin artículo/resumen redactado por IA.
- Sin predicción **por horas** (solo diaria).
- Sin **avisos/alertas** de AEMET.
- Sin mapa.
- Sin noticias/política.

Todo lo anterior son mejoras posteriores, fuera de este spec.

## Fuente de datos: AEMET OpenData

- API pública gratuita (`opendata.aemet.es`), requiere **clave** gratuita.
- **Patrón de dos pasos:** una petición devuelve `{ estado, datos: <url> }`; el JSON
  real está en la URL `datos`. Hay que encadenar las dos llamadas.
- Endpoint relevante: predicción **diaria** por municipio, por **código INE** de
  municipio (5 dígitos). (El endpoint/campos exactos se confirman al implementar.)
- **Límites de peticiones:** AEMET limita el ritmo. Toda ingesta masiva debe ir con
  freno (throttle) y reintentos suaves. Por eso NO se hace snapshot de los ~8.100
  municipios (ver arquitectura).
- **Clave como secreto:** `AEMET_API_KEY` como secreto de Cloudflare (Worker) y de
  GitHub (robot). Nunca en el código.

### Códigos de municipio (INE) — pieza base

AEMET indexa por **código INE**; los datos actuales (gasolineras) usan IDs del
Ministerio, que NO coinciden. Por tanto el tiempo se apoya en una **lista oficial
del INE** empaquetada en el repo (una sola vez), con: código INE, nombre, provincia,
población y **coordenadas (lat/lng)**. Esa lista sirve para cuatro cosas a la vez:
1. Índice de municipios del autocompletado (`/api/tiempo/municipios`).
2. Selección de municipios "importantes" para el snapshot (por población).
3. Código INE con el que consultar AEMET.
4. Coordenadas para consultar la fuente secundaria (Open-Meteo), que trabaja por
   lat/lng (ver "Tolerancia a fallos").

Cubre los ~8.100 municipios (no solo los que tienen gasolinera), así que el vertical
del tiempo es más completo que los otros.

## Tolerancia a fallos: fuente secundaria (Open-Meteo)

Para no dejar a la gente sin información si AEMET cae, hay una **fuente secundaria**:
**Open-Meteo** (gratis, sin clave, por lat/lng, cubre España).

Reglas:
- **AEMET es la principal.** Se usa siempre que responde bien.
- Si AEMET falla (caído, error, límite, respuesta inválida) tras sus reintentos, se
  sirve la predicción de **Open-Meteo** para ese municipio, para que la página nunca
  quede sin dato.
- Se **sigue reintentando AEMET**; en cuanto vuelve a responder, **se sustituye** el
  dato de Open-Meteo por el de AEMET (auto-recuperación).
- **Etiquetado honesto:** cada predicción lleva su `fuente`. Si el dato es de la
  secundaria, la página lo dice ("Datos de Open-Meteo · AEMET no disponible
  temporalmente"). Nunca se etiqueta Open-Meteo como AEMET.
- **Diseño por adaptadores:** un adaptador AEMET y un adaptador Open-Meteo, cada uno
  convierte su respuesta cruda al **mismo modelo normalizado**; la página renderiza
  igual venga de donde venga. Añadir/quitar una fuente no toca la página.
- En bajo-demanda, una entrada cacheada servida por la secundaria lleva **TTL más
  corto** que una de AEMET, para reintentar AEMET antes y volver a la principal
  cuanto antes.

## Arquitectura de datos — híbrido

- **Snapshot estático** de los municipios "importantes": **las 52 capitales de
  provincia + municipios de ≥ 50.000 habitantes** (~150 en total). Un robot los baja
  de AEMET y los guarda como ficheros estáticos → CDN. Da páginas instantáneas y
  buen SEO en las consultas de mayor volumen, sin arranque en frío.
- **Bajo demanda + caché en el borde** para el resto (~8.000): al abrir un municipio
  que no está en el snapshot, el Worker consulta AEMET (dos pasos) y cachea el
  resultado (Cloudflare Cache API o KV, TTL ~2 h) por código INE. Solo se piden los
  municipios que la gente visita, respetando los límites de AEMET.

Es el primer vertical que no es 100 % estático; encaja porque el tiempo cambia
durante el día.

## Modelo de datos (predicción normalizada)

Por municipio, se normaliza la respuesta de AEMET a una forma estable e independiente
de su formato crudo (que es incómodo). Forma prevista por día:
`{ fecha, tmin, tmax, cielo (código+texto), probLluvia, viento }`, más metadatos:
`{ ine, nombre, provincia, elaborado (timestamp), fuente: 'AEMET' | 'Open-Meteo' }`.
Ambas fuentes (AEMET y Open-Meteo) se normalizan a **esta misma forma** vía sus
adaptadores (ver "Tolerancia a fallos"), así la página no distingue el origen salvo
para el etiquetado. Se muestran **hoy + 6-7 días**. (Los campos exactos se cierran
contra las respuestas reales al implementar.)

## Rutas / páginas (mismo patrón existente)

- `/tiempo/` — portada: **buscador de municipio** (autocompletado, como farmacias/
  ITV) + lista de provincias + contenido SEO.
- `/tiempo/<provinciaSlug>` — provincia: municipios de la provincia + su capital.
- `/tiempo/<provinciaSlug>/<municipioSlug>` — **predicción del municipio** (SSR,
  indexable). Hoy + próximos días; mín/máx, estado del cielo, prob. de lluvia, viento.
- `/api/tiempo/municipios` — índice ligero `[{n,p,u}]` para el autocompletado (cache
  en memoria + CDN, como `/api/guardias|itv/municipios`).
- `/tiempo` → 301 a `/tiempo/`. Baldosa "Tiempo" añadida en la portada `/`.
- Color verde de marca (`#16a34a`), CSP estricta en las páginas sin mapa.

## Frescura / red de seguridad

Igual filosofía que guardias: nunca mostrar una predicción vieja como la de hoy.
- Sello visible con la **fuente real**: "Datos de AEMET · actualizado a las HH:MM"
  (o "Datos de Open-Meteo · AEMET no disponible" si se sirvió la secundaria).
- Si el dato (snapshot o caché) supera un umbral de antigüedad, aviso claro de que
  puede no estar actualizado, en vez de presentarlo como vigente.

## Robot (GitHub Actions cron)

- Refresca el snapshot de los ~150 "importantes" **3-4 veces al día**, con throttle
  para respetar los límites de AEMET y reintentos suaves ante fallos transitorios.
- Sube con el **push resistente** (`git merge -X ours` + reintento) ya implantado.
- Si AEMET falla en un municipio tras sus reintentos, cae a **Open-Meteo** para ese
  municipio (marcado con su `fuente`), en vez de dejarlo vacío o con dato viejo.
- Los municipios que quedaron en la secundaria se **reintentan con prioridad** en el
  siguiente pase y, al responder AEMET, se **sustituyen** por el dato de AEMET.

## Errores / degradación

- AEMET caído o clave inválida: se sirve **Open-Meteo** (etiquetado) — ver
  "Tolerancia a fallos". El sitio no se queda sin dato del tiempo.
- Solo si **AEMET y Open-Meteo fallan a la vez**: servir la última cacheada aunque
  esté algo vieja (con aviso); y si tampoco hay, degradar con un aviso ("no se pudo
  obtener la predicción, inténtalo más tarde"), sin romper el resto del sitio.
- Municipio inexistente / slug inválido: 404 (no meter páginas vacías en el índice).

## Pruebas

- Unitarias: adaptador de AEMET (dos pasos → predicción normalizada), adaptador de
  Open-Meteo (→ la misma forma normalizada), lógica de fallback (AEMET falla →
  Open-Meteo, con `fuente` correcta) y de auto-recuperación (vuelve a AEMET),
  construcción del índice de municipios y selección de "importantes" por población.
- e2e: portada `/tiempo/` (buscador + navegación) y una página de municipio (render,
  sello de frescura); axe de accesibilidad.
- Como siempre: `tsc` + tests en verde antes de subir, y verificación en producción.

## Riesgos / puntos abiertos

- **Límites de AEMET**: confirmar el ritmo real y ajustar throttle/cadencia.
- **Formato AEMET / Open-Meteo**: cerrar el mapeo de campos de AMBAS contra sus
  respuestas reales (cielo, viento…) al modelo normalizado común.
- **Criterio de "AEMET caído"**: definir cuándo se decide caer a la secundaria (p. ej.
  N reintentos fallidos / timeout) para no cambiar de fuente por un fallo puntual.
- **Lista INE**: elegir la fuente concreta del padrón (con coordenadas) y empaquetarla;
  fijar el umbral de "importantes" (50.000 hab es la propuesta inicial).
- **Caché en el borde**: decidir Cache API vs KV para el bajo-demanda (con TTL más
  corto para las entradas servidas por la secundaria).

## Fuera de alcance / siguiente paso

Tras el tiempo (datos), el siguiente hito de la visión "periódico" sería el **motor
editorial** (IA redacta borrador anclado en los datos → el humano revisa y publica),
probado primero sobre un tema de datos limpio. Spec aparte cuando toque.
