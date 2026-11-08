import { test, expect, type Page, type Locator, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ministryFixture } from './ministry-fixture'

test.beforeEach(async ({ page, request }, info) => {
  await ministryFixture(page, request, info.config.metadata.live === true)
})

// Datos deliberadamente pequeños: dos estaciones comparten coordenadas y no
// deben confundirse. Solo se usan en CI/local; nunca sustituyen producción LIVE.
const sampleStations = [
  { IDEESS: '900001', 'Rótulo': 'Estación A', 'Precio Gasolina 95 E5': '1,432', 'Precio Gasoleo A': '1,651' },
  { IDEESS: '900002', 'Rótulo': 'Estación B', 'Precio Gasolina 95 E5': '1,289', 'Precio Gasoleo A': '1,423' },
  { IDEESS: '900003', 'Rótulo': 'Estación sin 95', 'Precio Gasolina 95 E5': '', 'Precio Gasoleo A': '1,532' },
].map((station, index) => ({
  ...station, IDProvincia: '28', IDMunicipio: '28079', Municipio: 'Madrid', Provincia: 'MADRID',
  'Dirección': 'Calle de prueba, ' + (index + 1), Horario: 'L-D: 24H',
  Latitud: '40,416800', 'Longitud (WGS84)': '-3,703800',
}))
async function smallSnapshot(page: Page) {
  await page.route('**/api/estaciones/provincia/28', route => route.fulfill({ json: {
    Fecha: '04/11/2026 19:19:24', ListaEESSPrecio: sampleStations,
  } }))
  await page.route('**/api/history/**', route => route.fulfill({ json: { series: {}, median: [] } }))
  await page.route('**/api/predict/**', route => route.fulfill({ json: { verdict: null } }))
}
function cardFor(page: Page, id: string) {
  return page.locator('.station-card').filter({ has: page.locator('[data-fav-id="' + id + '"]') })
}
async function expectUncovered(locator: Locator, completo = false) {
  await expect(locator).toBeVisible()
  await expect.poll(() => locator.evaluate((element, bordes) => {
    const rect = element.getBoundingClientRect()
    const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
    const puntos = bordes ? [[x, y], [x, rect.top + 3], [x, rect.bottom - 3], [rect.left + 3, y], [rect.right - 3, y]] : [[x, y]]
    return puntos.flatMap(([px, py]) => {
      const hit = document.elementFromPoint(px, py)
      if (hit && (hit === element || element.contains(hit))) return []
      return [{ punto: { x: px, y: py }, intercepta: hit?.outerHTML.slice(0, 400) ?? 'Fuera de la ventana' }]
    })
  }, completo), { message: 'Debe poder pulsarse sin obstáculos: ' + locator.toString() }).toEqual([])
}

for (const { width, height } of [{ width: 1280, height: 844 }, { width: 390, height: 844 }, { width: 320, height: 844 }, { width: 844, height: 390 }]) {
  test('media nacional a ' + width + '×' + height + 'px: no tapa navegación, lista ni ficha', async ({ page }, info) => {
    test.skip(info.config.metadata.live === true, 'Datos nacionales controlados; producción conserva sus respuestas reales.')
    await page.setViewportSize({ width, height })
    await smallSnapshot(page)
    const hoy = new Date().toISOString().slice(0, 10)
    const datos = { days: 30, fuels: {
      '95': { today: 1.678, delta_pct: -4.03, days_available: 31, last_date: hoy },
      diesel: { today: 1.872, delta_pct: -0.93, days_available: 31, last_date: hoy },
    } }
    // La API local puede carecer de serie: forzamos un widget real, no un caso
    // que pasa simplemente porque nunca se llegó a pintar la media nacional.
    await page.route('**/api/stats/national?days=30', route => route.fulfill({ json: datos }))
    await page.goto('/gasolineras/mapa?prov=28')
    const widget = page.locator('#stats-nacional'), detail = page.locator('#station-detail')
    const card = cardFor(page, '900001')
    await expect(widget).toBeVisible({ timeout: 10000 })
    await expect(widget).toContainText('1.678')
    await expect(widget).toBeInViewport({ ratio: 1 })
    const controls = [page.locator('#btn-map-location'), page.locator('#map-navigation .leaflet-control-zoom-in'), page.locator('#map-navigation .leaflet-control-zoom-out'), page.locator('#btn-electrolineras')]
    for (const control of controls) await expectUncovered(control, true)
    if (width < 1024) {
      await page.locator('#btn-sheet-toggle').click()
      await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/)
      await expect(widget).toBeHidden()
      await expectUncovered(page.locator('#btn-toggle-filters'))
    }
    await expect(card).toBeVisible({ timeout: 20000 })
    await card.click()
    await expect(detail).toBeVisible()
    await expect(widget).toBeHidden()
    await expectUncovered(detail.locator('.popup-header-title'))
    await expectUncovered(page.locator('#btn-station-detail-close'))
    if (height === 390) {
      expect(await page.locator('#station-detail-content').evaluate(el => el.clientHeight)).toBeGreaterThan(100)
      const destino = detail.locator('.popup-nav-google')
      await destino.scrollIntoViewIfNeeded()
      await expectUncovered(destino, true)
    }
    for (const control of controls.slice(0, 3)) await expectUncovered(control, true)
    await page.locator('#btn-station-detail-close').click()
    await expect(widget).toBeVisible()
    await expect(widget).toBeInViewport({ ratio: 1 })
    for (const control of controls) await expectUncovered(control, true)

    if (width === 390 || height === 390) {
      // También debe ocultarse cuando la consulta termina con la ficha abierta.
      const pendiente = Promise.withResolvers<Route>()
      await page.route('**/api/stats/national?days=30', route => pendiente.resolve(route))
      await page.reload()
      await expect(card).toBeAttached({ timeout: 20000 })
      await page.locator('#btn-sheet-toggle').click()
      await card.click()
      await expect(detail).toBeVisible()
      await (await pendiente.promise).fulfill({ json: datos })
      await expect(widget).toBeAttached()
      await expect(widget).toBeHidden()
      await expectUncovered(page.locator('#btn-station-detail-close'))
      for (const control of controls.slice(0, 3)) await expectUncovered(control, true)
      await page.locator('#btn-station-detail-close').click()
      await expect(widget).toBeVisible()
      await expect(widget).toBeInViewport({ ratio: 1 })
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('los grupos muestran cantidad y precio mínimo exactos; un precio ausente no se convierte en cero', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Caso límite controlado; producción conserva sus datos oficiales.')
  await smallSnapshot(page)
  await page.goto('/gasolineras/mapa?prov=28')
  const group = page.locator('#map .station-cluster-marker').first()
  await expect(group).toContainText('3 gasolineras', { timeout: 20000 })
  await expect(group).toContainText('desde 1,289 €')
  await group.click()
  // Leaflet puede separar puntos coincidentes sin cambiar el zoom; lo que
  // importa es poder ver y elegir cada estación, no el mecanismo de cámara.
  await expect(page.locator('#map .station-price-marker')).toHaveCount(3)
  await expect(page.locator('[data-station-id="900001"].station-price-marker')).toContainText('1,432 €')
  await expect(page.locator('[data-station-id="900002"].station-price-marker')).toContainText('1,289 €')
  await expect(page.locator('[data-station-id="900003"].station-price-marker')).toContainText('Sin precio')
})

test('la selección distingue IDs en las mismas coordenadas y Escape devuelve el foco', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Caso límite controlado; producción conserva sus datos oficiales.')
  await smallSnapshot(page)
  await page.goto('/gasolineras/mapa?prov=28')
  const first = cardFor(page, '900001'), second = cardFor(page, '900002')
  await expect(first).toBeVisible({ timeout: 20000 })
  await first.click()
  const detail = page.locator('#station-detail')
  await expect(detail).toHaveAttribute('data-station-id', '900001')
  await expect(detail.locator('.popup-price-main')).toContainText('1,432')
  await second.click()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await expect(detail).toHaveAttribute('data-station-id', '900002')
  await expect(detail.locator('.popup-header-title')).toContainText('Estación B')
  await expect(detail.locator('[data-pop-share]')).toHaveAttribute('data-pop-share', '900002')
  await expect(page.locator('.station-price-marker.is-selected')).toHaveCount(1)
  await expect(page.locator('.station-price-marker.is-selected')).toHaveAttribute('data-station-id', '900002')
  await expect(page.locator('#map .station-cluster-marker')).toHaveCount(1)
  await expect(page.locator('#map .station-cluster-marker')).toContainText('2 gasolineras')
  await expect(page.locator('#map .station-price-marker')).toHaveCount(1)
  await expectUncovered(page.locator('.station-price-marker.is-selected'))
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  await expect(second).toBeFocused()
  await expect(page.locator('.station-price-marker.is-selected')).toHaveCount(0)
  // Al cerrar, la estación vuelve a su grupo. Se abre con teclado antes de
  // elegir su marcador: no depende de que quedase separado por la selección.
  const group = page.locator('#map .station-cluster-marker').first()
  await expect(group).toContainText('3 gasolineras')
  await group.focus()
  await group.press('Enter')
  const marker = page.locator('.station-price-marker[data-station-id="900002"]')
  await expect(marker).toBeVisible()
  await marker.focus()
  await marker.press('Enter')
  await expect(detail).toBeVisible()
  await expect(page.locator('#btn-station-detail-close')).toBeFocused()
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  await page.keyboard.press('Escape')
  await expect(detail).toBeHidden()
  // Ese marcador deja de existir cuando vuelve a agruparse; el mapa conserva
  // el foco para continuar navegando en lugar de perderlo en el documento.
  await expect(page.locator('#map')).toBeFocused()
})

test('la ficha conserva estación al cambiar combustible y se cierra si se abandona su zona', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Caso límite controlado; producción conserva sus datos oficiales.')
  await smallSnapshot(page)
  await page.goto('/gasolineras/mapa?prov=28')
  const card = cardFor(page, '900001')
  await expect(card).toBeVisible({ timeout: 20000 })
  await card.click()
  const detail = page.locator('#station-detail')
  await expect(detail.locator('.popup-price-main')).toContainText('1,432')
  await page.locator('#sel-combustible').selectOption('Precio Gasoleo A')
  await expect(detail).toHaveAttribute('data-station-id', '900001')
  await expect(detail.locator('.popup-price-main')).toContainText('1,651')
  await expect(detail.locator('.popup-price-main')).toContainText('€/L')
  await expect(page.locator('.station-price-marker.is-selected')).toContainText('1,651')
  await page.locator('#sel-provincia').selectOption('08')
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  await expect(detail).toBeHidden({ timeout: 20000 })
  await expect(page.locator('.station-price-marker.is-selected')).toHaveCount(0)
})

test('el estilo vectorial real se aplica y satélite conserva selección y precios', async ({ page }) => {
  test.setTimeout(45000)
  const mapErrors: string[] = []
  page.on('pageerror', error => mapErrors.push(error.message))
  page.on('console', message => {
    if (/\[liberty\].*(no aplicado|error)|style.*(?:validation|invalid)/i.test(message.text())) mapErrors.push(message.text())
  })
  await page.goto('/gasolineras/madrid/madrid')
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  // No basta ver un mapa: el raster de respaldo ocultaría errores del estilo.
  await expect.poll(() => page.evaluate(() => {
    const layer = (window as any).mapLayers.light
    return layer.getMaplibreMap?.().getStyle()?.layers.find((item: any) => item.type === 'background')?.paint?.['background-color']
  }), { timeout: 15000, message: 'Debe estar aplicado el estilo vectorial, no el raster de respaldo' }).toBe('#f3f5f6')
  const hierarchy = await page.evaluate(() => {
    const layers = (window as any).mapLayers.light.getMaplibreMap().getStyle().layers
    return {
      city: layers.filter((layer: any) => /^label_city/.test(layer.id)).map((layer: any) => layer.maxzoom),
      minorRoad: layers.find((layer: any) => layer.id === 'highway-name-minor')?.minzoom,
      poi: layers.filter((layer: any) => layer['source-layer'] === 'poi').map((layer: any) => layer.minzoom),
    }
  })
  expect(hierarchy.city.length).toBeGreaterThan(0)
  expect(hierarchy.city.every((zoom: number) => zoom <= 16)).toBe(true)
  expect(hierarchy.minorRoad).toBeGreaterThanOrEqual(15)
  expect(hierarchy.poi.length).toBeGreaterThan(0)
  expect(hierarchy.poi.every((zoom: number) => zoom >= 17)).toBe(true)
  await page.locator('.station-card').first().click()
  const detail = page.locator('#station-detail')
  const id = await detail.getAttribute('data-station-id')
  const price = await detail.locator('.popup-price-main').innerText()
  await page.locator('#btn-satellite').click()
  await expect.poll(() => page.evaluate(() => (window as any).map.hasLayer((window as any).mapLayers.satellite))).toBe(true)
  await expect(detail).toHaveAttribute('data-station-id', id!)
  await expect(detail.locator('.popup-price-main')).toHaveText(price)
  await page.locator('#btn-satellite').click()
  await expect.poll(() => page.evaluate(() => (window as any).map.hasLayer((window as any).mapLayers.light))).toBe(true)
  await expect(detail).toHaveAttribute('data-station-id', id!)
  expect(mapErrors).toEqual([])
})

const pruebaTactil = test.extend({ hasTouch: true })
for (const width of [390, 320]) {
  pruebaTactil('móvil ' + width + 'px: ficha y filtros dejan controles accesibles y no desbordan', async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 })
    async function tocarVisible(control: Locator) {
      await expectUncovered(control)
      const { x, y } = await control.evaluate(el => {
        const rect = el.getBoundingClientRect()
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
      })
      await page.touchscreen.tap(x, y)
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    }
    // A 390 px hacemos aparecer la franja cuando el usuario ya está en los
    // filtros. La comprobación en producción conserva las respuestas oficiales.
    const tendencia = width === 390 && !info.config.metadata.live ? Promise.withResolvers<Route>() : undefined
    if (tendencia) await page.route('**/data/trends.json', route => tendencia.resolve(route))
    await page.goto('/gasolineras/madrid/madrid')
    await expect(page.locator('#btn-sheet-toggle')).toBeVisible()
    const card = page.locator('.station-card').first()
    // Con resultados ya cargados el asa prioriza la lista; antes de recibirlos
    // abre los filtros. Esperar la tarjeta en el DOM fija el caso que probamos.
    await expect(card).toBeAttached({ timeout: 20000 })
    // La cabecera nueva puede ocupar dos filas, pero debe dejar el mapa útil
    // dentro de la pantalla y sus accesos siguen disponibles en 320 y 390 px.
    await expect(page.locator('.mh-day')).toBeVisible()
    await expect.poll(() => page.locator('#app-body').evaluate(el => Math.abs(el.getBoundingClientRect().bottom + window.scrollY - window.innerHeight))).toBeLessThanOrEqual(1)
    const encuadre = await page.evaluate(() => ({
      cabecera: document.querySelector('.masthead')!.getBoundingClientRect().height,
      mapa: document.querySelector('#map-container')!.getBoundingClientRect().height,
      pantalla: window.innerHeight,
    }))
    expect(encuadre.cabecera).toBeLessThan(160)
    expect(encuadre.mapa).toBeGreaterThan(420)
    await info.attach('alturas-mapa-' + width, { body: JSON.stringify(encuadre), contentType: 'application/json' })
    await expect.poll(() => page.evaluate(() => Boolean((window as any).mapLayers.light.getMaplibreMap?.().areTilesLoaded())), { timeout: 15000, message: 'El mapa vectorial termina de cargar antes de revisar su captura' }).toBe(true)
    await page.screenshot({ path: info.outputPath('mapa-cerca-mi-dia-' + width + '.png') })
    await tocarVisible(page.locator('#btn-sheet-toggle'))
    await expect(page.locator('#sidebar')).toHaveClass(/\bopen\b/)
    // Antes de tocar los filtros, deja que el panel llegue a su altura final.
    // Un toque por coordenadas no lleva el control al centro de la ventana.
    await page.locator('#sidebar').evaluate(async el => {
      await Promise.all(el.getAnimations().map(animacion => animacion.finished))
    })
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(page.locator('#filter-fields')).toBeHidden()
    await tocarVisible(page.locator('#btn-toggle-filters'))
    await expect(page.locator('#sel-combustible')).toBeVisible()
    if (tendencia) {
      // Un clic o un cambio de foco puede consultar la geometría justo cuando
      // aparece la franja, antes de que se ejecute el siguiente ResizeObserver.
      const primerEncuadre = await page.evaluateHandle(() => ({
        margen: new Promise<number>(resolve => {
          const observador = new MutationObserver(() => {
            observador.disconnect()
            const mapa = document.querySelector('#app-body')!.getBoundingClientRect()
            resolve(Math.round(mapa.bottom + window.scrollY - window.innerHeight))
          })
          observador.observe(document.querySelector('#trend-strip')!, { attributes: true, attributeFilter: ['hidden'] })
        }),
      }))
      const ahora = new Date().toISOString()
      const antes = new Date(Date.now() - 3600000).toISOString()
      await (await tendencia.promise).fulfill({ json: {
        current: { ts: ahora, sourceAt: ahora, ministryDate: '05/11/2026 11:00:00', medians: { g95: 1.59, diesel: 1.55 } },
        previous: { ts: antes, sourceAt: antes, ministryDate: '05/11/2026 10:00:00', medians: { g95: 1.60, diesel: 1.54 } },
      } })
      await expect(page.locator('#trend-strip')).toBeVisible()
      expect(await primerEncuadre.evaluate(encuadre => encuadre.margen)).toBe(0)
      await primerEncuadre.dispose()
      await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    }
    await tocarVisible(page.locator('#btn-toggle-filters'))
    await expect(page.locator('#filter-fields')).toBeHidden()
    await expect(card).toBeVisible()
    await tocarVisible(card)
    const detail = page.locator('#station-detail')
    await expect(detail).toBeVisible()
    await expect(page.locator('#sidebar')).not.toHaveClass(/\bopen\b/)
    const panelBox = await detail.boundingBox(), mapBox = await page.locator('#map-container').boundingBox()
    expect(panelBox).not.toBeNull()
    expect(mapBox).not.toBeNull()
    expect(panelBox!.height).toBeLessThanOrEqual(mapBox!.height * 0.76)
    expect(panelBox!.x).toBeGreaterThanOrEqual(0)
    expect(panelBox!.x + panelBox!.width).toBeLessThanOrEqual(width)
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(844)
    await expectUncovered(page.locator('#btn-station-detail-close'))
    await expectUncovered(page.locator('#btn-map-location'))
    await expectUncovered(page.locator('#map-navigation .leaflet-control-zoom-in'))
    await expectUncovered(page.locator('#map-navigation .leaflet-control-zoom-out'))
    const accessible = await new AxeBuilder({ page }).include('#station-detail').include('#map-navigation').withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(accessible.violations.filter(item => item.impact === 'serious' || item.impact === 'critical')).toEqual([])
    await tocarVisible(page.locator('#btn-station-detail-close'))
    await expect(detail).toBeHidden()
    await expect(page.locator('#btn-sheet-toggle')).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}

test('móvil: abrir antes de recibir precios permite usar filtros y conserva la elección al llegar los datos', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Carga demorada controlada; producción conserva sus consultas reales.')
  await page.setViewportSize({ width: 390, height: 844 })
  await smallSnapshot(page)
  let releaseStations!: () => void
  const pendingStations = new Promise<void>(resolve => { releaseStations = resolve })
  await page.route('**/api/estaciones/provincia/28', async route => {
    await pendingStations
    await route.fallback()
  })
  try {
    await page.goto('/gasolineras/mapa?prov=28')
    await expect(page.locator('#station-list')).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('.station-card')).toHaveCount(0)
    await page.locator('#btn-sheet-toggle').click()
    await expect(page.locator('#filter-fields')).toBeVisible()
    await expect(page.locator('#btn-toggle-filters')).toHaveAttribute('aria-expanded', 'true')
    await page.locator('#sel-combustible').selectOption('Precio Gasoleo A')

    releaseStations()
    await expect(page.locator('.station-card')).toHaveCount(3)
    await expect(page.locator('#station-list')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('#sel-combustible')).toHaveValue('Precio Gasoleo A')
    await expect(page.locator('#filter-fields')).toBeVisible()
    const cheapest = cardFor(page, '900002')
    await expect(cheapest).toContainText('1,423')
    await page.locator('#btn-toggle-filters').click()
    await expect(page.locator('#filter-fields')).toBeHidden()
    await cheapest.click()
    await expect(page.locator('#station-detail')).toHaveAttribute('data-station-id', '900002')
    await expect(page.locator('#station-detail .popup-price-main')).toContainText('1,423')
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  } finally {
    releaseStations()
  }
})

test('móvil 320px: la tabla con letra grande conserva sus columnas y se desplaza con teclado sin ensanchar la página', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/gasolineras/madrid/madrid')
  // Las fuentes disponibles cambian entre sistemas. El tamaño grande también
  // representa a quien necesita aumentar el texto para leer los precios.
  await page.locator('.seo-summary').evaluate(element => { (element as HTMLElement).style.fontFamily = 'Verdana, sans-serif' })
  await page.locator('.seo-summary table').evaluate(element => { (element as HTMLElement).style.fontSize = '20px' })
  const region = page.getByRole('region', { name: 'Resumen de precios por combustible' })
  await expect(region.locator('th')).toHaveText(['Combustible', 'Más barato', 'Medio', 'Más caro'])
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
  await region.focus()
  await expect(region).toBeFocused()
  await region.press('ArrowRight')
  await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  await expect.poll(() => page.evaluate(() => window.scrollX)).toBe(0)
})

test('el control de ubicación explica la denegación y permite volver a intentarlo sin enviar coordenadas al servidor', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (success: (p: unknown) => void, failure: (e: unknown) => void) => {
      if ((window as any).__gpsAllowed) success({ coords: { latitude: 40.4168, longitude: -3.7038, accuracy: 10 } })
      else failure({ code: 1 })
    } })
  })
  const leaks: string[] = []
  page.on('request', request => { if (/40\.4168|-3\.7038/.test(request.url())) leaks.push(request.url()) })
  await page.goto('/gasolineras/mapa?prov=28')
  await expect(page.locator('.station-card').first()).toBeVisible({ timeout: 20000 })
  await page.locator('#btn-map-location').click()
  await expect(page.locator('#map-location-status')).toBeVisible()
  await expect(page.locator('#map-location-status')).toContainText(/permiso|bloquead|permit/i)
  await expect(page.locator('#btn-map-location')).toBeEnabled()
  expect(new URL(page.url()).hash).toBe('')
  await page.evaluate(() => { (window as any).__gpsAllowed = true })
  await page.locator('#btn-map-location').click()
  await expect(page).toHaveURL(/#near=/)
  await expect(page.locator('#search-origin-note')).toContainText('tu ubicación')
  await expect(page.locator('.station-card').first()).toBeVisible()
  expect(new URL(page.url()).hash.slice('#near='.length).split(',').map(Number)).toEqual([40.4168, -3.7038])
  expect(leaks).toEqual([])
})
