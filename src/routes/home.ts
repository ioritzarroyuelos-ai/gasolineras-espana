// Portada Cerca de ti, panel Mi día y observatorio de precios.
import type { Context, Hono } from 'hono'
import type { Env, MinistryResponse } from '../index'
import { loadSnapshot, loadStaticNational, slog, genNonce, resolveScheme, resolveHost } from '../lib/runtime'
import { resumenFromPre } from '../lib/gasolineras-precalculo'
import { statsNacional } from '../lib/municipios'
import { buildObservatorio, observatorioFromPre, calculaVariaciones, type ObservatorioPre } from '../lib/observatorio'
import { buildLandingPage, landingHeaders, type LandingData, type LandingTiempo } from '../html/landing'
import { buildObservatorioPage, observatorioHeaders, type Variacion } from '../html/observatorio'
import { prediccionVigente, zonaTiempo } from '../../scripts/lib/tiempo.mjs'
import { fechaHoraLocal } from '../../scripts/lib/fechas.mjs'
import type { MunicipioLista, Prediccion } from '../../scripts/lib/tiempo.mjs'
import { buscaLocalidades, serviciosLocalidad, type Localidad, type LocalidadIndex } from '../lib/localidades'
import { validarCompeticionDeportiva } from '../../scripts/lib/deportes.mjs'

// Hasta cuatro ciudades con parte vigente de AEMET para su día local.
async function franjaTiempo(c: { req: { url: string }; env: Env }): Promise<LandingTiempo[] | undefined> {
  const raw = await loadSnapshot<{ municipios: MunicipioLista[] }>(c.req.url, 'tiempo/municipios.json', c.env.ASSETS)
  const all = (raw && raw.municipios) || []
  const cand = all.filter(m => m.imp).sort((a, b) => (b.pob || 0) - (a.pob || 0))
  if (!cand.length) return undefined
  // Recorremos los candidatos por población y cargamos el snapshot de cada
  // provincia SOLO cuando hace falta (una lectura por provincia, memorizada),
  // hasta llenar 4 ciudades. Así no cargamos 12 provincias para quedarnos con 4
  // ni desbordamos el LRU en memoria (10 huecos) que comparte todo el sitio.
  const snapCache = new Map<string, Record<string, Prediccion> | null>()
  const out: LandingTiempo[] = []
  for (const m of cand) {
    if (out.length >= 4) break
    let preds = snapCache.get(m.provinciaSlug)
    if (preds === undefined) {
      const s = await loadSnapshot<{ predicciones: Record<string, Prediccion> }>(
        c.req.url, 'tiempo/snapshot/' + m.provinciaSlug + '.json', c.env.ASSETS)
      preds = (s && s.predicciones) || null
      snapCache.set(m.provinciaSlug, preds)
    }
    const p = preds && preds[m.ine]
    if (p?.fuente !== 'AEMET') continue
    const fecha = fechaHoraLocal(new Date(), zonaTiempo(m.ine)).slice(0,10)
    const hoy = prediccionVigente(p)?.dias.find(d => d.fecha.slice(0,10) === fecha)
    if (!hoy) continue
    out.push({
      nombre: m.nombre,
      url: '/tiempo/' + m.provinciaSlug + '/' + m.slug,
      tmax: hoy.tmax,
      tmin: hoy.tmin,
      cielo: hoy.cielo || '',
      elaborado: p.elaborado,
      fuente: p.fuente,
    })
  }
  return out.length ? out : undefined
}

export function registerHomeRoutes(app: Hono<{ Bindings: Env }>): void {
  const cargaLocalidad = async (c: { req: { url: string }; env: Env }, ine: string) => {
    if (!/^\d{5}$/.test(ine)) return undefined
    const all = await loadSnapshot<Localidad[]>(c.req.url, 'localidades/' + ine.slice(0, 2) + '.json', c.env.ASSETS)
    return all?.find(m => m.ine === ine)
  }
  app.get('/api/localidades', async c => {
    const all = await loadSnapshot<LocalidadIndex[]>(c.req.url, 'localidades-index.json', c.env.ASSETS)
    if (!all) return c.json({ error: 'Búsqueda temporalmente no disponible' }, 503)
    return c.json(buscaLocalidades(all, c.req.query('q') || ''))
  })
  app.get('/api/localidad/:ine', async c => {
    const m = await cargaLocalidad(c, c.req.param('ine'))
    if (!m) return c.json({ error: 'Municipio no encontrado' }, 404)
    return c.json({ ine: m.ine, nombre: m.nombre, provinciaNombre: m.provinciaNombre, servicios: serviciosLocalidad(m) }, 200, { 'Cache-Control': 'no-store' })
  })
  // Un fallo parcial de una fuente no oculta los demás servicios.
  async function portada(c: Context<{ Bindings: Env }>, vista: 'inicio' | 'mi-dia') {
    const url = new URL(c.req.url)
    if (vista === 'inicio' && url.searchParams.has('action')) {
      return c.redirect('/gasolineras/mapa' + url.search, 301)
    }
    const nonce = genNonce()
    const data: LandingData = { vista }
    const ine = url.searchParams.get('municipio')
    if (ine) {
      data.localidad = await cargaLocalidad(c, ine)
      if (!data.localidad) return c.notFound()
    }
    const query = url.searchParams.get('q')
    if (query) {
      data.query = query.slice(0, 70)
      data.encontrados = buscaLocalidades(await loadSnapshot<LocalidadIndex[]>(c.req.url, 'localidades-index.json', c.env.ASSETS) || [], query)
    }
    await Promise.allSettled([(async () => {
      // M5: media nacional desde el resumen precomputado (KB). Solo parseamos
      // stations.json (12 MB) si el resumen falta o no valida (fallback).
      const resumen = resumenFromPre(await loadSnapshot<unknown>(c.req.url, 'gasolineras-resumen.json', c.env.ASSETS))
      const fallback = resumen ? null : await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      const st = resumen
        ? resumen.nacionalStats.stats
        : statsNacional(fallback).stats
      if (st['95'] || st['diesel']) {
        data.gasolina = {
          g95: st['95'] ? st['95'].avg : undefined,
          diesel: st['diesel'] ? st['diesel'].avg : undefined,
          fecha: resumen?.fechaMinisterio || fallback?.Fecha,
        }
      }
    })(), (async () => {
      if (!data.localidad) data.tiempo = await franjaTiempo(c)
    })(), (async () => {
      // Una competición pequeña, validada con el mismo contrato de Deportes.
      // El navegador no descarga el índice completo para mostrar una tarjeta.
      const raw = await loadSnapshot<unknown>(c.req.url, 'deportes/laliga-easports.json', c.env.ASSETS)
      if (raw) {
        const comp = validarCompeticionDeportiva(raw)
        if (comp.id === 'laliga-easports') data.deporte = comp
      }
    })()])
    return new Response(buildLandingPage(nonce, c.req.url, data), { headers: landingHeaders(nonce) })
  }
  app.get('/', c => portada(c, 'inicio'))
  app.get('/mi-dia', c => portada(c, 'mi-dia'))
  app.get('/mi-dia/', c => c.redirect('/mi-dia' + new URL(c.req.url).search, 301))

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
