#!/usr/bin/env bash
# reports-monitor.sh — invocado por .github/workflows/reports-monitor.yml (1/dia).
#
# Flujo:
#   1. GET /api/admin/reports?unnotified=1  (con CRON_TOKEN)
#   2. Si 0 reportes -> silencio (a diferencia de error-monitor, aqui 0 es el
#      estado esperado la mayoria de dias; no spameamos el chat). Se puede
#      forzar un mensaje vacio con FORCE_NOTIFY=true para test manual.
#   3. Si >=1 -> formatea una linea por reporte (ordenadas por estacion, top 20),
#      lo manda a Telegram.
#   4. POST /api/admin/reports/ack?ids=...  (marca reviewed_at=now).
#
# Env vars:
#   CRON_TOKEN          (shared con el Pages project)
#   TELEGRAM_BOT_TOKEN  (@BotFather)
#   TELEGRAM_CHAT_ID    (mismo chat admin que error-monitor)
#   PUBLIC_ORIGIN       (default https://webapp-3ft.pages.dev)
#   FORCE_NOTIFY        "true" para mandar mensaje vacio y validar pipeline

set -euo pipefail

ORIGIN="${PUBLIC_ORIGIN:-https://webapp-3ft.pages.dev}"
FORCE="${FORCE_NOTIFY:-false}"

echo "[reports] GET ${ORIGIN}/api/admin/reports?unnotified=1"
RESP=$(curl -fsS --retry 3 --retry-delay 5 --max-time 30 \
  -H "Authorization: Bearer ${CRON_TOKEN}" \
  -H "Accept: application/json" \
  "${ORIGIN}/api/admin/reports?unnotified=1&limit=200")

COUNT=$(echo "$RESP" | jq -r '.reports | length // 0')
echo "[reports] ${COUNT} reportes pendientes"

TS=$(date -u +"%Y-%m-%d %H:%M UTC")

if [ "$COUNT" -eq 0 ]; then
  if [ "$FORCE" = "true" ]; then
    echo "[reports] FORCE_NOTIFY=true — envio mensaje heartbeat a Telegram"
    MSG="OK ${TS}
Sin reportes de precio pendientes.
(Test manual: pipeline de reports-monitor funciona.)"
    curl -fsS --max-time 15 \
      -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=${MSG}" \
      --data-urlencode "disable_web_page_preview=true" > /dev/null
    echo "[reports] Heartbeat enviado."
    exit 0
  fi
  echo "[reports] Nada que notificar. Silencio."
  exit 0
fi

# Formato (simple y robusto): una linea por reporte, top 20. jq minimalista,
# sin aggregaciones raras — preferimos 20 lineas legibles que un group-by que
# falle por un edge case. El admin puede pedir el JSON completo si necesita mas.
#
#   • id=10595 95 [outdated] oficial=1.509 visto=1.489 Δ-0.020 💬 surtidor...
#
# - oficial/visto = precios en €/L con 3 decimales (o "-" si null).
# - 💬 solo si hay comentario, truncado a 80 chars.
echo "[reports] Formateando mensaje..."
SUMMARY=$(echo "$RESP" | jq -r '
  .reports
  | .[0:20]
  | map(
      "• id=\(.ideess) \(.fuel) [\(.reason)]"
      + " of=\(if .official_price_eur == null then "-" else (.official_price_eur | tostring) end)"
      + " rep=\(if .reported_price_eur == null then "-" else (.reported_price_eur | tostring) end)"
      + (if (.comment != null) and (.comment != "") then " 💬 \(.comment[0:80])" else "" end)
    )
  | join("\n")
')

EXTRA=""
if [ "$COUNT" -gt 20 ]; then
  EXTRA="

(+$((COUNT-20)) mas)"
fi

MSG="⚠️ ${TS}
${COUNT} reporte(s) de precio pendientes:

${SUMMARY}${EXTRA}

Consulta: ${ORIGIN}/api/admin/reports (requiere CRON_TOKEN)"

echo "[reports] Enviando a Telegram..."
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

# ACK: marca todos los ids como reviewed_at=now. Construimos lista CSV.
IDS=$(echo "$RESP" | jq -r '.reports | map(.id | tostring) | join(",")')
echo "[reports] ACK ids: ${IDS}"
curl -fsS --retry 3 --retry-delay 3 --max-time 15 -X POST \
  -H "Authorization: Bearer ${CRON_TOKEN}" \
  "${ORIGIN}/api/admin/reports/ack?ids=${IDS}" > /dev/null

echo "[reports] OK."
