import { describe, expect, it } from 'vitest'
import { categoriasServicio, OSM_TAG_FILTERS } from '../scripts/lib/servicios-catalogo.mjs'
import { normalizaServicio, validaServicio } from '../scripts/lib/servicios.mjs'

describe('servicios cotidianos publicados de forma expresa', () => {
  it('incluye recogida de paquetes en un comercio sin inventar servicios postales', () => {
    const tags = { shop:'convenience', 'post_office:parcel_pickup':'yes', name:'Comercio de ejemplo', access:'customers' }
    expect(OSM_TAG_FILTERS).toContainEqual(['post_office:parcel_pickup','yes'])
    expect(categoriasServicio(tags)).toEqual(['paqueteria'])
    const poi = normalizaServicio({ type:'node', id:123, lat:40.42, lon:-3.7, tags })!
    expect(validaServicio(poi)).toMatchObject({ categorias:['paqueteria'], acceso:'clientes', gratis:null })
    expect(poi).not.toHaveProperty('horario')
  })
  it.each([
    { post_office:'post_partner' }, { amenity:'post_office' }, { shop:'parcel' },
    { 'post_office:parcel_send':'yes' }, { 'post_office:parcel_pickup':'no' },
    { 'post_office:parcel_pickup':'yes', 'post_office:parcel_pickup:conditional':'no @ (Sa-Su)' },
  ] as Record<string,string>[])('no promete recogida por una etiqueta genérica o ambigua: %j', tags => {
    expect(categoriasServicio(tags)).not.toContain('paqueteria')
  })
  it('distingue pilas domésticas, baterías de coche y aceite de cocina', () => {
    expect(categoriasServicio({ amenity:'recycling', 'recycling:batteries':'yes', 'recycling:cooking_oil':'yes' })).toEqual(['reciclaje','reciclaje-aceite','reciclaje-pilas'])
    expect(categoriasServicio({ amenity:'recycling', 'recycling:car_batteries':'yes', 'recycling:engine_oil':'yes' })).toEqual(['reciclaje'])
    expect(categoriasServicio({ amenity:'recycling', recycling_type:'centre' })).toEqual(['puntos-limpios','reciclaje'])
  })
  it('no añade materiales ausentes, prohibidos o condicionados', () => {
    for (const extra of [{}, {'recycling:batteries':'no'}, {'recycling:batteries':'yes','recycling:batteries:conditional':'no @ (Su)'}, {'recycling:cooking_oil':'no'}] as Record<string,string>[]) {
      const result = categoriasServicio({ amenity:'recycling', ...extra })
      expect(result).not.toContain('reciclaje-pilas'); expect(result).not.toContain('reciclaje-aceite')
    }
    expect(categoriasServicio({ 'recycling:batteries':'yes' })).toEqual([])
  })
  it('continúa excluyendo un punto privado aunque acepte materiales', () => {
    expect(normalizaServicio({ type:'node', id:123, lat:40.42, lon:-3.7, tags:{ amenity:'recycling', 'recycling:batteries':'yes', access:'private' } })).toBeNull()
  })
})
