// Portada del portal CercaYa en `/` — diseño "periódico" (Ship 28). HTML
// estatico sin JS. Comprobamos: cabecera de marca, menú de secciones con enlace
// a cada vertical (El tiempo, Gasolineras, Farmacias, ITV), navegación al
// clicar, los shortcuts PWA viejos (?action=) siguen redirigiendo al mapa, sin
// axe violations y con meta description + canonical.

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Portada CercaYa (/)', () => {
  test('cabecera de marca + menú con las 4 secciones', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/CercaYa/i)

    // Cabecera de periódico: H1 de la marca.
    await expect(page.getByRole('heading', { level: 1, name: /cercaya/i })).toBeVisible()

    // Menú de secciones con enlace a cada vertical.
    await expect(page.locator('.mh-nav a[href="/tiempo/"]')).toBeVisible()
    await expect(page.locator('.mh-nav a[href="/gasolineras/"]')).toBeVisible()
    await expect(page.locator('.mh-nav a[href="/farmacias/"]')).toBeVisible()
    await expect(page.locator('.mh-nav a[href="/itv/"]')).toBeVisible()

    // Bloques de portada (cada uno con su h2).
    await expect(page.getByRole('heading', { level: 2, name: /el tiempo hoy/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^gasolineras$/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /farmacias/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /^itv$/i })).toBeVisible()

    // El bloque del tiempo siempre lleva un enlace a /tiempo/ (haya o no franja
    // de ciudades: si el snapshot no está fresco, degrada al gancho de búsqueda).
    await expect(page.locator('.lead a.more[href="/tiempo/"]')).toBeVisible()
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
  })
})
