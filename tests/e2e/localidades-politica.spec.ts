import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('busca municipio, recuerda la selección entre secciones y permite olvidarla', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('Tu municipio', { exact: true }).fill('Madrid')
  await page.locator('#municipio-resultados').getByRole('link', { name: 'Madrid · Madrid', exact: true }).click()
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await expect(page.locator('#localidad-servicios a')).toHaveCount(4)
  await expect(page.locator('#municipio-elegido')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('espana-util-municipio'))).toBe('28079')
  const links = await page.locator('#localidad-servicios a').evaluateAll(all => all.map(a => a.getAttribute('href')!))
  for (const url of links) { const r = await page.request.get(url); expect(r.status(), url).toBe(200) }
  await page.goto('/politica/')
  await expect(page.locator('#municipio-elegido')).toHaveText('Tu municipio: Madrid')
  await page.goto('/')
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await page.getByRole('button', { name: 'Olvidar municipio' }).click()
  await expect(page.locator('#localidad-titulo')).toHaveText('Qué necesitas en tu municipio')
  expect(await page.evaluate(() => localStorage.getItem('espana-util-municipio'))).toBeNull()
})

test('búsqueda sin JavaScript y selección municipal siguen funcionando', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto(test.info().project.use.baseURL + '/?q=avila')
  await page.getByRole('link', { name: 'Ávila · Ávila', exact: true }).click()
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Ávila')
  await expect(page.locator('#localidad-servicios a')).toHaveCount(4)
  await context.close()
})

test('histórico paginado conserva navegación, limita el peso y respeta páginas inexistentes', async ({ page }) => {
  const response = await page.goto('/politica/generales')
  expect((await response!.body()).length).toBeLessThan(150000)
  await expect(page.locator('table.s .empn')).toHaveCount(25)
  const first = await page.locator('table.s tbody').textContent()
  await page.getByRole('link', { name: 'Más antiguos →' }).first().click()
  await expect(page).toHaveURL(/pagina=2/)
  expect(await page.locator('table.s tbody').textContent()).not.toBe(first)
  await page.getByRole('link', { name: '← Más recientes' }).first().click()
  await expect(page).toHaveURL(/\/politica\/generales$/)
  expect((await page.request.get('/politica/generales?pagina=99999')).status()).toBe(404)
})

test('portada municipal móvil accesible y sin desbordamiento', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?municipio=28079')
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  expect(results.violations.filter(v => ['serious', 'critical'].includes(v.impact || ''))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
