// ============================================================
// Historico de precios — utilidades puras (sin bindings CF).
// ============================================================
// Este modulo hace UNA cosa: convertir el snapshot del Ministerio en filas
// listas para upsertear a D1. Se importa desde:
//   - src/index.tsx (handler scheduled() que llama a ingestSnapshot)
//   - tests/history.test.ts (unit tests de conversion)
//   - scripts/backfill-d1.mjs (genera SQL a partir de git history)

// Campos del Ministerio mapeados a nuestro fuel_code compacto. Mantenemos solo
// los 4 combustibles mayoritarios (cubren ~95% de los vehiculos civiles). GLP,
// GNC, GNL, H2 y Renovables los gestiona un publico especialista que ya sabe
// donde repostar; ampliaremos el mapa si surge demanda.
export const FUEL_MAP: Record<string, string> = {
  'Precio Gasolina 95 E5':  '95',
  'Precio Gasolina 98 E5':  '98',
  'Precio Gasoleo A':       'diesel',
  'Precio Gasoleo Premium': 'diesel_plus',
}
export const FUEL_CODES = Object.values(FUEL_MAP)

// Parsea "1,479" (formato ministerio, coma decimal) o "1.479" a euros.
// Devuelve null para cadenas vacias, "N/D", o valores fuera de rango.
export function parsePriceString(raw: string | undefined | null): number | null {
  if (!raw) return null
  const s = String(raw).trim().replace(',', '.')
  if (!s) return null
  const n = parseFloat(s)
  // Rango defensivo: precios reales de combustibles en Espana oscilan entre
  // ~0.50 €/L (GLP muy barato) y ~3.00 €/L (hidrogeno caro). Fuera de eso
  // descartamos como dato corrupto.
  if (!Number.isFinite(n) || n <= 0 || n > 10) return null
  return n
}

// Convierte euros con 3 decimales a cents milesimas (1.479 -> 1479).
// Redondeo en lugar de truncar: evita que 1.4789999 acabe siendo 1478.
export function eurosToCents(euros: number): number {
  return Math.round(euros * 1000)
}

// Inversa exacta: 1479 -> 1.479. Util para serializar al cliente.
export function centsToEuros(cents: number): number {
  return cents / 1000
}

// Fila lista para INSERT. Orden fijo (station_id, fuel_code, date, price_cents)
// para poder construir INSERT ... VALUES (?,?,?,?) de forma posicional.
export type PriceRow = {
  station_id: string
  fuel_code: string
  date: string
  price_cents: number
}

// Convierte el snapshot del Ministerio (JSON crudo) en filas por
// (estacion, combustible) para un dia concreto. Ignora silenciosamente
// estaciones sin IDEESS, precios no parseables, y combustibles no presentes.
//
// 'date' es el dia que se asignara a todas las filas. Normalmente "hoy" en
// UTC; para backfill desde git usamos la fecha del commit.
export function snapshotToRows(
  snapshot: unknown,
  date: string,
): PriceRow[] {
  if (!snapshot || typeof snapshot !== 'object') return []
  const list = (snapshot as { ListaEESSPrecio?: unknown[] }).ListaEESSPrecio
  if (!Array.isArray(list)) return []

  const rows: PriceRow[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as Record<string, string>
    const stationId = s['IDEESS']
    if (!stationId || !/^\d{1,10}$/.test(stationId)) continue

    for (const ministryKey of Object.keys(FUEL_MAP)) {
      const fuelCode = FUEL_MAP[ministryKey]
      const price = parsePriceString(s[ministryKey])
      if (price == null) continue
      rows.push({
        station_id: stationId,
        fuel_code: fuelCode,
        date,
        price_cents: eurosToCents(price),
      })
    }
  }
  return rows
}

// Fecha "hoy" en UTC como YYYY-MM-DD. Extraido para mockear en tests.
export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10)
}

// Construye un INSERT OR REPLACE multi-row con placeholders posicionales.
// 'rowsPerStmt' acota cuantas filas caben en un statement. Limite duro de D1:
// 999 variables (?-placeholders) por statement — herencia de SQLite antiguo
// que D1 sigue aplicando aunque SQLite moderno soporte 32k. Con 4 cols,
// rowsPerStmt maximo seguro = 249; dejamos 100 para tener margen ante futuras
// reducciones del limite y para que cada batch siga siendo suficientemente
// pequeno de logear en caso de fallo.
//
// Devuelve array de { sql, params } listos para D1.prepare(sql).bind(...params).
//
// INSERT OR REPLACE es intencional: si el cron corre dos veces el mismo dia
// (manual-trigger + scheduled), la segunda ejecucion sobreescribe con el
// precio mas reciente. Atomico a nivel de fila, sin bloqueos largos.
export function buildInsertBatches(
  rows: PriceRow[],
  rowsPerStmt: number = 100,
): Array<{ sql: string; params: (string | number)[] }> {
  const batches: Array<{ sql: string; params: (string | number)[] }> = []
  for (let i = 0; i < rows.length; i += rowsPerStmt) {
    const chunk = rows.slice(i, i + rowsPerStmt)
    const placeholders = chunk.map(() => '(?,?,?,?)').join(',')
    const sql = 'INSERT OR REPLACE INTO price_history (station_id, fuel_code, date, price_cents) VALUES ' + placeholders
    const params: (string | number)[] = []
    for (const r of chunk) {
      params.push(r.station_id, r.fuel_code, r.date, r.price_cents)
    }
    batches.push({ sql, params })
  }
  return batches
}

// Calcula cutoff YYYY-MM-DD para "purgar antes de hace N años". Extraido
// para testear sin depender de Date.now().
export function purgeCutoffDate(now: Date, years: number = 2): string {
  const d = new Date(now.getTime())
  d.setUTCFullYear(d.getUTCFullYear() - years)
  return d.toISOString().slice(0, 10)
}
