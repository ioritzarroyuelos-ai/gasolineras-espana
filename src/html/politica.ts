// Páginas SSR de la vertical de POLÍTICA (elecciones + sondeos), sin JavaScript.
// Índice de elecciones, índice de autonómicas y página por elección con:
//  - cabecera (fecha/cuenta atrás, cámara y mayoría)
//  - resultado de la última elección (referencia = "escaños actuales")
//  - tabla de todos los sondeos con el sube/baja frente a esa referencia
//  - gráfica de evolución (SVG en servidor; puntos por fecha, sin unir institutos
//    distintos con una línea que sugiera una tendencia inexistente)
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

const CSS =
  ':root{color-scheme:light;--v:#16a34a;--vd:#166534;--tx:#1e293b;--mu:#64748b;--bd:#e2e8f0;--bg:#f8fafc;--sube:#15803d;--baja:#b91c1c}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.5}'
  + 'main{max-width:820px;margin:0 auto;padding:18px}'
  + 'h1{font-size:24px;line-height:1.25;margin:0 0 6px}'
  + 'h2{font-size:18px;margin:26px 0 10px}'
  + '.sub{color:var(--mu);font-size:14px;margin:0 0 16px}'
  + '.badge{display:inline-block;font-size:12px;font-weight:700;padding:2px 8px;border-radius:999px;border:1px solid var(--bd)}'
  + '.b-ok{background:#dcfce7;color:#166534;border-color:#bbf7d0}'
  + '.b-sin{background:#f1f5f9;color:#475569}'
  + '.b-old{background:#fef9c3;color:#854d0e;border-color:#fde68a}'
  + '.b-no{background:#fee2e2;color:#991b1b;border-color:#fecaca}'
  + '.cuenta{font-weight:700;color:var(--vd)}'
  + '.card{border:1px solid var(--bd);border-radius:10px;padding:14px;margin:0 0 14px;background:var(--bg)}'
  + '.ref-grid{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0 0}'
  + '.chip{display:inline-flex;align-items:baseline;gap:6px;padding:4px 10px;border-radius:999px;background:#fff;border:1px solid var(--bd);font-size:13px}'
  + '.chip .pt{width:9px;height:9px;border-radius:50%;display:inline-block}'
  + '.chip b{font-size:14px}'
  + '.grid-el{display:grid;grid-template-columns:1fr;gap:10px}'
  + '.el{display:block;border:1px solid var(--bd);border-radius:10px;padding:12px 14px;text-decoration:none;color:inherit;background:#fff}'
  + '.el:hover{background:var(--bg)}'
  + '.el .n{font-weight:600;color:var(--tx)}'
  + '.el .d{color:var(--mu);font-size:13px;margin-top:2px}'
  + '.tabla-wrap{overflow-x:auto;margin:0 0 8px}'
  + 'table.s{border-collapse:collapse;width:100%;font-size:13px;min-width:640px}'
  + 'table.s th,table.s td{padding:6px 8px;border-bottom:1px solid var(--bd);text-align:center;white-space:nowrap}'
  + 'table.s thead th{font-size:11px;text-transform:uppercase;letter-spacing:.02em;color:var(--mu);position:sticky;top:0;background:#fff}'
  + 'table.s td.emp,table.s th.emp{text-align:left;white-space:normal;min-width:150px}'
  + 'table.s .pct{color:var(--mu);font-size:12px}'
  + 'table.s .esc{font-weight:700;font-size:14px}'
  + 'table.s .d-sube{color:var(--sube);font-size:11px}'
  + 'table.s .d-baja{color:var(--baja);font-size:11px}'
  + 'table.s .d-igual,table.s .d-amb{color:var(--mu);font-size:11px}'
  + 'table.s tr.refrow td{background:#f1f5f9;font-weight:600}'
  + '.leyenda{display:flex;flex-wrap:wrap;gap:8px;margin:6px 0 14px;font-size:12px}'
  + '.leyenda span{display:inline-flex;align-items:center;gap:5px}'
  + '.leyenda i{width:10px;height:10px;border-radius:50%;display:inline-block}'
  + '.svgwrap{overflow-x:auto;border:1px solid var(--bd);border-radius:10px;background:#fff;padding:8px}'
  + '.veda{border:1px solid #fde68a;background:#fffbeb;border-radius:10px;padding:16px;margin:0 0 14px}'
  + '.veda b{color:#854d0e}'
  + '.aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:14px 0;background:var(--bg)}'
  + '.lista ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
  + '.lista li a{display:inline-block;padding:5px 10px;border:1px solid var(--bd);border-radius:999px;font-size:13px;color:var(--vd);text-decoration:none;background:#fff}'
  + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:12.5px;text-align:center}'
  + 'footer a{color:var(--vd)}'
  + '.fuente{font-size:12px;color:var(--mu);margin:10px 0 0}'
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

// Cuenta atrás / fecha prevista de una elección.
function textoFecha(cat: EleccionCatalogo, ahoraISO: string): string {
  const p = cat.proxima
  if (!p.valor) return 'Próxima fecha aún sin determinar'
  if (!p.confirmada) return 'Prevista para ' + fmtMesAnio(p.valor) + ' (sin fecha oficial)'
  const dias = Math.ceil((Date.parse(p.valor + 'T00:00:00Z') - Date.parse(ahoraISO)) / 86_400_000)
  if (dias > 0) return '<span class="cuenta">Faltan ' + dias + ' días</span> · ' + fmtFecha(p.valor) + ' (fecha oficial)'
  return 'Convocada para el ' + fmtFecha(p.valor)
}

// ---- Índice general ----
export function buildIndexPage(nonce: string, elecciones: IndexEntry[], canonical: string): string {
  const origin = originFromCanonical(canonical)
  // Ruta de página (no la del JSON): derivamos de id/tipo (hojas sin barra final).
  const linkDe = (e: IndexEntry) => e.tipo === 'autonomica' ? '/politica/autonomicas/' + e.id : '/politica/' + e.id
  const card = (e: IndexEntry) => '<a class="el" href="' + esc(linkDe(e)) + '">'
    + '<span class="n">' + esc(e.nombre) + '</span> ' + badge(e.estado)
    + '<span class="d">' + (e.fecha.valor ? (e.fecha.confirmada ? 'Fecha oficial: ' : 'Prevista: ') + fmtFecha(e.fecha.valor) : 'Sin fecha')
    + (e.fechaUltimoSondeo ? ' · último sondeo ' + fmtFecha(e.fechaUltimoSondeo) : '') + '</span></a>'
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
    + '<span class="n">' + esc(e.comunidad || e.nombre) + '</span> ' + badge(e.estado)
    + '<span class="d">' + esc(e.nombre) + (e.fechaUltimoSondeo ? ' · último sondeo ' + fmtFecha(e.fechaUltimoSondeo) : '') + '</span></a>'
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
    if (c.direccion === 'sube') return '<span class="d-sube">▲+' + c.delta + '</span>'
    if (c.direccion === 'baja') return '<span class="d-baja">▼' + c.delta + '</span>'
    return '<span class="d-igual">=</span>'
  }
  if (c.tipo === 'rango') {
    const r = (c.min === c.max ? String(c.min) : c.min + '…' + c.max)
    if (c.direccion === 'sube') return '<span class="d-sube">▲' + r + '</span>'
    if (c.direccion === 'baja') return '<span class="d-baja">▼' + r + '</span>'
    if (c.direccion === 'igual') return '<span class="d-igual">=</span>'
    return '<span class="d-amb">±</span>'
  }
  return ''
}

export function buildEleccionPage(o: EleccionOpts): string {
  const { file, cat, estado, enVeda, ahoraISO, canonical, nonce } = o
  const origin = originFromCanonical(canonical)
  const colores = mapaColores(file.candidaturas)
  const ref = refDe(file)

  // Partidos a destacar: por escaños de referencia desc (o por orden de candidaturas).
  const topIds = [...file.candidaturas].map((c) => c.id)
    .sort((a, b) => (ref.get(b) || 0) - (ref.get(a) || 0))
    .slice(0, 8)

  // Cabecera + cuenta atrás + cámara.
  let cuerpo = '<h1>' + esc(cat.nombre) + '</h1>'
    + '<p class="sub">' + textoFecha(cat, ahoraISO) + ' · ' + esc(file.camara.nombre)
    + ' (' + file.camara.escanos + ' escaños, mayoría ' + file.camara.mayoria + ') · ' + badge(estado) + '</p>'

  // Resultado de la última elección (referencia = "escaños actuales").
  if (file.referencia.escanos.length) {
    cuerpo += '<div class="card"><b>Resultado de la última elección</b> (' + fmtFecha(file.referencia.fecha) + ')'
      + '<div class="ref-grid">'
      + [...file.referencia.escanos].sort((a, b) => b.escanos - a.escanos).slice(0, 10).map((r) => {
        const info = colores.get(r.candidaturaId)
        return '<span class="chip"><i class="pt" style="background:' + esc(info?.color || '#8a8f98') + '"></i>'
          + esc(info?.siglas || r.candidaturaId) + ' <b>' + r.escanos + '</b></span>'
      }).join('')
      + '</div></div>'
  }

  if (enVeda) {
    cuerpo += '<div class="veda"><b>Veda electoral (jornada de reflexión)</b><br />'
      + 'A menos de 5 días de la votación, la ley electoral (LOREG art. 69.7) prohíbe difundir sondeos. '
      + 'Volverán a mostrarse cuando pase la votación.</div>'
  } else if (!file.sondeos.length) {
    cuerpo += '<p class="aviso">Todavía no hay sondeos publicados para esta elección. Se mostrarán aquí en cuanto las casas encuestadoras empiecen a publicarlos.</p>'
  } else {
    // Gráfica de evolución + leyenda + tabla.
    cuerpo += graficaEvolucionSvg(file, topIds, colores)
    // Leyenda
    cuerpo += '<div class="leyenda">' + topIds.map((id) => {
      const info = colores.get(id)
      return '<span><i style="background:' + esc(info?.color || '#8a8f98') + '"></i>' + esc(info?.siglas || id) + '</span>'
    }).join('') + '</div>'

    // Tabla (los más recientes primero; cap para no inflar la página).
    const CAP = 40
    const orden = [...file.sondeos].sort((a, b) => String(b.campoFin || '').localeCompare(String(a.campoFin || '')))
    const muestra = orden.slice(0, CAP)
    cuerpo += '<h2>Todos los sondeos</h2>'
    cuerpo += '<div class="tabla-wrap"><table class="s"><thead><tr>'
      + '<th class="emp">Encuestadora</th><th>Fecha</th>'
      + topIds.map((id) => '<th>' + esc(colores.get(id)?.siglas || id) + '</th>').join('')
      + '</tr></thead><tbody>'
    // Fila de referencia
    cuerpo += '<tr class="refrow"><td class="emp">Resultado ' + fmtFecha(file.referencia.fecha) + '</td><td>—</td>'
      + topIds.map((id) => '<td>' + (ref.has(id) ? '<span class="esc">' + ref.get(id) + '</span>' : '·') + '</td>').join('')
      + '</tr>'
    for (const s of muestra) {
      cuerpo += '<tr><td class="emp">' + esc(s.empresa) + (s.comitente ? ' <span class="pct">/ ' + esc(s.comitente) + '</span>' : '') + '</td>'
        + '<td>' + esc(s.fechaTexto || fmtFecha(s.campoFin)) + '</td>'
      const byId = new Map(s.datos.map((d) => [d.candidaturaId, d]))
      for (const id of topIds) {
        const d = byId.get(id)
        if (!d) { cuerpo += '<td>·</td>'; continue }
        const sv = seatVal(d.escanos)
        const cambio = calculaCambio(d.escanos, ref.has(id) ? ref.get(id)! : undefined)
        cuerpo += '<td>'
          + (d.pct != null ? '<span class="pct">' + d.pct.toFixed(1) + '%</span><br />' : '')
          + (sv != null ? '<span class="esc">' + (typeof d.escanos === 'object' && d.escanos ? d.escanos.min + '–' + d.escanos.max : sv) + '</span> ' + deltaHtml(cambio) : '·')
          + '</td>'
      }
      cuerpo += '</tr>'
    }
    cuerpo += '</tbody></table></div>'
    if (orden.length > CAP) cuerpo += '<p class="fuente">Se muestran los ' + CAP + ' sondeos más recientes de ' + orden.length + ' recopilados.</p>'
  }

  // Atribución de fuentes (CC BY-SA).
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

// Gráfica de evolución: dispersión de puntos (un color por partido) por fecha de
// trabajo de campo. NO une los puntos con líneas (institutos distintos). Línea
// horizontal en la mayoría. Devuelve '' si no hay al menos 2 sondeos con fecha.
function graficaEvolucionSvg(file: EleccionFile, topIds: string[], colores: Map<string, { siglas: string; color: string }>): string {
  const dated = file.sondeos.filter((s) => s.campoFin)
  if (dated.length < 2) return ''
  const W = 720, H = 300, ml = 34, mr = 12, mt = 12, mb = 24
  const times = dated.map((s) => Date.parse(s.campoFin! + 'T00:00:00Z')).filter((t) => !Number.isNaN(t))
  const t0 = Math.min(...times), t1 = Math.max(...times)
  const maxSeats = Math.max(file.camara.escanos, ...dated.flatMap((s) => s.datos.map((d) => {
    const v = d.escanos == null ? 0 : typeof d.escanos === 'number' ? d.escanos : d.escanos.max
    return v || 0
  })))
  const x = (t: number) => ml + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (W - ml - mr)
  const y = (v: number) => mt + (1 - v / maxSeats) * (H - mt - mb)

  let svg = '<div class="svgwrap"><svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" '
    + 'aria-label="Evolución de los escaños estimados por sondeo">'
  // Ejes / rejilla y
  svg += '<line x1="' + ml + '" y1="' + mt + '" x2="' + ml + '" y2="' + (H - mb) + '" stroke="#cbd5e1" />'
  svg += '<line x1="' + ml + '" y1="' + (H - mb) + '" x2="' + (W - mr) + '" y2="' + (H - mb) + '" stroke="#cbd5e1" />'
  // Línea de mayoría
  const ym = y(file.camara.mayoria)
  svg += '<line x1="' + ml + '" y1="' + ym.toFixed(1) + '" x2="' + (W - mr) + '" y2="' + ym.toFixed(1) + '" stroke="#94a3b8" stroke-dasharray="4 4" />'
  svg += '<text x="' + (W - mr) + '" y="' + (ym - 3).toFixed(1) + '" font-size="10" fill="#64748b" text-anchor="end">mayoría ' + file.camara.mayoria + '</text>'
  // Etiquetas eje y (0 y max)
  svg += '<text x="' + (ml - 4) + '" y="' + (H - mb) + '" font-size="10" fill="#64748b" text-anchor="end">0</text>'
  svg += '<text x="' + (ml - 4) + '" y="' + (mt + 8) + '" font-size="10" fill="#64748b" text-anchor="end">' + maxSeats + '</text>'
  // Etiquetas eje x (años inicio/fin)
  svg += '<text x="' + ml + '" y="' + (H - 6) + '" font-size="10" fill="#64748b">' + new Date(t0).getUTCFullYear() + '</text>'
  svg += '<text x="' + (W - mr) + '" y="' + (H - 6) + '" font-size="10" fill="#64748b" text-anchor="end">' + new Date(t1).getUTCFullYear() + '</text>'
  // Puntos por partido
  for (const id of topIds) {
    const color = colores.get(id)?.color || '#8a8f98'
    let pts = ''
    for (const s of dated) {
      const d = s.datos.find((x) => x.candidaturaId === id)
      if (!d) continue
      const v = d.escanos == null ? null : typeof d.escanos === 'number' ? d.escanos : (d.escanos.min + d.escanos.max) / 2
      if (v == null) continue
      const t = Date.parse(s.campoFin! + 'T00:00:00Z')
      if (Number.isNaN(t)) continue
      pts += '<circle cx="' + x(t).toFixed(1) + '" cy="' + y(v).toFixed(1) + '" r="2.4" fill="' + esc(color) + '" opacity="0.8" />'
    }
    svg += pts
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
    // Se refresca a diario; cache media en CDN.
    'Cache-Control': 'public, max-age=1800, s-maxage=3600',
  }
}
