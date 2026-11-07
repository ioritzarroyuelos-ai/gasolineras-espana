import { describe, expect, it, vi } from 'vitest'
import { clavePausaMotor, creaFetchMotorConPausas } from '../scripts/lib/deportes-motor-pausas.mjs'
import { normalizaEstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'
import type { EstadoNovanet } from '../scripts/lib/deportes-novanet-estado.mjs'

const inicio = Date.parse('2026-11-07T19:00:00Z'), HORA = 3600000
describe('pausas de motor persistidas por origen', () => {
  it('respeta doce horas entre ejecuciones aunque el robot vuelva cada cuatro horas y deja seguir otras fuentes', async () => {
    let ahora = inicio
    const estado: Record<string, EstadoNovanet> = {}, guardar = vi.fn((id: string, e: EstadoNovanet) => { estado[id] = normalizaEstadoNovanet(e) })
    const f = vi.fn(async () => new Response('Límite', { status: 429, headers: { 'Retry-After': '43200' } }))
    const primera = creaFetchMotorConPausas({ fetcher: f, reloj: () => ahora, estadoNovanet: estado, guardarEstadoNovanet: guardar })
    expect((await primera('https://motor.example/calendario')).status).toBe(429)
    await expect(primera('https://motor.example/resultados')).rejects.toThrow('esperar')
    expect(f).toHaveBeenCalledTimes(1)
    expect(estado[clavePausaMotor('https://motor.example')].noConsultarAntes).toBe('2026-11-08T07:00:00.000Z')
    ahora += 4 * HORA
    const segundaRed = vi.fn(async () => new Response('ok'))
    const segunda = creaFetchMotorConPausas({ fetcher: segundaRed, reloj: () => ahora, estadoNovanet: estado })
    await expect(segunda('https://motor.example/otra-ruta')).rejects.toThrow('esperar')
    expect(await (await segunda('https://otra.example/calendario')).text()).toBe('ok')
    expect(segundaRed).toHaveBeenCalledTimes(1)
    ahora = inicio + 12 * HORA
    const tercera = creaFetchMotorConPausas({ fetcher: segundaRed, reloj: () => ahora, estadoNovanet: estado })
    expect((await tercera('https://motor.example/calendario')).status).toBe(200)
    expect(segundaRed).toHaveBeenCalledTimes(2)
  })
  it.each([
    ['Sat, 07 Nov 2026 22:00:00 GMT', '2026-11-07T22:00:00.000Z'],
    ['30', '2026-11-07T20:00:00.000Z'],
    ['0', '2026-11-07T20:00:00.000Z'],
    ['no es una fecha', '2026-11-07T20:00:00.000Z'],
    ['99999999999999999999999999999999999', '2026-11-07T20:00:00.000Z'],
  ])('interpreta Retry-After %s con un mínimo de una hora', async (retry, hasta) => {
    const estado: Record<string, EstadoNovanet> = {}
    const f = creaFetchMotorConPausas({ reloj: () => inicio, estadoNovanet: estado, fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': retry } }) })
    await f('https://motor.example/')
    expect(estado[clavePausaMotor('https://motor.example')].noConsultarAntes).toBe(hasta)
  })
  it.each(['43200', 'Sun, 08 Nov 2026 07:00:00 GMT'])('persiste la espera explícita de mantenimiento HTTP 503 (%s)', async retry => {
    const estado: Record<string, EstadoNovanet> = {}, guardar = vi.fn()
    const fetcher = vi.fn(async () => new Response('Mantenimiento', { status: 503, headers: { 'Retry-After': retry } }))
    const f = creaFetchMotorConPausas({ fetcher, reloj: () => inicio, estadoNovanet: estado, guardarEstadoNovanet: guardar })
    expect((await f('https://motor.example/')).status).toBe(503)
    expect(estado[clavePausaMotor('https://motor.example')].noConsultarAntes).toBe('2026-11-08T07:00:00.000Z')
    await expect(f('https://motor.example/otra')).rejects.toThrow('esperar')
    const siguiente = creaFetchMotorConPausas({ fetcher, reloj: () => inicio + 4 * HORA, estadoNovanet: estado })
    await expect(siguiente('https://motor.example/')).rejects.toThrow('esperar')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(guardar).toHaveBeenCalledTimes(1)
  })
  it.each([null, '', 'texto', '1.5', '99999999999999999999999999999999999', 'Sat, 07 Nov 999999999 22:00:00 GMT'])('mantiene el comportamiento transitorio del 503 sin una espera válida (%s)', async retry => {
    const estado: Record<string, EstadoNovanet> = {}, guardar = vi.fn()
    const fetcher = vi.fn(async () => new Response('', { status: 503, headers: retry === null ? {} : { 'Retry-After': retry } }))
    const f = creaFetchMotorConPausas({ fetcher, reloj: () => inicio, estadoNovanet: estado, guardarEstadoNovanet: guardar })
    expect((await f('https://motor.example/')).status).toBe(503)
    expect((await f('https://motor.example/otra')).status).toBe(503)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(guardar).not.toHaveBeenCalled()
    expect(estado).toEqual({})
  })
  it('no consulta ni acorta una pausa anterior más larga', async () => {
    const id = clavePausaMotor('https://motor.example'), estado = { [id]: normalizaEstadoNovanet({ version: 1, noConsultarAntes: '2026-11-09T19:00:00Z' }) }
    const fetcher = vi.fn(async () => new Response('', { status: 429, headers: { 'Retry-After': '3600' } })), guardar = vi.fn()
    const f = creaFetchMotorConPausas({ fetcher, estadoNovanet: estado, guardarEstadoNovanet: guardar, reloj: () => inicio })
    await expect(f('https://motor.example/')).rejects.toThrow('2026-11-09')
    expect(fetcher).not.toHaveBeenCalled(); expect(guardar).not.toHaveBeenCalled()
  })
  it('dos respuestas simultáneas no pueden sobrescribir la pausa mayor', async () => {
    const estado: Record<string, EstadoNovanet> = {}, escrituras: string[] = []
    let llamadas = 0
    const f = creaFetchMotorConPausas({ estadoNovanet: estado, reloj: () => inicio, fetcher: async () => new Response('', { status: 429, headers: { 'Retry-After': ++llamadas === 1 ? '86400' : '3600' } }),
      guardarEstadoNovanet: async (_id, e) => { await Promise.resolve(); escrituras.push(e.noConsultarAntes!) } })
    await Promise.all([f('https://motor.example/a'), f('https://motor.example/b')])
    expect(escrituras).toEqual(['2026-11-08T19:00:00.000Z', '2026-11-08T19:00:00.000Z'])
    expect(estado[clavePausaMotor('https://motor.example')].noConsultarAntes).toBe(escrituras.at(-1))
  })
  it.each([401, 403])('no repite una fuente que devuelve HTTP %s y mantiene las demás', async status => {
    const fetcher = vi.fn(async () => new Response('', { status }))
    const f = creaFetchMotorConPausas({ fetcher, reloj: () => inicio })
    expect((await f('https://motor.example/a')).status).toBe(status)
    await expect(f('https://motor.example/b')).rejects.toThrow('HTTP ' + status)
    await f('https://otra.example/')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('guarda únicamente metadatos y no consume el cuerpo ni cambia las opciones de la petición', async () => {
    const estado: Record<string, EstadoNovanet> = {}, respuesta = new Response('CUERPO_PRIVADO', { status: 429, headers: { 'Retry-After': '7200', 'Set-Cookie': 'COOKIE_PRIVADA' } })
    const fetcher = vi.fn(async () => respuesta), init = { headers: { Authorization: 'CLAVE_PRIVADA' } }
    const f = creaFetchMotorConPausas({ fetcher, reloj: () => inicio, estadoNovanet: estado })
    const req = new Request('https://motor.example/calendario?clave=NO_GUARDAR')
    const r = await f(req, init)
    expect(fetcher).toHaveBeenCalledWith(req, init)
    expect(await r.text()).toBe('CUERPO_PRIVADO')
    expect(JSON.stringify(estado)).not.toMatch(/PRIVAD|NO_GUARDAR|Authorization|Set-Cookie/)
    const id = Object.keys(estado)[0]
    expect(id.length).toBeLessThanOrEqual(50)
    expect(id).toMatch(/^[a-z0-9][a-z0-9-]{0,49}$/)
    expect(clavePausaMotor('https://motor.example/otra')).toBe(id)
    expect(clavePausaMotor('https://motor.example:8443/otra')).not.toBe(id)
  })
  it('si hay una redirección normal guarda también la pausa del origen final', async () => {
    const estado: Record<string, EstadoNovanet> = {}, r = new Response('', { status: 429, headers: { 'Retry-After': '7200' } })
    Object.defineProperty(r, 'url', { value: 'https://final.example/calendario' })
    const f = creaFetchMotorConPausas({ estadoNovanet: estado, reloj: () => inicio, fetcher: async () => r })
    await f('https://origen.example/calendario')
    expect(estado[clavePausaMotor('https://origen.example')].noConsultarAntes).toBe('2026-11-07T21:00:00.000Z')
    expect(estado[clavePausaMotor('https://final.example')].noConsultarAntes).toBe('2026-11-07T21:00:00.000Z')
  })
})
