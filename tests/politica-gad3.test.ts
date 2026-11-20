import { describe, expect, it, vi } from 'vitest'
import { descubreGad3, descubreGad3Rss, fichaGad3, tablaGad3, fetchGad3, GAD3_RSS } from '../scripts/lib/politica-gad3.mjs'
import articulo from './fixtures/politica/gad3-nacional-20261109.html?raw'
import grafico from './fixtures/politica/gad3-grafico-20261109.html?raw'
import csv from './fixtures/politica/gad3-datos-20261109.tsv?raw'
import rss from './fixtures/politica/gad3-rss-20261120.xml?raw'

const url = 'https://www.gad3.com/barometro-abc-i-estimacion-de-voto-nacional-noviembre-2026/'
const ficha = () => fichaGad3(articulo, url, '2026-11-10')

describe('fuente nacional original de GAD3', () => {
  it('el RSS oficial descubre sólo la nacional, sin mezclar Senado ni provincias', () => {
    expect(descubreGad3Rss(rss)).toEqual([url])
    for (const ajena of [url.replace('www.gad3.com', 'www.gad3.com.ejemplo.es'), url.replace('https://', 'http://'), url.replace('https://', 'https://usuario:clave@'), url + '?otro=1', url + '#fragmento']) {
      expect(descubreGad3Rss(rss.replace(url, ajena))).toEqual([])
    }
    expect(() => descubreGad3Rss('<html>Sin RSS</html>')).toThrow(/RSS/)
    expect(() => descubreGad3Rss('<!DOCTYPE rss SYSTEM "https://ajeno.example/">' + rss)).toThrow(/RSS/)
  })
  it('recupera el artículo desde RSS sólo cuando el listado HTTP200 omite las nacionales', async () => {
    const llamadas: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const u = String(input); llamadas.push(u)
      if (u.endsWith('/politica/')) return new Response('<h1>Política</h1>')
      if (u === GAD3_RSS) return new Response(rss)
      if (u === url) return new Response(articulo)
      if (u.endsWith('dataset.csv')) return new Response(csv)
      return new Response(grafico)
    }) as typeof fetch
    const resultado = await fetchGad3({ fetchImpl, hoy: '2026-11-20', userAgent: 'Test' })
    expect(llamadas).toEqual(['https://www.gad3.com/politica/', GAD3_RSS, url, ficha().grafico, ficha().grafico + 'dataset.csv'])
    expect(resultado.sondeos[0]).toMatchObject({ publicacion: '2026-11-09', campoInicio: '2026-11-03', campoFin: '2026-11-05', muestra: 1502 })
    expect(resultado.sondeos[0].datos.reduce((n, d) => n + (d.escanos as number || 0), 0)).toBe(350)
    expect(resultado.sondeos[0].datos.find(d => d.candidaturaId === 'ppupn')).toMatchObject({ pct: 31.9, escanos: 136 })
  })
  it.each([403, 429, 503])('no usa RSS para sortear un HTTP%s del listado', async status => {
    const fetchImpl = vi.fn(async () => new Response('', { status }))
    await expect(fetchGad3({ fetchImpl, hoy: '2026-11-20', userAgent: 'Test' })).rejects.toThrow('HTTP ' + status)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
  it('no cambia de fuente ante un fallo de certificado', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('CERT_HAS_EXPIRED') })
    await expect(fetchGad3({ fetchImpl, hoy: '2026-11-20', userAgent: 'Test' })).rejects.toThrow('CERT_HAS_EXPIRED')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
  it('descubre el nacional y descarta el provincial, otras elecciones y dominios parecidos', () => {
    expect(descubreGad3([url, url, url.replace('nacional', 'por-provincias'), url.replace('www.gad3.com', 'www.gad3.com.ejemplo.es'), 'https://www.gad3.com/andalucia/'].map(u => '<a href="' + u + '">Fuente</a>').join(''))).toEqual([url])
  })

  it('separa publicación, trabajo de campo y muestra; conserva la coalición PP-UPN', () => {
    expect(ficha()).toMatchObject({ ppConUpn: true, sondeo: { empresa: 'GAD3', campoInicio: '2026-11-03', campoFin: '2026-11-05', publicacion: '2026-11-09', muestra: 1502, fuenteUrl: url } })
    expect(() => fichaGad3(articulo, url, '2026-11-08')).toThrow(/publicación/)
    expect(() => fichaGad3(articulo.replace('Del 3 al 5 de noviembre', 'Sin confirmar'), url, '2026-11-10')).toThrow(/fechas/)
  })

  it('aplica las correcciones publicadas: 136/103/63, FA 6 y Ara Més 1 separados; blancos no son cero', () => {
    const { sondeos, candidaturas } = tablaGad3(grafico, csv, ficha())
    const datos = Object.fromEntries(sondeos[0].datos.map(d => [d.candidaturaId, d]))
    expect(datos.ppupn).toMatchObject({ pct: 31.9, escanos: 136 })
    expect(datos.psoe).toMatchObject({ pct: 25.9, escanos: 103 })
    expect(datos.vox).toMatchObject({ pct: 18.6, escanos: 63 })
    expect(datos.fa).toMatchObject({ pct: 5.1, escanos: 6 })
    expect(datos.arames).toMatchObject({ pct: 0.3, escanos: 1 })
    expect(datos.upc).toMatchObject({ pct: 0.3, escanos: null })
    expect(datos).not.toHaveProperty('total')
    expect(datos).not.toHaveProperty('enblanco')
    expect(sondeos[0].datos.reduce((s, d) => s + Number(d.escanos || 0), 0)).toBe(350)
    expect(candidaturas.find(c => c.id === 'ppupn')?.siglas).toBe('PP-UPN')
  })

  it('rechaza columnas cambiadas, descarga incompleta y configuración ajena', () => {
    expect(() => tablaGad3(grafico, csv.replace('Dip. Est.', 'Otra cifra'), ficha())).toThrow(/columnas/)
    expect(() => tablaGad3(grafico, csv.replace('CC*\t0,5\t1\t0,4\t1', 'CC*\t0,5\t1\t0,4\t'), ficha())).toThrow(/incompleto/)
    expect(() => tablaGad3(grafico, csv, { ...ficha(), grafico: 'https://datawrapper.dwcdn.net/OTRO1/1/' })).toThrow(/tabla nacional/)
    expect(() => tablaGad3('<script>alert(1)</script>', csv, ficha())).toThrow(/formato/)
  })

  it('consulta la publicación más reciente por fecha, no por orden de enlaces', async () => {
    const vieja = url.replace('noviembre', 'octubre')
    const llamadas: string[] = []
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const u = String(input); llamadas.push(u)
      if (u.endsWith('/politica/')) return new Response('<a href="' + vieja + '">Antes</a><a href="' + url + '">Hoy</a>')
      if (u === vieja) return new Response(articulo.replace('2026-11-09T', '2026-10-09T').replace('Ficha técnica', 'Otro formato antiguo'))
      if (u === url) return new Response(articulo)
      if (u.endsWith('dataset.csv')) return new Response(csv)
      return new Response(grafico)
    }) as typeof fetch
    const resultado = await fetchGad3({ fetchImpl, hoy: '2026-11-10', userAgent: 'Test' })
    expect(resultado.sondeos[0].publicacion).toBe('2026-11-09')
    expect(resultado.procedencia.url).toBe(url)
    expect(llamadas).toHaveLength(5)
    expect(llamadas).not.toContain(GAD3_RSS)
    await expect(fetchGad3({ fetchImpl: async () => new Response('', { status: 503 }), hoy: '2026-11-10', userAgent: 'Test' })).rejects.toThrow('HTTP 503')
  })
})
