// Tests del helper de Telegram (src/lib/telegram.ts) — Ship 25.
//
// Validamos:
//   1. tgSendMessage construye el request correcto y parsea respuestas OK.
//   2. Respuesta 403 => gone=true (user bloqueo al bot).
//   3. Respuesta 400 con "chat not found" => gone=true.
//   4. Respuesta 429 extrae retry_after de parameters.
//   5. generateLinkToken produce 32 hex chars (16 bytes de entropia).
//   6. tgEscapeHtml escapa &, <, > (los 3 chars que exige la API).
//
// NO hablamos con api.telegram.org — mockeamos fetch para inspeccionar el
// request shape y simular respuestas de error.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  tgSendMessage,
  tgEscapeHtml,
  generateLinkToken,
  tgParsePrice,
  buildPreciosMessages,
} from '../src/lib/telegram'

describe('telegram helper (Ship 25)', () => {
  let realFetch: typeof fetch

  beforeEach(() => {
    realFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  describe('tgSendMessage', () => {
    it('construye POST a /bot<token>/sendMessage con JSON correcto', async () => {
      let capturedReq: { url: string; init: RequestInit } | null = null
      globalThis.fetch = vi.fn(async (url: any, init: any) => {
        capturedReq = { url: String(url), init }
        return new Response('{"ok":true}', { status: 200 })
      }) as any

      const res = await tgSendMessage('123:ABC-DEF', 98765, 'hola <b>mundo</b>')
      expect(res.ok).toBe(true)
      expect(res.status).toBe(200)

      expect(capturedReq).not.toBeNull()
      // URL: path debe contener el token encoded
      expect(capturedReq!.url).toContain('/bot123%3AABC-DEF/sendMessage')
      expect(capturedReq!.init.method).toBe('POST')
      const headers = capturedReq!.init.headers as Record<string, string>
      expect(headers['Content-Type']).toBe('application/json')
      // Body: debe contener chat_id, text, parse_mode=HTML por defecto, disable_web_page_preview=true
      const body = JSON.parse(capturedReq!.init.body as string)
      expect(body.chat_id).toBe(98765)
      expect(body.text).toBe('hola <b>mundo</b>')
      expect(body.parse_mode).toBe('HTML')
      expect(body.disable_web_page_preview).toBe(true)
      expect(body.disable_notification).toBe(false)
    })

    it('permite override de parse_mode y notification', async () => {
      let body: any = null
      globalThis.fetch = vi.fn(async (_url: any, init: any) => {
        body = JSON.parse(init.body as string)
        return new Response('{"ok":true}', { status: 200 })
      }) as any

      await tgSendMessage('T', 1, 'x', {
        parse_mode: 'MarkdownV2',
        disable_notification: true,
        disable_web_page_preview: false,
      })
      expect(body.parse_mode).toBe('MarkdownV2')
      expect(body.disable_notification).toBe(true)
      expect(body.disable_web_page_preview).toBe(false)
    })

    it('marca gone=true en HTTP 403 (user bloqueo al bot)', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('{"ok":false,"error_code":403,"description":"Forbidden: bot was blocked by the user"}', { status: 403 }),
      ) as any
      const res = await tgSendMessage('T', 1, 'x')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(403)
      expect(res.gone).toBe(true)
    })

    it('marca gone=true en HTTP 400 con "chat not found"', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}', { status: 400 }),
      ) as any
      const res = await tgSendMessage('T', 1, 'x')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(400)
      expect(res.gone).toBe(true)
    })

    it('marca gone=true en HTTP 400 con "user is deactivated"', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('{"ok":false,"error_code":400,"description":"Bad Request: user is deactivated"}', { status: 400 }),
      ) as any
      const res = await tgSendMessage('T', 1, 'x')
      expect(res.gone).toBe(true)
    })

    it('NO marca gone en HTTP 400 con otros motivos (bad request generico)', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('{"ok":false,"error_code":400,"description":"Bad Request: message text is empty"}', { status: 400 }),
      ) as any
      const res = await tgSendMessage('T', 1, '')
      expect(res.ok).toBe(false)
      expect(res.gone).toBe(false)
    })

    it('extrae retry_after en HTTP 429', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('{"ok":false,"error_code":429,"description":"Too Many Requests","parameters":{"retry_after":42}}', { status: 429 }),
      ) as any
      const res = await tgSendMessage('T', 1, 'x')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(429)
      expect(res.retry_after).toBe(42)
      expect(res.gone).toBe(false)
    })

    it('gone=false en errores transitorios 500/503', async () => {
      globalThis.fetch = vi.fn(async () =>
        new Response('Server Error', { status: 500 }),
      ) as any
      const res = await tgSendMessage('T', 1, 'x')
      expect(res.ok).toBe(false)
      expect(res.status).toBe(500)
      expect(res.gone).toBe(false)
    })
  })

  describe('tgEscapeHtml', () => {
    it('escapa &, < y >', () => {
      expect(tgEscapeHtml('<b>Tom & Jerry</b>')).toBe('&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;')
    })
    it('NO escapa comillas (Telegram HTML las acepta crudas)', () => {
      expect(tgEscapeHtml('say "hola" \'adios\'')).toBe('say "hola" \'adios\'')
    })
    it('es idempotente con strings sin chars especiales', () => {
      expect(tgEscapeHtml('hola mundo 123')).toBe('hola mundo 123')
    })
  })

  describe('generateLinkToken', () => {
    it('devuelve 32 hex chars (16 bytes)', () => {
      const t = generateLinkToken()
      expect(t).toMatch(/^[0-9a-f]{32}$/)
    })
    it('dos invocaciones producen tokens distintos', () => {
      const a = generateLinkToken()
      const b = generateLinkToken()
      expect(a).not.toEqual(b)
    })
  })
})

// ============================================================
// Ship 27: resumen diario de precios (/precios + cron 8:00)
// ============================================================
describe('tgParsePrice (Ship 27)', () => {
  it('parsea decimal con coma española', () => {
    expect(tgParsePrice('1,459')).toBeCloseTo(1.459, 3)
  })
  it('parsea decimal con punto', () => {
    expect(tgParsePrice('1.459')).toBeCloseTo(1.459, 3)
  })
  it('null para vacio / undefined', () => {
    expect(tgParsePrice('')).toBeNull()
    expect(tgParsePrice(undefined)).toBeNull()
  })
  it('null para cero o negativo (estacion no distribuye)', () => {
    expect(tgParsePrice('0')).toBeNull()
    expect(tgParsePrice('0,000')).toBeNull()
  })
  it('null para texto no numerico', () => {
    expect(tgParsePrice('abc')).toBeNull()
  })
})

describe('buildPreciosMessages (Ship 27)', () => {
  // Fabrica un registro de estacion estilo snapshot del Ministerio.
  function st(rotulo: string, municipio: string, cols: Record<string, string> = {}) {
    return { Rotulo: rotulo, Municipio: municipio, ...cols }
  }
  const FECHA = 'domingo, 7 de septiembre'

  it('lista una linea por estacion con el precio del combustible elegido', () => {
    const by = new Map<string, Record<string, string>>([
      ['1', st('Repsol', 'Madrid', { 'Precio Gasolina 95 E5': '1,459' })],
      ['2', st('Cepsa', 'Bilbao', { 'Precio Gasoleo A': '1,389' })],
    ])
    const msgs = buildPreciosMessages(
      [{ station_id: '1', fuel_code: '95' }, { station_id: '2', fuel_code: 'diesel' }],
      by, FECHA,
    )
    expect(msgs).toHaveLength(1)
    const m = msgs[0]
    expect(m).toContain('Tus gasolineras')
    expect(m).toContain(FECHA)
    expect(m).toContain('Repsol')
    expect(m).toContain('Madrid')
    expect(m).toContain('Gasolina 95')
    expect(m).toContain('1.459 €/L')
    expect(m).toContain('Cepsa')
    expect(m).toContain('Diesel')
    expect(m).toContain('1.389 €/L')
    // footer con los comandos
    expect(m).toContain('/precios')
    expect(m).toContain('/stop')
  })

  it('omite estaciones que ya no estan en el snapshot', () => {
    const by = new Map<string, Record<string, string>>([
      ['1', st('Repsol', 'Madrid', { 'Precio Gasolina 95 E5': '1,459' })],
    ])
    const msgs = buildPreciosMessages(
      [{ station_id: '1', fuel_code: '95' }, { station_id: '999', fuel_code: '95' }],
      by, FECHA,
    )
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('Repsol')
    expect(msgs[0]).not.toContain('999')
  })

  it('devuelve [] si ninguna estacion es resoluble (no manda mensaje vacio)', () => {
    const by = new Map<string, Record<string, string>>()
    const msgs = buildPreciosMessages([{ station_id: '1', fuel_code: '95' }], by, FECHA)
    expect(msgs).toEqual([])
  })

  it('muestra "sin dato hoy" cuando la estacion no publica ese combustible', () => {
    const by = new Map<string, Record<string, string>>([
      ['1', st('Repsol', 'Madrid', { 'Precio Gasolina 95 E5': '' })],
    ])
    const msgs = buildPreciosMessages([{ station_id: '1', fuel_code: '95' }], by, FECHA)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]).toContain('sin dato hoy')
    expect(msgs[0]).not.toContain('€/L')
  })

  it('escapa HTML en rotulo y municipio', () => {
    const by = new Map<string, Record<string, string>>([
      ['1', st('Gas & <b>Go</b>', 'Villa <script>', { 'Precio Gasolina 95 E5': '1,200' })],
    ])
    const msgs = buildPreciosMessages([{ station_id: '1', fuel_code: '95' }], by, FECHA)
    expect(msgs[0]).toContain('Gas &amp; &lt;b&gt;Go&lt;/b&gt;')
    expect(msgs[0]).toContain('Villa &lt;script&gt;')
  })

  it('trocea en varios mensajes si supera el limite de Telegram', () => {
    const by = new Map<string, Record<string, string>>()
    const subs: Array<{ station_id: string; fuel_code: string }> = []
    // 200 estaciones con nombre largo -> obliga a trocear.
    for (let i = 0; i < 200; i++) {
      const id = String(i)
      by.set(id, st('Estacion de servicio numero ' + i + ' con nombre largo', 'Municipio ' + i, { 'Precio Gasolina 95 E5': '1,459' }))
      subs.push({ station_id: id, fuel_code: '95' })
    }
    const msgs = buildPreciosMessages(subs, by, FECHA)
    expect(msgs.length).toBeGreaterThan(1)
    // Ningun mensaje supera el tope de 4096 chars de Telegram.
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(4096)
    // Header solo en el primero, footer solo en el ultimo.
    expect(msgs[0]).toContain('Tus gasolineras')
    expect(msgs[msgs.length - 1]).toContain('/precios')
    // El resto no repite header.
    for (let i = 1; i < msgs.length; i++) expect(msgs[i]).not.toContain('Tus gasolineras')
  })
})
