import { describe, it, expect, vi } from 'vitest'
import { buildGasolinerasLanding } from '../src/html/gasolineras'

const towns = [
  { n: 'Humanes de Madrid', p: 'Madrid', u: '/humanes' },
  { n: 'Madrid', p: 'Madrid', u: '/madrid' },
  { n: 'Madridejos', p: 'Toledo', u: '/madridejos' },
]
function element() {
  return {
    value: '', hidden: true, innerHTML: '', textContent: '', disabled: false,
    listeners: {} as Record<string, (event?: unknown) => void>,
    addEventListener(name: string, callback: (event?: unknown) => void) { this.listeners[name] = callback },
    setAttribute: vi.fn(), classList: { toggle: vi.fn() }, contains: () => false,
    querySelectorAll: () => [],
  }
}
function boot(fetch = vi.fn(async () => ({ ok: true, json: async () => towns }))) {
  const input = element(), box = element(), geo = element(), status = element()
  const elements: Record<string, ReturnType<typeof element>> = { q: input, sugs: box, 'btn-geoloc': geo, 'geo-status': status }
  const location = { href: '' }
  const geolocation = { getCurrentPosition: vi.fn() }
  const html = buildGasolinerasLanding('landing-test')
  const script = html.match(/<script nonce="landing-test">([\s\S]*?)<\/script>/)![1]
  new Function('fetch', 'window', 'navigator', 'document', script)(
    fetch, { location }, { geolocation },
    { getElementById: (id: string) => elements[id], addEventListener: vi.fn() },
  )
  return { input, box, geo, status, fetch, location, geolocation, html }
}
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('buscador real de la portada de gasolineras', () => {
  it('da prioridad al municipio exacto sobre nombres que solo contienen el texto', async () => {
    const ui = boot()
    ui.input.value = '  MADRID '
    ui.input.listeners.input()
    await flush()
    expect(ui.box.innerHTML.indexOf('href="/madrid"')).toBeLessThan(ui.box.innerHTML.indexOf('href="/madridejos"'))
    expect(ui.box.innerHTML.indexOf('href="/madridejos"')).toBeLessThan(ui.box.innerHTML.indexOf('href="/humanes"'))
  })

  it.each(['http', 'network'])('permite volver a buscar tras un fallo %s y no dice que el municipio no existe', async mode => {
    const fetch = vi.fn().mockImplementationOnce(() => mode === 'http'
      ? Promise.resolve({ ok: false }) : Promise.reject(new Error('sin conexión')))
      .mockResolvedValue({ ok: true, json: async () => towns })
    const ui = boot(fetch)
    ui.input.value = 'Madrid'
    ui.input.listeners.input()
    await flush()
    expect(ui.box.innerHTML).toContain('reintentar')
    expect(ui.box.innerHTML).not.toContain('No encontramos')
    ui.input.listeners.input()
    await flush()
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(ui.box.innerHTML).toContain('href="/madrid"')
  })

  it('comparte una descarga mientras el usuario escribe', async () => {
    const ui = boot()
    ui.input.listeners.focus()
    ui.input.value = 'Madrid'
    ui.input.listeners.input()
    ui.input.listeners.input()
    await flush()
    expect(ui.fetch).toHaveBeenCalledTimes(1)
    expect(ui.box.innerHTML).toContain('href="/madrid"')
  })

  it('lleva el GPS al mapa sin municipio equivocado ni coordenadas enviadas al servidor', () => {
    const ui = boot()
    ui.geo.listeners.click()
    const success = ui.geolocation.getCurrentPosition.mock.calls[0][0] as (p: unknown) => void
    success({ coords: { latitude: 40.473861, longitude: -3.624556 } })
    const url = new URL(ui.location.href, 'https://webapp-3ft.pages.dev')
    expect(url.pathname).toBe('/gasolineras/mapa')
    expect(url.search).toBe('')
    expect(url.hash).toBe('#near=40.47386,-3.62456')
    expect(ui.fetch).not.toHaveBeenCalled()
  })

  it('ofrece un solo buscador y no promete rutas ni una búsqueda que ignora el texto', () => {
    const { html } = boot()
    expect(html).not.toContain('id="municipio-form"')
    expect(html).not.toContain('SearchAction')
    expect(html).not.toContain('planifica una ruta')
  })
})
