// Pagina SEO de farmacia de guardia por municipio.
//
// A diferencia de /farmacias/ (SPA con mapa), esta pagina se renderiza ENTERA
// en el servidor: es la unica forma de que Google indexe "farmacia de guardia
// en <municipio>", que es la consulta de mayor intencion del proyecto — quien
// la busca a las 3 de la manana necesita la respuesta, no una aplicacion.
//
// Datos: los snapshots de los 47 colegios provinciales que ya generan los
// scrapers (ver src/lib/guardias.ts). El caso PDF, que es justo el que deja
// fuera a los competidores en varias provincias, ya lo resuelve el OCR del
// workflow fetch-guardias.

import type { Guardia, MunicipioGuardia } from '../lib/guardias'

export interface GuardiaPageData {
  provinciaSlug: string
  provinciaName: string
  municipioSlug: string
  municipioName: string
  guardias: Guardia[]
  otrosMunicipios: MunicipioGuardia[]
  actualizado?: string
  fuente?: string
  canonical: string
}

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// "2026-07-17 09:30-2026-07-17 23:00" -> "09:30 - 23:00". Si no encaja con el
// formato, se devuelve tal cual: los colegios publican formatos muy dispares y
// preferimos ensenar el texto original a ensenar nada.
function horarioLegible(g: Guardia): string {
  if (g.horarioDesc) return g.horarioDesc
  const m = g.horario.match(/(\d{1,2}:\d{2}).*?(\d{1,2}:\d{2})/)
  return m ? m[1] + ' - ' + m[2] : (g.horario || 'Consultar horario')
}

function fechaLegible(iso?: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

function telHref(t: string): string {
  const clean = t.replace(/[^0-9+]/g, '')
  return clean ? 'tel:' + clean : ''
}

function mapsHref(g: Guardia): string {
  if (isFinite(g.lat) && isFinite(g.lng) && g.lat !== 0) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + g.lat + ',' + g.lng
  }
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(g.direccion + ' ' + g.municipio)
}

// Datos estructurados: una Pharmacy por farmacia de guardia. Ayuda a que
// Google entienda la pagina y pueda mostrarla como resultado enriquecido.
function jsonLd(d: GuardiaPageData): string {
  const items = d.guardias.slice(0, 10).map((g, i) => ({
    '@type': 'ListItem',
    position: i + 1,
    item: {
      '@type': 'Pharmacy',
      name: 'Farmacia de guardia' + (g.direccion ? ' - ' + g.direccion : ''),
      address: {
        '@type': 'PostalAddress',
        streetAddress: g.direccion,
        addressLocality: d.municipioName,
        postalCode: g.cp || undefined,
        addressRegion: d.provinciaName,
        addressCountry: 'ES',
      },
      telephone: g.telefono || undefined,
      geo: (isFinite(g.lat) && g.lat !== 0)
        ? { '@type': 'GeoCoordinates', latitude: g.lat, longitude: g.lng }
        : undefined,
      openingHours: horarioLegible(g),
    },
  }))
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Farmacias de guardia en ' + d.municipioName,
    numberOfItems: d.guardias.length,
    itemListElement: items,
  }
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function buildGuardiaMunicipioPage(nonce: string, d: GuardiaPageData): string {
  const n = d.guardias.length
  const title = n
    ? 'Farmacia de guardia en ' + d.municipioName + ' hoy | CercaYa'
    : 'Farmacias de guardia en ' + d.municipioName + ' | CercaYa'
  const desc = n
    ? 'Farmacia' + (n > 1 ? 's' : '') + ' de guardia hoy en ' + d.municipioName +
      ' (' + d.provinciaName + '): direccion, telefono y horario. Datos del Colegio Oficial de Farmaceuticos.'
    : 'Consulta las farmacias de guardia en ' + d.municipioName + ' (' + d.provinciaName + ').'
  const fecha = fechaLegible(d.actualizado)

  const cards = n ? d.guardias.map(g => {
    const tel = telHref(g.telefono)
    return '<article class="g-card">'
      + '<h3 class="g-dir">' + esc(g.direccion || 'Farmacia de guardia') + '</h3>'
      + '<p class="g-hora"><strong>' + esc(horarioLegible(g)) + '</strong></p>'
      + (g.cp ? '<p class="g-meta">' + esc(g.cp) + ' ' + esc(d.municipioName) + '</p>' : '')
      + '<div class="g-acciones">'
      + (tel ? '<a class="g-btn g-btn--tel" href="' + esc(tel) + '">Llamar ' + esc(g.telefono) + '</a>' : '')
      + '<a class="g-btn" href="' + esc(mapsHref(g)) + '" target="_blank" rel="noopener">Como llegar</a>'
      + '</div>'
      + '</article>'
  }).join('') : '<p class="g-vacio">No hay farmacia de guardia publicada ahora mismo para ' + esc(d.municipioName)
      + '. Consulta el <a href="/farmacias/">mapa de farmacias</a> o el municipio mas cercano.</p>'

  const otros = d.otrosMunicipios.length
    ? '<nav class="g-otros"><h2>Otros municipios de ' + esc(d.provinciaName) + '</h2><ul>'
      + d.otrosMunicipios.slice(0, 60).map(m =>
          '<li><a href="/farmacias/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name) + '</a></li>'
        ).join('')
      + '</ul></nav>'
    : ''

  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(desc) + '" />'
    + '<link rel="canonical" href="' + esc(d.canonical) + '" />'
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(title) + '" />'
    + '<meta property="og:description" content="' + esc(desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(d.canonical) + '" />'
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + '<script type="application/ld+json" nonce="' + esc(nonce) + '">' + jsonLd(d) + '</script>'
    + '<style nonce="' + esc(nonce) + '">'
    + ':root{--v:#16a34a;--vd:#14532d;--tx:#1e293b;--mu:#64748b;--bd:#e2e8f0;--bg:#f8fafc}'
    + '*{box-sizing:border-box}'
    + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.5}'
    + 'header{background:linear-gradient(135deg,#166534,#16a34a);color:#fff;padding:14px 18px}'
    + 'header a{color:#fff;text-decoration:none;font-weight:600}'
    + 'main{max-width:760px;margin:0 auto;padding:18px}'
    + 'h1{font-size:24px;line-height:1.25;margin:0 0 6px}'
    + 'h2{font-size:17px;margin:26px 0 10px}'
    + '.g-sub{color:var(--mu);font-size:14px;margin:0 0 18px}'
    + '.g-card{border:1px solid var(--bd);border-radius:10px;padding:14px;margin-bottom:12px;background:var(--bg)}'
    + '.g-dir{font-size:16px;margin:0 0 6px}'
    + '.g-hora{margin:0 0 6px;color:var(--vd)}'
    + '.g-meta{margin:0 0 10px;color:var(--mu);font-size:13px}'
    + '.g-acciones{display:flex;gap:8px;flex-wrap:wrap}'
    + '.g-btn{display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);'
    + 'background:#fff;color:var(--vd);text-decoration:none;font-size:14px;font-weight:600}'
    + '.g-btn--tel{background:var(--v);border-color:var(--v);color:#fff}'
    + '.g-vacio{background:var(--bg);border:1px solid var(--bd);border-radius:10px;padding:14px}'
    + '.g-aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:18px 0;background:var(--bg)}'
    + '.g-otros ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
    + '.g-otros li a{display:inline-block;padding:5px 10px;border:1px solid var(--bd);border-radius:999px;'
    + 'font-size:13px;color:var(--vd);text-decoration:none;background:#fff}'
    + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
    + 'footer a{color:var(--vd)}'
    + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
    + '.g-card,.g-vacio,.g-aviso{background:#1e293b;border-color:#334155}'
    + '.g-btn{background:#0f172a;color:#86efac;border-color:#334155}'
    + '.g-otros li a{background:#0f172a;color:#86efac;border-color:#334155}}'
    + '</style></head><body>'
    + '<header><a href="/">CercaYa</a></header>'
    + '<main>'
    + '<h1>Farmacia de guardia en ' + esc(d.municipioName) + '</h1>'
    + '<p class="g-sub">' + esc(d.provinciaName)
    + (fecha ? ' &middot; actualizado el ' + esc(fecha) : '')
    + (d.fuente ? ' &middot; fuente: ' + esc(d.fuente) : '')
    + '</p>'
    + cards
    + '<p class="g-aviso">Los turnos los publica el Colegio Oficial de Farmaceuticos y pueden cambiar. '
    + 'Algunas farmacias de guardia atienden a puerta cerrada: llama al timbre. '
    + 'Si vas a desplazarte, confirma antes por telefono.</p>'
    + '<p><a class="g-btn" href="/farmacias/">Ver el mapa de farmacias</a></p>'
    + otros
    + '</main>'
    + '<footer>Datos de los Colegios Oficiales de Farmaceuticos. '
    + '<a href="/">CercaYa</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

export function guardiaHeaders(nonce: string): Record<string, string> {
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
    // Los turnos cambian a diario: cache corta en CDN y revalidacion.
    'Cache-Control': 'public, max-age=600, s-maxage=1800',
  }
}
