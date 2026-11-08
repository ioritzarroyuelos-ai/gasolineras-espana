import { describe, it, expect } from 'vitest'
// QW7: las cabeceras de seguridad se habian ido derivando por copia-pega y 4
// verticales perdieron COOP/CORP/Permissions-Policy y el reporte de CSP. Este
// test fija el contrato de las páginas y evita que la deriva vuelva.
import { tiempoHeaders } from '../src/html/tiempo'
import { itvHeaders } from '../src/html/itv'
import { guardiaHeaders } from '../src/html/guardia-municipio'
import { observatorioHeaders } from '../src/html/observatorio'
import { farmaciasHeaders } from '../src/html/farmacias'
import { gasolinerasLandingHeaders } from '../src/html/gasolineras'
import { politicaHeaders } from '../src/html/politica'
import { pageHeaders, withAccountHeaders } from '../src/lib/runtime'

const builders: Record<string, (nonce: string) => Record<string, string>> = {
  tiempoHeaders, itvHeaders, guardiaHeaders, observatorioHeaders, farmaciasHeaders,
  gasolinerasLandingHeaders, politicaHeaders,
}

describe('cabeceras de seguridad uniformes (QW7)', () => {
  for (const [name, fn] of Object.entries(builders)) {
    it(name + ' lleva el set completo de hardening + reporte de CSP', () => {
      const h = fn('test-nonce')
      const csp = h['Content-Security-Policy']
      expect(csp).toContain("script-src 'self' 'nonce-test-nonce'")
      expect(csp).toContain("object-src 'none'")
      expect(csp).toContain('report-uri /api/csp-report')
      expect(csp).toContain('report-to csp-endpoint')
      expect(h['Strict-Transport-Security']).toContain('max-age=')
      expect(h['X-Content-Type-Options']).toBe('nosniff')
      expect(h['X-Frame-Options']).toBe('DENY')
      expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin')
      expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin-allow-popups')
      expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin')
      expect(h['Permissions-Policy']).toContain('interest-cohort=()')
      expect(h['Reporting-Endpoints']).toContain('csp-endpoint')
      expect(csp).not.toContain('unsafe-inline')
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).toContain("style-src 'self' 'nonce-test-nonce' https://accounts.google.com/gsi/style")
      expect(csp).toContain("script-src 'self' 'nonce-test-nonce' https://accounts.google.com/gsi/client")
      expect(csp).toContain("connect-src 'self' https://accounts.google.com/gsi/")
      expect(csp).toContain("frame-src 'self' https://accounts.google.com/gsi/")
      expect(csp).toContain("img-src 'self' data:")
      expect(csp).not.toContain('tiles.openfreemap.org')
      expect(csp).not.toContain('googleusercontent.com')
    })
  }
})

describe('acceso de Google sin ampliar otras políticas', () => {
  it('conserva nonce, Turnstile y mapas en la página interactiva', () => {
    const headers = pageHeaders('mapa-nonce', true)
    const csp = headers['Content-Security-Policy']
    expect(csp).toContain("'nonce-mapa-nonce'")
    expect(csp).toContain('https://challenges.cloudflare.com')
    expect(csp).toContain('https://tiles.openfreemap.org')
    expect(csp).toContain('https://tms-pnoa-ma.idee.es')
    expect(csp).toContain('https://accounts.google.com/gsi/client')
    expect(csp).not.toContain('unsafe-inline')
    expect(headers['Cache-Control']).toBe('no-store')
    expect(headers['Permissions-Policy']).toContain('geolocation=(self)')
    expect(withAccountHeaders(headers)).toEqual(headers)
  })

  it('conserva las políticas de caducidad y el límite de medianoche de ITV', () => {
    expect(tiempoHeaders('n')['Cache-Control']).toBe('no-cache')
    expect(guardiaHeaders('n')['Cache-Control']).toBe('no-store')
    expect(observatorioHeaders('n')['Cache-Control']).toBe('public, max-age=900, s-maxage=3600')
    expect(politicaHeaders('n')['Cache-Control']).toBe('public, max-age=1800, s-maxage=3600')
    for (const builder of [farmaciasHeaders, gasolinerasLandingHeaders]) {
      expect(builder('n')['Cache-Control']).toBe('public, max-age=300, stale-while-revalidate=3600')
    }
    expect(itvHeaders('n', Date.parse('2026-11-08T22:59:30Z'))['Cache-Control']).toBe('public, max-age=30, s-maxage=30')
  })

  it('no modifica las respuestas API ni sus cabeceras de origen y caché', () => {
    const api = { 'Content-Type': 'application/json', 'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Opener-Policy': 'same-origin', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://webapp-3ft.pages.dev' }
    expect(withAccountHeaders(api)).toEqual(api)
    expect(withAccountHeaders({ 'Content-Type': 'text/html' })).toEqual({ 'Content-Type': 'text/html' })
  })

  it('hereda las restricciones de frames y deja intacta la cabecera original', () => {
    const original = { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; child-src 'self'; script-src 'nonce-único'; style-src 'nonce-único'; img-src 'self' data:; form-action 'self'", 'Cache-Control': 'public, max-age=30' }
    const before = { ...original }
    const enriched = withAccountHeaders(original)
    expect(original).toEqual(before)
    expect(enriched['Content-Security-Policy']).toContain("frame-src 'self' https://accounts.google.com/gsi/")
    expect(enriched['Content-Security-Policy']).toContain('connect-src https://accounts.google.com/gsi/')
    expect(enriched['Content-Security-Policy']).toContain("default-src 'none'")
    expect(enriched['Content-Security-Policy']).toContain("img-src 'self' data:")
    expect(enriched['Cache-Control']).toBe(original['Cache-Control'])
  })
})
