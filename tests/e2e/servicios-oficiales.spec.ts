import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { servicioTileId } from '../../scripts/lib/servicios.mjs'

// Datos artificiales y respuestas locales: verifican la interfaz y sus límites,
// no la cobertura real, una reserva, un inicio de sesión o un envío de mensajes.
const NOW = Date.parse('2026-11-21T10:00:00Z')
const iso = (offset = 0) => new Date(NOW + offset).toISOString()
const town = { ine: '50297', nombre: 'Zaragoza', provinciaNombre: 'Zaragoza', lat: 41.65, lng: -.88, servicios: [] }
const meta = { consultado: iso(), fechaDatos: iso(), desactualizado: false, atribucion: '© OpenStreetMap', licencia: 'ODbL-1.0' }
const bathroom = { id: 'osm-node-99001', nombre: 'Baño de prueba', lat: town.lat + .0003, lon: town.lng, categorias: ['banos'], horario: '24/7', gratis: true, accesible: 'si', acceso: 'publico', ubicacion: 'punto', fechaEdicion: iso(), fuenteUrl: 'https://www.openstreetmap.org/node/99001' }
const itv = { id: 'itv-50-5001', proveedor: 'itv-oficial', nombre: 'ITV de prueba', categorias: ['itv'], lat: town.lat, lon: town.lng,
  direccion: 'Dirección ficticia de la prueba', municipio: town.nombre, ubicacion: 'punto', gratis: null, accesible: 'desconocido', acceso: 'desconocido',
  verificadoEn: iso(), publicadoEn: '2026-11-20', desactualizado: false,
  coordenadas: { fuente: 'DGT', fuenteUrl: 'https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/', verificadoEn: iso(), desactualizadas: false },
  fuenteNombre: 'DGT', fuenteUrl: 'https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/', directorioUrl: '/itv/zaragoza/zaragoza',
  cita: { url: 'https://www.serviciositv.es/cita-previa-itv', verificadoEn: iso(), desactualizada: false },
  tarifas: { url: 'https://www.aragon.es/-/inspeccion-tecnica-de-vehiculos-itv-', verificadoEn: iso(), desactualizada: false },
}
const itvMeta = { schema: 1, proveedor: 'itv-oficial', generadoEn: iso(), totalDirectorio: 2, totalConCoordenadas: 1, desactualizado: false, warnings: [] }
const bike = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id: 'gbfs-zaragoza-' + id, nombre: name, lat: town.lat, lon: town.lng, capacidad: 8,
  bicis: 0, anclajes: 8, estado: 'operativa', actualizado: iso(), caduca: iso(300000), permiteAlquiler: true, permiteDevolucion: true, ...extra,
})
type Bike = ReturnType<typeof bike>
type State = {
  bikes: Bike[]; bikeFailure: boolean; bikeRequests: number; catalogRequests: number; catalogWait?: Promise<void>;
  lookups: string[]; addressRequests: Array<{ method: string; url: string; body: unknown }>; errors: string[];
}

async function fixture(page: Page): Promise<State> {
  const state: State = { bikes: [bike('99001', 'Bizi sin bicis de prueba'), bike('99002', 'Bizi sin anclajes de prueba', { lat: town.lat + .0005, bicis: 8, anclajes: 0 })], bikeFailure: false, bikeRequests: 0, catalogRequests: 0, lookups: [], addressRequests: [], errors: [] }
  page.on('pageerror', error => state.errors.push(error.message))
  // Intercepta también cualquier API no prevista: ninguna mutación puede salir
  // hacia una cuenta, Telegram o la web de producción desde estos casos.
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request(), u = new URL(request.url()), path = u.pathname
    if (path === '/api/me' || path === '/api/auth/me') return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (path === '/api/servicios/categorias') {
      state.catalogRequests++
      if (state.catalogWait) await state.catalogWait
      return route.fulfill({ json: { ...meta, categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }], total: 1 } })
    }
    if (path === '/api/servicios') return route.fulfill({ json: { ...meta, items: (u.searchParams.get('categorias') || '').split(',').includes('banos') ? [bathroom] : [], siguientePagina: null, warnings: [] } })
    if (path === '/api/servicios/itv') {
      const zona = u.searchParams.get('zona'), items = zona === servicioTileId(itv.lat, itv.lon) ? [itv] : []
      return route.fulfill({ json: { ...itvMeta, zona, total: items.length, items } })
    }
    if (path === '/api/servicios/itv/' + itv.id) {
      state.lookups.push(request.url())
      return route.fulfill({ json: { ...itvMeta, zona: u.searchParams.get('zona'), item: itv } })
    }
    if (path === '/api/bicis/zaragoza') {
      state.bikeRequests++
      if (state.bikeFailure) return route.fulfill({ status: 503, json: { error: 'Fuente no disponible en esta prueba' } })
      return route.fulfill({ json: { schema: 1, red: 'Bizi Zaragoza', redId: 'zaragoza', consultado: iso(), evaluadoEn: iso(), directorioConsultado: iso(), fechaDatos: iso(), estado: 'actual', caduca: iso(300000), total: state.bikes.length, items: state.bikes, warnings: [], fuenteUrl: 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad', licenciaUrl: 'https://www.zaragoza.es/sede/portal/aviso-legal' } })
    }
    if (path === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (path === '/api/localidades') return route.fulfill({ json: [town] })
    if (path === '/api/servicios/buscar-direccion') {
      state.addressRequests.push({ method: request.method(), url: request.url(), body: request.postDataJSON() })
      return route.fulfill({ json: { resultados: [
        { id: 'portal-prueba-1', tipo: 'portal', nombre: 'Calle de prueba 12', municipio: 'Zaragoza', provincia: 'Zaragoza', cp: '50001', ine: '50297', lat: 41.654321, lng: -.876543, precision: 'portal' },
        { id: 'postal-prueba-2', tipo: 'Codpost', nombre: 'Código postal 50018', municipio: 'Zaragoza', provincia: 'Zaragoza', cp: '50018', ine: '50297', lat: 41.671234, lng: -.891234, precision: 'zona' },
      ] } })
    }
    return route.fulfill({ status: 503, json: { error: 'API no usada en esta prueba aislada' } })
  })
  return state
}
const card = (page: Page, id: string) => page.locator('.sv-card[data-servicio="' + id + '"]')
const popup = (page: Page) => page.locator('.leaflet-popup .sv-popup')
async function mapReady(page: Page, categories: string) {
  await page.goto('/cerca?municipio=' + town.ine + '&categorias=' + categories)
  await expect(page.locator('#map .leaflet-map-pane')).toBeAttached()
  await expect(page.locator('#sv-results')).toHaveAttribute('aria-busy', 'false')
}
async function setVisible(page: Page, visible: boolean) {
  await page.evaluate(shown => {
    // Imita una pestaña suspendida sin esperar minutos ni navegar a otra web.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !shown })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => shown ? 'visible' : 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, visible)
}
async function saved(page: Page) {
  return page.evaluate(() => (window as any).EUCuenta.servicios.favoritos())
}

test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Estados artificiales; no demuestra datos ni reservas reales en producción.')
  await page.setViewportSize({ width: 1280, height: 900 })
})

test('ITV conserva la fuente y cita oficial, no inventa horario y abre el favorito desde Inicio', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW))
  const state = await fixture(page)
  await mapReady(page, 'itv')
  const item = card(page, itv.id)
  await expect(item).toContainText('Horario sin confirmar')
  await expect(item).not.toContainText('Abierto según el horario publicado')
  await expect(item.getByRole('link', { name: 'Pedir cita en la web oficial', exact: true })).toHaveAttribute('href', itv.cita.url)
  await expect(item.getByRole('link', { name: 'Tarifas oficiales', exact: true })).toHaveAttribute('href', itv.tarifas.url)
  await expect(item.getByRole('link', { name: 'Fuente: DGT', exact: true })).toHaveAttribute('href', itv.fuenteUrl)
  await expect(item.locator('a[href*="openstreetmap.org"]')).toHaveCount(0)
  await expect(page.locator('#sv-source')).toContainText('1 estaciones con coordenadas publicadas de 2')
  await page.locator('#sv-open').check(); await expect(item).toHaveCount(0)
  await page.locator('#sv-open').uncheck()
  await item.getByRole('button', { name: 'Guardar favorito: ' + itv.nombre, exact: true }).click()
  await expect.poll(() => saved(page)).toEqual([{ id: itv.id, nombre: itv.nombre, categoria: 'itv', lat: itv.lat, lon: itv.lon }])
  await item.screenshot({ path: info.outputPath('itv-ficha-oficial.png') })
  await page.goto('/')
  const link = page.locator('[data-dia-service-favs] a').filter({ hasText: itv.nombre })
  await expect(link).toHaveAttribute('href', '/cerca?lat=41.65&lon=-0.88&servicio=itv-50-5001&categorias=itv')
  await link.click()
  await expect(popup(page)).toContainText(itv.nombre)
  await expect(popup(page)).toContainText('Horario sin confirmar')
  await expect(popup(page).getByRole('link', { name: 'Pedir cita en la web oficial' })).toHaveAttribute('href', itv.cita.url)
  await expect.poll(() => state.lookups.length).toBeGreaterThan(0)
  expect(state.errors).toEqual([])
})

test('cero bicis o cero anclajes no convierte una estación operativa en cerrada y el favorito no guarda stock', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW))
  const state = await fixture(page)
  await mapReady(page, 'bicis-zaragoza')
  const empty = card(page, state.bikes[0].id), full = card(page, state.bikes[1].id)
  await expect(empty).toContainText('0 bicicletas disponibles')
  await expect(full).toContainText('0 anclajes libres para devolver')
  for (const item of [empty, full]) {
    await expect(item).toContainText('Estación operativa según Bizi')
    await expect(item).not.toContainText('Estación fuera de servicio')
    await expect(item).not.toContainText('Horario sin confirmar')
  }
  await page.locator('#sv-open').check(); await expect(page.locator('.sv-card')).toHaveCount(2)
  await empty.getByRole('button', { name: 'Guardar favorito: ' + state.bikes[0].nombre, exact: true }).click()
  await expect.poll(() => saved(page)).toEqual([{ id: state.bikes[0].id, nombre: state.bikes[0].nombre, categoria: 'bicis-zaragoza', lat: town.lat, lon: town.lng }])
  await empty.screenshot({ path: info.outputPath('bizi-cero-disponibles.png') })
  await page.goto('/')
  const favorite = page.locator('[data-dia-service-favs] a').filter({ hasText: state.bikes[0].nombre })
  await expect(favorite).toHaveAttribute('href', '/cerca?lat=41.65&lon=-0.88&servicio=gbfs-zaragoza-99001&categorias=bicis-zaragoza')
  await page.setViewportSize({ width: 320, height: 844 })
  await favorite.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.screenshot({ path: info.outputPath('bizi-favorito-inicio-320.png') })
  await favorite.click()
  await expect(popup(page)).toContainText('0 bicicletas disponibles')
  await expect(popup(page)).toContainText('Estación operativa según Bizi')
  expect(state.errors).toEqual([])
})

test('cada estación caduca a su hora y retira sus cifras de la lista y de la ficha abierta', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page)
  state.bikes = [
    bike('99001', 'Bizi que caduca primero', { bicis: 1, anclajes: 7, actualizado: iso(-270000), caduca: iso(30000) }),
    bike('99002', 'Bizi todavía vigente', { lat: town.lat + .0005, bicis: 3, anclajes: 5, actualizado: iso(-60000), caduca: iso(240000) }),
  ]
  await mapReady(page, 'bicis-zaragoza')
  const first = card(page, state.bikes[0].id), second = card(page, state.bikes[1].id)
  await expect(first).toContainText('1 bicicletas disponibles')
  await first.getByRole('button', { name: 'Ver en el mapa', exact: true }).click()
  await expect(popup(page)).toContainText('1 bicicletas disponibles')
  await page.clock.fastForward(31000)
  await expect(first).toContainText('Disponibilidad sin confirmar')
  await expect(first).not.toContainText('1 bicicletas disponibles')
  await expect(first).not.toContainText('7 anclajes libres')
  await expect(popup(page)).toContainText('No hay cifras recientes comprobables')
  await expect(popup(page)).not.toContainText('1 bicicletas disponibles')
  await expect(second).toContainText('3 bicicletas disponibles')
  await expect(second).toContainText('5 anclajes libres')
  await page.locator('#sv-open').check()
  await expect(first).toHaveCount(0); await expect(second).toHaveCount(1)
  expect(state.errors).toEqual([])
})

test('una actualización fallida oculta el stock anterior también en la ficha abierta', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW))
  const state = await fixture(page)
  await mapReady(page, 'bicis-zaragoza')
  const first = card(page, state.bikes[0].id)
  await expect(first).toContainText('8 anclajes libres')
  await first.getByRole('button', { name: 'Ver en el mapa', exact: true }).click()
  await expect(popup(page)).toContainText('8 anclajes libres')
  state.bikeFailure = true
  const requests = state.bikeRequests
  await setVisible(page, true)
  await expect.poll(() => state.bikeRequests).toBeGreaterThan(requests)
  await expect(first).toContainText('Disponibilidad sin confirmar')
  await expect(first).not.toContainText('8 anclajes libres')
  await expect(popup(page)).toContainText('No hay cifras recientes comprobables')
  await expect(popup(page)).not.toContainText('8 anclajes libres')
  await expect(page.locator('#sv-source')).toContainText('Se han ocultado las cifras anteriores')
  expect(state.errors).toEqual([])
})

test('al volver a una pestaña antigua oculta cifras y horarios caducados mientras el catálogo sigue pendiente', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW))
  const state = await fixture(page)
  await mapReady(page, 'banos,bicis-zaragoza')
  const bathroomCard = card(page, bathroom.id), first = card(page, state.bikes[0].id)
  await expect(bathroomCard).toContainText('Abierto según el horario publicado')
  await expect(first).toContainText('8 anclajes libres')
  await first.getByRole('button', { name: 'Ver en el mapa', exact: true }).click()
  await expect(popup(page)).toContainText('8 anclajes libres')
  await setVisible(page, false)
  // Cambia Date sin ejecutar los temporizadores: reproduce la suspensión de
  // una pestaña, y exige que visibilitychange retire el dato antes de la red.
  await page.clock.setFixedTime(new Date(NOW + 4 * 86400000))
  let release!: () => void
  state.catalogWait = new Promise<void>(resolve => { release = resolve })
  const requests = state.catalogRequests
  try {
    await setVisible(page, true)
    await expect.poll(() => state.catalogRequests).toBeGreaterThan(requests)
    await expect(bathroomCard).toContainText('Horario sin confirmar')
    await expect(bathroomCard).not.toContainText('Abierto según el horario publicado')
    await expect(first).toContainText('Disponibilidad sin confirmar')
    await expect(first).not.toContainText('8 anclajes libres')
    await expect(popup(page)).toContainText('No hay cifras recientes comprobables')
    await expect(popup(page)).not.toContainText('8 anclajes libres')
  } finally { release() }
  expect(state.errors).toEqual([])
})

test('CartoCiudad usa POST y espera que el visitante elija entre dos coincidencias sin guardar la dirección', async ({ page }, info) => {
  // Leaflet necesita que Date avance para terminar la animación del mapa.
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page), query = 'Calle de prueba 12, Zaragoza'
  const requestedUrls: string[] = []
  page.on('request', request => requestedUrls.push(request.url()))
  await mapReady(page, 'banos')
  await expect(card(page, bathroom.id)).toHaveCount(1)
  const before = await page.evaluate(() => ({ ...((window as any).map.getCenter()) }))
  await page.getByText('Buscar dirección o código postal', { exact: true }).click()
  await page.locator('#sv-address').fill(query)
  await page.locator('#sv-address-submit').click()
  const candidates = page.locator('#sv-address-results button')
  await expect(candidates).toHaveCount(2)
  await expect(page.locator('#sv-address-status')).toHaveText('Comprueba el municipio y elige una coincidencia.')
  expect(await page.evaluate(() => ({ ...((window as any).map.getCenter()) }))).toEqual(before)
  expect(state.addressRequests).toEqual([{ method: 'POST', url: new URL('/api/servicios/buscar-direccion', page.url()).href, body: { q: query } }])
  await page.evaluate(() => {
    const w = window as any, original = w.map.setView
    w.__testMapViews = []
    w.map.setView = function (...args: any[]) {
      const p = args[0]
      w.__testMapViews.push(Array.isArray(p) ? p : [p.lat, p.lng])
      return original.apply(this, args)
    }
  })
  await candidates.filter({ hasText: 'Código postal 50018' }).click()
  await expect(page.locator('#sv-address-status')).toContainText('Ubicación elegida: Código postal 50018')
  await expect(candidates).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__testMapViews)).toContainEqual([41.671234, -.891234])
  // El ajuste de tamaño del mapa puede mover unos píxeles su centro visual.
  // La selección enviada debe ser exacta y permanecer cerca del centro visible.
  await expect.poll(() => page.evaluate(() => {
    const map = (window as any).map
    return map.distance(map.getCenter(), [41.671234, -.891234])
  })).toBeLessThan(100)
  expect(await page.evaluate(() => (window as any).map.getBounds().contains([41.671234, -.891234]))).toBe(true)
  const u = new URL(page.url())
  expect([...u.searchParams.keys()].sort()).toEqual(['categorias'])
  expect(u.hash).toBe('')
  expect(requestedUrls.some(value => decodeURIComponent(value).includes(query) || value.includes('41.671234') || value.includes('-0.891234'))).toBe(false)
  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))
  expect(storage).not.toContain(query)
  expect(storage).not.toContain('41.671234'); expect(storage).not.toContain('-0.891234')
  expect(await page.evaluate(() => (window as any).EUCuenta.servicios.historial())).toEqual([])
  await page.locator('#sv-near').hover()
  const contrast = await new AxeBuilder({ page }).include('#sv-near').withRules(['color-contrast']).analyze()
  expect(contrast.violations).toEqual([])
  await page.screenshot({ path: info.outputPath('cartociudad-eleccion-explicita.png') })
  expect(state.errors).toEqual([])
})
