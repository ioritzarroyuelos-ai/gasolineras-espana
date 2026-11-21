import { PROVINCIAS } from './provincias'
import { slugifyMunicipio } from './municipios'
import { enlaceOficialItv, normalizaNombreMunicipio, telefonosItv, type ItvFile } from './itv'
import { tarifaPorProvincia, tarifaVigente } from './itv-tarifas'
import { comprobacionItvReciente, tarifaComprobadaHoy, type EstadoTarifasItv } from './itv-tarifas-estado'
import { coordenadasServicio, servicioTileBbox } from '../../scripts/lib/servicios.mjs'
import { zonaValida } from './servicios'

export const SERVICIO_ITV_ID = /^itv-(0[1-9]|[1-4]\d|5[0-2])-(?!0000)\d{4}$/
const provinces = new Map(PROVINCIAS.map(p => [p.id, p]))
const sourceHosts = new Set(['www.dgt.es', 'industria.gob.es', 'dadesobertes.gva.es', 'www.serviciositv.es'])
const bookingHosts = new Set(['www.applusiteuve.com', 'www.itevelesa.com', 'www.itvcita.com', 'www.itvasa.es', 'itasua.com', 'citaitvsitval.com', 'www.serviciositv.es'])
const sourceNames: Record<string, string> = { dgt: 'DGT', industria: 'Ministerio de Industria y Turismo', gva: 'Generalitat Valenciana', 'operador-sgs': 'SGS ITV' }
const sourceHost: Record<string, string> = { dgt: 'www.dgt.es', industria: 'industria.gob.es', gva: 'dadesobertes.gva.es', 'operador-sgs': 'www.serviciositv.es' }
const text = (value: unknown, max = 250) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
function safeUrl(value: unknown, hosts: Set<string>): string | undefined {
  if (typeof value !== 'string' || value.length > 2000) return
  const url = enlaceOficialItv(value)
  return url && hosts.has(new URL(url).hostname) ? url : undefined
}
function date(value: unknown, now: number, publication = false): string | undefined {
  if (typeof value !== 'string' || !(publication ? /^\d{4}-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?)?$/ : /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/).test(value)) return
  const full = value.length === 7 ? value + '-01T00:00:00Z' : value.length === 10 ? value + 'T00:00:00Z' : value
  const time = Date.parse(full)
  if (!Number.isFinite(time) || time > now + 300000 || !new Date(time).toISOString().startsWith(value.slice(0, 10))) return
  return value
}
function canonicalId(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return
  const e = value as Record<string, unknown>
  if (typeof e.prov !== 'string' || !provinces.has(e.prov) || typeof e.codigo !== 'string' || !/^\d{4}$/.test(e.codigo)) return
  // El código oficial y la provincia identifican la estación. Un cambio en el
  // municipio o en la fuente no cambia el favorito. Nunca usamos un OBJECTID.
  const id = 'itv-' + e.prov + '-' + e.codigo
  return SERVICIO_ITV_ID.test(id) ? id : undefined
}

export interface ServicioItv {
  id: string; proveedor: 'itv-oficial'; categorias: ['itv']; nombre: string; lat: number; lon: number;
  direccion: string; municipio: string; cp?: string; telefono?: string; fuenteUrl: string; fuenteNombre: string;
  directorioUrl: string; ubicacion: 'punto'; gratis: null; accesible: 'desconocido'; acceso: 'desconocido';
  verificadoEn: string; publicadoEn?: string; desactualizado: boolean;
  coordenadas: { fuente: string; fuenteUrl: string; verificadoEn: string; desactualizadas: boolean };
  cita?: { url: string; verificadoEn: string; desactualizada: boolean };
  tarifas?: { url: string; verificadoEn?: string; desactualizada: boolean };
}

export function consultaItvServicios(url: URL): string | null {
  const keys = [...url.searchParams.keys()]
  const zona = url.searchParams.get('zona') || ''
  return keys.length === 1 && keys[0] === 'zona' && zonaValida(zona) ? zona : null
}

export function normalizaItvServicios(file: ItvFile | null, tarifas: EstadoTarifasItv | null = null, now = Date.now()) {
  if (file?.v !== 2 || !Array.isArray(file.estaciones) || !file.estaciones.length || file.estaciones.length > 5000 || file.total !== file.estaciones.length || !date(file.generatedAt, now)) throw new Error('Directorio ITV no comprobable')
  const identities = new Map<string, number>()
  if (!tarifas || tarifas.v !== 1 || typeof tarifas.checkedAt !== 'string' || !Array.isArray(tarifas.fuentes) || !Array.isArray(tarifas.tarifas) ||
    !tarifas.fuentes.every(f => f && typeof f.id === 'string' && typeof f.checkedAt === 'string' && typeof f.estado === 'string') ||
    !tarifas.tarifas.every(t => t && typeof t.slug === 'string' && typeof t.estado === 'string' && Array.isArray(t.fuentes) && t.fuentes.every(f => typeof f === 'string'))) tarifas = null
  for (const e of file.estaciones) { const id = canonicalId(e); if (id) identities.set(id, (identities.get(id) || 0) + 1) }
  const items: ServicioItv[] = []
  for (const e of file.estaciones) {
    if (!e || typeof e !== 'object') continue
    const id = canonicalId(e), sourceUrl = safeUrl(e.fuenteUrl, sourceHosts), verified = date(e.verificadoEn, now)
    if (!id || identities.get(id) !== 1 || !sourceUrl || !verified || typeof e.fuente !== 'string' || new URL(sourceUrl).hostname !== sourceHost[e.fuente] || !text(e.mun) || !text(e.dir) || typeof e.lat !== 'number' || typeof e.lng !== 'number' || !coordenadasServicio(e.lat, e.lng)) continue
    // Sólo se admiten coordenadas de DGT o de una ficha de estación del operador.
    // Industria/GVA sin esta procedencia no se sustituyen por centros de municipio.
    const hasContact = e.contactoFuente !== undefined || e.contactoFuenteUrl !== undefined || e.contactoVerificadoEn !== undefined
    const proofUrl = hasContact ? safeUrl(e.contactoFuenteUrl, sourceHosts) : e.fuente === 'dgt' ? sourceUrl : undefined
    const proofDate = hasContact ? date(e.contactoVerificadoEn, now) : e.fuente === 'dgt' ? verified : undefined
    const host = proofUrl ? new URL(proofUrl).hostname : ''
    const proofSource = host === 'www.dgt.es' && (e.contactoFuente === 'dgt' || e.fuente === 'dgt') ? 'DGT' :
      host === 'www.serviciositv.es' && (e.contactoFuente === 'SGS ITV' || e.fuente === 'operador-sgs') ? 'SGS ITV' : ''
    if (!proofSource || !proofUrl || !proofDate) continue
    const province = provinces.get(e.prov)!, municipality = slugifyMunicipio(e.mun)
    if (!municipality) continue
    const coordsOld = !comprobacionItvReciente(proofDate, now)
    const item: ServicioItv = {
      id, proveedor: 'itv-oficial', categorias: ['itv'], nombre: text(text(e.nombre) || 'ITV ' + normalizaNombreMunicipio(e.mun) + (text(e.op) ? ' · ' + text(e.op) : ''), 180),
      lat: e.lat!, lon: e.lng!, direccion: text(e.dir, 500), municipio: normalizaNombreMunicipio(text(e.mun, 160)),
      fuenteUrl: sourceUrl, fuenteNombre: sourceNames[e.fuente], directorioUrl: '/itv/' + province.slug + '/' + municipality,
      ubicacion: 'punto', gratis: null, accesible: 'desconocido', acceso: 'desconocido', verificadoEn: verified,
      desactualizado: !comprobacionItvReciente(verified, now) || coordsOld,
      coordenadas: { fuente: proofSource, fuenteUrl: proofUrl, verificadoEn: proofDate, desactualizadas: coordsOld },
    }
    if (typeof e.cp === 'string' && /^\d{5}$/.test(e.cp)) item.cp = e.cp
    const phones = telefonosItv(typeof e.tel === 'string' ? e.tel : '').map(p => p.texto).join(' / ')
    if (phones) item.telefono = phones
    const published = date(e.publicadoEn, now, true)
    if (published) item.publicadoEn = published
    const citaUrl = safeUrl(e.citaUrl, bookingHosts), citaDate = date(e.citaVerificadoEn, now)
    if (citaUrl && citaDate) item.cita = { url: citaUrl, verificadoEn: citaDate, desactualizada: !comprobacionItvReciente(citaDate, now) }
    const tariff = tarifaPorProvincia(province.slug), tariffUrl = enlaceOficialItv(tariff?.fuenteUrl)
    if (tariff && tariffUrl) {
      const checked = date(tarifas?.fuentes?.find(f => f.id === tariff.slug)?.checkedAt, now) || date(tariff.revisada, now)
      item.tarifas = { url: tariffUrl, ...(checked ? { verificadoEn: checked } : {}),
        desactualizada: !tarifaVigente(tariff, now) || !tarifaComprobadaHoy(tariff.slug, tarifas, now) }
    }
    items.push(item)
  }
  items.sort((a, b) => a.id.localeCompare(b.id))
  const warnings = [
    'El mapa sólo incluye estaciones con coordenadas publicadas y procedencia comprobable. El directorio completo incluye también las que no podemos situar.',
    'Los enlaces de cita y tarifas llevan a las fuentes oficiales. No se comprueban plazas libres ni apertura en directo.',
  ]
  const desactualizado = !comprobacionItvReciente(file.generatedAt, now) || items.some(item => item.desactualizado) ||
    !Array.isArray(file.fuentesEstado) || !file.fuentesEstado.length || file.fuentesEstado.some(f => !f || f.estado !== 'actualizada' || typeof f.consultado !== 'string' || !comprobacionItvReciente(f.consultado, now))
  if (desactualizado) warnings.push('Parte de los datos conserva comprobaciones anteriores. Revisa la fecha de cada dato y confirma con la estación.')
  return { schema: 1, proveedor: 'itv-oficial' as const, generadoEn: file.generatedAt!, totalDirectorio: file.estaciones.length, totalConCoordenadas: items.length, desactualizado, warnings, items }
}

type Assets = { fetch: (request: Request) => Promise<Response> }
async function assetJson(assets: Assets | undefined, name: string, max: number): Promise<unknown> {
  if (!assets) throw new Error('Datos ITV no disponibles')
  const response = await assets.fetch(new Request('https://webapp-3ft.pages.dev/data/' + name, { signal: AbortSignal.timeout(10000) }))
  if (!response.ok || !response.body) throw new Error('Datos ITV no disponibles')
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.byteLength
      if (size > max) { await reader.cancel(); throw new Error('Directorio ITV demasiado grande') }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
}
export async function cargaItvServicios(assets: Assets | undefined, now = Date.now()) {
  const [directory, rates] = await Promise.allSettled([assetJson(assets, 'itv.json', 3 * 1024 * 1024), assetJson(assets, 'itv-tarifas-estado.json', 128 * 1024)])
  if (directory.status !== 'fulfilled') throw new Error('Directorio ITV no disponible')
  return normalizaItvServicios(directory.value as ItvFile, rates.status === 'fulfilled' ? rates.value as EstadoTarifasItv : null, now)
}
export function itvEnZona(items: ServicioItv[], zona: string): ServicioItv[] {
  const [west, south, east, north] = servicioTileBbox(zona)
  return items.filter(item => item.lat >= south && item.lat < north && item.lon >= west && item.lon < east)
}
