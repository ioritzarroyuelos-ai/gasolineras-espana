// Helpers de salida segura compartidos por los builders SSR.
//
// Separamos DOS problemas distintos:
//  - escapeHtml: para incrustar texto en HTML (contenido o atributos con "").
//  - jsonLdSafe / jsonLdScript: para incrustar JSON dentro de un <script>
//    (JSON-LD o config). JSON.stringify NO neutraliza "</script>": un dato con
//    "<" (o "</script>") romperia el documento e inyectaria HTML. Sustituimos
//    "<" por < (JSON sigue siendo valido). NO se aplica escape HTML al JSON.
//
// Motivacion: datos de terceros (p.ej. rotulos/municipios del dataset del
// Ministerio) llegaban a <script type="application/ld+json"> y a
// window.__SEO__ vía JSON.stringify crudo -> inyeccion de HTML reproducible.

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escapa texto para incrustarlo en HTML (contenido o atributos con comillas dobles). */
export function escapeHtml(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, ch => HTML_ESCAPES[ch])
}

/** Serializa a JSON seguro para incrustar dentro de <script>: neutraliza "<"
 *  (y por tanto "</script>") como <. El resultado sigue siendo JSON valido. */
export function jsonLdSafe(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

/** Bloque <script type="application/ld+json"> con el objeto ya blindado. */
export function jsonLdScript(value: unknown, nonce: string): string {
  return '<script type="application/ld+json" nonce="' + nonce + '">' + jsonLdSafe(value) + '</script>'
}
