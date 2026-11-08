// Portada, directorio territorial y ficha de elecciones. Las referencias y la
// paginación se resuelven en el servidor, incluso sin JavaScript.
import type { EleccionFile, IndexEntry, Candidatura } from '../lib/politica-schemas'
import { withAccountHeaders } from '../lib/runtime'
import { diaDeCampo } from '../lib/politica'
import { colorPartido, ordenIdeologico, type EleccionCatalogo } from '../../scripts/lib/politica-catalogo.mjs'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { PORTAL_BASE_CSS } from './ui-theme'
import { ogSocialTags, originFromCanonical, breadcrumbLd } from './seo'
import { esc, fmtFecha, fmtMesAnio } from './politica-formato'
import { renderSondeos, SONDEOS_CSS, urlFuenteHttps, type ReferenciaSondeo } from './politica-sondeos'
import { renderGrafica, POLITICA_GRAFICA_CSS } from './politica-grafica'

const CSS = PORTAL_BASE_CSS + `
:root{color-scheme:light;--vd:var(--eu-accent);--ink:var(--eu-ink);--mu:var(--eu-muted);--bd:var(--eu-line);--rule:var(--eu-line);--paper:var(--eu-surface);--bg:var(--eu-soft)}

main{max-width:1120px;margin:0 auto;padding:clamp(22px,4vw,48px) clamp(16px,3vw,32px) 24px}
a{color:var(--vd);text-underline-offset:.18em}
h1,h2,.el-name{font-family:var(--eu-font);color:var(--ink);line-height:1.14}
h1{font-size:clamp(30px,4vw,48px);margin:0 0 10px;letter-spacing:-.025em}
h2{font-size:clamp(22px,3vw,28px);margin:0 0 12px}
.sub,.ficha,.fuente,.resultado .cap{color:var(--mu)}
.sub{max-width:60ch;margin:0}
main>section{margin-top:clamp(26px,4vw,42px)}
main>section+section{padding-top:clamp(18px,3vw,30px);border-top:1px solid var(--rule)}
.ficha{margin:0 0 8px;font-size:15px}.fecha-eleccion{margin:0;color:var(--ink)}
.badge{display:inline-block;align-self:flex-start;font-size:13px;margin:4px 0;color:var(--vd)}
.regional-form{display:flex;align-items:flex-end;flex-wrap:wrap;gap:8px}
.regional-form label{display:grid;gap:5px;font-size:14px;min-width:0}
.regional-form select,.regional-form button{max-width:100%;min-height:44px;border:1px solid #748476;border-radius:12px;font:inherit;padding:8px 12px}
.regional-form select{background:#fff;color:var(--ink)}.regional-form button{background:var(--vd);color:#fff;font-weight:650;cursor:pointer}
.grid-el{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,245px),1fr));gap:16px}
.el{position:relative;display:flex;flex-direction:column;gap:7px;padding:24px;background:var(--paper);border:1px solid var(--rule);border-radius:22px;transition:transform .18s ease,box-shadow .18s ease}
.el:hover{transform:translateY(-2px);box-shadow:0 10px 24px #17372b0b}.territorios a:hover{background:var(--bg)}.el-name{font-size:21px;font-weight:700}
.el-fecha{color:var(--mu);font-size:14px}.el .go{margin-top:auto;color:var(--vd);font-size:14px;font-weight:650;text-decoration:none}
.el .go::after{content:"";position:absolute;inset:0;border-radius:22px}.el .go:focus-visible::after{outline:2px solid var(--vd)}
.el .decreto{position:relative;z-index:1}.decreto{font-size:14px}.el .el-name{margin:0}.el small{color:var(--mu)}
.nota-sondeos,.pm-source{font-size:14px;color:var(--mu);margin:4px 0 12px}
.fechas-sondeos{font-size:14px;list-style:none;padding:0;margin:6px 0 12px}.fechas-sondeos li{margin:2px 0}
.territorios{margin-top:14px}.territorios summary{width:fit-content;color:var(--vd);cursor:pointer;padding:10px 0;font-weight:650}
.territorios ul{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));column-gap:18px;padding:0;margin:8px 0 0;list-style:none}
.territorios a{display:block;padding:10px 4px;border-top:1px solid var(--bd)}
.breadcrumb{font-size:14px;margin-bottom:12px}
.referencias{display:flex;align-items:center;flex-wrap:wrap;gap:6px 12px;margin:8px 0 18px}
.referencias>span{font-weight:600;font-size:14px}.referencias .opciones{display:inline-flex;flex-wrap:wrap;gap:4px}
.opciones a{display:inline-flex;align-items:center;min-height:44px;border-radius:12px;border:1px solid var(--rule);padding:7px 12px;font-size:14px;text-decoration:none}
.opciones a[aria-current]{background:var(--vd);color:#fff;border-color:var(--vd)}
.camaras{margin:12px 0}.camaras a{margin-right:4px}
.paginas{display:flex;align-items:center;flex-wrap:wrap;gap:4px 16px;font-size:14px;margin:12px 0}
.paginas a{display:inline-flex;align-items:center;min-height:44px}.paginas span{color:var(--mu)}
.resultado .cap{margin:0 0 8px}.resbar{display:block;width:100%;height:26px;margin:12px 0}
.leyenda-res{display:flex;flex-wrap:wrap;gap:8px 18px}.leyenda-res .it{display:inline-flex;align-items:center;gap:6px;font-size:14px}
.leyenda-res .dot{width:10px;height:10px;border-radius:3px}.leyenda-res b{color:var(--ink)}
.aviso,.veda{background:var(--paper);border-left:3px solid var(--rule);padding:12px 14px;margin:20px 0}
.fuente,footer{font-size:13px}.fuente{margin:16px 0 0}.datos-fuente{max-width:80ch}
footer{border-top:1px solid var(--rule);margin-top:20px;color:var(--mu);padding:20px;text-align:center}
@media(max-width:700px){
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

const calendarioMadrid = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' })

function diaEnMadrid(iso?: string | null): string | undefined {
  if (!iso) return
  if (diaDeCampo(iso) != null) return iso
  if (diaDeCampo(iso.slice(0, 10)) == null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(iso)) return
  const instante = Date.parse(iso)
  if (Number.isFinite(instante)) return calendarioMadrid.format(instante)
}

function textoFecha(p: EleccionCatalogo['proxima'], ahoraISO?: string): string {
  if (!p.valor) return p.anioPrevisto ? 'Próximas elecciones previstas en ' + p.anioPrevisto + ' · Fecha por confirmar' : 'Próxima votación pendiente de fecha oficial'
  if (!p.confirmada) return 'Prevista para ' + fmtMesAnio(p.valor) + ' · Pendiente de confirmación'
  const eleccion = diaDeCampo(p.valor)
  if (eleccion == null) return 'Próxima votación pendiente de fecha oficial'
  const hoy = diaDeCampo(diaEnMadrid(ahoraISO))
  const dias = hoy == null ? 0 : (eleccion - hoy) / 86_400_000
  return 'Votación convocada para el ' + fmtFecha(p.valor) + (dias > 0 ? (dias === 1 ? ' · Falta 1 día' : ' · Faltan ' + dias + ' días') : '')
}

function urlBoe(valor?: string): string | undefined {
  if (!valor) return
  if (/^https:\/\/(?:www\.)?boe\.es\/(?:(?:diario_boe\/txt|buscar\/doc)\.php\?id=BOE-A-\d{4}-\d+|boe\/dias\/\d{4}\/\d{2}\/\d{2}\/pdfs\/BOE-A-\d{4}-\d+\.pdf)$/i.test(valor)) return valor
}

function fuenteCalendario(fecha: IndexEntry['fecha']): string {
  if (!fecha.confirmada && fecha.anioPrevisto && /^https:\/\/elections\.europa\.eu\//i.test(fecha.fuente ?? '')) {
    return ' · <a class="decreto" href="' + esc(fecha.fuente) + '">Calendario del Parlamento Europeo</a>'
  }
  const url = urlBoe(fecha.fuente)
  if (!fecha.confirmada || diaDeCampo(fecha.valor ?? undefined) == null || !url) return ''
  return ' · <a class="decreto" href="' + esc(url) + '">Ver convocatoria en el BOE</a>'
}

function creditoRecopilacion(pro: EleccionFile['procedencia'], titulo: string): string {
  const url = urlFuenteHttps(pro.url)
  if (!url) return ''
  const etiqueta = /^(?:[a-z]+\.)?wikipedia\.org$/i.test(new URL(url).hostname) ? 'Wikipedia · ' + pro.articulo : pro.articulo
  return '<p class="fuente datos-fuente">' + titulo + ' · <a href="' + esc(url) + '" rel="nofollow noreferrer">' + esc(etiqueta) + '</a>'
    + (pro.revid ? ' (rev. ' + pro.revid + ')' : '') + (pro.licencia ? '. ' + esc(pro.licencia) + ', con modificaciones.' : '') + '</p>'
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
  const tarjetas = nacionales.map(e => {
    const entrevistas = diaDeCampo(e.fechaUltimoSondeo ?? undefined) != null ? e.fechaUltimoSondeo : undefined
    const publicacion = diaDeCampo(e.fechaUltimaPublicacion ?? undefined) != null ? e.fechaUltimaPublicacion : undefined
    const comprobacion = entrevistas || publicacion ? diaEnMadrid(e.ultimaComprobacionOk) : undefined
    const accion = e.tipo === 'europeas' ? 'Ver el último resultado' : entrevistas ? 'Ver sondeos' : 'Ver elección'
    return '<article class="el"><h3 class="el-name">' + esc(e.nombre) + '</h3>'
      + '<span class="el-fecha">' + textoFecha(e.fecha) + fuenteCalendario(e.fecha) + '</span>'
      + (entrevistas ? '<span>Fin de las últimas entrevistas recopiladas · ' + fmtFecha(entrevistas) + '</span>' : '')
      + (publicacion ? '<span>Publicación más reciente con fecha conocida · ' + fmtFecha(publicacion) + '</span>' : '')
      + (comprobacion ? '<small>Última comprobación de las fuentes · ' + fmtFecha(comprobacion) + '</small>' : '')
      + (!entrevistas || e.estado !== 'ok' ? '<span class="badge">' + esc(ESTADOS[e.estado]) + '</span>' : '')
      + '<a class="go" href="/politica/' + esc(e.id) + '" aria-label="' + accion + ' · ' + esc(e.nombre) + '">' + accion + ' →</a></article>'
  }).join('')
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

function estilosPartidos(colores: ReturnType<typeof mapaColores>, nonce: string): string {
  return '<style nonce="' + esc(nonce) + '">' + [...colores]
    .filter(([id, i]) => /^[a-z0-9_-]+$/i.test(id) && /^#[0-9a-f]{6}$/i.test(i.color))
    .map(([id, i]) => '.sw-' + id + '{background:' + i.color + '}').join('') + '</style>'
}

function cambiaCamara(activa: 'Congreso' | 'Senado'): string {
  const enlace = (nombre: 'Congreso' | 'Senado', ruta: string) =>
    '<a href="' + ruta + '"' + (nombre === activa ? ' aria-current="page"' : '') + '>' + nombre + '</a>'
  return '<nav class="camaras opciones" aria-label="Cámara de las elecciones generales">'
    + enlace('Congreso', '/politica/generales') + enlace('Senado', '/politica/generales/senado') + '</nav>'
}
// Barra horizontal de escaños del resultado de referencia (SVG: usa atributos
// fill, permitidos por la CSP; nada de estilos inline) + leyenda con puntos de
// color por clase. El total y la mayoría se calculan sobre los escaños de ESA
// elección (no sobre la cámara futura), para que la barra sea coherente.
function barraResultado(ref: EleccionFile['referencia'], colores: ReturnType<typeof mapaColores>, ambito: 'camara' | 'europeas' | 'senado', enlace?: string): string {
  // Orden izquierda→derecha (hemiciclo); a igualdad, el de más escaños primero.
  const sig = (id: string) => colores.get(id)?.siglas || id
  const orden = [...ref.escanos].filter((r) => r.escanos > 0)
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
    + (ambito === 'camara' ? '<line x1="' + mx + '" y1="0" x2="' + mx + '" y2="' + (barY + barH + 4) + '" stroke="#1a1a1a" stroke-width="2.5" />' : '')
    + '</svg>'
  const leyenda = orden.map((r) => {
    const info = colores.get(r.candidaturaId)
    return '<span class="it"><i class="dot sw-' + esc(r.candidaturaId) + '"></i>' + esc(info?.siglas || r.candidaturaId) + ' <b>' + r.escanos + '</b></span>'
  }).join('')
  const resumen = ambito === 'camara' ? 'Mayoría de esa elección: ' + mayoria + ' escaños'
    : ambito === 'europeas' ? total + ' eurodiputados elegidos en España' : total + ' senadores elegidos en las urnas'
  const titulo = ambito === 'europeas' ? 'Resultado de las elecciones europeas en España' : 'Último resultado oficial'
  const url = urlBoe(ref.url) || enlace
  return '<section class="resultado"><h2>' + titulo + '</h2>'
    + '<p class="cap">Elecciones del ' + fmtFecha(ref.fecha) + ' · ' + resumen + '</p>'
    + svg
    + '<div class="leyenda-res">' + leyenda + '</div>'
    + (url ? '<p class="fuente"><a href="' + esc(url) + '">Consultar el resultado en el BOE</a></p>' : '')
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
  const europeas = file.tipo === 'europeas'
  const anteriorBoe = file.id === 'generales' && file.referencia.fecha === '2023-07-23'
    ? 'https://www.boe.es/diario_boe/txt.php?id=BOE-A-2023-18907' : undefined
  const resultado = barraResultado(file.referencia, colores, europeas ? 'europeas' : 'camara', anteriorBoe)
  let cuerpo = estilosPartidos(colores, nonce) + '<nav class="breadcrumb" aria-label="Volver"><a href="/politica/">← Política</a></nav>'
    + '<h1>' + esc(cat.nombre) + '</h1>'
    + (file.id === 'generales' ? cambiaCamara('Congreso') : '')
    + '<p class="ficha">' + (europeas ? 'Representación de España en el Parlamento Europeo' : esc(file.camara.nombre) + ' · ' + file.camara.escanos + ' escaños · mayoría ' + file.camara.mayoria) + '</p>'
    + '<p class="fecha-eleccion">' + textoFecha(cat.proxima, o.ahoraISO) + fuenteCalendario(cat.proxima) + '</p>'
    + (europeas ? resultado : '')
  if (estado === 'desactualizado' || estado === 'no_disponible') cuerpo += '<p class="aviso">' + ESTADOS[estado] + '</p>'

  if (enVeda) {
    cuerpo += '<p class="veda"><b>Veda electoral.</b> La difusión de sondeos está suspendida durante el periodo electoral establecido.</p>'
  } else if (!file.sondeos.length) {
    const proxima = europeas && cat.proxima.anioPrevisto ? 'las europeas de ' + cat.proxima.anioPrevisto : 'la próxima votación'
    cuerpo += '<p class="aviso">Todavía no hay sondeos en nuestra recopilación para ' + proxima + '.</p>'
  } else {
    const orden = [...file.sondeos].sort((a, b) => (b.campoFin || '').localeCompare(a.campoFin || ''))
    const paginas = Math.ceil(orden.length / SONDEOS_POR_PAGINA)
    const pagina = Math.max(1, Math.min(paginas, Math.trunc(o.pagina || 1)))
    const offset = (pagina - 1) * SONDEOS_POR_PAGINA
    const muestra = orden.slice(offset, offset + SONDEOS_POR_PAGINA)
    const ultimaEntrevista = orden.find(s => diaDeCampo(s.campoFin) != null)?.campoFin
    const publicaciones = orden.map(s => s.publicacion).filter((f): f is string => diaDeCampo(f) != null)
    const ultimaPublicacion = publicaciones.sort().at(-1)
    const comprobacion = diaEnMadrid(file.ultimaComprobacionOk)
    const enlace = (p: number) => esc(urlSondeos(ruta, p, referencia))
    const navegacion = paginas > 1 ? '<nav class="paginas" aria-label="Páginas de sondeos">'
      + (pagina > 1 ? '<a rel="prev" href="' + enlace(pagina - 1) + '">← Más recientes</a>' : '')
      + '<span>Página ' + pagina + ' de ' + paginas + '</span>'
      + (pagina < paginas ? '<a rel="next" href="' + enlace(pagina + 1) + '">Más antiguos →</a>' : '')
      + '</nav>' : ''
    const opcion = (modo: ReferenciaSondeo, titulo: string) =>
      '<a href="' + esc(urlSondeos(ruta, pagina, modo)) + '#sondeos"' + (referencia === modo ? ' aria-current="true"' : '') + '>' + titulo + '</a>'
    cuerpo += '<section id="sondeos"><h2>' + (pagina === 1 ? 'Últimos sondeos' : 'Histórico de sondeos') + '</h2>'
      + '<p class="nota-sondeos">La lista reúne los sondeos de las fuentes citadas al pie, ordenados por el fin de las entrevistas.</p>'
      + (pagina === 1 ? '<ul class="fechas-sondeos">'
        + (ultimaEntrevista ? '<li>Fin de las últimas entrevistas recopiladas · ' + fmtFecha(ultimaEntrevista) + '</li>' : '')
        + (ultimaPublicacion ? '<li>Publicación más reciente con fecha conocida · ' + fmtFecha(ultimaPublicacion) + '</li>' : '')
        + (comprobacion ? '<li>Última comprobación de las fuentes · ' + fmtFecha(comprobacion) + '</li>' : '') + '</ul>' : '')
      + '<nav class="referencias" aria-label="Referencia para comparar los escaños"><span>Comparar con</span><div class="opciones">'
      + opcion('anterior', 'Encuesta anterior') + opcion('elecciones', 'Elecciones del ' + fmtFecha(file.referencia.fecha)) + '</div></nav>'
      + renderSondeos(file, muestra, referencia)
      + '<p class="fuente">Sondeos ' + (offset + 1) + '–' + (offset + muestra.length) + ' de ' + orden.length + ' recopilados.</p>'
      + navegacion + '</section>'
    const topIds = [...file.referencia.escanos].sort((a, b) => b.escanos - a.escanos).map(r => r.candidaturaId)
    const partidos = [...new Set([...topIds, ...file.candidaturas.map(c => c.id)])].slice(0, 8)
    cuerpo += renderGrafica(file, muestra, partidos, colores, nonce)
  }
  if (!europeas) cuerpo += resultado
  cuerpo += creditoRecopilacion(file.procedencia, 'Recopilación principal')
  for (const pro of file.procedenciasAdicionales ?? []) cuerpo += creditoRecopilacion(pro, 'Recopilación adicional')
  if (file.referencia.escanos.length && !urlBoe(file.referencia.url) && !anteriorBoe) cuerpo += '<p class="fuente datos-fuente">Fuente del reparto electoral: ' + esc(file.referencia.fuente) + '.</p>'
  return envoltorio({
    title: cat.nombre + (europeas ? ' · resultados' : ' · sondeos') + ' · España Útil',
    desc: europeas ? 'Resultados de las elecciones europeas en España, reparto de eurodiputados por candidatura y próxima votación.' : 'Sondeos de ' + cat.nombre + '. Compara los escaños estimados con la encuesta anterior de la misma casa o con el último resultado electoral.',
    canonical, nonce, css: !enVeda && file.sondeos.length ? SONDEOS_CSS + POLITICA_GRAFICA_CSS : '',
    breadcrumb: breadcrumbLd([
      { name: 'Inicio', url: origin + '/' }, { name: 'Política', url: origin + '/politica/' },
      ...(cat.tipo === 'autonomica' ? [{ name: 'Autonómicas', url: origin + '/politica/autonomicas/' }] : []),
      { name: cat.nombre, url: canonical },
    ]),
  }, cuerpo)
}

export function buildSenadoPage(o: EleccionOpts): string {
  const { file, cat, nonce, canonical } = o
  const origen = originFromCanonical(canonical)
  const senado = file.senado
  const colores = mapaColores(senado?.candidaturas ?? [])
  const cuerpo = estilosPartidos(colores, nonce) + '<nav class="breadcrumb" aria-label="Volver"><a href="/politica/">← Política</a></nav>'
    + '<h1>Elecciones al Senado</h1>' + cambiaCamara('Senado')
    + '<p class="fecha-eleccion">' + textoFecha(cat.proxima, o.ahoraISO) + fuenteCalendario(cat.proxima) + '</p>'
    + '<p class="nota-sondeos">Los votantes eligen a los senadores de sus circunscripciones. Los parlamentos autonómicos designan a otros senadores por separado.</p>'
    + (senado ? barraResultado(senado.referencia, colores, 'senado') : '<section><h2>Último resultado oficial</h2><p>Estamos pendientes del reparto de los senadores elegidos en las urnas.</p></section>')
    + '<section><h2>Sondeos para el Senado</h2>'
    + (o.enVeda ? '<p class="veda"><b>Veda electoral.</b> La difusión de sondeos está suspendida durante el periodo electoral establecido.</p>'
      : '<p>La recopilación de las elecciones generales estima los escaños del Congreso. Aún no hemos incorporado una encuesta con un reparto de escaños para el Senado en la próxima elección.</p>') + '</section>'
  return envoltorio({
    title: 'Elecciones al Senado · España Útil',
    desc: 'Próxima elección al Senado y último reparto de los senadores elegidos en las urnas por candidatura.',
    canonical, nonce,
    breadcrumb: breadcrumbLd([{ name: 'Inicio', url: origen + '/' }, { name: 'Política', url: origen + '/politica/' },
      { name: 'Elecciones generales', url: origen + '/politica/generales' }, { name: 'Senado', url: canonical }]),
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
    'Cache-Control': 'public, max-age=1800, s-maxage=3600',
  })
}
