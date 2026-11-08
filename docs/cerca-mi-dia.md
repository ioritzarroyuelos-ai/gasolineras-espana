# Cerca de ti y Mi día

La portada pública y el panel personal comparten la misma cabecera y las mismas
secciones. «Inicio» vuelve a la portada y «Mi día» abre `/mi-dia`. El enlace del
municipio permite recuperar la localidad elegida; no sustituye los buscadores
específicos de gasolineras, farmacias, tiempo o ITV.

## Preferencias y favoritos

`src/client/mi-dia.js` guarda únicamente la organización en `eu-mi-dia-v1`:
`{version:1, visible:[...], order:[...]}`. Los identificadores permitidos son
`tiempo`, `gasolineras`, `deportes`, `farmacias`, `itv` y `politica`. Los tres
primeros se muestran inicialmente. Una lista visible vacía es intencional;
las entradas desconocidas o duplicadas se descartan y el orden se completa con
los módulos que falten. Los controles de subida y bajada mantienen el foco.

Se reutiliza `espana-util-municipio`; no hay otra localidad exclusiva del panel.
Al abrir la portada o Mi día sin una búsqueda ni un municipio en la URL, el
cliente comprueba la preferencia con `/api/localidad/:ine` antes de abrir la
página municipal. El servidor vuelve a evaluar las fechas. Un municipio que
ya no existe no provoca redirecciones en bucle.

Los favoritos se leen de `gs_favs_v1` y `eu-deportes-favoritos-v1`, sin escribir
esas claves desde Mi día. También aparecen en `/#mis-favoritos`. Se muestran
hasta seis enlaces por sección y se avisa cuando hay más. Una estación antigua
sin provincia válida abre el listado de favoritas del mapa. Los enlaces de
deportes se limitan a rutas internas permitidas y los nombres se insertan como
texto. Si el almacenamiento falla, la organización funciona durante la visita
y aparece un aviso; no se promete conservarla al cerrar la página.

`src/client/cuenta.js` gestiona la cuenta compartida. Las secciones esperan
`EUCuenta.ready`, notifican únicamente cambios explícitos con `changed(key)` y
escuchan `eu:cuenta` para mostrar los datos recuperados sin volver a subirlos.
Google se carga al abrir el acceso, no al visitar la web. La configuración pública
sale de `/api/auth/config`; las credenciales se verifican en el servidor.

Con sesión se sincronizan esas dos listas, `gs_profile_v1`, `eu-mi-dia-v1` y
`espana-util-municipio` mediante el almacenamiento KV existente. Municipio usa
una cadena INE en localStorage y una cadena JSON o `null` en la API. Las marcas
sin sesión permanecen separadas y pueden importarse desde el menú de cuenta.
Cerrar sesión restaura esas marcas, no borra los favoritos de la cuenta.
Los errores de lectura nunca se interpretan como una lista remota vacía.
El cliente envía `X-Account-Id` para rechazar una escritura si cambió la cookie
en otra pestaña. KV tiene consistencia eventual: no ofrece una transacción global
entre dispositivos que escriben simultáneamente.

## Datos y ausencia de conexión

`src/routes/home.ts` alimenta ambas vistas con los mismos lectores. El resumen
meteorológico usa un parte vigente y el día local del municipio, incluida
Canarias. Un precio local de gasolina 95 solo se destaca si su lectura tiene
como máximo 24 horas; las medias nacionales indican la fecha del Ministerio.
El recuento municipal de farmacias no se convierte en una afirmación de apertura.
La ITV conserva el acceso a su directorio y la cita oficial, sin inventar plazas.

La tarjeta deportiva usa una competición validada y muestra la fecha del evento
y de consulta. Un dato conservado mantiene su aviso; un próximo partido abre el
calendario y un resultado abre resultados. No se presenta como marcador en directo.
Si falla una de estas fuentes, las demás tarjetas y los enlaces siguen disponibles.

La portada y `/mi-dia` se sirven con `no-store`. El service worker exige conexión
para ambas páginas, igual que para las guardias y previsiones municipales; no
recupera un resumen antiguo como si fuera de hoy. La selección de bloques sigue
guardada en el navegador. Sin JavaScript se pueden consultar los enlaces y
buscar municipios; la personalización permanece oculta.

## Tema visual compartido

`src/html/ui-theme.ts` contiene `PORTAL_TOKENS` (paleta, tipografía y radio de
tarjetas) y `PORTAL_BASE_CSS` (base accesible de las páginas). Las seis secciones
usan esos colores mediante sus variables locales. Se mantiene el tema claro;
los avisos meteorológicos, de horarios o de datos atrasados conservan sus colores
y textos de estado.

`src/html/masthead.ts` es el único dueño de la cabecera, incluida su variante
compacta. No deben añadirse copias de sus reglas en cada sección. El enlace de
«Mi día» permanece visible en móvil y la navegación puede ocupar dos filas.
El nombre municipal se abrevia visualmente cuando no cabe; su nombre accesible
conserva el texto completo.

La mejora visual no introduce fuentes externas, rastreadores, imágenes remotas
ni datos de demostración. Los estilos siguen dentro de bloques con el nonce CSP
de la respuesta, sin atributos `style` ni `unsafe-inline`.

## Mapa de gasolineras

El mapa conserva sus controles, filtros, marcadores, paneles y enlaces para llegar
a una estación. Utiliza la cabecera común con Google y sin la antigua barra verde
duplicada. Favoritas y recuento están en el panel; el botón para plegarlo sigue
en los controles blancos del mapa. `src/client/ui.js` mide la altura
real de `.masthead` y del resto de barras con `ResizeObserver`; `#app-body` usa ese
valor para llenar el espacio disponible. No se debe fijar una altura de cabecera
suponiendo que todos los móviles ocupan una sola fila.

El modo oscuro del mapa sigue al control existente que añade `body.dark`.
`src/html/styles.ts` adapta únicamente los colores de la cabecera a ese estado;
no debe activarse automáticamente por el tema del sistema.

## Comprobaciones de regresión

- Navegación principal y selección de municipio con y sin JavaScript.
- Cabecera compacta, sin desbordamiento, a 320 y 390 píxeles.
- Buscadores específicos sin un segundo formulario municipal encima.
- Filtros, favoritos, clasificaciones, tablas, avisos y fechas de las seis secciones.
- Altura útil del mapa, apertura del panel de estaciones y modos claro y oscuro.
- Accesibilidad, ausencia de errores del navegador y cumplimiento de la CSP.

Los bocetos originales son una referencia visual. La web utiliza las fuentes,
fechas y mecanismos de actualización reales del proyecto.
