# Transporte: fuentes, actualización y comprobaciones

Estado de este bloque: implementado y comprobado en local; **publicación y primera ejecución diaria en producción pendientes**. Esta nota no acredita que el bloque esté ya desplegado.

El árbol de publicación C se compiló y pasó la comprobación de tipos. La
comprobación conjunta aprobó **42 pruebas de navegador** de cuenta, Metro,
cámaras y avisos ITV, incluida accesibilidad móvil y la conservación del mapa
de gasolineras. Se revisaron las capturas resultantes. La auditoría de
dependencias de producción no encontró vulnerabilidades conocidas en esa
consulta; no sustituye las comprobaciones continuas ni garantiza ausencia de fallos.

La primera red de llegadas verificadas es **Metro Bilbao**. El mapa y la página `/transporte/metro-bilbao` muestran destinos y horas estimadas de llegada. La fuente no publica en este parte una hora de salida, un andén ni el horario completo: no se calculan esos datos. Una lista vacía no significa que no haya trenes.

## Fuentes primarias y licencia

- [Catálogo de información de Metro Bilbao en tiempo real, CTB](https://data.ctb.eus/dataset/metro-bilbao-online): parte oficial accesible sin clave, bajo CC BY 4.0.
- [Catálogo de horarios y estaciones, CTB](https://data.ctb.eus/dataset/horario-metro-bilbao): archivo oficial del Consorcio de Transportes de Bizkaia, bajo CC BY 4.0.
- Atribución visible: Consorcio de Transportes de Bizkaia · Metro Bilbao. Se conserva el enlace a la licencia y a cada catálogo.

No se incorporan nuevas cuentas, claves ni servicios de pago. El directorio se produce en el robot; el navegador consulta una API del propio sitio sin enviar su posición.

## Cómo se actualiza

`node scripts/fetch-transporte.mjs` descarga el archivo oficial y produce `public/data/transporte/metro-bilbao.json`. `--check` valida sin escribir. `TRANSPORTE_DIR` permite una carpeta de pruebas y `PYTHON` selecciona el intérprete. Python usa únicamente su biblioteca estándar para leer el ZIP y los CSV; no se descomprime nada en el Worker.

El productor conserva la fecha original de `Last-Modified`, el calendario de servicio, la fecha de consulta, los bytes y SHA-256. Valida todos los destinos y referencias antes de sustituir el archivo mediante renombrado. Ante un fallo mantiene el archivo anterior y termina con error.

El workflow `fetch-transporte.yml` está preparado para el coordinador diario de las 08:47 UTC. El catálogo y las comprobaciones independientes de las fuentes se ejecutan por separado. Se publica el informe de errores aunque una fuente falle; el workflow termina con error para conservar el reintento del coordinador. La ejecución en producción debe comprobarse al publicar este bloque.

El parte de llegadas se consulta bajo demanda y se comparte durante **30 segundos**. Tiene una validez máxima de **2 minutos**. El catálogo necesita una consulta de menos de 30 horas, una fecha original de menos de 72 horas y un calendario válido. No se unen predicciones con un catálogo vencido. Cada ficha conserva sus fechas originales.

Página y capa del mapa vuelven a consultar cada 30 segundos mientras están visibles. Retiran una llegada que ya pasó sin esperar a otra respuesta. La caducidad usa la hora de evaluación del servidor y el tiempo transcurrido del navegador; atrasar el reloj del dispositivo no extiende la validez. La vuelta desde una pestaña suspendida comprueba primero los plazos.

## Controles de datos

- El productor admite un ZIP de hasta 10 MB y limita archivos, contenido descomprimido y tiempo de conversión. Rechaza rutas anidadas, duplicados, archivos cifrados y referencias incoherentes.
- El lector del parte limita la descarga a 512 KB y 6 segundos, con URL fija y sin seguir redirecciones.
- Usa el identificador del viaje para encontrar su destino. No deduce el sentido de la marcha a partir de una numeración incompatible entre las dos fuentes.
- Respeta servicios del día anterior después de medianoche, calendarios y excepciones. Sólo muestra cancelaciones con fecha de servicio comprobada; ignora cancelaciones antiguas o sin fecha.
- Desconocidos, duplicados ambiguos, partes del futuro y datos caducados producen un aviso o rechazo; nunca completan la información con suposiciones.
- Se muestran como máximo cinco llegadas por estación, indicando si el parte contiene más.
- Los filtros de horario, precio y accesibilidad del mapa no se aplican a esta capa: la fuente de llegadas no acredita esos atributos.
- Los favoritos de estaciones y cámaras guardan sólo su identidad, nombre y posición. Al abrirlos se vuelve a consultar la fuente; no guardan llegadas, imágenes ni disponibilidad. Incidencias temporales y guardias no se convierten en favoritos.

## Vigilancia independiente de fuentes

`node scripts/check-fuentes-movilidad.mjs` revisa Bizi Zaragoza, tráfico SCT, cámaras SCT y Metro Bilbao. Escribe `public/data/transporte/fuentes.json` con fecha de consulta, fecha original, estado y recuento de cada fuente. También admite `--check` y `TRANSPORTE_DIR`.

Una fuente caída no impide comprobar las otras. Un parte actual con cero incidencias es válido: el informe no inventa una incidencia para señalar que ha hecho la comprobación. Los errores publicados son acotados y genéricos, sin credenciales ni información del visitante.

## Evidencia local del 21 de noviembre de 2026

La descarga real del catálogo contenía **42 estaciones, 42 puntos de parada y 6.368 viajes**. Se descartaron 107 entradas de estación como puntos independientes. El archivo original tenía 1.710.038 bytes y fecha `2026-11-20T02:00:02Z`; el catálogo reducido ocupó aproximadamente 464 KB.

Los identificadores de los viajes y paradas de los partes consultados coincidían con el catálogo. La página real respondió 200 con las 42 estaciones. En la comprobación de las 01:12:47 UTC había 38 llegadas futuras en toda la red; el recuento disminuyó durante las comprobaciones siguientes, como corresponde a horas que ya habían pasado. Estas cifras documentan una consulta concreta, no una disponibilidad permanente.

Se revisaron capturas de escritorio y móvil. El mapa móvil cargó su cartografía y las estaciones de la zona visible; las fichas sin predicción mostraron la ausencia de llegadas comprobadas. Las pruebas de navegador cubren búsqueda, accesibilidad, tamaños de pantalla, errores, actualización, favoritos, desaparición de un lugar, respuestas tardías y reloj atrasado. Las pruebas unitarias verifican lectura de archivos, calendario, límites, caducidad, caché e independencia de fuentes.

La comprobación dirigida de C pasó 54 pruebas del lector, productor e informe, más 4 del reloj compartido: **58 unitarias**. También pasaron **9 pruebas de la página**, **5 del mapa** y **2 de favoritos**. Otras 2 pruebas comprueban la corrección del reloj para Bizi y SCT en el mapa. Los datos artificiales de esas pruebas verifican comportamiento; la consulta real anterior acredita únicamente los datos que devolvió la fuente en ese momento.

La vigilancia real ejecutada con `--check`, sin escribir datos, terminó correctamente a las `2026-11-21T01:19:52Z`: 276 estaciones Bizi, 192 incidencias SCT, 36 cámaras y 42 estaciones Metro. Las horas originales de cada fuente se conservaron por separado.

Los dos hallazgos de la revisión independiente del generador de estado quedaron corregidos: rechaza fechas originales futuras o posteriores a la consulta y comprueba que el calendario del directorio incluya hoy según Madrid. Además verifica que cada fuente estuviera dentro de su plazo al consultarla (Bizi 5 minutos, SCT 10 minutos, cámaras 30 horas y Metro 2 minutos). Un informe válido de ayer se conserva como comprobación diaria y no se confunde con disponibilidad en directo; su propio límite sigue siendo 30 horas. Los 22 casos del generador de estado incluyen fechas imposibles, medianoche local, calendarios vencidos, descargas antiguas y partes válidos sin incidencias.

En una prueba aislada de `workerd`, 500 normalizaciones del parte dieron aproximadamente **0,64 ms de JavaScript activo por normalización** (42 estaciones, 108 llegadas en aquella muestra). Esa medida no incluye todo el coste de una petición ni garantiza el coste de los arranques en frío. Deben revisarse las métricas del despliegue antes de afirmar que toda petición encaja en un límite de CPU concreto.

## Cobertura pendiente

Este bloque no acredita llegadas de otras redes españolas, todas las líneas de transporte, ocupación de vehículos, tarifas, retrasos calculados ni accesibilidad de las estaciones. Esas ampliaciones requieren nuevas fuentes comprobables. Tampoco convierte el mapa de una ZBE en una afirmación sobre permisos de acceso o sanciones vigentes.
