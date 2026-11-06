// Vertical Farmacias de guardia (scrapers de los 47 colegios provinciales).
// Extraido de index.tsx (B1). registerFarmaciasRoutes(app, deps) registra
// /farmacias*, /api/guardias/municipios y las paginas SSR por provincia/municipio.
// Orden interno CRITICO: /farmacias/guardia va ANTES de /farmacias/:provinciaSlug
// o "guardia" se tragaria como slug de provincia. Se preserva dentro del modulo.
import type { Hono, Context } from 'hono'
import type { Env } from '../index'
import { loadSnapshot, genNonce, canonicalBase, MUNI_INDEX_TTL } from '../lib/runtime'
import { buildFarmaciasPage, farmaciasHeaders } from '../html/farmacias'
import {
  buildGuardiaMunicipioPage, buildGuardiaIndexPage, buildGuardiaProvinciaPage,
  buildGuardiaProvinciaFlatPage, guardiaHeaders,
} from '../html/guardia-municipio'
import {
  guardiasFileForProvincia, parseGuardias, guardiasForProvincia,
  municipiosConGuardia, guardiasForMunicipio, frescuraGuardia,
  GUARDIAS_TERRITORIO_BY_PROVINCIA, type GuardiasFile,
} from '../lib/guardias'
import { PROVINCIAS, provinciaBySlug } from '../lib/provincias'
import { slugsMunicipioGuardia, type LocalidadIndex } from '../lib/localidades'
import { slugifyMunicipio } from '../lib/municipios'
import { paginaBusquedaGuardia, paginaSinTurno, type LugarGuardia } from '../html/guardia-consulta'

type ContextoFarmacias = Context<{ Bindings: Env }>
const turnoPedido = (c: ContextoFarmacias) => {
  const turno = c.req.query('turno')
  return turno === 'ahora' || turno === '24h' ? turno : 'todas'
}
const sinIndice = (nonce: string) => ({ ...guardiaHeaders(nonce), 'X-Robots-Tag': 'noindex, follow' })

export function registerFarmaciasRoutes(app: Hono<{ Bindings: Env }>): void {
  // ---- Farmacias (Fase 1 MVP nacional) ----
  // `/farmacias` sin barra -> 301 a `/farmacias/` (misma canonicalizacion que
  // hacemos con /gasolineras para evitar duplicado SEO).
  app.get('/farmacias', c => {
    const url = new URL(c.req.url)
    return c.redirect('/farmacias/' + (url.search || ''), 301)
  })

  // `/farmacias/` — buscador de farmacia de guardia por texto (autocompletado).
  // Pagina autocontenida (HTML+CSS+JS inline con nonce). Ya no hay mapa ni
  // snapshot OSM: consume /api/guardias/municipios y lleva a la pagina SEO del
  // municipio elegido. (El antiguo farmacias.json y su cron se retiraron.)
  app.get('/farmacias/', c => {
    const nonce = genNonce()
    return new Response(buildFarmaciasPage(nonce, c.req.url), { headers: farmaciasHeaders(nonce) })
  })

  // `/farmacias/:provincia/:municipio` — pagina SEO de farmacia de guardia,
  // renderizada ENTERA en servidor (a diferencia de /farmacias/, que es la SPA).
  // Motivo: "farmacia de guardia en <municipio>" es la consulta de mayor
  // intencion del proyecto y una SPA no se indexa. Los datos ya los generan los
  // scrapers de los 47 colegios provinciales, incluidos los que solo publican en
  // PDF, que es justo donde la competencia no llega.
  // Los municipios conocidos conservan la dirección incluso entre dos guardias.
  // `/farmacias/guardia` — indice nacional de provincias con guardia.
  // IMPORTANTE: va declarada ANTES que `/farmacias/:provinciaSlug`, o el parametro
  // se tragaria "guardia" como si fuera un slug de provincia.
  app.get('/farmacias/guardia', c => {
    const provincias = PROVINCIAS
      .map(p => ({ slug: p.slug, name: p.name }))
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/farmacias/guardia'
    return new Response(
      buildGuardiaIndexPage(nonce, provincias, canonical),
      { headers: guardiaHeaders(nonce) },
    )
  })

  // Indice de municipios con guardia para el autocompletado de /farmacias/.
  // Recorre los 47 ficheros una vez y cachea 30 min en memoria. Devuelve
  // [{n: municipio, p: provincia, u: url de su pagina de guardia}]. Reusa las
  // MISMAS funciones que las rutas SSR (municipiosConGuardia, guardiasForProvincia),
  // asi que los slugs coinciden exactos y el enlace nunca da 404. Incluye tambien
  // los territorios caducados: el usuario los encuentra y su pagina ya muestra el
  // aviso de "sin turno actualizado".
  let muniGuardiaIndex: { ts: number; data: Array<{ n: string; p: string; u: string }> } | null = null

  async function leerIndiceGuardias(c: ContextoFarmacias) {
    if (muniGuardiaIndex && Date.now() - muniGuardiaIndex.ts < MUNI_INDEX_TTL) {
      return { lugares: muniGuardiaIndex.data, completo: true }
    }
    const out: Array<{ n: string; p: string; u: string }> = []
    const seen = new Set<string>()
    const cache = new Map<string, GuardiasFile | null>()
    const files = [...new Set(Object.keys(GUARDIAS_TERRITORIO_BY_PROVINCIA)
      .map(guardiasFileForProvincia).filter((file): file is string => !!file))]
    // En frío, 47 lecturas consecutivas retrasaban el autocompletado >5 s.
    // Se leen en grupos acotados, una vez por fichero (CLM se comparte).
    for (let i = 0; i < files.length; i += 6) {
      await Promise.all(files.slice(i, i + 6).map(async file => {
        try { cache.set(file, await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS)) }
        catch { cache.set(file, null) }
      }))
    }
    for (const provSlug of Object.keys(GUARDIAS_TERRITORIO_BY_PROVINCIA)) {
      const prov = provinciaBySlug(provSlug)
      const file = guardiasFileForProvincia(provSlug)
      if (!prov || !file) continue
      const raw = cache.get(file)
      if (!raw) continue
      const all = guardiasForProvincia(parseGuardias(raw), prov.id, raw.territorio)
      const municipios = municipiosConGuardia(all)
      if (municipios.length) {
        for (const m of municipios) {
          const u = '/farmacias/' + provSlug + '/' + m.slug
          if (seen.has(u)) continue
          seen.add(u)
          out.push({ n: m.name, p: prov.name, u })
        }
      } else if (all.length) {
        // Provincia sin municipio (Baleares, Huesca): entrada provincial.
        const u = '/farmacias/' + provSlug
        if (!seen.has(u)) { seen.add(u); out.push({ n: prov.name, p: prov.name, u }) }
      }
    }
    if (![...cache.values()].some(Boolean)) return { lugares: [], completo: false }
    const completos = [...cache.values()].every(Boolean)
    out.push({ n: 'Lugo', p: 'Lugo', u: '/farmacias/lugo' })
    out.sort((a, b) => a.n.localeCompare(b.n, 'es'))
    if (completos) muniGuardiaIndex = { ts: Date.now(), data: out }
    return { lugares: out, completo: completos }
  }

  app.get('/api/guardias/municipios', async c => {
    const { lugares, completo } = await leerIndiceGuardias(c)
    return c.json(lugares, lugares.length ? 200 : 503, { 'Cache-Control': completo ? 'public, max-age=3600' : 'no-store' })
  })

  // El buscador de respaldo también reconoce localidades sin turno ese día.
  // El índice se genera junto a las fichas municipales y no depende del COF de hoy.
  app.get('/farmacias/buscar', async c => {
    const q = (c.req.query('q') || '').trim().slice(0, 80)
    const clave = slugifyMunicipio(q)
    if (clave.length < 2) return c.redirect('/farmacias/', 302)
    const localidades = await loadSnapshot<LocalidadIndex[]>(c.req.url, 'localidades-index.json', c.env.ASSETS)
    const exactas: LugarGuardia[] = [], parciales: LugarGuardia[] = []
    const provincias = new Map(PROVINCIAS.map(p => [p.id, p]))
    for (const m of localidades ?? []) {
      const prov = provincias.get(m.ine.slice(0, 2))
      if (!prov) continue
      const nombres = slugsMunicipioGuardia(m)
      const exacta = nombres.includes(clave)
      if (!exacta && (parciales.length >= 20 || !nombres.some(n => n.includes(clave)))) continue
      const lista = exacta ? exactas : parciales
      lista.push({ nombre: m.nombre, provincia: prov.name, ruta: '/farmacias/' + prov.slug + '/' + nombres[0] })
    }
    // Los colegios también distinguen pedanías y barrios que no figuran como municipios en el INE.
    if (!exactas.length) {
      const { lugares } = await leerIndiceGuardias(c)
      const rutas = new Set(parciales.map(l => l.ruta))
      for (const l of lugares) {
        const nombre = slugifyMunicipio(l.n)
        const lugar = { nombre: l.n, provincia: l.p, ruta: l.u }
        if (nombre === clave) exactas.push(lugar)
        else if (parciales.length < 20 && nombre.includes(clave) && !rutas.has(l.u)) parciales.push(lugar)
      }
    }
    if (exactas.length === 1 && localidades) return c.redirect(exactas[0].ruta, 302)
    const provincia = PROVINCIAS.find(p => p.slug === clave)
    if (!exactas.length && provincia) return c.redirect('/farmacias/' + provincia.slug, 302)
    const nonce = genNonce()
    return c.html(paginaBusquedaGuardia(nonce, canonicalBase(c) + '/farmacias/buscar', q, exactas.length ? exactas : parciales, !!localidades),
      localidades ? 200 : 503, sinIndice(nonce))
  })

  // `/farmacias/:provincia` — municipios de la provincia con guardia publicada.
  // Es el eslabon que faltaba entre el indice y las 1.289 paginas de municipio.
  app.get('/farmacias/:provinciaSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const prov = provinciaBySlug(provSlug)
    if (!prov) return c.notFound()
    const file = guardiasFileForProvincia(provSlug)
    const raw = file ? await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS) : null
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/farmacias/' + provSlug
    if (!raw?.guardias?.length) return c.html(paginaSinTurno(nonce, canonical, prov, undefined, raw, !!file && !raw),
      file && !raw ? 503 : 200, sinIndice(nonce))

    const all = guardiasForProvincia(parseGuardias(raw), prov.id, raw.territorio)
    const municipios = municipiosConGuardia(all)

    // Si el territorio no se ha refrescado en el ultimo pase (>30 h), no lo
    // dejamos indexar: la pagina mostrara el aviso de caducado en vez del turno.
    const hdrs = frescuraGuardia(raw.ts).fiable
      ? guardiaHeaders(nonce)
      : { ...guardiaHeaders(nonce), 'X-Robots-Tag': 'noindex, follow' }
    // Sin municipios (Baleares, Huesca): la fuente no trae municipio pero SI trae
    // guardias con direccion y telefono; se listan directamente en vez de un 404.
    if (!municipios.length) {
      if (!all.length) return c.html(paginaSinTurno(nonce, canonical, prov, undefined, raw), 200, sinIndice(nonce))
      return new Response(
        buildGuardiaProvinciaFlatPage(nonce, provSlug, prov.name, all, raw.ts, canonical, raw, turnoPedido(c)),
        { headers: hdrs },
      )
    }
    return new Response(
      buildGuardiaProvinciaPage(nonce, provSlug, prov.name, municipios, raw.ts, canonical, raw),
      { headers: hdrs },
    )
  })

  app.get('/farmacias/:provinciaSlug/:municipioSlug', async c => {
    const provSlug = c.req.param('provinciaSlug')
    const munSlug  = c.req.param('municipioSlug')
    const prov = provinciaBySlug(provSlug)
    if (!prov) return c.notFound()
    const file = guardiasFileForProvincia(provSlug)
    const raw = file ? await loadSnapshot<GuardiasFile>(c.req.url, file, c.env.ASSETS) : null
    const all = guardiasForProvincia(parseGuardias(raw), prov.id, raw?.territorio)
    const municipios = municipiosConGuardia(all)
    const munEntry = municipios.find(m => m.slug === munSlug)
    const nonce = genNonce()
    const canonical = canonicalBase(c) + '/farmacias/' + provSlug + '/' + munSlug
    if (!munEntry || !raw) {
      const indice = await loadSnapshot<LocalidadIndex[]>(c.req.url, 'localidades/' + prov.id + '.json', c.env.ASSETS)
      if (!indice) return c.html(paginaSinTurno(nonce, canonical, prov, undefined, raw, true), 503, sinIndice(nonce))
      const conocidos = indice.filter(m => slugsMunicipioGuardia(m).includes(munSlug))
      if (conocidos.length !== 1) return c.notFound()
      const lugar = conocidos[0]
      const slugs = slugsMunicipioGuardia(lugar)
      const publicado = municipios.find(m => slugs.includes(m.slug))
      if (publicado) {
        const turno = turnoPedido(c)
        return c.redirect('/farmacias/' + provSlug + '/' + publicado.slug + (turno === 'todas' ? '' : '?turno=' + turno), 302)
      }
      return c.html(paginaSinTurno(nonce, canonical, prov, lugar.nombre, raw, !!file && !raw), file && !raw ? 503 : 200, sinIndice(nonce))
    }
    const hdrs = frescuraGuardia(raw.ts).fiable
      ? guardiaHeaders(nonce)
      : { ...guardiaHeaders(nonce), 'X-Robots-Tag': 'noindex, follow' }
    return new Response(buildGuardiaMunicipioPage(nonce, {
      provinciaSlug: provSlug,
      provinciaName: prov.name,
      municipioSlug: munSlug,
      municipioName: munEntry.name,
      guardias: guardiasForMunicipio(all, munSlug),
      otrosMunicipios: municipios.filter(m => m.slug !== munSlug),
      actualizado: raw.ts,
      fuente: raw.source,
      metadatos: raw,
      turno: turnoPedido(c),
      canonical,
    }), { headers: hdrs })
  })
}
