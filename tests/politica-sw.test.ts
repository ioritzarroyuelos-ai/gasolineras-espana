import { describe, expect, it, vi } from 'vitest'
import plantilla from '../scripts/sw.js.tpl?raw'
import { RUTAS_SONDEOS_SIN_COPIA } from '../scripts/lib/politica-catalogo.mjs'

function navegadorSinConexion() {
  const origen = 'https://prueba.example'
  type Peticion = { request: Request; respondWith: (p: Promise<Response>) => void }
  let alPedir: (evento: Peticion) => void
  const self = {
    location: new URL(origen),
    addEventListener(tipo: string, listener: typeof alPedir) {
      if (tipo === 'fetch') alPedir = listener
    },
  }
  const almacen = { match: vi.fn(async () => new Response('copia anterior')) }
  const fetch = vi.fn(async (_request: Request, _options?: RequestInit) => { throw Error('sin conexión') })
  new Function('self', 'caches', 'fetch', plantilla.replace('__RUTAS_SONDEOS_CON_VEDA__', JSON.stringify(RUTAS_SONDEOS_SIN_COPIA)))(self, almacen, fetch)

  function pedir(ruta: string, accept: string) {
    const request = new Request(new URL(ruta, origen), { headers: { accept } })
    let respuesta: Promise<Response> | undefined
    alPedir({ request, respondWith: p => { respuesta = p } })
    if (!respuesta) throw Error('El servicio no atendió la petición')
    return respuesta
  }
  return { pedir, almacen, fetch }
}

describe('copias sin conexión y veda de sondeos', () => {
  it('portada y Mi día no recuperan resúmenes de un día anterior sin conexión', async () => {
    const { pedir, almacen, fetch } = navegadorSinConexion()
    for (const ruta of ['/', '/?municipio=28079', '/?q=Madrid', '/mi-dia', '/mi-dia/?municipio=28079', '/mi-%64ia']) {
      const respuesta = await pedir(ruta, 'text/html')
      expect(respuesta.status).toBe(503)
      expect(respuesta.headers.get('cache-control')).toBe('no-store')
      expect(await respuesta.text()).toContain('información de hoy')
    }
    expect(almacen.match).not.toHaveBeenCalled()
    expect(fetch.mock.calls).toHaveLength(6)
    for (const llamada of fetch.mock.calls) expect(llamada[1]).toEqual({ cache: 'no-store' })
  })

  it('deportes no recupera horarios ni marcadores de una copia sin conexión', async () => {
    const { pedir, almacen } = navegadorSinConexion()
    for (const ruta of ['/deportes/', '/deportes/futbol', '/deportes/competicion/formula-1', '/data/deportes/index.json']) {
      const respuesta = await pedir(ruta, ruta.endsWith('.json') ? 'application/json' : 'text/html')
      expect(respuesta.status).toBe(503)
      expect(await respuesta.text()).toContain('horarios, resultados y clasificaciones')
    }
    expect(almacen.match).not.toHaveBeenCalled()
  })
  it('el histórico y la descarga de las generales descartan las copias que se guardaron antes de la veda', async () => {
    const { pedir, almacen } = navegadorSinConexion()
    for (const [url, accept] of [
      ['/politica/generales?pagina=2', 'text/html'],
      ['/data/politica/generales.json?version=antigua', 'application/json'],
      ['/data/politica/%67enerales%2ejson', 'application/json'],
      ['/politica/', 'text/html'],
    ]) {
      expect((await pedir(url, accept)).status).toBe(503)
    }
    expect(almacen.match).not.toHaveBeenCalled()
  })

  it('las demás elecciones y las estaciones de servicio siguen disponibles con su copia local', async () => {
    const { pedir } = navegadorSinConexion()
    for (const [url, accept] of [
      ['/politica/europeas', 'text/html'],
      ['/politica/generales/senado', 'text/html'],
      ['/data/politica/autonomicas/madrid.json', 'application/json'],
      ['/data/stations.json', 'application/json'],
    ]) {
      expect(await (await pedir(url, accept)).text()).toBe('copia anterior')
    }
  })

  it('no presenta como abiertas las farmacias de una visita anterior sin conexión', async () => {
    const { pedir, almacen } = navegadorSinConexion()
    for (const url of ['/farmacias/madrid/madrid?turno=ahora', '/farmacias/islas-baleares']) {
      const respuesta = await pedir(url, 'text/html')
      expect(respuesta.status).toBe(503)
      expect(await respuesta.text()).toContain('turno actualizado')
    }
    expect(almacen.match).not.toHaveBeenCalled()
    expect(await (await pedir('/farmacias/guardia', 'text/html')).text()).toBe('copia anterior')
  })

  it('sin conexión nunca reutiliza una ficha del tiempo con un pronóstico o avisos antiguos', async () => {
    const { pedir, almacen } = navegadorSinConexion()
    for (const url of ['/tiempo/bizkaia/durango', '/tiempo/las-palmas/arrecife/?v=ayer', '/tiempo/madrid/%6dadrid']) {
      const respuesta = await pedir(url, 'text/html')
      expect(respuesta.status).toBe(503)
      expect(respuesta.headers.get('cache-control')).toBe('no-store')
      expect(await respuesta.text()).toContain('previsión y los avisos vigentes')
    }
    expect(almacen.match).not.toHaveBeenCalled()
    for (const indice of ['/tiempo/', '/tiempo/bizkaia'])
      expect(await (await pedir(indice, 'text/html')).text()).toBe('copia anterior')
  })
})

describe('actualización de los clientes propios en navegadores con caché', () => {
  function navegadorParaScripts() {
    const origen = 'https://prueba.example'
    const copias = new Map<string, Response>()
    let online = true
    let alPedir: (event: { request: Request; respondWith: (respuesta: Promise<Response>) => void }) => void
    const self = { location: new URL(origen), addEventListener(tipo: string, listener: typeof alPedir) { if (tipo === 'fetch') alPedir = listener } }
    const url = (peticion: Request | string) => new URL(typeof peticion === 'string' ? peticion : peticion.url, origen)
    const almacen = {
      match: vi.fn(async (peticion: Request | string, opciones?: { ignoreSearch: boolean }) => {
        const pedida = url(peticion)
        const key = [...copias.keys()].find(key => opciones?.ignoreSearch ? new URL(key).pathname === pedida.pathname : key === pedida.href)
        return key ? copias.get(key)!.clone() : undefined
      }),
      open: async () => ({ put: async (peticion: Request | string, respuesta: Response) => { copias.set(url(peticion).href, respuesta) } }),
    }
    const fetch = vi.fn(async (peticion: Request) => {
      if (!online) throw Error('sin conexión')
      return new Response('actual ' + new URL(peticion.url).pathname, { headers: { 'Content-Type': 'application/javascript' } })
    })
    new Function('self', 'caches', 'fetch', plantilla.replace('__RUTAS_SONDEOS_CON_VEDA__', JSON.stringify(RUTAS_SONDEOS_SIN_COPIA)))(self, almacen, fetch)
    function pedir(ruta: string) {
      let respuesta: Promise<Response> | undefined
      alPedir({ request: new Request(new URL(ruta, origen)), respondWith: p => { respuesta = p } })
      if (!respuesta) throw Error('No se atendió el script')
      return respuesta
    }
    function guardar(ruta: string, texto: string) { copias.set(new URL(ruta, origen).href, new Response(texto)) }
    return { pedir, guardar, almacen, fetch, desconectar: () => { online = false }, copias }
  }

  it.each(['app', 'municipio', 'mi-dia'])('%s.js sustituye la copia antigua consultando primero la red', async nombre => {
    const n = navegadorParaScripts(), ruta = '/static/' + nombre + '.js?v=1.8.0'
    n.guardar(ruta, 'copia antigua')
    const respuesta = await n.pedir(ruta)
    expect(await respuesta.text()).toBe('actual /static/' + nombre + '.js')
    expect(n.fetch).toHaveBeenCalledOnce()
    expect(n.almacen.match).not.toHaveBeenCalled()
    expect(await n.copias.get('https://prueba.example' + ruta)!.clone().text()).toBe('actual /static/' + nombre + '.js')
  })

  it.each(['app', 'municipio', 'mi-dia'])('%s.js recupera exclusivamente su propia copia cuando no hay conexión', async nombre => {
    const n = navegadorParaScripts()
    for (const script of ['app', 'municipio', 'mi-dia']) n.guardar('/static/' + script + '.js?v=anterior', 'copia de ' + script)
    n.desconectar()
    expect(await (await n.pedir('/static/' + nombre + '.js?v=nueva')).text()).toBe('copia de ' + nombre)
    expect(n.fetch).toHaveBeenCalledOnce()
  })

  it.each(['municipio', 'mi-dia'])('%s.js no recibe app.js como sustituto si su copia falta', async nombre => {
    const n = navegadorParaScripts()
    n.guardar('/static/app.js', 'no es el cliente solicitado'); n.desconectar()
    expect(await n.pedir('/static/' + nombre + '.js?v=nueva')).toBeUndefined()
    expect(n.almacen.match.mock.calls[1][0]).toBe('/static/' + nombre + '.js')
  })
})
