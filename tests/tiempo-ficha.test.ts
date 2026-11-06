import { parse } from 'node-html-parser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MunicipioLista, Prediccion } from '../scripts/lib/tiempo.mjs'
import { AEMET_MUNICIPIOS, urlMunicipioAemet } from '../scripts/lib/tiempo.mjs'
import { buildTiempoMunicipioPage } from '../src/html/tiempo'

const AHORA = '2026-11-06T23:30:00Z' // Sábado 00:30 en Durango, viernes 23:30 en Arrecife.
const PUBLICADO = '2026-11-06T21:45:00Z'
const DURANGO: MunicipioLista = {
  ine: '48027', nombre: 'Durango', provinciaId: '48', provinciaSlug: 'bizkaia',
  provinciaNombre: 'Bizkaia', slug: 'durango', lat: 43.17, lng: -2.63, pob: 30000, imp: true,
}
const ARRECIFE: MunicipioLista = {
  ine: '35004', nombre: 'Arrecife', provinciaId: '35', provinciaSlug: 'las-palmas',
  provinciaNombre: 'Las Palmas', slug: 'arrecife', lat: 28.96, lng: -13.55, pob: 65000, imp: true,
}

function parte(m: MunicipioLista): Prediccion {
  return { ine: m.ine, nombre: m.nombre, provincia: m.provinciaNombre, fuente: 'AEMET',
    elaborado: PUBLICADO, versionPeriodos: 2,
    dias: [
      { fecha: '2026-11-06', tmax: 24, tmin: 15, cielo: 'Despejado', probLluvia: 0, viento: null },
      { fecha: '2026-11-07', tmax: 19, tmin: 8, cielo: '', probLluvia: null, viento: 12 },
    ] }
}

function xmlHoras(m: MunicipioLista, contenido: string, enlace = '') {
  return new Response('<root id="'+m.ine+'"><origen><enlace>'+enlace+'</enlace></origen><prediccion>'+contenido+'</prediccion></root>', {
    headers: { 'Last-Modified': new Date(PUBLICADO).toUTCString() },
  })
}

async function ficha(m: MunicipioLista, copia: Prediccion | null, responder?: (url: URL) => Response | undefined) {
  vi.stubGlobal('fetch', async (peticion: RequestInfo | URL) => {
    const url = new URL(peticion instanceof Request ? peticion.url : peticion.toString())
    return responder?.(url) ?? new Response(null, { status: 503 })
  })
  const assets = { fetch: async (req: Request) => {
    const path = new URL(req.url).pathname
    if (path === '/data/tiempo/municipios.json') return Response.json({ municipios: [m] })
    if (copia && path === '/data/tiempo/snapshot/'+m.provinciaSlug+'.json')
      return Response.json({ predicciones: { [m.ine]: copia } })
    return new Response(null, { status: 404 })
  } }
  const app = (await import('../src/index')).default
  const respuesta = await app.request('/tiempo/'+m.provinciaSlug+'/'+m.slug, {}, { ASSETS: assets })
  expect(respuesta.status).toBe(200)
  return parse(await respuesta.text())
}

beforeEach(() => {
  vi.resetModules() // Reinicia las copias compartidas por las rutas entre escenarios.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(AHORA))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('ficha municipal que recibe el navegador', () => {
  it('en Durango ya es sábado y el 75 % cruza de viernes a sábado sin anunciarse como probabilidad diaria', async () => {
    const doc = await ficha(DURANGO, parte(DURANGO), url => {
      if (!url.pathname.includes('/municipios_h/')) return
      return xmlHoras(DURANGO, '<dia fecha="2026-11-06"><prob_precipitacion periodo="1901">75</prob_precipitacion></dia>'
        + '<dia fecha="2026-11-07"><temperatura periodo="00">6</temperatura>'
        + '<estado_cielo periodo="00" descripcion="Nubes altas">17</estado_cielo></dia>')
    })
    const hoy = doc.querySelector('section[aria-labelledby=hoy]')!
    expect(hoy.structuredText).toMatch(/sábado.*7 de noviembre/i)
    expect(hoy.text).toContain('19°')
    expect(hoy.text).not.toMatch(/24°|75|Despejado/)
    const tramos = doc.querySelectorAll('.lluvia li')
    expect(tramos).toHaveLength(1)
    expect(tramos[0].text).toMatch(/vie.*6.*19:00.*01:00.*75 %/i)
    const columnas = doc.querySelectorAll('table tbody tr:first-child > *').map(c => c.text)
    expect(columnas).toEqual(['00:00Nubes altas','6°','—'])
    const fuentes = doc.querySelectorAll('.fuente')
    expect(fuentes.map(f => f.querySelector('a')?.getAttribute('href'))).toEqual([
      expect.stringContaining('/municipios/durango-id48027'),
      expect.stringContaining('/municipios/horas/durango-id48027'),
    ])
    for (const f of fuentes) expect(f.text).toMatch(/Actualizado.*22:45/)
  })

  it('en Canarias sigue siendo viernes y las horas del respaldo tienen su propio crédito y hora de consulta', async () => {
    const doc = await ficha(ARRECIFE, parte(ARRECIFE), url => {
      if (url.hostname !== 'api.open-meteo.com' || !url.searchParams.has('hourly')) return
      return Response.json({ hourly: {
        time: [Date.parse('2026-11-07T00:00:00Z') / 1000],
        temperature_2m: [17], precipitation_probability: [60], wind_speed_10m: [0], weather_code: [0],
      } })
    })
    const hoy = doc.querySelector('section[aria-labelledby=hoy]')!
    expect(hoy.text).toMatch(/viernes.*6 de noviembre/i)
    expect(hoy.text).toContain('24°')
    expect(hoy.text).toContain('0 %')
    expect(doc.querySelector('.dias')?.text).toMatch(/sáb.*7.*19°/)
    expect(doc.querySelector('.lluvia li')?.text).toMatch(/23:00.*sáb.*7.*00:00.*60 %/)
    const fila = doc.querySelector('table tbody tr')!
    expect(fila.text).toMatch(/sáb.*7.*00:00.*17°.*0 km\/h/)
    const [diaria, horaria] = doc.querySelectorAll('.fuente')
    expect(diaria.text).toMatch(/AEMET.*Actualizado.*21:45/)
    expect(horaria.text).toMatch(/Open-Meteo.*Consultado.*23:30/)
    const enlace = new URL(horaria.querySelector('a')!.getAttribute('href')!)
    expect(enlace.hostname).toBe('open-meteo.com')
    expect(enlace.searchParams.get('latitude')).toBe(String(ARRECIFE.lat))
  })

  it('si el respaldo solo publica mañana, distingue la máxima probabilidad por hora y conserva su procedencia', async () => {
    const doc = await ficha(DURANGO, null, url => {
      if (url.hostname !== 'api.open-meteo.com' || !url.searchParams.has('daily')) return
      return Response.json({ daily: {
        time: ['2026-11-08'], temperature_2m_max: [20], temperature_2m_min: [8],
        precipitation_probability_max: [65], weathercode: [3], wind_speed_10m_max: [20],
      } })
    })
    expect(doc.querySelector('.temperaturas')).toBeNull()
    const dias = doc.querySelector('.dias')!
    expect(dias.text).toMatch(/dom.*8.*20°/)
    expect(dias.text).toContain('Probabilidad máxima de lluvia por hora 65 %')
    expect(doc.querySelector('.fuente')?.text).toMatch(/Open-Meteo.*Consultado.*00:30/)
  })

  it('el enlace del parte horario abre directamente A Coruña también cuando falta el parte diario', async () => {
    const coruna: MunicipioLista = { ine: '15030', nombre: 'A Coruña', provinciaId: '15', provinciaSlug: 'a-coruna',
      provinciaNombre: 'A Coruña', slug: 'a-coruna', lat: 43.36, lng: -8.41, pob: 250000, imp: true }
    const canonica = 'coruna-a-id15030'
    const doc = await ficha(coruna, null, url => {
      if (!url.pathname.includes('/municipios_h/')) return
      return xmlHoras(coruna, '<dia fecha="2026-11-07"><temperatura periodo="00">15</temperatura></dia>',
        AEMET_MUNICIPIOS+'horas/'+canonica)
    })
    expect(doc.querySelector('.panel a')?.getAttribute('href')).toBe(AEMET_MUNICIPIOS+canonica)
    expect(doc.querySelector('.fuente a')?.getAttribute('href')).toBe(AEMET_MUNICIPIOS+'horas/'+canonica)
  })

  it('comprueba el dominio y el municipio antes de aceptar la dirección del parte', () => {
    for (const falsa of ['https://ejemplo.invalid/es/eltiempo/prediccion/municipios/coruna-a-id15030',
      AEMET_MUNICIPIOS+'santiago-de-compostela-id15078', AEMET_MUNICIPIOS+'../../coruna-a-id15030']) {
      expect(urlMunicipioAemet(falsa,'15030')).toBeUndefined()
    }
    expect(urlMunicipioAemet(AEMET_MUNICIPIOS+'coruna-a-id15030','15030')).toBe(AEMET_MUNICIPIOS+'coruna-a-id15030')
  })

  it('enseña primero el rojo en vigor, agrupa sus fenómenos y deja los demás avisos en el desplegable', () => {
    const vigente = { inicio: '2026-11-06T21:00:00Z', fin: '2026-11-07T02:00:00Z' }
    const doc = parse(buildTiempoMunicipioPage('prueba', { municipio: DURANGO, pred: parte(DURANGO), horas: null,
      ahora: new Date(AHORA), canonical: 'https://prueba.example/tiempo/bizkaia/durango',
      avisos: { estado: 'verificado', zona: 'Interior de Bizkaia', consultado: AHORA, hasta: null,
        url: 'https://www.aemet.es/es/eltiempo/prediccion/avisos', avisos: [
          { ...vigente, nivel: 'amarillo', fenomeno: 'Viento' },
          { nivel: 'rojo', fenomeno: 'Nieve', inicio: '2026-11-07T04:00:00Z', fin: '2026-11-07T12:00:00Z' },
          { ...vigente, nivel: 'rojo', fenomeno: 'Lluvias' }, { ...vigente, nivel: 'rojo', fenomeno: 'Tormentas' },
        ] } }))
    const avisos = doc.querySelector('aside[aria-label="Avisos meteorológicos"]')!
    const primero = avisos.querySelector('div > strong')!
    expect(primero.text).toMatch(/rojo en vigor.*Lluvias y Tormentas/)
    const detalles = avisos.querySelector('details')!
    expect(detalles.hasAttribute('open')).toBe(false)
    expect(detalles.querySelector('summary')?.text).toContain('(2)')
    expect(detalles.text).toMatch(/amarillo en vigor.*Viento.*Próximo aviso rojo.*Nieve/s)
  })

  it('un parte viejo y dos proveedores caídos dan acceso al parte oficial sin mostrar temperaturas ni porcentajes anteriores', async () => {
    const vencida = { ...parte(DURANGO), elaborado: '2026-11-05T20:00:00Z' }
    const doc = await ficha(DURANGO, vencida)
    expect(doc.querySelector('main h2')?.text).toMatch(/Hoy.*sábado/)
    expect(doc.querySelectorAll('main table')).toHaveLength(0)
    expect(doc.querySelectorAll('.temperaturas,.lluvia')).toHaveLength(0)
    expect(doc.querySelector('main')?.text).toContain('pendiente de actualizar')
    expect(doc.querySelectorAll('main a').some(a => a.getAttribute('href')?.startsWith('https://www.aemet.es/'))).toBe(true)
    expect(doc.querySelector('meta[name=robots]')?.getAttribute('content')).toContain('noindex')
  })
})
