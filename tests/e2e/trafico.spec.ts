import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildTraficoPage } from '../../src/html/trafico'
import { build } from 'esbuild'

const clockClient = build({ entryPoints: ['src/client/trafico.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })
test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Fuente y reloj controlados, no comprueba tráfico real.')
  // Prueba exactamente el cliente fuente actual, también cuando se está
  // preparando otra ampliación independiente sin reconstruir el dist compartido.
  await page.route('**/static/trafico.js*', async route => route.fulfill({ contentType: 'application/javascript', body: (await clockClient).outputFiles[0].text }))
})

function fixtureData(now: number) {
  const item = { id: 'sct-1', nombre: 'Obras publicadas por la fuente', descripcion: 'A-2 | JORBA | Punt km. 545-544.2', fechaIncidencia: '2026-11-02T06:46:13.000Z', estado: 'publicada' as const, lat: 41.604, lon: 1.547, carretera: 'A-2', tipo: 'Obres' }
  return { schema: 1, region: 'Cataluña', regionId: 'cataluna', consultado: new Date(now).toISOString(), evaluadoEn: new Date(now).toISOString(), fechaDatos: new Date(now).toISOString(), estado: 'actual', caduca: new Date(now + 600000).toISOString(),
    atribucion: 'Generalitat de Catalunya. Servei Català de Trànsit.', licenciaUrl: 'https://web.gencat.cat/ca/generalitat/dades-indicadors/dades-obertes/llicencies', fuenteUrl: 'https://cit.transit.gencat.cat/', datosUrl: 'https://www.gencat.cat/transit/opendata/incidenciesGML.xml',
    total: 2, conCoordenadas: 1, sinCoordenadas: 1, warnings: [], items: [item, { ...item, id: 'sct-2', lat: null, lon: null, nombre: '<img src=x onerror=alert(1)>' }],
  }
}
async function fixture(page: Page, width = 1280) {
  const now = Date.now(), data = fixtureData(now)
  await page.setViewportSize({ width, height: 900 })
  await page.clock.install({ time: now })
  await page.route(url => url.pathname === '/trafico/cataluna', route => route.fulfill({ contentType: 'text/html', body: buildTraficoPage({ nonce: 'e2e-test', canonical: 'https://webapp-3ft.pages.dev/trafico/cataluna', data }) }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }))
  await page.route('**/api/trafico/cataluna', route => route.fulfill({ json: data }))
  return data
}
for (const width of [1280, 390, 320]) test('tráfico completo legible y accesible a ' + width, async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Datos de prueba controlados.')
  await fixture(page, width)
  await page.goto('/trafico/cataluna')
  await expect(page.locator('#tf-located .tf-card')).toHaveCount(1)
  await expect(page.locator('#tf-unlocated .tf-card')).toHaveCount(1)
  await expect(page.locator('#tf-unlocated-link')).toHaveText('1 sin punto en el mapa')
  await expect(page.locator('.tf-card img')).toHaveCount(0)
  await expect(page.locator('.tf-date').first()).toContainText('2026')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('trafico-' + width + '.png'), fullPage: true })
  expect((await new AxeBuilder({ page }).include('.tf-main').analyze()).violations).toEqual([])
})

test('refrescar sustituye el parte y conserva incidentes sin coordenadas', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Parte controlado.')
  const data = await fixture(page)
  await page.goto('/trafico/cataluna')
  await page.route('**/api/trafico/cataluna', route => route.fulfill({ json: { ...data, total: 1, conCoordenadas: 0, sinCoordenadas: 1, items: data.items.slice(1) } }))
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect(page.locator('.tf-card')).toHaveCount(1)
  await expect(page.locator('#tf-located .tf-card')).toHaveCount(0)
  await expect(page.locator('#tf-unlocated .tf-card')).toHaveCount(1)
  await expect(page.locator('#tf-status')).toContainText('1 incidencias publicadas')
  await expect(page.locator('.tf-card img')).toHaveCount(0)
})

test('una fuente caída oculta el parte y no afirma que el tráfico esté despejado', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Caída controlada.')
  await fixture(page)
  await page.goto('/trafico/cataluna')
  await page.route('**/api/trafico/cataluna', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect(page.locator('#tf-results')).toBeHidden()
  await expect(page.locator('#tf-status')).toContainText('Esto no significa que las carreteras estén libres')
  await expect(page.locator('#tf-unlocated-link')).toBeHidden()
})

test('pestaña oculta deja de consultar y un parte caducado no reaparece al volver', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj y visibilidad simulados.')
  await fixture(page)
  let requests = 0
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/trafico/cataluna') requests++ })
  await page.goto('/trafico/cataluna')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.fastForward(601000)
  expect(requests).toBe(0)
  await expect(page.locator('#tf-results')).toBeHidden()
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => requests).toBe(1)
  await expect(page.locator('#tf-refresh')).toBeEnabled()
  await expect(page.locator('#tf-results')).toBeHidden()
  await expect(page.locator('#tf-status')).toContainText('pendiente de actualizar')
})

test('SSR con reloj atrasado descuenta el tiempo esperando el documento antes de ejecutar JavaScript', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj y documento controlados.')
  const serverNow = Date.now(), data = fixtureData(serverNow - 594000)
  data.evaluadoEn = new Date(serverNow).toISOString()
  // performance debe medir también el viaje del HTML, antes de crear el
  // documento; aquí sólo se retrasa el reloj civil y la respuesta de red.
  await page.addInitScript(() => { const originalNow = Date.now.bind(Date); Date.now = () => originalNow() - 120000 })
  await page.route(url => url.pathname === '/trafico/cataluna', async route => {
    const html = buildTraficoPage({ nonce: 'clock-test', canonical: 'https://webapp-3ft.pages.dev/trafico/cataluna', data })
    await new Promise(resolve => setTimeout(resolve, 3500))
    await route.fulfill({ contentType: 'text/html', body: html })
  })
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }))
  await page.route('**/api/trafico/cataluna', route => route.fulfill({ status: 503, json: { error: 'Fuente sin respuesta actual' } }))
  await page.goto('/trafico/cataluna')
  await expect(page.locator('#tf-results')).toBeVisible()
  await expect(page.locator('#tf-results')).toBeHidden({ timeout: 4000 })
  await expect(page.locator('#tf-status')).toContainText('pendiente de actualizar')
})

test('una respuesta AJAX que llega vencida no revive el parte con reloj atrasado', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Demora artificial sin tráfico real.')
  await fixture(page)
  await page.clock.setSystemTime(new Date(Date.now() - 120000))
  await page.goto('/trafico/cataluna'); await expect(page.locator('#tf-results')).toBeVisible()
  const serverNow = Date.now(), late = fixtureData(serverNow - 590000)
  late.evaluadoEn = new Date(serverNow).toISOString()
  let entered = false, release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/trafico/cataluna', async route => { entered = true; await pending; await route.fulfill({ json: late }) })
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect.poll(() => entered).toBe(true)
  await page.clock.fastForward(11000); release()
  await expect(page.locator('#tf-results')).toBeHidden()
  await expect(page.locator('#tf-refresh')).toBeEnabled()
  await expect(page.locator('#tf-status')).toContainText('pendiente de actualizar')
})

test('corregir el reloj hacia atrás durante la visita no alarga el parte inicial', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj controlado.')
  const serverNow = Date.now(), data = fixtureData(serverNow - 590000)
  data.evaluadoEn = new Date(serverNow).toISOString()
  await page.clock.install({ time: serverNow })
  await page.route(url => url.pathname === '/trafico/cataluna', route => route.fulfill({ contentType: 'text/html', body: buildTraficoPage({ nonce: 'clock-test', canonical: 'https://webapp-3ft.pages.dev/trafico/cataluna', data }) }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }))
  await page.route('**/api/trafico/cataluna', route => route.fulfill({ status: 503, json: { error: 'Fuente sin respuesta actual' } }))
  await page.goto('/trafico/cataluna'); await expect(page.locator('#tf-results')).toBeVisible()
  await page.clock.setSystemTime(new Date(serverNow - 3600000))
  await page.clock.fastForward(10001)
  await expect(page.locator('#tf-results')).toBeHidden()
})

test('la respuesta AJAX con fecha de publicación futura respecto al servidor no se acepta como actual', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Parte futuro artificial.')
  const data = await fixture(page)
  await page.goto('/trafico/cataluna')
  const future = fixtureData(Date.parse(data.evaluadoEn) + 1000); future.evaluadoEn = data.evaluadoEn
  await page.route('**/api/trafico/cataluna', route => route.fulfill({ json: future }))
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect(page.locator('#tf-results')).toBeHidden()
  await expect(page.locator('#tf-status')).toContainText('pendiente de actualizar')
})
