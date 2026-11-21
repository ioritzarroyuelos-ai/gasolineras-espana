// Las dos vistas usan la misma caducidad. No se infieren salidas ni horarios
// completos a partir de las llegadas estimadas que publica el operador.
export function ahoraParteMetro(evaluadoEn, inicioMono, nowWall = Date.now(), nowMono = performance.now()) {
  const evaluated = Date.parse(evaluadoEn)
  if (!Number.isFinite(evaluated) || !Number.isFinite(inicioMono) || !Number.isFinite(nowMono) || nowMono < inicioMono) return NaN
  return Math.max(nowWall, evaluated + nowMono - inicioMono)
}
export function metroParteActual(data, now = Date.now()) {
  const published = Date.parse(data?.fechaDatos), expiry = Date.parse(data?.caduca)
  return !!data && ['actual', 'parcial'].includes(data.estado) && data.directorioActual === true && Number.isFinite(published) && published <= now && Number.isFinite(expiry) && expiry - published === 120000 && now < expiry
}
export function metroLlegadasActuales(station, data, now = Date.now()) {
  if (!metroParteActual(data, now) || !Array.isArray(station?.llegadas)) return []
  return station.llegadas.filter(a => Number.isFinite(Date.parse(a.llegada)) && Date.parse(a.llegada) > now && Date.parse(a.llegada) <= now + 7200000)
}
export function validaParteMetro(data, now = Date.now()) {
  const text = v => typeof v === 'string' && v.length > 0 && v.length <= 600
  if (!data || data.schema !== 1 || data.redId !== 'metro-bilbao' || !Array.isArray(data.items) || data.items.length > 100 || data.total !== data.items.length || !Number.isFinite(Date.parse(data.fechaDatos)) || Date.parse(data.fechaDatos) > now || Date.parse(data.caduca) - Date.parse(data.fechaDatos) !== 120000 || !Number.isFinite(Date.parse(data.consultado)) || !Number.isFinite(Date.parse(data.fechaDirectorio)) || !Array.isArray(data.warnings) || data.warnings.length > 20 || !data.warnings.every(text) || !Array.isArray(data.avisos) || data.avisos.length > 1000) return false
  const ids = new Set()
  for (const p of data.items) {
    if (!/^metro-bilbao-\d{1,6}$/.test(p.id) || ids.has(p.id) || !text(p.nombre) || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || p.lat < 43.1 || p.lat > 43.5 || p.lon < -3.2 || p.lon > -2.7 || !Array.isArray(p.llegadas) || p.llegadas.length > 5 || !Array.isArray(p.avisos) || p.avisos.length > 1000) return false
    ids.add(p.id)
    for (const a of p.llegadas) if (!text(a.destino) || a.tipo !== 'llegada_estimada' || !Number.isFinite(Date.parse(a.llegada)) || Date.parse(a.llegada) > now + 7200000 || !Number.isFinite(Date.parse(a.fechaParte)) || Date.parse(a.fechaParte) > now) return false
    if (!p.avisos.every(a => a.estado === 'sin_parada' && text(a.destino))) return false
  }
  return data.avisos.every(a => a.estado === 'cancelado' && text(a.destino))
}
