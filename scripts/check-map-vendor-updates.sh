#!/usr/bin/env bash
# check-map-vendor-updates.sh — invocado por
# .github/workflows/vendor-check.yml una vez por semana.
#
# Compara las versiones instaladas de las librerias del mapa (leaflet,
# MarkerCluster, leaflet.heat, MapLibre GL, bridge) contra lo que hay en el
# registry de npm. Si alguna tiene una release mas reciente, avisa por
# Telegram. Si no hay cambios, sale en silencio (sin heartbeat — esto es
# informativo, no critico, no queremos ruido semanal sin motivo).
#
# Env vars:
#   TELEGRAM_BOT_TOKEN  token del bot (@BotFather)
#   TELEGRAM_CHAT_ID    chat destino
#
# Nota: el script solo AVISA. Para aplicar la actualizacion el dueno edita
# scripts/fetch-map-vendor.mjs con la nueva version + nuevo hash SRI, ejecuta
# node scripts/fetch-map-vendor.mjs, revisa el diff de public/static/vendor/
# y commitea. El hash SRI se saca de https://www.srihash.org/ o con openssl:
#   curl -sL <url> | openssl dgst -sha384 -binary | openssl base64 -A

set -euo pipefail

MANIFEST="public/static/vendor/map/manifest.json"
if [ ! -f "$MANIFEST" ]; then
  echo "::error::$MANIFEST no existe"
  exit 1
fi
if [ -z "${TELEGRAM_BOT_TOKEN:-}" ] || [ -z "${TELEGRAM_CHAT_ID:-}" ]; then
  echo "::error::TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados"
  exit 1
fi

# Lista "paquete=version" a partir de manifest.json.
PACKAGES=$(jq -r '.packages | to_entries[] | "\(.key)=\(.value)"' "$MANIFEST")

UPDATES=""
while IFS="=" read -r pkg installed; do
  [ -z "$pkg" ] && continue
  # Escape del '/' en nombres scoped (@maplibre/...) para el URL del registry.
  enc_pkg=$(printf '%s' "$pkg" | sed 's|/|%2F|g')
  url="https://registry.npmjs.org/${enc_pkg}/latest"
  latest=$(curl -fsS --retry 3 --retry-delay 3 --max-time 20 "$url" | jq -r '.version // empty')
  if [ -z "$latest" ]; then
    echo "[vendor-check] aviso: no se pudo obtener version de $pkg"
    continue
  fi
  if [ "$latest" != "$installed" ]; then
    UPDATES="${UPDATES}
• ${pkg}: ${installed} → ${latest}"
    echo "[vendor-check] $pkg: $installed → $latest"
  else
    echo "[vendor-check] $pkg: $installed (al dia)"
  fi
done <<< "$PACKAGES"

if [ -z "$UPDATES" ]; then
  echo "[vendor-check] OK — todas las libs del mapa al dia"
  exit 0
fi

TS=$(date -u +"%Y-%m-%d %H:%M UTC")
MSG="📦 ${TS}
Actualizaciones del mapa disponibles:
${UPDATES}

Para aplicar:
1. edita scripts/fetch-map-vendor.mjs (nueva version + nuevo hash SRI)
2. node scripts/fetch-map-vendor.mjs
3. npm run build && git commit del diff de public/static/vendor/map/"

echo "[vendor-check] enviando a Telegram..."
TG_RESP=$(curl -fsS --max-time 15 \
  -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
  --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
  --data-urlencode "text=${MSG}" \
  --data-urlencode "disable_web_page_preview=true")
TG_OK=$(echo "$TG_RESP" | jq -r '.ok')
if [ "$TG_OK" != "true" ]; then
  echo "::error::Telegram rechazo: $TG_RESP"
  exit 1
fi
echo "[vendor-check] OK — aviso enviado"
