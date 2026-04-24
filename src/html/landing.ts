// Landing del portal CercaYa — home pública en `/`.
//
// Ship 26: hasta ahora `/` redirigía 301 al mapa de gasolineras. Con la
// transformación del proyecto a portal multi-servicio, la raíz pasa a ser
// una home con tiles hacia los distintos servicios.
//
// Diseño intencionalmente minimalista y sin JS:
//   - Es HTML estático puro → render instantáneo, perfecto para SEO y LCP.
//   - Sin bundle, sin fetch, sin service worker. El único coste de red es la
//     propia página + favicon + logo (todo ya cacheado por el SW para otras
//     rutas).
//   - CSP sigue siendo estricta (nonce en el <style>). No hay scripts.
//
// Compatibilidad:
//   - Los bookmarks viejos a `/` ya no entran directo al mapa, pero el tile
//     de "Gasolineras" es el primero y más visible → 1 click extra.
//   - Los shortcuts del PWA (`/?action=...`) se manejan en el handler de
//     index.tsx ANTES de llegar aquí: si hay `action`, redirect a
//     `/gasolineras/?action=...` para no romper instalaciones viejas.
//
// Tiles:
//   1. Gasolineras — activo, link a /gasolineras/.
//   2. Farmacias — activo, link a /farmacias/ (MVP nacional con OSM).
//   3. ITV — próximamente (Fase 3 del roadmap).
//
// SEO:
//   - Title y description propios de portal, no de gasolineras.
//   - Canonical = origin + '/'.
//   - JSON-LD WebSite + ItemList con los servicios.
//   - OG tags para compartir en redes.

import { APP_VERSION } from '../lib/version'

export function buildLandingPage(
  nonce: string = '',
  reqUrl: string = 'https://webapp-3ft.pages.dev/',
): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }

  const canonical = origin + '/'
  const title = 'CercaYa · Info útil de España al instante'
  const desc = 'Portal con servicios esenciales en España: gasolineras con precios oficiales en tiempo real, farmacias de guardia y estaciones de ITV. Todo con tu ubicación, sin registro y gratis.'
  const logoUrl = origin + '/static/logo.svg'

  // JSON-LD: declaramos el sitio como WebSite + ItemList de servicios. Google
  // usa esto para rich snippets y sitelinks. Cuando Farmacias/ITV estén
  // activas, habrá que bajarle el `isAccessibleForFree` a cada Service.
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
              name: 'Gasolineras España',
              description: 'Precios oficiales de carburantes en tiempo real en toda España.',
              url: origin + '/gasolineras/',
              serviceType: 'Consulta de precios de combustible',
              areaServed: { '@type': 'Country', name: 'España' },
            },
          },
          {
            '@type': 'ListItem',
            position: 2,
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
            position: 3,
            item: {
              '@type': 'Service',
              name: 'Estaciones de ITV',
              description: 'Estaciones de ITV cercanas con horarios y precios.',
              serviceType: 'Localización de estaciones de ITV',
              areaServed: { '@type': 'Country', name: 'España' },
            },
          },
        ],
      },
    ],
  }

  // Esc HTML básico para cualquier string externo que llegue aquí. Hoy no hay
  // ninguno (todo es literal), pero dejamos el helper por si se añaden tiles
  // dinámicos más adelante.
  const esc = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#14532d" />

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />

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
      --c-bg: #f8fafc;
      --c-surface: #ffffff;
      --c-text: #0f172a;
      --c-muted: #64748b;
      --c-brand-dark: #14532d;
      --c-brand: #16a34a;
      --c-brand-soft: #dcfce7;
      --c-border: #e2e8f0;
      --c-coming-bg: #fef3c7;
      --c-coming-text: #92400e;
      --c-shadow: 0 4px 12px rgba(15,23,42,0.06);
      --c-shadow-hover: 0 8px 24px rgba(22,163,74,0.18);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --c-bg: #0f172a;
        --c-surface: #1e293b;
        --c-text: #f1f5f9;
        --c-muted: #94a3b8;
        --c-brand-dark: #064e3b;
        --c-brand: #4ade80;
        --c-brand-soft: #064e3b;
        --c-border: #334155;
        --c-coming-bg: #422006;
        --c-coming-text: #fcd34d;
        --c-shadow: 0 4px 12px rgba(0,0,0,0.3);
        --c-shadow-hover: 0 8px 24px rgba(74,222,128,0.25);
      }
    }
    *, *::before, *::after { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
      background: var(--c-bg);
      color: var(--c-text);
      line-height: 1.55;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    /* ---- Hero ---- */
    .hero {
      background: linear-gradient(135deg, var(--c-brand-dark) 0%, var(--c-brand) 100%);
      color: #ffffff;
      padding: 56px 24px 48px;
      text-align: center;
    }
    .hero-logo {
      width: 64px; height: 64px;
      margin: 0 auto 16px;
      display: block;
    }
    .hero-title {
      font-size: clamp(28px, 5vw, 40px);
      font-weight: 800;
      margin: 0 0 8px;
      letter-spacing: -0.02em;
    }
    .hero-sub {
      font-size: clamp(15px, 2vw, 18px);
      margin: 0;
      opacity: 0.92;
      max-width: 640px;
      margin: 0 auto;
    }
    /* ---- Tiles ---- */
    main {
      flex: 1;
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: 48px 24px 32px;
    }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 20px;
    }
    .tile {
      background: var(--c-surface);
      border: 1px solid var(--c-border);
      border-radius: 16px;
      padding: 28px 24px;
      box-shadow: var(--c-shadow);
      display: flex;
      flex-direction: column;
      gap: 12px;
      text-decoration: none;
      color: inherit;
      transition: transform 0.15s ease, box-shadow 0.15s ease, border-color 0.15s ease;
      position: relative;
      min-height: 200px;
    }
    .tile-active { cursor: pointer; }
    .tile-active:hover,
    .tile-active:focus-visible {
      transform: translateY(-4px);
      box-shadow: var(--c-shadow-hover);
      border-color: var(--c-brand);
      outline: none;
    }
    /* Los tiles "proximamente" no llevan opacity — bajaba el contraste
       por debajo de WCAG AA (4.5:1) tanto en el parrafo muted como en
       el badge. La combinacion cursor:default + badge amarillo ya
       comunica el estado sin necesidad de difuminado. */
    .tile-coming { cursor: default; }
    .tile-icon {
      font-size: 40px;
      line-height: 1;
      width: 56px; height: 56px;
      background: var(--c-brand-soft);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .tile h2 {
      font-size: 20px;
      font-weight: 700;
      margin: 0;
      color: var(--c-brand-dark);
    }
    @media (prefers-color-scheme: dark) {
      .tile h2 { color: var(--c-brand); }
    }
    .tile p {
      margin: 0;
      font-size: 14px;
      color: var(--c-muted);
      flex: 1;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      width: fit-content;
    }
    .badge-active {
      background: var(--c-brand-soft);
      color: var(--c-brand-dark);
    }
    @media (prefers-color-scheme: dark) {
      .badge-active { color: var(--c-brand); }
    }
    .badge-coming {
      background: var(--c-coming-bg);
      color: var(--c-coming-text);
    }
    /* ---- Footer ---- */
    footer {
      padding: 32px 24px;
      text-align: center;
      font-size: 13px;
      color: var(--c-muted);
      border-top: 1px solid var(--c-border);
    }
    /* WCAG AA contraste 4.5:1 → usamos el verde oscuro en light y el claro
       en dark. Subrayado permanente: es mejor practica de accesibilidad y
       ademas diferencia claramente los enlaces del texto circundante. */
    footer a { color: var(--c-brand-dark); text-decoration: underline; }
    footer a:hover { text-decoration: none; }
    @media (prefers-color-scheme: dark) {
      footer a { color: var(--c-brand); }
    }
    footer .foot-links { margin-bottom: 8px; }
    footer .foot-links a { margin: 0 8px; }
    @media (max-width: 520px) {
      .hero { padding: 40px 20px 36px; }
      main { padding: 32px 20px 24px; }
      .tile { min-height: auto; }
    }
  </style>
</head>
<body>
  <header class="hero">
    <img src="/static/logo.svg" alt="" class="hero-logo" width="64" height="64" />
    <h1 class="hero-title">CercaYa</h1>
    <p class="hero-sub">Info útil de España al instante. Con tu ubicación, sin registro y gratis.</p>
  </header>

  <main>
    <section class="tiles" aria-label="Servicios disponibles">
      <a href="/gasolineras/" class="tile tile-active" aria-label="Abrir Gasolineras España">
        <div class="tile-icon" aria-hidden="true">&#x26FD;</div>
        <h2>Gasolineras</h2>
        <p>Precios oficiales del Ministerio en tiempo real. Mapa, comparador por combustible, favoritos y rutas óptimas.</p>
        <span class="badge badge-active">Disponible</span>
      </a>

      <a href="/farmacias/" class="tile tile-active" aria-label="Abrir Farmacias en España">
        <div class="tile-icon" aria-hidden="true">&#x1F48A;</div>
        <h2>Farmacias</h2>
        <p>Farmacias cercanas con dirección, teléfono, horario y distancia GPS. Usa tu ubicación para ordenarlas por proximidad.</p>
        <span class="badge badge-active">Disponible</span>
      </a>

      <div class="tile tile-coming" role="group" aria-label="ITV (próximamente)">
        <div class="tile-icon" aria-hidden="true">&#x1F527;</div>
        <h2>ITV</h2>
        <p>Estaciones de Inspección Técnica de Vehículos cercanas con horarios y precios oficiales.</p>
        <span class="badge badge-coming">Próximamente</span>
      </div>
    </section>
  </main>

  <footer>
    <div class="foot-links">
      <a href="/gasolineras/">Gasolineras</a>·
      <a href="/farmacias/">Farmacias</a>·
      <a href="/privacidad">Privacidad</a>·
      <a href="/status">Estado del servicio</a>
    </div>
    <div>CercaYa v${APP_VERSION} · Datos oficiales de fuentes públicas</div>
  </footer>
</body>
</html>`
}

// Headers HTTP para la landing. Más ligeros que los del mapa: no hace falta
// Turnstile, Google Identity, ni los preconnects a basemaps/unpkg. Mantiene
// CSP estricta con nonce para el JSON-LD y el <style> inline.
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
    // Cache corto: la landing es estática pero queremos poder cambiar copy
    // sin esperar 24h. 5 min en CDN, revalidación en cliente.
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  }
}
