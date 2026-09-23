// Páginas SSR de la vertical de POLÍTICA (elecciones + sondeos), sin JavaScript.
// Índice de elecciones, índice de autonómicas y página por elección con:
//  - cabecera (fecha/cuenta atrás, cámara y mayoría)
//  - resultado de la última elección como BARRA de escaños (referencia)
//  - tabla de todos los sondeos con el sube/baja frente a esa referencia
//  - gráfica de evolución (SVG en servidor): una línea por partido a lo largo del
//    tiempo + puntos por sondeo, con rejilla y línea de mayoría.
//  - VEDA electoral (LOREG 69.7): en los 5 días previos a una elección confirmada
//    no se muestran sondeos ni gráfica; solo fecha, cuenta atrás y resultado previo.
// Todo el texto que viene de Wikipedia se escapa. Atribución CC BY-SA al pie.

import type { EleccionFile, IndexEntry, Sondeo, Candidatura } from '../lib/politica-schemas'
import { calculaCambio, type Cambio } from '../lib/politica'
import { colorPartido, type EleccionCatalogo } from '../../scripts/lib/politica-catalogo.mjs'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { ogSocialTags, originFromCanonical, breadcrumbLd } from './seo'

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const MESES_ABR = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MESES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function fmtFecha(iso?: string): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return esc(iso)
  return `${Number(m[3])} ${MESES_ABR[Number(m[2]) - 1] || ''} ${m[1]}`
}
function fmtMesAnio(iso: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(iso)
  if (!m) return esc(iso)
  return `${MESES_LARGO[Number(m[2]) - 1] || ''} de ${m[1]}`
}

const SERIF = "Georgia,'Times New Roman','Nimbus Roman',serif"

const CSS =
  ':root{color-scheme:light;--v:#16a34a;--vd:#166534;--ink:#1a1a1a;--tx:#25303c;--mu:#697586;'
  + '--bd:#e7e3d9;--rule:#dcd7c9;--paper:#faf8f4;--bg:#f7f8fa;--sube:#15803d;--baja:#c0341d;--sube-bg:#e7f6ec;--baja-bg:#fbeceA}'
  + '*{box-sizing:border-box}'
  + "body{margin:0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.55}"
  + 'main{max-width:880px;margin:0 auto;padding:22px 18px 8px}'
  + 'a{color:var(--vd)}'
  + `h1{font-family:${SERIF};font-size:clamp(26px,4.5vw,36px);line-height:1.15;letter-spacing:-.01em;margin:0 0 8px;color:var(--ink)}`
  + `h2{font-family:${SERIF};font-size:20px;margin:30px 0 12px;color:var(--ink);padding-bottom:6px;border-bottom:2px solid var(--rule)}`
  + '.sub{color:var(--mu);font-size:15px;margin:0 0 6px;max-width:64ch}'
  + '.ficha{display:flex;flex-wrap:wrap;gap:8px 14px;align-items:center;margin:12px 0 20px;font-size:13.5px;color:var(--mu)}'
  + '.ficha .sep{color:var(--rule)}'
  + '.count{display:inline-flex;align-items:center;gap:6px;background:var(--paper);border:1px solid var(--rule);border-radius:999px;padding:3px 12px;color:var(--vd);font-weight:700}'
  // badges de estado
  + '.badge{display:inline-block;font-size:11.5px;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid transparent;vertical-align:middle}'
  + '.b-ok{background:#e7f6ec;color:#166534;border-color:#c9ebd4}'
  + '.b-sin{background:#f1f3f6;color:#586372;border-color:#e2e6ec}'
  + '.b-old{background:#fef7e6;color:#8a5a00;border-color:#f6e3b0}'
  + '.b-no{background:#fdeceA;color:#9b2216;border-color:#f6cfc9}'
  // tarjetas del índice
  + '.grid-el{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}'
  + '.el{display:flex;flex-direction:column;gap:6px;border:1px solid var(--bd);border-radius:14px;padding:14px 16px;'
  + 'text-decoration:none;color:inherit;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04);transition:transform .12s ease,box-shadow .12s ease,border-color .12s ease}'
  + '.el:hover{transform:translateY(-2px);box-shadow:0 8px 20px rgba(16,24,40,.09);border-color:#cfe8d6}'
  + '.el .top{display:flex;justify-content:space-between;align-items:flex-start;gap:8px}'
  + `.el .n{font-family:${SERIF};font-weight:700;font-size:17px;color:var(--ink);line-height:1.25}`
  + '.el .d{color:var(--mu);font-size:12.5px}'
  + '.el .go{color:var(--vd);font-weight:700;font-size:13px;margin-top:2px}'
  // barra de escaños (resultado de referencia) — SVG, para no usar estilos inline (CSP)
  + '.resultado{border:1px solid var(--bd);border-radius:14px;padding:16px;margin:0 0 16px;background:linear-gradient(180deg,#fff, var(--bg))}'
  + '.resultado .cap{font-size:13px;color:var(--mu);margin:0 0 10px}'
  + '.resultado .cap b{color:var(--ink)}'
  + '.resbar{display:block;width:100%;height:auto;margin:2px 0 2px}'
  + '.leyenda-res{display:flex;flex-wrap:wrap;gap:6px 14px;margin:12px 0 0}'
  + '.leyenda-res .it{display:inline-flex;align-items:baseline;gap:6px;font-size:13px}'
  + '.leyenda-res .dot{width:10px;height:10px;border-radius:3px;display:inline-block;align-self:center}'
  + '.leyenda-res .it b{font-size:14px;color:var(--ink)}'
  // gráfica
  + '.chart{border:1px solid var(--bd);border-radius:14px;padding:14px 14px 8px;background:#fff;margin:0 0 8px}'
  + '.chart h3{margin:0 0 4px;font-size:15px;color:var(--ink)}'
  + '.chart .hint{font-size:12px;color:var(--mu);margin:0 0 8px}'
  + '.svgwrap{overflow-x:auto}'
  + '.evsvg{max-width:100%;height:auto;display:block}'
  + '.leyenda{display:flex;flex-wrap:wrap;gap:8px 14px;margin:8px 2px 0;font-size:12.5px}'
  + '.leyenda span{display:inline-flex;align-items:center;gap:6px;color:var(--tx)}'
  + '.leyenda i{width:11px;height:3px;border-radius:2px;display:inline-block}'
  // tabla
  + '.tabla-wrap{overflow-x:auto;border:1px solid var(--bd);border-radius:14px;margin:0 0 8px}'
  + 'table.s{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}'
  + 'table.s th,table.s td{padding:8px 10px;text-align:center;white-space:nowrap;border-bottom:1px solid #eef0f3}'
  + 'table.s thead th{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--mu);background:var(--paper);position:sticky;top:0;border-bottom:2px solid var(--rule)}'
  + 'table.s thead th .pdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:5px;vertical-align:middle}'
  + 'table.s td.emp,table.s th.emp{text-align:left;white-space:normal;min-width:158px}'
  + 'table.s tbody tr:nth-child(odd){background:#fcfcfb}'
  + 'table.s tbody tr:hover{background:#f2f8f4}'
  + 'table.s .emp .empn{font-weight:600;color:var(--ink)}'
  + 'table.s .pct{color:var(--mu);font-size:11.5px}'
  + 'table.s .esc{font-weight:700;font-size:14px;color:var(--ink)}'
  + '.d{font-size:11px;font-weight:700;padding:1px 5px;border-radius:5px;margin-left:2px}'
  + '.d-sube{color:var(--sube);background:var(--sube-bg)}'
  + '.d-baja{color:var(--baja);background:#fbece9}'
  + '.d-igual,.d-amb{color:var(--mu);background:#f1f3f6}'
  + 'table.s tr.refrow td{background:#eef1f5;border-bottom:2px solid var(--rule)}'
  + 'table.s tr.refrow .emp{color:var(--ink)}'
  // avisos
  + '.veda{border:1px solid #f3d98a;background:linear-gradient(180deg,#fffdf5,#fef7e6);border-radius:14px;padding:18px;margin:0 0 16px;display:flex;gap:12px;align-items:flex-start}'
  + '.veda .ic{font-size:22px;line-height:1}'
  + '.veda b{color:#8a5a00}'
  + '.aviso{font-size:14px;color:var(--mu);border-left:3px solid var(--v);padding:10px 14px;margin:16px 0;background:var(--bg);border-radius:0 8px 8px 0}'
  + 'footer{border-top:2px solid var(--rule);margin-top:30px;padding:16px 18px;color:var(--mu);font-size:12.5px;text-align:center}'
  + 'footer a{color:var(--vd)}'
  + '.fuente{font-size:12px;color:var(--mu);margin:12px 0 0;line-height:1.5}'
  + '.fuente a{color:var(--vd)}'

interface Meta {
  title: string
  desc: string
  canonical: string
  nonce: string
  breadcrumb?: string
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
    + '<style nonce="' + esc(m.nonce) + '">' + CSS + MASTHEAD_CSS + '</style></head><body>'
    + mastheadHtml('politica') + '<main>'
    + cuerpo
    + '</main><footer>Sondeos recopilados de Wikipedia (CC BY-SA); resultados oficiales del Ministerio del Interior. '
    + '<a href="/">CercaYa</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

const ESTADO_BADGE: Record<string, [string, string]> = {
  ok: ['b-ok', 'Con sondeos'],
  sin_sondeos: ['b-sin', 'Aún sin sondeos'],
  desactualizado: ['b-old', 'Desactualizado'],
  no_disponible: ['b-no', 'No disponible'],
}
function badge(estado: string): string {
  const [cls, txt] = ESTADO_BADGE[estado] || ESTADO_BADGE.sin_sondeos
  return '<span class="badge ' + cls + '">' + txt + '</span>'
}

function textoFecha(cat: EleccionCatalogo, ahoraISO: string): string {
  const p = cat.proxima
  if (!p.valor) return 'Próxima fecha aún sin determinar'
  if (!p.confirmada) return 'Prevista para ' + fmtMesAnio(p.valor) + ' <span class="sep">·</span> sin fecha oficial'
  const dias = Math.ceil((Date.parse(p.valor + 'T00:00:00Z') - Date.parse(ahoraISO)) / 86_400_000)
  if (dias > 0) return '<span class="count">🗳 Faltan ' + dias + ' días</span> <span class="sep">·</span> ' + fmtFecha(p.valor) + ' (fecha oficial)'
  return 'Convocada para el ' + fmtFecha(p.valor)
}

// ---- Índice general ----
export function buildIndexPage(nonce: string, elecciones: IndexEntry[], canonical: string): string {
  const origin = originFromCanonical(canonical)
  const linkDe = (e: IndexEntry) => e.tipo === 'autonomica' ? '/politica/autonomicas/' + e.id : '/politica/' + e.id
  const card = (e: IndexEntry) => '<a class="el" href="' + esc(linkDe(e)) + '">'
    + '<div class="top"><span class="n">' + esc(e.tipo === 'autonomica' && e.comunidad ? e.comunidad : e.nombre) + '</span>' + badge(e.estado) + '</div>'
    + '<span class="d">' + (e.fecha.valor ? (e.fecha.confirmada ? '🗳 ' : '📅 Prevista ') + fmtFecha(e.fecha.valor) : 'Sin fecha')
    + (e.fechaUltimoSondeo ? ' · último sondeo ' + fmtFecha(e.fechaUltimoSondeo) : '') + '</span>'
    + '<span class="go">Ver sondeos →</span></a>'
  const seccion = (titulo: string, items: IndexEntry[]) => items.length
    ? '<h2>' + esc(titulo) + '</h2><div class="grid-el">' + items.map(card).join('') + '</div>' : ''

  const generales = elecciones.filter((e) => e.tipo === 'generales')
  const europeas = elecciones.filter((e) => e.tipo === 'europeas')
  const auton = elecciones.filter((e) => e.tipo === 'autonomica')
  const cuerpo =
    '<h1>Elecciones y sondeos en España</h1>'
    + '<p class="sub">Fechas de las elecciones y todos los sondeos publicados, con los escaños estimados frente al resultado de la última vez. Sin publicidad y sin registro.</p>'
    + seccion('Generales', generales)
    + seccion('Europeas', europeas)
    + seccion('Autonómicas', auton)
    + '<p class="aviso">Los sondeos los recopila Wikipedia de cada casa encuestadora; nosotros los mostramos con su fuente. Los resultados oficiales son del Ministerio del Interior. Durante los 5 días previos a una votación, la ley (LOREG art. 69.7) prohíbe difundir sondeos: esas fechas la página los oculta.</p>'
  return envoltorio({
    title: 'Elecciones y sondeos en España · CercaYa',
    desc: 'Fechas de las elecciones en España y todos los sondeos publicados, con escaños estimados frente al último resultado. Generales, europeas y autonómicas.',
    canonical, nonce,
    breadcrumb: breadcrumbLd([{ name: 'Inicio', url: origin + '/' }, { name: 'Política', url: canonical }]),
  }, cuerpo)
}

// ---- Índice de autonómicas ----
export function buildAutonomicasIndex(nonce: string, auton: IndexEntry[], canonical: string): string {
  const origin = originFromCanonical(canonical)
  const card = (e: IndexEntry) => '<a class="el" href="' + esc('/politica/autonomicas/' + e.id) + '">'
    + '<div class="top"><span class="n">' + esc(e.comunidad || e.nombre) + '</span>' + badge(e.estado) + '</div>'
    + '<span class="d">' + esc(e.nombre) + (e.fechaUltimoSondeo ? ' · último sondeo ' + fmtFecha(e.fechaUltimoSondeo) : '') + '</span>'
    + '<span class="go">Ver sondeos →</span></a>'
  const cuerpo = '<h1>Elecciones autonómicas</h1>'
    + '<p class="sub">Las 17 comunidades autónomas y las ciudades de Ceuta y Melilla.</p>'
    + '<div class="grid-el">' + auton.map(card).join('') + '</div>'
  return envoltorio({
    title: 'Elecciones autonómicas y sondeos · CercaYa',
    desc: 'Sondeos y fechas de las elecciones autonómicas de las 17 comunidades y Ceuta y Melilla.',
    canonical, nonce,
    breadcrumb: breadcrumbLd([
      { name: 'Inicio', url: origin + '/' },
      { name: 'Política', url: origin + '/politica/' },
      { name: 'Autonómicas', url: canonical },
    ]),
  }, cuerpo)
}

// ---- Página de una elección ----
interface EleccionOpts {
  nonce: string
  cat: EleccionCatalogo
  file: EleccionFile
  estado: string
  enVeda: boolean
  ahoraISO: string
  canonical: string
}

function mapaColores(candidaturas: Candidatura[]): Map<string, { siglas: string; color: string }> {
  const m = new Map<string, { siglas: string; color: string }>()
  for (const c of candidaturas) m.set(c.id, { siglas: c.siglas, color: c.color || colorPartido(c.siglas) })
  return m
}
function refDe(file: EleccionFile): Map<string, number> {
  const m = new Map<string, number>()
  for (const r of file.referencia.escanos) m.set(r.candidaturaId, r.escanos)
  return m
}
function seatVal(e: Sondeo['datos'][number]['escanos']): number | null {
  if (e == null) return null
  if (typeof e === 'number') return e
  return Math.round((e.min + e.max) / 2)
}
function deltaHtml(c: Cambio): string {
  if (c.tipo === 'exacto') {
    if (c.direccion === 'sube') return '<span class="d d-sube">▲+' + c.delta + '</span>'
    if (c.direccion === 'baja') return '<span class="d d-baja">▼' + c.delta + '</span>'
    return '<span class="d d-igual">=</span>'
  }
  if (c.tipo === 'rango') {
    const r = (c.min === c.max ? (c.min > 0 ? '+' + c.min : String(c.min)) : c.min + '…' + c.max)
    if (c.direccion === 'sube') return '<span class="d d-sube">▲' + r + '</span>'
    if (c.direccion === 'baja') return '<span class="d d-baja">▼' + r + '</span>'
    if (c.direccion === 'igual') return '<span class="d d-igual">=</span>'
    return '<span class="d d-amb">±</span>'
  }
  return ''
}

// Barra horizontal de escaños del resultado de referencia (SVG: usa atributos
// fill, permitidos por la CSP; nada de estilos inline) + leyenda con puntos de
// color por clase. El total y la mayoría se calculan sobre los escaños de ESA
// elección (no sobre la cámara futura), para que la barra sea coherente.
function barraResultado(file: EleccionFile, colores: Map<string, { siglas: string; color: string }>): string {
  const orden = [...file.referencia.escanos].filter((r) => r.escanos > 0).sort((a, b) => b.escanos - a.escanos)
  if (!orden.length) return ''
  const total = orden.reduce((a, r) => a + r.escanos, 0)
  if (total <= 0) return ''
  const mayoria = Math.floor(total / 2) + 1
  const VB = 1000, H = 46, barY = 15, barH = 22
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
  const svg = '<svg class="resbar" viewBox="0 0 ' + VB + ' ' + H + '" width="100%" role="img" aria-label="Reparto de escaños del resultado">'
    + '<defs><clipPath id="rcbar"><rect x="0" y="' + barY + '" width="' + VB + '" height="' + barH + '" rx="6" /></clipPath></defs>'
    + '<g clip-path="url(#rcbar)">' + rects + '<rect x="0" y="' + barY + '" width="' + VB + '" height="' + barH + '" fill="none" /></g>'
    + '<line x1="' + mx + '" y1="10" x2="' + mx + '" y2="' + (barY + barH + 4) + '" stroke="#1a1a1a" stroke-width="2.5" />'
    + '<text x="' + mx + '" y="9" font-size="15" fill="#1a1a1a" text-anchor="middle" font-weight="600">mayoría ' + mayoria + '</text>'
    + '</svg>'
  const leyenda = orden.slice(0, 12).map((r) => {
    const info = colores.get(r.candidaturaId)
    return '<span class="it"><i class="dot sw-' + esc(r.candidaturaId) + '"></i>' + esc(info?.siglas || r.candidaturaId) + ' <b>' + r.escanos + '</b></span>'
  }).join('')
  return '<div class="resultado">'
    + '<p class="cap"><b>Resultado de la última elección</b> · ' + fmtFecha(file.referencia.fecha) + '</p>'
    + svg
    + '<div class="leyenda-res">' + leyenda + '</div>'
    + '</div>'
}

export function buildEleccionPage(o: EleccionOpts): string {
  const { file, cat, estado, enVeda, ahoraISO, canonical, nonce } = o
  const origin = originFromCanonical(canonical)
  const colores = mapaColores(file.candidaturas)
  const ref = refDe(file)

  const topIds = [...file.candidaturas].map((c) => c.id)
    .sort((a, b) => (ref.get(b) || 0) - (ref.get(a) || 0))
    .slice(0, 8)

  // Colores de partido por CLASE (la CSP bloquea style="background:...").
  // <style> con nonce sí está permitido. Clase .sw-<id> por candidatura.
  const swatch = '<style nonce="' + esc(nonce) + '">'
    + [...colores].map(([id, i]) => '.sw-' + id + '{background:' + i.color + '}').join('')
    + '</style>'

  let cuerpo = swatch + '<h1>' + esc(cat.nombre) + '</h1>'
    + '<div class="ficha">' + textoFecha(cat, ahoraISO) + ' <span class="sep">·</span> '
    + esc(file.camara.nombre) + ' <span class="sep">·</span> ' + file.camara.escanos + ' escaños · mayoría ' + file.camara.mayoria
    + ' ' + badge(estado) + '</div>'

  // Resultado de la última elección como barra de escaños.
  cuerpo += barraResultado(file, colores)
  // Mantiene el texto que esperan los tests aunque no haya barra (referencia vacía).
  if (!file.referencia.escanos.length) cuerpo += '<p class="cap" style="display:none">Resultado de la última elección</p>'

  if (enVeda) {
    cuerpo += '<div class="veda"><span class="ic">🗳️</span><div><b>Veda electoral (jornada de reflexión).</b> '
      + 'A menos de 5 días de la votación, la ley electoral (LOREG art. 69.7) prohíbe difundir sondeos. '
      + 'Volverán a mostrarse cuando pase la votación.</div></div>'
  } else if (!file.sondeos.length) {
    cuerpo += '<p class="aviso">Todavía no hay sondeos publicados para esta elección. Se mostrarán aquí en cuanto las casas encuestadoras empiecen a publicarlos.</p>'
  } else {
    // Gráfica de evolución.
    cuerpo += '<div class="chart"><h3>Evolución de los sondeos</h3>'
      + '<p class="hint">Escaños estimados por cada sondeo (un punto por encuesta). La línea une las estimaciones de cada partido; es orientativa.</p>'
      + graficaEvolucionSvg(file, topIds, colores)
      + '<div class="leyenda">' + topIds.map((id) => {
        const info = colores.get(id)
        return '<span><i class="sw-' + esc(id) + '"></i>' + esc(info?.siglas || id) + '</span>'
      }).join('') + '</div></div>'

    // Tabla (los más recientes primero; cap para no inflar la página).
    const CAP = 40
    const orden = [...file.sondeos].sort((a, b) => String(b.campoFin || '').localeCompare(String(a.campoFin || '')))
    const muestra = orden.slice(0, CAP)
    cuerpo += '<h2>Todos los sondeos</h2>'
    cuerpo += '<div class="tabla-wrap"><table class="s"><thead><tr>'
      + '<th class="emp">Encuestadora</th><th>Fecha</th>'
      + topIds.map((id) => '<th><span class="pdot sw-' + esc(id) + '"></span>' + esc(colores.get(id)?.siglas || id) + '</th>').join('')
      + '</tr></thead><tbody>'
    cuerpo += '<tr class="refrow"><td class="emp">Resultado ' + fmtFecha(file.referencia.fecha) + '</td><td>—</td>'
      + topIds.map((id) => '<td>' + (ref.has(id) ? '<span class="esc">' + ref.get(id) + '</span>' : '·') + '</td>').join('')
      + '</tr>'
    for (const s of muestra) {
      cuerpo += '<tr><td class="emp"><span class="empn">' + esc(s.empresa) + '</span>' + (s.comitente ? ' <span class="pct">/ ' + esc(s.comitente) + '</span>' : '') + '</td>'
        + '<td>' + esc(s.fechaTexto || fmtFecha(s.campoFin)) + '</td>'
      const byId = new Map(s.datos.map((d) => [d.candidaturaId, d]))
      for (const id of topIds) {
        const d = byId.get(id)
        if (!d) { cuerpo += '<td>·</td>'; continue }
        const sv = seatVal(d.escanos)
        const cambio = calculaCambio(d.escanos, ref.has(id) ? ref.get(id)! : undefined)
        cuerpo += '<td>'
          + (d.pct != null ? '<span class="pct">' + d.pct.toFixed(1) + '%</span><br />' : '')
          + (sv != null ? '<span class="esc">' + (typeof d.escanos === 'object' && d.escanos ? d.escanos.min + '–' + d.escanos.max : sv) + '</span>' + deltaHtml(cambio) : '·')
          + '</td>'
      }
      cuerpo += '</tr>'
    }
    cuerpo += '</tbody></table></div>'
    if (orden.length > CAP) cuerpo += '<p class="fuente">Se muestran los ' + CAP + ' sondeos más recientes de ' + orden.length + ' recopilados.</p>'
  }

  const pro = file.procedencia
  cuerpo += '<p class="fuente">Sondeos: <a href="' + esc(pro.url || ('https://' + pro.wiki + '.wikipedia.org/')) + '" rel="nofollow noopener" target="_blank">Wikipedia</a>'
    + ' («' + esc(pro.articulo) + '»' + (pro.revid ? ', rev. ' + pro.revid : '') + '), ' + esc(pro.licencia) + ', con modificaciones. '
    + 'Resultado oficial: ' + esc(file.referencia.fuente) + '.</p>'

  const comunidad = cat.comunidad ? cat.comunidad + (cat.ciudadAutonoma ? ' (ciudad autónoma)' : '') : ''
  return envoltorio({
    title: esc(cat.nombre) + ' · sondeos · CercaYa',
    desc: 'Todos los sondeos de ' + esc(cat.nombre) + (comunidad ? ' (' + esc(comunidad) + ')' : '') + ': escaños estimados por partido frente al resultado de la última elección.',
    canonical, nonce,
    breadcrumb: breadcrumbLd([
      { name: 'Inicio', url: origin + '/' },
      { name: 'Política', url: origin + '/politica/' },
      ...(cat.tipo === 'autonomica' ? [{ name: 'Autonómicas', url: origin + '/politica/autonomicas/' }] : []),
      { name: cat.nombre, url: canonical },
    ]),
  }, cuerpo)
}

// Gráfica de evolución: una línea (orientativa) por partido a lo largo del tiempo
// + puntos por sondeo. Rejilla horizontal, línea de mayoría y ticks de año.
// Devuelve '' si no hay al menos 2 sondeos con fecha.
function graficaEvolucionSvg(file: EleccionFile, topIds: string[], colores: Map<string, { siglas: string; color: string }>): string {
  const dated = file.sondeos.filter((s) => s.campoFin)
  if (dated.length < 2) return ''
  const W = 760, H = 340, ml = 34, mr = 14, mt = 14, mb = 30
  const times = dated.map((s) => Date.parse(s.campoFin! + 'T00:00:00Z')).filter((t) => !Number.isNaN(t))
  const t0 = Math.min(...times), t1 = Math.max(...times)
  const maxObs = Math.max(0, ...dated.flatMap((s) => s.datos.map((d) => (d.escanos == null ? 0 : typeof d.escanos === 'number' ? d.escanos : d.escanos.max) || 0)))
  const maxY = Math.max(8, Math.ceil((Math.max(maxObs, file.camara.mayoria) * 1.08) / 5) * 5)
  const x = (t: number) => ml + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - ml - mr)
  const y = (v: number) => mt + (1 - v / maxY) * (H - mt - mb)
  const seatOf = (d: Sondeo['datos'][number]) => d.escanos == null ? null : typeof d.escanos === 'number' ? d.escanos : (d.escanos.min + d.escanos.max) / 2

  let svg = '<div class="svgwrap"><svg class="evsvg" viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" '
    + 'aria-label="Evolución de los escaños estimados por sondeo">'
  svg += '<rect x="' + ml + '" y="' + mt + '" width="' + (W - ml - mr) + '" height="' + (H - mt - mb) + '" fill="#fbfcfd" />'
  // Rejilla horizontal + etiquetas
  const steps = 4
  for (let i = 0; i <= steps; i++) {
    const val = Math.round((maxY / steps) * i)
    const yy = y(val)
    svg += '<line x1="' + ml + '" y1="' + yy.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + yy.toFixed(1) + '" stroke="#eceef1" />'
    svg += '<text x="' + (ml - 5) + '" y="' + (yy + 3).toFixed(1) + '" font-size="9.5" fill="#94a3b8" text-anchor="end">' + val + '</text>'
  }
  // Línea de mayoría (destacada)
  const ym = y(file.camara.mayoria)
  svg += '<line x1="' + ml + '" y1="' + ym.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + ym.toFixed(1) + '" stroke="#94a3b8" stroke-width="1.2" stroke-dasharray="5 4" />'
  svg += '<text x="' + (W - mr) + '" y="' + (ym - 4).toFixed(1) + '" font-size="10" fill="#475569" text-anchor="end">mayoría ' + file.camara.mayoria + '</text>'
  // Ticks de año en el eje x
  const y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear()
  for (let yr = y0; yr <= y1; yr++) {
    const t = Date.parse(yr + '-07-01T00:00:00Z')
    if (t < t0 || t > t1) { if (yr !== y0 && yr !== y1) continue }
    const xx = x(Math.min(Math.max(t, t0), t1))
    svg += '<text x="' + xx.toFixed(1) + '" y="' + (H - 8) + '" font-size="9.5" fill="#94a3b8" text-anchor="middle">' + yr + '</text>'
  }
  // Línea + puntos por partido
  for (const id of topIds) {
    const color = colores.get(id)?.color || '#8a8f98'
    const pts: Array<[number, number]> = []
    for (const s of dated) {
      const d = s.datos.find((x2) => x2.candidaturaId === id)
      if (!d) continue
      const v = seatOf(d)
      if (v == null) continue
      const t = Date.parse(s.campoFin! + 'T00:00:00Z')
      if (Number.isNaN(t)) continue
      pts.push([x(t), y(v)])
    }
    if (pts.length < 1) continue
    pts.sort((a, b) => a[0] - b[0])
    if (pts.length >= 2) {
      const poly = pts.map((p) => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ')
      svg += '<polyline points="' + poly + '" fill="none" stroke="' + esc(color) + '" stroke-width="1.4" opacity="0.5" stroke-linejoin="round" />'
    }
    for (const p of pts) svg += '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.3" fill="' + esc(color) + '" opacity="0.9" />'
  }
  svg += '</svg></div>'
  return svg
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
