Fragmentos mínimos de datos públicos oficiales descargados el 7 de noviembre de 2026. Se conservaron dos equipos o partidos, salvo los tres partidos necesarios para distinguir marcador final, cero inicial y marcador ausente. No son datos de producción.

- `laliga-agenda.json`: https://www.laliga.com/laliga-easports/resultados (`__NEXT_DATA__`, sin publicidad ni apuestas).
- `laliga-clasificacion.json`: https://www.laliga.com/laliga-easports/clasificacion (tabla general).
- `futsal-jornada.json`: formulario público `https://futsal.rfef.es/futsal_xhr/get_matchs_round`, category=30, league=1299, round=7, year=2027, group=1, action=competicion.
- `futsal-clasificacion.html`: https://futsal.rfef.es/competicion/primera-femenina/2027/clasificacion (dos filas de la tabla).
- `ffcv-finalizados.json`, `ffcv-pendientes.json`: consulta pública `https://ffcv.es/competiciones/api/partidos/resultados_por_grupo_jornada_data.php`, temporada=22, competición=905431604, grupo=905431605, jornadas 9 y 10. Dos partidos por jornada; sin cookies ni identificación de sesión.
- `ffcv-clasificacion.json`: consulta pública `https://ffcv.es/competiciones/api/clasificaciones/clasificaciones_ajax.php`, grupo=905431605 y jornada=10. La respuesta identifica jornada 9 como última disputada; dos filas.
- `rfef-primera-femenina.html`: https://rfef.es/es/resultados?competition=33836144&group=33836145, un partido y selector de grupo de la jornada 6.

Los fragmentos de `novanet/` se descargaron también el 7 de noviembre de 2026 mediante consultas públicas. No guardan cookies ni credenciales. Conservan los elementos necesarios para comprobar cifras visibles frente a dígitos ocultos, columnas opcionales, idioma y tablas anidadas.

- `catalogo.html`, `grupos.html`, `jornadas.html`: catálogo público y selectores `NFG_CmpJornada` / `NFG_CmpJornada_Exec` de https://marcadores.rfef.es/pnfg/NPcd/ ; competición33836091, grupo33836092, temporada22.
- `segunda-jornada-9.html`, `segunda-clasificacion.html`: jornada9 de ese grupo. Sus nueve marcadores visuales se contrastan con la tabla de resultados independiente de `NFG_VisClasificacion`.
- `asturias-tabla.html`: https://www.asturfutbol.es/pnfg/NPcd/NFG_VisClasificacion?cod_primaria=1000120&codcompeticion=22880342&codgrupo=22922739&codjornada=10 ; tabla con columna adicional de coeficiente.
- `euskadi-tabla.html`: https://www.euskadifutbol.eus/pnfg/NPcd/NFG_VisClasificacion?cod_primaria=1000120&codcompeticion=24675380&codgrupo=24675438&codjornada=11 ; encabezados en euskera.
- `galicia-final.html`: https://www.futgal.es/pnfg/NPcd/NFG_CmpJornada?cod_primaria=1000120&CodCompeticion=27103570&CodGrupo=27103619&CodTemporada=22&CodJornada=4 ; final anidada y etiqueta de ganador separada del nombre.
- `melilla-jornada.html`: https://www.rfmf.es/pnfg/NPcd/NFG_CmpJornada?cod_primaria=1000120&CodCompeticion=22028332&CodGrupo=22028333&CodTemporada=22&CodJornada=1 ; un partido dentro de otra tabla de presentación.
- `madrid-agenda.json`: https://www.rffm.es/api/results?idGroup=26738227&round=9 ; dos partidos, sin nombres de árbitros ni imágenes.
- `madrid-tabla.html`: datos públicos incluidos en https://www.rffm.es/competicion/clasificaciones?temporada=22&competicion=26738226&grupo=26738227&tipojuego=1 ; dos filas y la temporada que identifica la página.
- `las-palmas-agenda.html`, `las-palmas-tabla.html`: https://www.fiflp.com/pnfg/NPcd/NFG_CmpJornada?cod_primaria=1000120&CodCompeticion=54977176&CodGrupo=55103366&CodTemporada=22&CodJornada=3 y su `NFG_VisClasificacion` de jornada 3. Los cinco marcadores se contrastan entre ambas páginas; la prueba detecta la cifra visual8 cuyo identificador inicial contiene11, ignorando ese texto oculto.
