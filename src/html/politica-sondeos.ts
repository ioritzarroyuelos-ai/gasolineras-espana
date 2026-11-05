import { comparaEscanos, diaDeCampo, enlazaSondeosAnteriores } from '../lib/politica'
import type { EleccionFile, EscanosEstim, Sondeo, SondeoDato } from '../lib/politica-schemas'
import { esc, fmtFecha } from './politica-formato'

export type ReferenciaSondeo = 'anterior' | 'elecciones'

export const SONDEOS_CSS = [
  '.pm-table-intro h3{font-size:20px;margin:16px 0 2px}.pm-table-intro p{margin:0;color:#4b584f;font-size:14px}',
  '.pm-table{max-width:100%;max-height:min(65vh,36rem);overflow:auto;scrollbar-gutter:stable;border:1px solid var(--bd);border-radius:8px;margin:8px 0 22px}',
  '.pm-table table{border-collapse:separate;border-spacing:0;width:100%;font-size:14px;font-variant-numeric:tabular-nums}',
  '.pm-table th,.pm-table td{padding:8px 10px;text-align:left;vertical-align:top;border-bottom:1px solid var(--bd)}',
  '.pm-table thead th{position:sticky;top:0;z-index:2;background:var(--paper);white-space:nowrap}.pm-table tbody th{font-weight:400}',
  '.pm-table tr>:first-child{position:sticky;left:0;z-index:1;background:#fff;min-width:11rem;max-width:14rem;border-right:1px solid var(--bd)}',
  '.pm-table thead tr>:first-child{z-index:3;background:var(--paper)}.pm-table a{color:var(--vd)}',
  '.pm-table td{white-space:nowrap}.pm-table small,.pm-poll small{display:block;font-size:13px;line-height:1.4;color:#4b584f}',
  '.pm-table td small{white-space:normal;min-width:6.2em}.pm-table:focus-visible,.pm-poll summary:focus-visible,.pm-table a:focus-visible{outline:2px solid var(--vd);outline-offset:2px}',
  '.pm-poll{background:#fff;color:var(--ink);border:1px solid #d7ddcf;border-radius:9px;margin:10px 0;overflow-wrap:anywhere}',
  '.pm-poll summary{display:list-item;cursor:pointer;min-height:46px;padding:12px 14px;color:var(--vd);font-weight:650;line-height:1.45}',
  '.pm-poll summary small{padding:3px 0 0 16px;font-weight:400}.pm-inner{padding:0 9px 9px;scroll-margin-top:14px}',
  '.pm-inner:focus-visible{outline:2px solid var(--vd);outline-offset:-2px}.pm-ref{margin:0 5px 9px;font-size:13px;color:#4b584f}',
  '.pm-rows{margin:0;padding:0;list-style:none}.pm-rows li{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2px 8px;padding:8px 5px;border-top:1px solid #d7ddcf;align-items:baseline;font-variant-numeric:tabular-nums}',
  '.pm-rows b{font-weight:650}.pm-rows strong,.pm-rows span{text-align:right}.pm-rows strong{font-size:16px;font-weight:550}.pm-rows span{font-size:13px}.pm-rows b small{font-weight:400}',
  '.pm-extra>summary{padding:11px 5px;min-height:44px;font-size:14px}.pm-details-title{font-size:20px;margin:20px 0 8px}',
  '@media(max-width:700px){.pm-table,.pm-table-intro,.pm-details-title{display:none}}',
].join('')

const larga = new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'UTC' })
const numero = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 3 })

function fechaCampo(s: Sondeo): string {
  const fin = diaDeCampo(s.campoFin)
  if (fin == null) return s.fechaTexto ? esc(s.fechaTexto) : 'Fecha de campo sin publicar'
  const inicio = diaDeCampo(s.campoInicio)
  if (inicio == null || inicio > fin) return 'Hasta el ' + larga.format(fin)
  return inicio === fin ? larga.format(fin) : larga.formatRange(inicio, fin)
}

function escanos(v: EscanosEstim | undefined): string {
  if (v == null) return 'Sin dato'
  return typeof v === 'number' ? String(v) : v.min + '–' + v.max
}

interface FilaPartido {
  siglas: string
  actual: EscanosEstim | undefined
  pct: number | null | undefined
  base: EscanosEstim | undefined
  cambio: ReturnType<typeof comparaEscanos>
}

function filaFicha(fila: FilaPartido, prefijo: string, hayReferencia: boolean): string {
  const { actual, base, cambio } = fila
  const votos = fila.pct == null ? '' : '<small>' + numero.format(fila.pct) + ' % del voto</small>'
  const estimacion = actual == null ? 'Sin dato de escaños' : escanos(actual) + (actual === 1 ? ' escaño' : ' escaños')
  let html = '<li><b>' + esc(fila.siglas) + votos + '</b><strong>' + estimacion + '</strong>'
  if (hayReferencia) {
    html += '<small>' + (base == null ? 'Sin dato de referencia' : prefijo + ' · ' + escanos(base)) + '</small>'
    if (actual != null && base != null) html += '<span>' + esc(cambio.texto) + '</span>'
  }
  return html + '</li>'
}

function referenciaFicha(sondeo: Sondeo, anterior: Sondeo | undefined, file: EleccionFile, modo: ReferenciaSondeo): string {
  if (modo === 'elecciones') {
    return file.referencia.escanos.length ? 'Referencia · Elecciones del ' + fmtFecha(file.referencia.fecha) : 'Sin resultado electoral de referencia.'
  }
  if (anterior) return 'Referencia · ' + esc(anterior.empresa) + ' · ' + fmtFecha(anterior.campoFin)
  if (!sondeo.comitente?.replace(/\p{Cf}/gu, '').trim()) return 'Sin encuesta anterior comparable. No consta quién encargó el sondeo.'
  return 'Sin encuesta anterior comparable de la misma casa para quien encargó este sondeo.'
}

export function renderSondeos(file: EleccionFile, muestra: readonly Sondeo[], referencia: ReferenciaSondeo = 'anterior'): string {
  if (!muestra.length) return ''
  const elecciones = new Map(file.referencia.escanos.map(r => [r.candidaturaId, r.escanos]))
  const anteriores = referencia === 'anterior' ? enlazaSondeosAnteriores(file.sondeos) : undefined
  const nombres = new Map(file.candidaturas.map(c => [c.id, c.siglas]))

  // Un orden común permite seguir una columna en todas las encuestas. Si falta
  // el escrutinio, las tres primeras se eligen por los escaños publicados aquí.
  const representacion = new Map<string, number>()
  for (const s of muestra) {
    for (const d of s.datos) {
      const max = typeof d.escanos === 'number' ? d.escanos : d.escanos?.max
      representacion.set(d.candidaturaId, Math.max(representacion.get(d.candidaturaId) ?? -1, max ?? -1))
    }
  }
  const ids = new Set([...elecciones.keys(), ...representacion.keys()])
  for (const s of muestra) for (const d of anteriores?.get(s)?.datos ?? []) ids.add(d.candidaturaId)
  const orden = [...ids].sort((a, b) => (elecciones.get(b) ?? 0) - (elecciones.get(a) ?? 0)
    || (representacion.get(b) ?? -1) - (representacion.get(a) ?? -1))

  let tabla = '<div class="pm-table-intro"><h3>Escaños estimados por encuesta</h3><p>Selecciona el nombre de una encuesta para ver sus cifras de referencia.</p></div>'
    + '<div class="pm-table" role="region" aria-label="Comparar los escaños por encuesta y partido" tabindex="0"><table class="s" aria-label="Escaños por encuesta y partido"><thead><tr><th scope="col">Encuesta</th>'
    + orden.map(id => '<th scope="col">' + esc(nombres.get(id) || id) + '</th>').join('') + '</tr></thead><tbody>'
  let fichas = '<h3 class="pm-details-title">Detalle de cada encuesta</h3>'
  for (const [i, sondeo] of muestra.entries()) {
    const anterior = anteriores?.get(sondeo)
    const previos = referencia === 'elecciones' ? elecciones : new Map(anterior?.datos.map(d => [d.candidaturaId, d.escanos]))
    const datos = new Map<string, SondeoDato>(sondeo.datos.map(d => [d.candidaturaId, d]))
    const titulo = esc(sondeo.empresa) + (sondeo.comitente ? ' · ' + esc(sondeo.comitente) : '')
    const fecha = fechaCampo(sondeo)
    const ancla = 'sondeo-' + (i + 1)
    tabla += '<tr><th scope="row"><a class="empn" href="#' + ancla + '">' + titulo + '</a><small>' + (sondeo.campoFin ? fmtFecha(sondeo.campoFin) : fecha) + '</small></th>'
    const filas: string[] = []
    for (const id of orden) {
      const dato = datos.get(id)
      const base = previos.get(id)
      if (!dato && !previos.has(id) && !elecciones.has(id)) {
        tabla += '<td>Sin dato</td>'
        continue
      }
      const actual = dato?.escanos
      const cambio = comparaEscanos(actual, base)
      const cifraTabla = actual == null && dato?.pct != null ? 'Solo voto · ' + numero.format(dato.pct) + ' %' : escanos(actual)
      tabla += '<td>' + cifraTabla + (actual != null && base != null ? '<small>' + esc(cambio.texto) + '</small>' : '') + '</td>'
      filas.push(filaFicha({ siglas: nombres.get(id) || id, actual, pct: dato?.pct, base, cambio },
        referencia === 'elecciones' ? 'Elecciones' : 'Encuesta anterior', previos.size > 0))
    }
    tabla += '</tr>'
    fichas += '<details class="pm-poll"' + (i === 0 ? ' open' : '') + '><summary>' + titulo + '<small>' + fecha + '</small></summary>'
      + '<div class="pm-inner" id="' + ancla + '" tabindex="-1"><p class="pm-ref">' + referenciaFicha(sondeo, anterior, file, referencia) + '</p>'
      + '<ul class="pm-rows">' + filas.slice(0, 3).join('') + '</ul>'
      + (filas.length > 3 ? '<details class="pm-extra"><summary>Ver los demás partidos</summary><ul class="pm-rows">' + filas.slice(3).join('') + '</ul></details>' : '')
      + '</div></details>'
  }
  return tabla + '</tbody></table></div>' + fichas
}
