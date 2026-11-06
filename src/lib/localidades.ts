import { slugifyMunicipio } from './municipios'
import { PROVINCIAS } from './provincias'
import { GUARDIAS_TERRITORIO_BY_PROVINCIA, parseGuardias, guardiasForProvincia, municipiosConGuardia, frescuraGuardia } from './guardias'
import type { GuardiasFile, MunicipioGuardia } from './guardias'
import type { ItvFile } from './itv'
import { frescuraTiempo, type MunicipioLista, type Prediccion } from '../../scripts/lib/tiempo.mjs'

export interface LocalidadIndex { ine: string; nombre: string; provinciaNombre: string }
export interface ServicioLocal { titulo: string; url: string; detalle: string }
export interface Localidad extends LocalidadIndex {
  gas: { url: string; ts?: string; count: number; min95?: number }
  farmacias: { url: string; ts?: string; count: number; zona: string }
  itv: { url: string; count: number; ts?: string }
  tiempo: { url: string; pred?: Prediccion }
}
const normaliza = (s: string) => slugifyMunicipio(s).replace(/-/g, ' ')

// Formas documentadas del mismo municipio. La comparación siempre va dentro de su provincia.
export function slugsMunicipioGuardia(m: Pick<MunicipioLista, 'ine' | 'nombre'>): string[] {
  const slugs = new Set([slugifyMunicipio(m.nombre)])
  // El INE puede dar ambos nombres oficiales. Algunos colegios usan sólo uno.
  for (const nombre of m.nombre.split('/')) {
    slugs.add(slugifyMunicipio(nombre))
    const conArticulo = nombre.trim().match(/^(.+),\s*(las?|los?|el|as?|os?|els|les|es|sa|ses|l['’])$/i)
    if (conArticulo) slugs.add(slugifyMunicipio(conArticulo[2] + ' ' + conArticulo[1]))
  }
  if (m.ine === '28127') slugs.add('las-rozas') // El Colegio de Madrid publica «LAS ROZAS».
  return [...slugs]
}

export function buscaLocalidades(all: LocalidadIndex[], q: string): LocalidadIndex[] {
  const query = normaliza(q.trim().slice(0, 70))
  if (query.length < 2) return []
  return all.filter(m => normaliza(m.nombre + ' ' + m.provinciaNombre).includes(query))
    .sort((a, b) => Number(normaliza(b.nombre) === query) - Number(normaliza(a.nombre) === query) || a.nombre.localeCompare(b.nombre, 'es'))
    .slice(0, 12)
}
export function construyeLocalidades(municipios: MunicipioLista[], stations: Record<string, unknown>[], gasTs: string,
  guardias: Record<string, GuardiasFile>, itv: ItvFile, predicciones: Record<string, Prediccion>): Localidad[] {
  const gas = new Map<string, { count: number; min95?: number }>()
  for (const s of stations) {
    const key = String(s.IDProvincia) + '/' + slugifyMunicipio(String(s.Municipio || ''))
    const item = gas.get(key) || { count: 0 }
    item.count++
    const p = Number(String(s['Precio Gasolina 95 E5'] || '').replace(',', '.'))
    if (p > 0 && Number.isFinite(p)) item.min95 = Math.min(item.min95 ?? Infinity, p)
    gas.set(key, item)
  }
  const parsed = new Map(Object.entries(guardias).map(([t, f]) => [t, parseGuardias(f)]))
  const municipiosGuardia = new Map<string, MunicipioGuardia>()
  for (const prov of PROVINCIAS) {
    const territorio = GUARDIAS_TERRITORIO_BY_PROVINCIA[prov.slug]
    for (const m of municipiosConGuardia(guardiasForProvincia(parsed.get(territorio) || [], prov.id, territorio))) {
      municipiosGuardia.set(prov.id + '/' + m.slug, m)
    }
  }
  return municipios.map(m => {
    const prov = PROVINCIAS.find(p => p.id === m.provinciaId)!
    const slug = slugifyMunicipio(m.nombre), key = prov.id + '/' + slug
    const g = gas.get(key), territorio = GUARDIAS_TERRITORIO_BY_PROVINCIA[prov.slug]
    const guardia = slugsMunicipioGuardia(m).map(s => municipiosGuardia.get(prov.id + '/' + s)).find(Boolean)
    const estaciones = (itv.estaciones || []).filter(e => e.prov === prov.id && slugifyMunicipio(e.mun) === slug)
    return { ine: m.ine, nombre: m.nombre, provinciaNombre: m.provinciaNombre,
      gas: { url: '/gasolineras/' + prov.slug + (g ? '/' + slug : ''), ts: gasTs, count: g?.count || 0, min95: g?.min95 },
      farmacias: { url: '/farmacias/' + prov.slug + (territorio ? '/' + (guardia?.slug || slug) : ''), ts: guardias[territorio]?.ts, count: guardia?.count || 0, zona: ['35', '38'].includes(prov.id) ? 'Atlantic/Canary' : 'Europe/Madrid' },
      itv: { url: (itv.estaciones || []).some(e => e.prov === prov.id) ? '/itv/' + prov.slug + (estaciones.length ? '/' + slug : '') : '/itv/', ts: itv.generatedAt, count: estaciones.length },
      tiempo: { url: '/tiempo/' + m.provinciaSlug + '/' + m.slug, pred: predicciones[m.ine] },
    }
  })
}
export function serviciosLocalidad(m: Localidad, now = Date.now()): ServicioLocal[] {
  const fresco = (ts: string | undefined, horas: number) => { const age = now - Date.parse(ts || ''); return Number.isFinite(age) && age >= -300000 && age <= horas * 3600000 }
  const p = m.tiempo.pred
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: m.farmacias.zona }).format(new Date(now))
  const dia = p?.dias.find(d => d.fecha.slice(0, 10) === hoy)
  return [
    { titulo: 'Gasolineras', url: m.gas.url, detalle: m.gas.count ? (fresco(m.gas.ts, 24) && m.gas.min95 ? 'Gasolina 95 desde ' + m.gas.min95.toFixed(3).replace('.', ',') + ' €/L · ' : '') + m.gas.count + ' estaciones' + (fresco(m.gas.ts, 24) ? '' : ' · precios pendientes de actualizar') : 'Consultar la provincia' },
    { titulo: 'Farmacias de guardia', url: m.farmacias.url, detalle: m.farmacias.count && frescuraGuardia(m.farmacias.ts, new Date(now), m.farmacias.zona).esHoy ? 'Consultar las farmacias y sus horarios' : 'Consultar turnos y fuentes oficiales' },
    { titulo: 'El tiempo', url: m.tiempo.url, detalle: p && dia && frescuraTiempo(p.elaborado, now).fiable ? `${dia.tmin ?? '—'}° / ${dia.tmax ?? '—'}° · ${dia.cielo || p.fuente}` : 'Consultar la predicción del municipio' },
    { titulo: 'ITV', url: m.itv.url, detalle: m.itv.count ? m.itv.count + ' estaciones' + (fresco(m.itv.ts, 40 * 24) ? '' : ' · directorio pendiente de actualizar') : 'Consultar estaciones en la provincia' },
  ]
}
