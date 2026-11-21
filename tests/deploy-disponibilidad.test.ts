import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error El despliegue corre en Node, no en el runtime de la web.
import { readFileSync, existsSync } from 'node:fs'
// @ts-expect-error El proyecto de navegador no incluye tipos Node globales.
import { createRequire } from 'node:module'
// @ts-expect-error Script de publicación exclusivo de Node.
import { deployDisponibilidad, disponibilidadExiste, disponibilidadVersion, verificaDisponibilidad } from '../scripts/deploy-disponibilidad.mjs'

const sha = 'a'.repeat(40), repo = 'ioritzarroyuelos-ai/gasolineras-espana', versionId = '10000000-0000-4000-8000-000000000001'
const botFixture = '123456:' + 'prueba_sin_credencial'.repeat(2)
const env = (enabled = 'true') => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: repo, VALIDATED_SHA: sha, DISPONIBILIDAD_ENABLED: enabled,
  TELEGRAM_BOT_TOKEN: botFixture, GH_TOKEN: 'fixture-github', CLOUDFLARE_ACCOUNT_ID: 'b'.repeat(32), CLOUDFLARE_API_TOKEN: 'fixture-cloudflare' })
const config = (file: string) => JSON.parse(readFileSync(file, 'utf8').split(/\r?\n/).filter((line: string) => !line.trimStart().startsWith('//')).join('\n'))
function fixture(exists = false, afterMain = Infinity) {
  let reads = 0
  const calls: any[] = []
  const request = vi.fn(async (path: string) => path.includes('/commits/') ? { sha: ++reads > afterMain ? 'c'.repeat(40) : sha }
    : { workflow_runs: [{ head_sha: sha, head_branch: 'main', event: 'push', conclusion: 'success' }] })
  const run = vi.fn((executable: string, args: string[], options: any) => {
    calls.push({ executable, args, options, config: config(args[args.indexOf('--config') + 1]) })
    return { status: 0, stdout: '', stderr: '' }
  })
  return { calls, request, run, checkout: () => ({ sha, origin: 'https://github.com/' + repo + '.git' }), exists: vi.fn(async () => exists), version: vi.fn(async () => versionId) }
}
describe('CI de disponibilidad: publicar sólo código validado', () => {
  it('instala apagado, transmite sólo por stdin y activa después del segundo control de main', async () => {
    const io = fixture()
    expect(await deployDisponibilidad(env(), io)).toMatchObject({ enabled: true, versionId, revision: sha })
    expect(io.calls.map(call => call.args[1])).toEqual(['deploy', 'secret', 'deploy'])
    expect(io.calls.map(call => call.config.vars.DISPONIBILIDAD_ENABLED)).toEqual(['false', 'false', 'true'])
    expect(JSON.parse(io.calls[1].options.input)).toEqual({ TELEGRAM_BOT_TOKEN: botFixture })
    for (const call of io.calls) {
      expect(call.args.join(' ')).not.toContain(botFixture); expect(JSON.stringify(call.config)).not.toContain(botFixture)
      expect(call.options.env.TELEGRAM_BOT_TOKEN).toBeUndefined(); expect(call.options.env.GH_TOKEN).toBeUndefined()
      expect(call.options.env.WRANGLER_WRITE_LOGS).toBe('false')
      expect(call.config.workers_dev).toBe(false); expect(call.config.preview_urls).toBe(false)
      expect(call.config.migrations).toEqual([{ tag: 'v1', new_sqlite_classes: ['DisponibilidadUsuario'] }])
    }
    expect(existsSync(io.calls[0].args.at(-1))).toBe(false)
  })
  it('no apaga entre versiones un servicio existente', async () => {
    const io = fixture(true)
    await deployDisponibilidad(env(), io)
    expect(io.calls.map(call => call.args[1])).toEqual(['secret', 'deploy'])
    expect(io.calls.every(call => call.config.vars.DISPONIBILIDAD_ENABLED === 'true')).toBe(true)
  })
  it.each([false, true])('la pausa se publica explícitamente, incluso si existe=%s, sin entregar secretos', async exists => {
    const io = fixture(exists), settings = { ...env('false'), TELEGRAM_BOT_TOKEN: '' }
    expect(await deployDisponibilidad(settings, io)).toMatchObject({ enabled: false })
    expect(io.calls).toHaveLength(1); expect(io.calls[0].args[1]).toBe('deploy')
    expect(io.calls[0].config.vars.DISPONIBILIDAD_ENABLED).toBe('false')
    expect(io.calls[0].options.input).toBeUndefined()
  })
  it.each(['', 'yes', 'undefined'])('una bandera inválida %s no deja que Pages enlace un Worker ausente', async value => {
    const io = fixture()
    await expect(deployDisponibilidad(env(value), io)).rejects.toThrow()
    expect(io.run).not.toHaveBeenCalled(); expect(io.request).not.toHaveBeenCalled()
  })
  it.each(['repo', 'checkout', 'origin', 'ci', 'main', 'bot', 'local'])('rechaza %s antes de tocar recursos', async mismatch => {
    const io = fixture(), settings = env()
    if (mismatch === 'repo') settings.GITHUB_REPOSITORY = 'otra/persona'
    if (mismatch === 'checkout') io.checkout = () => ({ sha: 'f'.repeat(40), origin: 'https://github.com/' + repo + '.git' })
    if (mismatch === 'origin') io.checkout = () => ({ sha, origin: 'https://github.com/otra/persona.git' })
    if (mismatch === 'ci') io.request.mockImplementation(async path => path.includes('/commits/') ? { sha } as any : { workflow_runs: [] } as any)
    if (mismatch === 'main') io.request.mockResolvedValue({ sha: 'c'.repeat(40) } as any)
    if (mismatch === 'bot') settings.TELEGRAM_BOT_TOKEN = ''
    if (mismatch === 'local') settings.GITHUB_ACTIONS = 'false'
    await expect(deployDisponibilidad(settings, io)).rejects.toThrow()
    expect(io.run).not.toHaveBeenCalled(); expect(io.exists).not.toHaveBeenCalled()
  })
  it('si main avanza antes del bootstrap, no crea el servicio obsoleto', async () => {
    const io = fixture(false, 1)
    await expect(deployDisponibilidad(env(), io)).rejects.toThrow(/Main/)
    expect(io.run).not.toHaveBeenCalled()
  })
  it('si main avanza tras el secreto, conserva apagado el bootstrap o conserva la versión previa', async () => {
    for (const exists of [false, true]) {
      const io = fixture(exists, exists ? 1 : 2)
      await expect(deployDisponibilidad(env(), io)).rejects.toThrow(/Main/)
      expect(io.calls.map(call => call.args[1])).toEqual(exists ? ['secret'] : ['deploy', 'secret'])
      expect(io.version).not.toHaveBeenCalled()
    }
  })
  it('un error de proceso no imprime el secreto ni confirma la publicación', async () => {
    const io = fixture()
    io.run.mockImplementation(() => { throw Error(botFixture) })
    await expect(deployDisponibilidad(env(), io)).rejects.toThrow('No se completó Wrangler')
    expect(io.version).not.toHaveBeenCalled()
  })
})
describe('Comprobaciones remotas acotadas, sin invocar objetos de usuario', () => {
  it('distingue un servicio ausente de error o inventario incompleto', async () => {
    for (const present of [false, true]) expect(await disponibilidadExiste(env(), async () => Response.json({ success: true, result: present ? [{ id: 'espana-util-disponibilidad' }] : [] }))).toBe(present)
    for (const response of [new Response(null, { status: 403 }), Response.json({ success: false }), Response.json({ success: true, result: [], result_info: { total_pages: 2 } })])
      await expect(disponibilidadExiste(env(), async () => response)).rejects.toThrow()
  })
  it('rechaza redirecciones y no propaga la credencial a otro origen', async () => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } }))
    await expect(disponibilidadExiste(env(), fetcher)).rejects.toThrow()
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'manual' })
  })
  it('identifica una sola versión al 100%, no una mezcla ni una respuesta ilimitada', async () => {
    const result = (percentage = 100) => ({ success: true, result: { deployments: [{ created_on: '2026-11-21T10:00:00Z', versions: [{ version_id: versionId, percentage }] }] } })
    expect(await disponibilidadVersion(env(), async () => Response.json(result()))).toBe(versionId)
    await expect(disponibilidadVersion(env(), async () => Response.json(result(50)))).rejects.toThrow()
    await expect(disponibilidadVersion(env(), async () => new Response('{}', { headers: { 'content-length': '999999999' } }))).rejects.toThrow()
  })
  it.each(['true', 'false'])('salud verifica versión y activación %s con sólo GET config', async enabled => {
    const fetcher = vi.fn(async (_url: string, _init: RequestInit) => Response.json({ serviceVersion: versionId, manageAvailable: true, available: enabled === 'true' }))
    expect(await verificaDisponibilidad(env(enabled), versionId, { fetch: fetcher, sleep: vi.fn() })).toEqual({ versionId, enabled: enabled === 'true' })
    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher.mock.calls[0][0]).toBe('https://webapp-3ft.pages.dev/api/telegram/disponibilidad/config')
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty('body'); expect(fetcher.mock.calls[0][1]).not.toHaveProperty('headers')
  })
  it('no declara sana una versión anterior ni una baja sin acceso a gestionar', async () => {
    const sleep = vi.fn(async () => {})
    for (const data of [{ serviceVersion: 'otra', manageAvailable: true, available: true }, { serviceVersion: versionId, manageAvailable: false, available: true }]) {
      const fetcher = vi.fn(async () => Response.json(data))
      await expect(verificaDisponibilidad(env(), versionId, { fetch: fetcher, sleep })).rejects.toThrow()
      expect(fetcher).toHaveBeenCalledTimes(6)
    }
  })
})
describe('Aislamiento de configuración y orden del despliegue', () => {
  it('preview no tiene servicio ni clave del bot, y ambos entornos conservan los bindings previos', () => {
    const pages = config('wrangler.jsonc'), worker = config('wrangler.disponibilidad.jsonc')
    expect(pages.services).toEqual([])
    expect(pages.env.preview.services).toEqual([])
    expect(pages.env.preview.vars).toMatchObject({ DISPONIBILIDAD_ENABLED: 'false', TELEGRAM_BOT_TOKEN: '', TELEGRAM_WEBHOOK_SECRET: '' })
    expect(pages.env.production.services).toEqual([{ binding: 'DISPONIBILIDAD', service: 'espana-util-disponibilidad' }])
    for (const scope of [pages.env.preview, pages.env.production]) {
      expect(scope.kv_namespaces).toEqual(pages.kv_namespaces); expect(scope.d1_databases).toEqual(pages.d1_databases)
      expect(scope.vars.PUBLIC_ORIGIN).toBe(pages.vars.PUBLIC_ORIGIN); expect(scope.vars.GOOGLE_CLIENT_ID).toBe(pages.vars.GOOGLE_CLIENT_ID)
    }
    expect(worker.workers_dev).toBe(false); expect(worker.preview_urls).toBe(false); expect(worker.observability.traces.enabled).toBe(false)
  })
  it('CI instala herramientas del lock, migra sólo después de CI y verifica salud tras Pages', () => {
    const yaml = createRequire(import.meta.url)('js-yaml')
    const steps = yaml.load(readFileSync('.github/workflows/deploy.yml', 'utf8')).jobs.deploy.steps
    const at = (text: string) => steps.findIndex((step: any) => step.run?.includes(text))
    expect(at('npm ci --ignore-scripts')).toBeLessThan(at('deploy-disponibilidad.mjs'))
    expect(at('deploy-disponibilidad.mjs')).toBeLessThan(at('wrangler pages deploy'))
    expect(at('wrangler pages deploy')).toBeLessThan(at('deploy-disponibilidad.mjs --verify'))
    expect(steps[at('wrangler pages deploy') - 1].name).toBe('Confirmar que main no avanzó durante la preparación')
    expect(steps[at('deploy-disponibilidad.mjs')].if).toBe("steps.ci.outputs.current == 'true'")
    expect(readFileSync('.github/workflows/deploy-preview.yml', 'utf8')).not.toMatch(/deploy-disponibilidad|wrangler\.disponibilidad|new_sqlite_classes/)
  })
})
