import { describe, expect, it } from 'vitest'
import { completaResultadosOficiales } from '../scripts/lib/politica-resultados-oficiales.mjs'
import { EleccionFileSchema, type EleccionFile } from '../src/lib/politica-schemas'

function archivo(id: 'generales' | 'europeas', fecha: string): EleccionFile {
  return {
    schemaVer: 1, id, tipo: id, ciclo: fecha.slice(0, 4),
    camara: id === 'generales'
      ? { nombre: 'Congreso', escanos: 350, mayoria: 176 }
      : { nombre: 'Parlamento Europeo', escanos: 61, mayoria: 31 },
    candidaturas: [
      { id: 'pp', siglas: 'PP', nombre: 'Partido Popular', color: '#0070b5' },
      { id: 'otra', siglas: 'Otra', nombre: 'Una candidatura del sondeo' },
    ],
    referencia: {
      fecha, fuente: 'Archivo anterior',
      escanos: id === 'generales' ? [{ candidaturaId: 'pp', escanos: 137 }] : [],
    },
    sondeos: [{ empresa: 'Empresa de prueba', datos: [{ candidaturaId: 'otra', pct: 1, escanos: null }] }],
    procedencia: { wiki: 'es', articulo: 'Encuestas', url: '', licencia: 'CC BY-SA', obtenido: '2026-11-05' },
  }
}

function porCandidatura(resultado: EleccionFile['referencia']) {
  return Object.fromEntries(resultado.escanos.map(d => [d.candidaturaId, d.escanos]))
}

describe('repartos certificados por la Junta Electoral Central', () => {
  it.each([
    ['aragon', '2026-02-08', 67, { pp: 26, psoe: 18, vox: 14, cha: 6, existe: 2, iusumar: 1 }, 'www.boa.aragon.es'],
    ['castilla-y-leon', '2026-03-15', 82, { pp: 33, psoe: 30, vox: 14, upl: 3, xav: 1, sy: 1 }, 'bocyl.jcyl.es'],
    ['extremadura', '2025-12-21', 65, { pp: 29, psoe: 18, vox: 11, unidasporextremadura: 7 }, 'www.juntaelectoralcentral.es'],
  ] as const)('recupera %s del boletín de su propia elección, sin alterar encuestas', (id, fecha, total, esperado, host) => {
    const original = { ...archivo('europeas', fecha), id, tipo: 'autonomica' as const, camara: { nombre: id, escanos: total, mayoria: Math.floor(total / 2) + 1 } }
    const file = EleccionFileSchema.parse(completaResultadosOficiales(original))
    expect(porCandidatura(file.referencia)).toEqual(esperado)
    expect(file.referencia.escanos.reduce((n, d) => n + d.escanos, 0)).toBe(total)
    expect(new URL(file.referencia.url!).hostname).toBe(host)
    expect(file.sondeos).toEqual(original.sondeos)
    for (const d of file.referencia.escanos) expect(file.candidaturas.some(c => c.id === d.candidaturaId)).toBe(true)
    expect(completaResultadosOficiales(file)).toEqual(file)
    const siguiente = { ...original, referencia: { ...original.referencia, fecha: '2030-01-01' } }
    expect(completaResultadosOficiales(siguiente)).toBe(siguiente)
  })
  it('recupera los 61 eurodiputados del 9-J y conserva las candidaturas y cifras de las encuestas', () => {
    const original = archivo('europeas', '2024-06-09')
    const file = EleccionFileSchema.parse(completaResultadosOficiales(original))
    expect(file.referencia.url).toBe('https://www.boe.es/diario_boe/txt.php?id=BOE-A-2024-13092')
    expect(porCandidatura(file.referencia)).toEqual({
      pp: 22, psoe: 20, vox: 6, ahorarepublicas: 3, sumar: 3, salf: 3, podemos: 2, junts: 1, ceus: 1,
    })
    expect(file.referencia.escanos.reduce((n, d) => n + d.escanos, 0)).toBe(61)
    expect(file.candidaturas.filter(c => c.id === 'pp')).toEqual([original.candidaturas[0]])
    expect(file.candidaturas).toContainEqual(original.candidaturas[1])
    for (const d of file.referencia.escanos) expect(file.candidaturas.some(c => c.id === d.candidaturaId)).toBe(true)
    expect(file.sondeos).toEqual(original.sondeos)
    expect(file.senado).toBeUndefined()
    expect(original.referencia.escanos).toHaveLength(0)
  })

  it('mantiene separados los 208 senadores electos del 23-J, los diputados y sus sondeos', () => {
    const original = archivo('generales', '2023-07-23')
    const file = EleccionFileSchema.parse(completaResultadosOficiales(original))
    const senado = file.senado!
    expect(senado.referencia.url).toBe('https://www.boe.es/diario_boe/txt.php?id=BOE-A-2023-18907')
    expect(senado.electivos).toBe(208)
    expect(porCandidatura(senado.referencia)).toEqual({
      pp: 120, psoe: 72, ehbildu: 4, pnv: 4, erc: 3, junts: 1, upn: 1, asg: 1, ahi: 1, eivissaformentera: 1,
    })
    expect(senado.referencia.escanos.reduce((n, d) => n + d.escanos, 0)).toBe(208)
    expect(file.referencia).toEqual(original.referencia)
    expect(file.candidaturas).toEqual(original.candidaturas)
    expect(file.sondeos).toEqual(original.sondeos)
    expect(original.senado).toBeUndefined()
    expect(completaResultadosOficiales(file)).toEqual(file)
  })

  it('una referencia anterior o posterior conserva los datos de su propia elección', () => {
    for (const original of [
      archivo('europeas', '2019-05-26'), archivo('europeas', '2029-01-01'),
      archivo('generales', '2019-11-10'), archivo('generales', '2026-11-29'),
    ]) expect(completaResultadosOficiales(original)).toBe(original)
  })
})
