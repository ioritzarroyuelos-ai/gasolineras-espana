import { test, expect } from '@playwright/test'
import { build } from 'esbuild'
const NOW = Date.parse('2026-11-21T10:00:00Z'), iso = (n = NOW) => new Date(n).toISOString()
const scripts: Record<string, string> = {}
test.beforeAll(async () => { for (const name of ['servicios', 'cuenta']) scripts[name] = (await build({ entryPoints: ['src/client/' + name + '.js'], bundle: true, write: false, format: 'iife', target: 'es2020' })).outputFiles[0].text })
for (const kind of ['metro', 'camara']) test('favorito ' + kind + ' guarda sólo ubicación y comprueba que aún existe al abrirlo', async ({ page }, info) => {
  test.skip(info.config.metadata.live === true, 'Favoritos anónimos y respuestas locales de prueba.')
  await page.setViewportSize({ width: 1280, height: 900 }); await page.clock.install({ time: NOW })
  const metro = kind === 'metro', id = metro ? 'metro-bilbao-7' : 'camara-sct-test001', category = metro ? 'metro-bilbao' : 'camaras-cataluna'
  const town = metro ? { ine: '48020', nombre: 'Bilbao', provinciaNombre: 'Bizkaia', lat: 43.26, lng: -2.93, servicios: [] } : { ine: '08019', nombre: 'Barcelona', provinciaNombre: 'Barcelona', lat: 41.385, lng: 2.17, servicios: [] }
  const name = metro ? 'Abando' : 'Cámara de prueba', api = metro ? '/api/transporte/metro-bilbao' : '/api/camaras/cataluna'
  let missing = false, requests = 0; const mutations: string[] = [], errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  for (const [name, body] of Object.entries(scripts)) await page.route('**/static/' + name + '.js?*', route => route.fulfill({ contentType: 'text/javascript', body }))
  await page.route('**/api/**', async route => {
    const u = new URL(route.request().url())
    if (route.request().method() !== 'GET') { mutations.push(u.pathname); return route.fulfill({ status: 405, json: {} }) }
    if (['/api/me', '/api/auth/me'].includes(u.pathname)) return route.fulfill({ json: { user: null } })
    if (u.pathname === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    if (u.pathname === '/api/servicios/categorias') return route.fulfill({ json: { categorias: [], total: 0 } })
    if (u.pathname === '/api/servicios/itv') return route.fulfill({ json: { items: [], totalConCoordenadas: 0 } })
    if (u.pathname === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (u.pathname === api) {
      requests++
      const evaluated = NOW + await page.evaluate(() => performance.now())
      const item = metro ? { id, nombre: name, lat: town.lat, lon: town.lng, limitado: false, avisos: [], llegadas: [{ llegada: iso(NOW + 60000), destino: 'Etxebarri', tipo: 'llegada_estimada', fechaParte: iso() }] } : { id, nombre: name, lat: town.lat, lon: town.lng, urlCamara: 'https://mct.gencat.cat/mct2bo/RenderService?sctidcam=test001.gif', fuenteImagen: 'SCT', horaImagen: null }
      return route.fulfill({ json: { schema: 1, redId: 'metro-bilbao', total: missing ? 0 : 1, conCoordenadas: missing ? 0 : 1, evaluadoEn: iso(evaluated), consultado: iso(), fechaDatos: iso(), caduca: iso(NOW + (metro ? 120000 : 108000000)), fechaDirectorio: iso(NOW - 3600000), estado: 'actual', directorioActual: true, warnings: [], avisos: [], items: missing ? [] : [item] } })
    }
    return route.fulfill({ status: 503, json: {} })
  })
  await page.goto('/cerca?municipio=' + town.ine + '&categorias=' + category)
  const card = page.locator('.sv-card[data-servicio="' + id + '"]')
  await card.getByRole('button', { name: 'Guardar favorito: ' + name, exact: true }).click()
  await expect.poll(() => page.evaluate(() => (window as any).EUCuenta.servicios.favoritos())).toEqual([{ id, nombre: name, categoria: category, lat: town.lat, lon: town.lng }])
  const savedUrl = await page.evaluate(() => { const s = (window as any).EUCuenta.servicios; return s.urlFavorito(s.favoritos()[0]) })
  const previous = requests; await page.goto(savedUrl)
  await expect.poll(() => requests).toBeGreaterThan(previous)
  await expect(card).toContainText(name)
  if (metro) await expect(card).toContainText('Hacia Etxebarri'); else await expect(card).toContainText('Hora de imagen sin publicar')
  missing = true; await page.goto(savedUrl)
  await expect(page.locator('#sv-status')).toContainText('ya no aparece con ubicación comprobable')
  await expect(card).toHaveCount(0)
  expect((await page.evaluate(() => (window as any).EUCuenta.servicios.favoritos()))[0]).toEqual({ id, nombre: name, categoria: category, lat: town.lat, lon: town.lng })
  expect(mutations).toEqual([]); expect(errors).toEqual([])
})
