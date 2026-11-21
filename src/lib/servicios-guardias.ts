import { servicioContienePunto, servicioTileBbox } from '../../scripts/lib/servicios.mjs'
import { fechaHoraLocal } from '../../scripts/lib/fechas.mjs'
import { zonaValida } from './servicios'
import { PROVINCIAS, type ProvinciaEntry } from './provincias'
import { slugifyMunicipio } from './municipios'
import { fechaValida } from './guardias-horarios'
import { parseGuardias, guardiasForProvincia, guardiasFileForProvincia, estadoGuardia, textoHorarioGuardia, tipoAtencionGuardia, frescuraGuardia, zonaGuardia, fuenteGuardia, GUARDIA_STALE_HORAS, GUARDIAS_TERRITORIO_BY_PROVINCIA, type GuardiasFile } from './guardias'

type Assets = { fetch: (request: Request) => Promise<Response> }
type Turno = 'todas' | 'ahora' | '24h'
export const GUARDIAS_MAPA_MAX_BYTES = 256 * 1024
const PAGINA = 200

// Envolventes conservadoras de las 52 provincias, IGN/CNIG, CC-BY-4.0.
// Descarga comprobada 21-11-2026: https://api-features.ign.es/collections/administrativeunit/items
// nationallevel=.../AdministrativeHierarchyLevel/3rdOrder, limit=100. Se excluye
// «Territorios no asociados» (54). Sólo elige ficheros posibles; nunca asigna
// una farmacia a un municipio ni sustituye su ubicación por un centroide.
const PROVINCIA_BBOX: Record<string, number[]> = {
  "01": [-3.286767,42.47236,-2.232687,43.217188],
  "02": [-2.882889,38.021837,-0.915793,39.423077],
  "03": [-1.094162,37.843778,0.234068,38.887392],
  "04": [-3.140188,35.937645,-1.630123,37.916248],
  "05": [-5.737562,40.081925,-4.160234,41.16425],
  "06": [-7.335669,37.941026,-4.647577,39.451789],
  "07": [1.15724,38.640387,4.327785,40.094575],
  "08": [1.360396,41.192745,2.777585,42.322961],
  "09": [-4.335328,41.450784,-2.517396,43.198748],
  "10": [-7.541332,39.031485,-4.95295,40.486652],
  "11": [-6.473738,35.999968,-5.086793,37.052446],
  "12": [-0.846297,39.714697,0.690314,40.788632],
  "13": [-5.046949,38.342452,-2.63789,39.576762],
  "14": [-5.585924,37.18407,-4.000939,38.729088],
  "15": [-9.301516,42.459033,-7.661721,43.79238],
  "16": [-3.170235,39.22648,-1.142546,40.658693],
  "17": [1.724297,41.650768,3.332554,42.495575],
  "18": [-4.328133,36.693519,-2.207789,38.084094],
  "19": [-3.541099,40.152455,-1.535637,41.327633],
  "20": [-2.60272,42.895245,-1.729343,43.395911],
  "21": [-7.523048,36.789718,-6.121558,38.20821],
  "22": [-0.934169,41.347805,0.771307,42.924387],
  "23": [-4.287641,37.378278,-2.434951,38.532535],
  "24": [-7.077069,42.029226,-4.733881,43.238205],
  "25": [0.320036,41.274196,1.855058,42.86145],
  "26": [-3.134272,41.919033,-1.678701,42.644265],
  "27": [-7.999733,42.3257,-6.814053,43.761645],
  "28": [-4.579077,39.884719,-3.052983,41.165845],
  "29": [-5.611777,36.31028,-3.765967,37.2822],
  "30": [-2.344185,37.373752,-0.647982,38.755085],
  "31": [-2.500083,41.909893,-0.724069,43.314844],
  "32": [-8.366345,41.807233,-6.733953,42.5786],
  "33": [-7.182489,42.882542,-4.510453,43.666533],
  "34": [-5.031895,41.758166,-3.889622,43.060989],
  "35": [-15.83465,27.734503,-13.334958,29.416452],
  "36": [-8.949453,41.868848,-7.861428,42.860158],
  "37": [-6.931706,40.238923,-5.089841,41.294216],
  "38": [-18.161181,27.637723,-16.118571,28.857581],
  "39": [-4.851779,42.758049,-3.149634,43.513693],
  "40": [-4.724653,40.632984,-3.206929,41.586083],
  "41": [-6.538515,36.842191,-4.65335,38.197418],
  "42": [-3.550439,41.056507,-1.775371,42.146707],
  "43": [0.15907,40.522968,1.653152,41.582607],
  "44": [-1.805728,39.846778,0.293501,41.35439],
  "45": [-5.406184,39.258416,-2.908233,40.318342],
  "46": [-1.528812,38.686553,-0.024685,40.211684],
  "47": [-5.520891,41.094015,-3.980442,42.311843],
  "48": [-3.450332,42.981652,-2.412603,43.457247],
  "49": [-7.034044,41.117172,-5.228873,42.254193],
  "50": [-2.173672,40.936215,0.385695,42.744053],
  "51": [-5.382061,35.870738,-5.278291,35.917984],
  "52": [-2.970296,35.265488,-2.923187,35.320301],
}

export function provinciasGuardiasEnZona(zona: string): ProvinciaEntry[] {
  if (!zonaValida(zona)) return []
  const [west, south, east, north] = servicioTileBbox(zona)
  return PROVINCIAS.filter(p => {
    const b = PROVINCIA_BBOX[p.id]
    return b && b[0] <= east && b[2] >= west && b[1] <= north && b[3] >= south
  })
}
export function consultaGuardiasServicios(url: URL) {
  for (const key of url.searchParams.keys()) if (!['zona', 'turno', 'pagina'].includes(key) || url.searchParams.getAll(key).length !== 1) return null
  const zona = url.searchParams.get('zona') || '', turno = url.searchParams.get('turno') || 'todas', pagina = url.searchParams.get('pagina') || '0'
  if (!zonaValida(zona) || !['todas', 'ahora', '24h'].includes(turno) || !/^(0|[1-9]\d{0,3})$/.test(pagina)) return null
  return { zona, turno: turno as Turno, pagina: Number(pagina) }
}

export interface GuardiaMapa {
  id: string; proveedor: 'guardias-oficiales'; categorias: ['farmacias-guardia']; guardable: false
  nombre: string; direccion: string; municipio: string; lat: number; lon: number; telefono: string
  horario: string; fechaTurno: string; consultado: string; fuenteUrl: string | null; directorioUrl: string; estadoHasta: string
  estado: 'activa' | 'localizada' | 'por_confirmar' | 'fuera_de_horario'; todoElDia: boolean
}
export interface FuenteGuardiasMapa {
  provincia: string; nombre: string; territorio: string | null; consultado: string | null; fechaReferencia: string | null
  fuenteUrl: string | null; directorioUrl: string; cobertura: string | null; puntosEnZona: number
  estado: 'disponible' | 'sin_coordenadas' | 'sin_actualizar' | 'sin_datos' | 'error'
  warnings: string[]; avisosMunicipales: Record<string, string[]>
}
type CacheEntry = { checkedAt: number; expires: number; promise: Promise<GuardiasFile> }
const cache = new WeakMap<Assets, Map<string, CacheEntry>>()
function fail(): never { throw new Error('No se puede comprobar esta fuente de guardias') }
function texto(value: unknown, max = 16000): value is string { return typeof value === 'string' && value.length <= max }
function listaTextos(value: unknown): value is string[] { return Array.isArray(value) && value.length <= 500 && value.every(v => texto(v)) }
function validaFile(raw: unknown, territorio: string): GuardiasFile {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
  const f = raw as GuardiasFile
  if (f.territorio !== territorio || !texto(f.source, 200) || !texto(f.ts, 80) || !Number.isFinite(Date.parse(f.ts))
    || !Array.isArray(f.guardias) || f.guardias.length > 3000 || f.count !== f.guardias.length) return fail()
  if (f.fecha !== undefined && (!texto(f.fecha, 10) || !fechaValida(f.fecha))) return fail()
  for (const value of [f.guardiasVerificadas, f.coordenadasOficiales, f.horariosCompletos]) if (value !== undefined && typeof value !== 'boolean') return fail()
  for (const value of [f.sourceUrl, f.cobertura]) if (value !== undefined && !texto(value)) return fail()
  if (f.incidencias !== undefined && !listaTextos(f.incidencias)) return fail()
  if (f.avisosMunicipales !== undefined && (!f.avisosMunicipales || typeof f.avisosMunicipales !== 'object' || Array.isArray(f.avisosMunicipales)
    || Object.entries(f.avisosMunicipales).some(([key, value]) => !texto(key, 300) || !listaTextos(value)))) return fail()
  if (f.guardias.some(row => !Array.isArray(row) || row.length < 8 || row.length > 12 || row.some(v => v !== null && typeof v !== 'number' && !texto(v)))) return fail()
  return f
}
async function leeFile(assets: Assets, filename: string, territorio: string): Promise<GuardiasFile> {
  const res = await assets.fetch(new Request('https://webapp-3ft.pages.dev/data/' + filename, { signal: AbortSignal.timeout(10000) }))
  if (!res.ok || !res.body) return fail()
  const length = res.headers.get('content-length')
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > GUARDIAS_MAPA_MAX_BYTES)) { await res.body.cancel(); return fail() }
  const reader = res.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > GUARDIAS_MAPA_MAX_BYTES) { await reader.cancel(); return fail() }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  try { return validaFile(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), territorio) } catch { return fail() }
}
function cargaFile(assets: Assets | undefined, filename: string, territorio: string, now: number): Promise<GuardiasFile> {
  if (!assets) return Promise.reject(new Error('Fuente no disponible'))
  let files = cache.get(assets)
  if (!files) { files = new Map(); cache.set(assets, files) }
  const old = files.get(filename)
  if (old && old.checkedAt <= now && old.expires > now) return old.promise
  const entry: CacheEntry = { checkedAt: now, expires: now + 30000, promise: leeFile(assets, filename, territorio) }
  entry.promise = entry.promise.catch(error => { if (files.get(filename) === entry) files.delete(filename); throw error })
  files.set(filename, entry)
  return entry.promise
}

export async function cargaGuardiasServicios(assets: Assets | undefined, consulta: NonNullable<ReturnType<typeof consultaGuardiasServicios>>, now = Date.now()) {
  const ahora = new Date(now), provincias = provinciasGuardiasEnZona(consulta.zona)
  // El lector de horarios acepta límites HH:mm: ningún estado calculado puede
  // sobrevivir al próximo minuto UTC. Caduca antes si lo hace el fichero (su
  // timestamp sí puede contener segundos). No se duplica el parser en el mapa.
  let revalidarAntes = (Math.floor(now / 60000) + 1) * 60000
  const filenames = [...new Set(provincias.map(p => guardiasFileForProvincia(p.slug)).filter((v): v is string => !!v))]
  // Las 52 envolventes verificadas intersectan un máximo de 5 ficheros por zona.
  if (filenames.length > 5) return fail()
  const results = await Promise.all(filenames.map(async filename => {
    try { return { filename, file: await cargaFile(assets, filename, filename.slice(9, -5), now) } } catch { return { filename, file: null } }
  }))
  const files = new Map(results.map(r => [r.filename, r.file]))
  const fuentes: FuenteGuardiasMapa[] = [], candidatos = new Map<string, Omit<GuardiaMapa, 'id'>>()
  for (const provincia of provincias) {
    const filename = guardiasFileForProvincia(provincia.slug), file = filename ? files.get(filename) : null
    const territorio = GUARDIAS_TERRITORIO_BY_PROVINCIA[provincia.slug] || null, tz = zonaGuardia(provincia.slug)
    const fuente: FuenteGuardiasMapa = {
      provincia: provincia.slug, nombre: provincia.name, territorio, consultado: file?.ts || null, fechaReferencia: file?.fecha || null,
      fuenteUrl: fuenteGuardia(provincia.slug, file || undefined, ahora), directorioUrl: '/farmacias/' + provincia.slug,
      cobertura: file?.cobertura || null, puntosEnZona: 0, estado: filename ? 'error' : 'sin_datos', warnings: [], avisosMunicipales: file?.avisosMunicipales || {},
    }
    fuentes.push(fuente)
    if (!file) { fuente.warnings.push(filename ? 'No se ha podido comprobar esta fuente. Consulta el colegio farmacéutico.' : 'Esta provincia todavía no dispone de guardias automáticas verificadas. Consulta el colegio farmacéutico.'); continue }
    fuente.warnings.push(...(file.incidencias || []))
    if (territorio === 'almeria' && file.guardias!.some(row => /por confirmar/i.test(String(row[7])) || /^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})\s*-\s*\1$/.test(String(row[6])))) fuente.warnings.push('Algunas guardias tienen horario por confirmar: llama antes de acudir. No se consideran abiertas ni de 24 horas.')
    const fresco = frescuraGuardia(file.ts, ahora, tz)
    if (!fresco.fiable) { fuente.estado = 'sin_actualizar'; fuente.warnings.push('Guardias pendientes de actualizar. La fecha de consulta y el día del turno son distintos datos; consulta la fuente antes de desplazarte.'); continue }
    const estadoHasta = Math.min((Math.floor(now / 60000) + 1) * 60000, Date.parse(file.ts!) + GUARDIA_STALE_HORAS * 3600000)
    revalidarAntes = Math.min(revalidarAntes, estadoHasta)
    // El lector existente es la única autoridad para fechas, turnos y confianza
    // de las coordenadas. Se recorta antes para no evaluar horarios de todo el país.
    const rawZona = file.guardias!.filter(row => typeof row[0] === 'number' && typeof row[1] === 'number' && Number.isFinite(row[0]) && Number.isFinite(row[1]) && servicioContienePunto(consulta.zona, row[0], row[1]))
    const rows = guardiasForProvincia(parseGuardias({ ...file, guardias: rawZona }, ahora), provincia.id, territorio || undefined)
    const coordenadasDeclaradas = file.coordenadasOficiales === true || (territorio === 'madrid' && file.source === 'cofm.es')
    fuente.estado = coordenadasDeclaradas ? 'disponible' : 'sin_coordenadas'
    if (!coordenadasDeclaradas) fuente.warnings.push('No hay coordenadas oficiales verificadas para dibujar estas guardias. Consulta el listado provincial.')
    if (file.fecha && file.fecha !== fechaHoraLocal(ahora, tz).slice(0, 10)) fuente.warnings.push('El calendario consultado corresponde al ' + file.fecha + '. Sólo se conservan los turnos que siguen vigentes según su horario.')
    for (const g of rows) {
      if (g.coordenadasFiables !== true || !g.direccion || !g.municipio) continue
      const tipo = tipoAtencionGuardia(g)
      if (tipo === 'apertura') continue
      const estado = estadoGuardia(g, file.ts, ahora, tz)
      const status: GuardiaMapa['estado'] = tipo === 'localizada' ? 'localizada' : !estado.conocida ? 'por_confirmar' : estado.abierta ? 'activa' : 'fuera_de_horario'
      fuente.puntosEnZona++
      if (consulta.turno !== 'todas' && (status !== 'activa' || consulta.turno === '24h' && !estado.todoElDia)) continue
      const fechaTurno = /^\d{4}-\d{2}-\d{2}/.exec(g.horario)?.[0] || g.fechaTurno || fresco.fecha
      // No se usa file.ts: volver a descargar el mismo turno no cambia su ID.
      const key = JSON.stringify([territorio, g.municipio, g.direccion, fechaTurno, g.horario, g.horarioDesc, g.lat, g.lng])
      candidatos.set(key, {
        proveedor: 'guardias-oficiales', categorias: ['farmacias-guardia'], guardable: false,
        nombre: g.direccion, direccion: g.direccion, municipio: g.municipio, lat: g.lat, lon: g.lng, telefono: g.telefono,
        horario: textoHorarioGuardia(g, file.ts, ahora, tz), fechaTurno, consultado: file.ts!, fuenteUrl: fuente.fuenteUrl,
        directorioUrl: fuente.directorioUrl + '/' + slugifyMunicipio(g.municipio), estado: status, todoElDia: status === 'activa' && estado.todoElDia, estadoHasta: new Date(estadoHasta).toISOString(),
      })
    }
  }
  const sorted = [...candidatos.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
  const offset = consulta.pagina * PAGINA
  const items: GuardiaMapa[] = await Promise.all(sorted.slice(offset, offset + PAGINA).map(async ([key, value]) => {
    const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))].map(n => n.toString(16).padStart(2, '0')).join('').slice(0, 32)
    return { id: 'guardia-' + JSON.parse(key)[0] + '-' + hash, ...value }
  }))
  const errors = fuentes.filter(f => f.estado === 'error').length
  return {
    proveedor: 'guardias-oficiales' as const, zona: consulta.zona, turno: consulta.turno, items, total: sorted.length,
    evaluadoEn: ahora.toISOString(), revalidarAntes: new Date(revalidarAntes).toISOString(),
    truncated: offset + items.length < sorted.length, siguientePagina: offset + items.length < sorted.length ? consulta.pagina + 1 : null,
    fuentes, completo: errors === 0, errorTotal: filenames.length > 0 && results.every(r => !r.file),
    warnings: [
      'El mapa sólo muestra guardias con ubicación oficial verificable. Puede haber otras en los listados provinciales.',
      'Una guardia localizada o con horario por confirmar no se considera abierta ahora. Llama antes de desplazarte.',
      ...(!sorted.length ? ['No se pueden confirmar guardias que coincidan con este filtro y esta zona. Consulta las fuentes indicadas.'] : []),
    ],
  }
}
