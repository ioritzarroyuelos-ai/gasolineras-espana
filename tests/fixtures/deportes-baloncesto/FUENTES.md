# Muestras mínimas de respuestas oficiales

Descargadas el 7 de noviembre de 2026. Se conservan solo campos usados por los analizadores; las muestras no son datos de producción.

- ACB: https://acb.com/es/liga/calendario y https://acb.com/es/liga/clasificacion
- NBA: https://www.nba.com/games?date=2026-11-07
- FEB: consulta pública de calendario usada por https://beta.competiciones.feb.es/tercera-feb/partidos (1–7 noviembre de 2026).
- Campeonato junior masculino: https://baloncestoenvivo.feb.es/resultados.aspx?g=21&t=2025&nm=cespclubesjrmasc (final y clasificación final de 2025/2026).
- Europa: https://api-live.euroleague.net/v2/competitions/E/seasons , https://api-live.euroleague.net/v2/competitions/E/seasons/E2026/games y https://api-live.euroleague.net/v3/competitions/E/seasons/E2026/rounds/10/basicstandings . Las muestras recortan partidos y temporadas sin alterar sus campos.
- FIBA: datos JSON públicos de https://www.championsleague.basketball/en, recortados a un grupo y un partido aún sin participantes ni fecha. Se conserva la estructura de publicación React; no se ejecutan sus scripts.
- Bizkaia: respuesta pública del grupo 2830 enlazado desde https://bizkaiabasket.com/es/pagina-de-grupo/?id=2830, recortada a dos partidos y filas de clasificación. Las pruebas comprueban identidad de grupo/temporada, visibilidad, marcadores futuros y fallos parciales. No contiene actas ni fichas personales.
- Gesdeportiva: recortes del calendario y clasificación mostrados por https://www.fbm.es/es/horarios-y-resultados, https://www.fbpa.es/, https://www.fbrm.org/, https://www.fexb.es/, https://gesdeportiva.fcbaloncesto.es/competiciones-6/FederacionCanaria y https://gesdeportiva.melillensebaloncesto.es/competiciones-15/melillense. Se han retirado los campos de sesión de los formularios. Los datos codificados se leen como texto/JSON, sin ejecutar código de la fuente.
- NBA clasificación: https://stats.nba.com/stats/leaguestandingsv3?LeagueID=00&Season=2026-27&SeasonType=Regular+Season . Se conservan los 30 equipos y los campos de identidad, posición y resultados utilizados.
- WNBA: https://www.wnba.com/schedule, https://www.wnba.com/standings y https://www.wnba.com/api/schedule?season=2026&regionId=1 . Las muestras de páginas contienen solo los datos públicos necesarios; la muestra de partidos conserva un día del calendario.
- Álava: https://www.basketaraba.com/es/fab-online/calendario-y-resultados-federacion-alavesa-de-baloncesto y los enlaces del grupo 0101 (seccion=2 para calendario, seccion=0 en la página de clasificaciones). Las fechas de cabecera son fechas nominales de jornada, no fechas individuales de los encuentros.
- Aragón: selector público y resultados del grupo 90202, categoría 24136, delegación de Zaragoza, en https://competiciones.feb.es/autonomicas/Resultados.aspx?a=32&c=24136 . Se seleccionó el grupo mediante el formulario publicado. Los valores ocultos del formulario de la muestra son textos de prueba, no sesiones guardadas.
- Galicia: https://fegaba.com/resultados-e-clasificacions/ y su iframe público de Gesdeportiva, calendario de la fase 4501/grupo 9590 y clasificación del mismo grupo. El lector envía la referencia normal del sitio que contiene el visor. No se leen actas ni estadísticas personales.
