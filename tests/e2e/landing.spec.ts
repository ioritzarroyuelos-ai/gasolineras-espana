// Landing del portal CercaYa en `/`. Tests sencillos — es HTML estatico sin
// JS. Comprobamos: renderiza los 3 tiles, Gasolineras + Farmacias son
// clickables (ITV sigue proximamente), los shortcuts PWA viejos (?action=)
// siguen redirigiendo al mapa, sin axe violations y sin fetch de red raros.

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Landing CercaYa (/)', () => {
  test('renderiza los 3 tiles (Gasolineras y Farmacias activos, ITV próximamente)', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/CercaYa/i)

    // H1 de la marca
    await expect(page.getByRole('heading', { level: 1, name: /cercaya/i })).toBeVisible()

    // 3 tiles, cada uno con su h2
    await expect(page.getByRole('heading', { level: 2, name: /gasolineras/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /farmacias/i })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: /itv/i })).toBeVisible()

    // Gasolineras tile tiene link al mapa.
    const gasTile = page.getByRole('link', { name: /abrir gasolineras/i })
    await expect(gasTile).toBeVisible()
    await expect(gasTile).toHaveAttribute('href', '/gasolineras/')

    // Farmacias tile tiene link a /farmacias/.
    const farmTile = page.getByRole('link', { name: /abrir farmacias/i })
    await expect(farmTile).toBeVisible()
    await expect(farmTile).toHaveAttribute('href', '/farmacias/')

    // Solo ITV queda "Próximamente" — 1 solo badge-coming.
    const comingBadges = page.locator('.badge-coming')
    await expect(comingBadges).toHaveCount(1)
  })

  test('clicar el tile Gasolineras navega a /gasolineras/', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /abrir gasolineras/i }).click()
    await expect(page).toHaveURL(/\/gasolineras\/?$/)
  })

  test('clicar el tile Farmacias navega a /farmacias/', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: /abrir farmacias/i }).click()
    await expect(page).toHaveURL(/\/farmacias\/?$/)
  })

  test('shortcut PWA viejo (/?action=cheapest) redirige a /gasolineras/?action=cheapest', async ({ page }) => {
    // El 301 lo sigue el navegador automáticamente. Comprobamos la URL final
    // y que cargue el shell del mapa.
    const res = await page.goto('/?action=cheapest')
    expect(res?.status()).toBe(200) // 200 tras seguir el 301
    await expect(page).toHaveURL(/\/gasolineras\/?\?action=cheapest$/)
    await expect(page).toHaveTitle(/gasolineras/i)
  })

  test('landing sin violaciones graves de axe', async ({ page }) => {
    await page.goto('/')
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // eslint-disable-next-line no-console
      console.log('axe violations landing:', JSON.stringify(severe, null, 2))
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
