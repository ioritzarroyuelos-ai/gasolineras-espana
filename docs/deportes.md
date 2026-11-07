# Deportes

La sección publica calendarios, resultados, clasificaciones y emisiones confirmadas para España. No es un marcador en directo. No requiere cuentas, servicios de pago ni nuevas bases de datos.

## Fuentes y cobertura

Los lectores están separados por deporte en `scripts/lib/deportes-*.mjs`. Descubren las temporadas, competiciones y grupos en las fuentes públicas. La cobertura real se recoge en `public/data/deportes/index.json`; las fuentes no integradas o que fallan figuran en `incidencias`. No se debe anunciar cobertura completa de todas las federaciones.

Cada ficha tiene dos bloques independientes: agenda y clasificación. Ambos guardan la fecha de la última consulta y la de la última lectura válida. Si falla uno, conserva su copia anterior sin cambiar la fecha de verificación ni mezclar temporadas. Las categorías que no publican clasificación no reciben una tabla inventada.

La primera comprobación del 7 de noviembre de 2026 incluyó fútbol profesional, grupos nacionales de RFEF y fútbol sala; baloncesto nacional e internacional, más competiciones vascas y escolares publicadas por la federación guipuzcoana; y motor. Una ficha puede representar un grupo, una fase o una edición anterior identificada, no necesariamente una liga completa. Las categorías y el número vigente se consultan en el índice publicado.

FFCV entregó un catálogo de 120 categorías y 667 grupos el 7 de noviembre de 2026. Descubrir esos nombres no verifica todavía sus partidos: cada ficha sólo aparece cuando se han leído datos válidos de ese grupo. La cobertura territorial española sigue incompleta; las federaciones que no entregan datos comprobables tienen su aviso y enlace oficial. NBA ofrece calendario y resultados, sin clasificación integrada; RFEDA ofrece próximas pruebas. F4 y Eurocup-3 incluyen calendario y clasificación, con los resultados enlazados a la fuente.

Una fecha sin hora permanece sin hora. Los fines de semana tienen `fecha` y `finFecha`; los instantes confirmados incluyen su zona horaria y se convierten para Península/Baleares o Canarias. Un partido no se considera finalizado porque haya pasado su hora. Un 0-0 sin estado final o en juego tampoco se presenta como resultado.

Los canales se vinculan únicamente cuando la fuente confirma la emisión en España. Un enlace genérico de una cadena o una emisión para otro país no basta. En los demás casos se muestra «Sin retransmisión confirmada para España».

## Actualización y publicación

`Actualizar deportes` intenta renovar todos los deportes cada cuatro horas, a las 00:23, 04:23, 08:23, 12:23, 16:23 y 20:23 UTC. En las horas intermedias intenta actualizar sólo fútbol, también en el minuto 23. GitHub puede retrasar una ejecución; además, la lectura y las comprobaciones de publicación pueden retrasar su llegada a la web. Siempre se muestra la consulta real de cada fuente. No se evaden accesos, CAPTCHA ni límites de descarga.

FFCV se recorre por grupos, con un presupuesto propio de 120 consultas por hora y una separación mínima de un segundo. No es una cuota anunciada por la federación. Un `Retry-After` detiene la pasada y su descanso se conserva entre ejecuciones. El catálogo se reutiliza y se renueva semanalmente por bloques; cada grupo aporta la jornada anterior y la más cercana a hoy, más la clasificación cuando se publica. Si falla una jornada, se conserva la última agenda completa. El resto de jornadas permanece enlazado en la fuente oficial.

El progreso público de FFCV se guarda en `public/data/deportes/fuentes/ffcv.json`: catálogo, fecha, cursor, últimas verificaciones, contador horario y próxima consulta permitida. Antes de cada petición se escribe también `.tmp/deportes-ffcv-checkpoint.json`. Actions recupera ese checkpoint y lo guarda aunque falle la lectura o publicación. Al combinarlo con los datos publicados nunca se acorta un descanso ni se reduce el contador de la misma hora. Ningún archivo incluye cookies, claves ni identificadores de sesión. Esta persistencia del descanso corresponde a FFCV; las demás fuentes limitadas detienen sus consultas durante la ejecución.

El robot ejecuta `node scripts/fetch-deportes.mjs` y crea una PR de datos mediante la aplicación existente. La protección de main, CI, Security y el despliegue habitual siguen activos. No editar los JSON a mano. Para una comprobación aislada, `DEPORTES_OUTPUT_DIR` permite guardar el resultado en una carpeta temporal; conserva los sellos reales de las fuentes.

La ejecución manual permite elegir `todos`, `futbol`, `baloncesto` o `motor`. El campo opcional `ffcv_no_antes` admite una fecha ISO con zona horaria y sólo amplía el descanso; normalmente se deja vacío. Los equivalentes locales son `DEPORTES_FUENTES` y `DEPORTES_FFCV_NO_ANTES`. `DEPORTES_PREVIOUS_DIR` selecciona la copia anterior y `DEPORTES_CHECKPOINT_FFCV` permite aislar el checkpoint de una comprobación. Antes de escribir fichas, se validan el índice completo y todas las agendas por día y zona. Si no se actualiza ninguna fuente, no se sustituye el índice; el estado de las consultas sí se conserva y el trabajo termina señalando el fallo. Si el generador falla, el robot sólo puede proponer el archivo de estado de FFCV, nunca un conjunto de fichas escrito a medias.

El índice no contiene todas las jornadas: cada competición tiene su ficha y las agendas cercanas se dividen por día y zona horaria. La web pagina las tarjetas y funciona sin JavaScript salvo los favoritos. Estos se guardan solo en el navegador y no se sincronizan con la cuenta.

Las páginas deportivas requieren conexión para no recuperar un marcador antiguo del almacenamiento sin conexión. `/status` comprueba por separado los bloques integrados y avisa si superan 24 horas sin verificación. Los apartados que no ofrecen datos desde el principio se explican en la ficha, sin confundirlos con una avería.

## Comprobaciones

Los tests de cada lector incluyen respuestas reales recortadas y casos adversos. Las pruebas comunes cubren fechas imposibles, temporadas, conservación de copias, zonas horarias, enlaces, búsqueda y fallo de agenda. Las del checkpoint comprueban la continuación tras un fallo, el presupuesto horario, las pausas y la selección de deportes, sin consumir consultas de las federaciones. Playwright verifica lectura en móvil, accesibilidad, favoritos y navegación sin JavaScript. El recorrido real adicional utiliza los datos publicados; los casos con fixtures se excluyen al probar producción.
