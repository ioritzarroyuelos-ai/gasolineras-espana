import type { DiaPrediccion, MunicipioLista, ParteHoras, Prediccion } from '../../scripts/lib/tiempo.mjs'
import { withAccountHeaders } from '../lib/runtime'
import { AEMET_MUNICIPIOS, urlMunicipioAemet, zonaTiempo } from '../../scripts/lib/tiempo.mjs'
import { fechaHoraLocal, instanteLocal } from '../../scripts/lib/fechas.mjs'
import type { AvisosTiempo } from '../lib/tiempo-avisos'
import type { ResultadoTiempo } from '../lib/tiempo-municipios'
import { mastheadHtml, MASTHEAD_CSS } from './masthead'
import { PORTAL_BASE_CSS } from './ui-theme'
import { ogSocialTags, originFromCanonical, breadcrumbLd } from './seo'
import { escapeHtml as esc } from './html'
import { emojiCielo } from './cielo'
import { buscadorTiempo, resultadosTiempo, CSS_BUSCADOR_TIEMPO } from './tiempo-buscador'

const CSS = PORTAL_BASE_CSS + `
:root{color-scheme:light;--muted:var(--eu-muted);--green:var(--eu-accent);--rule:var(--eu-line)}

main{max-width:68rem;margin:auto;padding:clamp(1rem,3vw,2rem);overflow-wrap:anywhere}
h1,h2{font-family:var(--eu-font);line-height:1.12;margin:0}
h1{font-size:clamp(1.8rem,5vw,3rem)}h2{font-size:clamp(1.4rem,3vw,1.85rem);margin-bottom:.65rem}
a{color:var(--green);text-underline-offset:3px} :focus-visible{outline:3px solid #1462a1;outline-offset:3px}
.sub,.fuente,.aviso-meta{color:var(--muted);font-size:.89rem}.sub{margin:.25rem 0 1rem}.fuente{margin:.8rem 0 0}
.seccion{margin-top:1.65rem}.panel{background:var(--eu-surface);border:1px solid var(--eu-line);border-radius:24px;padding:clamp(1rem,3vw,1.6rem)}
.hoy{background:linear-gradient(135deg,#173f34,#356b4b);color:#f4f9ef;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:.25rem 1rem;align-items:center}
.hoy h2{color:#f4f9ef;font:600 1rem/1.4 var(--eu-font);margin:0}.hoy .cielo{color:#f4f9ef;font:650 clamp(1.6rem,4vw,2.5rem)/1.18 var(--eu-font);margin:.2rem 0 .65rem}
.temperaturas{display:flex;gap:1.5rem;flex-wrap:wrap}.temperaturas span{display:grid;font-size:.85rem;color:#dbecde}
.temperaturas b{color:#fff;font-size:clamp(1.75rem,4vw,2.6rem);line-height:1.1;font-variant-numeric:tabular-nums}
.icono-hoy{font-size:clamp(2.5rem,7vw,4.5rem);line-height:1}
.condiciones{grid-column:1/-1;margin:.65rem 0 0;color:#dbecde}
.aviso-zona{margin:1rem 0;border-left:4px solid #98aa9a;padding:.55rem .85rem;background:#f1f4ef}
.aviso-zona p,.aviso-activo p{margin:.25rem 0}.aviso-activo{padding:.7rem .9rem;margin:.5rem 0;border-left:5px solid #ac780a;background:#fff7db}
.aviso-naranja{border-color:#a94a09;background:#fff0df}.aviso-rojo{border-color:#b72e24;background:#fff0ed}
.aviso-zona a,.aviso-activo a{display:inline-block;padding:.25rem 0}
.dias{list-style:none;padding:8px 20px;margin:0;background:var(--eu-surface);border:1px solid var(--rule);border-radius:22px}
.dia{display:grid;grid-template-columns:minmax(8rem,1fr) minmax(8rem,1.45fr) minmax(12rem,1.3fr);gap:.4rem 1rem;align-items:center;padding:.65rem .1rem;border-bottom:1px solid var(--rule)}
.dia .medidas{font-size:.9rem;color:var(--muted)}.dia small{display:block}
.lluvia{display:flex;flex-wrap:wrap;gap:.5rem;list-style:none;padding:0;margin:.7rem 0}.lluvia li{background:#edf3f6;border-radius:8px;padding:.45rem .7rem;font-size:.9rem}
.horas{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.horas th,.horas td{padding:.45rem .6rem;text-align:right;border-bottom:1px solid var(--rule)}.horas th:first-child,.horas td:first-child{text-align:left}.horas thead{background:#edf3ef}.cielo-hora{display:block;color:var(--muted);font-weight:400}
details>summary{cursor:pointer;color:var(--green);font-weight:650;padding:.65rem 0;min-height:44px}.cambio{margin-top:1.5rem}.cambio summary{width:fit-content}
.lista ul{list-style:none;display:flex;flex-wrap:wrap;gap:.4rem;padding:0}.lista a{display:inline-flex;align-items:center;min-height:44px;padding:.4rem .75rem;border:1px solid var(--rule);border-radius:12px;background:white;text-decoration:none}
footer{border-top:1px solid var(--rule);margin-top:2rem;padding:1.15rem;text-align:center;font-size:.88rem}
@media(max-width:600px){.dia{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.dia .medidas{grid-column:1/-1}.horas th,.horas td{padding:.45rem .25rem}.icono-hoy{align-self:start}.hoy{gap:.25rem .4rem}}
`

interface Meta { title: string; desc: string; canonical: string; nonce: string; noindex?: boolean; jsonLd?: string }

function envoltorio(m: Meta, cuerpo: string): string {
  return '<!DOCTYPE html><html lang="es"><head>'
    + '<meta charset="utf-8" />'
    + '<meta name="viewport" content="width=device-width, initial-scale=1" />'
    + '<title>' + esc(m.title) + '</title>'
    + '<meta name="description" content="' + esc(m.desc) + '" />'
    + '<link rel="canonical" href="' + esc(m.canonical) + '" />'
    + (m.noindex ? '<meta name="robots" content="noindex,follow" />' : '<meta name="robots" content="index,follow,max-image-preview:large" />')
    + '<meta name="theme-color" content="#16a34a" />'
    + '<meta property="og:title" content="' + esc(m.title) + '" />'
    + '<meta property="og:description" content="' + esc(m.desc) + '" />'
    + '<meta property="og:type" content="website" />'
    + '<meta property="og:url" content="' + esc(m.canonical) + '" />'
    + ogSocialTags(originFromCanonical(m.canonical))
    + '<link rel="icon" href="/static/favicon-32.png" sizes="32x32" />'
    + (m.jsonLd ? '<script type="application/ld+json" nonce="' + esc(m.nonce) + '">' + m.jsonLd + '</script>' : '')
    + '<style nonce="' + esc(m.nonce) + '">' + CSS + CSS_BUSCADOR_TIEMPO + MASTHEAD_CSS + '</style></head><body>'
    + mastheadHtml('tiempo', { compact: true, hideMunicipioSearch: true }) + '<main>'
    + cuerpo
    + '</main><footer><a href="/">España Útil</a> · <a href="/privacidad">Privacidad</a></footer>'
    + '</body></html>'
}

function listaLugares(enlaces: Array<{nombre:string; url:string}>, titulo: string) {
  return '<section class="seccion"><h2>' + esc(titulo) + '</h2><nav class="lista" aria-label="' + esc(titulo) + '"><ul>'
    + enlaces.map(l => '<li><a href="' + esc(l.url) + '">' + esc(l.nombre) + '</a></li>').join('') + '</ul></nav></section>'
}

export function buildTiempoIndexPage(nonce: string, provincias: Array<{slug:string; name:string}>, canonical: string) {
  return envoltorio({ nonce, canonical, title: 'El tiempo en España por municipios | España Útil', desc: 'Previsión por días y horas y avisos meteorológicos por municipio.' },
    '<h1>El tiempo en España</h1><p class="sub">Previsión por horas, próximos días y avisos de AEMET.</p>'
    + buscadorTiempo(nonce) + listaLugares(provincias.map(p => ({nombre:p.name, url:'/tiempo/'+p.slug})), 'Provincias'))
}

export function buildTiempoProvinciaPage(nonce: string, d: {provinciaSlug:string; provinciaName:string; municipios:Array<{slug:string; nombre:string}>; canonical:string}) {
  const title = 'El tiempo en ' + d.provinciaName
  return envoltorio({nonce, canonical:d.canonical, title:title+' por municipios | España Útil', desc:'Previsión y avisos por municipio en '+d.provinciaName},
    '<h1>'+esc(title)+'</h1><p class="sub">'+d.municipios.length+' municipios</p>' + buscadorTiempo(nonce)
    + listaLugares(d.municipios.map(m => ({nombre:m.nombre, url:'/tiempo/'+d.provinciaSlug+'/'+m.slug})), 'Municipios'))
}

export function buildTiempoBusquedaPage(nonce:string, q:string, resultados:ResultadoTiempo[], canonical:string) {
  return envoltorio({nonce,canonical,noindex:true,title:'Buscar municipio | El tiempo | España Útil',desc:'Resultados de la búsqueda de municipios.'},
    '<h1>Buscar municipio</h1>'+buscadorTiempo(nonce,q)+resultadosTiempo(q,resultados))
}

function fechaLarga(fecha: string, corta = false) {
  return new Intl.DateTimeFormat('es-ES',{timeZone:'UTC', weekday:corta?'short':'long', day:'numeric', month:corta?'short':'long'}).format(new Date(fecha.slice(0,10)+'T12:00:00Z'))
}

function fechaYHora(iso:string, zona:string) {
  const t = instanteLocal(iso,zona)
  if (!Number.isFinite(t)) return ''
  return new Intl.DateTimeFormat('es-ES',{timeZone:zona,day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(new Date(t))
}

const formatoNumero = new Intl.NumberFormat('es-ES',{maximumFractionDigits:0})
function cantidad(n:number|null, unidad:string) {
  return n != null && Number.isFinite(n) ? formatoNumero.format(n)+unidad : '—'
}

function fuentes(parte: Prediccion | ParteHoras, m: MunicipioLista, oficial: string) {
  const zona = zonaTiempo(m.ine)
  const fecha = fechaYHora(parte.elaborado || parte.consultado || '',zona)
  const esAemet = parte.fuente === 'AEMET'
  const link = esAemet ? oficial : 'https://open-meteo.com/en/docs?latitude='+encodeURIComponent(String(m.lat))+'&longitude='+encodeURIComponent(String(m.lng))
  return '<p class="fuente"><a href="'+esc(link)+'">'+esc(parte.fuente)+'</a>'
    +(fecha?' · '+(parte.elaborado?'Actualizado':'Consultado')+' el '+esc(fecha)+' (hora local)':'')+'</p>'
}

function etiquetaLluvia(fuente:Prediccion['fuente']) {
  return fuente === 'Open-Meteo' ? 'Probabilidad máxima de lluvia por hora' : 'Probabilidad de lluvia'
}

function resumenHoy(dia:DiaPrediccion, parte:Prediccion, m:MunicipioLista, oficial:string) {
  const detalles = []
  if(dia.probLluvia != null) detalles.push(etiquetaLluvia(parte.fuente)+' '+cantidad(dia.probLluvia,' %'))
  if(dia.viento != null) detalles.push('Viento máx. '+cantidad(dia.viento,' km/h'))
  return '<section class="panel hoy" aria-labelledby="hoy"><div><h2 id="hoy">Hoy · '+esc(fechaLarga(dia.fecha))+'</h2>'
    +(dia.cielo?'<p class="cielo">'+esc(dia.cielo)+'</p>':'')
    +'<div class="temperaturas"><span>Máxima <b>'+cantidad(dia.tmax,'°')+'</b></span><span>Mínima <b>'+cantidad(dia.tmin,'°')+'</b></span></div></div>'
    +(dia.cielo?'<span class="icono-hoy" aria-hidden="true">'+emojiCielo(dia.cielo)+'</span>':'')
    +(detalles.length?'<p class="condiciones">'+esc(detalles.join(' · '))+'</p>':'')+'</section>'+fuentes(parte,m,oficial)
}

function avisosZona(a: AvisosTiempo, zona: string, ahora: Date) {
  const enlace = '<a href="'+esc(a.url)+'">Ver avisos oficiales de AEMET</a>'
  const zonaHtml = esc(a.zona || '')
  if (a.estado !== 'verificado') {
    return '<aside class="aviso-zona" aria-label="Avisos meteorológicos"><p><strong>Avisos pendientes de actualizar</strong>'
      +(a.zona ? ' · '+zonaHtml : '')+'</p>'+enlace+'</aside>'
  }
  const consulta = '<p class="aviso-meta">Consultado el '+esc(fechaYHora(a.consultado,zona))+' · '+enlace+'</p>'
  if (!a.avisos.length) {
    return '<aside class="aviso-zona" aria-label="Avisos meteorológicos"><p>Sin avisos publicados para <strong>'
      +zonaHtml+'</strong>.</p>'+consulta+'</aside>'
  }

  const intervalos = new Map<string, { nivel: 'amarillo'|'naranja'|'rojo'; inicio: string; fin: string; fenomenos: Set<string> }>()
  for (const aviso of a.avisos) {
    const clave = [aviso.nivel,aviso.inicio,aviso.fin].join('/')
    const intervalo = intervalos.get(clave) ?? { ...aviso, fenomenos: new Set<string>() }
    intervalo.fenomenos.add(aviso.fenomeno)
    intervalos.set(clave, intervalo)
  }
  const activo = (inicio: string) => Date.parse(inicio) <= ahora.getTime()
  const gravedad = { amarillo: 1, naranja: 2, rojo: 3 }
  const ordenados = [...intervalos.values()].sort((a,b) => {
    const vigencia = Number(activo(b.inicio)) - Number(activo(a.inicio))
    const porNivel = gravedad[b.nivel] - gravedad[a.nivel]
    const porHora = Date.parse(a.inicio) - Date.parse(b.inicio)
    return vigencia || (activo(a.inicio) ? porNivel || porHora : porHora || porNivel)
  })
  const bloques = ordenados.map(v => {
    const etiqueta = activo(v.inicio) ? 'Aviso '+v.nivel+' en vigor' : 'Próximo aviso '+v.nivel
    return '<div class="aviso-activo aviso-'+v.nivel+'"><strong>'+etiqueta+' · '+esc([...v.fenomenos].join(' y '))+'</strong>'
      +'<p>'+zonaHtml+' · Del '+esc(fechaYHora(v.inicio,zona))+' al '+esc(fechaYHora(v.fin,zona))+' (hora local).</p></div>'
  })
  return '<aside aria-label="Avisos meteorológicos">'+bloques[0]
    +(bloques.length > 1 ? '<details><summary>Ver los demás avisos ('+(bloques.length-1)+')</summary>'+bloques.slice(1).join('')+'</details>' : '')
    +consulta+'</aside>'
}

function relojTramo(iso:string, hoy:string) {
  const fecha=iso.slice(0,10)
  return (fecha===hoy?'':fechaLarga(fecha,true)+' · ')+iso.slice(11,16)
}

function tablaHoras(parte:ParteHoras,hoy:string) {
  if(!parte.horas.length) return ''
  const columnas='<thead><tr><th scope="col">Hora local</th><th scope="col">Temperatura</th><th scope="col">Viento</th></tr></thead>'
  const tabla=(horas:ParteHoras['horas'])=>'<table class="horas" aria-label="Previsión por horas">'+columnas+'<tbody>'+horas.map(h=>
    '<tr><th scope="row">'+esc(relojTramo(h.fechaHora,hoy))+(h.cielo?'<small class="cielo-hora">'+esc(h.cielo)+'</small>':'')+'</th><td>'+cantidad(h.temperatura,'°')+'</td><td>'+cantidad(h.viento,' km/h')+'</td></tr>').join('')+'</tbody></table>'
  const horas=parte.horas.slice(0,24)
  return tabla(horas.slice(0,6))+(horas.length>6?'<details><summary>Ver '+(horas.length-6)+' horas más</summary>'+tabla(horas.slice(6))+'</details>':'')
}

function proximasHoras(parte:ParteHoras|null,m:MunicipioLista,hoy:string,oficial:string) {
  const titulo='<section class="seccion"><h2>Próximas horas</h2>'
  if(!parte) return titulo+'<p>La previsión por horas está pendiente de actualizar. <a href="'+esc(oficial)+'">Consultar AEMET</a></p></section>'
  const tramos = parte.lluvia.map(v => {
    const cruzaMedianoche = v.desde.slice(0,10) !== v.hasta.slice(0,10)
    const fin = (cruzaMedianoche ? fechaLarga(v.hasta,true)+' · ' : '')+v.hasta.slice(11,16)
    return '<li>'+esc(relojTramo(v.desde,hoy))+' – '+esc(fin)+' · <strong>'+cantidad(v.probabilidad,' %')+'</strong></li>'
  })
  const lista=(filas:string[])=>'<ul class="lluvia">'+filas.join('')+'</ul>'
  return titulo + '<h3>Probabilidad de lluvia</h3>'
    +(tramos.length ? lista(tramos.slice(0,4))+(tramos.length>4?'<details><summary>Ver más tramos de lluvia</summary>'+lista(tramos.slice(4))+'</details>':'') : '<p>Sin porcentaje publicado para estas horas.</p>')
    +tablaHoras(parte,hoy)+fuentes(parte,m,oficial)+'</section>'
}

function semana(dias:DiaPrediccion[],fuente:Prediccion['fuente']) {
  if(!dias.length) return ''
  return '<section class="seccion"><h2>Próximos días</h2><ul class="dias">'+dias.map(d=>'<li class="dia"><strong>'+esc(fechaLarga(d.fecha,true))+'</strong>'
    +'<span>'+esc(d.cielo)+'</span><div class="medidas">Máx. '+cantidad(d.tmax,'°')+' · Mín. '+cantidad(d.tmin,'°')
    +(d.probLluvia!=null?'<small>'+etiquetaLluvia(fuente)+' '+cantidad(d.probLluvia,' %')+'</small>':'')
    +(d.viento!=null?'<small>Viento máx. '+cantidad(d.viento,' km/h')+'</small>':'')+'</div></li>').join('')+'</ul></section>'
}

export function buildTiempoMunicipioPage(nonce:string, d:{municipio:MunicipioLista;pred:Prediccion|null;horas:ParteHoras|null;avisos:AvisosTiempo;canonical:string;ahora?:Date}) {
  const {municipio:m,pred,horas,avisos,canonical}=d
  const zona=zonaTiempo(m.ine)
  const ahora = d.ahora ?? new Date()
  const hoy = fechaHoraLocal(ahora,zona).slice(0,10)
  const dia=pred?.dias.find(v=>v.fecha.slice(0,10)===hoy)
  const tieneAemet = pred?.fuente === 'AEMET' || horas?.fuente === 'AEMET'
  const oficial = urlMunicipioAemet(pred?.urlMunicipio,m.ine) ?? urlMunicipioAemet(horas?.urlMunicipio,m.ine)
    ?? (tieneAemet ? AEMET_MUNICIPIOS+m.slug+'-id'+m.ine : AEMET_MUNICIPIOS)
  const oficialHoras = oficial === AEMET_MUNICIPIOS ? oficial : oficial.replace(AEMET_MUNICIPIOS,AEMET_MUNICIPIOS+'horas/')
  const title='El tiempo en '+m.nombre
  const origin=originFromCanonical(canonical)
  const jsonLd=breadcrumbLd([{name:'Inicio',url:origin+'/'},{name:'El tiempo',url:origin+'/tiempo/'},{name:m.provinciaNombre,url:origin+'/tiempo/'+m.provinciaSlug},{name:m.nombre,url:canonical}])
  return envoltorio({nonce,canonical,noindex:!pred&&!horas,title:title+' ('+m.provinciaNombre+') | España Útil',desc:'Previsión y avisos meteorológicos en '+m.nombre+' ('+m.provinciaNombre+').', jsonLd},
    '<h1>'+esc(title)+'</h1><p class="sub">'+esc(m.provinciaNombre)+' · Hora local '+(zona==='Atlantic/Canary'?'canaria':'peninsular')+'</p>'
    +(avisos.avisos.length?avisosZona(avisos,zona,ahora):'')
    +(dia&&pred?resumenHoy(dia,pred,m,oficial):'<section class="panel"><h2>Hoy · '+esc(fechaLarga(hoy))+'</h2><p>Previsión pendiente de actualizar. <a href="'+esc(oficial)+'">Consultar el parte oficial</a></p></section>')
    +(!avisos.avisos.length?avisosZona(avisos,zona,ahora):'')
    +proximasHoras(horas,m,hoy,oficialHoras)
    +(pred ? semana(pred.dias.filter(v=>v.fecha.slice(0,10)>hoy),pred.fuente) : '')
    +(pred && !dia ? fuentes(pred,m,oficial) : '')
    +'<details class="cambio"><summary>Cambiar de municipio</summary>'+buscadorTiempo(nonce)+'</details>'
    +'<a href="/tiempo/'+esc(m.provinciaSlug)+'">Ver municipios de '+esc(m.provinciaNombre)+'</a>')
}

// Headers de /tiempo/*. CSP estricta: sin mapa ni CDNs; solo la llamada a
// /api/tiempo/municipios (mismo origen -> connect-src 'self').
export function tiempoHeaders(nonce: string): Record<string, string> {
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
    'Cache-Control': 'no-cache',
  })
}
