# Cuenta y servicios cercanos

La extensión reutiliza Google, la cookie de sesión y Workers KV existentes. No
añade D1, otra cuenta, un rastreador o un proveedor de pago.

## Datos y API del navegador

Después de `await EUCuenta.ready`, el cliente usa `EUCuenta.servicios`:

- `favoritos()`, `esFavorito(id)`, `urlFavorito(lugar)`.
- `alternarFavorito(lugar)` y `quitarFavorito(id)` son asíncronas.
- `preferencias()` y `guardarPreferencias({categorias,municipios})`.
- `historialActivo()`, `historial()`, `activarHistorial(bool)`,
  `registrarConsulta({municipio,categorias})` y `borrarHistorial()`.

Los favoritos se guardan en `eu-servicios-favoritos-v1`: hasta 100 objetos
`{id,nombre,categoria,lat,lon}`. El ID es `osm-node-123`, `osm-way-123` o
`osm-relation-123`. Para ITV oficial se usa `itv-PROVINCIA-CODIGO`, por ejemplo
`itv-48-4804`, exclusivamente con categoría `itv`. Las estaciones fijas de Bizi
Zaragoza usan `gbfs-zaragoza-<station_id>` con categoría `bicis-zaragoza` y
coordenadas dentro de esa red. No se guardan bicicletas disponibles, anclajes
ni caducidad: esos datos se consultan de nuevo. Las coordenadas son las públicas del lugar. El cliente
construye `/cerca?lat=...&lon=...&servicio=...&categorias=...`; no acepta URLs
guardadas. No copia horarios, precios ni GPS del visitante. El servidor valida
la categoría contra el catálogo compartido y rechaza campos extra.

`eu-servicios-preferencias-v1` contiene
`{version:1,categorias:[slug],municipios:[INE]}`; hasta 12 municipios, sin dirección
de casa ni coordenadas. Ambas claves usan los mismos eventos `eu:cuenta`, cola
de cambios, aislamiento de cuentas y reintentos que los favoritos antiguos. Las
listas se combinan por intenciones de añadir/quitar; una lectura no vuelve a
subir la copia antigua.

Las preferencias permiten recordar las capas oficiales `trafico-cataluna` y
`camaras-cataluna`, además de `farmacias-guardia` y `metro-bilbao` cuando su
interfaz esté disponible. Esto no habilita favoritos de incidencias, cámaras,
guardias temporales ni estaciones Metro Bilbao sin consulta individual:
tampoco se aceptan esos tipos con un identificador OSM, ITV o Bizi.

El historial empieza desactivado, no se sincroniza, se separa por cuenta en
este navegador y sólo admite consultas con código municipal. Conserva hasta 20
consultas; al leerlo elimina las de más de 30 días. No admite GPS ni texto libre.
Desactivarlo borra sus entradas. `eu:servicios-historial` anuncia los cambios.

Inicio y Mi día muestran los lugares guardados. El menú de cuenta permite
descargar una copia JSON y vaciar favoritos/ajustes con confirmación. El estado
de sincronización distingue un cambio pendiente de uno confirmado. Este vaciado
no elimina la identidad de Google, revoca otras sesiones ni cancela Telegram.
No sustituye un procedimiento completo de supresión de cuenta.

## Telegram diario

El reloj independiente despacha `cron-telegram-check.yml` dentro de
08:00–11:59 Europe/Madrid. La ejecución normal mantiene la deduplicación de 20h,
incluidas las ejecuciones manuales. El workflow no añade `force=1`. Los precios
deben tener fecha válida del Ministerio, no futura y con antigüedad máxima 26h.
Errores y cola pendiente producen error HTTP, no una ejecución verde falsa.

`dry_run:true` utiliza `?dry_run=1`, autentica la petición y comprueba datos y
suscripciones. No envía mensajes, purga tokens ni actualiza D1. Devuelve sólo
recuentos. Su título «Telegram · comprobación sin envío» no cubre la entrega
diaria del coordinador. Las pruebas usan respuestas y chats ficticios; no se
ejecuta un envío de prueba a personas.

## Dependencias pendientes, sin botones ficticios

- Farmacias de guardia no tienen identidad estable en los datos actuales. Se
  guarda su municipio, sin convertir una guardia temporal en un favorito eterno.
  ITV ya dispone del adaptador oficial `/api/servicios/itv?zona=...` y de su
  consulta individual `/api/servicios/itv/:id?zona=...`. Sólo admite código
  oficial y provincia sin colisiones, y puntos publicados por DGT o una ficha
  de operador comprobable. La fecha de las coordenadas no se sustituye por
  la fecha en que se regeneró el catálogo. Las estaciones sin coordenadas
  siguen en el directorio y no se sitúan en el centro municipal. Los enlaces
  de cita y tarifas conservan su comprobación; no anuncian huecos ni precios.
- El recordatorio ITV guarda sólo `{version:1,recordatorio:{id,fecha,nombre}}`
  en `eu-itv-recordatorio-v1`; quitarlo guarda `recordatorio:null`. El visitante
  indica la fecha, sin cálculo del plazo legal. La descarga `.ics` incluye un
  evento de día completo, identificador estable y avisos 7 y 1 días antes,
  siguiendo [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545). Debe importarse
  en el calendario y comprobar allí sus notificaciones. Modificarlo en la web
  no modifica la copia importada. El bot actual sólo vincula chats con
  gasolineras: Telegram para ITV necesita consentimiento y vínculo nuevos.
- No hay cuenta AdSense, acuerdos de afiliación o reservas de pago. No se
  generan anuncios, enlaces comerciales inventados ni un panel de ingresos
  con cifras falsas. La aportación existente sólo aparece si `SUPPORT_URL` está
  configurada. El contacto legal del titular requiere información real del dueño.

## Comprobaciones

`tests/cuenta-client.test.ts` cubre aislamiento, cola sin conexión, favoritos
de lugares, preferencias sin GPS, opt-in/borrado del historial y exportación/
vaciado. `tests/routes-auth.test.ts` comprueba formatos y acceso a KV.
`tests/routes-telegram.test.ts` y `tests/telegram-automation.test.ts` cubren
dry-run, antigüedad, ventana, deduplicación y fallos. Los casos de
`tests/e2e/cuenta.spec.ts` usan cuentas simuladas para verificar el navegador,
la descarga, la confirmación y las tarjetas a 320/1280px; no acreditan un OAuth
real nuevo en producción.

`tests/e2e/servicios-oficiales.spec.ts` comprueba con API simuladas las fichas ITV,
los favoritos oficiales desde Inicio, disponibilidad cero de Bizi sin falsos
cierres, caducidad individual y fallos de refresco en lista/popup, pestañas
suspendidas y la elección explícita de una dirección por POST sin guardarla.
