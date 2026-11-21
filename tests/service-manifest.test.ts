import { afterEach, describe, expect, it, vi } from 'vitest'
import { evaluateServices, type ServiceManifest } from '../src/lib/service-status'

const archivos = vi.hoisted(() => new Map<string, string>())
vi.mock('node:fs', () => ({
  readFileSync: (path: string) => {
    const key = path.replaceAll('\\', '/').split('/public/data/')[1]
    if (!archivos.has(key)) throw Error('No existe la muestra')
    return archivos.get(key)
  },
  writeFileSync: (path: string, contenido: string) => archivos.set(path.replaceAll('\\', '/').split('/public/data/')[1], contenido),
}))

afterEach(() => { archivos.clear(); vi.unstubAllEnvs(); vi.useRealTimers() })

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

async function generaItv(operadores?: unknown) {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-21T09:00:00Z'))
  vi.resetModules(); vi.stubEnv('GITHUB_SHA', 'a'.repeat(40))
  archivos.set('itv.json', JSON.stringify({ generatedAt: '2026-11-21T08:30:00Z', total: 571,
    fuentesEstado: [{ nombre: 'DGT', ultimoExito: '2026-11-21T08:30:00Z', total: 518, estado: 'actualizada' }] }))
  archivos.set('itv-tarifas-estado.json', JSON.stringify({ fuentes: [{ id: 'asturias', checkedAt: '2026-11-21T08:30:00Z', estado: 'verificada' }] }))
  if (operadores !== undefined) archivos.set('itv-fuentes/operadores.json', JSON.stringify(operadores))
  // @ts-expect-error Generador Node, sin API TypeScript pública.
  await import('../scripts/gen-service-manifest.mjs')
  const manifest = JSON.parse(archivos.get('service-manifest.json')!) as ServiceManifest
  return { items: manifest.services.find(s => s.id === 'itv')!.items,
    estado: evaluateServices(manifest).services.find(s => s.id === 'itv')! }
}

describe('estado independiente de los canales de cita ITV', () => {
  const anterior = '2026-11-20T21:11:16.955Z', consulta = '2026-11-21T08:34:00Z'
  it('señala la cita conservada aunque directorio y tarifas estén correctos hoy', async () => {
    const { items, estado } = await generaItv({ itvasa: { nombre: 'ITVASA', estado: 'conservada',
      ultimoExito: anterior, consultado: consulta, error: 'UND_ERR_CONNECT_TIMEOUT' } })
    expect(items.find(i => i.name === 'Citas · ITVASA')).toMatchObject({ updatedAt: anterior, count: 1,
      issue: 'No se ha podido comprobar el canal oficial de citas. Se conserva su última comprobación válida.' })
    expect(estado.ok).toBe(false)
    expect(estado.issues.map(i => i.name)).toEqual(['Citas · ITVASA'])
    expect(JSON.stringify(items)).not.toContain('UND_ERR_CONNECT_TIMEOUT')
  })
  it.each(['conservada', 'error'])('un canal %s sin éxito anterior no toma la fecha de su intento', async estadoOperador => {
    const { items, estado } = await generaItv({ itvasa: { nombre: 'ITVASA', estado: estadoOperador, consultado: consulta } })
    expect(items.find(i => i.name === 'Citas · ITVASA')).toMatchObject({ updatedAt: null, count: 0 })
    expect(estado.ok).toBe(false)
  })
  it('admite una comprobación exitosa independiente del día del directorio', async () => {
    const { items, estado } = await generaItv({ itvasa: { nombre: 'ITVASA', estado: 'actualizada', ultimoExito: anterior, consultado: anterior } })
    expect(items.find(i => i.name === 'Citas · ITVASA')).toEqual({ name: 'Citas · ITVASA', updatedAt: anterior, count: 1 })
    expect(estado.ok).toBe(true)
  })
  it.each([undefined, {}, []])('la ausencia de comprobaciones no deja el servicio en verde', async operadores => {
    const { estado } = await generaItv(operadores)
    expect(estado.ok).toBe(false)
    expect(estado.issues.map(i => i.name)).toContain('Comprobación de los canales de citas')
  })
  it('rechaza una fecha de éxito posterior al intento sin rejuvenecerla', async () => {
    const { estado } = await generaItv({ itvasa: { nombre: 'ITVASA', estado: 'actualizada', ultimoExito: consulta, consultado: anterior } })
    expect(estado.ok).toBe(false)
    expect(estado.issues[0]).toMatchObject({ name: 'Citas · ITVASA', updatedAt: consulta,
      problem: 'No se ha podido confirmar una comprobación de citas con fechas válidas.' })
  })
})
