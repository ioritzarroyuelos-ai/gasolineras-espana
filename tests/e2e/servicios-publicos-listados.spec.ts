import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildPublicosPage } from '../../src/html/servicios-publicos'
import { landingHeaders } from '../../src/html/landing'
import { SERVICIOS_PUBLICOS_FUENTES } from '../../scripts/lib/servicios-publicos.mjs'
import type { ConsultaDirectorioPublico } from '../../src/lib/servicios-publicos'

const definition = SERVICIOS_PUBLICOS_FUENTES[0], path = '/servicios/' + definition.id
function data(): ConsultaDirectorioPublico {
  const point = { id: 'refugio-cat-' + 'a'.repeat(64), nombre: 'Biblioteca municipal y espacio de lectura', categoria: 'refugios-climaticos' as const, lat: 41.4, lon: 2.1, municipio: 'Barcelona', direccion: 'Calle del equipamiento, 123', cp: null, web: null,
    horarioTexto: 'Lunes a viernes, de 9 a 20 h. Excepción al final: cerrado el 1 y 6 de enero.', fechaFicha: '2026-05-14T13:40:00.000', accesibilidad: 'desconocido' as const, accesibilidadTexto: 'Consultar las condiciones de acceso', tipo: 'Biblioteca', aguaPotable: true, lavabos: null, climatizacion: null, descanso: true }
  return { schema: 1, proveedor: 'servicios-publicos', fuenteId: definition.id, nombre: definition.nombre, consultado: '2026-11-21T01:48:33.000Z', ultimoIntento: '2026-11-21T01:48:33.000Z', fechaDatos: '2026-10-16T12:45:30.000Z', fuenteUrl: definition.fuenteUrl, licenciaUrl: definition.licenciaUrl, atribucion: definition.atribucion,
    totalDirectorio: 2730, conCoordenadas: 1421, sinCoordenadas: 1309, estado: 'conservada', desactualizado: true, avisos: ['El directorio no confirma que un refugio esté activado ni abierto.'], pagina: 0, tamanoPagina: 50, total: 2730, totalPaginas: 55, siguientePagina: 1, zona: null, q: '', items: [point, { ...point, id: 'refugio-cat-' + 'b'.repeat(64), nombre: 'Parque compartido sin un punto publicado', lat: null, lon: null, horarioTexto: null }] }
}
async function fixture(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ json: { user: null, available: false, syncAvailable: false } }))
  await page.route('**/servicios/refugios-cataluna*', route => {
    const url = new URL(route.request().url()), query = url.searchParams.get('q') || '', pagina = Number(url.searchParams.get('pagina') || 0), result = data(); result.q = query; result.pagina = pagina
    return route.fulfill({ status: 200, headers: landingHeaders('publicos-test-nonce'), body: buildPublicosPage({ nonce: 'publicos-test-nonce', canonical: url.origin + path, definition, data: result, query, pagina }) })
  })
}
for (const width of [1280, 390, 320]) test('listado oficial completo y legible a ' + width, async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Fichas controladas.')
  await page.setViewportSize({ width, height: 900 }); await fixture(page); await page.goto(path)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(definition.nombre)
  await expect(page.locator('.sp-summary')).toContainText(/1[.\s]?309 sin un punto comprobable/)
  await expect(page.locator('.sp-warning').first()).toContainText('Directorio pendiente de renovar')
  const cards = page.locator('.sp-card'); await expect(cards).toHaveCount(2)
  await expect(cards.nth(1)).toContainText('Sin coordenadas comprobables')
  await expect(cards.nth(1).getByRole('link', { name: /Ver esta zona/ })).toHaveCount(0)
  await cards.first().locator('summary').click(); await expect(cards.first()).toContainText('Excepción al final: cerrado el 1 y 6 de enero.')
  await expect(cards.first()).toContainText('14/05/2026 · 13:40:00.000 (zona horaria no publicada)')
  expect((await new AxeBuilder({ page }).include('.sp-main').analyze()).violations).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  await cards.first().scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('listado-publico-' + width + '.png') })
  await page.getByRole('searchbox', { name: 'Buscar por municipio o equipamiento' }).fill('Biblioteca')
  await page.locator('.sp-search').getByRole('button', { name: 'Buscar' }).click()
  await expect(page).toHaveURL(/q=Biblioteca/)
  await page.getByRole('link', { name: 'Página siguiente →' }).click()
  await expect(page).toHaveURL(/q=Biblioteca&pagina=1/)
})
