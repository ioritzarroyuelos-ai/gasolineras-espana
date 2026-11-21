# Filtros de aparcamientos oficiales

La capa de Madrid/Vigo permite filtrar por plazas libres confirmadas y por
existencia de plazas reservadas para movilidad reducida (PMR). El segundo filtro
comprueba capacidad publicada; no conoce cuántas plazas PMR están libres.

La disponibilidad exige una cifra positiva y vigente. Cero, ausencia, caducidad
o fallo de fuente quedan fuera. Las cifras se retiran al vencer antes de esperar
otra consulta, también si el filtro estaba activo. Desmarcarlo permite consultar
las fichas sin disponibilidad confirmada.

Estos filtros afectan sólo a los aparcamientos oficiales seleccionados, no a
otros servicios ni al listado de favoritos guardados. No guardan cifras ni
coordenadas personales y reutilizan los mismos plazos y actualización de la capa.
Son filtros de consulta; no reservan una plaza ni confirman apertura o gratuidad.
