import { parse } from 'node-html-parser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLandingPage, landingHeaders, type LandingData } from '../src/html/landing'
import type { Localidad } from '../src/lib/localidades'
import type { CompeticionDeportiva, EventoDeportivo } from '../src/lib/deportes'
import { APP_VERSION } from '../src/lib/version'
import clienteMunicipal from '../src/client/municipio.js?raw'

const AHORA = '2026-11-07T23:30:00Z' // Ya es domingo en la Península; aún sábado en Canarias.
const PUBLICADO = '2026-11-07T21:45:00Z'
function localidad(ine = '48027'): Localidad {
  const canarias = ine.startsWith('35')
  return {
    ine, nombre: canarias ? 'Arrecife' : 'Durango', provinciaNombre: canarias ? 'Las Palmas' : 'Bizkaia',
    gas: { url: '/gasolineras/bizkaia/durango', ts: PUBLICADO, count: 5, min95: 1.321 },
    farmacias: { url: '/farmacias/bizkaia/durango', ts: PUBLICADO, count: 3, zona: canarias ? 'Atlantic/Canary' : 'Europe/Madrid' },
    itv: { url: '/itv/bizkaia', ts: PUBLICADO, count: 0 },
    tiempo: { url: '/tiempo/bizkaia/durango', pred: {
      ine, nombre: canarias ? 'Arrecife' : 'Durango', provincia: 'Prueba', fuente: 'AEMET', elaborado: PUBLICADO, versionPeriodos: 3,
      dias: [
        { fecha: '2026-11-07', tmax: 24, tmin: 15, cielo: 'Cielo del sábado', probLluvia: 0, viento: 5 },
        { fecha: '2026-11-08', tmax: 17, tmin: 8, cielo: 'Cielo del domingo', probLluvia: 50, viento: 10 },
      ],
    } },
  }
}
function liga(eventos: EventoDeportivo[]): CompeticionDeportiva {
  return {
    id: 'laliga-easports', nombre: 'LaLiga', deporte: 'futbol', temporada: '2026-2027', categoria: 'Primera División', zona: 'España',
    fuente: { nombre: 'Fuente de prueba', url: 'https://fuente.example/liga' }, comprobadoEn: PUBLICADO,
    agenda: { estado: 'actualizado', consultado: PUBLICADO, verificadoEn: PUBLICADO, fuenteUrl: 'https://fuente.example/liga', eventos },
    clasificacion: { estado: 'no_disponible', consultado: PUBLICADO, fuenteUrl: 'https://fuente.example/liga', tablas: [] },
  }
}
function pagina(data: LandingData) { return parse(buildLandingPage('prueba-nonce', 'https://prueba.example/', data)) }
function card(data: LandingData, id: string) { return pagina(data).querySelector('[data-dia-module="' + id + '"]')! }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(AHORA)) })
afterEach(() => vi.useRealTimers())

describe('Cerca de ti y Mi día conservan la verdad de los datos', () => {
  it('interpreta la elaboración de AEMET sin zona como hora peninsular, sin sumarle otra hora', () => {
    const m = localidad(); m.tiempo.pred!.elaborado = '2026-11-07T22:45:00'
    expect(card({ localidad: m }, 'tiempo').text).toContain('22:45')
    expect(card({ localidad: m }, 'tiempo').text).not.toContain('23:45')
  })
  it.each(['inicio', 'mi-dia'] as const)('%s elige el día local, incluida la hora de diferencia de Canarias', vista => {
    const peninsular = card({ vista, localidad: localidad() }, 'tiempo')
    const canaria = card({ vista, localidad: localidad('35004') }, 'tiempo')
    expect(peninsular.querySelector('.eu-weather-number')?.text).toBe('17°')
    expect(peninsular.text).toContain('Cielo del domingo')
    expect(peninsular.text).not.toContain('Cielo del sábado')
    expect(canaria.querySelector('.eu-weather-number')?.text).toBe('24°')
    expect(canaria.text).toContain('Cielo del sábado')
    expect(canaria.text).not.toContain('Cielo del domingo')
    expect(canaria.querySelector('a')?.getAttribute('href')).toBe('/tiempo/bizkaia/durango')
  })

  it.each(['2026-11-07T10:00:00Z', '2026-11-08T02:00:00Z'])('no presenta como vigente un parte caducado o futuro (%s)', elaborado => {
    const m = localidad(); m.tiempo.pred!.elaborado = elaborado
    const weather = card({ localidad: m, vista: 'mi-dia' }, 'tiempo')
    expect(weather.querySelector('.eu-weather-number')).toBeNull()
    expect(weather.text).toContain('No tenemos un resumen vigente para hoy')
    expect(weather.text).not.toContain('Previsión de hoy')
    expect(weather.querySelector('a')?.getAttribute('href')).toBe(m.tiempo.url)
  })

  it('conserva máximas y mínimas pero retira un cielo antiguo sin periodo verificado', () => {
    const m = localidad(); delete m.tiempo.pred!.versionPeriodos
    const weather = card({ localidad: m }, 'tiempo')
    expect(weather.querySelector('.eu-weather-number')?.text).toBe('17°')
    expect(weather.text).not.toContain('Cielo del domingo')
    expect(weather.text).toContain('Consulta la previsión por horas')
  })

  it.each(['2026-11-06T21:45:00Z', '2026-11-08T02:00:00Z'])('retira un precio local caducado o futuro y mantiene su enlace (%s)', ts => {
    const m = localidad(); m.gas.ts = ts
    const gas = card({ localidad: m, gasolina: { g95: 1.111, fecha: PUBLICADO } }, 'gasolineras')
    expect(gas.querySelector('.eu-price')).toBeNull()
    expect(gas.text).not.toContain('1,321')
    expect(gas.text).not.toContain('1,111')
    expect(gas.text).toContain('precios pendientes de actualizar')
    expect(gas.querySelector('a[href="/gasolineras/mapa"]')).not.toBeNull()
    expect(gas.querySelector('a[href="' + m.gas.url + '"]')).not.toBeNull()
  })

  it('no transforma un recuento municipal de farmacias en una afirmación de apertura', () => {
    const m = localidad()
    const pharmacy = card({ localidad: m }, 'farmacias')
    expect(pharmacy.text).not.toMatch(/3 (?:abiertas|de guardia)|abierta ahora|abiertas ahora/i)
    expect(pharmacy.text).toContain('Consultar turnos y horarios')
    expect(pharmacy.querySelector('a')?.getAttribute('href')).toBe(m.farmacias.url)
  })

  it('conserva resultados anteriores con su aviso y nunca calcula un directo por la hora', () => {
    const c = liga([
      { id: 'anterior', nombre: 'Norte – Sur', local: 'Norte', visitante: 'Sur', estado: 'finalizado', inicio: '2026-11-06T20:00:00Z', resultado: { local: 2, visitante: 1 } },
      { id: 'supuesto', nombre: 'Este – Oeste', local: 'Este', visitante: 'Oeste', estado: 'programado', inicio: '2026-11-07T22:00:00Z' },
    ])
    c.agenda.estado = 'conservado'; c.agenda.verificadoEn = '2026-11-06T22:00:00Z'
    const sport = card({ deporte: c, vista: 'mi-dia' }, 'deportes')
    expect(sport.querySelectorAll('.eu-score b').map(b => b.text)).toEqual(['2', '1'])
    expect(sport.text).toContain('Datos pendientes de actualizar')
    expect(sport.text).toContain('No es un marcador en directo')
    expect(sport.text).not.toContain('Este')
    expect(sport.querySelector('[data-dia-sport-favs]')).not.toBeNull()
  })

  it('el próximo partido enlaza al calendario donde se puede consultar', () => {
    const c = liga([{ id: 'proximo', nombre: 'Norte – Sur', local: 'Norte', visitante: 'Sur', estado: 'programado', inicio: '2026-11-08T20:00:00Z' }])
    const sport = card({ deporte: c }, 'deportes')
    expect(sport.text).toContain('Programado')
    expect(sport.querySelectorAll('.eu-score b').map(b => b.text)).toEqual(['—', '—'])
    expect(sport.querySelector('a[href="/deportes/competicion/laliga-easports?vista=calendario"]')).not.toBeNull()
    expect(sport.querySelector('a[href="/deportes/competicion/laliga-easports?vista=resultados"]')).toBeNull()
  })
})

describe('salida segura y navegación de la portada', () => {
  it('trata nombres, consultas y fechas externas como texto sin crear HTML activo', () => {
    const malicioso = '\"><img src=x onerror=alert(1)><script>alert(2)</script>'
    const m = localidad(); m.nombre = malicioso; m.provinciaNombre = malicioso; m.tiempo.pred!.dias[1].cielo = malicioso
    const c = liga([{ id: 'uno', nombre: malicioso, local: malicioso, visitante: malicioso, estado: 'finalizado', inicio: '2026-11-07T20:00:00Z', resultado: { local: 1, visitante: 0 } }])
    const doc = pagina({ localidad: m, query: malicioso, encontrados: [{ ine: '48027', nombre: malicioso, provinciaNombre: malicioso }], deporte: c })
    expect(doc.querySelectorAll('[onerror], [onclick], img[src="x"]')).toHaveLength(0)
    expect(doc.querySelectorAll('script:not([src]):not([type="application/ld+json"])')).toHaveLength(0)
    expect(doc.querySelector('[data-dia-module="deportes"]')?.text).toContain(malicioso)
    expect(doc.querySelector('[data-dia-module="tiempo"]')?.text).toContain(malicioso)
    expect(doc.querySelectorAll('[style]')).toHaveLength(0)
    const scripts = doc.querySelectorAll('script[src]').map(script => script.getAttribute('src'))
    expect(scripts).toEqual(['/static/cuenta.js?v=' + APP_VERSION, '/static/municipio.js?v=' + APP_VERSION, '/static/mi-dia.js?v=' + APP_VERSION])
    expect(doc.querySelector('style')?.getAttribute('nonce')).toBe('prueba-nonce')
    expect(landingHeaders('prueba-nonce')['Content-Security-Policy']).not.toContain('unsafe-inline')
    expect(landingHeaders('prueba-nonce')['Cache-Control']).toBe('no-store')
  })

  it('mantiene los seis servicios en HTML, con tres visibles inicialmente en Mi día y selección sin JS', () => {
    const doc = pagina({ vista: 'mi-dia', localidad: localidad(), query: 'Durango', encontrados: [{ ine: '48027', nombre: 'Durango', provinciaNombre: 'Bizkaia' }] })
    expect(doc.querySelectorAll('#mi-dia-modulos [data-dia-module]')).toHaveLength(6)
    expect(doc.querySelectorAll('#mi-dia-modulos [data-dia-module]:not([hidden])').map(el => el.getAttribute('data-dia-module'))).toEqual(['tiempo', 'gasolineras', 'deportes'])
    expect(doc.querySelectorAll('#localidad-servicios a')).toHaveLength(4)
    expect(doc.querySelector('#localidad-titulo')?.text).toBe('Tu municipio: Durango')
    expect(doc.querySelector('.localidad ul a')?.getAttribute('href')).toBe('/mi-dia?municipio=48027')
    expect(doc.querySelector('#mi-dia-personalizar')?.hasAttribute('hidden')).toBe(true)
    expect(doc.querySelector('link[rel="canonical"]')?.getAttribute('href')).toBe('https://prueba.example/mi-dia')
  })
})

describe('actualización de un mapa instalado al abrir Cerca de ti o Mi día', () => {
  function ejecutar(ruta: string, opciones: { controller?: boolean; registrado?: boolean; falla?: boolean; cargado?: boolean } = {}) {
    const listeners = new Map<string, () => void>()
    const update = vi.fn(async () => { if (opciones.falla) throw Error('sin conexión') })
    const register = vi.fn()
    const getRegistration = vi.fn(async () => opciones.registrado === false ? undefined : { update })
    const location = { href: 'https://prueba.example' + ruta, origin: 'https://prueba.example', replace: vi.fn(), assign: vi.fn(), reload: vi.fn() }
    new Function('document', 'location', 'localStorage', 'navigator', 'window', clienteMunicipal)(
      { getElementById: () => null, querySelector: () => null, readyState: opciones.cargado ? 'complete' : 'interactive' },
      location, { getItem: () => null },
      { serviceWorker: { controller: opciones.controller === false ? null : {}, getRegistration, register } },
      { addEventListener: (tipo: string, listener: () => void) => listeners.set(tipo, listener) },
    )
    return { listeners, update, getRegistration, register, location }
  }

  it.each(['/', '/mi-dia', '/mi-dia/?municipio=28079'])('%s comprueba el registro existente después de cargar, sin recargar ni registrar otro', async ruta => {
    const app = ejecutar(ruta)
    expect(app.getRegistration).not.toHaveBeenCalled()
    app.listeners.get('load')!()
    await Promise.resolve()
    expect(app.getRegistration).toHaveBeenCalledOnce()
    expect(app.update).toHaveBeenCalledOnce()
    expect(app.register).not.toHaveBeenCalled()
    expect(app.location.reload).not.toHaveBeenCalled()
    expect(app.location.replace).not.toHaveBeenCalled()
  })

  it('no crea registros si el visitante no tiene controlador ni repite el trabajo en otras secciones', async () => {
    const nuevo = ejecutar('/', { controller: false })
    nuevo.listeners.get('load')!()
    const seccion = ejecutar('/deportes/')
    expect(seccion.listeners.has('load')).toBe(false)
    const sinRegistro = ejecutar('/mi-dia', { registrado: false, cargado: true })
    await Promise.resolve()
    expect(nuevo.getRegistration).not.toHaveBeenCalled()
    expect(seccion.getRegistration).not.toHaveBeenCalled()
    for (const app of [nuevo, seccion, sinRegistro]) { expect(app.register).not.toHaveBeenCalled(); expect(app.update).not.toHaveBeenCalled() }
  })

  it('tolera un fallo de actualización sin interrumpir la página', async () => {
    const app = ejecutar('/mi-dia', { falla: true, cargado: true })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(app.update).toHaveBeenCalledOnce()
    expect(app.register).not.toHaveBeenCalled()
    expect(app.location.reload).not.toHaveBeenCalled()
  })
})
