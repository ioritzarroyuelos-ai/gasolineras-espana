// Una sola cabecera para Cerca de ti, Mi día y las seis secciones.
// El buscador conserva su formulario GET para funcionar sin JavaScript.
import { PORTAL_TOKENS } from './ui-theme'
import { APP_VERSION } from '../lib/version'
import { cuentaHtml, cuentaModalHtml, CUENTA_CSS } from './cuenta'

export type SeccionActiva = 'inicio' | 'mi-dia' | 'tiempo' | 'gasolineras' | 'farmacias' | 'itv' | 'politica' | 'deportes' | null

export function mastheadHtml(active: SeccionActiva = null, opts: { hideMunicipioSearch?: boolean; compact?: boolean } = {}): string {
  const item = (href: string, key: SeccionActiva, label: string): string =>
    '<a href="' + href + '"' + (active === key ? ' class="mh-on" aria-current="page"' : '') + '>' + label + '</a>'
  const municipioTag = opts.compact ? 'details' : 'div'
  return '<header class="masthead' + (opts.compact ? ' masthead--compact' : '') + '">'
    + '<div class="mh-inner"><a href="/" class="mh-brand" aria-label="España Útil — inicio">'
    + '<img src="/static/logo.svg" alt="" class="mh-logo" width="36" height="36" decoding="async" /><span class="mh-title">España Útil</span></a>'
    + '<div class="mh-actions"><a class="mh-location" data-municipio-default data-municipio-nombre="Municipio" href="' + (active === 'mi-dia' ? '/mi-dia' : '/') + '#municipio-form" aria-label="Elegir tu municipio">Tu municipio</a>'
    + '<a id="municipio-elegido" class="mh-location" hidden></a>'
    + cuentaHtml() + '</div></div>'
    + '<nav class="mh-nav" aria-label="Secciones">'
    + item('/', 'inicio', 'Inicio') + item('/tiempo/', 'tiempo', 'El tiempo')
    + item('/gasolineras/', 'gasolineras', 'Gasolineras') + item('/farmacias/', 'farmacias', 'Farmacias')
    + item('/itv/', 'itv', 'ITV') + item('/politica/', 'politica', 'Política') + item('/deportes/', 'deportes', 'Deportes') + item('/mi-dia', 'mi-dia', 'Mi día') + '</nav>'
    + (opts.hideMunicipioSearch ? '' : '<' + municipioTag + ' class="mh-local">'
      + (opts.compact ? '<summary>Cambiar municipio</summary>' : '')
      + '<form id="municipio-form" action="' + (active === 'mi-dia' ? '/mi-dia' : '/') + '" method="get" role="search"><label for="municipio-busqueda">Tu municipio</label> <input id="municipio-busqueda" type="search" name="q" minlength="2" maxlength="70" placeholder="Nombre del municipio" autocomplete="off" required /> <button>Buscar</button></form>'
      + '<ul id="municipio-resultados" aria-label="Sugerencias de municipios"></ul></' + municipioTag + '>')
    + '</header>' + cuentaModalHtml()
    + '<script src="/static/cuenta.js?v=' + APP_VERSION + '" defer></script>'
    + '<script src="/static/municipio.js?v=' + APP_VERSION + '" defer></script>'
}

// Selectores acotados: no cambian el mapa, tablas o botones de cada sección.
export const MASTHEAD_CSS = PORTAL_TOKENS + `
.masthead{--mh-paper:var(--eu-paper);--mh-ink:var(--eu-ink);--mh-muted:var(--eu-muted);--mh-brand-dark:var(--eu-accent);--mh-brand-soft:var(--eu-soft);--mh-rule:var(--eu-line);position:relative;z-index:1100;background:var(--mh-paper);color:var(--mh-ink);padding:22px 24px 0;border-bottom:1px solid var(--mh-rule);font:14px/1.45 var(--eu-font)}
.masthead *{box-sizing:border-box}.masthead [hidden]{display:none!important}
.masthead .mh-inner{max-width:1120px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.masthead .mh-brand{display:inline-flex;align-items:center;gap:9px;text-decoration:none;color:inherit;flex:none}
.masthead .mh-logo{width:36px;height:36px;display:block;margin:0}
.masthead .mh-title{display:block;font-family:var(--eu-font);font-size:26px;font-weight:800;letter-spacing:-1px;margin:0;color:var(--mh-ink);line-height:1.15}
.masthead .mh-actions{display:flex;align-items:center;justify-content:flex-end;gap:12px;min-width:0}
.masthead .mh-location{display:inline-flex;align-items:center;gap:6px;max-width:220px;min-height:44px;padding:8px 10px;border-radius:12px;color:var(--mh-muted);font-size:12px;text-decoration:none;overflow-wrap:anywhere}
.masthead .mh-location::before{content:'⌖';font-size:20px;flex:none;color:var(--mh-brand-dark)}
.masthead .mh-actions:has(#municipio-elegido:not([hidden])) [data-municipio-default]{display:none}
.masthead .mh-nav{max-width:1120px;margin:18px auto 0;display:flex;flex-wrap:wrap;gap:4px;padding:0 0 12px;border:0}
.masthead .mh-nav a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 17px;border-radius:12px;font-size:13px;font-weight:650;color:var(--mh-muted);text-decoration:none;white-space:nowrap}
.masthead .mh-nav a:hover,.masthead .mh-location:hover{background:var(--mh-brand-soft);color:var(--mh-brand-dark)}
.masthead .mh-nav a.mh-on{background:var(--mh-brand-soft);color:var(--mh-brand-dark)}
.masthead :focus-visible{outline:3px solid #1462a1;outline-offset:3px}
.masthead .mh-local{max-width:1120px;margin:0 auto;padding:0 0 14px;font-size:14px}.masthead .mh-local summary{cursor:pointer;font-weight:650;padding:5px 0;min-height:30px;color:var(--mh-brand-dark)}
.masthead form{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.masthead label{font-weight:650}.masthead input{font:inherit;padding:10px 12px;border:1px solid #8da596;border-radius:12px;min-width:0;max-width:100%;background:var(--eu-surface);color:var(--eu-ink)}
.masthead button{font:inherit;font-weight:650;min-height:44px;padding:10px 16px;background:var(--mh-brand-dark);color:#fff;border:0;border-radius:12px;cursor:pointer}
.masthead #municipio-resultados{padding:0;list-style:none;margin:4px 0}.masthead #municipio-resultados:empty{margin:0}.masthead #municipio-resultados a{display:block;padding:10px 12px;border-radius:10px;color:var(--mh-brand-dark)}.masthead #municipio-resultados a:hover{background:var(--mh-brand-soft)}
.masthead--compact{padding-top:12px}.masthead--compact .mh-nav{margin-top:6px;padding-bottom:6px}.masthead--compact .mh-title{font-size:23px}.masthead--compact .mh-logo{width:30px;height:30px}
@media(max-width:650px){.masthead{padding:12px 12px 0}.masthead .mh-inner{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:8px;row-gap:0}.masthead .mh-title{font-size:20px;letter-spacing:-.7px}.masthead .mh-logo{width:28px;height:28px}.masthead .mh-brand{gap:6px;grid-column:1;grid-row:1}.masthead .mh-actions{display:contents}.masthead .mh-account{grid-column:2;grid-row:1}.masthead .mh-location{grid-column:1/-1;grid-row:2;max-width:100%;min-height:36px;padding:4px 0;font-size:12px}.masthead .mh-location::before{font-size:17px}.masthead .mh-nav{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px;margin-top:2px;padding-bottom:6px}.masthead .mh-nav a{min-width:0;font-size:12px;padding:8px 3px}.masthead .mh-local{padding-bottom:10px}.masthead form{gap:6px}.masthead input{flex:1 1 150px;font-size:16px}.masthead label{flex-basis:100%;font-size:13px}.masthead--compact .mh-local:not([open]){padding-bottom:4px}}
@media(max-width:360px){.masthead .mh-title{font-size:18px}.masthead .mh-inner{column-gap:5px}.masthead .mh-nav a{font-size:11px}}
` + CUENTA_CSS
