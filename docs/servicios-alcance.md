# Alcance comprobable de servicios cercanos

Revisión: **21 de noviembre de 2026**. Conserva la numeración acordada en el
chat «WEB ESPAÑA CERCA»: bloques 1–9 y 11–13. El bloque 10 está excluido por
petición expresa. Esta matriz describe el código y las pruebas de la rama de
servicios; **no certifica que todos los bloques estén completos ni que todos
estos cambios estén ya publicados en producción**.

Se mantiene el mapa de gasolineras. Las fuentes nuevas son gratuitas. No se han
creado cuentas publicitarias, acuerdos comerciales, reservas de pago ni otra
base D1. El usuario confirmó que no tiene cuentas o acuerdos para monetización.

## Qué significan los estados

- **Implementado**: existe un recorrido utilizable y datos o pruebas que lo
  respaldan. No equivale a cobertura de todos los negocios o municipios.
- **Parcial**: funciona una parte del bloque, con límites indicados.
- **Pendiente**: falta fuente, integración, interfaz, verificación o un requisito
  externo. Un nombre reservado en el catálogo no cuenta como servicio disponible.

## Evidencia de cobertura de esta revisión

El extracto nacional comprobado en local contiene **577.770 lugares únicos por
identificador OSM**, en **2.269 cuadrículas**, con **53 categorías que tienen
datos de las 58 previstas en el catálogo**. La consulta del robot es
`2026-11-20T23:58:01.566Z`; el extracto más antiguo del conjunto es del
`2026-11-19T21:22:20Z`. Son fechas distintas y se mantienen ambas. No se trata de
577.770 establecimientos inspeccionados personalmente ni de cobertura exhaustiva.

La extracción separa 547.281 puntos de España sin Canarias y 30.489 de Canarias.
El resultado JSON ocupa 186.862.987 bytes; la hoja mayor mide 477.793 bytes. El
ensayo local de extracción tardó unos 8 min 23 s para España y 23 s para Canarias,
además de aproximadamente 6 min 06 s y 13 s de descarga, respectivamente. Son
mediciones de ese ensayo, no tiempos garantizados de Actions. El índice mide
aproximadamente 357 KB. Los límites de publicación son 250 MiB y 800.000 puntos;
su finalidad es controlar recursos y rechazar una copia desbordada, no recortarla
silenciosamente. La geometría IGN elimina puntos fuera de España, incluido
Gibraltar; las cajas del mapa no se usan como prueba de pertenencia territorial.

En ese extracto no tienen datos `refugios-climaticos`, `puntos-violeta`,
`paqueteria`, `dni-pasaporte` y `salas-estudio`. Puntos Violeta tampoco tiene aún
una regla de clasificación verificada. No se muestran categorías vacías como
si ya ofrecieran cobertura. Las taquillas de paquetes sí tienen datos y son una
categoría distinta de los comercios de recogida de paquetería.

La auditoría del catálogo ITV usado en esta rama encontró **571 estaciones**, de
las que **99 tienen coordenadas publicadas y procedencia admitida**. Las otras
472 permanecen en el directorio, sin colocarlas en un centro municipal. De las
99 situadas, 55 tienen enlace de cita comprobable y 10 conservan una fecha
antigua de comprobación de coordenadas, que se indica al visitante.

Consultas reales adicionales del equipo, que son evidencia de integración y
**no cifras vigentes para planificar un viaje**:

| Fuente | Comprobación | Resultado entonces |
| --- | --- | --- |
| Bizi Zaragoza | 20/11/2026, 23:56:21 UTC | 276 estaciones; disponibilidad comprobable en esa consulta. |
| Tráfico SCT | 21/11/2026, 00:03:49 UTC | 195 incidencias del parte: 175 con punto y 20 sólo en el listado. |
| Cámaras SCT/Terrassa | API 21/11/2026, 00:20:43 UTC | 36 cámaras españolas únicas con coordenadas: 35 SCT y 1 Terrassa; se excluyó una de Andorra y se eliminó una repetición exacta. Las 36 URLs respondieron a HEAD sin descargar imágenes. |
| Guardias oficiales | Lectura de las copias disponibles, 21/11/2026, 00:31:56 UTC | 47 archivos revisados. Los lectores admitieron entonces 292 puntos con coordenadas fiables en 144 zonas; 284 turnos activos. Es un recuento de esa hora, no una lista válida para días posteriores. La prueba web real mostró 4 guardias en la vista de Madrid; Almería conservó el aviso de fuente antigua del 12/11 y ningún pin. |

## Matriz de los 12 bloques

| Bloque acordado | Implementado y comprobable | Limitación o pendiente real |
| --- | --- | --- |
| **1. Mapa único e interactivo — parcial** | `/cerca` reutiliza el mapa original, con modo servicios y comparación de carburantes. GPS con permiso, búsqueda de municipio/categoría, dirección o CP mediante CartoCiudad y elección explícita de coincidencia. Categorías, agrupación de puntos, distancia en línea recta, teléfono/web publicados, Google Maps/Apple Maps/Waze, favoritos y fechas. Filtros de horario publicado, gratis y accesible sólo con datos explícitos. Capas específicas de ITV, Bizi, tráfico SCT, cámaras y guardias oficiales con coordenadas fiables. | No hay una disponibilidad en directo universal ni alertas para todos los servicios. El horario publicado no garantiza apertura real: sólo se interpreta un subconjunto de reglas; excepciones ambiguas quedan sin confirmar. Distancia en línea recta, sin cálculo propio de rutas. Los precios comparables son los ya disponibles en gasolineras; un lugar OSM no adquiere tarifas por aparecer en el mapa. Las cámaras enlazan a su fuente; no ofrecen un vídeo en directo verificado. |
| **2. Automoción, aparcamiento y carreteras — parcial** | Se conservan gasolineras/precios y recarga oficial. ITV con ubicación justificable, ficha completa y enlaces oficiales de cita/tarifas. OSM aporta aparcamientos, talleres, neumáticos, lavaderos, autocaravanas, asistencia, peajes, áreas de servicio/descanso y venta de gas. Filtro gratis y accesibilidad cuando la ficha lo indica. SCT aporta incidencias de Cataluña, con parte completo y puntos de referencia. API y fichas de cámaras SCT/Terrassa con enlace a la fuente, sin descargar imágenes automáticamente. | Los enlaces de ITV no son una reserva realizada ni muestran huecos libres. No hay ocupación ni reservas de aparcamiento, filtros específicos P+R/plazas PMR ni recarga disponible en directo. No hay tarifas de peajes, restricciones ZBE ni tráfico nacional completo. Las cámaras integradas son SCT/Terrassa, **no una cobertura de cámaras DGT**. La hora de cada imagen es desconocida. La asistencia en carretera tiene una presencia mínima en el extracto y no implica servicio inmediato. |
| **3. Transporte público y movilidad urbana — parcial** | Directorio OSM de estaciones de autobús, tren y metro, paradas, taxis, alquiler/aparcamiento/reparación de bicicletas. Bizi Zaragoza añade bicicletas y anclajes disponibles, estados de servicio y permisos de retirada/devolución con caducidad individual. | No se han integrado horarios de viaje, próximas salidas, retrasos o GTFS/tiempo real de todos los operadores. Bizi cubre Zaragoza; el resto del alquiler de bicicletas es un directorio de ubicaciones. Que una estación esté operativa no significa que tenga bicicletas o anclajes libres: el cero se muestra como cero. |
| **4. Salud y emergencias — parcial** | Farmacias OSM y capa diferenciada de guardias oficiales, con filtros de turnos publicados, guardia ahora y 24 h sólo cuando consta explícitamente. Las guardias localizadas o por confirmar se distinguen de las activas; se muestran fecha, horario literal, contacto y enlaces oficiales. Hospitales, centros de salud, urgencias etiquetadas, veterinarios, desfibriladores, donación de sangre y ascensores. Datos de contacto/horario si constan y aviso de que el mapa no confirma disponibilidad inmediata. Se conserva la sección oficial de guardias. | Una farmacia OSM no se considera de guardia. No hay una cobertura comprobada de veterinarios de urgencias/24 h, centros médicos 24 h, Puntos Violeta, refugios climáticos ni rutas accesibles completas. La categoría de ascensores no certifica acceso público o funcionamiento actual si falta el dato. No se infieren urgencias de un horario genérico. Sólo se sitúan guardias con coordenadas explícitamente fiables en el lector existente. Las fuentes antiguas, los turnos ambiguos y los municipios sin coordenadas conservan avisos y enlaces, sin pines inventados ni afirmación de apertura. Los estados caducan antes de pedir la siguiente respuesta; no se guardan turnos temporales como favoritos. |
| **5. Baños públicos y servicios esenciales — parcial** | Baños, agua potable y cajeros; búsqueda cercana, distancia, acceso para clientes/público/desconocido, gratuito/de pago/desconocido y accesibilidad según etiquetas. Se excluyen accesos privados/prohibidos explícitos y lugares cerrados o abandonados etiquetados. | No hay clasificación completa de baños dentro de estaciones, parques o centros comerciales, ni garantía de que todos estén registrados. No se publica el importe de uso si sólo consta que es de pago. Un punto dentro de un recinto puede no coincidir con su entrada. «Agua potable» procede de la etiqueta publicada y no de un análisis del agua realizado por la web. |
| **6. Compras y servicios cotidianos — parcial** | Supermercados, horarios publicados, mercados/mercadillos registrados, oficinas postales, taquillas de paquetes, puntos limpios, reciclaje y donación de ropa. El filtro de apertura evita reglas ambiguas y datos de directorio caducados. | No hay cobertura de calendarios semanales de todos los mercadillos ni de recogida de paquetes en comercios: esta última categoría no tiene datos en el extracto revisado. No hay filtros específicos ni calendario de recogida para aceite y pilas. Que exista un punto de reciclaje no confirma que acepte cualquier material. |
| **7. Administraciones y servicios públicos — parcial** | Policía, Guardia Civil y bomberos; oficinas de empleo etiquetadas, Seguridad Social, Hacienda, atención ciudadana, bibliotecas, centros culturales y wifi explícitamente público/gratuito. | No se distingue de forma completa Policía Nacional/Local. Una oficina de empleo no debe darse por oficina SEPE específica sin verificar el organismo. No hay resultados comprobados para DNI/pasaporte o salas de estudio en el extracto revisado. No hay citas administrativas ni plazas de estudio disponibles; las etiquetas no garantizan que toda biblioteca/polideportivo sea municipal. |
| **8. Parques y espacios públicos — parcial** | Parques, parques infantiles, parques para perros y áreas de descanso OSM, con acceso, horario y accesibilidad cuando constan. | La cobertura depende de la cartografía. No hay inventario completo de equipamiento, cierres temporales, estado de juegos, normas caninas o rutas accesibles verificadas. Las zonas caninas se basan en la categoría publicada, no en una autorización inferida para cualquier parque. |
| **9. Turismo, ocio y deporte — parcial** | Campings, consignas, playas/calas registradas como playa, piscinas con indicación de acceso/operador público y polideportivos. Se mantiene la sección deportiva existente. | No hay banderas de playa, calidad/condiciones de baño, socorristas presentes, horarios de vigilancia o disponibilidad/reservas de camping, consignas y piscinas en directo. La categoría OSM de centro deportivo no certifica por sí sola titularidad pública. No se anuncian reservas ni plazas libres inventadas. |
| **11. Usuarios y personalización — parcial** | Acceso Google y sincronización KV existentes. Nuevos favoritos OSM/ITV/Bizi, separados de gasolineras/deportes; aparecen en Inicio y Mi día. Categorías preferidas y hasta 12 municipios. Historial local opcional, limitado y borrable. Exportación y vaciado de ajustes con confirmación. Recordatorio ITV con fecha indicada por el visitante y archivo de calendario con avisos 7 y 1 días antes. Resumen diario Telegram corregido. | El resumen Telegram no es una alerta específica de bajada de precio. No hay alertas de disponibilidad ni recordatorios ITV por Telegram. El calendario requiere importación y notificaciones del calendario del visitante; cambiar la web no cambia la copia importada. Vaciar preferencias no elimina la identidad Google ni revoca todas las sesiones. No hay favoritos de incidencias temporales ni de cámaras activados. |
| **12. Publicidad y monetización — pendiente de requisitos externos** | Se conserva únicamente la aportación mediante `SUPPORT_URL` si el titular la configura. Las funciones útiles no dependen de activar anuncios. | El usuario no tiene AdSense aprobado ni acuerdos. Pendientes publicidad local, patrocinios identificados, banners, afiliación/comisiones con ITV, parking, recarga, talleres, lavaderos, campings, alojamientos y consignas. También estadísticas de conversiones, ingresos/gastos y rentabilidad con datos reales. No se han creado enlaces comerciales ficticios, rastreadores, ingresos simulados ni botones de reserva sin integración. La activación requiere cuentas/acuerdos, datos del titular y definir medición/privacidad. |
| **13. Tecnología, funcionamiento y calidad — parcial** | Interfaz móvil, categorías/listado accesibles, mapa agrupado, paginación por zonas y subdivisión de zonas densas; geometría territorial IGN, validadores, límites de tamaño, integridad SHA-256 y deduplicación por ID. Actualización diaria del directorio y reintentos acotados en el reloj existente. Estados de frescura y fuentes originales. API de direcciones sin dirección en URL, GPS en el navegador, preferencias acotadas y privacidad actualizada. Pruebas unitarias y de navegador, incluyendo concurrencia, caducidad, móvil y contraste. | Falta completar páginas SEO propias de cada servicio por municipio; `/cerca` es una herramienta `noindex` y `/servicios/` es el directorio general. El enlace OSM permite consultar/comunicar errores en la fuente, pero no hay un nuevo gestor universal de reportes. Deduplicar IDs no resuelve dos objetos OSM que representan el mismo establecimiento. No hay panel monetario de costes/rentabilidad ni garantía de cuota gratis ilimitada. Deben verificarse la publicación y el primer ciclo automático real de los componentes nuevos. Los datos legales de contacto del titular siguen requiriendo información real. |

## Automatización y tratamiento de datos antiguos

| Datos/función | Cómo se actualiza | Qué ocurre si falta actualidad |
| --- | --- | --- |
| Servicios OSM | Reloj existente solicita `fetch-servicios.yml` cada día, a partir de **08:17 UTC**. Descarga nacional Geofabrik más Canarias y filtro territorial IGN; publicación mediante PR validado. Si el extracto fechado no cambió, se comprueba la copia y sólo cambia la fecha de consulta. | Se conserva la copia válida si falla. No se publica una muestra truncada. Rechaza fechas futuras/antiguas, exceso de tamaño y caídas de cobertura superiores al 30% nacional o regional. Directorio sin comprobar durante más de 30 h o extracto de más de 72 h se marca antiguo; sus horarios no se presentan como apertura confirmada. |
| Precios y recarga existentes | Precios a las **07:00 y 19:00 UTC**; recarga a las **05:15 UTC**, mediante el mismo coordinador. | Conservan sus estados y fechas de fuente. Recarga es un registro de ubicaciones/características, no una medición de cargadores libres. |
| Farmacias, ITV, política | Guardias **05:45 UTC**, ITV **04:17 UTC**, política **04:20 UTC**. El mapa ITV lee el catálogo existente, sin otro robot paralelo. | Cada fuente conserva su fecha. No se renueva una fecha de coordenada/cita porque se haya regenerado el catálogo general. Las guardias dependen del turno vigente y de la validez de la fuente. |
| Capa de guardias | Reutiliza las copias y lectores oficiales existentes; sólo lee las provincias relevantes de la zona, máximo cinco archivos, con caché de 30 s. | La fecha consultada no convierte en actual un turno de otro día. Se reevalúan los estados al próximo límite de minuto o de frescura de la fuente, se retiran al vencer y al volver a la pestaña antes de esperar la red. Turnos localizados, ambiguos o fuentes antiguas no entran en guardia ahora. |
| Tiempo y deportes existentes | Tiempo cada **3 h**; deportes cada **1 h**. | Conservan los avisos y copias válidas previstos por sus lectores; no se afirma que una fuente inaccesible esté renovada. |
| Bizi Zaragoza | Consulta pública por servidor al usar la capa, sin ubicación del visitante; refresco visible cada minuto. Caché de estado 30 s y de directorio 24 h. | Caducidad por estación, limitada por parte y última comunicación, máximo 5 min. Cifras caducadas o no comprobables desaparecen de lista y popup; un fallo de refresco no mantiene stock anterior como actual. El plazo usa la evaluación actual del servidor y el tiempo transcurrido desde antes de la petición; un reloj del visitante atrasado o una respuesta lenta no prolongan las cifras. |
| Tráfico SCT | Consulta pública por servidor; refresco de la vista/capa cada minuto, caché 60 s. | El parte caduca a los 10 min de su publicación comprobable. Se ocultan incidencias caducadas; una ausencia no se interpreta como carretera libre. Si RSS y GML no corresponden temporalmente, no se inventa su unión geográfica. La caducidad usa también un contador monotónico y descuenta la espera de red, incluso en el HTML inicial. La evaluación nueva de una respuesta no cambia la fecha de publicación o consulta almacenada. |
| Cámaras SCT/Terrassa | API del directorio oficial bajo demanda, caché 1 h, con fecha original del directorio. | Directorio de más de 30 h se marca sin actualizar. La fecha del catálogo nunca se convierte en hora de la imagen. Los enlaces llevan a la fuente; no se descargan ni incrustan imágenes automáticamente. |
| CartoCiudad | Consulta sólo cuando el visitante envía el formulario y elige resultado. | Error explicativo y alternativa por municipio. No selecciona automáticamente la primera coincidencia ni guarda el texto o coordenadas en preferencias/historial. |
| Telegram | Ventana diaria **08:00–11:59 Europe/Madrid**, ajustada a verano/invierno. El reloj separa comprobaciones sin envío de ejecuciones reales, conserva deduplicación y reintentos dentro de ventana. | No fuerza envíos fuera de ventana. Datos de precio inválidos/antiguos y errores de envío no producen éxito falso. El modo `dry_run` no envía ni escribe en D1. |
| Favoritos y recordatorio ITV | Se guardan al decidirlo el visitante; sincronización y reintentos de cuenta existentes. La fecha ITV es aportada por el visitante. | Un favorito no es una caché de horarios o stock. El calendario externo funciona después de importarlo; no existe un servicio web que notifique esa fecha por Telegram. |

Estos mecanismos eliminan la necesidad de editar datos a diario, pero no pueden
garantizar que una fuente externa nunca falle. El alta comercial, la elección de
una fecha de ITV o la importación de un calendario son decisiones iniciales del
titular/visitante; no se sustituyen por datos inventados.

## Auditoría de cuenta y favoritos ante fuentes caducadas

1. **Contenido guardado mínimo.** Cada favorito de servicios conserva sólo
   `{id,nombre,categoria,lat,lon}` del lugar público. No conserva hora de apertura,
   bicicletas, anclajes, precios, plazas, URLs arbitrarias ni GPS personal.
2. **Lista guardada diferenciada.** Inicio/Mi día enlazan al lugar. El listado
   «Favoritos» dice que debe abrirse la ficha para comprobar información actual;
   sus filtros de apertura/gratis/accesibilidad están desactivados. Nombre y
   coordenadas guardados pueden ser antiguos y no se presentan como verificados
   de nuevo sólo por iniciar sesión.
3. **Comprobación al abrir.** OSM e ITV consultan su identidad y zona; Bizi consulta
   la red actual. Las respuestas tardías de una navegación anterior no deben
   reemplazar la elección posterior. Las cifras Bizi caducan también dentro de
   una ficha abierta y al volver a una pestaña suspendida.
4. **Cambio de partición y traslado real.** Un cambio en la subdivisión de zonas
   OSM devuelve 409 con zonas alternativas; el cliente renueva catálogo y pide
   reabrir el favorito. Si el establecimiento se trasladó a otra cuadrícula o
   desapareció de la fuente, puede devolver 404. Se conserva el favorito y se
   muestra el aviso, sin afirmar que su información siga vigente ni borrarlo
   automáticamente. No hay todavía búsqueda global de un ID movido entre zonas.
5. **Separación de proveedores.** OSM, ITV y Bizi tienen identificadores y
   categorías compatibles obligatorias. SCT/cámaras, guardias y Metro Bilbao se
   pueden recordar como filtros, pero no se aceptan como favoritos usando IDs
   de otro proveedor. No se guarda una incidencia o guardia temporal como
   establecimiento fijo; Metro Bilbao requiere una consulta individual antes
   de habilitar favoritos de estaciones.
6. **Privacidad y borrado.** El historial está desactivado por defecto, es local
   por cuenta, sólo guarda municipio/categorías y conserva como máximo 20
   consultas de 30 días. Desactivarlo borra las entradas. Exportar/vaciar se
   aplica a los ajustes de la cuenta actual, no a otras sesiones, Google,
   suscripciones Telegram ni calendarios ya importados.

## Evidencia técnica y validación

Los nombres y límites de categorías están en
[`servicios-catalogo.mjs`](../scripts/lib/servicios-catalogo.mjs). El robot y la
partición están en [`fetch-servicios.mjs`](../scripts/fetch-servicios.mjs) y
[`servicios.mjs`](../scripts/lib/servicios.mjs). La planificación está en
[`data-recovery.mjs`](../scripts/lib/data-recovery.mjs). Las API separadas de
OSM, ITV, Bizi, SCT, cámaras y guardias conservan sus propios contratos y caducidades.

[`servicios-cuenta.md`](servicios-cuenta.md) detalla almacenamiento, calendario,
exportación/vaciado y Telegram. Las pruebas dirigidas de cuenta/autenticación
tras admitir preferencias SCT, guardias y Metro Bilbao aprobaron **118 casos** y TypeScript. Las
seis pruebas de [`servicios-oficiales.spec.ts`](../tests/e2e/servicios-oficiales.spec.ts)
aprobaron ITV/cita/favorito, Bizi con ceros, caducidad individual, caída de fuente,
pestaña suspendida y CartoCiudad. La repetición final de CartoCiudad incluye axe
para el contraste del botón bajo el ratón, también aprobada. Se revisaron
capturas de fichas ITV/Bizi, favoritos a 320 px y dirección elegida.

Las ocho pruebas de
[`servicios-guardias.spec.ts`](../tests/e2e/servicios-guardias.spec.ts) aprobaron
los cambios de minuto, red pendiente o caída, reloj atrasado, retorno de pestaña,
turnos localizados, avisos de Almería, ausencia de favoritos de turnos y
regresión de las otras capas. En Madrid y Almería se comprobaron además datos
reales a 1280 y 320 px, sin desbordamiento ni errores JavaScript y sin
incumplimientos de axe en el área revisada.

Las siete pruebas de
[`servicios-trafico.spec.ts`](../tests/e2e/servicios-trafico.spec.ts) aprobaron la
integración de incidencias y cámaras en el mapa, incluidos móvil a 390 px y
escritorio a 1280 px con axe. Comprueban que no se dan favoritos/direcciones a
un accidente, que los filtros de establecimientos no ocultan estas capas, que
caducidad/fallo de red retiran incidencias y pines, y que una respuesta tardía
no restaura la capa descartada. Las cámaras no cargan imágenes automáticamente,
abren su URL oficial en otra pestaña y distinguen fecha de directorio de hora de
imagen desconocida, también con catálogo caducado. Se revisaron las capturas.

Esos casos usan API y cuentas simuladas y no prueban una reserva real, OAuth
Google nuevo o un mensaje Telegram enviado. Las consultas reales resumidas al
principio son evidencia distinta. Las pruebas generales, el despliegue y el
ciclo automático real de esta ampliación deben consignarse al terminar la
integración; no se suman aquí pruebas repetidas para inflar un total.

La revisión específica de caducidad aprobó **106 pruebas unitarias dirigidas**
(`servicios-ui`, `bicis-gbfs`, `trafico-sct`) y **10 pruebas de navegador** de la
página de tráfico. Incluyen consulta cacheada sin rejuvenecer datos, fecha de
parte futura, reloj atrasado, cambio de reloj y espera de red antes de ejecutar
JavaScript. El registro de alcance, escenarios y límites está en
[`servicios-validacion.md`](servicios-validacion.md); no se suman estos casos a
repeticiones anteriores como si fueran pruebas diferentes.
