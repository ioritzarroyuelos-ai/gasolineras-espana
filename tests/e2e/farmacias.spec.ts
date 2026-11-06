// E2E de `/farmacias/` — buscador de FARMACIA DE GUARDIA por municipio (texto).
//
// El mapa de todas las farmacias (Leaflet + geolocalizacion + farmacias.json) se
// retiro (sept 2026); ahora la pagina es un buscador de texto que autocompleta
// municipios desde /api/guardias/municipios y lleva a la pagina de guardia de
// ese municipio (SSR). Comprobamos:
//   - shell del buscador (H1, input, enlace "por provincia"), sin mapa
//   - canonical + meta description, y canonicalizacion /farmacias -> /farmacias/
//   - el endpoint del indice devuelve municipios
//   - el autocompletado sugiere y navega al pulsar
//   - los 47 snapshots de guardias siguen servidos con count > 0
//   - sin violaciones graves de axe

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Farmacias de guardia (/farmacias/)', () => {
  test('carga el buscador (H1, input, enlace por provincia) y ya no hay mapa', async ({ page }) => {
    await page.goto('/farmacias/')
    await expect(page).toHaveTitle(/Farmacia de guardia.*España Útil/i)
    await expect(page.getByRole('heading', { level: 1, name: /farmacia de guardia en españa/i })).toBeVisible()
    await expect(page.locator('#q')).toBeVisible()
    await expect(page.getByRole('search')).toHaveCount(1)
    await expect(page.locator('#municipio-form')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /provincia por provincia/i })).toBeVisible()
    // El mapa ya no existe.
    await expect(page.locator('#map')).toHaveCount(0)
  })

  test('canonicalizacion /farmacias -> /farmacias/', async ({ page }) => {
    const res = await page.goto('/farmacias')
    expect(res?.status()).toBe(200) // 200 tras seguir el 301
    await expect(page).toHaveURL(/\/farmacias\/?$/)
  })

  test('meta description y canonical presentes', async ({ page }) => {
    await page.goto('/farmacias/')
    const desc = await page.locator('meta[name="description"]').getAttribute('content')
    expect(desc).toBeTruthy()
    expect(desc!.length).toBeGreaterThan(50)

    const canonical = await page.locator('link[rel="canonical"]').getAttribute('href')
    expect(canonical).toMatch(/\/farmacias\/$/)
  })

  test('/api/guardias/municipios devuelve el indice de municipios', async ({ request }) => {
    const res = await request.get('/api/guardias/municipios')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(100)
    // Cada entrada: nombre municipio, provincia, url de su pagina de guardia.
    for (const e of body.slice(0, 20)) {
      expect(typeof e.n).toBe('string')
      expect(typeof e.p).toBe('string')
      expect(e.u).toMatch(/^\/farmacias\//)
    }
  })

  test('el municipio exacto aparece antes que la provincia y se puede elegir con el teclado', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 })
    await page.goto('/farmacias/')
    const input = page.locator('#q')
    await input.click()
    await input.fill('madrid')
    const sugs = page.locator('#sugs')
    await expect(sugs).toBeVisible({ timeout: 10_000 })
    const opciones = sugs.getByRole('option')
    await expect(opciones.first()).toHaveAttribute('href', '/farmacias/madrid/madrid')
    await expect(opciones.filter({ hasText: 'Toda la provincia' })).toHaveAttribute('href', '/farmacias/madrid')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    await input.press('Escape')
    await expect(sugs).toBeHidden()
    await input.press('ArrowDown')
    await expect(input).toHaveAttribute('aria-activedescendant', await opciones.first().getAttribute('id') as string)
    await expect(opciones.first()).toHaveAttribute('aria-selected', 'true')
    await input.press('Enter')
    await expect(page).toHaveURL(/\/farmacias\/madrid\/madrid$/)
  })

  test('pulsar una sugerencia navega a la pagina de guardia del municipio', async ({ page }) => {
    await page.goto('/farmacias/')
    const input = page.locator('#q')
    await input.click()
    await input.fill('madrid')
    const sugs = page.locator('#sugs')
    await expect(sugs).toBeVisible({ timeout: 10_000 })
    await sugs.locator('a').filter({ hasNotText: /Toda la provincia/i }).first().click()
    await expect(page).toHaveURL(/\/farmacias\/[a-z-]+\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Farmacias de guardia en Madrid', exact: true })).toBeVisible()
  })

  test('recupera las sugerencias tras un error y evita varias descargas mientras se escribe', async ({ page }, info) => {
    test.skip(info.config.metadata.live === true, 'El error simulado sólo se prueba en local.')
    let peticiones = 0
    let soltar!: () => void
    const espera = new Promise<void>(r => { soltar = r })
    await page.route('**/api/guardias/municipios', async route => {
      if (++peticiones === 1) { await espera; await route.fulfill({ status: 503 }); return }
      await route.fulfill({ json: [{ n: 'Madrid', p: 'Madrid', u: '/farmacias/madrid/madrid' }, { n: 'Lugo', p: 'Lugo', u: '/farmacias/lugo' }] })
    })
    await page.goto('/farmacias/')
    const q = page.getByRole('combobox')
    await q.pressSequentially('Lugo')
    await expect.poll(() => peticiones).toBe(1)
    await expect(page.getByRole('status')).toContainText('Buscando')
    soltar()
    await expect(page.getByRole('status')).toContainText('Puedes pulsar Buscar')
    await page.getByRole('button', { name: 'Reintentar sugerencias' }).click()
    const opciones = page.getByRole('option')
    await expect(opciones).toHaveCount(1)
    await expect(opciones.first()).toHaveAttribute('href', '/farmacias/lugo')
    await expect(q).toBeFocused()
    await q.fill('Nombre que no existe')
    await expect(page.getByRole('status')).toContainText('Pulsa Buscar')
    await page.getByRole('button', { name: 'Buscar', exact: true }).click()
    await expect(page).toHaveURL(/\/farmacias\/buscar\?q=Nombre\+que\+no\+existe$/)
    expect(peticiones).toBe(2)
  })

  test('se puede buscar un municipio sin JavaScript', async ({ browser, baseURL }) => {
    const contexto = await browser.newContext({ baseURL, javaScriptEnabled: false })
    try {
      const pagina = await contexto.newPage()
      await pagina.goto('/farmacias/')
      await pagina.getByLabel('¿En qué municipio?').fill('Madrid')
      await pagina.getByRole('button', { name: 'Buscar', exact: true }).click()
      await expect(pagina).toHaveURL(/\/farmacias\/madrid\/madrid$/)
      await expect(pagina.getByRole('heading', { level: 1 })).toContainText('Madrid')
    } finally { await contexto.close() }
  })

  test('los 47 snapshots de guardias se sirven con count > 0', async ({ request }) => {
    const territorios = ['madrid', 'bizkaia', 'gipuzkoa', 'alava', 'coruna', 'murcia', 'almeria', 'girona', 'tarragona', 'cordoba', 'cantabria', 'pontevedra', 'laspalmas', 'alicante', 'cadiz', 'ceuta', 'valencia', 'clm', 'ourense', 'huesca', 'barcelona', 'baleares', 'navarra', 'castellon', 'asturias', 'rioja', 'caceres', 'lleida', 'soria', 'zamora', 'malaga', 'zaragoza', 'badajoz', 'valladolid', 'melilla', 'avila', 'burgos', 'salamanca', 'tenerife', 'teruel', 'segovia', 'granada', 'palencia', 'huelva', 'jaen', 'sevilla', 'leon']
    for (const t of territorios) {
      const res = await request.get(`/data/guardias-${t}.json`)
      expect(res.status(), `guardias-${t}.json debe existir`).toBe(200)
      const body = await res.json()
      expect(body.territorio, `territorio field del json ${t}`).toBe(t)
      expect(Array.isArray(body.guardias), `${t} guardias array`).toBe(true)
      expect(body.count, `${t} count > 0`).toBeGreaterThan(0)
      expect([8, 9]).toContain(body.schema.length)
      expect(body.schema.slice(0, 8)).toEqual([
        'lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc',
      ])
      if (body.schema.length === 9) {
        expect(body.schema[8]).toBe('provinciaId')
        for (const row of body.guardias) {
          // La columna opcional identifica cada una de las cinco provincias
          // de CLM; las otras fuentes pueden omitirla y usar su territorio.
          if (t === 'clm') expect(['02', '13', '16', '19', '45']).toContain(row[8])
          else if (row[8] !== undefined) expect(String(row[8])).toMatch(/^\d{2}$/)
        }
      }
    }
  })

  test('sin violaciones graves de axe', async ({ page }) => {
    await page.goto('/farmacias/')
    await expect(page.locator('#q')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // eslint-disable-next-line no-console
      console.log('axe violations farmacias:', JSON.stringify(severe, null, 2))
    }
    expect(severe).toEqual([])
  })
})
