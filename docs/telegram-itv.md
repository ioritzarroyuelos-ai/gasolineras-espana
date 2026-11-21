# Recordatorio de ITV por Telegram (paquete C)

Implementación independiente del resumen de gasolina. La fecha la elige el
visitante; no calcula el plazo legal, no pide matrícula y no reserva una cita.
No necesita una cuenta Google. El permiso es específico para ITV y no activa
ninguna gasolinera ni modifica sus preferencias.

## Alta y cancelación

1. El visitante guarda su fecha en ITV. El calendario `.ics` sigue siendo una
   opción independiente y requiere importación en su calendario.
2. Vincula Telegram mediante el flujo existente `start-link` con `favs:[]`, abre
   el enlace y pulsa Iniciar en el bot. La web canjea el token corto de enlace
   por el Bearer firmado existente. Vincular no activa ningún recordatorio.
3. Marca «Quiero recibir en mi chat los avisos…» y pulsa Activar. Se envía sólo
   `{fecha, consentimiento:'itv-telegram-v1'}`. No viajan nombre ni matrícula.
4. Puede cancelar sólo ITV desde la página, con confirmación, o todos los
   avisos del bot con `/stop`. Cambiar los ajustes de Google o el calendario
   local no cancela este consentimiento separado. La interfaz muestra la
   fecha de Telegram cuando difiere de la fecha local.

Una fecha por chat; admite fechas futuras dentro de los siguientes diez años.
Las fechas pasadas no se recuperan ni se renuevan al año siguiente. Sólo se
preparan avisos en los días de calendario correspondientes a 7 y 1 días antes.

## Contrato y almacenamiento

- `GET /api/telegram/itv-recordatorio/config`: disponibilidad de la función y
  del enlace; no expone secretos.
- `GET /api/telegram/itv-recordatorio`: fecha y estado de los avisos propios.
- `PUT /api/telegram/itv-recordatorio`: fecha y versión del consentimiento.
- `DELETE /api/telegram/itv-recordatorio`: retira la fecha y los índices.

GET/PUT/DELETE requieren el Bearer firmado del chat. El servidor extrae la
identidad de ese token; no acepta `chat_id`, matrículas, nombres ni URLs en el
cuerpo. Las respuestas son `no-store`. Se conserva la comprobación global de
origen de la aplicación y no se usa la sesión Google como autorización.

`USER_DATA` contiene las claves `tg-itv:v1:usuario:<hash>` y los índices
`tg-itv:v1:dia:<fecha>:<hash>:<version>:<dias>`. Es un hash SHA256 con namespace,
estable aunque se rote la clave de sesión, para poder cancelar datos antiguos.
Es un identificador seudónimo interno, no una credencial ni una anonimización.
El identificador del chat sólo
está en el registro autorizado; los índices no bastan para enviar. Cada envío
vuelve a comprobar que existe el permiso y que su versión coincide. Se escriben
los índices antes del permiso: un guardado parcial no activa avisos nuevos.
Un PUT repetido para la misma fecha conserva el identificador del evento.

La fecha y sus índices tienen caducidad máxima de 30 días después de la fecha
indicada. Intención y recibo son claves diferentes, con TTL de 30 días, para evitar
dos escrituras inmediatas sobre la misma clave. No contienen chat ni nombre en
su valor. Se conservan temporalmente tras cancelar para que una réplica antigua
de la cola no considere pendiente una entrega ya hecha. No se ha añadido D1,
una tabla nueva, secretos nuevos ni servicios de pago.
El plan gratuito de KV comparte un máximo de 1000 escrituras diarias: una alta
usa hasta 3 y una entrega 2, además de las escrituras de favoritos y otras
funciones. El tope de lotes no equivale a esa cuota disponible. Si KV rechaza
una operación, se comunica el fallo; no se activa automáticamente un plan de
pago. Véanse los [límites KV](https://developers.cloudflare.com/kv/platform/limits/).

## Ejecución y fallos

`POST /api/cron/telegram-itv` exige `CRON_TOKEN`. Acepta `cursor` y
`dry_run=1`; no existe un modo de forzar envíos. La ventana es 08:00–11:59
Europe/Madrid, calculada con zona horaria y cambios de verano/invierno.
El reloj repite la revisión cada hora dentro de esa ventana, incluyendo altas
posteriores a la primera pasada. Si ya han pasado ambas franjas, el alta devuelve
`no_future_windows` sin guardar el permiso y ofrece usar el calendario. La
respuesta muestra las franjas todavía disponibles. Un alta al final de la
última franja podría no llegar a la siguiente revisión; no se inventa un aviso
el día de la caducidad para sustituir el aviso perdido.

Cada llamada procesa hasta cinco índices del día y devuelve
`{ok,dryRun,inWindow,processed,eligible,sent,skipped,errors,uncertain,nextCursor}`.
Fuera de ventana devuelve `skipped:'not_reminder_window'`. Un lote con fallos
devuelve503 y conserva el siguiente cursor para seguir con otros destinatarios.
El script debe agotar los cursores, acumular los errores y fallar al final si
queda alguno; el tope de volumen también debe señalar trabajo pendiente.
Los índices enviados se eliminan tras guardar el recibo: una corrida nueva
desde el principio puede alcanzar los usuarios restantes tras un tope anterior.

La gasolina y otras fuentes de datos no intervienen en esta ejecución. Un
rechazo explícito de Telegram permite reintentar respetando su espera. Bloquear
el bot elimina el permiso ITV. Un timeout, una respuesta no reconocible o un
fallo al guardar el recibo después de enviar deja la entrega como incierta; no
se repite a ciegas. La página lo muestra y el cron no declara éxito.

La automatización serializa las ejecuciones, pero KV es un almacén con
consistencia eventual y no proporciona un bloqueo atómico. Por ello no se
promete entrega exactamente una vez ni cancelación instantánea de un envío
concurrente. Tampoco se promete una entrega durante una caída completa de la
ventana horaria. Véanse [consistencia KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/),
[paginación KV](https://developers.cloudflare.com/kv/api/list-keys/) y
[Telegram sendMessage](https://core.telegram.org/bots/api#sendmessage).

`dry_run=1` funciona fuera de ventana para comprobar elegibilidad sin enviar,
crear intenciones, modificar recibos ni borrar nada. Los recuentos del día no
demuestran ausencia de suscriptores para fechas futuras: para esa comprobación
se debe contar, en lectura, el prefijo `tg-itv:v1:usuario:`. No se registran
chats, fechas personales, cursores ni secretos en los logs del nuevo cron.

## Evidencia de pruebas

`tests/telegram-itv.test.ts` usa memoria con límite de una escritura por segundo
por clave y un sustituto de Telegram; cubre permisos, aislamiento entre chats,
fechas/DST, baja, fallos de KV, avisos 7 y 1 días antes, paginación, progreso entre corridas,
rechazos 429, respuestas inciertas y ausencia de efectos en dry-run.

`tests/e2e/itv-telegram.spec.ts` intercepta toda API y la página de Telegram:
verifica vinculación, permiso separado, edición, cancelación, errores y
disponibilidad del calendario con el servicio desconectado; incluye axe y
capturas a 390 y 1280 px. Estas simulaciones no acreditan un mensaje real ni una
entrega en producción. No se crean suscripciones de prueba a chats reales.

Comprobación local del paquete C: 36 pruebas de backend aprobadas y 7 E2E
aprobadas. Las dos vistas con fechas concretas de aviso se repitieron con
resultado correcto, sin errores de axe; se revisaron ambas capturas. El test
de rotación de claves confirma que `/stop` sigue encontrando los datos antiguos.
