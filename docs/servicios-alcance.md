# Alcance comprobable de servicios cercanos

Revisión: **21 de noviembre de 2026**. Se conserva la numeración acordada:
bloques 1–9 y 11–13. **El bloque 10 está excluido** por petición expresa.

Esta matriz distingue tres cosas: que una función exista, qué territorio o
fuente cubre y que se haya publicado. Ninguna acredita cobertura exhaustiva
nacional ni que cada establecimiento haya sido comprobado personalmente.

## Estado de las entregas en esta revisión

| Entrega | Estado consignado | Alcance |
| --- | --- | --- |
| B | Publicado, cambio `3329c4bc`. | Mapa unificado, directorio OSM, ITV, Bizi, SCT, cámaras, guardias y base de cuenta. Conserva el mapa de gasolineras. |
| C | Preparado y comprobado; no se da por publicado en este documento. | Metro Bilbao, favoritos de estaciones/cámaras y recordatorios ITV por Telegram. |
| D | Preparado y comprobado; no se da por publicado en este documento. | Catálogos oficiales de refugios de Cataluña y salas de estudio de Madrid, listados y mapa. |
| E | Consumidor y opciones del visitante preparados; publicación separada del productor de comparación de precios. | Resumen diario o sólo bajadas, con consentimiento y dos capturas oficiales recientes. |
| F | Preparado y comprobado; no se da por publicado en este documento. | Aparcamientos oficiales de Madrid/Vigo, plazas vigentes y favoritos estables. |
| G | Preparado en una rama independiente; **no está incorporado a la base F de esta revisión**. | Recogida explícita de paquetes y filtros de reciclaje de pilas/aceite de cocina. Requiere publicar código y regenerar el directorio con el robot. |
| H | Ajuste de descubrimiento y documentación sobre F, pendiente de publicación. | Accesos visibles a fuentes implementadas y separación de sus coberturas respecto de OSM. No añade una fuente ni habilita G. |

Este estado es una fotografía de la revisión, no un monitor de despliegues.
Para dar por publicada una entrega hay que registrar su versión y comprobar la
web y el primer ciclo automático real. Los ensayos con respuestas simuladas no
prueban un mensaje enviado, una reserva, OAuth nuevo o la vigencia de una cifra.

Se mantienen fuentes gratuitas, el alojamiento y las funciones existentes. No
se han creado cuentas publicitarias, acuerdos, reservas de pago ni otra base
D1. El usuario confirmó que no tiene cuentas o acuerdos de monetización.

## Cómo interpretar la cobertura

- **Directorio**: permite encontrar una ficha. No garantiza apertura,
  activación, disponibilidad, titularidad pública o condiciones que no consten.
- **Estado cambiante**: se muestra sólo en la red identificada y mientras la
  fecha individual sea válida. Consultar hoy no rejuvenece una cifra antigua.
- **Sin datos OSM**: se refiere a esa copia cartográfica, no a todos los
  proveedores. Los directorios oficiales de D pueden tener fichas aunque la
  categoría equivalente de OSM esté vacía.
- **Pendiente**: falta fuente, integración, verificación o un requisito externo.
  Reservar un nombre en el catálogo no ofrece cobertura.

El extracto nacional de la comprobación inicial contenía **577.770 IDs OSM**
en **2.269 zonas** y 53 categorías no vacías de 58 definidas. Su consulta fue
`2026-11-20T23:58:01.566Z` y el extracto más antiguo
`2026-11-19T21:22:20Z`. Son evidencia histórica, **no recuentos actuales**.
La geometría IGN recorta al territorio español; una caja del mapa no demuestra
pertenencia a un municipio. El índice y la ficha conservan por separado fecha
del extracto, consulta y edición original.

En aquella copia no había registros OSM de refugios, Puntos Violeta, recogida de
paquetes, DNI/pasaporte o salas de estudio. D incorpora dos directorios oficiales
independientes; G cambia la clasificación de paquetería y añade dos materiales
de reciclaje, pero esos cambios no se atribuyen al snapshot anterior.
Los datos y fechas de cada ensayo real están en los documentos por fuente
enlazados más abajo. No son cifras para planificar un desplazamiento hoy.

## Matriz de los 12 bloques

| Bloque acordado | Función implementada o preparada | Limitación o pendiente real |
| --- | --- | --- |
| **1. Mapa único — parcial** | B: mapa conservado, GPS con permiso, municipio/categoría y dirección/CP con elección explícita, agrupación, distancia en línea recta, contacto, Google/Apple/Waze, favoritos y fechas. Filtros de horario, gratis y accesibilidad con datos explícitos. C–F añaden sus capas propias; H hace visible la cobertura de cada una. | No hay disponibilidad o alertas universales. Sólo se interpreta un subconjunto de horarios; las excepciones ambiguas quedan sin confirmar. No se calculan rutas propias ni tarifas inexistentes. Cada capa mantiene su estado aunque falle otra. |
| **2. Movilidad — parcial** | B: precios de combustible, directorio de recarga, ITV con coordenadas justificadas y enlaces oficiales; OSM para talleres, neumáticos, lavado, asistencia, autocaravanas, parking, peajes, descanso y gas; tráfico SCT y cámaras SCT/Terrassa. F: plazas libres vigentes en Madrid/Vigo. | No hay huecos ITV, reservas de parking, recarga libre en directo, tarifas generales de peajes, ZBE ni tráfico nacional completo. F no confirma gratuidad, apertura, P+R ni plazas PMR libres: PMR es capacidad total. Falta ampliar fuentes y filtros específicos. Cámaras no equivale a vídeo en directo ni cobertura DGT. |
| **3. Transporte — parcial** | B: paradas, estaciones, taxis y servicios de bicicletas; Bizi Zaragoza con bicicletas/anclajes y caducidad individual. C: Metro Bilbao con llegadas estimadas y destinos. | Otras redes siguen siendo directorios. Las llegadas estimadas no son salidas, andenes ni horarios completos de viaje. Cero bicicletas o anclajes no significa estación cerrada; ausencia de llegadas no significa que no haya trenes. |
| **4. Salud — parcial** | B: guardias oficiales separadas de farmacias OSM; hospitales, centros, urgencias etiquetadas, veterinarios, DEA, donación y ascensores. D: catálogo municipal de refugios de Cataluña, con fichas también sin coordenadas. | No se confirman veterinarios/centros 24 h por un horario genérico. Faltan Puntos Violeta y ampliar fuentes verificadas. D no acredita refugios activados ni abiertos. Ascensor no acredita funcionamiento o acceso público. Guardias antiguas/ambiguas y coordenadas no fiables conservan avisos, sin pines ni apertura inventados. |
| **5. Baños, agua y cajeros — parcial** | B: directorio cercano, acceso y gratuidad/accesibilidad cuando constan; exclusión de privados/prohibidos o cerrados explícitos. | Cobertura incompleta, sin clasificación exhaustiva de baños por recinto ni importe si sólo consta que es de pago. Un punto del recinto puede no ser la entrada. Agua potable procede de la etiqueta, no de un análisis de la web. |
| **6. Compras y reciclaje — parcial** | B: supermercados, mercados/mercadillos, correos, taquillas, puntos limpios, reciclaje y ropa. G preparado: recogida de paquetes explícita y filtros de pilas/aceite de cocina. | G no es visible hasta publicar y regenerar con el robot. La cobertura y los horarios dependen de lo registrado; no se atribuye cualquier material a un punto de reciclaje, ni aceite de motor a aceite de cocina. No se inventan calendarios de mercadillos. |
| **7. Servicios públicos — parcial** | B: policía, Guardia Civil, bomberos, oficinas etiquetadas, atención ciudadana, bibliotecas, cultura y wifi explícito. D: salas de estudio y lectura de Madrid con condiciones publicadas. | Falta confirmar oficinas por organismo/trámite (incluido DNI/pasaporte), ampliar territorios y fuentes. Capacidad de una sala no es plaza libre; no hay citas administrativas integradas. Una etiqueta no acredita titularidad municipal. |
| **8. Parques y espacios — directorio básico implementado** | B: parques, infantiles, caninos y áreas de descanso, con acceso/horario/accesibilidad si constan. | Cobertura cartográfica parcial. No se infiere autorización canina de cualquier parque. Estado de juegos, cierres o inventario de equipamiento serían ampliaciones, no requisitos básicos ya acreditados por estas fichas. |
| **9. Turismo, ocio y deporte — parcial** | B: camping, consignas, playas, piscinas y polideportivos; sección deportiva previa conservada. | Faltan banderas, condiciones de baño, socorristas/horarios de vigilancia y disponibilidad comprobable de instalaciones. No se inventan reservas, plazas ni titularidad pública. |
| **11. Personalización — parcial** | B: Google/local, sincronización, municipios/categorías, historial opcional, exportación/vaciado y favoritos OSM/ITV/Bizi. C: favoritos Metro/cámaras y recordatorio ITV Telegram con permiso separado. E: elección entre resumen y sólo bajadas. F: favoritos de aparcamientos. | Faltan favoritos de fichas oficiales D y alertas de disponibilidad. E comprueba por la mañana, no en cada cambio de precio. No se guardan incidencias o turnos temporales. Vaciar ajustes no elimina Google ni revoca todas las sesiones; el calendario requiere importación y Telegram su propio permiso. |
| **12. Monetización — requisitos externos pendientes** | Aportación existente mediante `SUPPORT_URL` sólo si la configura el titular. Funciones útiles independientes de anuncios. | Sin cuentas AdSense ni acuerdos. Publicidad, patrocinio, afiliación, conversiones e ingresos/gastos/rentabilidad requieren alta/acuerdos, datos reales y decisión de medición/privacidad. No hay enlaces comerciales, reservas, rastreadores ni ingresos ficticios. |
| **13. Calidad — parcial** | Móvil, listado accesible, partición, agrupación, fechas, SHA-256, límites, fuentes, robots/reintentos, minimización de datos y pruebas. H distingue cobertura y da accesos a las capas. | Publicación y primer ciclo real de cada entrega; SEO útil por municipio, reporte general de errores y seguimiento de costes/cuotas. Deduplicar IDs no fusiona automáticamente dos objetos del mismo negocio. No se garantiza cuota gratis ilimitada. Los datos legales del titular requieren información real. |

## Actualizaciones automáticas y fallos

Los horarios UTC son los del coordinador de esta base. Una frecuencia de
consulta no garantiza que el proveedor publique datos nuevos con esa frecuencia.

| Datos o función | Cadencia y origen | Tratamiento de antigüedad o fallo |
| --- | --- | --- |
| OSM | Robot diario desde **08:17 UTC**, España/Canarias y límite IGN. Reutiliza una copia sólo con extracto, límites y huella del productor compatibles; un cambio de catálogo fuerza regeneración. | Sin truncado silencioso; integridad y pérdida máxima de cobertura controladas. Más de 30 h sin comprobar o extracto de más de 72 h: antiguo, sin afirmar apertura. Conserva copia válida y fecha original. |
| Combustible y recarga | Precios **07:00/19:00 UTC**, recarga **05:15 UTC**. E prepara comparación particionada desde capturas oficiales de precios. | Recarga no mide conectores libres. Reintentar precios no convierte una captura en nueva ni inventa una referencia anterior. |
| Guardias, ITV y política | **05:45**, **04:17** y **04:20 UTC**, respectivamente. | Fechas propias; regenerar el catálogo ITV no rejuvenece coordenadas/citas. La capa de guardias lee fuentes existentes y retira turnos al vencer, también con red pendiente o pestaña suspendida. |
| Tiempo y deportes | Cada **3 h** y **1 h**, respectivamente. | Avisos y última copia válida; no declara renovada una fuente inaccesible. |
| Bizi Zaragoza | Bajo demanda; vista cada minuto, caché de estado 30 s. | Máximo 5 min por estación y parte; al caducar o fallar la comprobación se retiran cifras. Cero es válido. |
| Tráfico SCT y cámaras | SCT: vista cada minuto/caché 60 s. Catálogo de cámaras: bajo demanda/caché 1 h. | Parte SCT: 10 min; se retira sin afirmar carretera libre. Catálogo de cámaras: aviso tras 30 h; nunca se convierte su fecha en hora de imagen. |
| C: Metro Bilbao | Catálogo diario **08:47 UTC**; llegadas visibles cada 30 s. | Llegadas válidas como máximo 2 min. Catálogo y calendario de servicio se verifican; un fallo no se presenta como ausencia de trenes. |
| D: directorios públicos | Robot diario **08:57 UTC**, fuentes independientes y reintento separado 4 h. | Conserva exactamente la fuente que falla, fecha de archivo y aviso. Consulta diaria no demuestra activación de refugios, apertura ni plazas libres. |
| F: aparcamientos | Catálogo diario **09:07 UTC**, reintento 4 h. Ocupación bajo demanda, caché/vista visible 60 s. | Plazo por fila: Madrid 5 min, Vigo 6 min. Se retiran cifras caducadas o no comprobadas; la copia diaria sólo contiene catálogo, no ocupación. |
| CartoCiudad | Sólo al enviar el formulario; el visitante elige el resultado. | Error explicativo y alternativa municipal; no se guarda dirección/GPS ni se selecciona la primera coincidencia a ciegas. |
| E: precios Telegram | Revisión diaria **08:00–11:59 Europe/Madrid**, sin cambiar el modo de los suscriptores existentes. | Resumen o bajada elegida con umbral. Fechas y parejas oficiales válidas, preparación acotada, recibos y reintentos. Dry-run no envía ni modifica datos; entregas inciertas no se repiten a ciegas. |
| C: ITV Telegram | Comprobación cada hora dentro de **08:00–11:59 Europe/Madrid**, independiente de otras fuentes. | Fecha del visitante y permiso específico; avisos 7/1 días antes. Sin inventar aviso el día de caducidad ni prometer una franja ya pasada. Dry-run sin envío/escritura. |
| G: categorías nuevas | Reutiliza el robot OSM y su huella de productor tras publicar G. | No retoca ni rejuvenece snapshots antiguos. No permite anunciar cobertura hasta que la extracción completa se haya validado. |

Los relojes de las cifras usan fecha de fuente, evaluación del servidor y tiempo
transcurrido desde antes de la petición. Esperar la red, atrasar el reloj o
volver a una pestaña no prolonga su vigencia. Estos mecanismos evitan editar
datos a diario, pero no garantizan que una fuente externa nunca falle.

## Cuenta, identidad y fuentes caducadas

Los favoritos sólo conservan `{id,nombre,categoria,lat,lon}` del lugar público.
Inicio/Mi día no muestran como actuales horarios, precios, imágenes, llegadas
o stock guardados. Abrir una ficha vuelve a consultar al proveedor; un ID
ausente no se reconstruye desde el favorito ni se borra automáticamente.

OSM e ITV comprueban su zona/identidad. Bizi, Metro, cámaras y aparcamientos
consultan su catálogo actual y validan identidad/coordenadas. Un cambio de
partición OSM puede devolver 409 y pedir reabrir; un traslado fuera de la zona
o desaparición puede devolver 404. No hay búsqueda global de IDs trasladados.

Cada proveedor admite sólo su namespace y categoría. Incidencias y turnos de
guardia no son favoritos estables; D admite preferencias de capa, todavía no
favoritos de sus fichas. Guardar un municipio no guarda domicilio o GPS.

El historial es local, opcional, separado por cuenta y limitado a 20 consultas
de 30 días; desactivarlo borra sus entradas. Exportar/vaciar ajustes no cancela
Telegram ni un calendario importado, no borra la identidad Google ni todas sus
sesiones. KV eventual y Telegram no forman una transacción: no se promete
entrega exactamente una vez ni cancelación instantánea.

## Evidencia y siguientes cortes

Contratos, ensayos reales fechados, escenarios simulados y límites:

- [Validación del mapa y caducidad](servicios-validacion.md).
- [Cuenta y preferencias](servicios-cuenta.md).
- [ITV Telegram](telegram-itv.md) y [Metro Bilbao](transporte.md).
- [Directorios públicos D](servicios-publicos.md).
- [Comparación y avisos de precios E](telegram-precios.md).
- [Aparcamientos F](aparcamientos-oficiales.md).

G se revisó en su rama independiente mediante
`docs/servicios-paquetes-reciclaje.md`; ese archivo y su código no forman parte
de esta base F. No se suman pruebas repetidas ni ensayos de fases distintas para
fabricar un total de cobertura.

Cortes posteriores implementables sin nuevas cuentas: filtros de plazas libres
vigentes y existencia de capacidad PMR publicada (sin llamarla PMR libre),
favoritos D con identidad comprobada y páginas útiles «cerca de» un municipio
con radio/centro explícitos. Una consulta radial no autoriza a decir «en el
municipio» ni a crear páginas vacías. Otras redes, ZBE, banderas o alertas de
disponibilidad requieren verificar primero la fuente y su cadencia. La
monetización depende de decisiones y datos del titular, no de fabricar interfaz.

H se comprobó sobre su compilación local: seis pruebas dirigidas, TypeScript y
build correctos; cuatro recorridos de navegador (320, 390 y 1280 px, más
búsqueda municipal sin JavaScript). Sin desbordamiento ni errores JavaScript,
y sin incidencias de axe en el contenido revisado. Se inspeccionaron las
capturas de móvil y escritorio. La revisión independiente cotejó los diez
enlaces con las rutas de la base F y las cadencias con el coordinador. No se
consultaron proveedores adicionales para decorar las tarjetas ni se enviaron
mensajes. Esta evidencia no sustituye el despliegue de C–F: H debe publicarse
después de las entregas de las que dependen sus accesos.
