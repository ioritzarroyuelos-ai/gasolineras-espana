// Happy path + scan de accesibilidad en la home.
//
// Los tests son deliberadamente tolerantes con la fuente de datos: en local
// el build sirve el snapshot estatico desde /public/data/ (via ASSETS), asi
// que no dependemos de la red del Ministerio para correr E2E.
//
// Para axe: excluimos tiles del mapa (leaflet usa <img> sin alt intencionado
// como background — cumple WCAG por el role del contenedor) y el widget de
// turnstile (es un iframe externo fuera de nuestro control).

import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Mapa (/gasolineras/mapa)', () => {
  test('carga el shell y muestra la barra superior', async ({ page }) => {
    await page.goto('/gasolineras/mapa')
    await expect(page).toHaveTitle(/Gasolineras España/i)

    // Cabecera principal presente
    await expect(page.locator('#app-header')).toBeVisible()
    await expect(page.locator('#brand')).toBeVisible()

    // El selector de provincia arranca deshabilitado (municipio) y con opciones cargadas
    // tras el bootstrap. Damos tiempo para la llamada /api/provincias.
    await expect(page.locator('#sel-provincia')).toBeVisible()
    // En chromium la opcion "-- Selecciona --" siempre esta, pero las provincias
    // llegan por fetch → esperamos a que tenga >10 options.
    await expect
      .poll(async () => (await page.locator('#sel-provincia option').count()), { timeout: 15_000 })
      .toBeGreaterThan(10)
  })

  test('seleccionar provincia activa el municipio', async ({ page }) => {
    await page.goto('/gasolineras/mapa')
    // Esperamos a que cargue el listado de provincias.
    await expect
      .poll(async () => (await page.locator('#sel-provincia option').count()), { timeout: 15_000 })
      .toBeGreaterThan(10)

    // Seleccionamos Madrid (id 28 en el INE → el value es el IDProvincia).
    // Como el value exacto depende del snapshot, elegimos la segunda opcion (primera real).
    const secondOpt = await page.locator('#sel-provincia option').nth(1).getAttribute('value')
    if (secondOpt) {
      await page.locator('#sel-provincia').selectOption(secondOpt)
      // El municipio se habilita tras la carga (puede tardar algo en conexiones lentas).
      await expect(page.locator('#sel-municipio')).toBeEnabled({ timeout: 15_000 })
    }
  })

  test('sin violaciones criticas de accesibilidad (axe-core)', async ({ page }) => {
    await page.goto('/gasolineras/mapa')
    // Esperamos al bootstrap para auditar el DOM "real", no el esqueleto inicial.
    await expect(page.locator('#app-header')).toBeVisible()

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      // leaflet-tile: imagenes decorativas del mapa sin alt intencionado
      // turnstile: iframe de Cloudflare (no controlamos su DOM)
      .exclude('.leaflet-tile-container')
      .exclude('.leaflet-marker-pane')
      .exclude('#ts-widget')
      .analyze()

    // Solo fallamos por issues serious+critical. Los minor/moderate se reportan
    // en el lighthouse CI (que tiene otro budget).
    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // Log amigable en output para CI
      // eslint-disable-next-line no-console
      console.log('axe violations:', JSON.stringify(severe, null, 2))
    }
    expect(severe).toEqual([])
  })
})

test.describe('Portada gasolineras (/gasolineras/)', () => {
  test('muestra el buscador y los accesos al mapa', async ({ page }) => {
    await page.goto('/gasolineras/')
    await expect(page).toHaveTitle(/Gasolineras baratas en España/i)

    // Buscador de municipio presente (no hay mapa aqui).
    await expect(page.locator('#q')).toBeVisible()
    await expect(page.locator('#map')).toHaveCount(0)

    // Accesos: ubicacion, ruta y mapa completo apuntan a /gasolineras/mapa.
    await expect(page.locator('a[href="/gasolineras/mapa?action=geolocate"]')).toBeVisible()
    await expect(page.locator('a[href="/gasolineras/mapa?action=route"]')).toBeVisible()
    await expect(page.locator('a[href="/gasolineras/mapa"]')).toBeVisible()
  })

  test('el autocompletado lleva a la pagina del municipio', async ({ page }) => {
    await page.goto('/gasolineras/')
    await page.locator('#q').click()
    await page.locator('#q').fill('alcorcon')
    // La primera sugerencia debe enlazar a /gasolineras/<prov>/<municipio>.
    const primera = page.locator('#sugs a').first()
    await expect(primera).toBeVisible({ timeout: 15_000 })
    await expect(primera).toHaveAttribute('href', /^\/gasolineras\/[a-z-]+\/[a-z0-9-]+$/)
  })

  test('sin violaciones criticas de accesibilidad (axe-core)', async ({ page }) => {
    await page.goto('/gasolineras/')
    await expect(page.locator('#q')).toBeVisible()
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()
    const severe = results.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')
    if (severe.length) {
      // eslint-disable-next-line no-console
      console.log('axe violations (portada):', JSON.stringify(severe, null, 2))
    }
    expect(severe).toEqual([])
  })
})

test.describe('Encuadre por zona (SEO)', () => {
  test('la pagina de provincia encuadra la provincia, no todo el pais', async ({ page }) => {
    await page.goto('/gasolineras/madrid')
    await expect(page.locator('#app-header')).toBeVisible()
    // Esperar a que carguen las estaciones de la provincia.
    await expect
      .poll(async () => page.evaluate(() => { try { return ((window as unknown as { allStations?: unknown[] }).allStations || []).length } catch { return 0 } }), { timeout: 20_000 })
      .toBeGreaterThan(100)
    await page.waitForTimeout(1500)  // margen para el fitBounds tras la carga
    const view = await page.evaluate(() => {
      const m = (window as unknown as { map: { getCenter(): { lat: number; lng: number }; getZoom(): number } }).map
      const c = m.getCenter()
      return { zoom: m.getZoom(), lat: c.lat, lng: c.lng }
    })
    // Centrado en Madrid (~40.4,-3.7) y con zoom de provincia (>=7), no a nivel
    // pais (zoom 5-6 centrado en ~39.7,-2.6). Regresion del bug del fitBounds
    // animado con maxBounds.
    expect(view.zoom).toBeGreaterThanOrEqual(7)
    expect(view.zoom).toBeLessThanOrEqual(11)  // no demasiado cerca (14=nivel calle)
    expect(view.lat).toBeGreaterThan(39.5)
    expect(view.lat).toBeLessThan(41.5)
    expect(view.lng).toBeGreaterThan(-4.6)
    expect(view.lng).toBeLessThan(-3.0)
  })

  test('la pagina de municipio muestra un radio (mas que solo el municipio)', async ({ page }) => {
    await page.goto('/gasolineras/madrid/alcorcon')
    await expect(page.locator('#app-header')).toBeVisible()
    await expect(page.locator('#radius-group')).toBeVisible({ timeout: 20_000 })
    await expect
      .poll(async () => page.evaluate(() => { try { return ((window as unknown as { filteredStations?: unknown[] }).filteredStations || []).length } catch { return 0 } }), { timeout: 20_000 })
      .toBeGreaterThan(40)  // Alcorcon solo tiene ~25; con 10 km hay muchas mas
    await expect(page.locator('#in-radius')).toHaveValue('10')
  })
})
