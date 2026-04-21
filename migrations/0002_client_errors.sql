-- Migracion 0002 — registro de errores del cliente (navegador).
--
-- Proposito: el cliente hookea window.error + unhandledrejection y POSTea cada
-- error a /api/client-error. El endpoint deduplica por fingerprint (hash del
-- mensaje + primera linea del stack) e incrementa `count` si ya existia. Un
-- cron de GitHub Actions (cada 8h) lee esta tabla via /api/admin/errors y
-- notifica Telegram si hay filas con notified_at IS NULL.
--
-- Dedupe server-side es obligatorio: un error repetido (p.ej. un uncaught
-- promise rejection en cada navegacion) se convertiria en miles de filas al
-- dia sin fingerprint. Upsert por fingerprint garantiza 1 fila por firma.
CREATE TABLE IF NOT EXISTS client_errors (
  -- Hash estable del (message + primera linea de stack). Calculado en cliente
  -- y validado en servidor. 16 chars hex = colisiones despreciables para N<1M.
  fingerprint    TEXT    PRIMARY KEY,
  message        TEXT    NOT NULL,
  stack          TEXT,
  url            TEXT,                     -- solo pathname (sin query, sin host)
  user_agent     TEXT,                     -- truncado a 200 chars
  version        TEXT,                     -- APP_VERSION en el momento del error
  count          INTEGER NOT NULL DEFAULT 1,
  first_seen     INTEGER NOT NULL,         -- epoch ms
  last_seen      INTEGER NOT NULL,         -- epoch ms

  -- Nivel 2: alerta Telegram. El cron pone notified_at = now tras enviar. Si
  -- el error vuelve a ocurrir, last_seen avanza pero notified_at NO se resetea
  -- automaticamente — el cron solo notifica lo nuevo. Si queremos re-notificar
  -- errores recurrentes, hay que limpiar notified_at manualmente.
  notified_at    INTEGER,

  -- Nivel 3: auto-fix. El agente scheduled marca aqui el progreso.
  --   NULL           → no ha empezado aun
  --   'queued'       → agente lo tiene en cola
  --   'in_progress'  → agente esta trabajando
  --   'pr_opened'    → el agente abrio PR (autofix_pr = URL del PR)
  --   'resolved'     → PR mergeado y el error no vuelve a aparecer
  --   'skipped'      → agente considera que no es auto-fixeable
  autofix_status TEXT,
  autofix_pr     TEXT,                     -- URL del PR
  autofix_notes  TEXT                      -- ultimo commentario/log del agente
) WITHOUT ROWID;

-- Index principal: "dame los errores mas recientes". El cron y el dashboard
-- siempre ordenan por last_seen DESC con LIMIT 100.
CREATE INDEX IF NOT EXISTS idx_client_errors_last_seen
  ON client_errors (last_seen DESC);

-- Index para el filtro del cron "notified_at IS NULL" — consulta hot path
-- cada 8h. Con partial index sobre NULL serian bytes minimos, pero SQLite
-- optimiza bien un simple index regular tambien.
CREATE INDEX IF NOT EXISTS idx_client_errors_notified
  ON client_errors (notified_at);

-- Index para el agente auto-fix: busca errores no procesados aun con count>=2
-- (filtro de ruido: errores unicos pueden ser fallos transitorios del usuario).
CREATE INDEX IF NOT EXISTS idx_client_errors_autofix
  ON client_errors (autofix_status, count);
