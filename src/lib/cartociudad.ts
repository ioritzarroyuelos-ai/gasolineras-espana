import { coordenadasServicio } from '../../scripts/lib/servicios.mjs'

const BASE = 'https://www.cartociudad.es/geocoder/api/geocoder/'
const TIPOS = new Set(['portal', 'callejero', 'Codpost', 'toponimo', 'ngbe'])
export const CARTOCIUDAD_ATRIBUCION = 'CartoCiudad · CC BY 4.0 SCNE'
export const CARTOCIUDAD_URL = 'https://www.scne.es/productos.html#CartoCiudad'
export const CARTOCIUDAD_MAX_BODY = 1024
export const CARTOCIUDAD_MAX_RESPONSE = 512 * 1024
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
type IO = { fetch?: Fetcher; timeoutMs?: number }
type Candidate = { id: string; type: string; address?: string | null; lat: number; lng: number; muni?: string | null; muniCode?: string | null; province?: string | null; postalCode?: string | null; countryCode: string; noNumber?: boolean | null }
export interface DireccionServicio { id: string; tipo: string; nombre: string; lat: number; lng: number; precision: 'portal' | 'zona'; municipio?: string; provincia?: string; ine?: string; cp?: string }
export class CartociudadError extends Error {}
export class CartociudadBodyError extends Error {}
const fail = (): never => { throw new CartociudadError('No se pudo comprobar la dirección en CartoCiudad') }
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const cleanText = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v)

// La dirección sólo se procesa para esta petición: no se registra ni se
// incorpora a favoritos, historial, parámetros de URL locales o cachés.
export async function leeBusquedaDireccion(request: Request): Promise<string> {
  const length = request.headers.get('Content-Length')
  if (length && (!/^\d+$/.test(length) || Number(length) > CARTOCIUDAD_MAX_BODY)) throw new CartociudadBodyError()
  let raw: unknown
  try { raw = JSON.parse(await readText(request.body, CARTOCIUDAD_MAX_BODY)) } catch { throw new CartociudadBodyError() }
  if (!object(raw) || Object.keys(raw).length !== 1 || !cleanText(raw.q, 150)) throw new CartociudadBodyError()
  const q = raw.q.normalize('NFC').replace(/\s+/g, ' ').trim()
  if (q.length < 3) throw new CartociudadBodyError()
  return q
}
async function readText(body: ReadableStream<Uint8Array> | null, max: number): Promise<string> {
  if (!body) return fail()
  const reader = body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0, text = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) { await reader.cancel(); return fail() }
      text += decoder.decode(value, { stream: true })
    }
    return text + decoder.decode()
  } finally { reader.releaseLock() }
}
async function consulta(method: 'candidates' | 'find', params: Record<string, string>, io: IO): Promise<unknown> {
  const url = new URL(method, BASE)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new CartociudadError('CartoCiudad no respondió a tiempo')) }, io.timeoutMs ?? 5000) })
  try {
    return await Promise.race([timeout, (async () => {
      const response = await (io.fetch || fetch)(url, { signal: controller.signal, redirect: 'manual', headers: { Accept: 'application/json' } })
      const length = response.headers.get('Content-Length')
      if (!response.ok || (length !== null && (!/^\d+$/.test(length) || Number(length) > CARTOCIUDAD_MAX_RESPONSE))) { await response.body?.cancel(); return fail() }
      return JSON.parse(await readText(response.body, CARTOCIUDAD_MAX_RESPONSE)) as unknown
    })()])
  } finally { if (timer !== undefined) clearTimeout(timer) }
}
function candidato(value: unknown): Candidate {
  if (!object(value) || !cleanText(value.id, 100) || !/^[a-zA-Z0-9_.-]+$/.test(value.id) || !cleanText(value.type, 40) || value.countryCode !== '011' || !Number.isFinite(value.lat) || !Number.isFinite(value.lng)) return fail()
  for (const key of ['address', 'muni', 'muniCode', 'province', 'postalCode']) if (value[key] !== undefined && value[key] !== null && !cleanText(value[key], 200)) return fail()
  if (value.noNumber !== undefined && value.noNumber !== null && typeof value.noNumber !== 'boolean') return fail()
  return value as Candidate
}
export async function buscaDireccionServicio(q: string, io: IO = {}): Promise<DireccionServicio[]> {
  const values = await consulta('candidates', { q, limit: '5' }, io)
  if (!Array.isArray(values) || values.length > 5) return fail()
  const candidates = values.map(candidato).filter(c => TIPOS.has(c.type))
  const results: DireccionServicio[] = []
  // Como máximo cinco candidatos. Las consultas sucesivas evitan lanzar una
  // ráfaga al servicio oficial al resolver calles o códigos postales.
  for (const original of candidates) {
    let c = original
    if (['Codpost', 'callejero'].includes(c.type)) {
      c = candidato(await consulta('find', { id: c.id, type: c.type }, io))
      if (c.id !== original.id || c.type !== original.type) return fail()
    }
    if (!coordenadasServicio(c.lat, c.lng)) return fail()
    const cp = /^\d{5}$/.test(c.postalCode || '') ? c.postalCode! : /^\d{5}$/.test(original.postalCode || '') ? original.postalCode! : undefined
    const nombre = c.type === 'Codpost' && cp ? 'Código postal ' + cp : original.address || c.address
    if (!nombre?.trim()) return fail()
    const result: DireccionServicio = { id: c.id, tipo: c.type, nombre, lat: c.lat, lng: c.lng, precision: c.type === 'portal' && c.noNumber !== true ? 'portal' : 'zona' }
    if (c.muni?.trim()) result.municipio = c.muni
    if (c.province?.trim()) result.provincia = c.province
    if (/^\d{5}$/.test(c.muniCode || '')) result.ine = c.muniCode!
    if (cp) result.cp = cp
    if (!results.some(p => p.id === result.id && p.tipo === result.tipo)) results.push(result)
  }
  return results
}
