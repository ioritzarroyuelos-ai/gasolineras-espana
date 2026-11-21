# Recuperación de fuentes de farmacias — 21 de noviembre de 2026

Las pruebas descargaron las fuentes públicas reales y ejecutaron los productores con `GUARDIAS_OUT_DIR=.tmp/robot`. No se han editado ni incorporado copias de `public/data`. Los respaldos incompletos conservan incidencias y terminan con código 1: publicar la parte verificable no convierte una provincia incompleta en una actualización correcta.

## Evidencia por fuente

| Fuente | Respuesta comprobada | Resultado del productor | Límite que conserva la web |
| --- | --- | --- | --- |
| Almería | El buscador principal devolvió HTTP 200 con `success:false` y «No autorizado para la API». El [localizador oficial](https://guardias.cofalmeria.com/) vinculaba 62 fichas a «Datos consultados el sábado 21 de noviembre de 2026, 10:41». | 62 fichas; consulta de origen `2026-11-21T09:41:00Z`, descarga `09:41:25Z`; salida 1. | Todos los horarios y la modalidad quedan por confirmar. Ninguna ficha entra en «abierta ahora» o «24 h». No se deduce presencialidad de «Abierta» ni un turno de 24 horas de «21:00 a 21:00». Cobertura parcial, no calendario completo. |
| Córdoba | El buscador diario respondió a las 81 consultas municipales con la fecha solicitada, pero sin turnos. El [portal de guardias de 2026](https://www.cofco.org/guardias-2026/) enlaza el [PDF de noviembre](https://www.cofco.org/wp-content/uploads/2026/08/Noviembre-2026.pdf), 78.918 bytes y 4 páginas. | Capital: 39 intervalos fechados, 35 diurnos del sábado + 2 nocturnos del sábado + 2 de la madrugada procedentes del viernes. Descarga `09:42:11Z`; salida 1. | Sólo Córdoba capital. Las otras 80 consultas municipales siguen pendientes, con avisos; no se mezclan sus turnos del 12 de noviembre. No se inventan teléfonos ni coordenadas. |
| Girona | El [formulario del colegio](https://www.cofgi.org/farmacies/farmacies-de-guardia) permite POST con `city-group=0`, `city=0` y fecha explícita. La página por defecto puede seguir en el día anterior durante la madrugada. | Respuesta del 21: 48 filas; respuesta del 20: 64 filas. Se conservan 19 intervalos de la víspera que alcanzan el día 21: total 67. Descarga `09:29:05Z`; salida 0. | Se comprueba la fecha del título y la marca explícita de día siguiente. Las guardias localizadas siguen fuera de «abierta ahora». Los intervalos vencidos desaparecen del listado. |
| Tarragona | En Albarca, el [buscador del colegio](https://coft.cat/font/guardies.php) decía «No s'han trobat Servei d'Urgències» y después mostraba el directorio ordinario del área, con las mismas clases de tabla. No había cartel de guardia para esa consulta. | Se descarta ese directorio ordinario sin detener las demás consultas. 32 fichas verificadas en la provincia, descarga `09:30:04Z`; salida 0. | El cartel, cuando existe, debe corresponder exactamente al día y población. La ausencia explícita deja un aviso municipal; no equivale a afirmar que no haya atención en otra localidad. |
| Valencia | El productor existente volvió a completar 27 consultas de la fuente MICOF: 1.185 filas brutas, 0 consultas fallidas. El HTTP 500 anterior no se reprodujo. | 701 fichas, descarga `09:39:57Z`; salida 0, sin cambiar su código. | Sólo 22 fichas proceden del calendario de guardias; las otras 679 son horarios de apertura, que el lector existente presenta por separado. No se anuncian las 701 como guardias. |

Las horas de descarga de esta tabla son UTC. La fecha que identifica cada turno permanece separada de la hora de consulta.

## Reglas del respaldo mensual de Córdoba

- El enlace debe proceder del portal oficial y nombrar el mes y año exactos. No se admite el documento genérico de 2024 que el mismo portal también enlaza.
- El PDF real contiene días laborables, sábados, domingos y la excepción del 2 de noviembre. La excepción prevalece sobre el día de la semana: 30 intervalos ese festivo, frente a 45 en un viernes, 37 en sábado y 19 en domingo.
- Cada página exige el título de Córdoba capital, la identificación del colegio, encabezados reconocibles y correspondencia entre dirección y zona. Una estructura desconocida impide publicar el respaldo. Si el bloque de turnos añade una condición de atención no interpretada (por ejemplo, «guardia localizada, previo aviso»), se rechaza la plantilla en vez de perder la condición al convertirla en intervalos.
- La guardia diurna publicada es 09:30–22:00 y la nocturna 22:00–09:30 del día siguiente. El final es exclusivo: a las 09:30 termina la noche anterior y empieza el turno diurno.
- Al cambiar de mes o año se necesitan los dos calendarios: el actual y el de la noche anterior. Si falta alguno, no se prolonga el PDF del mes anterior ni se fabrica la madrugada.
- Otro agente contrastó independientemente el PDF, sus cuatro páginas y los recuentos anteriores; no encontró duplicados ni un error en los límites de los intervalos.

## Automatización y avisos

El workflow existente intenta los colegios de forma independiente, publica las copias generadas y termina en error si un productor falla. La recuperación automática ya programada vuelve a intentarlo. Almería y Córdoba siguen produciendo ese resultado de error mientras dependan de un respaldo parcial.

El monitor comprueba ahora tanto la antigüedad como las incidencias. Una copia reciente con cobertura parcial ya no produce el mensaje «actualizados, sin aviso». El estado público ya leía las incidencias del archivo y continúa mostrándolas. Las pruebas del monitor no ejecutan envíos de Telegram ni leen credenciales.

Almería sólo acepta el localizador cuando su sello explícito corresponde al día solicitado, no está en el futuro y tiene como máximo 15 minutos al descargarlo. Se guarda `consultadoFuente` separado de `ts`. La web enlaza exactamente ese localizador cuando es la fuente utilizada.

## Verificación

- Revisión local completa: 1.982 pruebas de 137 archivos correctas en la base inicial, comprobación de tipos y build. Las nuevas condiciones del PDF se volvieron a verificar con sus 9 pruebas específicas. La publicación exige además el pre-push y los controles de CI sobre la rama actualizada.
- Fixtures derivados de respuestas reales, sin scripts ni cookies y con nombres, direcciones o teléfonos de prueba donde corresponde. Se conservan la estructura, fechas, modalidad y posiciones del PDF. Los casos de cambio de año son sintéticos y están señalados como tales.
- Pruebas del lector: intervalos de madrugada, final exacto, festivo, cambio de mes/año, respuesta antigua/futura, calendario equivocado, duplicación de páginas, horario ambiguo y guardia localizada.
- E2E de respaldos en 320 y 1280 píxeles: horario por confirmar, filtros «ahora» y «24 h», enlaces y ausencia de desbordamiento. Regresión del buscador, teclado, filtros, GPS sólo local, Durango y accesibilidad.
- Preview aislado en `127.0.0.1:8800`, con las cinco copias generadas trasladadas a `dist/data` tras construir. Se comprobó que los JSON servidos son idénticos a la salida del productor.
- Páginas reales a 390 píxeles: Almería capital (16 fichas por confirmar), Córdoba capital (37 turnos visibles tras vencer la madrugada), Girona (3), Reus (2), Valencia (465 fichas con su modalidad), Baena y La Morera de Montsant (0 fichas y aviso). Todas devolvieron HTTP 200 y no desbordaron.
- La comprobación detectó que «Morera de Montsant, La» no encontraba el aviso escrito como «La Morera de Montsant». Se reutilizan las equivalencias municipales ya usadas por el buscador y se comprueba que el aviso no aparece en Reus.

Las capturas y las salidas reales están en `.tmp/evidencia`, fuera de Git. Los resultados anteriores prueban la lectura de las fuentes en esta fecha; no prometen que los colegios mantengan siempre sus sistemas disponibles. Si vuelven a fallar o cambian de formato, se conserva la última copia y se mantiene el aviso, sin dar actualidad a turnos viejos.
