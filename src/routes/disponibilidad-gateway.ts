import type { Hono } from 'hono'
import type { Env } from '../index'
import { compruebaBotGateway, leeCuerpoGateway, mensajeGateway } from '../lib/disponibilidad-gateway'
import { disponibilidadEnviar } from '../../scripts/lib/disponibilidad.mjs'
import {
  GATEWAY_ORIGIN, GATEWAY_PATH_CHECK, GATEWAY_PATH_SEND, GATEWAY_REVISION, GATEWAY_SIGNATURE_HEADER, GATEWAY_MAX_BYTES,
  derivaGatewayKey, gatewayCanonico, gatewayDigest, gatewayFirma, gatewayVerifica,
  gatewayValidaSolicitud, gatewayValidaChallenge, gatewayValidaRespuesta,
} from '../../scripts/lib/disponibilidad-gateway.mjs'
import type { GatewayReply, GatewaySolicitud } from '../../scripts/lib/disponibilidad-gateway.mjs'

const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=UTF-8' }
const unavailable = (status = 503) => Response.json({ ok: false, error: 'gateway_unavailable' }, { status, headers })
const versionId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)

/** A failed or delayed RPC cannot authorize Telegram. A claim may still have
 * committed after a timeout; that attempt remains uncertain, never retried here. */
async function acotado<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error('gateway_rpc_unavailable')), 2000) })])
  } finally { clearTimeout(timer) }
}

export function registerDisponibilidadGatewayRoutes(app: Hono<{ Bindings: Env }>) {
  for (const op of ['check', 'send'] as const) {
    const path = op === 'check' ? GATEWAY_PATH_CHECK : GATEWAY_PATH_SEND
    app.post(path, async c => {
      // All errors are closed codes. Never pass an RPC/fetch exception to the
      // shared logger: its message may contain credentials or a chat identifier.
      try {
        const url = new URL(c.req.url), request = c.req.raw
        if (url.origin !== GATEWAY_ORIGIN || url.pathname !== path || url.search || url.username || url.password) return unavailable(404)
        const signature = c.req.header(GATEWAY_SIGNATURE_HEADER) || ''
        if (!/^[a-f0-9]{64}$/.test(signature)) return unavailable(401)
        if (!/^application\/json(?:\s*;|$)/i.test(c.req.header('content-type') || '')) return unavailable(400)
        if (!c.env.CRON_TOKEN || !c.env.DISPONIBILIDAD) return unavailable()
        const raw = await leeCuerpoGateway(request, GATEWAY_MAX_BYTES, AbortSignal.any([request.signal, AbortSignal.timeout(3000)]))
        if (raw === null) return unavailable(400)
        const key = await derivaGatewayKey(c.env.CRON_TOKEN)
        if (!await gatewayVerifica(key, path, raw, signature)) return unavailable(401)
        let decoded: unknown
        try { decoded = JSON.parse(raw) } catch { return unavailable(400) }
        if (raw !== gatewayCanonico(decoded)) return unavailable(400)
        const input = gatewayValidaSolicitud(decoded, op, Date.now())
        if (!input || request.signal.aborted) return unavailable(400)
        const digest = await gatewayDigest(raw), binding = c.env.DISPONIBILIDAD
        const state = await acotado(binding.estado())
        if (!state || state.schema !== 1 || state.revision !== 'disponibilidad-v1' || state.gatewayRevision !== GATEWAY_REVISION || !versionId(state.versionId)) return unavailable()
        const fresh = () => !request.signal.aborted && gatewayValidaSolicitud(input, op, Date.now()) !== null
        if (!fresh()) return unavailable()

        const signed = async (value: GatewayReply, original: GatewaySolicitud): Promise<Response> => {
          if (request.signal.aborted || !gatewayValidaRespuesta(value, original, digest, Date.now())) return unavailable()
          const body = gatewayCanonico(value), signedValue = await gatewayFirma(key, path, body, 'response')
          if (request.signal.aborted || !gatewayValidaRespuesta(value, original, digest, Date.now())) return unavailable()
          return new Response(body, { status: 200, headers: { ...headers, [GATEWAY_SIGNATURE_HEADER]: signedValue } })
        }
        const base = () => ({ schema: 1 as const, environment: 'production' as const, nonce: input.nonce, issuedAt: Date.now(), expiresAt: input.expiresAt,
          requestDigest: digest, workerVersion: state.versionId!, revision: GATEWAY_REVISION })

        // Snapshot this request's credentials. A later secret rotation must not
        // switch the bot between getMe and the send authorized by that check.
        const botEnv = { TELEGRAM_BOT_TOKEN: c.env.TELEGRAM_BOT_TOKEN, TELEGRAM_BOT_USERNAME: c.env.TELEGRAM_BOT_USERNAME }
        if (input.op === 'check') {
          if (typeof binding.gatewayChallenge !== 'function') return unavailable()
          const bot = await compruebaBotGateway(botEnv)
          if (!bot.ok || !fresh()) return unavailable()
          const proof = await acotado(binding.gatewayChallenge({ nonce: input.nonce, issuedAt: input.issuedAt, expiresAt: input.expiresAt }))
          if (!fresh() || !await gatewayValidaChallenge(key, proof, input.nonce, state.versionId, Date.now())) return unavailable()
          return signed({ ...base(), op: 'check', ok: true, bot: { expectedUsername: bot.expectedUsername, credentialUsername: bot.credentialUsername }, worker: proof }, input)
        }

        if (c.env.DISPONIBILIDAD_ENABLED !== 'true' || state.habilitado !== true || state.configurado !== true || state.versionId !== input.workerVersion || typeof binding.claimGateway !== 'function') return unavailable()
        const bot = await compruebaBotGateway(botEnv)
        if (!bot.ok || !fresh()) return unavailable()
        const claim = { chat: input.chat, modo: input.modo, avisoId: input.avisoId, version: input.version, event: input.event, attempt: input.attempt,
          workerVersion: input.workerVersion, nonce: input.nonce, issuedAt: input.issuedAt, expiresAt: input.expiresAt, digest }
        const claimed = await acotado(binding.claimGateway(claim))
        if (claimed !== true) return unavailable(409)
        // No await between this last freshness check and initiating Telegram.
        // Cancellation before the atomic claim prevents the send. After it,
        // an attempt can already be in flight and cannot be recalled.
        if (!fresh()) return unavailable()
        const result = await disponibilidadEnviar(botEnv.TELEGRAM_BOT_TOKEN!, input.chat, mensajeGateway(input))
        return signed({ ...base(), op: 'send', attempt: input.attempt, ...result }, input)
      } catch { return unavailable() }
    })
  }
}
