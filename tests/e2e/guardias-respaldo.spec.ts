import { test, expect } from '@playwright/test'
// @ts-expect-error Playwright se ejecuta en Node; la aplicación sólo carga tipos de Workers.
import { readFileSync } from 'node:fs'
import { parseLocalizadorAlmeria } from '../../scripts/lib/guardias-almeria-respaldo.mjs'
import { consultaCapitalCordoba } from '../../scripts/lib/guardias-cordoba-capital.mjs'
import { buildGuardiaMunicipioPage, guardiaHeaders } from '../../src/html/guardia-municipio'
import { parseGuardias, type GuardiasFile } from '../../src/lib/guardias'

const now = new Date('2026-11-21T09:24:00Z')
for (const provincia of ['almeria', 'cordoba']) test(provincia + ': respaldo visible y filtros conservadores en móvil y escritorio', async ({ page }, info) => {
  const file: GuardiasFile = { fecha: '2026-11-21', ts: now.toISOString(), territorio: provincia, guardiasVerificadas: true }
  if (provincia === 'almeria') {
    const html = readFileSync(new URL('../fixtures/guardias/almeria-localizador.html', import.meta.url), 'utf8')
    file.guardias = parseLocalizadorAlmeria(html, file.fecha!, +now).rows
    file.source = 'cofalmeria.com'; file.sourceUrl = 'https://guardias.cofalmeria.com/'; file.coordenadasOficiales = true
    file.cobertura = 'Cobertura parcial del localizador oficial. No acredita apertura actual. Llama antes de acudir.'
  } else {
    const pages = JSON.parse(readFileSync(new URL('../fixtures/guardias/cordoba-noviembre-posiciones.json', import.meta.url), 'utf8'))
    const data = await consultaCapitalCordoba(file.fecha!, { html: async () => '<a href="https://www.cofco.org/wp-content/uploads/2026/08/Noviembre-2026.pdf">NOVIEMBRE</a>', pdf: async () => new Uint8Array(), pages: async () => pages })
    file.guardias = data.rows; file.source = 'cofco.org'; file.sourceUrl = 'https://www.cofco.org/guardias-2026/'
    file.cobertura = 'Cobertura parcial. Córdoba capital: calendario mensual del colegio. No se reutilizan turnos antiguos de los pueblos.'
    file.incidencias = ['80 consultas municipales no devolvieron turnos verificables.']
  }
  const nombre = provincia === 'almeria' ? 'Almería' : 'Córdoba', url = '/farmacias/' + provincia + '/' + provincia
  await page.route(new RegExp(url + '(?:\\?.*)?$'), async route => {
    const address = new URL(route.request().url()), requested = address.searchParams.get('turno')
    const body = buildGuardiaMunicipioPage('respaldo-e2e', { provinciaSlug: provincia, provinciaName: nombre, municipioSlug: provincia, municipioName: nombre,
      guardias: parseGuardias(file, now).filter(row => row.municipio === nombre), otrosMunicipios: [], actualizado: file.ts, fuente: file.source, metadatos: file,
      canonical: address.origin + address.pathname, turno: requested === 'ahora' || requested === '24h' ? requested : 'todas', ahora: now })
    await route.fulfill({ status: 200, headers: guardiaHeaders('respaldo-e2e'), body })
  })
  for (const width of [320, 1280]) {
    await page.setViewportSize({ width, height: 800 })
    await page.goto(url)
    // A las 10:24 ya han terminado las dos guardias de la madrugada anterior.
    await expect(page.locator('.g-card')).toHaveCount(provincia === 'almeria' ? 2 : 37)
    await expect(page.locator('#g-fuente')).toContainText('Cobertura parcial')
    await expect(page.getByRole('link', { name: /Consultar la fuente oficial/ })).toHaveAttribute('href', file.sourceUrl!)
    if (provincia === 'almeria') {
      expect(await page.locator('.g-card .g-tipo').allTextContents()).toEqual(['Turno por confirmar', 'Turno por confirmar'])
      await expect(page.locator('.g-card .g-hora').first()).toContainText('Horario por confirmar')
      await expect(page.locator('.g-card a[href^="tel:"]').first()).toBeVisible()
    } else {
      await expect(page.locator('.g-card .g-tipo').filter({ hasText: 'De guardia ahora' })).toHaveCount(35)
      await expect(page.locator('#g-fuente')).toContainText('80 consultas municipales')
      await expect(page.locator('.g-card a[href^="https://www.google.com/maps/search/"]').first()).toBeVisible()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
    await page.screenshot({ path: info.outputPath(provincia + '-' + width + '.png'), fullPage: false })
    await page.goto(url + '?turno=ahora')
    await expect(page.locator('.g-card')).toHaveCount(provincia === 'almeria' ? 0 : 35)
    await page.goto(url + '?turno=24h')
    await expect(page.locator('.g-card')).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Ver todos los turnos', exact: true })).toBeVisible()
  }
})
