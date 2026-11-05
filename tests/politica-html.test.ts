import { describe, it, expect } from 'vitest'
import { parse } from 'node-html-parser'
import { buildEleccionPage, buildIndexPage } from '../src/html/politica'
import { eleccionPorId } from '../scripts/lib/politica-catalogo.mjs'
import type { EleccionFile } from '../src/lib/politica-schemas'

const cat = eleccionPorId('madrid')!

function fileCon(empresa: string): EleccionFile {
  return {
    schemaVer: 1, id: 'madrid', tipo: 'autonomica', ciclo: '2023',
    camara: { nombre: 'Asamblea de Madrid', escanos: 143, mayoria: 72 },
    candidaturas: [{ id: 'pp', nombre: 'Partido Popular', siglas: 'PP' }, { id: 'psoe', nombre: 'PSOE', siglas: 'PSOE' }],
    referencia: { fecha: '2023-05-28', escanos: [{ candidaturaId: 'pp', escanos: 70 }, { candidaturaId: 'psoe', escanos: 27 }], fuente: 'Ministerio del Interior' },
    sondeos: [
      { empresa, comitente: 'Diario', campoInicio: '2026-06-11', campoFin: '2026-06-12', datos: [{ candidaturaId: 'pp', pct: 50, escanos: 73 }, { candidaturaId: 'psoe', pct: 18, escanos: 26 }] },
      { empresa, comitente: 'Diario', campoInicio: '2026-05-01', campoFin: '2026-05-03', datos: [{ candidaturaId: 'pp', pct: 48, escanos: { min: 70, max: 72 } }] },
    ],
    procedencia: { wiki: 'en', articulo: 'Art', url: 'https://en.wikipedia.org/', licencia: 'CC BY-SA 4.0', obtenido: '2026-09-23T00:00:00Z' },
  } as EleccionFile
}

const base = { nonce: 'n1', cat, estado: 'ok', ahoraISO: '2026-09-23T00:00:00Z', canonical: 'https://x/politica/autonomicas/madrid' }

describe('buildEleccionPage', () => {
  it('permite recorrer todos los sondeos sin repetirlos y limita también la gráfica', () => {
    const file = fileCon('X')
    file.sondeos = Array.from({ length: 61 }, (_, i) => ({
      ...file.sondeos[0], empresa: 'Encuesta-' + String(i).padStart(3, '0'), campoInicio: undefined,
      campoFin: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    }))
    const pages = [1, 2, 3].map(pagina => buildEleccionPage({ ...base, file, enVeda: false, pagina }))
    const docs = pages.map(p => parse(p))
    expect(docs.map(p => p.querySelectorAll('table.s tbody tr').length)).toEqual([25, 25, 11])
    expect(docs.map(p => p.querySelectorAll('details.pm-poll').length)).toEqual([25, 25, 11])
    expect(docs.map(p => p.querySelectorAll('.evsvg circle').length)).toEqual([50, 50, 22])
    for (const sondeo of file.sondeos) expect(pages.filter(p => p.includes(sondeo.empresa))).toHaveLength(1)
    expect(pages[0]).not.toContain('Encuesta-000')
    expect(pages[0]).toContain('?pagina=2')
    expect(pages[2]).toContain('Sondeos 51–61 de 61')
    expect(buildEleccionPage({ ...base, file, enVeda: true, pagina: 2 })).not.toContain('Encuesta-')
  })

  it('busca en todo el histórico la encuesta anterior de la misma casa y medio, incluso en otra página', () => {
    const file = fileCon('Data10')
    const [actual, anterior] = file.sondeos
    const intermedias = Array.from({ length: 24 }, (_, i) => ({
      ...actual, comitente: 'Otro diario', campoInicio: undefined, campoFin: '2026-05-' + String(i + 4).padStart(2, '0'),
    }))
    file.sondeos = [anterior, ...intermedias, actual]
    const doc = parse(buildEleccionPage({ ...base, file, enVeda: false }))
    const ficha = doc.querySelector('details.pm-poll')!
    expect(ficha.querySelector('summary')?.text).toContain('Data10 · Diario')
    expect(ficha.querySelector('.pm-ref')?.text).toContain('Data10 · 3 may 2026')
    expect(ficha.querySelector('.pm-rows li')?.text).toContain('↑ Sube de 1 a 3')
    expect(doc.querySelectorAll('table.s tbody tr')).toHaveLength(25)
    expect(doc.querySelectorAll('details.pm-poll summary').some(s => s.text.includes('mayo') && !s.text.includes('Otro diario'))).toBe(false)
  })
  it('escapa texto que viene de Wikipedia (seguridad)', () => {
    const html = buildEleccionPage({ ...base, file: fileCon('<script>alert(1)</script>'), enVeda: false })
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
  })

  it('reserva la cuenta atrás para una votación que ya tiene fecha oficial', () => {
    const fecha = (valor: string | null, confirmada: boolean) => {
      const html = buildEleccionPage({
        ...base, ahoraISO: '2027-05-20T12:00:00Z', file: fileCon('X'), enVeda: false,
        cat: { ...cat, proxima: { valor, confirmada } },
      })
      return parse(html).querySelector('.fecha-eleccion')?.text
    }
    expect(fecha('2027-05-23', true)).toBe('Votación convocada para el 23 may 2027 · Faltan 3 días')
    expect(fecha('2027-05-21', true)).toContain('Falta 1 día')
    expect(fecha('2027-05-23', false)).toBe('Prevista para mayo de 2027 · Pendiente de confirmación')
    expect(fecha(null, false)).toBe('Próxima votación pendiente de fecha oficial')
  })

  it('muestra las dos referencias con sus valores, las fechas de campo y los puntos realmente publicados', () => {
    const file = fileCon('Data10')
    const render = (referencia?: 'elecciones') => parse(buildEleccionPage({ ...base, file, enVeda: false, referencia }))
    const doc = render()
    const ficha = doc.querySelector('details.pm-poll[open]')!
    expect(doc.querySelector('nav.referencias [aria-current]')?.text).toBe('Encuesta anterior')
    expect(ficha.querySelector('summary')?.text).toMatch(/11.*12 de junio de 2026/)
    const pp = ficha.querySelector('.pm-rows li')!
    expect(pp.querySelector('strong')?.text).toBe('73 escaños')
    expect(pp.text).toContain('Encuesta anterior · 70–72')
    expect(pp.querySelector('span')?.text).toBe('↑ Sube de 1 a 3')
    expect(ficha.querySelectorAll('.pm-rows li')[1].text).toContain('Sin dato de referencia')
    expect(doc.querySelectorAll('.evsvg circle')).toHaveLength(3)
    expect(doc.querySelectorAll('.ev-fechas span').map(el => el.text)).toEqual(['3 may 2026', '12 jun 2026'])
    expect(doc.querySelectorAll('.evsvg circle title').map(p => p.text)).toContain('PP · 70–72 escaños · 48 % · Data10 para Diario · Del 1 may 2026 al 3 may 2026')
    expect(doc.querySelector('.ev-chart script')?.getAttribute('nonce')).toBe('n1')
    const oficial = render('elecciones')
    expect(oficial.querySelector('nav.referencias [aria-current]')?.text).toBe('Elecciones del 28 may 2023')
    const filas = oficial.querySelector('details.pm-poll')!.querySelectorAll('.pm-rows li')
    expect(filas[0].text).toContain('Elecciones · 70')
    expect(filas[0].querySelector('span')?.text).toBe('↑ Sube 3')
    expect(filas[1].text).toContain('Elecciones · 27')
    expect(filas[1].querySelector('span')?.text).toBe('↓ Baja 1')
  })

  it('conserva los porcentajes y el cero publicado sin dibujar una evolución que carece de dos fechas con escaños', () => {
    const file = fileCon('Data10')
    file.sondeos[0].datos = [{ candidaturaId: 'pp', pct: 49.5, escanos: null }]
    file.sondeos[1].datos = [{ candidaturaId: 'pp', pct: null, escanos: 0 }]
    const doc = parse(buildEleccionPage({ ...base, file, enVeda: false }))
    const fichas = doc.querySelectorAll('details.pm-poll')
    expect(fichas[0].text).toContain('49,5 % del voto')
    expect(fichas[0].text).toContain('Sin dato de escaños')
    expect(fichas[1].text).toContain('0 escaños')
    expect(doc.querySelector('.ev-chart')).toBeNull()
    expect(doc.querySelector('.ev-control')).toBeNull()
  })

  it('en veda NO muestra sondeos ni gráfica, pero sí el aviso y el resultado previo', () => {
    const html = buildEleccionPage({ ...base, file: fileCon('Data10'), enVeda: true })
    expect(html).toContain('Veda electoral')
    expect(html).not.toContain('Data10')
    expect(html).not.toContain('Evolución de los sondeos') // no gráfica de sondeos (la barra de resultado sí puede ser SVG)
    const doc = parse(html)
    expect(doc.querySelector('#sondeos')).toBeNull()
    expect(doc.querySelector('.resultado')?.text).toContain('Último resultado oficial')
    expect(doc.querySelector('.resultado')?.text).toContain('28 may 2023')
  })

  it('sin sondeos: aviso honesto (no error)', () => {
    const f = fileCon('X')
    f.sondeos = []
    const html = buildEleccionPage({ ...base, file: f, enVeda: false, estado: 'sin_sondeos' })
    expect(html).toContain('Todavía no hay sondeos')
    expect(html).not.toContain('Evolución de los sondeos')
    expect(parse(html).querySelector('nav.referencias')).toBeNull()
  })
})

describe('buildIndexPage', () => {
  it('lista secciones y enlaza a las páginas', () => {
    const html = buildIndexPage('n1', [
      { id: 'generales', tipo: 'generales', nombre: 'Generales', fecha: { valor: '2027-08-22', confirmada: false }, fechaUltimoSondeo: '2026-10-01', estado: 'ok', ruta: '/data/politica/generales.json' },
      { id: 'europeas', tipo: 'europeas', nombre: 'Europeas', fecha: { valor: null, confirmada: false }, estado: 'sin_sondeos', ruta: '/data/politica/europeas.json' },
      { id: 'madrid', tipo: 'autonomica', nombre: 'Madrid', comunidad: 'Madrid', fecha: { valor: '2027-05-23', confirmada: false }, estado: 'ok', ruta: '/data/politica/autonomicas/madrid.json' },
    ], 'https://x/politica/')
    expect(html).toContain('href="/politica/generales"')
    expect(html).toContain('href="/politica/autonomicas/madrid"')
    const doc = parse(html)
    expect(doc.querySelector('a.el[href="/politica/generales"]')?.text).toContain('Prevista para agosto de 2027')
    expect(doc.querySelector('a.el[href="/politica/generales"]')?.text).toContain('Último sondeo · 1 oct 2026')
    expect(doc.querySelector('a.el[href="/politica/europeas"]')?.text).toContain('pendiente de fecha oficial')
    expect(doc.querySelector('select[name="comunidad"] option[value="madrid"]')?.text).toBe('Madrid')
  })
})
