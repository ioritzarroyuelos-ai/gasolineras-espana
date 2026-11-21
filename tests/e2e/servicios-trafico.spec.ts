import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Respuestas artificiales para comprobar estados del mapa. No acreditan una
// incidencia real ni descargan imágenes de cámaras o envían datos a producción.
const NOW = Date.parse('2026-11-21T10:00:00Z')
const iso = (n = NOW) => new Date(n).toISOString()
const town = { ine: '08019', nombre: 'Barcelona', provinciaNombre: 'Barcelona', lat: 41.3851, lng: 2.1734, servicios: [] }
const trafficName = 'Tráfico en Cataluña · incidencias publicadas'
const cameraName = 'Cámaras de tráfico · Cataluña'
const incident = { id: 'sct-99001', nombre: 'Incidencia de prueba', descripcion: 'Obras publicadas por la fuente · <img src=x onerror=alert(1)>', fechaIncidencia: '2026-11-02T06:46:13Z', estado: 'publicada', lat: town.lat, lon: town.lng, carretera: 'B-20', sentido: 'Ambdós sentits' }
const camera = { id: 'camara-sct-test001', nombre: 'Cámara de prueba B-20', carretera: 'B-20', municipio: 'Barcelona', pk: '1', lat: town.lat + .0005, lon: town.lng, ubicacion: 'publicada', urlCamara: 'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=test001.gif', fuenteImagen: 'SCT', horaImagen: null }
type State = { now: number; trafficFail: boolean; cameraFail: boolean; trafficWait?: Promise<void>; cameraWait?: Promise<void>; trafficRequests: number; cameraRequests: number; imageRequests: number; mutations: string[]; errors: string[] }
function trafficData(state: State) {
  const fresh = state.now < NOW + 600000
  const items = fresh ? [incident, { ...incident, id: 'sct-99002', nombre: 'Incidencia sin punto de prueba', lat: null, lon: null }] : []
  return { schema: 1, region: 'Cataluña', regionId: 'cataluna', consultado: iso(state.now), evaluadoEn: iso(state.now), fechaDatos: iso(), caduca: iso(NOW + 600000), estado: fresh ? 'actual' : 'sin_actualizar', total: items.length, conCoordenadas: fresh ? 1 : 0, sinCoordenadas: fresh ? 1 : 0, items, fuenteUrl: 'https://cit.transit.gencat.cat/', warnings: [] }
}
function cameraData(state: State) {
  return { schema: 1, region: 'Cataluña', regionId: 'cataluna', consultado: iso(state.now), fechaDirectorio: iso(), caduca: iso(NOW + 30 * 3600000), estado: state.now < NOW + 30 * 3600000 ? 'actual' : 'sin_actualizar', total: 1, conCoordenadas: 1, items: [camera], fuenteUrl: 'https://analisi.transparenciacatalunya.cat/Transport/C-meres-de-tr-nsit-a-les-carreteres-de-Catalunya/3tzz-6b9y', warnings: [] }
}
async function fixture(page: Page, context: BrowserContext): Promise<State> {
  const state: State = { now: NOW, trafficFail: false, cameraFail: false, trafficRequests: 0, cameraRequests: 0, imageRequests: 0, mutations: [], errors: [] }
  await page.clock.install({ time: NOW })
  page.on('pageerror', error => state.errors.push(error.message))
  // Una cámara abierta explícitamente también queda sustituida: el test puede
  // comprobar la nueva pestaña sin pedir una imagen al organismo público.
  await context.route(camera.urlCamara, route => {
    state.imageRequests++
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="es"><title>Fuente de cámara simulada</title><p>Destino oficial sustituido durante la prueba.</p></html>' })
  })
  await context.route('**/api/**', async route => {
    const request = route.request(), u = new URL(request.url()), path = u.pathname
    if (request.method() !== 'GET') { state.mutations.push(request.method() + ' ' + path); return route.fulfill({ status: 405, json: { error: 'No se permiten mutaciones en esta prueba' } }) }
    if (['/api/me', '/api/auth/me'].includes(path)) return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (path === '/api/servicios/categorias') return route.fulfill({ json: { consultado: iso(state.now), fechaDatos: iso(state.now), desactualizado: false, total: 0, categorias: [] } })
    if (path === '/api/servicios/itv') return route.fulfill({ json: { schema: 1, proveedor: 'itv-oficial', generadoEn: iso(state.now), totalDirectorio: 0, totalConCoordenadas: 0, total: 0, items: [], warnings: [] } })
    if (path === '/api/trafico/cataluna') {
      state.trafficRequests++
      if (state.trafficWait) await state.trafficWait
      return state.trafficFail ? route.fulfill({ status: 503, json: { error: 'Caída SCT simulada' } }) : route.fulfill({ json: trafficData(state) })
    }
    if (path === '/api/camaras/cataluna') {
      state.cameraRequests++
      if (state.cameraWait) await state.cameraWait
      return state.cameraFail ? route.fulfill({ status: 503, json: { error: 'Caída de directorio simulada' } }) : route.fulfill({ json: cameraData(state) })
    }
    if (path === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (path === '/api/localidades') return route.fulfill({ json: [] })
    return route.fulfill({ status: 503, json: { error: 'API fuera del escenario aislado' } })
  })
  return state
}
const item = (page: Page, id: string) => page.locator('.sv-card[data-servicio="' + id + '"]')
const popup = (page: Page) => page.locator('.leaflet-popup .sv-popup')
async function open(page: Page, categories: string) {
  await page.goto('/cerca?municipio=' + town.ine + '&categorias=' + categories)
  if (page.viewportSize()!.width < 1024) await page.locator('#btn-sheet-toggle').click()
  await expect(page.locator('#map .leaflet-map-pane')).toBeAttached()
}
async function choose(page: Page, name: string) {
  await page.locator('#sv-query').fill(name)
  await page.locator('#sv-search').evaluate(form => (form as HTMLFormElement).requestSubmit())
  await page.locator('#sv-suggestions').getByRole('button', { name: 'Servicio: ' + name, exact: true }).click()
}
async function refreshed(page: Page) {
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
}
function clean(state: State) { expect(state.mutations).toEqual([]); expect(state.errors).toEqual([]) }

test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Incidencias y cámaras simuladas; no usar como evidencia de su estado real.')
  await page.setViewportSize({ width: 1280, height: 900 })
})

for (const width of [1280, 390]) test('capas oficiales legibles y accesibles a ' + width + ', con filtros diferenciados y sin descarga de imágenes', async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page, context)
  await open(page, 'trafico-cataluna,camaras-cataluna')
  const traffic = item(page, incident.id), cam = item(page, camera.id)
  await expect(traffic).toContainText('2 nov 2026')
  await expect(traffic).toContainText('Sigue incluida en el parte publicado por la fuente')
  await expect(traffic.locator('img')).toHaveCount(0)
  await expect(traffic.getByRole('button', { name: /favorito|guardar/i })).toHaveCount(0)
  await expect(traffic.getByRole('link', { name: /Google Maps|Apple Maps|Waze|Cómo llegar/ })).toHaveCount(0)
  await expect(traffic.getByRole('link', { name: 'Parte completo y fuente oficial' })).toHaveAttribute('href', '/trafico/cataluna')
  await expect(item(page, 'sct-99002')).toHaveCount(0)
  await expect(page.locator('#sv-source')).toContainText('1 incidencias del parte no tienen coordenadas contrastadas')
  await expect(cam).toContainText('Hora de imagen sin publicar')
  await expect(cam).toContainText('No se confirma vídeo ni imagen en directo')
  await expect(cam.locator('img,video,iframe')).toHaveCount(0)
  await expect(cam.getByRole('button', { name: /favorito|guardar/i })).toHaveCount(0)
  const external = cam.getByRole('link', { name: 'Ver cámara oficial', exact: true })
  await expect(external).toHaveAttribute('href', camera.urlCamara)
  await expect(external).toHaveAttribute('target', '_blank')
  await expect(external).toHaveAttribute('rel', /noopener/)
  await expect(external).toHaveAttribute('rel', /noreferrer/)
  for (const filter of ['sv-open', 'sv-free', 'sv-accessible']) {
    await page.locator('#' + filter).check()
    await expect(traffic).toHaveCount(1); await expect(cam).toHaveCount(1)
  }
  await expect(page.locator('#sv-source')).toContainText('Los filtros de horario, gratuidad y accesibilidad no se aplican al tráfico')
  await expect(page.locator('#sv-source')).toContainText('Los filtros de horario, gratuidad y accesibilidad no se aplican a las cámaras')
  expect(state.imageRequests).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  expect((await new AxeBuilder({ page }).include('.sv-panel').analyze()).violations).toEqual([])
  // Las fichas se sustituyen al refrescar el mapa; la captura de la vista no
  // conserva un elemento antiguo entre el desplazamiento y el siguiente frame.
  await traffic.scrollIntoViewIfNeeded(); await expect(traffic).toBeInViewport()
  await page.screenshot({ path: info.outputPath('trafico-mapa-' + width + '.png') })
  await cam.scrollIntoViewIfNeeded(); await expect(cam).toBeInViewport()
  await page.screenshot({ path: info.outputPath('camara-mapa-' + width + '.png') })
  if (width === 1280) {
    const opened = context.waitForEvent('page')
    await external.click()
    const newTab = await opened
    await expect(newTab).toHaveURL(camera.urlCamara)
    await expect(newTab.getByText('Destino oficial sustituido durante la prueba.')).toBeVisible()
    expect(state.imageRequests).toBe(1)
    expect(new URL(page.url()).pathname).toBe('/cerca')
    await newTab.close()
  }
  clean(state)
})

test('al caducar el parte SCT retira incidencia, pin y popup sin decir que la carretera está libre', async ({ page, context }, info) => {
  const state = await fixture(page, context)
  await open(page, 'trafico-cataluna')
  await expect(item(page, incident.id)).toHaveCount(1)
  await item(page, incident.id).getByRole('button', { name: 'Ver el punto publicado' }).click()
  await expect(popup(page)).toContainText(incident.nombre)
  await expect(page.locator('#map .sv-pin-traffic')).toHaveCount(1)
  state.now = NOW + 600001
  await page.clock.fastForward(600001)
  await expect(item(page, incident.id)).toHaveCount(0)
  await expect(page.locator('#map .sv-pin-traffic')).toHaveCount(0)
  await expect(popup(page)).toHaveCount(0)
  await expect(page.locator('#sv-source')).toContainText('No hay un parte reciente comprobable')
  await expect(page.locator('#sv-source')).toContainText('Esto no significa que las carreteras estén despejadas')
  await page.screenshot({ path: info.outputPath('trafico-caducado.png') })
  clean(state)
})

test('un fallo de red retira las incidencias previas de la lista y del mapa', async ({ page, context }) => {
  const state = await fixture(page, context)
  await open(page, 'trafico-cataluna')
  await expect(item(page, incident.id)).toHaveCount(1)
  await item(page, incident.id).getByRole('button', { name: 'Ver el punto publicado' }).click()
  await expect(popup(page)).toContainText(incident.nombre)
  state.trafficFail = true
  const requested = state.trafficRequests
  await refreshed(page)
  await expect.poll(() => state.trafficRequests).toBeGreaterThan(requested)
  await expect(item(page, incident.id)).toHaveCount(0)
  await expect(page.locator('#map .sv-pin-traffic')).toHaveCount(0)
  await expect(popup(page)).toHaveCount(0)
  await expect(page.locator('#sv-source')).toContainText('Esto no significa que las carreteras estén despejadas')
  clean(state)
})

for (const oldLayer of ['trafico', 'camaras'] as const) test('la respuesta tardía de ' + oldLayer + ' no restaura una capa que el visitante quitó', async ({ page, context }) => {
  const state = await fixture(page, context)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  if (oldLayer === 'trafico') state.trafficWait = gate; else state.cameraWait = gate
  try {
    await open(page, oldLayer === 'trafico' ? 'trafico-cataluna' : 'camaras-cataluna')
    await expect.poll(() => oldLayer === 'trafico' ? state.trafficRequests : state.cameraRequests).toBeGreaterThan(0)
    await choose(page, oldLayer === 'trafico' ? cameraName : trafficName)
    await expect(item(page, oldLayer === 'trafico' ? camera.id : incident.id)).toHaveCount(1)
    const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/' + (oldLayer === 'trafico' ? 'trafico' : 'camaras') + '/cataluna')
    release(); await (await response).finished()
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    await expect(item(page, oldLayer === 'trafico' ? incident.id : camera.id)).toHaveCount(0)
    await expect(page.locator('.sv-card')).toHaveCount(1)
    expect(new URL(page.url()).searchParams.get('categorias')).toBe(oldLayer === 'trafico' ? 'camaras-cataluna' : 'trafico-cataluna')
    if (oldLayer === 'trafico') await expect(page.locator('#map .sv-pin-traffic')).toHaveCount(0)
    await expect(popup(page)).toHaveCount(0)
  } finally { release() }
  clean(state)
})

test('un directorio de cámaras de más de 30 horas avisa y mantiene desconocida la hora de imagen', async ({ page, context }, info) => {
  const state = await fixture(page, context)
  await open(page, 'camaras-cataluna')
  const cam = item(page, camera.id)
  await expect(cam).toContainText('Hora de imagen sin publicar')
  await expect(cam).not.toContainText('Directorio pendiente de actualizar')
  state.now = NOW + 30 * 3600000 + 1000
  await page.clock.fastForward(30 * 3600000 + 1000)
  await expect(cam).toContainText('Directorio pendiente de actualizar')
  await expect(cam).toContainText('directorio del 21 nov 2026')
  await expect(cam).toContainText('Hora de imagen sin publicar')
  await expect(cam).toContainText('No se confirma vídeo ni imagen en directo')
  await expect(cam.locator('img,video,iframe')).toHaveCount(0)
  await cam.getByRole('button', { name: 'Ver el punto publicado' }).click()
  await expect(popup(page)).toContainText('Directorio pendiente de actualizar')
  await expect(popup(page)).toContainText('Hora de imagen sin publicar')
  await page.screenshot({ path: info.outputPath('camara-directorio-caducado.png') })
  expect(state.imageRequests).toBe(0)
  clean(state)
})
