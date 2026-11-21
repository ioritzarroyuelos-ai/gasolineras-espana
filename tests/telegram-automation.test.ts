import { describe, it, expect, vi } from 'vitest'
import { runTelegramDigest } from '../scripts/run-telegram-digest.mjs'

describe('Telegram workflow runner, sin envíos reales', () => {
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  const batch = (extra: Record<string, unknown> = {}) => ({ ok: true, dryRun: false, inWindow: true, processed: 1, chats: 1, work: 0, eligible: 0, sentChats: 0, sentMsgs: 0, skipped: 1, errors: 0, uncertain: 0, purged: 0, deferred: 0, nextCursor: null, ...extra })
  it('el modo normal nunca fuerza ni desactiva la deduplicación', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(batch()))
    await runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, fetcher)
    expect(fetcher.mock.calls[0][0]).toBe('https://webapp-3ft.pages.dev/api/cron/telegram-check')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' })
  })
  it('fuera de ventana y errores/deferred no aparecen como entrega exitosa', async () => {
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response({ ok: true, skipped: 'not_digest_window' }))).rejects.toThrow('ventana')
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response(batch({ deferred: 1 })))).rejects.toThrow('continuación')
  })
  it('dry-run exige confirmación explícita de cero mensajes', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response(batch({ dryRun: true })))
    await runTelegramDigest({ CRON_TOKEN: 'fake-test-only', DRY_RUN: 'true' }, fetcher)
    expect(fetcher.mock.calls[0][0]).toContain('?dry_run=1')
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only', DRY_RUN: 'true' }, async () => response({ ok: true, sentChats: 1 }))).rejects.toThrow('sin envío')
  })
  it('continúa la página tras503 pero termina en fallo aunque la última salga bien', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(batch({ ok: false, errors: 1, skipped: 0, deferred: 1, nextCursor: 'cursor-opaco' }), 503)).mockResolvedValueOnce(response(batch()))
    const pause = vi.fn(async (_ms: number) => {})
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, fetcher, { pause })).rejects.toThrow('pendientes')
    expect(fetcher).toHaveBeenCalledTimes(2); expect(fetcher.mock.calls[1][0]).toContain('cursor=cursor-opaco'); expect(pause).toHaveBeenCalledWith(1100)
  })
  it('suma lotes sin devolver cursores, secretos ni identificadores personales', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(batch({ deferred: 1, nextCursor: 'cursor-opaco' }))).mockResolvedValueOnce(response(batch()))
    const result = await runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, fetcher, { pause: async () => {} })
    expect(result).toMatchObject({ batches: 2, processed: 2, sentMsgs: 0 }); expect(JSON.stringify(result)).not.toMatch(/cursor|fake-test|chat_id/)
  })
  it('rechaza cursor repetido, contador imposible y límite de lotes sin éxito parcial', async () => {
    const options = { pause: async () => {}, maxBatches: 2 }
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response(batch({ deferred: 1, nextCursor: 'repetido' })), options)).rejects.toThrow('no avanza')
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response(batch({ sentMsgs: 13 })), options)).rejects.toThrow('Contadores')
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(batch({ deferred: 1, nextCursor: 'primera' }))).mockResolvedValueOnce(response(batch({ deferred: 1, nextCursor: 'segunda' })))
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, fetcher, options)).rejects.toThrow('límite de lotes')
  })
  it('dry-run no pausa ni permite purgas; las respuestas enormes se rechazan', async () => {
    const pause = vi.fn(async () => {})
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(batch({ dryRun: true, deferred: 1, nextCursor: 'siguiente' }))).mockResolvedValueOnce(response(batch({ dryRun: true })))
    expect(await runTelegramDigest({ CRON_TOKEN: 'fake-test-only', DRY_RUN: 'true' }, fetcher, { pause })).toMatchObject({ batches: 2 })
    expect(pause).not.toHaveBeenCalled()
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only', DRY_RUN: 'true' }, async () => response(batch({ dryRun: true, purged: 1 })))).rejects.toThrow('sin envío')
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => new Response('x'.repeat(16385)))).rejects.toThrow('no válida')
  })
  it('no filtra errores de red que pudieran contener el secreto o el cursor', async () => {
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => { throw Error('fake-test-only cursor privado') })).rejects.toThrow('resultado incierto')
  })
  it('permite avanzar dentro de un chat, pero nunca una continuación vacía', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(batch({ chats: 1, processed: 0, work: 2, skipped: 0, deferred: 1, nextCursor: 'preparacion' }))).mockResolvedValueOnce(response(batch()))
    expect(await runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, fetcher, { pause: async () => {} })).toMatchObject({ work: 2, batches: 2 })
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response(batch({ chats: 1, processed: 0, work: 0, skipped: 0, deferred: 1, nextCursor: 'vacio' })))).rejects.toThrow('no avanza')
  })
})
