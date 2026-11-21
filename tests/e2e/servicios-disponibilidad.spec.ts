import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { APARCAMIENTOS_MAPA } from '../../scripts/lib/aparcamientos-ui.mjs'
import { disponibilidadProximoDiario } from '../../scripts/lib/disponibilidad.mjs'
const TOKEN = 'fixture-disponibilidad-no-es-credencial', version = '10000000-0000-4000-8000-000000000001'
async function fixture(page: Page, linked = true, bici = false) {
  const now = Date.now(), iso = (n = 0) => new Date(now + n).toISOString(), place = { id: bici ? 'gbfs-zaragoza-100' : 'parking-madrid-72', nombre: bici ? 'Estación Bizi de prueba' : 'Aparcamiento de prueba', lat: bici ? 41.65 : 40.4168, lon: bici ? -.88 : -3.7038 }
  const source = APARCAMIENTOS_MAPA[0]
  const state = { available: true, manageable: true, confirmed: false, failure: 0, avisos: [] as any[], changes: [] as any[], links: [] as any[], errors: [] as string[] }
  page.on('pageerror', error => state.errors.push(error.message))
  if (linked) await page.addInitScript(token => localStorage.setItem('gs_tg_auth_v1', token), TOKEN)
  await page.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname
    if (path === '/api/me') return route.fulfill({ json: { user: null } })
    if (path === '/api/auth/config') return route.fulfill({ json: { available: false, syncAvailable: false } })
    const town = { ine: bici ? '50297' : '28079', nombre: bici ? 'Zaragoza' : 'Madrid', provinciaNombre: bici ? 'Zaragoza' : 'Madrid', lat: place.lat, lng: place.lon, servicios: [] }
    if (path === '/api/localidad/' + town.ine) return route.fulfill({ json: town })
    if (path === '/api/localidades') return route.fulfill({ json: [town] })
    if (path === '/api/servicios/categorias') return route.fulfill({ json: { total: 1, categorias: [{ id: 'banos', nombre: 'Baños', grupo: 'cotidiano', grupoNombre: 'Día a día', total: 1 }] } })
    if (path === '/api/servicios') return route.fulfill({ json: { items: [], siguientePagina: null } })
    if (path === '/api/aparcamientos/madrid') return route.fulfill({ json: { fuenteId: 'madrid', nombre: 'Madrid', consultado: iso(), evaluadoEn: iso(), catalogoConsultado: iso(), fechaDatos: null,
      fuenteUrl: source.fuenteUrl, licenciaUrl: source.licenciaUrl, atribucion: source.atribucion, estado: 'actual', total: 1, conDisponibilidad: 1, warnings: [], items: [{ ...place, direccion: 'Dirección de prueba', capacidad: 100, plazasPmr: 4, horarioTexto: null, fechaFicha: null, detalleConsultado: iso(), gratis: null, disuasorio: null, fuenteUrl: source.fuenteUrl, plazasLibres: 0, fechaOcupacion: iso(), caduca: iso(300000), estado: 'actual' }] } })
    if (path === '/api/bicis/zaragoza') return route.fulfill({ json: { schema: 1, red: 'Bizi Zaragoza', redId: 'zaragoza', consultado: iso(), directorioConsultado: iso(), fechaDatos: iso(), evaluadoEn: iso(), caduca: iso(300000), estado: 'actual', fuenteUrl: 'https://bizi.zaragoza.es/es/mapa-de-disponibilidad', total: 1, warnings: [], items: [{ ...place, capacidad: 20, bicis: 0, anclajes: 20, estado: 'operativa', actualizado: iso(), caduca: iso(300000), permiteAlquiler: true, permiteDevolucion: true }] } })
    if (path === '/api/telegram/disponibilidad/config') return route.fulfill({ json: { available: state.available, manageAvailable: state.manageable, linkAvailable: true } })
    if (path === '/api/telegram/start-link') { state.links.push(req.postDataJSON()); return route.fulfill({ json: { ok: true, token: 'a'.repeat(32), deepLink: 'https://t.me/Fixture?start=' + 'a'.repeat(32) } }) }
    if (path === '/api/telegram/confirm') return route.fulfill({ json: state.confirmed ? { ok: true, confirmed: true, auth: TOKEN } : { ok: true, confirmed: false } })
    if (path.startsWith('/api/telegram/disponibilidad')) {
      expect(req.headers().authorization).toBe('Bearer ' + TOKEN)
      if (req.method() !== 'GET') state.changes.push({ method: req.method(), path, body: req.postData() ? req.postDataJSON() : null })
      if (state.failure) return route.fulfill({ status: state.failure, json: { ok: false, error: 'source_unavailable' } })
      const mode = path.split('/').at(-1)
      if (req.method() === 'PUT') { const body = req.postDataJSON(); state.avisos = state.avisos.filter(a => a.modo !== mode); state.avisos.push({ modo: mode, activo: true, estado: 'programado', nombre: place.nombre, hora: body.hora || null, hasta: mode === 'temporal' ? iso(3600000) : null, proxima: mode === 'diario' ? new Date(disponibilidadProximoDiario(body.hora, now)).toISOString() : iso(1000) }) }
      if (req.method() === 'DELETE') state.avisos = state.avisos.filter(a => a.modo !== mode)
      return route.fulfill({ json: { ok: true, version, avisos: state.avisos } })
    }
    if (req.method() !== 'GET') throw Error('Mutación inesperada: ' + path)
    return route.fulfill({ status: 503, json: {} })
  })
  await page.route('https://t.me/**', route => route.fulfill({ contentType: 'text/html', body: '<title>Telegram simulado</title>' }))
  return { state, place, category: bici ? 'bicis-zaragoza' : 'aparcamientos-madrid' }
}
async function ready(page: Page, category: string) {
  await page.goto('/cerca?categorias=' + category)
  if (page.viewportSize()!.width < 1024) await page.getByRole('button', { name: 'Ver lista y filtros', exact: true }).click()
  const card = page.locator('.sv-card').first(); await expect(card).toBeVisible()
  await card.getByRole('button', { name: 'Avisarme por Telegram', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Avisos de disponibilidad' })).toBeVisible()
}
test.beforeEach(async ({}, info) => { test.skip(info.config.metadata.live === true, 'Sólo fuentes y Telegram simulados.') })
for (const width of [390, 1280]) test('ambos permisos y cancelación independiente son claros a ' + width, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); const f = await fixture(page); await ready(page, f.category)
  const dialog = page.getByRole('dialog'), save = dialog.getByRole('button', { name: 'Activar aviso', exact: true }), consent = page.locator('#sv-availability-consent')
  await expect(save).toBeDisabled(); expect(f.state.changes).toEqual([]); await expect(dialog).toContainText('No sabemos cuántas plazas PMR están libres')
  await dialog.screenshot({ path: info.outputPath('disponibilidad-inicial-' + width + '.png') })
  await consent.check(); await expect(save).toBeEnabled(); await save.click()
  await expect(dialog.getByRole('status')).toContainText('Aviso activado'); await expect(consent).not.toBeChecked()
  expect(f.state.changes[0].body).toMatchObject({ fuente: f.category, lugarId: f.place.id, objetivo: 'plazas', consentimiento: 'disponibilidad-telegram-v1', version })
  expect(Object.keys(f.state.changes[0].body).sort()).toEqual(['consentimiento', 'fuente', 'lugarId', 'objetivo', 'peticion', 'version'])
  await page.locator('#sv-availability-mode').selectOption('diario'); await expect(dialog).toContainText('incluido cero'); await expect(consent).not.toBeChecked()
  await page.locator('#sv-availability-hour').fill('18:45'); await consent.check(); await save.click()
  await expect(dialog).toContainText('18:45'); expect(f.state.changes[1].body.hora).toBe('18:45'); expect(f.state.avisos).toHaveLength(2)
  expect((await new AxeBuilder({ page }).include('.sv-availability-dialog').analyze()).violations).toEqual([])
  expect(await dialog.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true)
  await dialog.screenshot({ path: info.outputPath('disponibilidad-' + width + '.png') })
  await dialog.locator('section').filter({ hasText: 'Tu aviso de una hora' }).getByRole('button', { name: 'Cancelar sólo este aviso' }).click()
  await expect(dialog.getByRole('status')).toContainText('Tus avisos de precios e ITV siguen igual'); expect(f.state.avisos.map(a => a.modo)).toEqual(['diario']); expect(f.state.errors).toEqual([])
})
test('Bizi permite elegir anclajes sin mandar stock ni GPS', async ({ page }) => {
  const f = await fixture(page, true, true); await ready(page, f.category)
  await page.locator('#sv-availability-objective').selectOption('anclajes'); await page.locator('#sv-availability-consent').check(); await page.getByRole('button', { name: 'Activar aviso', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Aviso activado')
  expect(f.state.changes[0].body.objetivo).toBe('anclajes'); expect(f.state.changes[0].body).not.toHaveProperty('cantidad'); expect(f.state.changes[0].body).not.toHaveProperty('lat')
})
test('vincular sin Google no activa disponibilidad, gasolina ni ITV', async ({ page }) => {
  const f = await fixture(page, false); await ready(page, f.category)
  await page.getByRole('button', { name: 'Vincular Telegram', exact: true }).click()
  await expect(page.getByRole('link', { name: 'Abrir Telegram y pulsar Iniciar' })).toHaveAttribute('href', /^https:\/\/t.me\/Fixture\?start=a+$/)
  expect(f.state.links).toEqual([{ favs: [] }]); f.state.confirmed = true
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('Telegram vinculado')
  expect(f.state.changes).toEqual([]); await expect(page.getByRole('button', { name: 'Activar aviso', exact: true })).toBeDisabled()
})
test('error de fuente no confirma alta ni elimina el permiso anterior', async ({ page }) => {
  const f = await fixture(page); await ready(page, f.category); f.state.failure = 503
  await page.locator('#sv-availability-consent').check(); await page.getByRole('button', { name: 'Activar aviso', exact: true }).click()
  await expect(page.getByRole('dialog').getByRole('status')).toContainText('El aviso anterior se conserva')
  await expect(page.getByRole('button', { name: 'Activar aviso', exact: true })).toBeDisabled()
})
test('sin binding configurado no ofrece una acción vacía', async ({ page }) => {
  const f = await fixture(page); f.state.available = false; f.state.manageable = false
  await page.goto('/cerca?categorias=' + f.category); await expect(page.locator('.sv-card').first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Avisarme por Telegram' })).toHaveCount(0); expect(f.state.changes).toEqual([])
})

test('el botón global permite cancelar un aviso aunque las altas estén pausadas', async ({ page }) => {
  const f = await fixture(page); f.state.available = false
  f.state.avisos = [{ modo: 'temporal', nombre: 'Lugar que ya no aparece en el mapa', activo: true, estado: 'programado' }]
  await page.goto('/cerca')
  await page.getByRole('button', { name: 'Gestionar mis avisos de disponibilidad', exact: true }).click()
  const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Las nuevas altas y los envíos están pausados')
  await expect(dialog).toContainText('Lugar que ya no aparece en el mapa')
  await expect(dialog.getByRole('button', { name: 'Activar aviso', exact: true })).toBeHidden()
  await dialog.getByRole('button', { name: 'Cancelar sólo este aviso', exact: true }).click()
  await expect(dialog.getByRole('status')).toContainText('Aviso cancelado'); expect(f.state.avisos).toEqual([])
})

// Se retrasa sólo la lectura del JSON de una respuesta simulada. Esto reproduce
// el cambio de sesión después de recibir cabeceras, sin ninguna red real.
async function gateBody(page: Page, path: string) {
  await page.addInitScript(target => {
    const original = window.fetch, state = window as any
    state.__bodyHeld = false; state.__bodyReleased = false
    window.fetch = async (...args) => {
      const response = await original(...args)
      if (!state.__bodyHeld && new URL(response.url).pathname === target) {
        const json = response.json.bind(response)
        response.json = async () => {
          const body = await json()
          state.__bodyHeld = true
          await new Promise<void>(resolve => { state.__releaseBody = resolve })
          state.__bodyReleased = true; return body
        }
      }
      return response
    }
  }, path)
}

test('cambiar de chat durante la lectura del cuerpo no muestra datos de la cuenta anterior', async ({ page }) => {
  const f = await fixture(page), other = 'fixture-segundo-chat-sin-credencial'
  await gateBody(page, '/api/telegram/disponibilidad')
  const reads: string[] = []
  await page.route('**/api/telegram/disponibilidad', async route => {
    const token = route.request().headers().authorization; reads.push(token)
    expect([TOKEN, other].map(x => 'Bearer ' + x)).toContain(token)
    return route.fulfill({ json: { ok: true, version, avisos: [{ modo: 'diario', nombre: token.endsWith(other) ? 'Lugar del segundo chat' : 'Lugar privado del primer chat', estado: 'programado', activo: true, hora: '19:00' }] } })
  })
  await ready(page, f.category); await page.waitForFunction(() => (window as any).__bodyHeld)
  await page.evaluate(token => { localStorage.setItem('gs_tg_auth_v1', token); window.dispatchEvent(new StorageEvent('storage', { key: 'gs_tg_auth_v1', newValue: token })); (window as any).__releaseBody() }, other)
  await expect(page.getByRole('dialog')).toContainText('Lugar del segundo chat')
  await expect(page.getByRole('dialog')).not.toContainText('Lugar privado del primer chat')
  expect(reads).toEqual(['Bearer ' + TOKEN, 'Bearer ' + other]); expect(f.state.changes).toEqual([])
})

test('cerrar mientras llega la confirmación no guarda un vínculo tardío', async ({ page }) => {
  const f = await fixture(page, false); f.state.confirmed = true
  await gateBody(page, '/api/telegram/confirm'); await ready(page, f.category)
  await page.getByRole('button', { name: 'Vincular Telegram', exact: true }).click()
  await page.waitForFunction(() => (window as any).__bodyHeld)
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar', exact: true }).click()
  await page.evaluate(() => (window as any).__releaseBody())
  await page.waitForFunction(() => (window as any).__bodyReleased)
  await page.locator('.sv-card').first().getByRole('button', { name: 'Avisarme por Telegram', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Vincular Telegram', exact: true })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('gs_tg_auth_v1'))).toBeNull(); expect(f.state.changes).toEqual([])
})
