import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseaPausasPortales } from '../scripts/lib/deportes-novanet-estado.mjs'
// @ts-expect-error Las pruebas Node no forman parte del paquete de tipos de navegador.
import { resolve } from 'node:path'

const simulacion = vi.hoisted(() => ({ archivos: new Map<string, string>(), futbol: vi.fn(), baloncesto: vi.fn(), motor: vi.fn(), escrituras: [] as string[] }))
const ruta = (valor: string) => valor.replace(/\\/g, '/')
vi.mock('node:fs', () => {
  const normal = (v: string) => v.replace(/\\/g, '/')
  return {
    readFileSync: (p: string) => { const dato = simulacion.archivos.get(normal(p)); if (dato === undefined) throw Error('Archivo inexistente'); return dato },
    readdirSync: (p: string) => [...simulacion.archivos.keys()].filter(k => k.startsWith(normal(p) + '/') && !k.slice(normal(p).length + 1).includes('/')).map(k => k.slice(normal(p).length + 1)),
    mkdirSync: vi.fn(),
    writeFileSync: (p: string, dato: string) => { simulacion.archivos.set(normal(p), dato); simulacion.escrituras.push(normal(p)) },
    renameSync: (a: string, b: string) => { simulacion.archivos.set(normal(b), simulacion.archivos.get(normal(a))!); simulacion.archivos.delete(normal(a)) },
  }
})
vi.mock('../scripts/lib/deportes-futbol.mjs', () => ({ obtieneFutbol: simulacion.futbol }))
vi.mock('../scripts/lib/deportes-baloncesto.mjs', () => ({ obtieneBaloncesto: simulacion.baloncesto }))
vi.mock('../scripts/lib/deportes-motor.mjs', () => ({ obtieneMotor: simulacion.motor }))

describe('entrada manual de pausas por portal', () => {
  it('admite ausencia de input y normaliza únicamente fechas con zona', () => {
    expect(parseaPausasPortales()).toEqual({})
    expect(parseaPausasPortales('  ')).toEqual({})
    expect(parseaPausasPortales('{"basket-alava":"2026-11-07T18:34:27+02:00","rfef":"2026-11-07T16:40Z"}')).toEqual({
      'basket-alava': '2026-11-07T16:34:27.000Z', rfef: '2026-11-07T16:40:00.000Z',
    })
  })
  it.each([
    'null', '[]', '"texto"', '{',
    '{"../rfef":"2026-11-07T16:00Z"}',
    '{"__proto__":"2026-11-07T16:00Z"}',
    '{"RFef":"2026-11-07T16:00Z"}',
    '{"rfef":{"catalogo":{}}}',
    '{"rfef":123}',
    '{"rfef":"mañana"}',
    '{"rfef":"2026-11-07T16:00:00"}',
    '{"rfef":"2026-02-30T16:00:00Z"}',
    '{"rfef":"2026-11-07T24:00:00Z"}',
    '{"rfef":"2026-11-07T16:60:00Z"}',
    '{"rfef":"2026-11-07T16:00:00+25:00"}',
  ])('rechaza la entrada inválida %s', input => {
    expect(() => parseaPausasPortales(input)).toThrow()
  })
  it('acota los identificadores y el tamaño del input antes de escribir', () => {
    expect(() => parseaPausasPortales(JSON.stringify({ ['a'.repeat(51)]: '2026-11-07T16:00Z' }))).toThrow('Identificador')
    expect(() => parseaPausasPortales(JSON.stringify(Object.fromEntries(Array.from({ length: 101 }, (_, i) => ['portal-' + i, '2026-11-07T16:00Z']))))).toThrow('máximo')
    expect(() => parseaPausasPortales(' '.repeat(20001))).toThrow()
  })
})

describe('el generador conserva las pausas antes de leer cualquier deporte', () => {
  const base = ruta(resolve('.tmp/deportes-prueba-pausas'))
  beforeEach(() => {
    vi.resetModules()
    simulacion.archivos.clear(); simulacion.escrituras.length = 0
    simulacion.futbol.mockReset(); simulacion.baloncesto.mockReset(); simulacion.motor.mockReset()
    vi.stubEnv('DEPORTES_OUTPUT_DIR', base + '/salida')
    vi.stubEnv('DEPORTES_PREVIOUS_DIR', base + '/anterior')
    vi.stubEnv('DEPORTES_CHECKPOINT_FFCV', base + '/ffcv.json')
    vi.stubEnv('DEPORTES_CHECKPOINT_NOVANET', base + '/checkpoint')
    vi.stubEnv('DEPORTES_FUENTES', 'motor')
    vi.stubEnv('DEPORTES_PROGRAMACION', '')
    vi.stubEnv('DEPORTES_FFCV_NO_ANTES', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
  it('seleccionando motor escribe las pausas en ambas copias, no las acorta y conserva el cursor aunque falle la lectura', async () => {
    const previo = { version: 1, grupo: 4, noConsultarAntes: '2026-11-07T17:00:00.000Z', ventana: { desde: '2026-11-07T15:30:00.000Z', peticiones: 112 }, cookie: 'no publicar', guardadoEn: '2026-11-07T15:40:00.000Z' }
    simulacion.archivos.set(base + '/checkpoint/basket-alava.json', JSON.stringify(previo))
    vi.stubEnv('DEPORTES_PORTALES_NO_ANTES', '{"basket-alava":"2026-11-07T16:34:27Z","basket-galicia":"2026-11-07T17:34:27+01:00"}')
    simulacion.motor.mockImplementation(async (opciones: { estadoNovanet: Record<string, { grupo: number; noConsultarAntes: string }> }) => {
      for (const id of ['basket-alava', 'basket-galicia']) {
        expect(simulacion.archivos.has(base + '/checkpoint/' + id + '.json')).toBe(true)
        expect(simulacion.archivos.has(base + '/salida/fuentes/novanet-' + id + '.json')).toBe(true)
      }
      expect(opciones.estadoNovanet['basket-alava'].grupo).toBe(4)
      expect(opciones.estadoNovanet['basket-alava'].noConsultarAntes).toBe(previo.noConsultarAntes)
      throw Error('Fuente no disponible')
    })
    // @ts-expect-error El ejecutable Node se importa aislado para comprobar su orden de efectos.
    await expect(import('../scripts/fetch-deportes.mjs')).rejects.toThrow('Ninguna fuente deportiva actualizada')
    expect(simulacion.motor).toHaveBeenCalledOnce()
    expect(simulacion.futbol).not.toHaveBeenCalled()
    expect(simulacion.baloncesto).not.toHaveBeenCalled()
    const salida = JSON.parse(simulacion.archivos.get(base + '/salida/fuentes/novanet-basket-alava.json')!)
    expect(salida.noConsultarAntes).toBe(previo.noConsultarAntes)
    expect(salida.ventana.peticiones).toBe(112)
    expect(salida.grupo).toBe(4)
    expect(salida).not.toHaveProperty('cookie')
    const nueva = JSON.parse(simulacion.archivos.get(base + '/checkpoint/basket-galicia.json')!)
    expect(nueva.noConsultarAntes).toBe('2026-11-07T16:34:27.000Z')
    expect(nueva.catalogo).toBeNull()
    expect(nueva.verificados).toEqual({})
    expect(simulacion.escrituras.map(ruta)).not.toContain(base + '/salida/index.json.tmp')
  })
  it('un JSON con un portal inválido rechaza todo antes de escribir o consultar', async () => {
    vi.stubEnv('DEPORTES_PORTALES_NO_ANTES', '{"rfef":"2026-11-07T17:00Z","../fuera":"2026-11-07T17:00Z"}')
    // @ts-expect-error El ejecutable Node se importa aislado para comprobar su orden de efectos.
    await expect(import('../scripts/fetch-deportes.mjs')).rejects.toThrow('Identificador')
    expect(simulacion.escrituras).toHaveLength(0)
    expect(simulacion.motor).not.toHaveBeenCalled()
    expect(simulacion.futbol).not.toHaveBeenCalled()
    expect(simulacion.baloncesto).not.toHaveBeenCalled()
  })
})
