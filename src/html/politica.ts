// Portada, directorio territorial y ficha de elecciones. Las referencias y la
// paginación se resuelven en el servidor, incluso sin JavaScript.
import type { EleccionFile, IndexEntry, Candidatura } from '../lib/politica-schemas'
import { colorPartido, ordenIdeologico, type EleccionCatalogo } from '../../scripts/lib/politica-catalogo.mjs'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { ogSocialTags, originFromCanonical, breadcrumbLd } from './seo'
import { esc, fmtFecha, fmtMesAnio } from './politica-formato'
import { renderSondeos, SONDEOS_CSS, type ReferenciaSondeo } from './politica-sondeos'
import { renderGrafica, POLITICA_GRAFICA_CSS } from './politica-grafica'

const CSS = `
:root{color-scheme:light;--vd:#265c39;--ink:#222b25;--tx:#303c34;--mu:#536158;--bd:#dce2da;--rule:#cdd6cc;--paper:#f8f7f2;--bg:#f3f6f2}
*{box-sizing:border-box}
body{margin:0;background:#fffcf6;color:var(--tx);font:16px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:1080px;margin:0 auto;padding:clamp(22px,4vw,48px) clamp(16px,3vw,32px) 24px}
a{color:var(--vd);text-underline-offset:.18em}
h1,h2,.el-name{font-family:Georgia,'Times New Roman',serif;color:var(--ink);line-height:1.14}
h1{font-size:clamp(28px,4vw,42px);margin:0 0 10px;letter-spacing:-.025em}
h2{font-size:clamp(21px,3vw,27px);margin:0 0 12px}
.sub,.ficha,.fuente,.resultado .cap{color:var(--mu)}
.sub{max-width:60ch;margin:0}
main>section{margin-top:clamp(26px,4vw,42px)}
main>section+section{padding-top:clamp(18px,3vw,30px);border-top:1px solid var(--rule)}
.ficha{margin:0 0 8px;font-size:15px}.fecha-eleccion{margin:0;color:var(--ink)}
.badge{display:inline-block;align-self:flex-start;font-size:13px;margin:4px 0;color:var(--vd)}
.regional-form{display:flex;align-items:flex-end;flex-wrap:wrap;gap:8px}
.regional-form label{display:grid;gap:5px;font-size:14px;min-width:0}
.regional-form select,.regional-form button{max-width:100%;min-height:44px;border:1px solid #748476;border-radius:7px;font:inherit;padding:8px 12px}
.regional-form select{background:#fff;color:var(--ink)}.regional-form button{background:var(--vd);color:#fff;font-weight:650;cursor:pointer}
.grid-el{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,245px),1fr));gap:16px}
.el{display:flex;flex-direction:column;gap:7px;padding:18px 20px;background:var(--paper);border:1px solid var(--rule);border-radius:12px;color:inherit;text-decoration:none}
.el:hover,.territorios a:hover{background:var(--bg)}.el-name{font-size:21px;font-weight:700}
.el-fecha{color:var(--mu);font-size:14px}.el .go{margin-top:auto;color:var(--vd);font-size:14px;font-weight:650}
.territorios{margin-top:14px}.territorios summary{width:fit-content;color:var(--vd);cursor:pointer;padding:10px 0;font-weight:650}
.territorios ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));column-gap:18px;padding:0;margin:8px 0 0;list-style:none}
.territorios a{display:block;padding:10px 4px;border-top:1px solid var(--bd)}
.masthead.masthead--compact{padding:6px max(16px,calc((100% - 1016px)/2));display:flex;flex-wrap:wrap;align-items:center;gap:4px 18px;text-align:left;border-bottom:1px solid var(--rule)}
.masthead--compact .mh-inner,.masthead--compact .mh-local{margin:0}.masthead--compact .mh-brand{display:flex;align-items:center;gap:7px}
.masthead--compact .mh-logo{width:23px;height:23px;margin:0}.masthead--compact .mh-title{font-size:23px}
.masthead--compact .mh-nav{margin:0 0 0 auto;border:0}.masthead--compact .mh-nav a{font-size:12px;padding:10px 8px}
.masthead--compact .mh-local{padding:0;color:var(--vd)}.mh-local summary{cursor:pointer;font-weight:650;padding:10px 4px}
.masthead--compact .mh-local[open]{flex-basis:100%;max-width:none}.masthead--compact .mh-local form{justify-content:flex-start}
.breadcrumb{font-size:14px;margin-bottom:12px}
.referencias{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:8px 0 18px}
.referencias>span{font-weight:600;font-size:14px}.referencias .opciones{display:inline-flex;flex-wrap:wrap;gap:4px}
.opciones a{display:inline-flex;align-items:center;min-height:44px;border-radius:7px;border:1px solid var(--rule);padding:7px 12px;font-size:14px;text-decoration:none}
.opciones a[aria-current]{background:var(--vd);color:#fff;border-color:var(--vd)}
.paginas{display:flex;align-items:center;flex-wrap:wrap;gap:4px 16px;font-size:14px;margin:12px 0}
.paginas a{display:inline-flex;align-items:center;min-height:44px}.paginas span{color:var(--mu)}
.resultado .cap{margin:0 0 8px}.resbar{display:block;width:100%;height:26px;margin:12px 0}
.leyenda-res{display:flex;flex-wrap:wrap;gap:8px 18px}.leyenda-res .it{display:inline-flex;align-items:center;gap:6px;font-size:14px}
.leyenda-res .dot{width:10px;height:10px;border-radius:3px}.leyenda-res b{color:var(--ink)}
.aviso,.veda{background:var(--paper);border-left:3px solid var(--rule);padding:12px 14px;margin:20px 0}
.fuente,footer{font-size:13px}.fuente{margin:16px 0 0}.datos-fuente{max-width:80ch}
footer{border-top:1px solid var(--rule);margin-top:20px;color:var(--mu);padding:20px;text-align:center}
@media(max-width:700px){
  .masthead.masthead--compact{justify-content:space-between;gap:0 8px}
  .masthead--compact .mh-nav{order:2;flex-basis:100%;margin:0;justify-content:space-between}
  .masthead--compact .mh-nav a{font-size:11px;letter-spacing:.015em;padding:10px 1px}
  .masthead--compact .mh-title{font-size:21px}
  .grid-el{gap:10px}.regional-form label{flex:1}.regional-form select{width:100%;min-width:0}
}
`

interface Meta {
  title: string
  desc: string
  canonical: string
  nonce: string
  breadcrumb?: string
  css?: string
}

function envoltorio(m: Meta, cuerpo: string): string {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(m.title) + '</title>'
    + '<meta name="description" content="' + esc(m.desc) + '" />'
    + '<link rel="canonical" href="' + esc(m.canonical) + '" />'
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(m.title) + '" />'
    + '<meta property="og:description" content="' + esc(m.desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(m.canonical) + '" />'
    + '<meta name="robots" content="index,follow,max-image-preview:large" />'
    + ogSocialTags(originFromCanonical(m.canonical))
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + (m.breadcrumb ? '<script type="application/ld+json" nonce="' + esc(m.nonce) + '">' + m.breadcrumb + '</script>' : '')
    + '<style nonce="' + esc(m.nonce) + '">' + MASTHEAD_CSS + CSS + (m.css || '') + '</style></head><body>'
    + mastheadHtml('politica', { compact: true }) + '<main>'
    + cuerpo
    + '</main><footer>'
    + '<a href="/">España Útil</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

const ESTADOS: Record<string, string> = {
  ok: 'Con sondeos', sin_sondeos: 'Aún sin sondeos', desactualizado: 'Pendiente de actualizar', no_disponible: 'Datos no disponibles',
}

function textoFecha(p: EleccionCatalogo['proxima'], ahoraISO?: string): string {
  if (!p.valor) return 'Próxima votación pendiente de fecha oficial'
  if (!p.confirmada) return 'Prevista para ' + fmtMesAnio(p.valor) + ' · Pendiente de confirmación'
  const dias = ahoraISO ? Math.ceil((Date.parse(p.valor + 'T00:00:00Z') - Date.parse(ahoraISO)) / 86_400_000) : 0
  return 'Votación convocada para el ' + fmtFecha(p.valor) + (dias > 0 ? (dias === 1 ? ' · Falta 1 día' : ' · Faltan ' + dias + ' días') : '')
}

function regionUrl(id: string): string {
  return '/politica/autonomicas/' + encodeURIComponent(id)
}

function directorio(auton: IndexEntry[], abierto: boolean): string {
  if (!auton.length) return '<p class="aviso">El directorio autonómico está pendiente de datos.</p>'
  const nombre = (e: IndexEntry) => e.comunidad || e.nombre
  const orden = [...auton].sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'))
  return '<form class="regional-form" action="/politica/autonomicas/" method="get">'
    + '<label for="region">Comunidad o ciudad autónoma<select id="region" name="comunidad" required>'
    + '<option value="">Elige tu comunidad</option>'
    + orden.map(e => '<option value="' + esc(e.id) + '">' + esc(nombre(e)) + '</option>').join('')
    + '</select></label><button>Ver elección</button></form>'
    + '<details class="territorios"' + (abierto ? ' open' : '') + '><summary>Ver todas las comunidades y ciudades (' + orden.length + ')</summary><ul>'
    + orden.map(e => '<li><a href="' + esc(regionUrl(e.id)) + '">' + esc(nombre(e)) + '</a></li>').join('')
    + '</ul></details>'
}

export function buildIndexPage(nonce: string, elecciones: IndexEntry[], canonical: string): string {
  const origin = originFromCanonical(canonical)
  const nacionales = elecciones.filter(e => e.tipo !== 'autonomica')
  const tarjetas = nacionales.map(e =>
    '<a class="el" href="/politica/' + esc(e.id) + '"><span class="el-name">' + esc(e.nombre) + '</span>'
    + '<span class="el-fecha">' + textoFecha(e.fecha) + '</span>'
    + '<span class="badge">' + (e.fechaUltimoSondeo && e.estado === 'ok' ? 'Último sondeo · ' + fmtFecha(e.fechaUltimoSondeo) : esc(ESTADOS[e.estado])) + '</span>'
    + '<span class="go">' + (e.estado === 'ok' && e.fechaUltimoSondeo ? 'Ver sondeos' : 'Ver elección') + ' →</span></a>').join('')
  const cuerpo = '<h1>Elecciones y sondeos en España</h1><p class="sub">Consulta cuándo se vota y cómo cambian los escaños que estima cada encuesta.</p>'
    + (tarjetas ? '<section><h2>Elecciones de ámbito nacional</h2><div class="grid-el">' + tarjetas + '</div></section>' : '')
    + '<section><h2>Elecciones en tu comunidad</h2>' + directorio(elecciones.filter(e => e.tipo === 'autonomica'), false) + '</section>'
  return envoltorio({
    title: 'Elecciones y sondeos en España · España Útil',
    desc: 'Fechas, encuestas y resultados de las elecciones generales, europeas y autonómicas en España.',
    canonical, nonce,
    breadcrumb: breadcrumbLd([{ name: 'Inicio', url: origin + '/' }, { name: 'Política', url: canonical }]),
  }, cuerpo)
}

export function buildAutonomicasIndex(nonce: string, auton: IndexEntry[], canonical: string): string {
  const origin = originFromCanonical(canonical)
  const cuerpo = '<nav class="breadcrumb" aria-label="Volver"><a href="/politica/">← Política</a></nav>'
    + '<h1>Elecciones autonómicas</h1><section aria-label="Elegir territorio">' + directorio(auton, true) + '</section>'
  return envoltorio({
    title: 'Elecciones autonómicas y sondeos · España Útil',
    desc: 'Sondeos y fechas de las elecciones autonómicas de las 17 comunidades y de Ceuta y Melilla.',
    canonical, nonce,
    breadcrumb: breadcrumbLd([{ name: 'Inicio', url: origin + '/' }, { name: 'Política', url: origin + '/politica/' }, { name: 'Autonómicas', url: canonical }]),
  }, cuerpo)
}

interface EleccionOpts {
  pagina?: number
  nonce: string
  cat: EleccionCatalogo
  file: EleccionFile
  estado: string
  enVeda: boolean
  ahoraISO: string
  referencia?: ReferenciaSondeo
  canonical: string
}

function mapaColores(candidaturas: Candidatura[]): Map<string, { siglas: string; color: string }> {
  const m = new Map<string, { siglas: string; color: string }>()
  for (const c of candidaturas) m.set(c.id, { siglas: c.siglas, color: c.color || colorPartido(c.siglas) })
  return m
}
// Barra horizontal de escaños del resultado de referencia (SVG: usa atributos
// fill, permitidos por la CSP; nada de estilos inline) + leyenda con puntos de
// color por clase. El total y la mayoría se calculan sobre los escaños de ESA
// elección (no sobre la cámara futura), para que la barra sea coherente.
function barraResultado(file: EleccionFile, colores: Map<string, { siglas: string; color: string }>): string {
  // Orden izquierda→derecha (hemiciclo); a igualdad, el de más escaños primero.
  const sig = (id: string) => colores.get(id)?.siglas || id
  const orden = [...file.referencia.escanos].filter((r) => r.escanos > 0)
    .sort((a, b) => ordenIdeologico(sig(a.candidaturaId)) - ordenIdeologico(sig(b.candidaturaId)) || b.escanos - a.escanos)
  if (!orden.length) return '<section><h2>Último resultado oficial</h2><p class="sub">Todavía no hay un reparto de escaños disponible.</p></section>'
  const total = orden.reduce((a, r) => a + r.escanos, 0)
  const mayoria = Math.floor(total / 2) + 1
  const VB = 1000, H = 26, barY = 3, barH = 20
  const u = VB / total
  let x = 0
  const rects = orden.map((r) => {
    const info = colores.get(r.candidaturaId)
    const w = r.escanos * u
    const rect = '<rect x="' + x.toFixed(2) + '" y="' + barY + '" width="' + w.toFixed(2) + '" height="' + barH + '" fill="' + esc(info?.color || '#8a8f98') + '">'
      + '<title>' + esc(info?.siglas || r.candidaturaId) + ' ' + r.escanos + '</title></rect>'
    x += w
    return rect
  }).join('')
  const mx = (mayoria * u).toFixed(1)
  const svg = '<svg class="resbar" viewBox="0 0 ' + VB + ' ' + H + '" width="100%" preserveAspectRatio="none" role="img" aria-label="Reparto de escaños del resultado">'
    + '<defs><clipPath id="rcbar"><rect x="0" y="' + barY + '" width="' + VB + '" height="' + barH + '" rx="6" /></clipPath></defs>'
    + '<g clip-path="url(#rcbar)">' + rects + '</g>'
    + '<line x1="' + mx + '" y1="0" x2="' + mx + '" y2="' + (barY + barH + 4) + '" stroke="#1a1a1a" stroke-width="2.5" />'
    + '</svg>'
  const leyenda = orden.map((r) => {
    const info = colores.get(r.candidaturaId)
    return '<span class="it"><i class="dot sw-' + esc(r.candidaturaId) + '"></i>' + esc(info?.siglas || r.candidaturaId) + ' <b>' + r.escanos + '</b></span>'
  }).join('')
  return '<section class="resultado"><h2>Último resultado oficial</h2>'
    + '<p class="cap">Elecciones del ' + fmtFecha(file.referencia.fecha) + ' · Mayoría de esa elección: ' + mayoria + ' escaños</p>'
    + svg
    + '<div class="leyenda-res">' + leyenda + '</div>'
    + (file.id === 'generales' && file.referencia.fecha === '2023-07-23'
      ? '<p class="fuente"><a href="https://www.boe.es/diario_boe/txt.php?id=BOE-A-2023-18907">Consultar el resultado en el BOE</a></p>' : '')
    + '</section>'
}

export const SONDEOS_POR_PAGINA = 25

function urlSondeos(ruta: string, pagina: number, referencia: ReferenciaSondeo): string {
  const params = new URLSearchParams()
  if (pagina > 1) params.set('pagina', String(pagina))
  if (referencia === 'elecciones') params.set('referencia', referencia)
  return ruta + (params.size ? '?' + params : '')
}

export function buildEleccionPage(o: EleccionOpts): string {
  const { file, cat, estado, enVeda, canonical, nonce } = o
  const origin = originFromCanonical(canonical)
  const colores = mapaColores(file.candidaturas)
  const referencia = o.referencia || 'anterior'
  const ruta = new URL(canonical).pathname
  const swatch = '<style nonce="' + esc(nonce) + '">' + [...colores]
    .filter(([id, i]) => /^[a-z0-9_-]+$/i.test(id) && /^#[0-9a-f]{6}$/i.test(i.color))
    .map(([id, i]) => '.sw-' + id + '{background:' + i.color + '}').join('') + '</style>'
  let cuerpo = swatch + '<nav class="breadcrumb" aria-label="Volver"><a href="/politica/">← Política</a></nav>'
    + '<h1>' + esc(cat.nombre) + '</h1>'
    + '<p class="ficha">' + esc(file.camara.nombre) + ' · ' + file.camara.escanos + ' escaños · mayoría ' + file.camara.mayoria + '</p>'
    + '<p class="fecha-eleccion">' + textoFecha(cat.proxima, o.ahoraISO) + '</p>'
  if (estado === 'desactualizado' || estado === 'no_disponible') cuerpo += '<p class="aviso">' + ESTADOS[estado] + '</p>'

  if (enVeda) {
    cuerpo += '<p class="veda"><b>Veda electoral.</b> La difusión de sondeos está suspendida durante el periodo electoral establecido.</p>'
  } else if (!file.sondeos.length) {
    cuerpo += '<p class="aviso">Todavía no hay sondeos publicados para esta elección.</p>'
  } else {
    const orden = [...file.sondeos].sort((a, b) => (b.campoFin || '').localeCompare(a.campoFin || ''))
    const paginas = Math.ceil(orden.length / SONDEOS_POR_PAGINA)
    const pagina = Math.max(1, Math.min(paginas, Math.trunc(o.pagina || 1)))
    const offset = (pagina - 1) * SONDEOS_POR_PAGINA
    const muestra = orden.slice(offset, offset + SONDEOS_POR_PAGINA)
    const enlace = (p: number) => esc(urlSondeos(ruta, p, referencia))
    const navegacion = paginas > 1 ? '<nav class="paginas" aria-label="Páginas de sondeos">'
      + (pagina > 1 ? '<a rel="prev" href="' + enlace(pagina - 1) + '">← Más recientes</a>' : '')
      + '<span>Página ' + pagina + ' de ' + paginas + '</span>'
      + (pagina < paginas ? '<a rel="next" href="' + enlace(pagina + 1) + '">Más antiguos →</a>' : '')
      + '</nav>' : ''
    const opcion = (modo: ReferenciaSondeo, titulo: string) =>
      '<a href="' + esc(urlSondeos(ruta, pagina, modo)) + '#sondeos"' + (referencia === modo ? ' aria-current="true"' : '') + '>' + titulo + '</a>'
    cuerpo += '<section id="sondeos"><h2>' + (pagina === 1 ? 'Últimos sondeos' : 'Histórico de sondeos') + '</h2>'
      + '<nav class="referencias" aria-label="Referencia para comparar los escaños"><span>Comparar con</span><div class="opciones">'
      + opcion('anterior', 'Encuesta anterior') + opcion('elecciones', 'Elecciones del ' + fmtFecha(file.referencia.fecha)) + '</div></nav>'
      + renderSondeos(file, muestra, referencia)
      + '<p class="fuente">Sondeos ' + (offset + 1) + '–' + (offset + muestra.length) + ' de ' + orden.length + ' recopilados.</p>'
      + navegacion + '</section>'
    const topIds = [...file.referencia.escanos].sort((a, b) => b.escanos - a.escanos).map(r => r.candidaturaId)
    const partidos = [...new Set([...topIds, ...file.candidaturas.map(c => c.id)])].slice(0, 8)
    cuerpo += renderGrafica(file, muestra, partidos, colores, nonce)
  }
  cuerpo += barraResultado(file, colores)
  const pro = file.procedencia
  const wiki = /^https:\/\/(?:[a-z]+\.)?wikipedia\.org\//i.test(pro.url || '') ? pro.url : ''
  if (wiki) cuerpo += '<p class="fuente datos-fuente">Datos recopilados de <a href="' + esc(wiki) + '" rel="nofollow noopener" target="_blank">Wikipedia</a>'
    + ' («' + esc(pro.articulo) + '»' + (pro.revid ? ', rev. ' + pro.revid : '') + '), ' + esc(pro.licencia) + ', con modificaciones.</p>'
  if (file.referencia.escanos.length) cuerpo += '<p class="fuente datos-fuente">Fuente del reparto electoral: ' + esc(file.referencia.fuente) + '.</p>'
  return envoltorio({
    title: cat.nombre + ' · sondeos · España Útil',
    desc: 'Sondeos de ' + cat.nombre + '. Compara los escaños estimados con la encuesta anterior de la misma casa o con el último resultado electoral.',
    canonical, nonce, css: !enVeda && file.sondeos.length ? SONDEOS_CSS + POLITICA_GRAFICA_CSS : '',
    breadcrumb: breadcrumbLd([
      { name: 'Inicio', url: origin + '/' }, { name: 'Política', url: origin + '/politica/' },
      ...(cat.tipo === 'autonomica' ? [{ name: 'Autonómicas', url: origin + '/politica/autonomicas/' }] : []),
      { name: cat.nombre, url: canonical },
    ]),
  }, cuerpo)
}

export function politicaHeaders(nonce: string): Record<string, string> {
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
    'Cache-Control': 'public, max-age=1800, s-maxage=3600',
  }
}
