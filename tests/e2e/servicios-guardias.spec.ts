import { test, expect, type Page, type Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { servicioTileId } from '../../scripts/lib/servicios.mjs'

// Respuestas artificiales locales: comprueban la interfaz y la caducidad, no
// certifican una guardia real ni contactan cuentas, Telegram o establecimientos.
const NOW = Date.parse('2026-11-21T10:00:00Z'), iso = (delta = 0) => new Date(NOW + delta).toISOString()
const town = { ine: '28079', nombre: 'Madrid', provinciaNombre: 'Madrid', lat: 40.42, lng: -3.7, servicios: [] }
const zone = servicioTileId(town.lat, town.lng)
const meta = { consultado: iso(), fechaDatos: iso(), desactualizado: false, atribucion: '© OpenStreetMap', licencia: 'ODbL-1.0' }
const bathroom = { id: 'osm-node-99009', nombre: 'Baño independiente de prueba', lat: town.lat, lon: town.lng + .001, categorias: ['banos'], horario: '24/7', gratis: true, accesible: 'si', acceso: 'publico', ubicacion: 'punto', fechaEdicion: iso(), fuenteUrl: 'https://www.openstreetmap.org/node/99009' }
function guardia(id: number, estado = 'activa', extra: Record<string, unknown> = {}) {
  return { id: 'guardia-madrid-' + String(id).padStart(32, '0'), proveedor: 'guardias-oficiales', categorias: ['farmacias-guardia'], guardable: false,
    nombre: 'Farmacia de prueba ' + id, direccion: 'Farmacia de prueba ' + id, municipio: 'Madrid', lat: town.lat + id * .0003, lon: town.lng,
    telefono: '912 345 678 - 612 345 678', horario: '21 nov 09:00–22 nov 09:00 · Horario literal de prueba', fechaTurno: '2026-11-21', consultado: iso(),
    fuenteUrl: 'https://www.cofm.es/es/buscador-de-farmacias/', directorioUrl: '/farmacias/madrid/madrid', estado, todoElDia: estado === 'activa', estadoHasta: iso(30000), ...extra }
}
type Guardia = ReturnType<typeof guardia>
type State = { items: Guardia[]; sources: Array<Record<string, unknown>>; evaluated: string; expiry: string; failed: boolean; hold?: Promise<void>; catalogHold?: Promise<void>; requests: string[]; errors: string[] }
async function fixture(page: Page): Promise<State> {
  const state: State = { items: [guardia(1), guardia(2, 'localizada'), guardia(3, 'por_confirmar'), guardia(4, 'fuera_de_horario')], evaluated: iso(), expiry: iso(30000), failed: false, requests: [], errors: [], sources: [{
    provincia: 'madrid', nombre: 'Madrid', territorio: 'madrid', consultado: iso(), fechaReferencia: '2026-11-21', fuenteUrl: 'https://www.cofm.es/es/buscador-de-farmacias/',
    directorioUrl: '/farmacias/madrid', cobertura: 'Calendario de prueba', puntosEnZona: 4, estado: 'disponible', warnings: [], avisosMunicipales: {},
  }] }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/api/**', async (route: Route) => {
    const u = new URL(route.request().url()), path = u.pathname
    if (path === '/api/me' || path === '/api/auth/me') return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (path === '/api/servicios/categorias') {
      if (state.catalogHold) await state.catalogHold
      return route.fulfill({ json: { ...meta, categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }, { id: 'farmacias', nombre: 'Farmacias', grupo: 'salud', grupoNombre: 'Salud', total: 1 }], total: 2 } })
    }
    if (path === '/api/servicios/guardias') {
      state.requests.push(route.request().url())
      if (state.hold) await state.hold
      let items = u.searchParams.get('zona') === zone ? state.items : []
      if (u.searchParams.get('turno') !== 'todas') items = items.filter(i => i.estado === 'activa' && (u.searchParams.get('turno') !== '24h' || i.todoElDia))
      return route.fulfill({ status: state.failed ? 503 : 200, json: { proveedor: 'guardias-oficiales', zona: u.searchParams.get('zona'), turno: u.searchParams.get('turno'),
        items: state.failed ? [] : items, total: state.failed ? 0 : items.length, truncated: false, siguientePagina: null, completo: !state.failed,
        evaluadoEn: state.evaluated, revalidarAntes: state.expiry, fuentes: state.sources, warnings: [] } })
    }
    if (path === '/api/servicios/itv') return route.fulfill({ json: { items: [], totalConCoordenadas: 0, totalDirectorio: 0, generadoEn: iso() } })
    if (path === '/api/servicios') return route.fulfill({ json: { ...meta, items: (u.searchParams.get('categorias') || '').split(',').includes('banos') ? [bathroom] : [], siguientePagina: null, warnings: [] } })
    if (path === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (path === '/api/localidades') return route.fulfill({ json: [town] })
    return route.fulfill({ status: 503, json: { error: 'API no usada en esta prueba aislada' } })
  })
  return state
}
const card = (page: Page, item: Guardia) => page.locator('.sv-card[data-servicio="' + item.id + '"]')
const popup = (page: Page) => page.locator('.leaflet-popup .sv-popup')
async function ready(page: Page, categories = 'farmacias-guardia') {
  await page.goto('/cerca?municipio=' + town.ine + '&categorias=' + categories)
  await expect(page.locator('#map .leaflet-map-pane')).toBeAttached()
  await expect(page.locator('#sv-results')).toHaveAttribute('aria-busy', 'false')
}
async function visible(page: Page, shown: boolean) {
  await page.evaluate(shown => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => !shown })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => shown ? 'visible' : 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  }, shown)
}
test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Datos artificiales, no confirma las guardias reales publicadas.')
  await page.setViewportSize({ width: 1280, height: 900 })
})

test('separa las guardias de OSM, muestra estados y teléfonos independientes, nunca guarda el turno', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW))
  const state = await fixture(page); await ready(page)
  await expect(card(page, state.items[0])).toContainText('De guardia ahora según el horario oficial')
  await expect(card(page, state.items[1])).toContainText('Guardia localizada · llama antes de acudir')
  await expect(card(page, state.items[2])).toContainText('Horario de guardia por confirmar')
  await expect(card(page, state.items[3])).toContainText('Fuera del horario de guardia publicado')
  const first = card(page, state.items[0])
  await expect(first.getByRole('button', { name: /Guardar favorito/ })).toHaveCount(0)
  await expect(first.locator('a[href*="openstreetmap.org"]')).toHaveCount(0)
  await expect(first.getByRole('link', { name: 'Fuente oficial de la guardia' })).toHaveAttribute('href', state.items[0].fuenteUrl)
  await expect(first.locator('a[href="tel:912345678"]')).toHaveCount(1)
  await expect(first.locator('a[href="tel:612345678"]')).toHaveCount(1)
  for (const name of ['Google Maps', 'Apple Maps', 'Waze']) await expect(first.getByRole('link', { name, exact: true })).toBeVisible()
  await expect(page.locator('#sv-source')).not.toContainText('OpenStreetMap')
  await page.locator('#sv-open').check(); await expect(page.locator('.sv-card')).toHaveCount(1)
  await page.locator('#sv-open').uncheck()
  await page.locator('#sv-guardias-turno').selectOption('ahora'); await expect(page.locator('.sv-card')).toHaveCount(1)
  await page.locator('#sv-guardias-turno').selectOption('24h'); await expect(page.locator('.sv-card')).toHaveCount(1)
  await page.locator('#sv-guardias-turno').selectOption('todas'); await expect(page.locator('.sv-card')).toHaveCount(4)
  for (const request of state.requests) {
    const query = new URL(request).searchParams
    expect([...query.keys()].sort()).toEqual(['pagina', 'turno', 'zona']); expect(query.get('zona')).toMatch(/^\d{3}-\d{3}$/)
  }
  await first.screenshot({ path: info.outputPath('guardia-oficial-ficha.png') }); expect(state.errors).toEqual([])
})

test('al caducar retira activa de tarjeta y popup antes de que responda la siguiente petición', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page); state.items = [guardia(1)]
  await ready(page); await card(page, state.items[0]).getByRole('button', { name: 'Ver en el mapa' }).click()
  await expect(popup(page)).toContainText('De guardia ahora según el horario oficial')
  let release!: () => void; state.hold = new Promise(resolve => { release = resolve })
  const previous = state.requests.length
  // Congela tras cargar el mapa: su tiempo de navegación no forma parte de los
  // 30 segundos que quedan al turno en la respuesta artificial.
  const pausedAt = await page.evaluate(() => Date.now()) + 1000
  await page.clock.pauseAt(new Date(pausedAt))
  await page.clock.fastForward(NOW + 30000 - pausedAt - 1)
  await expect(card(page, state.items[0])).toContainText('De guardia ahora según el horario oficial')
  await page.clock.fastForward(1)
  await expect(card(page, state.items[0])).toContainText('Estado pendiente de comprobar')
  await expect(popup(page)).toContainText('Estado pendiente de comprobar')
  await expect(popup(page)).not.toContainText('De guardia ahora según el horario oficial')
  await expect.poll(() => state.requests.length).toBeGreaterThan(previous)
  state.items[0].estado = 'fuera_de_horario'; state.items[0].estadoHasta = iso(60000); state.evaluated = iso(30000); state.expiry = iso(60000); release()
  await expect(card(page, state.items[0])).toContainText('Fuera del horario de guardia publicado')
  expect(state.errors).toEqual([])
})

test('el filtro ahora retira el punto caducado aunque la comprobación siguiente falle', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page); state.items = [guardia(1)]
  await ready(page); await page.locator('#sv-guardias-turno').selectOption('ahora')
  await expect(card(page, state.items[0])).toBeVisible()
  state.failed = true; state.sources[0].estado = 'error'; state.sources[0].warnings = ['Fuente de prueba no disponible.']
  await page.clock.fastForward(30000)
  await expect(card(page, state.items[0])).toHaveCount(0)
  await expect(page.locator('#map [title="' + state.items[0].nombre + '"]')).toHaveCount(0)
  await expect(page.locator('#sv-guardias-sources')).toContainText('Estado pendiente de comprobar')
  await expect(page.locator('#sv-guardias-sources')).toContainText('Fuente de prueba no disponible.')
  expect(state.errors).toEqual([])
})

test('al volver de una pestaña oculta retira el estado antes de esperar al catálogo y refresca guardias', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page); state.items = [guardia(1)]
  await ready(page); await visible(page, false)
  await page.clock.fastForward(301000)
  let release!: () => void; state.hold = new Promise(resolve => { release = resolve }); state.catalogHold = state.hold
  const previous = state.requests.length
  await visible(page, true)
  await expect(card(page, state.items[0])).toContainText('Estado pendiente de comprobar')
  await expect.poll(() => state.requests.length).toBeGreaterThan(previous)
  release(); expect(state.errors).toEqual([])
})

test('reloj visitante atrasado y red lenta no alargan el plazo de la guardia', async ({ page }) => {
  const clientNow = NOW - 120000
  await page.clock.install({ time: new Date(clientNow) })
  const state = await fixture(page); state.items = [guardia(1, 'activa', { estadoHasta: iso(12000) })]; state.expiry = iso(12000)
  let release!: () => void; state.hold = new Promise(resolve => { release = resolve })
  await page.goto('/cerca?municipio=' + town.ine + '&categorias=farmacias-guardia')
  await expect.poll(() => state.requests.length).toBeGreaterThan(0)
  await page.clock.fastForward(10000); release(); state.hold = undefined
  await expect(card(page, state.items[0])).toContainText('De guardia ahora según el horario oficial')
  state.failed = true
  await page.clock.fastForward(2000)
  await expect(page.locator('#sv-results')).not.toContainText('De guardia ahora según el horario oficial')
  await expect(page.locator('#sv-guardias-sources')).toContainText('Estado pendiente de comprobar')
  expect(state.errors).toEqual([])
})

test('Almería sin puntos conserva fechas antiguas, horario por confirmar y acceso al listado', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW))
  const state = await fixture(page); state.items = []
  state.sources = [{ provincia: 'almeria', nombre: 'Almería', territorio: 'almeria', estado: 'sin_actualizar', consultado: '2026-11-12T08:00:00Z', fechaReferencia: '2026-11-12', fuenteUrl: 'https://www.cofalmeria.com/buscador-de-farmacias/?activo_guardias=on', directorioUrl: '/farmacias/almeria', warnings: ['Algunas guardias tienen horario por confirmar: llama antes de acudir. No se consideran abiertas ni de 24 horas.'], avisosMunicipales: { Almería: ['Consultar el colegio.'] } }]
  await ready(page)
  await expect(page.locator('.sv-card')).toHaveCount(0)
  await expect(page.locator('#sv-guardias-sources')).toContainText('12 nov 2026')
  await expect(page.locator('#sv-guardias-sources')).toContainText('horario por confirmar')
  await expect(page.locator('#sv-guardias-sources')).toContainText('Hay avisos para municipios')
  await expect(page.getByRole('link', { name: 'Ver guardias y avisos de Almería' })).toHaveAttribute('href', '/farmacias/almeria')
  await page.setViewportSize({ width: 320, height: 844 })
  await page.locator('#btn-sheet-toggle').click()
  const warning = page.locator('#sv-guardias-sources .sv-warning').filter({ hasText: 'Algunas guardias' })
  await warning.scrollIntoViewIfNeeded(); await expect(warning).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  const audit = await new AxeBuilder({ page }).include('.sv-panel').analyze()
  expect(audit.violations).toEqual([])
  await page.screenshot({ path: info.outputPath('guardias-almeria-320.png') }); expect(state.errors).toEqual([])
})

test('los errores de guardias no sustituyen la fuente OSM ni quitan otros servicios del mapa', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page); state.items = [guardia(1)]
  await ready(page, 'farmacias-guardia,banos')
  const bath = page.locator('.sv-card[data-servicio="' + bathroom.id + '"]')
  await expect(bath).toContainText('Abierto según el horario publicado')
  state.failed = true; await page.clock.fastForward(30000)
  await expect(bath).toContainText('Abierto según el horario publicado')
  await expect(bath.getByRole('link', { name: 'Ver fuente o comunicar un error' })).toHaveAttribute('href', bathroom.fuenteUrl)
  await expect(page.locator('#sv-source')).toContainText('OpenStreetMap')
  await page.locator('#sv-view-fuel').click(); await expect(page.locator('#fuel-content')).toBeVisible()
  await page.locator('#sv-view-services').click(); await expect(bath).toBeVisible()
  expect(state.errors).toEqual([])
})

test('una respuesta antigua no repone guardias después de cambiar de categoría', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) })
  const state = await fixture(page); state.items = [guardia(1)]
  await ready(page, 'farmacias-guardia,banos')
  let release!: () => void; state.hold = new Promise(resolve => { release = resolve })
  await page.clock.fastForward(30000)
  await page.locator('#sv-category-box').evaluate((node: HTMLDetailsElement) => { node.open = true })
  const checkbox = page.locator('#sv-categories input[value="farmacias-guardia"]')
  await checkbox.evaluate((node: HTMLInputElement) => { (node.closest('details') as HTMLDetailsElement).open = true })
  await checkbox.uncheck(); release()
  await expect(card(page, state.items[0])).toHaveCount(0)
  await expect(page.locator('#sv-guardias-sources')).toBeHidden()
  await expect(page.locator('.sv-card[data-servicio="' + bathroom.id + '"]')).toBeVisible()
  expect(state.errors).toEqual([])
})
