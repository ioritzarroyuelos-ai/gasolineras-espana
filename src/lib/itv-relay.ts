// Destinos cerrados del respaldo público. No recibe URLs ni credenciales del cliente.
// Asturias usa el destino oficial canónico para no necesitar seguir redirecciones.
export const ITV_PUBLIC_SOURCES: Readonly<Record<string, string>> = Object.freeze({
  asturias: 'https://miprincipado.asturias.es/bopa/2025/12/26/2025-10695.pdf',
  cantabria: 'https://boc.cantabria.es/boces/verAnuncioAction.do?idAnuBlob=428844',
  'comunitat-valenciana': 'https://sitval.com/assets/pdf/tarifas.pdf',
  itvasa: 'https://www.itvasa.es/citas/',
})
export const ITV_MAX_BYTES = 15 * 1024 * 1024
export const ITV_TIMEOUT_MS = 30_000

// Estos códigos no contienen el mensaje del servidor remoto ni datos de la petición.
export class ItvSourceError extends Error {
  readonly code: string
  constructor(code: string) { super(code); this.code = code }
}
interface PublicItvResponse { source: string; fetchedAt: string; bytes: Uint8Array<ArrayBuffer> }

export async function publicItvSource(id: string, request: typeof fetch = fetch): Promise<PublicItvResponse | null> {
  if (!Object.hasOwn(ITV_PUBLIC_SOURCES, id)) return null
  const source = ITV_PUBLIC_SOURCES[id]
  const controller = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { controller.abort(); reject(new ItvSourceError('SOURCE_TIMEOUT')) }, ITV_TIMEOUT_MS)
  })
  try {
    const download = async (): Promise<PublicItvResponse> => {
      const response = await request(source, {
        method: 'GET', redirect: 'manual', credentials: 'omit', cache: 'no-store', signal: controller.signal,
        headers: { 'User-Agent': 'EspanaUtil/1.8 (+https://webapp-3ft.pages.dev/acerca)', Accept: id === 'itvasa' ? 'text/html' : 'application/pdf' },
      })
      reader = response.body?.getReader()
      if (response.status !== 200) throw new ItvSourceError('SOURCE_HTTP_' + response.status)
      if (!reader) throw new ItvSourceError('SOURCE_EMPTY')
      const declared = Number(response.headers.get('Content-Length'))
      if (Number.isFinite(declared) && declared > ITV_MAX_BYTES) throw new ItvSourceError('SOURCE_TOO_LARGE')
      const chunks: Uint8Array[] = []
      let length = 0
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        length += value.byteLength
        if (length > ITV_MAX_BYTES) throw new ItvSourceError('SOURCE_TOO_LARGE')
        chunks.push(value)
      }
      if (!length) throw new ItvSourceError('SOURCE_EMPTY')
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
      if (id !== 'itvasa' && new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new ItvSourceError('SOURCE_FORMAT')
      return { source, bytes, fetchedAt: new Date().toISOString() }
    }
    return await Promise.race([download(), deadline])
  } catch (error) {
    if (error instanceof ItvSourceError) throw error
    throw new ItvSourceError(controller.signal.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_NETWORK')
  } finally {
    clearTimeout(timer)
    controller.abort()
    // Incluye cancelación por tamaño/estado y por un cuerpo que deja de responder.
    if (reader) await reader.cancel().catch(() => {})
  }
}
