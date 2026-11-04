// Compara dos fotos oficiales recientes. Nunca recupera como referencia una
// tendencia antigua solo porque el fichero se haya descargado de nuevo hoy.
const MAX_AGE_MS = 36 * 60 * 60 * 1000
const FUEL_KEYS = {
  g95: 'Precio Gasolina 95 E5',
  g98: 'Precio Gasolina 98 E5',
  diesel: 'Precio Gasoleo A',
  glp: 'Precio Gases licuados del petróleo',
}

function median(values) {
  const sorted = values.filter(v => Number.isFinite(v) && v > 0).sort((a, b) => a - b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

// La fecha del Ministerio no incluye zona. Convertimos su hora peninsular
// usando Europe/Madrid para respetar también el cambio de hora de verano.
function sourceTime(value) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2})$/.exec(value || '')
  if (!m) return NaN
  const parts = { year: +m[3], month: +m[2], day: +m[1], hour: +m[4], minute: +m[5], second: +m[6] }
  const wall = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const format = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Madrid', hourCycle: 'h23', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const local = time => Object.fromEntries(format.formatToParts(time).map(p => [p.type, Number(p.value)]))
  let time = wall
  for (let i = 0; i < 2; i++) {
    const p = local(time)
    time += wall - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  }
  const p = local(time)
  return Object.keys(parts).every(k => p[k] === parts[k]) ? time : NaN
}

function capture(snapshot, ts) {
  if (!snapshot?.Fecha || !Array.isArray(snapshot.ListaEESSPrecio)) return null
  const sourceAt = sourceTime(snapshot.Fecha)
  if (!Number.isFinite(sourceAt)) return null
  const values = Object.fromEntries(Object.keys(FUEL_KEYS).map(k => [k, []]))
  const ccaaValues = {}
  for (const station of snapshot.ListaEESSPrecio) {
    const id = station.IDCCAA
    if (id && !ccaaValues[id]) ccaaValues[id] = { count: 0, fuel: Object.fromEntries(Object.keys(FUEL_KEYS).map(k => [k, []])) }
    if (id) ccaaValues[id].count++
    for (const [fuel, key] of Object.entries(FUEL_KEYS)) {
      const price = Number(String(station[key] || '').replace(',', '.'))
      values[fuel].push(price)
      if (id) ccaaValues[id].fuel[fuel].push(price)
    }
  }
  const medians = Object.fromEntries(Object.entries(values).map(([key, prices]) => [key, median(prices)]))
  const ccaa = Object.fromEntries(Object.entries(ccaaValues).map(([id, entry]) => [id, {
    count: entry.count,
    fuel: Object.fromEntries(Object.entries(entry.fuel).map(([key, prices]) => [key, median(prices)])),
  }]))
  return { ts, sourceAt: new Date(sourceAt).toISOString(), ministryDate: snapshot.Fecha, medians, ccaa }
}

function fresh(capture, now) {
  if (!capture?.medians || !Object.keys(FUEL_KEYS).every(k => capture.medians[k] === null || (Number.isFinite(capture.medians[k]) && capture.medians[k] > 0))) return false
  return [Date.parse(capture.ts), sourceTime(capture.ministryDate)].every(time =>
    Number.isFinite(time) && now - time >= -5 * 60 * 1000 && now - time <= MAX_AGE_MS)
}

export function buildFuelTrends(snapshot, { now = new Date(), previous, previousSnapshot, previousMeta } = {}) {
  const time = now.getTime()
  const current = capture(snapshot, now.toISOString())
  if (!current || !Number.isFinite(sourceTime(current.ministryDate))) throw new Error('Fecha del Ministerio no válida para la tendencia')
  // La copia anterior de stations.json permite arrancar sin esperar otro ciclo,
  // pero solo si su metadata corresponde a la misma foto y sigue siendo reciente.
  const priorSnapshot = previousMeta?.ministryDate === previousSnapshot?.Fecha
    ? capture(previousSnapshot, previousMeta?.fetchedAt)
    : null
  const candidates = [previous?.current, previous?.previous, priorSnapshot]
    .filter(item => fresh(item, time) && sourceTime(item.ministryDate) < sourceTime(current.ministryDate))
    .sort((a, b) => sourceTime(b.ministryDate) - sourceTime(a.ministryDate))
  const prior = fresh(current, time) ? candidates[0] || null : null
  return {
    generatedAt: now.toISOString(), ministryDate: current.ministryDate, current,
    previous: prior ? { ...prior, sourceAt: new Date(sourceTime(prior.ministryDate)).toISOString() } : null,
  }
}
