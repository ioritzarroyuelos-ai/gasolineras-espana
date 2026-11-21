import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Todas las API y Telegram se sustituyen por respuestas de prueba. Nunca se
// vincula una persona, se guarda una preferencia real ni se manda un mensaje.
const TOKEN = 'fixture-only-telegram-price-choice'
const station = { IDEESS: '900001', 'Rótulo': 'Gasolinera de prueba', Municipio: 'Madrid', Provincia: 'MADRID', IDProvincia: '28', IDMunicipio: '28079', 'Dirección': 'Calle de prueba, 1', Latitud: '40,4168', 'Longitud (WGS84)': '-3,7038', Horario: 'L-D: 24H', 'Precio Gasolina 95 E5': '1,500' }
async function fixture(page: Page, context: BrowserContext, linked = true) {
  const state = { preference: { modo: 'resumen', umbralMilesimas: 10, consentimiento: null as string | null, actualizado: null as string | null }, subscribed: true, failure: 0, malformed: false, gets: 0, writes: [] as Array<{ path: string; body: unknown }>, errors: [] as string[] }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.addInitScript(({ linked, token }) => {
    if (sessionStorage.getItem('price-fixture')) return
    sessionStorage.setItem('price-fixture', '1')
    localStorage.setItem('gs_favs_v1', JSON.stringify([{ id: '900001', rotulo: 'Gasolinera de prueba', municipio: 'Madrid', provinciaId: '28', municipioId: '28079', lat: 40.4168, lon: -3.7038 }]))
    if (linked) localStorage.setItem('gs_tg_auth_v1', token)
    localStorage.setItem('eu-itv-recordatorio-v1', JSON.stringify({ version: 1, recordatorio: { id: '11111111-1111-4111-8111-111111111111', fecha: '2028-02-29', nombre: 'Vehículo de prueba' } }))
  }, { linked, token: TOKEN })
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/me') return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false } })
    if (path === '/api/telegram/config') return route.fulfill({ json: { ok: true, username: 'EspanaUtilFixture' } })
    if (path === '/api/telegram/subscriptions') return route.fulfill({ json: { ok: true, subscriptions: state.subscribed ? [{ station_id: '900001', fuel_code: '95' }] : [] } })
    if (path === '/api/telegram/toggle-fav') {
      state.writes.push({ path, body: request.postDataJSON() })
      return route.fulfill({ status: 409, json: { ok: false, error: 'subscription_limit', limit: 100 } })
    }
    if (path === '/api/telegram/precios') {
      expect(request.headers().authorization).toBe('Bearer ' + TOKEN)
      if (request.method() === 'GET') state.gets++
      else { expect(request.method()).toBe('PUT'); state.writes.push({ path, body: request.postDataJSON() }) }
      if (state.failure) return route.fulfill({ status: state.failure, json: { ok: false, error: 'fixture_unavailable' } })
      if (request.method() === 'PUT') state.preference = { ...request.postDataJSON(), actualizado: '2026-11-21T09:00:00.000Z' }
      return route.fulfill({ json: state.malformed ? { ok: true } : { ok: true, preferencia: state.preference } })
    }
    if (path === '/api/telegram/unsubscribe') {
      state.writes.push({ path, body: request.postDataJSON() })
      return route.fulfill({ json: { ok: true } })
    }
    if (path.startsWith('/api/estaciones/')) return route.fulfill({ json: { Fecha: '21/11/2026 09:00:05', ListaEESSPrecio: [station] } })
    if (path.startsWith('/api/municipios/')) return route.fulfill({ json: [{ IDMunicipio: '28079', Municipio: 'Madrid', IDProvincia: '28' }] })
    if (['/api/client-error', '/api/vitals'].includes(path)) return route.fulfill({ json: { ok: true } })
    if (request.method() !== 'GET') throw new Error('Unexpected API mutation: ' + path)
    return route.fulfill({ status: 503, json: { error: 'fixture_unavailable' } })
  })
  await context.route('https://api.telegram.org/**', () => { throw new Error('La prueba nunca puede enviar a Telegram') })
  return state
}
async function open(page: Page) {
  await page.goto('/gasolineras/mapa?prov=28')
  if (!await page.locator('#btn-favs-open').isVisible()) await page.getByRole('button', { name: 'Ver lista y filtros', exact: true }).click()
  await page.locator('#btn-favs-open').click()
  await expect(page.locator('#modal-favs')).toBeVisible()
}
for (const width of [390, 1280]) test('elección explícita de bajadas y umbral a ' + width + 'px', async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page, context); await open(page)
  const mode = page.locator('#tg-price-mode'), save = page.locator('#tg-price-save'), feedback = page.locator('#tg-price-feedback')
  await expect(mode).toHaveValue('resumen'); await expect(save).toBeDisabled()
  await expect(feedback).toContainText('Guardado: resumen diario'); expect(state.writes).toEqual([])
  await mode.selectOption('bajadas'); await page.locator('#tg-price-threshold').selectOption('20')
  await expect(save).toBeEnabled(); expect(state.writes).toEqual([])
  await save.click(); await expect(feedback).toContainText('sólo bajadas de al menos 2 céntimos')
  expect(state.writes).toEqual([{ path: '/api/telegram/precios', body: { modo: 'bajadas', umbralMilesimas: 20, consentimiento: 'precios-telegram-v1' } }])
  await expect(save).toBeDisabled(); await expect(feedback).toContainText('No se envía ningún mensaje ahora')
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('eu-itv-recordatorio-v1')!).recordatorio.fecha)).toBe('2028-02-29')
  await page.locator('#tg-price-preferences').scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const audit = await new AxeBuilder({ page }).include('#modal-favs').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(audit.violations).toEqual([])
  await page.locator('#modal-favs .modal').screenshot({ path: info.outputPath('precios-' + width + '.png') })
  await open(page); await expect(mode).toHaveValue('bajadas')
  await expect(page.locator('#tg-price-threshold')).toHaveValue('20'); expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([])
})
test('un cambio no confirmado obliga a consultar antes de reintentar', async ({ page, context }) => {
  const state = await fixture(page, context); await open(page)
  await expect(page.locator('#tg-price-mode')).toBeEnabled(); await page.locator('#tg-price-mode').selectOption('bajadas')
  state.failure = 503; await page.locator('#tg-price-save').click()
  await expect(page.locator('#tg-price-feedback')).toContainText('No se ha podido confirmar')
  await expect(page.locator('#tg-price-save')).toBeDisabled(); await expect(page.locator('#tg-price-mode')).toBeDisabled()
  state.failure = 0; await page.locator('#btn-favs-close').click(); await page.locator('#btn-favs-open').click()
  await expect(page.locator('#tg-price-mode')).toHaveValue('resumen'); await expect(page.locator('#tg-price-feedback')).toContainText('Guardado: resumen diario')
  expect(state.gets).toBe(2); expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([])
})
test('sin vínculo no ofrece una elección activa y al cancelar precios conserva ITV', async ({ page, context }) => {
  const state = await fixture(page, context, false); await open(page)
  await expect(page.locator('#tg-price-preferences')).toBeHidden(); expect(state.gets).toBe(0); expect(state.writes).toEqual([])
  await page.evaluate(token => localStorage.setItem('gs_tg_auth_v1', token), TOKEN)
  await page.locator('#btn-favs-close').click(); await page.locator('#btn-favs-open').click()
  await expect(page.locator('#tg-price-mode')).toBeEnabled(); await page.locator('#btn-tg-toggle').click()
  await expect(page.locator('#tg-price-preferences')).toBeHidden()
  expect(state.writes).toEqual([{ path: '/api/telegram/unsubscribe', body: {} }])
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('eu-itv-recordatorio-v1')!).recordatorio.fecha)).toBe('2028-02-29')
  expect(state.errors).toEqual([])
})
test('respuesta incompleta no se presenta como elección guardada', async ({ page, context }) => {
  const state = await fixture(page, context); state.malformed = true; await open(page)
  await expect(page.locator('#tg-price-feedback')).toContainText('No se ha podido comprobar')
  await expect(page.locator('#tg-price-save')).toBeDisabled(); expect(state.writes).toEqual([])
})
test('una respuesta tardía del vínculo anterior no cambia el nuevo', async ({ page, context }) => {
  await fixture(page, context)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  let oldRequested = false, newRequested = false
  await context.route('**/api/telegram/precios', async route => {
    expect(route.request().method()).toBe('GET')
    const old = route.request().headers().authorization === 'Bearer ' + TOKEN
    if (old) { oldRequested = true; await held } else newRequested = true
    await route.fulfill({ json: { ok: true, preferencia: { modo: old ? 'resumen' : 'bajadas', umbralMilesimas: old ? 10 : 50, consentimiento: old ? null : 'precios-telegram-v1', actualizado: null } } })
  })
  await open(page); await expect.poll(() => oldRequested).toBe(true)
  await page.evaluate(() => localStorage.setItem('gs_tg_auth_v1', 'fixture-new-telegram-link'))
  await page.locator('#btn-favs-close').click(); await page.locator('#btn-favs-open').click(); release()
  await expect.poll(() => newRequested).toBe(true)
  await expect(page.locator('#tg-price-mode')).toHaveValue('bajadas'); await expect(page.locator('#tg-price-threshold')).toHaveValue('50')
  await expect(page.locator('#tg-price-save')).toBeDisabled()
})
test('alcanzar el límite explica cómo continuar y conserva la campana apagada', async ({ page, context }) => {
  const state = await fixture(page, context); state.subscribed = false; await open(page)
  const bell = page.locator('#favs-list [data-bell-id="900001"]')
  await expect(bell).toHaveAttribute('aria-pressed', 'false'); await bell.click()
  await expect(page.getByText('Puedes tener hasta 100 avisos de gasolineras y combustibles. Desactiva alguno para añadir otro.', { exact: true })).toBeVisible()
  await expect(bell).toHaveAttribute('aria-pressed', 'false')
  expect(state.writes).toEqual([{ path: '/api/telegram/toggle-fav', body: { station_id: '900001', fuel_code: '95', enabled: true } }])
  expect(state.errors).toEqual([])
})
