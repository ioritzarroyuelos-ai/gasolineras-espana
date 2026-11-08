import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { ministryFixture } from './ministry-fixture'

// Estos casos comprueban la app en un navegador con un servidor de cuenta
// aislado y un sustituto de GIS. No son una verificación real de OAuth Google.
type AccountId = 'cuenta-a' | 'cuenta-b'
type Cloud = Record<AccountId, Record<string, unknown>>
const gasKey = 'gs_favs_v1', sportKey = 'eu-deportes-favoritos-v1', dayKey = 'eu-mi-dia-v1'
const users = {
  'cuenta-a': { sub: 'cuenta-a', name: 'Ana Prueba', email: 'ana@example.test', picture: '' },
  'cuenta-b': { sub: 'cuenta-b', name: 'Bea Prueba', email: 'bea@example.test', picture: '' },
}
const favoriteA = { id: '900001', rotulo: 'Gasolinera de Ana', municipio: 'Madrid', provinciaId: '28', lat: 40.4168, lon: -3.7038 }
const favoriteB = { ...favoriteA, id: '900002', rotulo: 'Gasolinera de Bea' }
const favoriteGuest = { ...favoriteA, id: '900003', rotulo: 'Gasolinera del navegador' }
const favoriteSport = { id: 'competicion:laliga-easports', nombre: 'LaLiga EA Sports', url: '/deportes/competicion/laliga-easports' }
function cloud(): Cloud {
  return {
    'cuenta-a': { [gasKey]: [favoriteA], [sportKey]: [favoriteSport], [dayKey]: { version: 1, visible: ['tiempo'], order: ['tiempo', 'gasolineras', 'deportes', 'farmacias', 'itv', 'politica'] } },
    'cuenta-b': { [gasKey]: [favoriteB], [sportKey]: [] },
  }
}

async function accountServer(context: BrowserContext, remote: Cloud, initial: AccountId | null = null) {
  const state = { user: initial, loginAs: 'cuenta-a' as AccountId, pullStatus: 200, logoutStatus: 200, puts: [] as Array<{ account: AccountId; key: string; data: unknown }>, loginCalls: 0 }
  await context.route(/\/api\/(?:me|auth\/(?:config|google|logout)|sync(?:\/[^?]+)?)$/, async route => {
    const request = route.request(), path = new URL(request.url()).pathname, headers = { 'Cache-Control': 'no-store' }
    if (path === '/api/me') return route.fulfill({ headers, json: { user: state.user ? users[state.user] : null } })
    if (path === '/api/auth/config') return route.fulfill({ headers, json: { clientId: 'test-client.apps.googleusercontent.com', available: true } })
    if (path === '/api/auth/google') {
      expect(request.method()).toBe('POST')
      expect(request.postDataJSON()).toEqual({ credential: 'gis-test-only' })
      state.loginCalls++; state.user = state.loginAs
      return route.fulfill({ headers, json: { user: users[state.user] } })
    }
    if (path === '/api/auth/logout') {
      if (state.logoutStatus !== 200) return route.fulfill({ status: state.logoutStatus, headers, json: { error: 'test_logout_failed' } })
      state.user = null
      return route.fulfill({ headers, json: { ok: true } })
    }
    if (!state.user) return route.fulfill({ status: 401, headers, json: { error: 'unauthenticated' } })
    if (request.headers()['x-account-id'] !== state.user) return route.fulfill({ status: 409, headers, json: { error: 'account_changed' } })
    if (path === '/api/sync') return route.fulfill({ status: state.pullStatus, headers, json: state.pullStatus === 200 ? { data: remote[state.user] } : { error: 'test_sync_failed' } })
    expect(request.method()).toBe('PUT')
    const key = decodeURIComponent(path.slice('/api/sync/'.length)), data = request.postDataJSON()
    state.puts.push({ account: state.user, key, data })
    remote[state.user][key] = data
    return route.fulfill({ headers, json: { ok: true } })
  })
  await context.route('https://accounts.google.com/gsi/client', route => route.fulfill({
    contentType: 'application/javascript', body: `(() => {
      let callback;
      window.google = { accounts: { id: {
        initialize(options) { callback = options.callback; },
        renderButton(container) { const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Continuar con Google (prueba)'; button.addEventListener('click', () => callback({ credential: 'gis-test-only' })); container.append(button); },
        disableAutoSelect() {}
      } } };
    })();`,
  }))
  return state
}

async function ready(page: Page) {
  await page.waitForFunction(() => !!(window as any).EUCuenta)
  await page.evaluate(() => (window as any).EUCuenta.ready)
}
async function login(page: Page, name = 'Ana Prueba') {
  await page.locator('#btn-login').click()
  await expect(page.getByRole('dialog', { name: 'Tus favoritos, contigo' })).toBeVisible()
  await page.getByRole('button', { name: 'Continuar con Google (prueba)' }).click()
  await expect(page.locator('#login-modal')).toBeHidden()
  await expect(page.locator('#user-name')).toHaveText(name)
}
async function refresh(page: Page) {
  await page.evaluate(() => (window as any).EUCuenta.refresh())
}
async function openAccount(page: Page) {
  await page.locator('#btn-user').click()
  await expect(page.locator('#user-dropdown')).toBeVisible()
}

test.beforeEach(async ({}, info) => {
  test.skip(info.config.metadata.live === true, 'Cuenta y Google simulados: no usar esta prueba como evidencia de OAuth real en producción.')
})

test('entra por el botón Google, recupera la portada y conserva cambios en otra sesión limpia', async ({ page, context, browser, baseURL }) => {
  const remote = cloud(), server = await accountServer(context, remote)
  await page.goto('/')
  await ready(page)
  await expect(page.locator('#mis-favoritos')).toBeHidden()
  await login(page)
  expect(server.loginCalls).toBe(1)
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteA.rotulo)
  await expect(page.locator('[data-dia-sport-favs] a')).toHaveAttribute('href', favoriteSport.url)
  await page.locator('[data-dia-toggle="itv"]').click()
  await expect.poll(() => (remote['cuenta-a'][dayKey] as { visible: string[] }).visible).toContain('itv')
  await expect(page.locator('[data-home-module-favs]')).toContainText('ITV')

  const cleanContext = await browser.newContext({ baseURL, serviceWorkers: 'block' })
  try {
    await accountServer(cleanContext, remote)
    const another = await cleanContext.newPage()
    await another.goto('/')
    await ready(another)
    expect(await another.evaluate(() => localStorage.getItem('gs_favs_v1'))).toBeNull()
    await login(another)
    await expect(another.locator('[data-dia-gas-favs]')).toContainText(favoriteA.rotulo)
    await expect(another.locator('[data-dia-sport-favs]')).toContainText(favoriteSport.nombre)
    await expect(another.locator('[data-home-module-favs]')).toContainText('ITV')
  } finally { await cleanContext.close() }
})

test('cerrar la cuenta A restaura los favoritos del navegador y la cuenta B recibe solo los suyos', async ({ page, context }) => {
  const remote = cloud(), server = await accountServer(context, remote)
  await page.goto('/')
  await ready(page)
  await page.evaluate(({ key, favorite }) => { localStorage.setItem(key, JSON.stringify([favorite])); (window as any).EUCuenta.changed(key) }, { key: gasKey, favorite: favoriteGuest })
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteGuest.rotulo)
  await login(page)
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteA.rotulo)
  await expect(page.locator('[data-dia-gas-favs]')).not.toContainText(favoriteGuest.rotulo)
  await openAccount(page)
  await page.locator('#btn-logout').click()
  await expect(page.locator('#btn-login')).toBeVisible()
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteGuest.rotulo)
  await expect(page.locator('[data-dia-gas-favs]')).not.toContainText(favoriteA.rotulo)
  server.loginAs = 'cuenta-b'
  await login(page, 'Bea Prueba')
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteB.rotulo)
  await expect(page.locator('[data-dia-gas-favs]')).not.toContainText(favoriteA.rotulo)
  await expect(page.locator('[data-dia-gas-favs]')).not.toContainText(favoriteGuest.rotulo)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), gasKey)).toEqual([favoriteB])
  expect(server.puts).toEqual([])
})

test('un favorito eliminado en otro dispositivo no reaparece al recargar ni se vuelve a subir', async ({ page, context }) => {
  const remote = cloud(), server = await accountServer(context, remote, 'cuenta-a')
  await page.goto('/')
  await ready(page)
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteA.rotulo)
  remote['cuenta-a'][gasKey] = []
  remote['cuenta-a'][sportKey] = []
  await page.reload()
  await ready(page)
  await expect(page.locator('[data-dia-gas-favs] a')).toHaveCount(0)
  await expect(page.locator('[data-dia-sport-favs] a')).toHaveCount(0)
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), gasKey)).toEqual([])
  expect(server.puts).toEqual([])
})

test('una lectura fallida no reemplaza la nube por una copia antigua del navegador', async ({ page, context }) => {
  const remote = cloud(), server = await accountServer(context, remote, 'cuenta-a')
  server.pullStatus = 500
  await page.addInitScript(({ key, favorite }) => {
    localStorage.setItem('eu-cuenta-owner-v1', 'cuenta-a')
    localStorage.setItem(key, JSON.stringify([favorite]))
  }, { key: gasKey, favorite: favoriteGuest })
  await page.goto('/')
  await ready(page)
  await openAccount(page)
  await expect(page.locator('#user-dropdown-sync')).toContainText('No se han podido recuperar')
  expect(server.puts).toEqual([])
  expect(remote['cuenta-a'][gasKey]).toEqual([favoriteA])
  server.pullStatus = 200
  await refresh(page)
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteA.rotulo)
  await expect(page.locator('[data-dia-gas-favs]')).not.toContainText(favoriteGuest.rotulo)
  expect(server.puts).toEqual([])
})

test('si falla cerrar sesión, la cuenta sigue visible y muestra el error', async ({ page, context }) => {
  const server = await accountServer(context, cloud(), 'cuenta-a')
  server.logoutStatus = 500
  await page.goto('/')
  await ready(page)
  await openAccount(page)
  await page.locator('#btn-logout').click()
  await expect(page.locator('#user-dropdown-sync')).toContainText('No se pudo cerrar la sesión')
  await expect(page.locator('#user-name')).toHaveText('Ana Prueba')
  await expect(page.locator('#btn-login')).toBeHidden()
  await expect(page.locator('#btn-logout')).toBeEnabled()
  await expect(page.locator('[data-dia-gas-favs]')).toContainText(favoriteA.rotulo)
  expect(server.user).toBe('cuenta-a')
})

for (const width of [1280, 320]) {
  test('una sola cuenta accesible en todas las secciones a ' + width + ' px', async ({ page, context }) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 844 })
    await accountServer(context, cloud(), 'cuenta-a')
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    for (const path of ['/', '/gasolineras/', '/farmacias/', '/tiempo/', '/itv/', '/politica/', '/deportes/']) {
      await page.goto(path)
      await ready(page)
      await expect(page.locator('.masthead')).toHaveCount(1)
      await expect(page.locator('#btn-login')).toHaveCount(1)
      await expect(page.locator('#user-menu')).toHaveCount(1)
      await expect(page.locator('#login-modal')).toHaveCount(1)
      await expect(page.locator('#user-name')).toHaveText('Ana Prueba')
      await openAccount(page)
      await expect(page.locator('#btn-user-favs')).toHaveAttribute('href', '/#mis-favoritos')
      const bounds = await page.locator('#user-dropdown').boundingBox()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
      await page.keyboard.press('Escape')
      await expect(page.locator('#user-dropdown')).toBeHidden()
    }
    expect(errors).toEqual([])
  })
}

test('el mapa conserva favoritas, filtros y controles sin la segunda cabecera', async ({ page, context, request }) => {
  test.setTimeout(60000)
  const remote = cloud()
  remote['cuenta-a'][gasKey] = []
  await accountServer(context, remote, 'cuenta-a')
  await ministryFixture(page, request)
  await page.setViewportSize({ width: 1280, height: 844 })
  await page.goto('/gasolineras/mapa?prov=28')
  await ready(page)
  await expect(page.locator('#app-header')).toHaveCount(0)
  await expect(page.locator('#btn-login')).toHaveCount(1)
  await expect(page.locator('#map')).toBeVisible()
  const first = page.locator('.station-card').first()
  await expect(first).toBeVisible({ timeout: 20000 })
  const id = await first.locator('[data-fav-id]').getAttribute('data-fav-id')
  await first.locator('[data-fav-id]').click()
  await expect.poll(() => (remote['cuenta-a'][gasKey] as Array<{ id: string }>).map(item => String(item.id))).toContain(id)
  await page.locator('#btn-favs-open').click()
  await expect(page.locator('#modal-favs')).toBeVisible()
  await expect(page.locator('#favs-modal-count')).toHaveText('1')
  await page.locator('#btn-favs-close').click()
  await expect(page.locator('#modal-favs')).toBeHidden()
  const toggle = page.locator('#btn-toggle-sidebar')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('#btn-favs-open')).toBeVisible()
  await page.goto('/')
  await ready(page)
  await expect(page.locator('[data-dia-gas-favs] a')).toHaveAttribute('href', new RegExp('station=' + id))
})

test('quitar una competición en Deportes actualiza la cuenta y la portada', async ({ page, context }) => {
  const remote = cloud()
  await accountServer(context, remote, 'cuenta-a')
  await page.goto(favoriteSport.url)
  await ready(page)
  const follow = page.locator('[data-fav="' + favoriteSport.id + '"]')
  await expect(follow).toHaveAttribute('aria-pressed', 'true')
  await follow.click()
  await expect.poll(() => remote['cuenta-a'][sportKey]).toEqual([])
  await expect(follow).toHaveAttribute('aria-pressed', 'false')
  await page.goto('/')
  await ready(page)
  await expect(page.locator('[data-dia-sport-favs] a')).toHaveCount(0)
})
