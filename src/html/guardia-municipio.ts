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

import { frescuraGuardia } from '../lib/guardias'
import type { Guardia, MunicipioGuardia, GuardiaFrescura } from '../lib/guardias'

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

// A partir de la frescura del snapshot, decide como presentar el turno:
//   - fiable y de hoy      -> se puede decir "de guardia hoy", se muestran las tarjetas.
//   - fiable pero de ayer  -> se muestran, pero etiquetadas con su fecha (sin "hoy").
//   - no fiable (>30 h)    -> NO se muestra el turno: aviso de caducado + noindex.
// `lugar` es el municipio o la provincia, para el texto del aviso.
function piezasFrescura(fr: GuardiaFrescura, lugar: string): {
  hoy: boolean; mostrarCards: boolean; noindex: boolean; banner: string; nota: string
} {
  const fecha = fechaLegible(fr.fecha)
  if (!fr.fiable) {
    return {
      hoy: false, mostrarCards: false, noindex: true, nota: '',
      banner: '<p class="g-caducado"><strong>No tenemos el turno de guardia actualizado de ' + esc(lugar) + '.</strong> '
        + (fecha ? 'El ultimo dato que teniamos era del ' + esc(fecha) + ' y puede estar caducado. ' : '')
        + 'Para asegurarte, llama a tu farmacia habitual o a tu Colegio Oficial de Farmaceuticos. '
        + 'En una urgencia grave, llama al 112.</p>',
    }
  }
  if (!fr.esHoy) {
    return {
      hoy: false, mostrarCards: true, noindex: false, banner: '',
      nota: fecha ? '<p class="g-nota">Turno publicado el ' + esc(fecha) + '. Confirma llamando antes de desplazarte.</p>' : '',
    }
  }
  return { hoy: true, mostrarCards: true, noindex: false, banner: '', nota: '' }
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

// Tarjeta de una guardia. Se usa en la pagina provincial "plana" (Baleares y
// Huesca, que no traen municipio). No se toca buildGuardiaMunicipioPage para no
// arriesgar las 1.289 paginas que ya funcionan.
function guardiaCard(g: Guardia, localidad: string): string {
  const tel = telHref(g.telefono)
  return '<article class="g-card">'
    + '<h3 class="g-dir">' + esc(g.direccion || 'Farmacia de guardia') + '</h3>'
    + '<p class="g-hora"><strong>' + esc(horarioLegible(g)) + '</strong></p>'
    + (g.cp ? '<p class="g-meta">' + esc(g.cp) + ' ' + esc(localidad) + '</p>' : '')
    + '<div class="g-acciones">'
    + (tel ? '<a class="g-btn g-btn--tel" href="' + esc(tel) + '">Llamar ' + esc(g.telefono) + '</a>' : '')
    + '<a class="g-btn" href="' + esc(mapsHref(g)) + '" target="_blank" rel="noopener">Como llegar</a>'
    + '</div>'
    + '</article>'
}

// Pagina provincial cuando la fuente NO trae municipio (Baleares, Huesca):
// en vez de un 404, se listan todas las guardias de la provincia directamente.
export function buildGuardiaProvinciaFlatPage(
  nonce: string, provinciaSlug: string, provinciaName: string,
  guardias: Guardia[], actualizado: string | undefined, canonical: string,
): string {
  const fr = frescuraGuardia(actualizado)
  const p = piezasFrescura(fr, provinciaName)
  const n = p.mostrarCards ? guardias.length : 0
  const title = 'Farmacia de guardia en ' + provinciaName + (n && p.hoy ? ' hoy' : '') + ' | CercaYa'
  const desc = 'Las ' + n + ' farmacias de guardia de ' + provinciaName
    + ': direccion, telefono y horario. Datos del Colegio Oficial de Farmaceuticos.'
  const fecha = fechaLegible(actualizado)
  const cards = !p.mostrarCards
    ? p.banner
    : (n
      ? guardias.map(x => guardiaCard(x, provinciaName)).join('')
      : '<p class="g-vacio">No hay farmacia de guardia publicada ahora mismo para ' + esc(provinciaName) + '.</p>')
  return envoltorioIndice(nonce, title, desc, canonical,
    '<h1>Farmacia de guardia en ' + esc(provinciaName) + '</h1>'
    + (p.mostrarCards
        ? '<p class="sub">' + n + ' farmacia' + (n === 1 ? '' : 's') + ' de guardia'
          + (fecha ? ' &middot; actualizado el ' + esc(fecha) : '') + '</p>' + p.nota
        : '')
    + cards
    + '<p class="aviso">Los turnos los publica el Colegio Oficial de Farmaceuticos y pueden cambiar. '
    + 'Algunas farmacias de guardia atienden a puerta cerrada: llama al timbre. '
    + 'Si vas a desplazarte, confirma antes por telefono.</p>'
    + '<p><a class="btn" href="/farmacias/guardia">Ver todas las provincias</a></p>',
    p.noindex,
  )
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
  const fr = frescuraGuardia(d.actualizado)
  const p = piezasFrescura(fr, d.municipioName)
  const n = p.mostrarCards ? d.guardias.length : 0
  const hoyTxt = (n && p.hoy) ? ' hoy' : ''
  const title = n
    ? 'Farmacia de guardia en ' + d.municipioName + hoyTxt + ' | CercaYa'
    : 'Farmacias de guardia en ' + d.municipioName + ' | CercaYa'
  const desc = n
    ? 'Farmacia' + (n > 1 ? 's' : '') + ' de guardia' + hoyTxt + ' en ' + d.municipioName +
      ' (' + d.provinciaName + '): direccion, telefono y horario. Datos del Colegio Oficial de Farmaceuticos.'
    : 'Consulta las farmacias de guardia en ' + d.municipioName + ' (' + d.provinciaName + ').'
  const fecha = fechaLegible(d.actualizado)

  const cards = !p.mostrarCards ? p.banner : (d.guardias.length ? d.guardias.map(g => {
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
      + '. Consulta el <a href="/farmacias/">mapa de farmacias</a> o el municipio mas cercano.</p>')

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
    + (p.noindex ? '<meta name="robots" content="noindex,follow" />' : '')
    + '<link rel="canonical" href="' + esc(d.canonical) + '" />'
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(title) + '" />'
    + '<meta property="og:description" content="' + esc(desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(d.canonical) + '" />'
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + (p.mostrarCards && d.guardias.length ? '<script type="application/ld+json" nonce="' + esc(nonce) + '">' + jsonLd(d) + '</script>' : '')
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
    + '.g-caducado{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;color:#7f1d1d;border-radius:10px;padding:14px;margin:0 0 14px;font-size:15px}'
    + '.g-nota{background:var(--bg);border-left:3px solid #f59e0b;color:#92400e;padding:8px 12px;margin:0 0 14px;font-size:13px;border-radius:6px}'
    + '.g-aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:18px 0;background:var(--bg)}'
    + '.g-otros ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
    + '.g-otros li a{display:inline-block;padding:5px 10px;border:1px solid var(--bd);border-radius:999px;'
    + 'font-size:13px;color:var(--vd);text-decoration:none;background:#fff}'
    + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
    + 'footer a{color:var(--vd)}'
    + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
    + '.g-card,.g-vacio,.g-aviso{background:#1e293b;border-color:#334155}'
    + '.g-caducado{background:#450a0a;border-color:#7f1d1d;color:#fecaca}'
    + '.g-nota{background:#1e293b;border-color:#f59e0b;color:#fcd34d}'
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
    + p.nota
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

// ---- Indices de navegacion ----
//
// POR QUE EXISTEN. Search Console, inspeccionando /farmacias/madrid/madrid:
// "Google no reconoce esta URL", "No se ha detectado ninguna pagina de
// referencia". Las 1.289 paginas de municipio se enlazaban ENTRE SI, pero
// ninguna pagina del sitio apuntaba a ellas: eran una isla. Googlebot entra por
// la portada y recorre enlaces; sin camino, no llegaba, y quedaba solo el
// sitemap, que tarda mucho mas en descubrirlas.
//
// Estas dos paginas construyen ese camino: portada -> indice -> provincia -> municipio.

const CSS_INDICE =
  ':root{--v:#16a34a;--vd:#14532d;--tx:#1e293b;--mu:#64748b;--bd:#e2e8f0;--bg:#f8fafc}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.5}'
  + 'header{background:linear-gradient(135deg,#166534,#16a34a);color:#fff;padding:14px 18px}'
  + 'header a{color:#fff;text-decoration:none;font-weight:600}'
  + 'main{max-width:760px;margin:0 auto;padding:18px}'
  + 'h1{font-size:24px;line-height:1.25;margin:0 0 6px}'
  + 'h2{font-size:17px;margin:26px 0 10px}'
  + '.sub{color:var(--mu);font-size:14px;margin:0 0 18px}'
  + '.lista ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
  + '.lista li a{display:inline-block;padding:6px 12px;border:1px solid var(--bd);border-radius:999px;'
  + 'font-size:14px;color:var(--vd);text-decoration:none;background:#fff}'
  + '.lista li a b{color:var(--mu);font-size:12px;font-weight:600}'
  + '.aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:18px 0;background:var(--bg)}'
  + '.g-caducado{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;color:#7f1d1d;border-radius:10px;padding:14px;margin:0 0 14px;font-size:15px}'
  + '.g-nota{background:var(--bg);border-left:3px solid #f59e0b;color:#92400e;padding:8px 12px;margin:0 0 14px;font-size:13px;border-radius:6px}'
  + '.btn{display:inline-block;padding:8px 12px;border-radius:8px;border:1px solid var(--bd);'
  + 'background:#fff;color:var(--vd);text-decoration:none;font-size:14px;font-weight:600}'
  + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
  + 'footer a{color:var(--vd)}'
  + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
  + '.aviso{background:#1e293b;border-color:#334155}'
  + '.g-caducado{background:#450a0a;border-color:#7f1d1d;color:#fecaca}'
  + '.g-nota{background:#1e293b;border-color:#f59e0b;color:#fcd34d}'
  + '.btn,.lista li a{background:#0f172a;color:#86efac;border-color:#334155}}'

function envoltorioIndice(nonce: string, title: string, desc: string, canonical: string, cuerpo: string, noindex = false): string {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(desc) + '" />'
    + (noindex ? '<meta name="robots" content="noindex,follow" />' : '')
    + '<link rel="canonical" href="' + esc(canonical) + '" />'
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(title) + '" />'
    + '<meta property="og:description" content="' + esc(desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(canonical) + '" />'
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + '<style nonce="' + esc(nonce) + '">' + CSS_INDICE + '</style></head><body>'
    + '<header><a href="/">CercaYa</a></header><main>' + cuerpo + '</main>'
    + '<footer>Datos de los Colegios Oficiales de Farmaceuticos. '
    + '<a href="/">CercaYa</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

export interface ProvinciaGuardia {
  slug: string
  name: string
}

// /farmacias/guardia — indice nacional de provincias con guardia.
export function buildGuardiaIndexPage(nonce: string, provincias: ProvinciaGuardia[], canonical: string): string {
  const title = 'Farmacias de guardia hoy en España, por provincia | CercaYa'
  const desc = 'Consulta que farmacia esta de guardia hoy en tu municipio. '
    + 'Datos de los Colegios Oficiales de Farmaceuticos de ' + provincias.length + ' provincias.'
  const lista = provincias.map(p =>
    '<li><a href="/farmacias/' + esc(p.slug) + '">' + esc(p.name) + '</a></li>'
  ).join('')
  return envoltorioIndice(nonce, title, desc, canonical,
    '<h1>Farmacias de guardia hoy</h1>'
    + '<p class="sub">Elige tu provincia para ver los municipios con guardia publicada</p>'
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + '<p class="aviso">Los turnos los publica cada Colegio Oficial de Farmaceuticos y pueden cambiar. '
    + 'Algunas farmacias de guardia atienden a puerta cerrada: llama al timbre.</p>'
    + '<p><a class="btn" href="/farmacias/">Ver el mapa de farmacias</a></p>'
  )
}

// /farmacias/:provincia — municipios de esa provincia con guardia.
export function buildGuardiaProvinciaPage(
  nonce: string, provinciaSlug: string, provinciaName: string,
  municipios: MunicipioGuardia[], actualizado: string | undefined, canonical: string,
): string {
  const fr = frescuraGuardia(actualizado)
  const p = piezasFrescura(fr, provinciaName)
  const title = 'Farmacia de guardia en ' + provinciaName + (p.hoy ? ' hoy' : '') + ' | CercaYa'
  const desc = 'Farmacias de guardia en los ' + municipios.length + ' municipios de '
    + provinciaName + ' con turno publicado: direccion, telefono y horario.'
  const fecha = fechaLegible(actualizado)
  const lista = municipios.map(m =>
    '<li><a href="/farmacias/' + esc(provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name)
    + (m.count > 1 ? ' <b>' + m.count + '</b>' : '') + '</a></li>'
  ).join('')
  return envoltorioIndice(nonce, title, desc, canonical,
    '<h1>Farmacia de guardia en ' + esc(provinciaName) + '</h1>'
    + p.banner
    + '<p class="sub">' + municipios.length + ' municipio' + (municipios.length === 1 ? '' : 's')
    + ' con guardia publicada' + (fecha ? ' &middot; actualizado el ' + esc(fecha) : '') + '</p>'
    + p.nota
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + '<p class="aviso">Si tu municipio no aparece, su colegio no publica turno o no hay guardia hoy. '
    + 'Consulta el municipio mas cercano.</p>'
    + '<p><a class="btn" href="/farmacias/guardia">Ver todas las provincias</a></p>',
    p.noindex,
  )
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
