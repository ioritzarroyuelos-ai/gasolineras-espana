// Directorio ITV y precios oficiales, renderizados sin depender de JavaScript.
import type { EstacionITV, MunicipioITV, ProvinciaITV, FuenteItvEstado } from '../lib/itv'
import { telefonosItv, mapsHref, enlaceOficialItv, normalizaNombreMunicipio } from '../lib/itv'
import { TARIFAS, LIBERALIZADAS, SIN_DATO, NOMBRE_IMPUESTO, TASA_DGT_FUENTE, TARIFAS_REVISADAS, tarifaVigente, desglosa, type Tarifa } from '../lib/itv-tarifas'
import type { ResultadoTiempo } from '../lib/tiempo-municipios'
import { DISTANCIA_MAX_ITV_KM } from '../lib/itv-busqueda'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { PORTAL_BASE_CSS } from './ui-theme'
import { buscadorItv, resultadosItv, CSS_BUSCADOR_ITV } from './itv-buscador'
import { ogSocialTags, originFromCanonical, breadcrumbLd } from './seo'
import { escapeHtml as esc } from './html'
import { fechaHoraLocal, instanteLocal } from '../../scripts/lib/fechas.mjs'

function fecha(value?: string): string {
  if (!value || !/^\d{4}-\d{2}(?:-\d{2}(?:T.*)?)?$/.test(value)) return ''
  const date = Date.parse(value.length === 7 ? value + '-01' : value)
  if (!Number.isFinite(date) || date > Date.now() + 300000) return ''
  return new Intl.DateTimeFormat('es-ES', {
    ...(value.length === 7 ? {} : { day: 'numeric' as const }),
    month: 'long', year: 'numeric', timeZone: 'Europe/Madrid',
  }).format(date)
}

function fechaHtml(value?: string): string {
  const label = fecha(value)
  return label ? '<time datetime="' + esc(value) + '">' + esc(label) + '</time>' : ''
}

function enlace(url: string | undefined, texto: string): string {
  const safe = enlaceOficialItv(url)
  return safe ? '<a href="' + esc(safe) + '" target="_blank" rel="noopener">' + esc(texto) + '</a>' : esc(texto)
}

export function avisoDirectorio(updatedAt?: string, now = Date.now(), fuentes?: FuenteItvEstado[]): string {
  if (fuentes?.length) {
    const conservadas = fuentes.some(f => f.estado === 'conservada')
    return '<aside class="aviso" aria-label="Actualización del directorio"><details><summary>'
      + (conservadas ? 'Parte del directorio sigue pendiente de actualizar' : 'Fechas y fuentes del directorio')
      + '</summary><p>Consultar un documento hoy no cambia la fecha de sus datos. Los teléfonos y los horarios pueden tener una fecha distinta.</p><ul>'
      + fuentes.map(f => '<li><strong>' + enlace(f.url, f.nombre) + '</strong>'
        + (fecha(f.publicado) ? ' · Documento de ' + fechaHtml(f.publicado) : '')
        + (f.estado === 'conservada'
          ? '. Fuente no disponible; conservamos la copia anterior' + (fecha(f.ultimoExito) ? ' del ' + fechaHtml(f.ultimoExito) : '')
          : (fecha(f.consultado) ? '. Consultado el ' + fechaHtml(f.consultado) : ''))
        + '.</li>').join('')
      + '</ul><p>Confirma horario y cita con la estación antes de acudir.</p></details></aside>'
  }
  const date = updatedAt ? Date.parse(updatedAt) : NaN
  const valid = Number.isFinite(date) && date <= now + 300000
  const stale = !valid || now - date > 40 * 86400000
  const label = valid ? new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' }).format(date) : ''
  return '<aside class="aviso" aria-label="Actualización del directorio">'
    + (stale ? '<strong>Directorio pendiente de actualizar.</strong> ' : '')
    + (label ? 'Última copia de datos: <time datetime="' + esc(updatedAt) + '">' + esc(label) + '</time>. ' : 'Fecha de los datos no disponible. ')
    + 'Consulta el ' + enlace('https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/', 'directorio oficial de la DGT')
    + ' y confirma con la estación antes de acudir.</aside>'
}


const CSS = PORTAL_BASE_CSS + ' :root{color-scheme:light;--vd:var(--eu-accent);--tx:var(--eu-ink);--mu:var(--eu-muted);--bd:var(--eu-line);--bg:var(--eu-soft)}'
  + 'main{max-width:1120px;margin:0 auto;padding:24px 20px 32px}h1{font-family:var(--eu-font);font-size:clamp(30px,4vw,48px);line-height:1.2;margin:0 0 10px}h2{font-size:21px;margin:28px 0 14px}h3{font-size:19px;line-height:1.3;margin:0 0 8px}'
  + 'a{color:var(--vd)}.sub,.meta{color:var(--mu)}.sub{margin:0 0 22px}.meta{font-size:13px;margin:8px 0}.hint{font-size:14px;color:var(--mu);margin:10px 0 22px}'
  + '.card,.precio-box{border:1px solid var(--bd);border-radius:22px;padding:24px;background:#fff;min-width:0;overflow-wrap:anywhere}.card p{margin:8px 0}.cards,.precios{display:grid;gap:16px}.precios{grid-template-columns:repeat(2,minmax(0,1fr))}.precio-box{background:var(--eu-surface)}'
  + '.card .horario{margin:14px 0;font-size:14px}.acciones{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 14px;border:1px solid #9db1a2;border-radius:12px;background:#fff;color:var(--vd);text-decoration:none;font:inherit;font-size:14px;font-weight:650;text-align:center}.btn--principal{color:#fff;background:var(--vd);border-color:var(--vd)}'
  + ':focus-visible{outline:3px solid #22683e;outline-offset:3px}.aviso{padding:12px 15px;margin:22px 0;background:var(--bg);border-left:3px solid #5c825e;font-size:14px}.aviso p:last-child{margin-bottom:0}summary{cursor:pointer;font-weight:650;min-height:24px}.aviso ul{padding-left:22px}.aviso li{margin:10px 0}'
  + '.lista ul{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0}.lista a{display:block;padding:9px 12px;border:1px solid var(--bd);border-radius:12px;text-decoration:none;min-height:44px}.lista b{color:var(--mu);margin-left:5px;font-weight:400}.lista a:hover,.btn:hover{background:#eaf0e8}.btn--principal:hover{background:#163e26}'
  + '.precio-linea{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:10px 0}.precio-linea b{font-size:26px;color:var(--vd);white-space:nowrap}.precio-nota{font-size:14px;margin:12px 0}.precio-fuente,.precio-desg{font-size:13px;color:var(--mu);margin:10px 0 0}.precio-box .etiqueta{font-size:13px;color:var(--mu);margin:0}.precio-box .pendiente{font-weight:650}'
  + '.filtro{display:flex;flex-wrap:wrap;align-items:end;gap:12px;margin:22px 0}.filtro label{display:block;font-weight:650;margin:0 0 5px}.filtro select{font:inherit;min-height:44px;padding:8px 35px 8px 12px;border:1px solid #839788;border-radius:12px;background:#fff;color:var(--tx)}'
  + '.motivos{padding-left:22px}.motivos li{margin:12px 0}.legal{margin-top:24px;padding-top:16px;border-top:1px solid var(--bd);color:var(--mu);font-size:14px}.volver{margin:0 0 18px;font-size:14px}.distancia{font-weight:650;color:var(--vd)}footer{border-top:1px solid var(--bd);padding:22px 18px;color:var(--mu);font-size:13px;text-align:center}'
  + '@media(max-width:600px){main{padding:22px 16px}.precios{grid-template-columns:1fr}.card,.precio-box{padding:17px}.acciones .btn{flex:1 1 140px}.precio-linea b{font-size:24px}}'

interface Meta { title: string; desc: string; canonical: string; nonce: string; jsonLd?: string; breadcrumb?: string; noindex?: boolean }

function envoltorio(m: Meta, cuerpo: string): string {
  return '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(m.title) + '</title><meta name="description" content="' + esc(m.desc) + '">'
    + '<link rel="canonical" href="' + esc(m.canonical) + '"><meta name="theme-color" content="#225535">'
    + '<meta property="og:title" content="' + esc(m.title) + '"><meta property="og:description" content="' + esc(m.desc) + '">'
    + '<meta property="og:type" content="website"><meta property="og:url" content="' + esc(m.canonical) + '">'
    + '<meta name="robots" content="' + (m.noindex ? 'noindex,follow' : 'index,follow,max-image-preview:large') + '">'
    + ogSocialTags(originFromCanonical(m.canonical)) + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32">'
    + [m.jsonLd, m.breadcrumb].filter(Boolean).map(j => '<script type="application/ld+json" nonce="' + esc(m.nonce) + '">' + j + '</script>').join('')
    + '<style nonce="' + esc(m.nonce) + '">' + CSS + MASTHEAD_CSS + CSS_BUSCADOR_ITV + '</style></head><body>'
    + mastheadHtml('itv', { compact: true, hideMunicipioSearch: true }) + '<main>' + cuerpo
    + '</main><footer>Directorio elaborado con fuentes oficiales. <a href="/">España Útil</a> · <a href="/privacidad">Privacidad</a></footer></body></html>'
}

export function tarjetaItv(e: EstacionITV, municipio: string, distanciaKm?: number): string {
  const telefonos = telefonosItv(e.tel)
  const cita = enlaceOficialItv(e.citaUrl)
  const web = enlaceOficialItv(e.webUrl)
  const contacto = fecha(e.contactoVerificadoEn)
  const consulta = fecha(e.verificadoEn)
  const publicacion = fecha(e.publicadoEn)
  return '<article class="card">'
    + (distanciaKm != null ? '<p class="distancia">A ' + esc(distanciaKm.toLocaleString('es-ES', { maximumFractionDigits: 1 })) + ' km en línea recta</p>' : '')
    + '<h3>' + esc(e.nombre || 'ITV de ' + municipio) + '</h3>'
    + '<p>' + esc(e.dir || 'Dirección pendiente de confirmar') + '<br>' + esc([e.cp, municipio].filter(Boolean).join(' ')) + '</p>'
    + (e.op ? '<p class="meta">Gestionada por ' + esc(e.op) + '</p>' : '')
    + '<div class="acciones">'
    + (cita ? '<a class="btn btn--principal" href="' + esc(cita) + '" target="_blank" rel="noopener">Pedir cita</a>' : '')
    + telefonos.map(t => '<a class="btn' + (cita ? '' : ' btn--principal') + '" href="' + esc(t.href) + '">Llamar ' + esc(t.texto) + '</a>').join('')
    + '<a class="btn" href="' + esc(mapsHref(e)) + '" target="_blank" rel="noopener">Cómo llegar</a>'
    + (web && web !== cita ? '<a class="btn" href="' + esc(web) + '" target="_blank" rel="noopener">Web oficial</a>' : '')
    + '</div>'
    + (e.horario.length > 180
      ? '<details class="horario"><summary>Ver horario y excepciones</summary><p>' + esc(e.horario) + '</p></details>'
      : '<p><strong>Horario:</strong> ' + (e.horario ? esc(e.horario) : 'confírmalo con la estación') + '</p>')
    + (!cita ? '<p class="meta">Cita por internet pendiente de verificar' + (telefonos.length ? '; puedes llamar a la estación.' : '.') + '</p>'
      : '<p class="meta">La reserva se realiza en la web del operador.' + (fecha(e.citaVerificadoEn) ? ' Enlace comprobado el ' + esc(fecha(e.citaVerificadoEn)) + '.' : '') + '</p>')
    + (e.municipioFuenteUrl && fecha(e.municipioVerificadoEn) ? '<p class="meta">Municipio confirmado el ' + esc(fecha(e.municipioVerificadoEn))
      + ' · ' + enlace(e.municipioFuenteUrl, 'Fuente del municipio') + '.</p>' : '')
    + (publicacion || consulta ? '<p class="meta">' + enlace(e.fuenteUrl, 'Fuente oficial')
      + (publicacion ? ' · Documento de ' + esc(publicacion) : '') + (consulta ? ' · Consultado el ' + esc(consulta) : '') + '.</p>' : '')
    + (contacto ? '<p class="meta">Teléfono y ubicación de la copia del ' + esc(contacto) + '. ' + enlace(e.contactoFuenteUrl, 'Fuente de contacto') + '.</p>' : '')
    + '</article>'
}

function jsonLdEstaciones(nombre: string, ests: EstacionITV[], provincia: string): string {
  const items = ests.slice(0, 15).map((e, i) => ({
    '@type': 'ListItem', position: i + 1,
    item: { '@type': 'AutomotiveBusiness', name: e.nombre || 'ITV de ' + normalizaNombreMunicipio(e.mun),
      address: { '@type': 'PostalAddress', streetAddress: e.dir, addressLocality: e.mun, postalCode: e.cp || undefined, addressRegion: provincia, addressCountry: 'ES' },
      telephone: telefonosItv(e.tel).map(t => t.href.slice(4)),
      geo: mapsHref(e).includes('/dir/') ? { '@type': 'GeoCoordinates', latitude: e.lat, longitude: e.lng } : undefined,
    },
  }))
  return JSON.stringify({ '@context': 'https://schema.org', '@type': 'ItemList', name: 'Estaciones de ITV en ' + nombre, numberOfItems: items.length, itemListElement: items }).replace(/</g, '\\u003c')
}

function migas(canonical: string, provincia?: { name: string; slug: string }, municipio?: string): string {
  const origin = originFromCanonical(canonical)
  const pasos = [{ name: 'Inicio', url: origin + '/' }, { name: 'ITV', url: origin + '/itv/' }]
  if (provincia) pasos.push({ name: provincia.name, url: origin + '/itv/' + provincia.slug })
  if (municipio) pasos.push({ name: municipio, url: canonical })
  return breadcrumbLd(pasos)
}

export function buildItvIndexPage(nonce: string, provincias: ProvinciaITV[], total: number, canonical: string, updatedAt?: string, fuentesEstado?: FuenteItvEstado[]): string {
  return envoltorio({ title: 'Estaciones de ITV en España | España Útil', desc: 'Busca estaciones de ITV en tu municipio o cerca de él. Dirección, teléfonos, cita y precios con sus fuentes.', canonical, nonce, breadcrumb: migas(canonical) },
    '<h1>Encuentra tu ITV</h1><p class="sub">' + total + ' estaciones en ' + provincias.length + ' provincias</p>'
    + buscadorItv(nonce) + '<p class="hint">Busca tu municipio. Si no tenemos una estación allí, te mostramos las más cercanas que podemos localizar.</p>'
    + '<p><a class="btn" href="/itv/precios">Comparar precios de la ITV</a></p>' + avisoDirectorio(updatedAt, Date.now(), fuentesEstado)
    + '<h2>Buscar por provincia</h2><nav class="lista" aria-label="Provincias"><ul>'
    + provincias.map(p => '<li><a href="/itv/' + esc(p.slug) + '">' + esc(p.name) + ' <b>' + p.count + '</b></a></li>').join('')
    + '</ul></nav>')
}

export function buildItvBusquedaPage(nonce: string, consulta: string, resultados: ResultadoTiempo[], canonical: string, indisponible = false): string {
  return envoltorio({ title: 'Buscar ITV | España Útil', desc: 'Busca una estación por municipio o provincia.', canonical, nonce, noindex: true },
    '<p class="volver"><a href="/itv/">← ITV</a></p><h1>Buscar ITV</h1>'
    + buscadorItv(nonce, consulta) + '<h2>Resultados de la búsqueda</h2>'
    + (indisponible ? '<p role="alert">Ahora no se puede cargar el buscador. Vuelve a pulsar Buscar o <a href="/itv/">consulta las provincias</a>.</p>' : resultadosItv(consulta, resultados)))
}

export interface ItvProvinciaData {
  directorioDisponible?: boolean;
  updatedAt?: string; fuentesEstado?: FuenteItvEstado[]; provinciaSlug: string; provinciaName: string;
  estaciones: EstacionITV[]; municipios: MunicipioITV[]; tarifa: Tarifa | null; canonical: string
}

export function buildItvProvinciaPage(nonce: string, d: ItvProvinciaData): string {
  if (d.directorioDisponible === false) return directorioIndisponible(nonce, d.canonical, d.provinciaName)
  return envoltorio({ title: 'ITV en ' + d.provinciaName + ': estaciones y precios | España Útil', desc: 'Busca tu estación de ITV en ' + d.provinciaName + '. Municipios, precios y fuentes oficiales.', canonical: d.canonical, nonce, breadcrumb: migas(d.canonical, { name: d.provinciaName, slug: d.provinciaSlug }) },
    '<p class="volver"><a href="/itv/">← Todas las provincias</a></p><h1>ITV en ' + esc(d.provinciaName) + '</h1>'
    + '<p class="sub">' + d.estaciones.length + ' estaciones en ' + d.municipios.length + ' municipios</p>'
    + buscadorItv(nonce) + '<h2>Elige un municipio</h2><nav class="lista" aria-label="Municipios con ITV"><ul>'
    + d.municipios.map(m => '<li><a href="/itv/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name) + ' <b>' + m.count + '</b></a></li>').join('')
    + '</ul></nav>' + bloquePrecioProvincia(d.tarifa, d.provinciaName) + avisoDirectorio(d.updatedAt, Date.now(), d.fuentesEstado))
}

export interface ItvMunicipioData {
  directorioDisponible?: boolean;
  updatedAt?: string; fuentesEstado?: FuenteItvEstado[]; provinciaSlug: string; provinciaName: string; municipioName: string;
  estaciones: EstacionITV[]; otrosMunicipios: MunicipioITV[]; canonical: string; tarifa?: Tarifa | null;
  cercanas?: Array<{ estacion: EstacionITV; distanciaKm: number }>;
  origenCercanas?: { nombre: string; lat: number; lng: number }
}

function directorioIndisponible(nonce: string, canonical: string, nombre: string): string {
  return envoltorio({ title: 'ITV en ' + nombre + ' | España Útil', desc: 'Consulta de estaciones de ITV.', canonical, nonce, noindex: true },
    '<h1>ITV en ' + esc(nombre) + '</h1><p role="alert">Ahora no podemos cargar el directorio de estaciones. Inténtalo de nuevo en unos minutos.</p>'
    + '<p><a class="btn" href="' + esc(canonical) + '">Reintentar</a></p><p>' + enlace('https://www.dgt.es/conoce-la-dgt/con-quien-trabajamos/itv/', 'Consultar el directorio oficial') + '</p>')
}

export function buildItvMunicipioPage(nonce: string, d: ItvMunicipioData): string {
  if (d.directorioDisponible === false) return directorioIndisponible(nonce, d.canonical, d.municipioName)
  const n = d.estaciones.length
  const titulo = 'ITV ' + (n ? 'en ' : 'cerca de ') + d.municipioName
  return envoltorio({ title: titulo + ' | España Útil', desc: titulo + ': direcciones, teléfonos y cómo llegar.', canonical: d.canonical, nonce, noindex: !n,
    ...(n ? { jsonLd: jsonLdEstaciones(d.municipioName, d.estaciones, d.provinciaName) } : {}),
    breadcrumb: migas(d.canonical, { name: d.provinciaName, slug: d.provinciaSlug }, d.municipioName) },
    '<p class="volver"><a href="/itv/' + esc(d.provinciaSlug) + '">← ITV en ' + esc(d.provinciaName) + '</a></p>'
    + '<h1>' + esc(titulo) + '</h1><p class="sub">' + esc(d.provinciaName)
    + (n ? ' · ' + n + (n === 1 ? ' estación' : ' estaciones') : '') + '</p>'
    + (n ? '<div class="cards">' + d.estaciones.map(e => tarjetaItv(e, d.municipioName)).join('') + '</div>'
      : '<p>No tenemos una estación registrada en este municipio.</p>')
    + (d.cercanas?.length ? '<h2>Estaciones cercanas</h2><p class="hint">Distancias en línea recta desde el centro de ' + esc(d.origenCercanas?.nombre || d.municipioName)
      + ', hasta ' + DISTANCIA_MAX_ITV_KM + ' km. El recorrido por carretera puede ser mayor. Solo comparamos estaciones con ubicación conocida.</p><div class="cards">'
      + d.cercanas.map(x => tarjetaItv(x.estacion, normalizaNombreMunicipio(x.estacion.mun), x.distanciaKm)).join('') + '</div>' : '')
    + (!n && !d.cercanas?.length ? '<p>' + (d.origenCercanas
      ? 'No hemos localizado estaciones con ubicación conocida a menos de ' + DISTANCIA_MAX_ITV_KM + ' km.'
      : 'No disponemos de ubicaciones suficientes para calcular las más cercanas.')
      + ' Consulta las estaciones de la provincia.</p>' : '')
    + (n ? bloquePrecioProvincia(d.tarifa || null, d.provinciaName) : '<p><a class="btn" href="/itv/precios">Consultar precios por territorio</a></p>')
    + avisoDirectorio(d.updatedAt, Date.now(), d.fuentesEstado)
    + '<h2>Buscar otro lugar</h2>' + buscadorItv(nonce)
    + (d.otrosMunicipios.length ? '<nav class="lista" aria-label="Otros municipios"><h2>Otros municipios de ' + esc(d.provinciaName) + '</h2><ul>'
      + d.otrosMunicipios.slice(0, 60).map(m => '<li><a href="/itv/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name) + '</a></li>').join('') + '</ul></nav>' : ''))
}

function eur(n: number): string { return n.toFixed(2).replace('.', ',') + ' €' }
type Combustible = 'gasolina' | 'diesel'

function totalTarifa(t: Tarifa, combustible: Combustible): number | null {
  const precio = t[combustible]
  return tarifaVigente(t) && precio != null ? desglosa(t, precio).total : null
}

function fichaTarifa(t: Tarifa, combustible?: Combustible): string {
  const lineas: Combustible[] = combustible ? [combustible] : ['gasolina', 'diesel']
  const condiciones = t.estado === 'verificada' && !tarifaVigente(t)
    ? 'El precio necesita una nueva revisión. Consulta el total con la estación.'
    : t.condiciones || ''
  return '<article class="precio-box"><h3>' + esc(t.nombre) + '</h3>'
    + '<p class="etiqueta">' + (t.tipoPrecio === 'maximo' ? 'Tarifa máxima publicada' : 'Tarifa publicada') + ' · Inspección periódica de un turismo</p>'
    + lineas.map(c => {
      const total = totalTarifa(t, c)
      const importe = t[c]
      const d = total != null && importe != null ? desglosa(t, importe) : null
      return '<p class="precio-linea"><span>' + (c === 'gasolina' ? 'Gasolina' : 'Diésel') + '</span>'
        + (total != null ? '<b>' + eur(total) + '</b>' : '<span class="pendiente">Pendiente de confirmar</span>') + '</p>'
        + (total != null && t.alcancePrecio ? '<p class="precio-nota"><strong>' + esc(t.alcancePrecio) + '</strong></p>' : '')
        + (d ? '<p class="precio-desg">' + eur(d.base) + ' de inspección'
          + (d.impuesto ? ' + ' + eur(d.impuesto) + ' de ' + esc(NOMBRE_IMPUESTO[t.impuesto]) : '')
          + ' + ' + eur(d.tasaDgt) + ' de tasa DGT'
          + (d.suplementos || []).map(s => ' + ' + eur(s.importe) + ' de ' + esc(s.concepto)).join('') + '.</p>' : '')
    }).join('')
    + (condiciones ? '<p class="precio-nota">' + esc(condiciones) + '</p>' : '')
    + '<details class="precio-fuente"><summary>Fuente y revisión'
    + (fecha(t.revisada) ? ' · ' + esc(fecha(t.revisada)) : '') + '</summary>'
    + '<p>' + enlace(t.fuenteUrl, t.norma) + '. ' + esc(t.vigencia) + '.</p>'
    + (t.suplementos || []).filter(s => s.fuenteUrl).map(s => '<p>' + enlace(s.fuenteUrl, 'Fuente de ' + s.concepto.toLowerCase()) + '</p>').join('')
    + '</details></article>'
}

export function buildItvPreciosPage(nonce: string, canonical: string, combustible: Combustible = 'gasolina'): string {
  const ordenadas = [...TARIFAS].sort((a, b) => (totalTarifa(a, combustible) ?? Infinity) - (totalTarifa(b, combustible) ?? Infinity) || a.nombre.localeCompare(b.nombre, 'es'))
  return envoltorio({ title: 'Precios de la ITV por territorio | España Útil', desc: 'Compara precios publicados de la ITV de gasolina o diésel, con suplementos, condiciones y fuentes oficiales.', canonical, nonce, breadcrumb: migas(canonical, undefined, 'Precios') },
    '<p class="volver"><a href="/itv/">← Estaciones de ITV</a></p><h1>Compara el precio de la ITV</h1>'
    + '<p class="sub">Elige el combustible de tu turismo. Ordenamos los importes confirmados de menor a mayor; las condiciones de cada tarifa aparecen junto al precio.</p>'
    + '<form class="filtro" action="/itv/precios" method="get"><div><label for="combustible">Combustible del coche</label><select id="combustible" name="combustible">'
    + '<option value="gasolina"' + (combustible === 'gasolina' ? ' selected' : '') + '>Gasolina</option>'
    + '<option value="diesel"' + (combustible === 'diesel' ? ' selected' : '') + '>Diésel</option></select></div>'
    + '<button class="btn btn--principal" type="submit">Comparar</button></form>'
    + '<h2>Precios para ' + (combustible === 'gasolina' ? 'gasolina' : 'diésel') + '</h2><div class="precios">' + ordenadas.map(t => fichaTarifa(t, combustible)).join('') + '</div>'
    + '<h2>Donde cada estación fija su precio</h2><ul class="motivos">'
    + LIBERALIZADAS.map(x => '<li><strong>' + esc(x.nombre) + '.</strong> ' + esc(x.motivo) + '</li>').join('') + '</ul>'
    + (SIN_DATO.length ? '<h2>Otros territorios pendientes de confirmar</h2><ul class="motivos">' + SIN_DATO.map(x => '<li><strong>' + esc(x.nombre) + '.</strong> ' + esc(x.motivo) + '</li>').join('') + '</ul>' : '')
    + '<div class="legal"><p>Son importes de las fuentes indicadas para la inspección periódica de un turismo. Otros vehículos, reinspecciones, descuentos o pruebas adicionales pueden cambiar el precio. Comprueba las condiciones y el total al reservar.</p></div>'
    + '<p class="precio-fuente">' + enlace(TASA_DGT_FUENTE, 'Consultar la tasa de la DGT') + ' · Revisión: ' + esc(fecha(TARIFAS_REVISADAS)) + '.</p>'
    + '<p><a class="btn" href="/itv/">Buscar una estación de ITV</a></p>')
}

export function bloquePrecioProvincia(t: Tarifa | null, provinciaName: string): string {
  return '<h2>Precios de ITV en ' + esc(provinciaName) + '</h2>'
    + (t ? fichaTarifa(t) : '<p>Consulta el precio de tu estación al reservar. No tenemos una tarifa única confirmada para esta provincia.</p>')
    + '<p><a class="btn" href="/itv/precios">Comparar precios por combustible</a></p>'
}

export function itvHeaders(nonce: string, now = Date.now()): Record<string, string> {
  // Una respuesta con precios no debe sobrevivir al día en que vence la tarifa.
  const dia = fechaHoraLocal(new Date(now)).slice(0, 10)
  const manana = new Date(Date.parse(dia + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10)
  const ttl = Math.max(0, Math.min(3600, Math.floor((instanteLocal(manana + 'T00:00') - now) / 1000)))
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
    'Cache-Control': 'public, max-age=' + Math.min(300, ttl) + ', s-maxage=' + ttl,
  }
}
