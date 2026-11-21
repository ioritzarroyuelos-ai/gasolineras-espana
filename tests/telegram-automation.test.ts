import { describe, it, expect, vi } from 'vitest'
import { runTelegramDigest } from '../scripts/run-telegram-digest.mjs'

describe('Telegram workflow runner, sin envíos reales', () => {
  const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
  it('el modo normal nunca fuerza ni desactiva la deduplicación', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ ok: true, sentChats: 0, sentMsgs: 0, skipped: 3 }))
    await runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, fetcher)
    expect(fetcher.mock.calls[0][0]).toBe('https://webapp-3ft.pages.dev/api/cron/telegram-check')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' })
  })
  it('fuera de ventana y errores/deferred no aparecen como entrega exitosa', async () => {
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response({ ok: true, skipped: 'not_digest_window' }))).rejects.toThrow('ventana')
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only' }, async () => response({ ok: false, deferred: 2 }, 503))).rejects.toThrow('HTTP 503')
  })
  it('dry-run exige confirmación explícita de cero mensajes', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response({ ok: true, dryRun: true, sentChats: 0, sentMsgs: 0 }))
    await runTelegramDigest({ CRON_TOKEN: 'fake-test-only', DRY_RUN: 'true' }, fetcher)
    expect(fetcher.mock.calls[0][0]).toContain('?dry_run=1')
    await expect(runTelegramDigest({ CRON_TOKEN: 'fake-test-only', DRY_RUN: 'true' }, async () => response({ ok: true, sentChats: 1 }))).rejects.toThrow('sin envío')
  })
})
