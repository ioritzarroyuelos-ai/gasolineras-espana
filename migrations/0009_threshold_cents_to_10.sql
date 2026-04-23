-- Migracion 0009 — bajar el threshold por defecto de 15 a 10 milesimas de euro.
--
-- Antes: 15 (1,5 centimos/L) — demasiado alto, el mensaje "baja > 1.5 ¢" quedaba
--        feo y poco claro en la UI.
-- Ahora: 10 (1 centimo/L) — mensaje consistente "cuando baje 1 centimo por litro
--        o mas" en la UI y en las alertas del bot.
--
-- Actualizamos los usuarios existentes que tengan el default antiguo (15) para
-- que reciban exactamente lo que la UI les promete. No tocamos filas con otros
-- valores por si en el futuro se permite personalizarlo.

UPDATE telegram_subscriptions   SET threshold_cents = 10 WHERE threshold_cents = 15;
UPDATE telegram_pending_tokens  SET threshold_cents = 10 WHERE threshold_cents = 15;
