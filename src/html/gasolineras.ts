// Portada /gasolineras/ — buscador primero, mapa despues.
//
// Historia: /gasolineras/ era la SPA del mapa nacional. Por decision del usuario
// (sept 2026) la portada pasa a ser una pagina ligera "buscador primero": eliges
// tu municipio (autocompletado) y te lleva a su pagina (SSR, con mapa y precios);
// tienes ademas "usar mi ubicacion", que geolocaliza en el navegador y abre la
// mapa de estaciones cercanas. (El mapa completo sigue en /gasolineras/mapa,
// accesible desde las fichas de municipio.) Beneficio SEO: la portada gana contenido
// crawleable (precios medios + enlaces a las 52 provincias) y las paginas de
// municipio/provincia siguen siendo las que posicionan.

import { APP_VERSION } from '../lib/version'
import { withAccountHeaders } from '../lib/runtime'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { PORTAL_BASE_CSS } from './ui-theme'
import { jsonLdScript } from './html'   // S2: JSON-LD blindado (< → <)

export interface GasLandingProvincia { slug: string; name: string; count: number }

export interface GasLandingData {
  // Stats de precios nacionales para el bloque SEO. Keys: '95','98','diesel','diesel_plus'.
  stats?: Record<string, { min: number; avg: number; max: number; count: number }>
  stationCount?: number
  provincias?: GasLandingProvincia[]
  snapshotDate?: string
}

const FUEL_LABEL: Record<string, string> = {
  '95': 'Gasolina 95',
  '98': 'Gasolina 98',
  'diesel': 'Diésel (Gasóleo A)',
  'diesel_plus': 'Diésel Premium',
}

export function buildGasolinerasLanding(
  nonce: string = '',
  reqUrl: string = 'https://webapp-3ft.pages.dev/gasolineras/',
  data: GasLandingData = {},
): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }

  const canonical = origin + '/gasolineras/'
  const title = 'Gasolineras baratas en España · Precios oficiales | España Útil'
  const stats95 = data.stats?.['95']
  const desc = stats95 && stats95.count >= 3
    ? 'Encuentra la gasolinera más barata cerca de ti. Gasolina 95 desde '
      + stats95.min.toFixed(3) + '€ (media ' + stats95.avg.toFixed(3) + '€). '
      + 'Busca por municipio o usa tu ubicación. Datos oficiales del Ministerio.'
    : 'Encuentra la gasolinera más barata cerca de ti: busca por municipio o usa tu ubicación. '
      + 'Precios oficiales del Ministerio.'

  const esc = (s: string): string => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

  // JSON-LD: WebSite + Dataset con los precios nacionales (variableMeasured).
  const fuelReadable: Record<string, string> = {
    '95': 'Gasolina 95 E5', '98': 'Gasolina 98 E5',
    'diesel': 'Gasóleo A', 'diesel_plus': 'Gasóleo Premium',
  }
  const variableMeasured = data.stats
    ? Object.keys(data.stats).map(fc => {
        const s = data.stats![fc]
        return {
          '@type': 'PropertyValue', name: fuelReadable[fc] || fc,
          unitCode: 'LTR', unitText: '€/L',
          minValue: s.min.toFixed(3), maxValue: s.max.toFixed(3), value: s.avg.toFixed(3),
        }
      })
    : undefined
  const jsonLd = [
    {
      '@context': 'https://schema.org', '@type': 'WebSite', name: 'España Útil', url: origin,
    },
    {
      '@context': 'https://schema.org', '@type': 'Dataset',
      name: 'Precios de carburantes en España',
      description: 'Snapshot oficial de precios de estaciones de servicio terrestres en España.',
      license: 'https://datos.gob.es/es/catalogo/e05068001-precio-de-carburantes-en-las-gasolineras-espanolas',
      creator: { '@type': 'GovernmentOrganization', name: 'Ministerio para la Transición Ecológica y el Reto Demográfico' },
      spatialCoverage: { '@type': 'Place', name: 'España' },
      inLanguage: 'es', variableMeasured,
    },
  ]

  // Bloque de precios medios nacionales (contenido SEO visible).
  const orderFuels = ['95', '98', 'diesel', 'diesel_plus']
  const preciosCards = orderFuels
    .filter(fc => data.stats?.[fc])
    .map(fc => {
      const s = data.stats![fc]
      return '<div class="pcard">'
        + '<div class="pcard-fuel">' + esc(FUEL_LABEL[fc]) + '</div>'
        + '<div class="pcard-avg">' + s.avg.toFixed(3) + ' €/L</div>'
        + '<div class="pcard-range">de ' + s.min.toFixed(3) + '€ a ' + s.max.toFixed(3) + '€</div>'
        + '</div>'
    }).join('')

  const provincias = data.provincias || []
  const provLinks = provincias.map(p =>
    '<li><a href="/gasolineras/' + esc(p.slug) + '">' + esc(p.name)
      + (p.count ? ' <b>' + p.count + '</b>' : '') + '</a></li>'
  ).join('')

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
  <meta name="robots" content="index,follow,max-image-preview:large" />

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
  <meta name="twitter:image" content="${esc(origin)}/static/og.png" />

  <meta name="generator" content="España Útil v${APP_VERSION}" />
  ${jsonLdScript(jsonLd, nonce)}

  <style nonce="${nonce}">
    ${PORTAL_BASE_CSS}
    :root {
      color-scheme:light;
      --c-surface:#fff; --c-text:var(--eu-ink); --c-muted:var(--eu-muted);
      --c-brand-dark:var(--eu-accent); --c-brand:var(--eu-accent); --c-brand-soft:var(--eu-soft);
      --c-border:var(--eu-line); --c-shadow:0 4px 12px rgba(15,23,42,.06);
    }
    ${MASTHEAD_CSS}
    main { max-width:1000px; margin:0 auto; padding:24px 18px 40px; }
    h1 { font-size:clamp(30px,4.5vw,48px); line-height:1.12; margin:8px 0 6px; }
    h2 { font-size:19px; margin:30px 0 12px; }
    .lead { color:var(--c-muted); margin:0 0 22px; font-size:17px; }
    .search { position:relative; background:var(--eu-surface); border:1px solid var(--eu-line); border-radius:22px; padding:22px; }
    .search label { display:block; font-weight:600; margin-bottom:6px; font-size:17px; }
    .search input { width:100%; padding:14px 16px; font-size:17px; border:2px solid var(--c-border);
      border-radius:12px; background:var(--c-surface); color:var(--c-text); }
    .search input:focus { outline:none; border-color:var(--c-brand); }
    .sugs { list-style:none; margin:6px 0 0; padding:6px; position:absolute; left:0; right:0;
      background:var(--c-surface); border:1px solid var(--c-border); border-radius:12px;
      box-shadow:var(--c-shadow); max-height:320px; overflow-y:auto; z-index:10; }
    .sugs li { margin:0; }
    .sugs a, .sugs .sug-msg { display:block; padding:10px 12px; border-radius:8px;
      text-decoration:none; color:var(--c-text); font-size:15px; }
    .sugs a small { display:block; color:var(--c-muted); font-size:12px; }
    .sugs a:hover, .sugs a.active { background:var(--c-brand-soft); }
    .sug-msg { color:var(--c-muted); font-size:14px; }
    .hint { font-size:13px; color:var(--c-muted); margin:10px 0 0; }
    .acciones { display:flex; flex-wrap:wrap; gap:10px; margin:18px 0 0; }
    .acciones button { display:inline-flex; align-items:center; gap:8px; padding:12px 16px;
      border-radius:10px; font-weight:600; font-size:15px; border:none; cursor:pointer;
      font-family:inherit; }
    .acciones .a-primary { background:var(--eu-accent); color:#fff; }
    .acciones .a-primary:disabled { opacity:.6; cursor:default; }
    .geo-status { color:var(--c-muted); font-size:13px; margin:8px 0 0; }
    .geo-status.err { color:#b91c1c; }
    .precios { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
    .pcard { border:1px solid var(--c-border); border-radius:22px; padding:22px 20px; background:var(--c-surface); }
    .pcard-fuel { font-size:13px; color:var(--c-muted); }
    .pcard-avg { font-size:30px; font-weight:700; color:var(--c-brand-dark); margin:2px 0; }
    .pcard-range { font-size:12px; color:var(--c-muted); }
    .provincias ul { list-style:none; padding:0; margin:0; display:flex; flex-wrap:wrap; gap:6px; }
    .provincias li a { display:inline-block; padding:6px 11px; border:1px solid var(--c-border);
      border-radius:999px; font-size:13px; color:var(--c-brand-dark); text-decoration:none; background:var(--c-surface); }
    .provincias li a b { font-weight:600; color:var(--c-muted); font-size:12px; }
    .prosa { color:var(--c-muted); font-size:14px; }
    .prosa p { margin:0 0 10px; }
    footer { border-top:1px solid var(--c-border); margin-top:34px; padding:18px;
      text-align:center; color:var(--c-muted); font-size:13px; }
    footer a { color:var(--c-brand-dark); }
  </style>
</head>
<body>
  ${mastheadHtml('gasolineras', { compact: true, hideMunicipioSearch: true })}

  <main>
    <h1>Gasolineras baratas en España</h1>
    <p class="lead">Busca tu municipio y te llevamos a las gasolineras de tu zona con los precios
      oficiales, actualizados a diario.</p>

    <div class="search">
      <label for="q">¿En qué municipio?</label>
      <input id="q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false"
        placeholder="Madrid, Alcorcón, Getafe..."
        role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugs" />
      <ul id="sugs" class="sugs" role="listbox" aria-label="Municipios" hidden></ul>
    </div>
    <p class="hint">Empieza a escribir el nombre de tu municipio.</p>

    <div class="acciones" id="cerca-de-mi">
      <button type="button" id="btn-geoloc" class="a-primary">📍 Usar mi ubicación</button>
    </div>
    <p id="geo-status" class="geo-status" role="status" aria-live="polite" hidden></p>

    ${preciosCards ? `<h2>Precio medio del combustible en España</h2>
    <p class="hint">${data.snapshotDate ? 'Datos del Ministerio: ' + esc(data.snapshotDate) + ' (hora peninsular).' : 'Fecha de los precios no disponible.'}</p>
    <div class="precios">${preciosCards}</div>` : ''}

    ${provLinks ? `<h2>Gasolineras por provincia</h2>
    <nav class="provincias"><ul>${provLinks}</ul></nav>` : ''}

    <h2>Cómo encontrar la gasolinera más barata</h2>
    <div class="prosa">
      <p>Escribe tu municipio en el buscador y te llevamos a su página, con el mapa de estaciones
        y el precio de cada combustible. Si estás de viaje, usa <b>tu ubicación</b> y te llevamos
        directamente a las gasolineras de tu zona.</p>
      <p>Los precios proceden del Ministerio para la Transición Ecológica y se actualizan a diario.
        Pueden variar durante el día: confirma en la propia estación antes de repostar.</p>
    </div>
  </main>

  <footer>
    <div>Datos oficiales del Ministerio para la Transición Ecológica ·
      <a href="/">España Útil</a> · <a href="/privacidad">Privacidad</a> · v${APP_VERSION}</div>
  </footer>

  <script nonce="${nonce}">
  (function () {
    var input = document.getElementById('q');
    var box = document.getElementById('sugs');
    var muni = [];
    var loaded = false;
    var loading = false;
    var active = -1;
    var shown = [];
    function norm(s) { return String(s || '').trim().toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function cerrar() { box.hidden = true; box.innerHTML = ''; active = -1; shown = []; input.setAttribute('aria-expanded', 'false'); }
    function msg(t) { box.innerHTML = '<li><span class="sug-msg">' + esc(t) + '</span></li>'; box.hidden = false; shown = []; active = -1; input.setAttribute('aria-expanded', 'true'); }
    function render(q) {
      var nq = norm(q);
      if (nq.length < 2) { cerrar(); return; }
      if (!loaded) { msg('Cargando municipios\\u2026'); return; }
      var res = muni.filter(function (m) { return norm(m.n).indexOf(nq) >= 0; });
      res.sort(function (a, b) {
        var an = norm(a.n), bn = norm(b.n);
        var ar = an === nq ? 0 : an.indexOf(nq) === 0 ? 1 : 2;
        var br = bn === nq ? 0 : bn.indexOf(nq) === 0 ? 1 : 2;
        return ar - br || a.n.localeCompare(b.n, 'es');
      });
      res = res.slice(0, 12);
      shown = res; active = -1;
      if (res.length === 0) { msg('No encontramos ese municipio. Prueba con otro nombre o mira por provincia.'); return; }
      var html = '';
      for (var j = 0; j < res.length; j++) {
        html += '<li role="option"><a href="' + esc(res[j].u) + '">' + esc(res[j].n) + '<small>' + esc(res[j].p) + '</small></a></li>';
      }
      box.innerHTML = html; box.hidden = false; input.setAttribute('aria-expanded', 'true');
    }
    function marcar(idx) {
      var links = box.querySelectorAll('a');
      for (var i = 0; i < links.length; i++) links[i].classList.toggle('active', i === idx);
      if (idx >= 0 && links[idx]) links[idx].scrollIntoView({ block: 'nearest' });
    }
    function ir(idx) { if (idx >= 0 && shown[idx]) { window.location.href = shown[idx].u; return true; } return false; }
    function cargar() {
      if (loaded || loading) return;
      loading = true;
      fetch('/api/gasolineras/municipios', { credentials: 'same-origin' })
        .then(function (r) { if (!r.ok) throw new Error('municipios'); return r.json(); })
        .then(function (data) {
          if (!Array.isArray(data) || !data.length) throw new Error('municipios');
          muni = data;
          loaded = true;
          loading = false;
          if (norm(input.value).length >= 2) render(input.value);
        })
        .catch(function () {
          loading = false;
          msg('No se pudo cargar el listado. Vuelve a escribir para reintentar o consulta por provincia.');
        });
    }
    input.addEventListener('focus', cargar);
    input.addEventListener('input', function () { cargar(); render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden || shown.length === 0) { if (e.key === 'Enter') { e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); marcar(active); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); marcar(active); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!ir(active)) ir(0); }
      else if (e.key === 'Escape') { cerrar(); }
    });
    document.addEventListener('click', function (e) { if (e.target !== input && !box.contains(e.target)) cerrar(); });

    // El fragmento permanece en el navegador: las coordenadas no se envían
    // al servidor. El mapa busca en todas las estaciones, incluso si hay una
    // provincia limítrofe más cerca que las estaciones del propio municipio.
    var geoBtn = document.getElementById('btn-geoloc');
    var geoStatus = document.getElementById('geo-status');
    function setGeoStatus(t, isErr) {
      if (!geoStatus) return;
      geoStatus.textContent = t || '';
      geoStatus.hidden = !t;
      geoStatus.classList.toggle('err', !!isErr);
    }
    function resetGeoBtn() { if (geoBtn) { geoBtn.disabled = false; geoBtn.textContent = '📍 Usar mi ubicación'; } }
    if (geoBtn) {
      geoBtn.addEventListener('click', function () {
        if (!navigator.geolocation) { setGeoStatus('Tu navegador no permite geolocalización. Usa el buscador.', true); return; }
        geoBtn.disabled = true;
        geoBtn.textContent = '📍 Localizando…';
        setGeoStatus('Pidiendo tu ubicación…');
        navigator.geolocation.getCurrentPosition(function (pos) {
          var lat = pos.coords.latitude, lng = pos.coords.longitude;
          if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
            setGeoStatus('No hemos podido obtener tu ubicación. Usa el buscador.', true);
            resetGeoBtn(); return;
          }
          setGeoStatus('Buscando gasolineras cerca de ti…');
          window.location.href = '/gasolineras/mapa#near=' + lat.toFixed(5) + ',' + lng.toFixed(5);
        }, function (err) {
          setGeoStatus(err && err.code === 1
            ? 'Has bloqueado el permiso de ubicación. Actívalo en el navegador o usa el buscador.'
            : 'No hemos podido obtener tu ubicación. Usa el buscador.', true);
          resetGeoBtn();
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
      });
    }
  })();
  </script>
</body>
</html>`
}

// CSP de la portada: búsqueda en el mismo origen y acceso de Google compartido.
// No necesita los permisos de mapas o imágenes externas del mapa interactivo.
export function gasolinerasLandingHeaders(nonce: string): Record<string, string> {
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
    // geolocation=(self): la portada usa navigator.geolocation en "usar mi ubicación".
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
  })
}
