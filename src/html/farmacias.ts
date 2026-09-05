// Pagina /farmacias/ — buscador de FARMACIA DE GUARDIA por municipio (solo texto).
//
// Historia: antes era un mapa (Leaflet) con TODAS las farmacias de OpenStreetMap
// y geolocalizacion. Se retiro (sept 2026) por decision del usuario: el mapa
// dependia de geocodificar direcciones con Nominatim, que bloquea las IPs del
// servidor, y ademas el valor real es "que farmacia esta de guardia en mi
// pueblo", no "todas las farmacias". Ahora es un buscador de texto: escribes tu
// municipio, autocompleta desde /api/guardias/municipios, y te lleva a la pagina
// de guardia de ese municipio (SSR, ya existente, con la red de seguridad que
// oculta turnos caducados).
//
// Sin mapa, sin geolocalizacion, sin cargar farmacias.json ni los 47 snapshots
// de guardias en el cliente: solo un indice pequeno de municipios.

import { APP_VERSION } from '../lib/version'

export function buildFarmaciasPage(
  nonce: string = '',
  reqUrl: string = 'https://webapp-3ft.pages.dev/farmacias/',
): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }

  const canonical = origin + '/farmacias/'
  const title = 'Farmacia de guardia en España · CercaYa'
  const desc = 'Busca la farmacia de guardia de tu municipio: dirección, teléfono y horario. '
    + 'Datos de los Colegios Oficiales de Farmacéuticos, sin registro.'
  const logoUrl = origin + '/static/logo.svg'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: canonical,
    description: desc,
    inLanguage: 'es-ES',
    isPartOf: { '@type': 'WebSite', name: 'CercaYa', url: origin },
  }

  const esc = (s: string): string => s
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="color-scheme" content="light dark" />
  <meta name="theme-color" content="#16a34a" />

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />

  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png" />
  <link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />

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
      --c-bg: #f8fafc; --c-surface: #ffffff; --c-text: #0f172a; --c-muted: #64748b;
      --c-brand-dark: #14532d; --c-brand: #16a34a; --c-brand-soft: #dcfce7;
      --c-border: #e2e8f0; --c-shadow: 0 4px 12px rgba(15,23,42,0.06);
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --c-bg: #0f172a; --c-surface: #1e293b; --c-text: #e2e8f0; --c-muted: #94a3b8;
        --c-brand-dark: #16a34a; --c-brand: #22c55e; --c-brand-soft: #052e16;
        --c-border: #334155; --c-shadow: 0 4px 12px rgba(0,0,0,0.4);
      }
    }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
      color: var(--c-text); background: var(--c-bg); line-height: 1.5; }
    header { background: linear-gradient(135deg,#166534,#16a34a); color: #fff; padding: 14px 18px;
      display: flex; align-items: center; gap: 12px; }
    header .brand { display: flex; align-items: center; gap: 10px; text-decoration: none; color: #fff; }
    header .brand-title { font-weight: 700; font-size: 17px; }
    header .brand-sub { font-size: 12px; opacity: .85; }
    header .back { margin-left: auto; color: #fff; text-decoration: none; font-weight: 600; font-size: 14px; }
    main { max-width: 640px; margin: 0 auto; padding: 24px 18px 40px; }
    h1 { font-size: 26px; line-height: 1.2; margin: 8px 0 6px; }
    .lead { color: var(--c-muted); margin: 0 0 22px; font-size: 15px; }
    .search { position: relative; }
    .search label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 15px; }
    .search input { width: 100%; padding: 14px 16px; font-size: 17px; border: 2px solid var(--c-border);
      border-radius: 12px; background: var(--c-surface); color: var(--c-text); }
    .search input:focus { outline: none; border-color: var(--c-brand); }
    .sugs { list-style: none; margin: 6px 0 0; padding: 6px; position: absolute; left: 0; right: 0;
      background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px;
      box-shadow: var(--c-shadow); max-height: 320px; overflow-y: auto; z-index: 10; }
    .sugs li { margin: 0; }
    .sugs a, .sugs .sug-msg { display: block; padding: 10px 12px; border-radius: 8px;
      text-decoration: none; color: var(--c-text); font-size: 15px; }
    .sugs a small { display: block; color: var(--c-muted); font-size: 12px; }
    .sugs a:hover, .sugs a.active { background: var(--c-brand-soft); }
    .sug-msg { color: var(--c-muted); font-size: 14px; }
    .hint { font-size: 13px; color: var(--c-muted); margin: 10px 0 0; }
    .browse { margin: 26px 0 0; }
    .browse a { display: inline-block; padding: 10px 16px; border: 1px solid var(--c-border);
      border-radius: 10px; background: var(--c-surface); color: var(--c-brand-dark);
      text-decoration: none; font-weight: 600; font-size: 15px; }
    .aviso { font-size: 13px; color: var(--c-muted); border-left: 3px solid var(--c-brand);
      background: var(--c-surface); padding: 10px 14px; border-radius: 6px; margin: 26px 0 0; }
    footer { border-top: 1px solid var(--c-border); margin-top: 34px; padding: 18px;
      text-align: center; color: var(--c-muted); font-size: 13px; }
    footer a { color: var(--c-brand-dark); }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand" aria-label="Volver al portal CercaYa">
      <img src="${esc(logoUrl)}" alt="" width="32" height="32" decoding="async" />
      <span>
        <span class="brand-title">Farmacias de guardia</span>
        <span class="brand-sub">Datos de los Colegios de Farmacéuticos</span>
      </span>
    </a>
    <a href="/" class="back">CercaYa &rarr;</a>
  </header>

  <main>
    <h1>Farmacia de guardia en España</h1>
    <p class="lead">Escribe tu municipio y te llevamos a la farmacia que está de guardia, con dirección, teléfono y horario.</p>

    <div class="search">
      <label for="q">¿En qué municipio?</label>
      <input id="q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Cuéllar, Utrera, Gijón..."
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugs" />
      <ul id="sugs" class="sugs" role="listbox" aria-label="Municipios" hidden></ul>
    </div>
    <p class="hint">Empieza a escribir el nombre de tu municipio.</p>

    <div class="browse">
      <a href="/farmacias/guardia">O consulta provincia por provincia &rarr;</a>
    </div>

    <p class="aviso">Los turnos los publica cada Colegio Oficial de Farmacéuticos y pueden cambiar.
      Algunas farmacias de guardia atienden a puerta cerrada: llama al timbre. Si vas a desplazarte,
      confirma antes por teléfono. En una urgencia grave, llama al 112.</p>
  </main>

  <footer>
    <div>Datos de los Colegios Oficiales de Farmacéuticos · <a href="/">CercaYa</a> · <a href="/privacidad">Privacidad</a> · v${APP_VERSION}</div>
  </footer>

  <script nonce="${nonce}">
  (function () {
    var input = document.getElementById('q');
    var box = document.getElementById('sugs');
    var muni = [];      // [{n, p, u}]
    var loaded = false;
    var active = -1;    // indice resaltado
    var shown = [];     // sugerencias visibles

    // Normaliza para comparar sin acentos ni mayusculas.
    function norm(s) {
      return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
    }

    function esc(s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    function cerrar() {
      box.hidden = true; box.innerHTML = ''; active = -1; shown = [];
      input.setAttribute('aria-expanded', 'false');
    }

    function msg(t) {
      box.innerHTML = '<li><span class="sug-msg">' + esc(t) + '</span></li>';
      box.hidden = false; shown = []; active = -1;
      input.setAttribute('aria-expanded', 'true');
    }

    function render(q) {
      var nq = norm(q);
      if (nq.length < 2) { cerrar(); return; }
      if (!loaded) { msg('Cargando municipios\\u2026'); return; }
      var res = [];
      for (var i = 0; i < muni.length && res.length < 12; i++) {
        if (norm(muni[i].n).indexOf(nq) >= 0) res.push(muni[i]);
      }
      shown = res; active = -1;
      if (res.length === 0) { msg('No encontramos ese municipio. Prueba con otro nombre o mira por provincia.'); return; }
      var html = '';
      for (var j = 0; j < res.length; j++) {
        html += '<li role="option"><a href="' + esc(res[j].u) + '">' + esc(res[j].n)
          + '<small>' + esc(res[j].p) + '</small></a></li>';
      }
      box.innerHTML = html;
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
    }

    function marcar(idx) {
      var links = box.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', i === idx);
      if (idx >= 0 && links[idx]) links[idx].scrollIntoView({ block: 'nearest' });
    }

    function ir(idx) {
      if (idx >= 0 && shown[idx]) { window.location.href = shown[idx].u; return true; }
      return false;
    }

    // Carga el indice una vez, al primer foco/teclazo.
    function cargar() {
      if (loaded) return;
      fetch('/api/guardias/municipios', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : []; })
        .then(function (data) {
          muni = Array.isArray(data) ? data : (data && data.municipios) || [];
          loaded = true;
          if (norm(input.value).length >= 2) render(input.value);
        })
        .catch(function () { loaded = true; msg('No se pudo cargar el listado. Consulta por provincia.'); });
    }

    input.addEventListener('focus', cargar);
    input.addEventListener('input', function () { cargar(); render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden || shown.length === 0) {
        if (e.key === 'Enter') { e.preventDefault(); }
        return;
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); marcar(active); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); marcar(active); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!ir(active)) ir(0); }
      else if (e.key === 'Escape') { cerrar(); }
    });
    // Cerrar al hacer clic fuera.
    document.addEventListener('click', function (e) {
      if (e.target !== input && !box.contains(e.target)) cerrar();
    });
  })();
  </script>
</body>
</html>`
}

// Headers HTTP para /farmacias/. CSP estricta: sin mapa ni CDN de tiles, solo
// mismo origen + nonce. La unica llamada de red del cliente es a
// /api/guardias/municipios (mismo origen -> connect-src 'self').
export function farmaciasHeaders(nonce: string): Record<string, string> {
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
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  }
}
