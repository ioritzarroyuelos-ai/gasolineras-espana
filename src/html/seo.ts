// Helpers SEO compartidos por las verticales SSR (tiempo, ITV, farmacias, ...).
//
// - ogSocialTags: bloque de imagen de vista previa al compartir (Open Graph +
//   Twitter). Apunta a /static/og.png (1200x630, que SÍ existe). Antes varias
//   verticales no ponían imagen y la portada/farmacias apuntaban a un archivo
//   inexistente (404) -> tarjeta sin foto al compartir en WhatsApp/Twitter.
// - breadcrumbLd: "migas de pan" en formato JSON-LD (BreadcrumbList). Es el
//   rich result más frecuente y barato: Google puede pintar la ruta
//   Inicio > Sección > Provincia > Municipio bajo el título en los resultados.

const OG_IMG_ALT = 'CercaYa · info útil de España al instante'

/** Bloque Open Graph + Twitter de imagen social. `origin` = "https://host". */
export function ogSocialTags(origin: string): string {
  const img = origin + '/static/og.png'
  return '<meta property="og:site_name" content="CercaYa" />'
    + '<meta property="og:locale" content="es_ES" />'
    + '<meta property="og:image" content="' + img + '" />'
    + '<meta property="og:image:width" content="1200" />'
    + '<meta property="og:image:height" content="630" />'
    + '<meta property="og:image:alt" content="' + OG_IMG_ALT + '" />'
    + '<meta name="twitter:card" content="summary_large_image" />'
    + '<meta name="twitter:image" content="' + img + '" />'
}

/** Deriva el origin (esquema + host) a partir de una URL canónica completa. */
export function originFromCanonical(canonical: string): string {
  const parts = canonical.split('/')
  return parts.length >= 3 && parts[0] && parts[2] ? parts[0] + '//' + parts[2] : ''
}

/**
 * JSON-LD BreadcrumbList a partir de una lista de migas con URL completa.
 * Devuelve '' si hay menos de 2 (una miga sola no es una ruta). El resultado
 * va dentro de <script type="application/ld+json">...</script>.
 */
export function breadcrumbLd(crumbs: Array<{ name: string; url: string }>): string {
  if (crumbs.length < 2) return ''
  // \\u003c: escapa '<' para que un nombre con '<' no pueda cerrar el <script>
  // (mismo blindaje que observatorio.ts / guardia-municipio.ts).
  return JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({
      '@type': 'ListItem', position: i + 1, name: c.name, item: c.url,
    })),
  }).replace(/</g, '\\u003c')
}
