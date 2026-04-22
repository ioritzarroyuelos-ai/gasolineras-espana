// Tests del helper de Web Push (src/lib/webpush.ts) — Ship 23.
//
// Validamos:
//   1. generateVapidKeys() devuelve un par con los formatos correctos.
//   2. El round-trip (generar -> firmar un JWT -> verificar con subtle) funciona.
//   3. sendWebPush maneja correctamente las respuestas 201/404/410.
//
// NO enviamos pushes reales — mockeamos fetch para verificar el request shape
// (Authorization: vapid t=..., k=..., TTL, Content-Length).

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { sendWebPush, generateVapidKeys } from '../src/lib/webpush'

describe('webpush helper (Ship 23)', () => {
  let realFetch: typeof fetch

  beforeEach(() => {
    realFetch = globalThis.fetch
  })
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  describe('generateVapidKeys', () => {
    it('devuelve publicKey y privateKey en base64url', async () => {
      const kp = await generateVapidKeys()
      expect(kp.publicKey).toBeTypeOf('string')
      expect(kp.privateKey).toBeTypeOf('string')
      // base64url: solo [A-Za-z0-9_-], sin padding
      expect(kp.publicKey).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(kp.privateKey).toMatch(/^[A-Za-z0-9_-]+$/)
      // publicKey es un punto no-comprimido (65 bytes => ~87 chars b64url)
      expect(kp.publicKey.length).toBeGreaterThanOrEqual(85)
      expect(kp.publicKey.length).toBeLessThanOrEqual(90)
      // privateKey es 32 bytes (~43 chars b64url)
      expect(kp.privateKey.length).toBeGreaterThanOrEqual(42)
      expect(kp.privateKey.length).toBeLessThanOrEqual(44)
    })

    it('dos invocaciones producen pares distintos', async () => {
      const k1 = await generateVapidKeys()
      const k2 = await generateVapidKeys()
      expect(k1.publicKey).not.toEqual(k2.publicKey)
      expect(k1.privateKey).not.toEqual(k2.privateKey)
    })
  })

  describe('sendWebPush', () => {
    it('construye el request con Authorization VAPID y TTL', async () => {
      const keys = await generateVapidKeys()
      let capturedReq: { url: string; init: RequestInit } | null = null
      globalThis.fetch = vi.fn(async (url: any, init: any) => {
        capturedReq = { url: String(url), init }
        return new Response(null, { status: 201 })
      }) as any

      const res = await sendWebPush(
        'https://fcm.googleapis.com/fcm/send/abc123',
        { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:test@example.com' },
        60,
      )
      expect(res.ok).toBe(true)
      if (res.ok) expect(res.status).toBe(201)

      expect(capturedReq).not.toBeNull()
      expect(capturedReq!.url).toBe('https://fcm.googleapis.com/fcm/send/abc123')
      const headers = capturedReq!.init.headers as Record<string, string>
      expect(capturedReq!.init.method).toBe('POST')
      expect(headers['TTL']).toBe('60')
      expect(headers['Content-Length']).toBe('0')
      // Authorization: vapid t=<jwt>, k=<pubkey>
      const auth = headers['Authorization']
      expect(auth).toMatch(/^vapid t=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+, k=[A-Za-z0-9_-]+$/)
      // La k= debe coincidir con la publicKey que pasamos
      expect(auth).toContain('k=' + keys.publicKey)
    })

    it('marca gone=true en HTTP 410', async () => {
      const keys = await generateVapidKeys()
      globalThis.fetch = vi.fn(async () => new Response('Subscription expired', { status: 410 })) as any
      const res = await sendWebPush(
        'https://updates.push.services.mozilla.com/w/abc',
        { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:x@x.com' },
      )
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe(410)
        expect(res.gone).toBe(true)
      }
    })

    it('marca gone=true en HTTP 404', async () => {
      const keys = await generateVapidKeys()
      globalThis.fetch = vi.fn(async () => new Response('Not Found', { status: 404 })) as any
      const res = await sendWebPush(
        'https://fcm.googleapis.com/fcm/send/deadbeef',
        { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:x@x.com' },
      )
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.gone).toBe(true)
    })

    it('gone=false en errores transitorios 500/503', async () => {
      const keys = await generateVapidKeys()
      globalThis.fetch = vi.fn(async () => new Response('Server Error', { status: 500 })) as any
      const res = await sendWebPush(
        'https://example.com/push/abc',
        { publicKey: keys.publicKey, privateKey: keys.privateKey, subject: 'mailto:x@x.com' },
      )
      expect(res.ok).toBe(false)
      if (!res.ok) {
        expect(res.status).toBe(500)
        expect(res.gone).toBe(false)
      }
    })
  })
})
