import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('las fichas de ITV tienen teléfonos separados, nombre y destino', async ({ page }) => {
  await page.goto('/itv/zaragoza/utebo')
  const card = page.locator('article.card').first()
  await expect(card.getByRole('heading', { level: 3 })).toBeVisible()
  const telefonos = card.locator('a[href^="tel:"]')
  expect(await telefonos.count()).toBeGreaterThan(0)
  for (const link of await telefonos.all()) expect(await link.getAttribute('href')).toMatch(/^tel:[6789]\d{8}$/)
  const destino = card.getByRole('link', { name: /Cómo llegar|Buscar dirección en el mapa/ })
  await expect(destino).toHaveAttribute('href', /^https:\/\/www\.google\.com\/maps\//)
  if ((await destino.getAttribute('href'))?.includes('/search/')) {
    await expect(destino).toHaveText('Buscar dirección en el mapa')
    await expect(card).toContainText('Ubicación exacta pendiente de confirmar')
  }
})

test('precios: elegir diésel funciona sin JavaScript y ordena los importes', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.goto((test.info().project.use.baseURL || 'http://127.0.0.1:8788') + '/itv/precios')
  await page.getByLabel('Combustible del coche').selectOption('diesel')
  await page.getByRole('button', { name: 'Comparar', exact: true }).click()
  await expect(page).toHaveURL(/combustible=diesel/)
  await expect(page.getByRole('heading', { name: 'Precios para diésel' })).toBeVisible()
  const importes = (await page.locator('.precios .precio-linea b').allTextContents()).map(x => Number(x.replace(' €', '').replace(',', '.')))
  const pendientes = await page.locator('.precios .pendiente').count()
  expect(importes.length + pendientes).toBe(await page.locator('.precios .precio-box').count())
  expect(importes.length + pendientes).toBeGreaterThan(0)
  expect(importes).toEqual([...importes].sort((a, b) => a - b))
  await context.close()
})

test('ITV móvil: cabecera compacta, precios legibles y sin desbordar', async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    for (const route of ['/itv/', '/itv/zaragoza/utebo', '/itv/precios']) {
      await page.goto(route)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
      const header = await page.locator('.masthead').boundingBox()
      // Google conserva su nombre completo; el municipio ocupa su propia fila.
      await expect(page.locator('#btn-login')).toBeVisible()
      expect(header!.height).toBeLessThan(200)
      for (const boton of await page.locator('main .btn').all()) expect((await boton.boundingBox())!.height).toBeGreaterThanOrEqual(44)
      if (width === 390 && route === '/itv/precios') await page.screenshot({ path: test.info().outputPath('itv-precios-movil.png') })
    }
  }
})

test('ITV: accesibilidad y ausencia de errores de navegador', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  for (const route of ['/itv/', '/itv/zaragoza/utebo', '/itv/precios']) {
    await page.goto(route)
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
    expect(results.violations).toEqual([])
    expect(await page.locator('[style]').count()).toBe(0)
  }
  expect(errors).toEqual([])
})

