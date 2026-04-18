// /privacidad + /cambios: paginas legales estaticas. Tests mas simples que
// la home — solo validamos que renderizan, tienen enlace de vuelta y no
// violan reglas de axe (que deberian ser 0 porque son HTML semantico plano).

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Páginas legales', () => {
  test('/privacidad carga con titulo, contenido y enlace a inicio', async ({ page }) => {
    await page.goto('/privacidad')
    await expect(page).toHaveTitle(/Privacidad/i)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/privacidad/i)
    // Debe haber un enlace de regreso al inicio.
    const home = page.getByRole('link', { name: /inicio|volver|←|gasolineras/i }).first()
    await expect(home).toBeVisible()
  })

  test('/privacidad sin violaciones de axe', async ({ page }) => {
    await page.goto('/privacidad')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // eslint-disable-next-line no-console
      console.log('axe violations /privacidad:', JSON.stringify(severe, null, 2))
    }
    expect(severe).toEqual([])
  })

  test('/cambios carga con historial de versiones', async ({ page }) => {
    await page.goto('/cambios')
    await expect(page).toHaveTitle(/Cambios/i)
    // Al menos v1.4 o superior debe aparecer en el historial.
    await expect(page.locator('body')).toContainText(/v1\.[4-9]/i)
  })

  test('/.well-known/security.txt sirve contenido RFC 9116', async ({ page }) => {
    const res = await page.request.get('/.well-known/security.txt')
    expect(res.status()).toBe(200)
    const body = await res.text()
    expect(body).toMatch(/^Contact:/m)
    expect(body).toMatch(/^Expires:/m)
  })

  test('/api/health devuelve 200 o 503 con JSON valido', async ({ page }) => {
    const res = await page.request.get('/api/health')
    // 200 si el snapshot esta fresco, 503 si lleva >24h. Ambos son respuestas
    // legitimas — lo que NO debe pasar es un 500 o timeout.
    expect([200, 503]).toContain(res.status())
    const body = await res.json()
    expect(body).toHaveProperty('version')
    expect(body).toHaveProperty('ts')
    expect(body).toHaveProperty('stale')
  })
})
