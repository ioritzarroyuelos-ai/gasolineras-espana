// Listados del colegio y fichas de farmacias. La búsqueda por zona y por
// turno funciona sin JavaScript; sólo la ordenación por GPS lo necesita.

import { frescuraGuardia, estadoGuardia, textoHorarioGuardia, tipoAtencionGuardia, zonaGuardia, fuenteGuardia, type GuardiasFile } from '../lib/guardias'
import type { Guardia, MunicipioGuardia, GuardiaFrescura } from '../lib/guardias'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { CABECERA_FARMACIAS_CSS } from './farmacias'
import { ogSocialTags, originFromCanonical, breadcrumbLd } from './seo'

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
  metadatos?: GuardiasFile
  turno?: 'todas' | 'ahora' | '24h'
  ahora?: Date
}

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function fuenteHtml(provinciaSlug: string, metadatos?: GuardiasFile, ahora?: Date): string {
  const url = fuenteGuardia(provinciaSlug, metadatos, ahora)
  return (url ? '<p class="g-nota"><a href="' + esc(url) + '" target="_blank" rel="noopener">Consultar la fuente oficial y sus últimos avisos</a></p>' : '')
    + (metadatos?.cobertura ? '<p class="g-nota">' + esc(metadatos.cobertura) + '</p>' : '')
    + (metadatos?.incidencias?.length ? '<p class="g-nota">' + metadatos.incidencias.map(esc).join(' · ') + '</p>' : '')
}

// La ubicación se usa únicamente en este navegador; no se envía ni se guarda.
const CERCANIA_JS = `
document.getElementById('g-cerca').hidden=false;
document.getElementById('g-cerca').addEventListener('click',function(){
  var message=document.getElementById('g-ubicacion'),button=this;
  if(!navigator.geolocation){message.textContent='Este navegador no permite obtener tu ubicación.';return;}
  button.disabled=true;message.textContent='Buscando tu ubicación…';
  navigator.geolocation.getCurrentPosition(function(pos){
    var lat=pos.coords.latitude,lng=pos.coords.longitude,r=Math.PI/180;
    if(pos.coords.accuracy>5000){message.textContent='La ubicación es demasiado imprecisa para ordenar las farmacias. Inténtalo de nuevo.';button.disabled=false;return;}
    var cards=Array.from(document.querySelectorAll('#g-resultados .g-card'));
    cards.forEach(function(card){
      if(!card.dataset.lat){card.distance=Infinity;return;}
      var a=Number(card.dataset.lat),b=Number(card.dataset.lng);
      var h=Math.sin((a-lat)*r/2)**2+Math.cos(lat*r)*Math.cos(a*r)*Math.sin((b-lng)*r/2)**2;
      card.distance=6371*2*Math.asin(Math.sqrt(Math.min(1,h)));
      var label=card.querySelector('.g-distancia');
      if(!label){label=document.createElement('p');label.className='g-distancia';card.appendChild(label);}
      label.textContent=card.distance.toFixed(1)+' km en línea recta';
    });
    cards.sort(function(a,b){return a.distance-b.distance;}).forEach(function(card){document.getElementById('g-resultados').appendChild(card);});
    message.textContent='Ordenadas por distancia aproximada. Las fichas sin coordenadas verificadas aparecen al final. Tu ubicación no se guarda.';button.disabled=false;
  },function(){message.textContent='No se pudo obtener tu ubicación. Puedes seguir consultando todos los turnos.';button.disabled=false;},{timeout:10000,maximumAge:60000});
});`

function fechaLegible(iso?: string, zona = 'Europe/Madrid'): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: zona })
}

// La fecha de recogida sirve para decidir si todavía se pueden mostrar fichas.
// La fecha de un turno sólo se toma de lo que publicó el colegio.
function piezasFrescura(fr: GuardiaFrescura, lugar: string): {
  mostrarCards: boolean; noindex: boolean; banner: string; nota: string
} {
  const fecha = fechaLegible(fr.fecha)
  if (!fr.fiable) {
    return {
      mostrarCards: false, noindex: true, nota: '',
      banner: '<p class="g-caducado"><strong>No tenemos el turno de guardia actualizado de ' + esc(lugar) + '.</strong> '
        + (fecha ? 'La última comprobación fue el ' + esc(fecha) + '. ' : '')
        + 'Consulta los avisos del colegio antes de desplazarte. '
        + 'En una urgencia grave, llama al 112.</p>',
    }
  }
  if (!fr.esHoy) {
    return {
      mostrarCards: true, noindex: false, banner: '',
      nota: '<p class="g-nota">Confirma por teléfono que este turno siga vigente antes de desplazarte.</p>',
    }
  }
  return { mostrarCards: true, noindex: false, banner: '', nota: '' }
}

function telefonos(t: string): string[] {
  const unicos = new Set<string>()
  for (const parte of t.split(/[,;/|]/)) {
    const compacta = parte.replace(/[\s.()–—-]/g, '')
    // Algunos ficheros antiguos perdieron el separador entre dos teléfonos.
    // Sólo aceptamos la parte si se compone ENTERA de números españoles completos.
    const candidatos = [...compacta.matchAll(/(?:\+34|0034)?([6789]\d{8})/g)]
    if (candidatos.map(m => m[0]).join('') !== compacta) continue
    for (const m of candidatos) unicos.add(m[1])
  }
  return [...unicos]
}

function mapsHref(g: Guardia, municipio: string, provincia: string): string | undefined {
  if (g.coordenadasFiables) {
    return 'https://www.google.com/maps/dir/?api=1&destination=' + g.lat + ',' + g.lng
  }
  const direccion = g.direccion.trim()
  if (!direccion) return
  const lugar = g.municipio.trim() || municipio
  const partes = [direccion, g.cp, lugar]
  if (lugar.localeCompare(provincia, 'es', { sensitivity: 'base' }) !== 0) partes.push(provincia)
  partes.push('España')
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(partes.filter(Boolean).join(', '))
}

const ETIQUETAS_ATENCION = {
  guardia: 'Guardia publicada', apertura: 'Horario de apertura · guardia sin confirmar',
  localizada: 'Guardia localizada · llama antes', sin_confirmar: 'Turno por confirmar',
}

type Turno = NonNullable<GuardiaPageData['turno']>
type FilaFarmacia = { farmacia: Guardia; estado: ReturnType<typeof estadoGuardia> }

function guardiaCard(fila: FilaFarmacia, municipio: string, provincia: string, actualizado: string | undefined, ahora: Date, zona: string): string {
  const { farmacia: g, estado } = fila
  const numeros = telefonos(g.telefono)
  const mapa = mapsHref(g, municipio, provincia)
  const horario = textoHorarioGuardia(g, actualizado, ahora, zona)
  const tipo = tipoAtencionGuardia(g)
  const deGuardiaAhora = g.territorio === 'bizkaia' && tipo === 'guardia' && estado.abierta
  const etiqueta = deGuardiaAhora ? '<strong>De guardia ahora</strong>' : ETIQUETAS_ATENCION[tipo]
    + (estado.conocida ? ' · <strong>' + (estado.abierta ? 'Abierta ahora' : 'Fuera del horario publicado') + '</strong>' : '')
  return '<article class="g-card"' + (g.coordenadasFiables ? ' data-lat="' + g.lat + '" data-lng="' + g.lng + '"' : '') + '>'
    + '<p class="g-tipo">' + etiqueta + '</p>'
    + '<h3 class="g-dir">' + esc(g.direccion || 'Farmacia') + '</h3>'
    + (g.cp ? '<p class="g-meta">' + esc(g.cp + ' ' + (g.municipio || municipio || provincia)) + '</p>' : '')
    + '<p class="g-hora">' + esc(horario) + '</p>'
    + '<div class="g-acciones">'
    + numeros.map(tel => '<a class="g-btn g-btn--tel" href="tel:+34' + tel + '"><span>Llamar</span> <span>' + tel.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3') + '</span></a>').join('')
    + (mapa ? '<a class="g-btn" href="' + esc(mapa) + '" target="_blank" rel="noopener">' + (g.coordenadasFiables ? 'Cómo llegar' : 'Buscar dirección en el mapa') + '</a>' : '')
    + '</div>' + (g.telefono.trim() && !numeros.length ? '<p class="g-meta">Teléfono por confirmar.</p>' : '')
    + '</article>'
}

function listadoTurnos(d: Pick<GuardiaPageData, 'guardias' | 'municipioName' | 'provinciaName' | 'provinciaSlug' | 'turno' | 'actualizado' | 'metadatos' | 'fuente'>, ahora: Date) {
  const zona = zonaGuardia(d.provinciaSlug)
  const frescura = piezasFrescura(frescuraGuardia(d.actualizado, ahora, zona), d.municipioName || d.provinciaName)
  const fuente = fuenteHtml(d.provinciaSlug, d.metadatos ?? { source: d.fuente }, ahora)
  const pie = fuente ? '<section id="g-fuente" aria-label="Fuente y avisos">' + fuente + '</section>' : ''
  const filas = frescura.mostrarCards ? d.guardias.map(farmacia => ({ farmacia, estado: estadoGuardia(farmacia, d.actualizado, ahora, zona) })) : []
  const confirmables = filas.some(f => f.estado.conocida)
  const turno = d.turno ?? 'todas'
  const visibles = filas.filter(f => turno === 'todas' || (turno === 'ahora' ? f.estado.abierta : f.estado.todoElDia))
  if (d.provinciaSlug === 'bizkaia') visibles.sort((a, b) => Number(b.estado.abierta) - Number(a.estado.abierta))
  if (!frescura.mostrarCards) return { frescura, visibles, html: frescura.banner + pie, script: '' }

  const filtros = confirmables ? '<nav class="g-filtros" aria-label="Filtrar turnos">'
    + ([['todas', 'Todos los turnos'], ['ahora', 'Abierta ahora'], ['24h', 'Turno de 24 h']] as const).map(([id, titulo]) =>
      '<a class="g-btn"' + (turno === id ? ' aria-current="page"' : '') + ' href="?turno=' + id + '">' + titulo + '</a>').join('') + '</nav>' : ''
  const fecha = fechaLegible(d.actualizado, zona)
  const cabecera = '<p class="g-lectura">' + (fecha ? 'Datos consultados el ' + esc(fecha) : '')
    + (pie ? (fecha ? ' · ' : '') + '<a href="#g-fuente">Fuente y avisos</a>' : '') + '</p>'
  const hora = ahora.toLocaleTimeString('es-ES', { timeZone: zona, hour: '2-digit', minute: '2-digit' })
  const nota = confirmables ? 'Horarios a las ' + hora + ' (hora local).'
    : 'No podemos confirmar qué farmacias están abiertas ahora con los horarios publicados.'
  const conGPS = visibles.some(f => f.farmacia.coordenadasFiables)
  // Sin JavaScript no se puede ordenar por GPS. El resto de controles son enlaces normales.
  const cercania = conGPS ? '<button class="g-btn" type="button" id="g-cerca" hidden>Ordenar por cercanía</button>' : ''
  const lista = visibles.length
    ? visibles.map(f => guardiaCard(f, d.municipioName, d.provinciaName, d.actualizado, ahora, zona)).join('')
    : '<p class="g-vacio">' + (turno === 'todas' ? 'El colegio no indica un turno para este listado.'
      : 'No hay farmacias con un horario confirmado para este filtro. <a href="?turno=todas">Ver todos los turnos</a>.') + '</p>'
  return { frescura, visibles, html: cabecera + frescura.nota + filtros + '<p class="g-lectura">' + nota + '</p>'
    + '<div class="g-recuento"><h2 class="g-total">' + visibles.length + (visibles.length === 1 ? ' resultado' : ' resultados') + '</h2>' + cercania + '</div>'
    + (conGPS ? '<p id="g-ubicacion" role="status"></p>' : '')
    + '<div id="g-resultados">' + lista + '</div>' + pie, script: conGPS ? CERCANIA_JS : '' }
}

// Pagina provincial cuando la fuente NO trae municipio (Baleares, Huesca):
// en vez de un 404, se listan todas las guardias de la provincia directamente.
export function buildGuardiaProvinciaFlatPage(
  nonce: string, provinciaSlug: string, provinciaName: string,
  guardias: Guardia[], actualizado: string | undefined, canonical: string, metadatos?: GuardiasFile,
  turno: Turno = 'todas',
): string {
  const lista = listadoTurnos({ guardias, actualizado, metadatos, municipioName: '', provinciaName, provinciaSlug, turno }, new Date())
  const title = 'Farmacias y turnos en ' + provinciaName + ' | España Útil'
  const desc = 'Direcciones, teléfonos y horarios de las farmacias que publica el colegio de ' + provinciaName + '.'
  return envoltorioIndice(nonce, title, desc, canonical,
    '<h1>Farmacias y turnos en ' + esc(provinciaName) + '</h1>' + lista.html
    + '<p><a class="btn" href="/farmacias/guardia">Ver todas las provincias</a></p>',
    lista.frescura.noindex, lista.script,
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
      name: 'Farmacia' + (g.direccion ? ' - ' + g.direccion : ''),
      address: {
        '@type': 'PostalAddress',
        streetAddress: g.direccion,
        addressLocality: d.municipioName,
        postalCode: g.cp || undefined,
        addressRegion: d.provinciaName,
        addressCountry: 'ES',
      },
      telephone: telefonos(g.telefono).map(t => '+34' + t),
      geo: g.coordenadasFiables
        ? { '@type': 'GeoCoordinates', latitude: g.lat, longitude: g.lng }
        : undefined,
      // Los turnos puntuales no se publican como horario semanal recurrente.
    },
  }))
  const data = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Farmacias en ' + d.municipioName,
    numberOfItems: items.length,   // el nº declarado debe cuadrar con los items emitidos (slice 10)
    itemListElement: items,
  }
  return JSON.stringify(data).replace(/</g, '\\u003c')
}

export function buildGuardiaMunicipioPage(nonce: string, d: GuardiaPageData): string {
  const ahora = d.ahora || new Date()
  const lista = listadoTurnos(d, ahora)
  const tipos = new Set(lista.visibles.map(({ farmacia }) => tipoAtencionGuardia(farmacia)))
  let encabezado = 'Farmacias y turnos en ' + d.municipioName
  if (tipos.size === 1 && tipos.has('apertura')) {
    encabezado = 'Horarios de farmacias en ' + d.municipioName
  } else if (tipos.size && !tipos.has('apertura') && !tipos.has('sin_confirmar')) {
    encabezado = 'Farmacias de guardia en ' + d.municipioName
  }
  const title = encabezado + ' | España Útil'
  const desc = 'Consulta las direcciones, teléfonos y horarios que publica el colegio para ' + d.municipioName + ' (' + d.provinciaName + ').'

  const otros = d.otrosMunicipios.length
    ? '<nav class="g-otros"><h2>Otros municipios de ' + esc(d.provinciaName) + '</h2><ul>'
      + d.otrosMunicipios.slice(0, 60).map(m =>
          '<li><a href="/farmacias/' + esc(d.provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name) + '</a></li>'
        ).join('')
      + '</ul></nav>'
    : ''

  const datos = (lista.visibles.length ? '<script type="application/ld+json" nonce="' + esc(nonce) + '">' + jsonLd({ ...d, guardias: lista.visibles.map(f => f.farmacia) }) + '</script>' : '')
    + '<script type="application/ld+json" nonce="' + esc(nonce) + '">' + breadcrumbLd([
      { name: 'Inicio', url: originFromCanonical(d.canonical) + '/' },
      { name: 'Farmacias de guardia', url: originFromCanonical(d.canonical) + '/farmacias/' },
      { name: d.provinciaName, url: originFromCanonical(d.canonical) + '/farmacias/' + d.provinciaSlug },
      { name: d.municipioName, url: d.canonical },
    ]) + '</script>'
  const cuerpo = '<h1>' + esc(encabezado) + '</h1>'
    + (d.provinciaName === d.municipioName ? '' : '<p class="g-provincia">' + esc(d.provinciaName) + '</p>')
    + lista.html
    + '<p class="aviso">Algunas farmacias atienden a puerta cerrada. Llama antes de desplazarte o toca el timbre al llegar.</p>'
    + '<p><a class="g-btn" href="/farmacias/">Buscar en otro municipio</a></p>' + otros
  return envoltorioIndice(nonce, title, desc, d.canonical, cuerpo, lista.frescura.noindex, lista.script, datos)
}

const CSS_INDICE =
  ':root{color-scheme:light;--v:#188148;--vd:#14532d;--tx:#203329;--mu:#506056;--bd:#d5ded6;--bg:#f6f8f5}'
  + '*{box-sizing:border-box}'
  + 'body{margin:0;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx);background:#fff;line-height:1.5}'
  + 'main{max-width:760px;margin:0 auto;padding:18px}'
  + 'h1{font:700 clamp(25px,4vw,34px)/1.2 Georgia,serif;margin:0 0 6px}'
  + 'h2{font-size:17px;margin:26px 0 10px}'
  + '.sub{color:var(--mu);font-size:14px;margin:0 0 18px}'
  + '.lista ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}'
  + '.lista li a{display:inline-flex;align-items:center;gap:4px;min-height:44px;padding:6px 12px;border:1px solid var(--bd);border-radius:999px;'
  + 'font-size:14px;color:var(--vd);text-decoration:none;background:#fff}'
  + '.lista li a b{color:var(--mu);font-size:12px;font-weight:600}'
  + '.aviso{font-size:13px;color:var(--mu);border-left:3px solid var(--v);padding:8px 12px;margin:18px 0;background:var(--bg)}'
  + '.g-caducado{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #dc2626;color:#7f1d1d;border-radius:10px;padding:14px;margin:0 0 14px;font-size:15px}'
  + '.g-nota{background:var(--bg);border-left:3px solid #f59e0b;color:#92400e;padding:8px 12px;margin:0 0 14px;font-size:13px;border-radius:6px}'
  + '.btn,.g-btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:8px 12px;border-radius:7px;border:1px solid #a2b5a8;'
  + 'background:#fff;color:var(--vd);text-decoration:none;font:600 14px/1.35 system-ui;cursor:pointer}.g-btn[hidden]{display:none}'
  + 'main a{color:var(--vd);text-underline-offset:.18em}main :focus-visible{outline:3px solid var(--vd);outline-offset:2px}'
  + '.g-provincia,.g-lectura,.g-meta,.g-tipo{font-size:14px;color:var(--mu);margin:4px 0 8px}.g-tipo strong{color:var(--vd)}'
  + '.g-recuento{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px;margin:8px 0}.g-total{font-size:15px;margin:0}.g-card{padding:14px 16px;margin:0 0 10px;border:1px solid var(--bd);border-radius:10px;background:#fff;overflow-wrap:anywhere}'
  + '.g-dir{font-size:18px;line-height:1.3;margin:4px 0}.g-hora{margin:6px 0 10px;white-space:pre-line}.g-distancia{font-size:14px;color:var(--vd);margin:8px 0 0}'
  + '.g-acciones,.g-filtros{display:flex;flex-wrap:wrap;gap:6px}.g-filtros{margin:8px 0}.g-btn--tel,.g-filtros a[aria-current]{color:white;background:var(--vd);border-color:var(--vd)}'
  + '.g-btn--tel{column-gap:.25em;flex-wrap:wrap}.g-btn--tel span{white-space:nowrap}'
  + '#g-ubicacion:empty{display:none}.g-vacio{border-left:3px solid var(--bd);padding:10px 12px;background:var(--bg)}'
  + '.g-otros ul{list-style:none;padding:0;display:flex;flex-wrap:wrap;gap:6px}.g-otros a{display:inline-flex;align-items:center;min-height:44px;padding:4px 8px}'
  + '@media(max-width:500px){main{padding:14px 12px}.g-card{padding:12px}.g-filtros .g-btn{padding:7px;font-size:13px}}'
  + '@media(max-width:360px){.g-filtros{display:grid;grid-template-columns:repeat(3,minmax(0,1fr))}.g-filtros .g-btn{padding:3px;text-align:center}.g-acciones:has(.g-btn--tel+.g-btn--tel) .g-btn--tel{flex:1 1 110px;padding:4px}.g-acciones:has(.g-btn--tel+.g-btn--tel) a:last-child:not(.g-btn--tel){flex-basis:100%}}'
  + 'footer{border-top:1px solid var(--bd);margin-top:28px;padding:16px 18px;color:var(--mu);font-size:13px;text-align:center}'
  + 'footer a{color:var(--vd)}'

export function envoltorioIndice(nonce: string, title: string, desc: string, canonical: string, cuerpo: string, noindex = false, script = '', datos = ''): string {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(title) + '</title>'
    + '<meta name="description" content="' + esc(desc) + '" />'
    + (noindex ? '<meta name="robots" content="noindex,follow" />' : '<meta name="robots" content="index,follow,max-image-preview:large" />')
    + '<link rel="canonical" href="' + esc(canonical) + '" />'
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(title) + '" />'
    + '<meta property="og:description" content="' + esc(desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(canonical) + '" />'
    + ogSocialTags(originFromCanonical(canonical))
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + datos + '<style nonce="' + esc(nonce) + '">' + CSS_INDICE + MASTHEAD_CSS + CABECERA_FARMACIAS_CSS + '</style></head><body>'
    + mastheadHtml('farmacias', { compact: true, hideMunicipioSearch: true }) + '<main>' + cuerpo + '</main>'
    + '<footer>Datos de los Colegios Oficiales de Farmacéuticos. '
    + '<a href="/">España Útil</a> &middot; <a href="/privacidad">Privacidad</a></footer>'
    + (script ? '<script nonce="' + esc(nonce) + '">' + script + '</script>' : '') + '</body></html>'
}

export interface ProvinciaGuardia {
  slug: string
  name: string
}

// /farmacias/guardia — indice nacional de provincias con guardia.
export function buildGuardiaIndexPage(nonce: string, provincias: ProvinciaGuardia[], canonical: string): string {
  const title = 'Farmacias de guardia en España, por provincia | España Útil'
  const desc = 'Consulta los turnos y horarios que recogen los colegios de ' + provincias.length + ' provincias.'
  const lista = provincias.map(p =>
    '<li><a href="/farmacias/' + esc(p.slug) + '">' + esc(p.name) + '</a></li>'
  ).join('')
  return envoltorioIndice(nonce, title, desc, canonical,
    '<h1>Farmacias de guardia por provincia</h1>'
    + '<p class="sub">Elige tu provincia para consultar los listados del colegio.</p>'
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + '<p class="aviso">Los turnos los publica cada Colegio Oficial de Farmaceuticos y pueden cambiar. '
    + 'Algunas farmacias de guardia atienden a puerta cerrada: llama al timbre.</p>'
    + '<p><a class="btn" href="/farmacias/">Buscar en otro municipio</a></p>'
  )
}

// /farmacias/:provincia — municipios de esa provincia con guardia.
export function buildGuardiaProvinciaPage(
  nonce: string, provinciaSlug: string, provinciaName: string,
  municipios: MunicipioGuardia[], actualizado: string | undefined, canonical: string, metadatos?: GuardiasFile,
): string {
  const fr = frescuraGuardia(actualizado, new Date(), zonaGuardia(provinciaSlug))
  const p = piezasFrescura(fr, provinciaName)
  const title = 'Farmacias y turnos en ' + provinciaName + ' | España Útil'
  const desc = 'Direcciones, teléfonos y horarios en los ' + municipios.length + ' municipios de ' + provinciaName + ' incluidos en el listado del colegio.'
  const fecha = fechaLegible(actualizado, zonaGuardia(provinciaSlug))
  const lista = municipios.map(m =>
    '<li><a href="/farmacias/' + esc(provinciaSlug) + '/' + esc(m.slug) + '">' + esc(m.name)
    + (m.count > 1 ? ' <b>' + m.count + '</b>' : '') + '</a></li>'
  ).join('')
  return envoltorioIndice(nonce, title, desc, canonical,
    '<h1>Farmacias y turnos en ' + esc(provinciaName) + '</h1>'
    + p.banner
    + fuenteHtml(provinciaSlug, metadatos)
    + '<p class="sub">' + municipios.length + ' municipio' + (municipios.length === 1 ? '' : 's')
    + ' en el listado' + (fecha ? ' &middot; consultado el ' + esc(fecha) : '') + '</p>'
    + p.nota
    + '<nav class="lista"><ul>' + lista + '</ul></nav>'
    + '<p class="aviso">Si tu municipio no aparece, no tenemos un turno publicado para él. Consulta la fuente oficial o el municipio más cercano.</p>'
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
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()',
    'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    // El estado a esta hora debe calcularse de nuevo en cada visita.
    'Cache-Control': 'no-store',
  }
}
