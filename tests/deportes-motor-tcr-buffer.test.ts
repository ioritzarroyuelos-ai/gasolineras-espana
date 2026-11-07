import { expect, it, vi } from 'vitest'
import { interpretaResultadoTcrPdf } from '../scripts/lib/deportes-motor-rfeda.mjs'
import { tablaTcrRevisada } from '../scripts/lib/deportes-motor-tcr-revisados.mjs'

vi.mock('pdf-parse', () => ({ PDFParse: class {
  constructor({ data }: { data: Uint8Array }) { structuredClone(data, { transfer: [data.buffer] }) }
  async getText() { return { text: '' } }
  async destroy() {}
} }))
vi.mock('../scripts/lib/deportes-motor-tcr-revisados.mjs', () => ({ tablaTcrRevisada: vi.fn(() => ({ id: 'resultado', filas: [] })) }))

it('calcula la identidad del PDF antes de que el extractor transfiera y vacíe su buffer', async () => {
  const datos = new Uint8Array([37, 80, 68, 70, 45, 49, 46, 55]), esperado = "86edbaa24831badfa0a8b04bb410141e2ee4182b6d0014493fe262a7a331c20b"
  await interpretaResultadoTcrPdf(datos, 'Carrera 1', 2026, 'https://spain.tcr-series.com/documento.pdf', '2026-11-07T18:00:00Z')
  expect(datos.byteLength).toBe(0)
  expect(tablaTcrRevisada).toHaveBeenCalledWith(esperado, 'Carrera 1', 2026, 'https://spain.tcr-series.com/documento.pdf', '2026-11-07T18:00:00Z')
})
