#!/usr/bin/env python3
"""Extrae geometrías de servicios sin cargar el PBF nacional en memoria.

Dependencias del robot: osmium 4.3.2 y shapely 2.2.0. No se ejecuta en la web.
Primero filtra etiquetas con libosmium; BackReferenceWriter conserva los nodos
necesarios. La segunda pasada convierte recintos en un punto interior, que NO
se presenta como una entrada exacta. No publica datos ni consulta la red.
"""
import argparse
import json
from pathlib import Path
import sys
import tempfile
import osmium
from shapely import from_wkb, prepare, STRtree
from shapely.geometry import shape, Point


def administrative_boundary(source):
    """Las cajas Geofabrik llevan buffer: se filtra por las 19 autonomías IGN.

    El grupo IGN «Territorios no asociados» incluye Gibraltar y no se usa para
    afirmar que un servicio esté bajo administración española.
    """
    if Path(source).stat().st_size > 200 * 1024 * 1024:
        raise ValueError("Geometría territorial demasiado grande")
    data = json.loads(Path(source).read_text(encoding="utf-8"))
    features = data.get("features", [])
    if data.get("type") != "FeatureCollection" or len(features) not in (19, 20) or data.get("numberMatched") != len(features) or data.get("numberReturned") != len(features) or any(link.get("rel") == "next" for link in data.get("links", [])):
        raise ValueError("Límite administrativo incompleto")
    expected = {f"34{code:02d}0000000" for code in range(1, 20)}
    found, geometries = set(), []
    for feature in features:
        props = feature.get("properties", {})
        code = props.get("nationalcode")
        if props.get("country") != "ES" or props.get("nationallevel") != "https://inspire.ec.europa.eu/codelist/AdministrativeHierarchyLevel/2ndOrder":
            raise ValueError("Nivel administrativo inesperado")
        if code == "34200000000":
            continue
        if code not in expected or code in found:
            raise ValueError("Administración territorial duplicada o inesperada")
        geom = shape(feature["geometry"])
        if geom.geom_type not in ("Polygon", "MultiPolygon") or geom.is_empty or not geom.is_valid:
            raise ValueError("Geometría territorial inválida")
        prepare(geom)
        geometries.append(geom)
        found.add(code)
    if found != expected:
        raise ValueError("Faltan comunidades o ciudades autónomas")
    tree = STRtree(geometries)

    def covers(lon, lat):
        point = Point(lon, lat)
        return any(geometries[i].covers(point) for i in tree.query(point))
    # Prueba de coherencia geográfica: no acepta otra CRS ni un país equivocado.
    if not all(covers(lon, lat) for lon, lat in [(-3.7038, 40.4168), (-5.319, 35.889), (-2.938, 35.292), (-15.43, 28.1248)]) or any(covers(lon, lat) for lon, lat in [(-5.35, 36.14), (-1.774, 43.358), (1.5218, 42.5075), (-8.838, 41.878)]):
        raise ValueError("Límite territorial incoherente")
    return covers


def extract(source, destination, filters_file, boundary_file):
    inside_country = administrative_boundary(boundary_file)
    filters = json.loads(Path(filters_file).read_text(encoding="utf-8"))
    if not isinstance(filters, list) or not filters or len(filters) > 250:
        raise ValueError("Lista de filtros inválida")
    if any(not isinstance(x, list) or len(x) != 2 or not all(isinstance(s, str) and 0 < len(s) < 100 for s in x) for x in filters):
        raise ValueError("Filtro inválido")
    with osmium.io.Reader(str(source)) as reader:
        header = reader.header()
        timestamp = header.get("osmosis_replication_timestamp")
    if not timestamp:
        raise ValueError("El extracto no declara su fecha original")
    selected = {"n": set(), "w": set(), "r": set()}
    stats = {"candidatos": 0, "geometriasInvalidas": 0, "relacionesNoPoligonales": 0, "exportados": 0, "fueraTerritorio": 0}
    geometry = osmium.geom.WKBFactory()
    Path(destination).parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="osm-servicios-", dir=Path(destination).parent) as temporary:
        filtered = Path(temporary) / "selected.osm.pbf"
        processor = osmium.FileProcessor(str(source)).with_filter(osmium.filter.TagFilter(*[tuple(x) for x in filters]))
        with osmium.BackReferenceWriter(str(filtered), ref_src=str(source), remove_tags=True) as writer:
            for obj in processor:
                if obj.id <= 0:
                    continue
                kind = obj.type_str()
                if obj.tags.get("access") in ("no", "private", "permit", "military"):
                    continue
                # España tiene muchas piscinas particulares. No hace falta
                # reconstruir recintos sin ninguna etiqueta de uso público.
                if obj.tags.get("leisure") == "swimming_pool" and obj.tags.get("amenity") != "public_bath" and obj.tags.get("access") not in ("yes", "permissive") and obj.tags.get("operator:type") != "public" and obj.tags.get("ownership") != "municipal":
                    continue
                if kind == "r" and obj.tags.get("type") not in ("multipolygon", "boundary"):
                    stats["relacionesNoPoligonales"] += 1
                    continue
                selected[kind].add(obj.id)
                writer.add(obj)
                stats["candidatos"] += 1
                if stats["candidatos"] > 1500000:
                    raise ValueError("Demasiados candidatos; no se publica un extracto truncado")
        emitted = set()
        processor = osmium.FileProcessor(str(filtered)).with_locations().with_areas()
        with Path(destination).open("w", encoding="utf-8", newline="\n") as output:
            for obj in processor:
                try:
                    if obj.is_node():
                        kind, identifier = "n", obj.id
                        if identifier not in selected[kind]:
                            continue
                        if not obj.location.valid():
                            raise ValueError("Nodo sin coordenadas")
                        lon, lat = obj.lon, obj.lat
                    elif obj.is_way():
                        kind, identifier = "w", obj.id
                        if identifier not in selected[kind]:
                            continue
                        if obj.is_closed() and len(obj.nodes) >= 4 and obj.tags.get("area") != "no":
                            continue  # Se emite como área, una sola vez.
                        geom = from_wkb(geometry.create_linestring(obj))
                        if not geom.is_valid or geom.is_empty:
                            raise ValueError("Línea inválida")
                        point = geom.representative_point()
                        lon, lat = point.x, point.y
                    elif obj.is_area():
                        kind, identifier = ("w" if obj.from_way() else "r"), obj.orig_id()
                        if identifier not in selected[kind] or (kind, identifier) in emitted:
                            continue
                        geom = from_wkb(geometry.create_multipolygon(obj))
                        if not geom.is_valid or geom.is_empty:
                            raise ValueError("Recinto inválido")
                        point = geom.representative_point()
                        lon, lat = point.x, point.y
                    else:
                        continue
                    if (kind, identifier) in emitted:
                        continue
                    if not inside_country(lon, lat):
                        emitted.add((kind, identifier))
                        stats["fueraTerritorio"] += 1
                        continue
                    row = {"type": {"n":"node", "w":"way", "r":"relation"}[kind], "id": str(identifier),
                           "lat": lat, "lon": lon, "tags": dict(obj.tags),
                           "timestamp": obj.timestamp.isoformat().replace("+00:00", "Z")}
                    serialized = json.dumps(row, ensure_ascii=True, separators=(",", ":"))
                    if len(serialized.encode("utf-8")) > 64000:
                        raise ValueError("Registro demasiado grande")
                    output.write(serialized + "\n")
                    emitted.add((kind, identifier))
                    stats["exportados"] += 1
                except (ValueError, RuntimeError, osmium.InvalidLocationError):
                    stats["geometriasInvalidas"] += 1
        # Las áreas que no se pudieron ensamblar tampoco se sustituyen por un
        # centroide inventado o por una coordenada de otra entidad.
        stats["sinGeometria"] = stats["candidatos"] - len(emitted)
    return {"fechaDatos": timestamp, **stats}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--filters", required=True)
    parser.add_argument("--boundary", required=True)
    args = parser.parse_args()
    try:
        print(json.dumps(extract(Path(args.input), Path(args.output), Path(args.filters), Path(args.boundary)), ensure_ascii=False))
    except Exception as error:
        print("No se pudo validar el extracto OSM: " + str(error), file=sys.stderr)
        sys.exit(1)
