import { describe, expect, it, vi } from 'vitest'
import { disponibilidadSolicitud, disponibilidadIdentidad, disponibilidadMadrid, disponibilidadProximoDiario, disponibilidadClaveEvento, disponibilidadCifraVigente, disponibilidadMensaje, disponibilidadEnviar } from '../scripts/lib/disponibilidad.mjs'
const id = '10000000-0000-4000-8000-000000000001'
const input = { fuente: 'aparcamientos-madrid', lugarId: 'parking-madrid-72', objetivo: 'plazas', consentimiento: 'disponibilidad-telegram-v1', version: id, peticion: id }

describe('permiso separado e identidad', () => {
  it('acepta ambas modalidades y sólo sus campos', () => {
    expect(disponibilidadSolicitud(input, 'temporal')).toBe(true)
    expect(disponibilidadSolicitud({ ...input, hora: '08:37' }, 'diario')).toBe(true)
    for (const extra of [{ chatId: 10 }, { plazas: 5 }, { lat: 40.4 }, { url: 'https://evil.invalid' }, { hora: '08:00' }]) expect(disponibilidadSolicitud({ ...input, ...extra }, 'temporal')).toBe(false)
  })
  it('rechaza mezcla de fuente, ausencia de permiso y revisión inválida', () => {
    for (const change of [{ fuente: 'aparcamientos-vigo' }, { objetivo: 'pmr' }, { consentimiento: false }, { version: null }, { peticion: '' }, { lugarId: 'osm-node-10' }]) expect(disponibilidadSolicitud({ ...input, ...change }, 'temporal')).toBe(false)
    expect(disponibilidadSolicitud({ ...input, hora: '24:00' }, 'diario')).toBe(false)
  })
  it('Bizi distingue bici y anclaje, sin admitir plazas', () => {
    expect(disponibilidadIdentidad('bicis-zaragoza', 'gbfs-zaragoza-A_1', 'bicis')).toBe(true)
    expect(disponibilidadIdentidad('bicis-zaragoza', 'gbfs-zaragoza-A_1', 'anclajes')).toBe(true)
    expect(disponibilidadIdentidad('bicis-zaragoza', 'gbfs-zaragoza-A_1', 'plazas')).toBe(false)
  })
})

describe('horario de Madrid', () => {
  it('convierte invierno y verano, programa futuro sin retrasar un minuto ya pasado', () => {
    expect(disponibilidadMadrid(Date.parse('2026-11-21T07:30:00Z')).hora).toBe('08:30')
    expect(disponibilidadMadrid(Date.parse('2026-07-21T06:30:00Z')).hora).toBe('08:30')
    expect(new Date(disponibilidadProximoDiario('08:30', Date.parse('2026-11-21T07:30:01Z'))).toISOString()).toBe('2026-11-22T07:30:00.000Z')
  })
  it('salto primavera: 02:30 no existe y se pasa a las03:00', () => {
    expect(new Date(disponibilidadProximoDiario('02:30', Date.parse('2026-03-28T20:00:00Z'))).toISOString()).toBe('2026-03-29T01:00:00.000Z')
  })
  it('otoño elige la primera02:30; no usa la segunda para repetir', () => {
    expect(new Date(disponibilidadProximoDiario('02:30', Date.parse('2026-10-24T20:00:00Z'))).toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(new Date(disponibilidadProximoDiario('02:30', Date.parse('2026-10-25T00:31:00Z'))).toISOString()).toBe('2026-10-26T01:30:00.000Z')
  })
  it('el recibo excluye hoy aunque se cambie la hora; un día perdido admite mañana', () => {
    const now = Date.parse('2026-11-21T07:00:00Z')
    expect(new Date(disponibilidadProximoDiario('18:30', now, '2026-11-21')).toISOString()).toBe('2026-11-22T17:30:00.000Z')
    expect(new Date(disponibilidadProximoDiario('18:30', now, '2026-11-20')).toISOString()).toBe('2026-11-21T17:30:00.000Z')
    expect(disponibilidadClaveEvento({ modo: 'diario', id }, Date.parse('2026-11-21T23:30:00Z'))).toBe('diario:2026-11-22')
  })
})

describe('cifra y entrega', () => {
  const now = Date.parse('2026-11-21T12:00:00Z'), point = { estado: 'actual', cantidad: 0, fechaDato: '2026-11-21T11:59:00Z', caduca: '2026-11-21T12:04:00Z' }
  it('cero es real; fecha futura, caducidad exacta, nulo y plazo inventado no', () => {
    expect(disponibilidadCifraVigente(point, now)).toBe(true)
    for (const extra of [{ cantidad: null }, { cantidad: -1 }, { estado: 'caducado' }, { fechaDato: '2026-11-21T12:00:01Z' }, { caduca: '2026-11-21T12:00:00Z' }, { caduca: '2026-11-21T12:06:00Z' }]) expect(disponibilidadCifraVigente({ ...point, ...extra }, now)).toBe(false)
  })
  it('mensaje escapa datos e identifica fecha, fuente y totales, sin reserva', () => {
    const text = disponibilidadMensaje({ modo: 'diario', objetivo: 'plazas' }, { nombre: '<Prueba>', cantidad: 0, fechaDato: point.fechaDato, enlace: 'https://webapp-3ft.pages.dev/cerca', fuenteUrl: 'https://fuente.invalid/' })
    expect(text).toContain('&lt;Prueba&gt;'); expect(text).toContain('0 plazas libres totales'); expect(text).toContain('No indica plazas PMR libres'); expect(text).toContain('21/11/2026 a las 12:59'); expect(text).toContain('No es una reserva')
  })
  it.each([[200, { ok: true, result: { message_id: 1, chat: { id: 10 } } }, 'enviado'], [200, { ok: true }, 'incierto'], [200, { ok: true, result: { message_id: 1, chat: { id: 20 } } }, 'incierto'], [429, { ok: false, error_code: 429, parameters: { retry_after: 90 } }, 'reintentar'], [403, { ok: false, error_code: 403 }, 'baja'], [500, {}, 'incierto'], [200, { ok: false }, 'incierto']] as const)('interpreta respuesta%s sin enviar a red', async (status, body, expected) => {
    const request = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => Response.json(body, { status }))
    expect((await disponibilidadEnviar('prueba', 10, 'texto', request)).estado).toBe(expected)
    expect(request.mock.calls[0][1]?.redirect).toBe('manual')
  })
  it('timeout, redirección y cuerpo grande son inciertos', async () => {
    for (const request of [async () => { throw Error('timeout') }, async () => new Response('', { status: 302, headers: { location: 'https://evil.invalid' } }), async () => new Response('a'.repeat(16385))]) expect((await disponibilidadEnviar('prueba', 10, 'texto', request)).estado).toBe('incierto')
  })
  it.each([
    [200, { ok: false, error_code: 429 }], [201, { ok: true, result: { message_id: 1, chat: { id: 10 } } }],
    [429, { ok: false, error_code: 403 }], [403, { ok: true, error_code: 403 }],
    [500, { ok: false, error_code: 500 }], [502, { ok: false, error_code: 429 }],
    [200, { ok: true, result: { message_id: 1.5, chat: { id: 10 } } }],
    [200, { ok: true, result: { message_id: 1, chat: { id: '10' } } }],
  ])('HTTP%s o una respuesta contradictoria nunca abre reintento', async (status, body) => {
    expect(await disponibilidadEnviar('prueba', 10, 'texto', async () => Response.json(body, { status: Number(status) }))).toEqual({ estado: 'incierto' })
  })
  it.each([undefined, -1, 1.5, '90', Number.MAX_SAFE_INTEGER + 1])('un retry_after inválido usa la espera conservadora: %s', async delay => {
    const response = async () => Response.json({ ok: false, error_code: 429, parameters: { retry_after: delay } }, { status: 429 })
    expect(await disponibilidadEnviar('prueba', 10, 'texto', response)).toEqual({ estado: 'reintentar', espera: 300 })
  })
  it('sólo Telegram puede confirmar la baja; un 400 distinto conserva el aviso', async () => {
    for (const description of ['chat not found', 'user is deactivated']) expect(await disponibilidadEnviar('prueba', 10, 'texto', async () => Response.json({ ok: false, error_code: 400, description }, { status: 400 }))).toEqual({ estado: 'baja' })
    expect(await disponibilidadEnviar('prueba', 10, 'texto', async () => Response.json({ ok: false, error_code: 400, description: 'Bad Request: message is too long' }, { status: 400 }))).toEqual({ estado: 'reintentar', espera: 300 })
  })
  it('el límite también cancela un cuerpo que deja de llegar tras las cabeceras', async () => {
    const controller = new AbortController(), cancel = vi.fn(), timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal)
    const timer = setTimeout(() => controller.abort(), 10)
    try {
      const response = new Response(new ReadableStream({ cancel }))
      expect(await disponibilidadEnviar('prueba', 10, 'texto', async () => response)).toEqual({ estado: 'incierto' })
      expect(cancel).toHaveBeenCalledOnce()
    } finally { clearTimeout(timer); timeout.mockRestore() }
  })
})
