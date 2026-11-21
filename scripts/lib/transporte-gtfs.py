"""Extrae sólo el catálogo necesario del GTFS oficial de Metro Bilbao.

No extrae archivos ZIP al disco. Los tamaños se comprueban antes de abrirlos y
zipfile verifica CRC al leer. La salida por stdout no contiene el horario entero.
"""
import csv
import datetime as dt
import io
import json
import math
import re
import sys
import zipfile


def require(condition, message):
    if not condition:
        raise ValueError(message)


def extract(raw):
    require(0 < len(raw) <= 10_000_000, 'Tamaño GTFS fuera del límite')
    z = zipfile.ZipFile(io.BytesIO(raw))
    info = z.infolist()
    require(len(info) <= 40 and len({x.filename for x in info}) == len(info), 'ZIP ambiguo')
    require(sum(x.file_size for x in info) <= 25_000_000, 'GTFS descomprimido demasiado grande')
    require(all('/' not in x.filename and '\\' not in x.filename and not x.flag_bits & 1 for x in info), 'ZIP no admitido')

    def rows(name, limit, maxbytes):
        require(name in z.namelist(), 'Falta ' + name)
        require(z.getinfo(name).file_size <= maxbytes, 'Archivo GTFS demasiado grande')
        text = z.read(name).decode('utf-8-sig', errors='strict')
        parsed = list(csv.DictReader(io.StringIO(text)))
        require(0 < len(parsed) <= limit, 'Número de registros GTFS fuera del límite')
        require(all(None not in row and all(v is not None for v in row.values()) for row in parsed), 'CSV incompleto')
        return parsed

    def string(value, maxlen=150):
        value = value.strip()
        require(0 < len(value) <= maxlen and not any(ord(c) < 32 for c in value), 'Texto GTFS inválido')
        return value

    def ident(value):
        require(re.fullmatch(r'[A-Za-z0-9_.-]{1,100}', value) is not None, 'Identificador GTFS inválido')
        return value

    def day(value):
        require(re.fullmatch(r'20\d{6}', value) is not None, 'Fecha GTFS inválida')
        dt.datetime.strptime(value, '%Y%m%d')
        return value

    all_stops = rows('stops.txt', 1000, 250_000)
    require(len({x['stop_id'] for x in all_stops}) == len(all_stops), 'Parada duplicada')
    stations = {}
    for row in all_stops:
        if row.get('location_type') != '1':
            continue
        station_id = ident(row['stop_id'])
        lat, lon = float(row['stop_lat']), float(row['stop_lon'])
        require(math.isfinite(lat) and math.isfinite(lon) and 43.1 <= lat <= 43.5 and -3.2 <= lon <= -2.7, 'Coordenadas fuera de la red')
        stations[station_id] = {'id': 'metro-bilbao-' + station_id, 'nombre': string(row['stop_name']), 'lat': lat, 'lon': lon}
    require(1 <= len(stations) <= 100, 'No hay estaciones verificadas')
    stops = {}
    for row in all_stops:
        if row.get('location_type', '0') not in ('', '0'):
            continue
        parent = row.get('parent_station', '')
        require(parent in stations, 'Parada sin estación padre')
        stops[ident(row['stop_id'])] = parent
    require(len(stops) > 0, 'No hay paradas verificadas')
    routes = rows('routes.txt', 10, 20_000)
    require(len(routes) == 1 and routes[0]['route_id'] == 'MB' and routes[0]['route_type'] == '1', 'Red distinta de Metro Bilbao')
    services = {}
    for row in rows('calendar.txt', 100, 100_000):
        key = ident(row['service_id'])
        require(key not in services, 'Calendario repetido')
        days = [row[x] for x in ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']]
        require(all(x in ('0', '1') for x in days), 'Días de servicio inválidos')
        start, end = day(row['start_date']), day(row['end_date'])
        require(start <= end, 'Calendario invertido')
        services[key] = {'inicio': start, 'fin': end, 'dias': ''.join(days), 'excepciones': {}}
    for row in rows('calendar_dates.txt', 2000, 250_000):
        key, date, kind = ident(row['service_id']), day(row['date']), row['exception_type']
        require(kind in ('1', '2'), 'Excepción inválida')
        if key not in services:
            services[key] = {'inicio': None, 'fin': None, 'dias': '0000000', 'excepciones': {}}
        require(date not in services[key]['excepciones'], 'Excepción duplicada')
        services[key]['excepciones'][date] = int(kind)
    trips = {}
    for row in rows('trips.txt', 20_000, 2_000_000):
        key, service = ident(row['trip_id']), ident(row['service_id'])
        require(row['route_id'] == 'MB' and key not in trips and service in services, 'Viaje sin calendario verificable')
        trips[key] = {'destino': string(row['trip_headsign']), 'servicio': service}
    require(len(trips) > 0, 'No hay viajes')
    dates = [x for s in services.values() for x in [s['inicio'], s['fin'], *s['excepciones'].keys()] if x]
    return {'schema': 1, 'redId': 'metro-bilbao', 'inicio': min(dates), 'fin': max(dates), 'estaciones': stations, 'paradas': stops, 'viajes': trips, 'servicios': services}


if __name__ == '__main__':
    try:
        result = extract(sys.stdin.buffer.read(10_000_001))
        sys.stdout.buffer.write(json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))
    except Exception:
        sys.stderr.write('No se pudo validar el GTFS oficial de Metro Bilbao.\n')
        sys.exit(1)
