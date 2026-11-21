import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { build } from 'esbuild'
import { buildTransportePage } from '../../src/html/transporte'

type Parte = NonNullable<Parameters<typeof buildTransportePage>[0]['data']> & { evaluadoEn: string }
let clientScript = ''
test.beforeAll(async () => { clientScript = (await build({ entryPoints: ['src/client/transporte.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text })
function fixtureData(now: number): Parte {
  const iso = (n: number) => new Date(n).toISOString()
  return { schema: 1, redId: 'metro-bilbao', red: 'Metro Bilbao', evaluadoEn: iso(now), consultado: iso(now), fechaDatos: iso(now), caduca: iso(now + 120000), estado: 'actual', directorioActual: true, fechaDirectorio: iso(now - 3600000), directorioConsultado: iso(now - 3000000),
    fuenteUrl: 'https://data.ctb.eus/dataset/metro-bilbao-online', datosUrl: 'https://ctb-gtfs-rt.s3.eu-south-2.amazonaws.com/metro-bilbao-trip-updates.pb', directorioUrl: 'https://data.ctb.eus/dataset/horario-metro-bilbao', licenciaUrl: 'https://creativecommons.org/licenses/by/4.0/', atribucion: 'CTB · Metro Bilbao', total: 42, llegadasTotal: 2, rechazadas: 0, avisos: [], warnings: ['Una lista vacía no confirma que no haya trenes.'],
    items: Array.from({ length: 42 }, (_, i) => ({ id: 'metro-bilbao-' + (i + 1), nombre: i === 0 ? 'Abando' : i === 1 ? 'San Mamés' : 'Estación ' + (i + 1), lat: 43.26, lon: -2.93, llegadasTotal: i < 2 ? 1 : 0, limitado: false, avisos: [], llegadas: i < 2 ? [{ viajeId: String(i + 1), paradaId: '1.0', destino: i === 0 ? 'Etxebarri' : '<img src=x onerror=alert(1)>', llegada: iso(now + (i + 1) * 60000), tipo: 'llegada_estimada', fechaParte: iso(now) }] : [] })) }
}
async function fixture(page: Page, width = 1280) {
  const now = Date.now(), data = fixtureData(now)
  await page.setViewportSize({ width, height: 900 }); await page.clock.install({ time: now })
  await page.route(url => url.pathname === '/transporte/metro-bilbao', route => route.fulfill({ contentType: 'text/html', body: buildTransportePage({ nonce: 'e2e-test', canonical: 'https://webapp-3ft.pages.dev/transporte/metro-bilbao', data }) }))
  await page.route('**/static/transporte.js?*', route => route.fulfill({ contentType: 'text/javascript', body: clientScript }))
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }))
  await page.route('**/api/transporte/metro-bilbao', route => route.fulfill({ json: data }))
  return data
}
for (const width of [1280, 390, 320]) test('Metro Bilbao: 42 estaciones accesibles y sin desbordar a ' + width, async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Datos controlados.')
  await fixture(page, width); await page.goto('/transporte/metro-bilbao')
  await expect(page.locator('.mt-station')).toHaveCount(42)
  await expect(page.locator('.mt-arrival')).toHaveCount(2)
  await expect(page.locator('.mt-arrival small').first()).toContainText('Parte de las')
  await expect(page.locator('.mt-station img')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Ver estaciones en el mapa' })).toHaveAttribute('href', '/cerca?municipio=48020&categorias=metro-bilbao')
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect((await new AxeBuilder({ page }).include('.mt-main').analyze()).violations).toEqual([])
  await page.screenshot({ path: info.outputPath('metro-' + width + '.png'), fullPage: false })
  await page.locator('.mt-station').first().scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('metro-estaciones-' + width + '.png'), fullPage: false })
})
test('el buscador ignora tildes y mantiene la búsqueda al actualizar', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Datos controlados.')
  const data = await fixture(page); await page.goto('/transporte/metro-bilbao')
  await page.getByLabel('Buscar una estación').fill('san mames')
  await expect(page.locator('.mt-station:visible')).toHaveCount(1)
  await expect(page.locator('#mt-count')).toHaveText('1 de 42 estaciones')
  await page.route('**/api/transporte/metro-bilbao', route => route.fulfill({ json: data }))
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect(page.locator('.mt-station:visible')).toHaveCount(1)
  await expect(page.locator('.mt-station:visible h2')).toHaveText('San Mamés')
  await page.getByLabel('Buscar una estación').fill('inexistente')
  await expect(page.locator('#mt-not-found')).toBeVisible()
})
test('una llegada pasada desaparece sin esperar la red y el parte caduca a dos minutos', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj controlado.')
  await fixture(page); await page.goto('/transporte/metro-bilbao')
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/transporte/metro-bilbao', async route => { await held; await route.abort().catch(() => {}) })
  // No consulta de red en segundo plano; el reloj local sigue retirando horas.
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.fastForward(60001)
  await expect(page.locator('.mt-arrival')).toHaveCount(1)
  await page.clock.fastForward(60000)
  await expect(page.locator('.mt-arrival')).toHaveCount(0)
  await expect(page.locator('#mt-status')).toContainText('pendiente de actualizar')
  release()
})
test('no consulta oculta y al volver no recupera un parte vencido', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj controlado.')
  await fixture(page); let requests = 0
  page.on('request', r => { if (new URL(r.url()).pathname === '/api/transporte/metro-bilbao') requests++ })
  await page.goto('/transporte/metro-bilbao')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  await page.clock.fastForward(121000); expect(requests).toBe(0)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')) })
  await expect.poll(() => requests).toBe(1)
  await expect(page.locator('.mt-arrival')).toHaveCount(0)
  await expect(page.locator('#mt-status')).toContainText('pendiente de actualizar')
})
test('caída de la fuente conserva estaciones pero no predicciones antiguas', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Caída controlada.')
  await fixture(page); await page.goto('/transporte/metro-bilbao')
  await page.route('**/api/transporte/metro-bilbao', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect(page.locator('.mt-station')).toHaveCount(42)
  await expect(page.locator('.mt-arrival')).toHaveCount(0)
  await expect(page.locator('#mt-status')).toContainText('No se pueden comprobar')
  await expect(page.locator('#mt-warnings')).toContainText('Una lista vacía no confirma')
})
test('una respuesta mal formada no rompe la búsqueda ni publica horas', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Respuesta controlada.')
  const data = await fixture(page); await page.goto('/transporte/metro-bilbao')
  await page.route('**/api/transporte/metro-bilbao', route => route.fulfill({ json: { ...data, caduca: 'no-date' } }))
  await page.getByRole('button', { name: 'Actualizar ahora' }).click()
  await expect(page.locator('.mt-arrival')).toHaveCount(0)
  await page.getByLabel('Buscar una estación').fill('Abando')
  await expect(page.locator('.mt-station:visible')).toHaveCount(1)
})
test('la lista se actualiza automáticamente a los 30 segundos visibles', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj controlado.')
  const data = await fixture(page); await page.goto('/transporte/metro-bilbao')
  const updated = structuredClone(data); updated.items[0].llegadas[0].destino = 'Plentzia'
  await page.route('**/api/transporte/metro-bilbao', route => route.fulfill({ json: updated }))
  await page.clock.fastForward(30001)
  await expect(page.locator('[data-estacion="metro-bilbao-1"] .mt-arrival strong')).toHaveText('Hacia Plentzia')
})
