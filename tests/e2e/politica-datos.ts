import { expect, type Page } from '@playwright/test'
import type { EleccionFile } from '../../src/lib/politica-schemas'
import { eleccionPorId } from '../../scripts/lib/politica-catalogo.mjs'
import { enVeda } from '../../scripts/lib/politica-veda.mjs'

// Al confirmarse una convocatoria, el mismo dominio oculta el histórico de esa
// elección durante la veda. Esas fechas también deben pasar las pruebas.
export async function eleccionConHistorico(page: Page): Promise<{ ruta: string; datos: EleccionFile }> {
  const generales = await page.request.get('/data/politica/generales.json')
  expect(generales.ok()).toBe(true)
  const datos: EleccionFile & { veda?: boolean } = await generales.json()
  if (!datos.veda) return { ruta: '/politica/generales', datos }
  expect(datos.sondeos).toHaveLength(0)
  await page.goto('/politica/generales')
  const enPeriodo = enVeda(generales.headers().date || new Date().toISOString(), eleccionPorId('generales')!.proxima)
  if (enPeriodo) await expect(page.locator('.veda')).toContainText('Veda electoral')
  else await expect(page.locator('.aviso')).toContainText('Todavía no hay sondeos')
  await expect(page.locator('.pm-poll,.evsvg')).toHaveCount(0)
  const valenciana = await page.request.get('/data/politica/autonomicas/comunidad-valenciana.json')
  expect(valenciana.ok()).toBe(true)
  return { ruta: '/politica/autonomicas/comunidad-valenciana', datos: await valenciana.json() }
}
