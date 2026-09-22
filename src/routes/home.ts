// Portada "periódico" (/) + observatorio de precios (/precios-carburantes).
// Extraido de index.tsx (B1). Importa la infra de src/lib/runtime.ts (ya no hay
// deps-threading). franjaTiempo es helper de una sola ruta -> vive aqui, no en runtime.
import type { Hono } from 'hono'
import type { Env, MinistryResponse } from '../index'
import { loadSnapshot, loadStaticNational, slog, genNonce, resolveScheme, resolveHost } from '../lib/runtime'
import { resumenFromPre } from '../lib/gasolineras-precalculo'
import { statsNacional } from '../lib/municipios'
import { buildObservatorio, observatorioFromPre, calculaVariaciones, type ObservatorioPre } from '../lib/observatorio'
import { buildLandingPage, landingHeaders, type LandingData, type LandingTiempo } from '../html/landing'
import { buildObservatorioPage, observatorioHeaders, type Variacion } from '../html/observatorio'
import { frescuraTiempo } from '../../scripts/lib/tiempo.mjs'
import type { MunicipioLista, Prediccion } from '../../scripts/lib/tiempo.mjs'

// Franja "El tiempo hoy" de la portada: las ciudades más pobladas (municipios
// "importantes") que tengan predicción de AEMET fresca en el snapshot. Cargamos
// cada snapshot de provincia una sola vez (en paralelo) y cogemos el día 0. Solo
// AEMET y fresco (misma norma que /tiempo/*): nunca metemos dato dudoso en la
// portada. Como mucho 6 ciudades.
async function franjaTiempo(c: { req: { url: string }; env: Env }): Promise<LandingTiempo[] | undefined> {
  const raw = await loadSnapshot<{ municipios: MunicipioLista[] }>(c.req.url, 'tiempo/municipios.json', c.env.ASSETS)
  const all = (raw && raw.municipios) || []
  const cand = all.filter(m => m.imp).sort((a, b) => (b.pob || 0) - (a.pob || 0))
  if (!cand.length) return undefined
  // Recorremos los candidatos por población y cargamos el snapshot de cada
  // provincia SOLO cuando hace falta (una lectura por provincia, memorizada),
  // hasta llenar 6 ciudades. Así no cargamos 12 provincias para quedarnos con 6
  // ni desbordamos el LRU en memoria (10 huecos) que comparte todo el sitio.
  const snapCache = new Map<string, Record<string, Prediccion> | null>()
  const out: LandingTiempo[] = []
  for (const m of cand) {
    if (out.length >= 6) break
    let preds = snapCache.get(m.provinciaSlug)
    if (preds === undefined) {
      const s = await loadSnapshot<{ predicciones: Record<string, Prediccion> }>(
        c.req.url, 'tiempo/snapshot/' + m.provinciaSlug + '.json', c.env.ASSETS)
      preds = (s && s.predicciones) || null
      snapCache.set(m.provinciaSlug, preds)
    }
    const p = preds && preds[m.ine]
    if (!p || p.fuente !== 'AEMET' || !frescuraTiempo(p.elaborado).fiable) continue
    const hoy = p.dias && p.dias[0]
    if (!hoy) continue
    out.push({
      nombre: m.nombre,
      provincia: m.provinciaNombre,
      url: '/tiempo/' + m.provinciaSlug + '/' + m.slug,
      tmax: hoy.tmax,
      tmin: hoy.tmin,
      cielo: hoy.cielo || '',
    })
  }
  return out.length ? out : undefined
}

export function registerHomeRoutes(app: Hono<{ Bindings: Env }>): void {
  // Ship 28: `/` sirve la portada "periódico" con dato fresco (fecha, media
  // nacional de carburantes y el tiempo de hoy de las ciudades grandes). Todo el
  // IO va en try/catch: si un snapshot falla, la portada degrada sin romperse.
  // Compat: `/?action=...` (shortcuts PWA viejos) redirige al mapa.
  app.get('/', async c => {
    const url = new URL(c.req.url)
    if (url.searchParams.has('action')) {
      return c.redirect('/gasolineras/mapa' + url.search, 301)
    }
    const nonce = genNonce()
    const data: LandingData = {}
    try {
      // M5: media nacional desde el resumen precomputado (KB). Solo parseamos
      // stations.json (12 MB) si el resumen falta o no valida (fallback).
      const resumen = resumenFromPre(await loadSnapshot<unknown>(c.req.url, 'gasolineras-resumen.json', c.env.ASSETS))
      const st = resumen
        ? resumen.nacionalStats.stats
        : statsNacional(await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)).stats
      if (st['95'] || st['diesel']) {
        data.gasolina = {
          g95: st['95'] ? st['95'].avg : undefined,
          diesel: st['diesel'] ? st['diesel'].avg : undefined,
        }
      }
      data.tiempo = await franjaTiempo(c)
    } catch { /* la portada funciona sin datos frescos */ }
    return new Response(buildLandingPage(nonce, c.req.url, data), { headers: landingHeaders(nonce) })
  })

  // ---- Observatorio de precios ----
  // Pagina de datos pensada para SER CITADA por medios y foros: el Geoportal
  // oficial solo publica la foto de hoy, sin comparar provincias ni marcas y sin
  // historico, y los agregadores que compiten beben de ese mismo fichero. Aqui se
  // publica lo que ninguno da (ranking, diferencia entre extremos y variacion),
  // que es lo unico enlazable — y los enlaces son lo que hace posicionar al resto
  // del sitio, incluidas las paginas de farmacias de guardia.
  app.get('/precios-carburantes', async c => {
    const nonce = genNonce()

    // Camino rapido: agregados ya calculados por scripts/fetch-prices.mjs, unos
    // pocos KB. Si el fichero falta o no valida, se cae al calculo completo sobre
    // stations.json: la pagina sale igual, solo que mas lenta.
    let obs = observatorioFromPre(
      await loadSnapshot<ObservatorioPre>(c.req.url, 'observatorio.json', c.env.ASSETS)
    )
    if (!obs) {
      slog('warn', 'observatorio.pre_miss', {})
      let snap: MinistryResponse | null = null
      try {
        snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      } catch (err) {
        slog('warn', 'observatorio.snapshot_failed', { err: String(err).slice(0, 160) })
      }
      obs = buildObservatorio(snap)
    }
    if (!obs) return c.notFound()

    // Variaciones: se calculan sobre la serie nacional que el bot deja en
    // history/national.json. NO se consulta D1 aqui — hacerlo costaba 11,9 s por
    // visita y millones de filas del cupo diario (ver src/lib/observatorio.ts).
    // Si el fichero falta, la pagina sale con los rankings y sin variaciones, que
    // es la misma degradacion que ya habia prevista para cuando D1 no respondia.
    let variacionG95: Variacion[] = []
    let variacionDiesel: Variacion[] = []
    try {
      const serie = await loadStaticNational(c.req.url, c.env.ASSETS)
      if (serie) {
        const v = calculaVariaciones(serie)
        variacionG95 = v.g95
        variacionDiesel = v.diesel
      } else {
        slog('warn', 'observatorio.variaciones_miss', {})
      }
    } catch (err) {
      slog('warn', 'observatorio.variaciones_failed', { err: String(err).slice(0, 160) })
    }

    const canonical = resolveScheme(c) + '://' + resolveHost(c) + '/precios-carburantes'
    return new Response(
      buildObservatorioPage(nonce, { obs, variacionG95, variacionDiesel, canonical, deposito: 50 }),
      { headers: observatorioHeaders(nonce) },
    )
  })
}
