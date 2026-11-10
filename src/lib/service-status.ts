export type ServiceId = 'gasolineras' | 'farmacias' | 'tiempo' | 'itv' | 'politica' | 'deportes'
export interface ServiceItem { name: string; updatedAt: string | null; count: number; issue?: string }
export interface ServiceManifest { schema: number; revision?: string; services: { id: ServiceId; name: string; maxAgeHours: number; items: ServiceItem[] }[] }
const SERVICES = { gasolineras: ['Gasolineras', 24], farmacias: ['Farmacias', 30], tiempo: ['Tiempo', 12], itv: ['ITV', 30], politica: ['Política', 30], deportes: ['Deportes', 24] } as const
export function evaluateServices(manifest: ServiceManifest | null, now = Date.now()) {
  const services = (Object.keys(SERVICES) as ServiceId[]).map(id => {
    const [name, maxAgeHours] = SERVICES[id]
    const source = manifest?.schema === 1 ? manifest.services?.find(s => s.id === id) : null
    const items = (Array.isArray(source?.items) && source.items.length ? source.items : [{ name: 'Sin datos de comprobación', updatedAt: null, count: 0 }]).map(i => {
      const t = i.updatedAt ? Date.parse(i.updatedAt) : NaN
      const ageHours = (now - t) / 3600000
      const problem = !Number.isFinite(t) ? 'Fecha de actualización no disponible' : ageHours < -5 / 60 ? 'Fecha de actualización futura' : ageHours > maxAgeHours ? 'Actualización atrasada' : !(i.count > 0) ? 'Sin datos' : i.issue || null
      return { ...i, ageHours: Number.isFinite(ageHours) ? Math.round(ageHours * 10) / 10 : null, problem }
    })
    const issues = items.filter(i => i.problem)
    const dates = items.map(i => i.updatedAt).filter((t): t is string => !!t && Number.isFinite(Date.parse(t)))
    return { id, name, ok: issues.length === 0, maxAgeHours, checked: items.length, healthy: items.length - issues.length, oldestUpdate: dates.length ? dates.sort((a,b) => Date.parse(a)-Date.parse(b))[0] : null, issues }
  })
  return { ok: services.every(s => s.ok), checkedAt: new Date(now).toISOString(), publishedRevision: manifest?.revision, scope: 'Copias publicadas; no certifica disponibilidad en directo de las fuentes externas', services }
}
