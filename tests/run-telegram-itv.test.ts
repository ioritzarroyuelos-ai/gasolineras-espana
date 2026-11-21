import { describe, expect, it, vi } from 'vitest'
import { runTelegramItv } from '../scripts/run-telegram-itv.mjs'
const env = { CRON_TOKEN: 'credencial-ficticia-de-prueba' }
const batch = (extra = {}) => ({ ok: true, dryRun: false, inWindow: true, processed: 1, eligible: 1, sent: 1, skipped: 0, errors: 0, uncertain: 0, nextCursor: null, ...extra })
describe('robot de recordatorios ITV por lotes', () => {
  it('continúa otros destinatarios tras un lote con rechazos y conserva el fallo final', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(batch({ ok: false, sent: 0, errors: 1, nextCursor: 'siguiente' }), { status: 503 })).mockResolvedValueOnce(Response.json(batch()))
    await expect(runTelegramItv(env, fetcher)).rejects.toThrow('1 errores')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1][0]).toContain('cursor=siguiente')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error', method: 'POST' })
  })
  it('una comprobación sin envío exige ese modo y cero mensajes en todos sus lotes', async () => {
    const fetcher = vi.fn().mockImplementation(async () => Response.json(batch({ dryRun: true, sent: 0 })))
    await expect(runTelegramItv({ ...env, DRY_RUN: 'true' }, fetcher)).resolves.toMatchObject({ dryRun: true, sent: 0, batches: 1 })
    expect(fetcher.mock.calls[0][0]).toContain('dry_run=1')
    await expect(runTelegramItv({ ...env, DRY_RUN: 'true' }, async () => Response.json(batch({ dryRun: true })))).rejects.toThrow('cero envíos')
  })
  it('no da éxito fuera de ventana ni con una entrega incierta', async () => {
    await expect(runTelegramItv(env, async () => Response.json(batch({ inWindow: false })))).rejects.toThrow('fuera de la ventana')
    await expect(runTelegramItv(env, async () => Response.json(batch({ sent: 0, uncertain: 1, ok: false }), { status: 503 }))).rejects.toThrow('sin confirmación')
  })
  it('frena paginación repetida y exceso de volumen sin un bucle infinito', async () => {
    await expect(runTelegramItv(env, async () => Response.json(batch({ nextCursor: 'repetido' })))).rejects.toThrow('paginación')
    let n = 0
    await expect(runTelegramItv(env, async () => Response.json(batch({ nextCursor: String(++n) })), 2)).rejects.toThrow('límite de lotes')
  })
  it('no expone credenciales, cursores ni cuerpos de error en la salida', async () => {
    await expect(runTelegramItv(env, async () => { throw Error('secreto y dirección privada') })).rejects.not.toThrow('secreto y dirección privada')
    await expect(runTelegramItv(env, async () => new Response('datos-privados', { status: 401 }))).rejects.toThrow('lote comprobable')
    await expect(runTelegramItv(env, async () => Response.json(batch({ processed: 5000 })))).rejects.toThrow('Contadores')
  })
})
