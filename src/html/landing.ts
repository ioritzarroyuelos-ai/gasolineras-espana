// Cerca de ti y Mi día: HTML útil sin JavaScript; personalización local progresiva.
import { APP_VERSION } from '../lib/version'
import { withAccountHeaders } from '../lib/runtime'
import { BRAND } from '../lib/brand'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { PORTAL_BASE_CSS } from './ui-theme'
import { CERCA_CSS } from './cerca-styles'
import { localidadHtml, LOCALIDAD_CSS } from './localidades'
import { serviciosLocalidad, type Localidad, type LocalidadIndex } from '../lib/localidades'
import { escapeHtml as esc, jsonLdScript } from './html'
import { emojiCielo } from './cielo'
import { ogSocialTags } from './seo'
import { prediccionVigente, zonaTiempo } from '../../scripts/lib/tiempo.mjs'
import { fechaHoraLocal } from '../../scripts/lib/fechas.mjs'
import { bloqueAtrasado, fechaConsultaDeporte, etiquetaEstadoDeporte, type CompeticionDeportiva } from '../lib/deportes'

export interface LandingTiempo {
  nombre: string; url: string; tmax: number | null; tmin: number | null; cielo: string
  elaborado?: string; fuente?: string
}
export interface LandingData {
  localidad?: Localidad
  encontrados?: LocalidadIndex[]
  query?: string
  gasolina?: { g95?: number; diesel?: number; fecha?: string }
  tiempo?: LandingTiempo[]
  deporte?: CompeticionDeportiva
  vista?: 'inicio' | 'mi-dia'
}
const MODULOS = [
  { id: 'tiempo', nombre: 'El tiempo', url: '/tiempo/' },
  { id: 'gasolineras', nombre: 'Gasolineras', url: '/gasolineras/' },
  { id: 'deportes', nombre: 'Deportes', url: '/deportes/' },
  { id: 'farmacias', nombre: 'Farmacias de guardia', url: '/farmacias/' },
  { id: 'itv', nombre: 'ITV', url: '/itv/' },
  { id: 'politica', nombre: 'Política', url: '/politica/' },
] as const
type Modulo = typeof MODULOS[number]['id']
const PREDETERMINADOS: Modulo[] = ['tiempo', 'gasolineras', 'deportes']

function icono(id: string): string {
  const paths: Record<string, string> = {
    tiempo: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    gasolineras: '<path d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M2 21h14M4 11h10M14 12h2a2 2 0 0 1 2 2v3a2 2 0 0 0 4 0V8l-4-4M19 5v4h3"/>',
    farmacias: '<path d="M8 3h8v5h5v8h-5v5H8v-5H3V8h5z"/>',
    deportes: '<circle cx="12" cy="12" r="9"/><path d="m12 7 5 4-2 6H9l-2-6zM12 3v4m9 4h-4M17 20l-2-3M7 20l2-3M3 11h4"/>',
    itv: '<path d="m4 10 2-6h12l2 6M3 10h18v9H3zM6 19v2m12-2v2M6 14h2m8 0h2"/>',
    politica: '<path d="m3 9 9-6 9 6H3m1 12h16M6 12v5m6-5v5m6-5v5"/>',
    guardar: '<path d="M6 3h12v19l-6-4-6 4z"/>',
    mapa: '<path d="m2 6 6-3 8 3 6-3v15l-6 3-8-3-6 3zM8 3v15m8-12v15"/>',
    ajustes: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6"/>',
  }
  return `<svg class="eu-icon" viewBox="0 0 24 24" aria-hidden="true">${paths[id] || paths.guardar}</svg>`
}
function fecha(ts?: string | null, zona = 'Europe/Madrid'): string {
  if (!ts || !Number.isFinite(Date.parse(ts))) return ''
  return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: zona }).format(new Date(ts))
}
function guardar(id: Modulo): string {
  const nombre = MODULOS.find(m => m.id === id)!.nombre
  return `<button hidden class="eu-bookmark" type="button" data-dia-toggle="${id}" aria-pressed="false" aria-label="Guardar ${esc(nombre)} en mis favoritos">${icono('guardar')}<span class="sr-only" data-dia-toggle-label>Guardar</span></button>`
}
function abreTarjeta(id: Modulo, day: boolean, clase = ''): string {
  const nombre = MODULOS.find(m => m.id === id)!.nombre
  return `<article class="eu-card ${clase}" data-dia-module="${id}"${day && !PREDETERMINADOS.includes(id) ? ' hidden' : ''}><div class="eu-card-top"><span class="eu-tag">${icono(id)}${esc(nombre)}</span>${day ? '' : guardar(id)}</div>`
}
function tiempoLocal(data: LandingData): LandingTiempo | undefined {
  const m = data.localidad
  if (!m) return data.tiempo?.[0]
  const p = prediccionVigente(m.tiempo.pred)
  const hoy = fechaHoraLocal(new Date(), zonaTiempo(m.ine)).slice(0, 10)
  const d = p?.dias.find(d => d.fecha.slice(0, 10) === hoy)
  return d && p ? { nombre: m.nombre, url: m.tiempo.url, ...d, elaborado: p.elaborado, fuente: p.fuente } : undefined
}
function tarjetaTiempo(data: LandingData, day: boolean): string {
  const t = tiempoLocal(data), m = data.localidad
  const url = m?.tiempo.url || t?.url || '/tiempo/'
  return abreTarjeta('tiempo', day, 'eu-weather')
    + `<h2>${esc(m?.nombre || t?.nombre || 'El tiempo cerca de ti')}</h2>`
    + (t ? `<div class="eu-weather-main"><div><div class="eu-weather-number">${esc(t.tmax ?? '—')}°</div><span class="eu-weather-range">Máxima del día · mínima ${esc(t.tmin ?? '—')}°</span></div><span class="eu-weather-symbol" aria-hidden="true">${emojiCielo(t.cielo)}</span></div><p class="eu-weather-summary">${esc(t.cielo || 'Consulta la previsión por horas')}</p><p class="eu-source">Previsión de hoy · ${esc(t.fuente || 'AEMET')}${t.elaborado ? ' · elaborado ' + esc(fecha(t.elaborado, m ? zonaTiempo(m.ine) : 'Europe/Madrid')) : ''}</p>`
      : `<div class="eu-weather-main"><p class="eu-weather-empty">${m ? 'Consulta la previsión de tu municipio.' : '¿Paraguas o gafas de sol?'}</p><span class="eu-weather-symbol" aria-hidden="true">?</span></div><p class="eu-muted">${m ? 'No tenemos un resumen vigente para hoy. Comprueba la última predicción y los avisos.' : 'Elige tu municipio para ver la previsión y los avisos de tu zona.'}</p>`)
    + `<div class="eu-card-foot"><a href="${esc(url)}">${t ? 'Previsión por horas y avisos' : 'Consultar el tiempo'} →</a></div>`
    + (!m && !day && (data.tiempo?.length || 0) > 1 ? `<div class="eu-weather-strip">${data.tiempo!.slice(1, 4).map(x => `<a href="${esc(x.url)}">${esc(x.nombre)} · ${esc(x.tmax ?? '—')}° máx.</a>`).join('')}</div>` : '') + '</article>'
}
function tarjetaGas(data: LandingData, day: boolean): string {
  const m = data.localidad, g = data.gasolina
  const age = Date.now() - Date.parse(m?.gas.ts || '')
  const localPrice = m && age >= -300000 && age <= 86400000 ? m.gas.min95 : undefined
  const price = m ? localPrice : g?.g95
  return abreTarjeta('gasolineras', day, 'eu-gas')
    + `<h2>${m ? 'Reposta en ' + esc(m.nombre) : 'Tu próxima parada, al mejor precio.'}</h2>`
    + (price ? `<p class="eu-price-label">${m ? 'Gasolina 95 desde' : 'Gasolina 95 · media nacional'}</p><p class="eu-price">${price.toFixed(3).replace('.', ',')} <small>€/L</small></p>` : '')
    + (!m && g?.diesel ? `<p class="eu-price-label">Gasóleo A · media nacional <strong>${g.diesel.toFixed(3).replace('.', ',')} €/L</strong></p>` : '')
    + `<p class="eu-muted">${m ? esc(price ? m.gas.count + (m.gas.count === 1 ? ' estación con precios publicados.' : ' estaciones con precios publicados.') : serviciosLocalidad(m)[0].detalle) : 'Compara los precios, filtra por combustible y encuentra tu gasolinera en el mapa.'}</p>`
    + (m ? `<p class="eu-source">${m.gas.ts ? 'Datos del Ministerio · ' + esc(fecha(m.gas.ts)) : 'Consulta la fecha de los precios en el mapa.'}</p>` : g?.fecha ? `<p class="eu-source">Datos del Ministerio: ${esc(g.fecha)}</p>` : '')
    + (day ? '<h3>Tus gasolineras guardadas</h3><div class="eu-favorites" data-dia-gas-favs><p>Abre el mapa y pulsa la estrella de una gasolinera para guardarla.</p></div>' : '')
    + `<div class="eu-card-foot"><a class="eu-button" href="/gasolineras/mapa">${icono('mapa')} Abrir mapa de gasolineras</a><a href="${esc(m?.gas.url || '/gasolineras/')}">${m ? 'Ver precios en tu zona' : 'Buscar por municipio'} →</a></div></article>`
}
function tarjetaDeportes(data: LandingData, day: boolean): string {
  const c = data.deporte, now = Date.now()
  // Selección sobre la agenda validada. Nunca inferimos que está en directo por la hora.
  const events = c?.agenda.eventos || []
  const event = [...events].filter(e => e.estado === 'finalizado' && e.resultado && e.inicio && Date.parse(e.inicio) <= now).sort((a,b) => Date.parse(b.inicio!) - Date.parse(a.inicio!))[0]
    || [...events].filter(e => e.estado === 'programado' && e.inicio && Date.parse(e.inicio) > now).sort((a,b) => Date.parse(a.inicio!) - Date.parse(b.inicio!))[0]
  return abreTarjeta('deportes', day)
    + '<h2>El deporte que te mueve.</h2>'
    + (event && c ? `<p class="eu-muted">LaLiga · ${esc(etiquetaEstadoDeporte(event))} · ${esc(fecha(event.inicio))}</p><div class="eu-score"><span>${esc(event.local || event.nombre)}</span><b>${event.estado === 'finalizado' ? esc(event.resultado?.local) : '—'}</b><span>${esc(event.visitante || '')}</span><b>${event.estado === 'finalizado' ? esc(event.resultado?.visitante) : '—'}</b></div><p class="eu-source">${bloqueAtrasado(c.agenda) ? 'Datos pendientes de actualizar. ' : ''}Consulta: ${esc(fechaConsultaDeporte(c.agenda.verificadoEn))}. No es un marcador en directo. <a href="/deportes/competicion/${esc(c.id)}?vista=${event.estado === 'finalizado' ? 'resultados' : 'calendario'}">${event.estado === 'finalizado' ? 'Resultados' : 'Calendario'} y fuente</a></p>` : '<p class="eu-muted">Resultados, próximos partidos, clasificaciones y dónde verlo, con sus fuentes.</p>')
    + (day ? '<h3>Lo que sigues</h3><div class="eu-favorites" data-dia-sport-favs><p>Pulsa ☆ en Deportes para seguir equipos, pilotos y competiciones.</p></div>' : '')
    + '<div class="eu-direct"><a href="/deportes/futbol">Fútbol</a><a href="/deportes/baloncesto">Baloncesto</a><a href="/deportes/motor">Motor</a></div><div class="eu-card-foot"><a href="/deportes/">Ver deportes y clasificaciones →</a></div></article>'
}
function tarjeta(id: Modulo, data: LandingData, day: boolean): string {
  if (id === 'tiempo') return tarjetaTiempo(data, day)
  if (id === 'gasolineras') return tarjetaGas(data, day)
  if (id === 'deportes') return tarjetaDeportes(data, day)
  const m = data.localidad
  if (id === 'farmacias') return abreTarjeta(id, day, 'eu-pharmacy')
    + '<div class="eu-pharmacy-symbol" aria-hidden="true">+</div>'
    + `<h2>${m ? 'Farmacias en ' + esc(m.nombre) : 'Una farmacia cuando la necesitas.'}</h2><p class="eu-muted">Consulta qué farmacia está de guardia, su horario y cómo llegar. Llama antes de desplazarte.</p>`
    + `<div class="eu-card-foot"><a href="${esc(m?.farmacias.url || '/farmacias/guardia')}">Consultar turnos y horarios →</a></div></article>`
  if (id === 'itv') return abreTarjeta(id, day)
    + '<h2>Tu ITV, más a mano.</h2>'
    + `<p class="eu-muted">${m ? esc(serviciosLocalidad(m)[3].detalle) + '. ' : ''}Consulta estaciones, compara las tarifas disponibles y abre la cita oficial.</p><p class="eu-source">Las plazas y los horarios se confirman en la web de cada estación.</p><div class="eu-card-foot"><a href="${esc(m?.itv.url || '/itv/')}">Buscar estación de ITV →</a></div></article>`
  return abreTarjeta(id, day)
    + '<h2>La política, más clara.</h2><p class="eu-muted">Fechas electorales, resultados y sondeos. Cada cifra con su fuente y su fecha.</p><div class="eu-direct"><a href="/politica/generales">Congreso</a><a href="/politica/generales/senado">Senado</a><a href="/politica/europeas">Europeas</a></div><div class="eu-card-foot"><a href="/politica/">Ver elecciones y sondeos →</a></div></article>'
}
function ajustes(): string {
  return `<section class="eu-adjust" id="mi-dia-ajustes" aria-labelledby="mi-dia-ajustes-titulo" hidden><h2 id="mi-dia-ajustes-titulo">Pon Mi día a tu gusto</h2><p>Elige tus bloques y usa las flechas para decidir qué aparece primero.</p><ul class="eu-settings">${MODULOS.map(m => `<li class="eu-setting" data-dia-setting="${m.id}"><label><input type="checkbox" data-dia-visible="${m.id}"${PREDETERMINADOS.includes(m.id) ? ' checked' : ''}>${m.nombre}</label><span class="eu-setting-arrows"><button type="button" data-dia-up="${m.id}" aria-label="Subir ${m.nombre}">↑</button><button type="button" data-dia-down="${m.id}" aria-label="Bajar ${m.nombre}">↓</button></span></li>`).join('')}</ul><p>Tu municipio se elige en la cabecera. Tus gasolineras, equipos y competiciones se guardan con la estrella de su sección.</p><button class="eu-button" id="mi-dia-listo" type="button">Listo</button></section>`
}

function favoritosInicio(): string {
  return `<section id="mis-favoritos" class="eu-home-favorites" aria-labelledby="home-favorites-title" hidden>
    <div class="eu-section-head"><div><p class="eu-eyebrow">Tu espacio personal</p><h2 id="home-favorites-title">Tus favoritos, a mano.</h2><p id="home-favorites-note">Con Google se guardan en tu cuenta; sin sesión, en este navegador.</p></div><a class="eu-link" href="/mi-dia">Organizar Mi día →</a></div>
    <div class="eu-favorite-grid">
      <article class="eu-favorite-card"><h3>${icono('guardar')} Tus bloques</h3><div class="eu-favorites" data-home-module-favs></div><a class="eu-link" href="#cerca-servicios">Elegir bloques →</a></article>
      <article class="eu-favorite-card"><h3>${icono('gasolineras')} Tus gasolineras</h3><div class="eu-favorites" data-dia-gas-favs></div><a class="eu-link" href="/gasolineras/mapa?action=favs">Ver favoritas en el mapa →</a></article>
      <article class="eu-favorite-card"><h3>${icono('deportes')} Lo que sigues</h3><div class="eu-favorites" data-dia-sport-favs></div><a class="eu-link" href="/deportes/#favoritos">Ver favoritos de Deportes →</a></article>
    </div>
  </section>`
}

export function buildLandingPage(nonce = '', reqUrl = 'https://webapp-3ft.pages.dev/', data: LandingData = {}): string {
  let origin = 'https://webapp-3ft.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* Origen de respaldo. */ }
  const day = data.vista === 'mi-dia', canonical = origin + (day ? '/mi-dia' : '/')
  const title = day ? 'Mi día · Tu información a mano | España Útil' : 'España Útil · El tiempo, gasolineras y mucho más cerca de ti'
  const desc = 'El tiempo, gasolineras, farmacias de guardia, ITV, elecciones y deportes. Información con fuentes y fechas, sin registro y gratis. Organiza tu propio Mi día.'
  const query = data.localidad ? '?municipio=' + data.localidad.ine : ''
  const schema = { '@context': 'https://schema.org', '@graph': [
    { '@type': 'WebSite', '@id': origin + '/#website', name: BRAND, url: origin, description: desc, inLanguage: 'es-ES', publisher: { '@id': origin + '/#organization' } },
    { '@type': 'Organization', '@id': origin + '/#organization', name: BRAND, url: origin, logo: origin + '/static/logo.svg' },
    { '@type': 'ItemList', name: 'Servicios de ' + BRAND, itemListElement: MODULOS.map((m, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': 'Service', name: m.nombre, url: origin + m.url } })) },
  ] }
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="color-scheme" content="light"><meta name="theme-color" content="#137954"><title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${esc(canonical)}"><meta name="robots" content="${day ? 'noindex,follow' : 'index,follow,max-image-preview:large'}"><meta name="google-site-verification" content="qzv_20xQiNesXM4hX5ZqYozonYMqZhY-Wop2Tndu81w"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="icon" href="/static/favicon-32.png" type="image/png" sizes="32x32"><link rel="apple-touch-icon" href="/static/apple-touch-icon.png"><meta property="og:type" content="website"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(canonical)}">${ogSocialTags(origin)}<meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="generator" content="España Útil v${APP_VERSION}">${jsonLdScript(schema, nonce)}<style nonce="${esc(nonce)}">${PORTAL_BASE_CSS}${MASTHEAD_CSS}${CERCA_CSS}${LOCALIDAD_CSS}</style></head><body>${mastheadHtml(day ? 'mi-dia' : 'inicio')}
  <main class="eu-main"${day ? ' data-mi-dia' : ''}>
    ${day ? '' : favoritosInicio()}
    ${day ? `<a class="eu-link" href="/${query}">← Volver a Cerca de ti</a><div class="eu-day-head"><div><p class="eu-eyebrow">Tu espacio personal</p><h1>Tu día. <span>A tu manera.</span></h1><p>Lo que te interesa, en el orden que tú eliges. Con Google se guarda en tu cuenta; sin sesión, en este navegador.</p></div><button hidden id="mi-dia-personalizar" class="eu-button secondary" type="button" aria-expanded="false" aria-controls="mi-dia-ajustes">${icono('ajustes')} Personalizar Mi día</button></div>${ajustes()}`
      : `<section class="eu-hero" aria-labelledby="portada-titulo"><div class="eu-intro"><p class="eu-eyebrow">Tu zona. Tus planes. Tu día.</p><h1 id="portada-titulo">Hoy lo tienes <span>más cerca.</span></h1><p>El tiempo, gasolineras, farmacias, ITV, política y deportes. Todo a mano para que sigas con tu día.</p><div class="eu-actions"><a class="eu-button" href="/mi-dia${query}">Organizar Mi día →</a><a class="eu-link" href="#cerca-servicios">Explorar los servicios ↓</a></div></div>${tarjetaTiempo(data, false)}</section>`}
    ${localidadHtml(data.localidad, data.encontrados, data.query, day ? '/mi-dia' : '/')}
    ${day ? '<noscript><p class="eu-muted">Puedes consultar estos servicios sin JavaScript. Para personalizar los bloques y recordar tus preferencias, activa JavaScript en tu navegador.</p></noscript><section id="mi-dia-vacio" class="eu-empty" hidden><h2>Tu día empieza aquí</h2><p>Añade los bloques que quieras ver, o vuelve a la selección inicial.</p><button type="button" class="eu-button" data-dia-reset>Restaurar mis bloques</button></section>' : '<div class="eu-section-head" id="cerca-servicios"><h2>Lo que necesitas, a un toque.</h2><p>Guarda tus bloques y aparecerán en tus favoritos y en Mi día.</p></div>'}
    <div class="eu-grid${day ? '' : ' eu-home-grid'}"${day ? ' id="mi-dia-modulos"' : ''}>${(day ? MODULOS.map(m => m.id) : ['gasolineras', 'farmacias', 'deportes', 'itv', 'politica'] as Modulo[]).map(id => tarjeta(id, data, day)).join('')}</div>
    <p class="sr-only" id="mi-dia-estado" role="status" aria-live="polite"></p>
    <section class="eu-support"><div><h2>${day ? 'Tus favoritos vienen contigo.' : 'Menos buscar. Más hacer.'}</h2><p>${day ? 'Las estrellas del mapa y de Deportes aparecen también aquí. Elige tu municipio para tener a mano sus servicios.' : 'Entra en Mi día, elige lo que te interesa y ordénalo como prefieras. La próxima vez, lo encontrarás a tu gusto.'}</p></div><a class="eu-button secondary" href="${day ? '/gasolineras/mapa?action=favs' : '/mi-dia' + query}">${day ? 'Ver favoritas en el mapa' : 'Descubrir Mi día →'}</a></section>
    <nav class="eu-direct" aria-label="Más información"><a href="/precios-carburantes">Resumen de precios de carburantes</a><a href="/farmacias/guardia">Guardias por provincia</a><a href="/acerca">Fuentes de los datos</a></nav>
  </main><footer class="eu-footer"><p><strong>España Útil.</strong> Cerca de lo que importa.</p><nav aria-label="Información de la web"><a href="/acerca">Acerca y fuentes</a><a href="/privacidad">Privacidad</a><a href="/status">Estado de los datos</a></nav></footer><script src="/static/mi-dia.js?v=${APP_VERSION}" defer></script></body></html>`
}

export function landingHeaders(nonce: string): Record<string, string> {
  return withAccountHeaders({
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': ["default-src 'self'", "script-src 'self' 'nonce-" + nonce + "'", "style-src 'self' 'nonce-" + nonce + "'", "img-src 'self' data:", "font-src 'self'", "connect-src 'self'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'", "object-src 'none'", 'upgrade-insecure-requests', 'report-uri /api/csp-report', 'report-to csp-endpoint'].join('; '),
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains', 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), usb=(), payment=(), interest-cohort=()', 'Reporting-Endpoints': 'csp-endpoint="/api/csp-report"',
    // No recuperar una previsión o un resultado personal antiguo al volver atrás/offline.
    'Cache-Control': 'no-store',
  })
}
