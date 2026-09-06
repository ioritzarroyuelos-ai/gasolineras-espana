// Paginas SEO de estaciones de ITV: indice nacional, provincia y municipio.
//
// Se renderizan enteras en servidor, como las de farmacia de guardia: es lo que
// permite que Google indexe "ITV en <municipio>", que es la consulta con
// intencion real. A diferencia de aquellas, el dato aqui es estatico (las
// estaciones no cambian a diario), asi que la cache puede ser mucho mas larga.

import type { EstacionITV, MunicipioITV, ProvinciaITV } from '../lib/itv'
import { telHref, mapsHref } from '../lib/itv'
import {
  TARIFAS, LIBERALIZADAS, SIN_DATO, TASA_DGT, NOMBRE_IMPUESTO, desglosa,
  type Tarifa,
} from '../lib/itv-tarifas'

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const CSS =
  ':root{--v:#1d4ed8;--vd:#1e3a8a;--tx:#1e293b;--mu:#64748b;--bd:#e2e8f0;--bg:#f8fafc}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.5}'
  + 'header{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;padding:14px 18px}'
  + 'header a{color:#fff;text-decoration:none;font-weight:600}'
  + 'main{max-width:760px;margin:0 auto;padding:18px}'
  + 'h1{font-size:24px;line-height:1.25;margin:0 0 6px}'
  + 'h2{font-size:17px;margin:26px 0 10px}'
  + '.sub{color:var(--mu);font-size:14px;margin:0 0 18px}'
  + '.card{border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:12px;background:var(--bg)}'
  + '.dir{font-size:16px;margin:0 0 6px}'
  + '.meta{margin:0 0 10px;color:var(--mu);font-size:13px}'
  + '.acciones{display:flex;gap:8px;flex-wrap:wrap}'
  + '.btn{display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);'
  + 'background:#fff;color:var(--vd);text-decoration:none;font-size:14px;font-weight:600}'
  + '.btn--tel{background:var(--v);border-color:var(--v);color:#fff}'
  + '.aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:18px 0;background:var(--bg)}'
  + '.lista ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
  + '.lista li a{display:inline-block;padding:5px 10px;border:1px solid var(--bd);border-radius:999px;'
  + 'font-size:13px;color:var(--vd);text-decoration:none;background:#fff}'
  + '.lista li a b{font-weight:600;color:var(--mu);font-size:12px}'
  + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
  + 'footer a{color:var(--vd)}'
  // La tabla de precios se desborda en movil: scroll propio, nunca el body.
  + '.tabla-wrap{overflow-x:auto;margin:0 0 8px}'
  + 'table.tarifas{border-collapse:collapse;width:100%;font-size:14px;min-width:520px}'
  + 'table.tarifas th,table.tarifas td{padding:8px 10px;border-bottom:1px solid var(--bd);text-align:left}'
  + 'table.tarifas thead th{font-size:12px;text-transform:uppercase;letter-spacing:.03em;color:var(--mu)}'
  + 'table.tarifas tbody th{font-weight:600}'
  + 'table.tarifas td b{font-size:15px}'
  + 'table.tarifas .desg{color:var(--mu);font-size:12.5px;white-space:nowrap}'
  + '.ojo{color:var(--v);font-weight:700}'
  + '.motivos,.fuentes{padding-left:18px}'
  + '.motivos li{margin-bottom:10px}'
  + '.fuentes{font-size:13px;color:var(--mu)}'
  + '.fuentes li{margin-bottom:6px}'
  + '.fuentes a{color:var(--vd)}'
  + '.vig{opacity:.8}'
  + '.legal{font-size:12.5px;color:var(--mu);border-top:1px solid var(--bd);margin-top:24px;padding-top:12px}'
  + '.legal p{margin:0 0 8px}'
  + '.precio-box{border:1px solid var(--bd);border-radius:10px;padding:14px;background:var(--bg);margin-bottom:12px}'
  + '.precio-linea{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px;gap:12px}'
  + '.precio-linea b{font-size:20px;color:var(--vd)}'
  + '.precio-desg{margin:8px 0 0;font-size:13px;color:var(--mu)}'
  + '.precio-nota{margin:8px 0 0;font-size:13px;color:var(--mu)}'
  + '.precio-fuente{margin:8px 0 0;font-size:12px;color:var(--mu);opacity:.85}'
  // Buscador de municipio (mismo patron que /farmacias/, en azul ITV).
  + '.buscador{margin:0 0 22px}'
  + '.buscador label{display:block;font-weight:600;margin:0 0 6px;font-size:15px}'
  + '.buscador .campo{position:relative}'
  + '.buscador input{width:100%;padding:13px 15px;font-size:16px;border:2px solid var(--bd);border-radius:10px;background:#fff;color:var(--tx)}'
  + '.buscador input:focus{outline:none;border-color:var(--v)}'
  + '.sugs{list-style:none;margin:6px 0 0;padding:6px;position:absolute;left:0;right:0;background:#fff;border:1px solid var(--bd);border-radius:10px;box-shadow:0 4px 12px rgba(15,23,42,.08);max-height:300px;overflow-y:auto;z-index:10}'
  + '.sugs li{margin:0}'
  + '.sugs a,.sugs .sug-msg{display:block;padding:9px 11px;border-radius:7px;text-decoration:none;color:var(--tx);font-size:15px}'
  + '.sugs a small{display:block;color:var(--mu);font-size:12px}'
  + '.sugs a:hover,.sugs a.active{background:#dbeafe}'
  + '.sug-msg{color:var(--mu);font-size:14px}'
  + '.hint{font-size:13px;color:var(--mu);margin:8px 0 18px}'
  + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
  + '.card,.aviso,.precio-box{background:#1e293b;border-color:#334155}'
  + '.btn{background:#0f172a;color:#93c5fd;border-color:#334155}'
  + '.precio-linea b,.fuentes a{color:#93c5fd}'
  + '.buscador input{background:#0f172a;color:#e2e8f0;border-color:#334155}'
  + '.sugs{background:#1e293b;border-color:#334155}'
  + '.sugs a,.sugs .sug-msg{color:#e2e8f0}'
  + '.sugs a:hover,.sugs a.active{background:#1e3a8a}'
  + '.lista li a{background:#0f172a;color:#93c5fd;border-color:#334155}}'

interface Meta {
  title: string
  desc: string
  canonical: string
  nonce: string
  jsonLd?: string
}

function envoltorio(m: Meta, cuerpo: string): string {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(m.title) + '</title>'
    + '<meta name="description" content="' + esc(m.desc) + '" />'
    + '<link rel="canonical" href="' + esc(m.canonical) + '" />'
    + '<meta name="theme-color" content="#1d4ed8" />'
    + '<meta property="og:title" content="' + esc(m.title) + '" />'
    + '<meta property="og:description" content="' + esc(m.desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(m.canonical) + '" />'
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + (m.jsonLd ? '<script type="application/ld+json" nonce="' + esc(m.nonce) + '">' + m.jsonLd + '</script>' : '')
    + '<style nonce="' + esc(m.nonce) + '">' + CSS + '</style></head><body>'
    + '<header><a href="/">CercaYa</a></header><main>'
    + cuerpo
    + '</main><footer>Datos de la DGT y de los portales de datos abiertos autonomicos. '
    + '<a href="/">CercaYa</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

function tarjeta(e: EstacionITV, municipio: string): string {
  const tel = telHref(e.tel)
  return '<article class="card">'
    + '<h3 class="dir">' + esc(e.dir || 'Estacion de ITV') + '</h3>'
    + '<p class="meta">'
    + (e.cp ? esc(e.cp) + ' ' + esc(municipio) : esc(municipio))
    + (e.op ? ' &middot; ' + esc(e.op) : '')
    + (e.lineas ? ' &middot; ' + e.lineas + ' lineas de inspeccion' : '')
    + (e.horario ? ' &middot; ' + esc(e.horario) : '')
    + '</p>'
    + '<div class="acciones">'
    + (tel ? '<a class="btn btn--tel" href="' + esc(tel) + '">Llamar ' + esc(e.tel) + '</a>' : '')
    + '<a class="btn" href="' + esc(mapsHref(e)) + '" target="_blank" rel="noopener">Como llegar</a>'
    + '</div></article>'
}

// Datos estructurados: una AutomotiveBusiness por estacion.
function jsonLdEstaciones(nombre: string, ests: EstacionITV[], provincia: string): string {
  const items = ests.slice(0, 15).map((e, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'AutomotiveBusiness',
      name: 'Estacion de ITV' + (e.op ? ' - ' + e.op : ''),
      address: {
        '@type': 'PostalAddress',
        streetAddress: e.dir,
        addressLocality: e.mun,
        postalCode: e.cp || undefined,
        addressRegion: provincia,
        addressCountry: 'ES',
      },
      telephone: e.tel || undefined,
      geo: (e.lat != null && e.lng != null)
        ? { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng }
        : undefined,
    },
  }))
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Estaciones de ITV en ' + nombre,
    numberOfItems: ests.length,
    itemListElement: items,
  }).replace(/</g, '\\u003c')
}

const AVISO = '<p class="aviso">Los precios de la ITV los fija cada comunidad autonoma y varian '
  + 'segun el tipo de vehiculo y el combustible. Confirma horario y si hace falta cita previa '
  + 'antes de desplazarte: muchas estaciones solo atienden con reserva.</p>'

// ---- Indice nacional: /itv/ ----
export function buildItvIndexPage(nonce: string, provincias: ProvinciaITV[], total: number, canonical: string): string {
  const title = 'Estaciones de ITV en España por provincia | CercaYa'
  const desc = 'Directorio de las ' + total + ' estaciones de ITV de España: direccion, telefono y como llegar, '
    + 'organizadas por provincia y municipio.'
  const lista = provincias.map(p =>
    '<li><a href="/itv/' + esc(p.slug) + '">' + esc(p.name) + ' <b>' + p.count + '</b></a></li>'
  ).join('')
  const buscador =
    '<div class="buscador">'
    + '<label for="q">Busca tu municipio</label>'
    + '<div class="campo">'
    + '<input id="q" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" '
    + 'placeholder="Escribe tu municipio…" '
    + 'role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="sugs" />'
    + '<ul id="sugs" class="sugs" role="listbox" aria-label="Municipios con ITV" hidden></ul>'
    + '</div>'
    + '<p class="hint">Escribe tu municipio y te llevamos a su ITV. O mira la lista por provincia más abajo.</p>'
    + '</div>'
  // Autocompletado: misma logica que /farmacias/, contra /api/itv/municipios.
  const script = `<script nonce="${esc(nonce)}">
  (function () {
    var input = document.getElementById('q');
    var box = document.getElementById('sugs');
    var muni = [];
    var loaded = false;
    var active = -1;
    var shown = [];
    function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, ''); }
    function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function cerrar() { box.hidden = true; box.innerHTML = ''; active = -1; shown = []; input.setAttribute('aria-expanded', 'false'); }
    function msg(t) { box.innerHTML = '<li><span class="sug-msg">' + esc(t) + '</span></li>'; box.hidden = false; shown = []; active = -1; input.setAttribute('aria-expanded', 'true'); }
    function render(q) {
      var nq = norm(q);
      if (nq.length < 2) { cerrar(); return; }
      if (!loaded) { msg('Cargando municipios\\u2026'); return; }
      var res = [];
      for (var i = 0; i < muni.length && res.length < 12; i++) {
        if (norm(muni[i].n).indexOf(nq) >= 0) res.push(muni[i]);
      }
      shown = res; active = -1;
      if (res.length === 0) { msg('No encontramos ITV en ese municipio. Prueba con otro o mira por provincia.'); return; }
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
      if (loaded) return;
      fetch('/api/itv/municipios', { credentials: 'same-origin' })
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
      if (box.hidden || shown.length === 0) { if (e.key === 'Enter') { e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(active + 1, shown.length - 1); marcar(active); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(active - 1, 0); marcar(active); }
      else if (e.key === 'Enter') { e.preventDefault(); if (!ir(active)) ir(0); }
      else if (e.key === 'Escape') { cerrar(); }
    });
    document.addEventListener('click', function (e) { if (e.target !== input && !box.contains(e.target)) cerrar(); });
  })();
  </script>`
  return envoltorio({ title, desc, canonical, nonce },
    '<h1>Estaciones de ITV en España</h1>'
    + '<p class="sub">' + total + ' estaciones en ' + provincias.length + ' provincias</p>'
    + buscador
    + '<p><a class="btn" href="/itv/precios">Cuánto cuesta la ITV en cada comunidad</a></p>'
    + '<h2>Todas las provincias</h2>'
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + AVISO
    + script
  )
}

// ---- Provincia: /itv/:provincia ----
export interface ItvProvinciaData {
  provinciaSlug: string
  provinciaName: string
  estaciones: EstacionITV[]
  municipios: MunicipioITV[]
  tarifa: Tarifa | null
  canonical: string
}

export function buildItvProvinciaPage(nonce: string, d: ItvProvinciaData): string {
  const n = d.estaciones.length
  const precio = d.tarifa && d.tarifa.gasolina != null ? desglosa(d.tarifa, d.tarifa.gasolina) : null
  const title = 'ITV en ' + d.provinciaName + ': ' + n + ' estaciones'
    + (precio ? ' y precio ' + eur(precio.total) : '') + ' | CercaYa'
  const desc = (precio
      ? 'Cuánto cuesta la ITV en ' + d.provinciaName + ' (' + eur(precio.total) + ' un turismo de gasolina) y '
      : 'Todas las estaciones de ITV de ' + d.provinciaName + ': dirección, teléfono y cómo llegar. ')
    + 'todas las estaciones por municipio.'
  const lista = d.municipios.map(m =>
    '<li><a href="/itv/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name)
    + (m.count > 1 ? ' <b>' + m.count + '</b>' : '') + '</a></li>'
  ).join('')
  return envoltorio(
    { title, desc, canonical: d.canonical, nonce, jsonLd: jsonLdEstaciones(d.provinciaName, d.estaciones, d.provinciaName) },
    '<h1>ITV en ' + esc(d.provinciaName) + '</h1>'
    + '<p class="sub">' + n + ' estacion' + (n === 1 ? '' : 'es') + ' en ' + d.municipios.length + ' municipio'
    + (d.municipios.length === 1 ? '' : 's') + '</p>'
    + bloquePrecioProvincia(d.tarifa, d.provinciaName)
    + (d.municipios.length ? '<h2>Por municipio</h2><nav class="lista"><ul>' + lista + '</ul></nav>' : '')
    + AVISO
    + '<p><a class="btn" href="/itv/">Ver todas las provincias</a></p>'
  )
}

// ---- Municipio: /itv/:provincia/:municipio ----
export interface ItvMunicipioData {
  provinciaSlug: string
  provinciaName: string
  municipioName: string
  estaciones: EstacionITV[]
  otrosMunicipios: MunicipioITV[]
  canonical: string
}

export function buildItvMunicipioPage(nonce: string, d: ItvMunicipioData): string {
  const n = d.estaciones.length
  const title = 'ITV en ' + d.municipioName + ': direccion y telefono | CercaYa'
  const desc = (n === 1 ? 'Estacion de ITV en ' : 'Las ' + n + ' estaciones de ITV de ')
    + d.municipioName + ' (' + d.provinciaName + '): direccion, telefono y como llegar.'
  const otros = d.otrosMunicipios.length
    ? '<nav class="lista"><h2>Otros municipios de ' + esc(d.provinciaName) + '</h2><ul>'
      + d.otrosMunicipios.slice(0, 60).map(m =>
          '<li><a href="/itv/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name) + '</a></li>'
        ).join('')
      + '</ul></nav>'
    : ''
  return envoltorio(
    { title, desc, canonical: d.canonical, nonce, jsonLd: jsonLdEstaciones(d.municipioName, d.estaciones, d.provinciaName) },
    '<h1>ITV en ' + esc(d.municipioName) + '</h1>'
    + '<p class="sub">' + esc(d.provinciaName) + ' &middot; ' + n + ' estacion' + (n === 1 ? '' : 'es') + '</p>'
    + d.estaciones.map(e => tarjeta(e, d.municipioName)).join('')
    + AVISO
    + '<p><a class="btn" href="/itv/' + esc(d.provinciaSlug) + '">Ver toda la provincia de ' + esc(d.provinciaName) + '</a></p>'
    + otros
  )
}

// ---- Precios: /itv/precios ----
//
// La cifra principal es el PRECIO FINAL (base + impuesto del territorio + tasa
// DGT). Es lo unico comparable entre comunidades: cada boletin publica con un
// criterio distinto, y poner "46,00 €" de Ceuta al lado de "41,47 €" de Valencia
// infravalora el gasto real en Ceuta un 18%.

function eur(n: number): string {
  return n.toFixed(2).replace('.', ',') + ' €'
}

function filaTarifa(t: Tarifa): string {
  const g = t.gasolina != null ? desglosa(t, t.gasolina) : null
  const d = t.diesel != null ? desglosa(t, t.diesel) : null
  return '<tr>'
    + '<th scope="row">' + esc(t.nombre) + (t.fiabilidad === 'media' ? ' <span class="ojo" title="Con matices">*</span>' : '') + '</th>'
    + '<td>' + (g ? '<b>' + eur(g.total) + '</b>' : '&mdash;') + '</td>'
    + '<td>' + (d ? '<b>' + eur(d.total) + '</b>' : '&mdash;') + '</td>'
    + '<td class="desg">' + (g ? eur(g.base) + ' + ' + esc(NOMBRE_IMPUESTO[t.impuesto]) + ' + ' + eur(TASA_DGT) : '&mdash;') + '</td>'
    + '</tr>'
}

export function buildItvPreciosPage(nonce: string, canonical: string): string {
  const title = 'Precio de la ITV 2026 por comunidad autónoma | CercaYa'
  const desc = 'Cuánto cuesta pasar la ITV en cada comunidad autónoma en 2026, con el precio final '
    + 'que se paga en caja: tarifa oficial, impuesto de cada territorio y tasa de Tráfico.'

  const ordenadas = [...TARIFAS].sort((a, b) => {
    const ta = a.gasolina != null ? desglosa(a, a.gasolina).total : Infinity
    const tb = b.gasolina != null ? desglosa(b, b.gasolina).total : Infinity
    return ta - tb
  })

  const conNota = ordenadas.filter(t => t.nota)

  return envoltorio({ title, desc, canonical, nonce },
    '<h1>Cuánto cuesta la ITV en 2026</h1>'
    + '<p class="sub">Precio final de una inspección periódica de turismo, ordenado de más barato a más caro. '
    + 'Incluye el impuesto de cada territorio y la tasa de Tráfico.</p>'

    + '<div class="tabla-wrap"><table class="tarifas">'
    + '<thead><tr><th scope="col">Comunidad</th><th scope="col">Gasolina</th>'
    + '<th scope="col">Diésel</th><th scope="col">Cómo se compone</th></tr></thead>'
    + '<tbody>' + ordenadas.map(filaTarifa).join('') + '</tbody>'
    + '</table></div>'

    + '<h2>Dónde no hay precio oficial</h2>'
    + '<ul class="motivos">'
    + LIBERALIZADAS.map(x => '<li><b>' + esc(x.nombre) + '.</b> ' + esc(x.motivo) + '</li>').join('')
    + '</ul>'

    + '<h2>Territorios sin dato publicable</h2>'
    + '<ul class="motivos">'
    + SIN_DATO.map(x => '<li><b>' + esc(x.nombre) + '.</b> ' + esc(x.motivo) + '</li>').join('')
    + '</ul>'

    + (conNota.length
        ? '<h2>Matices por territorio <span class="ojo">*</span></h2><ul class="motivos">'
          + conNota.map(t => '<li><b>' + esc(t.nombre) + '.</b> ' + esc(t.nota!) + '</li>').join('')
          + '</ul>'
        : '')

    + '<h2>De dónde salen estas cifras</h2>'
    + '<ul class="fuentes">'
    + ordenadas.map(t => '<li><b>' + esc(t.nombre) + ':</b> '
        + (t.fuenteUrl
            ? '<a href="' + esc(t.fuenteUrl) + '" target="_blank" rel="noopener nofollow">' + esc(t.norma) + '</a>'
            : esc(t.norma))
        + ' <span class="vig">(' + esc(t.vigencia) + ')</span></li>').join('')
    + '</ul>'

    + '<div class="legal">'
    + '<p><b>Precios máximos, no precios reales.</b> Las tarifas reguladas son máximos: cada estación '
    + 'puede cobrar menos. Confirma el precio en la estación antes de acudir.</p>'
    + '<p><b>Impuestos.</b> Se aplica IVA (21%) en la península y Baleares, IGIC (7%) en Canarias e '
    + 'IPSI en Ceuta (9%) y Melilla (4%). En Extremadura y en los consells de Balears la ITV es una '
    + 'tasa y no lleva impuesto indirecto. Los tipos pueden cambiar.</p>'
    + '<p><b>Tasa de Tráfico.</b> A las inspecciones periódicas se suma la tasa de la DGT por anotar '
    + 'el resultado en el Registro de Vehículos (' + eur(TASA_DGT) + ' en 2026), que la estación '
    + 'recauda por cuenta de la DGT. No está sujeta a IVA, IGIC ni IPSI.</p>'
    + '<p><b>Información no vinculante.</b> Datos elaborados a partir de los boletines oficiales '
    + 'citados arriba. Pueden existir errores o desfases; las fuentes oficiales prevalecen.</p>'
    + '</div>'

    + '<p><a class="btn" href="/itv/">Ver las estaciones de ITV por provincia</a></p>'
  )
}

// Bloque de precio que se inserta en la pagina de cada provincia.
export function bloquePrecioProvincia(t: Tarifa | null, provinciaName: string): string {
  if (!t || t.gasolina == null) return ''
  const g = desglosa(t, t.gasolina)
  const d = t.diesel != null ? desglosa(t, t.diesel) : null
  return '<h2>Cuánto cuesta la ITV en ' + esc(provinciaName) + '</h2>'
    + '<div class="precio-box">'
    + '<p class="precio-linea"><span>Turismo gasolina</span> <b>' + eur(g.total) + '</b></p>'
    + (d ? '<p class="precio-linea"><span>Turismo diésel</span> <b>' + eur(d.total) + '</b></p>' : '')
    + '<p class="precio-desg">' + eur(g.base) + ' de tarifa + ' + esc(NOMBRE_IMPUESTO[t.impuesto])
    + ' + ' + eur(TASA_DGT) + ' de tasa de Tráfico. Es un precio máximo: puede cobrarse menos.</p>'
    + (t.nota ? '<p class="precio-nota">' + esc(t.nota) + '</p>' : '')
    + '<p class="precio-fuente">Fuente: ' + esc(t.norma) + '</p>'
    + '</div>'
    + '<p><a class="btn" href="/itv/precios">Comparar el precio con el resto de España</a></p>'
}

export function itvHeaders(nonce: string): Record<string, string> {
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
    // Las estaciones no cambian a diario (a diferencia de las guardias): cache
    // larga en CDN, que ademas ahorra invocaciones del Worker.
    'Cache-Control': 'public, max-age=3600, s-maxage=86400',
  }
}
