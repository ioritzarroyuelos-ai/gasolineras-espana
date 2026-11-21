# Servicios cerca de un municipio

Estado: implementación I validada en una preview real de Cloudflare, pendiente de publicación y del primer ciclo del robot. Todas las rutas devuelven `noindex,follow` y `X-Robots-Tag: noindex, follow`. No se añaden al sitemap ni se habilita indexación mediante una variable.

## Alcance del contenido

- `/servicios/municipios` permite elegir una provincia; `/servicios/municipios/:provincia` ofrece páginas de 50 municipios.
- `/servicios/municipio/:ine/:slug` muestra los lugares a un máximo de 5.000 metros en línea recta del punto publicado por AEMET, con recuentos completos por categoría y hasta los 12 lugares más próximos.
- El círculo no es un límite administrativo. Se conserva el municipio que figure en cada lugar de OpenStreetMap; pueden aparecer lugares de municipios vecinos. Las distancias no parten de la ubicación del visitante ni representan trayectos.
- El punto de AEMET no tiene que ser el centro del casco urbano. La ficha de Madrid advierte que está junto al Real Observatorio.
- La muestra no confirma apertura, accesibilidad, plazas libres ni guardias. Los enlaces abren la ficha vigente del mapa y la fuente original. La ausencia de registros no afirma que falte un servicio.
- Las fechas de consulta, extracto OSM, edición de cada ficha, copia AEMET y fecha original AEMET (si se publica) se distinguen. No se rejuvenecen al reconstruir la web.

La copia real de OpenStreetMap generada por el robot en el commit `137c65f2a2128d9f5e70dfa5ae7987b4afe9ae09` contiene 577.863 lugares; fue consultada el 21 de noviembre de 2026 a las 10:04:11Z y procede de extractos del 20 de noviembre a las 21:21:21Z. La derivación produjo 8.107 fichas; 15 puntos de referencia no tienen lugares dentro del radio. Esos 15 casos no son fallos de la fuente.

## Productor y lectura acotada

`node scripts/gen-servicios-municipales.mjs --source <directorio OSM> --municipios <catálogo AEMET> --output <destino>` valida el índice, todos los bloques OSM, sus hashes, las coordenadas y la identidad de los lugares antes de derivar resultados.

Los bloques publicados tienen nombres derivados de su SHA-256. Primero se escriben los bloques inmutables y después se reemplaza el índice raíz; sólo entonces se limpian los bloques antiguos de ese directorio. Un fallo previo a la publicación conserva el índice anterior. No se modifican a mano los datos públicos.

La salida real medida ocupa 25.43 MB en 866 archivos: un índice raíz, 52 índices provinciales y 813 bloques de fichas. El objetivo de empaquetado es 32 KiB; el lector rechaza cualquier archivo que supere 128 KiB. No descarga el catálogo nacional de lugares durante una petición.

Una ficha necesita como máximo tres lecturas de recursos estáticos: índice raíz, provincia y bloque. Cada bloque se comprueba por tamaño y SHA-256; la ficha entregada se valida estrictamente, incluyendo distancia real, orden, conteos, identidad y pertenencia de las coordenadas a la zona. La caché raíz dura 30 segundos y la de contenido inmutable mantiene como máximo 16 bloques por binding.

## Actualización autónoma

El coordinador existente ejecuta dos trabajos independientes, con reintento cuando fallan:

| Trabajo | Hora UTC | Publicación |
| --- | --- | --- |
| `gen-tiempo-municipios.yml` | 08:07 | Maestro de puntos AEMET y estado de la consulta |
| `fetch-servicios-municipales.yml` | 09:27 | Resúmenes de proximidad a partir de copias verificadas |

La clave AEMET sólo se transmite al endpoint oficial inicial. No se reenvía a los archivos de datos/metadatos, no se sigue una redirección y no se registra. Las descargas tienen host/ruta permitidos, límite de tamaño y tiempo máximo. Se exige cobertura nacional coherente, coordenadas válidas, ausencia de duplicados y que una actualización no pierda más del 1% de los municipios anteriores.

Si AEMET falla, el archivo previo queda intacto y se publica un estado de error o copia conservada con la fecha del último éxito; el trabajo termina con fallo para que el coordinador lo reintente. Un maestro antiguo pero válido permite seguir derivando las fichas, con aviso visible, en lugar de inutilizar todos los municipios.

`/status` distingue la revisión del maestro y la derivación. Una consulta OSM de más de 30 horas o un extracto de más de 72 horas muestran la copia pendiente de actualización. Una derivación con cero lugares en un centro no inventa incidencias ni cifras para aparentar éxito.

## Verificación y límites pendientes

Las pruebas cubren el borde de 5 km, pueblos vecinos, duplicados, fechas imposibles/futuras, hashes y tamaños, conservación del índice ante fallo, aislamiento entre bindings, tres lecturas por ficha, escapes HTML, CSP, rutas y paginación. Las pruebas de AEMET comprueban que una caída conserva los bytes anteriores y que la clave no llega a descargas ni dominios ajenos.

Las cinco pruebas de navegador con casos controlados pasaron a 1.280, 390 y 320 píxeles, incluyendo accesibilidad automática, texto antiguo y funcionamiento sin JavaScript. Un smoke separado con datos reales pasó para Madrid, Durango y Ceuta. La revisión independiente del productor, lector y automatización no detectó fallos materiales.

El perfil de la petición Pages completa en workerd local incluye el adaptador local de recursos, las reglas de enrutamiento, el framework y el render. Dio estimaciones de 54–62 ms por petición caliente y no acreditaba la cuota gratuita. Se sustituyó esa comprobación por una medición real en `https://e66e4a95.webapp-3ft.pages.dev`, artefacto del commit `1d48305f20841a294e58b34be8ac81ce50631087`: el 21 de noviembre de 2026, de 11:28:20.743 a 11:28:23.089 UTC, se consultaron 12 rutas del índice, provincias y municipios en dos vueltas consecutivas. Todas devolvieron 200. La consulta GraphQL `pagesFunctionsInvocationsAdaptiveGroups`, limitada a ese intervalo y al Worker de preview, registró exactamente 24 peticiones, cero errores, CPU P50 de 0,975 ms y P99 de 6,781 ms, por debajo de los 10 ms del plan gratuito. Es una muestra real acotada, no una garantía sobre cualquier carga futura. El ensayo de navegador remoto también pasó para Madrid, Durango y Ceuta, incluyendo Durango a 390 píxeles sin desbordamiento.

La primera consulta autenticada del nuevo productor AEMET también se comprobará mediante el robot; no se ha simulado un éxito real a partir de las pruebas con respuestas controladas.

## Revisión previa a cualquier indexación

Google considera problemáticas las páginas masivas sin valor añadido y las páginas locales que sólo sirven de entrada al mismo destino. Por eso estas fichas permanecen fuera del índice. El informe del productor cuenta como señal editorial los centros con al menos seis lugares, cuatro nombres no genéricos y tres categorías: no es una regla de Google ni una autorización automática para indexar. También cuenta muestras repetidas entre municipios para revisarlas.

La salida real actual informa 5.819 fichas que cumplen esa señal y 128 muestras repetidas. Antes de cambiar `noindex` se debe revisar utilidad y duplicación con ejemplos urbanos, rurales, fronterizos e islas; verificar que el visitante puede resolver su consulta; medir la preview real; y registrar el resultado en una revisión de código. No existe una opción oculta que active miles de páginas sin ese cambio revisado.

## Fuentes y condiciones

- [OpenStreetMap: atribución y ODbL](https://www.openstreetmap.org/copyright). Los puntos son comunitarios, no una inspección oficial de cada local.
- [AEMET: condiciones de reutilización](https://www.aemet.es/es/nota_legal) y [especificación del servicio OpenData](https://opendata.aemet.es/AEMET_OpenData_specification.json). Se conserva la atribución, las fechas conocidas y los metadatos publicados.
- El índice y las páginas mantienen el crédito del recorte territorial del IGN recibido del productor nacional, bajo CC-BY-4.0. No se emplean sus límites para atribuir un lugar a un municipio.
- [Google: políticas contra el contenido abusivo y páginas puerta](https://developers.google.com/search/docs/essentials/spam-policies).
- [Cloudflare: límites de Workers](https://developers.cloudflare.com/workers/platform/limits/).
