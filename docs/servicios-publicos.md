# Directorios públicos: refugios y salas de estudio

Este bloque añade dos catálogos oficiales al mapa Cerca y a listados accesibles sin JavaScript. El mapa de gasolineras y las otras capas se conservan.

## Cobertura comprobada

La extracción completa del 21 de noviembre de 2026 a las 01:48 UTC contiene:

| Fuente | Fichas | Con coordenadas comprobables | Sin coordenadas | Fecha original del archivo |
| --- | ---: | ---: | ---: | --- |
| Refugios climáticos de Cataluña | 2.730 | 1.421 | 1.309 | 16 de octubre de 2026 |
| Salas de estudio y lectura de Madrid | 68 | 68 | 0 | 20 de noviembre de 2026 |

Fuentes y condiciones:

- [Generalitat: catálogo municipal de refugios](https://analisi.transparenciacatalunya.cat/Seguretat/Refugis-clim-tics-dels-municipis-de-Catalunya/9gu7-iwci), [condiciones de reutilización](https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies). Atribución: Generalitat de Catalunya, Departament d'Interior i Seguretat Pública.
- [Ayuntamiento de Madrid: salas de estudio](https://datos.madrid.es/dataset/217921-0-salas-estudio), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

No requieren clave, cuenta nueva ni proveedor de pago. Son directorios, no partes de funcionamiento en tiempo real: una ficha no acredita activación de un refugio, apertura, gratuidad ni plazas libres. La accesibilidad sólo se filtra si está indicada expresamente. Las excepciones de los horarios se conservan completas. Una fecha de consulta nueva no modifica la fecha del archivo ni las fechas individuales. Las fechas de ficha de Cataluña carecen de zona horaria y se muestran como texto original, sin convertirlas a UTC.

Las fichas sin coordenadas permanecen en el listado; nunca se colocan en el centro municipal. Un equipamiento compartido puede tener una ficha por municipio según la fuente. Se pueden recordar las capas en las preferencias, pero este bloque no habilita favoritos de sus fichas.

## Actualización y conservación

`fetch-servicios-publicos.yml` se ejecuta mediante el reloj autenticado diariamente a las 08:57 UTC. El productor comprueba cada fuente por separado y sólo sustituye una copia completa y validada. Si falla una, conserva exactamente su copia anterior y marca el incidente; la otra puede actualizarse. El publicador pasa por el PR de datos y sus comprobaciones habituales. El trabajo termina con error si hubo fallos para que el reloj lo reintente, con la separación mínima de cuatro horas.

El índice distingue consulta reciente, último éxito y fecha original. El estado del servicio no se pone verde por descargar una página de error, por conservar una copia o por superar 30 horas sin comprobación. Una fecha original mensual puede ser correcta para un directorio; se muestra de forma independiente y no se confunde con una comprobación diaria del funcionamiento de cada lugar.

## Lectura acotada

El robot conserva la copia completa y genera bloques inmutables cuya versión depende de las fichas ordenadas y del formato de partición. El índice verifica el tamaño y SHA-256 del manifiesto; éste contiene los tamaños y SHA-256 de cada bloque. La API verifica la integridad del bloque y valida estrictamente cada ficha que entrega.

- Listado: un bloque de hasta 50 fichas por página, que puede ser menor por el límite de bytes.
- Mapa: zonas públicas de 0,25 grados y bloques de 100 fichas, con paginación visible. El límite del contrato es 200, pero el productor usa 100 para reducir CPU.
- Búsqueda: índice compacto preparado por el robot, hasta 25 resultados y dos bloques de fichas por página. La posición se deriva de los tamaños reales de las páginas; el texto normalizado se comprueba contra cada ficha hidratada. La paginación conserva todos los resultados.
- Cachés acotadas por binding, versión de aplicación, contenido y tiempo; los errores no se guardan como resultados vacíos. Las lecturas tienen límite de bytes y de tiempo. Las rutas no aceptan GPS ni consultan proveedores externos por petición.

Rutas: `/servicios/refugios-cataluna`, `/servicios/salas-estudio-madrid`, `/api/servicios/publicos` y `/api/servicios/publicos/:fuente?zona=...&pagina=...`. Los listados admiten búsqueda por nombre o municipio. Un error devuelve 503 y un enlace oficial, no un falso directorio vacío.

## Verificación y límites de la medida

Pruebas dirigidas cubren integridad, fechas futuras, conservación, coordenadas, paginación sin saltos, búsquedas dispersas, horarios completos, escape HTML, fallos y timeout. Las pruebas de navegador cubren escritorio y móviles de 390 y 320 píxeles, accesibilidad con axe, filtros, paginación, ausencia de favoritos, errores y respuestas tardías al cambiar de capa.

En el árbol aislado D pasan typecheck y 300 pruebas dirigidas (fuentes, lector, estado, reloj, cuenta y SEO), nueve pruebas nuevas de navegador y 19 de regresión del mapa, ITV, Bizi, Metro, favoritos y CartoCiudad. Las 55 páginas reales de Cataluña y las dos de Madrid se han recorrido por la API local: 2.730 y 68 identidades únicas, respectivamente, con los mismos recuentos de coordenadas que el productor. Las páginas reales de escritorio y móvil se han inspeccionado visualmente, sin desbordamiento ni errores JavaScript. Estos resultados corresponden al entorno local aislado, no a una publicación ya realizada.

El lector monolítico inicial se descartó tras medir unos 33,6 ms de CPU activa por lectura fría en workerd. El lector final se midió con los datos reales, 100 consultas por recorrido, bindings nuevos y bytes precargados para separar CPU de red: aproximadamente 4,1 ms para listado de 50 fichas, 4,0 ms para búsqueda de Barcelona (576 coincidencias) y 6,0 ms para el bloque de mapa de 100 fichas. Estas cifras son del lector local; no garantizan el límite de CPU de la petición completa en Cloudflare. La vista previa real y la verificación del despliegue quedan pendientes antes de darlo por publicado.
