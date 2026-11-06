import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extraeSeguimientoGenerales } from '../scripts/lib/politica-seguimiento.mjs'
import { process } from './helpers/process.mjs'

const candidaturas = ['pp', 'psoe', 'vox', 'sumar', 'cfv', 'aa', 'podemos'].map(id => ({ id }))
const url = 'https://x.com/la_septima_tv/status/2118437907077709868'
const titulo = '<h2>Electoral polling</h2><h3>Nationwide polling</h3><h4>Voting intention estimates</h4><h5>2026 (with Broad Front)</h5>'
const cabecera = '<tr><th>Polling firm/Commissioner</th><th>Fieldwork date</th><th>Sample size</th>'
  + ['PP', 'PSOE', 'Vox', 'FA', 'FV', 'Adelante Andalucía (2021)', 'Podemos'].map(p => '<th><a title="' + p + '"></a></th>').join('') + '</tr>'
const tabla = (filas: string) => '<table class="wikitable">' + cabecera + filas + '</table>'
const cita = (origen = url, fecha = '2026-11-05') => '<ol><li id="cite_note-emision-1"><cite><a class="external" href="' + origen + '">Encuesta La Séptima</a></cite>'
  + '<span class="Z3988" title="' + new URLSearchParams({ rft_id: origen, 'rft.date': fecha }).toString() + '"></span></li></ol>'
const fila = (dia: string, conEscanos = true, firma = 'SW Demoscopia/La Séptima') => {
  const escanos = (n: string) => conEscanos ? '<br><span style="font-size:75%">' + n + '</span>' : ''
  return '<tr><td>' + firma + '<sup><a href="#cite_note-emision-1">[1]</a></sup></td><td>' + dia + '</td><td>3,500</td>'
    + '<td>29.1' + escanos('118') + '</td><td>29.8' + escanos('126') + '</td><td>16.0' + escanos('61/63') + '</td>'
    + '<td colspan="2">5.0' + escanos('13') + '</td><td>?' + escanos('3') + '</td><td>1.3' + escanos('0') + '</td></tr>'
}

describe('seguimiento nacional adicional de La Séptima', () => {
  it('incorpora sólo proyecciones identificadas y separa campo de publicación', () => {
    const html = titulo + tabla(fila('4 Nov') + fila('3 Nov', false) + fila('2 Nov', true, 'Otra casa/La Séptima'))
      + '<h4>Direct voting intention</h4><h5>2026</h5>' + tabla(fila('1 Nov')) + cita()
    const { sondeos, incidencias } = extraeSeguimientoGenerales(html, candidaturas)
    expect(incidencias).toEqual([])
    expect(sondeos).toHaveLength(1)
    expect(sondeos[0]).toMatchObject({ empresa: 'SW Demoscopia', comitente: 'La Séptima', campoFin: '2026-11-04', publicacion: '2026-11-05', fuenteUrl: url, muestra: 3500 })
    expect(sondeos[0].datos).toEqual([
      { candidaturaId: 'pp', pct: 29.1, escanos: null },
      { candidaturaId: 'psoe', pct: 29.8, escanos: 126 },
      { candidaturaId: 'vox', pct: 16, escanos: { min: 61, max: 63 } },
      { candidaturaId: 'aa', pct: null, escanos: 3 },
      { candidaturaId: 'podemos', pct: 1.3, escanos: 0 },
    ])
  })

  it('rechaza otra sección, fuente no identificada, perfiles falsos y proyecciones duplicadas', () => {
    for (const seccion of ['Direct voting intention', 'Seat projections by blocs', 'Voting preferences']) {
      expect(extraeSeguimientoGenerales(titulo.replace('Voting intention estimates', seccion) + tabla(fila('4 Nov')) + cita(), candidaturas).sondeos).toEqual([])
    }
    for (const enlace of ['https://x.com/otro/status/1', 'https://laseptima.com.ejemplo.es/1', 'https://ejemplo.es']) {
      expect(extraeSeguimientoGenerales(titulo + tabla(fila('4 Nov')) + cita(enlace), candidaturas).sondeos).toEqual([])
    }
    const duplicada = extraeSeguimientoGenerales(titulo + tabla(fila('4 Nov') + fila('4 Nov')) + cita(), candidaturas)
    expect(duplicada.sondeos).toEqual([])
    expect(duplicada.incidencias.join(' ')).toContain('Dos proyecciones')
  })

  it('conserva un PP posterior, y no inventa una fecha de publicación que la cita no facilita', () => {
    const sinFecha = extraeSeguimientoGenerales(titulo + tabla(fila('6 Nov')) + cita(url, ''), candidaturas)
    expect(sinFecha.sondeos[0]).not.toHaveProperty('publicacion')
    expect(sinFecha.sondeos[0].datos[0].escanos).toBe(118)
    expect(extraeSeguimientoGenerales(titulo + tabla(fila('6 Nov')) + cita(url, '2026-11-05'), candidaturas).sondeos).toEqual([])
  })
})

// Ejecuta el robot por su vía habitual (--solo generales), con dos respuestas
// controladas y un sistema de archivos en memoria que persiste entre pasadas.
const archivos = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', async importar => {
  const fs = await importar<Record<string, unknown>>()
  const nombre = (ruta: string) => ruta.split(/[\\/]/).at(-1)!
  return { ...fs, mkdirSync: vi.fn(), existsSync: (r: string) => archivos.has(nombre(r)),
    readFileSync: (r: string) => archivos.get(nombre(r)),
    writeFileSync: (r: string, v: string) => archivos.set(nombre(r), v) }
})

describe('actualización de las dos fuentes del Congreso', () => {
  const argv = process.argv
  const leer = (nombre: string) => JSON.parse(archivos.get(nombre)!)
  const inglesa = titulo + tabla(fila('4 Nov')) + cita()
  const htmlES = (otra: string) => '<h2>2026</h2>' + tabla(fila('4 Nov', true, 'SW Demoscopia/La Séptima') + fila('5 Nov', true, otra))

  beforeEach(() => {
    archivos.clear()
    process.argv = [...argv.slice(0, 2), '--solo', 'generales']
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => { process.argv = argv; vi.useRealTimers(); vi.unstubAllGlobals() })

  async function pasada(dia: string, ES: string, EN: string) {
    vi.setSystemTime(new Date(dia + 'T12:00:00Z'))
    archivos.delete('politica-run.json')
    const peticiones: string[] = []
    vi.stubGlobal('fetch', async (url: URL) => {
      const idioma = url.hostname.split('.')[0]
      peticiones.push(idioma)
      return Response.json({ parse: { title: url.searchParams.get('page'), text: idioma === 'en' ? EN : ES, pageid: 10, revid: 42 } })
    })
    vi.resetModules()
    const programa = '../scripts/fetch-politica.mjs'
    await import(programa)
    await vi.waitFor(() => expect(archivos.has('politica-run.json')).toBe(true), { timeout: 4000 })
    return { file: leer('generales.json'), entrada: leer('index.json').elecciones[0], parte: leer('politica-run.json'), peticiones }
  }

  it('resuelve el duplicado y, si falla el seguimiento, actualiza España y conserva la ola, su fuente y la comprobación completa', async () => {
    const buena = await pasada('2026-11-06', htmlES('Casa antigua'), inglesa)
    expect(buena.file.sondeos).toHaveLength(2)
    const sw = buena.file.sondeos.find((s: { empresa: string }) => s.empresa === 'SW Demoscopia')
    expect(sw.datos[0]).toMatchObject({ candidaturaId: 'pp', pct: 29.1, escanos: null })
    expect(sw.publicacion).toBe('2026-11-05')
    expect(buena.entrada.estado).toBe('ok')
    expect(buena.parte.fallos).toHaveLength(0)

    const parcial = await pasada('2026-11-07', '<h2>2026</h2>' + tabla(fila('7 Nov', true, 'Nueva española')), '<p>Sin tabla</p>')
    expect(parcial.file.sondeos.map((s: { empresa: string }) => s.empresa)).toEqual(['Nueva española', 'SW Demoscopia'])
    expect(parcial.file.sondeos[1]).toEqual(sw)
    expect(parcial.file.procedenciasAdicionales).toEqual(buena.file.procedenciasAdicionales)
    expect(parcial.file.procedencia.obtenido).toBe('2026-11-07T12:00:00.000Z')
    expect(parcial.file.ultimaComprobacionOk).toBe(buena.file.ultimaComprobacionOk)
    expect(parcial.entrada).toMatchObject({ estado: 'desactualizado', ultimaComprobacionOk: buena.file.ultimaComprobacionOk })
    expect(parcial.parte).toMatchObject({ escritas: 1, fallos: [{ id: 'generales', parcial: true }] })
  })

  it('oculta las encuestas durante la veda y después conserva la española aunque ya no quede copia del seguimiento', async () => {
    await pasada('2026-11-06', htmlES('Casa antigua'), inglesa)
    const veda = await pasada('2026-11-26', htmlES('Casa'), '')
    expect(veda.peticiones).toEqual(['es'])
    expect(veda.file.sondeos).toEqual([])
    expect(veda.file.procedenciasAdicionales).toBeUndefined()
    const despues = await pasada('2026-11-30', '<h2>2026</h2>' + tabla(fila('30 Nov', true, 'Nueva española')), '')
    expect(despues.file.sondeos).toHaveLength(1)
    expect(despues.file.sondeos[0].empresa).toBe('Nueva española')
    expect(despues.file.procedenciasAdicionales).toBeUndefined()
    expect(despues.file.ultimaComprobacionOk).toBe(veda.file.ultimaComprobacionOk)
    expect(despues.parte.fallos[0].parcial).toBe(true)
  })
})
