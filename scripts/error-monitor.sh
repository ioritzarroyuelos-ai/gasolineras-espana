#!/usr/bin/env bash
# error-monitor.sh — invocado por .github/workflows/error-monitor.yml cada 8h.
#
# Flujo:
#   1. GET /api/admin/errors?unnotified=1  (con CRON_TOKEN)
#   2. Formatea mensaje para Telegram (usa MarkdownV2 escapado)
#   3. POST https://api.telegram.org/bot${TOKEN}/sendMessage
#   4. POST /api/admin/errors/ack?fingerprints=... (marca como notificados)
#
# Env vars obligatorias:
#   CRON_TOKEN          (shared secret con el Pages project)
#   TELEGRAM_BOT_TOKEN  (@BotFather)
#   TELEGRAM_CHAT_ID    (obtener con @userinfobot o getUpdates)
#   PUBLIC_ORIGIN       (opcional, default https://webapp-3ft.pages.dev)
#   FORCE_NOTIFY        (opcional, 'true' para enviar aunque no haya errores)

set -euo pipefail

ORIGIN="${PUBLIC_ORIGIN:-https://webapp-3ft.pages.dev}"
FORCE="${FORCE_NOTIFY:-false}"

# Escape MarkdownV2 — Telegram requiere escapar: _ * [ ] ( ) ~ ` > # + - = | { } . !
# Pero mandamos texto plano, asi que evitamos formato y usamos parse_mode vacio.
# Mas robusto: sin formato, sin escape. Legible y no falla por un caracter raro.

echo "[monitor] GET ${ORIGIN}/api/admin/errors?unnotified=1"
RESP=$(curl -fsS --retry 3 --retry-delay 5 --max-time 30 \
  -H "Authorization: Bearer ${CRON_TOKEN}" \
  -H "Accept: application/json" \
  "${ORIGIN}/api/admin/errors?unnotified=1&limit=100")

# Validacion minima: que sea JSON con `errors` array.
COUNT=$(echo "$RESP" | jq -r '.errors | length // 0')
echo "[monitor] ${COUNT} errores nuevos"

TS=$(date -u +"%Y-%m-%d %H:%M UTC")

if [ "$COUNT" -eq 0 ]; then
  if [ "$FORCE" != "true" ]; then
    echo "[monitor] Sin errores, sin notificacion (FORCE_NOTIFY!=true)."
    exit 0
  fi
  MSG="✅ ${TS}
Cero errores nuevos en prod."
else
  # Formato:   • 15× v1.8.0: TypeError: foo is undefined
  # Truncamos mensaje a 120 chars para que no explote en mobile.
  SUMMARY=$(echo "$RESP" | jq -r '
    .errors
    | map("• \(.count)× \(.version // "?"): \(.message[0:120])")
    | .[0:10]
    | join("\n")
  ')
  EXTRA=""
  if [ "$COUNT" -gt 10 ]; then
    EXTRA="

(+$(($COUNT-10)) mas)"
  fi
  MSG="⚠️ ${TS}
${COUNT} error(es) nuevo(s) en prod:

${SUMMARY}${EXTRA}

Ver detalles: ${ORIGIN}/api/admin/errors (requiere CRON_TOKEN)"
fi

echo "[monitor] Enviando a Telegram..."
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

# Marca como notificados para que el siguiente tick no los reenvie.
if [ "$COUNT" -gt 0 ]; then
  FPS=$(echo "$RESP" | jq -r '.errors | map(.fingerprint) | join(",")')
  echo "[monitor] ACK fingerprints: ${FPS}"
  curl -fsS --retry 3 --retry-delay 3 --max-time 15 -X POST \
    -H "Authorization: Bearer ${CRON_TOKEN}" \
    "${ORIGIN}/api/admin/errors/ack?fingerprints=${FPS}" > /dev/null
fi

echo "[monitor] OK."
