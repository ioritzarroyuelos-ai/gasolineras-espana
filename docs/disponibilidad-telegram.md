# Avisos de disponibilidad por Telegram

Implementación M, pendiente de publicar y verificar en producción. Añade un permiso separado para los aparcamientos municipales de Madrid/Vigo y Bizi Zaragoza. No modifica las preferencias de precios ni ITV. No se han enviado mensajes ni creado suscripciones reales para probarla.

## Modalidades

- Un resumen diario por chat, a la hora peninsular elegida. Incluye cero sólo cuando la fuente lo confirma. Si la fuente no ofrece un dato vigente se reintenta durante un máximo de 30 minutos, siempre dentro de ese día; después se indica el fallo en la web y se programa el día siguiente.
- Un aviso temporal por chat: una primera comprobación tras aceptar el permiso y luego aproximadamente cada cinco minutos, hasta doce comprobaciones durante una hora. Sólo avisa con cantidad mayor que cero. Termina al avisar, cancelar o vencer. No prolonga el plazo por errores ni recupera intervalos perdidos en ráfaga.

La persona elige el lugar y, en Bizi, bicicletas para alquilar o anclajes para devolver. Las plazas de aparcamiento son totales; nunca se anuncian plazas PMR libres. La cifra puede cambiar durante el trayecto y no constituye una reserva. Los cambios entre comprobaciones pueden no detectarse.

El horario diario usa Europe/Madrid: una hora inexistente al pasar a horario de verano se traslada al primer minuto válido posterior. La repetición de una hora en otoño no repite el resumen. Un recibo por fecha local evita otra entrega diaria aunque se cambie la hora o se reactive el aviso ese mismo día.

## Datos, permisos y baja

El Bearer firmado de Telegram identifica el chat, sin exigir Google. El servidor no admite chatId, cifras, URLs o GPS proporcionados por el navegador. Vincular el bot o guardar un favorito no activa estos avisos. La activación necesita la versión del estado que se muestra y un permiso explícito; la revisión evita que una respuesta tardía restaure una alta cancelada.

Se guardan chat, lugar público, objetivo, modalidad, hora/vencimiento, consentimiento, identificador y estado de entrega. Las cifras de disponibilidad no se conservan como histórico. Máximo un aviso de cada modalidad y doce cambios de configuración al día por chat; cancelar no queda bloqueado por ese límite.

Cada chat tiene un Durable Object con almacenamiento SQLite. Consentimiento, revisión y recibos se coordinan con transacciones síncronas. Una cancelación se comprueba después de descargar la fuente y antes de reservar el envío. No puede retirar un mensaje ya iniciado. La baja de disponibilidad conserva precios/ITV; `/stop` intenta cancelar las tres clases y no confirma un éxito si alguna baja falla.

Los datos de avisos terminados/cancelados y los recibos mínimos se eliminan como máximo a los 30 días; el diario activo se mantiene hasta su cancelación. Un GET no cambia preferencias, pero el primer acceso al objeto puede inicializar su esquema y un estado de revisión. El dry-run no modifica avisos/recibos ni envía mensajes; invocar por primera vez un DO puede crear su esquema, por lo que no se describe como ausencia absoluta de escrituras de infraestructura.

## Entrega y fuente

Sólo se consultan tres rutas propias fijas, sin posición del visitante. Se validan cuerpo acotado, identidad, fuente, fechas individuales y flags de operación. La caducidad es cinco minutos en Madrid/Bizi y seis en Vigo, igual que en el mapa. Un dato ausente, inválido, antiguo o de otra estación no se convierte en cero. La ausencia de un ID de una respuesta actual no se interpreta como cierre permanente del lugar.

Antes de Telegram queda una intención duradera. Una respuesta válida identifica el mensaje y el chat esperado. Un rechazo explícito permite reintentar dentro del plazo y respetando Retry-After. Un timeout, redirección, respuesta incoherente o caída después de reservar deja resultado incierto: no se repite a ciegas. Esto favorece evitar duplicados, pero no garantiza entrega exactamente una vez.

## Servicio y publicación

El Worker separado exporta un servicio privado por RPC. Su método `estado()` comprueba configuración, bandera y revisión/versión del Worker sin invocar un DO. Su HTTP público responde 404. Pages utiliza un Service Binding, y la UI sólo ofrece activar cuando el servicio responde saludable y ambas banderas están habilitadas. Las rutas GET/DELETE y el botón global «Gestionar mis avisos de disponibilidad» permiten consultar/cancelar mientras está pausada la activación, incluso si la ficha elegida desaparece del mapa. Las trazas fetch están desactivadas porque registran la ruta y Telegram incluye allí el secreto del bot; no se registran cuerpos, chats ni errores crudos.

No hay nuevo Cron ni cambios al reloj de datos de quince minutos. Las alarmas nativas despiertan sólo los objetos con trabajo; la alarma siguiente se guarda antes de descargar. Son ejecuciones al menos una vez y, por ello, necesitan reservas persistentes aunque el runtime serialice las alarmas.

La configuración versionada arranca con envíos desactivados. La publicación debe pasar por CI y desplegar primero el Worker y después el binding de producción. Preview no debe reutilizar el binding ni el secreto de producción: se comprueba con runtime local o un entorno aislado controlado. No se crea un namespace permanente por PR. La verificación de despliegue utiliza sólo `estado()` y los metadatos de versión; no se crea un chat ni una suscripción ficticia.

La bandera operativa de GitHub permite publicar el Worker apagado conservando salud y cancelación. La configuración de Pages de producción, por sí sola, no activa avisos: también se exige que el Worker esté habilitado. El helper de CI prepara preview sin Service Binding, con activación deshabilitada y sin token ni secreto de webhook de Telegram.

Antes de cualquier creación, secreto o despliegue de Cloudflare con activación habilitada, CI consulta el método oficial [getMe de Telegram](https://core.telegram.org/bots/api#getme) y compara su username, sin distinguir mayúsculas, con la configuración pública del bot de la web. Exige también un ID entero positivo seguro y `is_bot: true`; no presupone que el secreto de notificaciones de GitHub sea el de la web. Son dos GET acotados, sin seguir redirecciones, sin chats ni mensajes y con errores genéricos que no incluyen la clave ni su URL. Un fallo detiene el despliegue antes de tocar recursos. Publicar una pausa no requiere consultar ni entregar la clave del bot.

## Presupuesto gratuito y comprobaciones

El 21 de noviembre de 2026 se comprobó en la cuenta que el plan activo es Gratuito y no había namespaces DO. Cloudflare incluye DO SQLite: 100.000 solicitudes/día, 13.000 GB-s/día, cinco millones de filas leídas/día, cien mil escritas/día y cinco GB de almacenamiento. Son límites compartidos; agotarlos hace fallar operaciones en Free. No se activa una ampliación de pago.

Ejemplo de dimensionamiento: cien altas temporales que agotan su hora generan como máximo 1.200 comprobaciones, además de altas, cancelaciones y recibos. No es una medición de tráfico real. Los temporales vencidos no siguen consultando fuentes; un diario sólo despierta para su hora y sus reintentos acotados. No se utiliza Workers KV como cerrojo ni se gastan sus escrituras/listados en cada comprobación.

Verificación local del corte M: 99 pruebas dirigidas, incluidas 21 con SQLite/Service Binding reales en workerd, 46 del lector de fuentes y las bajas con D1/KV/DO fallidos. Pasan también las regresiones de precios e ITV. Nueve pruebas de navegador comprueban ambos modos, permiso desmarcado, vínculo sin Google, error de fuente, pausa con cancelación, cambio de chat durante un cuerpo pendiente y confirmación que llega tras cerrar. Se revisaron capturas a390/1280px y axe no encontró incidencias en el diálogo. Tipos y build pasan.

Las pruebas cubren fuentes/fechas/flags y cuerpos parciales, autenticación, cambios DST, concurrencia real de SQL/RPC, cancelación con descarga pendiente, vencimiento durante red, caída tras intención, reinicio persistente, Retry-After, aislamiento y limpieza individual a30d incluso con un diario activo o pausado. Todos los envíos de prueba están interceptados localmente. Quedan por completar la suite conjunta del paquete publicado y la verificación del despliegue antes de marcar M como disponible.

La revisión conjunta posterior pasó 2.844 pruebas en 178 archivos, TypeScript, build y 35 recorridos de navegador de disponibilidad, cuenta, precios e ITV. El análisis de secretos quedó limpio. La comprobación de retención encontró y corrigió un caso real: el primer GET después de 30 días debe devolver la nueva revisión vigente, de modo que la siguiente activación no falle con 409; una regresión con SQLite verifica también la alarma posterior.

El 21 de noviembre de 2026 a las 11:47:21 UTC se probó el lector contra las respuestas reales de la preview: Madrid, Vigo y Bizi para bicicletas y anclajes. No se crearon suscripciones ni se enviaron mensajes. Se observó un desfase de 83–99 ms entre el reloj de la API y el equipo de comprobación. Se admite como máximo un segundo sólo en la fecha de evaluación propia; la caducidad se compara con el mayor de ambos relojes. Las fechas de la fuente siguen sin admitir datos futuros y los plazos de cinco/seis minutos permanecen iguales. Las regresiones cubren el desfase pequeño, el exceso de un segundo y una cifra que vence entre ambos relojes.

Referencias oficiales verificadas: [precios de Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/), [alarmas](https://developers.cloudflare.com/durable-objects/api/alarms/), [consistencia de KV](https://developers.cloudflare.com/kv/concepts/how-kv-works/) y [bindings de Pages](https://developers.cloudflare.com/pages/functions/bindings/).
