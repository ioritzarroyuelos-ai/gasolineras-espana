import type { Context, Hono } from 'hono'
import type { Env } from '../index'
import { canonicalBase, cfCache, genNonce, loadSnapshot, MUNI_INDEX_TTL } from '../lib/runtime'
import { consultaAvisos } from '../lib/tiempo-avisos'
import { buscaTiempo, catalogoTiempo, preparaBuscadorTiempo, rutaMunicipioTiempo, type IndiceBusquedaTiempo } from '../lib/tiempo-municipios'
import { construyeIndiceMunicipios, frescuraTiempo, horasVigentes, prediccionVigente, resuelveHoras, resuelvePrediccion } from '../../scripts/lib/tiempo.mjs'
import type { MunicipioLista, ParteHoras, Prediccion } from '../../scripts/lib/tiempo.mjs'
import { buildTiempoBusquedaPage, buildTiempoIndexPage, buildTiempoMunicipioPage, buildTiempoProvinciaPage, tiempoHeaders } from '../html/tiempo'

type Contexto = Context<{ Bindings: Env }>

function preparaCatalogo(base: MunicipioLista[]) {
  const municipios = catalogoTiempo(base)
  const porProvincia = new Map<string, MunicipioLista[]>()
  for (const m of municipios) {
    if (!porProvincia.has(m.provinciaSlug)) porProvincia.set(m.provinciaSlug, [])
    porProvincia.get(m.provinciaSlug)!.push(m)
  }
  const provincias = [...porProvincia].map(([slug, lista]) => ({ slug, name: lista[0].provinciaNombre }))
    .sort((a,b) => a.name.localeCompare(b.name, 'es'))
  let indiceCompatible: ReturnType<typeof construyeIndiceMunicipios> | undefined
  return { municipios, porProvincia, provincias,
    listadoCompatible: () => indiceCompatible ??= construyeIndiceMunicipios(municipios) }
}

// La caché guarda partes con fecha. Al leerlos volvemos a calcular qué horas y días siguen vigentes.
async function parteEnCache<T extends Prediccion | ParteHoras>(
  c: Contexto, ruta: string, vigente: (p: T) => T | null, descargar: () => Promise<T>,
): Promise<T | null> {
  const cache = cfCache()
  const key = new Request(new URL('/_cache/tiempo/v3/'+ruta, c.req.url))
  if (cache) {
    try {
      const hit = await cache.match(key)
      if (hit) {
        const parte = vigente(await hit.json() as T)
        if (parte) return parte
      }
    } catch { /* Sigue disponible la consulta al proveedor. */ }
  }
  let parte: T | null
  try { parte = vigente(await descargar()) } catch { return null }
  if (parte && cache) {
    const ttl = parte.fuente === 'Open-Meteo' ? 900 : 1800
    const res = new Response(JSON.stringify(parte),{headers:{'Content-Type':'application/json','Cache-Control':'public, max-age='+ttl}})
    const guardar = cache.put(key,res).catch(() => {})
    try { c.executionCtx.waitUntil(guardar) } catch { await guardar }
  }
  return parte
}

async function prediccionDiaria(c: Contexto, m: MunicipioLista) {
  const snap = await loadSnapshot<{predicciones:Record<string,Prediccion>}>(c.req.url,'tiempo/snapshot/'+m.provinciaSlug+'.json',c.env.ASSETS)
  const copia = prediccionVigente(snap?.predicciones?.[m.ine])
  // Una copia vigente sirve como respaldo; no debe impedir consultar partes
  // oficiales más recientes durante doce horas. La consulta se comparte 30 min.
  if (copia?.fuente === 'AEMET' && copia.versionPeriodos === 3 && frescuraTiempo(copia.elaborado).horas <= 0.5) return copia
  return await parteEnCache<Prediccion>(c,m.ine+'/dias',prediccionVigente,() => resuelvePrediccion({
    ...m, provincia:m.provinciaNombre, lat:m.lat ?? NaN, lng:m.lng ?? NaN,
  })) ?? copia
}

export function registerTiempoRoutes(app: Hono<{ Bindings: Env }>): void {
  let cacheCatalogo: { ts:number; datos:ReturnType<typeof preparaCatalogo> } | undefined
  let cacheBusqueda: { ts:number; datos:IndiceBusquedaTiempo } | undefined
  async function carga(c: Contexto) {
    if (cacheCatalogo && Date.now()-cacheCatalogo.ts < MUNI_INDEX_TTL) return cacheCatalogo.datos
    const base = await loadSnapshot<{municipios:MunicipioLista[]}>(c.req.url,'tiempo/municipios.json',c.env.ASSETS)
    if (!base?.municipios?.length) return preparaCatalogo([])
    const datos = preparaCatalogo(base.municipios)
    cacheCatalogo = { ts:Date.now(), datos }
    return datos
  }

  async function cargaBusqueda(c: Contexto): Promise<IndiceBusquedaTiempo> {
    if (cacheBusqueda && Date.now()-cacheBusqueda.ts < MUNI_INDEX_TTL) return cacheBusqueda.datos
    const estatico = await loadSnapshot<IndiceBusquedaTiempo>(c.req.url,'tiempo/buscador-v1.json',c.env.ASSETS)
    const datos = Array.isArray(estatico) && estatico.length ? estatico : preparaBuscadorTiempo((await carga(c)).municipios)
    if (datos.length) cacheBusqueda = { ts: Date.now(), datos }
    return datos
  }

  app.get('/api/tiempo/municipios', async c => {
    const q = c.req.query('q')
    if (q === undefined) {
      const lista = (await carga(c)).listadoCompatible()
      return c.json(lista,200,{'Cache-Control':lista.length ? 'public, max-age=300' : 'no-store'})
    }
    if (q.trim().length < 2) return c.json([],200,{'Cache-Control':'public, max-age=300'})
    const indice = await cargaBusqueda(c)
    return c.json(buscaTiempo(indice,q).resultados,200,{'Cache-Control':indice.length ? 'public, max-age=300' : 'no-store'})
  })
  app.get('/tiempo', c => c.redirect('/tiempo/'+new URL(c.req.url).search,301))
  app.get('/tiempo/', async c => {
    const { provincias } = await carga(c)
    const nonce = genNonce()
    return new Response(buildTiempoIndexPage(nonce,provincias,canonicalBase(c)+'/tiempo/'),{headers:tiempoHeaders(nonce)})
  })
  app.get('/tiempo/buscar', async c => {
    const q = (c.req.query('q') || '').trim().slice(0,100)
    if (q.length<2) return c.redirect('/tiempo/',302)
    const { destino, resultados } = buscaTiempo(await cargaBusqueda(c),q)
    if (destino) return c.redirect(destino,302)
    const nonce = genNonce()
    return new Response(buildTiempoBusquedaPage(nonce,q,resultados,canonicalBase(c)+'/tiempo/buscar'),{headers:tiempoHeaders(nonce)})
  })
  app.get('/tiempo/:prov', async c => {
    const provinciaSlug = c.req.param('prov')
    const lista = (await carga(c)).porProvincia.get(provinciaSlug)
    if (!lista) return c.notFound()
    const municipios = lista.map(({nombre,slug})=>({nombre,slug})).sort((a,b)=>a.nombre.localeCompare(b.nombre,'es'))
    const nonce = genNonce()
    return new Response(buildTiempoProvinciaPage(nonce,{provinciaSlug,provinciaName:lista[0].provinciaNombre,municipios,canonical:canonicalBase(c)+'/tiempo/'+provinciaSlug}),{headers:tiempoHeaders(nonce)})
  })
  app.get('/tiempo/:prov/:mun', async c => {
    const provincia = c.req.param('prov')
    const catalogo = await carga(c)
    const lista = catalogo.porProvincia.get(provincia)
    if (!lista) return c.notFound()
    const lugar = rutaMunicipioTiempo(lista,c.req.param('mun'))
    if (!lugar) return c.notFound()
    const m = lugar.municipio
    const ruta = '/tiempo/'+m.provinciaSlug+'/'+m.slug
    if (lugar.redirigir) return c.redirect(ruta,301)
    const [pred,horas,avisos] = await Promise.all([
      prediccionDiaria(c,m),
      parteEnCache<ParteHoras>(c,m.ine+'/horas',p=>horasVigentes(p,m.ine),()=>resuelveHoras({
        ...m, provincia:m.provinciaNombre, lat:m.lat ?? NaN, lng:m.lng ?? NaN,
      })),
      consultaAvisos(m.ine,{slug:m.slug,cache:cfCache() ?? undefined,origenCache:c.req.url}),
    ])
    const nonce = genNonce()
    return new Response(buildTiempoMunicipioPage(nonce,{municipio:m,pred,horas,avisos,canonical:canonicalBase(c)+ruta}),{headers:tiempoHeaders(nonce)})
  })
}
