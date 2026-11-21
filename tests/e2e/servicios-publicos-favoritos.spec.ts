import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { servicioTileId } from '../../scripts/lib/servicios.mjs'

const storageName = 'eu-servicios-favoritos-v1'
async function fixture(page: Page, refuge = false) {
  const category = refuge ? 'refugios-cataluna' : 'salas-estudio-madrid'
  const point = { id: refuge ? 'refugio-cat-' + 'a'.repeat(64) : 'estudio-madrid-123', nombre: refuge ? 'Refugio de prueba' : 'Sala de prueba', categoria: refuge ? 'refugios-climaticos' : 'salas-estudio',
    lat: refuge ? 41.4 : 40.4, lon: refuge ? 2.1 : -3.7, municipio: refuge ? 'Barcelona' : 'Madrid', direccion: 'Dirección pública de prueba', cp: null, web: null, horarioTexto: 'De 9 a 20 h. Excepción: cerrado los festivos.', fechaFicha: null,
    accesibilidad: 'desconocido', accesibilidadTexto: null, tipo: null, aguaPotable: null, lavabos: null, climatizacion: null, descanso: null }
  const saved = { id: point.id, nombre: point.nombre, categoria: category, lat: point.lat, lon: point.lon }
  const state = { item: point as { [key: string]: any }, status: 200, ready: true, stale: false, gate: null as Promise<void> | null, lookups: [] as URL[], writes: [] as string[] }
  const metadata = () => ({ schema: 1, proveedor: 'servicios-publicos', fuenteId: category, nombre: 'Catálogo oficial de prueba', consultado: new Date().toISOString(), fechaDatos: '2026-10-16T12:45:30.000Z',
    favoritosDisponibles: state.ready, desactualizado: state.stale, estado: state.stale ? 'conservada' : 'actual', totalDirectorio: 1, conCoordenadas: 1, sinCoordenadas: 0, avisos: [] })
  await page.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url()), p = u.pathname
    if (req.method() !== 'GET') { state.writes.push(req.method() + ' ' + p); return route.fulfill({ status: 405, json: {} }) }
    if (p === '/api/me' || p === '/api/auth/me') return route.fulfill({ json: { user: null } })
    if (p === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (p === '/api/servicios/categorias') return route.fulfill({ json: { categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }], total: 1 } })
    if (p === '/api/servicios') return route.fulfill({ json: { items: [], siguientePagina: null } })
    if (p.startsWith('/api/localidad/')) return route.fulfill({ json: { ine: refuge ? '08019' : '28079', nombre: point.municipio, provinciaNombre: point.municipio, lat: point.lat, lng: point.lon, servicios: [] } })
    if (p === '/api/servicios/publicos/' + category + '/lugar/' + point.id) {
      state.lookups.push(u); const item = structuredClone(state.item), status = state.status
      if (state.gate) await state.gate
      return route.fulfill({ status, json: status === 200 ? { ...metadata(), item } : { error: status === 404 ? 'Ficha ausente de prueba' : 'Fuente sin comprobar de prueba' } }).catch(() => {})
    }
    if (p === '/api/servicios/publicos/' + category) {
      const item = state.item, active = item.lat !== null && u.searchParams.get('zona') === servicioTileId(item.lat, item.lon)
      return route.fulfill({ json: { ...metadata(), items: active ? [item] : [], total: active ? 1 : 0, siguientePagina: null } })
    }
    return route.fulfill({ status: 503, json: {} })
  })
  const store = async () => page.addInitScript(({ storageName, saved }) => localStorage.setItem(storageName, JSON.stringify([saved])), { storageName, saved })
  const bookmark = '/cerca?' + new URLSearchParams({ categorias: category, servicio: saved.id, lat: String(saved.lat), lon: String(saved.lon) })
  return { state, point, saved, category, store, bookmark }
}
async function panel(page: Page) { if (page.viewportSize()!.width < 1024) await page.locator('#btn-sheet-toggle').click() }
async function savedItems(page: Page) { return page.evaluate(name => JSON.parse(localStorage.getItem(name) || '[]'), storageName) }

for (const refuge of [false, true]) test('guarda sólo identidad pública y abre desde Inicio: ' + (refuge ? 'refugio' : 'sala'), async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Datos y fuente simulados.')
  await page.setViewportSize({ width: refuge ? 390 : 1280, height: 900 })
  const f = await fixture(page, refuge)
  await page.goto('/cerca?municipio=' + (refuge ? '08019' : '28079') + '&categorias=' + f.category); await panel(page)
  const card = page.locator('.sv-card[data-servicio="' + f.point.id + '"]')
  await card.getByRole('button', { name: 'Guardar favorito: ' + f.point.nombre }).click()
  expect(await savedItems(page)).toEqual([f.saved])
  const savedButton = card.getByRole('button', { name: 'Guardado. Quitar de favoritos: ' + f.point.nombre })
  await expect(savedButton).toHaveAttribute('aria-pressed', 'true')
  await savedButton.click()
  const saveButton = card.getByRole('button', { name: 'Guardar favorito: ' + f.point.nombre })
  await expect(saveButton).toHaveAttribute('aria-pressed', 'false')
  expect(await savedItems(page)).toEqual([])
  await saveButton.click()
  await expect(savedButton).toHaveAttribute('aria-pressed', 'true')
  expect((await new AxeBuilder({ page }).include('.sv-panel').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: info.outputPath('favorito-publico-' + (refuge ? '390' : '1280') + '.png') })
  await page.goto('/')
  const link = page.locator('main a[href*="servicio=' + f.point.id + '"]').first()
  await expect(link).toBeVisible(); await link.click()
  await expect(page.locator('.leaflet-popup')).toContainText(f.point.nombre)
  await expect(page.locator('.leaflet-popup')).toContainText(refuge ? 'no confirma que esté activado' : 'No se comprueban plazas libres')
  expect(f.state.lookups).toHaveLength(1); expect(f.state.lookups[0].search).toBe('')
  expect(await savedItems(page)).toEqual([f.saved]); expect(f.state.writes).toEqual([])
})

test('el ID encuentra un traslado y centra la ficha actual sin reescribir el favorito', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Traslado simulado.')
  const f = await fixture(page); await f.store(); f.state.item = { ...f.point, lat: 40.61, lon: -3.62, nombre: 'Sala trasladada de prueba' }
  await page.goto(f.bookmark); await expect(page.locator('.leaflet-popup')).toContainText('Sala trasladada de prueba')
  await expect.poll(() => page.evaluate(() => (window as any).map.getBounds().contains([40.61, -3.62]))).toBe(true)
  await expect(page.locator('.leaflet-popup').getByRole('link', { name: 'Google Maps' })).toHaveAttribute('href', /destination=40.61%2C-3.62/)
  expect(await savedItems(page)).toEqual([f.saved])
  expect(f.state.lookups[0].search).toBe('')
  await expect(page).toHaveURL(/lat=40.61&lon=-3.62/)
})
for (const kind of ['missing', 'error', 'coordinates'] as const) test('conserva el favorito sin inventar ficha: ' + kind, async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Fallo controlado.')
  const f = await fixture(page); await f.store()
  if (kind === 'coordinates') f.state.item = { ...f.point, lat: null, lon: null }; else f.state.status = kind === 'missing' ? 404 : 503
  await page.goto(f.bookmark); await panel(page)
  await expect(page.locator('#sv-status')).toContainText(kind === 'missing' ? 'ya no aparece' : kind === 'coordinates' ? 'ya no tiene una ubicación comprobable' : 'No se puede comprobar ahora')
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  await expect(page.locator('.sv-card')).toHaveCount(0)
  expect(await savedItems(page)).toEqual([f.saved])
})
test('una copia conservada muestra aviso y no inventa apertura o plazas', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Copia antigua simulada.')
  const f = await fixture(page); await f.store(); f.state.stale = true
  await page.goto(f.bookmark)
  await expect(page.locator('.leaflet-popup')).toContainText('Copia anterior')
  await expect(page.locator('.leaflet-popup')).toContainText('No se comprueban plazas libres ni apertura')
})
test('un manifiesto anterior mantiene el directorio sin estrella', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Contrato anterior simulado.')
  const f = await fixture(page); f.state.ready = false
  await page.goto('/cerca?municipio=28079&categorias=' + f.category); await panel(page)
  const card = page.locator('.sv-card[data-servicio="' + f.point.id + '"]')
  await expect(card).toBeVisible(); await expect(card.getByRole('button', { name: /Guardar favorito/ })).toHaveCount(0)
})
test('quitar el favorito durante una consulta impide que una respuesta tardía restaure la ficha', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Red pendiente simulada.')
  const f = await fixture(page); await f.store()
  let release!: () => void; f.state.gate = new Promise<void>(resolve => { release = resolve })
  await page.goto(f.bookmark); await expect.poll(() => f.state.lookups.length).toBe(1); await panel(page)
  await page.locator('#sv-favorites').click()
  await page.getByRole('button', { name: 'Guardado. Quitar de favoritos: ' + f.point.nombre }).click()
  expect(await savedItems(page)).toEqual([])
  release()
  await expect(page.locator('#sv-status')).toContainText('Todavía no tienes lugares guardados')
  await expect(page.locator('.leaflet-popup')).toHaveCount(0); await expect(page.locator('.sv-card')).toHaveCount(0)
})
test('cambiar de capa descarta una respuesta tardía sin volver a mostrar el equipamiento', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Red pendiente simulada.')
  const f = await fixture(page); await f.store()
  let release!: () => void; f.state.gate = new Promise<void>(resolve => { release = resolve })
  await page.goto(f.bookmark); await expect.poll(() => f.state.lookups.length).toBe(1); await panel(page)
  await page.locator('#sv-view-fuel').click(); release()
  await expect(page.locator('#fuel-content')).toBeVisible()
  await expect(page.locator('.leaflet-popup')).toHaveCount(0)
  expect(await savedItems(page)).toEqual([f.saved])
})
