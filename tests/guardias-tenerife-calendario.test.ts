import { afterEach, describe, expect, it, vi } from 'vitest'
import fixture from './fixtures/guardias-tenerife-santa-cruz.json'
import { consultarCalendarios } from '../scripts/lib/guardias-tenerife-calendario.mjs'

vi.mock('../scripts/lib/guardias-pdf-posicion.mjs', () => ({paginasConPosicion: async () => fixture.paginas}))
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.restoreAllMocks() })

function simulaColegio(mes = '11') {
  const peticiones: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = String(input); peticiones.push(url)
    if (url.includes('action=getguardias')) return Response.json({data:[{zona:'SANTA CRUZ DE TENERIFE',
      link:`<a href="https://www.coftenerife.es/wp-admin/admin-post.php?action=getPdf&amp;guardias=SANTA%20CRUZ%20DE%20TENERIFE/2026/${mes}">PDF</a>`}]})
    if (url.includes('action=getPdf')) return new Response("<script>location.href='https://www.coftenerife.es/visor?file=/prueba.pdf'</script>")
    if (url.endsWith('/prueba.pdf')) return new Response(new Uint8Array([1]))
    throw Error('Petición inesperada')
  }))
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.useFakeTimers()
  return peticiones
}

describe('cruce del calendario mensual y directorio diario de Tenerife', () => {
  it('mantiene el aviso parcial del cartel mixto incluso al recuperar la guardia explícita', async () => {
    simulaColegio()
    const pendiente = consultarCalendarios('2026-11-21', fixture.directorio)
    await vi.runAllTimersAsync()
    const data = await pendiente
    expect(data.turnos.map(f => f.horario)).toEqual(['2026-11-21 00:00-2026-11-22 00:00','2026-11-20 00:00-2026-11-21 00:00'])
    expect(data.pendientes).toEqual(['SANTA CRUZ DE TENERIFE'])
  })
  it('no lee el PDF ni confirma guardias si el enlace oficial es de otro mes', async () => {
    const peticiones = simulaColegio('10')
    const pendiente = consultarCalendarios('2026-11-21', fixture.directorio)
    await vi.runAllTimersAsync()
    const data = await pendiente
    expect(data.turnos).toEqual([])
    expect(data.pendientes).toEqual(['SANTA CRUZ DE TENERIFE'])
    expect(peticiones).toHaveLength(1)
  })
  it('sin datos corroborados de la API conserva el aviso y ninguna guardia', async () => {
    simulaColegio()
    const pendiente = consultarCalendarios('2026-11-21', [])
    await vi.runAllTimersAsync()
    expect(await pendiente).toMatchObject({turnos:[], pendientes:['SANTA CRUZ DE TENERIFE']})
  })
})
