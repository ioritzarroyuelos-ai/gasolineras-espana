import { expect, test, type BrowserContext, type Page } from '@playwright/test'

// Cuenta aislada: se ejercitan el cliente real, las páginas municipales reales
// y sus navegaciones, sin una sesión Google ni escrituras de producción.
const key = 'espana-util-municipio'
type Id = 'ana' | 'bea'
const users = {
  ana: { sub: 'ana', name: 'Ana Prueba', email: 'ana@example.test' },
  bea: { sub: 'bea', name: 'Bea Prueba', email: 'bea@example.test' },
}

async function server(context: BrowserContext, options: { guest?: string; delay?: boolean } = {}) {
  const gate = Promise.withResolvers<void>()
  const state = {
    user: 'ana' as Id | null,
    towns: { ana: '28079', bea: '48027' } as Record<Id, string | null>,
    puts: [] as Array<{ user: Id; value: unknown }>,
    pulls: 0,
    release: () => gate.resolve(),
  }
  if (!options.delay) gate.resolve()
  if (options.guest) await context.addInitScript(({ key, town }) => {
    if (sessionStorage.getItem('municipio-prueba-iniciado')) return
    localStorage.setItem(key, town)
    sessionStorage.setItem('municipio-prueba-iniciado', '1')
  }, { key, town: options.guest })
  await context.route(/\/api\/(?:me|auth\/logout|sync(?:\/[^?]+)?)$/, async route => {
    const request = route.request(), path = new URL(request.url()).pathname
    const headers = { 'Cache-Control': 'no-store' }
    if (path === '/api/me') return route.fulfill({ headers, json: { user: state.user ? users[state.user] : null } })
    if (path === '/api/auth/logout') {
      state.user = null
      return route.fulfill({ headers, json: { ok: true } })
    }
    const user = state.user
    if (!user) return route.fulfill({ status: 401, headers, json: { error: 'unauthenticated' } })
    if (request.headers()['x-account-id'] !== user) return route.fulfill({ status: 409, headers, json: { error: 'account_changed' } })
    if (path === '/api/sync') {
      state.pulls++
      await gate.promise
      return route.fulfill({ headers, json: { data: { [key]: state.towns[user] } } })
    }
    expect(request.method()).toBe('PUT')
    expect(decodeURIComponent(path.slice('/api/sync/'.length))).toBe(key)
    const value = request.postDataJSON()
    state.puts.push({ user, value })
    state.towns[user] = value
    return route.fulfill({ headers, json: { ok: true } })
  })
  return state
}

async function ready(page: Page) {
  await page.waitForFunction(() => !!(window as any).EUCuenta)
  await page.evaluate(() => (window as any).EUCuenta.ready)
}

test.beforeEach(async ({}, info) => {
  test.skip(info.config.metadata.live === true, 'Prueba con cuenta simulada; no comprueba el acceso Google real.')
})

test('espera la cuenta y después conserva el municipio elegido explícitamente en la URL', async ({ page, context }) => {
  const account = await server(context, { delay: true })
  await page.goto('/?municipio=48027')
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Durango')
  await expect.poll(() => account.pulls).toBe(1)
  expect(account.puts).toEqual([])
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
  account.release()
  await ready(page)
  await expect.poll(() => account.towns.ana).toBe('48027')
  await expect(page.locator('#municipio-elegido')).toHaveText('Tu municipio: Durango')
  await expect(page).toHaveURL(/\/?municipio=48027$/)
  expect(account.puts).toEqual([{ user: 'ana', value: '48027' }])
})

test('sin municipio explícito usa la cuenta y al cambiar de cuenta no sube el municipio anterior', async ({ page, context }) => {
  const account = await server(context, { guest: '48027' })
  await page.goto('/')
  await expect(page).toHaveURL(/\/?municipio=28079$/)
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await ready(page)
  account.user = 'bea'
  await page.evaluate(() => { void (window as any).EUCuenta.refresh() })
  await expect(page).toHaveURL(/\/?municipio=48027$/)
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Durango')
  await ready(page)
  expect(account.puts).toEqual([])
  expect(account.towns).toEqual({ ana: '28079', bea: '48027' })
})

test('cerrar sesión recupera el municipio invitado sin modificar el de la cuenta', async ({ page, context }) => {
  const account = await server(context, { guest: '48027' })
  await page.goto('/')
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await ready(page)
  await page.locator('#btn-user').click()
  await page.locator('#btn-logout').click()
  await expect(page).toHaveURL(/\/?municipio=48027$/)
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Durango')
  await expect(page.locator('#btn-login')).toBeVisible()
  expect(account.user).toBeNull()
  expect(account.towns.ana).toBe('28079')
  expect(account.puts).toEqual([])
})

test('olvidar municipio guarda el borrado antes de navegar y no lo recupera al recargar', async ({ page, context }) => {
  const account = await server(context)
  await page.goto('/mi-dia')
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await ready(page)
  await page.locator('#localidad-olvidar').click()
  await expect(page).toHaveURL(/\/mi-dia$/)
  await expect(page.locator('#localidad-titulo')).toHaveText('Qué necesitas en tu municipio')
  await expect.poll(() => account.towns.ana).toBeNull()
  await page.reload()
  await ready(page)
  await expect(page.locator('#localidad-titulo')).toHaveText('Qué necesitas en tu municipio')
  await expect(page.locator('#municipio-elegido')).toBeHidden()
  expect(account.puts).toEqual([{ user: 'ana', value: null }])
  expect(await page.evaluate(key => localStorage.getItem(key), key)).toBeNull()
})
