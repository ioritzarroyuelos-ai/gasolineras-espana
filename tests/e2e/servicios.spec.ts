import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Casos artificiales sólo para comprobar decisiones del navegador. La cobertura
// real se valida aparte con el resultado del robot, nunca con estas respuestas.
const base = { lat: 43.169, lon: -2.632, categorias: ['banos'], gratis: true, accesible: 'si', acceso: 'publico', ubicacion: 'punto', fechaEdicion: '2026-11-19T00:00:00Z' }
const pois = [
  { ...base, id: 'osm-node-1', nombre: 'Baño de prueba abierto', horario: '24/7', fuenteUrl: 'https://www.openstreetmap.org/node/1' },
  { ...base, id: 'osm-node-2', nombre: 'Baño de prueba sin horario', lat: 43.1694, accesible: 'desconocido', gratis: null, fuenteUrl: 'https://www.openstreetmap.org/node/2' },
  { ...base, id: 'osm-node-3', nombre: '<img src=x onerror=alert(1)>', lat: 43.1698, horario: 'Mo-Fr 09:00-20:00; PH off', fuenteUrl: 'https://www.openstreetmap.org/node/3', web: 'javascript:alert(1)' },
]
async function fixture(page: Page, stale = false) {
  const meta = { consultado: new Date().toISOString(), fechaDatos: '2026-11-19T00:00:00Z', desactualizado: stale, atribucion: '© OpenStreetMap', licencia: 'ODbL-1.0' }
  await page.route('**/api/servicios/categorias', route => route.fulfill({ json: { ...meta, categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 3 }], total: 3 } }))
  await page.route('**/api/servicios?*', route => route.fulfill({ json: { ...meta, items: pois, total: 3, siguientePagina: null, warnings: [] } }))
  await page.route('**/api/servicios/lugar/*?*', route => route.fulfill({ json: { ...meta, item: pois[0] } }))
  await page.route('**/api/localidad/48027', route => route.fulfill({ json: { ine: '48027', nombre: 'Durango', provinciaNombre: 'Bizkaia', lat: 43.169, lng: -2.632, servicios: [{ titulo: 'Farmacias de guardia', url: '/farmacias/bizkaia/durango' }] } }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }))
}
async function openPanel(page: Page) {
  if (page.viewportSize()!.width < 1024) await page.locator('#btn-sheet-toggle').click()
}
for (const width of [1280, 390, 320]) test('mapa servicios accesible y utilizable a ' + width, async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Prueba de estados con datos artificiales.')
  await page.setViewportSize({ width, height: 900 }); await fixture(page)
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
  await page.goto('/cerca?municipio=48027&categorias=banos'); await openPanel(page)
  await expect(page.locator('.sv-card')).toHaveCount(3)
  await expect(page.locator('#map .leaflet-map-pane')).toBeAttached()
  await page.locator('#sv-open').check(); await expect(page.locator('.sv-card')).toHaveCount(1)
  await expect(page.locator('.sv-card')).toContainText('Baño de prueba abierto')
  await page.locator('#sv-open').uncheck(); await page.locator('#sv-free').check(); await expect(page.locator('.sv-card')).toHaveCount(2)
  await page.locator('#sv-accessible').check(); await expect(page.locator('.sv-card')).toHaveCount(2)
  await expect(page.locator('.sv-card img')).toHaveCount(0)
  await expect(page.locator('.sv-card a[href^="javascript:"]')).toHaveCount(0)
  const first = page.locator('.sv-card').filter({ has: page.getByRole('heading', { name: 'Baño de prueba abierto', exact: true }) })
  await expect(first.getByRole('link', { name: 'Google Maps' })).toHaveAttribute('href', /destination=43\.169%2C-2\.632/)
  expect(new URL((await first.getByRole('link', { name: 'Apple Maps' }).getAttribute('href')) || '').origin).toBe('https://maps.apple.com')
  expect(new URL((await first.getByRole('link', { name: 'Waze' }).getAttribute('href')) || '').origin).toBe('https://www.waze.com')
  await first.getByRole('button', { name: 'Guardar favorito: Baño de prueba abierto' }).click()
  await page.locator('#sv-favorites').click(); await expect(page.locator('.sv-card')).toHaveCount(1)
  await expect(page.locator('#sv-status')).toContainText('1 lugares guardados')
  await expect(page.locator('#sv-open')).toBeDisabled()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('servicios-' + width + '.png'), fullPage: true })
  const violations = (await new AxeBuilder({ page }).include('.sv-panel').analyze()).violations
  expect(violations).toEqual([]); expect(errors).toEqual([])
})

test('no califica un horario antiguo como abierto y permite seguir con gasolineras', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Prueba de obsolescencia controlada.')
  await fixture(page, true); await page.goto('/cerca?municipio=48027&categorias=banos')
  await expect(page.locator('.sv-card')).toHaveCount(3)
  await page.locator('#sv-open').check(); await expect(page.locator('.sv-card')).toHaveCount(0)
  await expect(page.locator('#sv-source')).toContainText('actualización está pendiente')
  await page.locator('#sv-view-fuel').click(); await expect(page.locator('#fuel-content')).toBeVisible()
  await expect(page.locator('#sel-combustible')).toBeVisible()
  await page.locator('#sv-view-services').click(); await expect(page.locator('#fuel-content')).toBeHidden()
})

test('GPS sólo se envía al mapa local; la consulta de servicios usa cuadrículas', async ({ page, context }, info) => {
  test.skip(info.config.metadata.live === true, 'Ubicación simulada.')
  await context.grantPermissions(['geolocation']); await context.setGeolocation({ latitude: 43.16912, longitude: -2.63234 })
  await fixture(page); const requests: string[] = []
  page.on('request', r => { if (r.url().includes('/api/servicios?')) requests.push(r.url()) })
  await page.goto('/cerca?categorias=banos'); await page.locator('#sv-near').click()
  await expect(page.locator('.sv-card')).toHaveCount(3)
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every(r => new URL(r).searchParams.has('zona') && !r.includes('43.16912') && !r.includes('-2.63234'))).toBe(true)
  expect(new URL(page.url()).searchParams.has('lat')).toBe(false)
  await expect(page.locator('#sv-history-enabled')).not.toBeChecked()
})

test('favorito compartido abre su ficha y no expone HTML de datos', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Ficha artificial para enlace guardado.')
  await fixture(page)
  await page.goto('/cerca?lat=43.169&lon=-2.632&servicio=osm-node-1&categorias=banos')
  await expect(page.locator('.leaflet-popup')).toContainText('Baño de prueba abierto')
})

for (const width of [390, 1280]) for (const late of [false, true]) test('conserva zona al alternar carburantes a ' + width + (late ? ' con descarga tardía' : ' con precios cargados'), async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Descarga de precios controlada para comprobar el cambio de vista.')
  await page.setViewportSize({ width, height: 900 }); await fixture(page)
  let release!: () => void, requested!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const started = new Promise<void>(resolve => { requested = resolve })
  await page.route('**/data/stations.json', async route => {
    requested(); await gate
    await route.fulfill({ json: { Fecha: '21/11/2026 09:00:00', ListaEESSPrecio: [43.169, 43.24].map((lat, n) => ({
      IDEESS: String(n + 1001), IDProvincia: '48', IDMunicipio: '48027', Municipio: 'Durango', Provincia: 'BIZKAIA',
      Latitud: String(lat).replace('.', ','), 'Longitud (WGS84)': '-2,632', 'Rótulo': 'Estación de prueba ' + n,
      'Precio Gasolina 95 E5': '1,500', Horario: 'L-D: 24H',
    })) } })
  })
  await page.goto('/cerca?municipio=48027&categorias=banos'); await openPanel(page)
  await expect(page.locator('.sv-card')).toHaveCount(3)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('#sv-view-fuel').click({ trial: true })
  const before = await page.evaluate(() => { const m = (window as any).map; const p = m.getCenter(); return { lat:p.lat, lng:p.lng, zoom:m.getZoom() } })
  await page.locator('#sv-view-fuel').click(); await started
  await expect(page.locator('#fuel-content')).toBeVisible()
  if (!late) { release(); await expect(page.locator('.station-card').first()).toBeVisible() }
  await page.locator('#sv-view-services').click()
  if (late) { const response = page.waitForResponse('**/data/stations.json'); release(); await response }
  await expect(page.locator('.sv-card')).toHaveCount(3)
  await expect.poll(() => page.evaluate(expected => {
    const m = (window as any).map
    // Al redimensionar el panel, Leaflet desplaza algunos píxeles el centro;
    // la zona y el zoom deben conservarse, sin volver al encuadre de carburantes.
    return { zoom:m.getZoom(), cerca:m.getCenter().distanceTo([expected.lat, expected.lng]) < 150 }
  }, before)).toEqual({ zoom:before.zoom, cerca:true })
  await expect(page.locator('#fuel-content')).toBeHidden()
  await expect(page.locator('#map .sv-pin, #map .sv-cluster')).not.toHaveCount(0)
})
