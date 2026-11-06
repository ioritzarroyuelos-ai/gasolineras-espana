import { describe, expect, it } from 'vitest'
import oficial from '../public/data/tiempo/municipios.json?raw'
import type { MunicipioLista } from '../scripts/lib/tiempo.mjs'
import { buscaTiempo, catalogoTiempo, preparaBuscadorTiempo, rutaMunicipioTiempo } from '../src/lib/tiempo-municipios'
import { buscadorTiempo, resultadosTiempo } from '../src/html/tiempo-buscador'

const base: MunicipioLista[] = JSON.parse(oficial).municipios
const lista = catalogoTiempo(base)
const indice = preparaBuscadorTiempo(lista)

describe('El Tiempo por municipio', () => {
  it('publica las doce altas con coordenadas propias y retira los dos códigos de la fusión', () => {
    expect(lista).toHaveLength(8132)
    expect(new Set(lista.map(m => m.ine)).size).toBe(8132)
    expect(new Set(lista.map(m => m.provinciaSlug + '/' + m.slug)).size).toBe(8132)
    for (const [ine, lat, lng] of [
      ['04904',36.749,-2.908], ['11903',36.341,-5.323], ['14901',37.669,-5.155], ['14902',37.637,-4.865],
      ['18077',36.954,-3.856], ['18106',36.934,-3.909], ['18915',37.497,-3.508], ['18916',36.702,-3.486],
      ['21902',37.713,-6.854], ['36902',42.47192825,-8.48202606], ['41904',37.061,-5.804], ['48916',43.218974,-2.818344],
    ] as const) {
      expect(lista.find(m => m.ine === ine)).toMatchObject({lat, lng})
    }
    expect(lista.some(m => m.ine === '36011' || m.ine === '36012')).toBe(false)
    expect(catalogoTiempo(lista)).toEqual(lista)
    expect(catalogoTiempo([])).toEqual([])
  })
  it.each([
    ['Madrid', '/tiempo/madrid/madrid'], ['Provincia de Madrid', '/tiempo/madrid'],
    ['A Coruña', '/tiempo/a-coruna/coruna-a'], ['La Coruna', '/tiempo/a-coruna/coruna-a'],
    ['San Sebastian', '/tiempo/guipuzcoa/donostia-san-sebastian'], ['Donostia','/tiempo/guipuzcoa/donostia-san-sebastian'],
    ['Gipuzkoa', '/tiempo/guipuzcoa'], ['Vizcaya','/tiempo/bizkaia'],
    ['Usansolo','/tiempo/bizkaia/usansolo'], ['Balanegra','/tiempo/almeria/balanegra'],
    ['Palamós','/tiempo/girona/palamos'], ['Cerdedo','/tiempo/pontevedra/cerdedo-cotobade'],
  ])('al buscar %s la primera opción y la búsqueda enviada coinciden', (q, ruta) => {
    const r = buscaTiempo(indice, q)
    expect(r.destino).toBe(ruta)
    expect(r.resultados[0].u).toBe(ruta)
  })
  it('distingue la provincia, presenta los homónimos y preserva los enlaces anteriores', () => {
    expect(buscaTiempo(indice, 'Madrid').resultados.slice(0,2).map(r=>r.tipo)).toEqual(['municipio','provincia'])
    const ambiguo = buscaTiempo(indice, 'Villanueva de los Infantes')
    expect(ambiguo.destino).toBeUndefined()
    expect(ambiguo.resultados.map(r=>r.p)).toEqual(['Ciudad Real','Valladolid'])
    const coruna = lista.filter(m=>m.provinciaId==='15')
    expect(rutaMunicipioTiempo(coruna, 'a-coruna')).toMatchObject({municipio:{ine:'15030'},redirigir:true})
    expect(rutaMunicipioTiempo(coruna, 'coruna-a')).toMatchObject({municipio:{ine:'15030'},redirigir:false})
    expect(rutaMunicipioTiempo(lista.filter(m=>m.provinciaId==='36'), 'cotobade')?.municipio.ine).toBe('36902')
    expect(rutaMunicipioTiempo(coruna, 'cotobade')).toBeUndefined()
  })
  it('ofrece formulario GET, enlaces y protección del texto de búsqueda aunque no se ejecute JavaScript', () => {
    expect(buscadorTiempo('nonce','<prueba>')).toContain('action="/tiempo/buscar" method="get"')
    expect(buscadorTiempo('nonce','<prueba>')).toContain('value="&lt;prueba&gt;"')
    expect(resultadosTiempo('Madrid',buscaTiempo(indice,'Madrid').resultados)).toContain('href="/tiempo/madrid/madrid"')
    expect(resultadosTiempo('sin resultados',[])).toContain('consulta la lista de provincias')
  })
})
