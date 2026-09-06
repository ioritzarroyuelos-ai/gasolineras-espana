// Landing del portal CercaYa — home pública en `/`.
//
// Diseño "periódico web" (Ship 28): en vez de una rejilla de tiles/cuadrados,
// una portada tipo diario — cabecera con fecha + cabecera de marca, un menú de
// secciones, y bloques con DATO REAL Y FRESCO (el tiempo de hoy de las ciudades
// grandes y la media nacional de carburantes), más el acceso a cada sección.
//
// Sigue siendo HTML estático SIN JavaScript:
//   - Render instantáneo, ideal para SEO y LCP.
//   - Sin bundle, sin fetch, sin service worker. CSP estricta (nonce en <style>
//     y en el JSON-LD; no hay <script> ejecutable).
//   - Los datos (fecha, carburantes, tiempo) los calcula el servidor en el
//     handler de `/` (src/index.tsx) y se inyectan aquí ya listos. Si un dato no
//     está disponible, su bloque degrada con elegancia (no se rompe la página).
//
// Compatibilidad:
//   - `/?action=...` (shortcuts PWA viejos) se maneja en index.tsx ANTES de
//     llegar aquí (redirect a /gasolineras/mapa).
//   - Se conserva el meta google-site-verification (Google lo lee SOLO en `/`),
//     el canonical, OG y el JSON-LD (WebSite + ItemList de servicios).

import { APP_VERSION } from '../lib/version'

/** Una ciudad de la franja "El tiempo hoy" (ya resuelta en el servidor). */
export interface LandingTiempo {
  nombre: string
  provincia: string
  url: string          // /tiempo/<prov>/<mun>
  tmax: number | null
  tmin: number | null
  cielo: string
}

/** Datos frescos que el handler de `/` inyecta en la portada. Todo opcional:
 *  si falta algo, ese bloque degrada sin romper la página. */
export interface LandingData {
  fecha?: string                               // "sábado, 6 de septiembre de 2026"
  gasolina?: { g95?: number; diesel?: number } // media nacional €/L
  tiempo?: LandingTiempo[]                      // ciudades grandes con dato fresco
}

// Escape HTML para cualquier string dinámico (nombres de municipio, cielo…).
function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Precio €/L con coma decimal (1.529 -> "1,529").
function precio(n: number): string {
  return n.toFixed(3).replace('.', ',') + '&nbsp;€/L'
}

// Emoji orientativo del estado del cielo (decorativo). Se decide por palabra
// clave sobre el texto de AEMET ("Despejado", "Intervalos nubosos con lluvia"…).
function emojiCielo(cielo: string): string {
  const s = String(cielo || '').toLowerCase()
  if (/tormenta/.test(s)) return '⛈️'
  if (/nieve|nevad/.test(s)) return '🌨️'
  if (/lluvia|chubasc|precipit|aguacero/.test(s)) return '🌧️'
  if (/niebla|bruma|calima/.test(s)) return '🌫️'
  if (/cubierto/.test(s)) return '☁️'
  if (/muy nuboso/.test(s)) return '🌥️'
  if (/nubos|nube|intervalos|nuboso/.test(s)) return '⛅'
  if (/despejado|sol/.test(s)) return '☀️'
  return '🌡️'
}

// Una celda de ciudad en la franja del tiempo.
function celdaTiempo(t: LandingTiempo): string {
  const mx = t.tmax != null ? t.tmax + '°' : '--'
  const mn = t.tmin != null ? t.tmin + '°' : '--'
  return '<a class="wx" href="' + esc(t.url) + '">'
    + '<span class="wx-city">' + esc(t.nombre) + '</span>'
    + '<span class="wx-emoji" aria-hidden="true">' + emojiCielo(t.cielo) + '</span>'
    + '<span class="wx-temp"><span class="mx">' + esc(mx) + '</span> <span class="mn">' + esc(mn) + '</span></span>'
    + (t.cielo ? '<span class="wx-sky">' + esc(t.cielo) + '</span>' : '')
    + '</a>'
}

export function buildLandingPage(
  nonce: string = '',
  reqUrl: string = 'https://webapp-3ft.pages.dev/',
  data: LandingData = {},
): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }

  const canonical = origin + '/'
  const title = 'CercaYa · Info útil de España al instante'
  const desc = 'Portal con servicios esenciales en España: el tiempo por municipio (AEMET), gasolineras con precios oficiales en tiempo real, farmacias de guardia y estaciones de ITV. Sin registro y gratis.'
  const logoUrl = origin + '/static/logo.svg'

  // JSON-LD: WebSite + ItemList de servicios (Google lo usa para sitelinks).
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'CercaYa',
        alternateName: 'CercaYa — Info útil de España',
        url: origin,
        description: desc,
        inLanguage: 'es-ES',
        publisher: {
          '@type': 'Organization',
          name: 'CercaYa',
          url: origin,
          logo: logoUrl,
        },
      },
      {
        '@type': 'ItemList',
        name: 'Servicios de CercaYa',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            item: {
              '@type': 'Service',
              name: 'El tiempo por municipio',
              description: 'Predicción del tiempo por municipio en España con datos oficiales de AEMET.',
              url: origin + '/tiempo/',
              serviceType: 'Predicción meteorológica',
              areaServed: { '@type': 'Country', name: 'España' },
            },
          },
          {
            '@type': 'ListItem',
            position: 2,
            item: {
              '@type': 'Service',
              name: 'Gasolineras España',
              description: 'Precios oficiales de carburantes en tiempo real en toda España.',
              url: origin + '/gasolineras/',
              serviceType: 'Consulta de precios de combustible',
              areaServed: { '@type': 'Country', name: 'España' },
            },
          },
          {
            '@type': 'ListItem',
            position: 3,
            item: {
              '@type': 'Service',
              name: 'Farmacias España',
              description: 'Farmacias cercanas con horarios y farmacias de guardia por semana.',
              url: origin + '/farmacias/',
              serviceType: 'Localización de farmacias y guardias',
              areaServed: { '@type': 'Country', name: 'España' },
            },
          },
          {
            '@type': 'ListItem',
            position: 4,
            item: {
              '@type': 'Service',
              name: 'Estaciones de ITV',
              description: 'Estaciones de ITV cercanas con dirección, teléfono y precios.',
              url: origin + '/itv/',
              serviceType: 'Localización de estaciones de ITV',
              areaServed: { '@type': 'Country', name: 'España' },
            },
          },
        ],
      },
    ],
  }

  // --- Bloque "El tiempo hoy" (franja de ciudades o gancho si no hay dato) ---
  const tiempo = Array.isArray(data.tiempo) ? data.tiempo : []
  const bloqueTiempo = tiempo.length
    ? '<div class="strip">' + tiempo.map(celdaTiempo).join('') + '</div>'
      + '<a class="more" href="/tiempo/">El tiempo de tu municipio &rarr;</a>'
    : '<p class="lead-note">Consulta la predicción de tu municipio con datos oficiales de AEMET.</p>'
      + '<a class="more" href="/tiempo/">Buscar el tiempo de tu municipio &rarr;</a>'

  // --- Bloque carburantes (media nacional o línea genérica) ---
  const g = data.gasolina || {}
  const bloqueGas = (g.g95 != null || g.diesel != null)
    ? (g.g95 != null ? '<p class="dato"><span class="d-label">Gasolina 95</span> <span class="price">' + precio(g.g95) + '</span></p>' : '')
      + (g.diesel != null ? '<p class="dato"><span class="d-label">Gasóleo A</span> <span class="price">' + precio(g.diesel) + '</span></p>' : '')
      + '<p class="d-note">media nacional de hoy · precios oficiales del Ministerio</p>'
    : '<p>Precios oficiales de carburantes en tiempo real, mapa y comparador por combustible.</p>'

  // Esc HTML de la fecha (viene del servidor, pero por higiene) + capitaliza.
  let fechaTxt = ''
  if (data.fecha) {
    const f = esc(data.fecha)
    fechaTxt = f.charAt(0).toUpperCase() + f.slice(1)
  }

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#166534" />

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />

  <!-- Verificacion de propiedad en Google Search Console. Google la lee SOLO en
       la portada, asi que tiene que seguir aqui: si se quita, Search Console
       desverifica la propiedad y se pierde el acceso a los informes. -->
  <meta name="google-site-verification" content="qzv_20xQiNesXM4hX5ZqYozonYMqZhY-Wop2Tndu81w" />

  <!-- Favicons + logos (comparten con la app de gasolineras) -->
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png" />
  <link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />

  <!-- Open Graph / Twitter para compartir -->
  <meta property="og:type" content="website" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:site_name" content="CercaYa" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(origin)}/static/og-image.png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />

  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="generator" content="CercaYa v${APP_VERSION}" />

  <script type="application/ld+json" nonce="${nonce}">${JSON.stringify(jsonLd)}</script>

  <style nonce="${nonce}">
    :root {
      --paper: #faf8f4;
      --surface: #ffffff;
      --ink: #1a1a1a;
      --muted: #5b6470;
      --brand: #16a34a;
      --brand-dark: #166534;
      --brand-soft: #dcfce7;
      --rule: #d9d4c9;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --paper: #0f172a;
        --surface: #1e293b;
        --ink: #f1f5f9;
        --muted: #94a3b8;
        --brand: #4ade80;
        --brand-dark: #86efac;
        --brand-soft: #064e3b;
        --rule: #334155;
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: var(--paper);
      color: var(--ink);
      line-height: 1.55;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .serif { }
    /* ---- Cabecera de periódico ---- */
    .masthead { background: var(--paper); text-align: center; padding: 22px 20px 0; }
    .mh-inner { max-width: 1080px; margin: 0 auto; }
    .mh-date {
      font-size: 12px; letter-spacing: 0.08em; text-transform: uppercase;
      color: var(--muted); padding-bottom: 10px; margin: 0 0 14px;
      border-bottom: 1px solid var(--rule);
    }
    .mh-logo { width: 44px; height: 44px; display: block; margin: 0 auto 4px; }
    .mh-title {
      font-family: Georgia, 'Times New Roman', 'Nimbus Roman', serif;
      font-size: clamp(40px, 8vw, 68px); font-weight: 800; letter-spacing: -0.02em;
      margin: 0; color: var(--ink); line-height: 1;
    }
    .mh-tag {
      font-family: Georgia, 'Times New Roman', serif; font-style: italic;
      color: var(--muted); margin: 8px 0 16px; font-size: clamp(14px, 2vw, 17px);
    }
    .mh-nav {
      max-width: 1080px; margin: 0 auto; display: flex; flex-wrap: wrap;
      justify-content: center; border-top: 3px double var(--ink);
      border-bottom: 1px solid var(--rule);
    }
    .mh-nav a {
      padding: 12px 18px; font-size: 13px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.06em; color: var(--brand-dark); text-decoration: none;
    }
    .mh-nav a:hover { background: var(--brand-soft); }
    .mh-nav a:focus-visible { background: var(--brand-soft); outline: 3px solid var(--brand-dark); outline-offset: -3px; }
    /* ---- Cuerpo ---- */
    main { flex: 1; width: 100%; max-width: 1080px; margin: 0 auto; padding: 26px 20px 12px; }
    .kicker {
      font-size: 12px; font-weight: 700; text-transform: uppercase;
      letter-spacing: 0.08em; color: var(--brand-dark); margin: 0 0 2px;
    }
    h2 {
      font-family: Georgia, 'Times New Roman', serif; color: var(--ink);
      margin: 0;
    }
    /* Lead: El tiempo hoy */
    .lead h2 {
      font-size: clamp(22px, 4vw, 30px); margin: 0 0 12px;
      border-bottom: 2px solid var(--ink); padding-bottom: 8px;
    }
    .lead-note { color: var(--muted); margin: 0 0 8px; }
    .strip { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 10px; }
    .wx {
      display: flex; flex-direction: column; gap: 2px; padding: 12px;
      border: 1px solid var(--rule); border-radius: 10px; background: var(--surface);
      text-decoration: none; color: var(--ink);
      transition: border-color 0.15s ease, transform 0.15s ease;
    }
    .wx:hover { border-color: var(--brand); transform: translateY(-2px); }
    .wx:focus-visible { border-color: var(--brand); outline: 2px solid var(--brand-dark); outline-offset: 2px; }
    .wx-city { font-weight: 700; font-size: 14px; }
    .wx-emoji { font-size: 24px; line-height: 1; }
    .wx-temp .mx { font-weight: 800; color: var(--brand-dark); font-size: 18px; }
    .wx-temp .mn { color: var(--muted); font-size: 14px; }
    .wx-sky { font-size: 12px; color: var(--muted); }
    .more {
      display: inline-block; margin-top: 12px; font-weight: 700;
      color: var(--brand-dark); text-decoration: none;
    }
    .more:hover { text-decoration: underline; }
    /* Columnas de secciones (periódico) */
    .cols {
      display: grid; grid-template-columns: 1fr; gap: 0;
      margin: 24px 0 4px; border-top: 1px solid var(--rule);
    }
    .col { padding: 18px 0; border-top: 1px solid var(--rule); }
    .col:first-child { border-top: none; }
    .col h2 { font-size: 20px; margin: 0 0 8px; }
    .col p { margin: 0 0 10px; color: var(--muted); font-size: 14px; }
    .dato { margin: 0 0 4px; font-size: 15px; color: var(--ink); display: flex; justify-content: space-between; gap: 12px; max-width: 320px; }
    .d-label { color: var(--ink); }
    .price { font-weight: 800; color: var(--brand-dark); white-space: nowrap; }
    .d-note { color: var(--muted); font-size: 13px; margin: 6px 0 10px; }
    .sub-link { display: block; font-size: 14px; color: var(--brand-dark); text-decoration: underline; margin-top: 4px; }
    .sub-link:hover { text-decoration: none; }
    @media (min-width: 720px) {
      .cols { grid-template-columns: repeat(3, 1fr); }
      .col { padding: 18px 22px; border-top: none; border-left: 1px solid var(--rule); }
      .col:first-child { padding-left: 0; border-left: none; }
    }
    /* Más: consulta por municipio (enlazado interno para SEO) */
    .mas { margin: 22px 0 4px; border-top: 3px double var(--ink); padding-top: 14px; }
    .mas h2 { font-size: 16px; margin: 0 0 10px; }
    .mas ul { list-style: none; padding: 0; margin: 0; display: grid; gap: 8px; grid-template-columns: 1fr; }
    .mas li a {
      display: block; padding: 11px 14px; border: 1px solid var(--rule);
      border-radius: 8px; background: var(--surface); color: var(--ink);
      text-decoration: none; font-size: 14px;
    }
    .mas li a:hover { border-color: var(--brand); }
    @media (min-width: 720px) { .mas ul { grid-template-columns: 1fr 1fr; } }
    /* ---- Footer ---- */
    footer {
      padding: 26px 20px; text-align: center; font-size: 13px;
      color: var(--muted); border-top: 1px solid var(--rule); margin-top: 18px;
    }
    footer a { color: var(--brand-dark); text-decoration: underline; }
    footer a:hover { text-decoration: none; }
    footer .foot-links { margin-bottom: 8px; }
    footer .foot-links a { margin: 0 8px; }
  </style>
</head>
<body>
  <header class="masthead">
    <div class="mh-inner">
      ${fechaTxt ? `<p class="mh-date">${fechaTxt} · España</p>` : ''}
      <img src="/static/logo.svg" alt="" class="mh-logo" width="44" height="44" />
      <h1 class="mh-title">CercaYa</h1>
      <p class="mh-tag">Info útil de España al instante · sin registro y gratis</p>
    </div>
    <nav class="mh-nav" aria-label="Secciones">
      <a href="/tiempo/">El tiempo</a>
      <a href="/gasolineras/">Gasolineras</a>
      <a href="/farmacias/">Farmacias</a>
      <a href="/itv/">ITV</a>
    </nav>
  </header>

  <main>
    <section class="lead" aria-labelledby="t-tiempo">
      <p class="kicker">Hoy en España</p>
      <h2 id="t-tiempo">El tiempo hoy</h2>
      ${bloqueTiempo}
    </section>

    <div class="cols">
      <section class="col" aria-labelledby="t-gas">
        <h2 id="t-gas">Gasolineras</h2>
        ${bloqueGas}
        <a class="more" href="/gasolineras/">Precios y mapa cerca de ti &rarr;</a>
      </section>

      <section class="col" aria-labelledby="t-farm">
        <h2 id="t-farm">Farmacias de guardia</h2>
        <p>Qué farmacia está de guardia hoy, provincia por provincia, y farmacias por municipio.</p>
        <a class="more" href="/farmacias/guardia">Ver farmacias de guardia &rarr;</a>
        <a class="sub-link" href="/farmacias/">Buscar farmacia por municipio</a>
      </section>

      <section class="col" aria-labelledby="t-itv">
        <h2 id="t-itv">ITV</h2>
        <p>Estaciones de ITV de toda España con dirección, teléfono, precios y cómo llegar.</p>
        <a class="more" href="/itv/">Buscar estación de ITV &rarr;</a>
      </section>
    </div>

    <!-- Enlazado interno: sin estos enlaces, las paginas SEO por municipio son
         una isla. Verificado en Search Console: Googlebot entra por aqui y
         recorre enlaces; si no hay camino, tarda mucho mas en descubrirlas. -->
    <nav class="mas" aria-label="Consulta por municipio">
      <h2>Consulta por municipio</h2>
      <ul>
        <li><a href="/tiempo/">El tiempo por municipio (predicción de AEMET)</a></li>
        <li><a href="/farmacias/guardia">Farmacias de guardia hoy, provincia por provincia</a></li>
        <li><a href="/itv/">Estaciones de ITV por provincia y municipio</a></li>
        <li><a href="/precios-carburantes">Observatorio de precios de los carburantes</a></li>
      </ul>
    </nav>
  </main>

  <footer>
    <div class="foot-links">
      <a href="/tiempo/">El tiempo</a>·
      <a href="/gasolineras/">Gasolineras</a>·
      <a href="/farmacias/">Farmacias</a>·
      <a href="/farmacias/guardia">Farmacias de guardia</a>·
      <a href="/itv/">ITV</a>·
      <a href="/precios-carburantes">Precios</a>·
      <a href="/privacidad">Privacidad</a>·
      <a href="/status">Estado del servicio</a>
    </div>
    <div>CercaYa v${APP_VERSION} · Datos oficiales de fuentes públicas</div>
  </footer>
</body>
</html>`
}

// Headers HTTP para la landing. CSP estricta con nonce para el JSON-LD y el
// <style> inline; no hay <script> ejecutable, ni CDNs, ni fetch (connect-src
// 'self' basta). Sin cambios respecto al diseño anterior (sigue sin JS).
export function landingHeaders(nonce: string): Record<string, string> {
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'nonce-" + nonce + "'",
    "style-src 'self' 'nonce-" + nonce + "'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "upgrade-insecure-requests",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join('; ')

  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    // Cache corto: la portada lleva dato del día (tiempo/precios). 5 min en CDN.
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  }
}
