# Guardia de Santa Cruz de Tenerife: comprobación diaria

El cartel del [COF Tenerife](https://www.coftenerife.es/ciudadanos/farmacias-de-guardia/)
mezcla una guardia con horarios ampliados. El lector anterior descartaba el cartel
entero. La reparación admite únicamente el bloque cuyo texto dice expresamente
«Horario de guardia: 24H», tras corroborarlo con el directorio oficial.

## Evidencia y significado

Comprobación del 21 de noviembre de 2026: el calendario mensual enlaza el cartel de
Santa Cruz. La ficha de calle Horacio Nelson 21 identifica titular y teléfono.
La [API municipal oficial](https://www.coftenerife.es/farmacias/controller/server.php/api/municipios/38)
identifica la oficina 398 con esos mismos datos y publica un intervalo explícito
del 21/11 a las 00:00 al 22/11 a las 00:00. Son horas locales de Canarias.

El encabezado «todos los días del año» es una imagen del PDF. No se utiliza para
calcular turnos, ni se incorpora OCR o una dependencia nueva. La etiqueta textual
de guardia procede del PDF del mes solicitado y la cobertura del día procede de
las fechas y horas de la API. Descargar hoy el cartel no cambia su fecha de edición.
Se exige nuevamente la corroboración del día en cada ejecución automática.

La identidad debe coincidir en teléfono único, titular único, dirección y municipio.
La etiqueta se debe encontrar dentro de las cuatro líneas de la misma columna.
Faltas, condiciones nuevas, otra plantilla, horarios parciales, intervalos duplicados,
otra fecha o una API sin datos dejan la zona pendiente. Una apertura ordinaria de
24 horas o «hasta las 24 horas» no se convierte en guardia.

## Límites y comprobaciones

Se conserva el aviso parcial de Santa Cruz: la incorporación de esta guardia no
certifica otros turnos del cartel mixto. Las demás oficinas siguen siendo aperturas
ordinarias. No se cambian los lectores de las demás zonas ni el calendario automático.
El cruce aprovecha el directorio ya descargado: no añade peticiones por ejecución.

La muestra de prueba contiene texto y posiciones extraídos del PDF real, y sólo
los campos públicos del directorio necesarios para la validación. Las pruebas cubren
cruce correcto, vecino con horario ordinario, identidad ambigua, otro mes/día,
jornada parcial, condiciones añadidas y API sin información. Los resultados reales
del robot se guardan en `.tmp/robot`, nunca se editan manualmente en `public/data`.

Validación local: 105 pruebas dirigidas pasan, incluidas las regresiones de fichas,
horarios y capa del mapa. Typecheck y comprobación del diff pasan. El lector de la
web confirma la guardia a las 23:30 UTC del 21/11 y deja de marcarla como activa a
las 00:00 UTC del 22/11 (medianoche canaria), aunque en Madrid cambie el día antes.

La ejecución real completa del productor terminó el 21/11/2026 a las 11:36:23 UTC:
53 municipios consultados, ninguno con error y 429 filas en la copia temporal.
La oficina recuperada tiene los intervalos explícitos de hoy y ayer; desaparece su
ficha duplicada de apertura ordinaria. Se conserva el aviso parcial de Santa Cruz.
Build de producción correcto. Vista local en Chromium, con la copia real generada
copiada sólo a `dist/data`: seis comprobaciones a 390 y 1280 píxeles para todos los
turnos, abierta ahora y turno de 24 horas. La guardia aparece una sola vez en los
tres filtros; el filtro de 24 horas devuelve únicamente esa ficha. Las aperturas
ordinarias mantienen su etiqueta distinta y el aviso parcial sigue visible. Sin
desbordamiento, errores JavaScript ni incidencias graves o críticas de axe.
Capturas revisadas visualmente. La publicación todavía está pendiente.
