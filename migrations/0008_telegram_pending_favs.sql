-- Migracion 0008 — almacenar favoritos + threshold en el pending_token (Ship 25.1).
--
-- Hasta ahora el flow era en 2 pasos:
--   1. POST /api/telegram/start-link     -> crea token (sin favoritos)
--   2. webhook /start <token> en Telegram -> marca chat_id/confirmed_at
--   3. POST /api/telegram/subscribe      -> cliente manda favoritos asociados al token
--   4. webhook ya no sabe que favoritos tiene el user al responder "✅ Vinculado"
--
-- Problema: el mensaje de confirmacion de Telegram salia soso ("Vinculado, vuelve
-- a la web, espera...") porque el bot no conocia las favoritas. El paso 3
-- ademas mete un round-trip extra y un error mode mas (que pasa si el cliente
-- se cierra tras confirmar pero antes de llamar subscribe? tendriamos un chat_id
-- confirmado pero sin alertas).
--
-- Nuevo flow (Ship 25.1):
--   1. POST /api/telegram/start-link { favs, threshold_cents }
--      -> inserta token CON los favoritos ya serializados en JSON
--   2. webhook /start <token>
--      -> en una sola transaccion: lee favs_json, inserta en
--         telegram_subscriptions, borra el token, manda mensaje listando
--         las gasolineras
--   3. cliente hace polling /confirm -> al ver confirmed=true, pone localStorage
--      y listo (sin /subscribe)
--
-- Los tokens activos al aplicar esta migracion heredan favs_json='[]' — son
-- huerfanos pero el TTL de 10 min los limpia solos. En la practica se perderan
-- como maximo los que esten en vuelo en ese instante (<10 min de ventana).

ALTER TABLE telegram_pending_tokens ADD COLUMN favs_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE telegram_pending_tokens ADD COLUMN threshold_cents INTEGER NOT NULL DEFAULT 15;
