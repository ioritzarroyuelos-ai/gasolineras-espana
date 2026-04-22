-- Migracion 0006 — suscripciones Telegram para alertas de precio (Ship 25).
--
-- Sustituye a push_subscriptions (migracion 0005, Web Push). Ship 25 elimina
-- Web Push completo y lo reemplaza por un bot de Telegram dedicado: mejor UX
-- en iOS (sin instalar PWA), mensajes persistentes en el historial del chat,
-- y zero criptografia servidor (el bot token es el unico secreto).
--
-- Cada fila es UN target de alerta (chat + estacion + combustible):
--   - chat_id          identificador del chat personal del user con el bot
--                      (INTEGER firmado; -1000... para grupos, positivos para
--                      users 1-1). Aqui usamos solo 1-1, pero INTEGER cubre ambos.
--   - station_id       IDEESS del Ministerio
--   - fuel_code        'G95E5', 'G98E5', 'GOA', 'GOAPLUS', etc.
--   - threshold_cents  caida minima (en euros*1000) para notificar — default 15
--                      (=1.5 centimos). Server-side gatekeeper adicional al
--                      cooldown de 12h.
--   - baseline_cents   ultimo precio visto al suscribirse o a la ultima notif
--                      (se actualiza al enviar: evita repetir la misma alerta
--                      mientras el precio no baje mas).
--   - last_notified_at epoch ms — cooldown 12h entre notifs a la misma fila.
--
-- PK compuesta (chat_id, station_id, fuel_code): un user solo puede tener
-- UNA suscripcion activa por (estacion, combustible). Re-suscribir sobreescribe
-- baseline (util si el user reactiva despues de una pausa larga).
CREATE TABLE IF NOT EXISTS telegram_subscriptions (
  chat_id          INTEGER NOT NULL,
  station_id       TEXT    NOT NULL,
  fuel_code        TEXT    NOT NULL,
  threshold_cents  INTEGER NOT NULL DEFAULT 15,
  baseline_cents   INTEGER,
  created_at       INTEGER NOT NULL,
  last_notified_at INTEGER,
  PRIMARY KEY (chat_id, station_id, fuel_code)
);

-- Indice para el cron: "dame todas las filas que vigilan ESTA estacion+combustible".
CREATE INDEX IF NOT EXISTS idx_tel_subs_station_fuel
  ON telegram_subscriptions (station_id, fuel_code);

-- Indice para limpieza futura por antiguedad.
CREATE INDEX IF NOT EXISTS idx_tel_subs_created
  ON telegram_subscriptions (created_at);

-- ---- Pending link tokens ----
-- El flujo bot↔web funciona asi:
--   1. Web pide POST /api/telegram/start-link → server genera token random,
--      inserta (token, chat_id=NULL, expires_at=now+10min) y devuelve el
--      deep link "https://t.me/<BotUsername>?start=<token>" + token.
--   2. User clica el link → se abre Telegram → pulsa START. Telegram envia
--      "/start <token>" al webhook del bot.
--   3. El webhook actualiza la fila: chat_id = (el que envio el start),
--      confirmed_at = now. Responde al user: "✅ Vinculado, vuelve a la web".
--   4. La web, mientras, hace polling GET /api/telegram/confirm?token=...
--      cada 2s. Cuando detecta confirmed_at != NULL, toma el chat_id y hace
--      POST /api/telegram/subscribe con sus favoritos.
--   5. Al terminar, el token se borra (o se deja expirar; idx lo purga).
--
-- Tokens expiran en 10 min — forzamos que el user complete el flow rapido
-- y no haya tokens pendientes acumulandose en la tabla.
CREATE TABLE IF NOT EXISTS telegram_pending_tokens (
  token        TEXT    PRIMARY KEY,
  chat_id      INTEGER,                             -- NULL hasta que el bot confirme
  confirmed_at INTEGER,                             -- NULL hasta que el bot confirme
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL                     -- created_at + 10*60*1000
);

-- Indice para purga periodica de tokens expirados (lo hace el cron purge existente).
CREATE INDEX IF NOT EXISTS idx_tel_tokens_expires
  ON telegram_pending_tokens (expires_at);
