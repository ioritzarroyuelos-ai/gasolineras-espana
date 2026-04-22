// Cliente minimo para Telegram Bot API (Ship 25).
//
// Sustituye al helper de Web Push: para alertas de bajadas de precio el canal
// Telegram da mejor UX (funciona en iOS sin instalar PWA, persiste en historial,
// y la infra son 30 lineas contra 170+ de VAPID/JWT/ECDSA).
//
// Solo wrappers sobre `api.telegram.org`. No hay crypto — el bot token es el
// unico secreto, y va en el path de la URL (estandar de Telegram).
//
// El token vive en `env.TELEGRAM_BOT_TOKEN` (secret_text en CF Pages). Si no
// esta configurado, todos los endpoints `/api/telegram/*` responden 503 y el
// panel del UI se oculta solo — mismo patron que Ship 23 hacia con VAPID.

export interface TgSendResult {
  ok: boolean
  status: number
  /** true si el chat bloqueo al bot (403) o ya no existe (400 chat_not_found).
   *  El caller deberia borrar la suscripcion de D1 para dejar de reintentar. */
  gone?: boolean
  /** Tras 429: segundos que Telegram pide esperar (Retry-After). El caller
   *  puede elegir skip + retry en el siguiente tick del cron. */
  retry_after?: number
  /** Mensaje de error (solo si !ok). */
  description?: string
}

/**
 * Envia un mensaje a un chat. Usa `parse_mode=HTML` y `disable_web_page_preview`
 * por defecto para alertas limpias.
 *
 * Telegram acepta hasta 4096 chars por mensaje. Si te pasas, corta en el caller
 * — aqui dejamos que la API devuelva 400 "message is too long".
 */
export async function tgSendMessage(
  botToken: string,
  chatId: number | string,
  text: string,
  opts?: {
    parse_mode?: 'HTML' | 'MarkdownV2'
    disable_web_page_preview?: boolean
    disable_notification?: boolean
  },
): Promise<TgSendResult> {
  const body = {
    chat_id: chatId,
    text,
    parse_mode: opts?.parse_mode ?? 'HTML',
    disable_web_page_preview: opts?.disable_web_page_preview ?? true,
    disable_notification: opts?.disable_notification ?? false,
  }
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  )
  if (res.ok) return { ok: true, status: res.status }
  // Errores: intentamos parsear el JSON de Telegram que trae { ok:false, error_code, description }
  let description: string | undefined
  let retry_after: number | undefined
  try {
    const j: any = await res.json()
    description = j?.description
    retry_after = j?.parameters?.retry_after
  } catch {/* body no era JSON */}
  // 403 Forbidden = user bloqueo al bot; 400 con "chat not found" = chat borrado.
  // Ambos son terminales — el caller debe limpiar D1.
  const gone = res.status === 403
    || (res.status === 400 && /chat not found|user is deactivated/i.test(description ?? ''))
  return { ok: false, status: res.status, gone, description, retry_after }
}

/**
 * Configura el webhook del bot para que los updates lleguen a `<url>`.
 * Usa `secret_token` para que el endpoint pueda validar que el request viene
 * de Telegram (ver `X-Telegram-Bot-Api-Secret-Token` header).
 *
 * Se llama una sola vez (al montar el bot). Idempotente: llamar de nuevo con
 * otra URL reemplaza la anterior.
 */
export async function tgSetWebhook(
  botToken: string,
  url: string,
  secretToken: string,
): Promise<{ ok: boolean; description?: string }> {
  const params = new URLSearchParams({
    url,
    secret_token: secretToken,
    // Solo updates de tipo "message" — no necesitamos callbacks, inline, etc.
    allowed_updates: JSON.stringify(['message']),
    drop_pending_updates: 'true',
  })
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/setWebhook?${params}`,
    { method: 'POST' },
  )
  const j: any = await res.json().catch(() => ({}))
  return { ok: !!j?.ok, description: j?.description }
}

/**
 * Lee info del bot (username, nombre). Util para:
 *   1. Validar que el token es valido al configurarlo.
 *   2. Obtener el username (sin @) para construir deep links `t.me/<username>?start=<token>`.
 */
export async function tgGetMe(botToken: string): Promise<{
  ok: boolean
  username?: string
  first_name?: string
  id?: number
  description?: string
}> {
  const res = await fetch(
    `https://api.telegram.org/bot${encodeURIComponent(botToken)}/getMe`,
  )
  const j: any = await res.json().catch(() => ({}))
  if (!j?.ok) return { ok: false, description: j?.description }
  return {
    ok: true,
    username: j.result?.username,
    first_name: j.result?.first_name,
    id: j.result?.id,
  }
}

/**
 * Escapa texto para uso dentro de `<b>`, `<i>`, etc. con `parse_mode=HTML`.
 * Solo 3 chars necesarios segun docs de Telegram.
 */
export function tgEscapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

/**
 * Genera un token random (hex) para el flow de vinculacion bot↔web.
 * Collision-safe para nuestro uso: 16 bytes = 32 hex chars = ~128 bits de entropia.
 */
export function generateLinkToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}
