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
import { withAccountHeaders } from '../lib/runtime'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { PORTAL_BASE_CSS } from './ui-theme'
import { jsonLdScript } from './html'   // S2: JSON-LD blindado (< → <)

export function buildFarmaciasPage(
  nonce: string = '',
  reqUrl: string = 'https://webapp-3ft.pages.dev/farmacias/',
): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }

  const canonical = origin + '/farmacias/'
  const title = 'Farmacia de guardia en España · España Útil'
  const desc = 'Busca la farmacia de guardia de tu municipio: dirección, teléfono y horario. '
    + 'Datos de los Colegios Oficiales de Farmacéuticos, sin registro.'

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    url: canonical,
    description: desc,
    inLanguage: 'es-ES',
    isPartOf: { '@type': 'WebSite', name: 'España Útil', url: origin },
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
  <meta name="theme-color" content="#137954" />

  <title>${esc(title)}</title>
  <meta name="description" content="${esc(desc)}" />
  <link rel="canonical" href="${esc(canonical)}" />

  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png" />
  <link rel="apple-touch-icon" href="/static/apple-touch-icon.png" />

  <meta property="og:type" content="website" />
  <meta property="og:locale" content="es_ES" />
  <meta property="og:site_name" content="España Útil" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:url" content="${esc(canonical)}" />
  <meta property="og:image" content="${esc(origin)}/static/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="España Útil · datos oficiales de España al instante" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />

  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="generator" content="España Útil v${APP_VERSION}" />

  ${jsonLdScript(jsonLd, nonce)}

  <style nonce="${nonce}">
    ${PORTAL_BASE_CSS}
    :root {
      color-scheme: light;
      --c-surface: #ffffff; --c-text: var(--eu-ink); --c-muted: var(--eu-muted);
      --c-brand-dark: var(--eu-accent); --c-brand: var(--eu-accent); --c-brand-soft: var(--eu-soft);
      --c-border: var(--eu-line); --c-shadow: 0 4px 12px rgba(15,23,42,0.06);
    }
    ${MASTHEAD_CSS}
    main { max-width: 840px; margin: 0 auto; padding: 24px 18px 40px; }
    h1 { font-size: clamp(30px,4.5vw,48px); line-height: 1.12; margin: 8px 0 6px; }
    .lead { color: var(--c-muted); margin: 0 0 22px; font-size:17px; }
    .search { position:relative; background:var(--eu-surface); border:1px solid var(--eu-line); border-radius:22px; padding:22px; }
    .search label { display: block; font-weight: 600; margin-bottom: 6px; font-size:17px; }
    .search-row { display: flex; gap: 6px; }
    .search button,.retry { font: inherit; padding: 8px 14px; border: 1px solid #166534; border-radius: 10px;
      font-weight: 600; background: #166534; color: white; cursor: pointer; }
    .retry { background: white; color: var(--c-brand-dark); margin-top: 6px; }
    .search input { width: 100%; min-width: 0; padding: 12px; font-size: 17px; border: 2px solid #697586;
      border-radius: 12px; background: var(--c-surface); color: var(--c-text); }
    .search input:focus { outline: none; border-color: var(--c-brand); }
    .sugs { list-style: none; margin: 6px 0 0; padding: 6px; position: absolute; left: 0; right: 0;
      background: var(--c-surface); border: 1px solid var(--c-border); border-radius: 12px;
      box-shadow: var(--c-shadow); max-height: 320px; overflow-y: auto; z-index: 10; }
    .sugs li { margin: 0; }
    .sugs a { display: block; padding: 10px 12px; border-radius: 8px;
      text-decoration: none; color: var(--c-text); font-size: 15px; }
    .sugs a small { display: block; color: var(--c-muted); font-size: 12px; }
    .sugs a:hover, .sugs a.active { background: var(--c-brand-soft); }
    .hint { font-size: 14px; color: var(--c-muted); margin: 8px 0 0; }
    .hint:empty { margin: 0; }
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
  ${mastheadHtml('farmacias', { compact: true, hideMunicipioSearch: true })}

  <main>
    <h1>Farmacia de guardia en España</h1>
    <p class="lead">Busca los turnos publicados para tu municipio o consulta el colegio de tu provincia.</p>

    <form class="search" id="busca-guardias" role="search" action="/farmacias/buscar" method="get">
      <label for="q">¿En qué municipio?</label>
      <div class="search-row">
        <input id="q" type="search" name="q" minlength="2" maxlength="70" required autocomplete="off"
          autocapitalize="off" spellcheck="false" placeholder="Cuéllar, Utrera, Gijón…" />
        <button type="submit">Buscar</button>
      </div>
      <ul id="sugs" class="sugs" role="listbox" aria-label="Municipios" hidden></ul>
    </form>
    <p class="hint" id="q-estado" role="status"></p>
    <button class="retry" id="q-reintentar" type="button" hidden>Reintentar sugerencias</button>

    <div class="browse">
      <a href="/farmacias/guardia">O consulta provincia por provincia &rarr;</a>
    </div>

    <p class="aviso">Los turnos los publica cada Colegio Oficial de Farmacéuticos y pueden cambiar.
      Algunas farmacias de guardia atienden a puerta cerrada: llama al timbre. Si vas a desplazarte,
      confirma antes por teléfono. En una urgencia grave, llama al 112.</p>
  </main>

  <footer>
    <div>Datos de los Colegios Oficiales de Farmacéuticos · <a href="/">España Útil</a> · <a href="/privacidad">Privacidad</a> · v${APP_VERSION}</div>
  </footer>

  <script nonce="${nonce}">
  (function () {
    var form = document.getElementById('busca-guardias');
    var input = document.getElementById('q');
    var box = document.getElementById('sugs');
    var status = document.getElementById('q-estado');
    var retry = document.getElementById('q-reintentar');
    var estado = 'inicial';
    var municipios = [], provincias = [], mostrados = [];
    var activo = -1;
    var sugerir = false;

    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', box.id);

    function norm(s) {
      return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '');
    }
    var aliasProvincias = {
      'guipuzcoa': 'gipuzkoa', 'alava': 'araba', 'bizkaia': 'vizcaya',
      'girona': 'gerona', 'lleida': 'lerida', 'ourense': 'orense',
      'a coruna': 'la coruna coruna', 'islas baleares': 'illes balears baleares',
      'santa cruz de tenerife': 'tenerife', 'navarra': 'nafarroa',
      'alicante': 'alacant', 'castellon': 'castello'
    };
    function cerrar() {
      box.hidden = true;
      box.replaceChildren();
      mostrados = [];
      activo = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function render() {
      cerrar();
      var q = norm(input.value);
      if (q.length < 2) { status.textContent = ''; return; }
      if (estado === 'error') {
        status.textContent = 'No se han cargado las sugerencias. Puedes pulsar Buscar o reintentarlo.';
        return;
      }
      if (estado !== 'listo') { status.textContent = 'Buscando sugerencias…'; return; }
      var exactos = municipios.filter(function(m) { return m.clave === q; });
      var porProvincia = provincias.filter(function(p) { return p.clave.includes(q); }).slice(0, 3);
      var otros = municipios.filter(function(m) { return m.clave !== q && m.clave.includes(q); });
      mostrados = exactos.concat(porProvincia, otros).slice(0, 12);
      if (!mostrados.length) {
        status.textContent = 'Pulsa Buscar para consultar ese municipio en el directorio.';
        return;
      }
      mostrados.forEach(function(m, i) {
        var item = document.createElement('li');
        item.setAttribute('role', 'none');
        var enlace = document.createElement('a');
        enlace.href = m.u;
        enlace.id = 'g-sug-' + i;
        enlace.tabIndex = -1;
        enlace.setAttribute('role', 'option');
        enlace.setAttribute('aria-selected', 'false');
        enlace.textContent = m.n;
        var detalle = document.createElement('small');
        detalle.textContent = m.p;
        enlace.appendChild(detalle);
        item.appendChild(enlace);
        box.appendChild(item);
      });
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      status.textContent = mostrados.length === 1 ? 'Una sugerencia.' : mostrados.length + ' sugerencias.';
    }
    function cargar() {
      if (estado === 'cargando' || estado === 'listo') return;
      estado = 'cargando';
      retry.hidden = true;
      render();
      fetch('/api/guardias/municipios', { credentials: 'same-origin' })
        .then(function(r) { if (!r.ok) throw Error(); return r.json(); })
        .then(function(filas) {
          if (!Array.isArray(filas) || !filas.length) throw Error();
          var zonas = new Map(), pueblos = [];
          filas.forEach(function(m) {
            if (!m || typeof m.n !== 'string' || typeof m.p !== 'string' || typeof m.u !== 'string') return;
            var ruta = m.u.match(/^\\/farmacias\\/([a-z0-9-]+)(?:\\/[a-z0-9-]+)?$/);
            if (!ruta) return;
            var urlProvincia = '/farmacias/' + ruta[1];
            var nombre = norm(m.p);
            zonas.set(urlProvincia, { n: 'Toda la provincia: ' + m.p, p: ruta[1] === 'lugo' ? 'Consultar el colegio' : 'Ver la provincia',
              u: urlProvincia, clave: nombre + ' ' + (aliasProvincias[nombre] || '') });
            if (m.u !== urlProvincia) pueblos.push({ n: m.n, p: m.p, u: m.u, clave: norm(m.n) });
          });
          if (!zonas.size) throw Error();
          municipios = pueblos;
          provincias = Array.from(zonas.values());
          estado = 'listo';
          if (sugerir && document.activeElement === input) render();
        })
        .catch(function() {
          estado = 'error';
          if (sugerir && document.activeElement === input) { retry.hidden = false; render(); }
        });
    }
    input.addEventListener('focus', function() {
      sugerir = true;
      if (estado === 'inicial') cargar();
      else { retry.hidden = estado !== 'error'; render(); }
    });
    input.addEventListener('input', function() { sugerir = true; retry.hidden = estado !== 'error'; render(); });
    retry.addEventListener('click', function() { input.focus(); cargar(); });
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (!box.hidden) e.preventDefault();
        sugerir = false; cerrar(); status.textContent = ''; return;
      }
      if (e.key === 'ArrowDown' && box.hidden && estado === 'listo') { sugerir = true; render(); }
      if (box.hidden || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
      e.preventDefault();
      activo = Math.max(0, Math.min(mostrados.length - 1, activo + (e.key === 'ArrowDown' ? 1 : -1)));
      var enlaces = box.querySelectorAll('a');
      enlaces.forEach(function(a, i) {
        a.classList.toggle('active', i === activo);
        a.setAttribute('aria-selected', String(i === activo));
      });
      input.setAttribute('aria-activedescendant', enlaces[activo].id);
      enlaces[activo].scrollIntoView({ block: 'nearest' });
    });
    form.addEventListener('submit', function(e) {
      // Sin elección explícita, el directorio completo distingue también los pueblos
      // con el mismo nombre que hoy no tienen ningún turno en las sugerencias.
      var eleccion = mostrados[activo];
      if (eleccion) { e.preventDefault(); window.location.assign(eleccion.u); }
    });
    document.addEventListener('click', function(e) {
      if (!form.contains(e.target) && e.target !== retry) cerrar();
    });
    form.addEventListener('focusout', function(e) {
      if (e.relatedTarget && !form.contains(e.relatedTarget)) cerrar();
    });
  })();
  </script>
</body>
</html>`
}

// CSP de /farmacias/: consultas en el mismo origen y acceso de Google
// compartido, conservando los nonce sin habilitar mapas o imágenes externas.
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

  return withAccountHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  })
}
