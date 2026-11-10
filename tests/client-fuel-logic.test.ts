import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error The app tsconfig exposes browser/worker types; Vitest runs this isolated harness in Node.
import { createContext, runInContext } from 'node:vm'
import core from '../src/client/core.js?raw'
import list from '../src/client/list.js?raw'

// Execute the shipped client functions, with only their browser/network edges mocked.
function section(source: string, start: string, end: string) {
  source = source.replace(/\r\n/g, '\n') // Mismo código con saltos de línea de Windows o Linux.
  const from = source.indexOf(start), to = source.indexOf(end, from)
  if (from < 0 || to < 0) throw new Error(`Missing client section: ${start}`)
  return source.slice(from, to)
}
function client() {
  const storage = new Map<string, string>()
  const nodes: Record<string, any> = {}
  function node(id: string) {
    return nodes[id] ||= { value: '', style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }
  }
  node('sel-provincia').value = '28'
  node('sel-municipio').value = '28079'
  node('sel-combustible').value = 'Precio Gasolina 95 E5'
  node('in-radius').value = '10'
  const context: any = createContext({
    console: { error: vi.fn(), warn: vi.fn() },
    document: { getElementById: node, createElement: () => node('created'), createTextNode: (s: string) => ({ textContent: s }) },
    localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) },
    syncPush: vi.fn(), allStations: [], filteredStations: [],
    parsePrice: (p: any) => p ? Number(String(p).replace(',', '.')) : null,
    normalizeStation: (s: any) => s,
    renderMarkers: vi.fn(), renderList: vi.fn(), renderFavsPanel: vi.fn(),
    recordHistoryForTracked: vi.fn(), renderSkeletons: vi.fn(),
    showListError: vi.fn(), showToast: vi.fn(), fetchJSON: vi.fn(),
    lsRead: () => null, lsWrite: vi.fn(), restoreSharedStation: vi.fn(),
    topCheapIds: {}, listPriceStats: null, currentMedianPrice: null,
  })
  runInContext(section(core, 'function distanceKm(', '// Mapa de codigos cortos'), context)
  runInContext(section(core, 'var PROFILE_KEY', '// ---- FAVORITOS'), context)
  runInContext(section(core, 'var DAY_MAP', '// ---- FETCH CON RETRY'), context)
  runInContext(section(list, '// ---- SORT & FILTER', '// ---- NORMALIZACION'), context)
  // DOM painting is an edge of the loading/filtering tests, not the subject.
  context.renderSkeletons = vi.fn()
  return { c: context, storage, node }
}
function station(id: string, lat = '40,4168', lng = '-3,7038') {
  return { IDEESS: id, IDProvincia: '28', IDMunicipio: '28079', Latitud: lat, 'Longitud (WGS84)': lng, 'Precio Gasolina 95 E5': '1,500' }
}
function response(id: string) { return { Fecha: '04/11/2026 12:00:00', ListaEESSPrecio: [station(id)] } }
describe('coordenadas de estaciones sin inventar ubicaciones', () => {
  it('rechaza ceros, infinito y la coordenada invertida de Tui', () => {
    const { c } = client()
    for (const [lat, lng] of [['0','0'], ['-8,659472','42,037472'], ['Infinity','-3']])
      expect(c.stationLatLng(station('16268', lat, lng))).toBeNull()
  })
  it('conserva península, Baleares, Canarias y ciudades autónomas', () => {
    const { c } = client()
    for (const [lat, lng] of [['42,037472','-8,659472'], ['39,57','2,65'], ['27,73','-18,0'], ['35,89','-5,31'], ['35,29','-2,94']])
      expect(c.stationLatLng(station('1', lat, lng))).not.toBeNull()
  })
})
function deferred() {
  let resolve!: (value: any) => void
  const promise = new Promise<any>(r => { resolve = r })
  return { promise, resolve }
}

describe('actual client opening hours in the station timezone', () => {
  it('parses valid times and rejects impossible or ambiguous hours', () => {
    const { c } = client()
    expect(c.parseTime('06:30')).toBe(390)
    expect(c.parseTime('24:00')).toBe(1440)
    for (const t of ['25:00', '24:01', '10:60', 'dd:dd', 'x10:20']) expect(c.parseTime(t)).toBeNull()
    expect(c.isOpenNow('L-D: 00:00-00:00')).toBeNull()
    expect(c.isOpenNow('Horario pendiente')).toBeNull()
  })
  it('respects weekdays even for a 24-hour interval', () => {
    const { c } = client()
    const wed = new Date('2026-11-04T12:00:00Z')
    expect(c.isOpenNow('S: 24H', {}, wed).open).toBe(false)
    expect(c.isOpenNow('L - V: 06:00-22:00; S: 24H; D: cerrado', {}, wed).open).toBe(true)
    expect(c.isOpenNow('24H', {}, wed).open).toBe(true)
  })
  it('handles two daily intervals, exact closing and overnight from yesterday', () => {
    const { c } = client()
    expect(c.isOpenNow('L-D: 08:00-13:00 y 16:00-22:00', {}, new Date('2026-11-04T13:00:00Z'))).toMatchObject({ open: false, opensAt: '16:00' })
    expect(c.isOpenNow('L-D: 08:00-22:00', {}, new Date('2026-11-04T21:00:00Z')).open).toBe(false)
    expect(c.isOpenNow('V: 22:00-02:00', {}, new Date('2026-11-07T00:30:00Z'))).toMatchObject({ open: true, closesAt: '02:00' })
    expect(c.isOpenNow('V: 22:00-02:00', {}, new Date('2026-11-07T02:00:00Z')).open).toBe(false)
  })
  it('uses Canary time for Canary stations, including daylight saving', () => {
    const { c } = client()
    for (const now of ['2026-11-04T07:30:00Z', '2026-07-01T06:30:00Z']) {
      expect(c.isOpenNow('L-D: 08:00-22:00', { IDProvincia: '28' }, new Date(now)).open).toBe(true)
      expect(c.isOpenNow('L-D: 08:00-22:00', { IDProvincia: '35' }, new Date(now)).open).toBe(false)
    }
    expect(c.stationTimeZone(station('1', '28,4', '-16,3'))).toBe('Atlantic/Canary')
  })
})

describe('simple preferences and actual fuel units', () => {
  it('removes invisible legacy filters and consumption, while migrating valid litres', () => {
    const { c, storage } = client()
    storage.set('gs_profile_v1', JSON.stringify({ strictFuel: true, consumo: 8, fuel: 'Precio Gasoleo A' }))
    storage.set('gs_tank', '65')
    expect(c.getProfile()).toEqual({ version: 2, fuel: 'Precio Gasoleo A', litres: 65 })
    expect(JSON.parse(storage.get('gs_profile_v1')!)).toEqual({ version: 2, fuel: 'Precio Gasoleo A', litres: 65 })
    expect(storage.has('gs_tank')).toBe(false)
    c.setProfile({ ...c.getProfile(), litres: 200 })
    expect(c.getRefuelLitres()).toBe(200)
    for (const n of [0, -1, 201, NaN, Infinity, 'invalid']) expect(c.setProfile({ ...c.getProfile(), litres: n }).litres).toBe(50)
  })
  it('uses kg for GNC, GNL and hydrogen, but litres for GLP and petrol', () => {
    const { c } = client()
    for (const fuel of ['Precio Gas Natural Comprimido', 'Precio Gas Natural Licuado', 'Precio Hidrogeno']) expect(c.fuelUnit(fuel)).toBe('kg')
    for (const fuel of ['Precio Gasolina 95 E5', 'Precio Gases licuados del petroleo', 'Precio Gasoleo A']) expect(c.fuelUnit(fuel)).toBe('L')
  })
  it('does not invent a 50-litre tank or savings for a fuel sold by kilogram', () => {
    const { c } = client()
    Object.assign(c, {
      esc: (value: any) => String(value), isFav: () => false, priceColor: () => 'green',
      horarioCard: () => '', fmtPriceUnit: (price: number, fuel: string) => price.toFixed(3) + ' €/' + c.fuelUnit(fuel),
      currentMedianPrice: 2,
    })
    runInContext(section(list, 'function cardHTML(', 'function appendPage('), c)
    const gas = { ...station('gas'), 'Precio Gas Natural Comprimido': '1,5' }
    const gasHtml = c.cardHTML(gas, 0, 'Precio Gas Natural Comprimido', 'GNC')
    expect(gasHtml).toContain('€/kg')
    expect(gasHtml).not.toContain('row-tank-cost')
    expect(gasHtml).not.toContain('savings-badge')
    c.setProfile({ ...c.getProfile(), litres: 60 })
    const petrolHtml = c.cardHTML(station('petrol'), 0, 'Precio Gasolina 95 E5', 'Gasolina 95')
    expect(petrolHtml).toContain('60 L = 90.00 €')
    expect(petrolHtml).toContain('ahorras 30.00 € en 60 L')
  })
  it('sanitizes a legacy profile before asking the shared account to save it', async () => {
    const { c, storage } = client()
    c.window = { EUCuenta: { changed: vi.fn().mockResolvedValue(undefined) } }
    runInContext(section(core, 'function syncPush(', 'function isFav('), c)
    c.setProfile({ fuel: 'Precio Gasoleo A', litres: 55, strictFuel: true, consumo: 7 })
    expect(JSON.parse(storage.get('gs_profile_v1')!)).toEqual({ version: 2, fuel: 'Precio Gasoleo A', litres: 55 })
    expect(c.window.EUCuenta.changed).toHaveBeenCalledWith('gs_profile_v1')
  })
  it('does not hide stations using a saved, now removed, strictFuel switch', () => {
    const { c, storage } = client()
    storage.set('gs_profile_v1', JSON.stringify({ strictFuel: true }))
    c.allStations = [station('with-price'), { ...station('no-price'), 'Precio Gasolina 95 E5': '' }]
    c.applyFilters()
    expect(c.filteredStations.map((s: any) => s.IDEESS)).toEqual(['with-price', 'no-price'])
  })
  it('cleans old browser alerts and diary without touching Telegram', () => {
    const { c, storage } = client()
    for (const key of ['gs_alerts_on', 'gs_alerts_base_v1', 'gs_alerts_last_v1', 'gs_alerts_v1', 'gs_diary_v1', 'gs_tg_auth_v1']) storage.set(key, 'saved')
    runInContext(section(core, '(function clearLegacyAlerts()', '// ============================================================\n// Ship 25:'), c)
    expect([...storage.keys()]).toEqual(['gs_tg_auth_v1'])
  })
  it('never converts a selected gas fuel into a petrol Telegram alert', async () => {
    const { c, node } = client()
    runInContext(section(core, 'function fuelSelectorToCode()', '// Polling hasta confirmar'), c)
    c.fetch = vi.fn()
    node('sel-combustible').value = 'Precio Gas Natural Comprimido'
    expect(c.fuelSelectorToCode()).toBeNull()
    await expect(c.startTelegramLink([{ id: '123' }])).resolves.toMatchObject({ ok: false, error: 'combustible_no_disponible' })
    expect(c.fetch).not.toHaveBeenCalled()
    node('sel-combustible').value = 'Precio Gasoleo A'
    expect(c.fuelSelectorToCode()).toBe('diesel')
  })
})

describe('real station loader and filters', () => {
  it('forced refresh downloads even with a fresh provincial cache and a municipality selected', async () => {
    const { c } = client()
    c.setCache('gs_v2_28_all', [station('old')], '03/11/2026 10:00:00')
    c.fetchJSON.mockResolvedValue(response('new'))
    await c.loadStations()
    expect(c.fetchJSON).not.toHaveBeenCalled()
    expect(c.allStations[0].IDEESS).toBe('old')
    await expect(c.forceReload()).resolves.toBe(true)
    expect(c.fetchJSON).toHaveBeenCalledWith('/api/estaciones/provincia/28', { cache: 'no-store' })
    expect(c.allStations[0].IDEESS).toBe('new')
  })
  it('ignores a response from the province the user has already left', async () => {
    const { c, node } = client(), madrid = deferred(), barcelona = deferred()
    c.fetchJSON.mockImplementation((url: string) => url.endsWith('/28') ? madrid.promise : barcelona.promise)
    const first = c.loadStations()
    node('sel-provincia').value = '08'
    node('sel-municipio').value = ''
    const second = c.loadStations()
    barcelona.resolve(response('Barcelona')); await second
    madrid.resolve(response('Madrid')); await first
    expect(c.allStations[0].IDEESS).toBe('Barcelona')
    expect(c.renderList).toHaveBeenCalledTimes(1)
  })
  it('keeps the refresh promise pending until the network finishes and exposes failure', async () => {
    const { c } = client(), network = deferred()
    c.fetchJSON.mockReturnValue(network.promise)
    let complete = false
    const loading = c.forceReload().then((result: boolean) => { complete = true; return result })
    await Promise.resolve()
    expect(complete).toBe(false)
    network.resolve({ error: 'unavailable' })
    await expect(loading).resolves.toBe(false)
    expect(c.showListError).toHaveBeenCalled()
  })
  it('does not replace municipality choices with a late response for another province', async () => {
    const { c, node } = client(), first = deferred(), second = deferred()
    c.fillMunicipios = vi.fn()
    c.fetchJSON.mockImplementation((url: string) => url.endsWith('/28') ? first.promise : second.promise)
    const old = c.loadMunicipios('28')
    node('sel-provincia').value = '08'
    const current = c.loadMunicipios('08')
    const barcelona = [{ IDMunicipio: '08019', Municipio: 'Barcelona' }]
    second.resolve(barcelona); await current
    first.resolve([{ IDMunicipio: '28079', Municipio: 'Madrid' }]); await old
    expect(c.fillMunicipios).toHaveBeenCalledTimes(1)
    expect(c.fillMunicipios.mock.calls[0][1]).toEqual(barcelona)
  })
  it('searches around actual GPS across provincial boundaries and never stores coordinates', async () => {
    const { c, node, storage } = client()
    node('sel-provincia').value = ''
    c.setSearchOrigin({ lat: 40.4168, lng: -3.7038 })
    c.fetchJSON.mockResolvedValue({ Fecha: '04/11/2026 12:00:00', ListaEESSPrecio: [station('close'), { ...station('other-province', '40,42', '-3,70'), IDProvincia: '99' }, station('far', '41,5', '-3,7')] })
    await c.loadStations()
    expect(c.fetchJSON).toHaveBeenCalledWith('/data/stations.json', undefined)
    expect(c.filteredStations.map((s: any) => s.IDEESS)).toEqual(['close', 'other-province'])
    expect([...storage.keys()]).toEqual(['gs_v2_near_all'])
    expect(c.munCenter).toEqual({ lat: 40.4168, lng: -3.7038 })
    c.setSearchOrigin({ lat: 91, lng: 0 }); expect(c.searchOrigin).toBeNull()
    c.setSearchOrigin({ lat: 40, lng: Infinity }); expect(c.searchOrigin).toBeNull()
  })
  it('keeps municipality results separate from nearby towns and crosses province borders only in nearby mode', async () => {
    const { c, node } = client()
    const town = station('Madrid')
    const neighbour = { ...station('neighbour', '40,42', '-3,70'), IDMunicipio: '99999', IDProvincia: '99' }
    c.fetchJSON.mockResolvedValue({ Fecha: '04/11/2026 12:00:00', ListaEESSPrecio: [town, neighbour] })
    await c.loadStations()
    expect(c.filteredStations.map((s: any) => s.IDEESS)).toEqual(['Madrid'])
    expect(node('radius-group').style.display).toBe('none')
    node('sel-area').value = 'cerca'
    await c.loadStations()
    expect(c.fetchJSON).toHaveBeenLastCalledWith('/data/stations.json', undefined)
    expect(c.filteredStations.map((s: any) => s.IDEESS)).toEqual(['Madrid', 'neighbour'])
    expect(node('radius-group').style.display).toBe('block')
  })
})
