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
  const fetch = vi.fn(async () => { throw Error('sin conexión') })
  new Function('self', 'caches', 'fetch', plantilla.replace('__RUTAS_SONDEOS_CON_VEDA__', JSON.stringify(RUTAS_SONDEOS_SIN_COPIA)))(self, almacen, fetch)

  function pedir(ruta: string, accept: string) {
    const request = new Request(new URL(ruta, origen), { headers: { accept } })
    let respuesta: Promise<Response> | undefined
    alPedir({ request, respondWith: p => { respuesta = p } })
    if (!respuesta) throw Error('El servicio no atendió la petición')
    return respuesta
  }
  return { pedir, almacen }
}

describe('copias sin conexión y veda de sondeos', () => {
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
