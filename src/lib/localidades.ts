import { slugifyMunicipio } from './municipios'
import { PROVINCIAS } from './provincias'
import { GUARDIAS_TERRITORIO_BY_PROVINCIA, parseGuardias, guardiasForProvincia, frescuraGuardia } from './guardias'
import type { GuardiasFile } from './guardias'
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
  return municipios.map(m => {
    const prov = PROVINCIAS.find(p => p.id === m.provinciaId)!
    const slug = slugifyMunicipio(m.nombre), key = prov.id + '/' + slug
    const g = gas.get(key), territorio = GUARDIAS_TERRITORIO_BY_PROVINCIA[prov.slug]
    const fs = guardiasForProvincia(parsed.get(territorio) || [], prov.id, territorio).filter(g => slugifyMunicipio(g.municipio) === slug)
    const estaciones = (itv.estaciones || []).filter(e => e.prov === prov.id && slugifyMunicipio(e.mun) === slug)
    return { ine: m.ine, nombre: m.nombre, provinciaNombre: m.provinciaNombre,
      gas: { url: '/gasolineras/' + prov.slug + (g ? '/' + slug : ''), ts: gasTs, count: g?.count || 0, min95: g?.min95 },
      farmacias: { url: guardias[territorio] ? '/farmacias/' + prov.slug + (fs.length ? '/' + slug : '') : '/farmacias/', ts: guardias[territorio]?.ts, count: fs.length, zona: ['35', '38'].includes(prov.id) ? 'Atlantic/Canary' : 'Europe/Madrid' },
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
    { titulo: 'Farmacias de guardia', url: m.farmacias.url, detalle: m.farmacias.count && frescuraGuardia(m.farmacias.ts, new Date(now), m.farmacias.zona).fiable ? m.farmacias.count + ' turnos publicados · comprueba el horario' : 'Consultar turnos y fuentes oficiales' },
    { titulo: 'El tiempo', url: m.tiempo.url, detalle: p && dia && frescuraTiempo(p.elaborado, now).fiable ? `${dia.tmin ?? '—'}° / ${dia.tmax ?? '—'}° · ${dia.cielo || p.fuente}` : 'Consultar la predicción del municipio' },
    { titulo: 'ITV', url: m.itv.url, detalle: m.itv.count ? m.itv.count + ' estaciones' + (fresco(m.itv.ts, 40 * 24) ? '' : ' · directorio pendiente de actualizar') : 'Consultar estaciones en la provincia' },
  ]
}
