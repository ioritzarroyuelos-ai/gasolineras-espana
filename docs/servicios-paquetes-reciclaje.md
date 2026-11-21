# Recogida de paquetes y materiales de reciclaje

La categoría de recogida no estaba detectando los comercios que publican el
servicio mediante `post_office:parcel_pickup=yes`. El prefiltro y la clasificación
utilizan ahora esa etiqueta. No se presupone recogida por ser una oficina postal,
un comercio colaborador o un lugar de envío. Se retira la asociación no verificada
con `shop=parcel`, que no aportaba resultados al extracto revisado.

También se pueden elegir por separado pilas domésticas y aceite de cocina. Se
requiere `amenity=recycling` y la aceptación expresa del material. Una batería de
coche no cuenta como pila doméstica; el aceite de motor no cuenta como aceite de
cocina. Las condiciones ambiguas no activan estas categorías. Permanecen los
controles de acceso privado, fechas, geometría, deduplicación e integridad.

Documentación de la fuente:

- [Recogida de paquetes](https://wiki.openstreetmap.org/wiki/Key:post_office:parcel_pickup).
- [Materiales aceptados para reciclaje](https://wiki.openstreetmap.org/wiki/Key:recycling:*).

## Comprobación con datos reales

Se ha ejecutado el extractor del proyecto sobre los PBF de España y Canarias
fechados el **19 de noviembre de 2026 a las 21:22:20 UTC**, disponibles en el
ensayo local. No son cifras de todo el mercado ni establecimientos inspeccionados.
El filtro territorial del IGN excluyó tres puntos fuera de España; el normalizador
descartó otros diez registros que no cumplían sus condiciones.

| Categoría | Lugares identificados en ese extracto |
| --- | ---: |
| Recogida de paquetes | 14 |
| Reciclaje de pilas domésticas | 1.418 |
| Reciclaje de aceite de cocina | 1.291 |

Un lugar puede aceptar más de un material. Estos recuentos se solapan y no se
suman como si fueran establecimientos distintos. Se conservan la fecha original
de edición y el enlace de cada objeto OSM. No se infieren apertura, gratuidad,
transportistas admitidos, capacidad restante ni recogida de cualquier residuo.

## Actualización y publicación

No hay un robot adicional: se utiliza la descarga nacional diaria existente.
La huella del productor incluye el catálogo, por lo que el cambio obliga a
regenerar los datos aunque Geofabrik publique el mismo extracto. Primero debe
publicarse el código y después ejecutarse el robot; las versiones anteriores
no conocen las dos categorías nuevas. Ningún snapshot se edita ni se incorpora
manualmente en este cambio.

Las pruebas verifican clasificación, prefiltro, condiciones ambiguas, rechazo
de lugares privados y aceptación por el validador compartido con la API.
