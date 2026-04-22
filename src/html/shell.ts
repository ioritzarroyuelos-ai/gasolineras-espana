import { getStyles } from './styles'
import { getClientScript } from './client'
import { APP_VERSION } from '../lib/version'

export interface SeoContext {
  // Contexto SEO por ruta (provincia/municipio). Si falta, page genera la
  // version generica /. Si viene, sobreescribe title/description/canonical y
  // expone window.__SEO__ en el cliente para que autoseleccione el dropdown.
  provinciaId?: string
  provinciaSlug?: string
  provinciaName?: string
  // Nivel municipio: solo poblado en rutas /gasolineras/<prov>/<mun>. Cuando
  // viene, sobreescribe title/description/canonical/breadcrumbs al nivel mas
  // fino. El cliente tambien autoseleccciona el <select> de municipio si
  // municipioId esta presente.
  municipioId?: string
  municipioSlug?: string
  municipioName?: string
  // Estadisticas de precios pre-computadas server-side. Si vienen, las usamos
  // para enriquecer meta description + JSON-LD Dataset + una seccion visible
  // al final del body (clave para ranking: el snapshot del crawler tiene
  // texto relevante con el nombre de la provincia y el rango de precios).
  // Cuando municipio esta presente, stats son del municipio (no de la
  // provincia), para que toda la pagina hable del mismo ambito geografico.
  // Keys: codigo de combustible ('95','98','diesel','diesel_plus').
  stats?: Record<string, { min: number; avg: number; max: number; count: number }>
  stationCount?: number
  // Ship 17: top-N estaciones baratas precomputadas server-side. Se emiten
  // como ItemList de GasStation en JSON-LD para rich results tipo carrusel en
  // Google. Solo se rellena en provincia/municipio (en / no tiene sentido una
  // lista de "top 10 estaciones de toda España"). El fuelCode se inyecta en
  // el Offer para que Google entienda que precio es.
  topStations?: Array<{
    id: string
    name: string
    address: string
    postalCode?: string
    municipio: string
    provincia: string
    lat: number
    lon: number
    price: number
    fuelCode: string
  }>
}

export interface BuildPageOpts {
  // Site key publica de Cloudflare Turnstile. Si esta presente, inyectamos el
  // widget (invisible) para /api/ingest. En dev (sin claves) se omite.
  turnstileSiteKey?: string
  // Contexto SEO (rutas /gasolineras/<slug>).
  seo?: SeoContext
  // Top municipios a enlazar desde la pagina provincial (internal linking).
  // Solo aplica cuando seo.provinciaName esta presente y municipioName NO.
  // Shape compatible con MunicipioEntry de ./lib/municipios.
  municipios?: Array<{ slug: string; name: string; stationCount: number }>
  // Ship 15: fecha del snapshot del Ministerio (string tal cual llega,
  // formato "DD/MM/YYYY HH:mm:SS"). Se expone en window.__SNAP_AT__ para que
  // el cliente pinte un badge "Precios de hace Xm" cuando el snapshot tiene
  // > 30 min. Cuando es nula, no se pinta el badge.
  snapshotDate?: string
  // Ship 25.2: URL de donacion/propina ("Invitame a un cafe"). Viene de la
  // env var SUPPORT_URL en CF Pages. Si no esta definida, el boton se omite
  // del render — asi el dev no tiene que editar codigo para activarlo/
  // desactivarlo o cambiar de plataforma (Ko-fi, Buy Me a Coffee, PayPal.me,
  // GitHub Sponsors, etc). El render valida que sea http(s) para evitar XSS
  // por injection de javascript: URIs.
  supportUrl?: string
}

export function buildPage(
  nonce: string = '',
  reqUrl: string = 'https://gasolineras.pages.dev/',
  opts: BuildPageOpts = {},
): string {
  // Base URL (origen) para meta tags canonicos / OG. En Workers reqUrl llega como absoluto.
  let origin = 'https://gasolineras.pages.dev'
  try { origin = new URL(reqUrl).origin } catch { /* fallback */ }
  const seo = opts.seo
  // Pathname progresivo: / → /gasolineras/<prov> → /gasolineras/<prov>/<mun>.
  // La URL canonica siempre refleja el nivel mas fino disponible.
  let pathname = '/'
  if (seo?.provinciaSlug) pathname = '/gasolineras/' + seo.provinciaSlug
  if (seo?.provinciaSlug && seo?.municipioSlug) pathname = '/gasolineras/' + seo.provinciaSlug + '/' + seo.municipioSlug
  const canonical = origin + pathname
  // Geo-label: el ambito textual mas fino que mostrar al usuario ("Madrid",
  // "Alcalá de Henares, Madrid", etc). Se reutiliza en title/description.
  const geoLabel = seo?.municipioName && seo?.provinciaName
    ? (seo.municipioName + ', ' + seo.provinciaName)
    : (seo?.provinciaName || '')
  const pageTitle = geoLabel
    ? 'Gasolineras en ' + geoLabel + ' · Precios oficiales'
    : 'Gasolineras España · Precios oficiales en tiempo real'
  // Description enriquecida cuando hay stats: incluye precio min-max de 95 y
  // numero de estaciones — mejora CTR en SERP y le da a Google material
  // ranqueable ("precio gasolina madrid" matchea directamente).
  const stats95 = seo?.stats?.['95']
  const pageDesc = geoLabel
    ? (stats95 && stats95.count >= 3
        ? 'Precios actualizados de gasolina y diésel en ' + geoLabel +
          '. Gasolina 95 desde ' + stats95.min.toFixed(3) + '€ hasta ' + stats95.max.toFixed(3) + '€ (media ' + stats95.avg.toFixed(3) + '€). ' +
          (seo?.stationCount ? seo.stationCount + ' estaciones. ' : '') +
          'Mapa interactivo y datos oficiales del Ministerio.'
        : 'Precios actualizados de gasolina y diésel en ' + geoLabel + '. Mapa interactivo, comparador y favoritos con datos oficiales del Ministerio.'
      )
    : 'Precios oficiales de gasolineras en España en tiempo real. Mapa, comparador de ahorro, favoritos y modo offline. Datos del Ministerio para la Transición Ecológica.'
  const ogTitle = geoLabel
    ? 'Gasolineras en ' + geoLabel + ' · Precios oficiales'
    : 'Gasolineras España · Precios en tiempo real'
  const ogDesc = geoLabel
    ? 'Mapa de precios de combustible en ' + geoLabel + ', actualizados a diario. Datos oficiales.'
    : 'Encuentra la gasolinera más barata cerca de ti. Datos oficiales del Ministerio, actualizados a diario.'
  // Los crawlers de Twitter/Facebook/LinkedIn no renderizan SVG en previews: usamos PNG 1200x630.
  const ogImage   = origin + '/static/og.png'
  const logoUrl   = origin + '/static/logo.svg'

  // Turnstile: solo inyectamos si hay site key. El widget se carga en modo
  // invisible — auto-ejecuta en pageload y el resultado llega por callback
  // (window.__onTsOk / window.__onTsExpired). Guardamos el token en
  // window.__TS_TOKEN__ para que la telemetria de /api/ingest lo adjunte.
  // El script se carga async con nonce (coincide con la CSP).
  const tsKey = opts.turnstileSiteKey
  const turnstileScripts = tsKey
    ? `<script nonce="${nonce}">
window.__TS_KEY__=${JSON.stringify(tsKey)};
window.__TS_TOKEN__='';
window.__onTsOk=function(t){ window.__TS_TOKEN__ = t || ''; };
window.__onTsExpired=function(){ window.__TS_TOKEN__ = ''; };
</script>
<script defer async
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        nonce="${nonce}"></script>`
    : ''

  // Contexto SEO expuesto al cliente: el script arranque autoseleccionara el
  // dropdown de provincia si hay un provinciaId (via ruta /gasolineras/<slug>).
  // Si ademas viene municipioId, autoselecciona municipio tambien.
  // Queda como window.__SEO__ y el cliente lo lee en initMap().
  const seoScript = seo?.provinciaId
    ? `<script nonce="${nonce}">window.__SEO__=${JSON.stringify({
        provinciaId: seo.provinciaId,
        provinciaSlug: seo.provinciaSlug,
        provinciaName: seo.provinciaName,
        municipioId: seo.municipioId,
        municipioSlug: seo.municipioSlug,
        municipioName: seo.municipioName,
      })};</script>`
    : ''

  // Ship 15: snapshot freshness badge + home flag.
  // __SNAP_AT__ es la fecha cruda del Ministerio (formato "DD/MM/YYYY HH:mm:SS").
  // __IS_HOME__ true cuando no hay provincia/municipio en la ruta — el cliente
  // lo usa para decidir si renderizar el widget de stats nacionales.
  const snapMetaScript = `<script nonce="${nonce}">${
    opts.snapshotDate ? `window.__SNAP_AT__=${JSON.stringify(opts.snapshotDate)};` : ''
  }window.__IS_HOME__=${!seo?.provinciaId};</script>`

  // JSON-LD: declara la aplicacion como WebApplication + el dataset de precios.
  // Breadcrumbs: rutas provincia + municipio. Ayuda a Google a entender la
  // jerarquia y a pintar migas en los resultados.
  const breadcrumbItems: Array<{ '@type': 'ListItem'; position: number; name: string; item: string }> = []
  if (seo?.provinciaName) {
    breadcrumbItems.push({ '@type': 'ListItem', position: 1, name: 'Inicio', item: origin + '/' })
    breadcrumbItems.push({
      '@type': 'ListItem',
      position: 2,
      name: 'Gasolineras en ' + seo.provinciaName,
      item: origin + '/gasolineras/' + seo.provinciaSlug,
    })
    if (seo.municipioName && seo.municipioSlug) {
      breadcrumbItems.push({
        '@type': 'ListItem',
        position: 3,
        name: 'Gasolineras en ' + seo.municipioName,
        item: canonical,
      })
    }
  }
  const breadcrumbs = breadcrumbItems.length > 0 ? [{
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: breadcrumbItems,
  }] : []
  // FAQ: ahora se emite SIEMPRE (home, provincia, municipio) — y a partir de
  // Ship 11 tambien se renderiza visible en HTML para que Google valide el
  // FAQPage schema. En provincia/municipio anadimos 1-2 preguntas contextuales
  // con el nombre del ambito para enriquecer la relevancia semantica.
  const faqBaseItems = [
    {
      '@type': 'Question',
      name: '¿De dónde vienen los precios?',
      acceptedAnswer: { '@type': 'Answer', text: 'Del dataset oficial del Ministerio para la Transición Ecológica y el Reto Demográfico, actualizado a diario. La app consume directamente el snapshot público.' },
    },
    {
      '@type': 'Question',
      name: '¿Con qué frecuencia se actualizan?',
      acceptedAnswer: { '@type': 'Answer', text: 'Una vez al día, hacia las 20:00 UTC, cuando el Ministerio publica la tanda del día. Las gasolineras tienen 48 h para comunicar cambios por ley.' },
    },
    {
      '@type': 'Question',
      name: '¿Es gratis?',
      acceptedAnswer: { '@type': 'Answer', text: 'Sí, gratis y sin anuncios. Si te resulta útil, hay un botón de Ko-fi para invitarme a un café.' },
    },
    {
      '@type': 'Question',
      name: '¿Puedo usarla sin conexión?',
      acceptedAnswer: { '@type': 'Answer', text: 'La app está instalable como PWA y cachea el último snapshot de precios — si pierdes cobertura, sigues viendo los datos vistos por última vez.' },
    },
  ]
  const faqGeoItems = geoLabel ? [
    {
      '@type': 'Question',
      name: '¿Cuántas gasolineras hay en ' + geoLabel + '?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: (seo?.stationCount
          ? 'En el último snapshot del Ministerio constan ' + seo.stationCount + ' estaciones de servicio activas en ' + geoLabel + '. '
          : 'La app muestra todas las estaciones activas en ' + geoLabel + ' según el snapshot oficial. ') +
          'Puedes filtrar por marca, horario de apertura, 24h o distancia desde tu ubicación.',
      },
    },
    {
      '@type': 'Question',
      name: '¿Cuál es el precio medio del diésel y la gasolina 95 en ' + geoLabel + '?',
      acceptedAnswer: {
        '@type': 'Answer',
        text: (() => {
          const s95 = seo?.stats?.['95']
          const sd  = seo?.stats?.['diesel']
          if (!s95 && !sd) return 'Los precios medios se calculan a partir del snapshot diario del Ministerio. Consulta la tabla al final de esta página para los valores actuales.'
          const parts: string[] = []
          if (s95 && s95.count >= 3) parts.push('gasolina 95 a una media de ' + s95.avg.toFixed(3) + ' €/L (rango ' + s95.min.toFixed(3) + '–' + s95.max.toFixed(3) + ' €)')
          if (sd  && sd.count  >= 3) parts.push('gasóleo A a una media de ' + sd.avg.toFixed(3)  + ' €/L (rango ' + sd.min.toFixed(3)  + '–' + sd.max.toFixed(3)  + ' €)')
          return 'Según el último snapshot del Ministerio, en ' + geoLabel + ' se encuentra ' + parts.join(' y ') + '. Los precios se actualizan a diario.'
        })(),
      },
    },
  ] : []
  const faqPage = [{
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: [...faqGeoItems, ...faqBaseItems],
  }]

  const jsonLd = JSON.stringify([
    {
      '@context': 'https://schema.org',
      '@type': 'WebApplication',
      name: 'Gasolineras España',
      url: canonical,
      description: pageDesc,
      applicationCategory: 'UtilitiesApplication',
      operatingSystem: 'Any',
      inLanguage: 'es-ES',
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
      softwareVersion: APP_VERSION,
      image: ogImage,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Gasolineras España',
      url: origin,
      logo: logoUrl,
      sameAs: [
        'https://github.com/ioritzarroyuelos-ai/gasolineras-espana',
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Dataset',
      name: geoLabel ? 'Precios de carburantes en ' + geoLabel : 'Precios de carburantes en España',
      description: 'Snapshot oficial de precios de estaciones de servicio terrestres.',
      license: 'https://datos.gob.es/es/catalogo/e05068001-precio-de-carburantes-en-las-gasolineras-espanolas',
      creator: { '@type': 'GovernmentOrganization', name: 'Ministerio para la Transición Ecológica y el Reto Demográfico' },
      spatialCoverage: { '@type': 'Place', name: geoLabel || 'España' },
      inLanguage: 'es',
      // variableMeasured: una entry por combustible con stats reales. Google
      // y Dataset Search leen esto para indexar metricas concretas — asi un
      // query "precio diesel Madrid" matchea este dataset con valor numerico.
      variableMeasured: seo?.stats
        ? Object.keys(seo.stats).map(fuelCode => {
            const s = seo.stats![fuelCode]
            const readableName: Record<string, string> = {
              '95':          'Gasolina 95 E5',
              '98':          'Gasolina 98 E5',
              'diesel':      'Gasóleo A',
              'diesel_plus': 'Gasóleo Premium',
            }
            return {
              '@type': 'PropertyValue',
              name:  readableName[fuelCode] || fuelCode,
              unitCode: 'LTR',
              unitText: '€/L',
              minValue: s.min.toFixed(3),
              maxValue: s.max.toFixed(3),
              value:    s.avg.toFixed(3),
            }
          })
        : undefined,
    },
    ...faqPage,
    ...breadcrumbs,
    // Ship 17: ItemList → GasStation. Solo emitimos cuando hay topStations
    // (provincia/municipio). Google indexa las entidades como nodos separados,
    // lo que habilita rich results tipo carrusel ("gasolineras mas baratas en
    // Madrid" → tarjetas con nombre + direccion + precio). Cada item es un
    // GasStation con PostalAddress + GeoCoordinates + Offer (precio + fuel).
    ...(seo?.topStations && seo.topStations.length > 0
      ? [{
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          name: geoLabel
            ? 'Gasolineras mas baratas en ' + geoLabel
            : 'Gasolineras mas baratas',
          numberOfItems: seo.topStations.length,
          itemListOrder: 'https://schema.org/ItemListOrderAscending',
          itemListElement: seo.topStations.map((st, idx) => {
            const fuelName: Record<string, string> = {
              '95':          'Gasolina 95 E5',
              '98':          'Gasolina 98 E5',
              'diesel':      'Gasoleo A',
              'diesel_plus': 'Gasoleo Premium',
            }
            return {
              '@type': 'ListItem',
              position: idx + 1,
              item: {
                '@type': 'GasStation',
                name: st.name,
                address: {
                  '@type': 'PostalAddress',
                  streetAddress: st.address || undefined,
                  addressLocality: st.municipio || undefined,
                  addressRegion: st.provincia || undefined,
                  postalCode: st.postalCode || undefined,
                  addressCountry: 'ES',
                },
                geo: {
                  '@type': 'GeoCoordinates',
                  latitude: st.lat,
                  longitude: st.lon,
                },
                // Google admite `priceRange` como string (el que se ve en el
                // perfil de negocio local), pero el dato numerico fuerte va
                // en `makesOffer` con unitCode LTR.
                priceRange: st.price.toFixed(3) + ' EUR',
                makesOffer: {
                  '@type': 'Offer',
                  itemOffered: {
                    '@type': 'Product',
                    name: fuelName[st.fuelCode] || st.fuelCode,
                  },
                  price: st.price.toFixed(3),
                  priceCurrency: 'EUR',
                  eligibleQuantity: { '@type': 'QuantitativeValue', unitCode: 'LTR', value: 1 },
                  availability: 'https://schema.org/InStock',
                },
              },
            }
          }),
        }]
      : []),
  ])

  // Ship 25.2: boton de donacion opcional. Solo pintamos el <a> si la env var
  // SUPPORT_URL esta definida y es un URL http(s) — evita XSS por javascript:
  // o data: URIs si alguien en el futuro se confunde con el origen de la var.
  // Sanitizamos tambien con replace de comillas por si la URL contiene chars
  // raros (aunque validamos el schema, defensa en profundidad).
  const supportUrlRaw = (opts.supportUrl || '').trim()
  const supportUrlValid = /^https?:\/\/[^\s"'<>]+$/i.test(supportUrlRaw)
  const supportUrlSafe = supportUrlValid
    ? supportUrlRaw.replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    : ''
  // rel="noopener noreferrer sponsored": sponsored es la convencion para
  // botones de donacion/afiliacion — evita que Google los trate como
  // backlinks de SEO. noopener previene window.opener hijacking.
  const supportBlockHtml = supportUrlSafe
    ? `<a href="${supportUrlSafe}"
         class="kofi-support"
         target="_blank"
         rel="noopener noreferrer sponsored"
         aria-label="Invitame a un cafe">
        <span aria-hidden="true">&#x2615;</span>
        <span>Inv&iacute;tame a un caf&eacute;</span>
      </a>`
    : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#16a34a" />
  <meta name="color-scheme" content="light dark" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
  <meta name="apple-mobile-web-app-title" content="Gasolineras" />
  <meta name="robots" content="index,follow,max-image-preview:large" />
  <meta name="application-name" content="Gasolineras España" />
  <meta name="author" content="Gasolineras España" />
  <meta name="generator" content="Hono + Cloudflare Pages" />
  <meta name="description" content="${pageDesc}" />
  <meta name="keywords" content="gasolineras, precios combustible, gasolina, diesel, España, mapa gasolineras, ahorro combustible${seo?.provinciaName ? ', ' + seo.provinciaName.toLowerCase() : ''}" />

  <!-- Open Graph / redes -->
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Gasolineras España" />
  <meta property="og:title" content="${ogTitle}" />
  <meta property="og:description" content="${ogDesc}" />
  <meta property="og:url" content="${canonical}" />
  <meta property="og:image" content="${ogImage}" />
  <meta property="og:image:alt" content="Gasolineras España · comparador de precios oficial" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:locale" content="es_ES" />

  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${ogTitle}" />
  <meta name="twitter:description" content="${ogDesc}" />
  <meta name="twitter:image" content="${ogImage}" />
  <meta name="twitter:image:alt" content="Gasolineras España · comparador de precios oficial" />

  <link rel="canonical" href="${canonical}" />
  <title>${pageTitle}</title>

  <!-- Favicon / PWA icons -->
  <link rel="icon" type="image/svg+xml" href="/static/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/static/favicon-32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/static/apple-touch-icon.png" />
  <link rel="mask-icon" href="/static/favicon.svg" color="#16a34a" />
  <link rel="manifest" href="/manifest.json" />

  <!-- Preconnect a hosts criticos: reduce handshake en LCP -->
  <link rel="preconnect" href="https://sedeaplicaciones.minetur.gob.es" />
  <link rel="preconnect" href="https://a.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://b.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://c.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://d.basemaps.cartocdn.com" crossorigin />
  <link rel="preconnect" href="https://tiles.openfreemap.org" crossorigin />
  <link rel="preconnect" href="https://unpkg.com" crossorigin />
  <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
  <link rel="dns-prefetch" href="https://nominatim.openstreetmap.org" />

  <!-- Leaflet CSS (critico para map) -->
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <!-- Leaflet JS (defer: parse HTML sin bloquear, ejecutar antes de DOMContentLoaded) -->
  <script defer
          src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          integrity="sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>

  <!-- Marker Cluster -->
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.css"
        integrity="sha384-lPzjPsFQL6te2x+VxmV6q1DpRxpRk0tmnl2cpwAO5y04ESyc752tnEWPKDfl1olr"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <link rel="stylesheet"
        href="https://unpkg.com/leaflet.markercluster@1.4.1/dist/MarkerCluster.Default.css"
        integrity="sha384-5kMSQJ6S4Qj5i09mtMNrWpSi8iXw230pKU76xTmrpezGnNJQzj0NzXjQLLg+jE7k"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <script defer
          src="https://unpkg.com/leaflet.markercluster@1.4.1/dist/leaflet.markercluster.js"
          integrity="sha384-RLIyj5q1b5XJTn0tqUhucRZe40nFTocRP91R/NkRJHwAe4XxnTV77FXy/vGLiec2"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>

  <!-- Leaflet.heat: capa de heatmap como vista alternativa al cluster. El
       peso de cada punto se calcula inverso al precio (mas barato = mas
       caliente) en renderMarkers. Defer + SRI para integridad. -->
  <script defer
          src="https://unpkg.com/leaflet.heat@0.2.0/dist/leaflet-heat.js"
          integrity="sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>

  <!-- MapLibre GL + bridge leaflet — render vectorial con estilo Liberty de
       OpenFreeMap parcheado en runtime para priorizar name:es (toponimia en
       castellano aunque existan etiquetas en otros idiomas en el dataset OSM).
       Fallback defensivo: si cualquiera de estos scripts falla o el navegador
       no soporta WebGL, client.ts cae a raster voyager_nolabels + SPAIN_LABELS
       custom, asi el usuario nunca ve pantalla en blanco. -->
  <link rel="stylesheet"
        href="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css"
        integrity="sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />
  <script defer
          src="https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js"
          integrity="sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>
  <script defer
          src="https://unpkg.com/@maplibre/maplibre-gl-leaflet@0.0.22/leaflet-maplibre-gl.js"
          integrity="sha384-4CB9Vtol9LN6lGgBCvmPLbUEZwilrqIvPieSRurgAXAB7FVJaLS9n8WyAIA5wjQ+"
          crossorigin="anonymous"
          referrerpolicy="no-referrer"></script>

  <!-- FontAwesome -->
  <link rel="stylesheet"
        href="https://cdn.jsdelivr.net/npm/@fortawesome/fontawesome-free@6.4.0/css/all.min.css"
        integrity="sha384-iw3OoTErCYJJB9mCa8LNS2hbsQ7M3C0EpIsO/H5+EGAkPGc6rk+V8i04oW/K5xq0"
        crossorigin="anonymous"
        referrerpolicy="no-referrer" />

  <!-- JSON-LD para SEO / rich results -->
  <script type="application/ld+json" nonce="${nonce}">${jsonLd}</script>

  ${seoScript}
  ${snapMetaScript}
  ${turnstileScripts}

  ${getStyles(nonce)}
</head>
<body>

<!-- ============ HEADER ============ -->
<header id="app-header">
  <button id="btn-toggle-sidebar" title="Abrir filtros" aria-label="Abrir panel de filtros">
    <i class="fas fa-bars u-c-white u-fs-16" aria-hidden="true"></i>
  </button>

  <a href="/" id="brand" class="brand-link" aria-label="Gasolineras España · inicio">
    <img src="${logoUrl}" width="32" height="32" alt="" class="header-logo-img" decoding="async" />
    <div class="u-mw-0">
      <div class="header-title">Gasolineras España</div>
      <div class="header-sub">Precios oficiales · Ministerio de Industria y Energía</div>
    </div>
  </a>

  <div class="header-actions">
    <span id="lbl-update" class="header-update u-hide"></span>
    <span id="lbl-count" class="header-badge u-hide"></span>
    <!-- Acceso a favoritas: abre el modal con la lista + alertas. La estrella
         se rellena cuando hay >=1 favorita, y la insignia numerica solo se
         muestra en ese caso. -->
    <button id="btn-favs" class="btn-header-fav" title="Mis favoritas" aria-label="Ver mis favoritas">
      <i class="far fa-star" id="btn-favs-icon" aria-hidden="true"></i>
      <span id="fav-badge" class="fav-badge" hidden>0</span>
    </button>
    <!-- Ruta optima A->B: abre modal para buscar las mas baratas del trayecto -->
    <button id="btn-route" class="btn-header-fav" title="Ruta: mejores gasolineras del trayecto" aria-label="Planificar ruta con gasolineras">
      <i class="fas fa-route" aria-hidden="true"></i>
    </button>
    <!-- Diario de repostajes: gasto mensual real + consumo real + top estaciones -->
    <button id="btn-diary" class="btn-header-fav" title="Mi diario de repostajes" aria-label="Abrir diario de repostajes">
      <i class="fas fa-book" aria-hidden="true"></i>
    </button>
    <button id="btn-dark" title="Modo oscuro / claro" aria-label="Alternar tema claro u oscuro"><i class="fas fa-moon" aria-hidden="true"></i></button>
  </div>
</header>

<!-- Banner offline -->
<div id="offline-banner" role="status" aria-live="polite">
  <i class="fas fa-wifi u-mr-6 u-op-80" aria-hidden="true"></i>
  <span id="offline-text">Sin conexión · mostrando datos guardados</span>
</div>

<!-- Banner datos desactualizados (>24h) -->
<div id="stale-banner" role="status" aria-live="polite">
  <i class="fas fa-hourglass-half u-mr-6" aria-hidden="true"></i>
  <span id="stale-text">Los datos oficiales llevan más de 24 h sin actualizarse.</span>
</div>

<!-- Tendencia nacional: ultra-compacta, se puebla via JS con trends.json.
     Oculta por defecto y solo se muestra cuando hay deltas computables
     (segundo snapshot en adelante). -->
<div id="trend-strip" role="status" aria-live="polite" hidden>
  <span class="trend-strip-label">Hoy en España:</span>
  <span class="trend-strip-item" id="trend-g95"></span>
  <span class="trend-strip-sep">·</span>
  <span class="trend-strip-item" id="trend-diesel"></span>
  <button id="trend-strip-close" class="trend-strip-close" aria-label="Ocultar tendencia">&times;</button>
</div>

<!-- ============ CUERPO ============ -->
<div id="app-body">

  <!-- ======= SIDEBAR ======= -->
  <aside id="sidebar">

    <!-- FILTROS -->
    <div id="sidebar-filters">
      <div class="search-heading-row">
        <span class="search-heading">
          <i class="fas fa-sliders-h u-c-green" aria-hidden="true"></i> Búsqueda
        </span>
        <div class="search-actions">
          <button id="btn-share" class="btn-icon" title="Compartir búsqueda" aria-label="Compartir búsqueda actual">
            <i class="fas fa-share-alt" aria-hidden="true"></i>
          </button>
          <button id="btn-geolocate" class="btn-icon" title="Usar mi ubicación" aria-label="Usar mi ubicación">
            <i class="fas fa-crosshairs" aria-hidden="true"></i>
          </button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label" for="sel-provincia">Provincia</label>
        <select id="sel-provincia" class="form-select">
          <option value="">-- Selecciona --</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="sel-municipio">Municipio</label>
        <select id="sel-municipio" class="form-select" disabled>
          <option value="">-- Todos --</option>
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="sel-combustible">Combustible</label>
        <select id="sel-combustible" class="form-select">
          <option value="Precio Gasolina 95 E5">Gasolina 95 E5</option>
          <option value="Precio Gasolina 98 E5">Gasolina 98 E5</option>
          <option value="Precio Gasoleo A">Gasoleo A (Diesel)</option>
          <option value="Precio Gasoleo Premium">Gasoleo Premium</option>
          <option value="Precio Gases licuados del petroleo">GLP (Autogas)</option>
          <option value="Precio Gas Natural Comprimido">Gas Natural (GNC)</option>
          <option value="Precio Gas Natural Licuado">Gas Natural (GNL)</option>
          <option value="Precio Hidrogeno">Hidrogeno</option>
          <option value="Precio Diesel Renovable">Diesel Renovable</option>
        </select>
      </div>

      <div class="form-group u-pos-rel">
        <label class="form-label" for="search-text">Buscar gasolinera</label>
        <div class="input-icon-wrap">
          <i class="fas fa-search icon" aria-hidden="true"></i>
          <input id="search-text" class="form-input" type="text" placeholder="Repsol, BP, Cepsa..." autocomplete="off" />
        </div>
        <div id="search-suggestions" role="listbox"></div>
      </div>

      <div class="row">
        <div class="flex-1">
          <label class="form-label" for="sel-orden">Ordenar</label>
          <select id="sel-orden" class="form-select">
            <option value="asc">Precio &#x2191; (más barato)</option>
            <option value="desc">Precio &#x2193; (más caro)</option>
            <option value="cerca">Cerca + barato (mixto)</option>
            <option value="dist">Distancia</option>
            <option value="az">Nombre A&#x2192;Z</option>
          </select>
        </div>
        <button id="btn-buscar" class="btn-primary" aria-label="Buscar gasolineras">
          <i class="fas fa-search" aria-hidden="true"></i> Buscar
        </button>
      </div>

      <!-- Filtros avanzados: operan sobre resultados ya cargados, por eso se
           aplican en vivo (no requieren "Buscar" de nuevo). Van en una caja
           colapsable para no saturar al usuario que no los necesita. -->
      <details class="adv-filters" id="adv-filters">
        <summary class="adv-filters-summary">
          <i class="fas fa-filter" aria-hidden="true"></i>
          <span>Filtros avanzados</span>
          <span class="adv-filters-count" id="adv-filters-count" aria-hidden="true"></span>
        </summary>
        <div class="adv-filters-body">
          <div class="chip-row">
            <label class="chip-check">
              <input type="checkbox" id="flt-abierto" />
              <span>&#x1F7E2; Abierto ahora</span>
            </label>
            <label class="chip-check">
              <input type="checkbox" id="flt-24h" />
              <span>&#x1F319; 24 horas</span>
            </label>
          </div>
          <div class="form-group u-mt-10 u-mb-0">
            <label class="form-label" for="sel-marca">Marca</label>
            <select id="sel-marca" class="form-select">
              <option value="">-- Cualquiera --</option>
              <option value="REPSOL">Repsol</option>
              <option value="CEPSA">Cepsa</option>
              <option value="MOEVE">Moeve</option>
              <option value="GALP">Galp</option>
              <option value="BALLENOIL">Ballenoil</option>
              <option value="PLENERGY">Plenergy</option>
              <option value="SHELL">Shell</option>
              <option value="PETROPRIX">Petroprix</option>
              <option value="PETRONOR">Petronor</option>
              <option value="CARREFOUR">Carrefour</option>
              <option value="BP">BP</option>
              <option value="AVIA">Avia</option>
              <option value="Q8">Q8</option>
              <option value="CAMPSA">Campsa</option>
              <option value="ESCLATOIL">Esclatoil</option>
              <option value="ALCAMPO">Alcampo</option>
              <option value="EROSKI">Eroski</option>
              <option value="BONAREA">BonÀrea</option>
              <option value="MEROIL">Meroil</option>
              <option value="__LOWCOST__">Low-cost (sin marca conocida)</option>
            </select>
          </div>
        </div>
      </details>

      <!-- Radio de busqueda (cerca-de-mi) -->
      <div class="form-group u-hide" id="radius-group">
        <label class="form-label" for="in-radius">Radio de búsqueda</label>
        <div class="range-group">
          <input id="in-radius" type="range" min="1" max="50" step="1" value="10" aria-label="Radio en kilómetros" />
          <span class="range-val" id="lbl-radius">10 km</span>
        </div>
      </div>

      <!-- Deposito del vehiculo (para calculo de ahorro) -->
      <div class="form-group">
        <label class="form-label" for="in-tank">Depósito <span class="tank-sub">(para calcular ahorro)</span></label>
        <div class="range-group">
          <input id="in-tank" type="range" min="20" max="120" step="5" value="50" aria-label="Capacidad del depósito en litros" />
          <span class="range-val" id="lbl-tank">50 L</span>
        </div>
      </div>

      <!-- Widget de gasto mensual (se activa tras onboarding) -->
      <div id="monthly-widget" role="region" aria-label="Gasto estimado mensual">
        <div class="mw-title">&#x1F4CA; Gasto estimado mensual</div>
        <div class="mw-cost" id="mw-cost">--</div>
        <div class="mw-sub" id="mw-sub">--</div>
      </div>

      <!-- Edit perfil -->
      <button id="btn-profile" class="btn-ghost btn-profile-util">
        <i class="fas fa-user-cog u-mr-6" aria-hidden="true"></i>
        <span id="btn-profile-label">Configurar mi vehículo</span>
      </button>

      <!-- Ship 25.2: boton "Invitame a un cafe" renderizado condicionalmente
           desde env.SUPPORT_URL. Si no hay SUPPORT_URL, este slot queda vacio
           (no hay DOM ni espacio reservado — sin layout shift). -->
      ${supportBlockHtml}
    </div>

    <!-- STATS -->
    <div id="stats-bar">
      <div class="stats-flex">
        <span class="u-c-slate"><i class="fas fa-map-marker-alt u-c-green u-mr-4" aria-hidden="true"></i><strong id="stat-n">0</strong> gasolineras</span>
        <span class="stat-chip">&#x2193; <span id="stat-min">--</span></span>
        <span class="stat-chip yellow">&#x2248; <span id="stat-avg">--</span></span>
        <span class="stat-chip red">&#x2191; <span id="stat-max">--</span></span>
      </div>
    </div>

    <!-- Ship 21: indicador pull-to-refresh. Oculto (height:0) por defecto;
         el listener en list.ts lo expande conforme el usuario tira hacia abajo
         desde arriba de la lista. Solo aparece en dispositivos touch. -->
    <div id="ptr-indicator" class="ptr-indicator" aria-hidden="true">
      <span class="ptr-arrow" aria-hidden="true">&#x2193;</span>
      <span class="ptr-text">Tira para actualizar</span>
    </div>

    <!-- LISTA -->
    <div id="station-list" aria-label="Lista de gasolineras" aria-live="polite" aria-busy="false">
      <div class="empty-state">
        <div class="icon" aria-hidden="true">&#x1F5FA;&#xFE0F;</div>
        <p>Selecciona una provincia</p>
        <small>Se cargarán todas las gasolineras con sus precios actualizados</small>
      </div>
    </div>

  </aside>

  <!-- Backdrop mobile -->
  <div id="sidebar-backdrop"></div>

  <!-- ======= MAPA ======= -->
  <div id="map-container">
    <div id="map" role="region" aria-label="Mapa de gasolineras"></div>

    <!-- Ship 6: toggle heatmap. Cambia la vista de cluster a mapa de calor
         donde el color indica densidad de precios bajos (mas rojo = mas
         barato). Util para decidir zonas en viajes largos sin tener que
         revisar 400 pins. El boton va flotante sobre el mapa, junto al
         control de zoom de Leaflet, con aria-pressed. -->
    <button id="btn-heatmap"
            class="map-floating-btn"
            type="button"
            aria-pressed="false"
            aria-label="Activar mapa de calor de precios"
            title="Vista de mapa de calor (más rojo = más barato)">
      <i class="fa-solid fa-fire" aria-hidden="true"></i>
    </button>

    <!-- Banner "modo ruta" flotante sobre el mapa. Se activa al planificar
         una ruta y se oculta al cerrar el modo. -->
    <div id="route-mode-bar" class="route-mode-bar" role="status" aria-live="polite">
      <span class="route-mode-bar-text" id="route-mode-bar-text">Modo ruta activo</span>
      <span class="route-mode-bar-nav" id="route-mode-bar-nav" aria-label="Abrir ruta en">
        <a id="nav-gmaps" href="#" target="_blank" rel="noopener" title="Abrir ruta en Google Maps">Google</a>
        <a id="nav-amaps" href="#" target="_blank" rel="noopener" title="Abrir ruta en Apple Maps">Apple</a>
        <a id="nav-waze"  href="#" target="_blank" rel="noopener" title="Abrir destino en Waze (no admite paradas)">Waze</a>
      </span>
      <!-- Toggle para mostrar TODAS las gasolineras del corredor, no solo las
           paradas recomendadas. Util cuando el plan propuesto no cuadra (ej.
           el usuario ya sabe que quiere una marca concreta o una estacion
           con aseos). aria-pressed refleja el estado; se hidrata desde JS. -->
      <button id="route-mode-bar-corridor"
              class="route-mode-bar-corridor"
              type="button"
              aria-pressed="false"
              aria-label="Mostrar todas las gasolineras del corredor de la ruta"
              title="Ver todas las gasolineras en el trayecto (no solo las paradas recomendadas)">
        <span id="route-mode-bar-corridor-label">Ver todas en ruta</span>
      </button>
      <button id="route-mode-bar-exit" class="route-mode-bar-exit" type="button">Salir de la ruta</button>
    </div>

    <!-- Loading -->
    <div id="loading" role="status" aria-live="polite">
      <div class="loading-box">
        <div class="spinner" aria-hidden="true"></div>
        <p class="loading-line-1">Cargando gasolineras...</p>
        <p class="loading-line-2">Datos oficiales del Ministerio</p>
      </div>
    </div>

    <!-- INFO CARD -->
    <div id="map-info">
      <div class="info-title">&#x26FD; Gasolineras en directo</div>
      <div class="info-desc">Localiza estaciones al instante, revisa su contexto y compara el precio elegido con menos fricción.</div>
    </div>

    <!-- LEYENDA -->
    <div id="legend" aria-label="Leyenda de precios">
      <h4>LEYENDA</h4>
      <div class="legend-item"><span class="legend-dot dot-green" aria-hidden="true"></span> Más barato</div>
      <div class="legend-item"><span class="legend-dot dot-orange" aria-hidden="true"></span> Intermedio</div>
      <div class="legend-item"><span class="legend-dot dot-red" aria-hidden="true"></span> Más caro</div>
      <div class="legend-item u-mb-0"><span class="legend-dot dot-gray" aria-hidden="true"></span> Sin precio</div>
    </div>
  </div>

</div><!-- end app-body -->

<!-- ============ MODAL ONBOARDING / PERFIL ============ -->
<div id="modal-profile" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="profile-title">
  <div class="modal">
    <div class="modal-header">
      <h2 id="profile-title">&#x26FD; Personaliza tu experiencia</h2>
      <p>Solo se guarda en tu navegador. Puedes cambiarlo cuando quieras.</p>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label">&#x26FD; Qué combustible usas</label>
        <div id="chips-fuel" class="chip-group" role="radiogroup" aria-label="Combustible">
          <button class="chip" data-fuel="Precio Gasolina 95 E5"   role="radio">Gasolina 95</button>
          <button class="chip" data-fuel="Precio Gasolina 98 E5"   role="radio">Gasolina 98</button>
          <button class="chip" data-fuel="Precio Gasoleo A"        role="radio">Diesel</button>
          <button class="chip" data-fuel="Precio Gasoleo Premium"  role="radio">Diesel Premium</button>
          <button class="chip" data-fuel="Precio Gases licuados del petroleo" role="radio">GLP</button>
          <button class="chip" data-fuel="Precio Hidrogeno"        role="radio">Hidrogeno</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">&#x1F6E3;&#xFE0F; Kilómetros que haces al mes</label>
        <div id="chips-km" class="chip-group" role="radiogroup" aria-label="Kilómetros al mes">
          <button class="chip" data-km="500"   role="radio">~500 km</button>
          <button class="chip" data-km="1000"  role="radio">~1.000 km</button>
          <button class="chip" data-km="1500"  role="radio">~1.500 km</button>
          <button class="chip" data-km="2500"  role="radio">~2.500 km</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="in-consumo">&#x1F4A7; Consumo medio (L/100km)</label>
        <div class="range-group">
          <input id="in-consumo" type="range" min="3" max="15" step="0.5" value="6.5" aria-label="Consumo en litros por 100 kilómetros" />
          <span class="range-val" id="lbl-consumo">6,5 L</span>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label" for="in-tank-modal">&#x26FD; Capacidad del depósito</label>
        <div class="range-group">
          <input id="in-tank-modal" type="range" min="20" max="120" step="5" value="50" aria-label="Capacidad del depósito en litros" />
          <span class="range-val" id="lbl-tank-modal">50 L</span>
        </div>
      </div>
      <!-- Autonomia: valor FIJO que pone el usuario. Primera vez lo
           precalculamos como deposito / consumo * 100 para dar un default
           razonable, pero una vez editado se mantiene independiente: cambiar
           deposito o consumo no lo mueve. Mostramos un icono de lapiz para
           que se vea claramente que es editable (un numero grande "normal"
           se confunde con un texto estatico). -->
      <div class="form-group" id="profile-autonomy-box">
        <label class="form-label" for="in-autonomy">&#x1F6E3;&#xFE0F; Autonom&iacute;a con dep&oacute;sito lleno</label>
        <div class="profile-autonomy">
          <input id="in-autonomy" class="profile-autonomy-input" type="number" min="50" max="2000" step="10" value="769" inputmode="numeric" aria-label="Autonom&iacute;a en kil&oacute;metros" title="Pulsa para editar" />
          <span class="profile-autonomy-unit">km</span>
          <span class="profile-autonomy-pencil" aria-hidden="true">&#x270F;&#xFE0F;</span>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-profile-skip"  class="btn-ghost">Ahora no</button>
      <button id="btn-profile-save"  class="btn-primary">Guardar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL FAVORITAS ============ -->
<!-- Se abre desde el boton estrella del header. Solo contiene la lista de
     gasolineras favoritas. Al hacer click en una, el modal cierra y el
     cliente navega (provincia + municipio + texto de busqueda) para dejar en
     el mapa unicamente esa estacion. Alertas (navegador/email) se dejan
     para un release posterior; el flujo actual es 100% navegacion. -->
<div id="modal-favs" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="favs-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="favs-title">&#x2B50; Mis favoritas (<span id="favs-modal-count">0</span>)</h2>
        <p>Haz click en una favorita para verla en el mapa.</p>
      </div>
      <button id="btn-favs-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <!-- Ship 25: panel de alertas por Telegram. Se oculta si el servidor
           no tiene el bot configurado (GET /api/telegram/config -> 503). -->
      <div id="tg-alerts-panel" class="tg-alerts-panel" hidden>
        <div class="tg-alerts-info">
          <span class="tg-alerts-icon" aria-hidden="true">&#x2708;&#xFE0F;</span>
          <div class="tg-alerts-text">
            <strong>Alertas por Telegram</strong>
            <small id="tg-alerts-status">Recibe un aviso por Telegram cuando baje una de tus favoritas. Funciona tambien con la app cerrada.</small>
          </div>
        </div>
        <button id="btn-tg-toggle" class="btn-primary tg-alerts-btn">Activar alertas en Telegram</button>
      </div>
      <!-- Lista de favoritas -->
      <div id="favs-list-wrap">
        <div id="favs-empty" class="favs-empty">
          <i class="far fa-star" aria-hidden="true"></i>
          Aun no tienes favoritas. Pulsa la estrella en el popup de una gasolinera para guardarla.
        </div>
        <div id="favs-list"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-favs-done" class="btn-primary">Cerrar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL RUTA A->B ============ -->
<!-- Busca la TOP-N de gasolineras mas baratas dentro de un corredor a lo
     largo del trayecto entre dos puntos (origen + destino). Reutiliza
     /api/geocode/search (Nominatim proxy) para resolver los nombres a
     coordenadas; el filtrado corredor + ranking es 100% cliente. -->
<div id="modal-route" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="route-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="route-title">&#x1F6E3;&#xFE0F; Ruta: d&oacute;nde repostar</h2>
        <p>Te decimos en qu&eacute; gasolineras parar seg&uacute;n tu autonom&iacute;a y el precio.</p>
      </div>
      <button id="btn-route-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label class="form-label" for="route-from">Origen</label>
        <input id="route-from" class="form-input" type="text" placeholder="Madrid, Valencia, ..." autocomplete="off" />
        <div id="route-from-sug" class="route-sug" role="listbox"></div>
      </div>
      <!-- Ship 7: paradas intermedias (waypoints). El planner soporta hasta 3
           paradas entre origen y destino. Cada fila se genera via JS como
           "chip + input + boton quitar" para mantener el markup limpio en
           el estado por defecto (0 paradas). El boton "Anadir parada" anade
           la primera; las adicionales aparecen al rellenar la anterior. -->
      <div id="route-stops-wrap" class="route-stops-wrap" aria-live="polite"></div>
      <button id="btn-route-add-stop" class="btn-ghost btn-route-add-stop" type="button">
        <i class="fa-solid fa-plus" aria-hidden="true"></i> Anadir parada intermedia
      </button>
      <div class="form-group">
        <label class="form-label" for="route-to">Destino</label>
        <input id="route-to" class="form-input" type="text" placeholder="Barcelona, Sevilla, ..." autocomplete="off" />
        <div id="route-to-sug" class="route-sug" role="listbox"></div>
      </div>
      <!-- Bloque informativo: la autonomia se deriva de tu perfil (deposito /
           consumo x 100). Ya no pedimos al usuario el "ancho del corredor":
           usamos 5 km por defecto y ampliamos automaticamente si no encontramos
           suficientes gasolineras. Todo transparente. -->
      <div class="form-group" id="route-profile-box">
        <label class="form-label">&#x1F697; Tu coche (seg&uacute;n perfil)</label>
        <div id="route-profile-info" class="route-profile-info">
          <div class="route-profile-row">
            <span class="route-profile-k">Dep&oacute;sito</span>
            <span class="route-profile-v"><span id="route-profile-tank">50</span> L</span>
          </div>
          <div class="route-profile-row">
            <span class="route-profile-k">Consumo</span>
            <span class="route-profile-v"><span id="route-profile-cons">6,5</span> L/100km</span>
          </div>
          <div class="route-profile-row route-profile-hl">
            <span class="route-profile-k">Autonom&iacute;a</span>
            <span class="route-profile-v"><span id="route-profile-auto">769</span> km</span>
          </div>
        </div>
        <p class="form-help">Usamos estos datos para decidir d&oacute;nde hay que repostar. Si no son correctos, abre tu perfil (bot&oacute;n &#x1F464; del header) para cambiarlos.</p>
      </div>
      <div id="route-status" class="route-status" aria-live="polite"></div>
      <div id="route-plan" class="route-plan" aria-live="polite"></div>
      <div id="route-results" class="route-results"></div>
    </div>
    <div class="modal-footer">
      <button id="btn-route-go" class="btn-primary">Planificar</button>
      <button id="btn-route-done" class="btn-ghost">Cerrar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL DIARIO DE REPOSTAJES ============ -->
<!-- Registro local (localStorage) de cada repostaje: litros, €/L, km totales.
     Calcula consumo real L/100km, gasto total, medias, y exporta CSV.
     Privacidad total: nada sale del navegador. -->
<div id="modal-diary" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="diary-title">
  <div class="modal diary-modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="diary-title">&#x1F4D6; Mi diario de repostajes</h2>
        <p>Lleva la cuenta real de tu consumo y ahorro. Todo se guarda solo en tu navegador.</p>
      </div>
      <button id="btn-diary-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div id="diary-stats" class="diary-stats" aria-live="polite">
        <div class="diary-stat"><div class="ds-label">Entradas</div><div class="ds-value" id="ds-entries">0</div></div>
        <div class="diary-stat"><div class="ds-label">Gasto total</div><div class="ds-value" id="ds-spent">0 &euro;</div></div>
        <div class="diary-stat"><div class="ds-label">Media &euro;/L</div><div class="ds-value" id="ds-avg">--</div></div>
        <div class="diary-stat"><div class="ds-label">Km recorridos</div><div class="ds-value" id="ds-km">0</div></div>
        <div class="diary-stat"><div class="ds-label">Consumo real</div><div class="ds-value" id="ds-cons">--</div></div>
        <div class="diary-stat"><div class="ds-label">Litros cargados</div><div class="ds-value" id="ds-liters">0 L</div></div>
      </div>

      <div class="diary-form">
        <h3 class="diary-subtitle">&#x2795; Nuevo repostaje</h3>
        <div class="diary-form-row">
          <div class="form-group">
            <label class="form-label" for="diary-litros">Litros</label>
            <input id="diary-litros" class="form-input" type="number" step="0.01" min="0.1" placeholder="40.00" />
          </div>
          <div class="form-group">
            <label class="form-label" for="diary-price">&euro;/L</label>
            <input id="diary-price" class="form-input" type="number" step="0.001" min="0.1" placeholder="1.529" />
          </div>
          <div class="form-group">
            <label class="form-label" for="diary-km">Km totales</label>
            <input id="diary-km" class="form-input" type="number" step="1" min="0" placeholder="42850" />
          </div>
          <div class="form-group">
            <label class="form-label" for="diary-date">Fecha</label>
            <input id="diary-date" class="form-input" type="date" />
          </div>
        </div>
        <button id="btn-diary-add" class="btn-primary">Guardar repostaje</button>
      </div>

      <div class="diary-list-wrap">
        <h3 class="diary-subtitle">&#x1F5C3;&#xFE0F; Historial</h3>
        <div id="diary-empty" class="favs-empty">
          Aun no hay repostajes. Anade el primero arriba y cada vez que llenes.
        </div>
        <div id="diary-list" class="diary-list"></div>
      </div>
    </div>
    <div class="modal-footer diary-footer">
      <button id="btn-diary-export" class="btn-ghost" title="Exportar CSV">&#x2B07;&#xFE0F; Exportar CSV</button>
      <button id="btn-diary-clear" class="btn-ghost" title="Borrar todo el diario">&#x1F5D1;&#xFE0F; Borrar todo</button>
      <button id="btn-diary-done" class="btn-primary">Cerrar</button>
    </div>
  </div>
</div>

<!-- ============ MODAL COMPARADOR SIDE-BY-SIDE ============ -->
<!-- Se abre cuando hay 2 estaciones en el selector de comparar. Las columnas
     son paralelas: mismo layout arriba y abajo para que el ojo compare
     directamente fila a fila (rotulo, distancia, precios por combustible,
     horario). La celda con menor valor se destaca con .compare-winner. -->
<div id="modal-compare" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="compare-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="compare-title">&#x2696;&#xFE0F; Comparador</h2>
        <p>Diferencias entre dos gasolineras, combustible por combustible.</p>
      </div>
      <button id="btn-compare-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div id="compare-body" class="compare-grid">
        <!-- Llenado dinamicamente por renderCompareModal() -->
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-compare-clear" class="btn-ghost">Quitar seleccion</button>
      <button id="btn-compare-done" class="btn-primary">Cerrar</button>
    </div>
  </div>
</div>

<!-- ============ Ship 20: MODAL HISTORICO DE PRECIOS ============ -->
<!-- Abierto desde el boton "Historico" en cada card del listado. Dentro va
     el placeholder del panel de historico (mismo que el popup del mapa, via
     buildHistoryPlaceholder()) + renderHistoryPanel() pinta. Asi reusamos
     toda la logica de fetch + sparkline en un modal mas grande — util en
     mobile donde el popup del mapa queda muy pequeno. -->
<div id="modal-history" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="history-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="history-title">&#x1F4C8; Historial de precios</h2>
        <p id="history-subtitle">Evolucion de los ultimos dias para esta estacion.</p>
      </div>
      <button id="btn-history-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div id="history-body">
        <!-- Llenado dinamicamente por openHistoryModal() -->
      </div>
    </div>
    <div class="modal-footer">
      <button id="btn-history-done" class="btn-primary">Cerrar</button>
    </div>
  </div>
</div>

<!-- Chip flotante de estado del comparador: aparece cuando el usuario anade
     la 1a estacion y desaparece al cerrar el modal o cuando borra la seleccion. -->
<div id="compare-chip" class="compare-chip" role="status" aria-live="polite" aria-hidden="true">
  <span id="compare-chip-text">&#x2696;&#xFE0F; 1 estacion seleccionada</span>
  <button type="button" id="compare-chip-clear" class="compare-chip-x" aria-label="Cancelar comparativa">&times;</button>
</div>

<!-- ============ Ship 8: MODAL REPORTAR PRECIO INCORRECTO ============ -->
<!-- Abierto desde los popups del mapa y desde las tarjetas de la lista via
     data-pop-report / data-report. El contenido se rellena en openReportModal()
     leyendo los data-* (estacion, rotulo, fuel, precio oficial). El usuario
     elige motivo en un dropdown cerrado (4 razones), opcionalmente anade el
     precio que vio en el surtidor y un comentario corto. Al enviar, POST a
     /api/reports/price — acuse 200 muestra toast y cierra el modal; 429/409
     muestran el toast apropiado sin cerrar. -->
<div id="modal-report" class="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="report-title">
  <div class="modal">
    <div class="modal-header modal-header-row">
      <div>
        <h2 id="report-title">&#x1F6A9; Reportar precio incorrecto</h2>
        <p id="report-subtitle">Avisa si el precio en el surtidor no coincide con el publicado.</p>
      </div>
      <button id="btn-report-close" class="modal-close-x" aria-label="Cerrar">&times;</button>
    </div>
    <div class="modal-body">
      <div id="report-context" class="report-context" aria-live="polite"></div>
      <div class="form-group">
        <label class="form-label" for="report-reason">Motivo</label>
        <select id="report-reason" class="form-input">
          <option value="outdated">Precio distinto al surtidor</option>
          <option value="closed">Gasolinera cerrada / fuera de servicio</option>
          <option value="wrong_fuel">El combustible no coincide</option>
          <option value="other">Otro motivo</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="report-price">Precio que viste en el surtidor (&euro;/L) <span class="form-hint">opcional</span></label>
        <input id="report-price" class="form-input" type="number" step="0.001" min="0.1" max="10" inputmode="decimal" placeholder="1,499" />
      </div>
      <div class="form-group">
        <label class="form-label" for="report-comment">Comentario <span class="form-hint">opcional, max 500 caracteres</span></label>
        <textarea id="report-comment" class="form-input" rows="3" maxlength="500" placeholder="Detalles extra (ej. surtidor 3, fecha, foto subida a otro sitio...)"></textarea>
      </div>
      <div id="report-status" class="route-status" aria-live="polite"></div>
    </div>
    <div class="modal-footer">
      <button id="btn-report-cancel" class="btn-ghost">Cancelar</button>
      <button id="btn-report-submit" class="btn-primary">Enviar reporte</button>
    </div>
  </div>
</div>

${tsKey ? `<!-- Turnstile invisible widget para proteger /api/ingest sin UX intrusiva -->
<div id="ts-widget"
     class="cf-turnstile ts-widget-hidden"
     data-sitekey="${tsKey}"
     data-size="invisible"
     data-appearance="interaction-only"
     data-callback="__onTsOk"
     data-expired-callback="__onTsExpired"
     aria-hidden="true"></div>` : ''}

${geoLabel && seo?.stats && ((seo.stats['95'] && seo.stats['95'].count >= 3) || (seo.stats['diesel'] && seo.stats['diesel'].count >= 3)) ? `
<!-- Bloque SEO estatico: resumen de precios del ambito (provincia o municipio).
     Se renderiza al final del DOM para no desplazar el mapa/sidebar (que son
     lo que el usuario quiere ver primero). Los crawlers sin ejecucion de JS
     lo leen y obtienen texto canonico con el nombre del ambito + precios
     reales — clave para rankear queries tipo "precio gasolina madrid" o
     "gasolineras alcala de henares". -->
<section class="seo-summary" aria-labelledby="seo-h2" style="padding:32px 20px;max-width:900px;margin:24px auto;border-top:1px solid rgba(100,116,139,0.2);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <h2 id="seo-h2" style="font-size:20px;color:#14532d;margin:0 0 12px">Precios de combustible en ${geoLabel}</h2>
  <p style="margin:0 0 16px;color:#475569;line-height:1.6">Esta página muestra los precios oficiales en tiempo real de las gasolineras de ${geoLabel}, según el <a href="https://sedeaplicaciones.minetur.gob.es/ServiciosRESTCarburantes/PreciosCarburantes/help" rel="noopener">dataset público del Ministerio para la Transición Ecológica</a>. Actualizado diariamente. Los rangos siguientes se calculan sobre el último snapshot disponible.</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px;max-width:640px">
    <thead><tr>
      <th style="text-align:left;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#64748b;font-weight:500">Combustible</th>
      <th style="text-align:right;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#64748b;font-weight:500">Más barato</th>
      <th style="text-align:right;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#64748b;font-weight:500">Medio</th>
      <th style="text-align:right;padding:8px 12px;border-bottom:2px solid #e5e7eb;color:#64748b;font-weight:500">Más caro</th>
    </tr></thead>
    <tbody>
      ${(() => {
        const labels: Record<string, string> = {
          '95':          'Gasolina 95',
          '98':          'Gasolina 98',
          'diesel':      'Gasóleo A',
          'diesel_plus': 'Gasóleo Premium',
        }
        return Object.keys(seo!.stats!).filter(k => seo!.stats![k].count >= 3).map(fuelCode => {
          const s = seo!.stats![fuelCode]
          return '<tr>'
            + '<td style="padding:10px 12px;border-bottom:1px solid #f1f5f9">' + (labels[fuelCode] || fuelCode) + '</td>'
            + '<td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:ui-monospace,monospace">' + s.min.toFixed(3) + ' €</td>'
            + '<td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:ui-monospace,monospace"><strong>' + s.avg.toFixed(3) + ' €</strong></td>'
            + '<td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;text-align:right;font-family:ui-monospace,monospace">' + s.max.toFixed(3) + ' €</td>'
            + '</tr>'
        }).join('')
      })()}
    </tbody>
  </table>
  <p style="margin:14px 0 0;color:#64748b;font-size:13px">${seo?.stationCount ? seo.stationCount + ' estaciones activas en ' + geoLabel + '. ' : ''}Usa el mapa o la lista de arriba para filtrar por municipio, horario, marca o distancia.</p>
</section>` : ''}

<!-- FAQ visible (Ship 11): renderizamos el mismo contenido que el FAQPage
     JSON-LD para que Google valide el schema (exige correspondencia 1:1 con
     contenido visible). Se emite SIEMPRE (home/provincia/municipio) — en
     provincia/municipio las dos primeras preguntas son contextualizadas con
     el nombre del ambito, lo que enriquece la relevancia semantica. -->
<section class="seo-faq" aria-labelledby="faq-h2" style="padding:16px 20px 48px;max-width:900px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <h2 id="faq-h2" style="font-size:20px;color:#14532d;margin:0 0 16px">Preguntas frecuentes${geoLabel ? ' sobre gasolineras en ' + geoLabel : ''}</h2>
  ${[...faqGeoItems, ...faqBaseItems].map(q => `
  <details style="border-top:1px solid #e5e7eb;padding:12px 0">
    <summary style="cursor:pointer;font-weight:500;color:#1f2937;list-style:none;display:flex;align-items:center;gap:8px">
      <span aria-hidden="true" style="color:#16a34a;font-size:12px">&#x25B6;</span>
      <span>${q.name}</span>
    </summary>
    <p style="margin:8px 0 0 20px;color:#475569;line-height:1.6">${q.acceptedAnswer.text}</p>
  </details>`).join('')}
</section>

${seo?.provinciaName && !seo?.municipioName && opts.municipios && opts.municipios.length > 0 ? `
<!-- Enlace interno a municipios destacados de la provincia (Ship 11): mejora
     la "internal linking" para SEO y ayuda a los crawlers a descubrir las
     paginas municipio. Solo aparece en la pagina provincial. -->
<section class="seo-municipios" aria-labelledby="munis-h2" style="padding:0 20px 48px;max-width:900px;margin:0 auto;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;">
  <h2 id="munis-h2" style="font-size:18px;color:#14532d;margin:0 0 12px">Gasolineras por municipio en ${seo.provinciaName}</h2>
  <p style="margin:0 0 12px;color:#475569;font-size:14px">Páginas dedicadas con precios y mapa de los municipios con más estaciones:</p>
  <ul style="list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:6px 16px">
    ${opts.municipios.map(m => `<li><a href="/gasolineras/${seo.provinciaSlug}/${m.slug}" style="color:#15803d;text-decoration:none;font-size:14px">${m.name} <span style="color:#94a3b8;font-size:12px">(${m.stationCount})</span></a></li>`).join('')}
  </ul>
</section>` : ''}

${getClientScript(nonce, APP_VERSION)}
<!-- Ship 1: features JS se carga como asset externo con defer. Cacheable por
     CDN + SW, paralelo al parse HTML, no bloquea FCP. El ?v=${APP_VERSION}
     fuerza invalidacion en cada release. Sin integrity hash (cambia por
     release y hacerlo requeriria build-time hashing que complica el pipeline).
     Same-origin + CSP script-src 'self' lo cubre. -->
<script defer src="/static/features.js?v=${APP_VERSION}" nonce="${nonce}"></script>
</body>
</html>`
}
