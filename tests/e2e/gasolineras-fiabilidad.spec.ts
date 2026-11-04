import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ministryFixture } from './ministry-fixture'

test.beforeEach(async ({ page, request }, info) => {
  await ministryFixture(page, request, info.config.metadata.live === true)
})

test('cantidad de repostaje, favoritos y los tres navegadores conservan la estación', async ({ page }) => {
  await page.goto('/gasolineras/madrid/madrid')
  const card = page.locator('.station-card').first()
  await expect(card).toBeVisible({ timeout: 20000 })
  await page.locator('#in-refuel-litres').fill('30')
  await page.locator('#in-refuel-litres').press('Tab')
  await expect(card.locator('.row-tank-cost')).toContainText('30 L =')
  const price = Number((await card.locator('.badge').innerText()).match(/[\d.,]+/)![0].replace(',', '.'))
  await expect(card.locator('.row-tank-cost')).toContainText((price * 30).toFixed(2))
  const stationId = await card.locator('[data-fav-id]').getAttribute('data-fav-id')
  await card.locator('[data-fav-id]').click()
  await page.locator('#btn-favs-open').click()
  await expect(page.locator('#modal-favs')).toBeVisible()
  await expect(page.locator('#favs-modal-count')).toHaveText('1')
  await page.locator('#btn-favs-close').click()
  await card.click()
  const popup = page.locator('.leaflet-popup-content')
  await expect(popup).toBeVisible()
  const google = new URL((await popup.locator('.popup-nav-google').getAttribute('href'))!)
  const waze = new URL((await popup.locator('.popup-nav-waze').getAttribute('href'))!)
  const apple = new URL((await popup.locator('.popup-nav-apple').getAttribute('href'))!)
  expect(google.hostname).toBe('www.google.com')
  expect(waze.hostname).toBe('www.waze.com')
  expect(apple.hostname).toBe('maps.apple.com')
  expect(waze.searchParams.get('ll')).toBe(google.searchParams.get('destination'))
  expect(apple.searchParams.get('daddr')).toBe(google.searchParams.get('destination'))
  // Capturamos lo que se compartiría; esta prueba no envía mensajes a nadie.
  await page.evaluate(() => Object.defineProperty(navigator, 'share', { configurable: true, value: async (value: unknown) => { (window as any).__shared = value } }))
  await popup.locator('[data-pop-share]').click()
  const shared = await page.evaluate(() => (window as any).__shared)
  expect(shared.title).not.toBe('Gasolinera')
  expect(shared.text).toContain('Madrid')
  const destination = new URL(shared.url)
  expect(destination.searchParams.get('station')).toBe(stationId)
  expect(destination.hash).toBe('')
  await page.goto(destination.toString())
  await expect(page.locator('.leaflet-popup-content')).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.leaflet-popup-content [data-pop-share]')).toHaveAttribute('data-pop-share', stationId!)
  await expect(page.locator('#in-refuel-litres')).toHaveValue('30')
})

test('combustibles por kilo no muestran depósitos en litros', async ({ page }) => {
  await page.goto('/gasolineras/mapa?prov=02&fuel=' + encodeURIComponent('Precio Gas Natural Comprimido'))
  const card = page.locator('.station-card').first()
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#fuel-unit-note')).toBeVisible()
  await expect(page.locator('#refuel-litres-group')).toBeHidden()
  await expect(card.locator('.badge')).toContainText('€/kg')
  await expect(page.locator('.row-tank-cost')).toHaveCount(0)
  await card.click()
  await expect(page.locator('.popup-price-main')).toContainText('€/kg')
  await page.locator('[data-pop-report]').click()
  await expect(page.locator('#report-price-unit')).toHaveText('€/kg')
  // Sustituimos la recepción del reporte: no se publica ningún dato de prueba.
  let report: any = null
  await page.route('**/api/reports/price', async route => {
    report = route.request().postDataJSON()
    await route.fulfill({ json: { ok: true } })
  })
  await page.locator('#report-price').fill('500')
  await page.locator('#btn-report-submit').click()
  await expect(page.locator('#report-status')).toContainText('100,00 €/kg')
  expect(report).toBeNull()
  await page.locator('#report-price').fill('25')
  await page.locator('#btn-report-submit').click()
  await expect.poll(() => report?.reportedPriceEur).toBe(25)
})

test('móvil: cabecera, favoritos y filtros caben en la pantalla', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/gasolineras/madrid/madrid')
  await expect(page.locator('#btn-favs-open')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.locator('#btn-toggle-sidebar').click()
  await expect(page.locator('#in-refuel-litres')).toBeVisible()
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#lbl-update')).toContainText('Datos:')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})

test('la búsqueda distingue un fallo temporal de un municipio inexistente y reintenta', async ({ page, request }) => {
  const index = await request.get('/api/gasolineras/municipios').then(r => r.json())
  let attempts = 0
  await page.route('**/api/gasolineras/municipios', async route => {
    attempts++
    await route.fulfill(attempts === 1 ? { status: 503, json: { error: 'temporal' } } : { json: index })
  })
  await page.goto('/gasolineras/')
  await page.locator('#q').fill('Madrid')
  await expect(page.locator('#sugs')).toContainText(/cargar|conexión|intent/i)
  await page.locator('#q').fill('Madri')
  await expect(page.locator('#sugs a').first()).toHaveAttribute('href', '/gasolineras/madrid/madrid')
  expect(attempts).toBe(2)
})

for (const flat of [false, true]) {
  test('tendencias: ' + (flat ? 'sin cambio' : 'bajadas pequeñas') + ', subidas y contraste claro/oscuro', async ({ page }, info) => {
    test.skip(info.config.metadata.live === true, 'La comprobación publicada utiliza las capturas oficiales, sin sustituir datos.')
    await page.route('**/data/trends.json', route => route.fulfill({ json: {
      current: { ts: new Date().toISOString(), sourceAt: new Date().toISOString(), ministryDate: '04/11/2026 19:55:00', medians: { g95: flat ? 1.510 : 1.509, diesel: 1.802 } },
      previous: { ts: new Date(Date.now() - 12 * 3600000).toISOString(), sourceAt: new Date(Date.now() - 12 * 3600000).toISOString(), ministryDate: '04/11/2026 7:55:00', medians: { g95: 1.510, diesel: 1.799 } },
    } }))
    await page.goto('/gasolineras/mapa')
    await expect(page.locator('#trend-strip')).toBeVisible()
    await expect(page.locator('#trend-g95')).toContainText(flat ? '↔ sin cambio' : '↓ 0,1 cént./L')
    await expect(page.locator('#trend-diesel')).toContainText('↑ 0,3 cént./L')
    await expect(page.locator('#trend-period')).toContainText('frente a')
    for (const dark of [false, true]) {
      await page.evaluate(value => document.body.classList.toggle('dark', value), dark)
      const result = await new AxeBuilder({ page }).include('#trend-strip').withTags(['wcag2a', 'wcag2aa']).analyze()
      expect(result.violations, dark ? 'Tendencias en oscuro' : 'Tendencias en claro').toEqual([])
    }
  })
}

test('municipio, alrededores y actualizar son elecciones distintas', async ({ page }) => {
  let downloads = 0
  page.on('request', request => { if (request.url().includes('/api/estaciones/provincia/28')) downloads++ })
  await page.goto('/gasolineras/madrid/madrid')
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#sel-area')).toHaveValue('municipio')
  const addresses = await page.locator('.station-card .card-sub').allTextContents()
  expect(addresses.length).toBeGreaterThan(0)
  expect(addresses.every(address => address.trim().endsWith(', Madrid'))).toBe(true)
  const before = downloads
  await page.locator('#btn-refresh').click()
  await expect(page.locator('#btn-refresh')).toBeEnabled({ timeout: 20000 })
  expect(downloads).toBeGreaterThan(before)
  await page.locator('#sel-area').selectOption('cerca')
  await expect(page.locator('#radius-group')).toBeVisible()
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  await expect(page.locator('.station-card').first().locator('.distance-chip')).toHaveAttribute('title', /recta|aproximada/i)
})

test('un enlace compartido de Canarias abre la estación en el mapa principal', async ({ page, request }) => {
  const snapshot = await request.get('/data/stations.json').then(r => r.json())
  const station = snapshot.ListaEESSPrecio.find((s: Record<string, string>) => s.IDProvincia === '35' && s['Precio Gasolina 95 E5'])
  expect(station).toBeTruthy()
  await page.goto('/gasolineras/mapa?prov=35&station=' + station.IDEESS)
  await expect(page.locator('.leaflet-popup-content [data-pop-share]')).toHaveAttribute('data-pop-share', station.IDEESS, { timeout: 20000 })
  await expect(page.locator('#map .leaflet-popup-content')).toBeVisible()
})

test('ubicación: conserva el punto elegido sin mandarlo en la dirección del servidor', async ({ page, context }) => {
  // Punto público de Madrid; no se utiliza la ubicación personal del usuario.
  await context.grantPermissions(['geolocation'])
  await context.setGeolocation({ latitude: 40.4168, longitude: -3.7038 })
  const leaked: string[] = []
  page.on('request', request => { if (request.url().includes('40.4168') || request.url().includes('-3.7038')) leaked.push(request.url()) })
  await page.goto('/gasolineras/')
  await page.locator('#btn-geoloc').click()
  await expect(page).toHaveURL(/\/gasolineras\/mapa#near=/)
  expect(new URL(page.url()).hash.slice('#near='.length).split(',').map(Number)).toEqual([40.4168, -3.7038])
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  await expect(page.locator('#search-origin-note')).toBeVisible()
  await expect(page.locator('#search-origin-note')).toContainText('tu ubicación')
  expect(leaked).toEqual([])
})
