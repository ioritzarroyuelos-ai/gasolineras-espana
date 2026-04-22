#!/usr/bin/env bash
# reports-monitor.sh — invocado por .github/workflows/reports-monitor.yml (1/dia).
#
# Flujo:
#   1. GET /api/admin/reports?unnotified=1  (con CRON_TOKEN)
#   2. Si 0 reportes -> silencio (a diferencia de error-monitor, aqui 0 es el
#      estado esperado la mayoria de dias; no spameamos el chat). Se puede
#      forzar un mensaje vacio con FORCE_NOTIFY=true para test manual.
#   3. Si >=1 -> formatea agrupando por (ideess, fuel, reason) con contadores
#      y delta de precio, manda a Telegram.
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
    MSG="✅ ${TS}
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

# Formateo del resumen:
#   - Agrupamos por (ideess, fuel, reason) -> contador
#   - Incluimos delta si hay reported_price_eur (usuario escribio el precio)
#   - Top 15 grupos, resto como "(+N mas)"
#
# jq hace todo el trabajo. Nota: reported - official = delta en €/L.
SUMMARY=$(echo "$RESP" | jq -r '
  .reports
  | group_by(.ideess + "|" + .fuel + "|" + .reason)
  | map({
      n: length,
      ideess: .[0].ideess,
      fuel: .[0].fuel,
      reason: .[0].reason,
      deltas: ([ .[] | select(.reported_price_eur != null and .official_price_eur != null) | (.reported_price_eur - .official_price_eur) ]),
      comments: ([ .[] | select(.comment != null and .comment != "") | .comment ])
    })
  | sort_by(-.n)
  | .[0:15]
  | map(
      "• \(.n)× id=\(.ideess) \(.fuel) [\(.reason)]"
      + (if (.deltas | length) > 0
           then " Δ\((.deltas | add / length) | . * 1000 | round / 1000)€/L"
           else "" end)
      + (if (.comments | length) > 0
           then "\n   💬 \(.comments[0][0:120])"
           else "" end)
    )
  | join("\n")
')

EXTRA=""
GROUPS=$(echo "$RESP" | jq -r '.reports | group_by(.ideess + "|" + .fuel + "|" + .reason) | length')
if [ "$GROUPS" -gt 15 ]; then
  EXTRA="

(+$((GROUPS-15)) grupos mas)"
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
