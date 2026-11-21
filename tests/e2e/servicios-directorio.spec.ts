import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// HTML servido por la ruta real; no sustituye las fuentes ni inventa sus cifras.
// Comprueba descubrimiento y condiciones, no la vigencia de datos de cada red.
for (const width of [320, 390, 1280]) test('directorio distingue fuente y territorio a ' + width, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  const response = await page.goto('/servicios/')
  expect(response?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Un mapa para lo que necesitas.')
  await expect(page.locator('.sd-source-card')).toHaveCount(10)
  const madrid = page.locator('.sd-source-card').filter({ has: page.getByRole('link', { name: 'Aparcamientos de Madrid →', exact: true }) })
  await expect(madrid).toContainText('Madrid · ciudad')
  await expect(madrid).toContainText('no plazas PMR libres')
  await expect(madrid.getByRole('link')).toHaveAttribute('href', '/cerca?categorias=aparcamientos-madrid')
  await expect(page.getByRole('link', { name: 'Aparcamientos de Vigo →', exact: true })).toHaveAttribute('href', '/cerca?categorias=aparcamientos-vigo')
  await expect(page.locator('#sd-official')).toContainText('La capacidad de una sala no indica cuántas plazas quedan libres')
  await expect(page.locator('#sd-official')).toContainText('no confirma su activación ni apertura')
  await expect(page.locator('#sd-osm')).toContainText('La cobertura varía según la zona y la categoría')
  await expect(page.locator('.sd-main')).not.toContainText('Categorías todavía sin datos comprobados')
  const jumps = page.getByRole('navigation', { name: 'Secciones del directorio' })
  await jumps.getByRole('link', { name: 'Directorios oficiales', exact: true }).click()
  await expect(page).toHaveURL(/#sd-official$/)
  expect(await page.locator('.sd-source-card h3 a').evaluateAll(links => links.every(link => link.getBoundingClientRect().height >= 44))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.sd-main').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath('directorio-' + width + '.png'), fullPage: true })
  expect(errors).toEqual([])
})

test('buscador municipal sigue funcionando sin JavaScript y sin atribuir cobertura de otras ciudades', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
  const page = await context.newPage()
  await page.goto('/servicios/')
  await page.getByRole('searchbox', { name: 'Busca tu municipio' }).fill('Durango')
  await page.getByRole('main').getByRole('button', { name: 'Buscar', exact: true }).click()
  await expect(page).toHaveURL(/\/servicios\/\?q=Durango$/)
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex,follow')
  await expect(page.locator('.sd-results').getByRole('link').first()).toHaveAttribute('href', /\/cerca\?municipio=\d{5}$/)
  await expect(page.locator('.sd-source-card').first()).toContainText('Madrid · ciudad')
  await context.close()
})
