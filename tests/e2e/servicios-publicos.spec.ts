import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { build } from 'esbuild'

let script = ''
const id = 'salas-estudio-madrid', town = { ine: '28079', nombre: 'Madrid', provinciaNombre: 'Madrid', lat: 40.4168, lng: -3.7038, servicios: [] }
test.beforeAll(async () => { script = (await build({ entryPoints: ['src/client/servicios.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text })
async function fixture(page: Page, options: { stale?: boolean; fail?: boolean } = {}) {
  const state = { requests: [] as URL[], forbidden: [] as string[], errors: [] as string[], gate: null as Promise<void> | null }
  page.on('pageerror', e => state.errors.push(e.message))
  await page.route('**/static/servicios.js?*', route => route.fulfill({ contentType: 'text/javascript', body: script }))
  await page.route('**/api/**', async route => {
    const req = route.request(), u = new URL(req.url())
    if (req.method() !== 'GET') { state.forbidden.push(req.method() + ' ' + u.pathname); return route.fulfill({ status: 405, json: {} }) }
    if (['/api/me', '/api/auth/me'].includes(u.pathname)) return route.fulfill({ json: { user: null } })
    if (u.pathname === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (u.pathname === '/api/servicios/categorias') return route.fulfill({ json: { categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }], total: 1 } })
    if (u.pathname === '/api/servicios') return route.fulfill({ json: { items: [], siguientePagina: null } })
    if (u.pathname === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (u.pathname === '/api/localidades') return route.fulfill({ json: [] })
    if (u.pathname === '/api/servicios/publicos/' + id) {
      state.requests.push(u); for (const key of u.searchParams.keys()) if (!['zona', 'pagina'].includes(key)) state.forbidden.push(key)
      if (state.gate) await state.gate
      if (options.fail) return route.fulfill({ status: 503, json: {} })
      const zone = u.searchParams.get('zona'), p = Number(u.searchParams.get('pagina')), active = zone === '521-705'
      const item = { id: 'estudio-madrid-' + (p + 1), nombre: p ? 'Sala accesible' : 'Sala de lectura <ejemplo>', categoria: 'salas-estudio', lat: town.lat + p * 0.0001, lon: town.lng,
        municipio: 'Madrid', direccion: 'Calle de ejemplo, 1', cp: '28001', web: null, horarioTexto: 'De lunes a viernes de 9 a 21 h. Excepción final: cerrado el 6 de enero.', fechaFicha: null,
        accesibilidad: p ? 'si' : 'desconocido', accesibilidadTexto: p ? 'Accesible' : null, aguaPotable: null, lavabos: true, climatizacion: null, descanso: null, tipo: 'Sala de estudio' }
      return route.fulfill({ json: { schema: 1, proveedor: 'servicios-publicos', fuenteId: id, nombre: 'Salas de estudio y lectura de Madrid', totalDirectorio: 3, conCoordenadas: 2, sinCoordenadas: 1,
        consultado: new Date().toISOString(), fechaDatos: '2026-10-16T12:45:30.000Z', desactualizado: !!options.stale, estado: options.stale ? 'conservada' : 'actual', avisos: ['Sin plazas libres publicadas.'], zona: zone, pagina: p,
        total: active ? 2 : 0, items: active ? [item] : [], siguientePagina: active && p === 0 ? 1 : null } })
    }
    return route.fulfill({ status: 503, json: {} })
  })
  return state
}
async function open(page: Page) {
  await page.goto('/cerca?municipio=28079&categorias=' + id)
  if (page.viewportSize()!.width < 1024) await page.locator('#btn-sheet-toggle').click()
  await expect(page.locator('.sv-card[data-servicio="estudio-madrid-1"]')).toBeVisible()
}
for (const width of [1280, 390, 320]) test('catálogo oficial accesible y paginado en mapa a ' + width, async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Catálogo controlado.')
  await page.setViewportSize({ width, height: 900 }); const state = await fixture(page); await open(page)
  const card = page.locator('.sv-card[data-servicio="estudio-madrid-1"]')
  await expect(card).toContainText('Sala de lectura <ejemplo>'); await expect(card).toContainText('No se comprueban plazas libres ni apertura')
  await expect(card.getByRole('button', { name: /Guardar favorito/ })).toHaveCount(0)
  await card.locator('summary').click(); await expect(card).toContainText('Excepción final: cerrado el 6 de enero.')
  await expect(page.locator('#sv-source')).toContainText('1 sin coordenadas comprobables')
  await expect(page.locator('#sv-source').getByRole('link', { name: /Listado completo/ })).toHaveAttribute('href', '/servicios/' + id)
  for (const control of ['sv-open', 'sv-free']) await expect(page.locator('#' + control)).toBeDisabled()
  await page.locator('#sv-more').click(); await expect(page.locator('.sv-card[data-servicio="estudio-madrid-2"]')).toBeVisible()
  await page.locator('#sv-accessible').check(); await expect(card).toHaveCount(0); await expect(page.locator('.sv-card[data-servicio="estudio-madrid-2"]')).toHaveCount(1)
  expect((await new AxeBuilder({ page }).include('.sv-panel').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await page.locator('.sv-card[data-servicio="estudio-madrid-2"]').scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('servicios-publicos-' + width + '.png') })
  expect(state.errors).toEqual([]); expect(state.forbidden).toEqual([]); expect(state.requests.some(u => u.searchParams.get('pagina') === '1')).toBe(true)
})
test('una copia conservada conserva su advertencia y fecha original', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Catálogo controlado.')
  await page.setViewportSize({ width: 1280, height: 900 }); await fixture(page, { stale: true }); await open(page)
  await expect(page.locator('#sv-source')).toContainText('Directorio pendiente de renovar')
  await expect(page.locator('#sv-source')).toContainText('16 oct 2026')
  await expect(page.locator('.sv-card[data-servicio="estudio-madrid-1"]')).toContainText('Copia anterior')
})
test('el fallo de fuente muestra cobertura incompleta y acceso al directorio', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Respuesta controlada.')
  await page.setViewportSize({ width: 1280, height: 900 }); const state = await fixture(page, { fail: true })
  await page.goto('/cerca?municipio=28079&categorias=' + id)
  await expect(page.locator('#sv-source')).toContainText('No se han podido comprobar todas las fichas')
  await expect(page.locator('#sv-source').getByRole('link', { name: /Listado completo/ })).toHaveAttribute('href', '/servicios/' + id)
  await expect(page.locator('.sv-card')).toHaveCount(0); expect(state.errors).toEqual([])
})
test('una respuesta tardía no repone una capa oficial que se ha quitado', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Petición controlada.')
  await page.setViewportSize({ width: 1280, height: 900 }); const state = await fixture(page)
  let release!: () => void; state.gate = new Promise<void>(r => { release = r })
  try {
    await page.goto('/cerca?municipio=28079&categorias=' + id); await expect.poll(() => state.requests.length).toBeGreaterThan(0)
    await page.locator('#sv-query').fill('Baños'); await page.locator('#sv-search').evaluate(form => (form as HTMLFormElement).requestSubmit())
    await page.getByRole('button', { name: 'Servicio: Baños', exact: true }).click(); release()
    await expect(page.locator('.sv-card')).toHaveCount(0); expect(new URL(page.url()).searchParams.get('categorias')).toBe('banos')
    expect(state.errors).toEqual([])
  } finally { release() }
})
