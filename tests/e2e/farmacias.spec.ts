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
    await expect(page).toHaveTitle(/Farmacia de guardia.*CercaYa/i)
    await expect(page.getByRole('heading', { level: 1, name: /farmacia de guardia en españa/i })).toBeVisible()
    await expect(page.locator('#q')).toBeVisible()
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

  test('el autocompletado sugiere municipios al escribir', async ({ page }) => {
    await page.goto('/farmacias/')
    const input = page.locator('#q')
    await input.click()
    await input.fill('madrid')
    const sugs = page.locator('#sugs')
    await expect(sugs).toBeVisible({ timeout: 10_000 })
    // Al menos una sugerencia con enlace a una pagina de municipio.
    const link = sugs.locator('a').first()
    await expect(link).toBeVisible()
    await expect(link).toHaveAttribute('href', /^\/farmacias\/[a-z-]+\/[a-z0-9-]+$/)
  })

  test('pulsar una sugerencia navega a la pagina de guardia del municipio', async ({ page }) => {
    await page.goto('/farmacias/')
    const input = page.locator('#q')
    await input.click()
    await input.fill('madrid')
    const sugs = page.locator('#sugs')
    await expect(sugs).toBeVisible({ timeout: 10_000 })
    await sugs.locator('a').first().click()
    await expect(page).toHaveURL(/\/farmacias\/[a-z-]+\/[a-z0-9-]+$/)
    await expect(page.getByRole('heading', { level: 1, name: /farmacia de guardia/i })).toBeVisible()
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
      expect(body.schema).toEqual([
        'lat', 'lng', 'direccion', 'poblacion', 'telefono', 'cp', 'horarioGuardia', 'horarioGuardiaDesc',
      ])
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
