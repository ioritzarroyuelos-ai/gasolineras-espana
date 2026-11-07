import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildCompeticionDeportesPage, buildDeportesPage } from '../../src/html/deportes'
import { construyeIndiceDeportes, diaDeporte } from '../../scripts/lib/deportes-indice.mjs'
import { filtraCompeticiones, type CompeticionDeportiva, type IndiceDeportes, type Deporte } from '../../src/lib/deportes'
import { pageHeaders } from '../../src/lib/runtime'

// Fixtures solo de presentación. Las rutas y los lectores se prueban también
// por separado; el último recorrido de este archivo utiliza los datos reales.
async function presentacion(page: Page, motor = false, variadas = false) {
  const sello = new Date().toISOString(), dia = diaDeporte(Date.now()), fuente = 'https://federacion.example/calendario'
  const c: CompeticionDeportiva = { id: 'liga-prueba', deporte: 'futbol', nombre: 'Liga de prueba', temporada: '2026-27', categoria: 'Sénior', zona: 'España', fuente: { nombre: 'Fuente de prueba', url: fuente }, comprobadoEn: sello,
    agenda: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, eventos: [
      { id: 'partido', nombre: 'Águilas – Bosque', local: 'Águilas', visitante: 'Bosque', inicio: dia + 'T17:30:00Z', estado: 'programado', fuenteUrl: fuente },
      { id: 'final', nombre: 'Bosque – Águilas', local: 'Bosque', visitante: 'Águilas', fecha: dia, estado: 'finalizado', resultado: { local: 1, visitante: 2 }, fuenteUrl: fuente },
    ] }, clasificacion: { estado: 'actualizado', consultado: sello, verificadoEn: sello, fuenteUrl: fuente, tablas: [{ id: 'tabla', nombre: 'Clasificación general', columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: 'Águilas', valores: { puntos: 12 } }] }] } }
  if (motor) {
    c.deporte = 'motor'; c.nombre = 'Motor de prueba'
    c.agenda.eventos = [{ id: 'carrera-prueba', nombre: 'Carrera de prueba', fecha: dia, estado: 'finalizado', resultados: [{
      id: 'tabla-carrera', nombre: 'Resultado de la carrera', fuenteUrl: fuente, verificadoEn: sello,
      columnas: [{ clave: 'equipo', nombre: 'Equipo' }, { clave: 'tiempo', nombre: 'Tiempo' }, { clave: 'estado', nombre: 'Estado' }],
      filas: Array.from({ length: 22 }, (_, i) => ({ posicion: i === 21 ? null : i + 1, nombre: 'Piloto de prueba ' + (i + 1), valores: { equipo: 'Escudería de prueba', tiempo: i ? '+10.500' : '1:23:45.678', estado: i === 21 ? 'Descalificado' : 'Clasificado' } })),
    }] }]
  }
  const competiciones: CompeticionDeportiva[] = [c]
  if (variadas) {
    const copia = (id: string, deporte: Deporte, nombre: string) => {
      const nueva = { ...structuredClone(c), id, deporte, nombre }
      nueva.agenda.eventos = nueva.agenda.eventos.map(e => ({ ...e, id: id + '-' + e.id }))
      return nueva
    }
    const futbol = copia('laliga-easports', 'futbol', 'LaLiga EA Sports')
    const acb = copia('acb-liga-endesa', 'baloncesto', 'Liga Endesa')
    const nba = copia('nba', 'baloncesto', 'NBA')
    nba.clasificacion.tablas = ['Este', 'Oeste'].map((conferencia, i) => ({ id: 'conferencia-' + i, nombre: 'Conferencia ' + conferencia, columnas: [{ clave: 'ganados', nombre: 'Ganados' }], filas: Array.from({ length: 15 }, (_, n) => ({ posicion: n + 1, nombre: `Equipo ${conferencia} ${n + 1}`, valores: { ganados: 15 - n } })) }))
    const f1 = copia('formula-1', 'motor', 'Fórmula 1')
    f1.clasificacion.tablas = [{ id: 'pilotos', nombre: 'Pilotos', columnas: [{ clave: 'puntos', nombre: 'Puntos' }], filas: [{ posicion: 1, nombre: 'Piloto de prueba', valores: { puntos: 123 } }] }]
    const copa = copia('copa-prueba', 'futbol', 'Copa de prueba')
    copa.clasificacion = { estado: 'no_disponible', consultado: sello, fuenteUrl: fuente, tablas: [], aviso: 'Esta competición se decide por eliminatorias; consulta los resultados oficiales.' }
    const fases = ['regular', 'supercopa'].map(fase => ({ ...copia('feb-lf-endesa-' + fase, 'baloncesto', 'Liga Femenina Endesa'), grupo: fase === 'regular' ? 'Liga regular' : 'Supercopa' }))
    competiciones.splice(0, 1, futbol, acb, nba, f1, copa, ...fases)
  }
  const { indice, agendas } = construyeIndiceDeportes(competiciones, [], Date.now())
  await page.route('**/deportes/**', async route => {
    const u = new URL(route.request().url()), zona = u.searchParams.get('horario') === 'canarias' ? 'canarias' : 'madrid', nonce = 'prueba-deportes'
    if (!u.pathname.startsWith('/deportes/')) return route.continue()
    let body: string
    if (u.pathname.includes('/competicion/')) {
      const seleccion = competiciones.find(c => c.id === u.pathname.split('/').at(-1))
      if (!seleccion) return route.fulfill({ status: 404, body: 'Competición no encontrada' })
      body = buildCompeticionDeportesPage(seleccion, nonce, u.origin + u.pathname, u, zona)
    }
    else {
      const q = u.searchParams.get('q') || '', fecha = u.searchParams.get('fecha') || dia
      const deporte = ['futbol', 'baloncesto', 'motor'].find(d => u.pathname === '/deportes/' + d) as Deporte | undefined
      const territorio = u.searchParams.get('zona') || '', categoria = u.searchParams.get('categoria') || '', genero = u.searchParams.get('genero') || ''
      body = buildDeportesPage({ indice, deporte, competiciones: filtraCompeticiones(indice.competiciones, { q, deporte, zona: territorio, categoria, genero }), eventos: (agendas[zona + '/' + fecha] || []).filter(e => !deporte || e.deporte === deporte), url: u, zonaHoraria: zona, dia: fecha, pagina: Number(u.searchParams.get('p')) || 1, paginaAgenda: Number(u.searchParams.get('a')) || 1, q, zona: territorio, categoria, genero }, nonce, u.origin + u.pathname)
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
    await expect(page.getByLabel('Equipo, piloto o competición')).toBeVisible()
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
      for (const ruta of ['/deportes/', '/deportes/competicion/liga-prueba', '/deportes/competicion/liga-prueba?vista=clasificacion']) {
        await page.goto(ruta)
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width)
        expect(await page.locator('[style]').count()).toBe(0)
        expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
      }
    }
    expect(errors).toEqual([])
  })
  test('motor: el resultado completo abre la carrera y se lee en un móvil estrecho', async ({ page }) => {
    await presentacion(page, true)
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/deportes/')
    await page.getByRole('link', { name: 'Ver resultados de la sesión →', exact: true }).click()
    await expect(page).toHaveURL(/evento=carrera-prueba/)
    await expect(page.locator('.race-results')).toHaveAttribute('open', '')
    await expect(page.locator('.race-results tbody tr')).toHaveCount(22)
    await expect(page.locator('.race-results tbody tr').last()).toContainText('Descalificado')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
    await page.getByLabel('Hora local').selectOption('canarias')
    await page.getByRole('button', { name: 'Cambiar horario' }).click()
    await expect(page).toHaveURL(/evento=carrera-prueba/)
    await expect(page.locator('.race-results table')).toBeVisible()
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
    test('clasificaciones de los tres deportes y búsquedas ACB/F1 funcionan sin JavaScript', async ({ page }) => {
      await presentacion(page, false, true)
      for (const [id, nombre] of [['laliga-easports', 'LaLiga EA Sports'], ['nba', 'NBA'], ['formula-1', 'Fórmula 1']]) {
        await page.goto('/deportes/competicion/' + id + '?vista=clasificacion')
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(nombre)
        await expect(page.locator('#clasificacion table').first()).toBeVisible()
        await expect(page.locator('#calendario')).toHaveCount(0)
        await expect(page.getByRole('navigation', { name: 'Apartados de la competición' }).getByRole('link', { name: 'Clasificación', exact: true })).toHaveAttribute('aria-current', 'page')
        await page.getByRole('navigation', { name: 'Apartados de la competición' }).getByRole('link', { name: 'Resultados', exact: true }).click()
        await expect(page.locator('#calendario')).toBeVisible()
        await expect(page.locator('#clasificacion table').first()).toBeAttached()
      }
      for (const [q, nombre] of [['ACB', 'Liga Endesa'], ['F1', 'Fórmula 1']]) {
        await page.goto('/deportes/')
        await page.getByLabel('Equipo, piloto o competición').fill(q)
        await page.getByRole('button', { name: 'Aplicar filtros' }).click()
        await expect(page.locator('#competiciones h3')).toHaveText([nombre])
        await page.locator('#competiciones .card-links').getByRole('link', { name: 'Clasificación', exact: true }).click()
        await expect(page).toHaveURL(/vista=clasificacion/)
        await expect(page.locator('#clasificacion table').first()).toBeVisible()
      }
    })
  })
  test('principales compactas, filtros abiertos y accesos directos respetan los grupos', async ({ page }) => {
    await presentacion(page, false, true)
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/deportes/')
    await expect(page.locator('.featured-group')).toHaveCount(3)
    await expect(page.locator('.featured [data-fav]')).toHaveCount(0)
    await expect(page.getByLabel('Equipo, piloto o competición')).toBeVisible()
    await expect(page.locator('.filters-panel summary')).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    await page.goto('/deportes/baloncesto')
    await page.locator('.featured').getByRole('link', { name: 'Liga Femenina Endesa', exact: true }).click()
    await expect(page).toHaveURL(/q=Liga%20Femenina%20Endesa/)
    await expect(page.locator('#competiciones .card')).toHaveCount(2)
    await expect(page.locator('.featured')).toHaveCount(0)
    for (const query of ['?zona=España', '?p=2', '?a=2']) {
      await page.goto('/deportes/baloncesto' + query)
      await expect(page.locator('.featured')).toHaveCount(0)
    }
    await page.goto('/deportes/baloncesto')
    const tarjeta = page.locator('#competiciones .card').filter({ has: page.getByRole('heading', { name: 'Liga Endesa', exact: true }) })
    await expect(tarjeta.locator('.card-links a')).toHaveText(['Calendario', 'Resultados', 'Clasificación'])
    await tarjeta.getByRole('link', { name: 'Clasificación', exact: true }).click()
    await expect(page.locator('#calendario')).toHaveCount(0)
    await expect(page.getByRole('table')).toContainText('Águilas')
  })
  test('índice de tablas conserva todos los equipos, anclas únicas y navegación por teclado', async ({ page }) => {
    await presentacion(page, false, true)
    await page.setViewportSize({ width: 320, height: 844 })
    await page.goto('/deportes/competicion/nba?vista=clasificacion')
    await expect(page.locator('#clasificacion table')).toHaveCount(2)
    await expect(page.locator('#clasificacion tbody tr')).toHaveCount(30)
    const oeste = page.getByRole('navigation', { name: 'Grupos y tablas de clasificación' }).getByRole('link', { name: 'Conferencia Oeste', exact: true })
    await oeste.focus(); await page.keyboard.press('Enter')
    const ancla = await oeste.getAttribute('href')
    expect(ancla).toBeTruthy()
    await expect(page.locator(ancla!)).toBeInViewport()
    const ids = await page.locator('[id]').evaluateAll(elements => elements.map(e => e.id))
    expect(new Set(ids).size).toBe(ids.length)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations).toEqual([])
  })
  test('una clasificación vacía explica las eliminatorias sin fabricar una tabla', async ({ page }) => {
    await presentacion(page, false, true)
    await page.goto('/deportes/futbol')
    const tarjeta = page.locator('#competiciones .card').filter({ has: page.getByRole('heading', { name: 'Copa de prueba', exact: true }) })
    await expect(tarjeta).toContainText('Por eliminatorias')
    await tarjeta.getByRole('link', { name: 'Clasificación', exact: true }).click()
    await expect(page.locator('#clasificacion')).toContainText('se decide por eliminatorias')
    await expect(page.locator('#clasificacion table')).toHaveCount(0)
    await expect(page.locator('#clasificacion').getByRole('link', { name: 'Consultar la fuente oficial' })).toHaveAttribute('href', 'https://federacion.example/calendario')
    await expect(page.locator('#calendario')).toHaveCount(0)
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
  await expect(page.getByLabel('Equipo, piloto o competición')).toBeVisible()
  const nombre = indice.competiciones[0].nombre
  await page.getByLabel('Equipo, piloto o competición').fill(nombre)
  await page.getByRole('button', { name: 'Aplicar filtros' }).click()
  await expect(page.locator('#competiciones h3').first()).toHaveText(nombre)
})
