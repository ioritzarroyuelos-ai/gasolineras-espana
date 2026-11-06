import { expect, test } from '@playwright/test'

test('buscador móvil: identifica Madrid ciudad y permite elegir la provincia con el teclado', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 })
  await page.goto('/tiempo/')
  const campo = page.getByRole('combobox', { name: 'Buscar municipio o provincia' })
  await campo.fill('Madrid')
  const opciones = page.getByRole('listbox', { name: 'Sugerencias' }).getByRole('option')
  await expect(opciones.nth(0)).toContainText('Madrid · Municipio')
  await expect(opciones.nth(1)).toContainText('Provincia')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320)

  await campo.press('ArrowDown')
  await expect(opciones.nth(0)).toHaveAttribute('aria-selected', 'true')
  await campo.press('ArrowDown')
  await expect(opciones.nth(0)).toHaveAttribute('aria-selected', 'false')
  await expect(opciones.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(campo).toHaveAttribute('aria-activedescendant', (await opciones.nth(1).getAttribute('id'))!)
  await campo.press('Enter')
  await expect(page).toHaveURL(/\/tiempo\/madrid$/)
  await expect(page.getByRole('main').getByRole('link', { name: 'Madrid', exact: true })).toHaveAttribute('href', '/tiempo/madrid/madrid')
})

test.describe('búsqueda sin JavaScript', () => {
  test.use({ javaScriptEnabled: false })
  test('ofrece los dos municipios llamados Cabanes con sus respectivas provincias', async ({ page }) => {
    await page.goto('/tiempo/')
    const formulario = page.getByRole('search')
    await formulario.getByRole('searchbox', { name: 'Buscar municipio o provincia' }).fill('Cabanes')
    await formulario.getByRole('button', { name: 'Buscar' }).click()
    await expect(page).toHaveURL(/\/tiempo\/buscar\?q=Cabanes$/)
    const resultados = page.getByRole('main')
    await expect(resultados.getByRole('link', { name: /Cabanes.*Castellón/ })).toHaveAttribute('href', '/tiempo/castellon/cabanes')
    await expect(resultados.getByRole('link', { name: /Cabanes.*Girona/ })).toHaveAttribute('href', '/tiempo/girona/cabanes')
  })
})
