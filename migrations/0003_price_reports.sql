-- Migracion 0003 — reportes de precio incorrecto enviados por usuarios.
--
-- Proposito: el feed oficial del Ministerio publica precios con retardo (el
-- operador tiene 24h legales para actualizar tras un cambio de surtidor). El
-- usuario que llega a la estacion y ve otro precio en el surtidor no tiene
-- forma de avisar — este endpoint lo permite, y agrega los reportes por
-- (estacion, combustible) para detectar patrones.
--
-- Diseno:
-- - Rate limit server-side (reportLimiter: 5 req/min/IP) + dedupe por
--   ip_hash+ideess+fuel dentro de una ventana de 1h via busqueda previa a
--   insertar. Asi una IP que flamea sobre la misma estacion no puede inflar
--   las metricas con 1 reporte/segundo.
-- - ip_hash = sha256(ip + DAY). Privacy-preserving: no guardamos IP en claro.
--   Rotacion diaria (DAY = YYYY-MM-DD) evita que el hash se use como
--   identificador persistente fuera de la ventana de rate limit.
-- - Sin user_id/email/telefono — es reporte publico anonimo. Los agregados
--   los consume el admin via GET /api/admin/reports (proximos ships).
CREATE TABLE IF NOT EXISTS price_reports (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  ideess                 TEXT    NOT NULL,    -- ID oficial de la estacion (Ministerio)
  fuel                   TEXT    NOT NULL,    -- codigo de combustible (95, 98, diesel, diesel_plus, ...)

  -- Precio oficial en el momento del reporte (para poder calcular el delta vs
  -- lo que el usuario vio). REAL en euros/litro. Puede ser NULL si la estacion
  -- no tenia precio publicado — raro pero posible (precio temporalmente vacio
  -- en el feed oficial).
  official_price_eur     REAL,

  -- Precio que el usuario vio en el surtidor. NULL si no lo rellena (flag sin
  -- cifra concreta). Cuando se rellena, permite calcular delta agregado.
  reported_price_eur     REAL,

  -- Motivo categorizado. Cerrado en la UI via dropdown — valores validos:
  --   'outdated'    precio distinto al surtidor
  --   'closed'      gasolinera cerrada / fuera de servicio
  --   'wrong_fuel'  el combustible no coincide con el etiquetado
  --   'other'       otro motivo (ver comment)
  reason                 TEXT    NOT NULL,
  comment                TEXT,                 -- texto libre opcional, max 500 chars

  -- Hash IP + dia (ver arriba). Usado para rate limit agregado y para detectar
  -- multiples reportes del mismo "bucket" sobre la misma estacion sin
  -- identificar al reporter.
  ip_hash                TEXT    NOT NULL,

  created_at             INTEGER NOT NULL,    -- epoch ms
  -- Moderacion manual (admin UI, proximo ship). reviewed_at=null -> pendiente.
  reviewed_at            INTEGER,
  reviewer_notes         TEXT
);

-- Index principal: "dame reportes de una estacion" / "dame reportes por fuel".
CREATE INDEX IF NOT EXISTS idx_price_reports_station
  ON price_reports (ideess, fuel, created_at DESC);

-- Index para el panel admin: "reportes pendientes mas recientes".
CREATE INDEX IF NOT EXISTS idx_price_reports_pending
  ON price_reports (reviewed_at, created_at DESC);

-- Index para rate limit aplicativo: "esta IP ya reporto esta estacion en la
-- ultima hora?". La consulta previa a insertar usa esto para devolver 409.
CREATE INDEX IF NOT EXISTS idx_price_reports_dedupe
  ON price_reports (ip_hash, ideess, fuel, created_at);
