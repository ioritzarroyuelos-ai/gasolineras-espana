import { describe, it, expect } from 'vitest'
// QW7: las cabeceras de seguridad se habian ido derivando por copia-pega y 4
// verticales perdieron COOP/CORP/Permissions-Policy y el reporte de CSP. Este
// test fija el contrato para las 5 builders y evita que la deriva vuelva.
import { tiempoHeaders } from '../src/html/tiempo'
import { itvHeaders } from '../src/html/itv'
import { guardiaHeaders } from '../src/html/guardia-municipio'
import { observatorioHeaders } from '../src/html/observatorio'
import { farmaciasHeaders } from '../src/html/farmacias'

const builders: Record<string, (nonce: string) => Record<string, string>> = {
  tiempoHeaders, itvHeaders, guardiaHeaders, observatorioHeaders, farmaciasHeaders,
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
      expect(h['Cross-Origin-Opener-Policy']).toBe('same-origin')
      expect(h['Cross-Origin-Resource-Policy']).toBe('same-origin')
      expect(h['Permissions-Policy']).toContain('interest-cohort=()')
      expect(h['Reporting-Endpoints']).toContain('csp-endpoint')
    })
  }
})
