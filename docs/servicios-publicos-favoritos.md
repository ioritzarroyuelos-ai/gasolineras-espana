# Favoritos de refugios y salas de estudio

El corte K añade favoritos a los directorios oficiales de refugios climáticos de Cataluña y salas de estudio de Madrid. Reutiliza la cuenta y el almacenamiento de favoritos existentes. No necesita nuevas tablas, servicios de pago ni una cuenta adicional.

## Datos guardados y comportamiento

Sólo se guardan `id`, `nombre`, `categoria`, `lat` y `lon` del equipamiento público. No se guardan el GPS del visitante, horarios, activación, apertura ni plazas. Se exigen el identificador de la fuente, su categoría exacta y coordenadas dentro del territorio del catálogo. Las fichas sin coordenadas siguen en el listado y no pueden guardarse como punto del mapa.

- Cataluña: `refugio-cat-` seguido de 64 caracteres hexadecimales; categoría `refugios-cataluna`.
- Madrid: `estudio-madrid-` seguido del identificador numérico publicado; categoría `salas-estudio-madrid`.

Al abrir un favorito se consulta su identidad actual. Si se ha trasladado, la ficha y el enlace para llegar usan las coordenadas actuales; el favorito no se reescribe a escondidas. Si ha desaparecido, se explica y se conserva el favorito para que la persona decida quitarlo. Un error de red o de integridad no se presenta como desaparición. Si la fuente ya no ofrece coordenadas, no se inventa un punto.

Cambiar de cuenta, quitar el favorito o cambiar de capa descarta las respuestas pendientes. Se conservan el aislamiento entre cuentas, los favoritos locales del visitante y la cola de cambios sin conexión. El botón mantiene sincronizados su texto, nombre accesible y `aria-pressed` al guardar y quitar.

Una ficha sigue siendo un registro de directorio: no acredita que un refugio esté activado, que una sala esté abierta ni que haya plazas. Las copias conservadas mantienen sus fechas originales y su aviso.

## Índice y consulta acotada

El productor incorpora el campo opcional `identidades` al manifiesto de esquema 1. La versión de partición pasa a 4. Cada descriptor indica archivo, tamaño, SHA-256, total y primer y último identificador. Los bloques contienen hasta 100 referencias `[id, pagina, posicion]` y tienen un límite de 16 KiB. Los identificadores están estrictamente ordenados y los rangos no se solapan.

`GET /api/servicios/publicos/:fuente/lugar/:id` no admite parámetros de consulta. Una consulta fría del lector necesita como máximo cuatro lecturas: índice, manifiesto, bloque de identidades y página de fichas. Verifica tamaños, huellas, recuentos, límites de posición e identidad de la ficha recuperada. La respuesta no incluye una lista nacional completa.

- Identidad ausente en un índice íntegro: 404.
- Índice antiguo sin identidades: 503, con explicación de que la consulta se está preparando.
- Archivo corrupto, ausente o mezclado con otra versión: 503, nunca un falso 404.
- Ficha presente sin coordenadas: respuesta válida para explicar el cambio, sin marcador ficticio.

El manifiesto antiguo continúa siendo válido para listados, mapas y búsqueda. Su respuesta declara `favoritosDisponibles: false`; la interfaz conserva el enlace anterior a la zona y no ofrece guardar. Los manifiestos nuevos declaran la disponibilidad y enlazan la identidad desde el listado.

## Publicación y actualización

El reloj diario y el publicador existentes no cambian. La publicación incluye toda la carpeta del directorio, también los bloques de identidades. La generación conserva la consulta, la fecha original y el último éxito de una fuente retenida; una partición nueva no vuelve recientes sus datos.

El orden preferente es publicar el productor, ejecutar el robot y comprobar sus artefactos antes de activar el consumidor. También se admite publicar el código conjuntamente: la bandera de disponibilidad mantiene los favoritos desactivados hasta que llega el primer catálogo nuevo. Hay que comprobar ese primer trabajo y su publicación real. No se introducen datos a mano en `public/data`.

## Verificación local

- 25 pruebas nuevas de productor, manifiesto y consulta por identidad; 64 pruebas existentes de los directorios; 142 pruebas de cuenta y autenticación.
- 19 pruebas de navegador: diez nuevas y nueve de regresión. Incluyen guardar y quitar, vuelta desde Inicio, traslado, desaparición, falta de coordenadas, copia antigua, manifiesto anterior y respuestas tardías. Axe no detectó incidencias en las vistas comprobadas de 390 y 1280 píxeles; las regresiones incluyen 320 píxeles.
- TypeScript y compilación verificados. La revisión independiente del productor y lector no encontró un fallo material.
- Dos fichas de las copias oficiales guardadas se comprobaron en navegador local, una por fuente, conservando identidad, fecha y los cinco campos del favorito. Se inspeccionaron las capturas, sin desbordamiento ni errores JavaScript. Las pruebas no crearon sesiones de Google ni escribieron preferencias en cuentas reales.

La copia real usada para la medida contiene 2.730 refugios y 68 salas. Cataluña conserva la fecha original del 16 de octubre de 2026 y Madrid la del 20 de noviembre de 2026. El índice de identidades se divide en 28 y un bloque, respectivamente; el bloque mayor mide 8.670 bytes. Son cifras de esa copia de prueba, no una promesa de cobertura permanente.

En workerd se midieron cien consultas por fuente, renovando el binding en cada consulta para vaciar la caché del lector. Cada recorrido realizó exactamente 400 lecturas. La media de CPU activa fue aproximadamente 1,23 ms por refugio y 0,70 ms por sala. El proceso estaba caliente y los archivos estaban precargados: la medida separa CPU de latencia y no garantiza el tiempo de una petición completa ni de un arranque frío en producción.

Estas comprobaciones corresponden al árbol aislado K. La suite conjunta, la vista previa y la verificación del robot y del despliegue forman parte de la publicación combinada posterior.
