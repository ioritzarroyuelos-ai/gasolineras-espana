# Reloj de las actualizaciones

Los robots conservan sus fuentes, validaciones, permisos y publicación mediante PR con CI obligatorio. El calendario se decide en un único coordinador (`data-recovery.yml`), para que dos relojes no lancen dos descargas del mismo servicio.

| Servicio | Intervalo habitual desde el inicio efectivo |
| --- | --- |
| Precios | 12 horas |
| Electrolineras, farmacias, ITV y política | 24 horas |
| Tiempo | 3 horas |
| Deportes | 1 hora |

Cloudflare envía un pulso los minutos 2, 17, 32 y 47 de cada hora UTC. GitHub conserva un reloj de respaldo los minutos 7 y 37. Ambos llegan al mismo workflow con exclusión mutua. Las siete descargas mantienen su botón manual; sus antiguos crons directos desaparecen. En precios sólo permanece el vigilante que comprueba cada 12 horas el límite de 26 horas sin captura: esas ejecuciones no cuentan como descarga reciente.

Antes de pedir cada robot, el coordinador consulta la publicación y las ejecuciones de GitHub. Cualquier trabajo en cola, en curso o esperando bloquea otro automático del mismo servicio, incluso si ya no está entre los 20 más recientes. Los estados pendientes se consultan por separado y se paginan. Se limita a 10 páginas por estado; si no puede verificar el inventario, no inicia trabajos a ciegas.

La cadencia usa el inicio efectivo del robot: no suma la duración de la descarga. Un margen máximo de 60 segundos evita perder un pulso de 15 minutos por pequeñas diferencias de cola. Tras fallo o datos publicados caducados, el resto de servicios espera 4 horas estrictas; deportes mantiene su pasada horaria para rotar grupos, conservando los límites y pausas de cada fuente. Un pulso retrasado más de 2 horas se descarta. Un pulso repetido vuelve a comprobar las ejecuciones antes de actuar.

No se promete una hora exacta: puede haber retrasos del proveedor, colas de GitHub o una fuente inaccesible. Los botones manuales siguen permitiendo una consulta expresamente solicitada. Los monitores, fechas reales y avisos de datos caducados siguen siendo necesarios.

## Identidad y permisos

El Worker `espana-util-data-clock` sólo tiene un evento `scheduled`; no publica `workers.dev`, previews ni rutas. El manejador GET `/health` sirve únicamente para comprobaciones locales o una ruta que se autorice posteriormente; no dispara actualizaciones y no informa sobre secretos. La evidencia duradera está en los registros de Cloudflare y en el resumen de cada ejecución de GitHub; no se añade KV ni D1.

El Worker firma un JWT RS256 con la App privada ya existente. Comprueba el nombre y ClientID de la App y la instalación del repositorio. Solicita un token de instalación con `repository_ids:[1206200264]` y sólo `contents:write`, verifica que permite exactamente ese repositorio y lo revoca al finalizar. No solicita `actions:write` para la App.

La clave privada conserva las facultades originales de esa App: limitar el token emitido no reduce las facultades de la clave si alguien consiguiera extraerla. Este diseño añade su almacenamiento cifrado en Cloudflare, en la cuenta existente; no amplía los permisos ni los repositorios de la App.

`repository_dispatch` usa el evento fijo `data-clock-v1`. Su payload contiene únicamente versión, repositorio, ID, ClientID y tiempos. El workflow verifica el ID y nombre públicos del bot, el repositorio y los tiempos; nunca recibe nombres de workflows, ramas o código ejecutable del payload. Sólo el `GITHUB_TOKEN` del coordinador tiene `actions:write`, como ya ocurría con la recuperación anterior. Se ejecuta código de un SHA de main, con credenciales del checkout no persistentes.

Las solicitudes son seriales. Se honra `Retry-After` y el reinicio de cuota: si requieren esperar más de 30 segundos, se abandona ese intento hasta el siguiente pulso. Nunca se reduce la espera pedida. Los POST con resultado ambiguo no se repiten automáticamente; el próximo pulso consulta el estado antes de decidir. Cada llamada tiene 15 segundos de límite y hasta 3 intentos sólo cuando son seguros.

## Activación y despliegue

La integración de Deploy está desactivada mientras la variable de repositorio `DATA_CLOCK_ENABLED` no sea exactamente `true`. La revisión de código y las pruebas no crean ni activan el Worker.

Tras autorizar la activación, Deploy usa el commit exacto de main con CI verde y vuelve a comprobarlo antes de activar el horario. Instala Wrangler desde el lockfile. `deploy-data-clock.mjs` transforma la clave existente de GitHub, tanto PKCS1 como PKCS8, a PKCS8 en memoria. Instala el Worker sin cron, envía ClientID y clave por `wrangler secret bulk` mediante stdin, y activa el cron al final. No crea archivos con secretos, no los pasa en argumentos y desactiva los logs locales y telemetría de Wrangler. La salida de ese subproceso se captura y no se vuelca; el registro de despliegue contiene sólo Worker, SHA y cron.

Si una preparación falla, el despliegue queda rojo y el reloj de respaldo de GitHub permanece disponible. No se desactiva ninguna protección de rama ni se modifica el proceso de validación de los datos. El reloj añade un Worker y un Cron Trigger, sin base de datos. Antes de activarlo se revisan la capacidad libre de la cuenta y el permiso Workers Scripts ya existente.

## Comprobación posterior obligatoria

1. Verificar la versión del Worker, ausencia de rutas públicas y cron registrado.
2. Observar un evento `data-clock` en Cloudflare y su `repository_dispatch` correspondiente en GitHub.
3. Revisar que el resumen identifica servicios activos/recientes y sólo solicita los pendientes.
4. Repetir un pulso en el mismo intervalo y comprobar que no vuelve a descargar.
5. Verificar los PR de datos, sus CI, el Deploy y las fechas realmente servidas. Un HTTP 204 del pulso no demuestra por sí mismo que los datos se hayan publicado.

## Fuentes técnicas

- [GitHub: repository_dispatch y permiso contents:write](https://docs.github.com/en/rest/repos/repos#create-a-repository-dispatch-event).
- [GitHub: JWT de una App](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app).
- [GitHub: token de instalación limitado a repositorios](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
- [GitHub: eventos y rama predeterminada](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#repository_dispatch).
- [GitHub: límites y reintentos](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api).
- [Cloudflare: Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).
- [Cloudflare: secretos](https://developers.cloudflare.com/workers/configuration/secrets/).
