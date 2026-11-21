import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { build } from 'esbuild'

const NOW = Date.parse('2026-11-21T10:00:00Z'), iso = (n = NOW) => new Date(n).toISOString()
const town = { ine: '48020', nombre: 'Bilbao', provinciaNombre: 'Bizkaia', lat: 43.26, lng: -2.93, servicios: [] }
let script = ''
test.beforeAll(async () => { script = (await build({ entryPoints: ['src/client/servicios.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text })
async function fixture(page: Page, clockOffset = 0) {
  const state = { requests: 0, fail: false, gate: null as Promise<void> | null, errors: [] as string[], forbidden: [] as string[] }
  await page.clock.install({ time: NOW + clockOffset })
  page.on('pageerror', e => state.errors.push(e.message))
  await page.route('**/static/servicios.js?*', route => route.fulfill({ contentType: 'text/javascript', body: script }))
  await page.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url())
    if (req.method() !== 'GET') { state.forbidden.push(req.method() + ' ' + u.pathname); return route.fulfill({ status: 405, json: {} }) }
    if (['/api/me', '/api/auth/me'].includes(u.pathname)) return route.fulfill({ json: { user: null } })
    if (u.pathname === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (u.pathname === '/api/servicios/categorias') return route.fulfill({ json: { categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }], total: 1 } })
    if (u.pathname === '/api/servicios/itv') return route.fulfill({ json: { items: [], totalConCoordenadas: 0 } })
    if (u.pathname === '/api/servicios') return route.fulfill({ json: { items: [], siguientePagina: null } })
    if (u.pathname === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (u.pathname === '/api/localidades') return route.fulfill({ json: [] })
    if (u.pathname === '/api/transporte/metro-bilbao') {
      state.requests++; if (u.search) state.forbidden.push(u.search)
      if (state.gate) await state.gate
      if (state.fail) return route.fulfill({ status: 503, json: {} })
      const checked = NOW + await page.evaluate(() => performance.now())
      return route.fulfill({ json: { schema: 1, redId: 'metro-bilbao', total: 1, evaluadoEn: iso(checked), consultado: iso(), fechaDatos: iso(), caduca: iso(NOW + 120000), fechaDirectorio: iso(NOW - 3600000), estado: checked < NOW + 120000 ? 'actual' : 'sin_actualizar', directorioActual: true, warnings: [], avisos: [],
        items: [{ id: 'metro-bilbao-7', nombre: 'Abando', lat: town.lat, lon: town.lng, limitado: false, avisos: [], llegadas: [{ llegada: iso(NOW + 60000), destino: 'Etxebarri', tipo: 'llegada_estimada', fechaParte: iso() }] }] } })
    }
    return route.fulfill({ status: 503, json: {} })
  })
  return state
}
async function open(page: Page) {
  await page.goto('/cerca?municipio=48020&categorias=metro-bilbao')
  if (page.viewportSize()!.width < 1024) await page.locator('#btn-sheet-toggle').click()
  await expect(page.locator('.sv-card[data-servicio="metro-bilbao-7"]')).toBeVisible()
}
const card = (page: Page) => page.locator('.sv-card[data-servicio="metro-bilbao-7"]')
for (const width of [1280, 390]) test('Metro en el mapa legible a ' + width + ', con guardado de estación y sin filtros inventados', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Parte controlado.')
  await page.setViewportSize({ width, height: 900 }); const state = await fixture(page); await open(page)
  await expect(card(page)).toContainText('Hacia Etxebarri')
  await expect(card(page)).toContainText('Parte de las')
  await expect(card(page).getByRole('button', { name: /Guardar favorito: Abando/ })).toHaveCount(1)
  await expect(card(page).getByRole('link', { name: 'Todas las estaciones y fuente oficial' })).toHaveAttribute('href', '/transporte/metro-bilbao')
  for (const id of ['sv-open', 'sv-free', 'sv-accessible']) { await page.locator('#' + id).check(); await expect(card(page)).toHaveCount(1) }
  expect((await new AxeBuilder({ page }).include('.sv-panel').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await card(page).scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('metro-mapa-' + width + '.png') })
  expect(state.errors).toEqual([]); expect(state.forbidden).toEqual([])
})
test('retira la llegada pasada del listado y popup aun con reloj atrasado y pestaña oculta', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Reloj controlado.')
  await page.setViewportSize({ width: 1280, height: 900 }); const state = await fixture(page, -120000); await open(page)
  await card(page).getByRole('button', { name: 'Ver en el mapa' }).click()
  await expect(page.locator('.leaflet-popup .sv-metro-arrival')).toHaveCount(1)
  await page.clock.runFor(500); await expect(card(page)).toContainText('Hacia Etxebarri')
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  const requests = state.requests; await page.clock.fastForward(61000)
  await expect(page.locator('.sv-metro-arrival')).toHaveCount(0); expect(state.requests).toBe(requests)
  await page.clock.fastForward(60000)
  await expect(page.locator('#sv-source')).toContainText('No hay un parte reciente comprobable')
  expect(state.errors).toEqual([])
})
test('actualiza a30s y el fallo retira horas de lista y popup', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Parte controlado.')
  await page.setViewportSize({ width: 1280, height: 900 }); const state = await fixture(page); await open(page)
  state.fail = true; const previous = state.requests
  await page.clock.fastForward(30001)
  await expect.poll(() => state.requests).toBeGreaterThan(previous)
  await expect(page.locator('.sv-metro-arrival')).toHaveCount(0)
  await expect(page.locator('#sv-source')).toContainText('No hay un parte reciente comprobable')
})
test('una respuesta tardía no vuelve a encender la capa Metro quitada', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Petición controlada.')
  await page.setViewportSize({ width: 1280, height: 900 }); const state = await fixture(page)
  let release!: () => void; state.gate = new Promise<void>(resolve => { release = resolve })
  try {
    await page.goto('/cerca?municipio=48020&categorias=metro-bilbao'); await expect.poll(() => state.requests).toBeGreaterThan(0)
    await page.locator('#sv-query').fill('Baños'); await page.locator('#sv-search').evaluate(form => (form as HTMLFormElement).requestSubmit())
    await page.getByRole('button', { name: 'Servicio: Baños', exact: true }).click()
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/transporte/metro-bilbao'); release(); await (await response).finished()
    await page.clock.runFor(1000)
    await expect(card(page)).toHaveCount(0); await expect(page.locator('#map .sv-pin-metro')).toHaveCount(0)
    expect(new URL(page.url()).searchParams.get('categorias')).toBe('banos')
  } finally { release() }
})
