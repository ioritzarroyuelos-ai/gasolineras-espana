# Validación de servicios cercanos — paquete B

Comprobación final del árbol de publicación B: compilación y tipos correctos;
**55 pruebas de navegador aprobadas** el 21/11/2026, con cuenta, mapa,
guardias, ITV, bicicletas, tráfico, cámaras, relojes desfasados y respuestas tardías.

Revisión local del **21 de noviembre de 2026**. Este documento describe pruebas
realizadas y sus límites; no sustituye la comprobación del despliegue ni del
primer ciclo automático publicado. El alcance completo y los pendientes por
bloque están en [servicios-alcance.md](servicios-alcance.md).

## Datos reales comprobados

- **Directorio OSM:** 577.770 identificadores únicos, de ellos 30.489 en Canarias;
  2.269 hojas JSON, 186.862.987 bytes y hoja máxima de 477.793 bytes. Hay datos
  en 53 de las 58 categorías previstas. La comprobación de la copia ocurrió el
  20/11/2026 a las 23:58:01 UTC; el extracto más antiguo es del 19/11 a las
  21:22:20 UTC. La geometría territorial IGN se aplica a los puntos; una caja
  geográfica amplia no demuestra pertenencia a España.
- **ITV:** 571 estaciones en el catálogo revisado, 99 con coordenadas admitidas,
  472 conservadas sin pin, 55 de las situadas con enlace de cita y 10 con fecha
  antigua de comprobación de coordenadas señalada. No se verificó una reserva.
- **Bizi Zaragoza:** consulta del 20/11/2026 a las 23:56:21 UTC, 276 estaciones.
  Las cifras de bicicletas y anclajes pertenecen sólo a aquella consulta.
- **SCT:** consulta del 21/11/2026 a las 00:03:49 UTC, 195 incidencias, 175 con
  punto de referencia y 20 sólo en el listado. La antigüedad de una obra no se
  confunde con la fecha del parte en el que todavía aparece.
- **Cámaras:** consulta del 21/11/2026 a las 00:20:43 UTC, 36 cámaras españolas
  únicas, 35 SCT y una Terrassa. Se excluyeron una de Andorra y una repetición
  exacta. Las 36 direcciones respondieron a HEAD; no se descargaron imágenes.
  Esto no acredita su hora, calidad, reproducción ni disponibilidad futura.
- **Guardias:** se revisaron 47 copias, 423.967 bytes en total. Once archivos
  declaran coordenadas nativas y cubren 15 provincias. Los lectores existentes
  admitieron 292 puntos en 144 zonas a las 00:31:56 UTC del 21/11; 284 turnos
  estaban activos entonces. El servicio por zona necesita como máximo cinco
  archivos; la combinación real mayor fue de 82.785 bytes. Sólo se sitúa un
  registro cuando el lector declara `coordenadasFiables === true`.

Las cifras anteriores son evidencia histórica de integración, no información
vigente para desplazarse. No prueban cobertura de cada municipio ni que todos
los locales hayan sido revisados en la fecha de descarga.

## Escenarios automatizados y visuales

| Comprobación | Resultado y alcance |
| --- | --- |
| Lectores y capa de guardias | 65 pruebas dirigidas aprobadas: 35 de la capa nueva y 30 de lectores/horarios existentes. Se conserva la distinción entre turno activo, localizado, horario por confirmar y fuera de horario. No se transforma apertura ordinaria en guardia. |
| Mapa: guardias, ITV/Bizi y tráfico/cámaras | Una ejecución conjunta aprobó 21 E2E: 8 guardias, 6 servicios oficiales y 7 tráfico. Incluye caducidad, respuestas tardías, fallos, retorno de pestaña, ausencia de favoritos de eventos y conservación de otras capas. Las API son simuladas en estos casos. |
| Web con guardias reales | Madrid y Almería, 1280 y 320 px: sin desbordamiento horizontal, sin errores JavaScript y sin violaciones de axe en el área comprobada. Madrid mostró cuatro guardias en la vista. Almería mostró el aviso de copia del 12/11 sin pines, conservando enlaces y explicación del horario ambiguo. |
| Cuenta/autenticación | El equipo aprobó 118 pruebas dirigidas tras admitir preferencias SCT/guardias/Metro. Los favoritos sólo guardan identidad, nombre, categoría y coordenadas públicas, sin stock, horarios o GPS del visitante. Las pruebas no abren una sesión Google real nueva. |
| Caducidad y evaluación de respuesta | 106 pruebas unitarias dirigidas aprobadas en `servicios-ui`, `bicis-gbfs` y `trafico-sct`. Incluyen fecha futura, caché de fuente, plazo exacto, reloj atrasado o adelantado, modificación del reloj y descuento del tiempo de red. |
| Página completa de tráfico | 10 E2E aprobadas: escritorio y móvil a 1280/390/320 px con axe, refresco, caída, pestaña oculta y cuatro casos de reloj/red. El caso SSR retrasa realmente el HTML 3,5 s con Date.now atrasado 2 min y mantiene performance nativo. La respuesta AJAX vencida se oculta al llegar. |

Los conjuntos se solapan con pruebas anteriores: **no deben sumarse como un
total de casos únicos**. Los tests de fuentes artificiales prueban reglas y
errores controlados; las consultas reales prueban integración de una muestra
temporal. Ni unos ni otras garantizan que un tercero nunca falle.

## Corrección de caducidad encontrada durante la revisión

Bizi y SCT podían conservar una afirmación de actualidad demasiado tiempo con
el reloj del dispositivo atrasado y una respuesta lenta. La respuesta API añade
ahora `evaluadoEn`, calculado al responder, sin modificar `consultado`, la fecha
del parte ni la última comunicación de una estación procedentes de caché.

El cliente calcula un plazo con el tiempo del servidor y con `performance.now`,
anclado **antes** de la petición. También conserva un límite de fecha absoluto
conservador. La llegada de la respuesta no inicia de nuevo el plazo. En el HTML
inicial de tráfico el anclaje es el inicio de la navegación, no el momento en
que termina de cargar el script. Las API no se almacenan en caché HTTP del
visitante; se mantienen las cachés acotadas de las fuentes para evitar consultas
innecesarias. Un parte con fecha de publicación posterior a la evaluación no
se acepta como actual.

Las guardias se retiran al vencer su evaluación y antes de refrescar al volver
a una pestaña suspendida. «Localizada» no significa farmacia abierta sin
contacto previo. Un comienzo y final iguales en Almería no demuestran 24 h.

## Límites y verificaciones pendientes

- El directorio OSM se actualiza diariamente sin edición manual, pero su fecha
  de descarga no renueva la fecha de edición de cada lugar. El robot conserva
  la última copia válida cuando falla la nueva y rechaza pérdidas regionales
  superiores al 30 %, fechas inaceptables y archivos desbordados.
- El filtro de horario interpreta sólo reglas explícitas simples. Festivos,
  citas, reglas solares o texto ambiguo quedan sin confirmar. No certifica una
  apertura real ni urgencias, acceso público o potabilidad sin etiqueta expresa.
- Guardias sin coordenadas fiables conservan información y enlaces a su ficha
  oficial, sin situarlas en el centro del pueblo. Una consulta reciente no
  convierte en vigente una guardia de otra fecha.
- No hay vídeo de cámaras verificado, tráfico nacional, plazas ITV libres,
  disponibilidad universal de aparcamientos o reservas comerciales integradas.
- El paquete B no incluye la ampliación de transporte Metro Bilbao ni los
  recordatorios ITV por Telegram del paquete C. La investigación posterior de
  refugios climáticos y salas de estudio tampoco cuenta como cobertura B.
- Quedan por consignar la comprobación de producción y el primer ciclo real
  del robot nuevo. No se han enviado mensajes de prueba a terceros, contratado
  servicios, realizado reservas ni creado acuerdos publicitarios en estas pruebas.
