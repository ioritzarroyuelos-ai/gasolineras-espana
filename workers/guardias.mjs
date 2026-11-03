// Dos fuentes públicas con restricciones de conectividad fuera de España.
// Ubicación fijada en wrangler.guardias.jsonc; sin secretos ni URLs arbitrarias.
import { publicGuardiasSource, GUARDIAS_PUBLIC_SOURCES } from '../src/lib/guardias-relay.ts'
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url), territorio = url.pathname.slice(1)
    if (request.method !== 'GET' || !Object.hasOwn(GUARDIAS_PUBLIC_SOURCES, territorio)) return new Response('No encontrado', { status: 404 })
    const cacheKey = new Request(url.origin + '/' + territorio)
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
