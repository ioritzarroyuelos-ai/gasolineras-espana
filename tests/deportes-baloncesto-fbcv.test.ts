import { describe, expect, it, vi } from 'vitest'
import { basePublicaFbcv, basePublicaBaleares, categoriasFbcv, obtieneBaloncestoFbcv, esLigaNacionalOW } from '../scripts/lib/deportes-baloncesto-fbcv.mjs'
const ahora = Date.parse('2026-11-07T14:00:00Z')
const pagina = '<script>var owbasket = {"owbasket-apis":[{"esb":{"url":"https://esb.optimalwayconsulting.com/fbcv/1/configPublicaDePrueba"},"fede":{"url":"fbcv"},"system":{"url":"esb"}}]};</script>'
describe('descubrimiento territorial de la Comunitat Valenciana', () => {
  it('evita duplicar ligas FEB sin perder las copas territoriales de esas mismas categorías', () => {
    expect(esLigaNacionalOW('PRIMERA FEB')).toBe(true)
    expect(esLigaNacionalOW('TERCERA FEB')).toBe(true)
    expect(esLigaNacionalOW('COPA CANTABRIA')).toBe(false)
    expect(esLigaNacionalOW('Copa Aragón Tercera FEB')).toBe(false)
    expect(esLigaNacionalOW('AMISTOSOS')).toBe(false)
  })
  it('solo acepta la conexión de resultados publicada por FBCV', () => {
    expect(basePublicaFbcv(pagina)).toContain('/fbcv/')
    expect(() => basePublicaFbcv(pagina.replace('esb.optimalwayconsulting.com', 'otro.example'))).toThrow()
    expect(() => basePublicaFbcv(pagina.replace('"esb"}}', '"opendata"}}'))).toThrow()
  })
  it('comprueba la conexión y ruta balear sin ejecutar el programa publicado', () => {
    const script = 'const url="https://esb.optimalwayconsulting.com/fbib/1/configPublicaDePrueba";const grupo="https://www.fbib.es/competicion/{id}/{round}"'
    expect(basePublicaBaleares(script)).toContain('/fbib/')
    expect(() => basePublicaBaleares(script.replace('/fbib/', '/fbcv/'))).toThrow()
    expect(() => basePublicaBaleares(script.replace('/competicion/', '/privado/'))).toThrow()
    expect(() => basePublicaBaleares(script + ';const otra="https://esb.optimalwayconsulting.com/fbib/1/otraConfigPublica"')).toThrow()
  })
  it('separa territorio y temporada, conservando el nombre mixto que publica la federación', () => {
    const d = [{ idCategoryRegistred: '507', season: '2026', zone: '1', sex: 'M', categoryRegisteredName: 'Benjamín Mixto IR Nivel Autonómico' }]
    expect(categoriasFbcv(d, '2026', '1', 'M')[0]).toMatchObject({ codigo: '01507', nombre: d[0].categoryRegisteredName, familia: 'M/1' })
    expect(() => categoriasFbcv(d, '2025', '1', 'M')).toThrow('otra temporada')
    expect(() => categoriasFbcv(d, '2026', '3', 'M')).toThrow('territorio')
    expect(() => categoriasFbcv(d, '2026', '1', 'F')).toThrow()
  })
  it('no consulta durante una pausa y guarda el Retry-After antes de salir', async () => {
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } })), guardar = vi.fn()
    const pausa = { version: 1, noConsultarAntes: new Date(ahora + 3600000).toISOString() }
    await obtieneBaloncestoFbcv({ ahora, relojFbcv: () => ahora, fetcher, estadoNovanet: { 'basket-fbcv': pausa } })
    expect(fetcher).not.toHaveBeenCalled()
    await obtieneBaloncestoFbcv({ ahora, relojFbcv: () => ahora, fetcher, guardarEstadoNovanet: guardar })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(guardar.mock.calls.at(-1)?.[1].noConsultarAntes).toBe(pausa.noConsultarAntes)
  })
})
