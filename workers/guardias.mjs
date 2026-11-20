// Fuentes públicas con incidencias de conectividad desde GitHub.
// Ubicación fijada en wrangler.guardias.jsonc; sin secretos ni URLs arbitrarias.
import { publicGuardiasSource, GUARDIAS_PUBLIC_SOURCES } from '../src/lib/guardias-relay.ts'
import { publicItvSource, ITV_PUBLIC_SOURCES, ItvSourceError } from '../src/lib/itv-relay.ts'

async function itvSource(request, url, ctx) {
  const id = url.pathname.slice('/itv/fuentes/'.length)
  if (request.method !== 'GET' || url.href.includes('?') || !url.pathname.startsWith('/itv/fuentes/') || !Object.hasOwn(ITV_PUBLIC_SOURCES, id)) {
    return new Response('No encontrado', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const cacheKey = new Request(url.origin + url.pathname)
  try {
    const cached = await caches.default.match(cacheKey)
    if (cached) return cached
  } catch { /* Un fallo de caché no impide leer la fuente oficial. */ }
  try {
    const data = await publicItvSource(id)
    const response = new Response(data.bytes, { headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': 'attachment; filename="itv-' + id + '.bin"',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff',
      'X-ITV-Source-Id': id, 'X-ITV-Source-Url': data.source, 'X-ITV-Fetched-At': data.fetchedAt,
    } })
    ctx.waitUntil(caches.default.put(cacheKey, response.clone()).catch(() => {
      console.warn(JSON.stringify({ source: id, code: 'ITV_CACHE_WRITE_FAILED' }))
    }))
    return response
  } catch (error) {
    const code = error instanceof ItvSourceError ? error.code : 'SOURCE_NETWORK'
    return Response.json({ error: 'Fuente no disponible', code }, {
      status: 502, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'X-Robots-Tag': 'noindex' },
    })
  }
}
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), territorio = url.pathname.slice(1)
    if (url.pathname.startsWith('/itv/')) return itvSource(request, url, ctx)
    if (request.method !== 'GET' || !Object.hasOwn(GUARDIAS_PUBLIC_SOURCES, territorio)) return new Response('No encontrado', { status: 404 })
    // Almería se consulta por día: una entrada de ayer no sirve tras medianoche.
    const dia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
    const cacheKey = new Request(url.origin + '/' + territorio + (territorio === 'almeria' ? '?fecha=' + dia : ''))
    const cached = await caches.default.match(cacheKey)
    if (cached) return cached
    try {
      const data = await publicGuardiasSource(territorio)
      const response = Response.json(data, { headers: { 'Cache-Control': 'public, max-age=300', 'X-Robots-Tag': 'noindex', 'X-Content-Type-Options': 'nosniff' } })
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()))
      return response
    } catch (error) {
      return Response.json({ error: 'Fuente no disponible', detail: String(error.message).slice(0, 200) }, { status: 502, headers: { 'Cache-Control': 'no-store' } })
    }
  },
}
