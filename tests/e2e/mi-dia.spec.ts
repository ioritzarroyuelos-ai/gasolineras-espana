import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { ministryFixture } from './ministry-fixture'

const clave = 'eu-mi-dia-v1'
const porDefecto = ['tiempo', 'gasolineras', 'deportes']
const visibles = (page: Page) => page.locator('#mi-dia-modulos [data-dia-module]:visible')
const ordenVisible = (page: Page) => visibles(page).evaluateAll(cards => cards.map(card => card.getAttribute('data-dia-module')))

test('Mi día guarda selección y orden, y comparte los marcadores con Cerca de ti', async ({ page }) => {
  await page.goto('/mi-dia')
  await expect.poll(() => ordenVisible(page)).toEqual(porDefecto)
  await page.locator('#mi-dia-personalizar').click()
  await expect(page.locator('#mi-dia-ajustes')).toBeVisible()
  await page.locator('[data-dia-visible="tiempo"]').uncheck()
  await page.locator('[data-dia-visible="farmacias"]').check()
  await page.locator('[data-dia-up="gasolineras"]').click()
  await page.locator('#mi-dia-listo').click()
  await expect(page.locator('#mi-dia-ajustes')).toBeHidden()
  await expect.poll(() => ordenVisible(page)).toEqual(['gasolineras', 'deportes', 'farmacias'])
  const guardado = await page.evaluate(key => localStorage.getItem(key), clave)
  expect(guardado).toBeTruthy()
  await page.reload()
  await expect.poll(() => ordenVisible(page)).toEqual(['gasolineras', 'deportes', 'farmacias'])
  expect(await page.evaluate(key => localStorage.getItem(key), clave)).toBe(guardado)

  await page.goto('/')
  await expect(page.locator('[data-dia-toggle="tiempo"]')).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('[data-dia-toggle="farmacias"]')).toHaveAttribute('aria-pressed', 'true')
  await page.locator('[data-dia-toggle="tiempo"]').click()
  await page.locator('[data-dia-toggle="farmacias"]').click()
  await page.goto('/mi-dia')
  await expect.poll(() => ordenVisible(page)).toEqual(['gasolineras', 'tiempo', 'deportes'])
})

test('vaciar el panel y restaurarlo funciona, con reordenación accesible por teclado', async ({ page }) => {
  await page.goto('/mi-dia')
  await page.locator('#mi-dia-personalizar').click()
  for (const id of porDefecto) await page.locator('[data-dia-visible="' + id + '"]').uncheck()
  await page.locator('#mi-dia-listo').click()
  await expect(page.locator('#mi-dia-vacio')).toBeVisible()
  await expect(visibles(page)).toHaveCount(0)
  await page.reload()
  await expect(page.locator('#mi-dia-vacio')).toBeVisible()
  await page.locator('[data-dia-reset]').click()
  await expect.poll(() => ordenVisible(page)).toEqual(porDefecto)
  await page.locator('#mi-dia-personalizar').click()
  const subir = page.locator('[data-dia-up="gasolineras"]')
  await subir.focus()
  await page.keyboard.press('Enter')
  await expect(subir).toBeDisabled()
  // Al llegar al primer puesto, el foco sigue dentro de la misma fila y no
  // cae al documento al deshabilitar el botón que se acaba de pulsar.
  await expect(page.locator('[data-dia-setting="gasolineras"] :focus')).toHaveCount(1)
  expect(await page.locator('[data-dia-setting="gasolineras"] :focus').isEnabled()).toBe(true)
  await expect.poll(() => ordenVisible(page)).toEqual(['gasolineras', 'tiempo', 'deportes'])
})

test('el municipio elegido sigue compartido al visitar Mi día y las secciones', async ({ page }) => {
  await page.goto('/?municipio=28079')
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await page.locator('.masthead a[href="/mi-dia"]').click()
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await expect(page.locator('#localidad-servicios a')).toHaveCount(4)
  const enlaces = await page.locator('#localidad-servicios a').evaluateAll(all => all.map(a => a.getAttribute('href')))
  expect(enlaces.every(href => href?.includes('/madrid'))).toBe(true)
  await page.goto('/politica/')
  await expect(page.locator('#municipio-elegido')).toHaveText('Tu municipio: Madrid')
  await page.goto('/mi-dia')
  await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Madrid')
  await page.getByRole('button', { name: 'Olvidar municipio' }).click()
  expect(await page.evaluate(() => localStorage.getItem('espana-util-municipio'))).toBeNull()
  await expect(page.locator('#localidad-titulo')).toHaveText('Qué necesitas en tu municipio')
})

test('Mi día usa las gasolineras y competiciones guardadas en sus secciones', async ({ page, request }, info) => {
  test.setTimeout(60000)
  await ministryFixture(page, request, info.config.metadata.live === true)
  await page.goto('/gasolineras/madrid/madrid')
  const primera = page.locator('.station-card').first()
  await expect(primera).toBeVisible({ timeout: 20000 })
  const id = await primera.locator('[data-fav-id]').getAttribute('data-fav-id')
  await primera.locator('[data-fav-id]').click()
  const indice = await request.get('/data/deportes/index.json').then(r => r.json())
  const competicion = indice.competiciones.find((c: { id?: string }) => !!c.id)
  expect(competicion).toBeTruthy()
  await page.goto('/deportes/competicion/' + competicion.id)
  const seguir = page.locator('[data-fav]').filter({ hasText: 'Seguir' }).first()
  const nombre = await seguir.getAttribute('data-name')
  const destino = await seguir.getAttribute('data-url')
  await seguir.click()

  await page.goto('/mi-dia')
  const enlacesGas = await page.locator('[data-dia-gas-favs] a').evaluateAll(all => all.map(a => a.getAttribute('href')!))
  expect(enlacesGas.some(href => new URL(href, 'https://prueba.example').searchParams.get('station') === id)).toBe(true)
  const deporte = page.locator('[data-dia-sport-favs]').getByRole('link', { name: nombre!, exact: true })
  await expect(deporte).toHaveAttribute('href', destino!)
  await deporte.click()
  await expect(page.locator('[data-fav][aria-pressed="true"]').first()).toBeVisible()
  await page.locator('[data-fav][aria-pressed="true"]').first().click()
  await page.goto('/mi-dia')
  await expect(page.locator('[data-dia-sport-favs]').getByRole('link', { name: nombre!, exact: true })).toHaveCount(0)
})

test('un navegador que bloquea almacenamiento mantiene la navegación y permite ordenar durante la visita', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', error => errores.push(error.message))
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Almacenamiento bloqueado', 'SecurityError') } })
  })
  await page.goto('/mi-dia')
  await expect.poll(() => ordenVisible(page)).toEqual(porDefecto)
  await page.locator('#mi-dia-personalizar').click()
  await page.locator('[data-dia-visible="itv"]').check()
  await expect(page.locator('#mi-dia-estado')).toContainText(/guardar|guardad|navegador|visita/i)
  await expect(page.locator('[data-dia-module="itv"]')).toBeVisible()
  await page.locator('[data-dia-down="tiempo"]').click()
  await expect.poll(() => ordenVisible(page)).toEqual(['gasolineras', 'tiempo', 'deportes', 'itv'])
  await page.locator('#mi-dia-listo').click()
  await expect(page.locator('.mh-nav a[href="/farmacias/"]')).toBeVisible()
  expect(errores).toEqual([])
})

test('preferencias dañadas y favoritos ajenos al portal no crean bloques ni enlaces inseguros', async ({ page }) => {
  const errores: string[] = []
  page.on('pageerror', error => errores.push(error.message))
  await page.goto('/mi-dia')
  await page.evaluate(key => localStorage.setItem(key, '{dato incompleto'), clave)
  await page.reload()
  await expect.poll(() => ordenVisible(page)).toEqual(porDefecto)
  await page.evaluate(key => {
    localStorage.setItem(key, JSON.stringify({ version: 1, visible: ['itv', 'itv', 'inventado'], order: ['itv', 'inventado'] }))
    localStorage.setItem('eu-deportes-favoritos-v1', JSON.stringify([
      { id: 'valido', nombre: '<img src=x onerror=alert(1)>', url: '/deportes/futbol?q=Athletic' },
      { id: 'script', nombre: 'No abrir', url: 'javascript:alert(1)' },
      { id: 'externo', nombre: 'No salir', url: 'https://externo.example/' },
    ]))
    localStorage.setItem('gs_favs_v1', JSON.stringify([
      { id: '42', rotulo: 'Favorita antigua', provinciaId: '99' },
      { id: '<script>', rotulo: 'Identificador inválido', provinciaId: '28' },
    ]))
  }, clave)
  await page.reload()
  await expect.poll(() => ordenVisible(page)).toEqual(['itv'])
  await expect(page.locator('[data-dia-sport-favs] a')).toHaveCount(1)
  await expect(page.locator('[data-dia-sport-favs] a')).toHaveAttribute('href', '/deportes/futbol?q=Athletic')
  await expect(page.locator('[data-dia-sport-favs] a')).toHaveText('<img src=x onerror=alert(1)>')
  await expect(page.locator('[data-dia-sport-favs] img')).toHaveCount(0)
  await expect(page.locator('[data-dia-gas-favs] a')).toHaveCount(1)
  await expect(page.locator('[data-dia-gas-favs] a')).toHaveAttribute('href', '/gasolineras/mapa?action=favs')
  await page.locator('#mi-dia-personalizar').click()
  await expect(page.locator('[data-dia-setting]')).toHaveCount(6)
  expect(errores).toEqual([])
})

test('portada y Mi día funcionan sin JavaScript con búsqueda y enlaces reales', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  try {
    const page = await context.newPage()
    const origen = test.info().project.use.baseURL!
    await page.goto(origen + '/mi-dia?municipio=28079')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Tu día\.\s+A tu manera\./)
    await expect(page.locator('#localidad-servicios a')).toHaveCount(4)
    await expect(page.locator('#mi-dia-personalizar')).toBeHidden()
    await expect(page.locator('noscript p')).toBeVisible()
    await expect(page.locator('noscript p')).toContainText(/JavaScript/i)
    await page.getByLabel('Tu municipio', { exact: true }).fill('Ávila')
    await page.locator('#municipio-form button').click()
    await page.getByRole('link', { name: 'Ávila · Ávila', exact: true }).click()
    await expect(page.locator('#localidad-titulo')).toHaveText('Tu municipio: Ávila')
    await page.locator('.mh-nav a[href="/deportes/"]').click()
    await expect(page).toHaveURL(/\/deportes\/$/)
  } finally { await context.close() }
})

test('portada, panel y ajustes caben en móvil y conservan contraste, foco y CSP', async ({ page }) => {
  test.setTimeout(90000)
  const errores: string[] = []
  page.on('pageerror', error => errores.push(error.message))
  for (const width of [320, 390, 1366]) {
    await page.setViewportSize({ width, height: 900 })
    for (const ruta of ['/', '/mi-dia']) {
      const respuesta = await page.goto(ruta)
      expect(respuesta?.headers()['content-security-policy']).not.toContain('unsafe-inline')
      await expect(page.locator('.masthead a[href="/mi-dia"]')).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth), ruta + ' a ' + width).toBe(width)
      expect(await page.locator('[style]').count()).toBe(0)
      expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      if (ruta === '/mi-dia') {
        await page.locator('#mi-dia-personalizar').click()
        await expect(page.locator('#mi-dia-ajustes')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      }
    }
  }
  expect(errores).toEqual([])
})
