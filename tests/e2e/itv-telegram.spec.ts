import { test, expect, type Page, type BrowserContext } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// Entire Telegram/account API is intercepted. This exercises the website only;
// no real person, Google account, bot or production KV is modified or messaged.
const TOKEN = 'fixture-only-not-a-real-telegram-credential'
const LINK_TOKEN = 'a'.repeat(32)
const LOCAL = { version: 1, recordatorio: { id: '11111111-1111-4111-8111-111111111111', fecha: '2028-02-29', nombre: 'Mi vehículo de prueba' } }
async function fixture(page: Page, context: BrowserContext, linked = true) {
  // Las fechas de 2028 prueban febrero bisiesto desde una fecha de partida
  // estable; no caducan por el paso real de los años en CI.
  await page.clock.setFixedTime(new Date('2026-11-21T09:00:00Z'))
  const state = { available: true, confirmed: false, recordatorio: null as null | { fecha: string; consentimiento: string }, failure: 0, error: 'fixture_failure', uncertain: false,
    writes: [] as Array<{ method: string; body: unknown }>, links: [] as unknown[], errors: [] as string[] }
  page.on('pageerror', error => state.errors.push(error.message))
  await page.addInitScript(({ linked, token, local }) => {
    if (!sessionStorage.getItem('itv-fixture-initialized')) {
      sessionStorage.setItem('itv-fixture-initialized', '1'); localStorage.setItem('eu-itv-recordatorio-v1', JSON.stringify(local));
      if (linked) localStorage.setItem('gs_tg_auth_v1', token)
    }
  }, { linked, token: TOKEN, local: LOCAL })
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    if (path === '/api/me') return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (path === '/api/telegram/itv-recordatorio/config') return route.fulfill({ json: { available: state.available, linkAvailable: state.available } })
    if (path === '/api/telegram/start-link') {
      expect(request.method()).toBe('POST'); state.links.push(request.postDataJSON());
      return route.fulfill({ json: { ok: true, token: LINK_TOKEN, deepLink: 'https://t.me/EspanaUtilFixture?start=' + LINK_TOKEN } })
    }
    if (path === '/api/telegram/confirm') return route.fulfill({ json: state.confirmed ? { ok: true, confirmed: true, chat_id: 1001, auth: TOKEN } : { ok: true, confirmed: false } })
    if (path === '/api/telegram/itv-recordatorio') {
      expect(request.headers().authorization).toBe('Bearer ' + TOKEN)
      if (request.method() !== 'GET') state.writes.push({ method: request.method(), body: request.postData() ? request.postDataJSON() : null })
      if (state.failure) return route.fulfill({ status: state.failure, json: { ok: false, error: state.error } })
      if (request.method() === 'PUT') state.recordatorio = request.postDataJSON()
      if (request.method() === 'DELETE') state.recordatorio = null
      const recordatorio = state.recordatorio ? { ...state.recordatorio, ventanas: [7, 1].map(dias => ({ dias, fecha: new Date(Date.parse(state.recordatorio!.fecha + 'T12:00:00Z') - dias * 86400000).toISOString().slice(0, 10), desde: '08:00', hasta: '11:59', zona: 'Europe/Madrid' })) } : null
      return route.fulfill({ json: { ok: true, recordatorio, avisos: state.uncertain ? [{ dias: 7, estado: 'incierto' }] : [] } })
    }
    if (['/api/client-error', '/api/vitals'].includes(path)) return route.fulfill({ json: { ok: true } })
    if (request.method() !== 'GET') throw new Error('Unexpected API mutation: ' + path)
    return route.fulfill({ status: 503, json: { error: 'fixture_not_available' } })
  })
  await context.route('https://t.me/**', route => route.fulfill({ contentType: 'text/html', body: '<html lang="es"><title>Telegram simulado</title><button>Iniciar (prueba local)</button></html>' }))
  return state
}

for (const width of [390, 1280]) test('Telegram ITV requiere permiso, usa la fecha guardada y permite cancelar a ' + width + 'px', async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 })
  const state = await fixture(page, context)
  await page.goto('/itv/')
  const panel = page.locator('#itv-telegram'), activate = page.locator('#itv-telegram-activar'), consent = page.locator('#itv-telegram-permiso')
  await expect(panel).toBeVisible(); await expect(activate).toBeDisabled(); expect(state.writes).toEqual([])
  expect((await activate.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await consent.check(); await expect(activate).toBeEnabled()
  await page.locator('#itv-recordatorio-fecha').fill('2028-03-01')
  await expect(consent).not.toBeChecked(); await consent.check(); await expect(activate).toBeDisabled()
  await page.getByRole('button', { name: 'Guardar fecha', exact: true }).click(); await expect(activate).toBeDisabled()
  await consent.check(); await activate.click()
  await expect(page.locator('#itv-telegram-estado')).toContainText('01/03/2028')
  await expect(page.locator('#itv-telegram-estado')).toContainText('23/02/2028 (7 días antes) y 29/02/2028 (1 día antes)')
  expect(state.writes).toEqual([{ method: 'PUT', body: { fecha: '2028-03-01', consentimiento: 'itv-telegram-v1' } }])
  await expect(page.locator('#itv-recordatorio-calendario')).toBeVisible()
  await page.reload(); await expect(page.locator('#itv-telegram-cancelar')).toBeVisible()
  expect((await page.locator('#itv-telegram-cancelar').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await panel.scrollIntoViewIfNeeded(); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  const audit = await new AxeBuilder({ page }).include('#itv-recordatorio').withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
  expect(audit.violations).toEqual([])
  await panel.screenshot({ path: info.outputPath('itv-telegram-' + width + '.png') })
  page.once('dialog', dialog => dialog.dismiss()); await page.locator('#itv-telegram-cancelar').click(); expect(state.writes).toHaveLength(1)
  page.once('dialog', dialog => dialog.accept()); await page.locator('#itv-telegram-cancelar').click()
  await expect(page.locator('#itv-telegram-estado')).toContainText('cancelados'); expect(state.writes.at(-1)).toEqual({ method: 'DELETE', body: null })
  await expect(page.locator('#itv-recordatorio-fecha')).toHaveValue('2028-03-01'); expect(state.errors).toEqual([])
})

test('vincula sin Google, abre el enlace explícito y no activa ITV ni gasolina por vincular', async ({ page, context }) => {
  const state = await fixture(page, context, false)
  await page.goto('/itv/')
  expect((await page.locator('#itv-telegram-vincular').boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await page.getByRole('button', { name: 'Vincular Telegram', exact: true }).click()
  const link = page.locator('#itv-telegram-abrir'); await expect(link).toBeVisible(); expect(state.links).toEqual([{ favs: [] }])
  expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  const opened = context.waitForEvent('page'); await link.click(); const telegram = await opened
  await telegram.getByRole('button', { name: 'Iniciar (prueba local)' }).click(); state.confirmed = true
  await expect(page.locator('#itv-telegram-estado')).toContainText('Todavía no has activado', { timeout: 12000 })
  expect(state.writes).toEqual([]); await expect(page.locator('#itv-telegram-activar')).toBeDisabled()
  expect(await page.evaluate(() => localStorage.getItem('gs_tg_auth_v1'))).toBe(TOKEN)
  expect(await page.evaluate(() => (window as any).EUCuenta.user)).toBeNull()
  await page.locator('#itv-telegram-permiso').check(); await page.locator('#itv-telegram-activar').click()
  await expect.poll(() => state.writes.length).toBe(1); expect(state.errors).toEqual([])
})

test('un fallo de guardado o una sesión caducada no se presentan como aviso activo', async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.goto('/itv/'); await expect(page.locator('#itv-telegram')).toBeVisible()
  state.failure = 503; await page.locator('#itv-telegram-permiso').check(); await page.locator('#itv-telegram-activar').click()
  await expect(page.locator('#itv-telegram-estado')).toContainText('No se pudo'); await expect(page.locator('#itv-telegram-cancelar')).toBeHidden()
  state.failure = 401; await page.locator('#itv-telegram-activar').click()
  await expect(page.locator('#itv-telegram-estado')).toContainText('ha caducado'); await expect(page.locator('#itv-telegram-vincular')).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('gs_tg_auth_v1'))).toBeNull(); expect(state.errors).toEqual([])
})

test('un servicio no configurado deja disponible el recordatorio de calendario', async ({ page, context }) => {
  const state = await fixture(page, context); state.available = false
  await page.goto('/itv/'); await expect(page.locator('#itv-recordatorio-calendario')).toBeVisible(); await expect(page.locator('#itv-telegram')).toBeHidden()
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([])
})

test('sin franjas futuras ofrece calendario y no afirma que haya activado avisos', async ({ page, context }) => {
  const state = await fixture(page, context)
  await page.goto('/itv/'); await expect(page.locator('#itv-telegram')).toBeVisible()
  state.failure = 400; state.error = 'no_future_windows'
  await page.locator('#itv-telegram-permiso').check(); await page.locator('#itv-telegram-activar').click()
  await expect(page.locator('#itv-telegram-estado')).toContainText('Ya han pasado las franjas')
  await expect(page.locator('#itv-telegram-estado')).toContainText('calendario')
  await expect(page.locator('#itv-telegram-cancelar')).toBeHidden(); await expect(page.locator('#itv-recordatorio-calendario')).toBeVisible()
})

test('una entrega incierta se explica sin declararla recibida ni volver a activar automáticamente', async ({ page, context }) => {
  const state = await fixture(page, context); state.recordatorio = { fecha: '2028-02-29', consentimiento: 'itv-telegram-v1' }; state.uncertain = true
  await page.goto('/itv/')
  await expect(page.locator('#itv-telegram-estado')).toContainText('Una entrega no pudo confirmarse')
  await expect(page.locator('#itv-telegram-cancelar')).toBeVisible(); await expect(page.locator('#itv-telegram-activar')).toBeDisabled()
  expect(state.writes).toEqual([])
})
