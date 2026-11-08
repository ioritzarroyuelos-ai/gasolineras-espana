import { describe, it, expect, vi } from 'vitest'
import mapSource from '../src/client/map.js?raw'
import uiSource from '../src/client/ui.js?raw'
import coreSource from '../src/client/core.js?raw'
import featuresSource from '../src/client/features.js?raw'
import { buildPage } from '../src/html/shell'
import { mastheadHtml } from '../src/html/masthead'

// Ejecutamos funciones del cliente real con las dependencias de navegador aisladas.
function sourceFunction(source: string, name: string) {
  const start = source.indexOf('function ' + name + '(')
  if (start < 0) throw new Error('Missing function: ' + name)
  const end = source.indexOf('\n}', start)
  if (end < 0) throw new Error('Missing function end: ' + name)
  return source.slice(start, end + 2)
}
function runFunction(source: string, name: string, deps: Record<string, unknown> = {}) {
  return new Function(...Object.keys(deps), sourceFunction(source, name) + '\nreturn ' + name)(...Object.values(deps))
}
const fuelUnit = runFunction(coreSource, 'fuelUnit')
const esc = (text: unknown) => String(text ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

function reportForm() {
  const fields: Record<string, any> = {}
  for (const id of ['modal-report', 'report-context', 'report-reason', 'report-price', 'report-price-unit', 'report-comment', 'report-status', 'btn-report-close', 'btn-report-cancel', 'btn-report-submit']) {
    fields[id] = { value: '', textContent: '', innerHTML: '', disabled: false, handlers: {}, focus() {},
      classList: { add() {}, remove() {} },
      addEventListener(event: string, callback: (...args: unknown[]) => unknown) { this.handlers[event] = callback },
    }
  }
  const target = featuresSource.indexOf("  var modal = document.getElementById('modal-report');")
  const start = featuresSource.lastIndexOf('(function() {', target)
  const window: Record<string, any> = {}
  const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200 })
  new Function('document', 'window', 'esc', 'fetch', 'setTimeout', 'showToast', featuresSource.slice(start))(
    { getElementById: (id: string) => fields[id], addEventListener() {} }, window, esc, fetch, () => 0, () => {},
  )
  return { fields, fetch, open: window.openReportModal, submit: () => fields['btn-report-submit'].handlers.click() }
}

describe('reportar precios con su unidad real', () => {
  it.each(['gnc', 'gnl', 'hidrogeno'])('muestra €/kg para %s y envía el precio completo, sin sustituirlo por null', async (fuel) => {
    const form = reportForm()
    form.open('1445', fuel, 25, 'REPSOL')
    expect(form.fields['report-price-unit'].textContent).toBe('€/kg')
    expect(form.fields['report-context'].innerHTML).toContain('25,000 €/kg')
    form.fields['report-price'].value = '25,500'
    await form.submit()
    expect(form.fetch).toHaveBeenCalledTimes(1)
    expect(JSON.parse(form.fetch.mock.calls[0][1].body)).toMatchObject({ fuel, officialPriceEur: 25, reportedPriceEur: 25.5 })
  })

  it.each([
    ['95', '10,01', '10,00 €/L'], ['hidrogeno', '100,01', '100,00 €/kg'], ['gnc', '2,10texto', '100,00 €/kg'],
  ])('rechaza el precio inválido de %s antes de enviarlo', async (fuel, price, message) => {
    const form = reportForm()
    form.open('1445', fuel, 1.5, 'Prueba')
    form.fields['report-price'].value = price
    await form.submit()
    expect(form.fetch).not.toHaveBeenCalled()
    expect(form.fields['report-status'].textContent).toContain(message)
  })
})

describe('gasolineras: controles públicos y unidades', () => {
  it('permite abrir favoritas y elegir litros sin sesión, con un solo buscador de zona', () => {
    const html = buildPage('', 'https://example.test/gasolineras/mapa', { mapTool: true })
    expect(html).toContain('id="btn-favs-open"')
    expect(html).toContain('id="in-refuel-litres"')
    expect(html).toContain('id="btn-refresh"')
    expect(html).toContain('Solo este municipio')
    expect(html).toContain('También cerca')
    expect(html).not.toContain('id="municipio-busqueda"')
    expect(html.match(/id="btn-login"/g)).toHaveLength(1)
    expect(html).not.toContain('id="app-header"')
    expect(mastheadHtml('tiempo')).toContain('id="municipio-busqueda"')
  })

  it.each(['Precio Gas Natural Comprimido', 'Precio Gas Natural Licuado', 'Precio Hidrogeno'])('muestra %s en €/kg y oculta litros', (fuel) => {
    const format = runFunction(mapSource, 'fmtPriceUnit', { fuelUnit })
    expect(format(1.88, fuel)).toBe('1,880 €/kg')
    const fields: Record<string, any> = {
      'sel-combustible': { value: fuel }, 'in-refuel-litres': { value: '' },
      'refuel-litres-group': { hidden: false }, 'fuel-unit-note': { hidden: true },
    }
    runFunction(uiSource, 'refreshRefuelControls', {
      document: { getElementById: (id: string) => fields[id] }, fuelUnit, getRefuelLitres: () => 30,
    })()
    expect(fields['refuel-litres-group'].hidden).toBe(true)
    expect(fields['fuel-unit-note'].hidden).toBe(false)
    expect(fields['in-refuel-litres'].value).toBe('30')
  })
})

describe('compartir una estación y cómo llegar', () => {
  const station = { IDEESS: '14612', IDProvincia: '02', Rotulo: 'NATURGY', Direccion: 'Calle Sexta, 2', Municipio: 'Albacete' }
  it('comparte ID, provincia y combustible, nunca la ubicación privada del visitante', () => {
    const data = runFunction(uiSource, 'stationShareData', {
      window: { location: { origin: 'https://example.test', href: 'https://example.test/gasolineras/mapa#near=39.1,-1.8' } },
      document: { getElementById: () => ({ value: 'Precio Gas Natural Comprimido' }) },
      stationId: (s: typeof station) => s.IDEESS,
    })(station)
    const url = new URL(data.url)
    expect(url.pathname).toBe('/gasolineras/mapa')
    expect(url.searchParams.get('station')).toBe('14612')
    expect(url.searchParams.get('prov')).toBe('02')
    expect(url.searchParams.get('fuel')).toBe('Precio Gas Natural Comprimido')
    expect(url.hash).toBe('')
    expect(data.text).toContain('Calle Sexta, 2')
  })

  it('abre la estación compartida concreta y solo una vez tras cargar los datos', () => {
    const zoomTo = vi.fn()
    const restore = runFunction(uiSource, 'restoreSharedStation', {
      sharedStationId: '14612', sharedStationRestored: false,
      filteredStations: [{ IDEESS: '11' }, station], stationId: (s: any) => s.IDEESS, zoomTo,
    })
    restore()
    restore()
    expect(zoomTo).toHaveBeenCalledTimes(1)
    expect(zoomTo).toHaveBeenCalledWith(1)
  })

  it('los tres navegadores reciben las mismas coordenadas, incluidos signos negativos', () => {
    const build = runFunction(mapSource, 'buildNavigationLinks')
    const html = build(28.123456, -15.4321, 'Estación & prueba')
    const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => new URL(m[1].replace(/&amp;/g, '&')))
    expect(links).toHaveLength(3)
    expect(links[0].searchParams.get('destination')).toBe('28.123456,-15.432100')
    expect(links[1].searchParams.get('ll')).toBe('28.123456,-15.432100')
    expect(links[1].searchParams.get('navigate')).toBe('yes')
    expect(links[2].searchParams.get('daddr')).toBe('28.123456,-15.432100')
    expect(links[2].searchParams.get('q')).toBe('Estación & prueba')
    expect(build(NaN, -15, 'Sin posición')).toBe('')
  })

  it('valida el fragmento privado GPS y elige Canarias antes de pintar', () => {
    const read = runFunction(uiSource, 'readNearLocation')
    expect(read('#near=28.12,-15.43')).toEqual({ lat: 28.12, lng: -15.43 })
    expect(read('#near=91,0')).toBeNull()
    expect(read('#near=28.12,bad')).toBeNull()
    const setMapRegion = vi.fn()
    runFunction(uiSource, 'syncSearchMapRegion', {
      document: { getElementById: () => ({ value: '' }) }, searchOrigin: read('#near=28.12,-15.43'),
      isCanarias: (lat: number, lng: number) => lat < 30 && lng < -13, setMapRegion,
    })()
    expect(setMapRegion).toHaveBeenCalledWith('canarias', true)
  })
})

describe('horarios, historial y recarga sin promesas falsas', () => {
  it('la ficha usa los litros elegidos, explica la comparación y no inventa costes por carretera', () => {
    const deps = {
      document: { getElementById: () => ({ value: 'Precio Gasolina 95 E5' }) },
      FUELS_POPUP: [['Precio Gasolina 95 E5', 'Gasolina 95']], FUEL_CODES_BY_LABEL: {}, REPORT_FUEL_CODES: {},
      parsePrice: (price: string) => Number(price), priceColor: () => 'green', stationId: () => '1', isFav: () => false,
      isOpenNow: () => null, fuelUnit, getRefuelLitres: () => 30, searchOrigin: null,
      munCenter: { lat: 40, lng: -3 }, distanceKm: () => 7.7, currentMedianPrice: 1.6,
      buildHistoryPlaceholder: () => '', buildNavigationLinks: () => '', compareIds: [], filteredStations: [],
      horarioPopup: () => '', esc,
    }
    const station = { 'Precio Gasolina 95 E5': '1.5', Latitud: '40', 'Longitud (WGS84)': '-3' }
    const popup = runFunction(mapSource, 'buildPopup', deps)(station)
    expect(popup).toContain('3,00 € menos por 30 L')
    expect(popup).toContain('No incluye el desplazamiento')
    expect(popup).toContain('7,7 km en línea recta desde el centro de la zona elegida')
    expect(popup).not.toContain(' min')
    expect(popup).not.toContain('Ahorro neto')
    const gasPopup = runFunction(mapSource, 'buildPopup', {
      ...deps, document: { getElementById: () => ({ value: 'Precio Hidrogeno' }) },
    })({ ...station, 'Precio Hidrogeno': '9.9' })
    expect(gasPopup).toContain('€/kg')
    expect(gasPopup).not.toContain('menos por')
  })

  it('no convierte un tramo del sábado o medianoche ambigua en abierto 24 horas todos los días', () => {
    const is24H = runFunction(mapSource, 'is24H')
    expect(is24H('S: 00:00-24:00')).toBe(false)
    expect(is24H('L-D: 00:00-00:00')).toBe(false)
    expect(is24H('L-D: 24H')).toBe(true)
    expect(is24H('L-D: 00:00-24:00')).toBe(true)
  })

  it('el historial de 7 días no sustituye datos ausentes con los de octubre', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-04T12:00:00Z'))
    try {
      const renderHistoryBody = vi.fn()
      const body = { innerHTML: '', appendChild: vi.fn() }
      const render = runFunction(mapSource, 'renderFallbackLocal', {
        getHistory: () => ({ '1|fuel': [{ d: '2026-10-01', p: 1.7 }, { d: '2026-10-02', p: 1.6 }] }),
        renderHistoryBody, document: { createElement: () => ({}) },
      })
      render(body, '1', 'fuel', 7)
      expect(renderHistoryBody).not.toHaveBeenCalled()
      expect(body.innerHTML).toContain('Sin datos suficientes para este rango')
    } finally { vi.useRealTimers() }
  })

  it('la ficha eléctrica muestra la fecha del directorio, límites y navegación', () => {
    const chargerDateLabel = runFunction(mapSource, 'chargerDateLabel')
    const buildNavigationLinks = runFunction(mapSource, 'buildNavigationLinks')
    const popup = runFunction(mapSource, 'buildChargerPopup', {
      esc, chargerDateLabel, buildNavigationLinks, chargersUpdatedAt: '2026-11-03T12:45:25Z',
    })([39.59, 2.63, 'Recarga', 'Operador', 350, 'CCS', 2, 'dgt'])
    expect(popup).toContain('03/11/2026')
    expect(popup).toContain('No indica si está libre o funcionando')
    expect(popup).toContain('Cómo llegar')
    expect(popup).toContain('www.google.com/maps/dir/')
    expect(chargerDateLabel('')).toBe('Fecha del directorio no disponible')
  })
})
