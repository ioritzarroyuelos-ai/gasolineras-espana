// Respaldo de red para fuentes públicas que no siempre responden desde GitHub.
// Lista cerrada: nunca acepta una URL del cliente ni envía credenciales.
import { ALMERIA_SOURCE, consultaAlmeria } from '../../scripts/lib/guardias-almeria.mjs'
export const GUARDIAS_PUBLIC_SOURCES: Readonly<Record<string, string>> = {
  asturias: 'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355',
  ceuta: 'https://ipsi.ceuta.es:8443/sanidad/farmacia/controlfarmacia?cmd=guardias-nuevo',
  almeria: ALMERIA_SOURCE,
  avila: 'https://www.cofavila.com/index.php/servicio-de-guardia-nocturno/',
}
interface PublicGuardiasResponse { source: string; fetchedAt: string; html?: string; fecha?: string; data?: unknown }
async function leerFuente(url: string, request: typeof fetch, encoding: string, init: RequestInit = {}) {
  const response = await request(url, { ...init, signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'EspanaUtil/1.8 (+https://webapp-3ft.pages.dev/acerca)' }, redirect: 'manual' })
  if (!response.ok || !response.body) throw new Error('Fuente no disponible: HTTP ' + response.status)
  const reader = response.body.getReader(), chunks: Uint8Array[] = []
  let length = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    length += value.byteLength
    if (length > 1024 * 1024) { await reader.cancel(); throw new Error('Respuesta demasiado grande') }
    chunks.push(value)
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
  return new TextDecoder(encoding).decode(bytes)
}
export async function publicGuardiasSource(territorio: string, request = fetch, now = new Date()): Promise<PublicGuardiasResponse | null> {
  const url = Object.hasOwn(GUARDIAS_PUBLIC_SOURCES, territorio) ? GUARDIAS_PUBLIC_SOURCES[territorio] : null
  if (!url) return null
  if (territorio === 'almeria') {
    const fecha = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
    const data = await consultaAlmeria(fecha, {
      html: source => leerFuente(source, request, 'utf-8'),
      json: async (source, init) => JSON.parse(await leerFuente(source, request, 'utf-8', init)),
    })
    return { source: url, fetchedAt: new Date().toISOString(), fecha, data }
  }
  const html = await leerFuente(url, request, territorio === 'ceuta' ? 'windows-1252' : 'utf-8')
  return { source: url, fetchedAt: new Date().toISOString(), html }
}
