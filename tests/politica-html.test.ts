import { describe, it, expect } from 'vitest'
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
      { empresa, fechaTexto: '11-12 jun', campoFin: '2026-06-12', datos: [{ candidaturaId: 'pp', pct: 50, escanos: 73 }, { candidaturaId: 'psoe', pct: 18, escanos: 26 }] },
      { empresa: 'B', fechaTexto: '1-3 may', campoFin: '2026-05-03', datos: [{ candidaturaId: 'pp', pct: 48, escanos: 71 }] },
    ],
    procedencia: { wiki: 'en', articulo: 'Art', url: 'https://en.wikipedia.org/', licencia: 'CC BY-SA 4.0', obtenido: '2026-09-23T00:00:00Z' },
  } as EleccionFile
}

const base = { nonce: 'n1', cat, estado: 'ok', ahoraISO: '2026-09-23T00:00:00Z', canonical: 'https://x/politica/autonomicas/madrid' }

describe('buildEleccionPage', () => {
  it('permite recorrer todos los sondeos sin repetirlos y limita también la gráfica', () => {
    const file = fileCon('X')
    file.sondeos = Array.from({ length: 61 }, (_, i) => ({ ...file.sondeos[0], empresa: 'Encuesta-' + String(i).padStart(3, '0'), campoFin: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10) }))
    const pages = [1, 2, 3].map(pagina => buildEleccionPage({ ...base, file, enVeda: false, pagina }))
    expect(pages.map(p => (p.match(/class="empn"/g) || []).length)).toEqual([25, 25, 11])
    for (const sondeo of file.sondeos) expect(pages.filter(p => p.includes(sondeo.empresa))).toHaveLength(1)
    expect(pages[0]).not.toContain('Encuesta-000')
    expect(pages[0]).toContain('?pagina=2')
    expect(pages[2]).toContain('Sondeos 51–61 de 61')
    expect(buildEleccionPage({ ...base, file, enVeda: true, pagina: 2 })).not.toContain('Encuesta-')
  })
  it('escapa texto que viene de Wikipedia (seguridad)', () => {
    const html = buildEleccionPage({ ...base, file: fileCon('<script>alert(1)</script>'), enVeda: false })
    expect(html).not.toContain('<script>alert(1)')
    expect(html).toContain('&lt;script&gt;')
  })

  it('muestra la tabla y una gráfica SVG cuando hay sondeos', () => {
    const html = buildEleccionPage({ ...base, file: fileCon('Data10'), enVeda: false })
    expect(html).toContain('Data10')
    expect(html).toContain('<svg')
    expect(html).toContain('<circle') // puntos de la gráfica
    expect(html).toContain('▲+3') // PP 73 vs 70
  })

  it('en veda NO muestra sondeos ni gráfica, pero sí el aviso y el resultado previo', () => {
    const html = buildEleccionPage({ ...base, file: fileCon('Data10'), enVeda: true })
    expect(html).toContain('Veda electoral')
    expect(html).not.toContain('Data10')
    expect(html).not.toContain('Evolución de los sondeos') // no gráfica de sondeos (la barra de resultado sí puede ser SVG)
    expect(html).toContain('Resultado de la última elección')
  })

  it('sin sondeos: aviso honesto (no error)', () => {
    const f = fileCon('X')
    f.sondeos = []
    const html = buildEleccionPage({ ...base, file: f, enVeda: false, estado: 'sin_sondeos' })
    expect(html).toContain('Todavía no hay sondeos')
    expect(html).not.toContain('Evolución de los sondeos')
  })
})

describe('buildIndexPage', () => {
  it('lista secciones y enlaza a las páginas', () => {
    const html = buildIndexPage('n1', [
      { id: 'generales', tipo: 'generales', nombre: 'Generales', fecha: { valor: null, confirmada: false }, estado: 'ok', ruta: '/data/politica/generales.json' },
      { id: 'madrid', tipo: 'autonomica', nombre: 'Madrid', comunidad: 'Madrid', fecha: { valor: '2027-05-23', confirmada: false }, estado: 'ok', ruta: '/data/politica/autonomicas/madrid.json' },
    ], 'https://x/politica/')
    expect(html).toContain('href="/politica/generales"')
    expect(html).toContain('href="/politica/autonomicas/madrid"')
    expect(html).toContain('Prevista')
  })
})
