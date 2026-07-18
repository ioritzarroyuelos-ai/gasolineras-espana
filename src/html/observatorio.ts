// Observatorio de precios de carburante — pagina de datos, pensada para SER
// CITADA.
//
// El Geoportal del Ministerio publica la foto de hoy y nada mas: no compara
// provincias, no compara marcas y no guarda historico. Los agregadores que
// compiten beben de ese mismo fichero. Esta pagina existe para ofrecer lo que
// ninguno da — ranking, diferencia entre extremos y variacion — porque es lo
// unico que un medio puede citar y enlazar, y los enlaces son lo que hace
// posicionar al resto del sitio.
//
// Se renderiza en servidor y se actualiza sola con cada snapshot.

import type { Observatorio, ProvinciaPrecio, MarcaPrecio } from '../lib/observatorio'

export interface Variacion {
  dias: number
  pct: number | null
}

export interface ObservatorioPageData {
  obs: Observatorio
  variacionG95: Variacion[]
  variacionDiesel: Variacion[]
  canonical: string
  deposito: number   // litros usados para traducir la diferencia a euros
}

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const eur = (n: number) => n.toFixed(3).replace('.', ',')
const cent = (n: number) => (n * 100).toFixed(1).replace('.', ',')

function fechaMinisterio(f?: string): string {
  if (!f) return ''
  const m = f.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}:\d{2})/)
  return m ? `${m[1]}/${m[2]}/${m[3]} a las ${m[4]}` : f
}

function flecha(pct: number | null): string {
  if (pct == null) return ''
  if (pct > 0.05) return '<span class="o-up">+' + String(pct).replace('.', ',') + '%</span>'
  if (pct < -0.05) return '<span class="o-down">' + String(pct).replace('.', ',') + '%</span>'
  return '<span class="o-flat">sin cambios</span>'
}

function tablaProvincias(rows: ProvinciaPrecio[], baratas: boolean): string {
  const list = baratas ? rows.slice(0, 10) : rows.slice(-10).reverse()
  return '<table class="o-tabla"><thead><tr><th>#</th><th>Provincia</th><th>&euro;/L</th><th>Estaciones</th></tr></thead><tbody>'
    + list.map((p, i) =>
        '<tr><td>' + (i + 1) + '</td>'
        + '<td><a href="/gasolineras/' + esc(p.slug) + '">' + esc(p.name) + '</a></td>'
        + '<td class="o-num"><strong>' + eur(p.precio) + '</strong></td>'
        + '<td class="o-num o-mu">' + p.estaciones + '</td></tr>'
      ).join('')
    + '</tbody></table>'
}

function tablaMarcas(rows: MarcaPrecio[]): string {
  return '<table class="o-tabla"><thead><tr><th>#</th><th>Marca</th><th>&euro;/L</th><th>Estaciones</th></tr></thead><tbody>'
    + rows.map((m, i) =>
        '<tr><td>' + (i + 1) + '</td><td>' + esc(m.marca) + '</td>'
        + '<td class="o-num"><strong>' + eur(m.precio) + '</strong></td>'
        + '<td class="o-num o-mu">' + m.estaciones + '</td></tr>'
      ).join('')
    + '</tbody></table>'
}

function bloqueCombustible(
  titulo: string, f: Observatorio['g95'], variacion: Variacion[], deposito: number,
): string {
  if (!f.nacional || !f.provincias.length) return ''
  const barata = f.provincias[0]
  const cara   = f.provincias[f.provincias.length - 1]
  const dif    = cara.precio - barata.precio
  const difDeposito = dif * deposito

  const vars = variacion.filter(v => v.pct != null)
    .map(v => '<li>' + v.dias + ' d&iacute;as: ' + flecha(v.pct) + '</li>').join('')

  return '<section class="o-bloque">'
    + '<h2>' + esc(titulo) + '</h2>'
    + '<p class="o-dato"><span class="o-precio">' + eur(f.nacional) + ' &euro;/L</span> '
    + '<span class="o-mu">precio medio nacional</span></p>'
    + (vars ? '<ul class="o-vars">' + vars + '</ul>' : '')
    + '<p class="o-destacado">Entre la provincia m&aacute;s barata (<a href="/gasolineras/' + esc(barata.slug) + '">'
    + esc(barata.name) + '</a>, ' + eur(barata.precio) + ' &euro;/L) y la m&aacute;s cara (<a href="/gasolineras/'
    + esc(cara.slug) + '">' + esc(cara.name) + '</a>, ' + eur(cara.precio) + ' &euro;/L) hay <strong>'
    + cent(dif) + ' c&eacute;ntimos por litro</strong>: <strong>' + difDeposito.toFixed(2).replace('.', ',')
    + ' &euro;</strong> en un dep&oacute;sito de ' + deposito + ' litros.</p>'
    + '<div class="o-cols">'
    + '<div><h3>10 provincias m&aacute;s baratas</h3>' + tablaProvincias(f.provincias, true) + '</div>'
    + '<div><h3>10 provincias m&aacute;s caras</h3>' + tablaProvincias(f.provincias, false) + '</div>'
    + '</div>'
    + (f.marcas.length
        ? '<h3>Por marca</h3><p class="o-mu">Solo marcas con 40 estaciones o m&aacute;s.</p>' + tablaMarcas(f.marcas)
        : '')
    + '</section>'
}

export function buildObservatorioPage(nonce: string, d: ObservatorioPageData): string {
  const { obs } = d
  const g95 = obs.g95.nacional
  const dsl = obs.diesel.nacional
  const title = 'Precio de la gasolina y el di&eacute;sel en Espa&ntilde;a hoy | CercaYa'
  const desc = 'Precio medio de la gasolina 95 (' + (g95 ? eur(g95) + ' &euro;/L' : 'n/d') + ') y del di&eacute;sel ('
    + (dsl ? eur(dsl) + ' &euro;/L' : 'n/d') + ') en Espa&ntilde;a, con ranking por provincia y por marca. '
    + 'Datos oficiales del Ministerio, actualizados a diario.'

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: 'Precios de carburante en Espana por provincia y marca',
    description: 'Precio medio (mediana) de gasolina 95 y diesel en Espana, agregado por provincia y por marca a partir de los datos oficiales del Ministerio para la Transicion Ecologica.',
    creator: { '@type': 'Organization', name: 'CercaYa' },
    isBasedOn: 'https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/',
    temporalCoverage: obs.fechaMinisterio || undefined,
    license: 'https://creativecommons.org/licenses/by/4.0/',
  }).replace(/</g, '\\u003c')

  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + title + '</title>'
    + '<meta name="description" content="' + desc + '" />'
    + '<link rel="canonical" href="' + esc(d.canonical) + '" />'
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + title + '" />'
    + '<meta property="og:description" content="' + desc + '" />'
    + '<meta property="og:type" content="article" /><meta property="og:url" content="' + esc(d.canonical) + '" />'
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + '<script type="application/ld+json" nonce="' + esc(nonce) + '">' + jsonLd + '</script>'
    + '<style nonce="' + esc(nonce) + '">'
    + ':root{--v:#16a34a;--vd:#14532d;--tx:#1e293b;--mu:#64748b;--bd:#e2e8f0;--bg:#f8fafc;--rd:#dc2626}'
    + '*{box-sizing:border-box}'
    + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.55}'
    + 'header{background:linear-gradient(135deg,#166534,#16a34a);color:#fff;padding:14px 18px}'
    + 'header a{color:#fff;text-decoration:none;font-weight:600}'
    + 'main{max-width:880px;margin:0 auto;padding:18px}'
    + 'h1{font-size:26px;line-height:1.2;margin:0 0 4px}'
    + 'h2{font-size:20px;margin:30px 0 8px;padding-top:14px;border-top:1px solid var(--bd)}'
    + 'h3{font-size:15px;margin:18px 0 8px}'
    + '.o-sub{color:var(--mu);font-size:14px;margin:0 0 8px}'
    + '.o-dato{margin:6px 0}'
    + '.o-precio{font-size:30px;font-weight:800;color:var(--vd)}'
    + '.o-mu{color:var(--mu);font-size:13px}'
    + '.o-vars{list-style:none;padding:0;margin:6px 0;display:flex;gap:14px;flex-wrap:wrap;font-size:14px}'
    + '.o-up{color:var(--rd);font-weight:700}.o-down{color:var(--v);font-weight:700}.o-flat{color:var(--mu)}'
    + '.o-destacado{background:var(--bg);border-left:3px solid var(--v);padding:10px 14px;border-radius:0 8px 8px 0;margin:14px 0}'
    + '.o-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px}'
    + '.o-tabla{width:100%;border-collapse:collapse;font-size:14px}'
    + '.o-tabla th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--mu);border-bottom:1px solid var(--bd);padding:6px 4px}'
    + '.o-tabla td{padding:6px 4px;border-bottom:1px solid var(--bd)}'
    + '.o-tabla .o-num{text-align:right;font-variant-numeric:tabular-nums}'
    + '.o-tabla a{color:var(--vd)}'
    + '.o-metodo{font-size:13px;color:var(--mu);background:var(--bg);border-radius:8px;padding:12px 14px;margin-top:26px}'
    + 'footer{border-top:1px solid var(--bd);margin-top:26px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
    + 'footer a{color:var(--vd)}'
    + '@media(prefers-color-scheme:dark){body{background:#0f172a;color:#e2e8f0}'
    + '.o-destacado,.o-metodo{background:#1e293b}.o-tabla a,footer a{color:#86efac}'
    + '.o-precio{color:#86efac}.o-tabla th,.o-tabla td{border-color:#334155}}'
    + '</style></head><body>'
    + '<header><a href="/">CercaYa</a></header>'
    + '<main>'
    + '<h1>Precio de la gasolina y el di&eacute;sel en Espa&ntilde;a</h1>'
    + '<p class="o-sub">' + obs.totalEstaciones.toLocaleString('es-ES') + ' estaciones'
    + (obs.fechaMinisterio ? ' &middot; datos del Ministerio del ' + esc(fechaMinisterio(obs.fechaMinisterio)) : '')
    + '</p>'
    + bloqueCombustible('Gasolina 95', obs.g95, d.variacionG95, d.deposito)
    + bloqueCombustible('Di&eacute;sel', obs.diesel, d.variacionDiesel, d.deposito)
    + '<p class="o-metodo"><strong>Metodolog&iacute;a.</strong> Se usa la <strong>mediana</strong>, no la media: '
    + 'unas pocas estaciones de autopista muy caras desplazan la media de una provincia y dar&iacute;an una cifra enga&ntilde;osa. '
    + 'Se excluyen las provincias con menos de 3 estaciones y las marcas con menos de 40. '
    + 'La variaci&oacute;n compara el precio medio de hoy con el de hace 7, 30 y 90 d&iacute;as, a partir de nuestro '
    + 'hist&oacute;rico propio. Fuente del dato diario: Ministerio para la Transici&oacute;n Ecol&oacute;gica y el Reto Demogr&aacute;fico. '
    + 'Puedes reutilizar estas cifras citando y enlazando a esta p&aacute;gina.</p>'
    + '<p><a href="/gasolineras/">Ver el mapa de gasolineras</a></p>'
    + '</main>'
    + '<footer>Datos oficiales del Ministerio para la Transici&oacute;n Ecol&oacute;gica. '
    + '<a href="/">CercaYa</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

export function observatorioHeaders(nonce: string): Record<string, string> {
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
    'Cache-Control': 'public, max-age=900, s-maxage=3600',
  }
}
