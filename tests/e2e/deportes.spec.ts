import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildCompeticionDeportesPage, buildDeportesPage } from '../../src/html/deportes'
import { construyeIndiceDeportes, diaDeporte } from '../../scripts/lib/deportes-indice.mjs'
import { filtraCompeticiones, type CompeticionDeportiva, type IndiceDeportes } from '../../src/lib/deportes'
import { pageHeaders } from '../../src/lib/runtime'

// Fixtures solo de presentación. Las rutas y los lectores se prueban también
// por separado; el último recorrido de este archivo utiliza los datos reales.
async function presentacion(page: Page) {
  const sello = new Date().toISOString(), dia = diaDeporte(Date.now()), fuente = 'https://federacion.example/calendario'
  const c: CompeticionDeportiva = { id: 'liga-prueba', deporte: 'futbol', nombre: 'Liga de prueba', temporada: '2026-27', categoria: 'Sénior', zona: 'España', fuente: { nombre: 'Fuente de prueba', url: fuente }, comprobadoEn: sello,
    agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, eventos: [
      { id: 'partido', nombre: 'Águilas – Bosque', local: 'Águilas', visitante: 'Bosque', inicio: dia + 'T17:30:00Z', estado: 'programado', fuenteUrl: fuente },
      { id: 'final', nombre: 'Bosque – Águilas', local: 'Bosque', visitante: 'Águilas', fecha: dia, estado: 'finalizado', resultado: { local: 1, visitante: 2 }, fuenteUrl: fuente },
    ] }, clasificacion: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, tablas: [{ id: 'tabla', nombre: 'Clasificación general', columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: 'Águilas', valores: { puntos: 12 } }] }] } }
  const { indice, agendas } = construyeIndiceDeportes([c], [], Date.now())
  await page.route('**/deportes/**', async route => {
    const u = new URL(route.request().url()), zona = u.searchParams.get('horario') === 'canarias' ? 'canarias' : 'madrid', nonce = 'prueba-deportes'
    if (!u.pathname.startsWith('/deportes/')) return route.continue()
    let body: string
    if (u.pathname.includes('/competicion/')) body = buildCompeticionDeportesPage(c, nonce, u.origin + u.pathname, u, zona)
    else {
      const q = u.searchParams.get('q') || '', fecha = u.searchParams.get('fecha') || dia
      body = buildDeportesPage({ indice, competiciones: filtraCompeticiones(indice.competiciones, { q }), eventos: agendas[zona + '/' + fecha] || [], url: u, zonaHoraria: zona, dia: fecha, pagina: 1, paginaAgenda: 1, q, zona: '', categoria: '' }, nonce, u.origin + u.pathname)
    }
    await route.fulfill({ status: 200, headers: pageHeaders(nonce, false), body })
  })
}
test.describe('presentación de deportes con casos controlados', () => {
  test.beforeEach(async ({ page }, info) => { test.skip(!!info.config.metadata.live, 'La producción se recorre sin sustituir sus datos'); await presentacion(page) })
  test('móvil: favoritos, formulario y enlace a clasificación funcionan', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/deportes/')
    await page.getByRole('button', { name: 'Seguir Liga de prueba', exact: true }).click()
    await page.locator('#favoritos summary').click()
    await expect(page.locator('#favoritos-lista')).toContainText('Liga de prueba')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Dejar de seguir Liga de prueba', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.locator('.filters-panel summary').click()
    await page.getByLabel('Equipo, piloto o competición').fill('aguilas')
    await page.getByRole('button', { name: 'Aplicar filtros' }).click()
    await expect(page).toHaveURL(/q=aguilas/)
    await expect(page.locator('#competiciones')).toContainText('Liga de prueba')
    await page.locator('#competiciones h3 a').click()
    await page.getByRole('link', { name: 'Clasificación', exact: true }).click()
    await expect(page.getByRole('table')).toContainText('Águilas')
    await expect(page.getByRole('table')).toContainText('12')
    await page.getByRole('link', { name: 'Resultados', exact: true }).click()
    await expect(page.locator('.score')).toHaveText(['1', '2'])
  })
  test('presentación legible a 320 y 390 píxeles, sin errores ni problemas de accesibilidad', async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message))
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      for (const ruta of ['/deportes/', '/deportes/competicion/liga-prueba']) {
        await page.goto(ruta)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await page.locator('[style]').count()).toBe(0)
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      }
    }
    expect(errors).toEqual([])
  })
  test.describe('sin JavaScript', () => {
    test.use({ javaScriptEnabled: false })
    test('se puede cambiar hora y ver el resultado oficial', async ({ page }) => {
      await page.goto('/deportes/competicion/liga-prueba')
      await page.getByLabel('Hora local').selectOption('canarias')
      await page.getByRole('button', { name: 'Cambiar horario' }).click()
      await expect(page).toHaveURL(/horario=canarias/)
      const hora = new Intl.DateTimeFormat('es-ES', { timeZone: 'Atlantic/Canary', hour: '2-digit', minute: '2-digit' }).format(new Date(diaDeporte(Date.now()) + 'T17:30:00Z'))
      await expect(page.locator('.event-time').first()).toHaveText(hora)
      await page.getByRole('link', { name: 'Resultados', exact: true }).click()
      await expect(page.locator('.score')).toHaveText(['1', '2'])
    })
  })
})
test('deportes: recorrido real por la copia publicada, navegación y filtros', async ({ page }, info) => {
  const r = await page.request.get('/data/deportes/index.json')
  if (r.status() === 404 && !info.config.metadata.live) {
    // El código se publica antes de la primera PR automática de datos.
    const vacia = await page.goto('/deportes/')
    expect(vacia?.status()).toBe(503)
    await expect(page.locator('main')).toContainText('preparando los datos')
    return
  }
  expect(r.ok()).toBe(true)
  const indice = await r.json() as IndiceDeportes
  expect(indice.competiciones.length).toBeGreaterThan(0)
  for (const deporte of ['futbol', 'baloncesto', 'motor']) {
    const result = await page.goto('/deportes/' + deporte)
    expect(result?.status()).toBe(200)
    await expect(page.locator('#competiciones .card').first()).toBeVisible()
    const c = indice.competiciones.find(x => x.deporte === deporte && x.clasificacion.total > 0)!
    expect(c).toBeTruthy()
    await page.goto('/deportes/competicion/' + c.id)
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(c.nombre)
    await expect(page.locator('#clasificacion table').first()).toBeAttached()
    await expect(page.locator('main')).toContainText('Comprobado:')
  }
  await page.goto('/deportes/')
  await page.locator('.filters-panel summary').click()
  const nombre = indice.competiciones[0].nombre
  await page.getByLabel('Equipo, piloto o competición').fill(nombre)
  await page.getByRole('button', { name: 'Aplicar filtros' }).click()
  await expect(page.locator('#competiciones h3').first()).toHaveText(nombre)
})
