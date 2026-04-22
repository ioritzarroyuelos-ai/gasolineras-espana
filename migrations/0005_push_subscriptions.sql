-- Migracion 0005 — suscripciones Web Push para alertas de precio (Ship 23).
--
-- Cada fila es UNA suscripcion push (device + station + fuel) — un usuario
-- puede tener varias (distintos favoritos). El "endpoint" es el identificador
-- unico del canal push (URL larga del push service, ej. fcm.googleapis.com/...
-- o updates.push.services.mozilla.com/...). Lo usamos como PK porque:
--   1. El mismo dispositivo/browser SIEMPRE devuelve el mismo endpoint para
--      una misma suscripcion VAPID (spec push-API).
--   2. Si el usuario re-suscribe, reescribimos (INSERT OR REPLACE).
--
-- keys_p256dh + keys_auth son las claves publicas del receptor — las
-- necesitamos para CIFRAR el payload (aes128gcm RFC 8188). Si no cifrasemos
-- podriamos omitirlas, pero una vez queramos enviar texto ya no hay vuelta
-- atras. Ambas vienen en base64url desde el cliente (subscription.toJSON()).
--
-- station_id + fuel_code acotan QUE vigilar: una sola estacion y un solo
-- combustible por suscripcion. Para "vigila la 95 en toda Bizkaia" se crean
-- varias filas (una por estacion favorita). threshold_cents es la caida minima
-- (en euros*1000) para disparar notif — ej. 15 = 1.5 centimos.
--
-- created_at: epoch ms, util para purgar suscripciones antiguas que el
-- push service haya invalidado silenciosamente (HTTP 410 Gone al enviar).
-- user_agent: string del header, diagnostica "que browser se suscribio" sin
-- ser PII identificable.
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint         TEXT    PRIMARY KEY,
  keys_p256dh      TEXT    NOT NULL,
  keys_auth        TEXT    NOT NULL,
  station_id       TEXT    NOT NULL,
  fuel_code        TEXT    NOT NULL,
  threshold_cents  INTEGER NOT NULL DEFAULT 15,   -- 1.5 centimos
  baseline_cents   INTEGER,                        -- ultimo precio visto al subscribirse
  created_at       INTEGER NOT NULL,
  last_notified_at INTEGER,                        -- para cooldown server-side
  user_agent       TEXT
);

-- Indice para la query del cron: "dame todas las suscripciones que vigilan
-- ESTA estacion+combustible". Cada run del cron iterara por (station,fuel)
-- consultando el precio actual una vez y luego comparando vs baselines.
CREATE INDEX IF NOT EXISTS idx_push_subs_station_fuel
  ON push_subscriptions (station_id, fuel_code);

-- Indice para purgar por antiguedad cuando el cron detecta HTTP 410.
CREATE INDEX IF NOT EXISTS idx_push_subs_created
  ON push_subscriptions (created_at);
