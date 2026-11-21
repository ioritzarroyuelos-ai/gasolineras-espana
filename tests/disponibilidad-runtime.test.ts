// Runtime local real: SQLite, RPC, alarm handler y persistencia de Durable
// Objects. Toda salida de red queda interceptada antes de llegar a Internet.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
// Carga de ejecución: no inyectar los tipos globales Node de Miniflare en
// todo el proyecto de navegador. Se comprueban sus RPC reales más abajo.
const miniflareModule = 'miniflare'
const { Miniflare, convertV4MiniflareOptions } = await import(miniflareModule)
import { build } from 'esbuild'
// @ts-expect-error El proyecto de navegador no incluye tipos globales de Node.
import { mkdtemp, rm, readdir } from 'node:fs/promises'
// @ts-expect-error El proyecto de navegador no incluye tipos globales de Node.
import { tmpdir } from 'node:os'
// @ts-expect-error El proyecto de navegador no incluye tipos globales de Node.
import { join } from 'node:path'

const start = Date.parse('2099-11-21T07:00:00Z'), minute = 60000
type Scenario = { quantity?: number | null; fresh?: boolean; result?: { estado: string; espera?: number; crash?: boolean }; gate?: Promise<void>; sourceCalls: number; sends: Array<{ text: string; chat: number }> }
const cases = new Map<string, Scenario>()
let mf: { dispatchFetch: (url: string, options: RequestInit) => Promise<Response>; dispose: () => Promise<void> }, script: string, persist: string
async function runtime() {
  return new Miniflare({ ...convertV4MiniflareOptions({ name: 'availability-test', modules: true, script, compatibilityDate: '2026-11-21', bindings: { DISPONIBILIDAD_ENABLED: 'true', TELEGRAM_BOT_TOKEN: 'simulado-sin-uso' },
    durableObjects: { DISPONIBILIDAD: { className: 'DisponibilidadPrueba', useSQLite: true } },
    serviceBindings: { CONTROL: { name: 'availability-test', entrypoint: 'DisponibilidadServicio' } },
    outboundService: async (request: Request) => {
      const url = new URL(request.url)
      if (url.origin !== 'https://availability-test.invalid') throw Error('Red no autorizada en la prueba')
      const body = await request.json() as any, test = cases.get(body.testId)!
      if (url.pathname === '/send') { test.sends.push({ text: body.text, chat: body.chat }); return Response.json(test.result || { estado: 'enviado' }) }
      test.sourceCalls++
      if (test.gate) await test.gate
      const point = { id: body.item.lugarId, fuente: body.item.fuente, objetivo: body.item.objetivo, nombre: 'Lugar de prueba', lat: 40.4, lon: -3.7,
        cantidad: test.quantity === undefined ? 1 : test.quantity, estado: test.fresh === false ? 'sin_confirmar' : 'actual', fechaDato: new Date(body.now - minute).toISOString(), caduca: new Date(body.now + 4 * minute).toISOString(), fuenteUrl: 'https://fuente.invalid', enlace: 'https://webapp-3ft.pages.dev/cerca' }
      return Response.json(point)
    },
  }), resourcePersistencePath: persist })
}
async function call(object: string, operation: string, ...args: any[]) {
  const response = await mf.dispatchFetch('https://runtime.invalid', { method: 'POST', body: JSON.stringify({ object, operation, args }) })
  if (!response.ok) throw Error(await response.text())
  return response.json() as Promise<any>
}
async function fixture(name: string) {
  const scenario: Scenario = { sourceCalls: 0, sends: [] }; cases.set(name, scenario); await call(name, 'setup', start, name)
  const get = () => call(name, 'leer', 10)
  const save = async (mode = 'temporal', hour?: string, version?: string, requestId = crypto.randomUUID()) => {
    const state = version || (await get()).version
    return call(name, 'guardar', 10, mode, { fuente: 'aparcamientos-madrid', lugarId: 'parking-madrid-72', objetivo: 'plazas', consentimiento: 'disponibilidad-telegram-v1', version: state, peticion: requestId, ...(hour ? { hora: hour } : {}) })
  }
  return { scenario, get, save, tick: (now: number) => call(name, 'tick', now), cancel: (mode?: string) => call(name, 'cancelar', 10, mode ?? null), inspect: () => call(name, 'inspect') }
}
beforeAll(async () => {
  persist = await mkdtemp(join(tmpdir(), 'eu-disponibilidad-runtime-'))
  script = (await build({ entryPoints: ['tests/fixtures/disponibilidad-worker.mjs'], bundle: true, write: false, format: 'esm', platform: 'browser', external: ['cloudflare:workers'], logLevel: 'silent' })).outputFiles[0].text
  mf = await runtime()
}, 30000)
afterAll(async () => {
  await mf?.dispose()
  if (persist) {
    const prefix = join(tmpdir(), 'eu-disponibilidad-runtime-')
    if (!persist.startsWith(prefix) || !/^[a-zA-Z0-9_-]+$/.test(persist.slice(prefix.length))) throw Error('Directorio de prueba fuera del temporal previsto')
    await rm(persist, { recursive: true, force: true })
  }
}, 15000)

describe('alarmas con SQLite real, sin red real', () => {
  it('limita los cambios y conserva siempre la posibilidad de cancelar', async () => {
    const f = await fixture('limite-cambios')
    for (let i = 0; i < 12; i++) expect((await f.save()).ok).toBe(true)
    expect(await f.save()).toMatchObject({ status: 429, error: 'change_limit' }); expect(f.scenario.sourceCalls).toBe(12)
    expect((await f.cancel()).ok).toBe(true); expect((await f.get()).avisos).toEqual([])
  })
  for (const paused of [false, true]) it('purga temporal y recibos a30d mientras conserva diario, pausa=' + paused, async () => {
    const name = 'limpieza-mixta-' + paused, f = await fixture(name)
    await f.save('diario', '23:00'); await f.save(); await f.tick(start + 1000)
    expect(f.scenario.sends).toHaveLength(1)
    await call(name, 'paused', paused)
    await f.tick(start + 31 * 86400000)
    const rows = await f.inspect()
    expect(rows.some(([key]: [string]) => key === 'aviso:temporal' || key.startsWith('recibo:'))).toBe(false)
    expect(rows.find(([key]: [string]) => key === 'aviso:diario')[1].activo).toBe(true)
    expect(f.scenario.sends).toHaveLength(1)
    expect((await f.cancel()).ok).toBe(true)
    await call(name, 'paused', false)
  })
  it('salud por Service Binding no inicializa ningún objeto ni SQLite', async () => {
    const constructors = await call('', 'constructors')
    // Miniflare crea metadatos de namespaces al arrancar, no bases de usuario.
    const instanceFiles = async () => (await readdir(persist, { recursive: true })).filter((name: string) => name.includes('.sqlite') && !name.includes('metadata.sqlite'))
    const before = await instanceFiles()
    const health = await call('no-se-usa', 'service-health')
    expect(health).toMatchObject({ schema: 1, revision: 'disponibilidad-v1', habilitado: true, configurado: true })
    expect(await instanceFiles()).toEqual(before)
    expect(await call('', 'constructors')).toBe(constructors)
  })
  it('el servicio privado enruta chats separados y permite baja y dry-run sin fuentes', async () => {
    const a = await call('', 'service-read', 51), b = await call('', 'service-read', 52)
    expect(a.ok).toBe(true); expect(a.version).not.toBe(b.version)
    expect((await call('', 'service-read', 51)).version).toBe(a.version)
    expect(await call('', 'service-dry', 51)).toMatchObject({ ok: true, revisados: 0, enviados: 0 })
    expect((await call('', 'service-cancel', 51)).version).not.toBe(a.version)
    expect((await call('', 'service-read', 52)).version).toBe(b.version)
  })
  it('requiere permiso y guarda un aviso; RPC duplicado es idempotente', async () => {
    const f = await fixture('permiso'), state = await f.get(), petition = crypto.randomUUID()
    const saved = await f.save('temporal', undefined, state.version, petition)
    expect(saved.ok).toBe(true); expect(saved.avisos).toHaveLength(1)
    const repeated = await f.save('temporal', undefined, state.version, petition)
    expect(repeated.avisos[0].id).toBe(saved.avisos[0].id); expect(f.scenario.sends).toEqual([])
    expect(await call('permiso', 'scheduled')).toBe(start + 1000)
  })
  it('dos alarmas paralelas producen una sola reserva y entrega temporal', async () => {
    const f = await fixture('doble'); await f.save()
    await Promise.all([f.tick(start + 2000), f.tick(start + 2000)])
    expect(f.scenario.sends).toHaveLength(1); expect((await f.get()).avisos[0]).toMatchObject({ activo: false, estado: 'enviado' })
  })
  it('cero temporal no avisa, hace12comprobaciones y no prolonga1h', async () => {
    const f = await fixture('vencimiento'); f.scenario.quantity = 0; await f.save()
    for (let step = 0; step < 12; step++) await f.tick(start + 1000 + step * 5 * minute)
    expect(f.scenario.sourceCalls).toBe(13) // una identidad al activar +12 consultas
    await f.tick(start + 60 * minute)
    expect(f.scenario.sends).toEqual([]); expect(f.scenario.sourceCalls).toBe(13)
    expect((await f.get()).avisos[0]).toMatchObject({ activo: false, estado: 'vencido' })
  })
  it('diario incluye0 y conserva máximo1 aunque se cambie hora o se reactive', async () => {
    const f = await fixture('diario'); f.scenario.quantity = 0; await f.save('diario', '08:01'); await f.tick(start + minute)
    expect(f.scenario.sends).toHaveLength(1); expect(f.scenario.sends[0].text).toContain('0 plazas libres totales')
    await f.cancel('diario'); await f.save('diario', '18:00'); await f.tick(start + 11 * 60 * minute)
    expect(f.scenario.sends).toHaveLength(1); expect((await f.get()).avisos[0].proxima).toBe('2099-11-22T17:00:00.000Z')
  })
  it('fuente vieja no envía cifras y diario sólo reintenta30min', async () => {
    const f = await fixture('viejo'); f.scenario.fresh = false; await f.save('diario', '08:01')
    for (let step = 0; step <= 6; step++) await f.tick(start + minute + step * 5 * minute)
    expect(f.scenario.sends).toEqual([]); expect(f.scenario.sourceCalls).toBe(7)
    expect((await f.get()).avisos[0]).toMatchObject({ estado: 'fuente_no_disponible', proxima: '2099-11-22T07:01:00.000Z' })
  })
  it('cancelar mientras descarga impide envío; una alta vieja tampoco reaparece', async () => {
    const f = await fixture('cancelar'); await f.save(); let release!: () => void
    f.scenario.gate = new Promise<void>(resolve => { release = resolve })
    const ticking = f.tick(start + 1000)
    while (f.scenario.sourceCalls < 2) await new Promise(resolve => setTimeout(resolve, 5))
    await f.cancel(); release(); await ticking
    expect(f.scenario.sends).toEqual([]); expect((await f.get()).avisos).toEqual([])
    const old = (await f.get()).version; f.scenario.gate = new Promise<void>(resolve => { release = resolve })
    const saving = f.save('temporal', undefined, old)
    while (f.scenario.sourceCalls < 3) await new Promise(resolve => setTimeout(resolve, 5))
    await f.cancel(); release(); expect((await saving).status).toBe(409); expect((await f.get()).avisos).toEqual([])
  })
  it('resultado incierto no se reenvía al despertar ni tras reiniciar runtime', async () => {
    const f = await fixture('incierto'); f.scenario.result = { estado: 'incierto' }; await f.save(); await f.tick(start + 1000)
    await mf.dispose(); mf = await runtime(); await f.tick(start + 6 * minute)
    expect(f.scenario.sends).toHaveLength(1); expect((await f.get()).avisos[0].estado).toBe('incierto')
  }, 15000)
  it('Retry-After largo no mueve un diario reprogramado a otra hora', async () => {
    const f = await fixture('rechazado'); f.scenario.result = { estado: 'reintentar', espera: 86400 }; await f.save('diario', '08:01'); await f.tick(start + minute)
    await f.save('diario', '08:10'); await f.tick(start + 10 * minute)
    expect(f.scenario.sends).toHaveLength(1); expect((await f.get()).avisos[0].proxima).toBe('2099-11-22T07:10:00.000Z')
  })
  it('un rechazo corto respeta los cinco minutos y no agota la hora en reintentos rápidos', async () => {
    const f = await fixture('rechazo-corto'); f.scenario.result = { estado: 'reintentar', espera: 90 }
    await f.save(); await f.tick(start + 1000)
    expect((await f.get()).avisos[0].proxima).toBe(new Date(start + 1000 + 5 * minute).toISOString())
    await f.tick(start + 1000 + 2 * minute); expect(f.scenario.sends).toHaveLength(1)
  })
  it('dry-run no escribe, no envía ni consume intentos', async () => {
    const f = await fixture('dry'); await f.save(); const before = await f.inspect()
    const dry = await call('dry', 'comprobar', 10)
    expect(dry).toMatchObject({ dryRun: true, enviados: 0, revisados: 1, vigentes: 1 }); expect(await f.inspect()).toEqual(before); expect(f.scenario.sends).toEqual([])
  })
  it('no acepta otro chat y los objetos permanecen separados', async () => {
    const a = await fixture('usuario-a'), b = await fixture('usuario-b'); await a.save()
    expect((await b.get()).avisos).toEqual([])
    await expect(call('usuario-a', 'leer', 20)).rejects.toThrow()
  })
  it('dos altas con misma revisión y red pendiente no se pisan', async () => {
    const f = await fixture('dos-altas'), version = (await f.get()).version
    let release!: () => void; f.scenario.gate = new Promise<void>(resolve => { release = resolve })
    const both = [f.save('temporal', undefined, version), f.save('diario', '09:00', version)]
    while (f.scenario.sourceCalls < 2) await new Promise(resolve => setTimeout(resolve, 5))
    release(); const results = await Promise.all(both)
    expect(results.map(result => result.status).sort()).toEqual([200, 409]); expect((await f.get()).avisos).toHaveLength(1)
  })
  it('una caída después de reservar mantiene intención y nunca repite a ciegas', async () => {
    const f = await fixture('caida'), receipt = 'recibo:temporal:'; f.scenario.result = { estado: 'incierto', crash: true }
    await f.save(); await expect(f.tick(start + 1000)).rejects.toThrow('Caída simulada')
    expect((await f.inspect()).filter((row: any[]) => row[0].startsWith(receipt))[0][1].estado).toBe('intento')
    await f.tick(start + 6 * minute)
    expect(f.scenario.sends).toHaveLength(1); expect((await f.get()).avisos[0].estado).toBe('incierto')
  })
  it('la descarga que llega después del vencimiento no envía', async () => {
    const f = await fixture('caduca-en-red'); await f.save(); let release!: () => void
    f.scenario.gate = new Promise<void>(resolve => { release = resolve })
    const checking = f.tick(start + 1000)
    while (f.scenario.sourceCalls < 2) await new Promise(resolve => setTimeout(resolve, 5))
    await call('caduca-en-red', 'setup', start + 60 * minute, 'caduca-en-red'); release(); await checking
    expect(f.scenario.sends).toEqual([]); expect((await f.get()).avisos[0].estado).toBe('vencido')
  })
  it.each(['cancelado', 'terminado'])('limpia datos30d después: %s, sin reactivar al volver', async kind => {
    const name = 'limpieza-' + kind, f = await fixture(name); await f.save(); await f.tick(start + 1000)
    if (kind === 'cancelado') await f.cancel()
    const version = (await f.get()).version, until = start + 1000 + 30 * 86400000 + minute
    await f.tick(until)
    expect(await f.inspect()).toEqual([]); expect(await call(name, 'scheduled')).toBeNull()
    await call(name, 'setup', until, name)
    const state = await f.get(); expect(state.avisos).toEqual([]); expect(state.version).not.toBe(version)
    expect((await f.save('temporal', undefined, version)).status).toBe(409)
    expect(f.scenario.sends).toHaveLength(1)
  })
})
