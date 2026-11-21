# Aparcamientos oficiales: Madrid y Vigo

Implementación F. Este documento acredita el productor, lectores, API e integración visual local; el despliegue se verifica aparte. No se han escrito snapshots manualmente en `public/data`.

## Fuentes gratuitas comprobadas

| Ciudad | Fuente y licencia | Catálogo observado | Disponibilidad |
| --- | --- | --- | --- |
| Madrid | [Catálogo municipal](https://datos.madrid.es/dataset/50027-0-aparcamientosocupacionyservicios), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/legalcode.es) | 75 aparcamientos; capacidad numérica explícita en 66 y plazas PMR en 25 | `lstOccupation/occupation`, código `001`, nombre `Total`, campo `free`, fecha `moment` con zona explícita. Caduca por fila a los 5 minutos. |
| Vigo | [Catálogo municipal](https://datos-ckan.vigo.org/dataset/t-parking-real), [ODC BY 1.0](https://opendatacommons.org/licenses/by/1-0/) | 12 aparcamientos con capacidad | Campo `plazaslibres` y fecha propia `fechahora`. El catálogo anuncia cadencia de 3 minutos; cada cifra caduca a los 6 minutos. |

Madrid: [WSDL público](https://servayto.madrid.es/MTPAR_WSINFO/InfoParking?wsdl), operaciones de lectura `GetListParking` y `GetDetailParking`, POST SOAP a `https://servayto.madrid.es/MTPAR_WSINFO/InfoParking`. No pide clave. El recurso antiguo `.api` devolvía HTML: no se utiliza. Se comprueba el envoltorio SOAP, espacio de nombres, código de éxito, tipo de lista, IDs únicos y límites antes de admitir datos.

Vigo: [JSON oficial](https://datos.vigo.org/data/trafico/parkings-ocupacion.json). ID estable `id_parking`; el otro campo `id` no identifica el aparcamiento en nuestra aplicación. La hora local se interpreta en `Europe/Madrid` con comprobación de ida y vuelta: las horas repetidas del cambio otoñal y las inexistentes de primavera quedan sin confirmar.

No se transforma `ocupacion` en plazas libres, ni se resta de la capacidad. Cero es una cifra válida. Un campo ausente, negativo, fraccionario, mayor que la capacidad conocida o con fecha futura no acredita disponibilidad. Un `Last-Modified` reciente nunca rejuvenece una fila antigua. En Vigo, Portugal tenía una fecha más antigua que las otras 11 filas en las dos descargas de investigación y en la comprobación posterior.

## Datos que se muestran sin inventar

- `capacidad` y `plazasPmr` son cantidades totales, nunca plazas libres. Madrid repite algunas características PMR idénticas: se deduplican, no se suman; valores contradictorios quedan sin confirmar.
- `horarioTexto` es la cadena literal. No permite deducir automáticamente que el aparcamiento esté abierto.
- `gratis` y `disuasorio` permanecen `null`: estas fuentes no los documentan de manera inequívoca. No se deduce gratuidad de una capacidad, un nombre o un horario. No se ofrecen reservas ni tarifas calculadas a partir de tramos ambiguos.
- Madrid ofrece coordenadas generales válidas, pero se observaron coordenadas intercambiadas en algunos accesos. Sólo se utilizan las generales; no se corrigen las otras por intuición. Los puntos fuera de la caja municipal conservadora permanecen en el listado sin pin.
- No hay fecha original de edición verificable del catálogo: `fechaDatos` y `fechaFicha` son `null`. `consultado` y `detalleConsultado` acreditan lectura, no edición del local. Las direcciones con caracteres de sustitución se omiten sin corregirlas por intuición.

## API y caducidad

`GET /api/aparcamientos/madrid` y `GET /api/aparcamientos/vigo`. No admiten parámetros de ubicación. Las únicas URLs externas son las dos fuentes fijas; no se transmite GPS.

Respuesta: `fuenteId`, `nombre`, `consultado`, `evaluadoEn`, `catalogoConsultado`, `fechaDatos:null`, `fuenteUrl`, `licenciaUrl`, `atribucion`, `estado`, `total`, `conDisponibilidad`, `items`, `warnings`.

Cada item tiene `id` (`parking-madrid-72` / `parking-vigo-4763`), `nombre`, `lat/lon` anulables, `direccion`, `capacidad`, `plazasPmr`, `horarioTexto`, `fechaFicha:null`, `detalleConsultado`, `gratis:null`, `disuasorio:null`, `fuenteUrl`, `plazasLibres`, `fechaOcupacion`, `caduca`, `estado` (`actual`, `caducado`, `sin_confirmar`). Al caducar se retira la cifra libre; la ficha sigue disponible. Un fallo de red conserva sólo el catálogo y deja `consultado:null`; no conserva un contador de otra visita.

El consumidor debe retirar el estado actual en `caduca` mediante el plazo monotónico compartido, anclado antes de la petición a `evaluadoEn`. No debe calcular disponibilidad usando la fecha de descarga diaria ni interpretar el horario literal. El servidor responde `Cache-Control:no-store`; sólo la descarga upstream tiene caché de 60 segundos y las filas se reevalúan al leerla. Los detalles de Madrid nunca se consultan por visita.

Las respuestas externas usan `redirect:manual`, límite de 256 KiB Madrid / 128 KiB Vigo, cancelación de flujo y timeout total de 6 segundos. No se siguen redirecciones ni se interpretan DTD/entidades externas. El directorio publicado se coteja con bytes y SHA-256 del índice antes de utilizarlo.

## Robot automático

`node scripts/fetch-aparcamientos.mjs` necesita Node 22 y `npm ci` (esbuild compila el mismo lector TS que usa el Worker). Para pruebas: `APARCAMIENTOS_DIR` señala un directorio temporal.

- Diario a las **09:07 UTC**, solicitado por el reloj autenticado existente; sin un segundo cron ni intervención manual. Un trabajo en cola evita duplicados. Tras fallo, el coordinador espera 4 horas antes de reintentar.
- Madrid: una lista y un detalle por aparcamiento, secuenciales con una pausa mínima de un segundo. Vigo: una lista. Ambas fuentes se procesan independientemente.
- Se rechaza pérdida superior al 30 % del catálogo anterior y, en la primera descarga, menos de 50 fichas Madrid / 8 Vigo. No se acepta una respuesta vacía como desaparición de toda una ciudad.
- `madrid.json` y `vigo.json` guardan **sólo el catálogo**, sin cifras de plazas libres. `index.json` conserva por fuente estado, último éxito, recuento y hash. Si falla una lista se mantiene el archivo previo; si falla un detalle Madrid se conservan sus atributos y la fecha anterior y el estado es parcial. El productor devuelve error verificable, aunque publique la fuente que sí pudo renovar.
- Escrituras temporales y reemplazo; si falla el índice se restauran las copias previas. El workflow publica datos e incidencias mediante el robot y PR protegido, y después mantiene el resultado de fallo para activar el reintento.
- El manifiesto y el estado público incluyen “Catálogos de aparcamientos oficiales” y la comprobación de cada ciudad. El agregado usa el éxito más antiguo; una consulta nueva no rejuvenece la fuente conservada. Esto no certifica disponibilidad en directo.

## Verificación real del 21 de noviembre de 2026

El productor completo terminó a las 09:08:34 UTC: 75 fichas Madrid y 12 Vigo, con los 75 detalles Madrid comprobados. Duración aproximada 77 segundos. Copias de prueba: 33.199 y 3.918 bytes. Ningún fichero de datos se editó a mano.

Las listas se volvieron a descargar a las 09:12 UTC. Había 11 cifras vigentes de Madrid y 11 de Vigo; esta es una observación de ese instante, no una promesa de cobertura constante. Vigo Portugal seguía fuera del plazo por su fecha individual.

Perfil del API completo en workerd, compatibilidad 2026-04-05: 100 peticiones por ciudad con catálogo frío en cada iteración (lectura, SHA, validación, unión y serialización) y caché upstream. CPU activa media: Madrid **4,44 ms**, Vigo **1,30 ms**. Dos consultas upstream interceptadas en 200 peticiones; ninguna llamada de detalle desde el API. La muestra mide solicitudes en un isolate ya cargado, no arranque de isolate ni latencia de Internet. Scripts y perfiles reproducibles en `.tmp/aparcamientos-fuentes/perfil-api.mjs` y `api-workerd-cpu.json`.

Las pruebas cubren cero, ausencia de dato, fechas futuras/imposibles/DST, caducidad exacta, filas de distinta antigüedad, coordenadas invertidas, PMR repetidas/contradictorias, restricciones SOAP, hash inválido, límites de bytes, redirecciones, red lenta, respaldo, productor parcial y recuperación diaria.

## Mapa y favoritos

El mapa Cerca de ti ofrece las categorías `aparcamientos-madrid` y `aparcamientos-vigo`, que llevan al municipio correspondiente. Sus fichas muestran plazas libres sólo mientras el plazo individual sigue vigente, con la hora del parte. Cero se muestra como cero; no se transforma en cerrado. La cifra desaparece a tiempo tanto de la lista como del popup, al volver de una pestaña suspendida y después de una comprobación fallida. El plazo compartido usa reloj monotónico y el inicio anterior a la petición, por lo que atrasar el reloj o esperar una red lenta no alarga la vigencia. Los grupos entre corchetes del horario se separan visualmente con puntos medios y espacios tras las comas; se conservan todas sus palabras y excepciones, sin interpretar apertura o intervalos. El dato original no se modifica.

Los enlaces para llegar abren Google Maps, Apple Maps o Waze con las coordenadas públicas del aparcamiento. Una ficha sin coordenadas verificables conserva nombre y fuente en la lista, sin pin ni ruta inventada. La capacidad PMR se distingue expresamente de las plazas libres. Los filtros de apertura, gratuidad y accesibilidad excluyen estas fichas: ninguno de esos datos se infiere del horario literal o del número de plazas reservadas.

Los favoritos guardan sólo identificador estable, nombre, categoría y coordenadas públicas; nunca ocupación, horarios, matrícula o GPS del visitante. La sincronización conserva el aislamiento entre cuentas. Al abrir el favorito desde Inicio se consulta el API actual. Si desaparece del catálogo o pierde coordenadas, se avisa y se permite conservarlo o quitarlo; no se reconstruye una cifra desde el favorito. IDs Madrid/Vigo y categorías deben corresponder a su ciudad, también en servidor.

La ocupación se comprueba al cargar y cada minuto con la capa visible; el servidor limita la descarga municipal mediante caché de 60 segundos. Cambiar a carburantes o abandonar una capa impide que respuestas tardías repongan sus resultados. Un tiempo de espera inicial avisa de una fuente no comprobada y ofrece reintento, en vez de presentar un vacío normal. Los detalles siguen el robot diario descrito arriba.

Validación local del 21 de noviembre: **211 pruebas** dirigidas de datos, cliente y cuentas, comprobación de tipos y build correctos; **34 E2E** del mapa, incluyendo 11 casos nuevos de aparcamientos y regresiones de gasolineras, ITV, bicicletas, tráfico y cámaras. Axe no detectó infracciones en las fichas a 390 y 1280 px. La revisión independiente encontró y permitió corregir el tiempo de espera inicial. Las pruebas usan fixtures y no crean reservas, cuentas o mensajes reales.

Las cuatro comprobaciones visuales locales con las API municipales reales, entre las 09:35 y 09:36 UTC, observaron 75 fichas Madrid y 12 Vigo, con 11 cifras vigentes en cada ciudad en ese instante; sin errores de JavaScript ni desbordamiento horizontal. Los ficheros generados por el robot se copiaron intactos a `dist/data/aparcamientos` después del build, nunca a `public/data`. Esta evidencia no acredita todavía la publicación de F ni la disponibilidad futura de plazas.

La entrega aislada parte de `bc9c25f39fdcc77c3a75cf4d09ff04df69d3e7cb`, incluye sólo los 30 archivos de F y conserva el productor de precios y el arreglo de alternancia del mapa heredados. Tras mejorar la presentación del horario, pasaron **2.576 pruebas en 160 archivos**, tipos, build y los **11 E2E de aparcamientos** sobre esa compilación. El escaneo de los archivos de la entrega no encontró secretos. No se publicó la rama ni se activó el robot durante esta comprobación.

## Cobertura pendiente

Zaragoza devolvía un fichero de ocupación con `Last-Modified` de 2020 y sin fecha por fila. Santander ofrecía un directorio de 2019 sin plazas libres. El recurso BSM Barcelona lleva a una página oficial que exige token/solicitud. No se ha sorteado ninguno de esos accesos ni incorporado esas cifras como actuales. Quedan pendientes fuentes gratuitas verificables para esas ciudades y para datos de gratuidad, accesibilidad completa o condición de disuasorio que las dos fuentes actuales no proporcionan inequívocamente.
