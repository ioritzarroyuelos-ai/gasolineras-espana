# Avisos de precios elegidos por el visitante

Paquete E. Implementación y pruebas locales; su presencia en este documento no
acredita un despliegue ni una entrega real. No se enviaron mensajes reales para
validarlo. El productor de comparación debe publicarse y completar su primera
actualización antes de activar este backend.

## Qué cambia

Los suscriptores existentes conservan el resumen diario. El visitante puede
elegir explícitamente «Sólo cuando baje el precio», con un mínimo de 1, 2, 5 o
10 céntimos por litro. Guardar esta elección no manda mensajes, no activa por sí
solo campanas y no modifica el permiso de ITV. Se usa el vínculo firmado de
Telegram; no es necesario iniciar sesión con Google. Nunca se acepta un chat
arbitrario ni un precio de referencia aportado por el navegador.

Se revisa por la mañana, entre las **08:00 y las 11:59 Europe/Madrid**, con los
cambios de hora incluidos. No es una vigilancia instantánea de cada cambio de
precio. Una elección posterior a la revisión de esa mañana se aplicará a una
revisión posterior. La bajada compara las dos capturas oficiales recientes
disponibles, no el precio que cada persona pagó en su último repostaje. El
mensaje muestra ambas fechas y la diferencia. No se envían supuestas bajadas
cuando falta la referencia o alguno de los dos precios.

## Datos y continuidad

El productor existente de precios crea `data/precios-comparacion/index.json` y
32 bloques inmutables bajo su `snapshotId`. Agrupa por `Number(IDEESS) % 32`.
Cada importe es un entero de milésimas de euro o `null`; cero no sustituye un
precio desconocido. La fecha literal del Ministerio y su instante UTC se
conservan. Un reintento puede actualizar la fecha de consulta del índice, pero
no convierte una captura anterior en datos nuevos ni cambia su referencia.

El lector limita el índice a 32 KiB y cada bloque a su tamaño declarado, con un
máximo de 256 KiB. Comprueba tamaño, SHA-256, identidad, filas y caducidad antes
de utilizarlos. La captura actual admite hasta 26 horas, la anterior 36 horas y
la separación entre ellas como máximo 26 horas. Se toleran hasta cinco minutos
de diferencia de reloj. Rutas arbitrarias, redirecciones, archivos mezclados,
datos corruptos o fechas antiguas producen un error, no una entrega exitosa.
No existe un fallback a los 12 MB de `stations.json` en el cron.

La preparación se divide en peticiones de **hasta dos bloques y un chat**. Se
guarda durante un máximo de 24 horas una preparación temporal ligada al
`snapshotId`, las suscripciones actuales y la preferencia. Un cambio de esos
datos reinicia su preparación; no se mezclan capturas. Cada petición de envío
procesa hasta dos mensajes. Hasta que se haya leído todo lo necesario no se
envía ninguna parte. Los textos largos se dividen, sin omitir suscripciones.

Cada petición comprueba un único chat, también si ya estaba resuelto. El cursor cifrado y
autenticado guarda la fecha de Madrid, el avance entre chats, el avance dentro
del chat y si hubo errores anteriores. El checkpoint normal conserva el avance
si el proceso se corta. El siguiente proceso puede retomarlo sin recorrer de
nuevo toda la cola. Al terminar el recorrido, un error previo sigue dando
HTTP 503 y deja pendiente una revisión posterior; no hay éxito parcial oculto.

## Entrega, cancelación y límites

Antes de cada mensaje se releen las suscripciones D1 y la preferencia KV.
Se guarda la intención antes de llamar a Telegram y el recibo después. Sólo
HTTP satisfactorio con `ok: true` cuenta como entrega confirmada. Un rechazo
explícito permite reintento respetando `retry_after`. Un timeout, una respuesta
ilegible, una redirección o la pérdida del recibo posterior dejan la entrega
incierta y no provocan un reenvío ciego.

Los recibos y planes duran tres días y guardan identificadores derivados y
huellas, sin texto del mensaje ni chat en claro en su contenido. No se deben
considerar datos anónimos. El aviso diario tiene una identidad estable; el de
bajada también incluye las dos fechas de la comparación, para no repetir la
misma bajada al día siguiente. Las partes confirmadas de un mensaje largo no se
repiten al reintentar las restantes.

Cancelar precios borra suscripciones y preferencia de precios. `/stop` cancela
precios e ITV. Bloquear el bot y recibir el rechazo definitivo provoca la baja.
Las preparaciones y marcas técnicas caducan en sus plazos y no autorizan por sí
solas un envío. Una entrega que ya empezó puede llegar. Workers KV tiene
consistencia eventual y no ofrece una transacción atómica con Telegram:
**no se promete entrega exactamente una vez ni cancelación instantánea**.
Las ejecuciones del workflow deben permanecer serializadas; no lanzar crons
paralelos con el mismo conjunto de destinatarios.

El máximo de suscripciones activas por chat es 100 combinaciones de gasolinera
y combustible. La comprobación y la inserción se hacen juntas en SQL para que
dos altas simultáneas no superen el límite. No se borran silenciosamente
suscripciones antiguas; un conjunto preexistente inválido se informa como
pendiente. Los tokens de vinculación vencidos se purgan en lotes de hasta 100
durante la ejecución normal, conservando una hora de margen. Dry-run no purga.

La consulta manual `/precios` también usa el lector acotado: como máximo diez
avisos y dos bloques por página. `/precios 2`, `/precios 3`, etc. recorren todas
las favoritas, con contador, fecha y navegación anterior/siguiente. Si una
estación o su combustible ya no tienen precio se indica expresamente. Dar de
alta avisos no descarga el catálogo nacional para decorar la confirmación;
la confirmación indica cuántos se añadieron, ya existían o quedaron pendientes.

## Automatización y comprobaciones sin envío

`cron-telegram-check.yml` conserva el nombre de ejecución
`Telegram · resumen diario`, que usa el reloj para distinguir entregas y
comprobaciones. El caller `run-telegram-digest.mjs` continúa las respuestas
válidas 200/503 con cursor, mantiene los fallos acumulados y espera 1,1 segundos
entre lotes normales. Permite `processed: 0` sólo con trabajo acotado positivo
(`work: 1` o `2`) y cursor nuevo. Un límite de lotes, una continuación vacía o
una respuesta incoherente terminan en fallo. No registra cursores, chats,
credenciales, fechas privadas ni mensajes.

`dry_run=1` comprueba las fuentes y recorre la preparación mediante el cursor
cifrado, incluso fuera de la ventana. No guarda preparaciones/checkpoints,
no actualiza D1, no borra datos y no llama a Telegram. No afirma cuántas
personas recibirían un mensaje: valida las lecturas de cada parte, sin guardar
ni reconstruir a la vez el conjunto completo. El parámetro `force` se rechaza.

No se añadieron tablas D1, proveedores ni servicios de pago. El presupuesto KV
Free se comparte con cuenta, favoritos e ITV: 1.000 escrituras diarias no
permiten crecer sin límite. Una preparación máxima de 32 bloques consume 16
escrituras de preparación, sus checkpoints y los recibos de envío; por ello hay
que revisar los contadores de uso reales antes de ampliar volumen. Alcanzar una
cuota deja un fallo visible y avance recuperable; no se presenta como entrega
hecha. No se activa una mejora de plan ni un gasto automáticamente.

El presupuesto de las pruebas suma conservadoramente lecturas, escrituras,
consultas y llamadas externas, y exige como máximo 50 operaciones mixtas por
petición. Es un presupuesto propio, no la regla de Cloudflare: Workers Free
distingue 50 subpeticiones externas y 1.000 a servicios internos. El caso de
reanudación más exigente revisado realizó 38 operaciones mixtas. La reducción a
un chat mantiene margen y limita CPU; 55 operaciones mixtas no demostrarían por
sí solas una infracción del límite de 50 llamadas externas.

Referencias operativas: [límites de KV](https://developers.cloudflare.com/kv/platform/limits/),
[consistencia de KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
[límites de Workers](https://developers.cloudflare.com/workers/platform/limits/),
[sendMessage de Telegram](https://core.telegram.org/bots/api#sendmessage).

## Evidencia local

Se comprobaron consentimiento, separación de usuarios, cambios de favoritas y
preferencia entre pasos, cancelación, falta/caducidad de referencia, integridad,
dry-run sin escrituras, continuación tras corte, rechazo con reintento,
entrega incierta, fallo antes/después del envío y presupuesto por petición.

Con los datos oficiales de 11.540 estaciones del 21/11/2026, el perfil local de
workerd (100 iteraciones, D1/KV y Telegram simulados) dio aproximadamente
**5,51 ms de JavaScript activo por preparación de dos bloques** y **3,98 ms por
petición de dos envíos ya preparados**. El diseño anterior de lectura completa
se descartó tras medir unos 60 ms. Estas cifras son una comprobación local,
no una garantía de CPU en producción ni una prueba de entrega a una persona.
La consulta manual `/precios N` se midió también con la misma fuente real:
aproximadamente 2,51 ms de JavaScript activo, tres lecturas y un mensaje simulado
por petición; los 100 avisos de prueba se recorrieron en 16 páginas.

La interfaz se prueba con APIs simuladas en 390 y 1280 píxeles, comprobación de
contraste y accesibilidad del modal, guardado explícito y recuperación de
errores. El navegador no realiza altas ni envíos reales en esas pruebas.
