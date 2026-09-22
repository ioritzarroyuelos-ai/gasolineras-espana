// Histórico de precios / analítica (D1 + estático). Extraido de index.tsx (B1).
// Rutas: /api/history/:stationId, /api/history/province/:id, /api/stats/national,
// /api/predict/:stationId, /api/export. Importa infra de runtime. computeNationalStats
// + tipos viven anidados (solo los usa /api/stats/national).
import type { Hono } from 'hono'
import type { Env, MinistryResponse } from '../index'
import {
  loadSnapshot, filterStations, slog, clientKey, histLimiter, exportLimiter,
  loadStaticHistoryForStation, loadStaticMedianForProvince, loadStaticNational,
  incrementIsoDate, maxIsoDate,
} from '../lib/runtime'
import { isValidProvinciaId, classifyPriceVsCycle } from '../lib/pure'
import { FUEL_CODES, centsToEuros, hydrateDedupe } from '../lib/history'
import type { FilaHistorico } from '../lib/observatorio'

export function registerHistoryRoutes(app: Hono<{ Bindings: Env }>): void {
// ---- HISTORICO DE PRECIOS (D1) ----
// Devuelve la serie temporal de una estacion para N dias. Lee de D1 (tabla
// price_history, poblada por scheduled() diario). Si el binding DB no existe
// (dev local sin `wrangler d1 create`), respondemos 503 sin romper la UI —
// el cliente muestra "historial no disponible" en el popup.
//
// Respuesta:
//   { station_id, days, series: { '95': [{date, price}, ...], '98': [...], ... } }
//
// 'days' limitado a [1, 365] para acotar el trabajo por request. 365d de 4
// combustibles son 1460 filas max — serializado sale ~40 KB gzip, razonable.
//
// Cache-Control: public, max-age=3600. El dato cambia como mucho 1 vez/dia
// (cron a las 20:00 UTC), asi que 1h de CDN cache es conservador y evita que
// cualquier viral-tweet nos dispare 100k reads/hora contra D1.
app.get('/api/history/:stationId', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  // IDEESS: 1-10 digitos. Misma regla que snapshotToRows y validateId,
  // reproducida aqui porque la param del path no pasa por validateId().
  const stationId = c.req.param('stationId')
  if (!stationId || !/^\d{1,10}$/.test(stationId)) {
    return c.json({ error: 'invalid_station_id' }, 400)
  }

  // ?days=N con clamp [1, 365]. Default 30 = sweet spot para un sparkline
  // legible sin abrumar al servidor.
  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  // Cutoff = hoy - days. Usamos el mismo formato YYYY-MM-DD que usa la tabla
  // para evitar conversiones timezone-sensitive.
  const today = new Date()
  const cutoffDate = new Date(today.getTime())
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  const todayIso = today.toISOString().slice(0, 10)

  // Series base por fuel — la rellenamos primero desde el JSON estatico (si
  // existe) y luego sobreescribimos con datos D1 para fechas mas recientes.
  // El JSON estatico lo mantiene al dia el bot (scripts/actualiza-historico-estatico.mjs
  // tras cada foto de precios), asi que normalmente llega hasta hoy y D1 no se
  // consulta; solo si el bot fallara un dia se pediria ese dia a D1.
  const series: Record<string, Array<{ date: string; price: number }>> = {}
  for (const f of FUEL_CODES) series[f] = []
  let staticTo: string | null = null

  try {
    const staticData = await loadStaticHistoryForStation(c.req.url, stationId, c.env.ASSETS)
    if (staticData) {
      staticTo = staticData.to
      // Filtrar al rango [cutoff, today] e hidratar (re-expandir el dedupe a
      // un punto por dia para que el sparkline interpole correctamente sin
      // falsas rampas entre cambios distantes).
      for (const fuel of FUEL_CODES) {
        const dedup = staticData.byFuel[fuel]
        if (!dedup || dedup.length === 0) continue
        series[fuel] = hydrateDedupe(dedup, cutoff, todayIso)
      }
    }
  } catch (err) {
    // Fallback silencioso: si el JSON estatico falla, seguimos con D1 solo.
    slog('warn', 'history.static_load_failed', {
      stationId,
      err: String(err).slice(0, 200),
    })
  }

  // D1: leemos el rango que NO cubre el JSON estatico, o todo si no hay JSON.
  // Los datos D1 sobreescriben (priorizan) sobre el JSON para esas fechas — el
  // cron diario es la fuente mas reciente; el JSON estatico es snapshot fijo.
  if (c.env.DB) {
    const d1From = staticTo ? maxIsoDate(incrementIsoDate(staticTo), cutoff) : cutoff
    if (d1From <= todayIso) {
      try {
        const stmt = c.env.DB
          .prepare('SELECT fuel_code, date, price_cents FROM price_history WHERE station_id = ? AND date >= ? ORDER BY date ASC')
          .bind(stationId, d1From)
        const { results } = await stmt.all<{ fuel_code: string; date: string; price_cents: number }>()
        // Mergear: usamos un Map por fecha para que D1 sobreescriba a JSON
        // (en caso de overlap) y mantengamos un solo punto por (fuel, date).
        for (const f of FUEL_CODES) {
          const arr = series[f]
          if (arr.length === 0) continue
          // Indexar serie estatica por fecha para sobreescritura barata.
          const byDate = new Map<string, { date: string; price: number }>()
          for (const p of arr) byDate.set(p.date, p)
          series[f] = Array.from(byDate.values())
        }
        for (const r of results) {
          const arr = series[r.fuel_code]
          if (!arr) continue
          // Mantener orden cronologico al insertar/sobreescribir.
          const idx = arr.findIndex(p => p.date === r.date)
          const point = { date: r.date, price: centsToEuros(r.price_cents) }
          if (idx >= 0) arr[idx] = point
          else arr.push(point)
        }
        // Re-ordenar por fecha (los append D1 pueden venir despues que los
        // dias hidratados; cheap sort de ~365 elementos).
        for (const f of FUEL_CODES) {
          series[f].sort((a, b) => a.date.localeCompare(b.date))
        }
      } catch (err) {
        slog('error', 'history.query_failed', {
          stationId,
          days,
          err: String(err).slice(0, 300),
        })
        // Si la consulta D1 falla pero tenemos serie estatica, devolvemos eso.
        if (!staticTo) {
          return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
        }
      }
    }
  } else if (!staticTo) {
    // Ni D1 ni JSON estatico (dev sin binding y sin assets): 503 para que
    // el cliente muestre UI de "historial no disponible".
    return c.json({ error: 'history_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  return c.json(
    { station_id: stationId, days, series },
    200,
    { 'Cache-Control': 'public, max-age=3600' },
  )
})

// Mediana provincial por dia para un combustible. Se dibuja como linea de
// referencia en el sparkline del popup para que el usuario vea si esta
// gasolinera esta "por encima" o "por debajo" de la media de su provincia.
//
// Entrada: :id = IDProvincia (2 digitos), ?fuel=95|98|diesel|diesel_plus,
//          ?days=[1,365] (default 30).
// Salida: { provincia_id, fuel, days, median: [{date, price}, ...] }
//
// La mediana se calcula en Cloudflare, no en SQL — SQLite no tiene PERCENTILE
// nativo. Traemos todos los precios del periodo, agrupamos por date en memoria
// y ordenamos. Coste acotado: ~800 estaciones/provincia × 30 dias = 24k rows
// max (provincia grande), que procesar en JS es trivial.
app.get('/api/history/province/:id', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const id = c.req.param('id')
  if (!isValidProvinciaId(id)) {
    return c.json({ error: 'invalid_province_id' }, 400)
  }

  const fuel = c.req.query('fuel') || ''
  if (!FUEL_CODES.includes(fuel)) {
    return c.json({ error: 'invalid_fuel' }, 400)
  }

  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 1 || n > 365) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  const cutoffDate = new Date()
  const todayDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)
  const todayIso = todayDate.toISOString().slice(0, 10)

  // Median[date] = cents. La rellenamos primero desde el JSON estatico (mediana
  // pre-calculada por buildMedianFile en backfill-static-history.mjs), luego
  // sobreescribimos con datos D1 para fechas posteriores al `to` del JSON.
  // Para el JSON estatico no hace falta hidratar: la mediana ya es un punto
  // por dia (no esta dedupeada) en el archivo.
  const medianByDate = new Map<string, number>()
  let staticTo: string | null = null

  try {
    const staticMedian = await loadStaticMedianForProvince(c.req.url, id, fuel, c.env.ASSETS)
    if (staticMedian) {
      staticTo = staticMedian.to
      for (const [date, cents] of staticMedian.points) {
        if (date >= cutoff && date <= todayIso) {
          medianByDate.set(date, cents)
        }
      }
    }
  } catch (err) {
    slog('warn', 'history.static_median_load_failed', {
      provinciaId: id,
      fuel,
      err: String(err).slice(0, 200),
    })
  }

  // D1: solo consultamos el rango NO cubierto por el JSON estatico. Si no hay
  // JSON estatico (provincia sin backfill), consultamos todo.
  if (c.env.DB) {
    const d1From = staticTo ? maxIsoDate(incrementIsoDate(staticTo), cutoff) : cutoff
    if (d1From <= todayIso) {
      // Para mediana D1 necesitamos la lista de stationIds de la provincia.
      const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
      if (snap && Array.isArray(snap.ListaEESSPrecio)) {
        const stationIds = snap.ListaEESSPrecio
          .filter(s => s.IDProvincia === id && typeof s['IDEESS'] === 'string' && /^\d{1,10}$/.test(s['IDEESS']))
          .map(s => s['IDEESS'] as string)

        if (stationIds.length > 0) {
          // D1 limita a 100 parametros bound por query. Con 2 fijos (fuel, cutoff)
          // podemos meter como mucho 98 station_ids por sub-query. Paginamos en
          // chunks de 90 (margen) y consultamos en paralelo — Madrid (~900 estaciones)
          // sale en 10 sub-queries, milisegundos en total.
          const CHUNK = 90
          const sqlTemplate = (n: number) =>
            `SELECT date, price_cents FROM price_history WHERE fuel_code = ? AND date >= ? AND station_id IN (${new Array(n).fill('?').join(',')})`
          try {
            const queries: Promise<{ results: Array<{ date: string; price_cents: number }> }>[] = []
            for (let i = 0; i < stationIds.length; i += CHUNK) {
              const slice = stationIds.slice(i, i + CHUNK)
              const sql = sqlTemplate(slice.length)
              queries.push(
                c.env.DB.prepare(sql).bind(fuel, d1From, ...slice)
                  .all<{ date: string; price_cents: number }>()
              )
            }
            const subResults = await Promise.all(queries)
            // Agrupa por dia y calcula la mediana (valor central) — mismo
            // algoritmo que el JSON estatico para que ambos sean consistentes.
            const byDate = new Map<string, number[]>()
            for (const sr of subResults) for (const r of sr.results) {
              let arr = byDate.get(r.date)
              if (!arr) { arr = []; byDate.set(r.date, arr) }
              arr.push(r.price_cents)
            }
            for (const [date, arr] of byDate) {
              arr.sort((a, b) => a - b)
              const mid = arr[Math.floor(arr.length / 2)]
              medianByDate.set(date, mid)  // sobreescribe JSON estatico si hay solapamiento
            }
          } catch (err) {
            slog('error', 'history.province_median_failed', {
              provinciaId: id,
              fuel,
              days,
              err: String(err).slice(0, 300),
            })
            // Si D1 falla pero tenemos serie estatica, devolvemos eso.
            if (!staticTo) {
              return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
            }
          }
        }
      }
    }
  } else if (!staticTo) {
    return c.json({ error: 'history_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }

  const median: Array<{ date: string; price: number }> = []
  const dates = Array.from(medianByDate.keys()).sort()
  for (const date of dates) {
    median.push({ date, price: centsToEuros(medianByDate.get(date)!) })
  }

  return c.json(
    { provincia_id: id, fuel, days, median },
    200,
    { 'Cache-Control': 'public, max-age=3600' },
  )
})

// ---- STATS NACIONALES (Ship 15) ----
// Precio medio nacional por dia para los dos combustibles mas consumidos
// (gasolina 95 + gasoleo A). Devuelve, para cada fuel:
//
//   - today     : media del ultimo dia disponible en la serie
//   - avg30d    : media simple de las medias diarias del periodo
//   - delta_pct : (today - avg30d) / avg30d * 100 — positivo = mas caro hoy
//   - samples   : cuantas estaciones aportaron hoy (sanity check / confianza)
//
// La serie diaria (media de centimos por dia y combustible) la deja el bot en
// history/national.json; aqui solo se agrega la ventana pedida. Es media, no
// mediana, por continuidad con lo que calculaba AVG(price_cents) en D1: a escala
// nacional con ~11k estaciones/dia, el 5% de outliers raramente desplaza la
// media > 1 cent — acceptable.
//
// Motivacion: el usuario abre la app en la home sin saber si el precio que ve
// en su ciudad es "bueno" o "malo" en contexto. Un "precio medio nacional
// hoy: 1.48 € ↓ 0.2% vs. 30d" da contexto inmediato.
//
// Cache-Control: public, max-age=3600 — igual que history/*. Tras cada foto
// del bot los valores cambian, pero entre fotos son constantes.
type StatFuelRow = { date: string; fuel_code: string; avg_cents: number; n?: number }

interface NationalStatsFuel {
  today: number | null
  avg30d: number | null
  delta_pct: number | null
  samples_today: number | null
  days_available: number
  last_date: string | null
}

// Agrega el precio medio nacional a partir de una serie diaria ya calculada
// (una fila por dia y combustible), hoy la de history/national.json. Devuelve
// exactamente la forma que espera el cliente (core.ts).
function computeNationalStats(rows: StatFuelRow[], days: number): { days: number; fuels: Record<string, NationalStatsFuel> } {
  const FUELS = ['95', 'diesel'] as const
  const cutoffDate = new Date()
  cutoffDate.setUTCDate(cutoffDate.getUTCDate() - days)
  const cutoff = cutoffDate.toISOString().slice(0, 10)

  const byFuel = new Map<string, StatFuelRow[]>()
  for (const f of FUELS) byFuel.set(f, [])
  for (const r of rows) {
    if (r.date < cutoff) continue
    const arr = byFuel.get(r.fuel_code)
    if (arr) arr.push(r)
  }

  const out: Record<string, NationalStatsFuel> = {}
  for (const fuel of FUELS) {
    const arr = (byFuel.get(fuel) || []).slice().sort((a, b) => a.date.localeCompare(b.date))
    if (arr.length === 0) {
      out[fuel] = { today: null, avg30d: null, delta_pct: null, samples_today: null, days_available: 0, last_date: null }
      continue
    }
    const last = arr[arr.length - 1]
    const todayEur = centsToEuros(Math.round(last.avg_cents))
    let sum = 0
    for (const r of arr) sum += r.avg_cents
    const avgCents = sum / arr.length
    const avgEur = centsToEuros(Math.round(avgCents))
    const deltaPct = avgCents > 0 ? ((last.avg_cents - avgCents) / avgCents) * 100 : 0
    out[fuel] = {
      today: todayEur,
      avg30d: avgEur,
      delta_pct: Math.round(deltaPct * 100) / 100,
      samples_today: typeof last.n === 'number' ? last.n : null,
      days_available: arr.length,
      last_date: last.date,
    }
  }
  return { days, fuels: out }
}

app.get('/api/stats/national', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const daysParam = c.req.query('days')
  let days = 30
  if (daysParam != null) {
    const n = parseInt(daysParam, 10)
    if (!Number.isFinite(n) || n < 7 || n > 90) {
      return c.json({ error: 'invalid_days' }, 400)
    }
    days = n
  }

  const CACHE = { 'Cache-Control': 'public, max-age=3600' }

  // Serie diaria de history/national.json (10 min en memoria via loadSnapshot).
  // Sin fichero no hay respaldo en D1 a proposito: reagregar ~2,1 M de filas en
  // cada visita es lo que agoto el cupo diario del plan gratuito. La home sale
  // sin el bloque de precios ese dia, igual que cuando D1 no respondia.
  let rows: FilaHistorico[] | null = null
  try {
    rows = await loadStaticNational(c.req.url, c.env.ASSETS)
  } catch (err) {
    slog('warn', 'stats.static_load_failed', { err: String(err).slice(0, 200) })
  }
  if (!rows) {
    slog('error', 'stats.national_unavailable', { days })
    return c.json({ error: 'stats_unavailable' }, 503, { 'Cache-Control': 'no-store' })
  }
  return c.json(computeNationalStats(rows, days), 200, CACHE)
})

// ---- PREDICTOR SEMANAL (D1 + classifyPriceVsCycle) ----
// "¿Lleno ahora o espero?" — dada una estacion y combustible, lee los precios
// observados en los ultimos 90 dias en el MISMO DIA DE LA SEMANA que hoy y
// los compara con el precio actual. Devuelve un veredicto 'buy_now' / 'wait' /
// 'neutral' + percentil + muestra de control.
//
// Respuesta (ejemplo):
//   { station_id, fuel, verdict:"buy_now", percentile:15, sampleCount:12,
//     tipicalEurL:1.589, confidence:"high", currentEurL:1.569 }
//
// El precio "actual" lo enviamos via query ?current=1.569 para evitar otra
// ida y vuelta D1 (el cliente ya lo tiene del snapshot del Ministerio). El
// servidor solo valida que sea finito + positivo + dentro de rango (0.5 .. 5).
// Si no viene, intentamos inferirlo de la ultima muestra en D1.
//
// Cache-Control: public, max-age=3600 — la ventana cambia una vez al dia con
// el cron de ingest, asi que 1h de CDN es seguro y corta cualquier viral hit.
app.get('/api/predict/:stationId', async c => {
  const key = clientKey(c)
  const rl = histLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const stationId = c.req.param('stationId')
  if (!stationId || !/^\d{1,10}$/.test(stationId)) {
    return c.json({ error: 'invalid_station_id' }, 400)
  }

  const fuel = c.req.query('fuel') || ''
  if (!FUEL_CODES.includes(fuel)) {
    return c.json({ error: 'invalid_fuel' }, 400)
  }

  // Precio actual: opcional, pero si viene lo validamos. 0.5-5 €/L cubre
  // cualquier combustible plausible (hidrogeno esta en ~9€/kg pero lo
  // expresamos por L-equivalente, asi que acotamos generoso).
  const curRaw = c.req.query('current')
  let currentEurL: number | null = null
  if (curRaw != null) {
    const n = parseFloat(curRaw.replace(',', '.'))
    if (!Number.isFinite(n) || n <= 0.1 || n > 10) {
      return c.json({ error: 'invalid_current' }, 400)
    }
    currentEurL = n
  }

  const now = new Date()
  const weekday = now.getUTCDay()      // 0=Dom .. 6=Sab (UTC — consistente con date UTC en D1)
  const cutoff = new Date(now.getTime())
  cutoff.setUTCDate(cutoff.getUTCDate() - 90)
  const cutoffStr = cutoff.toISOString().slice(0, 10)
  const todayIso = now.toISOString().slice(0, 10)

  try {
    // Muestras del mismo dia de la semana en los ultimos 90d. Las recolectamos
    // primero del JSON estatico (1 año de backfill — ~13 muestras del weekday
    // garantizadas) y luego mergeamos con D1 para los dias mas recientes que
    // no cubre el JSON. Sin esta combinacion, los primeros 90d del cron diario
    // dejan <4 muestras y `classifyPriceVsCycle` marca confidence='low' →
    // el badge muestra "poca muestra".
    const samplesByDate = new Map<string, number>()  // D1 sobreescribe JSON
    let staticTo: string | null = null
    let lastKnownEurL: number | null = null  // fallback de currentEurL si no hay D1

    try {
      const staticData = await loadStaticHistoryForStation(c.req.url, stationId, c.env.ASSETS)
      if (staticData) {
        staticTo = staticData.to
        const dedup = staticData.byFuel[fuel]
        if (dedup && dedup.length > 0) {
          // Hidratamos el dedupe a un punto por dia y filtramos por weekday.
          // El hidratado es necesario porque el dedupe solo guarda cambios:
          // si el ultimo cambio fue hace 30 dias, todos los weekdays despues
          // mantienen ese precio y deben contar como muestras.
          const points = hydrateDedupe(dedup, cutoffStr, todayIso)
          for (const p of points) {
            if (new Date(p.date + 'T00:00:00Z').getUTCDay() === weekday) {
              samplesByDate.set(p.date, p.price)
            }
          }
          // Ultimo precio conocido del JSON (cualquier dia). Fallback para
          // currentEurL cuando no hay D1 ni viene en query.
          lastKnownEurL = dedup[dedup.length - 1][1] / 1000
        }
      }
    } catch (err) {
      slog('warn', 'predict.static_load_failed', {
        stationId,
        err: String(err).slice(0, 200),
      })
    }

    // D1: rango que NO cubre el JSON estatico, mismo weekday. SQLite no tiene
    // DAYOFWEEK pero strftime('%w', date) devuelve 0-6 (0=Dom). Si no hay JSON,
    // D1 cubre el rango completo 90d.
    if (c.env.DB) {
      const d1From = staticTo ? maxIsoDate(incrementIsoDate(staticTo), cutoffStr) : cutoffStr
      if (d1From <= todayIso) {
        try {
          const stmt = c.env.DB
            .prepare(
              `SELECT date, price_cents
               FROM price_history
               WHERE station_id = ?
                 AND fuel_code  = ?
                 AND date       >= ?
                 AND CAST(strftime('%w', date) AS INTEGER) = ?
               ORDER BY date ASC`
            )
            .bind(stationId, fuel, d1From, weekday)
          const { results } = await stmt.all<{ date: string; price_cents: number }>()
          for (const r of results) {
            samplesByDate.set(r.date, centsToEuros(r.price_cents))
          }
        } catch (err) {
          slog('error', 'predict.query_failed', {
            stationId,
            fuel,
            err: String(err).slice(0, 300),
          })
          // Si la query D1 falla pero tenemos JSON estatico, seguimos con eso.
          if (!staticTo) {
            return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
          }
        }
      }

      // Fallback de currentEurL: ultima muestra cualquiera (no solo weekday).
      // Query separada para no contaminar la lista de muestras del predictor.
      if (currentEurL == null) {
        try {
          const last = await c.env.DB
            .prepare('SELECT price_cents FROM price_history WHERE station_id = ? AND fuel_code = ? ORDER BY date DESC LIMIT 1')
            .bind(stationId, fuel)
            .all<{ price_cents: number }>()
          if (last.results.length > 0) {
            currentEurL = centsToEuros(last.results[0].price_cents)
          }
        } catch {
          // ignoramos: caera al fallback del JSON o devolvera verdict=null
        }
      }
    } else if (!staticTo) {
      // Ni D1 ni JSON estatico (dev sin binding y sin assets).
      return c.json({ error: 'predict_unavailable' }, 503, { 'Cache-Control': 'no-store' })
    }

    // Si seguimos sin currentEurL (sin D1, sin query param), usamos el ultimo
    // precio conocido del JSON estatico. Es desactualizado por horas/dias pero
    // permite emitir un veredicto razonable.
    if (currentEurL == null && lastKnownEurL != null) {
      currentEurL = lastKnownEurL
    }

    // Ordenamos por fecha asc para consistencia con la API previa (los Map
    // mantienen orden de insercion: JSON va antes que D1 y ambos vienen
    // ordenados, pero un sort explicito asegura el invariante).
    const weekdaySamples = Array.from(samplesByDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, price]) => price)

    if (currentEurL == null) {
      return c.json(
        { station_id: stationId, fuel, verdict: null, sampleCount: 0, weekday },
        200,
        { 'Cache-Control': 'public, max-age=3600' },
      )
    }

    const pred = classifyPriceVsCycle({ currentEurL, weekdaySamples })
    if (!pred) {
      return c.json(
        { station_id: stationId, fuel, verdict: null, sampleCount: 0, weekday, currentEurL },
        200,
        { 'Cache-Control': 'public, max-age=3600' },
      )
    }

    return c.json(
      {
        station_id: stationId,
        fuel,
        weekday,
        currentEurL,
        verdict:     pred.verdict,
        percentile:  pred.percentile,
        sampleCount: pred.sampleCount,
        confidence:  pred.confidence,
        tipicalEurL: pred.tipicalEurL,
      },
      200,
      { 'Cache-Control': 'public, max-age=3600' },
    )
  } catch (err) {
    slog('error', 'predict.query_failed', {
      stationId,
      fuel,
      err: String(err).slice(0, 300),
    })
    return c.json({ error: 'query_failed' }, 500, { 'Cache-Control': 'no-store' })
  }
})

// ============================================================================
// EXPORT CSV (datos publicos)
// ============================================================================
// GET /api/export?fuel=95&provincia=48  (ambos opcionales)
// Devuelve CSV con todas las estaciones (o filtradas por provincia) y el
// precio del combustible pedido. Pensado para bloggers, periodistas,
// investigadores academicos y analistas que quieran operar con los datos
// sin tener que navegar el JSON del Ministerio.
//
// Diseno:
// - Rate limit agresivo (exportLimiter = 6/min/IP): payload grande (~12k filas,
//   varios MB) y uso legitimo es "descargar una vez al dia", no polling.
// - Fuente: snapshot estatico diario (mismo que alimenta el mapa). Cache-Control
//   1h en CDN; aunque el snapshot es diario dejamos margen por si el cron tarda.
// - Formato: RFC 4180 — coma como separador, comillas dobles escapadas
//   duplicandolas. Content-Disposition con filename para que el navegador
//   descargue directamente.
// - Columnas: ideess,rotulo,direccion,cp,municipio,provincia,lat,lng,horario,
//   fuel,precio_eur_l,fecha (fecha = Fecha del snapshot, no el dia del request).
// - Filas sin precio del combustible pedido: omitidas (una estacion que no
//   vende 98 no aparece en el export de 98). Esto es lo que el consumidor
//   espera: "dame el precio de 98 en tal provincia".
app.get('/api/export', async c => {
  const key = clientKey(c)
  const rl = exportLimiter.check(key)
  if (!rl.allowed) {
    return c.json({ error: 'rate_limited' }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  }

  const fuel = c.req.query('fuel') || '95'
  if (!FUEL_CODES.includes(fuel)) {
    return c.json({ error: 'invalid_fuel', valid: FUEL_CODES }, 400)
  }
  // Invertir FUEL_MAP para ir de codigo a campo del Ministerio. Lo hacemos
  // inline porque es barato y no merece otra export desde history.ts.
  const MINISTRY_FIELD: Record<string, string> = {
    '95':          'Precio Gasolina 95 E5',
    '98':          'Precio Gasolina 98 E5',
    'diesel':      'Precio Gasoleo A',
    'diesel_plus': 'Precio Gasoleo Premium',
  }
  const ministryField = MINISTRY_FIELD[fuel]
  if (!ministryField) {
    // No deberia ocurrir si FUEL_CODES esta sincronizado, pero defensivo.
    return c.json({ error: 'invalid_fuel' }, 400)
  }

  const provinciaRaw = c.req.query('provincia') || ''
  let provinciaFilter: string | null = null
  if (provinciaRaw) {
    if (!isValidProvinciaId(provinciaRaw)) {
      return c.json({ error: 'invalid_provincia' }, 400)
    }
    provinciaFilter = provinciaRaw
  }

  const snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
  if (!snap) return c.json({ error: 'snapshot no disponible' }, 503)

  const filtered = filterStations(snap, s => {
    if (provinciaFilter && s.IDProvincia !== provinciaFilter) return false
    // Solo incluimos estaciones con precio valido para el combustible pedido.
    const raw = s[ministryField]
    if (!raw) return false
    const n = parseFloat(String(raw).replace(',', '.'))
    return Number.isFinite(n) && n > 0
  })
  if (!filtered) return c.json({ error: 'snapshot corrupto' }, 503)

  // Escapado RFC 4180: envuelve en comillas si hay coma, comilla, CR o LF;
  // dentro, las comillas se duplican.
  const csvEscape = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    if (s.indexOf(',') < 0 && s.indexOf('"') < 0 && s.indexOf('\n') < 0 && s.indexOf('\r') < 0) return s
    return '"' + s.replace(/"/g, '""') + '"'
  }

  const fechaSnap = typeof snap.Fecha === 'string' ? snap.Fecha : ''
  const header = 'ideess,rotulo,direccion,cp,municipio,provincia,lat,lng,horario,fuel,precio_eur_l,fecha'
  const lines: string[] = [header]
  const list = filtered.ListaEESSPrecio || []
  for (const s of list) {
    const lat = String(s['Latitud'] ?? '').replace(',', '.')
    const lng = String(s['Longitud (WGS84)'] ?? '').replace(',', '.')
    const priceRaw = s[ministryField]
    const priceNum = parseFloat(String(priceRaw).replace(',', '.'))
    if (!Number.isFinite(priceNum)) continue
    // El Ministerio usa claves con tilde: "Rótulo" y "Dirección" (no
    // "Rotulo"/"Direccion"). Probamos ambas por defensa: el cliente Web
    // usa las versiones sin tilde en algunos sitios y el snapshot podria
    // cambiar en el futuro si cambian el endpoint.
    const rotulo    = s['Rótulo']    || s['Rotulo']    || ''
    const direccion = s['Dirección'] || s['Direccion'] || ''
    lines.push([
      csvEscape(s['IDEESS']),
      csvEscape(rotulo),
      csvEscape(direccion),
      csvEscape(s['C.P.']),
      csvEscape(s['Municipio']),
      csvEscape(s['Provincia']),
      csvEscape(lat),
      csvEscape(lng),
      csvEscape(s['Horario']),
      csvEscape(fuel),
      csvEscape(priceNum.toFixed(3)),
      csvEscape(fechaSnap),
    ].join(','))
  }
  // Sufijo \r\n en lugar de \n por compatibilidad estricta con Excel en
  // Windows; los parsers modernos aceptan ambos.
  const csv = lines.join('\r\n') + '\r\n'

  // Nombre de fichero descriptivo pero determinista — permite al usuario
  // reemplazar descargas sucesivas sin colisiones raras. Sanitizamos la
  // provincia (solo digitos) porque ya validamos arriba, pero por defensa.
  const fname = 'gasolineras_' + fuel +
    (provinciaFilter ? '_prov' + provinciaFilter : '') +
    '_' + (fechaSnap || 'snapshot').replace(/[^0-9-]/g, '') + '.csv'

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + fname + '"',
      // Cache CDN: el snapshot se regenera 1/dia, 1h de edge cache protege
      // de avalanchas sin servir datos mas viejos que lo que ya es.
      'Cache-Control': 'public, max-age=3600',
      'X-Data-Source': 'snapshot',
      // Permite que herramientas JS en otros origenes consuman el CSV si
      // alguien monta un notebook (Observable, etc.) — no contiene datos
      // privados.
      'Access-Control-Allow-Origin': '*',
    },
  })
})
}
