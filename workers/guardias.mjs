// Fuentes públicas con incidencias de conectividad desde GitHub.
// Ubicación fijada en wrangler.guardias.jsonc; sin secretos ni URLs arbitrarias.
import { publicGuardiasSource, GUARDIAS_PUBLIC_SOURCES } from '../src/lib/guardias-relay.ts'
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), territorio = url.pathname.slice(1)
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
