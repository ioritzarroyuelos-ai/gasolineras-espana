import { test, expect } from '@playwright/test'
import { buildGuardiaMunicipioPage, guardiaHeaders } from '../../src/html/guardia-municipio'
import { parseGuardias, type GuardiasFile } from '../../src/lib/guardias'

// Estas tres pruebas verifican la interacción con el HTML y CSP reales.
// Datos sintéticos y reloj inyectado evitan depender del día en que se descargó
// Madrid. La última prueba de este archivo sí consulta los datos publicados.
test.describe('Turnos con datos de prueba', () => {
  test.beforeEach(async ({ page }) => {
    const ahora = new Date('2026-11-07T11:00:00Z')
    const datos: GuardiasFile = {
      ts: ahora.toISOString(), source: 'cofm.es', territorio: 'madrid', coordenadasOficiales: true,
      guardias: [
        [40.47, -3.69, 'Farmacia de prueba lejana', 'Madrid', '910000001', '28001', '2026-11-07 10:00-2026-11-07 15:00', 'Turno de prueba'],
        [40.42, -3.71, 'Farmacia de prueba de tarde', 'Madrid', '910000002', '28001', '2026-11-07 18:00-2026-11-07 23:00', 'Turno de prueba'],
        [40.417, -3.704, 'Farmacia de prueba cercana', 'Madrid', '910000003', '28001', '2026-11-07 09:30-2026-11-08 09:30', 'Turno de prueba de 24 h'],
      ],
    }
    await page.route(/\/farmacias\/madrid\/madrid(?:\?.*)?$/, async route => {
      const url = new URL(route.request().url())
      const pedido = url.searchParams.get('turno')
      const turno = pedido === 'ahora' || pedido === '24h' ? pedido : 'todas'
      const nonce = 'guardias-e2e'
      const body = buildGuardiaMunicipioPage(nonce, {
        provinciaSlug: 'madrid', provinciaName: 'Madrid', municipioSlug: 'madrid', municipioName: 'Madrid',
        guardias: parseGuardias(datos, ahora), otrosMunicipios: [], actualizado: datos.ts,
        fuente: datos.source, metadatos: datos, canonical: url.origin + url.pathname, turno, ahora,
      })
      await route.fulfill({ status: 200, headers: guardiaHeaders(nonce), body })
    })
  })

test('filtra turnos y permite volver a todos sin perder teléfono ni fuente', async ({ page }) => {
  await page.goto('/farmacias/madrid/madrid')
  const total = await page.locator('.g-card').count()
  expect(total).toBe(3)
  await page.getByRole('link', { name: 'Abierta ahora', exact: true }).click()
  await expect(page).toHaveURL(/turno=ahora/)
  await expect(page.getByRole('link', { name: 'Abierta ahora', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.g-card')).toHaveCount(2)
  await expect(page.getByText(/Horarios a las \d{2}:\d{2} \(hora local\)/)).toBeVisible()
  for (const estado of await page.locator('.g-card .g-tipo').allTextContents()) expect(estado).toContain('De guardia ahora')
  await page.getByRole('link', { name: 'Turno de 24 h', exact: true }).click()
  await expect(page.locator('.g-card')).toHaveCount(1)
  await expect(page.locator('.g-card')).toContainText('Farmacia de prueba cercana')
  await page.getByRole('link', { name: 'Todos los turnos', exact: true }).click()
  await expect(page.locator('.g-card')).toHaveCount(total)
  await expect(page.locator('.g-card a[href^="tel:"]').first()).toBeVisible()
  await expect(page.getByRole('link', { name: /Consultar la fuente oficial/ })).toBeVisible()
})

test('ordena distancias con permiso y no guarda la ubicación', async ({ page, context }) => {
  await context.setGeolocation({ latitude: 40.4168, longitude: -3.7038, accuracy: 30 })
  await context.grantPermissions(['geolocation'])
  await page.goto('/farmacias/madrid/madrid')
  await page.waitForFunction(() => Boolean((window as any).EUCuenta))
  await page.evaluate(() => (window as any).EUCuenta.ready)
  const storageBefore = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))
  await page.getByRole('button', { name: 'Ordenar por cercanía' }).click()
  await expect(page.locator('#g-ubicacion')).toContainText('Ordenadas por distancia')
  const distances = (await page.locator('.g-distancia').allTextContents()).map(s => parseFloat(s))
  expect(distances.length).toBe(3)
  expect(distances).toEqual([...distances].sort((a,b) => a-b))
  await expect(page.locator('.g-card .g-dir')).toHaveText([
    'Farmacia de prueba cercana', 'Farmacia de prueba de tarde', 'Farmacia de prueba lejana',
  ])
  // La cuenta ya puede tener preferencias. Ordenar por ubicación no debe
  // añadir coordenadas ni cambiar ninguna entrada guardada del navegador.
  expect(await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])))).toEqual(storageBefore)
})

test('denegar ubicación conserva la lista y permite reintentar', async ({ page, context }) => {
  const cdp = await context.newCDPSession(page)
  await cdp.send('Browser.setPermission', { permission: { name: 'geolocation' }, setting: 'denied', origin: String(test.info().project.use.baseURL) })
  await page.goto('/farmacias/madrid/madrid')
  const total = await page.locator('.g-card').count()
  await page.getByRole('button', { name: 'Ordenar por cercanía' }).click()
  await expect(page.locator('#g-ubicacion')).toContainText('No se pudo obtener')
  await expect(page.locator('.g-card')).toHaveCount(total)
  await expect(page.getByRole('button', { name: 'Ordenar por cercanía' })).toBeEnabled()
})
})

test('Madrid con datos publicados: muestra turnos vigentes o avisa de que no hay un turno confirmado', async ({ page }, info) => {
  const respuesta = await page.goto('/farmacias/madrid/madrid')
  expect(respuesta?.status()).toBe(200)
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Madrid')
  await expect(page.getByRole('link', { name: /Consultar.*fuente oficial/ })).toHaveAttribute(
    'href', 'https://www.cofm.es/es/buscador-de-farmacias/',
  )
  const total = await page.locator('.g-card').count()
  if (total === 0) {
    await expect(page.getByText('Hoy no tenemos un turno confirmado en Madrid.', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Abierta ahora', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ordenar por cercanía' })).toHaveCount(0)
    info.annotations.push({ type: 'datos publicados', description: 'Sin turnos vigentes: se ha validado el aviso y el enlace oficial, no la disponibilidad de guardias.' })
  } else {
    await expect(page.locator('.g-total')).toContainText(String(total))
    await expect(page.getByText('Hoy no tenemos un turno confirmado en Madrid.', { exact: true })).toHaveCount(0)
    await expect(page.locator('.g-card a[href^="tel:"]').first()).toBeVisible()
    info.annotations.push({ type: 'datos publicados', description: total + ' turnos visibles; las pruebas de interacción utilizan los datos de prueba de este archivo.' })
  }
})
