// E2E de `/farmacias/` — pagina con mapa + lista de farmacias OSM.
//
// Comprobamos:
//   - shell renderiza (header, toolbar, layout principal)
//   - fetch del snapshot funciona (count en el header se pinta)
//   - los radios filter son accesibles y uno esta aria-pressed por defecto
//   - canonical + meta description presentes
//   - canonicalizacion /farmacias -> /farmacias/
//   - sin violaciones graves de axe (excluyendo tiles de Leaflet)
//
// No comprobamos geolocalizacion real — Playwright permite mockearla pero
// complicaria el test mas de lo que aporta para un MVP. El boton y el flujo
// se verifican manualmente.

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Farmacias (/farmacias/)', () => {
  test('carga el shell con hero, toolbar y mapa', async ({ page }) => {
    await page.goto('/farmacias/')
    await expect(page).toHaveTitle(/Farmacias.*CercaYa/i)

    // Hero con titulo y boton "volver"
    await expect(page.getByRole('heading', { level: 1, name: /farmacias en españa/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /volver a cercaya/i })).toBeVisible()

    // Toolbar: boton de ubicacion + radios
    await expect(page.getByRole('button', { name: /usar mi ubicación/i })).toBeVisible()
    // Radio de 5km esta pulsado por defecto
    await expect(page.locator('.radius-group button[data-r="5"]')).toHaveAttribute('aria-pressed', 'true')

    // Mapa y lista presentes en el DOM
    await expect(page.locator('#map')).toBeVisible()
    await expect(page.locator('#list')).toBeVisible()
  })

  test('carga el snapshot y muestra el count en el hero', async ({ page }) => {
    await page.goto('/farmacias/')
    // Esperamos a que el fetch del JSON termine y se pinte el contador.
    // Timeout generoso porque el JSON pesa ~1.5MB sin gzip.
    await expect.poll(
      async () => (await page.locator('#hero-count').textContent())?.trim() || '',
      { timeout: 15_000 }
    ).toMatch(/\d+.*farmacias/i)
  })

  test('canonicalizacion /farmacias -> /farmacias/', async ({ page }) => {
    const res = await page.goto('/farmacias')
    expect(res?.status()).toBe(200) // 200 tras seguir el 301
    await expect(page).toHaveURL(/\/farmacias\/?$/)
  })

  test('meta description y canonical presentes', async ({ page }) => {
    await page.goto('/farmacias/')
    const desc = await page.locator('meta[name="description"]').getAttribute('content')
    expect(desc).toBeTruthy()
    expect(desc!.length).toBeGreaterThan(50)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toMatch(/\/farmacias\/$/)
  })

  test('cambiar el radio actualiza aria-pressed', async ({ page }) => {
    await page.goto('/farmacias/')
    // Por defecto 5km. Pulsamos 2km.
    await page.locator('.radius-group button[data-r="2"]').click()
    await expect(page.locator('.radius-group button[data-r="2"]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.radius-group button[data-r="5"]')).toHaveAttribute('aria-pressed', 'false')
  })

  test('sin violaciones graves de axe (excluyendo Leaflet tiles)', async ({ page }) => {
    await page.goto('/farmacias/')
    // Esperamos al bootstrap del mapa para auditar el DOM montado.
    await expect(page.locator('#map .leaflet-container, #map canvas, #map')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // Leaflet mete <img> de tiles sin alt intencionado — igual que en la home.
      .exclude('.leaflet-tile-container')
      .exclude('.leaflet-marker-pane')
      .exclude('.leaflet-popup-pane')
      .analyze()

    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // eslint-disable-next-line no-console
      console.log('axe violations farmacias:', JSON.stringify(severe, null, 2))
    }
    expect(severe).toEqual([])
  })
})
