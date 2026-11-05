import { describe, it, expect } from 'vitest'
import { parsePct, parseEscanos, parseFecha, parseSondeos } from '../scripts/lib/politica-parse.mjs'
import generalesEs from './fixtures/politica/generales.es.html?raw'
import europeasEs from './fixtures/politica/europeas.es.html?raw'
import laRiojaEn from './fixtures/politica/la-rioja.en.html?raw'

const FIXTURES: Record<string, string> = {
  'generales.es.html': generalesEs,
  'europeas.es.html': europeasEs,
  'la-rioja.en.html': laRiojaEn,
}
const fx = (f: string) => FIXTURES[f]

describe('parsePct / parseEscanos / parseFecha (unidades)', () => {
  it('pct: normaliza coma, rechaza no-números', () => {
    expect(parsePct('31.9')).toBe(31.9)
    expect(parsePct('27,3')).toBe(27.3)
    expect(parsePct('?')).toBeNull()
    expect(parsePct('—')).toBeNull()
  })

  it('escaños: número, rango con - o /, ausencia', () => {
    expect(parseEscanos('133')).toBe(133)
    expect(parseEscanos('30-33')).toEqual({ min: 30, max: 33 })
    expect(parseEscanos('16/17')).toEqual({ min: 16, max: 17 })
    expect(parseEscanos('(24)')).toBe(24)
    expect(parseEscanos('—')).toBeNull()
    expect(parseEscanos('')).toBeNull()
  })

  it('fecha: con año explícito y con año de contexto', () => {
    expect(parseFecha('28 May–4 Jun 2026').fin).toBe('2026-06-04')
    expect(parseFecha('3-jun-2024').fin).toBe('2024-06-03')
    expect(parseFecha('22-26 Dic', 2025).fin).toBe('2025-12-26')
    expect(parseFecha('22-26 Dic', 2025).inicio).toBe('2025-12-22')
    expect(parseFecha('?').inicio).toBeUndefined()
  })

  it('respeta ambos años al cruzar diciembre y enero, incluso si sólo se escribe uno', () => {
    for (const t of ['29 Dec 2024–28 Jan 2025', '29 Dec–28 Jan 2025', '29 Dec 2024–28 Jan', '29 Dic–28 Ene']) {
      expect(parseFecha(t, 2025)).toEqual({ texto: t, inicio: '2024-12-29', fin: '2025-01-28' })
    }
    expect(parseFecha('24 Dec–28 Jan 2024').inicio).toBe('2023-12-24')
  })

  it('conserva el texto original si faltan año o día, o si la fecha es imposible', () => {
    for (const t of ['17–18 Sep', 'Feb 2025', 'May–Jun 2026', '29 Feb 2025', '31 Abr 2024', '5–3 Oct 2025', '?']) {
      expect(parseFecha(t)).toEqual({ texto: t })
    }
    expect(parseFecha('29 Feb 2024').fin).toBe('2024-02-29')
  })
})

describe('parseSondeos (fixtures reales de Wikipedia)', () => {
  it('GENERALES es: extrae sondeos con % y escaños, mapea partidos, y la referencia 2023', () => {
    const r = parseSondeos(fx('generales.es.html'), { anioReferencia: 2023 })
    expect(r.sondeos.length).toBeGreaterThan(20)
    // Partidos mapeados por nombre
    const ids = r.candidaturas.map((c) => c.id)
    expect(ids).toContain('pp')
    expect(ids).toContain('psoe')
    // Un sondeo real trae PP con % y escaños
    const s0 = r.sondeos[0]
    const pp = s0.datos.find((d) => d.candidaturaId === 'pp')
    expect(pp).toBeTruthy()
    expect(typeof pp!.pct).toBe('number')
    expect(pp!.escanos).not.toBeNull()
    // La fuente sitúa toda esta tabla en la sección 2025.
    expect(s0.campoInicio).toMatch(/^2025-12/)
    for (const s of r.sondeos) if (s.campoFin) expect(s.campoFin.slice(0, 4)).toBe('2025')
    const octubre = r.sondeos.find(s => s.empresa === 'SocioMétrica' && s.muestra === 900 && s.fechaTexto === '6–10 Oct')
    expect(octubre?.campoFin).toBe('2025-10-10')
    expect(octubre?.datos.find(d => d.candidaturaId === 'pp')?.escanos).toBe(147)
    // Referencia del 23-J-2023 detectada y NO contada como sondeo
    expect(r.referencia).toBeTruthy()
    expect(r.referencia!.anio).toBe('2023')
    expect(r.referencia!.escanos.find((e) => e.candidaturaId === 'pp')?.escanos).toBeGreaterThan(100)
  })

  it('LA RIOJA en: pocos sondeos, rangos de escaños {min,max}, celdas — como null', () => {
    const r = parseSondeos(fx('la-rioja.en.html'), { anioReferencia: 2023 })
    expect(r.tablasCoincidentes).toBeGreaterThanOrEqual(1)
    expect(r.sondeos.length).toBeGreaterThan(0)
    // Debe existir algún escaño en rango (Sigma Dos daba 16/17, etc.)
    const hayRango = r.sondeos.some((s) => s.datos.some((d) => d.escanos && typeof d.escanos === 'object'))
    expect(hayRango).toBe(true)
    // Ningún % fuera de rango
    for (const s of r.sondeos) for (const d of s.datos) if (d.pct != null) expect(d.pct).toBeLessThanOrEqual(100)
  })

  it('EUROPEAS es: detecta la tabla de sondeos (no la de candidaturas) y saca escaños', () => {
    const r = parseSondeos(fx('europeas.es.html'), { anioReferencia: 2024 })
    expect(r.sondeos.length).toBeGreaterThan(10)
    const ids = r.candidaturas.map((c) => c.id)
    expect(ids).toContain('pp')
    expect(ids).toContain('psoe')
    // Algún sondeo con escaños numéricos
    const conEscanos = r.sondeos.some((s) => s.datos.some((d) => typeof d.escanos === 'number'))
    expect(conEscanos).toBe(true)
  })

  it('HTML sin tabla de sondeos: devuelve vacío con incidencia (no lanza)', () => {
    const r = parseSondeos('<div><table class="wikitable"><tr><th>Otra cosa</th></tr></table></div>')
    expect(r.sondeos).toEqual([])
    expect(r.incidencias.length).toBeGreaterThan(0)
  })
})

function tabla(filas: string) {
  return '<table class="wikitable"><tr><th>Pollster</th><th>Fieldwork</th><th>Sample</th>'
    + '<th>PP</th><th>PSOE</th><th>Otro</th></tr>' + filas + '</table>'
}

function fila(empresa: string, fecha: string) {
  return '<tr><td>' + empresa + '</td><td>' + fecha + '</td><td>1000</td><td>30</td><td>25</td><td>10</td></tr>'
}

describe('fecha y procedencia de las estimaciones', () => {
  it('conserva el año de la sección cuando las fechas de campo están fuera de orden y hereda el año de la sección superior', () => {
    const html = '<h2>Voting intention estimates</h2><h3>2026</h3>'
      + tabla(fila('A', '1–6 Oct') + fila('B', '10–11 Oct') + fila('C', '29 Dec–5 Jan'))
      + '<h3>2025</h3><h4>Seat estimates</h4>' + tabla(fila('D', '6–10 Oct'))
    expect(parseSondeos(html).sondeos.map(s => [s.empresa, s.campoInicio, s.campoFin])).toEqual([
      ['A', '2026-10-01', '2026-10-06'], ['B', '2026-10-10', '2026-10-11'],
      ['C', '2025-12-29', '2026-01-05'], ['D', '2025-10-06', '2025-10-10'],
    ])
  })

  it('omite voto directo y preferencias que también tienen un encabezado anual', () => {
    const html = '<h2>Encuestas electorales</h2><h3>Estimaciones de intención de voto</h3><h4>2025</h4>'
      + tabla(fila('Estimación', '2 Oct')) + '<h2>Intención de voto directa</h2><h3>2025</h3>'
      + tabla(fila('Respuesta en bruto', '3 Oct')) + '<h2>Opinion polls</h2><h3>Voting preferences</h3><h4>2025</h4>'
      + tabla(fila('Preferencias', '4 Oct'))
    expect(parseSondeos(html).sondeos.map(s => s.empresa)).toEqual(['Estimación'])
  })

  it('la fecha sin año y sin encabezado anual no toma el año de la elección ni de otra fila', () => {
    const html = '<h1>2027 regional election</h1><h2>Opinion polls</h2>'
      + tabla(fila('A', '10 May 2025') + fila('B', '12 May'))
    const sondeos = parseSondeos(html).sondeos
    expect(sondeos[0].campoFin).toBe('2025-05-10')
    expect(sondeos[1].fechaTexto).toBe('12 May')
    expect(sondeos[1].campoFin).toBeUndefined()
  })

  it('respeta fechas compartidas por empresas distintas y conserva sus propios porcentajes', () => {
    const html = '<h2>2025</h2>' + tabla(
      '<tr><td>Uno / Medio A</td><td rowspan="2">6–10 Oct</td><td rowspan="2">900</td><td>34</td><td>27</td><td>15</td></tr>'
      + '<tr><td>Dos / Medio B / Medio C</td><td>32</td><td>29</td><td>14</td></tr>',
    )
    const [a, b] = parseSondeos(html).sondeos
    expect([a.campoFin, b.campoFin, b.muestra]).toEqual(['2025-10-10', '2025-10-10', 900])
    expect([a.datos[0].pct, b.datos[0].pct, b.empresa, b.comitente]).toEqual([34, 32, 'Dos', 'Medio B / Medio C'])
  })

  it('evita convertir dos estimaciones sin distinguir en dos encuestadoras y una cifra conjunta en dos resultados', () => {
    const html = '<h2>2025</h2>' + tabla(
      '<tr><td rowspan="2">CIS / Restimación</td><td rowspan="2">1–6 Oct</td><td rowspan="2">900</td><td>34</td><td>27</td><td>15</td></tr>'
      + '<tr><td>28.3<br>119</td><td>28.6<br>116</td><td>17.5<br>66</td></tr>'
      + '<tr><td>Conjunta</td><td>5 Oct</td><td>900</td><td colspan="2">41.5</td><td>16</td></tr>',
    )
    const resultado = parseSondeos(html)
    expect(resultado.sondeos.map(s => s.empresa)).toEqual(['Conjunta'])
    expect(resultado.sondeos[0].datos).toEqual([{ candidaturaId: 'otro', pct: 16, escanos: null }])
    expect(resultado.filas.rechazadas).toBe(2)
  })
})
