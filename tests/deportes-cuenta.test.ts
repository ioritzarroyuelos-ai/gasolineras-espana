import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error El cliente se ejecuta aislado en Node, sin añadir sus tipos a la app Worker.
import { createContext, runInContext } from 'node:vm'
import { buildDeportesPage } from '../src/html/deportes'

const key = 'eu-deportes-favoritos-v1'
const favorito = { id: 'competicion:liga-prueba', nombre: 'Liga de prueba', url: '/deportes/competicion/liga-prueba' }
const html = buildDeportesPage({ indice: null, competiciones: [], eventos: [], url: new URL('https://webapp-3ft.pages.dev/deportes/'), zonaHoraria: 'madrid', dia: '2026-11-08', pagina: 1, paginaAgenda: 1, q: '', zona: '', categoria: '' }, 'sports-test', 'https://webapp-3ft.pages.dev/deportes/')
const script = html.match(/<script nonce="sports-test">([\s\S]*?)<\/script>/)![1]

function cliente() {
  const storage = new Map<string, string>()
  const listeners: Record<string, (event?: any) => any> = {}
  const windowListeners: Record<string, (event?: any) => any> = {}
  function element() {
    return {
      dataset: {} as Record<string, string>, hidden: true, textContent: '', href: '',
      attributes: {} as Record<string, string>, children: [] as any[], handlers: {} as Record<string, () => void>,
      setAttribute(name: string, value: string) { this.attributes[name] = value },
      addEventListener(name: string, handler: () => void) { this.handlers[name] = handler },
      append(child: any) { this.children.push(child) },
      replaceChildren() { this.children = [] },
    }
  }
  const button = element()
  button.dataset = { fav: favorito.id, name: favorito.nombre, url: favorito.url }
  const nodes = Object.fromEntries(['favoritos-lista', 'favoritos', 'favoritos-estado', 'favoritos-nota'].map(id => [id, element()]))
  const browser: any = { addEventListener: (name: string, callback: (event?: any) => any) => { windowListeners[name] = callback } }
  const localStorage = { getItem: (k: string) => storage.get(k) ?? null, setItem: vi.fn((k: string, value: string) => { storage.set(k, value) }) }
  const context = createContext({
    window: browser, localStorage,
    document: {
      readyState: 'loading', querySelectorAll: () => [button], getElementById: (id: string) => nodes[id], createElement: element,
      addEventListener: (name: string, callback: (event?: any) => any) => { listeners[name] = callback },
    },
  })
  runInContext(script, context)
  return { browser, storage, localStorage, button, nodes, start: () => listeners.DOMContentLoaded(), event: (name: string, event?: any) => windowListeners[name]?.(event) }
}

describe('favoritos deportivos compartidos con la cuenta', () => {
  it('espera al cliente diferido y a la cuenta antes de leer favoritos', async () => {
    const c = cliente()
    let termina!: () => void
    const changed = vi.fn()
    c.browser.EUCuenta = { user: { sub: 'cuenta-prueba' }, changed, ready: new Promise<void>(resolve => { termina = resolve }) }
    const iniciando = c.start()
    expect(c.button.hidden).toBe(true)
    c.storage.set(key, JSON.stringify([favorito]))
    termina()
    await iniciando
    expect(c.button.hidden).toBe(false)
    expect(c.button.attributes['aria-pressed']).toBe('true')
    expect(c.nodes['favoritos-nota'].textContent).toContain('Inicio')
    expect(changed).not.toHaveBeenCalled()
  })

  it('notifica los cambios explícitos, incluidas listas vacías, y repinta al recuperar otra cuenta', async () => {
    const c = cliente(), changed = vi.fn()
    c.browser.EUCuenta = { user: { sub: 'cuenta-prueba' }, changed, ready: Promise.resolve() }
    await c.start()
    c.button.handlers.click()
    expect(JSON.parse(c.storage.get(key)!)).toEqual([favorito])
    expect(changed).toHaveBeenLastCalledWith(key)
    c.button.handlers.click()
    expect(JSON.parse(c.storage.get(key)!)).toEqual([])
    expect(changed).toHaveBeenCalledTimes(2)

    c.storage.set(key, JSON.stringify([favorito]))
    c.event('eu:cuenta')
    expect(c.button.attributes['aria-pressed']).toBe('true')
    c.storage.set(key, '[]')
    c.event('storage', { key })
    expect(c.button.attributes['aria-pressed']).toBe('false')
    expect(changed).toHaveBeenCalledTimes(2)
  })

  it('mantiene el límite de 50 sin intentar subir un favorito que no se guardó', async () => {
    const c = cliente(), changed = vi.fn()
    c.browser.EUCuenta = { user: null, changed, ready: Promise.resolve() }
    const cincuenta = Array.from({ length: 50 }, (_, n) => ({ ...favorito, id: 'competicion:liga-' + n }))
    c.storage.set(key, JSON.stringify(cincuenta))
    await c.start()
    c.button.handlers.click()
    expect(JSON.parse(c.storage.get(key)!)).toHaveLength(50)
    expect(c.nodes['favoritos-estado'].textContent).toContain('hasta 50')
    expect(c.nodes['favoritos-nota'].textContent).toContain('este navegador')
    expect(changed).not.toHaveBeenCalled()
  })

  it('un fallo de almacenamiento no anuncia guardado ni cambia el favorito visible', async () => {
    const c = cliente(), changed = vi.fn()
    c.browser.EUCuenta = { user: null, changed, ready: Promise.resolve() }
    await c.start()
    c.localStorage.setItem.mockImplementation(() => { throw new Error('storage disabled') })
    c.button.handlers.click()
    expect(c.button.attributes['aria-pressed']).toBe('false')
    expect(c.nodes['favoritos-estado'].textContent).toContain('no permite guardar')
    expect(changed).not.toHaveBeenCalled()
  })
})
