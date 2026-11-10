import { afterEach, describe, expect, it, vi } from 'vitest'

const archivos = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const key = path.replaceAll('\\', '/').split('/public/data/')[1]
    if (!archivos.has(key)) throw Error('No existe la muestra')
    return archivos.get(key)
  },
  writeFileSync: (path: string, contenido: string) => archivos.set(path.replaceAll('\\', '/').split('/public/data/')[1], contenido),
}))

afterEach(() => { archivos.clear(); vi.unstubAllEnvs() })

async function genera(estado: string, avisos?: unknown[]) {
  vi.resetModules()
  vi.stubEnv('GITHUB_SHA', 'a'.repeat(40))
  archivos.set('politica/index.json', JSON.stringify({ generado: '2026-11-10T17:00:00Z', elecciones: [{ id: 'generales', estado, ultimaComprobacionOk: '2026-11-10T16:00:00Z' }] }))
  archivos.set('politica/generales.json', JSON.stringify({ avisosFuentes: avisos }))
  // @ts-expect-error Generador Node, sin API TypeScript pública.
  await import('../scripts/gen-service-manifest.mjs')
  const manifest = JSON.parse(archivos.get('service-manifest.json')!)
  return manifest.services.find((s: { id: string }) => s.id === 'politica').items.find((i: { name: string }) => i.name === 'Elecciones generales de España')
}

describe('estado publicado de las fuentes de política', () => {
  it('una fuente adicional pendiente se ve aunque la principal esté comprobada hoy', async () => {
    const item = await genera('ok', ['El seguimiento de SW no se ha podido verificar.', null, ''])
    expect(item).toEqual({ name: 'Elecciones generales de España', updatedAt: '2026-11-10T16:00:00Z', count: 1, issue: 'El seguimiento de SW no se ha podido verificar.' })
  })
  it('no inventa incidencias cuando todas las fuentes funcionan', async () => {
    expect(await genera('ok')).not.toHaveProperty('issue')
  })
  it('mantiene visible un fallo completo de la fuente aunque su última copia aún sea reciente', async () => {
    expect(await genera('desactualizado')).toMatchObject({ updatedAt: '2026-11-10T16:00:00Z', issue: 'Fuente pendiente de actualizar' })
  })
})
