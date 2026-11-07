import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Hono } from 'hono'
import type { Env } from '../src/index'
import type { EstacionITV } from '../src/lib/itv'
import type { MunicipioLista } from '../scripts/lib/tiempo.mjs'
import baseMunicipios from '../public/data/tiempo/municipios.json?raw'

let app: Hono<{ Bindings: Env }>
beforeEach(async () => {
  vi.resetModules()
  const { Hono } = await import('hono')
  app = new Hono<{ Bindings: Env }>()
  const { registerItvRoutes } = await import('../src/routes/itv')
  registerItvRoutes(app)
})
const madrid: MunicipioLista = { ine: '28079', nombre:'Madrid', provinciaId:'28', provinciaSlug:'madrid', provinciaNombre:'Madrid', slug:'madrid', lat:40.4, lng:-3.7, pob:3000000, imp:true }
const lugar = {n:'Madrid',p:'Madrid',u:'/tiempo/madrid/madrid',tipo:'municipio'}
function assets(datos: () => Record<string, unknown>) {
  return { fetch: vi.fn(async (request: Request) => {
    const file = new URL(request.url).pathname.replace('/data/', '')
    const dato = datos()[file]
    return dato === undefined ? new Response(null, {status:404}) : Response.json(dato)
  }) }
}

describe('rutas de búsqueda ITV', () => {
  it('usa el índice compartido a demanda y conserva Madrid ciudad al enviar el formulario', async () => {
    const ASSETS = assets(() => ({'tiempo/buscador-v1.json': [{lugar,nombres:['madrid']}] }))
    const corta = await app.request('/api/itv/municipios?q=m', {}, {ASSETS})
    expect(await corta.json()).toEqual([])
    expect(ASSETS.fetch).not.toHaveBeenCalled()
    const res = await app.request('/api/itv/municipios?q=Madrid', {}, {ASSETS})
    expect(await res.json()).toEqual([{...lugar,u:'/itv/madrid/madrid'}])
    const formulario = await app.request('/itv/buscar?q=Madrid', {}, {ASSETS})
    expect(formulario.headers.get('location')).toBe('/itv/madrid/madrid')
    expect(ASSETS.fetch).toHaveBeenCalledTimes(1)
  })
  it('devuelve 503 sin caché ante un catálogo ausente y se recupera en el siguiente intento', async () => {
    let disponible = false
    const ASSETS = assets(() => disponible ? {'tiempo/municipios.json': {municipios:[madrid]}} : {})
    const fallo = await app.request('/api/itv/municipios?q=Madrid', {}, {ASSETS})
    expect(fallo.status).toBe(503)
    expect(fallo.headers.get('Cache-Control')).toBe('no-store')
    disponible = true
    const siguiente = await app.request('/api/itv/municipios?q=Madrid', {}, {ASSETS})
    expect(siguiente.status).toBe(200)
    expect(await siguiente.json()).toMatchObject([{u:'/itv/madrid/madrid'}, {u:'/itv/madrid'}])
  })
  it('el formulario sin JavaScript ofrece reintentar cuando el catálogo falla', async () => {
    const res = await app.request('/itv/buscar?q=Madrid', {}, {ASSETS:assets(() => ({}))})
    expect(res.status).toBe(503)
    const html = await res.text()
    expect(html).toContain('Ahora no se puede cargar')
    expect(html).not.toContain('No encontramos ese lugar')
  })
  it('conserva la API sin consulta y evita guardar en caché una descarga fallida', async () => {
    const estacion: EstacionITV = {id:'uno',mun:'MADRID',prov:'28',dir:'Dirección',cp:'',op:'',tel:'',lat:null,lng:null,lineas:null,horario:'',fuente:'dgt'}
    let disponible = false
    const ASSETS = assets(() => disponible ? {'itv.json': {estaciones:[estacion]}} : {})
    const fallo = await app.request('/api/itv/municipios', {}, {ASSETS})
    expect(await fallo.json()).toEqual([])
    expect(fallo.headers.get('Cache-Control')).toBe('no-store')
    disponible = true
    const siguiente = await app.request('/api/itv/municipios', {}, {ASSETS})
    expect(await siguiente.json()).toEqual([{n:'Madrid',p:'Madrid',u:'/itv/madrid/madrid'}])
  })
  it.each([
    ['0441', '04', 'Balanegra', 'Berja', 'almeria', 'balanegra', 'berja'],
    ['3703', '37', 'Castellanos de Moriscos', 'Salamanca', 'salamanca', 'castellanos-de-moriscos', 'salamanca'],
    ['3812', '38', 'Tacoronte', 'Santa Cruz de Tenerife', 'santa-cruz-de-tenerife', 'tacoronte', 'santa-cruz-de-tenerife'],
  ])('la estación %s aparece en su municipio principal y no se duplica por un alias de otra localidad', async (codigo, prov, mun, alias, provinciaSlug, slug, slugAnterior) => {
    const estacion: EstacionITV = {
      id: 'itv-' + prov + '-' + codigo, mun, prov, aliasMunicipios: [mun, alias],
      dir: 'Dirección del centro ' + codigo, cp: '', op: '', tel: '', lat: null, lng: null,
      lineas: null, horario: '', fuente: 'industria',
    }
    const ASSETS = assets(() => ({
      'itv.json': { estaciones: [estacion] },
      'tiempo/municipios.json': JSON.parse(baseMunicipios),
    }))
    const principal = await app.request('/itv/' + provinciaSlug + '/' + slug, {}, { ASSETS })
    expect(principal.status).toBe(200)
    expect(await principal.text()).toContain(estacion.dir)
    const otroMunicipio = await app.request('/itv/' + provinciaSlug + '/' + slugAnterior, {}, { ASSETS })
    expect(otroMunicipio.status).toBe(200)
    expect(await otroMunicipio.text()).not.toContain(estacion.dir)
  })
})
