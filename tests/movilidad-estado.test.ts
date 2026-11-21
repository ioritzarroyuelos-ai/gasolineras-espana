import { describe, expect, it } from 'vitest'
import { movilidadItems } from '../scripts/lib/movilidad-estado.mjs'
import { evaluateServices, type ServiceManifest } from '../src/lib/service-status'
const now = Date.parse('2026-11-21T10:00:00Z')
const fecha = new Date(now).toISOString()
const directory = { schema: 1, redId: 'metro-bilbao', ts: fecha, fechaDatos: fecha, inicio: '20261119', fin: '20261219', estaciones: { '1': { id: 'metro-bilbao-1', nombre: 'Estación de prueba', lat: 43.2, lon: -2.9 } } }
const report = () => ({ schema: 1, consultado: fecha, fuentes: ['bizi-zaragoza', 'trafico-cataluna', 'camaras-cataluna', 'metro-bilbao'].map(id => ({ id, consultado: fecha, fechaDatos: fecha, estado: 'actual', total: 0, error: '' })) })
describe('estado diario de movilidad, separado de disponibilidad en directo', () => {
  it('un parte vacío comprobado cuenta como revisión válida sin inventar incidencias', () => {
    const items = movilidadItems(report(), directory, now)
    expect(items.every(i => !i.issue)).toBe(true)
    expect(items.find(i => i.name === 'Comprobación · Tráfico de Cataluña')).toMatchObject({ count: 1, updatedAt: fecha })
    expect(report().fuentes[1].total).toBe(0)
  })
  it('publicar un informe reciente no oculta fallos, fuentes ausentes o duplicadas', () => {
    const r = report(); r.fuentes[1].estado = 'error'; r.fuentes[1].error = 'Fuente no disponible'; r.fuentes.pop(); r.fuentes.push(r.fuentes[0])
    const items = movilidadItems(r, directory, now)
    expect(items[0].issue).toContain('3 fuentes')
    expect(items.find(i => i.name === 'Comprobación · Tráfico de Cataluña')?.issue).toBe('Fuente no disponible')
    expect(items.find(i => i.name === 'Comprobación · Metro Bilbao')?.count).toBe(0)
  })
  it('una descarga reciente no rejuvenece un catálogo antiguo o con fecha futura', () => {
    for (const date of ['2026-11-17T10:00:00Z', '2026-11-22T10:00:00Z', 'incorrecta']) {
      const items = movilidadItems(report(), { ...directory, fechaDatos: date }, now)
      expect(items.find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('fecha original')
    }
  })
  it('el estado público detecta revisiones diarias atrasadas aunque todas dijeran actual', () => {
    const r = report(); r.consultado = '2026-11-19T10:00:00Z'; r.fuentes.forEach(f => { f.consultado = r.consultado; f.fechaDatos = r.consultado })
    const m: ServiceManifest = { schema: 1, services: [{ id: 'transporte', name: 'Transporte', maxAgeHours: 999, items: movilidadItems(r, directory, now) }] }
    expect(evaluateServices(m, now).services.find(s => s.id === 'transporte')?.ok).toBe(false)
  })
  it('un informe comprobado ayer conserva su validez diaria sin afirmar disponibilidad actual', () => {
    const r = report(); r.consultado = new Date(now - 24 * 3600000).toISOString()
    r.fuentes.forEach(f => { f.consultado = r.consultado; f.fechaDatos = new Date(Date.parse(r.consultado) - 60000).toISOString() })
    const items = movilidadItems(r, directory, now)
    expect(items.every(i => !i.issue)).toBe(true)
    expect(items.find(i => i.name === 'Comprobación · Metro Bilbao')).toMatchObject({ updatedAt: r.consultado, count: 1 })
    const m: ServiceManifest = { schema: 1, services: [{ id: 'transporte', name: 'Transporte', maxAgeHours: 30, items }] }
    expect(evaluateServices(m, now).services.find(s => s.id === 'transporte')?.ok).toBe(true)
    expect(evaluateServices(m, now + 7 * 3600000).services.find(s => s.id === 'transporte')?.ok).toBe(false)
  })
  it.each([
    ['bizi-zaragoza', 'Bizi Zaragoza', 5 * 60000],
    ['trafico-cataluna', 'Tráfico de Cataluña', 10 * 60000],
    ['camaras-cataluna', 'Cámaras de Cataluña', 30 * 3600000],
    ['metro-bilbao', 'Metro Bilbao', 2 * 60000],
  ] as const)('respeta el límite de antigüedad original al comprobar %s', (id, name, limit) => {
    const r = report(), f = r.fuentes.find(f => f.id === id)!
    f.fechaDatos = new Date(now - limit + 1).toISOString()
    expect(movilidadItems(r, directory, now).find(i => i.name === 'Comprobación · ' + name)?.issue).toBeUndefined()
    f.fechaDatos = new Date(now - limit).toISOString()
    expect(movilidadItems(r, directory, now).find(i => i.name === 'Comprobación · ' + name)).toMatchObject({ count: 0, updatedAt: fecha, issue: 'La fuente ya estaba desactualizada cuando se hizo la comprobación.' })
    expect(f.fechaDatos).toBe(new Date(now - limit).toISOString())
  })
  it.each(['2026-11-22T10:00:00Z', '2026-02-30T10:00:00Z', '', 'no-fecha'])('rechaza fecha original futura o imposible: %s', original => {
    const r = report(); r.fuentes[3].fechaDatos = original
    expect(movilidadItems(r, directory, now).find(i => i.name === 'Comprobación · Metro Bilbao')?.issue).toBeTruthy()
    expect(movilidadItems(r, directory, now)[0].issue).toContain('1 fuentes')
  })
  it('una fecha original posterior a la consulta es inválida aunque ambas estén en el pasado', () => {
    const r = report(); r.fuentes[0].consultado = new Date(now - 120000).toISOString(); r.fuentes[0].fechaDatos = new Date(now - 60000).toISOString()
    expect(movilidadItems(r, directory, now).find(i => i.name === 'Comprobación · Bizi Zaragoza')?.issue).toContain('posterior a la consulta')
  })
  it('la tolerancia existente a relojes de consulta no permite un parte original del futuro', () => {
    const r = report(); r.fuentes[3].consultado = new Date(now + 120000).toISOString(); r.fuentes[3].fechaDatos = new Date(now + 60000).toISOString()
    expect(movilidadItems(r, directory, now).find(i => i.name === 'Comprobación · Metro Bilbao')?.issue).toContain('futura')
    r.fuentes[3].fechaDatos = fecha; r.fuentes[3].consultado = new Date(now + 6 * 60000).toISOString()
    const m: ServiceManifest = { schema: 1, services: [{ id: 'transporte', name: 'Transporte', maxAgeHours: 30, items: movilidadItems(r, directory, now) }] }
    expect(evaluateServices(m, now).services.find(s => s.id === 'transporte')?.issues.some(i => i.problem === 'Fecha de actualización futura')).toBe(true)
  })
  it('un calendario vencido o que todavía no empezó nunca se presenta como directorio actual', () => {
    expect(movilidadItems(report(), { ...directory, fin: '20261120' }, now).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('ha vencido')
    expect(movilidadItems(report(), { ...directory, inicio: '20261122' }, now).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('todavía no incluye hoy')
  })
  it.each([
    { inicio: '20260230', fin: '20261219' }, { inicio: '20261121', fin: '20261301' },
    { inicio: '20261219', fin: '20261119' }, { inicio: '2026-11-19', fin: '20261219' },
  ])('rechaza fechas imposibles o invertidas del calendario: %j', fields => {
    expect(movilidadItems(report(), { ...directory, ...fields }, now).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('calendario')
  })
  it('el calendario contiene hoy según Madrid incluso cuando UTC aún es el día anterior', () => {
    const midnight = Date.parse('2026-11-20T23:30:00Z'), stamp = new Date(midnight).toISOString()
    const d = { ...directory, fechaDatos: stamp, ts: stamp, inicio: '20261121', fin: '20261121' }
    expect(movilidadItems(report(), d, midnight).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toBeUndefined()
    expect(movilidadItems(report(), { ...d, inicio: '20261120', fin: '20261120' }, midnight).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('ha vencido')
  })
  it('la consulta del catálogo caduca a30h y su fecha original no se renueva con ella', () => {
    const d = { ...directory, fechaDatos: new Date(now - 48 * 3600000).toISOString(), ts: new Date(now - 30 * 3600000).toISOString() }
    expect(movilidadItems(report(), d, now).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('30 horas')
    d.ts = new Date(now - 30 * 3600000 + 1).toISOString()
    expect(movilidadItems(report(), d, now).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toBeUndefined()
    d.fechaDatos = new Date(now - 72 * 3600000).toISOString()
    expect(movilidadItems(report(), d, now).find(i => i.name === 'Directorio de Metro Bilbao')?.issue).toContain('fecha original')
  })
})
