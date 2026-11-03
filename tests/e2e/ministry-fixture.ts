import type { Page, APIRequestContext } from '@playwright/test'

// Prueba el navegador contra la copia que se publica, sin esperar a un ministerio externo.
// E2E_LIVE=1 conserva las consultas reales para las verificaciones de producción.
export async function ministryFixture(page: Page, request: APIRequestContext, live = false) {
  if (live) return
  const [municipios, estaciones] = await Promise.all([
    request.get('/data/municipios.json').then(r => r.json()),
    request.get('/data/stations.json').then(r => r.json()),
  ])
  await page.route('**/api/municipios/*', async route => {
    const provincia = new URL(route.request().url()).pathname.split('/').at(-1) || ''
    await route.fulfill({ json: municipios.Data[provincia] || [] })
  })
  await page.route('**/api/estaciones/**', async route => {
    const segments = new URL(route.request().url()).pathname.split('/')
    const id = segments.at(-1), field = segments.at(-2) === 'provincia' ? 'IDProvincia' : 'IDMunicipio'
    await route.fulfill({ json: { ...estaciones, ListaEESSPrecio: estaciones.ListaEESSPrecio.filter((s: Record<string, string>) => s[field] === id) } })
  })
}
