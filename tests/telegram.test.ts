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
