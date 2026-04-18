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

test.describe('Home (/)', () => {
  test('carga el shell y muestra la barra superior', async ({ page }) => {
    await page.goto('/')
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
    await page.goto('/')
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

  test('footer tiene enlaces a privacidad y cambios', async ({ page }) => {
    await page.goto('/')
    const footer = page.locator('#app-footer')
    await expect(footer).toBeVisible()
    await expect(footer.getByRole('link', { name: /privacidad/i })).toBeVisible()
    await expect(footer.getByRole('link', { name: /cambios/i })).toBeVisible()
  })

  test('sin violaciones criticas de accesibilidad (axe-core)', async ({ page }) => {
    await page.goto('/')
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
