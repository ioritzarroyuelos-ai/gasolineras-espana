import { afterEach, describe, expect, it, vi } from 'vitest'
import { execFileSync, process } from './helpers/process.mjs'
vi.mock('node:child_process', () => ({ execFileSync: vi.fn() }))
vi.mock('node:fs', () => ({ appendFileSync: vi.fn() }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn().mockResolvedValue(undefined) }))
const calls: string[][] = []
async function ejecuta({ ref = 'refs/heads/main', files = 'public/data/itv.json', result = 'success', baseCambio = false, retrasoHead = 0 } = {}) {
  vi.resetModules()
  vi.stubEnv('GITHUB_REPOSITORY', 'test/repo')
  vi.stubEnv('GITHUB_REF', ref)
  vi.stubEnv('GITHUB_RUN_ID', '1234')
  vi.stubEnv('GITHUB_RUN_ATTEMPT', '1')
  vi.stubEnv('GITHUB_OUTPUT', '')
  vi.stubEnv('GH_TOKEN', 'identidad-simulada-no-secreta')
  vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'publish-data.mjs', 'itv'])
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('fin correcto') })
  calls.length = 0
  let reconciliado = false
  let consultasHead = 0
  vi.mocked(execFileSync).mockImplementation(((cmd: string, args: string[]) => {
    calls.push([cmd, ...args])
    if (args[0] === 'diff') return files
    if (args[0] === 'rev-parse') return 'sha-validado'
    if (args[0] === 'pr' && args[1] === 'create') return 'https://github.com/test/repo/pull/1'
    if (args[0] === 'pr' && args[1] === 'update-branch') reconciliado = true
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({baseRefOid:baseCambio?'nuevo-main':'sha-validado',headRefOid:reconciliado && consultasHead++ >= retrasoHead?'sha-reconciliado':'sha-validado'})
    if (args[0] === 'run' && args[1] === 'list') return JSON.stringify([{ status: 'completed', conclusion: reconciliado?'success':result, databaseId: 12 }])
    return ''
  }) as any)
  // Importación del ejecutable: aquí GitHub/git están simulados; la verificación
  // end-to-end del flujo se hace con una actualización real tras publicar el código.
  // @ts-expect-error Ejecutable Node sin API TypeScript pública.
  return import('../scripts/publish-data.mjs')
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })
describe('robot de datos protegido', () => {
  it('no publica desde una rama de código', async () => {
    await expect(ejecuta({ ref: 'refs/heads/fix/codigo' })).rejects.toThrow('partiendo de main')
    expect(calls).toEqual([])
  })
  it('rechaza cambios de código aunque estuvieran preparados por error', async () => {
    await expect(ejecuta({ files: 'public/data/itv.json\nsrc/index.tsx' })).rejects.toThrow('fuera de public/data')
    expect(calls.some(c => c.includes('push'))).toBe(false)
  })
  it('deja el PR sin fusionar si falla una comprobación', async () => {
    await expect(ejecuta({ result: 'failure' })).rejects.toThrow('quedan en el PR')
    expect(calls.some(c => c.includes('merge'))).toBe(false)
  })
  it('fusiona solo el commit comprobado por CI y Security', async () => {
    await expect(ejecuta()).rejects.toThrow('fin correcto')
    expect(calls.filter(c => c[1] === 'workflow' && c[2] === 'run')).toHaveLength(0)
    const comprobaciones = calls.filter(c => c[1] === 'run' && c[2] === 'list')
    expect(comprobaciones).toHaveLength(2)
    expect(comprobaciones.every(c => c.includes('pull_request') && c.includes('sha-validado'))).toBe(true)
    expect(calls.some(c => c[1] === 'auth' && c[2] === 'setup-git')).toBe(true)
    expect(calls.find(c => c[1] === 'pr' && c[2] === 'merge')).toContain('--match-head-commit')
    expect(calls.find(c => c[1] === 'pr' && c[2] === 'merge')).toContain('sha-validado')
    expect(calls.some(c => c[0] === 'git' && c[1] === 'push' && c.at(-1) === 'main')).toBe(false)
  })
  it('si main cambia durante la lectura, reconcilia sin conflictos y repite ambos controles sobre el SHA nuevo', async () => {
    await expect(ejecuta({result:'failure',baseCambio:true})).rejects.toThrow('fin correcto')
    expect(calls.filter(c=>c[1]==='pr'&&c[2]==='update-branch')).toHaveLength(1)
    expect(calls.filter(c=>c[1]==='run'&&c[2]==='list'&&c.includes('sha-reconciliado'))).toHaveLength(2)
    expect(calls.find(c=>c[1]==='pr'&&c[2]==='merge')).toContain('sha-reconciliado')
    expect(calls.flat()).not.toContain('--admin')
  })
  it('espera a que GitHub confirme el SHA nuevo cuando el rebase es asíncrono', async () => {
    await expect(ejecuta({result:'failure',baseCambio:true,retrasoHead:3})).rejects.toThrow('fin correcto')
    expect(calls.filter(c=>c[1]==='pr'&&c[2]==='update-branch')).toHaveLength(1)
    expect(calls.filter(c=>c[1]==='run'&&c[2]==='list'&&c.includes('sha-reconciliado'))).toHaveLength(2)
    expect(calls.find(c=>c[1]==='pr'&&c[2]==='merge')).toContain('sha-reconciliado')
  })
  it('conserva el PR sin fusionar si GitHub no llega a confirmar el rebase', async () => {
    await expect(ejecuta({result:'failure',baseCambio:true,retrasoHead:100})).rejects.toThrow('aún no confirma')
    expect(calls.some(c=>c[1]==='pr'&&c[2]==='merge')).toBe(false)
  })
})
