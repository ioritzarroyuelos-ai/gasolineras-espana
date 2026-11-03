// Respaldo de red para dos fuentes públicas que no responden desde GitHub.
// Lista cerrada: nunca acepta una URL del cliente ni envía credenciales.
export const GUARDIAS_PUBLIC_SOURCES: Readonly<Record<string, string>> = {
  asturias: 'https://www.farmasturias.org/GESCOF/cms/Guardias/FarmaciaBuscar.asp?IdMenu=355',
  ceuta: 'https://ipsi.ceuta.es:8443/sanidad/farmacia/controlfarmacia?cmd=guardias-nuevo',
}
export async function publicGuardiasSource(territorio: string, request = fetch) {
  const url = Object.hasOwn(GUARDIAS_PUBLIC_SOURCES, territorio) ? GUARDIAS_PUBLIC_SOURCES[territorio] : null
  if (!url) return null
  const response = await request(url, { signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'EspanaUtil/1.8 (+https://webapp-3ft.pages.dev/acerca)' }, redirect: 'error' })
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
  return { source: url, fetchedAt: new Date().toISOString(), html: new TextDecoder(territorio === 'ceuta' ? 'windows-1252' : 'utf-8').decode(bytes) }
}
