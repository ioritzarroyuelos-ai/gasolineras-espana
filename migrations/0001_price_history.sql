-- Migracion 0001 — historico de precios por estacion, combustible y dia.
--
-- Diseno:
-- - Una fila por (station_id, fuel_code, date). Idempotente via INSERT OR REPLACE
--   si el cron corre dos veces el mismo dia, no duplicamos.
-- - price_cents es INTEGER: precio en €/L × 1000 (ej. 1,479 €/L -> 1479).
--   Evitamos REAL/FLOAT para no arrastrar errores binarios acumulados y asi
--   min/max/avg en SQL devuelven valores reproducibles bit a bit.
-- - fuel_code es un codigo corto normalizado ('95','98','diesel','diesel_plus')
--   en lugar del string completo del Ministerio (> 30 bytes), para ahorrar
--   storage x3 en la tabla mas grande del sistema.
-- - station_id es TEXT porque IDEESS del Ministerio puede tener ceros a la
--   izquierda en el futuro (hoy son numericos pero no garantizamos rango).
--
-- Tamano estimado con 2 anos de retencion:
-- ~11k estaciones × 4 combustibles × 730 dias × ~50 bytes/fila ≈ 1.3 GB,
-- holgadamente dentro del free tier de D1 (5 GB).
CREATE TABLE IF NOT EXISTS price_history (
  station_id  TEXT    NOT NULL,
  fuel_code   TEXT    NOT NULL,
  date        TEXT    NOT NULL,   -- YYYY-MM-DD, UTC
  price_cents INTEGER NOT NULL,   -- euros × 1000
  PRIMARY KEY (station_id, fuel_code, date)
) WITHOUT ROWID;
-- ^ WITHOUT ROWID: la PK compuesta ES el identificador fisico de la fila. Ahorra
-- un INTEGER rowid + index implicito en cada fila. Util en tablas grandes con
-- PK compuesta y consultas siempre por PK o prefijo de PK.

-- Indice secundario para la query "mediana provincial" (agrupa por dia para
-- un combustible, filtrando por listado de station_ids). Sin este indice, el
-- planner haria full scan de la tabla. Orden por date DESC para que los
-- ultimos N dias salgan sin sort adicional.
CREATE INDEX IF NOT EXISTS idx_fuel_date
  ON price_history (fuel_code, date DESC);
