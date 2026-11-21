import { test, expect } from '@playwright/test'
import { build } from 'esbuild'

const SERVER = Date.parse('2026-11-21T10:00:00Z'), iso = (n: number) => new Date(n).toISOString()
let script = ''
test.beforeAll(async () => { script = (await build({ entryPoints: ['src/client/servicios.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text })
for (const kind of ['bicis', 'trafico']) test(kind + ': el reloj atrasado del visitante no prolonga la disponibilidad', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Relojes y fuentes simulados.')
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.clock.install({ time: SERVER - 120000 })
  const bike = kind === 'bicis', duration = bike ? 300000 : 600000, category = bike ? 'bicis-zaragoza' : 'trafico-cataluna'
  const town = bike ? { ine: '50297', nombre: 'Zaragoza', provinciaNombre: 'Zaragoza', lat: 41.65, lng: -.88, servicios: [] } : { ine: '08019', nombre: 'Barcelona', provinciaNombre: 'Barcelona', lat: 41.385, lng: 2.17, servicios: [] }
  const id = bike ? 'gbfs-zaragoza-99001' : 'sct-99001'
  await page.route('**/static/servicios.js?*', route => route.fulfill({ contentType: 'text/javascript', body: script }))
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url())
    if (route.request().method() !== 'GET') return route.fulfill({ status: 405, json: {} })
    if (['/api/me', '/api/auth/me'].includes(u.pathname)) return route.fulfill({ json: { user: null } })
    if (u.pathname === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (u.pathname === '/api/servicios/categorias') return route.fulfill({ json: { categorias: [], total: 0 } })
    if (u.pathname === '/api/servicios/itv') return route.fulfill({ json: { items: [], totalConCoordenadas: 0 } })
    if (u.pathname === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (u.pathname === (bike ? '/api/bicis/zaragoza' : '/api/trafico/cataluna')) {
      const elapsed = await page.evaluate(() => performance.now()), checked = SERVER + elapsed
      const item = bike ? { id, nombre: 'Estación de prueba', lat: town.lat, lon: town.lng, bicis: 4, anclajes: 6, estado: 'operativa', permiteAlquiler: true, permiteDevolucion: true, actualizado: iso(SERVER), caduca: iso(SERVER + duration) } : { id, nombre: 'Incidencia de prueba', descripcion: 'Obras', fechaIncidencia: iso(SERVER), lat: town.lat, lon: town.lng }
      return route.fulfill({ json: { schema: 1, consultado: iso(SERVER), evaluadoEn: iso(checked), fechaDatos: iso(SERVER), caduca: iso(SERVER + duration), estado: checked < SERVER + duration ? 'actual' : 'sin_actualizar', total: 1, sinCoordenadas: 0, items: [item] } })
    }
    return route.fulfill({ status: 503, json: {} })
  })
  await page.goto('/cerca?municipio=' + town.ine + '&categorias=' + category)
  const card = page.locator('.sv-card[data-servicio="' + id + '"]')
  await expect(card).toHaveCount(1)
  if (bike) await expect(card).toContainText('4 bicicletas disponibles')
  await card.getByRole('button', { name: bike ? 'Ver en el mapa' : 'Ver el punto publicado' }).click()
  await expect(page.locator('.leaflet-popup .sv-popup')).toBeVisible()
  await page.clock.runFor(500)
  await expect(card).toHaveCount(1)
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')) })
  // Otra corrección manual hacia atrás no puede extender el plazo monotónico.
  await page.clock.setSystemTime(SERVER - 240000)
  await page.clock.fastForward(duration + 20)
  if (bike) { await expect(page.locator('.sv-card,.leaflet-popup .sv-popup').filter({ hasText: '4 bicicletas disponibles' })).toHaveCount(0) }
  else { await expect(card).toHaveCount(0); await expect(page.locator('.leaflet-popup .sv-popup')).toHaveCount(0) }
})
