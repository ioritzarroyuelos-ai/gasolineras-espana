import io
import sys
import zipfile

mode = sys.argv[1] if len(sys.argv) > 1 else 'valid'
files = {
 'stops.txt': 'stop_id,stop_code,stop_name,stop_lat,stop_lon,zone_id,location_type,parent_station\n7,,Abando,43.2614,-2.92761,A,1,\n7.0,ABA,Abando,43.2614,-2.92761,A,0,7\n7.1,,Entrada Abando,43.2615,-2.92760,A,2,7\n',
 'routes.txt': 'route_id,route_short_name,route_long_name,route_type\nMB,,Metro Bilbao,1\n',
 'trips.txt': 'trip_id,route_id,service_id,trip_headsign,direction_id\n123,MB,diario,Plentzia,0\n',
 'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ndiario,1,1,1,1,1,1,1,20261119,20261219\n',
 'calendar_dates.txt': 'service_id,date,exception_type\ndiario,20261201,2\n',
}
if mode == 'zero': files['stops.txt'] = files['stops.txt'].replace('43.2614,-2.92761', '0,0')
if mode == 'parent': files['stops.txt'] = files['stops.txt'].replace('A,0,7', 'A,0,99')
if mode == 'duplicate': files['stops.txt'] += '7,,Abando,43.2614,-2.92761,A,1,\n'
if mode == 'service': files['trips.txt'] = files['trips.txt'].replace('MB,diario,', 'MB,missing,')
if mode == 'route': files['routes.txt'] = files['routes.txt'].replace('Metro Bilbao,1', 'Metro Bilbao,3')
if mode == 'date': files['calendar.txt'] = files['calendar.txt'].replace('20261119', '20260231')
if mode == 'nested': files['../escape.txt'] = 'not extracted'
if mode == 'large': files['trips.txt'] += 'a' * 2_000_001
if mode == 'missing': del files['calendar.txt']
buf = io.BytesIO()
with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as archive:
 for name, text in files.items(): archive.writestr(name, text)
sys.stdout.buffer.write(buf.getvalue())
