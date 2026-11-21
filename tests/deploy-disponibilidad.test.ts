import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error El despliegue corre en Node, no en el runtime de la web.
import { readFileSync, existsSync } from 'node:fs'
// @ts-expect-error El proyecto de navegador no incluye tipos Node globales.
import { createRequire } from 'node:module'
// @ts-expect-error Script de publicación exclusivo de Node.
import { deployDisponibilidad, disponibilidadExiste, disponibilidadVersion, verificaDisponibilidad, verificaBotDisponibilidad } from '../scripts/deploy-disponibilidad.mjs'

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
  return { calls, request, run, bot: vi.fn(async () => true), checkout: () => ({ sha, origin: 'https://github.com/' + repo + '.git' }), exists: vi.fn(async () => exists), version: vi.fn(async () => versionId) }
}
describe('CI de disponibilidad: publicar sólo código validado', () => {
  it('instala apagado, transmite sólo por stdin y activa después del segundo control de main', async () => {
    const io = fixture()
    expect(await deployDisponibilidad(env(), io)).toMatchObject({ enabled: true, versionId, revision: sha })
    expect(io.bot).toHaveBeenCalledOnce()
    expect(io.bot.mock.invocationCallOrder[0]).toBeLessThan(io.exists.mock.invocationCallOrder[0])
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
    expect(io.bot).not.toHaveBeenCalled()
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
describe('Identidad del bot antes de cualquier cambio en Cloudflare', () => {
  const publicConfig = () => Response.json({ ok: true, username: 'Espana_Util_Bot' })
  const identity = (changes: Record<string, unknown> = {}) => Response.json({ ok: true, result: { id: 123456, is_bot: true, username: 'espana_util_bot', ...changes } })
  const mocked = (response: () => Response) => vi.fn(async (url: string, _options: RequestInit) => url === 'https://webapp-3ft.pages.dev/api/telegram/config' ? publicConfig() : response())
  const message = 'No se pudo confirmar que la credencial de CI pertenece al bot de la web'
  const safeError = (error: Error, code: string) => {
    expect(error.message).toBe(message + ' [' + code + ']')
    expect(error.cause).toBeUndefined()
    expect(error.stack).not.toContain(botFixture)
    expect(error.stack).not.toContain('api.telegram.org')
    expect(JSON.stringify(error)).not.toContain(botFixture)
  }

  it('compara username sin distinguir mayúsculas con dos GET de sólo lectura', async () => {
    const fetcher = mocked(() => identity())
    expect(await verificaBotDisponibilidad(env(), { fetch: fetcher })).toBe(true)
    expect(fetcher.mock.calls.map(call => call[0])).toEqual([
      'https://webapp-3ft.pages.dev/api/telegram/config',
      'https://api.telegram.org/bot' + botFixture + '/getMe',
    ])
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: 'GET', redirect: 'manual', cache: 'no-store' })
      expect(options).not.toHaveProperty('body'); expect(options).not.toHaveProperty('headers')
    }
  })
  it('admite el nombre público real y campos opcionales de la respuesta oficial sin cambiarlos', async () => {
    const fetcher = vi.fn(async (url: string) => url === 'https://webapp-3ft.pages.dev/api/telegram/config'
      ? Response.json({ ok: true, username: 'GasolinerasAlertasBot' })
      : Response.json({ ok: true, result: { id: 1234567890123, is_bot: true, username: 'GasolinerasAlertasBot',
        first_name: 'Gasolineras', can_join_groups: true, can_read_all_group_messages: false,
        supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } }))
    expect(await verificaBotDisponibilidad(env(), { fetch: fetcher })).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([false, true])('el diagnóstico explícito entrega sólo dos nombres validados y sigue rechazando otra identidad: %s', different => {
    const publicIdentity = vi.fn(), username = different ? 'Otro_Bot' : 'espana_util_bot'
    const fetcher = mocked(() => identity({ username, first_name: botFixture, description: botFixture }))
    return verificaBotDisponibilidad(env(), { fetch: fetcher, publicIdentity }).then((result: boolean) => {
      expect(different).toBe(false); expect(result).toBe(true)
    }, (error: Error) => {
      expect(different).toBe(true); safeError(error, 'BOT_GETME_IDENTITY_MISMATCH')
    }).then(() => {
      expect(publicIdentity).toHaveBeenCalledExactlyOnceWith({ expectedUsername: 'Espana_Util_Bot', credentialUsername: username })
      expect(JSON.stringify(publicIdentity.mock.calls)).not.toContain(botFixture)
    })
  })
  it.each([
    ['web', { username: '../invalido' }], ['web', { username: 'a'.repeat(33) }],
    ['bot', { username: '../invalido' }], ['bot', { username: 'a'.repeat(33) }],
    ['bot', { username: 'Bot\nInyectado' }], ['bot', { is_bot: false }], ['bot', { id: '123456' }],
  ])('no entrega nombres públicos si %s contiene campos inválidos: %j', async (stage, changes) => {
    const publicIdentity = vi.fn(), fetcher = vi.fn(async (url: string) => url === 'https://webapp-3ft.pages.dev/api/telegram/config'
      ? stage === 'web' ? Response.json({ ok: true, ...changes as object }) : publicConfig()
      : identity(changes as Record<string, unknown>))
    await expect(verificaBotDisponibilidad(env(), { fetch: fetcher, publicIdentity })).rejects.toThrow(message)
    expect(publicIdentity).not.toHaveBeenCalled()
  })
  it('el despliegue no comunica nombres ni siquiera si recibe accidentalmente el callback del diagnóstico', async () => {
    const io = fixture(), publicIdentity = vi.fn(), fetcher = mocked(() => identity({ username: 'Otro_Bot' }))
    const error = await deployDisponibilidad(env(), { ...io, bot: undefined, fetch: fetcher, publicIdentity }).catch((caught: Error) => caught)
    safeError(error, 'BOT_GETME_IDENTITY_MISMATCH')
    expect(error.stack).not.toContain('Otro_Bot'); expect(error.stack).not.toContain('Espana_Util_Bot')
    expect(publicIdentity).not.toHaveBeenCalled(); expect(io.exists).not.toHaveBeenCalled(); expect(io.run).not.toHaveBeenCalled()
  })
  it.each([
    { username: 'Otro_Bot' }, { username: '' }, { is_bot: false },
    { id: 0 }, { id: -1 }, { id: Number.MAX_SAFE_INTEGER + 1 }, { id: '123456' },
  ])('rechaza una identidad distinta o inválida sin crear ni actualizar recursos: %j', async changes => {
    const io = fixture(), fetcher = mocked(() => identity(changes))
    const error = await deployDisponibilidad(env(), { ...io, bot: undefined, fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, changes.username === 'Otro_Bot' ? 'BOT_GETME_IDENTITY_MISMATCH' : 'BOT_GETME_RESPONSE_INVALID')
    expect(io.exists).not.toHaveBeenCalled(); expect(io.run).not.toHaveBeenCalled(); expect(io.version).not.toHaveBeenCalled()
  })
  it.each([401, 302])('rechaza HTTP %s del bot sin reenviar credenciales ni reflejar respuesta', async status => {
    const io = fixture(), fetcher = mocked(() => new Response(botFixture, { status, headers: { location: 'https://example.invalid/' } }))
    const error = await deployDisponibilidad(env(), { ...io, bot: undefined, fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, status === 302 ? 'BOT_GETME_REDIRECT' : 'BOT_GETME_HTTP_401')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(io.exists).not.toHaveBeenCalled(); expect(io.run).not.toHaveBeenCalled()
  })
  it.each(['redireccion', 'sin-configurar', 'username-invalido'])('no consulta la clave si la web devuelve %s', async mode => {
    const fetcher = vi.fn(async () => mode === 'redireccion' ? new Response(null, { status: 302, headers: { location: 'https://example.invalid/' } })
      : Response.json(mode === 'sin-configurar' ? { ok: false } : { ok: true, username: '../otro' }))
    const error = await verificaBotDisponibilidad(env(), { fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, mode === 'redireccion' ? 'WEB_CONFIG_REDIRECT' : 'WEB_CONFIG_RESPONSE_INVALID')
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it.each(['WEB_CONFIG', 'BOT_GETME'])('acota la espera de %s y transforma excepciones con la URL secreta', async phase => {
    const fetcher = vi.fn((url: string, options: RequestInit) => phase === 'BOT_GETME' && url === 'https://webapp-3ft.pages.dev/api/telegram/config'
      ? Promise.resolve(publicConfig()) : new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(Error('https://api.telegram.org/bot' + botFixture + '/getMe')), { once: true })
    }))
    const error = await verificaBotDisponibilidad(env(), { fetch: fetcher, timeoutMs: 20 }).catch((caught: Error) => caught)
    safeError(error, phase + '_TIMEOUT')
    expect(fetcher.mock.calls[0][1].signal!.aborted).toBe(true)
    expect(fetcher).toHaveBeenCalledTimes(phase === 'WEB_CONFIG' ? 1 : 2)
  })
  it.each(['cabecera', 'cuerpo', 'json', 'ok-false'])('rechaza una respuesta %s no verificable y acotada', async mode => {
    const fetcher = mocked(() => mode === 'cabecera' ? new Response('{}', { headers: { 'content-length': '999999999' } })
      : mode === 'cuerpo' ? new Response(' '.repeat(16385))
        : mode === 'json' ? new Response(botFixture)
          : Response.json({ ok: false, description: botFixture }))
    const error = await verificaBotDisponibilidad(env(), { fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, mode === 'json' ? 'BOT_GETME_JSON_INVALID' : 'BOT_GETME_RESPONSE_INVALID')
  })
  it.each(['WEB_CONFIG', 'BOT_GETME'])('no copia mensajes, causas ni códigos externos de un fallo de red en %s', async phase => {
    const io = fixture(), fetcher = vi.fn(async (url: string) => {
      if (phase === 'BOT_GETME' && url === 'https://webapp-3ft.pages.dev/api/telegram/config') return publicConfig()
      throw Object.assign(Error('https://api.telegram.org/bot' + botFixture + '/getMe', { cause: botFixture }), { code: botFixture })
    })
    const error = await deployDisponibilidad(env(), { ...io, bot: undefined, fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, phase + '_NETWORK')
    expect(fetcher).toHaveBeenCalledTimes(phase === 'WEB_CONFIG' ? 1 : 2)
    expect(io.exists).not.toHaveBeenCalled(); expect(io.run).not.toHaveBeenCalled(); expect(io.version).not.toHaveBeenCalled()
  })
  it.each([
    ['WEB_CONFIG', 401, 'HTTP_401'], ['WEB_CONFIG', 503, 'HTTP_5XX'], ['WEB_CONFIG', 307, 'REDIRECT'],
    ['BOT_GETME', 400, 'HTTP_400'], ['BOT_GETME', 403, 'HTTP_403'], ['BOT_GETME', 404, 'HTTP_404'],
    ['BOT_GETME', 429, 'HTTP_429'], ['BOT_GETME', 502, 'HTTP_5XX'], ['BOT_GETME', 418, 'HTTP_OTHER'],
  ])('clasifica %s HTTP %s sin copiar cabeceras ni cuerpo y sin tocar Cloudflare', async (phase, status, code) => {
    const io = fixture(), fetcher = vi.fn(async (url: string) => phase === 'BOT_GETME' && url === 'https://webapp-3ft.pages.dev/api/telegram/config'
      ? publicConfig() : new Response(botFixture, { status: Number(status), statusText: botFixture,
        headers: { location: 'https://example.invalid/' + botFixture } }))
    const error = await deployDisponibilidad(env(), { ...io, bot: undefined, fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, phase + '_' + code)
    expect(fetcher).toHaveBeenCalledTimes(phase === 'WEB_CONFIG' ? 1 : 2)
    expect(io.exists).not.toHaveBeenCalled(); expect(io.run).not.toHaveBeenCalled(); expect(io.version).not.toHaveBeenCalled()
  })
  it('distingue JSON inválido de la web sin consultar Telegram ni tocar Cloudflare', async () => {
    const io = fixture(), fetcher = vi.fn(async () => new Response(botFixture))
    const error = await deployDisponibilidad(env(), { ...io, bot: undefined, fetch: fetcher }).catch((caught: Error) => caught)
    safeError(error, 'WEB_CONFIG_JSON_INVALID')
    expect(fetcher).toHaveBeenCalledOnce()
    expect(io.exists).not.toHaveBeenCalled(); expect(io.run).not.toHaveBeenCalled(); expect(io.version).not.toHaveBeenCalled()
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
  it.each([
    { mode: 'match', accidental: false }, { mode: 'match', accidental: true },
    { mode: 'unauthorized', accidental: true }, { mode: 'mismatch', accidental: true },
  ])('el CLI sólo consulta identidad sin usar configuración de despliegue: %j', ({ mode, accidental }) => {
    const require = createRequire(import.meta.url), { spawnSync } = require('node:child_process'), runtime = require('node:process')
    const preload = `
      let calls = 0;
      globalThis.fetch = async (url, options) => {
        if (++calls > 2 || options.method !== 'GET') throw Error('Consulta no prevista');
        if (url === 'https://webapp-3ft.pages.dev/api/telegram/config') return Response.json({ok:true,username:'GasolinerasAlertasBot'});
        if (url === 'https://api.telegram.org/bot' + process.env.TELEGRAM_BOT_TOKEN + '/getMe') return ${mode === 'unauthorized'
          ? "new Response(process.env.TELEGRAM_BOT_TOKEN,{status:401})"
          : "Response.json({ok:true,result:{id:123456,is_bot:true,username:'" + (mode === 'mismatch' ? 'OtroBot' : 'GasolinerasAlertasBot') + "'}})"};
        throw Error('Origen no previsto');
      };
      process.on('exit', () => { if(calls !== 2) process.exitCode = 90; });
    `
    const result = spawnSync(runtime.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(preload),
      'scripts/deploy-disponibilidad.mjs', '--check-bot'], {
      cwd: runtime.cwd(), encoding: 'utf8', timeout: 10000,
      env: { ...(accidental ? env() : {}), SystemRoot: runtime.env.SystemRoot, TELEGRAM_BOT_TOKEN: botFixture },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(mode === 'match' ? 0 : 1)
    const rows = result.stdout.trim() ? result.stdout.trim().split(/\r?\n/).map((line: string) => JSON.parse(line)) : []
    if (mode === 'unauthorized') {
      expect(rows).toEqual([]); expect(result.stderr).toContain('[BOT_GETME_HTTP_401]')
    } else {
      expect(rows[0]).toEqual({ event: 'public-bot-identity', expectedUsername: 'GasolinerasAlertasBot',
        credentialUsername: mode === 'mismatch' ? 'OtroBot' : 'GasolinerasAlertasBot' })
      if (mode === 'match') expect(rows[1]).toEqual({ event: 'disponibilidad-bot-check', ok: true })
      else expect(result.stderr).toContain('[BOT_GETME_IDENTITY_MISMATCH]')
      expect(rows).toHaveLength(mode === 'match' ? 2 : 1)
    }
    expect(result.stdout + result.stderr).not.toContain(botFixture)
    expect(result.stdout + result.stderr).not.toContain('api.telegram.org')
    expect(result.stdout + result.stderr).not.toMatch(/wrangler|cloudflare\.com|GitHub no confirmó/)
  })
  it('el diagnóstico manual sólo recibe el secreto del bot y nunca ejecuta el despliegue', () => {
    const yaml = createRequire(import.meta.url)('js-yaml')
    const raw = readFileSync('.github/workflows/check-disponibilidad-bot.yml', 'utf8'), workflow = yaml.load(raw)
    expect(Object.keys(workflow.on)).toEqual(['workflow_dispatch'])
    expect(workflow.permissions).toEqual({ contents: 'read' })
    expect(workflow.jobs.check.if).toBe("github.repository == 'ioritzarroyuelos-ai/gasolineras-espana' && github.ref == 'refs/heads/main'")
    const steps = workflow.jobs.check.steps, commands = steps.filter((step: any) => step.run)
    expect(steps[0].with).toMatchObject({ ref: '${{ github.sha }}', 'persist-credentials': false })
    expect(commands).toHaveLength(2)
    expect(commands[0].run).toContain('git rev-parse HEAD')
    expect(commands[1]).toMatchObject({ env: { TELEGRAM_BOT_TOKEN: '${{ secrets.TELEGRAM_BOT_TOKEN }}' },
      run: 'node scripts/deploy-disponibilidad.mjs --check-bot' })
    expect(raw.match(/secrets\.[A-Z_]+/g)).toEqual(['secrets.TELEGRAM_BOT_TOKEN'])
    expect(raw).not.toMatch(/CLOUDFLARE_|GH_TOKEN|GITHUB_TOKEN|DISPONIBILIDAD_ENABLED|wrangler|sendMessage/)
  })
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
