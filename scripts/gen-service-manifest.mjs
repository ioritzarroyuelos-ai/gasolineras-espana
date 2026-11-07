// Resumen de las copias que se publican en ESTE artefacto. No modifica las fuentes.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ELECCIONES } from './lib/politica-catalogo.mjs'
import { instanteLocal } from './lib/fechas.mjs'
const root = resolve(import.meta.dirname, '..', 'public', 'data')
function read(file) { try { return JSON.parse(readFileSync(resolve(root, file), 'utf8')) } catch { return null } }
const item = (name, updatedAt, count, issue) => ({ name, updatedAt: updatedAt || null, count: count || 0, ...(issue ? { issue } : {}) })
const gas = read('snapshot-meta.json')
const itv = read('itv.json')
const territories = 'alava alicante almeria asturias avila badajoz baleares barcelona bizkaia burgos caceres cadiz cantabria castellon ceuta clm cordoba coruna gipuzkoa girona granada huelva huesca jaen laspalmas leon lleida madrid malaga melilla murcia navarra ourense palencia pontevedra rioja salamanca segovia sevilla soria tarragona tenerife teruel valencia valladolid zamora zaragoza'.split(' ')
const guardias = territories.map(t => { const g = read(`guardias-${t}.json`); return item(t, g?.ts, g?.guardias?.length, g?.incidencias?.join('; ')) })
// El robot precarga los municipios importantes; el resto se consulta bajo demanda.
const importantes = read('tiempo/municipios.json')?.municipios?.filter(m => m.imp) || []
const tiempoFiles = new Map()
const tiempo = importantes.map(m => {
  if (!tiempoFiles.has(m.provinciaSlug)) tiempoFiles.set(m.provinciaSlug, read(`tiempo/snapshot/${m.provinciaSlug}.json`))
  const p = tiempoFiles.get(m.provinciaSlug)?.predicciones?.[m.ine]
  const t = instanteLocal(p?.elaborado)
  return item(`${m.nombre} (${m.provinciaNombre})`, Number.isFinite(t) ? new Date(t).toISOString() : null, p?.dias?.length)
})
const politica = read('politica/index.json')
const deportes = read('deportes/index.json')
const elecciones = ELECCIONES.map(e => {
  const p = politica?.elecciones?.find(p => p.id === e.id)
  return item(e.nombre, p?.ultimaComprobacionOk, p ? 1 : 0, p?.estado === 'no_disponible' ? 'Fuente no disponible' : undefined)
})
const services = [
  { id: 'gasolineras', name: 'Gasolineras', maxAgeHours: 24, items: [item('Precios del Ministerio', gas?.fetchedAt, gas?.stationCount)] },
  { id: 'farmacias', name: 'Farmacias', maxAgeHours: 30, items: guardias },
  { id: 'tiempo', name: 'Tiempo', maxAgeHours: 12, items: tiempo },
  { id: 'itv', name: 'ITV', maxAgeHours: 40 * 24, items: itv?.fuentesEstado?.length
    ? itv.fuentesEstado.map(f => item(f.nombre, f.ultimoExito || f.consultado, f.total,
      f.estado === 'conservada' ? 'Fuente no disponible. Se conserva su copia anterior.' : undefined))
    : [item('Directorio de estaciones', itv?.generatedAt, itv?.total)] },
  { id: 'politica', name: 'Política', maxAgeHours: 30, items: [item('Índice de elecciones', politica?.generado, politica?.elecciones?.length), ...elecciones] },
  { id: 'deportes', name: 'Deportes', maxAgeHours: 24, items: (deportes?.competiciones || []).flatMap(c =>
    ['agenda', 'clasificacion'].filter(k => c[k]?.verificadoEn).map(k => item(c.nombre + (c.grupo ? ' · ' + c.grupo : '') + ' · ' + (k === 'agenda' ? 'calendario' : 'clasificación'), c[k].verificadoEn, Math.max(1, c[k].total),
      c[k].estado === 'conservado' ? 'Copia anterior pendiente de volver a comprobar.' : undefined))) },
]
writeFileSync(resolve(root, 'service-manifest.json'), JSON.stringify({ schema: 1, services }))
console.log(`Estado: ${services.length} servicios; ${services.reduce((n, s) => n + s.items.length, 0)} fuentes/copias comprobables`)
