import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { APARCAMIENTOS_MAPA } from '../../scripts/lib/aparcamientos-ui.mjs'

// Fixtures explícitas: no certifican ocupación real ni envían mensajes/altas.
const NOW = Date.parse('2026-11-21T10:00:00Z')
const iso = (offset = 0) => new Date(NOW + offset).toISOString()
const towns = {
  madrid: { ine: '28079', nombre: 'Madrid', provinciaNombre: 'Madrid', lat: 40.4168, lng: -3.7038, servicios: [] },
  vigo: { ine: '36057', nombre: 'Vigo', provinciaNombre: 'Pontevedra', lat: 42.2406, lng: -8.7207, servicios: [] },
}
function row(city: 'madrid' | 'vigo', id: number, extra: Record<string, unknown> = {}) {
  const source = APARCAMIENTOS_MAPA.find(f => f.ciudad === city)!, town = towns[city]
  return { id: 'parking-' + city + '-' + id, nombre: 'Aparcamiento de prueba ' + id, lat: town.lat, lon: town.lng,
    direccion: 'Dirección ficticia de la prueba', capacidad: 100, plazasPmr: city === 'madrid' ? 4 : null,
    horarioTexto: city === 'madrid' ? '[24 Horas][Lunes,Domingo][00:00][23:59]' : null,
    fechaFicha: null, detalleConsultado: city === 'madrid' ? iso() : null, gratis: null, disuasorio: null, fuenteUrl: source.fuenteUrl,
    plazasLibres: 0, fechaOcupacion: iso(), caduca: iso(source.maxAge), estado: 'actual', ...extra }
}
type State = { items: ReturnType<typeof row>[]; failed: boolean; requests: number; errors: string[]; gate?: Promise<void>; city: 'madrid' | 'vigo' }
async function fixture(page: Page, city: 'madrid' | 'vigo' = 'madrid'): Promise<State> {
  const state: State = { city, items: [row(city, city === 'madrid' ? 72 : 4763)], failed: false, requests: 0, errors: [] }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url()), path = u.pathname, source = APARCAMIENTOS_MAPA.find(f => f.ciudad === state.city)!
    if (path === '/api/me') return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (path === '/api/servicios/categorias') return route.fulfill({ json: { consultado: iso(), fechaDatos: iso(), desactualizado: false, total: 1, categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }, { id: 'agua-potable', nombre: 'Agua potable', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }] } })
    if (path === '/api/servicios/itv') return route.fulfill({ json: { totalConCoordenadas: 0, items: [] } })
    if (path === '/api/servicios') return route.fulfill({ json: { consultado: iso(), fechaDatos: iso(), desactualizado: false, items: [{ id: 'osm-node-99001', nombre: 'Baño con fuente de prueba', lat: towns.madrid.lat + .001, lon: towns.madrid.lng, categorias: ['agua-potable', 'banos'], horario: '24/7', gratis: true, accesible: 'si', acceso: 'publico', ubicacion: 'punto', fechaEdicion: iso(), fuenteUrl: 'https://www.openstreetmap.org/node/99001' }], siguientePagina: null } })
    if (path === '/api/aparcamientos/' + city) {
      state.requests++
      if (state.gate) await state.gate
      if (state.failed) return route.fulfill({ status: 503, json: { error: 'Fallo simulado de la fuente' } })
      return route.fulfill({ json: { fuenteId: city, nombre: source.nombre, consultado: iso(), evaluadoEn: iso(), catalogoConsultado: iso(), fechaDatos: null,
        fuenteUrl: source.fuenteUrl, licenciaUrl: source.licenciaUrl, atribucion: source.atribucion, estado: 'parcial', total: state.items.length,
        conDisponibilidad: state.items.filter(p => p.estado === 'actual').length, items: state.items, warnings: [] } })
    }
    if (path === '/api/localidad/' + towns[city].ine) return route.fulfill({ json: towns[city] })
    if (path === '/api/localidades') return route.fulfill({ json: [towns[city]] })
    return route.fulfill({ status: 503, json: { error: 'API no utilizada en esta prueba' } })
  })
  return state
}
const card = (page: Page, id: string) => page.locator('.sv-card[data-servicio="' + id + '"]')
const popup = (page: Page) => page.locator('.leaflet-popup .sv-popup')
async function ready(page: Page, city: 'madrid' | 'vigo' = 'madrid') {
  await page.goto('/cerca?categorias=aparcamientos-' + city)
  await expect(page.locator('#map .leaflet-map-pane')).toBeAttached()
  if ((page.viewportSize()?.width ?? 1280) < 1024) await page.getByRole('button', { name: 'Ver lista y filtros', exact: true }).click()
  await expect(page.locator('#sv-results .sv-card').first()).toBeVisible()
  await expect(page.locator('#sv-results')).toHaveAttribute('aria-busy', 'false')
}
async function visible(page: Page, value: boolean) {
  await page.evaluate(shown => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => !shown }); document.dispatchEvent(new Event('visibilitychange')) }, value)
}
test.beforeEach(async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Sólo fixtures aisladas; no es ocupación real.')
  await page.setViewportSize({ width: 1280, height: 900 })
})
for (const width of [390, 1280]) test('cero, PMR y enlaces oficiales son claros a ' + width + 'px', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW)); await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page); await ready(page)
  const item = card(page, state.items[0].id)
  await expect(item).toContainText('0 plazas libres')
  await expect(item).toContainText('No significa que esté cerrado')
  await expect(item).toContainText('4 en total. No se conoce cuántas están libres')
  await expect(item).toContainText('Horario publicado: 24 Horas · Lunes, Domingo · 00:00 · 23:59')
  await expect(item).not.toContainText('[24 Horas]')
  await expect(item).toContainText('Apertura, gratuidad, accesibilidad y reservas sin confirmar')
  await expect(item.getByRole('link', { name: 'Google Maps', exact: true })).toHaveAttribute('href', /destination=40\.4168%2C-3\.7038/)
  await expect(item.getByRole('link', { name: 'Apple Maps', exact: true })).toHaveAttribute('href', /maps\.apple\.com/)
  await expect(item.getByRole('link', { name: 'Waze', exact: true })).toHaveAttribute('href', /waze\.com/)
  await expect(item.getByRole('link', { name: 'Fuente oficial del aparcamiento' })).toHaveAttribute('href', APARCAMIENTOS_MAPA[0].fuenteUrl)
  for (const id of ['sv-open', 'sv-free', 'sv-accessible']) { await page.locator('#' + id).check(); await expect(item).toHaveCount(0); await page.locator('#' + id).uncheck(); await expect(item).toHaveCount(1) }
  expect((await new AxeBuilder({ page }).include('.sv-panel').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await item.screenshot({ path: info.outputPath('aparcamiento-' + width + '.png') }); expect(state.errors).toEqual([])
})
test('Vigo guarda sólo el lugar y al volver desde Inicio hidrata la cifra actual', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW)); const state = await fixture(page, 'vigo'); await ready(page, 'vigo')
  const item = state.items[0]
  await card(page, item.id).getByRole('button', { name: 'Guardar favorito: ' + item.nombre, exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).EUCuenta.servicios.favoritos())).toEqual([{ id: item.id, nombre: item.nombre, categoria: 'aparcamientos-vigo', lat: item.lat, lon: item.lon }])
  state.items[0] = { ...item, plazasLibres: 7 }
  await page.goto('/'); const favorite = page.locator('[data-dia-service-favs] a').filter({ hasText: item.nombre }); await expect(favorite).toHaveAttribute('href', /servicio=parking-vigo-4763&categorias=aparcamientos-vigo/)
  await favorite.click(); await expect(popup(page)).toContainText('7 plazas libres'); await expect(popup(page)).not.toContainText('0 plazas libres'); expect(state.errors).toEqual([])
})

for (const width of [390, 1280]) test('filtros de plazas y PMR mantienen su significado a ' + width + 'px', async ({ page }, info) => {
  await page.clock.setFixedTime(new Date(NOW)); await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page)
  state.items = [row('madrid', 72, { plazasLibres: 5 }), row('madrid', 73, { plazasLibres: 0 }), row('madrid', 74, { plazasLibres: 8, plazasPmr: null })]
  await ready(page)
  const controls = page.locator('#sv-parking-controls')
  await expect(controls).toBeVisible(); await expect(controls).toContainText('no que estén libres')
  await page.getByLabel('Con plazas libres confirmadas', { exact: true }).check()
  await expect(page.locator('.sv-card')).toHaveCount(2); await expect(card(page, 'parking-madrid-73')).toHaveCount(0)
  await page.getByLabel('Con plazas reservadas PMR', { exact: true }).check()
  await expect(page.locator('.sv-card')).toHaveCount(1); await expect(card(page, 'parking-madrid-72')).toContainText('5 plazas libres')
  await page.getByLabel('Con plazas libres confirmadas', { exact: true }).uncheck()
  await expect(page.locator('.sv-card')).toHaveCount(2); await expect(card(page, 'parking-madrid-73')).toContainText('0 plazas libres')
  await controls.scrollIntoViewIfNeeded()
  expect((await new AxeBuilder({ page }).include('#sv-parking-controls').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await page.screenshot({ path: info.outputPath('filtros-parking-' + width + '.png') })
  expect(state.errors).toEqual([])
})

test('el filtro de plazas elimina partes vencidos y no filtra otras categorías ni favoritos', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) }); const state = await fixture(page)
  state.items = [row('madrid', 72, { plazasLibres: 5, fechaOcupacion: iso(-270000), caduca: iso(30000) })]
  await ready(page)
  await card(page, 'parking-madrid-72').getByRole('button', { name: 'Guardar favorito: Aparcamiento de prueba 72', exact: true }).click()
  await page.getByLabel('Con plazas libres confirmadas', { exact: true }).check()
  await page.locator('#sv-category-box > summary').click()
  await page.locator('#sv-categories details').filter({ has: page.locator('input[value="banos"]') }).locator('summary').click()
  await page.locator('#sv-categories input[value="banos"]').check()
  await expect(card(page, 'osm-node-99001')).toBeVisible()
  await page.clock.fastForward(31000)
  await expect(card(page, 'parking-madrid-72')).toHaveCount(0)
  await expect(card(page, 'osm-node-99001')).toBeVisible()
  await page.getByLabel('Con plazas libres confirmadas', { exact: true }).uncheck()
  await expect(card(page, 'parking-madrid-72')).toContainText('Plazas libres sin confirmar')
  await page.locator('#sv-favorites').click()
  await expect(page.locator('#sv-parking-controls')).toBeHidden()
  await expect(card(page, 'parking-madrid-72')).toContainText('Lugar guardado')
  expect(state.errors).toEqual([])
})
test('cada lugar caduca por separado en lista y popup', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) }); const state = await fixture(page)
  state.items = [row('madrid', 72, { plazasLibres: 3, fechaOcupacion: iso(-270000), caduca: iso(30000) }), row('madrid', 73, { lat: towns.madrid.lat + .001, plazasLibres: 9 })]
  await ready(page); const first = card(page, state.items[0].id)
  await first.getByRole('button', { name: 'Ver en el mapa', exact: true }).click(); await expect(popup(page)).toContainText('3 plazas libres')
  await page.clock.fastForward(31000)
  await expect(first).toContainText('Plazas libres sin confirmar'); await expect(first).not.toContainText('3 plazas libres'); await expect(popup(page)).toContainText('Plazas libres sin confirmar')
  await expect(card(page, state.items[1].id)).toContainText('9 plazas libres'); expect(state.errors).toEqual([])
})
test('red fallida retira cifras anteriores conservando la ficha', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW)); const state = await fixture(page); state.items[0].plazasLibres = 6
  await ready(page); const item = card(page, state.items[0].id); await item.getByRole('button', { name: 'Ver en el mapa', exact: true }).click()
  state.failed = true; const previous = state.requests; await visible(page, false); await visible(page, true)
  await expect.poll(() => state.requests).toBeGreaterThan(previous)
  await expect(item).toContainText('Plazas libres sin confirmar'); await expect(popup(page)).not.toContainText('6 plazas libres'); await expect(item).toContainText('Capacidad total: 100')
  expect(state.errors).toEqual([])
})
test('volver a pestaña vieja retira las cifras antes de esperar a la red', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) }); const state = await fixture(page); state.items[0] = row('madrid', 72, { plazasLibres: 5, fechaOcupacion: iso(-270000), caduca: iso(30000) })
  await ready(page); await visible(page, false); await page.clock.fastForward(31000)
  let release!: () => void; state.gate = new Promise(resolve => { release = resolve })
  await visible(page, true); await expect(card(page, state.items[0].id)).toContainText('Plazas libres sin confirmar'); await expect(card(page, state.items[0].id)).not.toContainText('5 plazas libres')
  state.failed = true; release(); expect(state.errors).toEqual([])
})
test('reloj del dispositivo atrasado no mantiene una cifra vencida', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW - 3600000) }); const state = await fixture(page); state.items[0] = row('madrid', 72, { plazasLibres: 5, fechaOcupacion: iso(-270000), caduca: iso(30000) })
  await ready(page); await expect(card(page, state.items[0].id)).toContainText('5 plazas libres'); await page.clock.fastForward(31000)
  await expect(card(page, state.items[0].id)).toContainText('Plazas libres sin confirmar'); expect(state.errors).toEqual([])
})
test('ficha sin coordenadas no obtiene pin, ruta ni favorito con posición inventada', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW)); const state = await fixture(page); state.items.push(row('madrid', 73, { lat: null, lon: null }))
  await ready(page); const item = card(page, state.items[1].id)
  await expect(item).toContainText('Ubicación sin comprobar'); await expect(item.getByRole('link', { name: 'Google Maps' })).toHaveCount(0); await expect(item.getByRole('button')).toHaveCount(0)
  await expect(page.locator('.leaflet-marker-icon[title="' + state.items[1].nombre + '"]')).toHaveCount(0); expect(state.errors).toEqual([])
})
test('un favorito desaparecido no muestra la disponibilidad guardada como actual', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW)); const state = await fixture(page); await ready(page)
  const item = state.items[0]; await card(page, item.id).getByRole('button', { name: 'Guardar favorito: ' + item.nombre }).click()
  state.items = [row('madrid', 74, { lat: towns.madrid.lat + .001 })]
  await page.goto('/cerca?lat=' + item.lat + '&lon=' + item.lon + '&servicio=' + item.id + '&categorias=aparcamientos-madrid')
  await expect(page.locator('#sv-status')).toContainText('ya no aparece'); await expect(card(page, item.id)).toHaveCount(0); await expect(popup(page)).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).EUCuenta.servicios.favoritos().length)).toBe(1); expect(state.errors).toEqual([])
})
test('respuesta tardía de aparcamientos no reaparece tras cambiar de capa y el glifo sigue la categoría elegida', async ({ page }) => {
  await page.clock.setFixedTime(new Date(NOW)); const state = await fixture(page)
  let release!: () => void; state.gate = new Promise(resolve => { release = resolve })
  await page.goto('/cerca?categorias=aparcamientos-madrid'); await expect.poll(() => state.requests).toBeGreaterThan(0)
  await page.locator('#sv-category-box').evaluate(node => { (node as HTMLDetailsElement).open = true; node.querySelectorAll('details').forEach(child => { child.open = true }) })
  await page.locator('input[value="banos"]').check(); await page.locator('input[value="aparcamientos-madrid"]').uncheck(); release()
  await expect(card(page, 'osm-node-99001')).toBeVisible(); await expect(card(page, state.items[0].id)).toHaveCount(0)
  await expect(page.locator('.leaflet-marker-icon[title="Baño con fuente de prueba"]')).toHaveText('WC'); expect(state.errors).toEqual([])
})
test('un tiempo de espera inicial se explica como fuente no comprobada, no como cero aparcamientos', async ({ page }) => {
  await page.clock.install({ time: new Date(NOW) }); const state = await fixture(page)
  let release!: () => void; state.gate = new Promise(resolve => { release = resolve })
  await page.goto('/cerca?categorias=aparcamientos-madrid'); await expect.poll(() => state.requests).toBeGreaterThan(0)
  await page.clock.fastForward(11000)
  await expect(page.locator('#sv-status')).toContainText('Los resultados están incompletos')
  await expect(page.locator('#sv-source')).toContainText('No se ha podido comprobar la ocupación')
  await expect(page.locator('#sv-more')).toBeVisible(); state.failed = true; release(); expect(state.errors).toEqual([])
})
