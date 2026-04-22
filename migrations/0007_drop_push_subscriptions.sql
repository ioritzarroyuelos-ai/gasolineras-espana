-- Migracion 0007 — drop push_subscriptions (Ship 25).
--
-- Ship 25 reemplaza Web Push (migracion 0005) por Telegram (migracion 0006).
-- La tabla push_subscriptions queda huerfana: ningun endpoint la lee ni escribe.
-- La droppamos para:
--   1. No confundir al proximo que mire el schema.
--   2. Liberar espacio en D1 (aunque sean bytes — higiene).
--   3. Hacer que si alguien reintroduce Web Push por error, no herede datos
--      incompatibles con una nueva implementacion.
--
-- Safe: si la tabla no existe (instalacion fresca), IF EXISTS es no-op.
-- Tambien droppamos los indices por si D1 no los encadena automaticamente.
DROP INDEX IF EXISTS idx_push_subs_station_fuel;
DROP INDEX IF EXISTS idx_push_subs_created;
DROP TABLE IF EXISTS push_subscriptions;
