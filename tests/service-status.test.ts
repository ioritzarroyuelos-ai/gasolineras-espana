import { describe, expect, it, vi } from 'vitest'
import { evaluateServices, type ServiceManifest, type ServiceId } from '../src/lib/service-status'
import { serviceStatusHtml } from '../src/html/service-status'
import { monitorMessage } from '../scripts/lib/monitor-message.mjs'
import { instanteLocal } from '../scripts/lib/fechas.mjs'
const now = Date.parse('2026-11-03T20:00:00Z')
function fixture(): ServiceManifest { return { schema: 1, services: (['gasolineras', 'farmacias', 'tiempo', 'itv', 'politica', 'deportes'] as ServiceId[]).map(id => ({ id, name: id, maxAgeHours: 99999, items: [{ name: 'Fuente', updatedAt: new Date(now - 3600000).toISOString(), count: 1 }] })) } }
describe('estado de los servicios', () => {
  it('no considera suficiente que solo gasolineras esté al día', () => {
    const m = fixture(); m.services[1].items[0].updatedAt = '2026-10-01T00:00:00Z'
    const s = evaluateServices(m, now)
    expect(s.ok).toBe(false); expect(s.services[0].ok).toBe(true)
    expect(s.services[1].issues[0].problem).toBe('Actualización atrasada')
    expect(serviceStatusHtml(s, 'nonce')).toContain('Farmacias: con incidencias')
    expect(monitorMessage([], s, 'hoy', 'https://example.test')).toContain('⚠ Farmacias: 1 incidencias')
  })
  it('usa umbrales por servicio y no acepta fechas futuras, inválidas, vacíos o fuentes ausentes', () => {
    const m = fixture()
    m.services[0].items[0].updatedAt = 'ayer'
    m.services[1].items[0].updatedAt = new Date(now + 3600000).toISOString()
    m.services[2].items[0].count = 0
    m.services[3].items[0].updatedAt = new Date(now - 41 * 86400000).toISOString()
    m.services.splice(4)
    expect(evaluateServices(m, now).services.every(s => !s.ok)).toBe(true)
    expect(evaluateServices(null, now).ok).toBe(false)
    expect(evaluateServices(fixture(), now).ok).toBe(true)
  })
  it('conserva avisos parciales y escapa los textos de fuentes externas', () => {
    const m = fixture(); m.services[1].items[0].issue = '<script>malo()</script>'
    const s = evaluateServices(m, now)
    expect(s.ok).toBe(false)
    expect(serviceStatusHtml(s, 'nonce')).toContain('&lt;script&gt;')
    expect(serviceStatusHtml(s, 'nonce')).not.toContain('<script>malo')
  })
  it('ITV requiere una comprobación diaria aunque el documento oficial no haya cambiado', () => {
    const m = fixture(); m.services[3].items[0].updatedAt = new Date(now - 31 * 3600000).toISOString()
    expect(evaluateServices(m, now).services[3].ok).toBe(false)
  })
  it('no envía confirmación verde si falta el estado ni si hay errores recurrentes', () => {
    expect(monitorMessage([], null, 'hoy', 'https://example.test')).toMatch(/^⚠️/)
    expect(monitorMessage([{ count: 2, message: 'fallo' }], evaluateServices(fixture(), now), 'hoy', 'https://example.test')).toMatch(/^⚠️/)
    expect(() => monitorMessage(null, null, 'hoy', '')).toThrow()
  })
  it('interpreta las horas oficiales peninsulares en invierno y verano', () => {
    expect(instanteLocal('2026-11-03T13:00:00')).toBe(Date.parse('2026-11-03T12:00:00Z'))
    expect(instanteLocal('2026-07-03T13:00:00')).toBe(Date.parse('2026-07-03T11:00:00Z'))
    expect(Number.isNaN(instanteLocal('2026-03-29T02:30:00'))).toBe(true)
  })
  it('API y página comparten el resultado de todas las fuentes', async () => {
    vi.resetModules()
    const app = (await import('../src/index')).default
    const m = fixture(); m.services[4].items[0].updatedAt = null
    const ASSETS = { fetch: async () => Response.json(m) }
    const api = await app.request('/api/status', {}, { ASSETS })
    expect(api.status).toBe(503)
    expect((await api.json() as { services: unknown[] }).services).toHaveLength(6)
    const page = await app.request('/status', {}, { ASSETS })
    expect(page.status).toBe(503)
    expect(await page.text()).toContain('Política: con incidencias')
  })
})
