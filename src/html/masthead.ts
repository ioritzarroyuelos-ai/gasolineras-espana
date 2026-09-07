// Cabecera de periódico COMÚN a todo el portal CercaYa.
//
// Misma cabecera en TODAS las páginas (portada, tiempo, gasolineras, farmacias,
// ITV, precios y el mapa): fecha del día + marca + lema + menú de secciones.
// Al navegar entre secciones, como la cabecera es idéntica, se ve como si solo
// cambiara el cuerpo.
//
// Autocontenida a propósito: sus estilos usan variables --mh-* propias y todos
// los selectores cuelgan de `.masthead`, para NO chocar con la paleta ni las
// reglas de cada página (cada sección tiene su CSS). Sin JavaScript.
//
// - mastheadHtml(active, opts): markup del <header>. Calcula la fecha en el
//   servidor (Intl, con red de seguridad). `active` subraya la sección actual.
//   opts.brandAsH1 pinta la marca como <h1> (solo en la portada; el resto de
//   páginas ya tienen su propio <h1> de contenido).
// - MASTHEAD_CSS: los estilos, para inyectar en el <style> de cada página.

export type SeccionActiva = 'tiempo' | 'gasolineras' | 'farmacias' | 'itv' | null

function esc(s: unknown): string {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// Fecha de hoy en España, capitalizada ("Domingo, 6 de septiembre de 2026").
// En el Worker y en los tests hay Intl con zonas horarias; si fallara, cadena
// vacía y la cabecera simplemente no muestra la línea de fecha.
function fechaHoy(): string {
  try {
    const f = new Intl.DateTimeFormat('es-ES', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid',
    }).format(new Date())
    return f.charAt(0).toUpperCase() + f.slice(1)
  } catch {
    return ''
  }
}

export function mastheadHtml(active: SeccionActiva = null, opts: { brandAsH1?: boolean } = {}): string {
  const fecha = fechaHoy()
  const titulo = opts.brandAsH1
    ? '<h1 class="mh-title">CercaYa</h1>'
    : '<span class="mh-title">CercaYa</span>'
  const item = (href: string, key: SeccionActiva, label: string): string =>
    '<a href="' + href + '"' + (active === key ? ' class="mh-on" aria-current="page"' : '') + '>' + label + '</a>'
  return '<header class="masthead">'
    + '<div class="mh-inner">'
    + (fecha ? '<p class="mh-date">' + esc(fecha) + ' · España</p>' : '')
    + '<a href="/" class="mh-brand" aria-label="CercaYa — inicio">'
    + '<img src="/static/logo.svg" alt="" class="mh-logo" width="44" height="44" decoding="async" />'
    + titulo
    + '</a>'
    + '<p class="mh-tag">Info útil de España al instante · sin registro y gratis</p>'
    + '</div>'
    + '<nav class="mh-nav" aria-label="Secciones">'
    + item('/tiempo/', 'tiempo', 'El tiempo')
    + item('/gasolineras/', 'gasolineras', 'Gasolineras')
    + item('/farmacias/', 'farmacias', 'Farmacias')
    + item('/itv/', 'itv', 'ITV')
    + '</nav>'
    + '</header>'
}

// Estilos de la cabecera. Todo cuelga de `.masthead` y usa variables --mh-*
// propias, así se puede inyectar en cualquier página sin colisiones.
export const MASTHEAD_CSS =
  '.masthead{--mh-paper:#faf8f4;--mh-ink:#1a1a1a;--mh-muted:#5b6470;--mh-brand:#16a34a;'
  + '--mh-brand-dark:#166534;--mh-brand-soft:#dcfce7;--mh-rule:#d9d4c9;'
  + 'background:var(--mh-paper);color:var(--mh-ink);text-align:center;padding:22px 20px 0;'
  + "font-family:system-ui,-apple-system,'Segoe UI',Roboto,'Helvetica Neue',sans-serif}"
  + '@media(prefers-color-scheme:dark){.masthead{--mh-paper:#0f172a;--mh-ink:#f1f5f9;--mh-muted:#94a3b8;'
  + '--mh-brand:#4ade80;--mh-brand-dark:#86efac;--mh-brand-soft:#064e3b;--mh-rule:#334155}}'
  + '.masthead .mh-inner{max-width:1080px;margin:0 auto}'
  + '.masthead .mh-date{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--mh-muted);'
  + 'padding-bottom:10px;margin:0 0 14px;border-bottom:1px solid var(--mh-rule)}'
  + '.masthead .mh-brand{display:inline-block;text-decoration:none;color:inherit}'
  + '.masthead .mh-logo{width:44px;height:44px;display:block;margin:0 auto 4px}'
  + ".masthead .mh-title{display:block;font-family:Georgia,'Times New Roman','Nimbus Roman',serif;"
  + 'font-size:clamp(34px,7vw,64px);font-weight:800;letter-spacing:-.02em;margin:0;color:var(--mh-ink);line-height:1}'
  + ".masthead .mh-tag{font-family:Georgia,'Times New Roman',serif;font-style:italic;color:var(--mh-muted);"
  + 'margin:8px 0 16px;font-size:clamp(14px,2vw,17px)}'
  + '.masthead .mh-nav{max-width:1080px;margin:0 auto;display:flex;flex-wrap:wrap;justify-content:center;'
  + 'border-top:3px double var(--mh-ink);border-bottom:1px solid var(--mh-rule)}'
  + '.masthead .mh-nav a{padding:12px 18px;font-size:13px;font-weight:700;text-transform:uppercase;'
  + 'letter-spacing:.06em;color:var(--mh-brand-dark);text-decoration:none}'
  + '.masthead .mh-nav a:hover{background:var(--mh-brand-soft)}'
  + '.masthead .mh-nav a:focus-visible{background:var(--mh-brand-soft);outline:3px solid var(--mh-brand-dark);outline-offset:-3px}'
  + '.masthead .mh-nav a.mh-on{text-decoration:underline;text-underline-offset:5px;text-decoration-thickness:2px}'
