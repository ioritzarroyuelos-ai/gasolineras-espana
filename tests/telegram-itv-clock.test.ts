import { describe, expect, it } from 'vitest'
// @ts-expect-error Política interna del robot Node.
import { DATA_JOBS, necesitaRecuperacion } from '../scripts/lib/data-recovery.mjs'
const job = DATA_JOBS.find((j: {kind: string}) => j.kind === 'telegram-itv')
const run = (at: number, title = 'Telegram · recordatorios ITV') => ({ status: 'completed', conclusion: 'success', display_title: title, run_started_at: new Date(at).toISOString() })
describe('revisión horaria de recordatorios ITV consentidos', () => {
  it('una alta posterior a la primera pasada tiene otra revisión dentro de la ventana', () => {
    const at = Date.parse('2026-11-21T07:00:00Z')
    expect(necesitaRecuperacion(job, {}, [run(at)], at + 3599999).retry).toBe(false)
    expect(necesitaRecuperacion(job, {}, [run(at)], at + 3600000).retry).toBe(true)
    expect(necesitaRecuperacion(job, {}, [run(at)], at + 4 * 3600000).retry).toBe(false)
  })
  it('no confunde el resumen de precios ni una comprobación sin envío con la entrega ITV', () => {
    const at = Date.parse('2026-11-21T08:00:00Z')
    for (const title of ['Telegram · resumen diario', 'Telegram · ITV comprobación sin envío']) expect(necesitaRecuperacion(job, {}, [run(at, title)], at).retry).toBe(true)
    expect(necesitaRecuperacion(job, {}, [{ status: 'in_progress' }], at).retry).toBe(false)
  })
  it('96 pulsos producen cuatro revisiones dentro de la ventana, también con cambio de hora', () => {
    for (const day of ['2026-03-29', '2026-10-25', '2026-11-21']) {
      const start = Date.parse(day + 'T00:00:00Z'); let runs: ReturnType<typeof run>[] = [], count = 0
      for (let n = 0; n < 96; n++) { const at = start + n * 15 * 60000; if (necesitaRecuperacion(job, {}, runs, at).retry) { count++; runs = [run(at)] } }
      expect(count).toBe(4)
    }
  })
})
