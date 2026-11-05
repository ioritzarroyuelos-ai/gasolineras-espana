import { expect, test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Sondeos sin JavaScript', () => {
  test.use({ javaScriptEnabled: false })

  test('móvil: muestra tres partidos, abre los demás y cambia la referencia de escaños', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 })
    await page.goto('/politica/generales')
    const ficha = page.locator('.pm-poll').first()
    const visibles = ficha.locator('.pm-inner > .pm-rows > li')
    await expect(page.locator('.pm-poll[open]')).toHaveCount(1)
    await expect(visibles).toHaveCount(3)
    await expect(page.locator('.pm-table')).toBeHidden()
    await expect(page.getByRole('link', { name: 'Encuesta anterior', exact: true })).toHaveAttribute('aria-current', 'true')
    const actuales = await visibles.locator('strong').allTextContents()
    const votos = await ficha.locator('b small').allTextContents()
    const otros = ficha.locator('.pm-extra')
    await expect(otros.locator('li').first()).toBeHidden()
    await otros.locator('summary').click()
    await expect(otros.locator('li').first()).toBeVisible()

    await page.getByRole('link', { name: /^Elecciones del / }).click()
    await expect(page).toHaveURL(/[?&]referencia=elecciones\b/)
    await expect(ficha.locator('.pm-ref')).toContainText('Elecciones del')
    expect(await visibles.locator('strong').allTextContents()).toEqual(actuales)
    expect(await ficha.locator('b small').allTextContents()).toEqual(votos)
    // El partido y su número se obtienen del resultado de la elección de esta
    // misma página. Las encuestas y los escaños podrán cambiar con el robot.
    const partido = await visibles.first().locator('b').evaluate(b => b.firstChild!.textContent!)
    const oficial = page.locator('.leyenda-res .it').filter({ hasText: partido + ' ' }).first()
    const base = await oficial.locator('b').innerText()
    await expect(visibles.first().locator(':scope > small')).toHaveText('Elecciones · ' + base)
    await page.getByRole('link', { name: 'Encuesta anterior', exact: true }).click()
    await expect(page.getByRole('link', { name: 'Encuesta anterior', exact: true })).toHaveAttribute('aria-current', 'true')
    await expect(ficha.locator('.pm-ref')).not.toContainText('Elecciones del')
    await expect(page.locator('.evsvg')).toBeVisible()
    await expect(page.locator('.ev-explorar')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  })

  test('ordenador: cada fila enlaza a su ficha y el teclado abre una cerrada con sus cifras base', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 })
    await page.goto('/politica/generales?referencia=elecciones')
    const tabla = page.getByRole('table', { name: 'Escaños por encuesta y partido' })
    await expect(tabla).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Escaños estimados por encuesta' })).toBeVisible()
    const marco = page.getByRole('region', { name: 'Comparar los escaños por encuesta y partido' })
    await marco.focus()
    if (await marco.evaluate(el => el.scrollWidth > el.clientWidth)) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => marco.evaluate(el => el.scrollLeft)).toBeGreaterThan(0)
    }
    await page.keyboard.press('ArrowDown')
    await expect.poll(() => marco.evaluate(el => el.scrollTop)).toBeGreaterThan(0)
    await expect(tabla.locator('thead th').first()).toBeInViewport()
    const enlaces = tabla.getByRole('link')
    const referenciasCorrectas = await enlaces.evaluateAll(links => links.every((a, i) => {
      const destino = document.getElementById((a as HTMLAnchorElement).hash.slice(1))
      return destino?.closest('details') === document.querySelectorAll('.pm-poll')[i]
    }))
    expect(referenciasCorrectas).toBe(true)
    const ultima = page.locator('.pm-poll').last()
    await expect(ultima).not.toHaveAttribute('open', '')
    const fila = tabla.locator('tbody tr').last()
    const nombre = await fila.locator('a').innerText()
    await fila.locator('a').focus()
    await page.keyboard.press('Enter')
    await expect(ultima).toHaveAttribute('open', '')
    await expect(ultima.locator('summary').first()).toContainText(nombre)
    await expect(ultima.locator('.pm-ref')).toBeVisible()
    await expect(ultima.locator('.pm-inner > .pm-rows > li > small').first()).toHaveText(/Elecciones · \d+/)
    const otros = ultima.locator('.pm-extra')
    await otros.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(otros.locator('li').first()).toBeVisible()
  })
})

test.describe('Gráfica en una pantalla táctil', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 } })

  test('lee el punto tocado y recorre las encuestas con flechas y teclado', async ({ page }) => {
    await page.goto('/politica/generales')
    const grafica = page.locator('.ev-chart')
    const control = grafica.getByRole('slider', { name: 'Punto del gráfico' })
    const lectura = grafica.locator('.ev-lectura')
    const svg = grafica.locator('.evsvg')
    await svg.scrollIntoViewIfNeeded()
    const puntos = await svg.locator('circle').evaluateAll(circulos => circulos.map(el => {
      const r = el.getBoundingClientRect()
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, texto: el.querySelector('title')!.textContent! }
    }).sort((a, b) => a.x - b.x))
    const elegido = puntos[Math.floor(puntos.length / 2)]
    const x = Math.round(elegido.x), y = Math.round(elegido.y)
    // Algunas encuestas sitúan a dos partidos en el mismo punto. Se acepta
    // cualquiera de los puntos más cercanos al píxel que realmente se toca.
    const distancias = puntos.map(p => Math.hypot(p.x - x, p.y - y))
    const menor = Math.min(...distancias)
    const coincidentes = puntos.filter((_, i) => Math.abs(distancias[i] - menor) < 0.01).map(p => p.texto)
    await page.touchscreen.tap(x, y)
    await expect.poll(async () => coincidentes.includes(await lectura.innerText())).toBe(true)
    await control.focus()
    await page.keyboard.press('Home')
    await expect(lectura).toHaveText(puntos[0].texto)
    await grafica.getByRole('button', { name: 'Punto siguiente' }).click()
    await expect(lectura).toHaveText(puntos[1].texto)
    await control.focus()
    await page.keyboard.press('End')
    await expect(lectura).toHaveText(puntos.at(-1)!.texto)
    await expect(control).toHaveAttribute('aria-valuetext', puntos.at(-1)!.texto)
    const accesibilidad = await new AxeBuilder({ page }).include('#sondeos').include('.ev-chart').withTags(['wcag2a', 'wcag2aa']).analyze()
    expect(accesibilidad.violations.filter(v => v.impact === 'serious' || v.impact === 'critical')).toEqual([])
  })
})
