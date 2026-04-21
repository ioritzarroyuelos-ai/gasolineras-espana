-- Migracion 0004 — enriquecer telemetria de errores (Ship 13).
--
-- Proposito: el /api/client-error actual persiste message+stack+url+user_agent.
-- Cuando un error se repite en multiples modulos o tras una secuencia concreta
-- de acciones del usuario, la sola informacion del stack no basta para
-- reproducirlo. Anadimos tres campos:
--
--  - module:      identificador del modulo JS de origen (map|list|ui|features|
--                 core|unknown). Se calcula client-side heuristicamente a
--                 partir del stack frame mas alto. Util para agregar:
--                 "¿cuantos errores de 'map' hay abiertos?" sin parsear
--                 stacks en cada consulta.
--
--  - breadcrumbs: JSON (array de strings) con las ultimas 8 acciones del
--                 usuario antes del error. Ejemplo:
--                 ["click:btn-favs","modal:open:modal-favs","click:fav-item-42"]
--                 Limite: 500 chars serializados. Se guarda literal sin indexar
--                 — nadie lo consulta por SQL, solo se muestra en el admin.
--
--  - context:     JSON con metadatos de sesion: {prov, mun, fuel, online}.
--                 Permite agrupar "errores solo en ruta /gasolineras/madrid".
--                 Max 200 chars.
--
-- Los tres son nullables. El backend hace upsert: la ultima ocurrencia del
-- error (last_seen actualizado) sobreescribe los campos — asi vemos siempre
-- la secuencia mas reciente que lo reprodujo, que suele ser la mas util para
-- debuggear.

ALTER TABLE client_errors ADD COLUMN module      TEXT;
ALTER TABLE client_errors ADD COLUMN breadcrumbs TEXT;
ALTER TABLE client_errors ADD COLUMN context     TEXT;

-- Index por modulo para consultas del tipo "dame todos los errores del modulo
-- map con count >= 5". El WHERE module IS NOT NULL lo hace partial index,
-- bytes minimos hasta que empiecen a fluir eventos con module.
CREATE INDEX IF NOT EXISTS idx_client_errors_module
  ON client_errors (module, last_seen DESC) WHERE module IS NOT NULL;
