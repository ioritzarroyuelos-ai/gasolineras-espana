// Paginas del vertical "el tiempo": indice nacional, provincia y municipio.
// Renderizado entero en servidor (como ITV/farmacias), en verde de marca.
// El dato viene de AEMET (o de Open-Meteo como suplente); el modelo normalizado
// esta en scripts/lib/tiempo.mjs (Prediccion). Ver
// docs/superpowers/specs/2026-09-06-tiempo-aemet-design.md.

import type { Prediccion, Frescura, MunicipioLista } from '../../scripts/lib/tiempo.mjs'
import { APP_VERSION } from '../lib/version'

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Verde de marca CercaYa (mismo que gasolineras/farmacias/ITV).
const CSS =
  ':root{--v:#16a34a;--vd:#166534;--tx:#1e293b;--mu:#64748b;--bd:#e2e8f0;--bg:#f8fafc}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.5}'
  + 'header{background:linear-gradient(135deg,#166534,#16a34a);color:#fff;padding:14px 18px}'
  + 'header a{color:#fff;text-decoration:none;font-weight:600}'
  + 'main{max-width:760px;margin:0 auto;padding:18px}'
  + 'h1{font-size:24px;line-height:1.25;margin:0 0 6px}'
  + 'h2{font-size:17px;margin:26px 0 10px}'
  + '.sub{color:var(--mu);font-size:14px;margin:0 0 18px}'
  + '.aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:18px 0;background:var(--bg)}'
  + '.aviso--warn{border-left-color:#d97706;color:#92400e;background:#fffbeb}'
  + '.fuente{font-size:12.5px;color:var(--mu);margin:0 0 14px}'
  + '.lista ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
  + '.lista li a{display:inline-block;padding:5px 10px;border:1px solid var(--bd);border-radius:999px;'
  + 'font-size:13px;color:var(--vd);text-decoration:none;background:#fff}'
  // Buscador (mismo patron que /farmacias/ e /itv/).
  + '.buscador{margin:0 0 22px}'
  + '.buscador label{display:block;font-weight:600;margin:0 0 6px;font-size:15px}'
  + '.buscador .campo{position:relative}'
  + '.buscador input{width:100%;padding:13px 15px;font-size:16px;border:2px solid var(--bd);border-radius:10px;background:#fff;color:var(--tx)}'
  + '.buscador input:focus{outline:none;border-color:var(--v)}'
  + '.sugs{list-style:none;margin:6px 0 0;padding:6px;position:absolute;left:0;right:0;background:#fff;border:1px solid var(--bd);border-radius:10px;box-shadow:0 4px 12px rgba(15,23,42,.08);max-height:300px;overflow-y:auto;z-index:10}'
  + '.sugs li{margin:0}'
  + '.sugs a,.sugs .sug-msg{display:block;padding:9px 11px;border-radius:7px;text-decoration:none;color:var(--tx);font-size:15px}'
  + '.sugs a small{display:block;color:var(--mu);font-size:12px}'
  + '.sugs a:hover,.sugs a.active{background:#dcfce7}'
  + '.sug-msg{color:var(--mu);font-size:14px}'
  + '.hint{font-size:13px;color:var(--mu);margin:8px 0 18px}'
  // Tarjetas de prediccion por dia.
  + '.dias{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin:0 0 8px}'
  + '.dia{border:1px solid var(--bd);border-radius:10px;padding:12px 14px;background:var(--bg)}'
  + '.dia-fecha{font-size:13px;font-weight:600;text-transform:capitalize}'
  + '.dia-cielo{font-size:13px;color:var(--mu);margin:2px 0 8px;min-height:34px}'
  + '.dia-temp{font-size:15px}'
  + '.dia-temp .max{font-weight:700;color:var(--vd)}'
  + '.dia-temp .min{color:var(--mu)}'
  + '.dia-extra{font-size:12.5px;color:var(--mu);margin-top:6px}'
  + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
  + 'footer a{color:var(--vd)}'
  + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
  + '.dia,.aviso{background:#1e293b;border-color:#334155}'
  + '.aviso--warn{background:#3a2a0a;border-left-color:#f59e0b;color:#fcd34d}'
  + '.buscador input{background:#0f172a;color:#e2e8f0;border-color:#334155}'
  + '.sugs{background:#1e293b;border-color:#334155}'
  + '.sugs a,.sugs .sug-msg{color:#e2e8f0}'
  + '.sugs a:hover,.sugs a.active{background:#166534}'
  + '.dia-temp .max{color:#86efac}'
  + '.lista li a{background:#0f172a;color:#86efac;border-color:#334155}}'

interface Meta { title: string; desc: string; canonical: string; nonce: string; noindex?: boolean; jsonLd?: string }

function envoltorio(m: Meta, cuerpo: string): string {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(m.title) + '</title>'
    + '<meta name="description" content="' + esc(m.desc) + '" />'
    + '<link rel="canonical" href="' + esc(m.canonical) + '" />'
    + (m.noindex ? '<meta name="robots" content="noindex,follow" />' : '')
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(m.title) + '" />'
    + '<meta property="og:description" content="' + esc(m.desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(m.canonical) + '" />'
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + (m.jsonLd ? '<script type="application/ld+json" nonce="' + esc(m.nonce) + '">' + m.jsonLd + '</script>' : '')
    + '<style nonce="' + esc(m.nonce) + '">' + CSS + '</style></head><body>'
    + '<header><a href="/">CercaYa</a></header><main>'
    + cuerpo
    + '</main><footer>Datos de AEMET (Agencia Estatal de Meteorología). '
    + '<a href="/">CercaYa</a> &middot; <a href="/privacidad">Privacidad</a> &middot; v' + esc(APP_VERSION) + '</footer>'
    + '</body></html>'
}

// Script del buscador (autocompletado contra /api/tiempo/municipios). Misma lógica
// probada que /farmacias/ e /itv/.
function scriptBuscador(nonce: string): string {
  return `<script nonce="${esc(nonce)}">
  (function () {
    var input = document.getElementById('q'); var box = document.getElementById('sugs');
    var muni = [], loaded = false, active = -1, shown = [];
    function norm(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,''); }
    function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
    function cerrar(){ box.hidden=true; box.innerHTML=''; active=-1; shown=[]; input.setAttribute('aria-expanded','false'); }
    function msg(t){ box.innerHTML='<li><span class="sug-msg">'+esc(t)+'</span></li>'; box.hidden=false; shown=[]; active=-1; input.setAttribute('aria-expanded','true'); }
    function render(q){
      var nq=norm(q); if(nq.length<2){cerrar();return;}
      if(!loaded){msg('Cargando municipios\\u2026');return;}
      var res=[]; for(var i=0;i<muni.length&&res.length<12;i++){ if(norm(muni[i].n).indexOf(nq)>=0) res.push(muni[i]); }
      shown=res; active=-1;
      if(res.length===0){msg('No encontramos ese municipio. Prueba con otro o mira por provincia.');return;}
      var html=''; for(var j=0;j<res.length;j++){ html+='<li role="option"><a href="'+esc(res[j].u)+'">'+esc(res[j].n)+'<small>'+esc(res[j].p)+'</small></a></li>'; }
      box.innerHTML=html; box.hidden=false; input.setAttribute('aria-expanded','true');
    }
    function marcar(idx){ var a=box.querySelectorAll('a'); for(var i=0;i<a.length;i++)a[i].classList.toggle('active',i===idx); if(idx>=0&&a[idx])a[idx].scrollIntoView({block:'nearest'}); }
    function ir(idx){ if(idx>=0&&shown[idx]){window.location.href=shown[idx].u;return true;} return false; }
    function cargar(){ if(loaded)return;
      fetch('/api/tiempo/municipios',{credentials:'same-origin'}).then(function(r){return r.ok?r.json():[];})
        .then(function(d){ muni=Array.isArray(d)?d:(d&&d.municipios)||[]; loaded=true; if(norm(input.value).length>=2)render(input.value); })
        .catch(function(){ loaded=true; msg('No se pudo cargar el listado. Consulta por provincia.'); });
    }
    input.addEventListener('focus',cargar);
    input.addEventListener('input',function(){ cargar(); render(input.value); });
    input.addEventListener('keydown',function(e){
      if(box.hidden||shown.length===0){ if(e.key==='Enter'){e.preventDefault();} return; }
      if(e.key==='ArrowDown'){e.preventDefault();active=Math.min(active+1,shown.length-1);marcar(active);}
      else if(e.key==='ArrowUp'){e.preventDefault();active=Math.max(active-1,0);marcar(active);}
      else if(e.key==='Enter'){e.preventDefault(); if(!ir(active))ir(0);}
      else if(e.key==='Escape'){cerrar();}
    });
    document.addEventListener('click',function(e){ if(e.target!==input&&!box.contains(e.target))cerrar(); });
  })();
  </script>`
}

const CAJA_BUSCADOR =
  '<div class="buscador">'
  + '<label for="q">Busca tu municipio</label>'
  + '<div class="campo">'
  + '<input id="q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" '
  + 'placeholder="Escribe tu municipio…" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugs" />'
  + '<ul id="sugs" class="sugs" role="listbox" aria-label="Municipios" hidden></ul>'
  + '</div>'
  + '<p class="hint">Escribe tu municipio y te llevamos a su predicción. O mira la lista por provincia más abajo.</p>'
  + '</div>'

// ---- Indice nacional: /tiempo/ ----
export function buildTiempoIndexPage(
  nonce: string,
  provincias: Array<{ slug: string; name: string }>,
  canonical: string,
): string {
  const title = 'El tiempo en España por municipios | CercaYa'
  const desc = 'Predicción del tiempo por municipio en España: temperaturas, cielo, '
    + 'probabilidad de lluvia y viento. Datos oficiales de AEMET.'
  const lista = provincias.map(p =>
    '<li><a href="/tiempo/' + esc(p.slug) + '">' + esc(p.name) + '</a></li>'
  ).join('')
  return envoltorio({ title, desc, canonical, nonce },
    '<h1>El tiempo en España</h1>'
    + '<p class="sub">Predicción por municipio, con datos de AEMET</p>'
    + CAJA_BUSCADOR
    + '<h2>Provincias</h2>'
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + scriptBuscador(nonce),
  )
}

// ---- Provincia: /tiempo/:provincia ----
export function buildTiempoProvinciaPage(
  nonce: string,
  d: { provinciaSlug: string; provinciaName: string; municipios: Array<{ slug: string; nombre: string }>; canonical: string },
): string {
  const title = 'El tiempo en ' + d.provinciaName + ' por municipios | CercaYa'
  const desc = 'Predicción del tiempo en los municipios de ' + d.provinciaName
    + ': temperaturas, cielo, lluvia y viento. Datos de AEMET.'
  const lista = d.municipios.map(m =>
    '<li><a href="/tiempo/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.nombre) + '</a></li>'
  ).join('')
  return envoltorio({ title, desc, canonical: d.canonical, nonce },
    '<h1>El tiempo en ' + esc(d.provinciaName) + '</h1>'
    + '<p class="sub">' + d.municipios.length + ' municipios</p>'
    + CAJA_BUSCADOR
    + '<h2>Municipios</h2>'
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + scriptBuscador(nonce),
  )
}

const DIAS_SEMANA = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
function fechaCorta(iso: string, i: number): string {
  if (i === 0) return 'Hoy'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return esc(iso)
  return DIAS_SEMANA[d.getDay()] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()]
}
function horaHHMM(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

// ---- Municipio: /tiempo/:provincia/:municipio ----
export function buildTiempoMunicipioPage(
  nonce: string,
  d: { pred: Prediccion; frescura: Frescura; provinciaSlug: string; canonical: string },
): string {
  const { pred, frescura } = d
  const title = 'El tiempo en ' + pred.nombre + ' (' + pred.provincia + ') | CercaYa'
  const hoy = pred.dias[0]
  const desc = hoy
    ? 'Predicción del tiempo en ' + pred.nombre + ': hoy ' + (hoy.tmin ?? '?') + '° / ' + (hoy.tmax ?? '?') + '°, '
      + (hoy.cielo || '').toLowerCase() + '. Próximos días, con datos de AEMET.'
    : 'Predicción del tiempo en ' + pred.nombre + ', con datos de AEMET.'

  const cards = pred.dias.map((dia, i) =>
    '<div class="dia">'
    + '<div class="dia-fecha">' + esc(fechaCorta(dia.fecha, i)) + '</div>'
    + '<div class="dia-cielo">' + esc(dia.cielo || '') + '</div>'
    + '<div class="dia-temp"><span class="max">' + (dia.tmax != null ? dia.tmax + '°' : '--') + '</span> '
    + '<span class="min">' + (dia.tmin != null ? dia.tmin + '°' : '--') + '</span></div>'
    + '<div class="dia-extra">'
    + (dia.probLluvia != null ? '💧 ' + dia.probLluvia + '% ' : '')
    + (dia.viento != null ? '· 💨 ' + dia.viento + ' km/h' : '')
    + '</div>'
    + '</div>'
  ).join('')

  // Sello de fuente + frescura (honesto: si es Open-Meteo, se dice).
  const fuenteTxt = pred.fuente === 'AEMET'
    ? 'Datos de AEMET · actualizado a las ' + horaHHMM(pred.elaborado)
    : 'Datos de Open-Meteo · AEMET no disponible temporalmente'
  const avisoCaducado = !frescura.fiable
    ? '<p class="aviso aviso--warn">⚠️ Esta predicción puede no estar actualizada '
      + '(último dato de hace ' + Math.round(frescura.horas) + " h). Compruébala en aemet.es.</p>"
    : ''

  return envoltorio({
    title, desc, canonical: d.canonical, nonce,
    noindex: !frescura.fiable,  // no indexar predicciones caducadas
  },
    '<h1>El tiempo en ' + esc(pred.nombre) + '</h1>'
    + '<p class="sub">' + esc(pred.provincia) + ' · próximos ' + pred.dias.length + ' días</p>'
    + '<p class="fuente">' + esc(fuenteTxt) + '</p>'
    + avisoCaducado
    + '<div class="dias">' + cards + '</div>'
    + '<p><a href="/tiempo/' + esc(d.provinciaSlug) + '">← El tiempo en toda la provincia</a></p>'
    + '<p class="aviso">La predicción meteorológica puede cambiar. Ante fenómenos adversos, '
    + 'consulta los avisos oficiales en aemet.es o llama al 112.</p>',
  )
}

// Headers de /tiempo/*. CSP estricta: sin mapa ni CDNs; solo la llamada a
// /api/tiempo/municipios (mismo origen -> connect-src 'self').
export function tiempoHeaders(nonce: string): Record<string, string> {
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
  ].join('; ')
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': csp,
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // El tiempo cambia durante el día: cache corta en CDN.
    'Cache-Control': 'public, max-age=1800, s-maxage=1800',
  }
}

// Tipo re-exportado por comodidad de los handlers.
export type { MunicipioLista }
