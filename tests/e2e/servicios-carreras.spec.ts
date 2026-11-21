import { test, expect, type Page, type Route } from '@playwright/test'

// Respuestas retenidas deliberadamente: comprueban que una decisión posterior
// sigue mandando aunque llegue tarde una petición anterior. No son datos reales.
const meta = { consultado: new Date().toISOString(), fechaDatos: new Date().toISOString(), desactualizado: false, atribucion: '© OpenStreetMap', licencia: 'ODbL-1.0' }
const townA = { ine: '48027', nombre: 'Durango', provinciaNombre: 'Bizkaia', lat: 43.169, lng: -2.632, servicios: [] }
const townB = { ine: '48020', nombre: 'Bilbao', provinciaNombre: 'Bizkaia', lat: 43.263, lng: -2.935, servicios: [] }
const base = { lat: townA.lat, lon: townA.lng, gratis: true, accesible: 'si', acceso: 'publico', ubicacion: 'punto', fechaEdicion: meta.fechaDatos }
const bathroom = { ...base, id: 'osm-node-1', categorias: ['banos'], nombre: 'Baño retenido', fuenteUrl: 'https://www.openstreetmap.org/node/1' }
const fountain = { ...base, id: 'osm-node-2', categorias: ['agua-potable'], nombre: 'Fuente vigente', fuenteUrl: 'https://www.openstreetmap.org/node/2' }

async function fixture(page: Page) {
  await page.route('**/api/auth/me', route => route.fulfill({ json: { user: null } }))
  await page.route('**/api/servicios/categorias', route => route.fulfill({ json: { ...meta, total: 2, categorias: [
    { id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 },
    { id: 'agua-potable', nombre: 'Agua potable', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 },
  ] } }))
  await page.route('**/api/servicios?*', route => {
    const categories = new URL(route.request().url()).searchParams.get('categorias')?.split(',') || []
    const items = [bathroom, fountain].filter(p => categories.includes(p.categorias[0]))
    return route.fulfill({ json: { ...meta, items, total: items.length, siguientePagina: null } })
  })
  await page.route('**/api/localidades?*', route => route.fulfill({ json: [townA, townB] }))
  await page.route('**/api/localidad/48027', route => route.fulfill({ json: townA }))
  await page.route('**/api/localidad/48020', route => route.fulfill({ json: townB }))
}
function heldReply() {
  let announce!: (route: Route) => void
  const received = new Promise<Route>(resolve => { announce = resolve })
  return { received, handler: (route: Route) => { announce(route) } }
}
async function settleResponse(page: Page, route: Route, value: unknown) {
  const response = page.waitForResponse(r => r.url() === route.request().url())
  await route.fulfill({ json: value })
  await (await response).finished()
  // Deja terminar fetch/json y el siguiente repintado, sin un retardo arbitrario.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
}
async function selectService(page: Page, name: string) {
  await page.locator('#sv-query').fill(name)
  await page.locator('#sv-search').evaluate(form => (form as HTMLFormElement).requestSubmit())
  await page.locator('#sv-suggestions').getByRole('button', { name: 'Servicio: ' + name, exact: true }).click()
}
test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Regresión de concurrencia con respuestas artificiales.')
  await page.setViewportSize({ width: 1280, height: 900 })
  await fixture(page)
})

test('el municipio más reciente prevalece cuando el anterior responde tarde', async ({ page }) => {
  const pending = heldReply()
  await page.route('**/api/localidad/48027', pending.handler)
  await page.goto('/cerca?categorias=banos')
  await page.locator('#sv-query').fill('Durango')
  await page.locator('#sv-search').evaluate(form => (form as HTMLFormElement).requestSubmit())
  await page.locator('#sv-suggestions').getByRole('button', { name: 'Durango · Bizkaia', exact: true }).click()
  const oldRequest = await pending.received
  await page.locator('#sv-suggestions').getByRole('button', { name: 'Bilbao · Bizkaia', exact: true }).click()
  await expect(page.locator('#sv-query')).toHaveValue('Bilbao')
  await settleResponse(page, oldRequest, townA)
  await expect(page.locator('#sv-query')).toHaveValue('Bilbao')
  await expect(page.locator('#sv-local-official')).toContainText('También en Bilbao')
  expect(new URL(page.url()).searchParams.get('municipio')).toBe('48020')
  const center = await page.evaluate(() => (window as any).map.getCenter())
  expect(center.lat).toBeCloseTo(townB.lat, 3)
  expect(center.lng).toBeCloseTo(townB.lng, 3)
})

test('una ficha de favorito tardía no repone la categoría descartada', async ({ page }) => {
  const pending = heldReply()
  await page.route('**/api/servicios/lugar/osm-node-1?*', pending.handler)
  await page.goto('/cerca?lat=43.169&lon=-2.632&servicio=osm-node-1&categorias=banos')
  const oldRequest = await pending.received
  await selectService(page, 'Agua potable')
  await expect(page.locator('.sv-card')).toContainText('Fuente vigente')
  await settleResponse(page, oldRequest, { ...meta, item: bathroom })
  await expect(page.locator('.sv-card')).toHaveCount(1)
  await expect(page.locator('.sv-card')).toContainText('Fuente vigente')
  await expect(page.locator('.sv-card[data-servicio="osm-node-1"]')).toHaveCount(0)
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  expect(new URL(page.url()).searchParams.get('categorias')).toBe('agua-potable')
})

test('recargas conserva la elección y no se enciende por una respuesta antigua', async ({ page }) => {
  const pending = heldReply()
  await page.route('**/data/chargers.json', pending.handler)
  await page.goto('/cerca?municipio=48027&categorias=banos')
  await expect(page.locator('.sv-card')).toHaveCount(1)
  await page.locator('#sv-category-box > summary').click()
  await page.locator('#sv-charging').check()
  const oldRequest = await pending.received
  await selectService(page, 'Agua potable')
  await expect(page.locator('#sv-charging')).toBeChecked()
  await page.locator('#sv-charging').uncheck()
  await settleResponse(page, oldRequest, { ts: meta.consultado, chargers: [[43.169, -2.632, 'Recarga de prueba', 'Prueba', 50]] })
  await expect(page.locator('#sv-charging')).not.toBeChecked()
  expect(await page.evaluate(() => {
    const w = window as any
    return !!w.chargersMain && w.map.hasLayer(w.chargersMain)
  })).toBe(false)
})

test('una descarga de gasolina tardía no mueve el mapa después de volver a servicios', async ({ page }) => {
  const pending = heldReply()
  await page.route('**/data/stations.json', pending.handler)
  await page.goto('/cerca?municipio=48027&categorias=banos')
  await expect(page.locator('.sv-card')).toHaveCount(1)
  await page.locator('#sv-view-fuel').click()
  const oldRequest = await pending.received
  await page.locator('#sv-view-services').click()
  await page.evaluate(() => (window as any).map.setView([43.168, -2.631], 16, { animate: false }))
  const before = await page.evaluate(() => ({ ...((window as any).map.getCenter()), zoom: (window as any).map.getZoom() }))
  await settleResponse(page, oldRequest, {
    Fecha: '21/11/2026 08:00:00', ListaEESSPrecio: [{
      IDEESS: '900001', 'Rótulo': 'Estación tardía', 'Precio Gasolina 95 E5': '1,432', 'Precio Gasoleo A': '1,651',
      IDProvincia: '48', IDMunicipio: '48027', Municipio: 'Durango', Provincia: 'BIZKAIA',
      'Dirección': 'Calle de prueba', Horario: 'L-D: 24H', Latitud: '43,180000', 'Longitud (WGS84)': '-2,640000',
    }],
  })
  await expect(page.locator('#fuel-content')).toBeHidden()
  const after = await page.evaluate(() => ({ ...((window as any).map.getCenter()), zoom: (window as any).map.getZoom() }))
  expect(after).toEqual(before)
  expect(await page.evaluate(() => {
    const w = window as any
    return !!w.clusterGroup && w.map.hasLayer(w.clusterGroup)
  })).toBe(false)
})
