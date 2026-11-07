// La portada Cerca de ti conserva navegación, metadatos y acceso a las seis
// secciones. Mi día añade personalización sin depender del cliente del mapa.

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Portada España Útil (/)', () => {
  test('cabecera compartida, seis secciones y acceso visible a Mi día', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/España Útil/i)

    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Hoy lo tienes\s+más cerca\./)
    await expect(page.locator('.mh-title')).toHaveText(/España Útil/i)

    for (const seccion of ['tiempo', 'gasolineras', 'farmacias', 'itv', 'politica', 'deportes']) {
      await expect(page.locator('.mh-nav a[href="/' + seccion + '/"]')).toBeVisible()
      await expect(page.locator('[data-dia-module="' + seccion + '"]')).toBeVisible()
    }
    await expect(page.locator('.masthead a[href="/mi-dia"]')).toBeVisible()
    await page.locator('.masthead a[href="/mi-dia"]').click()
    await expect(page).toHaveURL(/\/mi-dia$/)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Tu día\.\s+A tu manera\./)
  })

  test('clicar Gasolineras en el menú navega a /gasolineras/', async ({ page }) => {
    await page.goto('/')
    await page.locator('.mh-nav a[href="/gasolineras/"]').click()
    await expect(page).toHaveURL(/\/gasolineras\/?$/)
  })

  test('clicar Farmacias en el menú navega a /farmacias/', async ({ page }) => {
    await page.goto('/')
    await page.locator('.mh-nav a[href="/farmacias/"]').click()
    await expect(page).toHaveURL(/\/farmacias\/?$/)
  })

  test('clicar El tiempo en el menú navega a /tiempo/', async ({ page }) => {
    await page.goto('/')
    await page.locator('.mh-nav a[href="/tiempo/"]').click()
    await expect(page).toHaveURL(/\/tiempo\/?$/)
  })

  test('shortcut PWA viejo (/?action=cheapest) redirige a /gasolineras/mapa', async ({ page }) => {
    // El 301 lo sigue el navegador automáticamente. Comprobamos la URL final.
    const res = await page.goto('/?action=cheapest')
    expect(res?.status()).toBe(200) // 200 tras seguir el 301
    await expect(page).toHaveURL(/\/gasolineras\/mapa\?action=cheapest$/)
  })

  test('portada sin violaciones graves de axe', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // eslint-disable-next-line no-console
      console.log('axe violations portada:', JSON.stringify(severe, null, 2))
    }
    expect(severe).toEqual([])
  })

  test('meta description y canonical presentes y correctos', async ({ page }) => {
    await page.goto('/')
    const desc = await page.locator('meta[name="description"]').getAttribute('content')
    expect(desc).toBeTruthy()
    expect(desc!.length).toBeGreaterThan(50)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toMatch(/\/$/)
    await expect(page.locator('meta[name="google-site-verification"]')).toHaveAttribute('content', 'qzv_20xQiNesXM4hX5ZqYozonYMqZhY-Wop2Tndu81w')
    await expect(page.locator('script[src*="/static/app.js"]')).toHaveCount(0)
  })
})
