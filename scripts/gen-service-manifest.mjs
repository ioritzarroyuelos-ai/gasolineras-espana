// Resumen de las copias que se publican en ESTE artefacto. No modifica las fuentes.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { ELECCIONES } from './lib/politica-catalogo.mjs'
import { instanteLocal } from './lib/fechas.mjs'
const root = resolve(import.meta.dirname, '..', 'public', 'data')
function read(file) { try { return JSON.parse(readFileSync(resolve(root, file), 'utf8')) } catch { return null } }
const item = (name, updatedAt, count, issue) => ({ name, updatedAt: updatedAt || null, count: count || 0, ...(issue ? { issue } : {}) })
const gas = read('snapshot-meta.json')
const chargers = read('chargers.json')
const history = read('history/national.json')
const historyGaps = []
if (history?.to && Number.isFinite(Date.parse(history.to))) {
  for (let n=0; n<7; n++) {
    const dia = new Date(Date.parse(history.to+'T12:00:00Z')-n*86400000).toISOString().slice(0,10)
    if (dia >= history.from && Object.values(history.series || {}).some(serie=>!serie.some(p=>p[0]===dia))) historyGaps.push(dia)
  }
}
const itv = read('itv.json')
const tarifas = read('itv-tarifas-estado.json')
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
  const detalle = read('politica/' + (e.tipo === 'autonomica' ? 'autonomicas/' : '') + e.id + '.json')
  const avisos = [
    ...(p?.estado === 'no_disponible' ? ['Fuente no disponible'] : p?.estado === 'desactualizado' ? ['Fuente pendiente de actualizar'] : []),
    ...(Array.isArray(detalle?.avisosFuentes) ? detalle.avisosFuentes.filter(a => typeof a === 'string' && a.trim()) : []),
  ]
  // Una recopilación revisada hoy puede conservar un complemento pendiente.
  // Mostrar esa incidencia sin falsear la fecha de la comprobación principal.
  return item(e.nombre, p?.ultimaComprobacionOk, p ? 1 : 0, avisos.join('; ') || undefined)
})
const services = [
  { id: 'gasolineras', name: 'Gasolineras', maxAgeHours: 24, items: [item('Precios del Ministerio', gas?.fetchedAt, gas?.stationCount), item('Histórico de precios', history?.generated_at, history?.days, historyGaps.length ? 'Sin captura comprobada: '+historyGaps.join(', ') : undefined), item('Directorio de recarga eléctrica', chargers?.ts, chargers?.count)] },
  { id: 'farmacias', name: 'Farmacias', maxAgeHours: 30, items: guardias },
  { id: 'tiempo', name: 'Tiempo', maxAgeHours: 12, items: tiempo },
  { id: 'itv', name: 'ITV', maxAgeHours: 30, items: [...(itv?.fuentesEstado?.length
    ? itv.fuentesEstado.map(f => item(f.nombre, f.ultimoExito || f.consultado, f.total,
      f.estado === 'conservada' ? 'Fuente no disponible. Se conserva su copia anterior.' : undefined))
    : [item('Directorio de estaciones', itv?.generatedAt, itv?.total)]),
    ...(tarifas?.fuentes?.length ? tarifas.fuentes.map(f => item('Tarifas · '+f.id, f.checkedAt, 1,
      f.estado !== 'verificada' ? 'Documento de tarifas pendiente de confirmar.' : undefined))
      : [item('Comprobación de tarifas', null, 0)])] },
  { id: 'politica', name: 'Política', maxAgeHours: 30, items: [item('Índice de elecciones', politica?.generado, politica?.elecciones?.length), ...elecciones] },
  { id: 'deportes', name: 'Deportes', maxAgeHours: 24, items: (deportes?.competiciones || []).flatMap(c =>
    ['agenda', 'clasificacion'].filter(k => c[k]?.verificadoEn).map(k => item(c.nombre + (c.grupo ? ' · ' + c.grupo : '') + ' · ' + (k === 'agenda' ? 'calendario' : 'clasificación'), c[k].verificadoEn, Math.max(1, c[k].total),
      c[k].estado === 'conservado' ? 'Copia anterior pendiente de volver a comprobar.' : undefined))) },
]
const revision = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], {encoding:'utf8'}).trim()
writeFileSync(resolve(root, 'service-manifest.json'), JSON.stringify({ schema: 1, revision, services }))
console.log(`Estado: ${services.length} servicios; ${services.reduce((n, s) => n + s.items.length, 0)} fuentes/copias comprobables`)
