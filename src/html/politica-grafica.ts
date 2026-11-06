import type { EleccionFile, Sondeo } from '../lib/politica-schemas'
import { diaDeCampo } from '../lib/politica'
import { esc, fmtFecha } from './politica-formato'

export const POLITICA_GRAFICA_CSS = `
.ev-chart{margin:24px 0;padding:16px;border:1px solid var(--bd);border-radius:14px;background:#fff}
.ev-chart h2{margin:0 0 4px;border:0;padding:0}
.ev-chart p{margin:0 0 12px;font-size:14px}
.ev-unidad,.ev-fechas,.ev-leyenda{font-size:13px;color:#475569}
.ev-unidad{font-weight:600}
.ev-plot{display:grid;grid-template-columns:32px minmax(0,1fr);margin-right:6px}
.ev-eje,.evsvg{display:block;height:200px;overflow:visible}
.ev-eje{width:32px;fill:#475569;font:12px system-ui}
.evsvg{width:100%;cursor:crosshair}
.ev-grid{stroke:#dce1e6}
.ev-mayoria{stroke:#536471;stroke-width:1.2;stroke-dasharray:5 4}
.evsvg polyline{fill:none;stroke-width:1.4;opacity:.65;vector-effect:non-scaling-stroke}
.evsvg circle{stroke:#374151;stroke-width:.8}
.ev-foco{fill:none;stroke:#17212b;stroke-width:2;pointer-events:none}
.ev-fechas{display:flex;justify-content:space-between;gap:8px;margin-left:32px}
.ev-leyenda{display:flex;flex-wrap:wrap;align-items:center;gap:4px 14px;margin:12px 0 0;padding:0;list-style:none}
.ev-leyenda li{display:inline-flex;gap:5px;align-items:center}
.ev-leyenda i{width:9px;height:9px;border:1px solid #59636d;border-radius:50%}
.ev-leyenda .ev-raya{height:0;width:20px;border:0;border-top:2px dashed #536471;border-radius:0}
.ev-chart [hidden]{display:none}
.ev-explorar{margin-top:12px;padding-top:10px;border-top:1px solid var(--bd)}
.ev-chart .ev-lectura{display:block;margin:0;font-size:14px;font-weight:600}
.ev-mandos{display:flex;gap:8px;align-items:center}
.ev-mandos button{min-width:44px;min-height:44px;border:1px solid var(--bd);border-radius:8px;background:white;color:var(--ink);font:inherit;cursor:pointer}
.ev-mandos button[aria-disabled=true]{color:#59636d;background:#f4f5f6;cursor:default}
.ev-control{flex:1;min-width:0;min-height:44px;accent-color:var(--vd)}
.ev-mandos :focus-visible{outline:2px solid var(--vd);outline-offset:2px}
@media(max-width:500px){.ev-chart{padding:12px}.ev-leyenda{gap:4px 10px}}
`

type Partido = { siglas: string; color: string }
type Punto = { fecha: number; bajo: number; alto: number; detalle: string }

// Las coordenadas horizontales en % permiten mantener texto y puntos en
// píxeles de tamaño legible tanto en teléfonos como en pantallas anchas.
const ALTO = 200
const MARGEN_Y = 9
const JS = `
(function () {
  const grafica = document.currentScript.closest('.ev-chart');
  const svg = grafica.querySelector('.evsvg');
  const control = grafica.querySelector('.ev-control');
  const anterior = grafica.querySelector('.ev-anterior');
  const siguiente = grafica.querySelector('.ev-siguiente');
  const lectura = grafica.querySelector('.ev-lectura');
  const foco = svg.querySelector('.ev-foco');
  const puntos = Array.from(svg.querySelectorAll('circle')).map(function (el) {
    return { el: el, x: parseFloat(el.getAttribute('cx')) / 100, y: Number(el.getAttribute('cy')) };
  }).sort(function (a, b) { return a.x - b.x; });
  let actual = -1;
  function consulta(i) {
    if (i === actual) return;
    actual = i;
    const punto = puntos[i].el;
    const detalle = punto.querySelector('title').textContent;
    lectura.textContent = detalle;
    control.value = String(i);
    control.setAttribute('aria-valuetext', detalle);
    anterior.setAttribute('aria-disabled', String(i === 0));
    siguiente.setAttribute('aria-disabled', String(i === puntos.length - 1));
    foco.setAttribute('cx', punto.getAttribute('cx'));
    foco.setAttribute('cy', punto.getAttribute('cy'));
    foco.removeAttribute('hidden');
  }
  function apunta(e) {
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    let indice = -1, menor = 24 * 24;
    puntos.forEach(function (p, i) {
      const distancia = (p.x * rect.width - x) ** 2 + (p.y - y) ** 2;
      if (distancia <= menor) { menor = distancia; indice = i; }
    });
    if (indice >= 0) consulta(indice);
  }
  let pulsacion = null;
  svg.addEventListener('pointerdown', function (e) {
    pulsacion = e.isPrimary && e.button === 0 ? { id: e.pointerId, x: e.clientX, y: e.clientY } : null;
  });
  svg.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') apunta(e);
    if (pulsacion && e.pointerId === pulsacion.id && Math.hypot(e.clientX - pulsacion.x, e.clientY - pulsacion.y) > 8) pulsacion = null;
  });
  svg.addEventListener('pointerup', function (e) {
    // El click sintetizado tras un toque puede moverse hasta un elemento vecino.
    if (pulsacion && e.pointerId === pulsacion.id && Math.hypot(e.clientX - pulsacion.x, e.clientY - pulsacion.y) <= 8) apunta(e);
    pulsacion = null;
  });
  svg.addEventListener('pointercancel', function () { pulsacion = null; });
  control.addEventListener('input', function () { consulta(Number(control.value)); });
  anterior.addEventListener('click', function () { if (actual > 0) consulta(actual - 1); });
  siguiente.addEventListener('click', function () { if (actual < puntos.length - 1) consulta(actual + 1); });
  control.max = String(puntos.length - 1);
  consulta(puntos.findIndex(function (p) { return p.x === puntos[puntos.length - 1].x; }));
  grafica.querySelector('.ev-explorar').hidden = false;
})();
`

export function renderGrafica(file: EleccionFile, muestra: Sondeo[], topIds: string[], colores: ReadonlyMap<string, Partido>, nonce: string): string {
  const porPartido = new Map(topIds.map(id => [id, [] as Punto[]]))
  for (const sondeo of muestra) {
    const fecha = diaDeCampo(sondeo.campoFin)
    if (fecha == null) continue
    const inicio = diaDeCampo(sondeo.campoInicio)
    const fin = fmtFecha(sondeo.campoFin)
    const periodo = inicio != null && inicio < fecha
      ? 'Del ' + fmtFecha(sondeo.campoInicio) + ' al ' + fin
      : 'Fin del trabajo de campo el ' + fin
    const empresa = sondeo.empresa + (sondeo.comitente ? ' para ' + sondeo.comitente : '')
    for (const dato of sondeo.datos) {
      const puntos = porPartido.get(dato.candidaturaId)
      const info = colores.get(dato.candidaturaId)
      if (!puntos || !info || dato.escanos == null) continue
      const bajo = typeof dato.escanos === 'number' ? dato.escanos : dato.escanos.min
      const alto = typeof dato.escanos === 'number' ? dato.escanos : dato.escanos.max
      const estimacion = bajo === alto ? String(bajo) : bajo + '–' + alto
      const porcentaje = dato.pct == null ? '' : ' · ' + String(dato.pct).replace('.', ',') + ' %'
      puntos.push({ fecha, bajo, alto, detalle: info.siglas + ' · ' + estimacion + (bajo === 1 && alto === 1 ? ' escaño' : ' escaños') + porcentaje + ' · ' + empresa + ' · ' + periodo })
    }
  }
  const series = [...porPartido].filter(([, puntos]) => puntos.length)
  if (!series.some(([, puntos]) => puntos.some(p => p.fecha !== puntos[0].fecha))) return ''
  const todos = series.flatMap(([, puntos]) => puntos)
  const fechas = todos.map(p => p.fecha)
  const primera = Math.min(...fechas), ultima = Math.max(...fechas)
  const mayoria = file.tipo === 'europeas' ? undefined : file.camara.mayoria
  const maximo = Math.max(mayoria ?? 0, ...todos.map(p => p.alto))
  const multiplo = maximo > 20 ? 5 : 1
  const paso = Math.max(1, Math.ceil(maximo / (4 * multiplo)) * multiplo)
  const x = (fecha: number) => ((fecha - primera) * 100 / (ultima - primera)).toFixed(2)
  const y = (valor: number) => (ALTO - MARGEN_Y - valor / (paso * 4) * (ALTO - 2 * MARGEN_Y)).toFixed(1)
  let eje = '', lineas = ''
  for (let i = 0; i <= 4; i++) {
    const valor = i * paso
    eje += '<text x="27" y="' + y(valor) + '" dy=".35em" text-anchor="end">' + valor + '</text>'
    lineas += '<line class="ev-grid" y1="' + y(valor) + '" x2="100%" y2="' + y(valor) + '"/>'
  }
  if (mayoria != null) lineas += '<line class="ev-mayoria" y1="' + y(mayoria) + '" x2="100%" y2="' + y(mayoria) + '"/>'
  let circulos = '', leyenda = ''
  for (const [id, puntos] of series) {
    const info = colores.get(id)!
    const color = esc(info.color)
    puntos.sort((a, b) => a.fecha - b.fecha)
    const medio = (p: Punto) => y((p.bajo + p.alto) / 2)
    if (puntos.length > 1) {
      // El SVG interior escala solo las líneas; los círculos conservan su forma.
      lineas += '<svg width="100%" height="' + ALTO + '" viewBox="0 0 100 ' + ALTO + '" preserveAspectRatio="none"><polyline stroke="' + color + '" points="'
        + puntos.map(p => x(p.fecha) + ',' + medio(p)).join(' ') + '"/></svg>'
    }
    circulos += '<g fill="' + color + '">'
    for (const p of puntos) {
      circulos += '<circle cx="' + x(p.fecha) + '%" cy="' + medio(p) + '" r="3.5"><title>' + esc(p.detalle) + '</title></circle>'
    }
    circulos += '</g>'
    leyenda += '<li><i class="sw-' + esc(id) + '"></i>' + esc(info.siglas) + '</li>'
  }

  const fechaEje = (fecha: number) => fmtFecha(new Date(fecha).toISOString().slice(0, 10))
  const hayHorquillas = todos.some(p => p.bajo !== p.alto)
  return '<section class="ev-chart" aria-labelledby="ev-titulo"><h2 id="ev-titulo">Evolución de los sondeos</h2>'
    + '<p>Las líneas unen las estimaciones de cada partido por fecha de fin de las entrevistas.'
    + (hayHorquillas ? ' Si la encuesta da una horquilla, el punto marca su centro.' : '') + '</p>'
    + '<div class="ev-unidad">Escaños estimados</div><div class="ev-plot">'
    + '<svg class="ev-eje" aria-hidden="true">' + eje + '</svg>'
    + '<svg class="evsvg" role="img" aria-label="Estimaciones por partido según la fecha del sondeo">'
    + lineas + circulos + '<ellipse class="ev-foco" rx="7" ry="7" hidden="hidden"/></svg></div>'
    + '<div class="ev-fechas"><span>' + fechaEje(primera) + '</span><span>' + fechaEje(ultima) + '</span></div>'
    + '<ul class="ev-leyenda" aria-label="Leyenda del gráfico">' + leyenda
    + (mayoria != null ? '<li><i class="ev-raya"></i>Mayoría de ' + mayoria + ' escaños</li>' : '') + '</ul>'
    + '<div class="ev-explorar" hidden><p>Toca un punto o usa las flechas para consultar su encuesta.</p>'
    + '<div class="ev-mandos"><button class="ev-anterior" type="button" aria-label="Punto anterior">←</button>'
    + '<input class="ev-control" type="range" min="0" step="1" aria-label="Punto del gráfico">'
    + '<button class="ev-siguiente" type="button" aria-label="Punto siguiente">→</button></div>'
    + '<output class="ev-lectura" aria-live="polite"></output></div>'
    + '<script nonce="' + esc(nonce) + '">' + JS + '</script></section>'
}
