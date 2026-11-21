import { describe, expect, it } from 'vitest'
import { calendarioCapitalUrl, consultaCapitalCordoba, parseCapitalCordoba } from '../scripts/lib/guardias-cordoba-capital.mjs'
import { estadoGuardia, parseGuardias } from '../src/lib/guardias'
import pages from './fixtures/guardias/cordoba-noviembre-posiciones.json'

const url = 'https://www.cofco.org/wp-content/uploads/2026/08/Noviembre-2026.pdf'
const portal = '<a href="' + url + '">NOVIEMBRE</a>'
const copy = () => structuredClone(pages)
describe('Córdoba capital: calendario mensual oficial', () => {
  it.each([['2026-11-20', 45], ['2026-11-21', 37], ['2026-11-22', 19], ['2026-11-02', 30]])('selecciona el calendario real de %s, incluido el festivo', (fecha, count) => {
    const rows = parseCapitalCordoba(pages, fecha, '2026-11')
    expect(rows).toHaveLength(count)
    expect(rows.every(row => row[3] === 'Córdoba' && row[0] === 0 && row[1] === 0)).toBe(true)
    expect(rows.filter(row => String(row[7]).endsWith('noche'))).toHaveLength(2)
  })
  it('descubre sólo un PDF del mes y año exactos en el portal del colegio', () => {
    expect(calendarioCapitalUrl(portal, '2026-11')).toBe(url)
    for (const html of [portal.replaceAll('2026', '2025'), portal.replace('cofco.org', 'example.org'), portal.replace('.pdf', '.pdf?documento=1'), portal + portal.replace('Noviembre-2026.pdf', 'Noviembre-2026-2.pdf')]) expect(() => calendarioCapitalUrl(html, '2026-11')).toThrow()
    expect(() => calendarioCapitalUrl(portal, '2026-12')).toThrow()
  })
  it('conserva sólo la noche anterior que alcanza hoy y respeta ambos extremos exactos', async () => {
    const result = await consultaCapitalCordoba('2026-11-21', { html: async () => portal, pdf: async () => new Uint8Array(), pages: async () => pages })
    expect(result.rows).toHaveLength(39)
    const file = { territorio: 'cordoba', fecha: '2026-11-21', source: 'cofco.org', guardiasVerificadas: true, guardias: result.rows, ts: '2026-11-21T06:00:00Z' }
    for (const [stamp, active] of [['2026-11-21T08:29:59Z', 2], ['2026-11-21T08:30:00Z', 35], ['2026-11-21T20:59:59Z', 35], ['2026-11-21T21:00:00Z', 2]] as const) {
      const time = new Date(stamp)
      expect(parseGuardias(file, time).filter(row => estadoGuardia(row, file.ts, time).abierta)).toHaveLength(active)
    }
    expect(result.rows.slice(0, 2).every(row => row[6] === '2026-11-20 22:00-2026-11-21 09:30')).toBe(true)
    expect(result.rows.slice(-2).every(row => row[6] === '2026-11-21 22:00-2026-11-22 09:30')).toBe(true)
  })
  it('el inicio de mes consulta también el calendario anterior; nunca usa noviembre para octubre', async () => {
    const urls: string[] = [], october = copy().slice(0, 3)
    const result = await consultaCapitalCordoba('2026-11-01', {
      html: async () => portal + '<a href="https://www.cofco.org/wp-content/uploads/2026/08/Octubre-2026.pdf">OCTUBRE</a>',
      pdf: async link => { urls.push(link); return new Uint8Array([link.includes('Octubre') ? 10 : 11]) },
      pages: async data => data[0] === 10 ? october : pages,
    })
    expect(urls).toEqual([url, 'https://www.cofco.org/wp-content/uploads/2026/08/Octubre-2026.pdf'])
    expect(result.rows.slice(0, 2).every(row => row[6] === '2026-10-31 22:00-2026-11-01 09:30')).toBe(true)
    await expect(consultaCapitalCordoba('2026-11-01', { html: async () => portal, pdf: async () => new Uint8Array(), pages: async () => pages })).rejects.toThrow()
  })
  it('rechaza fechas, excepciones y estructuras que no pueda interpretar por completo', () => {
    expect(() => parseCapitalCordoba(pages, '2026-12-21', '2026-11')).toThrow()
    expect(() => parseCapitalCordoba(pages, '2026-11-31', '2026-11')).toThrow()
    const wrongMonth = copy(); wrongMonth[3].find(item => item.texto.includes('(FESTIVO)'))!.texto = '2 DE DICIEMBRE (FESTIVO)'
    expect(() => parseCapitalCordoba(wrongMonth, '2026-11-21', '2026-11')).toThrow()
    const duplicate = copy(); duplicate.push(structuredClone(duplicate[1]))
    expect(() => parseCapitalCordoba(duplicate, '2026-11-21', '2026-11')).toThrow()
    const noZone = copy(); noZone[1] = noZone[1].filter(item => !item.texto.startsWith('ZONA'))
    expect(() => parseCapitalCordoba(noZone, '2026-11-21', '2026-11')).toThrow()
    const badHour = copy(); badHour[1].find(item => item.texto.startsWith('NOCHE -'))!.texto = 'NOCHE - DE 22:00 DE LA NOCHE A 22:00 DEL DIA SIGUIENTE'
    expect(() => parseCapitalCordoba(badHour, '2026-11-21', '2026-11')).toThrow()
    const badPage = copy(); badPage[1].find(item => item.y > .06 && item.y < .09)!.texto = 'SÁBADOS EXCEPTO FESTIVOS LOCALES'
    expect(() => parseCapitalCordoba(badPage, '2026-11-21', '2026-11')).toThrow()
    const noTitle = copy(); noTitle[3] = noTitle[3].filter(item => !item.texto.includes('CAPITAL'))
    expect(() => parseCapitalCordoba(noTitle, '2026-11-02', '2026-11')).toThrow()
    const conditional = copy(); conditional[1].push({ x: .4, y: .2, texto: 'Guardia localizada, previo aviso. Excepto festivos.' })
    expect(() => parseCapitalCordoba(conditional, '2026-11-21', '2026-11')).toThrow()
    const administrative = copy(); administrative[1].push({ x: .4, y: .99, texto: 'Cambio de dirección administrativa del colegio.' })
    expect(parseCapitalCordoba(administrative, '2026-11-21', '2026-11')).toHaveLength(37)
  })
  it('al cambiar de año exige cada portal y calendario, sin prolongar el PDF anterior', async () => {
    // Calendarios sintéticos para la frontera de año; la estructura procede del PDF real.
    const calls: string[] = [], templates = copy().slice(0, 3)
    const result = await consultaCapitalCordoba('2027-01-01', {
      html: async link => { calls.push(link); return link.includes('2027') ? '<a href="https://www.cofco.org/wp-content/uploads/2026/12/Enero-2027.pdf">ENERO</a>' : '<a href="https://www.cofco.org/wp-content/uploads/2026/12/Diciembre-2026.pdf">DICIEMBRE</a>' },
      pdf: async link => { calls.push(link); return new Uint8Array() }, pages: async () => templates,
    })
    expect(calls).toEqual(['https://www.cofco.org/guardias-2027/', 'https://www.cofco.org/wp-content/uploads/2026/12/Enero-2027.pdf', 'https://www.cofco.org/guardias-2026/', 'https://www.cofco.org/wp-content/uploads/2026/12/Diciembre-2026.pdf'])
    expect(result.rows.slice(0, 2).every(row => row[6] === '2026-12-31 22:00-2027-01-01 09:30')).toBe(true)
  })
})
