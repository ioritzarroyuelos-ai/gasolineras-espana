// Rutas META/SEO: /robots.txt, /sitemap.xml, /sitemap-guardias.xml, /sitemap-tiempo.xml,
// /status y /privacidad. Extraido de index.tsx (B1). Importa infra de runtime. Los
// sitemaps agregan datos de TODOS los verticales (no es modulo hoja). legalPage vive
// anidado (solo lo usa /privacidad). SnapshotMeta se redefine local (no exportado).
import type { Hono } from 'hono'
import type { Env, MinistryResponse } from '../index'
import { loadSnapshot, genNonce, resolveHost, resolveScheme, pageHeaders, slog, SNAPSHOT_STALE_MS } from '../lib/runtime'
import { APP_VERSION } from '../lib/version'
import { BRAND } from '../lib/brand'
import { mastheadHtml, MASTHEAD_CSS } from '../html/masthead'
import { canonicalSite } from '../lib/pure'
import { PROVINCIAS, provinciaBySlug } from '../lib/provincias'
import { topMunicipiosInProvincia } from '../lib/municipios'
import { parseItv, provinciasConItv, municipiosConItv, estacionesDeProvincia, type ItvFile } from '../lib/itv'
import {
  guardiasFileForProvincia, parseGuardias, guardiasForProvincia,
  municipiosConGuardia, frescuraGuardia, GUARDIAS_TERRITORIO_BY_PROVINCIA,
  type GuardiasFile,
} from '../lib/guardias'
import type { MunicipioLista } from '../../scripts/lib/tiempo.mjs'

type SnapshotMeta = { fetchedAt?: string; ministryDate?: string; stationCount?: number; source?: string }

export function registerMetaRoutes(app: Hono<{ Bindings: Env }>): void {
app.get('/robots.txt', c => {
  const site = canonicalSite(c.env.PUBLIC_ORIGIN, resolveScheme(c), resolveHost(c))
  // Hosts NO canonicos (despliegues preview <hash>.pages.dev cuando hay
  // PUBLIC_ORIGIN): bloqueamos el rastreo entero para que Google no indexe
  // duplicados del sitio de produccion.
  if (!site.isCanonical) {
    return c.text('User-agent: *\nDisallow: /\n', 200, {
      'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=3600',
    })
  }
  const body = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    'Sitemap: ' + site.origin + '/sitemap.xml',
    'Sitemap: ' + site.origin + '/sitemap-guardias.xml',
    'Sitemap: ' + site.origin + '/sitemap-tiempo.xml',
    '',
  ].join('\n')
  return c.text(body, 200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=86400' })
})

// ---- SEO: sitemap.xml (home + 52 provincias + TODOS los municipios >=5 + privacidad) ----
// Ship 11: se añaden los top-10 municipios por provincia (filtrados a
// estaciones >=5 para no contaminar el indice con aldeas).
// Ship 18: expandimos a TODOS los municipios que pasen el minStations=5 (no
// solo top-10). El dataset tiene ~2500 municipios con >=5 estaciones — muy
// por debajo del limite de 50k URLs por sitemap, asi que cabe de sobra. El
// motivo: dejabamos ~90% de las urls municipio sin indexar por el slicing,
// y esas son justamente las paginas long-tail donde esta la mayor parte del
// trafico SEO potencial ("gasolineras en [mi pueblo]").
// Ship 18: `lastmod` usa la fecha real del snapshot (Ministerio) en vez de
// `today`. Asi Googlebot solo re-crawlea cuando el contenido cambia
// efectivamente — mejor crawl budget.
app.get('/sitemap.xml', async c => {
  const host = resolveHost(c)
  const scheme = resolveScheme(c)
  const base = scheme + '://' + host
  const today = new Date().toISOString().slice(0, 10)
  const entries: string[] = []
  // Para agregar municipios al sitemap necesitamos el snapshot. Si falla,
  // seguimos emitiendo el sitemap basico — mejor parcialmente indexado que
  // vacio.
  let snap: MinistryResponse | null = null
  try {
    snap = await loadSnapshot<MinistryResponse>(c.req.url, 'stations.json', c.env.ASSETS)
  } catch (err) {
    slog('warn', 'sitemap.snapshot_failed', { err: String(err).slice(0, 200) })
  }
  // lastmod preferido: fecha del snapshot del Ministerio (formato
  // "DD/MM/YYYY HH:mm:SS"). Fallback: hoy. Parseo defensivo — si el formato
  // cambia, caemos a `today` sin romper el sitemap.
  let snapLastmod = today
  if (snap && typeof snap.Fecha === 'string') {
    const m = snap.Fecha.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) snapLastmod = `${m[3]}-${m[2]}-${m[1]}`
  }
  // Home del portal CercaYa. Hoy redirige 301 a /gasolineras/, pero la
  // dejamos en el sitemap para que Google entienda la jerarquía. Priority
  // 1.0 porque sigue siendo la puerta de entrada principal.
  entries.push(`  <url><loc>${base}/</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`)
  entries.push(`  <url><loc>${base}/gasolineras/</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>1.0</priority></url>`)
  for (const p of PROVINCIAS) {
    entries.push(`  <url><loc>${base}/gasolineras/${p.slug}</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`)
    if (snap) {
      // Ship 18: todos los municipios con >=5 estaciones, no solo top-10.
      // Usamos el limit alto (10k) efectivamente para decir "sin limite por
      // provincia". Sigue aplicando minStations=5.
      const munis = topMunicipiosInProvincia(snap, p.id, { limit: 10000, minStations: 5 })
      for (const m of munis) {
        entries.push(`  <url><loc>${base}/gasolineras/${p.slug}/${m.slug}</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>0.6</priority></url>`)
      }
    }
  }
  // El portal de farmacias tampoco estaba declarado: sin esto, Google no tenia
  // ni una sola URL de farmacias por donde entrar.
  entries.push(`  <url><loc>${base}/precios-carburantes</loc><lastmod>${snapLastmod}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`)
  entries.push(`  <url><loc>${base}/farmacias/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`)

  // Indice y provincias de guardia: son el camino de enlaces hasta las 1.289
  // paginas de municipio, que hasta ahora eran huerfanas.
  entries.push(`  <url><loc>${base}/farmacias/guardia</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`)
  for (const p of PROVINCIAS) {
    if (guardiasFileForProvincia(p.slug)) {
      entries.push(`  <url><loc>${base}/farmacias/${p.slug}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`)
    }
  }

  // ITV: indice + provincia + municipio. changefreq mensual porque, al reves
  // que las guardias o los precios, el dato es estatico — decir "daily" aqui
  // solo gastaria presupuesto de rastreo en paginas que no cambian.
  try {
    const todasItv = parseItv(await loadSnapshot<ItvFile>(c.req.url, 'itv.json', c.env.ASSETS))
    if (todasItv.length) {
      entries.push(`  <url><loc>${base}/itv/</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`)
      // Prioridad alta: es la pagina del vertical con opcion real de posicionar.
      entries.push(`  <url><loc>${base}/itv/precios</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.9</priority></url>`)
      for (const p of provinciasConItv(todasItv)) {
        entries.push(`  <url><loc>${base}/itv/${p.slug}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.7</priority></url>`)
        for (const m of municipiosConItv(estacionesDeProvincia(todasItv, p.id))) {
          entries.push(`  <url><loc>${base}/itv/${p.slug}/${m.slug}</loc><lastmod>${today}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>`)
        }
      }
    }
  } catch (err) {
    slog('warn', 'sitemap.itv_failed', { err: String(err).slice(0, 200) })
  }

  // Tiempo: el hub va aqui (junto al resto de verticales); las ~8k paginas de
  // municipio viven en sitemap-tiempo.xml aparte (carga tiempo/municipios.json,
  // 1,5 MB — no queremos ese peso en el sitemap principal).
  entries.push(`  <url><loc>${base}/tiempo/</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.9</priority></url>`)
  entries.push(`  <url><loc>${base}/privacidad</loc><lastmod>${today}</lastmod><changefreq>yearly</changefreq><priority>0.3</priority></url>`)
  // /status es una pagina de estado tecnico (auto-refresh), sin intencion de
  // busqueda: fuera del sitemap y con noindex en su plantilla. Gastaba rastreo.
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  return c.text(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

// ---- SEO: sitemap de farmacias de guardia ----
// Va en un sitemap APARTE (declarado en robots.txt junto al principal) porque
// necesita cargar los 47 snapshots de los colegios y no queremos penalizar el
// sitemap de gasolineras, que es el que mas se pide. Cada fichero se carga UNA
// vez aunque cubra varias provincias (el caso de 'clm').
app.get('/sitemap-guardias.xml', async c => {
  const host = resolveHost(c)
  const scheme = resolveScheme(c)
  const base = scheme + '://' + host
  const today = new Date().toISOString().slice(0, 10)
  const entries: string[] = []
  const cache = new Map<string, GuardiasFile | null>()

  for (const provSlug of Object.keys(GUARDIAS_TERRITORIO_BY_PROVINCIA)) {
    const prov = provinciaBySlug(provSlug)
    const file = guardiasFileForProvincia(provSlug)
    if (!prov || !file) continue
    if (!cache.has(file)) {
      try {
        cache.set(file, await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS))
      } catch (err) {
        slog('warn', 'sitemap_guardias.snapshot_failed', { file, err: String(err).slice(0, 160) })
        cache.set(file, null)
      }
    }
    const raw = cache.get(file)
    if (!raw) continue
    // Territorio sin refrescar (>30 h): fuera del sitemap para que Google no
    // rastree paginas cuyo turno ya no mostramos como valido.
    if (!frescuraGuardia(raw.ts).fiable) continue
    const rows = guardiasForProvincia(parseGuardias(raw), prov.id, raw.territorio)
    const lastmod = (raw.ts || '').slice(0, 10) || today
    for (const m of municipiosConGuardia(rows)) {
      entries.push(`  <url><loc>${base}/farmacias/${provSlug}/${m.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`)
    }
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  return c.text(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

// ---- SEO: sitemap del tiempo (aparte) ----
// La vertical del tiempo tiene ~8.100 municipios en 52 provincias. Van en su
// propio sitemap para no lastrar el principal con la carga de
// tiempo/municipios.json (~1,5 MB). Declarado en robots.txt junto a los otros.
// changefreq=daily: la prediccion se refresca a diario. El pronostico existe
// para CUALQUIER municipio (AEMET precacheado en los importantes, y AEMET
// bajo-demanda / Open-Meteo de reserva en el resto), asi que no filtramos.
app.get('/sitemap-tiempo.xml', async c => {
  const host = resolveHost(c)
  const scheme = resolveScheme(c)
  const base = scheme + '://' + host
  const today = new Date().toISOString().slice(0, 10)
  const entries: string[] = []
  let raw: { generado?: string; municipios?: MunicipioLista[] } | null = null
  try {
    raw = await loadSnapshot<{ generado?: string; municipios: MunicipioLista[] }>(
      c.req.url, 'tiempo/municipios.json', c.env.ASSETS)
  } catch (err) {
    slog('warn', 'sitemap_tiempo.snapshot_failed', { err: String(err).slice(0, 200) })
  }
  const munis = (raw && raw.municipios) || []
  // lastmod: fecha de generacion del maestro (fallback hoy).
  const lastmod = raw && typeof raw.generado === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw.generado)
    ? raw.generado.slice(0, 10)
    : today
  // Paginas de provincia (una por provinciaSlug distinto).
  const provSeen = new Set<string>()
  for (const m of munis) {
    if (!m.provinciaSlug || provSeen.has(m.provinciaSlug)) continue
    provSeen.add(m.provinciaSlug)
    entries.push(`  <url><loc>${base}/tiempo/${m.provinciaSlug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>`)
  }
  // Paginas de municipio (todas).
  for (const m of munis) {
    if (!m.provinciaSlug || !m.slug) continue
    entries.push(`  <url><loc>${base}/tiempo/${m.provinciaSlug}/${m.slug}</loc><lastmod>${lastmod}</lastmod><changefreq>daily</changefreq><priority>0.5</priority></url>`)
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`
  return c.text(body, 200, { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=3600' })
})

// ---- Paginas legales (HTML simple, sin JS) ----
// El nonce debe coincidir con el del header CSP — sin el atributo el <style>
// inline es bloqueado (style-src no lleva ya 'unsafe-inline'). El caller de
// la ruta es quien genera el nonce via genNonce() y lo pasa a ambos sitios.
function legalPage(title: string, bodyHtml: string, nonce: string): string {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title} · ${BRAND}</title>
<meta name="robots" content="index,follow"/>
<meta name="description" content="${title} de ${BRAND}"/>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#x26FD;</text></svg>"/>
<style nonce="${nonce}">
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#1f2937;line-height:1.6;color-scheme:light}
  .legal-main{max-width:720px;margin:0 auto;padding:32px 20px}
  h1{color:#14532d;border-bottom:2px solid #16a34a;padding-bottom:8px}
  h2{color:#15803d;margin-top:28px}
  a{color:#16a34a}
  code{background:#f3f4f6;padding:2px 6px;border-radius:4px;font-size:13px}
  .back{display:inline-block;margin-bottom:16px;color:#64748b;text-decoration:none}
  footer{margin-top:40px;padding-top:20px;border-top:1px solid #e5e7eb;font-size:13px;color:#64748b}
  ${MASTHEAD_CSS}
</style>
</head><body>
${mastheadHtml()}
<main class="legal-main">
<a class="back" href="/gasolineras/">← Volver</a>
${bodyHtml}
<footer>${BRAND} · v${APP_VERSION} · Datos: Ministerio para la Transición Ecológica y el Reto Demográfico.</footer>
</main>
</body></html>`
}

// ---- /status: pagina publica de estado del servicio ----
// Expone los mismos datos que /api/health (publico) pero renderizados en HTML
// con auto-refresh 60s. Objetivo: cualquier usuario (o external monitor
// tipo uptimerobot) puede ver a simple vista si el servicio esta vivo y si
// el snapshot del Ministerio es fresco.
//
// No depende de JS del cliente — HTML puro para que funcione incluso si la
// CSP es excesivamente estricta o si el user-agent es un crawler/monitor
// sin JS. Datos se calculan server-side en cada request.
app.get('/status', async c => {
  const nonce = genNonce()
  const meta = await loadSnapshot<SnapshotMeta>(c.req.url, 'snapshot-meta.json', c.env.ASSETS)
  const now = Date.now()
  let ageMs: number | null = null
  let fetchedAtFmt = '—'
  let stale = true   // sin meta = stale por precaucion
  if (meta?.fetchedAt) {
    const t = Date.parse(meta.fetchedAt)
    if (Number.isFinite(t)) {
      ageMs = now - t
      stale = ageMs > SNAPSHOT_STALE_MS
      fetchedAtFmt = new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
    }
  }
  const ageTxt = ageMs == null ? '—'
    : ageMs < 60_000       ? Math.round(ageMs / 1000) + 's'
    : ageMs < 3_600_000    ? Math.round(ageMs / 60_000) + ' min'
    : ageMs < 86_400_000   ? Math.round(ageMs / 3_600_000) + ' h'
    : Math.round(ageMs / 86_400_000) + ' d'
  const statusLabel = stale ? 'DEGRADADO' : 'OPERATIVO'
  const statusClass = stale ? 'down' : 'up'
  const stationCount = typeof meta?.stationCount === 'number' ? meta.stationCount.toLocaleString('es-ES') : '—'
  const ministryDate = meta?.ministryDate ?? '—'
  // Esc HTML muy simple — las piezas vienen de nuestro meta JSON y son strings
  // muy cortas (fechas, numeros), pero defensivo por si el snapshot cambia.
  const esc = (v: string): string => v
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  const bodyHtml = `
<style nonce="${nonce}">
  body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;color:#1f2937;line-height:1.6;color-scheme:light}
  .status-main{max-width:720px;margin:0 auto;padding:32px 20px}
  h1{color:#14532d;border-bottom:2px solid #16a34a;padding-bottom:8px;margin-bottom:8px}
  h2{color:#15803d;margin-top:28px;font-size:18px}
  a{color:#16a34a}
  .back{display:inline-block;margin-bottom:16px;color:#64748b;text-decoration:none}
  .status-hero{display:flex;align-items:center;gap:14px;padding:20px;border-radius:10px;border:2px solid;margin:8px 0 24px}
  .status-hero.up{background:#dcfce7;border-color:#16a34a;color:#14532d}
  .status-hero.down{background:#fef2f2;border-color:#b91c1c;color:#7f1d1d}
  .status-dot{width:14px;height:14px;border-radius:50%;display:inline-block}
  .status-dot.up{background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.2)}
  .status-dot.down{background:#b91c1c;box-shadow:0 0 0 4px rgba(185,28,28,.2)}
  .status-label{font-size:22px;font-weight:700;letter-spacing:.02em}
  .status-sub{font-size:13px;opacity:.8;margin-top:2px}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}
  th{color:#64748b;font-weight:500;width:40%}
  td{font-family:ui-monospace,Consolas,Menlo,monospace;color:#0f172a}
  .foot{margin-top:32px;padding-top:16px;border-top:1px solid #e5e7eb;font-size:12px;color:#64748b}
  .muted{color:#64748b;font-size:13px}
  ${MASTHEAD_CSS}
</style>
${mastheadHtml()}
<main class="status-main">
<a class="back" href="/gasolineras/">← Volver</a>
<h1>Estado del servicio</h1>
<p class="muted">Esta pagina se actualiza automaticamente cada 60 segundos.</p>

<div class="status-hero ${statusClass}">
  <span class="status-dot ${statusClass}" aria-hidden="true"></span>
  <div>
    <div class="status-label">${statusLabel}</div>
    <div class="status-sub">${stale ? 'Snapshot del Ministerio desactualizado — el servicio sigue respondiendo con los ultimos datos disponibles.' : 'Todos los sistemas operativos. Datos actualizados.'}</div>
  </div>
</div>

<h2>Datos del ultimo snapshot</h2>
<table>
  <tbody>
    <tr><th>Ultima ingesta</th><td>${esc(fetchedAtFmt)}</td></tr>
    <tr><th>Edad del snapshot</th><td>${esc(ageTxt)}</td></tr>
    <tr><th>Fecha Ministerio</th><td>${esc(ministryDate)}</td></tr>
    <tr><th>Estaciones cargadas</th><td>${esc(stationCount)}</td></tr>
    <tr><th>Version</th><td>v${APP_VERSION}</td></tr>
  </tbody>
</table>

<h2>Endpoints de salud</h2>
<table>
  <tbody>
    <tr><th><code>/api/health</code></th><td>JSON publico (ok, stale, version)</td></tr>
    <tr><th><code>/data/snapshot-meta.json</code></th><td>Meta del ultimo snapshot</td></tr>
    <tr><th><code>/api/export</code></th><td>CSV publico de precios</td></tr>
  </tbody>
</table>

<p class="foot">Datos origen: <a href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help">API oficial del Ministerio</a>.
El snapshot se re-ingesta 1 vez al dia (20:00 UTC) por cron en GitHub Actions.
Si ves "DEGRADADO" mas de 48h seguidas, hay un problema — abre una issue.</p>
</main>
`
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Estado · ${BRAND}</title>
<meta name="robots" content="noindex,follow"/>
<meta name="description" content="Estado del servicio ${BRAND}: health, freshness del snapshot del Ministerio, numero de estaciones cargadas."/>
<meta http-equiv="refresh" content="60"/>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>${stale ? '&#x26A0;' : '&#x2705;'}</text></svg>"/>
</head><body>
${bodyHtml}
</body></html>`
  return c.html(html, stale ? 503 : 200, {
    ...pageHeaders(nonce, false),
    // Cache muy corto: la pagina misma necesita recomputarse en cada req con
    // el meta fresco, pero 30s de edge ayuda ante un hit masivo de monitors.
    'Cache-Control': 'public, max-age=30',
  })
})

app.get('/privacidad', c => {
  // Generamos nonce por request igual que en la home, y emitimos CSP completa
  // (antes /privacidad respondia sin Content-Security-Policy — un XSS en la
  // pagina legal habria tenido ejecucion libre). turnstile=false porque no hay
  // widget en la pagina legal.
  const nonce = genNonce()
  const html = legalPage('Privacidad', `
<h1>Política de privacidad</h1>
<p><strong>Última actualización:</strong> ${new Date().toISOString().slice(0,10)}</p>

<p>Esta política cuenta, en lenguaje llano, qué datos tratamos y cuáles no.
La idea de CercaYa es simple: <strong>casi todo funciona sin cuenta y sin que
tus datos salgan de tu navegador</strong>. Solo recogemos datos personales
cuando tú decides activarlos (iniciar sesión o suscribirte a las alertas de
Telegram).</p>

<h2>Resumen rápido</h2>
<ul>
  <li>No hace falta registrarse para usar la web.</li>
  <li>No mostramos publicidad ni usamos rastreadores de terceros.</li>
  <li>La única cookie que ponemos es la de tu sesión, y solo si inicias sesión.</li>
  <li>Puedes borrar tus datos tú mismo (cerrar sesión, borrar favoritos, o <code>/stop</code> en Telegram).</li>
</ul>

<h2>Si NO inicias sesión (uso normal)</h2>
<p>Tus ajustes, favoritos y perfil de vehículo se guardan únicamente en el
almacenamiento local (<code>localStorage</code>) de tu navegador. <strong>No se
envían a ningún servidor</strong> y no salen de tu dispositivo. Si borras los
datos del navegador, desaparecen.</p>

<h2>Si inicias sesión con Google (opcional)</h2>
<p>El inicio de sesión sirve para tener tus favoritos y ajustes en varios
dispositivos. Es totalmente voluntario. Cuando inicias sesión:</p>
<ul>
  <li>Verificamos tu identidad con Google y creamos una <strong>cookie de sesión</strong>
      propia (firmada, <code>HttpOnly</code>, válida 30 días). Solo sirve para
      mantenerte identificado; no rastrea tu navegación.</li>
  <li>Guardamos un identificador opaco de tu cuenta de Google, tu correo, tu
      nombre y tu foto de perfil, asociados a tu sesión.</li>
  <li>Sincronizamos tus favoritos, perfil y ajustes en la base de datos de claves
      de Cloudflare (Workers KV), bajo una clave ligada a tu identificador de Google.</li>
</ul>
<p><strong>Base legal:</strong> tu consentimiento y la prestación del servicio que
tú pides (la sincronización).</p>
<p><strong>Cómo borrarlos:</strong> al eliminar un favorito o vaciar tu perfil,
la app borra ese dato también en el servidor. Cerrar sesión elimina la cookie de
este dispositivo. Si quieres que borremos por completo tus datos sincronizados,
escríbenos (ver <em>Contacto</em>).</p>

<h2>Alertas de precios por Telegram (opcional)</h2>
<p>Si activas las alertas, vinculas tu chat de Telegram con la web. Para ello
guardamos, en nuestra base de datos (Cloudflare D1), tu <strong>identificador de
chat de Telegram</strong> junto con las gasolineras y combustibles que quieres
vigilar y el umbral de aviso. Con eso te enviamos el resumen diario y el listado
cuando escribes <code>/precios</code>.</p>
<p><strong>Base legal:</strong> tu consentimiento (lo activas tú).</p>
<p><strong>Cómo darte de baja:</strong> escribe <code>/stop</code> al bot y
borramos todas tus alertas al instante. Si bloqueas el bot, también dejamos de
enviarte mensajes y limpiamos tu suscripción.</p>

<h2>Reportar un precio incorrecto (opcional)</h2>
<p>Si nos avisas de que un precio no cuadra, guardamos la gasolinera, el
combustible, el precio que indicas y tu comentario (si escribes uno). Para evitar
abusos guardamos una <strong>huella de tu IP</strong> (un hash que cambia cada día
y no permite identificarte ni seguirte de un día para otro), nunca tu IP en claro.
No escribas datos personales en el comentario: es un campo de texto libre que
revisamos manualmente.</p>
<p><strong>Base legal:</strong> interés legítimo en la calidad de los datos.</p>

<h2>Tu ubicación</h2>
<p>Si concedes permiso de ubicación, usamos tus coordenadas <strong>en el propio
navegador</strong> para calcular distancias a las gasolineras. En algunas funciones,
para traducir tus coordenadas a una dirección, se envían al servidor de CercaYa,
que reenvía la consulta a OpenStreetMap <strong>sin tu dirección IP</strong>. No
guardamos tus coordenadas asociadas a ti.</p>

<h2>Datos técnicos y telemetría (anónimos)</h2>
<p>Para mantener el servicio funcionando y detectar fallos recogemos información
técnica <strong>sin identificarte</strong>:</p>
<ul>
  <li><strong>Errores de la web:</strong> mensaje, traza técnica, página y navegador
      (versión). No guardamos ni cookies ni tu IP junto a estos errores.</li>
  <li><strong>Velocidad de carga (Web Vitals):</strong> tiempos de carga y respuesta
      de la página, sin identificador y <strong>sin tu IP</strong>.</li>
  <li><strong>Avisos de seguridad (CSP):</strong> si el navegador bloquea un recurso
      sospechoso, nos llega un informe para revisarlo.</li>
</ul>
<p><strong>Base legal:</strong> interés legítimo en la seguridad y el buen
funcionamiento del servicio.</p>

<h2>Tu dirección IP</h2>
<p>Como cualquier web, nuestro servidor ve tu IP en cada petición (nos la facilita
Cloudflare). La usamos para <strong>limitar el abuso</strong> (evitar que alguien
sature el servicio). Este control es temporal y en memoria. Tu IP puede aparecer
de forma pasajera en los registros técnicos del servidor, que se usan solo para
diagnóstico y no para crear perfiles.</p>

<h2>Con quién se comparten datos</h2>
<p>No vendemos ni cedemos tus datos. Para que la web funcione intervienen estos
servicios:</p>
<ul>
  <li><strong>Cloudflare</strong>: alojamiento, red y bases de datos donde se
      ejecuta y guarda todo lo anterior.</li>
  <li><strong>Mapa</strong>: al abrir el mapa, tu navegador pide las imágenes a
      <code>OpenFreeMap</code> y al <code>IGN</code> (vista satélite), que reciben tu IP.</li>
  <li><strong>jsDelivr</strong>: sirve iconos y tipografías; recibe tu IP al cargar la web.</li>
  <li><strong>Google</strong>: solo si usas el inicio de sesión; entonces Google
      gestiona la autenticación y tu foto de perfil.</li>
  <li><strong>Telegram</strong>: solo si te suscribes a las alertas.</li>
  <li><strong>OpenStreetMap, Ministerio (precios) y AEMET / Open-Meteo (tiempo)</strong>:
      sus datos llegan a través de nuestro servidor, <strong>sin exponer tu IP</strong>
      a esos servicios.</li>
</ul>
<p>La infraestructura y las bases de datos son de Cloudflare (red global). Cloudflare
es una empresa estadounidense adherida a los marcos de transferencia de datos vigentes.</p>

<h2>De dónde salen los datos que mostramos</h2>
<ul>
  <li><strong>Precios de carburantes</strong>: Ministerio para la Transición Ecológica y el Reto Demográfico.</li>
  <li><strong>Estaciones de ITV</strong>: Dirección General de Tráfico (DGT).</li>
  <li><strong>El tiempo</strong>: AEMET (Agencia Estatal de Meteorología), con Open-Meteo como suplente.</li>
  <li><strong>Farmacias de guardia</strong>: Colegios Oficiales de Farmacéuticos.</li>
</ul>

<h2>Cuánto tiempo guardamos las cosas</h2>
<ul>
  <li>Cookie de sesión: 30 días (o hasta que cierres sesión).</li>
  <li>Datos sincronizados (si inicias sesión) y alertas de Telegram: hasta que los borres tú.</li>
  <li>Errores técnicos y reportes de precio: mientras nos sean útiles para mantener el servicio.</li>
</ul>

<h2>Cookies</h2>
<p>No usamos cookies de publicidad ni de seguimiento. La única cookie es la de tu
sesión, y solo existe si inicias sesión.</p>

<h2>Tus derechos</h2>
<p>Tienes derecho a acceder, rectificar y borrar tus datos, y a oponerte a su
tratamiento. En la práctica puedes ejercerlos tú directamente: cerrar sesión,
borrar tus favoritos, darte de baja con <code>/stop</code> en Telegram o borrar los
datos de tu navegador. Para cualquier otra petición, escríbenos.</p>

<h2>Cambios</h2>
<p>Si cambiamos esta política, actualizaremos la fecha del principio.</p>

<h2>Contacto</h2>
<p>Para dudas o para pedir el borrado de tus datos, abre una incidencia en el
repositorio del proyecto.</p>
`, nonce)
  return c.html(html, 200, {
    ...pageHeaders(nonce, false),
    // pageHeaders fija Cache-Control: no-cache para rutas dinamicas con Turnstile,
    // pero la pagina legal es estatica y cacheable por 1h — sobreescribimos despues.
    'Cache-Control': 'public, max-age=3600',
  })
})
}
