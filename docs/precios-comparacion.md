# Dos capturas oficiales por estación

El robot de precios prepara una comparación antes de sustituir la captura general.
Esta fase sólo publica los datos necesarios; no activa avisos ni cambia preferencias.
La ejecución sigue siendo la del robot de precios y la publicación pasa por PR y CI.

La fecha del Ministerio se interpreta en Europe/Madrid, incluidos los cambios de hora.
Se conservan la fecha literal de la fuente, su instante UTC y la consulta original.
Repetir la misma captura no cambia su fecha ni la convierte en una comparación nueva.
Si una fecha oficial ya guardada contiene precios diferentes, se rechaza la comparación.

Cada fila identifica una estación y sus cuatro precios: gasolina95, gasolina98,
gasóleoA y gasóleoPremium, expresados en milésimas de euro. Diez milésimas equivalen
a un céntimo. Una ausencia es null; nunca un precio cero ni una mediana provincial.
Sólo se compara el mismo identificador y combustible de dos capturas verificadas.

La captura actual debe tener menos de26horas, la anterior menos de36horas y la
separación no puede superar26horas. Se toleran cinco minutos de desfase futuro.
Si no hay referencia válida, se publica anterior:null; el consumidor no puede anunciar
una bajada. Una captura actual caducada detiene la publicación de precios.

El índice referencia32bloques según Number(IDEESS)%32, con tamaño y SHA256.
La versión depende del contenido y las fechas originales. Los archivos se escriben
antes que el índice y se conservan la versión actual y la anterior. La limpieza sólo
retira directorios con nombre hash y32nombres conocidos, sin seguir enlaces ni borrar
recursivamente. El lector verifica integridad y límites antes de utilizar una referencia.

PRICES_DATA_DIR permite ejecutar el mismo robot en un directorio temporal de pruebas;
por defecto la salida sigue siendo public/data. Ningún archivo de datos se incluye
manualmente en la propuesta de código.

## Validación

-27pruebas de comparación y tendencias: igualdad, subidas, ausencias, duplicados,
  fechas imposibles, futuro, caducidad, repetición, integridad y conservación de archivos.
-Lectura real el21nov2026:11540estaciones de la captura09:32:24Madrid, comparadas
  con11538estaciones de20nov22:45:05Madrid. Total927263bytes y máximo30170bytes
  por bloque; los32bloques mantienen sus hashes y fechas originales.
-Sin envíos reales a Telegram. La activación del consumidor se comprueba por separado.
