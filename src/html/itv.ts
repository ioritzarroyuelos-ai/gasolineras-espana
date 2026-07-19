// Paginas SEO de estaciones de ITV: indice nacional, provincia y municipio.
//
// Se renderizan enteras en servidor, como las de farmacia de guardia: es lo que
// permite que Google indexe "ITV en <municipio>", que es la consulta con
// intencion real. A diferencia de aquellas, el dato aqui es estatico (las
// estaciones no cambian a diario), asi que la cache puede ser mucho mas larga.

import type { EstacionITV, MunicipioITV, ProvinciaITV } from '../lib/itv'
import { telHref, mapsHref } from '../lib/itv'

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
  + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
  + '.card,.aviso{background:#1e293b;border-color:#334155}'
  + '.btn{background:#0f172a;color:#93c5fd;border-color:#334155}'
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
  return envoltorio({ title, desc, canonical, nonce },
    '<h1>Estaciones de ITV en España</h1>'
    + '<p class="sub">' + total + ' estaciones en ' + provincias.length + ' provincias</p>'
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + AVISO
  )
}

// ---- Provincia: /itv/:provincia ----
export interface ItvProvinciaData {
  provinciaSlug: string
  provinciaName: string
  estaciones: EstacionITV[]
  municipios: MunicipioITV[]
  canonical: string
}

export function buildItvProvinciaPage(nonce: string, d: ItvProvinciaData): string {
  const n = d.estaciones.length
  const title = 'ITV en ' + d.provinciaName + ': ' + n + ' estaciones | CercaYa'
  const desc = 'Todas las estaciones de ITV de ' + d.provinciaName + ': direccion, telefono y como llegar. '
    + 'Consulta la mas cercana por municipio.'
  const lista = d.municipios.map(m =>
    '<li><a href="/itv/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name)
    + (m.count > 1 ? ' <b>' + m.count + '</b>' : '') + '</a></li>'
  ).join('')
  return envoltorio(
    { title, desc, canonical: d.canonical, nonce, jsonLd: jsonLdEstaciones(d.provinciaName, d.estaciones, d.provinciaName) },
    '<h1>ITV en ' + esc(d.provinciaName) + '</h1>'
    + '<p class="sub">' + n + ' estacion' + (n === 1 ? '' : 'es') + ' en ' + d.municipios.length + ' municipio'
    + (d.municipios.length === 1 ? '' : 's') + '</p>'
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
